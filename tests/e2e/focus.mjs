// focus 上下文聚焦:setFocus/getFocus/clearFocus API + inspect().focus + set_focus/clear_focus 工具 + capabilities.focus
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:focus] 上下文聚焦 · setFocus/getFocus/clearFocus + inspect + 工具 + capabilities')
  const schema = z.object({
    title: z.string(),
    components: z.array(z.object({ type: z.string(), props: z.object({ title: z.string() }) })),
  })
  const bind = {
    title: '首页',
    components: [
      { type: 'nav', props: { title: '导航' } },
      { type: 'hero', props: { title: '主视觉' } },
    ],
  }

  // 基础:advanced + focus 默认开
  const sdk = createChatSdk({
    ui: false, id: 'e2e-focus', storage: 'memory', llm: FAKE_LLM,
    capabilities: MIN_CAPS, data: { schema, bind, description: '页面' }, toolMode: 'advanced',
  })
  await sdk.mount()

  // getFocus 初始 undefined
  assert(sdk.getFocus() === undefined, 'getFocus 初始 → undefined')
  assert(sdk.inspect().focus === undefined, 'inspect().focus 初始 → undefined')

  // setFocus 合法 path
  const ok = sdk.setFocus({ path: 'components.0', label: '导航栏' })
  assert(ok.ok === true, 'setFocus 合法 path(components.0)→ {ok:true}')
  assert(sdk.getFocus()?.path === 'components.0', 'setFocus 后 getFocus → path')
  assert(sdk.getFocus()?.label === '导航栏', 'setFocus 后 getFocus → label')
  assert(sdk.inspect().focus?.path === 'components.0', 'inspect().focus → 反映焦点')

  // setFocus 类型非法 path(顶层不存在字段)→ {ok:false},当前焦点不变
  const bad = sdk.setFocus({ path: 'nonexistent' })
  assert(bad.ok === false, 'setFocus 类型非法 path(nonexistent)→ {ok:false}')
  assert(!!bad.error, 'setFocus 类型非法 → error 字段有值')
  assert(sdk.getFocus()?.path === 'components.0', 'setFocus 类型非法 → 当前焦点不变')
  // 叶子 string 下取子路径 → 类型非法(拒绝)
  assert(sdk.setFocus({ path: 'title.sub' }).ok === false, 'setFocus 叶子(title)下取子路径 → {ok:false}')
  // 数组索引路径类型合法(getSchemaAtPath 取元素 schema,不校验索引范围)→ 可聚焦(类型校验非数据存在性)
  assert(sdk.setFocus({ path: 'components.5' }).ok === true, 'setFocus 数组索引(components.5)类型合法 → {ok:true}(类型校验非数据存在性)')

  // setFocus 空 path → {ok:false}
  assert(sdk.setFocus({ path: '' }).ok === false, 'setFocus 空 path → {ok:false}')

  // clearFocus
  sdk.clearFocus()
  assert(sdk.getFocus() === undefined, 'clearFocus → getFocus undefined')
  assert(sdk.inspect().focus === undefined, 'clearFocus → inspect().focus undefined')

  // multi-focus:addFocus 累积 + getFocuses + removeFocus(兼容:getFocus 返首个)
  assert(sdk.getFocuses().length === 0, 'multi-focus getFocuses 初始 → 空数组')
  sdk.addFocus({ path: 'components.0', label: '导航' })
  assert(sdk.getFocuses().length === 1, 'multi-focus addFocus → getFocuses 累积 1 个')
  sdk.addFocus({ path: 'components.1', label: '主视觉' })
  assert(sdk.getFocuses().length === 2, 'multi-focus addFocus 再加 → 2 个')
  assert(sdk.getFocus()?.path === 'components.0', 'multi-focus getFocus 兼容 → 返首个')
  assert(sdk.addFocus({ path: 'nope' }).ok === false, 'multi-focus addFocus 非法 path → {ok:false}')
  assert(sdk.getFocuses().length === 2, 'multi-focus addFocus 非法 → 焦点数不变')
  sdk.addFocus({ path: 'components.0', label: '新导航' })
  assert(sdk.getFocuses().length === 2 && sdk.getFocuses()[0].label === '新导航', 'multi-focus addFocus 同 path → 去重更新 label')
  assert(Array.isArray(sdk.inspect().focuses) && sdk.inspect().focuses.length === 2, 'multi-focus inspect().focuses → 数组 2 个')
  sdk.removeFocus('components.0')
  assert(sdk.getFocuses().length === 1 && sdk.getFocus()?.path === 'components.1', 'multi-focus removeFocus → 剩余 components.1')

  // advanced 工具含 set_focus/clear_focus(source=builtin)
  const tools = sdk.inspect().tools
  const sf = tools.find((t) => t.name === 'set_focus')
  const cf = tools.find((t) => t.name === 'clear_focus')
  assert(!!sf, 'advanced → tools 含 set_focus')
  assert(!!cf, 'advanced → tools 含 clear_focus')
  assert(sf?.source === 'builtin', 'set_focus → source=builtin')
  assert(cf?.source === 'builtin', 'clear_focus → source=builtin')
  const af = tools.find((t) => t.name === 'add_focus')
  const rf = tools.find((t) => t.name === 'remove_focus')
  assert(!!af && af.source === 'builtin', 'advanced → tools 含 add_focus(source=builtin)')
  assert(!!rf && rf.source === 'builtin', 'advanced → tools 含 remove_focus(source=builtin)')
  // middleware 含 focus
  assert(sdk.inspect().middleware.includes('focus'), 'inspect().middleware → 含 focus')
  sdk.unmount()

  // simple 模式:不含 set_focus/clear_focus(经 UI/宿主 API 触发),但 setFocus API 仍可用
  const sdkSimple = createChatSdk({
    ui: false, id: 'e2e-focus-simple', storage: 'memory', llm: FAKE_LLM,
    capabilities: MIN_CAPS, data: { schema, bind, description: '页面' }, toolMode: 'simple',
  })
  await sdkSimple.mount()
  const simpleTools = sdkSimple.inspect().tools.map((t) => t.name)
  assert(!simpleTools.includes('set_focus'), 'simple → tools 不含 set_focus(经 UI/宿主 API 触发)')
  assert(!simpleTools.includes('clear_focus'), 'simple → tools 不含 clear_focus')
  assert(sdkSimple.setFocus({ path: 'components.1' }).ok === true, 'simple setFocus API 仍可用(经 UI/宿主触发)')
  assert(sdkSimple.getFocus()?.path === 'components.1', 'simple setFocus → getFocus 反映焦点')
  sdkSimple.unmount()

  // capabilities.focus:false → setFocus no-op + 工具/中间件不装
  const sdkOff = createChatSdk({
    ui: false, id: 'e2e-focus-off', storage: 'memory', llm: FAKE_LLM,
    capabilities: { ...MIN_CAPS, focus: false }, data: { schema, bind, description: '页面' }, toolMode: 'advanced',
  })
  await sdkOff.mount()
  assert(sdkOff.setFocus({ path: 'components.0' }).ok === false, 'capabilities.focus:false → setFocus {ok:false}')
  assert(sdkOff.getFocus() === undefined, 'capabilities.focus:false → getFocus undefined')
  const offTools = sdkOff.inspect().tools.map((t) => t.name)
  assert(!offTools.includes('set_focus'), 'capabilities.focus:false → tools 不含 set_focus')
  assert(!sdkOff.inspect().middleware.includes('focus'), 'capabilities.focus:false → middleware 不含 focus')
  sdkOff.unmount()

  // 开放 schema(z.record,编辑器页面树集成形态)→ focus 可用(修前 getSchemaAtPath 对 record 恒 null → setFocus 恒拒)
  const sdkRec = createChatSdk({
    ui: false, id: 'e2e-focus-record', storage: false, llm: FAKE_LLM,
    capabilities: MIN_CAPS,
    data: {
      schema: z.record(z.string(), z.unknown()),
      bind: { id: 'root', child: [{ id: 'c1', props: { text: 'a' } }, { id: 'c2', child: [] }] },
      description: '页面树',
    },
  })
  await sdkRec.mount()
  assert(sdkRec.setFocus({ path: 'child.0', label: '组件 c1' }).ok === true, '✓ record 开放 schema setFocus(child.0)→ {ok:true}(开放 schema 聚焦可用)')
  assert(sdkRec.getFocus()?.path === 'child.0' && sdkRec.getFocus()?.label === '组件 c1', '✓ record setFocus → getFocus 反映 path+label')
  assert(sdkRec.setFocus({ path: 'child.1.child.0.props' }).ok === true, '✓ record 深层任意路径可聚焦(child.1.child.0.props)')
  assert(sdkRec.addFocus({ path: 'child.0' }).ok === true, '✓ record addFocus 合法路径 → {ok:true}')
  sdkRec.clearFocus()
  assert(sdkRec.getFocuses().length === 0, '✓ record clearFocus → 清空')
  sdkRec.unmount()

  console.log('[e2e:focus] 持久化 · switchSession 往返 + restore 失效丢弃 + setLlm 保留')
  const sdkP = createChatSdk({
    ui: false, id: 'e2e-focus-persist', storage: 'memory', llm: FAKE_LLM,
    capabilities: MIN_CAPS, data: { schema, bind, description: '页面' }, toolMode: 'advanced',
  })
  await sdkP.mount()
  const origId = sdkP.sessionId
  // setFocus + switchSession 往返:切走(persist)→ 新会话 reset → 切回(restore)
  sdkP.setFocus({ path: 'components.0', label: '导航' })
  await sdkP.switchSession()
  assert(sdkP.getFocus() === undefined, 'persist: switchSession 切到新会话 → focus reset(不污染)')
  await sdkP.switchSession(origId)
  assert(sdkP.getFocus()?.path === 'components.0' && sdkP.getFocus()?.label === '导航', 'persist: 切回原会话 → focus 还原(path+label)')
  assert(sdkP.inspect().focus?.path === 'components.0', 'persist: inspect().focus 反映还原的焦点')
  // clearFocus 往返:不持久化为焦点
  sdkP.clearFocus()
  await sdkP.switchSession()
  await sdkP.switchSession(origId)
  assert(sdkP.getFocus() === undefined, 'persist: clearFocus 后往返 → 不恢复(未持久化为焦点)')
  // restore 失效丢弃:setData 改 schema 使 path 失效 → 切回 restore 时丢弃(决策A)
  sdkP.setFocus({ path: 'components.1' })
  await sdkP.switchSession()
  sdkP.setData({ schema: z.object({ title: z.string() }), bind: { title: '新' }, description: '无 components' })
  await sdkP.switchSession(origId)
  assert(sdkP.getFocus() === undefined, 'persist: restore 时 path 失效(schema 变无 components)→ 丢弃(决策A)')
  // setLlm 后 focus 保留(setLlm 不碰 focusMw)
  sdkP.setData({ schema, bind, description: '页面' })
  sdkP.setFocus({ path: 'components.0' })
  try { sdkP.setLlm(FAKE_LLM) } catch {}
  assert(sdkP.getFocus()?.path === 'components.0', 'persist: setLlm 后 focus 保留(setLlm 不碰 focusMw)')
  // multi-focus 持久化:addFocus 累积 + switchSession 往返(focus kind 存数组,applySnapshot 归一化读)
  sdkP.addFocus({ path: 'components.1', label: '主视觉' })
  await sdkP.switchSession()
  await sdkP.switchSession(origId)
  assert(sdkP.getFocuses().length === 2, 'persist: multi-focus switchSession 往返 → focuses 数组还原 2 个')
  sdkP.unmount()

  console.log('[e2e:focus] focus_change 事件(所有 mutation 入口统一 emit;集成方/demo 同步本地焦点镜像)')
  {
    const events = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-focus-event', storage: false, llm: FAKE_LLM,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false, subagent: false },
      data: { schema, bind: { title: 't', components: [{ type: 'x' }] }, description: '页面' },
      onEvent: (e) => { if (e.type === 'focus_change') events.push(e) },
    })
    await sdk.mount()
    sdk.setFocus({ path: 'components.0', label: '导航' })
    sdk.addFocus({ path: 'title' })
    sdk.removeFocus('components.0')
    sdk.clearFocus()
    // 每个 mutation 都触发一次 focus_change(收敛在 focusMw 层:API/工具/chip/reset 全覆盖)
    assert(events.length === 4, `✓ focus_change 事件:setFocus/addFocus/removeFocus/clearFocus 各 emit 一次(共 ${events.length},预期 4)`)
    assert(events[0].focuses.length === 1 && events[0].focuses[0].path === 'components.0', '✓ setFocus → focuses=[components.0]')
    assert(events[1].focuses.length === 2, '✓ addFocus → focuses 累积到 2 个')
    assert(events[2].focuses.length === 1 && events[2].focuses[0].path === 'title', '✓ removeFocus → 移除 components.0 剩 title')
    assert(events[3].focuses.length === 0, '✓ clearFocus → focuses 清空')
    sdk.unmount()
  }

  console.log('[e2e:focus] resetSession/switchSession 清焦点 + infoTick bump(修:清空对话后输入框聚焦 chip 残留旧焦点)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-focus-reset', storage: 'memory', llm: FAKE_LLM,
      capabilities: MIN_CAPS, data: { schema, bind: { title: 't', components: [{ type: 'x' }] }, description: '页面' },
    })
    await sdk.mount()
    sdk.addFocus({ path: 'components.0', label: '按钮' })
    const tickBefore = sdk.infoTick.value
    sdk.resetSession()
    assert(sdk.getFocuses().length === 0, '✓ resetSession → 焦点清空(getFocuses 空,聚焦态不泄漏进新会话)')
    assert(sdk.infoTick.value > tickBefore, '✓ resetSession → infoTick bump(UI focuses chip computed 挂 infoTick,不 bump 则 chip 残留旧焦点)')
    // switchSession 同契约(切走 = 焦点重置)
    sdk.addFocus({ path: 'components.0' })
    const tick2 = sdk.infoTick.value
    await sdk.switchSession()
    assert(sdk.getFocuses().length === 0 && sdk.infoTick.value > tick2, '✓ switchSession → 焦点重置 + infoTick bump(同 resetSession 契约)')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
