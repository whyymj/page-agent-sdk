// instruction-adherence e2e:完结门禁 + 问句意图守卫(stub model 驱动真 ReAct)
//  - 完结门禁:todos 有未完成项却纯文本收尾 → 回灌「双出口」反馈续跑(≤2 次);问句收尾豁免;无 todos 不触发
//  - 问句意图守卫:问句消息 → system 注入「先答勿做」pin 段 + debugLogs 留痕;祈使句不注入
import { setupEnv, createAssert, createChatSdk } from './_helpers.mjs'
import { stubModel } from './_stub-model.mjs'

// planning 保留(write_todos/update_todo 需要);其余能力关闭隔离变量
const CAPS = { fetch: false, skills: false, vfs: false, summarization: false, memory: false, subagent: false }

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:instruction-adherence] 完结门禁 → 未完成 todos 收尾被回灌续跑')
  {
    // 队列:① write_todos 2 项 ② update_todo t-1 完成 ③ 纯文本欲收口(t-2 仍 pending)→ 门禁回灌
    //       ④ update_todo t-2 完成 ⑤ 纯文本收口(全 completed,放行)
    const llm = stubModel(
      { toolCalls: [{ name: 'write_todos', args: { todos: [{ content: '加横幅', status: 'pending' }, { content: '改标题', status: 'pending' }] } }] },
      { toolCalls: [{ name: 'update_todo', args: { id: 't-1', status: 'completed' } }] },
      { text: '任务都做完了。' },   // 未标 t-2 → 应被门禁拦下
      { toolCalls: [{ name: 'update_todo', args: { id: 't-2', status: 'completed' } }] },
      { text: '全部完成:横幅已加、标题已改。' },
    )
    const sdk = createChatSdk({ ui: false, id: 'e2e-gate-cont', storage: false, llm, capabilities: CAPS })
    await sdk.mount()
    const reply = await sdk.send('帮我加横幅并改标题')
    assert(reply.includes('全部完成'), '✓ 完结门禁 e2e → 回灌续跑后正常收口(最终回复来自第 5 段)')
    assert(llm.calls === 5, `✓ 完结门禁 e2e → 模型被调 5 次(无门禁会是 3 次;实际 ${llm.calls})`)
    const gateLogs = sdk.debugLogs.value.filter((l) => l.data?.stage === 'completion_gate')
    assert(gateLogs.length === 1, `✓ 完结门禁 e2e → debugLogs 留痕恰 1 次(实际 ${gateLogs.length})`)
    assert(JSON.stringify(gateLogs[0]?.data?.pending) === JSON.stringify(['t-2']), '✓ 完结门禁 e2e → 留痕含未完成项 id(t-2)')
    const todos = sdk.inspect().todos
    assert(Array.isArray(todos) && todos.every((t) => t.status === 'completed'), '✓ 完结门禁 e2e → 终态 todos 全 completed')
    sdk.unmount()
  }

  console.log('[e2e:instruction-adherence] 完结门禁边界 → 无 todos 会话正常收口零回灌')
  {
    const llm = stubModel({ text: '直接回答,无需规划。' })
    const sdk = createChatSdk({ ui: false, id: 'e2e-gate-none', storage: false, llm, capabilities: CAPS })
    await sdk.mount()
    const reply = await sdk.send('你好')
    assert(reply.includes('直接回答'), '✓ 完结门禁 e2e 边界 → 无 todos 正常收口')
    assert(llm.calls === 1, `✓ 完结门禁 e2e 边界 → 仅 1 次模型调用,零回灌(实际 ${llm.calls})`)
    assert(!sdk.debugLogs.value.some((l) => l.data?.stage === 'completion_gate'), '✓ 完结门禁 e2e 边界 → 无 completion_gate 留痕')
    sdk.unmount()
  }

  console.log('[e2e:instruction-adherence] 完结门禁豁免 → 未完成但问号收尾征询用户不拦')
  {
    const llm = stubModel(
      { toolCalls: [{ name: 'write_todos', args: { todos: [{ content: '改配色', status: 'pending' }] } }] },
      { text: '配色有方案 A(暖色)和方案 B(冷色),你想保留哪个?' },  // 问句收尾 → 豁免,直接返回
    )
    const sdk = createChatSdk({ ui: false, id: 'e2e-gate-ask', storage: false, llm, capabilities: CAPS })
    await sdk.mount()
    const reply = await sdk.send('帮我改配色')
    assert(reply.includes('哪个?') || reply.includes('哪个？'), '✓ 完结门禁 e2e 豁免 → 征询问句原样返回给用户')
    assert(llm.calls === 2, `✓ 完结门禁 e2e 豁免 → 仅 2 次调用,问号收尾未被拦(实际 ${llm.calls})`)
    assert(!sdk.debugLogs.value.some((l) => l.data?.stage === 'completion_gate'), '✓ 完结门禁 e2e 豁免 → 无 gate 留痕')
    sdk.unmount()
  }

  console.log('[e2e:instruction-adherence] 完结门禁预算 → 连续无视回灌 ≤2 次后放行(不死循环)')
  {
    // 模型始终只写 todos 不收尾标记:① write_todos ② text 收口 → gate1 ③ text 再收口 → gate2 ④ text 三收口 → 预算耗尽放行
    const llm = stubModel(
      { toolCalls: [{ name: 'write_todos', args: { todos: [{ content: '永远做不完', status: 'pending' }] } }] },
      { text: '好了。' },
      { text: '真的好了。' },
      { text: '确实是好了。' },
    )
    const sdk = createChatSdk({ ui: false, id: 'e2e-gate-budget', storage: false, llm, capabilities: CAPS })
    await sdk.mount()
    const reply = await sdk.send('做个任务')
    assert(reply === '确实是好了。', '✓ 完结门禁 e2e 预算 → 2 次回灌后放行第 3 次收口(防死循环烧 token)')
    assert(llm.calls === 4, `✓ 完结门禁 e2e 预算 → 恰 4 次调用(1 工具 + 3 收口;实际 ${llm.calls})`)
    sdk.unmount()
  }

  console.log('[e2e:instruction-adherence] 问句守卫 → 问句消息注入「先答勿做」pin 段')
  {
    const llm = stubModel({ text: '这是横幅组件(banner),用于活动页顶部展示。' })
    const sdk = createChatSdk({ ui: false, id: 'e2e-guard-hit', storage: false, llm, capabilities: CAPS })
    await sdk.mount()
    await sdk.send('这是啥组件')
    const sys = llm.systemPrompts[0] || ''
    assert(sys.includes('本轮消息为咨询'), '✓ 问句守卫 e2e → system prompt 注入守卫段(事故句「这是啥组件」命中)')
    assert(sys.includes('不要执行生成/修改/删除操作'), '✓ 问句守卫 e2e → 段内含「勿操作」指引')
    assert(sdk.debugLogs.value.some((l) => l.data?.stage === 'intent_guard'), '✓ 问句守卫 e2e → debugLogs intent_guard 留痕')
    sdk.unmount()
  }

  console.log('[e2e:instruction-adherence] 问句守卫边界 → 祈使句消息不注入')
  {
    const llm = stubModel({ text: '好的,标题已改。' })
    const sdk = createChatSdk({ ui: false, id: 'e2e-guard-miss', storage: false, llm, capabilities: CAPS })
    await sdk.mount()
    await sdk.send('把标题改成干杯')
    const sys = llm.systemPrompts[0] || ''
    assert(!sys.includes('本轮消息为咨询'), '✓ 问句守卫 e2e 边界 → 祈使句不注入守卫段(不误伤操作)')
    assert(!sdk.debugLogs.value.some((l) => l.data?.stage === 'intent_guard'), '✓ 问句守卫 e2e 边界 → 无 intent_guard 留痕')
    sdk.unmount()
  }

  return ctx
}
