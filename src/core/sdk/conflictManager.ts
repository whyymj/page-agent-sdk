/**
 * 乐观锁冲突人工介入管理器 —— 从 createChatSdk.ts 抽离(refactor-module-extraction 期二)。
 * dataOps 写入检测到主数据被外部改过 → 挂起 pendingConflict 等用户决定(保留外部/强制覆盖/回退)。
 *
 * getEmit 为延迟求值的事件分发 getter:emit 在 buildCore 内晚于本工厂定义(listeners 之后),
 * set 运行时才调用 getEmit(),此时 emit 已赋值;工厂创建时无需 emit 就绪。
 *
 * getPolicy(3.29):冲突自动裁决策略 getter(createChatSdk 的 conflictPolicy 选项)。
 * 'ask'(默认)= 挂起等人工;'overwrite'/'keep_external' = 不挂起,按策略立即收口
 * (宿主与 agent 争同一份数据且集成方明确 agent 优先时用 overwrite,防无人值守场景永挂)。
 */
import { ref, type Ref } from 'vue'
import type { SdkEventHandler } from '../types'
import type { ConflictInfo, ConflictResolution } from '../tools/dataOps'
import type { PendingConflict } from './createChatSdk'

/** 乐观锁冲突裁决策略:ask=挂起等人工(默认)| overwrite=agent 强制覆盖 | keep_external=保留外部修改 */
export type ConflictPolicy = 'ask' | 'overwrite' | 'keep_external'

export interface ConflictManager {
  /** 冲突挂起状态(响应式 ref;无冲突为 null,UI 据此渲染冲突对话框) */
  pendingConflict: Ref<PendingConflict | null>
  /** dataOps onConflict 回调:挂起冲突 + 外发 conflict 事件,返回等用户决定的 Promise。
   *  signal(flow-robustness P0#2,可选):abort 即按「保留外部」收口本 Promise(headless/编程式 invoke
   *  直挂 onConflict 且带 signal 的场景;send/stream 入口的 abortConflict 联动是第一道,此为兜底) */
  set(info: ConflictInfo, signal?: AbortSignal): Promise<ConflictResolution>
  /** 用户决定后收口:keep_external/overwrite/restore → resolve 挂起的 Promise,工具继续 */
  resolve(action: ConflictResolution['action']): void
}

export function createConflictManager(getEmit?: () => SdkEventHandler | undefined, getPolicy?: () => ConflictPolicy): ConflictManager {
  const pendingConflict = ref<PendingConflict | null>(null)
  let conflictSeq = 0
  function set(info: ConflictInfo, signal?: AbortSignal): Promise<ConflictResolution> {
    const policy = getPolicy?.() ?? 'ask'
    if (policy !== 'ask') {
      // 自动裁决(conflictPolicy):不挂起 pendingConflict、不等人工,按策略立即收口。
      // 仍外发 conflict 事件(带 autoResolved 标记)供集成方观测/审计;resolve 给 no-op 保持事件 shape 一致
      const pending: PendingConflict = { ...info, id: ++conflictSeq, resolve: () => { /* 自动裁决无需收口 */ }, autoResolved: policy }
      const emit = getEmit?.()
      emit?.({ type: 'conflict', conflict: pending })
      return Promise.resolve({ action: policy })
    }
    // signal 已中止:不挂起,直接按「保留外部」收口(abort 后无人工响应方,挂了也无人解)
    if (signal?.aborted) return Promise.resolve({ action: 'keep_external' })
    return new Promise((resolve) => {
      // shareContext 多实例并发冲突时,新冲突覆盖旧 pendingConflict.value,旧 resolve 函数会丢失 → 旧工具永挂。
      // 兜底:覆盖前若仍有未解决冲突,自动按「保留外部」收口旧冲突(防 resolve 丢失)
      const prev = pendingConflict.value
      if (prev) prev.resolve({ action: 'keep_external' })
      const pending = { ...info, id: ++conflictSeq, resolve }
      pendingConflict.value = pending
      // 外发 conflict 事件(headless 集成方可经 onEvent/hook 收,无需 watch ref)
      const emit = getEmit?.()
      emit?.({ type: 'conflict', conflict: pending })
      // signal race(flow-robustness P0#2):abort → 本 Promise 按 keep_external 收口 + 清 pending
      // (晚到的用户 resolve() 因 pendingConflict 已 null 走 no-op);若已被更新的冲突覆盖则只收口本
      // Promise 不动新 pending(与上方 prev 收口口径一致)。注意 ref 深代理:存入对象读回是 reactive
      // proxy,恒等比较恒 false —— 按 id 比对(raw 与 proxy 的 id 字段同值)
      signal?.addEventListener('abort', () => {
        if (pendingConflict.value?.id === pending.id) pendingConflict.value = null
        resolve({ action: 'keep_external' })
      }, { once: true })
    })
  }
  function resolve(action: ConflictResolution['action']) {
    const p = pendingConflict.value
    if (!p) return
    pendingConflict.value = null
    p.resolve({ action })
  }
  return { pendingConflict, set, resolve }
}
