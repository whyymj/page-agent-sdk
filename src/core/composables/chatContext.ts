/**
 * ChatDialog 容器上下文枢纽(chatdialog-component-split task 1)。
 *
 * 把 useChat(对话状态 14 项)与容器级共享 UI 状态(展开/调试/skill 浮层/输入/复制/推理折叠/checkpoint 回退/能力徽标)
 * 聚成单一注入源,供拆出的原子组件(ChatHeader/MessageList/ChatInput/QueuedBar/ApprovalBar 等)经 provide/inject 共用,
 * 避免容器下钻 ~100 条 props。纯新增:本文件不改动 ChatDialog.vue(task 7 容器重写时才接入)。
 *
 * 状态归属原则(design §2/§3):跨 ≥2 区块共用的走 ctx;单组件内部派生(如 hasMessages/hasDebugLogs)不进 ctx,
 * 各组件内 computed;ApprovalBar/ConflictBar 的预览计算由组件自持(从 chat.pendingApproval / 纯 props 派生)。
 */
import { ref, computed, inject, type InjectionKey, type Ref, type ComputedRef } from 'vue'
import { useChat } from './useChat'
import { copyText } from '../utils/clipboard'
import { resolveDialogIcons, type DialogIcons } from '../components/icons'
import { resolveDialogMessages, type DialogMessages, type DialogLocale } from '../components/messages'
import type { AgentMessage, AgentInfo, StreamHandler, AgentImage } from '../types'
import type { Focus } from '../harness/state'
import { compressImage, MAX_IMAGES_PER_ROUND, ImageInputError } from '../tools/imageInput'

/** useChat 返回类型(对话状态 + 操作,14 项) */
export type ChatStore = ReturnType<typeof useChat>

/** createChatContext 入参:useChat 透传 + 容器状态所需回调(getInfo/canUndo/onUndo) */
export interface ChatContextOptions {
  fetchResponse?: (messages: AgentMessage[]) => Promise<string>
  fetchStream?: (messages: AgentMessage[], onEvent: StreamHandler) => Promise<string>
  /** 外部共享消息数组(持久化恢复时传入,与父级共用同一响应式引用) */
  messages?: AgentMessage[]
  /** 一轮完成后持久化回调 */
  onPersist?: (messages: AgentMessage[]) => void | Promise<void>
  /** 清空对话回调(新建会话) */
  onClear?: () => void
  /** stop() 清空排队任务时回调(P1-5 可见性;→ DebugDrawer 日志) */
  onQueuedCleared?: (dropped: string[]) => void
  /** 获取 agent 详细信息(能力徽标 summary + DebugDrawer「Agent 信息」) */
  getInfo?: () => AgentInfo
  /** 是否有可回退的 checkpoint(checkpoint 选项开启注入) */
  canUndo?: () => boolean
  /** 回退到上次正常 checkpoint(checkpoint 选项开启注入) */
  onUndo?: () => boolean
  /** 读取全部聚焦焦点(multi-focus;→ sdk.getFocuses;空数组=未聚焦) */
  getFocuses?: () => Focus[]
  /** 追加聚焦焦点(→ sdk.addFocus;校验 path 在 schema 内) */
  onAddFocus?: (focus: Focus) => { ok: boolean; error?: string }
  /** 移除单个聚焦焦点(→ sdk.removeFocus;ChatInput chip ✕) */
  onRemoveFocus?: (path: string) => void
  /** 清除全部聚焦焦点(→ sdk.clearFocus) */
  onClearFocus?: () => void
  /** chip 点击回调(→ emit focus_chip_click;集成方可滚动/高亮组件) */
  onFocusChipClick?: (focus: Focus) => void
  /** Agent 信息刷新 tick(sdk.addFocus/removeFocus 后 ++);触发 focuses/canUndo/summary 重算 */
  infoTick?: Ref<number>
  /** 图标局部覆盖(dialog.icons;未传键用 DEFAULT_DIALOG_ICONS,默认路径行为零变化) */
  icons?: Partial<DialogIcons>
  /** 语言(dialog.locale;影响文案包与 formatTime/autoTitle 语言) */
  locale?: DialogLocale
  /** 文案键级覆盖(dialog.messages → 此字段;命名避让既有 messages 消息数组;优先于 locale 包) */
  dialogMessages?: Partial<DialogMessages>
}

