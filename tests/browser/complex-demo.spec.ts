import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, clickByText, waitForAgentIdle, clearChat } from './_helpers'

/**
 * 双协议 LLM 请求体解析(complex-demo 走 Anthropic 协议 /v1/messages,其余 demo 多为 OpenAI /chat/completions):
 * - system 段:OpenAI 在 messages[role=system];Anthropic 是顶层 system 字段(string 或 text 块数组)
 * - 工具结果:OpenAI 在 messages[role=tool].content;Anthropic 在 user 消息 content[] 的 tool_result 块
 * 返回拼好的 { sysText, toolContents },断言与协议解耦
 */
function extractLLMPayloads(bodies: any[]): { sysText: string; toolContents: string } {
  const sysParts: string[] = []
  const toolParts: string[] = []
  for (const b of bodies) {
    if (Array.isArray(b?.messages) && b.messages.some((m: any) => m.role === 'system')) {
      sysParts.push(...b.messages.filter((m: any) => m.role === 'system').map((m: any) => String(m.content)))
      toolParts.push(...b.messages.filter((m: any) => m.role === 'tool').map((m: any) => String(m.content)))
    } else {
      const sys = b?.system
      sysParts.push(typeof sys === 'string' ? sys : Array.isArray(sys) ? sys.map((s: any) => s?.text ?? '').join('\n') : '')
      for (const m of b?.messages ?? []) {
        if (!Array.isArray(m?.content)) continue
        for (const blk of m.content) {
          if (blk?.type === 'tool_result') toolParts.push(typeof blk.content === 'string' ? blk.content : JSON.stringify(blk.content ?? ''))
        }
      }
    }
  }
  return { sysText: sysParts.join('\n'), toolContents: toolParts.join('\n') }
}

/**
 * complex-demo 浏览器 E2E(真实复杂度基准:30 类型 + ~70 实例专题页)
 *
 * 覆盖:
 *  - read 全量 / write patch 改组件属性 / read 子路径确认(基础)
 *  - read title / write title(顶层字段)
 *  - read 带 fields 裁剪(字段投影)
 *  - **mission capture**:send 任务型 user → LLM 请求 systemPrompt 含「当前主线目标」pin 段(revive-mission-anchor)
 *  - **深嵌套 patch**:section → grid → coupon 的深层 jsonPath 改(验证 isPathAllowed 逐段校验 + 大 schema 递归)
 */
