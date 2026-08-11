/**
 * LLM 流停滞看门狗(fix-hang-and-feedback P1-7)
 *
 * 缺口:连接活着但对端不吐 chunk(黑洞/假死)时,`for await` 永转,loading 永不结束,
 * 唯一出路是手动 abort。本模块给 AsyncIterable 包一层「chunk 间隔超时」:
 * 相邻 chunk 间隔(含等首个 chunk)超过 stallMs → 抛 StreamStalledError(带 status=408,isRetryable 不当网络错重试)。
 *
 * 设计要点:
 *  - 纯函数包装,可单测;ms<=0 透传(关闭看门狗)
 *  - 超时后**不调** iterator.return():黑洞流的 return() 同样可能永挂,会阻塞 for-await 的异常传播;
 *    底层流的清理交给调用方的内部 AbortController(超时时 abort),pending next() 的拒绝由 catch 吞掉防 unhandled
 *  - abort 语义透传:外层 abort → 底层流 AbortError → race 带出 → 调用方按 isAbort 收口(保留 partial)
 */

/** 流停滞错误(status=408:isRetryable 判 4xx 不重试,避免把停滞当网络错空烧重试) */
export class StreamStalledError extends Error {
  readonly waitedMs: number
  constructor(waitedMs: number) {
    super(`LLM 流停滞:${waitedMs}ms 无数据,已中断(可调 streamStallMs 放宽或设 0 关闭)`)
    this.name = 'StreamStalledError'
    this.waitedMs = waitedMs
    ;(this as { status?: number }).status = 408
  }
}

/** 默认停滞阈值 90s:大上下文 prefill 实测 30-60s(1M 窗口),留裕量;正常生成 chunk 间隔 <5s */
export const DEFAULT_STREAM_STALL_MS = 90_000

/**
 * 包一层 chunk 间隔超时。ms<=0 → 原样透传(关闭)。
 * 每收到一个 chunk 重置计时;首个 chunk 同样受控(防 prefill 后黑洞)。
 */
export async function* withStallTimeout<T>(iterable: AsyncIterable<T>, ms: number): AsyncGenerator<T> {
  if (!(ms > 0)) {
    yield* iterable
    return
  }
  const it = iterable[Symbol.asyncIterator]()
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(new StreamStalledError(ms)), ms)
    })
    const nextP = it.next()
    nextP.catch(() => { /* 超时后底层才 reject 的 next():吞掉防 unhandled rejection(清理走 abort) */ })
    let next: IteratorResult<T>
    try {
      next = await Promise.race([nextP, timeout])
    } finally {
      clearTimeout(timer)
    }
    if (next.done) return
    yield next.value
  }
}
