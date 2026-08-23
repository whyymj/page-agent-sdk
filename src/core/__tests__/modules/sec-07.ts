import { createMemoryMiddleware } from '../../harness/memory'
import { createInitialState as createState } from '../../harness/state'

// tsx 运行时由 node 提供 process;tsc 静态检查无 @types/node,显式声明其类型
import type { TestCtx } from './_ctx'

// memory 中间件
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx;
  console.log('\n[memory middleware]')
  {
    const mw = createMemoryMiddleware('记住:用中文')
    const s = await mw.beforeAgent?.(createState()) as any
    assert(s?.memory === '记住:用中文', 'memory beforeAgent 注入 state')
    assert(mw.augmentPrompt?.({ ...createState(), memory: '记住:用中文' })?.includes('记住:用中文'), 'memory augmentPrompt 渲染')
  }
}
