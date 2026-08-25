/**
 * sec-110 —— approval/humanConfirm 无响应自动拒 + hold() 接管(flow-robustness P1#3)
 *
 * 背景:30s 只在 send/batch 事件级 approvalWatch 注入,humanConfirm 本体无超时 ——
 * 无响应方路径(headless stream / streaming:false 裸 invoke)approval_request 无限挂。
 * 修法:中间件本体默认超时(装配层注入)+ 事件携带 hold() 由响应方接管(内置 UI 收到即调)。
 *
 * A. 无 hold → 超时自动拒(approval: error 结果;humanConfirm: 视同拒绝)+ onAutoReject 留痕参数
 * B. hold() 接管 → 计时取消,超时不触发;用户 resolve 照常收口
 * C. 用户先收口 → 计时清理,deadline 后 onAutoReject 不误报
 * D. abort 先于超时 → 自动拒但不留痕 onAutoReject(非超时路径)
 * E. timeoutMs=0 → 事件无 hold 字段,永不自动拒(显式关)
 */
import type { TestCtx } from './_ctx'
import { createApprovalMiddleware } from '../../harness/approval'
import { createHumanConfirmMiddleware, HUMAN_CONFIRM_TOOL_NAME } from '../../harness/humanConfirm'

interface CapturedEvt {
  resolve: (c: boolean | string) => void
  hold?: () => void
}

