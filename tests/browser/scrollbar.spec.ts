import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle } from './_helpers'

/**
 * 滚动条优化(3.27):
 *  - 主滚动区(.chat-main)经 OverlayScrollbars v2 接管:隐藏原生滚动条 + overlay 自定义滚动条(主题色手柄),
 *    保留原生滚动行为;overflow.x hidden = 对话框级横向不滚(代码块/表格各自内部滚)
 *  - 其余小滚动区:原生细条(scrollbar-width thin)兜底
 *  - DebugDrawer .drawer-body 同构接管(i18n-demo debug:true fixture)
 */
test.describe('滚动条优化(OverlayScrollbars + 细条兜底)', () => {
  test('主滚动区:os viewport 接管 + overlay 滚动条 DOM + 横向不滚 + 细条继承', async ({ page }) => {
    await page.goto('/examples/minimal-demo/')
    await page.waitForSelector('.chat-dialog')
    await page.waitForSelector('.chat-main [data-overlayscrollbars-viewport]')
    // overlay 滚动条 DOM(纵向;横向被 overflow.x hidden 抑制)
    await expect(page.locator('.chat-main .os-scrollbar-vertical')).toHaveCount(1)
    // viewport 横向不滚(插件接管后 overflow 生效于 viewport)
    const overflowX = await page.locator('.chat-main [data-overlayscrollbars-viewport]').evaluate((el) => getComputedStyle(el).overflowX)
    expect(overflowX).toBe('hidden')
    // 小滚动区兜底:细滚动条继承属性(Firefox/Chromium121+)
    const sw = await page.locator('.chat-dialog').evaluate((el) => getComputedStyle(el).scrollbarWidth)
    expect(sw).toBe('thin')
  })

  test('长代码行:横向滚动收敛在代码块内部,.chat-main 无横向溢出', async ({ page }) => {
    await page.goto('/examples/minimal-demo/')
    await page.waitForSelector('.chat-dialog')
    await mockLlm(page, [{ text: '示例代码:\n```js\nconst s = "' + 'a'.repeat(400) + '"\n```' }])
    await fillInput(page, '发一段长代码')
    await clickSend(page)
    await waitForAgentIdle(page)
    const pre = page.locator('.chat-dialog .message-md pre.code-block').first()
    await expect(pre).toHaveCount(1)
    // 代码块自身可横向滚(滚动容器是内层 code 元素:pre 为 overflow:hidden 外壳,code 带 overflow-x:auto)
    const preScrollable = await pre.locator('code').evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(preScrollable).toBe(true)
    // 对话框主滚动区无横向溢出
    const mainClean = await page.locator('.chat-main').evaluate((el) => el.scrollWidth <= el.clientWidth)
    expect(mainClean).toBe(true)
  })

  test('DebugDrawer:drawer-body 同构接管', async ({ page }) => {
    await page.goto('/examples/i18n-demo/')
    await page.waitForSelector('.chat-dialog')
    // 打开调试抽屉(更多菜单 → 调试;i18n-demo 配了 debug:true)
    await page.click('.chat-dialog .more-btn')
    await page.click('.chat-dialog .more-item:first-child')
    await page.waitForSelector('.debug-drawer .drawer-panel')
    await page.waitForSelector('.drawer-panel .drawer-body [data-overlayscrollbars-viewport]')
    await expect(page.locator('.drawer-panel .drawer-body .os-scrollbar-vertical')).toHaveCount(1)
  })
})
