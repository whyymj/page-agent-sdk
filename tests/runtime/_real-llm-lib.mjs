/**
 * 真 LLM 回归共享库(real-llm-framework):三套浏览器路径脚本(uispec/rag/parallel)的公共基础设施。
 *
 * 抽自各脚本的同款拷贝(修前四份 waitIdle/hook 安装/报告落盘互相漂移):
 *  - `resolveRunEnv` / `hasEnvKey` / `skipSuite`:运行环境解析 + .env key 缺失 skip
 *  - `attachPageDiagnostics` / `openDemoPage`:console/framenavigated/pageerror 诊断 + demo 页打开
 *  - `installEventHook` / `sendPrompt` / `waitIdle`:事件捕获(__toolLog/__usage)+ 发送 + idle 双条件判定
 *  - `loadReport` / `runScenario` / `summarize`:断点续跑报告 + 场景骨架 + 汇总
 *  - `metricsOf` / `loadBaseline` / `saveBaseline` / `diffBaseline`:硬指标基线对比(prompt/completion token、工具数)
 *
 * 方法论(idle 双条件 / 跑前重启 dev server / 断点续跑)见 doc/real-llm-regression.md。
 * 注:tests/runtime/*-real-llm.ts(draft/trace/maliang,headless 直连 dist)形态不同,不经本库。
 */
