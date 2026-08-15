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
    await expect(page.locator('.chat-dialog .empty-icon')).toHaveText('🪐')
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
})
