<script setup lang="ts">
/**
 * 子 agent 思考过程折叠块(reasoning 增量累积)。
 * UX 优化:
 *  - 运行中:summary 显示「思考中… N字」+ 脉冲点(字符计数随 reasoning 流式增长 → 不再有"卡住"感)
 *  - 默认折叠(不刷屏;思考照常进行,只是不打扰)—— 用户点击 summary 才展开看详情
 *  - 展开后运行中自动滚到底(跟随最新思考);完成保留用户展开选择;下轮 details 重随 step 重建
 */
import { ref, watch, nextTick, computed } from 'vue'
import { MESSAGES_ZH_CN, type DialogMessages } from '../messages'

const props = withDefaults(defineProps<{ subReason: string; subReasonFull?: string; status: 'running' | 'done' | 'error'; messages?: DialogMessages }>(), {
  messages: () => ({ ...MESSAGES_ZH_CN }),
})

const bodyRef = ref<HTMLElement>()
// 默认折叠(不刷屏;思考过程不打扰用户,点击才看)。open 经 @toggle 双向同步用户操作
const open = ref(false)

// 运行中 + 内容增长 → 滚到底(跟随最新思考增量,免手动滚)
watch(
  () => props.subReason.length,
  async () => {
    if (props.status === 'running' && open.value && bodyRef.value) {
      await nextTick()
      bodyRef.value.scrollTop = bodyRef.value.scrollHeight
    }
  },
)

// 总字数(subReasonFull 不截尾,计数照涨过 cap;无则用 subReason 长度)+ 是否已截尾(仅显最近部分)
const charCount = computed(() => props.subReasonFull?.length ?? props.subReason.length)
// 字数展示:≥1000 自动换 k 单位(4200→4.2k、1000→1k、≥10万取整 123k),与主推理块口径一致
const charCountLabel = computed(() => {
  const n = charCount.value
  if (n < 1000) return String(n)
  const v = n / 1000
  return `${v >= 100 ? Math.round(v) : +v.toFixed(1)}k`
})
const truncated = computed(() => (props.subReasonFull?.length ?? props.subReason.length) > props.subReason.length)

// 复制**完整**思考内容到剪贴板(便于排查中间过程/问题;渲染截尾防卡死,但复制取 subReasonFull 全量)
const copied = ref(false)
async function copyReason() {
  try {
    await navigator.clipboard.writeText(props.subReasonFull ?? props.subReason)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
  } catch { /* 剪贴板不可用(非 HTTPS/无权限)静默 */ }
}
</script>

<template>
  <details class="step-sub-reason" :open="open" @toggle="open = ($event.target as HTMLDetailsElement).open">
    <summary class="sub-reason-head">
      <span class="status-dot sm" :class="status === 'running' ? 'running' : 'ok'"></span>
      <span class="sub-reason-label" :class="{ pulsing: status === 'running' }">
        {{ status === 'running' ? `${messages.thinkingCountPrefix}${charCountLabel}${messages.charCountSuffix}` : messages.reasoningTitle }}
      </span>
      <span v-if="truncated" class="sub-reason-trunc">{{ messages.truncatedNotePrefix }}{{ subReason.length }}{{ messages.truncatedNoteSuffix }}</span>
      <button type="button" class="sub-reason-copy" :class="{ copied }" :title="truncated ? messages.copyThinkingTruncTitle : messages.copyThinking" @click.stop.prevent="copyReason">{{ copied ? messages.copied : messages.copy }}</button>
    </summary>
    <div ref="bodyRef" class="sub-reason-body">{{ truncated ? '…(前面已截断)\n' : '' }}{{ subReason }}</div>
  </details>
</template>

<style scoped>
.step-sub-reason { margin-top: 4px; border-left: 2px solid var(--cs-sub-border); border-radius: 0 6px 6px 0; background: var(--cs-sub-bg); }
.sub-reason-head { display: flex; align-items: center; gap: 5px; padding: 3px 8px; cursor: pointer; user-select: none; font-size: 10px; color: var(--cs-sub-text); font-weight: 600; list-style: none; }
.sub-reason-head::-webkit-details-marker { display: none; }
/* 展开箭头 ▸ → 旋转 90° */
.sub-reason-head::before { content: '▸'; display: inline-block; font-size: 9px; color: var(--cs-sub-text); transition: transform 0.15s ease; }
.step-sub-reason[open] .sub-reason-head::before { transform: rotate(90deg); }
/* 运行中脉冲点(思考活跃指示,治"卡住"感) */
.sub-reason-label.pulsing::after { content: ' ●'; animation: cs-think-pulse 1.2s ease-in-out infinite; margin-left: 1px; }
@keyframes cs-think-pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
.sub-reason-body { padding: 4px 10px 6px; border-top: 1px solid var(--cs-sub-border); font-size: 10px; line-height: 1.5; color: var(--cs-sub-text); white-space: pre-wrap; word-break: break-word; max-height: 240px; overflow-y: auto; user-select: text; -webkit-user-select: text; }
.sub-reason-trunc { margin-left: 4px; font-size: 9px; font-weight: 400; opacity: 0.7; }
/* 复制按钮(右对齐;@click.stop 不触 summary 折叠) */
.sub-reason-copy { margin-left: auto; border: none; background: rgba(108, 92, 231, 0.14); color: var(--cs-sub-text); border-radius: 4px; padding: 1px 7px; font-size: 10px; cursor: pointer; line-height: 1.5; transition: background 0.15s; }
.sub-reason-copy:hover { background: rgba(108, 92, 231, 0.26); }
.sub-reason-copy.copied { background: rgba(16, 185, 129, 0.2); color: var(--cs-ok); }
/* 状态色块(本组件内 status-dot) */
.status-dot { width: 6px; height: 6px; border-radius: 2px; flex-shrink: 0; background: var(--cs-step-meta); }
.status-dot.running { background: var(--cs-warn); animation: cs-sub-breathe 1.2s ease-in-out infinite; }
.status-dot.ok { background: var(--cs-ok); }
/* 思考中状态点呼吸(运行中活跃指示) */
@keyframes cs-sub-breathe { 0%, 100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1); } }
</style>
