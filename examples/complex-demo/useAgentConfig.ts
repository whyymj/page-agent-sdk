/**
 * Agent 配置 composable(complex-demo 专用)
 *
 * 从 .env 环境变量读取 Agent 配置,供 examples/complex-demo/App.vue 使用。
 * 独立于 SDK 核心(不依赖通用核心的类型)。
 */
export interface DemoAgentConfig {
  apiKey: string
  baseUrl?: string
  model: string
  temperature: number
  maxTokens?: number
  systemPrompt?: string
}

export function useAgentConfig(): DemoAgentConfig {
  const rawBase = import.meta.env.VITE_AI_BASE_URL || ''
  return {
    apiKey: import.meta.env.VITE_AI_API_KEY || '',
    // 相对路径(如 /llm/v1,走 vite dev 代理绕 CORS)补 location.origin 成绝对 URL ——
    // openai/anthropic SDK 的 buildURL 直接 new URL(baseURL+path),相对路径抛 Invalid URL
    baseUrl: rawBase && rawBase.startsWith('/') ? `${location.origin}${rawBase}` : (rawBase || undefined),
    model: import.meta.env.VITE_AI_MODEL || 'gpt-3.5-turbo',
    temperature: Number(import.meta.env.VITE_AI_TEMPERATURE) || 0.3,
    maxTokens: import.meta.env.VITE_AI_MAX_TOKENS ? Number(import.meta.env.VITE_AI_MAX_TOKENS) : undefined,
    systemPrompt: import.meta.env.VITE_AI_SYSTEM_PROMPT || undefined,
  }
}
