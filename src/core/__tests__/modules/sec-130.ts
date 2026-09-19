/**
 * sec-130:S3 页面断言零依据门禁(host-integration-contract,gateChain 4.5 层)
 * 覆盖:detectPageAssertion 正/反例(子句级共现 + agent 动作排除 + 不存在声明豁免)/ isZeroPageBasis
 * (含 take_screenshot,数据 read 不算)/ runFinishGates 集成(触发/预算独立/EXHAUSTED/子栈豁免/
 * 问号豁免/装配范围对照 pageGate=false 不进判定/与既有门禁不互抢)。
 */
import type { TestCtx } from './_ctx'
import { runFinishGates, createGateChainState, type RunFinishGatesInput } from '../../harness/gateChain'
import { detectPageAssertion, isZeroPageBasis, buildTurnFactSheet, type TurnToolUsage } from '../../harness/actionGate'

const human = (content: string) => [{ _getType: () => 'human', content }]

function mkInput(over: Partial<RunFinishGatesInput>): RunFinishGatesInput {
  return {
    state: createGateChainState(),
    garbled: false,
    rounds: 1,
    finalContent: '',
    todos: [],
    isSubagent: false,
    turnUsage: { counts: {}, writePaths: [], failures: 0 },
    isWriteToolByName: () => false,
    messages: human('这个页面写了什么?'),
    pageGate: true,
    ...over,
  }
}