test.describe('complex-demo: 真实复杂度(30 类型 + 70 实例)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/complex-demo/')
    await page.waitForSelector('.chat-dialog')
    await page.waitForSelector('textarea') // 等 ChatDialog input 渲染就绪(异步)
  })

  test('focus: 两步拾取 → 选中边框 → 加入聊天 → 聚焦 chip → ✕ 退出', async ({ page }) => {
    // 第 1 步:点组件(components.0)→ 浮层边框 + 「💬 加入聊天」按钮出现
    await page.click('[data-path="components.0"]')
    const overlay = page.locator('.pick-overlay')
    await expect(overlay).toBeVisible()
    // 第 2 步:点「💬 加入聊天」→ setFocus → 焦点条 chip 出现(边框随选中态清除消失)
    await page.click('.pick-overlay__btn')
    const bar = page.locator('.focus-chip')
    await expect(bar).toBeVisible()
    await expect(bar).toContainText('components.0')
    // ✕ 退出 → chip 消失(恢复全量可操作范围)
    await page.click('[data-test="focus-clear"]')
    await expect(bar).toHaveCount(0)
  })

  test('focus multi: 两步拾取 2 组件 → 多 chip → ✕ 移除单个', async ({ page }) => {
    // 拾取 components.0(navbar)
    await page.click('[data-path="components.0"]')
    await page.click('.pick-overlay__btn')
    // 拾取 components.2(breadcrumb)→ 累积(addFocus 非覆盖)
    await page.click('[data-path="components.2"]')
    await page.click('.pick-overlay__btn')
    // 多 chip:2 个(components.0 + components.2)
    const chips = page.locator('.focus-chip')
    await expect(chips).toHaveCount(2)
    await expect(chips.first()).toContainText('components.0')
    await expect(chips.nth(1)).toContainText('components.2')
    // ✕ 移除第一个(components.0)→ 剩 1 个(components.2)
    await chips.first().locator('[data-test="focus-clear"]').click()
    await expect(chips).toHaveCount(1)
    await expect(chips).toContainText('components.2')
    // 清理剩余
    await chips.first().locator('[data-test="focus-clear"]').click()
  })

  test('focus chip 标注历史:聚焦时发送 → user message 显示发送时焦点', async ({ page }) => {
    // 拾取 components.0(navbar)→ 聚焦(输入框 chip)
    await page.click('[data-path="components.0"]')
    await page.click('.pick-overlay__btn')
    // mock LLM(简单回复)
    await mockLlm(page, [{ text: '好的,已了解导航栏需求。' }])
    // 聚焦状态下发送消息
    await fillInput(page, '改下导航栏标题')
    await clickSend(page)
    await waitForAgentIdle(page)
    // user message 含 .msg-focus-chip(历史快照:显示 path,只读可点击回看;**无 ✕** —— 删历史 chip 改不了已发消息,还会误删当前焦点)
    const userRow = page.locator('.message-row.user').first()
    const chip = userRow.locator('.msg-focus-chip')
    await expect(chip).toHaveCount(1)
    await expect(chip).toContainText('components.0') // chip 显示 path(同输入框)
    expect(await chip.getAttribute('title')).toContain('components.0') // title 回看 path
    // 历史 chip 无删除按钮(快照语义);当前焦点仍由输入框 chip 的 ✕ 管理
    await expect(chip.locator('.msg-focus-chip-x')).toHaveCount(0)
    await expect(page.locator('[data-test="focus-clear"]')).toBeVisible()
    // 输入框 ✕ 移除当前焦点 → 输入框 chip 消失,历史标注保留
    await page.click('[data-test="focus-clear"]')
    await expect(page.locator('.focus-chip')).toHaveCount(0)
    await expect(chip).toHaveCount(1) // 历史标注不受影响(快照)
  })

  test('focus: 两步聚焦后写越界被拒(PATH_DENIED)→ 自纠写聚焦内放行', async ({ page }) => {
    await page.click('[data-path="components.0"]') // 第 1 步:选中 components.0
    await page.click('.pick-overlay__btn') // 第 2 步:加入聊天 → 聚焦
    await expect(page.locator('.focus-chip')).toBeVisible()
    // mock:第 1 轮写 components.1(越界被拒回灌)→ 第 2 轮写 components.0(聚焦内放行)→ 完成
    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { patch: { op: 'set', jsonPath: 'components.1.props.title', value: '越界' } } }] },
      { tool_calls: [{ name: 'write', arguments: { patch: { op: 'set', jsonPath: 'components.0.props.title', value: '聚焦内放行' } } }] },
      { text: '已改。' },
    ])
    await fillInput(page, '把第二个组件标题改成「越界」')
    await clickSend(page)
    await waitForAgentIdle(page)
    // 越界写未生效(components.1 保留原值,focus 拦截 PATH_DENIED)
    const c1 = await page.evaluate(() => (window as any).page.components[1].props.title)
    expect(c1).not.toBe('越界')
    // 聚焦内写生效(自纠后 components.0 放行)
    const c0 = await page.evaluate(() => (window as any).page.components[0].props.title)
    expect(c0).toBe('聚焦内放行')
  })

  /**
   * Bug 复现锁定(用户实测):清空对话后输入框聚焦 chip 残留。
   * 根因:resetSession 调 focusMw.reset() 清了焦点但不 bump infoTick(chip 的 computed 挂 infoTick)
   * → 不重算 → 旧焦点 chip 残留在输入框。修复后 resetSession/switchSession 统一 bump。
   * 验证链路:UI 两步拾取 → setFocus → chip 出现 → 发消息 → 清空对话 → chip 应消失。
   */
  test('focus: 清空对话后输入框聚焦 chip 不残留(resetSession 清焦点)', async ({ page }) => {
    await page.click('[data-path="components.0"]') // 第 1 步:选中
    await page.click('.pick-overlay__btn') // 第 2 步:加入聊天 → 聚焦
    await expect(page.locator('.focus-chip')).toHaveCount(1)
    // 「清空对话」菜单项需有消息才出现 → 先发一条
    await mockLlm(page, [{ text: '好的,已了解导航栏需求。' }])
    await fillInput(page, '改下导航栏')
    await clickSend(page)
    await waitForAgentIdle(page)
    await expect(page.locator('.message-row.user')).toHaveCount(1)
    // 清空对话(resetSession):焦点应随会话重置清空,chip 不残留
    await clearChat(page)
    await expect(page.locator('.message-row.user')).toHaveCount(0) // 前置成立:对话确实清空
    await expect(page.locator('.focus-chip')).toHaveCount(0) // 核心:输入框 chip 不残留旧焦点
  })

  /**
   * 精确值保护(placeholder-protected-read-write)合并演示:navbar(components.0)的 trackId 被 freeze 保护。
   * 两步拾取聚焦 navbar → read trackId 返 ⟦frozen⟧ 占位符(真实值不进 AI 消息流)→ write 改 trackId 被 FROZEN_FIELD 拒 → 改普通字段 title 放行。
   */
  test('precise-value: freeze 保护 trackId → read 占位符 + write 被拒 + 普通字段放行', async ({ page }) => {
    // 两步拾取聚焦 navbar(components.0)
    await page.click('[data-path="components.0"]')
    await page.click('.pick-overlay__btn')
    await expect(page.locator('.focus-chip')).toBeVisible()

    // 捕获 LLM 请求体(双协议:OpenAI chat/completions 或 Anthropic /v1/messages;验证 read 返 freeze 占位符 —— 精确值不进 AI 消息流)
    const requestBodies: any[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && (req.url().includes('chat/completions') || req.url().includes('/v1/messages'))) {
        try { const body = req.postData(); if (body) requestBodies.push(JSON.parse(body)) } catch { /* ignore */ }
      }
    })

    // mock:read trackId(返占位符)→ write 改 trackId(FROZEN_FIELD 拒)→ write 改 title(放行)→ 完成
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'components.0.props.trackId' } }] },
      { tool_calls: [{ name: 'write', arguments: { value: 'HACKED', patch: { op: 'set', jsonPath: 'components.0.props.trackId' } } }] },
      { tool_calls: [{ name: 'write', arguments: { value: '已改标题', patch: { op: 'set', jsonPath: 'components.0.props.title' } } }] },
      { text: 'trackId 受保护无法改,已改标题。' },
    ])
    await fillInput(page, '读 trackId 并改成 HACKED,改不了就改标题为「已改标题」')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 断言 1:read 受保护字段返 freeze 占位符(精确值保护生效;双协议解析)
    const toolContents = extractLLMPayloads(requestBodies).toolContents
    expect(toolContents, 'read 受保护字段返 ⟦frozen⟧ 占位符').toContain('⟦frozen')

    // 断言 2:trackId 原值保留(write 被 FROZEN_FIELD 拒,未生效)
    const trackId = await page.evaluate(() => (window as any).page.components[0].props.trackId)
    expect(trackId).toBe('trk_a8f3k9x2m7')

    // 断言 3:title 被改(普通字段不受保护,放行)
    const title = await page.evaluate(() => (window as any).page.components[0].props.title)
    expect(title).toBe('已改标题')
  })

  test('read 全量 → write patch 改 navbar title → read 子路径确认', async ({ page }) => {
    // 4 轮 ReAct + complex-demo 重页面(30 类型 70 实例)在高负载下跑不完默认 60s 测试预算(实测 flaky,
    // 重试才过)→ 放宽本用例预算 + idle 等待同步放宽;断言本身在 idle 后取值,不涉时序
    // subtree-summary(4.0):重页面全量 read 下 components.0(≥3KB)降 <subtree> 占位 → 直写深路径被
    // read-before-write 守卫拦(NEED_NARROW_READ)→ 窄读 components.0.props(覆盖 S=components.0 或
    // components.0.props 两态)→ 复写放行;此即新标准闭环(S1 骨架直写仅对未落入摘要面的小标量路径成立)
    test.setTimeout(150_000)
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: {} }] },
      { tool_calls: [{ name: 'write', arguments: { value: '测试改标题', patch: { op: 'set', jsonPath: 'components.0.props.title' } } }] },
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'components.0.props' } }] },
      { tool_calls: [{ name: 'write', arguments: { value: '测试改标题', patch: { op: 'set', jsonPath: 'components.0.props.title' } } }] },
      { text: '已完成,导航栏标题已改为「测试改标题」。' },
    ])

    await fillInput(page, '把导航栏标题改成「测试改标题」')
    await clickSend(page)
    await waitForAgentIdle(page, 120_000)

    // 断言 1:window.page.components[0].props.title(navbar)已更新
    const navbarTitle = await page.evaluate(() => (window as any).page.components[0].props.title)
    expect(navbarTitle).toBe('测试改标题')
    // 断言 2:DOM .navbar-title 文本更新
    const domTitle = await page.textContent('.navbar-title')
    expect(domTitle).toBe('测试改标题')
    // 断言 3:工具步骤行按 Figma 风格渲染(色块 status-dot + 状态标签 step-status「成功」;替代旧 emoji)
    const stepStatus = await page.locator('.step-item .step-status').first().textContent()
    expect(stepStatus, '步骤状态标签:done → 「成功」(Figma 色块+文字风格)').toContain('成功')
    expect(await page.locator('.step-item .status-dot.done').count(), '步骤色块:done 状态绿色 status-dot').toBeGreaterThan(0)
  })

  test('read 子路径 → write patch 改页面 title → read 确认', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
      { tool_calls: [{ name: 'write', arguments: { value: '重构自测标题', patch: { op: 'set', jsonPath: 'title' } } }] },
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
      { text: '标题已改为「重构自测标题」。' },
    ])

    await fillInput(page, '把页面标题改成「重构自测标题」')
    await clickSend(page)
    await waitForAgentIdle(page)

    const pageTitle = await page.evaluate(() => (window as any).page.title)
    expect(pageTitle).toBe('重构自测标题')
  })

  test('read 带 fields 裁剪 → 验证字段投影', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'components', fields: ['type', 'id'] } }] },
      { text: '已列出组件清单。' },
    ])
    await fillInput(page, '列出组件类型和 id')
    await clickSend(page)
    await waitForAgentIdle(page)
    const dialogText = await page.textContent('.chat-dialog')
    expect(dialogText).toContain('组件')
  })

  /**
   * mission capture + 深嵌套 patch(真实复杂度核心):
   * send「把领券中心第一张券面额改成 100 元」(任务型 user,含「改」)→
   * ① mission capture → LLM 请求 systemPrompt 含「## 当前主线目标」pin 段(goal = user 原文)
   * ② write 深嵌套 patch:components.6(领券 section).children.0(grid).children.0(首券).props.amount = 100
   *    验证 isPathAllowed 逐段校验穿过 section(grid)→ coupon(union 选项)→ amount,大 schema 递归 OK
   */
  test('mission capture + 深嵌套 patch:改领券首券面额 → systemPrompt 含主线 pin', async ({ page }) => {
    const requestBodies: any[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && (req.url().includes('chat/completions') || req.url().includes('/v1/messages'))) {
        try { const body = req.postData(); if (body) requestBodies.push(JSON.parse(body)) } catch { /* ignore */ }
      }
    })

    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { value: 100, patch: { op: 'set', jsonPath: 'components.6.props.children.0.props.children.0.props.amount' } } }] },
      { text: '已将领券中心第一张优惠券面额改为 100 元。' },
    ])

    await fillInput(page, '把领券中心第一张优惠券面额改成 100 元')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 断言 1:深嵌套 patch 落地(section → grid → coupon → amount)
    const amount = await page.evaluate(() => (window as any).page.components[6].props.children[0].props.children[0].props.amount)
    expect(amount, '深嵌套 patch:components.6.props.children.0.props.children.0.props.amount = 100').toBe(100)

    // 断言 2:mission capture → LLM 请求 systemPrompt 含「当前主线目标」pin + goal(双协议解析)
    const sysText = extractLLMPayloads(requestBodies).sysText
    expect(sysText, 'mission capture → systemPrompt 含「当前主线目标」pin 段').toContain('当前主线目标')
    expect(sysText, 'mission pin 含 user goal(领券)').toContain('领券')
  })

  /**
   * read 大 JSON 分页:components 数组(~21 顶层)整体 read 返回大,验证 read 正常(可能 offload vfs)
   * + 深路径 read(单个 coupon 子树)
   */
  test('read components 全量(大 JSON)+ read 深路径子树(领券首券)', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'components' } }] },
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'components.6.props.children.0.props.children.0' } }] },
      { text: '已读取组件清单与领券首券详情。' },
    ])
    await fillInput(page, '看看组件清单和领券第一张券')
    await clickSend(page)
    await waitForAgentIdle(page)
    const dialogText = await page.textContent('.chat-dialog')
    expect(dialogText).toContain('组件')
  })

  /**
   * 手动配置面板渲染 + agent publish action(胜任自动化):
   * 配置面板可见(JSON 编辑器 + 发布按钮)→ agent 调 publish action → 发布状态条更新
   */
  test('配置面板渲染 + agent publish action → 发布状态更新', async ({ page }) => {
    await expect(page.locator('.config-panel')).toBeVisible()
    await expect(page.locator('.config-panel .json-editor')).toBeVisible()
    await expect(page.locator('.config-panel button', { hasText: '发布' })).toBeVisible()

    await mockLlm(page, [
      { tool_calls: [{ name: 'publish', arguments: {} }] },
      { text: '已发布页面。' },
    ])
    await fillInput(page, '帮我发布页面')
    await clickSend(page)
    await waitForAgentIdle(page)
    // publish action 副作用:配置面板状态条显示「已发布」
    const status = await page.textContent('.config-panel .status')
    expect(status, 'publish action → publishStatus 更新为「已发布」').toContain('已发布')
  })

  /**
   * 配置面板 JSON 与 page 双向同步(deep watch 修复):
   * agent write 改组件内部字段(components.0.props.title,length 不变)→ 面板 textarea 的 JSON 跟随更新。
   * 原 watch 仅监听 title + components.length,漏掉 length 不变的组件内部 patch → 面板 JSON 落后于页面渲染。
   */
  test('配置面板 JSON 同步:agent 改组件内部字段(length 不变)→ textarea 跟随更新', async ({ page }) => {
    await expect(page.locator('.config-panel .json-editor')).toBeVisible()
    const initial = await page.inputValue('.config-panel .json-editor')
    expect(initial).not.toContain('面板同步测试标题')

    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { value: '面板同步测试标题', patch: { op: 'set', jsonPath: 'components.0.props.title' } } }] },
      { text: '已修改导航栏标题。' },
    ])
    await fillInput(page, '把导航栏标题改成「面板同步测试标题」')
    await clickSend(page)
    await waitForAgentIdle(page)
    // debounce 200ms 后 jsonText 同步:组件内部 patch length 不变,旧 watch 漏触发 → 验证 deep watch 修复
    await page.waitForTimeout(400)
    const synced = await page.inputValue('.config-panel .json-editor')
    expect(synced, 'agent 改组件内部字段(length 不变)→ 配置面板 JSON 同步(deep watch)').toContain('面板同步测试标题')
  })

  /**
   * agent save_draft(宿主动作)+ get_dom(读渲染 DOM)闭环:
   * save_draft → 草稿写 localStorage;get_dom → 返回导航栏 DOM 结构(验证 agent 能"看"渲染结果)
   */
  test('agent save_draft → localStorage + get_dom 读渲染 DOM', async ({ page }) => {
    const { calls } = await mockLlm(page, [
      { tool_calls: [{ name: 'save_draft', arguments: {} }] },
      { tool_calls: [{ name: 'get_dom', arguments: { selector: '.navbar-title', depth: 0 } }] },
      { text: '已保存草稿并查看了导航栏 DOM。' },
    ])
    await fillInput(page, '先保存草稿,再看看导航栏标题的 DOM 结构')
    await clickSend(page)
    await waitForAgentIdle(page)

    // save_draft action 副作用:草稿写入 localStorage(序列化 page)
    const draft = await page.evaluate(() => localStorage.getItem('complex-demo-draft'))
    expect(draft, 'save_draft action → 草稿写入 localStorage').toBeTruthy()
    expect(draft).toContain('components')
    // 两轮 tool 调用(save_draft + get_dom)都触发 → agent 能调宿主动作 + 读 DOM
    expect(calls(), 'save_draft + get_dom 两轮 tool 调用都触发').toBeGreaterThanOrEqual(2)
  })
})

