<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { ToolStep, ToolStepViewFn } from '../../types'
import { applyStepView } from '../stepView'
import { copyText } from '../../utils/clipboard'
import { DEFAULT_DIALOG_ICONS, type DialogIcons } from '../icons'
import { MESSAGES_ZH_CN, type DialogMessages } from '../messages'
import SubReasonDetails from './SubReasonDetails.vue'
import IconGlyph from '../IconGlyph.vue'
import MsgText from '../MsgText.vue'

// icons 由 MessageRow 从 ctx 下传(纯 props 叶子零依赖);独立复用时缺省用默认图标集
const props = withDefaults(defineProps<{ steps: ToolStep[]; icons?: DialogIcons; messages?: DialogMessages; stepView?: ToolStepViewFn }>(), {
  icons: () => ({ ...DEFAULT_DIALOG_ICONS }),
  messages: () => ({ ...MESSAGES_ZH_CN }),
  stepView: undefined,
})

/** 步骤状态中文标签(running/done/error → 执行中/成功/失败),配合色块 status-dot 使用 */
function statusLabel(status: 'running' | 'done' | 'error'): string {
  const msg = props.messages
  return status === 'running' ? msg.statusRunning : status === 'error' ? msg.statusError : msg.statusDone
}

/**
 * 相邻同名工具合并:仅合并连续同名,count>1 显示 ×N;不相邻的同名工具分别成组。状态聚合(有 error→error,有 running→running,否则 done),children 合并,耗时求和。
 * 展示映射(stepView):合并键 = 映射后标题(两次同名调用映射出不同标题 → 分行显示,集成方可按 args 细分);
 * detail 仅单次调用(count===1)展示 —— 合并组的各次调用 args 可能不同,展示单一 detail 会误导。
 */
function groupedSteps(steps: ToolStep[]) {
  const groups: { name: string; title: string; detail?: string; count: number; hasRunning: boolean; hasError: boolean; children: ToolStep[]; calls: ToolStep[]; totalMs: number; subReason?: string; subReasonFull?: string }[] = []
  for (const s of steps) {
    const view = applyStepView(props.stepView, s)
    const title = view.title ?? s.name
    const last = groups.length ? groups[groups.length - 1] : null
    if (last && last.title === title) {
      last.count++
      if (s.status === 'running') last.hasRunning = true
      if (s.status === 'error') last.hasError = true
      if (s.durationMs) last.totalMs += s.durationMs
      if (s.children?.length) last.children.push(...s.children)
      if (s.subReason) last.subReason = (last.subReason || '') + s.subReason
      if (s.subReasonFull) last.subReasonFull = (last.subReasonFull || '') + s.subReasonFull
      last.calls.push(s)
    } else {
      groups.push({
        name: s.name,
        title,
        detail: view.detail,
        count: 1,
        hasRunning: s.status === 'running',
        hasError: s.status === 'error',
        children: s.children?.length ? [...s.children] : [],
        calls: [s],
        totalMs: s.durationMs ?? 0,
        subReason: s.subReason,
        subReasonFull: s.subReasonFull,
      })
    }
  }
  return groups.map((e) => ({
    name: e.name,
    title: e.title,
    detail: e.detail,
    count: e.count,
    status: e.hasError ? 'error' : e.hasRunning ? 'running' : 'done',
    children: e.children,
    calls: e.calls,  // 每次调用的原始步骤(自带 args/result,展开细节用;主 agent 普通工具无 children 也有)
    durationMs: e.totalMs || undefined,
    subReason: e.subReason,
    subReasonFull: e.subReasonFull,
  }))
}

const groups = computed(() => groupedSteps(props.steps))

/** 是否子 agent 委派工具(use_* 前缀,如 use_html / use_rag)。子 agent 委派下方会有「思考中…」块,与普通工具视觉区分 */
function isSubagentTool(name: string): boolean {
  return name.startsWith('use_')
}

/** 耗时展示:≥1000ms 用 s 单位(如 1234 → 1.2s),以下精确 ms。子 agent 长任务动辄数十秒,纯 ms 数字过长 */
function formatDuration(ms: number): string {
  if (ms >= 1000) {
    const s = ms / 1000
    return s >= 10 ? `${Math.round(s)}s` : `${s.toFixed(1)}s`
  }
  return `${ms}ms`
}

