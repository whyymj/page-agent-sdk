/**
 * bulk-change-guard 中间件 —— 大批量变更门禁(注入/跑偏的最后防线,缓解非根治)
 *
 * 机制化信号不是「意图」而是「规模」:单次写调用触达的**现有组件节点数**超阈 → 挂 approval
 * 让用户确认(正常大操作也给一次点头机会,不逼 agent 拆碎写)。
 *
 * 量纲(评审核心修正):「op 条数」≠「破坏面」—— 同组件 8 条 patch 是正常微调不拦;
 * 现有组件节点数 = distinct 组件级路径首段(参照 componentLock.extractWriteScopes 口径),
 * 新增内容不计破坏面(append 的新元素/set 到不存在路径的新内容)。执行前读 bind 实时统计。
 *
 * 装配规则(硬性,防 headless 挂死 —— 评审 3-1):
 *  - 未配置 approval → 中间件整体 no-op(不假设「无响应方检测」,该机制不存在)
 *  - 挂起自带 timeoutMs(默认 30s 超时自动拒)—— 不依赖 send/batch 的 approvalWatch
 *    (sdk.stream 路径无任何 approval watch;approval_request 不外发 → 无界等待必挂死)
 *  - mode:'observe' 无人值守档:超阈只留痕不挂起(类比 conflictPolicy overwrite 防永挂)
 *
 * 豁免:
 *  - lastPlanConfirmation(save-and-plan-gates 3c 结构化留痕,仅带 options 方案确认)存在 → 豁免
 *  - dryRun 不拦(只读预检)
 *  - 每会话每类操作只拦一次(用户确认后该类放行,防反复弹窗);switch/reset 清除(reset 钩子)
 *  - 子 agent 不装(装配期只装主栈,与 componentWriteGuard 同)
 *
 * 定位:缓解非根治(授权范围内的恶意与正常在原理上不可区分,见 proposal D4);
 * 提高攻击成本(需要用户点确认),不承诺防住「诱导用户点确认」的社会工程面。
 */
import type { Middleware, ToolCallContext, ToolExecResult } from './middleware'
import { getByPath } from '../tools/jsonUtils'

/** bulkGuard 配置(顶层 options.bulkGuard) */
export interface BulkGuardOptions {
  /** 现有组件节点数阈值,默认 4(editor 实测正常局部 1-3;保守起步真 LLM 校准) */
  threshold?: number
  /** 挂起自带超时(ms,默认 30s;超时自动拒。不依赖 send/batch 的 approvalWatch —— stream 路径无兜底) */
  timeoutMs?: number
  /** confirm(默认,超阈挂 approval)/ observe(无人值守:只留痕不挂起,类比 conflictPolicy overwrite 防永挂) */
  mode?: 'confirm' | 'observe'
}

/** 规模度量结果 */
export interface WriteScaleResult {
  /** 触达的现有组件节点数(执行前 bind 实测;新增内容不计) */
  count: number
  /** 组件级路径首段去重(报告用) */
  scopes: string[]
  /** 写形态分类 */
  kind: 'patches' | 'del' | 'subtree-set' | 'whole-set' | 'other'
}

/**
 * 度量单次写调用触达的现有组件节点数(纯函数,可单测):
 * - write({patches[]}) / write({patch}):distinct 组件级路径首段(components.N → components.N;
 *   同组件 8 条 patch = 1);后段路径截到「数组索引」层(组件粒度)
 * - write({del:true, patch:{jsonPath}}):同口径
 * - write({value})(整体 set,merge 语义触碰全部):现有组件节点总数(全量白名单模式按顶层声明数组计)
 * 新增内容不计破坏面:路径在 bind 不存在(append 到数组/新键 set)→ 不计。
 */
