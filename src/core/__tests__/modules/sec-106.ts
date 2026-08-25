/**
 * sec-106:subtree-summary Phase 1(read-before-write 守卫)
 * 四态:未读拦(NEED_NARROW_READ 回灌窄读指令)/ 已读放(本轮窄读 S 或后代)/ dryRun 放 / 已写过放(S 打开);
 * 附加:未落入摘要面放(S1 骨架直写)/ 每子树一次(第二次拦放行防嘴硬死循环)/ beforeAgent 重置(invoke 级)/
 * 整体 set 不拦(无 jsonPath)/ 拦截不落盘(next 未执行)。
 */
import { z } from 'zod'
import type { TestCtx } from './_ctx'
import { createDataOps } from '../../tools/dataOps'
import { createSubtreeWriteGuardMiddleware } from '../../sdk/subtreeGuard'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx

  const schema = z.object({
    title: z.string(),
    components: z.array(z.object({ name: z.string(), props: z.object({ style: z.object({ bg: z.string(), fg: z.string() }), note: z.string() }) })),
  })
  const bind: any = {
    title: '页',
    components: [
      { name: 'a', props: { style: { bg: 'x'.repeat(3200), fg: 'y' }, note: 'n' } },
      { name: 'b', props: { style: { bg: 'g', fg: 'w' }, note: 'm' } },
    ],
  }
  const ops = createDataOps({ schema, bind, description: 'd' })
  const t = byName(ops)
  const ctrl = (ops as any).controller as { getSummarizedPaths(): string[]; clearSummarizedPaths(): void }
  const mw: any = createSubtreeWriteGuardMiddleware({ getSummarizedPaths: () => ctrl.getSummarizedPaths(), clearSummarizedPaths: () => ctrl.clearSummarizedPaths() })
  const state = {} as any
  // next = 真执行工具(计数验证拦截时工具未跑)
  let executed: string[] = []
  const next = async (c: { name: string; args: any; callConfig?: unknown }): Promise<{ content: string; status?: string }> => {
    executed.push(c.name)
    const content = await invoke(t[c.name], c.args, c.callConfig ? { configurable: c.callConfig } : undefined)
    return { content }
  }
  const call = (name: string, args: unknown) => mw.wrapToolCall({ name, args, state, callConfig: undefined }, next)

  console.log('\n[subtree-write-guard 四态 + 边界]')
  {
    // 前置:骨架读 → style 占位进摘要路径集
    mw.beforeAgent(state)
    const sk = await call('read', { jsonPath: 'components.0' })
    assert(/<subtree/.test(sk.content), '前置:骨架读产生 <subtree> 占位')
    assert(ctrl.getSummarizedPaths().includes('components.0.props.style'), '前置:占位路径进 getSummarizedPaths(controller 出口)')

    // ① 未读拦:写占位子树深路径 → NEED_NARROW_READ,工具未执行(不落盘)
    executed = []
    const r1 = await call('write', { patch: { op: 'set', jsonPath: 'components.0.props.style.bg', value: 'red' } })
    assert(r1.content.startsWith('NEED_NARROW_READ') && r1.status === 'error' && executed.length === 0,
      '✓ 未窄读直写占位子树 → 拦(NEED_NARROW_READ + ask-first 窄读指令),工具未执行不落盘')
    assert(/read\(\{jsonPath:"components\.0\.props\.style"\}\)/.test(r1.content), '✓ 拦截文案带具体窄读指令(一轮后可写,非禁止)')
    assert(bind.components[0].props.style.bg.startsWith('x'), '✓ 拦截时 bind 未被改')

    // ② dryRun 放
    const r2 = await call('write', { patch: { op: 'set', jsonPath: 'components.0.props.style.bg', value: 'red' }, dryRun: true })
    assert(!r2.content.startsWith('NEED_NARROW_READ'), '✓ dryRun 恒放行(预检不落盘)')

    // ③ 未落入摘要面放(S1:写别处小字段)
    const r3 = await call('write', { patch: { op: 'set', jsonPath: 'components.1.props.note', value: 'm2' } })
    assert(!r3.content.startsWith('NEED_NARROW_READ') && bind.components[1].props.note === 'm2', '✓ 写路径未落入摘要面 → 恒放行(骨架直写小标量)')

    // ④ 每子树一次:同子树第二次拦 → 放行(防嘴硬死循环)
    const r4 = await call('write', { patch: { op: 'set', jsonPath: 'components.0.props.style.bg', value: 'red2' } })
    assert(!r4.content.startsWith('NEED_NARROW_READ') && bind.components[0].props.style.bg === 'red2',
      '✓ 同一子树第二次拦截放行(每子树一次;失败可见不静默)')

    // ⑤ 已读过 → 放行 + S 打开(后续写不再依赖窄读)—— 新数据集(前段写入已把大值改短)
    {
      const bind2: any = {
        title: '页2',
        components: [
          { name: 'a', props: { style: { bg: 'x'.repeat(3200), fg: 'y' }, note: 'n' } },
          { name: 'b', props: { style: { bg: 'g', fg: 'w' }, note: 'm' } },
        ],
      }
      const ops2 = createDataOps({ schema, bind: bind2, description: 'd' })
      const t2 = byName(ops2)
      const ctrl2 = (ops2 as any).controller as { getSummarizedPaths(): string[]; clearSummarizedPaths(): void }
      const mw2: any = createSubtreeWriteGuardMiddleware({ getSummarizedPaths: () => ctrl2.getSummarizedPaths(), clearSummarizedPaths: () => ctrl2.clearSummarizedPaths() })
      const next2 = async (c: { name: string; args: any }): Promise<{ content: string; status?: string }> => ({ content: await invoke(t2[c.name], c.args) })
      const call2 = (name: string, args: unknown) => mw2.wrapToolCall({ name, args, state, callConfig: undefined }, next2)

      mw2.beforeAgent(state)  // 新 invoke:状态重置
      await call2('read', { jsonPath: 'components' })  // 重新产生占位
      assert(ctrl2.getSummarizedPaths().includes('components.0.props.style'), '前置②:beforeAgent 清空后骨架读重新上报占位')
      const blocked = await call2('write', { patch: { op: 'set', jsonPath: 'components.0.props.style.bg', value: 'z' } })
      assert(blocked.content.startsWith('NEED_NARROW_READ'), '前置③:新 invoke 无窄读仍拦(重置生效)')
      await call2('read', { jsonPath: 'components.0.props.style' })  // 窄读全文
      const r5 = await call2('write', { patch: { op: 'set', jsonPath: 'components.0.props.style.bg', value: 'green' } })
      assert(!r5.content.startsWith('NEED_NARROW_READ') && bind2.components[0].props.style.bg === 'green', '✓ 已窄读(S 自身)→ 放行')
      const r6 = await call2('write', { patch: { op: 'set', jsonPath: 'components.0.props.style.fg', value: 'white' } })
      assert(bind2.components[0].props.style.fg === 'white', '✓ 已写过(S 打开)→ 同子树后续写放行')

      // ⑥ 整体 set(无 jsonPath)不拦
      const r7 = await call2('write', { value: { title: '新页', components: bind2.components } })
      assert(!r7.content.startsWith('NEED_NARROW_READ'), '✓ 整体 set(无 jsonPath)不拦(写路径=根不落入 S,S4 一把梭明示不覆盖)')

      // ⑦ beforeAgent 清占位集:invoke 边界不株连
      await call2('read', { jsonPath: 'components.0' })
      mw2.beforeAgent(state)
      const r8 = await call2('write', { patch: { op: 'set', jsonPath: 'components.0.props.style.bg', value: 'b8' } })
      assert(!r8.content.startsWith('NEED_NARROW_READ'), '✓ beforeAgent 清摘要集:上轮占位不株连本轮(invoke 级口径)')
    }
  }
}
