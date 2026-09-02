/**
 * sec-101:gateChain 抽取(evidence-audit-gate Phase 0)+ 完结门禁子栈豁免(评审 A-3 存量缺陷修复)
 * 覆盖:①收口门禁链抽取后循环行为等价(主栈完结门禁照常回灌,预算 2 耗尽放行)②子 agent 栈豁免
 * (html 子 agent planning=true 装 todos,「子栈无 todos」旧假设不成立 —— 修复前子栈正常收口被误回灌)
 * ③runFinishGates 纯判定单测(garbled 全跳 / 子栈完结豁免 / 零工具预算耗尽 observable / 预算池独立)。
 */
import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
import { createAgent } from '../../harness/createAgent'
import { createTodosMiddleware } from '../../harness/todos'
import { runFinishGates, createGateChainState } from '../../harness/gateChain'
import type { Middleware } from '../../harness/middleware'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, AIMessageChunk } from '@langchain/core/messages'
import type { TestCtx } from './_ctx'

/** 脚本化 LLM(照 sec-100):按序返回 [tool_call, ..., 文本];越界回落纯文本「完成」 */
class ScriptLLM extends BaseChatModel {
  idx = 0
  constructor(private script: Array<{ tool?: { name: string; args: Record<string, unknown> } }>) { super({}) }
  _llmType(): string { return 'script' }
  private step() { return this.script[this.idx++] }
  async *_streamResponseChunks(): AsyncGenerator<any> {
    const s = this.step()
    if (s?.tool) {
      const tcc = [{ id: `call_${this.idx - 1}`, name: s.tool.name, args: JSON.stringify(s.tool.args), index: 0 }]
      yield { text: '', message: new AIMessageChunk({ content: '', tool_call_chunks: tcc as any }), generationInfo: {} }
    } else {
      yield { text: '完成', message: new AIMessageChunk({ content: '完成' }), generationInfo: {} }
    }
  }
  async _generate(): Promise<any> {
    const s = this.step()
    const msg = s?.tool
      ? new AIMessage({ content: '', tool_calls: [{ id: `call_${this.idx - 1}`, name: s.tool.name, args: s.tool.args, type: 'tool_call' }] })
      : new AIMessage({ content: '完成' })
    return { generations: [{ text: '完成', message: msg }], llmOutput: {} }
  }
}

interface RunOpts { __pgIsSubagent?: boolean }

