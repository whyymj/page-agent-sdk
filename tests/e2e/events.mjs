// 事件:hook 返回取消函数 / onEvent + hook 联动 / 多监听器 + off 重复调用安全
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'
import { stubModel } from './_stub-model.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:events] sdk.hook 返回取消函数')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-hook', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '标题' },
    })
    await sdk.mount()
    const off = sdk.hook(() => {})
    assert(typeof off === 'function', 'sdk.hook 返回取消函数(function)')
    off()
    sdk.unmount()
  }

  console.log('[e2e:events] onEvent + sdk.hook 联动(构造时 onEvent 与运行时 hook 均注册)')
  {
    globalThis.window.app = {}
    let onEventCount = 0, hookCount = 0
    const sdk = createChatSdk({
      ui: false, id: 'e2e-events', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '标题' },
      onEvent: () => { onEventCount++ },
    })
    await sdk.mount()
    const off = sdk.hook(() => { hookCount++ })
    assert(typeof off === 'function' && onEventCount === 0 && hookCount === 0, 'onEvent + hook 均挂载,未触发前计数为 0')
    off()
    sdk.unmount()
  }

  console.log('[e2e:events] hook 多监听器 + off 重复调用安全')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-hook-multi', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    let c1 = 0, c2 = 0
    const off1 = sdk.hook(() => { c1++ })
    const off2 = sdk.hook(() => { c2++ })
    assert(typeof off1 === 'function' && typeof off2 === 'function', '注册两个 hook 均返回取消函数')
    off1()
    off1()
    off2()
    assert(c1 === 0 && c2 === 0, '未触发事件前两监听器计数均为 0')
    sdk.unmount()
  }

  console.log('[e2e:events] sdk.usage 累计 token 用量(初始 0,字段齐全)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-usage', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' } },
    })
    await sdk.mount()
    const u = sdk.usage
    assert(u && typeof u === 'object', 'sdk.usage 存在(对象)')
    assert(u.prompt_tokens === 0 && u.completion_tokens === 0 && u.total_tokens === 0, '初始用量全为 0(无 LLM 调用)')
    sdk.unmount()
  }

  console.log('[e2e:events] ✓ usage 事件与 sdk.usage 反映 reasoning_tokens(reasoning-tokens-observability;completion 子集单独累计)')
  {
    const llm = stubModel({ text: 'ok', usage: { prompt_tokens: 10, completion_tokens: 100, total_tokens: 110, completion_tokens_details: { reasoning_tokens: 60 } } })
    const events = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-usage-reasoning', storage: 'memory', llm, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' } },
      onEvent: (e) => { if (e.type === 'usage') events.push(e) },
    })
    await sdk.mount()
    await sdk.send('x')
    const ue = events[events.length - 1]
    assert(ue && ue.usage.reasoning_tokens === 60, '✓ usage 事件 round usage 带 reasoning_tokens(60,原始 completion_tokens_details 归一)')
    assert(ue && ue.cumulative.reasoning_tokens === 60 && ue.cumulative.completion_tokens === 100, '✓ usage 事件 cumulative 透传 reasoning(60)且 completion 不受影响(子集不加数)')
    assert(sdk.usage.reasoning_tokens === 60, '✓ sdk.usage.reasoning_tokens 累计(60)')
    sdk.unmount()
  }

  console.log('[e2e:events] ✓ 无 reasoning 细分 → 字段省略不占位(Anthropic 依赖栈现状;旧三字段逐位不变)')
  {
    const llm = stubModel({ text: 'ok', usage: { prompt_tokens: 10, completion_tokens: 40, total_tokens: 50 } })
    const events = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-usage-noreason', storage: 'memory', llm, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' } },
      onEvent: (e) => { if (e.type === 'usage') events.push(e) },
    })
    await sdk.mount()
    await sdk.send('x')
    const ue = events[events.length - 1]
    assert(ue && ue.usage.reasoning_tokens === undefined && ue.cumulative.reasoning_tokens === undefined, '✓ 无 reasoning 细分 → usage/cumulative 均不携带(不置 0 不占位)')
    assert(ue && ue.usage.prompt_tokens === 10 && ue.usage.completion_tokens === 40 && ue.usage.total_tokens === 50, '✓ 旧三字段行为逐位不变')
    sdk.unmount()
  }

  console.log('[e2e:events] session_restored 事件类型可订阅(switchSession 切回已存会话不报错;真实快照触发需 LLM 造数据,e2e 用 FAKE_LLM 仅验证类型系统)')
  {
    let restored = null
    const sdk = createChatSdk({
      ui: false, id: 'e2e-restore', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' } },
      onEvent: (e) => { if (e.type === 'session_restored') restored = e },
    })
    await sdk.mount()
    const sid2 = await sdk.switchSession()  // 新建空会话(无快照,不发 session_restored)
    assert(typeof sid2 === 'string', 'switchSession 返回新会话 id')
    // 切回原会话(无快照不发事件,验证不报错 + 类型可订阅)
    await sdk.switchSession('e2e-restore')
    // restored 可能为 null(无快照)或对象(有快照);两种均合法,仅验证不报错
    assert(restored === null || (typeof restored.sessionId === 'string' && typeof restored.rounds === 'number'), 'session_restored 事件类型正确(有快照时含 sessionId/rounds,无快照时不发)')
    sdk.unmount()
  }

  console.log('[e2e:events] P1-23 → 不传 options.onEvent 时 sdk.hook 也能收到流式事件(headless 常见路径;修复 emit 恒调用)')
  {
    const types = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-hook-stream', storage: false, llm: stubModel({ text: '流式回复' }), capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' } },
    })
    await sdk.mount()
    const off = sdk.hook((e) => { types.push(e.type) })
    // 直接调 stream(headless 路径,构造时不传 onEvent):bug 是 userOnEvent 缺失 → emit 不调用 → hook 收不到流式事件
    await sdk.stream([{ role: 'user', content: 'hi', timestamp: Date.now() }], () => {})
    off()
    assert(types.includes('done'), 'P1-23 → 不传 onEvent 时 hook 收到流式 done 事件(修复:emit 恒调用)')
    assert(types.some((t) => ['text', 'round_start'].includes(t)), 'P1-23 → hook 收到流式过程事件(text/round_start)')
    sdk.unmount()
  }

  console.log('[e2e:events] F1 → send() 路径全量事件外发(headless 自建 UI 经 sdk.hook 听全字段,原只 emit error)')
  {
    const types = []
    const llm = stubModel(
      { toolCalls: [{ name: 'read', args: { jsonPath: 'title' } }] },
      { text: '已读取' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-send-events', storage: false, llm, capabilities: MIN_CAPS, autoTitle: false,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' } },
    })
    await sdk.mount()
    const off = sdk.hook((e) => { types.push(e.type) })
    await sdk.send('读一下标题')
    off()
    // 过程事件:send 路径原只 emit error,现全量(headless send 用户可见工具调用/轮次/收口)
    assert(types.includes('tool_call') && types.includes('tool_result'), 'F1 → send() 经 hook 收到 tool_call/tool_result 事件')
    assert(types.includes('round_start') && types.includes('done'), 'F1 → send() 经 hook 收到 round_start/done 事件')
    assert(!types.includes('approval_request'), 'F1 → send() 路径 approval_request 仍不外发(无 UI 响应方,由 30s 自动拒收口)')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
