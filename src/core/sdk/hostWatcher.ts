/**
 * hostWatch 声明式自动报案(auto-host-watch S1):监听宿主导航信号(URL/title),变化即转 notifyHostChange。
 *
 * 设计要点(见 openspec/changes/2026-09-19-auto-host-watch):
 *  - **依赖全注入,零模块级全局引用**(SSR import 安全;node 无 window 由装配层判,工厂本身可测)
 *  - **去抖合并**:路由切换常伴 hash+title 连发,窗口内(默认 300ms)合并为一次报案;url 类事件优先于 title
 *    (URL 是更精确的换页信号);同类取最新
 *  - **重复同值不报**:URL/title 各自与上次观察值比对,无变化不触发(倒计时类 title 噪声被去抖+比对双层消化)
 *  - **pushState patch 多层装卸安全**:dispose 仅在「自己那层还在顶上」时还原(`history.pushState === patched`),
 *    被后来者覆盖则让位;patch 体自查 disposed 标志 —— 已卸载的层退化为纯透传,杜绝错序还原出死 patch
 *  - **dispose 卫生**:摘监听/断 observer/还原 patch/取消在途去抖定时器,一样不落
 */

/** 自动报案事件(kind 与配置面一一对应;from/to 为观察值,超长由 reason 生成截断) */
export interface HostWatchEvent {
  kind: 'hash' | 'pop' | 'push' | 'title'
  from: string
  to: string
}

export interface HostWatcherTarget {
  addEventListener?: (type: string, listener: () => void) => void
  removeEventListener?: (type: string, listener: () => void) => void
  location?: { href?: string }
}

export interface HostWatchHistory {
  pushState?: (...args: unknown[]) => unknown
  replaceState?: (...args: unknown[]) => unknown
}

export interface HostWatchDocument {
  title?: string
  querySelector?: (selector: string) => unknown
}

export interface HostWatchOptions {
  /** 原生 hashchange + popstate(默认项,零 patch) */
  url?: boolean
  /** patch history.pushState/replaceState(hashless SPA 路由;opt-in) */
  pushState?: boolean
  /** 观察 document.title(不改 URL 的换文站;opt-in,噪声高) */
  title?: boolean
  /** 去抖窗口 ms(默认 300) */
  debounceMs?: number
  /** 宿主自定义忽略(如自家 #section 纯锚点);返回 true 不报案 */
  ignore?: (e: HostWatchEvent) => boolean
}

export interface HostWatcherHandle {
  /** 实际装配面(逐项特性探测后的结果;服务端缺 window → 全 false;装配层据此反射 inspect) */
  info: { url: boolean; pushState: boolean; title: boolean }
  dispose: () => void
}

