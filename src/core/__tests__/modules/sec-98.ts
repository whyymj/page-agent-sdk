/**
 * sec-98:stale-read-invalidation Phase 0(写成功判定 isSuccessfulWriteResult)
 * 覆盖:writeCapable 布尔/条件(args-aware)/非 writeCapable 拒 / dryRun 跳过 /
 *      throw-error(status error)跳过 / **ERROR: 字符串(toolError 返回式失败)跳过**(评审 A1 核心:
 *      dataOps 业务失败不 throw,旧口径 status-only 会把它计入成功写)/ 正常写成功放行 /
 *      循环层回灌:isWriteToolByName 保守口径不再用于 writePaths(由 createAgent 接线保证,此处测纯函数)。
 */
import type { TestCtx } from './_ctx'
import { isSuccessfulWriteResult } from '../../harness/writeGate'

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  const mkTool = (name: string, writeCapable?: unknown) => ({ name, ...(writeCapable !== undefined ? { writeCapable } : {}) })
  const ok = { content: '已 write(edit) 主数据(1 个 patch)。当前值:… (新 hash=ab12)', status: 'done' as const }
  const toolErr = { content: 'ERROR: {"error":"SCHEMA_INVALID","message":"校验失败"}', status: 'done' as const }
  const thrown = { content: '工具执行出错:网络异常', status: 'error' as const }

  // 1. 布尔标注:正常写成功放行
  assert(isSuccessfulWriteResult(mkTool('write', true), { patch: { op: 'set', jsonPath: 'title' } }, ok) === true, '✓ 写成功判定 → writeCapable 布尔 + done + 非 ERROR → 放行')

  // 2. ERROR: 字符串(dataOps 业务失败)跳过 —— 评审 A1:toolError 返回不 throw,status 恒 done
  assert(isSuccessfulWriteResult(mkTool('write', true), { patch: { op: 'set', jsonPath: 'title' } }, toolErr) === false, '✓ 写成功判定 → SCHEMA_INVALID 字符串返回 → 不算成功写(fact-sheet 不再失真)')

  // 3. throw 路径(status error)跳过
  assert(isSuccessfulWriteResult(mkTool('write', true), {}, thrown) === false, '✓ 写成功判定 → status error(throw 路径)跳过')

  // 4. dryRun 预检跳过(不落盘)
  assert(isSuccessfulWriteResult(mkTool('write', true), { dryRun: true, patch: { op: 'set' } }, { content: '预检通过', status: 'done' }) === false, '✓ 写成功判定 → dryRun 预检不算写')

  // 5. 条件写 args-aware:eval_script query 模式不算写,transform 模式算
  const evalTool = mkTool('eval_script', (args: Record<string, unknown>) => args?.mode === 'transform')
  assert(isSuccessfulWriteResult(evalTool, { mode: 'query', script: 'data.components.length' }, ok) === false, '✓ 写成功判定 → eval_script query 模式不算写(args-aware)')
  assert(isSuccessfulWriteResult(evalTool, { mode: 'transform', script: 'data' }, ok) === true, '✓ 写成功判定 → eval_script transform 模式算写')

  // 6. 非 writeCapable 工具(如 read)永不判写
  assert(isSuccessfulWriteResult(mkTool('read'), { jsonPath: 'title' }, ok) === false, '✓ 写成功判定 → read 不算写')

  // 7. 边界:工具缺失 / 结果缺失 → false(宁漏勿误)
  assert(isSuccessfulWriteResult(undefined, {}, ok) === false, '✓ 写成功判定 → 工具缺失 → false')
  assert(isSuccessfulWriteResult(mkTool('write', true), {}, undefined) === false, '✓ 写成功判定 → 结果缺失 → false')

  // 8. 空 content 的 done(理论不出现;防御)不因 String('') 误判
  assert(isSuccessfulWriteResult(mkTool('write', true), {}, { content: '', status: 'done' }) === true, '✓ 写成功判定 → 空 content 的 done 放行(非 ERROR 前缀)')
}
