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
import { reactive, ref, triggerRef, type Ref } from 'vue'
import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { DialogIcons } from '../components/icons'
import type { DialogMessages, DialogLocale } from '../components/messages'
import { createAgent, type DebugLog } from '../harness/createAgent'
import { asAgentError } from '../tools/toolError'
import { decorateModelUnavailable } from '../harness/errors'
import { isAbort } from '../harness/retry'
import { markWatchdogTools } from '../harness/toolWatchdog'
import { z, type ZodType } from 'zod'
import { getSchemaAtPath, schemaHasCodeField, inferWritablePaths, getSchemaTopKeys } from '../tools/schemaUtils'
import { systemPromptHelpers } from '../presets'
import { createTodosMiddleware } from '../harness/todos'
import { createMissionMiddleware } from '../harness/mission'
import { createIntentGuardMiddleware } from '../harness/intentGuard'
import { createResumeNoticeMiddleware } from '../harness/resumeNotice'
import { createFocusMiddleware } from '../harness/focus'
import { createWorkingMemoryMiddleware } from '../harness/workingMemory'
import { createSkillsMiddleware, type SkillSpec } from '../harness/skills'
import { createMemoryMiddleware } from '../harness/memory'
import { createPermissionsMiddleware, type PermissionRule } from '../harness/permissions'
import { createApprovalMiddleware } from '../harness/approval'
import { createHumanConfirmTool, createHumanConfirmMiddleware, HUMAN_CONFIRM_TOOL_NAME, type PlanConfirmationRecord } from '../harness/humanConfirm'
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
import { createComponentLock, resolveTargetComponents, createComponentWriteGuardMiddleware, codeFieldIndexPaths } from './componentLock'
import { createSubtreeWriteGuardMiddleware } from './subtreeGuard'
import { createDelegateNudgeMiddleware } from '../harness/delegateNudge'
import { createBaselineGuardMiddleware } from './baselineGuard'
import { buildDiagnosticsReport, stringifyDiagnosticsReport, type DiagnosticsDataSummary } from './diagnostics'
import { createHtmlSubagent } from './htmlSubagent'
import { isChatModel, resolveLlm, deriveTitle } from './llmResolver'
import { constructLlmFromConfig, constructOpenLlmSync } from '../llm/constructLlm'
import { createConflictManager, type ConflictPolicy } from './conflictManager'
import { resolveStorage, resolveDialogConfig } from './optionsResolver'
import { resolveCapabilities } from '../capabilities'
import { createSdkEvents } from './events'
import type { ContextManagerOptions } from '../composables/useContextManager'
import { resolveContextOptions, PRESET_PRESERVE, type ContextPreset } from './contextPreset'
import { composeMiddlewareStack } from './middlewareStack'
import { createVfs, createVfsMiddleware, VFS_TOOL_NAMES, normalize as normalizeVfsPath, type VfsStore } from '../backends/vfs'
import type { VfsFile, HarnessState, Mission, Focus } from '../harness/state'
import { createDataOps, type DataConfig, type DataOpsController, type ConflictResolution } from '../tools/dataOps'
import { hashValue, watchFieldsHash } from '../tools/jsonUtils'
import { fetchDocTools } from '../tools/fetchDoc'
import { domTools, domInspectSkill, domSearchTool, domInfoTool } from '../tools/domTool'
import { inspectTools } from '../tools/envTool'
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
import { DEFAULT_STREAM_STALL_MS, DEFAULT_STREAM_MAX_DURATION_MS } from '../utils/stallTimeout'
import { createSerialRunner } from '../utils/serialRunner'
import { normalizeUsage } from '../utils/contentParts'
import type { AgentMessage, StreamHandler, AgentInfo, SdkEvent, SdkEventHandler, TokenUsage, BatchResult, BatchProgress, AgentImage, ImagesConfig, ToolStepViewFn } from '../types'
import { lightenMessages, hydrateImages, makeThumb, MAX_IMAGES_PER_ROUND } from '../tools/imageInput'
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
  /** 显式声明是否多模态识图(image-input-vision;缺省按 model 名查表,再缺省 false 保守)。true = user 消息图片组装 content parts 直发;网关代理模型名不可辨时用 */
  vision?: boolean
  /** 思考深度锁定(default-deep-thinking):缺省 = 能力表 thinking:true 的模型自动 deep(质量优先,deepseek/claude-3.7+/glm-5.2 等);
   *  'simple' 显式剥思考参数省 token;'deep' 对网关不可辨模型名强制注入。仅 LLMConfig 构造路径生效(预构造实例钉死构造期) */
  thinkingMode?: 'simple' | 'deep'
  /** 透传 ChatOpenAI 的 modelKwargs:额外请求 body 参数(如 deepseek thinking: { thinking: { type: 'enabled' } }) */
  extraBody?: Record<string, any>
  /** 透传 ChatOpenAI configuration 的额外字段(如 headers/timeout/customFetch),与 baseUrl 合并 */
  extraConfig?: Record<string, any>
  /** Anthropic extended thinking(仅 provider:'anthropic';经 constructLlmFromConfig 注入 ChatAnthropic 构造参数)。
   *  通常不手配 —— 子 agent 用 `thinkingMode:'deep'` 由 applyThinkingMode 自动注入(含 budget_tokens 缺省);开启时 temperature 被 API 强制为 1 */
  thinking?: { type: 'enabled'; budget_tokens: number }
  /**
   * Anthropic prompt caching(仅 provider:'anthropic' 生效,openai 端点自动缓存不受此控制):
   * `true` = ephemeral 5m / `'1h'` = 长 TTL。langchain 顶层 cache_control 自动在「最后一个可缓存块」打
   * 断点并随对话增长推进 —— ReAct 多轮前缀(system+tools+历史)命中缓存,input 价格降至 ~1/10。
   * 前置条件:system 组装每轮恒定段在前(动态段会破缓存);网关需透传 cache_control(实测验证看
   * usage 的 cache_read_input_tokens)。
   */
  cacheControl?: boolean | '5m' | '1h'
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
  /** 虚拟工作区:初始文件 + 内存字节上限(默认 4MB,超限 LRU 淘汰最旧)+ 主栈工具暴露开关(main-surface-slim Phase 2) */
  vfs?: { initialFiles?: Record<string, string>; maxBytes?: number; poolBytes?: { largeResults?: number; drafts?: number; userFiles?: number } }
  /** 每个 数据槽最多保留快照数(默认 20,FIFO 丢最旧) */
  maxSnapshots?: number
  /** 乐观锁冲突裁决策略(默认 'ask'):ask=挂起 pendingConflict 等人工 resolveConflict;overwrite=agent 强制覆盖(宿主与 agent 争同一份数据且 agent 优先时用,冲突自动收口不挂起,无人值守场景防永挂);keep_external=自动保留外部修改(agent 收到提示重新 read)。自动裁决仍外发 conflict 事件(conflict.autoResolved 标记) */
  conflictPolicy?: ConflictPolicy
  /** 冲突监听字段白名单(3.32 起乐观锁唯一旋钮,autoLock 已废弃;任意深度字段名):**未声明/空 = 不开自动冲突检测**(写不自动校验)—— 宿主常在 SDK 写路径之外持续改写元数据(编辑器每秒回写 minHeight 类噪声),全字段自动检测必然高频误报;`['*']` = 全字段检测(旧 autoLock 行为);普通名单 = 仅这些字段的值变动触发冲突(位置不敏感:组件增删致 jsonPath 位移不误报)。与 conflictPolicy 正交:watch 决定「什么算冲突」,policy 决定「真冲突怎么裁决」 */
  conflictWatchFields?: string[]
  /** 数据操作审计回调:每次 set/edit/delete/restore 经此回调外发结构化事件(独立于 debug,无需 debug:true);集成方做合规审计/操作追溯 */
  onAudit?: (entry: { op: string; value?: unknown; detail?: string; timestamp: number }) => void
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
  /** 单次模型调用流总时长上限:防空转帧黑洞(keepalive 空转不断喂饱间隔看门狗,实测冻结 7min+ 无报错;超限 → StreamMaxDurationError,重委派/重发即自愈)。默认 600s;0 = 关闭 */
  streamMaxDurationMs?: number
  /**
   * per-tool 看门狗(flow-robustness P0#1):单工具执行超此 ms → 放弃等待,recoverable 错误结果回灌自纠
   * (防集成方工具永不 settle 拖死整轮:loading 永转 + stop 无效)。只对集成方注入工具生效(defineTool /
   * actions / skill 工具工厂 / rag retriever);内置/MCP/委派与 conflict ask 挂起是设计内等待,豁免。
   * 默认 120s;0 = 关闭。
   */
  toolTimeoutMs?: number
  /** token 预算上限(累计 total_tokens 超过 → 停止 agent + emit BUDGET_EXCEEDED;需 capabilities.automation:true) */
  tokenBudget?: number
  /**
   * 单次 invoke 的 token 预算上限(opt-in,默认关):本次 agent 调用累计 total_tokens 超限 → 中断收口
   * (observable emit ROUND_TOKEN_BUDGET_EXCEEDED + 友好收口文本,已完成部分保留)。与 automation 的全局
   * tokenBudget 正交:后者跨会话累计、需 automation 能力;本项单 invoke、无条件可用(防单轮死循环烧钱)。
   */
  roundTokenBudget?: number
  /**
   * 写驱动过期读失效(stale-read-invalidation,默认 true):单次 invoke 窗口内,本批成功写之后被击中
   * 路径的旧 read/query/search 结果替换为失效占位(防模型凭旧快照答状态/用错位索引)。false = 主/子一致关闭零变化。
   */
  staleReadInvalidation?: boolean
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
  /** 图片输入配置组(image-input-vision):images.upload 上传换 URL(集成方 OSS)/ images.describe 绑定识图转述(集成方识图子 agent / 自有 vision API,非多模态主模型时转述注入) */
  images?: ImagesConfig
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
    automation?: boolean     // 无人值守自动化(默认 false;预算闸 token/time + 错误恢复;automation-layer Phase 4,opt-in 最远)
    contextInspector?: boolean // 上下文检查 inspectContext(默认 true;读每轮消息分类 token 占比,纯计算零 LLM 成本)
    agentCompression?: boolean // 压缩 agent 自主决策(默认 false;opt-in,开 + summaryLlm 可用 → decide 驱动压缩,失败降级静态;requires summarization)
  }
  /** 大批量变更门禁已移除(4.1.0);残键静默忽略。迁移:approval.tools 手工圈选高危工具 */
  /** 子 agent 委派(spawn_agent/spawn_agents);默认开启,{ enabled: false } 关闭 */
  subagent?: { enabled?: boolean; allowedTools?: string[]; systemPrompt?: string; temperature?: number; maxTokens?: number; skills?: SkillSpec[]; llm?: LLMConfig | BaseChatModel; maxDepth?: number; maxParallel?: number; timeoutMs?: number; thinkingMode?: 'simple' | 'deep' }
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
   * tools 指定需确认的工具名(如 ['write']);confirm 自定义判定;timeoutMs 超时自动拒绝。
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
  /** 国际化:locale 切语言 + messages 键级覆盖文案(3.22+;UI 文案包 + 默认 systemPrompt/autoTitle 语言) */
  i18n?: I18nOptions
}

