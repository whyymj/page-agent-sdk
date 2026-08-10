/**
 * 浏览器 E2E 测试共享:mock LLM(网络拦截 SSE)+ DOM 交互工具
 *
 * 原理:page.route() 拦截 LLM API 端点,按脚本返回 OpenAI 兼容 SSE 流,
 * 使 agent ReAct 循环确定性走完(read → write → read → done),不依赖真 LLM。
 */
import type { Page, Route } from '@playwright/test'

// ===== 类型:脚本化的 LLM 响应 =====

export interface ToolCallResponse {
  tool_calls: { name: string; arguments: Record<string, unknown> }[]
}

export interface TextResponse {
  text: string
}

export type MockResponse = ToolCallResponse | TextResponse

/**
 * 拦截 LLM API 端点,按 script 顺序返回 mock 响应。
 * 超出 script 长度后返回空文本 stop(防止死循环)。
 *
 * @param page Playwright Page
 * @param script LLM 响应脚本(按 ReAct 轮次顺序)
 * @returns callCount 跟踪器(用于断言调用了几轮)
 */
export async function mockLlm(page: Page, script: MockResponse[], delays?: number[]): Promise<{ calls: () => number }> {
  let calls = 0
  await page.route('**/chat/completions**', async (route: Route) => {
    // SDK 内部 LLM 调用(autoTitle 会话标题生成,首轮完成后异步触发)非 agent 主 ReAct 链:
    // 识别其特征 system 提示后返回固定标题,不消费 script 项,保主链 mock 顺序确定(queue/nested 等精确依赖 script 顺序的 spec 不被错位)
    const body = route.request().postData() || ''
    if (body.includes('生成一个简短的中文标题')) {
      return route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'cache-control': 'no-cache', 'connection': 'keep-alive' },
        body: toSse({ text: '测试会话标题' }, -1),
      })
    }
    const idx = calls++
    const delay = delays?.[idx] ?? 0
    if (delay > 0) await new Promise((r) => setTimeout(r, delay))
    const resp = script[idx] ?? { text: '完成' }
    const sse = toSse(resp, idx)
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'cache-control': 'no-cache', 'connection': 'keep-alive' },
      body: sse,
    })
  })
  return { calls: () => calls }
}

/**
 * 把一个 mock 响应转成 OpenAI 兼容 SSE 流(3-4 个 chunk + [DONE])。
 */
function toSse(resp: MockResponse, idx: number): string {
  const id = `chatcmpl-mock-${idx}`
  const created = 1
  const model = 'mock'
  const chunks: string[] = []

  if ('tool_calls' in resp) {
    // 第一个 chunk:声明 tool_calls 骨架(name + 空 arguments)
    for (let i = 0; i < resp.tool_calls.length; i++) {
      const tc = resp.tool_calls[i]
      chunks.push(sseChunk(id, created, model, {
        delta: {
          role: 'assistant',
          content: null,
          tool_calls: [{ index: i, id: `call_${idx}_${i}`, type: 'function', function: { name: tc.name, arguments: '' } }],
        },
        finish_reason: null,
      }))
    }
    // 后续 chunk:填充 arguments(JSON 字符串分片)
    for (let i = 0; i < resp.tool_calls.length; i++) {
      const tc = resp.tool_calls[i]
      const argsStr = JSON.stringify(tc.arguments)
      chunks.push(sseChunk(id, created, model, {
        delta: { tool_calls: [{ index: i, function: { arguments: argsStr } }] },
        finish_reason: null,
      }))
    }
    // 结束 chunk
    chunks.push(sseChunk(id, created, model, { delta: {}, finish_reason: 'tool_calls' }))
  } else {
    // 文本响应:content 分片
    const text = resp.text
    const mid = Math.ceil(text.length / 2)
    if (mid > 0) {
      chunks.push(sseChunk(id, created, model, {
        delta: { role: 'assistant', content: text.slice(0, mid) },
        finish_reason: null,
      }))
      if (text.length > mid) {
        chunks.push(sseChunk(id, created, model, {
          delta: { content: text.slice(mid) },
          finish_reason: null,
        }))
      }
    }
    chunks.push(sseChunk(id, created, model, { delta: {}, finish_reason: 'stop' }))
  }

  chunks.push('data: [DONE]')
  return chunks.join('\n\n') + '\n\n'
}

