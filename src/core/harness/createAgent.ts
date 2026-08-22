/**
 * Harness 核心 —— 可插拔中间件的 ReAct 循环
 *
 * 对齐 Deep Agents 的 createAgent:不绑定具体工具/能力,工具与能力以"中间件"注入。
 *
 * 流程:
 *   beforeAgent → while(rounds < max){ beforeModel → wrapModelCall → afterModel
 *     → (有 tool_calls) wrapToolCall(逐个) } → afterAgent
 */
import { shallowRef, triggerRef } from 'vue'
import { ChatOpenAI } from '@langchain/openai'
import { stripStainlessFetch, normalizeBaseUrl } from '../llm/constructLlm'  // 兜底构造(散字段,子 agent 路径)同样剥 x-stainless-* 头 + 相对 baseUrl 归一
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
  AIMessageChunk,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { AgentMessage, StreamHandler } from '../types'
import { asAgentError } from '../tools/toolError'
import { buildImageContentParts, appendImageDescriptions } from '../tools/imageInput'
import { offloadLargeResult } from '../utils/offload'
import { runPool } from '../utils/pool'
import { resolveModelCaps, estimateTokens, offloadThresholdChars, offloadPassThroughChars, type ModelCaps } from '../utils/modelCaps'
import { getTraceMetrics } from '../utils/traceMetrics'
import { extractTextDelta, extractReasoningDelta, extractUsage, normalizeUsage } from '../utils/contentParts'
import { createInitialState, type HarnessState, type LoopProgress } from './state'
import { withRetry, isAbort, type RetryOptions } from './retry'
import { withStallTimeout, StreamStalledError, StreamMaxDurationError, EmptyLLMResponseError, DEFAULT_STREAM_STALL_MS, DEFAULT_STREAM_MAX_DURATION_MS } from '../utils/stallTimeout'
import { isContextLengthError } from './errors'
import { detectIncompleteFinish, buildGateFeedback } from './todos'
import { detectActionImperative, isZeroEffectiveWrite, buildTurnFactSheet, buildZeroToolFeedback, mentionsLocation, detectStatusQuery, assertsCompletion, isZeroToolCalls, buildStatusQueryFeedback, type TurnToolUsage } from './actionGate'
import { isSuccessfulWriteResult } from './writeGate'
import { invalidateStaleReads, type StaleWriteRecord } from './readInvalidation'
import {
  type Middleware,
  type ModelRequest,
  type ModelResponse,
  type ToolCallContext,
  runBeforeAgent,
  runBeforeModel,
  runAfterModel,
  runAfterAgent,
  runBeforeReturn,
  composeModelCall,
  composeToolCall,
} from './middleware'

export interface DebugLog {
  timestamp: number
  type: 'context' | 'llm_request' | 'llm_response' | 'tool_call' | 'tool_result' | 'error' | 'middleware'
  data: any
  /** 日志来源(主 agent 省;子 agent 转发时为 '子:label',便于区分) */
  source?: string
}

/** 检测模型把工具调用写成文本(伪 XML/标签/DeepSeek 内部标记)而非走标准 tool_calls 通道的异常格式。导出供测试。
 *  实测:DeepSeek-v4 在长 tool-call 链(10+ 轮连续工具调用)下,function-calling 会退化成正文里的
 *  <｜｜DSML｜｜>invoke 等内部标记(系统识别不到 → 未执行 → 静默当 final);此处一并捕获,触发格式自纠。 */
export function detectGarbledToolCall(content: string): boolean {
  if (!content) return false
  // 仅匹配明确的"伪工具调用标签 / DeepSeek 内部 tool 标记",避免误判正常文本:
  //  - <｜tool_calls｜> / <｜｜xxx tool_call:DeepSeek tool_calls 标记
  //  - <｜｜?DSML｜｜?>:DeepSeek-v4 DSML(内部 function-calling 格式)标记,长链下易退化泄漏
  //  - <｜tool[_a-z]*｜>:DeepSeek tool 段标记变体(<｜tool｜>/<｜tool_begin｜> 等)
  //  - <invoke name=> / <tool_call> / <function_call>:通用伪 XML 工具调用
  return /<｜tool_calls｜>|<｜｜[^>]*tool_call|<｜｜?DSML|<｜｜?tool[_a-z]*｜?>|<invoke\s+name=|<\/?tool_call>|<function_call>/i.test(content)
}

/** 剥离 garbled 工具调用文本,只保留首个标记出现前的正常 prose。导出供测试。
 *  实测(3.11 真 LLM 复测):wrap-up/重试耗尽路径曾把未解析的 DSML 块(单竖线 + 截断的任务规格)原样当
 *  最终答复返回 —— 对用户是乱码且暗示已执行,实为零执行(use_html 委派从未跑)。
 *  规则:强守卫标记(单/双竖线 DSML / <｜tool*｜> / <function_call> / <invoke name=)首次出现处截断 ——
 *  标记后的正文几乎必是工具调用规格(参数值可含多行长文),不是给用户的话;无标记返回原串(去首尾空白)。 */
export function sanitizeGarbledContent(content: string): string {
  if (!content) return ''
  const re = /<｜tool_calls｜>|<｜｜[^>]*tool_call|<｜｜?DSML|<｜｜?tool[_a-z]*｜?>|<function_call>|<invoke\s+name=/i
  const m = content.search(re)
  return (m >= 0 ? content.slice(0, m) : content).trim()
}

/** 过渡性收口模式:模型中途输出计划性表态就停(实测 deepseek-v4-flash:「好的,我先看看…再委派生成」调研完即收口)。导出供测试 */
const TRANSITIONAL_RE = /(我先|让我先|我先看|先看看|先了解|先加载|先查阅|稍后|接下来我|我将先|等我|查完.{0,12}再|看完.{0,12}再|了解.{0,8}再)/
/** 完成标记:含这些视为真实收口(总结/汇报),不回灌 */
const DONE_VERB_RE = /(已完成|已生成|已修改|已创建|已添加|已删除|已更新|已调整|已处理|已委派|已配置|已切换|成功|完成[。!?]|搞定了|做好了)/
/**
 * 检测「过程性收口」:本轮已执行过工具(说明任务进行中)但最终文本是过渡性计划表态而非完成汇报 ——
 * 回灌让模型继续执行,防「调研完说稍后就停」(flash 实测:委派编排任务被「我先看看…再委派生成」收口,任务零落地)。
 * 保守判定:短文本(≤160 字)+ 命中过渡模式 + 无完成动词;误判代价仅一轮回灌(有界 ≤2 次)。
 */
export function detectTransitionalReply(content: string): boolean {
  if (!content) return false
  const text = content.trim()
  if (text.length > 160) return false  // 长文多为真总结
  if (DONE_VERB_RE.test(text)) return false
  return TRANSITIONAL_RE.test(text)
}

/** 第 0 轮「行动叙述」模式:点名已知工具 + 第一人称行动动词(实测 flash 粒子任务 2782 字纯叙述)。导出供测试 */
const ACTION_TOOL_RE = /(add_component|delete_component|move_component|list_components|select_component|load_skill|use_[a-z]+|rag_[a-z]+|request_human_confirmation|\bwrite\b|\bread\b)/
const ACTION_VERB_RE = /(我来|让我|我先|现在|开始|先加载|先添加|先写|先删|先看看|执行|添加|写入|加载|删除)/
/**
 * 检测「第 0 轮行动叙述」:首回合纯文本、零 tool_calls,但文本点名工具并表态要执行
 * (「我来添加 / 先加载 page-tools / 用 add_component_tree…」)—— ReAct 见无 tool_calls 会当最终回答结束,
 * 用户看到「我要做…做完了」但零执行(幻觉叙述,实测 deepseek-v4-flash)。
 * 与 detectTransitionalReply 区别:① 不限长度(叙述常为长文)② 不豁免完成动词 —— 第 0 轮没有任何工具执行,
 *   文本里的「已添加/成功」只能是幻觉,反而是叙述的铁证;③ 仅在 rounds===0 且无 tool_calls 时调用(上下文消歧,
 *   真实完成汇报必有 tool_calls 不会落到这里)。误判代价仅一轮回灌(有界 ≤2)。
 */
export function detectActionNarration(content: string): boolean {
  if (!content) return false
  const text = content.trim()
  return ACTION_TOOL_RE.test(text) && ACTION_VERB_RE.test(text)
}

/** 强守卫标记(DeepSeek 内部 token,模型正文不会随意产生)—— fix-write-safety-bypass P0-2:
 *  parseGarbledToolCalls 仅当 content 匹配到强守卫标记才自动解析执行;纯伪 XML `<invoke>`(无守卫)→ 返回 null,
 *  交 garbled-retry 回灌让模型用标准 function calling 重发,防「模型贴的示例 / 用户让示范写法」被当真执行写入数据。 */
const DSML_GUARD_RE = /<｜tool_calls｜>|<｜｜[^>]*tool_call|<｜｜?DSML|<｜｜?tool[_a-z]*｜?>/i

/** 剥离代码围栏(```...```)区块内容 —— fix-write-safety-bypass P0-2:模型在正文贴的工具调用示例多在围栏内,不应当真执行。 */
function stripCodeFences(content: string): string {
  return content.replace(/```[\w-]*\n?[\s\S]*?```/g, '')
}

/** 解析 garbled 工具调用文本(DSML/伪 XML)为标准 tool_calls 数组。
 *  DeepSeek-v4 等模型把工具调用写成正文标签(<｜｜DSML｜｜invoke name="X"><｜｜DSML｜｜parameter name="Y">值</…>)
 *  而非标准 tool_calls 通道;此处解析为 [{id,name,args}] 让 agent 直接执行(免重试)。
 *  - 变体:<｜｜DSML｜｜invoke name=> / <invoke name=> / <｜tool_calls｜>…<invoke>
 *  - 参数 <｜｜DSML｜｜parameter name="Y"[…]>值</…> / <parameter name="Y">值</parameter>;值 try JSON.parse
 *  - 截断(参数未闭合 / 值不完整) → 跳过该 invoke;全部失败 → null(交重试)
 *  返回 null:无 garbled / 无 invoke / 全截断。 */
