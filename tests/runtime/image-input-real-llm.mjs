/**
 * image-input 识图转述旁路真 LLM 实测(modelverse deepseek-v4-flash-vision-exp + 主模型 deepseek-v4-flash-sg)
 *
 * 对应 deferred「image-input 真 LLM 旁路三场景」:主模型纯文本 + images.describe 转述旁路 ——
 * describe 走 images-demo 的 anthropic 协议识图通道(VITE_VISION_MODEL / __VISION_CONFIG 运行时覆盖),
 * 图片本体不发给主模型,发送前逐图转述注入该轮 user 上下文。
 *
 * 三场景(各全新会话;图片由 Playwright 渲染 HTML 后截图产真实 PNG):
 *  S1 贴截图问组件:商品卡片截图 → 问主标题/价格 —— 验证转述注入 + 主模型答对图内事实
 *  S2 贴设计稿还原:banner 设计稿 → 要等价 HTML 代码块 —— 验证图→结构化产出(转述驱动)
 *  S3 OCR 问答:文字图 → 问图中优惠码 —— 验证文字转写精确到字符
 *
 * 判定:转述注入(user 消息 images[].description 非空)/ 答案含图中关键事实 / 主模型零工具纯答
 * 用法:node tests/runtime/image-input-real-llm.mjs [1|2|3](dev server 需在 3000)
 * 报告:local/_real-llm-image-input.json(断点续跑按场景号合并)
 */