function sseChunk(id: string, created: number, model: string, choice: Record<string, unknown>): string {
  return 'data: ' + JSON.stringify({
    id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, ...choice }],
  })
}

// ===== DOM 交互工具(绕过 ref 失效问题,用选择器定位) =====

/** 填充 textarea 并触发 Vue 响应式(page.fill 触发完整 input 事件链,v-model 可靠更新;
 *  native setter + 手动 input event 在 clearChat/重置后某些场景不触发 v-model,page.fill 更稳) */
export async function fillInput(page: Page, text: string): Promise<void> {
  // 限定 ChatDialog 内 textarea:complex-demo 等含多个 textarea(DynamicReconfigPanel),page.fill('textarea') 会填错
  await page.fill('.chat-dialog textarea', text)
}

/** 点击发送按钮(在输入区域内找最后一个可点击按钮) */
export async function clickSend(page: Page): Promise<void> {
  // 记 assistant 消息基线(click 前:agent 未启动,旧 assistant 数干净),供配对的 waitForAgentIdle 消除 TOCTOU。
  // 放 click 前而非 waitForAgentIdle 内取:clickSend 返回 → waitForAgentIdle 首行之间,高负载下 evaluate 延迟,
  // 可能赶上 agent 已产出首条 assistant → baseline 偏高 → waitForAgentIdle 永等新 assistant 超时。click 前取杜绝此竞态。
  ;(page as any)._paAssistantBaseline = await page
    .evaluate(() => document.querySelectorAll('.chat-dialog .message-row.assistant[data-msg-idx]').length)
    .catch(() => 0)
  // 等 input area 出现 enabled button(fillInput 后 Vue 响应式更新 send button enabled 可能有延迟,
  // 尤其大 schema 页面如 complex-demo;已 enabled 则立即过,不影响 page-demo 等)
  await page.waitForFunction(() => {
    const dialog = document.querySelector('.chat-dialog')
    if (!dialog) return false
    const inputArea = dialog.querySelector('.chat-input-area, .input-area, .chat-footer') || dialog
    return Array.from(inputArea.querySelectorAll('button')).some((b) => !b.disabled)
  }, { timeout: 10000 }).catch(() => {})
  await page.evaluate(() => {
    const dialog = document.querySelector('.chat-dialog')
    if (!dialog) throw new Error('.chat-dialog not found')
    const inputArea = dialog.querySelector('.chat-input-area, .input-area, .chat-footer')
    const btns = inputArea ? Array.from(inputArea.querySelectorAll('button')) : Array.from(dialog.querySelectorAll('button'))
    const enabled = btns.filter((b) => !b.disabled)
    if (!enabled.length) throw new Error('no enabled button in input area')
    enabled[enabled.length - 1].click()
  })
}

/** 点击 title 属性匹配的按钮(用于图标按钮) */
export async function clickByTitle(page: Page, title: string): Promise<void> {
  await page.evaluate((t) => {
    const btn = document.querySelector(`button[title="${t}"]`) as HTMLButtonElement
    if (!btn) throw new Error(`button[title="${t}"] not found`)
    btn.click()
  }, title)
}

/** 点击文本内容匹配的按钮 */
export async function clickByText(page: Page, text: string): Promise<void> {
  await page.evaluate((t) => {
    const btns = Array.from(document.querySelectorAll('button'))
    const btn = btns.find((b) => (b.textContent || '').includes(t) && !b.disabled)
    if (!btn) throw new Error(`button containing "${t}" not found or disabled`)
    btn.click()
  }, text)
}

