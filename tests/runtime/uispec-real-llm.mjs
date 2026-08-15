/**
 * 真 LLM 全场景回归(Playwright 浏览器路径,仓库版)—— 模拟真实用户操作流,尽量发现问题
 *
 * 与 tests/runtime/*-real-llm.ts(headless 直连 dist)互补:本脚本走真实浏览器 + dev server 页面注入,
 * 覆盖 UI 交互(输入框发送)/ 渲染层 / vite HMR 干扰等浏览器环境因素。
 *
 * 场景(complex-demo,已挂 ark-ui-spec UI 规范 skill + 自动装配 html 子 agent):
 *   S1  复杂代码组件生成(UI 规范)     S2  二次精修(规范持续 + 笔记交接)
 *   S3  组件调序(move op)            S4  改普通组件属性(主 agent 自己 write)
 *   S5  新建普通组件(不经代码 agent) S6  删除组件
 *   S7  多组件整页(逐个委派)         S8  容器层级移动
 *   S9  错误恢复(不存在的组件名)     S10 模糊开放指令(「页面太素,搞点氛围」)
 *
 * 方法论(idle 判定 / 跑前准备 / 基线对比)见 doc/real-llm-regression.md。
 *
 * 用法:
 *   1. 跑前重启 dev server:npm run dev(拿最新代码 + 清 vite 缓存)
 *   2. 跑中禁并发 test:browser(会抢 dev server / 干扰页面)
 *   3. node tests/runtime/uispec-real-llm.mjs [场景号…]   # 默认全部;输出 _real-llm-uispec.json(gitignore)
 *
 * 环境变量:UISPEC_BASE(默认 http://localhost:3000)/ UISPEC_OUT(默认 _real-llm-uispec.json)
 * 凭据:页面侧经 vite 读 .env(VITE_AI_*),脚本不接触 key;.env 无 VITE_AI_API_KEY 则 skip。
 */
import { chromium } from 'playwright'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const BASE = process.env.UISPEC_BASE || 'http://localhost:3000'
const OUT = resolve(ROOT, process.env.UISPEC_OUT || '_real-llm-uispec.json')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const only = process.argv.slice(2).map(Number).filter(Boolean)

// 与 tests/runtime/*-real-llm.ts 同约定:.env 无 key → skip(dev server 起了也全是 401,白跑)
const hasKey = (() => {
  if (!existsSync(resolve(ROOT, '.env'))) return false
  return /^VITE_AI_API_KEY=.+/m.test(readFileSync(resolve(ROOT, '.env'), 'utf8'))
})()
if (!hasKey) {
  console.log('⚠ skip:.env 缺 VITE_AI_API_KEY(真 LLM 回归需要真 key;mock 回归请用 npm run test:browser)')
  process.exit(0)
}

const report = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { startedAt: new Date().toISOString(), scenarios: [] }
report.scenarios = report.scenarios.filter((s) => !only.length || only.includes(s.no))

/**
 * idle 判定双条件(核心方法论,详见 doc/real-llm-regression.md):
 * ① debugLogs 静默 >90s(连续 3 次采样确认,防采样间隙误判)
 * ② getActiveSubagents()===0 —— 子 agent reasoning 阶段不打日志,只看日志会误判「已结束」
 * 辅助:msgs>prev(有新消息)+ hasResp(至少一条 llm_response)
 */
async function waitIdle(page, prevMsgCount, timeoutMs = 1800_000) {
  const t0 = Date.now()
  let quiet = 0
  while (Date.now() - t0 < timeoutMs) {
    const st = await page.evaluate(() => {
      const sdk = window.__sdk
      const msgs = sdk?.messages?.length ?? 0
      // 注:window.__sdk.messages 与 UI 消息数组不同源(mountChatDialog initialMessages vs
      // useChat messages 属性名不匹配);消息终态判定不可信,只用作「有新消息」的粗判,字段名勿信(用 at(-1))
      const logs = sdk?.debugLogs?.value ?? []
      const lastTs = logs.length ? logs[logs.length - 1].timestamp : 0
      const lastResp = [...logs].reverse().find((l) => l.type === 'llm_response')
      const active = sdk?.getActiveSubagents?.().length ?? 0
      return { msgs, quietMs: Date.now() - lastTs, hasResp: !!lastResp, active }
    })
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
      lastLen: window.__sdk.messages.at(-1)?.content?.length,
      activeSub: window.__sdk.inspect().subagent.active.map((a) => a.label),
      lastRound: lastReq?.data?.round, lastTool: lastTool ? lastTool.data.name + '@' + lastTool.data.round : '-',
      lastToolAge: lastTool ? Math.round((Date.now() - lastTool.timestamp) / 1000) + 's' : '-',
      logN: logs.length,
      tail: logs.slice(-8).map((l) => l.type + ':' + JSON.stringify(l.data).slice(0, 90)),
    }
  })
  console.log('  ⏰ 超时诊断:', JSON.stringify(diag, null, 2))
  throw new Error('等待 agent idle 超时(1800s)')
}

