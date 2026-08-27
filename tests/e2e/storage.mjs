// 存储:switchSession(开/未开/指定 id) / 后端 session/local / 对象配置 / shareContext 开/关
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, makeStore, z } from './_helpers.mjs'
import { stubModel } from './_stub-model.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:storage] 默认 memory 会话(3.9+:不传 storage = 纯内存多会话,false 显式关闭)')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-default-memory', llm: FAKE_LLM, capabilities: MIN_CAPS })  // ← 不传 storage
    await sdk.mount()
    assert(Array.isArray(await sdk.listSessions()), '✓ 默认(不传 storage)→ 内存会话就绪(listSessions 可用,多会话开箱即用)')
    assert((await sdk.listSessions()).length >= 1, '✓ 默认 → 当前会话已建(listSessions 含自身)')
    const nid = await sdk.switchSession()
    assert(typeof nid === 'string' && nid !== sdk.sessionId || nid === sdk.sessionId, '✓ 默认 → switchSession 可用(内存会话切换)')
    sdk.unmount()
  }

  console.log('[e2e:storage] switchSession:storage 未开启抛错 / 开启返回新 id')
  {
    const sdkNoStorage = createChatSdk({ ui: false, id: 'e2e-switch-nostore', storage: false, llm: FAKE_LLM, capabilities: MIN_CAPS })  // 3.9+ 默认 'memory',未开启需显式 false
    await sdkNoStorage.mount()
    let threw = false
    try { await sdkNoStorage.switchSession() } catch { threw = true }
    assert(threw, 'storage 未开启 → switchSession 抛错')
    sdkNoStorage.unmount()

    const sdk = createChatSdk({ ui: false, id: 'e2e-switch-ok', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    // P1-5:switchSession 重置 mission(workingMemory 同链路 reset,selftest sec-38 覆盖;防旧会话 goal/path·hash 污染新会话)
    sdk.setMission({ goal: '旧会话的目标锚点' })
    assert(sdk.inspect().mission?.goal === '旧会话的目标锚点', 'P1-5 前置:setMission 置 mission(有值)')
    const newId = await sdk.switchSession()
    assert(typeof newId === 'string' && newId.length > 0, 'storage 开启 → switchSession 返回新 id(string)')
    assert(sdk.inspect().mission === undefined, 'P1-5 switchSession → mission 重置为 undefined(防旧 goal 污染新会话)')
    const fixedId = await sdk.switchSession('my-session-123')
    assert(fixedId === 'my-session-123', 'switchSession(id) 返回该 id')
    sdk.unmount()
  }

  console.log('[e2e:storage] session-history:listSessions / deleteSession / sessionId(S2-S4)')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-history', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    const id1 = await sdk.switchSession()
    const id2 = await sdk.switchSession()
    // S2:listSessions 返回历史会话数组
    const sessions = await sdk.listSessions()
    assert(Array.isArray(sessions) && sessions.length >= 2, 'S2 listSessions → 历史会话数组(≥2,含已建会话)')
    assert(sessions.every((s) => 'sessionId' in s && 'lastAccessed' in s), 'S2 SessionMeta 含 sessionId/lastAccessed 字段')
    // S4:sessionId 反映当前(=== 最后 switchSession 返回值)
    assert(sdk.sessionId === id2, 'S4 sdk.sessionId === 当前会话(最后 switchSession 返回值)')
    assert(sdk.inspect().sessionId === id2, 'S4 inspect().sessionId 反映当前会话')
    // S3:deleteSession 删非当前会话 → 列表减 1
    const before = (await sdk.listSessions()).length
    await sdk.deleteSession(id1)
    assert((await sdk.listSessions()).length === before - 1, 'S3 deleteSession(非当前) → 历史列表减 1')
    // S3:删当前会话被拒(不抛,需先切走)
    let delCurThrew = false
    try { await sdk.deleteSession(sdk.sessionId) } catch { delCurThrew = true }
    assert(!delCurThrew, 'S3 deleteSession(当前会话) → 不抛(warn 忽略,需先 switchSession 切走)')
    // Phase 6:sdk.sessions 响应式(switchSession/deleteSession 后自动 refresh,无需手动 listSessions/hook)
    assert(Array.isArray(sdk.sessions.value), 'Phase 6 sdk.sessions 是响应式 Ref<数组>')
    assert(sdk.sessions.value.length === (await sdk.listSessions()).length, 'Phase 6 sdk.sessions === listSessions(自动同步)')
    assert(sdk.sessions.value.some((s) => s.sessionId === sdk.sessionId), 'Phase 6 sdk.sessions 含当前会话(高亮依据)')
    // S2/S3 优雅降级:storage 未开启 → listSessions [] / deleteSession no-op
    const sdkNoStore = createChatSdk({ ui: false, id: 'e2e-history-nostore', storage: false, llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdkNoStore.mount()
    assert((await sdkNoStore.listSessions()).length === 0, 'S2 storage 未开启 → listSessions 返回 [](优雅降级)')
    let nsThrew = false
    try { await sdkNoStore.deleteSession('x') } catch { nsThrew = true }
    assert(!nsThrew, 'S3 storage 未开启 → deleteSession no-op 不抛')
    sdkNoStore.unmount()
    sdk.unmount()
  }

  console.log('[e2e:storage] Phase 6 sdk.sessions 边界:切回旧会话不重复 + deleteSession 自动 refresh')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-sessions-dedup', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    const id1 = await sdk.switchSession()
    const id2 = await sdk.switchSession()
    const lenAfterNew = sdk.sessions.value.length
    // 切回旧会话 id1 → sessions 不重复(只换 current,列表不变)
    await sdk.switchSession(id1)
    assert(sdk.sessions.value.length === lenAfterNew, 'Phase 6 切回旧会话 → sessions 不重复(列表不变,只换 current)')
    assert(sdk.sessionId === id1, 'Phase 6 切回后 sessionId === id1(当前会话切换)')
    // sessions 无重复 sessionId
    const sids = sdk.sessions.value.map((s) => s.sessionId)
    assert(new Set(sids).size === sids.length, 'Phase 6 sessions 无重复 sessionId')
    // deleteSession 后 sessions 自动 refresh(响应式,无需手动 listSessions)
    const lenBeforeDel = sdk.sessions.value.length
    await sdk.deleteSession(id2)
    assert(sdk.sessions.value.length === lenBeforeDel - 1, 'Phase 6 deleteSession 后 sessions 自动 refresh(响应式更新)')
    sdk.unmount()
  }

  console.log('[e2e:storage] context-persist-resilience:mission 跨 switchSession 持久化往返')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-mission-persist', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    const idA = sdk.sessionId
    sdk.setMission({ goal: '会话A的目标锚点', acceptanceCriteria: ['改完首页'] })
    assert(sdk.inspect().mission?.goal === '会话A的目标锚点', '功能A 前置:setMission 置 mission(有值)')
    await sdk.switchSession() // 切到新会话(切走前 persist A 的 mission —— persistRuntime 仅 afterRound 触发,setMission 后未发消息即切会话靠此补存)
    assert(sdk.inspect().mission === undefined, '功能A 切到新会话 → mission 空(新会话无持久化目标)')
    await sdk.switchSession(idA) // 切回 A
    assert(sdk.inspect().mission?.goal === '会话A的目标锚点', '功能A 切回 A → mission 恢复(持久化往返:setMission 后切走不丢)')
    assert(sdk.inspect().mission?.acceptanceCriteria?.[0] === '改完首页', '功能A 切回 → mission 字段完整(criteria 恢复)')
    sdk.unmount()
  }

  console.log('[e2e:storage] 后端:session/local stub mount 成功')
  {
    if (!globalThis.sessionStorage) globalThis.sessionStorage = makeStore()
    if (!globalThis.localStorage) globalThis.localStorage = makeStore()
    for (const backend of ['session', 'local']) {
      const sdk = createChatSdk({ ui: false, id: `e2e-store-${backend}`, storage: backend, llm: FAKE_LLM, capabilities: MIN_CAPS })
      await sdk.mount()
      assert(sdk.inspect().id === `e2e-store-${backend}`, `storage:${backend} → mount 成功`)
      sdk.unmount()
    }
  }

  console.log('[e2e:storage] storage 配置对象形式:{ backend, maxBytes }')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-storage-obj', storage: { backend: 'memory', maxBytes: 1 * 1024 * 1024 }, llm: FAKE_LLM, capabilities: MIN_CAPS,
    })
    await sdk.mount()
    assert(sdk.inspect().id === 'e2e-storage-obj', 'storage 对象配置 {backend,maxBytes} → mount 成功')
    sdk.unmount()
  }

  console.log('[e2e:storage] 自定义后端实例(storage:{backend: StorageBackend},服务端持久化注入点)')
  {
    // Map 版 StorageBackend:模拟「REST API 后端」(get/set/del/scan/clearPrefix 五方法),记录调用
    const map = new Map()
    const calls = { set: 0, get: 0, scan: 0 }
    const customBackend = {
      async get(key) { calls.get++; return map.get(key) },
      async set(key, value) { calls.set++; map.set(key, value) },
      async del(key) { map.delete(key) },
      async scan(prefix, cb) { calls.scan++; for (const [k, v] of map) if (k.startsWith(prefix)) { if (cb(k, v) === false) break } },
      async clearPrefix(prefix) { for (const k of map) if (k.startsWith(prefix)) map.delete(k) },
    }
    const sdk = createChatSdk({ ui: false, id: 'e2e-custom-backend', storage: { backend: customBackend, maxBytes: Infinity }, llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    assert(sdk.inspect().id === 'e2e-custom-backend', '自定义后端实例 → mount 成功(ready 直达,不走内置后端)')
    sdk.setMission({ goal: '自定义后端会话的目标' })
    const idA = sdk.sessionId
    await sdk.switchSession()
    assert(sdk.inspect().mission === undefined, '自定义后端 → 切新会话 mission 空')
    assert(calls.set > 0, '自定义后端 set 被调用(写入走了注入实例)')
    await sdk.switchSession(idA)
    assert(sdk.inspect().mission?.goal === '自定义后端会话的目标', '自定义后端 → 切回原会话 mission 恢复(往返经注入实例)')
    const sessions = await sdk.listSessions()
    assert(Array.isArray(sessions) && sessions.length >= 2, '自定义后端 listSessions ≥2(scan 走注入实例)')
    assert(calls.scan > 0, '自定义后端 scan 被调用(listSessions 经 scan)')
    sdk.unmount()
  }

  console.log('[e2e:storage] 自定义后端 set 抛错 → flush 吞错不炸(flush 超时/失败既有语义)')
  {
    const badBackend = {
      async get() { return undefined },
      async set() { throw new Error('server 500') },
      async del() {},
      async scan() {},
      async clearPrefix() {},
    }
    const sdk = createChatSdk({ ui: false, id: 'e2e-bad-backend', storage: { backend: badBackend, maxBytes: Infinity }, llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    let threw = false
    try {
      sdk.setMission({ goal: '会失败落盘的目标' })
      await sdk.switchSession() // 切会话触发 flush → set 抛错 → PERSIST_FLUSH_FAILED 留痕放行,不 reject
      await new Promise((r) => setTimeout(r, 100)) // debounce 落定
    } catch { threw = true }
    assert(!threw, '后端 set 抛错 → switchSession 不 reject(落盘失败吞错放行,交后续 flush 兜底)')
    sdk.unmount()
  }

  console.log('[e2e:storage] shareContext:true 同 id 两实例共享 messages 数组')
  {
    const sdkA = createChatSdk({ ui: false, id: 'e2e-share', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS, shareContext: true })
    await sdkA.mount()
    const sdkB = createChatSdk({ ui: false, id: 'e2e-share', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS, shareContext: true })
    await sdkB.mount()
    assert(sdkA.messages === sdkB.messages, 'shareContext:true 同 id → 两实例 messages 为同一数组引用')
    sdkA.unmount()
    sdkB.unmount()
  }

  console.log('[e2e:storage] shareContext:false(默认)两实例 messages 独立')
  {
    const sdkA = createChatSdk({ ui: false, id: 'e2e-noshare', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdkA.mount()
    const sdkB = createChatSdk({ ui: false, id: 'e2e-noshare', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdkB.mount()
    assert(sdkA.messages !== sdkB.messages, 'shareContext:false(默认) → 两实例 messages 独立(不同引用)')
    sdkA.unmount()
    sdkB.unmount()
  }

  // ===== RE 修复回归:deferred 登记的「fire-and-forget 持久化无 .catch」+「autoTitle 无 unmount 守卫」=====
  // 修前:`void store.save/updateTitle(...)` 拒绝无人接 → unhandledRejection(browser 实测:IDB 连接关闭 InvalidStateError);
  // autoTitle LLM 在途 unmount → 迟到写已 dispose 的 store / 切会话后写错会话。修后:persistSave/persistUpdateTitle
  // 统一吞错出口 + 迟到守卫(refCount>0 && sessionId 未变)。
  console.log('[e2e:storage] persistSave 吞错:local setItem 抛错(配额满模拟)→ 零 unhandledRejection + 对话不受影响')
  {
    const { StubChatModel } = await import('./_stub-model.mjs')
    const unhandled = []
    const onUnhandled = (r) => unhandled.push(String(r))
    process.on('unhandledRejection', onUnhandled)
    const m = new Map()
    let failNow = false
    globalThis.localStorage = {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { if (failNow) throw new Error('QuotaExceededError (test)'); m.set(k, String(v)) },
      removeItem: (k) => m.delete(k),
      key: (i) => Array.from(m.keys())[i] ?? null,
      get length() { return m.size },
      clear: () => m.clear(),
    }
    const model = new StubChatModel([{ text: '第一轮回复' }])
    const sdk = createChatSdk({ ui: false, id: 'e2e-persist-swallow', storage: 'local', llm: model, capabilities: MIN_CAPS, autoTitle: false })
    await sdk.mount()
    failNow = true  // mount 完成后再失败:send 后 persistRuntime 全部 fire-and-forget save/updateTitle/refreshSessions 均走拒绝路径
    await sdk.send('你好')
    await new Promise((r) => setTimeout(r, 150))  // 等 fire-and-forget 微任务落定
    assert(unhandled.length === 0, '✓ persistSave 吞错:save/updateTitle/listSessions 拒绝 → 零 unhandledRejection(修前 void 裸奔)')
    assert(sdk.messages.some((x) => x.role === 'assistant' && x.content === '第一轮回复'), '✓ 持久化失败不影响对话流程(回复正常送达)')
    await sdk.unmount()
    process.off('unhandledRejection', onUnhandled)
    delete globalThis.localStorage
  }

  console.log('[e2e:storage] autoTitle 标题时序:LLM 标题落盘后 sessions 响应式列表即时可见(round2 A1)')
  {
    const { StubChatModel } = await import('./_stub-model.mjs')
    const m3 = new Map()
    globalThis.localStorage = {
      getItem: (k) => (m3.has(k) ? m3.get(k) : null),
      setItem: (k, v) => m3.set(k, String(v)),
      removeItem: (k) => m3.delete(k),
      key: (i) => Array.from(m3.keys())[i] ?? null,
      get length() { return m3.size },
      clear: () => m3.clear(),
    }
    const model3 = new StubChatModel([{ text: '第一轮完成' }, { text: '真LLM会话标题' }])
    const sdk3 = createChatSdk({ ui: false, id: 'e2e-autotitle-order', storage: 'local', llm: model3, capabilities: MIN_CAPS })
    await sdk3.mount()
    await sdk3.send('随便问点什么')
    // 标题 invoke 为 fire-and-forget 异步;轮询等响应式 sessions 出现 LLM 标题(修前:refreshSessions
    // 在 updateTitle 串行链落盘前 scan → 列表停留规则标题直到下次全量刷新)
    const deadline = Date.now() + 5000
    while (!(sdk3.sessions.value ?? []).some((x) => x.title === '真LLM会话标题') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
    assert((sdk3.sessions.value ?? []).some((x) => x.title === '真LLM会话标题'), '✓ A1 autoTitle 后 sessions 响应式列表即时显示 LLM 标题(写-读时序,修前显示旧规则标题)')
    sdk3.unmount()
    delete globalThis.localStorage
  }

  console.log('[e2e:storage] autoTitle 迟到守卫:标题 LLM 在途时 unmount → 放弃写入,零 unhandledRejection')
  {
    const { StubChatModel } = await import('./_stub-model.mjs')
    const unhandled = []
    const onUnhandled = (r) => unhandled.push(String(r))
    process.on('unhandledRejection', onUnhandled)
    const m2 = new Map()
    globalThis.localStorage = {
      getItem: (k) => (m2.has(k) ? m2.get(k) : null),
      setItem: (k, v) => m2.set(k, String(v)),
      removeItem: (k) => m2.delete(k),
      key: (i) => Array.from(m2.keys())[i] ?? null,
      get length() { return m2.size },
      clear: () => m2.clear(),
    }
    // 第 1 响应主轮回复;第 2 响应(delayMs 250)标题 invoke —— send 完成后 unmount,标题在途
    const model2 = new StubChatModel([{ text: '回复完成' }, { text: '迟到的LLM标题', delayMs: 250 }])
    const sdk2 = createChatSdk({ ui: false, id: 'e2e-autotitle-guard', storage: 'local', llm: model2, capabilities: MIN_CAPS })
    await sdk2.mount()
    await sdk2.send('守卫测试消息')
    await sdk2.unmount()  // 标题 invoke(250ms)在途时 release(refCount 0)
    await new Promise((r) => setTimeout(r, 500))  // 等迟到标题回来(守卫应跳过写入)
    assert(unhandled.length === 0, '✓ autoTitle 迟到守卫:unmount 后迟到标题写入放弃 → 零 unhandledRejection')
    assert(model2.calls === 2, '✓ 标题 LLM 调用确实发起过(守卫跳的是写入,不是没调用)')
    const allValues = Array.from(m2.values()).join('\n')
    assert(!allValues.includes('迟到的LLM标题'), '✓ 迟到标题未写入存储(保持规则 title 兜底,不覆盖已释放会话)')
    process.off('unhandledRejection', onUnhandled)
    delete globalThis.localStorage
  }

  console.log('[e2e:storage] team-audit P1#4 坏后端(get/scan 抛错)→ mount 成功 + SESSION_RESTORE_FAILED 留痕 + 降级空会话可用')
  {
    // 修前:resolveAndLoad 裸 await → load/listSessions reject → initDone reject → core.agent 永不构造,SDK 整体不可用
    // (doc/usage-guide「后端抛错不炸 SDK」承诺只覆盖写路径;内置 IDB QuotaExceeded 同炸)
    const errors = []
    const badBackend = {
      get: async () => { throw new Error('backend 500') },
      set: async () => { throw new Error('backend 500') },
      del: async () => { throw new Error('backend 500') },
      scan: async () => { throw new Error('backend 500') },
      clearPrefix: async () => { throw new Error('backend 500') },
    }
    const llm = stubModel({ text: 'ok' })
    const sdk = createChatSdk({
      ui: false, id: 'e2e-badbackend-mount', storage: { backend: badBackend }, llm, autoTitle: false,
      capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind: { title: 't' } },
      onEvent: (e) => { if (e.type === 'error' && e.code === 'SESSION_RESTORE_FAILED') errors.push(e) },
    })
    let mounted = true
    try { await sdk.mount() } catch { mounted = false } // 修前:此处 reject
    assert(mounted, '✓ P1#4 坏后端 mount 成功(修前:initDone reject,SDK 整体不可用)')
    assert(errors.length >= 1, `✓ P1#4 SESSION_RESTORE_FAILED observable 外发(修前:零可观察面;实际 ${errors.length} 条)`)
    // 降级空会话可用:send 正常收口(落盘失败走既有 flush 吞错语义)
    const reply = await sdk.send('hi')
    assert(typeof reply === 'string', '✓ P1#4 降级空会话 send 可用(恢复失败不炸运行面)')
    sdk.unmount()
  }

  console.log('[e2e:storage] team-audit P1#4 meta touch 后端炸(set 抛/get 正常)→ 快照读取不连坐')
  {
    // 两阶段录制式后端(key 格式全程经真实 encodeKey,不手拼):阶段1 正常跑出真实数据落 mem;
    // 阶段2 set 翻转为炸(QuotaExceeded 形态)→ 新实例恢复:load 的 lastAccessed 刷新失败不应连坐快照读取
    const mem = new Map()
    let setThrows = false
    const quotaBackend = {
      get: async (k) => mem.get(k),
      set: async (k, v) => { if (setThrows) throw new Error('QuotaExceededError'); mem.set(k, v) },
      del: async (k) => { mem.delete(k) },
      scan: async (prefix, cb) => { for (const [k, v] of mem) if (k.startsWith(prefix)) cb(k, v) },
      clearPrefix: async (prefix) => { for (const k of Array.from(mem.keys())) if (k.startsWith(prefix)) mem.delete(k) },
    }
    // 阶段1:正常落盘产生真实快照(同 id 固定 sessionId)
    const s1 = createChatSdk({
      ui: false, id: 'e2e-quota-mount', storage: { backend: quotaBackend }, llm: stubModel({ text: 'ok' }), autoTitle: false,
      session: { id: 's-meta' }, capabilities: MIN_CAPS,
    })
    await s1.mount()
    await s1.send('hi')
    await s1.unmount() // flush 落盘
    assert(mem.size >= 2, '前置:阶段1 真实数据已落 backend(meta + kinds)')
    // 阶段2:set 炸 → 恢复照常(get 正常读快照 + meta touch 吞错)
    setThrows = true
    const errors = []
    const sdk = createChatSdk({
      ui: false, id: 'e2e-quota-mount', storage: { backend: quotaBackend }, llm: stubModel({ text: 'ok' }), autoTitle: false,
      session: { id: 's-meta' }, capabilities: MIN_CAPS,
      onEvent: (e) => { if (e.type === 'error' && e.code === 'SESSION_RESTORE_FAILED') errors.push(e) },
    })
    let mounted = true
    try { await sdk.mount() } catch { mounted = false }
    assert(mounted, '✓ P1#4 meta touch 炸不连坐:mount 成功')
    assert(errors.length === 0, '✓ P1#4 meta touch 吞错不升级为 SESSION_RESTORE_FAILED(只在快照本体读取失败时外发)')
    assert(sdk.messages.some((m) => m.role === 'user' && m.content === 'hi'),
      '✓ P1#4 快照数据完整恢复(get 正常 + meta touch 吞错 → applySnapshot 照常灌入;修前:load 整体 reject → mount 炸)')
    sdk.unmount()
  }

  console.log('[e2e:storage] team-audit P1#7 quota 拒写留痕 + 显式 maxBytesPerSession 优先(Infinity 联动本体在 selftest sec-111 直测 store)')
  {
    // 11MB 全量走 agent 管线过重(tokenize/压缩估算逐字符)→ 本组用显式小上限 + 常规消息验证:
    // ① 显式 maxBytesPerSession 优先于 Infinity 联动(拒写)② quota 留痕进 debugLogs(去静默);
    // Infinity 关闭默认 10MB 上限 / 默认值零变化 两断言在 selftest 直测 store 层(等价且快)
    const mem = new Map()
    const backend = {
      get: async (k) => mem.get(k),
      set: async (k, v) => { mem.set(k, v) },
      del: async (k) => { mem.delete(k) },
      scan: async (prefix, cb) => { for (const [k, v] of mem) if (k.startsWith(prefix)) cb(k, v) },
      clearPrefix: async (prefix) => { for (const k of Array.from(mem.keys())) if (k.startsWith(prefix)) mem.delete(k) },
    }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-quota-logs', storage: { backend, maxBytes: Infinity, maxBytesPerSession: 128 },
      llm: stubModel({ text: '常规回复' }), autoTitle: false, capabilities: MIN_CAPS,
    })
    await sdk.mount()
    await sdk.send('hi')
    await sdk.unmount() // flush 落盘
    // messages kind 落盘值 = 数组本体(save 按 kind 拆包存)
    const msgs = [...mem.values()].find((v) => Array.isArray(v) && v.length > 0)
    assert(!msgs, '✓ P1#7 显式 maxBytesPerSession=128 优先(Infinity 联动不覆盖显式配置;超限拒写)')
    const quotaLogs = sdk.debugLogs.value.filter((l) => l?.data?.stage === 'storage_quota')
    assert(quotaLogs.length >= 1, `✓ P1#7 quota 拒写留痕进 debugLogs(修前:仅 debug 模式 console.log,零可观察面;实际 ${quotaLogs.length} 条)`)
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
