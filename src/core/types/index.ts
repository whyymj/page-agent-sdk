import type { SubagentRunState } from '../harness/subagent'

/** 工具调用步骤（用于在消息内展示思考过程） */
export interface ToolStep {
  name: string
  /** 工具调用关联 id(与 tool_call/tool_result 事件同 id;并行同轮同名工具按 id 精确归属,缺省按 name 匹配兜底) */
  id?: string
  args?: any
  result?: string
  status: 'running' | 'done' | 'error'
  /** 工具执行耗时(毫秒,tool_result 时回填;供步骤行展示) */
  durationMs?: number
  /** 子 agent 的工具步骤(spawn_agent/spawn_agents 委派时,展示子 agent 工作进度) */
  children?: ToolStep[]
  /** 子 agent(spawn)思考过程增量累积(reasoning 转发;展示子 agent "在想什么",默认折叠);超 REASON_TAIL_CAP 截尾(仅留尾部) */
  subReason?: string
  /** 子 agent 思考过程**完整**累积(不截尾;仅供复制全量排查,渲染不用它 → 不触发大字符串重排防卡死) */
  subReasonFull?: string
}

/**
 * 工具步骤展示映射(dialog.toolStepView 返回值):把原始工具名/入参翻译成面向用户的展示文案。
 * 纯展示层 —— 不影响发给 LLM 的工具名/协议/校验,只改 MessageSteps 步骤行的渲染。
 */
export interface ToolStepView {
  /** 步骤标题(替换原始工具名展示,如 write → 「修改数据」;不提供 = 保留原名) */
  title?: string
  /** 标题旁补充说明(单次调用时展示,如「第 3 个组件 · title 字段」;不提供 = 无) */
  detail?: string
}

/**
 * 工具步骤展示映射函数(dialog.toolStepView):每次工具调用渲染时调,返回自定义展示或 undefined(回退默认)。
 * 入参为步骤的只读投影(含 args 可做动态映射,如 write 的 jsonPath → 「修改第 N 个组件」);
 * status running→done 翻转/args 补齐时会以新入参重调。抛错安全(捕获后回退原始工具名)。
 */
export type ToolStepViewFn = (step: {
  name: string
  args?: unknown
  status: 'running' | 'done' | 'error'
  result?: string
  durationMs?: number
}) => ToolStepView | undefined | null

/** user 消息附带图片(image-input-vision):内存态带 dataUri(直发/重发用);持久化轻形态只留 thumb+vfsRef/url(restore 后按需重水化) */
export interface AgentImage {
  /** 图片 id(消息内唯一;vfs 路径与持久化引用的锚) */
  id: string
  /** 压缩后原图 dataURI(base64;持久化时剥离,恢复后从 vfs 重水化;配 images.upload 成功后释放只留 url) */
  dataUri?: string
  name?: string
  width?: number
  height?: number
  /** 压缩后 base64 字节估算 */
  bytes?: number
  /** 缩略图 dataURI(≤~8KB;持久化轻形态的渲染位) */
  thumb?: string
  /** 原图在 vfs 的路径(userImages/<id>;LRU 淘汰后缺省 → UI 降级占位) */
  vfsRef?: string
  /** 集成方上传后的 URL(images.upload 返回;URL 形态直发 + 持久化轻引用,原图不再内联/不入 vfs) */
  url?: string
  /** 识图转述文本(images.describe 产出 / 集成方注入;非多模态主模型时拼入该轮 user 上下文;随消息持久化) */
  description?: string
}

