/**
 * section-orchestrator initialPage 双臂真 LLM 实测(deepseek v4 flash)
 *
 * 对应 deferred「section-orchestrator:真 LLM initialPage 双臂 + 阈值标定」:
 *  A 臂 grind:fixture ?arm=grind(零委派能力)→ flash 硬干全量填充 —— 采集轮次/token/完成率基线
 *  B 臂 nudge:fixture ?arm=nudge(默认全开)→ 触达 ≥12 时 nudge advisory + 编排段注入,
 *              观察 flash 对 advisory 的分流裁决(委派 spawn_agent vs 继续单干)
 * 双臂同 prompt(16 个骨架板块全量填充)、同 fixture(无 code 字段 schema 副本防干扰)。
 *
 * 指标:轮次 / prompt+completion token / 完成率(非骨架板块占比)/ 触达组件数 / nudge 触发 / 委派数 /
 *       S1 段规格四要素齐格式抽检(jsonPath/目标/共享 tokens/验收标准 —— spawn task 文本)
 * 阈值标定:DELEGATE_NUDGE_THRESHOLD=12 初值,据双臂数据裁决(只升不降)。
 *
 * 用法:node tests/runtime/section-orchestrator-real-llm.mjs [grind|nudge](过滤臂;dev server 需在 3000)
 * 报告:local/_real-llm-section.json(断点续跑按臂合并)
 */
import { launchBrowser, openDemoPage, sendPrompt, waitIdle, installEventHook, loadReport, resolveRunEnv, hasEnvKey, skipSuite, ROOT } from './_real-llm-lib.mjs'
import { writeFileSync } from 'node:fs'

const { BASE, OUT } = resolveRunEnv({ outDefault: 'local/_real-llm-section.json' })
const only = process.argv.slice(2).filter((a) => a === 'grind' || a === 'nudge')
if (!hasEnvKey(/VITE_AI_API_KEY/)) { skipSuite('no key'); process.exit(0) }

const report = loadReport(OUT, [])

/** 双臂同任务:全量填充 16 个现有骨架板块(触达主形态;每板块 name/kind/summary/tags 四字段) */
const PROMPT =
  '把全部 16 个骨架板块填充成 618 大促的真实运营内容:每个板块起一个有吸引力的中文名、按用途选合适的 kind、写 20-40 字的 summary、配 3-5 个 tags。16 个板块都要改,完成后汇报每个板块的完成情况。'

async function collect(page) {
  return page.evaluate(() => {
    const logs = window.__toolLog ?? []
    const bind = window.__page
    const debugLogs = window.__sdk?.debugLogs?.value ?? []
    const rounds = debugLogs.map((l) => l?.data?.round).filter((r) => typeof r === 'number')
    return {
      toolLog: logs,
      writeArgs: logs
        .filter((l) => l.kind === 'call' && l.name === 'write')
        .map((l) => { try { return JSON.parse(l.args || '{}') } catch { return {} } }),
      spawnTasks: logs
        .filter((l) => l.kind === 'call' && /^spawn_agent/.test(l.name ?? ''))
        .map((l) => { try { return JSON.parse(l.args || '{}') } catch { return {} } }),
      usage: window.__usage ?? {},
      debugStages: debugLogs.map((l) => l.data?.stage).filter(Boolean),
      maxRound: rounds.length ? Math.max(...rounds) : 0,
      bind: {
        title: bind?.title,
        n: bind?.sections?.length ?? 0,
        sections: (bind?.sections ?? []).map((s) => ({
          id: s.id,
          filled: s.summary !== '待填充' && !/^板块\d+$/.test(s.name ?? ''),
        })),
      },
    }
  })
}