/** 容器上下文:useChat 对话状态(chat.*) + 容器级共享 UI 状态/方法 */
export interface ChatContext {
  /** 对话状态 + 操作(useChat 14 项:state/scrollContainer/pendingApproval/queuedTasks/sendMessage/...) */
  chat: ChatStore
  /** 输入框文本(ChatInput v-model + QueuedBar「修改」写回,绑同一 ref 对象) */
  inputText: Ref<string>
  /** 对话框是否展开(收起后只剩头部条) */
  isExpanded: Ref<boolean>
  toggleCollapse: () => void
  /** 调试抽屉显隐(ChatHeader 开 + DebugDrawer slot) */
  debugVisible: Ref<boolean>
  openDebug: () => void
  closeDebug: () => void
  /** Skill 管理面板显隐(ChatHeader 开 + SkillPanel slot) */
  skillVisible: Ref<boolean>
  openSkill: () => void
  closeSkill: () => void
  /** 思考过程折叠状态(按消息索引;undefined=展开,手动折叠后存 false) */
  reasoningExpanded: Ref<Record<number, boolean>>
  isReasoningExpanded: (idx: number) => boolean
  toggleReasoning: (idx: number) => void
  /** 复制反馈(复制成功后 1.5s 高亮「已复制」) */
  copiedMsg: Ref<boolean>
  copyMessage: (text: string) => void
  /** 能力徽标摘要(MCP server 数 + 工具数,从 getInfo 拉) */
  summary: ComputedRef<{ mcp: number; tools: number }>
  /** 是否有可回退的 checkpoint(响应式:每次渲染重读) */
  canUndo: ComputedRef<boolean>
  /** 一键回退到上次正常 checkpoint */
  undo: () => void
  /** 时间格式化(HH:mm,zh-CN) */
  formatTime: (timestamp: number) => string
  /** 发送当前输入框内容 + 清空输入框 */
  send: () => void
  /** 输入框键盘事件(Enter 发送;IME 合成期 / Shift+Enter 不发) */
  keydown: (e: KeyboardEvent) => void
  // ===== 图片输入(image-input-vision Phase 1)=====
  /** 待发送图片(压缩后;随下一条消息发出,发送后清空) */
  pendingImages: Ref<AgentImage[]>
  /** 添加图片(压缩闸 + 数量上限;错误写入 imageInputError,不抛) */
  addImageFiles: (files: File[] | FileList) => Promise<void>
  /** 移除待发送图片(by id;chip ✕) */
  removePendingImage: (id: string) => void
  /** 输入侧图片错误(超限/损坏等;4s 自动清除) */
  imageInputError: Ref<string>
  /** 是否正在压缩图片(禁用发送按钮防重复添加) */
  compressingImages: Ref<boolean>
  /** 修改排队任务:填回输入框(供编辑)+ 从队列移除 */
  editQueued: (idx: number) => void
  /** 是否为流式占位 assistant(末位 + loading + content/reasoning 均空 → 显示三点动画) */
  isPendingAssistant: (idx: number) => boolean
  /** 全部聚焦焦点(响应式:infoTick ++ → 重算;空数组=未聚焦;ChatInput 多 chip 渲染 🎯 path) */
  focuses: ComputedRef<Focus[]>
  /** 追加聚焦焦点(→ sdk.addFocus) */
  addFocus: (focus: Focus) => { ok: boolean; error?: string }
  /** 移除单个聚焦焦点(→ sdk.removeFocus;ChatInput chip ✕) */
  removeFocus: (path: string) => void
  /** 清除全部聚焦焦点(→ sdk.clearFocus) */
  clearFocus: () => void
  /** chip 点击回调(→ emit focus_chip_click;集成方可滚动/高亮组件) */
  focusChipClick: (focus: Focus) => void
  /** 图标集(resolveDialogIcons 解析后的完整形态;原子组件经 ctx.icons.<key> 取用) */
  icons: DialogIcons
  /** 语言(dialog.locale 解析后) */
  locale: DialogLocale
  /** 文案集(resolveDialogMessages 解析后的完整形态;原子组件经 ctx.messages.<key> 取用) */
  messages: DialogMessages
}

