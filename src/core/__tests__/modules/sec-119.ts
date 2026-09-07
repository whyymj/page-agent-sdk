/**
 * sec-119:eval-toolkit 判定核(2026-09-04;openspec/changes/2026-09-03-eval-toolkit)
 * - createIdleDetector 状态机:双条件 + 连续确认 / reset(日志清空)/ streak 重置 / 自定义阈值
 * - diffReport:token 双阈值(±15% 且 ±2000)与 toolCount ±3 三态判定 + 边界(恰好阈值不标)/ elapsedSec 不判 / prev=0
 * - createEvalHarness:waitForIdle 真轮询(假 sdk 快参数)/ collectReport 结构(usage/toolCount/messageCount)
 */
import { ref } from 'vue'
import { createIdleDetector, createEvalHarness, diffReport } from '../../sdk/evalToolkit'
import type { DebugLog } from '../../harness/createAgent'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx

  console.log('\n[eval-toolkit · createIdleDetector 状态机]')
  const s = (over: Partial<Parameters<ReturnType<typeof createIdleDetector>['push']>[0]> = {}) => ({
    messageCount: 2, quietMs: 100_000, hasResponse: true, activeSubagents: 0, logCount: 5, ...over,
  })
  // 双条件全满足 × 连续 3 次才 done
  const d1 = createIdleDetector({ quietMs: 90_000, confirmSamples: 3 })
  assert(d1.push(s()) === 'pending', '✓ 第 1 次满足 → pending(连续确认未满)')
  assert(d1.push(s()) === 'pending', '✓ 第 2 次满足 → pending')
  assert(d1.push(s()) === 'done', '✓ 第 3 次连续满足 → done')
  // 中断重置 streak
  const d2 = createIdleDetector({ confirmSamples: 3 })
  d2.push(s()); d2.push(s())
  assert(d2.push(s({ activeSubagents: 1 })) === 'pending', '✓ 子 agent 在飞 → 不满足(思考/委派中不算 idle)')
  assert(d2.push(s()) === 'pending', '✓ 中断后 streak 重置(第 4 次又从 1 计)')
  assert(d2.push(s()) === 'pending' && d2.push(s()) === 'done', '✓ 重置后再连续 3 次才 done')
  // 条件面逐项:无响应 / 无新消息 / 静默不足
  const d3 = createIdleDetector({ quietMs: 90_000 })
  assert(d3.push(s({ hasResponse: false })) === 'pending', '✓ 无模型响应 → 不满足(防把发送中误判完成)')
  assert(d3.push(s({ messageCount: 0 })) === 'pending', '✓ 零消息 → 不满足')
  assert(d3.push(s({ quietMs: 90_000 })) === 'pending', '✓ 静默恰好等于阈值 → 不满足(须严格大于)')
  // reset:日志清空(quietMs epoch 级)
  assert(d3.push(s({ quietMs: 1.8e12 })) === 'reset', '✓ 日志清空信号(quietMs>1e12)→ reset(会话切换/页面 reload)')
  // baselineMessageCount:有消息但不超过基线
  const d4 = createIdleDetector({ baselineMessageCount: 5, confirmSamples: 1 })
  assert(d4.push(s({ messageCount: 5 })) === 'pending', '✓ 消息数等于基线 → 不满足(须有新消息)')
  assert(d4.push(s({ messageCount: 6 })) === 'done', '✓ 消息数超过基线 + confirmSamples=1 → done')

  console.log('\n[eval-toolkit · diffReport 阈值判定]')
  // 持平
  const ok = diffReport({ prompt: 10_000, completion: 2000, toolCount: 8, elapsedSec: 60 }, { prompt: 10_000, completion: 2000, toolCount: 8, elapsedSec: 90 })
  assert(ok.status === 'ok' && ok.regressions === 0, '✓ 全持平 → ok(token/toolCount 均阈内)')
  assert(ok.fields.find((f) => f.key === 'elapsedSec')?.flag === '', '✓ elapsedSec 不参与判定(仅展示;60→90 不标)')

  // token 疑似回归:双阈值同时超过(+30% 且 +3000)
  const worse = diffReport({ prompt: 13_000 }, { prompt: 10_000 })
  assert(worse.status === 'worse' && worse.regressions === 1 && worse.fields[0].flag === 'up', '✓ prompt +30%/+3000(双阈同超)→ ▲ worse')

  // 单阈值不标:百分比超但绝对量小(+16% 且 +200,abs 不足)
  const absFail = diffReport({ prompt: 1_200 }, { prompt: 1_000 })
  assert(absFail.status === 'ok', '✓ +20% 但 +200 < 2000 → 不标(双阈须同时超,防小基数误报)')
  // 绝对量超但百分比小(+3000 且 +3%)
  const pctFail = diffReport({ prompt: 103_000 }, { prompt: 100_000 })
  assert(pctFail.status === 'ok', '✓ +3000 但 +3% < 15% → 不标(大基数方差保护)')

  // 边界恰好:token +2000.0001 才超;用 +2001 & +15.01%? 构造:prev 10_000,cur 12_001(+20.01%,+2001)
  const edge = diffReport({ prompt: 12_001 }, { prompt: 10_000 })
  assert(edge.status === 'worse', '✓ +2001/+20%(恰好越双阈)→ ▲')
  const edgeNo = diffReport({ prompt: 12_000 }, { prompt: 10_000 })
  assert(edgeNo.status === 'ok', '✓ 恰好 +2000(等于阈值不越)→ 不标(严格大于)')

  // toolCount ±3:超过标、恰好 3 不标、减少标 ▼
  const tc = diffReport({ toolCount: 12 }, { toolCount: 8 })
  assert(tc.fields[0].flag === 'up' && tc.status === 'worse', '✓ toolCount +4 > 3 → ▲')
  const tcEdge = diffReport({ toolCount: 11 }, { toolCount: 8 })
  assert(tcEdge.status === 'ok', '✓ toolCount 恰好 +3 → 不标(严格大于)')
  const tcDown = diffReport({ toolCount: 2 }, { toolCount: 8 })
  assert(tcDown.status === 'better' && tcDown.fields[0].flag === 'down' && tcDown.regressions === 0, '✓ toolCount -6 → ▼ better(regressions 不计)')

  // 缺基线字段(prev=0 → pct=0,token 不标;toolCount 0→n 超阈标)
  const fresh = diffReport({ prompt: 5_000, toolCount: 0 }, null)
  assert(fresh.status === 'ok', '✓ 基线缺失(null)→ 全字段按 prev=0,token 双阈不标(pct=0)')
  const freshTool = diffReport({ toolCount: 5 }, { toolCount: 0 })
  assert(freshTool.fields[0].flag === 'up', '✓ toolCount 0→5(>3)→ ▲(新面工具数暴增可见)')

  console.log('\n[eval-toolkit · createEvalHarness(假 sdk 真轮询)]')
  const logs = ref<DebugLog[]>([
    { timestamp: Date.now() - 200, type: 'llm_request', data: {} },
    { timestamp: Date.now() - 100, type: 'llm_response', data: {} },
    { timestamp: Date.now() - 5, type: 'tool_result', data: { name: 'write' } },
  ] as DebugLog[])
  const fakeSdk = {
    messages: [{ role: 'user' }, { role: 'assistant' }],
    debugLogs: logs,
    usage: { prompt: 1234, completion: 567, cacheRead: 89 },
    inspect: () => ({ subagent: { active: [] } }),
  }
  const harness = createEvalHarness({ sdk: fakeSdk as never })
  // 快参数:quietMs 100ms + sampleMs 10ms + confirmSamples 1(真轮询路径,不Mock定时器)
  const st = await harness.waitForIdle({ quietMs: 100, confirmSamples: 1, sampleMs: 10, timeoutMs: 5_000 })
  assert(st.messageCount === 2 && st.activeSubagents === 0, '✓ waitForIdle 采到终态(messageCount/activeSubagents)')
  const report = harness.collectReport()
  assert(report.toolCount === 1 && report.messageCount === 2, '✓ collectReport:toolCount 数 debugLogs tool_result(1)+ 消息数(2)')
  assert(report.usage.prompt === 1234 && report.usage.completion === 567 && report.usage.cacheRead === 89, '✓ collectReport:usage 透传(含 cacheRead)')
  assert(typeof report.at === 'string' && !Number.isNaN(Date.parse(report.at)), '✓ collectReport:at 为合法 ISO 时间戳')

  // reset 路径:waitForIdle 期间日志清空 → 抛错(不悬挂)
  logs.value = []
  let resetErr = ''
  try { await harness.waitForIdle({ quietMs: 1, confirmSamples: 1, sampleMs: 5, timeoutMs: 2_000 }) } catch (e) { resetErr = String((e as Error).message) }
  assert(resetErr.includes('清空'), '✓ waitForIdle 日志被清空 → 抛「清空」错误快速失败(不悬挂)')

  console.log('  sec-119 完成:判定核 29 项断言全过')
}
