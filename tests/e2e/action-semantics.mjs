// action-host-semantics:宿主 action 语义标记(readsHostState / deferredWrite)
// S1-C:readsHostState → notifyHostChange 失效面(旧 action 结果置占位;未标记零行为差)
// S1-D:deferredWrite → 零工具门禁事实清单「待用户确认后才生效」注记 + 谎报完成回灌闭环
// 公共面:inspect().actions 反射双标记
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

  console.log('[e2e:action-semantics] S1-C:readsHostState action 的旧结果随 notifyHostChange 置占位;未标记 action 照旧')
  {
    let notifyCount = 0
    const notifyProbe = defineTool({
      name: 'notify_probe', description: '流内触发宿主变更通知(测试用)', schema: z.object({}),
      handler: async () => { notifyCount += 1; sdkRef.notifyHostChange({ reason: '用户切换到《算法导论》' }); return 'ok' },
    })
    const model = new StubChatModel([
      { toolCalls: [{ name: 'read_note_source', args: {} }, { name: 'fetch_meta', args: {} }] },
      { toolCalls: [{ name: 'notify_probe', args: {} }] },
      { text: 'done' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-action-read', storage: 'memory', llm: model,
      capabilities: MIN_CAPS, tools: [notifyProbe], autoTitle: false,
      actions: {
        read_note_source: {
          description: '读取当前笔记源文', readsHostState: true,
          run: async () => '--- title: 旧文 ---\n正文',
        },
        fetch_meta: {
          description: '取笔记元数据(不标记)',
          run: async () => 'meta v1',
        },
      },
    })
    const sdkRef = sdk
    await sdk.mount()
    await sdk.send('问这篇笔记')
    assert(notifyCount === 1, `流内通知确已发生,实际 ${notifyCount}`)
    const last = model.lastMessages
    const src = toolContentsOf(last, 'read_note_source')
    const meta = toolContentsOf(last, 'fetch_meta')
    assert(src.length === 1 && src[0].startsWith(STALE_MARK) && src[0].includes('read_note_source'),
      `标记 action → 末轮请求中旧结果为占位(含工具名 + 重读引导),实际:${src[0]?.slice(0, 60)}`)
    assert(meta.length === 1 && meta[0] === 'meta v1', `未标记 action 照旧保留(不进失效面),实际:${meta[0]}`)
    assert(sdk.inspect().hostReadsInvalidated === 1, `inspect().hostReadsInvalidated 计入 action 占位(=1),实际 ${sdk.inspect().hostReadsInvalidated}`)
    // 公共面反射:inspect().actions 带双标记布尔
    const ai = sdk.inspect().actions ?? {}
    assert(ai.read_note_source?.readsHostState === true && ai.read_note_source?.deferredWrite === false,
      `inspect().actions.read_note_source 反射 readsHostState:true / deferredWrite:false`)
    assert(ai.fetch_meta?.readsHostState === false && ai.fetch_meta?.hasParams === false,
      `inspect().actions.fetch_meta 反射未标记形态(readsHostState:false)`)
    sdk.unmount()
  }

  console.log('[e2e:action-semantics] S1-C 对照:不标记 → 同流程 action 结果不动(现行为零变化)')
  {
    const notifyProbe = defineTool({
      name: 'notify_probe', description: '流内触发宿主变更通知(测试用)', schema: z.object({}),
      handler: async () => { sdkRef.notifyHostChange({ reason: '切换文档' }); return 'ok' },
    })
    const model = new StubChatModel([
      { toolCalls: [{ name: 'read_note_source', args: {} }] },
      { toolCalls: [{ name: 'notify_probe', args: {} }] },
      { text: 'done' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-action-unmarked', storage: 'memory', llm: model,
      capabilities: MIN_CAPS, tools: [notifyProbe], autoTitle: false,
      actions: {
        read_note_source: { description: '读取当前笔记源文', run: async () => '--- title: 旧文 ---\n正文' },
      },
    })
    const sdkRef = sdk
    await sdk.mount()
    await sdk.send('问这篇笔记')
    const src = toolContentsOf(model.lastMessages, 'read_note_source')
    assert(src.length === 1 && src[0] === '--- title: 旧文 ---\n正文',
      `未标记 → 通知后 action 结果原样(现行为零变化),实际:${src[0]?.slice(0, 40)}`)
    assert(sdk.inspect().hostReadsInvalidated === 0, `未标记 → hostReadsInvalidated 不计`)
    sdk.unmount()
  }

  console.log('[e2e:action-semantics] S1-D:propose 后谎报「已修改完成」→ 事实清单注记「待确认」回灌 → 模型改口')
  {
    let proposed = 0
    const model = new StubChatModel([
      { toolCalls: [{ name: 'propose_note_edit', args: { summary: '修错字', content: '--- title ---\n改正后的正文' } }] },
      { text: '已修改完成。' },
      { text: '修改已作为提案送达,待你在页面 diff 面板点「应用并写回」才会生效,目前文件尚未改动。' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-action-deferred', storage: 'memory', llm: model,
      capabilities: MIN_CAPS, autoTitle: false,
      actions: {
        propose_note_edit: {
          description: '提交笔记修改提案(用户确认才生效)',
          deferredWrite: true,
          params: z.object({ summary: z.string(), content: z.string() }),
          run: async ({ summary }) => { proposed += 1; return `提案已送达(${summary}),待用户确认。` },
        },
      },
    })
    await sdk.mount()
    await sdk.send('帮我修改这篇笔记的错别字')
    assert(proposed === 1, `提案 action 被调一次,实际 ${proposed}`)
    // 零工具门禁在「已修改完成。」收口时触发:回灌 HumanMessage 含事实清单注记,模型下一轮看到
    const humans = model.lastMessages.filter((m) => (m?._getType?.() ?? 'unknown') === 'human').map((m) => String(m.content ?? ''))
    assert(humans.some((t) => t.includes('propose_note_edit×1(提案类,待用户确认后才生效,尚未写入)')),
      `谎报完成 → 回灌事实清单含「提案类,待用户确认后才生效」注记(humans:${humans.length} 条)`)
    assert(sdk.inspect().gates?.zero_tool_gate?.retries >= 1, `inspect().gates.zero_tool_gate.retries ≥ 1,实际 ${sdk.inspect().gates?.zero_tool_gate?.retries}`)
    const msgs = sdk.messages.map((m) => String(m.content ?? ''))
    assert(msgs.some((t) => t.includes('尚未改动') && t.includes('提案')),
      `模型最终改口:如实告知提案待确认(未谎称已写入),实际:${msgs.pop()?.slice(0, 60)}`)
    sdk.unmount()
  }
  return ctx.pass > 0 || ctx.fail === 0 ? { pass: ctx.pass, fail: ctx.fail } : { pass: ctx.pass, fail: ctx.fail }
}
