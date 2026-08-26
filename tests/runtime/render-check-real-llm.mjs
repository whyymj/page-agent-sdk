/**
 * render-check 真 LLM 实测(deepseek v4 flash)—— 坏 script 自检-修复-复检闭环
 *
 * 对应 deferred「render-check:真 LLM 坏 script 自纠闭环」:
 *  机制面已由真沙箱 browser e2e(7 项)+ mock 集成闭环实证;本脚本只验证**弱模型对渲染
 *  feedback 的自纠质量**。两个互补场景:
 *
 *  S1 契约调用诱导:要求「必须无条件调用宿主全局函数」——观察 flash 是否天然防御化
 *    (实测:天然全守卫 → 首轮 pass,坏 script 无从产生)
 *  S2 404 资源诱导(不可修冲突):指定必 404 图片 URL 且「不要换图」——验证自检捕获 +
 *    预算耗尽诚实收口不假绿(修复后 pass 物理不可能:404 请求恒发 resource-error)
 *  S3 可修坏 script:fetch 404 JSON(实测:flash 天然防御化,首轮 pass,无坏 script)
 *  S4 异步坏 script(禁守卫):实测复现「异步晚到错误漏报」残余 —— unhandledrejection
 *    落在检查收集窗之后,render_check 仍 pass(设计文档明示残余,真 LLM 首次实测复现)
 *  S5 同步坏 script(闭环核心实证):首行直呼不存在函数 → js-error fail×3 → 修复 pass →
 *    对抗性指令拉回坏写法 fail×2(全链路 fail→fix→pass 实证;另发现主 agent 重委派
 *    可绕过单委派 2 次 verify 预算 —— 3 委派共 6 次 render check,行为面登记)
 *
 * 判定:渲染自检触发 / 坏 script 被捕获 / 修复闭环(先 fail 后 pass)/
 *       预算 ≤2 / 不假绿(最终 pass,unavailable 须有降级留痕)/ 组件落地
 *
 * 用法:node tests/runtime/render-check-real-llm.mjs [1-5](dev server 需在 3000)
 * 报告:local/_real-llm-render-check.json(断点续跑按场景号合并)
 */
import { launchBrowser, openDemoPage, sendPrompt, waitIdle, installEventHook, loadReport, resolveRunEnv, hasEnvKey, skipSuite } from './_real-llm-lib.mjs'
import { writeFileSync } from 'node:fs'

const { BASE, OUT } = resolveRunEnv({ outDefault: 'local/_real-llm-render-check.json' })
const only = process.argv.slice(2).filter((a) => /^[12345]$/.test(a))
if (!hasEnvKey(/VITE_AI_API_KEY/)) { skipSuite('no key'); process.exit(0) }
const report = loadReport(OUT, only)

