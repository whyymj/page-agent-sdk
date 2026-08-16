/**
 * 用户偏好独立持久化存储 —— 跨会话偏好记忆(preference-persistence)的存储层。
 *
 * 设计目标(与 skillStore 同构):
 *   1. **独立于 storage 选项**:即使 `storage: false` 关闭会话持久化,学到的偏好仍持久化
 *      (默认 indexedDB),跨刷新/跨会话生效。
 *   2. **跨页面/跨 agent 复用**:手动指定同一 `id` 共享同一套偏好;不传按 `agentId` 隔离
 *      (与 skillStore 语义一致)。
 *   3. **可注入后端**:复用 storage.ts 的 StorageBackend 接口;后端不可用降级内存(非持久,
 *      刷新丢失,当前会话内仍可用 —— 注入段照常工作)。
 *
 * 条目语义:
 *   - **同 topic 合并 = 后说覆盖前说**:put 时同 topic 已有条目 → 覆盖 content/updatedAt
 *     (用户改主意不并存,防注入段自相矛盾);topic 为固定枚举,防自由词爆炸导致永不合并。
 *   - **FIFO 上限**(默认 20):超限按 updatedAt 删最旧,偏好段 token 始终有界。
 */
import {
  createIdbBackend,
  createMemoryBackend,
  createWebStorageBackend,
  isQuotaError,
  type StorageBackend,
  type StorageBackendType,
} from './storage'

/** 偏好主题枚举(合并键):同 topic 后说覆盖前说;新增主题须同步 PREFERENCE_TOPICS */
export const PREFERENCE_TOPICS = ['color', 'copy', 'layout', 'interaction', 'tech', 'other'] as const
export type PreferenceTopic = (typeof PREFERENCE_TOPICS)[number]

/** 持久化的单条用户偏好(captured/提炼后的一句话中性陈述) */
export interface PersistedPreference {
  /** 稳定 id(同 topic 合并时保留旧 id,防外部按 id 引用漂移) */
  id: string
  /** 一句话中性陈述(用户视角,如「不用紫色,偏好低饱和」) */
  content: string
  /** 主题枚举(合并键) */
  topic: PreferenceTopic
  /** 首次捕获来源会话 */
  sourceSessionId: string
  /** 首次捕获来源轮次(state.messages index) */
  sourceRound: number
  createdAt: number
  updatedAt: number
}

export interface PreferenceStoreConfig {
  /** 存储 id(命名空间)。手动指定同一 id 跨页面/跨 agent 共享;不传默认按 agentId 隔离(调用方填) */
  id?: string
  /** 后端类型,默认 'indexed';'local' 跨页持久;'session' 刷新保留;'memory' 纯内存降级 */
  backend?: StorageBackendType
  /** DB 命名空间,默认 'chat-sdk'(与 SessionStore/SkillStore 同库,不同 key 前缀) */
  dbName?: string
  /** FIFO 条目上限(默认 20;超限按 updatedAt 删最旧,偏好段 token 始终有界) */
  maxEntries?: number
}

const KEY_PREFIX = 'v:1::pref-store'
const DEFAULT_DB_NAME = 'chat-sdk'
/** FIFO 上限(超限删最旧;0 = 不存,调用方守卫) */
export const DEFAULT_MAX_PREFERENCES = 20

