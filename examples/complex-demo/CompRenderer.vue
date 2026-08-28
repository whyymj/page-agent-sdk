<script lang="ts">
/**
 * 模块级共享:custom 组件高度表 + 单次 window 监听。
 * ⚠️ 必须在模块作用域(独立 <script> 块)—— 修前声明在 <script setup> 内 = 每实例一份,
 * 而监听器经 __customCompListener 只注册一次、闭包绑死首个 CompRenderer 实例(页面第一个普通组件),
 * custom 组件发来的高度全部落进无关实例的表 → 渲染实例恒读空表 → iframe 卡 360px 兜底不自适应。
 */
import { reactive } from 'vue'
const customHeights = reactive<Record<string, number>>({})
function _onCustomMsg(e: MessageEvent) {
  const d = e.data as { __customComp?: boolean; key?: string; h?: number } | null
  if (!d || d.__customComp !== true) return
  if (typeof d.key === 'string' && typeof d.h === 'number' && d.h > 0 && d.h < 20000) customHeights[d.key] = d.h
}
if (typeof window !== 'undefined' && !(window as any).__customCompListener) {
  window.addEventListener('message', _onCustomMsg)
  ;(window as any).__customCompListener = true
}
</script>

<script setup lang="ts">
/**
 * 单组件递归渲染器 —— 按 comp.type 分发到业务组件
 *
 * 容器组件(container/section/grid)用 defineAsyncComponent 异步引用,
 * 容器内部再 import 本渲染器渲染 children,打破 A↔B 循环依赖。
 * 叶子组件静态 import;baseProps(id/style/visible/className)单独透传。
 */
import { defineAsyncComponent, computed, reactive, type Component } from 'vue'
import HeadingComp from './components/HeadingComp.vue'
import RichTextComp from './components/RichTextComp.vue'
import ProductGridComp from './components/ProductGridComp.vue'
import ImageComp from './components/ImageComp.vue'
import ButtonComp from './components/ButtonComp.vue'
import ListComp from './components/ListComp.vue'
import CardComp from './components/CardComp.vue'
import SpacerComp from './components/SpacerComp.vue'
import DividerComp from './components/DividerComp.vue'
import CarouselComp from './components/CarouselComp.vue'
import NavbarComp from './components/NavbarComp.vue'
import BannerComp from './components/BannerComp.vue'
import CountdownComp from './components/CountdownComp.vue'
import CouponComp from './components/CouponComp.vue'
import AccordionComp from './components/AccordionComp.vue'
import StatComp from './components/StatComp.vue'
import TimelineComp from './components/TimelineComp.vue'
import FooterComp from './components/FooterComp.vue'
import RatingComp from './components/RatingComp.vue'
import FormComp from './components/FormComp.vue'
import InputComp from './components/InputComp.vue'
import SelectComp from './components/SelectComp.vue'
import StepperComp from './components/StepperComp.vue'
import BreadcrumbComp from './components/BreadcrumbComp.vue'
import VideoComp from './components/VideoComp.vue'
import NoticeBarComp from './components/NoticeBarComp.vue'
import IconComp from './components/IconComp.vue'
import TagComp from './components/TagComp.vue'
import PriceComp from './components/PriceComp.vue'
import BadgeComp from './components/BadgeComp.vue'
import ProgressComp from './components/ProgressComp.vue'
import SkeletonComp from './components/SkeletonComp.vue'

const ContainerComp = defineAsyncComponent(() => import('./components/ContainerComp.vue'))
const SectionComp = defineAsyncComponent(() => import('./components/SectionComp.vue'))
const GridComp = defineAsyncComponent(() => import('./components/GridComp.vue'))
const TabsComp = defineAsyncComponent(() => import('./components/TabsComp.vue'))

const COMP_MAP: Record<string, Component> = {
  heading: HeadingComp,
  richText: RichTextComp,
  productGrid: ProductGridComp,
  image: ImageComp,
  button: ButtonComp,
  list: ListComp,
  card: CardComp,
  spacer: SpacerComp,
  divider: DividerComp,
  carousel: CarouselComp,
  container: ContainerComp,
  section: SectionComp,
  grid: GridComp,
  navbar: NavbarComp,
  banner: BannerComp,
  countdown: CountdownComp,
  coupon: CouponComp,
  tabs: TabsComp,
  accordion: AccordionComp,
  stat: StatComp,
  timeline: TimelineComp,
  footer: FooterComp,
  rating: RatingComp,
  form: FormComp,
  input: InputComp,
  select: SelectComp,
  stepper: StepperComp,
  breadcrumb: BreadcrumbComp,
  video: VideoComp,
  noticeBar: NoticeBarComp,
  icon: IconComp,
  tag: TagComp,
  price: PriceComp,
  badge: BadgeComp,
  progress: ProgressComp,
  skeleton: SkeletonComp,
}