/** provide/inject 注入键 */
export const chatContextKey: InjectionKey<ChatContext> = Symbol('chatContext')

/**
 * 创建容器上下文(跑一次 useChat + 创建容器级 UI 状态)。
 * 容器组件(ChatDialog)调一次,`provide(chatContextKey, ctx)` 注入给原子组件子树。
 */
export function createChatContext(opts: ChatContextOptions = {}): ChatContext {
  const chat = useChat({
    fetchResponse: opts.fetchResponse,
    fetchStream: opts.fetchStream,
    messages: opts.messages,
    onPersist: opts.onPersist,
    onClear: opts.onClear,
    onQueuedCleared: opts.onQueuedCleared,
  })
  const { state, sendMessage, removeQueuedTask, queuedTasks } = chat

  // 容器 UI 状态
  const inputText = ref('')
  const isExpanded = ref(true)
  const toggleCollapse = (): void => {
    isExpanded.value = !isExpanded.value
  }
  const debugVisible = ref(false)
  const openDebug = (): void => {
    debugVisible.value = true
  }
  const closeDebug = (): void => {
    debugVisible.value = false
  }
  const skillVisible = ref(false)
  const openSkill = (): void => {
    skillVisible.value = true
  }
  const closeSkill = (): void => {
    skillVisible.value = false
  }

  // 思考过程折叠(按消息索引);默认折叠(=== true 才展开)—— 思考过程不打扰用户,点击「展开」才看详情
  const reasoningExpanded = ref<Record<number, boolean>>({})
  const isReasoningExpanded = (idx: number): boolean => reasoningExpanded.value[idx] === true
  const toggleReasoning = (idx: number): void => {
    reasoningExpanded.value[idx] = !isReasoningExpanded(idx)
  }

  // 复制反馈
  const copiedMsg = ref(false)
  const copyMessage = (text: string): void => {
    copyText(text).then((ok) => {
      if (ok) {
        copiedMsg.value = true
        setTimeout(() => {
          copiedMsg.value = false
        }, 1500)
      }
    })
  }

  // 派生:能力徽标 / checkpoint 回退 / 时间格式化
  const summary = computed<{ mcp: number; tools: number }>(() => {
    const info = opts.getInfo?.()
    return { mcp: info?.mcp?.servers?.length ?? 0, tools: info?.tools?.length ?? 0 }
  })
  // canRestore() 读普通数组(非响应式)。原 ChatDialog 靠 props.canUndo 每次 sdk render 传新箭头函数
  // 触发 computed 重算;createChatContext 的 opts 仅 setup 跑一次(固定首次箭头),失去该触发。
  // 改借 state.messages 响应式:每轮 agent 行动 messages 变(checkpoint 在行动前 save,stack 已更新)→ canUndo 重算
  const canUndo = computed<boolean>(() => {
    void state.messages.length
    return typeof opts.canUndo === 'function' ? !!opts.canUndo() : false
  })
  const undo = (): void => {
    if (opts.onUndo?.()) state.error = null
  }
  const formatTime = (timestamp: number): string =>
    new Date(timestamp).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

  // 输入动作
  const send = (): void => {
    const images = pendingImages.value
    if (!inputText.value.trim() && !images.length) return
    sendMessage(inputText.value, focuses.value, images.length ? [...images] : undefined) // 附发送时焦点快照 + 待发送图片
    inputText.value = ''
    pendingImages.value = [] // 图片已随消息持有,清待发区
  }

  // 图片输入(image-input-vision Phase 1):压缩闸 + 数量上限;错误走输入区提示条(4s 自动清),不弹窗
  const pendingImages = ref<AgentImage[]>([])
  const imageInputError = ref('')
  const compressingImages = ref(false)
  let imageErrorTimer: ReturnType<typeof setTimeout> | undefined
  const showImageError = (msg: string): void => {
    imageInputError.value = msg
    clearTimeout(imageErrorTimer)
    imageErrorTimer = setTimeout(() => {
      imageInputError.value = ''
    }, 4000)
  }
  const addImageFiles = async (files: File[] | FileList): Promise<void> => {
    const list = Array.from(files).filter((f) => /^image\//i.test(f.type) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name))
    if (!list.length) return
    const room = MAX_IMAGES_PER_ROUND - pendingImages.value.length
    if (room <= 0) {
      showImageError(`${messages.imageCountLimitPrefix}${MAX_IMAGES_PER_ROUND}${messages.imageCountLimitSuffix}`)
      return
    }
    if (list.length > room) showImageError(`${messages.imageCountLimitPrefix}${MAX_IMAGES_PER_ROUND}${messages.imageCountLimitSuffix}`)
    compressingImages.value = true
    try {
      for (const f of list.slice(0, room)) {
        try {
          const im = await compressImage(f, { name: f.name })
          pendingImages.value.push(im)
        } catch (e) {
          // 输入侧即时拒绝(D6):损坏/超限单图跳过并提示,不影响其余图
          showImageError(e instanceof ImageInputError ? `${e.message}` : messages.imageInvalid)
        }
      }
    } finally {
      compressingImages.value = false
    }
  }
  const removePendingImage = (id: string): void => {
    pendingImages.value = pendingImages.value.filter((im) => im.id !== id)
  }
  const keydown = (e: KeyboardEvent): void => {
    // IME 输入法合成期回车(确认候选词)不发送(isComposing / keyCode 229);否则中文输入必现误发
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }
  const editQueued = (idx: number): void => {
    inputText.value = queuedTasks.value[idx] || ''
    removeQueuedTask(idx)
  }

  // 流式占位 assistant 检测(末位 + loading + 无内容 → 三点动画,避免再叠加底部 loading 头像)
  const isPendingAssistant = (idx: number): boolean => {
    const msgs = state.messages
    const m = msgs[idx]
    if (!m || m.role !== 'assistant') return false
    const reasoning = 'reasoning' in m ? (m as { reasoning?: string }).reasoning : undefined
    return state.loading && idx === msgs.length - 1 && !m.content && !reasoning
  }

  // 上下文聚焦(响应式:infoTick ++ → 重算;ChatInput 多 chip 显示 🎯 path + ✕ 移除单个 + 点 chip 回调)
  const focuses = computed<Focus[]>(() => {
    void opts.infoTick?.value
    return opts.getFocuses?.() ?? []
  })
  const addFocus = (f: Focus): { ok: boolean; error?: string } => (opts.onAddFocus ? opts.onAddFocus(f) : { ok: false, error: 'focus 未启用' })
  const removeFocus = (path: string): void => { opts.onRemoveFocus?.(path) }
  const clearFocus = (): void => {
    opts.onClearFocus?.()
  }
  const focusChipClick = (f: Focus): void => { opts.onFocusChipClick?.(f) }

  // 图标集(dialog.icons 局部覆盖 → 完整形态;注入 ctx 供各原子组件取用)
  const icons = resolveDialogIcons(opts.icons)
  // 文案集(dialog.locale + dialog.messages 键级覆盖;formatTime 跟 locale)
  const locale = opts.locale ?? 'zh-CN'
  const messages = resolveDialogMessages(locale, opts.dialogMessages)

  return {
    chat,
    inputText,
    isExpanded,
    toggleCollapse,
    debugVisible,
    openDebug,
    closeDebug,
    skillVisible,
    openSkill,
    closeSkill,
    reasoningExpanded,
    isReasoningExpanded,
    toggleReasoning,
    copiedMsg,
    copyMessage,
    summary,
    canUndo,
    undo,
    formatTime,
    send,
    keydown,
    pendingImages,
    addImageFiles,
    removePendingImage,
    imageInputError,
    compressingImages,
    editQueued,
    isPendingAssistant,
    focuses,
    addFocus,
    removeFocus,
    clearFocus,
    focusChipClick,
    icons,
    locale,
    messages,
  }
}

/**
 * 从注入上下文取 ChatContext(原子组件用)。
 * 未在 provide(chatContextKey) 子树内调用 → 抛错(防静默 undefined 致后续解构崩溃)。
 */
export function useChatContext(): ChatContext {
  const ctx = inject(chatContextKey)
  if (!ctx) throw new Error('useChatContext 必须在 provide(chatContextKey) 的组件子树内调用')
  return ctx
}
