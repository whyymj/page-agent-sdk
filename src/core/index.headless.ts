/**
 * page-agent-sdk/headless —— 精简入口(纯核心,不含 UI)
 *
 * 与主入口 `page-agent-sdk`(index.ts)公开签名完全一致(createChatSdk(options): ChatSdk),
 * 但**打包产物不含 UI 层**:不注入 mountChatDialog → 不 import ChatDialog + 13 个原子组件 + marked/highlight.js/dompurify。
 * 给 `ui: false` 的 headless 集成方(自建对话框)获取精简 bundle(ESM ~530-550KB,主包 789KB)。
 *
 * - **不导出** ChatDialog/MessageContent/CodePreview/SkillPanel/ChatHeader/ChatInput/MessageList/
 *   MessageRow/QueuedBar/ApprovalBar/ConflictBar/FocusBar/DebugDrawer(13 个 .vue 组件)。
 * - **保留** createChatContext/chatContextKey/useChatContext/useChat(L2 自建 UI 拼装 API,无 UI 组件依赖)+ 全部核心 API。
 *
 * 降级语义:本入口创建的 sdk,若 `ui !== false`(默认 'default')且无 mounter → mount() 触发 console.warn
 * 提示降级 headless(不渲染 DOM);集成方用 ui:false + sdk.messages/send/stream 自建 UI。
 *
 * 如需内置 ChatDialog,改 `import { createChatSdk } from 'page-agent-sdk'`(主包)。
 */