/** 对话框 UI 配置(归组写法,推荐) */
/**
 * 国际化配置(顶层 `i18n`;3.22 起,原 `dialog.locale`/`dialog.messages` 两键移入此处合并)。
 * 不放 dialog 组:locale 除 UI 文案包外还驱动默认 systemPrompt 语言与 autoTitle 标题语言(agent 层)。
 */
export interface I18nOptions {
  /** 语言:'zh-CN'(默认)/'en-US';切换内置文案包(聊天面 + Debug 抽屉 + Skill 面板 + 代码预览);
   *  formatTime(12h/24h)/autoTitle/默认 systemPrompt 跟随(en → 英文版身份 + "Respond in English" 锚,
   *  agent 回复与 UI 同语言;自定义 systemPrompt 不受影响,但自动追加的 reliableWriteRules 段切英文) */
  locale?: DialogLocale
  /** 文案键级覆盖(Partial<DialogMessages>;优先于 locale 包 —— 换语言与改个别文案一套机制,如 statusDone:'完成')。
   *  漏配键回退包值;完整键清单(~219 键)见 types 的 DialogMessages。
   *  部分渲染位支持行内 HTML 片段(值以 '<' 开头,文案白名单净化渲染,如 '<b style="color:#10b981">完成</b>'):
   *  标题/状态标签/思考中/空态问候/确认与冲突按钮;title/placeholder 属性位与拼接键(prefix/suffix)按纯文本 */
  messages?: Partial<DialogMessages>
}

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
  /** 图标局部覆盖:替换默认 emoji(🤖/🧬/🎯/📋/✏️/💡/⚠️/💬;头像两键 undefined=内置 SVG)。未传键用默认;空串=隐藏;值可为纯文本或 HTML 片段(以 '<' 开头,如内联 svg,DOMPurify 图标白名单净化) */
  icons?: Partial<DialogIcons>
  /** ChatDialog 区块显隐(chatdialog-component-split):键=false 关闭整块(含 slot);默认全开。键:header/focus/body/queued/approval/conflict/footer/debug/skill */
  sections?: Record<string, boolean>
  /** 顶部按钮宽度足够时展示文字标签(默认 true 自适应:头部内容区 ≥440px 展示「文字+图标」,更窄纯图标);false 恒纯图标。按钮文字走 i18n(newSession/history/more),图标走 dialog.icons 同名键 */
  headerLabels?: boolean
  /**
   * 工具步骤展示映射(纯展示层拦截器):把工具调用步骤行的原始工具名替换为自定义名称/内容。
   * 每次工具调用渲染时调,入参含 name/args/status/result(可按 args 动态映射,如 write 的 jsonPath →
   * 「修改第 N 个组件」);返回 { title?, detail? } 或 undefined(回退原始工具名)。映射抛错安全(回退原名)。
   * 不影响发给 LLM 的工具名/协议/校验;子 agent 步骤(children)同样应用。例:
   * ```ts
   * toolStepView: (s) => s.name === 'write' ? { title: '修改数据', detail: (s.args as any)?.jsonPath } : undefined
   * ```
   */
  toolStepView?: ToolStepViewFn
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
  /** 命令式发送一条消息(共享内部 messages,自动持久化);options.maxAutoRetries per-call 覆盖 automation 重试次数 */
  send(message: string, options?: SendOptions): Promise<string>
  /** 暴露底层流式接口(高级用法,自行管理历史时使用) */
  stream: (messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal) => Promise<string>
  /** 显式持久化当前轮(headless 用 sdk.stream 时需手动调:把 messages/vfs/todos 存 store;内置 useChat 经 onPersist 自动调。storage 未开启 → no-op) */
  afterRound(): void
  /** 清除代码资产复用缓存(重新生成前调,强制子 agent 重新生成而非复用未提交工作副本) */
  clearCodeReuse(): void
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
  /** 导出诊断报告 JSON 字符串(完整日志文件:debugLogs/messages/inspect/usage/conflict/数据摘要聚合;复制交维护者排查;zod schema/apiKey 不入报告) */
  exportDiagnostics(): string
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