export function measureWriteScale(args: unknown, getBind: () => unknown): WriteScaleResult {
  const a = (args ?? {}) as Record<string, any>
  const bind = getBind()
  const seg = (p: string): string => {
    // 组件级路径首段:到第二个数组索引或第一个字段(如 components.5.props.x → components.5;
    // components.5 → components.5;title → title)。无索引的顶层 key 原样。
    const parts = p.split('.')
    const out: string[] = []
    let idxSeen = 0
    for (const s of parts) {
      out.push(s)
      if (/^\d+$/.test(s)) {
        idxSeen++
        if (idxSeen >= 1) break  // 首个数组索引即组件粒度边界(editor: components.N)
      }
    }
    return out.join('.')
  }
  const paths: string[] = []
  let kind: WriteScaleResult['kind'] = 'other'
  if (a.dryRun === true) return { count: 0, scopes: [], kind: 'other' }  // 只读预检不度量(豁免在中间件,这里也短路)
  if (a.del === true) {
    kind = 'del'
    if (typeof a.patch?.jsonPath === 'string' && a.patch.jsonPath) paths.push(a.patch.jsonPath)
  } else if (Array.isArray(a.patches)) {
    kind = 'patches'
    for (const p of a.patches) { if (p && typeof p.jsonPath === 'string' && p.jsonPath) paths.push(p.jsonPath) }
  } else if (a.patch && typeof a.patch.jsonPath === 'string' && a.patch.jsonPath) {
    kind = 'subtree-set'
    paths.push(a.patch.jsonPath)
  } else if (a.value !== undefined) {
    // 整体 set(merge 语义触碰全部现有组件):按 bind 顶层组件数组实测计数
    kind = 'whole-set'
    if (bind && typeof bind === 'object') {
      const scopeSet = new Set<string>()
      let total = 0
      for (const k of Object.keys(bind)) {
        const v = (bind as Record<string, unknown>)[k]
        if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object')) {
          total += v.length
          scopeSet.add(k)
        }
      }
      return { count: total, scopes: [...scopeSet], kind }
    }
    return { count: 0, scopes: [], kind }
  } else {
    return { count: 0, scopes: [], kind }
  }
  // distinct 组件级首段 + 「现有」过滤(新增路径 bind 不存在 → 不计破坏面)
  const scopeSet = new Set<string>()
  for (const p of paths) {
    const head = seg(p)
    // head 在 bind 上可解析且非 undefined → 现有节点;undefined → 新增内容不计
    if (getByPath(bind, head) !== undefined) scopeSet.add(head)
  }
  return { count: scopeSet.size, scopes: [...scopeSet], kind }
}

/** 中间件工厂参数 */
export interface BulkGuardMiddlewareOptions extends BulkGuardOptions {
  /** 取当前主数据 bind(实时统计现有节点) */
  getBind: () => unknown
  /** 全部工具列表(按 writeCapable 标注判定写能力,单一真相源) */
  tools?: unknown[]
  /** 方案确认留痕 getter(save-and-plan-gates 3c;存在 → 豁免) */
  getPlanConfirmation?: () => { at: number; summary: string } | undefined
  /** 留痕(触发/豁免/超时,经 debugLogs) */
  onEvent?: (info: { stage: 'bulk_guard'; decision: 'confirm' | 'observe' | 'exempt-plan' | 'exempt-once' | 'pass' | 'timeout' | 'rejected'; kind: string; count: number }) => void
}

/** 会话级豁免态:每类操作用户确认过一次 → 该类本会话放行(reset 钩子清除) */
export interface BulkGuardState {
  /** 已确认放行的写形态集合 */
  confirmedKinds: Set<string>
  /** 中间件 reset 钩子(switchSession/resetSession 调) */
  reset(): void
}

/**
 * 创建 bulk-change-guard 中间件。挂起经 ctx.emit approval_request(与 approval/humanConfirm
 * 中间件同通道 —— 流内转发到 UI/集成方 handler;**勿用 core 外发 emit,该通道吞 approval_request**);
 * 挂起**自带超时**(默认 30s 超时自动拒)—— 不依赖 send/batch 的 approvalWatch(stream 路径无兜底)。
 */
