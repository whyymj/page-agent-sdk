// dom-edit(capabilities.domEdit):条件注入 / requires 归一 / ReAct 全链(dom_edit 落地 + dom_restore 回滚)/ usageHints 引导
// node e2e 以 Mini DOM 假树驱动工具全链(querySelector(All)/outerHTML 序列化/template 解析回放);浏览器行为在 browser e2e 真跑。
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk } from './_helpers.mjs'
import { StubChatModel } from './_stub-model.mjs'

// ===== Mini DOM 假树(与 selftest sec-128 同面;e2e 无法引 TS 模块,独立精简实现) =====
class MiniEl {
  constructor(tag, attrs = {}) { this.tag = tag; this.attrs = { ...attrs }; this.kids = []; this.text = ''; this.style = {}; this.parent = null; this.scrolled = 0 }
  get classList() {
    const self = this
    const list = () => (self.attrs.class ? self.attrs.class.split(/\s+/).filter(Boolean) : [])
    return {
      add: (...cs) => { const s = new Set(list()); cs.forEach((c) => s.add(c)); self.attrs.class = [...s].join(' ') },
      remove: (...cs) => { const s = new Set(list()); cs.forEach((c) => s.delete(c)); if (s.size) self.attrs.class = [...s].join(' '); else delete self.attrs.class },
    }
  }
  get outerHTML() {
    const styleStr = Object.entries(this.style).map(([k, v]) => `${k}:${v}`).join(';')
    const attrStr = Object.entries({ ...this.attrs, ...(styleStr ? { style: styleStr } : {}) }).map(([k, v]) => `${k}="${v}"`).join(' ')
    return `<${this.tag}${attrStr ? ' ' + attrStr : ''}>${this.text || ''}${this.kids.map((k) => k.outerHTML).join('')}</${this.tag}>`
  }
  set textContent(v) { this.text = v; this.kids = [] }
  get textContent() { return this.text }
  set innerHTML(html) { this.kids = parseHtml(html).map((k) => { k.parent = this; return k }); this.text = '' }
  get innerHTML() { return this.kids.map((k) => k.outerHTML).join('') }
  getAttribute(n) { return n in this.attrs ? this.attrs[n] : null }
  setAttribute(n, v) { this.attrs[n] = v }
  removeAttribute(n) { delete this.attrs[n] }
  get parentElement() { return this.parent }
  contains(el) { for (let p = el; p; p = p.parent) if (p === this) return true; return false }
  closest(sel) { for (const part of sel.split(',')) { const s = part.trim(); if (!s) continue; for (let p = this; p; p = p.parent) if (matches(p, s)) return p } return null }
  remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null }
  prepend(el) { this.adopt(el, 0) }
  appendChild(el) { this.adopt(el, this.kids.length) }
  insertBefore(el, ref) { const i = ref ? this.kids.indexOf(ref) : -1; this.adopt(el, i < 0 ? this.kids.length : i) }
  replaceWith(el) { if (!this.parent) return; const i = this.parent.kids.indexOf(this); this.parent.kids[i] = el; el.parent = this.parent; this.parent = null }
  adopt(el, i) { el.remove(); el.parent = this; this.kids.splice(i, 0, el) }
  scrollIntoView() { this.scrolled++ }
}
function matches(el, sel) {
  const attrSel = sel.match(/^\[([a-zA-Z-]+)="(.*)"\]$/)
  if (attrSel) return el.getAttribute(attrSel[1]) === attrSel[2]
  if (sel.startsWith('#')) return el.getAttribute('id') === sel.slice(1)
  if (sel.startsWith('.')) return (el.getAttribute('class') ?? '').split(/\s+/).includes(sel.slice(1))
  return el.tag === sel
}
function parseHtml(html) {
  const roots = []; const stack = []; let i = 0
  const appendText = (t) => { const p = stack[stack.length - 1]; if (p && t.trim()) p.text += t }
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt < 0) { appendText(html.slice(i)); break }
    if (lt > i) appendText(html.slice(i, lt))
    const gt = html.indexOf('>', lt)
    const raw = html.slice(lt + 1, gt)
    if (raw.startsWith('/')) stack.pop()
    else {
      const m = raw.match(/^([a-zA-Z][a-zA-Z0-9]*)(.*)$/)
      const el = new MiniEl(m[1])
      const attrRe = /([a-zA-Z-]+)="([^"]*)"/g
      let am
      while ((am = attrRe.exec(m[2]))) el.setAttribute(am[1], am[2])
      const parent = stack[stack.length - 1]
      if (parent) { el.parent = parent; parent.kids.push(el) } else roots.push(el)
      stack.push(el)
    }
    i = gt + 1
  }
  return roots
}
/** 安装假 document(返回还原函数);树:body > article > h1 + p#intro + p.target */
function installFakeDom() {
  const realDoc = globalThis.document
  const body = new MiniEl('body')
  const article = new MiniEl('article')
  const h1 = new MiniEl('h1', { id: 'title' }); h1.text = '学习笔记'
  const intro = new MiniEl('p', { id: 'intro' }); intro.text = '注意力机制简介'
  const target = new MiniEl('p', { class: 'target' }); target.text = 'Q/K/V 三元组'
  article.appendChild(h1)   // appendChild 设 parent(kids.push 不设 → replaceWith 静默 no-op 假绿)
  article.appendChild(intro)
  article.appendChild(target)
  body.appendChild(article)
  const qsa = (sel) => {
    const out = []
    const walk = (el) => { if (matches(el, sel)) out.push(el); el.kids.forEach(walk) }
    walk(body)
    if (matches(body, sel)) out.push(body)
    return out
  }
  globalThis.document = {
    addEventListener() {}, removeEventListener() {}, visibilityState: 'visible', title: '学习笔记',
    querySelectorAll: qsa,
    querySelector: (sel) => qsa(sel)[0] ?? null,
    createElement: (tag) => {
      const el = new MiniEl(tag)
      if (tag === 'template') Object.defineProperty(el, 'content', { get() { return { firstElementChild: this.kids[0] ?? null } } })
      return el
    },
  }
  return { restore: () => { globalThis.document = realDoc }, body, target, intro }
}

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx
  const { z } = await import('page-agent-sdk')

  console.log('[e2e:dom-edit] 条件注入:默认关 / requires domInspect / 开启进池')
  {
    const fake = installFakeDom()
    try {
      const sdk = createChatSdk({
        ui: false, id: 'e2e-domedit-off', storage: 'memory', llm: FAKE_LLM, autoTitle: false,
        capabilities: { ...MIN_CAPS, dataOps: false, domInspect: true },  // 只开读不开写
      })
      await sdk.mount()
      assert(!sdk.inspect().tools.some((t) => t.name === 'dom_edit'), '默认(未传 domEdit)→ dom_edit 不在池')
      sdk.unmount()

      const sdk2 = createChatSdk({
        ui: false, id: 'e2e-domedit-noreq', storage: 'memory', llm: FAKE_LLM, autoTitle: false,
        capabilities: { ...MIN_CAPS, dataOps: false, domEdit: true },  // 开写但没开 domInspect → requires 归一关
      })
      await sdk2.mount()
      assert(!sdk2.inspect().tools.some((t) => t.name === 'dom_edit'), 'domEdit:true 但 domInspect 缺 → requires 归一强制关(定位纪律)')
      sdk2.unmount()

      const sdk3 = createChatSdk({
        ui: false, id: 'e2e-domedit-on', storage: 'memory', llm: FAKE_LLM, autoTitle: false,
        capabilities: { ...MIN_CAPS, dataOps: false, domInspect: true, domEdit: true },
      })
      await sdk3.mount()
      const names = sdk3.inspect().tools.map((t) => t.name)
      assert(names.includes('dom_edit') && names.includes('dom_restore'), 'domInspect+domEdit 同开 → dom_edit/dom_restore 进池')
      assert(sdk3.inspect().systemPrompt.includes('dom_edit'), 'usageHints:domEdit 开 → system prompt 含批量编辑引导(勿教不存在的工具的反面:装了就教)')
      sdk3.unmount()
    } finally { fake.restore() }
  }

  console.log('[e2e:dom-edit] ReAct 全链:dom_edit 落地 → dom_restore 回滚(真工具执行,stub 驱动)')
  {
    const fake = installFakeDom()
    try {
      const stub = new StubChatModel([])
      const sdk = createChatSdk({
        ui: false, id: 'e2e-domedit-flow', storage: 'memory', llm: stub, autoTitle: false,
        capabilities: { ...MIN_CAPS, dataOps: false, domInspect: true, domEdit: true },
      })
      await sdk.mount()
      stub.responses.push(
        { toolCalls: [{ name: 'dom_edit', args: { patches: [
          { op: 'set_text', selector: '.target', text: '已改写的内容' },
          { op: 'add_class', selector: '.target', classes: 'ai-marked' },
        ] } }] },
        { toolCalls: [{ name: 'dom_restore', args: {} }] },
        { text: '已高亮并改写了该段,随后按你的要求撤销了。' },
      )
      const toolResults = []
      // send 返回时整链(改→撤销)已跑完,中途 DOM 态经事件时点采样断言(tool_result 到达瞬间读树)
      const domAtEvent = []
      sdk.hook?.((e) => {
        if (e.type === 'tool_result') toolResults.push(e)
        if (e.type === 'tool_result' && (e.name === 'dom_edit' || e.name === 'dom_restore')) {
          const el = globalThis.document.querySelector('.target')
          domAtEvent.push({ after: e.name, text: el?.textContent, cls: el?.getAttribute('class') })
        }
      })
      await sdk.send('把目标段落标出来并改写,然后撤销')
      const editRes = toolResults.find((e) => e.name === 'dom_edit')
      assert(editRes && String(editRes.result).includes('已应用 2 个操作'), 'dom_edit 批量落地 → 工具结果报已应用数')
      const atEdit = domAtEvent.find((d) => d.after === 'dom_edit')
      assert(atEdit?.text === '已改写的内容' && atEdit?.cls?.includes('ai-marked'), 'DOM 真被改(文本+class;事件时点采样)')
      const restoreRes = toolResults.find((e) => e.name === 'dom_restore')
      assert(restoreRes && String(restoreRes.result).includes('已回滚'), 'dom_restore → 回滚最近一批')
      assert(globalThis.document.querySelector('.target').textContent === 'Q/K/V 三元组'
        && !globalThis.document.querySelector('.target').getAttribute('class').includes('ai-marked'), '回滚后 DOM 复原批前态(终态)')
      sdk.unmount()
    } finally { fake.restore() }
  }

  console.log('[e2e:dom-edit] 写纪律:多匹配拒整批 / dryRun 预检 / 危险闸(script 拒)')
  {
    const fake = installFakeDom()
    try {
      const stub = new StubChatModel([])
      const sdk = createChatSdk({
        ui: false, id: 'e2e-domedit-guard', storage: 'memory', llm: stub, autoTitle: false,
        capabilities: { ...MIN_CAPS, dataOps: false, domInspect: true, domEdit: true },
      })
      await sdk.mount()
      stub.responses.push(
        { toolCalls: [{ name: 'dom_edit', args: { patches: [{ op: 'insert', anchor: '#intro', position: 'after', tag: 'script', text: 'alert(1)' }] } }] },
        { toolCalls: [{ name: 'dom_edit', args: { patches: [{ op: 'set_text', selector: 'p', text: 'x' }], dryRun: true } }] },
        { text: 'script 插入被安全闸拦下;p 选择器多匹配也因唯一性纪律被拒。' },
      )
      await sdk.send('插个脚本再改所有段落')
      // ToolMessage 不带 name 字段:从 stub 侧按内容形态断言(ERROR 前缀 + 关键词)
      const toolContents = stub.lastMessages.filter((m) => m?._getType?.() === 'tool').map((m) => String(m.content))
      assert(toolContents.some((c) => c.startsWith('ERROR:') && c.includes('script')), 'insert <script> → 校验失败整批拒(危险闸)')
      assert(toolContents.some((c) => c.startsWith('ERROR:') && (c.includes('未命中') || c.includes('命中'))), 'p 多匹配 → 唯一性纪律回灌(唯一命中要求)')
      assert(globalThis.document.querySelector('.target').textContent === 'Q/K/V 三元组', '整批拒绝 → DOM 零变化')
      sdk.unmount()
    } finally { fake.restore() }
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
