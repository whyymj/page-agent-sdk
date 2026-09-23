/**
 * DOM 读取工具 —— agent 读渲染后的页面 DOM 结构(胜任自动化 agent 的"看"能力)
 *
 * 定位:区别于 eval_script(沙箱内自由脚本,返回文本),get_dom 是**结构化、受限、深度可控**的只读工具:
 *  - 结构化 JSON 返回(LLM 易消费,vs eval_script 文本)
 *  - 只读 + 属性白名单(不执行脚本,默认不暴露全部 attribute,防敏感属性泄露)
 *  - 深度截断(防大 DOM 爆炸 token)
 *
 * 场景:agent 改完数据后回看渲染效果是否正确、定位元素、验证样式落地、辅助 UI 设计问答。
 * 大结果(超 offload 阈值)由 createAgent 的 coreExecTool 统一外存 vfs,本工具不自行截断。
 *
 * capabilities.domInspect 默认关闭(opt-in):读 DOM 有 token 成本,集成方按需开启。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import { isInsideSdkUi, SDK_UI_SELECTOR } from '../utils/sdkDom'

/** 默认暴露的 attribute 白名单(不传 attrs 时);data-* 始终包含(业务标记常挂此)。
 * 注意:`value` 不进默认白名单 —— 表单 <input value>/<textarea> 可能含敏感数据(密码/token/PII),
 * 默认暴露会把敏感值灌入 LLM 上下文(进而可能被写数据/外发)。需要时集成方显式传 attrs:['value']。 */
const DEFAULT_ATTRS = ['id', 'class', 'href', 'src', 'alt', 'title', 'style', 'role', 'aria-label', 'name', 'type']

/** 硬禁 attr 名(即使 LLM 把它们加进 attrs 白名单也排除):value 表单值(密码/token/PII)、
 * on* 事件处理器(可嵌脚本)、srcdoc/formaction 可嵌脚本/改表单动作。
 * 安全审查(perf-security HIGH):attrs 是 LLM 可控入参,不硬禁则默认白名单形同虚设。 */
const DENY_ATTR_RE = /^(value|srcdoc|formaction|on\w+)$/i
/** 敏感命名 attr(token/key/secret/password/auth/cred/csrf/session,如 data-token / data-api-key / data-csrf):
 * 即使命中白名单也排除,防凭据泄漏。 */
const DENY_ATTR_SENSITIVE_RE = /token|secret|password|passwd|api[-_]?key|auth|cred|csrf|session/i

/** 结构化 DOM 节点 */
export interface DomNode {
  tag: string
  attrs: Record<string, string>
  /** 直接文本子节点(不含子孙节点文本,trim) */
  text?: string
  /** 子节点(按深度递归展开) */
  children?: DomNode[]
  /** 深度截断时的子节点数(未展开,仅报数量省 token) */
  childCount?: number
}

export interface DomReadOptions {
  /** 遍历深度(0 = 只根节点) */
  depth: number
  /** 属性白名单;不传 = DEFAULT_ATTRS + data-*;传了 = 严格白名单(不含 data-*) */
  attrs?: string[]
  /** 是否包含直接文本(默认 true) */
  includeText?: boolean
}

/**
 * 纯函数:DOM Element → 结构化 DomNode(可单测,传入 mock node)。
 * 与浏览器解耦,测试用 duck-typing 假对象(tagName/attributes/childNodes/children)。
 */
export function domToStructure(node: Element | null, opts: DomReadOptions): DomNode | null {
  if (!node) return null
  const { depth, attrs: attrWhitelist, includeText = true } = opts
  const strict = attrWhitelist !== undefined
  const allow = attrWhitelist ?? DEFAULT_ATTRS

  const pickAttrs = (el: Element): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const a of Array.from(el.attributes)) {
      const ok = strict ? allow.includes(a.name) : (allow.includes(a.name) || a.name.startsWith('data-'))
      if (!ok) continue
      // 硬 DENY(安全):即使 LLM 把敏感 attr 加进 attrs 白名单也排除,防表单值/凭据/脚本泄漏
      if (DENY_ATTR_RE.test(a.name) || DENY_ATTR_SENSITIVE_RE.test(a.name)) continue
      out[a.name] = a.value
    }
    return out
  }

  const walk = (el: Element, d: number): DomNode => {
    const result: DomNode = { tag: el.tagName.toLowerCase(), attrs: pickAttrs(el) }
    if (includeText) {
      // 直接文本子节点(nodeType 3 = TEXT_NODE),不含子孙文本
      const direct = Array.from(el.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent || '')
        .join('')
        .trim()
      if (direct) result.text = direct
    }
    const kids = Array.from(el.children)
    if (d > 0) {
      if (kids.length) result.children = kids.map((k) => walk(k, d - 1))
    } else if (kids.length) {
      // 深度截断:不展开,只报数量
      result.childCount = kids.length
    }
    return result
  }

  return walk(node, depth)
}