/** 图片输入配置组(image-input-vision;顶层 `images` 选项) */
export interface ImagesConfig {
  /**
   * 上传换 URL(集成方 OSS):压缩后原图经此上传,返回 https URL。
   * 配置后:消息/持久化存 URL(content parts 用 URL 形态),原图 dataURI 上传成功即释放,不入 vfs。
   * 失败:回退 dataURI 内联直发(留痕 console.warn,不阻塞发送)。
   */
  upload?: (dataUri: string, image: AgentImage) => Promise<string>
  /**
   * 识图转述(集成方绑定识图能力:自有 vision API / 识图子 agent / describe_image 工具等)。
   * 非多模态主模型(modelCaps.vision=false)且带图时,发送前逐图调用,转述文本注入该轮 user 上下文
   * (图片不再直发,主模型只读文本描述)。全部图有 description 后跳过重复转述(随消息持久化)。
   */
  describe?: (image: AgentImage, context: { text: string }) => Promise<string>
  /** 单次 describe 超时 ms(默认 15000;超时/失败 → 该图占位描述 + observable error VISION_DESCRIBE_FAILED,对话继续) */
  describeTimeoutMs?: number
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  /** 模型思考过程（DeepSeek reasoning_content 等） */
  reasoning?: string
  /** 本轮对话中的工具调用步骤 */
  steps?: ToolStep[]
  /** user 消息发送时的焦点快照(multi-focus;MessageRow 渲染 🎯 chip 标注该消息的背景组件限制,持久化随 messages) */
  focuses?: import('../harness/state').Focus[]
  /** user 消息附带图片(image-input-vision;仅多模态主模型(visionCapable)在 toLC 组装 content parts,旁路配置见 Phase 2) */
  images?: AgentImage[]
}

export interface AgentConfig {
  model: string
  temperature?: number
  maxTokens?: number
  systemPrompt?: string
}

export interface AgentState {
  messages: AgentMessage[]
  loading: boolean
  error: string | null
}

/** 流式事件，由 Agent 在流式生成过程中逐个抛出 */
export type StreamEvent =
  | { type: 'round_start'; round: number }
  | { type: 'reasoning'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; name: string; args: any; id?: string }
  | { type: 'tool_result'; name: string; result: string; status: 'done' | 'error'; durationMs?: number; id?: string }
  | { type: 'subagent'; taskId: string; label: string; kind: 'tool_call' | 'tool_result' | 'reasoning'; name: string; args?: any; result?: string; status?: 'done' | 'error'; delta?: string; /** 关联的主循环工具调用 id(并行双委派各归各的 UI step) */ toolCallId?: string }
  | { type: 'approval_request'; toolName: string; args: any; resolve: (approved: boolean | string) => void; /** 响应方应答接管:调用的瞬间取消无响应自动拒计时(内置 UI 收到即调;无人调 → 超时自动拒;无计时器时缺省) */ hold?: () => void; /** write 审批 diff 预览(ui-quick-wins Q3;approval.preview 开且 previewWrite 命中时附带;dryRun 纯函数只读计算不落盘) */ preview?: import('../harness/approval').ApprovalWritePreview }
  | { type: 'done'; content: string }

/** 流式回调函数签名 */
export type StreamHandler = (event: StreamEvent) => void

/**
 * SDK 事件(供 createChatSdk({ onEvent }) 订阅常用时机)。
 * 复用 StreamEvent(round_start/reasoning/text/tool_call/tool_result/subagent/done;approval_request 不外发,UI 已处理)
 * + 额外时机:data_change / message_update / error。
 */
export type SdkEvent =
  | { type: 'round_start'; round: number }
  | { type: 'reasoning'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; name: string; args: any; id?: string }
  | { type: 'tool_result'; name: string; result: string; status: 'done' | 'error'; durationMs?: number; id?: string }
  | { type: 'subagent'; taskId: string; label: string; kind: 'tool_call' | 'tool_result' | 'reasoning'; name: string; args?: any; result?: string; status?: 'done' | 'error'; delta?: string; toolCallId?: string }
  | { type: 'done'; content: string }
  | { type: 'data_change'; operation: 'set' | 'edit' | 'delete' | 'restore'; value?: unknown }
  | { type: 'message_update'; count: number }
  | { type: 'conflict'; conflict: import('../sdk/createChatSdk').PendingConflict }
  | { type: 'session_restored'; sessionId: string; rounds: number }
  | { type: 'usage'; round: number; usage: TokenUsage; cumulative: TokenUsage }
  | { type: 'error'; message: string; severity?: import('../tools/toolError').ErrorSeverity; code?: string; context?: unknown }
  | { type: 'context_trimmed'; dropped: { round: number; user: unknown; assistant: unknown[]; steps: unknown[] }[]; vfsResults: Record<string, string>; summary: string; reason: string }
  | { type: 'focus_chip_click'; path: string; label?: string }
  | { type: 'focus_change'; focuses: import('../harness/state').Focus[] }