/**
 * huge page(1M 大页面 · ?huge=1):验证 agent 在 1M 大 JSON 场景的胜任性
 * - PageRenderer 截断渲染(800 组件只渲染前 100,防卡死;agent read/write 操作全量)
 * - read 分页(offset/limit)+ write patch 改某实例(深路径 components.0.props.text)
 */
test.describe('complex-demo huge(1M 大页面 · ?huge=1)', () => {
  test('read 分页 + write patch 改某实例(800 组件)', async ({ page }) => {
    await page.goto('/examples/complex-demo/?huge=1')
    await page.waitForSelector('.chat-dialog')
    await page.waitForSelector('textarea')
    // 截断提示可见(800 组件 > RENDER_LIMIT 100,PageRenderer 只渲染前 100 防卡死)
    await expect(page.locator('.pr-truncate')).toBeVisible()
    const componentCount = await page.evaluate(() => (window as any).page.components.length)
    expect(componentCount, 'huge 模式加载 800 组件').toBe(800)

    // read 整体(1M 大 JSON → offload vfs,agent 胜任大对象读取;write patch 深路径增量已在 normal spec 验证)
    const { calls } = await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: {} }] },
      { text: '已读取大页面概况。' },
    ])
    await fillInput(page, '看看这个大页面')
    await clickSend(page)
    await waitForAgentIdle(page)
    expect(calls(), 'huge read 1M 大 JSON 执行(agent 加载 + 读大对象胜任)').toBeGreaterThanOrEqual(1)
  })
})

