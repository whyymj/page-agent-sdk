// evidence-audit e2e:evidence 审计门禁 A2 + A1 rider(stub model 驱动真 ReAct)
//  - 编造路径:本 invoke 标 completed + evidence path 形态 + 会话累计写路径零重叠 → 回灌三出口,修正后放行
//  - 真实路径:零触发零额外轮次
//  - A1 rider:完结门禁回灌文案追加「已完成但 evidence 为空」项(只搭车,零新触发,轮次结构与旧版一致)
import { setupEnv, createAssert, createChatSdk, z, defineTool } from './_helpers.mjs'
import { stubModel } from './_stub-model.mjs'

const CAPS = { fetch: false, skills: false, vfs: false, summarization: false, memory: false, subagent: false }
const SCHEMA = z.object({ components: z.array(z.object({ type: z.string(), title: z.string() })) })

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:evidence-audit] A2 → 编造 evidence 路径被拦,修正后放行')
  {
    // 队列:① write 真实写 components.0.title ② write_todos ③ update_todo t-1 completed 证据编 components.9
    //       ④ 纯文本欲收口 → A2 回灌 ⑤ update_todo 修正 evidence ⑥ 纯文本收口(放行)
    const model = stubModel(
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.title', value: '新标题' } } }] },
      { toolCalls: [{ name: 'write_todos', args: { todos: [{ content: '改标题', status: 'pending' }] } }] },
      { toolCalls: [{ name: 'update_todo', args: { id: 't-1', status: 'completed', evidence: 'components.9' } }] },
      { text: '已完成改标题。' },
      { toolCalls: [{ name: 'update_todo', args: { id: 't-1', evidence: 'components.0.title' } }] },
      { text: '完成:components.0.title 已写入。' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-audit-fake', storage: false, llm: model, capabilities: CAPS,
      data: { schema: SCHEMA, bind: { components: [{ type: 'card', title: 'a' }] } },
    })
    await sdk.mount()
    const reply = await sdk.send('改第一个组件的标题')
    assert(reply.includes('完成'), '✓ A2 e2e → 修正后正常收口')
    assert(model.calls === 6, `✓ A2 e2e → 模型被调 6 次(A2 回灌 +1;实际 ${model.calls})`)
    const logs = sdk.debugLogs.value.filter((l) => l.data?.stage === 'evidence_audit_gate')
    assert(logs.length === 1, `✓ A2 e2e → debugLogs 留痕恰 1 次(实际 ${logs.length})`)
    assert(logs[0]?.data?.offenders?.[0]?.id === 't-1' && logs[0]?.data?.offenders?.[0]?.evidence === 'components.9', '✓ A2 e2e → 留痕含违例项 id+编造路径')
    const t = (sdk.inspect().todos ?? []).find((x) => x.id === 't-1')
    assert(t?.evidence === 'components.0.title', `✓ A2 e2e → 终态 evidence 已修正(实际 ${t?.evidence})`)
    sdk.unmount()
  }

  console.log('[e2e:evidence-audit] A2 → evidence=真实写入路径零触发零额外轮次')
  {
    const model = stubModel(
      { toolCalls: [{ name: 'write_todos', args: { todos: [{ content: '改标题', status: 'pending' }] } }] },
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.title', value: '新标题' } } }] },
      { toolCalls: [{ name: 'update_todo', args: { id: 't-1', status: 'completed', evidence: 'components.0.title' } }] },
      { text: '完成:components.0.title 已写入。' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-audit-ok', storage: false, llm: model, capabilities: CAPS,
      data: { schema: SCHEMA, bind: { components: [{ type: 'card', title: 'a' }] } },
    })
    await sdk.mount()
    const reply = await sdk.send('改第一个组件的标题')
    assert(reply.includes('完成'), '✓ A2 e2e 覆盖 → 正常收口')
    assert(model.calls === 4, `✓ A2 e2e 覆盖 → 零额外轮次(实际 ${model.calls})`)
    assert(!sdk.debugLogs.value.some((l) => l.data?.stage === 'evidence_audit_gate'), '✓ A2 e2e 覆盖 → 零 evidence_audit_gate 留痕')
    sdk.unmount()
  }

  console.log('[e2e:evidence-audit] A1 rider → 完结门禁回灌文案追加已完成空 evidence 项')
  {
    const model = stubModel(
      { toolCalls: [{ name: 'write_todos', args: { todos: [{ content: '加横幅', status: 'pending' }, { content: '改标题', status: 'pending' }] } }] },
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.title', value: 'x' } } }] },
      { toolCalls: [{ name: 'update_todo', args: { id: 't-1', status: 'completed' } }] }, // 无 evidence
      { text: '都做完了。' }, // t-2 仍 pending → 完结门禁回灌,文案应追加「t-1 已完成但 evidence 为空」rider
      { toolCalls: [{ name: 'update_todo', args: { id: 't-2', status: 'completed', evidence: 'components.0.title' } }] },
      { text: '全部完成。' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-audit-rider', storage: false, llm: model, capabilities: CAPS,
      data: { schema: SCHEMA, bind: { components: [{ type: 'card', title: 'a' }] } },
    })
    await sdk.mount()
    const reply = await sdk.send('加横幅并改标题')
    assert(reply.includes('全部完成'), '✓ A1 rider e2e → 回灌续跑后正常收口')
    const gateLogs = sdk.debugLogs.value.filter((l) => l.data?.stage === 'completion_gate')
    assert(gateLogs.length === 1, `✓ A1 rider e2e → 完结门禁仍恰 1 次(rider 只搭车不新增触发;实际 ${gateLogs.length})`)
    assert(model.calls === 6, `✓ A1 rider e2e → 轮次结构与旧版一致(实际 ${model.calls})`)
    sdk.unmount()
  }

  console.log('[e2e:evidence-audit] defineTool writeCapable → 零工具门禁不误伤结构工具流')
  {
    // editor 诊断驱动(2026-08-23):「清空页面」类纯结构操作走宿主 delete_component,旧口径 write×0 被误拦 2 次
    const del = defineTool({
      name: 'delete_component', description: '删除组件(原生流程)', writeCapable: true,
      schema: z.object({ nodeId: z.string() }), handler: () => '已删除',
    })
    const model = stubModel(
      { toolCalls: [{ name: 'delete_component', arguments: { nodeId: 'n1' } }] },
      { text: '页面已清空。' },
    )
    const sdk = createChatSdk({ ui: false, id: 'e2e-writecap', storage: false, llm: model, capabilities: { fetch: false, skills: false, vfs: false, summarization: false, memory: false, subagent: false }, tools: [del] })
    await sdk.mount()
    const reply = await sdk.send('清空页面')
    assert(reply.includes('已清空'), '✓ writeCapable e2e → 结构工具流正常收口')
    assert(model.calls === 2, `✓ writeCapable e2e → 零工具门禁零误伤(2 次调用即收口;实际 ${model.calls})`)
    assert(!sdk.debugLogs.value.some((l) => l.data?.stage === 'zero_tool_gate'), '✓ writeCapable e2e → zero_tool_gate 零触发')
    sdk.unmount()
  }

  return ctx
}
