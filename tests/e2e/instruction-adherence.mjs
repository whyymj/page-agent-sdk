// instruction-adherence e2e:完结门禁 + 问句意图守卫(stub model 驱动真 ReAct)
//  - 完结门禁:todos 有未完成项却纯文本收尾 → 回灌「双出口」反馈续跑(≤2 次);问句收尾豁免;无 todos 不触发
//  - 问句意图守卫:问句消息 → system 注入「先答勿做」pin 段 + debugLogs 留痕;祈使句不注入
import { setupEnv, createAssert, createChatSdk, z, defineTool } from './_helpers.mjs'
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

  console.log('[e2e:instruction-adherence] 完结门禁陈旧 todos 豁免 → 本轮零工具(纯问答)不触发')
  {
    // 第 1 轮:write_todos 留未完成项 + 问号收尾豁免(todos 滞留未完成,模拟持久化残留)
    // 第 2 轮:无关问候纯文本回答,零工具调用 → rounds===0 → 门禁不得拿陈旧 todos 发难
    const llm = stubModel(
      { toolCalls: [{ name: 'write_todos', args: { todos: [{ content: '旧任务', status: 'pending' }] } }] },
      { text: '方案 A 和方案 B,你想保留哪个?' },   // 问号豁免,todos 滞留
      { text: '你好,有什么可以帮你?' },             // 第 2 轮纯文本 → 门禁必须沉默
    )
    const sdk = createChatSdk({ ui: false, id: 'e2e-gate-stale', storage: false, llm, capabilities: CAPS })
    await sdk.mount()
    await sdk.send('帮我改配色')
    const callsAfterTurn1 = llm.calls
    const reply2 = await sdk.send('你好')
    assert(reply2 === '你好,有什么可以帮你?', '✓ 陈旧 todos 豁免 → 纯问答轮正常收口')
    assert(llm.calls === callsAfterTurn1 + 1, `✓ 陈旧 todos 豁免 → 本轮零工具门禁不触发,无回灌(本轮恰 1 次调用;实际 ${llm.calls - callsAfterTurn1})`)
    assert(!sdk.debugLogs.value.some((l) => l.data?.stage === 'completion_gate'), '✓ 陈旧 todos 豁免 → 全程无 completion_gate 留痕')
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


  console.log('[e2e:instruction-adherence] zero-tool-gate → 操作指令零工具谎报收尾被回灌(事实清单对账)')
  {
    // 队列:① 零工具纯文本谎报「已完成」(无 todos —— 完结门禁盲区)→ zero-tool-gate 回灌(含事实清单)
    //       ② 模型继续执行 write ③ 真实收口(含位置说明)
    const llm = stubModel(
      { text: '已全部修改完成!' },   // 零工具谎报 → 拦
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.title', value: '已改' } } }] },
      { text: '已修改 components.0 的标题,写入路径 components.0.title。' },
    )
    const sdk = createChatSdk({ ui: false, id: 'e2e-ztg-lie', storage: false, llm, capabilities: CAPS, data: { schema: z.object({ components: z.array(z.object({ title: z.string().optional() })) }), bind: { components: [{ title: 'a' }] }, description: 'd' } })
    await sdk.mount()
    const reply = await sdk.send('把标题改成已改')
    assert(reply.includes('components.0'), '✓ zero-tool-gate → 谎报被回灌,续跑后真实收口(含位置说明)')
    assert(llm.calls === 3, `✓ zero-tool-gate → 模型被调 3 次(无门禁 2 次;实际 ${llm.calls})`)
    const gateLogs = sdk.debugLogs.value.filter((l) => l.data?.stage === 'zero_tool_gate')
    assert(gateLogs.length === 1, `✓ zero-tool-gate → debugLogs 留痕恰 1 次(实际 ${gateLogs.length})`)
    assert(String(gateLogs[0]?.data?.factSheet).includes('write×0'), '✓ zero-tool-gate → 事实清单含 write×0 对账事实')
    assert(String(gateLogs[0]?.data?.factSheet).includes('成功写入路径:无'), '✓ zero-tool-gate → 事实清单含「成功写入路径:无」')
    sdk.unmount()
  }

  console.log('[e2e:instruction-adherence] zero-tool-gate 被拒委派 → 全拒不算等效写照常回灌 + 事实清单如实标注(4.9.1 ③)')
  {
    // 委派 use_worker 返回 ERROR: 回灌(组件锁 COMPONENT_BUSY 形态)→ 零等效写,「已完成」收口仍被拦;
    // 事实清单如实呈现「被拒未生效」(不说「零工具」假话),回灌文案含组件锁出口
    const busyWorker = defineTool({ name: 'use_worker', description: '委派 worker 子 agent(测试桩:恒被组件锁拒)', schema: z.object({ task: z.string().optional() }), handler: async () => 'ERROR: {"error":"COMPONENT_BUSY","message":"组件 hero 正被在途委派占用,等其结束后重试"}' })
    const llm = stubModel(
      { toolCalls: [{ name: 'use_worker', args: { task: '改 hero 组件' } }] },
      { text: '已完成!' },   // 委派被拒后谎报 → 应被拦(修前 use_worker×1 计等效写直接放行)
      { text: 'hero 组件改动在途委派占用中被拒,尚未完成,等在途结束后重试 components.0。' },
    )
    const sdk = createChatSdk({ ui: false, id: 'e2e-ztg-rej', storage: false, llm, capabilities: CAPS, tools: [busyWorker] })
    await sdk.mount()
    const reply = await sdk.send('修改 hero 组件的标题')
    assert(llm.calls === 3, `✓ 被拒委派 → 谎报被回灌续跑(模型被调 3 次;实际 ${llm.calls})`)
    const gateLogs = sdk.debugLogs.value.filter((l) => l.data?.stage === 'zero_tool_gate')
    assert(gateLogs.length === 1, `✓ 被拒委派 → 门禁照常触发留痕 1 次(实际 ${gateLogs.length})`)
    assert(String(gateLogs[0]?.data?.factSheet).includes('use_worker×1(其中 1 次被拒未生效'), '✓ 被拒委派 → 事实清单如实标注被拒(防「零工具」假话)')
    assert(reply.includes('components.0'), '✓ 被拒委派 → 最终如实收口(含位置说明)')
    sdk.unmount()
  }

  console.log('[e2e:instruction-adherence] zero-tool-gate 豁免 → 问句/写过/委派过/位置说明不拦')
  {
    // ① 问句消息不拦(「这个功能怎么用?」纯文本答 = 正常)
    {
      const llm = stubModel({ text: '这个功能用于…' })
      const sdk = createChatSdk({ ui: false, id: 'e2e-ztg-q', storage: false, llm, capabilities: CAPS })
      await sdk.mount()
      await sdk.send('这个功能怎么用?')
      assert(sdk.debugLogs.value.filter((l) => l.data?.stage === 'zero_tool_gate').length === 0, '✓ 豁免 → 问句消息零工具纯文本答不拦')
      sdk.unmount()
    }
    // ② 只读消息(非操作祈使)不拦
    {
      const llm = stubModel({ text: '当前有 3 个组件。' })
      const sdk = createChatSdk({ ui: false, id: 'e2e-ztg-ro', storage: false, llm, capabilities: CAPS })
      await sdk.mount()
      await sdk.send('看看现在有几个组件')
      assert(sdk.debugLogs.value.filter((l) => l.data?.stage === 'zero_tool_gate').length === 0, '✓ 豁免 → 只读动词消息不拦')
      sdk.unmount()
    }
    // ③ 本轮有写工具不拦(写过就是做过)
    {
      const llm = stubModel(
        { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: 'x' } } }] },
        { text: '已改好。' },
      )
      const sdk = createChatSdk({ ui: false, id: 'e2e-ztg-wrote', storage: false, llm, capabilities: CAPS, data: { schema: z.object({ title: z.string() }), bind: { title: 'a' }, description: 'd' } })
      await sdk.mount()
      await sdk.send('把标题改成x')
      assert(sdk.debugLogs.value.filter((l) => l.data?.stage === 'zero_tool_gate').length === 0, '✓ 豁免 → 本轮有 write 不拦')
      sdk.unmount()
    }
    // ④ 收口文本已含位置说明(出口①机械化)→ 不二次回灌
    {
      const llm = stubModel({ text: '此前已修改 components.2 的标题(上一轮已写入),无需再改。' })
      const sdk = createChatSdk({ ui: false, id: 'e2e-ztg-loc', storage: false, llm, capabilities: CAPS })
      await sdk.mount()
      await sdk.send('再把标题改一下')
      assert(sdk.debugLogs.value.filter((l) => l.data?.stage === 'zero_tool_gate').length === 0, '✓ 豁免 → 收口含位置说明不二次回灌(出口①)')
      sdk.unmount()
    }
  }

  console.log('[e2e:instruction-adherence] zero-tool-gate 预算 → 连续谎报 ≤2 次后放行 + observable 留痕')
  {
    const llm = stubModel(
      { text: '已完成!' },
      { text: '真的完成了!' },
      { text: '确实完成了!' },
    )
    const sdk = createChatSdk({ ui: false, id: 'e2e-ztg-budget', storage: false, llm, capabilities: CAPS })
    await sdk.mount()
    const errs = []
    sdk.hook((e) => { if (e.type === 'error' && e.code === 'ZERO_TOOL_GATE_EXHAUSTED') errs.push(e) })
    const reply = await sdk.send('把标题改成x')
    assert(llm.calls === 3, `✓ 预算 → 回灌 2 次后第 3 次放行(模型被调 3 次;实际 ${llm.calls})`)
    assert(errs.length === 1, `✓ 预算 → ZERO_TOOL_GATE_EXHAUSTED observable 恰 1 次(实际 ${errs.length})`)
    assert(reply.includes('确实完成'), '✓ 预算 → 放行返回最终文本(不静默吞)')
    sdk.unmount()
  }

  console.log('[e2e:instruction-adherence] flow-robustness transitional 问号豁免 → 方案征询问句不回灌')
  {
    // 问句收尾(方案征询):rounds>0 过渡表态词命中但句尾问号 → 豁免直接收口(模型只被调 2 次)
    const llm = stubModel(
      { toolCalls: [{ name: 'inspect_env', args: {} }] },
      { text: '我先给出两套方案:A 直接改、B 先确认,你选哪套?' },
    )
    const sdk = createChatSdk({ ui: false, id: 'e2e-trans-q', storage: false, llm, capabilities: CAPS })
    await sdk.mount()
    const reply = await sdk.send('有什么方案?')
    assert(llm.calls === 2, `✓ 问句收尾 → transitional 豁免零回灌(模型被调 2 次;实际 ${llm.calls})`)
    assert(/你选哪套\?/.test(reply), '✓ 方案征询文本原样返回(与方案先行 RHC 不冲突)')
    sdk.unmount()
  }
  {
    // 对照:同句去问号 → transitional 回灌 1 次,第 3 次调用收口(豁免不扩大)
    const llm = stubModel(
      { toolCalls: [{ name: 'inspect_env', args: {} }] },
      { text: '我先给出两套方案:A 直接改、B 先确认,你选一套。' },
      { text: '两套方案:A 直接改;B 先确认。你选哪套?' },
    )
    const sdk = createChatSdk({ ui: false, id: 'e2e-trans-nq', storage: false, llm, capabilities: CAPS })
    await sdk.mount()
    const reply = await sdk.send('把标题改了,先给两套方案')
    assert(llm.calls === 3, `✓ 非问句消息 + 非问句过渡表态 → 照常回灌 1 次(模型被调 3 次;实际 ${llm.calls})`)
    assert(/B 先确认/.test(reply), '✓ 回灌后正常收口')
    sdk.unmount()
  }
  {
    // 用户问句意图豁免(2026-09-02,nested-demo 实测):么尾问句 + 模型陈述式说明作答 → 零回灌
    // (修前:叙述门禁只看模型收尾,问句答案被回灌逼成真改页面 —— 未被要求的操作)
    const llm = stubModel(
      { toolCalls: [{ name: 'inspect_env', args: {} }] },
      { text: '**可以。** 层级不受深度限制,用 write 增量 patch 写入即可,不会整页重传。' },
    )
    const sdk = createChatSdk({ ui: false, id: 'e2e-trans-uq', storage: false, llm, capabilities: CAPS })
    await sdk.mount()
    const reply = await sdk.send('你能修改嵌套层级么')
    assert(llm.calls === 2, `✓ 用户问句(么尾)→ 陈述式作答豁免零回灌(模型被调 2 次;实际 ${llm.calls})`)
    assert(/可以/.test(reply), '✓ 说明性作答原样返回')
    sdk.unmount()
  }

  return ctx
}
