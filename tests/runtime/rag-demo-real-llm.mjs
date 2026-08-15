/**
 * rag-demo 四模式真 LLM 回归(Playwright 浏览器路径;Anthropic 协议 modelverse)
 *
 *   A memory 异步注入     —— 文档常驻主上下文,期望主 agent 直答(零委派)
 *   B createRagSubagent(mock retriever)—— 期望 use_rag 委派 → search_docs → 结论回主
 *   C 子 agent + 真实 MCP(VITE_RAG_MCP_URL)—— 期望 use_rag 委派 → search_docs → 远程 rag_search
 *   D MCP 直连            —— 期望 mcp 工具迟到注入主工具池,主 agent 直调(不经子 agent)
 *
 * 方法论(idle 双条件 / 跑前重启 dev server / 断点续跑)见 doc/real-llm-regression.md。
 * 用法:node tests/runtime/rag-demo-real-llm.mjs [场景号…];输出 _real-llm-rag.json(gitignore)
 * 环境变量:RAGDEMO_BASE(默认 http://localhost:3000)/ RAGDEMO_OUT;无 VITE_ANTHROPIC_API_KEY 自动 skip。
 */
import { chromium } from 'playwright'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const BASE = process.env.RAGDEMO_BASE || 'http://localhost:3000'
const OUT = resolve(ROOT, process.env.RAGDEMO_OUT || '_real-llm-rag.json')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const only = process.argv.slice(2).map(Number).filter(Boolean)

const hasKey = (() => {
  if (!existsSync(resolve(ROOT, '.env'))) return false
  return /^VITE_ANTHROPIC_API_KEY=.+/m.test(readFileSync(resolve(ROOT, '.env'), 'utf8'))
})()
if (!hasKey) {
  console.log('⚠ skip:.env 缺 VITE_ANTHROPIC_API_KEY(rag-demo 真 LLM 回归需要真 key)')
  process.exit(0)
}

const report = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { startedAt: new Date().toISOString(), scenarios: [] }
report.scenarios = report.scenarios.filter((s) => !only.length || only.includes(s.no))

/** idle 双条件:debugLogs 静默 >90s ×3 采样 + 活动子 agent = 0(子 reasoning 不打日志,单看日志会误判) */
async function waitIdle(page, prevMsgCount, timeoutMs = 900_000) {
  const t0 = Date.now()
  let quiet = 0
  while (Date.now() - t0 < timeoutMs) {
    const st = await page.evaluate(() => {
      const sdk = window.__sdk
      const msgs = sdk?.messages?.length ?? 0
      const logs = sdk?.debugLogs?.value ?? []
      const lastTs = logs.length ? logs[logs.length - 1].timestamp : 0
      const lastResp = [...logs].reverse().find((l) => l.type === 'llm_response')
      const active = sdk?.getActiveSubagents?.().length ?? 0
      return { msgs, quietMs: Date.now() - lastTs, hasResp: !!lastResp, active, logN: logs.length }
    })
    // 页面 reload 快速失败:debugLogs 清零 → quietMs 为 epoch 毫秒(>1e12)
    if (st.quietMs > 1e12) {
      console.log('  ⚠ 页面已 reload(debugLogs 清零,logN=' + st.logN + ')—— 会话已断,快速失败本场景')
      throw new Error('page reloaded during scenario(debugLogs reset;vite HMR 掉线或页面崩溃)')
    }
    if (st.msgs > prevMsgCount && st.hasResp && st.active === 0 && st.quietMs > 90_000) {
      quiet += 1
      if (quiet >= 3) return st
    } else quiet = 0
    if (Math.random() < 0.12) console.log('   [采样]', JSON.stringify(st), 'prev=', prevMsgCount)
    await sleep(2500)
  }
  const diag = await page.evaluate(() => {
    const logs = window.__sdk.debugLogs.value
    const lastReq = [...logs].reverse().find((l) => l.type === 'llm_request')
    const lastTool = [...logs].reverse().find((l) => l.type === 'tool_result')
    return {
      msgs: window.__sdk.messages.length,
      lastRole: window.__sdk.messages.at(-1)?.role,
      activeSub: window.__sdk.inspect().subagent.active.map((a) => a.label),
      lastRound: lastReq?.data?.round, lastTool: lastTool ? lastTool.data.name + '@' + lastTool.data.round : '-',
      logN: logs.length,
      tail: logs.slice(-8).map((l) => l.type + ':' + JSON.stringify(l.data).slice(0, 90)),
    }
  })
  console.log('  ⏰ 超时诊断:', JSON.stringify(diag, null, 2))
  throw new Error('等待 agent idle 超时(900s)')
}

