/**
 * 框架无关 SDK 入口 —— createChatSdk
 *
 * 组装:harness(createAgent)+ 内置中间件(todos/skills/vfs/memory/permissions)
 *   + 内置工具(数据操作/fetch 文档)+ 用户工具/skills/memory/data
 *   + 持久化(IndexedDB,降级内存;多 agent id 隔离;全局配额/LRU 淘汰)
 * 对外命令式 API:mount(container) / unmount() / send(message) / switchSession()。
 * 内部用 Vue 渲染 ChatDialog(打包进 SDK,使用者无需安装 Vue)。
 *
 * 持久化模型:三层命名空间 DB→agentId→sessionId。
 *   - send() 与 mount()(经 useChat)共享同一响应式 messages 数组(唯一来源)。
 *   - mount 异步:await 持久化恢复 → 构造 agent → 渲染。
 *
 * 共享上下文(shareContext):同 agentId 的多个 createChatSdk 实例可复用同一 AgentCore
 *   (messages/agent/vfsStore/store/todos/memory 全共享 = 「同一 agent 的多个对话框视图」)。
 *   模块级 sharedCores 注册表 + 引用计数;mount/unmount 各自渲染到不同 container。
 */
import { reactive, ref, type Ref } from 'vue'
import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { DialogIcons } from '../components/icons'
import { createAgent, type DebugLog } from '../harness/createAgent'
import { asAgentError } from '../tools/toolError'
import { isAbort } from '../harness/retry'
import { z, type ZodType } from 'zod'
import { getSchemaAtPath, schemaHasCodeField, inferWritablePaths } from '../tools/schemaUtils'
import { systemPromptHelpers } from '../presets'
import { createTodosMiddleware } from '../harness/todos'
import { createMissionMiddleware } from '../harness/mission'
import { createFocusMiddleware } from '../harness/focus'
import { createWorkingMemoryMiddleware } from '../harness/workingMemory'
import { createSkillsMiddleware, type SkillSpec } from '../harness/skills'
import { createMemoryMiddleware } from '../harness/memory'
import { createPermissionsMiddleware, type PermissionRule } from '../harness/permissions'
import { createApprovalMiddleware } from '../harness/approval'
import { createHumanConfirmTool, createHumanConfirmMiddleware, HUMAN_CONFIRM_TOOL_NAME } from '../harness/humanConfirm'
import {
  createCheckpointManager,
  createCheckpointMiddleware,
  restoreInPlace,
  type CheckpointManager,
} from '../harness/checkpoint'
import type { Middleware } from '../harness/middleware'
import { createSubagentMiddleware, createSubagentsMiddleware, createSubagentTracker, type SubagentConfig, type SubagentRunState } from '../harness/subagent'
import { createVerifyMiddleware, createWriteBackCheck, type VerifyCheck } from '../harness/verify'
import { createContextInspectorMiddleware } from '../harness/contextInspector'
import { connectMcp, type McpServerConfig } from '../mcp/client'
import { createSummarizationMiddleware } from '../harness/summarization'
import { buildDataPrompt, buildSystemPrompt } from './promptBuilder'
import { createCodeAssetMiddleware, collectComponentNames } from './codeAssetMiddleware'
import { createComponentLock, resolveTargetComponents, createComponentWriteGuardMiddleware } from './componentLock'
import { createHtmlSubagent } from './htmlSubagent'
import { isChatModel, resolveLlm, deriveTitle } from './llmResolver'
import { constructLlmFromConfig, constructOpenLlmSync } from '../llm/constructLlm'
import { createConflictManager } from './conflictManager'
import { resolveStorage, resolveDialogConfig } from './optionsResolver'
import { resolveCapabilities } from '../capabilities'
import { createSdkEvents } from './events'
import type { ContextManagerOptions } from '../composables/useContextManager'
import { resolveContextOptions, PRESET_PRESERVE, type ContextPreset } from './contextPreset'
import { composeMiddlewareStack } from './middlewareStack'
import { createVfs, createVfsMiddleware, VFS_TOOL_NAMES, normalize as normalizeVfsPath, type VfsStore } from '../backends/vfs'
import type { VfsFile, HarnessState, Mission, Focus } from '../harness/state'
import { createDataOps, filterByToolMode, type DataConfig, type DataOpsController, type ConflictResolution } from '../tools/dataOps'
import { fetchDocTools } from '../tools/fetchDoc'
import { domTools } from '../tools/domTool'
import { inspectTools } from '../tools/envTool'
import { getTraceMetrics } from '../utils/traceMetrics'
import { createBudgetMiddleware } from '../harness/budget'
import { actionsToTools, actionsToInspectInfo, type ActionMap } from './actions'
import { selectBuiltinTools } from '../toolsets'
import { dedupeTools } from './toolRegistry'
import { createUsageHintsMiddleware } from '../harness/usageHints'
import { createResourcesPinMiddleware } from '../harness/resourcesPin'
import { type SessionStore, type StorageConfig, type StorageBackendType, type SessionSnapshot, type SessionMeta } from '../backends/storage'
import { createSkillStore, type SkillStore, type SkillStoreConfig, type PersistedSkill } from '../backends/skillStore'
import { makeId } from '../utils/id'
import { resolveModelCaps, MIN_CONTEXT_WINDOW } from '../utils/modelCaps'
import { trimMemoryMessagesImpl, composeTrimSummary } from '../utils/rounds'
import { indexSummarize, resolvePromptSoftCap } from '../composables/contextIndex'
import { extractVfsRefs, gcVfsLargeResults } from '../utils/vfsGc'
import { DEFAULT_STREAM_STALL_MS } from '../utils/stallTimeout'
import { createSerialRunner } from '../utils/serialRunner'
import { normalizeUsage } from '../utils/contentParts'
import type { AgentMessage, StreamHandler, AgentInfo, SdkEvent, SdkEventHandler, TokenUsage, BatchResult, BatchProgress } from '../types'
import type { ToolCallContext } from '../harness/middleware'

export interface LLMConfig {
  apiKey: string
  /** provider 选择:缺省 'openai'(兼容 OpenAI/DeepSeek 协议,向后兼容);'anthropic' 动态加载 @langchain/anthropic 走 Claude */
  provider?: 'openai' | 'anthropic'
  baseUrl?: string
  model?: string
  temperature?: number
  maxTokens?: number
  /** 模型上下文窗口(token);缺省按 model 名查表。影响 offload 阈值与压缩触发(大模型自适应) */
  contextWindow?: number
  /** 模型最大输出(token);缺省按 model 名查表。maxTokens 未传时作其缺省,避免设错被截断 */
  maxOutputTokens?: number
  /** 透传 ChatOpenAI 的 modelKwargs:额外请求 body 参数(如 deepseek thinking: { thinking: { type: 'enabled' } }) */
  extraBody?: Record<string, any>
  /** 透传 ChatOpenAI configuration 的额外字段(如 headers/timeout/customFetch),与 baseUrl 合并 */
  extraConfig?: Record<string, any>
}

/** 单 agent 实例的会话控制 */
export interface SessionOptions {
  /** 显式会话 id(载入指定会话;不存在则以该 id 新建) */
  id?: string
  /** 自动恢复最近会话(默认 true;false 则每次新建) */
  autoResume?: boolean
  /** 会话标题(供未来会话列表 UI) */
  title?: string
}

/**
 * augmentSystem 钩子上下文:集成方回调据此按运行时状态动态注入 system prompt 段。
 * - `state`:harness 当前状态(messages/todos/files/skills/memory…);**不含 data**(data 是 createChatSdk 层概念,不下沉通用 HarnessState)
 * - `data`:当前主数据配置(每轮从 liveData() 取最新,setData 后自动同步;含 schema/bind/description)
 */
export interface SystemAugmentContext {
  state: HarnessState
  data?: DataConfig
}

export interface ChatSdkOptions {
  /** 挂载点(选择器或元素;headless 模式 ui:false 时可不传) */
  container?: string | HTMLElement
  /** UI:'default'(默认,渲染内置 ChatDialog)/ false(headless 不渲染,只返回 agent 核心,集成方自建 UI) */
  ui?: boolean | 'default'
  /** LLM:配置对象(LLMConfig,兼容 OpenAI 协议)或预构造模型实例(任意 provider,provider 抽离) */
  llm: LLMConfig | BaseChatModel
  /**
   * agent 实例 id(多 agent 共存隔离用)。强烈建议传稳定值:刷新后据此恢复数据。
   * 不传则随机生成并告警(刷新后无法恢复)。
   */
  id?: string
  /** 持久化:默认关闭;赋值后端字符串('indexed'/'session'/'local'/'memory')或配置对象开启;false 关闭 */
  storage?: StorageBackendType | StorageConfig | false
  /** 会话控制 */
  session?: SessionOptions
  /** 共享上下文:默认 false(每实例独立);true 时同 id 复用同一 AgentCore(同页多对话框 = 同一 agent) */
  shareContext?: boolean
  /**
   * 系统提示词(base + 可操作数据段,数据段随 data 动态;不含 todos/skills/memory/augmentSystem 等运行态 augmentPrompt 段)。
   * 通用「JSON 操作助手」身份,可覆盖。自定义时默认自动追加 reliableWriteRules(见 appendReliableWriteRules)。
   */
  systemPrompt?: string
  /** 自定义 systemPrompt 时是否自动追加 reliableWriteRules(默认 true,用 '---' 分隔线区分用户内容与 SDK 追加的写入规则);设 false 则不追加(用户已自行写规则时用);不传 systemPrompt 用默认 prompt 时已内置,此项无效 */
  appendReliableWriteRules?: boolean
  /**
   * 动态 system prompt 注入钩子:每轮 buildSystemPrompt 时调用,集成方按运行时状态(state/data)返回字符串 → 作为 system prompt 一段注入;返回 undefined → 跳过。
   * - `ctx.data` 每轮从 liveData() 取最新(setData 后自动同步),可据此动态算组件说明 / 部分 schema 描述
   * - 回调异常降级为跳过该段 + debug 日志(不崩 agent)
   * - 段排在内置段(base/dataHint/usageHints/.../subagents)之后、用户 middleware 之前
   * - 不配 = 完全现状行为(无该段)
   * 本质是 createChatSdk 层把 augmentPrompt 中间件 + liveData 闭包预包装成便捷选项(类比 memory)
   */
  augmentSystem?: (ctx: SystemAugmentContext) => string | undefined
  /** 用户自定义工具(散工具 / 展开的预设数组 / 模块 default,皆可;与内置工具合并) */
  tools?: StructuredToolInterface[]
  /**
   * 宿主动作(胜任自动化):集成方注册的页面操作(保存/发布/预览/导出等),SDK 自动包成命名 tool 供 agent 调用。
   * 每个动作 = { description, run, params? };LLM 直接看到 save_draft/publish 等命名 tool(无需 trigger_action 中转)。
   * agent 改完数据 → 调 save_draft 保存 → publish 发布,配合 get_dom 形成"改数据→看 DOM→触发动作"闭环。
   */
  actions?: ActionMap
  /** 声明式 skill(渐进式披露) */
  skills?: SkillSpec[]
  /**
   * 用户创建 skill 的独立持久化存储(与 `storage` 选项分离)。
   * - 默认:`{ backend: 'indexed' }`(即使 `storage:false` 也持久化;浏览器不可用降级内存)
   * - `id`:**手动指定同一 id 即可跨页面/跨 agent 复用同一套用户 skill**;不传则默认按 `agentId` 隔离
   * - `false`:关闭 skill 持久化(仅当前会话内存有效,刷新丢失)
   * - `backend`:'indexed'(默认)/ 'local' / 'session' / 'memory'
   */
  skillStorage?: SkillStoreConfig | false
  /**
   * AGENTS.md 风格持久指令(加载时优先于持久化的 memory)。
   * 支持三种形态:
   *   - string:静态文本
   *   - () => string:同步求值(每次 beforeAgent 求值,适合读运行时变量)
   *   - () => Promise<string>:异步求值(首次 beforeAgent 求值并缓存,适合异步加载 RAG 文档)
   * 函数 source 不可序列化,reload 时 options.memory 仍是函数会重新求值。
   */
  memory?: string | (() => string | Promise<string>)
  /** 主数据对象(单对象;schema 校验 + bind 直连,工具直接读写 bind,不挂 window) */
  data?: DataConfig
  /** 大 schema 分层披露阈值(默认 maxKeys=15/maxChars=4000;超则 systemPrompt 只注入顶层概览,深层约束查 schema_data;add-schema-tiered-disclosure) */
  schemaHint?: { maxKeys?: number; maxChars?: number }
  /** scope 白名单(默认不启用;启用后对 window/vfs 工具生效) */
  permissions?: PermissionRule[]
  /** 自定义中间件(在内置中间件之后注入;可拦截/观察模型调用、工具执行、prompt 增强等) */
  middleware?: Middleware[]
  /** 虚拟工作区:初始文件 + 内存字节上限(默认 4MB,超限 LRU 淘汰最旧) */
  vfs?: { initialFiles?: Record<string, string>; maxBytes?: number; poolBytes?: { largeResults?: number; drafts?: number; userFiles?: number } }
  /** 每个 数据槽最多保留快照数(默认 20,FIFO 丢最旧) */
  maxSnapshots?: number
  /** 自动乐观锁(默认 true):写入时若 LLM 未传 expectedHash,自动用其最后 get 读到的 hash 比对;设 false 回退「不传 = 不校验」 */
  autoLock?: boolean
  /** 数据操作审计回调:每次 set/edit/delete/restore 经此回调外发结构化事件(独立于 debug,无需 debug:true);集成方做合规审计/操作追溯 */
  onAudit?: (entry: { op: string; value?: unknown; detail?: string; timestamp: number }) => void
  /** 工具呈现模式:simple(默认,主推 read/write 但保留 query/search/eval/snapshot)| advanced(全暴露)| minimal(只 read/write) */
  toolMode?: 'simple' | 'advanced' | 'minimal'
  /** 读写拦截器:read/write 透传给数据工具(脱敏/转换/审计/拒绝 LLM 读写);input/output 在 agent IO 入口/出口预处理 */
  interceptors?: {
    read?: (value: unknown) => unknown
    write?: (payload: unknown, current: unknown) => unknown | { error: string }
    /** agent 接收输入时拦截:send/stream 的 user message 预处理(可改写/审计) */
    input?: (input: unknown) => unknown
    /** agent 产出输出时拦截:返回前 postprocess(可改写最终回复) */
    output?: (json: unknown) => unknown
  }
  /** 内存中保留的对话轮数上限(默认 50);超限把最旧轮次压缩为摘要 system 消息(防 OOM);0 关闭 */
  maxMemoryRounds?: number
  debug?: boolean
  maxToolRounds?: number
  /** 规划阶段总轮次预算(默认 5);planning 状态下超限 → write_todos/update_todo 回灌提示,防"光规划不执行"死循环。与 maxIterations 总闸正交 */
  maxPlanRevisions?: number
  /** 模型调用失败自动重试次数(默认 2;网络/429/5xx 重试,4xx 与 abort 不重试) */
  maxRetries?: number
  /** LLM 流停滞看门狗(fix-hang-and-feedback P1-7):chunk 间隔(含等首个)超此 ms → 中断抛错防 loading 永转。默认 90s;0 = 关闭 */
  streamStallMs?: number
  /** token 预算上限(累计 total_tokens 超过 → 停止 agent + emit BUDGET_EXCEEDED;需 capabilities.automation:true) */
  tokenBudget?: number
  /**
   * 单次 invoke 的 token 预算上限(opt-in,默认关):本次 agent 调用累计 total_tokens 超限 → 中断收口
   * (observable emit ROUND_TOKEN_BUDGET_EXCEEDED + 友好收口文本,已完成部分保留)。与 automation 的全局
   * tokenBudget 正交:后者跨会话累计、需 automation 能力;本项单 invoke、无条件可用(防单轮死循环烧钱)。
   */
  roundTokenBudget?: number
  /** 时间预算 ms(从 agent 开始计时,超过 → 停止;需 capabilities.automation:true) */
  timeBudgetMs?: number
  /** 无人值守错误恢复:致命错误(invoke 抛错)自动 restore_last_checkpoint + 重试次数(默认 1;防单点错误永久中断批量/长任务)。需 capabilities.automation:true */
  maxAutoRetries?: number
  /** 同轮多个工具调用的并发上限(默认 1 串行;>1 并发,可能影响有状态中间件如 todos 的计数) */
  maxParallelTools?: number
  /** 模型上下文窗口(token);顶层声明对 llm 实例场景也生效,缺省按 model 名查表。影响 offload 阈值与压缩触发 */
  contextWindow?: number
  /** 模型最大输出(token);顶层声明对 llm 实例场景也生效,缺省按 model 名查表 */
  maxOutputTokens?: number
  /** 内置能力开关(默认全开;关掉某能力则对应中间件/工具不装载) */
  capabilities?: {
    dataOps?: boolean          // 数据操作工具集(默认 true;关 → 不装数据工具,省 token/上下文)
    fetch?: boolean          // 文档抓取工具 fetch_document(默认 true;关 → 不装)
    planning?: boolean       // todos 任务规划
    missionAnchor?: boolean  // 任务目标锚定(默认 true;长任务防跑偏,revive-mission-anchor Phase 1)
    workingMemory?: boolean  // 跨压缩工作记忆(默认 true;pin 最近 path/hash,防压缩后丢定位;revive-cross-round-working-memory Phase 1)
    focus?: boolean         // 上下文聚焦·指定组件精修(默认 true;聚焦后目标/视野/范围三层收敛到单组件;focus-context)
    skills?: boolean         // 渐进式披露技能
    vfs?: boolean            // 虚拟工作区(关 → 大结果外存退化为截断)
    summarization?: boolean  // 上下文压缩(关 → 长会话不压缩)
    memory?: boolean         // AGENTS.md 持久指令
    subagent?: boolean       // 子 agent 委派(与 subagent.enabled:false 等效)
    verify?: boolean         // 自检中间件(默认 false;开启后 agent 返回前跑 check 自纠。传 verify.check/maxAttempts/adversarial 时自动开,无需重复声明 true;显式 false 阻止自动开)
    domInspect?: boolean     // DOM 读取工具 get_dom(默认 false;agent 读渲染后 DOM 结构,opt-in;有 token 成本,集成方按需开启)
    inspectEnv?: boolean     // 环境探查工具 inspect_env(默认 true;读 window 环境/location/调试变量,轻量只读,排查调试用)
    draftWrite?: boolean     // 分块写工具 draft_write/draft_commit(默认 false;几百 K JSON 分块构建再原子提交,opt-in;需 dataOps + vfs,advanced 暴露)
    tracing?: boolean        // 结构化追踪 TraceSpan(默认 false;opt-in,采集有开销;DebugDrawer trace tab + getTraceMetrics + onEvent('trace'))
    todoDeps?: boolean       // todos 层级依赖 parentId/deps(默认 false;opt-in,LLM 维护依赖图;structured-todos-tier Phase 2)
    automation?: boolean     // 无人值守自动化(默认 false;预算闸 token/time + 错误恢复;automation-layer Phase 4,opt-in 最远)
    skillHostScript?: boolean  // skill exec 宿主脚本执行(默认 false;opt-in,允许 skill exec.context:'host' 全权执行;仅集成方内联 code,远程 url+host 禁止)
    contextInspector?: boolean // 上下文检查 inspectContext(默认 true;读每轮消息分类 token 占比,纯计算零 LLM 成本)
    agentCompression?: boolean // 压缩 agent 自主决策(默认 false;opt-in,开 + summaryLlm 可用 → decide 驱动压缩,失败降级静态;requires summarization)
  }
  /** 子 agent 委派(spawn_agent/spawn_agents);默认开启,{ enabled: false } 关闭 */
  subagent?: { enabled?: boolean; allowedTools?: string[]; systemPrompt?: string; temperature?: number; maxTokens?: number; skills?: SkillSpec[]; llm?: LLMConfig | BaseChatModel; maxDepth?: number; maxParallel?: number; timeoutMs?: number }
  /** 预声明子 agent 列表:每个用同主配置方式声明,自动生成 use_<id> 委派工具(与 spawn_agent 共存) */
  subagents?: SubagentConfig[]
  /** 自检:agent 返回前跑 check,不通过则 feedback 回灌自纠(默认关闭)。传 check/maxAttempts/adversarial 任一即自动开启(无需再配 capabilities.verify:true;显式 false 或 verify.enabled:false 可关);check 可省略,默认用 createWriteBackCheck */
  verify?: {
    /** 显式关闭(优先级最高;即使 capabilities.verify:true) */
    enabled?: boolean
    /** 领域校验函数(ok=false 时 feedback 回灌自纠) */
    check?: VerifyCheck
    /** 自纠上限(默认 2) */
    maxAttempts?: number
    /** 对抗式验证(期四实现:spawn 找茬子 agent) */
    adversarial?: boolean
  }
  /**
   * 主动征询(默认开启):装载 `request_human_confirmation` 工具 + 注入默认提示词,
   * LLM 在不确定 / 多方案 / 高风险不可逆时主动调它征询用户(把选项做成可点选按钮),而非自行猜测。
   * 默认 true(不传也开);传 false 关闭。被动确认(白名单)仍由 `approval.tools`/`approval.confirm` 声明(业务相关,无法自动推断)。
   * 传了 `approval` 时,`approval.humanConfirmTool: false` 亦可关闭本能力(向后兼容)。
   */
  humanConfirm?: boolean
  /**
   * 人工确认:工具调用前弹确认框,用户「允许/拒绝」后才执行(默认关闭,不传 = 不装)。
   * tools 指定需确认的工具名(如 ['write','set_data','edit_data']);confirm 自定义判定;timeoutMs 超时自动拒绝。
   * humanConfirmTool(传 approval 时默认 true;false 关闭):装载 request_human_confirmation 工具,LLM 可在不确定/多方案/高风险时主动征询用户。
   */
  approval?: {
    tools?: string[]
    confirm?: (name: string, args: any) => boolean
    timeoutMs?: number
    /** 是否装载 request_human_confirmation 主动确认工具(传 approval 时默认 true;false 关闭) */
    humanConfirmTool?: boolean
  }
  /**
   * 会话级 checkpoint 回滚(回到上次正常时)。默认关闭,不传 = 不装。
   * 传 true 用默认;或 { maxCheckpoints?, auto? }。auto(默认 true):每轮 agent 行动前自动存一个 checkpoint;
   * restore_last_checkpoint / list_checkpoints 工具供 LLM 自纠;SDK 暴露 restoreLastCheckpoint/listCheckpoints 供 UI 一键回退。
   */
  checkpoint?: boolean | { maxCheckpoints?: number; auto?: boolean }
  /** MCP server 列表(连远程 server,动态把其 tools 注入 agent;浏览器仅 http/sse/websocket transport) */
  mcp?: McpServerConfig[]
  /** 上下文压缩配置(false 关闭;默认 LLM 摘要,失败回退索引摘要) */
  contextOptions?: Partial<ContextManagerOptions> | false
  /**
   * 上下文压缩预设档位(默认 'auto'):auto / conservative / aggressive。
   * 提供一组合理默认,降低配置学习难度;contextOptions 细参可在其基础上覆盖个别字段。
   */
  contextPreset?: ContextPreset
  /**
   * 摘要压缩专用 LLM:可传 BaseChatModel 实例或 LLMConfig(如更便宜的小模型)。
   * 不传则默认用主 agent 的模型(options.llm)。
   */
  summaryLlm?: BaseChatModel | LLMConfig
  /** 标题生成 LLM(BaseChatModel 实例或 LLMConfig;不传则用 summaryLlm → 主 llm)。用于首轮后自动生成会话标题(主旨,替代规则截取) */
  titleLlm?: BaseChatModel | LLMConfig
  /** 自动生成会话标题(默认 true:首轮 user+assistant 后调 LLM 生成主旨标题;false 关闭用规则 deriveTitle 截取) */
  autoTitle?: boolean
  /** 摘要 LLM 温度(默认 0.3,稳定输出) */
  summaryTemperature?: number
  /** 摘要 LLM 输出上限(默认 1024;摘要无需大输出,省成本) */
  summaryMaxTokens?: number
  /** 摘要 LLM 超时毫秒(默认 15000;超时回退零成本索引摘要,不阻塞用户) */
  summaryTimeoutMs?: number
  /** 压缩决策(agentCompression)LLM 超时毫秒(默认 6000;不复用 summaryTimeoutMs 15s,两段叠加阻塞首响应) */
  decisionTimeoutMs?: number
  /** 压缩决策 LLM 输出上限(默认 2048;避免继承 summaryLlm 1024 截断 JSON → safeParse 失败无谓降级) */
  decisionMaxTokens?: number
  /**
   * SDK 事件回调:订阅常用时机(数据槽变化 / 消息更新 / 工具调用 / 流式文本 / 轮次 / 错误)。
   * UI 与 headless 模式均生效;用于外部联动(如宿主页面响应式刷新、埋点、日志),替代轮询。
   * 注意:approval_request 不外发(UI 已处理,避免双重 resolve)。
   */
  onEvent?: SdkEventHandler
  /** 流式输出(默认 true 逐字流式);false 时等整段回复再显示(底层仍 stream 聚合) */
  streaming?: boolean
  /** 对话框 UI 配置(title/placeholder/drawer/drawerWidth/drawerHidden/inputRows/onClose 归组) */
  dialog?: DialogConfig
}

