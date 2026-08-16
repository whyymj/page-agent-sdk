/**
 * 真 LLM 实测:三档判档(快速/方向闸/详细)+ Q5e 剩余项(墙钟并行/人工并发 keep_external)
 *
 * 场景(complex-demo,已配 augmentSystem 三档判档 + maxParallelTools:3):
 *   M1 方向闸:「加世界杯主题轮播」(新建∧创意词)→ 期望 request_human_confirmation 出 ≥2 方案 → 自动选第 1 项 → 落地
 *   M2 快速:「改标题,别问直接做」(显式快速词)→ 期望零征询直接改
 *   M3 详细:「认真规划,新建 3 组件」→ 期望征询 → write_todos → ≥2 use_html 委派 + 复杂组件 task 含结构对比要求 + 同轮并行重叠
 *   M4 人工并发:委派在途中人工直改组件 code → 期望 keep_external(人工值保留 + console.warn 留痕)
 *
 * 同组件 COMPONENT_BUSY 可见性由 e2e/browser mock 锁定(capability-packs + complex-demo spec),真 LLM 下模型遵循
 * 编排禁令不会主动同组件双委派,不强行构造。
 *
 * 公共基建在 _real-llm-lib.mjs。用法:node tests/runtime/modes-real-llm.mjs [场景号…]
 * 输出 _real-llm-modes.json(gitignore)。跑前必重启 dev server;跑中禁并发 test:browser。
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ROOT, resolveRunEnv, hasEnvKey, skipSuite, launchBrowser, openDemoPage, installEventHook, sendPrompt, waitIdle, sleep,
} from './_real-llm-lib.mjs'

const OUT = resolve(ROOT, process.env.REAL_LLM_OUT || '_real-llm-modes.json')

/** 自动点选方案征询(approval-opt 整行按钮;按 options 内容去重,新征询再点) */
function startApprovalAutoClicker(page, pick = 0) {
  const seen = []
  const timer = setInterval(async () => {
    try {
      const opts = await page.$$eval('.approval-bar .approval-opt', (els) => els.map((e) => e.textContent.trim())).catch(() => [])
      if (opts.length && !seen.some((s) => JSON.stringify(s) === JSON.stringify(opts))) {
        seen.push(opts)
        await page.$$eval('.approval-bar .approval-opt', (els, i) => els[i].click(), pick).catch(() => {})
        console.log(`  [approval] 自动选第 ${pick + 1} 项:「${(opts[pick] || '').slice(0, 60)}」(共 ${opts.length} 项)`)
      }
    } catch { /* 页面轮转间隙忽略 */ }
  }, 1500)
  return { stop: () => clearInterval(timer), seen: () => seen }
}

