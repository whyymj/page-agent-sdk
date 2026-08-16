<script setup lang="ts">
/**
 * 对话容器(组合编排):创建 ctx(createChatContext 跑一次 useChat + 容器级 UI 状态)→ provide 给原子组件子树,
 * 9 区块(header/focus/body/queued/approval/conflict/footer/debug/skill)经具名 slot 可替换 + sections 可关闭。
 * 业务逻辑全部下沉到 chatContext + 原子组件;本文件只做组装 + 根样式/主题变量/动画。
 * 默认路径(全开 + 无 slot)行为与拆分前零变化(design §6)。
 */
import { computed, provide, type Ref } from 'vue'
import { createChatContext, chatContextKey } from '../composables/chatContext'
import ChatHeader from './ChatHeader.vue'
import FocusBar from './FocusBar.vue'
import MessageList from './message/MessageList.vue'
import QueuedBar from './QueuedBar.vue'
import ApprovalBar from './ApprovalBar.vue'
import ConflictBar from './ConflictBar.vue'
import ChatInput from './ChatInput.vue'
import DebugDrawer from './DebugDrawer.vue'
import SkillPanel from './SkillPanel.vue'
import type { DebugLog } from '../harness/createAgent'
import type { DialogIcons } from './icons'
import type { DialogMessages, DialogLocale } from './messages'
import type { AgentMessage, AgentInfo, StreamHandler } from '../types'
import type { PendingConflict } from '../sdk/createChatSdk'
import type { ConflictResolution } from '../tools/dataOps'
import type { SessionMeta } from '../backends/storage'
import type { Focus } from '../harness/state'

/** 区块键(9 个;sections[k]===false 关闭整块含 slot) */
type SectionKey = 'header' | 'focus' | 'body' | 'queued' | 'approval' | 'conflict' | 'footer' | 'debug' | 'skill'

