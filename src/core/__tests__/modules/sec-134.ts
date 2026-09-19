/**
 * sec-134:auto-host-watch —— hostWatcher 纯函数域(createHostWatcher 工厂 + reason 生成)
 * 覆盖:hash 触发/去抖合并(url 优先)/重复同值不报/ignore 过滤/pushState patch 链式与还原/
 * 双实例错序卸载无死层/dispose 取消在途去抖/title observer/依赖缺失逐项降级/reason 截断。
 */
import type { TestCtx } from './_ctx'
import { createHostWatcher, buildHostWatchReason } from '../../sdk/hostWatcher'
import type { HostWatchEvent, HostWatcherTarget, HostWatchHistory } from '../../sdk/hostWatcher'

const tick = (ms = 8): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 假 window:监听器注册表 + 手动派发 */
function fakeTarget() {
  const listeners = new Map<string, Array<() => void>>()
  const target: HostWatcherTarget & {
    location: { href: string }
    dispatch: (type: string) => void
  } = {
    addEventListener: (type, fn) => { (listeners.get(type) ?? listeners.set(type, []).get(type)!).push(fn) },
    removeEventListener: (type, fn) => { const l = listeners.get(type); if (l) listeners.set(type, l.filter((f) => f !== fn)) },
    location: { href: 'http://x/#/a' },
    dispatch: (type) => { for (const fn of listeners.get(type) ?? []) fn() },
  }
  return target
}

/** 假 MutationObserver:构造后可用 trigger() 手动触发回调 */
class FakeMO {
  static last: FakeMO | null = null
  private cb: () => void
  constructor(cb: () => void) { this.cb = cb; FakeMO.last = this }
  observe(): void {}
  disconnect(): void {}
  trigger(): void { this.cb() }
}

