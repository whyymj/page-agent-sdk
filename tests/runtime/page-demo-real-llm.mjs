/**
 * 真 LLM 嵌套场景回归(page-demo,Playwright 浏览器路径)—— 瀑布流/轮播/卡片嵌套 + 纯代码组件
 *
 * 与 tests/runtime/uispec-real-llm.mjs(complex-demo UI 规范)互补:本脚本覆盖 page-demo 的
 * 嵌套容器(card/carousel/waterfall children)+ 自动装配 html 子 agent + fix-silent-strip 诚实性。
 *
 * 场景:
 *   S1 聚焦嵌套组件(两步拾取 UI + 对话精修)   S2 层级调整(顶层列表 → 瀑布卡片 B children)
 *   S3 嵌套属性修改(轮播第 2 页卡片标题)      S4 纯代码组件(自动装配 use_html 委派)
 *   S5 诚实拒绝(button 无 style 字段 → SCHEMA_STRIP 回灌,不假成功)
 *   S6 嵌套新建(组合卡片 children 追加图片)
 *
 * 方法论(idle 判定 / 跑前重启 dev server / 断点续跑)见 doc/real-llm-regression.md。
 * 用法:node tests/runtime/page-demo-real-llm.mjs [场景号…];输出 _real-llm-page.json(gitignore)
 * 环境变量:PDEMO_BASE(默认 http://localhost:3000)/ PDEMO_OUT;无 VITE_AI_API_KEY 自动 skip。
 */
import { chromium } from 'playwright'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const BASE = process.env.PDEMO_BASE || 'http://localhost:3000'
const OUT = resolve(ROOT, process.env.PDEMO_OUT || '_real-llm-page.json')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const only = process.argv.slice(2).map(Number).filter(Boolean)

const hasKey = (() => {
  if (!existsSync(resolve(ROOT, '.env'))) return false
  return /^VITE_AI_API_KEY=.+/m.test(readFileSync(resolve(ROOT, '.env'), 'utf8'))
})()
if (!hasKey) {
  console.log('⚠ skip:.env 缺 VITE_AI_API_KEY(真 LLM 回归需要真 key)')
  process.exit(0)
}

const report = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { startedAt: new Date().toISOString(), scenarios: [] }
report.scenarios = report.scenarios.filter((s) => !only.length || only.includes(s.no))

/** idle 双条件:debugLogs 静默 >90s ×3 采样 + 活动子 agent = 0(子 reasoning 不打日志,单看日志会误判) */
async function waitIdle(page, prevMsgCount, timeoutMs = 1800_000) {
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
    // 页面 reload 快速失败:debugLogs 清零 → lastTs=0 → quietMs 为 epoch 毫秒(>1e12)。
    // 修前此状态空等满 30min 超时(vite HMR ws 瞬断 → 页面自 reload → window.__sdk 重建,实测 S5 烧 30min)
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
  throw new Error('等待 agent idle 超时(1800s)')
}

