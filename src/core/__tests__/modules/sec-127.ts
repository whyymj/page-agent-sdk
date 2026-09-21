/**
 * sec-127 —— take_screenshot(page-screenshot)纯函数面 + 装配引导面
 *
 * resolveScreenshotTarget 三模式路由 / node 守卫 / usageHints 截图引导按 flag / dom-inspect skill
 * 变体(勿教不存在的工具)。渲染/压缩/canvas 全链在 browser e2e 真跑;vision 合成消息通道在 e2e 断言。
 */
import { resolveScreenshotTarget, createScreenshotTool, createViewImageTool, SCREENSHOT_MAX_FULLPAGE_HEIGHT, focusShotSelector, countIframesIn } from '../../tools/screenshot'
import { makeDomInspectSkill, makePageAnalysisSkill } from '../../tools/domTool'
import { createUsageHintsMiddleware } from '../../harness/usageHints'

export async function run(ctx: { assert: (cond: boolean, msg: string) => void }): Promise<void> {
  const { assert } = ctx

  // ---- resolveScreenshotTarget(三模式路由,纯函数) ----
  const el = { tag: 'x' } as unknown as Element
  const doc = { querySelector: (sel: string) => (sel === '.a' ? el : null) }
  const win = { innerWidth: 1280, innerHeight: 800 }
  const r1 = resolveScreenshotTarget(doc, win, { selector: '.a' })
  assert(r1.ok && r1.mode === 'selector' && (r1 as { el?: Element }).el === el, '✓ selector 命中 → 局部模式返回元素')
  const r2 = resolveScreenshotTarget(doc, win, { selector: '.miss' })
  assert(!r2.ok && (r2 as { error: string }).error.includes('未找到匹配元素'), '✓ selector 未命中 → 可读错误(引导 dom_search)')
  const r3 = resolveScreenshotTarget(doc, win, {})
  assert(r3.ok && r3.mode === 'viewport' && r3.width === 1280 && r3.height === 800, '✓ 无参 → 视口模式(宽高 = 窗口尺寸)')
  const r4 = resolveScreenshotTarget(doc, win, { fullPage: true })
  assert(r4.ok && r4.mode === 'fullPage' && r4.width === 1280 && (r4 as { height?: number }).height === undefined, '✓ fullPage → 高度留给调用侧(scrollHeight 在工具内取,渲染根为 documentElement)')
  assert(SCREENSHOT_MAX_FULLPAGE_HEIGHT === 32768, '✓ fullPage 高度上限常量(超长文档拒截)')

  // ---- node 守卫(selftest 无 document → 友好回灌不炸) ----
  {
    const t = createScreenshotTool({ getVision: () => true })
    const out = await t.invoke({}, {})
    assert(String(out).startsWith('ERROR: take_screenshot 仅在浏览器环境可用'), '✓ node 守卫 → 可读 ERROR 文案(node/服务端无 DOM)')
  }

  // ---- usageHints:截图引导按 flag(勿教不存在的工具) ----
  {
    const withShot = createUsageHintsMiddleware({ domInspect: true, screenshot: true } as never, false)
    const seg = withShot.augmentPrompt?.(undefined as never) ?? ''
    assert(seg.includes('take_screenshot'), '✓ screenshot flag 开 → hints 教截图(视觉验证优先)')
    const noShot = createUsageHintsMiddleware({ domInspect: true } as never, false)
    const seg2 = noShot.augmentPrompt?.(undefined as never) ?? ''
    assert(!seg2.includes('take_screenshot'), '✓ screenshot flag 缺省 → 不教(工具未装配)')
    // dom_search 引导按 skills flag 门控(2026-09-21 门户真机:模型不知 load 可得检索,整页翻页 50K/轮)
    const withSearch = createUsageHintsMiddleware({ domInspect: true, skills: true } as never, false)
    const seg3 = withSearch.augmentPrompt?.(undefined as never) ?? ''
    assert(seg3.includes('load_skill("dom-inspect")') && seg3.includes('dom_search'), '✓ skills+domInspect 同开 → 教「先 load_skill 取 dom_search 再窄读」(修整页翻页找的 50K/轮根因)')
    assert(!seg2.includes('dom-inspect'), '✓ skills 关 → 不教 load_skill(load 工具不在池,幻影勿教)')
  }

  // ---- dom-inspect skill 变体 ----
  {
    const withShot = makeDomInspectSkill({ withScreenshot: true }).getContent()
    assert(withShot.includes('take_screenshot'), '✓ skill 变体 withScreenshot → 含截图用法段')
    assert(withShot.includes('视觉验证 take_screenshot'), '✓ skill 排障套路按截图更新')
    const base = makeDomInspectSkill().getContent()
    assert(!base.includes('take_screenshot'), '✓ 基础变体不含截图段(未装配不教)')
  }

  // ---- page-analysis skill(页面内容分析策略;截图路线随装配态) ----
  {
    const pa = makePageAnalysisSkill({ withScreenshot: true }).getContent()
    assert(pa.includes('问题分型') && pa.includes('先窄后宽') && pa.includes('基于页面实料'), '✓ page-analysis 含分型/探索纪律/回答纪律三段')
    assert(pa.includes('take_screenshot'), '✓ page-analysis withScreenshot → 含视觉类分型路线')
    const paBase = makePageAnalysisSkill().getContent()
    assert(!paBase.includes('take_screenshot'), '✓ page-analysis 基础变体不教截图(未装配)')
  }

  // ---- 聚焦取景锚定(2026-09-19 真机 dump 驱动:指代问句时截图漫游整页,焦点组件从未进画幅) ----
  {
    // 纯函数:data-path selector 组装 + 值转义
    assert(focusShotSelector('components.8.props.tabs.0.children.0') === '[data-path="components.8.props.tabs.0.children.0"]',
      '✓ focusShotSelector → [data-path="<焦点路径>](低代码宿主通用约定)')
    assert(focusShotSelector('a"b\\c').includes('a\\"b\\\\c'), '✓ focusShotSelector 值转义(引号/反斜杠防属性选择器注入)')

    // 假 document + fake render 捕获「实际取景元素」断言(压缩段是浏览器域,node 必炸 ——
    // 断言取景锚定只看 render 收到的元素,不受压缩成败影响)
    const realDoc = (globalThis as { document?: unknown }).document
    const png1x = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    /** 命中规则可配的假 doc:data-path 锚 / 任意 selector / 全不命中 */
    const mkDoc = (mode: 'datapath' | 'any' | 'none') => ({
      documentElement: { scrollHeight: 800 },
      querySelector: (sel: string) => {
        if (mode === 'any') return { tag: 'picked' }
        if (mode === 'datapath' && sel.includes('data-path')) return { tag: 'focused' }
        return null
      },
      querySelectorAll: () => [],
    }) as unknown as Document
    const mkTool = (opts: { focus?: { path: string }; focusSelector?: (p: string) => string | undefined; captured: { el?: unknown } }) => createScreenshotTool({
      getVision: () => true,
      render: async (el) => { opts.captured.el = el; return png1x },
      getRootEl: () => ({ tag: 'root' }) as unknown as Element,
      ...(opts.focus ? { getActiveFocus: () => opts.focus } : {}),
      ...(opts.focusSelector ? { focusSelector: opts.focusSelector } : {}),
    })
    const tag = (v: unknown): string => (v as { tag?: string })?.tag ?? '?'
    try {
      // ① 命中:缺省 selector + 聚焦 → render 收到 data-path 锚定元素(取景 = 聚焦组件)
      const c1: { el?: unknown } = {}
      ;(globalThis as { document?: unknown }).document = mkDoc('datapath')
      await mkTool({ focus: { path: 'components.8' }, captured: c1 }).invoke({}, {})
      assert(tag(c1.el) === 'focused', `✓ 聚焦命中 → 取景元素 = data-path 锚定的聚焦组件,实际:${tag(c1.el)}`)
      // ② 未命中:回退视口(render 收到根元素)
      const c2: { el?: unknown } = {}
      ;(globalThis as { document?: unknown }).document = mkDoc('none')
      await mkTool({ focus: { path: 'components.9' }, captured: c2 }).invoke({}, {})
      assert(tag(c2.el) === 'root', `✓ 聚焦未命中锚点 → 回退视口(渲染根),实际:${tag(c2.el)}`)
      // ③ 无聚焦:零行为差(视口 = 渲染根)
      const c3: { el?: unknown } = {}
      await mkTool({ captured: c3 }).invoke({}, {})
      assert(tag(c3.el) === 'root', '✓ 无聚焦 → 现行为零变化(视口)')
      // ④ focusSelector 自定义映射命中(宿主约定不同;doc 切 any 使 #my-comp 可命中)
      ;(globalThis as { document?: unknown }).document = mkDoc('any')
      const c4: { el?: unknown } = {}
      await mkTool({ focus: { path: 'x' }, focusSelector: () => '#my-comp', captured: c4 }).invoke({}, {})
      assert(tag(c4.el) === 'picked', `✓ focusSelector 自定义映射命中 → 取景映射元素,实际:${tag(c4.el)}`)
      // ⑤ 显式 selector 优先(聚焦锚定只补缺省,不抢用户指定)
      const c5: { el?: unknown } = {}
      ;(globalThis as { document?: unknown }).document = mkDoc('any')
      await mkTool({ focus: { path: 'components.8' }, captured: c5 }).invoke({ selector: '.user-pick' }, {})
      assert(tag(c5.el) === 'picked', `✓ 显式 selector 优先(按用户 selector 取景),实际:${tag(c5.el)}`)
      // ⑥ iframe 盲区预警(2026-09-20 真机 dump 驱动):取景含 iframe → 结果预警并给替代路径;
      //    纯元素桩无 querySelectorAll → countIframesIn 返 0 不炸(①-⑤ 零预警即证)
      assert(countIframesIn({ querySelectorAll: (s: string) => (s === 'iframe' ? [{ tag: 'f1' }, { tag: 'f2' }] : []) } as unknown as Element) === 2,
        '✓ countIframesIn → 数取景范围内 iframe 数')
      const docIframe = {
        documentElement: { scrollHeight: 800 },
        querySelector: () => ({ tag: 'code-comp', querySelectorAll: (s: string) => (s === 'iframe' ? [{ tag: 'frame' }] : []) }),
        querySelectorAll: () => [],
      } as unknown as Document
      ;(globalThis as { document?: unknown }).document = docIframe
      const resIframe = await mkTool({ captured: {} }).invoke({ selector: '[data-path="components.24"]' }, {})
      assert(resIframe.includes('⚠️ 取景范围内含 1 个 iframe') && resIframe.includes('数据侧核对'),
        '✓ 取景含 iframe → 结果带盲区预警 + 替代路径(修前只报「成功」,主 agent 4 次截图试错才发现)')
      ;(globalThis as { document?: unknown }).document = mkDoc('any')  // 换回无 iframe 桩做阴性对照
      const resClean = await mkTool({ captured: {} }).invoke({ selector: '[data-path="components.24"]' }, {})
      assert(!resClean.includes('⚠️ 取景范围内含'), '✓ 取景不含 iframe(元素桩无 querySelectorAll)→ 零预警不误报')
  } finally {
      ;(globalThis as { document?: unknown }).document = realDoc
    }
  }

  // ---- view_image:URL 原图直投(4.23,真机 dump 驱动:问「第 N 张图」手里有 slide URL 却无工具可看) ----
  {
    const shots: Array<{ image: { url?: string; dataUri?: string }; meta: { mode: string } }> = []
    const mk = (vision: boolean, describe?: (img: unknown, ctx: { text: string }) => Promise<string>, clientFetch?: (u: string) => Promise<Response | null>) =>
      createViewImageTool({ getVision: () => vision, ...(describe ? { describe } : {}), ...(clientFetch ? { clientFetch } : { clientFetch: async () => null }), onShot: (image, meta) => { shots.push({ image, meta }) } })
    // ① vision + 物化不可用(clientFetch null,如无 CORS)→ URL 直投兜底
    const r1 = await mk(true, undefined, async () => null).invoke({ url: 'https://picsum.photos/seed/s1/1200/400' }, {})
    assert(String(r1).includes('URL 直投') && shots.length === 1 && shots[0].image.url === 'https://picsum.photos/seed/s1/1200/400' && !shots[0].image.dataUri && shots[0].meta.mode === 'url',
      '✓ view_image(物化不可用)→ url 形态直投兜底(onShot 收 url 图,回灌注明 URL 直投)')
    // ①b vision + 客户端物化成功 → dataUri 优先(deepseek 400「Failed to download image」的闭环修:
    //     供应商无需再下载;url 字段保留溯源)
    const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const r1b = await mk(true, undefined, async () => new Response(new Blob([Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0))], { type: 'image/png' }), { status: 200 })).invoke({ url: 'https://x/i.png' }, {})
    assert(String(r1b).includes('客户端物化') && shots.length === 2 && shots[1].image.dataUri?.startsWith('data:image/png') && shots[1].image.url === 'https://x/i.png',
      '✓ view_image(物化成功)→ dataUri 优先投递(供应商免下载;url 保留溯源),回灌注明已物化')
    // ② 非 http(s) 拒(data:/ftp:/空)
    // 空串由 schema min(8) 层拦(tool 校验),不在此重复测
    for (const bad of ['data:image/png;base64,xxx', 'ftp://x/y.png', 'javascript:alert(1)']) {
      const r = await mk(true).invoke({ url: bad }, {})
      assert(String(r).startsWith('ERROR: view_image 只接受 http(s)'), `✓ view_image 拒非 http(s):${bad.slice(0, 12) || '(空)'}`)
    }
    // ③ 非 vision + describe → 转述回灌
    const r3 = await mk(false, async () => '一张山景照片').invoke({ url: 'https://x/i.jpg' }, {})
    assert(String(r3).includes('图片转述') && String(r3).includes('一张山景照片'), '✓ view_image(非 vision)→ describe 转述回灌')
    // ④ 非 vision 无 describe → 诚实拒绝
    const r4 = await mk(false).invoke({ url: 'https://x/i.jpg' }, {})
    assert(String(r4).includes('ERROR') && String(r4).includes('images.describe'), '✓ view_image(无消费方)→ 诚实拒绝(不留静默空图)')
  }
}
