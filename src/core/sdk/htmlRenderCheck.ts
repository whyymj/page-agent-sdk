/**
 * 渲染级自检(render-check,2026-08-24)—— 纯 H5 从「生成」到「开发」的质量闭环
 *
 * 结构校验(formatCheck)只验标签闭合;「白屏 / script 运行时错 / 资源加载失败」此前靠人眼。
 * SDK 本就跑在浏览器:把本轮触达的 code 资产放进沙箱 iframe 独立渲染,采集运行时信号回灌自纠。
 *
 * 形态(评审钉死):**仅门禁** —— 组合进 createHtmlSubagent 的单一 VerifyCheck(结构不过短路渲染),
 * 不给子 agent 渲染工具(3-5s/次检查不交 LLM 自决,防与门禁双轨烧轮次)。
 *
 * 安全:srcdoc + sandbox="allow-scripts" 三无(无 same-origin / forms / top-navigation);
 * 父侧校验 per-check nonce + event.source(opaque origin 下 event.origin==='null',不能只信 origin)。
 *
 * 降级三态(诚实,防假绿):①node/无 DOM → 跳渲染段保留结构段(node e2e 硬前提);
 * ②握手缺失(宿主 CSP 拦 srcdoc 继承的内联脚本)→ 「检查不可用」不算通过;
 * ③收集窗超时 → 原因返回。零信号 ≠ 通过。
 *
 * 残余(文档明示):异步晚到错误可能漏报(活动静默启发式 + 硬上限);沙箱 ≠ 宿主环境
 * (字体/宿主 CSS/网关;结论是「能否独立跑」非「长啥样」);storage 类 SecurityError 降 warn 不计失败。
 */
import type { VfsFile } from '../harness/state'
import type { HarnessState } from '../harness/state'
import type { VerifyCheck, VerifyCheckResult } from '../harness/verify'
import { getByPath } from '../tools/jsonUtils'

// ===== 类型 =====

/** 沙箱采集到的原始信号(collector postMessage 上报;归一前) */
export interface RenderSignal {
  type: 'console-error' | 'console-warn' | 'js-error' | 'unhandledrejection' | 'resource-error' | 'csp-violation'
  message: string
  /** 资源失败:url;js-error:文件名 */
  source?: string
  lineno?: number
}

/** 渲染指标(收集窗结束时机采集;白屏判定口径 = 内容级) */
export interface RenderMetrics {
  bodyChildren: number
  scrollHeight: number
  imgCount: number
}

/** 单组件沙箱渲染的原始结果(未归一) */
export interface RawRenderResult {
  /** collector 加载握手是否到达(CSP 拦内联脚本/加载失败 → false) */
  handshake: boolean
  signals: RenderSignal[]
  metrics?: RenderMetrics
  /** 硬上限到达仍未握手/未静默 */
  timedOut?: boolean
  /** node/无 DOM 环境标记(runner 直接返回,不建 iframe) */
  noDom?: boolean
}

/** 归一后的单组件判定 */
export interface RenderVerdict {
  /** pass 通过 / fail 有失败信号 / unavailable 检查不可用(握手缺失/超时;不算通过防假绿) */
  verdict: 'pass' | 'fail' | 'unavailable'
  /** fail 的具体问题(带修复指引素材) */
  problems: string[]
  /** 非致命观察(console-warn / storage 沙箱假阳性 / CSP 拦截说明) */
  warnings: string[]
  metrics?: RenderMetrics
  reason?: 'handshake-missing' | 'timeout'
}

/** storage 类沙箱假阳性:opaque origin 下 localStorage/sessionStorage/document.cookie 访问抛 SecurityError */
const STORAGE_ERR_RE = /SecurityError|localStorage|sessionStorage|document\.cookie|Access is denied for this document/i

