<script setup lang="ts">
/**
 * 页面渲染器 —— 顶层遍历 page.components,每个组件交给 CompRenderer 递归渲染
 *
 * window.page 由 App.vue 顶层 reactive 创建并挂载,此处取引用;
 * Agent 经 write 就地改 page 属性(含容器 children 嵌套),响应式触发。
 *
 * 交互:
 *  - 两步拾取(focus-context):点组件本体 → emit('select') → 父 selectedPath(浮层边框 + 加入聊天按钮);
 *    点「💬 加入聊天」按钮 → emit('focus') → 父调 sdk.addFocus 聚焦该组件精修。
 *    事件委托 closest('[data-path]') 命中即触发(适配递归 CompRenderer 的任意层级 data-path)。
 *  - 手动拖拽(手动编辑三件套之 ①②):拖组件到另一组件上沿/下沿 = 调序(同/跨容器均支持);
 *    拖到容器组件中部 = 移入该容器(props.children 末尾)。落点指示:上/下插入线 + 容器内落高亮。
 *    委托实现:dragstart/dragover/drop 冒泡到 .pr-body 统一处理;stopPropagation 让嵌套时内层组件优先。
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
  (e: 'move', payload: { from: string; to: string; position: 'before' | 'after' | 'inside' }): void
}>()

// bodyRef:PickOverlay 搜索 [data-path] 的根容器
const bodyRef = ref<HTMLElement>()
function onBodyClick(e: MouseEvent) {
  const el = (e.target as HTMLElement)?.closest?.('[data-path]') as HTMLElement | null
  const p = el?.getAttribute('data-path')
  if (p) emit('select', p)
}

// ===== 手动拖拽(事件委托;data-path 由 CompRenderer/容器组件逐层透传,嵌套子组件可拖)=====
type DropPos = 'before' | 'after' | 'inside'
const dragPath = ref<string | null>(null)
const dropHint = ref<{ path: string; position: DropPos } | null>(null)
/** 落点指示的 DOM 类管理(命令式:插入线/容器高亮) */
let markedEl: HTMLElement | null = null
function clearMark() {
  if (markedEl) { markedEl.classList.remove('dnd-before', 'dnd-after', 'dnd-inside'); markedEl = null }
}
function pathOf(target: EventTarget | null): string | null {
  const el = (target as HTMLElement)?.closest?.('[data-path]') as HTMLElement | null
  return el?.getAttribute('data-path') ?? null
}
/** 路径是否解析到「容器组件」(props.children 为数组;inside 落点仅对容器开放) */
function isContainerPath(path: string): boolean {
  const node = path.split('.').reduce<unknown>((o, k) => (o == null || typeof o !== 'object' ? undefined : (o as Record<string, unknown>)[k]), w.page)
  return Array.isArray((node as Record<string, any> | null)?.props?.children)
}
function onDragStart(e: DragEvent) {
  const p = pathOf(e.target)
  if (!p) return
  dragPath.value = p
  if (e.dataTransfer) {
    e.dataTransfer.setData('text/plain', p) // 兜底载荷
    e.dataTransfer.effectAllowed = 'move'
  }
}
function onDragOver(e: DragEvent) {
  if (!dragPath.value) return
  const el = (e.target as HTMLElement)?.closest?.('[data-path]') as HTMLElement | null
  const p = el?.getAttribute('data-path') ?? null
  if (!p || p === dragPath.value || p.startsWith(dragPath.value + '.')) { dropHint.value = null; clearMark(); return }
  e.preventDefault() // 允许 drop
  e.stopPropagation() // 嵌套组件:内层优先,不冒泡到外层容器
  const rect = el!.getBoundingClientRect()
  const y = (e.clientY - rect.top) / rect.height
  const inside = y > 0.28 && y < 0.72 && isContainerPath(p)
  dropHint.value = { path: p, position: inside ? 'inside' : y <= 0.5 ? 'before' : 'after' }
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  clearMark()
  markedEl = el!
  markedEl.classList.add(inside ? 'dnd-inside' : dropHint.value.position === 'before' ? 'dnd-before' : 'dnd-after')
}
function onDrop(e: DragEvent) {
  e.preventDefault()
  e.stopPropagation()
  const hint = dropHint.value
  const from = dragPath.value
  clearMark()
  dragPath.value = null
  dropHint.value = null
  if (from && hint && hint.path !== from && !hint.path.startsWith(from + '.')) {
    emit('move', { from, to: hint.path, position: hint.position })
  }
}
function onDragEnd() { clearMark(); dragPath.value = null; dropHint.value = null }
</script>

<template>
  <div class="pr">
    <h1 class="pr-title">{{ page.title }}</h1>
    <div v-if="truncated" class="pr-truncate">
      ⚠️ 大页面({{ page.components.length }} 组件):仅渲染前 {{ RENDER_LIMIT }} 个预览防卡死;agent 经 read/write 可操作全部 {{ page.components.length }} 个组件。
    </div>
    <div class="pr-hint">🖱 点击组件选中编辑属性 · 拖拽到组件上/下沿调序、拖到容器中部移入</div>
    <div ref="bodyRef" class="pr-body" @click="onBodyClick" @dragstart="onDragStart" @dragover="onDragOver" @drop="onDrop" @dragend="onDragEnd">
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
  margin-bottom: 10px;
}
.pr-hint {
  font-size: 11px;
  color: #9ca3af;
  margin-bottom: 14px;
}
</style>

<style>
/* 拖拽落点指示(全局:目标元素由 CompRenderer 各自渲染,命令式加类) */
[data-path].dnd-before { outline: 2px dashed #2563eb; outline-offset: -2px; box-shadow: 0 -3px 0 0 #2563eb !important; }
[data-path].dnd-after { outline: 2px dashed #2563eb; outline-offset: -2px; box-shadow: 0 3px 0 0 #2563eb !important; }
[data-path].dnd-inside { outline: 3px solid #059669; outline-offset: -3px; background: rgba(5, 150, 105, 0.06) !important; }
</style>
