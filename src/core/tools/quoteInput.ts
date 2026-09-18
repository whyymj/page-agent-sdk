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
 * S4(4.18):anchor 存在时引用块后附元信息行 `[位置: selector · 小节「heading」 · 文档:docId]`;
 * anchor.pageUrl 与当前 location.href 不一致 → 标「⚠ 锚点属于另一文档」(A3:防跨文档误用旧锚点,
 * 与 S2 的「防旧读结果」互补)。锚点是提示不是保证 —— selector 失效时 agent 回退 dom_search(文档明示)。
 * 无 anchor:与既有形态逐字节一致(回归锁)。
 */
export function appendQuoteContext(content: string, quote: Pick<MessageQuote, 'text' | 'source' | 'anchor'> | undefined | null): string {
  if (!quote || !quote.text) return content
  const label = quote.source ? `[引用原文(来源:${quote.source})]` : '[引用原文]'
  const block = `${label}\n"""\n${quote.text}\n"""`
  const a = quote.anchor
  if (!a || !a.selector) return `${block}\n\n${content}`
  const parts: string[] = []
  if (a.selector) parts.push(a.selector)
  if (a.heading) parts.push(`小节「${a.heading.slice(0, 60)}」`)
  if (a.docId) parts.push(`文档:${a.docId}`)
  const metaLine = `[位置: ${parts.join(' · ')}]`
  const offsetPart = a.offset !== undefined ? `偏移 ${a.offset}` : ''
  const occPart = a.occurrence !== undefined && a.occurrence > 1 ? `第 ${a.occurrence} 次出现` : ''
  const extra = [offsetPart, occPart].filter(Boolean).join(', ')
  const stale = a.pageUrl && typeof location !== 'undefined' && location.href !== a.pageUrl
  const lines = [block, metaLine + (extra ? `(${extra})` : '')]
  if (stale) lines.push('⚠️ 锚点属于另一文档(捕获于其他页面),定位可能失效 —— 请以当前页面为准重新检索定位,勿直接依赖该锚点。')
  return `${lines.join('\n')}\n\n${content}`
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
  return findNearestHeadingEl(el, queryAll)?.textContent?.trim() || undefined
}

/** findNearestHeading 的元素版(S4:锚点同时取 heading 文本与 id 属性;纯函数,queryAll 可注入测) */
export function findNearestHeadingEl(
  el: Element | null | undefined,
  queryAll: (selector: string) => Element[],
): Element | undefined {
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
  return best
}

// ===== S4 引用 DOM 锚点(host-integration-contract;纯函数域,duck-typing 可注入测)=====

/** 块级标签集(选区起始块级祖先判定;行内元素向上爬到块级) */
const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'TD', 'TH', 'DD', 'DT', 'FIGURE', 'ASIDE', 'MAIN'])

/** duck-typing 的元素最小面(锚点构建依赖;测试桩同形) */
interface ElementLike {
  tagName?: string
  id?: string
  parentElement?: ElementLike | null
  children?: ElementLike[]
  textContent?: string | null
}

/** 选区起始块级祖先(行内 SPAN/STRONG 等向上爬;到顶仍非块级 → 该元素本身兜底) */
export function findBlockAncestor(el: ElementLike | null | undefined): ElementLike | null {
  let cur: ElementLike | null | undefined = el
  while (cur && cur.tagName && !BLOCK_TAGS.has(cur.tagName.toUpperCase())) cur = cur.parentElement ?? null
  return cur ?? el ?? null
}

/** CSS 标识符转义(id 选择器安全;非标识字符按 CSS.escape 语义转义) */
function cssEscapeIdent(s: string): string {
  return s.replace(/([^a-zA-Z0-9_-])/g, (_, c: string) => `\\${c}`)
}

/**
 * 块级祖先 → CSS selector(id 优先命中即止;否则 tag:nth-of-type 链,向上 ≤4 层,body/HTML 截止)。
 * 纯函数;元素缺 parentElement/children 面(duck-typing 桩)→ 能拼多少拼多少(宁短勿错)。
 */
