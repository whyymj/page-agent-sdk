// autoTitle 标题路径(F0c 2026-09-10,拆分前置):storage.mjs 已有「LLM 标题写-读时序」+「unmount 迟到守卫」
// 两例,本模块补其未覆盖的四个场景 —— ①规则 title 正面断言(deriveTitle 截断写盘)②autoTitle:false 门
// (标题 LLM 零调用而规则 title 照写)③switchSession 迟到守卫(sid 快照不匹配 → 弃写)④标题 LLM 抛错吞掉
// (规则兜底 + 零 unhandledRejection)。
// 动机:标题生成路径(lastTitle/titleLLMDone 可变闭包状态)恰在 F2 拆分区,拆前把回归反馈补齐(审计原述
// 「全库零覆盖」经核不准 —— storage.mjs 两例在,缺的是上述四场景)。
import { setupEnv, createAssert, MIN_CAPS, createChatSdk } from './_helpers.mjs'
import { StubChatModel } from './_stub-model.mjs'

function localStore() {
  const m = new Map()
  return {
    map: m,
    install() {
      globalThis.localStorage = {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
        key: (i) => Array.from(m.keys())[i] ?? null,
        get length() { return m.size },
        clear: () => m.clear(),
      }
    },
    uninstall() { delete globalThis.localStorage },
  }
}

/** ≤30 字用户文本:规则 title = 全文(deriveTitle 不截断) */
const USER_TEXT = '自动标题规则路径验证消息甲'

// 规则 title 写盘不刷响应式 sessions 列表(refreshSessions 仅 LLM 标题路径的时序契约,A1 修)——
// 断言走 listSessions 直读 store 元数据(scan 不经响应式缓存)
async function waitTitle(sdk, title, ms = 4000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const list = await sdk.listSessions()
    if (list.some((x) => x.title === title)) return true
    await new Promise((r) => setTimeout(r, 50))
  }
  return false
}

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:auto-title] 规则 title 生命周期:deriveTitle 先落盘 → 延迟的 LLM 标题后覆盖')
  {
    const st = localStore(); st.install()
    // 第 2 响应(标题 invoke)延迟 500ms:规则 title 先落盘可观测,再被 LLM 标题覆盖(生命周期顺序断言;
    // 不给延迟则 stub 即时覆盖,规则写盘窗口不可观测)
    const model = new StubChatModel([{ text: '回复完成' }, { text: 'LLM覆盖标题', delayMs: 500 }])
    const sdk = createChatSdk({ ui: false, id: 'e2e-auto-title-rule', storage: 'local', llm: model, capabilities: MIN_CAPS })
    await sdk.mount()
    await sdk.send(USER_TEXT)
    assert(await waitTitle(sdk, USER_TEXT), '✓ 规则 title = 首条 user 前 30 字(≤30 字全文)先落盘且 listSessions 可见')
    assert(await waitTitle(sdk, 'LLM覆盖标题'), '✓ 延迟的 LLM 标题随后覆盖规则 title(生命周期顺序:规则兜底 → LLM 精化)')
    sdk.unmount(); st.uninstall()
  }

  console.log('[e2e:auto-title] autoTitle:false 门:标题 LLM 零调用,规则 title 照常')
  {
    const st = localStore(); st.install()
    const model = new StubChatModel([{ text: '回复完成' }])
    const sdk = createChatSdk({ ui: false, id: 'e2e-auto-title-off', storage: 'local', llm: model, capabilities: MIN_CAPS, autoTitle: false })
    await sdk.mount()
    await sdk.send(USER_TEXT)
    await new Promise((r) => setTimeout(r, 400))  // 标题 invoke 若未门控应已发起
    assert(model.calls === 1, '✓ autoTitle:false → 标题 LLM 零调用(calls 停留主轮 1 次)')
    assert(await waitTitle(sdk, USER_TEXT, 1500), '✓ autoTitle:false 不门控规则 title(deriveTitle 路径独立)')
    sdk.unmount(); st.uninstall()
  }

  console.log('[e2e:auto-title] switchSession 迟到守卫:标题在途切会话 → 弃写(零 unhandledRejection)')
  {
    const unhandled = []
    const onUnhandled = (r) => unhandled.push(String(r))
    process.on('unhandledRejection', onUnhandled)
    const st = localStore(); st.install()
    const model = new StubChatModel([{ text: '回复完成' }, { text: '迟到的切换守卫标题', delayMs: 300 }])
    const sdk = createChatSdk({ ui: false, id: 'e2e-auto-title-switch', storage: 'local', llm: model, capabilities: MIN_CAPS })
    await sdk.mount()
    await sdk.send(USER_TEXT)
    await sdk.switchSession()  // 标题 invoke(300ms)在途切会话:sid 快照 ≠ 当前 → 守卫弃写
    await new Promise((r) => setTimeout(r, 600))
    assert(model.calls === 2, '✓ 标题 LLM 调用确已发起(守卫跳的是写入,不是没调用)')
    assert(!Array.from(st.map.values()).join('\n').includes('迟到的切换守卫标题'), '✓ 在途切会话 → 迟到标题未写入任何会话(sid 快照守卫)')
    assert(unhandled.length === 0, '✓ 迟到守卫零 unhandledRejection')
    process.off('unhandledRejection', onUnhandled)
    sdk.unmount(); st.uninstall()
  }

  console.log('[e2e:auto-title] 标题 LLM 失败吞掉:抛错 → 规则 title 兜底 + 零 unhandledRejection')
  {
    const unhandled = []
    const onUnhandled = (r) => unhandled.push(String(r))
    process.on('unhandledRejection', onUnhandled)
    const st = localStore(); st.install()
    const model = new StubChatModel([{ text: '回复完成' }])
    // titleLlm 实例路径(isChatModel 认 invoke+stream):invoke 抛错模拟标题模型故障
    const boomLlm = { invoke: async () => { throw new Error('title llm boom') }, stream: async function* () { /* 不可达 */ } }
    const sdk = createChatSdk({ ui: false, id: 'e2e-auto-title-fail', storage: 'local', llm: model, titleLlm: boomLlm, capabilities: MIN_CAPS })
    await sdk.mount()
    await sdk.send(USER_TEXT)
    await new Promise((r) => setTimeout(r, 400))
    assert(await waitTitle(sdk, USER_TEXT, 1500), '✓ 标题 LLM 抛错 → 规则 title 兜底可见')
    assert(unhandled.length === 0, '✓ 标题 LLM 抛错被吞(fire-and-forget catch,零 unhandledRejection)')
    process.off('unhandledRejection', onUnhandled)
    sdk.unmount(); st.uninstall()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
