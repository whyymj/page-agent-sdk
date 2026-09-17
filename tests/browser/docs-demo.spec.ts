import { test, expect, type Page } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle } from './_helpers'

/**
 * 学习文档站集成模板(docs-demo):划词引用(page-quote)+ read_page 正文提取 + pageContext 页面锚点。
 * 覆盖:选中→点「问 AI」开抽屉捕获 / 选中→点输入框 pointerdown 捕获 / chip 删除重挂 / 气泡引用块 /
 * LLM 请求体引用前缀 / read_page 两轮 ReAct(结果不含 SDK 对话框文案)/ system 含页面锚点 /
 * quickActions 不消费待发引用。
 */

/** 在文章第 N 段上划选一段文字(自建 Range + addRange;不依赖鼠标轨迹) */
async function selectArticleText(page: Page, marker: string): Promise<void> {
  await page.evaluate((m) => {
    const ps = Array.from(document.querySelectorAll('.docs-article p'))
    const p = ps.find((el) => (el.textContent ?? '').includes(m)) ?? ps[0]
    const text = p.firstChild!
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, Math.min(40, text.textContent?.length ?? 10))
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
  }, marker)
}

/** 记录 agent 主链 LLM 请求体(过滤 autoTitle 标题生成请求;route.fallback 交还 mockLlm 处理,后注册者先命中) */
async function recordLlmBodies(page: Page): Promise<string[]> {
  const bodies: string[] = []
  await page.route('**/chat/completions**', async (route) => {
    const data = route.request().postData() ?? ''
    if (!data.includes('生成一个简短的中文标题')) bodies.push(data)
    await route.fallback()
  })
  return bodies
}

/** 打开抽屉(drawerHidden 初始隐藏,点宿主按钮 show) */
async function openDrawer(page: Page): Promise<void> {
  await page.locator('[data-test="ask-btn"]').click()
  await expect(page.locator('.chat-dialog')).toBeVisible()
}

