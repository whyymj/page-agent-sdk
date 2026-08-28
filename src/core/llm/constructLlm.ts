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
import { resolveModelCaps, tableMaxOutputTokens } from '../utils/modelCaps'

/** 构造选项:覆盖 LLMConfig 的 temperature/maxTokens(summary/title 用不同值);thinkingMode 显式锁定思考深度 */
export interface ConstructOpts {
  temperature?: number
  maxTokens?: number
  /** 显式思考深度(子 agent 链路透传 / summary-title 传 'simple' 免思考);缺省走默认 deep 解析 */
  thinkingMode?: ThinkingMode
  /** 思考深度兜底(仅在所有显式配置缺省时生效,压过能力表默认):summary/title/decide 传 'simple' 免思考省 token */
  thinkingFallback?: ThinkingMode
}

/** 思考深度锁定模式(subagent-thinking-mode-lock):simple=剥思考参数 / deep=注入思考参数 */
export type ThinkingMode = 'simple' | 'deep'

/**
 * 思考深度改写(subagent-thinking-mode-lock 核心纯函数,可单测):
 * 按 provider 把 thinkingMode 落到 LLM 配置上,**不 mutate 原 config**(深拷贝 extraBody)。
 *  - OpenAI 兼容(deepseek 等):`extraBody.thinking` 键 —— simple 剥除 / deep 注入 `{type:'enabled'}`(保留已有子键如 budget)
 *  - Anthropic:顶层 `thinking` 字段(ChatAnthropic 构造参数)—— simple 剥除 / deep 注入
 *    `{type:'enabled', budget_tokens}`(显式已配不覆盖;缺省 budget = min(maxTokens ?? 8000, 8000))
 *  - mode 未设 → 原样返回(同引用,零开销)
 * 与 createChatSdk 的 LLMConfig / harness 的 SubagentLlmConfig 结构兼容(鸭子类型,不 import 防环)。
 */
export function applyThinkingMode<C extends { provider?: string; maxTokens?: number; extraBody?: Record<string, unknown>; thinking?: { type: 'enabled'; budget_tokens?: number } }>(
  cfg: C,
  mode?: ThinkingMode,
): C {
  if (!mode) return cfg
  if (mode === 'simple') {
    const hasOpenAiThinking = cfg.extraBody && 'thinking' in cfg.extraBody
    if (!hasOpenAiThinking && !cfg.thinking) return cfg // 无思考参数可剥,原样
    const { thinking: _omit, ...restCfg } = cfg
    const next = restCfg as C
    if (hasOpenAiThinking) {
      const { thinking: _drop, ...restBody } = cfg.extraBody!
      next.extraBody = restBody
    }
    return next
  }
  // deep
  if (cfg.provider === 'anthropic') {
    if (cfg.thinking?.type === 'enabled' && cfg.thinking.budget_tokens) return cfg // 已显式配,不覆盖
    const budget = cfg.thinking?.budget_tokens ?? Math.min(cfg.maxTokens ?? 8000, 8000)  // 缺省即上限(复杂思考场景);maxTokens 已设则以它为预算
    return { ...cfg, thinking: { type: 'enabled', budget_tokens: budget } }
  }
  const cur = (cfg.extraBody?.thinking ?? {}) as Record<string, unknown>
  return { ...cfg, extraBody: { ...(cfg.extraBody ?? {}), thinking: { ...cur, type: 'enabled' } } }
}

/**
 * 默认思考深度(default-deep-thinking,质量优先):集成方零配置时按模型能力表注入 deep ——
 * 优先级:显式 thinkingMode(构造参数/子 agent 链路)> `cfg.thinkingMode`(主模型显式锁定)>
 * 集成方已自管思考参数(extraBody.thinking / cfg.thinking 存在 → 不叠默认)>
 * 兜底 thinkingFallback(summary/title 等辅助通道传 'simple')>
 * 能力表 thinking:true → 'deep' > 不注入(未知模型不猜,防 400)。
 * 纯函数可单测;网关代理模型名不可辨时集成方 `llm:{ thinkingMode:'deep' }` 或 modelCaps 声明 `thinking:true` 即享默认。
 */
