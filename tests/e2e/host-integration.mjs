// host-integration-contract S2:宿主变更驱动的页面读失效(notifyHostChange)
// 流内占位替换 / scope 隔离(数据读不动)/ 提示段一次性(下一 invoke 注入 + afterAgent 清除)/
// 幂等(重复通知不叠加)/ A4 交互(占位不增模型调用、不注入回灌消息 —— 不掩盖后续门禁判据)
import { setupEnv, createAssert, MIN_CAPS, createChatSdk, z, defineTool } from './_helpers.mjs'
import { StubChatModel } from './_stub-model.mjs'

const STALE_MARK = '⏱[过期快照]'

/** 从 stub 捕获的请求 messages 里取指定工具名的 ToolMessage content(配对:AIMessage.tool_calls 顺序) */
function toolContentsOf(messages, name) {
  const out = []
  let pending = []
  for (const m of messages) {
    const t = m?._getType?.() ?? (m?.getType?.() ?? 'unknown')
    if (t === 'ai' && Array.isArray(m.tool_calls)) pending = m.tool_calls.map((c) => c.name)
    else if (t === 'tool') { const n = pending.shift(); if (n === name) out.push(String(m.content ?? '')) }
  }
  return out
}

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:host-integration] S2 流内失效:notifyHostChange(工具执行中)→ 下一轮请求里页面读已成占位,数据读原样')
  {
    let notifyCount = 0
    const readPage = defineTool({
      name: 'read_page', description: '读页面(自定义桩,node 安全)', schema: z.object({}),
      handler: async () => '页面正文:《数据结构》第一章…',
    })
    const notifyProbe = defineTool({
      name: 'notify_probe', description: '流内触发宿主变更通知(测试用)', schema: z.object({}),
      handler: async () => { notifyCount += 1; sdkRef.notifyHostChange({ reason: '用户切换到《算法导论》' }); sdkRef.notifyHostChange({ reason: '用户切换到《算法导论》' }); return 'ok' },
    })
    const model = new StubChatModel([
      { toolCalls: [{ name: 'read_page', args: {} }] },
      { toolCalls: [{ name: 'notify_probe', args: {} }] },
      { text: 'done' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-host-inval', storage: 'memory', llm: model,
      capabilities: MIN_CAPS, tools: [readPage, notifyProbe], autoTitle: false,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '应用配置' },
    })
    const sdkRef = sdk
    await sdk.mount()
    await sdk.send('这个问题')
    assert(notifyCount === 1, `流内通知确已发生(工具执行中双调 notifyHostChange),实际 ${notifyCount}`)
    const last = model.lastMessages
    const pageReads = toolContentsOf(last, 'read_page')
    assert(pageReads.length === 1 && pageReads[0].startsWith(STALE_MARK) && pageReads[0].includes('用户切换到《算法导论》') && pageReads[0].includes('read_page'),
      `流内失效 → 末轮请求中 read_page 结果为占位(含 reason + 重读引导),实际:${pageReads[0]?.slice(0, 60)}`)
    assert(sdk.inspect().hostReadsInvalidated === 1, `幂等:双通知只占位一次(hostReadsInvalidated=1),实际 ${sdk.inspect().hostReadsInvalidated}`)
    assert(!!sdk.debugLogs.value.find((l) => l.data?.stage === 'host_read_invalidated'), 'debugLogs 留痕 host_read_invalidated')
    assert(!!sdk.debugLogs.value.find((l) => l.data?.stage === 'host_change_notified'), 'debugLogs 留痕 host_change_notified(通知本身可见)')
    // A4 前半:S2 是静默替换 —— 不追加模型调用(3 次)、不注入回灌 HumanMessage(消息数 6 = sys+user+ai+tool+ai+tool)
    assert(model.calls === 3, `A4:占位替换零额外模型调用(3 轮),实际 ${model.calls}`)
    const humanMsgs = last.filter((m) => (m?._getType?.() ?? 'unknown') === 'human')
    assert(humanMsgs.length === 1, `A4:零回灌消息注入(S2 不占门禁回灌预算;human 恒 1 条),实际 ${humanMsgs.length}`)
    sdk.unmount()
  }

  console.log('[e2e:host-integration] S2 提示段一次性:空闲通知 → 下一 invoke 注入,afterAgent 清除,再下一 invoke 不残留')
  {
    const echo = defineTool({ name: 'echo', description: '回声(测试用)', schema: z.object({ msg: z.string() }), handler: async () => 'ok' })
    const model = new StubChatModel([
      { toolCalls: [{ name: 'echo', args: { msg: 'x' } }] },
      { text: 'first done' },
      { text: 'second done' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-host-notice', storage: 'memory', llm: model,
      capabilities: MIN_CAPS, tools: [echo], autoTitle: false,
    })
    await sdk.mount()
    sdk.notifyHostChange({ reason: '路由切换到 /guide' })
    await sdk.send('第一个问题')
    assert(model.systemPrompts[0]?.includes('【宿主页面已变更】') && model.systemPrompts[0].includes('路由切换到 /guide'),
      `空闲通知 → 下一 invoke 首轮 system 含提示段与 reason`)
    assert(model.systemPrompts[1]?.includes('【宿主页面已变更】'), `提示段贯穿该 invoke 各轮(pin 段语义,不因轮次消失)`)
    assert(!sdk.inspect().systemPrompt.includes('【宿主页面已变更】'), `invoke 结束(afterAgent)后提示段清除(inspect 实时视图不残留)`)
    await sdk.send('第二个问题')
    assert(!model.systemPrompts[2]?.includes('【宿主页面已变更】'), `一次性:后续 invoke 不再注入(不跨 invoke 重复)`)
    // 空闲通知不做占位失效(跨 invoke 工具结果本就不重发;invoke 内新读不受影响)
    assert(sdk.inspect().hostReadsInvalidated === 0, `空闲通知零占位失效(时序由 epoch 水位把守),实际 ${sdk.inspect().hostReadsInvalidated}`)
    sdk.unmount()
  }

  console.log('[e2e:host-integration] S2 scope 隔离 + 无 reason 形态 + inspect 反射')
  {
    const readPage = defineTool({ name: 'dom_search', description: '搜页面(桩)', schema: z.object({}), handler: async () => '命中 3 处' })
    const model = new StubChatModel([
      { toolCalls: [{ name: 'dom_search', args: {} }] },
      { text: 'done' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-host-scope', storage: 'memory', llm: model,
      capabilities: MIN_CAPS, tools: [readPage], autoTitle: false,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' }, description: '应用配置' },
    })
    await sdk.mount()
    // 空闲通知(无 reason)→ invoke 内先数据 read 后通知再 dom_search?简化:通知后 invoke,invoke 内读均新鲜不失效
    sdk.notifyHostChange()
    await sdk.send('问')
    const last = model.lastMessages
    const domSearch = toolContentsOf(last, 'dom_search')
    assert(domSearch.length === 1 && domSearch[0] === '命中 3 处', `通知后的新读不受影响(时序水位),实际:${domSearch[0]?.slice(0, 30)}`)
    const segAfter = model.systemPrompts[0]?.slice(model.systemPrompts[0].indexOf('【宿主页面已变更】') + 9).trimStart() ?? ''
    assert(model.systemPrompts[0]?.includes('【宿主页面已变更】') && !segAfter.startsWith('·'), `无 reason 形态:提示段仍注入(段头直接是引导文,不带 reason 列表行),段头:${segAfter.slice(0, 24)}`)
    assert(sdk.inspect().hostReadsInvalidated === 0, `inspect().hostReadsInvalidated 反射(0)`)
    sdk.unmount()
  }

  console.log('[e2e:host-integration] S3 页面断言门禁:零依据断言被回灌 → 模型重读后作答;豁免与装配范围对照')
  {
    const echo = defineTool({ name: 'echo', description: '回声(测试用)', schema: z.object({ msg: z.string() }), handler: async () => 'ok' })
    // 回灌链:echo(零页面依据)→ 断言收口 → 回灌 → 模型改调 read_page → 干净作答
    const model = new StubChatModel([
      { toolCalls: [{ name: 'echo', args: { msg: 'x' } }] },
      { text: '本页写了完整的三步流程。' },
      { toolCalls: [{ name: 'read_page', args: {} }] },
      { text: '已读取页面。核心是构建、验证、部署三部分。' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-page-gate', storage: 'memory', llm: model,
      capabilities: { ...MIN_CAPS, domInspect: true }, tools: [echo], autoTitle: false,
    })
    await sdk.mount()
    const reply = await sdk.send('这个页面讲了什么?')
    const gateLog = sdk.debugLogs.value.find((l) => l.data?.stage === 'page_assertion_gate')
    assert(!!gateLog && gateLog.data?.attempt === 1, 'S3 回灌:零页面依据断言 → debugLogs 留痕 page_assertion_gate attempt=1')
    assert(model.calls === 4, `S3 回灌链完整:回灌后模型改调 read_page 再收口(4 次模型调用),实际 ${model.calls}`)
    assert(reply.includes('构建、验证、部署'), `最终回复为读后作答,实际:${reply.slice(0, 40)}`)
    assert(sdk.debugLogs.value.filter((l) => l.data?.stage === 'page_assertion_gate').length === 1, '读后作答不再触发(有页面依据)')
    sdk.unmount()
  }

  console.log('[e2e:host-integration] S3 豁免面:诚实「本页没有提到」/ 问号收尾 / domInspect 关(装配范围)')
  {
    const mk = async (id, caps, responses, question) => {
      const model = new StubChatModel(responses)
      const sdk = createChatSdk({
        ui: false, id, storage: 'memory', llm: model,
        capabilities: caps, autoTitle: false,
      })
      await sdk.mount()
      const reply = await sdk.send(question)
      return { sdk, model, reply }
    }
    const honest = await mk('e2e-page-honest', { ...MIN_CAPS, domInspect: true },
      [{ text: '本页没有提到相关内容。' }], '页面里有讲缓存策略吗?')
    assert(!honest.sdk.debugLogs.value.some((l) => l.data?.stage === 'page_assertion_gate') && honest.model.calls === 1,
      '豁免:诚实「本页没有提到」零回灌(正确行为)')
    honest.sdk.unmount()

    const dataOnly = await mk('e2e-page-datascript', MIN_CAPS,
      [{ text: '页面上说明了标题采用深色。' }], '页面标题是什么风格?')
    assert(!dataOnly.sdk.debugLogs.value.some((l) => l.data?.stage === 'page_assertion_gate') && dataOnly.model.calls === 1,
      '装配范围对照:domInspect 关 → 同类断言文本零回灌(门禁未装配,数据槽误伤路径切断)')
    dataOnly.sdk.unmount()
  }

  console.log('[e2e:host-integration] A4 后半:S2 占位不掩盖 S3 判据(通知后 counts 不变,门禁按原口径判定)')
  {
    // read_page(round1)→ notify_probe 流内通知(round2)→ 断言收口(round3):
    // S2 已把 round1 读结果替换为占位(引导重读),但 counts.read_page 仍 = 1 → S3 判「有页面依据」不回灌
    // —— 两者职责不叠:S2 管「读结果过期」(静默替换),S3 管「零依据编造」(回灌);判据输入互不篡改。
    const notifyProbe = defineTool({
      name: 'notify_probe', description: '流内触发宿主变更通知(测试用)', schema: z.object({}),
      handler: async () => { sdkRef2.notifyHostChange({ reason: '路由切换' }); return 'ok' },
    })
    const model = new StubChatModel([
      { toolCalls: [{ name: 'read_page', args: {} }] },
      { toolCalls: [{ name: 'notify_probe', args: {} }] },
      { text: '本页写了完整的三步流程。' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-a4-s2s3', storage: 'memory', llm: model,
      capabilities: { ...MIN_CAPS, domInspect: true }, tools: [notifyProbe], autoTitle: false,
    })
    const sdkRef2 = sdk
    await sdk.mount()
    await sdk.send('这个页面讲了什么?')
    const last = model.lastMessages
    const pageReads = toolContentsOf(last, 'read_page')
    assert(pageReads.length === 1 && pageReads[0].startsWith(STALE_MARK), 'A4:S2 占位确已生效(round1 读结果在末轮请求为占位)')
    assert(!sdk.debugLogs.value.some((l) => l.data?.stage === 'page_assertion_gate') && model.calls === 3,
      `A4:S2 占位不改变工具调用计数 → S3 判「有页面依据」不回灌(职责不叠,判据输入未被掩盖;calls=3 实际 ${model.calls})`)
    assert(sdk.inspect().hostReadsInvalidated === 1, 'A4:inspect 反射 hostReadsInvalidated=1(S2 独立计数)')
    sdk.unmount()
  }

  console.log('[e2e:host-integration] S4 引用 DOM 锚点:setQuote 第三参 → 请求体引用块含位置元信息行;不带锚点逐字节一致')
  {
    const model = new StubChatModel([{ text: 'done' }])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-quote-anchor', storage: 'memory', llm: model,
      capabilities: MIN_CAPS, autoTitle: false,
    })
    await sdk.mount()
    // 带锚点:selector + 小节 + docId + 偏移/序号进元信息行
    sdk.setQuote('渐进增强是核心原则', '学习导航 · 0.1 概述', {
      selector: '#content > p:nth-of-type(3)', heading: '0.1 概述', docId: 'future-guide', offset: 12, occurrence: 2,
    })
    await sdk.send('这是什么意思?')
    const lastUser = model.lastMessages.find((m) => (m?._getType?.() ?? 'unknown') === 'human')
    const u = String(lastUser?.content ?? '')
    assert(u.includes('[位置: #content > p:nth-of-type(3) · 小节「0.1 概述」 · 文档:future-guide](偏移 12, 第 2 次出现)'),
      `带锚点 → 引用块后附元信息行(selector/小节/docId/偏移/序号),实际:${u.split('\n').find((l) => l.startsWith('[位置')) ?? '(无)'}`)
    assert(u.startsWith('[引用原文(来源:学习导航 · 0.1 概述)]\n"""\n渐进增强是核心原则\n"""'), '引用块本体形态不变(元信息行是追加)')
    sdk.unmount()

    // 不带锚点:与既有形态逐字节一致(回归锁;node 无 location → 无跨文档比对)
    const model2 = new StubChatModel([{ text: 'done' }])
    const sdk2 = createChatSdk({ ui: false, id: 'e2e-quote-plain', storage: 'memory', llm: model2, capabilities: MIN_CAPS, autoTitle: false })
    await sdk2.mount()
    sdk2.setQuote('渐进增强是核心原则', '学习导航')
    await sdk2.send('这是什么意思?')
    const lastUser2 = model2.lastMessages.find((m) => (m?._getType?.() ?? 'unknown') === 'human')
    assert(String(lastUser2?.content ?? '') === '[引用原文(来源:学习导航)]\n"""\n渐进增强是核心原则\n"""\n\n这是什么意思?',
      `不带锚点 → 与既有引用块形态逐字节一致(回归锁),实际:${JSON.stringify(String(lastUser2?.content ?? '').slice(0, 60))}`)
    sdk2.unmount()
  }

  console.log('[e2e:host-integration] A9 可观测性:inspect().gates 计数 + pageAssertion 键装配反射 + systemSegments')
  {
    const echo = defineTool({ name: 'echo', description: '回声(测试用)', schema: z.object({ msg: z.string() }), handler: async () => 'ok' })
    // 门禁回灌 ×2 → EXHAUSTED 放行:gates.page_assertion_gate = { retries:2, exhausted:1 }
    const model = new StubChatModel([
      { toolCalls: [{ name: 'echo', args: { msg: 'x' } }] },
      { text: '本页写了完整的三步流程。' },
      { text: '本页依然写了三步流程。' },
      { text: '本页还是写了三步流程。' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-gates-reflect', storage: 'memory', llm: model,
      capabilities: { ...MIN_CAPS, domInspect: true }, tools: [echo], autoTitle: false,
    })
    await sdk.mount()
    const g0 = sdk.inspect().gates
    assert(!!g0 && g0.page_assertion_gate && g0.page_assertion_gate.retries === 0, '装配反射:domInspect 开 → gates.page_assertion_gate 键存在(初始 0)')
    await sdk.send('这个页面讲了什么?')
    const g1 = sdk.inspect().gates
    assert(g1?.page_assertion_gate?.retries === 2 && g1.page_assertion_gate.exhausted === 1,
      `回灌 ×2 + 耗尽放行 1 → gates 计数(实际 ${JSON.stringify(g1?.page_assertion_gate)})`)
    assert(g1?.zero_tool_gate?.retries === 0, '预算独立:pageAssertion 烧满不动 zeroTool 池')
    const segs = sdk.inspect().systemSegments
    assert(Array.isArray(segs) && segs.length > 0 && segs.every((s) => typeof s.name === 'string' && typeof s.tokens === 'number' && s.dropped === false),
      `systemSegments 反射:段名/字节齐 + 正常态零 dropped(实际 ${segs?.length} 段)`)
    sdk.unmount()

    // 对照:domInspect 关 → page_assertion_gate 键不存在(17b 装配反射)
    const model2 = new StubChatModel([{ text: 'done' }])
    const sdk2 = createChatSdk({ ui: false, id: 'e2e-gates-off', storage: 'memory', llm: model2, capabilities: MIN_CAPS, autoTitle: false })
    await sdk2.mount()
    const g2 = sdk2.inspect().gates
    assert(!!g2 && !('page_assertion_gate' in g2), `装配对照:domInspect 关 → gates 无 page_assertion_gate 键(实际键集 ${Object.keys(g2 ?? {}).join(',')})`)
    sdk2.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
