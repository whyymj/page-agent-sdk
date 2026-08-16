<script setup lang="ts">
import { ref, onMounted, nextTick, watch } from 'vue'
import { useMarkdown, type CodeBlock } from '../composables/useMarkdown'
import CodePreview from './CodePreview.vue'
import { copyText } from '../utils/clipboard'
import { MESSAGES_ZH_CN, type DialogMessages } from './messages'

const props = withDefaults(defineProps<{
  content: string
  /** 文案集(透传给 CodePreview;独立复用缺省中文) */
  messages?: DialogMessages
}>(), {
  messages: () => MESSAGES_ZH_CN,
})

const { html, codeBlocks } = useMarkdown(() => props.content)

const containerRef = ref<HTMLElement | null>(null)
const previewCode = ref<CodeBlock | null>(null)

/** 可预览的代码语言 */
const previewableLangs = ['html', 'htm', 'vue', 'javascript', 'js', 'css']

function isPreviewable(lang: string) {
  return previewableLangs.includes(lang.toLowerCase())
}

/** 根据语言推断文件扩展名并下载代码 */
function downloadCode(lang: string, code: string) {
  const extMap: Record<string, string> = {
    html: 'html', htm: 'html', css: 'css', javascript: 'js', js: 'js',
    typescript: 'ts', ts: 'ts', vue: 'vue', python: 'py', json: 'json',
    xml: 'xml', markdown: 'md', md: 'md', shell: 'sh', bash: 'sh',
  }
  const ext = extMap[lang.toLowerCase()] || 'txt'
  const blob = new Blob([code], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `code-${Date.now()}.${ext}`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 工具栏按钮 icon(与 MessageActions 的 msg-action-btn 统一:icon+文字,不用 emoji) */
const TOOLBAR_ICONS = {
  copy: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3" /><path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H3.5A1.5 1.5 0 0 0 2 3v5.5A1.5 1.5 0 0 0 3.5 10H4" stroke="currentColor" stroke-width="1.3" /></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>',
  download: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2.5v7.5m0 0L5 7m3 3l3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /><path d="M2.5 11.5v1a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" /></svg>',
  play: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4.5 3.2v9.6c0 .6.65.97 1.17.66l7.5-4.8a.78.78 0 0 0 0-1.32l-7.5-4.8A.78.78 0 0 0 4.5 3.2z" fill="currentColor" /></svg>',
} as const

/**
 * 为渲染后的代码块注入操作按钮（复制/下载/预览）。
 * 由于 marked 输出静态 HTML，这里在 DOM 渲染后手动增强交互。
 */
async function enhanceCodeBlocks() {
  await nextTick()
  const container = containerRef.value
  if (!container) return

  const blocks = container.querySelectorAll<HTMLElement>('pre.code-block')
  blocks.forEach((pre, index) => {
    if (pre.querySelector('.code-toolbar')) return

    const lang = pre.dataset.lang || 'plaintext'
    const rawCode = decodeURIComponent(pre.dataset.code || '')

    const toolbar = document.createElement('div')
    toolbar.className = 'code-toolbar'

    const langLabel = document.createElement('span')
    langLabel.className = 'code-lang'
    langLabel.textContent = lang
    toolbar.appendChild(langLabel)

    // 按钮组右侧对齐(原逐按钮 margin-left:auto 收敛到组容器,布局意图更明确)
    const actions = document.createElement('div')
    actions.className = 'code-toolbar-actions'

    const copyBtn = document.createElement('button')
    copyBtn.className = 'code-action-btn'
    copyBtn.title = '复制代码'
    copyBtn.innerHTML = TOOLBAR_ICONS.copy + '<span>复制</span>'
    copyBtn.onclick = async () => {
      const ok = await copyText(rawCode)
      copyBtn.classList.toggle('done', ok)
      copyBtn.innerHTML = (ok ? TOOLBAR_ICONS.check : TOOLBAR_ICONS.copy) + `<span>${ok ? '已复制' : '复制失败'}</span>`
      setTimeout(() => {
        copyBtn.classList.remove('done')
        copyBtn.innerHTML = TOOLBAR_ICONS.copy + '<span>复制</span>'
      }, 1500)
    }
    actions.appendChild(copyBtn)

    const dlBtn = document.createElement('button')
    dlBtn.className = 'code-action-btn'
    dlBtn.title = '下载为文件'
    dlBtn.innerHTML = TOOLBAR_ICONS.download + '<span>下载</span>'
    dlBtn.onclick = () => downloadCode(lang, rawCode)
    actions.appendChild(dlBtn)

    if (isPreviewable(lang)) {
      const previewBtn = document.createElement('button')
      previewBtn.className = 'code-action-btn preview-btn'
      previewBtn.title = '在新弹层预览运行'
      previewBtn.innerHTML = TOOLBAR_ICONS.play + '<span>运行预览</span>'
      previewBtn.onclick = () => {
        previewCode.value = { lang, code: rawCode }
      }
      actions.appendChild(previewBtn)
    }

    toolbar.appendChild(actions)
    pre.appendChild(toolbar)
  })
}

onMounted(enhanceCodeBlocks)
// P1-26:DOM 增强由 html 实际变更驱动(useMarkdown 节流后 html 变更频率 << content delta 频率);
// 原 onUpdated + watch(content) 双驱动随每 delta 全量 querySelector,巨内容时叠加卡顿
watch(html, enhanceCodeBlocks)
</script>

<template>
  <div class="message-md" ref="containerRef" v-html="html"></div>

  <Teleport to="body">
    <CodePreview
      v-if="previewCode"
      :code="previewCode.code"
      :lang="previewCode.lang"
      :messages="messages"
      @close="previewCode = null"
    />
  </Teleport>
</template>

<style>
.message-md {
  font-size: 12px;
  line-height: 1.7;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.message-md p {
  margin: 0 0 8px;
}

.message-md p:last-child {
  margin-bottom: 0;
}

.message-md table {
  display: block; max-width: 100%; overflow-x: auto;
  border-collapse: collapse; margin: 8px 0;
}
.message-md th, .message-md td {
  border: 1px solid var(--cs-md-border, #e5e7eb); padding: 4px 8px; font-size: 12px; white-space: nowrap;
}
.message-md th { background: var(--cs-md-th-bg, #f9fafb); }
.message-md img { max-width: 100%; }

.message-md ul,
.message-md ol {
  margin: 6px 0;
  padding-left: 20px;
}

.message-md li {
  margin: 2px 0;
}

.message-md h1,
.message-md h2,
.message-md h3 {
  margin: 10px 0 6px;
  font-weight: 600;
}

.message-md h1 { font-size: 18px; }
.message-md h2 { font-size: 16px; }
.message-md h3 { font-size: 15px; }

.message-md a {
  color: #667eea;
  text-decoration: underline;
}

.message-md code:not(.hljs) {
  background: var(--cs-md-code-bg, rgba(102, 126, 234, 0.1));
  color: var(--cs-md-code-text, #4338ca);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 13px;
}

.message-md .code-block {
  position: relative;
  margin: 10px 0;
  padding: 0;
  background: #1f2937;
  border-radius: 8px;
  overflow: hidden;
}

.message-md .code-block code {
  display: block;
  padding: 12px 14px;
  overflow-x: auto;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 13px;
  line-height: 1.5;
  color: #e5e7eb;
  background: transparent;
}

.message-md .code-toolbar {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  background: rgba(0, 0, 0, 0.25);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.message-md .code-lang {
  font-size: 11px;
  color: #9ca3af;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  text-transform: lowercase;
}

.message-md .code-toolbar-actions {
  display: flex;
  gap: 6px;
  margin-left: auto;
}

/* pill 按钮与 MessageActions 的 msg-action-btn 同语言(icon+文字,无 emoji);
   代码块恒深底(#1f2937)不随主题,按钮配色按深底适配 */
.message-md .code-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: #cbd5e1;
  font-size: 11px;
  line-height: 1.6;
  cursor: pointer;
  transition: all 0.2s;
}

.message-md .code-action-btn svg {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}

.message-md .code-action-btn:hover {
  border-color: rgba(255, 255, 255, 0.35);
  color: #fff;
  background: rgba(255, 255, 255, 0.14);
}

/* 复制成功态:对勾 icon + ok 色(主题变量,与 msg-action-btn.done 一致) */
.message-md .code-action-btn.done {
  border-color: var(--cs-ok, #16a34a);
  color: var(--cs-ok, #16a34a);
  background: rgba(var(--cs-ok-rgb, 22, 163, 74), 0.12);
  cursor: default;
}

/* 运行预览:主色填充强调(替换硬编码 #667eea,主题变量随 light/dark);深底上主色字用白保证对比 */
.message-md .code-action-btn.preview-btn {
  border-color: transparent;
  background: var(--cs-primary, #1f4d3a);
  color: #fff;
}

.message-md .code-action-btn.preview-btn:hover {
  background: var(--cs-primary, #1f4d3a);
  color: #fff;
  filter: brightness(1.15);
}

/* highlight.js 主题简化 */
.message-md .hljs { color: #e5e7eb; }
.message-md .hljs-keyword { color: #c084fc; }
.message-md .hljs-string { color: #86efac; }
.message-md .hljs-comment { color: #6b7280; font-style: italic; }
.message-md .hljs-number { color: #fca5a5; }
.message-md .hljs-function .hljs-title,
.message-md .hljs-title { color: #93c5fd; }
.message-md .hljs-tag { color: #fca5a5; }
.message-md .hljs-attr { color: #fcd34d; }
.message-md .hljs-built_in { color: #67e8f9; }
</style>