/** token 用量(OpenAI 协议字段名) */
export interface TokenUsage {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  /** prompt caching 命中读取的 input tokens(Anthropic;0/缺省=未命中或端点不支持缓存) */
  cache_read_input_tokens?: number
  /** prompt caching 本次写入的 input tokens(Anthropic;写价格 1.25x,5m/1h TTL 内复用) */
  cache_creation_input_tokens?: number
  /** 推理/思考 token 数(reasoning-tokens-observability;是 completion_tokens 的子集,展示为占比不做加数;OpenAI 兼容经 langchain usage_metadata.output_token_details.reasoning 或原始 completion_tokens_details.reasoning_tokens 可得,Anthropic 当前依赖栈不暴露则省略) */
  reasoning_tokens?: number
}

/** 批处理单任务结果(sdk.batch 返回;ok=true 含 reply,ok=false 含 error) */
export interface BatchResult {
  /** 任务在入参数组中的下标 */
  index: number
  /** 任务文本 */
  task: string
  /** 成功时的 agent 回复 */
  reply?: string
  /** 失败时的错误信息 */
  error?: string
  /** 是否成功 */
  ok: boolean
}

/** 批处理进度回调 payload(sdk.batch 的 onProgress 每任务完成调一次) */
export interface BatchProgress {
  done: number
  total: number
  task: string
  ok: boolean
}

/** SDK 事件回调签名 */
export type SdkEventHandler = (event: SdkEvent) => void

export interface ChatDialogProps {
  /** 非流式 AI 请求函数（与 fetchStream 二选一） */
  fetchResponse?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<string>
  /** 流式 AI 请求函数，传入则优先使用流式输出 */
  fetchStream?: (messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal) => Promise<string>
  /** 对话框标题 */
  title?: string
  /** 占位文本 */
  placeholder?: string
  /** 调试日志（响应式数组），传入则显示调试按钮 */
  debugLogs?: any[]
  /** 获取 agent 详细信息（供 debug 窗口「Agent 信息」tab 展示） */
  getInfo?: () => AgentInfo
}

/** agent 检视信息（inspect() 返回，供 debug 窗口展示） */
export interface ToolInfo { name: string; description: string; schema?: unknown; /** 来源:builtin / mcp:<name> / user */ source?: string }
export interface SkillInfo { name: string; description: string }
export interface DataInfo { description?: string; schema?: unknown }

