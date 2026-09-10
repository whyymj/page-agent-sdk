/* types-alignment —— d.ts ↔ src 内联接口双向 key 对齐门禁(audit-sdk-integrity A 专项 / P1-24 / P1-27)
 *
 * 背景:H15 证实 src 内部经 `: ChatSdk`/`: AgentCore` 双注解 + tsc 结构检查已机械保底,
 * 系统性缺口只在「对外 types/*.d.ts 与 src 手动同步、从不同编、零互比」—— 2.38 getActiveSubagents、
 * P1-24 send options、P1-27 agentCompression 三起事故同型。本门禁把 d.ts 与 src 拉进同一编译单元互比。
 *
 * 原理:用 keyof 联合双向 extends(而非对象类型双向赋值)对比 key 集合 ——
 * 可选属性对象双向赋值对「多一个可选 key」互相兼容(抓不到漂移),keyof 联合能精确抓 key 集合差异。
 * `[A] extends [B]`(元组包裹)禁用条件类型分配,避免 `true | never = true` 吞掉失败项。
 *
 * src 侧经 import 自动纳入类型检查:createChatSdk.ts(headless 依赖反转后不 import .vue)类型图纯 .ts,
 * 且 src 非测试代码零类型错误(CLAUDE.md「src 真错门禁」),故可安全与 d.ts 同编。
 */
import type { ChatSdk as DtsChatSdk, ChatSdkOptions as DtsOptions } from '../types/index'
import type { ChatSdk as SrcChatSdk, ChatSdkOptions as SrcOptions } from '../src/core/sdk/createChatSdk'

/** key 集合(NonNullable 防 options 可选参数带 undefined) */
type Keys<T> = keyof NonNullable<T>
/** 子集判定:`true`=A⊆B;`never`=存在 A 有 B 无的 key(元组禁分配,防 never 被并吞) */
type Subset<A, B> = [A] extends [B] ? true : never

// 1. capabilities 开关 key 集合对齐(P1-27:d.ts 曾漏 agentCompression)
type DtsCaps = Keys<DtsOptions['capabilities']>
type SrcCaps = Keys<SrcOptions['capabilities']>
export const _capsDtsSubsetSrc: Subset<DtsCaps, SrcCaps> = true
export const _capsSrcSubsetDts: Subset<SrcCaps, DtsCaps> = true

// 2. ChatSdkOptions 顶层配置 key 集合对齐(防新增配置项漏入/漂移出 d.ts)
export const _optsDtsSubsetSrc: Subset<Keys<DtsOptions>, Keys<SrcOptions>> = true
export const _optsSrcSubsetDts: Subset<Keys<SrcOptions>, Keys<DtsOptions>> = true

// 3. ChatSdk 实例方法/属性 key 集合对齐(防 AgentCore/ChatSdk 方法漂移 —— 2.38 getActiveSubagents 同型)
export const _sdkDtsSubsetSrc: Subset<Keys<DtsChatSdk>, Keys<SrcChatSdk>> = true
export const _sdkSrcSubsetDts: Subset<Keys<SrcChatSdk>, Keys<DtsChatSdk>> = true

// 4. send options key 集合对齐(P1-24:d.ts 曾漏 maxAutoRetries)
type DtsSendOpts = Parameters<DtsChatSdk['send']>[1]
type SrcSendOpts = Parameters<SrcChatSdk['send']>[1]
export const _sendDtsSubsetSrc: Subset<Keys<DtsSendOpts>, Keys<SrcSendOpts>> = true
export const _sendSrcSubsetDts: Subset<Keys<SrcSendOpts>, Keys<DtsSendOpts>> = true

// ===== 5. E1 API 面收口(2026-09-09 audit-remediation):harness/中间件类型 + 核心工厂签名级对齐 =====
// Same = 双向互赋值(比 keyof 更严:字段类型也须结构一致);适用于闭包内不含 vue Ref 的类型。
// 含 Ref 的工厂返回值(createAgent 的 debugLogs/useChat 的 scrollContainer 等)只做 ReturnType keyof 双向
// Subset(E2 内联桩化 Ref 后双向互赋值必失败,品牌符号差异,非真漂移)。

