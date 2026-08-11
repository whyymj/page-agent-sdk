/**
 * html-page-demo 浏览器 E2E(createHtmlSubagent codeKind:'html' + 格式校验链)
 *
 * mock LLM 脚本同时驱动主 agent 与子 agent(共用同一端点,按调用顺序消费):
 *  - 主:use_html 委派 → 收尾
 *  - 子:vfs_write 代码 → 收口(verify beforeReturn 门禁扫 vfs 文件)
 *
 * 覆盖:① 合法片段一次通过 → v-html 预览渲染;② 未闭合标签 → 门禁回灌自纠(vfs_edit 修正)→ 预览更新
 */
import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, waitForAgentIdle, clearChat } from './_helpers'

test.describe('html-page-demo: HTML 页面生成(v-html 注入 + 格式校验链)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/examples/html-page-demo/')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
  })

  test('合法片段一次通过 → v-html 预览实时渲染', async ({ page }) => {
    const tracker = await mockLlm(page, [
      { tool_calls: [{ name: 'use_html', arguments: { task: '生成一个欢迎区块' } }] },
      {
        tool_calls: [{
          name: 'vfs_write',
          arguments: { path: 'html/welcome.html', content: '<section class="pg-welcome"><h1>欢迎来到演示</h1><p>这是 v-html 注入的片段</p></section>' },
        }],
      },
      { text: '已生成 welcome 区块代码' },
      { text: '已完成,预览区已实时更新' },
    ])

    await fillInput(page, '生成一个欢迎区块')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 预览区经 v-html 渲染出片段内容
    const preview = await page.textContent('.preview')
    expect(preview).toContain('欢迎来到演示')
    expect(preview).toContain('这是 v-html 注入的片段')
    // 来源路径标注 + 代码查看入口
    expect(await page.textContent('.preview-col .hint')).toContain('html/welcome.html')
    expect(await page.locator('.code-view summary').count()).toBe(1)
    // 主 agent 收尾回复
    expect(await page.textContent('.chat-dialog')).toContain('已完成')
    expect(tracker.calls()).toBe(4)
  })

  test('未闭合标签 → verify 门禁回灌自纠(vfs_edit 修正)→ 预览为修正后内容', async ({ page }) => {
    const broken = '<section class="pg-hero"><h1>特惠专区'
    const fixed = '<section class="pg-hero"><h1>特惠专区</h1></section>'
    const tracker = await mockLlm(page, [
      { tool_calls: [{ name: 'use_html', arguments: { task: '生成促销区块' } }] },
      { tool_calls: [{ name: 'vfs_write', arguments: { path: 'html/hero.html', content: broken } }] },
      { text: '已生成促销区块' },   // 子 agent 首次收口 → 门禁扫出 UNCLOSED_TAG,回灌 feedback
      { tool_calls: [{ name: 'vfs_edit', arguments: { path: 'html/hero.html', oldString: broken, newString: fixed } }] },
      { text: '已修正并完成促销区块' },  // 门禁通过 → 子 agent 返回
      { text: '促销区块已生成,预览区已更新' },
    ])

    await fillInput(page, '生成促销区块')
    await clickSend(page)
    await waitForAgentIdle(page)

    // 预览为修正后的内容(闭合标签正常渲染)
    const preview = await page.textContent('.preview')
    expect(preview).toContain('特惠专区')
    // 6 次 model 调用 = 门禁触发了一次自纠(无门禁时子 agent 第 3 次即收口)
    expect(tracker.calls()).toBe(6)
    expect(await page.textContent('.chat-dialog')).toContain('促销区块已生成')
  })
})
