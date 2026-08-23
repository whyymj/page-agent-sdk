/**
 * sec-102:evidence-audit-gate A1+A2(evidence 审计门禁)
 * 覆盖:A2 触发(本 invoke 翻转 completed × evidence path 形态 × 会话累计零重叠)→ 回灌三出口文案;
 * 覆盖/批写非首路径/描述性证据/跨 invoke 会话累计/预算耗尽 observable/wrap-up 补跑;A1 rider(完结门禁
 * 文案追加 evidence 空项)+ usageHints 引导段;纯函数 extractEvidencePaths/isEvidenceCovered。
 */
import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
import { createAgent } from '../../harness/createAgent'
import { createTodosMiddleware } from '../../harness/todos'
import { createUsageHintsMiddleware } from '../../harness/usageHints'
import { auditEvidenceOffenders } from '../../harness/gateChain'
import { extractEvidencePaths, isEvidenceCovered } from '../../harness/actionGate'
import { buildGateFeedback } from '../../harness/todos'
import type { Middleware } from '../../harness/middleware'
import type { HarnessState } from '../../harness/state'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, AIMessageChunk } from '@langchain/core/messages'
import type { TestCtx } from './_ctx'

/** 脚本化 LLM(照 sec-100/101):按序 [tool_call...];越界回落纯文本「完成」 */
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

interface RunOpts {
  script: Array<{ tool?: { name: string; args: Record<string, unknown> } }>
  maxToolRounds?: number
  secondInvoke?: { script: Array<{ tool?: { name: string; args: Record<string, unknown> } }>; prompt: string }
}

/** 裑写数据 schema:components 数组双元素(批写非首路径场景用) */
function makeTools() {
  const bind: any = { components: [{ type: 'card', title: 'a' }, { type: 'card', title: 'b' }] }
  const tools = createDataOps(
    { schema: z.object({ components: z.array(z.object({ type: z.string(), title: z.string() })) }), bind, description: '组件' },
    {},
  )
  return { tools, bind }
}

