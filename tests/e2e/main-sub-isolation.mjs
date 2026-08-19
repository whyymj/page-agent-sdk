// fix-main-sub-isolation e2e:主×子协同隔离运行时验证(真跑 ReAct 循环,stub model 驱动)
//  - P1-14:spawn_agents allSettled —— 一子失败不拖垮整批,聚合文本逐条 ✓/✗,主流程继续
//  - P1-13:per-scope 乐观锁基线 —— 父 read → 外部改 → 子 read(不再掩盖)→ 父写 VERSION_CONFLICT
//  - P1-17a:子 LLM usage 回传 core.usage(sdk.usage 含子消耗)
//  - P1-17b:subagent.timeoutMs 子执行超时(abort 子流,错误回灌 recoverable)
import { setupEnv, createAssert, createChatSdk, z } from './_helpers.mjs'
import { stubModel } from './_stub-model.mjs'

const CAPS = { fetch: false, planning: false, skills: false, summarization: false, memory: false }

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:main-sub-isolation] P1-14 spawn_agents allSettled(一失败一成功,各自结算)')
  {
    // maxParallel=1 保证队列消费顺序:主 spawn → 子1 → 子2(throw)→ 主收口
    const llm = stubModel(
      { toolCalls: [{ name: 'spawn_agents', args: { tasks: [{ prompt: '调研A' }, { prompt: '调研B' }] } }] },
      { text: '结论A' },
      { throw: '子 LLM 故障' },
      { text: '汇总完成' },
    )
    const toolResults = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-msi-allsettled', storage: false, llm,
      capabilities: { ...CAPS, vfs: false },
      subagent: { maxParallel: 1 },
    })
    await sdk.mount()
    const reply = await sdk.stream([{ role: 'user', content: '并行调研', timestamp: Date.now() }], (e) => {
      if (e.type === 'tool_result') toolResults.push(e)
    })
    const spawnResult = toolResults.find((r) => r.name === 'spawn_agents')
    const text = String(spawnResult?.result ?? '')
    assert(/【子任务 1】✓/.test(text) && /结论A/.test(text), '✓ P1-14 成功子任务结果保留(子任务1 ✓ 结论A)')
    assert(/【子任务 2】✗/.test(text) && /子 LLM 故障/.test(text), '✓ P1-14 失败子任务逐条标 ✗ 带错误摘要(不拖垮整批)')
    assert(/汇总完成/.test(reply), '✓ P1-14 单失败不 reject 工具调用,主流程继续到收口(原:Promise.all 整体 reject 已成功兄弟结果全丢)')
    sdk.unmount()
  }

  console.log('[e2e:main-sub-isolation] P1-13 per-scope 基线(子 read 不掩盖外部修改 → 父过期写冲突)')
  {
    const bind = { title: '旧标题', count: 0 }
    const llm = stubModel(
      { toolCalls: [{ name: 'read', args: {} }] },                                          // 主 read → 主基线 H0
      { toolCalls: [{ name: 'spawn_agent', args: { prompt: '看看标题' } }] },               // 委派(tool_call 事件时外部改 bind → H1)
      { toolCalls: [{ name: 'read', args: { jsonPath: 'title' } }] },                       // 子 read(修前:刷新共享基线掩盖 H1;修后:只进子 scope)
      { text: '子完成' },
      { toolCalls: [{ name: 'write', args: { value: { title: '主覆写', count: 5 } } }] },   // 父过期写 → 应 VERSION_CONFLICT
      { text: '发现冲突停止' },
    )
    const toolResults = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-msi-scope', storage: false, llm, conflictWatchFields: ['*'],
      data: { schema: z.object({ title: z.string(), count: z.number() }), bind },
      capabilities: { ...CAPS, vfs: false },
    })
    await sdk.mount()
    // 注意:createChatSdk 默认冲突人工介入 —— 父过期写命中 VERSION_CONFLICT 时工具挂起 pendingConflict,
    // 需 resolveConflict 收口后 stream 才继续(headless 集成方 watch pendingConflict 自建 UI,同 ConflictBar 语义)
    const streamP = sdk.stream([{ role: 'user', content: '改标题', timestamp: Date.now() }], (e) => {
      if (e.type === 'tool_call' && e.name === 'spawn_agent') bind.count = 77  // 外部修改:主 read 之后、子 read 之前
      if (e.type === 'tool_result') toolResults.push(e)
    })
    const deadline = Date.now() + 8000
    while (!sdk.pendingConflict.value && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
    assert(!!sdk.pendingConflict.value, '✓ P1-13 父过期写触发冲突挂起(pendingConflict;修前:基线被子 read 刷新 → 静默放行不挂起)')
    sdk.resolveConflict('keep_external')  // 保留外部修改(不覆盖)
    const reply = await streamP
    const writeResult = toolResults.find((r) => r.name === 'write')
    assert(!!writeResult && /保留外部修改|VERSION_CONFLICT/.test(String(writeResult.result)), '✓ P1-13 子 read 不再掩盖外部修改 → 父过期写被冲突机制拦下(修前:共享基线被子刷新 → 静默覆盖)')
    assert(bind.title === '旧标题', '✓ P1-13 冲突拦截生效,旧值未被父过期写覆盖')
    assert(bind.count === 77, '✓ P1-13 外部修改保留(count=77)')
    assert(/发现冲突停止/.test(reply), '✓ P1-13 冲突收口后主流程继续到收口')
    sdk.unmount()
  }

  console.log('[e2e:main-sub-isolation] P1-17a 子 usage 回传 core.usage')
  {
    const u = (p, c) => ({ usage: { prompt_tokens: p, completion_tokens: c, total_tokens: p + c } })
    const llm = stubModel(
      { toolCalls: [{ name: 'spawn_agent', args: { prompt: '子任务' } }], ...u(10, 5) },   // 主 15
      { text: '子完成', ...u(6, 4) },                                                       // 子 10(修前漏计)
      { text: '主收口', ...u(12, 8) },                                                      // 主 20
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-msi-usage', storage: false, llm,
      capabilities: { ...CAPS, vfs: false },
    })
    await sdk.mount()
    await sdk.stream([{ role: 'user', content: 'x', timestamp: Date.now() }], () => {})
    assert(sdk.usage.total_tokens === 45, `✓ P1-17a 子 LLM usage 计入 sdk.usage(45=主15+子10+主20;修前 35 漏子;实际 ${sdk.usage.total_tokens})`)
    assert(sdk.usage.prompt_tokens === 28 && sdk.usage.completion_tokens === 17, '✓ P1-17a prompt/completion 分项同样含子(28/17)')
    sdk.unmount()
  }

  console.log('[e2e:main-sub-isolation] P1-17b subagent.timeoutMs 子执行超时')
  {
    const llm = stubModel(
      { toolCalls: [{ name: 'spawn_agent', args: { prompt: '慢任务' } }] },
      { text: '慢响应', delayMs: 500 },   // 子响应 500ms 后到;timeoutMs=120 → race 提前收口
      { text: '主收口' },
    )
    const toolResults = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-msi-timeout', storage: false, llm,
      capabilities: { ...CAPS, vfs: false },
      subagent: { timeoutMs: 120 },
    })
    await sdk.mount()
    const startedAt = Date.now()
    const reply = await sdk.stream([{ role: 'user', content: 'x', timestamp: Date.now() }], (e) => {
      if (e.type === 'tool_result') toolResults.push(e)
    })
    const elapsed = Date.now() - startedAt
    const spawnResult = toolResults.find((r) => r.name === 'spawn_agent')
    assert(!!spawnResult && /超时/.test(String(spawnResult.result)), '✓ P1-17b 子超时 → spawn 返回超时错误文本(recoverable 回灌,主 LLM 可重试/拆分)')
    assert(elapsed < 450, `✓ P1-17b 超时 race 提前收口(${elapsed}ms < 子响应 500ms;原:父无限等)`)
    assert(/主收口/.test(reply), '✓ P1-17b 子超时不中断主流程(错误回灌后主继续到收口)')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
