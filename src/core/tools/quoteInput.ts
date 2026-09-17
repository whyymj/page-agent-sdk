/**
 * 划词引用(page-quote)—— 宿主页面选中文本作为提问上下文。
 *
 * 纯函数域:appendQuoteContext(toLC 注入)/ deriveQuoteSource·findNearestHeading(来源推导)/
 * captureSelectionQuote(懒捕获,duck-typing document)。与 images 管线同构:消息级侧字段
 * (AgentMessage.quote)+ 发送链透传 + toLC 拼装,content 保持干净(UI 气泡渲染引用块、
 * 快照 JSON 自动持久化)。注入为**前缀**(引用是问题指向的语境,与 appendImageDescriptions
 * 的后缀形态不同,注释互见)。
 */
import type { MessageQuote } from '../types'
import { isInsideSdkUi } from '../utils/sdkDom'

/** 引用文本截断上限(自动捕获与 setQuote 统一;防整页选区灌爆上下文,与 MAX_IMAGES_PER_ROUND 同哲学) */
export const QUOTE_MAX_CHARS = 2000

/** 选中文本归一:trim + 折叠 3+ 连续空行为 2 + 截断上限(纯函数) */
export function normalizeQuoteText(raw: string): string {
  const trimmed = (raw ?? '').replace(/\r\n/g, '\n').trim()
  const collapsed = trimmed.replace(/\n{3,}/g, '\n\n')
  return collapsed.slice(0, QUOTE_MAX_CHARS)
}

/**
 * toLC 注入(纯函数):引用块前缀拼在用户 content 之前。quote 缺失/空文本原样返回。
 * 形态与 appendImageDescriptions 对齐(后者后缀补充,本处前缀语境),LLM 侧读作「针对这段原文提问」。
 */
export function appendQuoteContext(content: string, quote: Pick<MessageQuote, 'text' | 'source'> | undefined | null): string {
  if (!quote || !quote.text) return content
  const label = quote.source ? `[引用原文(来源:${quote.source})]` : '[引用原文]'
  return `${label}\n"""\n${quote.text}\n"""\n\n${content}`
}

/** 标题选择器(来源推导:选区上方最近的 h1-h6) */
const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'

/** compareDocumentPosition 位掩码(Node.DOCUMENT_POSITION_*,字面量防 lib 差异) */
const POSITION_PRECEDING = 2 // 对方在本元素之前
const POSITION_FOLLOWING = 4 // 对方在本元素之后

/**
 * 找「文档序在选区元素之前且最近」的标题(纯函数,queryAll 可注入测)。
 * 返回标题文本(trim 后无内容 → undefined)。
 */
export function findNearestHeading(
  el: Element | null | undefined,
  queryAll: (selector: string) => Element[],
): string | undefined {
  if (!el || typeof el.compareDocumentPosition !== 'function') return undefined
  let best: Element | undefined
  for (const h of queryAll(HEADING_SELECTOR)) {
    if (typeof h.compareDocumentPosition !== 'function') continue
    // 只要「在 el 之前」的标题(el.compareDocumentPosition(h) 的 PRECEDING 位 = h 在 el 前)
    if (!(el.compareDocumentPosition(h) & POSITION_PRECEDING)) continue
    // 已有 best 且 best 在 h 之后(best 更靠近 el)→ 保留 best,否则 h 更近
    if (best && (h.compareDocumentPosition(best) & POSITION_FOLLOWING)) continue
    best = h
  }
  const text = (best as { textContent?: string | null } | undefined)?.textContent
  return text?.trim() || undefined
}

/**
 * 来源推导(纯函数):`${pageTitle} · ${最近在前标题(≤60字)}`,无标题回落 pageTitle。
 * selEl 为空(选区无元素锚)→ pageTitle。queryAll 可注入(node selftest duck-typing)。
 */
export function deriveQuoteSource(selEl: Element | null | undefined, pageTitle: string, queryAll?: (selector: string) => Element[]): string {
  // queryAll 未注入时回落全局 document;无 document(node/测试桩)→ 跳过标题推导只回 pageTitle
  const q = queryAll ?? (typeof document !== 'undefined' ? (sel: string) => Array.from(document.querySelectorAll(sel)) : undefined)
  const heading = q ? findNearestHeading(selEl, q) : undefined
  if (!heading) return pageTitle
  return `${pageTitle} · ${heading.slice(0, 60)}`
}

/** duck-typing 的 Selection 最小面(captureSelectionQuote 依赖;测试桩同形) */
interface SelectionLike {
  isCollapsed?: boolean
  anchorNode?: Node | null
  toString(): string
}

/** duck-typing 的 document 最小面 */
export interface QuoteDocLike {
  getSelection?(): SelectionLike | null
  title?: string
  querySelectorAll?: (selector: string) => Array<Element | null> | NodeList
}

/**
 * 懒捕获当前选区为引用(浏览器域入口,node 下 getSelection 缺失返回 null)。
 * 无效选区(无 selection / 塌缩 / 空白 / 锚在 SDK 自身 UI 内)→ null 不打扰;
 * input/textarea 内的选区 getSelection 拿不到,宿主可自行 setQuote 兜底。
 */
export function captureSelectionQuote(doc: QuoteDocLike): MessageQuote | null {
  const sel = doc.getSelection?.()
  if (!sel || sel.isCollapsed) return null
  const raw = sel.toString()
  const text = normalizeQuoteText(raw)
  if (!text) return null
  const anchorEl = sel.anchorNode?.nodeType === 1 ? (sel.anchorNode as Element) : sel.anchorNode?.parentElement ?? null
  if (isInsideSdkUi(anchorEl)) return null
  const pageTitle = typeof doc.title === 'string' ? doc.title.trim() : ''
  // 标题推导经 doc 注入(QuoteDocLike.querySelectorAll);无该面(duck-typing 桩)→ deriveQuoteSource 内部降级
  const queryAll = typeof doc.querySelectorAll === 'function'
    ? (sel: string) => Array.from(doc.querySelectorAll!(sel) as ArrayLike<Element>)
    : undefined
  const source = deriveQuoteSource(anchorEl, pageTitle || '当前页面', queryAll)
  return { text, ...(source ? { source } : {}) }
}

/** 浮动菜单定位纯函数(selectionMenu):选区矩形上方居中,顶部不够翻到下方,左右钳制在视口内 */
export function computeSelectionMenuPosition(
  selRect: { top: number; bottom: number; left: number; width: number },
  viewport: { w: number; h: number },
  menu: { w: number; h: number },
): { top: number; left: number; placement: 'above' | 'below' } {
  const GAP = 8
  const MARGIN = 8
  const leftRaw = selRect.left + selRect.width / 2 - menu.w / 2
  const left = Math.min(Math.max(leftRaw, MARGIN), Math.max(viewport.w - menu.w - MARGIN, MARGIN))
  if (selRect.top - menu.h - GAP >= MARGIN) {
    return { top: selRect.top - menu.h - GAP, left, placement: 'above' }
  }
  return { top: Math.min(selRect.bottom + GAP, viewport.h - menu.h - MARGIN), left, placement: 'below' }
}