/** S1 段规格四要素抽检:spawn task 文本含 路径形态/目标/共享 tokens/验收标准 信号 */
function fourElements(spawnTasks) {
  const texts = spawnTasks.map((a) => String(a?.task ?? a?.prompt ?? '')).filter(Boolean)
  if (!texts.length) return { applicable: false, pass: true, detail: '(零委派,不适用)' }
  const hit = (re) => texts.some((t) => re.test(t))
  const checks = {
    路径形态: hit(/sections\.\d+|sections\[|jsonPath/i),
    目标: hit(/目标|改造成|填充|生成|完成/),
    共享tokens: hit(/tokens?|上下文|共享/),
    验收标准: hit(/验收|标准|完成情况|检查/),
  }
  const pass = Object.values(checks).every(Boolean)
  return { applicable: true, pass, detail: Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(',') || '四要素齐' }
}

const scenarios = [
  {
    no: 'grind', name: 'A 臂:flash 硬干(零委派能力)', url: `${BASE}/tests/runtime/fixtures/section-fixture.html?arm=grind`,
    checks: {
      零委派工具: (d) => !d.toolLog.some((l) => l.kind === 'call' && (/^spawn_agent/.test(l.name) || (l.name ?? '').startsWith('use_'))),
      零nudge装配: (d) => !d.debugStages.includes('delegate_nudge'),
      数据完好: (d) => d.bind.n === 16,
    },
  },
  {
    no: 'nudge', name: 'B 臂:nudge 分流(默认全开)', url: `${BASE}/tests/runtime/fixtures/section-fixture.html?arm=nudge`,
    checks: {
      // 触达 ≥12 且零委派 → nudge 必触发;已委派(spawn 抑制)或逐板块小步未达阈 → 不触发是正确行为
      nudge触发或已委派: (d) => {
        const touched = touchedScopes(d)
        const delegated = d.toolLog.some((l) => l.kind === 'call' && (/^spawn_agent/.test(l.name) || (l.name ?? '').startsWith('use_')))
        return delegated || touched < 12 || d.debugStages.includes('delegate_nudge') || d.toolLog.some((l) => l.kind === 'result' && String(l.result ?? '').includes('委派'))
      },
      数据完好: (d) => d.bind.n === 16,
    },
  },
]

/** invoke 内累计触达的现有板块数(write patches/patch 路径首段去重 + whole-set 取现有数组长度) */
function touchedScopes(d) {
  const scopes = new Set()
  let whole = 0
  for (const a of d.writeArgs) {
    if (Array.isArray(a?.patches)) {
      for (const p of a.patches) if (typeof p?.jsonPath === 'string') scopes.add(p.jsonPath.split('.').slice(0, 2).join('.'))
    } else if (a?.patch?.jsonPath) {
      scopes.add(a.patch.jsonPath.split('.').slice(0, 2).join('.'))
    } else if (a?.value !== undefined) {
      whole = Math.max(whole, 16)
    }
  }
  return Math.max(scopes.size, whole)
}

const browser = await launchBrowser()
for (const sc of scenarios) {
  if (only.length && !only.includes(sc.no)) continue
  console.log(`\n===== [${sc.no}] ${sc.name} =====\n❯ ${PROMPT}`)
  const page = await openDemoPage(browser, sc.url)
  const arm = await page.evaluate(() => window.__arm)
  const uninstall = await installEventHook(page)
  const t0 = Date.now()
  const prevMsgs = await page.evaluate(() => window.__sdk.messages.length)
  await sendPrompt(page, PROMPT)
  await waitIdle(page, prevMsgs, { timeoutMs: 900_000 })
  const data = await collect(page)
  await uninstall()
  await page.close()

  const tools = data.toolLog.filter((l) => l.kind === 'call').map((l) => l.name)
  const delegated = tools.some((t) => /^spawn_agent/.test(t) || (t ?? '').startsWith('use_'))
  const filled = data.bind.sections.filter((s) => s.filled).length
  const touched = touchedScopes(data)
  const s1 = fourElements(data.spawnTasks)

  const results = {}
  for (const [k, fn] of Object.entries(sc.checks)) {
    try { results[k] = { pass: !!fn(data) } } catch (e) { results[k] = { pass: false, err: String(e).slice(0, 80) } }
  }
  results['S1段规格四要素'] = { pass: s1.pass, note: s1.detail }

  const rec = {
    no: sc.no, name: sc.name, arm, prompt: PROMPT,
    tools, toolCount: tools.length, maxRound: data.maxRound, usage: data.usage,
    filled, total: data.bind.n, completionRate: `${filled}/${data.bind.n}`,
    touchedScopes: touched, delegated, spawnCount: data.spawnTasks.length,
    nudged: data.debugStages.includes('delegate_nudge'),
    renderLikeStages: [], s1, results, elapsed: Math.round((Date.now() - t0) / 1000),
  }
  const exist = report.scenarios.findIndex((s) => s.no === sc.no)
  if (exist >= 0) report.scenarios[exist] = rec; else report.scenarios.push(rec)

  const passN = Object.values(results).filter((r) => r.pass).length
  console.log(`  工具链(${tools.length}): ${tools.join(' → ').slice(0, 240)}`)
  console.log(`  轮次 ${data.maxRound} | token prompt=${data.usage.prompt ?? 0} completion=${data.usage.completion ?? 0} | 完成率 ${filled}/${data.bind.n} | 触达 ${touched} | nudge=${rec.nudged} 委派=${delegated}(${data.spawnTasks.length}) | ${rec.elapsed}s`)
  console.log(`  检查: ${passN}/${Object.keys(results).length} ${passN === Object.keys(results).length ? '✅' : '❌ ' + Object.entries(results).filter(([, r]) => !r.pass).map(([k]) => k).join(',')}`)
  writeFileSync(OUT, JSON.stringify(report, null, 2))
}
await browser.close()
console.log(`\n==== 双臂汇总(阈值标定素材)====`)
for (const s of report.scenarios) {
  console.log(`  ${s.no}: 完成率 ${s.completionRate} | 轮次 ${s.maxRound} | prompt ${s.usage?.prompt ?? '?'} | toolCount ${s.toolCount} | nudge ${s.nudged} | 委派 ${s.delegated}`)
}
console.log(`报告: ${OUT}`)
process.exit(0)
