/**
 * page-agent-sdk/headless 类型声明 —— 纯核心子集(不含 UI 组件)。
 *
 * 与 index.d.ts 一致的核心 API/类型 + ChatSdkOptions/ChatSdk/DialogConfig + createChatContext/chatContextKey/useChatContext/useChat。
 * 不含 13 个 .vue 组件声明(ChatDialog/MessageContent/CodePreview/SkillPanel/ChatHeader/ChatInput/MessageList/MessageRow/QueuedBar/ApprovalBar/ConflictBar/FocusBar/DebugDrawer)。
 * 由 types/index.d.ts 派生(删组件 declare + 去 DefineComponent import),保持与主类型同步,防漂移。
 */
// ===== vue 类型内联桩(E2 API 面收口,2026-09-09 audit-remediation)=====
// d.ts 不再 import 'vue':未装 vue 的 TS 项目(纯 headless 集成)也能完整解析本声明文件,Ref 字段不再退化为 error type。
// 桩形状与 vue 3.x 公开类型结构兼容(Ref = { value };InjectionKey = symbol 接口,与 vue 源码同式;DefineComponent = 构造器形态)。
// 已知限制:真 vue 项目把 ChatDialog 等直接塞进 SFC components:{} 时,vue-tsc 期望真 DefineComponent —— SDK 定位
// mount() 挂载式对话框(框架无关),直接组件复用是次级路径;需要时集成方自行 as 断言。详见 usage-guide 依赖说明。
type Ref<T = any> = { value: T };
type InjectionKey<T> = symbol & { __pgInjType?: T };
type DefineComponent<P = any> = { new (...args: any[]): { $props?: P; [key: string]: any } };
export { z } from 'zod';

// 代理连接模块(防 apiKey 泄露:proxy 代理模式 / direct 直连模式)
export type ProxyLlmMode = 'proxy' | 'direct';
export interface ProxyLlmOptions {
  mode: ProxyLlmMode;
  baseUrl?: string;
  userToken?: string;
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  refreshToken?: () => Promise<string>;
  headers?: Record<string, string>;
}
export declare function createProxyLlm(opts: ProxyLlmOptions): import('@langchain/core/language_models/chat_models').BaseChatModel;
export interface ConstructOpts {
  temperature?: number;
  maxTokens?: number;
}
/** 同步构造 OpenAI 协议 LLM(仅 openai 分支;Anthropic 无同步构造,用 constructLlmFromConfig) */
export declare function constructOpenLlmSync(cfg: LLMConfig, opts?: ConstructOpts): import('@langchain/core/language_models/chat_models').BaseChatModel;
/** baseUrl 容错归一:相对路径('/llm/v1' 同源代理用法)补 location.origin 成绝对 URL(openai/anthropic SDK 的 new URL 不收相对路径);非浏览器/绝对路径原样 */
export declare function normalizeBaseUrl(baseUrl: string | undefined): string | undefined;
/** 默认 fetch 包装:剥 x-stainless-* 遥测头(严格 CORS 网关预检兼容);集成方 extraConfig.fetch 可覆盖 */
export declare function stripStainlessFetch(url: string | URL | Request, init?: RequestInit): Promise<Response>;
/** 按 provider 分支构造 LLM(openai 同步 / anthropic 动态 import @langchain/anthropic);缺省 provider → openai */
export declare function constructLlmFromConfig(cfg: LLMConfig, opts?: ConstructOpts): Promise<import('@langchain/core/language_models/chat_models').BaseChatModel>;
/** 从流式 chunk 提取文本 delta(兼容 OpenAI string content 与 Anthropic parts 数组) */
export declare function extractTextDelta(chunk: import('@langchain/core/messages').AIMessageChunk): string;
/** 从流式 chunk 提取推理 delta(DeepSeek additional_kwargs.reasoning_content + Anthropic thinking parts) */
export declare function extractReasoningDelta(chunk: import('@langchain/core/messages').AIMessageChunk): string;
/** 从响应消息提取 token usage(OpenAI additional_kwargs.usage + Anthropic response_metadata.usage) */
export declare function extractUsage(message: import('@langchain/core/messages').BaseMessage): any;
/** 原始 usage → 归一 TokenUsage(camelCase 兼容;fix-main-sub-isolation:sdk-events 与子栈 sub-usage 共用);全 0/无效返 null */
export declare function normalizeUsage(message: import('@langchain/core/messages').BaseMessage): TokenUsage | null;

export interface ToolStep {
  name: string;
  /** 工具调用关联 id(与 tool_call/tool_result 事件同 id;并行同轮同名工具按 id 精确归属 UI step,缺省按 name 兜底) */
  id?: string;
  args?: any;
  result?: string;
  status: 'running' | 'done' | 'error';
  /** 工具执行耗时(毫秒,tool_result 时回填) */
  durationMs?: number;
  /** 子 agent 工具步骤(spawn 委派时展示子进度) */
  children?: ToolStep[];
  /** 子 agent 思考过程累积(reasoning 转发;超长截尾仅留尾部);展示"在想什么" */
  subReason?: string;
  /** 子 agent 思考过程**完整**累积(不截尾;仅供复制全量排查,渲染不用它防卡死) */
  subReasonFull?: string;
}

/** 工具步骤展示映射(dialog.toolStepView 返回值);详见主包 types/index.d.ts ToolStepView */
export interface ToolStepView {
  title?: string;
  detail?: string;
}

/** 工具步骤展示映射函数(dialog.toolStepView);详见主包 types/index.d.ts ToolStepViewFn */
export type ToolStepViewFn = (step: {
  name: string;
  args?: unknown;
  status: 'running' | 'done' | 'error';
  result?: string;
  durationMs?: number;
}) => ToolStepView | undefined | null;

export interface AgentMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  reasoning?: string;
  steps?: ToolStep[];
  /** user 消息发送时的焦点快照(multi-focus;MessageRow 渲染 🎯 chip 标注该消息的背景组件限制,持久化随 messages) */
  focuses?: Focus[];
  /** user 消息附带图片(image-input-vision;多模态主模型 toLC 组装 content parts 直发,非多模态走 images.describe 转述注入) */
  images?: AgentImage[];
}

/** user 消息附带图片(image-input-vision);详见主包 types/index.d.ts AgentImage */
export interface AgentImage {
  id: string;
  dataUri?: string;
  name?: string;
  width?: number;
  height?: number;
  bytes?: number;
  thumb?: string;
  vfsRef?: string;
  url?: string;
  description?: string;
}

/** 图片输入配置组(image-input-vision;顶层 `images` 选项) */
export interface ImagesConfig {
  upload?: (dataUri: string, image: AgentImage) => Promise<string>;
  describe?: (image: AgentImage, context: { text: string }) => Promise<string>;
  describeTimeoutMs?: number;
}

/** 图片输入错误(image-input-vision;code 稳定,输入侧拒绝不静默丢图);详见主包 types/index.d.ts */
export declare class ImageInputError extends Error {
  code: 'IMAGE_TOO_LARGE' | 'IMAGE_COUNT_LIMIT' | 'IMAGE_DECODE_FAILED' | 'IMAGE_COMPRESS_FAILED' | 'IMAGE_UNSUPPORTED_TYPE';
  constructor(code: ImageInputError['code'], message: string);
}

/** 压缩闸(image-input-vision):原图 >20MB 拒;等比缩放长边 ≤1568;浏览器域 API(依赖 canvas),headless 自建 UI 制备 AgentImage 用 */
export declare function compressImage(source: Blob, opts?: { name?: string }): Promise<AgentImage>;

export interface AgentConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface AgentState {
  messages: AgentMessage[];
  loading: boolean;
  error: string | null;
}

/** 流式事件,由 Agent 在流式生成过程中逐个抛出(与 src/core/types 同步;approval_request 仅流内,不进 onEvent) */
export type StreamEvent =
  | { type: 'round_start'; round: number }
  | { type: 'reasoning'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; name: string; args: any; id?: string }
  | { type: 'tool_result'; name: string; result: string; status: 'done' | 'error'; durationMs?: number; id?: string }
  | { type: 'subagent'; taskId: string; label: string; kind: 'tool_call' | 'tool_result' | 'reasoning'; name: string; args?: any; result?: string; status?: 'done' | 'error'; delta?: string; toolCallId?: string }
  | { type: 'approval_request'; toolName: string; args: any; resolve: (approved: boolean | string) => void; hold?: () => void; preview?: ApprovalWritePreview }
  | { type: 'done'; content: string };

/** write 审批 diff 预览的单条条目(ui-quick-wins Q3;headless 补充声明供 StreamEvent 引用) */
export interface ApprovalPreviewItem {
  op?: string;
  jsonPath?: string;
  oldSummary?: string;
  newSummary?: string;
}
/** write 审批 diff 预览结果(三意图只读计算,dryRun 纯函数通道不落盘) */
export interface ApprovalWritePreview {
  ok: boolean;
  intent: 'set' | 'edit' | 'delete';
  items: ApprovalPreviewItem[];
  /** ok=false 时的校验失败说明(预览即看到会被拒的原因) */
  error?: string;
}

export type StreamHandler = (event: StreamEvent) => void;

/**
 * SDK 事件(供 createChatSdk({ onEvent }) 订阅常用时机)。
 * 复用 StreamEvent(round_start/reasoning/text/tool_call/tool_result/subagent/done;approval_request 不外发)
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
  | { type: 'conflict'; conflict: PendingConflict }
  | { type: 'session_restored'; sessionId: string; rounds: number }
  | { type: 'usage'; round: number; usage: TokenUsage; cumulative: TokenUsage }
  | { type: 'error'; message: string; severity?: 'recoverable' | 'fatal' | 'observable'; code?: string; context?: unknown }
  | { type: 'context_trimmed'; dropped: { round: number; user: unknown; assistant: unknown[]; steps: unknown[] }[]; vfsResults: Record<string, string>; summary: string; reason: string }
  | { type: 'focus_chip_click'; path: string; label?: string }
  | { type: 'focus_change'; focuses: Focus[] };

/** token 用量(OpenAI 协议字段名) */
export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  /** prompt caching 命中读取的 input tokens(Anthropic;0/缺省=未命中或端点不支持缓存) */
  cache_read_input_tokens?: number;
  /** prompt caching 本次写入的 input tokens(Anthropic;写价格 1.25x,5m/1h TTL 内复用) */
  cache_creation_input_tokens?: number;
  /** 推理/思考 token 数(completion 子集,展示为占比;OpenAI 兼容可得,Anthropic 当前依赖栈不暴露则省略) */
  reasoning_tokens?: number;
}
/** 批处理单任务结果(sdk.batch 返回;ok=true 含 reply,ok=false 含 error) */
export interface BatchResult {
  /** 任务在入参数组中的下标 */
  index: number;
  /** 任务文本 */
  task: string;
  /** 成功时的 agent 回复 */
  reply?: string;
  /** 失败时的错误信息 */
  error?: string;
  /** 是否成功 */
  ok: boolean;
}
/** 批处理进度回调 payload(sdk.batch 的 onProgress 每任务完成调一次) */
export interface BatchProgress {
  done: number;
  total: number;
  task: string;
  ok: boolean;
}

export type SdkEventHandler = (event: SdkEvent) => void;

/** 调试日志(与 harness/createAgent 的 DebugLog 一致) */
export interface DebugLog {
  timestamp: number;
  type: 'context' | 'llm_request' | 'llm_response' | 'tool_call' | 'tool_result' | 'error' | 'middleware';
  data: any;
  /** 日志来源(主 agent 省;子 agent 转发时为 '子:label',便于区分) */
  source?: string;
}

/** ChatDialog 区块显隐控制(chatdialog-component-split):键=区块,false 关闭整块(含 slot);默认 undefined=全开 */
export interface ChatDialogSections {
  header?: boolean;
  focus?: boolean;
  body?: boolean;
  queued?: boolean;
  approval?: boolean;
  conflict?: boolean;
  footer?: boolean;
  debug?: boolean;
  skill?: boolean;
}

export interface ChatDialogProps {
  fetchResponse?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<string>;
  fetchStream?: (messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal) => Promise<string>;
  title?: string;
  placeholder?: string;
  debugLogs?: DebugLog[];
  initialMessages?: AgentMessage[];
  onPersist?: (messages: AgentMessage[]) => void;
  onClear?: () => void;
  getInfo?: () => AgentInfo;
  onUndo?: () => boolean;
  canUndo?: () => boolean;
  showAvatar?: boolean;
  showTyping?: boolean;
  pendingConflict?: PendingConflict | null;
  onResolveConflict?: (action: ConflictResolution['action']) => void;
  infoTick?: Ref<number>;
  getSkillContent?: (name: string) => Promise<string | null>;
  onAddSkill?: (skill: { name: string; description: string; getContent: () => string }) => void;
  onRemoveSkill?: (name: string) => boolean;
  getUserSkillNames?: () => string[];
  onGetSkill?: (name: string) => { name: string; description: string; content: string } | undefined;
  drawer?: boolean;
  drawerWidth?: number | string;
  drawerHidden?: boolean;
  inputRows?: number;
  sessions?: SessionMeta[];
  currentSessionId?: string;
  onNewSession?: () => void;
  onOpenSession?: (sessionId: string) => void;
  onRemoveSession?: (sessionId: string) => void;
  getFocus?: () => Focus | undefined;
  onSetFocus?: (focus: Focus) => { ok: boolean; error?: string };
  onClearFocus?: () => void;
  getFocuses?: () => Focus[];
  onAddFocus?: (focus: Focus) => { ok: boolean; error?: string };
  onRemoveFocus?: (path: string) => void;
  onFocusChipClick?: (focus: Focus) => void;
  /** 区块显隐(chatdialog-component-split);键=false 关闭整块(含 slot),默认全开 */
  sections?: ChatDialogSections;
}

