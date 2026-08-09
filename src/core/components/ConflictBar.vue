<script setup lang="ts">
/**
 * 乐观锁冲突条:agent 写入时发现属性已被外部改过(expectedHash 不匹配),挂起等用户决定。
 * 纯 props 零注入(design §3 决策1,可独立用/单测):pendingConflict + onResolve 由容器传入;
 * conflictExpanded 自持;agent/current 预览从 pendingConflict 派生。
 */
import { ref, computed, watch } from 'vue'
import type { PendingConflict } from '../sdk/createChatSdk'
import type { ConflictResolution } from '../tools/dataOps'

const props = defineProps<{
  pendingConflict?: PendingConflict | null
  onResolve?: (action: ConflictResolution['action']) => void
}>()

const conflictExpanded = ref(false)
watch(() => props.pendingConflict, () => { conflictExpanded.value = false })

/** AI 想写的值(截断 JSON;delete 操作无值) */
const conflictAgentPreview = computed(() => {
  const v = props.pendingConflict?.agentValue
  if (v === undefined) return ''
  try {
    const s = JSON.stringify(v, null, 2)
    return s.length > 400 ? s.slice(0, 400) + '\n…(已截断)' : s
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
    return s.length > 400 ? s.slice(0, 400) + '\n…(已截断)' : s
  } catch {
    return String(v)
  }
})
</script>

<template>
  <div v-if="pendingConflict" class="conflict-bar">
    <div class="conflict-head">
      <span class="conflict-icon">⚠️</span>
      <span class="conflict-title">写入冲突:<code>{{ pendingConflict.path }}</code> 已被外部修改</span>
    </div>
    <div class="conflict-detail">
      AI 基于「读取时的旧值」准备{{ pendingConflict.op === 'delete' ? '删除' : '写入' }},但该属性在你读取之后被外部代码/其他 agent/手动改过。
    </div>
    <button class="conflict-toggle" @click="conflictExpanded = !conflictExpanded">
      {{ conflictExpanded ? '收起对比' : '查看值对比' }}{{ conflictExpanded ? ' ▴' : ' ▾' }}
    </button>
    <div v-if="conflictExpanded" class="conflict-diff">
      <div class="conflict-diff-col">
        <div class="conflict-diff-label">AI 想写的值</div>
        <pre class="conflict-diff-pre">{{ conflictAgentPreview || '(delete 操作无值)' }}</pre>
      </div>
      <div class="conflict-diff-col">
        <div class="conflict-diff-label">外部改后的当前值</div>
        <pre class="conflict-diff-pre">{{ conflictCurrentPreview }}</pre>
      </div>
    </div>
    <div class="conflict-actions">
      <button class="conflict-keep" @click="onResolve?.('keep_external')" title="不写入,保留外部修改后的值,AI 重新读取再改">保留外部</button>
      <button class="conflict-overwrite" @click="onResolve?.('overwrite')" title="用 AI 的值覆盖外部修改">强制覆盖</button>
      <button class="conflict-restore" @click="onResolve?.('restore')" title="回退到最近一次历史快照(agent 之前操作的检查点),撤销外部修改 + AI 不写入">回退</button>
    </div>
  </div>
</template>

<style scoped>
.conflict-bar { margin: 8px 12px; padding: 10px 12px; border: 1px solid #dc2626; border-radius: 10px; background: #fef2f2; }
.conflict-head { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #991b1b; }
.conflict-icon { font-size: 15px; }
.conflict-title code { padding: 1px 6px; border-radius: 4px; background: #fee2e2; color: #7f1d1d; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.conflict-detail { margin: 6px 0 8px; font-size: 12px; color: #7f1d1d; line-height: 1.5; }
.conflict-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.conflict-actions button { padding: 5px 14px; border: none; border-radius: 6px; font-size: 13px; cursor: pointer; transition: opacity 0.2s; }
.conflict-keep { background: #f3f4f6; color: #6b7280; border: 1px solid #e5e7eb; }
.conflict-keep:hover { background: #e5e7eb; color: #374151; }
.conflict-overwrite { background: #dc2626; color: #fff; }
.conflict-overwrite:hover { opacity: 0.9; }
.conflict-restore { background: #fff; color: #dc2626; border: 1px solid #dc2626; }
.conflict-restore:hover { background: #fee2e2; }
.conflict-toggle { margin: 2px 0 6px; padding: 2px 8px; border: none; background: transparent; color: #991b1b; font-size: 12px; cursor: pointer; border-radius: 4px; }
.conflict-toggle:hover { background: #fee2e2; }
.conflict-diff { display: flex; gap: 8px; margin: 4px 0 8px; }
.conflict-diff-col { flex: 1; min-width: 0; }
.conflict-diff-label { font-size: 11px; color: #7f1d1d; margin-bottom: 2px; }
.conflict-diff-pre { margin: 0; padding: 6px; max-height: 140px; overflow: auto; border-radius: 6px; background: #fff; border: 1px solid #fecaca; font-size: 11px; color: #57534e; white-space: pre-wrap; word-break: break-all; }
</style>
