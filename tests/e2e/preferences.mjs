// 跨会话用户偏好记忆(preference-persistence):顶层 API + 强信号捕获落库 + 注入段 + capabilities 开关
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'
import { stubModel } from './_stub-model.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:preferences] 强信号捕获 → 落库 → 注入 pin 段 → API 三件套')
  {
    const llm = stubModel({ text: '好的,已记住。' }, { text: '明白。' })
    const sdk = createChatSdk({
      ui: false, id: 'e2e-prefs-on', storage: 'memory', llm,
      capabilities: { ...MIN_CAPS, preferences: true },
      preferenceStorage: { backend: 'memory', maxEntries: 5 },
      autoTitle: false, // 隔离:autoTitle 首轮后会用主 llm 追加一次标题调用,干扰 llm.calls 计数
    })
    await sdk.mount()
    assert(Array.isArray(sdk.getPreferences()) && sdk.getPreferences().length === 0, 'preferences 开启 + 空 store → getPreferences 恒数组')

    // 强信号(「记住:」)经 afterAgent 捕获,零 LLM(llm 只收到对话调用,提炼通道不触发)
    await sdk.send('记住:文案要短')
    await sleep(50) // putPreference 串行链异步落库
    const prefs1 = sdk.getPreferences()
    assert(prefs1.length === 1, '强信号 send 后捕获 1 条')
    assert(prefs1[0].content === '文案要短' && prefs1[0].topic === 'copy', '捕获内容 + topic(copy)')
    assert(llm.calls === 1, '强信号零额外 LLM 调用(stub 仅 1 次对话调用)')
    assert(typeof prefs1[0].id === 'string' && typeof prefs1[0].updatedAt === 'number', '条目含 id/updatedAt(完整形状)')

    // 下一轮 system prompt 注入「## 用户偏好」pin 段(跨轮生效)
    await sdk.send('帮我写个标题')
    assert(llm.systemPrompts.length >= 2, '两轮各有一次 model 调用')
    const lastSys = llm.systemPrompts[llm.systemPrompts.length - 1] ?? ''
    assert(lastSys.includes('## 用户偏好'), '下一轮 system prompt 注入「## 用户偏好」pin 段')
    assert(lastSys.includes('文案:文案要短'), 'pin 段含 topic 标签 + 偏好内容')

    // 同 topic 后说覆盖(改主意不并存)
    await sdk.send('记住:文案要详尽一点')
    await sleep(50)
    const prefs2 = sdk.getPreferences()
    assert(prefs2.length === 1 && prefs2[0].content === '文案要详尽一点', '同 topic 后说覆盖前说(不并存)')
    assert(prefs2[0].id === prefs1[0].id, '覆盖保留原 id(外部引用不漂移)')

    // removePreference:学错可删
    const ok = await sdk.removePreference(prefs2[0].id)
    assert(ok === true && sdk.getPreferences().length === 0, 'removePreference 删除成功 + cache 同步')
    assert((await sdk.removePreference('nonexistent')) === false, 'removePreference 不存在 → false')

    // clearPreferences:清空兜底
    await sdk.send('记住:布局要紧凑')
    await sleep(50)
    assert(sdk.getPreferences().length === 1, '再捕获一条(layout)')
    await sdk.clearPreferences()
    assert(sdk.getPreferences().length === 0, 'clearPreferences 清空全部')
    sdk.unmount()
  }

  console.log('[e2e:preferences] capabilities 默认关 → API 全降级 + 不注入')
  {
    const llm = stubModel({ text: 'ok' }, { text: 'ok2' })
    const sdk = createChatSdk({
      ui: false, id: 'e2e-prefs-off', storage: 'memory', llm,
      capabilities: { ...MIN_CAPS }, // 不传 preferences → 默认关
    })
    await sdk.mount()
    await sdk.send('记住:文案要短')
    await sleep(50)
    assert(sdk.getPreferences().length === 0, 'preferences 默认关 → 不捕获(getPreferences 恒 [])')
    assert((await sdk.removePreference('x')) === false, '关 → removePreference 恒 false')
    await sdk.clearPreferences() // no-op 不抛
    assert(llm.systemPrompts.every((s) => !s.includes('## 用户偏好')), '关 → system prompt 无偏好段')
    assert(sdk.inspect().preferences === undefined, '关 → inspect().preferences undefined')
    sdk.unmount()
  }

  console.log('[e2e:preferences] inspect().preferences 反射(DebugDrawer 只读视图数据源)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-prefs-inspect', storage: 'memory', llm: stubModel({ text: 'ok' }),
      capabilities: { ...MIN_CAPS, preferences: true },
      preferenceStorage: { backend: 'memory' },
    })
    await sdk.mount()
    await sdk.send('记住:别用紫色')
    await sleep(50)
    const info = sdk.inspect()
    assert(Array.isArray(info.preferences) && info.preferences.length === 1 && info.preferences[0].topic === 'color', 'inspect().preferences 返回条目快照(color)')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
