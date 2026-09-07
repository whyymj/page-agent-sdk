// eval-toolkit:真 LLM 回归判定核导出面(2026-09-04;openspec/changes/2026-09-03-eval-toolkit)
// 双入口可达 + stub 会话 harness 行为 + diffReport 阈值判定(dist 产物路径)
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'
import { stubModel } from './_stub-model.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:eval-toolkit] 双入口导出可达(主包 + headless 子路径)')
  {
    const main = await import('../../dist/page-agent-sdk.js')
    assert(typeof main.createIdleDetector === 'function' && typeof main.createEvalHarness === 'function' && typeof main.diffReport === 'function',
      '✓ 主入口导出 createIdleDetector/createEvalHarness/diffReport')
    const headless = await import('../../dist/page-agent-sdk.headless.js')
    assert(typeof headless.createIdleDetector === 'function' && typeof headless.createEvalHarness === 'function' && typeof headless.diffReport === 'function',
      '✓ headless 子路径同带(纯函数零浏览器依赖,D1 主包导出留痕)')
  }

  console.log('[e2e:eval-toolkit] harness:stub 会话 waitForIdle + collectReport')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-eval-harness', storage: false,
      llm: stubModel({ toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: '新' } } }] }, { text: '完成' }),
      data: { schema: z.object({ title: z.string() }), bind: { title: '旧' }, description: 'd' },
      capabilities: MIN_CAPS,
    })
    await sdk.mount()
    const { createEvalHarness } = await import('../../dist/page-agent-sdk.js')
    const h = createEvalHarness({ sdk })
    await sdk.send('改标题')
    // stub 会话已收口(send 返回 = idle 已过);waitForIdle 快参数立即过终态判定
    const st = await h.waitForIdle({ quietMs: 1, confirmSamples: 1, sampleMs: 5, timeoutMs: 5_000 })
    assert(st.messageCount >= 2 && st.activeSubagents === 0, '✓ waitForIdle 终态采样(消息≥2/无在飞子)')
    const report = h.collectReport()
    assert(report.toolCount >= 1 && report.usage.completion >= 0 && typeof report.at === 'string',
      `✓ collectReport 结构(toolCount=${report.toolCount}/usage/at ISO)`)
    sdk.unmount()
  }

  console.log('[e2e:eval-toolkit] diffReport 阈值判定(dist 路径)')
  {
    const { diffReport } = await import('../../dist/page-agent-sdk.js')
    const worse = diffReport({ prompt: 15_000, toolCount: 10 }, { prompt: 10_000, toolCount: 8 })
    assert(worse.status === 'worse' && worse.regressions === 1, '✓ prompt +50%/+5000 双阈超 → worse(toolCount +2 阈内不标)')
    const ok = diffReport({ prompt: 11_000, toolCount: 8 }, { prompt: 10_000, toolCount: 8 })
    assert(ok.status === 'ok', '✓ 阈内波动 → ok(防方差误报口径)')
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
