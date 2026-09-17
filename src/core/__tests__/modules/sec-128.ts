/**
 * sec-128 —— dom-edit(DOM 编辑工具族)纯函数面 + 行为面
 *
 * validateDomPatches 危险闸 / 唯一匹配纪律 / 原子批 / dryRun / 快照回滚 roundtrip(Mini DOM 假树,
 * 自带 parse/serialize)/ SDK UI 保护 / 快照超限 / requires 归一 / skill·usageHints 变体(勿教不存在的工具)。
 * 全链浏览器行为(html-to-image 无关,纯 DOM)在 browser e2e docs-demo 真跑。
 */
import { validateDomPatches, createDomEditTools, type DomPatch } from '../../tools/domEdit'
import { makeDomInspectSkill, makePageAnalysisSkill } from '../../tools/domTool'
import { createUsageHintsMiddleware } from '../../harness/usageHints'
import { resolveCapabilities, CAPABILITIES } from '../../capabilities'
import { isZeroEffectiveWrite, buildTurnFactSheet, type TurnToolUsage } from '../../harness/actionGate'
import { effectiveWritePaths, EXCLUDED_WRITE_TOOLS } from '../../harness/readInvalidation'
import { isSuccessfulWriteResult } from '../../harness/writeGate'
import { createComponentWriteGuardMiddleware } from '../../sdk/componentLock'

