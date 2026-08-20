<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { OverlayScrollbars } from 'overlayscrollbars'
import 'overlayscrollbars/overlayscrollbars.css'
import type { DebugLog } from '../harness/createAgent'
import type { AgentInfo } from '../types'
import type { TraceSpan } from '../harness/createAgent'
import { copyText } from '../utils/clipboard'
import { buildDiagnosticsReport, stringifyDiagnosticsReport } from '../sdk/diagnostics'
import { MESSAGES_ZH_CN, type DialogLocale, type DialogMessages } from './messages'

const props = withDefaults(defineProps<{
  logs?: DebugLog[]
  visible: boolean
  /** 获取 agent 详细信息(「Agent 信息」tab 展示) */
  getInfo?: () => AgentInfo
  /** 导出诊断报告 JSON(sdk.exportDiagnostics 透传;缺省时从 logs+getInfo 本地聚合降级) */
  exportDiagnostics?: () => string
  /** Agent 信息刷新 tick(setSkills/setData 后 ++);watch 后重新拉 getInfo() 实时反映动态 skill/data */
  infoTick?: Ref<number>
  /** 读取 skill 全文(展开 skill 时调,优先缓存);返回 null 表示无内容或读取失败 */
  getSkillContent?: (name: string) => Promise<string | null>
  /** 内置主题:'light'(默认)/ 'dark'(方舟设计稿色板;ChatDialog 自动透传自身 theme) */
  csTheme?: 'light' | 'dark'
  /** 文案集(dialog.locale/messages 解析结果;独立复用缺省中文) */
  messages?: DialogMessages
  /** 时间格式 locale(formatTime;缺省 zh-CN 24h) */
  locale?: DialogLocale
}>(), {
  logs: () => [],
  messages: () => MESSAGES_ZH_CN,
  locale: 'zh-CN',
})

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'clear'): void
}>()

const filter = ref<DebugLog['type'] | 'all'>('all')
const rawExpanded = ref<Set<number>>(new Set())

// 滚动条替换(OverlayScrollbars v2):.drawer-body(日志主滚动区)隐藏原生滚动条换 overlay 自定义滚动条;
// 主题经 --dd-scrollbar-* 映射(与 ChatDialog --cs-scrollbar-* 同构);destroy 后回落原生滚动。
// drawer 是 v-if 挂载(visible 时才存在 DOM)→ 初始化挂在 visible watch + onMounted 双入口(幂等)
const drawerBodyEl = ref<HTMLElement | null>(null)
const drawerViewportEl = ref<HTMLElement | null>(null)
const drawerContentsEl = ref<HTMLElement | null>(null)
let osInstance: ReturnType<typeof OverlayScrollbars> | null = null
function initOs(): void {
  if (osInstance || !drawerBodyEl.value || !drawerViewportEl.value || !drawerContentsEl.value) return
  osInstance = OverlayScrollbars(
    // 对象初始化:认领模板自有三层,不生成不搬运 DOM(与 Vue patch 和解)
    { target: drawerBodyEl.value, elements: { viewport: drawerViewportEl.value, content: drawerContentsEl.value } },
    {
      overflow: { x: 'hidden' },
      scrollbars: { autoHide: 'scroll', autoHideDelay: 700, clickScroll: true },
    },
  )
}
onMounted(initOs)
watch(() => props.visible, async (v) => { if (v) { await nextTick(); initOs() } })
onBeforeUnmount(() => { osInstance?.destroy(); osInstance = null })
const bodyExpanded = ref<Set<number>>(new Set())
/** llm_request 长消息展开状态(key=`${日志序}:${消息序}`);超长消息默认 3 行截断点击展开 —— system prompt 动辄数 KB,全展开淹没列表 */
const msgExpanded = ref<Set<string>>(new Set())
function toggleMsg(key: string) { const s = msgExpanded.value; s.has(key) ? s.delete(key) : s.add(key) }
/** 长消息折叠阈值(字符) */
const MSG_COLLAPSE_CHARS = 400
/** llm_request「只看新增」(key=日志序;默认关保持全量语义;开=只渲染相对上一次请求新增的消息) */
const onlyNewSet = ref<Set<number>>(new Set())
function toggleOnlyNew(idx: number) { const s = onlyNewSet.value; s.has(idx) ? s.delete(idx) : s.add(idx) }
/** 复制反馈(1.2s 显示 ✓;key=按钮标识) */
const copiedKey = ref('')
async function copyJson(text: string, key: string) {
  const ok = await copyText(text)
  if (!ok) return
  copiedKey.value = key
  setTimeout(() => { if (copiedKey.value === key) copiedKey.value = '' }, 1200)
}
/**
 * 下载诊断报告 JSON 文件(完整日志,一键交给维护者排查):
 * 优先 sdk.exportDiagnostics 透传(含 messages/usage/conflict 全量);独立复用(headless 纯 props)降级本地聚合 logs+getInfo()。
 * (原「复制到剪贴板」改为下载:大体积日志 clipboard 常被截断/静默失败,文件交付更可靠)
 */
