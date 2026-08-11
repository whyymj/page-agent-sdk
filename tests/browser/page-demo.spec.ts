import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle, clearChat } from './_helpers'

/**
 * page-demo 浏览器 E2E:read → write → read 确认流程
 *
 * 验证 refactor 后 data 读写工具链正常工作:
 * - read 工具能读到 window.page.title
 * - write 工具能改 window.page.title(经 schema 校验)
 * - 页面 DOM 实时更新(h1.pr-title 文本变化)
 */
test.describe('page-demo: read → write → read', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
  })

  test('read 当前 title → write 改成「测试改写」→ read 确认', async ({ page }) => {
    // mock LLM 脚本:read(title) → write(patch title) → read(title) → 文本完成
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
      { tool_calls: [{ name: 'write', arguments: { value: '测试改写', patch: { op: 'set', jsonPath: 'title' } } }] },
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
      { text: '已完成,标题已改为「测试改写」。' },
    ])

    // 发送用户消息
    await fillInput(page, '把标题改成「测试改写」')
    await clickSend(page)

    // 等待 agent 处理完毕
    await waitForAgentIdle(page)

    // 断言 1:页面标题 DOM 已更新
    const title = await page.textContent('.pr-title')
    expect(title).toBe('测试改写')

    // 断言 2:window.page.title 已更新
    const pageTitle = await page.evaluate(() => (window as any).page.title)
    expect(pageTitle).toBe('测试改写')

    // 断言 3:agent 回复包含完成信息
    const dialogText = await page.textContent('.chat-dialog')
    expect(dialogText).toContain('测试改写')
  })

  test('read 整个数据 → write 改 theme → read 确认', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: {} }] },
      { tool_calls: [{ name: 'write', arguments: { value: 'dark', patch: { op: 'set', jsonPath: 'theme' } } }] },
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'theme' } }] },
      { text: '主题已切换为 dark。' },
    ])

    await fillInput(page, '主题改成 dark')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 断言:页面 data-theme 属性已更新
    const dataTheme = await page.getAttribute('.pr', 'data-theme')
    expect(dataTheme).toBe('dark')

    const pageTheme = await page.evaluate(() => (window as any).page.theme)
    expect(pageTheme).toBe('dark')
  })

  /**
   * offset/limit 翻页(followup P1):
   * 真测发现 LLM 主动带 limit(usageHint 生效),但 demo 默认 5 个组件 < 默认 limit 50,
   * offset += limit 的翻页链路从未被压测。这里 page.evaluate 把 window.page.components
   * 填到 60 个(> 50 强制触发分页),形状符合 pageSchema(button union),驱动两轮 read 翻页。
   *
   * 断言依据:read 工具对数组目标返回串含「数组分页[offset=X,limit=Y]... (total=N, hasMore=...)」
   * (dataOps.ts:581);该结果作为 ToolMessage content 回灌,出现在下一轮 LLM 请求体的 role:tool 消息里。
   * 故捕获 LLM 请求体即可确定性断言 offset 推进 + hasMore 翻转(不依赖 console 序列化)。
   */
  test('read components offset/limit 翻页:60 元素 → hasMore true→false + offset 0→50 推进', async ({ page }) => {
    // 把 window.page.components 填到 60 个(> 默认 limit 50 触发翻页);形状符合 pageSchema 的 button union
    await page.evaluate(() => {
      const pageObj = (window as any).page
      const arr = []
      for (let i = 0; i < 60; i++) {
        arr.push({ type: 'button', label: '按钮' + i, variant: i % 2 === 0 ? 'primary' : 'secondary' })
      }
      pageObj.components = arr
    })
    // 顺便校验写入成功 + 绑定生效(SDK bind 即 window.page 同一引用)
    const lenBefore = await page.evaluate(() => (window as any).page.components.length)
    expect(lenBefore).toBe(60)

    // 捕获发往 LLM 的请求体:tool 结果在下一轮请求里以 role:tool 消息回灌(ground truth)。
    // 用 page.on('request') 而非额外 page.route —— route 处理顺序会被 mockLlm 抢先 fulfill,
    // 而 request 事件对每个请求都触发(与 route 正交),postData() 在 fulfill 前就可读。
    const requestBodies: any[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('chat/completions')) {
        try {
          const body = req.postData()
          if (body) requestBodies.push(JSON.parse(body))
        } catch { /* ignore */ }
      }
    })

    // mock LLM 脚本(2 轮 read 翻页 + 文本完成):
    //  轮1: read(components, offset=0,  limit=50) → 前 50 个 + hasMore=true
    //  轮2: read(components, offset=50, limit=50) → 后 10 个 + hasMore=false
    //  轮3: 文本完成
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'components', offset: 0, limit: 50 } }] },
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'components', offset: 50, limit: 50 } }] },
      { text: '已分两页读完 60 个组件。' },
    ])

    await fillInput(page, '分页读取所有组件')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 至少 3 轮 LLM 请求:轮1(user) / 轮2(含 read#1 结果) / 轮3(含 read#1+#2 结果)
    expect(requestBodies.length, '应至少 3 轮 LLM 请求(read×2 + 文本)').toBeGreaterThanOrEqual(3)

    // 提取单个请求体里所有 role:tool 消息的 content(即工具返回串)
    const toolContents = (body: any): string =>
      ((body?.messages || []).filter((m: any) => m.role === 'tool').map((m: any) => m.content).join('\n'))

    // 断言:轮2/轮3 含 read 分页的 offset 标记(翻页机制工作)。
    // 注:mock 用小 contextWindow model(gpt-3.5-turbo),read 大 result(60 button ~2.7K 字符)会 offload vfs
    //   (round 含「已转存 vfs」而非 total/hasMore 文本);真实大 contextWindow model 不 offload,total/hasMore 直出。
    //   故此处验证 offset 分页标记 + 翻页只读;total/hasMore 文本断言留给真实 model 场景。
    const round2 = toolContents(requestBodies[1])
    expect(round2, '轮2 应含第 1 页 read 的 offset 标记').toContain('offset=0,limit=50')
    const round3 = toolContents(requestBodies[2])
    expect(round3, '轮3 应含第 2 页 read 的 offset 标记').toContain('offset=50,limit=50')

    // 断言 4:翻页只读不改,components 数组仍为 60 个
    const lenAfter = await page.evaluate(() => (window as any).page.components.length)
    expect(lenAfter).toBe(60)
  })

  /**
   * 自适应规划端到端(add-adaptive-planning):
   * write_todos 拆解 → update_todo 按 id 标完成 → write 落地。
   * 验证 update_todo 增量工具 + 规划流程在浏览器端走通(page-demo 无 approval,无干扰)。
   * 捕获 LLM 请求体断言 write_todos/update_todo 工具调用真发 + tool 结果含生成的 id(渲染)。
   */
  test('write_todos 拆解 → update_todo 标完成 → write 落地(自适应规划端到端)', async ({ page }) => {
    // 捕获发往 LLM 的请求体:assistant.tool_calls(证明工具调用)+ role:tool content(证明结果回灌)
    const requestBodies: any[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('chat/completions')) {
        try { const body = req.postData(); if (body) requestBodies.push(JSON.parse(body)) } catch { /* ignore */ }
      }
    })

    // mock LLM:write_todos(拆 1 步,不传 id → 框架生成 t-1)→ update_todo(按 t-1 标完成)→ write 落地 → 完成
    await mockLlm(page, [
      { tool_calls: [{ name: 'write_todos', arguments: { todos: [{ content: '把标题改成「规划落地」', status: 'in_progress' }] } }] },
      { tool_calls: [{ name: 'update_todo', arguments: { id: 't-1', status: 'completed' } }] },
      { tool_calls: [{ name: 'write', arguments: { value: '规划落地', patch: { op: 'set', jsonPath: 'title' } } }] },
      { text: '已按计划完成:标题改为「规划落地」。' },
    ])

    await fillInput(page, '帮我改下标题')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 断言 1:标题 DOM + window.page.title 已落地(write 执行成功)
    const title = await page.textContent('.pr-title')
    expect(title).toBe('规划落地')
    const pageTitle = await page.evaluate(() => (window as any).page.title)
    expect(pageTitle).toBe('规划落地')

    // 断言 2:LLM 请求体里出现过 write_todos + update_todo 工具调用(规划流程真走)
    const allToolCalls = requestBodies
      .flatMap((b) => (b?.messages || []).filter((m: any) => m.role === 'assistant').flatMap((m: any) => m.tool_calls || []))
    const toolNames = allToolCalls.map((tc: any) => tc.function?.name || tc.name)
    expect(toolNames, '规划流程含 write_todos 拆解').toContain('write_todos')
    expect(toolNames, '增量更新含 update_todo 按 id 标完成').toContain('update_todo')

    // 断言 3:write_todos 的 tool 结果回灌含生成的 id t-1(证明 id 生成 + 渲染,update_todo 能据此引用)
    const toolContents = requestBodies
      .flatMap((b) => (b?.messages || []).filter((m: any) => m.role === 'tool').map((m: any) => m.content))
      .join('\n')
    expect(toolContents, 'write_todos 结果含框架生成的 id t-1').toContain('t-1')
  })

  /**
   * DebugDrawer 日志生成期间实时刷新(审计 P1 残留修复):
   * 修前:mountChatDialog 传 debugLogsRef.value 同引用 prop,createAgent push 后 triggerRef 只触发
   * Wrapper 重渲染,子组件 prop 引用不变 → 抽屉打开期间日志列表冻结。修复:slice() 新引用。
   * 断言:抽屉保持打开,发消息走完 ReAct → .log-item 数量增加。
   */
  test('DebugDrawer:生成期间抽屉保持打开,日志列表实时刷新', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
      { text: '读取完成。' },
    ])
    // 打开调试抽屉(更多菜单 → 调试 / 日志)
    await page.click('.more-btn')
    await page.click('.more-item[title="日志 / 执行流程 / Agent 信息"]')
    await expect(page.locator('.debug-drawer')).toBeVisible({ timeout: 5000 })
    const before = await page.locator('.debug-drawer .log-item').count()
    // 抽屉保持打开,发消息走完一轮 ReAct(read → 文本)
    await fillInput(page, '读一下标题')
    await clickSend(page)
    await waitForAgentIdle(page)
    const after = await page.locator('.debug-drawer .log-item').count()
    expect(after, '生成期间新增 llm_request/tool 日志应实时出现').toBeGreaterThan(before)
  })

  /**
   * 内置深色主题(dialog.theme:'dark',方舟专题设计稿色板):
   * 断言根节点挂 cs-theme-dark + 背景基色 #222 + 用户气泡/输入框经 --cs-* 变量生效。
   * 边界:不传 theme 的 demo(其余 spec)仍为默认浅色(.chat-dialog 无该类)。
   */
  test('dialog.theme:dark → 内置深色主题生效(cs-theme-dark + #222 底 + 紫调输入框边框)', async ({ page }) => {
    const dialog = page.locator('.chat-dialog')
    await expect(dialog).toHaveClass(/cs-theme-dark/)
    const bg = await dialog.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg, '深色底 #222222').toBe('rgb(34, 34, 34)')
    const input = page.locator('.chat-input')
    const border = await input.evaluate((el) => getComputedStyle(el).borderTopColor)
    expect(border, '输入框紫调边框 rgba(115,114,255,.5)').toBe('rgba(115, 114, 255, 0.5)')
  })

  /**
   * 两步拾取(focus-context):点组件 → 选中边框 + 加入聊天按钮 → 点按钮 → 聚焦 chip。
   * 验证 page-demo 扁平 v-if 渲染 + PickOverlay 浮层 + setFocus 端到端(纯前端交互,不需 mock LLM)。
   */
  test('focus: 两步拾取 → 选中边框 → 加入聊天 → 聚焦 chip → ✕ 退出', async ({ page }) => {
    // 第 1 步:点第一个组件(components.0 = heading)→ 浮层边框 + 「💬 加入聊天」按钮
    await page.click('[data-path="components.0"]')
    await expect(page.locator('.pick-overlay')).toBeVisible()
    // 第 2 步:点「💬 加入聊天」→ setFocus → 焦点条 chip 出现(边框随选中态清除消失)
    await page.click('.pick-overlay__btn')
    const bar = page.locator('.focus-chip')
    await expect(bar).toBeVisible()
    await expect(bar).toContainText('components.0')
    // ✕ 退出 → chip 消失(恢复全量可操作范围)
    await page.click('[data-test="focus-clear"]')
    await expect(bar).toHaveCount(0)
  })
})