export async function runSuite(only = []) {
  if (!hasEnvKey(/^VITE_AI_API_KEY=.+/m)) return skipSuite('.env 缺 VITE_AI_API_KEY(modes 套件)')
  const { BASE } = resolveRunEnv({ outDefault: '_real-llm-modes.json' })
  const browser = await launchBrowser()
  let page = await openDemoPage(browser, `${BASE}/examples/complex-demo/`)
  await installEventHook(page)
  const warns = []
  page.on('console', (m) => { if (m.type() === 'warning' && m.text().includes('code-asset')) warns.push(m.text()) })

  const scenarios = []
  const report = { startedAt: new Date().toISOString(), suite: 'modes', scenarios }

  const run = async (no, name, fn) => {
    if (only.length && !only.includes(no)) return
    console.log(`\n━━━ M${no} ${name} ━━━`)
    const checks = []
    const ck = (ok, label) => { checks.push({ ok: !!ok, label }); console.log(`  ${ok ? '✓' : '✗'} ${label}`) }
    const t0 = Date.now()
    // reload 容错:vite HMR ws 偶发瞬断(冷启动 optimizeDeps/长连接)→ 页面 reload 即失败太脆;
    // 检测到 reload 异常时重开页面 + 重装 hook,重试该场景一次(scenario 自含,memory storage 重开即净)
    for (let attempt = 0; ; attempt++) {
      try { await fn(ck); break } catch (e) {
        if (attempt === 0 && /page reloaded/i.test(String(e))) {
          console.log(`  [retry] 页面 reload(HMR 瞬断),重开页面重试 M${no}`)
          try { await page.close() } catch { /* 已关 */ }
          page = await openDemoPage(browser, `${BASE}/examples/complex-demo/`)
          await installEventHook(page)
          page.on('console', (m) => { if (m.type() === 'warning' && m.text().includes('code-asset')) warns.push(m.text()) })
          continue
        }
        checks.push({ ok: false, label: `场景异常:${String(e).slice(0, 200)}` }); console.log(`  ✗ 异常 ${e}`)
        break
      }
    }
    // diag:末条 assistant 回复 + 工具调用名 + 模式段注入确认(augmentSystem 判档是否真的进了 system prompt)
    let diag
    try {
      diag = await page.evaluate(() => {
        const reqs = (window.__sdk?.debugLogs?.value ?? []).filter((l) => l.type === 'llm_request')
        const sys = String(reqs.at(-1)?.data?.messages?.[0]?.content ?? '')
        return {
          reply: ((window.__sdk?.messages ?? []).filter((m) => m.role === 'assistant').at(-1)?.content ?? '').slice(0, 300),
          tools: ((window.__sdk?.debugLogs?.value ?? []).filter((l) => l.type === 'tool_call').map((l) => l.data?.name)).slice(-12),
          modeSegment: sys.includes('当前模式:方向确认') ? 'propose' : sys.includes('当前模式:详细设计') ? 'detailed' : 'none',
        }
      })
    } catch { /* 页面已关 */ }
    scenarios.push({ no, name, checks, pass: checks.filter((c) => c.ok).length, fail: checks.filter((c) => !c.ok).length, durationMs: Date.now() - t0, ...(diag ? { diag } : {}) })
    writeFileSync(OUT, JSON.stringify(report, null, 2))
  }

  const countCustom = () => page.evaluate(() => window.page.components.filter((c) => c.type === 'custom' && (c.code ?? '').length > 300).length)
  const msgsNow = () => page.evaluate(() => window.__sdk.messages.length)
  /** 本场景期间的新 debugLogs(按场景起点时间过滤) */
  const logsSince = async (t) => page.evaluate((ts) => window.__sdk.debugLogs.value.filter((l) => l.timestamp >= ts), t)

  // ── M1 方向闸:新建∧创意词 → 主 agent 自己出方案征询(不进子 agent 思考)──
  await run(1, '方向闸:世界杯轮播(新建∧创意词 → 方案征询)', async (ck) => {
    const t0 = Date.now(); const before = await countCustom(); const prev = await msgsNow()
    const clicker = startApprovalAutoClicker(page, 0)
    console.log('  ❯ 加一个世界杯主题的轮播图(纯代码组件)')
    await sendPrompt(page, '加一个世界杯主题的轮播图(纯代码组件)')
    await waitIdle(page, prev, { timeoutMs: 900_000 })
    clicker.stop()
    const logs = await logsSince(t0)
    const confirms = logs.filter((l) => l.type === 'tool_call' && l.data?.name === 'request_human_confirmation')
    const seen = clicker.seen()
    ck(confirms.length >= 1, `方向闸触发:request_human_confirmation ≥1 次(实际 ${confirms.length})`)
    ck(seen.length >= 1 && seen[0].length >= 2, `征询含 ≥2 个方案(实际 ${seen[0]?.length ?? 0} 项)`)
    ck(await countCustom() === before + 1, `选定后落地 1 个 custom 组件(前 ${before} → 后 ${await countCustom()})`)
  })

  // ── M2 快速:显式快速词 → 零征询直接改 ──
  await run(2, '快速:改标题别问(显式词 → 零征询)', async (ck) => {
    const t0 = Date.now(); const prev = await msgsNow()
    const clicker = startApprovalAutoClicker(page, 0)
    console.log('  ❯ 把页面主标题改成「会员狂欢季」,别问直接做')
    await sendPrompt(page, '把页面主标题改成「会员狂欢季」,别问直接做')
    await waitIdle(page, prev, { timeoutMs: 300_000 })
    clicker.stop()
    const logs = await logsSince(t0)
    const title = await page.evaluate(() => window.page.title)
    ck(!logs.some((l) => l.type === 'tool_call' && l.data?.name === 'request_human_confirmation') && clicker.seen().length === 0, '零方案征询(快速档不注入,直接执行)')
    ck(title === '会员狂欢季', `标题已直改(实际「${title}」)`)
  })

  // ── M3 详细:认真规划 + 3 组件 → 征询 + todos + 委派(task 带结构对比)+ 同轮并行(Q5e 墙钟)──
  await run(3, '详细:认真规划 3 组件(征询+todos+委派+并行)', async (ck) => {
    const t0 = Date.now(); const before = await countCustom(); const prev = await msgsNow()
    const clicker = startApprovalAutoClicker(page, 0)
    console.log('  ❯ 认真规划,新建 3 个纯代码组件:① 世界杯主题轮播图 ② 粒子特效背景 ③ 开赛倒计时牌')
    await sendPrompt(page, '认真规划,新建 3 个纯代码组件:① 世界杯主题轮播图 ② 粒子特效背景 ③ 开赛倒计时牌')
    await waitIdle(page, prev, { timeoutMs: 1800_000 })
    clicker.stop()
    const logs = await logsSince(t0)
    const info = await page.evaluate(() => {
      const logs = window.__sdk.debugLogs.value
      const calls = logs.filter((l) => l.type === 'tool_call').map((l) => ({ t: l.timestamp, name: l.data?.name, round: l.data?.round }))
      const results = logs.filter((l) => l.type === 'tool_result').map((l) => ({ t: l.timestamp, name: l.data?.name, round: l.data?.round }))
      return {
        calls, results,
        history: window.__sdk.inspect().subagent.history.map((h) => ({ label: h.label, task: String(h.task ?? ''), durationMs: h.durationMs, startedAt: h.startedAt })),
        customCount: window.page.components.filter((c) => c.type === 'custom' && (c.code ?? '').length > 300).length,
      }
    })
    // 详细档三要素:征询 / todos / 委派
    ck(clicker.seen().length >= 1, `方向确认征询发生(${clicker.seen().length} 次)`)
    ck(logs.some((l) => l.type === 'tool_call' && /write_todos/.test(l.data?.name ?? '')), 'write_todos 拆步(详细档 ②)')
    const delegations = info.history.filter((h) => h.status === 'done')
    ck(delegations.length >= 2, `use_html 委派 ≥2(实际 ${delegations.length})`)
    // 深入要求转移:委派 task 含范围限定的结构对比措辞(详细档 ③,防与子 agent 思考纪律冲突)
    const deepTasks = delegations.filter((h) => /对比|取舍|候选/.test(h.task))
    ck(delegations.length === 0 || deepTasks.length >= 1, `委派 task 含结构对比要求(${deepTasks.length}/${delegations.length} 条)`)
    ck(info.customCount >= before + 2, `≥2 组件落地(前 ${before} → 后 ${info.customCount})`)
    // Q5e 墙钟:同轮并行(use_html 同 round ≥2)+ 子 agent 时间窗重叠
    const byRound = {}
    for (const c of info.calls) if (c.name === 'use_html') byRound[c.round] = (byRound[c.round] ?? 0) + 1
    const parallelRound = Object.entries(byRound).filter(([, n]) => n >= 2)
    ck(parallelRound.length >= 1, `同轮并行委派发生(round ${parallelRound.map(([r]) => r).join(',')} 各 ≥2)`)
    const spans = delegations.map((h) => ({ start: h.startedAt, end: h.startedAt + h.durationMs })).sort((a, b) => a.start - b.start)
    let overlapMs = 0
    for (let i = 1; i < spans.length; i++) overlapMs = Math.max(overlapMs, spans[i - 1].end - spans[i].start)
    ck(spans.length < 2 || overlapMs > 5000, `子 agent 并发窗口重叠 ${Math.round(overlapMs / 1000)}s(墙钟 = max 而非 sum)`)
    const sum = delegations.reduce((s, h) => s + h.durationMs, 0)
    const wall = spans.length ? spans.at(-1).end - spans[0].start : 0
    console.log(`  [墙钟] 并行墙钟 ${Math.round(wall / 1000)}s vs 子任务 sum ${Math.round(sum / 1000)}s(${delegations.length} 个委派)`)
  })

  // ── M4 人工并发:委派在途人工直改 code → keep_external(Q5e)──
  await run(4, '人工并发:委派中直改 code → keep_external', async (ck) => {
    // 前置:造一个 custom 组件(快速词避开征询;组件尽量简单降生成时长,超时放宽 —— flash 单组件+validate 重试可超 900s)
    let prev = await msgsNow()
    console.log('  ❯ (前置)加一个纯代码组件:幸运色块,直接做别问')
    await sendPrompt(page, '加一个纯代码组件:幸运色块(一个纯文字色块,无动画,点击换一句文案),直接做别问')
    await waitIdle(page, prev, { timeoutMs: 1200_000 })
    const idx = await page.evaluate(() => {
      const i = [...window.page.components].map((c, i) => [c, i]).reverse().find(([c]) => c.type === 'custom' && (c.name ?? '').includes('幸运'))
      return i ? i[1] : -1
    })
    ck(idx >= 0, `前置组件就位(components.${idx})`)
    if (idx < 0) return
    // 正式:委派修改,在途窗口内人工直改 code
    const warnsBefore = warns.length
    prev = await msgsNow()
    console.log('  ❯ 把幸运色块改成菱形,直接做别问(委派进行中人工将直改其 code)')
    await sendPrompt(page, '把幸运色块改成菱形,直接做别问')
    await page.waitForFunction(() => window.__sdk.getActiveSubagents().length > 0, { timeout: 240_000 }).catch(() => {})
    await sleep(3000) // active>0 = beforeAgent checkout 已过;留 3s 缓冲确保 hash 已记录
    const mutOk = await page.evaluate((i) => {
      const c = window.page.components[i]
      if (!c) return false
      c.code = '<section class="manual-keep" data-manual="1"><h1>人工改的版本</h1></section>'
      return true
    }, idx)
    console.log(`  [人工直改] ${mutOk ? '已写入 data-manual 版本' : '目标组件不存在'}`)
    await waitIdle(page, prev, { timeoutMs: 900_000 })
    const code = await page.evaluate((i) => window.page.components[i]?.code ?? '', idx)
    ck(mutOk, '人工直改成功执行')
    ck(code.includes('data-manual="1"'), `keep_external:人工值保留(实际前 60 字:${code.slice(0, 60)})`)
    ck(warns.length > warnsBefore, `observable 留痕 console.warn ×${warns.length - warnsBefore}(${warns.slice(warnsBefore)[0]?.slice(0, 80) ?? ''}…)`)
  })

  const pass = scenarios.reduce((s, x) => s + x.pass, 0)
  const fail = scenarios.reduce((s, x) => s + x.fail, 0)
  console.log(`\n==== modes: ${pass} passed, ${fail} failed ====`)
  writeFileSync(OUT, JSON.stringify(report, null, 2))
  await browser.close()
  if (fail > 0) process.exitCode = 1
  return { pass, fail }
}

// 直接运行入口(node tests/runtime/modes-real-llm.mjs [场景号…])
if (process.argv[1] && process.argv[1].endsWith('modes-real-llm.mjs')) {
  runSuite(process.argv.slice(2).map(Number).filter(Boolean)).catch((e) => { console.error(e); process.exit(1) })
}