const props = withDefaults(defineProps<{
  fetchResponse?: (messages: AgentMessage[]) => Promise<string>
  fetchStream?: (messages: AgentMessage[], onEvent: StreamHandler) => Promise<string>
  title?: string
  placeholder?: string
  /** 调试日志(响应式数组),传入则显示调试按钮 */
  debugLogs?: DebugLog[]
  /** 初始消息(持久化恢复,与父级共享响应式引用) */
  initialMessages?: AgentMessage[]
  /** 一轮完成后持久化回调 */
  onPersist?: (messages: AgentMessage[]) => void
  /** stop() 清空排队任务时回调(P1-5 可见性;→ DebugDrawer 日志) */
  onQueuedCleared?: (dropped: string[]) => void
  /** 清空时回调(新建会话) */
  onClear?: () => void
  /** 获取 agent 详细信息(debug 窗口「Agent 信息」tab) */
  getInfo?: () => AgentInfo
  /** 回退到上次正常 checkpoint(checkpoint 选项开启时注入) */
  onUndo?: () => boolean
  /** 是否有可回退的 checkpoint(checkpoint 选项开启时注入) */
  canUndo?: () => boolean
  /** 显示头像(默认 true;false → 隐藏 🤖/👤 emoji 头像) */
  showAvatar?: boolean
  /** 显示打字动画(默认 true;false → 用「思考中…」文字替代三点动画) */
  showTyping?: boolean
  /** 乐观锁冲突挂起;core.pendingConflict 解包值,有冲突时非 null */
  pendingConflict?: PendingConflict | null
  /** 冲突解决回调:用户点「保留外部」/「强制覆盖」/「回退」→ 收口挂起的 conflict */
  onResolveConflict?: (action: ConflictResolution['action']) => void
  /** Agent 信息刷新 tick(setSkills/setData/setFocus 后 ++);触发 DebugDrawer/focus 重算 */
  infoTick?: Ref<number>
  /** 读取 skill 全文(DebugDrawer 展开 skill 时调,优先缓存) */
  getSkillContent?: (name: string) => Promise<string | null>
  /** ChatDialog 内创建 skill 面板提交时调 → sdk.addSkill */
  onAddSkill?: (skill: { name: string; description: string; getContent: () => string }) => void
  /** ChatDialog 内删除用户 skill 时调 → sdk.removeSkill */
  onRemoveSkill?: (name: string) => boolean
  /** 列出用户创建的 skill 名 */
  getUserSkillNames?: () => string[]
  /** 读取用户创建的 skill 详情 */
  onGetSkill?: (name: string) => { name: string; description: string; content: string } | undefined
  /** 抽屉模式:从右侧滑入 + 遮罩 + 关闭按钮 */
  drawer?: boolean
  /** 抽屉模式宽度(像素或 CSS 字符串);默认 420px */
  drawerWidth?: number | string
  /** 抽屉模式默认隐藏(sdk hide() 实现;此 prop 仅样式控制) */
  drawerHidden?: boolean
  /** 输入框行数;默认 2 */
  inputRows?: number
  /** 历史会话列表(storage 开启注入;不传则隐藏新建/历史按钮) */
  sessions?: SessionMeta[]
  /** 当前会话 id(历史列表高亮) */
  currentSessionId?: string
  onNewSession?: () => void
  onOpenSession?: (sessionId: string) => void
  onRemoveSession?: (sessionId: string) => void
  /** 读取当前聚焦焦点;未聚焦/未开启 → undefined */
  getFocus?: () => Focus | undefined
  /** 设置聚焦焦点(→ sdk.setFocus;非法 path 返回 {ok:false}) */
  onSetFocus?: (focus: Focus) => { ok: boolean; error?: string }
  /** 清除聚焦焦点(→ sdk.clearFocus) */
  onClearFocus?: () => void
  /** 读取全部聚焦焦点(multi-focus;→ ChatInput 多 chip) */
  getFocuses?: () => Focus[]
  /** 追加聚焦焦点(→ sdk.addFocus) */
  onAddFocus?: (focus: Focus) => { ok: boolean; error?: string }
  /** 移除单个聚焦焦点(→ sdk.removeFocus;ChatInput chip ✕) */
  onRemoveFocus?: (path: string) => void
  /** chip 点击回调(→ emit focus_chip_click;集成方可滚动/高亮组件) */
  onFocusChipClick?: (focus: Focus) => void
  /** 区块显隐控制(键=SectionKey,false 关闭;默认 undefined=全开,向后兼容) */
  sections?: Partial<Record<SectionKey, boolean>>
  /** 内置主题:'dark'(默认,深色紫调,方舟专题设计稿色板)/ 'light'(中性浅色) */
  csTheme?: 'light' | 'dark'
  /** 图标局部覆盖(→ ctx.icons;未传键用默认 emoji 🤖/🎯/…) */
  icons?: Partial<DialogIcons>
  /** 语言(→ ctx.messages/locale;缺省 zh-CN;title/placeholder 缺省值随语言包) */
  locale?: DialogLocale
  /** 文案键级覆盖(→ ctx.messages;优先于 locale 包) */
  messages?: Partial<DialogMessages>
}>(), {
  showAvatar: true,
  showTyping: true,
  inputRows: 2,
})

const emit = defineEmits<{ (e: 'close'): void }>()

// 创建容器上下文(跑一次 useChat + 容器级 UI 状态)+ provide 给原子组件子树
const ctx = createChatContext({
  fetchResponse: props.fetchResponse,
  fetchStream: props.fetchStream,
  messages: props.initialMessages,
  onPersist: props.onPersist,
  onClear: props.onClear,
  onQueuedCleared: props.onQueuedCleared,
  getInfo: props.getInfo,
  canUndo: props.canUndo,
  onUndo: props.onUndo,
  getFocuses: props.getFocuses,
  onAddFocus: props.onAddFocus,
  onRemoveFocus: props.onRemoveFocus,
  onClearFocus: props.onClearFocus,
  onFocusChipClick: props.onFocusChipClick,
  infoTick: props.infoTick,
  icons: props.icons,
  locale: props.locale,
  dialogMessages: props.messages,
})
provide(chatContextKey, ctx)

