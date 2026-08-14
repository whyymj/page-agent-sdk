<script setup lang="ts">
import { computed } from 'vue'
import type { ToolStep } from '../../types'
import SubReasonDetails from './SubReasonDetails.vue'

const props = defineProps<{ steps: ToolStep[] }>()

/** 步骤状态中文标签(running/done/error → 执行中/成功/失败),配合色块 status-dot 使用 */
function statusLabel(status: 'running' | 'done' | 'error'): string {
  return status === 'running' ? '执行中' : status === 'error' ? '失败' : '成功'
}

/** 相邻同名工具合并:仅合并连续同名,count>1 显示 ×N;不相邻的同名工具分别成组。状态聚合(有 error→error,有 running→running,否则 done),children 合并,耗时求和 */
function groupedSteps(steps: ToolStep[]) {
  const groups: { name: string; count: number; hasRunning: boolean; hasError: boolean; children: ToolStep[]; totalMs: number; subReason?: string; subReasonFull?: string }[] = []
  for (const s of steps) {
    const last = groups.length ? groups[groups.length - 1] : null
    if (last && last.name === s.name) {
      last.count++
      if (s.status === 'running') last.hasRunning = true
      if (s.status === 'error') last.hasError = true
      if (s.durationMs) last.totalMs += s.durationMs
      if (s.children?.length) last.children.push(...s.children)
      if (s.subReason) last.subReason = (last.subReason || '') + s.subReason
      if (s.subReasonFull) last.subReasonFull = (last.subReasonFull || '') + s.subReasonFull
    } else {
      groups.push({
        name: s.name,
        count: 1,
        hasRunning: s.status === 'running',
        hasError: s.status === 'error',
        children: s.children?.length ? [...s.children] : [],
        totalMs: s.durationMs ?? 0,
        subReason: s.subReason,
        subReasonFull: s.subReasonFull,
      })
    }
  }
  return groups.map((e) => ({
    name: e.name,
    count: e.count,
    status: e.hasError ? 'error' : e.hasRunning ? 'running' : 'done',
    children: e.children,
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
</script>

<template>
  <div v-if="steps.length" class="steps-block">
    <div v-for="(step, sIdx) in groups" :key="sIdx" class="step-item" :class="step.status">
      <div class="step-head">
        <span class="status-dot" :class="step.status"></span>
        <span class="step-name">{{ step.name }}</span>
        <span v-if="isSubagentTool(step.name)" class="subagent-badge" title="子 agent 委派(独立上下文,只回结论)">🤖 子</span>
        <span v-if="step.count > 1" class="step-count">×{{ step.count }}</span>
        <span class="step-status" :class="step.status">{{ statusLabel(step.status) }}</span>
        <span v-if="step.durationMs != null && step.status !== 'running'" class="step-duration">{{ formatDuration(step.durationMs) }}</span>
      </div>
      <!-- 子 agent 思考过程(reasoning 增量累积;运行中字符计数+脉冲+自动滚底,完成后折叠回看) -->
      <SubReasonDetails v-if="step.subReason" :sub-reason="step.subReason" :sub-reason-full="step.subReasonFull" :status="step.status" />
      <!-- 子 agent 工作进度(嵌套展示;紫色系与主工具区分;相邻同名工具经 groupedSteps 合并为 ×N,与主 agent 一致) -->
      <div v-if="step.children && step.children.length" class="step-children">
        <div class="step-children-label">🧬 子 agent 进度</div>
        <div v-for="(c, cIdx) in groupedSteps(step.children)" :key="cIdx" class="step-child" :class="c.status">
          <span class="status-dot sm" :class="c.status"></span>
          <span class="step-name">{{ c.name }}</span>
          <span v-if="c.count > 1" class="step-count">×{{ c.count }}</span>
          <span v-if="c.status === 'running'" class="step-status running">…</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.steps-block { margin-bottom: 6px; display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
.step-item { display: flex; flex-direction: column; gap: 3px; align-self: flex-start; padding: 5px 10px; border-radius: 8px; background: var(--cs-step-bg); border: 1px solid var(--cs-step-border); font-size: 11px; color: var(--cs-step-text); max-width: 100%; }
.step-head { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.step-name { font-family: 'SF Mono', Monaco, Consolas, monospace; font-weight: 600; }
.step-count { font-size: 10px; color: var(--cs-step-meta); font-weight: 600; }
.step-status { font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 3px; letter-spacing: 0.2px; }
.step-status.done { color: var(--cs-ok); background: rgba(var(--cs-ok-rgb), 0.12); }
.step-status.running { color: var(--cs-warn); background: rgba(var(--cs-warn-rgb), 0.12); }
.step-status.error { color: var(--cs-err); background: rgba(var(--cs-err-rgb), 0.12); }
.step-duration { font-size: 10px; color: var(--cs-step-meta); font-family: 'SF Mono', Monaco, Consolas, monospace; }
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
