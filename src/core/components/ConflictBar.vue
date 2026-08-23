<script setup lang="ts">
/**
 * 乐观锁冲突条:agent 写入时发现属性已被外部改过(expectedHash 不匹配),挂起等用户决定。
 * 纯 props 零注入(design §3 决策1,可独立用/单测):pendingConflict + onResolve 由容器传入;
 * conflictExpanded 自持;agent/current 预览从 pendingConflict 派生。
 */
import { ref, computed, watch } from 'vue'
import IconGlyph from './IconGlyph.vue'
import { DEFAULT_DIALOG_ICONS, type DialogIcons } from './icons'
import { MESSAGES_ZH_CN, type DialogMessages } from './messages'
import type { PendingConflict } from '../sdk/createChatSdk'
import type { ConflictResolution } from '../tools/dataOps'
import MsgText from './MsgText.vue'

const props = withDefaults(defineProps<{
  pendingConflict?: PendingConflict | null
  onResolve?: (action: ConflictResolution['action']) => void
  /** 图标集(容器从 ctx.icons 下传;独立复用时缺省用默认) */
  icons?: DialogIcons
  /** 文案集(容器从 ctx.messages 下传;独立复用缺省中文) */
  messages?: DialogMessages
}>(), {
  icons: () => ({ ...DEFAULT_DIALOG_ICONS }),
  messages: () => ({ ...MESSAGES_ZH_CN }),
})

const conflictExpanded = ref(false)
watch(() => props.pendingConflict, () => { conflictExpanded.value = false })

/** AI 想写的值(截断 JSON;delete 操作无值) */
const conflictAgentPreview = computed(() => {
  const v = props.pendingConflict?.agentValue
  if (v === undefined) return ''
  try {
    const s = JSON.stringify(v, null, 2)
    return s.length > 400 ? s.slice(0, 400) + props.messages.argsTruncatedSuffix : s
  } catch {
    return String(v)
  }
})
/** 外部改后的当前值(截断 JSON) */
const conflictCurrentPreview = computed(() => {
  const v = props.pendingConflict?.currentValue
  if (v == null) return ''
  try {
    const s = JSON.stringify(v, null, 2)
    return s.length > 400 ? s.slice(0, 400) + props.messages.argsTruncatedSuffix : s
  } catch {
    return String(v)
  }
})
</script>

<template>
  <div v-if="pendingConflict" class="conflict-bar">
    <div class="conflict-head">
      <span class="conflict-icon"><IconGlyph :icon="icons.conflict" /></span>
      <span class="conflict-title">{{ messages.conflictTitlePrefix }}<code>{{ pendingConflict.path }}</code>{{ messages.conflictTitleSuffix }}</span>
    </div>
    <div class="conflict-detail">
      {{ messages.conflictDetailTemplate.replace('{op}', pendingConflict.op === 'delete' ? messages.conflictOpDelete : messages.conflictOpWrite) }}
    </div>
    <button class="conflict-toggle" @click="conflictExpanded = !conflictExpanded">
      {{ conflictExpanded ? messages.collapseDiff : messages.viewDiff }}{{ conflictExpanded ? ' ▴' : ' ▾' }}
    </button>
    <div v-if="conflictExpanded" class="conflict-diff">
      <div class="conflict-diff-col">
        <div class="conflict-diff-label">{{ messages.agentValueLabel }}</div>
        <pre class="conflict-diff-pre">{{ conflictAgentPreview || messages.deleteNoValue }}</pre>
      </div>
      <div class="conflict-diff-col">
        <div class="conflict-diff-label">{{ messages.currentValueLabel }}</div>
        <pre class="conflict-diff-pre">{{ conflictCurrentPreview }}</pre>
      </div>
    </div>
    <div class="conflict-actions">
      <button class="conflict-keep" @click="onResolve?.('keep_external')" :title="messages.keepExternalTitle"><MsgText :text="messages.keepExternal" /></button>
      <button class="conflict-overwrite" @click="onResolve?.('overwrite')" :title="messages.overwriteTitle"><MsgText :text="messages.overwrite" /></button>
      <button class="conflict-restore" @click="onResolve?.('restore')" :title="messages.restoreTitle"><MsgText :text="messages.restore" /></button>
    </div>
  </div>
</template>

<style scoped>
/* 冲突条:危险语义用 --cs-err 色系(两主题适配),表面色随主题变量(深色下不再白底刺眼) */
.conflict-bar { margin: 8px 12px; padding: 10px 12px; border: 1px solid rgba(var(--cs-err-rgb, 220, 38, 38), 0.45); border-left: 3px solid var(--cs-err, #dc2626); border-radius: 10px; background: rgba(var(--cs-err-rgb, 220, 38, 38), 0.07); }
.conflict-head { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--cs-err, #dc2626); }
.conflict-icon { font-size: 15px; }
.conflict-title code { padding: 1px 6px; border-radius: 4px; background: rgba(var(--cs-err-rgb, 220, 38, 38), 0.14); color: var(--cs-err, #dc2626); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.conflict-detail { margin: 6px 0 8px; font-size: 12px; color: var(--cs-bg-text); opacity: 0.85; line-height: 1.5; }
.conflict-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.conflict-actions button { padding: 5px 14px; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; transition: opacity 0.2s; }
.conflict-keep { background: transparent; color: var(--cs-bg-muted); border: 1px solid var(--cs-surface-border, #e5e7eb); }
.conflict-keep:hover { background: rgba(127, 127, 127, 0.1); color: var(--cs-bg-text); }
.conflict-overwrite { background: var(--cs-err, #dc2626); color: #fff; }
.conflict-overwrite:hover { opacity: 0.9; }
.conflict-restore { background: transparent; color: var(--cs-err, #dc2626); border: 1px solid rgba(var(--cs-err-rgb, 220, 38, 38), 0.5); }
.conflict-restore:hover { background: rgba(var(--cs-err-rgb, 220, 38, 38), 0.1); }
.conflict-toggle { margin: 2px 0 6px; padding: 2px 8px; border: none; background: transparent; color: var(--cs-err, #dc2626); font-size: 12px; cursor: pointer; border-radius: 4px; }
.conflict-toggle:hover { background: rgba(var(--cs-err-rgb, 220, 38, 38), 0.1); }
.conflict-diff { display: flex; gap: 8px; margin: 4px 0 8px; }
.conflict-diff-col { flex: 1; min-width: 0; }
.conflict-diff-label { font-size: 11px; color: var(--cs-bg-muted); margin-bottom: 2px; }
.conflict-diff-pre { margin: 0; padding: 6px; max-height: 140px; overflow: auto; border-radius: 6px; background: var(--cs-bubble-ai, #fff); border: 1px solid rgba(var(--cs-err-rgb, 220, 38, 38), 0.3); font-size: 11px; color: var(--cs-bg-text); white-space: pre-wrap; word-break: break-all; }
</style>
