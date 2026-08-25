/**
 * Agent 配置 composable(complex-demo 专用)
 *
 * 从 .env 环境变量读取 Agent 配置,供 examples/complex-demo/App.vue 使用。
 * 独立于 SDK 核心(不依赖通用核心的类型)。
 * 优先 Anthropic 协议组(VITE_ANTHROPIC_*,经 vite 同源代理 /llm → modelverse,
 * 对齐 editor_fangzhou 真实用法);未配该组 key 时回退 OpenAI 兼容组(VITE_AI_*)。
 * 凭据只进 .env(gitignore),不进代码/仓库。
 */
export interface DemoAgentConfig {
  /** 'anthropic' = Claude 原生协议(动态 import @langchain/anthropic);缺省 OpenAI 兼容协议 */
  provider?: 'anthropic'
  apiKey: string
  baseUrl?: string
  model: string
  temperature: number
  maxTokens?: number
  systemPrompt?: string
}

/** 相对路径(如 /llm,走 vite dev 代理绕 CORS)补 location.origin 成绝对 URL —— openai/anthropic SDK 的 buildURL 直接 new URL(baseURL+path),相对路径抛 Invalid URL */
function absolutize(raw: string): string | undefined {
  return raw && raw.startsWith('/') ? `${location.origin}${raw}` : (raw || undefined)
}

export function useAgentConfig(): DemoAgentConfig {
  const anthropicKey = (import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined) || ''
  if (anthropicKey) {
    return {
      provider: 'anthropic',
      apiKey: anthropicKey,
      baseUrl: absolutize((import.meta.env.VITE_ANTHROPIC_BASE_URL as string | undefined) || '') ?? `${location.origin}/llm`,
      model: import.meta.env.VITE_ANTHROPIC_MODEL || 'deepseek-v4-flash',
      temperature: 0.3,
    }
  }
  return {
    apiKey: import.meta.env.VITE_AI_API_KEY || '',
    baseUrl: absolutize(import.meta.env.VITE_AI_BASE_URL || ''),
    model: import.meta.env.VITE_AI_MODEL || 'gpt-3.5-turbo',
    temperature: Number(import.meta.env.VITE_AI_TEMPERATURE) || 0.3,
    maxTokens: import.meta.env.VITE_AI_MAX_TOKENS ? Number(import.meta.env.VITE_AI_MAX_TOKENS) : undefined,
    systemPrompt: import.meta.env.VITE_AI_SYSTEM_PROMPT || undefined,
  }
}
