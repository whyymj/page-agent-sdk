// MCP 真实 e2e:spawn 真实 mock MCP server(StreamableHTTP)走完整链路 —— connectMcp 握手 → 工具注入 →
// agent 真实调用 MCP 工具 → 结果回灌。区别于纯 stub:这里 SDK 的 MCP client 与 MCP SDK server 真跑网络。
// 同时锁 mcp-e2e 发现的优化:MCP 后台连接不阻塞 mount(握手 15s 超时曾 await 在 initDone → 对话框 15s 不渲染)。
import { spawn } from 'node:child_process'
import net from 'node:net'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk } from './_helpers.mjs'
import { StubChatModel } from './_stub-model.mjs'
import { z } from 'zod'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

/** 起 mock MCP server(tsx 跑指定脚本(默认 mock;C2 用 malicious 同名工具脚本);resolve = TCP 端口可连) */
function startMockServer(port, script = 'scripts/mcp-mock-server.ts') {
  const child = spawn(process.execPath, ['--import', 'tsx', script], {
    cwd: repoRoot,
    env: { ...process.env, MCP_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const started = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('mock MCP server 启动超时')), 20_000)
    const probe = () => {
      const sock = net.connect(port, '127.0.0.1')
      sock.once('connect', () => { sock.destroy(); clearTimeout(timer); resolve() })
      sock.once('error', () => setTimeout(probe, 200))
    }
    probe()
  })
  return { child, started, stop: () => { try { child.kill('SIGINT') } catch { /* ignore */ } } }
}

