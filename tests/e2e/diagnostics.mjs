// 诊断报告导出(sdk.exportDiagnostics):完整日志文件一键复制交排查(editor_fangzhou 实测需求)
import { setupEnv, createAssert, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:diagnostics] exportDiagnostics 正常工作:一轮对话后导出完整报告(日志/消息/inspect/usage/数据摘要)')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    const CAPS = { fetch: false, planning: false, skills: false, summarization: false, memory: false }
    const bind = { title: 'orig', components: [{ type: 'banner' }] }
    const llm = stubModel(
      { toolCalls: [{ name: 'read', args: {} }] },
      { text: '好的,已读取。' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-diagnostics', storage: false, llm, capabilities: CAPS,
      data: { schema: z.object({ title: z.string(), components: z.array(z.object({ type: z.string() })) }), bind, description: '页面配置' },
    })
    await sdk.mount()
    await sdk.send('看一下当前页面')
    const text = sdk.exportDiagnostics()
    assert(typeof text === 'string' && text.length > 0, '✓ exportDiagnostics 返回非空 JSON 字符串')
    const report = JSON.parse(text)
    assert(report.format === 'page-agent-sdk/diagnostics' && report.version === 1, '✓ 报告含 format/version 契约字段')
    assert(Array.isArray(report.debugLogs) && report.debugLogs.length > 0, '✓ debugLogs 全量收集进报告(完整日志文件主体)')
    assert(report.debugLogs.some((l) => l.type === 'tool_call' && l.data?.name === 'read'), '✓ 日志含本轮工具调用轨迹(read)')
    assert(Array.isArray(report.messages) && report.messages.some((m) => String(m.content ?? '').includes('看一下当前页面')), '✓ messages 含用户消息')
    assert(report.info && report.info.id === 'e2e-diagnostics' && Array.isArray(report.info.tools), '✓ info = inspect() 快照(id/tools)')
    assert(report.info.tools.every((t) => !('schema' in t)), '✓ info.tools 剥 zod schema(内部结构不可安全 JSON 化)')
    assert(report.dataSummary && report.dataSummary.description === '页面配置' && report.dataSummary.topKeys.includes('components') && report.dataSummary.approxBytes > 0, '✓ dataSummary 摘要(description/topKeys/字节量级;不 dump 全量 bind)')
    assert(report.usage && report.usage.total_tokens >= 0, '✓ usage 累计用量在报告')
    assert(report.sessionId === sdk.sessionId, '✓ sessionId 与当前会话一致(多会话排查锚点;storage 关时为 "")')
    assert(!text.includes('"_def"'), '✓ 报告无 zod 内部结构(_def;schema 已替换为 topKeys 摘要)')
    sdk.unmount()
  }

  console.log('[e2e:diagnostics] 边界:无 data(纯对话)也正常导出(dataSummary 为 null,不抛错)')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    const CAPS = { dataOps: false, fetch: false, planning: false, skills: false, summarization: false, memory: false }
    const llm = stubModel({ text: '你好!' })
    const sdk = createChatSdk({ ui: false, id: 'e2e-diagnostics-nodata', storage: false, llm, capabilities: CAPS })
    await sdk.mount()
    await sdk.send('你好')
    let ok = true
    let report = null
    try { report = JSON.parse(sdk.exportDiagnostics()) } catch { ok = false }
    assert(ok && report, '✓ 无 data 时 exportDiagnostics 不抛错且可解析')
    assert(report.dataSummary === null, '✓ 无 data → dataSummary 为 null(非崩溃)')
    assert(Array.isArray(report.debugLogs), '✓ 无 data → debugLogs 仍收集(纯对话也能排查)')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
