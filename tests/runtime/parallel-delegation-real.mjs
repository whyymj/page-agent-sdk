/**
 * 真 LLM 复验:同轮并行委派是否实际发生(P3d,第二批组件锁的前置证据)
 *
 * 场景(complex-demo,已配 maxParallelTools:3 + 并行引导 prompt):
 *   一条消息要求新增两个纯代码组件 → 主 agent 是否**同一轮**发出两个 use_html 委派,
 *   两个子 agent 是否**真并发**执行(时间窗重叠),以及失败隔离是否完好。
 *
 * 判定指标:
 *   R1 委派 ≥2 次 use_html
 *   R2 同轮并行:debugLogs 中同一 round 出现 ≥2 条 use_html tool_result(一轮多 tool_calls)
 *   R3 真并发:两个子 agent 执行时间窗重叠(采样 maxActiveSubagents ≥2 或 sub 事件区间重叠)
 *   R4 两个 custom 组件均落地(code >300)
 *   R5 同轮混排:主 agent 的 write(普通组件)与委派同轮或穿插(不阻塞等待)
 *
 * 公共基建在 _real-llm-lib.mjs;统一入口 `npm run test:real parallel`。
 * 用法:node tests/runtime/parallel-delegation-real.mjs   # 输出 _real-llm-parallel.json(gitignore)
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  ROOT, resolveRunEnv, hasEnvKey, skipSuite, launchBrowser, openDemoPage, installEventHook, sendPrompt, waitIdle,
} from './_real-llm-lib.mjs'

/** 套件入口(统一入口 real-llm.mjs 编排;也可直接 node 本文件) */
export async function runSuite() {
  if (!hasEnvKey(/^VITE_AI_API_KEY=.+/m)) return skipSuite('.env 缺 VITE_AI_API_KEY(parallel 套件)')
  const { BASE } = resolveRunEnv({ outDefault: '_real-llm-parallel.json' })
  const OUT = resolve(ROOT, process.env.REAL_LLM_OUT || '_real-llm-parallel.json')

  const PROMPT = '再加两个纯代码组件:① 幸运抽奖转盘(8 格奖品格,点击按钮可旋转动画)② 会员权益卡片(3 项权益,图标+文字列表)。都按平台 UI 规范做。另外把页面主标题改成「会员狂欢季」。'

  const browser = await launchBrowser()
  const page = await openDemoPage(browser, `${BASE}/examples/complex-demo/`)

  // 事件捕获带时间戳(判定并发区间);maxActive 经 waitIdle 采样回调累计
  await installEventHook(page)
  let maxActive = 0
  const prevMsgs = await page.evaluate(() => window.__sdk.messages.length)
  const t0 = Date.now()
  console.log(`\n❯ ${PROMPT}`)
  await sendPrompt(page, PROMPT)
  await waitIdle(page, prevMsgs, { timeoutMs: 1800_000, onSample: (st) => { if (st.active > maxActive) maxActive = st.active } })

  const data = await page.evaluate(() => {
    const logs = window.__sdk.debugLogs.value
    // 同轮并行:tool_result 按 round 分组数 use_html
    const useHtmlByRound = {}
    const allToolsByRound = {}
    for (const l of logs) {
      if (l.type === 'tool_result' && l.data?.round != null) {
        const r = l.data.round
        allToolsByRound[r] = allToolsByRound[r] || []
        allToolsByRound[r].push(l.data.name)
        if (l.data.name === 'use_html') useHtmlByRound[r] = (useHtmlByRound[r] || 0) + 1
      }
    }
    return {
      events: window.__toolLog,
      useHtmlByRound, allToolsByRound,
      rounds: Object.keys(allToolsByRound).length,
      history: window.__sdk.inspect().subagent.history.map((h) => ({ label: h.label, task: String(h.task ?? '').slice(0, 120), status: h.status, durationMs: h.durationMs, startedAt: h.startedAt })),
      components: window.page.components.map((c) => ({ type: c.type, name: c.props?.name ?? c.name, codeLen: (c.code ?? '').length })),
      title: window.page.title,
      reply: window.__sdk.messages.at(-1)?.content?.slice(0, 400) ?? '',
      usage: window.__usage,
    }
  })
  await page.evaluate(() => { window.__unsub?.(); window.__unsub = null })

  // ── 判定 ──
  const useHtmlCalls = data.events.filter((e) => e.kind === 'call' && e.name === 'use_html')
  const parallelRounds = Object.entries(data.useHtmlByRound).filter(([, n]) => n >= 2)
  // 并发区间重叠:子 agent label 各自的首末 sub 事件时间窗
  const spans = {}
  for (const e of data.events.filter((x) => x.kind === 'sub')) {
    spans[e.sub?.split(':')[0] ?? e.name] = spans[e.sub?.split(':')[0] ?? e.name] || { start: e.t, end: e.t }
    spans[e.sub?.split(':')[0] ?? e.name].end = e.t
  }
  const labels = Object.keys(spans)
  let overlap = false, overlapPair = ''
  for (let i = 0; i < labels.length && !overlap; i++) for (let j = i + 1; j < labels.length; j++) {
    const a = spans[labels[i]], b = spans[labels[j]]
    if (a.start < b.end && b.start < a.end) { overlap = true; overlapPair = `${labels[i]} × ${labels[j]}` }
  }
  const customCount = data.components.filter((c) => c.type === 'custom' && c.codeLen > 300).length
  const mainWriteNearDelegation = (() => {
    // 同轮混排:某 round 里 use_html 与 write 共存,或 write 在两个委派 start 之间
    for (const [, names] of Object.entries(data.allToolsByRound)) if (names.includes('use_html') && names.some((n) => /write|edit|set/.test(n))) return true
    return false
  })()

  const checks = {
    'R1 委派 ≥2 次 use_html': useHtmlCalls.length >= 2,
    'R2 同轮并行(一轮 ≥2 个 use_html tool_result)': parallelRounds.length >= 1,
    'R3 真并发(子 agent 时间窗重叠)': overlap || maxActive >= 2,
    'R4 两个 custom 组件落地': customCount >= 2,
    'R5 主 agent write 与委派同轮/穿插': mainWriteNearDelegation,
    'R6 标题改写成功': data.title.includes('会员狂欢季'),
    'R7 零致命错误': !data.events.some((e) => e.kind === 'error' && /fatal/i.test(e.msg ?? '')),
  }
  const report = {
    ranAt: new Date().toISOString(), prompt: PROMPT, elapsedMs: Date.now() - t0, maxActiveSubagents: maxActive,
    toolCount: useHtmlCalls.length + Object.values(data.allToolsByRound).flat().filter((n) => n !== 'use_html').length,
    usage: data.usage,
    useHtmlCalls: useHtmlCalls.map((c) => c.args), parallelRounds, overlapPair,
    roundsTotal: data.rounds, toolSeqByRound: data.allToolsByRound,
    subagentHistory: data.history, subSpans: spans,
    components: data.components, title: data.title, reply: data.reply, checks,
  }
  writeFileSync(OUT, JSON.stringify(report, null, 2))
  console.log(`\n耗时 ${(report.elapsedMs / 1000).toFixed(0)}s | maxActiveSubagents=${maxActive} | rounds=${data.rounds}`)
  console.log('use_html 委派:', useHtmlCalls.map((c) => (c.args ?? '').slice(0, 120)).join(' | '))
  console.log('同轮 use_html 分布:', JSON.stringify(data.useHtmlByRound))
  console.log('子 agent 历史时长:', data.history.map((h) => `${h.label}:${h.durationMs}ms`).join(', '))
  if (overlap) console.log('并发区间重叠对:', overlapPair)
  for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? '✓' : '✗'} ${k}`)
  console.log(`报告: ${OUT}`)
  await browser.close()
  const failed = Object.values(checks).filter((v) => !v).length
  return { suite: 'parallel', report, OUT, total: Object.keys(checks).length, failed }
}

// 直接运行本文件时自执行(统一入口 real-llm.mjs import 时不触发);失败退出码 1(单场景套件保持原语义)
const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirect) {
  const r = await runSuite()
  if (r && !r.skipped && r.failed > 0) process.exit(1)
}