export function buildQuoteSelector(el: ElementLike | null | undefined): string | undefined {
  if (!el || !el.tagName) return undefined
  const segOf = (n: ElementLike): string => {
    const tag = String(n.tagName).toLowerCase()
    if (n.id) return `${tag}#${cssEscapeIdent(n.id)}`
    const sibs = n.parentElement?.children
    if (Array.isArray(sibs)) {
      const same = sibs.filter((s) => String(s.tagName ?? '').toLowerCase() === tag)
      if (same.length > 1) {
        const idx = same.indexOf(n)
        if (idx >= 0) return `${tag}:nth-of-type(${idx + 1})`
      }
    }
    return tag
  }
  const parts: string[] = []
  let cur: ElementLike | undefined = el
  for (let depth = 0; cur && cur.tagName && depth < 4; depth++) {
    const tag = String(cur.tagName).toUpperCase()
    parts.unshift(segOf(cur))
    if (cur.id) break // id 命中,唯一确定,无需再向上
    if (tag === 'BODY' || tag === 'HTML') break
    cur = cur.parentElement ?? undefined
  }
  return parts.length ? parts.join(' > ') : undefined
}

/** duck-typing 的 Range 最小面(块内偏移精确测量;桩缺失 → undefined 走 indexOf 降级) */
interface RangeLike {
  startContainer?: unknown
  startOffset?: number
}

/**
 * 选中文本在块内的偏移与出现序号(A3 三级回退的定位级):
 * - Range 可得 → 精确偏移(块内文本节点顺序累加至 startContainer,再加 startOffset);
 * - 否则 → 选区首片段(≤12 字符)在块文本中的 indexOf 降级;
 * - occurrence = 首片段在 [0, offset) 内已出现次数 + 1(同一短语重复时消歧)。
 */
export function measureQuoteOffset(blockText: string, selectionText: string, range?: RangeLike | null): { offset?: number; occurrence?: number } {
  const bt = blockText ?? ''
  const st = (selectionText ?? '').trim()
  if (!bt || !st) return {}
  const chunk = st.slice(0, 12)
  let offset: number | undefined
  if (range && typeof range.startOffset === 'number' && range.startContainer !== undefined) {
    offset = measureRangeOffsetInBlock(range.startContainer, range.startOffset, bt)
  }
  if (offset === undefined || offset < 0 || offset > bt.length) offset = bt.indexOf(chunk)
  if (offset < 0) return {}
  let before = 0
  let occurrence = 1
  let at = bt.indexOf(chunk)
  while (at >= 0 && at < offset) { before++; at = bt.indexOf(chunk, at + 1) }
  occurrence = before + 1
  return { offset, occurrence }
}

/** Range startContainer 在块文本中的偏移(文本节点顺序累加;非文本节点/超界 → undefined 降级) */
function measureRangeOffsetInBlock(startContainer: unknown, startOffset: number, blockText: string): number | undefined {
  const node = startContainer as { nodeType?: number; textContent?: string | null; parentElement?: unknown } | null
  if (!node || node.nodeType !== 3 || typeof node.textContent !== 'string') return undefined
  // 无 parentNode 遍历面(duck-typing 桩)→ 用块内 indexOf 该文本节点内容近似(首次出现)
  const idx = blockText.indexOf(node.textContent)
  if (idx < 0) return undefined
  return idx + Math.min(startOffset, node.textContent.length)
}

/** 宿主/捕获侧锚点归一(可增量构造;非法字段丢弃;纯函数;setQuote 第三参与捕获侧共用) */
export function normalizeQuoteAnchor(a: Partial<NonNullable<MessageQuote['anchor']>> | undefined | null): NonNullable<MessageQuote['anchor']> | undefined {
  if (!a || typeof a !== 'object') return undefined
  const out: NonNullable<MessageQuote['anchor']> = {}
  if (typeof a.selector === 'string' && a.selector.trim()) out.selector = a.selector.trim().slice(0, 300)
  if (typeof a.heading === 'string' && a.heading.trim()) out.heading = a.heading.trim().slice(0, 60)
  if (typeof a.headingId === 'string' && a.headingId.trim()) out.headingId = a.headingId.trim().slice(0, 120)
  if (typeof a.docId === 'string' && a.docId.trim()) out.docId = a.docId.trim().slice(0, 120)
  if (typeof a.pageUrl === 'string' && a.pageUrl.trim()) out.pageUrl = a.pageUrl.trim().slice(0, 500)
  for (const k of ['blockIndex', 'offset', 'occurrence'] as const) {
    const v = (a as Record<string, unknown>)[k]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = Math.floor(v)
  }
  return Object.keys(out).length ? out : undefined
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
  getRangeAt?: (i: number) => RangeLike
  toString(): string
}

