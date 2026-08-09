import { z } from 'zod'
import { createFocusMiddleware } from '../../harness/focus'
import type { TestCtx } from './_ctx'

// 上下文聚焦 focus 中间件(focus-context:目标/视野/范围三层收敛;wrapToolCall 写越界 PATH_DENIED)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[上下文聚焦 focus 中间件 · 三层收敛 + 范围收紧]')
  {
    const schema = z.object({
      title: z.string(),
      components: z.array(
        z.object({
          type: z.string(),
          props: z.object({ title: z.string(), visible: z.boolean().optional() }),
        }),
      ),
    })
    const mw = createFocusMiddleware({ getSchema: () => schema })

    // augmentPrompt:未聚焦 → undefined(默认不聚焦行为与现状一致)
    assert(mw.augmentPrompt!({} as any) === undefined, 'focus augmentPrompt 未聚焦 → undefined')

    // 聚焦 components.1(带 label)→ 注入目标段 + 子树视野(三层收敛之前两层)
    mw.setFocus({ path: 'components.1', label: '导航栏' })
    const prompt = mw.augmentPrompt!({} as any)!
    assert(prompt.includes('当前精修目标'), 'focus 聚焦 → augmentPrompt 含「当前精修目标」段(目标提示)')
    assert(prompt.includes('components.1'), 'focus 聚焦 → augmentPrompt 含焦点 path')
    assert(prompt.includes('导航栏'), 'focus 聚焦 → augmentPrompt 含 label')
    assert(prompt.includes('焦点子树结构'), 'focus 聚焦 → augmentPrompt 含子树 schema 段(视野收敛)')

    // clearFocus → 不再注入
    mw.clearFocus()
    assert(mw.augmentPrompt!({} as any) === undefined, 'focus clearFocus → augmentPrompt 不再注入')
    assert(mw.getFocus() === undefined, 'focus clearFocus → getFocus undefined')

    // ===== 范围收紧(strict):wrapToolCall 写越界 PATH_DENIED(第三层)=====
    mw.setFocus({ path: 'components.1' })
    const callNext = async () => ({ content: 'ok', status: 'done' as const })

    // 子树内写 → 放行
    const under = await mw.wrapToolCall!(
      { name: 'write', args: { patch: { jsonPath: 'components.1.props.title', op: 'set', value: '新标题' } } } as any,
      callNext,
    )
    assert(under.status === 'done', 'focus 写子树内(components.1.props.title)→ 放行')

    // 焦点本身 === → 放行
    const selfWrite = await mw.wrapToolCall!(
      { name: 'edit_data', args: { jsonPath: 'components.1', value: {} } } as any,
      callNext,
    )
    assert(selfWrite.status === 'done', 'focus 写焦点本身(components.1)→ 放行')

    // 越界(其他组件)→ PATH_DENIED
    const outside = await mw.wrapToolCall!(
      { name: 'write', args: { patch: { jsonPath: 'components.0.props.title', op: 'set', value: 'x' } } } as any,
      callNext,
    )
    assert(outside.status === 'error', 'focus 写越界(components.0)→ status=error')
    assert(outside.content.includes('PATH_DENIED'), 'focus 写越界 → content 含 PATH_DENIED')

    // 前缀边界:components.10 不误匹配 components.1(用 . 分隔判,非 startsWith 裸前缀)
    const idx10 = await mw.wrapToolCall!(
      { name: 'edit_data', args: { jsonPath: 'components.10.props.title' } } as any,
      callNext,
    )
    assert(idx10.status === 'error', 'focus 前缀边界:components.10 不误匹配 components.1 → 拒绝')

    // 非焦点顶层字段(title)→ 越界拒绝
    const topField = await mw.wrapToolCall!(
      { name: 'set_data', args: { jsonPath: 'title', value: 'x' } } as any,
      callNext,
    )
    assert(topField.status === 'error', 'focus 写非焦点顶层字段(title)→ 拒绝')

    // 整体写(无 jsonPath)→ 不拦(schema 白名单兜底,与 permissions 一致)
    const whole = await mw.wrapToolCall!({ name: 'write', args: { value: { title: 'x' } } } as any, callNext)
    assert(whole.status === 'done', 'focus 整体写(无 jsonPath)→ 不拦(schema 白名单兜底)')

    // 读工具不限制(用户仍需看全量上下文)
    const readOutside = await mw.wrapToolCall!({ name: 'read', args: { jsonPath: 'components.0' } } as any, callNext)
    assert(readOutside.status === 'done', 'focus 读工具(components.0)→ 不限制')

    // 批量 patches:任一越界 → 拒绝;全在子树内 → 放行
    const batchMixed = await mw.wrapToolCall!(
      {
        name: 'write',
        args: {
          patches: [
            { jsonPath: 'components.1.props.title', op: 'set', value: 'a' },
            { jsonPath: 'components.2.props.title', op: 'set', value: 'b' },
          ],
        },
      } as any,
      callNext,
    )
    assert(batchMixed.status === 'error', 'focus 批量 patches 含越界(components.2)→ 拒绝')
    const batchAll = await mw.wrapToolCall!(
      {
        name: 'write',
        args: {
          patches: [
            { jsonPath: 'components.1.props.title', op: 'set', value: 'a' },
            { jsonPath: 'components.1.props.visible', op: 'set', value: true },
          ],
        },
      } as any,
      callNext,
    )
    assert(batchAll.status === 'done', 'focus 批量 patches 全在子树内 → 放行')

    // ===== 控制器:getFocus / reset =====
    mw.setFocus({ path: 'components.2' })
    assert(mw.getFocus()?.path === 'components.2', 'focus getFocus → 反映当前焦点')
    mw.reset()
    assert(mw.getFocus() === undefined, 'focus reset → 清空焦点')
    assert(mw.augmentPrompt!({} as any) === undefined, 'focus reset → augmentPrompt 不再注入')

    // ===== beforeAgent 进 state(供其他中间件/工具观测)=====
    mw.setFocus({ path: 'components.1' })
    const upd = mw.beforeAgent!({} as any) as any
    assert(upd?.focus?.path === 'components.1', 'focus beforeAgent → state.focus 反映焦点')
    mw.clearFocus()
    const upd2 = mw.beforeAgent!({} as any) as any
    assert(!upd2 || Object.keys(upd2).length === 0, 'focus beforeAgent 未聚焦 → 空更新')
  }
  // getSchema 返回 null(无 data 场景)→ 目标段仍注入,视野段跳过
  {
    const mw = createFocusMiddleware({ getSchema: () => null })
    mw.setFocus({ path: 'components.1' })
    const prompt = mw.augmentPrompt!({} as any)!
    assert(prompt.includes('当前精修目标'), 'focus 无 schema → 目标段仍注入')
    assert(!prompt.includes('焦点子树结构'), 'focus 无 schema → 跳过视野段(不渲染子树)')
  }

  // ===== initialFocuses 构造参数(multi-focus:子 agent 继承主多焦点)=====
  {
    const schema = z.object({ components: z.array(z.object({ type: z.string() })) })
    // 构造即带焦点(无需 setFocus)—— 子 agent 继承时用 initialFocuses 一次到位
    const mw = createFocusMiddleware({ getSchema: () => schema, initialFocuses: [{ path: 'components.1', label: '导航' }] })
    assert(mw.getFocus()?.path === 'components.1', '✓ focus initialFocuses → 构造即 getFocus 有值(兼容返首个)')
    assert(mw.getFocuses().length === 1 && mw.getFocuses()[0].path === 'components.1', '✓ focus initialFocuses → getFocuses 全量')
    const prompt = mw.augmentPrompt!({} as any)!
    assert(prompt.includes('当前精修目标') && prompt.includes('components.1'), '✓ focus initialFocuses → augmentPrompt 含目标段 + path')
    // reset() 清空(切会话/清空)
    mw.reset()
    assert(mw.getFocus() === undefined && mw.getFocuses().length === 0, '✓ focus initialFocuses → reset() 后清空')
  }

  // ===== multi-focus:addFocus 累积 + removeFocus 移除 + 多前缀越界放行 =====
  {
    const schema = z.object({ title: z.string(), components: z.array(z.object({ type: z.string(), props: z.object({ title: z.string() }).optional() })) })
    const mw = createFocusMiddleware({ getSchema: () => schema })
    const callNext = async () => ({ content: 'ok', status: 'done' as const })
    // addFocus 累积两个焦点
    mw.addFocus({ path: 'components.0', label: '导航' })
    mw.addFocus({ path: 'components.2', label: '卡片' })
    assert(mw.getFocuses().length === 2, '✓ multi-focus addFocus 累积 → getFocuses 含 2 个')
    // 多前缀:写任一焦点子树放行
    const w0 = await mw.wrapToolCall!({ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.props.title', value: 'a' } } } as any, callNext)
    assert(w0.status === 'done', '✓ multi-focus 写 components.0(焦点之一)→ 放行')
    const w2 = await mw.wrapToolCall!({ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.2.props.title', value: 'b' } } } as any, callNext)
    assert(w2.status === 'done', '✓ multi-focus 写 components.2(另一焦点)→ 放行')
    // 写不在任一焦点 → PATH_DENIED
    const w1 = await mw.wrapToolCall!({ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.1.props.title', value: 'c' } } } as any, callNext)
    assert(w1.status === 'error' && w1.content.includes('PATH_DENIED'), '✓ multi-focus 写 components.1(非任一焦点)→ PATH_DENIED')
    // augmentPrompt 列出所有焦点
    const prompt = mw.augmentPrompt!({} as any)!
    assert(prompt.includes('components.0') && prompt.includes('components.2'), '✓ multi-focus augmentPrompt 列出所有焦点 path')
    assert(prompt.includes('2 个聚焦子树'), '✓ multi-focus augmentPrompt 含焦点数提示')
    // removeFocus 移除单个 → 写该子树重新越界
    mw.removeFocus('components.0')
    assert(mw.getFocuses().length === 1, '✓ multi-focus removeFocus → 剩余 1 个')
    const w0After = await mw.wrapToolCall!({ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.props.title', value: 'd' } } } as any, callNext)
    assert(w0After.status === 'error', '✓ multi-focus removeFocus(components.0)后写 components.0 → 越界拒')
    // addFocus 去重:同 path 更新 label(不新增)
    mw.addFocus({ path: 'components.2', label: '新标签' })
    assert(mw.getFocuses().length === 1, '✓ multi-focus addFocus 同 path → 去重更新(不新增)')
    assert(mw.getFocuses()[0].label === '新标签', '✓ multi-focus addFocus 同 path → 更新 label')
  }
}
