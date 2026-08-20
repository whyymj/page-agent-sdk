/**
 * sec-93 —— 方案确认留痕(save-and-plan-gates 3c:lastPlanConfirmation)
 *
 * 背景:editor prompt「已确认方案内删除不重复征询」纯提示词,无机制供给事实;
 * bulk-change-guard 豁免也需要「本会话已确认过方案」的可靠信号(不可被单组件删除确认烧掉)。
 *
 * A. onResolved 口径:带 options 且用户点选方案(string)→ 回调;允许(true)/拒绝(false)/无 options 不回调
 * B. 记录结构:{at, summary, choice, viaOptions:true};summary 截断 120
 * C. 回调抛错不影响确认流程(工具结果照常回 LLM)
 */
import type { TestCtx } from './_ctx'
import { createHumanConfirmMiddleware, HUMAN_CONFIRM_TOOL_NAME, type PlanConfirmationRecord } from '../../harness/humanConfirm'

/** 最小 ToolCallContext 桩:emit 收到 approval_request 时同步模拟用户点选(__choice) */
function mkCtx(args: Record<string, unknown>) {
  return {
    name: HUMAN_CONFIRM_TOOL_NAME,
    args,
    emit: (evt: { type: string; resolve: (c: boolean | string) => void }) => {
      if (evt.type === 'approval_request') evt.resolve((args as { __choice?: boolean | string }).__choice ?? true)
    },
    signal: undefined,
  } as any
}

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-93] 方案确认留痕:RHC 方案点选 → onResolved 记录(口径过滤)')

  // ===== A. 带 options 且点选方案 → 回调 =====
  {
    const records: PlanConfirmationRecord[] = []
    const mw = createHumanConfirmMiddleware((r) => records.push(r))
    const result = await mw.wrapToolCall!(mkCtx({
      question: '整页重建方案:保留哪些区块?',
      options: ['方案A:全保留', '方案B:只保留导航'],
      recommendation: '方案A',
      __choice: '方案B:只保留导航',
    }), async () => ({ content: 'should-not-run', status: 'done' as const }))
    assert(records.length === 1, '✓ 留痕口径 → 带 options 点选方案 → onResolved 触发一次')
    assert(records[0].viaOptions === true && records[0].choice === '方案B:只保留导航', '✓ 留痕口径 → 记录 choice=用户点选的方案')
    assert(typeof records[0].at === 'number' && records[0].summary.includes('整页重建'), '✓ 留痕口径 → 记录 at 时间戳 + question 摘要')
    assert(result?.content?.includes('方案B') === true, '✓ 确认流程 → 工具结果照常回传(onResolved 不干扰)')
  }

  // ===== B. 允许(true)不回调 =====
  {
    const records: PlanConfirmationRecord[] = []
    const mw = createHumanConfirmMiddleware((r) => records.push(r))
    await mw.wrapToolCall!(mkCtx({ question: '删除组件 X?', options: ['删', '不删'], __choice: true }), async () => ({ content: 'x', status: 'done' as const }))
    assert(records.length === 0, '✓ 留痕口径 → 允许(true)不记录(单组件确认不烧豁免)')
  }

  // ===== C. 拒绝(false)不回调 =====
  {
    const records: PlanConfirmationRecord[] = []
    const mw = createHumanConfirmMiddleware((r) => records.push(r))
    await mw.wrapToolCall!(mkCtx({ question: '删除?', options: ['删'], __choice: false }), async () => ({ content: 'x', status: 'done' as const }))
    assert(records.length === 0, '✓ 留痕口径 → 拒绝(false)不记录')
  }

  // ===== D. 无 options 的征询点选(string)不回调 =====
  {
    const records: PlanConfirmationRecord[] = []
    const mw = createHumanConfirmMiddleware((r) => records.push(r))
    await mw.wrapToolCall!(mkCtx({ question: '用哪个标题?', __choice: '标题一' }), async () => ({ content: 'x', status: 'done' as const }))
    assert(records.length === 0, '✓ 留痕口径 → 无 options 征询不记录(非方案确认)')
  }

  // ===== E. 回调抛错不影响确认流程 =====
  {
    const mw = createHumanConfirmMiddleware(() => { throw new Error('boom') })
    const result = await mw.wrapToolCall!(mkCtx({ question: '方案?', options: ['A', 'B'], __choice: 'A' }), async () => ({ content: 'x', status: 'done' as const }))
    assert(result?.content?.includes('A') === true, '✓ 健壮性 → onResolved 抛错被吞,确认流程不受影响')
  }

  // ===== F. summary 截断 120 =====
  {
    const records: PlanConfirmationRecord[] = []
    const mw = createHumanConfirmMiddleware((r) => records.push(r))
    const longQ = '方案说明'.repeat(100)
    await mw.wrapToolCall!(mkCtx({ question: longQ, options: ['A'], __choice: 'A' }), async () => ({ content: 'x', status: 'done' as const }))
    assert(records.length === 1 && records[0].summary.length <= 120, '✓ 健壮性 → question 摘要截断 120(防长文案膨胀)')
  }
}