export function createBulkGuardMiddleware(opts: BulkGuardMiddlewareOptions): Middleware & { state: BulkGuardState } {
  const threshold = opts.threshold ?? 4
  const timeoutMs = opts.timeoutMs ?? 30_000
  const mode = opts.mode ?? 'confirm'
  const confirmedKinds = new Set<string>()
  const log = (decision: NonNullable<Parameters<NonNullable<BulkGuardMiddlewareOptions['onEvent']>>[0]>['decision'], kind: string, count: number) =>
    opts.onEvent?.({ stage: 'bulk_guard', decision, kind, count })

  const mw: Middleware = {
    name: 'bulk-guard',
    wrapToolCall: async (ctx: ToolCallContext, next: (ctx: ToolCallContext) => Promise<ToolExecResult>) => {
      // writeCapable 标注判定(单一真相源;条件写函数形态由标注自身处理)
      const tool = (opts.tools ?? []).find((t) => (t as { name?: string }).name === ctx.name) as { writeCapable?: boolean | ((args: Record<string, unknown>) => boolean) } | undefined
      const isWrite = tool && ('writeCapable' in tool) ? (
        typeof tool.writeCapable === 'function' ? tool.writeCapable(ctx.args as Record<string, unknown>) : tool.writeCapable === true
      ) : false
      if (!isWrite) return next(ctx)
      const args = (ctx.args ?? {}) as Record<string, unknown>
      if (args.dryRun === true) return next(ctx)  // 只读预检不拦

      const scale = measureWriteScale(args, opts.getBind)
      if (scale.count < threshold) {
        log('pass', scale.kind, scale.count)
        return next(ctx)
      }
      // 豁免 1:方案确认留痕(用户已对方案点头 → 方案内批量操作不再拦;summary 不外显给 LLM)
      if (opts.getPlanConfirmation?.()) {
        log('exempt-plan', scale.kind, scale.count)
        return next(ctx)
      }
      // 豁免 2:本会话该形态已确认过一次(防反复弹窗)
      if (confirmedKinds.has(scale.kind)) {
        log('exempt-once', scale.kind, scale.count)
        return next(ctx)
      }
      // observe 模式(无人值守):只留痕不挂起
      if (mode === 'observe') {
        log('observe', scale.kind, scale.count)
        return next(ctx)
      }
      // confirm 模式:挂 approval(自带超时,超时自动拒 —— stream 路径无 approvalWatch 兜底)
      log('confirm', scale.kind, scale.count)
      const preview = scale.scopes.slice(0, 3).join(', ') + (scale.scopes.length > 3 ? ` 等 ${scale.scopes.length} 个` : '')
      return new Promise<ToolExecResult>((resolve) => {
        let settled = false
        const finish = (approved: boolean) => {
          if (settled) return
          settled = true
          if (timer) clearTimeout(timer)
          if (approved) {
            confirmedKinds.add(scale.kind)
            // 放行:执行真实工具(next 继续原调用链)
            next(ctx).then(resolve, resolve)
          } else {
            log('rejected', scale.kind, scale.count)
            resolve({
              content: `BULK_CHANGE_REJECTED · 本次写入将触达 ${scale.count} 个现有组件节点(${preview}),已被拒绝。如需执行:请向用户说明操作范围并征得同意(方案征询确认后不再拦截);或改用更小范围的操作。注意:改分批会破坏 patches 原子性(任一失败整批回滚),分批前建议先 dryRun 预检或留快照。`,
              status: 'error' as const,
            })
          }
        }
        const timer = timeoutMs > 0 ? setTimeout(() => {
          log('timeout', scale.kind, scale.count)
          finish(false)
        }, timeoutMs) : null
        // abort 联动:进入时已 abort 或用户停止 → 拒(防挂起泄漏)
        if (ctx.signal) {
          if (ctx.signal.aborted) return finish(false)
          const onAbort = () => finish(false)
          ctx.signal.addEventListener('abort', onAbort, { once: true })
        }
        // 挂起走 ctx.emit(与 approval/humanConfirm 同通道:流内转发到 UI ApprovalBar/集成方 handler,
        // resolve 直连本闭包 finish —— core 外发 emit 吞 approval_request,勿用)。
        // resolve 类型 boolean|string:bulkGuard 只用 true/false;string(方案选择)按 truthy 处理为允许
        ctx.emit?.({ type: 'approval_request', toolName: ctx.name, args: { question: `即将执行大批量变更:触达 ${scale.count} 个现有组件(${preview}),确认执行?`, __bulkGuard: true, scale }, resolve: (approved) => finish(!!approved) })
      })
    },
  }
  return Object.assign(mw, { state: { confirmedKinds, reset: () => confirmedKinds.clear() } })
}
