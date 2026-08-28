/**
 * LLM 解析纯/半纯函数 —— 从 createChatSdk.ts 抽离(refactor-module-extraction 期二)。
 * 含 isChatModel(实例判定)/ extractText(响应文本提取)/ buildSummaryLlmInvoke(摘要 invoke)/ resolveLlm(初始装配入口)。
 *
 * 注:主 LLM 实例化(currentLlm)与 setLlm 运行时切换由 buildCore/createAgent 管(闭包依赖 modelCaps/currentLlm),
 * 本模块只解析 modelCaps + summaryLlmInvoke + 提供实例判定/文本提取。
 */
import { HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { resolveModelCaps, type ModelCaps } from '../utils/modelCaps'
import type { ChatSdkOptions, LLMConfig } from './createChatSdk'
import { constructLlmFromConfig } from '../llm/constructLlm'
import type { AgentMessage } from '../types'
import { createInspectContextTool } from './inspectContextTool'
import { CompressDecisionSchema, type CompressDecision, type CompressDecisionInput } from './compressDecision'

/**
 * 从首条 user 消息派生会话标题(截取前 30 字 + …,供历史列表显示,替代「会话 xxxxxx」)。
 * 纯函数:无 user → undefined;content 是 string 或 parts 数组(parts 取 .text 拼接);超 30 字截断。
 */
export function deriveTitle(msgs: AgentMessage[]): string | undefined {
  const u = msgs.find((m) => m.role === 'user')
  if (!u) return undefined
  const c = (u as any).content
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: any) => (typeof p === 'string' ? p : p?.text ?? '')).join('') : String(c ?? '')
  const t = text.trim().replace(/[\n\r]+/g, ' ')
  if (!t) return undefined
  return t.length > 30 ? t.slice(0, 30) + '…' : t
}

/** 判定 llm 选项是模型实例(BaseChatModel)还是配置对象(LLMConfig) */
export function isChatModel(v: unknown): v is BaseChatModel {
  return !!v && typeof v === 'object' && typeof (v as any).invoke === 'function' && typeof (v as any).stream === 'function'
}

/** 从 LLM 响应消息提取文本内容(content 可能是 string 或 content parts 数组) */
export function extractText(msg: BaseMessage): string {
  const c = msg.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c
      .map((p: any) => (typeof p === 'string' ? p : p?.text ?? ''))
      .join('')
  }
  return String(c ?? '')
}

/**
 * 构建摘要用 LLM invoke 函数(供 summarization 中间件 llmInvoke)。
 * 优先用 options.summaryLlm(专用压缩模型,如更便宜的小模型);未配则回退主 agent 模型(options.llm)。
 * 复用实例或按 LLMConfig 另构造 ChatOpenAI(低温 + 限输出,压缩成连贯段落)。
 * 温度/输出/超时可配(summaryTemperature/summaryMaxTokens/summaryTimeoutMs);超时回退索引摘要(不阻塞用户)。
 */
