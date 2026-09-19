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

/** 打开抽屉(drawerHidden 初始隐藏,点宿主按钮 show);等滑入动画结束(0.3s)—— 期间几何在变,取坐标前必须稳 */
async function openDrawer(page: Page, opts: { settled?: boolean } = {}): Promise<void> {
  await page.locator('[data-test="ask-btn"]').click()
  await expect(page.locator('.chat-dialog')).toBeVisible()
  if (opts.settled) await page.waitForTimeout(450)
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
    // chip 显示**引用内容**(不是来源)—— 用户要能一眼看出「选了什么」;来源在 tooltip
    await expect(page.locator('[data-test="quote-chips"] .quote-chip-text')).toContainText('注意力机制')
    await expect(page.locator('[data-test="quote-chips"] .quote-chip-text')).not.toContainText('Transformer 学习笔记 ·')
    const chipTitle = await page.locator('[data-test="quote-chips"] .quote-chip').getAttribute('title')
    expect(chipTitle).toContain('Transformer 学习笔记 ·') // 来源仍在 tooltip 里

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

  test('S4 引用 DOM 锚点:UI 捕获链 → 请求体含 [位置: 元信息行(修前 mountChatDialog 三捕获点丢 anchor)', async ({ page }) => {
    await page.goto('/examples/docs-demo/')
    await page.waitForSelector('.chat-dialog', { state: 'attached' })
    await mockLlm(page, [{ text: '这段在讲注意力' }])
    const bodies = await recordLlmBodies(page)

    await selectArticleText(page, '注意力机制的核心思想')
    await openDrawer(page) // show() 捕获 → core.setQuote 第三参带 anchor(host-integration-contract S4)
    await expect(page.locator('[data-test="quote-chips"] .quote-chip')).toHaveCount(1)
    await fillInput(page, '这段什么意思')
    await clickSend(page)
    await waitForAgentIdle(page)

    const lastUser = JSON.parse(bodies.at(-1) ?? '{}').messages?.filter((m: { role: string }) => m.role === 'user').at(-1)
    const content = String(lastUser?.content)
    // 元信息行:selector + 最近标题 + Range 偏移(docs-demo 文章结构 .docs-article 下 p;selector 含容器链)
    expect(content).toMatch(/\[位置: [^\]]*p[^\]]*· 小节「[^」]+」\]\(偏移 \d+(, 第 \d+ 次出现)?\)/)
    // 引用块本体在前缀位置不变(元信息行是引用块后的追加,不改既有形态)
    expect(content).toMatch(/^\[引用原文\(来源:[^\n]+\)\]\n"""\n注意力机制/)
    // 消息侧 quote.anchor 持久化(结构化字段,非拼进 content)
    const quote = await page.evaluate(() => (window as unknown as { __sdk?: { messages: Array<{ quote?: { anchor?: unknown } }> } }).__sdk?.messages.find((m) => m.quote)?.quote)
    expect(quote?.anchor).toBeTruthy()
    expect(String((quote?.anchor as { selector?: string })?.selector ?? '')).toContain('p')
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
    await expect(page.locator('[data-test="quote-chips"] .quote-chip-text')).toContainText('自回归生成时') // chip 显示引用内容(该段所在小节标题为 KV Cache)
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

  test('划选 → 浮条出现(自定义文案/配色)→ 挂 chip + 打开抽屉 + 发送全链路', async ({ page }) => {
    await page.goto('/examples/docs-demo/')
    await page.waitForSelector('.chat-dialog', { state: 'attached' })
    await mockLlm(page, [{ text: '围绕引用的解答' }])

    await selectWithPointerUp(page, '多头注意力')
    await expect(page.locator('[data-test="selection-menu"]')).toBeVisible()
    // 浮层菜单自定义(演示点 ④,文档 §6.20 两层的活样例):
    // ① 文案 —— i18n.messages.selectionMenuLabel 键级覆盖生效(默认包值是「引用到 AI 助手」)
    await expect(page.locator('[data-test="selection-menu-quote"]')).toHaveText(/引用提问/)
    await expect(page.locator('[data-test="selection-menu-quote"]')).toHaveAttribute('title', '把选中的这段原文引用给助教')
    // ② 配色 —— 宿主非 scoped 样式表的双类名覆盖压过产物的 .chat-selection-menu-btn[data-v-*](默认白底 #fff)
    await expect(page.locator('[data-test="selection-menu-quote"]')).toHaveCSS('background-color', 'rgb(31, 77, 58)')
    // 对话框此前隐藏(drawerHidden);点「引用提问」(本 demo 覆盖的文案)→ setQuote + reveal + 聚焦
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

  test('滚动 → 浮条跟随重定位(不消失);选区滚出视口才隐藏', async ({ page }) => {
    await page.goto('/examples/docs-demo/')
    await page.waitForSelector('.chat-dialog', { state: 'attached' })
    await mockLlm(page, [{ text: '好' }])

    // 选靠后段落:先把它滚进视口(程序化选区不滚动页面),滚到顶后它会离开视口
    await page.evaluate(() => {
      const p = Array.from(document.querySelectorAll('.docs-article p')).find((el) => (el.textContent ?? '').includes('KV Cache'))
      p?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
    })
    await page.waitForTimeout(250)
    await selectWithPointerUp(page, 'KV Cache')
    await expect(page.locator('[data-test="selection-menu"]')).toBeVisible()
    const before = await page.locator('[data-test="selection-menu"]').boundingBox()

    // 小幅滚动(选区仍在视口内)→ 菜单保持可见且位置跟随(修前:scroll 直接 hide → 宿主站
    // scroll-behavior:smooth 的惯性尾巴会让菜单刚出现就消失,实测可点性 0/5)
    await page.evaluate(() => window.scrollBy({ top: 60, behavior: 'instant' as ScrollBehavior }))
    await page.waitForTimeout(200) // 等 rAF 重定位
    await expect(page.locator('[data-test="selection-menu"]')).toBeVisible()
    const after = await page.locator('[data-test="selection-menu"]').boundingBox()
    expect(after!.y).not.toBe(before!.y) // 跟随选区位移

    // 滚回顶部 → 选区(靠后段落)完全离开视口 → 菜单隐藏(看不见选区就不该有浮条)
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }))
    await page.waitForTimeout(250)
    await expect(page.locator('[data-test="selection-menu"]')).toBeHidden()
  })

  test('超长选区(跨屏)→ 浮条钳制在视口内可见', async ({ page }) => {
    await page.goto('/examples/docs-demo/')
    await page.waitForSelector('.chat-dialog', { state: 'attached' })
    await mockLlm(page, [{ text: '好' }])

    // 从首段选到末段(rect 高达成千上万 px)—— 修前 above/below 分支不钳制,菜单可能落在视口外
    await page.evaluate(() => {
      const ps = Array.from(document.querySelectorAll('.docs-article p'))
      const range = document.createRange()
      range.setStartBefore(ps[0])
      range.setEndAfter(ps[ps.length - 1])
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
    })
    const box = await page.locator('[data-test="selection-menu"]').boundingBox()
    const vh = page.viewportSize()!.height
    expect(box).not.toBeNull()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(vh)
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

  test('dom_edit highlight → 宿主页面真落地 + hints 教批量编辑(domEdit)', async ({ page }) => {
    await page.goto('/examples/docs-demo/')
    await page.waitForSelector('.chat-dialog', { state: 'attached' })
    await mockLlm(page, [
      { tool_calls: [{ name: 'dom_edit', arguments: { patches: [{ op: 'highlight', selector: '.docs-table', color: '#fef08a' }] } }] },
      { text: '已把配置表格高亮出来了。' },
    ])
    const bodies = await recordLlmBodies(page)
    await openDrawer(page)
    await fillInput(page, '把配置表格高亮出来')
    await clickSend(page)
    await waitForAgentIdle(page)
    // system hints:domEdit 开 → 教批量编辑(装了就教)
    expect(String(JSON.parse(bodies[0] ?? '{}').messages?.[0]?.content ?? '')).toContain('dom_edit')
    // 宿主页面真被改:表格拿到高亮背景(outline + backgroundColor)
    const style = await page.locator('.docs-table').evaluate((el) => (el as HTMLElement).style.backgroundColor)
    expect(style).toBe('rgb(254, 240, 138)')
    await expect(page.locator('.chat-dialog .message-row.assistant').last()).toContainText('高亮')
  })

  test('dom_edit → dom_restore:回滚后宿主页面复原(快照栈)', async ({ page }) => {
    await page.goto('/examples/docs-demo/')
    await page.waitForSelector('.chat-dialog', { state: 'attached' })
    await mockLlm(page, [
      { tool_calls: [{ name: 'dom_edit', arguments: { patches: [{ op: 'highlight', selector: '.docs-table', color: '#fef08a' }] } }] },
      { tool_calls: [{ name: 'dom_restore', arguments: {} }] },
      { text: '高亮后又撤销了,表格恢复原样。' }],
    )
    await openDrawer(page)
    await fillInput(page, '高亮表格然后撤销')
    await clickSend(page)
    await waitForAgentIdle(page)
    // 回滚走 outerHTML 回放:高亮样式被移除(元素身份不保留,取 style 值断言)
    const style = await page.locator('.docs-table').evaluate((el) => (el as HTMLElement).style.backgroundColor)
    expect(style).toBe('')
    await expect(page.locator('.chat-dialog .message-row.assistant').last()).toContainText('撤销')
  })
})

test.describe('抽屉拖拽调宽 drawerResizable(docs-demo)', () => {
  test('手柄拖拽 → 宽度变化 + 刷新后保持(localStorage)', async ({ page }) => {
    await page.goto('/examples/docs-demo/')
    await page.waitForSelector('.chat-dialog', { state: 'attached' })
    await mockLlm(page, [{ text: '好' }])
    await openDrawer(page, { settled: true })

    const handle = page.locator('[data-test="drawer-resize"]')
    await expect(handle).toBeVisible() // 抽屉模式默认渲染(零配置)
    const hb = (await handle.boundingBox())!
    const before = (await page.locator('.chat-dialog').boundingBox())!.width

    // 向左拖 = 加宽(抽屉贴右缘)
    await page.mouse.move(hb.x + 3, hb.y + 120)
    await page.mouse.down()
    await page.mouse.move(hb.x + 3 - 160, hb.y + 120, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    const after = (await page.locator('.chat-dialog').boundingBox())!.width
    expect(after).toBeGreaterThan(before + 120)

    // 持久化:刷新后宽度保持(读 localStorage 而非回到 420)
    await page.reload()
    await page.waitForSelector('.chat-dialog', { state: 'attached' })
    await openDrawer(page, { settled: true })
    const persisted = (await page.locator('.chat-dialog').boundingBox())!.width
    expect(Math.abs(persisted - after)).toBeLessThan(2)
  })

  test('拖拽钳制 + 方向键微调;drawerResizable:false 不渲染手柄', async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem('page-agent-sdk:drawerWidth'))
    await page.goto('/examples/docs-demo/')
    await page.waitForSelector('.chat-dialog', { state: 'attached' })
    await mockLlm(page, [{ text: '好' }])
    await openDrawer(page, { settled: true })

    // 宽度断言读 inline style(逻辑输出真值)—— boundingBox 在 CSS 过渡期间是动画中间值
    const inlineW = () => page.locator('.chat-dialog').evaluate((el) => (el as HTMLElement).style.width)

    // 极端右拖(收窄)→ 钳到 MIN 320
    const hb = (await page.locator('[data-test="drawer-resize"]').boundingBox())!
    await page.mouse.move(hb.x + 3, hb.y + 120)
    await page.mouse.down()
    await page.mouse.move(hb.x + 900, hb.y + 120, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(200)
    expect(await inlineW()).toBe('320px')

    // 方向键微调(左 = 加宽 16px;Shift = 64px)
    const handle = page.locator('[data-test="drawer-resize"]')
    await handle.focus()
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(200)
    expect(await inlineW()).toBe('336px')
    await page.keyboard.press('Shift+ArrowLeft')
    await page.waitForTimeout(200)
    expect(await inlineW()).toBe('400px')
  })
})
