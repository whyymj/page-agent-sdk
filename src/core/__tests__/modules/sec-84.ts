import {
  extractExplicitPreference,
  looksLikePreferenceSignal,
  parsePreferenceJson,
  buildExtractPrompt,
  buildPreferencePrompt,
  createPreferencesMiddleware,
} from '../../harness/preferences'
import {
  createPreferenceStore,
  PREFERENCE_TOPICS,
  type PersistedPreference,
} from '../../backends/preferenceStore'
import { resolveCapabilities } from '../../capabilities'
import type { TestCtx } from './_ctx'

// 跨会话用户偏好记忆(preference-persistence;openspec 2026-08-16)
// 三层信号捕获(显式/模式词+LLM/行为推断不做,宁漏勿误)→ preferenceStore(同 topic 后说覆盖,FIFO)→ pin 段注入
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[用户偏好 · 捕获纯函数]')
  {
    // 强信号:显式命令句式命中,零 LLM 直接提取
    const a = extractExplicitPreference('记住:以后文案都要短')
    assert(a?.content === '以后文案都要短', '强信号「记住:」提取冒号后句子')
    assert(a?.topic === 'copy', '强信号 topic 关键词映射(文案 → copy)')
    const b = extractExplicitPreference('请记住别用紫色')
    assert(b?.content === '别用紫色' && b?.topic === 'color', '强信号「请记住别用紫色」→ content=别用紫色,topic=color')
    const c = extractExplicitPreference('今后别用紫色')
    assert(c?.content === '别用紫色', '强信号「今后…」句式提取')
    const d = extractExplicitPreference('以后都加圆角')
    assert(d?.content === '都加圆角' && d?.topic === 'layout', '强信号「以后都…」句式 + topic=layout(圆角)')
    // 强信号不命中:普通任务指令/空文本/超长
    assert(extractExplicitPreference('把这个 banner 改成红色') === undefined, '本轮任务指令非强信号(不提取)')
    assert(extractExplicitPreference('你好') === undefined, '问候非强信号')
    assert(extractExplicitPreference('记住:' + 'x'.repeat(600)) === undefined, '超长文本不当命令(弃)')

    // 中信号初筛:模式词松筛(真伪由 LLM 判)
    assert(looksLikePreferenceSignal('别用紫色,太艳了') === true, '中信号模式词命中(别用/太艳)')
    assert(looksLikePreferenceSignal('我不喜欢渐变背景') === true, '中信号「不喜欢」命中')
    assert(looksLikePreferenceSignal('把这个组件删掉') === false, '本轮指令无模式词 → 不触发初筛')
    assert(looksLikePreferenceSignal('你好') === false, '问候不触发初筛')

    // topic 枚举完备性
    assert(PREFERENCE_TOPICS.length === 6, 'topic 枚举 6 值(color/copy/layout/interaction/tech/other)')

    // 提炼 prompt 含核心判定指令
    const p = buildExtractPrompt('别用紫色')
    assert(p.includes('持久偏好') && p.includes('宁漏勿误'), '提炼 prompt 含判定指令 + 宁漏勿误锚')
    assert(p.includes('别用紫色'), '提炼 prompt 内嵌用户消息')

    // LLM 输出解析:容错围栏/非法/captured:false
    assert(parsePreferenceJson('{"captured":true,"content":"不用紫色,偏好低饱和","topic":"color"}')?.topic === 'color', '裸 JSON 解析')
    assert(parsePreferenceJson('```json\n{"captured":true,"content":"文案要短","topic":"copy"}\n```')?.content === '文案要短', '围栏 JSON 剥离解析')
    assert(parsePreferenceJson('前缀噪声 {"captured":true,"content":"文案要短","topic":"copy"} 后缀') != null, '截取首个 {} 段解析')
    assert(parsePreferenceJson('{"captured":false,"content":"","topic":"other"}') === undefined, 'captured:false → 不记(宁漏)')
    assert(parsePreferenceJson('not json') === undefined, '非法 JSON → undefined')
    assert(parsePreferenceJson('{"captured":true,"content":"ab","topic":"color"}') === undefined, 'content 过短(<3)→ 弃')
    assert(parsePreferenceJson('{"captured":true,"content":"内容足够长","topic":"非枚举"}')?.topic === 'other', '非枚举 topic → other 兜底')

    // 注入段拼接
    const pref = (topic: string, content: string): PersistedPreference => ({
      id: `t-${topic}`, content, topic: topic as PersistedPreference['topic'],
      sourceSessionId: 's1', sourceRound: 0, createdAt: 1, updatedAt: 1,
    })
    const seg = buildPreferencePrompt([pref('color', '不用紫色'), pref('copy', '文案要短')])
    assert(seg?.startsWith('## 用户偏好'), '注入段标题(## 用户偏好)')
    assert(seg?.includes('颜色:不用紫色') === true && seg?.includes('文案:文案要短') === true, '注入段含 topic 中文标签 + content')
    assert(buildPreferencePrompt([]) === undefined, '空偏好不注入段')
  }

  console.log('[用户偏好 · preferenceStore(memory 后端)]')
  {
    // memory 后端:无 IndexedDB 环境可测(node/浏览器一致)
    const store = createPreferenceStore({ backend: 'memory', id: 'test-agent' })
    const r1 = await store.ready
    assert(r1 === false, 'memory 后端 ready=false(非持久,契约同 skillStore)')
    // put 首条
    const p1 = await store.put({ content: '不用紫色', topic: 'color', sourceSessionId: 's1', sourceRound: 0 })
    assert(p1.id.startsWith('pref-') && p1.content === '不用紫色', 'put 返回完整条目(生成 id)')
    // 同 topic 后说覆盖(保 id)
    await store.put({ content: '可以用紫色了,但要低饱和', topic: 'color', sourceSessionId: 's2', sourceRound: 5 });
    const list1 = await store.list()
    assert(list1.length === 1, '同 topic 合并:不新增条目')
    assert(list1[0].id === p1.id && list1[0].content === '可以用紫色了,但要低饱和', '后说覆盖前说(保 id,刷 content)')
    assert(list1[0].sourceSessionId === 's1' && list1[0].updatedAt >= list1[0].createdAt, '合并保留首次来源溯源字段')
    // 不同 topic 并存
    await store.put({ content: '文案要短', topic: 'copy', sourceSessionId: 's1', sourceRound: 1 })
    assert((await store.list()).length === 2, '不同 topic 并存')
    // remove / clear
    assert((await store.remove(p1.id)) === true, 'remove 已存在 → true')
    assert((await store.remove(p1.id)) === false, 'remove 不存在 → false')
    await store.clear()
    assert((await store.list()).length === 0, 'clear 清空命名空间')
    // FIFO:超限删最旧
    const small = createPreferenceStore({ backend: 'memory', id: 'fifo-agent', maxEntries: 3 })
    for (let i = 0; i < 5; i++) {
      await small.put({ content: `p${i}`, topic: PREFERENCE_TOPICS[i], sourceSessionId: 's', sourceRound: i })
    }
    const fifoList = await small.list()
    assert(fifoList.length === 3, 'FIFO 上限 3:5 条 put 后余 3')
    assert(!fifoList.some((p) => p.content === 'p0' || p.content === 'p1'), 'FIFO 删最旧(p0/p1 被淘汰)')
    assert(fifoList.some((p) => p.content === 'p4'), '最新条目保留')
  }

  console.log('[用户偏好 · 中间件(捕获/注入/生命周期)]')
  {
    const store = createPreferenceStore({ backend: 'memory', id: 'mw-agent' })
    // 中信号 LLM 提炼通道 stub:captured:true 一次 + 失败一次
    let llmCalls = 0
    const llmInvoke = async (prompt: string): Promise<string> => {
      llmCalls++
      if (prompt.includes('太艳了')) return '{"captured":true,"content":"不用高饱和色,太艳","topic":"color"}'
      return '{"captured":false,"content":"","topic":"other"}'
    }
    const mw = createPreferencesMiddleware({ store, llmInvoke, getSessionId: () => 'sess-1' })
    await mw.preload()
    assert(mw.getPreferences().length === 0, 'preload 空 store → cache 空')

    // afterAgent:强信号 + 中信号(LLM 异步)同轮触发
    const msgs = [
      { role: 'user' as const, content: '记住:文案要短', timestamp: 1 },
      { role: 'assistant' as const, content: '好的', timestamp: 2 },
      { role: 'user' as const, content: '这个配色太艳了,别用紫色', timestamp: 3 },
    ]
    mw.afterAgent?.({ messages: msgs } as never)
    // 强信号同步进串行链;LLM 提炼异步 → 等 microtask 队列排空
    await new Promise((r) => setTimeout(r, 20))
    await new Promise((r) => setTimeout(r, 20))
    const prefs = mw.getPreferences()
    assert(prefs.some((p) => p.content === '文案要短' && p.topic === 'copy'), '强信号经 afterAgent 落库(explicit 路径)')
    assert(prefs.some((p) => p.content === '不用高饱和色,太艳' && p.topic === 'color'), '中信号经 LLM 提炼落库(llm 路径)')
    assert(llmCalls === 1, 'LLM 只对中信号消息调用(强信号零 LLM)')

    // 水位:同批消息重复 afterAgent 不重复捕获
    mw.afterAgent?.({ messages: [...msgs, { role: 'assistant' as const, content: 'done', timestamp: 4 }] } as never)
    await new Promise((r) => setTimeout(r, 20))
    assert(mw.getPreferences().length === 2, '消息水位推进:已扫消息不重复捕获')

    // 注入段:augmentPrompt 返回 pin 段
    const seg = mw.augmentPrompt?.({ messages: msgs } as never)
    assert(typeof seg === 'string' && seg.includes('## 用户偏好') && seg.includes('文案要短'), 'augmentPrompt 注入偏好 pin 段')

    // removePreference / clearPreferences 写穿透 cache
    const target = mw.getPreferences().find((p) => p.topic === 'copy')
    assert((await mw.removePreference(target!.id)) === true, 'removePreference 删除成功')
    assert(!mw.getPreferences().some((p) => p.id === target!.id), '删除后 cache 写穿透')
    await mw.clearPreferences()
    assert(mw.getPreferences().length === 0 && (await store.list()).length === 0, 'clearPreferences 清 cache + store')
    assert(mw.augmentPrompt?.({ messages: [] } as never) === undefined, '清空后不再注入段')

    // resetScanCursor:新会话消息从 0 起,重扫(偏好不清)
    const mw2 = createPreferencesMiddleware({ store, llmInvoke: async () => '{"captured":false,"content":"","topic":"other"}', getSessionId: () => 's2' })
    mw2.afterAgent?.({ messages: [{ role: 'user', content: '记住:布局要紧凑', timestamp: 1 }] } as never)
    await new Promise((r) => setTimeout(r, 20))
    assert(mw2.getPreferences().length === 1, '独立中间件实例捕获(布局要紧凑)')
    mw2.resetScanCursor()
    // resetScanCursor 后同消息重扫 → put 同 topic 幂等合并(不重复)
    mw2.afterAgent?.({ messages: [{ role: 'user', content: '记住:布局要紧凑', timestamp: 1 }] } as never)
    await new Promise((r) => setTimeout(r, 20))
    assert(mw2.getPreferences().length === 1, '重扫同 topic 幂等(合并不重复)')

    // 降级:llmInvoke 缺省 → 只强信号,中信号静默跳过
    const mw3 = createPreferencesMiddleware({ store: createPreferenceStore({ backend: 'memory', id: 'x3' }), getSessionId: () => 's3' })
    mw3.afterAgent?.({ messages: [{ role: 'user', content: '这个配色太艳了,别用紫色', timestamp: 1 }] } as never)
    await new Promise((r) => setTimeout(r, 20))
    assert(mw3.getPreferences().length === 0, '无 llmInvoke 降级:中信号不捕获(宁漏勿误)')

    // LLM 提炼抛错 → 静默不冒泡
    const dbgLogs: unknown[] = []
    const mw4 = createPreferencesMiddleware({
      store: createPreferenceStore({ backend: 'memory', id: 'x4' }),
      llmInvoke: async () => { throw new Error('boom') },
      getSessionId: () => 's4',
      onDebug: (d) => dbgLogs.push(d),
    })
    mw4.afterAgent?.({ messages: [{ role: 'user', content: '这个配色太艳了,别用紫色', timestamp: 1 }] } as never)
    await new Promise((r) => setTimeout(r, 20))
    assert(mw4.getPreferences().length === 0, '提炼抛错 → 不落库')
    assert(dbgLogs.some((d) => (d as { extractError?: string }).extractError), '提炼失败 debug 留痕(extractError)')
  }

  console.log('[用户偏好 · capabilities 开关]')
  {
    const caps = resolveCapabilities({})
    assert(caps.preferences === false, 'preferences 默认关(opt-in)')
    const capsOn = resolveCapabilities({ preferences: true })
    assert(capsOn.preferences === true, 'preferences:true → 开')
  }
}