export function parseGarbledToolCalls(content: string): { id: string; name: string; args: Record<string, unknown> }[] | null {
  if (!content || !detectGarbledToolCall(content)) return null
  // fix-write-safety-bypass(P0-2):① 剥离代码围栏(模型贴的示例不当真执行);② 仅强守卫标记(DeepSeek 内部 token)才解析执行,
  // 无守卫的纯伪 XML `<invoke>` → null(交 garbled-retry 回灌让模型用标准 function calling 重发,防示例被当真写入数据)
  let stripped = stripCodeFences(content)
  // 守卫判定用原串(单竖线变体 <｜DSML｜/<｜tool｜> 也算强守卫)
  if (!DSML_GUARD_RE.test(stripped)) return null
  // 变体剥离(真 LLM 实测):flash 泄漏形态可为单竖线 `<｜DSML｜invoke>`/`<｜DSML｜/parameter>` ——
  // 直接删掉单竖线标记前缀,归一成纯 XML 形态(<invoke>/<parameter>/</parameter>)走原解析
  // (修前:闭合标记形态对不上 → 解析 null → 重试耗尽 → DSML 文本当结论返回主 agent,子 agent 工具白做)
  stripped = stripped.replace(/<｜(?!｜)[^｜<>]*?｜>/g, '')
  const invokeRe = /<(?:｜｜?DSML｜｜?)?\s*invoke\s+name=["']([^"']+)["'][^>]*>/gi
  const starts: { name: string; tagStart: number; after: number }[] = []
  let m: RegExpExecArray | null
  while ((m = invokeRe.exec(stripped)) !== null) {
    starts.push({ name: m[1], tagStart: m.index, after: invokeRe.lastIndex })
  }
  if (!starts.length) return null
  const closeInvokeRe = /<\/?\s*(?:｜｜?DSML｜｜?)?\/?\s*invoke\s*>/i
  const paramRe = /<(?:｜｜?DSML｜｜?)?\s*parameter\s+name=["']([^"']+)["'][^>]*>([\s\S]*?)<\/?\s*(?:｜｜?DSML｜｜?)?\/?\s*parameter\s*>/gi
  const openParamRe = /<(?:｜｜?DSML｜｜?)?\s*parameter\s+name=["'][^"']+["'][^>]*>/gi
  const closeParamRe = /<\/?\s*(?:｜｜?DSML｜｜?)?\/?\s*parameter\s*>/gi
  const calls: { id: string; name: string; args: Record<string, unknown> }[] = []
  for (let i = 0; i < starts.length; i++) {
    const segEnd = i + 1 < starts.length ? starts[i + 1].tagStart : stripped.length
    let seg = stripped.slice(starts[i].after, segEnd)
    const closeM = seg.match(closeInvokeRe)
    if (closeM && closeM.index !== undefined) seg = seg.slice(0, closeM.index)
    // 截断检查:开参数 > 闭参数(有未闭合 = 值被 max_tokens 截断) → 跳过该 invoke(值不完整不可用)
    const openCount = (seg.match(openParamRe) || []).length
    const closeCount = (seg.match(closeParamRe) || []).length
    if (openCount > closeCount) continue
    const args: Record<string, unknown> = {}
    paramRe.lastIndex = 0
    let pm: RegExpExecArray | null
    while ((pm = paramRe.exec(seg)) !== null) args[pm[1]] = parseDsmlValue(pm[2].trim())
    calls.push({ id: `dsml_${i}_${Date.now().toString(36)}`, name: starts[i].name, args })
  }
  return calls.length ? calls : null
}

/** DSML 参数值解析:try JSON.parse(失败保留 string;支持 boolean/null) */
function parseDsmlValue(s: string): unknown {
  if (s === 'true') return true
  if (s === 'false') return false
  if (s === 'null') return null
  try { return JSON.parse(s) } catch { return s }
}

/** 结构化追踪 span(revive-observability-tracing Phase 3)。debugLogs 扁平数组的层级+timing+metrics 升级,供 DebugDrawer 树形 + getTraceMetrics */
export type SpanType = 'round' | 'model' | 'tool' | 'compression'
export type SpanStatus = 'ok' | 'error' | 'timeout'
export interface TraceSpan {
  id: string
  parentId?: string
  name: string
  type: SpanType
  startTs: number
  endTs?: number
  durationMs?: number
  status: SpanStatus
  /** 按 type 分桶:round:{round,aborted?} model:{round,tools?,usage?} tool:{name,args?,resultSnippet?} compression:{stats?} */
  attributes: Record<string, unknown>
}

/** trace metrics(getTraceMetrics 纯函数聚合:轮次/延迟/工具成功率/重试/压缩/token) */
export interface TraceMetrics {
  rounds: number
  totalDurationMs: number
  avgRoundMs: number
  toolCalls: number
  toolFailures: number
  toolSuccessRate: number
  modelCalls: number
  retries: number
  compressions: number
  totalTokens?: { prompt: number; completion: number; total: number }
}

export interface CreateAgentOptions {
  /** 预构造的 LLM 实例(任意 provider,provider 抽离);提供则优先于 apiKey/model 配置 */
  llm?: BaseChatModel
  apiKey?: string
  baseUrl?: string
  model?: string
  temperature?: number
  maxTokens?: number
  /** 集成方显式声明模型上下文窗口(token);缺省按 model 名查表,再缺省 32K。影响 offload 阈值与压缩触发 */
  contextWindow?: number
  /** 集成方显式声明模型最大输出(token);缺省按 model 名查表,再缺省 4K。maxTokens 未传时作其缺省 */
  maxOutputTokens?: number
  /** 透传 ChatOpenAI 的 modelKwargs:额外请求 body 参数(如 deepseek thinking)。仅 llm 未传实例(按配置构造 ChatOpenAI)时生效 */
  extraBody?: Record<string, any>
  /** 透传 ChatOpenAI configuration 的额外字段(如 headers/timeout/customFetch),与 baseUrl 合并。仅按配置构造时生效 */
  extraConfig?: Record<string, any>
  systemPrompt?: string
  /** 用户自定义工具(与中间件贡献的工具合并) */
  tools?: StructuredToolInterface[]
  /** 中间件栈(顺序:内置在前,用户在后) */
  middleware?: Middleware[]
  maxToolRounds?: number
  /** 循环总迭代硬上限(防自纠死循环;默认 max(maxToolRounds*3, 30);harden-react-loop-budget) */
  maxIterations?: number
  /** 模型调用失败自动重试次数(默认 2;网络/429/5xx 重试,4xx 与 abort 不重试) */
  maxRetries?: number
  /** 重试退避基数 ms(默认 500,第 n 次重试等待 = base*2^n + jitter) */
  retryDelayMs?: number
  /** LLM 流停滞看门狗(fix-hang-and-feedback P1-7):chunk 间隔(含等首个)超此 ms → 中断抛错。默认 90s;0 = 关闭 */
  stallMs?: number
  /** 单次模型调用流总时长上限(stream-max-duration):防空转帧黑洞(keepalive 不断喂饱间隔看门狗,实测冻结 7min+ 无报错)。默认 600s;0 = 关闭 */
  streamMaxMs?: number
  /** 同轮多个工具调用的并发上限(默认 1 = 串行,保持现有工具语义);>1 时并发执行 */
  maxParallelTools?: number
  /** beforeReturn 自纠上限(默认 0 = 关闭,纯放行);>0 时 agent 返回前跑 beforeReturn 钩子,有 feedback 则回灌 user 消息继续循环,达上限强制 return 防死循环 */
  maxVerifyAttempts?: number
  /**
   * 单次 invoke 的 token 预算上限(opt-in;context-economy-phase2 C4):每轮模型调用前检查本次 invoke 累计
   * total_tokens,超限 → 中断收口(observable emit + 友好收口文本,已完成部分保留)。与 automation 的全局
   * tokenBudget 正交:后者跨整个会话累计、需 automation 能力;本项单 invoke、无条件可用(防单轮死循环烧钱)。
   */
  roundTokenBudget?: number
  /** 日志下沉:每条 debugLog 产生时回调(子 agent 经此把日志转发到主 debugLogs) */
  onLog?: (entry: DebugLog) => void
  /** 子 agent 标记(subagent.ts 建子循环时置 true):imperative-zero-tool-gate 等主栈门禁据此豁免(子纯文本收口是正常形态) */
  __pgIsSubagent?: boolean
  /** span 采集回调(capabilities.tracing 开时由 createChatSdk 注入;关时 undefined → startSpan/endSpan no-op 零开销) */
  onSpan?: (span: TraceSpan) => void
  /** 一次 agent 调用结束的 trace 回调(stream/invoke finally 触发,传完整 spans + metrics;createChatSdk 经此 emit('trace')) */
  onTrace?: (spans: TraceSpan[], metrics: TraceMetrics) => void
  /** LLM 运行时切换回调(setLlm 后触发,供 createChatSdk 重解析模型能力 contextWindow/maxOutputTokens) */
  onLlmChange?: (newLlm: BaseChatModel) => void
  /**
   * 显式声明主模型是否多模态识图(image-input-vision;声明 > model 名查表 > 缺省 false)。
   * true 时 user 消息 images 在 toLC 组装 content parts 直发;vision 能力随 setModelCaps 回灌(setLlm 链)。
   */
  vision?: boolean
  /** content parts 协议形态(默认 'openai' 即 LangChain 标准多模态格式,ChatAnthropic 亦兼容转换;'anthropic' 原生 image block) */
  imageContentFormat?: 'openai' | 'anthropic'
  /**
   * 写驱动过期读失效(stale-read-invalidation,默认 true):单次 invoke 窗口内,本批成功写(writeCapable
   * 四重门槛判定)之后,此前被击中路径(等值/祖先/后代;remove/move/del 追加父数组)的旧 read/query/search
   * 结果替换为失效占位(防模型凭旧快照答状态/继续用错位索引)。false = 主/子一致关闭零变化。
   */
  staleReadInvalidation?: boolean
  debug?: boolean
}

// 默认工具轮预算(3.43 再调:10→15(3.28)后 editor 实测 12 组件整页搭建仍触顶 —— 9 轮查文档 + 12 组件写入 + 3 次委派
//   天然 >15 轮,计划规模与预算错配致任务中途断;30 覆盖典型复杂任务且 maxIterations = max(*3, 30)=90 总闸仍防自纠死循环。
//   配合轮次预算感知提示(轮次预算告急注入 system),模型撞墙前自适应而非触顶被打断)
const DEFAULT_MAX_TOOL_ROUNDS = 30
/** debugLogs 条目上限:超限丢最旧,防异常多轮/子 agent 大量转发日志撑爆内存(纯内存,每轮重置,此为单轮兜底) */
const MAX_DEBUG_LOGS = 300
/** 单条日志内 message content 截断阈值:llm_request 每轮记录完整 messages(O(N²) 增长),截断既保可读又控内存 */
const MAX_LOG_CONTENT_CHARS = 6000

/**
 * 逐轮上下文保底压缩(纯函数,可单测):循环内每轮 tool 结果累积,单条已由 offload 限制,多条累积仍可能超。
 * 当总字符超过放行上限(maxChars)时,从最早的 ToolMessage 起截断为占位摘要,
 * 保留 tool_call_id(结构完整,模型仍能对应),不动对话/system/ai 消息。大模型阈值高几乎不触发。
 */
export function trimContextIfNeededImpl(messages: BaseMessage[], maxTokens: number): BaseMessage[] {
  // H1(harden-context-resilience):token 口径(原字符数,中文 1 字符≈1.5token 致 CJK+小窗口 trim 完仍超窗口)
  const msgTokens = (m: BaseMessage) =>
    estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify((m as any).content))
  const total = messages.reduce((s, m) => s + msgTokens(m), 0)
  if (total <= maxTokens) return messages
  let trimmed = 0
  const need = total - maxTokens
  // 保留首段字符数按 token 预算自适应:大预算→400,小预算→100;clamp [100,400](预览长度,非计量)
  const keep = Math.max(100, Math.min(400, Math.round(maxTokens / 500)))
  const result = messages.map((m) => {
    if (trimmed >= need) return m
    if (!(m instanceof ToolMessage)) return m
    const c = typeof m.content === 'string' ? m.content : JSON.stringify((m as any).content)
    if (c.length <= 400) return m // 太短不值得压
    const summary = `…[已自动压缩 ${c.length} 字符,保留首 ${keep}]\n` + c.slice(0, keep)
    trimmed += estimateTokens(c) - estimateTokens(summary) // token 口径计量裁剪量
    return new ToolMessage({ tool_call_id: (m as any).tool_call_id, content: summary })
  })
  // H1 over-window 复查:裁完仍超(system/history/不可裁部分超预算)→ observable warn(Phase 5 系统段截断 / P3 反应性重试兜底)
  const afterTotal = result.reduce((s, m) => s + msgTokens(m), 0)
  if (afterTotal > maxTokens) {
    console.warn(`[page-agent-sdk] trim 后仍超窗口:${afterTotal} > ${maxTokens} tokens(系统段/历史超预算,见 Phase 5/P3)`)
  }
  return result
}

