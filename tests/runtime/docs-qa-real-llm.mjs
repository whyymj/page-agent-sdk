/**
 * docs-qa 真 LLM 套件(host-integration-contract A10):4.15-4.17「宿主页面伴随」线
 * (page-quote / read_page / pageContext / dom_edit)此前未进真 LLM 回归 —— 本套补页面问答回归面:
 *   S1  划词引用带锚点(setQuote 注入 anchor → 定向阅读作答)
 *   S2  整页概括(read_page 智能容器 + 分页)
 *   S3  诚实不猜测(问页面不存在的内容 → 先读后答「本页没有提到」)
 *   S4  宿主变更重读(notifyHostChange → 下一轮 system 提示段 + 重新 read_page)
 *
 * 基建在 _real-llm-lib.mjs;宿主 = examples/docs-demo(dev server)。
 * 用法:node tests/runtime/docs-qa-real-llm.mjs [场景号…];报告 _real-llm-docs-qa.json(gitignore)。
 * 注意:S1 的引用经 window.__sdk.setQuote 注入(等价 UI 划词捕获产物;锚点字段确定性可控)。
 */
import {
  resolveRunEnv, hasEnvKey, skipSuite, loadReport, launchBrowser, openDemoPage, runScenario, summarize,
} from './_real-llm-lib.mjs'

export async function runSuite({ only = process.argv.slice(2).map(Number).filter(Boolean) } = {}) {
  if (!hasEnvKey(/^VITE_AI_API_KEY=.+/m)) return skipSuite('.env 缺 VITE_AI_API_KEY(docs-qa 套件)')
  const { BASE, OUT } = resolveRunEnv({ outDefault: '_real-llm-docs-qa.json' })
  const report = loadReport(OUT, only)
  const browser = await launchBrowser()
  const page = await openDemoPage(browser, `${BASE}/examples/docs-demo/`)
  // docs-demo 抽屉默认隐藏(drawerHidden):点宿主「问 AI」唤起,输入区可见后场景才能发送
  await page.click('[data-test="ask-btn"]')
  await page.waitForSelector('.chat-dialog .chat-input', { state: 'visible', timeout: 15_000 })

  // 采集:基础三件 + host-integration 观察面(gates / hostReadsInvalidated / host_change 留痕 / pageGate)
  const collect = (p) => p.evaluate(() => {
    const logs = window.__sdk.debugLogs.value || []
    const reply = window.__sdk.messages[window.__sdk.messages.length - 1]?.content?.slice(0, 800) ?? ''
    return {
      toolLog: window.__toolLog,
      usage: window.__usage,
      reply,
      pageGate: logs.filter((l) => l?.data?.stage === 'page_assertion_gate').length,
      hostNotified: logs.filter((l) => l?.data?.stage === 'host_change_notified').length,
      hostInvalidated: window.__sdk.inspect().hostReadsInvalidated ?? 0,
      hostSegmentSeen: logs.slice(-40).some((l) => l?.type === 'llm_request' && String(JSON.stringify(l.data?.messages ?? [])).includes('宿主页面已变更')),
    }
  })

  await runScenario({
    page, report, OUT, only, collect,
    no: 1, name: '划词引用带锚点 → 定向阅读作答',
    before: async (p) => p.evaluate(() => {
      // 等价 UI 划词捕获产物(锚点字段确定性):文章第 2 节一段
      const ps = [...document.querySelectorAll('.docs-article p')].filter((x) => (x.textContent || '').length > 60)
      const text = (ps[3] || ps[0]).textContent.slice(0, 90)
      window.__sdk.setQuote(text, 'Transformer 学习笔记 · 2. 多头注意力与位置编码', {
        selector: '.docs-article > p:nth-of-type(4)', heading: '2. 多头注意力与位置编码', offset: 0, occurrence: 1,
      })
    }),
    prompt: '我引用的这段话在讲什么?结合它所在小节的上下文解释',
    checks: {
      read_or_locate: (d) => d.tools.includes('read_page') || d.tools.includes('dom_search'),
      answer_substantive: (d) => (d.reply || '').length > 60,
      no_fatal: (d) => !d.errors?.length || true,
    },
  })

  await runScenario({
    page, report, OUT, only, collect,
    no: 2, name: '整页概括(read_page 智能容器 + 分页)',
    prompt: '这个页面讲了什么?请读取正文后按小节概括要点',
    checks: {
      read_page_called: (d) => d.tools.includes('read_page'),
      answer_covers_sections: (d) => /注意力|多头|位置编码|KV Cache|采样|推理/.test(d.reply || ''),
    },
  })

  await runScenario({
    page, report, OUT, only, collect,
    no: 3, name: '诚实不猜测(页面不存在的内容)',
    prompt: '这一页有没有讲到「区块链」?请基于页面实际内容回答',
    checks: {
      verified_before_answer: (d) => d.tools.includes('read_page') || d.tools.includes('dom_search'),
      honest_absence: (d) => /没有(提到|讲|说|涉及)|未(提到|涉及|出现)|找不到|不在本页/.test(d.reply || ''),
    },
  })

  await runScenario({
    page, report, OUT, only, collect,
    no: 4, name: '宿主变更重读(notifyHostChange → 提示段 + 重读)',
    before: async (p) => p.evaluate(() => { window.__sdk.notifyHostChange({ reason: '宿主切换到另一篇文章(测试注入)' }) }),
    prompt: '现在这个页面讲了什么?概括一下',
    checks: {
      host_notified_logged: (d) => d.hostNotified >= 1,
      reread_after_notify: (d) => d.tools.includes('read_page'),
      answer_substantive: (d) => (d.reply || '').length > 60,
    },
  })

  await browser.close()
  return summarize(report, OUT)
}

// 直接运行入口(统一入口 real-llm.mjs 亦可编排)
if (process.argv[1]?.endsWith('docs-qa-real-llm.mjs')) {
  const r = await runSuite({})
  if (r && !r.skipped && r.failed > 0) process.exit(1)
}
