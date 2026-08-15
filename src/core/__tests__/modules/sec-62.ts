/**
 * sec-62:agent-driven-compression Phase A(触发预检 + 决策 schema 纯函数)
 * shouldTriggerCompression(token/轮数两模式阈值判定 + 边界)+ CompressDecisionSchema 合法/非法。
 */
import type { TestCtx } from './_ctx'
import { groupRounds } from '../../utils/rounds'
import { shouldTriggerCompression, resolvePromptSoftCap, DEFAULT_PROMPT_SOFT_CAP } from '../../composables/contextIndex'
import { CompressDecisionSchema } from '../../sdk/compressDecision'
import type { AgentMessage } from '../../types'

const msg = (role: 'user' | 'assistant', content: string): AgentMessage =>
  ({ role, content, timestamp: 0 }) as AgentMessage

function makeRounds(n: number): AgentMessage[] {
  const arr: AgentMessage[] = []
  for (let i = 0; i < n; i++) {
    arr.push(msg('user', `第${i}个问题需要详细的业务上下文说明`))
    arr.push(msg('assistant', `第${i}个回答包含具体操作步骤`))
  }
  return arr
}

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // ===== shouldTriggerCompression token 模式 =====
  const tokenRounds = groupRounds(makeRounds(2))
  assert(shouldTriggerCompression(tokenRounds, { contextWindow: 10, summaryThresholdRatio: 0.5 }) === true, '✓ shouldTrigger token 模式 → 超 threshold(contextWindow=10/ratio=0.5)触发')
  assert(shouldTriggerCompression(tokenRounds, { contextWindow: 1000000, summaryThresholdRatio: 0.5 }) === false, '✓ shouldTrigger token 模式 → 远未达 threshold 不触发')

  // ===== shouldTriggerCompression 轮数模式(严格 >)=====
  assert(shouldTriggerCompression(groupRounds(makeRounds(4)), { summaryThresholdRounds: 3 }) === true, '✓ shouldTrigger 轮数模式 → 4 > 3 触发')
  assert(shouldTriggerCompression(groupRounds(makeRounds(3)), { summaryThresholdRounds: 3 }) === false, '✓ shouldTrigger 轮数模式 → 3 = 3 不触发(严格 >)')
  assert(shouldTriggerCompression(groupRounds(makeRounds(2)), { summaryThresholdRounds: 3 }) === false, '✓ shouldTrigger 轮数模式 → 2 < 3 不触发')

  // ===== 模式选择(contextWindow=0 / undefined 走轮数)=====
  assert(shouldTriggerCompression(groupRounds(makeRounds(4)), { contextWindow: 0, summaryThresholdRounds: 3 }) === true, '✓ shouldTrigger contextWindow=0 → 走轮数模式触发')
  assert(shouldTriggerCompression(groupRounds(makeRounds(4)), { summaryThresholdRounds: 3 }) === true, '✓ shouldTrigger contextWindow 未传 → 走轮数模式触发')

  // ===== 默认阈值(轮数默认 8 / ratio 默认 0.5)=====
  assert(shouldTriggerCompression(groupRounds(makeRounds(9)), {}) === true, '✓ shouldTrigger 轮数默认阈值 8 → 9 > 8 触发')
  assert(shouldTriggerCompression(groupRounds(makeRounds(8)), {}) === false, '✓ shouldTrigger 轮数默认阈值 8 → 8 = 8 不触发')

  // ===== promptSoftCapTokens 成本维度(context-economy-phase2 阶段 A)=====
  // 解析层:大窗口默认 160K 参与 / 小窗口不参与 / 显式覆盖 / 显式 0 关
  assert(resolvePromptSoftCap(1_000_000) === DEFAULT_PROMPT_SOFT_CAP, '✓ resolvePromptSoftCap → 窗口 ≥320K 默认 softCap 160K 参与')
  assert(resolvePromptSoftCap(200_000) === Number.POSITIVE_INFINITY, '✓ resolvePromptSoftCap → 窗口 <320K 未传不参与(小窗口 ratio 仍先生效)')
  assert(resolvePromptSoftCap(1_000_000, 50_000) === 50_000, '✓ resolvePromptSoftCap → 显式值覆盖默认')
  assert(resolvePromptSoftCap(1_000_000, 0) === Number.POSITIVE_INFINITY, '✓ resolvePromptSoftCap → 显式 0 关闭(一键回退)')
  // 触发层:min(ratio 阈值, softCap) 取更紧者;1500 token 场景
  const bigRounds = groupRounds([msg('user', '问'.repeat(600)), msg('assistant', '答'.repeat(400))])  // ~1500 token(CJK 1.5/字)
  assert(shouldTriggerCompression(bigRounds, { contextWindow: 1_000_000, summaryThresholdRatio: 0.5, promptSoftCapTokens: 1000 }) === true, '✓ shouldTrigger softCap → 显式 1000 更紧于 ratio 500K,1500 > 1000 触发(提前压缩)')
  assert(shouldTriggerCompression(bigRounds, { contextWindow: 1_000_000, summaryThresholdRatio: 0.5, promptSoftCapTokens: 0 }) === false, '✓ shouldTrigger softCap → 显式 0 关,1500 < 500K 不触发(回退原行为)')
  assert(shouldTriggerCompression(bigRounds, { contextWindow: 1_000_000, summaryThresholdRatio: 0.001 }) === true, '✓ shouldTrigger softCap → 默认不干扰小 ratio(ratio 阈值 1000 更紧,1500 > 1000 触发)')

  // ===== CompressDecisionSchema 合法 =====
  assert(CompressDecisionSchema.safeParse({ keepRounds: 3, summarize: { mode: 'llm' } }).success === true, '✓ schema → keepRounds + mode 合法通过')
  assert(CompressDecisionSchema.safeParse({ windowRatio: 0.4, summarize: { mode: 'index' } }).success === true, '✓ schema → windowRatio + mode 合法通过')
  assert(CompressDecisionSchema.safeParse({ keepRounds: 0, windowRatio: 0.5, summarize: { mode: 'llm' }, recallTopK: 5, preserveTools: ['read'], reason: '省上下文' }).success === true, '✓ schema → 全字段合法通过')

  // ===== CompressDecisionSchema 非法拒绝 =====
  assert(CompressDecisionSchema.safeParse({ keepRounds: -1, summarize: { mode: 'llm' } }).success === false, '✓ schema → keepRounds 负数拒(min 0)')
  assert(CompressDecisionSchema.safeParse({ keepRounds: 51, summarize: { mode: 'llm' } }).success === false, '✓ schema → keepRounds 超 50 拒(max 50)')
  assert(CompressDecisionSchema.safeParse({ windowRatio: 1.5, summarize: { mode: 'llm' } }).success === false, '✓ schema → windowRatio 超 1 拒(max 1)')
  assert(CompressDecisionSchema.safeParse({ keepRounds: 3, summarize: { mode: 'bad' } }).success === false, '✓ schema → mode 非枚举值拒')
  assert(CompressDecisionSchema.safeParse({ keepRounds: 3 }).success === false, '✓ schema → summarize 缺拒')
  assert(CompressDecisionSchema.safeParse({ summarize: { mode: 'llm' } }).success === false, '✓ schema → keepRounds/windowRatio 都空 refine 拒')
  assert(CompressDecisionSchema.safeParse({ keepRounds: 3, summarize: { mode: 'llm' }, recallTopK: 11 }).success === false, '✓ schema → recallTopK 超 10 拒')
  assert(CompressDecisionSchema.safeParse({ keepRounds: 3, summarize: { mode: 'llm' }, preserveTools: Array(11).fill('x') }).success === false, '✓ schema → preserveTools 超 10 拒')
  assert(CompressDecisionSchema.safeParse({ keepRounds: 3, summarize: { mode: 'llm' }, reason: 'x'.repeat(201) }).success === false, '✓ schema → reason 超 200 拒')
  assert(CompressDecisionSchema.safeParse({ keepRounds: '3', summarize: { mode: 'llm' } }).success === false, '✓ schema → keepRounds 字符串类型拒(number 不 coerce)')
  assert(CompressDecisionSchema.safeParse({ keepRounds: 3, summarize: null }).success === false, '✓ schema → summarize=null 拒')
}
