/**
 * Approval 中间件 —— 工具调用前人工确认(human-in-the-loop)
 *
 * 经 wrapToolCall 拦截需确认的工具调用,发 approval_request 事件(带 resolve 回调),
 * UI 收到后弹确认框,用户「允许/拒绝」调 resolve → 中间件 Promise 收口:允许则执行,拒绝则返回 error。
 *
 * - 不需确认的工具直接放行(next)
 * - abort 联动:用户停止生成(signal.aborted)→ 自动拒绝,不永久挂起
 * - 超时(timeoutMs)→ 自动拒绝(默认 0 = 不超时,等用户)
 * - 拒绝时返回结构化 error,LLM 可据此改方案(如换路径、改只读)
 *
 * 装载顺序:在 permissions 之后(白名单先自动拒,幸存的写操作再人工确认)。
 */
import type { Middleware, ToolCallContext, ToolExecResult } from './middleware'

export interface ApprovalOptions {
  /** 需确认的工具名列表;不传 confirm 且不传 tools → 所有工具都确认 */
  tools?: string[]
  /** 自定义判定(优先于 tools);返回 true 需确认 */
  confirm?: (name: string, args: any) => boolean
  /** 超时毫秒(用户未响应自动拒绝);0 = 不超时。SDK 装配层对无 UI 路径注入默认 30s(flow-robustness P1#3) */
  timeoutMs?: number
  /** 超时自动拒的留痕回调(observable 接线由调用方负责;abort/用户先收口不触发) */
  onAutoReject?: (info: { toolName: string; waitedMs: number }) => void
}

export function createApprovalMiddleware(opts: ApprovalOptions = {}): Middleware {
  const needConfirm = (name: string, args: any): boolean => {
    if (opts.confirm) return !!opts.confirm(name, args)
    // tools 显式给出(含空数组)→ 仅确认列表内;未给 tools → 确认所有
    if (opts.tools !== undefined) return opts.tools.includes(name)
    return true
  }

  return {
    name: 'approval',
    wrapToolCall: async (ctx: ToolCallContext, next: (ctx: ToolCallContext) => Promise<ToolExecResult>) => {
      if (!needConfirm(ctx.name, ctx.args)) return next(ctx)

      return new Promise<ToolExecResult>((resolve) => {
        let settled = false
        const cleanup: Array<() => void> = []

        const finish = (approved: boolean | string) => {
          if (settled) return
          settled = true
          cleanup.forEach((fn) => fn())
          ctx.logSink?.({ type: 'middleware', data: { stage: 'approval_resolved', toolName: ctx.name, approved: approved === false ? false : String(approved).slice(0, 60) } })
          if (approved === false) {
            // 兼容 vfs path / 数据 jsonPath / write 的 patch.jsonPath / patches[],让 LLM 知道被拒的精确范围
            const a = (ctx.args ?? {}) as Record<string, any>
            const scope =
              a.path || a.jsonPath || a.patch?.jsonPath ||
              (Array.isArray(a.patches) ? a.patches.map((p: any) => p?.jsonPath).filter(Boolean).join(',') : '') ||
              ''
            resolve({
              content: `用户拒绝了 ${ctx.name} 调用${scope ? `(path=${scope})` : ''}。请改用只读工具、调整路径或换方案后再试。`,
              status: 'error' as const,
            })
          } else {
            // true 或 string(选方案)→ 视为允许,执行工具
            next(ctx).then(resolve, (e: any) =>
              resolve({ content: `工具执行失败:${e?.message ?? e}`, status: 'error' as const }),
            )
          }
        }

        // abort 联动:进入时已 abort → 立即拒绝;否则监听 abort(用户停止生成 → 自动拒绝,防永久挂起)
        if (ctx.signal) {
          if (ctx.signal.aborted) return finish(false)
          const onAbort = () => finish(false)
          ctx.signal.addEventListener('abort', onAbort, { once: true })
          cleanup.push(() => ctx.signal?.removeEventListener('abort', onAbort))
        }

        // 超时自动拒绝(flow-robustness P1#3:SDK 装配层默认 30s —— 无响应方路径自动拒;
        // 响应方收到事件调 hold() 接管(内置 UI 即如此),无人应答才计时收口;abort/用户先收口时 settled 已置,不误报)
        let hold: (() => void) | undefined
        if (opts.timeoutMs && opts.timeoutMs > 0) {
          const startedAt = Date.now()
          let held = false
          const timer = setTimeout(() => {
            if (settled || held) return
            const waitedMs = Date.now() - startedAt
            finish(false)
            opts.onAutoReject?.({ toolName: ctx.name, waitedMs })
          }, opts.timeoutMs)
          cleanup.push(() => clearTimeout(timer))
          hold = () => { held = true; clearTimeout(timer) } // 幂等:重复调/收口后调均无害
        }

        // 发确认请求事件:UI 调 resolve(approved) 收口;确认接管者调 hold() 取消无响应计时
        ctx.emit?.({
          type: 'approval_request',
          toolName: ctx.name,
          args: ctx.args,
          resolve: finish,
          hold,
        })
        // 挂起/收口双留痕(2026-09-02,nested-demo 诊断驱动):exportDiagnostics/debugLogs 此前只见
        // tool_call 派发后无限 'running' 无 tool_result,无法判断「卡在等确认」—— 现在挂起即见
        // approval_pending,用户裁决/自动拒/abort 后见 approval_resolved,时间线自解释(收口留痕在 finish 内)
        ctx.logSink?.({ type: 'middleware', data: { stage: 'approval_pending', toolName: ctx.name } })
      })
    },
  }
}