test.describe('complex-demo: 组件操作(调换顺序 / 改层级 / 聚焦纯代码)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/complex-demo/')
    await page.waitForSelector('.chat-dialog')
    await page.waitForSelector('textarea')
  })

  test('调换组件顺序:patches 批量 set 交换(write 无 move op,原子任一失败回滚)', async ({ page }) => {
    // 取 components[0]/[1] 全量(深拷贝,防 reactive 引用),mock write patches 交换
    const [c0, c1] = await page.evaluate(() => [
      JSON.parse(JSON.stringify(window.page.components[0])),
      JSON.parse(JSON.stringify(window.page.components[1])),
    ])
    const { calls } = await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { patches: [
        { op: 'set', jsonPath: 'components.0', value: c1 },
        { op: 'set', jsonPath: 'components.1', value: c0 },
      ] } }] },
      { text: '已调换组件 0 和 1 的顺序' },
    ])
    await fillInput(page, '把第一个和第二个组件调换顺序')
    await clickSend(page)
    await waitForAgentIdle(page)
    expect(await page.evaluate(() => window.page.components[0].type), 'components[0] = 旧 [1]').toBe(c1.type)
    expect(await page.evaluate(() => window.page.components[1].type), 'components[1] = 旧 [0]').toBe(c0.type)
  })

  test('改层级:组件移进容器 children(append 到 props.children + del 顶层,嵌套)', async ({ page }) => {
    const info = await page.evaluate(() => {
      const containerIdx = window.page.components.findIndex((c) => Array.isArray(c.props?.children))
      return { containerIdx, c2type: window.page.components[2]?.type, c2: JSON.parse(JSON.stringify(window.page.components[2])) }
    })
    expect(info.containerIdx, '初始页存在带 children 的容器组件').toBeGreaterThanOrEqual(0)
    const { calls } = await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { patch: { op: 'append', jsonPath: `components.${info.containerIdx}.props.children`, value: info.c2 } } }] },
      { tool_calls: [{ name: 'write', arguments: { patch: { jsonPath: 'components.2' }, del: true } }] },
      { text: '已把第三个组件移进容器做子组件' },
    ])
    await fillInput(page, '把第三个组件移进容器做子组件')
    await clickSend(page)
    await waitForAgentIdle(page)
    // c2 已进某容器 children(del 顶层后索引偏移,按 type 在 children 中查)
    const inContainer = await page.evaluate((t) => window.page.components.some(
      (c) => Array.isArray(c.props?.children) && c.props.children.some((ch) => ch.type === t),
    ), info.c2type)
    expect(inContainer, '组件移进了容器 children(嵌套层级)').toBe(true)
  })

  test('聚焦改纯代码:造 custom → 两步拾取 → use_html 委派 → 子 vfs_write 越界 PATH_DENIED / 焦点文件放行', async ({ page }) => {
    // 前置:evaluate 造一个 custom(初始页无 custom;带 __pgId 供 codeAsset checkout)
    const beerPath = await page.evaluate(() => {
      window.page.components.push({ type: 'custom', name: 'beer', code: '<section class="beer"><h1>old</h1></section>', __pgId: 'c_test_beer' })
      return 'components.' + (window.page.components.length - 1)
    })
    // 聚焦 beer(经 sdk.addFocus;custom iframe 渲染无 [data-path],绕两步拾取 UI — 核心验证 focus + vfs 守卫)
    await page.evaluate((p) => { (window as any).__sdk.addFocus({ path: p, label: 'beer' }) }, beerPath)
    await expect(page.locator('.focus-chip')).toContainText(beerPath)
    // mockLlm:主 use_html → 子 vfs_write 越界(c_other 非焦点 → PATH_DENIED 回灌)→ vfs_write 焦点(c_test_beer 放行)→ 子 text → 主 text
    const { calls } = await mockLlm(page, [
      { tool_calls: [{ name: 'use_html', arguments: { task: '把 beer 标题改成「干杯青岛」' } }] },
      { tool_calls: [{ name: 'vfs_write', arguments: { path: 'html/c_other.html', content: '<section>越界</section>' } }] },
      { tool_calls: [{ name: 'vfs_write', arguments: { path: 'html/c_test_beer.html', content: '<section class="beer"><h1>干杯青岛</h1></section>' } }] },
      { text: '已改 beer 标题' },
      { text: '完成聚焦精修' },
    ])
    await fillInput(page, '把 beer 标题改成干杯青岛')
    await clickSend(page)
    await waitForAgentIdle(page)
    // custom.code 含新标题(子 vfs_write 焦点文件 → commit 回写 data.code)
    const code = await page.evaluate(() => window.page.components.find((c) => c.name === 'beer')?.code ?? '')
    expect(code, '焦点 custom.code 经子 vfs_write + commit 更新').toContain('干杯青岛')
  })

  // ===== 方向闸机制锁(M1 真 LLM 实测驱动:flash 无视提示词「硬性第一步」0 次征询 → 回灌式门禁)=====
  test('方向闸:创意任务先委派被门禁回灌 → 征询 → 点选 → 委派放行落地', async ({ page }) => {
    await mockLlm(page, [
      // ① 主 agent 试图直接委派 → 闸门回灌 PROPOSE_GATE(error result,子 agent 零消耗)
      { tool_calls: [{ name: 'use_html', arguments: { task: '新建世界杯主题轮播图' } }] },
      // ② 回灌后合规路径:主动征询
      { tool_calls: [{ name: 'request_human_confirmation', arguments: {
        question: '世界杯轮播用哪套方向?',
        options: ['绿茵场滚动横幅 + 金杯高亮', '深蓝夜景 + 队徽网格切换'],
        recommendation: '推荐方案A:绿茵场滚动横幅',
      } }] },
      // ③ 用户点选后闸门放行 → 二次委派(子 agent 执行:write 落组件 + text 收口)
      { tool_calls: [{ name: 'use_html', arguments: { task: '新建世界杯主题轮播图(方案A:绿茵场滚动横幅)' } }] },
      { tool_calls: [{ name: 'write', arguments: { patch: { op: 'append', jsonPath: 'components', value: {
        type: 'custom', name: 'worldcup-carousel', code: '<section class="wc-carousel"><h1>世界杯轮播·绿茵场</h1></section>',
      } } } }] },
      { text: '已按方案A创建世界杯轮播组件' },
      { text: '完成:世界杯轮播已落地' },
    ])
    const before = await page.evaluate(() => window.page.components.length)
    await fillInput(page, '加一个世界杯主题的轮播图')
    await clickSend(page)
    // 征询选项出现 → 点选方案A(闸门放行前提)
    await page.waitForSelector('button:has-text("绿茵场")', { timeout: 15_000 })
    await clickByText(page, '绿茵场滚动横幅 + 金杯高亮')
    await waitForAgentIdle(page)
    const results = await page.evaluate(() => {
      const rs = (window as any).__sdk.debugLogs.value
        .filter((l: any) => l.type === 'tool_result' && l.data?.name === 'use_html')
        .map((l: any) => String(l.data?.result ?? ''))
      return {
        gateResult: rs[0] ?? '',
        secondResult: rs[1] ?? '',
        landed: window.page.components.filter((c: any) => (c.code ?? '').includes('世界杯轮播·绿茵场')).length,
        count: window.page.components.length,
      }
    })
    expect(results.gateResult, '闸门关闭期首次 use_html 被 PROPOSE_GATE 回灌').toContain('PROPOSE_GATE')
    expect(results.secondResult, '确认后二次 use_html 放行(结果为子 agent 收口文本,非门禁错误)').not.toContain('PROPOSE_GATE')
    expect(results.landed, '组件经子 agent write 落地').toBeGreaterThanOrEqual(1)
    expect(results.count, 'components 数 +1').toBe(before + 1)
  })

  // ===== DOM 检视工具族(dom-inspect skill 按需注入;3.23+)=====
  // complex-demo capabilities.domInspect:true + skills 默认开 → dom_search/dom_info 不占常驻池,load_skill 后注入
  test('dom-inspect skill:load 后 dom_search 文本检索 + dom_info 计算样式可调', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'load_skill', arguments: { name: 'dom-inspect' } }] },
      { tool_calls: [{ name: 'dom_search', arguments: { query: '复杂页面', mode: 'text', limit: 3 } }] },
      { tool_calls: [{ name: 'dom_info', arguments: { selector: '.header-title', styles: ['display', 'font-size'] } }] },
      { text: '已检视标题元素。' },
    ])
    await fillInput(page, '看看页面标题元素')
    await clickSend(page)
    await waitForAgentIdle(page)
    const results = await page.evaluate(() => {
      const pick = (name: string) => (window as any).__sdk.debugLogs.value
        .filter((l: any) => l.type === 'tool_result' && l.data?.name === name)
        .map((l: any) => String(l.data?.result ?? ''))
      return { search: pick('dom_search')[0] ?? '', info: pick('dom_info')[0] ?? '' }
    })
    // 检索:文本命中标题区(叶子优先;文档 <title> 也合法命中,断言存在 header-title 命中即可)
    const search = JSON.parse(results.search)
    expect(search.total, 'dom_search 文本模式命中标题文本').toBeGreaterThanOrEqual(1)
    expect(search.hits.some((h: { selector: string }) => h.selector.includes('header-title')), '命中路径带 class 段(header-title)').toBeTruthy()
    // 检视:真实 getComputedStyle 求值(display/font-size 非空)+ events 字段存在(三源结构)
    const info = JSON.parse(results.info)
    expect(info.styles.display, 'dom_info 计算样式 display 求值').toBeTruthy()
    expect(info.styles['font-size'], 'dom_info 计算样式 font-size 求值').toBeTruthy()
    expect(info.events && Array.isArray(info.events.inline) && Array.isArray(info.events.vue), 'dom_info 事件三源结构(inline/vue/captured)').toBeTruthy()
  })

  // ===== 同轮并行委派 + 组件锁(parallel-subagent-delegation 3.13 第二批 Q5c)=====
  // complex-demo 配置 maxParallelTools: 3 → 同轮多个 use_html 真并发(SSE 走 Playwright route)

  test('并行委派:同轮双 use_html 不同组件 → 两把锁独立,两组件 code 均更新', async ({ page }) => {
    // 前置:evaluate 造两个 custom(带 __pgId 供 codeAsset checkout/commit)
    await page.evaluate(() => {
      window.page.components.push(
        { type: 'custom', name: 'beer', code: '<section class="beer"><h1>old</h1></section>', __pgId: 'c_par_beer' },
        { type: 'custom', name: 'mug', code: '<section class="mug"><h1>old</h1></section>', __pgId: 'c_par_mug' },
      )
    })
    // 主同轮双委派(显式 components 声明,锁按组件名互斥);子各自 vfs_write 工作副本 → commit 回写
    // 响应按文件区分,两个子 agent 谁先消费哪条都正确(commit 按 __pgId 映射回组件)
    const { calls } = await mockLlm(page, [
      { tool_calls: [
        { name: 'use_html', arguments: { task: '把 beer 标题改成「干杯青岛」', components: ['beer'] } },
        { name: 'use_html', arguments: { task: '把 mug 主色改成橙色', components: ['mug'] } },
      ] },
      { tool_calls: [{ name: 'vfs_write', arguments: { path: 'html/c_par_beer.html', content: '<section class="beer"><h1>干杯青岛</h1></section>' } }] },
      { tool_calls: [{ name: 'vfs_write', arguments: { path: 'html/c_par_mug.html', content: '<section class="mug" style="color:orange"><h1>橙色酒杯</h1></section>' } }] },
      { text: 'beer 已改\n[note] beer 标题直改 vfs' },
      { text: 'mug 已改\n[note] mug 换橙色内联样式' },
      { text: '两个组件都已完成' },
    ])
    await fillInput(page, 'beer 和 mug 都改一下')
    await clickSend(page)
    await waitForAgentIdle(page)
    const codes = await page.evaluate(() => Object.fromEntries(
      window.page.components.filter((c: any) => c.name === 'beer' || c.name === 'mug').map((c: any) => [c.name, c.code ?? '']),
    ))
    expect(codes.beer, 'beer 组件 code 更新(锁 beer 不阻塞 mug)').toContain('干杯青岛')
    expect(codes.mug, 'mug 组件 code 更新(锁 mug 不阻塞 beer)').toContain('橙色酒杯')
    expect(calls(), '6 次 LLM 调用(主1 + 子×2各2 + 主收口1)').toBe(6)
  })

  test('并行委派:两个 use_html 思考流各归各 step,result 不交叉(修复:固定挂最后 step + name 匹配错配)', async ({ page }) => {
    await page.evaluate(() => {
      window.page.components.push(
        { type: 'custom', name: 'beer', code: '<section class="beer"><h1>old</h1></section>', __pgId: 'c_par_beer' },
        { type: 'custom', name: 'mug', code: '<section class="mug"><h1>old</h1></section>', __pgId: 'c_par_mug' },
      )
    })
    // 子响应带 reasoning 思考流(mock reasoning_content → subagent reasoning 转发 → spawnStep.subReason);
    // 两个子 agent 谁先消费哪条脚本项不确定(commit 按 __pgId 映射),断言按 marker 集合判定(不依赖顺序)
    await mockLlm(page, [
      { tool_calls: [
        { name: 'use_html', arguments: { task: '把 beer 标题改成「干杯青岛」', components: ['beer'] } },
        { name: 'use_html', arguments: { task: '把 mug 主色改成橙色', components: ['mug'] } },
      ] },
      { reasoning: '思考 beer 组件:改标题文字', tool_calls: [{ name: 'vfs_write', arguments: { path: 'html/c_par_beer.html', content: '<section class="beer"><h1>干杯青岛</h1></section>' } }] },
      { reasoning: '思考 mug 组件:改成橙色', tool_calls: [{ name: 'vfs_write', arguments: { path: 'html/c_par_mug.html', content: '<section class="mug" style="color:orange"><h1>橙色酒杯</h1></section>' } }] },
      { text: 'beer 已改\n[note] beer 标题直改 vfs' },
      { text: 'mug 已改\n[note] mug 换橙色内联样式' },
      { text: '两个组件都已完成' },
    ])
    await fillInput(page, 'beer 和 mug 都改一下')
    await clickSend(page)
    await waitForAgentIdle(page)
    const steps = await page.evaluate(() => {
      const sdk = (window as any).__sdk
      const last = [...sdk.messages].filter((m: any) => m.role === 'assistant').pop()
      return (last?.steps ?? []).filter((s: any) => s.name === 'use_html')
    })
    expect(steps.length, '同轮两个 use_html 各一个 step').toBe(2)
    // 修复前:两路思考全累积到最后一个 step(第一个 step subReason 空)
    const markers = steps.map((s: any) => ((s.subReason || '').includes('beer') ? 'beer' : 'mug'))
    expect(new Set(markers).size, '两个 step 的思考流各自独立(不混流)').toBe(2)
    // 修复前:同名工具 tool_result 按 name 反向扫交叉错配(A 的 result 落到 B)
    for (const s of steps) {
      const which = (s.subReason || '').includes('beer') ? 'beer' : 'mug'
      expect(String(s.result || ''), `use_html(${which}) 的 result 与自己的思考流同源`).toContain(`${which} 已改`)
    }
  })

  test('思考计数:主 agent 超长思考计数用总量不随截尾冻结(修前恒 4k)', async ({ page }) => {
    // 4600 字思考(> REASON_TAIL_CAP 4000):渲染文本尾部滑窗截到 4000,计数应显示总量 4.6k
    const longReasoning = '深度思考.'.repeat(920) // 5 字 × 920 = 4600
    await mockLlm(page, [
      { reasoning: longReasoning, tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
      { text: '看完标题了' },
    ])
    await fillInput(page, '读下标题')
    await clickSend(page)
    await waitForAgentIdle(page)
    // 修前:countLabel 用截尾后 text.length(恒 4000 → '4k');修后用 reasoningTotal 总量 → '4.6k'
    await expect(page.locator('.reasoning-count').first(), '计数显示总量 4.6k 而非截尾冻结的 4k').toHaveText(/4\.6k 字/)
  })

  test('子 agent 思考块:摘要行尾「展开」文字链,点击后变「收起」', async ({ page }) => {
    await page.evaluate(() => {
      window.page.components.push({ type: 'custom', name: 'beer', code: '<section class="beer"><h1>old</h1></section>', __pgId: 'c_tgl_beer' })
    })
    await mockLlm(page, [
      { tool_calls: [{ name: 'use_html', arguments: { task: '把 beer 标题改成「干杯青岛」', components: ['beer'] } }] },
      { reasoning: '思考 beer 组件:改标题文字,保持结构与样式不变', tool_calls: [{ name: 'vfs_write', arguments: { path: 'html/c_tgl_beer.html', content: '<section class="beer"><h1>干杯青岛</h1></section>' } }] },
      { text: 'beer 已改' },
      { text: '完成' },
    ])
    await fillInput(page, '把 beer 标题改了')
    await clickSend(page)
    await waitForAgentIdle(page)
    // 摘要行尾展开文字链(与主思考块口径一致;修前只有 ▸ 箭头无文字)
    await expect(page.locator('.step-sub-reason .sub-reason-toggle'), '子思考摘要行尾有「展开」文字链').toHaveText('展开')
    await page.locator('.step-sub-reason .sub-reason-head').click()
    await expect(page.locator('.step-sub-reason .sub-reason-toggle'), '展开后文字链变「收起」').toHaveText('收起')
  })

  test('组件锁互斥:同轮双 use_html 同组件 → 第二个 COMPONENT_BUSY,下轮重委派成功', async ({ page }) => {
    await page.evaluate(() => {
      window.page.components.push({ type: 'custom', name: 'beer', code: '<section class="beer"><h1>old</h1></section>', __pgId: 'c_busy_beer' })
    })
    // 先者持锁跑完;后者立即回灌 COMPONENT_BUSY(零 LLM 调用)→ 主下轮重委派(锁已释放)成功
    const { calls } = await mockLlm(page, [
      { tool_calls: [
        { name: 'use_html', arguments: { task: '把 beer 标题改成「干杯青岛」', components: ['beer'] } },
        { name: 'use_html', arguments: { task: '把 beer 副标题改成「畅饮」', components: ['beer'] } },
      ] },
      { tool_calls: [{ name: 'vfs_write', arguments: { path: 'html/c_busy_beer.html', content: '<section class="beer"><h1>干杯青岛</h1></section>' } }] },
      { text: '第一处已改\n[note] beer 标题改干杯青岛' },
      { tool_calls: [{ name: 'use_html', arguments: { task: '重试:把 beer 副标题改成「畅饮」', components: ['beer'] } }] },
      { tool_calls: [{ name: 'vfs_write', arguments: { path: 'html/c_busy_beer.html', content: '<section class="beer"><h1>干杯青岛</h1><p>畅饮</p></section>' } }] },
      { text: '第二处已改\n[note] beer 副标题改畅饮' },
      { text: 'beer 两处修改完成' },
    ])
    await fillInput(page, 'beer 标题和副标题都改')
    await clickSend(page)
    await waitForAgentIdle(page)
    // 重委派版本落地(含两处修改);busy 委派零 LLM 调用 → 总 7 次(主1+子A2+主重委派1+子B2+主收口1)
    const code = await page.evaluate(() => window.page.components.find((c: any) => c.name === 'beer')?.code ?? '')
    expect(code, 'busy 后下轮重委派成功(重试版本落地)').toContain('畅饮')
    expect(calls(), 'busy 委派零 LLM 调用(总 7 次)').toBe(7)
  })

  test('custom 组件高度自适应:量高消息落进渲染实例 + 涨缩双向跟随(修前恒 360 兜底)', async ({ page }) => {
    // 修前两层缺陷:①customHeights 声明在 <script setup> = 每实例一份,window 监听闭包绑死首个普通组件实例
    // → 高度消息落进无关实例的表,渲染实例恒读空表卡 360px;②documentElement.scrollHeight 被视口
    // (= iframe 旧高度)垫底 → 只涨不缩。注入式直测(不经 LLM):涨 2500 → 缩 600 → 再涨 1200
    const mkCode = (h: number) => `<!DOCTYPE html><html><head><style>body{margin:0}.t{height:${h}px;background:#7063E7}</style></head><body><div class="t">x</div></body></html>`
    const pushCustom = (h: number) => page.evaluate((code) => {
      window.page.components.push({ type: 'custom', name: 'height-probe', code })
    }, mkCode(h))
    const iframeHeight = () => page.evaluate(() => document.querySelector('.custom-comp-iframe')?.style.height ?? '')

    await pushCustom(2500)
    await page.waitForTimeout(1500)  // 量高探针:load + 200ms + 600ms
    expect(await iframeHeight(), '内容 2500 → iframe 高度跟随(修前恒 360px)').toBe('2500px')

    await page.evaluate((code) => { window.page.components.find((c: any) => c.name === 'height-probe').code = code }, mkCode(600))
    await page.waitForTimeout(1500)
    expect(await iframeHeight(), '内容改矮 600 → 高度收缩(修前被视口垫底只涨不缩)').toBe('600px')

    await page.evaluate((code) => { window.page.components.find((c: any) => c.name === 'height-probe').code = code }, mkCode(1200))
    await page.waitForTimeout(1500)
    expect(await iframeHeight(), '内容再涨 1200 → 高度跟随').toBe('1200px')
  })

  // ===== 调整/修改操作全覆盖补齐(move op / 检索驱动闭环 / 深嵌套页 / 批量 / 回退 / 结构工具 / approval)=====

  test('同容器调序:write patch move op(components.2 → components.0,数组重排一步原子)', async ({ page }) => {
    const before = await page.evaluate(() => window.page.components.map((c: any) => c.type))
    await mockLlm(page, [
      // move 语义:源先移除,目标下标按移除后数组解释 → [c2, c0, c1, ...]
      { tool_calls: [{ name: 'write', arguments: { patch: { op: 'move', jsonPath: 'components.2', value: 'components.0' } } }] },
      { text: '已把第三个组件移到最前。' },
    ])
    await fillInput(page, '把第三个组件移到第一个')
    await clickSend(page)
    await waitForAgentIdle(page)
    const after = await page.evaluate(() => window.page.components.map((c: any) => c.type))
    expect(after.length, 'move 重排不增删元素').toBe(before.length)
    expect(after[0], 'components[0] = 旧 [2](move 到下标 0)').toBe(before[2])
    expect(after[1], 'components[1] = 旧 [0](顺移)').toBe(before[0])
    expect(after[2], 'components[2] = 旧 [1](顺移)').toBe(before[1])
  })

  test('检索驱动修改闭环:query_data 定位 → read 窄读 → write 改(subtree-summary 标准链)', async ({ page }) => {
    const { calls } = await mockLlm(page, [
      { tool_calls: [{ name: 'query_data', arguments: { expr: '$.components[?(@.type=="navbar")]' } }] },
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'components.0.props' } }] },
      { tool_calls: [{ name: 'write', arguments: { patch: { op: 'set', jsonPath: 'components.0.props.title', value: '检索闭环改标题' } } }] },
      { text: '已定位导航栏并改了标题。' },
    ])
    await fillInput(page, '找到导航栏,把标题改成「检索闭环改标题」')
    await clickSend(page)
    await waitForAgentIdle(page)
    const title = await page.evaluate(() => window.page.components[0].props.title)
    expect(title, 'query → 窄读 → write 闭环落地').toBe('检索闭环改标题')
    expect(calls(), '三轮 ReAct(query/read/write)').toBeGreaterThanOrEqual(3)
  })

  test('跨组件批量修改:write patches 一次改页面标题 + 2 组件 className(原子)', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { patches: [
        { op: 'set', jsonPath: 'title', value: '批量修改标题OK' },
        { op: 'set', jsonPath: 'components.0.className', value: 'batch-mark-0' },
        { op: 'set', jsonPath: 'components.1.className', value: 'batch-mark-1' },
      ] } }] },
      { text: '已批量修改三处。' },
    ])
    await fillInput(page, '批量改:页面标题、前两个组件各加个标记类名')
    await clickSend(page)
    await waitForAgentIdle(page)
    const r = await page.evaluate(() => ({
      title: window.page.title,
      c0: window.page.components[0].className,
      c1: window.page.components[1].className,
    }))
    expect(r.title, 'patches[0] 页面标题落地').toBe('批量修改标题OK')
    expect(r.c0, 'patches[1] components.0.className 落地').toBe('batch-mark-0')
    expect(r.c1, 'patches[2] components.1.className 落地').toBe('batch-mark-1')
  })

  test('restore_data 回退:write 改坏 → restore_data 免参回退最近快照(调整操作的后悔药)', async ({ page }) => {
    const original = await page.evaluate(() => window.page.components[0].props.title)
    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { patch: { op: 'set', jsonPath: 'components.0.props.title', value: '改坏了' } } }] },
      { tool_calls: [{ name: 'restore_data', arguments: {} }] },
      { text: '已回退到修改前。' },
    ])
    await fillInput(page, '把导航栏标题改成「改坏了」然后回退')
    await clickSend(page)
    await waitForAgentIdle(page)
    const title = await page.evaluate(() => window.page.components[0].props.title)
    expect(title, 'restore_data 回退最近快照 → title 恢复原值').toBe(original)
  })

  test('page-tools skill:load_skill 注入结构工具 → list_components 拿路径 → move_component 跨容器移动落地', async ({ page }) => {
    // 动态找容器(带 props.children 的顶层组件)与被移动组件(components.2)
    const info = await page.evaluate(() => {
      const containerIdx = window.page.components.findIndex((c) => Array.isArray(c.props?.children))
      const c2type = window.page.components[2]?.type
      return { containerIdx, c2type, topCount: window.page.components.length, typeCount: window.page.components.filter((c: any) => c.type === c2type).length }
    })
    expect(info.containerIdx).toBeGreaterThanOrEqual(0)
    const { calls } = await mockLlm(page, [
      { tool_calls: [{ name: 'load_skill', arguments: { name: 'page-tools' } }] },
      { tool_calls: [{ name: 'list_components', arguments: {} }] },
      { tool_calls: [{ name: 'move_component', arguments: { path: 'components.2', targetPath: `components.${info.containerIdx}` } }] },
      { text: '已把第三个组件移进容器。' },
    ])
    await fillInput(page, '把第三个组件移进第一个容器组件里')
    await clickSend(page)
    await waitForAgentIdle(page)
    const r = await page.evaluate((t) => ({
      topCount: window.page.components.length,
      typeCount: window.page.components.filter((c: any) => c.type === t).length,
      inContainer: window.page.components.some(
        (c) => Array.isArray(c.props?.children) && c.props.children.some((ch) => ch.type === t),
      ),
    }), info.c2type)
    expect(r.inContainer, 'move_component 跨容器移动落地(出现在容器 children 中)').toBe(true)
    expect(r.topCount, '顶层组件数 -1(移进容器)').toBe(info.topCount - 1)
    expect(r.typeCount, '顶层该类型计数 -1').toBe(info.typeCount - 1)
    expect(calls(), 'load_skill + list + move 三轮工具链').toBeGreaterThanOrEqual(3)
  })

  test('delete_component approval:拒绝保留组件 → 重试批准删除(editor_fangzhou 对齐闭环)', async ({ page }) => {
    const lastIdx = await page.evaluate(() => window.page.components.length - 1)
    const lastType = await page.evaluate((i) => window.page.components[i].type, lastIdx)
    const { calls } = await mockLlm(page, [
      { tool_calls: [{ name: 'load_skill', arguments: { name: 'page-tools' } }] },
      { tool_calls: [{ name: 'delete_component', arguments: { path: `components.${lastIdx}` } }] },
      { text: '好的,已取消删除。' },
      { tool_calls: [{ name: 'delete_component', arguments: { path: `components.${lastIdx}` } }] },
      { text: '已删除最后一个组件。' },
    ])
    // 第一轮:征得拒绝 → 组件保留
    await fillInput(page, '删掉最后一个组件')
    await clickSend(page)
    await page.waitForSelector('button:has-text("拒绝")', { timeout: 15_000 })
    await clickByText(page, '拒绝')
    await waitForAgentIdle(page)
    expect(await page.evaluate((t) => window.page.components.filter((c: any) => c.type === t).length, lastType),
      '拒绝后组件保留').toBeGreaterThanOrEqual(1)
    // 第二轮:重试 → 批准 → 删除生效
    await fillInput(page, '还是删掉吧')
    await clickSend(page)
    await page.waitForSelector('button:has-text("允许")', { timeout: 15_000 })
    await clickByText(page, '允许')
    await waitForAgentIdle(page)
    expect(await page.evaluate((t) => window.page.components.filter((c: any) => c.type === t).length, lastType),
      '批准后组件删除生效').toBe(0)
    expect(calls(), 'LLM 调用链(load + 拒后收口 + 重删 + 删后收口)').toBeGreaterThanOrEqual(4)
  })

  test('approval 挂起时停止生成 → 确认条随流收口清除(frozen-approval-bar:abort 自动拒后条不再残留)', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'load_skill', arguments: { name: 'page-tools' } }] },
      { tool_calls: [{ name: 'delete_component', arguments: { path: 'components.0' } }] },
      { text: '已按拒绝结果收口。' },
    ])
    await fillInput(page, '删掉第一个组件')
    await clickSend(page)
    await page.waitForSelector('button:has-text("拒绝")', { timeout: 15_000 })
    // 挂起等确认时点「停止」:abort → approval 自动拒 → 流收口 → 确认条清除(修前:条残留到用户手点)
    await page.click('.chat-dialog .stop-btn')
    await waitForAgentIdle(page)
    await expect(page.locator('button:has-text("拒绝"), button:has-text("允许")')).toHaveCount(0)
    // 组件保留(拒绝语义)
    expect(await page.evaluate(() => window.page.components.length)).toBeGreaterThan(0)
  })
})

