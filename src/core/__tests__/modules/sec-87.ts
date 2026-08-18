/**
 * sec-87 —— 诊断报告聚合(diagnostics)白盒单测
 *
 * A. buildDiagnosticsReport:形状契约(format/version/generatedAt/字段齐全)+ logs/messages 透传
 * B. maskUrlCredentials:凭据键打码(apiKey/token/signature)+ 普通键不动
 * C. 超长字符串截断(图片 dataUri 类):>50KB 字符串截断留痕,短串不动
 * D. stringifyDiagnosticsReport 总长闸:超限从最旧日志丢弃 + diagnostics_truncated 留痕
 */
import type { TestCtx } from './_ctx'
import { buildDiagnosticsReport, stringifyDiagnosticsReport, maskUrlCredentials } from '../../sdk/diagnostics'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-87] diagnostics 诊断报告聚合白盒单测')

  // ===== A. 报告形状 =====
  {
    const logs = [
      { timestamp: 1, type: 'context', data: { model: 'm' } },
      { timestamp: 2, type: 'tool_call', data: { name: 'read', args: {} } },
    ] as any[]
    const report = buildDiagnosticsReport({
      debugLogs: logs,
      messages: [{ role: 'user', content: '你好' }] as any,
      info: { id: 'x', tools: [] } as any,
      usage: { total_tokens: 42 },
      pendingConflict: null,
      sessionId: 's-1',
      dataSummary: { description: '页面', topKeys: ['title'], approxBytes: 10 },
      extra: { host: 'editor_fangzhou' },
    })
    assert(report.format === 'page-agent-sdk/diagnostics' && report.version === 1, '✓ 报告含 format/version 契约字段(消费方据此识别)')
    assert(typeof report.generatedAt === 'string' && !Number.isNaN(Date.parse(report.generatedAt as string)), '✓ generatedAt 为合法 ISO 时间')
    assert(Array.isArray(report.debugLogs) && (report.debugLogs as unknown[]).length === 2, '✓ debugLogs 全量透传(完整日志文件主体)')
    assert(Array.isArray(report.messages) && (report.messages as any[])[0].content === '你好', '✓ messages 透传')
    assert((report.info as any)?.id === 'x' && (report.usage as any)?.total_tokens === 42, '✓ info/usage 透传')
    assert((report.dataSummary as any)?.topKeys?.[0] === 'title' && (report.extra as any)?.host === 'editor_fangzhou', '✓ dataSummary/extra 透传')
    assert((report.environment as any)?.userAgent, '✓ environment.userAgent 存在(node 环境为 "node")')
    // JSON 可序列化契约
    assert(typeof JSON.stringify(report) === 'string', '✓ 报告可 JSON.stringify(无循环引用)')
  }

  // ===== B. url 凭据打码 =====
  {
    assert(maskUrlCredentials('https://h.com/p?apiKey=abc123&x=1') === 'https://h.com/p?apiKey=***&x=1', '✓ apiKey 查询参数打码')
    assert(maskUrlCredentials('https://h.com/p?token=abc&secret_key=def') === 'https://h.com/p?token=***&secret_key=***', '✓ token/secret_key 打码(大小写不敏感键匹配)')
    assert(maskUrlCredentials('https://h.com/p?page=2&sort=asc') === 'https://h.com/p?page=2&sort=asc', '✓ 非凭据键原样保留')
  }

  // ===== C. 超长字符串截断 =====
  {
    const big = 'a'.repeat(60_000)
    const report = buildDiagnosticsReport({ messages: [{ role: 'user', content: big, timestamp: 1 }] as any })
    const msg = (report.messages as any[])[0]
    assert(typeof msg.content === 'string' && msg.content.length < big.length && msg.content.includes('<truncated:'), '✓ 超长消息字符串截断并留痕(图片 dataUri 类防撑爆)')
    const small = buildDiagnosticsReport({ messages: [{ role: 'user', content: '短内容' }] as any })
    assert((small.messages as any[])[0].content === '短内容', '✓ 短字符串原样保留')
  }

  // ===== D. 总长闸 =====
  {
    // 造 >6MB 报告:120 条日志每条 ~100KB
    const logs = Array.from({ length: 120 }, (_, i) => ({ timestamp: i, type: 'llm_request', data: { payload: 'x'.repeat(100_000) } })) as any[]
    const report = buildDiagnosticsReport({ debugLogs: logs })
    const text = stringifyDiagnosticsReport(report)
    assert(text.length <= 6_000_000 + 200_000, '✓ 超总长阈值 → 截断后达标(剪贴板友好)')
    const parsed = JSON.parse(text)
    const arr = parsed.debugLogs as any[]
    assert(arr[0]?.data?.stage === 'diagnostics_truncated' && arr[0].data.droppedOldestLogs > 0, '✓ 截断留痕(头部 diagnostics_truncated 标记 + 丢弃条数)')
    assert(arr[arr.length - 1]?.data?.payload, '✓ 保留最新日志(排查相关性最高的近段)')
    // 不超限不截断
    const smallReport = buildDiagnosticsReport({ debugLogs: [{ timestamp: 1, type: 'context', data: {} }] as any[] })
    const smallText = stringifyDiagnosticsReport(smallReport)
    assert(JSON.parse(smallText).debugLogs.length === 1 && !smallText.includes('diagnostics_truncated'), '✓ 未超限不截断不留痕')
  }
}
