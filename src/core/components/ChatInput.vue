<script setup lang="ts">
/**
 * 输入区域(chat-footer):textarea + 发送/停止按钮 + 回退(checkpoint 开启时)+ 图片输入(image-input-vision)。
 * inputText 绑 ctx.inputText(同一 ref,QueuedBar「修改」也写它);send/keydown 走 ctx;
 * loading/stop 走 ctx.chat;canUndo/undo 走 ctx;placeholder/inputRows 走 props(展示配置)。
 * 图片三入口:📎 按钮(file input)+ 拖拽(dragover/drop)+ 粘贴(paste clipboardData)→ ctx.addImageFiles 压缩闸。
 */
import { ref } from 'vue'
import IconGlyph from './IconGlyph.vue'
import { useChatContext } from '../composables/chatContext'

defineProps<{ placeholder: string; inputRows: number }>()

const ctx = useChatContext()
const { inputText, send, keydown, canUndo, undo, focuses, removeFocus, focusChipClick, icons, messages: m } = ctx
const { state, stop } = ctx.chat
const { pendingImages, addImageFiles, removePendingImage, imageInputError, compressingImages } = ctx

const fileInput = ref<HTMLInputElement | null>(null)
const dragOver = ref(false)

const openFilePicker = (): void => fileInput.value?.click()
const onFileChange = (e: Event): void => {
  const files = (e.target as HTMLInputElement).files
  if (files?.length) void addImageFiles(files)
  ;(e.target as HTMLInputElement).value = '' // 清选择:同名文件可重复添加
}
const onDrop = (e: DragEvent): void => {
  dragOver.value = false
  const files = e.dataTransfer?.files
  if (files?.length) void addImageFiles(files)
}
const onPaste = (e: ClipboardEvent): void => {
  const items = e.clipboardData?.items
  if (!items) return
  const files: File[] = []
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile()
      if (f) files.push(f)
    }
  }
  if (files.length) void addImageFiles(files) // 图片粘贴不进 textarea(不触发默认文本插入行为即可,这里只加图)
}
</script>