export interface ToolInfo { name: string; description: string; schema?: unknown; source?: string }
export interface SkillInfo { name: string; description: string }
export interface DataInfo { description?: string; schema?: unknown }
/** 子 agent 工具调用进度摘要(只记 kind+name+ts,不含 args/result 全文,防膨胀) */
export interface SubagentStep { kind: 'tool_call' | 'tool_result'; name: string; ts: number }
/** 单个子 agent 运行状态(观察层;会话级纯内存,不持久化跨刷新) */
export interface SubagentRunState {
  taskId: string;
  task: string;
  label: string;
  status: 'running' | 'done' | 'error';
  steps: SubagentStep[];
  startedAt: number;
  durationMs?: number;
  resultPreview?: string;
}
/** 子 agent 观察层 tracker(会话级 active/history 状态管理) */
export interface SubagentTracker {
  start(taskId: string, task: string, label: string, startedAt: number): void;
  pushStep(taskId: string, step: SubagentStep): void;
  finish(taskId: string, status: 'done' | 'error', result: string): void;
  getActive(): SubagentRunState[];
  getHistory(): SubagentRunState[];
}
/** 创建子 agent 观察层 tracker(会话级纯内存;historyLimit 默认 20,resultPreview 截断 120 字) */
export declare function createSubagentTracker(historyLimit?: number): SubagentTracker;
export interface SubagentInfo {
  enabled: boolean;
  maxDepth: number;
  maxParallel: number;
  /** 单次委派总时长毫秒(flow-robustness P1#4 反射:undefined → 默认 1800000(30min,2026-08-28 抬升对齐流总时长);0 = 关) */
  timeoutMs: number;
  allowedTools: string[];
  /** 预声明子 agent 列表(动态:反映 setSubagents/addSubagent/removeSubagent 后的最新) */
  subagents?: { id: string; description: string }[];
  /** 运行中子 agent(观察层;空=无在跑;capabilities.subagent 关闭 → 空数组) */
  active?: SubagentRunState[];
  /** 历史委派(观察层;LRU≤20,最新在前) */
  history?: SubagentRunState[];
  /** 组件锁视图(组件名 → 占用委派 taskId;同组件单委派互斥,委派结束自动解锁;无锁场景为空对象) */
  lockedComponents?: Record<string, string>;
}
/** 预声明子 agent 配置(同主配置子集 + id/description;缺省继承主 agent) */
export interface SubagentConfig {
  /** 唯一标识;生成委派工具名 use_<id>(须合法工具名) */
  id: string;
  /** 一句话说明(进主 systemPrompt 索引 + 作委派工具描述) */
  description: string;
  llm?: LLMConfig | ChatModelLike;
  /** 思考深度锁定:'simple' 剥思考参数 / 'deep' 注入;缺省继承。仅 llm 为配置形态生效,预构造实例路径 no-op */
  thinkingMode?: 'simple' | 'deep';
  systemPrompt?: string;
  tools?: any[];
  skills?: SkillSpec[];
  temperature?: number;
  maxTokens?: number;
  /** 子 agent 工具调用轮次上限(默认 10);大 JSON 子任务可调大 */
  maxToolRounds?: number;
  /** 子 agent 可写路径前缀白名单(给子 agent 写权限;写工具包 path guard,越界 PATH_OUT_OF_SCOPE;整体 set 禁)。subagent-writable Phase 2 */
  writablePaths?: string[];
  allowedTools?: string[];
  middleware?: any[];
  summarization?: boolean | any;
  /** beforeReturn 自纠上限(默认 0 = 关闭);>0 时返回前跑中间件 beforeReturn 钩子(如 verify 格式门禁),feedback 回灌自纠。配 verify 类中间件时必开 */
  maxVerifyAttempts?: number;
}
export interface AgentInfo {
  id: string;
  /** 当前会话 id(switchSession/onClear 后实时反映) */
  sessionId: string;
  model?: string;
  /** 当前生效的 systemPrompt(默认或用户传入;仅 base 段,不含中间件 augmentPrompt,便于调试/验证默认提示词) */
  systemPrompt: string;
  tools: ToolInfo[];
  skills: SkillInfo[];
  data?: DataInfo;
  /** 当前上下文压缩预设(默认 auto;complex 为多步复杂任务/大 JSON 场景) */
  contextPreset: 'auto' | 'conservative' | 'aggressive' | 'complex';
  /** 压缩触发配置反射:contextWindow / summaryThresholdRatio / promptSoftCap(softCap 解析结果,Infinity=不参与) */
  compression: { contextWindow: number; summaryThresholdRatio: number; promptSoftCap: number };
  memory: string;
  middleware: string[];
  todos: { id: string; content: string; status: string }[];
  /** 规划阶段防死循环状态(rounds = 计划修订次数,调研轮不计;planning 关闭时 inPlanning 恒 false) */
  planPhase?: { inPlanning: boolean; rounds: number; limit: number };
  /** 当前任务目标锚点(mission 中间件;未开启/未 capture → undefined) */
  mission?: Mission;
  /** 方案确认留痕(save-and-plan-gates 3c:RHC 带 options 的方案被点选;undefined=本会话无已确认方案) */
  planConfirmation?: PlanConfirmationRecord;
  /** 宿主动作元信息(actions 注册;集成方 save_draft/publish 等) */
  actions?: Record<string, { description: string; hasParams: boolean }>;
  /** 跨压缩工作记忆(workingMemory 中间件;pin 最近 read/query/search 定位 path + read hash,≤10 LRU) */
  workingMemory?: WorkingMemory;
  /** 写驱动过期读失效会话累计(stale-read-invalidation;写后旧 read/query/search 结果被替换为占位的次数) */
  staleReadsInvalidated?: number;
  /** 模型调用重试会话累计(retry-visibility;启动/body 阶段自动重试次数 —— 环境故障 vs SDK 回归的第一判据) */
  llmRetries?: number;
  /** 模型调用最终失败会话累计(retry-visibility;重试耗尽/不可重试类终败次数) */
  llmCallFailures?: number;
  /** 当前上下文聚焦焦点(focus 中间件;兼容:首个;未聚焦/未开启 → undefined) */
  focus?: Focus;
  /** 全部聚焦焦点(multi-focus;空数组=未聚焦) */
  focuses?: Focus[];
  subagent: SubagentInfo;
  verify?: { enabled: boolean; maxAttempts: number; adversarial: boolean };
  mcp?: { servers: { name: string; url: string; toolCount: number }[] };
  /** 最近一次跨轮压缩统计(未触发过 → undefined) */
  lastCompression?: {
    triggered: boolean; roundsTotal: number; roundsSummarized: number; roundsRecalled: number;
    originalMessages: number; compressedMessages: number; strategy: string;
    decision?: CompressDecision;
  };
  /** 会话级 checkpoint 装载状态(未开启 → undefined) */
  checkpoints?: { enabled: boolean; auto: boolean; list: CheckpointMeta[] };
  /** 上下文构成快照(context-inspector;每轮 wrapModelCall 覆盖;capabilities.contextInspector:false → undefined) */
  context?: ContextSnapshot;
}
/** 上下文分类(context-inspector) */
export interface ContextCategory {
  key: string;
  label: string;
  tokens: number;
  pct: number;
  msgCount: number;
}
/** 上下文构成快照(context-inspector;每轮 wrapModelCall 覆盖,不累积) */
export interface ContextSnapshot {
  totalTokens: number;
  contextWindow?: number;
  /** totalTokens / contextWindow(无窗口为 0) */
  occupancy: number;
  /** 压缩触发阈值占比 */
  thresholdRatio: number;
  /** 分类明细(按 tokens 降序) */
  categories: ContextCategory[];
  /** 最近一次压缩统计(复用 state.lastCompression) */
  compression?: CompressionStats;
}
/** analyzeContext 选项(context-inspector) */
export interface AnalyzeContextOptions {
  contextWindow?: number;
  thresholdRatio?: number;
}
/** 对「实际发给 LLM 的消息」分类切分 + token 估算(纯函数,零 LLM 成本) */
export declare function analyzeContext(messages: import('@langchain/core/messages').BaseMessage[], opts?: AnalyzeContextOptions): ContextSnapshot;
/** 上下文检查中间件选项(context-inspector) */
export interface ContextInspectorOptions {
  contextWindow?: number;
  thresholdRatio?: number;
}
/** 上下文检查中间件(context-inspector;getSnapshot 读最近快照) */
export interface ContextInspectorMiddleware {
  name: string;
  getSnapshot(): ContextSnapshot | undefined;
}
/** 创建上下文检查中间件(capabilities.contextInspector 默认开) */
export declare function createContextInspectorMiddleware(opts?: ContextInspectorOptions): ContextInspectorMiddleware;
export interface McpServerConfig { transport: 'http' | 'sse' | 'websocket'; url: string; name?: string; requestInit?: any; /** 握手超时 ms(默认 15s;fix-hang-and-feedback P1-2);超时按连接失败降级 */ timeoutMs?: number; }

/** DebugDrawer props(纯 props 驱动,不耦合 ChatDialog;headless 自建对话框可复用) */
export interface DebugDrawerProps {
  logs?: DebugLog[];
  visible: boolean;
  /** 取 agent 详情(「Agent 信息」tab) */
  getInfo?: () => AgentInfo;
  /** 刷新 tick(watch 后重拉 getInfo;setSkills/setData 后 ++ 实时反映) */
  infoTick?: Ref<number>;
  /** 读 skill 全文(展开 skill 时调;返回 null 表示无内容) */
  getSkillContent?: (name: string) => Promise<string | null>;
}
/** 调试抽屉(7 类日志筛选 / Agent 信息 / 上下文构成 / 上轮压缩 / skill 展开);v-model:visible 显隐,emit clear 清日志 */
// chatContext 枢纽(L2 自建根组件调 createChatContext + provide(chatContextKey);原子组件 useChatContext inject)
export interface ChatContextOptions {
  fetchResponse?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<string>;
  fetchStream?: (messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal) => Promise<string>;
  messages?: AgentMessage[];
  onPersist?: (messages: AgentMessage[]) => void;
  onClear?: () => void;
  getInfo?: () => AgentInfo;
  canUndo?: () => boolean;
  onUndo?: () => boolean;
}
export interface ChatContext {
  /** 对话状态 + 操作(useChat 返回 14 项) */
  readonly chat: any;
  inputText: Ref<string>;
  isExpanded: Ref<boolean>;
  toggleCollapse: () => void;
  debugVisible: Ref<boolean>;
  openDebug: () => void;
  closeDebug: () => void;
  skillVisible: Ref<boolean>;
  openSkill: () => void;
  closeSkill: () => void;
  reasoningExpanded: Ref<Record<number, boolean>>;
  isReasoningExpanded: (idx: number) => boolean;
  toggleReasoning: (idx: number) => void;
  copiedMsg: Ref<boolean>;
  copyMessage: (text: string) => void;
  summary: Readonly<Ref<{ mcp: number; tools: number }>>;
  canUndo: Readonly<Ref<boolean>>;
  undo: () => void;
  formatTime: (timestamp: number) => string;
  send: () => void;
  keydown: (e: KeyboardEvent) => void;
  editQueued: (idx: number) => void;
  isPendingAssistant: (idx: number) => boolean;
}
export declare const chatContextKey: InjectionKey<ChatContext>;
export declare function createChatContext(opts?: ChatContextOptions): ChatContext;
export declare function useChatContext(): ChatContext;
/** useChat 选项(自定义 fetcher/持久化回调/共享 messages 引用;E1 API 面收口,与 src composables/useChat 对齐) */
export interface UseChatOptions {
  fetchResponse?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<string>;
  fetchStream?: (messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal) => Promise<string>;
  /** 外部共享的消息数组(持久化恢复时传入,与父级共用同一响应式引用) */
  messages?: AgentMessage[];
  /** 一轮对话完成后回调(用于持久化;可返回 Promise,sendMessage 会 await 确保落盘后再关 loading) */
  onPersist?: (messages: AgentMessage[]) => void | Promise<void>;
  /** 清空对话时回调(用于新建会话) */
  onClear?: () => void;
  /** stop() 清空排队任务时回调(丢弃条数与内容由消费方记日志,防无声丢失) */
  onQueuedCleared?: (dropped: string[]) => void;
  /** regenerate 前回调(清代码资产复用缓存,强制子 agent 重新生成而非复用工作副本) */
  onBeforeRegenerate?: () => void;
  /** 取当前实时焦点(排队任务开始执行时快照进 user 消息;与 invoke-freeze 生效口径一致) */
  getFocuses?: () => Focus[];
}
/** 挂起的审批(approval 中间件 ask-first;UI 据此渲染审批条,resolveApproval 收口) */
export interface PendingApproval {
  toolName: string;
  args: any;
  resolve: (approved: boolean | string) => void;
  /** write 审批 diff 预览(approval_request 载荷透传;无则 undefined 走 args JSON 兜底呈现) */
  preview?: ApprovalWritePreview;
}
/** useChat 返回(对话状态 + 操作;自建 UI 直接用) */
export interface UseChatReturn {
  /** 对话状态(messages/loading/error,reactive) */
  state: AgentState;
  /** 消息列表容器 DOM 引用(自动滚动) */
  scrollContainer: Ref<HTMLElement | null>;
  /** 挂起的审批 */
  pendingApproval: Ref<PendingApproval | null>;
  /** 排队待发的任务内容(生成中再发 → 入队显示在排队区) */
  queuedTasks: Ref<string[]>;
  /** 发送(生成中再发 → 入排队区;images 需主模型多模态或 images.describe 配置,否则拒绝并 emit 结构化错误不静默丢图) */
  sendMessage(content: string, focuses?: Focus[], images?: AgentImage[]): Promise<void>;
  /** 手动撤销排队任务 */
  removeQueuedTask(idx: number): void;
  /** 清空对话(onClear 回调) */
  clearMessages(): void;
  /** 停止当前生成(abort 保留 partial + 清排队) */
  stop(): void;
  /** 重置(state 清空 + pendingApproval 收口) */
  reset(): void;
  /** 重试失败轮(移除失败 user/assistant 占位后重发) */
  retry(): Promise<void>;
  /** 重新生成最后一轮(onBeforeRegenerate 清复用缓存) */
  regenerate(): Promise<void>;
  /** 审批响应(true/false 或 RHC 方案 id 字符串) */
  resolveApproval(approved: boolean | string): void;
  /** 滚动绑定(保留给 @scroll;sticky 由 onWheel 管) */
  onScroll(): void;
  onWheel(e: WheelEvent): void;
}
export declare function useChat(opts?: UseChatOptions): UseChatReturn;

// ===== 框架无关 SDK(页面内 Agent)=====
export interface LLMConfig {
  apiKey: string;
  /** provider 选择:缺省 'openai'(兼容 OpenAI/DeepSeek 协议,向后兼容);'anthropic' 动态加载 @langchain/anthropic 走 Claude */
  provider?: 'openai' | 'anthropic';
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 模型上下文窗口(token);缺省按 model 名查表。影响 offload 阈值与压缩触发(大模型自适应) */
  contextWindow?: number;
  /** 模型最大输出(token);缺省按 model 名查表。maxTokens 未传时作其缺省,避免设错被截断 */
  maxOutputTokens?: number;
  /** 透传 ChatOpenAI 的 modelKwargs:额外请求 body 参数(如 deepseek thinking: { thinking: { type: 'enabled' } }) */
  extraBody?: Record<string, any>;
  /** 透传 ChatOpenAI configuration 的额外字段(如 headers/timeout/customFetch),与 baseUrl 合并 */
  extraConfig?: Record<string, any>;
  /** Anthropic extended thinking(仅 provider:'anthropic');通常由 thinkingMode:'deep' 自动注入,开启时 temperature 被 API 强制为 1 */
  thinking?: { type: 'enabled'; budget_tokens: number };
}
/** LangChain BaseChatModel 的结构形状(provider 抽离:llm 可传任意 provider 实例) */
export type ChatModelLike = {
  invoke: (input: any, options?: any) => Promise<any>;
  stream: (input: any, options?: any) => Promise<any>;
  bindTools: (tools: any[]) => any;
};

/** 受保护资源配置(精确值保护:占位符替换读写) */
export interface ResourceProtectSpec {
  /** 相对主数据根的点号路径(如 id / components.0.verification) */
  path: string;
  /** freeze=只读不可改(精确值不入消息流);verbatim=原样保留(防压缩丢字,改须经 resource_update) */
  mode: 'freeze' | 'verbatim';
}

export interface DataConfig {
  /** 值的 zod schema(写入时校验);字段的 .describe() 自动提取注入 systemPrompt「可操作数据」段 */
  schema: any;
  /** 数据源:reactive/普通对象,工具直接读写 bind(reactive 写后响应式刷新;不挂 window) */
  bind: any;
  /** 数据说明,供 Agent 理解用途;不传则自动生成 */
  description?: string;
  /** 受保护资源(精确值保护):声明需 freeze(只读)/verbatim(原样保留)的字段路径。
   *  配置后 read 受保护路径返占位符(精确值不入 LLM 消息流),写侧强制(freeze 拒/verbatim 展开校验)。
   *  opt-in:未配(默认)全部行为零变化 */
  resources?: ResourceProtectSpec[];
}
/** createDataOps 选项(审计回调 / 快照上限 / 乐观锁) */
export interface DataOpsOptions {
  onAudit?: (entry: { op: string; value?: any; detail?: string; timestamp: number }) => void;
  maxSnapshots?: number;
  /** 乐观锁冲突人工介入回调(详见 ConflictInfo/ConflictResolution);不传则冲突时返回 VERSION_CONFLICT 错误 */
  onConflict?: (conflict: ConflictInfo) => Promise<ConflictResolution>;
  /** 冲突监听字段白名单(任意深度字段名):声明后仅这些字段的值变动触发自动冲突检测(位置不敏感);未声明 = 不开自动检测(仅显式 expectedHash 校验);['*'] = 全字段检测(旧 autoLock 行为) */
  conflictWatchFields?: string[];
  /**
   * 同轮工具并发上限(createAgent 透传):>1 且 conflictWatchFields 武装时启用 dataOps 闭包级并发写互锁(async mutex,单锁 bind 域)—— 同轮并发双写不再「双双过旧基线、后者静默覆盖前者」;串行/未武装直通 no-op 零行为变化
   */
  maxParallelTools?: number;
}

/** 数据操作控制器(运行时替换配置;createDataOps 返回的工具数组上以不可枚举属性 `controller` 挂载) */
export interface DataOpsController {
  /** 读取当前配置 */
  get(): DataConfig;
  /** 替换主数据配置(如页面切换、schema 变更);清空快照栈与乐观锁缓存 */
  set(config: DataConfig): void;
  /** 仅替换 bind 引用;清空快照栈与乐观锁缓存 */
  update(bind: any): void;
  /** 框架直改 bind 后(如 codeAsset commit)重算指定 scope 乐观锁基线;不传 = 主 scope */
  recomputeBaseline?(scope?: string): void;
  /** 一次性重算所有已存在 scope 的基线(baseline-guard 用;bind 为各 scope 共享,一次 hash 全部刷新) */
  recomputeAllBaselines?(): void;
  /** 是否存在乐观锁基线条目 */
  hasBaselines?(): boolean;
  /** 受保护资源清单快照(供跨压缩 pin 中间件注入「受保护资源」段;freeze 无 handle,verbatim 有) */
  getResourcesSnapshot?(): { path: string; mode: 'freeze' | 'verbatim'; handle?: string }[];
  /** 资源池操作(经 controller 同闭包;有 vfsStore 时可用) */
  createResource?(path: string, value?: unknown): string;
  getResource?(pathOrHandle: string): { path: string; mode: string; value: unknown; handle: string } | undefined;
  updateResource?(path: string, value: unknown): void;
  deleteResource?(pathOrHandle: string): boolean;
  listResources?(): { path: string; mode: string; handle: string; bytes: number }[];
}

export interface SkillsController {
  /** 运行时替换整个 skill 列表(同名 skill 覆盖更新;清缓存) */
  set(skills: SkillSpec[]): void;
  /** 读取当前 skill 列表(反映运行时 setSkills 替换) */
  get(): SkillSpec[];
  /** 清指定 skill 的全文缓存(不传清全部);下次 load_skill 重新取最新 */
  invalidateCache(name?: string): void;
}

export interface PermissionRule {
  operations: ('read' | 'write')[];
  scopes: string[];
  mode: 'allow' | 'deny';
}

export interface SkillSpec {
  name: string;
  /** 一句话说明(进索引,兼顾「是什么」+「何时用」) */
  description: string;
  /** 文档源(http(s):// 远程 md,或 vfs://path / 裸路径;SDK 代劳 fetch+vfs);与 getContent 二选一,doc 优先 */
  doc?: string;
  getContent?: () => string | Promise<string>;
  /** 加载时执行脚本,结果注入全文(skill-external-scripts);code/url 二选一,默认 sandbox,失败不缓存 */
  exec?: SkillExecSpec;
  /** 附带可调工具工厂;load_skill 后注入工具池(命名空间 <skill>__<tool>,走 dedupeTools);与 exec 正交 */
  tools?: SkillToolFactory[];
  /** 多层级参考文档(skill-references):主文只写索引,references 挂二级文档;load_skill 主文末自动附参考目录,
   *  LLM 按需 load_skill(name, ref) 单独取回 —— 大 skill(风格配方库等)渐进式披露不整包灌上下文 */
  references?: SkillRefSpec[];
}
/** skill 二级参考文档(doc/getContent 二选一,doc 优先;来源语义同 SkillSpec.doc) */
export interface SkillRefSpec {
  /** 参考名(建议带相对路径形态,如 'style-recipes/linear.md';load_skill 的 ref 参数按此精确匹配) */
  name: string;
  /** 一句话说明(进主文尾部参考目录,帮 LLM 选哪个 ref) */
  description?: string;
  doc?: string;
  getContent?: () => string | Promise<string>;
}
/** skill 执行钩子:code(内联 JS)/url(远程,仅 sandbox)二选一;context 默认 sandbox(host 已随 4.1.0 移除,残值落 sandbox 执行) */
export interface SkillExecSpec {
  code?: string;
  url?: string;
  context?: 'sandbox';
  inject?: 'append' | 'prepend';
}
/** skill 附带工具工厂(返回单个/数组工具,可异步;ctx.signal 运行时中止信号) */
export type SkillToolFactory = () => any | any[] | Promise<any | any[]>;

