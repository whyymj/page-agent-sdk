<script setup lang="ts">
/**
 * 文案渲染统一出口(i18n.messages 值支持行内富文本)—— 与 IconGlyph 同构:
 * 纯文本按插值;值以 '<' 开头 = HTML 片段,经 DOMPurify **文案白名单**(b/em/u/s/span/mark/code 等行内
 * 语义标签 + class/style)净化后 v-html(事件属性/危险协议剥除,块级/script/a 不放行)。
 * 仅文本节点渲染位使用;title/placeholder 等属性位不适用(传 HTML 字面显示,文档已约定)。
 */
import { computed } from 'vue'
import { isIconHtml, sanitizeMessageHtml } from './iconHtml'

const props = defineProps<{ text: string }>()

const html = computed(() => (isIconHtml(props.text) ? sanitizeMessageHtml(props.text) : ''))
</script>

<template>
  <span v-if="html" class="msg-rich" v-html="html"></span>
  <template v-else>{{ text }}</template>
</template>
