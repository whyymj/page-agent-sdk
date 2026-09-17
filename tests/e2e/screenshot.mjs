// take_screenshot(page-screenshot):条件注入 + 分层图通道 + describe 旁路 + 事件富化。
// node e2e 以 fake globals 驱动工具全链(document/canvas/createImageBitmap 桩);渲染库真跑在 browser e2e。
import { setupEnv, createAssert } from './_helpers.mjs'
import { StubChatModel } from './_stub-model.mjs'

/** 装截图所需的最小浏览器面(node 桩):querySelector/documentElement/createElement(canvas)/createImageBitmap */
function installBrowserFakes() {
  const realDoc = globalThis.document
  const realWin = globalThis.window
  const fakeCanvas = () => ({
    width: 0, height: 0,
    getContext: () => ({
      drawImage() {},
      getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }), // 全不透明 → keepPng false → jpeg
    }),
    toDataURL: () => 'data:image/jpeg;base64,ZmFrZWNvbXByZXNzZWQ=',
  })
  globalThis.document = {
    addEventListener() {}, removeEventListener() {}, visibilityState: 'visible', title: 'T',
    querySelector: (sel) => (sel === '.shot-target' ? { tagName: 'DIV', __sel: sel } : null),
    documentElement: { scrollHeight: 2400 },
    body: { scrollHeight: 2400 },
    createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : { tag }),
  }
  globalThis.window = Object.assign(realWin ?? {}, { innerWidth: 1280, innerHeight: 800 })
  globalThis.createImageBitmap = async () => ({ width: 900, height: 1600, close() {} })
  return () => {
    globalThis.document = realDoc
    globalThis.window = realWin
    delete globalThis.createImageBitmap
  }
}

