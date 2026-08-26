<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{ text: string; expanded: boolean; running?: boolean; total?: number }>(), { running: false, total: undefined })
defineEmits<{ (e: 'toggle'): void }>()

// 字数展示:优先总量 total(渲染文本被尾部滑窗截断,长度恒 ≤ cap 会冻结计数;总量随流照涨);
// 旧消息无 total → 回退文本长度。≥1000 自动换 k 单位(4200→4.2k、1000→1k、≥10万取整 123k)
const countLabel = computed(() => {
  const n = props.total ?? props.text.length
  if (n < 1000) return String(n)
  const v = n / 1000
  return `${v >= 100 ? Math.round(v) : +v.toFixed(1)}k`
})
</script>

<template>
  <div v-if="text" class="reasoning-block" :class="{ expanded }">
    <div class="reasoning-header" @click="$emit('toggle')">
      <!-- 思考中(生成中)绿点呼吸,完成后静止 -->
      <span class="status-dot ok" :class="{ breathe: running }"></span>
      <span class="reasoning-title">思考过程</span>
      <span class="reasoning-count">{{ countLabel }} 字</span>
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
/* 思考中绿点呼吸(生成中活跃指示;完成静止) */
.status-dot.breathe { animation: cs-reason-breathe 1.2s ease-in-out infinite; }
@keyframes cs-reason-breathe { 0%, 100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1); } }
</style>