/**
 * 信号归一(纯函数,node 可测):原始信号 + 指标 → 三态判定。
 * - js-error / console-error / unhandledrejection / resource-error → fail
 * - console-warn → warning 不计失败;storage 类错误降 warn(沙箱假阳性治理)
 * - csp-violation → warning(宿主 CSP 拦外链/内联,沙箱结论受限;若连 collector 都被拦 → runner 层 handshake=false 走 unavailable)
 * - 白屏启发式:无失败信号但 bodyChildren===0 且 scrollHeight<10 → fail「疑似白屏」(script 挂了渲染中断的常见形态)
 */
export function normalizeRenderResult(raw: RawRenderResult): RenderVerdict {
  if (raw.noDom) return { verdict: 'pass', problems: [], warnings: [] } // node 守卫在 check 层跳过,runner 层兜底
  if (!raw.handshake) return { verdict: 'unavailable', problems: [], warnings: [], reason: 'handshake-missing' }
  if (raw.timedOut && !raw.signals.length && !raw.metrics) {
    return { verdict: 'unavailable', problems: [], warnings: [], reason: 'timeout' }
  }
  const problems: string[] = []
  const warnings: string[] = []
  for (const s of raw.signals) {
    const loc = s.lineno !== undefined ? `(第 ${s.lineno} 行)` : ''
    switch (s.type) {
      case 'js-error':
        if (STORAGE_ERR_RE.test(s.message)) {
          warnings.push(`storage 类错误降级为观察(沙箱 opaque origin 访问 localStorage/cookie 抛 SecurityError,非代码缺陷):${s.message}${loc}`)
        } else {
          problems.push(`JS 运行时错误:${s.message}${loc}${s.source ? ` [${s.source}]` : ''}`)
        }
        break
      case 'console-error': {
        if (STORAGE_ERR_RE.test(s.message)) {
          warnings.push(`console.error(storage 类,沙箱假阳性降观察):${s.message}`)
        } else {
          problems.push(`console.error:${s.message}`)
        }
        break
      }
      case 'unhandledrejection':
        problems.push(`未捕获的异步 Promise 拒绝(unhandledrejection):${s.message}`)
        break
      case 'resource-error':
        problems.push(`资源加载失败:${s.source || s.message}(网络 404 / 跨源被拦 / URL 拼写)`)
        break
      case 'console-warn':
        warnings.push(`console.warn:${s.message}`)
        break
      case 'csp-violation':
        warnings.push(`宿主 CSP 拦截(${s.message};沙箱继承宿主 CSP,外链/内联资源被拦不判为组件缺陷)`)
        break
    }
  }
  // 白屏启发式(内容级单口径 scrollHeight:覆盖 body 空 / display:none / 渲染中断形态;
  // 有失败信号时指标只作定位补充不重复报)。body 默认 margin ≈16px,阈值 10 放过真空文档
  if (!problems.length && raw.metrics && raw.metrics.scrollHeight < 10) {
    problems.push(`疑似白屏:scrollHeight ${raw.metrics.scrollHeight}(body 子节点 ${raw.metrics.bodyChildren};渲染中断 / 内容被隐藏 / script 阻塞了 body 构建)`)
  }
  return {
    verdict: problems.length ? 'fail' : 'pass',
    problems,
    warnings,
    metrics: raw.metrics,
  }
}

// ===== collector(注入 srcdoc 的采集脚本;字符串形态,零依赖) =====

/**
 * 构造 collector 脚本源码(纯函数便于测试断言):置于文档最前(head 开头/文档开头),
 * 保证组件脚本执行前已挂钩 console/error/unhandledrejection。
 * 协议:postMessage({ __pgRender:1, nonce, type, data }) → 父侧按 nonce+source 过滤;
 * 父侧下发 { __pgCollect:1, nonce } → 回 metrics(收集窗结束时采集,口径为准)。
 */