// ===== Verify 自检中间件 =====
/** verify check 上下文:与 beforeReturn 底层一致(messages 含 system 头 + agent 最新回复 + 历史 tool_result) */
export interface VerifyCheckContext {
  messages: any[];
  state: any;
  /** 结构化日志(debugLogs;render-check 类环境降级留痕用,可缺省) */
  log?: (type: string, data: unknown) => void;
}
export interface VerifyCheckResult {
  ok: boolean;
  /** ok=false 时的修正指引(回灌给 agent 触发自纠) */
  feedback?: string;
}
/** 领域校验函数:ok=true 放行,ok=false 用 feedback 回灌自纠 */
export type VerifyCheck = (ctx: VerifyCheckContext) => Promise<VerifyCheckResult> | VerifyCheckResult;
export interface VerifyMiddlewareOptions {
  check: VerifyCheck;
  /** 对抗式验证:check 通过后 spawn 找茬子 agent 审查;verdict 无问题放行,否则回灌 */
  adversarial?: { llm: any; tools?: any[] };
}
/** createWriteBackCheck 选项 */
export interface WriteBackCheckOptions {
  /** name → zod schema(由 createChatSdk 从 data 构造注入,键 '' 代表主数据);省略则只校验「读回非空」 */
  schemas?: Record<string, any>;
  /**
   * 读回的根对象。优先于 `window`。
   * - 单对象 data 模式:传 bind 对象(或 getter `() => liveData()?.bind`,适配 sdk.setData 运行时替换)
   * - 旧 windowProps 模式:省略则用 `window`(默认 globalThis.window)
   */
  root?: unknown | (() => unknown);
  /** 读 window 的根对象(旧 windowProps 模式;data 模式应传 root)。默认 globalThis.window */
  window?: unknown;
}

// ===== 人工确认(approval)=====
/** 人工确认中间件选项:工具调用前需用户「允许/拒绝」 */
export interface ApprovalOptions {
  /** 需确认的工具名列表;不传 confirm 且不传 tools → 所有工具都确认 */
  tools?: string[];
  /** 自定义判定(优先于 tools);返回 true 需确认 */
  confirm?: (name: string, args: any) => boolean;
  /** 超时毫秒(无响应自动拒绝);SDK 装配层默认 30000(响应方调事件的 hold() 接管后不限时);显式 Infinity/负数 = 不超时 */
  timeoutMs?: number;
  /** 超时自动拒的留痕回调(abort/用户先收口不触发) */
  onAutoReject?: (info: { toolName: string; waitedMs: number }) => void;
  /** 是否装载 request_human_confirmation 主动确认工具(传 approval 时默认 true;false 关闭) */
  humanConfirmTool?: boolean;
}
export declare function createApprovalMiddleware(opts?: ApprovalOptions): any;
export declare function createHumanConfirmTool(): any;
/** 方案确认留痕(save-and-plan-gates 3c):RHC 带 options 的方案被用户点选 → 记录;inspect().planConfirmation 反射 */
export interface PlanConfirmationRecord {
  at: number;
  summary: string;
  choice: string;
  viaOptions: true;
}
/** humanConfirm 中间件可选项:timeoutMs 无响应自动拒(超时视同拒绝);onAutoReject 超时留痕回调 */
export interface HumanConfirmOptions {
  timeoutMs?: number;
  onAutoReject?: (info: { toolName: string; waitedMs: number }) => void;
}
export declare function createHumanConfirmMiddleware(onResolved?: (record: PlanConfirmationRecord) => void, opts?: HumanConfirmOptions): any;
export declare const HUMAN_CONFIRM_TOOL_NAME: string;
/** 写触达量纲结果(原 bulk-change-guard 量纲;bulkGuard 已于 4.1.0 移除,函数为 delegateNudge 依赖保留) */
export interface WriteScaleResult {
  count: number;
  scopes: string[];
  kind: 'patches' | 'del' | 'subtree-set' | 'whole-set' | 'other';
}
/** 度量单次写调用触达的现有组件节点数(纯函数:同组件多 patch=1;新增路径不计) */
export declare function measureWriteScale(args: unknown, getBind: () => unknown): WriteScaleResult;
export interface CheckpointMeta {
  id: number;
  label?: string;
  timestamp: number;
  messageCount: number;
}
export interface Checkpoint extends CheckpointMeta {
  messages: AgentMessage[];
  windowVals: Record<string, unknown>;
  vfs: Record<string, { content: string; mimeType?: string; updatedAt: number }>;
  todos: { id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }[];
}
export interface CheckpointManager {
  save(label?: string): number;
  list(): CheckpointMeta[];
  restore(id?: number): boolean;
  canRestore(): boolean;
  /** 导出栈快照(深拷贝,可序列化;供 automation 断点续跑持久化,刷新/崩溃后恢复 restoreLastCheckpoint 能力) */
  exportStack(): Checkpoint[];
  /** 灌入栈快照(刷新/崩溃恢复时重建 checkpoint 栈;重置 nextId 防后续 save id 冲突) */
  importStack(cps: unknown[]): void;
}
export declare function createCheckpointManager(deps: any): CheckpointManager;
export declare function createCheckpointMiddleware(mgr: CheckpointManager): any;

// ===== 持久化存储 =====
export type StorageBackendType = 'indexed' | 'session' | 'local' | 'memory';
export interface StorageConfig {
  /** 后端类型,默认 'indexed';也可传自定义 StorageBackend 实例(服务端持久化注入点:实现 get/set/del/scan/clearPrefix 指向 REST API) */
  backend?: StorageBackendType | StorageBackend;
  enabled?: boolean;
  dbName?: string;
  maxBytes?: number;
  maxBytesPerSession?: number;
  evictionWatermark?: number;
  debounceMs?: number;
  /** flush 单项落盘超时 ms(默认 5000):IDB 事务卡死不拖死 flush 调用方,超时项留待后续 flush/pagehide 重试 */
  flushTimeoutMs?: number;
}
/** Skill 独立持久化存储配置(与 storage 选项分离) */
export interface SkillStoreConfig {
  /** 存储 id(命名空间)。手动指定同一 id 即可跨页面/跨 agent 复用同一套用户 skill;不传默认按 agentId 隔离 */
  id?: string;
  /** 后端类型,默认 'indexed'(大容量、跨刷新);'local' 跨页持久;'session' 刷新保留关页清;'memory' 纯内存降级 */
  backend?: StorageBackendType;
  /** DB 命名空间,默认 'chat-sdk'(与 SessionStore 同库,不同 key 前缀) */
  dbName?: string;
}
export interface SessionMeta {
  agentId: string;
  sessionId: string;
  createdAt: number;
  lastAccessed: number;
  bytes: number;
  title?: string;
}
export interface SessionSnapshot {
  messages: AgentMessage[];
  vfs: Record<string, { content: string; mimeType?: string; updatedAt: number }>;
  todos: { id: string; content: string; status: 'pending' | 'in_progress' | 'completed' }[];
  memory: string;
  /** automation 断点续跑:checkpoint 栈快照(刷新/崩溃后恢复 restoreLastCheckpoint 能力);仅 capabilities.automation 开启时写入 */
  checkpoints?: unknown[];
  /** automation 断点续跑:累计 token usage(刷新后续跑预算统计连续) */
  usage?: TokenUsage;
  /** 会话任务目标(context-persist-resilience:刷新后不丢;capabilities.missionAnchor 开启时写入) */
  mission?: Mission;
  /** 跨压缩工作记忆 path/hash 备忘(context-persist-resilience:刷新后少重复 read;capabilities.workingMemory 开启时写入) */
  workingMemory?: WorkingMemory;
  /** 上下文聚焦焦点(multi-focus:Focus[] 数组;null=清除标记;旧版本单个 applySnapshot 读时归一化) */
  focus?: Focus[] | null;
  /** 方案确认留痕(save-and-plan-gates 3c) */
  planConfirmation?: PlanConfirmationRecord;
}
export type StorageEvent =
  | { type: 'degraded'; reason: string }
  | { type: 'quota'; sessionBytes: number; limit: number }
  | { type: 'evicted'; agentId: string; sessionId: string; bytes: number }
  | { type: 'flush' };
export interface StorageBackend {
  get(key: string): Promise<unknown | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  scan(prefix: string, cb: (key: string, value: unknown) => boolean | void): Promise<void>;
  clearPrefix(prefix: string): Promise<void>;
}
export interface SessionStore {
  ready: Promise<boolean>;
  listSessions(agentId: string): Promise<SessionMeta[]>;
  load(agentId: string, sessionId: string): Promise<SessionSnapshot | undefined>;
  save(agentId: string, sessionId: string, snap: Partial<SessionSnapshot>): Promise<void>;
  /** 更新会话标题(自动从首条 user 消息生成,供历史列表显示) */
  updateTitle(agentId: string, sessionId: string, title: string): Promise<void>;
  flush(): Promise<void>;
  deleteSession(agentId: string, sessionId: string): Promise<void>;
  createSession(agentId: string, title?: string, sessionId?: string): Promise<string>;
  onEvent(cb: (e: StorageEvent) => void): void;
  dispose(): void;
}
export interface SessionOptions {
  id?: string;
  autoResume?: boolean;
  title?: string;
}

/**
 * augmentSystem 钩子上下文:集成方回调据此按运行时状态动态注入 system prompt 段。
 * - `state`:harness 当前状态(messages/todos/files/skills/memory…);不含 data(data 是 createChatSdk 层概念)
 * - `data`:当前主数据配置(每轮从 liveData() 取最新,setData 后自动同步;含 schema/bind/description)
 */
export interface SystemAugmentContext {
  state: any;
  data?: DataConfig;
}

/** 宿主动作定义:集成方注册的页面操作(保存/发布/预览/导出等),SDK 自动包成命名 tool */
export interface ActionDef {
  /** 动作描述(给 LLM 看) */
  description: string;
  /** 执行函数;接收 params schema 解析的参数,返回值序列化回灌 LLM */
  run: (args: Record<string, unknown>) => unknown | Promise<unknown>;
  /** 可选参数 schema(ZodObject);不传 = 无参 tool */
  params?: any;
}
/** actions 配置:动作名 → 定义(动作名即 tool 名,须合法标识符) */
export type ActionMap = Record<string, ActionDef>;
export interface ChatSdkOptions {
  container?: string | HTMLElement;
  /** UI:'default'(内置 ChatDialog)/ false(headless 不渲染,自建 UI) */
  ui?: boolean | 'default';
  llm: LLMConfig | ChatModelLike;
  /** agent 实例 id(多 agent 共存隔离;不传则随机生成并告警,刷新后无法恢复) */
  id?: string;
  /** 持久化:默认关闭;赋值后端字符串('indexed'/'session'/'local'/'memory')或配置对象开启;false 关闭 */
  storage?: StorageBackendType | StorageConfig | false;
  /** 会话控制 */
  session?: SessionOptions;
  /** 共享上下文:默认 false;true 时同 id 复用同一核心(messages/agent/工作区) */
  shareContext?: boolean;
  /** 系统提示词(base + 可操作数据段,数据段随 data 动态;不含 todos/skills/memory/augmentSystem 等运行态 augmentPrompt 段) */
  systemPrompt?: string;
  /** 自定义 systemPrompt 时是否自动追加 reliableWriteRules(默认 true,用 '---' 分隔线区分;设 false 关闭;不传 systemPrompt 用默认 prompt 时已内置,此项无效) */
  appendReliableWriteRules?: boolean;
  /**
   * 动态 system prompt 注入钩子:每轮 buildSystemPrompt 时调用,集成方按运行时状态(state/data)返回字符串 → 作为 system prompt 一段注入;返回 undefined → 跳过。
   * - ctx.data 每轮从 liveData() 取最新(setData 后自动同步),可据此动态算组件说明 / 部分 schema 描述
   * - 回调异常降级为跳过该段 + debug 日志(不崩 agent)
   * - 段排在内置段之后、用户 middleware 之前;不配 = 完全现状行为
   */
  augmentSystem?: (ctx: SystemAugmentContext) => string | undefined;
  tools?: any[];
  /** 宿主动作:集成方注册的页面操作(保存/发布/预览等),SDK 自动包成命名 tool;LLM 直接看到命名 tool */
  actions?: ActionMap;
  skills?: SkillSpec[];
  /** 用户创建 skill 的独立持久化存储(与 storage 选项分离)。默认 `{ backend: 'indexed' }`(即使 storage:false 也持久化);`false` 关闭;`id` 手动指定同一 id 可跨页面/跨 agent 复用 */
  skillStorage?: SkillStoreConfig | false;
  /** AGENTS.md 风格持久指令。支持 string 与同步/异步函数(异步函数适合加载 RAG 文档) */
  memory?: string | (() => string | Promise<string>);
  data?: DataConfig;
  /** 大 schema 分层披露阈值(默认 maxKeys=15/maxChars=4000;超则 systemPrompt 只注入顶层概览,深层约束查 schema_data) */
  schemaHint?: SchemaHintOptions;
  permissions?: PermissionRule[];
  /** 自定义中间件(注入到内置中间件之后;可拦截/观察模型调用、工具、prompt) */
  middleware?: any[];
    vfs?: { initialFiles?: Record<string, string>; maxBytes?: number; poolBytes?: { largeResults?: number; drafts?: number; userFiles?: number } };
  /** 每个数据对象最多保留快照数(默认 20) */
  maxSnapshots?: number;
  /** 乐观锁冲突裁决策略(默认 'ask'):ask=挂起 pendingConflict 等人工 resolveConflict;overwrite=agent 强制覆盖(宿主与 agent 争同一份数据且 agent 优先时用,冲突自动收口不挂起,无人值守场景防永挂);keep_external=自动保留外部修改(agent 收到提示重新 read)。自动裁决仍外发 conflict 事件(conflict.autoResolved 标记) */
  conflictPolicy?: ConflictPolicy;
  /** 冲突监听字段白名单(3.32 起乐观锁唯一旋钮,autoLock 已废弃;任意深度字段名):**未声明/空 = 不开自动冲突检测**(仅显式 expectedHash 逐次校验);`['*']` = 全字段检测(旧 autoLock 行为);普通名单 = 仅这些字段的值变动触发冲突(位置不敏感)。与 conflictPolicy 正交(watch 定「什么算冲突」,policy 定「真冲突怎么裁决」) */
  conflictWatchFields?: string[];
  /** 数据操作审计回调:每次 set/edit/delete/restore 经此回调外发结构化事件(独立于 debug,无需 debug:true);集成方做合规审计/操作追溯 */
  onAudit?: (entry: { op: string; value?: unknown; detail?: string; timestamp: number }) => void;
  /** 内存中保留的对话轮数上限(默认 50);超限把最旧轮次压缩为摘要 system 消息(防 OOM);0 关闭 */
  maxMemoryRounds?: number;
  debug?: boolean;
  /** agent 工具调用轮次上限(3.43 起默认 30);整页多组件搭建等计划规模天然需要多轮,预算吃紧时 SDK 自动注入两档轮次预算提示引导收口 */
  maxToolRounds?: number;
  /** 计划修订次数上限(默认 5,只计 write_todos 调用,调研轮不计);超限 → 改计划形态的调用回灌(update_todo 纯 status/evidence 进度跟踪放行),防"反复改计划不执行"死循环。与 maxIterations 正交 */
  maxPlanRevisions?: number;
  /** 模型调用失败自动重试次数(默认 2;网络/429/5xx 重试,4xx 与 abort 不重试) */
  maxRetries?: number;
  /** LLM 流停滞看门狗(fix-hang-and-feedback P1-7):chunk 间隔(含等首个)超此 ms → 中断抛错防 loading 永转。默认 90s;0 = 关闭 */
  streamStallMs?: number;
  /**
   * per-tool 看门狗:单工具执行超此 ms → 放弃等待,recoverable 错误结果回灌自纠(防集成方工具永不 settle 拖死整轮:loading 永转 + stop 无效)。只对集成方注入工具生效(defineTool / actions / skill 工具工厂 / rag retriever);内置/MCP/委派与 conflict ask 挂起是设计内等待,豁免。默认 120s;0 = 关闭
   */
  toolTimeoutMs?: number;
  /** token 预算上限(累计 total_tokens 超过 → 停止 agent + emit BUDGET_EXCEEDED;需 capabilities.automation:true) */
  tokenBudget?: number;
  /** 单次 invoke 的 token 预算上限(opt-in,默认关):本次 agent 调用累计 total_tokens 超限 → 中断收口(observable emit + 友好文本,已完成部分保留);与 automation 全局 tokenBudget 正交 */
  roundTokenBudget?: number;
  /** 写驱动过期读失效(stale-read-invalidation,默认 true):单次 invoke 窗口内,本批成功写之后被击中路径的旧 read/query/search 结果替换为失效占位(防模型凭旧快照答状态/用错位索引)。false = 主/子一致关闭零变化 */
  staleReadInvalidation?: boolean;
  /** 时间预算 ms(从 agent 开始计时,超过 → 停止;需 capabilities.automation:true) */
  timeBudgetMs?: number;
  /** 无人值守错误恢复:致命错误(invoke 抛错)自动 restore_last_checkpoint + 重试次数(默认 1;防单点错误永久中断批量/长任务)。需 capabilities.automation:true */
  maxAutoRetries?: number;
  /** 同轮工具并发上限(默认 1 串行) */
  maxParallelTools?: number;
  /** 模型上下文窗口(token);顶层声明对 llm 实例场景也生效,缺省按 model 名查表。影响 offload 阈值与压缩触发 */
  contextWindow?: number;
  /** 模型最大输出(token);顶层声明对 llm 实例场景也生效,缺省按 model 名查表 */
  maxOutputTokens?: number;
  /** 子 agent 委派(默认开启;{ enabled: false } 关闭) */
  capabilities?: { dataOps?: boolean; fetch?: boolean; planning?: boolean; missionAnchor?: boolean; skills?: boolean; vfs?: boolean; summarization?: boolean; memory?: boolean; subagent?: boolean; verify?: boolean; domInspect?: boolean; inspectEnv?: boolean; draftWrite?: boolean; automation?: boolean; workingMemory?: boolean; focus?: boolean; contextInspector?: boolean; agentCompression?: boolean };/** tracing/skillHostScript/preferences/bulkGuard 已于 4.1.0 移除;残键静默忽略 */
  subagent?: { enabled?: boolean; allowedTools?: string[]; systemPrompt?: string; temperature?: number; maxTokens?: number; skills?: SkillSpec[]; llm?: LLMConfig | ChatModelLike; maxDepth?: number; maxParallel?: number; /** 单次委派总时长毫秒(默认 1800000=30min,2026-08-28 抬升;超时 abort 子流 + recoverable 回灌;0 = 不限制) */ timeoutMs?: number; thinkingMode?: 'simple' | 'deep' };
  /** 预声明子 agent 列表:每个用同主配置方式声明,自动生成 use_<id> 委派工具(与 spawn_agent 共存) */
  subagents?: SubagentConfig[];
  /** 自检:agent 返回前跑 check,不通过则 feedback 回灌自纠(默认关闭;需 capabilities.verify:true)。check 省略时默认 createWriteBackCheck 写后读回验证 */
  verify?: { enabled?: boolean; check?: VerifyCheck; maxAttempts?: number; adversarial?: boolean };
  /** 人工确认:工具调用前弹确认框,用户「允许/拒绝」后才执行(默认关闭,不传 = 不装) */
  approval?: ApprovalOptions;
  /** 主动征询(默认开启):装载 request_human_confirmation 工具,LLM 在不确定/多方案/高风险时主动征询;false 关闭(types-alignment 补漏) */
  humanConfirm?: boolean;
  /** 会话级 checkpoint 回滚(回到上次正常时)。默认关闭;传 true 或 { maxCheckpoints?, auto? } 开启 */
  checkpoint?: boolean | { maxCheckpoints?: number; auto?: boolean };
  /** MCP server 列表(连远程 server 动态注入其 tools;浏览器仅 http/sse/websocket) */
  mcp?: McpServerConfig[];
  /** 上下文压缩配置(false 关闭;默认 LLM 摘要,失败回退索引摘要)。含 promptSoftCapTokens(prompt 软上限:窗口 ≥320K 模型默认 160K,历史 token 超 min(window×ratio, softCap) 即提前压缩;传 0 显式关) */
  contextOptions?: any;
  /** 上下文压缩预设档位(默认 'auto'):auto / conservative / aggressive / complex(多步复杂任务/大 JSON);提供合理默认,contextOptions 细参可覆盖 */
  contextPreset?: 'auto' | 'conservative' | 'aggressive' | 'complex';
  /** 摘要压缩专用 LLM(BaseChatModel 实例或 LLMConfig);不传则默认用主 agent 模型(llm) */
  summaryLlm?: any;
  /** 标题生成 LLM(BaseChatModel 实例或 LLMConfig);不传则用 summaryLlm → 主 llm。首轮后自动生成会话标题(主旨) */
  titleLlm?: any;
  /** 自动生成会话标题(默认 true:首轮后调 LLM 生成主旨标题;false 关闭,用规则 deriveTitle 截取) */
  autoTitle?: boolean;
  /** 摘要 LLM 温度(默认 0.3) */
  summaryTemperature?: number;
  /** 摘要 LLM 输出上限(默认 1024) */
  summaryMaxTokens?: number;
  /** 摘要 LLM 超时毫秒(默认 15000;超时回退索引摘要) */
  summaryTimeoutMs?: number;
  /** 压缩决策(agentCompression)LLM 超时毫秒(默认 6000;不复用 summaryTimeoutMs 15s,两段叠加阻塞首响应) */
  decisionTimeoutMs?: number;
  /** 压缩决策 LLM 输出上限(默认 2048;避免继承 summaryLlm 1024 截断 JSON → safeParse 失败无谓降级) */
  decisionMaxTokens?: number;
  /**
   * SDK 事件回调:订阅常用时机(数据槽变化 / 消息更新 / 工具调用 / 流式文本 / 轮次 / 错误)。
   * UI 与 headless 模式均生效;用于外部联动(宿主页面响应式刷新、埋点、日志),替代轮询。
   * approval_request 不外发(UI 已处理)。
   */
  onEvent?: SdkEventHandler;
  /** 流式输出(默认 true);false 时等整段回复再显示 */
  streaming?: boolean;
  /** Dialog UI config (title/placeholder/drawer/drawerWidth/drawerHidden/inputRows/onClose grouped) */
  dialog?: DialogConfig;
}