function fakeDoc(title: string): { title: string; querySelector: (s: string) => unknown } {
  return { title, querySelector: (s: string) => (s.includes('title') ? {} : null) }
}

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // ===== 1. hashchange 触发 → onReport(kind/from/to)=====
  {
    const reports: HostWatchEvent[] = []
    const target = fakeTarget()
    const h = createHostWatcher({ target, options: { debounceMs: 0 }, onReport: (e) => reports.push(e) })
    assert(h !== null && h.info.url === true && h.info.pushState === false && h.info.title === false, '✓ hostWatch:url 项装配,info 反射默认面(url on / pushState·title off)')
    target.location.href = 'http://x/#/b'
    target.dispatch('hashchange')
    await tick()
    assert(reports.length === 1 && reports[0].kind === 'hash' && reports[0].from === 'http://x/#/a' && reports[0].to === 'http://x/#/b',
      '✓ hashchange → 一次报案(kind=hash,from/to 为前后 URL)')
    // 重复同值不报
    target.dispatch('hashchange')
    await tick()
    assert(reports.length === 1, '✓ URL 未变的重复事件不报案')
    h!.dispose()
  }

  // ===== 2. 去抖合并:窗口内 hash + title 连发 → 一次报案且 url 类优先 =====
  {
    const reports: HostWatchEvent[] = []
    const target = fakeTarget()
    const doc = fakeDoc('旧标题')
    const h = createHostWatcher({
      target, document: doc as never, MutationObserver: FakeMO as never,
      options: { debounceMs: 20, title: true }, onReport: (e) => reports.push(e),
    })
    assert(h!.info.title === true, '✓ title 项装配(MO + title 元素齐备)')
    doc.title = '新标题'
    FakeMO.last!.trigger()
    target.location.href = 'http://x/#/c'
    target.dispatch('hashchange')
    await tick(40)
    assert(reports.length === 1 && reports[0].kind === 'hash',
      `✓ 去抖合并:hash+title 连发只报一次且 url 类优先,实际 ${reports.length} 次 kind=${reports[0]?.kind}`)
    h!.dispose()
    assert(FakeMO.last !== null, '(MO 存活供后续用例)')
  }

  // ===== 3. ignore 过滤(不报案,水位照推进)=====
  {
    const reports: HostWatchEvent[] = []
    const target = fakeTarget()
    const h = createHostWatcher({
      target, options: { debounceMs: 0, ignore: (e) => e.kind === 'pop' }, onReport: (e) => reports.push(e),
    })
    target.location.href = 'http://x/#/d'
    target.dispatch('popstate')
    await tick()
    assert(reports.length === 0, '✓ ignore 命中 → 不报案')
    target.location.href = 'http://x/#/e'
    target.dispatch('hashchange')
    await tick()
    assert(reports.length === 1 && reports[0].kind === 'hash', '✓ ignore 未命中 → 正常报案')
    h!.dispose()
  }

  // ===== 4. pushState patch:链式保留 + dispose 还原 =====
  {
    const reports: HostWatchEvent[] = []
    const calls: unknown[][] = []
    const origPush = function (this: unknown, ...args: unknown[]): unknown { calls.push(args); return 'R' }
    const history: HostWatchHistory & Record<string, unknown> = { pushState: origPush as never }
    const target = fakeTarget()
    const h = createHostWatcher({
      target, history: history as never,
      options: { debounceMs: 0, url: false, pushState: true }, onReport: (e) => reports.push(e),
    })
    assert(h!.info.pushState === true && h!.info.url === false, '✓ pushState 项装配(url:false 显式关)')
    const ret = history.pushState({ p: 1 }, '', 'http://x/#/f')
    await tick()
    assert(ret === 'R' && calls.length === 1 && (calls[0] as unknown[])[0] !== undefined, '✓ patch 链式:原方法仍被调(参数透传)且返回值原样')
    // 注意:真浏览器里 pushState 会改 location;假 history 不会 → 先改 href 再调,模拟调用后的 URL 态
    target.location.href = 'http://x/#/f'
    void (history.pushState as (this: unknown, ...a: unknown[]) => unknown).call(history, { p: 1 }, '', 'http://x/#/f')
    await tick()
    assert(reports.length === 1 && reports[0].kind === 'push', `✓ pushState 调用 → 报案(kind=push),实际 ${reports.length} 次`)
    h!.dispose()
    assert(history.pushState === origPush, '✓ dispose 还原(pushState === 原函数)')
  }

  // ===== 5. 双实例 patch 错序卸载(A 先卸 B 后卸 → 终态 = 原函数,无死层)=====
  {
    const reportsA: HostWatchEvent[] = []
    const reportsB: HostWatchEvent[] = []
    const calls: number[] = []
    const origPush = function (this: unknown) { calls.push(1); return 0 }
    const history: HostWatchHistory & Record<string, unknown> = { pushState: origPush as never }
    const mk = (sink: HostWatchEvent[]) => createHostWatcher({
      target: fakeTarget(), history: history as never,
      options: { debounceMs: 0, url: false, pushState: true }, onReport: (e) => sink.push(e),
    })!
    const a = mk(reportsA)
    const b = mk(reportsB)
    a.dispose() // A 先卸:自己那层已被 B 覆盖 → 让位不还原
    const afterA = history.pushState as unknown as { callA?: boolean }
    assert(history.pushState !== origPush, '✓ 错序卸载:A 先卸时 B 的 patch 仍在顶(A 让位不误还原)')
    history.pushState.call(null)
    await tick()
    assert(calls.length === 1 && reportsA.length === 0 && reportsB.length === 0,
      '✓ A 已卸载后调用:原方法被调、A 零报案(死层退化为透传);B 在 URL 未变时也不误报')
    void afterA
    b.dispose()
    assert(history.pushState === origPush, '✓ B 后卸 → 还原到原函数(链收干净)')
  }

  // ===== 6. dispose 取消在途去抖(卸载后零报案)=====
  {
    const reports: HostWatchEvent[] = []
    const target = fakeTarget()
    const h = createHostWatcher({ target, options: { debounceMs: 20 }, onReport: (e) => reports.push(e) })
    target.location.href = 'http://x/#/g'
    target.dispatch('hashchange')
    h!.dispose() // 去抖窗口内卸载
    await tick(40)
    assert(reports.length === 0, '✓ dispose 取消在途去抖:卸载后不补报')
    // 卸载后监听已摘:再发事件零报案
    target.dispatch('hashchange')
    await tick()
    assert(reports.length === 0, '✓ 卸载后监听摘除:再发事件零报案')
  }

  // ===== 7. 依赖缺失逐项降级 / 全缺返回 null =====
  {
    const reports: HostWatchEvent[] = []
    // target 无 addEventListener(部分环境)→ url 不装;但 history 在 → pushState 可装
    const history: HostWatchHistory & Record<string, unknown> = { pushState: () => 0 }
    const h1 = createHostWatcher({
      target: { location: { href: 'http://x/' } }, history: history as never,
      options: { pushState: true }, onReport: (e) => reports.push(e),
    })
    assert(h1 !== null && h1.info.url === false && h1.info.pushState === true, '✓ 逐项降级:url 依赖缺失只关 url,pushState 照装')
    h1.dispose()
    const h2 = createHostWatcher({ options: { url: true }, onReport: (e) => reports.push(e) })
    assert(h2 === null, '✓ 全部依赖缺失 → 返回 null(装配层据此判未装配)')
  }

  // ===== 8. reason 生成 + 截断 =====
  {
    assert(buildHostWatchReason({ kind: 'hash', from: 'http://x/#/a', to: 'http://x/#/b' }) === '页面导航:http://x/#/a → http://x/#/b',
      '✓ reason:URL 类「页面导航:from → to」')
    assert(buildHostWatchReason({ kind: 'title', from: 'a', to: '新标题' }) === '页面标题已变更:新标题', '✓ reason:title 类「页面标题已变更:…」')
    const long = 'x'.repeat(200)
    const r = buildHostWatchReason({ kind: 'push', from: long, to: long })
    assert(r.length < 200 && r.includes('…'), `✓ reason 超长截断(实际 ${r.length} 字符)`)
  }
}
