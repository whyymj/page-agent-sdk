// fix-hang-and-feedback e2e:挂起有界收口 + 可见性(真跑顶层 send/batch/mount,stub model 驱动)
//  - P1-1:headless send 触发 humanConfirm → 无响应方 → 超时自动拒 + APPROVAL_AUTO_REJECTED error 事件 + send 不挂死
//  - P1-4:send/batch 接 signal —— 已 abort 的 signal → send 立即收口 / batch 全部记 aborted
//  - P1-2:MCP 黑洞端点(不可路由 IP)→ 握手超时 → mount 照常完成,降级跳过该 server
import { setupEnv, createAssert, createChatSdk, z } from './_helpers.mjs'
import { stubModel } from './_stub-model.mjs'

const CAPS = { fetch: false, planning: false, skills: false, vfs: false, summarization: false, memory: false }

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:hang-feedback] P1-1 headless send 征询无响应 → 超时自动拒(不永挂)')
  {
    // 队列:① LLM 调 request_human_confirmation(挂起等确认)② 自动拒后回灌 → LLM 文本收口
    const llm = stubModel(
      { toolCalls: [{ name: 'request_human_confirmation', args: { question: '要采用方案 A 吗?' } }] },
      { text: '好的,已按默认方案继续' },
    )
    const errors = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-hang-approval', storage: false, llm,
      capabilities: { ...CAPS, subagent: false },
      approval: { tools: ['write'], timeoutMs: 150 },  // 无响应方路径:150ms 自动拒(测速)
      onEvent: (e) => { if (e.type === 'error') errors.push(e) },
    })
    await sdk.mount()
    const t0 = Date.now()
    const reply = await sdk.send('帮我改一下')  // 原 bug:此 Promise 永挂(humanConfirm 默认开 + 无 UI 响应方)
    const elapsed = Date.now() - t0
    assert(typeof reply === 'string' && reply.length > 0, '✓ P1-1 send 有界返回(原:永久挂起),LLM 经拒绝结果继续收口')
    assert(elapsed < 10_000, `✓ P1-1 收口耗时 ${elapsed}ms(≈150ms 超时,非永挂)`)
    const autoRej = errors.find((e) => e.code === 'APPROVAL_AUTO_REJECTED')
    assert(!!autoRej, '✓ P1-1 自动拒留痕:APPROVAL_AUTO_REJECTED error 事件(契约 B 可见性)')
    assert(autoRej?.context?.toolName === 'request_human_confirmation', '✓ error 事件含 toolName context')
    sdk.unmount()
  }

  console.log('[e2e:hang-feedback] P1-4 send(signal) 可中断')
  {
    const llm = stubModel({ text: '本不该出现的完整回复' })
    const sdk = createChatSdk({
      ui: false, id: 'e2e-hang-send-signal', storage: false, llm,
      capabilities: { ...CAPS, subagent: false },
    })
    await sdk.mount()
    const ac = new AbortController()
    ac.abort()  // 预先 abort:send 应立即收口(首轮检查 signal.aborted 即停)
    const reply = await sdk.send('hi', { signal: ac.signal })
    assert(reply === '', '✓ P1-4 已 abort 的 signal → send 立即收口返回空(signal 真穿透到 invoke;原:send 完全不可中断)')
    sdk.unmount()
  }

  console.log('[e2e:hang-feedback] P1-4 batch(signal) 可中断(剩余任务记 aborted)')
  {
    const llm = stubModel({ text: 'x' })
    const sdk = createChatSdk({
      ui: false, id: 'e2e-hang-batch-signal', storage: false, llm,
      capabilities: { ...CAPS, subagent: false },
    })
    await sdk.mount()
    const ac = new AbortController()
    ac.abort()
    const results = await sdk.batch(['任务1', '任务2'], undefined, ac.signal)
    assert(results.length === 2 && results.every((r) => r.ok === false && /aborted/.test(r.error)), '✓ P1-4 已 abort → batch 全部任务记 aborted,不静默跑(不丢不瞒)')
    sdk.unmount()
  }

  console.log('[e2e:hang-feedback] P1-2 MCP 黑洞端点握手超时 → mount 降级完成')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-hang-mcp', storage: false, llm: stubModel({ text: 'ok' }),
      capabilities: { ...CAPS, subagent: false },
      // 不可路由 IP = 黑洞(SYN 被吞,握手永挂);timeoutMs 300 测速 —— 原 bug:initDone 永挂 → mount 永不 resolve
      mcp: [{ transport: 'websocket', url: 'ws://10.255.255.1:9999/mcp', timeoutMs: 300 }],
    })
    const t0 = Date.now()
    await sdk.mount()
    const elapsed = Date.now() - t0
    assert(elapsed < 10_000, `✓ P1-2 黑洞 MCP mount 有界完成(${elapsed}ms;原:永挂全入口瘫痪)`)
    assert(sdk.inspect().mcp.servers.length === 0, '✓ P1-2 超时 server 降级跳过(inspect 不出现;其余功能不受影响)')
    sdk.unmount()
  }


  console.log('[e2e:hang-feedback] 过程性收口回灌(flash 实测:中途输出「我先看看…稍后委派」即停 → 回灌继续执行)')
  {
    // 队列:①read 调研 ②过渡性收口(实测样本)③回灌后 write 落地 ④真总结
    const llm = stubModel(
      { toolCalls: [{ name: 'read', args: { jsonPath: 'title' } }] },
      { text: '好的,我先看看当前页面数据,再进行修改。' },
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: '新标题' } } }] },
      { text: '已把标题改成「新标题」,任务完成。' },
    )
    const bind = { title: '旧标题' }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-transitional-retry', storage: false, llm,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ title: z.string() }), bind, description: '测试' },
    })
    await sdk.mount()
    await sdk.send('改标题')
    assert(bind.title === '新标题', '✓ 过程性收口被回灌:过渡性文本后任务继续执行落地(原:调研完即收口,任务零完成)')
    const last = sdk.messages[sdk.messages.length - 1]
    assert(last.role === 'assistant' && last.content.includes('已完成') || (last.content ?? '').includes('已把'), '✓ 最终回复是真总结(非过渡性文本)')
    // 连续过渡性收口耗尽(≤2 次回灌)后放行,不死循环
    const llm2 = stubModel(
      { toolCalls: [{ name: 'read', args: { jsonPath: 'title' } }] },
      { text: '我先看看。' },
      { text: '稍后我再处理。' },
      { text: '接下来我会继续。' },
    )
    const sdk2 = createChatSdk({
      ui: false, id: 'e2e-transitional-exhaust', storage: false, llm: llm2,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '测试' },
    })
    await sdk2.mount()
    let done2 = ''
    try { done2 = await sdk2.send('改标题') } catch { done2 = '(throw)' }
    assert(typeof done2 === 'string' && done2.length > 0, '✓ 过渡性收口回灌耗尽(2 次)后放行最终文本,不死循环不永挂')
    sdk.unmount(); sdk2.unmount()
  }

  console.log('[e2e:hang-feedback] wrap-up/重试耗尽的 DSML 泄漏剥离(3.11 真 LLM 实测:S1 轮次耗尽收口时 use_html 委派以文本输出,原文当结论返回)')
  {
    const dsml = '\n\n好的,我已加载平台 UI 规范。现在开始规划并委派生成这个优惠券代码\n\n<｜DSML｜tool_calls>\n<｜DSML｜invoke name="use_html">\n<｜DSML｜parameter name="task" string="true">生成优惠券代码组件(custom),追加到 page.components 末尾'
    // 场景一:工具轮耗尽 → wrap-up(裸 llm)返回 DSML 截断块 → 剥离 + observable error 留痕
    const errors = []
    const llm = stubModel(
      { toolCalls: [{ name: 'read', args: { jsonPath: 'title' } }] },
      { text: dsml },  // wrap-up 响应(轮次耗尽收口)
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-garbled-wrapup', storage: false, llm, autoTitle: false,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '测试' },
      maxToolRounds: 1,  // 1 轮工具后耗尽 → 强制走 wrap-up 收口
      onEvent: (e) => { if (e.type === 'error') errors.push(e) },
    })
    await sdk.mount()
    const reply = await sdk.send('生成优惠券组件')
    assert(!reply.includes('<｜DSML｜'), '✓ wrap-up DSML 泄漏被剥离(原:未解析任务规格当结论返回,委派零落地零提示)')
    assert(reply.includes('好的,我已加载平台 UI 规范') && reply.includes('未执行'), '✓ 剥离后保留标记前 prose + 诚实注记(调用未执行)')
    assert(sdk.debugLogs.value.some((l) => l.data?.stage === 'garbled_wrapup'), '✓ debugLogs 留痕 garbled_wrapup')
    assert(errors.some((e) => e.code === 'GARBLED_TOOL_CALL_EXHAUSTED'), '✓ observable error 事件 GARBLED_TOOL_CALL_EXHAUSTED(集成方可感知任务未完成)')
    sdk.unmount()

    // 场景二:主循环 garbled 重试耗尽(连续 3 次截断 DSML)→ 同款剥离
    const llm2 = stubModel(
      { toolCalls: [{ name: 'read', args: { jsonPath: 'title' } }] },
      { text: dsml }, { text: dsml }, { text: dsml },
    )
    const sdk2 = createChatSdk({
      ui: false, id: 'e2e-garbled-exhaust', storage: false, llm: llm2, autoTitle: false,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '测试' },
    })
    await sdk2.mount()
    const reply2 = await sdk2.send('生成优惠券组件')
    assert(!reply2.includes('<｜DSML｜') && reply2.includes('好的,我已加载平台 UI 规范'), '✓ 主循环 garbled 重试耗尽 → DSML 剥离 + prose 保留(原:emit error 后仍把原文当 final)')
    sdk2.unmount()

    // 场景三:超调用次数中断 → 可见提示 + observable 事件(修「莫名停了」)
    const errors3 = []
    const llm3 = stubModel(
      { toolCalls: [{ name: 'read', args: { jsonPath: 'title' } }] },
      { text: '已基于工具结果整理出标题。' },  // wrap-up 正常收口文本
    )
    const sdk3 = createChatSdk({
      ui: false, id: 'e2e-call-limit-note', storage: false, llm: llm3, autoTitle: false,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '测试' },
      maxToolRounds: 1,
      onEvent: (e) => { if (e.type === 'error') errors3.push(e) },
    })
    await sdk3.mount()
    const reply3 = await sdk3.send('改标题')
    assert(reply3.includes('已基于工具结果整理出标题'), '✓ 超轮次收口仍返回 wrap-up 综合结果')
    assert(reply3.includes('工具调用次数已达上限') && reply3.includes('继续'), '✓ 超调用次数中断附可见提示(达上限/可回复继续),不再「莫名停了」')
    assert(errors3.some((e) => e.code === 'REACT_CALL_LIMIT_EXCEEDED'), '✓ observable error 事件 REACT_CALL_LIMIT_EXCEEDED(集成方 onEvent 可感知中断原因)')
    assert(sdk3.debugLogs.value.some((l) => l.data?.stage === 'react_call_limit_exceeded'), '✓ debugLogs 留痕 react_call_limit_exceeded')
    sdk3.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
