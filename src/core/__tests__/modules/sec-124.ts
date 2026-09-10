/**
 * sec-124 —— F0b controller 载体类型化(ControllerCarrier/ReconfigureHookCarrier/GetControllerCarrier)
 *
 * F0b 把装配层 8 处 `(mw as any).controller` duck 通道类型化;hasGetController 是新增导出的运行时
 * duck 守卫(可选挂载判定)。断言:守卫正反两态 + skills/subagents 工厂载体字段运行期真实存在
 * (类型化只在编译期,运行期 defineProperty 挂载仍是事实来源)。
 */
import { hasGetController, type Middleware } from '../../harness/middleware'
import { createSkillsMiddleware } from '../../harness/skills'

export async function run(ctx: { assert: (cond: boolean, msg: string) => void }): Promise<void> {
  const { assert } = ctx

  const plain: Middleware = { name: 'plain-mw' }
  assert(hasGetController(plain) === false, '✓ hasGetController(普通 Middleware)= false(可选挂载判定,零误报)')

  const carrier: Middleware & { _setGetController: (g: () => unknown) => void } = {
    name: 'carrier-mw',
    _setGetController: () => { /* 槽位 */ },
  }
  assert(hasGetController(carrier) === true, '✓ hasGetController(带 _setGetController)= true(装配期注入通道可识别)')

  const skillsMw = createSkillsMiddleware([{ name: 's1', description: 'd1' }])
  assert(typeof skillsMw.controller.get === 'function' && Array.isArray(skillsMw.controller.get()),
    '✓ createSkillsMiddleware 载体:controller.get() 运行期可用(F0b 类型化的事实来源)')
  skillsMw.controller.set([{ name: 's2', description: 'd2' }])
  assert(skillsMw.controller.get().some((s) => s.name === 's2'), '✓ skills controller.set 后 get 反映新表(载体非只读快照)')
}
