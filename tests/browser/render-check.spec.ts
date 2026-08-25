/**
 * render-check 浏览器 E2E(真沙箱 iframe;2026-08-24)
 *
 * 两层:
 *  1. fixtures/render-check-host(真沙箱本体,不经 mockLlm):好代码 pass + 指标 / script throw → js-error /
 *     unhandledrejection → 捕获 / 404 图片 → resource-error / 白屏指标 / iframe 用后销毁 /
 *     CSP 拦内联脚本 → 握手缺失 unavailable(防假绿)
 *  2. html-page-demo 集成(mockLlm 驱动真委派链):坏 script → 门禁回灌 → 修复 → 复检通过闭环
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle, clearChat } from './_helpers'

/** 宿主页 probe:调真沙箱运行器(短窗加速:静默 400ms / 硬上限 3000ms) */
async function probe(page: Page, expr: string): Promise<any> {
  await page.waitForFunction(() => !!(window as any).__pgRenderProbe)
  return page.evaluate(`(window.__pgRenderProbe.${expr})`)
}

async function runSandbox(page: Page, html: string) {
  const r = await probe(page, `renderInSandbox(${JSON.stringify(html)}, { silenceMs: 400, hardCapMs: 3000, metricsGraceMs: 400 })`)
  return { ...r, verdictObj: await probe(page, `normalizeRenderResult(${JSON.stringify(r)})`) }
}

test.describe('render-check: 真沙箱本体(fixtures 宿主)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tests/browser/fixtures/render-check-host.html')
    await page.waitForSelector('#ready')
  })

  test('好代码 → pass + 指标健康 + iframe 用后销毁', async ({ page }) => {
    const before = await probe(page, 'getSandboxLifecycle()')
    const r = await runSandbox(page, '<section><h1>hello</h1><p>world</p></section>')
    expect(r.handshake).toBe(true)
    expect(r.signals.length).toBe(0)
    expect(r.metrics).toBeTruthy()
    expect(r.metrics.bodyChildren).toBeGreaterThanOrEqual(1)
    expect(r.metrics.scrollHeight).toBeGreaterThan(10)
    expect(r.verdictObj.verdict).toBe('pass')
    // 用后销毁:检查窗结束 iframe 移除(宿主只有 fixture 页自身,无其它 sandbox="allow-scripts" 精确匹配 iframe)
    const liveIframes = await page.evaluate(() => document.querySelectorAll('iframe[sandbox="allow-scripts"]').length)
    expect(liveIframes).toBe(0)
    const after = await probe(page, 'getSandboxLifecycle()')
    expect(after.created).toBe(before.created + 1)
    expect(after.destroyed).toBe(before.destroyed + 1)
  })

  test('script throw → js-error 捕获(带消息)→ fail', async ({ page }) => {
    const r = await runSandbox(page, '<section>x</section><script>throw new Error("render-boom")</script>')
    expect(r.handshake).toBe(true)
    const jsErr = r.signals.filter((s: any) => s.type === 'js-error')
    expect(jsErr.length).toBeGreaterThanOrEqual(1)
    expect(jsErr[0].message).toContain('render-boom')
    expect(r.verdictObj.verdict).toBe('fail')
    expect(r.verdictObj.problems.join('\n')).toContain('render-boom')
  })

  test('unhandledrejection → 异步拒绝捕获 → fail', async ({ page }) => {
    const r = await runSandbox(page, '<section>y</section><script>Promise.reject(new Error("async-boom"))</script>')
    const rej = r.signals.filter((s: any) => s.type === 'unhandledrejection')
    expect(rej.length).toBeGreaterThanOrEqual(1)
    expect(rej[0].message).toContain('async-boom')
    expect(r.verdictObj.verdict).toBe('fail')
  })

  test('404 图片 → 资源失败捕获(捕获相,非 onerror)→ fail', async ({ page }) => {
    const r = await runSandbox(page, '<section><img src="/definitely-not-exist-404.png" alt="x"></section>')
    const res = r.signals.filter((s: any) => s.type === 'resource-error')
    expect(res.length).toBeGreaterThanOrEqual(1)
    expect(res[0].source).toContain('definitely-not-exist-404.png')
    expect(r.verdictObj.verdict).toBe('fail')
  })

  test('白屏指标:body display:none → scrollHeight 0 → 疑似白屏 fail', async ({ page }) => {
    const r = await runSandbox(page, '<style>body{display:none}</style><section><p>hidden</p></section>')
    expect(r.handshake).toBe(true)
    expect(r.metrics.scrollHeight).toBeLessThan(10)
    expect(r.verdictObj.verdict).toBe('fail')
    expect(r.verdictObj.problems.join('\n')).toContain('疑似白屏')
  })

  test('CSP 拦内联脚本(srcdoc 继承宿主 CSP)→ 握手缺失 → unavailable 防假绿', async ({ page }) => {
    // route 注入 CSP:外链 self 放行(fixture 模块脚本正常),内联 script 全拦 → collector 与组件内联脚本均死
    await page.route('**/render-check-host.html', async (route) => {
      const resp = await route.fetch()
      await route.fulfill({
        response: resp,
        headers: { ...resp.headers(), 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'" },
      })
    })
    await page.goto('/tests/browser/fixtures/render-check-host.html')
    await page.waitForSelector('#ready')
    const r = await runSandbox(page, '<section><h1>blocked</h1><script>throw new Error("never-runs")</script></section>')
    expect(r.handshake).toBe(false)
    expect(r.signals.length).toBe(0)
    expect(r.verdictObj.verdict).toBe('unavailable')
    expect(r.verdictObj.reason).toBe('handshake-missing')
  })
})