const usage = (counts: Record<string, number>): TurnToolUsage => ({ counts, writePaths: [], failures: 0 })

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // ===== detectPageAssertion:正例(页面指称 × 断言句式,子句共现)=====
  for (const t of [
    '本页写了完整的三步流程',
    '原文里提到数据结构的嵌套规则',
    '笔记中介绍了二叉树的遍历方式',
    '文中指出核心论点是渐进增强',
    '这一节讲了缓存策略',
    '页面上说明了如何配置环境',
    '正文提到「先骨架后增量」的原则',
    '文章总结了三个要点,此外页面布局清晰',
  ]) {
    assert(detectPageAssertion(t), `✓ 页面断言正例 → 命中:${t.slice(0, 18)}`)
  }

  // ===== detectPageAssertion:反例 =====
  for (const t of [
    '已把文档标题改成"使用说明"',        // agent 自述动作:文档/说明是操作对象非页面归属
    '我来添加文档说明字段',              // 同上
    '已将页面上的公告改成新版',          // 同上(页面引用在动作子句内)
    '本页没有提到相关内容',              // 不存在声明 = 正确行为
    '文中未涉及该主题',
    '这个概念不在本页讨论范围',
    '本页布局清晰,阅读体验很好',        // 指称但无断言动词
    '写了三步流程',                      // 断言动词但无页面指称(同子句)
    '你好,需要我继续吗',                // 无关文本
  ]) {
    assert(!detectPageAssertion(t), `✓ 页面断言反例 → 不命中:${t.slice(0, 18)}`)
  }

  // ===== isZeroPageBasis:页面依据口径(take_screenshot 计入 A2;数据 read 不算)=====
  assert(isZeroPageBasis(usage({})) === true, '✓ 零工具 → 零页面依据')
  assert(isZeroPageBasis(usage({ read_page: 2 })) === false, '✓ read_page 被调 → 有页面依据')
  assert(isZeroPageBasis(usage({ take_screenshot: 1 })) === false, '✓ take_screenshot 被调 → 有页面依据(A2:看过截图也算看过页面)')
  assert(isZeroPageBasis(usage({ dom_search: 1, get_dom: 1 })) === false, '✓ dom_search/get_dom → 有页面依据')
  assert(isZeroPageBasis(usage({ read: 3, query_data: 1 })) === true, '✓ 数据 read/query → 仍是零页面依据(scope 隔离)')
  assert(isZeroPageBasis(usage({ echo: 5 })) === true, '✓ 非页面工具 → 零页面依据')

  // ===== action-host-semantics S1-C:readsHostState action 计入页面依据 =====
  assert(isZeroPageBasis(usage({ read_note_source: 1 })) === true, '✓ 未传扩展集 → action 读不算页面依据(现行为零变化)')
  assert(isZeroPageBasis(usage({ read_note_source: 1 }), new Set(['read_note_source'])) === false,
    '✓ readsHostState 标记 action 被调 → 有页面依据(与 S2 失效面同源)')

  // ===== action-host-semantics S1-D:deferredWrite 事实清单「待确认」口径 =====
  {
    const u = usage({ read_note_source: 1, propose_note_edit: 1 })
    u.writePaths = []
    const deferred = new Set(['propose_note_edit'])
    const sheet = buildTurnFactSheet(u, undefined, () => false, deferred)
    assert(sheet.includes('propose_note_edit×1(提案类,待用户确认后才生效,尚未写入)'),
      '✓ deferredWrite action 调用 → 事实清单注记「待用户确认后才生效」(防「已修改完成」嘴硬)')
    assert(sheet.includes('read_note_source×1') && !sheet.includes('read_note_source×1('),
      '✓ 非标记 action 不加注记(只有 deferredWrite 名进注记面)')
    // 未传集合 → 清单与现行为逐字节一致(既有格式锁)
    const plain = buildTurnFactSheet(u, undefined, () => false)
    const legacy = buildTurnFactSheet(u, undefined, () => false, new Set())
    assert(plain === legacy && plain.includes('propose_note_edit×1'),
      '✓ 未标记/空集 → 事实清单与现行为逐字节一致(纯 propose_note_edit×1,零注记)')
    // 多次调用计数如实
    const u2 = usage({ propose_note_edit: 2 })
    assert(buildTurnFactSheet(u2, undefined, () => false, deferred).includes('propose_note_edit×2(提案类'),
      '✓ 多次提案 → 计数如实(propose_note_edit×2)')
  }

  // ===== runFinishGates 集成:三要素 AND 触发 =====
  {
    const i = mkInput({ finalContent: '本页写了三步流程,分别是构建、验证、部署。', turnUsage: usage({ echo: 1 }) })
    const r = runFinishGates(i)
    assert(r?.kind === 'feedback' && r.gate.stage === 'page_assertion_gate' && r.gate.attempt === 1,
      `✓ 三要素齐 → page_assertion_gate 回灌 attempt=1(实际 ${r?.kind === 'feedback' ? r.gate.stage : r?.kind})`)
    assert(i.state.pageAssertionRetries === 1 && i.state.zeroToolRetries === 0, '✓ 独立预算池:pageAssertion 自增,zeroTool 不动(不互抢)')
    assert(r?.kind === 'feedback' && /read_page/.test(r.gate.feedback) && /本页没有提到/.test(r.gate.feedback),
      '✓ 回灌文案:引导 read_page + 「本页没有提到」诚实出口')
  }

  // ===== 要素缺一不触发 =====
  {
    const a = runFinishGates(mkInput({ finalContent: '本页写了三步流程。', turnUsage: usage({ read_page: 1 }) }))
    assert(a === null, '✓ 有页面依据(read_page)→ 不触发(先读后答是正确路径)')
    const b2 = runFinishGates(mkInput({ finalContent: '本页写了三步流程。', turnUsage: usage({ read: 1 }) }))
    assert(b2?.kind === 'feedback' && b2.gate.stage === 'page_assertion_gate', '✓ 数据 read 不算页面依据 → 仍触发(scope 口径)')
    const c = runFinishGates(mkInput({ finalContent: '页面布局清晰,建议保持。', turnUsage: usage({}) }))
    assert(c === null, '✓ 无断言句式 → 不触发')
    const d = runFinishGates(mkInput({ finalContent: '本页没有提到相关内容。', turnUsage: usage({}) }))
    assert(d === null, '✓ 诚实不存在声明 → 豁免(正确行为不回灌)')
    const e = runFinishGates(mkInput({ finalContent: '本页写了三步流程,对吗?', turnUsage: usage({}) }))
    assert(e === null, '✓ 问号收尾(征询确认)→ 豁免')
    const f = runFinishGates(mkInput({ finalContent: '本页写了三步流程。', turnUsage: usage({}), isSubagent: true }))
    assert(f === null, '✓ 子栈豁免(子 agent 纯文本收口是正常形态)')
  }

  // ===== 装配范围对照(17b):同文本同用量,仅 pageGate 不同 =====
  {
    const content = '页面上说明了标题采用深色。'
    const turnUsage = usage({ write: 1 })  // 数据写存在 + 零页面读
    const messages = human('页面标题是什么风格?')
    const off = runFinishGates(mkInput({ finalContent: content, turnUsage, messages, pageGate: false }))
    assert(off === null, '✓ 装配对照:pageGate=false(domInspect 关)→ 同文本零回灌(数据槽误伤路径从结构上切断)')
    const on = runFinishGates(mkInput({ finalContent: content, turnUsage, messages, pageGate: true }))
    assert(on?.kind === 'feedback' && on.gate.stage === 'page_assertion_gate',
      `✓ 对照:pageGate=true → 同文本被拦(有数据写但零页面依据,页面断言仍须页面依据)`)
  }

  // ===== 预算耗尽 → EXHAUSTED observable =====
  {
    const i = mkInput({ finalContent: '本页写了三步流程。', turnUsage: usage({}) })
    const r1 = runFinishGates(i); const r2 = runFinishGates(i); const r3 = runFinishGates(i)
    assert(r1?.kind === 'feedback' && r2?.kind === 'feedback', '✓ 前两次回灌(attempt 1/2)')
    assert(r3?.kind === 'observable' && r3.obs.code === 'PAGE_ASSERTION_GATE_EXHAUSTED',
      `✓ 第三次 → PAGE_ASSERTION_GATE_EXHAUSTED observable 放行留痕(实际 ${r3?.kind === 'observable' ? r3.obs.code : r3?.kind})`)
  }

  // ===== EXHAUSTED 的诚实声明豁免(「本页没有提到」反复出现不被误报)=====
  {
    const i = mkInput({ finalContent: '本页没有提到相关内容。', turnUsage: usage({}) })
    i.state.pageAssertionRetries = 2
    const r = runFinishGates(i)
    assert(r === null, '✓ 预算耗尽 + 诚实不存在声明 → 不误报 EXHAUSTED')
  }
}