// template 直接用的容器状态(解构 ref,template 自动解包)
const { isExpanded, debugVisible, skillVisible, closeSkill } = ctx
// 滚动容器上移至 .chat-main(消息 + queued/approval/conflict 统一滚动;header/footer 固定),
// approval-bar 不再被 overflow:hidden 裁剪 —— 与消息一起滚动,超高内容可达。
const { scrollContainer, onScroll, onWheel } = ctx.chat

/** 区块是否渲染:sections[k] !== false(默认全开,向后兼容)。
 *  例外:focus 默认移至 ChatInput 内 inline chip(输入框区,更贴近输入位置);集成方显式 sections.focus=true 恢复顶部独立条(向后兼容)。 */
function renderSection(k: SectionKey): boolean {
  if (k === 'focus') return props.sections?.focus === true
  return props.sections?.[k] !== false
}

/** 是否支持 Skill 管理(onAddSkill 存在) */
const skillAvailable = computed(() => !!props.onAddSkill)

/** 抽屉模式宽度样式(像素或 CSS 字符串归一化) */
const drawerWidthStyle = computed(() => {
  if (!props.drawer || props.drawerWidth == null) return null
  const w = props.drawerWidth
  return typeof w === 'number' ? `${w}px` : w
})
</script>

<template>
  <div v-if="drawer" class="chat-mask" @click="emit('close')"></div>
  <div class="chat-dialog" :class="{ collapsed: !isExpanded && !drawer, drawer, 'cs-theme-dark': csTheme === 'dark' }" :style="drawerWidthStyle ? { width: drawerWidthStyle, maxWidth: drawerWidthStyle } : null">
    <!-- 头部 -->
    <template v-if="renderSection('header')">
      <slot name="header" :chat="ctx">
        <ChatHeader
          :title="title || ctx.messages.defaultTitle"
          :drawer="drawer"
          :debug-logs="debugLogs"
          :skill-available="skillAvailable"
          :sessions="sessions"
          :current-session-id="currentSessionId"
          :on-new-session="onNewSession"
          :on-open-session="onOpenSession"
          :on-remove-session="onRemoveSession"
          @close="emit('close')"
        />
      </slot>
    </template>

    <!-- 上下文聚焦条(指定组件精修) -->
    <template v-if="renderSection('focus')">
      <slot name="focus" :chat="ctx">
        <FocusBar :get-focus="getFocus" :on-set-focus="onSetFocus" :on-clear-focus="onClearFocus" :info-tick="infoTick" :icons="ctx.icons" :messages="ctx.messages" />
      </slot>
    </template>

    <!-- 统一滚动区:消息 + 排队 + 人工确认 + 冲突(一起滚动;header/footer 固定)。
         approval-bar 高内容不再被 overflow:hidden 裁剪 —— 用户可滚动查看全部。 -->
    <div class="chat-main" ref="scrollContainer" @scroll="onScroll" @wheel="onWheel">
    <!-- 消息列表 -->
    <template v-if="renderSection('body')">
      <Transition name="cs-slide">
        <slot name="body" :chat="ctx">
          <MessageList v-show="isExpanded" :show-avatar="showAvatar" :show-typing="showTyping" />
        </slot>
      </Transition>
    </template>

    <!-- 排队区 -->
    <template v-if="renderSection('queued')">
      <slot name="queued" :chat="ctx"><QueuedBar /></slot>
    </template>

    <!-- 人工确认 -->
    <template v-if="renderSection('approval')">
      <slot name="approval" :chat="ctx"><ApprovalBar /></slot>
    </template>

    <!-- 乐观锁冲突 -->
    <template v-if="renderSection('conflict')">
      <slot name="conflict" :chat="ctx">
        <ConflictBar :pending-conflict="pendingConflict" :on-resolve="onResolveConflict" :icons="ctx.icons" :messages="ctx.messages" />
      </slot>
    </template>
    </div>

    <!-- 输入区域 -->
    <template v-if="renderSection('footer')">
      <Transition name="cs-slide">
        <slot name="footer" :chat="ctx">
          <ChatInput :placeholder="placeholder || ctx.messages.inputPlaceholder" :input-rows="inputRows" />
        </slot>
      </Transition>
    </template>

    <!-- 调试抽屉 -->
    <template v-if="renderSection('debug')">
      <slot name="debug" :chat="ctx">
        <DebugDrawer v-model:visible="debugVisible" :logs="debugLogs" :get-info="getInfo" :info-tick="infoTick" :get-skill-content="getSkillContent" :cs-theme="csTheme" :messages="ctx.messages" :locale="ctx.locale" />
      </slot>
    </template>

    <!-- Skill 管理 -->
    <template v-if="renderSection('skill')">
      <slot name="skill" :chat="ctx">
        <SkillPanel
          :visible="skillVisible"
          :on-add-skill="onAddSkill"
          :on-remove-skill="onRemoveSkill"
          :get-user-skill-names="getUserSkillNames"
          :on-get-skill="onGetSkill"
          :messages="ctx.messages"
          @close="closeSkill"
        />
      </slot>
    </template>
  </div>