// ===== Mini DOM 假树(serialize/parse 回环支撑快照 restore 断言) =====
class MiniEl {
  tag: string
  attrs: Record<string, string> = {}
  kids: MiniEl[] = []
  text = ''
  style: Record<string, string> = {}
  parent: MiniEl | null = null
  scrolled = 0
  constructor(tag: string, attrs: Record<string, string> = {}) {
    this.tag = tag
    this.attrs = { ...attrs }
  }
  get classList() {
    const self = this
    const list = () => self.attrs.class ? self.attrs.class.split(/\s+/).filter(Boolean) : []
    return {
      add: (...cs: string[]) => { const s = new Set(list()); cs.forEach((c) => s.add(c)); self.attrs.class = [...s].join(' ') },
      remove: (...cs: string[]) => { const s = new Set(list()); cs.forEach((c) => s.delete(c)); if (s.size) self.attrs.class = [...s].join(' '); else delete self.attrs.class },
    }
  }
  get outerHTML(): string {
    const styleStr = Object.entries(this.style).map(([k, v]) => `${k}:${v}`).join(';')
    const attrStr = Object.entries({ ...this.attrs, ...(styleStr ? { style: styleStr } : {}) })
      .map(([k, v]) => `${k}="${v}"`).join(' ')
    const inner = (this.text || '') + this.kids.map((k) => k.outerHTML).join('')
    return `<${this.tag}${attrStr ? ' ' + attrStr : ''}>${inner}</${this.tag}>`
  }
  set textContent(v: string) { this.text = v; this.kids = [] }
  get textContent() { return this.text }
  set innerHTML(html: string) { this.kids = parseHtml(html).map((k) => { k.parent = this; return k }) ; this.text = '' }
  get innerHTML() { return this.kids.map((k) => k.outerHTML).join('') }
  getAttribute(n: string) { return n in this.attrs ? this.attrs[n] : null }
  setAttribute(n: string, v: string) { this.attrs[n] = v }
  removeAttribute(n: string) { delete this.attrs[n] }
  get parentElement() { return this.parent }
  contains(el: MiniEl | null): boolean {
    for (let p: MiniEl | null = el; p; p = p.parent) if (p === this) return true
    return false
  }
  closest(sel: string): MiniEl | null {
    // 真 Element.closest 支持逗号列表(SDK_UI_SELECTOR 即逗号串);假树按段拆分逐一匹配
    for (const part of sel.split(',')) {
      const s = part.trim()
      if (!s) continue
      for (let p: MiniEl | null = this; p; p = p.parent) if (matches(p, s)) return p
    }
    return null
  }
  remove() { if (this.parent) this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null }
  prepend(el: MiniEl) { this.adopt(el, 0) }
  appendChild(el: MiniEl) { this.adopt(el, this.kids.length) }
  insertBefore(el: MiniEl, ref: MiniEl | null) {
    const i = ref ? this.kids.indexOf(ref) : -1
    this.adopt(el, i < 0 ? this.kids.length : i)
  }
  replaceWith(el: MiniEl) {
    if (!this.parent) return
    const i = this.parent.kids.indexOf(this)
    this.parent.kids[i] = el
    el.parent = this.parent
    this.parent = null
  }
  private adopt(el: MiniEl, i: number) { el.remove(); el.parent = this; this.kids.splice(i, 0, el) }
  scrollIntoView() { this.scrolled++ }
}
function matches(el: MiniEl, sel: string): boolean {
  const attrSel = sel.match(/^\[([a-zA-Z-]+)="(.*)"\]$/)
  if (attrSel) return el.getAttribute(attrSel[1]) === attrSel[2]
  if (sel.startsWith('#')) return el.getAttribute('id') === sel.slice(1)
  if (sel.startsWith('.')) return (el.getAttribute('class') ?? '').split(/\s+/).includes(sel.slice(1))
  return el.tag === sel
}
/** 迷你 HTML 解析器(测试树无自闭合/无嵌套文本边界需求;支持单层属性) */
function parseHtml(html: string): MiniEl[] {
  const roots: MiniEl[] = []
  const stack: MiniEl[] = []
  let i = 0
  const pushNode = (el: MiniEl) => {
    const parent = stack[stack.length - 1]
    if (parent) { el.parent = parent; parent.kids.push(el) } else roots.push(el)
    stack.push(el)
  }
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt < 0) { appendText(html.slice(i)); break }
    if (lt > i) appendText(html.slice(i, lt))
    const gt = html.indexOf('>', lt)
    const raw = html.slice(lt + 1, gt)
    if (raw.startsWith('/')) { stack.pop() } else {
      const m = raw.match(/^([a-zA-Z][a-zA-Z0-9]*)(.*)$/)!
      const el = new MiniEl(m[1])
      const attrRe = /([a-zA-Z-]+)="([^"]*)"/g
      let am: RegExpExecArray | null
      while ((am = attrRe.exec(m[2]))) el.setAttribute(am[1], am[2])
      pushNode(el)
    }
    i = gt + 1
  }
  function appendText(t: string) {
    const parent = stack[stack.length - 1]
    if (parent && t.trim()) parent.text += t
  }
  return roots
}
/** 假 document(dom_edit 交互面:querySelectorAll + createElement(template 特判 content)) */
function makeDoc(body: MiniEl) {
  const doc = {
    querySelectorAll(sel: string): MiniEl[] {
      const out: MiniEl[] = []
      const walk = (el: MiniEl) => { if (matches(el, sel)) out.push(el); el.kids.forEach(walk) }
      walk(body)
      if (matches(body, sel)) out.push(body)
      return out
    },
    querySelector(sel: string): MiniEl | null { return doc.querySelectorAll(sel)[0] ?? null },
    createElement(tag: string): MiniEl & { content?: { firstElementChild: MiniEl | null } } {
      const el = new MiniEl(tag)
      if (tag === 'template') {
        Object.defineProperty(el, 'content', {
          get(this: MiniEl) { return { firstElementChild: this.kids[0] ?? null } },
        })
      }
      return el as never
    },
  }
  return doc
}
/** 标准测试树:article > h1 + p#intro + div.content > p.target ×1 + span.tip */
function makeTree() {
  const body = new MiniEl('body')
  const article = new MiniEl('article')
  article.kids.push(new MiniEl('h1', { id: 'title' }))
  const intro = new MiniEl('p', { id: 'intro' })
  intro.text = '注意力机制简介'
  article.kids.push(intro)
  const content = new MiniEl('div', { class: 'content' })
  const target = new MiniEl('p', { class: 'target' })
  target.text = 'Q/K/V 三元组'
  const tip = new MiniEl('span', { class: 'tip' })
  tip.text = '脚注'
  content.kids.push(target, tip)
  article.kids.push(content)
  body.kids.push(article)
  const link = (el: MiniEl, parent: MiniEl | null) => { el.parent = parent; el.kids.forEach((k) => link(k, el)) }
  link(body, null)
  return { body, article, intro, content, target, tip }
}

