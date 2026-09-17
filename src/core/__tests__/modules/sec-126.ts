/**
 * sec-126 —— page-quote 划词引用 + pageContext 页面锚点(纯函数面)
 *
 * quoteInput 纯函数族(appendQuoteContext/normalizeQuoteText/findNearestHeading/deriveQuoteSource/
 * captureSelectionQuote)+ sdkDom 判定 + pageContext 中间件 + capabilities 开关注册。
 * DOM 依赖全部 duck-typing 假对象(node 无 document);read_page 提取面在 sec-127?不,同模块下段
 * (extractPageText/pickContentRoot)由 read_page 批次补入本文件(同文件追加,编号不复用)。
 */
import { appendQuoteContext, normalizeQuoteText, findNearestHeading, deriveQuoteSource, captureSelectionQuote, computeSelectionMenuPosition, QUOTE_MAX_CHARS } from '../../tools/quoteInput'
import { isInsideSdkUi, SDK_UI_SELECTOR } from '../../utils/sdkDom'
import { createPageContextMiddleware } from '../../harness/pageContext'
import { resolveCapabilities } from '../../capabilities'
import { pickContentRoot, extractPageText } from '../../tools/domTool'

/** 假元素:按数组序模拟文档序(compareDocumentPosition 位语义;closest 可注入) */
function fakeEl(i: number, text: string, closestResult: Element | null = null): Element {
  return {
    textContent: text,
    compareDocumentPosition: (other: { __i?: number }) => {
      const oi = (other as { __i: number }).__i ?? i
      return oi < i ? 2 : 4 // 2=PRECEDING(对方在前) 4=FOLLOWING(对方在后)
    },
    closest: () => closestResult,
    __i: i,
  } as unknown as Element
}

