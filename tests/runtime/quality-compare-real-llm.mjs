/**
 * 真 LLM 质量对比验收(output-quality-config Phase 3):同 prompt 跑新旧配置各 N 轮,量化质量 uplift。
 *
 * 对比轴(评审定稿):
 *   新配置 = 双范例 skill(page-tree/code-component)+ html 子 agent deepseek-v4-pro + thinkingMode deep
 *   旧配置 = 同一 URL 追加 &aiBaseline=1(editor dev-only 开关:范例双 skill 不注册 + 子 agent 降回继承 flash)
 *
 * 关键设计:
 *   - 每轮独立 browser context:indexedDB 隔离 → editor storage:'indexed' 不跨轮恢复,
 *     resumeNotice「数据可能已变」不干扰(评审:必须新会话隔离)
 *   - 一等指标(评审补):范例 load 率(debugLogs load_skill)/ 失败率回滚数(error 事件 +
 *     COMPONENT_BUSY/预检拒)/ 子 agent 委派成功率(use_html 数 vs 成功数)
 *   - 组件数/层级/占位文案:直接量 window.Editor.nodeInfo(不经 list_components,零额外轮次)
 *
 * 用法:
 *   node tests/runtime/quality-compare-real-llm.mjs [runsPerConfig=3]
 *   环境变量:QUALITY_PAGE_URL(编辑器页面 URL,须带 projectKey/pageKey 打开画布;
 *             默认 http://local.smzdm.com:8565/?projectKey=7eiwz9&pageKey=sz8g9s)
 *            REAL_LLM_OUT(报告路径,默认 _real-llm-quality-compare.json,gitignore)
 *   断点续跑:已完成的 (config, runNo) 从报告载入跳过。
 *
 * ⚠ 前置:①editor dev server 在跑且登录态有效(.local-cookie.json)②aiBaseline 开关已实现
 *   ③跑前确认目标页面可被污染(addComponent 走编辑器暂存链路,未点保存不发布,但暂存可能落服务端草稿)
 *   ④跑中禁并发 test:browser / 其他对 8565 的浏览器操作。
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { ROOT, sleep, attachPageDiagnostics, installEventHook, sendPrompt } from './_real-llm-lib.mjs'

const PROMPT = '设计一个世界杯专题页'
const CONFIGS = [
  { label: 'old(baseline)', param: 'aiBaseline=1' },
  { label: 'new(exemplar+pro)', param: '' }
]
const BASE_URL = process.env.QUALITY_PAGE_URL || 'http://local.smzdm.com:8565/?projectKey=7eiwz9&pageKey=sz8g9s'
const OUT = resolve(ROOT, process.env.REAL_LLM_OUT || '_real-llm-quality-compare.json')
const PLACEHOLDER_RE = /^(标题|文本|区块|模块|组件|轮播|图片|按钮|内容)\d*$|xxx|占位/i

/** 打开编辑器页面并等 AI 面板就绪(编辑器全量编译慢,等待放宽) */
async function openEditorPage(context, url) {
  // dev 布局含 AI 面板 dock tab(实测 design 默认布局不直接展示);fresh context 无 localStorage,init script 预置
  await context.addInitScript(() => { try { localStorage.setItem('dockLayout_type', 'dev') } catch (e) {} })
  const page = await context.newPage()
  attachPageDiagnostics(page)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.click('#tab-widgetAiAssistant', { timeout: 120_000 }).catch(() => {}) // 激活 AI 面板 tab(已激活则 no-op)
  await page.waitForSelector('.ai-assistant', { timeout: 180_000 })
  await page.waitForSelector('.chat-dialog .chat-input', { timeout: 60_000 })
  await page.waitForFunction(() => window.__sdk, { timeout: 30_000 })
  await sleep(3000) // 面板挂载后稳定窗口(MCP 握手等)
  return page
}

/**
 * idle 判定(比 lib 的 waitIdle 快且更可靠):
 * busy 读 send-btn 的 stop-btn class(绑定 SDK state.loading,整个生成期间恒 true,
 * 连子 agent reasoning 不打日志的静默期也覆盖);msgs 用 **sdk.messages 数据源计数**
 * (DOM 行计数在 editor 上不可靠:实测重启后 assistant 行恒 1,数据层正常 —— DOM 结构与
 * 面板状态耦合,数据数组才是事实源);idle = 不 busy + 新 assistant 消息出现 + 20s 稳定窗。
 * 兜底:活动子 agent > 0 视为 busy;页面 reload → 抛(会话已断);busy 停 + 日志静默 60s
 * 无新回复 = 错误收场轮,按结束处理(采到什么算什么,报告 errors 呈现)。
 */