export function buildSummaryLlmInvoke(options: ChatSdkOptions): ((prompt: string) => Promise<string>) | undefined {
  const llmOpt = options.summaryLlm ?? options.llm
  if (!llmOpt) return undefined
  const temperature = options.summaryTemperature ?? 0.3
  const maxTokens = options.summaryMaxTokens ?? 2048  // 压缩摘要输出上限(1024 长对话易静默截断丢要点,2026-08-27 抬升)
  const timeoutMs = options.summaryTimeoutMs ?? 15000
  // 实例直用(presetLlm);LLMConfig cfg lazy 构造(首次 invoke,async 上下文承载 Anthropic 动态 import,不阻塞 resolveLlm 同步签名)
  const presetLlm: BaseChatModel | null = isChatModel(llmOpt) ? llmOpt : null
  const cfg: LLMConfig | null = isChatModel(llmOpt) ? null : (llmOpt as LLMConfig)
  if (cfg && !cfg.apiKey) {
    // 显式配了 summaryLlm 却无效(apiKey 缺失):非 debug 也 warn,避免"以为用了专用模型实际回退了主模型/索引摘要"
    if (options.summaryLlm) {
      console.warn('[page-agent-sdk][summarization] summaryLlm 已配置但缺 apiKey,摘要回退主 agent 模型或零成本索引摘要')
    }
    return undefined
  }
  let cachedLlm: BaseChatModel | null = presetLlm
  return async (prompt: string) => {
    // 超时保护:摘要 LLM 卡住时 reject → useContextManager 的 try/catch 回退索引摘要,不阻塞用户首次响应
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      // lazy 构造:首次 invoke(async);失败抛 → useContextManager compress 的 try/catch 回退索引摘要
      if (!cachedLlm && cfg) cachedLlm = await constructLlmFromConfig(cfg, { temperature, maxTokens, thinkingFallback: 'simple' })
      const res = await cachedLlm!.invoke(
        [
          new SystemMessage('你是对话历史压缩助手。把下面按轮次索引的对话要点,改写成一段连贯、紧凑的中文摘要,保留关键事实、用户意图与已用工具,不要编造。直接输出摘要正文。'),
          new HumanMessage(prompt),
        ],
        { signal: ac.signal } as any,
      )
      return extractText(res).trim()
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * 构建标题生成 LLM invoke(供 persistRuntime 自动生成会话标题,像 ChatGPT 总结主旨)。
 * 优先 options.titleLlm → summaryLlm → llm;实例优先,否则按 LLMConfig 构造 ChatOpenAI(低温 + 限 30 token)。
 * 失败/无 apiKey → undefined(调用方用 deriveTitle 规则兜底)。
 */
export function buildTitleLlmInvoke(options: ChatSdkOptions): ((messages: AgentMessage[]) => Promise<string>) | undefined {
  const llmOpt = options.titleLlm ?? options.summaryLlm ?? options.llm
  if (!llmOpt) return undefined
  // 实例直用(presetLlm);LLMConfig cfg lazy 构造(首次 invoke,async 承载 Anthropic 动态 import)
  const presetLlm: BaseChatModel | null = isChatModel(llmOpt) ? llmOpt : null
  const cfg: LLMConfig | null = isChatModel(llmOpt) ? null : (llmOpt as LLMConfig)
  if (cfg && !cfg.apiKey) return undefined
  let cachedLlm: BaseChatModel | null = presetLlm
  return async (messages: AgentMessage[]) => {
    const dialogue = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`)
      .join('\n')
      .slice(0, 800)
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), 10000)
    try {
      // lazy 构造:首次 invoke(async);失败抛 → 外层 catch return ''(fire-and-forget 容错)
      if (!cachedLlm && cfg) cachedLlm = await constructLlmFromConfig(cfg, { temperature: 0, maxTokens: 30, thinkingFallback: 'simple' })
      const res = await cachedLlm!.invoke(
        [
          new SystemMessage(
            (options as { i18n?: { locale?: string } }).i18n?.locale === 'en-US'
              ? 'Generate a short English title (max 10 words) summarizing the conversation below. Output the title text only, no quotes or punctuation.'
              : '根据以下对话的主旨,生成一个简短的中文标题(不超过15个字,不要标点和引号,直接输出标题文字)。',
          ),
          new HumanMessage(dialogue),
        ],
        { signal: ac.signal } as any,
      )
      const titleMax = (options as { i18n?: { locale?: string } }).i18n?.locale === 'en-US' ? 60 : 20
      return extractText(res).trim().replace(/^["'""「『]|["'""」』]$/g, '').split('\n')[0].slice(0, titleMax)
    } catch {
      return ''
    } finally {
      clearTimeout(timer)
    }
  }
}

/** 生成 tool_call 兜底 id(LLM 未返回 id 时;CLAUDE.md 明坑:ToolMessage 需 tool_call_id) */
function genToolCallId(): string {
  return `call_dec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 从 LLM 输出文本提取 JSON 对象(支持 ```json``` 围栏 / 裸 {…});失败返 null */
function extractJsonObject(text: string): unknown {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fence ? fence[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end < 0 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

/** 解析决策文本 → CompressDecision(JSON 提取 + schema 校验);失败 null */
function tryParseDecision(text: string): CompressDecision | null {
  if (!text) return null
  const json = extractJsonObject(text)
  if (json == null) return null
  const parsed = CompressDecisionSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

/**
 * 两段式工具循环:invoke bound 直到模型输出无 tool_calls 的最终文本(或工具循环超限)。
 * 工具轮:执行 inspect_context → ToolMessage(snake_case tool_call_id + call.id 兜底)→ 回灌 → 继续。
 * 最多 3 轮工具循环(防模型反复调工具);超限返 ''(上层判失败重试)。
 */
async function invokeUntilFinalJson(
  bound: { invoke: (msgs: BaseMessage[], opts?: unknown) => Promise<unknown> },
  inspectTool: { invoke: (args: unknown) => Promise<unknown> },
  baseMessages: BaseMessage[],
  signal: AbortSignal,
): Promise<string> {
  let messages: BaseMessage[] = [...baseMessages]
  for (let i = 0; i < 3; i++) {
    const res = (await bound.invoke(messages, { signal })) as { tool_calls?: Array<{ id?: string; args?: unknown }> }
    const toolCalls = res?.tool_calls ?? []
    if (!toolCalls.length) return extractText(res as BaseMessage).trim()
    // 有工具调用:执行 + ToolMessage 回灌(snake_case tool_call_id,CLAUDE.md 明坑;call.id 兜底)
    messages = [...messages, res as unknown as BaseMessage]
    for (const tc of toolCalls) {
      const id = tc.id ?? genToolCallId()
      try {
        const toolRes = await inspectTool.invoke(tc.args ?? {})
        const content = typeof toolRes === 'string' ? toolRes : (toolRes as { content?: unknown })?.content ?? JSON.stringify(toolRes)
        messages = [...messages, new ToolMessage({ content: content as string, tool_call_id: id })]
      } catch (e) {
        messages = [...messages, new ToolMessage({ content: `工具执行失败: ${(e as Error).message}`, tool_call_id: id })]
      }
    }
  }
  return '' // 工具循环超限(模型反复调工具),无最终文本 → 上层判失败重试
}

/**
 * 构建压缩决策 LLM decide 函数(agentCompression 开启时供 summarization 中间件)。
 * 复用 summaryLlm(专用压缩模型)→ 主 llm;两段式工具循环:bind inspect_context → 模型调工具查构成 → 输出决策 JSON。
 * - 独立 decisionTimeoutMs(默认 6s,不复用 summaryTimeoutMs 15s,两段叠加阻塞首响应)
 * - 独立 decisionMaxTokens(默认 2048,避免继承 summaryLlm 1024 截断 JSON safeParse 失败)
 * - 失败逐条(schema/JSON/工具抛错/超时)各重试一次 → null(降级静态压缩,不阻塞)
 * - 能力检测:bindTools 不存在 → null;bindTools 存在≠模型真支持(OpenAI 兼容端点可 400)→ 调用失败兜底 null
 */
export function buildCompressDecisionInvoke(
  options: ChatSdkOptions,
): ((input: CompressDecisionInput) => Promise<CompressDecision | null>) | undefined {
  const llmOpt = options.summaryLlm ?? options.llm
  if (!llmOpt) return undefined
  const presetLlm: BaseChatModel | null = isChatModel(llmOpt) ? llmOpt : null
  const cfg: LLMConfig | null = isChatModel(llmOpt) ? null : (llmOpt as LLMConfig)
  if (cfg && !cfg.apiKey) return undefined
  const timeoutMs = options.decisionTimeoutMs ?? 6000
  const maxTokens = options.decisionMaxTokens ?? 2048
  let cachedLlm: BaseChatModel | null = presetLlm

  return async (input: CompressDecisionInput): Promise<CompressDecision | null> => {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs)
    try {
      // lazy 构造(首次 decide;async 承载 Anthropic 动态 import)
      if (!cachedLlm && cfg) cachedLlm = await constructLlmFromConfig(cfg, { temperature: 0, maxTokens, thinkingFallback: 'simple' })
      const llm = cachedLlm as BaseChatModel & { bindTools?: (tools: unknown[]) => unknown }
      // 能力检测:bindTools 不存在 → null(bindTools 存在≠真支持,真正失败在 API 调用浮现 → 抛错 → catch null)
      if (typeof llm.bindTools !== 'function') return null
      // 临时构造 inspect_context(每轮拿最新 messages)+ bind(bindTools 返回新 RunnableBinding,不突变原 llm,与主 agent llmWithTools 无冲突)
      const inspectTool = createInspectContextTool({
        getMessages: input.getMessages,
        getSnapshot: input.getSnapshot,
        contextWindow: input.contextWindow,
      })
      const bound = llm.bindTools([inspectTool]) as { invoke: (msgs: BaseMessage[], opts?: unknown) => Promise<unknown> }
      const modeHint =
        input.triggerMode === 'token'
          ? 'token 模式:必填 windowRatio(0~1 保留窗口预算比例,如 0.4);keepRounds 可选'
          : '轮数模式:必填 keepRounds(保留最近几轮,如 6);windowRatio 可选'
      const baseMessages: BaseMessage[] = [
        new SystemMessage(
          `你是对话历史压缩决策助手。当前触发模式 = ${input.triggerMode}(${input.triggerReason})。先调用 inspect_context 查看上下文构成,再输出压缩决策 JSON。${modeHint}。仅输出 JSON,不要多余文字/markdown。schema:{keepRounds?(int 0-50), windowRatio?(0-1), summarize:{mode:"index"|"llm"}, recallTopK?(int 0-10), preserveTools?(string[]≤10), reason?(≤200字)}。keepRounds/windowRatio 至少填一个。`,
        ),
        new HumanMessage(
          `触发原因:${input.triggerReason}\n上下文窗口:${input.contextWindow ?? '未知'} tokens\n阈值比例:${input.thresholdRatio ?? '未知'}\n\n请决策压缩策略(先 inspect_context 查看,再输出 JSON)。`,
        ),
      ]
      // 第一轮决策(含工具循环)
      const firstText = await invokeUntilFinalJson(bound, inspectTool, baseMessages, ac.signal)
      const firstDecision = tryParseDecision(firstText)
      if (firstDecision) return firstDecision
      // 失败重试一次(feedback;design:各失败重试一次 → 仍失败 null 降级静态压缩)
      const retryMessages = [
        ...baseMessages,
        new HumanMessage('上一次输出无效(JSON 解析失败或 schema 校验不通过)。请只输出符合 schema 的压缩决策 JSON,不要多余文字/markdown 代码块。'),
      ]
      const retryText = await invokeUntilFinalJson(bound, inspectTool, retryMessages, ac.signal)
      return tryParseDecision(retryText)
    } catch {
      return null // 超时/调用失败/bindTools 不支持抛错 → null(降级静态压缩,不阻塞用户)
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * 解析初始模型能力 + 摘要/标题/压缩决策 LLM invoke(供 buildCore 装配)。
 */
export function resolveLlm(options: ChatSdkOptions): {
  modelCaps: ModelCaps
  summaryLlmInvoke: ((prompt: string) => Promise<string>) | undefined
  titleLlmInvoke: ((messages: AgentMessage[]) => Promise<string>) | undefined
  compressDecisionInvoke: ((input: CompressDecisionInput) => Promise<CompressDecision | null>) | undefined
} {
  const llm = options.llm as any
  const llmCfg = isChatModel(options.llm) ? undefined : (options.llm as LLMConfig)
  const modelCaps = resolveModelCaps({
    // 实例路径也读 .model/.contextWindow(BaseChatModel 实例可能带;stubModel 挂 contextWindow 过校验)
    model: llmCfg?.model ?? llm?.model ?? llm?.modelName,
    contextWindow: options.contextWindow ?? llmCfg?.contextWindow ?? llm?.contextWindow,
    maxOutputTokens: options.maxOutputTokens ?? llmCfg?.maxOutputTokens ?? llm?.maxOutputTokens,
    vision: llmCfg?.vision ?? llm?.vision,
  })
  const summaryLlmInvoke = buildSummaryLlmInvoke(options)
  const titleLlmInvoke = buildTitleLlmInvoke(options)
  const compressDecisionInvoke = buildCompressDecisionInvoke(options)
  return { modelCaps, summaryLlmInvoke, titleLlmInvoke, compressDecisionInvoke }
}
