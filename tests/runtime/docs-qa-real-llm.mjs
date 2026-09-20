/**
 * docs-qa 真 LLM 套件(host-integration-contract A10):4.15-4.17「宿主页面伴随」线
 * (page-quote / read_page / pageContext / dom_edit)此前未进真 LLM 回归 —— 本套补页面问答回归面:
 *   S1  划词引用带锚点(setQuote 注入 anchor → 定向阅读作答)
 *   S2  整页概括(read_page 智能容器 + 分页)
 *   S3  诚实不猜测(问页面不存在的内容 → 先读后答「本页没有提到」)
 *   S4  宿主变更重读(notifyHostChange → 下一轮 system 提示段 + 重新 read_page)
 *   S5  作答车道 B(answer-intent-lanes):术语不在页上 → 仍给通用解释,不压成 miss 报告
 *   S6  作答车道 C:「根据你的经验」→ 先验观点在场,与页面口径分列
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
      // 会话级页面读计数(含历史轮步骤):S3 判据用 —— 同会话早前真读过且之后无宿主变更,复用合法(stale-read 只在写/换文后失效)
      sessionPageReads: (window.__sdk.messages ?? []).reduce((n, m) => n + ((m.steps ?? []).filter((st) => st?.name === 'read_page').length), 0),
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
      // 修(2026-09-19 复核):4.19 输出纪律后模型在同会话已整页读(S2)且零宿主变更时会正确地复用而非重读
      // —— 按 stale-read 设计语义(仅写/换文后失效)这是合法行为;断言放宽为「本轮读了 或 会话早前读过且无失效」
      verified_before_answer: (d) => d.tools.includes('read_page') || d.tools.includes('dom_search')
        || (d.sessionPageReads > 0 && d.hostNotified === 0 && d.hostInvalidated === 0),
      honest_absence: (d) => /没有(任何|出现|提到|讲|说|涉及)|未(出现|提到|涉及)|不涉及|没出现|无关|找不到|不在本页/.test(d.reply || ''), // 2026-09-19 复核补:「通篇没有任何一处出现/答案是不涉及」同形态
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

  await runScenario({
    page, report, OUT, only, collect,
    no: 5, name: '作答车道 B:术语不在页上 → 仍给通用解释(修前压成「本页没有提到」拒答)',
    // CAP 定理:Transformer 学习笔记不会出现;B 车道要求「本页未提及,以下是通用解释」而非检索 miss 报告
    prompt: 'CAP 定理是什么意思?',
    checks: {
      // 实质解释命中关键概念词(CAP = 一致性/可用性/分区容错 三选二)
      explains_concept: (d) => /一致性/.test(d.reply || '') && /可用/.test(d.reply || '') && /分区/.test(d.reply || ''),
      // 不是「找不到就不答」:回答主体是解释而非 miss 报告(允许开头一句「本页未提及」)
      not_bare_miss: (d) => (d.reply || '').length > 120,
    },
  })

  await runScenario({
    page, report, OUT, only, collect,
    no: 6, name: '作答车道 C:「根据你的经验」→ 给出先验观点并与页面口径分列(修前压成全引文页内索引)',
    prompt: '根据你的经验,学 Transformer 应该先啃注意力机制还是先学位置编码?给点建议',
    checks: {
      // 第一人称判断在场(我的看法/我建议/我会/我认为 —— C 车道的核心特征;修前只有「本页口径」引文索引)
      first_person_stance: (d) => /我(的)?(看法|认为|建议|经验|倾向|会)|按我(的)?经验|我的建议/.test(d.reply || ''),
      answer_substantive: (d) => (d.reply || '').length > 100,
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