export const getDomTool = tool(
  ({ selector, depth, attrs, includeText }) => {
    // node/服务端守卫(server-companion P0 审计):非浏览器环境友好回灌而非裸 ReferenceError
    // (render-check canRender 同款前科;domInspect 默认关,误开在 node 跑时给 LLM 可读出路)
    if (typeof document === 'undefined') {
      return 'ERROR: get_dom 仅在浏览器环境可用(当前运行在 node/服务端,无 DOM)。请改用数据工具(read/schema_data)排查结构。'
    }
    const root = selector ? document.querySelector(selector) : document.body
    if (!root) return `未找到匹配元素:selector="${selector}"`
    if (isInsideSdkUi(root)) return 'ERROR: 该 selector 命中 SDK 对话框自身(工具读它只会读到对话历史,无页面意义)。请用宿主页面元素的选择器。'
    const struct = domToStructure(root, {
      depth: depth ?? 3,
      attrs,
      includeText: includeText ?? true,
    })
    if (!struct) return `selector="${selector}" 未匹配到元素`
    return JSON.stringify(struct, null, 2)
  },
  {
    name: 'get_dom',
    description:
      '读渲染后 DOM 结构(tag/attrs/text/children)。检查渲染效果/验证修改是否生效用;depth 控制深度(默认 3),attrs 限定返回属性。只读,大结果自动外存 vfs。',
    schema: z.object({
      selector: z.string().optional().describe('CSS 选择器(默认 body,读整个页面)'),
      depth: z.number().int().min(0).max(10).optional().describe('遍历深度(默认 3;0 只读根节点)'),
      attrs: z.array(z.string()).optional().describe('属性白名单(传了 = 严格白名单;不传 = 默认常用 + data-*)'),
      includeText: z.boolean().optional().describe('是否包含直接文本(默认 true)'),
    }),
  },
)

// ===== read_page:页面正文纯文本提取(page-quote 配套主力读工具)=====
// get_dom 按深度返回结构树(读整篇文章要么 depth 开大爆 token、要么多次调用),dom_info 的 textAll
// 截 1000 字 —— 文档站「这个页面讲了什么/某段在哪」缺一个高效读正文的通道。read_page 定位:
// innerText 提取 + 智能定位正文容器 + 分页续读;排除 SDK 自身 UI(light DOM 挂进宿主页,不排除会把
// 「输入消息,Enter 发送」当页面正文)与 script/style 等非内容子树。

/** 正文容器候选(按优先级逐个 querySelector;article 优先于通名 .content —— 逗号并写会按文档序取首命中,失去优先级) */
const CONTENT_ROOT_SELECTORS = ['article', 'main', '[role="main"]', '.content', '.article-content', '.post-content', '.markdown-body', '#content']
/** 提取时整体跳过的标签(非内容子树;SVG/canvas 图形无文本价值) */
const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'canvas'])
const SKIP_TAG_SELECTOR = 'script,style,noscript,template,svg,iframe,canvas'

/**
 * 纯函数:智能定位正文容器(article → main → [role=main] → 常用 content 类名 → body)。
 * duck-typing(只需 querySelector/body),node selftest 可测。
 */
export function pickContentRoot(doc: ParentNode & { body?: Element | null }): Element | null {
  for (const sel of CONTENT_ROOT_SELECTORS) {
    try {
      const hit = doc.querySelector?.(sel)
      if (hit) return hit
    } catch { /* 选择器常量无非法形态;防御 duck 桩抛错 */ }
  }
  return (doc as { body?: Element | null }).body ?? null
}

/**
 * 纯函数:子树 → 归一化正文文本。逐层遍历直接子元素:
 * - skipEl 命中 / SKIP_TAGS 标签 → 整个子树跳过
 * - 子树不含排除目标(containsSkip=false)→ 整枝 innerText 一次取全(结构换行保留,文本不重不漏)
 * - 含排除目标(如 SDK 对话框嵌在 #app 里)→ 下钻一层继续拆(保排除语义)
 * 归一:CRLF→LF、3+ 空行折叠 2、首尾 trim;块间以空行连接。
 */