test.describe('划词引用 page-quote(docs-demo)', () => {
  test('选中 → 点「问 AI」开抽屉 → 引用 chip + 发送(请求体前缀 + 气泡引用块)', async ({ page }) => {
    await page.goto('/examples/docs-demo/')
    await page.waitForSelector('.chat-dialog', { state: 'attached' }) // drawerHidden 初始隐藏(元素在)
    await mockLlm(page, [{ text: '这段讲的是注意力机制的核心思想' }])
    const bodies = await recordLlmBodies(page) // 后于 mockLlm 注册(后注册先命中,记录后 fallback 交还)

    await selectArticleText(page, '注意力机制的核心思想')
    await openDrawer(page) // show() 懒捕获(按钮 @mousedown.prevent 保住选区)
    await expect(page.locator('[data-test="quote-chips"] .quote-chip')).toHaveCount(1)
    await expect(page.locator('[data-test="quote-chips"] .quote-chip-text')).toContainText('Transformer 学习笔记 ·')

    await fillInput(page, '这段什么意思')
    await clickSend(page)
    await waitForAgentIdle(page)
    // 消息数组:content 干净 + quote 侧字段(气泡渲染结构化引用块)
    await expect(page.locator('.chat-dialog .message-row.user').last()).toContainText('这段什么意思')
    await expect(page.locator('[data-test="msg-quote"] .msg-quote-text')).toContainText('注意力机制的核心思想')
    await expect(page.locator('[data-test="msg-quote"] .msg-quote-source')).toContainText('Transformer 学习笔记')
    // LLM 请求体:引用块前缀在用户 content 之前
    const lastUser = JSON.parse(bodies.at(-1) ?? '{}').messages?.filter((m: { role: string }) => m.role === 'user').at(-1)
    expect(String(lastUser?.content)).toMatch(/^\[引用原文\(来源:[^\n]+\)\]\n"""\n注意力机制/)
    // 发送后待发区清空
    await expect(page.locator('[data-test="quote-chips"] .quote-chip')).toHaveCount(0)
  })

  test('chip ✕ 删除 → 再选 → 点输入框(pointerdown 捕获)重挂', async ({ page }) => {
    await page.goto('/examples/docs-demo/')
    await page.waitForSelector('.chat-dialog', { state: 'attached' })
    await mockLlm(page, [{ text: '好' }])

    await selectArticleText(page, '多头注意力')
    await openDrawer(page)
    await expect(page.locator('[data-test="quote-chips"] .quote-chip')).toHaveCount(1)
    await page.click('[data-test="quote-clear"]')
    await expect(page.locator('[data-test="quote-chips"] .quote-chip')).toHaveCount(0)

    // 再选一段 → 点输入区:pointerdown.capture 在塌缩前捕获
    await selectArticleText(page, 'KV Cache')
    await page.locator('.chat-dialog .chat-input-wrap').click()
    await expect(page.locator('[data-test="quote-chips"] .quote-chip')).toHaveCount(1)
    await expect(page.locator('[data-test="quote-chips"] .quote-chip-text')).toContainText('KV Cache')
  })

  test('quickActions 点击不消费待发引用(chip 保留)', async ({ page }) => {
    await page.goto('/examples/docs-demo/')
    await page.waitForSelector('.chat-dialog', { state: 'attached' })
    await mockLlm(page, [{ text: '本页概览' }])
    ;(page as unknown as { _paAssistantBaseline?: number })._paAssistantBaseline = 0

    await selectArticleText(page, '位置编码')
    await openDrawer(page)
    await expect(page.locator('[data-test="quote-chips"] .quote-chip')).toHaveCount(1)
    await page.locator('[data-test="quick-actions"] .quick-action-chip').first().click()
    await expect(page.locator('.chat-dialog .message-row.user').last()).toContainText('这个页面讲了什么')
    await waitForAgentIdle(page)
    // 排队/快捷指令均不消费待发引用(quickActions 是罐头 prompt;引用留给下一条手动消息)
    await expect(page.locator('[data-test="quote-chips"] .quote-chip')).toHaveCount(1)
  })
})

test.describe('read_page + pageContext(docs-demo)', () => {
  test('页面问答:read_page 两轮 ReAct + 工具结果排除 SDK 文案 + system 页面锚点', async ({ page }) => {
    await page.goto('/examples/docs-demo/')
    await page.waitForSelector('.chat-dialog', { state: 'attached' })
    await mockLlm(page, [
      { tool_calls: [{ name: 'read_page', arguments: { limit: 3000 } }] },
      { text: '本页是 Transformer 学习笔记:注意力机制/多头与位置编码/训练目标/推理优化/配置项速查/常见误区/延伸阅读。' },
    ])
    const bodies = await recordLlmBodies(page) // 后于 mockLlm 注册(后注册先命中,记录后 fallback 交还)

    await openDrawer(page)
    await fillInput(page, '这个页面讲了什么')
    await clickSend(page)
    await waitForAgentIdle(page)
    await expect(page.locator('.chat-dialog .message-row.assistant').last()).toContainText('Transformer 学习笔记')

    // 第一轮请求体:system 含 pageContext 锚点(title + URL)
    const first = JSON.parse(bodies[0] ?? '{}')
    const sys = String(first.messages?.[0]?.content ?? '')
    expect(sys).toContain('[当前页面]')
    expect(sys).toContain('Transformer 学习笔记')
    expect(sys).toContain('/examples/docs-demo/')
    expect(sys).toContain('read_page') // domInspect 开 → 段内工具指引

    // 第二轮请求体:read_page 工具结果(文章正文在、SDK 对话框文案不在、分页字段在)
    const second = JSON.parse(bodies[1] ?? '{}')
    const toolMsg = (second.messages ?? []).find((m: { role: string }) => m.role === 'tool')
    const result = String(toolMsg?.content ?? '')
    expect(result).toContain('"hasMore"')
    expect(result).toContain('注意力机制的核心思想')
    expect(result).not.toContain('选中正文后提问') // ChatInput placeholder = SDK 自身 DOM,必须被排除
    expect(result).not.toContain('问 AI') // 宿主按钮也不在正文容器(article)内
  })

  test('pageContext 默认关对照(minimal-demo system 无锚点段)', async ({ page }) => {
    await page.goto('/examples/minimal-demo/')
    await page.waitForSelector('.chat-dialog')
    await mockLlm(page, [{ text: '收到' }])
    const bodies = await recordLlmBodies(page)
    await fillInput(page, '你好')
    await clickSend(page)
    await waitForAgentIdle(page)
    expect(String(JSON.parse(bodies[0] ?? '{}').messages?.[0]?.content ?? '')).not.toContain('[当前页面]')
  })
})

test.describe('划词浮动菜单 selectionMenu(docs-demo)', () => {
  /** 划选 + 派发 pointerup(菜单监听 window 捕获 pointerup;程序化选区不产原生事件,手动补) */
  async function selectWithPointerUp(page: import('@playwright/test').Page, marker: string): Promise<void> {
    await selectArticleText(page, marker)
    await page.evaluate(() => document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })))
  }

  test('划选 → 浮条出现 → 「引用到对话」= 挂 chip + 打开抽屉 + 发送全链路', async ({ page }) => {
    await page.goto('/examples/docs-demo/')
    await page.waitForSelector('.chat-dialog', { state: 'attached' })
    await mockLlm(page, [{ text: '围绕引用的解答' }])

    await selectWithPointerUp(page, '多头注意力')
    await expect(page.locator('[data-test="selection-menu"]')).toBeVisible()
    // 对话框此前隐藏(drawerHidden);点「引用到对话」→ setQuote + reveal + 聚焦
    await expect(page.locator('.chat-dialog')).toBeHidden() // 未点前抽屉仍隐藏
    await page.click('[data-test="selection-menu-quote"]')
    await expect(page.locator('.chat-dialog')).toBeVisible()
    await expect(page.locator('[data-test="quote-chips"] .quote-chip')).toHaveCount(1)
    await expect(page.locator('[data-test="quote-chips"] .quote-chip-text')).toContainText('多头注意力')
    // 聚焦闭环:输入框拿到焦点(「加入对话框」承诺)
    await expect(page.locator('.chat-dialog .chat-input')).toBeFocused()
    // 菜单已隐 + 发送链路照常
    await expect(page.locator('[data-test="selection-menu"]')).toBeHidden()
    await fillInput(page, '展开讲讲')
    await clickSend(page)
    await waitForAgentIdle(page)
    await expect(page.locator('[data-test="msg-quote"] .msg-quote-text')).toContainText('多头注意力')
  })

  test('Esc / 选区失效 → 浮条消失;点按钮不复活(pointerup 自身忽略)', async ({ page }) => {
    await page.goto('/examples/docs-demo/')
    await page.waitForSelector('.chat-dialog', { state: 'attached' })
    await mockLlm(page, [{ text: '好' }])

    await selectWithPointerUp(page, 'KV Cache')
    await expect(page.locator('[data-test="selection-menu"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-test="selection-menu"]')).toBeHidden()

    // 塌缩选区(collapseToEnd 模拟点击正文)后 pointerup → captureSelectionQuote null → 不再出现
    await selectWithPointerUp(page, '位置编码')
    await expect(page.locator('[data-test="selection-menu"]')).toBeVisible()
    await page.evaluate(() => {
      const sel = window.getSelection()!
      sel.collapseToEnd()
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    })
    await expect(page.locator('[data-test="selection-menu"]')).toBeHidden()
  })
})

test.describe('take_screenshot 截图问答(docs-demo ?shot=1)', () => {
  test('selector 截图 → 真渲染 + 合成图消息 + 步骤行缩略图', async ({ page }) => {
    await page.goto('/examples/docs-demo/?shot=1')
    await page.waitForSelector('.chat-dialog', { state: 'attached' })
    await mockLlm(page, [
      { tool_calls: [{ name: 'take_screenshot', arguments: { selector: '.docs-table' } }] },
      { text: '表格是四列(配置项/作用/默认值/调参建议),渲染正常。' },
    ])
    const bodies = await recordLlmBodies(page)

    await openDrawer(page)
    await fillInput(page, '截图看看配置表格')
    await clickSend(page)
    await waitForAgentIdle(page)
    await expect(page.locator('.chat-dialog .message-row.assistant').last()).toContainText('表格是四列')

    // 第一轮请求体:system hints 教截图(vision + domInspect 装配态)
    const sys = String(JSON.parse(bodies[0] ?? '{}').messages?.[0]?.content ?? '')
    expect(sys).toContain('take_screenshot')
    expect(sys).toContain('page-analysis') // 页面内容分析策略 skill 索引(渐进披露一行)
    // 第二轮请求体:ToolMessage = 文本元数据(无 base64);合成 human 消息带 image_url part(真渲染产物)
    const second = JSON.parse(bodies[1] ?? '{}')
    const toolMsg = (second.messages ?? []).find((m: { role: string }) => m.role === 'tool')
    expect(String(toolMsg?.content)).toContain('截图完成(selector')
    expect(String(toolMsg?.content)).not.toContain('base64,')
    const partsHuman = (second.messages ?? []).filter((m: { role: string }) => m.role === 'user')
      .find((m: { content: unknown }) => Array.isArray(m.content))
    expect(partsHuman?.content?.[0]?.text).toContain('[截图 1] selector')
    expect(String(partsHuman?.content?.[1]?.image_url?.url)).toMatch(/^data:image\/(jpeg|png);base64,/) // jpeg 常态;PNG 带透明通道时 keepPng 保真
    expect(partsHuman.content[1].image_url.url.length).toBeGreaterThan(1000) // 真图非占位
    // UI 观察面:步骤行缩略图(浏览器真跑 html-to-image → canvas 压缩)
    await expect(page.locator('[data-test="step-shots"] .step-shot-img').first()).toBeVisible()
    const src = await page.locator('[data-test="step-shots"] .step-shot-img').first().getAttribute('src')
    expect(src).toMatch(/^data:image\/(jpeg|png);base64,/)
  })

  test('默认(非 shot)形态:截图工具不装 + hints 不教', async ({ page }) => {
    await page.goto('/examples/docs-demo/')
    await page.waitForSelector('.chat-dialog', { state: 'attached' })
    await mockLlm(page, [{ text: '收到' }])
    const bodies = await recordLlmBodies(page)
    await openDrawer(page)
    await fillInput(page, '你好')
    await clickSend(page)
    await waitForAgentIdle(page)
    expect(String(JSON.parse(bodies[0] ?? '{}').messages?.[0]?.content ?? '')).not.toContain('take_screenshot')
  })
})
