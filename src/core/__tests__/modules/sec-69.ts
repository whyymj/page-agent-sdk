/**
 * sec-69:fix-hang-and-feedback(挂起与反馈)单元层
 * - 流停滞看门狗 withStallTimeout(透传/停滞抛错/间隔重置/关闭)
 * - 流总时长上限 maxMs(空转帧黑洞:chunk 不断但无实质内容,间隔看门狗被无限重置 → 绝对截止兜底)
 * - StreamStalledError 不被 isRetryable 当网络错
 * - skills 远程 fetch abort → 超时错误分类(readSkillDoc)
 */
import { withStallTimeout, StreamStalledError, StreamMaxDurationError, EmptyLLMResponseError, DEFAULT_STREAM_MAX_DURATION_MS } from '../../utils/stallTimeout'
import { isRetryable } from '../../harness/retry'
import { readSkillDoc } from '../../harness/skills'
import type { TestCtx } from './_ctx'

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const v of it) out.push(v)
  return out
}

/** 正常序列生成器(每项间隔 delayMs) */
async function* seq(items: number[], delayMs = 0): AsyncGenerator<number> {
  for (const it of items) {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
    yield it
  }
}

/** 吐一个后永挂(模拟黑洞流) */
async function* stallAfter(first: number): AsyncGenerator<number> {
  yield first
  await new Promise(() => {})
}

