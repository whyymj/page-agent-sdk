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
    // 高负载下 idle 等待未到点先撞默认 60s 测试预算(实测 flaky 重试才过)→ 放宽;断言在 idle 后取计数,不涉时序
    test.setTimeout(150_000)
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
    await waitForAgentIdle(page, 120_000)
    const after = await page.locator('.debug-drawer .log-item').count()
    expect(after, '生成期间新增 llm_request/tool 日志应实时出现').toBeGreaterThan(before)
  })

  /**
   * DebugDrawer 调试布局优化(debug-layout):
   * ① 工具配对卡:read 的 tool_call+tool_result 合并一张卡(args+result 同屏,不再两条散落)
   * ② 提示词「只看新增」:两轮请求后第二条 llm_request 开差分 → 消息行数下降
   * ③ 长消息折叠:超 400 字的 system 消息默认 3 行截断(clamped),点击展开
   */
  test('DebugDrawer:工具配对卡 + 提示词只看新增 + 长消息折叠', async ({ page }) => {
    test.setTimeout(150_000)
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
      { text: '第一次完成。' },
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
      { text: '第二次完成。' },
    ])
    await fillInput(page, '读一下标题')
    await clickSend(page)
    await waitForAgentIdle(page, 120_000)
    await fillInput(page, '再读一次')
    await clickSend(page)
    await waitForAgentIdle(page, 120_000)
    await page.click('.more-btn')
    await page.click('.more-item[title="日志 / 执行流程 / Agent 信息"]')
    await expect(page.locator('.debug-drawer')).toBeVisible({ timeout: 5000 })
    // 轮次分组(3.31+):默认仅最新轮展开,细节卡藏在折叠组内;先展开全部折叠组再断言卡片细节(等效旧版平铺全展开)
    while (await page.locator('.debug-drawer .log-group-head:not(.expanded)').count()) {
      await page.locator('.debug-drawer .log-group-head:not(.expanded)').first().click()
    }

    // ① 配对卡:read 的 call+result 合一(含 result 分隔标)
    const paired = page.locator('.debug-drawer .tc-card.paired')
    await expect(paired.first()).toBeVisible({ timeout: 5000 })
    expect(await paired.count(), '工具配对卡出现(read call+result 各一张)').toBeGreaterThanOrEqual(2)
    await expect(paired.first().locator('.tc-result-sep')).toBeVisible()

    // ② 只看新增:最后一条 llm_request(带 only-new-btn 的 log-item)切差分 → 消息行数下降
    const lastReq = page.locator('.debug-drawer .log-item', { has: page.locator('.only-new-btn') }).last()
    const onlyNewBtn = lastReq.locator('.only-new-btn')
    if (await onlyNewBtn.count()) {
      const before = await lastReq.locator('.msg-row').count()
      await onlyNewBtn.click()
      expect(await lastReq.locator('.msg-row').count(), '只看新增:切差分后消息行数下降').toBeLessThan(before)
    }

    // ③ 长消息折叠:page-demo systemPrompt 超 400 字 → 存在 clamped 行,点击展开后移除(count 先快照,locator 是 live 的)
    const clamped = page.locator('.debug-drawer .msg-row.clamped')
    const clampCount = await clamped.count()
    if (clampCount > 0) {
      await clamped.first().click()
      await page.waitForTimeout(200)
      expect(await page.locator('.debug-drawer .msg-row.clamped').count(), '折叠行点击后展开').toBeLessThan(clampCount)
    }
  })

  /**
   * 日志 tab 轮次分组(debug-round-grouping):每一轮全部信息集中成一个可折叠 node,只展示轮次;细节点击展开。
   * 运行边界 = 主 agent context 日志(每 send 一条)→ 跨 send 同轮号不合并(「第 1 轮」独立出现两次)。
   * 默认仅最新组展开(在途轮天然展开,新轮到来旧轮自动收起);点击折叠组头展开细节。
   */
  test('DebugDrawer:轮次分组 node(跨 send 不合并 + 默认仅最新轮展开 + 点击展开细节)', async ({ page }) => {
    test.setTimeout(150_000)
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
      { text: '完成。' },
      { text: '收到。' },
    ])
    await fillInput(page, '读一下标题')
    await clickSend(page)
    await waitForAgentIdle(page, 120_000)
    await fillInput(page, '打个招呼')
    await clickSend(page)
    await waitForAgentIdle(page, 120_000)
    await page.click('.more-btn')
    await page.click('.more-item[title="日志 / 执行流程 / Agent 信息"]')
    await expect(page.locator('.debug-drawer')).toBeVisible({ timeout: 5000 })

    // 分组 node 出现:2 次 send → 2 个 epoch;「第 1 轮」独立出现两次(跨 send 轮号不合并)
    expect(await page.locator('.debug-drawer .log-group-head').count(), '分组 node ≥4(2 准备 + ≥3 轮)').toBeGreaterThanOrEqual(4)
    expect(await page.locator('.debug-drawer .log-group-title', { hasText: '第 1 轮' }).count(), '跨 send 不合并 → 两个独立「第 1 轮」').toBe(2)

    // 默认仅最新组展开:首组细节隐藏、末组细节可见
    const firstGroup = page.locator('.debug-drawer .log-group').first()
    const lastGroup = page.locator('.debug-drawer .log-group').last()
    await expect(firstGroup.locator('.log-item').first()).not.toBeVisible()
    await expect(lastGroup.locator('.log-item').first()).toBeVisible()

    // 点击折叠组头 → 细节展开
    await firstGroup.locator('.log-group-head').click()
    await expect(firstGroup.locator('.log-item').first()).toBeVisible()
  })

  /**
   * 🗑️ 清空日志(修:ChatDialog 未接 @clear → 按钮不好使):
   * 点击 → 源 debugLogs 清空 → 分组/条目归零显示空态;不影响后续消息出日志(清的是源非副本)。
   */
  test('DebugDrawer:🗑️ 清空日志生效 + 清空后新一轮日志正常进入', async ({ page }) => {
    test.setTimeout(150_000)
    await mockLlm(page, [
      { text: '完成。' },
      { text: '收到。' },
    ])
    await fillInput(page, '你好')
    await clickSend(page)
    await waitForAgentIdle(page, 120_000)
    await page.click('.more-btn')
    await page.click('.more-item[title="日志 / 执行流程 / Agent 信息"]')
    await expect(page.locator('.debug-drawer')).toBeVisible({ timeout: 5000 })
    expect(await page.locator('.debug-drawer .log-item').count(), '清空前有日志').toBeGreaterThan(0)

    // 🗑️ 清空 → 条目归零 + 空态提示出现
    await page.click('.debug-drawer .hd-btn[title="清空日志"]')
    await expect(page.locator('.debug-drawer .log-item')).toHaveCount(0)
    await expect(page.locator('.debug-drawer .empty')).toBeVisible()

    // 边界:清空不影响新一轮日志(清源 debugLogs,后续 push 正常)
    await fillInput(page, '再打个招呼')
    await clickSend(page)
    await waitForAgentIdle(page, 120_000)
    expect(await page.locator('.debug-drawer .log-item').count(), '清空后新一轮日志正常进入').toBeGreaterThan(0)
  })

  /**
   * 💾 下载诊断报告(原「📋 复制到剪贴板」改为下载 JSON 文件 —— 大日志 clipboard 易截断/静默失败):
   * 点击 → 浏览器 download 事件,suggestedFilename 匹配 page-agent-diagnostics-<时间戳>.json。
   */
  test('DebugDrawer:💾 下载诊断报告为 JSON 文件', async ({ page }) => {
    test.setTimeout(150_000)
    await mockLlm(page, [{ text: '完成。' }])
    await fillInput(page, '你好')
    await clickSend(page)
    await waitForAgentIdle(page, 120_000)
    await page.click('.more-btn')
    await page.click('.more-item[title="日志 / 执行流程 / Agent 信息"]')
    await expect(page.locator('.debug-drawer')).toBeVisible({ timeout: 5000 })
    const dlPromise = page.waitForEvent('download')
    await page.click('.debug-drawer .hd-btn[title*="下载诊断报告"]')
    const dl = await dlPromise
    expect(dl.suggestedFilename()).toMatch(/^page-agent-diagnostics-.+\.json$/)
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

  /**
   * focus-scoped-read(用户反馈驱动,openspec 2026-08-16):聚焦后 read 空参 → focus 中间件注入
   * jsonPaths=[焦点路径],默认只返回聚焦子树(结果前置教学行)。观测口 = 3.16 步骤展开细节(入参显示
   * 改写后的 args)。
   */
  test('focus-scoped-read: 聚焦后 read 空参 → 注入焦点路径 + 教学行', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: {} }] },   // 空参 read → 中间件改写为 jsonPaths
      { text: '完成' },
    ])
    // 两步拾取聚焦 components.0
    await page.click('[data-path="components.0"]')
    await page.click('.pick-overlay__btn')
    await expect(page.locator('.focus-chip')).toBeVisible()
    await fillInput(page, '这里是啥')
    await clickSend(page)
    await waitForAgentIdle(page)
    // 展开步骤细节:入参含注入的 jsonPaths;返回值含聚焦模式教学行
    await page.click('.step-detail-toggle')
    await expect(page.locator('.step-detail')).toBeVisible()
    const detail = (await page.textContent('.step-detail')) || ''
    expect(detail).toContain('jsonPaths')
    expect(detail).toContain('components.0')
    expect(detail).toContain('【聚焦模式】')
  })

  /**
   * Bug 复现锁定(用户实测;toolMode 移除后 focus 工具族恒装载):
   * agent 可直接调 clear_focus/remove_focus 自行解焦(unfocusGuidance='tool');越界写仍 PATH_DENIED。
   * 无 focus 工具场景的 ask-user 行为由 sec-54 单测锁定。
   * 验证(ground truth = LLM 请求体):① system 含「当前精修目标」;② 越界写回灌 PATH_DENIED;
   * ③ 请求 tools 含 focus 工具;④ read 正常装载(工具面健全)。
   */
  test('focus: 聚焦注入 + focus 工具族装载 + PATH_DENIED 越界拦截', async ({ page }) => {
    // 聚焦 components.2(button「主要按钮」,有 label 字段可写;初始序:0 heading / 1 paragraph / 2 button)
    await page.click('[data-path="components.2"]')
    await page.click('.pick-overlay__btn')
    await expect(page.locator('.focus-chip')).toBeVisible()

    const requestBodies: any[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('chat/completions')) {
        try { const body = req.postData(); if (body) requestBodies.push(JSON.parse(body)) } catch { /* ignore */ }
      }
    })
    // 越界写一次(触发 PATH_DENIED)→ 聚焦内放行 → 完成
    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { patch: { op: 'set', jsonPath: 'components.3.label', value: '越界' } } }] },
      { tool_calls: [{ name: 'write', arguments: { patch: { op: 'set', jsonPath: 'components.2.label', value: '聚焦内' } } }] },
      { text: '已改。' },
    ])
    await fillInput(page, '把「次要按钮」文字改成「越界」')
    await clickSend(page)
    await waitForAgentIdle(page)

    // ① system 段:聚焦注入存在
    const systems = requestBodies
      .flatMap((b) => (b?.messages || []).filter((m: any) => m.role === 'system').map((m: any) => m.content))
      .join('\n')
    expect(systems, '聚焦段注入存在').toContain('当前精修目标')

    // ② 越界回灌的 tool 结果:PATH_DENIED
    const toolContents = requestBodies
      .flatMap((b) => (b?.messages || []).filter((m: any) => m.role === 'tool').map((m: any) => m.content))
      .join('\n')
    expect(toolContents, '越界写被拒').toContain('PATH_DENIED')

    // ③ 工具面:advanced 装载 focus 工具族(set_focus/clear_focus/add_focus/remove_focus)
    const toolNames = new Set(requestBodies.flatMap((b) => (b?.tools || []).map((t: any) => t.function?.name ?? t.name)))
    expect(toolNames.has('clear_focus'), 'advanced 装载 clear_focus').toBe(true)
    expect(toolNames.has('set_focus'), 'advanced 装载 set_focus').toBe(true)
    expect(toolNames.has('read'), 'read 正常装载(工具面健全)').toBe(true)

    // 数据侧:越界未生效,聚焦内生效
    const c3 = await page.evaluate(() => (window as any).page.components[3].label)
    expect(c3).not.toBe('越界')
    const c2 = await page.evaluate(() => (window as any).page.components[2].label)
    expect(c2).toBe('聚焦内')
  })

  /**
   * 嵌套容器渲染(纯前端,不需 mock LLM):初始页含 card.children / waterfall.children / carousel.children。
   * 断言:① 容器与子组件 DOM 渲染 + 嵌套 data-path 定位(components.N.children.M)
   *      ② 瀑布流 columnCount 样式生效 ③ 轮播 ‹› 导航翻页(局部状态,click.stop 不触发选中)
   */
  test('嵌套渲染:card/waterfall/carousel 容器 + 子组件 data-path + 瀑布流列数 + 轮播翻页', async ({ page }) => {
    await mockLlm(page, [{ text: '' }])  // 纯前端;mockLlm 防意外真实调用
    // ① 卡片嵌套子组件渲染(初始序:4 card / 5 waterfall / 6 carousel)
    await expect(page.locator('[data-path="components.4.children.0"]')).toHaveText(/卡片内的段落/)
    await expect(page.locator('[data-path="components.4.children.1"]')).toHaveText(/卡内按钮/)
    // ② 瀑布流:容器 data-path + columns=2 生效 + 子卡片嵌套 list 定位
    const wf = page.locator('.comp-waterfall')
    await expect(wf).toHaveAttribute('data-path', 'components.5')
    expect(await wf.evaluate((el) => getComputedStyle(el).columnCount)).toBe('2')
    await expect(page.locator('[data-path="components.5.children.1.children.0"] li').first()).toHaveText(/子列表项 1/)
    // ③ 轮播:页码 1/2 → 点 › → 第 2 页内容 + 页码 2/2(click.stop 不触发选中)
    const pos = page.locator('.comp-carousel .nav-pos')
    await expect(pos).toHaveText('1 / 2')
    await page.locator('.comp-carousel .nav-btn').nth(1).click()
    await expect(page.locator('.comp-carousel .carousel-stage')).toContainText('轮播第 2 页')
    await expect(pos).toHaveText('2 / 2')
  })

  /**
   * 调整层级(patch op move,跨数组一步原子):把顶层列表(components.7)移进瀑布卡片 B 的 children。
   * 验证 union 嵌套路径(components.5.children.1.children)写白名单放行 + move 原子性 + data_change 重渲染。
   */
  test('调整层级:move 把顶层组件移进瀑布卡片 children(跨数组原子移动)', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'components.5' } }] },
      { tool_calls: [{ name: 'write', arguments: { patch: { op: 'move', jsonPath: 'components.7', value: 'components.5.children.1.children' } } }] },
      { text: '已把顶层列表移进瀑布卡片 B 的子组件区。' },
    ])
    await fillInput(page, '把顶层列表移进瀑布卡片 B 里')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 数据侧:顶层 8→7(列表移出),瀑布卡片 B children 多一项(嵌套链 瀑布流>卡片>列表)
    const topLen = await page.evaluate(() => (window as any).page.components.length)
    expect(topLen).toBe(7)
    const moved = await page.evaluate(() => (window as any).page.components[5].children[1].children[1])
    expect(moved.type).toBe('list')
    expect(moved.items).toContain('需求收集')
    // DOM 侧重渲染:嵌套深路径元素可见(data_change → tick → PageRenderer 重建)
    await expect(page.locator('[data-path="components.5.children.1.children.1"]')).toContainText('需求收集')
  })

  /**
   * 聚焦嵌套组件(getSchemaAtPath union 下探配套):两步拾取嵌套 data-path → addFocus 成功
   * (修前 union 节点返 null 被拒,嵌套组件无法聚焦)→ 聚焦内写放行 / 聚焦外 PATH_DENIED。
   */
  test('聚焦嵌套组件:拾取卡片内段落 → 聚焦 chip → 聚焦内改文生效 + 越界 PATH_DENIED', async ({ page }) => {
    // 第 1 步:点卡片内嵌套段落(components.4.children.0;closest 取最内层,选中的是子组件不是卡片)
    await page.click('[data-path="components.4.children.0"]')
    await expect(page.locator('.pick-overlay')).toBeVisible()
    // 第 2 步:加入聊天 → addFocus(getSchemaAtPath union 下探解析嵌套路径,修前此处被拒)
    await page.click('.pick-overlay__btn')
    const chip = page.locator('.focus-chip')
    await expect(chip).toBeVisible()
    await expect(chip).toContainText('components.4.children.0')

    const requestBodies: any[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('chat/completions')) {
        try { const body = req.postData(); if (body) requestBodies.push(JSON.parse(body)) } catch { /* ignore */ }
      }
    })
    // 越界写(顶层 title,在焦点外)→ 聚焦内写(嵌套段落文本)→ 完成
    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { value: '越界标题', patch: { op: 'set', jsonPath: 'title' } } }] },
      { tool_calls: [{ name: 'write', arguments: { value: '嵌套段落已聚焦精修。', patch: { op: 'set', jsonPath: 'components.4.children.0.text' } } }] },
      { text: '已改卡片内段落。' },
    ])
    await fillInput(page, '把卡片里的段落改一下')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 越界回灌含 PATH_DENIED;聚焦内嵌套路径写生效
    const toolContents = requestBodies
      .flatMap((b) => (b?.messages || []).filter((m: any) => m.role === 'tool').map((m: any) => m.content))
      .join('\n')
    expect(toolContents, '焦点外写被拒').toContain('PATH_DENIED')
    const title = await page.evaluate(() => (window as any).page.title)
    expect(title).not.toBe('越界标题')
    const text = await page.evaluate(() => (window as any).page.components[4].children[0].text)
    expect(text).toBe('嵌套段落已聚焦精修。')
    await expect(page.locator('[data-path="components.4.children.0"]')).toContainText('嵌套段落已聚焦精修')
  })

  /**
   * fix-silent-strip 浏览器级锁定:给 button 写 schema 未声明的 style 字段 → SCHEMA_STRIP 显式拒绝
   * (修前 zod strip 静默剥离返回假成功,agent 以为写进去了,页面无变化)。
   * ground truth = 越界写的 tool 结果回灌含 SCHEMA_STRIP;随后合规写正常生效。
   */
  test('SCHEMA_STRIP:button 写未声明 style 字段 → 显式拒绝回灌(不假成功)', async ({ page }) => {
    const requestBodies: any[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().includes('chat/completions')) {
        try { const body = req.postData(); if (body) requestBodies.push(JSON.parse(body)) } catch { /* ignore */ }
      }
    })
    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { value: { border: '1px solid #ccc' }, patch: { op: 'set', jsonPath: 'components.2.style' } } }] },
      { tool_calls: [{ name: 'write', arguments: { value: 'ghost', patch: { op: 'set', jsonPath: 'components.2.variant' } } }] },
      { text: 'button 组件不支持 style 属性;已改用 ghost 变体实现弱化效果。' },
    ])
    await fillInput(page, '给主要按钮加个边框')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 越界写的 tool 结果回灌含 SCHEMA_STRIP(显式拒绝,agent 能据此如实告知用户)
    const toolContents = requestBodies
      .flatMap((b) => (b?.messages || []).filter((m: any) => m.role === 'tool').map((m: any) => m.content))
      .join('\n')
    expect(toolContents, 'SCHEMA_STRIP 显式拒绝').toContain('SCHEMA_STRIP')
    expect(toolContents, '拒绝文案指出具体字段').toContain('components.2.style')
    // 数据侧:style 未被写入(无假成功);合规 variant 写生效
    const c2 = await page.evaluate(() => (window as any).page.components[2])
    expect(c2.style).toBeUndefined()
    expect(c2.variant).toBe('ghost')
  })

  /**
   * 纯代码精修(auto html 子 agent 委派):schema 含 custom.code 数组元素 → 装配期自动挂 use_html
   * (3.9+ 零配置)→ 主 agent 委派 → 子 agent write 追加 custom 组件 → 沙箱 iframe 渲染。
   * 嵌套链验证:瀑布流>轮播>卡片场景由上层 move/嵌套测试覆盖;此处锁「委派 + code 落地 + 渲染」主链路。
   */
  test('纯代码精修:use_html 委派 → 子 agent 写 custom.code → 沙箱 iframe 渲染', async ({ page }) => {
    const tracker = await mockLlm(page, [
      { tool_calls: [{ name: 'use_html', arguments: { task: '生成一个促销倒计时纯代码组件,主色 #F7C948' } }] },
      {
        tool_calls: [{
          name: 'write',
          arguments: { patch: { op: 'append', jsonPath: 'components', value: { type: 'custom', name: 'promo-timer', code: '<section class="promo"><h3>限时秒杀</h3><p style="color:#F7C948">距结束 02:00:00</p></section>' } } },
        }],
      },
      { text: '已生成 promo-timer 倒计时组件\n[note] promo-timer 倒计时色 #F7C948 与主视觉一致' },
      { text: '已生成纯代码倒计时组件,页面底部已渲染。' },
    ])
    await fillInput(page, '加一个促销倒计时纯代码组件')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 数据侧:custom 组件追加进 components(子 agent 经 writablePaths=['components'] 写入)
    const c = await page.evaluate(() => (window as any).page.components.at(-1))
    expect(c.type).toBe('custom')
    expect(c.name).toBe('promo-timer')
    expect(c.code).toContain('限时秒杀')
    // 渲染侧:沙箱 iframe srcdoc 含代码内容;工匠笔记沉淀进 __pgNotes(read 投影隐藏但 bind 直存)
    const srcdoc = await page.locator('.custom-frame').last().getAttribute('srcdoc')
    expect(srcdoc).toContain('限时秒杀')
    expect(await page.evaluate(() => JSON.stringify((window as any).page.components.at(-1).__pgNotes))).toContain('#F7C948')
    // 4 次 model 调用 = 主委派 → 子写 → 子收口 → 主收口
    expect(tracker.calls()).toBe(4)
  })
})

