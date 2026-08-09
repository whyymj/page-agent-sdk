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
      <template v-if="showTyping"><span class="dot"></span><span class="dot"></span><span class="dot"></span></template>
      <span v-else class="typing-text">思考中…</span>
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
  padding: 9px 13px; border-radius: 12px; font-size: 12px; line-height: 1.7;
  overflow-wrap: anywhere; word-break: break-word; white-space: pre-wrap;
}
/* role 变体用自身 class(非依赖祖先 .message-row.role),组件自包含 */
.message-bubble.assistant { background: #f3f4f6; color: #1f2937; border-bottom-left-radius: 4px; white-space: normal; overflow-wrap: anywhere; }
.message-bubble.user { background: var(--cs-primary); color: #fff; border-bottom-right-radius: 4px; }

.typing { display: flex; gap: 4px; padding: 12px 16px; }
.typing .dot { width: 8px; height: 8px; border-radius: 50%; background: #9ca3af; animation: cs-bounce 1.4s infinite ease-in-out; }
.typing .dot:nth-child(2) { animation-delay: 0.2s; }
.typing .dot:nth-child(3) { animation-delay: 0.4s; }
/* 改名 cs-bounce 避免与全局/其他组件 bounce 命名冲突(scoped 下 @keyframes 仍可能泄漏,显式前缀更稳) */
@keyframes cs-bounce { 0%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-6px); } }
.typing-text { font-size: 13px; color: #9ca3af; }

.stream-cursor { display: inline-block; width: 7px; height: 14px; margin-left: 2px; vertical-align: text-bottom; background: var(--cs-primary); animation: cs-blink 1s steps(2) infinite; }
@keyframes cs-blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }
</style>