test.describe('render-check: demo 集成闭环(html-page-demo)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/html-page-demo/')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
  })

  test('坏 script → 门禁回灌 → 修复 → 复检通过 → 收口(渲染自检闭环)', async ({ page }) => {
    const tracker = await mockLlm(page, [
      { tool_calls: [{ name: 'use_html', arguments: { task: '生成一个欢迎区块' } }] },
      {
        tool_calls: [{
          name: 'write',
          arguments: {
            patch: {
              op: 'set', jsonPath: 'components.2',
              value: { type: 'custom', name: 'welcome', code: '<section><h1>欢迎</h1></section><script>throw new Error("render-boom")</script>' },
            },
          },
        }],
      },
      // 坏代码在 bind 上即尝试文本收口 → 门禁(beforeReturn)拦截回灌(第 4 次模型调用是回灌后的修复)
      { text: '已生成完成' },
      {
        tool_calls: [{
          name: 'write',
          arguments: {
            patch: {
              op: 'set', jsonPath: 'components.2',
              value: { type: 'custom', name: 'welcome', code: '<section><h1>欢迎(已修复)</h1></section>' },
            },
          },
        }],
      },
      { text: '已修复渲染错误并复检通过' },
      { text: '完成' },
    ])

    await fillInput(page, '生成一个欢迎区块')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 门禁确实触发:debugLogs 有 render_check_component fail(子日志转发到主)→ 复检 pass
    const rcLogs = await page.evaluate(() => (window as any).__htmlDemoSdk.debugLogs.value
      .filter((l: any) => l.data?.stage === 'render_check_component')
      .map((l: any) => ({ target: l.data.target, verdict: l.data.verdict })))
    expect(rcLogs.some((l: any) => l.verdict === 'fail')).toBe(true)
    expect(rcLogs.some((l: any) => l.verdict === 'pass')).toBe(true)

    // 最终代码为修复版(坏 script 已消;预览 iframe 每组件一个,拼全部)
    const preview = await page.locator('.preview-iframe').evaluateAll((els) => els.map((e) => e.getAttribute('srcdoc') ?? '').join('\n'))
    expect(preview).toContain('已修复')
    expect(preview).not.toContain('render-boom')
    // 全链 6 次模型调用:主委派 1 + 子坏写 1 + 子尝试收口 1(被门禁拦)+ 子修复 1(回灌轮)+ 子收口 1 + 主收口 1
    expect(tracker.calls()).toBe(6)
    // 检查窗结束后沙箱 iframe 全部销毁(demo 预览 iframe sandbox 含 allow-modals,不匹配精确选择器)
    const live = await page.evaluate(() => document.querySelectorAll('iframe[sandbox="allow-scripts"]').length)
    expect(live).toBe(0)
    expect(await page.textContent('.chat-dialog')).toContain('完成')
  })
})
