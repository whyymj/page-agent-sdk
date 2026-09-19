// content-proposals:read/propose 通道装配 + ReAct 全链(ops 增量)+ 基底锚定 + 去重/替换 + 裁决闭环 + 谎报回灌
import { setupEnv, createAssert, MIN_CAPS, createChatSdk } from './_helpers.mjs'
import { StubChatModel } from './_stub-model.mjs'

const BASE = '---\ntitle: 笔记A\n---\n\n第一段:注意力机致是核心。\n第二段: KV Cache。'

/** 从 stub 捕获的请求里取指定工具的 ToolMessage content(按 tool_calls 配对) */
function toolContentsOf(messages, name) {
  const out = []
  let pending = []
  for (const m of messages) {
    const t = m?._getType?.() ?? 'unknown'
    if (t === 'ai' && Array.isArray(m.tool_calls)) pending = m.tool_calls.map((c) => c.name)
    else if (t === 'tool') { const n = pending.shift(); if (n === name) out.push(String(m.content ?? '')) }
  }
  return out
}

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx
  const { z, hashContent } = await import('page-agent-sdk')

  console.log('[e2e:proposals] 未配置 = 零注册零反射(配置即开关)')
  {
    const model = new StubChatModel([{ text: 'done' }])
    const sdk = createChatSdk({ ui: false, id: 'e2e-prop-off', storage: 'memory', llm: model, capabilities: MIN_CAPS, autoTitle: false })
    await sdk.mount()
    const names = sdk.inspect().tools.map((t) => t.name)
    assert(!names.includes('read_content') && !names.includes('propose_content'), '未配置 → 两工具不在池')
    assert(sdk.inspect().proposals === undefined && sdk.proposals === null, '未配置 → inspect().proposals undefined / sdk.proposals null')
    assert(sdk.resolveProposal('x', 'applied') === false, '未配置 → resolveProposal 恒 false')
    sdk.unmount()
  }

  console.log('[e2e:proposals] ReAct 全链:read_content → propose_content(ops 增量)→ 面板回调 → 待确认回灌 + 事件/反射')
  {
    let content = BASE
    const received = []
    const events = []
    const model = new StubChatModel([
      { toolCalls: [{ name: 'read_content', args: {} }] },
      { toolCalls: [{ name: 'propose_content', args: {
        summary: '修错字',
        baseHash: hashContent(BASE),
        ops: [{ op: 'replace', find: '注意力机致', with: '注意力机制' }],
      } }] },
      { text: '已提交修改提案,请在评审面板确认。' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-prop-flow', storage: 'memory', llm: model,
      capabilities: MIN_CAPS, autoTitle: false,
      proposals: {
        read: () => ({ content, label: '笔记A' }),
        onProposal: (p) => { received.push(p); return `提案已送达,请查看 diff 面板。` },
      },
    })
    sdk.hook?.((e) => { if (String(e.type).startsWith('proposal_')) events.push(e) })
    await sdk.mount()
    await sdk.send('帮我修一下错别字')

    const reads = toolContentsOf(model.lastMessages, 'read_content')
    assert(reads.length === 1 && reads[0].startsWith(`hash=${hashContent(BASE)}`) && reads[0].includes('注意力机致'),
      `read_content 结果含 hash 头 + 原文,实际:${reads[0]?.slice(0, 40)}`)
    const props = toolContentsOf(model.lastMessages, 'propose_content')
    assert(props.length === 1 && props[0].includes('提案已送达') && props[0].includes('+1 / -1') && props[0].includes('待确认'),
      `propose_content 回灌含面板文案 + 统计 + 待确认纪律,实际:${props[0]?.slice(0, 60)}`)
    assert(received.length === 1 && received[0].content.includes('注意力机制') && !received[0].content.includes('机致'),
      'onProposal 收到完整新内容(ops 已应用)')
    assert(received[0].diff.stats.added === 1 && received[0].diff.stats.removed === 1 && received[0].baseHash === hashContent(BASE),
      'ReviewableProposal 含 diff 统计与基底 hash')
    assert(events.some((e) => e.type === 'proposal_pending'), 'proposal_pending 事件外发')
    const insp = sdk.inspect().proposals
    assert(insp && insp.pending.length === 1 && insp.pending[0].added === 1 && insp.pending[0].removed === 1,
      'inspect().proposals.pending 反射(轻投影含统计)')
    assert(sdk.inspect().systemPrompt.includes('内容修改(提案制)'), 'usageHints:通道装配 → 提案纪律注入(未装不教的反面)')
    void content
    sdk.unmount()
  }

  console.log('[e2e:proposals] 基底锚定:hash 不匹配拒;ops 坏锚拒(原子)')
  {
    const model = new StubChatModel([
      { toolCalls: [{ name: 'propose_content', args: { summary: '错 hash', baseHash: 'deadbeef', ops: [{ op: 'replace', find: '第一段', with: 'X' }] } }] },
      { toolCalls: [{ name: 'propose_content', args: { summary: '坏锚', baseHash: hashContent(BASE), ops: [{ op: 'replace', find: '不存在的锚', with: 'X' }] } }] },
      { toolCalls: [{ name: 'propose_content', args: { summary: '好提案', baseHash: hashContent(BASE), ops: [{ op: 'replace', find: '注意力机致', with: '注意力机制' }] } }] },
      { text: 'done' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-prop-guard', storage: 'memory', llm: model,
      capabilities: MIN_CAPS, autoTitle: false,
      proposals: { read: () => ({ content: BASE }), onProposal: () => 'ok' },
    })
    await sdk.mount()
    await sdk.send('改')
    const props = toolContentsOf(model.lastMessages, 'propose_content')
    assert(props[0].includes('基底已变') && props[0].includes('重新 read_content'), `hash 不匹配 → 显式拒引导重读,实际:${props[0]?.slice(0, 40)}`)
    assert(props[1].includes('第 1 个 op') && props[1].includes('未命中'), '坏锚 → 指名 op 序号拒绝')
    assert(props[2].startsWith('ok') && props[2].includes('待确认') && props[2].includes('diff 统计'), `好提案照常送达(宿主文案 + 系统待确认尾巴),实际:${props[2]?.slice(0, 40)}`)
    assert(sdk.inspect().proposals.pending.length === 1, '两次被拒不开面板,仅好提案进 pending')
    sdk.unmount()
  }

  console.log('[e2e:proposals] 去重(相同产物不动在审)+ maxPending 替换(最旧出队留痕)')
  {
    const model = new StubChatModel([
      { toolCalls: [{ name: 'propose_content', args: { summary: 'A', baseHash: hashContent(BASE), ops: [{ op: 'append', text: ' [一]' }] } }] },
      { toolCalls: [{ name: 'propose_content', args: { summary: 'A 重复', baseHash: hashContent(BASE), ops: [{ op: 'append', text: ' [一]' }] } }] },
      { toolCalls: [{ name: 'propose_content', args: { summary: 'B', baseHash: hashContent(BASE), ops: [{ op: 'append', text: ' [二]' }] } }] },
      { text: 'done' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-prop-dedup', storage: 'memory', llm: model,
      capabilities: MIN_CAPS, autoTitle: false,
      proposals: { read: () => ({ content: BASE }), onProposal: () => 'ok', maxPending: 1 },
    })
    await sdk.mount()
    await sdk.send('改')
    const props = toolContentsOf(model.lastMessages, 'propose_content')
    assert(props[1].includes('与在审提案内容完全相同') && props[1].includes('未被替换'),
      `相同产物 → 拒且明示在审未被动(修 4.19 门户「静默丢弃在审」教训),实际:${props[1]?.slice(0, 40)}`)
    const insp = sdk.inspect().proposals
    assert(insp.pending.length === 1 && insp.pending[0].summary === 'B',
      'maxPending=1:不同提案 B 替换 A(在审 = 最新)')
    assert(!!sdk.debugLogs.value.find((l) => l.data?.stage === 'proposal' && l.data?.kind === 'replaced'),
      '替换留痕 debugLogs(stage=proposal, kind=replaced)')
    sdk.unmount()
  }

  console.log('[e2e:proposals] 裁决闭环:resolveProposal → 事件 + 计数 + 下轮一次性结局段(再下轮不残留)')
  {
    const model = new StubChatModel([
      { toolCalls: [{ name: 'propose_content', args: { summary: 'A', baseHash: hashContent(BASE), ops: [{ op: 'append', text: ' [x]' }] } }] },
      { text: '已提案。' },
      { text: '第二轮回答' },
      { text: '第三轮回答' },
    ])
    const events = []
    let appliedContent = null
    const sdk = createChatSdk({
      ui: false, id: 'e2e-prop-resolve', storage: 'memory', llm: model,
      capabilities: MIN_CAPS, autoTitle: false,
      proposals: {
        read: () => ({ content: BASE }),
        onProposal: () => '面板已开',
      },
    })
    sdk.hook?.((e) => { if (String(e.type).startsWith('proposal_')) events.push(e) })
    await sdk.mount()
    // 用户消息用问句:祈使句(「改一下」)会触发零工具门禁回灌(提案≠等效写),额外消耗 stub 队列错位断言
    await sdk.send('这篇笔记有什么要修的地方?')
    const pending = sdk.proposals.pending
    assert(pending.length === 1, '提案在审')
    // 宿主面板「应用」:写回(宿主自己)+ 裁决回传
    appliedContent = pending
    void appliedContent
    assert(sdk.resolveProposal(pending[0].id, 'applied', '已写回 wiki') === true, 'resolveProposal(applied) → true')
    assert(sdk.resolveProposal(pending[0].id, 'applied') === false, '重复裁决 → false(幂等)')
    await sdk.send('改好了吗')
    assert(model.systemPrompts[2]?.includes('内容提案裁决结果') && model.systemPrompts[2].includes('已被用户应用'),
      '裁决后下一轮注入一次性结局段(模型被告知已应用 —— 闭环「改好了吗」)')
    assert(events.some((e) => e.type === 'proposal_resolved' && e.outcome === 'applied'), 'proposal_resolved 事件外发')
    assert(sdk.proposals.applied === 1 && sdk.proposals.pending.length === 0 && sdk.proposals.lastResolved.summary === 'A',
      'sdk.proposals 投射:applied 计数 / pending 出队 / lastResolved')
    await sdk.send('再问一句')
    assert(!model.systemPrompts[3]?.includes('内容提案裁决结果'), '结局段一次性:再下一轮不残留(afterAgent 清除)')
    sdk.unmount()
  }

  console.log('[e2e:proposals] 4.20 口径继承:propose 后谎报「已修改完成」→ 事实清单「待确认」回灌改口')
  {
    const model = new StubChatModel([
      { toolCalls: [{ name: 'propose_content', args: { summary: '修错', baseHash: hashContent(BASE), ops: [{ op: 'replace', find: '机致', with: '机制' }] } }] },
      { text: '已修改完成。' },
      { text: '修改已作为提案送达,待你在面板点「应用」才会写回,当前文件尚未改动。' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-prop-honest', storage: 'memory', llm: model,
      capabilities: MIN_CAPS, autoTitle: false,
      proposals: { read: () => ({ content: BASE }), onProposal: () => '面板已开' },
    })
    await sdk.mount()
    await sdk.send('帮我修改这篇笔记的错别字')
    const humans = model.lastMessages.filter((m) => (m?._getType?.() ?? 'unknown') === 'human').map((m) => String(m.content ?? ''))
    assert(humans.some((t) => t.includes('propose_content×1(提案类,待用户确认后才生效,尚未写入)')),
      `谎报完成 → 4.20 deferredWrite 口径自动罩住新通道(事实清单注记回灌),humans:${humans.length}`)
    assert(sdk.inspect().gates?.zero_tool_gate?.retries >= 1, 'zero_tool_gate 计数(回灌发生)')
    const msgs = sdk.messages.map((m) => String(m.content ?? ''))
    assert(msgs.some((t) => t.includes('尚未改动')), '模型改口:如实告知待确认')
    sdk.unmount()
  }

  void z
  return { pass: ctx.pass, fail: ctx.fail }
}