export function resolveEffectiveThinkingMode(
  cfg: { model?: string; thinkingMode?: ThinkingMode; extraBody?: Record<string, unknown>; thinking?: unknown },
  explicit?: ThinkingMode,
  fallback?: ThinkingMode,
): ThinkingMode | undefined {
  if (explicit) return explicit
  if (cfg.thinkingMode) return cfg.thinkingMode
  if ((cfg.extraBody && 'thinking' in cfg.extraBody) || cfg.thinking) return undefined
  if (fallback) return fallback
  return resolveModelCaps({ model: cfg.model }).thinking ? 'deep' : undefined
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
  cfg = applyThinkingMode(cfg, resolveEffectiveThinkingMode(cfg, opts.thinkingMode, opts.thinkingFallback))
  return new ChatOpenAI({
    apiKey: cfg.apiKey,
    model: cfg.model,
    temperature: opts.temperature ?? cfg.temperature,
    // maxTokens 缺省链尾接能力表(request-maxtokens-default):cfg 未设时按表内模型实际上限发 max_tokens,
    // 不发会落 provider/网关缺省(常 4K)—— 大输出任务(代码生成)易截断;未知模型不兜(防超发 400)
    maxTokens: opts.maxTokens ?? cfg.maxTokens ?? tableMaxOutputTokens(cfg.model),
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
 * Claude extended thinking 走 ChatAnthropic 的 `thinking` 字段(非请求 body 额外参数);
 * `cfg.thinking` 由 applyThinkingMode(thinkingMode:'deep')或集成方显式配置注入。
 * **thinking 开启时 temperature 强制 1**(Anthropic API 硬约束,低温报错)。
 */
export async function constructLlmFromConfig(cfg: LLMConfig, opts: ConstructOpts = {}): Promise<BaseChatModel> {
  cfg = applyThinkingMode(cfg, resolveEffectiveThinkingMode(cfg, opts.thinkingMode, opts.thinkingFallback))
  const provider = cfg.provider ?? 'openai'
  if (provider === 'openai') return constructOpenLlmSync(cfg, opts)

  // anthropic:动态 import(optional peerDep;不用时不加载)
  const { ChatAnthropic } = await import('@langchain/anthropic')
  return new ChatAnthropic({
    apiKey: cfg.apiKey,
    model: cfg.model,
    // extended thinking 开启 → API 要求 temperature=1(显式低温会 400);未开思考维持原覆盖链
    temperature: cfg.thinking ? 1 : (opts.temperature ?? cfg.temperature),
    maxTokens: opts.maxTokens ?? cfg.maxTokens ?? tableMaxOutputTokens(cfg.model),  // 表兜底同 openai 路径
    // anthropicApiUrl = baseUrl(Anthropic SDK 的 baseURL 别名);clientOptions 透传 extraConfig(fetch/headers 等)
    ...(cfg.baseUrl ? { anthropicApiUrl: normalizeBaseUrl(cfg.baseUrl) } : {}),
    ...(cfg.extraConfig ? { clientOptions: cfg.extraConfig } : {}),
    // extended thinking(subagent-thinking-mode-lock):ChatAnthropic 构造参数 thinking 字段
    ...(cfg.thinking ? { thinking: cfg.thinking } : {}),
    // prompt caching:走 invocationKwargs 透传顶层 cache_control(服务端自动在最后一个可缓存块打断点并随对话推进,
    // ReAct 多轮前缀命中 input 价格 ~1/10)。机制(rv-recent F3 勘误,已验 @langchain/anthropic@1.5.4 dist):
    // ① 构造器顶层 cache_control 字段不进请求体(invocationParams 只消费调用时 options.cache_control);
    // ② invocationParams 里显式 cache_control:undefined 会覆盖 invocationKwargs 的同名键,真正救回它的是
    //    createStreamWithRetry/completionWithRetry 最终请求构造的**第二次 spread**({...rest, ...this.invocationKwargs});
    // ③ 行为因此钉死在 1.5.x 的 spread 顺序上 —— 升级后须用 cache_read_input_tokens 归零复检(真 LLM 基线兜底)。
    // true=ephemeral(5m);'1h'=长 TTL
    ...(cfg.cacheControl
      ? {
          invocationKwargs: {
            cache_control: { type: 'ephemeral' as const, ...(cfg.cacheControl !== true ? { ttl: cfg.cacheControl } : {}) },
          },
        }
      : {}),
  })
}
