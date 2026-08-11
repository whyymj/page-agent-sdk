<script setup lang="ts">
import MessageContent from '../MessageContent.vue'

defineProps<{
  content: string
  role: 'user' | 'assistant'
  /** 流式占位(末位 + loading + 无内容 → 三点动画) */
  isPendingAssistant: boolean
  /** 三点动画 vs 「思考中…」文字 */
  showTyping: boolean
  /** 流式光标(生成中有内容时尾部闪烁竖条) */
  showCursor: boolean
}>()
</script>

<template>
  <div class="message-bubble" :class="[role, { typing: isPendingAssistant }]">
    <template v-if="isPendingAssistant">
      <!-- 设计稿「思考中」态:8px 主色圆角方点 + 文案;showTyping 时方点呼吸脉冲 -->
      <span class="typing-dot" :class="{ pulse: showTyping }"></span>
      <span class="typing-text">思考中...</span>
    </template>
    <template v-else>
      <MessageContent v-if="role === 'assistant'" :content="content" />
      <template v-else>{{ content }}</template>
    </template>
  </div>
  <span v-if="showCursor" class="stream-cursor"></span>
</template>

<style scoped>
.message-bubble {
  padding: 9px 13px; border-radius: var(--cs-radius-bubble, 12px); font-size: 12px; line-height: 1.7;
  overflow-wrap: anywhere; word-break: break-word; white-space: pre-wrap;
}
/* role 变体用自身 class(非依赖祖先 .message-row.role),组件自包含 */
.message-bubble.assistant { background: var(--cs-bubble-ai, #f3f4f6); color: var(--cs-bg-text, #1f2937); border-bottom-left-radius: 4px; white-space: normal; overflow-wrap: anywhere; }
.message-bubble.user { background: var(--cs-bubble-user, var(--cs-primary, #1f4d3a)); color: #fff; border-bottom-right-radius: 4px; }

.typing { display: flex; align-items: center; gap: 6px; padding: 4px 2px; }
.typing-dot { width: 8px; height: 8px; border-radius: 3px; background: var(--cs-typing-dot, var(--cs-primary, #1f4d3a)); flex-shrink: 0; }
.typing-dot.pulse { animation: cs-dot-pulse 1.2s infinite ease-in-out; }
@keyframes cs-dot-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.typing-text { font-size: 13px; color: var(--cs-bg-text, #6b7280); }

.stream-cursor { display: inline-block; width: 7px; height: 14px; margin-left: 2px; vertical-align: text-bottom; background: var(--cs-primary); animation: cs-blink 1s steps(2) infinite; }
@keyframes cs-blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
</style>