export function extractPageText(
  root: ParentNode | null,
  skipEl: (el: Element) => boolean,
  containsSkip: (el: Element) => boolean,
): string {
  if (!root) return ''
  const parts: string[] = []
  const emit = (el: Element): void => {
    const raw = (el as HTMLElement).innerText ?? el.textContent ?? ''
    const norm = raw.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
    if (norm) parts.push(norm)
  }
  const walk = (parent: ParentNode): void => {
    for (const child of Array.from(parent.children ?? [])) {
      const el = child as Element
      const tag = String(el.tagName ?? '').toLowerCase()
      if (skipEl(el) || SKIP_TAGS.has(tag)) continue
      if (!containsSkip(el)) { emit(el); continue }
      walk(el)
    }
  }
  walk(root)
  return parts.join('\n\n').trim()
}

/** 工具侧排除判定闭包:子树是否含需排除目标(SKIP 标签或 SDK UI,嵌套任意深) */
function subtreeNeedsDescend(el: Element): boolean {
  try {
    return el.querySelector?.(SKIP_TAG_SELECTOR) != null || el.querySelector?.(SDK_UI_SELECTOR) != null
  } catch {
    return true // 查不动(duck 桩)宁可下钻也不误含
  }
}

export const readPageTool = tool(
  ({ selector, offset, limit }) => {
    // node/服务端守卫(get_dom 同款):误开在 node 跑时给 LLM 可读出路
    if (typeof document === 'undefined') {
      return 'ERROR: read_page 仅在浏览器环境可用(当前运行在 node/服务端,无 DOM)。请基于用户消息中的引用原文回答。'
    }
    let root: Element | null
    let container: string
    if (selector) {
      root = document.querySelector(selector)
      if (!root) return `未找到匹配元素:selector="${selector}"`
      container = selector
    } else {
      root = pickContentRoot(document)
      container = root ? root.tagName.toLowerCase() : 'body'
    }
    const full = extractPageText(root, isInsideSdkUi, subtreeNeedsDescend)
    const off = offset ?? 0
    const lim = limit ?? 4000
    if (off > full.length) return `offset=${off} 超出正文长度 ${full.length}(先从 offset=0 读,按 hasMore 续读)`
    const page = full.slice(off, off + lim)
    return JSON.stringify({ text: page, totalChars: full.length, offset: off, limit: lim, hasMore: off + page.length < full.length, container })
  },
  {
    name: 'read_page',
    description:
      '读当前页面正文纯文本(自动定位 article/main 等文章容器;排除 SDK 对话框自身与脚本样式)。回答「这个页面讲了什么/某段内容在哪」类问题用;长文按 hasMore=true 时 offset+=本次返回长度 续读。只读,大结果自动外存 vfs。',
    schema: z.object({
      selector: z.string().optional().describe('CSS 选择器(默认智能定位 article/main/[role=main]/.content,兜底 body)'),
      offset: z.number().int().min(0).optional().describe('起始字符偏移(默认 0;续读传上次 offset + 返回 text 长度)'),
      limit: z.number().int().min(200).max(20000).optional().describe('本次返回字符上限(默认 4000,上限 20000)'),
    }),
  },
)

/** DOM 读取工具集(静态数组,随 capabilities.domInspect 装配;read_page 与 get_dom 同为常驻) */
export const domTools = [getDomTool, readPageTool]

// ===== DOM 检视工具族(dom_search / dom_info;经 domInspectSkill 按需 load_skill 注入,不占常驻 schema)=====

/** 计算样式常用预设(不传 styles 时;完整 computedStyle 上百项会爆 token,预设覆盖排障高频项) */
export const DEFAULT_COMPUTED_STYLES = [
  'display', 'position', 'visibility', 'opacity', 'color', 'background-color', 'background-image',
  'font-size', 'font-weight', 'line-height', 'text-align', 'z-index', 'overflow', 'width', 'height',
  'margin', 'padding', 'border', 'border-radius', 'box-shadow', 'transform', 'transition', 'animation',
  'cursor', 'pointer-events', 'flex-direction', 'gap', 'max-width', 'min-height',
]

/**
 * 事件监听记录器(opt-in 装于 domInspect):patch addEventListener/removeEventListener 记录 target→type 计数。
 * 限制(诚实标注):仅记录 SDK 加载**之后**注册的监听(host 先注册的捕不到;inline on* 属性与 Vue vnode props 另行读取补盲)。
 */
