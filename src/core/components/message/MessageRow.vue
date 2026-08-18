<script setup lang="ts">
import { computed } from 'vue'
import type { AgentMessage, ToolStep } from '../../types'
import { useChatContext } from '../../composables/chatContext'
import MessageReasoning from './MessageReasoning.vue'
import MessageSteps from './MessageSteps.vue'
import MessageBubble from './MessageBubble.vue'
import MessageTime from './MessageTime.vue'
import MessageActions from './MessageActions.vue'
import AvatarIcon from './AvatarIcon.vue'
import IconGlyph from '../IconGlyph.vue'

const props = defineProps<{
  message: AgentMessage
  index: number
  showAvatar: boolean
  showTyping: boolean
  /** 末位 + loading + 无内容 → 三点占位 */
  isPendingAssistant: boolean
  /** 该消息的思考过程是否展开 */
  reasoningExpanded: boolean
  /** 该消息是否处于「已复制」高亮 */
  copied: boolean
  /** 是否为消息列表末位(控制操作按钮/光标显隐) */
  isLast: boolean
  /** 是否正在生成(控制操作按钮显隐) */
  loading: boolean
  /** 已格式化的时间字符串(由 MessageList 经 ctx.formatTime 算好下传,叶子零依赖) */
  time: string
}>()

defineEmits<{ (e: 'toggle-reasoning'): void; (e: 'copy'): void; (e: 'regenerate'): void }>()

// chip 交互(同 ChatInput 输入框 chip:本体点击 → focusChipClick 滚动/高亮;✕ → removeFocus 移除单个当前焦点)
const ctx = useChatContext()
const isAssistant = computed(() => props.message.role === 'assistant')
const reasoning = computed<string>(() =>
  isAssistant.value && 'reasoning' in props.message ? (props.message as { reasoning?: string }).reasoning ?? '' : '',
)
const steps = computed<ToolStep[]>(() =>
  isAssistant.value && 'steps' in props.message ? ((props.message as { steps?: ToolStep[] }).steps ?? []) : [],
)
/** 最后一条 assistant(非生成中)的操作按钮:复制 / 重新生成 */
const showActions = computed(() => isAssistant.value && !!props.message.content && !props.loading && props.isLast)
/** 流式光标:assistant + 生成中 + 末位 + 有内容 */
const showCursor = computed(() => isAssistant.value && props.loading && props.isLast && !!props.message.content)
</script>

<template>
  <div class="message-row" :class="message.role" :data-msg-idx="index">
    <div v-if="showAvatar" class="message-avatar"><AvatarIcon :role="message.role" :glyph="message.role === 'user' ? ctx.icons.userAvatar : ctx.icons.assistantAvatar" /></div>
    <div class="message-content">
      <MessageReasoning v-if="isAssistant" :text="reasoning" :expanded="reasoningExpanded" @toggle="$emit('toggle-reasoning')" />
      <MessageSteps v-if="isAssistant" :steps="steps" :icons="ctx.icons" :messages="ctx.messages" />
      <!-- user 消息发送时的焦点快照:历史记录只读(本体点击回看滚动);不带 ✕ —— 删历史 chip 改不了已发消息的上下文,还会误删当前焦点 -->
      <div v-if="message.role === 'user' && message.focuses?.length" class="msg-focuses">
        <span
          v-for="f in message.focuses"
          :key="f.path"
          class="msg-focus-chip"
          :title="ctx.messages.historyFocusChipTitlePrefix + f.path"
          @click="ctx.focusChipClick(f)"
        ><IconGlyph :icon="ctx.icons.focus" /> {{ f.path }}</span>
      </div>
      <!-- user 消息附带图片(image-input-vision):气泡上方缩略图行(thumb 优先,恢复后轻形态仍有;LRU 淘汰且无 thumb 显示占位框) -->
      <div v-if="message.role === 'user' && message.images?.length" class="msg-images" :data-img-count="message.images.length">
        <a
          v-for="im in message.images"
          :key="im.id"
          class="msg-image"
          :href="im.url || im.dataUri"
          :title="im.name || ctx.messages.imageAlt"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img v-if="im.thumb || im.dataUri" class="msg-image-thumb" :src="im.thumb || im.dataUri" :alt="im.name || ctx.messages.imageAlt" />
          <span v-else class="msg-image-lost">🖼️</span>
        </a>
      </div>
      <MessageBubble
        :messages="ctx.messages"
        :content="message.content"
        :role="message.role"
        :is-pending-assistant="isPendingAssistant"
        :show-typing="showTyping"
        :show-cursor="showCursor"
      />
      <MessageTime :time="time" />
      <MessageActions v-if="showActions" :messages="ctx.messages" :copied="copied" @copy="$emit('copy')" @regenerate="$emit('regenerate')" />
    </div>
  </div>
</template>

<style scoped>
.message-row { display: flex; gap: 10px; margin-bottom: 16px; align-items: flex-start; }
.message-row.user { flex-direction: row-reverse; }
.message-avatar {
  width: var(--cs-avatar-size, 32px); height: var(--cs-avatar-size, 32px); border-radius: var(--cs-avatar-radius, 50%); background: var(--cs-avatar-bg, #f3f4f6);
  display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0;
}
.message-row.assistant .message-avatar { background: var(--cs-avatar-grad, var(--cs-avatar-bg, #f3f4f6)); color: var(--cs-avatar-fg, #fff); }
.message-row.user .message-avatar { background: var(--cs-avatar-user-bg, #ecf5ef); color: var(--cs-avatar-user-fg, #3b5e4a); }
.message-content { width: 80%; min-width: 0; }
/* user 消息发送时焦点快照 chip(背景组件限制标注) */
.msg-focuses { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; margin-bottom: 4px; }
.msg-focus-chip { display: inline-flex; align-items: center; gap: 2px; padding: 1px 4px 1px 6px; border-radius: 10px; background: rgba(var(--cs-primary-rgb, 31, 77, 58), 0.12); color: var(--cs-primary, #1f4d3a); font-size: 11px; line-height: 1.6; cursor: pointer; white-space: nowrap; }
.msg-focus-chip:hover { background: rgba(var(--cs-primary-rgb, 31, 77, 58), 0.2); }
.message-row.user .message-content { display: flex; flex-direction: column; align-items: flex-end; }
/* user 消息图片缩略图行(image-input-vision):右对齐(user 侧),点开原图新窗(rel=noopener) */
.msg-images { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; margin-bottom: 4px; max-width: 100%; }
.msg-image { display: block; width: 72px; height: 72px; border-radius: 8px; overflow: hidden; border: 1px solid var(--cs-surface-border, rgba(0,0,0,0.08)); flex-shrink: 0; }
.msg-image-thumb { width: 100%; height: 100%; object-fit: cover; display: block; }
.msg-image-lost { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 20px; background: var(--cs-surface, #f3f4f6); opacity: 0.6; }
/* 跨边界:hover message-row.assistant 时显示子组件 MessageActions 的 .msg-actions(后代选择器穿透) */
.message-row.assistant:hover :deep(.msg-actions) { opacity: 1; }
</style>