</template>

<style scoped>
/* 抽屉模式:遮罩 + 从右滑入的固定面板 */
.chat-mask {
  position: fixed; inset: 0; z-index: 9998;
  background: rgba(0, 0, 0, 0.45);
  animation: cs-mask-in 0.28s ease;
}
@keyframes cs-mask-in { from { opacity: 0; } to { opacity: 1; } }
.chat-dialog.drawer {
  position: fixed; top: 0; right: 0; bottom: 0;
  width: 420px; max-width: 92vw; height: 100vh;
  z-index: 9999;
  border-radius: 0;
  animation: cs-drawer-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes cs-drawer-slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
@media (prefers-reduced-motion: reduce) {
  .chat-mask { animation: none; }
  .chat-dialog.drawer { animation: none; }
}

.chat-dialog {
  /* 主题变量(集成方可覆盖;默认中性主题)。在祖先元素或 :root 覆盖 --cs-* 即可换主题 */
  --cs-primary: #1f4d3a;
  --cs-primary-rgb: 31, 77, 58;
  --cs-bg: #ffffff;
  --cs-bg-text: #1f2937;
  --cs-bg-muted: #9ca3af;
  --cs-bubble-ai: #f3f4f6;
  --cs-radius: 12px;
  --cs-reason-bg: #f0f7f3;
  --cs-reason-border: #b8d4c5;
  --cs-reason-head: #2d5a47;
  --cs-reason-text: #41544c;
  --cs-reason-toggle: #6b8c79;
  --cs-step-bg: #f4f6f8;
  --cs-step-border: #e2e6ea;
  --cs-step-text: #374151;
  --cs-step-meta: #9ca3af;
  --cs-ok: #16a34a; --cs-ok-rgb: 22, 163, 74;
  --cs-warn: #d97706; --cs-warn-rgb: 217, 119, 6;
  --cs-err: #dc2626; --cs-err-rgb: 220, 38, 38;
  --cs-sub-bg: #faf5ff;
  --cs-sub-border: #c4b5fd;
  --cs-sub-text: #6d28d9;
  --cs-md-border: #e5e7eb;
  --cs-md-th-bg: #f9fafb;
  --cs-md-code-bg: rgba(102, 126, 234, 0.1);
  --cs-md-code-text: #4338ca;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  border-radius: var(--cs-radius);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08);
  background: var(--cs-bg);
  overflow: hidden;
  transition: all 0.3s ease;
  animation: cs-drawer-in 0.28s cubic-bezier(0.16, 1, 0.3, 1);
}

/* 统一滚动区:消息 + queued/approval/conflict 一起滚动;flex:1 占满 header~footer 之间,overflow 限高 */
.chat-main { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }

@keyframes cs-drawer-in {
  from { opacity: 0; transform: translateX(32px); }
  to { opacity: 1; transform: translateX(0); }
}
@media (prefers-reduced-motion: reduce) {
  .chat-dialog { animation: none; }
}
.chat-dialog.collapsed { height: 52px; }

/* 收起/展开过渡:chat-body 与 chat-footer 淡入淡出 + 轻微平移 */
.cs-slide-enter-active, .cs-slide-leave-active { transition: opacity 0.22s ease, transform 0.22s ease; }
.cs-slide-enter-from, .cs-slide-leave-to { opacity: 0; transform: translateY(-6px); }

/* 卸载退出过渡:sdk.unmount() 在根元素加 cs-leaving class,触发淡出 + 缩放,动画结束再卸载 DOM */
.chat-dialog.cs-leaving { opacity: 0; transform: scale(0.96) translateY(8px); pointer-events: none; }
.chat-dialog.drawer.cs-leaving { transform: translateX(100%); }
.chat-mask.cs-leaving { opacity: 0; }
/* 抽屉模式隐藏(sdk.hide()):不卸载,保留 agent/历史/生成进程;opacity+visibility 保留 transition */
.chat-dialog.cs-hidden, .chat-mask.cs-hidden { opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.2s ease, visibility 0s 0.2s; }

/* ===== 内置深色主题(dialog.theme:'dark',色板取自方舟专题设计稿 Figma 471:6389)=====
   集成方亦可在祖先覆盖 --cs-* 自定义;本块只设变量 + 外框,子组件经变量自动跟随 */
.chat-dialog.cs-theme-dark {
  --cs-primary: #7063e7;
  --cs-primary-rgb: 112, 99, 231;
  --cs-accent: #9993ff;
  --cs-bg: #222222;
  --cs-bg-text: #ffffff;
  --cs-bg-muted: #999999;
  --cs-bubble-ai: #353535;
  --cs-bubble-user: #7063e7;
  --cs-radius: 6px;
  --cs-radius-bubble: 9px;
  --cs-header-bg: #353535;
  --cs-surface: #353535;          /* 下拉菜单/弹层面板 */
  --cs-surface-text: #ffffff;
  --cs-surface-border: rgba(255, 255, 255, 0.12);
  --cs-action-bg: #444444;        /* 头部 pill 按钮/图标按钮底 */
  --cs-action-hover: #555555;
  --cs-action-text: #9993ff;
  --cs-surface-hover: rgba(90, 90, 90, 0.5);
  --cs-hist-active-bg: #7063e7;   /* 历史列表当前项:整行主色(设计稿 04) */
  --cs-hist-active-border: none;
  --cs-hist-active-text: #ffffff;
  --cs-typing-dot: #7063e7;
  --cs-reason-bg: #2c2c2c;
  --cs-reason-border: #3a3a3a;
  --cs-reason-head: #ffffff;
  --cs-reason-text: #999999;
  --cs-reason-toggle: #9993ff;
  --cs-step-bg: #2c2c2c;
  --cs-step-border: #3a3a3a;
  --cs-step-text: #ffffff;
  --cs-step-meta: #666666;
  --cs-ok: #00c562; --cs-ok-rgb: 0, 197, 98;
  --cs-warn: #f0a020; --cs-warn-rgb: 240, 160, 32;
  --cs-err: #f04848; --cs-err-rgb: 240, 72, 72;
  --cs-sub-bg: rgba(112, 99, 231, 0.12);
  --cs-sub-border: #7063e7;
  --cs-sub-text: #9993ff;
  --cs-md-border: #5a5a5a;
  --cs-md-th-bg: #444444;
  --cs-md-code-bg: rgba(153, 147, 255, 0.12);
  --cs-md-code-text: #9993ff;
  --cs-input-bg: rgba(18, 18, 18, 0.4);
  --cs-input-border: rgba(115, 114, 255, 0.5);
  --cs-input-radius: 12px;
  --cs-send-radius: 18px;
  --cs-send-grad: linear-gradient(97.7deg, #5e54ff 0%, #95a6ff 100%);
  --cs-avatar-grad: linear-gradient(135deg, #92a2fe 0%, #645bff 100%);
  --cs-avatar-size: 28px;
  --cs-avatar-radius: 14px;
  /* 外框:1px #353535 边 + 底部紫色微光渐变(设计稿 05 容器) */
  border: 1px solid #353535;
  background: linear-gradient(180deg, rgba(34, 34, 34, 0.2) 1.4%, rgba(79, 63, 233, 0.16) 100%), #222222;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
</style>
