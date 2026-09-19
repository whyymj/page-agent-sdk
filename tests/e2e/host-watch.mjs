// auto-host-watch:hostWatch 声明式自动报案(node e2e:fake window 事件源注入)+ 服务端 no-op 反射
// 真浏览器事件流在 browser e2e(docs-demo spec);dom_edit S2 联动在 dom-edit.mjs 增段
import { setupEnv, createAssert, MIN_CAPS, createChatSdk, z, defineTool } from './_helpers.mjs'
import { StubChatModel } from './_stub-model.mjs'

const STALE_MARK = '⏱[过期快照]'

function toolContentsOf(messages, name) {
  const out = []
  let pending = []
  for (const m of messages) {
    const t = m?._getType?.() ?? (m?.getType?.() ?? 'unknown')
    if (t === 'ai' && Array.isArray(m.tool_calls)) pending = m.tool_calls.map((c) => c.name)
    else if (t === 'tool') { const n = pending.shift(); if (n === name) out.push(String(m.content ?? '')) }
  }
  return out
}

/** 可派发事件的假 window(hashchange/popstate)+ location */
function fakeWindow() {
  const listeners = new Map()
  return {
    location: { href: 'http://test/#/doc-a' },
    addEventListener(type, fn) { (listeners.get(type) ?? listeners.set(type, []).get(type)).push(fn) },
    removeEventListener(type, fn) { const l = listeners.get(type); if (l) listeners.set(type, l.filter((f) => f !== fn)) },
    dispatch(type) { for (const fn of listeners.get(type) ?? []) fn() },
  }
}

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx
  const realWindow = globalThis.window

  console.log('[e2e:host-watch] S1 全链:流内 hashchange → 自动报案 → 末轮请求页面读占位 + pin 段 + 留痕/反射')
  {
    const win = fakeWindow()
    globalThis.window = win
    try {
      const readPage = defineTool({ name: 'read_page', description: '读页面(桩)', schema: z.object({}), handler: async () => '笔记 A 正文…' })
      const navProbe = defineTool({
        name: 'nav_probe', description: '流内模拟宿主导航(测试用)', schema: z.object({}),
        handler: async () => {
          win.location.href = 'http://test/#/doc-b'
          win.dispatch('hashchange')
          await new Promise((r) => setTimeout(r, 10)) // 等去抖定时器(0ms 宏任务)落地:真浏览器 LLM 往返远大于去抖窗,无此竞速
          return 'ok'
        },
      })
      const model = new StubChatModel([
        { toolCalls: [{ name: 'read_page', args: {} }] },
        { toolCalls: [{ name: 'nav_probe', args: {} }] },
        { text: 'done' },
      ])
      const sdk = createChatSdk({
        ui: false, id: 'e2e-hostwatch-flow', storage: 'memory', llm: model,
        capabilities: MIN_CAPS, tools: [readPage, navProbe], autoTitle: false,
        hostWatch: { url: true, debounceMs: 0 },
      })
      await sdk.mount()
      await sdk.send('这篇讲了什么')
      const reads = toolContentsOf(model.lastMessages, 'read_page')
      assert(reads.length === 1 && reads[0].startsWith(STALE_MARK) && reads[0].includes('页面导航'),
        `自动报案 → 末轮请求 read_page 为占位(含自动生成的导航 reason),实际:${reads[0]?.slice(0, 60)}`)
      assert(model.systemPrompts.some((p) => p?.includes('【宿主页面已变更】')),
        '自动报案复用 S2 全链:pin 段注入(一次性重读提示)')
      const hw = sdk.inspect().hostWatch
      assert(hw && hw.enabled === true && hw.url === true && hw.autoNotified === 1,
        `inspect().hostWatch 反射 {enabled,url,autoNotified=1},实际 ${JSON.stringify(hw)}`)
      assert(!!sdk.debugLogs.value.find((l) => l.data?.stage === 'host_watch' && l.data?.kind === 'hash'), 'debugLogs 留痕 host_watch(kind=hash)')
      assert(!!sdk.debugLogs.value.find((l) => l.data?.stage === 'host_change_notified'), '自动报案转 notifyHostChange(留痕 host_change_notified)')
      sdk.unmount()
      // unmount 摘监听:再发事件零新增报案
      const before = sdk.debugLogs.value.filter((l) => l.data?.stage === 'host_watch').length
      win.location.href = 'http://test/#/doc-c'
      win.dispatch('hashchange')
      await new Promise((r) => setTimeout(r, 20))
      const after = sdk.debugLogs.value.filter((l) => l.data?.stage === 'host_watch').length
      assert(before === after, `unmount 摘监听:卸载后再发事件零报案(${before} → ${after})`)
    } finally {
      globalThis.window = realWindow
    }
  }

  console.log('[e2e:host-watch] 手动+自动双报共存(占位幂等不叠加)+ ignore 钩子')
  {
    const win = fakeWindow()
    globalThis.window = win
    try {
      const readPage = defineTool({ name: 'read_page', description: '读页面(桩)', schema: z.object({}), handler: async () => '正文' })
      const both = defineTool({
        name: 'both_probe', description: '流内同时手动通知与自动事件(测试用)', schema: z.object({}),
        handler: async () => {
          sdkRef.notifyHostChange({ reason: '手动报案' })
          win.location.href = 'http://test/#/x'
          win.dispatch('hashchange')
          await new Promise((r) => setTimeout(r, 10))
          return 'ok'
        },
      })
      const model = new StubChatModel([
        { toolCalls: [{ name: 'read_page', args: {} }] },
        { toolCalls: [{ name: 'both_probe', args: {} }] },
        { text: 'done' },
      ])
      const sdk = createChatSdk({
        ui: false, id: 'e2e-hostwatch-both', storage: 'memory', llm: model,
        capabilities: MIN_CAPS, tools: [readPage, both], autoTitle: false,
        hostWatch: { url: true, debounceMs: 0 },
      })
      const sdkRef = sdk
      await sdk.mount()
      await sdk.send('问')
      const reads = toolContentsOf(model.lastMessages, 'read_page')
      assert(reads.length === 1 && reads[0].startsWith(STALE_MARK) && reads[0].startsWith(STALE_MARK) && !reads[0].slice(STALE_MARK.length).startsWith(STALE_MARK),
        '手动+自动双报:占位幂等不叠加(单层过期章)')
      assert(sdk.inspect().hostWatch.autoNotified === 1, '自动报案计数与手动独立(autoNotified=1)')
      sdk.unmount()
    } finally {
      globalThis.window = realWindow
    }
  }

  console.log('[e2e:host-watch] 服务端形态:no-op window(无法派发)→ 装配反射仍可见;ignore 过滤零报案')
  {
    const win = fakeWindow()
    globalThis.window = win
    try {
      const model = new StubChatModel([{ text: 'done' }])
      const sdk = createChatSdk({
        ui: false, id: 'e2e-hostwatch-ignore', storage: 'memory', llm: model,
        capabilities: MIN_CAPS, autoTitle: false,
        hostWatch: { url: true, debounceMs: 0, ignore: (e) => e.kind === 'hash' },
      })
      await sdk.mount()
      win.location.href = 'http://test/#/y'
      win.dispatch('hashchange')
      await new Promise((r) => setTimeout(r, 20))
      assert(sdk.inspect().hostWatch.autoNotified === 0, 'ignore 命中 → 零报案(autoNotified=0)')
      assert(sdk.inspect().hostWatch.enabled === true && sdk.inspect().hostWatch.url === true, 'ignore 不影响装配反射')
      sdk.unmount()
    } finally {
      globalThis.window = realWindow
    }
  }

  console.log('[e2e:host-watch] 未配置 hostWatch → inspect().hostWatch 不出现(配置即开关)')
  {
    const model = new StubChatModel([{ text: 'done' }])
    const sdk = createChatSdk({ ui: false, id: 'e2e-hostwatch-off', storage: 'memory', llm: model, capabilities: MIN_CAPS, autoTitle: false })
    await sdk.mount()
    assert(sdk.inspect().hostWatch === undefined, '未配置 → inspect().hostWatch undefined(零开销)')
    await sdk.send('问')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
