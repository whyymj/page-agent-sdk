// stale-read-invalidation e2e:写驱动过期读失效(stub model 驱动真 ReAct + wrapModelCall 捕获请求消息)
//  - 默认开:写后下一轮模型请求中旧 read ToolMessage = 失效占位;debugLogs stage 留痕;inspect 反射累计
//  - 关开关:原文保留 + 零留痕 + 反射归零
//  - 子 agent 路径:子栈写后同样失效(子日志转发进主 debugLogs);顶层 false 主/子一致关闭
//  - Phase 0 同源修复回归锁:SCHEMA_INVALID 字符串写不进 fact-sheet「成功写入路径」(经 zero-tool-gate 回灌文案断言)
import { setupEnv, createAssert, createChatSdk, z } from './_helpers.mjs'
import { stubModel } from './_stub-model.mjs'

const CAPS = { fetch: false, skills: false, vfs: false, summarization: false, memory: false }
const MARK = '⏱[过期快照]'
const SCHEMA = z.object({ components: z.array(z.object({ type: z.string(), title: z.string() })) })

/** wrapModelCall 捕获每次模型请求消息(评审 B10:llm_request.messages 非 debug 恒 [],formatForLog 短路) */
function captureMw(sink) {
  return {
    name: 'e2e-capture',
    wrapModelCall: async (req, next) => { sink.push(req.messages.map((m) => ({ type: m._getType?.(), content: String(m.content ?? ''), id: m.tool_call_id }))); return next(req) },
  }
}

