// 乐观锁冲突人工介入:pendingConflict / resolveConflict 暴露 + onConflict 机制
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'

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
      const sdk = createChatSdk({ ui: false, id: 'e2e-conflict-overwrite', storage: false, llm, capabilities: CAPS, data: { schema: z.object({ title: z.string() }), bind } })
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
      const sdk = createChatSdk({ ui: false, id: 'e2e-conflict-restore', storage: false, llm, capabilities: CAPS, data: { schema: z.object({ title: z.string() }), bind } })
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

  return { pass: ctx.pass, fail: ctx.fail }
}