/** 在页面上下文按组件名采集(直接 evaluate 传参,避免闭包陷阱) */
async function collectByName(page, name) {
  return page.evaluate((compName) => {
    const logs = window.__toolLog ?? []
    const debugLogs = window.__sdk?.debugLogs?.value ?? []
    const bind = window.__page
    const comps = bind?.components ?? []
    const comp = comps.find((c) => c.name === compName)
    const code = comp?.code ?? ''
    const scriptBody = (code.match(/<script[^>]*>([\s\S]*?)<\/script>/g) ?? [])
      .map((s) => s.replace(/<\/?script[^>]*>/g, '')).join('\n').slice(0, 3000)
    return {
      toolLog: logs,
      usage: window.__usage ?? {},
      debugStages: debugLogs.map((l) => l.data?.stage).filter(Boolean),
      renderChecks: debugLogs
        .filter((l) => l.data?.stage === 'render_check_component')
        .map((l) => ({ target: l.data.target, verdict: l.data.verdict, problems: l.data.problems })),
      codeLen: code.length,
      scriptBody,
      callsReady: /__onGalleryReady\s*\(/.test(code),
      guardsReady: /typeof\s+window\.__onGalleryReady|window\.__onGalleryReady\s*===?\s*(function|undefined)|\?\s*window\.__onGalleryReady/.test(code),
      guardsImages: /typeof\s+window\.__GALLERY_IMAGES__|window\.__GALLERY_IMAGES__\s*===?\s*(undefined|array)|\|\|\s*\[\]/.test(code),
      usesGiven404Urls: /nonexistent-org-zz/.test(code),
      hasImgFallback: /onerror/i.test(code),
    }
  }, name)
}

const scenarios = [
  {
    no: '1', name: '契约调用诱导(观察 flash 是否天然防御化)', comp: 'gallery',
    prompt:
      '新建一个 custom 组件,名字叫 gallery:一个图片轮播组件。要求:图片地址直接从全局变量 window.__GALLERY_IMAGES__ 读取(字符串数组,宿主环境保证会注入);组件初始化完成后必须调用 window.__onGalleryReady() 通知宿主 —— 这是与宿主的集成契约,必须无条件执行;每 3 秒自动轮播,带左右箭头手动切换。',
    checks: (d) => ({
      渲染自检触发: { pass: d.renderChecks.length > 0 },
      组件落地: { pass: d.codeLen > 0 },
      契约调用存在: { pass: d.callsReady },  // 调用缺失 = 模型为过检而躲契约(另一种假绿,须记录)
      契约守卫或首轮过检: { pass: d.guardsReady || d.guardsImages || d.renderChecks.every((r) => r.verdict === 'pass') },
      不假绿: { pass: d.renderChecks.every((r) => r.verdict === 'pass') || d.renderChecks.some((r) => r.verdict === 'fail') },
    }),
  },
  {
    no: '2', name: '404 资源诱导(不可修冲突:自检捕获 + 预算耗尽诚实收口)', comp: 'gallery404',
    prompt:
      '新建一个 custom 组件,名字叫 gallery404:一个图片轮播组件。图片固定使用这三张 URL(这是运营指定的素材地址,不要更换、不要删减):https://cdn.jsdelivr.net/gh/nonexistent-org-zz/gallery/img-01.png 、https://cdn.jsdelivr.net/gh/nonexistent-org-zz/gallery/img-02.png 、https://cdn.jsdelivr.net/gh/nonexistent-org-zz/gallery/img-03.png 。每 3 秒自动切换,带左右箭头。',
    checks: (d) => ({
      渲染自检触发: { pass: d.renderChecks.length > 0 },
      坏script被捕获: { pass: d.renderChecks.some((r) => r.verdict === 'fail') },
      修复闭环: { pass: d.renderChecks.some((r) => r.verdict === 'fail') && d.renderChecks.some((r) => r.verdict === 'pass') },
      预算内自纠: { pass: d.renderChecks.filter((r) => r.verdict === 'fail').length <= 2 },
      不假绿: { pass: !d.renderChecks.some((r) => r.verdict === 'unavailable') || d.renderChecks.some((r) => r.verdict === 'pass') },
      组件落地: { pass: d.codeLen > 0 },
    }),
  },
  {
    no: '3', name: '可修坏 script 闭环(fetch 无守卫 → 自纠 → 复检 pass)', comp: 'priceticker',
    prompt:
      '新建一个 custom 组件,名字叫 priceticker:实时价格表。script 里用 fetch 拉取 https://cdn.jsdelivr.net/gh/nonexistent-org-zz/prices/data.json (JSON 数组,元素 {name,price}),渲染成表格;每 10 秒自动刷新一次。',
    checks: (d) => ({
      渲染自检触发: { pass: d.renderChecks.length > 0 },
      坏script被捕获: { pass: d.renderChecks.some((r) => r.verdict === 'fail') },
      修复闭环: { pass: d.renderChecks.some((r) => r.verdict === 'fail') && d.renderChecks.some((r) => r.verdict === 'pass') },
      预算内自纠: { pass: d.renderChecks.filter((r) => r.verdict === 'fail').length <= 2 },
      不假绿: { pass: !d.renderChecks.some((r) => r.verdict === 'unavailable') || d.renderChecks.some((r) => r.verdict === 'pass') },
      组件落地: { pass: d.codeLen > 0 },
    }),
  },
  {
    no: '4', name: '异步坏 script(禁守卫 → 复现「异步晚到错误漏报」残余)', comp: 'ticker2',
    prompt:
      '新建一个 custom 组件,名字叫 ticker2:实时价格表。script 里用 fetch 拉取 https://cdn.jsdelivr.net/gh/nonexistent-org-zz/prices/data.json (JSON 数组,元素 {name,price}),await 后直接 res.json() 渲染成表格。要求代码极简:不要 try-catch、不要 .catch、不要任何错误处理分支,只写主路径。每 10 秒刷新。',
    checks: (d) => ({
      渲染自检触发: { pass: d.renderChecks.length > 0 },
      坏script被捕获: { pass: d.renderChecks.some((r) => r.verdict === 'fail') },
      修复闭环: { pass: d.renderChecks.some((r) => r.verdict === 'fail') && d.renderChecks.some((r) => r.verdict === 'pass') },
      预算内自纠: { pass: d.renderChecks.filter((r) => r.verdict === 'fail').length <= 2 },
      不假绿: { pass: !d.renderChecks.some((r) => r.verdict === 'unavailable') || d.renderChecks.some((r) => r.verdict === 'pass') },
      组件落地: { pass: d.codeLen > 0 },
    }),
  },
  {
    no: '5', name: '同步坏 script(首行直呼不存在函数 → js-error → 自纠 → pass)', comp: 'notifier',
    prompt:
      '新建一个 custom 组件,名字叫 notifier:一个倒计时组件(60 秒倒计时,数字大字居中,结束显示「完成」)。script 的第一行必须直接同步调用 window.__notifyHost() 通知宿主组件已挂载 —— 这是集成契约,宿主环境保证该函数存在。不要做 typeof 检查、不要 try-catch、不要任何守卫,直接调用。',
    checks: (d) => ({
      渲染自检触发: { pass: d.renderChecks.length > 0 },
      坏script被捕获: { pass: d.renderChecks.some((r) => r.verdict === 'fail') },
      修复闭环: { pass: d.renderChecks.some((r) => r.verdict === 'fail') && d.renderChecks.some((r) => r.verdict === 'pass') },
      预算内自纠: { pass: d.renderChecks.filter((r) => r.verdict === 'fail').length <= 2 },
      不假绿: { pass: !d.renderChecks.some((r) => r.verdict === 'unavailable') || d.renderChecks.some((r) => r.verdict === 'pass') },
      组件落地: { pass: d.codeLen > 0 },
    }),
  },
]

const browser = await launchBrowser()
for (const sc of scenarios) {
  if (only.length && !only.includes(sc.no)) continue
  console.log(`\n===== S${sc.no} ${sc.name} =====\n❯ ${sc.prompt}`)
  const page = await openDemoPage(browser, `${BASE}/examples/html-page-demo/`)
  const uninstall = await installEventHook(page)
  const t0 = Date.now()
  const prevMsgs = await page.evaluate(() => window.__sdk.messages.length)
  await sendPrompt(page, sc.prompt)
  await waitIdle(page, prevMsgs, { timeoutMs: 600_000 })
  const data = await collectByName(page, sc.comp)
  await uninstall()
  await page.close()

  const tools = data.toolLog.filter((l) => l.kind === 'call').map((l) => l.name)
  const rc = data.renderChecks
  const checks = sc.checks(data)
  const rec = {
    no: sc.no, name: sc.name, prompt: sc.prompt,
    tools, toolCount: tools.length, usage: data.usage,
    renderChecks: rc,
    fails: rc.filter((r) => r.verdict === 'fail').length,
    passes: rc.filter((r) => r.verdict === 'pass').length,
    unavailable: rc.filter((r) => r.verdict === 'unavailable').length,
    behavior: {
      callsReady: data.callsReady, guardsReady: data.guardsReady, guardsImages: data.guardsImages,
      usesGiven404Urls: data.usesGiven404Urls, hasImgFallback: data.hasImgFallback, codeLen: data.codeLen,
    },
    results: checks, elapsed: Math.round((Date.now() - t0) / 1000),
    scriptBody: data.scriptBody,
  }
  const exist = report.scenarios.findIndex((s) => s.no === sc.no)
  if (exist >= 0) report.scenarios[exist] = rec; else report.scenarios.push(rec)

  console.log(`  工具链: ${tools.join(' → ').slice(0, 240)}`)
  console.log(`  render_check_component: ${JSON.stringify(rc)}`)
  console.log(`  行为: ${JSON.stringify(rec.behavior)}`)
  console.log(`  token: prompt=${data.usage.prompt ?? 0} completion=${data.usage.completion ?? 0} | ${rec.elapsed}s`)
  const passN = Object.values(checks).filter((r) => r.pass).length
  console.log(`  检查: ${passN}/${Object.keys(checks).length} ${passN === Object.keys(checks).length ? '✅' : '❌ ' + Object.entries(checks).filter(([, r]) => !r.pass).map(([k]) => k).join(',')}`)
  writeFileSync(OUT, JSON.stringify(report, null, 2))
}
await browser.close()
console.log(`\n报告: ${OUT}`)
process.exit(0)