/** send/stream options:mission 显式覆盖(优先于自动 capture)+ automation 重试次数覆盖 + signal 中断(fix-hang-and-feedback P1-4) */
interface SendOptions {
  mission?: Partial<Mission>
  maxAutoRetries?: number
  /** 中断信号(fix-hang-and-feedback P1-4):abort → 本次 send 中止(挂起的确认/冲突随 signal 自动收口)。headless 无停止按钮场景的退出通道 */
  signal?: AbortSignal
  /** 附带图片(image-input-vision;≤4 张,压缩后 AgentImage;需主模型多模态 vision,否则 send 拒绝并 emit 结构化错误 —— 不静默丢图) */
  images?: AgentImage[]
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
  /** conflictPolicy 自动裁决标记(3.29):非 ask 策略时该冲突未挂起、已按此 action 立即收口;仅随 conflict 事件外发供观测 */
  autoResolved?: 'overwrite' | 'keep_external'
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
  /** 连接失败的 MCP server(握手超时/网络拒连降级;getInfo 反射 + MCP_CONNECT_FAILED 事件,集成方可提示用户) */
  mcpFailed: { name: string; url: string; error: string }[]
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
  clearCodeReuse(): void
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
  /** 导出诊断报告 JSON 字符串(debugLogs/messages/inspect/usage/conflict/数据摘要聚合;DebugDrawer「复制诊断报告」与集成方排查共用) */
  exportDiagnostics(): string
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
  /** 调试入口门控(「更多」菜单调试项 + 日志 badge;true = options.debug) */
  debug: boolean
  /** 国际化配置(顶层 i18n 透传 → ChatDialog props;文案包 + formatTime/autoTitle 语言) */
  i18n?: I18nOptions
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
 * 非数据写工具返回 null。write 高层入口按 args 推断(del→delete,patch/patches→edit,否则 set;
 * dryRun 显式不落地 → 不发);eval_script 仅 transform 模式落地主数据(query 只读不发);
 * draft_commit 走 commitSetToBind、resource_update setByPath 同步 verbatim 真值进 bind,均为 bind 写。
 * (修前漏发:eval_script transform / draft_commit / resource_update 改了 bind 却无 data_change →
 * 非 reactive bind 宿主依赖 data_change 驱动重渲染〔page-demo :key=tick〕,数据变了页面不动
 * —— 2026-08-26 用户实测「打乱布局没变化」)
 */
function matchDataOp(name: string, args?: any): 'set' | 'edit' | 'delete' | 'restore' | null {
  if (name === 'restore_data') return 'restore'
  if (name === 'write') {
    if (args?.dryRun) return null // 探演不落地(优先级最高:del/patch 组合的 dryRun 同样不发)
    if (args?.del) return 'delete'
    if (args?.patch || args?.patches) return 'edit'
    return 'set'
  }
  if (name === 'eval_script') return args?.mode === 'transform' ? 'edit' : null
  if (name === 'draft_commit') return 'edit'
  if (name === 'resource_update') return 'edit'
  return null
}

/** 委派类工具(子 agent 执行入口):子 agent 的数据写发生在这些工具内部,主循环侧无独立工具调用可匹配 */
function isDelegationTool(name: string): boolean {
  return name === 'spawn_agent' || name === 'spawn_agents' || name.startsWith('use_')
}

/**
 * 内部事件中间件:把常用时机经 onEvent 外发给集成方。
 * - wrapToolCall:数据写工具(write 四意图 / restore_data / eval_script transform / draft_commit / resource_update)
 *   执行后发 data_change(operation/value);
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
      // team-audit P2#8:失败写不发 data_change —— dataOps 业务失败(SCHEMA_INVALID/PATH_DENIED/VERSION_CONFLICT/
      // freeze 拒绝)不 throw 而返回 `ERROR: {...}` 字符串且到达此处时 status 恒 'done',**必须判内容前缀**(单查 status 无效)。
      // 修前 args-only 推断照发 → 以事件驱动「标脏/自动存草稿/落库」的宿主为零变更触发保存(4.4.1 同族反向)。
      // operation 语义收敛为「数据已落地」;dryRun 不发(4.4.1)保持不变。
      const failed = typeof result.content === 'string' && result.content.startsWith('ERROR:')
      if (op && !failed) {
        emit({ type: 'data_change', operation: op, value: liveData()?.bind } as any)
      } else if (result.status === 'done' && !failed && isDelegationTool(ctx.name)) {
        // 委派工具内部可能改 data(读多写少,误报仅多一次无害刷新;operation 统一 edit;失败委派同口径不发)
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
        // reasoning 是 completion 子集,单独累计(有值才携带,不占位不加数;invokeUsage 预算判定不涉此字段)
        if (roundUsage.reasoning_tokens) usage.reasoning_tokens = (usage.reasoning_tokens ?? 0) + roundUsage.reasoning_tokens
        roundCounter++
        emit({ type: 'usage', round: roundCounter, usage: roundUsage, cumulative: { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens, total_tokens: usage.total_tokens, ...(usage.reasoning_tokens ? { reasoning_tokens: usage.reasoning_tokens } : {}) } })
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
  const conflictMgr = createConflictManager(() => emit, () => options.conflictPolicy ?? 'ask')
  // Agent 信息刷新 tick:setSkills/setData 等运行时变更后 ++,经 ChatDialog 传给 DebugDrawer 触发 agentInfo 重新拉取(实时反映动态 skill/data)
  const infoTick = ref(0)

  // ===== 持久化(默认关闭;赋值后端字符串或配置对象开启)=====
  const store = resolveStorage(options.storage)
  if (store) {
    if (options.debug) store.onEvent((e) => console.log('[page-agent-sdk][storage]', e))
    // team-audit P1#7:quota 拒写去静默 —— 原唯一消费者是 debug console.log,非 debug 集成方零可观察面
    // (长会话单会话超 maxBytesPerSession 静默拒写该 kind,刷新回退旧快照无感知;留痕进 debugLogs)
    store.onEvent((e) => {
      if (e.type === 'quota') {
        core.agent?.debugLogs?.value?.push({ timestamp: Date.now(), type: 'middleware', data: { stage: 'storage_quota', sessionBytes: e.sessionBytes, limit: e.limit === Infinity ? 'Infinity' : e.limit } })
      }
    })
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
          persistSave({ vfs: files })   // fire-and-forget 统一出口(吞错防 unhandled rejection;函数声明提升,定义在后可调用)
        } }
      : undefined,
    maxBytes: options.vfs?.maxBytes,
    poolBytes: options.vfs?.poolBytes,
  })

  const todosMw = createTodosMiddleware([], { maxPlanRevisions: options.maxPlanRevisions })
  const missionMw = createMissionMiddleware()
  // 问句意图守卫(instruction-adherence B):逐消息动态定性,防问句被误路由成操作(长对话实测事故驱动)。
  // 默认开无开关(3.30/3.31 配置面收敛方向);pin 段跨压缩存活;onHit 留痕去重(闭包引用 core,运行时已初始化)
  const intentGuardMw = createIntentGuardMiddleware((preview) => {
    core.agent?.debugLogs?.value?.push({ timestamp: Date.now(), type: 'middleware', data: { stage: 'intent_guard', preview } })
  })
  // 会话恢复提示(resume-notice):恢复非空历史(刷新/切会话)后的首轮注入「数据可能已变,先核实再断言已完成」。
  // 实测事故:生成完成未保存 → 刷新回退,但会话恢复的 todos 全 completed → 用户「重新生成」agent 直接答「完毕」。
  // markResumed 由 applySnapshot(唯一灌入历史入口)触发;一次性,afterAgent 清除。默认开无开关(同 intentGuard)
  const resumeNoticeMw = createResumeNoticeMiddleware(() => {
    core.agent?.debugLogs?.value?.push({ timestamp: Date.now(), type: 'middleware', data: { stage: 'resume_notice' } })
  })
  // 方案确认留痕(save-and-plan-gates 3c):RHC 带 options 的方案被用户点选 → 记录(时间戳+question 摘要+选择);
  // 供 ApprovalBar 上下文提示行(本会话已确认过方案)+ bulk-change-guard 豁免(三 change 公共接口)。
  // 随 SessionSnapshot 持久化(editor storage:'indexed' 跨刷新恢复会话,内存态刷新即丢会断豁免链);切/重置会话清除。
  // 口径:仅方案类确认记录 —— 单组件删除确认(true/false)不写入(评审 2-5:防低敏感确认烧掉批量门禁豁免)
  let lastPlanConfirmation: PlanConfirmationRecord | undefined
  // flow-robustness P1#3:approval/humanConfirm 中间件本体默认 30s 无响应自动拒(全路径统一,替代原 send/batch
  // 事件级 approvalWatch)。响应方接管机制:事件携带 hold(),内置 UI(useChat)收到即调 → 计时取消、无限等人;
  // 无人调 hold(headless 任意入口 / send·batch / streaming:false 裸 invoke —— approval_request 不外发,
  // 这些路径集成方无法应答)→ 30s 自动拒 + observable。approval.timeoutMs 显式覆盖:正值生效;
  // Infinity/负数 = 关(stream onEvent 自建确认通道的集成方留口)。
  // emit 延迟求值(同 conflictMgr 模式:emit 在下方定义,中间件运行时才调)。
  const rawApprovalMs = options.approval?.timeoutMs
  const approvalNoRespMs =
    rawApprovalMs !== undefined && Number.isFinite(rawApprovalMs) && rawApprovalMs > 0 ? rawApprovalMs
    : rawApprovalMs !== undefined && (!Number.isFinite(rawApprovalMs) || rawApprovalMs < 0) ? 0
    : 30_000
  const onApprovalAutoReject = (info: { toolName: string; waitedMs: number }): void => {
    emit({ type: 'error', message: `确认请求(${info.toolName})${Math.round(info.waitedMs / 1000)}s 无响应已自动拒绝 —— 当前路径无 UI 响应方;可传 approval.timeoutMs 调整(Infinity = 无限等)`, severity: 'observable', code: 'APPROVAL_AUTO_REJECTED', context: info } as any)
  }
  const humanConfirmMw = createHumanConfirmMiddleware((record) => {
    lastPlanConfirmation = record
    persistSave({ planConfirmation: record })
    core.agent?.debugLogs?.value?.push({ timestamp: Date.now(), type: 'middleware', data: { stage: 'plan_confirmation', summary: record.summary, choice: record.choice } })
  }, { timeoutMs: approvalNoRespMs, onAutoReject: onApprovalAutoReject })
  // 上下文聚焦(focus-context):指定组件精修,目标/视野/范围三层收敛。getSchema 延迟引用 liveData(适配 setData 运行时替换,同 checkpointMgr.getData 模式)
  // 焦点变更统一 emit focus_change(所有入口:API/agent 工具/dialog chip/reset;闭包引用 emit,运行时已初始化)
  const focusMw = createFocusMiddleware({ getSchema: () => liveData()?.schema, getBind: () => liveData()?.bind, onChange: (focuses) => emit({ type: 'focus_change', focuses }) })
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
  const useAutomation = caps.automation  // 无人值守自动化(预算闸+错误恢复;opt-in,最远)

  // 最终 systemPrompt 的 base 段(不含数据段):用户 systemPrompt(或默认)+ 可选 reliableWriteRules 追加,统一由 buildSystemPrompt 处理
  // 数据段移交 dataHint 中间件每轮从 liveData() 动态重算(修 setData 不同步 Bug);inspect 与 createAgent 共用 baseSystemPrompt 保持一致
  // dialog-i18n Phase 2:locale='en-US' 时默认 prompt/追加规则段用英文版(与 UI 同语言;自定义 systemPrompt 不受影响)
  const baseSystemPromptRaw = buildSystemPrompt({ ...options, locale: options.i18n?.locale })
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
        conflictWatchFields: options.conflictWatchFields,
        // write-conflict C 形态装配条件:>1 且 conflictWatchFields 武装 → dataOps 闭包级写互锁
        maxParallelTools: options.maxParallelTools,
        vfsStore: (useDraft || !!finalDataConfig?.resources?.length) ? vfsStore : undefined,  // draft 工具 / 受保护资源(opt-in):vfsStore 提供 → createDataOps 装 draft_write/draft_commit + resource_*
        // code-as-data-asset:htmlSubagent writablePaths → pgIdPaths(schema extend 加 __pgId:safeParse 不剥离 + afterWrite 补 __pgId)+ largeTextPaths(主 scope read code 摘要)
        ...(codeAssetPgIdPaths.length ? { pgIdPaths: codeAssetPgIdPaths } : {}),
        ...(codeAssetLargeTextPaths.length ? { largeTextPaths: codeAssetLargeTextPaths } : {}),
      })
    : []
  const dataOpsFiltered = useDataOps ? dataOpsTools : []
  // 数据操作控制器(运行时替换配置;dataOps 关闭时为 null)
  const dataOpsController = useDataOps && finalDataConfig
    ? (dataOpsTools as StructuredToolInterface[] & { controller?: DataOpsController }).controller ?? null
    : null
  // 受保护资源跨压缩 pin(augmentPrompt 每轮注入「受保护资源」段;资源清单天然跨压缩,无需持久化)
  const resourcesPinMw = (useDataOps && finalDataConfig?.resources?.length && dataOpsController?.getResourcesSnapshot)
    ? createResourcesPinMiddleware({
        getResourcesSnapshot: () => dataOpsController?.getResourcesSnapshot?.() ?? [],
      })
    : undefined
  /** 当前主数据配置(反映运行时替换;供 inspect/verify 等读最新状态) */
  const liveData = (): DataConfig | undefined => dataOpsController?.get() ?? finalDataConfig
  // baseline-guard(editor_fangzhou「自冲突」根因修):非 dataOps 内置工具(集成方 defineTool 结构性工具/
  // actions/checkpoint restore/skill exec/委派等)在 SDK 写路径之外改 bind → 乐观锁基线不刷新 →
  // agent 下一次 write(autoLock 拿基线当 effHash)与实时 hash 不匹配,触发「自己跟自己冲突」。
  // wrapToolCall 调用前后 hash 比对,变化则全 scope 基线一次刷新;dataOps 内置工具自管基线跳过。
  const dataOpsManagedNames = new Set(dataOpsTools.map((t) => t.name))
  // 守卫 hash 与 dataOps 基线口径同源:白名单模式仅监听字段参与前后比对;['*']/未声明走全量
  const gw = options.conflictWatchFields ?? []
  const guardWatchKeys: ReadonlySet<string> | undefined = !gw.includes('*') && gw.length ? new Set(gw) : undefined
  const guardHash = (v: unknown): string => guardWatchKeys ? watchFieldsHash(v, guardWatchKeys) : hashValue(v)
  const baselineGuardMw = dataOpsController
    ? createBaselineGuardMiddleware({
        getBind: () => liveData()?.bind,
        recomputeAll: () => dataOpsController!.recomputeAllBaselines?.(),
        hasBaselines: () => dataOpsController!.hasBaselines?.() ?? false,
        isManaged: (n) => dataOpsManagedNames.has(n),
        hash: guardHash,
        log: (_type, data) => {
          const logs = core.agent?.debugLogs
          if (!logs) return
          logs.value.push({ timestamp: Date.now(), type: 'middleware', data: { stage: 'baseline_guard', ...(data as Record<string, unknown>) } })
          triggerRef(logs)
        },
      })
    : undefined
  // 工具来源标注(builtin / mcp:<name> / user),供 getInfo 展示(DebugDrawer 区分内置/MCP/用户工具)
  const toolSources = new Map<string, string>()
  // skills 关 + domInspect 开 → dom_search/dom_info 无法经 skill 注入,降级直接进工具池(功能可达优先,牺牲常驻 schema)
  const domToolsForPool = caps.domInspect && !caps.skills ? [...domTools, domSearchTool, domInfoTool] : domTools
  const builtinTools = selectBuiltinTools(caps, dataOpsFiltered, fetchDocTools, domToolsForPool, inspectTools)
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
      focusMw.setFocus({ path, ...(label ? { label } : {}) }, 'agent')
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
      focusMw.clearFocus('agent')
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
      focusMw.addFocus({ path, ...(label ? { label } : {}) }, 'agent')
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
      focusMw.removeFocus(path, 'agent')
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
  const focusTools: StructuredToolInterface[] = useFocus ? [setFocusTool, clearFocusTool, addFocusTool, removeFocusTool] : []
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
    // per-tool 看门狗标记(flow-robustness P0#1):集成方注入面(user 原生 langchain 工具 / actions.run
    // 包装 / skill 工具工厂产物)无自有闸,统一打标 coreExecTool race toolTimeoutMs。defineTool 产物已在
    // 创建时打标(此处幂等);builtin/mcp(自有闸)/humanConfirm(设计内等人工)不打 —— 重名覆盖时幸存
    // 对象随自身标记走(user 实现覆盖 builtin → 看 user 实现,语义正确)
    markWatchdogTools(userTools)
    markWatchdogTools(actionTools)
    markWatchdogTools(loadedSkillTools)
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
  // timeoutMs 装配层归一:undefined → approvalNoRespMs(无 UI 默认 30s / UI 无限等);显式值(含 Infinity=0 无限等)原样透传
  const approvalMw = options.approval && (options.approval.tools !== undefined || !!options.approval.confirm)
    ? createApprovalMiddleware({ ...options.approval, timeoutMs: options.approval.timeoutMs ?? approvalNoRespMs, onAutoReject: onApprovalAutoReject })
    : undefined
  const childGuards: Middleware[] = [...(permissionsMw ? [permissionsMw] : []), ...(approvalMw ? [approvalMw] : []), ...(baselineGuardMw ? [baselineGuardMw] : [])]  // 序同主栈:permissions 外层 → approval 内层;baseline-guard 子栈自定义工具改 bind 同样刷基线
  const subagentMw =
    !useSubagent || subOpts?.enabled === false
      ? undefined
      : createSubagentMiddleware({
          llm: subOpts?.llm ?? options.llm,
          allTools: () => core.agent?.allTools ?? allTools, // P0-1(getter→合并池):含中间件工具(vfs 等);原指向局部 rebuildExtraTools 池致能力包 allowedTools 恒落空
          allowedTools: subAllowed.length ? subAllowed : undefined,
          // stale-read-invalidation 透传(主/子一致;未设 = 子 createAgent 默认 true)
          ...(options.staleReadInvalidation !== undefined ? { staleReadInvalidation: options.staleReadInvalidation } : {}),
          // 子 agent 独立配置(自定义身份/温度/上下文上限/技能)
          systemPrompt: subOpts?.systemPrompt,
          temperature: subOpts?.temperature,
          maxTokens: subOpts?.maxTokens,
          skills: subOpts?.skills,
          maxDepth: subOpts?.maxDepth,
          maxParallel: subOpts?.maxParallel,
          // 思考深度锁定(subagent-thinking-mode-lock):顶层 subagent.thinkingMode 全局缺省,spawn 路径同样生效
          thinkingMode: subOpts?.thinkingMode,
          debug: options.debug,
          // focus-auto-switch:子 agent 继承主焦点;P1#5 读**生效快照**(invoke-freeze 口径)——
          // 宿主 mid-run 焦点不穿透委派(主/子写面一致);agent 主动变更经 mutate 同步快照,继承同样感知
          getFocuses: () => focusMw.getActiveFocuses(),
          getSchema: () => liveData()?.schema ?? null,
          tracker: subagentTracker,
          // fix-authorization-surface:子栈把关中间件(P1-16)+ 子 offload 桥接主 vfs 池(P1-15)
          guardMiddleware: childGuards.length ? childGuards : undefined,
          getVfsFiles: useVfs ? () => vfsStore.files : undefined,
          // fix-main-sub-isolation:per-scope 乐观锁基线(P1-13,子 read/write 不污染主基线)+ 子 usage 回传(P1-17a)+ 子执行超时(P1-17b,opt-in)
          enterDataScope: dataOpsController?.enterScope ? (id) => dataOpsController.enterScope!(id) : undefined,
          exitDataScope: dataOpsController?.exitScope ? (id) => dataOpsController.exitScope!(id) : undefined,
          onUsage: (u) => { usage.prompt_tokens = (usage.prompt_tokens ?? 0) + (u.prompt_tokens ?? 0); usage.completion_tokens = (usage.completion_tokens ?? 0) + (u.completion_tokens ?? 0); usage.total_tokens = (usage.total_tokens ?? 0) + (u.total_tokens ?? 0); if (u.reasoning_tokens) usage.reasoning_tokens = (usage.reasoning_tokens ?? 0) + u.reasoning_tokens },
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
        // 主写恒守卫(m4-real-llm):已存在代码组件的 code 字段恒拒 —— flash 实测 3 次无视提示词禁令直写
        // (含读后写覆盖人工 keep_external 值),机制化回灌 CUSTOM_CODE_DELEGATION 引导委派
        getCodeFieldPaths: () => codeFieldIndexPaths(liveData()?.bind, codeAssetConfigs.map((s) => ({ writablePaths: s._codeAsset.writablePaths, codeField: s._codeAsset.codeField }))),
      })
    : undefined
  // subtree-summary Phase 1:read-before-write 守卫(dataOps 开即装;凭占位印象写 → 拦下引导窄读,非禁止)
  const subtreeWriteGuardMw = dataOpsController?.getSummarizedPaths && dataOpsController.clearSummarizedPaths
    ? createSubtreeWriteGuardMiddleware({ getSummarizedPaths: () => dataOpsController.getSummarizedPaths!(), clearSummarizedPaths: () => dataOpsController.clearSummarizedPaths!() })
    : undefined
  const subagentsMw = useSubagent && subagentsForAssemble !== undefined
    ? createSubagentsMiddleware(subagentsForAssemble, { llm: options.llm, thinkingModeDefault: options.subagent?.thinkingMode, staleReadInvalidation: options.staleReadInvalidation, allTools: () => core.agent?.allTools ?? allTools, debug: options.debug, getFocuses: () => focusMw.getActiveFocuses(), getSchema: () => liveData()?.schema ?? null, getBind: () => liveData()?.bind, tracker: subagentTracker, guardMiddleware: childGuards.length ? childGuards : undefined, getVfsFiles: useVfs ? () => vfsStore.files : undefined, enterDataScope: dataOpsController?.enterScope ? (id) => dataOpsController.enterScope!(id) : undefined, exitDataScope: dataOpsController?.exitScope ? (id) => dataOpsController.exitScope!(id) : undefined, onUsage: (u) => { usage.prompt_tokens = (usage.prompt_tokens ?? 0) + (u.prompt_tokens ?? 0); usage.completion_tokens = (usage.completion_tokens ?? 0) + (u.completion_tokens ?? 0); usage.total_tokens = (usage.total_tokens ?? 0) + (u.total_tokens ?? 0); if (u.reasoning_tokens) usage.reasoning_tokens = (usage.reasoning_tokens ?? 0) + u.reasoning_tokens }, timeoutMs: options.subagent?.timeoutMs,
      ...(componentLock ? { componentLock, resolveComponents: (args: { components?: string[]; task: string }) => resolveTargetComponents(args, collectComponentNames(liveData()?.bind, codeAssetPgIdPaths)) } : {}) })
    : undefined