/** 跑 [write_todos(2 pending) → 文本「完成」(越界持续)] 循环;返回捕获的全部模型请求与 debugLogs */
async function runLoop(o: RunOpts) {
  const bind: any = { components: [{ type: 'card', title: 't' }] }
  const tools = createDataOps(
    { schema: z.object({ components: z.array(z.object({ type: z.string(), title: z.string() })) }), bind, description: '组件' },
    {},
  )
  const todosMw = createTodosMiddleware([])
  const allTools = [...tools, ...((todosMw.tools as any[]) ?? [])]
  const captured: any[][] = []
  const captureMw: Middleware = {
    name: 'capture',
    wrapModelCall: async (req, next) => { captured.push([...req.messages]); return next(req) },
  }
  const agent = createAgent({
    llm: new ScriptLLM([
      { tool: { name: 'write_todos', args: { todos: [{ content: '任务A', status: 'pending' }, { content: '任务B', status: 'pending' }] } } },
    ]) as any,
    tools: allTools,
    middleware: [todosMw, captureMw],
    maxToolRounds: 8,
    maxRetries: 0,
    ...(o.__pgIsSubagent !== undefined ? { __pgIsSubagent: o.__pgIsSubagent } : {}),
  })
  let final = ''
  const events: any[] = []
  await agent.stream([{ role: 'user', content: '按任务清单处理', timestamp: Date.now() }], (e: any) => { if (e.type === 'done') final = e.content; events.push(e) }, undefined)
  return { agent, final, captured, events }
}

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // ===== 1. 主栈:完结门禁照常(抽取零行为变化)=====
  {
    const r = await runLoop({})
    const logs = (r.agent.debugLogs.value as any[]).filter((l) => l.data?.stage === 'completion_gate')
    assert(logs.length === 2, `✓ gateChain 主栈 → 完结门禁预算 2 耗尽(实测 ${logs.length} 次)`)
    assert(logs[0].data.attempt === 1 && logs[1].data.attempt === 2, '✓ gateChain 主栈 → attempt 递增')
    // 回灌文本进入后续模型请求(第 2/3 次请求可见「任务未完成」)
    const withFeedback = r.captured.filter((msgs) => msgs.some((m) => String((m as any).content ?? '').includes('任务未完成')))
    assert(withFeedback.length === 2, `✓ gateChain 主栈 → 回灌文案进入后续模型请求(实测 ${withFeedback.length} 次)`)
    assert(r.final === '完成', '✓ gateChain 主栈 → 预算耗尽放行收口')
  }

  // ===== 2. 子 agent 栈豁免(评审 A-3 修复:html 子 agent planning=true 装 todos)=====
  {
    const r = await runLoop({ __pgIsSubagent: true })
    const logs = (r.agent.debugLogs.value as any[]).filter((l) => l.data?.stage === 'completion_gate')
    assert(logs.length === 0, `✓ gateChain 子栈 → 完结门禁豁免(实测 ${logs.length} 次;修复前会被误回灌)`)
    const withFeedback = r.captured.filter((msgs) => msgs.some((m) => String((m as any).content ?? '').includes('任务未完成')))
    assert(withFeedback.length === 0, '✓ gateChain 子栈 → 零回灌文案进入模型请求')
    assert(r.final === '完成', '✓ gateChain 子栈 → 首次文本收口即放行')
    assert(r.captured.length === 2, `✓ gateChain 子栈 → 无回灌轮(模型调用 ${r.captured.length} 次 = write_todos + 收口)`)
  }

  // ===== 3. runFinishGates 纯判定 =====
  {
    const todos = [
      { id: 't-1', content: '任务A', status: 'pending' },
      { id: 't-2', content: '任务B', status: 'pending' },
    ] as any[]
    const usage = { counts: {}, writePaths: [], failures: 0 }
    const isW = (n: string) => n === 'write'  // 认 write 为写工具:fact-sheet 会补 write×0 零计数事实
    const msgs = [{ _getType: () => 'human', content: '按任务清单处理' }]

    // garbled → 全跳(null)
    assert(runFinishGates({ state: createGateChainState(), garbled: true, rounds: 1, finalContent: '完成', todos, isSubagent: false, turnUsage: usage, isWriteToolByName: isW, messages: msgs }) === null, '✓ runFinishGates → garbled 全跳')
    // 子栈 + pending todos + rounds>0 → 完结门禁豁免(A-3)
    assert(runFinishGates({ state: createGateChainState(), garbled: false, rounds: 1, finalContent: '完成', todos, isSubagent: true, turnUsage: usage, isWriteToolByName: isW, messages: msgs }) === null, '✓ runFinishGates → 子栈完结门禁豁免')
    // 主栈 → 触发 completion_gate feedback
    const g1 = runFinishGates({ state: createGateChainState(), garbled: false, rounds: 1, finalContent: '完成', todos, isSubagent: false, turnUsage: usage, isWriteToolByName: isW, messages: msgs })
    assert(g1?.kind === 'feedback' && g1.gate.stage === 'completion_gate' && g1.gate.attempt === 1 && g1.gate.feedback.includes('任务未完成'), '✓ runFinishGates → 主栈 pending todos 触发完结门禁回灌')
    // 预算耗尽 → 完结门禁不再发难(非祈使零写轮:零工具门禁也不触发 → null)
    const exhausted = createGateChainState()
    exhausted.completionRetries = 2
    assert(runFinishGates({ state: exhausted, garbled: false, rounds: 1, finalContent: '完成', todos, isSubagent: false, turnUsage: usage, isWriteToolByName: isW, messages: msgs }) === null, '✓ runFinishGates → 完结预算耗尽不再发难')
    // 零工具预算耗尽 + 祈使用户消息 + 零等效写 → EXHAUSTED observable
    const zt = createGateChainState()
    zt.zeroToolRetries = 2
    const obs = runFinishGates({ state: zt, garbled: false, rounds: 0, finalContent: '已完成全部修改', todos: [], isSubagent: false, turnUsage: usage, isWriteToolByName: isW, messages: [{ _getType: () => 'human', content: '把标题改成X' }] })
    assert(obs?.kind === 'observable' && obs.obs.code === 'ZERO_TOOL_GATE_EXHAUSTED' && String(obs.obs.context.factSheet).includes('write×0'), '✓ runFinishGates → 零工具预算耗尽谎报 = observable 留痕(含 fact-sheet)')
    // transitional:rounds>0 过渡性收口文本
    const tr = runFinishGates({ state: createGateChainState(), garbled: false, rounds: 1, finalContent: '好的,我先看看当前数据', todos: [], isSubagent: false, turnUsage: usage, isWriteToolByName: isW, messages: msgs })
    assert(tr?.kind === 'feedback' && tr.gate.stage === 'transitional_retry', '✓ runFinishGates → 过渡性收口回灌')
    // 问句意图豁免(2026-09-02,nested-demo 实测):用户问「你能修改嵌套层级么」,模型用含「write/写入」
    // 字样的说明表格作答 —— 叙述门禁不回灌(纯文本作答合法);同款叙述文本在祈使消息下照常回灌
    const qMsgs = [{ _getType: () => 'human', content: '你能修改嵌套层级么' }]
    const narrationTable = '**可以。** 结构如下:\n\n| 操作 | 说明 |\n|---|---|\n| **加深层级** | 用 write 增量 patch 写入 |\n\n层级不受深度限制,直接说,我照做。'
    const qExempt = runFinishGates({ state: createGateChainState(), garbled: false, rounds: 0, finalContent: narrationTable, todos: [], isSubagent: false, turnUsage: usage, isWriteToolByName: isW, messages: qMsgs })
    assert(qExempt === null, '✓ runFinishGates 问句豁免 → 问句消息下的说明性叙述不回灌(nested-demo 实测事故句)')
    const impMsgs = [{ _getType: () => 'human', content: '修改嵌套层级,把商品列表包进新section' }]
    const impFired = runFinishGates({ state: createGateChainState(), garbled: false, rounds: 0, finalContent: narrationTable, todos: [], isSubagent: false, turnUsage: usage, isWriteToolByName: isW, messages: impMsgs })
    assert(impFired?.kind === 'feedback' && impFired.gate.stage === 'transitional_retry', '✓ runFinishGates 问句豁免边界 → 祈使消息下同款叙述照常回灌(豁免不弱化反幻觉)')
    // 预算池独立:transitional 耗尽不影响完结门禁
    const mixState = createGateChainState()
    mixState.transitionalRetries = 2
    const mix = runFinishGates({ state: mixState, garbled: false, rounds: 1, finalContent: '完成', todos, isSubagent: false, turnUsage: usage, isWriteToolByName: isW, messages: msgs })
    assert(mix?.kind === 'feedback' && mix.gate.stage === 'completion_gate', '✓ runFinishGates → transitional 预算耗尽不侵占完结门禁(独立池)')
  }
}
