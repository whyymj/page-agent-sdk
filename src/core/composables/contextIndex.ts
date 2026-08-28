/**
 * 上下文索引纯函数 —— 从 useContextManager.ts 抽离(refactor-module-extraction 期二)。
 * 含停用词 / 分词 / token 估算 / 索引摘要 / 关键词召回。纯函数无状态、易白盒测。
 */
import type { AgentMessage } from '../types'
import { plainSummary, type Round } from '../utils/rounds'
import { estimateTokens } from '../utils/modelCaps'

/** 中文停用词，召回时过滤 */
export const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '这', '那', '和', '与',
  '及', '或', '一个', '什么', '怎么', '如何', '为什么', '可以', '能', '请', '帮',
  '一下', '需要', '想要', 'the', 'a', 'an', 'is', 'are', 'of', 'to', 'in', 'on',
])

/** 分词：按非字母数字字符切分，保留长度>=2 且非停用词的 token */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9一-龥]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
}

/** 估算单条消息 token(content + reasoning + 工具步骤的 args/result) */
export function estimateMessageTokens(m: AgentMessage): number {
  let s = typeof m.content === 'string' ? m.content : ''
  if (m.reasoning) s += m.reasoning
  if (m.steps) {
    for (const st of m.steps) {
      s += ' ' + (st.name || '')
      if (st.args != null) s += ' ' + (typeof st.args === 'string' ? st.args : JSON.stringify(st.args))
      if (st.result) s += ' ' + st.result
    }
  }
  return estimateTokens(s)
}

/** 估算一轮 token(user + 所有 assistant 消息) */
export function estimateRoundTokens(r: Round): number {
  let t = estimateMessageTokens(r.userMsg)
  for (const m of r.assistantMsgs) t += estimateMessageTokens(m)
  return t
}

/** 用索引摘要（零成本）生成旧轮次摘要文本 */
export function indexSummarize(older: Round[], preserve?: Set<string>): string {
  return older
    .map((r) => {
      const q = plainSummary(r.userMsg.content, 60) || '(空)'
      const a = r.assistantMsgs[0] ? plainSummary(r.assistantMsgs[0].content, 80) : '(无回复)'
      const tools = r.assistantMsgs.flatMap((m) => (m.steps || []).map((s) => s.name))
      const toolTag = tools.length ? ` [工具: ${tools.join(', ')}]` : ''
      // C:对 preserve 集合内的工具,额外保留其 result 摘要(防字段描述被摘要掉)
      let preserveBlock = ''
      if (preserve && preserve.size) {
        const kept: string[] = []
        for (const m of r.assistantMsgs) {
          for (const st of m.steps || []) {
            if (st.name && preserve.has(st.name) && st.result) {
              kept.push(`${st.name}: ${plainSummary(st.result, 120)}`)
            }
          }
        }
        if (kept.length) preserveBlock = `\n  字段提示: ${kept.join(' | ')}`
      }
      return `- 第${r.round}轮：${q} → ${a}${toolTag}${preserveBlock}`
    })
    .join('\n')
}

/** 关键词召回：按当前问题匹配旧轮次，返回最相关的 Top-K */
export function recallRounds(older: Round[], query: string, topK: number): Round[] {
  const keywords = tokenize(query)
  if (keywords.length === 0) return []
  const scored = older.map((r) => {
    const hay = (
      r.userMsg.content +
      ' ' +
      r.assistantMsgs.map((m) => m.content).join(' ') +
      // 召回纳入工具结果(解 B2:让「之前 read/query 出来的 X」能被关键词召回;plainSummary 截断防大 result 撑爆匹配串)
      ' ' +
      r.assistantMsgs
        .flatMap((m) => (m.steps || []).map((st) => plainSummary(st.result || '', 120)))
        .join(' ')
    ).toLowerCase()
    let score = 0
    for (const kw of keywords) {
      if (hay.includes(kw)) score++
    }
    return { r, score }
  })
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => s.r)
}

/** 触发预检所需配置(useContextManager 传 config 对象,结构兼容;解耦不引 ContextManagerOptions 防循环依赖) */
export interface CompressionTriggerConfig {
  contextWindow?: number
  summaryThresholdRatio?: number
  summaryThresholdRounds?: number
  /** prompt 软上限(token):成本维度触发上界;解析规则见 resolvePromptSoftCap */
  promptSoftCapTokens?: number
}

/** softCap 默认参与门槛:窗口 ≥320K 的大窗口模型才默认启用(常规窗口 ratio 阈值仍先生效,零变化) */
export const SOFT_CAP_MIN_WINDOW = 320_000
/** 默认 softCap:超大窗口(flash/v4 档 1M)下 ratio×window=500K 才首压、prompt 成本线性膨胀;160K 留 16× 常规会话余量(真 LLM 复测校准,非契约值) */
export const DEFAULT_PROMPT_SOFT_CAP = 160_000
/** ≥1M 窗口模型的软上限(2026-08-28 抬升:生产 1M 模型长会话 160K 过早触发压缩;成本换复杂任务跑道) */
export const LARGE_WINDOW_PROMPT_SOFT_CAP = 320_000

/**
 * 解析有效 softCap(纯函数,单一真源;供触发判断 + 消耗提示 C1 共用):
 * - 显式 promptSoftCapTokens > 0 → 该值(覆盖默认)
 * - 显式 0 → Infinity(显式关,一键回退)
 * - 未传 + 窗口 ≥320K → 默认 160K
 * - 未传 + 小窗口 → Infinity(不参与)
 */
export function resolvePromptSoftCap(contextWindow?: number, promptSoftCapTokens?: number): number {
  if (promptSoftCapTokens != null) return promptSoftCapTokens > 0 ? promptSoftCapTokens : Infinity
  if (contextWindow && contextWindow >= SOFT_CAP_MIN_WINDOW) {
    // 窗口自适应:≥1M(生产大窗口 fleet)→ 320K;320K~1M → 160K
    return contextWindow >= 1_000_000 ? LARGE_WINDOW_PROMPT_SOFT_CAP : DEFAULT_PROMPT_SOFT_CAP
  }
  return Infinity
}

/**
 * 压缩触发预检(纯函数):是否已达压缩阈值(agent-driven-compression §1 HIGH)。
 * - token 模式(contextWindow>0):历史估算 token > min(contextWindow * summaryThresholdRatio, softCap)(context-economy-phase2:softCap 成本维度,与 ratio 阈值同为上界取更紧者)
 * - 轮数模式:轮数 > summaryThresholdRounds(默认 8,严格 >)
 * 单一真源:compressInput 的 decide 前置 gate + compress() 内部触发判断共用,
 * 避免「开启 agentCompression 后每条消息都 decide 烧 1~2 次 LLM 调用」(design §1 HIGH)。
 */
export function shouldTriggerCompression(rounds: Round[], config: CompressionTriggerConfig): boolean {
  if (config.contextWindow && config.contextWindow > 0) {
    const totalTokens = rounds.reduce((s, r) => s + estimateRoundTokens(r), 0)
    const threshold = Math.min(
      config.contextWindow * (config.summaryThresholdRatio ?? 0.5),
      resolvePromptSoftCap(config.contextWindow, config.promptSoftCapTokens),
    )
    return totalTokens > threshold
  }
  return rounds.length > (config.summaryThresholdRounds ?? 8)
}
