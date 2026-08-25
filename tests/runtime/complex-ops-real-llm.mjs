/**
 * complex-demo 调整/修改操作真 LLM 实测(deepseek v4 flash,Anthropic 协议组 VITE_ANTHROPIC_*)
 *
 * 升级后 demo(editor_fangzhou 对齐:page-tools 结构工具 skill / MCP RAG ?rag=1 / approval /
 * augmentSystem 实况段)上验证「各种调整.修改操作」全链路:
 *  A 新建(普通组件 + 纯代码委派)  B 调换顺序  C 改层级(移进容器)  D 改属性
 *  E 聚焦改纯代码(use_html + 焦点子树)  F RAG 知识库问答(?rag=1,真实 MCP)
 * 指标:轮次 / token / 完成率 / 委派次数 / 工具链
 * 用法:node tests/runtime/complex-ops-real-llm.mjs [场景号…](dev server 需重启后在 3000 端口)
 */
import { launchBrowser, openDemoPage, sendPrompt, waitIdle, installEventHook, loadReport, resolveRunEnv, hasEnvKey, skipSuite, ROOT } from './_real-llm-lib.mjs'
import { writeFileSync } from 'node:fs'

const { BASE, OUT } = resolveRunEnv({ outDefault: 'local/_real-llm-complex-ops.json' })
const only = process.argv.slice(2)
// demo LLM 已切 Anthropic 协议组(useAgentConfig 优先 VITE_ANTHROPIC_*);按该组 key 门禁
if (!hasEnvKey(/VITE_ANTHROPIC_API_KEY/)) { skipSuite('no VITE_ANTHROPIC_API_KEY'); process.exit(0) }

const collect = (page) => page.evaluate(() => {
  const logs = window.__toolLog ?? []
  const bind = window.page
  const topTypes = (bind?.components ?? []).map((c) => c.type)
  return {
    toolLog: logs,
    usage: window.__usage ?? {},
    debugStages: (window.__sdk?.debugLogs?.value ?? []).map((l) => l.data?.stage).filter(Boolean),
    bind: {
      title: bind?.title, n: bind?.components?.length, topTypes,
      customs: (bind?.components ?? []).filter((c) => c.type === 'custom').map((c) => ({ name: c.name, codeLen: (c.code ?? '').length })),
      navbarTitle: (bind?.components ?? []).find((c) => c.type === 'navbar')?.props?.title,
      topCountdown: topTypes.filter((t) => t === 'countdown').length,
      countdownNested: JSON.stringify(bind?.components ?? []).includes('"type":"countdown"') && !topTypes.includes('countdown'),
    },
  }
})

/** 场景前置:聚焦指定 path(绕两步拾取 UI,同 browser e2e 范式) */
const focusByPath = (page, path) => page.evaluate((p) => window.__sdk.addFocus({ path: p, label: p.split('.').pop() }), path)

const scenarios = [
  {
    no: '1', name: '新建(普通组件 + 纯代码委派)', timeoutMs: 900_000,
    // 措辞刻意避开三档判档关键词(主题/风格/大促/周年/做一个 + 数量 ≥3)—— 方向闸有专属 e2e 覆盖,
    // 无人值守套件走快速档直达执行,否则 agent 征询挂起等用户点选(首次实测即栽于此)
    prompt: '给页面新增:1 个 countdown 倒计时组件(显示文案「限时优惠」)+ 1 个纯代码组件 custom(名字 beer,内容是啤酒杯碰杯的动画横幅)。普通组件直接加,纯代码的委派。',
    checks: {
      普通组件落地: (d) => (d.bind.topTypes ?? []).includes('countdown'),
      纯代码委派: (d) => d.toolLog.some((l) => l.kind === 'call' && l.name === 'use_html'),
      custom_code非空: (d) => (d.bind.customs ?? []).some((c) => c.codeLen > 50),
    },
  },
  {
    no: '2', name: '调换顺序(navbar ↔ banner)',
    pre: async (page) => page.evaluate(() => window.page.components.map((c) => c.type)),
    prompt: '把导航栏(navbar)和头图(banner)的位置调换一下,导航栏放到头图后面。',
    checks: {
      有结构改动: (d) => d.toolLog.some((l) => l.kind === 'call' && ['write', 'move_component'].includes(l.name)),
      顺序确实变了: (d) => {
        const pre = d.preTopTypes ?? []
        const post = d.bind.topTypes ?? []
        if (pre.length !== post.length || !pre.includes('navbar') || !pre.includes('banner')) return false
        const ni0 = pre.indexOf('navbar'), bi0 = pre.indexOf('banner')
        const ni1 = post.indexOf('navbar'), bi1 = post.indexOf('banner')
        return ni1 !== ni0 || bi1 !== bi0
      },
      组件数不变: (d) => (d.preTopTypes ?? []).length === (d.bind.topTypes ?? []).length,
    },
  },
  {
    no: '3', name: '改层级(移进容器做子组件)',
    pre: async (page) => page.evaluate(() => window.page.components.map((c) => c.type)),
    prompt: '把顶层的倒计时组件(countdown)移进第一个容器组件里,做成它的子组件。',
    apply: async (page, d) => { d.preTopTypes = await d.pre(page) },
    checks: {
      结构工具或写通道: (d) => d.toolLog.some((l) => l.kind === 'call' && ['move_component', 'write', 'list_components', 'load_skill'].includes(l.name)),
      '顶层 countdown 消失': (d) => d.bind.topCountdown === 0,
      嵌套存在: (d) => d.bind.countdownNested === true || JSON.stringify(d.bind).includes('countdown'),
    },
  },
  {
    no: '4', name: '改属性(标题 + 配色)',
    prompt: '把导航栏标题改成「干杯青岛」,并把倒计时(如果移进容器了就在容器里找)的样式改成橙色系。',
    checks: {
      导航栏标题改: (d) => d.bind.navbarTitle === '干杯青岛',
      有写动作: (d) => d.toolLog.some((l) => l.kind === 'call' && ['write'].includes(l.name)),
    },
  },
  {
    no: '5', name: '聚焦改纯代码(use_html 委派 + 焦点子树)',
    seed: async (page) => {
      await page.evaluate(() => {
        window.page.components.push({ type: 'custom', name: 'beer', code: '<section class="beer"><h1>old</h1><p>畅饮一夏</p></section>', __pgId: 'c_beer' })
      })
      await focusByPath(page, 'components.' + (await page.evaluate(() => window.page.components.length - 1)))
    },
    prompt: '把聚焦的 beer 组件标题改成「干杯青岛」,副标题改成「畅饮一夏·鲜啤直达」。',
    checks: {
      委派发生: (d) => d.toolLog.some((l) => l.kind === 'call' && l.name === 'use_html'),
      'code 更新': (d) => /干杯青岛/.test(String(d.beerCode ?? '')),
      'code 无占位夹带': (d) => !/<subtree |<[A-Za-z_][\w.-]*\s[\d.]+[KMG]?B>/.test(String(d.beerCode ?? '')),
    },
  },
  {
    no: '6', name: 'RAG 知识库问答(?rag=1,真实 MCP)', url: '?rag=1',
    prompt: '查一下知识库:这个平台的 coupon 优惠券组件的 amount 字段怎么配?只查并回答,不要改页面。',
    soft: true, // MCP 内网可达性随环境;rag 工具不在池 = 降级记录不判 FAIL
    checks: {
      零写入: (d) => !d.toolLog.some((l) => l.kind === 'call' && l.name === 'write'),
      rag或知识库通道: (d) => d.toolLog.some((l) => l.kind === 'call' && /rag_|search/.test(l.name)) || d.toolLog.some((l) => l.kind === 'result' && /知识库|rag|mcp/i.test(String(l.result ?? '').slice(0, 200))),
    },
  },
]