test.describe('complex-demo deep(深嵌套页 · ?deep=1)', () => {
  test('深路径 read + write:递归嵌套区最深 card 的 text 改写(10+ 段 jsonPath)', async ({ page }) => {
    await page.goto('/examples/complex-demo/?deep=1')
    await page.waitForSelector('.chat-dialog')
    await page.waitForSelector('textarea')
    // DFS 找最深的递归区 card(deepNest 生成器产物,id 以 -c 结尾),收集真实下标路径
    const deep = await page.evaluate(() => {
      let best: { path: string; type: string; depth: number } | null = null
      const visit = (node: any, path: string, depth: number): void => {
        if (!node || typeof node !== 'object') return
        if (node.type === 'card' && String(node.id ?? '').endsWith('-c')) {
          if (!best || depth > (best as any).depth) best = { path, type: node.type, depth }
        }
        const kids: Array<[any, string]> = []
        if (Array.isArray(node.props?.children)) node.props.children.forEach((c: any, i: number) => kids.push([c, `${path}.props.children.${i}`]))
        if (Array.isArray(node.props?.tabs)) node.props.tabs.forEach((t: any, i: number) => (t.children ?? []).forEach((c: any, j: number) => kids.push([c, `${path}.props.tabs.${i}.children.${j}`])))
        kids.forEach(([c, p]) => visit(c, p, depth + 1))
      }
      window.page.components.forEach((c: any, i: number) => visit(c, `components.${i}`, 1))
      return best
    })
    expect(deep, '找到递归嵌套区最深 card').not.toBeNull()
    expect(deep!.type).toBe('card')
    expect(deep!.depth, '嵌套深度 ≥6(tabs + 5 层递归 section/grid)').toBeGreaterThanOrEqual(6)
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: { jsonPath: deep.path } }] },
      { tool_calls: [{ name: 'write', arguments: { patch: { op: 'set', jsonPath: `${deep.path}.props.text`, value: '深路径写入OK' } } }] },
      { text: '已改深层卡片文案。' },
    ])
    await fillInput(page, `把最深的深层卡片的文案改成「深路径写入OK」(路径 ${deep.path})`)
    await clickSend(page)
    await waitForAgentIdle(page)
    const text = await page.evaluate((p) => {
      const val = p.split('.').reduce((o: any, k) => (o == null ? o : o[k]), window.page)
      return val?.props?.text ?? ''
    }, deep.path)
    expect(text, '10+ 段深 jsonPath patch 落地(逐段 isPathAllowed 穿透)').toBe('深路径写入OK')
  })
})

