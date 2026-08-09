import { test, expect } from '@playwright/test'
import { clearStorage } from './_helpers'

/**
 * custom-dialog demo:chatdialog-component-split 的 sections 区块显隐控制。
 *
 * 验证 dialog.sections: { footer: false, queued: false }:
 *  - footer:false → 输入区(.chat-footer)不渲染
 *  - 默认区块(header/body,未关)仍渲染
 *  - ChatDialog 整体仍挂载(provide ctx + 区块骨架正常)
 */
test.describe('custom-dialog: sections 区块显隐', () => {
  test.beforeEach(async ({ page }) => {
    await clearStorage(page)
    await page.goto('/examples/custom-dialog-demo/')
    await page.waitForSelector('.chat-dialog')
  })

  test('sections footer:false → 输入区(.chat-footer)不渲染', async ({ page }) => {
    expect(await page.locator('.chat-dialog .chat-footer').count()).toBe(0)
  })

  test('默认区块 header 仍渲染(未在 sections 关闭)', async ({ page }) => {
    expect(await page.locator('.chat-dialog .chat-header').count()).toBe(1)
  })

  test('默认区块 body 仍渲染(未在 sections 关闭)', async ({ page }) => {
    expect(await page.locator('.chat-dialog .chat-body').count()).toBe(1)
  })
})
