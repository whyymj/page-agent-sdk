<script setup lang="ts">
import { computed, ref, watch, type Ref } from 'vue'
import type { DebugLog } from '../harness/createAgent'
import type { AgentInfo } from '../types'
import type { TraceSpan } from '../harness/createAgent'
import { copyText } from '../utils/clipboard'

const props = withDefaults(defineProps<{
  logs?: DebugLog[]
  visible: boolean
  /** 获取 agent 详细信息(「Agent 信息」tab 展示) */
  getInfo?: () => AgentInfo
  /** Agent 信息刷新 tick(setSkills/setData 后 ++);watch 后重新拉 getInfo() 实时反映动态 skill/data */
  infoTick?: Ref<number>
  /** 读取 skill 全文(展开 skill 时调,优先缓存);返回 null 表示无内容或读取失败 */
  getSkillContent?: (name: string) => Promise<string | null>
  /** 内置主题:'light'(默认)/ 'dark'(方舟设计稿色板;ChatDialog 自动透传自身 theme) */
  csTheme?: 'light' | 'dark'
}>(), {
  logs: () => [],
})

const emit = defineEmits<{
  (e: 'update:visible', v: boolean): void
  (e: 'clear'): void
}>()

const filter = ref<DebugLog['type'] | 'all'>('all')
const rawExpanded = ref<Set<number>>(new Set())
const bodyExpanded = ref<Set<number>>(new Set())

const typeMeta: Record<string, { label: string; color: string; icon: string }> = {
  context: { label: '上下文', color: 'var(--cs-primary)', icon: '🧩' },
  llm_request: { label: 'LLM请求', color: '#059669', icon: '➡️' },
  llm_response: { label: 'LLM响应', color: '#d97706', icon: '⬅️' },
  tool_call: { label: '工具调用', color: '#7c3aed', icon: '🔧' },
  tool_result: { label: '工具结果', color: '#2563eb', icon: '✅' },
  error: { label: '错误', color: '#dc2626', icon: '❌' },
  middleware: { label: '中间件', color: '#0891b2', icon: '⚙️' },
}

const logs = computed(() => (Array.isArray(props.logs) ? props.logs : []))
const filteredLogs = computed(() =>
  filter.value === 'all' ? logs.value : logs.value.filter((l) => l.type === filter.value)
)