import { launchBrowser, openDemoPage, sendPrompt, waitIdle, installEventHook, loadReport, resolveRunEnv, hasEnvKey, skipSuite } from './_real-llm-lib.mjs'
import { writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const { BASE, OUT } = resolveRunEnv({ outDefault: 'local/_real-llm-image-input.json' })
const only = process.argv.slice(2).filter((a) => /^[123]$/.test(a))
if (!hasEnvKey(/VITE_ANTHROPIC_API_KEY/)) { skipSuite('no key'); process.exit(0) }
const report = loadReport(OUT, only)

// modelverse 凭据从 .env 读(node 侧;不落报告 —— 报告只存转述文本与答案)
function envOf(key) {
  const m = new RegExp(`^${key}=(.+)$`, 'm').exec(readFileSync(resolve(process.cwd(), '.env'), 'utf8') ?? '')
  return m ? m[1].split('#')[0].trim() : ''
}
const VISION_CFG = {
  // 走 vite 同源代理(浏览器直调 modelverse /v1/messages 因 CORS 失败;凭据经代理转发)
  baseUrl: `${BASE}/llm`,
  apiKey: envOf('VITE_ANTHROPIC_API_KEY'),
  model: envOf('VITE_VISION_MODEL') || 'deepseek-v4-flash-vision-exp',
}

/** 渲染 HTML 产真实 PNG 截图(独立空白页,无 demo 干扰) */
async function renderImage(browser, html, width = 640) {
  const page = await browser.newPage({ viewport: { width, height: 400 } })
  await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0;font-family:sans-serif">${html}</body>`)
  const buf = await page.screenshot()
  await page.close()
  return buf
}

const scenarios = [
  {
    no: '1', name: '贴截图问组件(转述注入 + 图内事实)',
    image: `<div style="width:400px;border:1px solid #ddd;border-radius:12px;padding:20px;background:#fff">
      <div style="font-size:22px;font-weight:700;color:#111">智能手表 Pro</div>
      <div style="color:#666;margin:8px 0">心率监测 · 14 天续航 · 5ATM 防水</div>
      <div style="color:#e02020;font-size:26px;font-weight:700">¥1299</div>
      <div style="color:#999;font-size:12px">限时直降 300 元</div>
    </div>`,
    prompt: '这张截图里是什么商品?主标题和价格分别是多少?',
    expect: (d) => /智能手表/.test(d.answer) && /1299/.test(d.answer),
  },
  {
    no: '2', name: '贴设计稿还原(图 → 结构化 HTML 产出)',
    image: `<div style="width:600px;background:#e02020;padding:40px 30px;text-align:center">
      <div style="color:#fff;font-size:36px;font-weight:800;letter-spacing:4px">618 全场 5 折起</div>
      <div style="color:#ffe0e0;margin:12px 0 24px">数码 · 家居 · 美妆 · 食品</div>
      <div style="display:inline-block;background:#fff;color:#e02020;font-weight:700;padding:12px 40px;border-radius:24px">立即抢购</div>
    </div>`,
    prompt: '按这张设计稿的文案与配色,输出一个可直接使用的自包含 HTML 代码块(含内联样式,文案保持一致)。',
    expect: (d) => /```html/.test(d.answer) && /618/.test(d.answer) && /5\s*折/.test(d.answer) && /立即抢购/.test(d.answer),
  },
  {
    no: '3', name: 'OCR 问答(优惠码字符级转写)',
    image: `<div style="width:520px;padding:28px;background:#f7f7f9;border-radius:12px;color:#222;font-size:18px;line-height:1.9">
      会员专属福利通知<br>
      专属优惠码:<b style="font-size:24px;letter-spacing:2px">SMZDM-8826</b><br>
      有效期至 6 月 18 日 23:59,每账号限用 1 次。
    </div>`,
    prompt: '图里的专属优惠码是什么?有效期到哪天?',
    expect: (d) => /SMZDM-8826/i.test(d.answer) && /6\s*月\s*18/.test(d.answer),
  },
]

const browser = await launchBrowser()
for (const sc of scenarios) {
  if (only.length && !only.includes(sc.no)) continue
  console.log(`\n===== S${sc.no} ${sc.name} =====\n❯ ${sc.prompt}`)
  const page = await openDemoPage(browser, `${BASE}/examples/images-demo/`)
  // 运行时注入识图配置(anthropic 通道;凭据不落报告)
  await page.evaluate((cfg) => { window.__VISION_CONFIG = cfg }, VISION_CFG)
  const buffer = await renderImage(browser, sc.image)
  await page.setInputFiles('[data-test="attach-input"]', { name: `scene-${sc.no}.png`, mimeType: 'image/png', buffer })
  const uninstall = await installEventHook(page)
  const t0 = Date.now()
  const prevMsgs = await page.evaluate(() => window.__sdk.messages.length)
  await sendPrompt(page, sc.prompt)
  // 桥接:识图旁路下 describe 在途时 debugLogs 恒空(lib 的 reload 快速失败会误杀)—— 先等首条日志出现
  // (describe 带 thinking 实测可达数十秒,给 120s;超时则照常进 waitIdle 走超时诊断 dump)
  await page.waitForFunction(() => (window.__sdk?.debugLogs?.value ?? []).length > 0, { timeout: 120_000 }).catch(() => {})
  await waitIdle(page, prevMsgs, { timeoutMs: 600_000 })
  const data = await page.evaluate(() => {
    const msgs = window.__sdk?.messages ?? []
    const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant')
    const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
    return {
      answer: String(lastAssistant?.content ?? ''),
      descriptions: (lastUser?.images ?? []).map((im) => String(im?.description ?? '')),
      imageCount: (lastUser?.images ?? []).length,
      tools: (window.__toolLog ?? []).filter((l) => l.kind === 'call').map((l) => l.name),
      usage: window.__usage ?? {},
    }
  })
  await uninstall()
  await page.close()

  const checks = {
    转述注入: { pass: data.imageCount > 0 && data.descriptions.some((d2) => d2.length > 10) },
    图内事实答案: { pass: false },  // 下面按 expect 填
    主模型纯答零工具: { pass: data.tools.length === 0 },
  }
  try { checks.图内事实答案.pass = !!sc.expect(data) } catch { checks.图内事实答案.pass = false }

  const rec = {
    no: sc.no, name: sc.name, prompt: sc.prompt,
    imageCount: data.imageCount, descriptionHead: (data.descriptions[0] ?? '').slice(0, 500),
    answerHead: data.answer.slice(0, 500), tools: data.tools, usage: data.usage,
    results: checks, elapsed: Math.round((Date.now() - t0) / 1000),
  }
  const exist = report.scenarios.findIndex((s) => s.no === sc.no)
  if (exist >= 0) report.scenarios[exist] = rec; else report.scenarios.push(rec)

  console.log(`  转述(${data.descriptions[0] ?? ''}.length=${(data.descriptions[0] ?? '').length})`)
  console.log(`  答案头: ${data.answer.slice(0, 160).replace(/\n/g, ' ')}`)
  console.log(`  token: prompt=${data.usage.prompt ?? 0} completion=${data.usage.completion ?? 0} | ${rec.elapsed}s`)
  const passN = Object.values(checks).filter((r) => r.pass).length
  console.log(`  检查: ${passN}/${Object.keys(checks).length} ${passN === Object.keys(checks).length ? '✅' : '❌ ' + Object.entries(checks).filter(([, r]) => !r.pass).map(([k]) => k).join(',')}`)
  writeFileSync(OUT, JSON.stringify(report, null, 2))
}
await browser.close()
console.log(`\n报告: ${OUT}`)
process.exit(0)
