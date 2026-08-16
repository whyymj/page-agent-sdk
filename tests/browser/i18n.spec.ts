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

  // ===== Phase 2:Debug 抽屉 / Skill 面板文案跟随 locale =====
  test('en locale:Debug 抽屉 tab/过滤器切英文(Phase 2)', async ({ page }) => {
    await page.click('.chat-dialog .more-btn')
    await page.click('.chat-dialog .more-item:first-child') // Debug / Logs
    await page.waitForSelector('.debug-drawer .tab-btn')
    // tab 英文(Logs/Flow 固定渲染;其余 tab 需 getInfo,有则断言)
    await expect(page.locator('.debug-drawer .tab-btn').first()).toContainText('Logs')
    await expect(page.locator('.debug-drawer .tab-btn').nth(1)).toContainText('Flow')
    const tabCount = await page.locator('.debug-drawer .tab-btn').count()
    if (tabCount > 4) {
      await expect(page.locator('.debug-drawer .tab-btn').nth(3)).toContainText('Context')
      await expect(page.locator('.debug-drawer .tab-btn').nth(4)).toContainText('Sub-agents')
      await expect(page.locator('.debug-drawer .tab-btn').nth(5)).toContainText('Agent info')
    }
    // 日志过滤器标签(空抽屉也有 chips)
    await expect(page.locator('.debug-drawer .filter-chip').first()).toContainText('Context')
    await expect(page.locator('.debug-drawer .filter-chip.all')).toContainText('All')
  })

  test('en locale:Skill 管理面板文案切英文(Phase 2)', async ({ page }) => {
    await page.click('.chat-dialog .more-btn')
    await page.click('.chat-dialog .more-item:nth-child(2)') // Skills
    await page.waitForSelector('.skill-panel')
    await expect(page.locator('.skill-panel .skill-title')).toHaveText('🧩 Skills')
    await expect(page.locator('.skill-panel .section-title').first()).toContainText('Create new skill')
    await expect(page.locator('.skill-panel .btn-primary')).toContainText('Add skill')
    await expect(page.locator('.skill-panel .empty-hint')).toContainText('No user-created skills yet')
    // 表单校验错误也走文案集(en)
    await page.click('.skill-panel .btn-primary')
    await expect(page.locator('.skill-panel .skill-error')).toContainText('Skill name cannot be empty')
  })

  test('en locale:默认 systemPrompt 用英文版(agent 语言与 UI 一致,Phase 2)', async ({ page }) => {
    await mockLlm(page, [{ text: 'Hello!' }])
    // 叠加 route(后注册先被调)只捕获请求体,route.fallback() 移交 mockLlm 响应
    const bodies: string[] = []
    await page.route('**/chat/completions', async (route) => {
      bodies.push(route.request().postData() ?? '')
      await route.fallback()
    })
    await fillInput(page, 'hi')
    await clickSend(page)
    await waitForAgentIdle(page)
    const req = bodies.find((b) => b.includes('messages'))
    expect(req).toBeTruthy()
    expect(req).toContain('JSON operations assistant') // EN 身份段
    expect(req).toContain('Respond in English') // 语言锚
    expect(req).toContain('[Reliable write rules]') // EN 规则段
    expect(req).not.toContain('JSON 操作助手') // 不再是中文默认 prompt
  })
})
