// quote 划词引用(page-quote)+ read_page 正文提取 + pageContext 页面锚点:
// setQuote 待发引用消费即清 / SendOptions.quote 显式优先 / toLC 前缀注入形态 / 排队丢弃(与 images 同口径)/
// vision+quote 共存 / read_page 工具面(假 document:智能定位 + SDK 子树排除 + 分页)/ pageContext 开关注入
import { setupEnv, createAssert } from './_helpers.mjs'
import { StubChatModel } from './_stub-model.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx
  const { createChatSdk, z } = await import('page-agent-sdk')

  console.log('[e2e:quote] 划词引用 + read_page + pageContext')

  const schema = z.object({ title: z.string() })
  const bind = { title: '首页' }
  const baseOpts = (llm, extra = {}) => ({
    ui: false, id: 'e2e-quote', storage: 'memory', llm, autoTitle: false,
    capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false, subagent: false, dataOps: false },
    ...extra,
  })

  // ===== ① sdk.setQuote → send:待发引用随消息附带 + 消费即清 =====
  {
    const stub = new StubChatModel([{ text: '这段讲的是卷积核尺寸的影响' }])
    const sdk = createChatSdk(baseOpts(stub))
    await sdk.mount()
    sdk.setQuote('卷积核尺寸决定了感受野的大小', '学习笔记 · 第三节')
    const reply = await sdk.send('这段什么意思')
    assert(reply === '这段讲的是卷积核尺寸的影响', 'setQuote → send 正常回复')
    const userMsg = sdk.messages.find((m) => m.role === 'user')
    assert(userMsg?.quote?.text === '卷积核尺寸决定了感受野的大小' && userMsg?.quote?.source === '学习笔记 · 第三节', '消息数组 → user 消息携带 quote 侧字段(持久化面)')
    assert(userMsg?.content === '这段什么意思', 'content 保持干净(引用不拼进消息文本)')
    const human = stub.lastMessages.filter((m) => m?._getType?.() === 'human').at(-1)
    assert(String(human?.content).startsWith('[引用原文(来源:学习笔记 · 第三节)]\n"""\n卷积核尺寸决定了感受野的大小\n"""\n\n这段什么意思'), 'LLM 收到 → 引用块前缀 + 用户 content 收尾')
    // 消费即清:再发一条不带
    stub.responses.push({ text: '好' })
    await sdk.send('继续')
    const human2 = stub.lastMessages.filter((m) => m?._getType?.() === 'human').at(-1)
    assert(human2?.content === '继续', '消费即清 → 第二条消息不再带引用')
    await sdk.unmount()
  }

  // ===== ② SendOptions.quote 显式优先 + 不消费 pendingQuote + 归一截断 =====
  {
    const stub = new StubChatModel([{ text: 'A' }, { text: 'B' }])
    const sdk = createChatSdk(baseOpts(stub))
    await sdk.mount()
    sdk.setQuote('待发的划词引用')
    await sdk.send('第一问', { quote: { text: '显式引用'.repeat(1200) + '\n\n\n\n尾随', source: 'S' } })
    const first = sdk.messages.filter((m) => m.role === 'user')[0]
    assert(first.quote.text.length === 2000 && !first.quote.text.includes('\n\n\n'), 'SendOptions.quote → 归一(3+空行折叠)+ 截 2000')
    const human = stub.lastMessages.filter((m) => m?._getType?.() === 'human').at(-1)
    assert(String(human?.content).startsWith('[引用原文(来源:S)]'), '显式 quote 同样前缀注入 LLM')
    await sdk.send('第二问')
    const second = sdk.messages.filter((m) => m.role === 'user')[1]
    assert(second.quote?.text === '待发的划词引用', '显式 quote 不消费 pendingQuote → 第二问带待发引用')
    // 第三问:pendingQuote 已被第二问消费
    stub.responses.push({ text: 'C' })
    await sdk.send('第三问')
    const third = sdk.messages.filter((m) => m.role === 'user')[2]
    assert(!third.quote, 'pendingQuote 消费即清 → 第三问不带引用')
    await sdk.unmount()
  }

  // ===== ③ clearQuote / 空文本清除(UI 排队路径的纯文本队列表现在 browser spec 断言)=====
  {
    const stub = new StubChatModel([{ text: 'A' }, { text: 'B' }])
    const sdk = createChatSdk(baseOpts(stub))
    await sdk.mount()
    sdk.setQuote('会被清除的引用')
    sdk.clearQuote()
    await sdk.send('第一问')
    assert(!sdk.messages.filter((m) => m.role === 'user')[0].quote, 'clearQuote → 不附带')
    sdk.setQuote('   ') // 空白归一为空 = 清除
    await sdk.send('第二问')
    assert(!sdk.messages.filter((m) => m.role === 'user')[1].quote, 'setQuote 空白文本 → 清除(不挂空引用)')
    await sdk.unmount()
  }

  // ===== ④ vision 主模型:quote 前缀进 content parts 首段(图+引用共存)=====
  {
    const PNG_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg'
    const stub = new StubChatModel([{ text: '收到' }])
    stub.vision = true
    const sdk = createChatSdk(baseOpts(stub))
    await sdk.mount()
    await sdk.send('配图问', { images: [{ id: 'i1', dataUri: PNG_URI }], quote: { text: '共存的引用' } })
    const human = stub.lastMessages.filter((m) => m?._getType?.() === 'human').at(-1)
    assert(Array.isArray(human?.content) && String(human.content[0]?.text).startsWith('[引用原文]\n"""\n共存的引用'), 'vision parts → 首段 text 含引用前缀(图+引用共存)')
    await sdk.unmount()
  }

  // ===== ⑤ read_page 工具面:假 document(智能定位 + SDK 子树排除 + 分页续读)=====
  {
    const el = (tag, text, children = [], extra = {}) => ({ tagName: tag.toUpperCase(), innerText: text, textContent: text, children, querySelector: () => null, ...extra })
    const article = el('article', 'article 根', [
      el('h2', '深度学习基础'),
      el('p', '正文'.repeat(600)), // 1200 字,触发分页
      el('script', 'var secret=1'),
      el('div', '输入消息,Enter 发送', { closest: () => ({}) }), // closest 命中 = SDK UI 子树
    ])
    const realDoc = globalThis.document
    globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible', title: '学习笔记', querySelector: (sel) => (sel === 'article' ? article : null) }
    try {
      const stub = new StubChatModel([
        { toolCalls: [{ name: 'read_page', args: { limit: 500 } }] },
        { toolCalls: [{ name: 'read_page', args: { offset: 500, limit: 20000 } }] },
        { text: '读完总结:讲了深度学习基础' },
      ])
      const sdk = createChatSdk(baseOpts(stub, { capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false, subagent: false, dataOps: false, domInspect: true } }))
      await sdk.mount()
      const reply = await sdk.send('这个页面讲了什么')
      assert(reply === '读完总结:讲了深度学习基础', 'read_page 驱动 ReAct → 正常收口')
      // 终轮 lastMessages 含全史:两次 ToolMessage 即两轮 read_page 结果(steps 由 UI 层 useChat 填充,headless send 不 populated,不入断言)
      const toolMsgs = stub.lastMessages.filter((m) => m?._getType?.() === 'tool')
      assert(toolMsgs.length === 2, 'read_page 被调 2 次(分页续读)')
      const r1 = JSON.parse(toolMsgs[0].content)
      assert(r1.text.length === 500 && r1.hasMore === true && r1.totalChars > 500 && r1.container === 'article', '第一页:limit 生效 + hasMore + 智能定位 article')
      assert(!r1.text.includes('secret') && !r1.text.includes('输入消息'), '提取面:script 与 SDK 对话框子树排除')
      const r2 = JSON.parse(toolMsgs[1].content)
      assert(r2.offset === 500 && (r2.offset + r2.text.length) >= r2.totalChars && r2.hasMore === false, '第二页:offset 续读到文末 hasMore=false')
      assert(sdk.messages.some((m) => m.steps?.some((s) => s.name === 'get_dom')) === false, 'get_dom 未被误调(read_page 承担读正文)')
      await sdk.unmount()
    } finally {
      globalThis.document = realDoc
    }
  }

  // ===== ⑥ pageContext:开 → system 注入 title/URL;关 → 不注入 =====
  {
    const realDoc = globalThis.document
    const realLocation = globalThis.location
    globalThis.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible', title: ' Transformers 笔记', querySelector: () => null }
    globalThis.location = { href: 'https://learn.dev/notes/transformers' }
    try {
      const stubOn = new StubChatModel([{ text: '答' }])
      const sdkOn = createChatSdk(baseOpts(stubOn, { capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false, subagent: false, dataOps: false, pageContext: true } }))
      await sdkOn.mount()
      await sdkOn.send('总结本页')
      assert(stubOn.systemPrompts.at(-1)?.includes('[当前页面]') && stubOn.systemPrompts.at(-1)?.includes('Transformers 笔记') && stubOn.systemPrompts.at(-1)?.includes('https://learn.dev/notes/transformers'), 'pageContext 开 → system 段含标题/URL')
      assert(stubOn.systemPrompts.at(-1)?.includes('read_page') === false, 'pageContext 开但 domInspect 关 → 不引导 read_page(条件化)')
      await sdkOn.unmount()

      const stubOff = new StubChatModel([{ text: '答' }])
      const sdkOff = createChatSdk(baseOpts(stubOff))
      await sdkOff.mount()
      await sdkOff.send('总结本页')
      assert(!stubOff.systemPrompts.at(-1)?.includes('[当前页面]'), 'pageContext 默认关 → 不注入')
      await sdkOff.unmount()
    } finally {
      globalThis.document = realDoc
      if (realLocation === undefined) delete globalThis.location
      else globalThis.location = realLocation
    }
  }

  console.log(`[e2e:quote] 完成: ${ctx.pass} 通过, ${ctx.fail} 失败`)
  return { name: 'quote', pass: ctx.pass, fail: ctx.fail }
}
