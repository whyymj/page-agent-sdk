<script setup lang="ts">
/**
 * 消息头像图标:user.svg(用户)/ robot.svg(AI 助手)。
 * 内联 SVG path 随库打包(无外部资产依赖);fill=currentColor 跟随 .message-avatar 容器的 color,
 * 故头像配色由 .message-avatar 按 role 设 color 控制(assistant 渐变底→白图标,user 浅底→深色图标)。
 * glyph 传入(dialog.icons.assistantAvatar/userAvatar)→ 替换内置 SVG:纯文本(emoji/字符)文本插值;
 * HTML 片段(以 '<' 开头,如内联 svg)经 IconGlyph 的 DOMPurify 图标白名单净化后渲染。
 */
import IconGlyph from '../IconGlyph.vue'

defineProps<{ role: 'user' | 'assistant'; glyph?: string }>()
</script>

<template>
  <IconGlyph v-if="glyph" :icon="glyph" class="avatar-glyph" />
  <svg v-else-if="role === 'user'" class="avatar-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M512 170.688a149.312 149.312 0 1 0 0 298.624 149.312 149.312 0 0 0 0-298.624zM277.312 320a234.688 234.688 0 1 1 469.376 0 234.688 234.688 0 0 1-469.376 0zM128 810.688a213.312 213.312 0 0 1 213.312-213.312h341.376A213.312 213.312 0 0 1 896 810.688v128H128v-128z m213.312-128a128 128 0 0 0-128 128v42.688h597.376v-42.688a128 128 0 0 0-128-128H341.312z" />
  </svg>
  <svg v-else class="avatar-icon" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M717.12 274H762c82.842 0 150 67.158 150 150v200c0 82.842-67.158 150-150 150H262c-82.842 0-150-67.158-150-150V424c0-82.842 67.158-150 150-150h44.88l-18.268-109.602c-4.086-24.514 12.476-47.7 36.99-51.786 24.514-4.086 47.7 12.476 51.786 36.99l20 120c0.246 1.472 0.416 2.94 0.516 4.398h228.192c0.1-1.46 0.27-2.926 0.516-4.398l20-120c4.086-24.514 27.272-41.076 51.786-36.99 24.514 4.086 41.076 27.272 36.99 51.786L717.12 274zM262 364c-33.138 0-60 26.862-60 60v200c0 33.138 26.862 60 60 60h500c33.138 0 60-26.862 60-60V424c0-33.138-26.862-60-60-60H262z m50 548c-24.852 0-45-20.148-45-45S287.148 822 312 822h400c24.852 0 45 20.148 45 45S736.852 912 712 912H312z m-4-428c0-24.852 20.148-45 45-45S398 459.148 398 484v40c0 24.852-20.148 45-45 45S308 548.852 308 524v-40z m318 0c0-24.852 20.148-45 45-45S716 459.148 716 484v40c0 24.852-20.148 45-45 45S626 548.852 626 524v-40z" />
  </svg>
</template>

<style scoped>
.avatar-icon { width: 62%; height: 62%; fill: currentColor; }
/* 文本字形(dialog.icons.*Avatar):字号相对头像容器(32/28px)微缩,emoji 视觉居中 */
.avatar-glyph { font-size: 15px; line-height: 1; }
</style>