  // bulk-change-guard 已于 4.1.0 移除(config-surface-pruning round2;capabilities.bulkGuard/bulkGuard 残键静默忽略)
  const subagentsController = subagentsMw ? (subagentsMw as any).controller as import('../harness/subagent').SubagentsController : null

  /** 思考深度锁定反射(subagent-thinking-mode-lock):thinkingMode 解析(显式 > 顶层缺省)+ 实际生效状态。
   *  getInfo(AgentInfo.subagents)与 inspect().subagent.subagents 同源共用。
   *  'applied' = LLMConfig 构造路径可锁定;'inherited' = 未设继承现状;'instance-noop' = 预构造实例物理不可改 */
  const reflectSubagentThinking = (s: SubagentConfig) => {
    const tm = s.thinkingMode ?? options.subagent?.thinkingMode
    const thinkingApplied = tm ? (isChatModel(s.llm ?? options.llm) ? 'instance-noop' : 'applied') : 'inherited'
    return { ...s, ...(tm ? { thinkingMode: tm } : {}), thinkingApplied }
  }

  // 对抗子 agent 的只读工具(白名单筛选,让其能实证读回数据检查而非臆测;dataOps 关闭则不含数据工具)
  const READONLY_FOR_ADVERSARIAL = ['describe_data', 'read', 'fetch_document']
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
      subagents: effectiveSubagents?.map(reflectSubagentThinking),
    },
    useDataOps && !!finalDataConfig,
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

  // preferences(跨会话用户偏好记忆)已随 4.1.0 移除(config-surface-pruning round2);迁移:自行存储偏好经 systemPrompt/augmentSystem 注入

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
    intentGuardMw, // mission 后:问句意图守卫 pin 段(逐消息定性「先答勿做」;instruction-adherence B,默认开)
    resumeNoticeMw, // 会话恢复提示:恢复非空历史后首轮注入「数据可能已变,先核实」(applySnapshot 触发,一次性)
    ...(usePlanning ? [todosMw] : []),
    ...(useSkills
      ? [
          // domInspect 开 → 并入 DOM 检视 skill(dom_search/dom_info 按需 load_skill 注入,不占常驻 tool schema;
          // 集成方同名 skill 显式声明优先,不重复)
          skillsMw = createSkillsMiddleware([
            ...(caps.domInspect && !(options.skills || []).some((s) => s.name === domInspectSkill.name) ? [domInspectSkill] : []),
            ...(options.skills || []),
          ], {
            // vfs 启用时注入 readVfs,让 skill 文档源(vfs://path)能读取 vfs 文件
            readVfs: useVfs ? (p: string) => vfsStore.files[p]?.content : undefined,
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
    ...(useHumanConfirm ? [humanConfirmMw] : []),
    // 人工确认(被动侧):白名单工具调用前确认(wrapToolCall 洋葱,此处更内层;实例同 childGuards 注入子栈,fix-authorization-surface)
    ...(approvalMw ? [approvalMw] : []),
    // baseline-guard(自冲突根因修):非 dataOps 工具改 bind(自定义工具/actions/委派落地等)→ 基线一次刷新。
    // 位置须在 subagentMw/subagentsMw 之外(数组靠前 = 洋葱外层),才能包住 spawn/use_<id> 委派调用全程
    ...(baselineGuardMw ? [baselineGuardMw] : []),
    ...(verifyMw ? [verifyMw] : []), // permissions 之后(beforeReturn 正序,verify 在用户自定义中间件前)
    ...(subagentMw ? [subagentMw] : []),
    ...(subagentsMw ? [subagentsMw] : []),
    // parallel-subagent-delegation Q3b:主 agent 写检查(委派在途组件锁前缀拒写;只装主栈,子 agent 走自己的栈)
    ...(componentWriteGuardMw ? [componentWriteGuardMw] : []),
    // subtree-summary Phase 1:read-before-write 守卫(写路径落入摘要占位子树 × 本轮无窄读 → 回灌窄读指令;
    // dataOps 开即装,非 codeAsset 门控 —— 纯 JSON 集成同样受益;dataOps controller 出占位路径集)
    ...(subtreeWriteGuardMw ? [subtreeWriteGuardMw] : []),
    // section-orchestrator 0b:欠委派 nudge(invoke 内累计写触达超阈 × 零委派 → 写结果尾附一次性 advisory;
    // dataOps + subagent 都开才装 —— 无委派能力的集成提示无意义)
    ...(dataOpsController && useSubagent
      ? [createDelegateNudgeMiddleware({ getBind: () => liveData()?.bind })]
      : []),
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

  // flow-robustness P1#3:原 P1-1 的 makeApprovalWatch(send/batch 事件级 30s 自动拒)已移除 ——
  // approval/humanConfirm 中间件本体默认 30s 无响应自动拒(无 UI 路径,装配层注入,见 buildCore),
  // 全入口(stream/send/batch)统一口径且不再双发 observable。
  /**
   * send/batch 路径的流事件观察器:observable error 等过程事件转发 emit。
   * 3.11 真 LLM 复测发现:send 路径不转发流内事件,agent stream 内的 observable error
   * (GARBLED_TOOL_CALL_EXHAUSTED / ROUND_TOKEN_BUDGET_EXCEEDED / STREAM_STALLED 等)到不了
   * options.onEvent —— headless 集成方对「任务可能未完成」完全无感知。
   */
  function makeStreamWatch(_signal?: AbortSignal): (e: import('../types').StreamEvent) => void {
    return (e) => {
      // F1(send/batch 全量事件外发):headless 用 send() 的集成方经 sdk.hook 听 tool_call/reasoning/text
      // 等过程(approval_request 仍不外发 —— 无 UI 响应方路径由中间件 30s 自动拒收口)。
      if ((e as any).type !== 'approval_request') emit(e as any)
    }
  }

  // session-history Phase 6:会话历史响应式状态下沉(集成方直接消费 sdk.sessions,无需手动 listSessions/refresh/hook)
  const sessionsRef: Ref<SessionMeta[]> = ref([])
  /** 刷新历史会话列表到 sessionsRef(switchSession/deleteSession/onClear/init 后调;storage 未开启 no-op) */
  async function refreshSessions(): Promise<void> {
    if (!store) return
    // 内部吞错:多处 void refreshSessions() fire-and-forget,release 后迟到调用(store 已 dispose)会变 unhandled rejection
    try {
      sessionsRef.value = (await store.listSessions(agentId)).sort((a, b) => b.lastAccessed - a.lastAccessed)
    } catch (e) {
      if (options.debug) console.warn('[page-agent-sdk][persist] refreshSessions 失败(已吞):', e)
    }
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
    // rv-core F6:listener 具名 + untrack 时移除 —— 原 {once:true} 永不清理,长寿命外部 signal 复用时单调累积
    const relay = () => controller.abort()
    if (outer) {
      if (outer.aborted) controller.abort()
      else outer.addEventListener('abort', relay, { once: true })
    }
    activeControllers.add(controller)
    return {
      controller,
      untrack: () => {
        activeControllers.delete(controller)
        outer?.removeEventListener('abort', relay)
      },
    }
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
    mcpFailed: [],
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
      // vfs 先于 messages 恢复:image-input-vision 的轻形态重水化从 vfs 读原图,顺序反了会读空
      if (snap.vfs && vfsStore.hydrate) vfsStore.hydrate(snap.vfs)
      if (snap.messages?.length) {
        // image-input-vision:轻形态恢复 —— 从 vfs 重水化原图 dataUri(直发/重发需要;LRU 已淘汰的图保留轻形态,UI 缩略图降级 + 再发图时诚实报错)
        messages.push(...hydrateImages(snap.messages, (ref) => (ref ? core.vfsStore?.files?.[ref]?.content : undefined) || undefined))
        // 恢复提示(resume-notice):灌入非空历史 → 标记首轮注入「数据可能已变,先核实再断言已完成」。
        // 覆盖 init autoResume / session.id / switchSession 三路径(applySnapshot 是唯一灌历史入口)
        resumeNoticeMw.markResumed()
      }
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
      // 方案确认留痕恢复(save-and-plan-gates 3c):刷新/切会话回原会话后豁免链不断
      // (内存态刷新即丢 → ApprovalBar 提示行消失 + bulk 豁免失效;随 snapshot 存取)
      if (snap.planConfirmation) lastPlanConfirmation = snap.planConfirmation
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

    /** 清除代码资产复用缓存(vfs 命名空间 holder):重新生成前调,强制子 agent 重新生成而非复用未提交工作副本 */
    clearCodeReuse(): void {
      const s = vfsStore as unknown as { __pgPendingRetry?: Set<string>; __pgLastCheckout?: Map<string, string> }
      s.__pgPendingRetry?.clear()
      s.__pgLastCheckout?.clear()
    },

    async send(message: string, options?: SendOptions): Promise<string> {
      await core.initDone
      // 存活守卫(rv-core F6):runSerial 排队的 send 在等待期间双实例 unmount(release → refCount 0)后
      // 照常执行会烧 LLM + 写已释放 core;refCount≤0 直接拒(排队等待白等比烧 token 好)
      if (core.refCount <= 0) throw new Error('page-agent-sdk: agent 已释放(unmount),拒绝排队中的 send')
      // 容错:partial 调用(headless 实测 sdk.send(msg) 不传 options)→ 默认空对象,避免 options.mission 误访问 undefined
      options = options ?? {}
      // mission 显式覆盖(send({mission}) 优先于自动 capture)
      if (options?.mission && useMission) missionMw.setMission(options.mission)
      let msg = message
      // image-input-vision 三分支收口(D6 诚实语义):
      // ① 多模态主模型(vision)→ content parts 直发;② 非 vision + 配 images.describe → 集成方识图转述注入(图片不直发);
      // ③ 非 vision + 未配 describe → send 拒绝 + emit(recoverable;不静默丢图 —— 丢图后 agent 凭空回答比报错恶劣)
      const images = (options.images ?? []).filter((im) => im && (im.dataUri || im.vfsRef || im.url))
      if (images.length > MAX_IMAGES_PER_ROUND) {
        throw new Error(`[page-agent-sdk] 单轮最多 ${MAX_IMAGES_PER_ROUND} 张图片(收到 ${images.length})`)
      }
      if (images.length) {
        await stowImages(images) // url 型跳过;原图入 vfs + thumb(轻形态持久化引用锚;失败留痕不阻塞)
        await describeIfNeeded(images, msg)
      }
      if (images.length && !modelCaps.vision && !images.every((im) => im.description)) {
        const em = '当前主模型不支持图片输入(modelCaps.vision=false)。请换多模态模型(gpt-4o/claude/qwen-vl)或 LLMConfig 声明 vision:true;或配置 images.describe 绑定识图转述(集成方识图子 agent / 自有 vision API)'
        emit({ type: 'error', message: em, severity: 'recoverable', code: 'IMAGE_UNSUPPORTED_MODEL' } as any)
        throw new Error(`[page-agent-sdk] ${em}`)
      }
      // automation 无人值守错误恢复:致命错误(invoke 抛错)→ restore_last_checkpoint 回到本轮前 + 重试(限 maxAutoRetries 次防循环)。
      // 适合无人值守批量/长任务:单点模型/工具致命错误不永久中断,自动回退重试;确定性错误重试仍耗尽 → fatal(emit + throw)。
      // checkpoint 在 beforeModel save(时点在 push user 后)→ restore 后 messages 已含本轮 user,故用 pushed 标记避免重复 push。
      // flow-robustness P1#12:send 路径同 stream 刷新 vfs 被引用集(原只在 stream 注册 → 跨轮 LRU 淘汰被引用 large_results → vfs_read 404)
      vfsStore?.setProtectedRefs?.(extractVfsRefs(messages))
      const maxAuto = useAutomation ? (options.maxAutoRetries ?? 1) : 0
      let attempt = 0
      let pushed = false
      // P1-1(fix-hang-and-feedback):无响应方路径自动拒确认 + observable error 转发(详见 makeStreamWatch 注释)
      const streamWatch = makeStreamWatch(options.signal)
      // abort→冲突收口联动(flow-robustness P0#2):core.stream 入口有同款,send(invoke)路径原本缺失 ——
      // 乐观锁冲突 ask 挂起期间 signal abort 不解 onConflict Promise → send 永不返回(unmount/switch/reset
      // 可解但 headless 编程式 abort 无出路)。abort 即按「保留外部」收口(keep_external 不写入,与生命周期口径一致)
      if (options.signal) {
        const abortConflict = () => conflictMgr.resolve('keep_external')
        if (options.signal.aborted) abortConflict()
        else options.signal.addEventListener('abort', abortConflict, { once: true })
      }
      const sidAtSend = core.sessionId  // 孤儿收口(rv-core F5):invoke 期间 resetSession/switch 换会话的比对锚
      while (true) {
        if (!pushed) {
          messages.push({ role: 'user', content: msg, timestamp: Date.now(), ...(images.length ? { images } : {}) })
          pushed = true
        }
        try {
          // P1-4(fix-hang-and-feedback):signal 穿透 —— 原 invoke 不带 signal,send 完全不可中断(headless 唯一出路=刷新)
          let reply = await core.agent!.invoke(messages, options.signal, streamWatch)
          // 孤儿收口(rv-core F5):abort 落在模型调用内 → createAgent 不抛、返回 partial;resetSession 同步
          // 无闸,期间已清态/换 sessionId → 不向新会话推孤儿 assistant 也不落盘(返回 partial 给调用方,
          // 留痕丢弃原因)。refCount≤0 = 已 unmount(release),同理不写已释放 core
          if (options.signal?.aborted || core.sessionId !== sidAtSend || core.refCount <= 0) {
            core.agent?.debugLogs?.value?.push({ timestamp: Date.now(), type: 'middleware', data: { stage: 'orphan_round_dropped', fromSession: sidAtSend, aborted: !!options.signal?.aborted, sessionChanged: core.sessionId !== sidAtSend } })
            return reply
          }
          messages.push({ role: 'assistant', content: reply, timestamp: Date.now() })
          core.afterRound()
          // flow-robustness P1#11:flush 错误源分流 —— 落盘失败不是 LLM 错误,不再进上方 fatal 分支
          // (原:flush reject 被误归因 LLM fatal → AUTO_RECOVER_RETRY 回退 checkpoint 重跑整轮烧 token);
          // 留痕后放行,落盘交 debounce/pagehide 兜底
          if (store) {
            try { await store.flush() } catch (e) {
              emit({ type: 'error', message: `落盘失败(不影响本轮回复):${e instanceof Error ? e.message : String(e)}`, severity: 'observable', code: 'PERSIST_FLUSH_FAILED' } as any)
            }
          }
          return reply
        } catch (err) {
          // abort(用户经 signal 中止):不计错误,静默上抛(同 useChat「abort 不计入 error」语义)
          if (isAbort(err, options.signal)) throw err
          let ae = asAgentError(err, 'fatal')
          // model-offline-guidance:emit 携带结构化 MODEL_UNAVAILABLE 码(引导文案已由 coreModelCall 装饰进 message;此处兜底装饰经不经 coreModelCall 的错误源;severity 仍 fatal)
          if (decorateModelUnavailable(err)) ae = { ...ae, code: 'MODEL_UNAVAILABLE', message: err instanceof Error ? err.message : ae.message }
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
      if (core.refCount <= 0) throw new Error('page-agent-sdk: agent 已释放(unmount),拒绝排队中的 batch')  // rv-verify A6 同族:release 后剩余任务照跑烧 LLM
      const results: BatchResult[] = []
      const streamWatch = makeStreamWatch(signal)  // P1-1:批处理同样无 UI 响应方,确认超时自动拒;error 转发同 send
      // flow-robustness P1#12:batch 路径同 stream 刷新 vfs 被引用集(原只在 stream 注册 → 跨任务 LRU 淘汰被引用 large_results → vfs_read 404)
      vfsStore?.setProtectedRefs?.(extractVfsRefs(messages))
      // abort→冲突收口联动(flow-robustness P0#2):batch 与 send 同款(invoke 路径冲突 ask 挂起不吃 abort)
      if (signal) {
        const abortConflict = () => conflictMgr.resolve('keep_external')
        if (signal.aborted) abortConflict()
        else signal.addEventListener('abort', abortConflict, { once: true })
      }
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
          // P1#11 同 send:flush 失败不标记任务失败(LLM 已成功;落盘交兜底),留痕放行
          if (store) {
            try { await store.flush() } catch (e) {
              emit({ type: 'error', message: `落盘失败(不影响本任务结果):${e instanceof Error ? e.message : String(e)}`, severity: 'observable', code: 'PERSIST_FLUSH_FAILED' } as any)
            }
          }
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
          decorateModelUnavailable(err) // model-offline-guidance:批量任务撞离线模型 → 引导随 message 进 BATCH_TASK_FAILED 结果
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
        if (useMission) { const m = missionMw.getMission(); if (m) persistSave({ mission: m } as Partial<SessionSnapshot>) }
        if (useWorkingMemory) { const wm = workingMemoryMw.getWorkingMemory(); if (wm) persistSave({ workingMemory: wm } as Partial<SessionSnapshot>) }
        // focus-auto-switch:切走前 persist focus(有值存值;clearFocus 后存 null 覆盖清除)
        if (useFocus) { const fs = focusMw.getFocuses(); persistSave({ focus: fs.length ? fs : null } as Partial<SessionSnapshot>) }
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
      summarizationMw?.reset() // team-audit P1#2:清 LLM 摘要前缀缓存 + epoch 翻转(防旧会话摘要泄进新会话压缩)
      resumeNoticeMw.reset() // 切会话:清待注入恢复标记(下方 applySnapshot 若灌入历史会重新标记)
      lastPlanConfirmation = undefined // 切会话:清方案确认留痕(方案时效限本会话;回原会话经 applySnapshot 恢复)
      // session-history S1:切会话清 checkpoint 栈,防旧会话快照污染新会话(开 checkpoint 时,否则 restore 会回退到旧会话态)
      if (checkpointMgr) checkpointMgr.importStack([])
      // 释放上一会话的调试日志(切会话后旧日志不再相关,立即释放内存)
      core.agent!.debugLogs.value = []
      core.agent!.resetStaleReadsInvalidated?.() // stale-read 失效计数同点清零,防旧会话计数带进新会话
      // 二次 load(新建会话路径):此时内存态已清/sessionId 已换,失败若上抛 = 半切换态且 UI 按钮路径无人接
      // (flow-robustness P1#6)→ 降级空会话 + observable 留痕(切换照常完成,快照可后续手动重载)
      if (!snap) {
        try { snap = await store.load(agentId, target) } catch (e) {
          emit({ type: 'error', message: `会话快照载入失败,已降级空会话:${e instanceof Error ? e.message : String(e)}`, severity: 'observable', code: 'SESSION_SNAPSHOT_LOAD_FAILED', context: { sessionId: target } } as any)
        }
      }
      if (snap) {
        core.applySnapshot(snap)
        emit({ type: 'session_restored', sessionId: target, rounds: snap.messages?.length ?? 0 })
      }
      if (options.memory) persistSave({ memory: memoryMw.get() || (typeof options.memory === 'string' ? options.memory : '') })
      void refreshSessions()  // session-history Phase 6:切会话后刷新历史列表(响应式 sessions 自动更新;内部已吞错)
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
      summarizationMw?.reset() // team-audit P1#2:清 LLM 摘要前缀缓存 + epoch 翻转(防旧会话摘要泄进新会话压缩)
      resumeNoticeMw.reset() // 清空会话:新会话无恢复历史,清待注入标记
      lastPlanConfirmation = undefined // 清空会话:清方案确认留痕(save-and-plan-gates 3c)
      if (checkpointMgr) checkpointMgr.importStack([])
      if (core.agent) { core.agent.debugLogs.value = []; core.agent.resetStaleReadsInvalidated?.() }
      if (store) {
        store.createSession(core.agentId, options.session?.title, core.sessionId).catch((e: unknown) => {
          if (options.debug) console.warn('[page-agent-sdk][persist] createSession 失败(已吞):', e)
        })
      }
      emit({ type: 'session_restored', sessionId: core.sessionId, rounds: 0 })
      core.infoTick.value++ // 焦点等 UI computed(focuses chip)挂 infoTick;reset 清焦点后不 bump → 输入框聚焦 chip 残留旧焦点(用户实测)
      void refreshSessions() // 内部守卫:storage 未开启 no-op
      lastTitle = undefined; titleLLMDone = false
    },

    stream: async (msgs, onEvent, signal) => {
      if (!core.agent) throw new Error('page-agent-sdk: agent 尚未初始化完成,请先 await mount()')
      // image-input-vision(UI 路径,send 走 invoke 不经此):带图 user 消息的收口 ——
      // stow(原图入 vfs + thumb)+ 非 vision 主模型的 describe 旁路 + 诚实闸(三分支同 sdk.send)
      const imgMsg = [...msgs].reverse().find((m) => m.role === 'user' && (m as AgentMessage).images?.length) as AgentMessage | undefined
      if (imgMsg?.images?.length) {
        await stowImages(imgMsg.images)
        await describeIfNeeded(imgMsg.images, imgMsg.content)
        if (!modelCaps.vision && !imgMsg.images.every((im) => im.description)) {
          const em = '当前主模型不支持图片输入(modelCaps.vision=false)。请换多模态模型(gpt-4o/claude/qwen-vl)或 LLMConfig 声明 vision:true;或配置 images.describe 绑定识图转述'
          emit({ type: 'error', message: em, severity: 'recoverable', code: 'IMAGE_UNSUPPORTED_MODEL' } as any)
          throw new Error(`[page-agent-sdk] ${em}`)
        }
      }
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
        vision: llmCfg?.vision ?? (llmOpt as any).vision,
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
        // stale-read-invalidation 会话累计(顶层字段,不寄生 inspect().context —— 那是 contextInspector 每轮覆盖快照且随其开关消失)
        staleReadsInvalidated: core.agent?.getStaleReadsInvalidated?.() ?? 0,
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
        // 方案确认留痕(save-and-plan-gates 3c):本会话最近一次 RHC 方案确认(带 options);DebugDrawer 可见
        planConfirmation: lastPlanConfirmation,
        workingMemory: useWorkingMemory ? workingMemoryMw.getWorkingMemory() : undefined,
        focus: useFocus ? focusMw.getFocus() : undefined,
        focuses: useFocus ? focusMw.getFocuses() : [],
        actions: actionsToInspectInfo(options.actions ?? {}),
        subagent: {
          enabled: !!subagentMw,
          maxDepth: options.subagent?.maxDepth ?? 1,
          maxParallel: options.subagent?.maxParallel ?? 4,
          // 单次委派总时长(flow-robustness P1#4:undefined → 默认 600000;0 = 关;反射实际生效值)
          timeoutMs: options.subagent?.timeoutMs !== undefined ? (options.subagent.timeoutMs > 0 ? options.subagent.timeoutMs : 0) : 600_000,
          allowedTools: options.subagent?.allowedTools ?? [],
          // 预声明子 agent 列表(动态:反映 setSubagents/addSubagent/removeSubagent 后的最新;含 thinkingMode/thinkingApplied 反射)
          subagents: (subagentsController?.get() ?? []).map(reflectSubagentThinking),
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
        mcp: { servers: core.mcpServers, ...(core.mcpFailed.length ? { failed: core.mcpFailed } : {}) },
        lastCompression: core.agent?.getState?.()?.lastCompression as AgentInfo['lastCompression'],
        checkpoints: checkpointMgr
          ? { enabled: true, auto: checkpointAuto, list: checkpointMgr.list() }
          : undefined,
      }
    },
    /**
     * 导出诊断报告(JSON 字符串):debugLogs/messages/inspect/usage/conflict/主数据摘要一次聚合,
     * 用户复制给维护者排查(editor_fangzhou 实测需求)。
     * 隐私/安全:不含 apiKey(inspect/debugLogs 源无凭据);zod schema 不进报告(内部结构含引用,替换为 topKeys 摘要);
     * bind 不 dump 全量(仅 description+顶层 keys+字节量级);url 凭据键打码(diagnostics.maskUrlCredentials)。
     */
    exportDiagnostics(): string {
      const info = core.getInfo()
      // zod schema 对象不可安全 JSON 化(_def 内部结构/可能的 lazy 循环)→ 替换为摘要字段
      const safeInfo: Record<string, unknown> = {
        ...info,
        tools: info.tools.map(({ schema: _schema, ...rest }) => rest),
        data: info.data ? { description: info.data.description, schemaTopKeys: getSchemaTopKeys(info.data.schema as never) ?? [] } : undefined,
      }
      const cfg = core.liveData()
      let dataSummary: DiagnosticsDataSummary | null = null
      if (cfg) {
        let approxBytes = -1
        let topKeys: string[] = []
        try {
          const s = JSON.stringify(cfg.bind)
          approxBytes = s ? s.length : 0
          if (cfg.bind && typeof cfg.bind === 'object' && !Array.isArray(cfg.bind)) topKeys = Object.keys(cfg.bind as Record<string, unknown>)
        } catch { approxBytes = -1 }
        dataSummary = { description: cfg.description, topKeys, approxBytes }
      }
      const report = buildDiagnosticsReport({
        debugLogs: core.agent?.debugLogs?.value ?? [],
        messages: core.messages as unknown as Array<Record<string, unknown>>,
        info: safeInfo as never,
        usage: { ...core.usage },
        pendingConflict: core.pendingConflict?.value ?? null,
        sessionId: core.sessionId,
        dataSummary,
      })
      return stringifyDiagnosticsReport(report)
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
      if (options.debug && focusMw.isInvokeActive()) console.info('[page-agent-sdk][focus] 在途流程进行中,聚焦将在下一次输入生效(当前流程不受影响)')
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
      if (options.debug && focusMw.isInvokeActive()) console.info('[page-agent-sdk][focus] 在途流程进行中,聚焦将在下一次输入生效(当前流程不受影响)')
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
    // team-audit P1#4:恢复读路径吞错降级 —— load/listSessions 失败不再上抛(原裸 await → initDone reject →
    // core.agent 永不构造 → mount/send 全 reject,SDK 整体不可用;REST 瞬时 500/内置 IDB QuotaExceeded 同炸,
    // doc/usage-guide「后端抛错不炸 SDK」承诺原只覆盖写路径)。降级空会话 + SESSION_RESTORE_FAILED observable
    // (与 switchSession 的 SESSION_SNAPSHOT_LOAD_FAILED 同口径);createSession 自身已吞 backend.set 错(降级语义)。
    const safeLoad = async (sid: string): Promise<SessionSnapshot | undefined> => {
      try {
        return await store.load(agentId, sid)
      } catch (e) {
        emit({ type: 'error', message: `会话快照读取失败,已降级空会话:${e instanceof Error ? e.message : String(e)}`, severity: 'observable', code: 'SESSION_RESTORE_FAILED', context: { sessionId: sid } } as any)
        return undefined
      }
    }
    const safeList = async (): Promise<{ sessionId: string }[]> => {
      try {
        return await store.listSessions(agentId)
      } catch (e) {
        emit({ type: 'error', message: `会话列表读取失败,已降级新建会话:${e instanceof Error ? e.message : String(e)}`, severity: 'observable', code: 'SESSION_RESTORE_FAILED' } as any)
        return []
      }
    }
    // flow-robustness P1#5:ready 包 race 5s —— IDB open 卡 blocked(跨 tab 版本锁)时原实现拖死
    // initDone → mount 永不 resolve;超时放行(backend 预置内存,窗口内读写降级不炸),留痕可见。
    // 注意 ready(false)(后端不可用降级内存)是合法快速落定,自带 degraded 事件,不算超时不重复留痕
    const READY_TIMEOUT = Symbol('storage-ready-timeout')
    const readyResult = await Promise.race([
      store.ready.then(() => 'ready' as const),
      new Promise<typeof READY_TIMEOUT>((r) => setTimeout(() => r(READY_TIMEOUT), 5000)),
    ])
    if (readyResult === READY_TIMEOUT) {
      console.warn('[page-agent-sdk][persist] 存储初始化 5s 未就绪(可能被其他标签页锁住),已放行;持久化暂降级内存,就绪后自动恢复')
      emit({ type: 'error', message: '存储初始化 5s 未就绪(IDB blocked?),已放行降级运行', severity: 'observable', code: 'STORAGE_READY_TIMEOUT' } as any)
    }
    const sessOpts = options.session || {}
    if (sessOpts.id) {
      core.sessionId = sessOpts.id
      const snap = await safeLoad(core.sessionId)
      if (snap) {
        core.applySnapshot(snap)
        emit({ type: 'session_restored', sessionId: core.sessionId, rounds: snap.messages?.length ?? 0 })
      } else await store.createSession(agentId, sessOpts.title, core.sessionId)
    } else if (sessOpts.autoResume !== false) {
      const sessions = await safeList()
      if (options.debug) console.log('[page-agent-sdk][restore] listSessions', agentId, sessions.length, sessions.map((s) => s.sessionId))
      if (sessions.length) {
        core.sessionId = sessions[0].sessionId
        const snap = await safeLoad(core.sessionId)
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
    if (options.memory) persistSave({ memory: memoryMw.get() || (typeof options.memory === 'string' ? options.memory : '') })
    void refreshSessions()  // session-history Phase 6:init 载入会话后刷新历史列表(内部已吞错)
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

  /**
   * fire-and-forget 落盘统一出口:吞错 + debugLogs 留痕(deferred RE 组修复;rv-recent F2 补留痕)。
   * 原 `void store.save(...)` 无 .catch —— release 后迟到写(store.dispose 已关 IDB 连接)/配额满等
   * 拒绝无人接 → unhandledRejection(browser e2e 实测:InvalidStateError: The database connection is closing)。
   * 留痕进 debugLogs(observable,DebugDrawer/集成方可见),非 debug console 噪声。
   */
  function notePersistFailure(stage: string, e: unknown): void {
    if (options.debug) console.warn(`[page-agent-sdk][persist] ${stage} 失败(已吞):`, e)
    const logs = core.agent?.debugLogs
    if (logs) {
      logs.value.push({ timestamp: Date.now(), type: 'middleware', data: { stage: 'persist_save_failed', kind: stage, error: String(e).slice(0, 160) } })
    }
  }

  function persistSave(patch: Partial<SessionSnapshot>): void {
    if (!core.sessionId || !store) return
    store.save(agentId, core.sessionId, patch).catch((e: unknown) => notePersistFailure('save', e))
  }

  /** fire-and-forget 标题更新(同 persistSave,吞错防 unhandled rejection) */
  function persistUpdateTitle(sid: string, title: string): void {
    if (!store) return
    store.updateTitle(agentId, sid, title).catch((e: unknown) => notePersistFailure('updateTitle', e))
  }

  /**
   * 图片原图收口(image-input-vision,send/stream 前调;send 与 core.stream 双路径共用):
   * - 配 images.upload(集成方 OSS):缩略图 → 上传换 url → 释放 dataUri(url 即持久引用,不入 vfs;content parts 用 URL 形态)。
   *   上传失败回退 dataURI 内联(留痕不阻塞)。
   * - 未配 upload:原图入 vfs `userImages/<id>`(userFiles 池,2MB LRU;轻形态持久化引用锚)。
   * 就地补挂 im.url / im.vfsRef / im.thumb。失败留痕不阻塞 —— 会话内直发不受影响,仅丢跨刷新恢复。
   */
  async function stowImages(images: AgentImage[]): Promise<void> {
    const upload = options.images?.upload
    for (const im of images) {
      // 三步各自独立容错:缩略图失败不带崩 upload/vfs(headless Node 无 Image 也照常收口)
      try {
        if (im.dataUri && !im.thumb) im.thumb = await makeThumb(im.dataUri)
      } catch (e) {
        notePersistFailure('imageThumb', e)
      }
      if (upload && im.dataUri && !im.url) {
        try {
          const url = await upload(im.dataUri, im)
          if (url) {
            im.url = url
            im.dataUri = undefined // 释放内联:直发/持久化均走 url
            if (im.vfsRef && core.vfsStore) delete core.vfsStore.files[im.vfsRef] // 上传成功撤 vfs 副本(url 已是持久引用)
          }
        } catch (e) {
          console.warn('[page-agent-sdk][images] upload 失败,回退 dataURI 内联直发:', (e as Error)?.message ?? e)
        }
      }
      if (im.dataUri && !im.vfsRef && core.vfsStore) {
        im.vfsRef = `userImages/${im.id}`
        core.vfsStore.files[im.vfsRef] = { content: im.dataUri, updatedAt: Date.now() }
      }
    }
  }

  /**
   * 识图转述旁路(image-input-vision,集成方绑定):非多模态主模型 + 配 images.describe 时,
   * 发送前逐图调 describe(集成方识图子 agent / 自有 vision API),转述文本写 im.description
   * (toLC 拼入该轮 user 上下文,图片不直发;随消息持久化,恢复后不重复转述)。
   * 单图超时(describeTimeoutMs,默认 15s)/失败 → 占位描述 + observable VISION_DESCRIBE_FAILED,对话继续(D6 诚实降级)。
   */
  async function describeIfNeeded(images: AgentImage[], text: string): Promise<void> {
    const describe = options.images?.describe
    if (modelCaps.vision || !describe) return
    const timeoutMs = options.images?.describeTimeoutMs ?? 15000
    for (const im of images) {
      if (im.description) continue // 已转述(重发/恢复场景)不重复
      try {
        const ac = new AbortController()
        const timer = setTimeout(() => ac.abort(), timeoutMs)
        try {
          im.description = (await Promise.race([
            describe(im, { text }),
            new Promise<never>((_, rej) => ac.signal.addEventListener('abort', () => rej(new Error(`识图转述超时(${timeoutMs}ms)`)))),
          ])).trim()
        } finally {
          clearTimeout(timer)
        }
      } catch (e) {
        im.description = '[图片描述不可用]'
        emit({ type: 'error', message: `识图转述失败:${(e as Error)?.message ?? String(e)}`, severity: 'observable', code: 'VISION_DESCRIBE_FAILED' } as any)
      }
    }
  }

  /** 持久化当前会话的 messages + todos(一轮结束 / send 后调用) */
  function persistRuntime(): void {
    if (!core.sessionId || !store) return
    // messages 元素是 Vue reactive proxy → IDB structured clone 会抛 DataCloneError(静默失败,messages 存不进);
    // 先 JSON 纯化为普通对象。localStorage 走 JSON.stringify 本就纯化,故 local 不受影响、indexed 受影响。
    // image-input-vision:轻形态落盘(剥 dataUri 原图只留 thumb+vfsRef;原图走 vfs kind 各自持久化,快照体积不放大 —— design D2)
    const pureMessages = lightenMessages(JSON.parse(JSON.stringify(messages)) as AgentMessage[])
    persistSave({ messages: pureMessages })
    // todos 始终同步当前态(含空数组覆写):否则会话内 todos 由有变空(LLM 主动 write_todos([]))后,
    // storage 仍残留旧清单 → 刷新恢复出遗留的已完成 todos。代价:未用过 todos 的会话多写一条空记录(可忽略)。
    const todos = core.agent?.getState?.()?.todos ?? []
    persistSave({ todos })
    // 方案确认留痕(save-and-plan-gates 3c):确认即时 persistSave 已存,此处兜底覆盖
    // (确认后未发消息即刷新的场景由即时写覆盖;重置后写 undefined 清除残留防旧值复活)
    persistSave({ planConfirmation: lastPlanConfirmation })
    // context-persist-resilience 功能A:持久化 mission/workingMemory(刷新/切会话后长任务目标 + 工作记忆不丢;非空才写省 IDB 写)
    if (useMission) {
      const m = missionMw.getMission()
      if (m) persistSave({ mission: m } as Partial<SessionSnapshot>)
    }
    if (useWorkingMemory) {
      const wm = workingMemoryMw.getWorkingMemory()
      if (wm) persistSave({ workingMemory: wm } as Partial<SessionSnapshot>)
    }
    // focus-auto-switch:持久化 focus(有值存值;clearFocus 后存 null 覆盖清除,防旧值残留被下次 restore)
    if (useFocus) {
      const fs = focusMw.getFocuses()
      persistSave({ focus: fs.length ? fs : null } as Partial<SessionSnapshot>)
    }
    // automation 断点续跑:持久化 checkpoint 栈 + 累计 usage(刷新/崩溃后恢复,长任务可续跑;仅 automation 开启时写,省空间)
    if (useAutomation && checkpointMgr) {
      persistSave({ checkpoints: checkpointMgr.exportStack() } as Partial<SessionSnapshot>)
      persistSave({ usage } as Partial<SessionSnapshot>)
    }
    // 自动 title:首条 user 截取(变化才写,避免每轮重复;供历史列表显示,替代「会话 xxxxxx」)
    const title = deriveTitle(messages)
    if (title && title !== lastTitle) {
      lastTitle = title
      persistUpdateTitle(core.sessionId, title)
    }
    // LLM 标题(异步,首轮 user+assistant 完成后一次;主旨更准,覆盖规则 title;失败/无 LLM 用规则兜底)
    const autoTitle = options.autoTitle !== false
    if (autoTitle && titleLlmInvoke && !titleLLMDone && messages.some((m) => m.role === 'user') && messages.some((m) => m.role === 'assistant')) {
      titleLLMDone = true
      const sid = core.sessionId // 调度时会话快照:LLM 返回时可能已切会话,写错会话
      void (async () => {
        try {
          const llmTitle = await titleLlmInvoke(messages)
          // 迟到守卫(deferred RE 组修复):LLM 期间卸载(refCount≤0 → store 已 dispose)或切会话(sessionId 变)→ 放弃
          if (llmTitle && core.refCount > 0 && core.sessionId === sid) {
            // 时序契约:必须先等标题落盘再 refreshSessions —— updateTitle 经 storage per-key 串行链
            // (≥1 微任务延迟)而 listSessions 的 scan 直读,fire-and-forget 会让会话列表读到旧标题
            // (rv-recent F1,3.19 稳定性小修自引入的回归)
            try { await store!.updateTitle(agentId, sid, llmTitle) } catch (e) { notePersistFailure('updateTitle', e) }
            await refreshSessions()
          }
        } catch {
          /* LLM 标题失败:规则 title 已兜底,吞掉防 unhandled rejection */
        }
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
        // 上游 MCP 网关偶发 502/连接重置(实测 user-bff-api 抖动):一次性连接撞上抖动会整会话丢工具
        // → 模型调 rag_* 报「不存在」。重试 3 次(递增退避)吸收瞬时故障,仍失败才降级跳过。
        const connectWithRetry = async (c: McpServerConfig) => {
          let lastErr: unknown
          for (let i = 0; i < 3; i++) {
            try { return await connectMcp(c) } catch (e) { lastErr = e; if (i < 2) await new Promise((r) => setTimeout(r, 600 * (i + 1))) }
          }
          throw lastErr
        }
        /** C1(MCP 保留字保护):工具注入前查已注册非 mcp 来源工具名,冲突 → skip + warn */
        const reservedNames = new Set<string>()
        for (const t of allTools) {
          const source = toolSources.get(t.name)
          if (source && !source.startsWith('mcp:')) reservedNames.add(t.name)
        }
        // 逐 server 渐进注入(修 allSettled 栅障):原实现等全部 server 落定才统一注入 —— 一个坏 server
        // 的 3 次重试(~5s)会拖累所有好 server 的工具注入(mcp-e2e F4 实测)。改为各自落定即注入,
        // 谁先连上谁先可用;坏 server 失败只影响自己(故障隔离语义不变)。单线程事件循环保证 push 安全。
        let settled = 0
        const total = options.mcp!.length
        await Promise.allSettled(options.mcp!.map(async (cfg) => {
          const label = cfg.name ?? cfg.url
          let injected = false
          try {
            const conn = await connectWithRetry(cfg)
            // release 先行:core 已释放 → 不回填 mcpClosers(release 已 splice 过,回填=泄漏),直接关
            if (mcpBackgroundReleased) { void conn.close(); return }
            core.mcpClosers.push(conn.close)
            core.mcpServers.push({ name: label, url: cfg.url, toolCount: conn.tools.length })
            conn.tools.forEach((t) => {
              if (reservedNames.has(t.name)) {
                console.warn(`[page-agent-sdk][mcp] 工具 "${t.name}" 与内置工具重名,已拒绝注入(安全保留字保护)`)
                return
              }
              toolSources.set(t.name, `mcp:${label}`)
              mcpTools.push(t)
              injected = true
            })
            // 重建 allTools(纳入 mcpTools)+ 已建 agent 则 rebind 迟到注入(infoTick 刷新 inspect)
            if (injected) {
              allTools = rebuildExtraTools()
              if (core.agent) core.agent.setTools(allTools)
              core.infoTick.value++
            }
          } catch (reason) {
            if (mcpBackgroundReleased) return
            console.warn(`[page-agent-sdk][mcp] server ${label} 连接失败:`, reason)
            // 降级可观测(MCP_CONNECT_FAILED):只 console.warn 时 headless/无 console 集成无从得知,
            // 模型仍会按 systemPrompt 引用调工具 →「工具不存在」误导为代码问题。emit observable + inspect 反射。
            const errText = String((reason as Error | undefined)?.message ?? reason ?? '').slice(0, 200)
            core.mcpFailed.push({ name: label, url: cfg.url, error: errText })
            emit({ type: 'error', message: `MCP server「${label}」连接失败,其工具不可用:${errText}`, severity: 'observable', code: 'MCP_CONNECT_FAILED', context: { server: label, url: cfg.url } } as any)
          } finally {
            settled++
            if (settled === total && options.debug) console.log(`[page-agent-sdk][mcp] 注入 ${mcpTools.length} 个工具,${core.mcpServers.length} 个 server`)
          }
        }))
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
      // section-orchestrator 0a:轮次预算提醒的委派教学按能力感知(subagent:false 集成不点名不存在的工具;
      // 默认只读 spawn_agent 也算委派能力 —— subagents 未声明时 subagentsForAssemble 为 undefined 但工具在场)
      hasSubagent: useSubagent,
      maxRetries: options.maxRetries,
      // P1-7(fix-hang-and-feedback):流停滞看门狗(默认 90s;0 关;chunk 间隔超时中断防 loading 永转)
      stallMs: options.streamStallMs ?? DEFAULT_STREAM_STALL_MS,
      // 流总时长上限(默认 600s;0 关):间隔看门狗盲区兜底 —— 空转帧黑洞 chunk 不断但无实质内容
      streamMaxMs: options.streamMaxDurationMs ?? DEFAULT_STREAM_MAX_DURATION_MS,
      // per-tool 看门狗(flow-robustness P0#1,默认 120s / 0 关):只对集成方注入工具生效(toolWatchdog 打标)
      toolTimeoutMs: options.toolTimeoutMs,
      maxParallelTools: options.maxParallelTools,
      // 模型能力透传(已在 buildCore 解析,声明优先 > 表 > 缺省):驱动 maxTokens 缺省与 offload 阈值
      contextWindow: modelCaps.contextWindow,
      maxOutputTokens: modelCaps.maxOutputTokens,
      // image-input-vision:多模态主模型 user 消息图片直发;anthropic provider 用原生 image block 格式
      vision: modelCaps.vision,
      imageContentFormat: (!isChatModel(options.llm) && ((options.llm as LLMConfig).provider ?? 'openai') === 'anthropic') ? 'anthropic' : 'openai',
      // verify 自纠上限:装载 verify 时用 verify.maxAttempts(默认 2),否则 0(关闭自纠 = 现状)
      maxVerifyAttempts: useVerify ? verifyMaxAttempts : 0,
      // C4 单 invoke token 预算(opt-in,默认关):超限友好收口;与 automation 全局 tokenBudget 正交
      roundTokenBudget: options.roundTokenBudget ?? 0,
      // stale-read-invalidation(默认 true):窗口内写后旧读占位;false 主/子一致关闭零变化
      staleReadInvalidation: options.staleReadInvalidation,
      // setLlm 后回调:重解析模型能力(contextWindow/maxOutputTokens 影响 offload 阈值/压缩)
      onLlmChange: (newLlm: BaseChatModel) => {
        // 仅更新实例引用;modelCaps 重算 + 最小窗口校验 + 集中回灌由 createChatSdk.setLlm 权威处理
        // (createChatSdk.setLlm 把 LLMConfig 构造成 BaseChatModel 实例后 contextWindow 声明丢失,
        //  onLlmChange 拿不到原 cfg.contextWindow → 在 setLlm 用原 llmOpt 重算更准)
        currentLlm = newLlm
      },
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
      i18n: options.i18n,
      debug: options.debug === true,
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
    /** 清除代码资产复用缓存(用户「重新生成」前调):清 vfs 未提交重试集合 + checkout hash,强制子 agent 重新生成而非复用工作副本 */
    clearCodeReuse: () => core.clearCodeReuse(),
    /** 调试日志(供 DebugDrawer 等;switchSession/onClear 清空) */
    get debugLogs() { return core.agent!.debugLogs },
    /** Agent 信息刷新 tick(传 DebugDrawer 实时重拉 inspect) */
    infoTick: core.infoTick,
    inspect: core.getInfo,
    /** 导出诊断报告 JSON 字符串(完整日志文件:debugLogs/messages/inspect/usage/conflict/数据摘要;一键复制交排查) */
    exportDiagnostics: () => core.exportDiagnostics(),
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
