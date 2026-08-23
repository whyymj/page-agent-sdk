/**
 * 流式 chunk / 响应消息的内容提取 —— provider 兼容(OpenAI/DeepSeek vs Anthropic)
 *
 * 抽自 createAgent 流式循环,纯函数可单测(streaming 三处兼容是 Anthropic 开箱硬风险,单测保回归):
 * - `extractTextDelta`:文本 delta(OpenAI string content / Anthropic parts 数组 `{type:'text',text}`)
 * - `extractReasoningDelta`:推理 delta(DeepSeek `additional_kwargs.reasoning_content` / Anthropic parts `{type:'thinking',thinking}`)
 * - `extractUsage`:token 用量(OpenAI `additional_kwargs.usage` / Anthropic `response_metadata.usage`)
 * - `normalizeUsage`:原始 usage → TokenUsage 归一(camelCase 兼容;fix-main-sub-isolation:sdk-events 与子栈 sub-usage 共用)
 */
import type { AIMessageChunk, BaseMessage } from '@langchain/core/messages'
import type { TokenUsage } from '../types'

/** 从流式 chunk 提取文本 delta(兼容 OpenAI/DeepSeek string content 与 Anthropic parts 数组) */
export function extractTextDelta(chunk: AIMessageChunk): string {
  const c = (chunk as any).content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .map((p: any) => {
        if (typeof p === 'string') return p
        if (p?.type === 'text' && typeof p.text === 'string') return p.text
        return '' // thinking/tool_use/image 等非文本 part 跳过(reasoning 单独提取)
      })
      .join('')
  }
  return ''
}

/**
 * 从流式 chunk 提取推理 delta(reasoning / thinking)。
 * - DeepSeek/OpenAI:`additional_kwargs.reasoning_content`(或 `reasoning`)
 * - Anthropic:content parts 内 `{type:'thinking',thinking}` 或流式 `{type:'thinking_delta',delta}`
 */
export function extractReasoningDelta(chunk: AIMessageChunk): string {
  const ak: any = (chunk as any).additional_kwargs || {}
  let r = ak.reasoning_content || ak.reasoning || ''
  if (!r && Array.isArray((chunk as any).content)) {
    r = ((chunk as any).content as any[])
      .map((p: any) => {
        if (p?.type === 'thinking') return p.thinking ?? ''
        if (p?.type === 'thinking_delta') return p.delta ?? p.thinking ?? ''
        return ''
      })
      .join('')
  }
  return r
}

/**
 * 从响应消息提取 token usage。
 * - OpenAI/DeepSeek:`additional_kwargs.usage`
 * - Anthropic:流式聚合后标准字段 `usage_metadata`(input_tokens/output_tokens 命名);非流式 `response_metadata.usage`(部分版本 `token_usage`)
 *
 * 注:Anthropic 流式聚合消息的 `response_metadata.usage` 可能是**空对象 `{}`**(真 LLM 实测 modelverse),
 * 非空值(nullish 链会短路)→ 候选逐个校验「至少含一个 token 数值字段」,空对象跳过继续找。
 */
export function extractUsage(message: BaseMessage): any {
  const m = message as any
  const candidates = [
    m?.additional_kwargs?.usage,
    m?.usage_metadata,
    m?.response_metadata?.usage,
    m?.response_metadata?.token_usage,
    m?.response_metadata?.tokenUsage,
  ]
  for (const c of candidates) {
    if (c && typeof c === 'object' && hasTokenField(c as Record<string, unknown>)) return c
  }
  return undefined
}

/** usage 候选对象是否至少含一个 token 数值字段(prompt/completion/total 或 input/output 命名) */
function hasTokenField(u: Record<string, unknown>): boolean {
  const keys = ['prompt_tokens', 'completion_tokens', 'total_tokens', 'promptTokens', 'completionTokens', 'totalTokens', 'input_tokens', 'output_tokens', 'inputTokens', 'outputTokens']
  return keys.some((k) => typeof u[k] === 'number' && u[k] > 0)
}

/**
 * 原始 usage 对象 → 归一 TokenUsage(fix-main-sub-isolation P1-17a:sdk-events afterModel 与子栈 sub-usage 中间件共用,消重)。
 * 兼容 snake_case(prompt_tokens)与 camelCase(promptTokens);total 缺省取 prompt+completion;全 0/无效 → null。
 * prompt caching 字段(cache_read/cache_creation input tokens,Anthropic):顶层 snake/camel 与
 * usage_metadata.input_token_details(langchain 标准 details)两种形态都归一携带,供 llm.cacheControl 效果观测。
 */
export function normalizeUsage(message: BaseMessage): TokenUsage | null {
  const u = extractUsage(message)
  if (!u || typeof u !== 'object') return null
  const rec = u as Record<string, unknown>
  const p = Number(rec.prompt_tokens ?? rec.promptTokens ?? rec.input_tokens ?? rec.inputTokens ?? 0) || 0
  const c = Number(rec.completion_tokens ?? rec.completionTokens ?? rec.output_tokens ?? rec.outputTokens ?? 0) || 0
  const t = Number(rec.total_tokens ?? rec.totalTokens ?? (p + c)) || 0
  if (!p && !c && !t) return null
  // 缓存字段:Anthropic 顶层 snake(cache_read_input_tokens)与 langchain usage_metadata.input_token_details.cache_read 两种形态
  const details = rec.input_token_details as Record<string, unknown> | undefined
  const cacheRead = Number(rec.cache_read_input_tokens ?? rec.cacheReadInputTokens ?? details?.cache_read ?? 0) || 0
  const cacheCreate = Number(rec.cache_creation_input_tokens ?? rec.cacheCreationInputTokens ?? details?.cache_creation ?? 0) || 0
  // reasoning token(reasoning-tokens-observability):langchain 标准 usage_metadata.output_token_details.reasoning(@langchain/openai 双路径映射)
  // 与原始 completion_tokens_details.reasoning_tokens(OpenAI/DeepSeek additional_kwargs/response_metadata.usage)两种形态;Anthropic 依赖栈不产出则省略
  const outDetails = rec.output_token_details as Record<string, unknown> | undefined
  const rawDetails = rec.completion_tokens_details as Record<string, unknown> | undefined
  const m = message as { response_metadata?: { usage?: { completion_tokens_details?: { reasoning_tokens?: unknown } } } }
  const reasoning = Number(outDetails?.reasoning ?? rawDetails?.reasoning_tokens ?? m?.response_metadata?.usage?.completion_tokens_details?.reasoning_tokens ?? 0) || 0
  return {
    prompt_tokens: p, completion_tokens: c, total_tokens: t,
    ...(cacheRead ? { cache_read_input_tokens: cacheRead } : {}),
    ...(cacheCreate ? { cache_creation_input_tokens: cacheCreate } : {}),
    ...(reasoning ? { reasoning_tokens: reasoning } : {}),
  }
}