async function waitEditorIdle(page, baselineMsgs, { timeoutMs = 1_200_000 } = {}) {
  const t0 = Date.now()
  let stable = 0
  let sawBusy = false
  while (Date.now() - t0 < timeoutMs) {
    // approval 挂起检测:方案选项(approval-opt)点第一个选项(模拟用户确认方案);
    // 无选项的删除/保存确认(approval-deny)拒绝(保持页面不被清空/保存,headless 无人值守防 busy 永挂)。计数入指标
    await page.evaluate(() => {
      const opt = document.querySelector('.chat-dialog .approval-opt')
      if (opt) { opt.click(); window.__qcConfirmed = (window.__qcConfirmed || 0) + 1; return }
      const deny = document.querySelector('.chat-dialog .approval-deny')
      if (deny) { deny.click(); window.__qcDenied = (window.__qcDenied || 0) + 1 }
    }).catch(() => {})
    const st = await page.evaluate((base) => {
      const sendBtn = document.querySelector('.chat-dialog button.send-btn')
      const busy = !!sendBtn && sendBtn.classList.contains('stop-btn')
      const msgs = (window.__sdk?.messages ?? []).filter((m) => m.role === 'assistant').length
      const logs = window.__sdk?.debugLogs?.value ?? []
      return {
        busy, msgs, base,
        active: window.__sdk?.getActiveSubagents?.().length ?? 0,
        logN: logs.length,
        quietMs: logs.length ? Date.now() - logs[logs.length - 1].timestamp : 0,
      }
    }, baselineMsgs).catch(() => null)
    if (!st) throw new Error('page evaluate 失败(页面崩溃/reload)')
    // debugLogs 清零(quietMs 为 epoch)→ reload,续跑无意义
    if (st.quietMs > 1e12) throw new Error('页面已 reload(debugLogs 清零),会话断,需重跑本轮')
    if (st.busy || st.active > 0) { sawBusy = true; stable = 0 } else stable += 1
    // idle = 见过 busy(prompt 确被处理)+ 连续 8 次采样(≈20s)不 busy + 日志静默 >60s。
    // 不再依赖消息计数:editor 场景 DOM 行计数与 sdk.messages 计数实测都不可靠
    // (DOM 行重启后恒 1;sdk.messages 与 UI 数组不同源,轮内不增)。busy/active/日志是三源独立信号,足够。
    if (sawBusy && stable >= 8 && st.quietMs > 60_000) return st
    if (Math.random() < 0.08) console.log('   [idle 采样]', JSON.stringify(st))
    await sleep(2500)
  }
  throw new Error(`等待 agent idle 超时(${Math.round(timeoutMs / 1000)}s)`)
}

