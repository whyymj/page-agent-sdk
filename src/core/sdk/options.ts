/**
 * createChatSdk 公共类型段(F1 2026-09-10 拆出):LLMConfig/ChatSdkOptions/ChatSdk/DialogConfig 等九接口
 * + SendOptions + PendingConflict。createChatSdk.ts 经 re-export 保符号(消费方 import 路径零变化);
 * 新代码建议直接 import 本模块。纯类型零运行时(值 import 随头部复制,裁剪器清未用项)。
 */
import { type Ref } from 'vue'
import { type StructuredToolInterface } from '@langchain/core/tools'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { DialogIcons } from '../components/icons'
import type { DialogMessages, DialogLocale } from '../components/messages'
import { type DebugLog } from '../harness/createAgent'
import { type SkillSpec } from '../harness/skills'
import { type PermissionRule } from '../harness/permissions'
import { type Middleware } from '../harness/middleware'
import { type SubagentConfig, type SubagentRunState } from '../harness/subagent'
import { type VerifyCheck } from '../harness/verify'
import { type McpServerConfig } from '../mcp/client'
import { type ConflictPolicy } from './conflictManager'
import type { ContextManagerOptions } from '../composables/useContextManager'
import { type ContextPreset } from './contextPreset'
import type { HarnessState, Mission, Focus } from '../harness/state'
import { type DataConfig, type ConflictResolution } from '../tools/dataOps'
import { type ActionMap } from './actions'
import { type StorageConfig, type StorageBackendType } from '../backends/storage'
import { type SkillStoreConfig } from '../backends/skillStore'
import type { AgentMessage, StreamHandler, AgentInfo, SdkEventHandler, BatchResult, BatchProgress, AgentImage, ImagesConfig, ToolStepViewFn } from '../types'

export interface LLMConfig {
  apiKey: string
  /** provider 选择:缺省 'openai'(兼容 OpenAI/DeepSeek 协议,向后兼容);'anthropic' 动态加载 @langchain/anthropic 走 Claude */
  provider?: 'openai' | 'anthropic'
  baseUrl?: string
  model?: string
  temperature?: number
  /** 单次生成输出上限(max_tokens);缺省按能力表模型输出上限发(deepseek-v4 384K/deepseek 系 8K/claude-4 64K…),不发会落 provider/网关缺省(常 4K)易截断;未知模型不兜(防超发 400)。主/子 agent 同口径 */
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
  /** 单次模型调用流总时长上限:防空转帧黑洞(keepalive 空转不断喂饱间隔看门狗,实测冻结 7min+ 无报错;超限 → StreamMaxDurationError,重委派/重发即自愈)。默认 1800s(2026-08-28 抬升,100K+ 输出生成需 20min+);0 = 关闭 */
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
    /** write 审批 diff 预览(ui-quick-wins Q3;默认 false):挂起 write 时只读预览(dryRun 纯函数通道)附 approval_request 载荷,ApprovalBar 渲染 old→new;预览跑一次校验链有成本,args JSON 已有兜底呈现,故显式开 */
    preview?: boolean
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

/** 快捷指令项(dialog.quickActions;ui-quick-wins Q1):点击即发送 prompt */
export interface QuickActionItem {
  /** 按钮文案(必填,空串项被过滤) */
  label: string
  /** 点击发送的完整消息(必填,空串项被过滤) */
  prompt: string
  /** 可选图标前缀(纯文本/emoji;不走 icons 的 HTML 净化通道,文案经模板插值恒转义) */
  icon?: string
}

export interface DialogConfig {
  /** 对话框标题 */
  title?: string
  /** 输入框 placeholder */
  placeholder?: string
  /** 快捷指令按钮(ui-quick-wins Q1):输入区顶部 chip 行,点击 = 直接发送 prompt(走既有 sendMessage 链,排队/挂起门禁语义自动继承,不预填输入框)。≤8 条超出 warn 截断;缺 label/prompt 的项过滤 */
  quickActions?: QuickActionItem[]
  /** 拖拽宿主元素入输入框回调(ui-quick-wins Q4 元素聚焦入口):window 捕获 dragstart 记源元素(drop 的 event.target 是输入框自身拿不到源),drop 无文件且源元素仍连文档时回调。映射 el→jsonPath→setFocus 归宿主(如复用画布选中联动)。未声明零开销 */
  onDropElement?: (el: Element) => void
  /** 会话导出/导入 UI 入口(ui-quick-wins Q2):历史面板底部显示「导出会话/导入会话…」(下载 .json / 选文件导入并切换)。默认 false 不显示;sdk.exportSession/importSession API 恒可用(与 UI 开关无关) */
  sessionTransfer?: boolean
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
  /** 导出会话快照(ui-quick-wins Q2):{ formatVersion, exportedAt, sessionId, snapshot } 可复全 JSON;跨会话导出传 sessionId;storage 未开启抛错 */
  exportSession(sessionId?: string): Promise<Record<string, unknown>>
  /** 导入会话快照副本(ui-quick-wins Q2):总是新 sessionId 不覆盖既有,不自动切换;坏 JSON/未知版本/缺 messages/超 6MB 抛错 */
  importSession(data: unknown): Promise<{ sessionId: string }>
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
   * 清空快照栈与乐观锁缓存。替换后发 data_change 事件(operation:'set',与 importData 口径一致)。
   * 需开启 dataOps(默认开)。
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
export interface SendOptions {
  mission?: Partial<Mission>
  maxAutoRetries?: number
  /** 中断信号(fix-hang-and-feedback P1-4):abort → 本次 send 中止(挂起的确认/冲突随 signal 自动收口)。headless 无停止按钮场景的退出通道 */
  signal?: AbortSignal
  /** 附带图片(image-input-vision;≤4 张,压缩后 AgentImage;需主模型多模态 vision,否则 send 拒绝并 emit 结构化错误 —— 不静默丢图) */
  images?: AgentImage[]
}

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