/** 捕获 approval_request 事件(不自动应答),返回 ctx 与事件槽 */
function mkCaptureCtx(name: string, args: Record<string, unknown> = {}) {
  let captured: CapturedEvt | undefined
  const ctx = {
    name,
    args,
    emit: (evt: any) => { if (evt.type === 'approval_request') captured = evt },
    signal: undefined,
  } as any
  return { ctx, evt: () => captured }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-110] approval/humanConfirm 无响应自动拒 + hold() 接管')

  // ===== A. approval:无 hold → 超时自动拒 + onAutoReject 留痕 =====
  {
    const rejections: Array<{ toolName: string; waitedMs: number }> = []
    const mw = createApprovalMiddleware({ tools: ['write'], timeoutMs: 40, onAutoReject: (i) => rejections.push(i) })
    const { ctx: c, evt } = mkCaptureCtx('write', { jsonPath: 'a.b' })
    const p = mw.wrapToolCall!(c, async () => ({ content: '不应到达', status: 'done' as const }))
    await sleep(80) // 越过 deadline,无人 hold/resolve
    const r = await p
    assert(r.status === 'error' && /用户拒绝了 write/.test(String(r.content)), '✓ approval 超时自动拒 → error 结果(含工具名)')
    assert(rejections.length === 1 && rejections[0].toolName === 'write' && rejections[0].waitedMs >= 40, `✓ onAutoReject 留痕一次(toolName/waitedMs≥超时值,实得 ${rejections[0]?.waitedMs})`)
    assert(evt() !== undefined, '✓ approval_request 事件已发出(未被应答)')
  }

  // ===== B. approval:hold() 接管 → 计时取消;用户后置 resolve(true) → 放行执行 =====
  {
    const rejections: unknown[] = []
    const mw = createApprovalMiddleware({ tools: ['write'], timeoutMs: 40, onAutoReject: () => rejections.push(1) })
    const { ctx: c, evt } = mkCaptureCtx('write')
    const p = mw.wrapToolCall!(c, async () => ({ content: '工具已执行', status: 'done' as const }))
    evt()!.hold?.() // 响应方(UI)接管
    await sleep(80) // 越过原 deadline:不自动拒
    assert(rejections.length === 0, '✓ hold 接管后超时不触发(等用户不限时)')
    evt()!.resolve(true)
    const r = await p
    assert(r.status === 'done' && r.content === '工具已执行', '✓ hold 后用户允许 → next() 正常执行')
  }

  // ===== C. approval:用户先收口 → 计时清理,deadline 后不误报 =====
  {
    const rejections: unknown[] = []
    const mw = createApprovalMiddleware({ tools: ['write'], timeoutMs: 40, onAutoReject: () => rejections.push(1) })
    const { ctx: c, evt } = mkCaptureCtx('write')
    const p = mw.wrapToolCall!(c, async () => ({ content: 'x', status: 'done' as const }))
    evt()!.resolve(true) // 远早于 deadline
    await p
    await sleep(80)
    assert(rejections.length === 0, '✓ 用户先收口 → 计时已清,deadline 后 onAutoReject 不误报')
  }

  // ===== D. approval:abort 先于超时 → 自动拒但不走 onAutoReject(非超时路径)=====
  {
    const rejections: unknown[] = []
    const mw = createApprovalMiddleware({ tools: ['write'], timeoutMs: 40, onAutoReject: () => rejections.push(1) })
    const ac = new AbortController()
    let captured: CapturedEvt | undefined
    const c = { name: 'write', args: {}, emit: (e: any) => { if (e.type === 'approval_request') captured = e }, signal: ac.signal } as any
    const p = mw.wrapToolCall!(c, async () => ({ content: 'x', status: 'done' as const }))
    await sleep(10)
    ac.abort()
    const r = await p
    assert(r.status === 'error', '✓ abort → 自动拒收口')
    void captured
    await sleep(60)
    assert(rejections.length === 0, '✓ abort 路径不触发 onAutoReject(留痕专属超时)')
  }

  // ===== E. approval:timeoutMs=0 → 无 hold 字段,永不自动拒 =====
  {
    const mw = createApprovalMiddleware({ tools: ['write'], timeoutMs: 0 })
    const { ctx: c, evt } = mkCaptureCtx('write')
    const p = mw.wrapToolCall!(c, async () => ({ content: 'x', status: 'done' as const }))
    assert(evt()?.hold === undefined, '✓ timeoutMs=0 → 事件不携带 hold(无计时器)')
    await sleep(60)
    evt()!.resolve(true)
    const r = await p
    assert(r.status === 'done', '✓ timeoutMs=0 → 60ms 无人应答仍不自动拒(显式关,等用户)')
  }

  // ===== A'. humanConfirm:无 hold → 超时视同拒绝 + onAutoReject =====
  {
    const rejections: Array<{ toolName: string }> = []
    const mw = createHumanConfirmMiddleware(undefined, { timeoutMs: 40, onAutoReject: (i) => rejections.push(i) })
    const { ctx: c, evt } = mkCaptureCtx(HUMAN_CONFIRM_TOOL_NAME, { question: '用方案 A?' })
    const p = mw.wrapToolCall!(c, async () => ({ content: '不应到达', status: 'done' as const }))
    await sleep(80)
    const r = await p
    assert(r.status === 'done' && /用户拒绝了该方案/.test(String(r.content)), '✓ humanConfirm 超时 → 视同拒绝回灌(停止操作文案)')
    assert(rejections.length === 1 && rejections[0].toolName === HUMAN_CONFIRM_TOOL_NAME, '✓ humanConfirm onAutoReject 留痕(与 approval 同口径)')
  }

  // ===== B'. humanConfirm:hold 接管 → 用户选方案收口,超时不触发 =====
  {
    const rejections: unknown[] = []
    const mw = createHumanConfirmMiddleware(undefined, { timeoutMs: 40, onAutoReject: () => rejections.push(1) })
    const { ctx: c, evt } = mkCaptureCtx(HUMAN_CONFIRM_TOOL_NAME, { question: '用哪个?', options: ['A', 'B'] })
    const p = mw.wrapToolCall!(c, async () => ({ content: 'x', status: 'done' as const }))
    evt()!.hold?.()
    await sleep(80)
    evt()!.resolve('A')
    const r = await p
    assert(r.status === 'done' && /用户选择了:A/.test(String(r.content)), '✓ humanConfirm hold 后用户选方案 → 正常收口')
    assert(rejections.length === 0, '✓ humanConfirm hold 接管 → 超时不触发')
  }
}
