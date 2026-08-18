// images 图片输入(image-input-vision Phase 1):多模态直发 content parts / 非 vision 诚实拒 / describe 旁路转述注入 /
// upload 上传换 URL / 持久化轻形态 + vfs 原图往返 / 单轮数量上限
import { setupEnv, createAssert } from './_helpers.mjs'
import { StubChatModel } from './_stub-model.mjs'

const PNG_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg'

/** 捕获型 stub:额外记录每次调用收到的最后一条 HumanMessage content(断言 content parts / 转述注入形态) */
class CapturingStub extends StubChatModel {
  constructor(responses, opts = {}) {
    super(responses, opts)
    this.humanContents = []
    this.vision = opts.vision // resolveLlm 实例路径读 llm.vision(网关代理模型名不可辨时显式声明同通道)
  }
  async *_streamResponseChunks(messages, opts, runM) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (typeof m?.getGenerativeAI?.$$O !== 'function' && typeof m?.content !== 'undefined' && m?._getType?.() === 'human') {
        this.humanContents.push(m.content)
        break
      }
    }
    yield* super._streamResponseChunks(messages, opts, runM)
  }
}

function mkImage(id, overrides = {}) {
  return { id, dataUri: PNG_URI, name: `${id}.png`, width: 100, height: 80, ...overrides }
}

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx
  const { createChatSdk, z } = await import('page-agent-sdk')

  console.log('[e2e:images] 图片输入 · 多模态直发 + describe 旁路 + upload + 持久化轻形态')

  const schema = z.object({ title: z.string() })
  const bind = { title: '首页' }
  const baseOpts = (llm, extra = {}) => ({
    ui: false, id: 'e2e-images', storage: 'memory', llm, autoTitle: false,
    capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false, subagent: false },
    data: { schema, bind, description: '页面' },
    ...extra,
  })

  // ===== ① 多模态主模型直发:content parts 形态 + vfs 入库 =====
  {
    const stub = new CapturingStub([{ text: '收到图' }], { vision: true })
    const sdk = createChatSdk(baseOpts(stub))
    await sdk.mount()
    const reply = await sdk.send('看这张图', { images: [mkImage('img_a')] })
    assert(reply === '收到图', 'vision 主模型 send 带图 → 正常回复')
    assert(sdk.messages.some((m) => m.role === 'user' && m.images?.length), '消息数组 → user 消息携带 images')
    const parts = stub.humanContents.at(-1)
    assert(Array.isArray(parts) && parts[0]?.type === 'text' && parts[0]?.text === '看这张图', '直发 → HumanMessage content parts,首段 text 带原文')
    assert(parts?.[1]?.type === 'image_url' && parts?.[1]?.image_url?.url === PNG_URI, '直发 → image_url part(dataURI)')
    await sdk.unmount()
  }

  // ===== ② 非 vision + 未配 describe → 诚实拒绝(不静默丢图)=====
  {
    const stub = new CapturingStub([{ text: 'x' }])
    const sdk = createChatSdk(baseOpts(stub))
    await sdk.mount()
    const errors = []
    sdk.hook?.((e) => { if (e.type === 'error') errors.push(e) })
    let rejected = false
    try { await sdk.send('看图', { images: [mkImage('img_b')] }) } catch { rejected = true }
    assert(rejected, '非 vision + 未配 describe → send 拒绝(throw)')
    assert(errors.some((e) => e.code === 'IMAGE_UNSUPPORTED_MODEL'), '拒绝 → emit error code IMAGE_UNSUPPORTED_MODEL')
    assert(!sdk.messages.some((m) => m.role === 'user' && m.images?.length), '拒绝 → 消息不 push(用户输入不丢但也不误发)')
    assert(stub.calls === 0, '拒绝 → 模型零调用(不烧 token)')
    await sdk.unmount()
  }

  // ===== ③ describe 旁路(集成方绑定识图):转述注入,图片不直发 =====
  {
    const stub = new CapturingStub([{ text: '这是啤酒节海报,开始还原' }])
    let describeCalls = 0
    const sdk = createChatSdk(baseOpts(stub, {
      images: { describe: async (im, context) => { describeCalls++; return `描述(${im.id}|${context.text}):一张海报` } },
    }))
    await sdk.mount()
    const reply = await sdk.send('还原这个设计', { images: [mkImage('img_c')] })
    assert(reply.includes('啤酒节'), 'describe 旁路 → send 正常完成')
    assert(describeCalls === 1, 'describe 旁路 → 集成方回调被调一次(context.text = 本轮输入)')
    const userMsg = sdk.messages.find((m) => m.role === 'user' && m.images?.length)
    assert(userMsg?.images?.[0]?.description?.includes('一张海报'), 'describe 旁路 → description 挂到消息 images(随消息持久化)')
    const content = stub.humanContents.at(-1)
    assert(typeof content === 'string' && content.includes('还原这个设计'), 'describe 旁路 → HumanMessage 纯文本(不带 image_url parts)')
    assert(typeof content === 'string' && content.includes('[图片 1 描述]') && content.includes('一张海报'), 'describe 旁路 → 转述文本以 [图片 N 描述] 段注入')
    // 同图重发(regenerate 场景语义):已 description 不重复调
    const priorImage = userMsg?.images?.[0]
    if (priorImage) await sdk.send('再确认下', { images: [priorImage] })
    assert(describeCalls === 1, 'describe 旁路 → 已转述图片不重复调用(幂等)')
    await sdk.unmount()
  }

  // ===== ④ describe 失败 → 占位 + observable,对话继续(D6 诚实降级)=====
  {
    const stub = new CapturingStub([{ text: '没看清,但继续' }])
    const events = []
    const sdk = createChatSdk(baseOpts(stub, { images: { describe: async () => { throw new Error('vision api down') } }, onEvent: (e) => events.push(e) }))
    await sdk.mount()
    const reply = await sdk.send('看图', { images: [mkImage('img_d')] })
    assert(reply === '没看清,但继续', 'describe 失败 → 对话继续(send 不中断)')
    const userMsg = sdk.messages.find((m) => m.role === 'user' && m.images?.length)
    assert(userMsg?.images?.[0]?.description === '[图片描述不可用]', 'describe 失败 → 占位描述(不静默丢图语义)')
    assert(events.some((e) => e.type === 'error' && e.code === 'VISION_DESCRIBE_FAILED'), 'describe 失败 → observable VISION_DESCRIBE_FAILED')
    await sdk.unmount()
  }

  // ===== ⑤ upload 上传换 URL:parts 用 URL,dataUri 释放,不入 vfs =====
  {
    const stub = new CapturingStub([{ text: 'ok' }], { vision: true })
    const sdk = createChatSdk(baseOpts(stub, {
      images: { upload: async (dataUri, im) => `https://oss.example.com/${im.id}.png` },
    }))
    await sdk.mount()
    await sdk.send('看图', { images: [mkImage('img_e')] })
    const userMsg = sdk.messages.find((m) => m.role === 'user' && m.images?.length)
    assert(userMsg?.images?.[0]?.url === 'https://oss.example.com/img_e.png', 'upload → url 挂载')
    assert(userMsg?.images?.[0]?.dataUri === undefined, 'upload 成功 → dataUri 释放(不再内联)')
    const parts = stub.humanContents.at(-1)
    assert(parts?.[1]?.image_url?.url === 'https://oss.example.com/img_e.png', 'upload → content parts 用 URL 形态')
    await sdk.unmount()
  }

  // ===== ⑥ 持久化轻形态 + vfs 原图往返(storage 切会话恢复重水化)=====
  {
    const stub = new CapturingStub([{ text: '收到' }], { vision: true })
    const sdk = createChatSdk(baseOpts(stub))
    await sdk.mount()
    const sid = sdk.sessionId
    await sdk.send('看图', { images: [mkImage('img_f')] })
    await new Promise((r) => setTimeout(r, 700)) // 等 vfs persist debounce(500ms)落盘
    // 切走(触发快照保存)→ 切回(applySnapshot 轻形态 + vfs 重水化)
    await sdk.switchSession()
    assert(!sdk.messages.some((m) => m.role === 'user' && m.images?.length), '切新会话 → messages 清空')
    await sdk.switchSession(sid)
    const restored = sdk.messages.find((m) => m.role === 'user' && m.images?.length)
    assert(!!restored, '切回会话 → 带图 user 消息恢复')
    assert(restored?.images?.[0]?.id === 'img_f', '恢复 → images 字段往返(id 锚稳定)')
    assert(restored?.images?.[0]?.dataUri === PNG_URI, '恢复 → 原图从 vfs 重水化 dataUri(stow→vfs→persist 轻形态→hydrate 全链)')
    await sdk.unmount()
  }

  // ===== ⑦ 单轮数量上限 =====
  {
    const stub = new CapturingStub([{ text: 'ok' }], { vision: true })
    const sdk = createChatSdk(baseOpts(stub))
    await sdk.mount()
    let rejected = false
    try { await sdk.send('五图', { images: [1, 2, 3, 4, 5].map((i) => mkImage(`img_${i}`)) }) } catch (e) {
      rejected = String(e?.message).includes('4')
    }
    assert(rejected, '单轮 >4 张 → send 拒绝(数量上限)')
    await sdk.unmount()
  }
  return { pass: ctx.pass, fail: ctx.fail }
}