/** 单轮:新 context → 发 prompt → idle → (方案征询自动应答续跑) → 采指标 */
async function runOnce(browser, url, config, runNo) {
  console.log(`\n===== [${config.label}] run ${runNo} =====`)
  const context = await browser.newContext()
  const page = await openEditorPage(context, url)
  try {
    const uninstall = await installEventHook(page)
    const t0 = Date.now()
    await sendPrompt(page, PROMPT)
    // 方案征询自动应答(首轮实测:agent 出方案征询确认即收尾,零写入;无人确认对比失效):
    // idle 后若末条 assistant 像在等确认 → 回「确认,直接执行」,最多 3 轮(防无限对话)
    for (let turn = 0; turn < 4; turn++) {
      // 基线仅用于诊断日志(采样里带出);idle 判定已不依赖计数
      const prevMsgs = await page.evaluate(() => (window.__sdk.messages ?? []).filter((m) => m.role === 'assistant').length)
      await waitEditorIdle(page, prevMsgs, { timeoutMs: 1_200_000 }) // 生成整页 5-15min,上限 20min
      if (turn === 3) break
      const lastContent = await page.evaluate(() => {
        const sdk = window.__sdk
        const last = sdk.messages.filter((m) => m.role === 'assistant').slice(-1)[0]
        return last?.content ?? ''
      })
      // 命中「等确认」特征 → 自动应答续跑;未命中(已收尾/汇报完成)→ 本轮结束
      if (!/(确认|是否|请选择|你的意见|您的意见|等您|等你|要不要|方案[AB]).{0,30}(？|\?|$)/m.test(lastContent) && !/请(你|您)?(确认|选择|确认后)/.test(lastContent)) break
      console.log('  [方案征询] 自动应答确认续跑(turn ' + (turn + 1) + ')')
      await sendPrompt(page, '确认,按你的方案直接开始执行,过程中不用再征询确认')
    }
    const data = await page.evaluate(() => {
      const sdk = window.__sdk
      // 页面树扁平化(直接量 nodeInfo,不经工具)
      const flat = []
      const walk = (n, d) => {
        if (!n || !n.type) return
        flat.push({ type: n.type, label: n.label || '', depth: d })
        ;(n.child || []).forEach((c) => walk(c, d + 1))
      }
      walk(window.Editor?.nodeInfo, 1)
      const logs = sdk.debugLogs.value || []
      const loadCalls = (window.__toolLog || []).filter((l) => l.kind === 'call' && l.name === 'load_skill').map((l) => l.args)
      const loadResults = logs.filter((l) => l.type === 'tool_result' && l.data?.name === 'load_skill')
        .map((l) => String(l.data.result ?? ''))
      const subs = sdk.inspect().subagent || {}
      const useHtmlCalls = (window.__toolLog || []).filter((l) => l.kind === 'call' && l.name?.startsWith('use_')).length
      return {
        usage: window.__usage,
        approvalsDenied: window.__qcDenied || 0,
        planConfirms: window.__qcConfirmed || 0,
        compCount: flat.length,
        maxDepth: flat.length ? Math.max(...flat.map((c) => c.depth)) : 0,
        labels: flat.map((c) => c.label).filter(Boolean),
        typeDiversity: new Set(flat.map((c) => c.type)).size,
        codeComponents: flat.filter((c) => /compCode/i.test(c.type)).length,
        loadSkillArgs: loadCalls,
        exemplarFulltext: loadResults.some((r) => r.includes('2712/compEmptyContent')),
        subagentHistory: (subs.history || []).map((h) => ({ label: h.label, kind: h.kind, status: h.status, thinkingApplied: h.thinkingApplied })),
        subagentSuccess: (subs.history || []).filter((h) => String(h.status).toLowerCase() === 'success' || h.ok === true).length,
        useHtmlCalls,
        reply: sdk.messages.filter((m) => m.role === 'assistant').slice(-1)[0]?.content?.slice(0, 1200) ?? '',
      }
    })
    await uninstall()
    const errors = await page.evaluate(() => (window.__toolLog || []).filter((l) => l.kind === 'error' || /COMPONENT_BUSY|BULK_CHANGE_REJECTED|预检/.test(l.result ?? '')).map((l) => (l.msg ?? l.result ?? '').slice(0, 150)))
    return {
      config: config.label, runNo, elapsedMs: Date.now() - t0,
      ...data,
      placeholderLabels: data.labels.filter((l) => PLACEHOLDER_RE.test(l)),
      errors: errors.slice(0, 6),
    }
  } finally {
    await context.close()
  }
}

