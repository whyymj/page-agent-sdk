<script setup lang="ts">
/**
 * 人工确认条:工具调用前需用户允许/拒绝(approval 中间件挂起) / LLM 主动征询(request_human_confirmation 挂起)。
 * 零 props:pendingApproval/resolveApproval 从 ctx.chat 取;approvalArgsExpanded 自持;
 * isHumanConfirm/approvalOptions/approvalArgsPreview 从 pendingApproval 派生(design §3)。
 */
import { ref, computed, watch } from 'vue'
import IconGlyph from './IconGlyph.vue'
import { useChatContext } from '../composables/chatContext'
import MsgText from './MsgText.vue'

const ctx = useChatContext()
const { pendingApproval, resolveApproval } = ctx.chat
const m = ctx.messages
const planConfirmation = ctx.planConfirmation

/** 工具调用参数 JSON 默认收起,点「查看参数」展开;新一次挂起重置 */
const approvalArgsExpanded = ref(false)
watch(pendingApproval, () => { approvalArgsExpanded.value = false })

/** 是否为 LLM 主动征询:展示问题/方案/推荐,而非工具调用确认 */
const isHumanConfirm = computed(() => pendingApproval.value?.toolName === 'request_human_confirmation')
/** 主动征询的可选方案列表(多方案时让用户选) */
const approvalOptions = computed<string[]>(() => {
  const opts = pendingApproval.value?.args?.options
  return Array.isArray(opts) ? opts.map(String) : []
})
/** 待确认工具调用的参数预览(截断长 JSON,便于用户判断) */
const approvalArgsPreview = computed(() => {
  const a = pendingApproval.value?.args
  if (a == null) return ''
  try {
    const s = typeof a === 'string' ? a : JSON.stringify(a, null, 2)
    return s.length > 400 ? s.slice(0, 400) + m.argsTruncatedSuffix : s
  } catch {
    return String(a)
  }
})
</script>

<template>
  <div v-if="pendingApproval" class="approval-bar">
    <!-- LLM 主动征询:展示问题 / 可选方案 / 推荐 -->
    <template v-if="isHumanConfirm">
      <div class="approval-head">
        <span class="approval-icon">❓</span>
        <span class="approval-title">{{ m.humanConfirmTitle }}</span>
      </div>
      <div v-if="pendingApproval.args?.question" class="approval-question">{{ pendingApproval.args.question }}</div>
      <div v-if="pendingApproval.args?.context" class="approval-context">{{ pendingApproval.args.context }}</div>
      <div v-if="pendingApproval.args?.recommendation" class="approval-recommend"><IconGlyph :icon="ctx.icons.recommend" />{{ m.recommendPrefix }}{{ pendingApproval.args.recommendation }}</div>
      <!-- 可选方案纵向排列(方案文案常较长,横向拥挤;整行按钮更易点选) -->
      <div v-if="approvalOptions.length" class="approval-options">
        <button v-for="opt in approvalOptions" :key="opt" class="approval-opt" @click="resolveApproval(opt)">{{ opt }}</button>
      </div>
      <div class="approval-actions">
        <button class="approval-deny" @click="resolveApproval(false)"><MsgText :text="m.deny" /></button>
        <button v-if="!approvalOptions.length" class="approval-allow" @click="resolveApproval(true)"><MsgText :text="m.approve" /></button>
      </div>
    </template>
    <!-- 工具调用确认:展示工具名 + 参数 -->
    <template v-else>
      <div class="approval-head">
        <span class="approval-icon">✋</span>
        <span class="approval-title">{{ m.toolConfirmPrefix }}<code>{{ pendingApproval.toolName }}</code></span>
        <button v-if="approvalArgsPreview" class="approval-toggle" @click="approvalArgsExpanded = !approvalArgsExpanded">
          {{ approvalArgsExpanded ? m.collapseArgs : m.viewArgs }}{{ approvalArgsExpanded ? ' ▴' : ' ▾' }}
        </button>
      </div>
      <pre v-if="approvalArgsPreview && approvalArgsExpanded" class="approval-args">{{ approvalArgsPreview }}</pre>
      <!-- 方案确认上下文(save-and-plan-gates 3c):本会话已确认过方案 → 提示行帮用户快速判断该点同意;不自动跳过(拆兜底不可) -->
      <div v-if="planConfirmation" class="approval-plan-context">
        <IconGlyph :icon="ctx.icons.recommend" />{{ m.planConfirmedPrefix }}{{ planConfirmation.choice }}{{ m.planConfirmedSuffix }}
      </div>
      <div class="approval-actions">
        <button class="approval-deny" @click="resolveApproval(false)"><MsgText :text="m.deny" /></button>
        <button class="approval-allow" @click="resolveApproval(true)"><MsgText :text="m.approve" /></button>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* 人工确认条:警示语义用 --cs-warn 色系(两主题各自适配),表面色随 --cs-* 主题变量 —— 深色主题不再出现刺眼奶黄块 */
