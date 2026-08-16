/**
 * 子 agent 中间件 —— spawn_agent / spawn_agents
 *
 * 主 agent 委派独立子 agent 跑子任务,只把最终结论返回主上下文(过程隔离,省主 token)。
 * 对齐 Claude Code 的 Agent 工具。复用 createAgent 工厂构造子 agent(独立 state/messages)。
 *
 * 通信(见 evolution-roadmap.md #1):单向委派 —— 主→子=工具参数,子→主=工具返回(最终结论);
 * signal 继承(主停则子停);多子并行不互通,主聚合。
 *
 * 进度展示:子的工具调用进度 + 思考过程(reasoning)经主 onEvent 转发(subagent 事件)→ UI 在 spawn 步骤下嵌套展示;
 * **不进入主 LLM 上下文**(只进 UI,严守隔离)。text 不转发(是生成内容,经 vfs/data 落地;reasoning 转发展示"在想什么")。
 *
 * 递归防护:maxDepth(默认 1)。depth+1 >= maxDepth 时子 agent 不装本中间件 → 无 spawn 工具 →
 * 物理切断(比运行时检查更可靠)。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { createAgent } from './createAgent'
import { createSkillsMiddleware, type SkillSpec } from './skills'
import type { Middleware } from './middleware'
import { runPool } from '../utils/pool'
import type { StreamEvent, TokenUsage } from '../types'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { resolveModelCaps, MIN_CONTEXT_WINDOW } from '../utils/modelCaps'
import { createFocusMiddleware } from './focus'
import { createSummarizationMiddleware, type SummarizationOptions } from './summarization'
import type { Focus, VfsFile } from './state'
import type { ZodType } from 'zod'
import { normalizeUsage } from '../utils/contentParts'
import { constructLlmFromConfig } from '../llm/constructLlm'
import type { ComponentLock, ResolveComponentsResult } from '../sdk/componentLock'

/** 子 agent 转发到主 UI 的进度(tool_call/tool_result 工具级 + reasoning 思考过程增量;text 不转发:是生成内容,经 vfs/data 落地,不进进度) */
type SubProgress = Extract<StreamEvent, { type: 'tool_call' | 'tool_result' | 'reasoning' }>

export interface SubagentLlmConfig {
  apiKey: string
  /** provider 透传:缺省 'openai';'anthropic' 子 agent 同走 Claude 原生协议(动态 import 异步构造,见 runSubagent) */
  provider?: 'openai' | 'anthropic'
  baseUrl?: string
  model?: string
  temperature?: number
  maxTokens?: number
  /** 透传 openai configuration 额外字段(headers/fetch 等;子 agent 兜底构造时同主 LLM 生效) */
  extraConfig?: Record<string, any>
  /** 透传 modelKwargs(如 deepseek thinking);子 agent 兜底构造时同主 LLM 生效 */
  extraBody?: Record<string, any>
  /** Anthropic prompt caching(同主 LLM cacheControl;provider:'anthropic' 时经 constructLlmFromConfig 透传生效) */
  cacheControl?: boolean | '5m' | '1h'
}

// ===== 子 agent 观察层(active/history 状态;纯观察,不改子 agent 生命周期/事件链)=====

/** 子 agent 工具调用进度摘要(只记 kind+name+ts,不含 args/result 全文,防膨胀;全文在 messages/事件) */
export interface SubagentStep {
  kind: 'tool_call' | 'tool_result'
  name: string
  ts: number
}

/** 单个子 agent 运行状态(观察层;会话级纯内存,不持久化跨刷新) */
export interface SubagentRunState {
  /** 唯一标识(每次委派生成;并发安全 —— spawn 用 sub-xxx,预声明用 use_<id>-xxx 避免同 id 冲突) */
  taskId: string
  /** 委派任务(use_<id> 的 task / spawn_agent 的 prompt 摘要) */
  task: string
  /** 子 agent 标识(role / use_<id> 的 id / spawn label) */
  label: string
  status: 'running' | 'done' | 'error'
  /** 进度(子 agent 工具调用摘要,累积;只记 kind+name+ts,不含 args/result 全文) */
  steps: SubagentStep[]
  startedAt: number
  /** 完成后填(= Date.now() - startedAt) */
  durationMs?: number
  /** 结论摘要(完成时;截断 120 字,非全文 —— 全文在 messages/tool result) */
  resultPreview?: string
}

/** 子 agent 观察层 tracker(会话级 active/history 状态管理;纯内存,不进 storage) */
export interface SubagentTracker {
  /** 委派开始:记 active(status running) */
  start(taskId: string, task: string, label: string, startedAt: number): void
  /** 子工具进度:累积 step 到对应 active entry(只记 kind+name+ts) */
  pushStep(taskId: string, step: SubagentStep): void
  /** 委派结束:更新 status/durationMs/resultPreview(截断)→ 从 active 移入 history(LRU) */
  finish(taskId: string, status: 'done' | 'error', result: string): void
  /** 运行中子 agent 快照(空数组=无在跑) */
  getActive(): SubagentRunState[]
  /** 历史委派快照(LRU ≤ historyLimit,最新在前) */
  getHistory(): SubagentRunState[]
}

/**
 * 创建子 agent 观察层 tracker(会话级纯内存)。
 * createChatSdk 内部创建一个共享实例,注入 spawn + 预声明中间件 → 两类委派统一观察。
 * historyLimit 防 LRU 膨胀(默认 20);resultPreview 截断 120 字;steps 只记摘要(非全文)。
 */
export function createSubagentTracker(historyLimit = 20): SubagentTracker {
  const active = new Map<string, SubagentRunState>()
  const history: SubagentRunState[] = []
  return {
    start(taskId, task, label, startedAt) {
      active.set(taskId, { taskId, task, label, status: 'running', steps: [], startedAt })
    },
    pushStep(taskId, step) {
      const st = active.get(taskId)
      if (st) st.steps.push(step)
    },
    finish(taskId, status, result) {
      const st = active.get(taskId)
      if (!st) return
      st.status = status
      st.durationMs = Date.now() - st.startedAt
      st.resultPreview = result.length > 120 ? result.slice(0, 120) + '…' : result
      active.delete(taskId)
      history.unshift(st)
      while (history.length > historyLimit) history.pop()
    },
    getActive() { return [...active.values()] },
    getHistory() { return [...history] },
  }
}

