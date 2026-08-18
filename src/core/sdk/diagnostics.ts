/**
 * 诊断报告聚合(日志收集/调试支持,editor_fangzhou 实测需求):
 * 把 debugLogs/messages/inspect()/usage/conflict/主数据摘要一次聚合成 JSON 可序列化报告,
 * 集成方/用户一键复制交给维护者排查 —— 真实环境问题复现需要的「完整日志文件」。
 *
 * Headless-safe:纯函数,无 vue/DOM 依赖(navigator/location 防御判断,node 可用)。
 * 隐私契约:报告源不含 apiKey(inspect()/debugLogs 无凭据);url 查询串凭据键打码;
 * 主数据 bind 不 dump 全量(只摘要:描述+顶层 keys+字节量级),防 MB 级页面 JSON 撑爆剪贴板。
 */
import type { AgentInfo } from '../types'
import type { DebugLog } from '../harness/createAgent'

/** 主数据摘要(替代 dump 全量 bind) */
export interface DiagnosticsDataSummary {
  description?: string
  /** bind 顶层 key 列表(数组 bind → []) */
  topKeys: string[]
  /** bind JSON 序列化字符数(-1 = 序列化失败,如循环引用) */
  approxBytes: number
}

export interface DiagnosticsInput {
  /** 调试日志全量(报告主体;MAX_DEBUG_LOGS 环形上限内) */
  debugLogs?: DebugLog[]
  /** 对话消息(UI 可见 messages;超长字符串如图片 dataUri 自动截断) */
  messages?: Array<Record<string, unknown>>
  /** inspect() 反射快照 */
  info?: AgentInfo | null
  /** 累计 token 用量 */
  usage?: Record<string, number> | null
  /** 挂起冲突快照(无则 null) */
  pendingConflict?: unknown
  sessionId?: string
  dataSummary?: DiagnosticsDataSummary | null
  /** 集成方注入的附加信息(如宿主版本号/用户环境标识) */
  extra?: Record<string, unknown>
}

/** 单条字符串截断阈值(字符):防图片 dataUri/MB 级 code 字段单条撑爆报告 */
const MAX_STRING_CHARS = 50_000
/** 报告总长阈值(字符):超出 → 从最旧日志批量丢弃并留痕(剪贴板友好) */
const MAX_REPORT_CHARS = 6_000_000

/** url 查询串凭据键打码(*key/token/secret/password/signature* 键值 → ***) */
export function maskUrlCredentials(url: string): string {
  return url.replace(/([?&][^=&?]*(?:key|token|secret|password|signature)[^=&?]*=)[^&]*/gi, '$1***')
}

/** 深遍历截断超长字符串(结构保持;数组/对象递归) */
function truncateDeep(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_STRING_CHARS
      ? value.slice(0, MAX_STRING_CHARS) + `…<truncated:${value.length - MAX_STRING_CHARS} chars>`
      : value
  }
  if (Array.isArray(value)) return value.map(truncateDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = truncateDeep(v)
    return out
  }
  return value
}

/**
 * 聚合诊断报告对象(JSON 可序列化)。字段顺序即排查动线:环境 → 会话/用量 → 冲突 → 数据摘要 → inspect → 对话 → 日志。
 */
export function buildDiagnosticsReport(input: DiagnosticsInput): Record<string, unknown> {
  const logs = Array.isArray(input.debugLogs) ? input.debugLogs : []
  return {
    format: 'page-agent-sdk/diagnostics',
    version: 1,
    generatedAt: new Date().toISOString(),
    environment: {
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'node',
      url: typeof location !== 'undefined' ? maskUrlCredentials(location.href) : null,
    },
    sessionId: input.sessionId ?? null,
    usage: input.usage ?? null,
    pendingConflict: input.pendingConflict ?? null,
    dataSummary: input.dataSummary ?? null,
    info: input.info ? truncateDeep(input.info) : null,
    messages: (input.messages ?? []).map(truncateDeep),
    debugLogs: logs.map(truncateDeep),
    extra: input.extra ?? null,
  }
}

/**
 * 序列化为 JSON 字符串;超总长阈值时从最旧 debugLogs 批量丢弃(对半砍)直到达标,
 * 并在日志头部插一条 diagnostics_truncated 留痕(排查者知道丢了哪些、为什么)。
 */
export function stringifyDiagnosticsReport(report: Record<string, unknown>): string {
  let text = JSON.stringify(report)
  if (text.length <= MAX_REPORT_CHARS) return text
  const logs = Array.isArray(report.debugLogs) ? (report.debugLogs as unknown[]) : []
  let dropped = 0
  while (text.length > MAX_REPORT_CHARS && logs.length > 1) {
    const cut = Math.max(1, Math.floor(logs.length / 2))
    logs.splice(0, cut)
    dropped += cut
    text = JSON.stringify(report)
  }
  if (dropped > 0) {
    logs.unshift({
      timestamp: Date.now(),
      type: 'middleware',
      data: { stage: 'diagnostics_truncated', droppedOldestLogs: dropped, reason: `report > ${MAX_REPORT_CHARS} chars` },
    })
    text = JSON.stringify(report)
  }
  return text
}
