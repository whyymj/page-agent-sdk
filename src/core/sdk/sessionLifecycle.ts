/**
 * 会话生命周期族(F2 2026-09-10 拆分):sessionVars 收敛 + 后续 switchSession/resetSession/
 * exportSession/importSession/persistRuntime 的归宿模块。
 *
 * F2a(本文件首批):会话级可变闭包状态收敛。修前 lastTitle/titleLLMDone/lastPlanConfirmation 三个
 * 散 `let` 跨 buildCore 四处赋值(switchSession/onClear/applySnapshot/persistRuntime)—— P0-4 的根因
 * 形态正是「闭包变量跨作用域赋值」(onClear 闭包曾赋值 buildCore 局部 let 致运行期 ReferenceError)。
 * 收敛为单对象后:F2b 抽取经 SessionDeps 整体携带,赋值面从「变量名隐式共享」变「对象字段显式传递」。
 */
import type { PlanConfirmationRecord } from '../harness/humanConfirm'

/** 会话级可变状态(每 buildCore 一份;switchSession/resetSession 重置,applySnapshot 恢复) */
export interface SessionVars {
  /** 规则 title 缓存(deriveTitle 结果;变化才写盘,防每轮重复 updateTitle) */
  lastTitle: string | undefined
  /** LLM 标题是否已生成(每会话一次;switchSession/onClear 重置) */
  titleLLMDone: boolean
  /**
   * 方案确认留痕(RHC 带 options 的方案被点选;随 SessionSnapshot 持久化跨刷新)。
   * 口径:仅方案类确认 —— 单组件删除确认(true/false)不写入(防低敏感确认烧掉批量门禁豁免)
   */
  lastPlanConfirmation: PlanConfirmationRecord | undefined
}

/** 新建会话级状态(切/重置会话不重建对象,逐字段重置 —— 持有方引用稳定) */
export function createSessionVars(): SessionVars {
  return { lastTitle: undefined, titleLLMDone: false, lastPlanConfirmation: undefined }
}

/** 切/重置会话口径:三字段归初值(对象身份不变,持有引用不失效) */
export function resetSessionVars(v: SessionVars): void {
  v.lastTitle = undefined
  v.titleLLMDone = false
  v.lastPlanConfirmation = undefined
}

// ===== F2b(2026-09-10):会话持久化 + 生命周期函数族抽取 =====
// 修前 persistSave/persistRuntime/refreshSessions/switchSession/resetSession/exportSession/importSession
// 全内联在 buildCore(core 字面量 + 顶层函数),闭包直接捕获 20+ 局部绑定 —— 拆分时「哪个状态归谁」无显式
// 契约(P0-4 温床)。抽取后经 SessionLifecycleCtx 显式传依赖;createChatSdk 侧仅留委托调用。
import type { AgentMessage, SdkEvent, TokenUsage } from '../types'
import type { SessionMeta, SessionSnapshot, SessionStore } from '../backends/storage'
import type { Mission, WorkingMemory, Focus } from '../harness/state'
import type { ChatSdkOptions, AgentCore } from './createChatSdk'
import { lightenMessages } from '../tools/imageInput'
import { deriveTitle } from './llmResolver'
import { makeId } from '../utils/id'

/** 会话导出信封版本(ui-quick-wins Q2):不兼容的快照结构变更时递增,导入侧未知版本拒绝 */
export const SESSION_EXPORT_VERSION = 1
/** 会话导入体积上限(字符数口径;≈6MB)—— 防误导入超大垃圾文件撑爆 store */
export const SESSION_EXPORT_MAX_BYTES = 6 * 1024 * 1024

/** 中间件重置/读取面(结构最小类型,避免整包 import 中间件实现类型) */
export interface SessionMwBundle {
  todosMw: { reset(t: unknown[]): void }
  memoryMw: { reset(m: string): void; get(): string }
  missionMw: { reset(): void; getMission(): Mission | null | undefined }
  workingMemoryMw: { reset(): void; getWorkingMemory(): WorkingMemory | null | undefined }
  focusMw: { reset(): void; getFocuses(): Focus[] }
  summarizationMw?: { reset(): void } | null
  resumeNoticeMw: { reset(): void }
  useMission: boolean
  useWorkingMemory: boolean
  useFocus: boolean
  useAutomation: boolean
}

