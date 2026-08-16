import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle } from './_helpers'

/**
 * dialog.icons 自定义图标(minimal-demo 配置了局部覆盖:header 🦈 / empty 🪐 / 双头像文本字形)
 *
 * 验证:
 *  - 局部覆盖生效:头部图标/空态图标渲染自定义 emoji
 *  - 头像字形:assistantAvatar/userAvatar 传文本 → 替换内置 SVG(AvatarIcon glyph 分支)
 *  - 默认回归:未配 icons 的 demo(page-demo)保持默认 🤖/💬(默认路径行为零变化)
 */
test.describe('对话框图标自定义(dialog.icons)', () => {
  test('自定义 header/空态图标生效', async ({ page }) => {
    await page.goto('/examples/minimal-demo/')
    await page.waitForSelector('.chat-dialog')
    await expect(page.locator('.chat-dialog .header-icon')).toHaveText('🦈')
    // empty 配置为内联 svg(HTML 形态)→ 无文本,断言 svg 节点渲染
    await expect(page.locator('.chat-dialog .empty-icon svg')).toHaveCount(1)
    // 发送按钮自定义图标(🚀 替换内置纸飞机 SVG;loading 停止方块恒内置)
    await expect(page.locator('.chat-dialog .send-btn')).toContainText('🚀')
    await expect(page.locator('.chat-dialog .send-btn svg')).toHaveCount(0)
  })

  test('自定义头像字形生效(user 🙋 / assistant 🛰️ 替换内置 SVG)', async ({ page }) => {
    await page.goto('/examples/minimal-demo/')
    await page.waitForSelector('.chat-dialog')
    await mockLlm(page, [{ text: '图标测试回复完成' }])
    await fillInput(page, '你好')
    await clickSend(page)
    await waitForAgentIdle(page)
    await expect(page.locator('.chat-dialog .message-row.user .message-avatar')).toHaveText('🙋')
    await expect(page.locator('.chat-dialog .message-row.assistant .message-avatar')).toHaveText('🛰️')
  })

  test('默认图标回归(未配 icons 的 demo 保持 🤖/💬)', async ({ page }) => {
    await page.goto('/examples/page-demo/')
    await page.waitForSelector('.chat-dialog')
    await expect(page.locator('.chat-dialog .header-icon')).toHaveText('🤖')
    await expect(page.locator('.chat-dialog .empty-icon')).toHaveText('💬')
  })

  test('HTML 片段图标渲染(内联 svg 经净化后渲染,保留几何属性)', async ({ page }) => {
    await page.goto('/examples/minimal-demo/')
    await page.waitForSelector('.chat-dialog')
    // empty 配置为内联 svg(含 viewBox/stroke/points 几何属性)→ 净化保留 → DOM 出现真实 svg 节点
    const svg = page.locator('.chat-dialog .empty-icon svg')
    await expect(svg).toHaveCount(1)
    await expect(svg.locator('circle')).toHaveCount(3)
    // 白名单属性保留(viewBox 驼峰在 DOM 上为 viewBox)
    const vb = await svg.evaluate((el) => el.getAttribute('viewBox'))
    expect(vb).toBe('0 0 24 24')
  })

  test('HTML 图标净化:onerror 事件属性剥除,不执行脚本', async ({ page }) => {
    await page.goto('/examples/minimal-demo/')
    await page.waitForSelector('.chat-dialog')
    // 首轮延迟 1.2s 制造 loading 窗口;loading 中回车发第二条 → 入排队区(queued 图标 = 带 onerror 的 img 净化 fixture)。
    // 注:loading 中发送键已变 stop,二次派发必须用 Enter(queue.spec 同款范式)
    await mockLlm(page, [{ text: '第一轮回复完成' }, { text: '第二轮完成' }], [1200, 0])
    await fillInput(page, '第一条')
    await clickSend(page)
    await page.waitForSelector('.chat-dialog .stop-btn', { timeout: 10_000 })
    await fillInput(page, '第二条')
    await page.keyboard.press('Enter')
    await page.waitForSelector('.chat-dialog .queued-bar')
    const img = page.locator('.chat-dialog .queued-icon img')
    await expect(img).toHaveCount(1)
    // onerror 被剥(DOMPurify 图标白名单无事件属性)
    const onerror = await img.evaluate((el) => el.getAttribute('onerror'))
    expect(onerror).toBeNull()
    // 排队图标已渲染一段时间,脚本未执行
    await page.waitForTimeout(300)
    const fired = await page.evaluate(() => (window as any).__iconXss)
    expect(fired).toBeUndefined()
  })
})
