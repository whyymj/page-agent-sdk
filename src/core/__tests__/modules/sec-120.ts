/**
 * sec-120 —— Batch B2:gateChain 口径对齐三层三样收口(flow 审计 #1/#2,2026-09-09)
 *
 * 背景(六路审计 flow 路):
 *  - 第 5 层(零工具 EXHAUSTED observable)缺句尾问号豁免:回灌 ×2 后模型改为向用户征询
 *    (「要我继续修改吗?」)仍被外发 ZERO_TOOL_GATE_EXHAUSTED,文案「疑似谎报」对问句收尾属误报
 *  - 完结门禁预算耗尽后静默放行、无 EXHAUSTED observable:audit/zero_tool 两层耗尽均有留痕,
 *    唯 completion 层零感知 —— todos 未完成被放行集成方不知道,与第 5 层自述「谎报放行恰是该知晓的
 *    时刻」自相矛盾 → 补 COMPLETION_GATE_EXHAUSTED(零 LLM 纯留痕)
 */
import type { TestCtx } from './_ctx'
import { runFinishGates, createGateChainState } from '../../harness/gateChain'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-120] gateChain EXHAUSTED 口径对齐(问号豁免 + COMPLETION_GATE_EXHAUSTED)')

  const msgs = [{ _getType: () => 'human', content: '把首页改成暗色主题' }]
  const usage = { counts: {}, writePaths: [], failures: 0 }
  const base = { garbled: false, rounds: 1, todos: [] as any[], isSubagent: false, turnUsage: usage, isWriteToolByName: () => false, messages: msgs }

  // ===== A. 第 5 层问号豁免:预算耗尽 + 零等效写 + 操作祈使 + 问句收尾 → 不误报 EXHAUSTED =====
  {
    const g = createGateChainState()
    g.zeroToolRetries = 2 // 预算已耗尽
    const q = runFinishGates({ ...base, state: g, finalContent: '两处修改相互依赖,要我继续修改吗?' })
    assert(q === null, '✓ 预算耗尽后问句收尾(向用户征询)→ 不外发 ZERO_TOOL_GATE_EXHAUSTED(修前:疑似谎报误报)')
    // 对照:同条件非问句收尾 → 照常 observable(豁免不扩大到陈述式谎报)
    const g2 = createGateChainState()
    g2.zeroToolRetries = 2
    const s = runFinishGates({ ...base, state: g2, finalContent: '已全部修改完成。' })
    assert(s?.kind === 'observable' && s.obs.code === 'ZERO_TOOL_GATE_EXHAUSTED', '✓ 预算耗尽后陈述式谎报收尾 → 照常 EXHAUSTED 留痕(豁免只让位问句)')
    // 全角问号同豁免
    const g3 = createGateChainState()
    g3.zeroToolRetries = 2
    const fq = runFinishGates({ ...base, state: g3, finalContent: '要我现在写入吗？' })
    assert(fq === null, '✓ 全角问号(？)同豁免')
  }

  // ===== B. COMPLETION_GATE_EXHAUSTED:完结门禁预算耗尽 + todos 仍未完成 → observable 留痕 =====
  {
    // 审计场景形态:此前轮已有成功写(不落 zero_tool 面)+ todos 仍有未完成项 + 2 次回灌后仍纯文本收口
    const base = { garbled: false, rounds: 1, todos: [] as any[], isSubagent: false, turnUsage: { counts: { write: 1 }, writePaths: ['components.0'], failures: 0 }, isWriteToolByName: (n: string) => n === 'write', messages: msgs }
    const todos: any = [
      { id: 't-1', content: '改标题', status: 'pending', evidence: '' },
      { id: 't-2', content: '改配色', status: 'completed', evidence: '已委派完成' },
    ]
    // 未耗尽 → 照常回灌(feedback 路径不受影响)
    const g1 = createGateChainState()
    const fb = runFinishGates({ ...base, todos, state: g1, finalContent: '标题和配色都改好了。' })
    assert(fb?.kind === 'feedback' && fb.gate.stage === 'completion_gate', '✓ 未耗尽 → 照常完结门禁回灌(feedback 路径零变化)')
    // 耗尽 → 新 observable(修前:静默放行零留痕)
    const g2 = createGateChainState()
    g2.completionRetries = 2
    const obs = runFinishGates({ ...base, todos, state: g2, finalContent: '标题和配色都改好了。' })
    assert(obs?.kind === 'observable' && obs.obs.code === 'COMPLETION_GATE_EXHAUSTED', '✓ 完结预算耗尽 + todos 未完成纯文本收口 → COMPLETION_GATE_EXHAUSTED 留痕(修前:静默放行)')
    assert(obs?.kind === 'observable' && Array.isArray(obs.obs.context.pending) && obs.obs.context.pending.length === 1, '✓ context.pending 列未完成项 id(t-1)')
    // 问号收尾 → detectIncompleteFinish 内部豁免 → 不发 EXHAUSTED(与回灌路径同口径)
    const g3 = createGateChainState()
    g3.completionRetries = 2
    const q = runFinishGates({ ...base, todos, state: g3, finalContent: '标题改好了,配色要继续吗?' })
    assert(q === null, '✓ 完结预算耗尽 + 问号收尾(征询)→ 不发 EXHAUSTED(问句口径复用)')
    // 子 agent 栈豁免照旧(不因新 observable 破坏)
    const g4 = createGateChainState()
    g4.completionRetries = 2
    const sub = runFinishGates({ ...base, todos, state: g4, isSubagent: true, finalContent: '标题和配色都改好了。' })
    assert(sub === null, '✓ 子 agent 栈豁免照旧(COMPLETION_GATE_EXHAUSTED 不装子栈)')
    // rounds=0(纯问答轮)前置照旧
    const g5 = createGateChainState()
    g5.completionRetries = 2
    const r0 = runFinishGates({ ...base, todos, state: g5, rounds: 0, finalContent: '标题和配色都改好了。' })
    assert(r0 === null, '✓ rounds=0 前置照旧(跨轮陈旧 todos 不发难)')
  }

  // ===== C. 边界:completion 耗尽但 todos 全完成 / 空 todos → 不发 =====
  {
    // 同 B 的非零写形态(祈使消息下 zero_tool 层不拦截,隔离测 completion 层边界)
    const base = { garbled: false, rounds: 1, todos: [] as any[], isSubagent: false, turnUsage: { counts: { write: 1 }, writePaths: ['components.0'], failures: 0 }, isWriteToolByName: (n: string) => n === 'write', messages: msgs }
    const g = createGateChainState()
    g.completionRetries = 2
    const done = runFinishGates({ ...base, todos: [{ id: 't-1', content: 'x', status: 'completed', evidence: '已完成' } as any], state: g, finalContent: '完成。' })
    assert(done === null, '✓ todos 全完成 → 不发 COMPLETION_GATE_EXHAUSTED')
    const g2 = createGateChainState()
    g2.completionRetries = 2
    const none = runFinishGates({ ...base, todos: [], state: g2, finalContent: '完成。' })
    assert(none === null, '✓ 空 todos → 不发(与完结门禁触发面同口径)')
  }
}