/**
 * 推导循环总迭代硬上限(防自纠死循环的总闸):max(maxToolRounds*3, 30)。
 * 工具轮每轮可能伴自纠(format 2 + verify maxAttempts),*3 留余量;下限 30 防小 maxToolRounds 时自纠空间不足。
 * 正常自纠有界(formatRetries<=2、verifyAttempts<maxVerifyAttempts)不会触顶,触顶即模型异常(反复格式错/verify 反复拒)强制退出。
 * 纯函数,可白盒单测。harden-react-loop-budget
 */
export function computeMaxIterations(maxToolRounds: number, userMax?: number): number {
  return userMax ?? Math.max(maxToolRounds * 3, 30)
}

/**
 * 轮次预算感知提示(round-budget-awareness):已用轮次占 maxToolRounds 比例高时返回注入 system 的提示段,
 * 让模型在撞墙**前**自适应(砍非必要查询/直奔核心写入/如实标记未完成项),而非触顶被 react_call_limit 强制打断。
 * 3.43 editor 实测驱动:12 组件整页计划(min ~25 轮)撞 15 轮上限,任务断在「查文档查到一半」。
 * 两档:剩余 ≤2 轮告急(优先级高,先判);已用 ≥70% 提醒。零开销纯函数,可白盒单测。
 */
export function roundBudgetHintText(usedRounds: number, maxToolRounds: number): string {
  if (maxToolRounds <= 0 || usedRounds < 0) return ''
  const remaining = maxToolRounds - usedRounds
  if (remaining <= 0) return '' // 已触顶(收口路径),不打扰
  if (remaining <= 2) {
    return `⚠️ 轮次预算告急:本轮任务已用 ${usedRounds}/${maxToolRounds} 轮工具调用,仅剩 ${remaining} 轮。立即停止扩展性操作(查询/重读/优化),完成手头最关键的一步写入或委派,然后用纯文本给出诚实结论:哪些已完成、哪些未做(用 update_todo 如实标记),用户可回复「继续」续跑。`
  }
  if (usedRounds >= Math.ceil(maxToolRounds * 0.7)) {
    return `⚠️ 轮次预算提醒:本轮任务已用 ${usedRounds}/${maxToolRounds} 轮工具调用,剩余 ${remaining} 轮。优先完成核心写入/委派与收口,砍掉非必要的查询与重复读;若预估剩余步骤超出预算,先做最重要的部分并如实标记未完成项,不要等被打断。`
  }
  return ''
}

/** C2 写失败计数认定的写工具集(dataOps 高层 + 底层写路径;draft_commit 视为根路径写) */
const WRITE_TOOL_NAMES = new Set(['write', 'set_data', 'edit_data', 'delete_data', 'draft_commit'])

/**
 * 从写工具 args 提取目标 path(计数聚合键;提取不出 → 根 '')。纯函数。
 * 覆盖:jsonPath 直传(edit_data/delete_data)/ patch.jsonPath(write 增量)/ patches[0].jsonPath(write 批量)/ 其余(整体 set)= 根
 */
export function extractWriteTargetPath(args: unknown): string {
  if (!args || typeof args !== 'object') return ''
  const a = args as Record<string, unknown>
  if (typeof a.jsonPath === 'string') return a.jsonPath
  const patch = a.patch as Record<string, unknown> | undefined
  if (patch && typeof patch.jsonPath === 'string') return patch.jsonPath
  const patches = a.patches
  if (Array.isArray(patches) && patches.length && patches[0] && typeof (patches[0] as any).jsonPath === 'string') {
    return (patches[0] as any).jsonPath
  }
  return ''
}

