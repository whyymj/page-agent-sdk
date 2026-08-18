/**
 * sec-86 —— baseline-guard 基线守卫白盒单测(editor_fangzhou「自冲突」根因修)
 *
 * A. createBaselineGuardMiddleware wrapToolCall 行为:
 *    managed 工具跳过 / 无基线短路 / bind 未变不刷 / bind 变化刷基线留痕 / 抛错路径兜底
 * B. dataOps controller 新增面:hasBaselines / recomputeAllBaselines
 *    集成验证:read 建基线 → 写路径外改 bind → write 自冲突(VERSION_CONFLICT)→ recomputeAllBaselines → write 落地
 */
import { z } from 'zod'
import type { TestCtx } from './_ctx'
import { createBaselineGuardMiddleware } from '../../sdk/baselineGuard'
import { createDataOps } from '../../tools/dataOps'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-86] baseline-guard 基线守卫白盒单测')

  // ===== A. 中间件行为 =====
  {
    const mkCtx = (name: string) => ({ id: 'c1', name, args: {}, state: {} }) as any
    // managed 工具跳过:不算 hash(getBind 零调用),直放 next
    {
      let bindCalls = 0
      let recompute = 0
      const mw = createBaselineGuardMiddleware({
        getBind: () => { bindCalls++; return { a: 1 } },
        recomputeAll: () => { recompute++ },
        hasBaselines: () => true,
        isManaged: (n) => n === 'write',
      })
      let nextCalled = 0
      const res = await mw.wrapToolCall!(mkCtx('write'), async () => { nextCalled++; return { content: 'ok', status: 'done' as const } })
      assert(nextCalled === 1 && res.content === 'ok', '✓ baseline-guard → managed 工具(dataOps 内置)直放 next')
      assert(bindCalls === 0 && recompute === 0, '✓ baseline-guard → managed 工具跳过 hash 比对(零开销)')
    }
    // 无基线短路:hasBaselines false → 不算 hash
    {
      let bindCalls = 0
      const mw = createBaselineGuardMiddleware({
        getBind: () => { bindCalls++; return { a: 1 } },
        recomputeAll: () => {},
        hasBaselines: () => false,
        isManaged: () => false,
      })
      await mw.wrapToolCall!(mkCtx('add_component'), async () => ({ content: 'ok', status: 'done' as const }))
      assert(bindCalls === 0, '✓ baseline-guard → 无基线条目时短路(跳过 before/after hash,read 族高频场景省开销)')
    }
    // bind 未变 → 不刷基线
    {
      const bind = { a: 1 }
      let recompute = 0
      const logs: unknown[] = []
      const mw = createBaselineGuardMiddleware({
        getBind: () => bind,
        recomputeAll: () => { recompute++ },
        hasBaselines: () => true,
        isManaged: () => false,
        log: (t, d) => logs.push([t, d]),
      })
      await mw.wrapToolCall!(mkCtx('list_components'), async () => ({ content: 'ok', status: 'done' as const }))
      assert(recompute === 0 && logs.length === 0, '✓ baseline-guard → 工具未改 bind 时不刷基线不留痕')
    }
    // bind 变化 → 刷基线 + 留痕
    {
      const bind: { items: string[] } = { items: [] }
      let recompute = 0
      const logs: unknown[] = []
      const mw = createBaselineGuardMiddleware({
        getBind: () => bind,
        recomputeAll: () => { recompute++ },
        hasBaselines: () => true,
        isManaged: () => false,
        log: (t, d) => logs.push([t, d]),
      })
      await mw.wrapToolCall!(mkCtx('add_component'), async () => { bind.items.push('x'); return { content: 'ok', status: 'done' as const } })
      assert(recompute === 1, '✓ baseline-guard → 工具改 bind 后调 recomputeAll 刷新基线(自冲突根因修)')
      assert(logs.length === 1 && (logs[0] as any[])[0] === 'baseline_guard', '✓ baseline-guard → 刷新留痕(type=baseline_guard,DebugDrawer 可见)')
    }
    // 抛错路径:改了一半抛错 → finally 兜底仍刷基线,错误照常冒泡
    {
      const bind = { v: 1 }
      let recompute = 0
      const mw = createBaselineGuardMiddleware({
        getBind: () => bind,
        recomputeAll: () => { recompute++ },
        hasBaselines: () => true,
        isManaged: () => false,
      })
      let threw = false
      try {
        await mw.wrapToolCall!(mkCtx('half_tool'), async () => { bind.v = 2; throw new Error('boom') })
      } catch (e) {
        threw = (e as Error).message === 'boom'
      }
      assert(threw, '✓ baseline-guard → 工具抛错照常冒泡(不吞错)')
      assert(recompute === 1, '✓ baseline-guard → 抛错路径 bind 已变也刷基线(finally 兜底)')
    }
  }

  // ===== B. dataOps controller:hasBaselines / recomputeAllBaselines =====
  {
    const schema = z.object({ title: z.string(), items: z.array(z.string()) })
    const bind: { title: string; items: string[] } = { title: 'orig', items: [] }
    const tools = createDataOps({ schema, bind }) as any
    const controller = tools.controller
    const readTool = tools.find((t: any) => t.name === 'read')
    const writeTool = tools.find((t: any) => t.name === 'write')
    assert(typeof controller.hasBaselines === 'function' && typeof controller.recomputeAllBaselines === 'function',
      '✓ dataOps controller 暴露 hasBaselines / recomputeAllBaselines')
    assert(controller.hasBaselines() === false, '✓ hasBaselines → 初始无基线(未 read)')
    await readTool.invoke({})
    assert(controller.hasBaselines() === true, '✓ hasBaselines → read 后主 scope 基线建立')
    // 复现自冲突:写路径外直改 bind → write(autoLock)VERSION_CONFLICT
    bind.items.push('外部结构改动')
    const conflicted = String(await writeTool.invoke({ patch: { op: 'set', jsonPath: 'title', value: 'agent值' } }))
    assert(conflicted.includes('VERSION_CONFLICT'), '✓ 自冲突复现 → 写路径外改 bind 后 autoLock write 报 VERSION_CONFLICT(修复前用户所见)')
    // recomputeAllBaselines 后 write 落地
    controller.recomputeAllBaselines()
    const okRes = String(await writeTool.invoke({ patch: { op: 'set', jsonPath: 'title', value: 'agent值' } }))
    assert(!okRes.includes('VERSION_CONFLICT') && bind.title === 'agent值', '✓ recomputeAllBaselines → 基线刷新后 write 照常落地(零冲突)')
  }
}
