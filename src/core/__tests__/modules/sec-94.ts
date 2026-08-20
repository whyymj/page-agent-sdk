/**
 * sec-94 —— bulk-change-guard(大批量变更门禁:量纲/豁免/降级)
 *
 * 背景(G5):注入/跑偏的批量破坏无门禁。机制化信号不是意图而是**规模** —— 但量纲必须正确:
 * 「op 条数」≠「破坏面」(同组件 8 条 style patch 是正常微调),正确量纲 = 现有组件节点数。
 *
 * A. 量纲:同组件多 patch = 1 不拦;跨组件散落 = N 拦;新增路径不计
 * B. 阈值边界(= 阈值触发,< 放行);dryRun 短路
 * C. observe 模式只留痕不挂起;confirm 模式挂 approval(确认放行执行真实工具)
 * D. 拒绝 → BULK_CHANGE_REJECTED 回灌(含原子性提示);数据零改动
 * E. 会话级豁免:确认后同形态再超阈直接放行;reset 清除
 * F. lastPlanConfirmation(方案确认留痕)存在 → 豁免
 * G. writeCapable 判定:只拦写工具
 */
import type { TestCtx } from './_ctx'
import { measureWriteScale, createBulkGuardMiddleware, type BulkGuardMiddlewareOptions } from '../../harness/bulkGuard'

/** 测试 bind:5 个组件(components 数组)+ 2 个区块(sections 数组) */
function testBind(): Record<string, unknown> {
  return {
    components: [
      { id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }, { id: 4, name: 'd' }, { id: 5, name: 'e' },
    ],
    sections: [{ id: 's1' }, { id: 's2' }],
    title: '页面标题',
  }
}

