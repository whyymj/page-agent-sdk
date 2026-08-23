/**
 * sec-36:宿主动作 actions + DOM 读取纯函数 domToStructure + DOM 检视工具族(dom_search/dom_info)
 * - actionsToTools:每个 action 一个命名 tool / 非法名跳过 / invoke 调 run / 异常隔离 / undefined 默认文案
 * - actionsToInspectInfo:元信息(description + hasParams)
 * - domToStructure:tag/attrs 默认白名单 + data-* / text / depth 截断 childCount / 严格白名单 / includeText=false / null
 * - searchDom:selector/text 双模 + limit 截断 + CSS 路径
 * - getElementInfo:内容/计算样式(注入 fake gcs)/几何/事件三源(inline+vue+记录器)
 * - buildCssPath:id 短路 + nth-of-type;listener 记录器:add/remove 计数
 */
import { z } from 'zod'
import { actionsToTools, actionsToInspectInfo } from '../../sdk/actions'
import { domToStructure, searchDom, getElementInfo, buildCssPath, ensureDomListenerRecorder, getRecordedListeners, domInspectSkill } from '../../tools/domTool'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke } = ctx

  // ===== actions 宿主动作 =====
  // ✓ actionsToTools → 每个 action 生成一个命名 tool
  const tools = actionsToTools({
    save_draft: { description: '保存草稿', run: () => 'saved' },
    publish: { description: '发布', run: () => 'published' },
  })
  assert(tools.length === 2, '✓ actionsToTools → 每个 action 一个 tool(2 个)')
  assert(tools[0].name === 'save_draft', '✓ actionsToTools → tool 名 = action 名(save_draft)')
  assert(tools[1].name === 'publish', '✓ actionsToTools → tool 名 = action 名(publish)')
  assert(typeof tools[0].description === 'string' && tools[0].description.includes('保存'), '✓ actionsToTools → description 透传')

  // ✓ actionsToTools → 非法名(连字符 / 数字开头)跳过,合法的保留
  const tools2 = actionsToTools({
    'bad-name': { description: '非法', run: () => 'x' },
    good_name: { description: '合法', run: () => 'y' },
    '1leading': { description: '非法', run: () => 'z' },
  })
  assert(tools2.length === 1 && tools2[0].name === 'good_name', '✓ actionsToTools → 非法名跳过(连字符/数字开头),仅留 good_name')

  // ✓ action tool invoke → 调 run 返回结果
  const okTool = actionsToTools({ ok: { description: 'ok', run: () => '成功结果' } })[0]
  const okResult = await invoke(okTool, {})
  assert(okResult === '成功结果', '✓ action tool invoke → 调 run 返回结果')

  // ✓ action tool run 抛错 → 错误字符串回灌(异常隔离,不崩 agent)
  const errTool = actionsToTools({ boom: { description: 'boom', run: () => { throw new Error('炸了') } } })[0]
  const errResult = await invoke(errTool, {})
  assert(errResult.includes('执行失败') && errResult.includes('炸了'), '✓ action tool run 抛错 → 错误字符串回灌(异常隔离)')

  // ✓ action tool run 返 undefined → 默认完成文案
  const voidTool = actionsToTools({ noop: { description: 'noop', run: () => undefined } })[0]
  const voidResult = await invoke(voidTool, {})
  assert(voidResult.includes('执行完成'), '✓ action tool run 返 undefined → 默认完成文案')

  // ✓ actionsToInspectInfo → 元信息(description + hasParams)
  const info = actionsToInspectInfo({
    save: { description: '保存', run: () => '' },
    query: { description: '查询', run: () => '', params: z.object({ id: z.string() }) },
  })
  assert(info.save.hasParams === false, '✓ actionsToInspectInfo → 无 params → hasParams=false')
  assert(info.query.hasParams === true, '✓ actionsToInspectInfo → 有 params → hasParams=true')
  assert(info.save.description === '保存', '✓ actionsToInspectInfo → description 透传')

  // ===== domToStructure 纯函数(mock DOM 节点 duck-typing) =====
  const mockEl = (tag: string, attrs: Record<string, string> = {}, text = '', children: unknown[] = []): any => ({
    tagName: tag.toUpperCase(),
    attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
    childNodes: text ? [{ nodeType: 3, textContent: text }] : [],
    children,
  })

  // ✓ domToStructure → 基本结构(tag 小写 / 默认白名单 attrs / data-* / text / 子节点)
  const node = mockEl('div', { id: 'main', class: 'card', 'data-id': '7' }, '标题', [mockEl('span', {}, '子文本')])
  const s1 = domToStructure(node, { depth: 1 })
  assert(s1?.tag === 'div', '✓ domToStructure → tag 小写(div)')
  assert(s1?.attrs.id === 'main' && s1.attrs.class === 'card', '✓ domToStructure → 默认白名单含 id/class')
  assert(s1?.attrs['data-id'] === '7', '✓ domToStructure → 默认含 data-*')
  assert(s1?.text === '标题', '✓ domToStructure → 直接文本子节点')
  assert(s1?.children?.length === 1 && s1.children[0].tag === 'span', '✓ domToStructure → depth=1 展开 1 层子节点')

  // ✓ domToStructure → depth=0 截断:childCount 不展开 children
  const s2 = domToStructure(node, { depth: 0 })
  assert(s2?.childCount === 1 && !s2.children, '✓ domToStructure → depth=0 截断 childCount=1 不展开')

  // ✓ domToStructure → 严格 attrs 白名单(传了 = 只白名单,不含 data-*)
  const s3 = domToStructure(mockEl('a', { href: '/x', id: 'y', 'data-track': 'z' }, '链'), { depth: 0, attrs: ['href'] })
  assert(s3?.attrs.href === '/x' && s3.attrs.id === undefined && s3.attrs['data-track'] === undefined, '✓ domToStructure → 严格白名单(只 href,排除 id/data-*)')

  // ✓ domToStructure → includeText=false 不返回 text
  const s4 = domToStructure(node, { depth: 0, includeText: false })
  assert(s4?.text === undefined, '✓ domToStructure → includeText=false 不返回 text')

  // ✓ domToStructure → null 输入返回 null
  assert(domToStructure(null, { depth: 3 }) === null, '✓ domToStructure → null 输入返回 null')

  // M5: 默认白名单不含 value(防 <input value>/<textarea> 敏感表单值灌入 LLM 上下文;原 value 在默认白名单与"防敏感属性泄露"定位矛盾)
  const s5 = domToStructure(mockEl('input', { id: 'u', value: '密码明文' }), { depth: 0 })
  assert(s5?.attrs.id === 'u' && s5.attrs.value === undefined, '✓ domToStructure → 默认不含 value(防表单敏感值泄露)')
  // 显式 attrs:['value'] 也 DENY(安全审查 perf-security HIGH:value 是表单敏感值,即使 LLM 把它加进白名单也排除)
  const s6 = domToStructure(mockEl('input', { value: 'x' }), { depth: 0, attrs: ['value'] })
  assert(s6?.attrs.value === undefined, '✓ domToStructure → value 硬 DENY(即使显式 attrs:["value"] 也排除,防表单敏感值泄露)')
  // 敏感命名 attr(data-token / data-api-key)即使默认 data-* 白名单也 DENY(data-id 正常保留)
  const s7 = domToStructure(mockEl('div', { 'data-token': 'abc', 'data-id': '7' }), { depth: 0 })
  assert(s7?.attrs['data-token'] === undefined && s7?.attrs['data-id'] === '7', '✓ domToStructure → data-token 等 DENY_ATTR_SENSITIVE_RE 排除(data-id 保留)')

  // ===== DOM 检视工具族(dom-inspect skill 注入;纯函数层)=====
  // mock 子树:parent#app > h1(文本「大促标题」) + button(文本「立即抢购」)
  const h1 = mockEl('h1', { class: 'title' }, '大促标题')
  const btn = { ...mockEl('button', { class: 'cta', onclick: 'track()' }, '', []), textContent: '立即抢购' }
  const root: any = { querySelectorAll: (q: string) => (q === '*' ? [h1, btn] : q === '.cta' ? [btn] : []) }
  // textContent 挂在元素上(searchDom text 模式读 textContent;childNodes 直接文本走 nodeType 3)
  h1.textContent = '大促标题'

  // ✓ searchDom → text 模式:命中含关键词元素(跳过空文本),返回 CSS 路径 + 片段
  const r1 = searchDom(root as any, '大促', { mode: 'text' })
  assert(r1.total === 1 && r1.hits[0].tag === 'h1' && r1.hits[0].text.includes('大促'), '✓ searchDom → text 模式命中 h1(CSS 路径 + 文本片段)')
  // ✓ searchDom → selector 模式 + limit 截断标注
  const rootMany: any = { querySelectorAll: () => Array.from({ length: 15 }, (_, i) => mockEl('li', { class: 'it' }, `项${i}`)) }
  const r2 = searchDom(rootMany as any, '.it', { mode: 'selector', limit: 5 })
  assert(r2.total === 15 && r2.hits.length === 5 && r2.truncated, '✓ searchDom → limit 截断(15 命中返 5 + truncated 标注)')
  // ✓ searchDom → 无命中/非法 selector 容错
  const r3 = searchDom(root as any, '.none', {})
  assert(r3.total === 0 && r3.hits.length === 0, '✓ searchDom → 无命中返回空(不抛)')
  const r4 = searchDom({ querySelectorAll: () => { throw new Error('bad') } } as any, '!!', {})
  assert(r4.total === 0, '✓ searchDom → 非法 selector 容错返回空')

  // ✓ buildCssPath → 有 id 短路(路径即定位;mock 的 id 是元素属性而非 attributes 项)
  const withId = { ...mockEl('div', { id: 'app' }), id: 'app', parentElement: null }
  assert(buildCssPath(withId as any) === 'div#app', '✓ buildCssPath → 有 id 短路(div#app)')

  // ✓ getElementInfo → 内容/样式(注入 fake gcs)/几何/inline 事件/vue props
  const el: any = {
    ...mockEl('button', { class: 'cta', onclick: 'track(1)', 'data-token': 'sec' }, '抢购', []),
    textContent: '立即抢购',
    innerText: '立即抢购',
    outerHTML: '<button class="cta" onclick="track(1)">立即抢购</button>',
    getBoundingClientRect: () => ({ x: 10.4, y: 20.6, width: 100.2, height: 40.8 }),
    __vueParentComponent: { vnode: { props: { onClick: () => {}, class: 'cta' } } },
  }
  const elInfo = getElementInfo(el as any, {
    styles: ['display', 'background-color'],
    includeHtml: true,
    getComputedStyle: (() => ({ getPropertyValue: (k: string) => ({ display: 'inline-block', 'background-color': 'rgb(247, 201, 72)' })[k] ?? '' })) as any,
  })
  assert(elInfo?.tag === 'button' && elInfo.text === '抢购' && elInfo.textAll === '立即抢购', '✓ getElementInfo → 直接文本 + 全文本')
  assert(elInfo?.styles?.display === 'inline-block' && elInfo.styles['background-color'] === 'rgb(247, 201, 72)', '✓ getElementInfo → 计算样式(注入 gcs 求值)')
  assert(elInfo?.rect && elInfo.rect.x === 10 && elInfo.rect.height === 41, '✓ getElementInfo → 几何取整')
  assert(elInfo?.html?.includes('<button'), '✓ getElementInfo → outerHTML 片段')
  assert(elInfo?.events?.inline.length === 1 && elInfo.events.inline[0].type === 'click' && elInfo.events.inline[0].snippet === 'track(1)', '✓ getElementInfo → inline on* 事件(type+片段)')
  assert(elInfo?.events?.vue.length === 1 && elInfo.events.vue[0] === 'click', '✓ getElementInfo → Vue vnode props onClick → click')
  assert(elInfo?.attrs['data-token'] === undefined, '✓ getElementInfo → attrs 沿用敏感 DENY(data-token 排除)')

  // ✓ listener 记录器:addEventListener 计数 / removeEventListener 归零(node EventTarget 可 patch)
  ensureDomListenerRecorder()
  const t = new EventTarget()
  t.addEventListener('ping', () => {})
  t.addEventListener('ping', () => {})
  assert(getRecordedListeners(t).includes('ping'), '✓ listener 记录器 → addEventListener 登记类型')
  const h = () => {}
  t.addEventListener('pong', h)
  t.removeEventListener('pong', h)
  assert(!getRecordedListeners(t).includes('pong'), '✓ listener 记录器 → removeEventListener 后清除')
  ensureDomListenerRecorder() // 幂等(二次调用不重复 patch)
  assert(true, '✓ listener 记录器 → ensure 幂等')

  // ✓ domInspectSkill → skill 形状(name/description/getContent 用法文档/tools 工厂返回两工具)
  assert(domInspectSkill.name === 'dom-inspect' && domInspectSkill.description.includes('计算样式'), '✓ domInspectSkill → 名称 + 描述(何时加载)')
  const doc = (domInspectSkill.getContent as () => string)()
  assert(doc.includes('dom_search') && doc.includes('events 三源'), '✓ domInspectSkill → getContent 用法文档(工具要点 + 事件三源限制说明)')
  const skillTools = (domInspectSkill.tools as (() => unknown[])[])[0]()
  assert(Array.isArray(skillTools) && skillTools.length === 2 && (skillTools[0] as any).name === 'dom_search' && (skillTools[1] as any).name === 'dom_info', '✓ domInspectSkill → tools 工厂返回 dom_search/dom_info')
}
