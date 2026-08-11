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
}>(), {
  title: 'AI 助手',
  placeholder: '输入消息,Enter 发送...',
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
})
provide(chatContextKey, ctx)

// template 直接用的容器状态(解构 ref,template 自动解包)
const { isExpanded, debugVisible, skillVisible, closeSkill } = ctx

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
  <div class="chat-dialog" :class="{ collapsed: !isExpanded && !drawer, drawer }" :style="drawerWidthStyle ? { width: drawerWidthStyle, maxWidth: drawerWidthStyle } : null">
    <!-- 头部 -->
    <template v-if="renderSection('header')">
      <slot name="header" :chat="ctx">
        <ChatHeader
          :title="title"
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
        <FocusBar :get-focus="getFocus" :on-set-focus="onSetFocus" :on-clear-focus="onClearFocus" :info-tick="infoTick" />
      </slot>
    </template>

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
        <ConflictBar :pending-conflict="pendingConflict" :on-resolve="onResolveConflict" />
      </slot>
    </template>

    <!-- 输入区域 -->
    <template v-if="renderSection('footer')">
      <Transition name="cs-slide">
        <slot name="footer" :chat="ctx">
          <ChatInput :placeholder="placeholder" :input-rows="inputRows" />
        </slot>
      </Transition>
    </template>

    <!-- 调试抽屉 -->
    <template v-if="renderSection('debug')">
      <slot name="debug" :chat="ctx">
        <DebugDrawer v-model:visible="debugVisible" :logs="debugLogs" :get-info="getInfo" :info-tick="infoTick" :get-skill-content="getSkillContent" />
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
</style>
