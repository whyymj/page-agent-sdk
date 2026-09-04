// fix-hang-and-feedback e2e:挂起有界收口 + 可见性(真跑顶层 send/batch/mount,stub model 驱动)
//  - P1-1:headless send 触发 humanConfirm → 无响应方 → 超时自动拒 + APPROVAL_AUTO_REJECTED error 事件 + send 不挂死
//  - P1-4:send/batch 接 signal —— 已 abort 的 signal → send 立即收口 / batch 全部记 aborted
//  - P1-2:MCP 黑洞端点(不可路由 IP)→ 握手超时 → mount 照常完成,降级跳过该 server
import { setupEnv, createAssert, createChatSdk, z, defineTool } from './_helpers.mjs'
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

  console.log('[e2e:hang-feedback] 第0轮行动叙述(零 tool_calls)→ 回灌请用工具执行,不「中途停止」')
  {
    // ① 首轮纯文本行动叙述(点名工具+行动动词,无 tool_calls)→ detectActionNarration 命中回灌;
    // ② 回灌后模型改用标准 function calling(read)→ ③ 最终完成汇报
    const llm = stubModel(
      { text: '好的,开始执行！让我先调用 read 看看当前值,然后用 write 写入,先加载 page-tools。' },
      { toolCalls: [{ name: 'read', args: { jsonPath: 'title' } }] },
      { text: '已把标题改成「世界杯」。' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-action-narration', storage: false, llm,
      capabilities: { ...CAPS, subagent: false },
      data: { schema: z.object({ title: z.string() }), bind: { title: 'orig' }, description: '测试' },
    })
    await sdk.mount()
    const reply = await sdk.send('把标题改成世界杯')
    assert(reply.includes('已把标题改成「世界杯」'), '✓ 行动叙述回灌后模型继续执行并给出完成汇报(不中途停止)')
    assert(sdk.debugLogs.value.some((l) => l.data?.stage === 'transitional_retry' && l.data?.rounds === 0), '✓ debugLogs 留痕 transitional_retry(rounds=0,第0轮行动叙述回灌)')
    const toolResults = sdk.debugLogs.value.filter((l) => l.type === 'tool_result' && l.data?.name === 'read')
    assert(toolResults.length >= 1, '✓ 回灌后 read 工具真实执行(非幻觉叙述)')
    sdk.unmount()
  }


  console.log('[e2e:hang-feedback] edge-hardening ①:approval 挂起中 switchSession 有界收口 + 新会话无残留')
  {
    // 队列:① write 触发 approval 挂起(无 UI 响应方,靠我们 stream handler 手动控制时机)
    // 切会话时:abortAllActive → approval 中间件 signal 联动自动拒 → send/switchSession 均有界
    // 评审预期缺陷形态:程序化 switchSession 与 send 同走 runSerial —— send 在途等 approval,switchSession
    // 排队等 send 结束 → 互等死锁。本用例走 stream 路径(不经 runSerial 串行闸的 send),先验证 abort 收口;
    // 程序化直调 send + switchSession 的死锁窗口留 human-confirm browser e2e / 真 UI 验证。
    const llm = stubModel(
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: 'x' } } }] },
      { text: '(被拒后收口)' },
    )
    const approvals = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-edge-approval', storage: 'memory', llm, autoTitle: false,
      data: { schema: z.object({ title: z.string() }), bind: { title: 'a' }, description: 'd' },
      approval: { tools: ['write'] },
      capabilities: { ...CAPS, subagent: false },
    })
    await sdk.mount()
    const idA = sdk.sessionId
    // stream 驱动:write 挂起等确认 → 我们不 resolve,直接 switchSession(abort 联动应自动拒收口)
    const streamP = sdk.stream([{ role: 'user', content: '改标题', timestamp: Date.now() }], (e) => {
      if (e.type === 'approval_request') { approvals.push(e) /* 不 resolve:模拟无人应答 */ }
    })
    await new Promise((r) => setTimeout(r, 100))  // 等 approval 真挂起
    assert(approvals.length === 1, `前置:write 挂起 approval(实际 ${approvals.length})`)
    const t0 = Date.now()
    await sdk.switchSession()  // 切会话 → abortAllActive → signal 联动自动拒
    const waited = Date.now() - t0
    assert(waited < 5000, `✓ approval 挂起中 switchSession 有界收口(${waited}ms < 5s,不永挂)`)
    // stream 已被 abort 收口(streamP resolve 不悬挂);新会话无 pendingApproval 残留(approval_request 未外发)
    await streamP.catch(() => {})  // abort 可 reject,吞掉
    assert(sdk.sessionId !== idA, '✓ 切会话后 sessionId 已换(新会话就绪)')
    sdk.unmount()
  }

  console.log('[e2e:hang-feedback] 空响应守卫(empty-llm-response)①:首次零 chunk → 自动重试 1 次成功')
  {
    // 队列:① 零 chunk(网关 200 + 错误 JSON 体非 SSE 形态)② 重试正常文本
    const llm = stubModel({ emptyStream: true }, { text: '好的,重试后正常回复' })
    const sdk = createChatSdk({
      ui: false, id: 'e2e-empty-retry-ok', storage: false, llm,
      capabilities: { ...CAPS, subagent: false },
    })
    await sdk.mount()
    const reply = await sdk.send('hi')
    assert(reply === '好的,重试后正常回复', '✓ 首次空响应 → 自动重试 1 次后正常返回文本(原:静默空回复气泡)')
    assert(llm.calls === 2, `✓ 恰好重试 1 次(calls=${llm.calls},不无限重试)`)
    assert(sdk.debugLogs.value.some((l) => l.type === 'error' && l.data?.stage === 'empty_llm_response_retry'), '✓ debugLogs 留痕 empty_llm_response_retry')
    sdk.unmount()
  }

  console.log('[e2e:hang-feedback] 空响应守卫(empty-llm-response)②:重试耗尽 → 显式报错(send reject + error 事件)')
  {
    // 队列:两次均零 chunk → 重试仍空 → 抛 EmptyLLMResponseError(3.42 曾降级空 AI 消息防崩溃,
    // 但 editor 诊断实证用户只见沉默空泡无提示;现走 StreamStalledError 同款错误通道)
    const llm = stubModel({ emptyStream: true }, { emptyStream: true })
    const errors = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-empty-exhausted', storage: false, llm,
      capabilities: { ...CAPS, subagent: false },
      onEvent: (e) => { if (e.type === 'error') errors.push(e) },
    })
    await sdk.mount()
    let err
    try { await sdk.send('hi') } catch (e) { err = e }
    assert(!!err && /空响应/.test(err.message), '✓ 重试仍空 → send reject 抛 EmptyLLMResponseError(原:静默空回复无任何提示)')
    assert(llm.calls === 2, `✓ 首调 + 重试各 1 次后放弃(calls=${llm.calls},有界)`)
    assert(errors.some((e) => /空响应/.test(e.message)), '✓ error 事件外发(集成方 onEvent / UI 可感知失败原因)')
    assert(sdk.debugLogs.value.some((l) => l.type === 'error' && l.data?.stage === 'empty_llm_response'), '✓ debugLogs 留痕 empty_llm_response(诊断导出可见)')
    sdk.unmount()
  }

  console.log('[e2e:hang-feedback] flow-robustness P0#1:集成方工具永不 settle → per-tool 看门狗超时回灌(不永挂)')
  {
    // defineTool 挂起探针 + toolTimeoutMs=80:原 bug = runPool 对工具 Promise 裸等 → send 永挂、stop 无效
    const hangTool = defineTool({ name: 'hang_probe_e2e', description: '挂起探针(测试看门狗)', schema: z.object({}), handler: () => new Promise(() => {}) })
    const llm = stubModel(
      { toolCalls: [{ name: 'hang_probe_e2e', args: {} }] },
      { text: '该工具当前不可用,已如实说明收口' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-tool-watchdog', storage: false, llm,
      capabilities: { ...CAPS, subagent: false },
      tools: [hangTool], toolTimeoutMs: 80,
    })
    await sdk.mount()
    const t0 = Date.now()
    const guard = new Promise((r) => setTimeout(() => r('__TIMEOUT__'), 8000))
    const reply = await Promise.race([sdk.send('跑一下'), guard])
    const elapsed = Date.now() - t0
    assert(reply !== '__TIMEOUT__', '✓ P0#1 send 有界返回(原:集成方工具永挂拖死整轮)')
    assert(elapsed < 8000, `✓ P0#1 收口耗时 ${elapsed}ms(≈80ms 看门狗,非永挂)`)
    assert(sdk.debugLogs.value.some((l) => l.type === 'error' && l.data?.stage === 'tool_timeout' && l.data?.name === 'hang_probe_e2e'), '✓ tool_timeout observable 留痕(工具名 + 超时值)')
    const tr = sdk.debugLogs.value.filter((l) => l.type === 'tool_result' && l.data?.name === 'hang_probe_e2e')
    assert(tr.length === 1 && tr[0].data.status === 'error' && /工具执行超时/.test(tr[0].data.result), '✓ 超时 = recoverable 错误结果回灌(LLM 可自纠/收口,不杀流)')
    sdk.unmount()
  }

  console.log('[e2e:hang-feedback] flow-robustness P0#2:send 冲突挂起 × signal abort → keep_external 有界收口')
  {
    // 原 bug:abort→resolve('keep_external') 联动只在 core.stream;send(invoke)冲突 ask 挂起 + abort 均不解 → send 永不返回
    const bind = { title: 'orig' }
    const llm = stubModel(
      { toolCalls: [{ name: 'read', args: {} }] },
      { toolCalls: [{ name: 'write', args: { value: { title: 'agent值' } } }] },
      { text: '中断后收尾' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-send-conflict-abort', storage: false, llm,
      capabilities: { ...CAPS, dataOps: true }, conflictWatchFields: ['*'],
      data: { schema: z.object({ title: z.string() }), bind },
    })
    await sdk.mount()
    const ac = new AbortController()
    // read 结果落地瞬间外部篡改 → 下一次 write 即过期 → 冲突 ask 挂起(makeStreamWatch 全量外发事件,sdk.hook 可听)
    const unhook = sdk.hook((e) => { if (e.type === 'tool_result' && e.name === 'read') bind.title = '外部新值' })
    const p = sdk.send('改标题', { signal: ac.signal }).then((r) => ({ kind: 'reply', r }), (e) => ({ kind: 'error', e }))
    const deadline = Date.now() + 8000
    while (!sdk.pendingConflict.value && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
    assert(!!sdk.pendingConflict.value, 'P0#2 前置:过期写触发冲突挂起(send 路径)')
    ac.abort()  // 原:此 abort 不解冲突 → p 永挂
    const settled = await Promise.race([p, new Promise((r) => setTimeout(() => r({ kind: '__TIMEOUT__' }), 8000))])
    assert(settled.kind !== '__TIMEOUT__', '✓ P0#2 abort 后 send 有界返回(原:永不返回,唯一出路 unmount/switch/reset)')
    assert(bind.title === '外部新值', '✓ abort 收口语义 = keep_external(外部修改保留,agent 值不落地)')
    assert(sdk.pendingConflict.value === null, '✓ 收口后 pendingConflict 清空')
    unhook()
    sdk.unmount()
  }

  console.log('[e2e:hang-feedback] flow-robustness P1#9 provider 不回 tool_call id → 兜底 id 回写 AIMessage')
  {
    // 队列:① inspect_env 无 id(provider 漏回形态)② 文本收口。
    // 原:AIMessage.tool_calls 无 id + ToolMessage 有兜底 id → 下轮请求协议 400(4xx 不重试,单轮 fatal)
    const llm = stubModel(
      { toolCalls: [{ name: 'inspect_env', args: {}, id: false }] },
      { text: '环境检查完成' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-hang-tcid', storage: false, llm,
      capabilities: { ...CAPS, subagent: false },
    })
    await sdk.mount()
    const reply = await sdk.send('看下环境')
    const msgs = llm.lastMessages ?? []  // 第 2 次模型调用收到的请求 messages
    const ai = msgs.find((m) => Array.isArray(m.tool_calls) && m.tool_calls.length)
    const tc = ai?.tool_calls?.[0]
    const toolMsg = msgs.find((m) => m.tool_call_id)
    assert(reply === '环境检查完成', '✓ P1#9 前置:无 id 工具轮正常执行并收口')
    assert(!!tc && typeof tc.id === 'string' && tc.id.length > 0, `✓ AIMessage.tool_calls[0].id 已兜底回写(实际:${tc?.id})`)
    assert(!!toolMsg && toolMsg.tool_call_id === tc?.id, '✓ ToolMessage.tool_call_id 与回写 id 一致(下轮请求「有 id tool_call ↔ 对应 tool_call_id」,不再 400)')
    sdk.unmount()
  }


  console.log('[e2e:hang-feedback] completion-truncated:空输出 + completion 达上限 → 分步指引回灌(2026-08-25 实测:整页 HTML 塞进一次 write 参数撞 max_tokens,静默空收口 → 主 agent 无限重委派)')
  {
    // 队列:① 空输出 + completion_tokens=4096(模拟截断)② 回灌后正常收口
    const llm = stubModel(
      { text: '', usage: { prompt_tokens: 100, completion_tokens: 4096, total_tokens: 4196 } },
      { text: '好的,我改用分步写入,先写骨架再逐步补充。' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-trunc', storage: false, llm,
      capabilities: { ...CAPS, subagent: false },
    })
    await sdk.mount()
    const reply = await sdk.send('能不能帮我加一个大组件呀?')
    assert(reply === '好的,我改用分步写入,先写骨架再逐步补充。', '✓ 截断回灌后 LLM 重发正常收口(原:静默空回复)')
    assert(llm.calls === 2, `✓ 截断回灌恰一次(模型被调 2 次;实际 ${llm.calls})`)
    const stages = sdk.debugLogs.value.map((l) => l.data?.stage).filter(Boolean)
    assert(stages.includes('completion_truncated_retry'), '✓ debugLogs 留痕 completion_truncated_retry(契约 B 可见性)')
    // 2026-08-27 诊断驱动:回灌须含可照抄的具体分块动作(flash 对泛指「分步」不动,原样重塞全文再截断)
    const feedback = (llm.lastMessages ?? []).map((m) => String(m.content)).join('\n')
    assert(feedback.includes('op:"append"') && feedback.includes('≤1500'), '✓ 截断回灌含具体 append 分块动作(write patch append 尾接 + 块大小上限)')
    sdk.unmount()
  }
  {
    // 对照:空输出但 completion 未达阈(非截断形态,如网络空响应)→ 不触发截断回灌,保持原空回复语义
    const llm = stubModel(
      { text: '', usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } },
      { text: '第二轮正常文本' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-trunc-ctl', storage: false, llm,
      capabilities: { ...CAPS, subagent: false },
    })
    await sdk.mount()
    const reply = await sdk.send('能不能帮我加一个大组件呀?')
    assert(reply === '', `✓ 非截断空输出(completion=50)→ 不误触发回灌,原空回复语义保持(实际:${reply.slice(0, 20)})`)
    const stages = sdk.debugLogs.value.map((l) => l.data?.stage).filter(Boolean)
    assert(!stages.includes('completion_truncated_retry'), '✓ 非截断形态零截断留痕(阈值防误报)')
    sdk.unmount()
  }

  console.log('[e2e:hang-feedback] ui-quick-wins Q3:write 审批 diff 预览(approval.preview 载荷两态)')
  {
    const mk = async (preview) => {
      const llm = stubModel(
        { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: '新标题' } } }] },
        { text: '(被拒后收口)' },
      )
      const approvals = []
      const sdk = createChatSdk({
        ui: false, id: preview ? 'e2e-preview-on' : 'e2e-preview-off', storage: false, llm, autoTitle: false,
        data: { schema: z.object({ title: z.string() }), bind: { title: '旧标题' }, description: 'd' },
        approval: { tools: ['write'], timeoutMs: 80, ...(preview ? { preview: true } : {}) },
        capabilities: { ...CAPS, subagent: false },
      })
      await sdk.mount()
      await sdk.stream([{ role: 'user', content: '改', timestamp: Date.now() }], (e) => {
        if (e.type === 'approval_request') { approvals.push(e); e.resolve?.(false) }
      }).catch(() => {})
      sdk.unmount()
      return approvals
    }
    const on = await mk(true)
    assert(on.length >= 1, '✓ preview 开:write 挂起 approval(resolve(false) 拒绝收口)')
    const p = on[0].preview
    assert(!!p && p.ok === true && p.intent === 'edit', '✓ preview 开:approval_request 载荷附结构化预览(ok/intent)')
    assert(p?.items?.[0]?.jsonPath === 'title' && p?.items?.[0]?.oldSummary === '"旧标题"' && p?.items?.[0]?.newSummary === '"新标题"',
      '✓ preview 开:item 带 old→new(批准前即见改什么)')
    const off = await mk(false)
    assert(off.length >= 1 && off[0].preview === undefined, '✓ preview 默认关:载荷无 preview 字段(预览跑校验链有成本,显式开)')
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