const toolMsg = (req, id) => req.filter((m) => m.type === 'tool' && m.id === id)[0]
/** 请求里第一个 ToolMessage 的 id(stub 的 tool_call_id 走生成兜底,不硬编码) */
const firstToolId = (req) => req.find((m) => m.type === 'tool')?.id

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:stale-read] 默认开 → 写后下一轮旧 read 占位 + 留痕 + 反射')
  {
    const calls = []
    const llm = stubModel(
      { toolCalls: [{ name: 'read', args: { jsonPath: 'components.0' } }] },
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.title', value: '新标题' } } }] },
      { text: '已完成修改。components.0.title 已更新。' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-stale-on', storage: false, llm, capabilities: CAPS,
      data: { schema: SCHEMA, bind: { components: [{ type: 'card', title: '旧标题' }] } },
      middleware: [captureMw(calls)],
    })
    await sdk.mount()
    await sdk.send('把第一个组件标题改成新标题')
    // 第 2 次模型调用(写前)旧 read 原文;第 3 次(写后)应为占位
    assert(calls.length === 3, `✓ stale e2e → 3 次模型调用(实际 ${calls.length})`)
    const readId = firstToolId(calls[1])
    assert(toolMsg(calls[1], readId)?.content.includes('旧标题'), '✓ stale e2e → 写前一轮旧 read 原文可见(未过早失效)')
    const after = toolMsg(calls[2], readId)?.content ?? ''
    assert(after.startsWith(MARK), `✓ stale e2e → 写后下一轮旧 read = 失效占位(前 15 字:${after.slice(0, 15)}…)`)
    assert(after.includes('建议窄读:components.0'), '✓ stale e2e → 占位钉原读路径')
    assert(after.includes('最新值与新 hash'), '✓ stale e2e → 占位引用写入结果新值(反 thrash)')
    const logs = sdk.debugLogs.value.filter((l) => l.data?.stage === 'stale_read_invalidated')
    assert(logs.length === 1 && logs[0].data.invalidatedCount === 1, `✓ stale e2e → debugLogs stage 留痕(实际 ${logs.length})`)
    assert(sdk.inspect().staleReadsInvalidated === 1, `✓ stale e2e → inspect().staleReadsInvalidated = 1(实际 ${sdk.inspect().staleReadsInvalidated})`)
    sdk.unmount()
  }

  console.log('[e2e:stale-read] 关开关 → 原文保留 + 零留痕 + 反射归零')
  {
    const calls = []
    const llm = stubModel(
      { toolCalls: [{ name: 'read', args: { jsonPath: 'components.0' } }] },
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.title', value: '新标题' } } }] },
      { text: '已完成修改。components.0.title 已更新。' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-stale-off', storage: false, llm, capabilities: CAPS,
      data: { schema: SCHEMA, bind: { components: [{ type: 'card', title: '旧标题' }] } },
      staleReadInvalidation: false,
      middleware: [captureMw(calls)],
    })
    await sdk.mount()
    await sdk.send('把第一个组件标题改成新标题')
    const readId = firstToolId(calls[1])
    const after = toolMsg(calls[2], readId)?.content ?? ''
    assert(!after.startsWith(MARK) && after.includes('旧标题'), '✓ stale e2e 关 → 写后旧 read 原文保留')
    assert(!sdk.debugLogs.value.some((l) => l.data?.stage === 'stale_read_invalidated'), '✓ stale e2e 关 → 零 stage 留痕')
    assert(sdk.inspect().staleReadsInvalidated === 0, '✓ stale e2e 关 → 反射累计归零')
    sdk.unmount()
  }

  console.log('[e2e:stale-read] 子 agent 路径 → 子栈写后同样失效;顶层 false 主/子一致关闭')
  {
    const runSub = async (opt) => {
      const subLlm = stubModel(
        { toolCalls: [{ name: 'read', args: { jsonPath: 'components.0' } }] },
        { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.title', value: '子写的' } } }] },
        { text: '子任务完成。' },
      )
      const llm = stubModel(
        { toolCalls: [{ name: 'use_worker', args: { task: '改标题' } }] },
        { text: '已委派完成。components.0.title。' },
      )
      const sdk = createChatSdk({
        ui: false, id: `e2e-stale-sub-${opt ? 'on' : 'off'}`, storage: false, llm, capabilities: CAPS,
        data: { schema: SCHEMA, bind: { components: [{ type: 'card', title: '旧标题' }] } },
        subagents: [{ id: 'worker', description: '改组件标题', llm: subLlm, allowedTools: ['write'], writablePaths: ['components'] }],
        ...(opt === false ? { staleReadInvalidation: false } : {}),
      })
      await sdk.mount()
      await sdk.send('把第一个组件标题改了')
      const logs = sdk.debugLogs.value.filter((l) => l.data?.stage === 'stale_read_invalidated')
      const bind = sdk.getData?.() ?? null
      sdk.unmount()
      return { logs, bind }
    }
    const on = await runSub(undefined)
    assert(on.logs.length >= 1, `✓ stale e2e 子栈 → 子 agent 写后失效留痕转发进主 debugLogs(实际 ${on.logs.length})`)
    const off = await runSub(false)
    assert(off.logs.length === 0, `✓ stale e2e 子栈关 → 顶层 false 主/子一致零留痕(实际 ${off.logs.length})`)
  }

  console.log('[e2e:stale-read] Phase 0 回归锁 → SCHEMA_INVALID 失败写不触发失效(ERROR: 字符串路径端到端)')
  {
    const calls = []
    const llm = stubModel(
      { toolCalls: [{ name: 'read', args: { jsonPath: 'components.0' } }] },
      // schema 违反(title 需 string,传 number)→ dataOps return toolError 字符串(status 仍 done,不 throw)
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.title', value: 12345 } } }] },
      { text: '标题类型不符合 schema 要求,未写入,请确认。' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-stale-errwrite', storage: false, llm, capabilities: CAPS,
      data: { schema: SCHEMA, bind: { components: [{ type: 'card', title: '旧标题' }] } },
      middleware: [captureMw(calls)],
    })
    await sdk.mount()
    await sdk.send('把第一个组件标题改成新标题')
    assert(!sdk.debugLogs.value.some((l) => l.data?.stage === 'stale_read_invalidated'), '✓ 失败写 e2e → SCHEMA_INVALID 字符串写零失效留痕(失败写不是事实)')
    const readId = firstToolId(calls[1])
    const after = toolMsg(calls[2], readId)?.content ?? ''
    assert(!after.startsWith(MARK) && after.includes('旧标题'), '✓ 失败写 e2e → 旧 read 原文保留(数据没变,读不假过期)')
    // 失败写路径不进「成功写入」侧的任何失效计算:检查 write 结果确实以 ERROR: 开头(前置自证)
    const writeMsg = calls[2].filter((m) => m.type === 'tool').find((m) => m.content.startsWith('ERROR:'))
    assert(!!writeMsg && writeMsg.content.includes('SCHEMA_INVALID'), '✓ 失败写 e2e → write 结果为 ERROR: 字符串(前置自证:走的是 toolError 返回路径)')
    sdk.unmount()
  }
  return ctx
}
