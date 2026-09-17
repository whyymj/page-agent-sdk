/**
 * sec-127 —— take_screenshot(page-screenshot)纯函数面 + 装配引导面
 *
 * resolveScreenshotTarget 三模式路由 / node 守卫 / usageHints 截图引导按 flag / dom-inspect skill
 * 变体(勿教不存在的工具)。渲染/压缩/canvas 全链在 browser e2e 真跑;vision 合成消息通道在 e2e 断言。
 */
import { resolveScreenshotTarget, createScreenshotTool, SCREENSHOT_MAX_FULLPAGE_HEIGHT } from '../../tools/screenshot'
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
}