/** 汇总对比(按配置聚合均值 + 新旧差值) */
function summarize(report) {
  const byConfig = {}
  for (const r of report.runs) {
    (byConfig[r.config] = byConfig[r.config] || []).push(r)
  }
  const avg = (arr, f) => (arr.length ? arr.reduce((s, x) => s + (f(x) || 0), 0) / arr.length : 0)
  const summary = {}
  for (const [label, runs] of Object.entries(byConfig)) {
    summary[label] = {
      runs: runs.length,
      avgCompCount: +avg(runs, (r) => r.compCount).toFixed(1),
      avgMaxDepth: +avg(runs, (r) => r.maxDepth).toFixed(1),
      avgTypeDiversity: +avg(runs, (r) => r.typeDiversity).toFixed(1),
      avgCodeComponents: +avg(runs, (r) => r.codeComponents).toFixed(1),
      placeholderTotal: runs.reduce((s, r) => s + r.placeholderLabels.length, 0),
      avgElapsedMin: +(avg(runs, (r) => r.elapsedMs) / 60000).toFixed(1),
      avgPromptTokens: Math.round(avg(runs, (r) => r.usage?.prompt)),
      avgCompletionTokens: Math.round(avg(runs, (r) => r.usage?.completion)),
      exemplarLoadRate: runs.filter((r) => r.loadSkillArgs?.some((a) => a.includes('exemplar'))).length + '/' + runs.length,
      exemplarFulltextRate: runs.filter((r) => r.exemplarFulltext).length + '/' + runs.length,
      subagentDelegation: runs.map((r) => `${r.useHtmlCalls}calls/${r.subagentSuccess}ok`).join(' '),
      errorTotal: runs.reduce((s, r) => s + r.errors.length, 0),
    }
  }
  report.summary = summary
  console.log('\n========== 新旧配置对比 ==========')
  console.log(`prompt:「${PROMPT}」`)
  for (const [label, s] of Object.entries(summary)) console.log(`${label}:`, JSON.stringify(s))
  const keys = ['old(baseline)', 'new(exemplar+pro)']
  if (summary[keys[0]] && summary[keys[1]]) {
    const [o, n] = keys.map((k) => summary[k])
    console.log(`\nΔ 组件数 ${n.avgCompCount - o.avgCompCount >= 0 ? '+' : ''}${(n.avgCompCount - o.avgCompCount).toFixed(1)} | Δ 层级 ${(n.avgMaxDepth - o.avgMaxDepth).toFixed(1)} | Δ 类型多样性 ${(n.avgTypeDiversity - o.avgTypeDiversity).toFixed(1)} | Δ 占位文案 ${n.placeholderTotal - o.placeholderTotal} | Δ 耗时 ${(n.avgElapsedMin - o.avgElapsedMin).toFixed(1)}min`)
  }
  console.log(`报告: ${OUT}`)
  return report
}

// ===== 入口 =====
const runsPerConfig = Number(process.argv[2]) || 3
let report = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { startedAt: new Date().toISOString(), prompt: PROMPT, runs: [] }
report.runs = report.runs || []
const done = new Set(report.runs.map((r) => `${r.config}#${r.runNo}`))

const browser = await chromium.launch()
try {
  for (const config of CONFIGS) {
    const url = config.param ? BASE_URL + (BASE_URL.includes('?') ? '&' : '?') + config.param : BASE_URL
    for (let i = 1; i <= runsPerConfig; i++) {
      if (done.has(`${config.label}#${i}`)) { console.log(`跳过已完成 [${config.label}] run ${i}`); continue }
      try {
        const run = await runOnce(browser, url, config, i)
        report.runs = report.runs.filter((r) => !(r.config === config.label && r.runNo === i))
        report.runs.push(run)
        writeFileSync(OUT, JSON.stringify(report, null, 2)) // 每轮落盘,断点续跑
        console.log(`  耗时 ${(run.elapsedMs / 60000).toFixed(1)}min | 组件 ${run.compCount} | 层级 ${run.maxDepth} | 类型 ${run.typeDiversity} | 占位 ${run.placeholderLabels.length} | token ${JSON.stringify(run.usage)}`)
        console.log('  委派:', run.useHtmlCalls, 'calls /', run.subagentSuccess, 'ok | 范例 load:', JSON.stringify(run.loadSkillArgs))
        if (run.placeholderLabels.length) console.log('  ⚠ 占位文案:', run.placeholderLabels.join(', '))
        if (run.errors.length) console.log('  ⚠ 异常:', run.errors.join(' | '))
        console.log('  回复:', run.reply.slice(0, 200).replace(/\n/g, ' '))
      } catch (e) {
        console.log(`  ✗ [${config.label}] run ${i} 失败:${String(e).slice(0, 300)}`)
        report.runs.push({ config: config.label, runNo: i, failed: String(e).slice(0, 500) })
        writeFileSync(OUT, JSON.stringify(report, null, 2))
      }
    }
  }
} finally {
  await browser.close()
}
report.finishedAt = new Date().toISOString()
writeFileSync(OUT, JSON.stringify(summarize(report), null, 2))
