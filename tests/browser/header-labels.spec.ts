import { test, expect, type Page } from '@playwright/test'

/**
 * 顶部按钮自适应文字标签(ChatHeader container query)+ 图标/文字可配置:
 *  - 头部内容区宽度 ≥440px → 新建/历史/更多 展示「文字+图标」;更窄 → 回退纯图标(关闭钮恒纯图标)
 *  - 图标经 dialog.icons.{newSession,history,more,close} 可配(minimal-demo fixture:newSession='➕')
 *  - 文字走 i18n 既有键 newSession/history/more(i18n-demo en-US → 英文标签;messages 键级覆盖同机制)
 *  - dialog.headerLabels:false 恒纯图标(nested-demo fixture)
 * 驱动方式:挂载容器宽度直接决定 .chat-dialog 宽度,改宽即触发容器查询重算;
 * 不支持 @container 的旧浏览器恒走窄分支 = 纯图标(= 旧行为,优雅降级)。
 */
async function setWidth (page: Page, selector: string, px: number): Promise<void> {
  await page.evaluate(([sel, w]) => {
    const el = document.querySelector(sel as string)
    if (el) (el as HTMLElement).style.width = `${w as number}px`
  }, [selector, px])
}

test.describe('顶部按钮自适应文字标签', () => {
  test('宽度足够(620px):新建/历史/更多 展示文字+图标(文字在前)', async ({ page }) => {
    await page.goto('/examples/minimal-demo/')
    await page.waitForSelector('.chat-dialog')
    await setWidth(page, '#chat-root', 620)
    const newLabel = page.locator('.chat-dialog [data-test="new-chat"] .action-label')
    await expect(newLabel).toBeVisible()
    await expect(newLabel).toHaveText('新建会话')
    await expect(page.locator('.chat-dialog [data-test="toggle-history"] .action-label')).toHaveText('历史记录')
    await expect(page.locator('.chat-dialog .more-btn .action-label')).toHaveText('更多')
    // 顺序锁定:文字在前、图标在后(Figma 469-6355)
    const order = await page.locator('.chat-dialog [data-test="new-chat"]').evaluate((el) =>
      Array.from(el.children).map((c) => c.className))
    expect(order[0]).toContain('action-label')
  })

  test('宽度不足(320px):标签隐藏回退纯图标,按钮仍可交互', async ({ page }) => {
    await page.goto('/examples/minimal-demo/')
    await page.waitForSelector('.chat-dialog')
    await setWidth(page, '#chat-root', 320)
    await expect(page.locator('.chat-dialog [data-test="new-chat"] .action-label')).toBeHidden()
    await expect(page.locator('.chat-dialog .more-btn .action-label')).toBeHidden()
    // 纯图标态功能不回归:更多菜单照常打开
    await page.click('.chat-dialog .more-btn')
    await expect(page.locator('.chat-dialog .more-menu')).toBeVisible()
  })

  test('按钮图标可配置(dialog.icons.newSession 替换内置 SVG)', async ({ page }) => {
    await page.goto('/examples/minimal-demo/')
    await page.waitForSelector('.chat-dialog')
    await setWidth(page, '#chat-root', 620)
    // fixture '➕' → IconGlyph 文本路径:无内置 svg 节点,字形 + 标签同屏(顺序由场景1的 className 断言锁定)
    const btn = page.locator('.chat-dialog [data-test="new-chat"]')
    await expect(btn.locator('svg')).toHaveCount(0)
    await expect(btn).toContainText('新建会话')
    await expect(btn).toContainText('➕')
    // 未配置的键保持内置 SVG(更多按钮 ⋈)
    await expect(page.locator('.chat-dialog .more-btn > svg')).toHaveCount(1)
  })

  test('i18n 英文标签(en-US locale → New chat/History/More)', async ({ page }) => {
    await page.goto('/examples/i18n-demo/')
    await page.waitForSelector('.chat-dialog')
    await setWidth(page, '#chat-root', 620)
    await expect(page.locator('.chat-dialog [data-test="new-chat"] .action-label')).toHaveText('New chat')
    await expect(page.locator('.chat-dialog [data-test="toggle-history"] .action-label')).toHaveText('History')
    await expect(page.locator('.chat-dialog .more-btn .action-label')).toHaveText('More')
  })

  test('headerLabels:false 恒纯图标(宽度足够也不展示文字)', async ({ page }) => {
    await page.goto('/examples/nested-demo/')
    await page.waitForSelector('.chat-dialog')
    await setWidth(page, '.pane-right', 620)
    await expect(page.locator('.chat-dialog [data-test="new-chat"] .action-label')).toBeHidden()
    await expect(page.locator('.chat-dialog .more-btn .action-label')).toBeHidden()
    // 图标仍在(纯图标态)
    await expect(page.locator('.chat-dialog .more-btn > svg')).toHaveCount(1)
  })
})