const counts = computed(() => {
  const c: Record<string, number> = { all: logs.value.length }
  for (const l of logs.value) c[l.type] = (c[l.type] || 0) + 1
  return c
})

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false }) +
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
function clearLogs() { rawExpanded.value = new Set(); emit('clear') }

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
    skillExpanded.value = { ...skillExpanded.value, [name]: { loading: false, content: null, error: '当前 SDK 未注入 getSkillContent,无法查看 skill 全文' } }
    return
  }
  skillExpanded.value = { ...skillExpanded.value, [name]: { loading: true, content: null } }
  try {
    const content = await props.getSkillContent(name)
    skillExpanded.value = { ...skillExpanded.value, [name]: { loading: false, content, error: content == null ? 'skill 无内容或读取失败' : undefined } }
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
const statusMeta: Record<string, { label: string; color: string }> = {
  pending: { label: '待办', color: '#9ca3af' },
  in_progress: { label: '进行中', color: '#d97706' },
  completed: { label: '完成', color: '#059669' },
}
function statusLabel(s: string) { return statusMeta[s]?.label ?? s }
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
const subStatusMeta: Record<string, { label: string; color: string }> = {
  running: { label: '运行中', color: '#059669' },
  done: { label: '完成', color: '#6b7280' },
  error: { label: '错误', color: '#dc2626' },
}
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
  return `${main} · ${d.summarize.mode}摘要 · 召回${d.recallTopK ?? '?'}${d.reason ? ' · ' + d.reason : ''}`
}
/** 流程节点摘要(每轮流水一览;详情看「日志」tab) */
function flowNodeDetail(lg: DebugLog): string {
  const d = (lg.data || {}) as any
  switch (lg.type) {
    case 'context': return `${d.tools?.length ?? 0} 工具 · ${d.totalMessages ?? 0} 消息`
    case 'llm_request': return `${(d.messages || []).length} 消息${d.tools?.length ? ' · ' + d.tools.length + ' 工具' : ''}`
    case 'llm_response': return d.toolCalls?.length ? `${d.toolCalls.length} 个工具调用` : (d.content ? truncate(String(d.content), 50) : '')
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
              <button class="tab-btn" :class="{ active: tab === 'logs' }" @click="switchTab('logs')">🐛 日志</button>
              <button class="tab-btn" :class="{ active: tab === 'flow' }" @click="switchTab('flow')">🔀 流程</button>
              <button v-if="getInfo" class="tab-btn" :class="{ active: tab === 'trace' }" @click="switchTab('trace')">🌳 Trace</button>
              <button v-if="getInfo" class="tab-btn" :class="{ active: tab === 'context' }" @click="switchTab('context')">📊 上下文</button>
              <button v-if="getInfo" class="tab-btn" :class="{ active: tab === 'subagent' }" @click="switchTab('subagent')">🤖 子 agent</button>
              <button v-if="getInfo" class="tab-btn" :class="{ active: tab === 'info' }" @click="switchTab('info')">🧬 Agent 信息</button>
            </div>
            <div class="header-actions">
              <button v-if="tab === 'logs'" class="hd-btn" title="清空日志" @click="clearLogs">🗑️</button>
              <button class="hd-btn" title="关闭" @click="close">✕</button>
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
              全部 <span class="chip-count">{{ counts.all || 0 }}</span>
            </button>
          </div>

          <div class="drawer-body">
            <div v-if="tab === 'trace'" class="trace-panel">
              <div v-if="!traceMetrics" class="trace-empty">未开启 tracing(<code>capabilities.tracing:true</code>)或暂无 trace。跑一轮 agent 后刷新。</div>
              <template v-else>
                <div class="trace-metrics">
                  <div class="metric-card"><span>轮次</span><b>{{ traceMetrics.rounds }}</b></div>
                  <div class="metric-card"><span>总耗时</span><b>{{ traceMetrics.totalDurationMs }}ms</b></div>
                  <div class="metric-card"><span>平均/轮</span><b>{{ traceMetrics.avgRoundMs }}ms</b></div>
                  <div class="metric-card"><span>工具</span><b>{{ traceMetrics.toolCalls }}(✅{{ Math.round(traceMetrics.toolSuccessRate * 100) }}%)</b></div>
                  <div class="metric-card" v-if="traceMetrics.compressions"><span>压缩</span><b>{{ traceMetrics.compressions }}</b></div>
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
              <div v-if="!contextSnap" class="trace-empty">未开启 contextInspector(默认开)或暂无快照。跑一轮 agent 后切回刷新。</div>
              <template v-else>
                <div class="ctx-overview">
                  <div class="ctx-occupancy">
                    <div class="ctx-bar-track" :title="`占用 ${Math.round(contextSnap.occupancy * 100)}%`">
                      <div class="ctx-bar-fill" :class="ctxOccupancyLevel" :style="{ width: Math.min(contextSnap.occupancy * 100, 100) + '%' }"></div>
                      <div v-if="contextSnap.thresholdRatio > 0" class="ctx-threshold-mark" :style="{ left: Math.min(contextSnap.thresholdRatio * 100, 100) + '%' }" title="压缩阈值"></div>
                    </div>
                    <span class="ctx-pct">{{ Math.round(contextSnap.occupancy * 100) }}%</span>
                  </div>
                  <div class="ctx-kv-row">
                    <span class="ctx-kv">估算 {{ contextSnap.totalTokens }} token</span>
                    <span class="ctx-kv" v-if="contextSnap.contextWindow">窗口 {{ contextSnap.contextWindow }}</span>
                    <span class="ctx-kv" v-if="contextSnap.thresholdRatio > 0">阈值 {{ Math.round(contextSnap.thresholdRatio * 100) }}%</span>
                  </div>
                </div>
                <div class="ctx-section-title">分类构成(近似)</div>
                <div v-for="c in contextSnap.categories" :key="c.key" class="ctx-cat">
                  <span class="ctx-cat-label" :title="c.label">{{ c.label }}</span>
                  <div class="ctx-cat-bar"><div class="ctx-cat-fill" :style="{ width: Math.max(Math.round(c.pct * 100), 2) + '%' }"></div></div>
                  <span class="ctx-cat-tokens">{{ c.tokens }} <i>({{ Math.round(c.pct * 100) }}%)</i></span>
                </div>
                <div v-if="contextSnap.compression" class="ctx-compression">
                  <div class="ctx-section-title">最近压缩</div>
                  <div class="ctx-kv-row">
                    <span class="ctx-kv">摘要 {{ contextSnap.compression.roundsSummarized }}/{{ contextSnap.compression.roundsTotal }} 轮</span>
                    <span class="ctx-kv">召回 {{ contextSnap.compression.roundsRecalled }}</span>
                    <span class="ctx-kv">{{ contextSnap.compression.strategy }}</span>
                    <span class="ctx-kv" v-if="contextSnap.compression.decision">🤖 agent 决策:{{ decisionSummary(contextSnap.compression.decision) }}</span>
                  </div>
                </div>
              </template>
            </div>
            <div v-if="tab === 'subagent'" class="subagent-panel">
              <!-- 组件锁视图(同组件单委派互斥;委派结束自动解锁) -->
              <div v-if="lockedEntries.length" class="sub-section">
                <div class="sub-section-title">🔒 组件锁 ({{ lockedEntries.length }})</div>
                <div v-for="[name, owner] in lockedEntries" :key="'lock-'+name" class="sub-task">🔒 {{ name }} ← {{ owner }}</div>
              </div>
              <div v-if="!subagentActive.length && !subagentHistory.length" class="trace-empty">
                尚未委派子 agent。主 agent 调用 <code>use_&lt;id&gt;</code> 或 <code>spawn_agent</code> 后,这里展示运行状态与委派历史。
              </div>
              <template v-else>
                <div v-if="subagentActive.length" class="sub-section">
                  <div class="sub-section-title">▶ 运行中 ({{ subagentActive.length }})</div>
                  <div v-for="(s, i) in subagentActive" :key="'a'+i" class="sub-card" :class="s.status">
                    <div class="sub-head">
                      <span class="sub-status" :style="{ background: (subStatusMeta[s.status] && subStatusMeta[s.status].color) || '#9ca3af' }">{{ (subStatusMeta[s.status] && subStatusMeta[s.status].label) || s.status }}</span>
                      <span class="sub-label">{{ s.label }}</span>
                      <span class="sub-steps-badge">{{ s.steps.length }} 步</span>
                    </div>
                    <div class="sub-task">{{ truncate(s.task, 80) }}</div>
                  </div>
                </div>
                <div v-if="subagentHistory.length" class="sub-section">
                  <div class="sub-section-title">🕐 历史 ({{ subagentHistory.length }})</div>
                  <div v-for="(s, i) in subagentHistory" :key="'h'+i" class="sub-card" :class="s.status">
                    <div class="sub-head">
                      <span class="sub-status" :style="{ background: (subStatusMeta[s.status] && subStatusMeta[s.status].color) || '#9ca3af' }">{{ (subStatusMeta[s.status] && subStatusMeta[s.status].label) || s.status }}</span>
                      <span class="sub-label">{{ s.label }}</span>
                      <span v-if="s.durationMs != null" class="sub-dur">{{ formatDuration(s.durationMs) }}</span>
                      <button v-if="s.steps.length" class="sub-toggle" @click="toggleSub(i)">{{ subExpanded.has(i) ? '收起' : '步骤' }}</button>
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
              暂无日志，发送消息后这里会显示 Agent 的完整上下文、工具调用等信息
            </div>

            <div v-for="(log, idx) in filteredLogs" :key="idx" class="log-item">
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
                    <div class="kv"><span class="k">模型</span><span class="v">{{ log.data.model }}</span></div>
                    <div class="kv"><span class="k">温度</span><span class="v">{{ log.data.temperature }}</span></div>
                    <div class="kv"><span class="k">MaxTokens</span><span class="v">{{ log.data.maxTokens }}</span></div>
                    <div class="kv"><span class="k">消息数</span><span class="v">{{ log.data.totalMessages }}</span></div>
                  </div>
                  <div class="section-label">工具 ({{ log.data.tools?.length || 0 }})</div>
                  <div class="chip-row">
                    <span v-for="t in log.data.tools" :key="t" class="tool-chip">{{ t }}</span>
                  </div>
                  <div class="section-label">上下文消息</div>
                  <div class="msg-list">
                    <div v-for="(m, mi) in log.data.messages" :key="mi" class="msg-row">
                      <span class="msg-role" :style="{ background: roleOf(m.type).color }">{{ roleOf(m.type).label }}</span>
                      <span class="msg-text">{{ m.content }}</span>
                    </div>
                  </div>
                </template>

                <!-- LLM 请求：轮次 + 消息列表 -->
                <template v-else-if="log.type === 'llm_request'">
                  <div class="badge-row">
                    <span class="badge">第 {{ log.data.round }} 轮</span>
                    <span v-if="log.data.model" class="badge muted">{{ log.data.model }}</span>
                    <span class="badge muted">{{ (log.data.messages || []).length }} 条消息</span>
                    <span v-if="log.data.tools?.length" class="badge muted">{{ log.data.tools.length }} 工具</span>
                    <button class="view-toggle" @click="toggleBody(idx)">
                      {{ bodyExpanded.has(idx) ? '🗂 卡片视图' : '📋 请求体' }}
                    </button>
                  </div>
                  <div v-if="!bodyExpanded.has(idx)" class="msg-list">
                    <div v-for="(m, mi) in log.data.messages" :key="mi" class="msg-row">
                      <span class="msg-role" :style="{ background: roleOf(m.role).color }">{{ roleOf(m.role).label }}</span>
                      <div class="msg-detail">
                        <span v-if="m.content" class="msg-text">{{ m.content }}</span>
                        <div v-for="(tc, ti) in m.tool_calls || []" :key="ti" class="tc-inline">
                          <span class="tc-inline-name">🔧 {{ tc.function?.name || tc.name }}</span>
                          <code class="tc-inline-args">{{ tc.function?.arguments ?? tc.args }}</code>
                        </div>
                        <span v-if="m.tool_call_id" class="tc-id">↳ tool_call_id: {{ m.tool_call_id }}</span>
                      </div>
                    </div>
                  </div>
                  <pre v-else class="log-raw"><code>{{ formatJson(log.data.messages) }}</code></pre>
                </template>

                <!-- LLM 响应：内容 + 工具调用 + 用量 -->
                <template v-else-if="log.type === 'llm_response'">
                  <div class="badge-row">
                    <span class="badge">第 {{ log.data.round }} 轮</span>
                    <span v-if="log.data.toolCalls?.length" class="badge warn">🔧 {{ log.data.toolCalls.length }} 个工具调用</span>
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

                <!-- 工具调用 -->
                <template v-else-if="log.type === 'tool_call'">
                  <div class="tc-card inline">
                    <div class="tc-name">🔧 {{ log.data.name }}</div>
                    <pre class="tc-args">{{ formatJson(log.data.args) }}</pre>
                  </div>
                </template>

                <!-- 工具结果 -->
                <template v-else-if="log.type === 'tool_result'">
                  <div class="tc-card inline">
                    <div class="tc-name">✅ {{ log.data.name }} 结果</div>
                    <pre class="tc-args">{{ log.data.result }}</pre>
                  </div>
                </template>

                <!-- 错误 -->
                <template v-else-if="log.type === 'error'">
                  <div class="err-box">{{ log.data.tool ? `[${log.data.tool}] ` : '' }}{{ log.data.error }}</div>
                </template>
              </div>

              <div class="log-footer">
                <button class="raw-toggle" @click="toggleRaw(idx)">
                  {{ rawExpanded.has(idx) ? '收起原始 JSON' : '查看原始 JSON' }}
                </button>
                <button class="raw-toggle" @click="copyText(formatJson(log.data))">复制</button>
              </div>
              <pre v-if="rawExpanded.has(idx)" class="log-raw"><code>{{ formatJson(log.data) }}</code></pre>
            </div>
            </template>

            <!-- 执行流程:按轮次分组的流水视图(走到哪个模块 + 结果)-->
            <template v-else-if="tab === 'flow'">
              <div v-if="!logs.length" class="empty">暂无日志，发送消息后这里按轮次展示执行流程</div>
              <div v-if="flowRounds.pre.length" class="flow-section">
                <div class="flow-section-title">⚙️ 准备 / 其他</div>
                <div v-for="(lg, i) in flowRounds.pre" :key="'p'+i" class="flow-node" :class="lg.type">
                  <span class="flow-ico">{{ typeMeta[lg.type]?.icon }}</span>
                  <span class="flow-label">{{ typeMeta[lg.type]?.label }}</span>
                  <span class="flow-detail">{{ flowNodeDetail(lg) }}</span>
                  <span class="flow-time">{{ formatTime(lg.timestamp) }}</span>
                </div>
              </div>
              <div v-for="r in flowRounds.rounds" :key="r.round" class="flow-round">
                <div class="flow-round-head">🔁 第 {{ r.round }} 轮</div>
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
              <div v-if="!agentInfo" class="empty">暂无信息</div>
              <template v-else>
                <div class="info-section">
                  <div class="info-title">基本信息</div>
                  <div class="kv-grid">
                    <div class="kv"><span class="k">ID</span><span class="v">{{ agentInfo.id }}</span></div>
                    <div class="kv"><span class="k">模型</span><span class="v">{{ agentInfo.model || '-' }}</span></div>
                    <div class="kv"><span class="k">工具数</span><span class="v">{{ agentInfo.tools.length }}</span></div>
                    <div class="kv"><span class="k">中间件</span><span class="v">{{ agentInfo.middleware.length }}</span></div>
                  </div>
                  <div class="kv" style="margin-top: 6px"><span class="k">中间件栈</span><span class="v" style="font-size: 11px">{{ agentInfo.middleware.join(' → ') || '-' }}</span></div>
                </div>

                <div class="info-section">
                  <div class="info-title">🔧 工具 ({{ agentInfo.tools.length }})</div>
                  <div v-for="t in agentInfo.tools" :key="t.name" class="info-item">
                    <div class="info-name">{{ t.name }}<span v-if="t.source" class="src-tag" :class="srcClass(t.source)">{{ t.source }}</span></div>
                    <div class="info-desc">{{ t.description }}</div>
                  </div>
                </div>

                <div v-if="agentInfo.skills.length" class="info-section">
                  <div class="info-title">📘 技能 ({{ agentInfo.skills.length }})<span class="info-hint">点击展开查看全文</span></div>
                  <div v-for="s in agentInfo.skills" :key="s.name" class="info-item">
                    <div class="info-name skill-toggle" @click="toggleSkill(s.name)">
                      <span class="skill-arrow" :class="{ open: !!skillExpanded[s.name] }">▶</span>
                      {{ s.name }}
                    </div>
                    <div class="info-desc">{{ s.description }}</div>
                    <div v-if="skillExpanded[s.name]" class="skill-content">
                      <div v-if="skillExpanded[s.name].loading" class="skill-loading">加载中…</div>
                      <div v-else-if="skillExpanded[s.name].error" class="skill-error">{{ skillExpanded[s.name].error }}</div>
                      <pre v-else-if="skillExpanded[s.name].content" class="skill-pre">{{ skillExpanded[s.name].content }}</pre>
                    </div>
                  </div>
                </div>

                <div v-if="agentInfo.data" class="info-section">
                  <div class="info-title">📊 可操作数据</div>
                  <div class="info-item">
                    <div class="info-name">{{ agentInfo.data.description || '主数据对象' }}</div>
                    <div class="info-desc">schema: {{ agentInfo.data.schema ? '已声明' : '未声明' }}</div>
                  </div>
                </div>

                <div class="info-section">
                  <div class="info-title">🧬 子 Agent</div>
                  <div class="kv-grid">
                    <div class="kv"><span class="k">启用</span><span class="v">{{ agentInfo.subagent.enabled ? '是' : '否' }}</span></div>
                    <div class="kv"><span class="k">最大递归</span><span class="v">{{ agentInfo.subagent.maxDepth }}</span></div>
                    <div class="kv"><span class="k">并行上限</span><span class="v">{{ agentInfo.subagent.maxParallel }}</span></div>
                    <div class="kv"><span class="k">额外工具</span><span class="v" style="font-size: 11px">{{ agentInfo.subagent.allowedTools.length ? agentInfo.subagent.allowedTools.join(', ') : '默认只读' }}</span></div>
                  </div>
                </div>

                <div v-if="agentInfo.mcp?.servers?.length" class="info-section">
                  <div class="info-title">🔌 MCP ({{ agentInfo.mcp.servers.length }})</div>
                  <div v-for="s in agentInfo.mcp.servers" :key="s.name" class="info-item">
                    <div class="info-name">{{ s.name }} <span class="src-tag mcp">{{ s.toolCount }} 工具</span></div>
                    <div class="info-desc">{{ s.url }}</div>
                  </div>
                </div>

                <div v-if="agentInfo.verify" class="info-section">
                  <div class="info-title">✅ Verify 自检</div>
                  <div class="kv-grid">
                    <div class="kv"><span class="k">启用</span><span class="v">{{ agentInfo.verify.enabled ? '是' : '否' }}</span></div>
                    <div class="kv"><span class="k">自纠上限</span><span class="v">{{ agentInfo.verify.maxAttempts }}</span></div>
                    <div class="kv"><span class="k">对抗验证</span><span class="v">{{ agentInfo.verify.adversarial ? '开启' : '关闭' }}</span></div>
                    <div v-if="agentInfo.verify.adversarial" class="kv"><span class="k">对抗模型</span><span class="v" style="font-size: 11px">{{ agentInfo.model || '-' }}(同主)</span></div>
                  </div>
                </div>

                <div v-if="agentInfo.todos.length" class="info-section">
                  <div class="info-title">📋 任务清单 ({{ agentInfo.todos.length }})</div>
                  <div v-for="(td, i) in agentInfo.todos" :key="i" class="info-todo">
                    <span class="todo-tag" :style="{ background: (statusMeta[td.status] && statusMeta[td.status].color) || '#9ca3af' }">{{ statusLabel(td.status) }}</span>
                    <span>{{ td.content }}</span>
                  </div>
                </div>

                <div v-if="agentInfo.memory" class="info-section">
                  <div class="info-title">📝 持久指令 (memory)</div>
                  <pre class="info-pre">{{ agentInfo.memory }}</pre>
                </div>

                <div v-if="agentInfo.lastCompression" class="info-section">
                  <div class="info-title">🗜️ 上轮压缩</div>
                  <div class="info-kv">
                    <div class="kv"><span class="k">触发</span><span class="v">{{ agentInfo.lastCompression.triggered ? '✓' : '✗(未达阈值)' }}</span></div>
                    <div class="kv"><span class="k">摘要轮次</span><span class="v">{{ agentInfo.lastCompression.roundsSummarized }} / {{ agentInfo.lastCompression.roundsTotal }}</span></div>
                    <div class="kv"><span class="k">召回</span><span class="v">{{ agentInfo.lastCompression.roundsRecalled }} 条</span></div>
                    <div class="kv"><span class="k">消息数</span><span class="v">{{ agentInfo.lastCompression.originalMessages }} → {{ agentInfo.lastCompression.compressedMessages }}</span></div>
                    <div class="kv"><span class="k">策略</span><span class="v" style="font-size: 11px">{{ agentInfo.lastCompression.strategy }}</span></div>
                    <div class="kv" v-if="agentInfo.lastCompression.decision"><span class="k">压缩决策</span><span class="v" style="font-size: 11px">🤖 {{ decisionSummary(agentInfo.lastCompression.decision) }}</span></div>
                  </div>
                </div>
              </template>
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
.drawer-body { flex: 1; overflow-y: auto; padding: 12px; }
.empty { text-align: center; color: var(--dd-faint); font-size: 13px; padding: 40px 20px; }
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
