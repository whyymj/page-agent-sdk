// proposals-demo(content-proposals):read → propose(增量 ops,baseHash 从上轮工具结果动态提取)→
// diff 面板 → 应用写回 / 放弃不动 → resolveProposal 闭环
import { test, expect, type Page, type Route } from '@playwright/test'

/** SSE 单 chunk 序列化(OpenAI 兼容) */
const sse = (chunks: Array<Record<string, unknown>>): string =>
  chunks.map((c) => `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', model: 'mock', choices: [{ index: 0, delta: c, finish_reason: null }] })}`).join('\n\n')
    + '\n\ndata: [DONE]\n\n'

const toolCall = (name: string, args: Record<string, unknown>) => sse([{ role: 'assistant', tool_calls: [{ id: `c_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }])
const textDone = (text: string) => sse([{ role: 'assistant' }, { content: text }, { finish_reason: 'stop' }])

/**
 * 动态三步脚本:①read_content ②从请求 messages 提取上轮工具结果的 hash=XXX → 带 ops 提案 ③纯文本收口。
 * (baseHash 依赖运行时内容,静态脚本给不出 —— 从 wire 上抓)
 */
async function mockProposalFlow(page: Page): Promise<void> {
  let calls = 0
  await page.route('**/chat/completions**', async (route: Route) => {
    calls += 1
    const body = route.request().postData() || ''
    if (body.includes('生成一个简短的中文标题')) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: textDone('测试标题') })
    if (calls === 1) return route.fulfill({ status: 200, contentType: 'text/event-stream', body: toolCall('read_content', {}) })
    if (calls === 2) {
      const m = body.match(/hash=([0-9a-z]+)/)
      const baseHash = m?.[1] ?? ''
      return route.fulfill({
        status: 200, contentType: 'text/event-stream',
        body: toolCall('propose_content', {
          summary: '修正错别字',
          baseHash,
          ops: [{ op: 'replace', find: '注意力机致', with: '注意力机制' }],
        }),
      })
    }
    return route.fulfill({ status: 200, contentType: 'text/event-stream', body: textDone('已提交修改提案,请在评审面板确认。') })
  })
}

async function openAndSend(page: Page, message: string): Promise<void> {
  await page.goto('/examples/proposals-demo/')
  await page.waitForSelector('.chat-dialog', { state: 'attached' })
  await mockProposalFlow(page)
  await page.evaluate((msg) => (window as unknown as { __sdk: { send: (m: string) => Promise<unknown> } }).__sdk.send(msg), message)
  await page.waitForSelector('[data-test="proposal-panel"]', { timeout: 15000 })
}

test('提案全链:read → propose(ops)→ diff 面板 → 应用写回 textarea + applied 闭环', async ({ page }) => {
  await openAndSend(page, '修一下这篇笔记的错别字')

  // 面板:diff 行渲染(替换 = -1/+1)且含修正后文本
  await expect(page.locator('[data-test="diff-box"] .prop-row.del')).toContainText('注意力机致')
  await expect(page.locator('[data-test="diff-box"] .prop-row.add')).toContainText('注意力机制')

  // 应用:写回 textarea(宿主自己落盘)+ resolveProposal → applied 计数 + 面板关闭 + 提示
  await page.click('[data-test="apply-btn"]')
  await expect(page.locator('[data-test="source"]')).toHaveValue(/注意力机制是这篇笔记的核心概念/, { timeout: 5000 })
  await expect(page.locator('[data-test="proposal-panel"]')).toHaveCount(0)
  await expect(page.locator('[data-test="notice"]')).toContainText('已应用')
  const st = await page.evaluate(() => (window as unknown as { __sdk: { proposals: { applied: number; pending: unknown[] } } }).__sdk.proposals)
  expect(st.applied).toBe(1)
  expect(st.pending.length).toBe(0)
})

test('放弃:textarea 原样 + discarded 计数', async ({ page }) => {
  await openAndSend(page, '修一下这篇笔记的错别字')
  await page.click('[data-test="discard-btn"]')
  await expect(page.locator('[data-test="source"]')).toHaveValue(/注意力机致/, { timeout: 5000 })
  await expect(page.locator('[data-test="proposal-panel"]')).toHaveCount(0)
  const st = await page.evaluate(() => (window as unknown as { __sdk: { proposals: { discarded: number } } }).__sdk.proposals)
  expect(st.discarded).toBe(1)
})