// ===== 展开查看入参/返回细节(用户实测诉求:工具调用只有名字,排查要看 args/result) =====
/** 展开态为模块级单例(同一时间只展开一个 —— 跨消息/跨步骤互斥,避免多面板堆高页面) */
const expandedGlobal = reactive(new Set<string>())
let instanceSeq = 0
/** 本组件实例的稳定 key 前缀(setup 一次;每条消息的 steps 各占一段命名空间) */
const uid = `s${++instanceSeq}`
const expanded = {
  has: (sIdx: number) => expandedGlobal.has(`${uid}:${sIdx}`),
  toggle: (sIdx: number) => {
    const key = `${uid}:${sIdx}`
    if (expandedGlobal.has(key)) expandedGlobal.delete(key)
    else {
      // 单展开只收敛到本实例(uid 前缀):同页双对话框互不干扰(rv-recent F4 —— 原全局 clear 会
      // 收起另一实例的面板);本实例内跨消息/跨步骤互斥语义保留
      for (const k of Array.from(expandedGlobal)) if (k.startsWith(`${uid}:`)) expandedGlobal.delete(k)
      expandedGlobal.add(key)
    }
  },
}
function toggleExpand(sIdx: number): void {
  expanded.toggle(sIdx)
}
/** 组是否有可展开细节(任一调用有 args 或 result;运行中只有 args 也可看) */
function hasDetail(calls: ToolStep[] | undefined): boolean {
  return !!calls?.some((c) => c.args != null || c.result != null)
}

const ARGS_DISPLAY_CAP = 2000
const RESULT_DISPLAY_CAP = 4000

/** 入参展示:对象 pretty JSON;超长截断(复制可拿全量) */
function fmtArgs(args: unknown): { text: string; truncated: boolean } {
  if (args == null) return { text: '', truncated: false }
  let text: string
  try {
    text = typeof args === 'string' ? args : JSON.stringify(args, null, 2)
  } catch {
    text = String(args)
  }
  return text.length > ARGS_DISPLAY_CAP
    ? { text: text.slice(0, ARGS_DISPLAY_CAP) + props.messages.displayTruncatedSuffix, truncated: true }
    : { text, truncated: false }
}
/** 字符串若为 JSON 对象/数组 → 格式化成缩进 JSON(便于阅读/复制);否则原样 */
function prettyJson(s: string): string {
  try {
    const p = JSON.parse(s)
    if (p && typeof p === 'object') return JSON.stringify(p, null, 2)
  } catch { /* 非 JSON 原样 */ }
  return s
}
/** 返回值展示:JSON 字符串格式化成对象;超长截断(复制可拿全量) */
function fmtResult(result: string | undefined): { text: string; truncated: boolean } {
  if (result == null || result === '') return { text: '', truncated: false }
  const base = prettyJson(result)
  return base.length > RESULT_DISPLAY_CAP
    ? { text: base.slice(0, RESULT_DISPLAY_CAP) + props.messages.displayTruncatedSuffix, truncated: true }
    : { text: base, truncated: false }
}
function copyDetail(text: string, truncated: boolean, full?: unknown): void {
  // 展示截断时复制原始全量(未 JSON.stringify 的原 args / 原始 result 字符串)
  if (truncated && full != null) {
    let fullText: string
    try {
      fullText = typeof full === 'string' ? full : JSON.stringify(full, null, 2)
    } catch {
      fullText = String(full)
    }
    void copyText(fullText)
    return
  }
  void copyText(text)
}
</script>

