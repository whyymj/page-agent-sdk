import { test, expect } from '@playwright/test'
import { mockLlm, waitForAgentIdle } from './_helpers'

/**
 * ui-quick-wins Q1/Q4(minimal-demo ?quick=1 / ?drop=1):
 *  - Q1 快捷指令:chips 渲染(坏项装配期过滤)/ 点击直接发送 prompt(不预填输入框)/ 默认不配置零渲染
 *  - Q4 元素拖入:dragstart 捕获源元素 → drop 无文件分流回调;未声明回调零行为
 */
test.describe('快捷指令 quickActions(ui-quick-wins Q1)', () => {
  test('chips 渲染 + 坏项过滤 + 点击直接发送', async ({ page }) => {
    await page.goto('/examples/minimal-demo/?quick=1')
    await page.waitForSelector('.chat-dialog')
    await mockLlm(page, [{ text: '快捷指令回复完成' }])
    // 坏项(缺 prompt)被装配期过滤 → 只渲染 2 个 chip;icon 前缀拼接
    const chips = page.locator('.chat-dialog [data-test="quick-actions"] .quick-action-chip')
    await expect(chips).toHaveCount(2)
    await expect(chips.first()).toHaveText('加一张卡片')
    await expect(chips.nth(1)).toHaveText('🎨 换个主题')
    // 点击 = 直接发送完整 prompt(title 可见全文);不预填输入框
    // baseline 手动记(chip 直发不走 clickSend;waitForAgentIdle 的兜底「当场取」会与 mock 快速响应竞态)
    ;(page as unknown as { _paAssistantBaseline?: number })._paAssistantBaseline = await page.evaluate(
      () => document.querySelectorAll('.chat-dialog .message-row.assistant[data-msg-idx]').length,
    )
    await chips.first().click()
    await expect(page.locator('.chat-dialog .message-row.user').last()).toContainText('帮我加一张介绍优点的卡片')
    await waitForAgentIdle(page)
    await expect(page.locator('.chat-dialog .message-row.assistant').last()).toContainText('快捷指令回复完成')
    await expect(page.locator('.chat-dialog .chat-input')).toHaveValue('')
  })

  test('默认不配置零渲染(零配置零行为面)', async ({ page }) => {
    await page.goto('/examples/minimal-demo/')
    await page.waitForSelector('.chat-dialog')
    await expect(page.locator('.chat-dialog [data-test="quick-actions"]')).toHaveCount(0)
  })
})

test.describe('元素拖入聚焦入口 onDropElement(ui-quick-wins Q4)', () => {
  test('拖宿主元素进输入框 → 回调收到源元素', async ({ page }) => {
    await page.goto('/examples/minimal-demo/?drop=1')
    await page.waitForSelector('.chat-dialog')
    // 源元素在宿主页(#drag-source draggable);dragstart bubbles 到 window 捕获记录,drop 无文件时分流回调
    await page.evaluate(`(() => {
      document.getElementById('drag-source').dispatchEvent(new DragEvent('dragstart', { bubbles: true }))
      document.querySelector('.chat-dialog .chat-input-wrap').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
    })()`)
    const tag = await page.evaluate<string>(() => String((window as unknown as Record<string, unknown>).__droppedTag ?? ''))
    expect(tag).toBe('P')
  })

  test('未拖源元素时 drop 零行为(不抛错不回调)', async ({ page }) => {
    await page.goto('/examples/minimal-demo/?drop=1')
    await page.waitForSelector('.chat-dialog')
    await page.evaluate(`(() => {
      document.querySelector('.chat-dialog .chat-input-wrap').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
    })()`)
    const tag = await page.evaluate<unknown>(() => (window as unknown as Record<string, unknown>).__droppedTag)
    expect(tag).toBeUndefined()
  })

  test('未声明 onDropElement 的 demo 拖入零行为(默认路径)', async ({ page }) => {
    await page.goto('/examples/minimal-demo/')
    await page.waitForSelector('.chat-dialog')
    // 无回调配置 → 无 dragstart 监听;drop 不抛错即通过
    await page.evaluate(`(() => {
      document.querySelector('.chat-dialog .chat-input-wrap').dispatchEvent(new DragEvent('dragstart', { bubbles: true }))
      document.querySelector('.chat-dialog .chat-input-wrap').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }))
    })()`)
    await expect(page.locator('.chat-dialog .chat-input')).toBeVisible()
  })
})
