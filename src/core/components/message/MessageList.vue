<script setup lang="ts">
/**
 * 消息列表(chat-body):空态 + MessageRow 列表 + 非流式 loading 占位 + error-bar。
 * 消息层唯一 inject ctx 的组件:把 ctx(chat 状态 + 容器方法)拆成 props 下传 MessageRow,
 * 使 MessageRow 及其 5 子件保持纯 props 零依赖(design §3)。
 * showAvatar/showTyping 走 props(design §2「纯展示配置走 props」,非 ctx)。
 */
import { computed } from 'vue'
import { useChatContext } from '../../composables/chatContext'
import IconGlyph from '../IconGlyph.vue'
import MessageRow from './MessageRow.vue'
import MessageBubble from './MessageBubble.vue'
import AvatarIcon from './AvatarIcon.vue'

defineProps<{ showAvatar: boolean; showTyping: boolean }>()

const ctx = useChatContext()
const { chat, formatTime, copiedMsg, copyMessage, isPendingAssistant, isReasoningExpanded, toggleReasoning, canUndo, undo, icons } = ctx
// 滚动容器已上移至 ChatDialog 的 .chat-main(消息 + queued/approval/conflict 统一滚动);
// 此处只取状态与重试方法
const { state, retry, regenerate } = chat

const hasMessages = computed(() => state.messages.length > 0)
const hasUserMessage = computed(() => state.messages.some((m) => m.role === 'user'))
/** 最后一条是否 assistant(流式时 assistant 占位已 push,此时不再叠 loading 占位,避免两个 AI 头像) */
const lastIsAssistant = computed(() => state.messages[state.messages.length - 1]?.role === 'assistant')
</script>

<template>
  <div class="chat-body">
    <div v-if="!hasMessages" class="empty-state">
      <div class="empty-icon"><IconGlyph :icon="icons.empty" /></div>
      <p>有什么可以帮你的?</p>
    </div>

    <MessageRow
      v-for="(msg, idx) in state.messages"
      :key="idx"
      :message="msg"
      :index="idx"
      :show-avatar="showAvatar"
      :show-typing="showTyping"
      :is-pending-assistant="isPendingAssistant(idx)"
      :reasoning-expanded="isReasoningExpanded(idx)"
      :copied="copiedMsg"
      :is-last="idx === state.messages.length - 1"
      :loading="state.loading"
      :time="formatTime(msg.timestamp)"
      @toggle-reasoning="toggleReasoning(idx)"
      @copy="copyMessage(msg.content)"
      @regenerate="regenerate"
    />

    <!-- 加载占位:仅当最后一条不是 assistant 占位时(非流式等待)才单独显示,避免与流式占位叠加成两个 AI 头像 -->
    <div v-if="state.loading && !lastIsAssistant" class="message-row assistant">
      <div v-if="showAvatar" class="message-avatar"><AvatarIcon role="assistant" :glyph="icons.assistantAvatar" /></div>
      <div class="message-content">
        <MessageBubble content="" role="assistant" :is-pending-assistant="true" :show-typing="showTyping" :show-cursor="false" />
      </div>
    </div>

    <!-- 错误提示 + 重试 / 回退 -->
    <div v-if="state.error" class="error-bar">
      <span class="error-text">{{ state.error }}</span>
      <button v-if="hasUserMessage" class="retry-btn" @click="retry">重试</button>
      <button v-if="canUndo" class="undo-btn" title="回退到上次正常状态(还原对话历史 + 页面属性 + 工作区)" @click="undo">↩ 回退</button>
    </div>
  </div>
</template>

<style scoped>
/* 滚动由外层 .chat-main(ChatDialog)承担;此处仅消息流容器,撑满滚动区可视高度(空态居中) */
.chat-body { padding: 16px; display: flex; flex-direction: column; min-height: 100%; }
/* 注:不设 scroll-behavior:smooth —— 流式生成频繁 scrollToBottom,smooth 动画会与 @scroll 的 stick-to-bottom 判定竞争 */

.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; flex: 1; min-height: 200px; color: #9ca3af; }
.empty-icon { font-size: 48px; margin-bottom: 12px; }
.empty-state p { font-size: 14px; }

/* loading 占位行布局(与 MessageRow 的 .message-row base 共享;此处仅给 loading 占位用,scoped 隔离不跨组件) */
.message-row { display: flex; gap: 10px; margin-bottom: 16px; align-items: flex-start; }
.message-avatar { width: 32px; height: 32px; border-radius: 50%; background: #f3f4f6; display: flex; align-items: center; justify-content: center; color: #4b5563; flex-shrink: 0; }
.message-row.assistant .message-avatar { background: var(--cs-avatar-grad, linear-gradient(135deg, #92a2fe 0%, #645bff 100%)); color: #fff; }
.message-content { max-width: 80%; min-width: 0; }

.error-bar { display: flex; align-items: flex-start; gap: 10px; padding: 8px 12px; border-radius: 8px; background: #fef2f2; color: #dc2626; font-size: 13px; margin-top: 8px; }
.error-text { flex: 1; min-width: 0; word-break: break-word; overflow-wrap: anywhere; white-space: pre-wrap; line-height: 1.5; max-height: 120px; overflow-y: auto; }
.error-bar .retry-btn, .error-bar .undo-btn { flex-shrink: 0; margin-top: 1px; }
.retry-btn { flex-shrink: 0; padding: 3px 12px; border: none; border-radius: 6px; background: #dc2626; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
.retry-btn:hover { background: #b91c1c; }
.undo-btn { margin-left: 6px; padding: 2px 10px; border: 1px solid #f59e0b; border-radius: 6px; background: #fffbeb; color: #92400e; font-size: 11px; cursor: pointer; transition: all 0.2s; }
.undo-btn:hover { background: #fde68a; }
</style>