/** 最小 ToolCallContext 桩(emit 走 ctx 事件通道 —— 与 approval/humanConfirm 同源,bulkGuard 挂起经此) */
function mkCallCtx(name: string, args: Record<string, unknown>, onApproval?: (resolve: (ok: boolean) => void) => void) {
  return {
    name, args, signal: undefined,
    emit: (evt: { type: string; resolve?: (ok: boolean) => void }) => {
      if (evt.type === 'approval_request' && evt.resolve) onApproval?.(evt.resolve)
    },
  } as any
}

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-94] bulk-change-guard:大批量变更门禁(量纲 = 现有组件节点数)')

  // ===== A. 量纲正反例(评审 3-4 核心)=====
  {
    const bind = testBind()
    // A1:同组件 8 条 patch(全部落 components.2)→ 1,不拦
    let r = measureWriteScale({ patches: Array.from({ length: 8 }, (_, i) => ({ op: 'set', jsonPath: `components.2.props.k${i}`, value: 1 })) }, () => bind)
    assert(r.count === 1 && r.kind === 'patches', '✓ 量纲 → 同组件 8 条 patch = 1(正常微调不拦)')
    // A2:patches 散落 5 个组件 → 5
    r = measureWriteScale({ patches: [0, 1, 2, 3, 4].map((i) => ({ op: 'set', jsonPath: `components.${i}.props.x`, value: 1 })) }, () => bind)
    assert(r.count === 5, '✓ 量纲 → patches 散落 5 个现有组件 = 5(拦)')
    // A3:同组件删 3 个 props → 1 不拦
    r = measureWriteScale({ patches: ['a', 'b', 'c'].map((k) => ({ op: 'remove', jsonPath: `components.0.props.${k}` })) }, () => bind)
    assert(r.count === 1, '✓ 量纲 → 同组件删 3 个 props = 1(不拦)')
    // A4:整体 set(components 数组替换)→ 现有组件节点总数 5+2=7
    r = measureWriteScale({ value: { components: [], sections: [] } }, () => bind)
    assert(r.count === 7 && r.kind === 'whole-set', `✓ 量纲 → 整体 set = 全部现有组件节点(实际 ${r.count})`)
    // A5:新增路径不计(append 到不存在路径 / 新组件)
    r = measureWriteScale({ patches: [
      { op: 'set', jsonPath: 'components.5', value: { id: 6 } },   // 新增(bind 无 index5)
      { op: 'set', jsonPath: 'components.0', value: { id: 1 } },   // 现有
    ] }, () => bind)
    assert(r.count === 1, '✓ 量纲 → 新增路径不计破坏面(append/set 新元素)')
    // A6:深路径截到组件粒度(components.3.props.style.color → components.3)
    r = measureWriteScale({ patch: { op: 'set', jsonPath: 'components.3.props.style.color', value: 'red' } }, () => bind)
    assert(r.count === 1 && r.scopes[0] === 'components.3', '✓ 量纲 → 深路径截到组件粒度首段')
    // A7:del 形态
    r = measureWriteScale({ del: true, patch: { jsonPath: 'components.0' } }, () => bind)
    assert(r.kind === 'del' && r.count === 1, '✓ 量纲 → del 形态按组件计')
    // A8:dryRun 短路
    r = measureWriteScale({ dryRun: true, patches: [0, 1, 2, 3, 4].map((i) => ({ op: 'set', jsonPath: `components.${i}.x`, value: 1 })) }, () => bind)
    assert(r.count === 0, '✓ 量纲 → dryRun 短路不度量')
  }

  // ===== B/C/D/E/F/G. 中间件行为 =====
  {
    const bind = testBind()
    const events: string[] = []
    const opts = (over: Partial<BulkGuardMiddlewareOptions> = {}): BulkGuardMiddlewareOptions => ({
      getBind: () => bind,
      tools: [{ name: 'write', writeCapable: true } as any, { name: 'read' } as any],
      onEvent: (e) => events.push(`${e.decision}:${e.kind}:${e.count}`),
      ...over,
    })
    const fivePatch = [0, 1, 2, 3, 4].map((i) => ({ op: 'set', jsonPath: `components.${i}.props.x`, value: 1 }))

    // B:阈值边界 —— 阈值 4,count 3 放行
    {
      const mw = createBulkGuardMiddleware(opts({ threshold: 4 }))
      let ran = false
      const r = await mw.wrapToolCall!(mkCallCtx('write', { patches: [0, 1, 2].map((i) => ({ op: 'set', jsonPath: `components.${i}.x`, value: 1 })) }), async () => { ran = true; return { content: 'ok', status: 'done' as const } })
      assert(ran && r.content === 'ok' && r.status !== 'error', '✓ 阈值边界 → count 3 < 4 放行(执行真实工具)')
      assert(events.some((e) => e.startsWith('pass:')), '✓ 留痕 → pass 决策入日志')
    }

    // C1:confirm 模式 —— 超阈挂 approval;确认放行执行真实工具 + 会话级豁免
    {
      events.length = 0
      const mw = createBulkGuardMiddleware(opts({ threshold: 4 }))
      let resolver: ((ok: boolean) => void) | undefined
      const p = mw.wrapToolCall!(mkCallCtx('write', { patches: fivePatch }, (r) => { resolver = r }), async () => { (bind as any).__executed = true; return { content: '已写入', status: 'done' as const } })
      await new Promise((r) => setTimeout(r, 10))
      assert(typeof resolver === 'function', '✓ confirm → 超阈挂 approval_request(ctx.emit 带 resolve)')
      resolver!(true)
      const r = await p
      assert((bind as any).__executed === true && r.status !== 'error', '✓ confirm → 用户确认后放行执行真实工具')
      assert(mw.state.confirmedKinds.has('patches'), '✓ 会话豁免 → 确认后该形态记入 confirmedKinds')
      // E:同形态再超阈 → 直接放行(不再挂)
      let ran2 = false
      const r2 = await mw.wrapToolCall!(mkCallCtx('write', { patches: fivePatch }), async () => { ran2 = true; return { content: 'again', status: 'done' as const } })
      assert(ran2 && r2.status !== 'error', '✓ 会话豁免 → 同形态第二次直接放行(防反复弹窗)')
      // reset 清除
      mw.state.reset()
      assert(mw.state.confirmedKinds.size === 0, '✓ reset → 会话豁免态清除')
    }

    // D:拒绝 → BULK_CHANGE_REJECTED + 数据零改动
    {
      events.length = 0
      const mw = createBulkGuardMiddleware(opts({ threshold: 4 }))
      const before = JSON.stringify(bind)
      let resolver: ((ok: boolean) => void) | undefined
      const p = mw.wrapToolCall!(mkCallCtx('write', { patches: fivePatch }, (r) => { resolver = r }), async () => { (bind as any).__leaked = true; return { content: '不应执行', status: 'done' as const } })
      await new Promise((r) => setTimeout(r, 10))
      resolver!(false)
      const r = await p
      assert(r.status === 'error' && r.content.includes('BULK_CHANGE_REJECTED'), '✓ 拒绝 → BULK_CHANGE_REJECTED 错误回灌')
      assert(r.content.includes('原子'), '✓ 拒绝文案 → 含分批破坏 patches 原子性提示')
      assert(JSON.stringify(bind) === before, '✓ 拒绝 → 数据零改动(真实工具未执行)')
    }

    // C2:observe 模式只留痕不挂起
    {
      events.length = 0
      const mw = createBulkGuardMiddleware(opts({ threshold: 4, mode: 'observe' }))
      let ran = false
      const r = await mw.wrapToolCall!(mkCallCtx('write', { patches: fivePatch }), async () => { ran = true; return { content: 'ok', status: 'done' as const } })
      assert(ran && r.status !== 'error', '✓ observe → 超阈只留痕不挂起(无人值守档)')
      assert(events.some((e) => e.startsWith('observe:patches:5')), '✓ observe → 留痕 decision=observe')
    }

    // F:lastPlanConfirmation 存在 → 豁免
    {
      events.length = 0
      const mw = createBulkGuardMiddleware(opts({ threshold: 4, getPlanConfirmation: () => ({ at: 1, summary: '方案' }) }))
      let ran = false
      const r2 = await mw.wrapToolCall!(mkCallCtx('write', { patches: fivePatch }), async () => { ran = true; return { content: 'ok', status: 'done' as const } })
      assert(ran && r2.status !== 'error', '✓ 方案豁免 → lastPlanConfirmation 存在直接放行')
      assert(events.some((e) => e.startsWith('exempt-plan:')), '✓ 方案豁免 → 留痕 exempt-plan')
    }

    // G:writeCapable 判定 —— 只拦写工具(read 不拦)
    {
      events.length = 0
      const mw = createBulkGuardMiddleware(opts({ threshold: 1 }))
      let ran = false
      const r = await mw.wrapToolCall!(mkCallCtx('read', { jsonPath: 'components' }), async () => { ran = true; return { content: '读取结果', status: 'done' as const } })
      assert(ran && r.status !== 'error', '✓ 工具判定 → 非 writeCapable 工具(read)不拦')
    }

    // 超时自动拒(挂起自带超时 —— stream 路径无 approvalWatch 兜底)
    {
      events.length = 0
      const mw = createBulkGuardMiddleware(opts({ threshold: 4, timeoutMs: 30 }))
      const p = mw.wrapToolCall!(mkCallCtx('write', { patches: fivePatch }), async () => ({ content: '不应执行', status: 'done' as const }))
      const r = await p
      assert(r.status === 'error' && r.content.includes('BULK_CHANGE_REJECTED'), '✓ 超时 → 挂起自带超时自动拒(不依赖 approvalWatch)')
      assert(events.some((e) => e.startsWith('timeout:')), '✓ 超时 → 留痕 timeout')
    }
  }
}