export async function run(ctx: { assert: (cond: boolean, msg: string) => void }): Promise<void> {
  const { assert } = ctx

  // ---- appendQuoteContext(toLC 注入形态) ----
  assert(appendQuoteContext('这是什么', undefined) === '这是什么', '✓ appendQuoteContext 无 quote 原样返回')
  assert(appendQuoteContext('这是什么', { text: '' }) === '这是什么', '✓ appendQuoteContext 空文本原样返回(防御)')
  const withSrc = appendQuoteContext('这是什么', { text: '引用内容', source: '页面A · 第二节' })
  assert(withSrc.startsWith('[引用原文(来源:页面A · 第二节)]\n"""\n引用内容\n"""\n\n这是什么'), '✓ appendQuoteContext 有 source 前缀块 + 用户 content 收尾')
  const noSrc = appendQuoteContext('Q', { text: 'T' })
  assert(noSrc.startsWith('[引用原文]\n"""\nT\n"""\n\nQ'), '✓ appendQuoteContext 无 source 简洁标签')
  assert(appendQuoteContext('', { text: 'T' }) === '[引用原文]\n"""\nT\n"""\n\n', '✓ appendQuoteContext 空 content 只剩引用块(UI 层纯 quote 不可发送,此处为兜底形态)')

  // ---- normalizeQuoteText(归一 + 截断) ----
  assert(normalizeQuoteText('  a\r\n\r\n\r\n\r\nb  ') === 'a\n\nb', '✓ normalizeQuoteText CRLF 归一 + 3+ 空行折叠为 2 + trim')
  assert(normalizeQuoteText('x'.repeat(QUOTE_MAX_CHARS + 500)).length === QUOTE_MAX_CHARS, '✓ normalizeQuoteText 截断上限 2000(防整页选区灌爆)')

  // ---- findNearestHeading / deriveQuoteSource(假文档序) ----
  const h1 = { ...fakeEl(0, '总标题'), __i: 0 } as unknown as Element
  const h2a = { ...fakeEl(2, '第一节'), __i: 2 } as unknown as Element
  const h2b = { ...fakeEl(5, '第二节'), __i: 5 } as unknown as Element
  const headings = [h1, h2a, h2b]
  const selEl = fakeEl(7, '选区所在段落')
  const q = () => headings
  assert(findNearestHeading(selEl, q) === '第二节', '✓ findNearestHeading 取「在前且最近」的标题(第二节而非第一节)')
  assert(findNearestHeading(fakeEl(1, ''), q) === '总标题', '✓ findNearestHeading 序在两标题之间取紧邻在前者')
  assert(findNearestHeading(fakeEl(0, '最前'), q) === undefined, '✓ findNearestHeading 无前序标题 → undefined')
  assert(findNearestHeading(null, q) === undefined, '✓ findNearestHeading 空元素 → undefined')
  assert(deriveQuoteSource(selEl, '页面A', q) === '页面A · 第二节', '✓ deriveQuoteSource 组合 pageTitle · 最近标题')
  assert(deriveQuoteSource(null, '页面A', q) === '页面A', '✓ deriveQuoteSource 无元素锚回落 pageTitle')
  const longHeading = Array.from({ length: headings.length }, (_, k) => ({ ...fakeEl(k, '很'.repeat(80) + k, null), __i: k })) as unknown as Element[]
  assert(deriveQuoteSource(fakeEl(99, 'x'), 'P', () => longHeading).endsWith('…') === false && deriveQuoteSource(fakeEl(99, 'x'), 'P', () => longHeading).length <= 'P · '.length + 60 + 3, '✓ deriveQuoteSource 标题截 60 字')
  assert(deriveQuoteSource(fakeEl(99, 'x'), 'P') === 'P' || deriveQuoteSource(fakeEl(99, 'x'), 'P', undefined) === 'P', '✓ deriveQuoteSource node 无 document 且未注入 queryAll → 回落 pageTitle 不崩')

  // ---- isInsideSdkUi ----
  assert(SDK_UI_SELECTOR.includes('.chat-dialog') && SDK_UI_SELECTOR.includes('.debug-drawer') && SDK_UI_SELECTOR.includes('.skill-panel') && SDK_UI_SELECTOR.includes('.chat-selection-menu'), '✓ SDK_UI_SELECTOR 含对话框 + Teleport 浮层 + 划词浮动菜单')
  assert(isInsideSdkUi(fakeEl(0, '', fakeEl(9, 'dialog'))) === true, '✓ isInsideSdkUi 命中 SDK 子树 → true')
  assert(isInsideSdkUi(fakeEl(0, '', null)) === false, '✓ isInsideSdkUi 宿主内容 → false')
  assert(isInsideSdkUi(null) === false, '✓ isInsideSdkUi 空元素安全')

  // ---- computeSelectionMenuPosition(浮动菜单定位纯函数) ----
  const above = computeSelectionMenuPosition({ top: 300, bottom: 340, left: 400, width: 120 }, { w: 1000, h: 800 }, { w: 128, h: 30 })
  assert(above.placement === 'above' && above.top === 300 - 30 - 8 && above.left === 400 + 60 - 64, '✓ 菜单定位:上方优先 + 选区水平居中')
  const below = computeSelectionMenuPosition({ top: 10, bottom: 50, left: 100, width: 40 }, { w: 1000, h: 800 }, { w: 128, h: 30 })
  assert(below.placement === 'below' && below.top === 50 + 8, '✓ 菜单定位:顶部不够翻到下方')
  const clamped = computeSelectionMenuPosition({ top: 300, bottom: 340, left: -50, width: 20 }, { w: 200, h: 800 }, { w: 128, h: 30 })
  assert(clamped.left === 8, '✓ 菜单定位:视口左缘钳制(MARGIN=8)')
  const clampedR = computeSelectionMenuPosition({ top: 300, bottom: 340, left: 180, width: 20 }, { w: 200, h: 800 }, { w: 128, h: 30 })
  assert(clampedR.left === 200 - 128 - 8, '✓ 菜单定位:视口右缘钳制')

  // ---- captureSelectionQuote(duck-typing 假 doc) ----
  const mkDoc = (sel: unknown, headingsArr?: Element[]) => ({
    title: ' 学习笔记 ',
    getSelection: () => sel,
    ...(headingsArr ? { querySelectorAll: (s: string) => (s.startsWith('h') ? headingsArr : []) } : {}),
  })
  const goodSel = { isCollapsed: false, anchorNode: { ...fakeEl(7, '选区段落'), nodeType: 1, parentElement: null }, toString: () => '  引用\n\n\n\n正文  ' }
  const got = captureSelectionQuote(mkDoc(goodSel, headings) as never)
  assert(got?.text === '引用\n\n正文' && got?.source === '学习笔记 · 第二节', '✓ captureSelectionQuote 有效选区:归一文本 + title trim + 最近标题来源')
  assert(captureSelectionQuote(mkDoc(null) as never) === null, '✓ captureSelectionQuote 无 selection → null')
  assert(captureSelectionQuote(mkDoc({ isCollapsed: true, toString: () => 'x' }) as never) === null, '✓ captureSelectionQuote 塌缩选区 → null')
  assert(captureSelectionQuote(mkDoc({ isCollapsed: false, anchorNode: { nodeType: 1, closest: () => null }, toString: () => '   ' }) as never) === null, '✓ captureSelectionQuote 空白选区 → null')
  const sdkSel = { isCollapsed: false, anchorNode: { nodeType: 1, closest: () => fakeEl(9, 'chat-dialog'), parentElement: null }, toString: () => '输入消息' }
  assert(captureSelectionQuote(mkDoc(sdkSel) as never) === null, '✓ captureSelectionQuote 锚在 SDK 对话框内 → null(不把 SDK 文案当引用)')
  const noHeadingDoc = captureSelectionQuote({ title: 'T', getSelection: () => ({ isCollapsed: false, anchorNode: { nodeType: 1, closest: () => null }, toString: () => 'text' }) } as never)
  assert(noHeadingDoc?.source === 'T', '✓ captureSelectionQuote 无 querySelectorAll 面(duck 桩)→ 来源降级 pageTitle 不崩')

  // ---- pageContext 中间件 ----
  const mw = createPageContextMiddleware({ getPageInfo: () => null, canReadPage: true })
  assert(mw.name === 'pageContext' && mw.augmentPrompt?.(undefined as never) === undefined, '✓ pageContext 无页面信息(node/headless 降级)→ 不注入')
  const mw2 = createPageContextMiddleware({ getPageInfo: () => ({ title: '深度学习笔记', url: 'https://x.dev/notes/dl' }), canReadPage: true })
  const seg = mw2.augmentPrompt?.(undefined as never) ?? ''
  assert(seg.includes('深度学习笔记') && seg.includes('https://x.dev/notes/dl') && seg.includes('read_page'), '✓ pageContext 段含 title/URL + read_page 指引(canReadPage=true)')
  const mw3 = createPageContextMiddleware({ getPageInfo: () => ({ title: 'T', url: 'u' }), canReadPage: false })
  assert(!(mw3.augmentPrompt?.(undefined as never) ?? '').includes('read_page'), '✓ pageContext domInspect 关时不引导 read_page(不提不存在的工具)')

  // ---- capabilities 注册 ----
  const defCaps = resolveCapabilities(undefined)
  assert(defCaps.pageContext === false, '✓ pageContext 默认关(opt-in)')
  assert(resolveCapabilities({ pageContext: true }).pageContext === true, '✓ pageContext 显式 true 开启')

  // ---- read_page 提取面(pickContentRoot / extractPageText;duck-typing 假节点) ----
  const fakeDoc = (hits: Record<string, unknown>) => ({ querySelector: (sel: string) => hits[sel] ?? null, body: { __is: 'body' } })
  assert(pickContentRoot(fakeDoc({ article: { __is: 'article' } }) as never)?.__is === 'article', '✓ pickContentRoot article 优先命中')
  assert(pickContentRoot(fakeDoc({ main: { __is: 'main' }, '.content': { __is: 'content' } }) as never)?.__is === 'main', '✓ pickContentRoot main 优先于 .content(逐选择器按优先级,非文档序)')
  assert(pickContentRoot(fakeDoc({ '.markdown-body': { __is: 'md' } }) as never)?.__is === 'md', '✓ pickContentRoot 常用内容类名兜底命中')
  assert(pickContentRoot(fakeDoc({}) as never)?.__is === 'body', '✓ pickContentRoot 全落空回落 body')

  /** 假元素:tagName/children/innerText;__sdk=true 标记 SDK 子树,__descend=true 标记子树含排除目标 */
  const nd = (tag: string, text: string, children: unknown[] = [], extra: Record<string, unknown> = {}) =>
    ({ tagName: tag.toUpperCase(), innerText: text, textContent: text, children, querySelector: () => null, ...extra })
  const tree = nd('article', 'root', [
    nd('h2', '第一节 标题'),
    nd('p', '第一段正文内容'),
    nd('script', 'var secret = 1'),
    nd('style', '.a{color:red}'),
    // 包装 div:子树内嵌 SDK 对话框(__descend=true 触发下钻)→ 只排除 SDK 枝,其余保留
    nd('div', 'wrapper(不应整体出现)', [nd('p', '嵌套段落'), nd('div', '输入消息,Enter 发送', [], { __sdk: true })], { __descend: true }),
  ])
  const out = extractPageText(tree as never, (el) => (el as { __sdk?: boolean }).__sdk === true, (el) => (el as { __descend?: boolean }).__descend === true)
  assert(out.includes('第一节 标题') && out.includes('第一段正文内容') && out.includes('嵌套段落'), '✓ extractPageText 正文块齐(直接子元素 + 下钻层)')
  assert(!out.includes('var secret') && !out.includes('color:red'), '✓ extractPageText script/style 子树排除')
  assert(!out.includes('输入消息') && !out.includes('wrapper(不应整体出现)'), '✓ extractPageText 嵌套 SDK 子树排除且不重复(wrapper 只下钻不整枝)')
  assert(out.split('\n\n').length === 3, '✓ extractPageText 块间空行连接(3 块)')
  const noInner = extractPageText(nd('div', 'wrap', [nd('p', '纯 textContent 兜底', [], { innerText: undefined })]) as never, () => false, () => false)
  assert(noInner === '纯 textContent 兜底', '✓ extractPageText innerText 缺失回落 textContent')
  assert(extractPageText(null, () => false, () => false) === '', '✓ extractPageText 空根安全')
  const messy = extractPageText(nd('div', 'wrap', [nd('p', 'a\n\n\n\n\nb')]) as never, () => false, () => false)
  assert(messy === 'a\n\nb', '✓ extractPageText 3+ 空行折叠为 2')
}
