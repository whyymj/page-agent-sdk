/**
 * UI 渲染的可注入实现(DialogMounter)—— 把 ChatDialog 挂载从 createChatSdk 解耦。
 *
 * 主入口 `index.ts` 注入此实现(含 UI);headless 入口 `index.headless.ts` 不注入(不含 UI)。
 * 本模块 import ChatDialog + vue 组件 API(createApp/h/defineComponent)→ 仅主入口的打包图可达,
 * headless 入口的 rollup 静态分析确定排除本模块及 ChatDialog 全子树 + marked/highlight.js/dompurify。
 *
 * 逻辑从 `createChatSdk.ts` 原样搬迁(零行为改动):props 透传 + 退出动画(cs-leaving + transitionend/320ms 兜底)+ show/hide class 切换。
 * 返回 DialogController,createChatSdk 闭包持有并委托 mount/unmount/show/hide。
 */
import { createApp, h, defineComponent, triggerRef, type App as VueApp } from 'vue'
import ChatDialog from '../components/ChatDialog.vue'
import type { AgentMessage } from '../types'
import type { ConflictResolution } from '../tools/dataOps'
import type { Focus } from '../harness/state'
import type { DialogMountContext, DialogController } from './createChatSdk'
import type { SkillSpec } from '../harness/skills'

/**
 * 渲染 ChatDialog 到 ctx.el,返回 UI 生命周期控制器。
 * props 全部从 ctx.core / ctx.dialogCfg / ctx.streaming / ctx.runSerial / ctx.hide / ctx.unmount 取值。
 */