/** createSessionLifecycle 依赖面(显式契约:修前为 buildCore 闭包隐式捕获) */
export interface SessionLifecycleCtx {
  agentId: string
  options: ChatSdkOptions
  emit: (e: SdkEvent) => void
  /** store 为 buildCore 内 let(resolveAndLoad 赋值)→ getter 传活引用 */
  getStore: () => SessionStore | null | undefined
  core: AgentCore
  sessionsRef: { value: SessionMeta[] }
  sessionVars: SessionVars
  /** 活 messages 数组引用(persistRuntime 序列化源;reactive 数组就地 mutate,引用稳定) */
  messages: AgentMessage[]
  getUsage: () => TokenUsage
  mw: SessionMwBundle
  vfsStore: { flush?: () => void; clear?: () => void }
  checkpointMgr?: { exportStack(): unknown[]; importStack(s: unknown[]): void } | null
  /** 挂起冲突收口(切/重置会话按 keep_external,防旧 conflict Promise 永挂) */
  conflictResolve: (action: 'keep_external') => void
  /** 中止全部在途流(resetSession 契约 C) */
  abortAllActive: () => void
  titleLlmInvoke?: (messages: AgentMessage[]) => Promise<string>
}

/** 会话持久化 + 生命周期族(返回函数集;createChatSdk core 字面量委托调用) */
export function createSessionLifecycle(ctx: SessionLifecycleCtx) {
  const { agentId, options, emit, core, sessionsRef, sessionVars, messages, mw } = ctx
  const getStore = ctx.getStore

  /** 刷新历史会话列表到 sessionsRef(switchSession/deleteSession/onClear/init 后调;storage 未开启 no-op) */
  async function refreshSessions(): Promise<void> {
    const store = getStore()
    if (!store) return
    // 内部吞错:多处 void refreshSessions() fire-and-forget,release 后迟到调用(store 已 dispose)会变 unhandled rejection
    try {
      sessionsRef.value = (await store.listSessions(agentId)).sort((a, b) => b.lastAccessed - a.lastAccessed)
    } catch (e) {
      if (options.debug) console.warn('[page-agent-sdk][persist] refreshSessions 失败(已吞):', e)
    }
  }

  function notePersistFailure(stage: string, e: unknown): void {
    if (options.debug) console.warn(`[page-agent-sdk][persist] ${stage} 失败(已吞):`, e)
    const logs = core.agent?.debugLogs
    if (logs) {
      logs.value.push({ timestamp: Date.now(), type: 'middleware', data: { stage: 'persist_save_failed', kind: stage, error: String(e).slice(0, 160) } })
    }
  }

  function persistSave(patch: Partial<SessionSnapshot>): void {
    const store = getStore()
    if (!core.sessionId || !store) return
    store.save(agentId, core.sessionId, patch).catch((e: unknown) => notePersistFailure('save', e))
  }

  /** fire-and-forget 标题更新(同 persistSave,吞错防 unhandled rejection) */
  function persistUpdateTitle(sid: string, title: string): void {
    const store = getStore()
    if (!store) return
    store.updateTitle(agentId, sid, title).catch((e: unknown) => notePersistFailure('updateTitle', e))
  }

  /** 持久化当前会话的 messages + todos(一轮结束 / send 后调用) */
  function persistRuntime(): void {
    const store = getStore()
    if (!core.sessionId || !store) return
    // messages 元素是 Vue reactive proxy → IDB structured clone 会抛 DataCloneError(静默失败,messages 存不进);
    // 先 JSON 纯化为普通对象。localStorage 走 JSON.stringify 本就纯化,故 local 不受影响、indexed 受影响。
    // image-input-vision:轻形态落盘(剥 dataUri 原图只留 thumb+vfsRef;原图走 vfs kind 各自持久化,快照体积不放大 —— design D2)
    const pureMessages = lightenMessages(JSON.parse(JSON.stringify(messages)) as AgentMessage[])
    persistSave({ messages: pureMessages })
    // todos 始终同步当前态(含空数组覆写):否则会话内 todos 由有变空(LLM 主动 write_todos([]))后,
    // storage 仍残留旧清单 → 刷新恢复出遗留的已完成 todos。代价:未用过 todos 的会话多写一条空记录(可忽略)。
    const todos = core.agent?.getState?.()?.todos ?? []
    persistSave({ todos })
    // 方案确认留痕(save-and-plan-gates 3c):确认即时 persistSave 已存,此处兜底覆盖
    // (确认后未发消息即刷新的场景由即时写覆盖;重置后写 undefined 清除残留防旧值复活)
    persistSave({ planConfirmation: sessionVars.lastPlanConfirmation })
    // context-persist-resilience 功能A:持久化 mission/workingMemory(刷新/切会话后长任务目标 + 工作记忆不丢;非空才写省 IDB 写)
    if (mw.useMission) {
      const m = mw.missionMw.getMission()
      if (m) persistSave({ mission: m } as Partial<SessionSnapshot>)
    }
    if (mw.useWorkingMemory) {
      const wm = mw.workingMemoryMw.getWorkingMemory()
      if (wm) persistSave({ workingMemory: wm } as Partial<SessionSnapshot>)
    }
    // focus-auto-switch:持久化 focus(有值存值;clearFocus 后存 null 覆盖清除,防旧值残留被下次 restore)
    if (mw.useFocus) {
      const fs = mw.focusMw.getFocuses()
      persistSave({ focus: fs.length ? fs : null } as Partial<SessionSnapshot>)
    }
    // automation 断点续跑:持久化 checkpoint 栈 + 累计 usage(刷新/崩溃后恢复,长任务可续跑;仅 automation 开启时写,省空间)
    if (mw.useAutomation && ctx.checkpointMgr) {
      persistSave({ checkpoints: ctx.checkpointMgr.exportStack() } as Partial<SessionSnapshot>)
      persistSave({ usage: ctx.getUsage() } as Partial<SessionSnapshot>)
    }
    // 自动 title:首条 user 截取(变化才写,避免每轮重复;供历史列表显示,替代「会话 xxxxxx」)
    const title = deriveTitle(messages)
    if (title && title !== sessionVars.lastTitle) {
      sessionVars.lastTitle = title
      persistUpdateTitle(core.sessionId, title)
    }
    // LLM 标题(异步,首轮 user+assistant 完成后一次;主旨更准,覆盖规则 title;失败/无 LLM 用规则兜底)
    const autoTitle = options.autoTitle !== false
    if (autoTitle && ctx.titleLlmInvoke && !sessionVars.titleLLMDone && messages.some((m) => m.role === 'user') && messages.some((m) => m.role === 'assistant')) {
      sessionVars.titleLLMDone = true
      const titleLlmInvoke = ctx.titleLlmInvoke
      const sid = core.sessionId // 调度时会话快照:LLM 返回时可能已切会话,写错会话
      void (async () => {
        try {
          const llmTitle = await titleLlmInvoke(messages)
          // 迟到守卫(deferred RE 组修复):LLM 期间卸载(refCount≤0 → store 已 dispose)或切会话(sessionId 变)→ 放弃
          if (llmTitle && core.refCount > 0 && core.sessionId === sid) {
            // 时序契约:必须先等标题落盘再 refreshSessions —— updateTitle 经 storage per-key 串行链
            // (≥1 微任务延迟)而 listSessions 的 scan 直读,fire-and-forget 会让会话列表读到旧标题
            // (rv-recent F1,3.19 稳定性小修自引入的回归)
            try { await getStore()!.updateTitle(agentId, sid, llmTitle) } catch (e) { notePersistFailure('updateTitle', e) }
            await refreshSessions()
          }
        } catch {
          /* LLM 标题失败:规则 title 已兜底,吞掉防 unhandled rejection */
        }
      })()
    }
    if (options.debug) console.log('[page-agent-sdk][persist] save', core.sessionId, `${messages.length} msgs`)
  }

  /** 切换会话:flush 当前 → 载入/新建目标 → 清内存态并灌入快照(替换语义)→ 返回新会话 id */
  async function switchSession(sessionId?: string): Promise<string> {
    await core.initDone
    const store = getStore()
    if (!store) throw new Error('page-agent-sdk: storage 未开启,无法切换会话(请传 storage 选项)')
    // 收口挂起的冲突(按「保留外部」),防切会话后旧 conflict Promise 永久挂起
    ctx.conflictResolve('keep_external')
    // context-persist-resilience:切走前 persist 当前会话的 mission/workingMemory(防 setMission / 工作记忆积累后切走丢失;persistRuntime 仅 afterRound 触发,setMission 后未发消息即切会话会漏存)
    if (core.sessionId && store) {
      if (mw.useMission) { const m = mw.missionMw.getMission(); if (m) persistSave({ mission: m } as Partial<SessionSnapshot>) }
      if (mw.useWorkingMemory) { const wm = mw.workingMemoryMw.getWorkingMemory(); if (wm) persistSave({ workingMemory: wm } as Partial<SessionSnapshot>) }
      // focus-auto-switch:切走前 persist focus(有值存值;clearFocus 后存 null 覆盖清除)
      if (mw.useFocus) { const fs = mw.focusMw.getFocuses(); persistSave({ focus: fs.length ? fs : null } as Partial<SessionSnapshot>) }
    }
    ctx.vfsStore.flush?.()
    await store.flush()
    let target = sessionId ?? ''
    let snap: SessionSnapshot | undefined
    if (target) {
      snap = await store.load(agentId, target)
      if (!snap) await store.createSession(agentId, options.session?.title, target)
    } else {
      target = await store.createSession(agentId, options.session?.title)
    }
    core.sessionId = target
    // 清空当前内存态(替换语义,非叠加)
    messages.splice(0, messages.length)
    ctx.vfsStore.clear?.()
    mw.todosMw.reset([])
    if (!options.memory) mw.memoryMw.reset('')
    // P1-5:切会话重置 mission/workingMemory,防旧会话 goal / 定位 path·hash 污染新会话(过期 hash 诱发乐观锁误冲突)
    mw.missionMw.reset()
    mw.workingMemoryMw.reset()
    mw.focusMw.reset()
    mw.summarizationMw?.reset() // team-audit P1#2:清 LLM 摘要前缀缓存 + epoch 翻转(防旧会话摘要泄进新会话压缩)
    mw.resumeNoticeMw.reset() // 切会话:清待注入恢复标记(下方 applySnapshot 若灌入历史会重新标记)
    sessionVars.lastPlanConfirmation = undefined // 切会话:清方案确认留痕(方案时效限本会话;回原会话经 applySnapshot 恢复)
    // session-history S1:切会话清 checkpoint 栈,防旧会话快照污染新会话(开 checkpoint 时,否则 restore 会回退到旧会话态)
    if (ctx.checkpointMgr) ctx.checkpointMgr.importStack([])
    // 释放上一会话的调试日志(切会话后旧日志不再相关,立即释放内存)
    core.agent!.debugLogs.value = []
    core.agent!.resetSessionCounters?.() // 会话级计数(stale-read 失效 + llm 重试/终败)同点清零,防旧会话计数带进新会话
    // 二次 load(新建会话路径):此时内存态已清/sessionId 已换,失败若上抛 = 半切换态且 UI 按钮路径无人接
    // (flow-robustness P1#6)→ 降级空会话 + observable 留痕(切换照常完成,快照可后续手动重载)
    if (!snap) {
      try { snap = await store.load(agentId, target) } catch (e) {
        emit({ type: 'error', message: `会话快照载入失败,已降级空会话:${e instanceof Error ? e.message : String(e)}`, severity: 'observable', code: 'SESSION_SNAPSHOT_LOAD_FAILED', context: { sessionId: target } } as any)
      }
    }
    if (snap) {
      core.applySnapshot(snap)
      emit({ type: 'session_restored', sessionId: target, rounds: snap.messages?.length ?? 0 })
    }
    if (options.memory) persistSave({ memory: mw.memoryMw.get() || (typeof options.memory === 'string' ? options.memory : '') })
    void refreshSessions()  // session-history Phase 6:切会话后刷新历史列表(响应式 sessions 自动更新;内部已吞错)
    sessionVars.lastTitle = undefined; sessionVars.titleLLMDone = false   // 切会话:重置 title 缓存 + LLM 标志,新会话重新生成
    core.infoTick.value++ // 同 resetSession:focus 重置/快照恢复后 bump,防输入框聚焦 chip 残留旧焦点
    return target
  }

  /** 导出会话快照(ui-quick-wins Q2):可复全 JSON 信封 { formatVersion, exportedAt, sessionId, snapshot }。 */
  async function exportSession(sessionId?: string): Promise<Record<string, unknown>> {
    const store = getStore()
    if (!store) throw new Error('page-agent-sdk: storage 未开启,无法导出会话(请传 storage 选项)')
    const sid = sessionId || core.sessionId
    if (!sid) throw new Error('page-agent-sdk: 无可导出的会话')
    if (sid === core.sessionId) {
      // 当前会话:落最新内存态(不跑 trimMemoryMessages —— 导出不改变会话本身;与 afterRound 的差别仅此)
      persistRuntime()
      ctx.vfsStore.flush?.()
      await store.flush()
    }
    const snap = await store.load(agentId, sid)
    if (!snap) throw new Error(`page-agent-sdk: 会话 ${sid} 不存在或无可导出内容`)
    return { formatVersion: SESSION_EXPORT_VERSION, exportedAt: new Date().toISOString(), sessionId: sid, snapshot: snap }
  }

  /** 导入会话快照副本(ui-quick-wins Q2):exportSession 产物 → 总是生成新 sessionId(副本语义,不覆盖既有会话)。 */
  async function importSession(data: unknown): Promise<{ sessionId: string }> {
    const store = getStore()
    if (!store) throw new Error('page-agent-sdk: storage 未开启,无法导入会话(请传 storage 选项)')
    let obj: unknown = data
    const rawLen = typeof data === 'string' ? data.length : 0
    if (typeof data === 'string') {
      try { obj = JSON.parse(data) } catch { throw new Error('page-agent-sdk: 导入内容不是合法 JSON') }
    }
    const envelope = (obj ?? {}) as { formatVersion?: unknown; snapshot?: unknown }
    if (typeof obj !== 'object' || obj === null || envelope.formatVersion !== SESSION_EXPORT_VERSION) {
      throw new Error(`page-agent-sdk: 未知会话导出格式(期望 formatVersion=${SESSION_EXPORT_VERSION};请用 sdk.exportSession 的产物)`)
    }
    const snap = envelope.snapshot
    if (!snap || typeof snap !== 'object' || !Array.isArray((snap as SessionSnapshot).messages)) {
      throw new Error('page-agent-sdk: 导入内容缺 snapshot.messages(非会话导出文件)')
    }
    const size = rawLen || JSON.stringify(envelope).length
    if (size > SESSION_EXPORT_MAX_BYTES) {
      throw new Error(`page-agent-sdk: 导入会话超过 ${Math.floor(SESSION_EXPORT_MAX_BYTES / 1024 / 1024)}MB 上限(${(size / 1024 / 1024).toFixed(1)}MB)`)
    }
    const sid = await store.createSession(agentId, options.session?.title)
    await store.save(agentId, sid, snap as Partial<SessionSnapshot>)
    void refreshSessions()
    return { sessionId: sid }
  }

  /** 新建/清空会话:重置内存态 + 新 sessionId + emit session_restored(契约见 createChatSdk 原注释) */
  function resetSession(): void {
    ctx.abortAllActive() // 契约 C(fix-hang-and-feedback):清空会话先中止在途流(防幽灵流写进新会话)
    ctx.conflictResolve('keep_external') // P1-9:收口挂起冲突(唯一不收口的生命周期路径补齐;keep_external 语义放弃本次写,无跨会话写窗口)
    core.sessionId = makeId()
    messages.splice(0, messages.length) // 自包含清空(与 switchSession 对齐;UI useChat.clearMessages 再 splice 为 no-op)
    ctx.vfsStore.clear?.()
    mw.todosMw.reset([])
    if (!options.memory) mw.memoryMw.reset('')
    mw.missionMw.reset()
    mw.workingMemoryMw.reset()
    mw.focusMw.reset()
    mw.summarizationMw?.reset() // team-audit P1#2:清 LLM 摘要前缀缓存 + epoch 翻转(防旧会话摘要泄进新会话压缩)
    mw.resumeNoticeMw.reset() // 清空会话:新会话无恢复历史,清待注入标记
    sessionVars.lastPlanConfirmation = undefined // 清空会话:清方案确认留痕(save-and-plan-gates 3c)
    if (ctx.checkpointMgr) ctx.checkpointMgr.importStack([])
    if (core.agent) { core.agent.debugLogs.value = []; core.agent.resetSessionCounters?.() }
    const store = getStore()
    if (store) {
      store.createSession(core.agentId, options.session?.title, core.sessionId).catch((e: unknown) => {
        if (options.debug) console.warn('[page-agent-sdk][persist] createSession 失败(已吞):', e)
      })
    }
    emit({ type: 'session_restored', sessionId: core.sessionId, rounds: 0 })
    core.infoTick.value++ // 焦点等 UI computed(focuses chip)挂 infoTick;reset 清焦点后不 bump → 输入框聚焦 chip 残留旧焦点(用户实测)
    void refreshSessions() // 内部守卫:storage 未开启 no-op
    sessionVars.lastTitle = undefined; sessionVars.titleLLMDone = false
  }

  return { refreshSessions, notePersistFailure, persistSave, persistUpdateTitle, persistRuntime, switchSession, resetSession, exportSession, importSession }
}
