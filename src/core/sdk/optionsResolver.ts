/**
 * 配置解析纯函数 —— 从 createChatSdk.ts 抽离(refactor-module-extraction 期三)。
 * 含 resolveStorage(storage 选项 → SessionStore|null)+ resolveDialogConfig(对话框配置)。
 */
import type { ChatSdkOptions, DialogConfig, QuickActionItem } from './createChatSdk'
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

const MAX_QUICK_ACTIONS = 8

/**
 * 归一化快捷指令(ui-quick-wins Q1):过滤缺 label/prompt 的项 + 截断至上限(装配期 warn);
 * undefined / 非数组 → [](零配置零行为面)。纯函数,selftest 直测。
 */
export function normalizeQuickActions(input: unknown): QuickActionItem[] {
  if (!Array.isArray(input)) return []
  const items: QuickActionItem[] = []
  for (const it of input) {
    if (!it || typeof it !== 'object') continue
    const { label, prompt, icon } = it as Record<string, unknown>
    if (typeof label !== 'string' || !label.trim() || typeof prompt !== 'string' || !prompt.trim()) continue
    items.push({
      label: label.trim(),
      prompt: prompt.trim(),
      ...(typeof icon === 'string' && icon.trim() ? { icon: icon.trim() } : {}),
    })
    if (items.length >= MAX_QUICK_ACTIONS) break
  }
  if (input.length > items.length) {
    console.warn(`[page-agent-sdk] dialog.quickActions:${input.length} 项中 ${items.length} 项生效(缺 label/prompt 已过滤,或超出上限 ${MAX_QUICK_ACTIONS} 截断)`)
  }
  return items
}
