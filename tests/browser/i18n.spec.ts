import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle } from './_helpers'

/**
 * dialog-i18n Phase 1(openspec 2026-08-16-dialog-i18n):locale 切换 + messages 键级覆盖。
 * fixture:i18n-demo(locale 'en-US' + statusDone 'Done ✓' 覆盖);zh-CN 默认回归由其余 spec 中文断言间接锁定。
 */
test.describe('对话框国际化(dialog.locale / dialog.messages)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/i18n-demo/')
    await page.waitForSelector('.chat-dialog')
  })

  test('en locale:标题/占位符/空态/发送提示切英文', async ({ page }) => {
    await expect(page.locator('.chat-dialog .header-title')).toHaveText('Page Agent') // 显式 title 优先
    await expect(page.locator('.chat-dialog .chat-input')).toHaveAttribute('placeholder', 'Type a message, Enter to send...')
    await expect(page.locator('.chat-dialog .empty-state p')).toHaveText('How can I help you?')
    await expect(page.locator('.chat-dialog .send-hint')).toContainText('Enter to send')
  })

  test('en locale + messages 覆盖:步骤状态标签显示 Done ✓(键级覆盖优先于 locale 包)', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: {} }] },
      { text: 'Done with the read.' },
    ])
    await fillInput(page, 'read the data')
    await clickSend(page)
    await waitForAgentIdle(page)
    await expect(page.locator('.chat-dialog .step-status.done').first()).toHaveText('Done ✓') // 覆盖值
    // 其余未覆盖键走 en 包
    await page.click('.step-detail-toggle')
    await expect(page.locator('.step-detail-head').first()).toContainText('Args')
  })
})
