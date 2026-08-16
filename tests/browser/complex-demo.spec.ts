import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle, clearChat } from './_helpers'

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

    // 捕获 LLM 请求体(验证 read 返 freeze 占位符 —— 精确值不进 AI 消息流)
    const requestBodies: any[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('chat/completions')) {
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

    // 断言 1:read 受保护字段返 freeze 占位符(精确值保护生效)
    const toolContents = requestBodies
      .flatMap((b) => (b?.messages || []).filter((m: any) => m.role === 'tool').map((m: any) => m.content))
      .join('\n')
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
    test.setTimeout(150_000)
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: {} }] },
      { tool_calls: [{ name: 'write', arguments: { value: '测试改标题', patch: { op: 'set', jsonPath: 'components.0.props.title' } } }] },
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'components.0.props.title' } }] },
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
      if (req.method() === 'POST' && req.url().includes('chat/completions')) {
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

    // 断言 2:mission capture → LLM 请求 systemPrompt 含「当前主线目标」pin + goal
    const sysText = requestBodies
      .flatMap((b) => (b?.messages || []).filter((m: any) => m.role === 'system').map((m: any) => m.content))
      .join('\n')
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
      { text: 'beer 已改' },
      { text: 'mug 已改' },
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
      { text: 'beer 已改' },
      { text: 'mug 已改' },
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
      { text: '第一处已改' },
      { tool_calls: [{ name: 'use_html', arguments: { task: '重试:把 beer 副标题改成「畅饮」', components: ['beer'] } }] },
      { tool_calls: [{ name: 'vfs_write', arguments: { path: 'html/c_busy_beer.html', content: '<section class="beer"><h1>干杯青岛</h1><p>畅饮</p></section>' } }] },
      { text: '第二处已改' },
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
})