function downloadReport() {
  let text = ''
  try {
    text = props.exportDiagnostics
      ? props.exportDiagnostics()
      : stringifyDiagnosticsReport(buildDiagnosticsReport({
          debugLogs: logs.value,
          info: props.getInfo ? props.getInfo() : null,
        }))
  } catch { text = '' }
  if (!text) return
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `page-agent-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  a.click()
  URL.revokeObjectURL(url)
  copiedKey.value = 'report'
  setTimeout(() => { if (copiedKey.value === 'report') copiedKey.value = '' }, 1200)
}
const m = computed(() => props.messages)

const typeMeta = computed<Record<string, { label: string; color: string; icon: string }>>(() => ({
  context: { label: m.value.debugTypeContext, color: 'var(--cs-primary)', icon: '🧩' },
  llm_request: { label: m.value.debugTypeLlmRequest, color: '#059669', icon: '➡️' },
  llm_response: { label: m.value.debugTypeLlmResponse, color: '#d97706', icon: '⬅️' },
  tool_call: { label: m.value.debugTypeToolCall, color: '#7c3aed', icon: '🔧' },
  tool_result: { label: m.value.debugTypeToolResult, color: '#2563eb', icon: '✅' },
  error: { label: m.value.debugTypeError, color: '#dc2626', icon: '❌' },
  middleware: { label: m.value.debugTypeMiddleware, color: '#0891b2', icon: '⚙️' },
}))

const logs = computed(() => (Array.isArray(props.logs) ? props.logs : []))
const filteredLogs = computed(() =>
  filter.value === 'all' ? logs.value : logs.value.filter((l) => l.type === filter.value)
)

const counts = computed(() => {
  const c: Record<string, number> = { all: logs.value.length }
  for (const l of logs.value) c[l.type] = (c[l.type] || 0) + 1
  return c
})

/**
 * 展示条目(logs tab):tool_call ↔ tool_result 配对(同名 FIFO)+ llm_request 相对上一次请求的消息基线。
 * - 配对:result 到达时与最近的未配对同名 call 合并为一张卡(args+result+耗时一屏看完一步调用);未配对 call = 在途
 * - prevMsgCount:按全量 logs 序(不受 filter 影响)记录上一个 llm_request 的消息数 →「只看新增」差分视图
 * - uid:按日志对象身份分配的展示 id(WeakMap 稳定)—— 展开/差分等 UI 状态的 key;不用数组下标,
 *   filter 切换/分组重排不串状态;配对卡沿用 call 的 uid(卡片视觉位置不变,已展开状态不丢)
 */
interface DisplayEntry { log: DebugLog; pairCall?: DebugLog; prevMsgCount?: number; uid: number }
let uidSeq = 0
const uidMap = new WeakMap<DebugLog, number>()
function uidOf(log: DebugLog): number {
  let id = uidMap.get(log)
  if (id == null) { id = ++uidSeq; uidMap.set(log, id) }
  return id
}
const displayLogs = computed<DisplayEntry[]>(() => {
  const src = filteredLogs.value
  const doPair = filter.value === 'all' || filter.value === 'tool_call' || filter.value === 'tool_result'
  const prevMap = new Map<DebugLog, number>()
  let lastLen = 0
  for (const lg of logs.value) {
    if (lg.type === 'llm_request') {
      prevMap.set(lg, lastLen)
      lastLen = (lg.data as any)?.messages?.length ?? 0
    }
  }
  const out: DisplayEntry[] = []
  const pending = new Map<string, DebugLog[]>()
  for (const log of src) {
    if (log.type === 'llm_request') { out.push({ log, prevMsgCount: prevMap.get(log), uid: uidOf(log) }); continue }
    if (!doPair || (log.type !== 'tool_call' && log.type !== 'tool_result')) { out.push({ log, uid: uidOf(log) }); continue }
    if (log.type === 'tool_call') {
      const name = String(log.data?.name ?? '')
      const q = pending.get(name) ?? []
      q.push(log); pending.set(name, q)
      out.push({ log, uid: uidOf(log) })
    } else {
      const call = pending.get(String(log.data?.name ?? ''))?.shift()
      if (call) {
        const i = out.findIndex((e) => e.log === call)
        const entry: DisplayEntry = { log, pairCall: call, uid: uidOf(call) }
        if (i >= 0) out[i] = entry
        else out.push(entry)
      } else out.push({ log, uid: uidOf(log) })
    }
  }
  return out
})

/**
 * 轮次分组(logs tab 每轮一个可折叠 node):
 * - 运行边界 = 主 agent 的 context 日志(每次 run 开头一条)→ epoch 递增,防跨 send 的同轮号合并
 * - 主 agent 日志按自身 round 归组;wrap_up(兜底收口)单独成组;无 round 的日志归「当前轮」
 *   (首轮前 → 本 epoch 的准备组;轮内 middleware/error 等 → 所在轮,「每一轮全部信息集中一个 node」)
 * - 子 agent 转发日志(带 source)归属主 agent 当时所在轮(子运行发生在主某轮的工具调用内)
 */
interface LogGroupKey { epoch: number; kind: 'pre' | 'round' | 'wrap_up'; round?: number }
const logGroupKeys = computed(() => {
  const map = new WeakMap<DebugLog, LogGroupKey>()
  let epoch = 0
  let curRound = 0
  for (const lg of logs.value) {
    if (!lg.source && lg.type === 'context') { epoch++; curRound = 0; map.set(lg, { epoch, kind: 'pre' }); continue }
    const r = (lg.data as any)?.round
    if (!lg.source && typeof r === 'number' && r > 0) { curRound = r; map.set(lg, { epoch, kind: 'round', round: r }); continue }
    if (!lg.source && r === 'wrap_up') { map.set(lg, { epoch, kind: 'wrap_up' }); continue }
    map.set(lg, curRound > 0 ? { epoch, kind: 'round', round: curRound } : { epoch, kind: 'pre' })
  }
  return map
})

interface LogGroup {
  key: string
  kind: 'pre' | 'round' | 'wrap_up'
  round?: number
  entries: DisplayEntry[]
  firstTs: number
  lastTs: number
  toolCount: number
  tokens: number | null
  errorCount: number
}
const logGroups = computed<LogGroup[]>(() => {
  const keys = logGroupKeys.value
  const byKey = new Map<string, LogGroup>()
  const order: LogGroup[] = []
  for (const entry of displayLogs.value) {
    const k = keys.get(entry.log) ?? { epoch: 0, kind: 'pre' as const }
    const gk = `${k.epoch}:${k.kind}:${k.round ?? ''}`
    let g = byKey.get(gk)
    if (!g) {
      g = { key: gk, kind: k.kind, round: k.round, entries: [], firstTs: entry.log.timestamp, lastTs: entry.log.timestamp, toolCount: 0, tokens: null, errorCount: 0 }
      byKey.set(gk, g); order.push(g)
    }
    g.entries.push(entry)
    if (entry.log.timestamp < g.firstTs) g.firstTs = entry.log.timestamp
    if (entry.log.timestamp > g.lastTs) g.lastTs = entry.log.timestamp
    if (entry.log.type === 'tool_call') g.toolCount++
    if (entry.log.type === 'error' || (entry.log.type === 'tool_result' && entry.log.data?.status === 'error')) g.errorCount++
    const usage = entry.log.type === 'llm_response' ? entry.log.data?.usage : undefined
    if (usage?.total_tokens != null) g.tokens = (g.tokens ?? 0) + usage.total_tokens
  }
  return order
})

/** 分组展开态:默认只展开最新一组(在途轮天然展开;新轮到来旧轮自动收起);用户显式切换记入 forceOpen/forceClosed 覆盖默认 */
const forceOpen = ref<Set<string>>(new Set())
const forceClosed = ref<Set<string>>(new Set())
const lastGroupKey = computed(() => logGroups.value.length ? logGroups.value[logGroups.value.length - 1].key : '')
function isGroupExpanded(key: string): boolean {
  if (forceOpen.value.has(key)) return true
  if (forceClosed.value.has(key)) return false
  return key === lastGroupKey.value
}
function toggleGroup(key: string) {
  const o = new Set(forceOpen.value)
  const c = new Set(forceClosed.value)
  if (isGroupExpanded(key)) { o.delete(key); c.add(key) } else { c.delete(key); o.add(key) }
  forceOpen.value = o
  forceClosed.value = c
}
function groupLabel(g: LogGroup): string {
  if (g.kind === 'pre') return m.value.debugFlowPrep
  if (g.kind === 'wrap_up') return m.value.debugLogsWrapUp
  return `${m.value.debugRoundPrefix}${g.round}${m.value.debugRoundSuffix}`
}

/** llm_request 消息视图(只看新增=切掉与上一次请求重复的前缀;base=切掉数,供消息 key/折叠 key 锚定原始下标) */
function reqMsgView(log: DebugLog, prev: number | undefined, only: boolean): { list: any[]; base: number } {
  const all: any[] = (log.data as any)?.messages ?? []
  if (only && prev != null && prev > 0 && prev < all.length) return { list: all.slice(prev), base: prev }
  return { list: all, base: 0 }
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString(props.locale, { hour12: false }) +
    '.' + String(ts % 1000).padStart(3, '0')
}

function toggleRaw(idx: number) {
  const s = new Set(rawExpanded.value)
  s.has(idx) ? s.delete(idx) : s.add(idx)
  rawExpanded.value = s
}

function toggleBody(idx: number) {
  const s = new Set(bodyExpanded.value)
  s.has(idx) ? s.delete(idx) : s.add(idx)
  bodyExpanded.value = s
}

function formatJson(data: any): string {
  try { return JSON.stringify(data, null, 2) } catch { return String(data) }
}

const roleMeta: Record<string, { label: string; color: string }> = {
  system: { label: 'SYSTEM', color: '#6b7280' },
  human: { label: 'USER', color: 'var(--cs-primary)' },
  user: { label: 'USER', color: 'var(--cs-primary)' },
  ai: { label: 'AI', color: '#059669' },
  assistant: { label: 'AI', color: '#059669' },
  tool: { label: 'TOOL', color: '#2563eb' },
}

function roleOf(t: string) {
  return roleMeta[t] || { label: (t || '?').toUpperCase(), color: '#9ca3af' }
}

function close() { emit('update:visible', false) }
function clearLogs() {
  rawExpanded.value = new Set()
  forceOpen.value = new Set()
  forceClosed.value = new Set()
  emit('clear')
}

const tab = ref<'logs' | 'flow' | 'trace' | 'context' | 'subagent' | 'info'>('logs')
const agentInfo = ref<AgentInfo | null>(null)
// skill 全文展开状态:name → { loading, content, error }
const skillExpanded = ref<Record<string, { loading: boolean; content: string | null; error?: string }>>({})
async function toggleSkill(name: string) {
  const cur = skillExpanded.value[name]
  if (cur) {
    // 已展开 → 收起
    delete skillExpanded.value[name]
    skillExpanded.value = { ...skillExpanded.value }
    return
  }
  // 展开:若无 getSkillContent,提示不可用
  if (!props.getSkillContent) {
    skillExpanded.value = { ...skillExpanded.value, [name]: { loading: false, content: null, error: m.value.debugSkillNoReader } }
    return
  }
  skillExpanded.value = { ...skillExpanded.value, [name]: { loading: true, content: null } }
  try {
    const content = await props.getSkillContent(name)
    skillExpanded.value = { ...skillExpanded.value, [name]: { loading: false, content, error: content == null ? m.value.debugSkillEmpty : undefined } }
  } catch (e: any) {
    skillExpanded.value = { ...skillExpanded.value, [name]: { loading: false, content: null, error: String(e?.message || e) } }
  }
}
function refreshInfo() {
  if (props.getInfo) {
    try { agentInfo.value = props.getInfo() } catch { agentInfo.value = null }
  }
}
function switchTab(t: 'logs' | 'flow' | 'trace' | 'context' | 'subagent' | 'info') {
  tab.value = t
  // 切到「子 agent」/「Agent 信息」/「上下文」时实时拉取(含动态 active/history / todos / 上下文快照)
  if (t === 'subagent' || t === 'info' || t === 'context') refreshInfo()
}
// infoTick 变化(setSkills/setData 后 ++):抽屉可见且停在 subagent/info/context tab 时实时刷新,反映动态 skill/data/子 agent 状态
watch(() => props.infoTick?.value, () => {
  if (props.visible && (tab.value === 'subagent' || tab.value === 'info' || tab.value === 'context')) refreshInfo()
})
const statusMeta = computed<Record<string, { label: string; color: string }>>(() => ({
  pending: { label: m.value.debugTodoPending, color: '#9ca3af' },
  in_progress: { label: m.value.debugTodoInProgress, color: '#d97706' },
  completed: { label: m.value.debugTodoCompleted, color: '#059669' },
}))
function statusLabel(s: string) { return statusMeta.value[s]?.label ?? s }
/** 偏好 topic 中文标签(DebugDrawer 展示用;与 harness/preferences.ts 注入段标签同源语义) */
function topicLabel(t: string) {
  const labels: Record<string, string> = { color: m.value.debugPrefTopicColor, copy: m.value.debugPrefTopicCopy, layout: m.value.debugPrefTopicLayout, interaction: m.value.debugPrefTopicInteraction, tech: m.value.debugPrefTopicTech, other: m.value.debugPrefTopicOther }
  return labels[t] ?? t
}
/** 工具来源标签样式类(builtin/mcp/user) */
function srcClass(s?: string) {
  if (!s) return ''
  if (s === 'builtin') return 'builtin'
  if (s.startsWith('mcp:')) return 'mcp'
  return 'user'
}
/** 流程视图:按 round 分组(llm_request/response + tool_call/result 有 round);无 round 的(context/error/middleware)归「准备」 */
const flowRounds = computed(() => {
  const map = new Map<number, DebugLog[]>()
  const pre: DebugLog[] = []
  for (const lg of logs.value) {
    const r = (lg.data as any)?.round
    if (typeof r === 'number' && r > 0) {
      if (!map.has(r)) map.set(r, [])
      map.get(r)!.push(lg)
    } else {
      pre.push(lg)
    }
  }
  const rounds = [...map.entries()].sort((a, b) => a[0] - b[0]).map(([round, items]) => ({ round, items }))
  return { pre, rounds }
})
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}
/** 耗时展示:≥1000ms 用 s(如 1234 → 1.2s);子 agent 长任务动辄数十秒,纯 ms 数字过长 */
function formatDuration(ms: number): string {
  if (ms >= 1000) {
    const s = ms / 1000
    return s >= 10 ? `${Math.round(s)}s` : `${s.toFixed(1)}s`
  }
  return `${ms}ms`
}
/** trace(observability-tracing):spans + metrics 从 agentInfo.trace 读 */
const traceSpans = computed<TraceSpan[]>(() => agentInfo.value?.trace?.spans ?? [])
const traceMetrics = computed(() => agentInfo.value?.trace?.metrics)
/** 上下文构成(context-inspector):从 agentInfo.context 读最近 wrapModelCall 快照 */
const contextSnap = computed(() => agentInfo.value?.context)
/** 占用色阶:绿(<阈值)< 黄(≥阈值)< 红(≥1 超窗口) */
const ctxOccupancyLevel = computed<'green' | 'yellow' | 'red' | ''>(() => {
  const s = contextSnap.value
  if (!s) return ''
  if (s.occupancy >= 1) return 'red'
  if (s.thresholdRatio > 0 && s.occupancy >= s.thresholdRatio) return 'yellow'
  return 'green'
})
/** 子 agent 观察层(subagent-observability):active 运行态 + history 历史 */
const subagentActive = computed(() => agentInfo.value?.subagent?.active ?? [])
const subagentHistory = computed(() => agentInfo.value?.subagent?.history ?? [])
/** 组件锁视图(组件名 → 占用委派 taskId;parallel-subagent-delegation Q4b) */
const lockedEntries = computed(() => Object.entries(agentInfo.value?.subagent?.lockedComponents ?? {}))
const subStatusMeta = computed<Record<string, { label: string; color: string }>>(() => ({
  running: { label: m.value.debugSubRunning, color: '#059669' },
  done: { label: m.value.debugSubDone, color: '#6b7280' },
  error: { label: m.value.debugSubError, color: '#dc2626' },
}))
const subExpanded = ref<Set<number>>(new Set())
function toggleSub(idx: number) {
  const s = new Set(subExpanded.value)
  s.has(idx) ? s.delete(idx) : s.add(idx)
  subExpanded.value = s
}
function spanIcon(t: string) { return t === 'round' ? '🔄' : t === 'model' ? '🧠' : t === 'tool' ? '🔧' : t === 'compression' ? '📦' : '•' }
// 压缩决策摘要(agent-driven-compression;DebugDrawer 上下文 tab + lastCompression 显示)
function decisionSummary(d: { keepRounds?: number; windowRatio?: number; summarize: { mode: string }; recallTopK?: number; reason?: string }): string {
  const main = d.windowRatio != null ? `windowRatio=${d.windowRatio}` : `keepRounds=${d.keepRounds ?? '?'}`
  return `${main} · ${d.summarize.mode}${m.value.debugSummaryMode} · ${m.value.debugCtxRecalled}${d.recallTopK ?? '?'}${d.reason ? ' · ' + d.reason : ''}`
}
/** 流程节点摘要(每轮流水一览;详情看「日志」tab) */
function flowNodeDetail(lg: DebugLog): string {
  const d = (lg.data || {}) as any
  switch (lg.type) {
    case 'context': return `${d.tools?.length ?? 0}${m.value.debugToolCountSuffix} · ${d.totalMessages ?? 0}${m.value.debugMsgCountSuffix}`
    case 'llm_request': return `${(d.messages || []).length}${m.value.debugMsgCountSuffix}${d.tools?.length ? ' · ' + d.tools.length + m.value.debugToolCountSuffix : ''}`
    case 'llm_response': return d.toolCalls?.length ? `${d.toolCalls.length}${m.value.debugToolCallsSuffix}` : (d.content ? truncate(String(d.content), 50) : '')
    case 'tool_call': return String(d.name ?? '')
    case 'tool_result': return `${d.name ?? ''} · ${d.status === 'error' ? '❌' : '✅'}`
    case 'error': return truncate(String(d.error ?? d.tool ?? ''), 60)
    case 'middleware': return String(d.stage ?? '')
    default: return ''
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="visible" class="debug-drawer">
        <div class="drawer-panel" :class="{ 'cs-theme-dark': csTheme === 'dark' }">
          <div class="drawer-header">
            <div class="tab-group">
              <button class="tab-btn" :class="{ active: tab === 'logs' }" @click="switchTab('logs')">🐛 {{ m.debugTabLogs }}</button>
              <button class="tab-btn" :class="{ active: tab === 'flow' }" @click="switchTab('flow')">🔀 {{ m.debugTabFlow }}</button>
              <button v-if="getInfo" class="tab-btn" :class="{ active: tab === 'trace' }" @click="switchTab('trace')">🌳 Trace</button>
              <button v-if="getInfo" class="tab-btn" :class="{ active: tab === 'context' }" @click="switchTab('context')">📊 {{ m.debugTabContext }}</button>
              <button v-if="getInfo" class="tab-btn" :class="{ active: tab === 'subagent' }" @click="switchTab('subagent')">🤖 {{ m.debugTabSubagent }}</button>
              <button v-if="getInfo" class="tab-btn" :class="{ active: tab === 'info' }" @click="switchTab('info')">🧬 {{ m.debugTabInfo }}</button>
            </div>
            <div class="header-actions">
              <button class="hd-btn" :title="m.debugCopyReport" @click="downloadReport">{{ copiedKey === 'report' ? '✓' : '💾' }}</button>
              <button v-if="tab === 'logs'" class="hd-btn" :title="m.debugClearLogs" @click="clearLogs">🗑️</button>
              <button class="hd-btn" :title="m.close" @click="close">✕</button>
            </div>
          </div>

          <div v-if="tab === 'logs'" class="drawer-filters">
            <button
              v-for="(meta, key) in typeMeta"
              :key="key"
              class="filter-chip"
              :class="{ active: filter === key }"
              :style="{ '--chip-color': meta.color }"
              @click="filter = key as DebugLog['type']"
            >
              {{ meta.icon }} {{ meta.label }}
              <span class="chip-count">{{ counts[key] || 0 }}</span>
            </button>
            <button class="filter-chip all" :class="{ active: filter === 'all' }" @click="filter = 'all'">
              {{ m.debugFilterAll }} <span class="chip-count">{{ counts.all || 0 }}</span>
            </button>
          </div>

          <!-- host(.drawer-body)/viewport(.drawer-scroll-viewport)/contents 三层为模板自有结构,
               OverlayScrollbars 经对象初始化认领(elements.viewport/content)—— 不生成不搬运 DOM 节点
               (默认元素初始化挪节点,与 Vue patch 冲突致 insertBefore 崩) -->
          <div class="drawer-body" ref="drawerBodyEl">
            <div class="drawer-scroll-viewport" tabindex="-1" ref="drawerViewportEl">
              <div ref="drawerContentsEl">
            <div v-if="tab === 'trace'" class="trace-panel">
              <div v-if="!traceMetrics" class="trace-empty">{{ m.debugTraceEmpty }}</div>
              <template v-else>
                <div class="trace-metrics">
                  <div class="metric-card"><span>{{ m.debugMetricRounds }}</span><b>{{ traceMetrics.rounds }}</b></div>
                  <div class="metric-card"><span>{{ m.debugMetricTotal }}</span><b>{{ traceMetrics.totalDurationMs }}ms</b></div>
                  <div class="metric-card"><span>{{ m.debugMetricAvg }}</span><b>{{ traceMetrics.avgRoundMs }}ms</b></div>
                  <div class="metric-card"><span>{{ m.debugMetricTools }}</span><b>{{ traceMetrics.toolCalls }}(✅{{ Math.round(traceMetrics.toolSuccessRate * 100) }}%)</b></div>
                  <div class="metric-card" v-if="traceMetrics.compressions"><span>{{ m.debugMetricCompressions }}</span><b>{{ traceMetrics.compressions }}</b></div>
                  <div class="metric-card" v-if="traceMetrics.totalTokens"><span>Token</span><b>{{ traceMetrics.totalTokens.total }}</b></div>
                </div>
                <div class="trace-spans">
                  <div v-for="s in traceSpans" :key="s.id" class="trace-span" :class="[s.type, s.status]">
                    <span class="span-ico">{{ spanIcon(s.type) }}</span>
                    <span class="span-name">{{ s.name }}</span>
                    <span class="span-dur" v-if="s.durationMs">{{ formatDuration(s.durationMs) }}</span>
                    <span class="span-status" v-if="s.status === 'error'">❌</span>
                  </div>
                </div>
              </template>
            </div>
            <div v-if="tab === 'context'" class="context-panel">
              <div v-if="!contextSnap" class="trace-empty">{{ m.debugCtxEmpty }}</div>
              <template v-else>
                <div class="ctx-overview">
                  <div class="ctx-occupancy">
                    <div class="ctx-bar-track" :title="`${m.debugCtxOccupancy} ${Math.round(contextSnap.occupancy * 100)}%`">
                      <div class="ctx-bar-fill" :class="ctxOccupancyLevel" :style="{ width: Math.min(contextSnap.occupancy * 100, 100) + '%' }"></div>
                      <div v-if="contextSnap.thresholdRatio > 0" class="ctx-threshold-mark" :style="{ left: Math.min(contextSnap.thresholdRatio * 100, 100) + '%' }" :title="m.debugCtxThreshold"></div>
                    </div>
                    <span class="ctx-pct">{{ Math.round(contextSnap.occupancy * 100) }}%</span>
                  </div>
                  <div class="ctx-kv-row">
                    <span class="ctx-kv">{{ m.debugCtxTokens }} {{ contextSnap.totalTokens }} token</span>
                    <span class="ctx-kv" v-if="contextSnap.contextWindow">{{ m.debugCtxWindow }} {{ contextSnap.contextWindow }}</span>
                    <span class="ctx-kv" v-if="contextSnap.thresholdRatio > 0">{{ m.debugCtxThresholdPct }} {{ Math.round(contextSnap.thresholdRatio * 100) }}%</span>
                  </div>
                </div>
                <div class="ctx-section-title">{{ m.debugCtxCategories }}</div>
                <div v-for="c in contextSnap.categories" :key="c.key" class="ctx-cat">
                  <span class="ctx-cat-label" :title="c.label">{{ c.label }}</span>
                  <div class="ctx-cat-bar"><div class="ctx-cat-fill" :style="{ width: Math.max(Math.round(c.pct * 100), 2) + '%' }"></div></div>
                  <span class="ctx-cat-tokens">{{ c.tokens }} <i>({{ Math.round(c.pct * 100) }}%)</i></span>
                </div>
                <div v-if="contextSnap.compression" class="ctx-compression">
                  <div class="ctx-section-title">{{ m.debugCtxLastCompression }}</div>
                  <div class="ctx-kv-row">
                    <span class="ctx-kv">{{ m.debugCtxSummarized }} {{ contextSnap.compression.roundsSummarized }}/{{ contextSnap.compression.roundsTotal }}{{ m.debugCtxRoundsSuffix }}</span>
                    <span class="ctx-kv">{{ m.debugCtxRecalled }} {{ contextSnap.compression.roundsRecalled }}</span>
                    <span class="ctx-kv">{{ contextSnap.compression.strategy }}</span>
                    <span class="ctx-kv" v-if="contextSnap.compression.decision">🤖 {{ m.debugCtxAgentDecision }}{{ decisionSummary(contextSnap.compression.decision) }}</span>
                  </div>
                </div>
              </template>
            </div>
            <div v-if="tab === 'subagent'" class="subagent-panel">
              <!-- 组件锁视图(同组件单委派互斥;委派结束自动解锁) -->
              <div v-if="lockedEntries.length" class="sub-section">
                <div class="sub-section-title">🔒 {{ m.debugLocksTitle }} ({{ lockedEntries.length }})</div>
                <div v-for="[name, owner] in lockedEntries" :key="'lock-'+name" class="sub-task">🔒 {{ name }} ← {{ owner }}</div>
              </div>
              <div v-if="!subagentActive.length && !subagentHistory.length" class="trace-empty">
                {{ m.debugSubagentEmpty }}
              </div>
              <template v-else>
                <div v-if="subagentActive.length" class="sub-section">
                  <div class="sub-section-title">▶ {{ m.debugSubRunningTitle }} ({{ subagentActive.length }})</div>
                  <div v-for="(s, i) in subagentActive" :key="'a'+i" class="sub-card" :class="s.status">
                    <div class="sub-head">
                      <span class="sub-status" :style="{ background: (subStatusMeta[s.status] && subStatusMeta[s.status].color) || '#9ca3af' }">{{ (subStatusMeta[s.status] && subStatusMeta[s.status].label) || s.status }}</span>
                      <span class="sub-label">{{ s.label }}</span>
                      <span class="sub-steps-badge">{{ s.steps.length }}{{ m.debugStepsCountSuffix }}</span>
                    </div>
                    <div class="sub-task">{{ truncate(s.task, 80) }}</div>
                  </div>
                </div>
                <div v-if="subagentHistory.length" class="sub-section">
                  <div class="sub-section-title">🕐 {{ m.debugSubHistoryTitle }} ({{ subagentHistory.length }})</div>
                  <div v-for="(s, i) in subagentHistory" :key="'h'+i" class="sub-card" :class="s.status">
                    <div class="sub-head">
                      <span class="sub-status" :style="{ background: (subStatusMeta[s.status] && subStatusMeta[s.status].color) || '#9ca3af' }">{{ (subStatusMeta[s.status] && subStatusMeta[s.status].label) || s.status }}</span>
                      <span class="sub-label">{{ s.label }}</span>
                      <span v-if="s.durationMs != null" class="sub-dur">{{ formatDuration(s.durationMs) }}</span>
                      <button v-if="s.steps.length" class="sub-toggle" @click="toggleSub(i)">{{ subExpanded.has(i) ? m.collapse : m.debugStepsBtn }}</button>
                    </div>
                    <div class="sub-task">{{ truncate(s.task, 80) }}</div>
                    <div v-if="s.resultPreview" class="sub-result">{{ s.resultPreview }}</div>
                    <div v-if="subExpanded.has(i) && s.steps.length" class="sub-steps-list">
                      <div v-for="(st, si) in s.steps" :key="si" class="sub-step">
                        <span class="sub-step-kind">{{ st.kind === 'tool_call' ? '🔧' : '✅' }}</span>
                        <span class="sub-step-name">{{ st.name }}</span>
                        <span class="sub-step-ts">{{ formatTime(st.ts) }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
            <template v-if="tab === 'logs'">
            <div v-if="filteredLogs.length === 0" class="empty">
              {{ m.debugLogsEmpty }}
            </div>

            <!-- 轮次分组:每一轮全部信息集中成一个可折叠 node;头部只展示轮次+摘要,点击展开细节。
                 v-show 保留折叠轮 DOM(生成期实时刷新/外部按 DOM 计数的断言不受影响) -->
            <div v-for="g in logGroups" :key="g.key" class="log-group">
              <div class="log-group-head" :class="{ expanded: isGroupExpanded(g.key) }" @click="toggleGroup(g.key)">
                <span class="log-group-arrow" :class="{ open: isGroupExpanded(g.key) }">▶</span>
                <span class="log-group-title">{{ groupLabel(g) }}</span>
                <span class="log-group-meta">{{ formatTime(g.firstTs) }}<template v-if="g.lastTs > g.firstTs"> ~ {{ formatTime(g.lastTs) }}</template> · {{ formatDuration(g.lastTs - g.firstTs) }}</span>
                <span v-if="g.toolCount" class="lg-badge">🔧 {{ g.toolCount }}</span>
                <span v-if="g.tokens != null" class="lg-badge">Σ {{ g.tokens }} tok</span>
                <span v-if="g.errorCount" class="lg-badge err">❌ {{ g.errorCount }}</span>
              </div>
              <div v-show="isGroupExpanded(g.key)" class="log-group-body">
            <div v-for="{ log, pairCall, prevMsgCount, uid } in g.entries" :key="uid" class="log-item">
              <div class="log-head">
                <span class="log-type" :style="{ background: typeMeta[log.type].color }">
                  {{ typeMeta[log.type].icon }} {{ typeMeta[log.type].label }}
                </span>
                <span v-if="log.source" class="log-source">↳ {{ log.source }}</span>
                <span class="log-time">{{ formatTime(log.timestamp) }}</span>
              </div>

              <div class="log-body">
                <!-- 上下文：模型配置 + 工具列表 + 消息列表 -->
                <template v-if="log.type === 'context'">
                  <div class="kv-grid">
                    <div class="kv"><span class="k">{{ m.debugModel }}</span><span class="v">{{ log.data.model }}</span></div>
                    <div class="kv"><span class="k">{{ m.debugTemperature }}</span><span class="v">{{ log.data.temperature }}</span></div>
                    <div class="kv"><span class="k">MaxTokens</span><span class="v">{{ log.data.maxTokens }}</span></div>
                    <div class="kv"><span class="k">{{ m.debugMessageCount }}</span><span class="v">{{ log.data.totalMessages }}</span></div>
                  </div>
                  <div class="section-label">{{ m.debugToolsLabel }} ({{ log.data.tools?.length || 0 }})</div>
                  <div class="chip-row">
                    <span v-for="t in log.data.tools" :key="t" class="tool-chip">{{ t }}</span>
                  </div>
                  <div class="section-label">{{ m.debugContextMessages }}</div>
                  <div class="msg-list">
                    <div v-for="(m, mi) in log.data.messages" :key="mi" class="msg-row">
                      <span class="msg-role" :style="{ background: roleOf(m.type).color }">{{ roleOf(m.type).label }}</span>
                      <span class="msg-text">{{ m.content }}</span>
                    </div>
                  </div>
                </template>

                <!-- LLM 请求：轮次 + 消息列表（只看新增差分 + 长消息折叠 + 复制全文） -->
                <template v-else-if="log.type === 'llm_request'">
                  <div class="badge-row">
                    <span class="badge">{{ m.debugRoundPrefix }}{{ log.data.round }}{{ m.debugRoundSuffix }}</span>
                    <span v-if="log.data.model" class="badge muted">{{ log.data.model }}</span>
                    <span class="badge muted">{{ (log.data.messages || []).length }}{{ m.debugMsgCountSuffix }}<template v-if="prevMsgCount != null && prevMsgCount < (log.data.messages || []).length">(+{{ (log.data.messages || []).length - prevMsgCount }})</template></span>
                    <span v-if="log.data.tools?.length" class="badge muted">{{ log.data.tools.length }}{{ m.debugToolCountSuffix }}</span>
                    <button v-if="prevMsgCount != null && prevMsgCount > 0" class="view-toggle only-new-btn" @click="toggleOnlyNew(uid)">
                      {{ onlyNewSet.has(uid) ? m.debugShowAll : m.debugOnlyNew }}
                    </button>
                    <button class="view-toggle copy-btn" :title="m.copy" @click="copyJson(formatJson(log.data.messages), 'req' + uid)">
                      {{ copiedKey === 'req' + uid ? '✓' : '📋' }}
                    </button>
                    <button class="view-toggle" @click="toggleBody(uid)">
                      {{ bodyExpanded.has(uid) ? m.debugCardView : m.debugRequestBody }}
                    </button>
                  </div>
                  <template v-if="!bodyExpanded.has(uid)">
                    <template v-for="mv in [reqMsgView(log, prevMsgCount, onlyNewSet.has(uid))]" :key="mv.base">
                      <div class="msg-list">
                        <div
                          v-for="(msg, mi) in mv.list"
                          :key="mi"
                          class="msg-row"
                          :class="{ clamped: !msgExpanded.has(uid + ':' + (mv.base + mi)) && (String(msg.content ?? '').length > MSG_COLLAPSE_CHARS) }"
                          :title="(String(msg.content ?? '').length > MSG_COLLAPSE_CHARS) ? (msgExpanded.has(uid + ':' + (mv.base + mi)) ? m.collapse : m.expand) : undefined"
                          @click="String(msg.content ?? '').length > MSG_COLLAPSE_CHARS && toggleMsg(uid + ':' + (mv.base + mi))"
                        >
                          <span class="msg-role" :style="{ background: roleOf(msg.role).color }">{{ roleOf(msg.role).label }}</span>
                          <div class="msg-detail">
                            <span v-if="msg.content" class="msg-text">{{ msg.content }}</span>
                            <div v-for="(tc, ti) in msg.tool_calls || []" :key="ti" class="tc-inline">
                              <span class="tc-inline-name">🔧 {{ tc.function?.name || tc.name }}</span>
                              <code class="tc-inline-args">{{ tc.function?.arguments ?? tc.args }}</code>
                            </div>
                            <span v-if="msg.tool_call_id" class="tc-id">↳ tool_call_id: {{ msg.tool_call_id }}</span>
                          </div>
                        </div>
                      </div>
                    </template>
                  </template>
                  <pre v-else class="log-raw"><code>{{ formatJson(log.data.messages) }}</code></pre>
                </template>

                <!-- LLM 响应：内容 + 工具调用 + 用量 -->
                <template v-else-if="log.type === 'llm_response'">
                  <div class="badge-row">
                    <span class="badge">{{ m.debugRoundPrefix }}{{ log.data.round }}{{ m.debugRoundSuffix }}</span>
                    <span v-if="log.data.toolCalls?.length" class="badge warn">🔧 {{ log.data.toolCalls.length }}{{ m.debugToolCallsSuffix }}</span>
                  </div>
                  <div v-if="log.data.content" class="resp-content">{{ log.data.content }}</div>
                  <div v-if="log.data.toolCalls?.length" class="tc-list">
                    <div v-for="(tc, ti) in log.data.toolCalls" :key="ti" class="tc-card">
                      <div class="tc-name">🔧 {{ tc.name }}</div>
                      <pre class="tc-args">{{ formatJson(tc.args) }}</pre>
                    </div>
                  </div>
                  <div v-if="log.data.usage" class="usage-row">
                    <span class="usage">prompt: {{ log.data.usage.prompt_tokens ?? '-' }}</span>
                    <span class="usage">completion: {{ log.data.usage.completion_tokens ?? '-' }}</span>
                    <span class="usage">total: {{ log.data.usage.total_tokens ?? '-' }}</span>
                  </div>
                </template>

                <!-- 工具调用/结果:配对卡(call+result 一屏看全一步调用;未配对 call = 在途) -->
                <template v-else-if="log.type === 'tool_call' || log.type === 'tool_result'">
                  <div v-if="pairCall" class="tc-card inline paired" :class="{ error: log.data.status === 'error' }">
                    <div class="tc-name">
                      {{ log.data.status === 'error' ? '❌' : '✅' }} {{ log.data.name }}
                      <span v-if="log.data.durationMs != null" class="tc-dur">{{ formatDuration(log.data.durationMs) }}</span>
                      <button class="view-toggle copy-btn" :title="m.copy" @click="copyJson(String(log.data.result ?? ''), 'res' + uid)">
                        {{ copiedKey === 'res' + uid ? '✓' : '📋' }}
                      </button>
                    </div>
                    <pre class="tc-args">{{ formatJson(pairCall.data.args) }}</pre>
                    <div class="tc-result-sep">↓ {{ m.resultLabel }}</div>
                    <pre class="tc-args tc-result">{{ log.data.result }}</pre>
                  </div>
                  <div v-else class="tc-card inline">
                    <div class="tc-name">
                      {{ log.type === 'tool_call' ? '🔧' : '✅' }} {{ log.data.name }}
                      <span v-if="log.type === 'tool_call'" class="tc-dur running">{{ m.statusRunning }}…</span>
                    </div>
                    <pre class="tc-args">{{ log.type === 'tool_call' ? formatJson(log.data.args) : log.data.result }}</pre>
                  </div>
                </template>

                <!-- 错误 -->
                <template v-else-if="log.type === 'error'">
                  <div class="err-box">{{ log.data.tool ? `[${log.data.tool}] ` : '' }}{{ log.data.error }}</div>
                </template>
              </div>

              <div class="log-footer">
                <button class="raw-toggle" @click="toggleRaw(uid)">
                  {{ rawExpanded.has(uid) ? m.debugCollapseRawJson : m.debugViewRawJson }}
                </button>
                <button class="raw-toggle" @click="copyText(formatJson(log.data))">{{ m.copy }}</button>
              </div>
              <pre v-if="rawExpanded.has(uid)" class="log-raw"><code>{{ formatJson(log.data) }}</code></pre>
            </div>
              </div>
            </div>
            </template>

            <!-- 执行流程:按轮次分组的流水视图(走到哪个模块 + 结果)-->
            <template v-else-if="tab === 'flow'">
              <div v-if="!logs.length" class="empty">{{ m.debugFlowEmpty }}</div>
              <div v-if="flowRounds.pre.length" class="flow-section">
                <div class="flow-section-title">⚙️ {{ m.debugFlowPrep }}</div>
                <div v-for="(lg, i) in flowRounds.pre" :key="'p'+i" class="flow-node" :class="lg.type">
                  <span class="flow-ico">{{ typeMeta[lg.type]?.icon }}</span>
                  <span class="flow-label">{{ typeMeta[lg.type]?.label }}</span>
                  <span class="flow-detail">{{ flowNodeDetail(lg) }}</span>
                  <span class="flow-time">{{ formatTime(lg.timestamp) }}</span>
                </div>
              </div>
              <div v-for="r in flowRounds.rounds" :key="r.round" class="flow-round">
                <div class="flow-round-head">🔁 {{ m.debugRoundPrefix }}{{ r.round }}{{ m.debugRoundSuffix }}</div>
                <div class="flow-round-body">
                  <div v-for="(lg, i) in r.items" :key="i" class="flow-node" :class="lg.type">
                    <span class="flow-ico">{{ typeMeta[lg.type]?.icon }}</span>
                    <span class="flow-label">{{ typeMeta[lg.type]?.label }}</span>
                    <span class="flow-detail">{{ flowNodeDetail(lg) }}</span>
                    <span class="flow-time">{{ formatTime(lg.timestamp) }}</span>
                  </div>
                </div>
              </div>
            </template>

            <!-- Agent 信息 -->
            <div v-else class="info-body">
              <div v-if="!agentInfo" class="empty">{{ m.debugNoInfo }}</div>
              <template v-else>
                <div class="info-section">
                  <div class="info-title">{{ m.debugInfoBasic }}</div>
                  <div class="kv-grid">
                    <div class="kv"><span class="k">ID</span><span class="v">{{ agentInfo.id }}</span></div>
                    <div class="kv"><span class="k">{{ m.debugModel }}</span><span class="v">{{ agentInfo.model || '-' }}</span></div>
                    <div class="kv"><span class="k">{{ m.debugToolCount }}</span><span class="v">{{ agentInfo.tools.length }}</span></div>
                    <div class="kv"><span class="k">{{ m.debugMiddleware }}</span><span class="v">{{ agentInfo.middleware.length }}</span></div>
                  </div>
                  <div class="kv" style="margin-top: 6px"><span class="k">{{ m.debugMiddlewareStack }}</span><span class="v" style="font-size: 11px">{{ agentInfo.middleware.join(' → ') || '-' }}</span></div>
                </div>

                <div class="info-section">
                  <div class="info-title">🔧 {{ m.debugToolsLabel }} ({{ agentInfo.tools.length }})</div>
                  <div v-for="t in agentInfo.tools" :key="t.name" class="info-item">
                    <div class="info-name">{{ t.name }}<span v-if="t.source" class="src-tag" :class="srcClass(t.source)">{{ t.source }}</span></div>
                    <div class="info-desc">{{ t.description }}</div>
                  </div>
                </div>

                <div v-if="agentInfo.skills.length" class="info-section">
                  <div class="info-title">📘 {{ m.debugSkillsTitle }} ({{ agentInfo.skills.length }})<span class="info-hint">{{ m.debugSkillsHint }}</span></div>
                  <div v-for="s in agentInfo.skills" :key="s.name" class="info-item">
                    <div class="info-name skill-toggle" @click="toggleSkill(s.name)">
                      <span class="skill-arrow" :class="{ open: !!skillExpanded[s.name] }">▶</span>
                      {{ s.name }}
                    </div>
                    <div class="info-desc">{{ s.description }}</div>
                    <div v-if="skillExpanded[s.name]" class="skill-content">
                      <div v-if="skillExpanded[s.name].loading" class="skill-loading">{{ m.debugLoading }}</div>
                      <div v-else-if="skillExpanded[s.name].error" class="skill-error">{{ skillExpanded[s.name].error }}</div>
                      <pre v-else-if="skillExpanded[s.name].content" class="skill-pre">{{ skillExpanded[s.name].content }}</pre>
                    </div>
                  </div>
                </div>

                <div v-if="agentInfo.data" class="info-section">
                  <div class="info-title">📊 {{ m.debugDataTitle }}</div>
                  <div class="info-item">
                    <div class="info-name">{{ agentInfo.data.description || m.debugDataFallback }}</div>
                    <div class="info-desc">{{ m.debugSchemaPrefix }}{{ agentInfo.data.schema ? m.debugSchemaDeclared : m.debugSchemaMissing }}</div>
                  </div>
                </div>

                <div class="info-section">
                  <div class="info-title">🧬 {{ m.debugSubagentTitle }}</div>
                  <div class="kv-grid">
                    <div class="kv"><span class="k">{{ m.debugEnabled }}</span><span class="v">{{ agentInfo.subagent.enabled ? m.debugYes : m.debugNo }}</span></div>
                    <div class="kv"><span class="k">{{ m.debugMaxDepth }}</span><span class="v">{{ agentInfo.subagent.maxDepth }}</span></div>
                    <div class="kv"><span class="k">{{ m.debugMaxParallel }}</span><span class="v">{{ agentInfo.subagent.maxParallel }}</span></div>
                    <div class="kv"><span class="k">{{ m.debugExtraTools }}</span><span class="v" style="font-size: 11px">{{ agentInfo.subagent.allowedTools.length ? agentInfo.subagent.allowedTools.join(', ') : m.debugDefaultReadonly }}</span></div>
                  </div>
                </div>

                <div v-if="agentInfo.mcp?.servers?.length" class="info-section">
                  <div class="info-title">🔌 MCP ({{ agentInfo.mcp.servers.length }})</div>
                  <div v-for="s in agentInfo.mcp.servers" :key="s.name" class="info-item">
                    <div class="info-name">{{ s.name }} <span class="src-tag mcp">{{ s.toolCount }}{{ m.debugToolCountSuffix }}</span></div>
                    <div class="info-desc">{{ s.url }}</div>
                  </div>
                </div>

                <div v-if="agentInfo.verify" class="info-section">
                  <div class="info-title">✅ {{ m.debugVerifyTitle }}</div>
                  <div class="kv-grid">
                    <div class="kv"><span class="k">{{ m.debugEnabled }}</span><span class="v">{{ agentInfo.verify.enabled ? m.debugYes : m.debugNo }}</span></div>
                    <div class="kv"><span class="k">{{ m.debugMaxAttempts }}</span><span class="v">{{ agentInfo.verify.maxAttempts }}</span></div>
                    <div class="kv"><span class="k">{{ m.debugAdversarial }}</span><span class="v">{{ agentInfo.verify.adversarial ? m.debugOn : m.debugOff }}</span></div>
                    <div v-if="agentInfo.verify.adversarial" class="kv"><span class="k">{{ m.debugAdversarialModel }}</span><span class="v" style="font-size: 11px">{{ agentInfo.model || '-' }}{{ m.debugSameAsMain }}</span></div>
                  </div>
                </div>

                <div v-if="agentInfo.todos.length" class="info-section">
                  <div class="info-title">📋 {{ m.debugTodosTitle }} ({{ agentInfo.todos.length }})</div>
                  <div v-for="(td, i) in agentInfo.todos" :key="i" class="info-todo">
                    <span class="todo-tag" :style="{ background: (statusMeta[td.status] && statusMeta[td.status].color) || '#9ca3af' }">{{ statusLabel(td.status) }}</span>
                    <span>{{ td.content }}</span>
                  </div>
                </div>

                <div v-if="agentInfo.memory" class="info-section">
                  <div class="info-title">📝 {{ m.debugMemoryTitle }}</div>
                  <pre class="info-pre">{{ agentInfo.memory }}</pre>
                </div>

                <!-- 跨会话用户偏好(preferences opt-in;只读视图,删除走 sdk.removePreference/clearPreferences) -->
                <div v-if="agentInfo.preferences?.length" class="info-section">
                  <div class="info-title">🎯 {{ m.debugPrefsTitle }} ({{ agentInfo.preferences.length }})</div>
                  <div v-for="p in agentInfo.preferences" :key="p.id" class="info-todo">
                    <span class="todo-tag" style="background: #6366f1">{{ topicLabel(p.topic) }}</span>
                    <span>{{ p.content }}</span>
                  </div>
                </div>

                <div v-if="agentInfo.lastCompression" class="info-section">
                  <div class="info-title">🗜️ {{ m.debugLastCompTitle }}</div>
                  <div class="info-kv">
                    <div class="kv"><span class="k">{{ m.debugTriggered }}</span><span class="v">{{ agentInfo.lastCompression.triggered ? '✓' : m.debugNotTriggered }}</span></div>
                    <div class="kv"><span class="k">{{ m.debugRoundsSummarized }}</span><span class="v">{{ agentInfo.lastCompression.roundsSummarized }} / {{ agentInfo.lastCompression.roundsTotal }}</span></div>
                    <div class="kv"><span class="k">{{ m.debugCtxRecalled }}</span><span class="v">{{ agentInfo.lastCompression.roundsRecalled }}{{ m.debugCountSuffix }}</span></div>
                    <div class="kv"><span class="k">{{ m.debugMessageCount }}</span><span class="v">{{ agentInfo.lastCompression.originalMessages }} → {{ agentInfo.lastCompression.compressedMessages }}</span></div>
                    <div class="kv"><span class="k">{{ m.debugStrategy }}</span><span class="v" style="font-size: 11px">{{ agentInfo.lastCompression.strategy }}</span></div>
                    <div class="kv" v-if="agentInfo.lastCompression.decision"><span class="k">{{ m.debugDecision }}</span><span class="v" style="font-size: 11px">🤖 {{ decisionSummary(agentInfo.lastCompression.decision) }}</span></div>
                  </div>
                </div>
              </template>
            </div>
              </div>
            </div>
          </div>
        </div>
        <div class="drawer-mask" @click="close"></div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.debug-drawer { position: fixed; inset: 0; z-index: 9000; pointer-events: none; }
.drawer-mask { position: absolute; inset: 0; background: rgba(0,0,0,0.25); pointer-events: auto; }
.drawer-panel {
  /* 主题变量(与 ChatDialog 一致;DebugDrawer 经 Teleport 独立于 body,需自定义;--dd-* 为面板表面色,深色主题见底部块) */
  --cs-primary: #1f4d3a;
  --cs-primary-rgb: 31, 77, 58;
  --dd-bg: #ffffff;
  --dd-surface: #f9fafb;
  --dd-surface-2: #fafafa;
  --dd-border: #e5e7eb;
  --dd-border-soft: #f3f4f6;
  --dd-scrollbar-thumb: rgba(0, 0, 0, 0.22);
  --dd-scrollbar-thumb-hover: rgba(0, 0, 0, 0.38);
  --dd-text: #1f2937;
  --dd-text-2: #374151;
  --dd-text-3: #4b5563;
  --dd-muted: #6b7280;
  --dd-faint: #9ca3af;
  --dd-accent-bg: #ecf5ef;
  --dd-accent-text: #2d5a47;
  --dd-accent-bg-2: #dbeee4;
  --dd-accent-soft: #f0f7f3;
  --dd-accent-border: #c3dcd0;
  --dd-err-bg: #fef2f2;
  --dd-err-text: #991b1b;
  --dd-err-border: #fecaca;
  --dd-warn-bg: #fef3c7;
  --dd-warn-text: #92400e;
  --dd-purple-bg: #f3e8ff;
  --dd-purple-text: #7c3aed;
  --dd-blue-bg: #dbeafe;
  --dd-blue-text: #2563eb;
  --dd-usage-bg: #ecfdf5;
  --dd-usage-text: #047857;
  position: absolute; top: 0; right: 0; bottom: 0;
  width: 520px; max-width: 90vw; background: var(--dd-bg);
  display: flex; flex-direction: column;
  box-shadow: -8px 0 32px rgba(0,0,0,0.15); pointer-events: auto;
  z-index: 2;
}
.drawer-mask { z-index: 1; }
.drawer-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px; background: var(--dd-header-bg, linear-gradient(135deg, #1f2937, #111827)); color: #fff;
}
.drawer-title { font-size: 15px; font-weight: 600; }
.tab-group { display: flex; gap: 4px; }
.tab-btn { padding: 4px 12px; border: none; border-radius: 6px; background: var(--dd-tab-bg, rgba(255,255,255,0.12)); color: #fff; font-size: 13px; cursor: pointer; transition: background 0.2s; }
.tab-btn:hover { background: var(--dd-tab-hover, rgba(255,255,255,0.22)); }
.tab-btn.active { background: var(--dd-tab-active, rgba(255,255,255,0.45)); font-weight: 600; }
.info-body { padding: 4px 0; }
.info-section { margin-bottom: 14px; }
.info-title { font-size: 12px; font-weight: 600; color: var(--dd-accent-text); margin-bottom: 6px; padding-bottom: 4px; border-bottom: 1px solid var(--dd-border-soft); }
.info-item { padding: 6px 8px; background: var(--dd-surface); border-radius: 6px; margin-bottom: 4px; }
.info-name { font-size: 12px; font-weight: 600; color: var(--dd-text); font-family: 'SF Mono', Monaco, Consolas, monospace; }
.info-desc { font-size: 11px; color: var(--dd-muted); line-height: 1.5; margin-top: 2px; }
.info-desc.muted { color: var(--dd-faint); }
.info-hint { font-size: 10px; color: var(--dd-faint); font-weight: 400; margin-left: 6px; }
.skill-toggle { cursor: pointer; display: flex; align-items: center; gap: 4px; }
.skill-toggle:hover { color: var(--cs-primary, #1f4d3a); }
.skill-arrow { font-size: 8px; color: var(--dd-faint); transition: transform 0.15s ease; display: inline-block; }
.skill-arrow.open { transform: rotate(90deg); }
.skill-content { margin-top: 6px; }
.skill-loading { font-size: 11px; color: var(--dd-muted); padding: 6px 8px; }
.skill-error { font-size: 11px; color: #dc2626; padding: 6px 8px; }
.skill-pre { font-size: 11px; line-height: 1.6; color: var(--dd-text-2); background: var(--dd-surface); border: 1px solid var(--dd-border); border-radius: 6px; padding: 8px 10px; margin: 0; max-height: 320px; overflow: auto; white-space: pre-wrap; word-break: break-word; font-family: 'SF Mono', Monaco, Consolas, monospace; }
.src-tag { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 8px; font-size: 10px; font-weight: 600; vertical-align: middle; }
.src-tag.builtin { background: var(--dd-border-soft); color: var(--dd-muted); }
.src-tag.mcp { background: var(--dd-purple-bg); color: var(--dd-purple-text); }
.src-tag.user { background: var(--dd-blue-bg); color: var(--dd-blue-text); }
.info-todo { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--dd-text-2); padding: 4px 8px; background: var(--dd-surface); border-radius: 6px; margin-bottom: 4px; }
.todo-tag { font-size: 10px; color: #fff; padding: 1px 6px; border-radius: 8px; flex-shrink: 0; }
.info-pre { margin: 0; padding: 8px; background: var(--dd-surface); border-radius: 6px; font-size: 11px; color: var(--dd-text-3); white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto; font-family: 'SF Mono', Monaco, Consolas, monospace; }
.header-actions { display: flex; gap: 4px; }
.hd-btn { width: 28px; height: 28px; border: none; border-radius: 6px; background: rgba(255,255,255,0.12); color: #fff; cursor: pointer; }
.hd-btn:hover { background: rgba(255,255,255,0.25); }
.drawer-filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 16px; border-bottom: 1px solid var(--dd-border-soft); background: var(--dd-surface-2); }
.filter-chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border: 1px solid var(--dd-border); border-radius: 14px; background: var(--dd-bg); color: var(--dd-muted); font-size: 12px; cursor: pointer; transition: all 0.2s; }
.filter-chip:hover { border-color: var(--chip-color, var(--cs-primary)); }
.filter-chip.active { background: var(--chip-color, var(--cs-primary)); border-color: var(--chip-color, var(--cs-primary)); color: #fff; }
.chip-count { background: rgba(127,127,127,0.12); border-radius: 8px; padding: 0 5px; font-size: 11px; }
.filter-chip.active .chip-count { background: rgba(255,255,255,0.25); }
.drawer-body { flex: 1; min-height: 0; }
/* 滚动发生在 viewport(原 .drawer-body 的滚动+内边距职责移此;插件初始化前原生兜底) */
.drawer-scroll-viewport { height: 100%; overflow-x: hidden; overflow-y: auto; padding: 12px; }

/* ===== 滚动条统一(3.27;与 ChatDialog 同构)=====
   drawer-body 已初始化 OverlayScrollbars(overlay 自定义);其余小滚动区(log-raw/info-pre/tc-args 等)原生细条兜底 */
.drawer-panel { scrollbar-width: thin; scrollbar-color: var(--dd-scrollbar-thumb, rgba(0, 0, 0, 0.22)) transparent; }
.drawer-panel ::-webkit-scrollbar { width: 6px; height: 6px; }
.drawer-panel ::-webkit-scrollbar-thumb { background: var(--dd-scrollbar-thumb, rgba(0, 0, 0, 0.22)); border-radius: 999px; }
.drawer-panel ::-webkit-scrollbar-thumb:hover { background: var(--dd-scrollbar-thumb-hover, rgba(0, 0, 0, 0.38)); }
.drawer-panel ::-webkit-scrollbar-track, .drawer-panel ::-webkit-scrollbar-corner { background: transparent; }
.drawer-panel [data-overlayscrollbars-viewport] { scrollbar-width: none; }
.drawer-panel [data-overlayscrollbars-viewport]::-webkit-scrollbar { display: none; width: 0; height: 0; }
.drawer-panel .os-scrollbar {
  --os-size: 8px;
  --os-handle-border-radius: 999px;
  --os-handle-bg: var(--dd-scrollbar-thumb, rgba(0, 0, 0, 0.22));
  --os-handle-bg-hover: var(--dd-scrollbar-thumb-hover, rgba(0, 0, 0, 0.38));
  --os-handle-bg-active: var(--dd-scrollbar-thumb-hover, rgba(0, 0, 0, 0.38));
}
.empty { text-align: center; color: var(--dd-faint); font-size: 13px; padding: 40px 20px; }
/* 轮次分组(logs tab):每一轮一个可折叠 node;默认仅最新组展开(在途轮天然展开,新轮到来旧轮自动收起) */
.log-group { margin-bottom: 8px; border: 1px solid var(--dd-border); border-radius: 8px; overflow: hidden; background: var(--dd-bg); }
.log-group-head { display: flex; align-items: center; gap: 6px; padding: 7px 10px; background: var(--dd-surface); cursor: pointer; user-select: none; }
.log-group-head:hover { background: var(--dd-accent-soft); }
.log-group-head.expanded { border-bottom: 1px solid var(--dd-border-soft); }
.log-group-arrow { font-size: 9px; color: var(--dd-faint); transition: transform 0.15s ease; flex-shrink: 0; }
.log-group-arrow.open { transform: rotate(90deg); }
.log-group-title { font-size: 12px; font-weight: 600; color: var(--dd-text); white-space: nowrap; flex-shrink: 0; }
.log-group-meta { font-size: 10px; color: var(--dd-faint); font-family: 'SF Mono', Monaco, Consolas, monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lg-badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: var(--dd-border-soft); color: var(--dd-muted); white-space: nowrap; flex-shrink: 0; }
.lg-badge.err { background: var(--dd-err-bg); color: var(--dd-err-text); font-weight: 600; }
.log-group-body { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.log-group-body .log-item { margin-bottom: 0; }
.log-item { margin-bottom: 10px; border: 1px solid var(--dd-border); border-radius: 8px; overflow: hidden; background: var(--dd-bg); }
.log-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--dd-surface); }
.log-type { font-size: 11px; font-weight: 600; color: #fff; padding: 2px 8px; border-radius: 4px; white-space: nowrap; }
.log-source { font-size: 10px; color: var(--dd-purple-text); background: var(--dd-purple-bg); padding: 2px 8px; border-radius: 4px; font-weight: 600; white-space: nowrap; }
.log-time { font-size: 11px; color: var(--dd-faint); font-family: 'SF Mono', Monaco, Consolas, monospace; }
.log-body { padding: 10px 12px; }
.log-footer { display: flex; gap: 8px; padding: 6px 12px; border-top: 1px dashed var(--dd-border-soft); }
.raw-toggle { border: none; background: none; color: var(--cs-primary); font-size: 11px; cursor: pointer; padding: 2px 4px; }
.raw-toggle:hover { text-decoration: underline; }
.log-raw { margin: 0; padding: 10px 12px; border-top: 1px solid var(--dd-border-soft); background: #1f2937; color: #e5e7eb; font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 11px; line-height: 1.5; overflow-x: auto; white-space: pre-wrap; word-break: break-word; max-height: 280px; overflow-y: auto; }
.kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; }
.kv { display: flex; flex-direction: column; padding: 6px 8px; background: var(--dd-surface); border-radius: 6px; }
.kv .k { font-size: 10px; color: var(--dd-faint); text-transform: uppercase; }
.kv .v { font-size: 13px; color: var(--dd-text); font-weight: 600; font-family: 'SF Mono', Monaco, Consolas, monospace; }
.section-label { font-size: 11px; color: var(--dd-muted); font-weight: 600; margin: 10px 0 4px; }
.chip-row { display: flex; flex-wrap: wrap; gap: 4px; }
.tool-chip { font-size: 11px; padding: 2px 8px; background: var(--dd-accent-bg); color: var(--dd-accent-text); border-radius: 10px; font-family: 'SF Mono', Monaco, Consolas, monospace; }
.msg-list { display: flex; flex-direction: column; gap: 4px; }
.msg-row { display: flex; align-items: flex-start; gap: 6px; padding: 5px 8px; background: var(--dd-surface); border-radius: 6px; }
.msg-role { font-size: 9px; font-weight: 700; color: #fff; padding: 2px 6px; border-radius: 3px; flex-shrink: 0; margin-top: 1px; }
.msg-text { font-size: 12px; color: var(--dd-text-2); line-height: 1.5; white-space: pre-wrap; word-break: break-word; flex: 1; }
.msg-tool-hint { font-size: 10px; color: var(--dd-purple-text); flex-shrink: 0; }
.badge-row { display: flex; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
.badge { font-size: 11px; padding: 2px 8px; background: var(--dd-accent-bg-2); color: var(--dd-accent-text); border-radius: 10px; font-weight: 600; }
.badge.muted { background: var(--dd-border-soft); color: var(--dd-muted); }
.badge.warn { background: var(--dd-warn-bg); color: var(--dd-warn-text); }
.resp-content { font-size: 12px; color: var(--dd-text); background: var(--dd-warn-bg); border-left: 3px solid #d97706; padding: 6px 10px; border-radius: 4px; white-space: pre-wrap; word-break: break-word; margin-bottom: 8px; }
.tc-list { display: flex; flex-direction: column; gap: 6px; }
.tc-card { border: 1px solid var(--dd-border); border-radius: 6px; overflow: hidden; }
.tc-card.inline { margin-top: 4px; }
.tc-name { font-size: 12px; font-weight: 600; color: var(--dd-accent-text); padding: 5px 8px; background: var(--dd-accent-bg); }
.tc-args { margin: 0; padding: 8px; background: #1f2937; color: #e5e7eb; font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto; }
.usage-row { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.usage { font-size: 11px; padding: 2px 8px; background: var(--dd-usage-bg); color: var(--dd-usage-text); border-radius: 10px; font-family: 'SF Mono', Monaco, Consolas, monospace; }
.err-box { font-size: 12px; color: var(--dd-err-text); background: var(--dd-err-bg); border: 1px solid var(--dd-err-border); padding: 8px 10px; border-radius: 6px; white-space: pre-wrap; word-break: break-word; }
.msg-detail { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
.tc-inline { font-size: 11px; background: var(--dd-accent-soft); border: 1px solid var(--dd-accent-border); border-radius: 4px; padding: 2px 6px; display: flex; gap: 4px; align-items: baseline; }
.tc-inline-name { color: var(--dd-accent-text); font-weight: 600; white-space: nowrap; }
.tc-inline-args { font-family: 'SF Mono', Monaco, Consolas, monospace; color: var(--dd-text-2); word-break: break-all; font-size: 10px; }
.tc-id { font-size: 10px; color: var(--dd-faint); font-family: 'SF Mono', Monaco, Consolas, monospace; }
.view-toggle { margin-left: auto; border: 1px solid var(--dd-accent-border); background: var(--dd-accent-bg); color: var(--dd-accent-text); font-size: 11px; padding: 2px 8px; border-radius: 10px; cursor: pointer; }
.view-toggle:hover { background: var(--dd-accent-bg-2); }
/* 只看新增/复制按钮不推到行尾(保留原 原始JSON 按钮的 margin-left:auto) */
.view-toggle.only-new-btn, .view-toggle.copy-btn { margin-left: 0; padding: 2px 7px; }
/* 长消息折叠(>MSG_COLLAPSE_CHARS 默认 3 行截断,点击展开;system prompt 数 KB 不再淹没列表) */
.msg-row.clamped { cursor: pointer; }
.msg-row.clamped .msg-text { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
/* 工具配对卡:call+result 一屏看全一步调用 */
.tc-card.paired { border-color: var(--dd-accent-border); }
.tc-card.paired.error { border-color: var(--dd-err-border); }
.tc-name .tc-dur { font-weight: 400; font-size: 10px; color: var(--dd-muted); margin-left: 6px; font-family: 'SF Mono', Monaco, Consolas, monospace; }
.tc-name .tc-dur.running { color: #059669; }
.tc-name .copy-btn { float: right; margin-top: 1px; }
.tc-result-sep { font-size: 10px; color: var(--dd-faint); padding: 3px 8px 0; }
.tc-args.tc-result { background: #111827; color: #d1d5db; border-top: 1px dashed rgba(255,255,255,0.12); }
.drawer-enter-active, .drawer-leave-active { transition: opacity 0.25s ease; }
.drawer-enter-active .drawer-panel, .drawer-leave-active .drawer-panel { transition: transform 0.25s ease; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .drawer-panel, .drawer-leave-to .drawer-panel { transform: translateX(100%); }

/* 执行流程视图(按轮分组的流水) */
.flow-section { margin-bottom: 14px; }
.flow-section-title { font-size: 11px; font-weight: 600; color: var(--dd-muted); margin-bottom: 6px; padding-left: 2px; }
.flow-round { margin-bottom: 12px; border: 1px solid var(--dd-border); border-radius: 8px; overflow: hidden; }
.flow-round-head { font-size: 12px; font-weight: 600; color: #fff; background: var(--cs-primary); padding: 5px 10px; }
.flow-round-body { padding: 6px; display: flex; flex-direction: column; gap: 3px; }
.flow-node { display: flex; align-items: center; gap: 6px; padding: 5px 8px; background: var(--dd-surface); border-radius: 6px; font-size: 12px; border-left: 3px solid var(--cs-primary); }
.flow-node.llm_request { border-left-color: #059669; }
.flow-node.llm_response { border-left-color: #d97706; }
.flow-node.tool_call { border-left-color: #7c3aed; }
.flow-node.tool_result { border-left-color: #2563eb; }
.flow-node.error { border-left-color: #dc2626; background: var(--dd-err-bg); }
.flow-node.middleware { border-left-color: #0891b2; }
.flow-ico { font-size: 13px; flex-shrink: 0; }
.flow-label { font-weight: 600; color: var(--dd-text-2); white-space: nowrap; flex-shrink: 0; }
.flow-detail { color: var(--dd-muted); font-size: 11px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: 'SF Mono', Monaco, Consolas, monospace; }
.flow-time { font-size: 10px; color: var(--dd-faint); font-family: 'SF Mono', Monaco, Consolas, monospace; flex-shrink: 0; }

/* trace 视图(observability-tracing Phase 3):metrics 卡片 + span 列表 */
.trace-panel { padding: 10px; }
.trace-empty { color: var(--dd-faint); font-size: 12px; text-align: center; padding: 30px; line-height: 1.6; }
.trace-empty code { background: var(--dd-border-soft); padding: 1px 5px; border-radius: 4px; font-size: 11px; }
.trace-metrics { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.metric-card { display: flex; flex-direction: column; padding: 6px 10px; border-radius: 8px; background: var(--dd-accent-soft); border: 1px solid var(--dd-accent-border); min-width: 70px; }
.metric-card span { font-size: 10px; color: var(--dd-muted); }
.metric-card b { font-size: 14px; color: var(--cs-primary); }
.trace-spans { display: flex; flex-direction: column; gap: 3px; }
.trace-span { display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: var(--dd-surface); border-radius: 6px; font-size: 11px; border-left: 3px solid var(--cs-primary); }
.trace-span.model { border-left-color: #059669; }
.trace-span.tool { border-left-color: #7c3aed; }
.trace-span.compression { border-left-color: #d97706; }
.trace-span.error { background: var(--dd-err-bg); }
.span-ico { font-size: 12px; flex-shrink: 0; }
.span-name { flex: 1; color: var(--dd-text-2); font-family: 'SF Mono', Monaco, Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.span-dur { font-size: 10px; color: var(--dd-muted); font-family: 'SF Mono', Monaco, Consolas, monospace; flex-shrink: 0; }
.span-status { font-size: 11px; flex-shrink: 0; }

/* 上下文构成视图(context-inspector) */
.context-panel { padding: 12px; }
.ctx-overview { margin-bottom: 14px; }
.ctx-occupancy { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.ctx-bar-track { position: relative; flex: 1; height: 10px; background: var(--dd-border-soft); border-radius: 5px; overflow: hidden; cursor: help; }
.ctx-bar-fill { height: 100%; border-radius: 5px; transition: width 0.3s; }
.ctx-bar-fill.green { background: #10b981; }
.ctx-bar-fill.yellow { background: #f59e0b; }
.ctx-bar-fill.red { background: #ef4444; }
.ctx-threshold-mark { position: absolute; top: -2px; bottom: -2px; width: 2px; background: var(--dd-muted); }
.ctx-pct { font-size: 13px; font-weight: 700; color: var(--dd-text); min-width: 40px; font-family: 'SF Mono', Monaco, Consolas, monospace; }
.ctx-kv-row { display: flex; flex-wrap: wrap; gap: 6px; }
.ctx-kv { font-size: 11px; color: var(--dd-muted); background: var(--dd-surface); padding: 2px 8px; border-radius: 8px; font-family: 'SF Mono', Monaco, Consolas, monospace; }
.ctx-section-title { font-size: 11px; font-weight: 600; color: var(--dd-muted); margin: 12px 0 6px; }
.ctx-cat { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 11px; }
.ctx-cat-label { width: 130px; flex-shrink: 0; color: var(--dd-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ctx-cat-bar { flex: 1; height: 8px; background: var(--dd-border-soft); border-radius: 4px; overflow: hidden; }
.ctx-cat-fill { height: 100%; background: var(--cs-primary); border-radius: 4px; }
.ctx-cat-tokens { min-width: 76px; text-align: right; color: var(--dd-muted); font-family: 'SF Mono', Monaco, Consolas, monospace; flex-shrink: 0; }
.ctx-cat-tokens i { font-style: normal; color: var(--dd-faint); }
.ctx-compression { margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--dd-border-soft); }

/* 子 agent 观察层(subagent-observability):active 运行卡片 + history 历史 */
.subagent-panel { padding: 12px; }
.sub-section { margin-bottom: 16px; }
.sub-section-title { font-size: 11px; font-weight: 600; color: var(--dd-muted); margin-bottom: 8px; }
.sub-card { padding: 8px 10px; background: var(--dd-surface); border-radius: 8px; margin-bottom: 6px; border-left: 3px solid var(--cs-primary); }
.sub-card.running { border-left-color: #059669; }
.sub-card.done { border-left-color: var(--dd-muted); }
.sub-card.error { background: var(--dd-err-bg); border-left-color: #dc2626; }
.sub-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.sub-status { font-size: 10px; color: #fff; padding: 1px 6px; border-radius: 8px; flex-shrink: 0; }
.sub-label { font-size: 12px; font-weight: 600; color: var(--dd-text); font-family: 'SF Mono', Monaco, Consolas, monospace; }
.sub-steps-badge { font-size: 10px; color: var(--dd-muted); margin-left: auto; }
.sub-dur { font-size: 10px; color: var(--dd-muted); margin-left: auto; font-family: 'SF Mono', Monaco, Consolas, monospace; }
.sub-toggle { border: 1px solid var(--dd-border); background: var(--dd-bg); color: var(--dd-muted); font-size: 10px; padding: 1px 6px; border-radius: 8px; cursor: pointer; }
.sub-toggle:hover { background: var(--dd-border-soft); }
.sub-task { font-size: 11px; color: var(--dd-text-2); line-height: 1.5; }
.sub-result { font-size: 11px; color: var(--dd-text-3); background: var(--dd-bg); border: 1px solid var(--dd-border); border-radius: 4px; padding: 4px 6px; margin-top: 4px; white-space: pre-wrap; word-break: break-word; }
.sub-steps-list { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--dd-border); }
.sub-step { display: flex; align-items: center; gap: 6px; padding: 2px 0; font-size: 11px; }
.sub-step-kind { flex-shrink: 0; }
.sub-step-name { flex: 1; color: var(--dd-text-2); font-family: 'SF Mono', Monaco, Consolas, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub-step-ts { font-size: 10px; color: var(--dd-faint); font-family: 'SF Mono', Monaco, Consolas, monospace; flex-shrink: 0; }

/* ===== 内置深色主题(prop csTheme:'dark',与 ChatDialog 同款方舟设计稿色板)===== */
.drawer-panel.cs-theme-dark {
  --cs-primary: #7063e7;
  --cs-primary-rgb: 112, 99, 231;
  --dd-bg: #222222;
  --dd-surface: #2c2c2c;
  --dd-surface-2: #2a2a2a;
  --dd-border: #444444;
  --dd-border-soft: #3a3a3a;
  --dd-scrollbar-thumb: rgba(255, 255, 255, 0.38);
  --dd-scrollbar-thumb-hover: rgba(255, 255, 255, 0.6);
  --dd-text: #f1f1fa;
  --dd-text-2: #d5d5e2;
  --dd-text-3: #b9b9c8;
  --dd-muted: #9a9ab0;
  --dd-faint: #77778c;
  --dd-accent-bg: rgba(0, 197, 98, 0.12);
  --dd-accent-text: #00c562;
  --dd-accent-bg-2: rgba(0, 197, 98, 0.2);
  --dd-accent-soft: rgba(153, 147, 255, 0.08);
  --dd-accent-border: #444444;
  --dd-err-bg: rgba(240, 72, 72, 0.12);
  --dd-err-text: #ff9090;
  --dd-err-border: rgba(240, 72, 72, 0.45);
  --dd-warn-bg: rgba(240, 160, 32, 0.12);
  --dd-warn-text: #f0a020;
  --dd-purple-bg: rgba(124, 58, 237, 0.18);
  --dd-purple-text: #c4a5ff;
  --dd-blue-bg: rgba(37, 99, 235, 0.18);
  --dd-blue-text: #93b4ff;
  --dd-usage-bg: rgba(0, 197, 98, 0.12);
  --dd-usage-text: #4ade80;
  --dd-header-bg: #353535;
  --dd-tab-bg: #444444;
  --dd-tab-hover: #555555;
  --dd-tab-active: #7063e7;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.5);
}
</style>
