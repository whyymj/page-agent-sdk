<script setup lang="ts">
/**
 * 输入区域(chat-footer):textarea + 发送/停止按钮 + 回退(checkpoint 开启时)。
 * inputText 绑 ctx.inputText(同一 ref,QueuedBar「修改」也写它);send/keydown 走 ctx;
 * loading/stop 走 ctx.chat;canUndo/undo 走 ctx;placeholder/inputRows 走 props(展示配置)。
 */
import { useChatContext } from '../composables/chatContext'

defineProps<{ placeholder: string; inputRows: number }>()

const ctx = useChatContext()
const { inputText, send, keydown, canUndo, undo, focuses, removeFocus, focusChipClick, icons } = ctx
const { state, stop } = ctx.chat
</script>

<template>
  <div class="chat-footer">
    <button v-if="canUndo" class="undo-foot-btn" title="回退到上次正常状态(还原对话历史 + 页面属性 + 工作区)" @click="undo">↩ 回退</button>
    <div class="chat-input-wrap">
      <!-- 聚焦标签(inline chip):聚焦组件精修时,输入框内顶部显示多 chip(🎯 path,multi-focus)。
           chip 本体点击 → 回调(滚动/高亮组件);✕ 移除单个焦点(全移除=退出精修) -->
      <div v-if="focuses.length" class="focus-chips">
        <span
          v-for="f in focuses"
          :key="f.path"
          class="focus-chip"
          :title="`精修中:${f.path}(点击回看 · ✕ 移除)`"
          @click="focusChipClick(f)"
        >
          <span class="focus-chip-icon">{{ icons.focus }}</span><code class="focus-chip-path">{{ f.path }}</code>
          <button type="button" class="focus-chip-x" data-test="focus-clear" title="移除此焦点" @click.stop="removeFocus(f.path)">✕</button>
        </span>
      </div>
      <textarea
        v-model="inputText"
        class="chat-input"
        :class="{ 'has-focus-chip': focuses.length > 0 }"
        :placeholder="placeholder"
        :rows="inputRows"
        @keydown="keydown"
      ></textarea>
      <div class="input-actions">
        <span class="send-hint">Enter 发送 · Shift+Enter 换行</span>
        <button
          class="send-btn"
          :class="{ 'stop-btn': state.loading }"
          :disabled="!state.loading && !inputText.trim()"
          :title="state.loading ? '停止生成' : '发送'"
          @click="state.loading ? stop() : send()"
        >
          <svg v-if="state.loading" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2"></rect>
          </svg>
          <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.chat-footer {
  display: flex; align-items: flex-end; gap: 8px;
  padding: 12px 16px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  flex-shrink: 0;
}
.chat-input-wrap { flex: 1; position: relative; min-width: 0; }
/* 聚焦 inline chip:输入框内顶部多 chip(multi-focus);chip 本体点击 → 回调,✕ 移除单个 */
.focus-chips {
  position: absolute; top: 5px; left: 8px; right: 8px; z-index: 1;
  display: flex; flex-wrap: wrap; gap: 4px;
}
.focus-chip {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 1px 4px 1px 6px; border-radius: 10px;
  background: rgba(var(--cs-primary-rgb, 31, 77, 58), 0.12);
  color: var(--cs-primary, #1f4d3a);
  font-size: 11px; line-height: 1.6; cursor: pointer;
  max-width: 100%;
}
.focus-chip:hover { background: rgba(var(--cs-primary-rgb, 31, 77, 58), 0.2); }
.focus-chip-icon { font-size: 11px; }
.focus-chip-path { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 10px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
.focus-chip-x { border: none; background: transparent; color: inherit; cursor: pointer; padding: 0 4px; border-radius: 8px; font-size: 11px; line-height: 1; opacity: 0.55; transition: opacity 0.15s, background 0.15s; }
.focus-chip-x:hover { opacity: 1; background: rgba(var(--cs-err-rgb, 220, 38, 38), 0.15); color: var(--cs-err, #dc2626); }
.chat-input.has-focus-chip { padding-top: 30px; }
.chat-input {
  width: 100%; resize: vertical; border: 1px solid var(--cs-input-border, rgba(var(--cs-primary-rgb, 31, 77, 58), 0.2)); border-radius: var(--cs-input-radius, 8px);
  padding: 9px 12px 38px 12px; font-size: 13px; font-family: inherit; line-height: 1.5; color: var(--cs-bg-text, inherit);
  background: var(--cs-input-bg, transparent); outline: none; transition: border-color 0.2s; min-height: 38px; max-height: 50vh; overflow-y: auto;
  overflow-wrap: anywhere; word-break: break-word;
}
.chat-input::placeholder { color: var(--cs-bg-muted, #9ca3af); opacity: 0.7; }
.chat-input:focus { border-color: var(--cs-primary); box-shadow: 0 0 0 2px rgba(var(--cs-primary-rgb), 0.1); }
.input-actions { position: absolute; bottom: 10px; right: 10px; display: flex; align-items: center; gap: 8px; }
.send-hint { font-size: 10px; color: var(--cs-bg-muted, #9ca3af); opacity: 0.6; pointer-events: none; white-space: nowrap; }
.send-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border: none; border-radius: var(--cs-send-radius, 50%);
  background: var(--cs-send-grad, var(--cs-primary)); color: #fff; cursor: pointer;
  transition: opacity 0.2s, transform 0.1s; flex-shrink: 0;
}
.send-btn:hover:not(:disabled) { opacity: 0.9; transform: scale(1.05); }
.send-btn:active:not(:disabled) { transform: scale(0.95); }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.send-btn.stop-btn { background: #9ca3af; }
.send-btn.stop-btn:hover:not(:disabled) { background: #6b7280; transform: none; }

.undo-foot-btn { flex-shrink: 0; align-self: center; padding: 4px 10px; border: 1px solid var(--cs-surface-border, #e5e7eb); border-radius: 14px; background: var(--cs-surface, #f9fafb); color: var(--cs-bg-muted, #6b7280); font-size: 11px; cursor: pointer; transition: all 0.2s; }
.undo-foot-btn:hover { border-color: var(--cs-primary); color: var(--cs-primary); background: #f0f7f3; }
</style>
