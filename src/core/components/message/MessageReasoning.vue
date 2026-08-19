<script setup lang="ts">
defineProps<{ text: string; expanded: boolean }>()
defineEmits<{ (e: 'toggle'): void }>()
</script>

<template>
  <div v-if="text" class="reasoning-block" :class="{ expanded }">
    <div class="reasoning-header" @click="$emit('toggle')">
      <span class="status-dot ok"></span>
      <span class="reasoning-title">思考过程</span>
      <!-- 折叠态也给出内容量反馈(用户诉求:不展开看不到任何反应);点击 header 不选中计数 -->
      <span class="reasoning-count">{{ text.length }} 字</span>
      <span class="reasoning-toggle">{{ expanded ? '收起' : '展开' }}</span>
    </div>
    <div v-if="expanded" class="reasoning-body">{{ text }}</div>
  </div>
</template>

<style scoped>
.reasoning-block { margin-bottom: 6px; border: 1px solid var(--cs-reason-border); border-radius: 8px; overflow: hidden; background: var(--cs-reason-bg); }
.reasoning-header { display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer; user-select: none; font-size: 12px; color: var(--cs-reason-head); }
.reasoning-title { font-weight: 600; }
.reasoning-count { font-size: 11px; color: var(--cs-step-meta); font-family: 'SF Mono', Monaco, Consolas, monospace; }
.reasoning-toggle { margin-left: auto; font-size: 12px; color: var(--cs-reason-toggle); }
/* 宿主页面常全局 user-select:none(如编辑器),正文显式开选中保证可复制 */
.reasoning-body { padding: 8px 10px; border-top: 1px solid var(--cs-reason-border); font-size: 12px; line-height: 1.6; color: var(--cs-reason-text); white-space: pre-wrap; word-break: break-word; max-height: 300px; overflow-y: auto; user-select: text; -webkit-user-select: text; }
/* 状态色块(reasoning 头部用 ok 绿点;.status-dot base 各组件 scoped 各自维护,不跨边界共享) */
.status-dot { width: 8px; height: 8px; border-radius: 3px; flex-shrink: 0; background: var(--cs-step-meta); }
.status-dot.ok { background: var(--cs-ok); }
</style>