/** 对话框 UI 配置(归组写法,推荐) */
export interface DialogConfig {
  /** 对话框标题 */
  title?: string
  /** 输入框 placeholder */
  placeholder?: string
  /** 抽屉模式:ChatDialog 从右侧滑入 + 遮罩 + 关闭按钮(替代收起下箭头);点击遮罩/关闭按钮触发 unmount(带退出动画)。默认 false(inline 占满 container) */
  drawer?: boolean
  /** 抽屉模式宽度(像素或 CSS 字符串,如 500 / '500px' / '40vw');默认 420px。仅 drawer:true 生效。inline 模式宽度由 container 决定 */
  drawerWidth?: number | string
  /** 抽屉模式默认隐藏(mount 后不显示,需 sdk.show() 才显示):适合「点击按钮才出现聊天框」场景。默认 false(mount 立即显示)。仅 drawer:true 生效 */
  drawerHidden?: boolean
  /** 输入框行数(可见高度);默认 2(2 行初始高度,自动扩展至 max-height:100px)。设 1 则单行;设 >2 则更高 */
  inputRows?: number
  /** 抽屉模式关闭回调:点击遮罩/关闭按钮时调用(默认调 unmount 带退出动画)。集成方需同步外部挂载状态时传此选项覆盖默认行为 */
  onClose?: () => void
  /** 内置主题:'dark'(默认,深色紫调,方舟专题设计稿色板)/ 'light'(中性浅色);亦可祖先覆盖 --cs-* 完全自定义 */
  theme?: 'light' | 'dark'
  /** 图标局部覆盖:替换默认 emoji(🤖/🧬/🎯/📋/✏️/💡/⚠️/💬;头像两键 undefined=内置 SVG)。未传键用默认;空串=隐藏该图标 */
  icons?: Partial<DialogIcons>
  /** ChatDialog 区块显隐(chatdialog-component-split):键=false 关闭整块(含 slot);默认全开。键:header/focus/body/queued/approval/conflict/footer/debug/skill */
  sections?: Record<string, boolean>
}

export interface ChatSdk {
  /** 渲染对话框到 container(异步:含持久化恢复);ui:false 时仅 init agent(headless)。
   *  可选传 overrideContainer(HTMLElement | 选择器字符串)覆盖创建时 options.container —— 异步绑定:创建时可省略 container,mount 时才指定 */
  mount(overrideContainer?: HTMLElement | string): Promise<void>
  /** 响应式消息数组(headless 模式下供集成方自建 UI 读取;与内部共享同一引用) */
  messages: AgentMessage[]
  /** 卸载(shareContext 时仅减引用计数,归零才真销毁) */
  unmount(): void
  /** 抽屉模式隐藏:加 cs-hidden class,不卸载 vueApp/不 release agent —— 保留聊天历史与正在进行的生成进程;再 show() 恢复可见 */
  hide(): void
  /** 抽屉模式显示:移除 cs-hidden class 恢复可见(配合 hide 使用;首次挂载用 mount) */
  show(): void
  /** 命令式发送一条消息(共享内部 messages,自动持久化);options.interceptors per-call 覆盖顶层 input/output 拦截器,options.maxAutoRetries per-call 覆盖 automation 重试次数 */
  send(message: string, options?: SendOptions): Promise<string>
  /** 暴露底层流式接口(高级用法,自行管理历史时使用) */
  stream: (messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal) => Promise<string>
  /** 显式持久化当前轮(headless 用 sdk.stream 时需手动调:把 messages/vfs/todos 存 store;内置 useChat 经 onPersist 自动调。storage 未开启 → no-op) */
  afterRound(): void
  /** 调试日志(LLM 请求/响应/工具调用/中间件/错误;switchSession/onClear 清空;供 DebugDrawer 或外部消费) */
  readonly debugLogs: Ref<DebugLog[]>
  /** Agent 信息刷新 tick(setSkills/setData/setFocus 后 ++);传给 DebugDrawer watch 后重拉 inspect() 实时反映 */
  readonly infoTick: Ref<number>
  /** 切换到指定会话(载入其上下文);不传 id 则新建。返回新会话 id。storage 未开启时抛错 */
  switchSession(sessionId?: string): Promise<string>
  /**
   * 新建/清空会话(同步;「清空对话」编程式入口,与 UI ChatHeader 清空同语义):
   * 中止在途流 + 收口挂起冲突(keep_external)+ 重置全部内存态(messages/vfs/todos/memory/mission/workingMemory/focus/checkpoint/debugLogs)
   * + 换新 sessionId + emit session_restored。storage 开启时同步新建持久会话;未开启时仅重置内存态(P1-8 修复后不再早退泄漏)。
   */
  resetSession(): void
  /** 列出当前 agent 的所有历史会话(供「历史列表」UI;storage 未开启 → []) */
  listSessions(): Promise<import('../backends/storage').SessionMeta[]>
  /** 历史会话列表(响应式;switchSession/deleteSession/onClear/init 后自动 refresh;直接消费无需手动 listSessions/refresh) */
  readonly sessions: Ref<import('../backends/storage').SessionMeta[]>
  /** 删除指定历史会话;不可删除当前会话(删当前请先 switchSession 切走);storage 未开启 → no-op + warn */
  deleteSession(sessionId: string): Promise<void>
  /** 当前会话 id(switchSession/onClear 后实时反映;供历史列表高亮当前项) */
  readonly sessionId: string
  /** 检视 agent 详细信息(tools/skills/data/middleware/todos 等),供 debug 或外部消费 */
  inspect(): AgentInfo
  /** 读取最近一次上下文构成快照(每轮 wrapModelCall 覆盖;capabilities.contextInspector:false → undefined) */
  inspectContext(): import('../utils/contextAnalysis').ContextSnapshot | undefined
  /** 读取当前任务目标锚点 mission(自动 capture 或 setMission;capabilities.missionAnchor:false → undefined) */
  getMission(): Mission | undefined
  /** 显式设置/覆盖 mission(传 {goal} 重设;传 {goal,criteria} 整体替换;传 {} 清空);capabilities 关时 warn 不抛 */
  setMission(mission: Partial<Mission>): void
  /** 读取当前聚焦焦点(兼容:返回首个;未聚焦 / capabilities.focus:false → undefined) */
  getFocus(): Focus | undefined
  /** 读取全部聚焦焦点(multi-focus;空数组=未聚焦;capabilities.focus:false → []) */
  getFocuses(): Focus[]
  /** 设置聚焦焦点(替换全部;path 经 getSchemaAtPath 校验在 schema 内才可聚焦);非法 path 返回 {ok:false,error};capabilities.focus:false 返回 {ok:false} 不抛 */
  setFocus(focus: Focus): { ok: boolean; error?: string }
  /** 追加聚焦焦点(multi-focus 累积,去重 by path;校验同 setFocus);capabilities.focus:false → {ok:false} */
  addFocus(focus: Focus): { ok: boolean; error?: string }
  /** 移除单个聚焦焦点(by path);capabilities.focus:false → no-op */
  removeFocus(path: string): void
  /** 清除全部聚焦焦点(退出精修模式,恢复全量可操作范围) */
  clearFocus(): void
  /** 回退到最近一次正常 checkpoint(整体还原对话历史 + 主数据 + vfs + todos);需开启 checkpoint 选项,无可用 checkpoint 返回 false */
  restoreLastCheckpoint(): boolean
  /** 列出可用 checkpoint(回退点);需开启 checkpoint 选项,未开启返回空数组 */
  listCheckpoints(): { id: number; label?: string; timestamp: number; messageCount: number }[]
  /**
   * 批处理(automation):逐任务跑 agent,每任务前自动 checkpoint,任务间错误隔离(单任务失败记 error 不中断整批)。
   * 适合无人值守批量操作(批量生成/改一批页面)。不经 UI 排队(直接 invoke);返回每个任务结果(成功 reply / 失败 error)。
   * 配合 capabilities.automation + checkpoint 使用;onProgress 每任务完成调一次(done/total/task/ok)。
   */
  batch(tasks: string[], onProgress?: (p: BatchProgress) => void, signal?: AbortSignal): Promise<BatchResult[]>
  /**
   * 运行时订阅 SDK 事件(常用时机:数据槽变化 / 消息更新 / 工具调用 / 流式文本 / 轮次 / 错误)。
   * 与构造时 `onEvent` 选项互补:可注册多个监听器、运行时动态订阅;返回取消函数。
   * approval_request 不外发(UI 已处理)。流式事件仅 stream 模式(UI 默认 stream;sdk.send 走 invoke 无流式事件)。
   */
  hook(handler: SdkEventHandler): () => void
  /**
   * 运行时替换主数据配置(如页面切换、schema 变更)。立即对数据工具生效(无需重建 agent);
   * 清空快照栈与乐观锁缓存。需开启 dataOps(默认开)。
   */
  setData(config: DataConfig): void
  /** 读取当前主数据配置(schema + bind + description);dataOps 关闭时返回 undefined */
  getData(): DataConfig | undefined
  /**
   * 运行时替换整个 skill 列表(同名 skill 覆盖更新)。立即生效:system prompt 的 skill 索引段下轮重渲染反映新 skill;
   * 清空 skill 全文缓存与本轮已加载记录,下次 load_skill 重新取最新全文(含 vfs doc)。需开启 skills(默认开)
   */
  setSkills(skills: SkillSpec[]): void
  /**
   * 添加用户创建的 skill(持久化,跨刷新恢复;同名覆盖)。触发 controller 合并 initialSkills + userSkills + infoTick 刷新。
   * 需开启 skills(默认开);关闭时 warn 并忽略
   */
  addSkill(skill: SkillSpec): void
  /**
   * 删除用户创建的 skill(仅删用户创建的,不删集成方 initialSkills)。返回是否删除成功。
   * 需开启 skills(默认开);关闭时 warn 并返回 false
   */
  removeSkill(name: string): boolean
  /** 列出用户创建的 skill 名(仅用户创建的,不含集成方 initialSkills) */
  listUserSkills(): string[]
  /** 读取用户创建的 skill 详情(返回 {name, description, content};不存在返回 undefined) */
  getUserSkill(name: string): { name: string; description: string; content: string } | undefined
  /**
   * 清 skill 全文缓存(动态 skill 内容变化时主动失效)。不传 name 清全部;传 name 清指定。
   * 下次 load_skill 重新 getContent/readSkillDoc 取最新。需开启 skills(默认开)
   */
  invalidateSkillCache(name?: string): void
  /** 导出主数据 bind 的深拷贝(备份/迁移用);dataOps 关闭或无 data 返回 null */
  exportData(): any
  /**
   * 导入数据整体替换主数据 bind(就地还原,保留 reactive 引用)。
   * - 默认经 schema 校验,不合法返回 {ok:false,error};校验通过写入并发 data_change 事件,返回 {ok:true}
   * - opts.validate:false 跳过校验(集成方自行保证数据合法);opts.emit:false 不发 data_change 事件
   */
  importData(json: any, opts?: { validate?: boolean; emit?: boolean }): { ok: boolean; error?: string }
  /** 往 vfs 异步注入/更新文件(RAG 文档池 / HTML 代码等);content 字符串直存,对象 JSON.stringify。storage 开则 persist。与 vfs_write 工具一致语义(集成方侧命令式入口) */
  vfsWrite(path: string, content: string | object): void
  /** 只读读取 vfs 文件内容(文件不存在返 undefined)。与 vfs_read 工具一致语义,命令式入口(不经工具调用/无工具开销) */
  vfsRead(path: string): string | undefined
  /** 受保护资源(精确值保护):创建/注册资源 → 返 handle;需 data.resources + vfsStore,否则抛错 */
  createResource(path: string, value?: unknown): string
  getResource(pathOrHandle: string): { path: string; mode: string; value: unknown; handle: string } | undefined
  updateResource(path: string, value: unknown): void
  deleteResource(pathOrHandle: string): boolean
  listResources(): { path: string; mode: string; handle: string; bytes: number }[]
  releaseResources(paths?: string[]): void
  /** 累计 token 用量(每轮 LLM 调用累加;prompt/completion/total_tokens)。无调用时为 0 */
  usage: import('../types').TokenUsage
  /** 乐观锁冲突挂起状态(响应式 ref;无冲突为 null,有冲突时 UI 据此渲染冲突对话框)。headless 集成方可 watch 此 ref 自建 UI */
  pendingConflict: import('vue').Ref<PendingConflict | null>
  /** 冲突解决:用户点「保留外部」(keep_external)/「强制覆盖」(overwrite)/「回退」(restore) → 收口挂起的 conflict,被挂起的工具调用继续 */
  resolveConflict(action: ConflictResolution['action']): void
  /**
   * 运行时替换用户工具集(内置工具由 capabilities 控制,不动)。立即生效:下一轮 LLM 调用即用新工具集(内部 rebindTools)。
   * 不调用 = 现状行为(创建时 tools 固定)。支持按权限/业务阶段/A-B 实验动态切换工具组,无需重建 agent。
   */
  setTools(tools: StructuredToolInterface[]): void
  /** 运行时追加用户工具(去重 by name);立即生效。需先 mount */
  addTool(tool: StructuredToolInterface): void
  /** 运行时移除用户工具(by name);内置工具不受影响。返回是否移除成功 */
  removeTool(name: string): boolean
  /**
   * 运行时切换 LLM(配额耗尽切便宜模型 / 复杂任务切强模型 / 切 provider)。
   * 参数为 BaseChatModel 实例或 LLMConfig(内部构造 ChatOpenAI)。立即生效:重新绑定工具 + 重解析模型能力(影响 offload 阈值/压缩)。
   * summaryLlm(摘要专用)不受影响。新模型若不支持 tool calling 则工具调用失效(agent 不崩)。
   */
  setLlm(llm: BaseChatModel | LLMConfig): void
  /**
   * 运行时更新持久指令 memory。支持 string 与同步/异步函数:
   *   - string:立即生效,下一轮 augmentPrompt 注入
   *   - () => string | Promise<string>:后台求值(适合异步加载 RAG 文档),求值完成自动生效
   * setMemory('') 清空。不调用 = 现状行为(创建时 options.memory 固定)。
   */
  setMemory(source: string | (() => string | Promise<string>)): void
  /**
   * 重新求值当前 memory 函数 source(用于 RAG 文档更新后强制刷新);返回最新文本。
   * 字符串 source 直接返回当前值。
   */
  refreshMemory(): Promise<string>
  /**
   * 运行时替换整个预声明子 agent 列表(重新生成 use_<id> 委派工具,立即生效)。
   * 需创建时配 subagents:[](否则 controller 为 null,setter warn);不调用 = 现状行为。
   */
  setSubagents(configs: SubagentConfig[]): void
  /** 运行时追加预声明子 agent(id 重复 warn 跳过);需创建时配 subagents:[] */
  addSubagent(config: SubagentConfig): void
  /** 运行时移除预声明子 agent(by id);返回是否移除成功;需创建时配 subagents:[] */
  removeSubagent(id: string): boolean
  /** 运行中子 agent 列表(观察层;空=无在跑;capabilities.subagent 关闭 → 空数组) */
  getActiveSubagents(): SubagentRunState[]
  /** 子 agent 委派历史(观察层 getter;LRU≤20,最新在前) */
  readonly subagentHistory: SubagentRunState[]
}

/** send/stream options:mission 显式覆盖(优先于自动 capture)+ interceptors per-call 覆盖(顶层 input/output)+ automation 重试次数覆盖 + signal 中断(fix-hang-and-feedback P1-4) */
interface SendOptions {
  mission?: Partial<Mission>
  interceptors?: { input?: (input: unknown) => unknown; output?: (json: unknown) => unknown }
  maxAutoRetries?: number
  /** 中断信号(fix-hang-and-feedback P1-4):abort → 本次 send 中止(挂起的确认/冲突随 signal 自动收口)。headless 无停止按钮场景的退出通道 */
  signal?: AbortSignal
}

/** 内存中保留的对话轮数上限(超限压缩为摘要,防 OOM);0 表示关闭 */
const DEFAULT_MAX_MEMORY_ROUNDS = 30


// ===== AgentCore:可被多实例共享的核心上下文 =====
type AgentInstance = ReturnType<typeof createAgent>
type TodosMw = ReturnType<typeof createTodosMiddleware>
type MemoryMw = ReturnType<typeof createMemoryMiddleware>
type MissionMw = ReturnType<typeof createMissionMiddleware>
type WorkingMemoryMw = ReturnType<typeof createWorkingMemoryMiddleware>
type FocusMw = ReturnType<typeof createFocusMiddleware>

/** 乐观锁冲突挂起(等用户决定保留外部/强制覆盖/回退);resolve 由 resolveConflict 调用,清空后工具继续 */
export interface PendingConflict {
  id: number
  op: 'set' | 'edit' | 'delete'
  agentValue?: unknown
  currentValue: unknown
  currentHash: string
  expectedHash: string
  snapshotId: number
  resolve: (r: ConflictResolution) => void
}

