/**
 * sec-107:section-orchestrator Phase 0b(欠委派 nudge)
 * 三态:invoke 内累计触达超阈触发(结果尾附一次性 advisory)/ 未超不触发 / 已委派抑制;
 * 附加:整体 set 特判(取 count 并入)/ dryRun 与失败写不度量 / advisory 不改结果语义(status 保留)/
 * beforeAgent 重置(invoke 级)/ 阈值边界(11 不触发、12 触发)。
 */
import { z } from 'zod'
import type { TestCtx } from './_ctx'
import { createDataOps } from '../../tools/dataOps'
import { createDelegateNudgeMiddleware, DELEGATE_NUDGE_THRESHOLD } from '../../harness/delegateNudge'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx

  const mk = (n: number) => ({
    title: '页',
    components: Array.from({ length: n }, (_, i) => ({ name: `c${i}`, note: `n${i}` })),
  })
  const schema = z.object({ title: z.string(), components: z.array(z.object({ name: z.string(), note: z.string() })) })
  const state = {} as any

  const setup = (n: number, threshold?: number) => {
    const bind: any = mk(n)
    const t = byName(createDataOps({ schema, bind, description: 'd' }))
    const mw: any = createDelegateNudgeMiddleware({ getBind: () => bind, ...(threshold !== undefined ? { threshold } : {}) })
    const next = async (c: { name: string; args: any }): Promise<{ content: string; status?: string }> => ({ content: await invoke(t[c.name], c.args) })
    const call = (name: string, args: unknown) => mw.wrapToolCall({ id: 'x', name, args, state, callConfig: undefined }, next)
    return { bind, call, mw }
  }

  console.log('\n[delegate-nudge 三态与边界]')
  {
    // ① 小步 grind 累计超阈 → 第 12 次成功写结果尾附一次性 advisory
    const { bind, call, mw } = setup(20)
    mw.beforeAgent(state)
    let nudgedAt = -1
    for (let i = 0; i < DELEGATE_NUDGE_THRESHOLD; i++) {
      const r = await call('write', { patch: { op: 'set', jsonPath: `components.${i}.note`, value: `v${i}` } })
      const has = /委派提示/.test(r.content)
      if (has && nudgedAt < 0) nudgedAt = i
      assert(!has || i === DELEGATE_NUDGE_THRESHOLD - 1, `✓ 第 ${i + 1} 次写只在超阈那一次附提示`)
    }
    assert(nudgedAt === DELEGATE_NUDGE_THRESHOLD - 1, `✓ 小步 grind 累计 ${DELEGATE_NUDGE_THRESHOLD} 组件 → 该次写结果尾附一次性 advisory(实际第 ${nudgedAt + 1} 次)`)
    // 一次性:后续写不再附
    const r2 = await call('write', { patch: { op: 'set', jsonPath: 'components.19.note', value: 'x' } })
    assert(!/委派提示/.test(r2.content), '✓ 一次性:nudge 后继续写不再附(不骚扰)')
    // advisory 不改结果语义
    const r3 = await call('write', { patch: { op: 'set', jsonPath: 'components.0.note', value: 'keep' } })
    assert(r3.content.startsWith('已 write(edit)') && bind.components[0].note === 'keep', '✓ advisory 尾附不改结果语义(写入照常生效)')
    // beforeAgent 重置:新 invoke 重新计数
    mw.beforeAgent(state)
    const r4 = await call('write', { patch: { op: 'set', jsonPath: 'components.0.note', value: 'v' } })
    assert(!/委派提示/.test(r4.content), '✓ beforeAgent 重置:新 invoke 从零计数')

    // ② 未超不触发
    {
      const { call: c2, mw: m2 } = setup(20)
      m2.beforeAgent(state)
      let fired = false
      for (let i = 0; i < DELEGATE_NUDGE_THRESHOLD - 1; i++) {
        const r = await c2('write', { patch: { op: 'set', jsonPath: `components.${i}.note`, value: `v${i}` } })
        if (/委派提示/.test(r.content)) fired = true
      }
      assert(!fired, `✓ 累计 ${DELEGATE_NUDGE_THRESHOLD - 1}(< 阈值)→ 不触发(中等任务单干正确形态不骚扰)`)
    }

    // ③ 已委派抑制(spawn_agent/spawn_agents/use_* 任一即算)
    {
      const { call: c3, mw: m3 } = setup(20)
      m3.beforeAgent(state)
      const noop = async (): Promise<{ content: string }> => ({ content: '子结论' })
      await (m3 as any).wrapToolCall({ id: 'x', name: 'spawn_agent', args: { task: '分段' }, state, callConfig: undefined }, noop)
      let fired = false
      for (let i = 0; i < DELEGATE_NUDGE_THRESHOLD + 2; i++) {
        const r = await c3('write', { patch: { op: 'set', jsonPath: `components.${i}.note`, value: 'v' } })
        if (/委派提示/.test(r.content)) fired = true
      }
      assert(!fired, '✓ 已委派(spawn_agent 出现)→ 抑制(主 agent 已在用委派,不再提示)')
    }

    // ④ 整体 set 特判:取 count 并入(scopes 粒度是顶层数组名不可并)
    {
      const { call: c4, mw: m4 } = setup(DELEGATE_NUDGE_THRESHOLD)
      m4.beforeAgent(state)
      const r = await c4('write', { value: { title: 't2', components: mk(DELEGATE_NUDGE_THRESHOLD).components } })
      assert(/委派提示/.test(r.content), `✓ 整体 set 触达 ${DELEGATE_NUDGE_THRESHOLD} 组件(count 并入)→ 单次即触发`)
    }

    // ⑤ dryRun / 失败写不度量
    {
      const { call: c5, mw: m5 } = setup(20, 3)
      m5.beforeAgent(state)
      const d = await c5('write', { patch: { op: 'set', jsonPath: 'components.0.note', value: 'v' }, dryRun: true })
      assert(!/委派提示/.test(d.content), '✓ dryRun 预检不度量')
      const bad = await c5('write', { patch: { op: 'set', jsonPath: 'components.99999.note', value: 'v' } })  // 越界 → 失败
      assert(!/委派提示/.test(bad.content), '✓ 失败写不度量(只认成功触达)')
      let fired = false
      for (let i = 0; i < 3; i++) {
        const r = await c5('write', { patch: { op: 'set', jsonPath: `components.${i}.note`, value: 'v' } })
        if (/委派提示/.test(r.content)) fired = true
      }
      assert(fired, '✓ 3 次成功写(threshold=3)→ 触发(失败/dryRun 未计入)')
    }

    // ⑥ 写成功口径:keep_external / no-op 删除不度量(团队审查 2026-08-24)
    //    keep_external 冲突裁决返回普通字符串(status done、无 ERROR: 前缀)—— 旧口径会误计为成功触达,
    //    12 次即误触发 nudge;对齐 writeGate 后数据零变化不度量。no-op 删除(「无需删除」)同口径。
    {
      const bind: any = mk(20)
      const mw: any = createDelegateNudgeMiddleware({ getBind: () => bind })
      mw.beforeAgent(state)
      const fakeNext = async (_c: unknown): Promise<{ content: string; status: 'done' }> => ({
        content: '冲突:字段已被外部修改,已保留外部修改(未写入)。当前值:xxx',
        status: 'done',
      })
      for (let i = 0; i < DELEGATE_NUDGE_THRESHOLD + 2; i++) {
        const r = await mw.wrapToolCall(
          { id: 'x', name: 'write', args: { patch: { op: 'set', jsonPath: `components.${i}.note`, value: 'v' } }, state, callConfig: undefined },
          fakeNext,
        )
        assert(!/委派提示/.test(r.content), `✓ keep_external(未写入)第 ${i + 1} 次不计量、不触发 nudge`)
      }
      const noopNext = async (_c: unknown): Promise<{ content: string; status: 'done' }> => ({ content: '无需删除:路径不存在', status: 'done' })
      const rNoop = await mw.wrapToolCall(
        { id: 'x', name: 'write', args: { patch: { jsonPath: 'components.0', del: true } }, state, callConfig: undefined },
        noopNext,
      )
      assert(!/委派提示/.test(rNoop.content), '✓ no-op 删除(无需删除)不计量')
      // 对照:同 shape 真成功文案(不含未写入)→ 正常计量(第 12 次触发,证明上面的跳过是口径而非参数)
      const okNext = async (_c: unknown): Promise<{ content: string; status: 'done' }> => ({ content: '已 write(edit) 主数据。', status: 'done' })
      let fired = false
      for (let i = 0; i < DELEGATE_NUDGE_THRESHOLD && !fired; i++) {
        const r = await mw.wrapToolCall(
          { id: 'x', name: 'write', args: { patch: { op: 'set', jsonPath: `components.${i}.note`, value: 'v' } }, state, callConfig: undefined },
          okNext,
        )
        if (/委派提示/.test(r.content)) fired = true
      }
      assert(fired, '✓ 对照:真成功写累计到阈仍触发(跳过逻辑只针对未写入/无需删除)')
    }
  }

  console.log('\n[编排段数据规模动态注入(Phase 1)]')
  {
    // 小数据零注入(零税)
    const small: any = mk(5)
    const mwS: any = createDelegateNudgeMiddleware({ getBind: () => small })
    assert((mwS.augmentPrompt(state) ?? '') === '', '✓ 小数据(< 阈值)→ 零注入零税')
    // 大数据注入:三步职责 + 段规格四要素 + S6 弱点明示
    const big: any = mk(DELEGATE_NUDGE_THRESHOLD + 5)
    const mwB: any = createDelegateNudgeMiddleware({ getBind: () => big })
    const seg = String(mwB.augmentPrompt(state) ?? '')
    assert(/分段编排/.test(seg) && /规划/.test(seg) && /分段委派/.test(seg) && /验收收口/.test(seg), '✓ 大数据(≥ 阈值)→ 注入三步职责(规划→分段委派→验收收口)')
    assert(/jsonPath 范围/.test(seg) && /改动目标/.test(seg) && /共享 tokens/.test(seg) && /验收标准/.test(seg), '✓ 段规格四要素齐(jsonPath/目标/共享 tokens/验收)')
    assert(/不经过组件锁/.test(seg) && /乐观锁兜底/.test(seg), '✓ S6 明示弱点进编排段(spawn_* 无组件锁,段不相交靠规划 + 乐观锁兜底)')
    assert(/不必为分段而分段/.test(seg), '✓ 含单干优先裁决(中小任务直接做,防为分段而分段)')
    // setData 跟随:live bind 引用闭包读取
    let live: any = mk(3)
    const mwL: any = createDelegateNudgeMiddleware({ getBind: () => live })
    assert((mwL.augmentPrompt(state) ?? '') === '', '✓ setData 跟随(前):小数据零注入')
    live = mk(DELEGATE_NUDGE_THRESHOLD + 1)
    assert(/分段编排/.test(String(mwL.augmentPrompt(state) ?? '')), '✓ setData 跟随(后):数据变大 → 注入开启(getBind 读 live)')
  }

  console.log('\n[delegate-nudge A2 度量口径(writeCapable 门 + eval transform 子树 + resource 排除)]')
  {
    // sandboxRunner 注入缝(node 无 Worker)+ writeCapable 标注的 eval_script 工具面
    const runner = (data: unknown, script: string) =>
      Promise.resolve({ ok: true, result: new Function('data', script)(data), elapsedMs: 1 })
    const setupA2 = () => {
      const bind: any = mk(20)
      const arr = createDataOps({ schema, bind, description: 'd' }, { sandboxRunner: runner } as any)
      const t = byName(arr)
      const mw: any = createDelegateNudgeMiddleware({ getBind: () => bind, getTools: () => arr as unknown as Array<{ name: string } & Record<string, unknown>> })
      const next = async (c: { name: string; args: any }): Promise<{ content: string; status?: string }> => ({ content: await invoke(t[c.name], c.args) })
      const call = (name: string, args: unknown) => mw.wrapToolCall({ id: 'x', name, args, state, callConfig: undefined }, next)
      return { bind, call, mw }
    }

    // ① eval transform 子树 grind(逐组件 transform)累计超阈 → 触发(修前只认 write 名,恒 0)
    const s1 = setupA2()
    s1.mw.beforeAgent(state)
    let hit = -1
    for (let i = 0; i < DELEGATE_NUDGE_THRESHOLD; i++) {
      const r = await s1.call('eval_script', { mode: 'transform', jsonPath: `components.${i}`, script: 'return data' })
      if (/委派提示/.test(r.content)) { hit = i; break }
    }
    assert(hit === DELEGATE_NUDGE_THRESHOLD - 1, `✓ eval transform 子树 grind 累计超阈触发(第 ${hit + 1} 次;修前恒不触发)`)

    // ② eval query 模式不计写(标注 args-aware:仅 mode:'transform' 判写)
    const s2 = setupA2()
    s2.mw.beforeAgent(state)
    for (let i = 0; i < DELEGATE_NUDGE_THRESHOLD + 3; i++) {
      await s2.call('eval_script', { mode: 'query', jsonPath: `components.${i}`, script: 'data.name' })
    }
    const rq = await s2.call('write', { patch: { op: 'set', jsonPath: 'components.0.note', value: 'q' } })
    assert(!/委派提示/.test(rq.content), '✓ query 模式不进度量(零误伤只读探查)')

    // ③ resource_update 排除({path,value} args 会 whole-set 分支单次误爆 —— P0 坑)
    const s3 = setupA2()
    s3.mw.beforeAgent(state)
    const rr = await s3.call('write', { patch: { op: 'set', jsonPath: 'components.0.note', value: 'x' } })
    assert(!/委派提示/.test(rr.content), '前置:普通写未超阈')
    // resource 工具在本 fixture 未装配(无 resources 配置),以 mock 工具形态直证排除门
    const mockTools = [
      { name: 'resource_update', writeCapable: true },
      { name: 'write', writeCapable: true },
    ] as Array<{ name: string } & Record<string, unknown>>
    const bind4: any = mk(20)
    const mw4: any = createDelegateNudgeMiddleware({ getBind: () => bind4, getTools: () => mockTools })
    const next4 = async (c: { name: string; args: any }) => ({ content: '已更新资源' })
    const call4 = (name: string, args: unknown) => mw4.wrapToolCall({ id: 'x', name, args, state, callConfig: undefined }, next4)
    mw4.beforeAgent(state)
    const ru = await call4('resource_update', { path: 'components.0.trackId', value: 'v' })
    assert(!/委派提示/.test(ru), '✓ resource_update 排除:单次调用不再 whole-set 误爆(修前 naive 换门必触发)')

    // ④ write + eval transform 混合并集(两工具 scope 合计超阈 → 凑满并集的那次调用尾附)
    const s5 = setupA2()
    s5.mw.beforeAgent(state)
    for (let i = 0; i < 6; i++) await s5.call('write', { patch: { op: 'set', jsonPath: `components.${i}.note`, value: `w${i}` } })
    let mixHit = false
    for (let i = 6; i < 6 + (DELEGATE_NUDGE_THRESHOLD - 6); i++) {
      const r = await s5.call('eval_script', { mode: 'transform', jsonPath: `components.${i}`, script: 'return data' })
      if (/委派提示/.test(r.content)) { mixHit = true; assert(i === DELEGATE_NUDGE_THRESHOLD - 1, `✓ 混合并集恰在凑满阈值的第 ${i + 1} 次调用触发`) }
    }
    assert(mixHit, '✓ write + eval 混合 grind scope 并集计量(修前 eval 部分逃逸)')

    // ⑤ 无 getTools(存量构造)→ 退化回仅 write 现行为(eval 恒不计量,兼容承诺)
    const bind6: any = mk(20)
    const t6 = byName(createDataOps({ schema, bind: bind6, description: 'd' }, { sandboxRunner: runner } as any))
    const mw6: any = createDelegateNudgeMiddleware({ getBind: () => bind6 })
    const next6 = async (c: { name: string; args: any }) => ({ content: await invoke(t6[c.name], c.args) })
    const call6 = (name: string, args: unknown) => mw6.wrapToolCall({ id: 'x', name, args, state, callConfig: undefined }, next6)
    mw6.beforeAgent(state)
    for (let i = 0; i < DELEGATE_NUDGE_THRESHOLD + 3; i++) await call6('eval_script', { mode: 'transform', jsonPath: `components.${i}`, script: 'return data' })
    const r6 = await call6('write', { patch: { op: 'set', jsonPath: 'components.0.note', value: 'n' } })
    assert(!/委派提示/.test(r6.content), '✓ 无 getTools(存量构造)退化现行为:eval 不计量(①-⑥ 老用例兼容承诺)')
  }
}