<template>
  <div class="chat-footer">
    <button v-if="canUndo" class="undo-foot-btn" :title="m.undoTitle" @click="undo">{{ m.undo }}</button>
    <div
      class="chat-input-wrap"
      :class="{ 'drag-over': dragOver }"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="onDrop"
    >
      <!-- 拖拽提示浮层 -->
      <div v-if="dragOver" class="drop-hint">{{ m.imageDropHint }}</div>
      <!-- chip 区(流式布局,输入容器内顶部:聚焦标签 + 待发送图片 + 输入错误纵向堆叠,永不遮挡输入文字) -->
      <div v-if="focuses.length || pendingImages.length || imageInputError" class="chip-stack">
        <!-- 聚焦标签(inline chip):聚焦组件精修时显示多 chip(🎯 path,multi-focus)。
             chip 本体点击 → 回调(滚动/高亮组件);✕ 移除单个焦点(全移除=退出精修) -->
        <div v-if="focuses.length" class="focus-chips">
          <span
            v-for="f in focuses"
            :key="f.path"
            class="focus-chip"
            :title="m.focusChipTitlePrefix + f.path + m.focusChipTitleHint"
            @click="focusChipClick(f)"
          >
            <span class="focus-chip-icon"><IconGlyph :icon="icons.focus" /></span><code class="focus-chip-path">{{ f.path }}</code>
            <button type="button" class="focus-chip-x" data-test="focus-clear" :title="m.removeFocus" @click.stop="removeFocus(f.path)">✕</button>
          </span>
        </div>
        <!-- 待发送图片 chip(image-input-vision):缩略图 + ✕;随下一条消息发出 -->
        <div v-if="pendingImages.length" class="img-chips" data-test="img-chips">
          <span v-for="im in pendingImages" :key="im.id" class="img-chip" :title="im.name || m.imageAlt">
            <img class="img-chip-thumb" :src="im.dataUri" :alt="im.name || m.imageAlt" />
            <button type="button" class="img-chip-x" data-test="img-chip-x" @click="removePendingImage(im.id)">✕</button>
          </span>
        </div>
        <!-- 输入侧图片错误(超限/损坏;4s 自动清) -->
        <div v-if="imageInputError" class="img-error" data-test="img-error">{{ imageInputError }}</div>
      </div>
      <textarea
        v-model="inputText"
        class="chat-input"
        :placeholder="placeholder"
        :rows="inputRows"
        @keydown="keydown"
        @paste="onPaste"
      ></textarea>
      <div class="input-actions">
        <span class="send-hint">{{ m.sendHint }}</span>
        <!-- 添加图片(📎):image-input-vision 三入口之一 -->
        <button
          class="attach-btn"
          :title="m.attachImageTitle"
          data-test="attach-btn"
          @click="openFilePicker"
        >
          <IconGlyph v-if="icons.attachImage" :icon="icons.attachImage" />
          <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
          </svg>
        </button>
        <input ref="fileInput" type="file" accept="image/*" multiple hidden data-test="attach-input" @change="onFileChange" />
        <button
          class="send-btn"
          :class="{ 'stop-btn': state.loading }"
          :disabled="!state.loading && !inputText.trim() && !pendingImages.length && !compressingImages"
          :title="state.loading ? m.stopTitle : m.sendTitle"
          @click="state.loading ? stop() : send()"
        >
          <svg v-if="state.loading" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2"></rect>
          </svg>
          <!-- 自定义发送图标(dialog.icons.send;loading 停止方块恒内置) -->
          <IconGlyph v-else-if="icons.send" :icon="icons.send" />
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
.chat-input-wrap {
  flex: 1; position: relative; min-width: 0;
  /* 边框上移到容器(芯片 + 输入区一体):聚焦/图片/错误行流式排布在输入区内顶部,不再绝对定位盖住文字 */
  border: 1px solid var(--cs-input-border, rgba(var(--cs-primary-rgb, 31, 77, 58), 0.2));
  border-radius: var(--cs-input-radius, 8px);
  background: var(--cs-input-bg, transparent);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.chat-input-wrap:focus-within { border-color: var(--cs-primary); box-shadow: 0 0 0 2px rgba(var(--cs-primary-rgb), 0.1); }
.chat-input-wrap.drag-over::after {
  content: ''; position: absolute; inset: -3px; border: 2px dashed var(--cs-primary, #1f4d3a); border-radius: 10px;
  pointer-events: none; z-index: 2;
}
.drop-hint {
  position: absolute; top: 8px; left: 0; right: 0; z-index: 3; text-align: center;
  font-size: 11px; color: var(--cs-primary, #1f4d3a); pointer-events: none;
}
/* chip 区:容器内顶部流式堆叠(聚焦 → 图片 → 错误);自然撑高容器,输入文字永不被遮 */
.chip-stack { display: flex; flex-direction: column; gap: 6px; padding: 8px 8px 0; }
.focus-chips { display: flex; flex-wrap: wrap; gap: 4px; }
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
/* 待发送图片 chip(image-input-vision):缩略图行(流式,随容器撑高;✕ 悬浮右上角) */
.img-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.img-chip { position: relative; width: 44px; height: 44px; border-radius: 8px; overflow: visible; flex-shrink: 0; }
.img-chip-thumb { width: 100%; height: 100%; object-fit: cover; border-radius: 8px; border: 1px solid var(--cs-surface-border, rgba(0,0,0,0.08)); display: block; }
.img-chip-x {
  position: absolute; top: -6px; right: -6px; width: 16px; height: 16px; border-radius: 50%;
  border: none; background: var(--cs-err, #dc2626); color: #fff; font-size: 10px; line-height: 1;
  cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;
}
.img-chip-x:hover { opacity: 0.85; }
.img-error { font-size: 11px; color: var(--cs-err, #dc2626); line-height: 1.4; }
.chat-input {
  display: block; width: 100%; border: none; outline: none; background: transparent; resize: vertical;
  padding: 9px 12px 38px 12px; font-size: 13px; font-family: inherit; line-height: 1.5; color: var(--cs-bg-text, inherit);
  min-height: 38px; max-height: 50vh; overflow-y: auto;
  overflow-wrap: anywhere; word-break: break-word;
}
.chat-input::placeholder { color: var(--cs-bg-muted, #9ca3af); opacity: 0.7; }
.input-actions { position: absolute; bottom: 10px; right:  10px; display: flex; align-items: center; gap: 8px; }
.send-hint { font-size: 10px; color: var(--cs-bg-muted, #9ca3af); opacity: 0.6; pointer-events: none; white-space: nowrap; }
.attach-btn {
  display: flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; border: none; border-radius: 6px;
  background: transparent; color: var(--cs-bg-muted, #6b7280); cursor: pointer;
  transition: color 0.15s, background 0.15s; flex-shrink: 0;
}
.attach-btn:hover { color: var(--cs-primary, #1f4d3a); background: rgba(var(--cs-primary-rgb, 31, 77, 58), 0.08); }
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
