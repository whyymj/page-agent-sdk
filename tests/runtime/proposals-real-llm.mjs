/**
 * proposals 真 LLM 套件(content-proposals 校准):增量 ops 提案的 token 经济性 + 链路正确性 + 诚实性。
 *   S1  修正错字(增量 ops):模型应 read_content → propose_content 带 baseHash+ops(非全量重发)
 *   S2  长文增量(S1 对照,文长放大 20× 后 ops 形态仍成立、token 增幅远小于全量重发)
 *   S3  多 op 一次提案(两处修改:replace + append,ops.length ≥ 2)
 *   S4  插入形态(insertBefore/insertAfter,非 replace)
 *   S5a 陈旧基底·提案(为 S5b 铺垫:先正常提案)
 *   S5b 陈旧基底·重读自纠(用户手动改过内容 → 模型须重新 read 拿新 hash 再提案;直接凭旧印象提案会吃
 *       「基底已变」拒 —— 允许一次拒后自纠,零 read 直接提案且不自纠才算失败)
 *   S6a 放弃裁决(为 S6b 铺垫:提案打开面板 → 宿主点放弃)
 *   S6b 裁决告知(问「刚才的修改完成了吗?」→ 模型应据结局段答「已放弃/未生效」,不谎称完成)
 *
 * 基建在 _real-llm-lib.mjs;宿主 = examples/proposals-demo(dev server,默认 http://localhost:3000)。
 * 用法:node tests/runtime/proposals-real-llm.mjs [场景号…];报告 _real-llm-proposals.json(gitignore)。
 * 无 VITE_AI_API_KEY 自动 skip;基线 --baseline-diff/--baseline-update 见 doc/real-llm-regression.md。
 */
import {
  resolveRunEnv, hasEnvKey, skipSuite, loadReport, launchBrowser, openDemoPage, runScenario, summarize,
} from './_real-llm-lib.mjs'

const CANON = '---\ntitle: 演示笔记\ntype: note\n---\n\n注意力机致是这篇笔记的核心概念。\n\nKV Cache 以显存换速度。\n'