/** Dialog UI config (grouped form, recommended) */
export interface DialogConfig {
  title?: string;
  placeholder?: string;
  drawer?: boolean;
  drawerWidth?: number | string;
  drawerHidden?: boolean;
  /** Input box rows (visible height); default 2 (2-row initial height, auto-expands up to max-height:100px). 1 = single row; >2 = taller. */
  inputRows?: number;
  onClose?: () => void;
  /** Built-in theme: 'dark' (default; dark purple palette from the Ark design spec) / 'light' (neutral light). Overridable via --cs-* on an ancestor. */
  theme?: 'light' | 'dark';
}

/** 会话级任务目标锚点(mission 中间件;capture 或 setMission;revive-mission-anchor Phase 1) */
/** 跨压缩工作记忆(workingMemory 中间件;经 augmentPrompt 每轮注入 system,天然跨压缩保留) */
export interface WorkingMemory {
  locatedPaths: string[];
  lastHashes: Record<string, string>;
}
export interface Mission {
  /** 一句话任务目标(必填) */
  goal: string;
  /** 完成标准(可选,集成方显式传入) */
  acceptanceCriteria?: string[];
  /** 来源 user 消息 index(自动 capture 时填) */
  sourceMessageIdx: number;
  /** capture/setMission 时间戳 */
  capturedAt: number;
  /** true=集成方显式 setMission;false=自动 capture */
  explicit: boolean;
}

/** 上下文聚焦焦点(focus 中间件;指定组件精修,path=jsonPath 锚点,聚焦后目标/视野/范围三层收敛) */
export interface Focus {
  /** jsonPath 锚点,如 `components.3`(setFocus 时经 getSchemaAtPath 校验在 schema 内才可聚焦) */
  path: string;
  /** 人类可读标签,如「导航栏」(注入目标提示 + ChatDialog chip 显示;可选) */
  label?: string;
}

export interface ChatSdk {
  /** 渲染对话框到 container(异步:含持久化恢复);ui:false 时仅 init agent(headless)。
   *  可选传 overrideContainer(HTMLElement | 选择器字符串)覆盖创建时 options.container —— 异步绑定:创建时可省略 container,mount 时才指定 */
  mount(overrideContainer?: HTMLElement | string): Promise<void>;
  /** 响应式消息数组(headless 模式自建 UI 读) */
  messages: AgentMessage[];
  unmount(): void;
  /** 抽屉模式隐藏:加 cs-hidden class,不卸载 vueApp/不 release agent —— 保留聊天历史与正在进行的生成进程;再 mount() 直接 show 恢复 */
  hide(): void;
  /** 抽屉模式显示:移除 cs-hidden class 恢复可见(配合 hide 使用;首次挂载用 mount) */
  show(): void;
  send(message: string, options?: { mission?: Partial<Mission>; maxAutoRetries?: number; /** 中断信号(fix-hang-and-feedback P1-4) */ signal?: AbortSignal; /** 附带图片(image-input-vision;需主模型多模态 vision 或 images.describe,否则拒绝 —— 不静默丢图) */ images?: AgentImage[] }): Promise<string>;
  switchSession(sessionId?: string): Promise<string>;
  /** 导出会话快照(ui-quick-wins Q2):{ formatVersion, exportedAt, sessionId, snapshot } 可复全 JSON;跨会话导出传 sessionId;storage 未开启抛错 */
  exportSession(sessionId?: string): Promise<Record<string, unknown>>;
  /** 导入会话快照副本(ui-quick-wins Q2):总是新 sessionId 不覆盖既有,不自动切换;坏 JSON/未知版本/缺 messages/超 6MB 抛错 */
  importSession(data: unknown): Promise<{ sessionId: string }>;
  /**
   * 新建/清空会话(同步;「清空对话」编程式入口):中止在途流 + 收口挂起冲突(keep_external)
   * + 重置全部内存态(messages/vfs/todos/memory/mission/workingMemory/focus/checkpoint/debugLogs)+ 换新 sessionId + emit session_restored。
   * storage 开启时同步新建持久会话;未开启时仅重置内存态(P1-8 修复后不再早退泄漏)。
   */
  resetSession(): void;
  /** 列出当前 agent 的所有历史会话(供「历史列表」UI;storage 未开启 → []) */
  listSessions(): Promise<SessionMeta[]>;
  /** 历史会话列表(响应式;switchSession/deleteSession/onClear/init 后自动 refresh;直接消费无需手动 listSessions/refresh/hook) */
  readonly sessions: Ref<SessionMeta[]>;
  /** 删除指定历史会话;不可删除当前会话(删当前请先 switchSession 切走);storage 未开启 → no-op + warn */
  deleteSession(sessionId: string): Promise<void>;
  /** 当前会话 id(switchSession/onClear 后实时反映;供历史列表高亮当前项) */
  readonly sessionId: string;
  stream: (messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal) => Promise<string>;
  /** 显式持久化当前轮(headless 用 sdk.stream 时需手动调:把 messages/vfs/todos 存 store;内置 useChat 经 onPersist 自动调。storage 未开启 → no-op) */
  afterRound(): void;
  /** 清除代码资产复用缓存(重新生成前调,强制子 agent 重新生成而非复用未提交工作副本) */
  clearCodeReuse(): void;
  /** 调试日志(LLM 请求/响应/工具调用/中间件/错误;switchSession/onClear 清空;供 DebugDrawer 或外部消费) */
  readonly debugLogs: Ref<DebugLog[]>;
  /** Agent 信息刷新 tick(setSkills/setData/setFocus 后 ++);传给 DebugDrawer watch 后重拉 inspect() 实时反映 */
  readonly infoTick: Ref<number>;
  /** 检视 agent 详细信息(tools/skills/data/middleware/todos) */
  inspect(): AgentInfo;
  /** 导出诊断报告 JSON 字符串(完整日志文件:debugLogs/messages/inspect/usage/conflict/主数据摘要聚合;复制交维护者排查;zod schema/apiKey 不入报告) */
  exportDiagnostics(): string;
  /** 读取最近一次上下文构成快照(每轮 wrapModelCall 覆盖;capabilities.contextInspector:false → undefined) */
  inspectContext(): ContextSnapshot | undefined;
  /** 读取当前任务目标锚点 mission(自动 capture 或 setMission;capabilities.missionAnchor:false → undefined) */
  getMission(): Mission | undefined;
  /** 显式设置/覆盖 mission(传 {goal} 重设;传 {goal,criteria} 整体替换;传 {} 清空);capabilities 关时 warn 不抛 */
  setMission(mission: Partial<Mission>): void;
  /** 读取当前聚焦焦点(兼容:返回首个;未聚焦 / capabilities.focus:false → undefined) */
  getFocus(): Focus | undefined;
  /** 读取全部聚焦焦点(multi-focus;空数组=未聚焦;capabilities.focus:false → []) */
  getFocuses(): Focus[];
  /** 设置聚焦焦点(替换全部;path 经 getSchemaAtPath 校验);非法 path 返回 {ok:false,error};capabilities.focus:false 返回 {ok:false} 不抛 */
  setFocus(focus: Focus): { ok: boolean; error?: string };
  /** 追加聚焦焦点(multi-focus 累积,去重 by path;校验同 setFocus);capabilities.focus:false 返回 {ok:false} */
  addFocus(focus: Focus): { ok: boolean; error?: string };
  /** 移除单个聚焦焦点(by path);capabilities.focus:false → no-op */
  removeFocus(path: string): void;
  /** 清除全部聚焦焦点(退出精修模式,恢复全量可操作范围) */
  clearFocus(): void;
  /** 回退到最近一次正常 checkpoint(整体还原对话历史 + 主数据 + vfs + todos);需开启 checkpoint,无可用返回 false */
  restoreLastCheckpoint(): boolean;
  /** 列出可用 checkpoint(回退点);需开启 checkpoint,未开启返回空数组 */
  listCheckpoints(): CheckpointMeta[];
  /**
   * 批处理(automation):逐任务跑 agent,每任务前自动 checkpoint,任务间错误隔离(单任务失败记 error 不中断整批)。
   * 适合无人值守批量操作(批量生成/改一批页面)。不经 UI 排队(直接 invoke);返回每个任务结果(成功 reply / 失败 error)。
   * 配合 capabilities.automation + checkpoint 使用。
   */
  batch(tasks: string[], onProgress?: (p: BatchProgress) => void, signal?: AbortSignal): Promise<BatchResult[]>;
  /** 运行时订阅 SDK 事件(可多个监听器,返回取消函数);与构造时 onEvent 互补 */
  hook(handler: SdkEventHandler): () => void;
  /** 运行时替换主数据配置(如页面切换、schema 变更);立即对数据工具生效,无需重建 agent。需开启 dataOps */
  setData(config: DataConfig): void;
  /** 读取当前主数据配置;dataOps 关闭时返回 undefined */
  getData(): DataConfig | undefined;
  /**
   * 运行时替换整个 skill 列表(同名 skill 覆盖更新)。立即生效:system prompt 的 skill 索引段下轮重渲染反映新 skill;
   * 清空 skill 全文缓存与本轮已加载记录,下次 load_skill 重新取最新全文(含 vfs doc)。需开启 skills(默认开)
   */
  setSkills(skills: SkillSpec[]): void;
  /** 添加用户创建的 skill(持久化,跨刷新恢复;同名覆盖)。需开启 skills(默认开) */
  addSkill(skill: SkillSpec): void;
  /** 删除用户创建的 skill(仅删用户创建的,不删集成方 initialSkills)。返回是否删除成功 */
  removeSkill(name: string): boolean;
  /** 列出用户创建的 skill 名(仅用户创建的,不含集成方 initialSkills) */
  listUserSkills(): string[];
  /** 读取用户创建的 skill 详情(返回 {name, description, content};不存在返回 undefined) */
  getUserSkill(name: string): { name: string; description: string; content: string } | undefined;
  /**
   * 清 skill 全文缓存(动态 skill 内容变化时主动失效)。不传 name 清全部;传 name 清指定。
   * 下次 load_skill 重新 getContent/readSkillDoc 取最新。需开启 skills(默认开)
   */
  invalidateSkillCache(name?: string): void;
  /** 导出主数据 bind 的深拷贝(备份/迁移用);dataOps 关闭或无 data 返回 null */
  exportData(): any;
  /** 导入数据整体替换主数据 bind(就地还原,保留 reactive 引用);默认经 schema 校验,不合法返回 {ok:false,error};opts.validate:false 跳过校验,opts.emit:false 不发 data_change */
  importData(json: any, opts?: { validate?: boolean; emit?: boolean }): { ok: boolean; error?: string };
  /** 往 vfs 异步注入/更新文件(RAG 文档池 / HTML 代码等);content 字符串直存,对象 JSON.stringify。与 vfs_write 工具一致语义(集成方侧命令式入口) */
  vfsWrite(path: string, content: string | object): void;
  /** 只读读取 vfs 文件内容(文件不存在返 undefined)。与 vfs_read 工具一致语义,命令式入口(不经工具调用/无工具开销) */
  vfsRead(path: string): string | undefined;
  /** 创建/注册受保护资源(返回 handle);需配 data.resources + vfsStore,否则抛错 */
  createResource(path: string, value?: unknown): string;
  /** 取受保护资源真值(by path 或 handle);不存在返 undefined */
  getResource(pathOrHandle: string): { path: string; mode: string; value: unknown; handle: string } | undefined;
  /** 更新 verbatim 受保护资源真值(同步 bind+标脏);freeze 抛错 */
  updateResource(path: string, value: unknown): void;
  /** 删除/释放单个受保护资源(by path 或 handle);返是否存在过 */
  deleteResource(pathOrHandle: string): boolean;
  /** 列出全部受保护资源(path/mode/handle/bytes) */
  listResources(): { path: string; mode: string; handle: string; bytes: number }[];
  /** 批量释放受保护资源;传 paths 释放指定,未传释放全部 */
  releaseResources(paths?: string[]): void;
  /** 累计 token 用量(每轮 LLM 调用累加;prompt/completion/total_tokens)。无调用时为 0 */
  usage: TokenUsage;
  /** 乐观锁冲突挂起状态(响应式 ref;无冲突为 null,有冲突时 UI 据此渲染冲突对话框)。headless 集成方可 watch 自建 UI */
  pendingConflict: Ref<PendingConflict | null>;
  /** 冲突解决:用户点「保留外部」(keep_external)/「强制覆盖」(overwrite)/「回退」(restore) → 收口挂起的 conflict,被挂起的工具调用继续 */
  resolveConflict(action: ConflictResolution['action']): void;
  /** 运行时替换用户工具集(内置工具不动);立即 rebind + infoTick 刷新 */
  setTools(tools: any[]): void;
  /** 运行时追加用户工具(去重 by name);立即生效 */
  addTool(tool: any): void;
  /** 运行时移除用户工具(by name;内置不动);返回是否移除成功 */
  removeTool(name: string): boolean;
  /** 运行时切换 LLM(BaseChatModel 或 LLMConfig);rebind + 重解析能力 + infoTick */
  setLlm(llm: ChatModelLike | LLMConfig): void;
  /** 运行时更新 memory;支持 string 与同步/异步函数(异步函数后台求值,下一轮 beforeAgent 前就绪) */
  setMemory(source: string | (() => string | Promise<string>)): void;
  /** 重新求值当前 memory 函数 source(RAG 文档更新后强制刷新);返回最新文本 */
  refreshMemory(): Promise<string>;
  /** 运行时替换预声明子 agent 列表(重新生成委派工具 + rebind);需创建时配 subagents:[] */
  setSubagents(configs: SubagentConfig[]): void;
  /** 运行时追加预声明子 agent(id 重复 warn 跳过);需创建时配 subagents:[] */
  addSubagent(config: SubagentConfig): void;
  /** 运行时移除预声明子 agent(by id);返回是否移除成功;需创建时配 subagents:[] */
  removeSubagent(id: string): boolean;
  /** 运行中子 agent 列表(观察层;空=无在跑;capabilities.subagent 关闭 → 空数组) */
  getActiveSubagents(): SubagentRunState[];
  /** 子 agent 委派历史(观察层 getter;LRU≤20,最新在前) */
  readonly subagentHistory: SubagentRunState[];
}