const listenerRegistry = new WeakMap<EventTarget, Map<string, number>>()
let listenerRecorderInstalled = false
export function ensureDomListenerRecorder(): void {
  if (listenerRecorderInstalled) return
  const ET: any = (globalThis as any).EventTarget
  if (!ET?.prototype?.addEventListener) return
  listenerRecorderInstalled = true
  const origAdd = ET.prototype.addEventListener
  const origRemove = ET.prototype.removeEventListener
  ET.prototype.addEventListener = function (this: EventTarget, type: string, ...rest: unknown[]) {
    try {
      let m = listenerRegistry.get(this)
      if (!m) { m = new Map(); listenerRegistry.set(this, m) }
      m.set(String(type), (m.get(String(type)) ?? 0) + 1)
    } catch { /* frozen/sealed target 忽略 */ }
    return origAdd.call(this, type, ...(rest as []))
  }
  ET.prototype.removeEventListener = function (this: EventTarget, type: string, ...rest: unknown[]) {
    try {
      const m = listenerRegistry.get(this)
      if (m) {
        const n = (m.get(String(type)) ?? 1) - 1
        if (n <= 0) m.delete(String(type)); else m.set(String(type), n)
      }
    } catch { /* ignore */ }
    return origRemove.call(this, type, ...(rest as []))
  }
}
/** 读记录器中该 target 的监听类型(次数>0) */
export function getRecordedListeners(el: EventTarget): string[] {
  return [...(listenerRegistry.get(el)?.entries() ?? [])].filter(([, n]) => n > 0).map(([t]) => t)
}

/** 元素 CSS 路径(tag#id:nth-of-type 逐级向上,深度上限 12;定位/回查用) */
export function buildCssPath(el: Element, maxDepth = 12): string {
  const parts: string[] = []
  let cur: Element | null = el
  let depth = 0
  while (cur && cur.tagName && depth < maxDepth) {
    let seg = cur.tagName.toLowerCase()
    const id = (cur as HTMLElement).id
    if (id) { parts.unshift(`${seg}#${id}`); break } // 有 id 即止(路径已可定位)
    // 无 id 时带首个 class token(定位可读性:span.header-title 优于裸 span;非法字符 class 跳过)
    if (typeof cur.getAttribute === 'function') {
      const cls = (cur.getAttribute('class') || '').split(/\s+/).filter(Boolean)[0]
      if (cls && /^[A-Za-z][\w-]*$/.test(cls)) seg += `.${cls}`
    }
    const parent: Element | null = cur.parentElement
    if (parent) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName)
      if (sameTag.length > 1) seg += `:nth-of-type(${sameTag.indexOf(cur) + 1})`
    }
    parts.unshift(seg)
    cur = parent
    depth++
  }
  return parts.join(' > ')
}

/** 搜索命中项 */
export interface DomSearchHit {
  /** CSS 路径(buildCssPath) */
  selector: string
  tag: string
  /** 命中文本片段(selector 模式 = 直接文本;text 模式 = 含关键词的文本切片) */
  text: string
}

/**
 * 纯函数:在 root 子树内搜索元素 —— selector 模式(querySelectorAll)或 text 模式(textContent 包含关键词,
 * 跳过 script/style,须有非空文本)。返回带 CSS 路径的命中列表(limit 截断 + 标注总数)。
 */
export function searchDom(root: ParentNode | null, query: string, opts: { mode?: 'selector' | 'text'; limit?: number } = {}):
  { hits: DomSearchHit[]; total: number; truncated: boolean } {
  if (!root) return { hits: [], total: 0, truncated: false }
  const limit = Math.max(1, Math.min(opts.limit ?? 10, 20))
  const mode = opts.mode ?? 'selector'
  let matched: Element[] = []
  if (mode === 'selector') {
    try { matched = Array.from(root.querySelectorAll(query)) } catch { return { hits: [], total: 0, truncated: false } }
  } else {
    matched = Array.from(root.querySelectorAll('*')).filter((el) => {
      const tag = el.tagName.toLowerCase()
      if (tag === 'script' || tag === 'style' || tag === 'noscript') return false
      const t = (el.textContent || '').trim()
      return t.length > 0 && t.includes(query)
    })
    // 叶子优先:剔除「命中只是因为子树文本」的祖先容器(html/body/大容器会淹没真实命中;
    // 保留自身即叶子命中的元素 —— 子命中则父不含直接匹配语义)。候选上限 100 防大 DOM O(n²)
    const candidates = matched.slice(0, 100)
    const candidateSet = new Set(candidates)
    matched = candidates.filter((el) => {
      for (const m of candidateSet) if (m !== el && el.contains(m)) return false
      return true
    })
  }
  // 排除 SDK 自身 UI(2026-09-23 门户真机 dump 驱动):对话历史渲染在宿主页里,关键词会搜进
  // 模型自己说过的话(命中 div#chat-root / 侧栏;自引用噪声 + 「搜意图命中自己讲意图的答案」
  // 检索循环)。read_page 同款防线(extractPageText 的 isInsideSdkUi);duck-typing mock 无
  // closest 时 isInsideSdkUi 恒 false,零行为面
  matched = matched.filter((el) => !isInsideSdkUi(el))
  const cap = Math.min(matched.length, limit)
  const hits = matched.slice(0, cap).map((el) => {
    // 命中语境窗口(2026-09-21 门户真机 dump 驱动):旧形态取「直接文本子节点前 120 字」—— 命中
    // pre>code 等容器时只有一行代码/前缀(直接文本子节点不含内联元素),模型无法判读语境 → 连环
    // 换 query 重试 + read_page 跟读(实测单问 13 步)。改为:全文取 textContent(真 DOM,含内联
    // 子孙;duck-typing mock 无 textContent 回退直接文本节点拼接),text 模式围绕首个命中位置取
    // ±100 字符窗口(带 … 截断标记);selector 模式无查询串,取归一化前缀
    const raw = typeof el.textContent === 'string' && el.textContent
      ? el.textContent
      : Array.from(el.childNodes ?? []).filter((n: ChildNode) => n.nodeType === 3).map((n) => n.textContent || '').join('')
    const all = raw.replace(/\s+/g, ' ').trim()
    let text = all.slice(0, 120)
    if (mode !== 'selector' && query) {
      const i = all.indexOf(String(query))
      if (i >= 0) {
        text = (i > 100 ? '…' : '') + all.slice(Math.max(0, i - 100), i + 120) + (i + 120 < all.length ? '…' : '')
      }
    }
    return { selector: buildCssPath(el), tag: el.tagName.toLowerCase(), text }
  })
  return { hits, total: matched.length, truncated: matched.length > cap }
}