/** duck-typing 的 document 最小面 */
export interface QuoteDocLike {
  getSelection?(): SelectionLike | null
  title?: string
  location?: { href?: string }
  querySelectorAll?: (selector: string) => Array<Element | null> | NodeList
}

/**
 * 懒捕获当前选区为引用(浏览器域入口,node 下 getSelection 缺失返回 null)。
 * 无效选区(无 selection / 塌缩 / 空白 / 锚在 SDK 自身 UI 内)→ null 不打扰;
 * input/textarea 内的选区 getSelection 拿不到,宿主可自行 setQuote 兜底。
 * S4(4.18):一并捕获 DOM 锚点(块级祖先 selector/块内偏移/出现序号/最近标题 + 捕获时 pageUrl)。
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
    ? (s: string) => Array.from(doc.querySelectorAll!(s) as ArrayLike<Element>)
    : undefined
  const source = deriveQuoteSource(anchorEl, pageTitle || '当前页面', queryAll)
  // S4 锚点:块级祖先 + selector + 块内偏移/序号 + 最近标题(文本 + id)+ 捕获时 URL(A3 跨文档比对)
  const block = findBlockAncestor(anchorEl as unknown as Parameters<typeof findBlockAncestor>[0])
  const qAll = queryAll ?? (typeof document !== 'undefined' ? (s: string) => Array.from(document.querySelectorAll(s)) : undefined)
  const headingEl = qAll ? findNearestHeadingEl(anchorEl, qAll) : undefined
  const anchor = normalizeQuoteAnchor({
    selector: buildQuoteSelector(block),
    blockIndex: Array.isArray(block?.parentElement?.children) ? (block!.parentElement!.children as unknown[]).indexOf(block) : undefined,
    ...measureQuoteOffset(String(block?.textContent ?? ''), raw, sel.getRangeAt?.(0)),
    heading: headingEl?.textContent?.trim()?.slice(0, 60) || undefined,
    headingId: (headingEl as { id?: string } | undefined)?.id || undefined,
    ...(typeof doc.location?.href === 'string' ? { pageUrl: doc.location.href } : {}),
  })
  return { text, ...(source ? { source } : {}), ...(anchor ? { anchor } : {}) }
}

/** 浮动菜单定位纯函数(selectionMenu):选区矩形上方居中,顶部不够翻到下方,左右钳制在视口内 */
export function computeSelectionMenuPosition(
  selRect: { top: number; bottom: number; left: number; width: number },
  viewport: { w: number; h: number },
  menu: { w: number; h: number },
): { top: number; left: number; placement: 'above' | 'below' } {
  const GAP = 8
  const MARGIN = 8
  // 视口钳制(两轴):菜单必须完整落在视口内。
  // 修前漏洞:above 分支不钳制 → 选区在视口**下方**外(超长选区/选区起点远下)时 top 落在视口外看不到;
  // below 分支只钳上界 → 选区在视口**上方**外(sRect.bottom 为负)时 top 为负,同样看不到。
  // 超长选区(跨屏多段)是常态触发源:rect 可能高达成千上万 px,两端都越界。
  const clampLo = (v: number, max: number): number => Math.min(Math.max(v, MARGIN), Math.max(max, MARGIN))
  const left = clampLo(selRect.left + selRect.width / 2 - menu.w / 2, viewport.w - menu.w - MARGIN)
  const topOf = (raw: number): number => clampLo(raw, viewport.h - menu.h - MARGIN)
  if (selRect.top - menu.h - GAP >= MARGIN) {
    return { top: topOf(selRect.top - menu.h - GAP), left, placement: 'above' }
  }
  return { top: topOf(selRect.bottom + GAP), left, placement: 'below' }
}
