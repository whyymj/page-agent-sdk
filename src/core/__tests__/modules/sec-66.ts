/**
 * sec-66:chatContext(ChatDialog 拆分枢纽)逻辑
 * createChatContext 工厂 + 容器状态翻转(toggleCollapse/openDebug/openSkill)+ send/keydown/editQueued +
 * canUndo 响应式 + undo + reasoning 折叠 + isPendingAssistant + formatTime。
 */
import type { TestCtx } from './_ctx'
import { createChatContext } from '../../composables/chatContext'

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function run(ctx: TestCtx) {
  const { assert } = ctx
  const flush = () => new Promise<void>((r) => setTimeout(r, 0))
  const mkCtx = (opts: any = {}) => createChatContext({ fetchStream: async () => '', ...opts })

  // ===== createChatContext 返回 ctx(chat 14 项 + 容器状态)=====
  const c = mkCtx()
  assert(!!c.chat && typeof c.chat.sendMessage === 'function', '✓ ctx.chat 含 useChat 返回(sendMessage 等)')
  assert(typeof c.send === 'function' && typeof c.inputText !== 'undefined', '✓ ctx 含容器状态(inputText/send)')
  assert(typeof c.isExpanded !== 'undefined' && typeof c.canUndo !== 'undefined', '✓ ctx 含 isExpanded/canUndo')

  // ===== 容器 UI 状态翻转 =====
  assert(c.isExpanded.value === true, '✓ isExpanded 初始展开')
  c.toggleCollapse(); assert(c.isExpanded.value === false, '✓ toggleCollapse → 收起')
  c.openDebug(); assert(c.debugVisible.value === true, '✓ openDebug → true')
  c.closeDebug(); assert(c.debugVisible.value === false, '✓ closeDebug → false')
  c.openSkill(); assert(c.skillVisible.value === true, '✓ openSkill → true')
  c.closeSkill(); assert(c.skillVisible.value === false, '✓ closeSkill → false')

  // ===== send:inputText → user 消息 + 清空 + 流式跑完 loading 恢复 =====
  {
    const s = mkCtx()
    s.inputText.value = 'hi'
    s.send()
    await flush()
    assert(s.chat.state.messages.some((m: any) => m.role === 'user' && m.content === 'hi'), '✓ send → messages 含 user "hi"')
    assert(s.inputText.value === '', '✓ send → inputText 清空')
    assert(s.chat.state.loading === false, '✓ send 后流式跑完 → loading 恢复 false')
  }

  // ===== send 聚焦时:user message 附 focuses 快照(背景组件标注)=====
  {
    const sf = mkCtx({ getFocuses: () => [{ path: 'components.0', label: '导航' }] })
    sf.inputText.value = '改标题'
    sf.send()
    await flush()
    const um = sf.chat.state.messages.find((m: any) => m.role === 'user')
    assert(!!um && Array.isArray(um.focuses) && um.focuses.length === 1 && um.focuses[0].path === 'components.0', '✓ send 聚焦时 → user message 附 focuses 快照(背景组件)')
    // 未聚焦时 send → user message 无 focuses
    const sn = mkCtx()
    sn.inputText.value = '普通消息'
    sn.send()
    await flush()
    const um2 = sn.chat.state.messages.find((m: any) => m.role === 'user')
    assert(!um2?.focuses || um2.focuses.length === 0, '✓ send 未聚焦 → user message 无 focuses')
  }

  // ===== keydown:Enter 发送 / Shift+Enter 不 / IME 合成期不 =====
  {
    const k = mkCtx()
    const evt = (o: any) => ({ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13, preventDefault() {}, ...o })
    k.inputText.value = 'hello'
    k.keydown(evt({}) as any)
    await flush()
    assert(k.chat.state.messages.some((m: any) => m.content === 'hello'), '✓ keydown Enter(无 Shift/IME) → 发送')
    k.inputText.value = 'world'
    k.keydown(evt({ shiftKey: true }) as any)
    assert(k.inputText.value === 'world', '✓ Shift+Enter 不发送(inputText 保留)')
    k.keydown(evt({ isComposing: true, keyCode: 229 }) as any)
    assert(k.inputText.value === 'world', '✓ IME 合成期 Enter 不发送')
  }

  // ===== editQueued:填回 inputText + 移出队列 =====
  {
    const q = mkCtx()
    q.chat.state.loading = true          // 模拟生成中 → send 入队
    q.inputText.value = 'queued task'
    q.send()
    assert(q.chat.queuedTasks.value.length === 1 && q.chat.queuedTasks.value[0] === 'queued task', '✓ loading 时 send → 入队')
    q.chat.state.loading = false
    q.editQueued(0)
    assert(q.inputText.value === 'queued task', '✓ editQueued → inputText 填回')
    assert(q.chat.queuedTasks.value.length === 0, '✓ editQueued → 队列移除')
  }

  // ===== canUndo(无 opts → false;opts.canUndo=true → true)=====
  assert(mkCtx().canUndo.value === false, '✓ 无 opts.canUndo → canUndo false')
  assert(mkCtx({ canUndo: () => true }).canUndo.value === true, '✓ opts.canUndo=true → canUndo true')

  // ===== undo:onUndo 返回 true → 清 error =====
  {
    const u = mkCtx({ onUndo: () => true })
    u.chat.state.error = 'some error'
    u.undo()
    assert(u.chat.state.error === null, '✓ undo(onUndo true) → state.error 清空')
  }

  // ===== reasoning 折叠(默认展开;toggle 收起)=====
  assert(c.isReasoningExpanded(0) === true, '✓ reasoning 默认展开(undefined)')
  c.toggleReasoning(0)
  assert(c.isReasoningExpanded(0) === false, '✓ toggleReasoning(0) → 收起')

  // ===== isPendingAssistant(空 messages → false)+ formatTime =====
  assert(c.isPendingAssistant(0) === false, '✓ isPendingAssistant 空 messages → false')
  const t = c.formatTime(Date.now())
  assert(typeof t === 'string' && t.length > 0, '✓ formatTime 返回非空字符串(HH:mm)')
}
/* eslint-enable @typescript-eslint/no-explicit-any */