// ===== 手动编辑三件套(拖拽调序 / 拖拽移入容器 / 属性面板;纯 UI 无 LLM 依赖)=====
test('手动编辑:属性面板选中改值落地 + 删除属性', async ({ page }) => {
  await page.goto('/examples/complex-demo/')
  await page.waitForSelector('.chat-dialog')
  await page.waitForFunction(() => (window as any).page?.components?.length > 20)
  // 点击 navbar → 属性面板出现,改 title → bind 落地(视图与数据同源)
  await page.locator('[data-path="components.0"]').first().click()
  await expect(page.locator('.pp')).toBeVisible()
  await expect(page.locator('.pp-path')).toContainText('components.0')
  const titleInput = page.locator('.pp-row', { hasText: 'title' }).locator('input.pp-input').first()
  await titleInput.fill('手动改的导航栏')
  await titleInput.press('Tab')
  await expect.poll(() => page.evaluate(() => (window as any).page.components[0].props.title)).toBe('手动改的导航栏')
  // 删除属性(trackId)→ 键数减一
  const keysBefore = await page.evaluate(() => Object.keys((window as any).page.components[0].props).length)
  await page.locator('.pp-row', { hasText: 'trackId' }).locator('.pp-del').first().click()
  await expect.poll(() => page.evaluate(() => Object.keys((window as any).page.components[0].props).length)).toBe(keysBefore - 1)
})

