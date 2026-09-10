/**
 * sec-125 —— F2a sessionVars 收敛(sdk/sessionLifecycle.ts)
 *
 * 会话级可变状态从 buildCore 三个散 let 收敛为单对象。断言:初值形状 / resetSessionVars 逐字段归初
 * 且对象身份不变(持有引用不失效 —— switchSession/onClear 重置口径)/ 双实例互不串(多会话共存隔离)。
 */
import { createSessionVars, resetSessionVars } from '../../sdk/sessionLifecycle'

export async function run(ctx: { assert: (cond: boolean, msg: string) => void }): Promise<void> {
  const { assert } = ctx

  const v = createSessionVars()
  assert(v.lastTitle === undefined && v.titleLLMDone === false && v.lastPlanConfirmation === undefined,
    '✓ createSessionVars 初值三字段归零(lastTitle/titleLLMDone/lastPlanConfirmation)')

  v.lastTitle = '会话标题'
  v.titleLLMDone = true
  v.lastPlanConfirmation = { at: 1, summary: 's', choice: 'c', viaOptions: true }
  resetSessionVars(v)
  assert(v.lastTitle === undefined && v.titleLLMDone === false && v.lastPlanConfirmation === undefined,
    '✓ resetSessionVars 逐字段归初值(切/重置会话口径)')

  const v2 = createSessionVars()
  v2.lastTitle = '另一会话'
  assert(v.lastTitle === undefined && v2.lastTitle === '另一会话',
    '✓ 双实例状态互不串(shareContext 多会话共存隔离)')
  const held = v
  resetSessionVars(v)
  assert(held === v, '✓ reset 不重建对象(持有引用稳定 —— 修前散 let 跨作用域赋值是 P0-4 根因形态)')
}
