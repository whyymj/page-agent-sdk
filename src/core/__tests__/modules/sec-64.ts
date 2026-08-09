/**
 * sec-64:agent-driven-compression Phase C(summaryLlm.decide 两段式工具循环)
 * stub llm 测:成功(tool_calls→回灌→JSON)/ 围栏提取 / 第一轮非法重试成功 / schema 持续失败 null /
 * refine 持续失败 null / 不支持工具 null / 超时 null / 调用抛错 null。
 */
import type { TestCtx } from './_ctx'
import { AIMessage } from '@langchain/core/messages'
import { buildCompressDecisionInvoke } from '../../sdk/llmResolver'
import type { AgentMessage } from '../../types'

/* eslint-disable @typescript-eslint/no-explicit-any */
const msg = (role: string, content: string): AgentMessage => ({ role, content, timestamp: 0 }) as AgentMessage
function makeRounds(n: number): AgentMessage[] {
  const arr: AgentMessage[] = []
  for (let i = 0; i < n; i++) {
    arr.push(msg('user', `问题${i}`))
    arr.push(msg('assistant', `回复${i}`))
  }
  return arr
}

/** scripted LLM:按脚本序列返回 AIMessage(tool_calls 或 content);可注入 delay/throw/无 bindTools */
function scriptedLlm(scripts: any[], opts: { noBindTools?: boolean } = {}): any {
  let i = 0
  const invoke = async (_msgs: any, callOpts: any = {}): Promise<any> => {
    const signal = callOpts?.signal as AbortSignal | undefined
    const script = scripts[Math.min(i, scripts.length - 1)]
    i++
    if (script.delay) {
      // delay 期间响应 signal abort(模拟真 LLM invoke 被 abort 中断 → decide 超时 catch null)
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, script.delay)
        if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')) })
      })
    }
    if (script.throw) throw new Error(script.throw)
    if (script.toolCalls) {
      return new AIMessage({
        content: '',
        tool_calls: script.toolCalls.map((tc: any, idx: number) => ({ name: tc.name || 'inspect_context', args: tc.args || {}, id: tc.id || `call_${idx}` })),
      })
    }
    return new AIMessage({ content: script.content })
  }
  const llm: any = { invoke, stream: async function* () { /* stub */ }, bindTools: () => ({ invoke }) }
  if (opts.noBindTools) delete llm.bindTools
  return llm
}

const j = (o: unknown) => JSON.stringify(o)

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // 1. 两段式工具循环成功:tool_calls 轮 → inspect_context 执行回灌 → JSON 轮 → 决策
  const decide1 = buildCompressDecisionInvoke({
    summaryLlm: scriptedLlm([{ toolCalls: [{}] }, { content: j({ keepRounds: 3, summarize: { mode: 'llm' }, reason: '测试' }) }]),
    decisionTimeoutMs: 6000,
  } as any)!
  const d1 = await decide1({ getMessages: () => makeRounds(5), contextWindow: 2000, thresholdRatio: 0.5, triggerReason: 'token 超阈值', triggerMode: 'token' })
  assert(d1 !== null && d1.keepRounds === 3, '✓ decide → 两段式工具循环(tool_calls→回灌→JSON)输出决策')
  assert(d1 !== null && d1.summarize.mode === 'llm', '✓ decide → 决策含 summarize.mode')

  // 2. JSON 围栏提取(```json``` 块)
  const decide2 = buildCompressDecisionInvoke({
    summaryLlm: scriptedLlm([{ content: '```json\n' + j({ windowRatio: 0.4, summarize: { mode: 'index' } }) + '\n```' }]),
  } as any)!
  const d2 = await decide2({ getMessages: () => makeRounds(5), triggerReason: '轮数超', triggerMode: 'rounds' })
  assert(d2 !== null && d2.windowRatio === 0.4, '✓ decide → 提取 ```json``` 围栏内 JSON')

  // 3. 第一轮非法文本 → 重试一次成功
  const decide3 = buildCompressDecisionInvoke({
    summaryLlm: scriptedLlm([{ content: '不是JSON' }, { content: j({ keepRounds: 2, summarize: { mode: 'llm' } }) }]),
  } as any)!
  const d3 = await decide3({ getMessages: () => makeRounds(5), triggerReason: '超', triggerMode: 'token' })
  assert(d3 !== null && d3.keepRounds === 2, '✓ decide → 第一轮非法,重试一次成功')

  // 4. schema 校验持续失败(非法 mode)→ 重试仍失败 → null
  const decide4 = buildCompressDecisionInvoke({
    summaryLlm: scriptedLlm([{ content: j({ keepRounds: 2, summarize: { mode: 'bad' } }) }, { content: j({ keepRounds: 2, summarize: { mode: 'bad' } }) }]),
  } as any)!
  const d4 = await decide4({ getMessages: () => makeRounds(5), triggerReason: '超', triggerMode: 'token' })
  assert(d4 === null, '✓ decide → schema 校验持续失败 → null(降级静态)')

  // 5. 两字段都空 refine 持续 → null
  const decide5 = buildCompressDecisionInvoke({
    summaryLlm: scriptedLlm([{ content: j({ summarize: { mode: 'llm' } }) }, { content: j({ summarize: { mode: 'llm' } }) }]),
  } as any)!
  const d5 = await decide5({ getMessages: () => makeRounds(5), triggerReason: '超', triggerMode: 'token' })
  assert(d5 === null, '✓ decide → keepRounds/windowRatio 都空 refine 持续 → null')

  // 6. 不支持工具(无 bindTools)→ null
  const decide6 = buildCompressDecisionInvoke({
    summaryLlm: scriptedLlm([{ content: j({ keepRounds: 2, summarize: { mode: 'llm' } }) }], { noBindTools: true }),
  } as any)!
  const d6 = await decide6({ getMessages: () => makeRounds(5), triggerReason: '超', triggerMode: 'token' })
  assert(d6 === null, '✓ decide → 模型不支持 bindTools → null')

  // 7. 超时 → null(decisionTimeoutMs 极短 + delay stub)
  const decide7 = buildCompressDecisionInvoke({
    summaryLlm: scriptedLlm([{ delay: 300, content: j({ keepRounds: 2, summarize: { mode: 'llm' } }) }]),
    decisionTimeoutMs: 50,
  } as any)!
  const d7 = await decide7({ getMessages: () => makeRounds(5), triggerReason: '超', triggerMode: 'token' })
  assert(d7 === null, '✓ decide → 超时 → null(降级不阻塞)')

  // 8. 调用抛错 → catch null(bindTools 存在但端点不支持 400)
  const decide8 = buildCompressDecisionInvoke({
    summaryLlm: scriptedLlm([{ throw: 'API 400 工具不支持' }]),
  } as any)!
  const d8 = await decide8({ getMessages: () => makeRounds(5), triggerReason: '超', triggerMode: 'token' })
  assert(d8 === null, '✓ decide → LLM 调用抛错 → null')
}
/* eslint-enable @typescript-eslint/no-explicit-any */
