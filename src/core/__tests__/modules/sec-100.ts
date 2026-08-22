/**
 * sec-100:stale-read-invalidation Phase 2(createAgent 循环接线层)
 * 覆盖:写后旧 read ToolMessage 被占位替换(下轮模型请求可见)/ debugLogs stage 留痕 /
 * getStaleReadsInvalidated 会话累计 / 关开关原文保留 / 子 agent 标记栈同样生效且可关 /
 * workingMemory 联动(写成功刷新 lastHashes,防 pin 段旧 hash 与占位「请重读」反向指令)。
 */
import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
import { createAgent } from '../../harness/createAgent'
import { createWorkingMemoryMiddleware } from '../../harness/workingMemory'
import type { Middleware } from '../../harness/middleware'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, AIMessageChunk, ToolMessage } from '@langchain/core/messages'
import type { TestCtx } from './_ctx'
import { STALE_PLACEHOLDER_MARK } from '../../harness/readInvalidation'

/** 脚本化 LLM:按序返回 [tool_call, tool_call, ..., 最终文本] */
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

interface RunOpts {
  staleReadInvalidation?: boolean
  __pgIsSubagent?: boolean
  extraMiddleware?: Middleware[]
}

/** 跑一轮 [read components.0 → write set components.0.title → 收口] 循环,返回末次模型请求消息 + agent */
async function runLoop(o: RunOpts) {
  const bind: any = { components: [{ type: 'card', title: '旧标题' }] }
  const tools = createDataOps(
    { schema: z.object({ components: z.array(z.object({ type: z.string(), title: z.string() })) }), bind, description: '组件' },
    {},
  )
  const captured: any[][] = []
  const captureMw: Middleware = {
    name: 'capture',
    wrapModelCall: async (req, next) => { captured.push([...req.messages]); return next(req) },
  }
  const agent = createAgent({
    llm: new ScriptLLM([
      { tool: { name: 'read', args: { jsonPath: 'components.0' } } },
      { tool: { name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.title', value: '新标题' } } } },
    ]) as any,
    tools,
    middleware: [captureMw, ...(o.extraMiddleware ?? [])],
    maxToolRounds: 5,
    maxRetries: 0,
    ...(o.staleReadInvalidation !== undefined ? { staleReadInvalidation: o.staleReadInvalidation } : {}),
    ...(o.__pgIsSubagent !== undefined ? { __pgIsSubagent: o.__pgIsSubagent } : {}),
  })
  let final = ''
  await agent.stream([{ role: 'user', content: '改标题', timestamp: Date.now() }], (e: any) => { if (e.type === 'done') final = e.content }, undefined)
  const lastReq = captured[captured.length - 1] ?? []
  const readToolMsg = lastReq.filter((m) => m instanceof ToolMessage && (m as any).tool_call_id === 'call_0')[0]
  return { agent, final, lastReq, readToolMsg: readToolMsg as ToolMessage | undefined, captured, bind }
}

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // 1. 默认开:写后旧 read 在下一轮模型请求中 = 失效占位
  {
    const r = await runLoop({})
    assert(r.final === '完成', '✓ 循环接线 → 脚本循环跑完收口')
    assert(!!r.readToolMsg, '✓ 循环接线 → 末轮请求含旧 read ToolMessage')
    const c = String((r.readToolMsg as any).content ?? '')
    assert(c.startsWith(STALE_PLACEHOLDER_MARK), `✓ 循环接线 → 写后旧 read 替换为占位(前 20 字:${c.slice(0, 20)}…)`)
    assert(c.includes('建议窄读:components.0'), '✓ 循环接线 → 占位钉原读路径')
    assert((r.readToolMsg as any).tool_call_id === 'call_0', '✓ 循环接线 → 占位保留 tool_call_id')
    // debugLogs 留痕 + 会话累计
    const logs = (r.agent.debugLogs.value as any[]).filter((l) => l.data?.stage === 'stale_read_invalidated')
    assert(logs.length === 1 && logs[0].data.invalidatedCount === 1 && logs[0].data.round === 2, `✓ 循环接线 → debugLogs stage 留痕(实测 ${logs.length} 条)`)
    assert(logs[0].data.writtenPaths.join() === 'components.0.title', '✓ 循环接线 → 留痕含 writtenPaths')
    assert(r.agent.getStaleReadsInvalidated() === 1, '✓ 循环接线 → getStaleReadsInvalidated 会话累计')
    assert(r.bind.components[0].title === '新标题', '✓ 循环接线 → 写实际落地(失效不改数据面)')
  }

  // 2. 关开关:原文保留 + 零留痕
  {
    const r = await runLoop({ staleReadInvalidation: false })
    const c = String((r.readToolMsg as any)?.content ?? '')
    assert(!c.startsWith(STALE_PLACEHOLDER_MARK) && c.includes('旧标题'), '✓ 关开关 → 旧 read 原文保留')
    const logs = (r.agent.debugLogs.value as any[]).filter((l) => l.data?.stage === 'stale_read_invalidated')
    assert(logs.length === 0, '✓ 关开关 → 零 stage 留痕')
    assert(r.agent.getStaleReadsInvalidated() === 0, '✓ 关开关 → 累计归零')
  }

  // 3. 子 agent 标记栈:同样生效且可关(透传链终点行为)
  {
    const r = await runLoop({ __pgIsSubagent: true })
    assert(String((r.readToolMsg as any)?.content ?? '').startsWith(STALE_PLACEHOLDER_MARK), '✓ 子栈 → 子 agent 同样生效(默认开)')
    const r2 = await runLoop({ __pgIsSubagent: true, staleReadInvalidation: false })
    assert(!String((r2.readToolMsg as any)?.content ?? '').startsWith(STALE_PLACEHOLDER_MARK), '✓ 子栈 → 子 agent 可关(评审 B4:主/子一致)')
  }

  // 4. workingMemory 联动:写成功刷新 lastHashes(旧 hash 不再 pin)
  {
    const wm = createWorkingMemoryMiddleware()
    const r = await runLoop({ extraMiddleware: [wm] })
    const snap = wm.getWorkingMemory()
    assert(!!snap && Object.keys(snap!.lastHashes).length >= 1, `✓ WM 联动 → lastHashes 有写后条目(实测 ${snap ? Object.keys(snap.lastHashes).length : 0})`)
    const before = (r.captured[1] ?? []).length // 写发生在第 2 轮
    assert(r.captured.length === 3 && before > 0, '✓ WM 联动 → 三轮模型请求(读/写/收口)')
    const hashKeys = Object.keys(snap!.lastHashes)
    assert(hashKeys.includes('components.0.title'), `✓ WM 联动 → 写路径 hash 覆盖(实测 [${hashKeys}])`)
    // 读的 hash(components.0)与写的 hash(整体)并存,不丢读定位
    assert(hashKeys.includes('components.0'), '✓ WM 联动 → 读定位 hash 不丢')
  }

  // 5. WM 删除族清条目 + 键归一(code review P2 回改):删除无新 hash → 清对应 path 条目防反向指令;
  //    '$.x' 与 'x' 统一为同一键(防读写两侧两键并存)
  {
    const wm = createWorkingMemoryMiddleware() as any
    // 读 '$.components.0' → 键归一为 'components.0'
    await wm.wrapToolCall({ name: 'read', args: { jsonPath: '$.components.0' } }, async () => ({ content: '主数据 @ components.0 = v (hash=aaa123bbb)', status: 'done' }))
    const s1 = wm.getWorkingMemory()
    assert(s1!.lastHashes['components.0'] === 'aaa123bbb' && s1!.lastHashes['$.components.0'] === undefined, '✓ WM 归一 → read 侧 "$.components.0" 归一为 "components.0" 键')
    // 删除族成功(无新 hash)→ 清条目(含后代)
    await wm.wrapToolCall({ name: 'write', args: { patch: { jsonPath: 'components.0' }, del: true } }, async () => ({ content: '已删除主数据 @ components.0', status: 'done' }))
    const s2 = wm.getWorkingMemory()
    assert(s2!.lastHashes['components.0'] === undefined, '✓ WM 删除族 → 删除后 lastHashes 条目被清(不再 pin 旧 hash 与占位反向指令)')
    // 对照组:set 族成功仍刷新
    await wm.wrapToolCall({ name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: 'x' } } }, async () => ({ content: '已 write(edit) 主数据(1 个 patch)。(新 hash=ccc123ddd)', status: 'done' }))
    assert(wm.getWorkingMemory()!.lastHashes['title'] === 'ccc123ddd', '✓ WM 删除族 → set 族成功对照组仍刷新 lastHashes')
  }
}