/** 乐观锁冲突挂起(dataOps 写入时 expectedHash 不匹配,挂起等用户决定) */
export interface PendingConflict {
  id: number;
  op: 'set' | 'edit' | 'delete';
  agentValue?: unknown;
  currentValue: unknown;
  currentHash: string;
  expectedHash: string;
  snapshotId: number;
  resolve: (r: ConflictResolution) => void;
  /** conflictPolicy 自动裁决标记:非 ask 策略时该冲突未挂起、已按此 action 立即收口;仅随 conflict 事件外发供观测 */
  autoResolved?: 'overwrite' | 'keep_external';
}

/** 乐观锁冲突裁决策略:ask=挂起等人工(默认)| overwrite=agent 强制覆盖 | keep_external=保留外部修改 */
export type ConflictPolicy = 'ask' | 'overwrite' | 'keep_external';

/** 冲突解决决定:保留外部修改 / 强制覆盖 / 回退到写前快照 */
export type ConflictResolution =
  | { action: 'keep_external' }
  | { action: 'overwrite' }
  | { action: 'restore' };

/** 乐观锁冲突信息(dataOps onConflict 回调参数) */
export interface ConflictInfo {
  op: 'set' | 'edit' | 'delete';
  agentValue?: unknown;
  currentValue: unknown;
  currentHash: string;
  expectedHash: string;
  snapshotId: number;
}

export declare function createChatSdk(options: ChatSdkOptions): ChatSdk;
// ============ system prompt 构建(promptBuilder,refactor-module-extraction 从 createChatSdk 抽离)============
/** 默认 systemPrompt(用户未传 systemPrompt 时用);含身份 + 能力概述 + 可靠写入规则 */
export declare const DEFAULT_SYSTEM_PROMPT: string;
/** 内置默认 systemPrompt 英文版(dialog.locale:'en-US' 时 buildSystemPrompt 自动使用) */
export declare const DEFAULT_SYSTEM_PROMPT_EN: string;
/** 拼接「可操作数据」段(从 data schema .describe() 自动提取注入) */
export declare function buildDataPrompt(data: DataConfig | undefined, schemaHint?: SchemaHintOptions): string;
/**
 * 统一 systemPrompt base 段入口:处理 appendReliableWriteRules 分支 + '---' 分割线。
 * 传 systemPrompt 默认追加 reliableWriteRules(设 appendReliableWriteRules:false 关闭);不传用 DEFAULT_SYSTEM_PROMPT(已内置)。纯函数。
 */
export declare function buildSystemPrompt(opts: { systemPrompt?: string; appendReliableWriteRules?: boolean }): string;
export declare function defineTool(opts: {
  name: string;
  description: string;
  schema: any;
  handler: (args: any) => unknown | Promise<unknown>;
  writeCapable?: boolean | ((args: Record<string, unknown>) => boolean);
}): any;
export declare function createDataOps(config: DataConfig, opts?: DataOpsOptions): any[];
/** 整体 set 写入纯函数:schema 校验 + 快照 + merge/替换 + audit。write(set) / draft_commit 共用。返回 {ok,hash,data} 或 {ok:false,error} */
export declare function commitSetToBind(args: { bindRef: unknown; value: unknown; schema: any; allowKeys: string[] | null; snapshots: any[]; maxSnapshots: number; audit: (e: any) => void; dryRun?: boolean; op?: 'set' | 'draft_commit'; snapshotLabel?: string }): { ok: true; hash: string; data: unknown; notices: string[] } | { ok: false; error: string };
export interface LocalWriteBack {
  op: 'set' | 'remove' | 'move' | 'mergeKeys' | 'appendElems';
  jp: string;
  value?: unknown;
  toPath?: string;
  entries?: [string, unknown][];
  elems?: unknown[];
}
export interface LocalValidationPlan {
  ok: boolean;
  error?: string;
  writeBacks: LocalWriteBack[];
  notices: string[];
}
export declare function validateRootValueLocally(args: { schema: any; allowKeys: string[] | null; value: unknown; bindRef: unknown }): { ok: true; assembly: unknown; wholeParsed: Record<string, unknown> | null; notices: string[] } | { ok: false; error: string; notices: string[] };
export declare function validateWriteLocally(args: { schema: any; bindRef: unknown; clone: unknown; patches: { op?: string; jsonPath?: string; value?: unknown }[]; schemaErrorMode?: 'zod' | 'schema_invalid'; appendCaptures: { jp: string; elems: unknown[] }[]; moveCaptures: { jp: string; toPath: string; elem: unknown }[]; valueAt?: (jp: string) => unknown }): LocalValidationPlan;
export declare function applyPatchesToBind(args: { bindRef: unknown; patches: { op?: string; jsonPath?: string; value?: unknown }[]; schema: any; allowKeys: string[] | null; snapshots: any[]; maxSnapshots: number; markDataDirty?: () => void; schemaErrorMode?: 'zod' | 'schema_invalid'; snapshotLabel?: string; dryRun?: boolean; internalAfterWrite?: (bind: any, before: any) => void; protectedCtx?: unknown }): { ok: true; applied: { op: string; jp: string; value: unknown }[]; clone: unknown; notices: string[] } | { ok: false; error: string };
// ============ 通用 JSON 操作纯函数(jsonUtils,refactor-module-extraction 从 dataOps 抽离;零依赖,经 ./query subpath 按需引入)============
export type EditOp = 'set' | 'remove' | 'merge' | 'append';
export declare const UNSAFE_KEYS: Set<string>;
export declare function isUnsafePath(path: string): boolean;
export declare function safeMerge(target: Record<string, any>, src: unknown): void;
export declare function getByPath(obj: unknown, path: string): unknown;
export declare function setByPath(obj: unknown, path: string, value: unknown): void;
export declare function deleteByPath(obj: unknown, path: string): boolean;
export declare function deepClone<T>(v: T): T;
export declare function maybeParseValue(v: unknown): { parsed?: unknown; parseError?: unknown };
export declare function projectFields(obj: unknown, fields: string[]): unknown;
export declare function limitDepth(obj: unknown, depth: number): unknown;
export declare function safeStringify(value: unknown, maxLen?: number): string;
export declare function hashValue(value: unknown, ignoreKeys?: ReadonlySet<string>): string;
export declare function watchFieldsHash(value: unknown, watchKeys: ReadonlySet<string>): string;
export declare function applyPatchToClone(clone: any, op: EditOp, jsonPath: string, value: unknown): string | null;
export declare function applyPatchToLive(bind: any, op: EditOp, jsonPath: string, value: unknown): void;
export declare function restoreLive(bind: any, snapshotVal: unknown): void;
export declare function restoreInPlace(live: Record<string, unknown> | unknown[], snapshotVal: unknown): void;
/** 深度差异对比(对象/数组递归,叶子差异),返回 {path, from, to}[];供 diff_data / verify 自纠 / 审计复用 */
export declare function diffObjects(a: unknown, b: unknown, prefix?: string): { path: string; from: unknown; to: unknown }[];
/** 数组元素移动(同数组重排/跨数组移动,一步原子;write patch op 'move' 的内核纯函数) */
export declare function moveByPath(root: any, jsonPath: string, toPath: unknown): string | null;
/** 收集「本次新增却被 schema strip 静默剥离」的键路径(before 已有/宿主自管键不标;数组原样元素整体跳过防 move/remove 位移误判) */
export declare function findStrippedKeys(before: unknown, after: unknown, parsed: unknown, prefix?: string): string[];
// ============ schema 白名单投影纯函数(schemaUtils,refactor-module-extraction 从 dataOps 抽离)============
export declare function getSchemaTopKeys(schema: any): string[] | null;
export declare function isPathAllowed(jsonPath: string, schema: any | null, allowKeys: string[] | null): boolean;
export declare function unwrapSchema(schema: any): any;
export declare function getSchemaAtPath(schema: any, jsonPath: string): any | null;
export declare function projectBySchemaDeep(obj: unknown, schema: any | null): unknown;
export declare function projectBySchema(obj: unknown, allowKeys: string[] | null): unknown;
// ============ path-scoped-validation(write 校验局部化:union-tolerant 路径解析 + 目标路径局部校验)============
export type PathSchemaResolution =
  | { kind: 'schemas'; schemas: any[] }
  | { kind: 'open' }
  | { kind: 'missing' };
export interface ValidateAtPathResult {
  ok: boolean;
  data?: unknown;
  issues?: unknown[];
  resolution: 'schemas' | 'open' | 'missing';
}
export declare function resolveSchemaPath(schema: any, jsonPath: string): PathSchemaResolution;
export declare function validateAtPath(schema: any, jsonPath: string, value: unknown): ValidateAtPathResult;
export declare function schemaHasRefinement(schemaRaw: any): boolean;
export declare function arrayMinLength(schemaRaw: any): number | null;
export declare function elementSchemaCandidates(schemas: any[]): any[];
// ============ schema 约束结构化提取(expose-schema-constraints;供 systemPrompt「可操作数据」段 / read 概览 / schema_data 工具)============
export interface SchemaNodeDesc {
  type: string;
  constraints?: {
    minLength?: number; maxLength?: number; length?: number;
    min?: number; max?: number; int?: boolean;
    format?: string | string[];
    values?: readonly (string | number)[];
    value?: unknown;
    item?: SchemaNodeDesc;
    shape?: Record<string, SchemaNodeDesc>;
    anyOf?: SchemaNodeDesc[];
    valueType?: SchemaNodeDesc;
  };
  optional?: boolean;
  nullable?: boolean;
  default?: unknown;
  description?: string;
}
/** 结构化提取单个 zod 节点的约束(type + 关键约束 + optional/default/nullable;zod 4 `_def`/`_zod.def` 读取) */
export declare function describeSchemaNode(schema: any): SchemaNodeDesc;
/** 把标量约束格式化为括号内短串(min/max/enum/format 等;shape/item/anyOf 不渲染) */
export declare function formatConstraints(c: NonNullable<SchemaNodeDesc['constraints']>): string;
/** 渲染单行字段标注 `- key (Type?)[约束]: description` */
export declare function renderSchemaHint(key: string, desc: SchemaNodeDesc): string;
/** 渲染 schema 顶层字段约束总览(非 object fallback 根节点;供 extractSchemaHint + read 概览复用) */
export declare function renderSchemaOverview(schema: any): string;
/** 渲染 schema 顶层字段浅概览(分层模式:只 key+type+desc,不带约束/不递归;大 schema 用,体积降) */
export declare function renderSchemaShallow(schema: any): string;
/** extractSchemaHint 分层阈值配置(默认 maxKeys=15/maxChars=4000;超则转顶层概览) */
export interface SchemaHintOptions { maxKeys?: number; maxChars?: number }
// ============ 上下文索引纯函数(contextIndex,refactor-module-extraction 期二 从 useContextManager 抽离)============
export declare const STOP_WORDS: Set<string>;
export declare function tokenize(text: string): string[];
export declare function estimateMessageTokens(m: any): number;
export declare function estimateRoundTokens(r: any): number;
export declare function indexSummarize(older: any[], preserve?: Set<string>): string;
export declare function recallRounds(older: any[], query: string, topK: number): any[];
export declare function shouldTriggerCompression(rounds: any[], config: { contextWindow?: number; summaryThresholdRatio?: number; summaryThresholdRounds?: number; promptSoftCapTokens?: number }): boolean;
/** 解析有效 prompt 软上限:显式 >0 用该值 / 显式 0 关(Infinity) / 未传且窗口 ≥320K 默认 160K / 其余不参与 */
export declare function resolvePromptSoftCap(contextWindow?: number, promptSoftCapTokens?: number): number;
/** softCap 默认参与门槛(窗口 ≥320K) */
export declare const SOFT_CAP_MIN_WINDOW: number;
/** 默认 prompt 软上限(160K) */
export declare const DEFAULT_PROMPT_SOFT_CAP: number;
// ============ LLM 解析(llmResolver,refactor-module-extraction 期二 从 createChatSdk 抽离)============
export declare function isChatModel(v: unknown): boolean;
export declare function resolveLlm(options: any): { modelCaps: any; summaryLlmInvoke: ((prompt: string) => Promise<string>) | undefined };
export declare function deriveTitle(msgs: AgentMessage[]): string | undefined;
// ============ 乐观锁冲突管理器(conflictManager,refactor-module-extraction 期二 从 createChatSdk 抽离)============
export interface ConflictManager {
  pendingConflict: Ref<any | null>;
  set(info: any): Promise<any>;
  resolve(action: any): void;
}
export declare function createConflictManager(getEmit?: () => (((e: any) => void) | undefined), getPolicy?: () => ConflictPolicy): ConflictManager;

/** 诊断报告 · 主数据摘要(替代 dump 全量 bind) */
export interface DiagnosticsDataSummary {
  description?: string;
  /** bind 顶层 key 列表(数组 bind → []) */
  topKeys: string[];
  /** bind JSON 序列化字符数(-1 = 序列化失败) */
  approxBytes: number;
}
/** 诊断报告聚合输入(sdk.exportDiagnostics 的纯函数底座) */
export interface DiagnosticsInput {
  debugLogs?: DebugLog[];
  messages?: Array<Record<string, unknown>>;
  info?: AgentInfo | null;
  usage?: Record<string, number> | null;
  pendingConflict?: unknown;
  sessionId?: string;
  dataSummary?: DiagnosticsDataSummary | null;
  extra?: Record<string, unknown>;
}
/** 聚合诊断报告对象(JSON 可序列化;字段顺序即排查动线) */
export declare function buildDiagnosticsReport(input: DiagnosticsInput): Record<string, unknown>;
/** 序列化诊断报告为 JSON 字符串(超总长阈值从最旧 debugLogs 丢弃并留痕) */
export declare function stringifyDiagnosticsReport(report: Record<string, unknown>): string;
/** url 查询串凭据键打码(key/token/secret/password/signature 键值 → ***) */
export declare function maskUrlCredentials(url: string): string;
// ============ 配置解析 + 事件系统(optionsResolver/events,refactor-module-extraction 期三)============
// capabilities 能力开关注册表 + 单一解析(p2-refactor 子项 4:消除 11/17 开关 ===true/!==false 混)
export interface Capability { name: string; defaultOn: boolean; requires?: readonly string[] }
export type CapabilityFlags = Partial<Record<string, boolean>>;
export type ResolvedCapabilities = Record<string, boolean>;
export declare const CAPABILITIES: readonly Capability[];
/** 已列入移除计划的配置键(config-surface-pruning;warn 一版后移除) */
/** 单一解析:集成方原始 caps(Partial)→ 全量 boolean(opt-out 默认开 !==false / opt-in 默认关 ===true;requires 依赖未满足强制关)。参数宽松 Record<string,unknown>(兼容含 subagents 等非 boolean 字段的 caps 对象;只读已知 capability 的 boolean) */
export declare function resolveCapabilities(caps?: Record<string, unknown>): ResolvedCapabilities;
export declare function resolveStorage(storage: any): any | null;
export declare function resolveDialogConfig(opts: any): any;
export interface SdkEvents {
  listeners: Set<(e: any) => void>;
  emit: (e: any) => void;
  hook(handler: (e: any) => void): () => void;
}
export declare function createSdkEvents(onEvent?: (e: any) => void): SdkEvents;
export declare function selectBuiltinTools(caps: { dataOps?: boolean; fetch?: boolean; domInspect?: boolean; inspectEnv?: boolean } | undefined, dataOps: any[], fetchDocs: any[], dom?: any[], inspect?: any[]): any[];
export declare function createUsageHintsMiddleware(caps: { planning?: boolean; dataOps?: boolean; subagent?: boolean; humanConfirm?: boolean; inspectEnv?: boolean; domInspect?: boolean; draftWrite?: boolean; focus?: boolean; subagents?: { id: string; description: string; temperature?: number }[] } | undefined, hasDataOps: boolean, budget?: { promptSoftCap?: number }): any;
export declare const fetchDocTools: any[];
/** DOM 读取工具 get_dom(随 capabilities.domInspect 装配,opt-in) */
export declare const domTools: any[];
export declare const domToolsStatic: any[];
/** 环境探查工具 inspect_env(随 capabilities.inspectEnv 默认装配,默认开;排查 window/location/调试变量) */
export declare const inspectTools: any[];
/** 单个 inspect_env 工具(inspectTools 数组的元素) */
export declare const inspectEnvTool: any;
/** 纯函数:安全序列化任意值(跳过 function/DOM,防循环引用,截断)—— inspect_env 读 window[key] 时用 */
export declare function safeSerialize(value: unknown, depth?: number, maxLen?: number, seen?: WeakSet<object>): unknown;
/** 环境摘要(location/navigator/viewport/document);inspect_env 无参时返回,可传 win 注入测试 */
export declare function getEnvSummary(win?: Window & typeof globalThis): Record<string, unknown>;
export declare const getDomTool: any;
/** 纯函数:DOM Element → 结构化 DomNode(可单测,与浏览器解耦) */
export declare function domToStructure(node: Element | null, opts: { depth: number; attrs?: string[]; includeText?: boolean }): DomNode | null;
/** 把集成方注册的 actions 转成命名 tool 数组(每个 action 一个 tool) */
export declare function actionsToTools(actions: ActionMap): any[];
export declare function actionsToInspectInfo(actions: ActionMap): Record<string, { description: string; hasParams: boolean }>;
export interface DomNode { tag: string; attrs: Record<string, string>; text?: string; children?: DomNode[]; childCount?: number }
export interface DomReadOptions { depth: number; attrs?: string[]; includeText?: boolean }