export interface AgentCore {
  agentId: string
  store: SessionStore | null
  messages: AgentMessage[]
  vfsStore: VfsStore
  /** SDK 事件监听器集合(sdk.hook 注册;shareContext 时多实例共享同一 core,故合并于此) */
  listeners: Set<SdkEventHandler>
  todosMw: TodosMw
  memoryMw: MemoryMw
  /** mission 中间件实例(switchSession/onClear 调 reset;capabilities.missionAnchor 关闭仍创建但不装载) */
  missionMw: MissionMw
  /** workingMemory 中间件实例(switchSession/onClear 调 reset;capabilities.workingMemory 关闭仍创建但不装载) */
  workingMemoryMw: WorkingMemoryMw
  /** focus 中间件实例(switchSession/onClear 调 reset;capabilities.focus 关闭仍创建但不装载) */
  focusMw: FocusMw
  agent: AgentInstance | null
  initDone: Promise<void>
  /** 当前会话 id(可变;共享时多实例同步) */
  sessionId: string
  /** 引用计数(shareContext 时多实例共用一个 core) */
  refCount: number
  /** MCP client closers(unmount/release 时关闭) */
  mcpClosers: Array<() => Promise<void>>
  /** 已连 MCP server 元信息(getInfo 展示;失败的 server 不进) */
  mcpServers: { name: string; url: string; toolCount: number }[]
  /** 会话级 checkpoint 管理器(未开启 checkpoint → null) */
  checkpoint: CheckpointManager | null
  /** dataOps 控制器(运行时替换配置;dataOps 关闭 → null) */
  dataOpsController: DataOpsController | null
  /** skills 控制器(运行时 setSkills/invalidateSkillCache;skills 关闭 → null) */
  skillsController: import('../harness/skills').SkillsController | null
  /** 卸载 skill 附带工具(setSkills 替换整个列表清全部 / invalidateSkillCache 指定 skill;skill-external-scripts §5) */
  unloadSkillTools?: (name?: string) => void
  /** Agent 信息刷新 tick(setSkills/setData 后 ++);经 ChatDialog 传给 DebugDrawer 触发 agentInfo 重新拉取,实时反映动态 skill/data */
  infoTick: Ref<number>
  /** 乐观锁冲突挂起(等用户决定保留外部/强制覆盖/回退);UI 经此 ref 渲染冲突对话框,无冲突时为 null */
  pendingConflict: Ref<PendingConflict | null>
  /** 历史会话列表(响应式;switchSession/deleteSession/onClear/init 后自动 refresh;storage 未开启 → []) */
  sessions: Ref<SessionMeta[]>
  /** 刷新历史会话列表到 sessions(内部 switchSession/deleteSession/onClear/init 调;集成方一般无需手动调,直接消费 sessions) */
  refreshSessions: () => Promise<void>
  /** 当前主数据配置(反映运行时替换;供 inspect/verify/getData 读最新状态) */
  liveData: () => DataConfig | undefined
  /** 累计 token 用量(每轮 LLM 调用累加;供 sdk.usage 暴露) */
  usage: import('../types').TokenUsage
  /** 事件分发/外发(经 onEvent + listeners;供 return 对象 importData 等手动发事件复用 + UI 交互如 chip 点击触发 focus_chip_click,集成方可订阅) */
  emit: SdkEventHandler
  applySnapshot(snap: SessionSnapshot): void
  afterRound(): void
  send(message: string, options?: SendOptions): Promise<string>
  switchSession(sessionId?: string): Promise<string>
  /** 新建/清空会话:重置内存态 + 新 sessionId + emit session_restored(onClear 调;P0-4 收编,原 onClear 闭包越界引用 buildCore 局部致 ReferenceError) */
  resetSession(): void
  stream: (messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal) => Promise<string>
  /** 添加用户创建的 skill(持久化 + 入 controller;同名覆盖) */
  addSkill(skill: SkillSpec): void
  /** 删除用户创建的 skill(仅删用户创建的);返回是否删除成功 */
  removeSkill(name: string): boolean
  /** 列出用户创建的 skill 名(仅用户创建的,不含集成方 initialSkills) */
  listUserSkills(): string[]
  /** 读取用户创建的 skill 详情(返回 {name, description, content};不存在返回 undefined) */
  getUserSkill(name: string): { name: string; description: string; content: string } | undefined
  /** 实例 unmount 时调;引用计数归零才真销毁(store.dispose + 移出注册表) */
  release(): void
  /** 串行闸(P1-11 fix-data-integrity:建在 core 级,shareContext 多实例共享同一链;send/batch/switchSession/stream 一律经此串行,防共享 state 并发竞态) */
  runSerial: <T>(fn: () => Promise<T>) => Promise<T>
  /** 登记在途流(P1-11:core 级注册表;建内部 controller + 联动外部 signal;返回 controller 与注销函数) */
  trackActive(outer?: AbortSignal): { controller: AbortController; untrack: () => void }
  /** 中止全部在途流(P1-11:core 级注册表;unmount/switchSession/resetSession/release 收口路径调用) */
  abortAllActive(): void
  /** 冲突解决:用户点「保留外部」/「强制覆盖」/「回退」→ 收口挂起的 conflict,工具继续 */
  resolveConflict(action: ConflictResolution['action']): void
  /** 检视 agent 详情(inspect() 与 debug 窗口消费) */
  getInfo(): AgentInfo
  /** 读取当前 mission(capture 或 setMission;capabilities.missionAnchor:false → undefined) */
  getMission(): Mission | undefined
  /** 显式设置/覆盖 mission(传 {goal} 重设;传 {goal,criteria} 整体替换;传 {} 清空);capabilities 关时 warn 不抛 */
  setMission(mission: Partial<Mission>): void
  /** 读取当前聚焦焦点(兼容:返回首个;未聚焦 / capabilities.focus:false → undefined) */
  getFocus(): Focus | undefined
  /** 读取全部聚焦焦点(multi-focus;空数组=未聚焦;capabilities.focus:false → []) */
  getFocuses(): Focus[]
  /** 设置聚焦焦点(替换全部;path 经 getSchemaAtPath 校验在 schema 内才可聚焦);非法返回 {ok:false,error};capabilities.focus:false 返回 {ok:false} 不抛 */
  setFocus(focus: Focus): { ok: boolean; error?: string }
  /** 追加聚焦焦点(multi-focus 累积,去重 by path;校验同 setFocus);capabilities.focus:false 返回 {ok:false} */
  addFocus(focus: Focus): { ok: boolean; error?: string }
  /** 移除单个聚焦焦点(by path);capabilities.focus:false → no-op */
  removeFocus(path: string): void
  /** 清除全部聚焦焦点(退出精修模式) */
  clearFocus(): void
  /** 运行时替换用户工具集(内置不动);立即 rebind + infoTick 刷新 */
  setTools(tools: StructuredToolInterface[]): void
  /** 运行时追加用户工具(去重 by name) */
  addTool(tool: StructuredToolInterface): void
  /** 运行时移除用户工具(by name;内置不动);返回是否移除成功 */
  removeTool(name: string): boolean
  /** 运行时切换 LLM(BaseChatModel 或 LLMConfig);rebind + 重解析能力 + infoTick */
  setLlm(llm: BaseChatModel | LLMConfig): void
  /** 运行时更新 memory;支持 string 与同步/异步函数 */
  setMemory(source: string | (() => string | Promise<string>)): void
  /** 重新求值当前 memory 函数 source;返回最新文本 */
  refreshMemory(): Promise<string>
  /** 运行时替换预声明子 agent 列表(重新生成委派工具 + rebind) */
  setSubagents(configs: SubagentConfig[]): void
  /** 运行时追加预声明子 agent */
  addSubagent(config: SubagentConfig): void
  /** 运行时移除预声明子 agent(by id);返回是否移除成功 */
  removeSubagent(id: string): boolean
  /** 运行中子 agent 列表(观察层;空=无在跑;capabilities.subagent 关闭 → 空数组) */
  getActiveSubagents(): SubagentRunState[]
  /** 子 agent 委派历史(观察层 getter;LRU≤20,最新在前) */
  readonly subagentHistory: SubagentRunState[]
  /** 批处理(automation):逐任务跑 agent,每任务前 checkpoint,任务间错误隔离 */
  batch(tasks: string[], onProgress?: (p: BatchProgress) => void, signal?: AbortSignal): Promise<BatchResult[]>
}

/**
 * 依赖反转契约:把 UI 渲染(ChatDialog 挂载)从 createChatSdk 解耦为可注入实现。
 * 主入口(index.ts)注入 mountChatDialog(含 UI);headless 入口(index.headless.ts)不注入(不含 UI)。
 *
 * _createChatSdk 在 mount() 时构造此 ctx 传给 mounter —— core 直接传入(避免在 ctx 枚举 30+ props 字段致漂移),
 * 其余为渲染所需最小集(streaming/runSerial/hide/unmount/onDialogUnmounted)。
 */
export interface DialogMountContext {
  el: HTMLElement
  /** 直接传 core,mounter 内部从 core.* 读全部 props(InfoTick/pendingConflict/sessions/skillsController...) */
  core: AgentCore
  dialogCfg: DialogConfig
  streaming: boolean
  /** 实例级操作串行化器(会话切换等经此防并发 state 竞态);传给 ChatDialog 会话管理回调 */
  runSerial: <T>(fn: () => Promise<T>) => Promise<T>
  /** 传给 ChatDialog onClose:抽屉模式关 → hide(保留 agent/历史/生成进程) */
  hide: () => void
  /** 传给 ChatDialog onClose:非抽屉关 → unmount */
  unmount: () => void
  /** 退出动画完成后回调(createChatSdk 闭包内 = dialogController 置 null + core.release()) */
  onDialogUnmounted: () => void
}

/** mounter 返回的 UI 生命周期控制器;createChatSdk 闭包持 dialogController 并委托 mount/unmount/show/hide */
export interface DialogController {
  /** 启动退出动画;transitionend/320ms 兜底后调 ctx.onDialogUnmounted */
  unmount(): void
  /** 移除 .chat-dialog/.chat-mask 的 cs-hidden */
  show(): void
  /** 添加 cs-hidden(opacity:0 + visibility:hidden) */
  hide(): void
}

/** 依赖反转口:UI 渲染(ChatDialog 挂载 + props 透传 + 退出动画 + show/hide class 切换)的可注入实现 */
export type DialogMounter = (ctx: DialogMountContext) => DialogController

/** shareContext 注册表:agentId → AgentCore(同页同 id 复用) */
const sharedCores = new Map<string, AgentCore>()

/**
 * 数据写工具名 → operation 映射(供 onEvent 的 data_change 推断操作类型)。
 * 非数据写工具返回 null。write 高层入口按 args 推断(del→delete,patch→edit,否则 set)。
 */
function matchDataOp(name: string, args?: any): 'set' | 'edit' | 'delete' | 'restore' | null {
  if (name === 'set_data') return 'set'
  if (name === 'edit_data') return 'edit'
  if (name === 'delete_data') return 'delete'
  if (name === 'restore_data') return 'restore'
  if (name === 'write') {
    if (args?.del) return 'delete'
    if (args?.patch) return 'edit'
    return 'set'
  }
  return null
}

/** 委派类工具(子 agent 执行入口):子 agent 的数据写发生在这些工具内部,主循环侧无独立工具调用可匹配 */
function isDelegationTool(name: string): boolean {
  return name === 'spawn_agent' || name === 'spawn_agents' || name.startsWith('use_')
}

/**
 * 内部事件中间件:把常用时机经 onEvent 外发给集成方。
 * - wrapToolCall:数据写工具(set/edit/delete/restore)执行后发 data_change(operation/value);
 *   委派类工具(spawn_agent / spawn_agents / use_<id>)成功收口后也补发 —— 子 agent 写 data(如 html 子 agent 写 code 字段)
 *   经主循环的 use_<id> 内部落地,非 reactive bind 宿主只监听 data_change 时无从感知刷新(修前漏发)
 * - afterModel:每轮 LLM 调用后提取 usage 累加到 core.usage,发 usage 事件(单轮 + 累计)
 * - afterAgent:每轮 agent 结束发 message_update(消息数)
 * stream 事件(round_start/text/tool_call/done 等)由 core.stream 包装层转发(见下)。
 */
function createSdkEventMiddleware(emit: SdkEventHandler, messages: AgentMessage[], liveData: () => DataConfig | undefined, usage: TokenUsage): Middleware {
  let roundCounter = 0
  return {
    name: 'sdk-events',
    wrapToolCall: async (ctx: ToolCallContext, next) => {
      const result = await next(ctx)
      const op = matchDataOp(ctx.name, ctx.args)
      if (op) {
        emit({ type: 'data_change', operation: op, value: liveData()?.bind } as any)
      } else if (result.status === 'done' && isDelegationTool(ctx.name)) {
        // 委派工具内部可能改 data(读多写少,误报仅多一次无害刷新;operation 统一 edit)
        emit({ type: 'data_change', operation: 'edit', value: liveData()?.bind } as any)
      }
      return result
    },
    afterModel: (res) => {
      // 从 LLM 响应消息提取 usage 归一(normalizeUsage:OpenAI/DeepSeek additional_kwargs.usage + Anthropic response_metadata.usage + camelCase 兼容;
      // fix-main-sub-isolation P1-17a:与子栈 sub-usage 中间件共用同一归一函数)
      const roundUsage = normalizeUsage(res.message)
      if (roundUsage) {
        usage.prompt_tokens = (usage.prompt_tokens ?? 0) + (roundUsage.prompt_tokens ?? 0)
        usage.completion_tokens = (usage.completion_tokens ?? 0) + (roundUsage.completion_tokens ?? 0)
        usage.total_tokens = (usage.total_tokens ?? 0) + (roundUsage.total_tokens ?? 0)
        roundCounter++
        emit({ type: 'usage', round: roundCounter, usage: roundUsage, cumulative: { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, total_tokens: usage.total_tokens } })
      }
    },
    afterAgent: async () => {
      emit({ type: 'message_update', count: messages.length })
    },
  }
}

/** setFocus/addFocus 共享的 path 校验(4 道:useFocus 守卫 / path 非空 / schema 存在 / getSchemaAtPath 命中)。
 *  返回 {ok:true} 或 {ok:false,error};debug 模式各拒绝路径 console.warn 防静默(schema 拒绝最易踩坑:数组须 z.array 包裹,裸 discriminatedUnion 致 getSchemaAtPath 降级返 null)。 */
function validateFocusInput(
  focus: Focus,
  op: string,
  useFocus: boolean,
  getSchema: () => ZodType | null | undefined,
  debug?: boolean,
): { ok: true } | { ok: false; error: string } {
  if (!useFocus) {
    if (debug) console.warn(`[page-agent-sdk][focus] capabilities.focus 关闭,${op} 忽略`)
    return { ok: false, error: 'capabilities.focus 关闭' }
  }
  if (!focus || !focus.path) {
    if (debug) console.warn(`[page-agent-sdk][focus] ${op} 拒绝:path 必填且非空`)
    return { ok: false, error: 'path 必填且非空' }
  }
  const schema = getSchema()
  if (!schema) {
    if (debug) console.warn(`[page-agent-sdk][focus] ${op} 拒绝:当前无主数据 schema`)
    return { ok: false, error: '当前无主数据 schema,无法聚焦' }
  }
  if (!getSchemaAtPath(schema, focus.path)) {
    if (debug) console.warn(`[page-agent-sdk][focus] ${op} 拒绝:path "${focus.path}" 不在 schema 内(getSchemaAtPath 返 null;数组组件须 z.array(...) 包裹,裸 discriminatedUnion/Union 会降级)`)
    return { ok: false, error: `path "${focus.path}" 不在 schema 内` }
  }
  return { ok: true }
}