async function runLoop(o: RunOpts) {
  const { tools } = makeTools()
  const todosMw = createTodosMiddleware([])
  const allTools = [...tools, ...((todosMw.tools as any[]) ?? [])]
  const captured: any[][] = []
  const events: any[] = []
  const captureMw: Middleware = {
    name: 'capture',
    wrapModelCall: async (req, next) => { captured.push([...req.messages]); return next(req) },
  }
  const agent = createAgent({
    llm: new ScriptLLM(o.script) as any,
    tools: allTools,
    middleware: [todosMw, captureMw],
    maxToolRounds: o.maxToolRounds ?? 10,
    maxRetries: 0,
  })
  let final = ''
  await agent.stream([{ role: 'user', content: '按任务清单处理', timestamp: Date.now() }], (e: any) => { if (e.type === 'done') final = e.content; if (e.type === 'error') events.push(e) }, undefined)
  // 第二 invoke(跨 invoke 会话累计场景):同一 agent 再 stream(闭包 auditWritePaths 持续累积)
  if (o.secondInvoke) {
    captured.length = 0
    ;(agent as any).llm = new ScriptLLM(o.secondInvoke.script)
    await agent.stream([{ role: 'user', content: o.secondInvoke.prompt, timestamp: Date.now() }], (e: any) => { if (e.type === 'done') final = e.content; if (e.type === 'error') events.push(e) }, undefined)
  }
  return { agent, final, captured, events }
}

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // ===== 1. A2 触发:编造路径(写 components.0,evidence 填 components.9)=====
  {
    const r = await runLoop({
      script: [
        { tool: { name: 'write_todos', args: { todos: [{ content: '任务A', status: 'pending' }] } } },
        { tool: { name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.title', value: '新标题' } } } },
        { tool: { name: 'update_todo', args: { id: 't-1', status: 'completed', evidence: 'components.9' } } },
      ],
    })
    const logs = (r.agent.debugLogs.value as any[]).filter((l) => l.data?.stage === 'evidence_audit_gate')
    assert(logs.length >= 1 && logs[0].data.offenders?.[0]?.id === 't-1', `✓ A2 触发 → 编造路径回灌(实测 ${logs.length} 次)`)
    const withFeedback = r.captured.filter((msgs) => msgs.some((m) => String((m as any).content ?? '').includes('该路径从未被写入')))
    assert(withFeedback.length >= 1, '✓ A2 触发 → 回灌文案含「该路径从未被写入」')
    assert(r.captured.some((msgs) => msgs.some((m) => String((m as any).content ?? '').includes('components.9'))), '✓ A2 触发 → 回灌文案钉出编造路径')
    // 预算 2 耗尽 → AUDIT_GATE_EXHAUSTED observable + 放行
    assert(r.events.some((e) => e.code === 'AUDIT_GATE_EXHAUSTED'), '✓ A2 预算 → 2 次耗尽放行 + observable 留痕')
    assert(r.final === '完成', '✓ A2 预算 → 耗尽后放行收口')
  }

  // ===== 2. 真实路径(evidence = 实际写入路径)零触发 =====
  {
    const r = await runLoop({
      script: [
        { tool: { name: 'write_todos', args: { todos: [{ content: '任务A', status: 'pending' }] } } },
        { tool: { name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.title', value: '新标题' } } } },
        { tool: { name: 'update_todo', args: { id: 't-1', status: 'completed', evidence: 'components.0.title' } } },
      ],
    })
    const logs = (r.agent.debugLogs.value as any[]).filter((l) => l.data?.stage === 'evidence_audit_gate')
    assert(logs.length === 0, `✓ A2 覆盖 → evidence=实际写入路径零触发(实测 ${logs.length} 次)`)
    assert(r.events.length === 0, '✓ A2 覆盖 → 零 observable')
  }

  // ===== 3. 批量 patches 非首路径(P0-1 回归锁:writePaths 只记 patches[0],effectiveWritePaths 全量)=====
  {
    const r = await runLoop({
      script: [
        { tool: { name: 'write_todos', args: { todos: [{ content: '批量改', status: 'pending' }] } } },
        { tool: { name: 'write', args: { patches: [{ op: 'set', jsonPath: 'components.0.title', value: 'x' }, { op: 'set', jsonPath: 'components.1.title', value: 'y' }] } } },
        { tool: { name: 'update_todo', args: { id: 't-1', status: 'completed', evidence: 'components.1.title' } } },
      ],
    })
    const logs = (r.agent.debugLogs.value as any[]).filter((l) => l.data?.stage === 'evidence_audit_gate')
    assert(logs.length === 0, `✓ A2 批写 → evidence=patches 非首路径不误伤(effectiveWritePaths 全量,实测 ${logs.length} 次)`)
  }

  // ===== 4. 描述性证据(无路径形态)不核对 =====
  {
    const r = await runLoop({
      script: [
        { tool: { name: 'write_todos', args: { todos: [{ content: '委派任务', status: 'pending' }] } } },
        { tool: { name: 'update_todo', args: { id: 't-1', status: 'completed', evidence: '已委派子 agent 完成,无主写路径' } } },
      ],
    })
    const logs = (r.agent.debugLogs.value as any[]).filter((l) => l.data?.stage === 'evidence_audit_gate')
    assert(logs.length === 0, `✓ A2 描述性 → 无路径形态不核对(宁漏勿误,实测 ${logs.length} 次)`)
  }

  // ===== 5. 跨 invoke 会话累计:上轮写入,本轮标 completed(评审 A-5 回归锁)=====
  {
    const r = await runLoop({
      script: [
        { tool: { name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.title', value: '第一轮写入' } } } },
      ],
      secondInvoke: {
        prompt: '标记完成',
        script: [
          { tool: { name: 'write_todos', args: { todos: [{ content: '上轮的任务', status: 'pending' }] } } },
          { tool: { name: 'update_todo', args: { id: 't-1', status: 'completed', evidence: 'components.0.title' } } },
        ],
      },
    })
    const logs = (r.agent.debugLogs.value as any[]).filter((l) => l.data?.stage === 'evidence_audit_gate')
    assert(logs.length === 0, `✓ A2 跨 invoke → 上轮写本轮标 completed 零误伤(会话累计基线,实测 ${logs.length} 次)`)
  }

  // ===== 6. wrap-up 补跑:轮次耗尽强制收口,审计违例 observable =====
  {
    const r = await runLoop({
      maxToolRounds: 2,
      script: [
        { tool: { name: 'write_todos', args: { todos: [{ content: '任务A', status: 'pending' }] } } },
        { tool: { name: 'update_todo', args: { id: 't-1', status: 'completed', evidence: 'components.9' } } },
      ],
    })
    const logs = (r.agent.debugLogs.value as any[]).filter((l) => l.data?.stage === 'evidence_audit_flagged')
    assert(logs.length === 1, `✓ A2 wrap-up → 轮次耗尽补跑审计留痕(实测 ${logs.length} 次)`)
    assert(r.events.some((e) => e.code === 'AUDIT_EVIDENCE_SUSPECT'), '✓ A2 wrap-up → AUDIT_EVIDENCE_SUSPECT observable')
  }

  // ===== 7. A1 rider:完结门禁文案追加「已完成但 evidence 空」项 =====
  {
    const fb = buildGateFeedback([
      { id: 't-1', content: '未完成项', status: 'in_progress' },
      { id: 't-2', content: '已完成无证据', status: 'completed' },
    ] as any[])
    assert(fb.includes('任务未完成') && fb.includes('1 项未完成'), '✓ A1 rider → 完结门禁主文案保留')
    assert(fb.includes('evidence 为空') && fb.includes('#t-2'), '✓ A1 rider → 追加已完成空 evidence 项(只搭车不新增触发)')
    const fb2 = buildGateFeedback([{ id: 't-1', content: 'x', status: 'pending' }, { id: 't-2', content: 'y', status: 'completed', evidence: 'components.0' }] as any[])
    assert(!fb2.includes('evidence 为空'), '✓ A1 rider → 全部有 evidence 不追加')
    // F2 误伤修复:快照标记「跨轮已 completed」的遗留项不进 rider(与本 invoke 翻转项区分)
    const fb3 = buildGateFeedback(
      [
        { id: 't-old', content: '旧任务', status: 'completed' },        // 跨轮遗留(快照已 completed)→ 不列
        { id: 't-new', content: '新任务', status: 'completed' },        // 本 invoke 翻转 → 列
        { id: 't-p', content: '待办', status: 'pending' },
      ] as any[],
      new Map([['t-old', { status: 'completed', content: '旧任务' }]]),
    )
    assert(!fb3.includes('#t-old') && fb3.includes('#t-new'), '✓ A1 rider(F2)→ 只列本 invoke 翻转的空 evidence 项,跨轮遗留不发难')
    // id 复用防线(真 LLM 探针 S2 实证):同 id 新任务撞旧 completed 记录,仅凭 status 会漏审 —— content 不同 = 本轮翻转
    const offenders2 = auditEvidenceOffenders(
      [{ id: 't-1', content: '新任务BBB', status: 'completed', evidence: 'components.9' }] as any[],
      new Map([['t-1', { status: 'completed', content: '旧任务AAA' }]]),
      ['components.0.props.title'],
    )
    assert(offenders2.length === 1, `✓ A2 id 复用 → 同 id 新任务(content 不同)不因旧 completed 记录漏审(实测 ${offenders2.length} 项)`)
  }

  // ===== 8. usageHints 引导段(A1 引导与机制同 ship)=====
  {
    const mw = createUsageHintsMiddleware(undefined, false)
    const st = { rounds: 0 } as unknown as HarnessState
    const out = (mw.augmentPrompt as (st: HarnessState) => string | undefined)(st) ?? ''
    assert(out.includes('update_todo 标 completed 时附 evidence'), '✓ A1 引导 → usageHints 无条件段教 evidence(独立教学段)')
  }

  // ===== 9. 纯函数 =====
  {
    assert(extractEvidencePaths('已写入 components.2.title').join() === 'components.2.title', '✓ extractEvidencePaths → 中文混排提取路径')
    assert(extractEvidencePaths('$.components[0].title').join() === 'components.0.title', '✓ extractEvidencePaths → $/[n] 归一点分形态')
    assert(extractEvidencePaths('已委派完成,无路径').length === 0, '✓ extractEvidencePaths → 描述性文本零提取')
    assert(extractEvidencePaths('e.g. 说明文字没有路径形态').length === 1, '✓ extractEvidencePaths → 英文缩写点号也按路径形态提取(宽松口径,靠回灌出口③兜底)')
    assert(isEvidenceCovered(['components.2.title'], ['components.2']), '✓ isEvidenceCovered → 祖先-后代重叠')
    assert(isEvidenceCovered(['anything.here'], ['']), '✓ isEvidenceCovered → ROOT(整体写)全覆盖')
    assert(!isEvidenceCovered(['components2.x'], ['components.0']), '✓ isEvidenceCovered → components ≠ components2 分隔符纪律')
    assert(!isEvidenceCovered(['components.9'], []), '✓ isEvidenceCovered → 空基线不覆盖')
    // auditEvidenceOffenders:审计面 = 本 invoke 翻转(跨轮遗留不审,P0-2)
    const startMap = new Map([['t-old', { status: 'completed', content: '旧完成' }]])
    const todos = [
      { id: 't-old', content: '旧完成', status: 'completed', evidence: 'nowhere.9' },  // 跨轮遗留:不在审计面
      { id: 't-new', content: '新完成', status: 'completed', evidence: 'nowhere.9' },  // 本轮翻转 + 编造路径:违例
      { id: 't-desc', content: '描述性', status: 'completed', evidence: '如实说明' },  // 本轮翻转但无路径形态:不违例
    ] as any[]
    const offenders = auditEvidenceOffenders(todos, startMap, [])
    assert(offenders.length === 1 && offenders[0].id === 't-new', `✓ auditEvidenceOffenders → 只审本 invoke 翻转×路径形态×零重叠(实测 ${offenders.length} 项)`)
  }
}