import { chromium } from 'playwright'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 解析运行环境:BASE(默认 http://localhost:3000)+ OUT(报告路径,resolve 到仓库根) */
export function resolveRunEnv({ baseEnv = 'REAL_LLM_BASE', outDefault }) {
  return {
    BASE: process.env[baseEnv] || process.env.UISPEC_BASE || 'http://localhost:3000',
    OUT: resolve(ROOT, process.env.REAL_LLM_OUT || outDefault),
  }
}

/** .env 是否含指定 key(正则;凭据只在 .env,脚本不接触明文)。无 key → 套件返回 {skipped} 而非 exit(编排模式不拖累其他套件) */
export function hasEnvKey(re) {
  if (!existsSync(resolve(ROOT, '.env'))) return false
  return re.test(readFileSync(resolve(ROOT, '.env'), 'utf8'))
}

/** skip 套件的统一打印(mock 回归请用 npm run test:browser) */
export function skipSuite(msg) {
  console.log(`⚠ skip:${msg}(真 LLM 回归需要真 key;mock 回归请用 npm run test:browser)`)
  return { skipped: true }
}

/** 断点续跑报告:存在则载入并按 only 过滤掉将重跑的场景 */
export function loadReport(OUT, only = []) {
  const report = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { startedAt: new Date().toISOString(), scenarios: [] }
  report.scenarios = report.scenarios.filter((s) => !only.length || only.includes(s.no))
  return report
}

/** 页面诊断监听:vite reload/re-optimiz 警示 + framenavigated + pageerror(曾据此定位 HMR 掉线/页面崩溃) */
export function attachPageDiagnostics(page) {
  page.on('console', (m) => {
    const t = m.text()
    if (t.includes('transitional_retry') || t.includes('format_retry')) console.log('  [自纠]', t.slice(0, 140))
    if (/reload|re-optimiz|optimized|full reload|vite/i.test(t)) console.log('  [vite]', t.slice(0, 200))
  })
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log(`  [reload] framenavigated → ${f.url()}`) })
  page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`))
}

/** 打开 demo 页并等就绪(对话框挂载 + __sdk 采样口出现 + 稳定窗口) */
export async function openDemoPage(browser, url) {
  const page = await browser.newPage()
  attachPageDiagnostics(page)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.chat-dialog')
  await page.waitForFunction(() => window.__sdk, { timeout: 30_000 })
  await sleep(2000)
  return page
}

export function launchBrowser() { return chromium.launch() }

/**
 * 安装事件捕获 hook(window.__toolLog + __usage;返回反安装 fn)。
 * 记录 tool_call/tool_result/subagent/usage/error 五类;usage 按 prompt/completion 累计。
 */
export async function installEventHook(page) {
  await page.evaluate(() => {
    window.__toolLog = []
    window.__usage = null
    window.__unsub = window.__sdk.hook((e) => {
      if (e.type === 'tool_call') window.__toolLog.push({ t: Date.now(), kind: 'call', name: e.name, args: JSON.stringify(e.args).slice(0, 300) })
      if (e.type === 'tool_result') window.__toolLog.push({ t: Date.now(), kind: 'result', name: e.name, result: String(e.result ?? '').slice(0, 500) })
      if (e.type === 'subagent') window.__toolLog.push({ t: Date.now(), kind: 'sub', name: e.name, sub: `${e.label}:${e.kind}` })
      if (e.type === 'usage') {
        window.__usage = window.__usage || { prompt: 0, completion: 0 }
        window.__usage.prompt += e.usage.prompt_tokens ?? 0
        window.__usage.completion += e.usage.completion_tokens ?? 0
        // prompt caching(llm.cacheControl 效果观测):Anthropic cache_read/creation 累计
        if (e.usage.cache_read_input_tokens) window.__usage.cacheRead = (window.__usage.cacheRead ?? 0) + e.usage.cache_read_input_tokens
        if (e.usage.cache_creation_input_tokens) window.__usage.cacheCreate = (window.__usage.cacheCreate ?? 0) + e.usage.cache_creation_input_tokens
      }
      if (e.type === 'error') window.__toolLog.push({ t: Date.now(), kind: 'error', msg: e.message })
    })
  })
  return () => page.evaluate(() => { window.__unsub?.(); window.__unsub = null }).catch(() => {})
}

/** 输入框发送(内置对话框 .chat-input) */
export async function sendPrompt(page, prompt) {
  await page.fill('.chat-dialog .chat-input', prompt)
  await page.press('.chat-dialog .chat-input', 'Enter')
}

/**
 * 场景间挂起门禁清理:上一场景若以 RHC/approval/冲突挂起收口(UI hold() 接管后不限时等用户),
 * 下一场景消息会卡 useChat 排队 → msgs 不增 → waitIdle 的 `msgs > prevMsgCount` 永假干等 900s 超时。
 * (2026-08-27 uispec S3 首次中位 RHC 挖出:flash 撞 components.0 冻结字段转人工确认,S4-S10 全毒化;
 *  旧 8-16 基线 RHC 只在末位 S10 出现过,缺口从未暴露。)
 * 保守处置:RHC/approval 点末位选项(通常是「其他/拒绝」类不动数据项);冲突条 keep_external(保外部值);
 * 放行后原 invoke 继续跑完,排队消息随后正常消费。循环 ≤3 次防「放行后连环再挂」。
 */
export async function resolvePendingGates(page) {
  let total = 0
  for (let i = 0; i < 3; i++) {
    const acted = await page.evaluate(() => {
      const dlg = document.querySelector('.chat-dialog')
      if (!dlg) return ''
      // RHC 带 options:点末位(通常「其他/拒绝」类不动数据项;ApprovalBar 该形态无 allow 按钮)
      const opts = dlg.querySelectorAll('.approval-options .approval-opt')
      if (opts.length) { opts[opts.length - 1].click(); return `RHC 选项×${opts.length}(末位)` }
      // 工具确认 / RHC 无 options:点「同意」放行挂起动作(如 delete_component 破坏性删除确认;
      // 2026-08-27 实测 S6 以此形态挂起,首版 selector 只认 options 形态 → S7 卡排队 900s)
      const allow = dlg.querySelector('.approval-actions .approval-allow')
      if (allow) { allow.click(); return 'approval-allow' }
      // 冲突条:保守保外部值
      const keep = dlg.querySelector('.conflict-actions .conflict-keep')
      if (keep) { keep.click(); return 'conflict keep_external' }
      return ''
    })
    if (!acted) break
    total++
    console.log(`  [gate] 清理挂起门禁:${acted}`)
    await sleep(2500)
  }
  return total
}

/**
 * idle 判定双条件(核心方法论):
 * ① debugLogs 静默 >90s(连续 3 次采样确认,防采样间隙误判)② 活动子 agent = 0(子 reasoning 不打日志,只看日志会误判)
 * 快速失败:页面 reload(debugLogs 清零)→ quietMs 为 epoch 毫秒(>1e12)→ 立即抛(vite HMR 掉线/崩溃,续跑无意义)。
 * onSample:每轮采样回调(parallel 用它取 maxActiveSubagents)。
 */
export async function waitIdle(page, prevMsgCount, { timeoutMs = 900_000, onSample } = {}) {
  const t0 = Date.now()
  let quiet = 0
  while (Date.now() - t0 < timeoutMs) {
    const st = await page.evaluate(() => {
      const sdk = window.__sdk
      const msgs = sdk?.messages?.length ?? 0
      // 注:window.__sdk.messages 字段名与 UI 数组不同源(mountChatDialog initialMessages);只作「有新消息」粗判
      const logs = sdk?.debugLogs?.value ?? []
      const lastTs = logs.length ? logs[logs.length - 1].timestamp : 0
      const lastResp = [...logs].reverse().find((l) => l.type === 'llm_response')
      const active = sdk?.getActiveSubagents?.().length ?? 0
      return { msgs, quietMs: Date.now() - lastTs, hasResp: !!lastResp, active, logN: logs.length }
    })
    // 页面 reload 快速失败:debugLogs 清零 → quietMs 为 epoch 毫秒(>1e12)
    if (st.quietMs > 1e12) {
      console.log('  ⚠ 页面已 reload(debugLogs 清零,logN=' + st.logN + ')—— 会话已断,快速失败本场景')
      throw new Error('page reloaded during scenario(debugLogs reset;vite HMR 掉线或页面崩溃;跑前须重启 dev server)')
    }
    onSample?.(st)
    if (st.msgs > prevMsgCount && st.hasResp && st.active === 0 && st.quietMs > 90_000) {
      quiet += 1
      if (quiet >= 3) return st
    } else quiet = 0
    if (Math.random() < 0.12) console.log('   [采样]', JSON.stringify(st), 'prev=', prevMsgCount)
    await sleep(2500)
  }
  // 超时:dump 诊断轨迹(轮次/最近工具/活动性)再抛,便于定位卡点
  const diag = await page.evaluate(() => {
    const logs = window.__sdk.debugLogs.value
    const lastReq = [...logs].reverse().find((l) => l.type === 'llm_request')
    const lastTool = [...logs].reverse().find((l) => l.type === 'tool_result')
    return {
      msgs: window.__sdk.messages.length,
      lastRole: window.__sdk.messages.at(-1)?.role,
      activeSub: window.__sdk.inspect().subagent.active.map((a) => a.label),
      lastRound: lastReq?.data?.round, lastTool: lastTool ? lastTool.data.name + '@' + lastTool.data.round : '-',
      lastToolAge: lastTool ? Math.round((Date.now() - lastTool.timestamp) / 1000) + 's' : '-',
      logN: logs.length,
      tail: logs.slice(-8).map((l) => l.type + ':' + JSON.stringify(l.data).slice(0, 90)),
    }
  })
  console.log('  ⏰ 超时诊断:', JSON.stringify(diag, null, 2))
  throw new Error(`等待 agent idle 超时(${Math.round(timeoutMs / 1000)}s)`)
}

/**
 * 场景骨架:hook 安装 → 记基线 → 发送 → idle → collect → checks → 报告落盘。
 * cfg: { page, no, name, prompt, checks, report, OUT, only, errorRe, collect, extra?, quietTimeoutMs? }
 *  - collect: (page) => Promise<data>(套件自定义采集;返回对象须含 toolLog/usage 基础三件 + 套件扩展)
 *  - errorRe: 异常信号正则(套件各自的失败文案族;与 error kind 事件一起计入 errors)
 *  - extra:   场景前置(opts.before)/后置(opts.after)挂点
 * 返回 collect 的原始 data(checks 之外的套件后续逻辑可用)。
 */
export async function runScenario(cfg) {
  const { page, no, name, prompt, checks, report, OUT, only = [], errorRe, collect, quietTimeoutMs } = cfg
  if (only.length && !only.includes(no)) return null
  console.log(`\n===== S${no} ${name} =====\n❯ ${prompt}`)
  const t0 = Date.now()
  const uninstall = await installEventHook(page)
  if (cfg.before) await cfg.before(page)
  await resolvePendingGates(page)  // 上一场景遗留的 RHC/approval/冲突挂起先放行,防本场景消息卡排队
  const prevMsgs = await page.evaluate(() => window.__sdk.messages.length)
  await sendPrompt(page, prompt)
  await waitIdle(page, prevMsgs, { timeoutMs: quietTimeoutMs })
  const data = await collect(page)
  await uninstall()
  if (cfg.after) await cfg.after(page)
  const tools = data.toolLog.filter((l) => l.kind === 'call').map((l) => l.name)
  const results = {}
  for (const [k, fn] of Object.entries(checks)) {
    try { results[k] = { pass: !!fn({ ...data, tools }) } } catch (e) { results[k] = { pass: false, err: String(e).slice(0, 100) } }
  }
  // 异常信号:error 事件 + 结果文案命中套件 errorRe(失败回灌自纠可接受,超量才算异常)
  const errors = data.toolLog.filter((l) => l.kind === 'error' || (errorRe && errorRe.test(l.result ?? '')))
  const scenario = {
    no, name, prompt, elapsedMs: Date.now() - t0,
    tools, toolCount: tools.length, usage: data.usage,
    reply: data.reply ?? '', checks: results,
    errors: errors.map((e) => (e.msg ?? e.result ?? '').slice(0, 200)).slice(0, 8),
    toolLog: data.toolLog.map((l) => ({ kind: l.kind, name: l.name, sub: l.sub, args: l.args, resultHead: (l.result ?? '').slice(0, 160) })),
  }
  if (cfg.decorate) Object.assign(scenario, cfg.decorate(data))
  report.scenarios = report.scenarios.filter((s) => s.no !== no)
  report.scenarios.push(scenario)
  report.scenarios.sort((a, b) => a.no - b.no)
  writeFileSync(OUT, JSON.stringify(report, null, 2))
  console.log(`  耗时 ${(scenario.elapsedMs / 1000).toFixed(0)}s | 工具×${scenario.toolCount} | token ${JSON.stringify(data.usage)}`)
  console.log('  序列:', tools.join(' → ') || '(零工具,直答)')
  if (errors.length) console.log('  ⚠ 异常:', scenario.errors.join(' | '))
  console.log('  回复:', (data.reply ?? '').slice(0, 200).replace(/\n/g, ' '))
  for (const [k, v] of Object.entries(results)) console.log(`  ${v.pass ? '✓' : '✗'} ${k}`)
  return data
}

/** 汇总打印(返回 { total, failed } 供入口聚合退出码) */
export function summarize(report, OUT) {
  report.finishedAt = new Date().toISOString()
  writeFileSync(OUT, JSON.stringify(report, null, 2))
  const pass = report.scenarios.flatMap((s) => Object.entries(s.checks).map(([k, v]) => ({ s: s.no, k, p: v.pass })))
  const failed = pass.filter((x) => !x.p)
  console.log(`\n========== 汇总 ==========`)
  console.log(`场景 ${report.scenarios.length} | 断言 ${pass.length} | 通过 ${pass.length - failed.length} | 失败 ${failed.map((x) => `S${x.s}:${x.k}`).join(', ') || '无'}`)
  console.log(`报告: ${OUT}`)
  return { total: pass.length, failed: failed.length }
}

// ===== 基线对比(prompt/工具数硬指标;方法论「基线对比」的机械化)=====

/** 报告 → 指标集(仅数字,无内容;供入库基线与 diff)。多场景套件按 S<n>;单场景套件(parallel 顶层指标)按 ALL */
export function metricsOf(report) {
  const out = {}
  if (Array.isArray(report?.scenarios) && report.scenarios.length) {
    for (const s of report.scenarios) {
      out[`S${s.no}`] = {
        prompt: s.usage?.prompt ?? 0,
        completion: s.usage?.completion ?? 0,
        toolCount: s.toolCount ?? 0,
        elapsedSec: Math.round((s.elapsedMs ?? 0) / 1000),
        ...(s.usage?.cacheRead ? { cacheRead: s.usage.cacheRead } : {}),
        ...(s.usage?.cacheCreate ? { cacheCreate: s.usage.cacheCreate } : {}),
      }
    }
    return out
  }
  if (report && (report.usage || report.toolCount != null)) {
    out.ALL = {
      prompt: report.usage?.prompt ?? 0,
      completion: report.usage?.completion ?? 0,
      toolCount: report.toolCount ?? 0,
      elapsedSec: Math.round((report.elapsedMs ?? 0) / 1000),
      ...(report.usage?.cacheRead ? { cacheRead: report.usage.cacheRead } : {}),
      ...(report.usage?.cacheCreate ? { cacheCreate: report.usage.cacheCreate } : {}),
    }
  }
  return out
}

export const BASELINE_PATH = resolve(ROOT, 'tests/runtime/real-llm-baseline.json')

export function loadBaseline(path = BASELINE_PATH) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

/** 各套件报告 → 写基线(含录制时间;入库供跨会话对比) */
export function saveBaseline(suiteMetrics, path = BASELINE_PATH) {
  const baseline = { recordedAt: new Date().toISOString(), suites: suiteMetrics }
  writeFileSync(path, JSON.stringify(baseline, null, 2))
  return baseline
}

/**
 * 当前指标 vs 基线 diff:输出对比行;超阈值标记 ▲▼(疑似回归/改善)。
 * 阈值:prompt ±15% 且 ±2000 token 才标(toolCount ±3);elapsedSec 仅展示不判(环境噪声大)。
 * 返回 { lines, regressions }(regressions > 0 → 入口退出码非零可选用;默认只警示不失败,需 --strict)。
 */
export function diffBaseline(current, baseline) {
  const lines = []
  let regressions = 0
  for (const [suite, metrics] of Object.entries(current)) {
    const base = baseline?.suites?.[suite]
    if (!base) { lines.push(`[${suite}] (基线无此套件,首次运行;--baseline-update 采集)`); continue }
    for (const [sKey, m] of Object.entries(metrics)) {
      const b = base[sKey]
      if (!b) { lines.push(`[${suite}] ${sKey}: (基线无此场景)`); continue }
      const parts = []
      for (const [k, cur] of Object.entries(m)) {
        const prev = b[k] ?? 0
        const delta = cur - prev
        const pct = prev > 0 ? Math.round((delta / prev) * 100) : 0
        const flag = k === 'elapsedSec' ? '' : (k === 'toolCount' ? (Math.abs(delta) > 3 ? (delta > 0 ? ' ▲' : ' ▼') : '') : (Math.abs(delta) > 2000 && Math.abs(pct) >= 15 ? (delta > 0 ? ' ▲' : ' ▼') : ''))
        if (flag === ' ▲') regressions++
        parts.push(`${k} ${prev}→${cur}(${pct >= 0 ? '+' : ''}${pct}%)${flag}`)
      }
      lines.push(`[${suite}] ${sKey}: ${parts.join(' | ')}`)
    }
  }
  return { lines, regressions }
}