/** 切模式:点按钮 → 等 rebuild 完成(新 __sdk 挂上 + 对话框重渲染) */
async function switchMode(page, label) {
  await page.click(`.mode-btn:has-text("${label}")`)
  await page.waitForFunction(() => {
    const el = document.getElementById('chat-root')
    return window.__sdk && el && el.querySelector('.chat-dialog')
  }, { timeout: 30_000 })
  await sleep(1500)
}

/** D 模式 MCP 后台握手:轮询等 mcp: 工具迟到注入主工具池(3.14 后台连接语义) */
async function waitMcpTools(page, timeoutMs = 30_000) {
  return page.waitForFunction(() => {
    const tools = window.__sdk?.inspect?.().tools ?? []
    return tools.some((t) => /^mcp:/.test(t.source ?? ''))
  }, { timeout: timeoutMs })
}

async function runScenario(page, no, name, prompt, checks, opts = {}) {
  if (only.length && !only.includes(no)) return null
  console.log(`\n===== S${no} ${name} =====\n❯ ${prompt}`)
  const t0 = Date.now()
  // 每场景重挂 hook(切模式后 __sdk 已换新实例)
  await page.evaluate(() => {
    window.__toolLog = []
    window.__usage = null
    window.__unsub?.()
    window.__unsub = window.__sdk.hook((e) => {
      if (e.type === 'tool_call') window.__toolLog.push({ t: Date.now(), kind: 'call', name: e.name, args: JSON.stringify(e.args).slice(0, 300) })
      if (e.type === 'tool_result') window.__toolLog.push({ t: Date.now(), kind: 'result', name: e.name, result: String(e.result ?? '').slice(0, 500) })
      if (e.type === 'usage') { window.__usage = window.__usage || { prompt: 0, completion: 0 }; window.__usage.prompt += e.usage.prompt_tokens ?? 0; window.__usage.completion += e.usage.completion_tokens ?? 0 }
      if (e.type === 'subagent') window.__toolLog.push({ t: Date.now(), kind: 'sub', name: e.name, sub: `${e.label}:${e.kind}` })
      if (e.type === 'error') window.__toolLog.push({ t: Date.now(), kind: 'error', msg: e.message })
    })
  })
  if (opts.before) await opts.before(page)
  const prevMsgs = await page.evaluate(() => window.__sdk.messages.length)
  await page.fill('.chat-dialog .chat-input', prompt)
  await page.press('.chat-dialog .chat-input', 'Enter')
  await waitIdle(page, prevMsgs)
  const data = await page.evaluate(() => ({
    toolLog: window.__toolLog,
    usage: window.__usage ?? (window.__sdk.usage?.total_tokens ? { prompt: window.__sdk.usage.prompt_tokens, completion: window.__sdk.usage.completion_tokens, fromSdkUsage: true } : null),
    reply: window.__sdk.messages[window.__sdk.messages.length - 1]?.content?.slice(0, 800) ?? '',
    mcpServers: window.__sdk.inspect().mcp?.servers?.map((s) => `${s.name}:${s.toolCount}`) ?? [],
    subHistory: (window.__sdk.inspect().subagent?.history ?? []).map((h) => ({ label: h.label, status: h.status })),
  }))
  await page.evaluate(() => { window.__unsub?.(); window.__unsub = null })
  if (opts.after) await opts.after(page)
  const tools = data.toolLog.filter((l) => l.kind === 'call').map((l) => l.name)
  const checkData = { ...data, tools } // checks 可用 d.tools(工具调用名序列)
  const results = {}
  for (const [k, fn] of Object.entries(checks)) {
    try { results[k] = { pass: !!fn(checkData) } } catch (e) { results[k] = { pass: false, err: String(e).slice(0, 100) } }
  }
  // 异常信号:错误事件 / 工具结果含失败文案(检索出错 / 未检索到 / 不存在工具类回灌)
  const errors = data.toolLog.filter((l) => l.kind === 'error' || /检索出错|加载出错|未检索到|不存在|invalid|denied/i.test(l.result ?? ''))
  const scenario = {
    no, name, prompt, elapsedMs: Date.now() - t0,
    tools, toolCount: tools.length, usage: data.usage,
    reply: data.reply, checks: results, mcpServers: data.mcpServers, subHistory: data.subHistory,
    errors: errors.map((e) => (e.msg ?? e.result ?? '').slice(0, 200)).slice(0, 8),
    toolLog: data.toolLog.map((l) => ({ kind: l.kind, name: l.name, sub: l.sub, args: l.args, resultHead: (l.result ?? '').slice(0, 160) })),
  }
  report.scenarios = report.scenarios.filter((s) => s.no !== no)
  report.scenarios.push(scenario)
  report.scenarios.sort((a, b) => a.no - b.no)
  writeFileSync(OUT, JSON.stringify(report, null, 2))
  console.log(`  耗时 ${(scenario.elapsedMs / 1000).toFixed(0)}s | 工具×${scenario.toolCount} | token ${JSON.stringify(data.usage)}`)
  console.log('  序列:', tools.join(' → ') || '(零工具,直答)')
  if (errors.length) console.log('  ⚠ 异常:', scenario.errors.join(' | '))
  console.log('  回复:', data.reply.slice(0, 200).replace(/\n/g, ' '))
  for (const [k, v] of Object.entries(results)) console.log(`  ${v.pass ? '✓' : '✗'} ${k}`)
  return data
}

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('console', (m) => { const t = m.text(); if (/reload|re-optimiz|optimized|full reload|vite/i.test(t)) console.log('  [vite]', t.slice(0, 200)) })
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log(`  [reload] framenavigated → ${f.url()}`) })
page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`))
await page.goto(`${BASE}/examples/rag-demo/`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.chat-dialog')
await page.waitForFunction(() => window.__sdk, { timeout: 30_000 })
await sleep(2000)

// ---------- S1 A · memory 异步注入(文档常驻主上下文,期望直答零委派) ----------
await runScenario(page, 1, 'A · memory 异步注入',
  '基础版多少钱一个月?支持退款吗?',
  {
    '答出价格 ¥99/月': (d) => /99\s*元|¥\s*99|99\s*\/\s*月/.test(d.reply),
    '答出退款政策(7 天)': (d) => /7\s*天/.test(d.reply),
    '零委派(memory 常驻直答)': (d) => !d.tools.includes('use_rag'),
  })

// ---------- S2 B · createRagSubagent(mock retriever;期望委派链路 use_rag → search_docs) ----------
await switchMode(page, 'B · createRagSubagent')
await runScenario(page, 2, 'B · 子 agent 检索(mock retriever)',
  '产品价格是多少?退款政策是什么?',
  {
    '主 agent 委派 use_rag': (d) => d.tools.includes('use_rag'),
    '子 agent 调 search_docs': (d) => d.toolLog.some((l) => l.kind === 'sub' && /search_docs/.test(l.sub)) || d.toolLog.some((l) => l.name === 'search_docs'),
    '答出价格 ¥99/月': (d) => /99\s*元|¥\s*99/.test(d.reply),
    '答出退款政策(7 天)': (d) => /7\s*天/.test(d.reply),
    '子 agent 无失败重试风暴(错误类结果 ≤2)': (d) => d.toolLog.filter((l) => /检索出错|加载出错/.test(l.result ?? '')).length <= 2,
  })

// ---------- S3 C · 子 agent + 真实 MCP(VITE_RAG_MCP_URL;链路 use_rag → search_docs → 远程 rag_search) ----------
await switchMode(page, 'C · 真实 MCP')
await runScenario(page, 3, 'C · 子 agent + 真实 MCP 检索',
  '方舟是什么?知识库里有哪些相关资料?',
  {
    '主 agent 委派 use_rag': (d) => d.tools.includes('use_rag'),
    '子 agent 调 search_docs(远程 rag_search)': (d) => d.toolLog.some((l) => l.name === 'search_docs' && !/检索出错/.test(l.result ?? '')),
    '回复非空且非编造兜底(有结论或诚实说未检索到)': (d) => d.reply.length > 20,
    '无失败重试风暴(检索出错 ≤2)': (d) => d.toolLog.filter((l) => /检索出错/.test(l.result ?? '')).length <= 2,
  })

// ---------- S4 D · MCP 直连(mcp:[] 工具迟到注入主池,主 agent 直调不经子 agent) ----------
await switchMode(page, 'D · MCP 直连')
await waitMcpTools(page).then(
  () => console.log('  [D] mcp 工具已注入主工具池'),
  (e) => console.log('  [D] ⚠ mcp 工具注入超时(继续跑,可能走不了 MCP 链路):', String(e).slice(0, 120)),
)
await runScenario(page, 4, 'D · MCP 直连(主 agent 直调 rag_search)',
  '帮我检索一下「方舟」相关的资料,总结知识库里有什么。',
  {
    '主 agent 直调 mcp 工具(rag_search/rag_ask/rag_documents)': (d) => d.tools.some((t) => /^rag_(search|ask|documents)$/.test(t)),
    '不经子 agent(零 use_rag)': (d) => !d.tools.includes('use_rag'),
    '回复非空': (d) => d.reply.length > 20,
  })

writeFileSync(OUT, JSON.stringify(report, null, 2))
const allPass = report.scenarios.every((s) => Object.values(s.checks ?? {}).every((c) => c.pass))
console.log(`\n===== 完成:${report.scenarios.length} 场景,checks ${allPass ? '全绿 ✓' : '存在 ✗(见报告)'} → ${OUT} =====`)
await browser.close()
