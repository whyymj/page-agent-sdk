/**
 * proposals 真 LLM 套件(content-proposals 校准):增量 ops 提案的 token 经济性 + 链路正确性。
 *   P1  修正错字(增量 ops):模型应 read_content → propose_content 带 baseHash+ops(非全量重发)
 *   P2  长文增量(P1 对照,文长放大后 ops 形态仍成立、token 增幅远小于全量重发)
 *
 * 基建在 _real-llm-lib.mjs;宿主 = examples/proposals-demo(dev server)。
 * 用法:node tests/runtime/proposals-real-llm.mjs [场景号…];报告 _real-llm-proposals.json(gitignore)。
 * 无 VITE_AI_API_KEY 自动 skip;基线采集 --baseline-diff/--baseline-update 见 doc/real-llm-regression.md。
 */
import {
  resolveRunEnv, hasEnvKey, skipSuite, loadReport, launchBrowser, openDemoPage, runScenario, summarize,
} from './_real-llm-lib.mjs'

export async function runSuite({ only = process.argv.slice(2).map(Number).filter(Boolean) } = {}) {
  if (!hasEnvKey(/^VITE_AI_API_KEY=.+/m)) return skipSuite('.env 缺 VITE_AI_API_KEY(proposals 套件)')
  const { BASE, OUT } = resolveRunEnv({ outDefault: '_real-llm-proposals.json' })
  const report = loadReport(OUT, only)
  const browser = await launchBrowser()
  const page = await openDemoPage(browser, `${BASE}/examples/proposals-demo/`)
  await page.click('[data-test="ask-btn"]')
  await page.waitForSelector('.chat-dialog .chat-input', { state: 'visible', timeout: 15_000 })

  const collect = (p) => p.evaluate(() => {
    const logs = window.__sdk.debugLogs.value || []
    const reply = window.__sdk.messages[window.__sdk.messages.length - 1]?.content?.slice(0, 800) ?? ''
    const proposeArgs = (window.__toolLog || []).filter((t) => t.name === 'propose_content').map((t) => t.args)
    return {
      toolLog: window.__toolLog,
      usage: window.__usage,
      reply,
      proposalSeen: !!document.querySelector('[data-test="proposal-panel"]'),
      proposeUsedOps: proposeArgs.some((a) => Array.isArray(a?.ops) && a.ops.length > 0 && a?.baseHash),
      proposeUsedFull: proposeArgs.some((a) => typeof a?.content === 'string' && a.content.length > 0),
      pendingLeft: (window.__sdk.proposals?.pending ?? []).length,
      rejected: logs.filter((l) => l.data?.stage === 'proposal' && l.data?.kind === 'rejected').length,
    }
  })

  await runScenario({
    page, report, OUT, only, collect,
    no: 1, name: '修正错字:read→propose(增量 ops)→ 面板',
    prompt: '修一下这篇笔记第一段的错别字(机致→机制),然后告诉我改了什么',
    checks: {
      read_first: (d) => d.tools.includes('read_content'),
      propose_ops: (d) => d.proposeUsedOps,
      panel_open: (d) => d.proposalSeen,
      honest_pending: (d) => (d.reply || '').length === 0 || !/(已修改完成|已改好)/.test(d.reply),
      no_reject: (d) => d.rejected === 0,
    },
  })

  await runScenario({
    page, report, OUT, only, collect,
    no: 2, name: '长文增量:textarea 放大 20× 后 ops 形态仍成立(token 经济性)',
    before: async (p) => p.evaluate(() => {
      const ta = document.querySelector('[data-test="source"]')
      const base = ta.value
      ta.value = base + Array.from({ length: 20 }, (_, i) => `\n\n## 附注 ${i + 1}\n这是第 ${i + 1} 段附注内容,用于放大文档体积验证增量提案的 token 经济性。`).join('')
      ta.dispatchEvent(new Event('input'))
    }),
    prompt: '在附注 10 那段末尾补一句「(已核对)」,其余不动',
    checks: {
      propose_ops: (d) => d.proposeUsedOps,
      not_full_resend: (d) => !d.proposeUsedFull,
      panel_open: (d) => d.proposalSeen,
    },
  })

  await browser.close()
  summarize(report, OUT)
}

// 直接运行入口(node tests/runtime/proposals-real-llm.mjs)
if (process.argv[1]?.includes('proposals-real-llm')) {
  runSuite().catch((e) => { console.error('[proposals-real-llm] 套件失败:', e); process.exit(1) })
}
