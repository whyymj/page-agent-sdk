// headless 子路径(page-agent-sdk/headless):纯核心产物 page-agent-sdk.headless.js
// 覆盖:导出范围(UI 组件缺失 / 核心 API + chatContext 拼装 API 在)/ 降级 warn(ui!=='false')/ ui:false 走通 / bundle 纯净 + 体积
import * as fs from 'fs'
import { setupEnv, createAssert, FAKE_LLM, z } from './_helpers.mjs'

const HEADLESS_DIST = new URL('../../dist/page-agent-sdk.headless.js', import.meta.url)

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:headless-subpath] 导出范围:核心 API 在,UI 组件 / mountChatDialog 缺席')
  {
    const mod = await import(HEADLESS_DIST)
    // createChatSdk 公开签名一致(主包同名 function)
    assert(typeof mod.createChatSdk === 'function', 'createChatSdk 导出为 function(与主包签名一致)')
    // 核心 API 在
    assert(typeof mod.createAgent === 'function', 'createAgent 导出(核心 harness)')
    assert(typeof mod.defineTool === 'function', 'defineTool 导出')
    assert(typeof mod.createDataOps === 'function', 'createDataOps 导出')
    // L2 自建 UI 拼装 API(无 UI 组件依赖)在
    assert(typeof mod.createChatContext === 'function', 'createChatContext 导出(L2 拼装)')
    assert(typeof mod.useChatContext === 'function', 'useChatContext 导出(L2 拼装)')
    assert(typeof mod.useChat === 'function', 'useChat 导出(L2 拼装)')
    assert(typeof mod.chatContextKey === 'symbol', 'chatContextKey 导出为 symbol')

    // 13 个 .vue 组件全部缺失(headless 不含 UI 层)
    const absentComponents = [
      'ChatDialog', 'MessageContent', 'CodePreview', 'SkillPanel',
      'ChatHeader', 'ChatInput', 'MessageList', 'MessageRow',
      'QueuedBar', 'ApprovalBar', 'ConflictBar', 'FocusBar', 'DebugDrawer',
    ]
    let allAbsent = true
    for (const c of absentComponents) {
      if (typeof mod[c] !== 'undefined') { allAbsent = false; console.error('  ✗ 不应导出的组件存在:', c) }
    }
    assert(allAbsent, `13 个 .vue 组件全部缺失(headless 不含 UI;${absentComponents.length} 项)`)
    // mountChatDialog 内部实现不暴露(下划线工厂 _createChatSdk 同理)
    assert(typeof mod.mountChatDialog === 'undefined', 'mountChatDialog 不导出(内部依赖反转实现)')
    assert(typeof mod._createChatSdk === 'undefined', '_createChatSdk 不导出(下划线内部工厂)')
  }

  console.log('[e2e:headless-subpath] 降级语义:ui!=="false"(默认)→ mount() console.warn 提示降级')
  {
    const { createChatSdk } = await import(HEADLESS_DIST)
    const sdk = createChatSdk({
      id: 'headless-warn', storage: 'memory', llm: FAKE_LLM,
      capabilities: { planning: false, skills: false, vfs: false, summarization: false, memory: false, subagent: false },
      // 故意不传 ui:false → 默认 'default' → headless 入口无 mounter → warn 降级
    })
    const warns = []
    const origWarn = console.warn
    console.warn = (...args) => warns.push(args.join(' '))
    try {
      await sdk.mount() // 无 mounter + ui!=='false' → warn + installFlush + return(不渲染 DOM,不抛错)
    } finally {
      console.warn = origWarn
    }
    assert(warns.some((w) => w.includes('page-agent-sdk/headless') && w.includes('降级')), 'mount() 触发 headless 降级 warn(含子路径名 + 降级提示)')
    assert(Array.isArray(sdk.messages), '降级后 sdk.messages 仍可用(核心层正常)')
    sdk.unmount()
  }

  console.log('[e2e:headless-subpath] ui:false 走通 mount(无 warn;headless 正常态)')
  {
    const { createChatSdk } = await import(HEADLESS_DIST)
    const sdk = createChatSdk({
      ui: false, id: 'headless-normal', storage: 'memory', llm: FAKE_LLM,
      capabilities: { planning: false, skills: false, vfs: false, summarization: false, memory: false, subagent: false },
      data: { schema: z.object({ x: z.number() }), bind: { x: 1 }, description: 'd' },
    })
    const warns = []
    const origWarn = console.warn
    console.warn = (...args) => warns.push(args.join(' '))
    try {
      await sdk.mount()
    } finally {
      console.warn = origWarn
    }
    assert(!warns.some((w) => w.includes('page-agent-sdk/headless')), 'ui:false 时不触发降级 warn(用户显式 headless)')
    assert(Array.isArray(sdk.messages) && sdk.messages.length === 0, 'mount 后 messages 为空数组(初始化成功)')
    assert(typeof sdk.inspect === 'function' && Array.isArray(sdk.inspect().tools), 'inspect() 返回含 tools(核心 agent 装配成功)')
    assert(typeof sdk.send === 'function', 'send 方法可用(命令式 API 完整)')
    sdk.unmount()
  }

  console.log('[e2e:headless-subpath] bundle 纯净性:不含 UI 层依赖 + 体积 ≤ 760KB')
  {
    const bundle = fs.readFileSync(HEADLESS_DIST, 'utf8')
    // UI 层重依赖(marked/highlight.js/dompurify)+ ChatDialog 组件,确定性不可达 → 文本应为 0
    assert(!bundle.includes('highlight.js'), 'bundle 不含 highlight.js')
    assert(!bundle.includes('dompurify'), 'bundle 不含 dompurify')
    assert(!bundle.includes('marked'), 'bundle 不含 marked')
    assert(!bundle.includes('ChatDialog'), 'bundle 不含 ChatDialog')

    // 体积断言(headless 实测 ~673KB —— 2026-08-27 html-design-skill 内置 web-design-engineer 后 +216K;
    // 阈值 760KB 与 tests/size-check.mjs 同口径,防 UI 层意外拉入回归)
    const sizeKB = fs.statSync(HEADLESS_DIST).size / 1024
    assert(sizeKB > 100, `bundle 非空有内容(${sizeKB.toFixed(0)}KB)`)
    assert(sizeKB <= 760, `bundle 体积 ≤ 760KB(实测 ${sizeKB.toFixed(0)}KB;超阈值说明 UI 层被意外拉入)`)
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