export function mountChatDialog(ctx: DialogMountContext): DialogController {
  const { core, dialogCfg } = ctx
  let vueApp: VueApp | null = null
  const mountEl: HTMLElement = ctx.el

  const debugLogsRef = core.agent!.debugLogs
  const Wrapper = defineComponent({
    setup() {
      return () =>
        h(ChatDialog, {
          fetchStream: ctx.streaming ? core.stream : undefined,   // P1-c:走 core.stream 包装(事件转发 onEvent/hook + abort 收口冲突),非裸 core.agent.stream
          fetchResponse: ctx.streaming ? undefined : (msgs: AgentMessage[], signal?: AbortSignal) => {
            if (signal) {
              const abortConflict = () => core.resolveConflict('keep_external')
              if (signal.aborted) abortConflict()
              else signal.addEventListener('abort', abortConflict, { once: true })
            }
            return core.agent!.invoke(msgs, signal)
          },
          title: dialogCfg.title,
          placeholder: dialogCfg.placeholder,
          // slice() 每次 Wrapper 重渲染(createAgent push 后 triggerRef 触发)给出新数组引用 →
          // ChatDialog/ChatHeader/DebugDrawer 的 prop 变化 → 生成期间日志列表/徽标实时刷新。
          // 直传 debugLogsRef.value 则引用恒不变,子组件不重渲染,抽屉日志冻结在打开时刻(审计 P1 残留修复)。
          // MAX_DEBUG_LOGS=300,拷贝成本可忽略。
          debugLogs: debugLogsRef.value.slice(),
          initialMessages: core.messages,
          getInfo: () => core.getInfo(),
          onUndo: core.checkpoint ? () => core.checkpoint!.restore() : undefined,
          canUndo: core.checkpoint ? () => core.checkpoint!.canRestore() : undefined,
          onPersist: async () => {
            core.afterRound()
            if (core.store) await core.store.flush() // 等待落盘完成(useChat await 此 Promise,确保刷新前 indexed 已写入)
          },
          onClear: () => core.resetSession(),   // P0-4:收编进 core(见 core.resetSession);原闭包越界引用 buildCore 局部 lastTitle/titleLLMDone 致 ReferenceError
          // P1-5(fix-hang-and-feedback):stop() 清空排队的丢弃留痕(记 debugLogs,防无声丢失)
          onQueuedCleared: (dropped: string[]) => {
            const logs = core.agent?.debugLogs
            if (!logs) return
            logs.value.push({ timestamp: Date.now(), type: 'middleware', data: { stage: 'queued_cleared', dropped: dropped.length, preview: dropped.map((t) => t.slice(0, 60)) } })
            triggerRef(logs)
          },
          pendingConflict: core.pendingConflict.value,
          onResolveConflict: (action: ConflictResolution['action']) => core.resolveConflict(action),
          infoTick: core.infoTick,  // 响应式 tick:setSkills/setData 后 ++,DebugDrawer watch 后重新拉 getInfo() 实时刷新 Agent 信息
          getSkillContent: core.skillsController ? (name: string) => core.skillsController!.getContent(name) : undefined,  // DebugDrawer 展开 skill 时调,取 skill 全文(优先缓存)
          onAddSkill: core.skillsController ? (skill: SkillSpec) => core.addSkill(skill) : undefined,  // ChatDialog 创建 skill 面板提交时调
          onRemoveSkill: core.skillsController ? (name: string) => core.removeSkill(name) : undefined,  // ChatDialog 删除用户 skill 时调
          getUserSkillNames: core.skillsController ? () => core.listUserSkills() : undefined,  // ChatDialog 列出用户创建的 skill 名(刷新面板)
          onGetSkill: core.skillsController ? (name: string) => core.getUserSkill(name) : undefined,  // ChatDialog 编辑 skill 时读取详情
          drawer: dialogCfg.drawer === true,
          csTheme: dialogCfg.theme === 'light' ? 'light' : 'dark',  // 默认 dark(首页/方舟专题设计稿色板);显式 'light' 才用浅色
          drawerWidth: dialogCfg.drawerWidth,
          drawerHidden: dialogCfg.drawerHidden === true,
          inputRows: dialogCfg.inputRows,
          sections: dialogCfg.sections,
          // 上下文聚焦(指定组件精修;core.getFocus 返 undefined 时 chip 不显示;capabilities.focus:false → no-op chip 隐藏)
          getFocus: () => core.getFocus(),
          getFocuses: () => core.getFocuses(),
          onSetFocus: (f: Focus) => core.setFocus(f),
          onAddFocus: (f: Focus) => core.addFocus(f),
          onRemoveFocus: (path: string) => core.removeFocus(path),
          onClearFocus: () => core.clearFocus(),
          onFocusChipClick: (f: Focus) => core.emit({ type: 'focus_chip_click', path: f.path, label: f.label }),
          onClose: dialogCfg.onClose ?? (dialogCfg.drawer === true ? () => ctx.hide() : () => ctx.unmount()),  // 抽屉模式:点击遮罩/关闭按钮 → 默认 hide(保留 agent/历史/生成进程,再 mount 直接 show);非抽屉或用户传 onClose 时用自定义/卸载
          // 内置会话管理(storage 开启 → ChatDialog 默认显示「新建/历史」按钮 + 历史面板;关 → 不传,隐藏,向后兼容)
          ...(core.store ? {
            sessions: core.sessions.value,            // Ref 响应式 → Wrapper render 重渲染 → ChatDialog 自动更新
            currentSessionId: core.sessionId,
            onNewSession: () => { void ctx.runSerial(() => core.switchSession()) },          // 经 runSerial(与 return 的 switchSession 一致,防并发 state 竞态)
            onOpenSession: (id: string) => { void ctx.runSerial(() => core.switchSession(id)) },
            onRemoveSession: async (id: string) => { if (id !== core.sessionId) { await core.store!.deleteSession(core.agentId, id); await core.refreshSessions() } },
          } : {}),
        })
    },
  })
  vueApp = createApp(Wrapper)
  vueApp.mount(ctx.el)

  return {
    /** 启动退出动画;transitionend/320ms 兜底后调 ctx.onDialogUnmounted(createChatSdk 闭包内 = dialogController=null + core.release) */
    unmount(): void {
      const dialogEl = mountEl.querySelector?.('.chat-dialog') as HTMLElement | null
      if (vueApp && dialogEl) {
        dialogEl.classList.add('cs-leaving')
        // 抽屉模式:遮罩同步淡出
        const maskEl = mountEl.querySelector?.('.chat-mask') as HTMLElement | null
        if (maskEl) maskEl.classList.add('cs-leaving')
        let done = false
        const finish = () => {
          if (done) return
          done = true
          vueApp?.unmount()
          vueApp = null
          ctx.onDialogUnmounted() // 引用计数--(动画结束后);shareContext 归零才真销毁
        }
        dialogEl.addEventListener('transitionend', finish, { once: true })
        setTimeout(finish, 320) // 兜底:防 transitionend 不触发(transition: all 0.3s ease)
        return
      }
      vueApp?.unmount()
      vueApp = null
      ctx.onDialogUnmounted()
    },
    /** 抽屉模式隐藏:加 cs-hidden class(opacity:0 + visibility:hidden),不卸载 vueApp/不 release —— 保留历史与生成进程 */
    hide(): void {
      const dialogEl = mountEl.querySelector?.('.chat-dialog') as HTMLElement | null
      const maskEl = mountEl.querySelector?.('.chat-mask') as HTMLElement | null
      if (dialogEl) dialogEl.classList.add('cs-hidden')
      if (maskEl) maskEl.classList.add('cs-hidden')
    },
    /** 抽屉模式显示:移除 cs-hidden class,恢复可见(配合 hide;首次挂载用 mount) */
    show(): void {
      const dialogEl = mountEl.querySelector?.('.chat-dialog') as HTMLElement | null
      const maskEl = mountEl.querySelector?.('.chat-mask') as HTMLElement | null
      if (dialogEl) dialogEl.classList.remove('cs-hidden')
      if (maskEl) maskEl.classList.remove('cs-hidden')
    },
  }
}
