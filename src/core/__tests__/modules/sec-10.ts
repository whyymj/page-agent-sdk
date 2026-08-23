import { runPool } from '../../utils/pool'

// tsx 运行时由 node 提供 process;tsc 静态检查无 @types/node,显式声明其类型
import type { TestCtx } from './_ctx'

// pool(并发池:createAgent 同轮工具 / subagent 多子任务 共用)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx;
  console.log('\n[pool]')
  {
    // limit=1 串行:顺序执行 + 顺序结果
    const order: string[] = []
    const r1 = await runPool(['a', 'b', 'c'], 1, async (x) => {
      order.push(x)
      return x.toUpperCase()
    })
    assert(JSON.stringify(r1) === JSON.stringify(['A', 'B', 'C']), 'runPool: limit=1 串行,结果按顺序回填')
    assert(JSON.stringify(order) === JSON.stringify(['a', 'b', 'c']), 'runPool: limit=1 严格串行执行')

    // limit>1 并发:结果仍按原顺序回填(并发完成顺序无关)
    const r2 = await runPool([1, 2, 3, 4], 4, async (x) => x * 10)
    assert(JSON.stringify(r2) === JSON.stringify([10, 20, 30, 40]), 'runPool: 并发结果按原顺序回填')

    // 并发上限:同时执行的任务不超过 limit
    let active = 0
    let maxActive = 0
    await runPool([1, 2, 3, 4, 5], 2, async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((r) => setTimeout(r, 10))
      active--
    })
    assert(maxActive >= 2, 'runPool: 并发确实发生(峰值 ' + maxActive + ')')
    assert(maxActive <= 2, 'runPool: 并发不超过 limit')

    // signal 已 aborted:串行分支不执行,结果全 undefined
    const ac = new AbortController()
    ac.abort()
    let ran = false
    const r3 = await runPool(
      [1, 2, 3],
      1,
      async () => {
        ran = true
        return 0
      },
      ac.signal,
    )
    assert(!ran && r3.every((x) => x === undefined), 'runPool: signal aborted 时串行不启动(结果全 undefined)')
  }
}
