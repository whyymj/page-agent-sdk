import { test, expect } from '@playwright/test'
import path from 'node:path'
import { mockLlm, fillInput, clickSend, waitForAgentIdle } from './_helpers'

/**
 * ui-quick-wins Q2 会话导出/导入(minimal-demo ?transfer=1):
 *  - UI 入口:sessionTransfer 开 → 历史面板底部「导出会话/导入会话…」;默认不配置零渲染
 *  - 导出:点击产生 .json 下载(blob URL anchor)
 *  - 导入:选文件 → importSession 副本落库 → 自动切换 → 消息恢复
 */
test.describe('会话导出/导入 sessionTransfer(ui-quick-wins Q2)', () => {
  test('sessionTransfer 开启 → 历史面板底部出现导出/导入入口', async ({ page }) => {
    await page.goto('/examples/minimal-demo/?transfer=1')
    await page.waitForSelector('.chat-dialog')
    await page.click('.chat-dialog [data-test="toggle-history"]')
    await expect(page.locator('.chat-dialog [data-test="export-session"]')).toBeVisible()
    await expect(page.locator('.chat-dialog [data-test="import-session"]')).toBeVisible()
  })

  test('默认不配置零渲染(历史面板无 transfer 入口)', async ({ page }) => {
    await page.goto('/examples/minimal-demo/')
    await page.waitForSelector('.chat-dialog')
    await page.click('.chat-dialog [data-test="toggle-history"]')
    await expect(page.locator('.chat-dialog [data-test="export-session"]')).toHaveCount(0)
    await expect(page.locator('.chat-dialog [data-test="import-session"]')).toHaveCount(0)
  })

  test('点击导出 → 产生 .json 下载', async ({ page }) => {
    await page.goto('/examples/minimal-demo/?transfer=1')
    await page.waitForSelector('.chat-dialog')
    // 先造一条消息(空会话导出内容无意义);fillInput+clickSend 记 baseline(waitForAgentIdle 依赖)
    await mockLlm(page, [{ text: '导出前回复' }])
    await fillInput(page, '导出前提问')
    await clickSend(page)
    await waitForAgentIdle(page)
    await page.click('.chat-dialog [data-test="toggle-history"]')
    const dlPromise = page.waitForEvent('download')
    await page.click('.chat-dialog [data-test="export-session"]')
    const dl = await dlPromise
    expect(dl.suggestedFilename()).toMatch(/chat-session-.{0,6}\.json$/)
  })

  test('导入会话文件 → 副本落库并切换,消息恢复', async ({ page }) => {
    await page.goto('/examples/minimal-demo/?transfer=1')
    await page.waitForSelector('.chat-dialog')
    // 导入 input 在历史面板的 transfer 区内,先开面板
    await page.click('.chat-dialog [data-test="toggle-history"]')
    // 手工构造合法信封(与 exportSession 产物同构;messages 最小形态)
    const envelope = JSON.stringify({
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      sessionId: 'browser-fixture-src',
      snapshot: { messages: [{ role: 'user', content: '导入文件里的消息' }, { role: 'assistant', content: '导入文件里的回复' }] },
    })
    await page.setInputFiles('.chat-dialog input[type="file"][accept="application/json,.json"]', {
      name: 'import-fixture.json',
      mimeType: 'application/json',
      buffer: Buffer.from(envelope, 'utf-8'),
    })
    // 导入 → 自动 switchSession → 消息渲染(历史面板自动开/关不影响 body 断言)
    await expect(page.locator('.chat-dialog .message-row.user').last()).toContainText('导入文件里的消息', { timeout: 15_000 })
    await expect(page.locator('.chat-dialog .message-row.assistant').last()).toContainText('导入文件里的回复')
    // 导入失败路径:坏 JSON 文件 → 不切换 + 无消息变化(错误走 observable 事件,UI 不炸)
    const before = await page.locator('.chat-dialog .message-row').count()
    await page.setInputFiles('.chat-dialog input[type="file"][accept="application/json,.json"]', {
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{not json', 'utf-8'),
    })
    await page.waitForTimeout(500)
    expect(await page.locator('.chat-dialog .message-row').count()).toBe(before)
  })
})
