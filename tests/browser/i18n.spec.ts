import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle } from './_helpers'

/**
 * 国际化(顶层 i18n:{ locale, messages };3.22+ 原 dialog.locale/dialog.messages 合并):
 * locale 切换 + messages 键级覆盖(含 HTML 片段净化渲染)。
 * fixture:i18n-demo(i18n.locale 'en-US' + statusDone/emptyGreeting HTML 覆盖);zh-CN 默认回归由其余 spec 中文断言间接锁定。
 */
test.describe('国际化(i18n.locale / i18n.messages)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/i18n-demo/')
    await page.waitForSelector('.chat-dialog')
  })

  test('en locale:标题/占位符/空态/发送提示切英文 + 空态 HTML 片段净化渲染', async ({ page }) => {
    await expect(page.locator('.chat-dialog .header-title')).toHaveText('Page Agent') // 显式 title 优先
    await expect(page.locator('.chat-dialog .chat-input')).toHaveAttribute('placeholder', 'Type a message, Enter to send...')
    // emptyGreeting HTML 片段:<b> 净化放行(文案白名单),文本完整保留
    await expect(page.locator('.chat-dialog .empty-state p b')).toHaveText('Hello!')
    await expect(page.locator('.chat-dialog .empty-state p')).toHaveText('Hello! How can I help you?')
    await expect(page.locator('.chat-dialog .send-hint')).toContainText('Enter to send')
  })

  test('en locale + messages 覆盖:状态标签富文本 Done ✓(HTML 片段净化渲染,键级覆盖优先于 locale 包)', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: {} }] },
      { text: 'Done with the read.' },
    ])
    await fillInput(page, 'read the data')
    await clickSend(page)
    await waitForAgentIdle(page)
    // HTML 值经文案白名单净化 → <b style> 保留渲染,可见文本仍是 Done ✓
    await expect(page.locator('.chat-dialog .step-status.done b').first()).toHaveText('Done ✓')
    await expect(page.locator('.chat-dialog .step-status.done').first()).toContainText('Done')
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

  test('HTML 文案净化:script/事件属性剥除,白名单标签与 style 保留(安全面)', async ({ page }) => {
    const sanitized = await page.evaluate(async () => {
      const m = await import('/src/core/components/iconHtml.ts')
      return {
        ok: m.sanitizeMessageHtml('<b style="color:green" onclick="alert(1)">Done</b><script>evil()</script><a href="javascript:x">l</a>'),
        plain: m.sanitizeMessageHtml('plain text'),
      }
    })
    expect(sanitized.ok).toContain('<b style="color:green">Done</b>')  // 白名单标签 + style 保留
    expect(sanitized.ok).not.toContain('onclick')                       // 事件属性剥
    expect(sanitized.ok).not.toContain('script')                        // script 剥
    expect(sanitized.ok).not.toContain('<a')                            // a 不在文案白名单
    expect(sanitized.plain).toBe('plain text')                          // 纯文本原样
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
