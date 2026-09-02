<script setup lang="ts">
/**
 * 图标字形渲染(dialog.icons 值统一出口):
 *  - 纯文本(不以 '<' 开头)→ 文本插值,与直接 {{ icon }} 等价(emoji/字符/空串隐藏)
 *  - HTML 片段(以 '<' 开头,如内联 svg/img)→ DOMPurify 图标白名单净化后 v-html(sanitizeIconHtml)
 * 组件统一出口保证任何 icons 键传 HTML 都过同一净化路径,单点维护安全策略。
 */
import { computed } from 'vue'
import { isIconHtml, sanitizeIconHtml } from './iconHtml'

const props = defineProps<{ icon: string }>()

const isHtml = computed(() => isIconHtml(props.icon))
const html = computed(() => (isHtml.value ? sanitizeIconHtml(props.icon) : ''))
</script>

<template>
  <span v-if="isHtml" class="icon-html" v-html="html"></span>
  <span v-else class="icon-text">{{ icon }}</span>
</template>

<style scoped>
/* HTML 图标基线对齐(emoji 文本路径无包裹,维持原样式;svg/img 自带 width/height 或经 class 定制) */
.icon-html { display: inline-flex; align-items: center; justify-content: center; }
.icon-html :deep(svg), .icon-html :deep(img) { display: block; }
/* emoji 文本图标字体栈 + 行高 1(minimal-demo 实测修,2026-09-02):宿主全局样式(如 font:14px/14px Arial)
 * 级联进来时,无回退的纯 Arial 栈对 U+2795 等 emoji 码位渲染退化(实测 28 行像素只 2 行有墨,字形细线不可见)
 * + 紧行高压缩字形。显式 emoji 字体链(苹果/视窗/Linux 顺序)+ line-height:1 让字形恒可渲染可占位 */
.icon-text { line-height: 1; font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif; }
</style>