.approval-bar { margin: 10px 12px; padding: 12px 14px; border: 1px solid rgba(var(--cs-warn-rgb, 217, 119, 6), 0.35); border-left: 3px solid var(--cs-warn, #d97706); border-radius: 10px; background: linear-gradient(180deg, rgba(var(--cs-warn-rgb, 217, 119, 6), 0.09) 0%, rgba(var(--cs-warn-rgb, 217, 119, 6), 0.04) 100%); box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06); }
.approval-head { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--cs-bg-text); }
.approval-icon { font-size: 18px; }
.approval-title { flex: 1; min-width: 0; }
.approval-title code { padding: 2px 7px; border-radius: 5px; background: rgba(var(--cs-warn-rgb, 217, 119, 6), 0.14); color: var(--cs-warn, #d97706); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.approval-toggle { padding: 3px 10px; border: 1px solid rgba(var(--cs-warn-rgb, 217, 119, 6), 0.4); background: transparent; color: var(--cs-warn, #d97706); font-size: 12px; cursor: pointer; border-radius: 6px; transition: all 0.2s; }
.approval-toggle:hover { background: rgba(var(--cs-warn-rgb, 217, 119, 6), 0.12); }
.approval-args { margin: 10px 0; padding: 10px; max-height: 160px; overflow: auto; border-radius: 8px; background: var(--cs-bubble-ai, #fff); border: 1px solid rgba(var(--cs-warn-rgb, 217, 119, 6), 0.25); font-size: 12px; color: var(--cs-bg-text); white-space: pre-wrap; word-break: break-all; line-height: 1.5; }
.approval-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 10px; }
.approval-options { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.approval-options .approval-opt { width: 100%; text-align: left; padding: 9px 14px; white-space: normal; line-height: 1.5; }
.approval-actions button { padding: 6px 18px; border: none; border-radius: 7px; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
.approval-deny { background: transparent; color: var(--cs-bg-muted); border: 1px solid var(--cs-surface-border, #e5e7eb); }
.approval-deny:hover { background: rgba(127, 127, 127, 0.1); color: var(--cs-bg-text); }
.approval-allow { background: var(--cs-primary); color: #fff; box-shadow: 0 1px 3px rgba(var(--cs-primary-rgb), 0.3); }
.approval-allow:hover { opacity: 0.92; transform: translateY(-1px); }
.approval-question { margin: 10px 0; padding: 10px 12px; border-radius: 8px; background: var(--cs-bubble-ai, #fff); border: 1px solid rgba(var(--cs-warn-rgb, 217, 119, 6), 0.25); font-size: 13px; color: var(--cs-bg-text); line-height: 1.6; white-space: pre-wrap; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03); }
.approval-context { margin: 6px 0 10px; padding: 0 2px; font-size: 12px; color: var(--cs-bg-muted); line-height: 1.6; }
.approval-recommend { margin: 8px 0 10px; padding: 8px 12px; border-radius: 8px; background: rgba(var(--cs-primary-rgb), 0.08); border-left: 3px solid var(--cs-primary); font-size: 12px; color: var(--cs-accent, var(--cs-primary)); line-height: 1.6; }
.approval-plan-context { margin: 8px 0 2px; padding: 8px 12px; border-radius: 8px; background: rgba(var(--cs-ok-rgb, 22, 163, 74), 0.1); border-left: 3px solid var(--cs-ok, #16a34a); font-size: 12px; color: var(--cs-ok, #16a34a); line-height: 1.6; }
.approval-opt { padding: 6px 16px; border: 1px solid rgba(var(--cs-primary-rgb), 0.5); border-radius: 7px; background: rgba(var(--cs-primary-rgb), 0.06); color: var(--cs-accent, var(--cs-primary)); font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
.approval-opt:hover { background: var(--cs-primary); border-color: var(--cs-primary); color: #fff; transform: translateY(-1px); }
</style>
