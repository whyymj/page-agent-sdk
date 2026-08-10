/**
 * sec-68:子 agent 观察层(subagent-observability)
 * - createSubagentTracker:start/pushStep/finish/getActive/getHistory
 * - status 转换(running→done/error)、steps 累积、durationMs、resultPreview 截断(120)
 * - history LRU(historyLimit 默认 20;超限丢最旧;最新在前 unshift)
 * - 快照独立性、不存在 taskId 的 no-op
 */
import { createSubagentTracker } from '../../harness/subagent'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx

  console.log('\n[subagent-observability · createSubagentTracker]')
  assert(typeof createSubagentTracker === 'function', '✓ createSubagentTracker 导出为 function')

  // 基本生命周期:start → running active;pushStep 累积;finish done → 移入 history
  {
    const t = createSubagentTracker()
    assert(t.getActive().length === 0, '✓ 初始 active 空')
    assert(t.getHistory().length === 0, '✓ 初始 history 空')
    t.start('t1', '查按钮文档', 'rag', 1000)
    const active = t.getActive()
    assert(active.length === 1, '✓ start → active 含 1 entry')
    assert(active[0].taskId === 't1', '✓ active taskId')
    assert(active[0].task === '查按钮文档', '✓ active task')
    assert(active[0].label === 'rag', '✓ active label')
    assert(active[0].status === 'running', '✓ active status running')
    assert(Array.isArray(active[0].steps) && active[0].steps.length === 0, '✓ active steps 初始空数组')
    assert(active[0].startedAt === 1000, '✓ active startedAt 透传')
    // pushStep 累积(只记 kind+name+ts,不含全文)
    t.pushStep('t1', { kind: 'tool_call', name: 'search_docs', ts: 2000 })
    t.pushStep('t1', { kind: 'tool_result', name: 'search_docs', ts: 2100 })
    assert(t.getActive()[0].steps.length === 2, '✓ pushStep ×2 → steps 累积 2 条')
    assert(t.getActive()[0].steps[0].kind === 'tool_call', '✓ step[0] kind tool_call')
    assert(t.getActive()[0].steps[1].name === 'search_docs', '✓ step[1] name')
    // finish done
    t.finish('t1', 'done', '结论:按钮文档已找到')
    assert(t.getActive().length === 0, '✓ finish → active 移除')
    const hist = t.getHistory()
    assert(hist.length === 1, '✓ finish done → history 含 1')
    assert(hist[0].status === 'done', '✓ history status done')
    assert(typeof hist[0].durationMs === 'number' && hist[0].durationMs! >= 0, '✓ history durationMs >= 0')
    assert(hist[0].resultPreview === '结论:按钮文档已找到', '✓ history resultPreview(短不截断)')
  }

  // finish error → history status error
  {
    const t = createSubagentTracker()
    t.start('e1', '任务X', 'html', 100)
    t.finish('e1', 'error', '子 agent 执行失败:超时')
    const h = t.getHistory()
    assert(h.length === 1 && h[0].status === 'error', '✓ finish error → history status error')
    assert(h[0].resultPreview === '子 agent 执行失败:超时', '✓ error resultPreview')
  }

  // resultPreview 截断(>120 → 120 + …)
  {
    const t = createSubagentTracker()
    const long = 'x'.repeat(200)
    t.start('t2', 'task', 'rag', 1)
    t.finish('t2', 'done', long)
    const rp = t.getHistory()[0].resultPreview!
    assert(rp.length === 121, `✓ resultPreview 截断为 121(120+…),实际 ${rp.length}`)
    assert(rp.endsWith('…'), '✓ resultPreview 以 … 结尾')
  }

  // history LRU(超限丢最旧;最新在前 unshift)
  {
    const t = createSubagentTracker(3) // 小上限便于测
    t.start('a', 't', 'l', 1); t.finish('a', 'done', 'r')
    t.start('b', 't', 'l', 2); t.finish('b', 'done', 'r')
    t.start('c', 't', 'l', 3); t.finish('c', 'done', 'r')
    assert(t.getHistory().length === 3, '✓ history 满 3')
    assert(t.getHistory()[0].taskId === 'c', '✓ history 最新在前(unshift:c 在首)')
    assert(t.getHistory()[2].taskId === 'a', '✓ history 最旧在尾(a)')
    // 加第 4 个 → 丢最旧 a
    t.start('d', 't', 'l', 4); t.finish('d', 'done', 'r')
    assert(t.getHistory().length === 3, '✓ LRU 超限仍 3(丢最旧)')
    assert(!t.getHistory().some((s) => s.taskId === 'a'), '✓ LRU 丢弃最旧 a')
    assert(t.getHistory()[0].taskId === 'd', '✓ 最新 d 在首')
  }

  // 默认 historyLimit 20
  {
    const t = createSubagentTracker()
    for (let i = 0; i < 25; i++) { t.start(`id${i}`, 't', 'l', i); t.finish(`id${i}`, 'done', 'r') }
    assert(t.getHistory().length === 20, `✓ 默认 historyLimit 20(25 次→20),实际 ${t.getHistory().length}`)
  }

  // 快照独立性:getActive/getHistory 返回新数组,篡改快照不影响内部
  {
    const t = createSubagentTracker()
    t.start('s1', 't', 'l', 1)
    const a1 = t.getActive()
    a1.length = 0 // 篡改快照
    assert(t.getActive().length === 1, '✓ getActive 返回快照(篡改不影响内部)')
    t.finish('s1', 'done', 'r')
    const h1 = t.getHistory()
    h1.length = 0
    assert(t.getHistory().length === 1, '✓ getHistory 返回快照(篡改不影响内部)')
  }

  // no-op:finish/pushStep 不存在的 taskId 不抛错
  {
    const t = createSubagentTracker()
    let threw = false
    try {
      t.pushStep('nope', { kind: 'tool_call', name: 'x', ts: 1 })
      t.finish('nope', 'done', 'r')
    } catch { threw = true }
    assert(!threw, '✓ pushStep/finish 不存在 taskId → no-op 不抛')
    assert(t.getHistory().length === 0, '✓ finish 不存在 taskId → history 不变')
  }
}