/** 构建一个独立的核心上下文(含持久化恢复 + agent 构造 + 操作函数) */
function buildCore(options: ChatSdkOptions, agentId: string): AgentCore {
  // ===== 累计 token 用量(每轮 LLM 调用经 sdk-events 中间件 afterModel 提取累加;供 sdk.usage 暴露 + onEvent('usage') 单轮外发) =====
  const usage: TokenUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  // ===== 乐观锁冲突人工介入(dataOps 写入时检测到主数据已被外部改过 → 挂起等用户决定保留外部/强制覆盖/回退) =====
  // ===== 乐观锁冲突人工介入管理器(emit getter 延迟求值:emit 在下方 listeners 后定义,set 运行时才调) =====
  const conflictMgr = createConflictManager(() => emit)
  // Agent 信息刷新 tick:setSkills/setData 等运行时变更后 ++,经 ChatDialog 传给 DebugDrawer 触发 agentInfo 重新拉取(实时反映动态 skill/data)
  const infoTick = ref(0)

  // ===== 持久化(默认关闭;赋值后端字符串或配置对象开启)=====
  const store = resolveStorage(options.storage)
  if (options.debug && store) {
    store.onEvent((e) => console.log('[page-agent-sdk][storage]', e))
  }

  // ===== 模型能力 + 摘要 LLM invoke(统一由 resolveLlm 解析;声明优先 > model 名查表 > 缺省)=====
  // let modelCaps:setLlm 后经 onLlmChange 重解析(影响 offload 阈值/压缩触发/maxTokens 缺省)
  const { modelCaps: initialModelCaps, summaryLlmInvoke, titleLlmInvoke, compressDecisionInvoke } = resolveLlm(options)
  let modelCaps = initialModelCaps
  if (options.debug) console.log('[page-agent-sdk][modelCaps]', modelCaps)
  // harden-context-resilience:最小窗口校验(<200K throw,排除小窗口模型;设计假设 ≥200K)
  if (modelCaps.contextWindow < MIN_CONTEXT_WINDOW) {
    throw new Error(
      `[page-agent-sdk] 模型上下文窗口 ${modelCaps.contextWindow} 小于最小支持 ${MIN_CONTEXT_WINDOW}(需 ≥200K 窗口模型,如 GLM-5.2/Claude/Kimi/Qwen-1M/DeepSeek-v4)`,
    )
  }
  // recall-and-trim-llm 方向2:trim 异步 LLM 增强的配置门 + preserveSet(复用于 summarization 装配,消除重复 resolveContextOptions 调用)
  const resolvedCtxOpts = resolveContextOptions(options, modelCaps.contextWindow)
  const enableTrimLlm = resolvedCtxOpts.enableLLMSummary !== false
  const trimPreserveArr: string[] =
    (options.contextOptions && (options.contextOptions as any).preserveLastToolResults) ??
    PRESET_PRESERVE[options.contextPreset ?? 'auto']
  const trimPreserveSet = new Set<string>(trimPreserveArr)
  // 当前 LLM 实例/配置:setLlm 后更新(inspect().model 读最新);主 LLM 实例化由 createAgent/setLlm 处理
  let currentLlm: BaseChatModel | LLMConfig = options.llm
  if (options.debug && !summaryLlmInvoke) console.warn('[page-agent-sdk][summarization] 未构造 llmInvoke(apiKey 缺失?),摘要回退零成本索引摘要')

  // ===== 共享 messages(send/mount 唯一来源)=====
  const messages = reactive<AgentMessage[]>([])

  // ===== vfs + 中间件(保留可 reset 的引用以便恢复注入)=====
  const vfsStore = createVfs(options.vfs?.initialFiles, {
    persist: store
      ? { save: (files: Record<string, VfsFile>): void => {
          if (core.sessionId && store) void store.save(agentId, core.sessionId, { vfs: files })
        } }
      : undefined,
    maxBytes: options.vfs?.maxBytes,
    poolBytes: options.vfs?.poolBytes,
  })

  const todosMw = createTodosMiddleware([], { maxPlanRevisions: options.maxPlanRevisions })
  const missionMw = createMissionMiddleware()
  // 上下文聚焦(focus-context):指定组件精修,目标/视野/范围三层收敛。getSchema 延迟引用 liveData(适配 setData 运行时替换,同 checkpointMgr.getData 模式)
  // 焦点变更统一 emit focus_change(所有入口:API/agent 工具/dialog chip/reset;闭包引用 emit,运行时已初始化)
  // unfocusGuidance:focus 工具仅 advanced 装载(见下 focusTools),simple/minimal 下文案须引导「提示用户移除 chip」而非调用不存在的工具
  const focusMw = createFocusMiddleware({ getSchema: () => liveData()?.schema, getBind: () => liveData()?.bind, unfocusGuidance: options.toolMode === 'advanced' ? 'tool' : 'ask-user', onChange: (focuses) => emit({ type: 'focus_change', focuses }) })
  const workingMemoryMw = createWorkingMemoryMiddleware()
  const memoryMw = createMemoryMiddleware(options.memory || '')
  // memory 为函数(同步/异步)时,后台预求值,首次 beforeAgent 前尽量就绪(不阻塞 mount)
  if (typeof options.memory === 'function') void memoryMw.refresh()

  // agent 实例引用 holder(checkpoint manager 需读 agent.getState 取 todos,但 agent 在 initDone 内才创建;闭包延后读取)
  const agentRef: { current: any } = { current: null }

  // data:单主对象配置(schema + bind 直连,工具直接读写 bind,不挂 window;集成方按需自己挂 window)
  const finalDataConfig: DataConfig | undefined = options.data
    ? { ...options.data, description: options.data.description ?? '主数据对象' }
    : undefined

  // HTML 子 agent 自动装配(3.9+,浏览器端页面搭建主场景开箱即用,无开关):
  // 无显式 html 子 agent + subagent 能力开 + schema 推断命中「数组元素含 code 字段」→ 自动加一个默认
  // createHtmlSubagent()(vfs 工作副本 + 格式校验 + 增量 commit + 委派编排全套,info 留痕)。
  // 显式 createHtmlSubagent(...) 优先不重复装;无 code 数组(纯数据应用)零变化;
  // 推断不出的形态(顶层 code 字段/开放 schema)不装 → 主 agent 自己写(降级直写编排)。
  const autoHtmlAgent = !(options.subagents ?? []).some((s) => (s as SubagentConfig)._codeAsset)
    && resolveCapabilities(options.capabilities).subagent
  let declaredSubagents: SubagentConfig[] | undefined = options.subagents
  if (autoHtmlAgent && finalDataConfig?.schema && inferWritablePaths(finalDataConfig.schema).length) {
    declaredSubagents = [...(options.subagents ?? []), createHtmlSubagent()]
    console.info('[page-agent-sdk] 检测到 schema 含代码组件数组(如 components[].code),已自动装配 HTML 代码子 agent(委派编排 + vfs 工作副本 + 格式校验 + 增量 commit)。需定制(codeField/formatCheck/craftNotes 等)请显式传 createHtmlSubagent(...)')
  }

  // code-as-data-asset:检测 htmlSubagent 单模式(_codeAsset 标记)→ 提取 pgIdPaths(schema extend 加 __pgId + afterWrite 补)/ largeTextPaths(主 scope read 摘要挡代码灌主上下文)
  // 装配期识别(集成商 createHtmlSubagent 时设标记;本工厂调用时 data 尚未传,故延迟到此处)
  const allCodeAssetConfigs = (declaredSubagents ?? []).filter(
    (s): s is SubagentConfig & { _codeAsset: NonNullable<SubagentConfig['_codeAsset']> } => !!s._codeAsset,
  )
  // writablePaths 装配期推断:工厂调用时 schema 尚未传,未传 writablePaths(空数组)在此回填。
  // 就地回填 config 对象 → 下方 pgIdPaths/largeTextPaths 与 subagentsForAssemble(middleware)三处下游自然拿回填值。
  // 推断不出(开放 schema/嵌套容器/点路径 codeField)→ warn + 剔除该子 agent(优雅降级,不 throw):
  //   preset 默认注入(pageBuilder)或集成方空调用时,schema 无 code 数组 = 该能力不适用,不该崩整个集成;
  //   剔除后编排注入自然走「无 html agent」分支(schema 另有顶层 code 字段 → 降级直写 fallback),行为自洽。
  //   「宁失败不猜错路径」不受损 —— 不猜路径,只不装不适用的能力,console.warn 留痕。
  const droppedCodeAsset = new Set<SubagentConfig>()
  for (const s of allCodeAssetConfigs) {
    if (s._codeAsset.writablePaths.length) continue
    const inferred = inferWritablePaths(finalDataConfig?.schema, s._codeAsset.codeField)
    if (inferred.length) {
      s._codeAsset.writablePaths = inferred
      // 同步 SubagentConfig 顶层 writablePaths(spawn 自授剥离写工具后经它授予写权限)
      if (Array.isArray(s.writablePaths)) s.writablePaths = inferred
      // 重建 systemPrompt/skill 示例路径:工厂调用时 root 未知用 'components' 占位,推断回填后
      // 按 real root 重建,防占位示例误导非 components 命名(blocks/sections 等)的集成(手搓 config 无钩子,防御跳过)
      ;(s as any)._rebuildCodeAssetPaths?.(inferred[0])
      console.info(`[page-agent-sdk][createHtmlSubagent] 未传 writablePaths,已从 schema 推断: [${inferred.map((p) => `'${p}'`).join(', ')}]`)
    } else {
      console.warn('[page-agent-sdk][createHtmlSubagent] 未能从 schema 推断 writablePaths(开放 schema(z.any()/z.record())/嵌套容器(如 sections[].children[])/点路径 codeField(如 props.html_code)不支持自动推断),已跳过该 html 子 agent(整体不受影响);如确需代码资产机制(vfs + 格式校验 + 增量 commit),请显式传 writablePaths(代码组件 data 区,如 [\'components\'])')
      droppedCodeAsset.add(s)
    }
  }
  const codeAssetConfigs = droppedCodeAsset.size ? allCodeAssetConfigs.filter((s) => !droppedCodeAsset.has(s)) : allCodeAssetConfigs
  // effective 列表 = 剔除被跳过子 agent 后的实际装配面(subagentsForAssemble / inspect 反射同源)
  const effectiveSubagents = droppedCodeAsset.size
    ? (declaredSubagents ?? []).filter((s) => !droppedCodeAsset.has(s))
    : declaredSubagents
  const hasCodeAsset = codeAssetConfigs.length > 0
  const codeAssetPgIdPaths = codeAssetConfigs.flatMap((s) => s._codeAsset.writablePaths)
  const codeAssetLargeTextPaths = codeAssetConfigs.flatMap((s) => s._codeAsset.writablePaths.map((wp) => `${wp}.${s._codeAsset.codeField}`))

  // 会话级 checkpoint(默认关;传 options.checkpoint 开启):每轮自动存 + 一键回滚到上次正常时
  const checkpointOpts = options.checkpoint
  const useCheckpoint = checkpointOpts !== undefined && checkpointOpts !== false
  const checkpointMgr: CheckpointManager | null = useCheckpoint
    ? createCheckpointManager({
        getData: () => liveData()?.bind,  // 单对象 data 模式:快照/回滚主数据 bind(getter 适配 sdk.setData 运行时替换)
        consumeDataDirty: () => dataOpsController?.consumeDataDirty?.() ?? true,  // bind 脏标记增量(dataOpsController 在下方声明,闭包延迟引用同 getData→liveData;无 controller 返 true=整体 clone 向后兼容)
        slotPaths: finalDataConfig ? [''] : [],
        vfsStore,
        todosMw,
        getTodos: () => agentRef.current?.getState?.()?.todos ?? [],
        messages,
        maxCheckpoints:
          checkpointOpts && typeof checkpointOpts === 'object' ? checkpointOpts.maxCheckpoints : undefined,
      })
    : null
  const checkpointAuto = !checkpointOpts || typeof checkpointOpts !== 'object' || checkpointOpts.auto !== false

  // 内置能力开关(默认全开;false 则对应中间件/工具不装载)
  const caps = resolveCapabilities(options.capabilities)  // 单一解析(消除 !==false/===true 混;opt-in/out 经注册表 defaultOn,requires 表达依赖)
  const useDataOps = caps.dataOps
  const useDraft = caps.draftWrite  // draft_write/commit 分块构建大 JSON(opt-in,默认关;需 dataOps + vfs)
  const useTracing = caps.tracing  // 结构化追踪 TraceSpan(opt-in,默认关;采集有开销)
  const useAutomation = caps.automation  // 无人值守自动化(预算闸+错误恢复;opt-in,最远)

  // 最终 systemPrompt 的 base 段(不含数据段):用户 systemPrompt(或默认)+ 可选 reliableWriteRules 追加,统一由 buildSystemPrompt 处理
  // 数据段移交 dataHint 中间件每轮从 liveData() 动态重算(修 setData 不同步 Bug);inspect 与 createAgent 共用 baseSystemPrompt 保持一致
  const baseSystemPromptRaw = buildSystemPrompt(options)
  // 主 agent 编排自适应注入(集成方零配置):有 html 子 agent→委派编排 / 无 agent+schema 有 code 字段→自己写编排+warn / 无 code 字段→不注入
  let baseSystemPrompt = baseSystemPromptRaw
  if (hasCodeAsset) {
    // 有 html 子 agent:注入委派编排(每个 codeAsset 子 agent 的 orchestratorPrompt,含正确 use_<id>);opt-out(_codeAsset.orchestratorPrompt 缺)跳过
    const orch = codeAssetConfigs.map((s) => s._codeAsset.orchestratorPrompt).filter(Boolean).join('\n\n')
    if (orch) baseSystemPrompt += '\n\n' + orch
  } else if (finalDataConfig?.schema && schemaHasCodeField(finalDataConfig.schema)) {
    // 无 html 子 agent + schema 静态扫到 code 字段:注入「自己写」降级编排 + warn(开放 schema z.any() 扫不到时,集成方 opt-in spread systemPromptHelpers.htmlDirectWriteFallback)
    baseSystemPrompt += '\n\n' + systemPromptHelpers.htmlDirectWriteFallback
    console.warn('[page-agent-sdk] 检测到 schema 含 code 字段但未注册 html 子 agent:已自动注入「主 agent 自己写 HTML」编排(code 作普通字段直接 write,无 vfs 工作副本 / 无格式校验门禁)。如需代码资产机制(vfs + 格式校验 + 增量 commit + 主上下文 code 摘要),注册 createHtmlSubagent;若确为降级意图可忽略。')
  }

  // 工具:数据操作 + 文档抓取 + 用户自定义(子 agent 中间件据此筛选只读子集)
  // dataOps/fetch 可经 capabilities 关闭(默认开,保持零配置;关则不进工具池,省 token/上下文);筛选经纯函数 selectBuiltinTools(可单测)
  const dataOpsTools = useDataOps && finalDataConfig
    ? createDataOps(finalDataConfig, {
        onAudit: options.onAudit ?? (options.debug ? (e) => console.log('[page-agent-sdk][data audit]', e) : undefined),
        maxSnapshots: options.maxSnapshots,
        onConflict: conflictMgr.set,
        autoLock: options.autoLock,
        interceptors: options.interceptors,
        vfsStore: (useDraft || !!finalDataConfig?.resources?.length) ? vfsStore : undefined,  // draft 工具 / 受保护资源(opt-in):vfsStore 提供 → createDataOps 装 draft_write/draft_commit + resource_*
        // code-as-data-asset:htmlSubagent writablePaths → pgIdPaths(schema extend 加 __pgId:safeParse 不剥离 + afterWrite 补 __pgId)+ largeTextPaths(主 scope read code 摘要)
        ...(codeAssetPgIdPaths.length ? { pgIdPaths: codeAssetPgIdPaths } : {}),
        ...(codeAssetLargeTextPaths.length ? { largeTextPaths: codeAssetLargeTextPaths } : {}),
      })
    : []
  // toolMode 筛选:simple(默认)主推 read/write 但保留高级能力;advanced 全暴露;minimal 只 read/write
  const dataOpsFiltered = useDataOps ? filterByToolMode(dataOpsTools, options.toolMode) : []
  // 数据操作控制器(运行时替换配置;dataOps 关闭时为 null)
  const dataOpsController = useDataOps && finalDataConfig
    ? (dataOpsTools as StructuredToolInterface[] & { controller?: DataOpsController }).controller ?? null
    : null
  // 受保护资源跨压缩 pin(augmentPrompt 每轮注入「受保护资源」段;资源清单天然跨压缩,无需持久化)
  const resourcesPinMw = (useDataOps && finalDataConfig?.resources?.length && dataOpsController?.getResourcesSnapshot)
    ? createResourcesPinMiddleware({
        getResourcesSnapshot: () => dataOpsController?.getResourcesSnapshot?.() ?? [],
        // resource_* 仅 advanced 暴露(SIMPLE_HIDDEN);simple/minimal 下提示词不教调用(与工具面一致)
        toolsExposed: options.toolMode === 'advanced',
      })
    : undefined
  /** 当前主数据配置(反映运行时替换;供 inspect/verify 等读最新状态) */
  const liveData = (): DataConfig | undefined => dataOpsController?.get() ?? finalDataConfig
  // 工具来源标注(builtin / mcp:<name> / user),供 getInfo 展示(DebugDrawer 区分内置/MCP/用户工具)
  const toolSources = new Map<string, string>()
  const builtinTools = selectBuiltinTools(caps, dataOpsFiltered, fetchDocTools, domTools, inspectTools)
  builtinTools.forEach((t) => toolSources.set(t.name, 'builtin'))
  // userTools 可变:支持运行时 setTools/addTool/removeTool 动态增删用户工具
  const userTools: StructuredToolInterface[] = [
    ...(options.tools || []),
  ]
  userTools.forEach((t) => toolSources.set(t.name, 'user'))
  // 宿主动作(actions):集成方注册的页面操作 → 自动包成命名 tool;异常隔离(run 抛错回灌 LLM 不崩)
  const actionTools: StructuredToolInterface[] = actionsToTools(options.actions ?? {})
  actionTools.forEach((t) => toolSources.set(t.name, 'action'))
  // mcpTools 可变:后台握手完成后收集,setTools 重建 extraTools 时纳入
  const mcpTools: StructuredToolInterface[] = []
  // MCP 后台连接释放标记:release 先行(握手完成前 unmount)→ 后台握手完成后直接关连接,
  // 不回填已释放 core 的 mcpClosers(防连接泄漏:mcp-e2e 真测发现的后台化伴生竞态)
  let mcpBackgroundReleased = false
  // 人工确认(主动侧):默认开启(不猜测,不确定/多方案/高风险时主动征询);顶层 humanConfirm:false 或 approval.humanConfirmTool:false 关闭
  const useHumanConfirm =
    options.humanConfirm !== false && (options.approval ? options.approval.humanConfirmTool !== false : true)
  const humanConfirmTool = useHumanConfirm ? createHumanConfirmTool() : null
  if (humanConfirmTool) toolSources.set(HUMAN_CONFIRM_TOOL_NAME, 'builtin')
  // 会话级 checkpoint 回滚工具(供 LLM 自纠:流程异常/走偏时回退到上次正常态)
  const checkpointTools: StructuredToolInterface[] = useCheckpoint && checkpointMgr
    ? [
        tool(
          async () => {
            const list = checkpointMgr.list()
            if (!list.length) return '无可用 checkpoint,无法回退。'
            const ok = checkpointMgr.restore()
            return ok
              ? `已回退到最近一次正常状态(checkpoint #${list[list.length - 1].id})。对话历史、主数据、vfs、todos 已整体还原。请基于回退后的状态重新判断并继续。`
              : '回退失败:无可用 checkpoint。'
          },
          { name: 'restore_last_checkpoint', description: '回退到最近一次正常状态(整体还原对话历史 + 主数据 + vfs + todos)。当本轮操作出错、页面被改坏、或走偏时调用,回到本轮起点重新来过。不传参数即回退最近一次。', schema: z.object({}).optional() },
        ),
        tool(
          async () => {
            const list = checkpointMgr.list()
            if (!list.length) return '无可用 checkpoint。'
            return '可用 checkpoint:\n' + list.map((c) => `#${c.id} [${c.label ?? 'auto'}] 消息数=${c.messageCount} 时间=${new Date(c.timestamp).toLocaleTimeString()}`).join('\n')
          },
          { name: 'list_checkpoints', description: '列出可用会话 checkpoint(回退点)。', schema: z.object({}).optional() },
        ),
      ]
    : []
  checkpointTools.forEach((t) => toolSources.set(t.name, 'builtin'))
  // 上下文聚焦工具 set_focus/clear_focus(focus-context;advanced 暴露,simple/minimal 经 UI/宿主 API 触发)。
  // set_focus 校验 path 在 schema 内(getSchemaAtPath 命中)才聚焦,非法回灌错误让 LLM 自纠(同 sdk.setFocus 校验逻辑)
  const useFocus = caps.focus
  const setFocusTool = tool(
    async ({ path, label }: { path: string; label?: string }) => {
      const schema = liveData()?.schema
      if (!schema) return '聚焦失败:当前无主数据 schema,无法聚焦。'
      if (!getSchemaAtPath(schema, path)) return `PATH_DENIED · 聚焦失败:path "${path}" 不在 schema 内。请先用 read 查看可操作路径再聚焦。`
      focusMw.setFocus({ path, ...(label ? { label } : {}) })
      return `已聚焦到 ${path}${label ? `(${label})` : ''}。后续仅可写该子树(越界被拒),每轮只看到该组件结构。完成精修后调 clear_focus 退出。`
    },
    {
      name: 'set_focus',
      description: '聚焦到指定组件子树(如 components.3)精修,替换全部已有焦点(非累积;要保留已有焦点追加用 add_focus)。聚焦后:仅可写该子树(越界 PATH_DENIED)+ 每轮只看到该组件结构。多组件页面精修其中一个时用,避免改到别处。先 read 定位 path 再聚焦;完成调 clear_focus。',
      schema: z.object({ path: z.string().describe('要聚焦的组件 jsonPath,如 components.3'), label: z.string().optional().describe('人类可读标签,如「导航栏」') }),
    },
  )
  const clearFocusTool = tool(
    async () => {
      focusMw.clearFocus()
      return '已清除聚焦,恢复全量可操作范围(可读写所有组件)。'
    },
    { name: 'clear_focus', description: '清除当前聚焦,退出精修模式,恢复对全部组件的读写权限。', schema: z.object({}).optional() },
  )
  // add_focus:累积追加焦点(multi-focus;校验 path 在 schema 内 + 去重),用于同时精修多个相关组件
  const addFocusTool = tool(
    async ({ path, label }: { path: string; label?: string }) => {
      const schema = liveData()?.schema
      if (!schema) return '聚焦失败:当前无主数据 schema,无法聚焦。'
      if (!getSchemaAtPath(schema, path)) return `PATH_DENIED · 聚焦失败:path "${path}" 不在 schema 内。请先用 read 查看可操作路径再聚焦。`
      focusMw.addFocus({ path, ...(label ? { label } : {}) })
      const foci = focusMw.getFocuses()
      return `已聚焦 ${path}${label ? `(${label})` : ''}(当前共 ${foci.length} 个焦点:${foci.map((f) => f.path).join(', ')})。后续仅可写这些子树之一(越界被拒)。`
    },
    {
      name: 'add_focus',
      description: '追加聚焦一个组件子树(multi-focus,可同时聚焦多个相关组件)。校验 path 在 schema 内。聚焦后仅可写已聚焦的子树之一(越界 PATH_DENIED)。与 set_focus(替换全部)不同:本工具累积追加,不清除已有焦点。',
      schema: z.object({ path: z.string().describe('要追加聚焦的组件 jsonPath,如 components.3'), label: z.string().optional().describe('人类可读标签') }),
    },
  )
  // remove_focus:移除单个焦点(by path);移除最后一个等价退出精修
  const removeFocusTool = tool(
    async ({ path }: { path: string }) => {
      const before = focusMw.getFocuses().length
      focusMw.removeFocus(path)
      const after = focusMw.getFocuses()
      if (after.length === before) return `path "${path}" 不在当前焦点列表中(当前:${after.map((f) => f.path).join(', ') || '无'})。`
      return after.length ? `已移除焦点 ${path}(剩余 ${after.length} 个:${after.map((f) => f.path).join(', ')})。` : `已移除焦点 ${path},聚焦已清空,恢复全量操作范围。`
    },
    {
      name: 'remove_focus',
      description: '移除单个聚焦焦点(by path),保留其他焦点。移除最后一个等价退出精修。全部退出用 clear_focus。',
      schema: z.object({ path: z.string().describe('要移除的焦点 jsonPath') }),
    },
  )
  const focusTools: StructuredToolInterface[] = useFocus && options.toolMode === 'advanced' ? [setFocusTool, clearFocusTool, addFocusTool, removeFocusTool] : []
  focusTools.forEach((t) => toolSources.set(t.name, 'builtin'))
  // skill 附带工具(load_skill 后动态注入;skill-external-scripts §5)。按 skill 名记录归属,便于 invalidate/setSkills 卸载
  let loadedSkillTools: StructuredToolInterface[] = []
  const skillToolOwner = new Map<string, string>()  // toolName → skillName(source 标 `skill:<skillName>`)
  // allTools 可变:setTools 后重建,inspect().tools 读最新值
  // tool-name-collision:装配期 dedupeTools 收敛「自定义与内置重名」为后注册覆盖先注册(对齐 page-agent),
  // 消除「绑定层重复定义 + 执行层 builtin 赢(find 取第一个)+ 标注层后注册来源」三者漂移;覆盖时 warn 告警集成方
  let allTools: StructuredToolInterface[] = rebuildExtraTools()
  /** 重建 extraTools(传 createAgent 的 tools):dedupeTools 收敛 builtin + userTools + actions + humanConfirm + checkpoint + mcp(后覆盖先,返回唯一集) */
  function rebuildExtraTools(): StructuredToolInterface[] {
    const { tools, collisions } = dedupeTools([
      { label: 'builtin', tools: builtinTools },
      { label: 'user', tools: userTools },
      { label: 'action', tools: actionTools },
      { label: 'humanConfirm', tools: humanConfirmTool ? [humanConfirmTool] : [] },
      { label: 'checkpoint', tools: checkpointTools },
      { label: 'focus', tools: focusTools },
      { label: 'mcp', tools: mcpTools },
      { label: 'skill', tools: loadedSkillTools },
    ])
    if (collisions.length) {
      console.warn('[page-agent-sdk] 工具重名,后注册覆盖先注册:', collisions.map((c) => `${c.name}(${c.loser}→${c.winner})`).join(', '))
    }
    return tools
  }

  const usePlanning = caps.planning
  const useMission = caps.missionAnchor // mission 默认开(分层默认核心;长任务防跑偏)
  const useWorkingMemory = caps.workingMemory // workingMemory 默认开(pin 最近 path/hash,防压缩后丢定位)
  const useSkills = caps.skills
  // code-as-data-asset:htmlSubagent 单模式强依赖 vfs 工作副本 + vfs 工具(checkout/commit + 子 agent vfs_edit);集成商关了 vfs 也强制开(零感知)
  const useVfs = caps.vfs || hasCodeAsset
  // vfs 是内置中间件,其工具(createVfsMiddleware 注入)标 builtin(否则 inspect().tools 里会落到 'user',语义错)
  if (useVfs) {
    for (const n of VFS_TOOL_NAMES) toolSources.set(n, 'builtin')
  }
  // planning 是内置中间件,其工具(write_todos 整表替换 / update_todo 增量)标 builtin(否则落 'user',语义错;add-adaptive-planning)
  if (usePlanning) {
    for (const t of todosMw.tools ?? []) toolSources.set(t.name, 'builtin')
  }
  const useSummarization = caps.summarization
  const useAgentCompression = caps.agentCompression && !!compressDecisionInvoke // agentCompression 开 + summaryLlm 可用(支持工具)→ decide 驱动;否则降级静态
  if (options.debug && caps.agentCompression && !compressDecisionInvoke) {
    console.warn('[page-agent-sdk][agentCompression] agentCompression 开启但 summaryLlm 不可用(或缺 apiKey / 模型不支持工具),压缩决策不启用,回退静态压缩')
  }
  const useMemory = caps.memory
  const useSubagent = caps.subagent
  // 子 agent 观察层 tracker(会话级共享:spawn + 预声明中间件统一记录 active/history 运行态)
  const subagentTracker = useSubagent ? createSubagentTracker() : undefined
  // verify 默认关(烧 token);开启 = capabilities.verify:true **或** 传了 verify.check/maxAttempts/adversarial(配置意图推断,
  // 对齐 auto-html-agent 模式,治「两处都要配」集成摩擦);capabilities.verify 显式 false 不自动开(显式关闭优先)
  const verifyMaxAttempts = options.verify?.maxAttempts ?? 2
  const verifyIntent = !!(options.verify?.check || options.verify?.maxAttempts || options.verify?.adversarial)
  // capabilities.verify 显式 false 阻止自动开(caps 经 resolveCapabilities 归一,显式/默认 false 不可辨 → 回读原始配置)
  const verifyCapExplicitOff = options.capabilities?.verify === false
  const useVerify = (caps.verify || (verifyIntent && !verifyCapExplicitOff)) && options.verify?.enabled !== false && verifyMaxAttempts > 0
  const useContextInspector = caps.contextInspector  // 上下文检查(默认开,纯计算零 LLM 成本;inspectContext/进度条/tab)
  // 诊断:常见误用 warn(与 options.id/mcp 的 warn 惯例一致),避免"以为开了实际没开"
  if (verifyIntent && !useVerify && options.verify?.enabled !== false) {
    console.warn('[page-agent-sdk][verify] 检测到 verify 配置(check/maxAttempts/adversarial)但未装载(capabilities.verify:false 显式关闭 或 maxAttempts≤0)')
  }

  // 子 agent 中间件(capabilities.subagent 或 subagent.enabled 为 false 则关闭)
  const subOpts = options.subagent
  // 子 agent 工具:allowedTools(从主池按名选)
  const subAllowed = subOpts?.allowedTools ?? []
  // fix-authorization-surface P1-16:permissions/approval 提升具名 const,同实例注入子栈(childGuards)。
  // 修原「委派路径整体绕过把关」—— 子 agent 写操作同样过主 permissions 自动拒 + approval 人工确认
  const permissionsMw = options.permissions?.length ? createPermissionsMiddleware(options.permissions) : undefined
  const approvalMw = options.approval && (options.approval.tools !== undefined || !!options.approval.confirm)
    ? createApprovalMiddleware(options.approval)
    : undefined
  const childGuards: Middleware[] = [...(permissionsMw ? [permissionsMw] : []), ...(approvalMw ? [approvalMw] : [])]  // 序同主栈:permissions 外层 → approval 内层
  const subagentMw =
    !useSubagent || subOpts?.enabled === false
      ? undefined
      : createSubagentMiddleware({
          llm: subOpts?.llm ?? options.llm,
          allTools: () => core.agent?.allTools ?? allTools, // P0-1(getter→合并池):含中间件工具(vfs 等);原指向局部 rebuildExtraTools 池致能力包 allowedTools 恒落空
          allowedTools: subAllowed.length ? subAllowed : undefined,
          // 子 agent 独立配置(自定义身份/温度/上下文上限/技能)
          systemPrompt: subOpts?.systemPrompt,
          temperature: subOpts?.temperature,
          maxTokens: subOpts?.maxTokens,
          skills: subOpts?.skills,
          maxDepth: subOpts?.maxDepth,
          maxParallel: subOpts?.maxParallel,
          debug: options.debug,
          // focus-auto-switch:子 agent 继承主焦点(focusMw/liveData 在该闭包可见)
          getFocuses: () => focusMw.getFocuses(),
          getSchema: () => liveData()?.schema ?? null,
          tracker: subagentTracker,
          // fix-authorization-surface:子栈把关中间件(P1-16)+ 子 offload 桥接主 vfs 池(P1-15)
          guardMiddleware: childGuards.length ? childGuards : undefined,
          getVfsFiles: useVfs ? () => vfsStore.files : undefined,
          // fix-main-sub-isolation:per-scope 乐观锁基线(P1-13,子 read/write 不污染主基线)+ 子 usage 回传(P1-17a)+ 子执行超时(P1-17b,opt-in)
          enterDataScope: dataOpsController?.enterScope ? (id) => dataOpsController.enterScope!(id) : undefined,
          exitDataScope: dataOpsController?.exitScope ? (id) => dataOpsController.exitScope!(id) : undefined,
          onUsage: (u) => { usage.prompt_tokens = (usage.prompt_tokens ?? 0) + (u.prompt_tokens ?? 0); usage.completion_tokens = (usage.completion_tokens ?? 0) + (u.completion_tokens ?? 0); usage.total_tokens = (usage.total_tokens ?? 0) + (u.total_tokens ?? 0) },
          timeoutMs: subOpts?.timeoutMs,
        })

  // 预声明子 agent(subagents:[] → 每个 use_<id> 委派工具;与上面 spawn 中间件共存)
  // 支持运行时动态:经 controller.set/add/remove 重新生成委派工具 + 触发 rebind
  // 注:subagents:[](空数组)也创建 controller,支持「初始无子 agent,运行时动态 add」场景(不依赖 length 判定)
  // capabilities.subagent 关闭时不创建(与 spawn 中间件一致)
  //
  // code-as-data-asset:给 codeAsset 子 agent config 追加 checkout/commit 钩子(本工厂调用时集成商尚未传 data,
  //   故延迟到装配期;钩子闭包持 dataOpsController + vfsStore,经 config.middleware 透传到子 agent createAgent)
  const subagentsForAssemble: SubagentConfig[] | undefined = effectiveSubagents?.map((s) => {
    if (!s._codeAsset) return s
    const cc = s._codeAsset
    const codeAssetMw = createCodeAssetMiddleware({
      writablePaths: cc.writablePaths,
      codeVfsPrefix: cc.codeVfsPrefix,
      ext: cc.ext,
      codeField: cc.codeField,
      craftNotes: cc.craftNotes,
      onWarning: (msg) => console.warn(`[page-agent-sdk][code-asset] ${msg}`),
      getController: () => dataOpsController,
      vfsStore,
    })
    const newMiddleware = [...(s.middleware ?? []), codeAssetMw]
    // 注入 validate_code jsonPath 能力:遍历子 agent middleware 找带 _setGetController 的 validate 中间件,注入同源 getController(直读 data code 校验,零重传 content)
    for (const m of newMiddleware) {
      if (m && typeof m === 'object' && typeof (m as any)._setGetController === 'function') {
        ;(m as any)._setGetController(() => dataOpsController)
      }
    }
    return { ...s, middleware: newMiddleware }
  })
  // parallel-subagent-delegation Q2d/Q3:组件锁(同组件单委派互斥,按组件名)+ 主 agent 写检查中间件。
  // 有 codeAsset 子 agent(并行委派的目标场景)才装;锁空集时全部接缝 no-op(零拦截零回归)。
  // knownNames 与子 agent 文件地图同源(collectComponentNames 扫 bind 代码组件 name),委派时实时解析。
  const componentLock = hasCodeAsset && useSubagent ? createComponentLock() : undefined
  const componentWriteGuardMw = componentLock
    ? createComponentWriteGuardMiddleware({
        getBind: () => liveData()?.bind,
        writablePaths: codeAssetPgIdPaths,
        getLocked: () => componentLock!.locked(),
        tools: allTools,  // A3 按标注判定写能力
      })
    : undefined
  const subagentsMw = useSubagent && subagentsForAssemble !== undefined
    ? createSubagentsMiddleware(subagentsForAssemble, { llm: options.llm, allTools: () => core.agent?.allTools ?? allTools, debug: options.debug, getFocuses: () => focusMw.getFocuses(), getSchema: () => liveData()?.schema ?? null, getBind: () => liveData()?.bind, tracker: subagentTracker, guardMiddleware: childGuards.length ? childGuards : undefined, getVfsFiles: useVfs ? () => vfsStore.files : undefined, enterDataScope: dataOpsController?.enterScope ? (id) => dataOpsController.enterScope!(id) : undefined, exitDataScope: dataOpsController?.exitScope ? (id) => dataOpsController.exitScope!(id) : undefined, onUsage: (u) => { usage.prompt_tokens = (usage.prompt_tokens ?? 0) + (u.prompt_tokens ?? 0); usage.completion_tokens = (usage.completion_tokens ?? 0) + (u.completion_tokens ?? 0); usage.total_tokens = (usage.total_tokens ?? 0) + (u.total_tokens ?? 0) }, timeoutMs: options.subagent?.timeoutMs,
      ...(componentLock ? { componentLock, resolveComponents: (args: { components?: string[]; task: string }) => resolveTargetComponents(args, collectComponentNames(liveData()?.bind, codeAssetPgIdPaths)) } : {}) })
    : undefined
  const subagentsController = subagentsMw ? (subagentsMw as any).controller as import('../harness/subagent').SubagentsController : null

  // 对抗子 agent 的只读工具(白名单筛选,让其能实证读回数据检查而非臆测;dataOps 关闭则不含数据工具)
  const READONLY_FOR_ADVERSARIAL = ['get_data', 'describe_data', 'read', 'fetch_document']
  const readonlyTools = allTools.filter((t) => READONLY_FOR_ADVERSARIAL.includes(t.name))
  // verify 中间件(check 省略时默认 createWriteBackCheck 写后读回验证)。maxAttempts 经 maxVerifyAttempts 透传 createAgent,非中间件字段
  const verifyMw = useVerify
    ? createVerifyMiddleware({
        check: options.verify!.check ?? createWriteBackCheck({
          schemas: () => (liveData() ? { '': liveData()!.schema } : {}) as Record<string, any>,  // 动态取最新(适配 sdk.setData)
          root: () => liveData()?.bind,  // 单对象 data 模式:读回 root = bind(不挂 window);getter 适配 sdk.setData 运行时替换
        }),
        adversarial: options.verify?.adversarial ? { llm: options.llm, tools: readonlyTools } : undefined,
      })
    : undefined

  // 上下文检查中间件(context-inspector):每轮 wrapModelCall 快照实际消息构成(大小/分类/占比);默认开,纯计算零 LLM 成本
  const contextInspectorMw = useContextInspector
    ? createContextInspectorMiddleware({
        contextWindow: modelCaps.contextWindow,
        thresholdRatio: resolveContextOptions(options, modelCaps.contextWindow).summaryThresholdRatio,
      })
    : undefined

  // 能力用法提示(最前,紧跟 base systemPrompt;按 caps 注入,全关则不注入)
  const usageHintsMw = createUsageHintsMiddleware(
    {
      ...caps,
      humanConfirm: useHumanConfirm,
      // 预声明子 agent(供"规划-反思-执行"路由提示;只取 id/description/temperature 轻量字段)
      subagents: effectiveSubagents?.map((s) => ({ id: s.id, description: s.description, temperature: s.temperature })),
    },
    useDataOps && !!finalDataConfig,
    options.toolMode,
    !!finalDataConfig?.resources?.length,
    // C1 自感知预算:softCap 解析结果(token 维度触发;装配期一次,阈值近似够用)
    { promptSoftCap: resolvePromptSoftCap(modelCaps.contextWindow, resolvedCtxOpts.promptSoftCapTokens) },
  )
  // A4「可操作数据」段:每轮从 liveData() 动态重算(修 setData 不同步 Bug)
  // 插中间件栈最前(usageHints 之前),保证数据段紧跟 base —— LLM 看到的 system 结构与现状等价
  // 仅 finalDataConfig 存在时装载;无 data → buildDataPrompt 返 '' → augmentPrompt 返 undefined → 跳过
  const dataHintMw: Middleware | null = finalDataConfig
    ? { name: 'dataHint', augmentPrompt: () => buildDataPrompt(liveData(), options.schemaHint) || undefined }
    : null

  // augmentSystem 钩子:集成方按运行时状态(state/data)动态注入 system prompt 段
  // 插 subagents 之后、用户 middleware 之前(遵循 verify 既定「用户自定义中间件前」约定)
  // 回调异常降级为跳过该段 + debug 日志(不崩 agent);仅 options.augmentSystem 存在时装载
  const augmentSystemMw: Middleware | null = options.augmentSystem
    ? {
        name: 'augmentSystem',
        augmentPrompt: (state) => {
          try {
            return options.augmentSystem!({ state, data: liveData() })
          } catch (e) {
            if (options.debug) console.log('[page-agent-sdk][augmentSystem] 回调抛错,降级跳过:', (e as Error).message)
            return undefined
          }
        },
      }
    : null
  // SDK 事件系统(sdk.hook 注册监听器;emit 外发事件给 options.onEvent + 各 listener,approval_request 不外发,各自 try/catch 隔离)
  const events = createSdkEvents(options.onEvent)
  const emit = events.emit

  let skillsMw: ReturnType<typeof createSkillsMiddleware> | undefined
  // 用户在 ChatDialog 创建的 skill(独立持久化;与集成方 initialSkills 合并后给 controller,同名 userSkills 覆盖)
  let userSkills: SkillSpec[] = []
  /** SkillSpec ↔ PersistedSkill 转换:持久化时把 getContent 闭包的 content 提取为字符串;恢复时还原为 getContent */
  const toPersistedSkill = (s: SkillSpec): PersistedSkill => ({
    name: s.name,
    description: s.description,
    // 用户创建的 skill 用 getContent 存 content;doc 类 skill 由集成方代码控制,不持久化
    content: typeof s.getContent === 'function' ? (s.getContent() as string) : '',
  })
  const toSkillSpec = (p: PersistedSkill): SkillSpec => ({
    name: p.name,
    description: p.description,
    getContent: () => p.content,
  })

  // ===== Skill 独立持久化(与 storage 选项分离;默认 indexedDB,可手动指定 id 跨页复用)=====
  const skillStore: SkillStore | null =
    options.skillStorage === false ? null : createSkillStore({
      ...(typeof options.skillStorage === 'object' ? options.skillStorage : {}),
      id: options.skillStorage && typeof options.skillStorage === 'object' && options.skillStorage.id
        ? options.skillStorage.id
        : `agent::${agentId}`,
    })

  /** 合并 initialSkills + userSkills(同名 userSkills 覆盖)→ controller.set;持久化 userSkills 到 SkillStore */
  const syncUserSkills = () => {
    const ctrl = skillsMw ? (skillsMw as any).controller as import('../harness/skills').SkillsController : null
    if (ctrl) {
      const initial = (options.skills || []).filter((s) => !userSkills.some((u) => u.name === s.name))
      ctrl.set([...initial, ...userSkills])
    }
    core.infoTick.value++
  }
  /** 从 SkillStore 加载用户 skill 到内存 + controller(挂载时调) */
  const loadUserSkillsFromStore = async () => {
    if (!skillStore) return
    try {
      const persisted = await skillStore.list()
      if (persisted.length) {
        userSkills = persisted.map(toSkillSpec)
        const ctrl = skillsMw ? (skillsMw as any).controller as import('../harness/skills').SkillsController : null
        if (ctrl) {
          const initial = (options.skills || []).filter((s) => !userSkills.some((u) => u.name === s.name))
          ctrl.set([...initial, ...userSkills])
        }
        core.infoTick.value++
      }
    } catch {
      /* skillStore 读取失败静默(降级内存,当前会话仍可用) */
    }
  }
  // harden-context-resilience:summarization 提取为变量(setLlm 后 onLlmChange 经 setContextWindow 回灌新 contextWindow)
  const summarizationMw = useSummarization
    ? createSummarizationMiddleware({
        // 预设档位(默认 auto)提供合理默认 → contextOptions 细参覆盖个别字段 → 兜底;复用 buildCore 顶部 resolvedCtxOpts
        ...resolvedCtxOpts,
        llmInvoke: summaryLlmInvoke,
        // A:压缩时注入当前主数据说明(防 LLM 基于过时记忆操作;dataOps 关闭时 liveData() 返回 undefined,无影响)
        getRegisteredData: () => liveData() ? [{ description: liveData()!.description ?? '主数据对象' }] : [],
        // C:跨轮摘要时保留 describe/read 工具的 result 摘要(防字段描述被摘要掉);复用 buildCore 顶部 trimPreserveArr
        preserveLastToolResults: trimPreserveArr,
        // agentCompression:开 + summaryLlm 可用 → decide 驱动压缩(getSnapshot 从 contextInspector 取分类喂 inspect_context)
        ...(useAgentCompression ? { decideInvoke: compressDecisionInvoke, getSnapshot: () => contextInspectorMw?.getSnapshot() } : {}),
      })
    : undefined
  // 中间件按声明式 priority 排序(替代数组字面量位置硬编码);条件构造顺序无关,末尾统一排序保证约束(declarative-middleware-ordering)
  const middlewares = composeMiddlewareStack([
    // dataHint 插最前:数据段紧跟 base(与现状等价);每轮从 liveData() 动态重算
    ...(dataHintMw ? [dataHintMw] : []),
    usageHintsMw,
    // 按 capabilities 条件装载内置中间件(默认全开;verify 默认关)
    ...(useMission ? [missionMw] : []), // mission 在 todos 前(pin 段在 todos 段前;revive-mission-anchor)
    ...(usePlanning ? [todosMw] : []),
    ...(useSkills
      ? [
          skillsMw = createSkillsMiddleware(options.skills || [], {
            // vfs 启用时注入 readVfs,让 skill 文档源(vfs://path)能读取 vfs 文件
            readVfs: useVfs ? (p: string) => vfsStore.files[p]?.content : undefined,
            // skill exec context:'host' 开关(caps.skillHostScript,opt-in 默认关;关时 host 脚本跳过 + warn)
            hostScriptEnabled: caps.skillHostScript,
            // skill 附带工具注入回调:load_skill 后合并 loadedSkillTools + 标 source + rebind(skill-external-scripts §5)
            onToolsReady: (skillName, tools) => {
              for (const t of tools) {
                // 同名 skill 工具先移除旧记录(避免重复累积;dedupeTools 兜底后注册覆盖)
                const existing = loadedSkillTools.findIndex((x) => x.name === t.name)
                if (existing >= 0) loadedSkillTools.splice(existing, 1)
                loadedSkillTools.push(t)
                skillToolOwner.set(t.name, skillName)
                toolSources.set(t.name, `skill:${skillName}`)
              }
              allTools = rebuildExtraTools()
              if (core.agent) core.agent.setTools(allTools)
              core.infoTick.value++
            },
          }),
        ]
      : []),
    ...(useVfs ? [createVfsMiddleware(vfsStore)] : []),
    ...(summarizationMw ? [summarizationMw] : []), // summarization:跨轮历史压缩(setLlm 后 setContextWindow 回灌新窗口)
    ...(useWorkingMemory ? [workingMemoryMw] : []), // summarization 后(augmentPrompt 段跨压缩保留;pin 最近 read/query/search 的 path/hash)
    ...(useFocus ? [focusMw] : []), // workingMemory 后:上下文聚焦(目标/视野/范围三层收敛 pin 段;同 mission 跨压缩保留)
    ...(resourcesPinMw ? [resourcesPinMw] : []), // focus 后:受保护资源清单 pin(每轮注入 ⟦frozen⟧/⟦res⟧ 占位符语义;资源清单天然跨压缩)
    ...(useMemory ? [memoryMw] : []),
    ...(permissionsMw ? [permissionsMw] : []),
    // 会话级 checkpoint:auto 模式每轮 beforeModel 首次自动存(回滚到上次正常时);顺序无关(仅 beforeAgent/beforeModel 副作用)
    ...(useCheckpoint && checkpointAuto && checkpointMgr ? [createCheckpointMiddleware(checkpointMgr)] : []),
    // 人工确认(主动侧):拦截 request_human_confirmation,发 approval_request;装在 approval 白名单之前(更外层,先收口,避免双重确认)
    ...(useHumanConfirm ? [createHumanConfirmMiddleware()] : []),
    // 人工确认(被动侧):白名单工具调用前确认(wrapToolCall 洋葱,此处更内层;实例同 childGuards 注入子栈,fix-authorization-surface)
    ...(approvalMw ? [approvalMw] : []),
    ...(verifyMw ? [verifyMw] : []), // permissions 之后(beforeReturn 正序,verify 在用户自定义中间件前)
    ...(subagentMw ? [subagentMw] : []),
    ...(subagentsMw ? [subagentsMw] : []),
    // parallel-subagent-delegation Q3b:主 agent 写检查(委派在途组件锁前缀拒写;只装主栈,子 agent 走自己的栈)
    ...(componentWriteGuardMw ? [componentWriteGuardMw] : []),
    ...(augmentSystemMw ? [augmentSystemMw] : []),
    ...(contextInspectorMw ? [contextInspectorMw] : []),  // context-inspector:wrapModelCall 快照实际消息构成(大小/分类/占比)
    ...(options.middleware || []),
    // 资源预算闸(automation-layer Phase 4):wrapModelCall 每轮检查 token/time,超限 → aborted response 停止 agent + emit BUDGET_EXCEEDED
    ...(useAutomation ? [createBudgetMiddleware(usage, { tokenBudget: options.tokenBudget, timeBudgetMs: options.timeBudgetMs }, emit)] : []),
    // SDK 事件中间件(最末,最后观察):数据写后发 data_change;每轮结束发 message_update
    // 始终装载 —— 集成方可能运行时 sdk.hook() 订阅,构造时无 onEvent 也需就绪;无监听器时 emit 为 no-op,开销可忽略
    createSdkEventMiddleware(emit, messages, liveData, usage),
  ])

  const maxMemoryRounds = options.maxMemoryRounds ?? DEFAULT_MAX_MEMORY_ROUNDS

  // P1-1(fix-hang-and-feedback):approval/humanConfirm「无响应方路径」自动拒 ——
  // send/batch 走 invoke 无 UI,approval_request 挂起后无人可 resolve → 原实现永久挂死且零可见(humanConfirm 默认开,headless+send 高发)。
  // 超时默认 30s;approval.timeoutMs 显式覆盖(0 同默认 —— 该路径无 UI,等无意义;Infinity/负数 = 无限等,给自建确认通道的集成方留口)。
  // 被拒后 emit observable error 留痕(契约 B);abort 已收口的确认不再误报(查 signal.aborted)。
  const rawApprovalMs = options.approval?.timeoutMs
  const approvalAutoRejectMs =
    rawApprovalMs === undefined || rawApprovalMs === 0 ? 30_000
    : !Number.isFinite(rawApprovalMs) || rawApprovalMs < 0 ? 0
    : rawApprovalMs
  /** invoke 过程事件 handler:监听 approval_request,超时无响应自动拒 + emit error */
  function makeApprovalWatch(signal?: AbortSignal): ((e: import('../types').StreamEvent) => void) | undefined {
    if (!approvalAutoRejectMs) return undefined
    return (e) => {
      if (e.type !== 'approval_request') return
      const startedAt = Date.now()
      const toolName = e.toolName
      setTimeout(() => {
        if (signal?.aborted) return // abort 已自动拒(中间件 signal 联动),不误报
        e.resolve(false)
        emit({ type: 'error', message: `确认请求(${toolName})${Math.round((Date.now() - startedAt) / 1000)}s 无响应已自动拒绝 —— send/batch 路径无 UI 响应方;可传 approval.timeoutMs 调整(Infinity = 无限等)`, severity: 'observable', code: 'APPROVAL_AUTO_REJECTED', context: { toolName, waitedMs: Date.now() - startedAt } } as any)
      }, approvalAutoRejectMs)
    }
  }

  /**
   * send/batch 路径的流事件观察器:approval 自动拒(P1-1)+ observable error 事件转发 emit。
   * 3.11 真 LLM 复测发现:send 路径只传 approvalWatch,agent stream 内的 observable error
   * (GARBLED_TOOL_CALL_EXHAUSTED / ROUND_TOKEN_BUDGET_EXCEEDED / STREAM_STALLED 等)到不了
   * options.onEvent —— headless 集成方对「任务可能未完成」完全无感知。仅转发 error 类
   * (流式 delta 不外发,保持「流式事件仅 stream 模式」契约)。
   */
  function makeStreamWatch(signal?: AbortSignal): (e: import('../types').StreamEvent) => void {
    const approvalWatch = makeApprovalWatch(signal)
    return (e) => {
      approvalWatch?.(e)
      if ((e as any).type === 'error') emit(e as any)
    }
  }

  // session-history Phase 6:会话历史响应式状态下沉(集成方直接消费 sdk.sessions,无需手动 listSessions/refresh/hook)
  const sessionsRef: Ref<SessionMeta[]> = ref([])
  /** 刷新历史会话列表到 sessionsRef(switchSession/deleteSession/onClear/init 后调;storage 未开启 no-op) */
  async function refreshSessions(): Promise<void> {
    if (!store) return
    sessionsRef.value = (await store.listSessions(agentId)).sort((a, b) => b.lastAccessed - a.lastAccessed)
  }

  // ===== P1-11(fix-data-integrity):串行闸 + 在途流注册表建在 core 级 =====
  // shareContext 同 id 多实例共享一个 core = 共享 messages/sessionId/bind —— 屏障必须 core 级,
  // 原实例级私有闸致双实例并发 send/switchSession 写同一 messages(H11 证实);且 core.abortAllActive
  // 原由 _createChatSdk 覆盖赋值,后创建实例顶掉先创建实例的注册表(失联)。
  // 语义变化留痕:shareContext 下生命周期收口(unmount/switchSession/resetSession)中止共享 core 的全部在途流
  // (含其他实例发起的)—— 共享状态不允许孤儿流继续写(推翻 2.39.0「一个实例 unmount 不中断另一实例的生成」注释)。
  const runSerial = createSerialRunner()
  const activeControllers = new Set<AbortController>()
  /** 登记在途流:建内部 controller + 联动外部 signal;返回 controller 与注销函数 */
  function trackActive(outer?: AbortSignal): { controller: AbortController; untrack: () => void } {
    const controller = new AbortController()
    if (outer) {
      if (outer.aborted) controller.abort()
      else outer.addEventListener('abort', () => controller.abort(), { once: true })
    }
    activeControllers.add(controller)
    return { controller, untrack: () => activeControllers.delete(controller) }
  }
  function abortAllActive(): void {
    for (const c of activeControllers) c.abort()
    activeControllers.clear()
  }

  const core: AgentCore = {
    agentId,
    store,
    messages,
    vfsStore,
    listeners: events.listeners,
    todosMw,
    memoryMw,
    missionMw,
    workingMemoryMw,
    focusMw,
    agent: null,
    initDone: Promise.resolve(),
    sessionId: '',
    refCount: 0,
    mcpClosers: [],
    mcpServers: [],
    checkpoint: checkpointMgr,
    dataOpsController,
    skillsController: skillsMw ? (skillsMw as any).controller as import('../harness/skills').SkillsController : null,
    infoTick,
    pendingConflict: conflictMgr.pendingConflict,
    sessions: sessionsRef,
    refreshSessions,
    liveData,
    usage,
    emit,
    runSerial,
    trackActive,
    abortAllActive,

    /** 卸载 skill 附带工具(setSkills 替换整个列表清全部 / invalidateSkillCache 指定 skill;skill-external-scripts §5) */
    unloadSkillTools(name?: string) {
      if (!name) {
        if (!loadedSkillTools.length) return
        for (const t of loadedSkillTools) { toolSources.delete(t.name); skillToolOwner.delete(t.name) }
        loadedSkillTools = []
      } else {
        const before = loadedSkillTools.length
        loadedSkillTools = loadedSkillTools.filter((t) => {
          if (skillToolOwner.get(t.name) === name) { toolSources.delete(t.name); skillToolOwner.delete(t.name); return false }
          return true
        })
        if (loadedSkillTools.length === before) return
      }
      allTools = rebuildExtraTools()
      if (core.agent) core.agent.setTools(allTools)
    },

    /** 持久化恢复:灌入 messages / vfs / todos / memory / userSkills(hydrate 不触发 vfs save) */
    applySnapshot(snap: SessionSnapshot): void {
      if (snap.messages?.length) messages.push(...snap.messages)
      if (snap.vfs && vfsStore.hydrate) vfsStore.hydrate(snap.vfs)
      if (snap.todos?.length) todosMw.reset(snap.todos)
      // memory:options.memory 优先(非空覆盖),否则用持久化的
      if (snap.memory && !options.memory) memoryMw.reset(snap.memory)
      // automation 断点续跑:恢复 checkpoint 栈 + 累计 usage(刷新后 restoreLastCheckpoint 能用 + 预算统计连续)
      if (snap.checkpoints?.length && checkpointMgr) checkpointMgr.importStack(snap.checkpoints)
      // 恢复累计 usage(断点续跑:刷新后预算统计连续)。一次性恢复覆盖:此处把 snap.usage 整体赋到 usage;
      // 之后 sdk-events afterModel 在恢复后的 usage 上继续累加 —— 非"双写"(applySnapshot 恢复时一次性 + afterModel 每轮累加,时机不同,语义一致:恢复基线 + 后续累加)
      if (snap.usage) Object.assign(usage, snap.usage)
      // context-persist-resilience 功能A:恢复 mission/workingMemory(刷新/切会话后长任务目标 + 工作记忆不丢;reset 在 applySnapshot 前,恢复值不被清)
      if (snap.mission && useMission) missionMw.setMission(snap.mission)
      if (snap.workingMemory && useWorkingMemory) workingMemoryMw.restore(snap.workingMemory)
      // focus-auto-switch:恢复 focus(刷新/切会话后聚焦状态保留)。
      // multi-focus:归一化(优先 focuses 数组,fallback 旧 focus 单个 → [focus])+ 逐 path 校验剔除失效(schema 变化);与 sdk.setFocus 单一真相
      if (useFocus) {
        const raw = snap.focus
        const foci: Focus[] = !raw ? [] : Array.isArray(raw) ? raw : [raw]
        if (foci.length) {
          const focusSchema = liveData()?.schema
          const valid = focusSchema ? foci.filter((f) => getSchemaAtPath(focusSchema, f.path)) : []
          if (valid.length) {
            focusMw.setFocus(null) // 清默认态,逐个 addFocus 重建多焦点
            valid.forEach((f) => focusMw.addFocus(f))
          }
          if (options.debug && valid.length < foci.length) {
            const dropped = foci.filter((f) => !valid.includes(f)).map((f) => f.path)
            console.warn('[page-agent-sdk][focus] 恢复的焦点部分 path 已失效(schema 变化/无 schema),剔除:', dropped)
          }
        }
      }
      // context-persist-resilience 功能B:加载兜底 GC —— 清历史孤儿(旧存档漏网 / 上轮 GC 漏的);新会话无孤儿则空操作
      gcVfsOrphans()
      // 注:用户创建的 skill 不再随 SessionSnapshot 持久化,由独立 SkillStore 管理(见 loadUserSkillsFromStore)
    },

    /** 添加用户创建的 skill(持久化到 SkillStore + 入 controller;同名覆盖) */
    addSkill(skill: SkillSpec): void {
      const idx = userSkills.findIndex((s) => s.name === skill.name)
      if (idx >= 0) userSkills[idx] = skill
      else userSkills.push(skill)
      syncUserSkills()
      if (skillStore) void skillStore.put(toPersistedSkill(skill))
    },
    /** 删除用户创建的 skill(仅删用户创建的;从 SkillStore 移除);返回是否删除成功 */
    removeSkill(name: string): boolean {
      const idx = userSkills.findIndex((s) => s.name === name)
      if (idx < 0) return false
      userSkills.splice(idx, 1)
      syncUserSkills()
      if (skillStore) void skillStore.remove(name)
      return true
    },
    /** 列出用户创建的 skill 名(仅用户创建的,不含集成方 initialSkills) */
    listUserSkills(): string[] {
      return userSkills.map((s) => s.name)
    },
    /** 读取用户创建的 skill 详情(SkillPanel 编辑时调) */
    getUserSkill(name: string): { name: string; description: string; content: string } | undefined {
      const s = userSkills.find((u) => u.name === name)
      if (!s) return undefined
      return {
        name: s.name,
        description: s.description,
        content: typeof s.getContent === 'function' ? (s.getContent() as string) : '',
      }
    },

    /** 一轮结束后:裁内存历史(防 OOM)+ 安排持久化(debounced)。落盘等待由 onPersist/send 显式 await flush 保证 */
    afterRound(): void {
      trimMemoryMessages()
      persistRuntime()
    },

    async send(message: string, options?: SendOptions): Promise<string> {
      await core.initDone
      // 容错:partial 调用(headless 实测 sdk.send(msg) 不传 options)→ 默认空对象,避免 options.interceptors 误访问 undefined
      options = options ?? {}
      // mission 显式覆盖(send({mission}) 优先于自动 capture)
      if (options?.mission && useMission) missionMw.setMission(options.mission)
      // input 拦截器:send 入口预处理 user message(可改写/审计)
      let msg = message
      if (options.interceptors?.input) {
        try { const r = options.interceptors.input(message); if (typeof r === 'string') msg = r } catch { /* 拦截器抛错忽略,用原 message */ }
      }
      // automation 无人值守错误恢复:致命错误(invoke 抛错)→ restore_last_checkpoint 回到本轮前 + 重试(限 maxAutoRetries 次防循环)。
      // 适合无人值守批量/长任务:单点模型/工具致命错误不永久中断,自动回退重试;确定性错误重试仍耗尽 → fatal(emit + throw)。
      // checkpoint 在 beforeModel save(时点在 push user 后)→ restore 后 messages 已含本轮 user,故用 pushed 标记避免重复 push。
      const maxAuto = useAutomation ? (options.maxAutoRetries ?? 1) : 0
      let attempt = 0
      let pushed = false
      // P1-1(fix-hang-and-feedback):无响应方路径自动拒确认 + observable error 转发(详见 makeStreamWatch 注释)
      const streamWatch = makeStreamWatch(options.signal)
      while (true) {
        if (!pushed) {
          messages.push({ role: 'user', content: msg, timestamp: Date.now() })
          pushed = true
        }
        try {
          // P1-4(fix-hang-and-feedback):signal 穿透 —— 原 invoke 不带 signal,send 完全不可中断(headless 唯一出路=刷新)
          let reply = await core.agent!.invoke(messages, options.signal, streamWatch)
          // output 拦截器:返回前 postprocess(可改写最终回复)
          if (options.interceptors?.output) {
            try { const r = options.interceptors.output(reply); if (typeof r === 'string') reply = r } catch { /* 拦截器抛错忽略,用原 reply */ }
          }
          messages.push({ role: 'assistant', content: reply, timestamp: Date.now() })
          core.afterRound()
          if (store) await store.flush() // 确保落盘完成(indexed 异步事务;刷新前已写入)
          return reply
        } catch (err) {
          // abort(用户经 signal 中止):不计错误,静默上抛(同 useChat「abort 不计入 error」语义)
          if (isAbort(err, options.signal)) throw err
          const ae = asAgentError(err, 'fatal')
          // 仍有重试次数 + 有 checkpoint 可回退 → restore 回本轮前(含本轮 user)+ 重试,emit observable 告知
          if (attempt < maxAuto && checkpointMgr?.canRestore()) {
            attempt += 1
            checkpointMgr.restore()
            pushed = true // restore 后 messages 已含本轮 user(checkpoint 在 beforeModel save,时点在 push user 后),不重复 push
            emit({ type: 'error', message: `致命错误自动恢复(${attempt}/${maxAuto}):${ae.message},已回退 checkpoint 重试`, severity: 'observable', code: 'AUTO_RECOVER_RETRY', context: { attempt, cause: ae.code ?? ae.message.slice(0, 120) } } as any)
            continue
          }
          // 重试耗尽或未开 automation:invoke 抛错 = fatal(emit 结构化 error + 重新抛中断);asAgentError 归一化提取 severity/code/context
          emit({ type: 'error', message: ae.message, severity: ae.severity, ...(ae.code ? { code: ae.code } : {}), ...(ae.context !== undefined ? { context: ae.context } : {}) } as any)
          throw err
        }
      }
    },

    /**
     * 批处理(automation):逐任务跑 agent,每任务前自动 checkpoint(失败可 restoreLastCheckpoint 回退到任务前),
     * 任务间错误隔离(单任务失败不中断整批,记 observable error 继续下一个)。适合无人值守批量操作(批量生成/改一批页面)。
     * 不经 UI 排队(直接 invoke);返回每个任务结果(成功 reply / 失败 error)。配合 capabilities.automation + checkpoint 使用。
     */
    async batch(tasks: string[], onProgress?: (p: BatchProgress) => void, signal?: AbortSignal): Promise<BatchResult[]> {
      await core.initDone
      if (!tasks.length) return []
      const results: BatchResult[] = []
      const streamWatch = makeStreamWatch(signal)  // P1-1:批处理同样无 UI 响应方,确认超时自动拒;error 转发同 send
      for (let i = 0; i < tasks.length; i++) {
        // P1-4(fix-hang-and-feedback):外部 abort → 停止剩余任务(剩余记 aborted,不静默丢)
        if (signal?.aborted) {
          for (let j = i; j < tasks.length; j++) results.push({ index: j, task: tasks[j], error: 'aborted(外部中止)', ok: false })
          break
        }
        const task = tasks[i]
        // 每任务前存 checkpoint:该任务失败时 restoreLastCheckpoint 可回退到任务前态
        if (checkpointMgr) checkpointMgr.save(`batch:${i}`)
        const beforeLen = messages.length  // 失败时 truncate 回(撤销本轮 user + invoke 期间的中间 push)
        try {
          messages.push({ role: 'user', content: task, timestamp: Date.now() })
          const reply = await core.agent!.invoke(messages, signal, streamWatch)
          messages.push({ role: 'assistant', content: reply, timestamp: Date.now() })
          core.afterRound()
          if (store) await store.flush()
          results.push({ index: i, task, reply, ok: true })
          onProgress?.({ done: i + 1, total: tasks.length, task, ok: true })
        } catch (err) {
          // 任务级错误隔离:invoke 抛错不中断整批;truncate 回本轮前(撤销 user + 中间 push,防失败 user 残留致下一任务连续 user 上下文错乱 — bug-review MED)+ 记 observable error
          if (messages.length > beforeLen) messages.splice(beforeLen)
          // abort:本任务记 aborted,剩余任务同样标记后收口(不继续跑)
          if (isAbort(err, signal)) {
            results.push({ index: i, task, error: 'aborted(外部中止)', ok: false })
            for (let j = i + 1; j < tasks.length; j++) results.push({ index: j, task: tasks[j], error: 'aborted(外部中止)', ok: false })
            break
          }
          const ae = asAgentError(err, 'fatal')
          emit({ type: 'error', message: `批量任务 ${i + 1}/${tasks.length} 失败:${ae.message}`, severity: 'observable', code: 'BATCH_TASK_FAILED', context: { index: i, task: task.slice(0, 100) } } as any)
          results.push({ index: i, task, error: ae.message, ok: false })
          onProgress?.({ done: i + 1, total: tasks.length, task, ok: false })
        }
      }
      return results
    },

    /** 切换会话:flush 当前 → 载入/新建目标 → 清内存态并灌入快照(替换语义)→ 返回新会话 id */
    async switchSession(sessionId?: string): Promise<string> {
      await core.initDone
        if (!store) throw new Error('page-agent-sdk: storage 未开启,无法切换会话(请传 storage 选项)')
      // 收口挂起的冲突(按「保留外部」),防切会话后旧 conflict Promise 永久挂起
      conflictMgr.resolve('keep_external')
      // context-persist-resilience:切走前 persist 当前会话的 mission/workingMemory(防 setMission / 工作记忆积累后切走丢失;persistRuntime 仅 afterRound 触发,setMission 后未发消息即切会话会漏存)
      if (core.sessionId && store) {
        if (useMission) { const m = missionMw.getMission(); if (m) void store.save(agentId, core.sessionId, { mission: m } as Partial<SessionSnapshot>) }
        if (useWorkingMemory) { const wm = workingMemoryMw.getWorkingMemory(); if (wm) void store.save(agentId, core.sessionId, { workingMemory: wm } as Partial<SessionSnapshot>) }
        // focus-auto-switch:切走前 persist focus(有值存值;clearFocus 后存 null 覆盖清除)
        if (useFocus) { const fs = focusMw.getFocuses(); void store.save(agentId, core.sessionId, { focus: fs.length ? fs : null } as Partial<SessionSnapshot>) }
      }
      vfsStore.flush?.()
      await store.flush()
      let target = sessionId ?? ''
      let snap: SessionSnapshot | undefined
      if (target) {
        snap = await store.load(agentId, target)
        if (!snap) await store.createSession(agentId, options.session?.title, target)
      } else {
        target = await store.createSession(agentId, options.session?.title)
      }
      core.sessionId = target
      // 清空当前内存态(替换语义,非叠加)
      messages.splice(0, messages.length)
      vfsStore.clear?.()
      todosMw.reset([])
      if (!options.memory) memoryMw.reset('')
      // P1-5:切会话重置 mission/workingMemory,防旧会话 goal / 定位 path·hash 污染新会话(过期 hash 诱发乐观锁误冲突)
      missionMw.reset()
      workingMemoryMw.reset()
      focusMw.reset()
      // session-history S1:切会话清 checkpoint 栈,防旧会话快照污染新会话(开 checkpoint 时,否则 restore 会回退到旧会话态)
      if (checkpointMgr) checkpointMgr.importStack([])
      // 释放上一会话的调试日志(切会话后旧日志不再相关,立即释放内存)
      core.agent!.debugLogs.value = []
      if (!snap) snap = await store.load(agentId, target)
      if (snap) {
        core.applySnapshot(snap)
        emit({ type: 'session_restored', sessionId: target, rounds: snap.messages?.length ?? 0 })
      }
      if (options.memory) void store.save(agentId, core.sessionId, { memory: memoryMw.get() || (typeof options.memory === 'string' ? options.memory : '') })
      void refreshSessions()  // session-history Phase 6:切会话后刷新历史列表(响应式 sessions 自动更新)
      lastTitle = undefined; titleLLMDone = false   // 切会话:重置 title 缓存 + LLM 标志,新会话重新生成
      core.infoTick.value++ // 同 resetSession:focus 重置/快照恢复后 bump,防输入框聚焦 chip 残留旧焦点
      return target
    },

    /** 新建/清空会话:重置内存态(messages/vfs/todos/memory/mission/workingMemory/focus/checkpoint/debugLogs)+ 新 sessionId + emit session_restored。
     *  fix-data-integrity P1-8:删「!store 早退」—— 内存态重置无条件执行(storage 关时清空对话不再泄漏 mission/focus/todos 等进新对话),
     *  仅 store 相关(createSession)按 store 门控。P1-9:入口 abort + 收口挂起冲突(与 switchSession/unmount 对齐;keep_external 不写入,无跨会话写风险)。
     *  收编进 core(主流程审查 P0-4):onClear 闭包原在 createChatSdk 作用域赋值 buildCore 局部 lastTitle/titleLLMDone → 运行期 ReferenceError;
     *  共享状态变更一律 AgentCore 方法(mount Wrapper 只传引用不写逻辑,1.3.1 教训机制化)。 */
    resetSession: () => {
      abortAllActive() // 契约 C(fix-hang-and-feedback):清空会话先中止在途流(防幽灵流写进新会话)
      conflictMgr.resolve('keep_external') // P1-9:收口挂起冲突(唯一不收口的生命周期路径补齐;keep_external 语义放弃本次写,无跨会话写窗口)
      core.sessionId = makeId()
      messages.splice(0, messages.length) // 自包含清空(与 switchSession 对齐;UI useChat.clearMessages 再 splice 为 no-op)
      vfsStore.clear?.()
      todosMw.reset([])
      if (!options.memory) memoryMw.reset('')
      missionMw.reset()
      workingMemoryMw.reset()
      focusMw.reset()
      if (checkpointMgr) checkpointMgr.importStack([])
      if (core.agent) core.agent.debugLogs.value = []
      if (store) {
        void store.createSession(core.agentId, options.session?.title, core.sessionId)
      }
      emit({ type: 'session_restored', sessionId: core.sessionId, rounds: 0 })
      core.infoTick.value++ // 焦点等 UI computed(focuses chip)挂 infoTick;reset 清焦点后不 bump → 输入框聚焦 chip 残留旧焦点(用户实测)
      void refreshSessions() // 内部守卫:storage 未开启 no-op
      lastTitle = undefined; titleLLMDone = false
    },

    stream: (msgs, onEvent, signal) => {
      if (!core.agent) throw new Error('page-agent-sdk: agent 尚未初始化完成,请先 await mount()')
      // P4(harden-context-resilience):注入被引用集 → vfs LRU 淘汰时跳过被消息引用的 large_results(防 vfs_read 404)
      vfsStore?.setProtectedRefs?.(extractVfsRefs(msgs))
      // 包装:流式事件恒转发内部 UI handler + emit(外发 options.onEvent + sdk.hook listeners)。
      // 修复(P1-23):旧实现仅当传了 options.onEvent 才调 emit → 不传 onEvent 时 sdk.hook() 收不到流式事件。
      const wrappedHandler: StreamHandler = (event) => {
        onEvent?.(event); emit(event as SdkEvent)
        // 子 agent 工具进度 → bump infoTick 让 DebugDrawer「🤖 子 agent」tab 实时刷新
        // (reasoning 高频不 bump:主 UI 已实时展示思考过程,避免 DebugDrawer 高频重算)
        if (event.type === 'subagent' && (event.kind === 'tool_call' || event.kind === 'tool_result')) core.infoTick.value++
      }
      // abort 联动:用户停止生成时,自动收口挂起的乐观锁冲突(按「保留外部」处理,防工具永久挂起)
      if (signal) {
        const abortConflict = () => conflictMgr.resolve('keep_external')
        if (signal.aborted) abortConflict()
        else signal.addEventListener('abort', abortConflict, { once: true })
      }
      // P1-11:在途流登记移入 core 级注册表(此处统一;UI fetchStream = core.stream 也首次纳入,unmount/switch/reset 的 abort 可触达)
      const { controller, untrack } = trackActive(signal)
      return core.agent.stream(msgs, wrappedHandler, controller.signal).finally(untrack)
    },

    release(): void {
      core.refCount--
      if (core.refCount <= 0) {
        abortAllActive() // P1-11:dispose 前先断全部在途流(防流在途关 store/MCP 资源;原 H11「release 关资源时流在途」)
        mcpBackgroundReleased = true // MCP 后台握手若仍在途:完成后直接关连接,不回填已释放 core(mcp-e2e 真测)
        if (store) {
          vfsStore.flush?.()
          void store.flush()
          store.dispose()
        }
        if (skillStore) skillStore.dispose()
        const closers = core.mcpClosers.splice(0)
        if (closers.length) void Promise.allSettled(closers.map((c) => c()))
        sharedCores.delete(agentId)
      }
    },

    resolveConflict: conflictMgr.resolve,

    /** 运行时替换用户工具集(内置不动);立即 rebind + infoTick 刷新 */
    setTools(tools: StructuredToolInterface[]): void {
      userTools.length = 0
      tools.forEach((t) => { userTools.push(t); toolSources.set(t.name, 'user') })
      allTools = rebuildExtraTools()
      if (core.agent) core.agent.setTools(allTools)
      core.infoTick.value++
    },
    /** 运行时追加用户工具(tool-name-collision:重名按后注册覆盖先注册,跨最终工具集去重 + warn,不再静默 return) */
    addTool(tool: StructuredToolInterface): void {
      if (allTools.some((t) => t.name === tool.name)) {
        console.warn(`[page-agent-sdk] 工具 "${tool.name}" 已存在,新工具覆盖(后注册覆盖先注册)`)
      }
      // userTools 内同名先移除(避免数组脏累积);rebuildExtraTools 的 dedupeTools 保证最终唯一(且 user 覆盖 builtin/action)
      for (let i = userTools.length - 1; i >= 0; i--) if (userTools[i].name === tool.name) userTools.splice(i, 1)
      userTools.push(tool)
      toolSources.set(tool.name, 'user')
      allTools = rebuildExtraTools()
      if (core.agent) core.agent.setTools(allTools)
      core.infoTick.value++
    },
    /** 运行时移除用户工具(by name;内置不动);返回是否移除成功 */
    removeTool(name: string): boolean {
      const idx = userTools.findIndex((t) => t.name === name)
      if (idx < 0) return false
      userTools.splice(idx, 1)
      toolSources.delete(name)
      allTools = rebuildExtraTools()
      if (core.agent) core.agent.setTools(allTools)
      core.infoTick.value++
      return true
    },
    /** 运行时切换 LLM(BaseChatModel 或 LLMConfig);rebind + 重解析能力 + infoTick */
    setLlm(llmOpt: BaseChatModel | LLMConfig): void {
      let newLlm: BaseChatModel
      if (isChatModel(llmOpt)) {
        newLlm = llmOpt as BaseChatModel
      } else {
        const cfg = llmOpt as LLMConfig
        if ((cfg.provider ?? 'openai') === 'anthropic') {
          // Anthropic 动态 import 无法同步:setLlm 是同步契约(void),切 Anthropic 需传预构造的 BaseChatModel 实例
          throw new Error('[page-agent-sdk][setLlm] 切换到 Anthropic 需传 BaseChatModel 实例(动态 import 无法同步);请先 const { ChatAnthropic } = await import("@langchain/anthropic") 构造实例后传入')
        }
        newLlm = constructOpenLlmSync(cfg)
      }
      if (typeof (newLlm as any).bindTools !== 'function' && options.debug) {
        console.warn('[page-agent-sdk][setLlm] 新模型不支持 bindTools(tool calling 会失效)')
      }
      currentLlm = llmOpt
      // harden-context-resilience:权威重算 modelCaps(用原 llmOpt,保留 LLMConfig.contextWindow 声明)+ 最小窗口校验 + 集中回灌
      // (setLlm 把 LLMConfig 构造成 BaseChatModel 实例后 contextWindow 声明丢失;onLlmChange 拿不到 → 在此用 llmOpt 重算)
      const llmCfg = isChatModel(llmOpt) ? undefined : (llmOpt as LLMConfig)
      modelCaps = resolveModelCaps({
        model: llmCfg?.model ?? (llmOpt as any).model ?? (llmOpt as any).modelName,
        contextWindow: options.contextWindow ?? llmCfg?.contextWindow,
        maxOutputTokens: options.maxOutputTokens ?? llmCfg?.maxOutputTokens,
      })
      if (modelCaps.contextWindow < MIN_CONTEXT_WINDOW) {
        throw new Error(`[page-agent-sdk][setLlm] 新模型上下文窗口 ${modelCaps.contextWindow} 小于最小支持 ${MIN_CONTEXT_WINDOW}(需 ≥200K 窗口模型)`)
      }
      if (core.agent) {
        core.agent.setLlm(newLlm) // → onLlmChange(仅更新 currentLlm 实例)
        core.agent.setModelCaps?.(modelCaps) // offload 阈值跟随新窗口(修原固化)
      }
      summarizationMw?.setContextWindow?.(modelCaps.contextWindow)
      contextInspectorMw?.setContextWindow?.(modelCaps.contextWindow)
      core.infoTick.value++
      if (options.debug) console.log('[page-agent-sdk][setLlm] 重解析 modelCaps + 回灌:', modelCaps)
    },
    /** 运行时更新 memory;支持 string 与同步/异步函数(异步函数后台求值,下一轮 beforeAgent 前就绪)*/
    setMemory(source: string | (() => string | Promise<string>)): void {
      memoryMw.reset(source)
      if (typeof source === 'function') void memoryMw.refresh()
      core.infoTick.value++
    },
    /** 重新求值当前 memory 函数 source(用于 RAG 文档更新后强制刷新);返回最新文本 */
    refreshMemory(): Promise<string> {
      return memoryMw.refresh()
    },
    /** 运行时替换预声明子 agent 列表(重新生成委派工具 + rebind) */
    setSubagents(configs: SubagentConfig[]): void {
      if (!subagentsController) {
        if (options.debug) console.warn('[page-agent-sdk][setSubagents] 未配 subagents:[] 或 capabilities.subagent 关闭,忽略')
        return
      }
      subagentsController.set(configs)
      core.infoTick.value++
    },
    /** 运行时追加预声明子 agent */
    addSubagent(config: SubagentConfig): void {
      if (!subagentsController) {
        if (options.debug) console.warn('[page-agent-sdk][addSubagent] 未配 subagents:[] 或 capabilities.subagent 关闭,忽略')
        return
      }
      subagentsController.add(config)
      core.infoTick.value++
    },
    /** 运行时移除预声明子 agent(by id) */
    removeSubagent(id: string): boolean {
      if (!subagentsController) {
        if (options.debug) console.warn('[page-agent-sdk][removeSubagent] 未配 subagents:[] 或 capabilities.subagent 关闭,忽略')
        return false
      }
      const removed = subagentsController.remove(id)
      if (removed) core.infoTick.value++
      return removed
    },
    /** 运行中子 agent 列表(观察层;空=无在跑;capabilities.subagent 关闭 → 空数组) */
    getActiveSubagents(): SubagentRunState[] {
      return subagentTracker?.getActive() ?? []
    },
    /** 子 agent 委派历史(观察层 getter;LRU≤20,最新在前;每次访问实时取最新) */
    get subagentHistory(): SubagentRunState[] {
      return subagentTracker?.getHistory() ?? []
    },

    /** 检视 agent 详情:tools/skills/data/memory/middleware/todos(inspect() 与 debug 窗口消费) */
    getInfo(): AgentInfo {
      return {
        id: agentId,
        sessionId: core.sessionId,
        model: isChatModel(currentLlm) ? ((currentLlm as any).model ?? (currentLlm as any).modelName) : (currentLlm as LLMConfig).model,
        // 代理到 createAgent 权威拼装(base + Σ augmentPrompt,含 usageHints/skills/memory/todos/subagents/augmentSystem 等全部段);agent 未构造时回退 base+data(fix-introspection-consistency)
        systemPrompt: core.agent?.getEffectiveSystemPrompt?.() ?? (baseSystemPrompt + buildDataPrompt(liveData(), options.schemaHint)),
        tools: (core.agent?.allTools ?? allTools).map((t) => ({ name: t.name, description: t.description, schema: (t as any).schema, source: toolSources.get(t.name) || 'user' })),
        skills: (skillsMw ? (skillsMw as any).controller.get() as SkillSpec[] : (options.skills ?? [])).map((s) => ({ name: s.name, description: s.description })),
        data: liveData() ? { description: liveData()!.description, schema: liveData()!.schema } : undefined,
        contextPreset: options.contextPreset ?? 'auto',
        // 压缩触发配置反射(context-economy-phase2:softCap 解析结果可见,集成方可核对提前压缩是否生效)
        compression: {
          contextWindow: modelCaps.contextWindow,
          summaryThresholdRatio: resolvedCtxOpts.summaryThresholdRatio ?? 0.5,
          promptSoftCap: resolvePromptSoftCap(modelCaps.contextWindow, resolvedCtxOpts.promptSoftCapTokens),
        },
        memory: memoryMw.get(),
        middleware: middlewares.map((m) => m.name),
        todos: (core.agent?.getState?.()?.todos ?? []).map((t) => ({
          id: t.id, content: t.content, status: t.status,
          ...(t.parentId !== undefined ? { parentId: t.parentId } : {}),
          ...(t.deps !== undefined ? { deps: t.deps } : {}),
          ...(t.criteria !== undefined ? { criteria: t.criteria } : {}),
          ...(t.evidence !== undefined ? { evidence: t.evidence } : {}),
        })),
        planPhase: todosMw.getPlanPhase(),
        mission: useMission ? missionMw.getMission() : undefined,
        workingMemory: useWorkingMemory ? workingMemoryMw.getWorkingMemory() : undefined,
        focus: useFocus ? focusMw.getFocus() : undefined,
        focuses: useFocus ? focusMw.getFocuses() : [],
        trace: useTracing && core.agent?.spans ? { spans: core.agent.spans.value, metrics: getTraceMetrics(core.agent.spans.value) } : undefined,
        actions: actionsToInspectInfo(options.actions ?? {}),
        subagent: {
          enabled: !!subagentMw,
          maxDepth: options.subagent?.maxDepth ?? 1,
          maxParallel: options.subagent?.maxParallel ?? 4,
          allowedTools: options.subagent?.allowedTools ?? [],
          // 预声明子 agent 列表(动态:反映 setSubagents/addSubagent/removeSubagent 后的最新)
          subagents: subagentsController?.get() ?? [],
          // 观察层:运行中(active)+ 历史(history LRU≤20)委派状态(会话级,实时反映)
          active: subagentTracker?.getActive() ?? [],
          history: subagentTracker?.getHistory() ?? [],
          // 组件锁视图(组件名 → 占用委派 taskId;parallel-subagent-delegation Q4a,无锁场景为空对象)
          lockedComponents: componentLock?.locked() ?? {},
        },
        verify: {
          enabled: !!verifyMw,
          maxAttempts: useVerify ? verifyMaxAttempts : 0,
          adversarial: useVerify && !!options.verify?.adversarial,
        },
        // 上下文构成快照(每轮 wrapModelCall 覆盖;复用 state.lastCompression 注入压缩统计,非新增写入路径)
        context: (() => {
          const snap = contextInspectorMw?.getSnapshot()
          if (snap) {
            const lc = core.agent?.getState?.()?.lastCompression
            if (lc) snap.compression = lc
          }
          return snap
        })(),
        mcp: { servers: core.mcpServers },
        lastCompression: core.agent?.getState?.()?.lastCompression as AgentInfo['lastCompression'],
        checkpoints: checkpointMgr
          ? { enabled: true, auto: checkpointAuto, list: checkpointMgr.list() }
          : undefined,
      }
    },
    /** 读取当前 mission(capture 或 setMission;capabilities.missionAnchor:false → undefined) */
    getMission(): Mission | undefined {
      return useMission ? missionMw.getMission() : undefined
    },
    /** 显式设置/覆盖 mission(传 {goal} 重设;传 {goal,criteria} 整体替换;传 {} 清空);capabilities 关时 warn 不抛 */
    setMission(m: Partial<Mission>): void {
      if (!useMission) {
        if (options.debug) console.warn('[page-agent-sdk][mission] capabilities.missionAnchor 关闭,setMission 忽略')
        return
      }
      missionMw.setMission(m)
      core.infoTick.value++ // 触发 DebugDrawer 刷新
    },
    /** 读取当前聚焦焦点(兼容:返回首个 focus;未聚焦 / capabilities.focus:false → undefined) */
    getFocus(): Focus | undefined {
      return useFocus ? focusMw.getFocus() : undefined
    },
    /** 读取全部聚焦焦点(multi-focus;空数组=未聚焦;capabilities.focus:false → []) */
    getFocuses(): Focus[] {
      return useFocus ? focusMw.getFocuses() : []
    },
    /** 设置聚焦焦点(替换全部;path 经 getSchemaAtPath 校验在 schema 内才可聚焦);非法/无 schema 返回 {ok:false,error};capabilities.focus:false 返回 {ok:false} 不抛 */
    setFocus(focus: Focus): { ok: boolean; error?: string } {
      const r = validateFocusInput(focus, 'setFocus', useFocus, () => liveData()?.schema, options.debug)
      if (!r.ok) return r
      focusMw.setFocus(focus)
      core.infoTick.value++ // 触发 DebugDrawer 刷新
      return { ok: true }
    },
    /** 追加聚焦焦点(multi-focus 累积,去重 by path;校验同 setFocus);capabilities.focus:false 返回 {ok:false} */
    addFocus(focus: Focus): { ok: boolean; error?: string } {
      const r = validateFocusInput(focus, 'addFocus', useFocus, () => liveData()?.schema, options.debug)
      if (!r.ok) return r
      // 焦点数上限:augmentPrompt 为每个焦点注入子树 schema,过多撑爆 system prompt(harden-context-resilience 25% 预算会 drop)
      if (focusMw.getFocuses().length >= 8) {
        if (options.debug) console.warn('[page-agent-sdk][focus] addFocus 拒绝:焦点数已达上限 8(augmentPrompt 注入每焦点子树 schema,过多致 system prompt 超预算)')
        return { ok: false, error: '焦点数上限 8(避免 system prompt 撑爆)' }
      }
      focusMw.addFocus(focus)
      core.infoTick.value++
      return { ok: true }
    },
    /** 移除单个聚焦焦点(by path);capabilities.focus:false → no-op */
    removeFocus(path: string): void {
      if (!useFocus) return
      focusMw.removeFocus(path)
      core.infoTick.value++
    },
    /** 清除全部聚焦焦点(退出精修模式,恢复全量可操作范围) */
    clearFocus(): void {
      if (!useFocus) return
      focusMw.clearFocus()
      core.infoTick.value++
    },
  }

  /** 解析会话 id + 载入快照(仅 store 非 null 时) */
  async function resolveAndLoad(): Promise<void> {
    if (!store) return
    await store.ready
    const sessOpts = options.session || {}
    if (sessOpts.id) {
      core.sessionId = sessOpts.id
      const snap = await store.load(agentId, core.sessionId)
      if (snap) {
        core.applySnapshot(snap)
        emit({ type: 'session_restored', sessionId: core.sessionId, rounds: snap.messages?.length ?? 0 })
      } else await store.createSession(agentId, sessOpts.title, core.sessionId)
    } else if (sessOpts.autoResume !== false) {
      const sessions = await store.listSessions(agentId)
      if (options.debug) console.log('[page-agent-sdk][restore] listSessions', agentId, sessions.length, sessions.map((s) => s.sessionId))
      if (sessions.length) {
        core.sessionId = sessions[0].sessionId
        const snap = await store.load(agentId, core.sessionId)
        if (snap) {
          core.applySnapshot(snap)
          emit({ type: 'session_restored', sessionId: core.sessionId, rounds: snap.messages?.length ?? 0 })
          if (options.debug) console.log('[page-agent-sdk][restore] 恢复会话', core.sessionId, `${snap.messages?.length ?? 0} msgs`)
        } else if (options.debug) {
          console.log('[page-agent-sdk][restore] 会话 meta 存在但快照为空', core.sessionId)
        }
      } else {
        core.sessionId = await store.createSession(agentId, sessOpts.title)
        if (options.debug) console.log('[page-agent-sdk][restore] 新建会话(无历史)', core.sessionId)
      }
    } else {
      core.sessionId = await store.createSession(agentId, sessOpts.title)
    }
    // options.memory 落盘(每次启动确保持久化;加载时 options 优先已在 applySnapshot 处理)
    // 函数 source 落盘已解析的文本(函数本身不可序列化,且 reload 时 options.memory 仍是函数会重新求值)
    if (options.memory) void store.save(agentId, core.sessionId, { memory: memoryMw.get() || (typeof options.memory === 'string' ? options.memory : '') })
    void refreshSessions()  // session-history Phase 6:init 载入会话后刷新历史列表
  }

  /** Skill 独立加载:从 SkillStore 恢复用户创建的 skill(与 storage 选项分离,即使 storage:false 也持久化) */
  async function loadUserSkills(): Promise<void> {
    await loadUserSkillsFromStore()
  }

  /**
   * 内存对话轮数上限:超限把最旧轮次压缩为一条摘要 system 消息(原地 splice,保持共享响应式引用)。
   * storage:false 也生效 —— 纯内存历史累积的 OOM 兜底。
   * 核心逻辑经纯函数 trimMemoryMessagesImpl(可单测):头部旧摘要并入新摘要,防更早摘要逐级丢失。
   */
  /** context-persist-resilience 功能B:快照指定 messages 引用的 vfs 大结果原文(归档用,读 vfsStore.files) */
  function snapshotVfsResults(msgs: AgentMessage[]): Record<string, string> {
    const out: Record<string, string> = {}
    for (const p of extractVfsRefs(msgs)) {
      const f = vfsStore.files[p]
      if (f) out[p] = f.content
    }
    return out
  }
  /** context-persist-resilience 功能B:可达性 GC —— 扫当前 messages 引用,删 vfs 不可达的 large_results(trim 后 / 加载兜底触发;delete 经 Proxy 落盘) */
  function gcVfsOrphans(): void {
    const toRemove = gcVfsLargeResults(vfsStore.files, extractVfsRefs(messages))
    for (const k of toRemove) delete vfsStore.files[k]
  }

  function trimMemoryMessages(): void {
    const r = trimMemoryMessagesImpl(messages, maxMemoryRounds)
    if (!r.trimmed) return
    const { older, summary } = r
    // context-persist-resilience 功能B:trim 收口 —— 快照 older vfs → 归档通知(带 vfs 大结果)→ 删 → GC
    // 删之前发通知,保证 dropped/vfsResults 是完整原文(还没被删);vfsResults 让集成方归档完整(对话 + 大结果)
    emit({
      type: 'context_trimmed',
      dropped: older.map((o) => ({
        round: o.round,
        user: o.userMsg.content,
        assistant: o.assistantMsgs.map((m) => m.content),
        steps: o.assistantMsgs.flatMap((m) => m.steps ?? []),
      })),
      vfsResults: snapshotVfsResults(older.flatMap((o) => [o.userMsg, ...o.assistantMsgs])),
      summary: summary.content as string,
      reason: 'max_memory_rounds',
    })
    messages.splice(r.deleteFrom, r.deleteCount, summary)
    gcVfsOrphans() // 删 older 后扫剩余引用,回收不可达的 large_results(被剩余轮引用的留)
    // recall-and-trim-llm 方向2:trim 异步 LLM 增强 —— 同步模板占位已 splice+落盘,异步用 LLM 重摘要 older 替换(照 titleLlmInvoke fire-and-forget 模式)。
    // 配置门:enableLLMSummary 默认 true(conservative 显式 false 不触发);优雅降级(LLM 失败/无 invoke 保留模板);竞态守卫(summaryMsg 未被新一轮 trim/clearSession 移除才替换)
    if (enableTrimLlm && summaryLlmInvoke) {
      const summaryMsg = r.summary // 引用(splice 进 messages 的同一条,用于竞态守卫 indexOf)
      const { prevSeg } = r
      void (async () => {
        try {
          const llmDigest = await summaryLlmInvoke(indexSummarize(older, trimPreserveSet))
          // 竞态守卫:summaryMsg 仍在 messages(未被新一轮 trim 覆盖 / clearSession 移除)才替换;indexOf<0 放弃保留当前态
          const idx = messages.indexOf(summaryMsg)
          if (idx < 0) return
          messages[idx].content = composeTrimSummary(older, prevSeg, llmDigest)
          persistRuntime() // 落盘 LLM 增强版(异步,不阻塞主循环)
        } catch {
          /* LLM 摘要失败:保留模板占位,优雅降级(模板已 splice+落盘,无需额外处理) */
        }
      })()
    }
  }

  // 会话标题自动生成:首条 user 截取(deriveTitle 纯函数,从 llmResolver 导入);变化才 updateTitle,避免每轮重复写
  let lastTitle: string | undefined
  let titleLLMDone = false   // LLM 标题是否已生成(每会话一次,主旨更准;switchSession/onClear 重置)

  /** 持久化当前会话的 messages + todos(一轮结束 / send 后调用) */
  function persistRuntime(): void {
    if (!core.sessionId || !store) return
    // messages 元素是 Vue reactive proxy → IDB structured clone 会抛 DataCloneError(静默失败,messages 存不进);
    // 先 JSON 纯化为普通对象。localStorage 走 JSON.stringify 本就纯化,故 local 不受影响、indexed 受影响。
    const pureMessages = JSON.parse(JSON.stringify(messages)) as AgentMessage[]
    void store.save(agentId, core.sessionId, { messages: pureMessages })
    // todos 始终同步当前态(含空数组覆写):否则会话内 todos 由有变空(LLM 主动 write_todos([]))后,
    // storage 仍残留旧清单 → 刷新恢复出遗留的已完成 todos。代价:未用过 todos 的会话多写一条空记录(可忽略)。
    const todos = core.agent?.getState?.()?.todos ?? []
    void store.save(agentId, core.sessionId, { todos })
    // context-persist-resilience 功能A:持久化 mission/workingMemory(刷新/切会话后长任务目标 + 工作记忆不丢;非空才写省 IDB 写)
    if (useMission) {
      const m = missionMw.getMission()
      if (m) void store.save(agentId, core.sessionId, { mission: m } as Partial<SessionSnapshot>)
    }
    if (useWorkingMemory) {
      const wm = workingMemoryMw.getWorkingMemory()
      if (wm) void store.save(agentId, core.sessionId, { workingMemory: wm } as Partial<SessionSnapshot>)
    }
    // focus-auto-switch:持久化 focus(有值存值;clearFocus 后存 null 覆盖清除,防旧值残留被下次 restore)
    if (useFocus) {
      const fs = focusMw.getFocuses()
      void store.save(agentId, core.sessionId, { focus: fs.length ? fs : null } as Partial<SessionSnapshot>)
    }
    // automation 断点续跑:持久化 checkpoint 栈 + 累计 usage(刷新/崩溃后恢复,长任务可续跑;仅 automation 开启时写,省空间)
    if (useAutomation && checkpointMgr) {
      void store.save(agentId, core.sessionId, { checkpoints: checkpointMgr.exportStack() } as Partial<SessionSnapshot>)
      void store.save(agentId, core.sessionId, { usage } as Partial<SessionSnapshot>)
    }
    // 自动 title:首条 user 截取(变化才写,避免每轮重复;供历史列表显示,替代「会话 xxxxxx」)
    const title = deriveTitle(messages)
    if (title && title !== lastTitle) {
      lastTitle = title
      void store.updateTitle(agentId, core.sessionId, title)
    }
    // LLM 标题(异步,首轮 user+assistant 完成后一次;主旨更准,覆盖规则 title;失败/无 LLM 用规则兜底)
    const autoTitle = options.autoTitle !== false
    if (autoTitle && titleLlmInvoke && !titleLLMDone && messages.some((m) => m.role === 'user') && messages.some((m) => m.role === 'assistant')) {
      titleLLMDone = true
      void (async () => {
        const llmTitle = await titleLlmInvoke(messages)
        if (llmTitle) { await store.updateTitle(agentId, core.sessionId, llmTitle); await refreshSessions() }
      })()
    }
    if (options.debug) console.log('[page-agent-sdk][persist] save', core.sessionId, `${messages.length} msgs`)
  }

  // 初始化:解析会话 + 恢复 + 构造 agent(异步,不阻塞 buildCore 返回)
  core.initDone = (async (): Promise<void> => {
    await resolveAndLoad()
    // Skill 独立加载(与 storage 选项分离;即使 storage:false 也从 SkillStore 恢复)
    await loadUserSkills()
    // MCP:连所有 server(故障隔离),工具注入 allTools。
    // mcp-e2e 真测优化:握手(默认 15s 超时)曾 await 在 initDone → mount 被阻塞,server 不可达时
    // 对话框 15s 不渲染(切模式白屏感)。改为后台连接:agent 先建/对话框先渲染,握手完成后 push 工具 +
    // setTools rebind 迟到注入(下一轮 LLM 即可用;就绪前对话正常,只是暂无 MCP 工具)。
    // 竞态安全:若握手在下方 createAgent 前完成(constructLlmFromConfig 的 await 间隙),allTools 重建后
    // 直接随 tools: allTools 进 agent;若在之后走 setTools 注入 —— 两路幂等不重复。
    if (options.mcp?.length) {
      void (async () => {
        const results = await Promise.allSettled(options.mcp!.map((c) => connectMcp(c)))
        const closers = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value.close] : []))
        // release 先行:core 已释放 → 不回填 mcpClosers(release 已 splice 过,回填=泄漏),直接关
        if (mcpBackgroundReleased) {
          void Promise.allSettled(closers.map((c) => c()))
          return
        }
        core.mcpClosers = closers
        core.mcpServers = []
        // 复用外层 mcpTools 数组(buildCore 作用域声明):旧实现在此用 const 声明同名局部变量遮蔽外层,
        // 致 push 进局部数组、rebuildExtraTools 读外层空数组 → MCP 工具从未注入 agent(主流程审查 P0-3)
        /** C1(MCP 保留字保护):工具注入前查已注册非 mcp 来源工具名,冲突 → skip + warn */
        const reservedNames = new Set<string>()
        for (const t of allTools) {
          const source = toolSources.get(t.name)
          if (source && !source.startsWith('mcp:')) reservedNames.add(t.name)
        }
        results.forEach((r, i) => {
          const cfg = options.mcp![i]
          const label = cfg.name ?? cfg.url
          if (r.status === 'fulfilled') {
            core.mcpServers.push({ name: label, url: cfg.url, toolCount: r.value.tools.length })
            r.value.tools.forEach((t) => {
              if (reservedNames.has(t.name)) {
                console.warn(`[page-agent-sdk][mcp] 工具 "${t.name}" 与内置工具重名,已拒绝注入(安全保留字保护)`)
                return
              }
              toolSources.set(t.name, `mcp:${label}`)
              mcpTools.push(t)
            })
          } else {
            console.warn(`[page-agent-sdk][mcp] server ${label} 连接失败:`, r.reason)
          }
        })
        // 重建 allTools(纳入 mcpTools)+ 已建 agent 则 rebind 迟到注入(infoTick 刷新 inspect)
        if (mcpTools.length) {
          allTools = rebuildExtraTools()
          if (core.agent) core.agent.setTools(allTools)
          core.infoTick.value++
        }
        if (options.debug) console.log(`[page-agent-sdk][mcp] 注入 ${mcpTools.length} 个工具,${core.mcpServers.length} 个 server`)
      })()
    }
    // 主 LLM:实例直传;LLMConfig 经 constructLlmFromConfig(provider 分支,Anthropic 动态 import)构造实例注入
    const mainLlm = isChatModel(options.llm) ? options.llm : await constructLlmFromConfig(options.llm as LLMConfig)
    core.agent = createAgent({
      llm: mainLlm,
      systemPrompt: baseSystemPrompt,
      tools: allTools,
      middleware: middlewares,
      maxToolRounds: options.maxToolRounds,
      maxRetries: options.maxRetries,
      // P1-7(fix-hang-and-feedback):流停滞看门狗(默认 90s;0 关;chunk 间隔超时中断防 loading 永转)
      stallMs: options.streamStallMs ?? DEFAULT_STREAM_STALL_MS,
      maxParallelTools: options.maxParallelTools,
      // 模型能力透传(已在 buildCore 解析,声明优先 > 表 > 缺省):驱动 maxTokens 缺省与 offload 阈值
      contextWindow: modelCaps.contextWindow,
      maxOutputTokens: modelCaps.maxOutputTokens,
      // verify 自纠上限:装载 verify 时用 verify.maxAttempts(默认 2),否则 0(关闭自纠 = 现状)
      maxVerifyAttempts: useVerify ? verifyMaxAttempts : 0,
      // C4 单 invoke token 预算(opt-in,默认关):超限友好收口;与 automation 全局 tokenBudget 正交
      roundTokenBudget: options.roundTokenBudget ?? 0,
      // setLlm 后回调:重解析模型能力(contextWindow/maxOutputTokens 影响 offload 阈值/压缩)
      onLlmChange: (newLlm: BaseChatModel) => {
        // 仅更新实例引用;modelCaps 重算 + 最小窗口校验 + 集中回灌由 createChatSdk.setLlm 权威处理
        // (createChatSdk.setLlm 把 LLMConfig 构造成 BaseChatModel 实例后 contextWindow 声明丢失,
        //  onLlmChange 拿不到原 cfg.contextWindow → 在 setLlm 用原 llmOpt 重算更准)
        currentLlm = newLlm
      },
      // trace:createAgent finally 调 onTrace(spans, metrics) → emit('trace')(capabilities.tracing 开时注入,关时 undefined → createAgent 不采集,零开销)
      onTrace: useTracing ? (spans, metrics) => { try { emit({ type: 'trace', spans, metrics }) } catch { /* emit 抛错忽略 */ } } : undefined,
      debug: options.debug,
    })
    agentRef.current = core.agent
    // 注入 subagents 动态重配置钩子:controller.set/add/remove 后触发 createAgent rebind(重新 bindTools)
    if (subagentsMw && (subagentsMw as any).setReconfigureHook) {
      ;(subagentsMw as any).setReconfigureHook(() => {
        if (core.agent) core.agent.setTools(rebuildExtraTools())
      })
    }
  })()

  return core
}

