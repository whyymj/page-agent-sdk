import { createTodosMiddleware } from '../../harness/todos'
import { createInitialState as createState } from '../../harness/state'

// tsx 运行时由 node 提供 process;tsc 静态检查无 @types/node,显式声明其类型
import type { TestCtx } from './_ctx'

// todos 中间件
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke } = ctx;
  console.log('\n[todos middleware]')
  {
    const mw = createTodosMiddleware()
    assert(mw.augmentPrompt?.(createState()) === undefined, '空 todos → augmentPrompt 无段')

    const wt = mw.tools!.find((x) => x.name === 'write_todos')!
    let r = await invoke(wt, { todos: [{ content: '任务一', status: 'in_progress' }] })
    assert(/已更新/.test(r), 'write_todos 整表替换')

    const seg = mw.augmentPrompt?.(createState())
    assert(seg?.includes('任务一') && /任务清单/.test(seg || ''), '更新后 todos 注入 prompt')

    // 并行拒绝(beforeModel 未重置计数 → 第 2 次拒绝)
    const next = async () => ({ content: 'ok', status: 'done' as const })
    await mw.wrapToolCall!({ id: '1', name: 'write_todos', args: {}, state: createState() }, next)
    const r2 = await mw.wrapToolCall!({ id: '2', name: 'write_todos', args: {}, state: createState() }, next)
    assert(/不应在一轮中调用多次/.test(r2.content) && r2.status === 'error', '并行 write_todos 被拒(整表替换一轮多次无意义)')
  }
}
