<script setup lang="ts">
defineProps<{ copied: boolean }>()
defineEmits<{ (e: 'copy'): void; (e: 'regenerate'): void }>()
</script>

<template>
  <!-- 默认隐藏;hover MessageRow(.message-row.assistant)时由 MessageRow 侧 :deep(.msg-actions) 提到 opacity:1 -->
  <div class="msg-actions">
    <button class="msg-action-btn" :class="{ done: copied }" :title="copied ? '已复制' : '复制'" @click="$emit('copy')">
      <!-- 复制态换对勾图标 + ok 色(主题变量,与步骤状态色一致);两按钮统一 icon+文字,不用 emoji -->
      <svg v-if="copied" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
      <svg v-else viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3" /><path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H3.5A1.5 1.5 0 0 0 2 3v5.5A1.5 1.5 0 0 0 3.5 10H4" stroke="currentColor" stroke-width="1.3" /></svg>
      <span>{{ copied ? '已复制' : '复制' }}</span>
    </button>
    <button class="msg-action-btn" title="重新生成" @click="$emit('regenerate')">
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" /><path d="M13.7 1.8v2.8h-2.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg>
      <span>重新生成</span>
    </button>
  </div>
</template>

<style scoped>
.msg-actions { display: flex; gap: 6px; margin-top: 4px; opacity: 0; transition: opacity 0.2s; }
/* 主题变量与 MessageSteps 同源(--cs-step-* 双主题适配);原硬编码浅色在深色主题下呈白块,与整体风格不搭 */
.msg-action-btn { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border: 1px solid var(--cs-step-border, #e2e6ea); border-radius: 6px; background: var(--cs-step-bg, #f4f6f8); color: var(--cs-step-meta, #9ca3af); font-size: 11px; line-height: 1.6; cursor: pointer; transition: all 0.2s; }
.msg-action-btn svg { width: 12px; height: 12px; flex-shrink: 0; }
.msg-action-btn:hover { border-color: var(--cs-primary); color: var(--cs-primary); background: rgba(var(--cs-primary-rgb, 31, 77, 58), 0.08); }
.msg-action-btn.done { border-color: var(--cs-ok); color: var(--cs-ok); background: rgba(var(--cs-ok-rgb, 22, 163, 74), 0.1); cursor: default; }
</style>
