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

  return { pass: ctx.pass, fail: ctx.fail }
}