import type {
  Middleware as DtsMiddleware, ModelRequest as DtsModelRequest, ModelResponse as DtsModelResponse,
  ToolCallContext as DtsToolCallContext, ToolExecResult as DtsToolExecResult, StateUpdate as DtsStateUpdate,
  BeforeReturnContext as DtsBeforeReturnContext, BeforeReturnHook as DtsBeforeReturnHook,
  HarnessState as DtsHarnessState, Todo as DtsTodo, VfsFile as DtsVfsFile, SkillMeta as DtsSkillMeta,
  SummarizationEvent as DtsSummarizationEvent, LoopProgress as DtsLoopProgress,
  CreateAgentOptions as DtsCreateAgentOptions, SubagentOptions as DtsSubagentOptions,
  VfsOptions as DtsVfsOptions, VfsStore as DtsVfsStore,
  ContextOptionsInput as DtsContextOptionsInput, ContextManagerOptions as DtsContextManagerOptions,
  UseChatOptions as DtsUseChatOptions,
  createVfs as DtsCreateVfs, resolveContextOptions as DtsResolveContextOptions,
  createSubagentMiddleware as DtsCreateSubagentMiddleware, createAgent as DtsCreateAgent, useChat as DtsUseChat,
} from '../types/index'
import type {
  Middleware as SrcMiddleware, ModelRequest as SrcModelRequest, ModelResponse as SrcModelResponse,
  ToolCallContext as SrcToolCallContext, ToolExecResult as SrcToolExecResult, StateUpdate as SrcStateUpdate,
  BeforeReturnContext as SrcBeforeReturnContext, BeforeReturnHook as SrcBeforeReturnHook,
} from '../src/core/harness/middleware'
import type {
  HarnessState as SrcHarnessState, Todo as SrcTodo, VfsFile as SrcVfsFile, SkillMeta as SrcSkillMeta,
  SummarizationEvent as SrcSummarizationEvent, LoopProgress as SrcLoopProgress,
} from '../src/core/harness/state'
import type { SubagentOptions as SrcSubagentOptions, createSubagentMiddleware as SrcCreateSubagentMiddleware } from '../src/core/harness/subagent'
import type { createAgent as SrcCreateAgent, CreateAgentOptions as SrcCreateAgentOptions } from '../src/core/harness/createAgent'
import type { createVfs as SrcCreateVfs, VfsOptions as SrcVfsOptions, VfsStore as SrcVfsStore } from '../src/core/backends/vfs'
import type { resolveContextOptions as SrcResolveContextOptions, ContextOptionsInput as SrcContextOptionsInput } from '../src/core/sdk/contextPreset'
import type { ContextManagerOptions as SrcContextManagerOptions } from '../src/core/composables/useContextManager'
import type { useChat as SrcUseChat, UseChatOptions as SrcUseChatOptions } from '../src/core/composables/useChat'

/** 双向互赋值:`true`=A 与 B 结构互换一致;`never`=存在差异(字段名/必选性/类型任一不同) */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

// 5.1 中间件契约 10 钩子 + 上下文类型(d.ts 曾全 [k:string]:any)。
// 注:Same(双向互赋值)抓字段类型漂移但抓不到「多一个可选键」,keyof 双向 Subset 恰好互补 —— 对象类型两者都上
export const _mwSame: Same<DtsMiddleware, SrcMiddleware> = true
export const _mwKeysD2S: Subset<keyof DtsMiddleware, keyof SrcMiddleware> = true
export const _mwKeysS2D: Subset<keyof SrcMiddleware, keyof DtsMiddleware> = true
export const _modelRequestSame: Same<DtsModelRequest, SrcModelRequest> = true
export const _modelResponseSame: Same<DtsModelResponse, SrcModelResponse> = true
export const _toolCallCtxSame: Same<DtsToolCallContext, SrcToolCallContext> = true
export const _toolExecResultSame: Same<DtsToolExecResult, SrcToolExecResult> = true
export const _stateUpdateSame: Same<DtsStateUpdate, SrcStateUpdate> = true
export const _beforeReturnCtxSame: Same<DtsBeforeReturnContext, SrcBeforeReturnContext> = true
export const _beforeReturnHookSame: Same<DtsBeforeReturnHook, SrcBeforeReturnHook> = true

// 5.2 HarnessState + 成员类型(装配 state 的公开面)
export const _harnessStateSame: Same<DtsHarnessState, SrcHarnessState> = true
export const _harnessStateKeysD2S: Subset<keyof DtsHarnessState, keyof SrcHarnessState> = true
export const _harnessStateKeysS2D: Subset<keyof SrcHarnessState, keyof DtsHarnessState> = true
export const _todoSame: Same<DtsTodo, SrcTodo> = true
export const _vfsFileSame: Same<DtsVfsFile, SrcVfsFile> = true
export const _skillMetaSame: Same<DtsSkillMeta, SrcSkillMeta> = true
export const _summarizationEventSame: Same<DtsSummarizationEvent, SrcSummarizationEvent> = true
export const _loopProgressSame: Same<DtsLoopProgress, SrcLoopProgress> = true