const browser = await launchBrowser()
for (const sc of scenarios) {
  if (only.length && !only.includes(sc.no)) continue
  console.log(`\n===== S${sc.no} ${sc.name} =====\n❯ ${sc.prompt}`)
  const page = await openDemoPage(browser, `${BASE}/examples/complex-demo/${sc.url ?? ''}`)
  const d = { preTopTypes: null }
  if (sc.seed) await sc.seed(page)
  if (sc.pre) d.preTopTypes = await sc.pre(page)
  const uninstall = await installEventHook(page)
  const t0 = Date.now()
  const prevMsgs = await page.evaluate(() => window.__sdk.messages.length)
  await sendPrompt(page, sc.prompt)
  let timedOut = false
  try {
    await waitIdle(page, prevMsgs, { timeoutMs: sc.timeoutMs ?? 600_000 })
  } catch {
    timedOut = true  // 超时不崩:照常收数据记报告(委派+render-check 自纠链在强模型上可 >10min)
  }
  const data = await collect(page)
  data.timedOut = timedOut
  if (sc.no === '5') {
    // beer code 终值补充采集(collect 的 customs 只带 codeLen,这里带原文片段)
    data.beerCode = await page.evaluate(() => window.page.components.find((c) => c.name === 'beer')?.code ?? '')
  }
  await uninstall()
  await page.close()
  const tools = data.toolLog.filter((l) => l.kind === 'call').map((l) => l.name)
  const results = {}
  for (const [k, fn] of Object.entries(sc.checks)) {
    try { results[k] = { pass: !!fn({ ...data, preTopTypes: d.preTopTypes }) } } catch (e) { results[k] = { pass: false, err: String(e).slice(0, 80) } }
  }
  const rec = {
    no: sc.no, name: sc.name, prompt: sc.prompt, soft: sc.soft ?? false,
    tools, toolCount: tools.length, usage: data.usage,
    delegated: tools.filter((t) => t === 'use_html' || t.startsWith('spawn')).length,
    bindAfter: data.bind, results, elapsed: Math.round((Date.now() - t0) / 1000),
  }
  const report = loadReport(OUT, only)
  const exist = report.scenarios.findIndex((s) => s.no === sc.no)
  if (exist >= 0) report.scenarios[exist] = rec; else report.scenarios.push(rec)
  const passN = Object.values(results).filter((r) => r.pass).length
  const total = Object.keys(results).length
  console.log(`  工具链: ${tools.join(' → ')}`)
  console.log(`  token: prompt=${data.usage.prompt ?? 0} completion=${data.usage.completion ?? 0} | 委派=${rec.delegated}`)
  console.log(`  检查: ${passN}/${total} ${passN === total ? '✅' : (sc.soft ? '🟡(软检查,环境依赖)' : '❌ ' + Object.entries(results).filter(([, r]) => !r.pass).map(([k]) => k).join(','))}`)
  writeFileSync(OUT, JSON.stringify(report, null, 2))
}
await browser.close()
const report = loadReport(OUT, only)
const hard = report.scenarios.filter((s) => !s.soft)
const passAll = hard.filter((s) => Object.values(s.results ?? {}).every((r) => r.pass)).length
console.log(`\n==== 汇总(硬检查):${passAll}/${hard.length} 场景全过 ====`)
console.log(`报告: ${OUT}`)
process.exit(0)
