/**
 * 配置解析纯函数 —— 从 createChatSdk.ts 抽离(refactor-module-extraction 期三)。
 * 含 resolveStorage(storage 选项 → SessionStore|null)+ resolveDialogConfig(对话框配置)。
 */
import type { ChatSdkOptions, DialogConfig } from './createChatSdk'
import { createSessionStore, type SessionStore, type StorageBackendType, type StorageConfig } from '../backends/storage'

/** 解析 storage 选项 → SessionStore | null(3.9+ 默认 'memory':未传 = 纯内存会话(多会话切换,不落盘);false 显式关闭;字符串/对象 开启) */
export function resolveStorage(storage: StorageBackendType | StorageConfig | false | undefined): SessionStore | null {
  if (storage === undefined) return createSessionStore({ backend: 'memory' })  // 默认内存会话(开箱即用多会话,零落盘副作用)
  if (storage === false) return null
  if (typeof storage === 'string') return createSessionStore({ backend: storage })
  if (storage.enabled === false) return null
  return createSessionStore(storage)
}

/**
 * 解析对话框配置:从 options.dialog 读取归组配置(扁平写法已移除)。
 */
export function resolveDialogConfig(opts: ChatSdkOptions): DialogConfig {
  return opts.dialog ?? {}
}