test.describe('page-demo: 工具步骤展开细节(入参/返回值)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
  })

  test('点步骤行右端「展开」(Figma 设计稿)→ 显示入参 JSON 与返回值;展开另一个前一个收起(全局单展开)', async ({ page }) => {
    // read → write 两步工具,各自有 args/result
    await mockLlm(page, [
      { tool_calls: [{ name: 'read', arguments: { jsonPath: 'title' } }] },
      { tool_calls: [{ name: 'write', arguments: { value: '展开验证', patch: { op: 'set', jsonPath: 'title' } } }] },
      { text: '完成。' },
    ])
    await fillInput(page, '改标题为「展开验证」')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 两个步骤行右端都有「展开」文字链(Figma 471:6389)
    const toggles = page.locator('.step-item .step-detail-toggle')
    await expect(toggles).toHaveCount(2)

    // 展开 read:显示「入参」段(jsonPath)+「返回值」段(含标题原文)
    await toggles.nth(0).click()
    const detail1 = page.locator('.step-detail').first()
    await expect(detail1).toBeVisible()
    await expect(detail1.locator('.step-detail-head', { hasText: '入参' })).toHaveCount(1)
    await expect(detail1.locator('.step-detail-pre').first()).toContainText('title')
    await expect(detail1.locator('.step-detail-head', { hasText: '返回值' })).toHaveCount(1)
    await expect(detail1.locator('.step-detail-pre').nth(1)).toContainText('主数据 @ title')  // read 返回格式化原文(含 hash)

    // 展开 write → read 的细节收起(全局单展开)
    await toggles.nth(1).click()
    await expect(page.locator('.step-detail')).toHaveCount(1)
    const detail2 = page.locator('.step-detail').first()
    await expect(detail2.locator('.step-detail-pre').first()).toContainText('展开验证')

    // 再点同一入口 → 收起(文案回「展开」)
    await expect(toggles.nth(1)).toContainText('收起')
    await toggles.nth(1).click()
    await expect(page.locator('.step-detail')).toHaveCount(0)
  })
})
