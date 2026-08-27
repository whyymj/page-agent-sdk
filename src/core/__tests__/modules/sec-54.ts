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
    // focus-intent-steering(2026-08-25 实测事故:「增加tab」被误解为新建组件,用户意图=聚焦 tabs 加页签)
    assert(prompt.includes('优先理解为对聚焦组件本身的改动'), 'focus 聚焦 → 目标提示含创建类指令归属引导(增加/修改 X 默认改聚焦组件本身)')
    // 指代锚定(2026-08-26 实测事故:点选深层组件后问「这是啥」→ 答了整页概况,旧段全是写向话术)
    assert(prompt.includes('所指默认是聚焦目标'), 'focus 聚焦 → 目标提示含指示代词问句锚定(「这是啥/这个」默认指聚焦组件,先 read 再答勿泛答整页)')

    // clearFocus → 不再注入
    mw.clearFocus()
    assert(mw.augmentPrompt!({} as any) === undefined, 'focus clearFocus → augmentPrompt 不再注入')
    assert(mw.getFocus() === undefined, 'focus clearFocus → getFocus undefined')

    // ===== focus-scoped-read:read 空参 → 注入焦点路径 + 教学行(用户反馈驱动,openspec 2026-08-16)=====
    {
      mw.setFocus({ path: 'components.1' })  // augmentPrompt 段末已 clearFocus,本段自设焦距
      const seen: any[] = []
      const recordNext = async (c: any) => { seen.push(JSON.parse(JSON.stringify(c.args ?? {}))); return { content: '多路径读取(共 1 项,hash=abc)\n- components.1 = {...}', status: 'done' as const } }
      // 空参 read → jsonPaths 注入 + 教学行前缀
      const r1 = await mw.wrapToolCall!({ name: 'read', args: {} } as any, recordNext)
      assert(Array.isArray(seen[0].jsonPaths) && seen[0].jsonPaths.join() === 'components.1', 'focus-scoped-read: read 空参 → next 收到注入 jsonPaths=[焦点路径]')
      assert(r1.content.startsWith('【聚焦模式】'), 'focus-scoped-read: 结果前置教学行')
      assert(r1.content.includes('全量主数据'), 'focus-scoped-read: 教学行含「显式列顶层键取全量」指引')
      // 多焦点 → 全含
      mw.addFocus({ path: 'title' })
      seen.length = 0
      await mw.wrapToolCall!({ name: 'read', args: {} } as any, recordNext)
      assert(seen[0].jsonPaths.join(',') === 'components.1,title', 'focus-scoped-read: 多焦点 → jsonPaths 全含')
      // 显式 jsonPath → 不改写(读自由保留)
      seen.length = 0
      await mw.wrapToolCall!({ name: 'read', args: { jsonPath: 'components.0' } } as any, recordNext)
      assert(seen[0].jsonPath === 'components.0' && seen[0].jsonPaths === undefined, 'focus-scoped-read: 显式 jsonPath 读不改写(读不限制设计保留)')
      // 仅带 fields(路径空)→ 同样注入
      seen.length = 0
      await mw.wrapToolCall!({ name: 'read', args: { fields: ['title'] } } as any, recordNext)
      assert(Array.isArray(seen[0].jsonPaths), 'focus-scoped-read: 仅带 fields 的空参同样注入')
      // 提示层同步一句
      const p2 = mw.augmentPrompt!({} as any)!
      assert(p2.includes('read 不带路径时默认只返回聚焦子树'), 'focus-scoped-read: augmentPrompt 提示层与工具行为一致')
      // 无焦点 → 零变化(不注入不教学)
      mw.clearFocus()
      seen.length = 0
      const r5 = await mw.wrapToolCall!({ name: 'read', args: {} } as any, recordNext)
      assert(!seen[0].jsonPaths && !r5.content.includes('【聚焦模式】'), 'focus-scoped-read: 无聚焦 → 原样透传(默认行为零变化)')
      // 恢复聚焦供后续既有断言使用
      mw.setFocus({ path: 'components.1' })
    }

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
      { name: 'write', args: { patch: { jsonPath: 'components.1', op: 'set', value: {} } } } as any,
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
    // 正路出口优先(focus-intent-steering):被拦先引「改写焦点子路径」(带实际焦点路径示例),解焦出口列后
    assert(outside.content.includes('请改写焦点路径的子路径重试(如 components.1.props.xxx)'), 'focus PATH_DENIED → 文案先给子路径正路出口(示例 = 实际焦点路径)')
    assert(outside.content.indexOf('子路径重试') < outside.content.indexOf('remove_focus'), 'focus PATH_DENIED → 子路径出口排在解焦出口之前(正路优先)')

    // 前缀边界:components.10 不误匹配 components.1(用 . 分隔判,非 startsWith 裸前缀)
    const idx10 = await mw.wrapToolCall!(
      { name: 'write', args: { patch: { jsonPath: 'components.10.props.title', op: 'set', value: 'x' } } } as any,
      callNext,
    )
    assert(idx10.status === 'error', 'focus 前缀边界:components.10 不误匹配 components.1 → 拒绝')

    // 非焦点顶层字段(title)→ 越界拒绝
    const topField = await mw.wrapToolCall!(
      { name: 'write', args: { patch: { jsonPath: 'title', op: 'set', value: 'x' } } } as any,
      callNext,
    )
    assert(topField.status === 'error', 'focus 写非焦点顶层字段(title)→ 拒绝')

    // 整体写(无 jsonPath)→ PATH_DENIED(P1-22 fix-authorization-surface:strict 下整体写无法校验子树归属 = 越界)
    const whole = await mw.wrapToolCall!({ name: 'write', args: { value: { title: 'x' } } } as any, callNext)
    assert(whole.status === 'error' && whole.content.includes('PATH_DENIED'), 'focus 整体写(无 jsonPath)→ PATH_DENIED(P1-22)')
    const wholeDraft = await mw.wrapToolCall!({ name: 'draft_commit', args: { draftId: 'd1' } } as any, callNext)
    assert(wholeDraft.status === 'error', 'focus draft_commit(整体写)→ PATH_DENIED(P1-22)')
    const mergeNoPath = await mw.wrapToolCall!({ name: 'write', args: { patch: { op: 'merge', value: { title: 'x' } } } } as any, callNext)
    assert(mergeNoPath.status === 'error', 'focus write patch 无 jsonPath(merge 改根)→ PATH_DENIED(P1-22)')

    // eval_script(P1-21):transform 整体(无 jsonPath)→ 拒;transform 子树内 → 放行;子树外 → 拒;query 只读 → 放行
    const evalWhole = await mw.wrapToolCall!({ name: 'eval_script', args: { script: 'return data', mode: 'transform' } } as any, callNext)
    assert(evalWhole.status === 'error' && evalWhole.content.includes('PATH_DENIED'), 'focus eval_script transform 整体(无 jsonPath)→ PATH_DENIED(P1-21)')
    const evalUnder = await mw.wrapToolCall!({ name: 'eval_script', args: { script: 'return data', mode: 'transform', jsonPath: 'components.1.props' } } as any, callNext)
    assert(evalUnder.status === 'done', 'focus eval_script transform 焦点子树内(jsonPath)→ 放行(P1-21)')
    const evalOutside = await mw.wrapToolCall!({ name: 'eval_script', args: { script: 'return data', mode: 'transform', jsonPath: 'components.0' } } as any, callNext)
    assert(evalOutside.status === 'error', 'focus eval_script transform 焦点外 → PATH_DENIED(P1-21)')
    const evalQuery = await mw.wrapToolCall!({ name: 'eval_script', args: { script: 'return data.title', mode: 'query' } } as any, callNext)
    assert(evalQuery.status === 'done', 'focus eval_script query(只读)→ 放行(P1-21)')
    const evalDefaultMode = await mw.wrapToolCall!({ name: 'eval_script', args: { script: 'return 1' } } as any, callNext)
    assert(evalDefaultMode.status === 'done', 'focus eval_script 缺省 mode(query)→ 放行')

    // vfs 工具移出拦截面(P1-21/22 附带):vfs path 是工作区文件路径非数据 jsonPath,聚焦下不再误拦
    const vfsW = await mw.wrapToolCall!({ name: 'vfs_write', args: { path: 'html/my-comp.html', content: '<template/>' } } as any, callNext)
    assert(vfsW.status === 'done', 'focus vfs_write(工作区文件)→ 不拦(vfs path 非数据 scope)')
    const vfsE = await mw.wrapToolCall!({ name: 'vfs_edit', args: { path: 'html/my-comp.html', oldString: 'a', newString: 'b' } } as any, callNext)
    assert(vfsE.status === 'done', 'focus vfs_edit(工作区文件)→ 不拦')

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

  // ===== 尾部追加放行(focus 模式下新建组件不破坏焦点子树):getBind 判数组长度 =====
  {
    const schema = z.object({ components: z.array(z.object({ type: z.string() })) })
    const bind = { components: [{ type: 'a' }, { type: 'b' }] }  // 长度 2
    const mw = createFocusMiddleware({ getSchema: () => schema, getBind: () => bind })
    mw.setFocus({ path: 'components.0' })  // 聚焦第 0 个
    const callNext = async () => ({ content: 'ok', status: 'done' as const })

    // 尾部追加 components.2(N=2 >= 长度 2)→ 放行(新建不影响焦点子树)
    const append = await mw.wrapToolCall!({ name: 'write', args: { patch: { jsonPath: 'components.2', op: 'set', value: { type: 'c' } } } } as any, callNext)
    assert(append.status === 'done', '✓ focus 尾部追加:write components.2(N>=数组长度)→ 放行(聚焦模式可新建组件)')
    // 非尾部越界 components.1(N=1<2,且非焦点)→ PATH_DENIED
    const middle = await mw.wrapToolCall!({ name: 'write', args: { patch: { jsonPath: 'components.1', op: 'set', value: { type: 'x' } } } } as any, callNext)
    assert(middle.status === 'error' && middle.content.includes('PATH_DENIED'), '✓ focus 非尾部越界:write components.1(N<长度且非焦点)→ PATH_DENIED')
    // patches 混合:焦点根 components.0 + 尾部 components.2 → 全放行
    const mixed = await mw.wrapToolCall!({ name: 'write', args: { patches: [{ op: 'set', jsonPath: 'components.0', value: { type: 'a' } }, { op: 'set', jsonPath: 'components.2', value: { type: 'c' } }] } } as any, callNext)
    assert(mixed.status === 'done', '✓ focus patches 混合:焦点根 + 尾部追加 → 全放行')
    // 无 getBind → 尾部追加不识别(向后兼容:旧集成不传 getBind,行为不变,仍按越界拒)
    const mwNoBind = createFocusMiddleware({ getSchema: () => schema })
    mwNoBind.setFocus({ path: 'components.0' })
    const noBind = await mwNoBind.wrapToolCall!({ name: 'write', args: { patch: { jsonPath: 'components.2', op: 'set', value: { type: 'c' } } } } as any, callNext)
    assert(noBind.status === 'error', '✓ focus 无 getBind → 尾部追加不识别(向后兼容,旧集成行为不变)')
  }

  // ===== unfocusGuidance 解焦指引(关 focus 能力场景无 focus 工具,文案不得引导调用不存在的工具;用户实测 page-demo)=====
  {
    const schema = z.object({ components: z.array(z.object({ type: z.string() })) })
    const callNext = async () => ({ content: 'ok', status: 'done' as const })

    // ① 默认 'tool':现行为零回归 —— 引导 remove_focus/clear_focus + 默认目标引导
    const mwTool = createFocusMiddleware({ getSchema: () => schema })
    mwTool.setFocus({ path: 'components.1' })
    const pTool = mwTool.augmentPrompt!({} as any)!
    assert(pTool.includes('clear_focus'), '✓ unfocusGuidance 默认 tool → 注入仍引导 clear_focus(现行为零回归)')
    assert(pTool.includes('默认作用于聚焦组件'), '✓ 默认目标引导:用户未指明目标的指令默认作用于聚焦组件(治实测「拾取按钮后说文字红色 → agent 误解为全页改」)')

    // ② 'ask-user'(无 focus 工具场景,如 capabilities.focus:false 的集成):不提工具,引导提示用户移除输入框 chip
    const mwAsk = createFocusMiddleware({ getSchema: () => schema, unfocusGuidance: 'ask-user' })
    mwAsk.setFocus({ path: 'components.1' })
    const pAsk = mwAsk.augmentPrompt!({} as any)!
    assert(!pAsk.includes('clear_focus') && !pAsk.includes('remove_focus'), '✓ unfocusGuidance ask-user → 注入不引导 focus 工具(agent 无此工具,防声称清除却做不到)')
    assert(pAsk.includes('输入框'), '✓ unfocusGuidance ask-user → 引导提示用户在输入框移除聚焦')
    const dAsk = await mwAsk.wrapToolCall!({ name: 'write', args: { patch: { jsonPath: 'components.0', op: 'set', value: { type: 'x' } } } } as any, callNext)
    assert(dAsk.status === 'error' && dAsk.content.includes('PATH_DENIED') && !dAsk.content.includes('clear_focus'), '✓ unfocusGuidance ask-user → PATH_DENIED 文案不提 focus 工具')

    // ③ 'report-parent'(子 agent 继承焦点):引导收口回复反馈
    const mwRp = createFocusMiddleware({ getSchema: () => schema, initialFocuses: [{ path: 'components.1' }], unfocusGuidance: 'report-parent' })
    const pRp = mwRp.augmentPrompt!({} as any)!
    assert(!pRp.includes('clear_focus') && pRp.includes('收口回复'), '✓ unfocusGuidance report-parent(子 agent)→ 引导收口反馈,不引导工具')
    const dRp = await mwRp.wrapToolCall!({ name: 'write', args: { patch: { jsonPath: 'components.0', op: 'set', value: { type: 'x' } } } } as any, callNext)
    assert(dRp.status === 'error' && dRp.content.includes('收口回复'), '✓ unfocusGuidance report-parent → PATH_DENIED 文案引导收口反馈')
  }

  // ===== invoke-freeze:宿主 mid-run 改焦点不作用于在途流程,下一次输入才生效(2026-08-26 实测事故)=====
  // 事故形态:用户发「随机打乱页面结构」→ 方案确认挂起窗口里点选深层组件(setFocus mid-run 到达)
  // → 在途 eval_script 整页操作被 mid-run 焦点 PATH_DENIED 掐住,被迫 clear_focus 绕路
  {
    const schema = z.object({ components: z.array(z.object({ type: z.string() })) })
    const mw = createFocusMiddleware({ getSchema: () => schema })
    const callNext = async () => ({ content: 'ok', status: 'done' as const })
    const writeOutside = () => mw.wrapToolCall!({ name: 'write', args: { patch: { jsonPath: 'components.0', op: 'set', value: { type: 'x' } } } } as any, callNext)

    // invoke 1 启动(快照:无焦点)
    mw.beforeAgent!({} as any)
    assert(mw.isInvokeActive() === true, '✓ invoke-freeze: beforeAgent 后 isInvokeActive true')
    // 宿主 mid-run setFocus(默认 host 来源)→ 实时态更新(UI chip 可见),在途快照冻结
    mw.setFocus({ path: 'components.1' })
    assert(mw.getFocuses().length === 1, '✓ invoke-freeze: 宿主 mid-run setFocus → 实时态已见(UI 同步)')
    const r1 = await writeOutside()
    assert(r1.status === 'done', '✓ invoke-freeze: 宿主 mid-run 焦点不掐在途写(快照无焦点 → 放行,下一次输入才生效)')
    assert(mw.augmentPrompt!({} as any) === undefined, '✓ invoke-freeze: 在途 augmentPrompt 不注入 mid-run 焦点(prompt 与 guard 口径一致)')
    // invoke 1 结束 → 快照释放
    mw.afterAgent!({} as any)
    assert(mw.isInvokeActive() === false, '✓ invoke-freeze: afterAgent 后 isInvokeActive false')

    // invoke 2:beforeAgent 重取快照 → 上一 invoke 期间宿主设的焦点自此生效
    mw.beforeAgent!({} as any)
    const r2 = await writeOutside()
    assert(r2.status === 'error' && String(r2.content).includes('PATH_DENIED'), '✓ invoke-freeze: 下一次输入焦点生效(焦点外写被拒)')
    const p2 = mw.augmentPrompt!({} as any)!
    assert(p2.includes('components.1'), '✓ invoke-freeze: 下一次输入 augmentPrompt 注入焦点段')

    // agent 侧来源('agent')立即生效:mid-run set_focus → 在途快照同步收紧
    mw.setFocus(null, 'agent')
    assert(mw.isInvokeActive() === true && (await writeOutside()).status === 'done', '✓ invoke-freeze: agent clear(清焦)立即生效(在途快照同步)')
    mw.setFocus({ path: 'components.1' }, 'agent')
    const r3 = await writeOutside()
    assert(r3.status === 'error', '✓ invoke-freeze: agent mid-run set_focus 立即生效(clear_focus 自救等依赖立即性)')

    // reset(会话边界):实时态 + 在途快照全清
    mw.reset()
    assert(mw.isInvokeActive() === false && mw.getFocuses().length === 0, '✓ invoke-freeze: reset 清实时态与快照')
  }

  // ===== team-audit P1#5:getActiveFocuses(生效快照)暴露 —— 委派继承读冻结口径,其余消费面保持实时态 =====
  {
    const mw = createFocusMiddleware({ getSchema: () => null })
    mw.setFocus({ path: 'components.0' }, 'host')
    // 进 invoke(beforeAgent 取快照)
    ;(mw.beforeAgent as () => unknown)()
    // 宿主 mid-run 变更:实时态变,生效快照冻结(getFocuses/getActiveFocuses 一测双通道,锁「其余消费面实时态」红线)
    mw.setFocus({ path: 'components.9' }, 'host')
    assert(mw.getFocuses()[0]?.path === 'components.9', '✓ P1#5 getFocuses 保持实时态(UI chip/persist/inspect/宿主 API 消费面不变)')
    assert(typeof mw.getActiveFocuses === 'function' && mw.getActiveFocuses()[0]?.path === 'components.0',
      '✓ P1#5 getActiveFocuses 返回生效快照(委派继承用;修前:子继承读实时态 → 主/子写面口径不一致)')
    // 未进 invoke 时两者等价(零回归基线)
    ;(mw.afterAgent as () => unknown)()
    assert(mw.isInvokeActive() === false && mw.getActiveFocuses()[0]?.path === mw.getFocuses()[0]?.path,
      '✓ P1#5 invoke 间隙 getActiveFocuses === getFocuses(等价回退)')
    // agent 来源 mid-run 变更:快照同步(既有语义,委派继承同样感知 agent 主动决策)
    ;(mw.beforeAgent as () => unknown)()
    mw.setFocus({ path: 'components.5' }, 'agent')
    assert(mw.getActiveFocuses()[0]?.path === 'components.5' && mw.getFocuses()[0]?.path === 'components.5',
      '✓ P1#5 agent 来源 mid-run 变更:快照与实时态同步(委派继承与主写面一致)')
  }
}