export interface SubagentOptions {
  /** 主 agent 的 LLM(配置对象或预构造实例,子 agent 复用) */
  llm: SubagentLlmConfig | BaseChatModel
  /** 主 agent 全部工具(子 agent 按白名单筛选只读子集)。支持 getter:运行时 setTools/addTool 动态加的工具对子 agent 立即可见(P1-4) */
  allTools: StructuredToolInterface[] | (() => StructuredToolInterface[])
  /** 子 agent 额外可用的工具名(默认仅只读主数据 + fetch) */
  allowedTools?: string[]
  /** 子 agent 默认身份(spawn 运行时的 role 优先;都缺省用兜底) */
  systemPrompt?: string
  /** 子 agent 温度(仅 llm 配置对象时生效;覆盖主 llm 温度) */
  temperature?: number
  /** 子 agent maxTokens(仅 llm 配置对象时生效;覆盖主) */
  maxTokens?: number
  /** 子 agent 专属 skills(独立,不继承主 agent skills) */
  skills?: SkillSpec[]
  /** 子 agent 额外工具(直接进工具池,不经 allTools 白名单筛选;供预声明子 agent 的专属 tools/toolsets) */
  extraTools?: StructuredToolInterface[]
  /** 最大递归深度(默认 1:主可 spawn,子不可再 spawn) */
  maxDepth?: number
  /** spawn_agents 并发上限(默认 4) */
  maxParallel?: number
  /** 子 agent 最大工具轮次(默认 6) */
  maxToolRounds?: number
  /** 当前递归深度(内部用;主=0) */
  depth?: number
  debug?: boolean
  /** 子 agent 可写路径前缀白名单(给子 agent 写权限;写工具包 path guard,越界 PATH_OUT_OF_SCOPE;整体 set 禁)。subagent-writable Phase 2 */
  writablePaths?: string[]
  /** 读主 agent 全部焦点(multi-focus:子 agent 继承主焦点 → 构造 initialFocuses) */
  getFocuses?: () => Focus[]
  /** 取主数据 schema getter(focus-auto-switch:子 focus 中间件做视野收敛 + path 校验用;透传主 liveData schema) */
  getSchema?: () => ZodType | null | undefined
  /** 取主数据 bind getter(focus 尾部追加分判:isTailAppend 读数组实际长度;透传主 liveData bind) */
  getBind?: () => unknown
  /** 子 agent 自定义中间件(如 createTodosMiddleware 给规划能力);装在 skills/递归/focus 之后,对齐主「内置→用户」序 */
  middleware?: Middleware[]
  /** 跨轮上下文压缩;true=默认索引摘要(零 LLM),或 SummarizationOptions 自配(含 llmInvoke 升级 LLM 摘要)。不传=不装 */
  summarization?: boolean | SummarizationOptions
  /** 观察层 tracker(createChatSdk 注入共享实例;记录委派 active/history)。不传=不记录(零回归) */
  tracker?: SubagentTracker
  /** 子栈继承的把关中间件(主 permissions/approval 同实例;fix-authorization-surface P1-16)。序同主栈:permissions 外层 → approval 内层。不传=无 guard(零回归) */
  guardMiddleware?: Middleware[]
  /** 主 vfs files getter(fix-authorization-surface P1-15:子 offload 大结果桥接进主 vfs 共享池,子 vfs_* 回读不 404)。不传=无桥接 */
  getVfsFiles?: () => Record<string, VfsFile>
  /** 进入数据 scope(fix-main-sub-isolation P1-13:子 agent 委派期间 autoLock 基线归属切到子 scope,防子 read 污染主基线)。返回恢复函数;不传=无隔离(零回归) */
  enterDataScope?: (scopeId: string) => () => void
  /** 退出数据 scope(委派结束清子 scope 基线条目) */
  exitDataScope?: (scopeId: string) => void
  /** 子 agent LLM usage 回传(P1-17a:createChatSdk 累加进 core.usage;子栈无 sdk-events,经 sub-usage 中间件提取)。不传=不回传 */
  onUsage?: (u: TokenUsage) => void
  /** 单个子 agent 执行超时 ms(P1-17b:opt-in 默认关;超时 abort 子流 + 错误回灌 recoverable,主 LLM 可重试/拆分) */
  timeoutMs?: number
  /** beforeReturn 自纠上限(默认 0 = 关闭);>0 时子 agent 返回前跑中间件 beforeReturn 钩子(如 verify 格式门禁),feedback 回灌自纠,达上限强制 return 防死循环 */
  maxVerifyAttempts?: number
}

/** 判定 llm 是模型实例(BaseChatModel)还是配置对象(SubagentLlmConfig) */
function isChatModel(v: unknown): v is BaseChatModel {
  return !!v && typeof v === 'object' && typeof (v as any).invoke === 'function' && typeof (v as any).stream === 'function'
}

/** 子 agent 默认可用的只读工具(不含写工具 —— 子 agent 只读探查,写回交主 agent) */
const DEFAULT_READONLY_TOOLS = [
  'describe_data',
  'get_data',
  'read',
  'query_data',
  'search_data',
  'fetch_document',
]
const DEFAULT_MAX_DEPTH = 1
const DEFAULT_MAX_PARALLEL = 4
const DEFAULT_CHILD_ROUNDS = 6
const SPAWN_TOOL_NAMES = ['spawn_agent', 'spawn_agents']

/**
 * 框架/会话级保留工具:子 agent 工具池禁入(装配期源头 filter,fix-authorization-surface Q1)。
 * 防 spawn 自授激活 depth 链(use_*)、反向操作主会话状态(focus/checkpoint/humanConfirm/skills/planning)。
 * 运行期防御需每个执行点都查,装配期 filter = 物理不进池,无执行点可漏。
 */
const FRAMEWORK_TOOL_NAMES = [
  'load_skill',                   // 主 skills 中间件工具(子 agent 有自己的 skills)
  'write_todos', 'update_todo',   // 主 planning(子 agent 规划经自己的 todos middleware 装)
  'restore_last_checkpoint',      // 会话级回滚,子 agent 不可操作
  'request_human_confirmation',   // 子栈无 humanConfirm 中间件 → 调用即永挂
  'set_focus', 'add_focus', 'remove_focus', 'clear_focus',  // 会话级焦点状态,子继承不突变
]

/** 保留前缀 use_* = 预声明委派工具命名空间(集成方自定义工具避免用 use_ 前缀) */
export function isReservedFrameworkTool(name: string): boolean {
  return SPAWN_TOOL_NAMES.includes(name) || FRAMEWORK_TOOL_NAMES.includes(name) || name.startsWith('use_')
}

/**
 * 子 agent 工具池构建(纯函数,导出供测;fix-authorization-surface P0-1/Q1):
 * 主合并池按白名单筛只读子集 + 排除框架/保留工具 + extraTools 直加(集成方显式,不过滤)。
 */
export function buildChildTools(
  pool: StructuredToolInterface[],
  allow: Set<string>,
  extraTools: StructuredToolInterface[] = [],
): StructuredToolInterface[] {
  return [
    ...pool.filter((t) => allow.has(t.name) && !isReservedFrameworkTool(t.name)),
    ...extraTools,
  ]
}

/**
 * 判定工具是否为写能力(单一真相源:按工具定义点 writeCapable 标注)。
 * 用于子 agent 授权面过滤与 spawn 自授剥离。
 * 保守策略:函数形态标注(条件写)在「无法确定 args」时按可能为写处理(宁误拦不漏放)。
 */
export function isWriteCapableTool(t: StructuredToolInterface | string, args?: unknown): boolean {
  const tool = typeof t === 'string' ? undefined : t
  const wc = tool && ('writeCapable' in tool) ? (tool as any).writeCapable : undefined
  if (typeof wc === 'boolean') return wc
  if (typeof wc === 'function') {
    // 条件写:有 args 时判定,无 args 时保守按写(子 agent 装配期无 args → 剥离防漏放)
    return args !== undefined ? wc(args) : true
  }
  return false
}

