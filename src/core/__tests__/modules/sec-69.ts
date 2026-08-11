/**
 * sec-69:fix-hang-and-feedback(挂起与反馈)单元层
 * - 流停滞看门狗 withStallTimeout(透传/停滞抛错/间隔重置/关闭)
 * - StreamStalledError 不被 isRetryable 当网络错
 * - skills 远程 fetch abort → 超时错误分类(readSkillDoc)
 */
import { withStallTimeout, StreamStalledError } from '../../utils/stallTimeout'
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
