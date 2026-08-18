import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle } from './_helpers'

/**
 * 图片输入(image-input-vision Phase 1)浏览器交互:
 * 📎 三入口(选择/粘贴)+ chip 删除 + 大图拒绝 + 数量上限 + 非 vision 诚实报错 + 多模态直发请求形态。
 * 压缩闸(canvas)真跑:图片用页面截图/画布产出的真实 PNG。
 */

/** 用页面自身截图产一张真实可解码 PNG(setInputFiles buffer) */
async function realPng(page: import('@playwright/test').Page): Promise<Buffer> {
  return await page.screenshot()
}

test.describe('图片输入(image-input-vision)', () => {
  test('📎 选择图片 → chip 渲染 + ✕ 删除', async ({ page }) => {
    await page.goto('/examples/minimal-demo/')
    await page.waitForSelector('.chat-dialog')
    await page.setInputFiles('[data-test="attach-input"]', { name: 'a.png', mimeType: 'image/png', buffer: await realPng(page) })
    await expect(page.locator('[data-test="img-chips"] .img-chip')).toHaveCount(1)
    await expect(page.locator('[data-test="img-chips"] .img-chip-thumb')).toBeVisible()
    // ✕ 删除 → 待发区清空
    await page.click('[data-test="img-chip-x"]')
    await expect(page.locator('[data-test="img-chips"] .img-chip')).toHaveCount(0)
  })

  test('粘贴截图 → chip 渲染(clipboardData 通道)', async ({ page }) => {
    await page.goto('/examples/minimal-demo/')
    await page.waitForSelector('.chat-dialog')
    await page.evaluate(async () => {
      // 画布产真实 PNG blob → DataTransfer → 派发 paste(模拟截图直贴)
      const c = document.createElement('canvas')
      c.width = 40
      c.height = 30
      c.getContext('2d')!.fillRect(0, 0, 40, 30)
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))
      const dt = new DataTransfer()
      dt.items.add(new File([blob], 'paste.png', { type: 'image/png' }))
      ;(document.querySelector('.chat-input') as HTMLElement).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt }))
    })
    await expect(page.locator('[data-test="img-chips"] .img-chip')).toHaveCount(1)
  })

  test('>20MB 大图 → 输入侧拒绝(img-error),不进 chip', async ({ page }) => {
    await page.goto('/examples/minimal-demo/')
    await page.waitForSelector('.chat-dialog')
    const big = Buffer.alloc(21 * 1024 * 1024, 1) // 超 20MB 硬闸(压缩前拒,不解码)
    await page.setInputFiles('[data-test="attach-input"]', { name: 'big.png', mimeType: 'image/png', buffer: big })
    await expect(page.locator('[data-test="img-error"]')).toBeVisible()
    await expect(page.locator('[data-test="img-chips"] .img-chip')).toHaveCount(0)
  })

  test('一次选 5 张 → 仅前 4 进 chip + 数量上限提示', async ({ page }) => {
    await page.goto('/examples/minimal-demo/')
    await page.waitForSelector('.chat-dialog')
    const png = await realPng(page)
    const files = [1, 2, 3, 4, 5].map((i) => ({ name: `f${i}.png`, mimeType: 'image/png', buffer: png }))
    await page.setInputFiles('[data-test="attach-input"]', files)
    await expect(page.locator('[data-test="img-chips"] .img-chip')).toHaveCount(4)
    await expect(page.locator('[data-test="img-error"]')).toBeVisible()
  })

  test('非多模态主模型 + 带图发送 → 诚实报错(不静默丢图、不误发)', async ({ page }) => {
    await page.goto('/examples/minimal-demo/')
    await page.waitForSelector('.chat-dialog')
    const { calls } = await mockLlm(page, [{ text: '不该到达' }])
    await page.setInputFiles('[data-test="attach-input"]', { name: 'a.png', mimeType: 'image/png', buffer: await realPng(page) })
    await fillInput(page, '看这张图')
    await clickSend(page)
    // 门禁在 core.stream:消息已带图 push,生成失败 → error-bar 展示引导文案
    await expect(page.locator('.error-bar')).toBeVisible()
    await expect(page.locator('.error-text')).toContainText('不支持图片输入')
    // user 消息缩略图行已渲染(消息不丢)
    await expect(page.locator('.msg-images')).toHaveCount(1)
    expect(calls()).toBe(0) // 模型零调用
  })

  test('多模态主模型(setLlm gpt-4.1)→ content parts 直发(image_url 形态)', async ({ page }) => {
    await page.goto('/examples/complex-demo/')
    await page.waitForSelector('.chat-dialog')
    // 表命中 gpt-4.1(vision true + ≥200K 窗口过最小窗口校验)→ 直发通道
    await page.evaluate(() => (window as any).__sdk.setLlm({ apiKey: 'sk-test', model: 'gpt-4.1' }))
    const bodies: string[] = []
    page.on('request', (r) => {
      if (r.url().includes('/chat/completions')) bodies.push(r.postData() || '')
    })
    await mockLlm(page, [{ text: '收到图片' }])
    await page.setInputFiles('[data-test="attach-input"]', { name: 'a.png', mimeType: 'image/png', buffer: await realPng(page) })
    await fillInput(page, '看这张图')
    await clickSend(page)
    await waitForAgentIdle(page)
    // 请求体:最后一条 user 消息 content 为 parts 数组(text + image_url dataURI)
    const hit = bodies.map((b) => { try { return JSON.parse(b) } catch { return null } }).find((b: any) => {
      const msgs = b?.messages ?? []
      return msgs.some((m: any) => Array.isArray(m.content) && m.content.some((p: any) => p?.type === 'image_url'))
    })
    expect(hit, '请求含 image_url content parts').toBeTruthy()
    const userParts = hit.messages.filter((m: any) => Array.isArray(m.content)).at(-1).content
    const textPart = userParts.find((p: any) => p?.type === 'text')
    const imgPart = userParts.find((p: any) => p?.type === 'image_url')
    expect(textPart?.text).toContain('看这张图')
    expect(String(imgPart?.image_url?.url)).toMatch(/^data:image\//)
    // 消息区缩略图行渲染
    await expect(page.locator('.msg-images')).toHaveCount(1)
  })
})
