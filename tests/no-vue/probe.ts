/* no-vue 探针(E2 API 面收口):tsconfig paths 把 'vue' 指向不存在的文件(node_modules 回退被阻断),
 * 本编译单元里任何 from 'vue' / import('vue') 都会 TS2307 —— 证明两个 d.ts 在「未装 vue 的 TS 项目」
 * 可完整解析(内联桩自足)。用法形态(不只 import)确保 Ref/DefineComponent 桩真被消费。
 */
import type {
  ChatSdk,
  UseChatReturn,
  AgentInstance,
  ChatDialogProps,
  Middleware,
  HarnessState,
} from '../../types/index'
import type { ChatSdk as HeadlessChatSdk, VfsStore as HeadlessVfsStore } from '../../types/headless'

// Ref 桩消费:含 Ref 成员的类型取字段(若 d.ts 仍引用真 vue → TS2307 在此浮现)
type _PendingApprovalRef = UseChatReturn['pendingApproval']
type _DebugLogsRef = AgentInstance['debugLogs']
type _ScrollRef = UseChatReturn['scrollContainer']

// 中间件钩子签名消费(E1 真实签名的编译期可用性)
type _MwHook = Middleware['wrapToolCall']
type _StateTodos = HarnessState['todos']

// 实例面消费
declare const sdk: ChatSdk
declare const hsdk: HeadlessChatSdk
declare const vfs: HeadlessVfsStore
type _SdkMessages = typeof sdk.messages
type _HMessages = typeof hsdk.messages
type _VfsFiles = typeof vfs.files
declare const _props: ChatDialogProps

export { sdk, hsdk, vfs, _props }