/** 单元素检视信息(内容/样式/几何/事件;styles 由注入的 getComputedStyle 求值,node 测试可注入 fake) */
export interface DomElementInfo {
  selector: string
  tag: string
  attrs: Record<string, string>
  /** 直接文本子节点(trim) */
  text?: string
  /** 全子树文本(innerText 优先,截断) */
  textAll?: string
  /** outerHTML 片段(截断;includeHtml 时) */
  html?: string
  rect?: { x: number; y: number; width: number; height: number }
  styles?: Record<string, string>
  /** 伪元素摘要(content/display/width/height;pseudo 时) */
  pseudoStyles?: { before?: Record<string, string>; after?: Record<string, string> }
  /** 事件绑定(三源合璧;includeEvents 时) */
  events?: {
    /** inline on* 属性(类型 + 代码片段截断) */
    inline: { type: string; snippet: string }[]
    /** Vue vnode props 的 onXxx 键(宿主为 Vue 时;__vueParentComponent.vnode.props) */
    vue: string[]
    /** addEventListener 记录器(仅 SDK 加载后注册的) */
    captured: string[]
  }
}

export interface ElementInfoOptions {
  styles?: string[]
  includeHtml?: boolean
  htmlLimit?: number
  includeEvents?: boolean
  includeRect?: boolean
  pseudo?: boolean
  /** 样式求值注入(缺省 globalThis.window.getComputedStyle;node 测试注入 fake) */
  getComputedStyle?: (el: Element, pseudoElt?: string | null) => Record<string, string> | CSSStyleDeclaration
}

const PSEUDO_PROPS = ['content', 'display', 'width', 'height', 'background-color', 'position']

/** 纯函数:Element → 结构化检视信息(与浏览器解耦;duck-typing 可测) */
export function getElementInfo(el: Element | null, opts: ElementInfoOptions = {}): DomElementInfo | null {
  if (!el) return null
  const info: DomElementInfo = { selector: buildCssPath(el), tag: el.tagName.toLowerCase(), attrs: {} }
  // attrs 复用 get_dom 白名单/deny 规则(同安全口径)
  for (const a of Array.from(el.attributes)) {
    const allow = DEFAULT_ATTRS.includes(a.name) || a.name.startsWith('data-')
    if (!allow || DENY_ATTR_RE.test(a.name) || DENY_ATTR_SENSITIVE_RE.test(a.name)) continue
    info.attrs[a.name] = a.value
  }
  const direct = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent || '').join('').trim()
  if (direct) info.text = direct.slice(0, 400)
  const textAll = String((el as HTMLElement).innerText ?? el.textContent ?? '').trim()
  if (textAll) info.textAll = textAll.slice(0, 1000)
  if ((opts.includeRect ?? true) && typeof (el as HTMLElement).getBoundingClientRect === 'function') {
    const r = (el as HTMLElement).getBoundingClientRect()
    info.rect = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
  }
  if (opts.includeHtml) {
    const limit = Math.min(opts.htmlLimit ?? 1500, 4000)
    const h = (el as HTMLElement).outerHTML ?? ''
    info.html = h.length > limit ? h.slice(0, limit) + `…(截断 ${h.length - limit} 字符)` : h
  }
  const gcs = opts.getComputedStyle ?? (globalThis as any).window?.getComputedStyle?.bind((globalThis as any).window)
  const readStyles = (pseudo?: string): Record<string, string> => {
    const out: Record<string, string> = {}
    if (typeof gcs !== 'function') return out
    try {
      const cs = gcs(el, pseudo ?? null) as Record<string, any>
      for (const k of pseudo ? PSEUDO_PROPS : (opts.styles ?? DEFAULT_COMPUTED_STYLES)) {
        const v = typeof cs.getPropertyValue === 'function' ? cs.getPropertyValue(k) : cs[k]
        if (v) out[k] = String(v).slice(0, 200)
      }
    } catch { /* getComputedStyle 不可用则空 */ }
    return out
  }
  if (opts.styles === undefined || opts.styles.length > 0) info.styles = readStyles()
  if (opts.pseudo) info.pseudoStyles = { before: readStyles('::before'), after: readStyles('::after') }
  if (opts.includeEvents !== false) {
    const inline = Array.from(el.attributes)
      .filter((a) => /^on\w+$/i.test(a.name))
      .map((a) => ({ type: a.name.toLowerCase().slice(2), snippet: a.value.slice(0, 100) }))
    const vueProps = (el as any).__vueParentComponent?.vnode?.props
    const vue = vueProps ? Object.keys(vueProps).filter((k) => /^on[A-Z]/.test(k)).map((k) => k.slice(2).toLowerCase()) : []
    info.events = { inline, vue, captured: getRecordedListeners(el) }
  }
  return info
}