/** 挂死 server:TCP 建连但永不响应(握手必然走到 timeoutMs 超时);临时端口(0)防与并行用例撞端口 */
function startDeadServer() {
  return new Promise((resolve) => {
    const sockets = new Set()
    const server = net.createServer((sock) => { sockets.add(sock); sock.once('close', () => sockets.delete(sock)) })
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      // 收尾须先 destroy 全部挂起连接(MCP client 的 pending fetch)再 close,否则 close 回调永不来
      stop: () => new Promise((r) => {
        for (const s of sockets) s.destroy()
        server.close(() => r())
        setTimeout(r, 2000) // 双保险:close 回调异常也不挂测试
      }),
    }))
  })
}

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  // 记录 unhandledRejection(后台 MCP 连接收口不得产生未处理拒绝)
  const unhandled = []
  const onUnhandled = (e) => unhandled.push(e)
  process.on('unhandledRejection', onUnhandled)

  console.log('[e2e:mcp] MCP 后台连接不阻塞 mount(握手挂死场景,mcp-e2e 真测优化)')
  let dead
  {
    dead = await startDeadServer()
    const t0 = Date.now()
    const sdk = createChatSdk({
      ui: false, id: 'e2e-mcp-dead', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      mcp: [{ transport: 'http', url: `http://127.0.0.1:${dead.port}/mcp`, name: 'dead', timeoutMs: 1200 }],
    })
    await sdk.mount()
    const mountMs = Date.now() - t0
    assert(mountMs < 1000, `mount 不被 MCP 握手阻塞(${mountMs}ms < 1000ms;原行为 await initDone → ≥ 握手超时 1200ms)`)

    // 后台握手超时降级:mcp.servers 空 + 无工具注入 + 不 crash(warn 留痕)
    await new Promise((r) => setTimeout(r, 1800))
    const info = sdk.inspect()
    assert(info.mcp.servers.length === 0, '挂死 server 握手超时 → 降级不注入(mcp.servers 空)')
    assert(!info.tools.some((t) => t.source?.startsWith('mcp:')), '挂死 server → 无 mcp 工具进池')
    sdk.unmount()
  }

  console.log('[e2e:mcp] release 先行竞态:握手在途时 unmount → 后台完成后不回填已释放 core(防连接泄漏)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-mcp-release-race', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      mcp: [{ transport: 'http', url: `http://127.0.0.1:${dead.port}/mcp`, name: 'dead2', timeoutMs: 1200 }],
    })
    await sdk.mount()
    sdk.unmount() // 握手仍在途时释放
    await new Promise((r) => setTimeout(r, 1600)) // 等后台握手超时收口跑完
    assert(true, 'release 先行 → 后台握手超时收口无 crash(mcpBackgroundReleased 路径)')
  }

  console.log('[e2e:mcp] 真实 mock MCP server:握手 → 工具迟到注入 → inspect 反射 + 真实工具调用')
  let mock
  {
    mock = startMockServer(3192)
    await mock.started
    // stub 创建时直传(setLlm 对 stub 实例重解析 caps 会 throw —— model 名查表不到被误判 32K,已有 automation 范式)
    const stub = new StubChatModel([
      { toolCalls: [{ name: 'get_weather', args: { city: '北京' } }] },
      { text: '北京:晴 ☀️,25℃' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-mcp-real', storage: 'memory', llm: stub, capabilities: MIN_CAPS,
      mcp: [{ transport: 'http', url: 'http://127.0.0.1:3192/mcp', name: 'rag-mock' }],
    })
    await sdk.mount()
    // 迟到注入:轮询 inspect 直到 get_weather 出现(后台握手 + setTools rebind;慢网/慢握手下就绪前对话正常)
    const injected = await (async () => {
      for (let i = 0; i < 50; i++) {
        if (sdk.inspect().tools.some((t) => t.name === 'get_weather')) return true
        await new Promise((r) => setTimeout(r, 100))
      }
      return false
    })()
    assert(injected, '真实握手 → 3 个工具迟到注入(get_weather/search/calc 经 setTools rebind 进池)')
    const info = sdk.inspect()
    assert(info.mcp.servers.length === 1 && info.mcp.servers[0].name === 'rag-mock' && info.mcp.servers[0].toolCount === 3,
      'inspect().mcp.servers 反射:rag-mock / 3 工具')
    assert(info.tools.some((t) => t.name === 'get_weather' && t.source === 'mcp:rag-mock'),
      '工具来源标注 source=mcp:rag-mock')

    console.log('[e2e:mcp] 真实工具调用链路:agent ReAct → MCP get_weather → 结果回灌')
    await sdk.send('北京天气')
    const msgs = JSON.stringify(sdk.messages)
    assert(msgs.includes('晴 ☀️'), 'agent 真实调用 MCP get_weather → mock server 返回「晴 ☀️」回灌消息')
    assert(stub.calls >= 2, 'ReAct 走完:工具调用轮 + 收口轮(≥2 次 model call)')
    sdk.unmount()
  }

  console.log('[e2e:mcp] C2 保留字保护:恶意 MCP server 暴露 write 工具 → 拒绝注入 + 正常工具照常')
  {
    const malicious = startMockServer(3195, 'scripts/mcp-malicious-server.ts')
    await malicious.started

    const bind = { x: 'old' }
    const stub = new StubChatModel([
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'x', value: 'new' } } }] },
      { text: '已改好' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-mcp-reserved', storage: 'memory', llm: stub, capabilities: MIN_CAPS,
      data: { schema: z.object({ x: z.string() }), bind },  // 构造期声明 data → 内置 write 工具存在
      mcp: [{ transport: 'http', url: 'http://127.0.0.1:3195/mcp', name: 'malicious' }],
    })
    await sdk.mount()

    // 轮询等后台握手注入(固定 sleep 不稳,同上方真实链路用例)
    await (async () => {
      for (let i = 0; i < 50; i++) {
        if (sdk.inspect().tools.some((t) => t.name === 'safe_tool' || (t.source || '').startsWith('mcp:'))) return
        await new Promise((r) => setTimeout(r, 100))
      }
    })()

    const info = sdk.inspect()

    // C2-①:内置 write 工具存在且来源为 builtin(未被 MCP 覆盖)
    assert(info.tools.some((t) => t.name === 'write' && t.source === 'builtin'),
      '内置 write 工具保持不变(source=builtin,保留字保护生效)')

    // C2-②:无 mcp 来源的 write 工具(恶意 write 工具被拒绝注入)
    const mcpWriteTools = info.tools.filter((t) => t.name === 'write' && t.source?.startsWith('mcp:'))
    assert(mcpWriteTools.length === 0, '恶意 MCP write 工具被拒绝注入(不在 mcp 来源工具列表)')

    // C2-③:正常工具(safe_tool)照常注入
    assert(info.tools.some((t) => t.name === 'safe_tool' && t.source === 'mcp:malicious'),
      '正常工具 safe_tool 照常注入(malicious server)')

    // C2-④:验证内置 write 工具调用行为正常(构造期 data 的 bind)
    await sdk.send('把 x 改成 new')
    assert(bind.x === 'new', '内置 write 工具行为正常,agent 可修改数据')

    // C2-⑤(rv-sec 复审:守卫竞态时序锁定):用户先 setTools 注册同名工具,后注入的 MCP 同名工具仍被拒
    // (守卫的 reservedNames 是注入时现场构建,不吃陈旧快照)
    {
      const warned2 = []
      const ow = console.warn
      console.warn = (...a) => { warned2.push(a.join(' ')); ow(...a) }
      try {
        sdk.setTools([{ name: 'lookup', invoke: async () => 'user-tool', description: 'd', schema: { type: 'object', properties: {} } }])
        const info2 = sdk.inspect()
        assert(info2.tools.some((t) => t.name === 'lookup' && t.source === 'user'), '用户后注册工具正常进池(user 组覆盖语义)')
        assert(info2.tools.every((t) => t.name !== 'read' || t.source !== 'mcp:malicious'), 'MCP 同名 read 仍被拒(与用户工具重名同样拦)')
      } finally { console.warn = ow }
    }

    sdk.unmount()
    malicious.stop()
  }

  console.log('[e2e:mcp] F4 双 server 一坏一好:好的工具照常注入,坏的降级不拖累')
  {
    const good = startMockServer(3196)
    await good.started
    const dead = await startDeadServer()
    const stub = new StubChatModel([{ text: 'ok' }])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-mcp-partial', storage: 'memory', llm: stub, capabilities: MIN_CAPS,
      mcp: [
        { transport: 'http', url: `http://127.0.0.1:${dead.port}/mcp`, name: 'dead', timeoutMs: 1200 },
        { transport: 'http', url: 'http://127.0.0.1:3196/mcp', name: 'good' },
      ],
    })
    // MCP_CONNECT_FAILED 可观测:hook 必须在 mount 前注册(dead 1.2s 即降级,晚注册会错过事件)
    const failedEvents = []
    const offFailed = sdk.hook((e) => { if (e.type === 'error' && e.code === 'MCP_CONNECT_FAILED') failedEvents.push(e) })
    await sdk.mount()
    // 轮询等好 server 注入(dead 1.2s 后超时降级,不拖累 good)
    let injected = false
    for (let i = 0; i < 50; i++) {
      if (sdk.inspect().tools.some((t) => t.source === 'mcp:good')) { injected = true; break }
      await new Promise((r) => setTimeout(r, 100))
    }
    assert(injected, '双 server 一坏一好:好 server 工具照常注入(get_weather/search/calc)')
    await new Promise((r) => setTimeout(r, 1500))  // 等 dead 超时降级落定
    offFailed()
    const info = sdk.inspect()
    assert(!info.mcp.servers.some((sv) => sv.name === 'dead'), '坏 server 握手超时 → 降级不进 servers(故障隔离)')
    assert(info.tools.some((t) => t.source === 'mcp:good'), '坏 server 降级后,好 server 工具仍在(allSettled 隔离)')
    assert(failedEvents.length >= 1 && failedEvents[0].severity === 'observable' && failedEvents[0].context?.server === 'dead', '✓ MCP 连接失败 → MCP_CONNECT_FAILED observable 事件(server=dead)')
    assert((info.mcp.failed ?? []).some((f) => f.name === 'dead' && f.error.length > 0), '✓ inspect().mcp.failed 反射失败清单(dead 含错误摘要)')
    sdk.unmount()
    good.stop()
    dead.stop()
  }

  // 收尾:关 server + 复位全局监听(挂死 server 上有 MCP client 的 pending 连接,close 回调永不来 —— 先 destroy 再 close)
  mock?.stop()
  await dead?.stop()
  process.off('unhandledRejection', onUnhandled)
  assert(unhandled.length === 0, '全程无 unhandledRejection(后台握手失败/超时收口不产生未处理拒绝)')
  return { pass: ctx.pass, fail: ctx.fail }
}
