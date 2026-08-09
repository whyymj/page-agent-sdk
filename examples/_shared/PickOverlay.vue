<script setup lang="ts">
/**
 * 拾取浮层 —— 两步拾取交互的第 2 步视觉:点选组件后,在其上浮一个边框 + 「💬 加入聊天」按钮。
 *
 * 定位策略:getBoundingClientRect + position:fixed + Teleport(body),
 * 完全不侵入组件树 —— 适配 complex-demo 的递归 CompRenderer(容器嵌套,包 wrapper 会破坏布局)
 * 与 page-demo 的扁平 v-if 分发 alike。边框本体 pointer-events:none(点击穿透回组件,可切换选中),
 * 仅「加入聊天」按钮 pointer-events:auto(点它才触发 focus)。
 *
 * 与 PageRenderer 配合:PageRenderer 事件委托 closest('[data-path]') → emit('select') →
 * 父组件(selectedPath ref)变化传入本浮层 → querySelector 定位 → 显示边框 + 按钮。
 *
 * 性能:scroll(capture,含所有滚动容器)/resize 经 requestAnimationFrame 合并到下一动画帧,
 * 避免高频 querySelector + getBoundingClientRect(强制重排)致滚动卡顿(complex-demo 100 组件场景)。
 */
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'

const props = defineProps<{
  /** 当前选中组件的 data-path(null = 无选中,隐藏浮层) */
  selectedPath: string | null
  /** 搜索 [data-path] 的根容器(PageRenderer 的 bodyRef) */
  container: HTMLElement | null
}>()
const emit = defineEmits<{ (e: 'focus', path: string): void }>()

/** 选中元素的视口坐标(null = 隐藏浮层) */
const box = ref<{ top: number; left: number; width: number; height: number } | null>(null)

/** 按 selectedPath 在 container 内查元素 → 读 getBoundingClientRect → 更新浮层位置 */
function refresh(): void {
  if (!props.selectedPath || !props.container) { box.value = null; return }
  // data-path 值(如 components.0)无 CSS 选择器特殊字符,attribute selector 安全;仅转义引号防注入
  const sel = `[data-path="${props.selectedPath.replace(/"/g, '\\"')}"]`
  const el = props.container.querySelector(sel) as HTMLElement | null
  if (!el) { box.value = null; return }
  const r = el.getBoundingClientRect()
  // 隐藏元素(visible:false 或 display:none)位置归零,不显示浮层
  if (r.width === 0 && r.height === 0) { box.value = null; return }
  box.value = { top: r.top, left: r.left, width: r.width, height: r.height }
}

// rAF 节流:scroll(capture,所有滚动容器)/resize 高频触发,合并到下一动画帧(避免每帧重排卡顿)
let raf = 0
function scheduleRefresh(): void {
  if (raf) return
  raf = requestAnimationFrame(() => { raf = 0; refresh() })
}

// selectedPath / container 变化 → nextTick 后重新定位(等 DOM 更新完)
watch(() => props.selectedPath, () => nextTick(refresh))
watch(() => props.container, () => nextTick(refresh))

// 按钮视口感知翻转:选中元素贴近视口顶部时(navbar 等),按钮翻到下沿避免被 pane 边界裁剪
const btnBelow = computed(() => (box.value ? box.value.top < 24 : false))

function onFocusClick(): void {
  if (props.selectedPath) emit('focus', props.selectedPath)
}

onMounted(() => {
  // capture:监听所有滚动容器(pane-left overflow:auto 的内部滚动也触发),经 rAF 合并后跟随
  window.addEventListener('scroll', scheduleRefresh, true)
  window.addEventListener('resize', scheduleRefresh)
  nextTick(refresh)
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', scheduleRefresh, true)
  window.removeEventListener('resize', scheduleRefresh)
  if (raf) cancelAnimationFrame(raf)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="box && selectedPath"
      class="pick-overlay"
      :style="{ top: box.top + 'px', left: box.left + 'px', width: box.width + 'px', height: box.height + 'px' }"
    >
      <button
        type="button"
        class="pick-overlay__btn"
        :class="{ 'pick-overlay__btn--below': btnBelow }"
        title="聚焦此组件精修"
        @click.stop="onFocusClick"
      >
        💬 加入聊天
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
/* fixed + 视口坐标(getBoundingClientRect):不受滚动容器影响,滚动时由 refresh 重算位置跟随 */
.pick-overlay {
  position: fixed;
  pointer-events: none; /* 边框本体穿透:点击落回组件,可切换选中目标 */
  border: 2px solid var(--cs-primary, #6366f1);
  border-radius: 6px;
  box-sizing: border-box;
  z-index: 999; /* 高于 demo 内容,低于 chat-dialog(避免盖对话框) */
  transition: opacity 0.12s ease;
}
.pick-overlay__btn {
  position: absolute;
  top: -13px; /* 默认浮在边框上沿外侧(下沿略压入边框) */
  right: 6px;
  pointer-events: auto; /* 仅按钮可点(覆盖父的 none) */
  background: var(--cs-primary, #6366f1);
  color: #fff;
  border: none;
  border-radius: 12px;
  padding: 3px 12px;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  transition: filter 0.15s;
}
/* 选中元素贴近视口顶部(如 components.0 navbar):按钮翻到下沿,避免被 pane 边界裁剪 */
.pick-overlay__btn--below { top: auto; bottom: -13px; }
.pick-overlay__btn:hover { filter: brightness(1.12); }
.pick-overlay__btn:active { filter: brightness(0.95); }
</style>
