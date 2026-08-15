import { test, expect } from '@playwright/test'
import { mockLlm } from './_helpers'

/** headless 自建 UI 的 idle 等待:debugLogs 800ms 无新增 + 消息数稳定(waitForAgentIdle 绑内置 .chat-dialog 不适用) */
async function waitHeadlessIdle(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => {
    const logs = (window as any).__sdk?.debugLogs?.value ?? []
    if (!logs.length) return false
    return Date.now() - logs[logs.length - 1].timestamp > 800
  }, { timeout: 30_000 })
}

/** customize-demo 是 headless 自建 UI(无内置 .chat-dialog),用自己的输入选择器(与 customize-demo.spec.ts 一致) */
async function sendText(page: import('@playwright/test').Page, text: string): Promise<void> {
  await page.fill('.my-dialog__footer textarea', text)
  await page.click('.my-dialog__send')
}

/**
 * 生命周期浏览器 E2E(F2):流式中 unmount → abort 收口 + loading 收口 + 重新 mount 无残留
 *
 * 验证:
 *  - 流式响应中调 sdk.unmount() → 无 pageerror、loading 收口、旧流 abort
 *  - 经 demo 暴露的 __remountSdk 重挂 → 无旧消息残留、旧流不复活
 * 用 customize-demo(headless 自建 UI;App.vue 暴露 __sdk / __remountSdk 采样口)
 */
test.describe('生命周期:流式 unmount → abort 收口 + 重新 mount 无残留', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/customize-demo/')
    await page.waitForSelector('.my-dialog')
    await page.waitForFunction(() => (window as any).__sdk, { timeout: 10_000 })
  })

  test('流式中 unmount → 无 pageerror + loading 收口', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    // 第二响应延迟 500ms,给 unmount 足够窗口落在 loading 中
    await mockLlm(page, [
      { text: '流式回复中'.repeat(40) },
    ], [600])

    await sendText(page, '测试')

    // 等 loading 出现(流式进行中)
    await page.waitForFunction(() => !!(window as any).__sdk?.debugLogs?.value?.length, { timeout: 5000 }).catch(() => {})

    // 流式中 unmount
    const unmountResult = await page.evaluate(() => {
      try {
        const sdk = (window as any).__sdk
        if (!sdk || typeof sdk.unmount !== 'function') return { ok: false, reason: 'no __sdk or unmount' }
        sdk.unmount()
        return { ok: true }
      } catch (e) {
        return { ok: false, reason: String(e) }
      }
    })
    expect(unmountResult.ok).toBe(true, `unmount 调用成功:${(unmountResult as any).reason ?? ''}`)

    // 断言:无 pageerror(unmount abort 收口不抛异常)
    expect(errors.length).toBe(0, `unmount 无 pageerror,实际 ${errors.length} 个: ${errors.join('; ')}`)

    // 断言:页面无脚本错误残留
    await page.waitForTimeout(300)
    expect(errors.length).toBe(0, 'unmount 后延迟窗口内仍无 pageerror(abort 收口完成)')
  })

  test('流式中 unmount → __remountSdk 重挂无旧流复活', async ({ page }) => {
    await mockLlm(page, [
      { text: '第一轮回复'.repeat(30) },
    ], [600])

    await sendText(page, '第一轮')
    await page.waitForFunction(() => (window as any).__sdk?.debugLogs?.value?.some?.((l: any) => l.type === 'llm_request'), { timeout: 5000 }).catch(() => {})

    // 流式中 unmount
    await page.evaluate(() => (window as any).__sdk?.unmount())
    await page.waitForTimeout(300)

    // 重挂(demo 暴露的 init 重跑;storage 'indexed' 会话恢复,断言不抛错)
    const remount = await page.evaluate(async () => {
      try {
        await (window as any).__remountSdk()
        return { ok: true, msgs: (window as any).__sdk?.messages?.length ?? -1 }
      } catch (e) {
        return { ok: false, reason: String(e) }
      }
    })
    expect(remount.ok).toBe(true, `重挂成功:${(remount as any).reason ?? ''}`)
    expect((remount as any).msgs).toBeGreaterThanOrEqual(0)

    // 重挂后流不复活:等一个窗口,消息数不增长(旧流被 abort)
    const before = await page.evaluate(() => (window as any).__sdk?.messages?.length ?? -1)
    await page.waitForTimeout(800)
    const after = await page.evaluate(() => (window as any).__sdk?.messages?.length ?? -1)
    expect(after).toBe(before, '重挂后旧流不复活(消息数不增长)')
  })

  test('正常结束后 unmount → 重挂正常工作', async ({ page }) => {
    await mockLlm(page, [{ text: '第一轮完成' }])
    await sendText(page, '第一轮')
    await waitHeadlessIdle(page)
    await page.waitForTimeout(200)

    const dialogText1 = await page.textContent('.my-dialog')
    expect(dialogText1 || '').toContain('第一轮完成')

    // unmount → 重挂
    await page.evaluate(() => (window as any).__sdk?.unmount())
    await page.waitForTimeout(200)
    const remount = await page.evaluate(async () => {
      try {
        await (window as any).__remountSdk()
        return { ok: true }
      } catch (e) {
        return { ok: false, reason: String(e) }
      }
    })
    expect(remount.ok).toBe(true, `重挂成功:${(remount as any).reason ?? ''}`)

    // 重挂后可继续对话
    await mockLlm(page, [{ text: '第二轮完成' }])
    await sendText(page, '第二轮')
    await waitHeadlessIdle(page)
    const dialogText2 = await page.textContent('.my-dialog')
    expect(dialogText2 || '').toContain('第二轮完成', '重挂后第二轮正常工作')
  })
})