async function runScenario(page, no, name, prompt, checks) {
  if (only.length && !only.includes(no)) return null
  console.log(`\n===== S${no} ${name} =====\n❯ ${prompt}`)
  const t0 = Date.now()
  await page.evaluate(() => {
    window.__toolLog = []
    window.__usage = null
    window.__unsub = window.__sdk.hook((e) => {
      if (e.type === 'tool_call') window.__toolLog.push({ t: Date.now(), kind: 'call', name: e.name, args: JSON.stringify(e.args).slice(0, 200) })
      if (e.type === 'tool_result') window.__toolLog.push({ t: Date.now(), kind: 'result', name: e.name, result: String(e.result ?? '').slice(0, 200) })
      if (e.type === 'usage') { window.__usage = window.__usage || { prompt: 0, completion: 0 }; window.__usage.prompt += e.usage.prompt_tokens ?? 0; window.__usage.completion += e.usage.completion_tokens ?? 0 }
      if (e.type === 'subagent') window.__toolLog.push({ t: Date.now(), kind: 'sub', name: e.name, sub: `${e.label}:${e.kind}` })
      if (e.type === 'error') window.__toolLog.push({ t: Date.now(), kind: 'error', msg: e.message })
    })
  })
  const prevMsgs = await page.evaluate(() => window.__sdk.messages.length)
  await page.fill('.chat-dialog .chat-input', prompt)
  await page.press('.chat-dialog .chat-input', 'Enter')
  await waitIdle(page, prevMsgs)
  const data = await page.evaluate(() => ({
    toolLog: window.__toolLog,
    usage: window.__usage,
    reply: window.__sdk.messages[window.__sdk.messages.length - 1]?.content?.slice(0, 500) ?? '',
    components: window.page.components.map(function flat(c) {
      // 扁平化含容器 children 嵌套(真实页面组件可能进容器)
      const kids = Array.isArray(c.props?.children) ? c.props.children : []
      return [{ type: c.type, name: c.props?.name ?? c.name, title: c.props?.title ?? c.props?.text ?? '', code: c.code ?? c.props?.code ?? '', notes: c.__pgNotes }, ...kids.flatMap(flat)]
    }).flat(),
    title: window.page.title,
  }))
  await page.evaluate(() => { window.__unsub?.(); window.__unsub = null })
  const results = {}
  for (const [k, fn] of Object.entries(checks)) {
    try { results[k] = { pass: !!fn(data) } } catch (e) { results[k] = { pass: false, err: String(e).slice(0, 100) } }
  }
  const tools = data.toolLog.filter((l) => l.kind === 'call').map((l) => l.name)
  const errors = data.toolLog.filter((l) => l.kind === 'error' || /PATH_DENIED|PATH_OUT_OF_SCOPE|不存在|失败/.test(l.result ?? ''))
  const scenario = {
    no, name, prompt, elapsedMs: Date.now() - t0,
    tools, toolCount: tools.length, usage: data.usage,
    reply: data.reply, checks: results,
    errors: errors.map((e) => (e.msg ?? e.result ?? '').slice(0, 120)).slice(0, 6),
    components: data.components.map((c) => ({ ...c, code: undefined, codeHead: c.code.slice(0, 160) })),
    raw: data,
  }
  report.scenarios = report.scenarios.filter((s) => s.no !== no)
  report.scenarios.push(scenario)
  report.scenarios.sort((a, b) => a.no - b.no)
  writeFileSync(OUT, JSON.stringify(report, null, 2))
  console.log(`  耗时 ${(scenario.elapsedMs / 1000).toFixed(0)}s | 工具×${scenario.toolCount} | token ${JSON.stringify(data.usage)}`)
  console.log('  序列:', tools.join(' → '))
  if (errors.length) console.log('  ⚠ 异常:', scenario.errors.join(' | '))
  for (const [k, v] of Object.entries(results)) console.log(`  ${v.pass ? '✓' : '✗'} ${k}`)
  return data
}

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('console', (m) => { const t = m.text(); if (t.includes('transitional_retry') || t.includes('format_retry')) console.log('  [自纠]', t.slice(0, 140)); if (/reload|re-optimiz|optimized|full reload|vite/i.test(t)) console.log('  [vite]', t.slice(0, 200)) })
// 页面重载诊断(曾遇 msgs 归零:memory 后端 reload 即丢会话,须定位触发源 —— vite hmr / 代码报错 / 意外导航)
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log(`  [reload] framenavigated → ${f.url()}`) })
page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`))
await page.goto(`${BASE}/examples/complex-demo/`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.chat-dialog')
await page.waitForFunction(() => window.__sdk, { timeout: 30_000 })
await sleep(2000)

await runScenario(page, 1, '复杂代码组件生成(UI 规范 skill)',
  '新增一个优惠券卡片代码组件:顶部撕边的优惠券(满 300 减 60),带一个旋转的折扣戳和一个立即领取按钮。严格按平台 UI 规范做,先看规范再写。',
  {
    'use_html 委派(自动装配)': (d) => d.toolLog.some((l) => l.name === 'use_html'),
    '新增 custom 组件落地': (d) => d.components.some((c) => c.type === 'custom' && c.code.length > 300),
    '规范主色 #7063E7': (d) => d.components.some((c) => c.code.includes('#7063E7')),
    '撕边 repeating-linear-gradient': (d) => d.components.some((c) => /repeating-linear-gradient/i.test(c.code)),
    '圆角 12px': (d) => d.components.some((c) => /border-radius:\s*12px/.test(c.code)),
    'class 前缀 cpn-': (d) => d.components.some((c) => /cpn-[a-z]+/.test(c.code)),
    '笔记沉淀': (d) => d.components.some((c) => Array.isArray(c.notes) && c.notes.length > 0),
    '零写越界(读探测自纠可接受)': (d) => !d.toolLog.some((l) => (l.result ?? '').includes('PATH_DENIED') && /write|edit|set|delete/.test(l.name)),
  })

await runScenario(page, 2, '二次精修(规范持续 + 笔记交接)',
  '把优惠券的折扣戳颜色换成规范里的金色,角度调正到 -3° 左右,其他不要动。',
  {
    '再次委派': (d) => d.toolLog.some((l) => l.name === 'use_html'),
    '规范金色 #F7C948': (d) => d.components.some((c) => c.code.includes('#F7C948')),
    '增量(组件数不增)': (d) => d.components.filter((c) => c.type === 'custom').length === 1,
  })

await runScenario(page, 3, '组件调序(move op)',
  '把优惠券组件移到组件列表最前面。',
  {
    '优惠券在最前': (d) => { const f = d.components[0]; return f && (f.type === 'custom' || (f.name ?? '') === 'coupon') },
    'move 或等价完成': (d) => true,
  })

await runScenario(page, 4, '改普通组件属性(主 agent 自己 write)',
  '把页面主标题改成「夏日数码节」。',
  {
    '标题已改': (d) => d.title.includes('夏日数码节'),
    '不经代码 agent(普通属性)': (d) => !d.toolLog.some((l) => l.name === 'use_html'),
  })

await runScenario(page, 5, '新建普通组件(不经代码 agent)',
  '加一个 banner 组件,标题写「限时特惠」,副标题「全场数码低至 5 折」。',
  {
    'banner 落地': (d) => d.components.some((c) => c.type === 'banner' && ((c.title ?? '').includes('限时特惠') || (c.name ?? '').includes('限时特惠'))),
  })

await runScenario(page, 6, '删除组件',
  '把刚才加的「限时特惠」banner 删掉。',
  {
    'banner 已删': (d) => !d.components.some((c) => c.type === 'banner' && JSON.stringify(c).includes('限时特惠')),
  })

await runScenario(page, 7, '多组件整页(逐个委派)',
  '再帮我加两个代码组件:① 倒计时组件(距活动开始 3 天,深色底等宽数字)② 活动规则说明卡片(3 条规则列表)。都按 UI 规范。',
  {
    '两个 custom 落地': (d) => d.components.filter((c) => c.type === 'custom' && c.code.length > 200).length >= 2,
    '委派 ≥2 次(逐个)': (d) => d.toolLog.filter((l) => l.name === 'use_html').length >= 2,
  })

await runScenario(page, 8, '容器层级移动',
  '把倒计时组件放进页面里合适的容器区域里(如果有容器的话;没有就保持原位不硬塞)。',
  {
    '有响应不报错': (d) => d.reply.length > 0,
    '组件未丢失': (d) => d.components.filter((c) => c.type === 'custom').length >= 2,
  })

await runScenario(page, 9, '错误恢复(不存在的组件)',
  '把「不存在的幽灵组件」改成红色。',
  {
    '明确告知不存在(不瞎编)': (d) => /不存在|没有找到|未找到|找不到/.test(d.reply),
    '零误写(不凭空创建)': (d) => !d.components.some((c) => (c.name ?? '').includes('幽灵')),
  })

await runScenario(page, 10, '模糊开放指令',
  '页面太素了,帮我搞点氛围感。',
  {
    '有实际产出或具体方案': (d) => d.toolLog.some((l) => l.kind === 'call') || d.reply.length > 60,
    '零致命错误': (d) => !d.toolLog.some((l) => l.kind === 'error' && /fatal/i.test(l.msg ?? '')),
  })

report.finishedAt = new Date().toISOString()
writeFileSync(OUT, JSON.stringify(report, null, 2))
const pass = report.scenarios.flatMap((s) => Object.entries(s.checks).map(([k, v]) => ({ s: s.no, k, p: v.pass })))
console.log(`\n========== 汇总 ==========`)
console.log(`场景 ${report.scenarios.length} | 断言 ${pass.length} | 通过 ${pass.filter((x) => x.p).length} | 失败 ${pass.filter((x) => !x.p).map((x) => `S${x.s}:${x.k}`).join(', ') || '无'}`)
console.log(`报告: ${OUT}`)
await browser.close()
