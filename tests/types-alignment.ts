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

// 4. send options key 集合对齐(P1-24:d.ts 曾漏 interceptors/maxAutoRetries)
type DtsSendOpts = Parameters<DtsChatSdk['send']>[1]
type SrcSendOpts = Parameters<SrcChatSdk['send']>[1]
export const _sendDtsSubsetSrc: Subset<Keys<DtsSendOpts>, Keys<SrcSendOpts>> = true
export const _sendSrcSubsetDts: Subset<Keys<SrcSendOpts>, Keys<DtsSendOpts>> = true
