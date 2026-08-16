/**
 * LLM 构造工厂 —— 按 provider 分支收口(Anthropic 开箱支持)。
 *
 * - `openai`(默认,向后兼容):同步 `new ChatOpenAI`(兼容 OpenAI/DeepSeek 协议)
 * - `anthropic`:动态 `import('@langchain/anthropic')` + `new ChatAnthropic`(走 Claude 原生协议)
 *
 * 动态 import 复用 MCP 模式(optional peerDep;不用 Anthropic 时不加载,不强求集成方安装)。
 * `constructLlmFromConfig` 是 async(承载 Anthropic 动态 import):
 *   - 主 LLM 走 `createChatSdk` 的 `initDone`(async IIFE)零破坏
 *   - summaryLlm/titleLlm 走 lazy 构造(首次 invoke 时 await,保 `resolveLlm` 同步签名)
 *
 * `constructOpenLlmSync`(同步 openai 分支)供 `setLlm`(同步契约)使用 ——
 * setLlm 切 Anthropic 需传 BaseChatModel 实例(动态 import 无法同步,实例路径天然支持任意 provider)。
 */
import { ChatOpenAI } from '@langchain/openai'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { LLMConfig } from '../sdk/createChatSdk'

/** 构造选项:覆盖 LLMConfig 的 temperature/maxTokens(summary/title 用不同值) */
export interface ConstructOpts {
  temperature?: number
  maxTokens?: number
}

/**
 * 默认 fetch 包装:剥离 openai SDK 自动附加的 `x-stainless-*` 遥测头。
 * 这些头是纯遥测(无功能影响),但严格 CORS 的 OpenAI 兼容代理(如企业网关)白名单常不含它们
 * → 浏览器预检直接失败(ERR_FAILED);默认剥离换开箱兼容(真 LLM 实测:严格 CORS 网关被此头卡死)。
 * 集成方 extraConfig.fetch 在其后展开,可整体覆盖。
 * 导出共享:createAgent 的散字段兜底构造同样注入(子 agent 路径;真 LLM 抓包实测子 agent 重新构造丢包装)。
 */
export function stripStainlessFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  if (init?.headers) {
    const h = new Headers(init.headers as HeadersInit)
    let touched = false
    for (const k of [...h.keys()]) {
      if (k.toLowerCase().startsWith('x-stainless')) {
        h.delete(k)
        touched = true
      }
    }
    if (touched) init = { ...init, headers: h }
  }
  return fetch(url, init)
}

/**
 * baseUrl 容错归一:相对路径(如 '/llm/v1',浏览器端经 vite/网关同源代理绕 CORS 的官方推荐用法)补 location.origin
 * 成绝对 URL —— openai/anthropic SDK 的 buildURL 直接 new URL(baseURL+path),相对路径抛 Invalid URL(整个会话不可用)。
 * 纯函数;非浏览器环境 / 已是绝对路径原样返回。
 */
export function normalizeBaseUrl(baseUrl: string | undefined): string | undefined {
  if (!baseUrl || !baseUrl.startsWith('/')) return baseUrl
  if (typeof location === 'undefined' || !location.origin) return baseUrl  // SSR/Node:无 origin 可补,原样(由调用方抛错)
  return `${location.origin}${baseUrl}`
}

/**
 * 同步构造 OpenAI 协议 LLM(供 setLlm 等同步契约场景)。
 * 仅 openai 分支;Anthropic 无同步构造(动态 import 本质 async)。
 */
export function constructOpenLlmSync(cfg: LLMConfig, opts: ConstructOpts = {}): BaseChatModel {
  return new ChatOpenAI({
    apiKey: cfg.apiKey,
    model: cfg.model,
    temperature: opts.temperature ?? cfg.temperature,
    maxTokens: opts.maxTokens ?? cfg.maxTokens,
    configuration: {
      ...(cfg.baseUrl ? { baseURL: normalizeBaseUrl(cfg.baseUrl) } : {}),
      fetch: stripStainlessFetch,
      ...cfg.extraConfig,  // 集成方 fetch/headers 等覆盖默认(含整体替换 fetch)
    },
    ...(cfg.extraBody ? { modelKwargs: cfg.extraBody } : {}),
  })
}

/**
 * 按 provider 分支构造 LLM(openai 同步 / anthropic 动态 import)。
 * 缺省 provider → openai(向后兼容)。
 *
 * Anthropic 注:`extraBody`(OpenAI modelKwargs 语义,如 DeepSeek thinking)不通用 ——
 * Claude extended thinking 走 ChatAnthropic 的 `thinking` 字段(非请求 body 额外参数),
 * 故 extraBody 不透传;集成方需 thinking 时用预构造 ChatAnthropic 实例(`llm: new ChatAnthropic({ thinking: {...} })`)。
 */
export async function constructLlmFromConfig(cfg: LLMConfig, opts: ConstructOpts = {}): Promise<BaseChatModel> {
  const provider = cfg.provider ?? 'openai'
  if (provider === 'openai') return constructOpenLlmSync(cfg, opts)

  // anthropic:动态 import(optional peerDep;不用时不加载)
  const { ChatAnthropic } = await import('@langchain/anthropic')
  return new ChatAnthropic({
    apiKey: cfg.apiKey,
    model: cfg.model,
    temperature: opts.temperature ?? cfg.temperature,
    maxTokens: opts.maxTokens ?? cfg.maxTokens,
    // anthropicApiUrl = baseUrl(Anthropic SDK 的 baseURL 别名);clientOptions 透传 extraConfig(fetch/headers 等)
    ...(cfg.baseUrl ? { anthropicApiUrl: normalizeBaseUrl(cfg.baseUrl) } : {}),
    ...(cfg.extraConfig ? { clientOptions: cfg.extraConfig } : {}),
    // prompt caching:走 invocationKwargs 透传顶层 cache_control(服务端自动在最后一个可缓存块打断点并随对话推进,
    // ReAct 多轮前缀命中 input 价格 ~1/10)。注:不能走构造器顶层 cache_control 字段 —— 实测 @langchain/anthropic
    // 1.5.4 只消费「调用时 options.cache_control」,构造字段不进请求体;invocationKwargs 直接展开进 body 且
    // 显式 cache_control:undefined 在 JSON 序列化被丢弃,不会覆盖。true=ephemeral(5m);'1h'=长 TTL
    ...(cfg.cacheControl
      ? {
          invocationKwargs: {
            cache_control: { type: 'ephemeral' as const, ...(cfg.cacheControl !== true ? { ttl: cfg.cacheControl } : {}) },
          },
        }
      : {}),
  })
}