/** 提取写工具 args 的所有 jsonPath(jsonPath / patch.jsonPath / patches[].jsonPath / path) */
export function extractWritePaths(args: any): string[] {
  const paths: string[] = []
  if (typeof args.jsonPath === 'string' && args.jsonPath) paths.push(args.jsonPath)
  if (typeof args.path === 'string' && args.path) paths.push(args.path)
  if (args.patch && typeof args.patch.jsonPath === 'string') paths.push(args.patch.jsonPath)
  if (Array.isArray(args.patches)) for (const p of args.patches) { if (p && typeof p.jsonPath === 'string') paths.push(p.jsonPath) }
  return paths
}

/** 写路径前缀校验:精确相等 / startsWith(p + '.') / startsWith(p + '[') */
export function isPathWritable(jsonPath: string, prefixes: string[]): boolean {
  return prefixes.some((p) => jsonPath === p || jsonPath.startsWith(p + '.') || jsonPath.startsWith(p + '['))
}

/** 包写工具一层 path guard:args 所有 jsonPath 必须在 writablePaths 前缀内;越界 → PATH_OUT_OF_SCOPE;整体 set(无 jsonPath)禁。 */
export function wrapWithPathGuard(t: StructuredToolInterface, prefixes: string[]): StructuredToolInterface {
  const orig = t.invoke.bind(t)
  // 第二参 config 透传(rv-verify A2 同族):丢弃会让子栈写工具失去 per-call __pgDataScope,
  // 退回 ambient 兜底 —— 并行两子 scope 交错时子写基线可串 scope(A2 主栈同款窗口)
  const guarded = async (args: any, config?: unknown) => {
    // P1-18(fix-authorization-surface):patches 含无 jsonPath 项 = 作用于根 → 拒绝。
    // 修原 extractWritePaths 只收集有 path 项 → 混合批量「收集到的合法即整体放行」的越界口子
    if (Array.isArray(args?.patches) && args.patches.some((p: any) => !p || typeof p.jsonPath !== 'string' || !p.jsonPath)) {
      return `PATH_OUT_OF_SCOPE:patches 含无 jsonPath 项(作用于根),子 agent 仅可写 ${prefixes.join(', ')} 范围内子路径。请为每个 patch 指定 jsonPath。`
    }
    const paths = extractWritePaths(args)
    if (!paths.length) {
      return `PATH_OUT_OF_SCOPE:子 agent 仅可增量 patch(writablePaths: ${prefixes.join(', ')}),不能整体替换(无 jsonPath)。用 write({patch:{jsonPath,...}}) 增量改。`
    }
    for (const p of paths) {
      if (!isPathWritable(p, prefixes)) {
        return `PATH_OUT_OF_SCOPE:子 agent 写 "${p}" 越界(仅可写 ${prefixes.join(', ')})。`
      }
    }
    return config !== undefined ? (orig as unknown as (a: unknown, c?: unknown) => unknown)(args, config) : orig(args)
  }
  return new Proxy(t, {
    get(target, prop, receiver) {
      if (prop === 'invoke') return guarded
      return Reflect.get(target, prop, receiver)
    },
  }) as StructuredToolInterface
}

/**
 * 包一层 scope proxy:invoke 期间切 dataOps activeScope 到 scopeId,finally 恢复(嵌套安全)。P1-13
 * CA 并发修复:同时经 RunnableConfig.configurable.__pgDataScope 传 per-call scope token(dataOps 工具 fns
 * 优先取 token,并发交错不再读错 scope);下方 enter/exit ambient 保留为兜底(无 config 的旧路径)。
 */
