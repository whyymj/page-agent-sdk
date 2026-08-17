/**
 * LLM 流停滞看门狗(fix-hang-and-feedback P1-7)+ 流总时长上限(stream-max-duration)
 *
 * 缺口:连接活着但对端不吐 chunk(黑洞/假死)时,`for await` 永转,loading 永不结束,
 * 唯一出路是手动 abort。本模块给 AsyncIterable 包一层「chunk 间隔超时」:
 * 相邻 chunk 间隔(含等首个 chunk)超过 stallMs → 抛 StreamStalledError(带 status=408,isRetryable 不当网络错重试)。
 *
 * 总时长上限(2026-08-17 直连鉴别实验驱动):间隔看门狗存在盲区 —— 中转站黑洞实测
 * 返回 200+SSE 头后以 keepalive/空帧无限空转,每帧都重置间隔计时但永无实质内容(冻结
 * 417s+ 无 StreamStalledError)。maxMs 从流开始记绝对截止:不论 chunk 到得多勤,单次
 * 调用总时长超限即抛 StreamMaxDurationError(继承 StreamStalledError 的 408 不重试语义,
 * 上层重委派/用户重发即自愈 —— 同 key 新流实测秒级正常)。
 *
 * 设计要点:
 *  - 纯函数包装,可单测;ms<=0 且 maxMs<=0 透传(全关闭)
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

/** 流总时长超限(空转帧黑洞):继承 StreamStalledError 沿用 408 不重试与既有 catch 分支,名字区分日志归因 */
export class StreamMaxDurationError extends StreamStalledError {
  constructor(totalMs: number) {
    super(totalMs)
    this.name = 'StreamMaxDurationError'
    this.message = `LLM 流总时长超限:${totalMs}ms(keepalive 空转黑洞特征:chunk 不断但无实质内容,可调 streamMaxDurationMs 放宽或设 0 关闭)`
  }
}

/** 默认停滞阈值 90s:大上下文 prefill 实测 30-60s(1M 窗口),留裕量;正常生成 chunk 间隔 <5s */
export const DEFAULT_STREAM_STALL_MS = 90_000

/** 默认流总时长上限 10min:flash 生成大组件实测 3-7min 单流,留裕量;黑洞实测冻结 7min+ 永不恢复 */
export const DEFAULT_STREAM_MAX_DURATION_MS = 600_000

/**
 * 包一层 chunk 间隔超时 + 可选总时长上限。ms<=0 且 maxMs<=0 → 原样透传(全关闭)。
 * 每收到一个 chunk 重置间隔计时(首个 chunk 同样受控,防 prefill 后黑洞);
 * maxMs 不随 chunk 重置(绝对截止,防空转帧喂饱间隔看门狗)。
 */
export async function* withStallTimeout<T>(iterable: AsyncIterable<T>, ms: number, maxMs?: number): AsyncGenerator<T> {
  if (!(ms > 0) && !(maxMs! > 0)) {
    yield* iterable
    return
  }
  const it = iterable[Symbol.asyncIterator]()
  const deadline = maxMs! > 0 ? Date.now() + maxMs! : Infinity
  for (;;) {
    // 本轮 race 时长 = min(间隔阈值, 距截止剩余);间隔关闭(ms<=0)时只剩截止约束
    const remain = deadline - Date.now()
    if (remain <= 0) throw new StreamMaxDurationError(maxMs!)
    const raceMs = Math.min(ms > 0 ? ms : Infinity, remain)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, rej) => {
      timer = setTimeout(() => rej(Date.now() >= deadline ? new StreamMaxDurationError(maxMs!) : new StreamStalledError(ms)), raceMs)
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
