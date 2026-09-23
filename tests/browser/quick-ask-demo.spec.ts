import { test, expect } from '@playwright/test'
import { mockLlm } from './_helpers'

/**
 * quick-ask-demo:选区一次性问答(headless 无历史)+ 记录到宿主。
 * 验证链路:选中 → 浮钮 → 面板(引用预览)→ send(quote)→ 回答 → 记录落右栏;
 * 全程不挂 SDK 对话框(headless),Esc 关闭。
 */
test.describe('quick-ask-demo: 选区一次性问答(无历史 headless)', () => {
  test('选中 → 快问 → 回答 → 记录落右栏;SDK 对话框不挂载;Esc 关闭', async ({ page }) => {
    await page.goto('/examples/quick-ask-demo/')
    // 选中第一段中「RRF」前后约 50 字(经 Range 精确控制,选区必含「RRF」)
    await page.evaluate(() => {
      const p = [...document.querySelectorAll('#article p')][0]!
      const node = p.firstChild!
      const text = node.textContent!
      const idx = text.indexOf('RRF')
      const range = document.createRange()
      range.setStart(node, Math.max(0, idx - 20))
      range.setEnd(node, Math.min(text.length, idx + 40))
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
    })
    await expect(page.locator('.qa-trigger')).toBeVisible()
    // headless 实例:SDK 对话框从不挂载(整个用例期间的元断言)
    await expect(page.locator('.chat-dialog')).toHaveCount(0)
    await mockLlm(page, [
      // 过程展示(2026-09-21):思考增量 + 工具调用都应在面板「过程」区可见
      { reasoning: '先确认选中内容的语境,读一下页面相关小节再答。', tool_calls: [{ name: 'read_page', arguments: { limit: 800 } }] },
      { text: 'RRF 是**倒数排名融合**:不看分数只看名次,score(d) = Σ 1/(k + rank_i(d)),`k` 常取 60。' },
    ])
    await page.click('.qa-trigger')
    await expect(page.locator('.qa-panel')).toBeVisible()
    await expect(page.locator('.qa-quote')).toContainText('RRF') // 引用预览 = 真实选区
    await page.fill('.qa-panel textarea', '这是啥')
    await page.click('.qa-ask')
    await expect(page.locator('.qa-answer')).toContainText('倒数排名融合') // stream 返回串直接进回答区
    // md 转样式:**粗体** → strong,不留 md 符号
    await expect(page.locator('.qa-answer strong')).toHaveText('倒数排名融合')
    await expect(page.locator('.qa-answer code')).toHaveText('k')
    await expect(page.locator('.qa-answer')).not.toContainText('**')
    // 过程区默认折叠(摘要行实时计数);点开后思考尾窗 + 工具行可见
    expect(await page.locator('.qa-trace').evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false)
    await expect(page.locator('.qa-trace-label')).toContainText('思考')
    await page.locator('.qa-trace summary').click()
    await expect(page.locator('.qa-reason')).toContainText('语境')
    await expect(page.locator('.qa-tool')).toContainText('read_page')
    await expect(page.locator('.qa-tool.done')).toHaveCount(1)
    // 记录:不经 agent,宿主自己收(右栏 +1,含选区溯源)
    await page.click('.qa-record')
    await expect(page.locator('#note-list li')).toHaveCount(1)
    await expect(page.locator('#note-list li').first()).toContainText('倒数排名融合')
    await expect(page.locator('#note-list li .qa-note-quote')).toContainText('RRF')
    // Esc 关闭;面板隐藏后右栏记录保留(宿主资产不随面板走)
    await page.keyboard.press('Escape')
    await expect(page.locator('.qa-panel')).toBeHidden()
    await expect(page.locator('#note-list li')).toHaveCount(1)
  })

  test('空问题不触发;未选中不浮钮', async ({ page }) => {
    await page.goto('/examples/quick-ask-demo/')
    await expect(page.locator('.qa-trigger')).toBeHidden() // 无选区 → 浮钮隐藏(元素常驻,hidden 态)
    // 点空白处(塌缩任意选区)后浮钮仍隐藏;面板从未打开
    await page.click('aside')
    await expect(page.locator('.qa-trigger')).toBeHidden()
    await expect(page.locator('.qa-panel')).toBeHidden()
  })

  test('docs-demo 同款入口:选中 → 快问 → 回答 → 记录落右下角清单', async ({ page }) => {
    await page.goto('/examples/docs-demo/')
    await page.waitForSelector('.docs-article')
    // 选中第 1 节一段(与主对话 SDK 划词菜单并存:快问是独立浮钮,不冲突)
    await page.evaluate(() => {
      const p = document.querySelector('.docs-article p')!
      const node = p.firstChild!
      const range = document.createRange()
      range.setStart(node, 0)
      range.setEnd(node, Math.min(60, node.textContent!.length))
      const sel = window.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
    })
    await expect(page.locator('.qa-trigger')).toBeVisible()
    await mockLlm(page, [{ text: '注意力机制:每个 token 发出 query,与所有 key 做点积得相关性,softmax 归一化后加权求和 value。' }])
    await page.click('.qa-trigger')
    await expect(page.locator('.qa-panel')).toBeVisible()
    await page.fill('.qa-panel textarea', '这段在讲什么')
    await page.click('.qa-ask')
    await expect(page.locator('.qa-answer')).toContainText('softmax')
    await page.click('.qa-record')
    await expect(page.locator('.qa-notes')).toBeVisible()
    await expect(page.locator('.qa-notes li')).toHaveCount(1)
  })
})