// zod:随 SDK 暴露(构造 data schema)
export { z } from 'zod'
// 代理连接模块(防 apiKey 泄露:proxy 代理模式 / direct 直连模式)
export { createProxyLlm } from './llm/proxyLlm'
export type { ProxyLlmMode, ProxyLlmOptions } from './llm/proxyLlm'
export { constructLlmFromConfig, constructOpenLlmSync } from './llm/constructLlm'
export type { ConstructOpts } from './llm/constructLlm'
export { extractTextDelta, extractReasoningDelta, extractUsage } from './utils/contentParts'
// SDK 命令式入口(headless:不注入 mountChatDialog → 不含 UI)
import { _createChatSdk } from './sdk/createChatSdk'
import type { ChatSdkOptions, ChatSdk } from './sdk/createChatSdk'
export function createChatSdk(options: ChatSdkOptions): ChatSdk {
  return _createChatSdk(options) // 无 mounter → headless(ui!=='false' 时 mount() warn 降级)
}
export type { ChatSdkOptions, ChatSdk, LLMConfig, PendingConflict, DialogConfig, SystemAugmentContext } from './sdk/createChatSdk'
// system prompt 构建
export { buildSystemPrompt, buildDataPrompt, DEFAULT_SYSTEM_PROMPT } from './sdk/promptBuilder'
export { resolveContextOptions, type ContextPreset, CONTEXT_PRESETS } from './sdk/contextPreset'
// capabilities 能力开关注册表 + 单一解析
export { resolveCapabilities, CAPABILITIES, type Capability, type CapabilityFlags, type ResolvedCapabilities } from './capabilities'
export { defineTool } from './sdk/defineTool'
// 宿主动作(actions):集成方注册页面操作(保存/发布/预览等),SDK 自动包成命名 tool 供 agent 调用
export { actionsToTools, actionsToInspectInfo } from './sdk/actions'
export type { ActionDef, ActionMap } from './sdk/actions'
export { presets, systemPromptHelpers, extractSchemaHint } from './presets'
export type { SchemaHintOptions } from './presets'
export { connectMcp, extractText } from './mcp/client'
export type { McpServerConfig, McpTransport, McpConnection } from './mcp/client'
// harness 核心 + 中间件契约
export { createAgent, detectGarbledToolCall } from './harness/createAgent'
export type { CreateAgentOptions, DebugLog, TraceSpan, TraceMetrics, SpanType, SpanStatus } from './harness/createAgent'
export type { Middleware, ModelRequest, ModelResponse, ToolCallContext, StateUpdate } from './harness/middleware'
export { createSubagentMiddleware, createSubagentsMiddleware, createSubagentTracker } from './harness/subagent'
export type { SubagentOptions, SubagentLlmConfig, SubagentConfig, SubagentsController, SubagentStep, SubagentRunState, SubagentTracker } from './harness/subagent'
// 能力包(专用子 agent 工厂):RAG 多源检索(createRagSubagent)+ HTML 代码组件生成(createHtmlSubagent)
export { createRagSubagent } from './sdk/ragSubagent'
export type { RagHit, RagRetrieveOptions, RagRetriever, RagLoader, CreateRagSubagentOptions } from './sdk/ragSubagent'
export { createHtmlSubagent } from './sdk/htmlSubagent'
export type { CreateHtmlSubagentOptions } from './sdk/htmlSubagent'
export { createVerifyMiddleware, createWriteBackCheck } from './harness/verify'
export type { VerifyCheck, VerifyCheckContext, VerifyCheckResult, VerifyMiddlewareOptions, WriteBackCheckOptions } from './harness/verify'
export { createContextInspectorMiddleware } from './harness/contextInspector'
export { isContextLengthError } from './harness/errors'
export type { ContextInspectorMiddleware, ContextInspectorOptions } from './harness/contextInspector'
export { analyzeContext } from './utils/contextAnalysis'
export type { ContextSnapshot, ContextCategory, AnalyzeContextOptions } from './utils/contextAnalysis'
export { createMemoryMiddleware } from './harness/memory'
export type { MemorySource } from './harness/memory'
export { createApprovalMiddleware } from './harness/approval'
export type { ApprovalOptions } from './harness/approval'
export { createHumanConfirmTool, createHumanConfirmMiddleware, HUMAN_CONFIRM_TOOL_NAME } from './harness/humanConfirm'
export { createCheckpointManager, createCheckpointMiddleware } from './harness/checkpoint'
export type { CheckpointManager, CheckpointMeta, CheckpointDeps } from './harness/checkpoint'
export { defineSkill } from './harness/skills'
export type { SkillSpec } from './harness/skills'
// 数据操作类型(单主对象 + 增量编辑 + 快照)
export type { DataConfig, DataOpsOptions, DataOpsController, DataAuditEntry, DataSnapshotEntry, ConflictInfo, ConflictResolution, DataInterceptors, ToolMode } from './tools/dataOps'
export type { ResourceProtectSpec } from './tools/resources'
export type { SkillsController } from './harness/skills'
// 内置工具集(可独立导出 + 手动注入,配合 capabilities.dataOps/fetch 关闭默认自动装配)
export { createDataOps, filterByToolMode, commitSetToBind } from './tools/dataOps'
export { getTraceMetrics } from './utils/traceMetrics'
export { jpEval, searchJson, runSandboxedScript } from './tools/dataSlotQuery'
export type { JpNode, SearchHit, SearchMode, EvalResult } from './tools/dataSlotQuery'
// 通用 Worker 沙箱(eval_script 与 skill exec 共用;三层防护单一真相源)
export { createSandboxRunner } from './tools/sandbox'
export type { SandboxResult } from './tools/sandbox'
// 宿主脚本执行器(skill exec context:'host',opt-in 全权;不经静态扫描)
export { runHostScript } from './tools/hostScript'
// 通用 JSON 操作纯函数(零依赖、白盒可测)
export {
  UNSAFE_KEYS, isUnsafePath, safeMerge, getByPath, setByPath, deleteByPath,
  deepClone, maybeParseValue, projectFields, limitDepth, safeStringify, hashValue,
  applyPatchToClone, applyPatchToLive, restoreLive, restoreInPlace, diffObjects,
} from './tools/jsonUtils'
export type { EditOp } from './tools/jsonUtils'
// schema 白名单投影纯函数
export { getSchemaTopKeys, isPathAllowed, unwrapSchema, getSchemaAtPath, projectBySchemaDeep, projectBySchema, describeSchemaNode, renderSchemaHint, renderSchemaOverview, renderSchemaShallow, formatConstraints } from './tools/schemaUtils'
export type { SchemaNodeDesc } from './tools/schemaUtils'
// 上下文索引纯函数
export { STOP_WORDS, tokenize, estimateMessageTokens, estimateRoundTokens, indexSummarize, recallRounds, shouldTriggerCompression } from './composables/contextIndex'
export { CompressDecisionSchema, type CompressDecision } from './sdk/compressDecision'
// LLM 解析
export { isChatModel, resolveLlm, deriveTitle } from './sdk/llmResolver'
// 乐观锁冲突管理器(headless 自建冲突 UI 可复用)
export { createConflictManager } from './sdk/conflictManager'
export type { ConflictManager } from './sdk/conflictManager'
// 配置解析
export { resolveStorage, resolveDialogConfig } from './sdk/optionsResolver'
// SDK 事件系统工厂
export { createSdkEvents } from './sdk/events'
export type { SdkEvents } from './sdk/events'
export { toolError, zodError, jsonParseError, formatZodIssues, routeError, asAgentError, agentError } from './tools/toolError'
export type { ToolErrorInput, ErrorSeverity, AgentError, ErrorRouting } from './tools/toolError'
export { fetchDocTools } from './tools/fetchDoc'
export { domTools, getDomTool, domToStructure } from './tools/domTool'
export type { DomNode, DomReadOptions } from './tools/domTool'
export { inspectTools, inspectEnvTool, safeSerialize, getEnvSummary } from './tools/envTool'
export { fetchTools, defineDataToolset, selectBuiltinTools, domToolsStatic } from './toolsets'
export { createUsageHintsMiddleware } from './harness/usageHints'
export type { PermissionRule, PermissionOp } from './harness/permissions'
// 虚拟工作区
export { createVfs } from './backends/vfs'
// 持久化存储(IndexedDB + 多 agent 隔离 + 全局配额/LRU 淘汰)
export { createSessionStore, createMemoryBackend, createWebStorageBackend, isQuotaError } from './backends/storage'
export type { StorageConfig, StorageBackendType, SessionStore, SessionMeta, SessionSnapshot, StorageEvent, StorageBackend } from './backends/storage'
export { createSkillStore } from './backends/skillStore'
export type { SkillStore, SkillStoreConfig, PersistedSkill } from './backends/skillStore'
// 通用消息 / 上下文类型
export type { AgentMessage, AgentConfig, AgentState, StreamEvent, StreamHandler, SdkEvent, SdkEventHandler, TokenUsage, ToolStep, BatchResult, BatchProgress } from './types'
export type { Focus } from './harness/state'
export type { AgentInfo, ToolInfo, SkillInfo, DataInfo, SubagentInfo } from './types'
export type { ContextManagerOptions, CompressionStats } from './composables/useContextManager'
export { resolveModelCaps, estimateTokens, offloadThresholdChars, offloadPassThroughChars, MIN_CONTEXT_WINDOW } from './utils/modelCaps'
export type { ModelCaps } from './utils/modelCaps'
export { copyText } from './utils/clipboard'
export { createSerialRunner } from './utils/serialRunner'
// chatContext 枢纽(L2 自建根组件时调 createChatContext + provide(chatContextKey);原子组件经 useChatContext inject)
// headless 保留这些 API(无 UI 组件依赖);仅不导出 13 个 .vue 组件
export { createChatContext, chatContextKey, useChatContext } from './composables/chatContext'
export type { ChatContext, ChatContextOptions } from './composables/chatContext'
export { useChat } from './composables/useChat'
