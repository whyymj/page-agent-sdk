<script setup lang="ts">
/**
 * 划词浮动菜单(selectionMenu,page-quote 显式确认形态):用户划选宿主文字 → 选区上方浮出
 * 「❝ 引用到对话」工具条 → 点击 = 挂引用 chip + 打开对话框(经 ChatDialog onSelectionQuote 回调)。
 *
 * 与 autoQuote(静默懒捕获)独立可组合:本组件是显式确认交互(划词翻译同款),宿主二选一或并用。
 * 细节:
 *  - window 捕获 pointerup → 微任务读选区(mouseup 后选区定格;captureSelectionQuote 无效选区返 null 不打扰);
 *    浮条自身的 pointerup 不触发重定位(防「点按钮 → 菜单复活」)
 *  - 消失:点别处 / Esc / 选区失效 / **选区滚出视口**;按钮 @mousedown.prevent 保住选区(click 时若需重读仍有值)
 *  - 滚动:**跟随重定位**(rAF 节流)而非一律隐藏 —— 修前「滚动即隐藏」在宿主站开启 CSS `scroll-behavior: smooth`
 *    时是灾难:平滑滚动的惯性尾巴持续数百 ms 触发 scroll,划选后刚出现的菜单立刻被关掉(实测:
 *    滚动静止时划选 5/5 可用,平滑滚动尾巴期 0/5)。现滚动只重算位置;选区与视口无交集才隐藏(滚走了=看不见了)
 *  - 定位 computeSelectionMenuPosition 纯函数(上方优先,顶部不够翻下方,两轴钳制视口内 —— 超长选区也可见)
 *  - 根 class .chat-selection-menu 已进 SDK_UI_SELECTOR(read_page 排除 + 捕获判定视为 SDK 内部)
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useChatContext } from '../composables/chatContext'
import { captureSelectionQuote, computeSelectionMenuPosition } from '../tools/quoteInput'
import type { MessageQuote } from '../types'

const emit = defineEmits<{ (e: 'quote', q: MessageQuote): void }>()
const { messages: m } = useChatContext()

const visible = ref(false)
const pos = ref<{ top: number; left: number }>({ top: 0, left: 0 })
/** 浮条尺寸估算(定位钳制用;与 CSS 宽高对齐) */
const MENU_SIZE = { w: 128, h: 30 }
/** 展示时的引用候选(click 时消费;选区变了菜单已隐藏,不会错配 */
let pendingQuote: MessageQuote | null = null

const hide = (): void => {
  visible.value = false
  pendingQuote = null
}

/** 读当前选区矩形(无效/塌缩/零尺寸 → null) */
const readSelectionRect = (): DOMRect | null => {
  if (typeof document === 'undefined') return null
  const sel = document.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  if (!rect || (!rect.width && !rect.height)) return null
  return rect
}

/** 选区与视口是否有交集(滚出视口 = 用户看不见选区 → 菜单也该消失) */
const intersectsViewport = (rect: DOMRect): boolean =>
  rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth

/**
 * 按当前选区重算菜单位置(不改 pendingQuote —— 滚动只挪位置,引用内容不变)。
 * requireVisible:滚动场景传 true —— 选区与视口无交集(滚走了)才隐藏;pointerup 场景不传(刚划完必可见,
 * 保持原语义:程序化选区(测试/宿主脚本)即使落在视口外也照常显示)。
 */
const reposition = (opts: { requireVisible?: boolean } = {}): void => {
  const rect = readSelectionRect()
  if (!rect) { hide(); return }
  if (opts.requireVisible && !intersectsViewport(rect)) { hide(); return }
  pos.value = computeSelectionMenuPosition(
    { top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width },
    { w: window.innerWidth, h: window.innerHeight },
    MENU_SIZE,
  )
}

const onPointerUp = (e: PointerEvent): void => {
  // 浮条自身的 pointerup(点按钮)不触发重定位
  if ((e.target as Element | null)?.closest?.('.chat-selection-menu')) return
  // 微任务:mouseup 后选区才定格;直接读会拿到上一帧状态
  setTimeout(() => {
    if (typeof document === 'undefined') return
    const sel = document.getSelection()
    const q = captureSelectionQuote(document)
    if (!sel || !q || sel.rangeCount === 0) { hide(); return }
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    if (!rect || (!rect.width && !rect.height)) { hide(); return }
    pendingQuote = q
    visible.value = true
    reposition()
  }, 0)
}

const onPointerDown = (e: PointerEvent): void => {
  if (visible.value && !(e.target as Element | null)?.closest?.('.chat-selection-menu')) hide()
}
/** 滚动:跟随重定位(rAF 节流;选区滚出视口才隐藏)—— 兼容宿主站 scroll-behavior: smooth 的滚动惯性尾巴 */
let scrollRaf = 0
const onScroll = (): void => {
  if (!visible.value || scrollRaf) return
  scrollRaf = window.requestAnimationFrame(() => {
    scrollRaf = 0
    if (visible.value) reposition({ requireVisible: true })
  })
}
const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && visible.value) hide() }

onMounted(() => {
  window.addEventListener('pointerup', onPointerUp, true)
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('scroll', onScroll, { capture: true, passive: true })
  window.addEventListener('keydown', onKey, true)
})
onBeforeUnmount(() => {
  if (scrollRaf) window.cancelAnimationFrame(scrollRaf) // 挂起的 rAF 也要取消(卸载后回调里读 visible/窗口尺寸无意义)
  window.removeEventListener('pointerup', onPointerUp, true)
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions)
  window.removeEventListener('keydown', onKey, true)
})

const applyQuote = (): void => {
  if (pendingQuote) emit('quote', pendingQuote)
  hide()
}
</script>

<template>
  <Teleport to="body">
    <div v-show="visible" class="chat-selection-menu" data-test="selection-menu" :style="{ top: `${pos.top}px`, left: `${pos.left}px` }">
      <button type="button" class="chat-selection-menu-btn" data-test="selection-menu-quote" :title="m.selectionMenuTitle" @mousedown.prevent @click="applyQuote">❝ {{ m.selectionMenuLabel }}</button>
    </div>
  </Teleport>
</template>

<style scoped>
/* 浮动工具条:宿主页面之上的轻浮层(自包含配色不依赖对话框主题变量);fixed 定位由 JS 注入 top/left */
.chat-selection-menu { position: fixed; z-index: 2147483000; }
.chat-selection-menu-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 12px; border-radius: 999px; border: 1px solid rgba(0, 0, 0, 0.12);
  background: #fff; color: #1f2937; font-size: 12.5px; line-height: 1; cursor: pointer;
  box-shadow: 0 3px 12px rgba(0, 0, 0, 0.16); white-space: nowrap;
}
.chat-selection-menu-btn:hover { background: #f3f4f6; }
</style>
