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
    const root = selector ? document.querySelector(selector) : document.body
    if (!root) return `未找到匹配元素:selector="${selector}"`
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

/** DOM 读取工具集(静态数组,随 capabilities.domInspect 装配) */
export const domTools = [getDomTool]

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
  const cap = Math.min(matched.length, limit)
  const hits = matched.slice(0, cap).map((el) => {
    const direct = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent || '').join('').trim()
    let text = direct
    if (mode === 'text' && !text) {
      const all = (el.textContent || '').trim()
      const i = all.indexOf(query)
      text = all.slice(Math.max(0, i - 20), i + query.length + 40)
    }
    return { selector: buildCssPath(el), tag: el.tagName.toLowerCase(), text: text.slice(0, 120) }
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
export const domInspectSkill: import('../harness/skills').SkillSpec = {
  name: 'dom-inspect',
  description: '页面 DOM 深度检视工具(dom_search 搜索元素 / dom_info 读内容·计算样式·事件绑定·几何)。定位元素、验证样式落地、排查交互绑定时加载',
  getContent: () => [
    '# DOM 检视工具用法',
    '## dom_search({ query, mode?, limit?, root? })',
    '- mode="selector"(默认):query 为 CSS 选择器;mode="text":文本关键词包含匹配(跳过 script/style)',
    '- 返回命中列表:CSS 路径(selector)+ 文本片段;超 limit 标注总数',
    '## dom_info({ selector, styles?, includeHtml?, pseudo?, ... })',
    '- selector 取首个匹配(先用 dom_search 定位更稳)',
    '- styles 不传 = 排障高频预设(display/position/color/background/font/z-index/transform 等约 30 项);传数组 = 只取指定属性',
    '- includeHtml: true 附 outerHTML 片段(默认省);pseudo: true 附 ::before/::after 摘要',
    '- events 三源:inline on* 属性 / Vue vnode props(onXxx)/ addEventListener 记录器(⚠ 仅记录本 SDK 加载之后注册的监听,更早的挂载捕不到)',
    '- rect:视口坐标 + 宽高(验证可见性/布局)',
    '## 排障套路',
    '1. dom_search(mode:"text", query:按钮文案) 定位 → 2. dom_info(styles:["display","background-color","pointer-events"]) 验证样式/点击性 → 3. 不符则改数据(get_dom 看结构对照)',
  ].join('\n'),
  tools: [() => [domSearchTool, domInfoTool]],
}
