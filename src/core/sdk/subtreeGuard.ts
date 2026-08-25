/**
 * read-before-write 守卫(subtree-summary Phase 1)—— 防「凭占位印象写」
 *
 * 摘要泛化(Phase 0)后,主 agent 读父级只见 `<subtree Nkb keys:[…] #指纹>` 占位:键名/体积可见,**内容未见**。
 * 直接对占位子树深路径写入 = 凭键名印象猜结构(路径有效但语义错位是唯一静默危险面 —— 路径无效会被校验拦)。
 * 本守卫在装配层拦下:写路径落入摘要子树 S,且本轮 invoke 无 S 自身/后代的窄读记录、S 无成功写 → 回灌窄读指令
 * (ask-first,一轮后可写 —— 引导重试而非禁止)。
 *
 * 放行四态(恒放行):dryRun / 已读(本轮 read 目标 = S 或其后代)/ 已写过(本轮 S 内已有成功写,S 视为已打开)/
 * 未落入任何摘要面(S1 骨架直写小标量恒放行)。同一 S 第二次拦截放行(每子树一次,防嘴硬死循环烧轮次)。
 * 整体 set(write({value}) 无 jsonPath)不拦:写路径 = 根,不「落入」任何 S(S4 一把梭形态,明示不覆盖)。
 *
 * 判定数据源:dataOps controller 的 getSummarizedPaths(Phase 0 摘要器 onSummarized 上报;<subtree> 与
 * <field Nkb> 两类都算 —— 标记字段占位同样「内容未见」)。豁免前缀(聚焦全文/子 scope)路径不进集合,天然放行。
 */
import type { Middleware, ToolCallContext, ToolExecResult } from '../harness/middleware'

export interface SubtreeWriteGuardOptions {
  /** 主 scope 占位路径集(dataOps controller.getSummarizedPaths) */
  getSummarizedPaths: () => string[]
  /** 清空占位路径集(invoke 边界:beforeAgent 调,invoke 级口径) */
  clearSummarizedPaths: () => void
}

/** write args → 目标 jsonPath 列表(patch/patches;del 同;整体 value 写无 jsonPath → 空 = 不拦) */
function writeTargetPaths(args: unknown): string[] {
  const a = (args ?? {}) as Record<string, any>
  const out: string[] = []
  if (a.patch && typeof a.patch.jsonPath === 'string' && a.patch.jsonPath) out.push(a.patch.jsonPath)
  if (Array.isArray(a.patches)) {
    for (const p of a.patches) {
      if (p && typeof p.jsonPath === 'string' && p.jsonPath) out.push(p.jsonPath)
    }
  }
  return out
}

/** p 是否落在 scope 子树内(p === scope 或为其后代;数组段 `.`/`[` 两种分隔均认) */
function fallsIn(p: string, scope: string): boolean {
  return p === scope || p.startsWith(scope + '.') || p.startsWith(scope + '[')
}

export function createSubtreeWriteGuardMiddleware(opts: SubtreeWriteGuardOptions): Middleware {
  // invoke 级状态(beforeAgent 重置):本轮窄读目标 / 已成功写的子树 / 已拦过的子树(每子树一次)
  let readTargets = new Set<string>()
  let writtenSubtrees = new Set<string>()
  let blockedSubtrees = new Set<string>()

  const findSummarizedScope = (p: string, summarized: string[]): string | undefined =>
    summarized.find((s) => fallsIn(p, s))

  const mw: Middleware = {
    name: 'subtree-write-guard',
    beforeAgent: () => {
      readTargets = new Set()
      writtenSubtrees = new Set()
      blockedSubtrees = new Set()
      opts.clearSummarizedPaths()  // invoke 边界:上轮占位不株连本轮
    },
    wrapToolCall: async (
      ctx: ToolCallContext,
      next: (ctx: ToolCallContext) => Promise<ToolExecResult>,
    ): Promise<ToolExecResult> => {
      // 窄读目标捕获:read 的 jsonPath/jsonPaths(结果根豁免 = 全文已见;query/search 返回占位+path 不算窄读)
      if (ctx.name === 'read') {
        const a = (ctx.args ?? {}) as Record<string, unknown>
        if (typeof a.jsonPath === 'string' && a.jsonPath) readTargets.add(a.jsonPath)
        if (Array.isArray(a.jsonPaths)) for (const p of a.jsonPaths) if (typeof p === 'string' && p) readTargets.add(p)
        return next(ctx)
      }
      if (ctx.name !== 'write') return next(ctx)
      const a = (ctx.args ?? {}) as Record<string, unknown>
      if (a.dryRun === true) return next(ctx)  // 预检不落盘,恒放行
      const summarized = opts.getSummarizedPaths()
      if (!summarized.length) return next(ctx)
      const targets = writeTargetPaths(ctx.args)
      if (!targets.length) return next(ctx)  // 整体 set:写路径=根,不落入任何 S(S4 明示不覆盖)
      // 逐目标判定:落入 S × 无窄读(S 或后代)× 未写过 × 未拦过 → 拦(一次)
      for (const p of targets) {
        const s = findSummarizedScope(p, summarized)
        if (!s) continue
        const readOk = [...readTargets].some((r) => fallsIn(r, s))
        if (readOk || writtenSubtrees.has(s)) continue
        if (blockedSubtrees.has(s)) continue  // 每子树一次:嘴硬第二次放行(防死循环烧轮次,失败可见不静默)
        blockedSubtrees.add(s)
        return {
          content: `NEED_NARROW_READ · 写路径 "${p}" 的目标子树 "${s}" 此前只见摘要占位(<subtree …>/<field Nkb>,键名可见但内容未见),直接写入易凭印象猜结构错位。请先 read({jsonPath:"${s}"}) 查看实际内容(结果根豁免返回全文;若它是大数组或内容很大,加 offset/limit 分页或 fields 裁剪、或只读要写的子路径,勿整灌上下文),再基于真实值写入;聚焦该区域也可用 set_focus。若你确认已读过,请检查路径是否写错。`,
          status: 'error' as const,
        }
      }
      const res = await next(ctx)
      // 成功写 → 目标落入的摘要子树视为已打开(后续写放行)
      const content = String((res as { content?: unknown }).content ?? '')
      if (!(res as { status?: string }).status || (res as { status?: string }).status !== 'error') {
        if (!content.startsWith('ERROR:')) {
          for (const p of targets) {
            const s = findSummarizedScope(p, summarized)
            if (s) writtenSubtrees.add(s)
          }
        }
      }
      return res
    },
  }
  return mw
}