/** 子 agent 配置(subagent 委派能力检视) */
export interface SubagentInfo {
  enabled: boolean
  maxDepth: number
  maxParallel: number
  /** 单次委派总时长毫秒(flow-robustness P1#4 反射:undefined → 默认 600000;0 = 关) */
  timeoutMs: number
  allowedTools: string[]
  /** 预声明子 agent 列表(动态:反映 setSubagents/addSubagent/removeSubagent 后的最新) */
  subagents?: { id: string; description: string }[]
  /** 运行中子 agent(观察层;空=无在跑;capabilities.subagent 关闭 → 空数组) */
  active?: SubagentRunState[]
  /** 历史委派(观察层;LRU≤20,最新在前) */
  history?: SubagentRunState[]
  /** 组件锁视图(组件名 → 占用委派 taskId;同组件单委派互斥,委派结束自动解锁;无锁场景为空对象) */
  lockedComponents?: Record<string, string>
}
export interface AgentInfo {
  id: string
  /** 当前会话 id(switchSession/onClear 后实时反映) */
  sessionId: string
  model?: string
  /** 当前生效的 systemPrompt(默认或用户传入;含中间件 augmentPrompt 段则仅为 base 段,便于调试/验证默认提示词) */
  systemPrompt: string
  tools: ToolInfo[]
  skills: SkillInfo[]
  data?: DataInfo
  /** 当前上下文压缩预设(默认 auto;complex 为多步复杂任务/大 JSON 场景) */
  contextPreset?: 'auto' | 'conservative' | 'aggressive' | 'complex'
  /** 压缩触发配置反射:contextWindow / summaryThresholdRatio / promptSoftCap(softCap 解析结果,Infinity=不参与) */
  compression?: { contextWindow: number; summaryThresholdRatio: number; promptSoftCap: number }
  /** 规划阶段防死循环状态(maxPlanRevisions 预算;planning 关闭时 inPlanning 恒 false) */
  planPhase?: { inPlanning: boolean; rounds: number; limit: number }
  /** 当前任务目标锚点(mission 中间件;未开启/未 capture → undefined) */
  mission?: import('../harness/state').Mission
  /** 方案确认留痕(save-and-plan-gates 3c:RHC 带 options 的方案被点选;ApprovalBar 上下文提示 + bulk-guard 豁免;切/重置会话清除) */
  planConfirmation?: import('../harness/humanConfirm').PlanConfirmationRecord
  /** 大批量变更门禁反射(bulk-change-guard;enabled:false = 未装配(默认关或未配 approval)) */
  /** 跨压缩工作记忆(workingMemory 中间件;pin 最近 read/query/search 定位 path + read hash,≤10 LRU) */
  workingMemory?: { locatedPaths: string[]; lastHashes: Record<string, string> }
  /** 写驱动过期读失效会话累计(stale-read-invalidation;写后旧 read/query/search 结果被替换为占位的次数) */
  staleReadsInvalidated?: number
  /** 当前上下文聚焦焦点(focus 中间件;兼容:首个;未聚焦/未开启 → undefined) */
  focus?: import('../harness/state').Focus
  /** 全部聚焦焦点(multi-focus;空数组=未聚焦) */
  focuses?: import('../harness/state').Focus[]
  /** 宿主动作元信息(actions 注册;集成方 save_draft/publish 等) */
  actions?: Record<string, { description: string; hasParams: boolean }>
  memory: string
  middleware: string[]
  todos: { content: string; status: string }[]
  subagent: SubagentInfo
  /** verify 自检装载状态(默认未装载 → undefined) */
  verify?: { enabled: boolean; maxAttempts: number; adversarial: boolean }
  /** 已连 MCP server 列表 + 连接失败清单(无 MCP → undefined;failed 仅在有失败时存在) */
  mcp?: { servers: { name: string; url: string; toolCount: number }[]; failed?: { name: string; url: string; error: string }[] }
  /** 最近一次跨轮压缩统计(未触发过 → undefined;供 DebugDrawer 可观测) */
  lastCompression?: {
    triggered: boolean
    roundsTotal: number
    roundsSummarized: number
    roundsRecalled: number
    originalMessages: number
    compressedMessages: number
    strategy: string
    /** 触发本次压缩的 agent 决策(agentCompression;无决策=静态压缩) */
    decision?: import('../sdk/compressDecision').CompressDecision
  }
  /** 最近一次 wrapModelCall 的上下文构成快照(context-inspector 中间件;capabilities.contextInspector 关 → undefined) */
  context?: import('../utils/contextAnalysis').ContextSnapshot
  /** 会话级 checkpoint 装载状态(未开启 → undefined) */
  checkpoints?: {
    enabled: boolean
    auto: boolean
    list: { id: number; label?: string; timestamp: number; messageCount: number }[]
  }
}
