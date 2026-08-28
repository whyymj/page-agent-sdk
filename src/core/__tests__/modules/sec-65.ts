/**
 * sec-65:agent-driven-compression Phase D(compress 决策改造)
 * 决策驱动切分(keepRounds/windowRatio)+ 召回 recallTopK + preserve 并集 + 摘要 mode +
 * 下界/older 空早退 + 决策注记 + stats.decision + 无决策回退静态(零变化)。
 */
import type { TestCtx } from './_ctx'
import { useContextManager } from '../../composables/useContextManager'
import type { CompressDecision } from '../../sdk/compressDecision'
import type { AgentMessage } from '../../types'

/* eslint-disable @typescript-eslint/no-explicit-any */
const msg = (role: string, content: string, steps?: any[]): AgentMessage =>
  ({ role, content, timestamp: 0, steps }) as AgentMessage
function makeRounds(n: number, withSteps = false): AgentMessage[] {
  const arr: AgentMessage[] = []
  for (let i = 0; i < n; i++) {
    arr.push(msg('user', `第${i}个问题需要详细的业务背景说明和技术上下文`))
    arr.push(msg('assistant', `第${i}个回复包含完整的操作步骤和工具执行结果说明`, withSteps ? [{ name: 'read', result: `数据片段${i}` }] : undefined))
  }
  return arr
}
const contentOf = (m: AgentMessage): string => (typeof m.content === 'string' ? m.content : '')
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // ===== 轮数模式:无决策静态 vs decision keepRounds 切分 =====
  const ctxM = useContextManager({ summaryThresholdRounds: 3, windowRounds: 6 })
  const messages = makeRounds(10)
  const r0 = await ctxM.compress(messages)
  assert(r0.stats.triggered && r0.stats.roundsSummarized === 4, '✓ 无决策(轮数)→ 静态 windowRounds=6 切分(older 4)')
  assert(r0.stats.decision === undefined, '✓ 无决策 → stats.decision undefined(向后兼容)')
  assert(!/压缩决策/.test(contentOf(r0.messages[0])), '✓ 无决策 → summaryMsg 不含决策注记(零变化)')

  const d2: CompressDecision = { keepRounds: 2, summarize: { mode: 'index' } }
  const r1 = await ctxM.compress(messages, d2)
  assert(r1.stats.roundsSummarized === 8, '✓ decision keepRounds=2 → older 8(切分受决策覆盖)')
  assert(r1.stats.decision === d2, '✓ stats 含 decision')
  assert(/压缩决策/.test(contentOf(r1.messages[0])), '✓ summaryMsg 含「压缩决策」注记')
  assert(/keepRounds=2/.test(contentOf(r1.messages[0])), '✓ 决策注记含 keepRounds')

  // ===== keepRounds 下界(0→1)+ older 空早退(轮数模式补早退)=====
  const r2 = await ctxM.compress(messages, { keepRounds: 0, summarize: { mode: 'index' } })
  assert(r2.stats.roundsSummarized === 9, '✓ decision keepRounds=0 → 下界 1(older 9,防贪省恒全压)')
  const r3 = await ctxM.compress(makeRounds(5), { keepRounds: 10, summarize: { mode: 'index' } })
  assert(!r3.stats.triggered, '✓ decision keepRounds>=总轮 → older 空 notTriggered(轮数模式补早退)')

  // ===== decision recallTopK=0 不召回(覆盖 enableRecall)=====
  const ctxR = useContextManager({ summaryThresholdRounds: 3, windowRounds: 3, enableRecall: true, recallTopK: 5 })
  const rr1 = await ctxR.compress(makeRounds(10), { keepRounds: 3, summarize: { mode: 'index' }, recallTopK: 0 })
  assert(rr1.stats.roundsRecalled === 0, '✓ decision recallTopK=0 → 不召回(覆盖 enableRecall)')

  // ===== decision preserveTools 并集(摘要含工具 result)=====
  const ctxP = useContextManager({ summaryThresholdRounds: 3, windowRounds: 3, preserveLastToolResults: ['schema_data'] })
  const rp = await ctxP.compress(makeRounds(10, true), { keepRounds: 3, summarize: { mode: 'index' }, preserveTools: ['read'] })
  assert(/数据片段/.test(contentOf(rp.messages[0])), '✓ decision preserveTools=[read] → 摘要含 read 工具 result(并集扩展)')

  // ===== token 模式:decision windowRatio =====
  const ctxT = useContextManager({ contextWindow: 2000, summaryThresholdRatio: 0.2, windowRatio: 0.4 })
  const big = makeRounds(40)
  const rt0 = await ctxT.compress(big)
  assert(rt0.stats.triggered, '✓ token 模式无决策 → 触发')
  const rt1 = await ctxT.compress(big, { windowRatio: 0.2, summarize: { mode: 'index' } })
  assert(rt1.stats.triggered && rt1.stats.decision !== undefined, '✓ token 模式 decision windowRatio → 触发 + stats 含 decision')
  assert(/windowRatio=0.2/.test(contentOf(rt1.messages[0])), '✓ token 模式决策注记含 windowRatio')

  // ===== decision summarize.mode=index(显式索引,第N轮格式)=====
  const ri = await ctxM.compress(messages, { keepRounds: 3, summarize: { mode: 'index' } })
  assert(/第\d+轮/.test(contentOf(ri.messages[0])), '✓ decision summarize.mode=index → 索引摘要(第N轮格式)')
}
