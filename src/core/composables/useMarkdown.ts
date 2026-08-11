/**
 * Markdown 渲染 composable
 *
 * 将 AI 回复的 markdown 文本解析为 HTML，并對代码块应用 highlight.js 语法高亮。
 * 同时提取代码块信息，便于前端添加"复制/预览"操作按钮。
 *
 * 安全(主流程审查 P0-2):marked v18 默认不净化 HTML,AI 回复经 v-html 渲染 = XSS sink
 * (fetchDoc 抓取的恶意文档经 LLM 回显即可在宿主 origin 执行脚本)。所有 marked 输出经
 * DOMPurify.sanitize 剥事件属性/危险协议(javascript:),保留 data-*(code-block 交互依赖)。
 *
 * 性能(fix-data-integrity P1-26):流式每 delta 全文 marked+hljs+DOMPurify 重算是 O(n²),
 * 巨内容冻结主线程。两层防护:
 *  - useMarkdown 尾随节流:大内容 ≤ 每 THROTTLE_MS 渲染一次 + 尾沿保证最终渲染(小内容直渲不节流);
 *  - hljs 尺寸闸:单代码块 > HLJS_BLOCK_MAX_CHARS 跳高亮直接转义(hljs 是单帧耗时大头;marked/DOMPurify 线性保留)。
 * sanitize 任何情况下不跳过(安全底线)。
 */
import { computed, shallowRef, watch, onScopeDispose, type ShallowRef, type ComputedRef } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js/lib/common'
import DOMPurify from 'dompurify'

export interface CodeBlock {
  lang: string
  code: string
}

marked.setOptions({
  breaks: true,
  gfm: true,
})

/** 单代码块超过此字符数跳过 hljs 高亮(直接转义),防巨代码块单帧卡顿(P1-26 尺寸闸) */
export const HLJS_BLOCK_MAX_CHARS = 20000

const renderer = new marked.Renderer()

// 自定义代码块渲染：加上语言标识和占位 hook，前端再增强交互
renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
  const language = (lang || '').trim() || 'plaintext'
  let highlighted = ''
  // hljs 尺寸闸:巨代码块跳高亮直接转义(P1-26);sanitize 不受影响恒走
  if (text.length > HLJS_BLOCK_MAX_CHARS) {
    highlighted = escapeHtml(text)
  } else {
    try {
      highlighted = hljs.highlight(text, { language, ignoreIllegals: true }).value
    } catch {
      highlighted = escapeHtml(text)
    }
  }
  const encoded = encodeURIComponent(text)
  // data-lang 就地 HTML 转义:lang 来自代码围栏 info string,可含 "/</>,不转义可逃逸属性边界(P0-2)
  const safeLang = escapeHtmlAttr(language)
  return `<pre class="code-block" data-lang="${safeLang}" data-code="${encoded}"><code class="hljs language-${safeLang}">${highlighted}</code></pre>`
}

/** HTML 属性值转义(防属性边界逃逸)。供 renderer.code 的 data-lang 用,可单测。 */
export function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// sanitize 配置:DOMPurify 默认白名单已剥 onerror/onload 等事件属性 + javascript: 协议 href;
// data-* 默认放行(DATA_ATTR=true),此处显式 ADD_ATTR data-code/data-lang 双保险 ——
// MessageContent 的复制/预览/下载按钮依赖这两个属性,防未来默认白名单收紧时静默丢失。
const SANITIZE_CONFIG: Record<string, unknown> = {
  ADD_ATTR: ['data-code', 'data-lang', 'target', 'rel'],
}

/** 净化 marked 输出的 HTML:剥事件属性/危险协议,保留 data-*(code-block 交互)。纯函数,browser E2E 测过滤行为。 */
export function sanitizeMarkdownHtml(html: string): string {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG)
}

/**
 * markdown → 未净化 HTML(marked + 代码块渲染,含 hljs 尺寸闸;**不含** DOMPurify)。纯函数,node 可单测(P1-26)。
 * ⚠️ 输出未净化,直接 v-html 有 XSS 风险;UI 一律经 renderMarkdownHtml(含 sanitize)。
 */
export function markedToHtml(text: string): string {
  return marked.parse(text || '', { renderer }) as string
}

/**
 * markdown → 净化 HTML(marked + 代码块渲染 + DOMPurify)。抽离供复用(P1-26)。
 * 含 hljs 尺寸闸(单代码块 > HLJS_BLOCK_MAX_CHARS 转义直出);sanitize 恒走。
 * 注:DOMPurify 依赖 DOM,node 环境 import 不崩但 sanitize 返空 —— 单测用 markedToHtml。
 */
export function renderMarkdownHtml(text: string): string {
  return sanitizeMarkdownHtml(markedToHtml(text))
}

/** 流式渲染节流窗(ms):大内容最多每窗渲染一次 + 尾沿保证最终渲染(P1-26) */
const THROTTLE_MS = 100
/** 内容 ≤ 此字符数不节流(每 delta 直渲,小消息打字机体验不变) */
const SYNC_MAX_CHARS = 2000

export function useMarkdown(content: () => string): { html: ShallowRef<string>; codeBlocks: ComputedRef<CodeBlock[]> } {
  // P1-26:html 从 computed(每 delta 全文重算)改 shallowRef + 尾随节流 watch ——
  // 大内容流式期间 ≤ 10fps 渲染,总量降 1-2 个数量级;尾沿 timer 保证流结束后渲染最终态
  const html = shallowRef(renderMarkdownHtml(content()))
  let lastRenderAt = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  function renderNow(): void {
    timer = null
    lastRenderAt = Date.now()
    html.value = renderMarkdownHtml(content())
  }
  watch(content, () => {
    const text = content()
    if (text.length <= SYNC_MAX_CHARS) {
      // 小内容直渲(不节流;typing 体验)
      if (timer) { clearTimeout(timer); timer = null }
      lastRenderAt = Date.now()
      html.value = renderMarkdownHtml(text)
      return
    }
    const wait = lastRenderAt + THROTTLE_MS - Date.now()
    if (wait <= 0) {
      if (timer) { clearTimeout(timer); timer = null }
      renderNow()
    } else if (!timer) {
      timer = setTimeout(renderNow, wait)  // 尾沿:节流窗末渲染最新内容
    }
  })
  onScopeDispose(() => { if (timer) { clearTimeout(timer); timer = null } })

  /** 从内容中提取所有代码块（用于预览判断） */
  const codeBlocks = computed<CodeBlock[]>(() => {
    const blocks: CodeBlock[] = []
    const regex = /```(\w+)?\n([\s\S]*?)```/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(content() || '')) !== null) {
      blocks.push({
        lang: (match[1] || 'plaintext').toLowerCase(),
        code: match[2],
      })
    }
    return blocks
  })

  return { html, codeBlocks }
}