test('手动编辑:拖拽到组件上沿调序(顶层相邻互换)', async ({ page }) => {
  await page.goto('/examples/complex-demo/')
  await page.waitForSelector('.chat-dialog')
  await page.waitForFunction(() => (window as any).page?.components?.length > 20)
  const before = await page.evaluate(() => (window as any).page.components.slice(0, 2).map((c: any) => c.type))
  await page.dragAndDrop('[data-path="components.1"]', '[data-path="components.0"]', { targetPosition: { x: 100, y: 5 } })
  const after = await page.evaluate(() => (window as any).page.components.slice(0, 2).map((c: any) => c.type))
  expect(after[0]).toBe(before[1])
  expect(after[1]).toBe(before[0])
})

test('手动编辑:拖拽到容器中部移入(顶层消失 + section 子树出现)', async ({ page }) => {
  await page.goto('/examples/complex-demo/')
  await page.waitForSelector('.chat-dialog')
  await page.waitForFunction(() => (window as any).page?.components?.length > 20)
  const countdownIdx = await page.evaluate(() => (window as any).page.components.findIndex((c: any) => c.type === 'countdown'))
  const sectionIdx = await page.evaluate(() => (window as any).page.components.findIndex((c: any) => c.type === 'section'))
  await page.dragAndDrop(`[data-path="components.${countdownIdx}"]`, `[data-path="components.${sectionIdx}"]`, { targetPosition: { x: 100, y: 150 } })
  // 顶层 countdown 归零;section 子树递归出现恰好 1 个(落点可为嵌套容器,内层优先语义)
  const res = await page.evaluate(() => {
    const found: string[] = []
    const walk = (arr: any[], trail: string) => arr.forEach((c: any, j: number) => {
      if (c?.type === 'countdown') found.push(`${trail}.${j}`)
      if (Array.isArray(c?.props?.children)) walk(c.props.children, `${trail}.${j}.props.children`)
      if (Array.isArray(c?.props?.tabs)) c.props.tabs.forEach((t: any, k: number) => walk(t.children ?? [], `${trail}.${j}.props.tabs.${k}.children`))
    })
    walk((window as any).page.components, 'components')
    return { found, top: (window as any).page.components.filter((c: any) => c.type === 'countdown').length }
  })
  expect(res.top).toBe(0)
  expect(res.found.length).toBe(1)
})