const props = defineProps<{ comp: any; path?: string }>()
/** baseProps 通用渲染:布局字段(margin/padding/width/height/maxWidth/cursor)合并到 style;动画/响应式/主题入 class(经 fallthrough 继承到各专用组件根) */
const compStyle = computed<Record<string, string>>(() => {
  const c = props.comp || {}
  const s: Record<string, string> = { ...(c.style || {}) }
  if (c.margin) s.margin = c.margin
  if (c.padding) s.padding = c.padding
  if (c.width) s.width = c.width
  if (c.height) s.height = c.height
  if (c.maxWidth) s.maxWidth = c.maxWidth
  if (c.cursor) s.cursor = c.cursor
  return s
})
const compClass = computed<string[]>(() => {
  const c = props.comp || {}
  const cls: string[] = []
  if (c.className) cls.push(...String(c.className).split(/\s+/).filter(Boolean))
  if (c.animated && c.animation && c.animation !== 'none') cls.push(`anim-${c.animation}`)
  if (c.hoverEffect && c.hoverEffect !== 'none') cls.push(`hover-${c.hoverEffect}`)
  if (c.hideOnMobile) cls.push('hide-on-mobile')
  if (c.hideOnDesktop) cls.push('hide-on-desktop')
  if (c.theme) cls.push(`theme-${c.theme}`)
  return cls
})

// custom 纯代码组件:iframe srcdoc 渲染(完整自包含 HTML 页面,script/style 可执行;sandbox 隔离)
// 高度自适应:无 allow-same-origin(父读不到 contentDocument)→ srcdoc 注入量高脚本 postMessage 报回 →
// 模块级共享高度表(见上方模块 <script> 块;递归渲染多实例,window 监听单次注册);key 用 path(唯一,容器 children 内亦有)
const SCRIPT_OPEN = '<' + 'script>'   // SFC 转义:源码不连续出现 script 标签(编译器按字符序列匹配闭合)
const SCRIPT_CLOSE = '<' + '/script>'
const customKey = computed(() => props.path || props.comp?.__pgId || props.comp?.name || 'unknown')
const customHeight = computed(() => (customHeights[customKey.value] || 360) + 'px')
function wrapCustomCode(code: string): string {
  const key = JSON.stringify(customKey.value)
  // 量高探针:内容 > 视口时 documentElement.scrollHeight = 内容高(涨跟随);内容 < 视口时被视口
  // (= iframe 当前高度)垫底 → 回退 body 自然高(缩跟随);修前只涨不缩(改矮后恒卡旧高度)
  const probe =
    '\n' + SCRIPT_OPEN +
    '(function(){var k=' + key + ';var s=function(){var b=document.body,d=document.documentElement;var vh=window.innerHeight||0;var h=Math.max(b?b.scrollHeight:0,d?d.scrollHeight:0);if(h>0&&h<=vh){h=Math.max(b?b.scrollHeight:0,b?b.offsetHeight:0)}if(h>0){try{parent.postMessage({__customComp:true,key:k,h:h},"*")}catch(e){}}};window.addEventListener("load",s);if(document.readyState==="complete"){s()}setTimeout(s,200);setTimeout(s,600)})();' +
    SCRIPT_CLOSE
  return code + probe
}
</script>

<template>
  <!-- custom 纯代码组件:wrapper 接管点击命中 —— sandbox iframe 吞 click(无 allow-same-origin 不冒泡),
       事件委托 closest('[data-path]') 命不中;iframe pointer-events:none → click 透到 wrapper 命中 data-path(可两步拾取);
       动画仍跑(script 照常执行),hover 交互牺牲(纯预览展示) -->
  <div v-if="comp.type === 'custom'" class="custom-comp-wrap" :data-path="path" :style="compStyle" draggable="true">
    <iframe class="custom-comp-iframe"
      :srcdoc="wrapCustomCode(comp.code || '')"
      :style="{ height: customHeight }"
      sandbox="allow-scripts allow-modals allow-popups allow-forms"
    />
  </div>
  <!-- 其他组件:COMP_MAP 分发 -->
  <component v-else
    :is="COMP_MAP[comp.type] ?? 'div'"
    v-bind="comp.props"
    :comp-path="path"
    :id="comp.id"
    :style="compStyle"
    :class="compClass"
    :visible="comp.visible"
    :aria-label="comp.ariaLabel"
    :data-tooltip="comp.tooltip"
    :data-path="path"
    draggable="true"
  />
</template>

<style scoped>
.custom-comp-wrap { width: 100%; }
.custom-comp-iframe { display: block; width: 100%; border: none; pointer-events: none; }  /* none:click 透到 wrapper(有 data-path)→ custom 可两步拾取 */
</style>
