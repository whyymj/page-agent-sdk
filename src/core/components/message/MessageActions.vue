<script setup lang="ts">
defineProps<{ copied: boolean }>()
defineEmits<{ (e: 'copy'): void; (e: 'regenerate'): void }>()
</script>

<template>
  <!-- 默认隐藏;hover MessageRow(.message-row.assistant)时由 MessageRow 侧 :deep(.msg-actions) 提到 opacity:1 -->
  <div class="msg-actions">
    <button class="msg-action-btn" :title="copied ? '已复制' : '复制'" @click="$emit('copy')">{{ copied ? '✓ 已复制' : '📋 复制' }}</button>
    <button class="msg-action-btn" title="重新生成" @click="$emit('regenerate')">🔄 重新生成</button>
  </div>
</template>

<style scoped>
.msg-actions { display: flex; gap: 6px; margin-top: 4px; opacity: 0; transition: opacity 0.2s; }
.msg-action-btn { padding: 2px 8px; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; color: #6b7280; font-size: 11px; cursor: pointer; transition: all 0.2s; }
.msg-action-btn:hover { border-color: var(--cs-primary); color: var(--cs-primary); background: #f0f7f3; }
</style>