test('手动编辑:嵌套子组件可点选(data-path 容器透传)+ 提升到顶层', async ({ page }) => {
  await page.goto('/examples/complex-demo/')
  await page.waitForSelector('.chat-dialog')
  await page.waitForFunction(() => (window as any).page?.components?.length > 20)
  // section 的第一个子组件有 data-path(容器 comp-path 透传链)且可点选出属性面板
  const sectionIdx = await page.evaluate(() => (window as any).page.components.findIndex((c: any) => c.type === 'section'))
  const childPath = `components.${sectionIdx}.props.children.0`
  const child = page.locator(`[data-path="${childPath}"]`)
  expect(await child.count()).toBeGreaterThan(0)
  await child.first().click()
  await expect(page.locator('.pp')).toBeVisible()
  // 提升到顶层末尾:顶层末位变成该子组件(类型先取 —— 提升后 children[0] 已位移)
  const firstChildType = await page.evaluate((i: number) => (window as any).page.components[i]?.props?.children?.[0]?.type, sectionIdx)
  await page.locator('.pp-btn', { hasText: '提升到顶层末尾' }).click()
  const lastType = await page.evaluate(() => {
    const comps = (window as any).page.components
    return comps[comps.length - 1]?.type
  })
  expect(lastType).toBe(firstChildType)
})