export function wrapWithScope(t: StructuredToolInterface, scopeId: string, enter: (id: string) => () => void): StructuredToolInterface {
  return new Proxy(t, {
    get(target, prop, receiver) {
      if (prop === 'invoke') {
        return async (args: unknown, config?: { configurable?: Record<string, unknown> }) => {
          const exit = enter(scopeId)
          try {
            return await target.invoke(args, { ...config, configurable: { ...config?.configurable, __pgDataScope: scopeId } })
          } finally { exit() }
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  }) as StructuredToolInterface
}

/**
 * 构造并跑一个子 agent,返回最终文本结论。
 * 过程隔离:独立 state/messages;signal 继承(主停则子停);
 * 工具调用进度经 forward 转发到主 UI(不进入主 LLM 上下文)。
 */
async function runSubagent(
  task: { prompt: string; role?: string; model?: string },
  opts: SubagentOptions,
  signal?: AbortSignal,
  forward?: (e: SubProgress) => void,
  onLog?: (entry: any) => void,
  /** 主循环 stream handler(approval_request 直通转发;子栈继承的 approval 发确认请求 → ApprovalBar,fix-authorization-surface P1-16) */
  emitToMain?: (e: StreamEvent) => void,
): Promise<string> {
  const depth = opts.depth ?? 0
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH
  // 子 agent 工具子集:只读白名单 + 用户 allowedTools;排除 spawn(防递归)
  const allow = new Set([...DEFAULT_READONLY_TOOLS, ...(opts.allowedTools ?? [])])
  // P1-4:allTools 支持 getter —— 子 agent spawn 时取主 agent 最新工具集(运行时 setTools/addTool 动态加的工具对子 agent 可见,不再用装配期快照)
  const getAllTools: () => StructuredToolInterface[] = () =>
    typeof opts.allTools === 'function' ? opts.allTools() : opts.allTools
  // 子 agent 工具:主合并池按白名单筛只读子集 + 排除框架/保留工具(装配期源头 filter)+ extraTools(预声明子 agent 的专属工具,不经筛选)
  let childTools = buildChildTools(getAllTools(), allow, opts.extraTools ?? [])
  // writablePaths(子 agent 写权限):写工具包 path guard 后加入(越界 PATH_OUT_OF_SCOPE;整体 set 禁)
  if (opts.writablePaths?.length) {
    childTools = childTools.filter((t) => !isWriteCapableTool(t)) // A2 移除写工具(按标注单一真相源,防重复)
    const guardedWrites = getAllTools()
      .filter((t) => isWriteCapableTool(t) && !isReservedFrameworkTool(t.name))
      .map((t) => wrapWithPathGuard(t, opts.writablePaths!))
    childTools = [...childTools, ...guardedWrites]
  }
  // per-scope 乐观锁基线(P1-13):dataOps 工具(带 __dataOpsScoped marker,含 path guard Proxy 透传)包一层 scope proxy ——
  // invoke 期间 activeScope 切到本次委派的 scopeId,子 read/write 只动子 scope 基线,主基线不被污染。
  // 修原:主×子共享 lastReadHash 闭包变量,子 read 刷新主基线 → 父过期写静默放行覆盖外部修改
  const scopeId = `sub-${depth}-${Math.random().toString(36).slice(2, 10)}`
  if (opts.enterDataScope) {
    childTools = childTools.map((t) => ((t as unknown as { __dataOpsScoped?: boolean }).__dataOpsScoped ? wrapWithScope(t, scopeId, opts.enterDataScope!) : t))
  }
  // 递归物理切断:depth+1 >= maxDepth 时子 agent 不装本中间件 → 无 spawn 工具
  const childMiddleware = depth + 1 < maxDepth ? [createSubagentMiddleware({ ...opts, depth: depth + 1 })] : []
  // focus-auto-switch:子 agent 继承主焦点(主聚焦 → 子默认同焦点,三层收敛;主未聚焦 → 空数组不装,零回归)
  const inheritedFocuses = opts.getFocuses?.() ?? []
  const childFocusMw = inheritedFocuses.length
    // unfocusGuidance 'report-parent':子 agent 授权面永不带 focus 工具(见保留工具排除表),文案引导「收口反馈」而非调工具
    ? createFocusMiddleware({ getSchema: opts.getSchema ?? (() => null), getBind: opts.getBind, initialFocuses: inheritedFocuses, unfocusGuidance: 'report-parent' })
    : undefined
  // P1-15(fix-authorization-surface):vfs 桥接 —— 子 state.files 指向主 vfsStore.files,
  // 子 offload 大结果直落主共享池(子 vfs_* 回读不 404,主 agent 亦可读)
  const vfsBridgeMw: Middleware | undefined = opts.getVfsFiles
    ? { name: 'vfs-bridge', beforeAgent: () => ({ files: opts.getVfsFiles!() }) }
    : undefined
  // harden-context-resilience M3:从 llm 提取 model 名查表得 contextWindow/maxOutputTokens
  // (BaseChatModel 实例无 contextWindow 字段;不传则 createAgent 把实例 model 误判默认 gpt-3.5→16K,offload/压缩阈值全错算)
  const subModel = isChatModel(opts.llm)
    ? ((opts.llm as any).model ?? (opts.llm as any).modelName)
    : (task.model ?? opts.llm.model)
  const subCaps = resolveModelCaps({
    model: subModel,
    // 实例路径读 .contextWindow(stubModel 挂;真实 BaseChatModel 可能无 → 查表兜底);LLMConfig 自带
    contextWindow: (opts.llm as any).contextWindow,
    maxOutputTokens: (opts.llm as any).maxOutputTokens,
  })
  if (subCaps.contextWindow < MIN_CONTEXT_WINDOW) {
    throw new Error(
      `[page-agent-sdk][subagent] 子 agent 模型上下文窗口 ${subCaps.contextWindow} 小于最小支持 ${MIN_CONTEXT_WINDOW}(需 ≥200K 窗口模型)`,
    )
  }
  // summarization(子 agent 跨轮压缩;HTML agent 频繁改代码累积快):true=默认索引摘要(零 LLM),对象自配(可含 llmInvoke 升级)
  const summarizationMw = opts.summarization !== undefined
    ? createSummarizationMiddleware(
        typeof opts.summarization === 'object'
          ? { contextWindow: subCaps.contextWindow, ...opts.summarization }
          : { contextWindow: subCaps.contextWindow },
      )
    : undefined
  // P1-17a:子 LLM usage 回传(子栈无 sdk-events 中间件 → sub-usage afterModel 提取,onUsage 由 createChatSdk 累加进 core.usage;不外发 usage 事件)
  const usageMw: Middleware | undefined = opts.onUsage
    ? { name: 'sub-usage', afterModel: (res) => { const u = normalizeUsage(res.message); if (u) opts.onUsage!(u) } }
    : undefined
  // provider 透传(fix:主 llm 传 LLMConfig + provider:'anthropic' 时,散字段重建曾丢 provider →
  // 子 agent 被按 OpenAI 协议构造,请求打到 {baseUrl}/chat/completions 404 秒败)。
  // anthropic 走 constructLlmFromConfig 动态构造(runSubagent 是 async,可承载动态 import);
  // openai 路径维持同步散字段构造(向后兼容)
  let resolvedSubLlm: BaseChatModel | undefined
  if (!isChatModel(opts.llm) && opts.llm.provider === 'anthropic') {
    resolvedSubLlm = await constructLlmFromConfig(
      { ...opts.llm, model: task.model ?? opts.llm.model },
      { temperature: opts.temperature ?? opts.llm.temperature, maxTokens: opts.maxTokens ?? opts.llm.maxTokens },
    )
  }
  const child = createAgent({
    // 模型能力透传(显式声明优先,驱动子 agent offload 阈值/压缩触发,修原 16K 误算 silent bug)
    contextWindow: subCaps.contextWindow,
    maxOutputTokens: subCaps.maxOutputTokens,
    // provider 抽离:llm 实例则注入(温度/maxTokens 已在实例上定,忽略 opts.temperature/maxTokens),否则按配置构造(子 agent 配置优先于主 llm)
    // extraConfig/extraBody 一并透传(真 LLM 抓包实测:散字段重构造曾丢它们 → 集成方的 headers/fetch/thinking 配置在子 agent 失效)
    ...(isChatModel(opts.llm)
      ? { llm: opts.llm }
      : resolvedSubLlm
        ? { llm: resolvedSubLlm }
        : {
            apiKey: opts.llm.apiKey,
            baseUrl: opts.llm.baseUrl,
            model: task.model ?? opts.llm.model,
            temperature: opts.temperature ?? opts.llm.temperature,
            maxTokens: opts.maxTokens ?? opts.llm.maxTokens,
            ...(opts.llm.extraConfig ? { extraConfig: opts.llm.extraConfig } : {}),
            ...(opts.llm.extraBody ? { extraBody: opts.llm.extraBody } : {}),
          }),
    // 身份优先级:运行时 role(spawn 参数)> 配置默认 systemPrompt > 兜底
    systemPrompt:
      task.role?.trim() ||
      opts.systemPrompt ||
      '你是一个专注的子任务执行者。你只有只读工具(读主数据 / 抓文档),用它们完成给定任务,给出简洁结论,不要展开多余解释。',
    tools: childTools,
    // 子 agent 专属 skills(独立,不继承主)+ 递归 subagent 中间件(防递归)
    middleware: [
      ...(opts.skills?.length ? [createSkillsMiddleware(opts.skills)] : []),
      ...(summarizationMw ? [summarizationMw] : []),
      ...(vfsBridgeMw ? [vfsBridgeMw] : []),
      ...childMiddleware,
      ...(childFocusMw ? [childFocusMw] : []),
      ...(usageMw ? [usageMw] : []),
      // P1-16(fix-authorization-surface):子栈继承主 permissions/approval(序同主栈:permissions 外层自动拒 → approval 内层人工确认)。
      // 修原「委派路径整体绕过把关」:配 approval:{tools:['write']} 的集成方,子 agent 写同样需用户确认
      ...(opts.guardMiddleware ?? []),
      ...(opts.middleware ?? []),
    ],
    maxToolRounds: opts.maxToolRounds ?? DEFAULT_CHILD_ROUNDS,
    // beforeReturn 自纠上限(子 agent verify 门禁;默认 0 = 不跑 beforeReturn 钩子,零回归)
    maxVerifyAttempts: opts.maxVerifyAttempts ?? 0,
    onLog, // 子 agent 日志下沉 → spawn 工具转发到主 debugLogs(带 source 标签)
    debug: opts.debug,
  })
  if (opts.debug) console.log(`[subagent] 启动子 agent(depth=${depth},工具 ${childTools.length} 个)`)
  // 子流 AbortController 链(父 signal abort → 子 abort;超时独立 abort 子;fix-hang-and-feedback abort 收口同源)
  const childAc = new AbortController()
  const onParentAbort = () => childAc.abort()
  signal?.addEventListener('abort', onParentAbort, { once: true })
  // 收尾:解绑父 signal 监听 + 清子 scope 基线条目(P1-13)
  const cleanup = () => { signal?.removeEventListener('abort', onParentAbort); opts.exitDataScope?.(scopeId) }
  const streamP = child.stream([{ role: 'user', content: task.prompt, timestamp: Date.now() }], (e) => {
    // P1-16:approval_request 直通转发回主循环 handler(ApprovalBar 渲染/收口)—— 不包裹为进度事件,
    // 否则子栈继承的 approval 挂起永无人响应(原 forward 只转发 tool_call/tool_result)
    if (e.type === 'approval_request') { emitToMain?.(e); return }
    // 转发工具调用进度 + 思考过程(reasoning)到主 UI(text 不转发:是生成内容,经 vfs/data 落地;UI 可见 ≠ 进主上下文,隔离不破)
    if (forward && (e.type === 'tool_call' || e.type === 'tool_result' || e.type === 'reasoning')) forward(e)
  }, childAc.signal)
  if (!opts.timeoutMs || opts.timeoutMs <= 0) {
    try { return await streamP } finally { cleanup() }
  }
  // P1-17b:子执行超时(opt-in)—— race 超时 abort 子流并抛错(spawn 工具 catch → recoverable 回灌,主 LLM 可重试/拆小子任务)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeoutP = new Promise<never>((_, rej) => {
    timer = setTimeout(() => {
      childAc.abort()
      rej(new Error(`子 agent 执行超时(${opts.timeoutMs}ms),已中止。可简化子任务或拆更小的子任务重试`))
    }, opts.timeoutMs)
  })
  // 超时收口后 streamP 的 abort rejection 无人 await → 吞掉防 unhandled(同 stallTimeout 模式;正常路径 race 直接消费 streamP)
  streamP.catch(() => {})
  try { return await Promise.race([streamP, timeoutP]) } finally { clearTimeout(timer); cleanup() }
}

export function createSubagentMiddleware(opts: SubagentOptions): Middleware {
  const maxParallel = opts.maxParallel ?? DEFAULT_MAX_PARALLEL
  // 当前主循环的 signal / emit / logSink(供 spawn 工具继承/转发)。
  // CA 并发修复(per-call 通道):优先从工具 fn 第二参 config.configurable.__pgSubagentCall 取本次调用的值
  // (wrapToolCall 注入 ctx.callConfig → coreExecTool 透传;并发工具各持独立 ctx,不再互相覆盖);
  // 下方闭包单变量降为 fallback(无 config 通道的旧调用路径),maxParallelTools>1 不再有 M3 错乱
  let currentSignal: AbortSignal | undefined
  let currentEmit: ((e: StreamEvent) => void) | undefined
  let currentLogSink: ((e: any) => void) | undefined

  /** per-call 值解析:优先本次工具调用的 config 注入,降级闭包 fallback(非并发下两者同值) */
  const callCtxOf = (config: unknown): { signal?: AbortSignal; emit?: (e: StreamEvent) => void; logSink?: (e: any) => void } => {
    const c = (config as { configurable?: Record<string, unknown> } | undefined)?.configurable?.__pgSubagentCall as
      | { signal?: AbortSignal; emit?: (e: StreamEvent) => void; logSink?: (e: any) => void }
      | undefined
    return c ?? { signal: currentSignal, emit: currentEmit, logSink: currentLogSink }
  }

  /** 把子进度(subagent 事件)转发到主 UI(经 per-call emit)+ 观察层累积 steps */
  const makeForward = (taskId: string, label: string, emit?: (e: StreamEvent) => void) => (e: SubProgress): void => {
    // reasoning 是高频增量(每 token 一条):只转发到 UI 累积(spawnStep.subReason),不进 tracker 步骤摘要(防爆)
    if (e.type === 'reasoning') {
      emit?.({ type: 'subagent', taskId, label, kind: 'reasoning', name: '', delta: e.delta })
      return
    }
    // 观察层:累积子工具进度摘要(只记 kind+name+ts;全文在事件/messages)
    opts.tracker?.pushStep(taskId, { kind: e.type, name: e.name, ts: Date.now() })
    if (!emit) return
    emit({
      type: 'subagent',
      taskId,
      label,
      kind: e.type,
      name: e.name,
      args: e.type === 'tool_call' ? e.args : undefined,
      result: e.type === 'tool_result' ? e.result : undefined,
      status: e.type === 'tool_result' ? e.status : undefined,
    })
  }

  const spawnOne = tool(
    async ({ prompt, role, tools, writablePaths, model }, config) => {
      // per-call signal/emit/logSink(CA 并发修复):并发委派各用各的,不再串到无关工具的值
      const call = callCtxOf(config)
      // A2 spawn 自授 tools 剥离写工具(按 writeCapable 标注)—— 写权限只能经 writablePaths(path guard)获得;
      // 框架/保留工具(use_*/spawn/load_skill 等)由 buildChildTools 装配期兜底排除
      // 保守策略:条件写工具(eval_script)无 args 时按写剥离,spawn 自授不接受条件写(防漏放)
      const granted = (tools ?? []).filter((t) => !isWriteCapableTool(t))
      const subOpts = granted.length || writablePaths?.length
        ? { ...opts, ...(granted.length ? { allowedTools: granted } : {}), ...(writablePaths?.length ? { writablePaths } : {}) }
        : opts
      const taskId = `sub-${Math.random().toString(36).slice(2, 8)}`
      const label = role?.trim() || '子任务'
      const onLog = (entry: any) => call.logSink?.({ ...entry, source: `子:${label}` })
      // 观察层:记 active(委派开始)
      const startedAt = Date.now()
      opts.tracker?.start(taskId, prompt, label, startedAt)
      try {
        const result = await runSubagent({ prompt, role, model }, subOpts, call.signal, makeForward(taskId, label, call.emit), onLog, call.emit)
        opts.tracker?.finish(taskId, 'done', result)
        return result
      } catch (e) {
        opts.tracker?.finish(taskId, 'error', String((e as Error)?.message ?? e))
        throw e
      }
    },
    {
      name: 'spawn_agent',
      description:
        '委派一个独立子 agent 执行子任务,返回其最终结论(过程隔离,不占主上下文)。用于:分治大任务、专项调研、独立验证。子 agent 默认只读(不改页面)。',
      schema: z.object({
        prompt: z.string().describe('子任务描述(子 agent 的唯一输入)'),
        role: z.string().optional().describe('子 agent 身份(如"你是代码审查专家")'),
        tools: z.array(z.string()).optional().describe('子 agent 可用工具名白名单(默认只读主数据 + fetch)。写工具不可自授——写权限用 writablePaths;委派/框架类工具系统保留不可授'),
        writablePaths: z.array(z.string()).optional().describe('子 agent 可写路径前缀(给写权限;越界 PATH_OUT_OF_SCOPE;如 ["components"] 允许写 components.* )'),
        model: z.string().optional().describe('覆盖模型(默认同主)'),
      }),
    },
  )

  const spawnMany = tool(
    async ({ tasks }, config) => {
      // per-call signal/emit/logSink(CA 并发修复):并发委派各用各的,不再串到无关工具的值
      const call = callCtxOf(config)
      // 并发池(maxParallel):子 agent 间并行,结果按原顺序聚合;signal 继承
      // P1-14(allSettled 语义):逐任务 try/catch 结算,失败不 throw —— 修原 Promise.all 整体 reject:
      // 一个子失败 → 已成功兄弟结果全丢 + 主 LLM 只见一条错误。现各自结算,聚合文本 ✓/✗ 逐条,主 LLM 决策如何处理
      const results = await runPool<{ prompt: string; role?: string }, { ok: true; text: string } | { ok: false; error: string } | undefined>(
        tasks,
        maxParallel,
        async (t, i) => {
          const taskId = `sub-${i}-${Math.random().toString(36).slice(2, 6)}`
          const label = t.role?.trim() || `子任务${i + 1}`
          const onLog = (entry: any) => call.logSink?.({ ...entry, source: `子:${label}` })
          // 观察层:记 active(并行委派,各 taskId 独立 entry)
          const startedAt = Date.now()
          opts.tracker?.start(taskId, t.prompt, label, startedAt)
          try {
            const r = await runSubagent(t, opts, call.signal, makeForward(taskId, label, call.emit), onLog, call.emit)
            opts.tracker?.finish(taskId, 'done', r ?? '(未完成)')
            return { ok: true as const, text: r ?? '(未完成)' }
          } catch (e) {
            const msg = String((e as Error)?.message ?? e)
            opts.tracker?.finish(taskId, 'error', msg)
            return { ok: false as const, error: msg }
          }
        },
        call.signal,
      )
      return results
        .map((r, i) =>
          r === undefined
            ? `【子任务 ${i + 1}】(未完成:已中止/未启动)`
            : r.ok
              ? `【子任务 ${i + 1}】✓\n${r.text}`
              : `【子任务 ${i + 1}】✗ 失败:${r.error}`,
        )
        .join('\n\n')
    },
    {
      name: 'spawn_agents',
      description:
        '并行委派多个独立子 agent,聚合各自结论(子 agent 间互不通信,由你汇总)。适合:多路调研、多视角审查、批量处理。',
      schema: z.object({
        tasks: z
          .array(z.object({ prompt: z.string().describe('子任务描述'), role: z.string().optional() }))
          .min(1)
          .max(8)
          .describe('子任务列表(最多 8 个)'),
      }),
    },
  )

  return {
    name: 'subagent',
    tools: [spawnOne, spawnMany],
    wrapToolCall: async (ctx, next) => {
      // 捕获主循环 signal(主停则子停)+ emit(子进度转发到主 UI)。
      // per-call 注入(CA 并发修复):值随 ctx.callConfig 经 RunnableConfig 透传到工具 fn 第二参,
      // 并发工具各持独立 ctx 不互相覆盖;闭包单变量仍同步维护(fallback + 非工具路径)
      if (ctx.signal) currentSignal = ctx.signal
      if (ctx.emit) currentEmit = ctx.emit
      if (ctx.logSink) currentLogSink = ctx.logSink
      ctx.callConfig = { ...(ctx.callConfig ?? {}), __pgSubagentCall: { signal: ctx.signal ?? currentSignal, emit: ctx.emit ?? currentEmit, logSink: ctx.logSink ?? currentLogSink } }
      return next(ctx)
    },
  }
}

// ===== 预声明子 agent(subagents:[] → 专属委派工具 use_<id>)=====

/** 预声明子 agent 配置(同主配置子集 + id/description;缺省继承主 agent) */
export interface SubagentConfig {
  /** 唯一标识;生成委派工具名 use_<id>(须合法工具名 [a-zA-Z_][a-zA-Z0-9_]*) */
  id: string
  /** 一句话说明(进主 systemPrompt 索引 + 作委派工具描述,帮主 LLM 判断何时委派) */
  description: string
  /** 子 agent 独立 llm(缺省继承主) */
  llm?: SubagentLlmConfig | BaseChatModel
  /** 子 agent 身份(缺省继承主 / 兜底) */
  systemPrompt?: string
  /** 子 agent 专属工具(独立于主工具池,直接进子工具池) */
  tools?: StructuredToolInterface[]
  /** 子 agent 专属 skills */
  skills?: SkillSpec[]
  temperature?: number
  maxTokens?: number
  maxToolRounds?: number
  /** 子 agent 可写路径前缀白名单(给写权限;写工具包 path guard,越界 PATH_OUT_OF_SCOPE;整体 set 禁) */
  writablePaths?: string[]
  /** 从主 allTools 额外拿的工具名(追加到默认只读白名单);如 ['vfs_grep','vfs_write','draft_write'] */
  allowedTools?: string[]
  /** 子 agent 自定义中间件(如 createTodosMiddleware 给规划能力);configToSubOpts 透传 */
  middleware?: Middleware[]
  /** 跨轮上下文压缩;true=默认索引摘要(零 LLM),或 SummarizationOptions 自配。不传=不装 */
  summarization?: boolean | SummarizationOptions
  /** beforeReturn 自纠上限(默认 0 = 关闭);>0 时返回前跑中间件 beforeReturn 钩子(如 verify 格式门禁),feedback 回灌自纠防死循环。配 verify 类中间件时必开 */
  maxVerifyAttempts?: number
  /**
   * 框架内部标记(code-as-data-asset):createHtmlSubagent 单模式设;createChatSdk 装配识别 →
   * 注入 checkout/commit 钩子(beforeAgent data.code→vfs / afterAgent vfs→data.code 增量回写)+
   * dataOps 传 pgIdPaths + largeTextPaths + 强制 vfs。下划线前缀 = 框架内部,不进公开 API。
   */
  _codeAsset?: { writablePaths: string[]; codeVfsPrefix: string; ext: 'html'; codeField: string; orchestratorPrompt?: string; craftNotes?: boolean }
}

export interface SubagentsMiddlewareOptions {
  /** 主 agent 的 llm(子 agent 缺省继承) */
  llm: SubagentLlmConfig | BaseChatModel
  /** 主 agent 全部工具(子 agent 按只读白名单筛)。支持 getter(P1-4:动态工具对子 agent 可见) */
  allTools: StructuredToolInterface[] | (() => StructuredToolInterface[])
  /** 读主 agent 全部焦点(multi-focus:预声明子 agent 同样继承主焦点) */
  getFocuses?: () => Focus[]
  /** 取主数据 schema getter(focus-auto-switch:透传给子 focus 中间件) */
  getSchema?: () => ZodType | null | undefined
  /** 取主数据 bind getter(focus 尾部追加分判:透传给子 focus 中间件) */
  getBind?: () => unknown
  debug?: boolean
  /** 观察层 tracker(同 SubagentOptions.tracker;createChatSdk 注入共享实例,两类委派统一观察) */
  tracker?: SubagentTracker
  /** 子栈继承的把关中间件(主 permissions/approval 同实例;fix-authorization-surface P1-16)。configToSubOpts 透传 */
  guardMiddleware?: Middleware[]
  /** 主 vfs files getter(fix-authorization-surface P1-15 子 offload 桥接)。configToSubOpts 透传 */
  getVfsFiles?: () => Record<string, VfsFile>
  /** 进入数据 scope(fix-main-sub-isolation P1-13)。configToSubOpts 透传 */
  enterDataScope?: (scopeId: string) => () => void
  /** 退出数据 scope(P1-13)。configToSubOpts 透传 */
  exitDataScope?: (scopeId: string) => void
  /** 子 usage 回传(P1-17a)。configToSubOpts 透传 */
  onUsage?: (u: TokenUsage) => void
  /** 子执行超时 ms(P1-17b,opt-in)。configToSubOpts 透传 */
  timeoutMs?: number
  /**
   * 组件锁(parallel-subagent-delegation Q2:同组件单委派互斥)。use_<id> 委派入口:
   * resolveComponents 解析目标组件 → acquire(非阻塞)→ 跑子 agent → finally release;
   * acquire 失败立即回灌 COMPONENT_BUSY(不排队不占并发槽)。不传 = 无锁(零回归)。
   */
  componentLock?: ComponentLock
  /** 目标组件解析(explicit / text-match / none 三档;createChatSdk 装配期注入 knownNames getter 闭包) */
  resolveComponents?: (args: { components?: string[]; task: string }) => ResolveComponentsResult
}

/** 合法工具名校验(生成 use_<id>) */
const TOOL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/** SubagentConfig → runSubagent 的 opts(继承主缺省 + 展开专属 tools 为 extraTools) */
function configToSubOpts(config: SubagentConfig, main: SubagentsMiddlewareOptions): SubagentOptions {
  const extra = config.tools ?? []
  return {
    llm: config.llm ?? main.llm,
    allTools: main.allTools,
    systemPrompt: config.systemPrompt,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    skills: config.skills,
    extraTools: extra.length ? extra : undefined,
    maxToolRounds: config.maxToolRounds,
    debug: main.debug,
    ...(config.writablePaths?.length ? { writablePaths: config.writablePaths } : {}),
    ...(config.allowedTools?.length ? { allowedTools: config.allowedTools } : {}),
    ...(config.middleware?.length ? { middleware: config.middleware } : {}),
    ...(config.summarization !== undefined ? { summarization: config.summarization } : {}),
    ...(config.maxVerifyAttempts !== undefined ? { maxVerifyAttempts: config.maxVerifyAttempts } : {}),
    // focus-auto-switch:预声明子 agent 同样继承主焦点 + schema
    ...(main.getFocuses ? { getFocuses: main.getFocuses } : {}),
    ...(main.getSchema ? { getSchema: main.getSchema } : {}),
    // 观察层:透传 tracker(递归子 agent 的 spawn 也记录到主 tracker)
    ...(main.tracker ? { tracker: main.tracker } : {}),
    // fix-authorization-surface:透传把关中间件(P1-16)+ vfs 桥接(P1-15)
    ...(main.guardMiddleware?.length ? { guardMiddleware: main.guardMiddleware } : {}),
    ...(main.getVfsFiles ? { getVfsFiles: main.getVfsFiles } : {}),
    // fix-main-sub-isolation:per-scope 基线(P1-13)+ 子 usage 回传(P1-17a)+ 子执行超时(P1-17b)
    ...(main.enterDataScope ? { enterDataScope: main.enterDataScope } : {}),
    ...(main.exitDataScope ? { exitDataScope: main.exitDataScope } : {}),
    ...(main.onUsage ? { onUsage: main.onUsage } : {}),
    ...(main.timeoutMs !== undefined ? { timeoutMs: main.timeoutMs } : {}),
  }
}

/** Subagents 动态控制器:set/add/remove 委派工具(复用 tools rebind 机制) */
export interface SubagentsController {
  /** 替换整个 subagents 列表(重新生成 use_<id> 工具,触发 onReconfigure 回调) */
  set(configs: SubagentConfig[]): void
  /** 追加一个 subagent(id 重复 warn 跳过) */
  add(config: SubagentConfig): void
  /** 移除一个 subagent(by id);返回是否移除成功 */
  remove(id: string): boolean
  /** 读取当前 subagents 列表 */
  get(): SubagentConfig[]
}

/**
 * 预声明子 agent 中间件:为每个 SubagentConfig 生成专属委派工具 use_<id>({ task })。
 * 主 LLM 直接调 use_<id> 委派(工具描述 = subagent.description);子 agent 配置缺省继承主。
 * 与 spawn_agent/spawn_agents(运行时自由委派)共存。子 agent 默认叶子(maxDepth 1,不可再 spawn)。
 * 支持运行时动态:经 controller.set/add/remove 重新生成委派工具,触发 onReconfigure 回调(供 createAgent rebind)。
 */
export function createSubagentsMiddleware(
  subagents: SubagentConfig[],
  main: SubagentsMiddlewareOptions,
): Middleware & { controller: SubagentsController } {
  // 当前主循环 signal/emit/logSink(供 use_<id> 继承/转发子进度)。
  // CA 并发修复(per-call 通道):优先工具 fn 第二参 config.configurable.__pgSubagentCall(并发各持独立值),
  // 闭包单变量降 fallback —— 同 spawn 侧 callCtxOf 模式
  let currentSignal: AbortSignal | undefined
  let currentEmit: ((e: StreamEvent) => void) | undefined
  let currentLogSink: ((e: any) => void) | undefined
  const callCtxOf = (config: unknown): { signal?: AbortSignal; emit?: (e: StreamEvent) => void; logSink?: (e: any) => void } => {
    const c = (config as { configurable?: Record<string, unknown> } | undefined)?.configurable?.__pgSubagentCall as
      | { signal?: AbortSignal; emit?: (e: StreamEvent) => void; logSink?: (e: any) => void }
      | undefined
    return c ?? { signal: currentSignal, emit: currentEmit, logSink: currentLogSink }
  }
  const makeForward = (taskId: string, label: string, emit?: (e: StreamEvent) => void) => (e: SubProgress): void => {
    // reasoning 高频增量:只转发 delta 到 UI(spawnStep.subReason 累积),不附 name/args
    if (e.type === 'reasoning') {
      emit?.({ type: 'subagent', taskId, label, kind: 'reasoning', name: '', delta: e.delta })
      return
    }
    if (!emit) return
    emit({
      type: 'subagent', taskId, label, kind: e.type, name: e.name,
      args: e.type === 'tool_call' ? e.args : undefined,
      result: e.type === 'tool_result' ? e.result : undefined,
      status: e.type === 'tool_result' ? e.status : undefined,
    })
  }

  // 可变状态:支持运行时 set/add/remove
  let valid: SubagentConfig[] = []
  let tools: StructuredToolInterface[] = []
  let onReconfigure: (() => void) | undefined

  /** 校验 + 生成委派工具(去重 by id) */
  function rebuild(list: SubagentConfig[]): { valid: SubagentConfig[]; tools: StructuredToolInterface[] } {
    const seen = new Set<string>()
    const v: SubagentConfig[] = []
    const t: StructuredToolInterface[] = []
    for (const s of list) {
      if (!TOOL_NAME_RE.test(s.id)) {
        console.warn(`[subagents] id "${s.id}" 非合法工具名(须 [a-zA-Z_][a-zA-Z0-9_]*),已跳过`)
        continue
      }
      const toolName = `use_${s.id}`
      if (seen.has(toolName)) {
        console.warn(`[subagents] id "${s.id}" 重复,已跳过`)
        continue
      }
      seen.add(toolName)
      v.push(s)
      t.push(
        tool(
          async ({ task, components }, config) => {
            // per-call signal/emit/logSink(CA 并发修复):并发委派各用各的
            const call = callCtxOf(config)
            const opts = configToSubOpts(s, main)
            const onLog = (entry: any) => call.logSink?.({ ...entry, source: `子:${s.id}` })
            // 观察层:唯一 observeId(并发安全 —— 同 use_<id> 多次并发不冲突);
            // 事件 taskId 保持 use_${s.id} 不变(不破坏 UI 嵌套分组),steps 经 forward wrapper 累积到 observeId
            const tracker = main.tracker
            const observeId = tracker ? `use_${s.id}-${Math.random().toString(36).slice(2, 6)}` : `use_${s.id}`
            // 组件锁(Q2:同组件单委派互斥):解析目标组件 → acquire(非阻塞无排队)→ 跑 → finally release。
            // acquire 失败立即回灌 COMPONENT_BUSY(recoverable 字符串结果,主 LLM 换顺序/下轮重委派),
            // 不排队不占 runPool 并发槽干等;锁事件经 logSink 留痕(acquire/conflict/release,kind 区分)
            const lock = main.componentLock
            const lockOwner = observeId
            let lockRelease: (() => void) | undefined
            let lockNames: string[] = []
            const logLock = (kind: 'acquire' | 'conflict' | 'release', extra?: Record<string, unknown>) =>
              call.logSink?.({ timestamp: Date.now(), type: 'middleware', data: { name: 'component-lock', kind, components: lockNames, owner: lockOwner, ...extra } })
            if (lock) {
              const res = main.resolveComponents?.({ components, task })
              lockNames = res?.names ?? []
              if (lockNames.length) {
                const acq = await lock.acquire(lockNames, lockOwner)
                if (!acq.ok) {
                  logLock('conflict', { heldBy: acq.heldBy })
                  return `COMPONENT_BUSY · 组件 [${lockNames.join(', ')}] 正在被子 agent(${acq.heldBy})修改,本次委派未执行。同一组件同一时间只能有一个委派在途;请先做其他组件,或等该委派结束后(下一轮)再重试本组件。`
                }
                lockRelease = acq.release
                logLock('acquire')
              }
            }
            const baseForward = makeForward(`use_${s.id}`, s.id, call.emit)
            const forward = tracker
              ? (e: SubProgress) => {
                  // reasoning 高频增量不进 tracker 步骤摘要(防爆);只 baseForward 转发到 UI
                  if (e.type !== 'reasoning') tracker.pushStep(observeId, { kind: e.type, name: e.name, ts: Date.now() })
                  baseForward(e)
                }
              : baseForward
            const startedAt = Date.now()
            tracker?.start(observeId, task, s.id, startedAt)
            try {
              const result = await runSubagent({ prompt: task }, opts, call.signal, forward, onLog, call.emit)
              tracker?.finish(observeId, 'done', result)
              return result
            } catch (e) {
              tracker?.finish(observeId, 'error', String((e as Error)?.message ?? e))
              throw e
            } finally {
              // 幂等 release(finally 兜底覆盖正常/异常/abort 全路径)
              if (lockRelease) { lockRelease(); logLock('release') }
            }
          },
          {
            name: `use_${s.id}`,
            description: `委派给「${s.description}」子 agent 执行任务,返回其结论(过程隔离,不占主上下文)。`,
            schema: z.object({
              task: z.string().describe('委派给该子 agent 的任务描述'),
              components: z.array(z.string()).optional().describe('本次委派要修改的组件名列表(并行委派时必填,框架按组件互斥:同组件同时只允许一个委派在途)'),
            }),
          },
        ),
      )
    }
    return { valid: v, tools: t }
  }

  const initial = rebuild(subagents)
  valid = initial.valid
  tools = initial.tools

  const controller: SubagentsController = {
    set(configs) {
      const r = rebuild(configs)
      valid = r.valid
      tools = r.tools
      onReconfigure?.()
    },
    add(config) {
      const exists = valid.some((s) => s.id === config.id)
      if (exists) {
        console.warn(`[subagents] add: id "${config.id}" 已存在,已跳过`)
        return
      }
      const r = rebuild([...valid, config])
      valid = r.valid
      tools = r.tools
      onReconfigure?.()
    },
    remove(id) {
      const idx = valid.findIndex((s) => s.id === id)
      if (idx < 0) return false
      const next = valid.filter((s) => s.id !== id)
      const r = rebuild(next)
      valid = r.valid
      tools = r.tools
      onReconfigure?.()
      return true
    },
    get: () => [...valid],
  }

  const mw: Middleware = {
    name: 'subagents',
    get tools() {
      return tools
    },
    augmentPrompt: () =>
      valid.length
        ? [
            '## 可用子 agent(预声明,经专属工具委派)',
            ...valid.map((s) => `- use_${s.id}: ${s.description}`),
            '复杂或专项任务(检索 / 生成 / 调研 / 多步等)优先委派子 agent:过程隔离不占主上下文 + 各子 agent 专项处理更优。需要时直接调 use_<id>({ task }) 委派,任务描述要清晰(含背景 + 用户观点/反馈,转述给子 agent);委派后信任子 agent 自主完成,不微操、不读其代码/中间细节(少占主上下文),只据其结论继续。简单任务(单字段改、直接读)用内置工具更快,不必委派。',
          ].join('\n')
        : undefined,
    wrapToolCall: async (ctx, next) => {
      if (ctx.signal) currentSignal = ctx.signal
      if (ctx.emit) currentEmit = ctx.emit
      if (ctx.logSink) currentLogSink = ctx.logSink
      // per-call 注入(CA 并发修复):随 ctx.callConfig 经 RunnableConfig 透传到 use_<id> fn 第二参
      ctx.callConfig = { ...(ctx.callConfig ?? {}), __pgSubagentCall: { signal: ctx.signal ?? currentSignal, emit: ctx.emit ?? currentEmit, logSink: ctx.logSink ?? currentLogSink } }
      return next(ctx)
    },
  }
  // controller 不可枚举挂载(类比 SkillsController);暴露 onReconfigure setter 供 createAgent 注入 rebind 回调
  Object.defineProperty(mw, 'controller', { value: controller, enumerable: false })
  Object.defineProperty(mw, 'setReconfigureHook', {
    value: (fn: (() => void) | undefined) => { onReconfigure = fn },
    enumerable: false,
  })
  return mw as Middleware & { controller: SubagentsController }
}
