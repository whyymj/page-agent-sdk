// fix-data-integrity e2e:会话生命周期完整性运行时验证(真跑 createChatSdk 顶层)
//  - P1-8:resetSession 无 storage(默认)不再早退 —— mission/focus/messages 全重置 + 新 sessionId
//  - P1-9:冲突挂起中 resetSession —— 收口不挂(pendingConflict 清空)+ 外部修改保留 + 流被 abort 收口
//  - P1-11:shareContext 双实例串行闸上移 core —— 并发 send 按序执行,messages 不交错
import { setupEnv, createAssert, createChatSdk, z } from './_helpers.mjs'
import { stubModel } from './_stub-model.mjs'

const CAPS = { fetch: false, planning: false, skills: false, summarization: false, memory: false }

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:session-integrity] P1-8 resetSession 无 storage 完整重置(修前:!store 早退泄漏 mission/focus)')
  {
    const bind = { title: 'x' }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-si-reset-nostorage', storage: false, llm: stubModel(),
      data: { schema: z.object({ title: z.string() }), bind },
      capabilities: { ...CAPS, vfs: false },
    })
    await sdk.mount()
    sdk.setMission({ goal: '旧任务目标' })
    const fr = sdk.setFocus({ path: 'title' })
    assert(fr.ok === true, '前置:setFocus(title) 成功')
    sdk.messages.push({ role: 'user', content: 'hi', timestamp: Date.now() })
    const sid0 = sdk.sessionId

    sdk.resetSession()  // storage:false —— 修前首行 if (!store) return 整体早退

    assert(sdk.getMission() === undefined, '✓ P1-8 无 storage 时 resetSession 重置 mission(修前:泄漏进新对话)')
    assert(sdk.getFocuses().length === 0, '✓ P1-8 无 storage 时 resetSession 重置 focus(修前:旧焦点 strict 拦截继续生效)')
    assert(sdk.messages.length === 0, '✓ P1-8 resetSession 清空 messages(core 层自包含)')
    assert(typeof sdk.sessionId === 'string' && sdk.sessionId !== sid0, '✓ P1-8 resetSession 换新 sessionId')
    sdk.unmount()
  }

  console.log('[e2e:session-integrity] P1-9 冲突挂起中 resetSession 收口(唯一不收口的生命周期路径补齐)')
  {
    const bind = { title: '旧标题', count: 0 }
    const llm = stubModel(
      { toolCalls: [{ name: 'read', args: {} }] },                                        // 基线 H0
      { toolCalls: [{ name: 'write', args: { value: { title: '覆写', count: 5 } } }] },   // 过期写(read 后外部改过)→ 冲突挂起
      { text: '收尾' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-si-reset-conflict', storage: false, llm, conflictWatchFields: ['*'],
      data: { schema: z.object({ title: z.string(), count: z.number() }), bind },
      capabilities: { ...CAPS, vfs: false },
    })
    await sdk.mount()
    const streamP = sdk.stream([{ role: 'user', content: '改标题', timestamp: Date.now() }], (e) => {
      if (e.type === 'tool_result' && e.name === 'read') bind.count = 77  // 外部修改:read 之后 write 之前
    })
    const deadline = Date.now() + 8000
    while (!sdk.pendingConflict.value && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
    assert(!!sdk.pendingConflict.value, '前置:过期写触发冲突挂起')

    sdk.resetSession()  // 修前:不收口冲突 → 旧工具 Promise 永挂;修后:abort + keep_external 收口

    assert(sdk.pendingConflict.value === null, '✓ P1-9 resetSession 收口挂起冲突(pendingConflict 清空)')
    // 在途流随 abort 收口:resolve(abort 保留 partial)或 reject 均可,关键是有界 settle 不永挂
    let settled = false, rejected = false
    const settleP = streamP.then(() => { settled = true }, () => { settled = true; rejected = true })
    await Promise.race([settleP, new Promise((r) => setTimeout(r, 5000))])
    assert(settled, `✓ P1-9 在途流随 resetSession 有界收口(${rejected ? 'reject' : 'resolve(partial)'};不幽灵永挂)`)
    assert(bind.count === 77 && bind.title === '旧标题', '✓ P1-9 keep_external 收口不写入(bind 保留外部修改)')
    assert(sdk.messages.length === 0, '✓ P1-9 收口后内存态已重置(messages 清空)')
    sdk.unmount()
  }

  console.log('[e2e:session-integrity] P1-11 shareContext 双实例串行闸 core 级(并发 send 不交错)')
  {
    // 共享 core(同 id + shareContext)→ 共享 stub 队列:串行时消费顺序 = A响应 → B响应;
    // 修前实例级私有闸 → 双 send 并发,userB 先 push 进 messages 造成交错
    const llm = stubModel(
      { text: '回复A', delayMs: 120 },  // A 在途 120ms,B 必须等它完成
      { text: '回复B' },
    )
    const opts = {
      ui: false, id: 'e2e-si-share', storage: false, llm, shareContext: true,
      capabilities: { ...CAPS, vfs: false },
    }
    const a = createChatSdk(opts)
    const b = createChatSdk(opts)
    await a.mount(); await b.mount()
    assert(a.messages === b.messages, '前置:shareContext 双实例共享同一 messages 数组')

    const pA = a.send('问题A')
    const pB = b.send('问题B')
    const [rA, rB] = await Promise.all([pA, pB])
    assert(rA === '回复A' && rB === '回复B', '✓ P1-11 双实例并发 send 均完成(共享 stub 队列按串行顺序消费)')

    const seq = a.messages.map((m) => `${m.role}:${m.content}`)
    const ua = seq.indexOf('user:问题A'), aa = seq.indexOf('assistant:回复A')
    const ub = seq.indexOf('user:问题B'), ab = seq.indexOf('assistant:回复B')
    assert(ua >= 0 && aa === ua + 1 && ub === aa + 1 && ab === ub + 1, `✓ P1-11 messages 严格 [uA,aA,uB,aB] 不交错(修前:并发裸奔 userB 插进 uA/aA 之间;实际 ${JSON.stringify(seq)})`)
    a.unmount(); b.unmount()
  }

  console.log('[e2e:session-integrity] round2 A5:send 在途 resetSession → abort partial 不推孤儿 assistant 进新会话')
  {
    const bind = { title: 't' }
    const llm = stubModel(
      { text: '生成中的 partial 回复', delayMs: 400 },   // 延迟制造在途窗口;abort 落模型调用内 → 返 partial 不抛
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-si-orphan', storage: false, llm,
      data: { schema: z.object({ title: z.string() }), bind },
      capabilities: { ...CAPS, vfs: false },
    })
    await sdk.mount()
    const sidBefore = sdk.sessionId
    const p = sdk.send('会话一的消息')          // invoke 在途(400ms)
    await new Promise((r) => setTimeout(r, 80)) // 等进入 LLM 调用
    sdk.resetSession()                          // 同步清态 + 换 sessionId + abort
    const reply = await p                       // abort 落模型内 → 返 partial(不抛)
    assert(typeof reply === 'string', '前置:send 返回 partial(abort 落模型调用内不抛)')
    assert(sdk.sessionId !== sidBefore, '前置:resetSession 已换会话')
    const orphan = sdk.messages.filter((m) => m.role === 'assistant')
    assert(orphan.length === 0, '✓ A5 孤儿轮被丢弃:partial assistant 未推进新会话(修前 push 进新会话并落盘)')
    assert(sdk.messages.length === 0, '✓ A5 resetSession 后 messages 保持空(user 已被 splice,assistant 未补)')
    sdk.unmount()
  }

  console.log('[e2e:session-integrity] resume-notice:恢复非空历史 → 首轮注入「数据可能已变」提示,第二轮起消失')
  {
    // 实测事故场景复刻:会话持久化 + 刷新/切回恢复历史,但数据槽可能已回退 → agent 须先核实再断言已完成。
    // storage:'memory' 同实例共享后端,switchSession 切走再切回 = applySnapshot 灌入非空历史 = markResumed
    const llm = stubModel({ text: '第一轮回复' })
    const sdk = createChatSdk({
      ui: false, id: 'e2e-si-resume', storage: 'memory', llm, autoTitle: false,  // autoTitle 会额外消费 stub 响应并污染 systemPrompts 索引,关闭
      capabilities: { ...CAPS, vfs: false, subagent: false },
    })
    await sdk.mount()
    await sdk.send('第一轮消息')                      // afterRound 落盘 messages
    const idA = sdk.sessionId
    assert(sdk.messages.length >= 2, '前置:第一轮后 messages 非空(user+assistant)')

    await sdk.switchSession()                          // 切新会话(空)→ 无恢复提示
    assert(!sdk.inspect().systemPrompt.includes('从历史记录恢复'), '✓ 恢复提示边界 → 新会话(无历史)systemPrompt 无提示段')

    await sdk.switchSession(idA)                       // 切回 A → applySnapshot 恢复非空历史 → markResumed
    assert(sdk.messages.length >= 2, '前置:切回后 messages 已恢复')
    assert(sdk.inspect().systemPrompt.includes('从历史记录恢复'), '✓ 恢复提示 → 恢复非空历史后 systemPrompt 含提示段')

    await sdk.send('重新生成')                         // 恢复后首轮:提示段进模型输入
    const firstTurnSys = llm.systemPrompts[1] ?? ''    // [0] 是落盘前第一轮;[1] 是恢复后首轮
    assert(firstTurnSys.includes('从历史记录恢复') && firstTurnSys.includes('核实'), '✓ 恢复提示 → 恢复后首轮模型输入含提示段(事实+核实纪律)')
    const noticeLogs = sdk.debugLogs.value.filter((l) => l.data?.stage === 'resume_notice')
    assert(noticeLogs.length === 1, `✓ 恢复提示 → debugLogs 留痕恰 1 次(实际 ${noticeLogs.length})`)

    assert(!sdk.inspect().systemPrompt.includes('从历史记录恢复'), '✓ 恢复提示 → 首轮结束(afterAgent)后提示段消失(一次性)')
    await sdk.send('再来一轮')
    const secondTurnSys = llm.systemPrompts[2] ?? ''
    assert(!secondTurnSys.includes('从历史记录恢复'), '✓ 恢复提示 → 第二轮模型输入无提示段(不重复干扰)')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