export async function run(ctx: { assert: (cond: boolean, msg: string) => void }): Promise<void> {
  const { assert } = ctx

  // ---- validateDomPatches 危险闸(纯函数,不碰 DOM) ----
  assert(validateDomPatches([{ op: 'set_text', selector: '.a', text: 'x' } as DomPatch]).length === 0, '✓ 合法批 → 零错误')
  assert(validateDomPatches([{ op: 'insert', anchor: '.a', position: 'append', tag: 'script' } as DomPatch])[0].includes('script'), '✓ insert script 标签 → 拒(可执行面)')
  assert(validateDomPatches([{ op: 'set_attr', selector: '.a', name: 'onclick', value: 'x' } as DomPatch])[0].includes('事件属性'), '✓ set_attr on* → 拒(内联脚本)')
  assert(validateDomPatches([{ op: 'insert', anchor: '.a', position: 'append', tag: 'a', attrs: { href: 'javascript:alert(1)' } } as DomPatch])[0].includes('javascript'), '✓ javascript: URL → 拒')
  assert(validateDomPatches([{ op: 'insert', anchor: '.a', position: 'append', tag: 'div', text: 'a', html: 'b' } as DomPatch])[0].includes('二选一'), '✓ insert text+html 同传 → 拒')

  // ---- requires 归一 + 注册表计数 ----
  assert(CAPABILITIES.length === 20, '✓ capabilities 注册表 → 20 开关(domEdit 入册)')
  assert(resolveCapabilities({ domInspect: true, domEdit: true }).domEdit === true, '✓ domEdit opt-in:domInspect+domEdit 同开 → true')
  assert(resolveCapabilities({ domEdit: true }).domEdit === false, '✓ requires 归一:domEdit 开但 domInspect 缺 → 强制关(定位纪律)')

  // ---- 行为面(Mini DOM):唯一匹配 / 原子 / dryRun / 快照回滚 ----
  {
    const t = makeTree()
    const doc = makeDoc(t.body)
    const [domEdit, domRestore] = createDomEditTools({ getDocument: () => doc as never })

    // node 守卫(工厂外无 document 场景):getDocument 返回 null → 可读 ERROR
    const [ne] = createDomEditTools({ getDocument: () => null })
    assert(String(await ne.invoke({ patches: [{ op: 'set_text', selector: '.a', text: 'x' }] as never }, {})).startsWith('ERROR: dom_edit 仅在浏览器'), '✓ node/无 DOM 守卫 → 可读 ERROR 文案')

    // set_text 落地 + 结果文案
    const r1 = String(await domEdit.invoke({ patches: [{ op: 'set_text', selector: '.target', text: '已更新' } as never] }, {}))
    assert(!r1.startsWith('ERROR') && t.target.text === '已更新', '✓ set_text 唯一命中 → 落地')
    assert(r1.includes('dom_restore'), '✓ 结果文案引导回滚出口')

    // 唯一匹配纪律:两个 .p 时拒(tree 只有 1 个 .target,加一个)
    const t2 = t.content.kids[0] as MiniEl
    const dup = new MiniEl('p', { class: 'target extra' })
    dup.text = '重复目标'
    t.content.appendChild(dup)
    const before = t2.text
    const r2 = String(await domEdit.invoke({ patches: [{ op: 'set_text', selector: '.target', text: '不应生效' } as never] }, {}))
    assert(r2.startsWith('ERROR') && r2.includes('命中 2 个') && t2.text === before, '✓ selector 多匹配 → 整批拒 + DOM 零变化')
    dup.remove() // 清理重复节点(恢复 .target 唯一,后续用例不受污染)

    // 原子批:第二个 selector 未命中 → 第一个也不应用
    const r3 = String(await domEdit.invoke({ patches: [
      { op: 'add_class', selector: '.tip', classes: 'marked' } as never,
      { op: 'set_text', selector: '.noexist', text: 'x' } as never,
    ] }, {}))
    assert(r3.startsWith('ERROR') && r3.includes('整批拒绝') && !t.tip.getAttribute('class').includes('marked'), '✓ 原子批:任一未命中 → 整批拒绝零部分应用')

    // dryRun:校验通过但不落地
    const r4 = String(await domEdit.invoke({ patches: [{ op: 'set_text', selector: '.tip', text: 'dry' } as never], dryRun: true }, {}))
    assert(r4.includes('dryRun 通过') && t.tip.text === '脚注', '✓ dryRun → 计划可应用但 DOM 不变')

    // 快照回滚 roundtrip:set_text + add_class 同批同根 → restore 复原批前态
    // 注意:restore 走 outerHTML 回放(replaceWith),元素身份不保留 —— 断言一律经 doc 重查,不持旧引用
    await domEdit.invoke({ patches: [
      { op: 'set_text', selector: '.tip', text: '改后文案' } as never,
      { op: 'add_class', selector: '.tip', classes: 'hl' } as never,
    ] }, {})
    const tipEdited = doc.querySelector('.tip') as MiniEl
    assert(tipEdited.text === '改后文案' && tipEdited.getAttribute('class').includes('hl'), '✓ 同批两 op 同根叠加生效')
    const rr = String(await domRestore.invoke({}, {}))
    const tipRestored = doc.querySelector('.tip') as MiniEl
    assert(rr.includes('已回滚') && tipRestored.text === '脚注' && !tipRestored.getAttribute('class').includes('hl'), '✓ dom_restore → 复原批前首态(文本+class 都回)')

    // remove → restore roundtrip(结构类:快照父容器)
    const tipHtml = (doc.querySelector('.tip') as MiniEl).outerHTML
    await domEdit.invoke({ patches: [{ op: 'remove', selector: '.tip' } as never] }, {})
    assert(!doc.querySelector('.tip'), '✓ remove → 元素移除')
    await domRestore.invoke({}, {})
    assert((doc.querySelector('.tip') as MiniEl)?.outerHTML === tipHtml, '✓ remove 后 restore → 结构复原(outerHTML 等价)')

    // move:层级调整 + restore
    await domEdit.invoke({ patches: [{ op: 'move', selector: '.tip', to: '#intro', position: 'append' } as never] }, {})
    const introNow = doc.querySelector('#intro') as MiniEl
    assert(introNow.kids.length === 1 && introNow.kids[0].getAttribute('class').includes('tip'), '✓ move → 元素换父(层级嵌套调整)')
    await domRestore.invoke({}, {})
    const introBack = doc.querySelector('#intro') as MiniEl
    const tipBack = doc.querySelector('.tip') as MiniEl
    assert(introBack.kids.length === 0 && !!tipBack && tipBack.parent?.getAttribute('class')?.includes('content'), '✓ move 后 restore → 双端复原(tip 回到 .content 下)')

    // highlight:样式 + 滚动定位
    await domEdit.invoke({ patches: [{ op: 'highlight', selector: '.target', color: '#ff0', note: '这里是关键' } as never] }, {})
    const targetEl = doc.querySelector('.target') as MiniEl
    assert(targetEl.style.backgroundColor === '#ff0' && targetEl.scrolled === 1 && targetEl.getAttribute('title') === '这里是关键', '✓ highlight → 背景色+outline 滚动定位+浮注')

    // SDK UI 保护:目标在 .chat-dialog 内 → 拒
    const dialog = new MiniEl('div', { class: 'chat-dialog' })
    const inner = new MiniEl('button', { class: 'dlg-btn' })
    inner.text = '对话框按钮'
    dialog.appendChild(inner)
    t.body.appendChild(dialog)
    const r9 = String(await domEdit.invoke({ patches: [{ op: 'set_text', selector: '.dlg-btn', text: 'x' } as never] }, {}))
    assert(r9.startsWith('ERROR') && r9.includes('SDK 对话框'), '✓ SDK UI 内目标 → 拒(防改坏自身 UI)')
    dialog.remove()

    // 快照超限:巨文本子树 → 拒 + 引导缩小
    const big = new MiniEl('p', { class: 'big' })
    big.text = 'x'.repeat(300 * 1024)
    t.body.appendChild(big)
    const r10 = String(await domEdit.invoke({ patches: [{ op: 'set_text', selector: '.big', text: 'y' } as never] }, {}))
    assert(r10.startsWith('ERROR') && r10.includes('快照超限') && r10.includes('缩小 selector'), '✓ 快照超 256KB → 拒 + 引导缩小范围')
    big.remove()

    // restore 栈耗尽(此前各段遗留批也一并清空,最终必达「无可用快照」)
    let r11 = ''
    for (let i = 0; i < 6; i++) {
      r11 = String(await domRestore.invoke({}, {}))
      if (r11.includes('无可用快照')) break
    }
    assert(r11.includes('无可用快照'), '✓ 快照栈空 → 如实报告(不再回滚)')
  }

  // ---- skill / usageHints 变体(勿教不存在的工具) ----
  {
    const di = makeDomInspectSkill({ withDomEdit: true }).getContent()
    assert(di.includes('dom_edit') && di.includes('写纪律'), '✓ dom-inspect skill withDomEdit → 含编辑用法段 + 写纪律')
    assert(!makeDomInspectSkill().getContent().includes('dom_edit'), '✓ dom-inspect 基础变体不教 dom_edit(未装配)')
    const pa = makePageAnalysisSkill({ withDomEdit: true }).getContent()
    assert(pa.includes('操作类') && pa.includes('dom_restore'), '✓ page-analysis withDomEdit → 问题分型含操作类路线 + 回滚纪律')
    assert(!makePageAnalysisSkill().getContent().includes('dom_edit'), '✓ page-analysis 基础变体不教编辑(未装配)')
    const withEdit = createUsageHintsMiddleware({ domInspect: true, domEdit: true } as never, false)
    assert((withEdit.augmentPrompt?.(undefined as never) ?? '').includes('dom_edit'), '✓ usageHints domEdit flag 开 → 教批量编辑')
    const noEdit = createUsageHintsMiddleware({ domInspect: true } as never, false)
    assert(!(noEdit.augmentPrompt?.(undefined as never) ?? '').includes('dom_edit'), '✓ usageHints 未开 domEdit → 不教')
  }

  // ---- 兼容性回归(2026-09-17 审查驱动:dom_edit 标 writeCapable 后与既有守卫的交互)----
  {
    const [domEditTool, domRestoreTool] = createDomEditTools({ getDocument: () => null })
    // ① writeCapable 标注(单一真相源:zero-tool 门禁计等效写 / 子 agent 授权剥离 / isSuccessfulWriteResult)
    assert((domEditTool as { writeCapable?: unknown }).writeCapable === true, '✓ dom_edit 标 writeCapable(zero-tool 门禁认它为「真干了活」)')
    assert((domRestoreTool as { writeCapable?: unknown }).writeCapable === true, '✓ dom_restore 标 writeCapable(同口径)')

    // ② stale-read 排除:selector 非数据 jsonPath,不排除会落 ROOT 误失效全部数据读
    assert(EXCLUDED_WRITE_TOOLS.has('dom_edit') && EXCLUDED_WRITE_TOOLS.has('dom_restore'), '✓ dom_edit/dom_restore 在 EXCLUDED_WRITE_TOOLS(与 resource_* 同构)')
    const eff = effectiveWritePaths({ name: 'dom_edit', args: { patches: [{ op: 'highlight', selector: '.docs-table' }] } })
    assert(eff === null, '✓ effectiveWritePaths(dom_edit) → null(不落 ROOT,不污染 stale-read 失效面 / evidence 审计基线)')

    // ③ zero-tool 门禁:dom_edit 计「等效写」→ 不误判「零等效写」回灌(修前「把配置表格高亮」类指令被误判谎报)
    const tools = [domEditTool, domRestoreTool] as Array<{ name: string; writeCapable?: unknown }>
    const isWriteTool = (name: string): boolean => {
      const t = tools.find((x) => x.name === name)
      if (t && 'writeCapable' in t) return typeof t.writeCapable === 'function' ? true : t.writeCapable === true
      return false
    }
    const usage: TurnToolUsage = { counts: { dom_edit: 1 }, writePaths: [], failures: 0 }
    assert(isZeroEffectiveWrite(usage, isWriteTool) === false, '✓ dom_edit×1 → 非零等效写(zero-tool 门禁不误触发)')
    // 回归对照:若 dom_edit 未被认作写(标记缺失),同 usage 会被判零等效写 → 门禁误触发
    assert(isZeroEffectiveWrite(usage, () => false) === true, '✓ 对照:无 writeCapable 标记则误判零等效写(证明标记是修复关键)')
    // 成功写判定(writeGate):dom_edit 成功 → 计为成功写(供 turnUsage)
    assert(isSuccessfulWriteResult(domEditTool as never, { patches: [{ op: 'highlight', selector: '.x' }] }, { content: '已应用 1 个操作', status: 'done' }) === true, '✓ isSuccessfulWriteResult(dom_edit 成功) → true')
    // 事实清单不谎报「成功写入路径」(dom_edit 无数据路径,writePaths 空 → 显示「无」)
    assert(buildTurnFactSheet({ counts: { dom_edit: 1 }, writePaths: [], failures: 0 }, [], isWriteTool).includes('成功写入路径:无'), '✓ 事实清单:dom_edit 不产生数据写路径(显示「无」,不谎报)')

    // ④ componentWriteGuard:dom_edit 改宿主 DOM 非数据组件路径,委派在途锁定期间不应被误拒 COMPONENT_LOCKED
    const guard = createComponentWriteGuardMiddleware({
      getBind: () => ({ components: [{ name: '英雄区', code: '<div/>' }] }),
      writablePaths: ['components'],
      getLocked: () => ({ '英雄区': 'task-1' }),  // 委派在途,组件被锁
      getCodeFieldPaths: () => ['components.0.code'],
      tools: [domEditTool, domRestoreTool] as never,
    })
    let nextCalled = false
    const guardResult = await guard.wrapToolCall!(
      { name: 'dom_edit', args: { patches: [{ op: 'highlight', selector: '.docs-table' }] } } as never,
      (async () => { nextCalled = true; return { content: 'PASSED', status: 'done' as const } }) as never,
    )
    assert(nextCalled && (guardResult as { content?: string })?.content === 'PASSED', '✓ 委派在途锁定期间 dom_edit 放行(不受组件锁约束;修前误拒 COMPONENT_LOCKED「整体 set」)')
  }
}