export interface PreferenceStore {
  /** resolve=false 表示已降级到内存(非持久) */
  ready: Promise<boolean>
  /** 列出全部偏好(按 updatedAt 新在前) */
  list(): Promise<PersistedPreference[]>
  /** 写入一条(同 topic 合并:后说覆盖前说,保 id 刷 updatedAt;FIFO 超限删最旧);返回合并后的条目 */
  put(pref: Omit<PersistedPreference, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<PersistedPreference>
  /** 删除单条(by id);返回是否删除成功 */
  remove(id: string): Promise<boolean>
  /** 清空当前命名空间下全部偏好 */
  clear(): Promise<void>
  /** 释放后端连接 */
  dispose(): void
}

function prefKey(dbName: string, storeId: string, id: string): string {
  return `${KEY_PREFIX}::${dbName}::${storeId}::${id}`
}
function storePrefix(dbName: string, storeId: string): string {
  return `${KEY_PREFIX}::${dbName}::${storeId}::`
}

function genId(): string {
  return `pref-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 创建偏好存储。
 * - 默认后端 indexedDB;不可用降级内存(ready=false,非持久但会话内可用)。
 * - 与 `storage` 选项完全独立:storage:false 也持久化偏好(同 skillStore)。
 * - maxEntries(config 可配)仅供 FIFO 裁剪(每次 put 后执行);0 由调用方守卫(不装配)。
 */
export function createPreferenceStore(config: PreferenceStoreConfig = {}): PreferenceStore {
  const dbName = config.dbName ?? DEFAULT_DB_NAME
  const backendType = config.backend ?? 'indexed'
  const storeId = config.id ?? '' // 由调用方填 agentId(见 createChatSdk 包装)
  const maxEntries = config.maxEntries ?? DEFAULT_MAX_PREFERENCES

  let backend: StorageBackend
  let readyResolve!: (v: boolean) => void
  const ready = new Promise<boolean>((r) => {
    readyResolve = r
  })

  // 启动:按 backend 类型选后端;不可用降级 memory(永不冒泡)
  ;(async () => {
    try {
      if (backendType === 'indexed') {
        if (typeof indexedDB === 'undefined') throw new Error('indexedDB 不可用')
        backend = await createIdbBackend(dbName)
        readyResolve(true)
      } else if (backendType === 'session') {
        if (typeof sessionStorage === 'undefined') throw new Error('sessionStorage 不可用')
        backend = createWebStorageBackend(sessionStorage)
        readyResolve(true)
      } else if (backendType === 'local') {
        if (typeof localStorage === 'undefined') throw new Error('localStorage 不可用')
        backend = createWebStorageBackend(localStorage)
        readyResolve(true)
      } else {
        // 'memory':显式内存后端(非持久,ready=false)
        backend = createMemoryBackend()
        readyResolve(false)
      }
    } catch {
      backend = createMemoryBackend()
      readyResolve(false)
    }
  })()

  /** 内部:扫当前命名空间全部条目 */
  async function scanAll(): Promise<PersistedPreference[]> {
    const out: PersistedPreference[] = []
    await backend.scan(storePrefix(dbName, storeId), (_k, v) => {
      out.push(v as PersistedPreference)
    })
    return out
  }

  return {
    ready,
    async list(): Promise<PersistedPreference[]> {
      const all = await scanAll()
      return all.sort((a, b) => b.updatedAt - a.updatedAt) // 新在前
    },
    async put(pref): Promise<PersistedPreference> {
      const all = await scanAll()
      const now = Date.now()
      // updatedAt 严格递增:同毫秒连续 put(测试/高频捕获)仍保 FIFO 序可靠(排序键稳定)
      const maxUpdated = all.reduce((mx, p) => Math.max(mx, p.updatedAt), 0)
      // 同 topic 合并:后说覆盖前说,保留旧 id(外部按 id 引用不漂移)与首次来源
      const existing = all.find((p) => p.topic === pref.topic)
      const merged: PersistedPreference = {
        id: pref.id ?? existing?.id ?? genId(),
        content: pref.content,
        topic: pref.topic,
        sourceSessionId: existing?.sourceSessionId ?? pref.sourceSessionId,
        sourceRound: existing?.sourceRound ?? pref.sourceRound,
        createdAt: existing?.createdAt ?? now,
        updatedAt: Math.max(now, maxUpdated + 1),
      }
      // 同 topic 旧 id 换新条目时删旧 key(id 变化的场景:外部显式传了新 id)
      if (existing && existing.id !== merged.id) {
        await backend.del(prefKey(dbName, storeId, existing.id))
      }
      try {
        await backend.set(prefKey(dbName, storeId, merged.id), merged)
      } catch (err) {
        // 配额超限:静默降级内存(偏好仅当前会话可见,不冒泡)
        if (isQuotaError(err)) {
          backend = createMemoryBackend()
          await backend.set(prefKey(dbName, storeId, merged.id), merged)
        }
      }
      // FIFO:超限按 updatedAt 删最旧(不含刚写的这条)
      const after = await scanAll()
      if (after.length > maxEntries) {
        const oldest = after.sort((a, b) => a.updatedAt - b.updatedAt).slice(0, after.length - maxEntries)
        for (const p of oldest) await backend.del(prefKey(dbName, storeId, p.id))
      }
      return merged
    },
    async remove(id): Promise<boolean> {
      const key = prefKey(dbName, storeId, id)
      const existed = (await backend.get(key)) != null
      if (!existed) return false
      await backend.del(key)
      return true
    },
    async clear(): Promise<void> {
      await backend.clearPrefix(storePrefix(dbName, storeId))
    },
    dispose(): void {
      // IdbBackend 无显式 close 接口(由 GC 接管);Memory/WebStorage 无需释放
    },
  }
}