const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…` : s)

/** reason 生成(纯函数,可单测):URL 类 `页面导航:from → to`;title 类 `页面标题已变更:…` */
export function buildHostWatchReason(e: HostWatchEvent): string {
  if (e.kind === 'title') return `页面标题已变更:${truncate(e.to, 60)}`
  return `页面导航:${truncate(e.from, 80)} → ${truncate(e.to, 80)}`
}

/** 事件优先级:去抖合并时 url 类(hash/pop/push)压过 title;同级取最新 */
function eventRank(e: HostWatchEvent): number {
  return e.kind === 'title' ? 0 : 1
}

/**
 * 装配 watcher。任一启用项的依赖缺失(target/history/document 缺位)→ 该项静默不装(整体仍可部分工作);
 * 全部依赖缺失返回 null(装配层据此判「未装配」)。
 */
export function createHostWatcher(deps: {
  target?: HostWatcherTarget
  history?: HostWatchHistory
  document?: HostWatchDocument
  MutationObserver?: new (cb: () => void) => { observe: (t: unknown, o: unknown) => void; disconnect: () => void }
  options?: HostWatchOptions
  onReport: (e: HostWatchEvent) => void
}): HostWatcherHandle | null {
  const { target, history, document: doc, MutationObserver: MO, onReport } = deps
  const opts = deps.options ?? {}
  const debounceMs = Math.max(0, opts.debounceMs ?? 300)

  const readUrl = (): string => String(target?.location?.href ?? '')
  const readTitle = (): string => String(doc?.title ?? '')

  let disposed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: HostWatchEvent | null = null
  const cleanupFns: Array<() => void> = []
  /** 观察值水位(去重比对;ignore 只滤报案不拦水位推进,防同值反复重报) */
  let lastUrl = readUrl()
  let lastTitle = readTitle()

  const onUrlChange = (kind: HostWatchEvent['kind']): void => {
    if (disposed) return
    const to = readUrl()
    if (to === lastUrl) return
    const e: HostWatchEvent = { kind, from: lastUrl, to }
    lastUrl = to
    schedule(e)
  }
  const onTitleChange = (): void => {
    if (disposed) return
    const to = readTitle()
    if (to === lastTitle) return
    const e: HostWatchEvent = { kind: 'title', from: lastTitle, to }
    lastTitle = to
    schedule(e)
  }

  /** 去抖:窗口内多事件合并(url 类优先,同级取最新);窗口到点后 ignore 过滤再报案 */
  const schedule = (e: HostWatchEvent): void => {
    pending = pending && eventRank(pending) >= eventRank(e) ? pending : e
    if (timer !== null) return
    timer = setTimeout(() => {
      timer = null
      const out = pending
      pending = null
      if (disposed || !out) return
      if (opts.ignore?.(out) === true) return
      onReport(out)
    }, debounceMs)
  }

  // url:原生 hashchange + popstate(零 patch)
  let installedUrl = false
  if (opts.url !== false && target?.addEventListener) {
    const hash = () => onUrlChange('hash')
    const pop = () => onUrlChange('pop')
    target.addEventListener('hashchange', hash)
    target.addEventListener('popstate', pop)
    installedUrl = true
    cleanupFns.push(() => {
      target.removeEventListener?.('hashchange', hash)
      target.removeEventListener?.('popstate', pop)
    })
  }

  // pushState:patch(链式保留;dispose 守卫「自己那层还在顶上」才还原)。
  // 多实例同 patch 时形成链(A 包原函数,B 包 A)—— **链根追踪**:patch 标记携带 rootOrig(若当前顶上已是
  // 本工厂的 patch 则继承其链根,否则以当前函数为根)。还原时回到链根而非「自己保存的上一层」——
  // 修「A 先卸 → B 后卸还原出 A 的死层」(死层虽已退化为透传,但会永久残留在 history 上)。
  // 第三方 patch 在我们之上:不在顶 → 让位不还原(从下层抽走不安全);已卸层透传(见 disposed 自查)
  let installedPush = false
  if (opts.pushState === true && history && typeof history.pushState === 'function') {
    type Patched = ((this: unknown, ...args: unknown[]) => unknown) & { __pgHostWatchRoot?: unknown }
    const prevPush = history.pushState as Patched
    const rootPush = prevPush.__pgHostWatchRoot !== undefined ? prevPush.__pgHostWatchRoot : prevPush
    const prevReplace = history.replaceState as Patched | undefined
    const rootReplace = prevReplace
      ? (prevReplace.__pgHostWatchRoot !== undefined ? prevReplace.__pgHostWatchRoot : prevReplace)
      : undefined
    const patchedPush = function patchedPush(this: unknown, ...args: unknown[]): unknown {
      const fn = (rootPush as (...a: unknown[]) => unknown)
      const r = fn.apply(this, args)
      if (!disposed) onUrlChange('push')
      return r
    }
    ;(patchedPush as Patched).__pgHostWatchRoot = rootPush
    let patchedReplace: Patched | undefined
    if (prevReplace && rootReplace) {
      patchedReplace = function patchedReplace(this: unknown, ...args: unknown[]): unknown {
        const r = (rootReplace as (...a: unknown[]) => unknown).apply(this, args)
        if (!disposed) onUrlChange('push')
        return r
      }
      patchedReplace.__pgHostWatchRoot = rootReplace
      history.replaceState = patchedReplace
    }
    history.pushState = patchedPush
    installedPush = true
    cleanupFns.push(() => {
      // 还原到链根(直接回到链最底的原函数;中间已卸层本来已透传,一并出链)
      if (history.pushState === patchedPush) history.pushState = rootPush as HostWatchHistory['pushState']
      if (patchedReplace && history.replaceState === patchedReplace) history.replaceState = rootReplace as HostWatchHistory['replaceState']
    })
  }

  // title:MutationObserver 观察 title 元素(characterData + childList;无 title 元素/MO 缺位则不装)
  let installedTitle = false
  let observer: { observe: (t: unknown, o: unknown) => void; disconnect: () => void } | null = null
  if (opts.title === true && doc?.querySelector && MO) {
    const titleEl = doc.querySelector('head title') ?? doc.querySelector('title')
    if (titleEl) {
      observer = new MO(() => onTitleChange())
      observer.observe(titleEl, { childList: true, characterData: true, subtree: true })
      installedTitle = true
    }
  }

  const installedAny = installedUrl || installedPush || installedTitle
  if (!installedAny) return null
  return {
    info: { url: installedUrl, pushState: installedPush, title: installedTitle },
    dispose: () => {
      if (disposed) return
      disposed = true
      if (timer !== null) clearTimeout(timer) // 在途去抖:卸载后不得再报案
      timer = null
      pending = null
      observer?.disconnect()
      for (const fn of cleanupFns) fn()
    },
  }
}