/**
 * 等待 agent 处理完成:消息数基线 + busy(class 检测)。两层判定消除旧版 flaky:
 *
 * ① baseline(clickSend click 前记的 assistant 消息数):要求「产生新 assistant 消息」才认「agent 已处理」,
 *    消除旧版 TOCTOU —— 旧两阶段都判「停止按钮」瞬时显隐,阶段1 等「停止出现」10s 超时被 .catch 吞掉后,
 *    阶段2「停止消失」无法区分「未开始」与「已完成」,agent 启动延迟时误判 idle,读到未改数据。
 * ② busy 读 send-btn 的 stop-btn class(布尔绑定 state.loading)。旧版用 textContent.includes('停止') 是错的:
 *    ChatInput 停止按钮内容是 SVG 图标(rect/箭头,无文字),textContent 恒不含「停止」→ busy 恒 false →
 *    waitForAgentIdle 永远立即返回(仅靠阶段1 的 10s 超时「碰运气」等待,多轮/高负载下 10s 跑不完即读到中间态)。
 *    stop-btn class 布尔绑定 state.loading(整个 fetchStream 期间恒 true),稳定可靠。
 *
 * baseline 取自 clickSend(click 前,旧 assistant 数);未配对调用(无 clickSend 前置)则当场取,兼容降级。
 * `.message-row.assistant[data-msg-idx]` 排除 MessageList 的 loading 占位行(占位行无 data-msg-idx,避免 count 误增)。
 */
export async function waitForAgentIdle(page: Page, timeout = 60_000): Promise<void> {
  const stored = (page as any)._paAssistantBaseline
  delete (page as any)._paAssistantBaseline // 用完清,防同 test 多轮调用残留(下次 clickSend 重记)
  const baseline = typeof stored === 'number'
    ? stored
    : await page
        .evaluate(() => document.querySelectorAll('.chat-dialog .message-row.assistant[data-msg-idx]').length)
        .catch(() => 0)
  await page.waitForFunction(
    (base) => {
      const dialog = document.querySelector('.chat-dialog')
      const inputArea = (dialog && (dialog.querySelector('.chat-input-area, .input-area, .chat-footer') || dialog)) || document
      // busy 读 send-btn 的 stop-btn class(绑定 state.loading);按钮内容是 SVG 图标无文字,不可用 textContent 检测
      const sendBtn = inputArea.querySelector('button.send-btn')
      const busy = !!sendBtn && sendBtn.classList.contains('stop-btn')
      const assistantCount = document.querySelectorAll('.chat-dialog .message-row.assistant[data-msg-idx]').length
      return assistantCount > base && !busy
    },
    baseline,
    { timeout },
  )
}

/** 清空对话(避免上一轮残留) */
export async function clearChat(page: Page): Promise<void> {
  // 「更多」下拉合并了清空(调试/skill/清空);先开下拉再点清空(老版无下拉时 clickByTitle('更多') no-op)
  await clickByTitle(page, '更多').catch(() => {})
  await page.waitForTimeout(120)
  await clickByTitle(page, '清空对话').catch(() => {})
  // 点确认弹窗(如果有)
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    const confirm = btns.find((b) => (b.textContent || '').trim() === '确认' && !b.disabled)
    if (confirm) confirm.click()
  }).catch(() => {})
  // 兜底关闭「更多」下拉/历史面板:点 more-overlay 触发其 @click(moreOpen=false/historyOpen=false)。
  // 若「清空对话」按钮不存在(无消息时下拉无该项,上面 clickByTitle catch 吞掉),下拉仍打开 →
  // 全屏遮罩(position:fixed inset:0 z-index:15)残留会拦截后续 pane-left 交互(focus 测试点组件暴露)。
  await page.evaluate(() => { const o = document.querySelector('.chat-dialog .more-overlay') as HTMLElement | null; if (o) o.click() }).catch(() => {})
  await clearStorage(page)  // 清持久化,防跨 spec/同 id(如 page-demo + error-recovery 共用 page-demo demo)storage 污染(followup P0)
  await page.waitForTimeout(200)
}

/** 清 indexedDB + localStorage/sessionStorage + cookies,防跨 spec storage 残留(followup P0 flaky 诊断) */
export async function clearStorage(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      try { localStorage.clear() } catch { /* ignore */ }
      try { sessionStorage.clear() } catch { /* ignore */ }
      // indexedDB:尽力清所有库(chromium 支持 indexedDB.databases();不支持则跳过 —— 每 test 新 context 已隔离)
      const anyIdb = (globalThis as any).indexedDB
      if (anyIdb && typeof anyIdb.databases === 'function') {
        anyIdb.databases().then((dbs: any[]) => dbs.forEach((d) => { try { indexedDB.deleteDatabase(d.name) } catch { /* ignore */ } })).catch(() => {})
      }
    })
  } catch { /* ignore */ }
  try { await page.context().clearCookies() } catch { /* ignore */ }
}