export const domSearchTool = tool(
  ({ query, mode, limit, root }) => {
    ensureDomListenerRecorder() // 顺路安装事件记录器(幂等;后续 addEventListener 可被 dom_info 读到)
    const scope: ParentNode | null = root ? document.querySelector(root) : document
    if (root && !scope) return `未找到 root 元素:selector="${root}"`
    const r = searchDom(scope, query, { mode, limit })
    if (!r.total) return mode === 'text' ? `未找到包含文本「${query}」的元素` : `selector "${query}" 未匹配到元素`
    return JSON.stringify({ ...r, note: r.truncated ? `共 ${r.total} 处命中,仅返回前 ${r.hits.length} 处` : undefined }, null, 2)
  },
  {
    name: 'dom_search',
    description:
      '搜索页面元素:CSS 选择器或可见文本两种模式,返回命中元素的 CSS 路径 + 文本片段(≤20 处)。定位元素/查渲染结果用;找到 selector 后可用 dom_info 看详情或 get_dom 看结构。',
    schema: z.object({
      query: z.string().describe('selector 模式 = CSS 选择器(如 ".banner .title");text 模式 = 文本关键词'),
      mode: z.enum(['selector', 'text']).optional().describe('搜索模式(默认 selector;text = 文本包含匹配)'),
      limit: z.number().int().min(1).max(20).optional().describe('返回上限(默认 10)'),
      root: z.string().optional().describe('限定搜索范围的容器选择器(默认整页)'),
    }),
  },
)

export const domInfoTool = tool(
  ({ selector, styles, includeHtml, htmlLimit, includeEvents, includeRect, pseudo }) => {
    ensureDomListenerRecorder()
    const el = document.querySelector(selector)
    if (!el) return `未找到匹配元素:selector="${selector}"(可先用 dom_search 定位)`
    if (isInsideSdkUi(el)) return 'ERROR: 该 selector 命中 SDK 对话框自身(排障应读宿主页面元素)。'

    const info = getElementInfo(el, { styles, includeHtml, htmlLimit, includeEvents, includeRect, pseudo })
    if (!info) return `selector="${selector}" 读取失败`
    return JSON.stringify(info, null, 2)
  },
  {
    name: 'dom_info',
    description:
      '读单个元素完整信息:内容(直接文本/全文本/HTML 片段)+ 计算样式(默认排障高频预设,可指定属性列表)+ 几何位置 + 事件绑定(inline on*/Vue props/addEventListener 记录;记录器仅覆盖 SDK 加载后注册的监听)。验证样式落地/排查交互绑定用。',
    schema: z.object({
      selector: z.string().describe('CSS 选择器(取首个匹配;可先用 dom_search 定位)'),
      styles: z.array(z.string()).optional().describe('计算样式属性列表(不传 = 常用预设 ~30 项)'),
      includeHtml: z.boolean().optional().describe('是否含 outerHTML 片段(默认 false,大 HTML 省 token)'),
      htmlLimit: z.number().int().min(100).max(4000).optional().describe('HTML 片段上限字符(默认 1500)'),
      includeEvents: z.boolean().optional().describe('是否含事件绑定(默认 true)'),
      includeRect: z.boolean().optional().describe('是否含几何位置(默认 true)'),
      pseudo: z.boolean().optional().describe('是否含 ::before/::after 伪元素摘要(默认 false)'),
    }),
  },
)