<template>
  <div v-if="steps.length" class="steps-block">
    <div v-for="(step, sIdx) in groups" :key="sIdx" class="step-item" :class="step.status">
      <div class="step-head">
        <span class="status-dot" :class="step.status"></span>
        <span class="step-name">{{ step.title }}</span>
        <!-- 展示映射补充说明(单次调用;合并组 ×N 各次 args 可能不同,不展示单一 detail 防误导) -->
        <span v-if="step.detail && step.count === 1" class="step-detail-hint">{{ step.detail }}</span>
        <span v-if="isSubagentTool(step.name)" class="subagent-badge" :title="messages.subagentBadgeTitle"><IconGlyph :icon="icons.subagent" /> {{ messages.subagentBadge }}</span>
        <span v-if="step.count > 1" class="step-count">×{{ step.count }}</span>
        <span class="step-status" :class="step.status"><MsgText :text="statusLabel(step.status)" /></span>
        <span v-if="step.durationMs != null && step.status !== 'running'" class="step-duration">{{ formatDuration(step.durationMs) }}</span>
        <!-- 行右端展开/收起(Figma 471:6389「05-思考完成」:Skill 行右「展开」置灰 / 思考过程展开中右「收起」紫色) -->
        <button v-if="hasDetail(step.calls)" type="button" class="step-detail-toggle" :class="{ open: expanded.has(sIdx) }" @click="toggleExpand(sIdx)">
          {{ expanded.has(sIdx) ? messages.collapse : messages.expand }}
        </button>
      </div>
      <!-- 展开细节:每次调用的入参 + 返回值(×N 合并组逐次列出;超长截断,复制得全量) -->
      <div v-if="expanded.has(sIdx) && step.calls?.length" class="step-detail">
        <div v-for="(c, cIdx) in step.calls" :key="cIdx" class="step-detail-call">
          <div v-if="step.count > 1" class="step-detail-call-label">{{ messages.nthCallPrefix }}{{ cIdx + 1 }}{{ messages.nthCallSuffix }}</div>
          <div v-if="fmtArgs(c.args).text" class="step-detail-section">
            <div class="step-detail-head">{{ messages.argsLabel }}<button type="button" class="step-detail-copy" @click="copyDetail(fmtArgs(c.args).text, fmtArgs(c.args).truncated, c.args)">{{ messages.copy }}</button></div>
            <pre class="step-detail-pre">{{ fmtArgs(c.args).text }}</pre>
          </div>
          <div v-if="c.status !== 'running' && fmtResult(c.result).text" class="step-detail-section">
            <div class="step-detail-head">{{ messages.resultLabel }}<button type="button" class="step-detail-copy" @click="copyDetail(fmtResult(c.result).text, fmtResult(c.result).truncated, c.result)">{{ messages.copy }}</button></div>
            <pre class="step-detail-pre" :class="{ err: c.status === 'error' }">{{ fmtResult(c.result).text }}</pre>
          </div>
          <div v-else-if="c.status !== 'running' && !fmtResult(c.result).text" class="step-detail-empty">{{ messages.noResult }}</div>
        </div>
      </div>
      <!-- 子 agent 思考过程(reasoning 增量累积;运行中字符计数+脉冲+自动滚底,完成后折叠回看) -->
      <SubReasonDetails v-if="step.subReason" :sub-reason="step.subReason" :sub-reason-full="step.subReasonFull" :status="step.status" :messages="messages" />
      <!-- 子 agent 工作进度(嵌套展示;紫色系与主工具区分;相邻同名工具经 groupedSteps 合并为 ×N,与主 agent 一致) -->
      <div v-if="step.children && step.children.length" class="step-children">
        <div class="step-children-label"><IconGlyph :icon="icons.subagentProgress" /> {{ messages.subagentProgress }}</div>
        <div v-for="(c, cIdx) in groupedSteps(step.children)" :key="cIdx" class="step-child" :class="c.status">
          <span class="status-dot sm" :class="c.status"></span>
          <span class="step-name">{{ c.title }}</span>
          <span v-if="c.count > 1" class="step-count">×{{ c.count }}</span>
          <span v-if="c.status === 'running'" class="step-status running">…</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.steps-block { margin-bottom: 6px; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
.step-item { display: flex; flex-direction: column; gap: 3px; align-self: flex-start; padding: 5px 10px; border-radius: 8px; background: var(--cs-step-bg); border: 1px solid var(--cs-step-border); font-size: 11px; color: var(--cs-step-text); max-width: 100%; user-select: text; -webkit-user-select: text; }
.step-head { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.step-name { font-family: 'SF Mono', Monaco, Consolas, monospace; font-weight: 600; }
/* 展示映射补充说明(纯文本,元信息色;不进 monospace —— 是自然语言不是代码名) */
.step-detail-hint { font-size: 10px; color: var(--cs-step-meta); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.step-count { font-size: 10px; color: var(--cs-step-meta); font-weight: 600; }
.step-status { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 3px; letter-spacing: 0.2px; }
.step-status.done { color: var(--cs-ok); background: rgba(var(--cs-ok-rgb), 0.12); }
.step-status.running { color: var(--cs-warn); background: rgba(var(--cs-warn-rgb), 0.12); }
.step-status.error { color: var(--cs-err); background: rgba(var(--cs-err-rgb), 0.12); }
.step-duration { font-size: 10px; color: var(--cs-step-meta); font-family: 'SF Mono', Monaco, Consolas, monospace; }
/* 行右端「展开/收起」文字链(Figma 471:6389):收起态置灰、展开态紫色高亮 */
.step-detail-toggle { margin-left: auto; border: none; background: transparent; padding: 0 2px; font-size: 10px; font-weight: 600; color: var(--cs-step-meta); cursor: pointer; user-select: none; border-radius: 4px; flex-shrink: 0; }
.step-detail-toggle:hover { color: var(--cs-primary); }
.step-detail-toggle.open { color: var(--cs-sub-text); }
/* 展开细节面板:入参/返回值 monospace 滚动区(用户实测诉求:排查要看工具 IO 细节) */
.step-detail { display: flex; flex-direction: column; gap: 6px; width: 100%; min-width: 280px; max-width: min(560px, 72vw); padding: 6px 8px; border-radius: 6px; border: 1px solid var(--cs-step-border); background: var(--cs-bg, rgba(127, 127, 127, 0.06)); }
.step-detail-call { display: flex; flex-direction: column; gap: 4px; }
.step-detail-call + .step-detail-call { border-top: 1px dashed var(--cs-step-border); padding-top: 6px; }
.step-detail-call-label { font-size: 10px; color: var(--cs-step-meta); font-weight: 600; }
.step-detail-section { display: flex; flex-direction: column; gap: 2px; }
.step-detail-head { display: flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 600; color: var(--cs-step-meta); letter-spacing: 0.3px; }
.step-detail-copy { border: none; background: transparent; color: var(--cs-step-meta); cursor: pointer; font-size: 10px; padding: 0 2px; border-radius: 3px; }
.step-detail-copy:hover { color: var(--cs-primary); background: rgba(var(--cs-primary-rgb, 31, 77, 58), 0.1); }
.step-detail-pre { margin: 0; padding: 6px 8px; border-radius: 4px; background: rgba(127, 127, 127, 0.1); color: var(--cs-step-text); font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 10px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; user-select: text; -webkit-user-select: text; }
.step-detail-pre.err { color: var(--cs-err); }
.step-detail-empty { font-size: 10px; color: var(--cs-step-meta); font-style: italic; }
/* 子 agent 委派工具标记(use_*):区分普通工具;紫色系呼应「🧬 子 agent 进度」子块 */
.subagent-badge { font-size: 9px; font-weight: 600; padding: 0 5px; border-radius: 4px; background: rgba(108, 92, 231, 0.14); color: var(--cs-sub-text); line-height: 1.6; letter-spacing: 0.2px; white-space: nowrap; }
.step-children { padding: 4px 8px 4px 10px; border-left: 2px solid var(--cs-sub-border); border-radius: 0 6px 6px 0; background: var(--cs-sub-bg); display: flex; flex-direction: column; gap: 3px; margin-top: 4px; }
.step-children-label { font-size: 10px; font-weight: 600; color: var(--cs-sub-text); letter-spacing: 0.3px; }
.step-child { display: inline-flex; align-items: center; gap: 5px; padding: 1px 4px; border-radius: 6px; font-size: 10px; color: var(--cs-sub-text); }
.step-child .step-name { color: var(--cs-sub-text); font-weight: 400; }
.step-child .step-status.running { color: var(--cs-sub-text); background: rgba(108, 92, 231, 0.12); }
.status-dot.ok { background: var(--cs-ok); }

/* 状态色块(base + 变体;本组件内 status-dot 出现在 step-head / step-child) */
.status-dot { width: 8px; height: 8px; border-radius: 3px; flex-shrink: 0; background: var(--cs-step-meta); }
.status-dot.done { background: var(--cs-ok); }
.status-dot.running { background: var(--cs-warn); }
.status-dot.error { background: var(--cs-err); }
.status-dot.sm { width: 6px; height: 6px; border-radius: 2px; }
</style>
