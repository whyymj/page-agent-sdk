/**
 * sec-108:flow-robustness Phase 0
 * P0#1 per-tool 看门狗 —— 集成方注入工具「永不 settle」兜底(标记面/race 纯函数/循环级超时回灌/
 * 未标记豁免/0=关/兄弟工具不受株连);P0#2 conflictManager signal race(已中止直收口/中途 abort 收口
 * keep_external/晚到 resolve no-op/正常 resolve 与自动裁决不受影响)。
 */
import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, AIMessageChunk } from '@langchain/core/messages'
import type { TestCtx } from './_ctx'
import { createAgent } from '../../harness/createAgent'
import { defineTool } from '../../sdk/defineTool'
import { createConflictManager } from '../../sdk/conflictManager'
import {
  DEFAULT_TOOL_TIMEOUT_MS,
  ToolTimeoutError,
  isWatchdogTool,
  markWatchdogTools,
  withToolWatchdog,
} from '../../harness/toolWatchdog'

/** 脚本驱动假模型(同 sec-102:按序吐 tool_call / 最终文本) */
class ScriptLLM extends BaseChatModel {
  idx = 0
  constructor(private script: Array<{ tool?: { name: string; args: Record<string, unknown> } }>) { super({}) }
  _llmType(): string { return 'script' }
  private step() { return this.script[this.idx++] }
  async *_streamResponseChunks(): AsyncGenerator<any> {
    const s = this.step()
    if (s?.tool) {
      const tcc = [{ id: `call_${this.idx - 1}`, name: s.tool.name, args: JSON.stringify(s.tool.args), index: 0 }]
      yield { text: '', message: new AIMessageChunk({ content: '', tool_call_chunks: tcc as any }), generationInfo: {} }
    } else {
      yield { text: '完成', message: new AIMessageChunk({ content: '完成' }), generationInfo: {} }
    }
  }
  async _generate(): Promise<any> {
    const s = this.step()
    const msg = s?.tool
      ? new AIMessage({ content: '', tool_calls: [{ id: `call_${this.idx - 1}`, name: s.tool.name, args: s.tool.args, type: 'tool_call' }] })
      : new AIMessage({ content: '完成' })
    return { generations: [{ text: '完成', message: msg }], llmOutput: {} }
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx

  console.log('\n[per-tool 看门狗 · 标记面与纯函数]')
  {
    // 原生 langchain tool 默认无标记;markWatchdogTools 打标后受管辖;0=关时恒不受管辖
    const raw = tool(async () => 'ok', { name: 'raw_probe', description: 'd', schema: z.object({}) })
    assert(!isWatchdogTool(raw, 1000), '✓ 原生 langchain 工具默认不受看门狗管辖(不打标)')
    markWatchdogTools([raw])
    assert(isWatchdogTool(raw, 1000), '✓ markWatchdogTools 打标后受管辖')
    assert(!isWatchdogTool(raw, 0), '✓ toolTimeoutMs=0 → 关闭语义(带标也不管辖)')
    // defineTool 自动打标(集成方主入口)
    const dt = defineTool({ name: 'dt_probe', description: 'd', schema: z.object({}), handler: () => 'ok' })
    assert(isWatchdogTool(dt, 1000), '✓ defineTool 产物自动打标(创建即受看门狗管辖)')
    assert(DEFAULT_TOOL_TIMEOUT_MS === 120_000, `✓ 默认超时 120s(实际 ${DEFAULT_TOOL_TIMEOUT_MS}ms)`)
  }
  {
    // race 纯函数:永不 resolve + 小超时 → ToolTimeoutError;正常值透传;0=关透传
    let threw: unknown
    try { await withToolWatchdog(new Promise(() => {}), 20) } catch (e) { threw = e }
    assert(threw instanceof ToolTimeoutError && (threw as ToolTimeoutError).timedOutMs === 20, '✓ 永不 resolve + 20ms → ToolTimeoutError(带超时值)')
    const v = await withToolWatchdog(Promise.resolve('val'), 50)
    assert(v === 'val', '✓ 超时内完成 → 值透传')
    const v0 = await withToolWatchdog(Promise.resolve('off'), 0)
    assert(v0 === 'off', '✓ timeoutMs=0 → 直接透传(关闭)')
    // 底层迟到 rejection 被吞(结果仍是 ToolTimeoutError 而非底层错误;吞错不抛 unhandledRejection)
    let threw2: unknown
    const late = delay(60).then(() => { throw new Error('late-boom') })
    try { await withToolWatchdog(late, 20) } catch (e) { threw2 = e }
    assert(threw2 instanceof ToolTimeoutError, '✓ 底层迟到 rejection 被吞(竞得 ToolTimeoutError,不冒底层错)')
    await delay(80) // 等迟到 rejection 落地(被吞,无 unhandled)
  }

  console.log('\n[per-tool 看门狗 · 循环级(创建即打标 → 超时 recoverable 回灌,不杀流)]')
  {
    // ① 永不 resolve 的 defineTool 工具 + toolTimeoutMs=40 → 超时错误结果回灌 + 循环继续收口(超时 ≠ abort)
    const hang = defineTool({ name: 'hang_probe', description: 'd', schema: z.object({}), handler: () => new Promise(() => {}) })
    const agent = createAgent({ llm: new ScriptLLM([{ tool: { name: 'hang_probe', args: {} } }]) as any, tools: [hang], toolTimeoutMs: 40, maxRetries: 0 })
    let final = ''
    await agent.stream([{ role: 'user', content: '跑', timestamp: Date.now() }], (e: any) => { if (e.type === 'done') final = e.content }, undefined)
    assert(final === '完成', '✓ 超时回灌后循环继续 → 正常收口(看门狗不扩权为 abort)')
    const logs = (agent.debugLogs.value as any[]).filter((l) => l.type === 'error' && l.data?.stage === 'tool_timeout')
    assert(logs.length === 1 && logs[0].data.name === 'hang_probe' && logs[0].data.timeoutMs === 40, '✓ tool_timeout observable 留痕(工具名 + 超时值)')
    const tr = (agent.debugLogs.value as any[]).filter((l) => l.type === 'tool_result' && l.data?.name === 'hang_probe')
    assert(tr.length === 1 && tr[0].data.status === 'error' && /工具执行超时/.test(tr[0].data.result), '✓ 超时结果 = recoverable 错误文案(教勿原样重试)')
  }
  {
    // ② 未打标豁免:原生 tool 80ms 才完成 + toolTimeoutMs=40 → 不被杀(设计内慢工具零误伤)
    const slow = tool(async () => { await delay(80); return 'slow-ok' }, { name: 'slow_builtin', description: 'd', schema: z.object({}) })
    const agent = createAgent({ llm: new ScriptLLM([{ tool: { name: 'slow_builtin', args: {} } }]) as any, tools: [slow], toolTimeoutMs: 40, maxRetries: 0 })
    let final = ''
    await agent.stream([{ role: 'user', content: '跑', timestamp: Date.now() }], (e: any) => { if (e.type === 'done') final = e.content }, undefined)
    assert(final === '完成', '✓ 未打标工具(80ms > 40ms 超时)不被杀 → 豁免面生效(内置/委派/conflict ask 同口径)')
    const tr = (agent.debugLogs.value as any[]).filter((l) => l.type === 'tool_result' && l.data?.name === 'slow_builtin')
    assert(tr.length === 1 && tr[0].data.status === 'done' && tr[0].data.result === 'slow-ok', '✓ 未打标工具正常返回结果')
  }
  {
    // ③ 兄弟工具不受株连:同轮 hang(被杀)+ good(正常)+ 0=关(挂起不判死)
    const hang = defineTool({ name: 'hang2', description: 'd', schema: z.object({}), handler: () => new Promise(() => {}) })
    const good = defineTool({ name: 'good2', description: 'd', schema: z.object({}), handler: () => 'good-ok' })
    const agent = createAgent({ llm: new ScriptLLM([{ tool: { name: 'hang2', args: {} } }, { tool: { name: 'good2', args: {} } }]) as any, tools: [hang, good], toolTimeoutMs: 40, maxRetries: 0 })
    let final = ''
    await agent.stream([{ role: 'user', content: '跑', timestamp: Date.now() }], (e: any) => { if (e.type === 'done') final = e.content }, undefined)
    const tr = (agent.debugLogs.value as any[]).filter((l) => l.type === 'tool_result')
    const hangR = tr.find((l) => l.data?.name === 'hang2')
    const goodR = tr.find((l) => l.data?.name === 'good2')
    assert(hangR?.data?.status === 'error' && goodR?.data?.status === 'done' && goodR.data.result === 'good-ok', '✓ 兄弟工具不受株连(超时只收口肇事工具)')
    assert(final === '完成', '✓ 同轮含超时工具仍正常收口')
  }
  {
    // ④ toolTimeoutMs=0 → 真·关闭:挂起工具拖住 stream(150ms 竞速窗口内未收口)
    const hang = defineTool({ name: 'hang3', description: 'd', schema: z.object({}), handler: () => new Promise(() => {}) })
    const agent = createAgent({ llm: new ScriptLLM([{ tool: { name: 'hang3', args: {} } }]) as any, tools: [hang], toolTimeoutMs: 0, maxRetries: 0 })
    let done = false
    const p = agent.stream([{ role: 'user', content: '跑', timestamp: Date.now() }], () => {}, undefined).then(() => { done = true })
    await Promise.race([p, delay(150)])
    assert(!done, '✓ 0=关:看门狗不介入(显式关闭语义保留,集成方自负长等待)')
  }

  console.log('\n[conflictManager signal race(P0#2)]')
  {
    // ① 正常路径不受影响:无 signal → 挂起等 resolve
    const mgr = createConflictManager()
    const p = mgr.set({ path: 'a', current: 'x', incoming: 'y' } as any)
    assert(!!mgr.pendingConflict.value, '✓ 无 signal:冲突照常挂起 pendingConflict')
    mgr.resolve('overwrite')
    assert((await p).action === 'overwrite' && !mgr.pendingConflict.value, '✓ 用户裁决 overwrite 正常收口 + 清 pending')
  }
  {
    // ② signal 已中止:不挂起直接 keep_external
    const mgr = createConflictManager()
    const ac = new AbortController(); ac.abort()
    const r = await mgr.set({ path: 'a', current: 'x', incoming: 'y' } as any, ac.signal)
    assert(r.action === 'keep_external' && !mgr.pendingConflict.value, '✓ signal 已中止 → 直接 keep_external(不挂 pending)')
  }
  {
    // ③ 挂起中 abort → keep_external 收口 + 清 pending;晚到的用户 resolve no-op
    const mgr = createConflictManager()
    const ac = new AbortController()
    const p = mgr.set({ path: 'a', current: 'x', incoming: 'y' } as any, ac.signal)
    assert(!!mgr.pendingConflict.value, '✓ 挂起中:pending 正常设置')
    ac.abort()
    assert((await p).action === 'keep_external', '✓ abort → onConflict Promise 按 keep_external 收口(不再永挂)')
    assert(!mgr.pendingConflict.value, '✓ abort 收口后 pendingConflict 已清')
    mgr.resolve('overwrite') // 晚到裁决:no-op 不抛错
    assert(!mgr.pendingConflict.value, '✓ 晚到的用户 resolve 走 no-op(pending 已 null)')
  }
  {
    // ④ 新冲突覆盖 + 自动裁决路径不受 signal race 影响
    const mgr = createConflictManager(undefined, () => 'overwrite')
    const r = await mgr.set({ path: 'a', current: 'x', incoming: 'y' } as any)
    assert(r.action === 'overwrite', '✓ conflictPolicy 自动裁决路径不受影响(不挂起)')
    const mgr2 = createConflictManager()
    const p1 = mgr2.set({ path: 'a', current: 'x', incoming: 'y' } as any)
    const p2 = mgr2.set({ path: 'b', current: 'x', incoming: 'y' } as any)
    assert((await p1).action === 'keep_external', '✓ 既有语义保留:新冲突覆盖旧 pending → 旧按 keep_external 收口')
    mgr2.resolve('keep_external')
    assert((await p2).action === 'keep_external', '✓ 第二冲突经用户裁决收口')
  }
}