/**
 * DOM 检视 skill(capabilities.domInspect 时并入 skills):dom_search/dom_info 两工具**按需注入** ——
 * load_skill 前仅占索引一行(schema 不进每轮上下文),加载后进工具池反复调用。
 * get_dom 保持常驻装配(向后兼容 + 最常用最小 schema)。
 */
/** skill 名常量(装配侧判重用;变体工厂保持同名) */
export const domInspectSkillName = 'dom-inspect'

/** dom-inspect skill 变体工厂:withScreenshot/withDomEdit/withDataOps = 对应能力已装配才教(勿教不存在的工具/闭环) */
export function makeDomInspectSkill(opts: { withScreenshot?: boolean; withDomEdit?: boolean; withDataOps?: boolean } = {}): import('../harness/skills').SkillSpec {
  return {
  name: domInspectSkillName,
  description: '页面 DOM 深度检视工具(dom_search 搜索元素 / dom_info 读内容·计算样式·事件绑定·几何)。定位元素、验证样式落地、排查交互绑定时加载',
  getContent: () => [
    '# DOM 检视工具用法',
    '## read_page({ selector?, offset?, limit? })—— 读正文首选',
    '- 返回页面正文纯文本(JSON:text/totalChars/offset/hasMore/container),自动定位 article/main/[role=main]/.content 容器并排除本对话框自身与 script/style',
    '- 长文分页:默认每次 4000 字符;hasMore=true 时下一次调用传 offset=上次 offset+本次 text 长度 续读',
    '- 回答「这个页面讲了什么/某段在哪」类问题用 read_page,不要用 get_dom 逐层翻结构(爆 token)',
    '## dom_search({ query, mode?, limit?, root? })',
    '- mode="selector"(默认):query 为 CSS 选择器;mode="text":文本关键词包含匹配(跳过 script/style)',
    '- 返回命中列表:CSS 路径(selector)+ 文本片段;超 limit 标注总数',
    '## dom_info({ selector, styles?, includeHtml?, pseudo?, ... })',
    '- selector 取首个匹配(先用 dom_search 定位更稳)',
    '- styles 不传 = 排障高频预设(display/position/color/background/font/z-index/transform 等约 30 项);传数组 = 只取指定属性',
    '- includeHtml: true 附 outerHTML 片段(默认省);pseudo: true 附 ::before/::after 摘要',
    '- events 三源:inline on* 属性 / Vue vnode props(onXxx)/ addEventListener 记录器(⚠ 仅记录本 SDK 加载之后注册的监听,更早的挂载捕不到)',
    '- rect:视口坐标 + 宽高(验证可见性/布局)',
    ...(opts.withScreenshot ? [
      '## take_screenshot({ selector?, fullPage? })—— 视觉验证',
      '- 截图「看」页面:selector 截指定元素区域 / fullPage 截整页 / 都不传截当前视口;截图经压缩投递(多模态直看图,纯文本模型自动走识图转述)',
      '- 布局/样式/渲染效果类问题优先截图(视觉真值),结构/属性类用 dom_info;截图失败(CSP/跨域图)会回灌原因与替代建议',
    ] : []),
    ...(opts.withDomEdit ? [
      '## dom_edit({ patches, dryRun? })—— 修改页面元素(宿主开启才有)',
      '- patches 批量原子(任一失败整批拒绝):set_text/set_html(内容)、set_attr/remove_attr、add_class/remove_class、set_style、insert(新建元素 anchor+position: before/after/prepend/append/replace)、remove、move(层级调整)、highlight(高亮+滚动)',
      '- 写纪律:selector 必须唯一命中(多匹配被拒,用 dom_search 拿精确路径);先读后写(get_dom/dom_info 看现状);拿不准先 dryRun 预检',
      '- 改前自动快照:dom_restore 回滚最近一批(可连续回退);改动为会话临时态(刷新即失);数据驱动页面改数据(write)不要改 DOM',
    ] : []),
    '## 排障套路',
    ...(opts.withScreenshot
      ? ['1. dom_search(mode:"text", query:按钮文案) 定位 → 2. 视觉验证 take_screenshot / 结构验证 dom_info(styles) → 3. ' + (opts.withDataOps ? '不符则改数据(write 修正后再验证)' : '不符则如实报告差异(页面为真值;本页面无数据写通道,调整预期或告知用户)')]
      : ['1. dom_search(mode:"text", query:按钮文案) 定位 → 2. dom_info(styles:["display","background-color","pointer-events"]) 验证样式/点击性 → 3. ' + (opts.withDataOps ? '不符则改数据(write 修正后再验证)' : '不符则如实报告差异(页面为真值;本页面无数据写通道,调整预期或告知用户)')]),
  ].join('\n'),
  tools: [() => [domSearchTool, domInfoTool]],
  }
}


