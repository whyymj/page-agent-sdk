<script setup lang="ts">
/**
 * 页面渲染器 —— 顶层遍历 page.components,每个组件交给 CompRenderer 递归渲染
 *
 * window.page 由 App.vue 顶层 reactive 创建并挂载,此处取引用;
 * Agent 经 write 就地改 page 属性(含容器 children 嵌套),响应式触发。
 *
 * 两步拾取(focus-context):点组件本体 → emit('select') → 父 selectedPath(浮层显示边框 + 加入聊天按钮);
 * 点「💬 加入聊天」按钮 → emit('focus') → 父调 sdk.setFocus 聚焦该组件精修。
 * 事件委托 closest('[data-path']) 命中即触发(适配递归 CompRenderer 的任意层级 data-path)。
 */
import { reactive, computed, ref } from 'vue'
import type { PageData } from './pageSchema'
import CompRenderer from './CompRenderer.vue'
import PickOverlay from '../_shared/PickOverlay.vue'

const w = window as any
if (!w.page) {
  w.page = reactive({ title: '', components: [] })
}
const page = w.page as PageData

/** 渲染截断阈值:组件数超此只渲染前 N(大页面避免浏览器卡死;agent 经 read/write 操作全量数据,不受渲染限制) */
const RENDER_LIMIT = 100
const truncated = computed(() => page.components.length > RENDER_LIMIT)
const renderedComponents = computed(() => (truncated.value ? page.components.slice(0, RENDER_LIMIT) : page.components))

defineProps<{ selectedPath?: string | null }>()
const emit = defineEmits<{
  (e: 'select', path: string): void
  (e: 'focus', path: string): void
}>()

// bodyRef:PickOverlay 搜索 [data-path] 的根容器
const bodyRef = ref<HTMLElement>()
function onBodyClick(e: MouseEvent) {
  const el = (e.target as HTMLElement)?.closest?.('[data-path]') as HTMLElement | null
  const p = el?.getAttribute('data-path')
  if (p) emit('select', p)
}
</script>

<template>
  <div class="pr">
    <h1 class="pr-title">{{ page.title }}</h1>
    <div v-if="truncated" class="pr-truncate">
      ⚠️ 大页面({{ page.components.length }} 组件):仅渲染前 {{ RENDER_LIMIT }} 个预览防卡死;agent 经 read/write 可操作全部 {{ page.components.length }} 个组件。
    </div>
    <div ref="bodyRef" class="pr-body" @click="onBodyClick">
      <CompRenderer
        v-for="(c, i) in renderedComponents"
        :key="(c.id ?? c.type) + '-' + i"
        :comp="c"
        :path="`components.${i}`"
      />
    </div>
    <!-- 两步拾取浮层:选中态边框 + 「💬 加入聊天」按钮(点按钮才聚焦) -->
    <PickOverlay :selected-path="selectedPath ?? null" :container="bodyRef ?? null" @focus="emit('focus', $event)" />
  </div>
</template>

<style scoped>
.pr {
  font-family: system-ui, -apple-system, sans-serif;
  max-width: 820px;
  margin: 0 auto;
  padding: 24px;
  border-radius: 10px;
  min-height: calc(100vh - 48px);
  background: #fff;
  color: #1a1a1a;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}
.pr-title {
  font-size: 22px;
  font-weight: 700;
  border-bottom: 1px dashed #d1d5db;
  padding-bottom: 10px;
  margin-bottom: 16px;
}
</style>