// 5.3 核心工厂参数/返回(无 Ref 闭包:全签名互赋值)
export const _createVfsSigSame: Same<typeof DtsCreateVfs, typeof SrcCreateVfs> = true
export const _resolveContextOptionsSigSame: Same<typeof DtsResolveContextOptions, typeof SrcResolveContextOptions> = true
export const _createSubagentMwSigSame: Same<typeof DtsCreateSubagentMiddleware, typeof SrcCreateSubagentMiddleware> = true
export const _createSubagentMwOptsSame: Same<DtsSubagentOptions, SrcSubagentOptions> = true
export const _createSubagentMwOptsKeysD2S: Subset<keyof DtsSubagentOptions, keyof SrcSubagentOptions> = true
export const _createSubagentMwOptsKeysS2D: Subset<keyof SrcSubagentOptions, keyof DtsSubagentOptions> = true
export const _contextOptionsInputSame: Same<DtsContextOptionsInput, SrcContextOptionsInput> = true
export const _contextManagerOptionsSame: Same<DtsContextManagerOptions, SrcContextManagerOptions> = true
export const _vfsOptionsSame: Same<DtsVfsOptions, SrcVfsOptions> = true
export const _vfsStoreSame: Same<DtsVfsStore, SrcVfsStore> = true

// 5.4 含 Ref 闭包工厂:参数全签名互赋值 + 返回值 key 集合双向(Ref 品牌符号见头部注记)
export const _createAgentOptsSame: Same<DtsCreateAgentOptions, SrcCreateAgentOptions> = true
export const _createAgentOptsKeysD2S: Subset<keyof DtsCreateAgentOptions, keyof SrcCreateAgentOptions> = true
export const _createAgentOptsKeysS2D: Subset<keyof SrcCreateAgentOptions, keyof DtsCreateAgentOptions> = true
export const _useChatOptsSame: Same<DtsUseChatOptions, SrcUseChatOptions> = true
export const _useChatOptsKeysD2S: Subset<keyof DtsUseChatOptions, keyof SrcUseChatOptions> = true
export const _useChatOptsKeysS2D: Subset<keyof SrcUseChatOptions, keyof DtsUseChatOptions> = true
type DtsAgentReturn = ReturnType<typeof DtsCreateAgent>
type SrcAgentReturn = ReturnType<typeof SrcCreateAgent>
export const _agentReturnDtsSubsetSrc: Subset<Keys<DtsAgentReturn>, Keys<SrcAgentReturn>> = true
export const _agentReturnSrcSubsetDts: Subset<Keys<SrcAgentReturn>, Keys<DtsAgentReturn>> = true
type DtsUseChatReturn = ReturnType<typeof DtsUseChat>
type SrcUseChatReturn = ReturnType<typeof SrcUseChat>
export const _useChatReturnDtsSubsetSrc: Subset<Keys<DtsUseChatReturn>, Keys<SrcUseChatReturn>> = true
export const _useChatReturnSrcSubsetDts: Subset<Keys<SrcUseChatReturn>, Keys<DtsUseChatReturn>> = true

// ===== 6. headless.d.ts 侧对齐(2026-09-10 code-review M1:门禁曾只编 index.d.ts,headless 漂移静默)=====
// 高漂移面(事件 union / 日志 / usage / 消息面)headless-vs-src 双向锁定;headless 与 index 同构的类型经各自
// 与 src 的 Same 间接互锁,不另做 index↔headless 直接比对(同构性由 src 锚定)
import type {
  StreamEvent as HStreamEvent, SdkEvent as HSdkEvent, DebugLog as HDebugLog, TokenUsage as HTokenUsage,
  AgentMessage as HAgentMessage, ToolStep as HToolStep,
} from '../types/headless'
import type { StreamEvent as SrcStreamEvent, SdkEvent as SrcSdkEvent, TokenUsage as SrcTokenUsage, AgentMessage as SrcAgentMessage, ToolStep as SrcToolStep } from '../src/core/types'
import type { DebugLog as SrcDebugLog } from '../src/core/harness/createAgent'

export const _hStreamEventSame: Same<HStreamEvent, SrcStreamEvent> = true
export const _hStreamEventKeysD2S: Subset<keyof HStreamEvent, keyof SrcStreamEvent> = true
export const _hSdkEventSame: Same<HSdkEvent, SrcSdkEvent> = true
export const _hDebugLogSame: Same<HDebugLog, SrcDebugLog> = true
export const _hTokenUsageSame: Same<HTokenUsage, SrcTokenUsage> = true
export const _hAgentMessageSame: Same<HAgentMessage, SrcAgentMessage> = true
export const _hAgentMessageKeysD2S: Subset<keyof HAgentMessage, keyof SrcAgentMessage> = true
export const _hAgentMessageKeysS2D: Subset<keyof SrcAgentMessage, keyof HAgentMessage> = true
export const _hToolStepSame: Same<HToolStep, SrcToolStep> = true
export const _hToolStepKeysD2S: Subset<keyof HToolStep, keyof SrcToolStep> = true
export const _hToolStepKeysS2D: Subset<keyof SrcToolStep, keyof HToolStep> = true