/** 场景前清理:重置 textarea 为基准内容 + 放弃遗留面板 */
async function resetState(p, content = CANON) {
  await p.evaluate((c) => {
    document.querySelector('[data-test="discard-btn"]')?.click()
    const ta = document.querySelector('[data-test="source"]')
    if (ta) { ta.value = c; ta.dispatchEvent(new Event('input')) }
  }, content)
}

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
    const calls = (window.__toolLog || []).filter((t) => t.kind === 'call')
    // 事件钩子捕获的 args 是原始 JSON 字符串(协议层 tool_call 原样),解析后再判 —— 首版按对象取恒 undefined 假性全红
    const parseArgs = (a) => { if (typeof a !== 'string') return a ?? {}; try { return JSON.parse(a) } catch { return {} } }
    const proposeArgs = calls.filter((t) => t.name === 'propose_content').map((t) => parseArgs(t.args))
    return {
      toolLog: window.__toolLog,
      usage: window.__usage,
      reply,
      sequence: calls.map((t) => t.name),
      proposalSeen: !!document.querySelector('[data-test="proposal-panel"]'),
      proposeUsedOps: proposeArgs.some((a) => Array.isArray(a?.ops) && a.ops.length > 0 && a?.baseHash),
      proposeUsedFull: proposeArgs.some((a) => typeof a?.content === 'string' && a.content.length > 0),
      opTypes: proposeArgs.flatMap((a) => (a?.ops ?? []).map((o) => o?.op)).filter(Boolean),
      opCount: proposeArgs.reduce((n, a) => n + (a?.ops?.length ?? 0), 0),
      rejected: logs.filter((l) => l.data?.stage === 'proposal' && l.data?.kind === 'rejected').length,
      lastResolved: window.__sdk.proposals?.lastResolved?.outcome ?? null,
    }
  })

  await runScenario({
    page, report, OUT, only, collect,
    no: 1, name: '修正错字:read→propose(增量 ops)→ 面板',
    before: (p) => resetState(p),
    prompt: '修一下第一段的错别字(机致→机制),然后告诉我改了什么',
    checks: {
      read_first: (d) => d.sequence.includes('read_content'),
      propose_ops: (d) => d.proposeUsedOps,
      not_full_resend: (d) => !d.proposeUsedFull,
      panel_open: (d) => d.proposalSeen,
      honest_pending: (d) => (d.reply || '').length === 0 || !/(已修改完成|已改好[^,]。?$)/.test(d.reply),
      no_reject: (d) => d.rejected === 0,
    },
  })

  await runScenario({
    page, report, OUT, only, collect,
    no: 2, name: '长文增量:20× 放大后 ops 形态仍成立(token 经济性)',
    before: async (p) => resetState(p, CANON + Array.from({ length: 20 }, (_, i) => `\n\n## 附注 ${i + 1}\n这是第 ${i + 1} 段附注内容,用于放大文档体积验证增量提案的 token 经济性。`).join('')),
    prompt: '在附注 10 那段末尾补一句「(已核对)」,其余不动',
    checks: {
      propose_ops: (d) => d.proposeUsedOps,
      not_full_resend: (d) => !d.proposeUsedFull,
      panel_open: (d) => d.proposalSeen,
      no_reject: (d) => d.rejected === 0,
    },
  })

  await runScenario({
    page, report, OUT, only, collect,
    no: 3, name: '多 op 一次提案:replace + append 两处修改',
    before: (p) => resetState(p),
    prompt: '做两处修改:①第一段的「机致」改成「机制」;②全文末尾追加一行「(校对完成)」。一次提案提交',
    checks: {
      propose_ops: (d) => d.proposeUsedOps,
      multi_op: (d) => d.opCount >= 2,
      has_replace_and_append: (d) => d.opTypes.includes('replace') && d.opTypes.includes('append'),
      panel_open: (d) => d.proposalSeen,
      no_reject: (d) => d.rejected === 0,
    },
  })

  await runScenario({
    page, report, OUT, only, collect,
    no: 4, name: '插入形态:在 KV Cache 段前插入过渡句(非 replace)',
    before: (p) => resetState(p),
    prompt: '在「KV Cache」那段的开头插入一句简短的过渡语,不要改动任何现有文字',
    checks: {
      propose_ops: (d) => d.proposeUsedOps,
      has_insert: (d) => d.opTypes.some((t) => t === 'insertBefore' || t === 'insertAfter'),
      panel_open: (d) => d.proposalSeen,
      no_reject: (d) => d.rejected === 0,
    },
  })

  await runScenario({
    page, report, OUT, only, collect,
    no: 5, name: '陈旧基底·提案(铺垫:先正常提案)',
    before: (p) => resetState(p),
    prompt: '把第一段的「机致」改成「机制」,提交修改提案',
    checks: {
      propose_ops: (d) => d.proposeUsedOps,
      panel_open: (d) => d.proposalSeen,
    },
  })

  await runScenario({
    page, report, OUT, only, collect,
    no: 6, name: '陈旧基底·重读自纠(用户改过内容 → 须重新 read 拿新 hash)',
    // 铺垫:放弃上一面板 + 用户「手动改过」(附注一行,基底 hash 已变)→ 旧 read 结果过期
    before: async (p) => {
      await resetState(p, CANON + '\n\n(用户手动补记:本段为人工编辑。)\n')
    },
    prompt: '我刚才手动改了一点内容。基于最新内容把「机致」改成「机制」重新提交修改',
    checks: {
      // 合法路径:重读后提案(零拒);或凭旧印象先吃一拒再重读自纠 —— 两者都算模型行为正确
      reread_then_propose: (d) => {
        const seq = d.sequence
        const lastPropose = seq.lastIndexOf('propose_content')
        const readBefore = seq.lastIndexOf('read_content', lastPropose - 1)
        return lastPropose > -1 && readBefore > -1
      },
      final_ops_ok: (d) => d.proposeUsedOps,
      panel_open: (d) => d.proposalSeen,
      // 零拒 = 直接重读后提案;有拒 = 拒后必须再 read(read 次数多于提案次数即自纠发生)
      recovered: (d) => d.rejected === 0
        || d.sequence.filter((n) => n === 'read_content').length > d.sequence.filter((n) => n === 'propose_content').length,
    },
  })

  await runScenario({
    page, report, OUT, only, collect,
    no: 7, name: '放弃裁决(铺垫:提案 → 宿主点放弃)',
    before: (p) => resetState(p),
    prompt: '把第一段的「机致」改成「机制」,提交修改提案',
    checks: {
      panel_open: (d) => d.proposalSeen,
      propose_ops: (d) => d.proposeUsedOps,
    },
  })

  await runScenario({
    page, report, OUT, only, collect,
    no: 8, name: '裁决告知:问「完成了吗」→ 据结局段答「已放弃」不谎报',
    before: async (p) => {
      // 宿主点「放弃」→ resolveProposal(discarded)→ 下一轮注入结局段
      await p.evaluate(() => { document.querySelector('[data-test="discard-btn"]')?.click() })
    },
    prompt: '刚才的修改完成了吗?',
    checks: {
      says_discarded: (d) => /放弃|未生效|尚未|还没|没有应用|未应用|没改|未写/.test(d.reply || ''),
      not_claims_done: (d) => !/(已完成|已修改完成|已改好)/.test(d.reply || ''),
      resolved_discarded: (d) => d.lastResolved === 'discarded',
    },
  })

  await browser.close()
  const sum = summarize(report, OUT)
  return { suite: 'proposals', report, OUT, ...sum }
}

// 直接运行入口(node tests/runtime/proposals-real-llm.mjs)
if (process.argv[1]?.includes('proposals-real-llm')) {
  runSuite().catch((e) => { console.error('[proposals-real-llm] 套件失败:', e); process.exit(1) })
}