async function runScenario(page, no, name, prompt, checks, opts = {}) {
  if (only.length && !only.includes(no)) return null
  console.log(`\n===== S${no} ${name} =====\n❯ ${prompt}`)
  const t0 = Date.now()
  await page.evaluate(() => {
    window.__toolLog = []
    window.__usage = null
    window.__unsub = window.__sdk.hook((e) => {
      if (e.type === 'tool_call') window.__toolLog.push({ t: Date.now(), kind: 'call', name: e.name, args: JSON.stringify(e.args).slice(0, 200) })
      if (e.type === 'tool_result') window.__toolLog.push({ t: Date.now(), kind: 'result', name: e.name, result: String(e.result ?? '').slice(0, 300) })
      if (e.type === 'usage') { window.__usage = window.__usage || { prompt: 0, completion: 0 }; window.__usage.prompt += e.usage.prompt_tokens ?? 0; window.__usage.completion += e.usage.completion_tokens ?? 0 }
      if (e.type === 'subagent') window.__toolLog.push({ t: Date.now(), kind: 'sub', name: e.name, sub: `${e.label}:${e.kind}` })
      if (e.type === 'error') window.__toolLog.push({ t: Date.now(), kind: 'error', msg: e.message })
    })
  })
  // 前置交互(两步拾取聚焦等)
  if (opts.before) await opts.before(page)
  const prevMsgs = await page.evaluate(() => window.__sdk.messages.length)
  await page.fill('.chat-dialog .chat-input', prompt)
  await page.press('.chat-dialog .chat-input', 'Enter')
  await waitIdle(page, prevMsgs)
  const data = await page.evaluate(() => ({
    toolLog: window.__toolLog,
    usage: window.__usage,
    focused: window.__focusedChip ?? null,
    reply: window.__sdk.messages[window.__sdk.messages.length - 1]?.content?.slice(0, 600) ?? '',
    // page-demo 组件:字段在顶层(text/title/label/src/code),容器 children 嵌套
    components: window.page.components.map(function flat(c) {
      const kids = Array.isArray(c.children) ? c.children.flatMap(flat) : []
      return [{ type: c.type, title: c.title ?? c.text ?? c.label ?? '', src: c.src ?? '', code: c.code ?? '', notes: c.__pgNotes }, ...kids]
    }).flat(),
    page: JSON.parse(JSON.stringify(window.page)),
  }))
  await page.evaluate(() => { window.__unsub?.(); window.__unsub = null })
  if (opts.after) await opts.after(page)
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
    errors: errors.map((e) => (e.msg ?? e.result ?? '').slice(0, 150)).slice(0, 6),
    components: data.components.map((c) => ({ ...c, code: undefined, codeHead: c.code.slice(0, 160) })),
    raw: { ...data, page: undefined },
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
page.on('console', (m) => { const t = m.text(); if (/reload|re-optimiz|optimized|full reload|vite/i.test(t)) console.log('  [vite]', t.slice(0, 200)) })
page.on('framenavigated', (f) => { if (f === page.mainFrame()) console.log(`  [reload] framenavigated → ${f.url()}`) })
page.on('pageerror', (e) => console.log(`  [pageerror] ${String(e).slice(0, 200)}`))
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.chat-dialog')
await page.waitForFunction(() => window.__sdk, { timeout: 30_000 })
await sleep(2000)
// 新建会话清历史(page-demo storage:'indexed',历史会污染上下文;失败不阻塞 —— 无历史时按钮行为一致)
try { await page.click('button:has-text("新建会话")'); await sleep(1500) } catch { /* 无历史/按钮路径变化可容忍 */ }

// ---------- S1 聚焦嵌套组件(UI 两步拾取 + 对话精修) ----------
await runScenario(page, 1, '聚焦嵌套组件(两步拾取 → 卡片内段落精修)',
  '把聚焦的这个段落的文案,改成「卡片内文案已按需求精修」。',
  {
    '聚焦 chip 命中嵌套路径': (d) => (d.focused ?? '').includes('components.4.children.0'),
    '嵌套段落文案已改': (d) => d.page.components[4].children[0].text.includes('精修'),
    '聚焦内写零 PATH_DENIED': (d) => !d.toolLog.some((l) => (l.result ?? '').includes('PATH_DENIED') && /write|edit|set/.test(l.name)),
  },
  {
    before: async (p) => {
      await p.click('[data-path="components.4.children.0"]')
      await p.click('.pick-overlay__btn')
      await p.waitForSelector('.focus-chip')
      // 采集 chip 文本供 checks 断言(getSchemaAtPath union 下探 → 嵌套路径可聚焦)
      await p.evaluate(() => { window.__focusedChip = document.querySelector('.focus-chip')?.textContent ?? '' })
    },
    after: async (p) => {
      await p.evaluate(() => { window.__focusedChip = null })
      try { await p.click('[data-test="focus-clear"]') } catch { /* 已清可容忍 */ }
    },
  })

// ---------- S2 层级调整 ----------
await runScenario(page, 2, '层级调整(顶层列表 → 瀑布卡片 B 子组件)',
  '把页面底部「需求收集」开头的那个列表组件,移进瀑布流里的「瀑布卡片 B」中,作为它的子组件,顶层不要再留这个列表。',
  {
    '列表进卡片 B children': (d) => {
      const cardB = d.page.components[5]?.children?.find((c) => c.title === '瀑布卡片 B')
      return cardB?.children?.some((k) => k.type === 'list' && k.items?.[0] === '需求收集')
    },
    '顶层不再有该列表': (d) => !d.page.components.some((c) => c.type === 'list' && c.items?.[0] === '需求收集'),
    '组件未丢失(总数守恒)': (d) => d.page.components.length === 7,
  })

// ---------- S3 嵌套属性修改 ----------
await runScenario(page, 3, '嵌套属性(轮播第 2 页卡片标题)',
  '把轮播第 2 页的卡片标题改成「热门推荐」,其他都不要动。',
  {
    '第 2 页标题已改': (d) => d.page.components[6]?.children?.[1]?.title === '热门推荐',
    '第 1 页未动': (d) => d.page.components[6]?.children?.[0]?.title === '轮播第 1 页',
    '增量 patch(非整体重传)': (d) => d.toolLog.some((l) => l.name === 'write' && /jsonPath/.test(l.args) && /components\.6/.test(l.args)),
  })

// ---------- S4 纯代码组件(自动装配 use_html) ----------
await runScenario(page, 4, '纯代码组件(委派生成)',
  '在页面最下面加一个纯代码组件:促销倒计时,深色底、大的等宽数字,写「距结束 02:00:00」。',
  {
    'use_html 委派(自动装配)': (d) => d.toolLog.some((l) => l.name === 'use_html'),
    'custom 组件落地': (d) => {
      const last = d.page.components.at(-1)
      return last?.type === 'custom' && last.code.length > 200
    },
    '内容含倒计时': (d) => (d.page.components.at(-1)?.code ?? '').includes('02:00:00'),
  })

// ---------- S5 诚实拒绝(SCHEMA_STRIP) ----------
await runScenario(page, 5, '诚实拒绝(button 无 style 字段)',
  '给「主要按钮」加一个红色边框。',
  {
    // 诚实路径两态皆可:① 直接如实说明(skill 指引先行规避,零试错写入,实测优选)② 硬写被 SCHEMA_STRIP 拒后自纠
    '先查再答(SCHEMA_STRIP 回灌或 skill/read 先行)': (d) =>
      d.toolLog.some((l) => (l.result ?? '').includes('SCHEMA_STRIP')) ||
      d.toolLog.slice(0, 3).some((l) => ['load_skill', 'read', 'search_data', 'schema_data'].includes(l.name)),
    '未假写 style 字段': (d) => d.page.components[2]?.style === undefined,
    '回复如实说明(不支持/改用 variant)': (d) => /不支持|没有.*字段|无法直接|variant|弱化|用.*变体/.test(d.reply),
  })

// ---------- S6 嵌套新建 ----------
await runScenario(page, 6, '嵌套新建(组合卡片 children 追加图片)',
  '在「组合卡片」里再加一个图片子组件,图片地址用 https://example.com/pic.png,替代文字写「配图」。',
  {
    '图片进组合卡片 children': (d) => {
      const card = d.page.components[4]
      return card?.children?.some((k) => k.type === 'image' && k.src === 'https://example.com/pic.png')
    },
    '原有子组件未丢': (d) => d.page.components[4]?.children?.some((k) => k.type === 'button' && k.label === '卡内按钮'),
  })

report.finishedAt = new Date().toISOString()
writeFileSync(OUT, JSON.stringify(report, null, 2))
const pass = report.scenarios.flatMap((s) => Object.entries(s.checks).map(([k, v]) => ({ s: s.no, k, p: v.pass })))
console.log(`\n========== 汇总 ==========`)
console.log(`场景 ${report.scenarios.length} | 断言 ${pass.length} | 通过 ${pass.filter((x) => x.p).length} | 失败 ${pass.filter((x) => !x.p).map((x) => `S${x.s}:${x.k}`).join(', ') || '无'}`)
console.log(`报告: ${OUT}`)
await browser.close()