export function _createChatSdk(options: ChatSdkOptions, mounter?: DialogMounter): ChatSdk {
  // ===== agent 实例 id(多共存隔离)=====
  const agentId: string = options.id ?? makeId()
  if (!options.id) {
    console.warn(
      `[page-agent-sdk] 未传 options.id,已生成随机 id "${agentId}"。刷新后持久化数据无法恢复,请传稳定 id。`,
    )
  }
  // 流式输出(默认 true 逐字);false 时 ChatDialog 走非流式 fetchResponse(等整段)
  const streaming = options.streaming ?? true
  const ui = options.ui ?? 'default'

  // ===== 获取或创建 core(shareContext 时同 id 复用)=====
  let core: AgentCore
  const existing = options.shareContext ? sharedCores.get(agentId) : undefined
  if (existing) {
    core = existing
  } else {
    core = buildCore(options, agentId)
    if (options.shareContext) sharedCores.set(agentId, core)
  }
  core.refCount++ // 本实例持有一引用

  // ===== 每实例:渲染 + 事件监听(不共享)=====
  // UI 模式:mounter 返回的 controller(持有 vueApp/mountEl,封装退出动画/show/hide);headless 模式恒 null
  let dialogController: DialogController | null = null

  // 对话框 UI 配置(归组写法;mount 渲染 ChatDialog 时读取)
  const dialogCfg = resolveDialogConfig(options)
  let flushHandler: (() => void) | null = null
  let visHandler: (() => void) | null = null

  async function mount(overrideContainer?: HTMLElement | string): Promise<void> {
    await core.initDone
    // 已挂载且隐藏中(抽屉模式 hide 后再 mount):直接 show,不重建,保留 agent/历史/生成进程
    if (dialogController) {
      dialogController.show()
      return
    }
    // mount 时传 container 覆盖 options.container(异步绑定:创建时可不传,mount 时才指定)
    // E6:局部变量覆盖,不回写 options(保持用户传入对象不变)
    const container = overrideContainer !== undefined ? overrideContainer : options.container

    // 装 flush/visibility 兜底 handler(headless 与 UI 两模式共用;防丢 debounce 内的待写)
    const installFlush = () => {
      if (!core.store) return
      flushHandler = () => {
        core.vfsStore.flush?.()
        void core.store!.flush()
      }
      visHandler = () => {
        if (document.visibilityState === 'hidden') void core.store!.flush()
      }
      if (typeof window !== 'undefined') window.addEventListener('pagehide', flushHandler)
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visHandler)
    }

    // headless:不渲染 UI(ui 显式 false,或 headless 入口未注入 mounter —— 后者无 mounter 但 ui 非 false → warn 降级提示)
    if (ui === false || !mounter) {
      if (ui !== false) {
        console.warn('[page-agent-sdk/headless] 未含 UI 组件,ui 渲染降级 headless;如需 UI 请 import page-agent-sdk 主包')
      }
      installFlush()
      return
    }

    const el =
      typeof container === 'string' ? document.querySelector(container) : container
    if (!el) throw new Error(`createChatSdk: 挂载点未找到(${container})`)

    // 委托 mounter 渲染 ChatDialog(主入口注入 mountChatDialog;props 透传 + 退出动画 + show/hide 均封装于 controller)
    dialogController = mounter({
      el: el as HTMLElement,
      core,
      dialogCfg,
      streaming,
      runSerial: core.runSerial,  // P1-11:core 级串行闸(UI 会话按钮与 API 层同链)
      hide,
      unmount,
      onDialogUnmounted: () => {
        dialogController = null
        core.release() // 引用计数--;shareContext 归零才真销毁(动画结束后才 release,保留期间 mount() 走 show() 分支)
      },
    })

    // 抽屉模式默认隐藏:mount 后不显示,需 sdk.show() 才出现(「点击按钮才出现聊天框」场景)
    if (dialogCfg.drawer === true && dialogCfg.drawerHidden === true) {
      dialogController.hide()
    }

    // 刷新/切页兜底 flush(防丢 debounce 内的待写;UI 模式与 headless 共用 installFlush)
    installFlush()
  }

  function unmount(): void {
    // 契约 C(fix-hang-and-feedback P1-3):先中止全部在途流 —— 幽灵流停烧 token/停写 bind;
    // 挂起的 approval/humanConfirm 随 signal 自动拒收口(原:永挂,shareContext 复用污染下次 mount)
    // P1-11:注册表为 core 级 —— shareContext 时中止共享 core 的全部在途流(含其他实例发起的;共享状态不允许孤儿流继续写)
    core.abortAllActive()
    // 收口挂起的冲突(按「保留外部」),防 unmount 后旧 conflict Promise 永久挂起泄漏
    core.resolveConflict('keep_external')
    if (flushHandler && typeof window !== 'undefined') window.removeEventListener('pagehide', flushHandler)
    if (visHandler && typeof document !== 'undefined') document.removeEventListener('visibilitychange', visHandler)
    flushHandler = null
    visHandler = null
    if (dialogController) {
      // UI 模式:委托 controller 跑退出动画 → transitionend/320ms 后 vueApp.unmount + onDialogUnmounted(回调内 null controller + core.release)
      // 不在此 null dialogController —— 由 onDialogUnmounted 回调 null(保留动画期间 mount() 走 show() 的现状)
      dialogController.unmount()
    } else {
      // headless 路径:无动画直接 release
      core.release() // 引用计数--;shareContext 归零才真销毁
    }
  }

  /** 抽屉模式隐藏:加 cs-hidden class(opacity:0 + visibility:hidden),不卸载 controller/不 release agent —— 保留聊天历史与正在进行的生成进程;再 mount() 直接 show 恢复 */
  function hide(): void {
    dialogController?.hide()
  }
  /** 抽屉模式显示:移除 cs-hidden class,恢复可见(配合 hide 使用;首次挂载用 mount) */
  function show(): void {
    dialogController?.show()
  }

  // P1-11(fix-data-integrity):串行闸 + 在途流注册表上移 core 级(buildCore 内)—— shareContext 多实例共享同一闸/注册表,
  // 双实例并发 send/switchSession 写同一 messages 的裸奔修复(H11);本层包装只做委托,不再持实例级私有闸。

  return {
    mount,
    unmount,
    hide,
    show,
    // P1-4(fix-hang-and-feedback):send/batch 接外部 signal(可中断);内部 controller 登记进注册表供 unmount/switchSession 收口
    send: (msg, opts) => core.runSerial(async () => {
      const { controller, untrack } = core.trackActive(opts?.signal)
      try { return await core.send(msg, { ...opts, signal: controller.signal }) } finally { untrack() }
    }),
    /** 批处理(automation):逐任务跑 agent,每任务前 checkpoint,任务间错误隔离(单任务失败不中断整批);详见 ChatSdk.batch */
    batch: (tasks, onProgress, signal) => core.runSerial(async () => {
      const { controller, untrack } = core.trackActive(signal)
      try { return await core.batch(tasks, onProgress, controller.signal) } finally { untrack() }
    }),
    switchSession: (...args: Parameters<typeof core.switchSession>) => core.runSerial(async () => {
      core.abortAllActive() // P1-10 同根:切会话先中止在途流(防旧流写进新会话);approval/conflict 随 signal/既有逻辑收口
      return core.switchSession(...args)
    }),
    /** 新建/清空会话(P1-8/9 修复:storage 关也完整重置内存态 + 收口冲突);同步,委托 core.resetSession */
    resetSession: () => core.resetSession(),
    /** 历史会话列表(响应式;switchSession/deleteSession/onClear/init 后自动 refresh;直接消费无需手动 listSessions/refresh/hook) */
    sessions: core.sessions,
    /** 列出当前 agent 的所有历史会话(主动查;一般用响应式 sessions 替代;storage 未开启 → []) */
    async listSessions(): Promise<import('../backends/storage').SessionMeta[]> {
      if (!core.store) return []
      return core.store.listSessions(agentId)
    },
    /** 删除指定历史会话;不可删除当前会话(删当前请先 switchSession 切走);storage 未开启 → no-op + warn */
    async deleteSession(sessionId: string): Promise<void> {
      if (!core.store) return
      if (sessionId === core.sessionId) { console.warn('[page-agent-sdk] deleteSession 忽略:不能删除当前会话,请先 switchSession 切到其他会话'); return }
      await core.store.deleteSession(agentId, sessionId)
      await core.refreshSessions()  // session-history Phase 6:删除后刷新历史列表(响应式 sessions 自动更新)
    },
    /** 当前会话 id(switchSession/onClear 后实时反映;供历史列表高亮当前项) */
    get sessionId(): string { return core.sessionId },
    // 契约 C + P1-11:在途流登记在 core.stream 内统一做(core 级注册表;UI fetchStream 同路径纳入),此处直接委托
    stream: (msgs, onEvent, signal) => core.stream(msgs, onEvent, signal),
    /** 显式持久化当前轮(headless sdk.stream 不自动落盘,需手动调;storage 未开启 → no-op) */
    afterRound: core.afterRound,
    /** 调试日志(供 DebugDrawer 等;switchSession/onClear 清空) */
    get debugLogs() { return core.agent!.debugLogs },
    /** Agent 信息刷新 tick(传 DebugDrawer 实时重拉 inspect) */
    infoTick: core.infoTick,
    inspect: core.getInfo,
    /** 读取最近一次上下文构成快照(每轮 wrapModelCall 覆盖;capabilities.contextInspector:false → undefined) */
    inspectContext: () => core.getInfo().context,
    getMission: core.getMission,
    /** 显式设置/覆盖 mission(传 {goal} 重设;传 {goal,criteria} 整体替换;传 {} 清空);capabilities 关时 warn 不抛 */
    setMission: core.setMission,
    /** 读取当前聚焦焦点(未聚焦 / capabilities.focus:false → undefined) */
    getFocus: core.getFocus,
    getFocuses: core.getFocuses,
    /** 设置聚焦焦点(替换全部;path 经 getSchemaAtPath 校验);非法返回 {ok:false,error} */
    setFocus: core.setFocus,
    /** 追加聚焦焦点(multi-focus 累积,去重 by path;校验同 setFocus) */
    addFocus: core.addFocus,
    /** 移除单个聚焦焦点(by path) */
    removeFocus: core.removeFocus,
    /** 清除全部聚焦焦点(退出精修模式,恢复全量可操作范围) */
    clearFocus: core.clearFocus,
    messages: core.messages,
    /** 回退到最近一次正常 checkpoint(整体还原对话历史 + 主数据 + vfs + todos);无可用 checkpoint 返回 false */
    restoreLastCheckpoint: () => core.checkpoint?.restore() ?? false,
    /** 列出可用 checkpoint(回退点) */
    listCheckpoints: () => core.checkpoint?.list() ?? [],
    /** 运行时订阅 SDK 事件(可多个监听器,返回取消函数);与构造时 onEvent 互补 */
    hook: (handler: SdkEventHandler) => {
      core.listeners.add(handler)
      return () => core.listeners.delete(handler)
    },
    /** 运行时替换主数据配置(如页面切换、schema 变更);立即生效,清空快照栈 */
    setData: (config: DataConfig) => {
      if (!core.dataOpsController) {
        console.warn('[page-agent-sdk] setData 忽略:dataOps 已关闭(capabilities.dataOps:false)')
        return
      }
      core.dataOpsController.set(config)
      core.infoTick.value++  // 触发 DebugDrawer 的 Agent 信息重新拉取(实时反映 data 变更)
    },
    /** 读取当前主数据配置;dataOps 关闭时返回 undefined */
    getData: () => core.liveData(),
    /** 运行时替换整个 skill 列表(同名覆盖);清缓存,下轮 system prompt 索引反映新 skill,下次 load_skill 取最新全文 */
    setSkills: (skills: SkillSpec[]) => {
      const ctrl = core.skillsController
      if (!ctrl) {
        console.warn('[page-agent-sdk] setSkills 忽略:skills 已关闭(capabilities.skills:false)')
        return
      }
      ctrl.set(skills)
      core.unloadSkillTools?.()  // 整个 skill 列表替换 → 旧 skill 附带工具卸载 + rebind(§5)
      core.infoTick.value++  // 触发 DebugDrawer 的 Agent 信息重新拉取(实时反映 skills 变更)
    },
    /** 添加用户创建的 skill(持久化,跨刷新恢复;同名覆盖);触发 controller 合并 + infoTick 刷新 */
    addSkill: (skill: SkillSpec) => {
      if (!core.skillsController) {
        console.warn('[page-agent-sdk] addSkill 忽略:skills 已关闭(capabilities.skills:false)')
        return
      }
      core.addSkill(skill)
      core.unloadSkillTools?.(skill.name)  // 同名覆盖时清旧工具,下次 load 注入新(§5)
    },
    /** 删除用户创建的 skill(仅删用户创建的,不删集成方 initialSkills);返回是否删除成功 */
    removeSkill: (name: string): boolean => {
      if (!core.skillsController) {
        console.warn('[page-agent-sdk] removeSkill 忽略:skills 已关闭(capabilities.skills:false)')
        return false
      }
      const ok = core.removeSkill(name)
      if (ok) core.unloadSkillTools?.(name)  // 卸载该 skill 附带工具(防泄漏;§5)
      return ok
    },
    /** 列出用户创建的 skill 名(仅用户创建的,不含集成方 initialSkills) */
    listUserSkills: (): string[] => core.listUserSkills(),
    /** 读取用户创建的 skill 详情(SkillPanel 编辑时调) */
    getUserSkill: (name: string) => core.getUserSkill(name),
    /** 清 skill 全文缓存(动态 skill 内容变化时主动失效);不传清全部,传 name 清指定 */
    invalidateSkillCache: (name?: string) => {
      const ctrl = core.skillsController
      if (!ctrl) {
        console.warn('[page-agent-sdk] invalidateSkillCache 忽略:skills 已关闭(capabilities.skills:false)')
        return
      }
      ctrl.invalidateCache(name)
      core.unloadSkillTools?.(name)  // 同步卸载该 skill 的附带工具(下次 load_skill 重新注入;§5)
    },
    /** 导出主数据 bind 的深拷贝(备份/迁移用);dataOps 关闭或无 data 返回 null */
    exportData: () => {
      const bind = core.liveData()?.bind
      return bind == null ? null : JSON.parse(JSON.stringify(bind))
    },
    /**
     * 导入数据整体替换主数据 bind(就地还原,保留 reactive 引用)。
     * 默认经 schema 校验,不合法返回 {ok:false,error};校验通过写入并发 data_change 事件,返回 {ok:true}。
     * opts.validate:false 跳过校验(集成方自行保证数据合法);opts.emit:false 不发 data_change 事件。
     */
    importData: (json, opts) => {
      const cfg = core.liveData()
      if (!cfg || !core.dataOpsController) return { ok: false, error: 'dataOps 未开启或无主数据' }
      const bind = cfg.bind
      if (bind == null || typeof bind !== 'object') return { ok: false, error: '主数据 bind 非对象,无法就地还原(集成方应用对象包裹)' }
      if (opts?.validate !== false) {
        const r = (cfg.schema as any).safeParse(json)
        if (!r.success) return { ok: false, error: 'schema 校验失败:' + (r.error?.message ?? '未知错误') }
      }
      restoreInPlace(bind as Record<string, unknown> | unknown[], json)
      core.dataOpsController?.markDataDirty?.()  // 整体替换 bind → 标脏(下次 checkpoint save 必 clone 新基线,防复用旧 bind clone)
      if (opts?.emit !== false) core.emit({ type: 'data_change', operation: 'set', value: bind })
      return { ok: true }
    },
    /** 往 vfs 异步注入/更新文件(集成方侧命令式入口;与 vfs_write 工具一致语义) */
    vfsWrite: (path, content) => {
      const text = typeof content === 'string' ? content : JSON.stringify(content)
      core.vfsStore.files[normalizeVfsPath(path)] = { content: text, updatedAt: Date.now() }
    },
    /** 只读读取 vfs 文件内容(不存在返 undefined)。与 vfs_read 工具一致语义,命令式入口(不经工具调用/无工具开销) */
    vfsRead: (path) => core.vfsStore.files[normalizeVfsPath(path)]?.content,
    createResource: (path: string, value?: unknown) => {
      const c = core.dataOpsController
      if (!c?.createResource) throw new Error('[page-agent-sdk] createResource 不可用:需配 data.resources + vfsStore(capabilities.vfs 默认开)')
      return c.createResource(path, value)
    },
    getResource: (pathOrHandle: string) => core.dataOpsController?.getResource?.(pathOrHandle),
    updateResource: (path: string, value: unknown) => {
      const c = core.dataOpsController
      if (!c?.updateResource) throw new Error('[page-agent-sdk] updateResource 不可用:需配 data.resources + vfsStore')
      c.updateResource(path, value)
    },
    deleteResource: (pathOrHandle: string) => core.dataOpsController?.deleteResource?.(pathOrHandle) ?? false,
    listResources: () => core.dataOpsController?.listResources?.() ?? [],
    releaseResources: (paths?: string[]) => {
      const c = core.dataOpsController
      if (!c?.listResources || !c.deleteResource) return
      if (paths && paths.length) for (const p of paths) c.deleteResource(p)
      else for (const r of c.listResources()) c.deleteResource(r.path)
    },
    /** 累计 token 用量(每轮 LLM 调用累加;prompt/completion/total_tokens)。无调用时为 0 */
    usage: core.usage,
    /** 乐观锁冲突挂起状态(响应式 ref;无冲突为 null,有冲突时 UI 据此渲染冲突对话框)。headless 集成方可 watch 此 ref 自建 UI */
    pendingConflict: core.pendingConflict,
    /** 冲突解决:用户点「保留外部」(keep_external)/「强制覆盖」(overwrite)/「回退」(restore) → 收口挂起的 conflict,被挂起的工具调用继续 */
    resolveConflict: (action: ConflictResolution['action']) => core.resolveConflict(action),
    setTools: (tools: StructuredToolInterface[]) => core.setTools(tools),
    addTool: (t: StructuredToolInterface) => core.addTool(t),
    removeTool: (name: string) => core.removeTool(name),
    setLlm: (llm: BaseChatModel | LLMConfig) => core.setLlm(llm),
    setMemory: (source: string | (() => string | Promise<string>)) => core.setMemory(source),
    refreshMemory: () => core.refreshMemory(),
    setSubagents: (configs: SubagentConfig[]) => core.setSubagents(configs),
    addSubagent: (config: SubagentConfig) => core.addSubagent(config),
    removeSubagent: (id: string) => core.removeSubagent(id),
    /** 运行中子 agent 列表(观察层;空=无在跑;capabilities.subagent 关闭 → 空数组) */
    getActiveSubagents: () => core.getActiveSubagents(),
    /** 子 agent 委派历史(观察层 getter;LRU≤20,最新在前;每次访问实时取最新) */
    get subagentHistory(): SubagentRunState[] { return core.subagentHistory },
  }
}