// ============ DOM 检视工具族(dom-inspect skill 按需注入;3.24)============
/** 计算样式常用预设(dom_info 不传 styles 时;~30 项排障高频) */
export declare const DEFAULT_COMPUTED_STYLES: string[];
/** 搜索命中项 */
export interface DomSearchHit { selector: string; tag: string; text: string }
/** 单元素检视信息(内容/计算样式/几何/伪元素/事件三源) */
export interface DomElementInfo {
  selector: string;
  tag: string;
  attrs: Record<string, string>;
  text?: string;
  textAll?: string;
  html?: string;
  rect?: { x: number; y: number; width: number; height: number };
  styles?: Record<string, string>;
  pseudoStyles?: { before?: Record<string, string>; after?: Record<string, string> };
  events?: { inline: { type: string; snippet: string }[]; vue: string[]; captured: string[] };
}
export interface ElementInfoOptions {
  styles?: string[];
  includeHtml?: boolean;
  htmlLimit?: number;
  includeEvents?: boolean;
  includeRect?: boolean;
  pseudo?: boolean;
  getComputedStyle?: (el: Element, pseudoElt?: string | null) => Record<string, string> | CSSStyleDeclaration;
}
/** 搜索元素:selector 模式(querySelectorAll)或 text 模式(textContent 包含,叶子优先剔除祖先容器) */
export declare function searchDom(root: ParentNode | null, query: string, opts?: { mode?: 'selector' | 'text'; limit?: number }): { hits: DomSearchHit[]; total: number; truncated: boolean };
/** Element → 结构化检视信息(纯函数;gcs 可注入供 node 测试) */
export declare function getElementInfo(el: Element | null, opts?: ElementInfoOptions): DomElementInfo | null;
/** 元素 CSS 路径(tag#id.tag:nth-of-type 逐级向上;有 id 短路) */
export declare function buildCssPath(el: Element, maxDepth?: number): string;
/** 安装 addEventListener 记录器(幂等;仅记录安装后注册的监听) */
export declare function ensureDomListenerRecorder(): void;
/** 读记录器中该 target 的监听类型 */
export declare function getRecordedListeners(el: EventTarget): string[];
/** DOM 检视工具(dom_search):选择器/文本双模检索 */
export declare const domSearchTool: any;
/** DOM 检视工具(dom_info):单元素内容/计算样式/事件绑定三源/几何 */
export declare const domInfoTool: any;
/** DOM 检视 skill(capabilities.domInspect 时并入 skills;load_skill 后注入 dom_search/dom_info,不占常驻 schema) */
export declare const domInspectSkill: SkillSpec;

export declare const fetchTools: any[];
export declare function defineDataToolset(config: DataConfig, opts?: DataOpsOptions): any[];
export declare function defineSkill(spec: SkillSpec): SkillSpec;
/** createAgent 选项(ReAct 循环 + 中间件 harness;createChatSdk 之下的层,集成方可直接用;E1 API 面收口) */
export interface CreateAgentOptions {
  /** 预构造的 LLM 实例(任意 provider);提供则优先于 apiKey/model 配置 */
  llm?: import('@langchain/core/language_models/chat_models').BaseChatModel;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 集成方显式声明模型上下文窗口(token);缺省按 model 名查表,再缺省 32K。影响 offload 阈值与压缩触发 */
  contextWindow?: number;
  /** 集成方显式声明模型最大输出(token);缺省按 model 名查表,再缺省 4K。maxTokens 未传时作其缺省 */
  maxOutputTokens?: number;
  /** 透传 modelKwargs:额外请求 body 参数(如 deepseek thinking)。仅按配置构造时生效 */
  extraBody?: Record<string, any>;
  /** 透传 configuration 额外字段(headers/timeout/customFetch),与 baseUrl 合并。仅按配置构造时生效 */
  extraConfig?: Record<string, any>;
  systemPrompt?: string;
  /** 用户自定义工具(与中间件贡献的工具合并) */
  tools?: import('@langchain/core/tools').StructuredToolInterface[];
  /** 中间件栈(顺序:内置在前,用户在后) */
  middleware?: Middleware[];
  maxToolRounds?: number;
  /** 会话是否具备子 agent 委派能力(轮次预算提醒 70% 档按此感知;false 不点名 spawn_agent 等不存在的工具) */
  hasSubagent?: boolean;
  /** 循环总迭代硬上限(防自纠死循环;默认 max(maxToolRounds*3, 30)) */
  maxIterations?: number;
  /** 模型调用失败自动重试次数(默认 2;网络/429/5xx 重试,4xx 与 abort 不重试) */
  maxRetries?: number;
  /** 重试退避基数 ms(默认 500,第 n 次重试等待 = base*2^n + jitter) */
  retryDelayMs?: number;
  /** LLM 流停滞看门狗:chunk 间隔(含等首个)超此 ms → 中断抛错。默认 90s;0 = 关闭 */
  stallMs?: number;
  /** 单次模型调用流总时长上限(防空转帧黑洞)。默认 1800s(2026-08-28 抬升:100K+ 输出长生成需 20min+);0 = 关闭 */
  streamMaxMs?: number;
  /** per-tool 看门狗:单工具执行超此 ms → recoverable 错误回灌自纠。只对集成方注入工具生效(内置/委派/冲突挂起豁免);默认 120s;0 = 关闭 */
  toolTimeoutMs?: number;
  /** 同轮多个工具调用的并发上限(默认 1 = 串行);>1 时并发执行 */
  maxParallelTools?: number;
  /** beforeReturn 自纠上限(默认 0 = 关闭,纯放行);>0 时 agent 返回前跑 beforeReturn 钩子 */
  maxVerifyAttempts?: number;
  /** 单次 invoke 的 token 预算上限(0=关;超限 → 中断收口 observable,已完成部分保留) */
  roundTokenBudget?: number;
  /** 日志下沉:每条 debugLog 产生时回调(子 agent 经此把日志转发到主 debugLogs) */
  onLog?: (entry: DebugLog) => void;
  /** 子 agent 标记(子栈门禁据此豁免:子纯文本收口是正常形态) */
  __pgIsSubagent?: boolean;
  /** LLM 运行时切换回调(setLlm 后触发,供重解析模型能力 contextWindow/maxOutputTokens) */
  onLlmChange?: (newLlm: import('@langchain/core/language_models/chat_models').BaseChatModel) => void;
  /** 显式声明主模型是否多模态识图(声明 > 查表 > 缺省 false) */
  vision?: boolean;
  /** content parts 协议形态(默认 'openai' LangChain 标准多模态格式;'anthropic' 原生 image block) */
  imageContentFormat?: 'openai' | 'anthropic';
  /** 写驱动过期读失效(默认 true);false = 主/子一致关闭 */
  staleReadInvalidation?: boolean;
  debug?: boolean;
}
/** createAgent 返回实例(headless/高级集成直接驱动的面) */
export interface AgentInstance {
  /** 单次对话 invoke(完整 ReAct 循环,返回最终文本) */
  invoke(messages: AgentMessage[], signal?: AbortSignal, onEvent?: StreamHandler): Promise<string>;
  /** 流式对话(事件逐个 onEvent,返回最终文本) */
  stream(messages: AgentMessage[], onEvent: StreamHandler, signal?: AbortSignal): Promise<string>;
  /** 运行态快照(messages/todos/files/mission/focuses 等) */
  getState(): HarnessState;
  /** 全部工具(getter:setTools 后重赋值,始终取最新) */
  readonly allTools: import('@langchain/core/tools').StructuredToolInterface[];
  /** stale-read-invalidation 会话累计失效数 */
  getStaleReadsInvalidated(): number;
  /** 模型调用重试会话累计(环境故障 vs SDK 回归的第一判据) */
  getLlmRetries(): number;
  getLlmCallFailures(): number;
  /** 会话切换/重置时清零(stale-read + 重试/终败三计数) */
  resetSessionCounters(): void;
  /** 运行时重设用户工具(与中间件贡献工具合并) */
  setTools(userTools: import('@langchain/core/tools').StructuredToolInterface[]): void;
  /** 运行时切换 LLM 实例(替换 + rebind + onLlmChange 回调;新模型不支持 tool calling 时退裸 llm 不崩) */
  setLlm(newLlm: import('@langchain/core/language_models/chat_models').BaseChatModel): void;
  /** setLlm 后回灌模型能力(contextWindow/maxOutputTokens) */
  setModelCaps(newCaps: ModelCaps): void;
  /** 调试日志(响应式;FIFO ≤300,单条体积守卫) */
  debugLogs: Ref<DebugLog[]>;
  /** 内部权威拼装的最终 system prompt(base + Σ augmentPrompt,单一真相源) */
  getEffectiveSystemPrompt(): string;
}
export declare function createAgent(options: CreateAgentOptions): AgentInstance;
/** 检测模型把工具调用写成文本(伪 XML/标签)而非标准 tool_calls 的异常格式;主循环据此回灌 feedback 自纠 */
export declare function detectGarbledToolCall(content: string): boolean;
/** 剥离 garbled 工具调用文本,只保留首个强守卫标记出现前的正常 prose(wrap-up/重试耗尽路径防 DSML 原文当结论返回) */
export declare function sanitizeGarbledContent(content: string): string;
/** 检测过程性收口(短文本 + 过渡模式如「我先看看…稍后委派」+ 无完成动词)—— createAgent 据此有界回灌(≤2) */
export declare function detectTransitionalReply(content: string): boolean;
/** 子 agent LLM 配置(createSubagentMiddleware/子 agent 走 LLMConfig 构造时的模型面) */
export interface SubagentLlmConfig {
  apiKey: string;
  /** provider 透传:缺省 'openai';'anthropic' 子 agent 同走 Claude 原生协议(动态 import 异步构造) */
  provider?: 'openai' | 'anthropic';
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 透传 openai configuration 额外字段(headers/fetch 等;子 agent 兜底构造时同主 LLM 生效) */
  extraConfig?: Record<string, any>;
  /** 透传 modelKwargs(如 deepseek thinking);子 agent 兜底构造时同主 LLM 生效 */
  extraBody?: Record<string, any>;
  /** Anthropic prompt caching(provider:'anthropic' 时经构造透传生效) */
  cacheControl?: boolean | '5m' | '1h';
  /** Anthropic extended thinking(provider:'anthropic');通常不手配 —— 用 thinkingMode:'deep' 自动注入 */
  thinking?: { type: 'enabled'; budget_tokens: number };
}
/** createSubagentMiddleware 选项(spawn_agent 的运行时覆盖参数是 spawn 工具 zod args,非此类型) */
export interface SubagentOptions {
  /** 主 agent 的 LLM(配置对象或预构造实例,子 agent 复用) */
  llm: SubagentLlmConfig | import('@langchain/core/language_models/chat_models').BaseChatModel;
  /** 主 agent 全部工具(子 agent 按白名单筛选只读子集);支持 getter:setTools 动态加的工具对子 agent 立即可见 */
  allTools: import('@langchain/core/tools').StructuredToolInterface[] | (() => import('@langchain/core/tools').StructuredToolInterface[]);
  /** 子 agent 额外可用的工具名(默认仅只读主数据 + fetch) */
  allowedTools?: string[];
  /** 子 agent 默认身份(spawn 运行时的 role 优先;都缺省用兜底) */
  systemPrompt?: string;
  /** 子 agent 温度(仅 llm 配置对象时生效;覆盖主 llm 温度) */
  temperature?: number;
  /** 子 agent maxTokens(仅 llm 配置对象时生效;覆盖主) */
  maxTokens?: number;
  /** 子 agent 专属 skills(独立,不继承主 agent skills) */
  skills?: SkillSpec[];
  /** 子 agent 额外工具(直接进工具池,不经 allTools 白名单筛选;供预声明子 agent 的专属 tools) */
  extraTools?: import('@langchain/core/tools').StructuredToolInterface[];
  /** 最大递归深度(默认 1:主可 spawn,子不可再 spawn) */
  maxDepth?: number;
  /** spawn_agents 并发上限(默认 4) */
  maxParallel?: number;
  /** 子 agent 最大工具轮次(默认 6) */
  maxToolRounds?: number;
  /** 当前递归深度(内部用;主=0) */
  depth?: number;
  debug?: boolean;
  /** 子 agent 可写路径前缀白名单(写工具包 path guard,越界 PATH_OUT_OF_SCOPE;整体 set 禁) */
  writablePaths?: string[];
  /** 读主 agent 全部焦点(multi-focus:子 agent 继承主焦点 → 构造 initialFocuses) */
  getFocuses?: () => Focus[];
  /** 取主数据 schema getter(focus 视野收敛 + path 校验用;透传主 liveData schema) */
  getSchema?: () => import('zod').ZodType | null | undefined;
  /** 取主数据 bind getter(focus 尾部追加分判:读数组实际长度;透传主 liveData bind) */
  getBind?: () => unknown;
  /** 子 agent 自定义中间件(如给规划能力);装在 skills/递归/focus 之后,对齐主「内置→用户」序 */
  middleware?: Middleware[];
  /** 跨轮上下文压缩;true=默认索引摘要(零 LLM),或 SummarizationOptions 自配(含 llmInvoke 升级 LLM 摘要)。不传=不装 */
  summarization?: boolean | SummarizationOptions;
  /** 观察层 tracker(createChatSdk 注入共享实例;记录委派 active/history)。不传=不记录 */
  tracker?: SubagentTracker;
  /** 子栈继承的把关中间件(主 permissions/approval 同实例;序同主栈)。不传=无 guard */
  guardMiddleware?: Middleware[];
  /** 主 vfs files getter(子 offload 大结果桥接进主 vfs 共享池,子 vfs_* 回读不 404)。不传=无桥接 */
  getVfsFiles?: () => Record<string, VfsFile>;
  /** 进入数据 scope(子 agent 委派期间 autoLock 基线归属切到子 scope,防子 read 污染主基线)。返回恢复函数 */
  enterDataScope?: (scopeId: string) => () => void;
  /** 退出数据 scope(委派结束清子 scope 基线条目) */
  exitDataScope?: (scopeId: string) => void;
  /** 子流 settle 通知(内部 per-call:use_<id> 组件锁的 release 挂此点,防超时旧 wind-down 与重委派竞态) */
  onStreamSettled?: (p: Promise<unknown>) => void;
  /** 子 agent LLM usage 回传(createChatSdk 累加进 core.usage)。不传=不回传 */
  onUsage?: (u: TokenUsage) => void;
  /** 单个子 agent 执行超时 ms(超时 abort 子流 + recoverable 回灌;0/负 = 关) */
  timeoutMs?: number;
  /** beforeReturn 自纠上限(默认 0 = 关闭);>0 时子 agent 返回前跑中间件 beforeReturn 钩子(如 verify 格式门禁) */
  maxVerifyAttempts?: number;
  /** 思考深度锁定('deep' 注入 thinking / 'simple' 剥除)。仅 LLMConfig 构造路径生效;实例路径 warn + no-op */
  thinkingMode?: 'simple' | 'deep';
  /** 写驱动过期读失效透传(顶层 false 必须主/子一致;未设 = 子 agent 默认 true 与主一致) */
  staleReadInvalidation?: boolean;
}
export declare function createSubagentMiddleware(opts: SubagentOptions): Middleware;
export declare function createVerifyMiddleware(opts: VerifyMiddlewareOptions): any;
export declare function createWriteBackCheck(opts?: WriteBackCheckOptions): VerifyCheck;
export declare function createMemoryMiddleware(memory?: string | (() => string | Promise<string>)): any;
export type MemorySource = string | (() => string | Promise<string>);
export declare const presets: Record<string, any>;
/** systemPrompt 辅助片段(标准化最佳实践,拼进 systemPrompt 降低写错门槛) */
export declare const systemPromptHelpers: {
  /** 可靠写入规则:改前先读、动态先 list、字段以 describe 为准、写错看校验错误重试、优先增量 patch */
  readonly reliableWriteRules: string;
  /** HTML 页面搭建主 agent 编排规则(与 createHtmlSubagent 配套;职责边界 / 逐个委派 / 修改排查 / 预算暂停) */
  readonly htmlPageOrchestrator: string;
  /** HTML 页面搭建「先出方案再生成」(新建/创意类先给 2~3 套方案问用户;产品决策,opt-in 拼进 systemPrompt) */
  readonly htmlPageProposeFirst: string;
  /** HTML 页面搭建「主 agent 自己写」降级编排(未注册 html 子 agent;createChatSdk 自动注入或集成方 opt-in spread) */
  readonly htmlDirectWriteFallback: string;
};
/** HTML 页面搭建主 agent 委派编排(按子 agent id 动态生成,use_<id> 正确;htmlPageOrchestrator 为 id='html' 静态快照) */
export declare function htmlOrchestratorPrompt(id: string): string;
/** 从 zod schema 提取字段说明(io 契约注入 systemPrompt 用);非 object schema 用 description 兜底 */
export declare function extractSchemaHint(schema: any, opts?: SchemaHintOptions): string;
export declare function createSessionStore(config?: StorageConfig): SessionStore;
/** 指定后端实例构造 store(自定义后端直连;createChatSdk 集成走 storage:{backend: 实例} 即可,无需直接调它) */
export declare function createSessionStoreWithBackend(config: StorageConfig, backend: StorageBackend): SessionStore;
export declare function createMemoryBackend(): StorageBackend;
export declare function createWebStorageBackend(storage: Storage): StorageBackend;
export declare function isQuotaError(err: unknown): boolean;
/** 创建 Skill 独立持久化存储(与 storage 选项分离;默认 indexedDB,可手动指定 id 跨页复用) */
export declare function createSkillStore(config?: SkillStoreConfig): SkillStore;
export interface SkillStore {
  ready: Promise<boolean>;
  list(): Promise<PersistedSkill[]>;
  get(name: string): Promise<PersistedSkill | undefined>;
  put(skill: PersistedSkill): Promise<void>;
  remove(name: string): Promise<boolean>;
  clear(): Promise<void>;
  dispose(): void;
}
/** 持久化的用户创建 skill(getContent 函数不可序列化,故 content 直接存字符串) */
export interface PersistedSkill {
  name: string;
  description: string;
  content: string;
}