/** 空转帧黑洞流:chunk 按间隔不断到达但永不完(2026-08-17 直连鉴别实测:keepalive 空转喂饱间隔看门狗) */
async function* dripForever(intervalMs: number): AsyncGenerator<number> {
  for (let i = 0; ; i++) {
    await new Promise((r) => setTimeout(r, intervalMs))
    yield i
  }
}

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[fix-hang-and-feedback · 流停滞看门狗]')

  // 透传:chunk 间隔远小于阈值 → 全量收到
  {
    const out = await collect(withStallTimeout(seq([1, 2, 3], 1), 5000))
    assert(out.length === 3 && out[0] === 1 && out[2] === 3, '✓ withStallTimeout 正常流透传(全量 chunk)')
  }

  // 停滞:首个 chunk 后永挂 → 超阈值抛 StreamStalledError
  {
    let err: unknown
    const got: number[] = []
    try {
      for await (const v of withStallTimeout(stallAfter(1), 60)) got.push(v)
    } catch (e) {
      err = e
    }
    assert(got.length === 1 && got[0] === 1, '✓ 停滞前已到达的 chunk 正常产出')
    assert(err instanceof StreamStalledError, '✓ 停滞 → StreamStalledError(原:for await 永转,唯一出路手动 abort)')
    assert(err instanceof StreamStalledError && err.waitedMs === 60, '✓ StreamStalledError.waitedMs 反映阈值')
    assert(err instanceof StreamStalledError && (err as { status?: number }).status === 408, '✓ status=408(防被当网络错空烧重试)')
  }

  // 等首个 chunk 也受控(首 chunk 前黑洞同样抛)
  {
    let err: unknown
    try {
      await collect(withStallTimeout((async function* () { await new Promise(() => {}) })(), 50))
    } catch (e) {
      err = e
    }
    assert(err instanceof StreamStalledError, '✓ 等首个 chunk 停滞 → 同样抛错(防 prefill 后黑洞)')
  }

  // 间隔重置:chunk 持续到达(各自 < 阈值)→ 总时长超阈值也不误报
  {
    const out = await collect(withStallTimeout(seq([1, 2, 3, 4], 15), 50))
    assert(out.length === 4, '✓ chunk 间隔重置:慢而连续的流不误报(总 60ms > 50ms 阈值仍透传)')
  }

  // 关闭:ms<=0 透传(不计时)
  {
    const out = await collect(withStallTimeout(seq([1, 2], 1), 0))
    assert(out.length === 2, '✓ stallMs<=0 关闭看门狗,原样透传')
  }

  // isRetryable 不当网络错重试(4xx 语义)
  {
    assert(isRetryable(new StreamStalledError(1000)) === false, '✓ StreamStalledError 不进重试(停滞重试大概率复现)')
  }

  console.log('\n[fix-hang-and-feedback · LLM 空响应错误(网关 200+错误体形态)]')
  {
    // editor 诊断(2026-08-22)实证:3.42 空响应降级为空 AI 消息防崩溃,但用户只见沉默空泡;
    // 升级为显式抛错(coreModelCall 自动重试 1 次仍空后)→ send reject + error 事件 UI 可见
    const e = new EmptyLLMResponseError()
    assert(e.name === 'EmptyLLMResponseError' && /空响应/.test(e.message), '✓ EmptyLLMResponseError 消息可读(归因网关错误体 + 已重试)')
    assert((e as { status?: number }).status === 502, '✓ EmptyLLMResponseError status=502(上游网关问题归因;抛出点在流结束后不进 withRetry)')
  }

  console.log('\n[fix-hang-and-feedback · 流总时长上限(maxMs,空转帧黑洞兜底)]')

  // 黑洞复现形状(核心场景):chunk 不断(间隔看门狗永不触发)但总时长超限 → StreamMaxDurationError
  {
    let err: unknown
    let received = 0
    try {
      for await (const _v of withStallTimeout(dripForever(20), 5000, 120)) received++
    } catch (e) {
      err = e
    }
    assert(received >= 3, '✓ 黑洞形状:空转 chunk 持续被消费(间隔看门狗被喂饱,间隔阈值 5000ms 永不触发)')
    assert(err instanceof StreamMaxDurationError, '✓ 总时长超限 → StreamMaxDurationError(原:间隔看门狗盲区,冻结 7min+ 无报错)')
    assert(err instanceof StreamMaxDurationError && err.waitedMs === 120, '✓ StreamMaxDurationError.waitedMs 反映上限值')
  }

  // 继承语义:沿用 StreamStalledError 的 408 不重试与既有 catch 分支(instanceof 双命中)
  {
    const e = new StreamMaxDurationError(600_000)
    assert(e instanceof StreamStalledError, '✓ StreamMaxDurationError extends StreamStalledError(408 不重试语义继承)')
    assert((e as { status?: number }).status === 408 && isRetryable(e) === false, '✓ 总时长超限同样不进重试(上层重委派/重发自愈)')
    assert(DEFAULT_STREAM_MAX_DURATION_MS === 600_000, '✓ 默认总时长上限 600s(flash 大组件实测 3-7min 留裕量)')
  }

  // 正常放行:总时长低于上限的连续流完整透传(maxMs 设置不误报)
  {
    const out = await collect(withStallTimeout(seq([1, 2, 3, 4], 10), 5000, 5000))
    assert(out.length === 4, '✓ 上限内连续流完整透传(maxMs 不误报合法生成)')
  }

  // 辨析:真停滞(间隔超限)优先于总时长 → 仍抛 StreamStalledError 非 Max
  {
    let err: unknown
    try {
      await collect(withStallTimeout(stallAfter(1), 60, 5000))
    } catch (e) {
      err = e
    }
    assert(err instanceof StreamStalledError && !(err instanceof StreamMaxDurationError), '✓ 真停滞仍抛 StreamStalledError(与总时长超限区分归因)')
  }

  // 边界:maxMs=0 且 ms<=0 → 全关闭透传
  {
    const out = await collect(withStallTimeout(seq([1, 2], 5), 0, 0))
    assert(out.length === 2, '✓ ms<=0 且 maxMs<=0 全关闭,原样透传')
  }

  // 边界:仅总时长(ms<=0 间隔关闭,maxMs>0 仍生效)
  {
    let err: unknown
    try {
      await collect(withStallTimeout(dripForever(10), 0, 100))
    } catch (e) {
      err = e
    }
    assert(err instanceof StreamMaxDurationError, '✓ 间隔看门狗关闭时总时长上限独立生效(ms<=0, maxMs>0)')
  }

  console.log('\n[fix-hang-and-feedback · skills fetch 超时分类]')
  {
    // stub fetch:abort 时以 AbortError 拒(等价 fetchWithTimeout 30s 到点 abort 的形态)
    const origFetch = (globalThis as { fetch?: unknown }).fetch
    ;(globalThis as { fetch?: unknown }).fetch = (_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => {
          const e = new Error('The user aborted a request.')
          e.name = 'AbortError'
          rej(e)
        })
      })
    try {
      const r = await readSkillDoc('https://example.com/hang.md')
      assert(r.ok === false && /超时/.test(r.error ?? ''), '✓ readSkillDoc abort → 「读取超时」结构化错误(回灌 LLM 自纠,不永挂)')
    } finally {
      ;(globalThis as { fetch?: unknown }).fetch = origFetch
    }
  }
}
