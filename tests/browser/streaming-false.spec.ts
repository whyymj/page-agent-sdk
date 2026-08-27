import { test, expect } from '@playwright/test'
import { mockLlm, fillInput, clickSend, clearChat } from './_helpers'

/**
 * streaming:false 路径浏览器 E2E(team-audit P2#9)
 *
 * 修前:mountChatDialog 的 fetchResponse 直调 core.agent.invoke,绕过 core.stream 包装的
 * trackActive/串行闸/protectedRefs/abortConflict —— unmount 的 abortAllActive 注册表无此流
 * (幽灵流继续跑继续写)、编程式 switchSession 后旧流收口 push 进新会话 messages(跨会话孤儿写)。
 * 修后:fetchResponse 改走 core.stream(msgs, () => {}, signal),与流式路径同一管线。
 * 载体:page-demo 加 ?streaming=0 查询参数钩子(该路径全 demo 此前零覆盖)。
 */
test.describe('streaming:false 路径(P2#9 改走 core.stream 包装)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?streaming=0')
    await page.waitForSelector('.chat-dialog')
    await clearChat(page)
  })

  test('功能零回归:非流式单轮 write + 文本收口(core.stream 聚合返回与 fetchResponse 契约等价)', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { value: '非流式标题', patch: { op: 'set', jsonPath: 'title' } } }] },
      { text: '已完成。' },
    ])
    await fillInput(page, '改标题')
    await clickSend(page)
    // write 落地 + 助手回复上屏(非流式路径收口正常)
    await page.waitForFunction(() => (window as any).page.title === '非流式标题')
    const dialogText = await page.textContent('.chat-dialog')
    expect(dialogText).toContain('已完成')
  })

  test('unmount 中止在途流:非流式生成中卸载 → 零幽灵写入(修前:abortAllActive 注册表无此流照跑照写)', async ({ page }) => {
    // 首个模型响应延迟 1.2s(生成在途窗口);脚本含 write,修前幽灵流收口后会真写 bind
    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { value: '幽灵写入', patch: { op: 'set', jsonPath: 'title' } } }] },
      { text: '幽灵回复' },
    ], [1200, 0])
    await fillInput(page, '改标题')
    await clickSend(page)
    await page.waitForTimeout(300) // 流已启动(首个模型响应延迟中)
    await page.evaluate(() => (window as any).__sdk.unmount())
    await page.waitForTimeout(2000) // 越过延迟窗口 + 收口时间
    expect(await page.evaluate(() => (window as any).page.title)).not.toBe('幽灵写入')
  })

  test('在途流 + 编程式 switchSession → 旧回复不进新会话(修前:孤儿 push 进新会话 messages)', async ({ page }) => {
    await mockLlm(page, [
      { tool_calls: [{ name: 'write', arguments: { value: '孤儿写入', patch: { op: 'set', jsonPath: 'title' } } }] },
      { text: '孤儿回复' },
    ], [1200, 0])
    await fillInput(page, '改标题')
    await clickSend(page)
    await page.waitForTimeout(300)
    await page.evaluate(async () => { await (window as any).__sdk.switchSession() })
    await page.waitForTimeout(2000) // 越过延迟窗口:旧流若未被 abort 会收口并 push
    // 实质契约:新会话无旧流**内容**(正文回复/用户消息不孤儿写入)。
    // 注:abort 保留 partial 的既有 UI 形态会在新会话留一条空 content 的 assistant 占位
    // (streaming:true 中止同款,非本项范围);修前红形态 = 完整回复 + write 落地
    const substantive = await page.evaluate(() => (window as any).__sdk.messages.filter((m: any) => m.content).length)
    expect(substantive).toBe(0)
    expect(await page.evaluate(() => (window as any).page.title)).not.toBe('孤儿写入')
  })
})
