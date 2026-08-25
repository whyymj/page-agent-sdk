// 乐观锁冲突人工介入:pendingConflict / resolveConflict 暴露 + onConflict 机制
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z, defineTool } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:conflict] pendingConflict / resolveConflict 暴露在 sdk 实例')
  {
    const bind = { title: 'orig' }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-conflict', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind, description: '标题' },
    })
    await sdk.mount()
    assert(sdk.pendingConflict != null && 'value' in sdk.pendingConflict, 'sdk.pendingConflict 是响应式 ref(有 value)')
    assert(sdk.pendingConflict.value === null, '初始无冲突 → pendingConflict.value 为 null')
    assert(typeof sdk.resolveConflict === 'function', 'sdk.resolveConflict 是函数')
    // 无挂起时调 resolveConflict 不抛错(幂等安全)
    sdk.resolveConflict('keep_external')
    assert(sdk.pendingConflict.value === null, '无挂起时 resolveConflict 不改状态(幂等)')
    sdk.unmount()
  }

  console.log('[e2e:conflict] resolveConflict 顶层分支:overwrite(agent 值落地)/ restore(回退快照)round2 B3')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    const CAPS = { fetch: false, planning: false, skills: false, summarization: false, memory: false }
    const waitForPending = async (sdk) => {
      const deadline = Date.now() + 8000
      while (!sdk.pendingConflict.value && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
      return !!sdk.pendingConflict.value
    }
    // overwrite:冲突挂起 → 覆盖 → agent 值落地 + pending 清空 + 轮收口
    {
      const bind = { title: 'orig' }
      const llm = stubModel(
        { toolCalls: [{ name: 'read', args: {} }] },
        { toolCalls: [{ name: 'write', args: { value: { title: '覆写值' } } }] },
        { text: '已覆盖完成' },
      )
      const sdk = createChatSdk({ ui: false, id: 'e2e-conflict-overwrite', storage: false, llm, capabilities: CAPS, conflictWatchFields: ['*'], data: { schema: z.object({ title: z.string() }), bind } })
      await sdk.mount()
      const p = sdk.stream([{ role: 'user', content: '改标题', timestamp: Date.now() }], (e) => { if (e.type === 'tool_result' && e.name === 'read') bind.title = '外部新值' })
      assert(await waitForPending(sdk), 'overwrite 前置:过期写触发冲突挂起')
      sdk.resolveConflict('overwrite')
      await p
      assert(bind.title === '覆写值', '✓ overwrite → agent 值覆盖外部修改落地')
      assert(sdk.pendingConflict.value === null, '✓ overwrite 后 pendingConflict 清空')
      sdk.unmount()
    }
    // restore:先成功写一次(种子快照)→ 冲突挂起 → 回退 → bind 回到种子写前值(orig),agent 值不落地
    {
      const bind = { title: 'orig' }
      const llm = stubModel(
        { toolCalls: [{ name: 'write', args: { value: { title: '种子' } } }] },               // 成功写,推快照(orig)
        { toolCalls: [{ name: 'read', args: {} }] },                                          // 基线 H(种子)
        { toolCalls: [{ name: 'write', args: { value: { title: '不该落地' } } }] },           // 过期写 → 挂起
        { text: '已回退收尾' },
      )
      const sdk = createChatSdk({ ui: false, id: 'e2e-conflict-restore', storage: false, llm, capabilities: CAPS, conflictWatchFields: ['*'], data: { schema: z.object({ title: z.string() }), bind } })
      await sdk.mount()
      let step = 0
      const p = sdk.stream([{ role: 'user', content: '再改', timestamp: Date.now() }], (e) => { if (e.type === 'tool_result' && e.name === 'read') { step++; if (step === 1) bind.title = '外部篡改' } })
      assert(await waitForPending(sdk), 'restore 前置:过期写触发冲突挂起')
      sdk.resolveConflict('restore')
      await p
      assert(bind.title === 'orig', '✓ restore → 回退到种子写前快照 orig(agent 值未落地,外部篡改被回退)')
      assert(sdk.pendingConflict.value === null, '✓ restore 后 pendingConflict 清空')
      sdk.unmount()
    }
  }

  console.log('[e2e:conflict] onConflict 经 createDataOps 独立可用(不接 ChatDialog)')
  {
    // 直接验证 createDataOps 的 onConflict 选项存在(集成方可独立用)
    const { createDataOps } = await import('../../dist/page-agent-sdk.js')
    const bind = { x: 'a' }
    const tools = createDataOps({ schema: z.object({ x: z.string() }), bind, description: 'x' }, {
      onConflict: () => Promise.resolve({ action: 'keep_external' }),
    })
    assert(Array.isArray(tools) && tools.length > 0, 'createDataOps 传 onConflict 选项 → 工具数组正常返回')
  }

  console.log('[e2e:conflict] conflictPolicy 顶层选项(3.29):overwrite 强制覆盖 / keep_external 保留外部,自动收口不挂起')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    const CAPS = { fetch: false, planning: false, skills: false, summarization: false, memory: false }
    // overwrite:read → 外部篡改 → 过期写 → 不挂起、无人工介入,agent 值直接落地 + conflict 事件带 autoResolved
    {
      const bind = { title: 'orig' }
      const events = []
      const llm = stubModel(
        { toolCalls: [{ name: 'read', args: {} }] },
        { toolCalls: [{ name: 'write', args: { value: { title: 'agent覆盖值' } } }] },
        { text: '完成' },
      )
      const sdk = createChatSdk({
        ui: false, id: 'e2e-conflict-policy-ow', storage: false, llm, capabilities: CAPS, conflictWatchFields: ['*'],
        conflictPolicy: 'overwrite',
        onEvent: (e) => { if (e.type === 'conflict') events.push(e) },
        data: { schema: z.object({ title: z.string() }), bind },
      })
      await sdk.mount()
      const p = sdk.stream([{ role: 'user', content: '改标题', timestamp: Date.now() }], (e) => { if (e.type === 'tool_result' && e.name === 'read') bind.title = '外部新值' })
      await p
      assert(bind.title === 'agent覆盖值', '✓ conflictPolicy:overwrite → 过期写不挂起,agent 值强制覆盖落地')
      assert(sdk.pendingConflict.value === null, '✓ conflictPolicy:overwrite → pendingConflict 始终不挂起')
      assert(events.length === 1 && events[0].conflict.autoResolved === 'overwrite', '✓ conflictPolicy:overwrite → conflict 事件外发(autoResolved=overwrite 观测留痕)')
      sdk.unmount()
    }
    // keep_external:同脚本 → agent 值不落地,外部值保留,轮照常收口(不挂起)
    {
      const bind = { title: 'orig' }
      const events = []
      const llm = stubModel(
        { toolCalls: [{ name: 'read', args: {} }] },
        { toolCalls: [{ name: 'write', args: { value: { title: '不该落地' } } }] },
        { text: '完成' },
      )
      const sdk = createChatSdk({
        ui: false, id: 'e2e-conflict-policy-ke', storage: false, llm, capabilities: CAPS, conflictWatchFields: ['*'],
        conflictPolicy: 'keep_external',
        onEvent: (e) => { if (e.type === 'conflict') events.push(e) },
        data: { schema: z.object({ title: z.string() }), bind },
      })
      await sdk.mount()
      const p = sdk.stream([{ role: 'user', content: '改标题', timestamp: Date.now() }], (e) => { if (e.type === 'tool_result' && e.name === 'read') bind.title = '外部新值' })
      await p
      assert(bind.title === '外部新值', '✓ conflictPolicy:keep_external → agent 过期写不落地,外部修改保留')
      assert(events.length === 1 && events[0].conflict.autoResolved === 'keep_external', '✓ conflictPolicy:keep_external → conflict 事件外发(autoResolved 标记)')
      sdk.unmount()
    }
    // 边界:显式 ask(与默认一致)→ 仍挂起等人工(不回退自动裁决)
    {
      const bind = { title: 'orig' }
      const llm = stubModel(
        { toolCalls: [{ name: 'read', args: {} }] },
        { toolCalls: [{ name: 'write', args: { value: { title: '挂起值' } } }] },
        { text: '完成' },
      )
      const sdk = createChatSdk({
        ui: false, id: 'e2e-conflict-policy-ask', storage: false, llm, capabilities: CAPS, conflictWatchFields: ['*'],
        conflictPolicy: 'ask',
        data: { schema: z.object({ title: z.string() }), bind },
      })
      await sdk.mount()
      const waitForPending = async () => {
        const deadline = Date.now() + 8000
        while (!sdk.pendingConflict.value && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
        return !!sdk.pendingConflict.value
      }
      const p = sdk.stream([{ role: 'user', content: '改标题', timestamp: Date.now() }], (e) => { if (e.type === 'tool_result' && e.name === 'read') bind.title = '外部新值' })
      assert(await waitForPending(), '✓ conflictPolicy:ask(显式)→ 行为与默认一致,冲突挂起等人工')
      sdk.resolveConflict('overwrite')
      await p
      assert(bind.title === '挂起值', '✓ conflictPolicy:ask → resolveConflict 后照常收口')
      sdk.unmount()
    }
  }

  console.log('[e2e:conflict] baseline-guard:自定义结构工具改 bind 后基线自动刷新,agent 下一次 write 不再自冲突(editor_fangzhou 实测根因修)')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    const CAPS = { fetch: false, planning: false, skills: false, summarization: false, memory: false }
    // editor_fangzhou 形态:defineTool 结构性工具在 SDK 写路径之外直改 bind(add_component 等)
    const bind = { title: 'orig', components: [{ type: 'banner' }] }
    const add_component = defineTool({
      name: 'add_component',
      description: '追加一个组件(结构性工具,直改页面数据)',
      schema: z.object({ type: z.string() }),
      handler: async ({ type }) => {
        bind.components.push({ type })  // 直改 bind(不经 write 工具)—— 修复前基线不刷新,后续 write 自冲突
        return `已追加 ${type} 组件,当前共 ${bind.components.length} 个组件。`
      },
    })
    // read(建基线)→ add_component(写路径外改 bind)→ write(autoLock;守卫已刷基线 → 不应冲突)
    const llm = stubModel(
      { toolCalls: [{ name: 'read', args: {} }] },
      { toolCalls: [{ name: 'add_component', args: { type: 'card' } }] },
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: 'agent标题' } } }] },
      { text: '完成' },
    )
    const events = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-baseline-guard', storage: false, llm, capabilities: CAPS, conflictWatchFields: ['*'],
      tools: [add_component],
      onEvent: (e) => { if (e.type === 'conflict') events.push(e) },
      data: { schema: z.object({ title: z.string(), components: z.array(z.object({ type: z.string() })) }), bind },
    })
    await sdk.mount()
    await sdk.stream([{ role: 'user', content: '加一个 card 组件并把标题改为 agent标题', timestamp: Date.now() }])
    assert(bind.components.length === 2 && bind.components[1].type === 'card', '✓ 自定义结构工具直改 bind 生效(add_component 落地)')
    assert(bind.title === 'agent标题', '✓ baseline-guard → 结构工具改 bind 后的 write 照常落地(修复前此处自冲突需强制覆盖)')
    assert(sdk.pendingConflict.value === null, '✓ 全程无挂起冲突(自冲突消除)')
    assert(events.length === 0, '✓ 无 conflict 事件(基线随 SDK 可观察的 bind 变化即时刷新,autoLock 不误报)')
    sdk.unmount()
  }

  console.log('[e2e:conflict] baseline-guard 边界:外部人工改动(不经任何工具)仍触发冲突保护(守卫不误放真外部修改)')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    const CAPS = { fetch: false, planning: false, skills: false, summarization: false, memory: false }
    const bind = { title: 'orig' }
    const noop_tool = defineTool({
      name: 'noop_tool',
      description: '什么都不做的工具(对照:不改 bind 则基线不变)',
      schema: z.object({}),
      handler: async () => 'ok',
    })
    // read(建基线)→ noop_tool(不改 bind)→ 期间人工直改 bind(模拟宿主/用户并发改动)→ write 应挂起冲突
    const llm = stubModel(
      { toolCalls: [{ name: 'read', args: {} }] },
      { toolCalls: [{ name: 'noop_tool', args: {} }] },
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: 'agent值' } } }] },
      { text: '完成' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-baseline-guard-boundary', storage: false, llm, capabilities: CAPS, conflictWatchFields: ['*'],
      tools: [noop_tool],
      data: { schema: z.object({ title: z.string() }), bind },
    })
    await sdk.mount()
    const waitForPending = async () => {
      const deadline = Date.now() + 8000
      while (!sdk.pendingConflict.value && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
      return !!sdk.pendingConflict.value
    }
    // 人工改动放在 noop_tool 结果回灌之后、write 之前(工具窗口之外)→ 守卫不背锅,冲突保护照常
    const p = sdk.stream(
      [{ role: 'user', content: '改标题', timestamp: Date.now() }],
      (e) => { if (e.type === 'tool_call' && e.name === 'write') bind.title = '人工外部值' },
    )
    assert(await waitForPending(), '✓ 工具窗口外的人工改 bind → write 仍触发冲突挂起(keep_external 保护不被守卫削弱)')
    sdk.resolveConflict('keep_external')
    await p
    assert(bind.title === '人工外部值', '✓ keep_external 收口后人工值保留')
    sdk.unmount()
  }

  console.log('[e2e:conflict] conflictWatchFields 顶层选项(3.32):默认不检测 / 白名单监听')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    const CAPS = { fetch: false, planning: false, skills: false, summarization: false, memory: false }
    const schema = z.object({ title: z.string(), props: z.record(z.string(), z.unknown()) })
    const waitForPending = async (sdk) => {
      const deadline = Date.now() + 8000
      while (!sdk.pendingConflict.value && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
      return !!sdk.pendingConflict.value
    }
    // 默认(未声明 watch)= 不开自动检测:宿主噪声外部改不挂起
    {
      const bind = { title: 'orig', props: { minHeight: 100 } }
      const llm = stubModel(
        { toolCalls: [{ name: 'read', args: {} }] },
        { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: 'agent值' } } }] },
        { text: '完成' },
      )
      const sdk = createChatSdk({ ui: false, id: 'e2e-conflict-default-off', storage: false, llm, capabilities: CAPS, data: { schema, bind } })
      await sdk.mount()
      const p = sdk.stream(
        [{ role: 'user', content: '改标题', timestamp: Date.now() }],
        (e) => { if (e.type === 'tool_result' && e.name === 'read') bind.props.minHeight = 999 },
      )
      const settled = await Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))])
      assert(settled, '✓ 默认不检测 → 宿主噪声外部改后轮次不挂起(8s 内收口)')
      assert(bind.title === 'agent值' && sdk.pendingConflict.value === null, '✓ 默认不检测 → write 落地且 pendingConflict 未挂起')
      sdk.unmount()
    }
    // watch 白名单:监听字段真实并发修改 → 仍挂起等人工
    {
      const bind = { title: 'orig', props: { minHeight: 100, text: 'a' } }
      const llm = stubModel(
        { toolCalls: [{ name: 'read', args: {} }] },
        { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: 'agent值' } } }] },
        { text: '完成' },
      )
      const sdk = createChatSdk({
        ui: false, id: 'e2e-conflict-watch', storage: false, llm, capabilities: CAPS,
        conflictWatchFields: ['text'],
        data: { schema, bind },
      })
      await sdk.mount()
      const p = sdk.stream(
        [{ role: 'user', content: '改标题', timestamp: Date.now() }],
        (e) => { if (e.type === 'tool_result' && e.name === 'read') bind.props.text = '人工真实改' },
      )
      assert(await waitForPending(sdk), '✓ conflictWatchFields → 监听字段真实并发修改挂起冲突')
      sdk.resolveConflict('keep_external')
      await p
      assert(bind.props.text === '人工真实改', '✓ conflictWatchFields → 真实冲突经人工裁决收口(保护链路完整)')
      sdk.unmount()
    }
  }

  console.log('[e2e:conflict] write-conflict C 形态 · 并发写互锁(maxParallelTools=2 同轮双写,陈旧基线)')
  {
    // write-conflict-final-hash:同轮并发两写曾「双双过陈旧基线 → 后写静默覆盖前写与外部修改」;
    // 互锁 + 裁决恢复点校验后:前写落地、后写被显式拦下(VERSION_CONFLICT 回灌可见,可重读重写)
    const { stubModel } = await import('./_stub-model.mjs')
    const CAPS = { fetch: false, planning: false, skills: false, summarization: false, memory: false }
    const bind = { title: 'orig' }
    const llm = stubModel(
      { toolCalls: [{ name: 'read', args: {} }] },                                                        // 建基线 H0
      { toolCalls: [                                                                                     // 同轮双写(均基于 H0)
        { name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: 'A' } } },
        { name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: 'B' } } },
      ] },
      { text: '已处理' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-write-mutex', storage: false, llm, capabilities: CAPS,
      conflictWatchFields: ['*'], conflictPolicy: 'overwrite', maxParallelTools: 2,
      data: { schema: z.object({ title: z.string() }), bind },
    })
    await sdk.mount()
    const unhook = sdk.hook((e) => { if (e.type === 'tool_result' && e.name === 'read') bind.title = 'ext' })  // read 落地即外部改 → 双写基线均陈旧
    await sdk.send('改标题')
    unhook()
    const trs = sdk.debugLogs.value.filter((l) => l.type === 'tool_result' && l.data?.name === 'write')
    assert(bind.title === 'A', `✓ 并发写互锁:前写落地不被后写静默覆盖(实际 title=${bind.title};原:B 静默覆盖 A 与外部改)`)
    assert(trs.length === 2 && trs.some((l) => l.data.status === 'done') && trs.some((l) => /裁决恢复点校验失败/.test(String(l.data.result))),
      '✓ 后写被恢复点校验显式拦下(VERSION_CONFLICT 回灌 LLM 可见可重试,非静默丢写)')
    sdk.unmount()
  }

  console.log('[e2e:conflict] write-conflict C 形态 · 并行不相交双写零误伤(双双落地)')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    const CAPS = { fetch: false, planning: false, skills: false, summarization: false, memory: false }
    const bind = { title: 'orig', note: 'n0' }
    const llm = stubModel(
      { toolCalls: [{ name: 'read', args: {} }] },
      { toolCalls: [
        { name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: 'A' } } },
        { name: 'write', args: { patch: { op: 'set', jsonPath: 'note', value: 'N' } } },
      ] },
      { text: '完成' },
    )
    const conflicts = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-write-mutex-disjoint', storage: false, llm, capabilities: CAPS,
      conflictWatchFields: ['*'], maxParallelTools: 2,
      onEvent: (e) => { if (e.type === 'conflict') conflicts.push(e) },
      data: { schema: z.object({ title: z.string(), note: z.string() }), bind },
    })
    await sdk.mount()
    await sdk.send('改两处')
    assert(bind.title === 'A' && bind.note === 'N', '✓ 并行不相交双写双双落地(外科叠加,与串行等价)')
    assert(conflicts.length === 0, `✓ 互锁不给不相交双写加冲突(N1 同 scope 连续写语义保持,实际 ${conflicts.length} 次)`)
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