// ============ 大 JSON 查询/搜索/沙箱脚本(dataSlotQuery)============
export interface JpNode {
  /** 相对属性根的点号路径(数组索引用数字,如 components.0.text) */
  path: string;
  /** 匹配元素值 */
  value: unknown;
  /** 父为数组时的索引(便于后续 write patch 的 jsonPath 定位) */
  index?: number;
}
export interface SearchHit {
  path: string;
  key?: string;
  value: string;
  score?: number;
}
export type SearchMode = 'substring' | 'regex' | 'fuzzy';
export interface EvalResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  elapsedMs: number;
}
/** JSONPath 查询(只读,无副作用);expr 子集:$ .key [n] ["key"] [*] [?(filter)] ..key ..* */
export declare function jpEval(root: unknown, expr: string): JpNode[];
/** 在 JSON 子树内搜索文本(substring/regex/fuzzy) */
export declare function searchJson(
  root: unknown,
  query: string,
  opts?: { mode?: SearchMode; fuzzyThreshold?: number; matchKey?: boolean; limit?: number },
): SearchHit[];
/** Web Worker 沙箱执行自定义 JS(无 window/document,禁 fetch/XHR/WebSocket/importScripts,超时可终止) */
export declare function runSandboxedScript(data: unknown, script: string, timeoutMs?: number): Promise<EvalResult>;
/** 通用 Worker 沙箱结果(eval_script 与 skill exec 共用;EvalResult 的别名同构) */
export interface SandboxResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  elapsedMs: number;
}
/**
 * 创建沙箱执行器(柯里化:先绑 script+timeoutMs,再传可选 input)。三层防护:静态扫描禁用模式 +
 * lockSandboxGlobal defineProperty 锁网络/存储 API(防 delete self.fetch 逃逸)+ 超时 terminate。
 * 无 input 传 undefined(skill exec);有 input 作 data 入参(eval_script)。
 */
export declare function createSandboxRunner(script: string, timeoutMs?: number): (input?: unknown) => Promise<SandboxResult>;

// ============ 工具报错(结构化 ERROR:{json},供 LLM 排查)============
export interface ToolErrorInput {
  /** 机器可读错误码(大写蛇形,如 NOT_REGISTERED / SCHEMA_INVALID / JSON_PARSE / PATH_UNSAFE / NOT_OBJECT / PATCH_FAILED / JSONPATH_SYNTAX / REGEX_INVALID / SCRIPT_TIMEOUT / SCRIPT_ERROR / NOT_FOUND / NO_MATCH / AMBIGUOUS_MATCH) */
  code: string;
  /** 人类可读:具体发生了什么 */
  message: string;
  /** 建议的修复动作(可操作) */
  hint?: string;
  /** 相关属性路径 */
  path?: string;
  /** 额外结构化细节(zod issues / 匹配位置 / 实际值等) */
  details?: unknown;
}
/** 格式化工具错误为 `ERROR: {json}` 字符串(单行 JSON,前缀 ERROR) */
export declare function toolError(e: ToolErrorInput): string;
/** zod 校验失败 → toolError(提取 issues 为 details) */
export declare function zodError(path: string, issues: unknown[]): string;
/** JSON 解析失败 → toolError(带原解析错误 + 预览) */
export declare function jsonParseError(path: string | undefined, raw: string, err: unknown): string;
/** 提取 zod issues 为结构化 details(每条 path/expected/received/message) */
export declare function formatZodIssues(issues: unknown[]): unknown[];
// ============ 统一错误模型(unify-error-model:三档 severity,各 catch 点按档路由)============
/** 错误严重程度三档:recoverable(回灌)/ fatal(中断)/ observable(记录不中断) */
export type ErrorSeverity = 'recoverable' | 'fatal' | 'observable';
/** 统一错误对象(结构化,跨层传递;普通 Error 经 asAgentError 归一化) */
export interface AgentError {
  severity: ErrorSeverity;
  message: string;
  code?: string;
  context?: unknown;
}
/** 错误路由:recoverable→feedback / fatal→abort / observable→log */
export type ErrorRouting = 'feedback' | 'abort' | 'log';
/** 路由纯函数:据 severity 决定错误如何被处理 */
export declare function routeError(err: AgentError): ErrorRouting;
/** 把任意错误归一化为 AgentError(已是 AgentError 不覆盖;普通 Error 用 defaultSeverity,默认 fatal) */
export declare function asAgentError(err: unknown, defaultSeverity?: ErrorSeverity): AgentError;
/** AgentError 便捷工厂 */
export declare function agentError(severity: ErrorSeverity, message: string, code?: string, context?: unknown): AgentError;

// === 与 src/core/index.ts 导出对齐(消费者类型完整;复杂内部类型用宽松声明,消费者主要消费工厂返回值) ===
// 上下文压缩预设
/** createChatSdk/contextPreset 的压缩配置入口形态 */
export interface ContextOptionsInput {
  contextPreset?: ContextPreset;
  contextOptions?: Partial<ContextManagerOptions> | false;
}
export declare function resolveContextOptions(options: ContextOptionsInput, modelContextWindow: number): Partial<ContextManagerOptions>;
export type ContextPreset = 'auto' | 'conservative' | 'aggressive' | 'complex';
export declare const CONTEXT_PRESETS: Record<string, any>;

// MCP
export declare function connectMcp(config: any): Promise<any>;
export declare function extractText(result: any): string;
export type McpTransport = 'http' | 'sse' | 'websocket';
export interface McpConnection { [k: string]: any }

// ===== harness / 中间件(E1 API 面收口:真实签名投射,与 src/core/harness 逐字段对齐;types-alignment Same<> 门禁锁定) =====
/** todo 状态 */
export type TodoStatus = 'pending' | 'in_progress' | 'completed';
/** 计划项(write_todos 整表替换 + update_todo 增量更新) */
export interface Todo {
  /** 稳定标识:write_todos 时框架按 index 生成 t-1/t-2…(LLM 也可显式传);输出必有、输入可选(向后兼容) */
  id: string;
  content: string;
  status: TodoStatus;
  /** 父 todo id(表达层级;可选) */
  parentId?: string;
  /** 依赖的 todo id 数组(必须先完成;渲染标 ✓/⏳) */
  deps?: string[];
  /** 完成标准(可选,LLM 自填) */
  criteria?: string;
  /** 完成证据(可选,如实际写入的 jsonPath) */
  evidence?: string;
}

/** 虚拟工作区文件 */
export interface VfsFile {
  content: string;
  mimeType?: string;
  updatedAt: number;
}

/** skill 元数据(渐进式披露的索引层) */
export interface SkillMeta {
  name: string;
  description: string;
}

/** 上下文压缩事件(cutoff-event 模式:不删消息,记录截断点 + 摘要) */
export interface SummarizationEvent {
  cutoffIndex: number;
  summary: string;
  evictedTo?: string;
}

/** 单次 invoke 的执行进度(agent 自感知预算的数据源;中间件只读勿改) */
export interface LoopProgress {
  /** 已消耗工具轮次 */
  rounds: number;
  /** 本 invoke 工具轮预算(maxToolRounds) */
  maxToolRounds: number;
  /** 本 invoke 累计 token 用量(每轮模型调用后累加;与 sdk.usage 会话级口径区分) */
  invokeUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  /** 写工具同路径连续失败计数(path → 次数;写成功清零) */
  writeFailures: Record<string, number>;
  /** 预算提示是否已注入(每任务一次,防每轮复读刷存在感) */
  budgetHinted: boolean;
}

/** Harness 运行态(中间件维护 state 字段,last-writer 合并;Deep Agents 的 agent state 同位物) */
export interface HarnessState {
  /** 用户层对话历史(跨轮) */
  messages: AgentMessage[];
  /** 计划清单(planning 中间件维护) */
  todos: Todo[];
  /** 内存虚拟工作区(vfs 中间件维护) */
  files: Record<string, VfsFile>;
  /** 已注册 skill 的索引(name + description),注入 system prompt */
  skillsMetadata: SkillMeta[];
  /** 已加载全文的 skill 名(避免重复加载) */
  skillsLoaded: string[];
  /** AGENTS.md 风格持久指令 */
  memory: string;
  /** 上下文压缩事件(summarization 中间件维护) */
  summarization?: SummarizationEvent;
  /** 最近一次跨轮压缩统计(createAgent 写入,供 DebugDrawer 可观测) */
  lastCompression?: CompressionStats;
  /** beforeReturn 自纠计数(达 maxVerifyAttempts 强制 return 防死循环) */
  verifyAttempts: number;
  /** 子 agent 标记(spawn/use 委派建的子循环置 true;主栈门禁据此豁免) */
  __pgIsSubagent?: boolean;
  /** 会话级任务目标锚定(mission 中间件;augmentPrompt 每轮注入,天然跨压缩) */
  mission?: Mission;
  /** 跨压缩工作记忆(workingMemory 中间件;pin 最近定位 path + read hash) */
  workingMemory?: WorkingMemory;
  /** 聚焦焦点(focus=首个兼容旧读,focuses=全量数组 multi-focus) */
  focus?: Focus;
  focuses?: Focus[];
  /** 当前 invoke 的执行进度(createAgent 每轮更新) */
  loopProgress?: LoopProgress;
}

/** 模型调用请求 */
export interface ModelRequest {
  messages: import('@langchain/core/messages').BaseMessage[];
  state: HarnessState;
}

/** 模型调用响应 */
export interface ModelResponse {
  message: import('@langchain/core/messages').BaseMessage;
  toolCalls: Array<{ id?: string; name: string; args: Record<string, unknown> }>;
  content: string;
  /** 模型流被 abort(用户停止):true 时 content 为已累积的 partial,应保留并结束本轮(不再执行工具) */
  aborted?: boolean;
}

/** beforeReturn 钩子上下文(agent 即将返回最终结果前) */
export interface BeforeReturnContext {
  messages: import('@langchain/core/messages').BaseMessage[];
  state: HarnessState;
  response: ModelResponse;
  /** 日志下沉:写主 debugLogs(verify 对抗审查等用它记录可观察日志) */
  log?: (type: string, data: unknown) => void;
}

/** beforeReturn 钩子:返回 feedback 字符串 → 回灌 user 消息继续循环(自纠);null/undefined → 放行 return */
export type BeforeReturnHook = (ctx: BeforeReturnContext) => Promise<string | null> | string | null;

/** 中间件返回的 state 更新(last-writer 合并) */
export type StateUpdate = Partial<HarnessState>;

/** 工具执行结果 */
export interface ToolExecResult {
  content: string;
  status: 'done' | 'error';
}

/** 工具调用上下文 */
export interface ToolCallContext {
  id: string;
  name: string;
  args: Record<string, unknown>;
  state: HarnessState;
  /** 当前 agent 循环的 abort signal(中间件可据此感知用户停止) */
  signal?: AbortSignal;
  /** 主循环事件转发(供 spawn 把子 agent 进度冒泡到 UI;不进入主 LLM 上下文) */
  emit?: (event: StreamEvent) => void;
  /** 日志下沉(供 spawn 把子 agent 的 debugLog 转发到主;子日志带 source 标签) */
  logSink?: (entry: any) => void;
  /** per-call 注入 bag:中间件在 wrapToolCall 往 ctx 写键值,coreExecTool 经 RunnableConfig.configurable 透传到工具 fn 第二参 */
  callConfig?: Record<string, unknown>;
}

export interface Middleware {
  name: string;
  /** 该中间件贡献的工具,合并进工具集 */
  tools?: import('@langchain/core/tools').StructuredToolInterface[];
  /** 追加到 system prompt 的段(每轮模型调用前收集渲染) */
  augmentPrompt?: (state: HarnessState) => string | undefined;
  /** 构建上下文前压缩历史消息(summarization 中间件用,链式) */
  compressInput?: (messages: AgentMessage[]) => Promise<{ messages: AgentMessage[]; stats?: unknown }> | AgentMessage[];
  /** agent 启动时(正序) */
  beforeAgent?: (state: HarnessState) => StateUpdate | void | Promise<StateUpdate | void>;
  /** 每次模型调用前(正序,同步),可更新 state(随后重渲染 system) */
  beforeModel?: (req: ModelRequest) => StateUpdate | void;
  /** 包裹模型调用(洋葱,可改 messages / 拦截) */
  wrapModelCall?: (req: ModelRequest, next: (req: ModelRequest) => Promise<ModelResponse>) => Promise<ModelResponse>;
  /** 模型返回后(逆序) */
  afterModel?: (res: ModelResponse, state: HarnessState) => StateUpdate | void;
  /** 包裹工具执行(洋葱) */
  wrapToolCall?: (ctx: ToolCallContext, next: (ctx: ToolCallContext) => Promise<ToolExecResult>) => Promise<ToolExecResult>;
  /** agent 结束时(逆序,必跑含早退路径) */
  afterAgent?: (state: HarnessState) => StateUpdate | void | Promise<StateUpdate | void>;
  /** agent 即将返回最终结果前(正序):feedback 触发自纠(回灌 user 消息继续循环);null 放行。受 createAgent maxVerifyAttempts 约束 */
  beforeReturn?: BeforeReturnHook;
}


// 子 agent
export declare function createSubagentsMiddleware(opts: any): any;
export interface SubagentsController {
  set(configs: SubagentConfig[]): void;
  add(config: SubagentConfig): void;
  remove(id: string): boolean;
  get(): SubagentConfig[];
}
// 能力包(专用子 agent 工厂):RAG 多源检索 + HTML 代码组件生成(add-capability-packs)
export interface RagHit { content: string; source?: string; score?: number }
export interface RagRetrieveOptions { topK?: number }
export type RagRetriever = (query: string, opts?: RagRetrieveOptions) => Promise<RagHit[]>;
export type RagLoader = (source: string) => Promise<RagHit | RagHit[]>;
export interface CreateRagSubagentOptions {
  retriever?: (query: string, opts?: RagRetrieveOptions) => Promise<RagHit[]>;
  loader?: (source: string) => Promise<RagHit | RagHit[]>;
  useVfs?: boolean;
  id?: string;
  description?: string;
  topK?: number;
  searchToolName?: string;
  loadToolName?: string;
  maxToolRounds?: number;
  summarization?: boolean | any;
  skills?: SkillSpec[];
  extraTools?: any[];
  [k: string]: any;
}
export interface CreateHtmlSubagentOptions {
  writablePaths: string[];
  /** 子 agent 额外可用工具名(并入只读白名单;集成方只读查询类工具);写类工具勿传 */
  allowedTools?: string[];
  codeVfsPrefix?: string;
  id?: string;
  description?: string;
  planning?: boolean;
  summarization?: boolean | any;
  maxToolRounds?: number;
  temperature?: number;
  skills?: SkillSpec[];
  /**
   * 内置设计品味 skill(web-design-engineer,vendored from ConardLi garden-skills v1.2.2,MIT):
   * 设计系统先声明 / 反 AI 俗套 / oklch 配色 / 25 风格配方 / 5 维自评 —— 与内置落地规范 skill(html-fragment)
   * 分工并列(design 管品味,htmlFragment 管落地)。缺省 true 挂载(追加在用户 skills 之后);
   * false 关闭;传 SkillSpec 替换为自定义版本。主文/参考只在子 agent load_skill 时渐进进上下文。
   */
  design?: boolean | SkillSpec;
  extraTools?: any[];
  /** 输出格式校验(validate_code 工具 + verify beforeReturn 门禁);默认 true */
  formatCheck?: boolean;
  /** 代码字段相对组件的 jsonPath(默认 'code',支持嵌套如 'props.html_code');「是否代码组件」= 该路径下有 string */
  codeField?: string;
  /** 自动注入主 agent 委派编排段(含正确 use_<id>);默认 true,false=不注入 */
  orchestratorPrompt?: boolean;
  /** 子 agent 独立 LLM(缺省继承主;主保持轻量模型编排、代码生成换强模型)。实例形态不支持 thinkingMode 锁定 */
  llm?: LLMConfig;
  /** 思考深度锁定:'deep' 注入思考参数(代码生成质量优先)/ 'simple' 剥除;需模型支持思考(flash 类无效) */
  thinkingMode?: 'simple' | 'deep';
  [k: string]: any;
}
export declare function createRagSubagent(options: CreateRagSubagentOptions): SubagentConfig;
/** 内置完整 HTML 生成规范 skill(createHtmlSubagent 默认装;传自定义 skills 覆盖默认时,显式并回此 skill 保住生成规范/安全底线;默认快照 root='components'/codeField='code') */
export declare const htmlFragmentSkill: SkillSpec;
/** 构造自定义 root/codeField 的 HTML 生成规范 skill(默认装 htmlFragmentSkill 即此函数默认参产物) */
export declare function buildHtmlFragmentSkill(root?: string, codeField?: string): SkillSpec;
export declare function createHtmlSubagent(options: CreateHtmlSubagentOptions): SubagentConfig;
export interface HtmlFormatIssue {
  /** 行号(1 基) */
  line: number;
  /** 问题码:UNCLOSED_TAG / STRAY_CLOSE_TAG / UNCLOSED_COMMENT(只校验结构合法性;DOCTYPE/html/head/body/script 不再拦 —— 完整页面级 HTML,改造由下游插件/tool 做) */
  code: string;
  message: string;
}
/** HTML 格式校验(标签闭合等结构合法性);纯函数,node/浏览器通用(集成方渲染层纵深防御可复用) */
export declare function validateHtmlFormat(source: string): HtmlFormatIssue[];
/** HTML void 元素集合(无需闭合标签;validateHtmlFormat 用,集成方可复用) */
export declare const HTML_VOID_TAGS: Set<string>;
export interface HtmlFormatCheckOptions {
  /** vfs 代码路径前缀(与 createHtmlSubagent 的 codeVfsPrefix 一致);默认 'html/' */
  vfsPrefix?: string;
}
/** HTML 格式 verify check(beforeReturn 门禁):扫 state.files 代码文件,不通过回灌 feedback 自纠 */
export declare function createHtmlFormatCheck(opts?: HtmlFormatCheckOptions): VerifyCheck;
/** 工匠笔记末行守卫(note-gate):craftNotes 开启时子 agent 收口回复无 [note] 行 → beforeReturn 回灌补写一次 */
export declare function createCraftNoteCheck(): VerifyCheck;
/** 沙箱采集到的原始渲染信号(console.error / js-error / unhandledrejection / 资源失败 / CSP 违规 / console.warn) */
export interface RenderSignal {
    type: 'console-error' | 'console-warn' | 'js-error' | 'unhandledrejection' | 'resource-error' | 'csp-violation';
    message: string;
    source?: string;
    lineno?: number;
}
/** 渲染指标(收集窗结束时采集;白屏判定口径 = 内容级:body 子节点数 / scrollHeight / 图片数) */
export interface RenderMetrics {
    bodyChildren: number;
    scrollHeight: number;
    imgCount: number;
}
/** 单组件沙箱渲染的原始结果(未归一;noDom = node/无 DOM 环境标记) */
export interface RawRenderResult {
    handshake: boolean;
    signals: RenderSignal[];
    metrics?: RenderMetrics;
    timedOut?: boolean;
    noDom?: boolean;
}
/** 归一后的单组件判定:pass / fail(带 problems)/ unavailable(握手缺失或超时,不算通过防假绿) */
export interface RenderVerdict {
    verdict: 'pass' | 'fail' | 'unavailable';
    problems: string[];
    warnings: string[];
    metrics?: RenderMetrics;
    reason?: 'handshake-missing' | 'timeout';
}
/** 渲染自检 VerifyCheck 工厂选项(runner 注入供测试桩用) */
export interface HtmlRenderCheckOptions {
    vfsPrefix?: string;
    codeField?: string;
    writablePaths?: string[];
    runner?: (html: string) => Promise<RawRenderResult>;
    maxTargets?: number;
}
/** 渲染自检对象:check 组合进 createHtmlSubagent 的 formatCheck 链;两个注入槽由装配期回填 */
export interface HtmlRenderCheck {
    check: VerifyCheck;
    setGetController: (g: () => {
        get?: () => { bind?: unknown } | null | undefined;
    } | null | undefined) => void;
    setWritablePaths: (paths: string[]) => void;
}
/** 沙箱运行参数(活动静默窗/硬上限/指标应答宽限;默认 900ms / 4000ms / 500ms) */
export interface SandboxRunOptions {
    silenceMs?: number;
    hardCapMs?: number;
    metricsGraceMs?: number;
}
/**
 * 渲染级自检(render-check):本轮触达的 code 资产放沙箱 iframe(srcdoc + sandbox="allow-scripts")独立渲染,
 * 采集 console.error / window.onerror / unhandledrejection / 资源失败 / 白屏指标 → 归一回灌自纠。
 * 仅门禁形态(组合进 createHtmlSubagent 的 formatCheck 链);node/无 DOM 自动跳过渲染段保留结构段;
 * 握手缺失(宿主 CSP 拦沙箱内联脚本)/ 超时 → unavailable 不算通过(零信号 ≠ 通过)。
 */