const FAKE_PNG = 'data:image/png;base64,aVBoVE5HT0RPTg=='

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx
  const { createChatSdk, z } = await import('page-agent-sdk')

  console.log('[e2e:screenshot] take_screenshot 条件注入 + 分层图通道')

  const baseOpts = (llm, extra = {}) => ({
    ui: false, id: 'e2e-shot', storage: 'memory', llm, autoTitle: false,
    capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false, subagent: false, dataOps: false },
    // renderer 钩子(node 桩:返回固定 PNG,记录调用尺寸断言三模式路由)
    screenshot: { renderer: async (el, opts) => { globalThis.__shotCalls.push({ el, opts }); return FAKE_PNG } },
    ...extra,
  })
  const visionStub = () => { const s = new StubChatModel([]); s.vision = true; return s }

  // ===== ① vision 主模型:条件注入 + 工具元数据 + 合成 user 消息带图 parts + 事件富化 =====
  {
    const restore = installBrowserFakes()
    try {
      globalThis.__shotCalls = []
      const stub = visionStub()
      stub.responses.push(
        { toolCalls: [{ name: 'take_screenshot', args: {} }] },   // 视口
        { toolCalls: [{ name: 'take_screenshot', args: { selector: '.shot-target' } }] }, // 局部
        { text: '看到页面了:顶部有导航和一张表格' },
      )
      const sdk = createChatSdk(baseOpts(stub, { capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false, subagent: false, dataOps: false, domInspect: true } }))
      await sdk.mount()
      assert(sdk.inspect().tools.some((t) => t.name === 'take_screenshot'), '条件满足(vision + domInspect)→ take_screenshot 在工具池')
      const shots = []
      sdk.hook?.((e) => { if (e.type === 'tool_result' && e.name === 'take_screenshot') shots.push(e) })
      await sdk.send('看看页面')
      // 三模式路由:视口调用带窗口尺寸;selector 调用命中目标元素
      assert(globalThis.__shotCalls[0]?.opts?.width === 1280 && globalThis.__shotCalls[0]?.opts?.height === 800, '视口模式 → renderer 收到窗口尺寸')
      assert(globalThis.__shotCalls[1]?.el?.__sel === '.shot-target', 'selector 模式 → renderer 收到目标元素')
      // 工具结果 = 纯文本元数据(base64 不进 content)
      const toolMsgs = stub.lastMessages.filter((m) => m?._getType?.() === 'tool')
      assert(toolMsgs.length === 2 && toolMsgs.every((m) => String(m.content).startsWith('截图完成(') && !String(m.content).includes('base64,')), 'ToolMessage = 文本元数据(模式/尺寸/KB/vfsRef),base64 不进 content')
      assert(toolMsgs[0].content.includes('userImages/'), '原图已 stow vfs(userImages 池)')
      // 合成 user 消息:顺序两轮各自一条(合并仅同轮并行);两条各含一图
      const humans = stub.lastMessages.filter((m) => m?._getType?.() === 'human')
      const partsMsgs = humans.filter((m) => Array.isArray(m.content))
      assert(partsMsgs.length === 2, 'vision → 两次截图各产生一条合成 user 消息(content parts)')
      assert(String(partsMsgs[0].content[0]?.text).includes('[截图 1] viewport'), '首条合成消息 text 含截图元数据')
      assert(String(partsMsgs[1].content[0]?.text).includes('[截图 1] selector'), '次条合成消息 text 含 selector 元数据')
      assert(partsMsgs.flatMap((m) => m.content).filter((p) => p?.type === 'image_url').length === 2, '合计两 image_url part')
      assert(String(partsMsgs[0].content[1]?.image_url?.url).startsWith('data:image/jpeg'), '图 part 为压缩后 jpeg dataURI(非原始 PNG)')
      // 事件富化
      assert(shots.length === 2 && shots.every((e) => e.image?.dataUri?.startsWith('data:image/jpeg')), 'tool_result 事件富化 image 字段(jpeg dataUri)')
      await sdk.unmount()
    } finally { restore() }
  }

  // ===== ② 非 vision + describe:转述回灌纯文本,无合成图消息 =====
  {
    const restore = installBrowserFakes()
    try {
      let describeCalls = 0
      const stub = new StubChatModel([{ toolCalls: [{ name: 'take_screenshot', args: {} }] }, { text: '好的' }])
      const sdk = createChatSdk(baseOpts(stub, {
        capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false, subagent: false, dataOps: false, domInspect: true },
        images: { describe: async () => { describeCalls++; return '页面顶部有一张四列配置表格' } },
      }))
      await sdk.mount()
      assert(sdk.inspect().tools.some((t) => t.name === 'take_screenshot'), '非 vision 但 images.describe 已配 → 工具照装(旁路可消费)')
      await sdk.send('页面长什么样')
      const toolMsgs = stub.lastMessages.filter((m) => m?._getType?.() === 'tool')
      assert(describeCalls === 1, 'describe 被调一次(旁路消费)')
      assert(String(toolMsgs[0]?.content).includes('识图转述:页面顶部有一张四列配置表格'), 'ToolMessage 回灌转述文本')
      const humans = stub.lastMessages.filter((m) => m?._getType?.() === 'human')
      assert(!humans.some((m) => Array.isArray(m.content)), '非 vision → 无合成图消息(纯文本通道零协议风险)')
      await sdk.unmount()
    } finally { restore() }
  }

  // ===== ③ 条件不满足:工具不装 + 装配 warn 留痕 =====
  {
    const restore = installBrowserFakes()
    try {
      const warns = []
      const origWarn = console.warn
      console.warn = (...a) => { warns.push(a.join(' ')) }
      const stub = new StubChatModel([{ text: 'x' }])
      let sdk
      try {
        sdk = createChatSdk(baseOpts(stub, { capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false, subagent: false, dataOps: false, domInspect: true } }))
        await sdk.mount()
      } finally { console.warn = origWarn }
      assert(!sdk.inspect().tools.some((t) => t.name === 'take_screenshot'), 'domInspect 开但非 vision 且无 describe → 工具不装')
      assert(warns.some((w) => w.includes('take_screenshot') && w.includes('未装载')), '不满足 → 装配 warn 留痕(verify 先例形态)')
      const sys = stub.systemPrompts.at(-1) ?? ''
      assert(!sys.includes('take_screenshot'), 'hints 不教未装配的工具')
      await sdk.unmount()
    } finally { restore() }
  }

  // ===== ④ fullPage:scrollHeight 显式传 + 超高拒 =====
  {
    const restore = installBrowserFakes()
    try {
      globalThis.__shotCalls = []
      const stub = visionStub()
      stub.responses.push({ toolCalls: [{ name: 'take_screenshot', args: { fullPage: true } }] }, { text: '整页看到了' })
      const sdk = createChatSdk(baseOpts(stub, { capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false, subagent: false, dataOps: false, domInspect: true } }))
      await sdk.mount()
      await sdk.send('截整页')
      assert(globalThis.__shotCalls[0]?.opts?.height === 2400, 'fullPage → renderer 显式收 scrollHeight(documentElement 布局高不够)')
      // 超高拒:改 documentElement.scrollHeight 超限
      globalThis.__shotCalls = []
      stub.responses.push({ toolCalls: [{ name: 'take_screenshot', args: { fullPage: true } }] }, { text: 'ok' })
      globalThis.document.documentElement.scrollHeight = 40000
      await sdk.send('再截整页')
      const toolMsgs = stub.lastMessages.filter((m) => m?._getType?.() === 'tool')
      assert(String(toolMsgs.at(-1)?.content).includes('超上限') && globalThis.__shotCalls.length === 0, '超长文档 → 拒截文案 + renderer 不再调用')
      await sdk.unmount()
    } finally { restore() }
  }

  console.log(`[e2e:screenshot] 完成: ${ctx.pass} 通过, ${ctx.fail} 失败`)
  return { name: 'screenshot', pass: ctx.pass, fail: ctx.fail }
}
