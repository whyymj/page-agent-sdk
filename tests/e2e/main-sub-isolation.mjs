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

  console.log('[e2e:main-sub-isolation] section-orchestrator Phase 1:编排段数据规模动态注入(大数据注入/小数据零税)')
  {
    const mkBind = (n) => ({ title: '页', components: Array.from({ length: n }, (_, i) => ({ name: `c${i}`, note: `n${i}` })) })
    const schema = z.object({ title: z.string(), components: z.array(z.object({ name: z.string(), note: z.string() })) })
    const runSeg = async (n) => {
      const llm = stubModel({ text: '收到' })
      const sdk = createChatSdk({
        ui: false, id: `e2e-orch-seg-${n}`, storage: false, llm,
        capabilities: { ...CAPS, vfs: false },
        subagent: { maxParallel: 1 },
        data: { schema, bind: mkBind(n), description: 'd' },
      })
      await sdk.mount()
      await sdk.send('看下数据')
      const prompts = llm.systemPrompts
      sdk.unmount()
      return prompts
    }
    const big = await runSeg(15)
    assert(big.some((p) => p.includes('分段编排') && p.includes('段规格四要素') || p.includes('jsonPath 范围')), '✓ 大数据(15 组件 ≥ 阈 12)→ system 注入编排段(三步职责 + 段规格四要素)')
    assert(big.some((p) => p.includes('不经过组件锁')), '✓ S6 弱点随编排段注入(spawn_* 无组件锁,段不相交靠规划 + 乐观锁兜底)')
    const small = await runSeg(2)
    assert(small.every((p) => !p.includes('分段编排')), '✓ 小数据(2 组件 < 阈)→ 零注入零税(不为分段而分段)')
  }

  console.log('[e2e:main-sub-isolation] section-orchestrator S7 保底:委派失败×2 → 主 agent 回退单干完成(回退条款,不傻等)')
  {
    // 委派两次失败(子 LLM 挂)→ 主 agent 接手段内工作自己写(spawn 失败不阻塞主循环,单干是一等路径);
    // 已委派(spawn_agent 出现)→ 欠委派 nudge 抑制(write 结果无「委派提示」)
    const llm = stubModel(
      { toolCalls: [{ name: 'spawn_agents', args: { tasks: [{ prompt: '把标题改成新标题' }] } }] },
      { throw: '子 LLM 故障(第一次)' },
      { toolCalls: [{ name: 'spawn_agents', args: { tasks: [{ prompt: '把标题改成新标题(重试)' }] } }] },
      { throw: '子 LLM 故障(第二次)' },
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: '单干完成' } } }] },
      { text: '委派两次失败,已自行完成修改' },
    )
    const toolResults = []
    const bind = { title: '旧标题', items: ['a'] }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-orch-s7-fallback', storage: false, llm,
      capabilities: { ...CAPS, vfs: false },
      subagent: { maxParallel: 1 },
      data: { schema: z.object({ title: z.string(), items: z.array(z.string()) }), bind, description: 'd' },
    })
    await sdk.mount()
    const reply = await sdk.stream([{ role: 'user', content: '把标题改成新标题', timestamp: Date.now() }], (e) => {
      if (e.type === 'tool_result') toolResults.push(e)
    })
    const writes = toolResults.filter((r) => r.name === 'write')
    assert(bind.title === '单干完成' && writes.length === 1, '✓ S7:委派×2 失败 → 主 agent 回退单干写完成(能力不被委派失败阉割)')
    const spawnFails = toolResults.filter((r) => r.name === 'spawn_agents')
    assert(spawnFails.length === 2 && spawnFails.every((r) => String(r.result).includes('故障')), '✓ S7:两次委派失败 error result 隔离回灌(不静默不中断)')
    assert(writes.every((r) => !String(r.result).includes('委派提示')), '✓ S7:已委派 → 欠委派 nudge 抑制(不再提示委派,与回退单干不冲突)')
    assert(/单干|自行/.test(reply), '✓ S7:主 agent 如实收口(委派失败 + 自行完成)')
    sdk.unmount()
  }

  console.log('[e2e:main-sub-isolation] section-orchestrator 0b:小步 grind 累计超阈 → 欠委派 nudge 一次性尾附(装配链实证)')
  {
    // 13 次小写(components.N.note)累计 13 组件触达 ≥ 阈 12 → 第 12 次成功写结果尾附「委派提示」(一次性 advisory)
    const N = 13
    const bind = { title: '页', components: Array.from({ length: N }, (_, i) => ({ name: `c${i}`, note: `n${i}` })) }
    const responses = Array.from({ length: N }, (_, i) => ({ toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: `components.${i}.note`, value: `v${i}` } } }] }))
    responses.push({ text: '改完了' })
    const llm = stubModel(...responses)
    const toolResults = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-orch-nudge', storage: false, llm,
      capabilities: { ...CAPS, vfs: false },
      subagent: { maxParallel: 1 },
      data: { schema: z.object({ title: z.string(), components: z.array(z.object({ name: z.string(), note: z.string() })) }), bind, description: 'd' },
    })
    await sdk.mount()
    await sdk.stream([{ role: 'user', content: '逐个改 note', timestamp: Date.now() }], (e) => {
      if (e.type === 'tool_result') toolResults.push(e)
    })
    const nudged = toolResults.filter((r) => String(r.result).includes('委派提示'))
    assert(nudged.length === 1 && toolResults[11].name === 'write' && String(toolResults[11].result).includes('委派提示'),
      `✓ 累计 12 组件 → 第 12 次写尾附一次性 nudge(实际 ${nudged.length} 次,命中位次 ${toolResults.findIndex((r) => String(r.result).includes('委派提示')) + 1})`)
    assert(String(nudged[0]?.result ?? '').startsWith('已 write'), '✓ nudge 是尾附不改写结果语义(写入照常成功)')
    assert(/单干同样是一等路径|失败 2 次/.test(String(nudged[0]?.result ?? '')), '✓ 文案含回退条款(失败 2 次自己做 / 单干一等路径)')
    assert(bind.components.every((c, i) => c.note === `v${i}`), '✓ 全部写入生效(advisory 不阻断)')
    sdk.unmount()
  }

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

  console.log('[e2e:main-sub-isolation] ✓ model-offline-guidance 子撞离线模型 → 引导随 error result 回灌主 LLM(掐反复重委派)')
  {
    const llm = stubModel(
      { toolCalls: [{ name: 'spawn_agents', args: { tasks: [{ prompt: '调研A' }] } }] },
      { throw: Object.assign(new Error('Invalid param: model [deepseek-v4-flash] is offline'), { status: 400 }) },
      { text: '主收口' },
    )
    const toolResults = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-msi-offline-sub', storage: false, llm,
      capabilities: { ...CAPS, vfs: false },
      subagent: { maxParallel: 1 },
    })
    await sdk.mount()
    await sdk.stream([{ role: 'user', content: 'x', timestamp: Date.now() }], (e) => {
      if (e.type === 'tool_result') toolResults.push(e)
    })
    const spawnResult = toolResults.find((r) => r.name === 'spawn_agents')
    const text = String(spawnResult?.result ?? '')
    assert(/【子任务 1】✗/.test(text) && /该模型在当前网关不可用/.test(text), '✓ 离线 400 → 子错误结果带可操作引导(主 LLM 可据此停手/换模型,不再盲重委派)')
    assert(/is offline/.test(text), '✓ 原始网关错误文案保留(引导为追加非替换,排障信息不丢)')
    sdk.unmount()
  }

  console.log('[e2e:main-sub-isolation] ✓ model-offline-guidance 主路径 400 离线 → error 事件 code=MODEL_UNAVAILABLE + message 含引导;普通 400 不误标')
  {
    const mk = async (throwErr, id) => {
      const errors = []
      const sdk = createChatSdk({
        ui: false, id, storage: false, llm: stubModel({ throw: throwErr }),
        capabilities: { ...CAPS, vfs: false },
        onEvent: (e) => { if (e.type === 'error') errors.push(e) },
      })
      await sdk.mount()
      try { await sdk.send('x') } catch { /* send reject = fatal 既有语义 */ }
      sdk.unmount()
      return errors
    }
    const offline = await mk(Object.assign(new Error('Invalid param: model [glm-x] is offline'), { status: 400 }), 'e2e-msi-offline-main')
    const normal = await mk(Object.assign(new Error('Invalid param: temperature out of range'), { status: 400 }), 'e2e-msi-offline-normal')
    assert(offline.some((e) => e.code === 'MODEL_UNAVAILABLE' && /该模型在当前网关不可用/.test(String(e.message))), '✓ 离线 400 → error 事件带 MODEL_UNAVAILABLE 码 + 引导文案(fatal 语义不变)')
    assert(!normal.some((e) => e.code === 'MODEL_UNAVAILABLE' || /该模型在当前网关不可用/.test(String(e.message))), '✓ 普通参数 400 → 不误标(码缺省、无引导文案)')
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
    const u = (p, c, r) => ({ usage: { prompt_tokens: p, completion_tokens: c, total_tokens: p + c, ...(r ? { completion_tokens_details: { reasoning_tokens: r } } : {}) } })
    const llm = stubModel(
      { toolCalls: [{ name: 'spawn_agent', args: { prompt: '子任务' } }], ...u(10, 5, 3) }, // 主 15(reasoning 3)
      { text: '子完成', ...u(6, 4, 4) },                                                    // 子 10(修前漏计;reasoning 4)
      { text: '主收口', ...u(12, 8) },                                                      // 主 20(无 reasoning)
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-msi-usage', storage: false, llm,
      capabilities: { ...CAPS, vfs: false },
    })
    await sdk.mount()
    await sdk.stream([{ role: 'user', content: 'x', timestamp: Date.now() }], () => {})
    assert(sdk.usage.total_tokens === 45, `✓ P1-17a 子 LLM usage 计入 sdk.usage(45=主15+子10+主20;修前 35 漏子;实际 ${sdk.usage.total_tokens})`)
    assert(sdk.usage.prompt_tokens === 28 && sdk.usage.completion_tokens === 17, '✓ P1-17a prompt/completion 分项同样含子(28/17)')
    assert(sdk.usage.reasoning_tokens === 7, `✓ reasoning_tokens 含子 agent onUsage 闭包透传(7=主3+子4;实际 ${sdk.usage.reasoning_tokens})`)
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

  console.log('[e2e:main-sub-isolation] flow-robustness P1#4 子 agent 默认总时长反射(600s 默认/显式覆盖/0 关)')
  {
    const mk = async (sub) => {
      const sdk = createChatSdk({ ui: false, id: 'e2e-msi-defto-' + Math.random().toString(36).slice(2, 7), storage: false, llm: stubModel({ text: 'ok' }), capabilities: { ...CAPS, vfs: false }, ...(sub !== undefined ? { subagent: sub } : {}) })
      await sdk.mount()
      const info = sdk.inspect()
      sdk.unmount()
      return info.subagent.timeoutMs
    }
    assert(await mk(undefined) === 600_000, '✓ P1#4 未配 subagent.timeoutMs → 默认总时长 600000(10min,挂起兜底默认开)')
    assert(await mk({ timeoutMs: 30_000 }) === 30_000, '✓ P1#4 显式 timeoutMs 覆盖默认')
    assert(await mk({ timeoutMs: 0 }) === 0, '✓ P1#4 timeoutMs=0 → 关(不限制)')
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
