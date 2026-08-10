/**
 * page-agent-sdk 通用 SDK 入口(框架无关)
 *
 * 只导出通用核心 —— createChatSdk(命令式入口)/ createAgent(harness)/ 中间件契约类型 /
 * 数据操作类型 / vfs / 通用消息类型。不含任何业务定制或旧链路,可整体迁移到任意项目复用。
 */
// zod:随 SDK 暴露(IIFE 全量模式下消费者从 ChatSdk.z 取用,构造 data schema)
export { z } from 'zod'
// 代理连接模块(防 apiKey 泄露:proxy 代理模式 / direct 直连模式)
export { createProxyLlm } from './llm/proxyLlm'
export type { ProxyLlmMode, ProxyLlmOptions } from './llm/proxyLlm'
export { constructLlmFromConfig, constructOpenLlmSync } from './llm/constructLlm'
export type { ConstructOpts } from './llm/constructLlm'
export { extractTextDelta, extractReasoningDelta, extractUsage } from './utils/contentParts'
// SDK 命令式入口(主入口:注入 mountChatDialog → 含 UI;headless 子路径 index.headless.ts 不注入 → 不含 UI)
import { _createChatSdk } from './sdk/createChatSdk'
import { mountChatDialog } from './sdk/mountChatDialog'
import type { ChatSdkOptions, ChatSdk } from './sdk/createChatSdk'
export function createChatSdk(options: ChatSdkOptions): ChatSdk {
  return _createChatSdk(options, mountChatDialog)
}
export type { ChatSdkOptions, ChatSdk, LLMConfig, PendingConflict, DialogConfig, SystemAugmentContext } from './sdk/createChatSdk'
// system prompt 构建(refactor-module-extraction 从 createChatSdk 抽离;buildSystemPrompt 为纯函数,供 fix-introspection-consistency 的 getEffectiveSystemPrompt 复用)
export { buildSystemPrompt, buildDataPrompt, DEFAULT_SYSTEM_PROMPT } from './sdk/promptBuilder'
export { resolveContextOptions, type ContextPreset, CONTEXT_PRESETS } from './sdk/contextPreset'
// capabilities 能力开关注册表 + 单一解析(p2-refactor 子项 4:消除 ===true/!==false 混)
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
// 通用 Worker 沙箱(skill-external-scripts:eval_script 与 skill exec 共用;三层防护单一真相源)
export { createSandboxRunner } from './tools/sandbox'
export type { SandboxResult } from './tools/sandbox'
// 宿主脚本执行器(skill exec context:'host',opt-in 全权;不经静态扫描)
export { runHostScript } from './tools/hostScript'
// 通用 JSON 操作纯函数(refactor-module-extraction 从 dataOps 抽离;零依赖、白盒可测,经 ./query subpath 按需引入)
export {
  UNSAFE_KEYS, isUnsafePath, safeMerge, getByPath, setByPath, deleteByPath,
  deepClone, maybeParseValue, projectFields, limitDepth, safeStringify, hashValue,
  applyPatchToClone, applyPatchToLive, restoreLive, restoreInPlace, diffObjects,
} from './tools/jsonUtils'
export type { EditOp } from './tools/jsonUtils'
// schema 白名单投影纯函数(refactor-module-extraction 从 dataOps 抽离;expose-schema-constraints 的 describeSchemaNode 归宿)
export { getSchemaTopKeys, isPathAllowed, unwrapSchema, getSchemaAtPath, projectBySchemaDeep, projectBySchema, describeSchemaNode, renderSchemaHint, renderSchemaOverview, renderSchemaShallow, formatConstraints } from './tools/schemaUtils'
export type { SchemaNodeDesc } from './tools/schemaUtils'
// 上下文索引纯函数(refactor-module-extraction 期二 从 useContextManager 抽离;白盒可测)
export { STOP_WORDS, tokenize, estimateMessageTokens, estimateRoundTokens, indexSummarize, recallRounds, shouldTriggerCompression } from './composables/contextIndex'
export { CompressDecisionSchema, type CompressDecision } from './sdk/compressDecision'
// LLM 解析(refactor-module-extraction 期二 从 createChatSdk 抽离;isChatModel 实例判定 + resolveLlm 初始装配入口)
export { isChatModel, resolveLlm, deriveTitle } from './sdk/llmResolver'
// 乐观锁冲突管理器(refactor-module-extraction 期二 从 createChatSdk 抽离;headless 自建冲突 UI 可复用)
export { createConflictManager } from './sdk/conflictManager'
export type { ConflictManager } from './sdk/conflictManager'
// 配置解析(refactor-module-extraction 期三 从 createChatSdk 抽离)
export { resolveStorage, resolveDialogConfig } from './sdk/optionsResolver'
// SDK 事件系统工厂(refactor-module-extraction 期三 从 createChatSdk 抽离;高级复用:自建事件分发)
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
// UI 模块(组件 + composable,供 headless 自建 UI 复用)
export { default as ChatDialog } from './components/ChatDialog.vue'
export { default as MessageContent } from './components/MessageContent.vue'
export { default as CodePreview } from './components/CodePreview.vue'
export { default as SkillPanel } from './components/SkillPanel.vue'
// chatdialog-component-split:ChatDialog 拆出的原子组件(可拼装/可替换,经 ChatDialog 具名 slot 替换,或 L2 自建根组件 provide ctx 后自由拼装)
export { default as ChatHeader } from './components/ChatHeader.vue'
export { default as ChatInput } from './components/ChatInput.vue'
export { default as MessageList } from './components/message/MessageList.vue'
export { default as MessageRow } from './components/message/MessageRow.vue'
export { default as QueuedBar } from './components/QueuedBar.vue'
export { default as ApprovalBar } from './components/ApprovalBar.vue'
export { default as ConflictBar } from './components/ConflictBar.vue'
export { default as FocusBar } from './components/FocusBar.vue'
// DebugDrawer:调试抽屉(纯 props 驱动:logs/visible/getInfo/infoTick/getSkillContent;不 inject chatContext,headless 自建对话框可复用)
export { default as DebugDrawer } from './components/DebugDrawer.vue'
// chatContext 枢纽(L2 自建根组件时调 createChatContext + provide(chatContextKey);原子组件经 useChatContext inject)
export { createChatContext, chatContextKey, useChatContext } from './composables/chatContext'
export type { ChatContext, ChatContextOptions } from './composables/chatContext'
export { useChat } from './composables/useChat'
