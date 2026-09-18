/**
 * sec-131:S4 引用 DOM 锚点(host-integration-contract,quoteInput 纯函数白盒)
 * 覆盖:buildQuoteSelector(id 命中/nth-of-type 链/深度上限)/ findBlockAncestor(行内爬块级)/
 * measureQuoteOffset(indexOf 降级 + Range 精确 + occurrence 消歧)/ normalizeQuoteAnchor(归一+非法丢弃)/
 * appendQuoteContext 元信息行(带/无锚点;无锚点逐字节回归锁;pageUrl 跨文档标警示)/
 * captureSelectionQuote 集成(duck-typing 桩:锚点字段齐/无效选区 null)。
 */
import type { TestCtx } from './_ctx'
import {
  appendQuoteContext, findBlockAncestor, buildQuoteSelector, measureQuoteOffset,
  normalizeQuoteAnchor, captureSelectionQuote, findNearestHeadingEl,
} from '../../tools/quoteInput'

/** 最小元素桩(tagName/id/parent/children/textContent/compareDocumentPosition 按文档序注册表) */
interface FakeEl {
  tagName: string
  id?: string
  parentElement: FakeEl | null
  children: FakeEl[]
  textContent?: string
  compareDocumentPosition?: (other: FakeEl) => number
}
/** 文档序注册表(compareDocumentPosition 据此判 PRECEDING=2/FOLLOWING=4) */
const ordered: FakeEl[] = []
const el = (tagName: string, textContent?: string, id?: string): FakeEl => {
  const n: FakeEl = { tagName, id, parentElement: null, children: [], textContent }
  n.compareDocumentPosition = (other) => (ordered.indexOf(other) < ordered.indexOf(n) ? 2 : 4)
  ordered.push(n)
  return n
}
const link = (parent: FakeEl, ...kids: FakeEl[]): FakeEl => {
  for (const k of kids) { k.parentElement = parent; parent.children.push(k) }
  return kids[0]
}

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // ===== buildQuoteSelector:id 命中即止 / nth-of-type 链 / 深度 ≤4 =====
  {
    const withId = el('p', undefined, 'intro')
    assert(buildQuoteSelector(withId) === 'p#intro', `id 命中 → 'p#intro'(实际 ${buildQuoteSelector(withId)})`)
    const esc = el('p', undefined, 'a.b:c')
    assert(buildQuoteSelector(esc) === 'p#a\\.b\\:c', `id 特殊字符转义(实际 ${buildQuoteSelector(esc)})`)
    const root = el('section')
    const p1 = el('p'); const p2 = el('p')
    link(root, p1, el('p'), p2)
    assert(buildQuoteSelector(p2) === 'section > p:nth-of-type(3)', `同类多个 → nth-of-type 按 children 序(实际 ${buildQuoteSelector(p2)})`)
    assert(buildQuoteSelector(p1) === 'section > p:nth-of-type(1)', `首个同类 → nth-of-type(1)(实际 ${buildQuoteSelector(p1)})`)
  }

  // ===== findBlockAncestor:行内元素向上爬到块级 =====
  {
    const p = el('p'); const span = el('span'); const strong = el('strong')
    link(p, span); link(span, strong)
    assert(findBlockAncestor(strong) === p, '行内三层(span>strong)→ 爬到块级 p')
    assert(findBlockAncestor(p) === p, '块级自身 → 原样返回')
    assert(findBlockAncestor(null) === null, 'null → null')
  }

  // ===== measureQuoteOffset:indexOf 降级 / occurrence 消歧 / Range 精确 =====
  {
    const r1 = measureQuoteOffset('前置文字。目标短语在后。目标短语再出现。', '目标短语在后')
    assert(r1.offset === 5 && r1.occurrence === 1, `indexOf 降级 + 首次出现(实际 ${JSON.stringify(r1)})`)
    const r2 = measureQuoteOffset('重复片段。重复片段。之后。', '重复片段', { startContainer: { nodeType: 3, textContent: '重复片段。重复片段。之后。' }, startOffset: 5 })
    assert(r2.offset === 5 && r2.occurrence === 2, `重复短语 + Range 落在第二次 → occurrence=2(indexOf 降级恒首次,消歧只在精确路径生效;实际 ${JSON.stringify(r2)})`)
    const r3 = measureQuoteOffset('abc', 'xyz')
    assert(r3.offset === undefined && r3.occurrence === undefined, '块内无该文本 → 双空(不捏造)')
    const r4 = measureQuoteOffset('块文本很长,起点在后面。', '起点', { startContainer: { nodeType: 3, textContent: '块文本很长,起点在后面。' }, startOffset: 10 })
    assert(r4.offset === 10, `Range 精确(text 节点 + startOffset;实际 ${r4.offset})`)
    const r5 = measureQuoteOffset('', 'x')
    assert(r5.offset === undefined, '空块 → 空')
  }

  // ===== normalizeQuoteAnchor:归一 + 非法丢弃 =====
  {
    const a = normalizeQuoteAnchor({ selector: '  #content > p  ', blockIndex: 2.7, offset: -3, occurrence: 'x' as unknown as number, heading: ' 0.1 概述 ', docId: 'guide' })
    assert(a?.selector === '#content > p' && a?.blockIndex === 2 && a?.heading === '0.1 概述' && a?.docId === 'guide', `归一:trim/取整/保真(实际 ${JSON.stringify(a)})`)
    assert(a && !('offset' in a) && !('occurrence' in a), '负数/非数值 offset·occurrence 丢弃')
    assert(normalizeQuoteAnchor(undefined) === undefined && normalizeQuoteAnchor({}) === undefined, '空入参/全非法 → undefined')
  }

  // ===== appendQuoteContext:无锚点逐字节回归锁 + 元信息行 + 跨文档警示 =====
  {
    const plain = appendQuoteContext('这是什么?', { text: '引用的文字', source: '页面 · 小节' })
    const expected = '[引用原文(来源:页面 · 小节)]\n"""\n引用的文字\n"""\n\n这是什么?'
    assert(plain === expected, `无锚点 → 与既有形态逐字节一致(回归锁)`)
    const plain2 = appendQuoteContext('这是什么?', { text: '引用的文字' })
    assert(plain2 === '[引用原文]\n"""\n引用的文字\n"""\n\n这是什么?', '无 source 无锚点 → 最简形态一致')
    const withAnchor = appendQuoteContext('这是什么?', {
      text: '引用的文字', source: '页面 · 小节',
      anchor: { selector: '#content > p:nth-of-type(3)', heading: '0.1 概述', offset: 12, occurrence: 2 },
    })
    assert(withAnchor.includes('[位置: #content > p:nth-of-type(3) · 小节「0.1 概述」](偏移 12, 第 2 次出现)'),
      `元信息行:selector + 小节 + 偏移/序号(实际:${withAnchor.split('\n')[3] ?? ''})`)
    assert(!withAnchor.includes('锚点属于另一文档'), 'pageUrl 缺失 → 不做跨文档比对(node 无 location)或一致 → 无警示')
    const docIdAnchor = appendQuoteContext('?', { text: 't', anchor: { selector: '#p', docId: 'future-guide' } })
    assert(docIdAnchor.includes('[位置: #p · 文档:future-guide]') && !docIdAnchor.includes('偏移'), 'docId 进元信息行;无 offset 不带括注')
  }

  // ===== captureSelectionQuote 集成:锚点字段齐 / 无效选区 null =====
  {
    const h2 = el('h2', '0.1 单页学习门户'); h2.id = 's01'
    const container = el('div'); container.id = 'content'
    const p = el('p', '这是第一段,包含被引用的句子。这句话会被选中提问。')
    link(container, h2, p)
    const fakeDoc = {
      title: '学习导航',
      location: { href: 'https://x.dev/#/doc/a' },
      querySelectorAll: (sel: string) => (sel.includes('h1') ? [h2] : []),
      getSelection: () => ({
        isCollapsed: false,
        anchorNode: { nodeType: 3, textContent: '这是第一段,包含被引用的句子。这句话会被选中提问。', parentElement: p } as unknown as Node,
        toString: () => '这句话会被选中提问。',
        getRangeAt: () => ({ startContainer: { nodeType: 3, textContent: '这是第一段,包含被引用的句子。这句话会被选中提问。' }, startOffset: 17 }),
      }),
    }
    const q = captureSelectionQuote(fakeDoc)
    assert(!!q?.text && q.text === '这句话会被选中提问。', `文本捕获(实际 ${q?.text})`)
    assert(q?.source === '学习导航 · 0.1 单页学习门户', `来源推导含最近标题(实际 ${q?.source})`)
    const a = q?.anchor
    assert(a?.selector === 'div#content > p', `锚点 selector:块级 p 于 id 容器内(实际 ${a?.selector})`)
    assert(a?.heading === '0.1 单页学习门户' && a?.headingId === 's01', `锚点 heading 文本+id(实际 ${a?.heading}/${a?.headingId})`)
    assert(a?.blockIndex === 1, `blockIndex:h2=0, p=1(实际 ${a?.blockIndex})`)
    assert(a?.offset === 17, `offset:Range 精确(实际 ${a?.offset})`)
    assert(a?.pageUrl === 'https://x.dev/#/doc/a', `pageUrl 记录捕获时 URL(实际 ${a?.pageUrl})`)
    assert(findNearestHeadingEl(p, (s) => (s.includes('h1') ? [h2] : [])) === h2, 'findNearestHeadingEl 元素版返回标题元素')
    // 无效选区:塌缩 → null
    const collapsed = captureSelectionQuote({ getSelection: () => ({ isCollapsed: true, toString: () => '' }) })
    assert(collapsed === null, '塌缩选区 → null')
  }
}
