import { test, expect } from '@playwright/test'
import { mockLlm } from './_helpers'

/**
 * customize-demo 浏览器 E2E:headless 自建对话框 + 低代码 + 组件聚焦
 *
 * 验证:
 *  - 自建 .my-dialog + 低代码 .preview 渲染 + 深色 + 无内置 .chat-dialog(ui:false)
 *  - headless 接线发消息走通(sdk.stream + 流式 delta)
 *  - 低代码:mock write 改 title → steps + reactive bind 预览实时刷新
 *  - 聚焦:点卡片选中(边界)→ 加入聊天 → 自建 chip → ✕ 移除(纯前端,无需 LLM)
 *  - 聚焦历史:聚焦后发消息 → user message 标注焦点 chip;退出聚焦后历史标注仍保留(快照语义)
 *  - 会话管理:新建会话清空当前 + 历史面板列会话(高亮当前)+ 切回恢复对话(switchSession/sessions/deleteSession)
 *  - 调试抽屉:🛠 打开内置 DebugDrawer(复用;Agent 信息 tab + 日志区;纯 props 驱动 headless 可直接用)
 *
 * 注:不用 fillInput/clickSend/waitForAgentIdle helper(绑内置 .chat-dialog;headless 无)。
 *     reasoning 依赖模型支持,mock 不触发,spec 不验证。
 */
test.describe('customize-demo: headless 自建对话框 + 低代码 + 聚焦', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/customize-demo/')
    await page.waitForSelector('.my-dialog')
  })

  test('完全自建对话框 + 低代码预览渲染(ui:false,不依赖内置 ChatDialog)', async ({ page }) => {
    expect(await page.locator('.chat-dialog').count(), 'ui:false 不渲染内置 .chat-dialog').toBe(0)
    await expect(page.locator('.my-dialog')).toBeVisible()
    await expect(page.locator('.preview')).toBeVisible()
    await expect(page.locator('.my-dialog__title')).toContainText('Night Fox')
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.my-dialog')!).backgroundColor)
    expect(bg, '自建深色主题背景为 #0f0f1a').toBe('rgb(15, 15, 26)')
  })

  test('headless 接线发消息走通(sdk.stream + 流式 delta → AI 回复)', async ({ page }) => {
    await mockLlm(page, [{ text: '你好,我是 Night Fox 助手。' }])
    await page.fill('.my-dialog__footer textarea', '你好')
    await page.click('.my-dialog__send')
    await expect(page.locator('.my-dialog__body .msg--assistant').last()).toContainText('Night Fox 助手', { timeout: 30000 })
  })

  test('低代码:agent write 改数据 → 工具步骤渲染 + reactive bind 预览实时刷新', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { value: '新品首发', patch: { op: 'set', jsonPath: 'title' } } }] },
      { text: '已把标题改成「新品首发」。' },
    ])
    await page.fill('.my-dialog__footer textarea', '把标题改成新品首发')
    await page.click('.my-dialog__send')
    await expect(page.locator('.my-dialog__body .step__name').first()).toContainText('write', { timeout: 30000 })
    await expect(page.locator('.my-dialog__body .step--done').first()).toBeVisible({ timeout: 10000 })
    await expect(page.locator('.preview__title')).toContainText('新品首发', { timeout: 10000 })
    await expect(page.locator('.my-dialog__body .msg--assistant').last()).toContainText('新品首发', { timeout: 30000 })
  })

  test('聚焦:点卡片选中(边界)→ 加入聊天 → 自建 chip → ✕ 移除', async ({ page }) => {
    // 点第一张卡片 → 选中(.selected 边界 + 「加入聊天」按钮)
    await page.click('[data-path="cards.0"]')
    await expect(page.locator('.card.selected')).toBeVisible()
    await expect(page.locator('.pick-btn')).toBeVisible()
    // 加入聊天 → addFocus → 自建 chip 出现(headless 无内置 chip,自己渲染 .focus-chip)
    await page.click('.pick-btn')
    await expect(page.locator('.focus-chip')).toBeVisible()
    await expect(page.locator('.focus-chip')).toContainText('cards.0')
    // ✕ 移除焦点 → chip 消失
    await page.locator('.focus-chip__x').click()
    await expect(page.locator('.focus-chip')).toHaveCount(0)
  })

  test('聚焦后发消息 → 历史 user message 标注焦点 chip(可追溯发出时的聚焦对象)', async ({ page }) => {
    // 点第一张卡片 → 加入聊天(addFocus)
    await page.click('[data-path="cards.0"]')
    await page.click('.pick-btn')
    await expect(page.locator('.focus-chip')).toContainText('cards.0') // 当前焦点栏确认聚焦
    // 聚焦状态下发消息(mock text 回复)
    await mockLlm(page, [{ text: '好的,我只改这张卡片。' }])
    await page.fill('.my-dialog__footer textarea', '把这张卡片标题改成亮点')
    await page.click('.my-dialog__send')
    // 历史 user message 上出现焦点标注 chip(含发出时的聚焦路径)
    await expect(page.locator('.msg--user .msg-focus-chip').first()).toContainText('cards.0', { timeout: 30000 })
    // 退出聚焦后,当前焦点栏 chip 消失,但历史标注仍保留(快照语义,不受当前焦点变化影响)
    await page.locator('.focus-chip__x').click()
    await expect(page.locator('.focus-chip')).toHaveCount(0)
    await expect(page.locator('.msg--user .msg-focus-chip')).toHaveCount(1)
  })

  test('会话管理:新建会话清空当前 + 历史切回恢复对话', async ({ page }) => {
    // 当前会话发条消息(产生可恢复的历史)
    await mockLlm(page, [{ text: '收到,这是回复。' }])
    await page.fill('.my-dialog__footer textarea', '第一条消息')
    await page.click('.my-dialog__send')
    await expect(page.locator('.my-dialog__body .msg--assistant').last()).toContainText('这是回复', { timeout: 30000 })
    // ➕ 新建会话 → 当前清空(.empty 提示出现)
    await page.click('button[title="新建会话"]')
    await expect(page.locator('.empty')).toBeVisible({ timeout: 10000 })
    // 🗂 打开历史 → 列表非空 + 当前会话高亮(.current)
    await page.click('button[title="历史会话"]')
    await expect(page.locator('.history-item')).not.toHaveCount(0)
    await expect(page.locator('.history-item.current')).toHaveCount(1)
    // 点旧会话(非当前)→ 切回 → 消息恢复(empty 消失 + 首条 user 消息回归)
    await page.locator('.history-item:not(.current)').first().click()
    await expect(page.locator('.empty')).not.toBeVisible({ timeout: 10000 })
    await expect(page.locator('.my-dialog__body .msg--user').first()).toContainText('第一条消息', { timeout: 10000 })
  })

  test('调试抽屉(DebugDrawer 复用):🛠 打开 → Agent 信息 tab + 日志区', async ({ page }) => {
    // 初始隐藏
    await expect(page.locator('.debug-drawer')).toHaveCount(0)
    // 点 🛠 → DebugDrawer 显示(内置组件复用,纯 props 驱动)
    await page.click('button[title="调试"]')
    await expect(page.locator('.debug-drawer')).toBeVisible({ timeout: 5000 })
    // Agent 信息 tab 在(getInfo 注入 sdk.inspect)
    await expect(page.locator('.debug-drawer')).toContainText('Agent 信息')
    // 注:关闭由 DebugDrawer 内置关闭按钮(抽屉覆盖 header,🛠 被遮),非本测试重点
  })
})
