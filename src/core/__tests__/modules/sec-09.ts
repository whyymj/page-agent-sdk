import { isAbort, isRetryable, withRetry } from '../../harness/retry'
import { createAgent } from '../../harness/createAgent'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessageChunk } from '@langchain/core/messages'

// tsx 运行时由 node 提供 process;tsc 静态检查无 @types/node,显式声明其类型
import type { TestCtx } from './_ctx'

/** 脚本化易坏 LLM:前 fails 次调用抛无 status 网络错(可重试),之后正常产出「完成」 */
class FlakyLLM extends BaseChatModel {
  calls = 0
  constructor(private fails: number) { super({}) }
  _llmType(): string { return 'flaky' }
  async *_streamResponseChunks(): AsyncGenerator<any> {
    this.calls += 1
    if (this.calls <= this.fails) throw new Error('read_response_body_failed: upstream ended the stream before completion')
    yield { text: '完成', message: new AIMessageChunk({ content: '完成' }), generationInfo: {} }
  }
  async _generate(): Promise<any> {
    this.calls += 1
    if (this.calls <= this.fails) throw new Error('read_response_body_failed')
    return { generations: [{ text: '完成', message: new AIMessageChunk({ content: '完成' }) }], llmOutput: {} }
  }
}

// retry(模型调用重试 + abort 判定)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx;
  console.log('\n[retry]')
  {
    // isAbort
    assert(isAbort({ name: 'AbortError' }) === true, 'isAbort: name===AbortError 命中')
    assert(isAbort(new Error('net')) === false, 'isAbort: 普通 Error 非 abort')
    const ac = new AbortController()
    assert(isAbort(new Error('x'), ac.signal) === false, 'isAbort: 未 aborted 的 signal 不算')
    ac.abort()
    assert(isAbort(new Error('x'), ac.signal) === true, 'isAbort: signal.aborted 命中')

    // isRetryable(必须先排除 abort 再判 status)
    assert(isRetryable({}) === true, 'isRetryable: 网络错误(status undefined)可重试')
    assert(isRetryable({ name: 'TimeoutError' }) === true, 'isRetryable: 超时可重试')
    assert(isRetryable({ status: 429 }) === true, 'isRetryable: 429 可重试')
    assert(isRetryable({ lc_error_code: 'MODEL_RATE_LIMIT' }) === true, 'isRetryable: MODEL_RATE_LIMIT 可重试')
    assert(isRetryable({ status: 500 }) === true, 'isRetryable: 500 可重试')
    assert(isRetryable({ status: 503 }) === true, 'isRetryable: 503 可重试')
    assert(isRetryable({ status: 400 }) === false, 'isRetryable: 400 不重试(参数错误)')
    assert(isRetryable({ status: 401 }) === false, 'isRetryable: 401 不重试(鉴权)')
    assert(isRetryable({ status: 404 }) === false, 'isRetryable: 404 不重试')
    assert(isRetryable({ name: 'AbortError' }) === false, 'isRetryable: AbortError 不重试(即使 status undefined)')
    assert(isRetryable(null) === false, 'isRetryable: null 不重试')

    // withRetry(baseDelayMs:0 避免真实退避等待)
    const r1 = await withRetry(() => Promise.resolve('ok'), { baseDelayMs: 0 })
    assert(r1 === 'ok', 'withRetry: 首次成功直接返回')

    let calls = 0
    const r2 = await withRetry(
      async () => {
        calls++
        if (calls < 3) throw Object.assign(new Error('net'), { status: undefined })
        return 'recovered'
      },
      { baseDelayMs: 0 },
    )
    assert(r2 === 'recovered' && calls === 3, 'withRetry: 网络错误重试 2 次后第 3 次成功')

    // 4xx 不可重试:立即抛,只调 1 次
    let calls4xx = 0
    let threw4xx = false
    try {
      await withRetry(async () => {
        calls4xx++
        throw Object.assign(new Error('bad'), { status: 400 })
      }, { baseDelayMs: 0 })
    } catch (e: any) {
      threw4xx = e.status === 400
    }
    assert(threw4xx && calls4xx === 1, 'withRetry: 4xx 不重试,立即抛')

    // AbortError 不重试:立即抛,只调 1 次
    let callsAbort = 0
    let threwAbort = false
    try {
      await withRetry(async () => {
        callsAbort++
        const e = new Error('aborted')
        e.name = 'AbortError'
        throw e
      }, { baseDelayMs: 0 })
    } catch (e: any) {
      threwAbort = e.name === 'AbortError'
    }
    assert(threwAbort && callsAbort === 1, 'withRetry: AbortError 不重试,立即抛')

    // 达到 maxRetries 仍失败:抛错,maxRetries+1 次尝试
    let callsMax = 0
    let threwMax = false
    try {
      await withRetry(async () => {
        callsMax++
        throw new Error('net')
      }, { maxRetries: 2, baseDelayMs: 0 })
    } catch (e: any) {
      threwMax = /net/.test(e.message)
    }
    assert(threwMax && callsMax === 3, 'withRetry: 达上限抛错(maxRetries=2 → 3 次尝试)')

    // 退避回调被触发(验证 onRetry 调用次数 = 重试次数)
    let retryNotified = 0
    try {
      await withRetry(
        async () => {
          throw Object.assign(new Error('net'), { status: undefined })
        },
        { maxRetries: 2, baseDelayMs: 0, onRetry: () => retryNotified++ },
      )
    } catch {
      /* 预期抛错 */
    }
    assert(retryNotified === 2, 'withRetry: onRetry 回调在每次重试前触发(2 次)')
  }

  // ===== retry-visibility(2026-09-09):重试/终败进 debugLogs + inspect 计数 =====
  // 网关断流事故实测「msgs 恒定 + debugLogs 静默」的黑洞假象排障 1h —— 修前重试只在 console.warn、
  // 终败直接 throw 零留痕;修后 model_retry / model_call_failed 两 stage + llmRetries/llmCallFailures 计数全可见
  {
    // 可恢复:前 2 次网络错 → 自动重试 → 第 3 次成功;重试全程留痕 + 计数
    const flaky = new FlakyLLM(2)
    const agent: any = createAgent({ llm: flaky as any, retryDelayMs: 0 })
    const reply = await agent.invoke([{ role: 'user', content: 'hi' }])
    assert(String(reply).includes('完成'), 'retry-visibility → 瞬时网络错自动重试后成功(行为不回归)')
    const stages = agent.debugLogs.value.map((l: any) => l.data?.stage)
    assert(stages.includes('model_retry'), 'retry-visibility → 每次重试进 debugLogs(stage=model_retry,黑洞可判)')
    // 钉住重试的 at 归属:当前 LangChain stream() 急切消费 —— 零 chunk 前的失败都在启动段(at:'launch')
    // 暴露;at:'iterate' 递归分支是懒消费形态的兜底(生成器首个 pull 才抛),不为本断言所钉
    assert(agent.debugLogs.value.some((l: any) => l.data?.stage === 'model_retry' && l.data?.at === 'launch'), 'retry-visibility → 启动段重试留痕(at:launch;当前 LC 急切消费下零 chunk 失败的常态路径)')
    assert(agent.getLlmRetries() === 2, 'retry-visibility → inspect 计数 llmRetries=2(启动/body 两阶段任一路径都计数)')
    assert(agent.getLlmCallFailures() === 0, 'retry-visibility → 恢复场景终败计数为 0')
  }
  {
    // 终败:持续网络错 → 重试耗尽后抛;最终失败留痕 + 计数(修前此处零日志直接 throw)
    const dead = new FlakyLLM(99)
    const agent2: any = createAgent({ llm: dead as any, retryDelayMs: 0 })
    let threw = false
    try { await agent2.invoke([{ role: 'user', content: 'hi' }]) } catch { threw = true }
    assert(threw, 'retry-visibility → 重试耗尽后如实抛错(不吞)')
    const stages2 = agent2.debugLogs.value.map((l: any) => l.data?.stage)
    assert(stages2.includes('model_call_failed'), 'retry-visibility → 最终失败进 debugLogs(stage=model_call_failed,修前零留痕)')
    assert(agent2.getLlmCallFailures() >= 1, 'retry-visibility → inspect 计数 llmCallFailures≥1')
    assert(agent2.getLlmRetries() >= 1, 'retry-visibility → 耗尽路径重试计数同样累计')
  }
}