export function buildCollectorJs(nonce: string): string {
  return [
    '(function(){',
    `var N=${JSON.stringify(nonce)};`,
    'var post=function(t,d){try{parent.postMessage({__pgRender:1,nonce:N,type:t,data:d||{}},"*")}catch(e){}};',
    'var fmt=function(x){if(typeof x==="string")return x;try{return JSON.stringify(x)}catch(e){return String(x)}};',
    // 加载即握手(短窗无握手 = 检查不可用,防假绿)
    'post("handshake",{});',
    // console.error/warn 劫持(保留原行为;首条+可得的行号由 error 钩子补充)
    'var ce=console.error.bind(console);console.error=function(){try{post("console-error",{message:Array.prototype.map.call(arguments,fmt).join(" ").slice(0,400)})}catch(e){}ce.apply(console,arguments)};',
    'var cw=console.warn.bind(console);console.warn=function(){try{post("console-warn",{message:Array.prototype.map.call(arguments,fmt).join(" ").slice(0,300)})}catch(e){}cw.apply(console,arguments)};',
    // js-error(普通)+ resource-error(捕获相:img/script/link 加载失败不走 window.onerror)
    'window.addEventListener("error",function(e){',
    '  var t=e.target&&e.target!==window&&e.target.tagName;',
    '  if(t==="IMG"||t==="SCRIPT"||t==="LINK"){post("resource-error",{message:t,source:String(e.target.src||e.target.href||"")})}',
    '  else{post("js-error",{message:String(e.message||"unknown"),source:e.filename?String(e.filename):undefined,lineno:e.lineno||undefined})}',
    '},true);',
    // 异步 reject + CSP 违规(降观察)
    'window.addEventListener("unhandledrejection",function(e){var r=e.reason;post("unhandledrejection",{message:r&&(r.message||fmt(r))||"unknown"})});',
    'document.addEventListener("securitypolicyviolation",function(e){post("csp-violation",{message:(e.violatedDirective||e.directive||"")+": "+(e.blockedURI||"")})});',
    // 活动信号(资源条目 + DOM 变动 + load):父侧据此重置静默计时
    'var act=function(){post("activity",{})};',
    'try{new PerformanceObserver(function(){act()}).observe({entryTypes:["resource"]})}catch(e){}',
    'window.addEventListener("load",act);',
    'try{new MutationObserver(act).observe(document.documentElement,{childList:true,subtree:true})}catch(e){}',
    // 父侧收集指令 → 回指标(内容级口径:body 子节点/scrollHeight/图片数)
    'window.addEventListener("message",function(e){var d=e.data;if(!d||d.__pgCollect!==1||d.nonce!==N)return;',
    '  var b=document.body;',
    // scrollHeight 取 body(内容级):documentElement 是滚动元素,scrollHeight 恒 ≥ 视口高(iframe 600px),白屏永远测不出来
    '  post("metrics",{bodyChildren:b?b.children.length:0,scrollHeight:b?b.scrollHeight:0,imgCount:document.images?document.images.length:0});',
    '});',
    '})();',
  ].join('\n')
}

/**
 * 构造沙箱 srcdoc(纯函数):collector 注入到组件文档最前(head 开头优先,退化到文档开头 —— 片段形态浏览器自建 head)。
 * 只注入不改动组件原文(归因保真)。
 */
export function buildSandboxSrcdoc(html: string, nonce: string): string {
  const tag = `<script>${buildCollectorJs(nonce)}<\/script>`
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + tag)
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + tag)
  return tag + html
}

// ===== 沙箱运行器(浏览器;node 由调用方守卫) =====

/**
 * 真浏览器环境判定:node 无 DOM 或 e2e/SSR 桩 document(只挂 addEventListener 等,无 createElement/body)
 * 都不是可渲染环境 —— 只看 typeof document === 'undefined' 会被桩穿透(node e2e 实测崩在 iframe.remove)。
 */
export function hasRealDom(): boolean {
  return typeof document !== 'undefined'
    && typeof document.createElement === 'function'
    && typeof document.body !== 'undefined' && document.body !== null
}

export interface SandboxRunOptions {
  /** 活动静默窗:最后一条 activity/信号后静默该时长即收集(默认 900ms) */
  silenceMs?: number
  /** 硬上限(默认 4000ms;超时仍无握手 → unavailable) */
  hardCapMs?: number
  /** metrics 应答宽限(默认 500ms;无应答按已有信号判定,指标缺失计 warning) */
  metricsGraceMs?: number
}

