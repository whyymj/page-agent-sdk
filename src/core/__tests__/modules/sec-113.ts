import { applyStepView } from '../../components/stepView'
import { createChatContext } from '../../composables/chatContext'
import type { ToolStepViewFn } from '../../types'
import type { TestCtx } from './_ctx'

// 工具步骤展示映射(dialog.toolStepView;用户诉求:原始工具名 read/write/use_html 对终端用户不友好,
// 替换为业务友好名称/内容。纯展示层 —— 不影响发给 LLM 的工具名/协议/校验)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[工具步骤展示映射 · applyStepView]')
  {
    // ✓ 映射命中 → title/detail 透传(正常工作)
    const fn: ToolStepViewFn = (s) =>
      s.name === 'write' ? { title: '修改数据', detail: String((s.args as { jsonPath?: string } | undefined)?.jsonPath ?? '') } : undefined
    const hit = applyStepView(fn, { name: 'write', args: { jsonPath: 'components.3.props.title' }, status: 'done' })
    assert(hit.title === '修改数据' && hit.detail === 'components.3.props.title', 'applyStepView 映射命中 → title + args 动态 detail 透传')
    // ✓ 未映射(返回 undefined)→ 空视图(回退原始工具名)
    const miss = applyStepView(fn, { name: 'read', args: {}, status: 'done' })
    assert(!miss.title && !miss.detail, 'applyStepView 未映射(undefined 返回)→ 空视图(回退原始工具名)')
  }
  {
    // ✓ 边界:映射函数抛错 → 回退空视图(展示层异常不炸渲染)
    const boom: ToolStepViewFn = () => {
      throw new Error('bad mapper')
    }
    const r = applyStepView(boom, { name: 'write', status: 'running' })
    assert(!r.title && !r.detail, 'applyStepView 映射抛错 → 回退空视图(渲染兜底)')
    // ✓ 边界:返回非对象(null/字符串/空对象)→ 空视图
    const nullFn = (() => null) as unknown as ToolStepViewFn
    assert(!applyStepView(nullFn, { name: 'x', status: 'done' }).title, 'applyStepView 返回 null → 空视图')
    const strFn = (() => '修改数据') as unknown as ToolStepViewFn
    assert(!applyStepView(strFn, { name: 'x', status: 'done' }).title, 'applyStepView 返回字符串(非对象)→ 空视图')
    const emptyFn: ToolStepViewFn = () => ({})
    assert(!applyStepView(emptyFn, { name: 'x', status: 'done' }).title, 'applyStepView 返回空对象 → 空视图(视为未映射)')
    // ✓ 边界:title/detail 非字符串/空串 → 视为未提供(undefined)
    const weirdFn = (() => ({ title: '', detail: 123 })) as unknown as ToolStepViewFn
    const w = applyStepView(weirdFn, { name: 'x', status: 'done' })
    assert(w.title === undefined && w.detail === undefined, 'applyStepView 空串 title/非字符串 detail → 视为未提供')
    // ✓ 未配映射(undefined)→ 零开销直通空视图
    assert(!applyStepView(undefined, { name: 'write', status: 'done' }).title, 'applyStepView 未配映射函数 → 直通空视图')
    // ✓ 入参投影:name/args/status/result/durationMs 传给映射函数
    let seen: { name: string; status: string; result?: string } | null = null
    const spy: ToolStepViewFn = (s) => {
      seen = { name: s.name, status: s.status, result: s.result }
      return undefined
    }
    applyStepView(spy, { name: 'read', args: { jsonPath: 'a' }, status: 'error', result: 'PATH_DENIED', durationMs: 12 })
    assert(seen && seen.name === 'read' && seen.status === 'error' && seen.result === 'PATH_DENIED', 'applyStepView 入参投影 → name/status/result 完整传给映射函数')
  }
  console.log('\n[工具步骤展示映射 · createChatContext 透传]')
  {
    // ✓ dialog.toolStepView 经 createChatContext 透传进 ctx(MessageRow → MessageSteps 消费)
    const fn: ToolStepViewFn = (s) => (s.name === 'use_html' ? { title: '生成组件代码' } : undefined)
    const c = createChatContext({ fetchStream: async () => '', toolStepView: fn })
    assert(c.toolStepView === fn, 'createChatContext toolStepView → ctx.toolStepView 透传(MessageSteps 步骤行自定义)')
    // ✓ 边界:未传 → undefined(原始工具名直显,默认路径行为零变化)
    const c2 = createChatContext({ fetchStream: async () => '' })
    assert(c2.toolStepView === undefined, 'createChatContext 未传 toolStepView → undefined(原始工具名直显)')
  }
}
