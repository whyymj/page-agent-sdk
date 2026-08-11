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
 * - Anthropic:`response_metadata.usage`(部分版本 `response_metadata.token_usage`)
 */
export function extractUsage(message: BaseMessage): any {
  const m = message as any
  return m?.additional_kwargs?.usage ?? m?.response_metadata?.usage ?? m?.response_metadata?.token_usage ?? m?.response_metadata?.tokenUsage ?? undefined
}

/**
 * 原始 usage 对象 → 归一 TokenUsage(fix-main-sub-isolation P1-17a:sdk-events afterModel 与子栈 sub-usage 中间件共用,消重)。
 * 兼容 snake_case(prompt_tokens)与 camelCase(promptTokens);total 缺省取 prompt+completion;全 0/无效 → null。
 */
export function normalizeUsage(message: BaseMessage): TokenUsage | null {
  const u = extractUsage(message)
  if (!u || typeof u !== 'object') return null
  const rec = u as Record<string, unknown>
  const p = Number(rec.prompt_tokens ?? rec.promptTokens ?? 0) || 0
  const c = Number(rec.completion_tokens ?? rec.completionTokens ?? 0) || 0
  const t = Number(rec.total_tokens ?? rec.totalTokens ?? (p + c)) || 0
  if (!p && !c && !t) return null
  return { prompt_tokens: p, completion_tokens: c, total_tokens: t }
}