/** 累计创建/销毁的沙箱 iframe 数(测试观察用:用后销毁契约) */
const sandboxLifecycle = { created: 0, destroyed: 0 }
export function getSandboxLifecycle(): { created: number; destroyed: number } {
  return { ...sandboxLifecycle }
}

/**
 * 单组件沙箱渲染(离屏 iframe + srcdoc + sandbox="allow-scripts"):
 * 创建 → 等握手/信号(活动静默启发式)→ 下发收集指令收指标 → 销毁 → 返回原始结果。
 * 事件过滤:nonce + event.source === iframe.contentWindow(opaque origin 不信 event.origin)。
 */
export function renderInSandbox(html: string, opts: SandboxRunOptions = {}): Promise<RawRenderResult> {
  const silenceMs = opts.silenceMs ?? 900
  const hardCapMs = opts.hardCapMs ?? 4000
  const metricsGraceMs = opts.metricsGraceMs ?? 500
  if (!hasRealDom()) {
    return Promise.resolve({ handshake: false, signals: [], noDom: true })
  }
  const nonce = `pg_rc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  return new Promise<RawRenderResult>((resolve) => {
    const signals: RenderSignal[] = []
    let handshake = false
    let metrics: RenderMetrics | undefined
    let iframe: HTMLIFrameElement | undefined
    let onMsg: ((ev: MessageEvent) => void) | undefined
    let silenceTimer: ReturnType<typeof setTimeout> | undefined
    let hardCapTimer: ReturnType<typeof setTimeout> | undefined
    let metricsTimer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    sandboxLifecycle.created++
    const cleanup = () => {
      if (settled) return
      settled = true
      if (onMsg) window.removeEventListener('message', onMsg)
      if (silenceTimer) clearTimeout(silenceTimer)
      if (hardCapTimer) clearTimeout(hardCapTimer)
      if (metricsTimer) clearTimeout(metricsTimer)
      if (iframe) {
        iframe.remove()
        sandboxLifecycle.destroyed++
      }
    }
    const finish = (timedOut = false) => {
      cleanup()
      resolve({ handshake, signals, metrics, ...(timedOut ? { timedOut: true } : {}) })
    }
    const armSilence = () => {
      if (silenceTimer) clearTimeout(silenceTimer)
      silenceTimer = setTimeout(() => {
        // 静默达窗:向 iframe 下发收集指令(内容级指标以结束时点为准)
        try {
          iframe?.contentWindow?.postMessage({ __pgCollect: 1, nonce }, '*')
        } catch { /* iframe 已死 → 按 timeout 兜底 */ }
        metricsTimer = setTimeout(() => finish(), metricsGraceMs)
      }, silenceMs)
    }
    onMsg = (ev: MessageEvent) => {
      const d = ev.data as { __pgRender?: number; nonce?: string; type?: string; data?: Record<string, unknown> } | null
      if (!d || d.__pgRender !== 1 || d.nonce !== nonce) return
      if (iframe && ev.source !== iframe.contentWindow) return
      const type = d.type as string
      if (type === 'handshake') {
        handshake = true
        armSilence()
        return
      }
      if (type === 'metrics') {
        const m = d.data as Partial<RenderMetrics> | undefined
        if (m && typeof m.bodyChildren === 'number') metrics = { bodyChildren: m.bodyChildren, scrollHeight: m.scrollHeight ?? 0, imgCount: m.imgCount ?? 0 }
        finish()
        return
      }
      if (type === 'activity') {
        if (handshake) armSilence()
        return
      }
      // 信号类
      const data = d.data || {}
      signals.push({
        type: type as RenderSignal['type'],
        message: String(data.message ?? ''),
        ...(data.source !== undefined ? { source: String(data.source) } : {}),
        ...(typeof data.lineno === 'number' ? { lineno: data.lineno } : {}),
      })
      if (handshake) armSilence() // 信号也是活动,重置静默
    }
    window.addEventListener('message', onMsg)
    hardCapTimer = setTimeout(() => finish(true), hardCapMs) // 硬上限兜底(空转帧/慢网络)
    // 离屏定位:display:none 布局度量失真不可用;visibility:hidden 保留布局
    iframe = document.createElement('iframe')
    iframe.setAttribute('sandbox', 'allow-scripts') // 三无:无 same-origin / forms / top-navigation
    iframe.setAttribute('aria-hidden', 'true')
    iframe.setAttribute('tabindex', '-1')
    iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:1024px;height:600px;visibility:hidden;border:0;opacity:0;pointer-events:none;'
    iframe.srcdoc = buildSandboxSrcdoc(html, nonce)
    document.body.appendChild(iframe)
  })
}

// ===== 门禁形态的 VerifyCheck(组合进 createHtmlSubagent 的 formatCheck 链) =====

export interface HtmlRenderCheckOptions {
  /** vfs 代码路径前缀(默认 'html/',与 createHtmlSubagent 的 codeVfsPrefix 一致) */
  vfsPrefix?: string
  /** 代码字段(默认 'code';嵌套如 'props.html_code' 由调用方传) */
  codeField?: string
  /** 代码组件 data 区(装配期推断回填后经 setWritablePaths 更新) */
  writablePaths?: string[]
  /** 运行器注入(selftest 桩用;缺省真沙箱) */
  runner?: (html: string) => Promise<RawRenderResult>
  /** 单轮检查面防御上限(默认 4;touched+新建天然 ≤2,超限截断并留痕) */
  maxTargets?: number
}

export interface HtmlRenderCheck {
  check: VerifyCheck
  /** createChatSdk 装配期注入同源 dataOpsController(_setGetController 通道,同 validate_code 先例) */
  setGetController: (g: () => { get?: () => { bind?: unknown } | null | undefined } | null | undefined) => void
  /** 装配期 writablePaths 推断回填(_rebuildCodeAssetPaths 同步调用) */
  setWritablePaths: (paths: string[]) => void
}

/**
 * 创建渲染自检 VerifyCheck(与结构校验组合为单一 check:结构不过短路渲染)。
 * 检查面 = 本轮触达(`state.__pgTouched` vfs 路径)+ 本轮 write 新建(vfs 缺位的 bind code 组件
 * —— 新建走 write 不经 vfs,checkout 下次委派才发生,消息流/绑定差集双口径中选绑定差集更稳)。
 * node/无 DOM → 跳过渲染段保留结构段(observable 留痕);握手缺失/超时 → unavailable 不算通过(防假绿)。
 */
export function createHtmlRenderCheck(opts: HtmlRenderCheckOptions = {}): HtmlRenderCheck {
  const prefix = opts.vfsPrefix ?? 'html/'
  const codeField = opts.codeField ?? 'code'
  const maxTargets = opts.maxTargets ?? 4
  // runner 注入(测试桩/高级集成自管渲染)时由 runner 决定环境;真沙箱路径才吃 node 守卫
  const injected = typeof opts.runner === 'function'
  const run = opts.runner ?? ((html: string) => renderInSandbox(html))
  let getController: (() => { get?: () => { bind?: unknown } | null | undefined } | null | undefined) | undefined
  let writablePaths = opts.writablePaths ?? []

  const check: VerifyCheck = async ({ state, log }): Promise<VerifyCheckResult> => {
    // node/无 DOM(含桩 document)强制降级:跳渲染段保结构段 + observable 留痕(node e2e 命中 formatCheck 门禁链的硬前提)
    if (!injected && !hasRealDom()) {
      log?.('middleware', { stage: 'render_check_skip', reason: 'no-dom' })
      return { ok: true }
    }
    const st = state as unknown as HarnessState & Record<string, unknown>
    const files = (st.files ?? {}) as Record<string, VfsFile>
    const touched = (st.__pgTouched as Set<string> | undefined) ?? new Set<string>()
    // 组装检查面:touched vfs 文件(工作副本为准)+ vfs 缺位的 bind code 组件(write 新建)
    const targets: Array<{ label: string; html: string }> = []
    for (const p of touched) {
      if (!p.startsWith(prefix)) continue
      const f = files[p]
      if (f && typeof f.content === 'string') targets.push({ label: p, html: f.content })
    }
    const bind = getController?.()?.get?.()?.bind
    if (bind && writablePaths.length) {
      for (const wp of writablePaths) {
        const arr = getByPath(bind, wp)
        if (!Array.isArray(arr)) continue
        for (let i = 0; i < arr.length; i++) {
          const item = arr[i] as Record<string, unknown> | null
          if (!item || typeof item !== 'object') continue
          const pgId = item.__pgId
          const code = getByPath(item, codeField)
          if (typeof pgId !== 'string' || typeof code !== 'string') continue
          const vfsPath = `${prefix}${pgId}.html`
          if (files[vfsPath]) continue // 已在 vfs(checkout 过)→ touched 口径覆盖,不重复
          targets.push({ label: `${wp}.${i}(write 新建,vfs 未检出)`, html: code })
        }
      }
    }
    if (!targets.length) return { ok: true }
    const truncated = targets.length > maxTargets
    const checked = truncated ? targets.slice(0, maxTargets) : targets
    if (truncated) log?.('middleware', { stage: 'render_check_truncated', total: targets.length, checked: maxTargets })
    const problems: string[] = []
    const warnings: string[] = []
    const unavailable: string[] = []
    for (const t of checked) {
      const v = normalizeRenderResult(await run(t.html))
      for (const p of v.problems) problems.push(`${t.label}:${p}`)
      for (const w of v.warnings) warnings.push(`${t.label}:${w}`)
      if (v.verdict === 'unavailable') unavailable.push(t.label)
      log?.('middleware', { stage: 'render_check_component', target: t.label, verdict: v.verdict, problems: v.problems.length, warnings: v.warnings.length })
    }
    if (problems.length) {
      return {
        ok: false,
        feedback: [
          `渲染自检未通过(沙箱 iframe 独立渲染,信号归因到组件):`,
          ...problems.map((p) => `- ${p}`),
          ...(warnings.length ? ['', '观察(不阻断):', ...warnings.map((w) => `- ${w}`)] : []),
          '',
          '请修复后(用 vfs_edit 改代码)再收口;修复方向:定位报错行修正 script / 换资源源或删失效引用 / 检查 script 是否阻塞渲染。',
        ].join('\n'),
      }
    }
    if (unavailable.length) {
      // 零信号 ≠ 通过:握手缺失/超时 → 诚实返回「检查不可用」,让 agent 用 validate_code 兜底并在收口如实说明
      return {
        ok: false,
        feedback: `渲染检查不可用(${unavailable.join(', ')}:沙箱 collector 握手缺失或收集超时 —— 宿主 CSP 可能拦截沙箱内联脚本)。请:①调 validate_code 复核结构;②在最终回复中如实写明「渲染检查未能执行(环境限制)」,勿声称已通过渲染验证。`,
      }
    }
    if (warnings.length) log?.('middleware', { stage: 'render_check_pass_with_warnings', warnings: warnings.length })
    return { ok: true }
  }
  return {
    check,
    setGetController: (g) => { getController = g },
    setWritablePaths: (paths) => { writablePaths = paths },
  }
}

/**
 * 组合「结构 → 渲染」为单一 VerifyCheck(结构不过短路渲染;runBeforeReturn 不短路,
 * 两段必须在一个 check 内早返回,不加第二个 verify 中间件)。
 */
export function composeStructureThenRender(structure: VerifyCheck, render: VerifyCheck): VerifyCheck {
  return async (ctx) => {
    const r = await structure(ctx)
    if (!r.ok) return r
    return render(ctx)
  }
}