// ===== page-analysis skill(page-quote 场景族:页面内容分析策略)=====
// 与 dom-inspect 分工:dom-inspect 教「工具怎么用」(参数/返回形态),page-analysis 教「场景怎么打」
// (问题分型 → 工具选择 → 探索策略 → 回答纪律)。装配态条件化:截图段只在 take_screenshot 已装配时教。

/** 页面内容分析 skill 名常量 */
export const pageAnalysisSkillName = 'page-analysis'

/** page-analysis skill 变体工厂(withScreenshot/withDomEdit/withVfs = 对应工具已装配才教该路线/条目) */
export function makePageAnalysisSkill(opts: { withScreenshot?: boolean; withDomEdit?: boolean; withVfs?: boolean } = {}): import('../harness/skills').SkillSpec {
  return {
    name: pageAnalysisSkillName,
    description: '页面内容分析策略:按问题类型选工具(引用原文/整页理解/定位/结构/视觉/页面操作),含分页探索纪律与基于页面实料的回答纪律。回答用户关于当前页面的问题时加载',
    getContent: () => [
      '# 页面内容分析策略',
      '## 第一步:问题分型(按类型选主力工具,不要一上来读整页)',
      '- **引用原文类**(用户消息带引用块):优先围绕引用原文作答;需要上下文再向外探索(所在小节 → 整页)',
      '- **整页理解类**(「这页讲了什么/总结要点」):read_page 读正文,长文按 hasMore 翻页,边读边归纳不要一次读爆',
      '- **定位类**(「某概念在本页哪里/那个按钮在哪」):dom_search mode:"text" 按关键词定位 → 需要细节再 read_page 带 selector 读该区域',
      '- **结构/属性类**(「这个区块是什么组件/有哪些属性」):dom_info(selector) 读单元素;层级关系用 get_dom',
      ...(opts.withScreenshot ? [
        '- **视觉类**(「看起来对不对/布局乱不乱/渲染效果」):take_screenshot 截图看视觉真值;selector 截局部、fullPage 截整页;截图是唯一能看到实际渲染效果的手段,结构推断不能代替',
      ] : []),
      ...(opts.withDomEdit ? [
        '- **操作类**(「把这段高亮/隐藏广告/调大字体/把这个块挪过去」):dom_edit patches 批量操作;纪律 = 先 get_dom/dom_search 定位唯一 selector → 拿不准先 dryRun → 改后 dom_info/截图验证 → 不满意 dom_restore 回滚;页面是临时态,持久修改要走宿主自己的机制',
      ] : []),
      '## 探索纪律',
      '1. **先窄后宽**:引用/焦点 → 所在小节 → 整页;每一步只取够回答当前问题的量',
      '2. **翻页不重复**:read_page 续读传 offset = 上次 offset + 返回 text 长度;不要回头重读已读区',
      '3. **定位失败换路**:selector 不命中 → dom_search text 模式换关键词;还不中 → read_page 扫小节标题再回来',
      ...(opts.withVfs ? ['4. **大结果在外存**:超大结果被移入 vfs 后用 vfs_read/vfs_grep 按需取,不要盲目重调'] : []),
      '## 回答纪律(页面问答的底线)',
      '- **基于页面实料**:答案须来自你读到的页面内容(引用原文/read_page/dom 工具结果),并在回答中点明出处小节/位置',
      '- **页面 ≠ 训练数据**:页面内容可能与你的先验知识不同,冲突时以页面为准;页面没写的不要编造',
      '- **不确定就说不确定**:找不到的内容如实说「本页未找到」,给出已探索的范围,勿凭印象补全',
      '## 输出纪律(直接说内容,不写过程)',
      '- 禁**过程叙述**:「我先读一下页面」「让我确认一下」—— 工具调用用户看得见,不需要旁白',
      '- 禁**元话术**:「先给结论」「依据是」「简言之」—— 第一句直接就是答案本身,不要先宣布你要说什么',
      '- 禁**方法论自述**:不要解释结论是怎么来的(「这些不是页面写明的,而是从正文用词反推的」)—— 那是你的内部过程',
      '- 禁**预告与套话**:「下面分三点」「综上」—— 该分点就直接分点,说完就停',
      '- 出处仍要标,但用最简形式:句末括注(如「(§小节名)」「(原文)」);引原文时直接引,不写「依据是…原文两行:」这样的引导句',
    ].join('\n'),
  }
}

/** 兼容导出(无截图段的基础变体;装配侧已改用 makeDomInspectSkill 按装配态生成) */
export const domInspectSkill = makeDomInspectSkill()
