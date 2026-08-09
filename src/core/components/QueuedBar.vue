<script setup lang="ts">
/** 排队区:生成中用户又发的任务(未执行,生成完后自动执行);可撤销/修改(填回输入框)。零 props,全用 ctx。 */
import { useChatContext } from '../composables/chatContext'

const ctx = useChatContext()
const { chat, editQueued } = ctx
const { queuedTasks, removeQueuedTask } = chat
</script>

<template>
  <div v-if="queuedTasks.length" class="queued-bar">
    <div class="queued-head">
      <span class="queued-icon">📋</span>
      <span class="queued-title">排队中 · 生成完后自动执行</span>
      <span class="queued-count">{{ queuedTasks.length }}</span>
    </div>
    <div v-for="(task, qIdx) in queuedTasks" :key="qIdx" class="queued-item">
      <span class="queued-idx">{{ qIdx + 1 }}</span>
      <span class="queued-text">{{ task }}</span>
      <button class="queued-act" title="修改(填回输入框编辑)" @click="editQueued(qIdx)">✏️</button>
      <button class="queued-act queued-del" title="撤销该任务" @click="removeQueuedTask(qIdx)">✕</button>
    </div>
  </div>
</template>

<style scoped>
.queued-bar { margin: 10px 12px; padding: 10px 12px; border: 1px solid #e5e7eb; border-left: 3px solid var(--cs-primary); border-radius: 10px; background: linear-gradient(180deg, #f9fafb 0%, #ffffff 100%); box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04); }
.queued-head { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #6b7280; margin-bottom: 6px; letter-spacing: 0.2px; }
.queued-icon { font-size: 13px; }
.queued-title { font-weight: 600; color: #4b5563; }
.queued-count { margin-left: auto; min-width: 18px; height: 18px; padding: 0 6px; border-radius: 9px; background: var(--cs-primary); color: #fff; font-size: 11px; font-weight: 600; line-height: 18px; text-align: center; }
.queued-item { display: flex; align-items: center; gap: 8px; padding: 7px 10px; margin-top: 6px; border-radius: 8px; background: #fff; border: 1px solid #eef0f3; transition: border-color 0.2s, box-shadow 0.2s; animation: cs-queued-in 0.22s cubic-bezier(0.16, 1, 0.3, 1); }
.queued-item:hover { border-color: #d1d5db; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.05); }
.queued-idx { flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%; background: rgba(var(--cs-primary-rgb), 0.1); color: var(--cs-primary); font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; }
.queued-text { flex: 1; min-width: 0; font-size: 12px; color: #1f2937; line-height: 1.5; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.queued-act { flex-shrink: 0; width: 22px; height: 22px; border: none; border-radius: 6px; background: transparent; color: #9ca3af; font-size: 11px; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; justify-content: center; opacity: 0.55; }
.queued-item:hover .queued-act { opacity: 1; }
.queued-act:hover { background: #f3f4f6; color: #1f2937; }
.queued-act.queued-del:hover { background: #fef2f2; color: #dc2626; }
@keyframes cs-queued-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { .queued-item { animation: none; } }
</style>