export function createAgent(options: CreateAgentOptions) {
  const {
    apiKey,
    baseUrl,
    model = 'gpt-3.5-turbo',
    temperature = 0.7,
    maxTokens, // 不设默认:缺省由模型能力(maxOutputTokens)推导,避免设错被截断
    extraBody,
    extraConfig,
    systemPrompt,
    tools: extraTools = [],
    middleware: middlewares = [],
    maxToolRounds: initMaxToolRounds,
    maxIterations: userMaxIterations,
    maxRetries = 2,
    retryDelayMs = 500,
    stallMs = DEFAULT_STREAM_STALL_MS,
    streamMaxMs = DEFAULT_STREAM_MAX_DURATION_MS,
    maxParallelTools = 1,
    maxVerifyAttempts = 0,
    roundTokenBudget = 0, // C4 单 invoke token 预算(opt-in;0=关)
    onLog,
    onSpan,
    onTrace,
    onLlmChange,
    imageContentFormat = 'openai' as 'openai' | 'anthropic',
    staleReadInvalidation = true,
    debug = false,
  } = options

  // 装配期配置校验(audit-five-dimensions CO-P1 / CA-P1)
  let maxToolRounds = initMaxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS
  if (!Number.isFinite(maxToolRounds) || maxToolRounds < 1) {
    console.warn(`[page-agent-sdk] maxToolRounds=${maxToolRounds} 非法(须 ≥1 正整数),已 clamp 到 1(0/负数致主循环 while 不进 → agent 不调 LLM 静默返回兜底文案)`)
    maxToolRounds = 1
  }
  if (maxParallelTools > 1) {
    console.warn(`[page-agent-sdk] maxParallelTools=${maxParallelTools}:并发工具下 dataOps 写工具不互锁(同轮并发两写都在 await handleConflict 让出前取旧基线 → 均通过乐观锁 → 后写覆盖前写,无 VERSION_CONFLICT 回灌);并发写不互锁,如需冲突保护保持 maxParallelTools=1 并声明 conflictWatchFields`)
  }

  // 模型能力:声明优先 > model 名查表 > 缺省。
  // maxTokens 缺省 = maxOutputTokens(DeepSeek 8192 等,避免固定 16384 被截断);
  // offload 外存阈值按上下文窗口自适应(1M→20000,32K→2000)
  let caps = resolveModelCaps({
    model,
    contextWindow: options.contextWindow,
    maxOutputTokens: options.maxOutputTokens,
    vision: options.vision,
  })
  const resolvedMaxTokens = maxTokens ?? caps.maxOutputTokens
  let offloadThreshold = offloadThresholdChars(caps.contextWindow)
  // vfs 不可用时的放行上限:大模型(1M)→ 200000 几乎不截断,小模型按上下文 20% 推导
  let offloadPassThrough = offloadPassThroughChars(caps.contextWindow)

  /**
   * 运行时更新模型能力(setLlm 后由 createChatSdk onLlmChange 集中回灌)。
   * 重算 offload 阈值(随新 contextWindow 自适应);maxTokens 缺省随新 maxOutputTokens(见 setLlm 链)。
   */
  function setModelCaps(newCaps: ModelCaps): void {
    caps = newCaps
    offloadThreshold = offloadThresholdChars(caps.contextWindow)
    offloadPassThrough = offloadPassThroughChars(caps.contextWindow)
  }

  // shallowRef:浅响应式,不深度代理 push 进来的 data 对象,避免与 currentMessages 共享引用污染日志快照
  const debugLogs = shallowRef<DebugLog[]>([])
  // stale-read-invalidation 会话累计(跨 invoke;inspect().staleReadsInvalidated 反射,类比 debugLogs 闭包真相源)
  let staleReadsInvalidated = 0
  function log(type: DebugLog['type'], data: any) {
    // 始终记录到 debugLogs(供日志抽屉查看请求上下文历史);debug 时额外输出到 console
    const entry: DebugLog = { timestamp: Date.now(), type, data }
    debugLogs.value.push(entry)
    // 条目上限兜底:超限丢最旧(单轮内异常多 tool/子 agent 转发时防失控)
    if (debugLogs.value.length > MAX_DEBUG_LOGS) debugLogs.value.splice(0, debugLogs.value.length - MAX_DEBUG_LOGS)
    triggerRef(debugLogs)
    onLog?.(entry) // 日志下沉(子 agent 经 ctx.logSink → onLog 转发到主)
    if (debug) console.log(`%c[Agent] ${type}`, 'color:#667eea;font-weight:bold', data)
  }
  /** push 一条外部 debugLog 到主日志(供子 agent 经 ctx.logSink 转发) */
  const pushLog = (entry: DebugLog) => {
    debugLogs.value.push(entry)
    if (debugLogs.value.length > MAX_DEBUG_LOGS) debugLogs.value.splice(0, debugLogs.value.length - MAX_DEBUG_LOGS)
    triggerRef(debugLogs)
  }

  // ===== 结构化追踪(TraceSpan 树;capabilities.tracing 开时采集,no-op 零开销)=====
  const spans = shallowRef<TraceSpan[]>([])
  let spanSeq = 0
  const tracingEnabled = !!onSpan || !!onTrace
  /** 开启一个 span(tracing 关时返回 null,no-op);parentId 建立父子(round 是 model/tool 的 parent)。
   *  创建即 push 到 spans(round span 不 endSpan 也有记录;model/tool 在 endSpan 更新 endTs/duration/status) */
  function startSpan(parentId: string | undefined, type: SpanType, name: string, attributes: Record<string, unknown> = {}): TraceSpan | null {
    if (!tracingEnabled) return null
    const span: TraceSpan = { id: `span-${++spanSeq}`, parentId, name, type, startTs: Date.now(), status: 'ok', attributes }
    spans.value.push(span)
    if (spans.value.length > MAX_DEBUG_LOGS) spans.value.splice(0, spans.value.length - MAX_DEBUG_LOGS)
    triggerRef(spans)
    return span
  }
  /** 结束 span(算 durationMs + 更新 status;span 已在 startSpan 时 push,此处只更新字段引用) */
  function endSpan(span: TraceSpan | null, status: SpanStatus = 'ok', extra?: Record<string, unknown>) {
    if (!span || !tracingEnabled) return
    span.endTs = Date.now()
    span.durationMs = span.endTs - span.startTs
    span.status = status
    if (extra) Object.assign(span.attributes, extra)
    triggerRef(spans)
    onSpan?.(span)
  }

  // 合并工具:中间件贡献的工具 + 用户工具
  // let + rebindTools:支持运行时 setTools 动态增删用户工具(类比 setData/setSkills)
  let allTools: StructuredToolInterface[] = [
    ...middlewares.flatMap((m) => m.tools || []),
    ...extraTools,
  ]

  // provider 抽离:优先用预构造实例(任意 provider);否则按 apiKey/model 配置构造 ChatOpenAI(向后兼容)
  // let:支持运行时 setLlm 切换模型(配额耗尽切便宜模型 / 复杂任务切强模型 / 切 provider)
  let llm = options.llm ?? new ChatOpenAI({
    apiKey,
    model,
    temperature,
    maxTokens: resolvedMaxTokens,
    configuration: { ...(baseUrl ? { baseURL: normalizeBaseUrl(baseUrl) } : {}), fetch: stripStainlessFetch, ...extraConfig },
    ...(extraBody ? { modelKwargs: extraBody } : {}),
  })
  let llmWithTools = allTools.length > 0 ? (llm.bindTools?.(allTools) ?? llm) : llm

  /** 重新绑定工具到当前 llm(setTools/setLlm 后调用;bindTools 缺失时退回裸 llm) */
  function rebindTools(): void {
    llmWithTools = allTools.length > 0 ? (llm.bindTools?.(allTools) ?? llm) : llm
  }

  let state: HarnessState = createInitialState()
  if (options.__pgIsSubagent) state.__pgIsSubagent = true  // 子 agent 循环:主栈门禁(zero-tool-gate)豁免标记

  /** 系统段 token 预算占比(harden-context-resilience Phase 5):system 段最多占窗口 25%,余 75% 留对话+工具结果+输出 */
  const SYSTEM_BUDGET_RATIO = 0.25
  /** 跨压缩锚定段:系统段超预算时永不 drop(目标/工作记忆丢了 agent 跑偏) */
  const PIN_SEGMENT_NAMES = new Set(['mission', 'workingMemory', 'intentGuard', 'resumeNotice'])

  /** 组装 system prompt:base + 各中间件 augmentPrompt 段。
   *  超系统段预算时按「非 pin 段从大到小 drop」收敛(丢最大段优先 = 丢最少段数;dataHint 巨型 schema 常最大先丢),
   *  保 base + pin 段(mission/workingMemory)。base 本身超预算由 stream 入口 fatal 拦截(此处截不掉 base)。 */
  function buildSystemPrompt(): string {
    const base = systemPrompt || '你是一个智能助手。'
    const segs: Array<{ name: string; text: string; tokens: number; pin: boolean }> = []
    for (const m of middlewares) {
      if (m.augmentPrompt) {
        const text = m.augmentPrompt(state)
        if (text) segs.push({ name: m.name, text, tokens: estimateTokens(text), pin: PIN_SEGMENT_NAMES.has(m.name) })
      }
    }
    const budget = Math.max(2000, Math.round(caps.contextWindow * SYSTEM_BUDGET_RATIO))
    const baseTokens = estimateTokens(base)
    let total = baseTokens + segs.reduce((s, x) => s + x.tokens, 0)
    // 超预算:非 pin 段从大到小 drop(丢最大段优先 = 丢最少段数;dataHint 巨型 schema 常最大先丢)
    if (total > budget) {
      const before = total
      const dropped: string[] = []
      for (const d of segs.filter((x) => !x.pin).sort((a, b) => b.tokens - a.tokens)) {
        if (total <= budget) break
        dropped.push(`${d.name}(${d.tokens})`)
        total -= d.tokens
        d.text = ''
      }
      if (dropped.length) console.warn(`[page-agent-sdk] 系统段超预算(${before} > ${budget} tokens,窗口 ${caps.contextWindow} 的 ${SYSTEM_BUDGET_RATIO * 100}%),drop 非核心段:${dropped.join(', ')}(保 base/mission/workingMemory)`)
    }
    return [base, ...segs.filter((x) => x.text).map((x) => x.text)].join('\n\n')
  }

  /** AgentMessage[] → BaseMessage[](注入 system prompt) */
  function toLC(messages: AgentMessage[]): BaseMessage[] {
    const lc: BaseMessage[] = [new SystemMessage(buildSystemPrompt())]
    for (const msg of messages) {
      if (msg.role === 'user') {
        // image-input-vision:多模态主模型(caps.vision)把 images 组装成 content parts 直发;
        // 非 vision 主模型走 describe 旁路的转述文本(有 description 拼附加段,不改原消息);
        // 无 parts 且无 description(旁路未配/失败且入口闸未拦住)兜底纯文本 —— 不误发 parts 吃 400
        const parts = caps.vision && msg.images?.length ? buildImageContentParts(msg.content, msg.images, imageContentFormat) : null
        if (parts) lc.push(new HumanMessage({ content: parts as any })) // content parts(LangChain 多模态标准形态;Record 结构跨 provider 收敛,类型层宽松)
        else if (msg.images?.some((im) => im.description)) lc.push(new HumanMessage(appendImageDescriptions(msg.content, msg.images)))
        else lc.push(new HumanMessage(msg.content))
      } else if (msg.role === 'assistant') lc.push(new AIMessage(msg.content))
      else if (msg.role === 'system') lc.push(new SystemMessage(msg.content))
    }
    return lc
  }

  /** 重新渲染消息列表首部的 system 段(state 变化后)。
   *  只替换首部 system(主 prompt,每轮重渲染),保留其余 SystemMessage ——
   *  压缩摘要 / trim 累积摘要经 toLC 转成 SystemMessage 落在 index≥1;旧实现 filter 掉所有 system,
   *  会把这些摘要首轮即剥光 → 长对话跨轮摘要从未送达模型(主流程审查 P0-1)。
   *  循环内无新增 system(工具结果/模型回复均非 system),messages[0] 由 toLC 保证恒为主 prompt。
   *  extra 追加到主 prompt 尾部(轮次预算感知等每轮变化的横切提示;只进本轮请求,不污染历史)。 */
  function replaceSystem(messages: BaseMessage[], extra?: string): BaseMessage[] {
    const rest = messages[0] && typeOf(messages[0]) === 'system' ? messages.slice(1) : messages.slice()
    const base = buildSystemPrompt()
    return [new SystemMessage(extra ? `${base}\n\n${extra}` : base), ...rest]
  }

  /**
   * 核心模型调用(stream,洋葱最内层):聚合 chunk、emit text/reasoning
   * - 可恢复错误(网络/429/5xx)经 withRetry 自动重试;abort 不重试
   * - abort 时不抛,返回 { aborted:true, content: 已累积 partial }(保留已生成内容,等同 ChatGPT 停止)
   */
  async function coreModelCall(req: ModelRequest, onEvent?: StreamHandler, signal?: AbortSignal, caller?: BaseChatModel): Promise<ModelResponse> {
    // caller 默认 llmWithTools(绑工具);收口综合传裸 llm,避免模型再触发工具调用
    const streamer = caller ?? llmWithTools
    const retryOpts: RetryOptions = {
      signal,
      maxRetries,
      baseDelayMs: retryDelayMs,
      onRetry: ({ attempt, error, waitMs }) => {
        const reason = (error as any)?.message ?? String(error)
        log('error', { stage: 'model_retry', attempt, waitMs, error: reason })
        console.warn(`[Agent] 模型调用失败,第 ${attempt}/${maxRetries} 次重试(等 ${waitMs}ms):${reason}`)
      },
    }
    // P1-d:仅 stream「启动」(连接建立)走重试;迭代中失败时已 emit 文本 delta,withRetry 重跑 run 会从头再 emit
    // → UI 文本重复两遍。故启动失败(连接)可重试,迭代失败(已吐字)不重试,直接抛。
    // P1-7(fix-hang-and-feedback):内部 AbortController —— 流停滞超时时 abort 清理底层流(外层 signal 联动传入)
    const inner = new AbortController()
    if (signal) {
      if (signal.aborted) inner.abort()
      else signal.addEventListener('abort', () => inner.abort(), { once: true })
    }
    let stream: AsyncIterable<AIMessageChunk> | undefined
    try {
      // P1-7b(真 LLM 实测补漏):stream「启动」Promise 本身也要有闸 —— streamer.stream() 挂在等响应头
      // (modelverse 假死:fetch 默认无超时)时永不 resolve/reject,stall 看门狗(包的是已返回的迭代器)根本没开始
      // → 子 agent/主 agent 永挂(use_html 委派实测挂 17 分钟)。与 stall 同阈值同语义(超时 → StreamStalledError,
      // status=408 不当网络错空烧重试;abort 清理)
      // E3(code-review):stallMs=0 语义应为真·关闭,而非被 falsy 判定回退到 DEFAULT_STREAM_STALL_MS(90s)
      let launchTimer: ReturnType<typeof setTimeout> | undefined
      try {
        stream = await withRetry(() => {
          clearTimeout(launchTimer)  // 重试间隙清旧计时器
          const effectiveStallMs = stallMs > 0 ? stallMs : DEFAULT_STREAM_STALL_MS
          const promise = streamer.stream(req.messages, { signal: inner.signal })
          // 仅当 stallMs > 0 时才套 race 防启动挂死;0 = 完全关闭超时
          if (stallMs > 0) {
            return Promise.race([
              promise,
              new Promise<never>((_, rej) => {
                launchTimer = setTimeout(() => rej(new StreamStalledError(effectiveStallMs)), effectiveStallMs)
              }),
            ])
          }
          return promise
        }, retryOpts)
      } finally { clearTimeout(launchTimer) }
    } catch (err) {
      // 启动阶段 abort:带空 partial(等同未开始);其他错误透传(withRetry 已对可重试类重试过)
      if (isAbort(err, signal)) return { message: new AIMessage(''), toolCalls: [], content: '', aborted: true }
      // P2(harden-context-resilience):启动阶段超限(BaseChatModel.stream/_streamIterator 同步抛,未 emit)→ 激进 trim 重试一次
      if (isContextLengthError(err) && !(req as any)._ctxRetry) {
        ;(req as any)._ctxRetry = true // 单次防死循环
        const tokOf = (m: BaseMessage) => estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify((m as any).content))
        const beforeTokens = req.messages.reduce((s, m) => s + tokOf(m), 0)
        const trimmed = trimContextIfNeeded(req.messages, Math.round(caps.contextWindow * 0.3))
        const afterTokens = trimmed.reduce((s, m) => s + tokOf(m), 0)
        log('error', { stage: 'context_overflow_retry', at: 'launch', beforeTokens, afterTokens, window: caps.contextWindow })
        console.warn(`[page-agent-sdk] 上下文超限(启动)→ 激进 trim 重试:${beforeTokens} → ${afterTokens} tokens`)
        return coreModelCall({ ...req, messages: trimmed }, onEvent, signal, caller)
      }
      throw err
    }
    // catch 已 return/throw,此处 stream 必已赋值;narrow 防 TS 报 possibly undefined
    if (!stream) return { message: new AIMessage(''), toolCalls: [], content: '', aborted: true }
    let aggregated: AIMessageChunk | null = null
    let content = ''
    try {
      // P1-7:停滞看门狗 —— chunk 间隔(含等首个)超 stallMs 抛 StreamStalledError(stallMs<=0 透传关闭)
      // + 总时长上限 streamMaxMs:空转帧黑洞实测 chunk 不断但无实质内容,间隔计时被无限重置 → 绝对截止兜底
      for await (const chunk of withStallTimeout(stream, stallMs, streamMaxMs)) {
        aggregated = aggregated ? aggregated.concat(chunk) : chunk
        const textDelta = extractTextDelta(chunk)
        if (textDelta && onEvent) {
          content += textDelta
          onEvent({ type: 'text', delta: textDelta })
        }
        // reasoning 兼容:DeepSeek/OpenAI additional_kwargs.reasoning_content + Anthropic thinking parts(extractReasoningDelta 统一)
        const rDelta = extractReasoningDelta(chunk)
        if (rDelta && onEvent) onEvent({ type: 'reasoning', delta: rDelta })
      }
    } catch (err) {
      // P1-7:流停滞/总时长超限 → abort 清理底层流 + 上抛(status=408 不被当网络错重试;UI 显错误,send 路径 throw)
      if (err instanceof StreamStalledError) {
        inner.abort()
        log('error', { stage: err instanceof StreamMaxDurationError ? 'stream_max_duration' : 'stream_stalled', waitedMs: err.waitedMs, stallMs, streamMaxMs })
        throw err
      }
      // abort:不抛,带出已累积 partial;迭代中其他失败不重试(已 emit,重发会重复)→ 直接抛
      if (isAbort(err, signal)) {
        const message = (aggregated as unknown as BaseMessage) ?? new AIMessage(content)
        return { message, toolCalls: [], content, aborted: true }
      }
      // P2(harden-context-resilience):上下文超限 + 未 emit(首个 chunk 抛,provider 校验输入后即报)→ 激进 trim 重试一次
      // 红队核实:ContextOverflowError 落在此迭代 catch(非 withRetry 启动处);首个 chunk 时 aggregated===null && content==='' 未 emit,重试安全(不重复 emit)
      if (isContextLengthError(err) && aggregated === null && content === '' && !(req as any)._ctxRetry) {
        ;(req as any)._ctxRetry = true // 单次防死循环
        const tokOf = (m: BaseMessage) => estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify((m as any).content))
        const beforeTokens = req.messages.reduce((s, m) => s + tokOf(m), 0)
        const trimmed = trimContextIfNeeded(req.messages, Math.round(caps.contextWindow * 0.3)) // 更激进(0.3 vs 默认 0.6)
        const afterTokens = trimmed.reduce((s, m) => s + tokOf(m), 0)
        log('error', { stage: 'context_overflow_retry', beforeTokens, afterTokens, window: caps.contextWindow })
        console.warn(`[page-agent-sdk] 上下文超限 → 激进 trim 重试:${beforeTokens} → ${afterTokens} tokens(窗口 ${caps.contextWindow})`)
        return coreModelCall({ ...req, messages: trimmed }, onEvent, signal, caller)
      }
      throw err
    }
    // 流正常结束但零有效 chunk(网关回 200 + 错误 JSON 体非 SSE:LLM 代理黑洞实测形态,6003 error_code
    // 无 data: 前缀,SSE 解析零 chunk 即 end)→ aggregated 为 null。
    // 3.42 曾构造空 AI 消息降级(防循环层读 tool_calls 崩 TypeError),但 editor 诊断(2026-08-22)实证:
    // 用户只见沉默空回复气泡,无任何提示。现升级:① 自动重试 1 次(零 chunk = 未 emit 任何 delta,
    // 重发安全不重复;_emptyRetry 单次防死循环,同 _ctxRetry 模式);② 重试仍空 → 抛 EmptyLLMResponseError
    // 走 StreamStalledError 同款通道(send reject + error 事件 → UI 显错;子 agent 变 error result,
    // 主 agent 可自愈),不再静默空泡。
    if (aggregated === null) {
      if (!(req as any)._emptyRetry) {
        ;(req as any)._emptyRetry = true
        log('error', { stage: 'empty_llm_response_retry', hint: '流正常结束但零 chunk(网关 200+错误体形态),自动重试 1 次' })
        return coreModelCall(req, onEvent, signal, caller)
      }
      log('error', { stage: 'empty_llm_response', retried: true, hint: '重试后仍零 chunk,抛 EmptyLLMResponseError 显式报错' })
      throw new EmptyLLMResponseError()
    }
    const message = aggregated as unknown as BaseMessage
    const toolCalls = ((message as any).tool_calls || []) as ModelResponse['toolCalls']
    return { message, toolCalls, content }
  }

  /** 核心工具执行(洋葱最内层):find + invoke */
  async function coreExecTool(ctx: ToolCallContext): Promise<{ content: string; status: 'done' | 'error' }> {
    const target = allTools.find((t) => t.name === ctx.name)
    if (!target) return { content: `工具 "${ctx.name}" 不存在`, status: 'error' }
    try {
      // per-call config 通道(CA 并发修复):中间件经 ctx.callConfig 注入的键值透传到工具 fn 第二参
      // (config.configurable.__pgXxx);zod 校验会重建 args 对象,这是唯一的 per-call 干净通道。
      // 主栈 scope 锚定(rv-core F1):默认注入 __pgDataScope=''(MAIN),主 agent 数据工具不再落
      // ambient activeScope 闭包兜底 —— 并行委派下子 agent wrapWithScope 的 enter/exit 窗口会改写
      // ambient,并发主栈工具读到子 scope(子基线 undefined → autoLock 静默放行 / 主 read 误判子
      // scope 全文灌上下文)。子栈 wrapWithScope 在 invoke 时用子 scope 覆盖此键(dataOps scopeOf
      // per-call token 优先),不受默认值影响
      const callConfig = { __pgDataScope: '', ...(ctx.callConfig ?? {}) }
      const result = await (target.invoke as any)(ctx.args, { configurable: callConfig })
      let content = typeof result === 'string' ? result : JSON.stringify(result)
      // 大结果外存:经 ctx.state.files(vfs 中间件注入的共享引用),超阈值转存 vfs 只留预览+引用
      // files 非空决定「能存」,vfs_read 工具在场决定「能读」(外存引用文案引导模型 vfs_read 回读,
      // 工具不在场该引用成死路),两者都在才外存;否则退回 passThrough/截断路径(信息可达性不受损)
      const mainVfsReadAvailable = allTools.some((t) => t.name === 'vfs_read')
      content = offloadLargeResult(content, {
        files: ctx.state.files,
        vfsAvailable: !!ctx.state.files && mainVfsReadAvailable,
        toolName: ctx.name,
        threshold: offloadThreshold,
        passThroughChars: offloadPassThrough,
      }).content
      return { content, status: 'done' }
    } catch (err) {
      // 工具执行错 = recoverable(回灌 LLM 自纠);asAgentError 归一化提取 message(已是 AgentError 不覆盖)
      return { content: `工具执行出错：${asAgentError(err, 'recoverable').message}`, status: 'error' }
    }
  }

  /** 消息类型字符串(避免使用已弃用的 _getType()) */
  function typeOf(m: BaseMessage): string {
    if (m instanceof HumanMessage) return 'human'
    if (m instanceof AIMessage) return 'ai'
    if (m instanceof SystemMessage) return 'system'
    if (m instanceof ToolMessage) return 'tool'
    return 'unknown'
  }

  /**
   * 逐轮上下文保底压缩(模块级纯函数 trimContextIfNeeded 的薄封装,复用其 typeOf)
   */
  function trimContextIfNeeded(messages: BaseMessage[], maxTokens: number): BaseMessage[] {
    return trimContextIfNeededImpl(messages, maxTokens)
  }

  /** 格式化消息为接近实际请求体的结构(role 用接口名 user/assistant/tool/system,含 tool_calls/tool_call_id),按发送顺序 */
  function formatForLog(messages: BaseMessage[]) {
    // short-circuit:生产(debug=false 且无 onLog 下沉)不 stringify,省长任务每轮 O(context) → O(1)
    // (debugLogs 仍 push llm_request entry 供 round/model/tools 诊断,只是 messages 字段为空数组;
    //  debug 或 onLog 时全量格式化 —— 这两个标志在闭包内,formatForLog 可直接访问)
    if (!debug && !onLog) return []
    // map 返回独立对象;配合外层 shallowRef(不深度代理),快照天然独立,无需深拷贝
    return messages.map((m) => {
      const t = typeOf(m)
      const entry: Record<string, unknown> = {
        role: t === 'human' ? 'user' : t === 'ai' ? 'assistant' : t,
      }
      const raw = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      // 截断超长 content:llm_request 每轮记录完整 messages(O(N²) 增长),大 JSON 场景单轮可数 MB;截断保可读控内存
      if (raw) entry.content = raw.length > MAX_LOG_CONTENT_CHARS ? raw.slice(0, MAX_LOG_CONTENT_CHARS) + `…(截断 ${raw.length - MAX_LOG_CONTENT_CHARS} 字符)` : raw
      const toolCalls = (m as any).tool_calls
      if (Array.isArray(toolCalls) && toolCalls.length) {
        entry.tool_calls = toolCalls.map((tc: any) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args) },
        }))
      }
      const toolCallId = (m as any).tool_call_id
      if (toolCallId) entry.tool_call_id = toolCallId
      return entry
    })
  }

  /**
   * 流式入口 —— ReAct 循环 + 中间件
   * 兼容现有 useChat 的 fetchStream 签名。
   */
  async function stream(messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal): Promise<string> {
    // 调试日志跨 stream 累积不清(MAX_DEBUG_LOGS=300 FIFO 上限自兜底):原每次 stream 清空 → 抽屉只剩最后一轮,
    // 上一轮的提示词/工具调用详情无法回看(调试场景核心诉求)。会话级清理归 switchSession/resetSession;
    // spans/trace 仍按次重置(trace 指标是「最近一次调用」语义)。
    spans.value = []
    spanSeq = 0
    state = createInitialState()
    if (options.__pgIsSubagent) state.__pgIsSubagent = true  // 每次循环重建 state 保持子 agent 标记
    state.messages = messages

    // beforeAgent(正序):初始化中间件状态(todos/skills/memory 等)
    state = await runBeforeAgent(middlewares, state)

    // 输入压缩(summarization 中间件,链式:每个中间件依次压缩)
    let input = messages
    for (const m of middlewares) {
      if (m.compressInput) {
        const compSpan = startSpan(undefined, 'compression', `compress:${m.name}`, {})
        const r = await m.compressInput(input)
        input = Array.isArray(r) ? r : r.messages
        // 捕获最近一次压缩统计写入 state,供 DebugDrawer 可观测
        if (r && !Array.isArray(r) && r.stats) {
          state = { ...state, lastCompression: r.stats as any }
          endSpan(compSpan, 'ok', { stats: r.stats })
        } else {
          endSpan(compSpan)
        }
      }
    }

    // Phase 5(harden-context-resilience):systemPrompt(base)本身超系统段预算 → fatal 早退
    // buildSystemPrompt 截断只 drop 非 pin 段,base 截不掉;base 超窗 = 集成方传了过大 systemPrompt,无解
    {
      const baseTokens = estimateTokens(systemPrompt || '你是一个智能助手。')
      const sysBudget = Math.max(2000, Math.round(caps.contextWindow * SYSTEM_BUDGET_RATIO))
      if (baseTokens > sysBudget) {
        const errMsg = `[page-agent-sdk] systemPrompt 本身(${baseTokens} tokens)超过系统段预算(${sysBudget} tokens,窗口 ${caps.contextWindow} 的 ${SYSTEM_BUDGET_RATIO * 100}%);请缩减 systemPrompt 或换更大窗口模型`
        console.error(errMsg)
        onEvent({ type: 'error', message: errMsg, severity: 'fatal', code: 'SYSTEM_PROMPT_OVER_BUDGET' } as any)
        onEvent({ type: 'done', content: '' })
        return ''
      }
    }
    let currentMessages = toLC(input)
    log('context', { model, tools: allTools.map((t) => t.name), middleware: middlewares.map((m) => m.name) })

    const modelHandler = composeModelCall(middlewares, (req) => coreModelCall(req, onEvent, signal))
    const toolHandler = composeToolCall(middlewares, coreExecTool)

    // 自感知预算进度(context-economy-phase2 C1/C2):每 invoke 新建;state 经 runBeforeModel/runAfterModel 的 spread
    // 更新不会丢嵌套引用,augmentPrompt(state) 每轮可读到最新值(轮次/累计 usage/写失败计数)
    const progress: LoopProgress = {
      rounds: 0,
      maxToolRounds,
      invokeUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      writeFailures: {},
      budgetHinted: false,
    }
    state.loopProgress = progress

    // imperative-zero-tool-gate:本轮工具用量(事实清单原料;每 invoke 新建,门禁局部消费)
    const turnUsage: TurnToolUsage = { counts: {}, writePaths: [], failures: 0 }
    let zeroToolRetries = 0           // 门禁回灌预算(≤2,同完结门禁;超限放行 + observable 留痕)
    const maxZeroToolRetries = 2
    /** writeCapable 标注判定(单一真相源;bulkGuard/componentLock 同口径;标注缺失退 WRITE_TOOL_NAMES 名单) */
    const isWriteToolByName = (name: string): boolean => {
      const t = allTools.find((x) => x.name === name) as { writeCapable?: boolean | ((args: Record<string, unknown>) => boolean) } | undefined
      if (t && 'writeCapable' in t) return typeof t.writeCapable === 'function' ? true : t.writeCapable === true  // 条件写(eval_script transform)按保守口径计写
      return WRITE_TOOL_NAMES.has(name)
    }

    let rounds = 0
    let iterations = 0 // 总循环计数(含自纠轮),受 maxIterations 硬上限约束防死循环(harden-react-loop-budget)
    const maxIterations = computeMaxIterations(maxToolRounds, userMaxIterations)
    let lastFinalContent: string | null = null // 自纠路径缓存:verify 拒掉的最终答,供 rounds 耗尽兜底优先返回
    let formatRetries = 0 // 格式异常自纠计数:模型把工具调用写成文本(伪 XML/标签)时回灌反馈重生成,限次防死循环
    let pendingFormatRetry = false // 上一轮触发了格式自纠(已 push feedback 待 LLM 重发):让 while 暂时绕过 rounds 预算给重试机会——重试是格式修正、非工具轮次,不该被 maxToolRounds 挡。实测痛点:DSML 在 rounds 耗尽后出现,重试被 while 挡致未发生 → 仍静默死亡。maxIterations(maxToolRounds*3) 仍作死循环硬上限
    const maxFormatRetries = 2
    const maxTransitionalRetries = 2  // 过程性收口回灌上限(flash 提前收口实测;误判代价仅一轮回灌)
    let transitionalRetries = 0
    // 完结门禁(instruction-adherence A):todos 有未完成项却欲纯文本收尾 → 回灌「双出口」反馈续跑。独立预算,与 transitional 正交
    const maxGateRetries = 2
    let gateRetries = 0
    try {
      while ((rounds < maxToolRounds || pendingFormatRetry) && iterations < maxIterations) {
        iterations++ // 总循环计数(含自纠轮),触顶 maxIterations 强制退出防死循环
        // 每轮开始检查 abort(用户停止)
        if (signal?.aborted) break
        // C4 单 invoke token 预算(opt-in):模型调用前查本次累计 total_tokens,超限 → 友好收口
        // (observable emit + 中断;已完成部分保留,与用户停止同 abort 语义;不走 wrap-up 追加 LLM 调用防预算超了再烧)
        if (roundTokenBudget > 0 && progress.invokeUsage.total_tokens > roundTokenBudget) {
          const budgetMsg = `本轮 token 预算(约 ${roundTokenBudget})已用尽:任务在 ${rounds} 轮工具调用后中断,已完成的部分均保留。可继续对话,指定下一步(如「继续完成」/「只改 X」/「提高预算重试」)。`
          log('error', { stage: 'round_token_budget_exceeded', used: progress.invokeUsage.total_tokens, budget: roundTokenBudget, rounds })
          onEvent({ type: 'error', message: budgetMsg, severity: 'observable', code: 'ROUND_TOKEN_BUDGET_EXCEEDED', context: { used: progress.invokeUsage.total_tokens, budget: roundTokenBudget } } as any)
          onEvent({ type: 'done', content: budgetMsg })
          return budgetMsg
        }
        const roundSpanId = startSpan(undefined, 'round', `round ${iterations}`, { round: iterations })?.id
        onEvent({ type: 'round_start', round: iterations })  // 迭代号(含自纠轮,每轮新号);log 的 round 仍用工具轮号(rounds)便于调试追踪(harden-react-loop-budget)

        // beforeModel(正序):中间件更新 state(todos 推进等),随后重渲染 system
        state = runBeforeModel(middlewares, { messages: currentMessages, state })
        // 轮次预算感知(round-budget-awareness):预算吃紧时把提示段注入本轮 system(只在 [0] 重渲染,不污染历史消息)
        currentMessages = replaceSystem(currentMessages, roundBudgetHintText(rounds, maxToolRounds))
        // 逐轮上下文保底压缩:tool 结果累积超放行上限时,从最早的 ToolMessage 起截断为占位摘要(大模型阈值高几乎不触发)
        currentMessages = trimContextIfNeeded(currentMessages, Math.round(caps.contextWindow * 0.6)) // H1:token 口径,单轮 currentMessages ≤60% 窗口(留输出+schema)

        const modelSpan = startSpan(roundSpanId, 'model', model, { round: rounds + 1, tools: allTools.map((t) => t.name) })
        log('llm_request', {
          round: rounds + 1,
          model,
          tools: allTools.map((t) => t.name),
          messages: formatForLog(currentMessages),
        })

        const response = await modelHandler({ messages: currentMessages, state })
        currentMessages.push(response.message)

        log('llm_response', { round: rounds + 1, content: response.content, toolCalls: response.toolCalls })
        // usage 兼容:OpenAI/DeepSeek additional_kwargs.usage + Anthropic response_metadata.usage(extractUsage 统一;主链 usage 累加已在 sdk-events 多 provider fallback)
        endSpan(modelSpan, response.aborted ? 'timeout' : 'ok', { usage: extractUsage(response.message) })
        // C1 自感知预算:本 invoke 累计 usage(normalizeUsage 归一 camelCase 兼容;主链会话级累加不受影响)
        {
          const nu = normalizeUsage(response.message)
          if (nu) {
            progress.invokeUsage.prompt_tokens += nu.prompt_tokens ?? 0
            progress.invokeUsage.completion_tokens += nu.completion_tokens ?? 0
            progress.invokeUsage.total_tokens += nu.total_tokens ?? 0
          }
        }

        state = runAfterModel(middlewares, response, state)

        // 模型被 abort(用户停止):保留已累积 partial,正常结束(不执行后续工具)
        if (response.aborted) {
          onEvent({ type: 'done', content: response.content })
          return response.content
        }

        if (!response.toolCalls.length) {
          const garbled = detectGarbledToolCall(response.content)
          // 升级(#95):garbled 时先尝试解析 DSML/伪 XML → 标准 tool_calls(免重试,直接执行)
          const parsed = garbled ? parseGarbledToolCalls(response.content) : null
          if (parsed && parsed.length) {
            // 解析成功:补 response.toolCalls(下面 484 执行)+ message.tool_calls(消息历史 / ToolMessage tool_call_id 关联)
            response.toolCalls = parsed
            const msgAny = response.message as any
            if (msgAny) msgAny.tool_calls = parsed.map((p) => ({ id: p.id, name: p.name, args: p.args, type: 'tool_call' }))
            log('middleware', { stage: 'dsml_parsed', count: parsed.length, names: parsed.map((p) => p.name) })
            // 补成功 → 跳过下面的 garbled 重试 / done,落到 484 执行工具(本轮走工具执行分支,清 pendingFormatRetry 由 481 统一)
          } else {
            // 解析失败(无 invoke / 截断不完整)/ 非 garbled:原 #73 逻辑(重试 → 耗尽 emit error → done)
            // 格式异常自纠:模型把工具调用写成文本(DeepSeek <｜tool_calls｜> / <｜｜DSML｜｜> / 伪 XML <invoke> 等)
            // 而非标准 tool_calls,系统未识别 → 未执行。回灌 feedback 让模型用标准 function calling 重新发起,限次防死循环。
            // pendingFormatRetry=true 让 while 暂时绕过 rounds 预算给 LLM 重发机会(重试是格式修正,非工具轮次;
            // 实测:DSML 在 rounds 耗尽后出现,重试被 while 挡致未发生 → 仍静默死亡;maxIterations 兜底防死循环)
            if (garbled && formatRetries < maxFormatRetries) {
              formatRetries += 1
              pendingFormatRetry = true
              log('middleware', { stage: 'format_retry', attempt: formatRetries, content: response.content.slice(0, 200) })
              currentMessages.push(new HumanMessage('⚠️ 你刚才把工具调用写成了文本(伪 XML/标签/DSML 标记,如 <｜tool_calls｜>、<｜｜DSML｜｜>、<invoke name=...>),未被系统识别为工具调用,因此未执行,页面无变化。请直接用标准 function calling(工具调用)格式重新发起工具调用,不要在回复正文里输出这些标签或 JSON 文本。'))
              continue
            }
            // 重试耗尽仍 garbled:不静默 final——emit observable error 让用户/集成方知晓任务可能未完成。
            // 实测痛点:DeepSeek 长 tool-call 链持续退化,重试 maxFormatRetries 次仍 DSML,此前直接 done 无任何提示,
            // UI 以为 agent "答完了"但其实没干活。此处 emit error(observable 不中断,仍 return content 让 UI 显示原文)。
            if (garbled) {
              const msg = `模型连续 ${maxFormatRetries} 次输出无法解析的工具调用格式(DSML/伪标签),任务可能未完成。请重试或换模型。`
              log('error', { stage: 'garbled_exhausted', retries: formatRetries, content: response.content.slice(0, 200) })
              onEvent({ type: 'error', message: msg, severity: 'observable', code: 'GARBLED_TOOL_CALL_EXHAUSTED', context: { content: response.content.slice(0, 200) } } as any)
            }
            // 过程性收口回灌(flash 实测):最终文本是计划/行动叙述而非完成汇报时回灌让模型继续执行,限次防死循环。
            //  - rounds>0:短文本过渡性收口(detectTransitionalReply,「我先看看…稍后委派」调研完即停)
            //  - rounds===0:第 0 轮零 tool_calls 长文行动叙述(detectActionNarration,修「中途停止」:
            //    模型把「我来添加/先加载」当正文吐、不走 function calling,ReAct 误当最终回答结束、零执行)
            // pendingFormatRetry=true 同款语义:绕过 rounds 预算给重试机会(此轮非工具轮次)
            const transitional = rounds > 0 ? detectTransitionalReply(response.content) : detectActionNarration(response.content)
            if (!garbled && transitionalRetries < maxTransitionalRetries && transitional) {
              transitionalRetries += 1
              pendingFormatRetry = true
              log('middleware', { stage: 'transitional_retry', attempt: transitionalRetries, rounds, content: response.content.slice(0, 160) })
              currentMessages.push(new HumanMessage('⚠️ 你刚才只输出了计划/行动叙述(如「我先看看」「开始添加」),没有发起任何工具调用,因此什么都未执行。请立即用标准 function calling 调用所需工具把任务做完,全部完成后再给出总结回复。'))
              continue
            }
            // 完结门禁(instruction-adherence A):todos 有未完成项却以纯文本收尾 → 回灌「双出口」反馈(已完成→update_todo 标记 / 未完成→继续)续跑。
            // 同 transitional 模式:pendingFormatRetry 绕过 rounds 预算(补完任务不是新工具轮;maxIterations 总闸兜底)。
            // 预算 2:「忘标 completed」一次回灌即收敛;两次仍收口 = 模型异常 → 放行强收防死循环烧 token。
            // rounds > 0 前置(修跨轮陈旧 todos 误报):todos 随会话持久化,上一轮遗留的未完成清单不该在
            // 本轮纯问答轮(零工具调用)发难 ——「计划了没做完」必然发生在工具轮之后,与 transitional 的 rounds 分支同款模式。
            // 位置在 transitional 之后(先治「光说不做」再治「做了一半」)、beforeReturn 之前(verify 是写后回查 opt-in,语义无关)。
            // 豁免问句收尾/空 todos 在 detectIncompleteFinish 内(宁漏勿误);子 agent 无 planning 工具 todos 恒空,天然不触发。
            if (!garbled && rounds > 0 && gateRetries < maxGateRetries && detectIncompleteFinish(state.todos, response.content)) {
              gateRetries += 1
              pendingFormatRetry = true
              log('middleware', { stage: 'completion_gate', attempt: gateRetries, pending: state.todos.filter((t) => t.status !== 'completed').map((t) => t.id), content: response.content.slice(0, 160) })
              currentMessages.push(new HumanMessage(buildGateFeedback(state.todos)))
              continue
            }
            // imperative-zero-tool-gate(操作指令零工具收尾门禁,防谎报完成):完结门禁只盯 todos,「拆 0 说做完」
            // (不建 todos 直接纯文本谎报「已完成」)绕过它。三要素 AND:①用户消息为操作祈使 ②本轮零写/零委派
            // ③纯文本收尾且非问句。回灌带事实清单(D5:机制供给事实,LLM 对账复述,与清单不符无处嘴硬);
            // 预算 ≤2 超限放行 + observable 留痕(对齐 garbled 耗尽模式 —— 谎报放行是最该让集成方感知的时刻)。
            // 无 rounds 前置(谎报第 1 路恰发生在 rounds===0);intentGuard 命中最新 user 消息时跳过
            // (双信号对冲:pin 段说别做、本门禁说快做会打架);出口①机械化:收口文本含位置说明 → 不再二次回灌。
            // 子 agent 不触发:装配期只装主栈,子栈 state.__pgIsSubagent 标记。
            const lastHumanContent = (() => { for (let mi = currentMessages.length - 1; mi >= 0; mi--) { const m = currentMessages[mi]; if ((m as unknown as { _getType?: () => string })._getType?.() === 'human') return String((m as unknown as { content?: unknown }).content ?? '') } return '' })()
            if (!garbled && !state.__pgIsSubagent && zeroToolRetries < maxZeroToolRetries
              && isZeroEffectiveWrite(turnUsage, isWriteToolByName)
              && detectActionImperative(lastHumanContent)
              && !mentionsLocation(response.content)
              && !/[?？]\s*$/.test(response.content.trim())) {
              zeroToolRetries += 1
              pendingFormatRetry = true
              log('middleware', { stage: 'zero_tool_gate', attempt: zeroToolRetries, factSheet: buildTurnFactSheet(turnUsage, state.todos, isWriteToolByName), content: response.content.slice(0, 160) })
              currentMessages.push(new HumanMessage(buildZeroToolFeedback(buildTurnFactSheet(turnUsage, state.todos, isWriteToolByName))))
              continue
            }
            // status-query-zero-verify-gate(状态询问零核实断言门禁,editor 实测 2026-08-21):「写到了哪里/
            // 完成了吗」类状态询问,agent 本轮连 read 都没调却断言「已写入/已完成」(凭对话记忆编状态表)→
            // 回灌先核实。触发场景:委派失败(keep_external/轮次上限)+ 页面刷新回退后记忆全陈旧,
            // resumeNotice 纯提示词管不住。与 imperative gate 共用回灌预算(zeroToolRetries,防死循环);
            // 调过任何工具(含 read)= 至少核实过,不触发;断言词不命中(如实说「未写入」)不触发。
            if (!garbled && !state.__pgIsSubagent && zeroToolRetries < maxZeroToolRetries
              && isZeroToolCalls(turnUsage)
              && detectStatusQuery(lastHumanContent)
              && assertsCompletion(response.content)) {
              zeroToolRetries += 1
              pendingFormatRetry = true
              log('middleware', { stage: 'status_query_gate', attempt: zeroToolRetries, factSheet: buildTurnFactSheet(turnUsage, state.todos, isWriteToolByName), content: response.content.slice(0, 160) })
              currentMessages.push(new HumanMessage(buildStatusQueryFeedback(buildTurnFactSheet(turnUsage, state.todos, isWriteToolByName))))
              continue
            }
            // 预算耗尽仍零工具收尾:observable 留痕(评审 1-10;谎报放行恰是最该让集成方知晓的时刻,不能零感知)
            if (!garbled && !state.__pgIsSubagent && zeroToolRetries >= maxZeroToolRetries && isZeroEffectiveWrite(turnUsage, isWriteToolByName)
              && detectActionImperative(lastHumanContent)) {
              onEvent({ type: 'error', message: '操作指令经 2 次回灌后仍以零工具纯文本收尾(疑似谎报完成),已放行;最终回复可能不实', severity: 'observable', code: 'ZERO_TOOL_GATE_EXHAUSTED', context: { factSheet: buildTurnFactSheet(turnUsage, state.todos, isWriteToolByName) } } as any)
            }
            // beforeReturn 钩子(正序):agent 返回前可拦截自纠(回灌 user 消息继续循环)。
            // garbled 时不跑 verify(garbled content 跑 verify 无意义);预算检查前置(verifyAttempts < maxVerifyAttempts):避免预算耗尽仍跑钩子(尤其 adversarial 子 agent 烧 token),框架级防御不靠中间件自觉
            if (!garbled && maxVerifyAttempts > 0 && state.verifyAttempts < maxVerifyAttempts) {
              const feedback = await runBeforeReturn(middlewares, { messages: currentMessages, state, response, log: (t, d) => log(t as DebugLog['type'], d) })
              if (feedback) {
                lastFinalContent = response.content // 缓存最终答:自纠若耗尽 rounds 预算,兜底优先返回它(而非误导性"请简化问题")
                state.verifyAttempts += 1
                currentMessages.push(new HumanMessage(`⚠️ 验证未通过,请修正:${feedback}`))
                log('middleware', { stage: 'verify_retry', attempt: state.verifyAttempts, feedback })
                continue // 回灌反馈,继续循环让模型修正(不 return)
              }
            }
            pendingFormatRetry = false // 收口:正常 final 或 garbled 重试耗尽(已 emit error)→ 清 flag
            // garbled 重试耗尽:原文里的 DSML/伪 XML 块对用户是乱码(且工具未执行)——剥离标记前 prose 返回 + 注记;
            // 剥离后无剩余 → 诚实兜底文案(3.11 真 LLM 实测:截断的 DSML 任务规格被当结论返回,委派零落地零提示)
            let finalContent = response.content
            if (garbled) {
              const prose = sanitizeGarbledContent(finalContent)
              finalContent = prose
                ? `${prose}\n\n(注:此后模型输出了无法解析的工具调用文本,该调用未执行,任务可能未完成。)`
                : '模型多次输出无法解析的工具调用格式,本次任务可能未完成。请重试或继续指示。'
            }
            onEvent({ type: 'done', content: finalContent })
            return finalContent
          }
        }
        pendingFormatRetry = false // 走到这里 = 本轮有标准 tool_call(重试成功或正常),清 flag

        // 执行工具(经 wrapToolCall 洋葱;按 maxParallelTools 并发,默认 1 串行保持原语义)
        const calls = response.toolCalls
        const ctxs = calls.map((call) => {
          const id = call.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          return { id, call, ctx: { id, name: call.name, args: call.args, state, signal, emit: onEvent, logSink: pushLog } as ToolCallContext }
        })
        // 并发池执行(emit tool_call/result 在 fn 内,串行时保持交替 UX;结果按原顺序收集)
        const results = await runPool(
          ctxs,
          maxParallelTools,
          async (c) => {
            if (signal?.aborted) return undefined // 双保险:abort 不启动新工具
            const toolSpan = startSpan(roundSpanId, 'tool', c.call.name, { name: c.call.name })
            const t0 = Date.now()   // 独立计时(不依赖 tracing;span 仅 tracing 开启时才有 durationMs)
            onEvent({ type: 'tool_call', name: c.call.name, args: c.call.args, id: c.id })
            log('tool_call', { round: rounds + 1, name: c.call.name, args: c.call.args, id: c.id })
            let result: { content: string; status: 'done' | 'error' }
            try {
              result = await toolHandler(c.ctx)
            } catch (err) {
              // E1(arch P1-1):wrapToolCall 洋葱外层 catch → 普通Error转recoverable错误结果回灌
              // (与 coreExecTool 内部 asAgentError(err,'recoverable') 语义对齐)
              // abort 保留语义:不吞,直接抛(让外层 abort 检查处理)
              if (isAbort(err, signal)) throw err
              const agentErr = asAgentError(err, 'recoverable')
              result = { content: `工具执行出错：${agentErr.message}`, status: 'error' }
            }
            const durationMs = Date.now() - t0
            onEvent({ type: 'tool_result', name: c.call.name, result: result.content, status: result.status, durationMs, id: c.id })
            log('tool_result', { round: rounds + 1, name: c.call.name, result: result.content, status: result.status, durationMs })
            endSpan(toolSpan, result.status === 'error' ? 'error' : 'ok', { resultSnippet: String(result.content).slice(0, 100) })
            return result
          },
          signal,
        )
        // 按原 tool_calls 顺序回填 ToolMessage(跳过 abort 未执行的)
        for (let i = 0; i < ctxs.length; i++) {
          const r = results[i]
          if (!r) continue
          currentMessages.push(new ToolMessage({ tool_call_id: ctxs[i].id, content: r.content }))
        }
        // C2 写失败计数:写工具同路径连续 error +1 / 成功清零(达 ≥2 由 usageHints 注入提醒;纯确定性,零 LLM 成本)
        for (let i = 0; i < ctxs.length; i++) {
          const r = results[i]
          if (!r || !WRITE_TOOL_NAMES.has(ctxs[i].call.name)) continue
          const key = extractWriteTargetPath(ctxs[i].call.args)
          if (r.status === 'error') progress.writeFailures[key] = (progress.writeFailures[key] ?? 0) + 1
          else delete progress.writeFailures[key]
        }
        // imperative-zero-tool-gate:本轮工具用量捕获(事实清单原料 —— 按名计数/成功写路径/失败数)
        // stale-read-invalidation:同循环收集本批成功写记录(name/args/callIndex),批后做一次失效占位
        const batchWrites: StaleWriteRecord[] = []
        for (let i = 0; i < ctxs.length; i++) {
          const r = results[i]
          if (!r) continue
          const name = ctxs[i].call.name
          turnUsage.counts[name] = (turnUsage.counts[name] ?? 0) + 1
          if (r.status === 'error') turnUsage.failures += 1
          // stale-read-invalidation Phase 0:写成功判定改 isSuccessfulWriteResult 四重门槛
          // (writeCapable args-aware + 非 dryRun + 非 throw + 非 ERROR: 字符串)—— dataOps 业务失败
          // 是 return toolError 字符串不 throw,旧口径只看 status 会把 SCHEMA_INVALID 的写计入
          // fact-sheet「成功写入路径」,零工具门禁的事实清单失真(评审 A1 同源缺陷)
          if (isSuccessfulWriteResult(allTools.find((t) => t.name === name) as (Record<string, unknown> & { name: string }) | undefined, ctxs[i].call.args, r)) {
            const p = extractWriteTargetPath(ctxs[i].call.args)
            turnUsage.writePaths.push(p || '(整体)')
            batchWrites.push({ name, args: ctxs[i].call.args, callIndex: i })
          }
        }
        // stale-read-invalidation(写驱动过期读失效):本批成功写 → 此前被击中路径的旧 read/query/search
        // 结果替换为失效占位(路径提取自 AIMessage.tool_calls,幂等;同批串行序:写后读不失效)
        if (staleReadInvalidation && batchWrites.length) {
          const inv = invalidateStaleReads(currentMessages, batchWrites, { round: rounds + 1, maxParallelTools })
          if (inv.invalidatedCount > 0) {
            currentMessages = inv.messages
            staleReadsInvalidated += inv.invalidatedCount
            log('middleware', {
              stage: 'stale_read_invalidated',
              round: rounds + 1,
              writtenPaths: batchWrites.map((w) => extractWriteTargetPath(w.args) || '(整体)'),
              invalidatedCount: inv.invalidatedCount,
            })
          }
        }
        if (signal?.aborted) break // 中止则不进入下一轮
        rounds++
        progress.rounds = rounds
      }

      // 循环退出:abort(用户停止)或达到最大轮次
      if (signal?.aborted) {
        onEvent({ type: 'done', content: '' })
        return ''
      }
      // 非 abort 退出 while = maxToolRounds/maxIterations 触顶被强制收口(正常完成在循环内 return)。
      // 修「莫名停了」痛点:observable 留痕(DebugDrawer/集成方 onEvent 可观测)+ 可见提示附到各收口出口,
      // 明确告知「调用次数到上限、任务可能未完成、可回复继续」。
      const limitNote = `\n\n(提示:工具调用次数已达上限(${maxToolRounds} 轮 / ${maxIterations} 次迭代),以上为基于已完成操作的阶段性结果,任务可能未完成。回复「继续」或告诉我下一步重点,即可接着做。)`
      log('error', { stage: 'react_call_limit_exceeded', rounds, maxToolRounds, iterations, maxIterations })
      onEvent({ type: 'error', message: `ReAct 循环达到调用上限(rounds=${rounds}/${maxToolRounds},iterations=${iterations}/${maxIterations}),已强制收口,可回复「继续」。`, severity: 'observable', code: 'REACT_CALL_LIMIT_EXCEEDED', context: { rounds, maxToolRounds, iterations, maxIterations } } as any)
      // 自纠耗尽 rounds 预算 → 优先返回最近一次缓存的有效最终答
      if (lastFinalContent != null) {
        const c = lastFinalContent + limitNote
        onEvent({ type: 'done', content: c })
        return c
      }
      // 工具轮耗尽且未综合:末尾是 ToolMessage → 强制收口综合(裸 llm 不绑工具,注入「工具已用尽,直接作答」提示),
      // 保证最终一定有综合输出,而非白费全部工具产出后丢一句「请简化问题」
      const last = currentMessages[currentMessages.length - 1]
      if (last && typeOf(last) === 'tool') {
        // E2(code-review):只移除首条 system(主 prompt),保留中部压缩摘要 SystemMessage(由 summarization 中间件注入)
        // 旧实现 filter 掉所有 system → 长对话跨轮摘要首轮即剥光 → 从未送达模型(P0-1 修复的对立面)
        const rest = currentMessages[0] && typeOf(currentMessages[0]) === 'system' ? currentMessages.slice(1) : currentMessages.slice()
        const wrapUpMessages = [
          new SystemMessage(
            buildSystemPrompt() + '\n\n工具调用次数已达上限,请基于已有工具结果直接给出最终回答,不要再调用工具。',
          ),
          ...rest,
        ]
        log('llm_request', { round: 'wrap_up', model, tools: [], messages: formatForLog(wrapUpMessages) })
        // P1-1(arch-review):wrap-up 经中间件 wrapModelCall 洋葱 + afterModel,与主循环 modelHandler 对齐。
        // 此前直接调 coreModelCall 绕过中间件栈 → 收口轮 token 不计入 sdk-events afterModel 的 usage 累加(漏计 sdk.usage),
        // 且 budget 预算闸 / 用户自定义 wrapModelCall(埋点/缓存)在收口轮失效。裸 llm(不绑工具)防收口再触发工具调用。
        // 不跑 beforeModel:收口轮不需 todos 推进等 state 变更,且避免重渲染 system 覆盖上方收口提示。
        const wrapUpHandler = composeModelCall(middlewares, (req) => coreModelCall(req, onEvent, signal, llm))
        const resp = await wrapUpHandler({ messages: wrapUpMessages, state })
        state = runAfterModel(middlewares, resp, state)
        log('llm_response', { round: 'wrap_up', content: resp.content })
        if (resp.aborted) {
          onEvent({ type: 'done', content: resp.content })
          return resp.content
        }
        if (resp.content) {
          // wrap-up 同样可能泄漏 DSML(3.11 真 LLM 实测:轮次耗尽收口时模型仍试图以文本委派,裸 llm 无工具可解析,
          // 原文直接返回 = 未解析的任务规格当结论)——同款剥离 + observable error(与主循环 garbled_exhausted 对齐)
          let wrapUpText = resp.content
          if (detectGarbledToolCall(wrapUpText)) {
            const prose = sanitizeGarbledContent(wrapUpText)
            log('error', { stage: 'garbled_wrapup', content: wrapUpText.slice(0, 200) })
            onEvent({ type: 'error', message: '模型在收口(工具轮耗尽)时输出无法解析的工具调用格式,任务可能未完成。请重试或换模型。', severity: 'observable', code: 'GARBLED_TOOL_CALL_EXHAUSTED', context: { content: wrapUpText.slice(0, 200) } } as any)
            wrapUpText = prose
              ? `${prose}\n\n(注:工具调用次数已达上限,模型最后试图发起的调用未执行,任务可能未完成。)`
              : '我已完成本轮能做的部分操作,但最后的计划未能执行(工具调用次数已达上限)。请重试或继续指示。'
          }
          onEvent({ type: 'done', content: wrapUpText + limitNote })
          return wrapUpText + limitNote
        }
      }
      // 收口也无文本(极端)→ 兜底文案
      const fallback = '我已完成本轮能做的操作,但未能综合出最终结论。请基于上方已完成的工具操作结果继续,或告诉我下一步重点。'
      onEvent({ type: 'done', content: fallback + limitNote })
      return fallback + limitNote
    } finally {
      // afterAgent 必跑(含异常路径):中间件清理/flush 不因模型或中间件抛错被跳过;其自身错误吞掉不影响主流程
      try {
        await runAfterAgent(middlewares, state)
      } catch (e) {
        // afterAgent 清理错 = observable(不中断主流程);归一化 + warn(显式 severity,为 trace 预留)
        const ae = asAgentError(e, 'observable')
        console.warn(`[Agent] afterAgent 清理出错(observable,已忽略):`, ae.message)
      }
      // trace:agent 调用结束(finally 必跑,覆盖所有出口),emit spans + metrics(createChatSdk 经 onTrace → emit('trace'))
      if (tracingEnabled && onTrace) {
        try { onTrace(spans.value, getTraceMetrics(spans.value)) } catch { /* onTrace 抛错忽略,不影响主流程 */ }
      }
    }
  }

  /** 非流式入口(复用 stream,聚合最终文本;透传 signal 支持停止;onEvent 可选监听过程事件 —— fix-hang-and-feedback P1-1:send/batch 经此收口 approval_request) */
  async function invoke(messages: AgentMessage[], signal?: AbortSignal, onEvent?: StreamHandler): Promise<string> {
    let final = ''
    await stream(
      messages,
      (e) => {
        if (e.type === 'done') final = e.content
        onEvent?.(e)
      },
      signal,
    )
    return final
  }

  /**
   * 运行时替换用户工具集(内置工具由中间件贡献,不动)。
   * 重算 allTools = [中间件贡献工具 + userTools] + rebindTools();下一轮 LLM 调用即用新工具集。
   * 不调用 = 现状行为(创建时 tools 固定)。
   */
  function setTools(userTools: StructuredToolInterface[]): void {
    allTools = [...middlewares.flatMap((m) => m.tools || []), ...userTools]
    rebindTools()
  }

  /**
   * 运行时切换 LLM 实例(配额耗尽切便宜模型 / 复杂任务切强模型 / 切 provider)。
   * 替换 llm + rebindTools + onLlmChange 回调(供 createChatSdk 重解析模型能力 contextWindow/maxOutputTokens)。
   * 新模型若不支持 tool calling(bindTools 缺失),rebindTools 退回裸 llm —— 工具调用会失效但 agent 不崩。
   */
  function setLlm(newLlm: BaseChatModel): void {
    llm = newLlm
    rebindTools()
    onLlmChange?.(newLlm)
  }

  return {
    invoke,
    stream,
    getState: () => state,
    // getter:setTools/setLlm 后 allTools 重赋值,getter 始终取最新(inspect().tools 动态反映)
    get allTools() { return allTools },
    /** stale-read-invalidation 会话累计失效数(getInfo/inspect 反射;createChatSdk 经 AgentInfo.staleReadsInvalidated 暴露) */
    getStaleReadsInvalidated: () => staleReadsInvalidated,
    /** 会话切换/重置时清零(与 debugLogs 清空同点位调用,防旧会话计数带进新会话) */
    resetStaleReadsInvalidated: () => { staleReadsInvalidated = 0 },
    setTools,
    setLlm,
    setModelCaps,
    debugLogs,
    spans,
    // 复用内部权威拼装(base + Σ augmentPrompt),供 getInfo/inspect 收敛为单一真相源(fix-introspection-consistency)
    getEffectiveSystemPrompt: () => buildSystemPrompt(),
  }
}
