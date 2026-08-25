/**
 * sec-70:fix-main-sub-isolation(主×子协同隔离)单元层
 * - per-scope 乐观锁基线(P1-13):主×子 scope 隔离(子 read/write 不污染主基线)/ 嵌套 enter/restore / exitScope 清理 / setData 全清
 * - dataOps 工具 __dataOpsScoped marker + wrapWithScope 行为
 * - N1 防御加固:同 scope 连续写(跨工具类型)永不互相冲突(写成功即刷基线 + 检查时刻解析)
 */
import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
import { wrapWithScope } from '../../harness/subagent'
import type { TestCtx } from './_ctx'

function makeOps(bind: Record<string, unknown>) {
  return createDataOps({
    schema: z.object({ title: z.string(), count: z.number().int() }),
    bind,
    description: '测试数据',
  }, { conflictWatchFields: ['*'] })
}

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[fix-main-sub-isolation:per-scope 基线 / allSettled 辅助]')

  // ===== P1-13:子 scope read 不污染主基线 =====
  {
    const bind: Record<string, unknown> = { title: 'a', count: 0 }
    const tools = makeOps(bind)
    const t = byName(tools)
    const controller = (tools as any).controller
    assert(typeof controller.enterScope === 'function' && typeof controller.exitScope === 'function', 'controller 暴露 enterScope/exitScope')

    await invoke(t['read'], {})  // 主基线 = H0
    bind.count = 99  // 外部修改(不经工具 → hash 变 H1)
    const exit = controller.enterScope('sub-1')
    await invoke(t['read'], { jsonPath: 'title' })  // 子 scope read → 只更新子 scope 基线(H1)
    exit()

    // 主 scope 写:autoLock 用主基线 H0 ≠ 当前 H1 → VERSION_CONFLICT(修前:子 read 刷新共享基线 → 静默放行覆盖外部修改)
    const r = await invoke(t['write'], { value: { title: 'x', count: 1 } })
    assert(/VERSION_CONFLICT/.test(r) && bind.count === 99, '✓ P1-13 子 read 不污染主基线 → 父过期写 VERSION_CONFLICT(外部修改不被覆盖)')

    // 子 scope 基线确实被更新(子自己再写不冲突):进 scope → write 用子基线 H1 = 当前 → 通过
    const exit2 = controller.enterScope('sub-1')
    const r2 = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'title', value: 'sub-written' } })
    exit2()
    assert(!/VERSION_CONFLICT/.test(r2) && bind.title === 'sub-written', '✓ 子 scope 自己的基线有效(子内 read→write 不冲突)')

    // 子 scope 写后主基线仍不被污染:主再写仍冲突(主基线还是 H0)
    const r3 = await invoke(t['write'], { value: { title: 'main-again', count: 2 } })
    assert(/VERSION_CONFLICT/.test(r3), '✓ 子 scope 写不污染主基线(主 autoLock 仍用旧基线 → 冲突)')
  }

  // ===== 嵌套 enter/restore 安全 =====
  {
    const bind: Record<string, unknown> = { title: 'n', count: 0 }
    const tools = makeOps(bind)
    const t = byName(tools)
    const controller = (tools as any).controller
    await invoke(t['read'], {})  // 主基线 H0
    bind.count = 7  // 外部改 → H1
    const exitA = controller.enterScope('a')
    const exitB = controller.enterScope('b')
    await invoke(t['read'], { jsonPath: 'count' })  // b 基线 = H1
    exitB()  // 回 a
    await invoke(t['read'], { jsonPath: 'count' })  // a 基线 = H1
    exitA()  // 回主
    const r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'title', value: 'nested' } })
    assert(/VERSION_CONFLICT/.test(r), '✓ 嵌套 scope enter/restore 后主基线未被内层操作污染')
  }

  // ===== exitScope 清理基线条目 =====
  {
    const bind: Record<string, unknown> = { title: 'c', count: 0 }
    const tools = makeOps(bind)
    const t = byName(tools)
    const controller = (tools as any).controller
    const exit = controller.enterScope('gone')
    await invoke(t['read'], {})
    exit()
    controller.exitScope('gone')
    bind.count = 5  // 外部改
    // 清掉后重进 = 无基线 → autoLock 无比对对象 → 直接写(新 scope 未 read 语义)
    const exit2 = controller.enterScope('gone')
    const r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'title', value: 'after-exit' } })
    exit2()
    assert(!/VERSION_CONFLICT/.test(r) && bind.title === 'after-exit', '✓ exitScope 清基线条目(重进该 scope 无旧基线残留)')
  }

  // ===== controller.set 清全部 scope 基线 =====
  {
    const bind: Record<string, unknown> = { title: 's', count: 0 }
    const tools = makeOps(bind)
    const t = byName(tools)
    const controller = (tools as any).controller
    await invoke(t['read'], {})
    controller.set({ schema: z.object({ title: z.string(), count: z.number().int() }), bind })
    bind.count = 3  // 外部改(setData 后基线已清 → 无锁比对)
    const r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'title', value: 'post-set' } })
    assert(!/VERSION_CONFLICT/.test(r), '✓ controller.set(data 替换)清空全部 scope 基线')
  }

  // ===== dataOps 工具 marker =====
  {
    const tools = makeOps({ title: 'm', count: 0 })
    assert(tools.every((t) => (t as any).__dataOpsScoped === true), '✓ createDataOps 全部工具带 __dataOpsScoped marker(子池 scope proxy 识别)')
    assert(!Object.keys(tools[0]).includes('__dataOpsScoped'), '✓ marker 不可枚举(不污染遍历)')
  }

  // ===== wrapWithScope 行为(enter/restore 成对 + scopeId 正确) =====
  {
    const calls: string[] = []
    const fakeTool: any = { name: 'fake', invoke: async () => { calls.push('invoke'); return 'ok' } }
    const enter = (id: string) => { calls.push(`enter:${id}`); return () => calls.push('restore') }
    const wrapped = wrapWithScope(fakeTool, 'scope-x', enter)
    const r = await (wrapped as any).invoke({})
    assert(r === 'ok', '✓ wrapWithScope 透传 invoke 结果')
    assert(calls.join(',') === 'enter:scope-x,invoke,restore', '✓ wrapWithScope enter→invoke→restore 成对有序')
    assert((wrapped as any).name === 'fake', '✓ wrapWithScope 其他属性透传(name)')
  }

  // ===== N1:同 scope 连续写(跨写形态 patch/整体)永不互相冲突 =====
  {
    const bind: Record<string, unknown> = { title: 'w', count: 0 }
    const tools = makeOps(bind)
    const t = byName(tools)
    await invoke(t['read'], {})  // 基线 H0
    const r1 = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'count', value: 1 } })   // 写后基线刷 H1
    const r2 = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'count', value: 2 } })   // 用 H1 → 通过 → 刷 H2
    const r4 = await invoke(t['write'], { value: { title: 'w2', count: 4 } })                    // 整体写(用 H2)→ 通过
    assert(
      [r1, r2, r4].every((r) => !/VERSION_CONFLICT/.test(r)) && bind.count === 4 && bind.title === 'w2',
      '✓ N1 同 scope 连续写(write patch 连续 + 整体 set)永不互相冲突(每次写成功即刷基线)',
    )
  }
}