export declare function createHtmlRenderCheck(opts?: HtmlRenderCheckOptions): HtmlRenderCheck;
/** 组合「结构 → 渲染」为单一 VerifyCheck(结构不过短路渲染;runBeforeReturn 不短路,两段必须单 check 内早返回) */
export declare function composeStructureThenRender(structure: VerifyCheck, render: VerifyCheck): VerifyCheck;
/** 信号归一纯函数:storage 类 SecurityError 降 warn(沙箱假阳性);无失败信号但 body 空 + scrollHeight<10 → 疑似白屏 fail */
export declare function normalizeRenderResult(raw: RawRenderResult): RenderVerdict;
/** 单组件沙箱渲染(离屏 iframe;用后销毁;node/无 DOM 返回 noDom) */
export declare function renderInSandbox(html: string, opts?: SandboxRunOptions): Promise<RawRenderResult>;
/** 沙箱 srcdoc 构造(collector 注入文档最前,不改组件原文) */
export declare function buildSandboxSrcdoc(html: string, nonce: string): string;
/** collector 采集脚本源码(nonce 握手 + 信号上报 + 活动信号 + 指标应答) */
export declare function buildCollectorJs(nonce: string): string;
/** 累计/销毁的沙箱 iframe 数(测试观察「用后销毁」契约) */
export declare function getSandboxLifecycle(): { created: number; destroyed: number };

// checkpoint / dataOps / permissions
export interface CheckpointDeps { [k: string]: any }
export interface DataAuditEntry { [k: string]: any }
export interface DataSnapshotEntry { [k: string]: any }
export type PermissionOp = string;

// vfs(E1 API 面收口:createVfs 真实签名 + 四池配置类型;与 src backends/vfs 对齐)
/** vfs 持久化钩子 */
export interface VfsPersist {
  /** 文件变更后回调(debounce 由 createChatSdk 控制落盘) */
  save?: (files: Record<string, VfsFile>) => void;
}
/** vfs 分池键(按 path 前缀路由:large_results/* / drafts/* / resources/* / 其他) */
export type VfsPoolKey = 'largeResults' | 'drafts' | 'userFiles' | 'resources';
/** createVfs 选项 */
export interface VfsOptions {
  /** 持久化钩子(可选) */
  persist?: VfsPersist;
  /** 工作区总内存上限(默认 8MB,OOM 兜底;四池独立上限之和可能超过,由总上限最后约束);纯内存也生效 */
  maxBytes?: number;
  /** 单池上限(可选,覆盖默认 largeResults=4MB / drafts=2MB / userFiles=2MB / resources=4MB);四池独立 LRU 互不挤占 */
  poolBytes?: Partial<Record<VfsPoolKey, number>>;
}
/** vfs 实例(Proxy 包裹 files:变更捕获 → 记账 + LRU;读写经工具层) */
export interface VfsStore {
  files: Record<string, VfsFile>;
  /** 持久化恢复:直接灌入 raw target,不触发 save(仅 persist 模式) */
  hydrate?: (files: Record<string, VfsFile>) => void;
  /** 立即落盘(清 debounce 窗口);pagehide 兜底用(仅 persist 模式) */
  flush?: () => void;
  /** 清空工作区 + 触发落盘空(新会话用,仅 persist 模式) */
  clear?: () => void;
  /** 是否有未捕获到 checkpoint 的写(供 checkpoint 增量 save 检查;非持久化模式也暴露) */
  isDirty?: () => boolean;
  /** 读后清脏标记,返回是否脏;checkpoint save 消费(脏→clone 新基线,不脏→复用上次 clone) */
  consumeDirty?: () => boolean;
  /** 设置被引用保护集(LRU 淘汰时跳过被消息引用的 large_results,防 vfs_read 404) */
  setProtectedRefs?: (refs: Set<string>) => void;
  /** path → 所属池(超池预检用) */
  getPoolOf?: (path: string) => string;
  /** 池上限字节(超池预检用) */
  getPoolLimit?: (pool: string) => number;
}
/**
 * 创建一个 vfs 实例。
 * @param initialFiles 初始文件(path → content)
 * @param opts.persist 持久化钩子;提供则用 Proxy 捕获 store.files 变更 → debounce save
 */
export declare function createVfs(initialFiles?: Record<string, string>, opts?: VfsOptions): VfsStore;

// 上下文管理(E1 API 面收口:与 src composables/useContextManager 对齐)
export interface ContextManagerOptions {
  /** 滑动窗口:保留最近几轮完整对话(轮数模式用) */
  windowRounds: number;
  /** 超过多少轮触发摘要压缩(轮数模式用,含窗口内) */
  summaryThresholdRounds: number;
  /** 旧工具结果截断长度(单轮 ReAct 内) */
  toolResultMaxChars: number;
  /** 是否启用关键词召回相关历史 */
  enableRecall: boolean;
  /** 召回的最大轮次数 */
  recallTopK: number;
  /** 是否启用 LLM 增强摘要(否则用零成本索引摘要) */
  enableLLMSummary: boolean;
  /** 用于摘要的 LLM invoke 函数(可选) */
  llmInvoke?: (prompt: string) => Promise<string>;
  /** 模型上下文窗口(token);提供则按 token 触发压缩 + token 窗口,否则按轮数 */
  contextWindow?: number;
  /** 触发压缩的 token 比例(默认 0.5) */
  summaryThresholdRatio?: number;
  /** prompt 软上限(token,成本维度);窗口 ≥320K 未传时默认 160K;显式传 0 关闭 */
  promptSoftCapTokens?: number;
  /** 保留最近窗口的 token 预算比例(默认 0.4) */
  windowRatio?: number;
  /** 压缩时注入「当前可操作数据」快照(防 LLM 基于过时记忆操作已卸载/新增的动态组件) */
  getRegisteredData?: () => { description: string }[];
  /** @deprecated 旧多对象模型遗留(单对象 data 模式用 getRegisteredData);仍兼容,返回值 path 字段忽略 */
  getRegisteredSlots?: () => { path: string; description: string }[];
  /** 跨轮摘要时,对这些工具的步骤 result 额外保留摘要片段进 summaryMsg(防字段描述被摘要掉) */
  preserveLastToolResults?: string[];
}
/** 压缩决策输入(agent-driven-compression;decideInvoke 的载荷) */
export interface CompressDecisionInput {
  /** 当前消息(供 inspect_context 组合 rounds + totalTokens) */
  getMessages: () => AgentMessage[];
  /** contextInspector 快照(可选,inspect_context 的 categories 来源) */
  getSnapshot?: () => ContextSnapshot | undefined;
  /** 模型上下文窗口(inspect_context occupancy + 决策 prompt) */
  contextWindow?: number;
  /** 压缩触发阈值比例(进 prompt 供 LLM 参考) */
  thresholdRatio?: number;
  /** 触发原因(进 prompt,如「token 超阈值」「轮数超阈值」) */
  triggerReason: string;
  /** 触发模式(决定 LLM 填 keepRounds 还是 windowRatio) */
  triggerMode: 'token' | 'rounds';
}
/** summarization 中间件选项(压缩策略;Partial<ContextManagerOptions> + LLM 决策钩子) */
export interface SummarizationOptions extends Partial<ContextManagerOptions> {
  /** 压缩决策 invoke(agentCompression 开启时;成功 → 用决策,失败/null → 降级静态) */
  decideInvoke?: (input: CompressDecisionInput) => Promise<CompressDecision | null>;
  /** contextInspector 快照 getter(供 inspect_context 的 categories + decide) */
  getSnapshot?: () => ContextSnapshot | undefined;
}

export interface CompressionStats {
  triggered: boolean; roundsTotal: number; roundsSummarized: number; roundsRecalled: number;
  originalMessages: number; compressedMessages: number; strategy: string;
  decision?: CompressDecision;
}
// 压缩决策(agent-driven-compression;summaryLlm.decide 输出)
export interface CompressDecision {
  keepRounds?: number;
  windowRatio?: number;
  summarize: { mode: 'index' | 'llm' };
  recallTopK?: number;
  preserveTools?: string[];
  reason?: string;
}
export declare const CompressDecisionSchema: {
  safeParse: (input: unknown) => { success: true; data: CompressDecision } | { success: false; error: unknown };
};

// 模型能力 / token 估算 / offload 阈值
export declare const MIN_CONTEXT_WINDOW: number;
/** 判定错误是否为上下文超限(模型输入超 contextWindow);复用 langchain ContextOverflowError + 兜底正则。harden-context-resilience */
export declare function isContextLengthError(err: unknown): boolean;
/** 判定错误是否为「模型不可用」(model-offline-guidance;仅模型调用失败 catch 点消费,勿用于工具错误归一化) */
export declare function isModelUnavailableError(err: unknown): boolean;
/** 命中模型不可用 → 就地打 `code:'MODEL_UNAVAILABLE'` + message 尾附引导(幂等);返回是否命中 */
export declare function decorateModelUnavailable(err: unknown): boolean;
/** 模型不可用引导文案 */
export declare const MODEL_UNAVAILABLE_GUIDANCE: string;
export declare function resolveModelCaps(model: string): any;
/** 表内该模型的输出上限(LLMConfig.maxTokens 未设时作请求 max_tokens 缺省;仅表命中模型返回值,未知模型 undefined 不兜防超发 400) */
export declare function tableMaxOutputTokens(model?: string): number | undefined;
/** 低能力提示基线:上下文 200K / 请求输出上限 32K */
export declare const LOW_CAPS_HINT_BASELINE: { readonly contextWindow: 200000; readonly requestMaxTokens: 32768 };
/** 低能力提示文案:上下文 <200K 或请求输出上限 <32K → 提示串;均达基线返回 null(主 agent 装配 warn / 子 agent debugLogs 留痕由调用面分流) */
export declare function lowCapsHint(model: string | undefined, caps: { contextWindow: number; maxOutputTokens: number }, requestMaxTokens?: number): string | null;
export declare function estimateTokens(text: string): number;
export declare function offloadThresholdChars(contextWindow: number): number;
export declare function offloadPassThroughChars(contextWindow: number): number;
/** 模型能力(集成方声明 > model 名查表 > 缺省) */
export interface ModelCaps {
  /** 模型上下文窗口(token) */
  contextWindow: number;
  /** 模型最大输出(token) */
  maxOutputTokens: number;
  /** 是否支持多模态识图:true = user 消息 images 组装 content parts 直发;缺省 false(保守,宁走旁路/报错不误发 parts 吃 400) */
  vision?: boolean;
  /** 是否支持思考/推理模式:true = 集成方未显式配置时默认注入 thinking(deep)保质量;缺省 false(未知模型不猜,防 400) */
  thinking?: boolean;
}


// 剪贴板复制(clipboard API + execCommand 降级,兼容非 secure context / 旧浏览器)
export declare function copyText(text: string): Promise<boolean>;
/**
 * 串行化运行器(P1-2,arch-review):把并发异步操作排成串行链,一个跑完下一个才开始。
 * createChatSdk 的 send/switchSession/batch 经此串行化,防并发共享 state 竞态。
 * 返回的 runSerial(fn):fn 排队执行(前一个无论成败都继续),返回 fn 的 Promise(透传结果/错误)。
 */
export declare function createSerialRunner(): <T>(fn: () => Promise<T>) => Promise<T>;

// ===== eval-toolkit(真 LLM 回归判定核,4.10+;openspec/changes/2026-09-03-eval-toolkit)=====
/** idle 采样(harness 从 sdk 读;自用套件从 page.evaluate 读 —— 同一判定核吃两种采样器) */
export interface EvalSample {
  messageCount: number;
  /** 距最近一条 debugLog 的毫秒;日志为空时返回 epoch 级巨值(>1e12 = 被清空信号) */
  quietMs: number;
  /** 是否已有至少一条模型响应(debugLogs 含 llm_response) */
  hasResponse: boolean;
  /** 在飞子 agent 数(inspect().subagent.active.length;无子能力恒 0) */
  activeSubagents: number;
  /** debugLogs 当前长度(诊断用) */
  logCount: number;
}
export interface EvalIdleDetectorOptions {
  /** 日志静默阈值 ms(默认 90000 —— reasoning/长生成期间不打日志,阈值须盖过最长思考窗口) */
  quietMs?: number;
  /** 连续几次采样满足全条件才判 done(默认 3;单次采样可能恰逢间隙) */
  confirmSamples?: number;
  /** 基线消息数:判定「有新消息」的下界(默认 0) */
  baselineMessageCount?: number;
}
export type IdleVerdict = 'pending' | 'done' | 'reset';
/** idle 状态机(纯函数):逐采样喂入返回判定;不碰定时器/DOM —— 自用套件与公开 harness 共用同一真相源 */
export declare function createIdleDetector(opts?: EvalIdleDetectorOptions): { push: (sample: EvalSample) => IdleVerdict; reset: () => void };
/** 回归报告快照(collectReport 产物;与自用 _real-llm-*.json 场景条目同构,可互相对 diff) */
export interface EvalReport {
  at: string;
  messageCount: number;
  toolCount: number;
  usage: { prompt: number; completion: number; cacheRead?: number; cacheCreate?: number };
}
export interface EvalDiffOptions {
  tokenAbs?: number;
  tokenPct?: number;
  toolCountAbs?: number;
}
export interface EvalDiffField {
  key: string;
  prev: number;
  cur: number;
  delta: number;
  pct: number;
  flag: '' | 'up' | 'down';
}
export interface EvalDiffResult {
  status: 'ok' | 'worse' | 'better';
  regressions: number;
  fields: EvalDiffField[];
}
/** 单场景报告 vs 基线阈值判定(纯函数):token ±pct 且 ±abs 同时超才标 ▲▼,toolCount 超绝对差即标,elapsedSec 不判 */
export declare function diffReport(current: Record<string, number>, baseline: Record<string, number> | null | undefined, opts?: EvalDiffOptions): EvalDiffResult;
/** harness 依赖的最小 sdk 面(结构子集;ChatSdk 满足 —— 直接传 sdk 即可) */
export interface EvalSdkLike {
  messages: unknown[];
  debugLogs: Ref<DebugLog[]>;
  usage?: { prompt: number; completion: number; cacheRead?: number; cacheCreate?: number };
  inspect?: () => { subagent?: { active?: unknown[] } };
}
export interface EvalHarness {
  waitForIdle(opts?: EvalIdleDetectorOptions & { timeoutMs?: number; sampleMs?: number; onSample?: (s: EvalSample) => void }): Promise<EvalSample>;
  collectReport(): EvalReport;
}
/** 创建 eval harness:waitForIdle(idle 状态机驱动轮询)+ collectReport(报告快照)。纯判定/等待层 —— 发消息/断言业务结果归集成方 */
export declare function createEvalHarness(opts: { sdk: EvalSdkLike }): EvalHarness;
