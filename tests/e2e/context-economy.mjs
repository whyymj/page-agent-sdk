// context-economy-phase2:上下文经济性二阶段 e2e
// D4:C4 roundTokenBudget stub 多轮超限中断收口(未配不生效)+ A 阶段 promptSoftCapTokens 显式配置反射可见
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z, defineTool } from './_helpers.mjs'
import { StubChatModel } from './_stub-model.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx
  const echo = defineTool({
    name: 'echo',
    description: '回声工具(测试用)',
    schema: z.object({ msg: z.string() }),
    handler: async () => 'ok',
  })

  console.log('[e2e:context-economy] roundTokenBudget 超限中断收口(stub 注入大 usage → 第二轮前收口,不再调 model)')
  {
    // 时序:第一轮模型调用返回 toolCalls + usage.total_tokens=1000 → 工具执行 → while 循环顶
    //      查 progress.invokeUsage.total_tokens(1000) > roundTokenBudget(500) → 直接 return 收口文本
    //      (不走 wrap-up 追加 LLM 调用防预算超了再烧,故 model.calls 停在 1)
    const model = new StubChatModel(
      [{ toolCalls: [{ name: 'echo', args: { msg: 'x' } }], usage: { total_tokens: 1000 } },
       { text: '不该执行到第二轮' }],
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-round-budget', storage: 'memory', llm: model,
      capabilities: MIN_CAPS, tools: [echo], roundTokenBudget: 500, autoTitle: false,
    })
    await sdk.mount()
    const reply = await sdk.send('跑任务')
    assert(reply.includes('本轮 token 预算') && reply.includes('已完成的部分均保留'), `roundTokenBudget 超限 → 返回友好收口文本(含预算提示与保留说明),实际 reply=${reply.slice(0, 60)}...`)
    assert(model.calls === 1, `收口发生在第二轮模型调用前(不追加 LLM 调用防再烧),实际 model.calls=${model.calls}`)
    const budgetLog = sdk.debugLogs.value.find((l) => l.data?.stage === 'round_token_budget_exceeded')
    assert(!!budgetLog, '超限中断 → debugLogs 留痕(round_token_budget_exceeded,契约「兜底收口必留痕」)')
    sdk.unmount()
  }

  console.log('[e2e:context-economy] roundTokenBudget 未配置不生效(同 usage 走完完整 ReAct)')
  {
    // 对照:不传 roundTokenBudget(默认 0=关)→ 同样的 usage 注入不影响循环,第二轮文本终止
    const model = new StubChatModel(
      [{ toolCalls: [{ name: 'echo', args: { msg: 'x' } }], usage: { total_tokens: 1000 } },
       { text: '正常完成' }],
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-round-budget-off', storage: 'memory', llm: model,
      capabilities: MIN_CAPS, tools: [echo], autoTitle: false,
    })
    await sdk.mount()
    const reply = await sdk.send('跑任务')
    assert(reply === '正常完成' && model.calls === 2, `未配 roundTokenBudget → 不中断,完整跑完 ReAct(2 轮 model 调用),实际 calls=${model.calls} reply=${reply}`)
    sdk.unmount()
  }

  console.log('[e2e:context-economy] promptSoftCapTokens 配置反射(inspect().getInfo().compression)')
  {
    // 显式 50000 → 原样反射;1M 窗口未传 → 默认 320_000(窗口自适应);显式 0 → Infinity(关闭)
    const mk = (id, llm, contextOptions) => createChatSdk({
      ui: false, id, storage: 'memory', llm, capabilities: MIN_CAPS, contextOptions,
    })
    const s1 = mk('e2e-softcap-explicit', FAKE_LLM, { promptSoftCapTokens: 50000 })
    await s1.mount()
    const c1 = s1.inspect().compression
    assert(c1?.promptSoftCap === 50000, `显式 promptSoftCapTokens=50000 → 反射原值,实际 ${c1?.promptSoftCap}`)
    assert(c1?.contextWindow === 200000 && typeof c1?.summaryThresholdRatio === 'number', `compression 段含 contextWindow/ratio(contextWindow=${c1?.contextWindow})`)
    s1.unmount()

    const s2 = mk('e2e-softcap-default', { ...FAKE_LLM, contextWindow: 1000000 })
    await s2.mount()
    const c2 = s2.inspect().compression
    assert(c2?.promptSoftCap === 320000, `窗口 ≥1M 未传 softCap → 默认 320000(2026-08-28 窗口自适应抬升),实际 ${c2?.promptSoftCap}`)
    s2.unmount()

    const s3 = mk('e2e-softcap-disabled', FAKE_LLM, { promptSoftCapTokens: 0 })
    await s3.mount()
    const c3 = s3.inspect().compression
    assert(c3?.promptSoftCap === Number.POSITIVE_INFINITY, `显式 0 → Infinity(关闭),实际 ${c3?.promptSoftCap}`)
    s3.unmount()

    // 200K 窗口(< 320K 阈值)未传 → 不参与(Infinity)
    const s4 = mk('e2e-softcap-smallwin', FAKE_LLM)
    await s4.mount()
    const c4 = s4.inspect().compression
    assert(c4?.promptSoftCap === Number.POSITIVE_INFINITY, `窗口 200K(< 320K 阈值)未传 → 不参与(Infinity),实际 ${c4?.promptSoftCap}`)
    s4.unmount()
  }

  console.log('[e2e:context-economy] 轮次预算感知(3.43):预算吃紧 → system 注入提示段,模型撞墙前可见剩余轮数')
  {
    // maxToolRounds=10:ceil(10*0.7)=7 → 第 8 次模型调用(已用 7 轮)起「提醒」;
    // 剩余 ≤2(已用 8/9)→ 「告急」。提示只进本轮 system[0] 重渲染,不污染历史消息
    const model = new StubChatModel(
      [...Array.from({ length: 10 }, () => ({ toolCalls: [{ name: 'echo', args: { msg: 'x' } }] })), { text: '收口' }],
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-round-hint', storage: 'memory', llm: model,
      capabilities: MIN_CAPS, tools: [echo], maxToolRounds: 10, autoTitle: false,
    })
    await sdk.mount()
    await sdk.send('跑任务')
    const sys = model.systemPrompts
    assert(!sys.slice(0, 7).some((p) => p.includes('轮次预算')), `预算充裕期(前 7 次调用)无提示段(不打扰)`)
    assert(sys[7]?.includes('轮次预算提醒') && sys[7].includes('7/10'), `70% 阈值(已用 7/10)→ system 注入「提醒」段,实际:${sys[7]?.slice(-120)}`)
    assert(sys[8]?.includes('轮次预算告急') && sys[8].includes('仅剩 2 轮'), `剩余 2 轮 → 升级「告急」段`)
    assert(sys[9]?.includes('轮次预算告急') && sys[9].includes('仅剩 1 轮'), `剩余 1 轮 → 告急段持续`)
    // 不污染历史:提示只存在于每轮 system 重渲染,sdk.messages(UI 可见)零残留
    assert(!sdk.messages.some((m) => (m.content || '').includes('轮次预算')), '提示段不进历史消息(UI 零残留,只影响本轮请求)')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
