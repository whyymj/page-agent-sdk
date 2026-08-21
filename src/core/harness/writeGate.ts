/**
 * stale-read-invalidation Phase 0 —— 写成功判定纯函数
 *
 * 动机(三方怀疑论评审 A1/B1):harness 现有「写成功」口径只看 r.status !== 'error',但
 * dataOps 业务失败(SCHEMA_INVALID/VERSION_CONFLICT/PATH_DENIED/keep_external/restore 裁决)
 * 是 `return toolError({...})` 返回 `ERROR: {json}` 字符串、不 throw —— coreExecTool 只有
 * throw 才置 error。结果:失败写被 turnUsage.writePaths 计入 fact-sheet「成功写入路径」,
 * zero-tool 门禁的事实清单失真(把没写成的说成写成了)。
 *
 * 后续(stale-read-invalidation 主体)以本判定为失效触发的地基:失败写不触发读失效,
 * 防「占位文案宣称已写入 = 机制供给假事实」。
 */
import type { ToolExecResult } from './middleware'

/**
 * 判定一次工具调用是否为「成功的写」(四重门槛,全部满足):
 *  ① writeCapable(args-aware:条件写如 eval_script 仅 transform 模式算写)
 *  ② 非 dryRun(预检不落盘)
 *  ③ status !== 'error'(throw 路径)
 *  ④ 结果 content 不是 ERROR: 前缀的 toolError 字符串(返回式失败路径 —— dataOps 业务失败全部走这)
 * 委派工具(use_ 与 spawn 族)不在本判定内:那是「等效写」口径(isZeroEffectiveWrite),语义不同。
 */
export function isSuccessfulWriteResult(
  tool: ({ name: string } & Record<string, unknown>) | undefined,
  args: Record<string, unknown> | undefined,
  result: Pick<ToolExecResult, 'content' | 'status'> | undefined,
): boolean {
  if (!tool || !result) return false
  if (result.status === 'error') return false
  if (args && args.dryRun === true) return false
  // args-aware writeCapable 标注(单一真相源;勿用 isWriteToolByName 的保守口径 —— query 模式 eval 会误判)
  const wc = 'writeCapable' in tool ? (tool as { writeCapable?: unknown }).writeCapable : undefined
  const capable = typeof wc === 'function' ? wc(args ?? {}) : wc === true
  if (!capable) return false
  return !String(result.content || '').startsWith('ERROR:')
}
