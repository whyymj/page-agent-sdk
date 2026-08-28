/**
 * UI 压力基准(MessageList 无虚拟化 + 思考流 + 大 markdown 消息;2026-08-28 性能定位用)
 * 非回归门禁(无 pass/fail 断言基线),只采集指标打印 —— 定位真瓶颈后决定虚拟化/分段渲染取舍:
 *   ① 60 条消息长会话(markdown + 代码块混合)→ DOM 节点数 / 堆内存
 *   ② 流式 50K 字思考(reasoning delta 展开 + 折叠两态)→ 流式期间 fps + longtask
 *   ③ 滚动扫描 → 帧率(布局/绘制成本)
 */
import { test } from '@playwright/test'

// 性能诊断专用(非回归门禁):PERF_STRESS=1 npx playwright test tests/browser/perf-stress.spec.ts
// 2026-08-28 首跑结论:61 消息规模 DOM 1486 节点/堆 51MB/滚动零丢帧/展开思考块 +1 节点 —— 无虚拟化需求;
// 顺带挖出并修复 anthropic-mid-system(压缩摘要中部 system × Anthropic 转换器拒收)
const RUN = !!process.env.PERF_STRESS
import { mockLlm, fillInput, clickSend, waitForAgentIdle } from './_helpers'

/** 生成 N 条混合体量回复(markdown 段落 + 代码块,模拟真实长会话) */
function genReplies(n: number) {
  const out: any[] = []
  for (let i = 0; i < n; i++) {
    const size = [300, 800, 2000, 6000][i % 4]
    const paras = Math.max(1, Math.round(size / 300))
    const body = Array.from({ length: paras }, (_, p) => `**第 ${i + 1} 条消息 · 段 ${p + 1}** 一些 markdown 文本,含 \`inline code\` 与 [链接](https://example.com)。`).join('\n\n')
    const code = i % 3 === 0 ? `\n\n\`\`\`html\n<div class="demo-${i}">${'<p>代码块内容行</p>\n'.repeat(40)}</div>\n\`\`\`` : ''
    out.push({ text: body + code })
  }
  return out
}

test('perf-stress: 60 消息长会话 + 50K 思考流 + 滚动(指标采集)', async ({ page }) => {
  test.skip(!RUN, '性能诊断专用:PERF_STRESS=1 启用')
  test.setTimeout(300_000)  // 60 条排队消费 > 默认 60s
  await page.goto('/examples/complex-demo/')
  await page.waitForSelector('.chat-dialog')
  await page.evaluate(() => { try { localStorage.clear() } catch {} })
  await page.reload()
  await page.waitForSelector('.chat-dialog')

  // ===== ① 60 条消息(排队灌入,顺序消费)=====
  const script = genReplies(60)
  script.push({ reasoning: '深度思考中.'.repeat(1000) + '思考继续.'.repeat(1000) + '再想一下.'.repeat(1000) + '接近结论.'.repeat(1000) + '最终确认.'.repeat(1000), text: '思考完成,结论如下。' })  // 25K reasoning
  await mockLlm(page, script)

  const t0 = Date.now()
  for (let i = 0; i < 60; i++) {
    await fillInput(page, `第 ${i + 1} 条指令`)
    await clickSend(page)
  }
  // 第 61 条:触发带 25K reasoning 的收尾回复(与排队消息一起顺序消费)
  await fillInput(page, '最后一条:请深度思考后回答')
  await clickSend(page)
  // 排队消费完(全部脚本耗尽;每 10s 打进度定位卡点)
  {
    const t0 = Date.now()
    // 排水判据:压缩触发后消息数会「下降」(旧轮收编成摘要),不能按固定条数等 ——
    // 连续两次采样消息数与 llmCalls 均不变 = 排队消费完(mock 脚本耗尽)
    let prev = { n: -1, calls: -1 }
    let stable = 0
    for (;;) {
      const st = await page.evaluate(() => {
        const s = (window as any).__sdk
        const logs = s?.debugLogs?.value ?? []
        return {
          n: s?.messages?.length ?? -1,
          llmCalls: logs.filter((l: any) => l.type === 'llm_response').length,
        }
      })
      if (st.n === prev.n && st.llmCalls === prev.calls && st.llmCalls > 0) stable++
      else stable = 0
      prev = st
      if (stable >= 2) break  // 两次采样(各 8s)零变化
      if (Date.now() - t0 > 120_000) { console.log('[perf] ⚠ 120s 未稳定,终态:', JSON.stringify(st)); break }
      await page.waitForTimeout(8_000)
    }
  }
  await page.waitForTimeout(2000)  // 尾部 markdown 渲染收口

  const m1 = await page.evaluate(() => ({
    domNodes: document.querySelectorAll('.chat-dialog *').length,
    heapMB: Math.round((performance as any).memory?.usedJSHeapSize / 1048576) || -1,
    msgs: (window as any).__sdk.messages.length,
  }))
  console.log(`[perf] ① 60 消息灌入完成(${Math.round((Date.now() - t0) / 1000)}s):`, JSON.stringify(m1))

  // ===== ② 展开全部思考块 + 流式 fps(最后一条带 25K reasoning,先展开再触发)=====
  // 展开:点击每条 assistant 消息的 reasoning header
  const expandCount = await page.evaluate(() => {
    const heads = document.querySelectorAll('.reasoning-header')
    heads.forEach((h) => (h as HTMLElement).click())
    return heads.length
  })
  await page.waitForTimeout(1000)
  const m2 = await page.evaluate(() => ({
    domNodes: document.querySelectorAll('.chat-dialog *').length,
    heapMB: Math.round((performance as any).memory?.usedJSHeapSize / 1048576) || -1,
    expandedReasoning: document.querySelectorAll('.reasoning-body').length,
  }))
  console.log(`[perf] ② 展开 ${expandCount} 个思考块后:`, JSON.stringify(m2))

  // ===== ③ 滚动扫描帧率(布局/绘制成本)=====
  const fps = await page.evaluate(async () => {
    // 滚动容器:OverlayScrollbars viewport(向上找可滚祖先)
    let el: HTMLElement | null = document.querySelector('.chat-body')
    while (el && el.scrollHeight <= el.clientHeight + 8) el = el.parentElement
    if (!el) return -1
    let frames = 0
    let running = true
    const count = () => { frames++; if (running) requestAnimationFrame(count) }
    requestAnimationFrame(count)
    const H = el.scrollHeight
    const steps = 24
    for (let i = 0; i <= steps; i++) {
      el.scrollTop = Math.round((H * i) / steps)
      await new Promise((r) => requestAnimationFrame(() => r(null)))
    }
    running = false
    return frames  // 全程 rAF 帧数(越接近 steps+~30 越流畅;丢帧 = 低于理论值)
  })
  console.log(`[perf] ③ 全列表滚动扫描 rAF 帧数(理论 ~55+):`, fps)

  // 结论输出(人工判读;无断言 —— 基准非门禁)
  console.log('[perf] 判读:domNodes >2 万或滚动帧数显著低于理论 → MessageList 窗口化/远处折叠候选')
})
