<script setup lang="ts">
/**
 * 上下文聚焦条(focus-context:指定组件精修)。
 * design 盲点补救:原 ChatDialog 8 区块表漏列 focus 条(独立第 9 区块,header 与 body 之间)。
 * 纯 props(getFocus/onSetFocus/onClearFocus/infoTick),不 inject ctx;editingFocus 等内部自持。
 */
import { ref, computed, type Ref } from 'vue'
import IconGlyph from './IconGlyph.vue'
import { DEFAULT_DIALOG_ICONS, type DialogIcons } from './icons'
import type { Focus } from '../harness/state'

const props = withDefaults(defineProps<{
  getFocus?: () => Focus | undefined
  onSetFocus?: (focus: Focus) => { ok: boolean; error?: string }
  onClearFocus?: () => void
  /** Agent 信息刷新 tick(sdk.setFocus/clearFocus 后 ++ 触发 focusState 重算) */
  infoTick?: Ref<number>
  /** 图标集(容器从 ctx.icons 下传;独立复用时缺省用默认) */
  icons?: DialogIcons
}>(), {
  icons: () => ({ ...DEFAULT_DIALOG_ICONS }),
})

// 依赖 infoTick 响应式触发:++ → 重算 → chip 显示/隐藏
const focusState = computed(() => {
  void props.infoTick?.value
  return props.getFocus?.()
})
const editingFocus = ref(false)
const focusPathInput = ref('')
const focusLabelInput = ref('')

function submitFocus(): void {
  const path = focusPathInput.value.trim()
  if (!path || !props.onSetFocus) return
  const label = focusLabelInput.value.trim()
  const res = props.onSetFocus({ path, ...(label ? { label } : {}) })
  if (res?.ok) {
    editingFocus.value = false
    focusPathInput.value = ''
    focusLabelInput.value = ''
  }
}
function clearFocusChip(): void {
  props.onClearFocus?.()
  editingFocus.value = false
}
</script>

<template>
  <div v-if="focusState" class="focus-bar">
    <span class="focus-bar-icon"><IconGlyph :icon="icons.focus" /></span>
    <span class="focus-bar-text">
      <span v-if="focusState.label" class="focus-bar-label">{{ focusState.label }}</span>
      <code class="focus-bar-path">{{ focusState.path }}</code>
    </span>
    <button class="focus-bar-btn" title="切换聚焦路径" @click="editingFocus = !editingFocus">▾</button>
    <button class="focus-bar-btn" title="退出精修" data-test="focus-clear" @click="clearFocusChip">✕</button>
    <div v-if="editingFocus" class="focus-edit-row">
      <input v-model="focusPathInput" class="focus-edit-input" placeholder="jsonPath,如 components.3" data-test="focus-path-input" @keyup.enter="submitFocus" />
      <input v-model="focusLabelInput" class="focus-edit-input focus-edit-label" placeholder="标签(可选)" @keyup.enter="submitFocus" />
      <button class="focus-edit-go" data-test="focus-submit" @click="submitFocus">聚焦</button>
    </div>
  </div>
</template>

<style scoped>
.focus-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 6px 12px; background: rgba(var(--cs-primary-rgb, 108, 92, 231), 0.12); border-bottom: 1px solid rgba(var(--cs-primary-rgb, 108, 92, 231), 0.2); font-size: 12px; }
.focus-bar-icon { font-size: 14px; }
.focus-bar-text { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
.focus-bar-label { color: var(--cs-primary, #6c5ce7); font-weight: 600; white-space: nowrap; }
.focus-bar-path { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; color: var(--cs-bg-muted, #8888aa); background: rgba(255, 255, 255, 0.06); padding: 1px 5px; border-radius: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.focus-bar-btn { border: none; background: transparent; color: var(--cs-bg-muted, #8888aa); cursor: pointer; padding: 2px 6px; border-radius: 4px; font-size: 13px; line-height: 1; }
.focus-bar-btn:hover { background: rgba(255, 255, 255, 0.1); color: var(--cs-primary, #6c5ce7); }
.focus-edit-row { display: flex; gap: 6px; padding: 6px 12px 8px; background: rgba(var(--cs-primary-rgb, 108, 92, 231), 0.06); border-bottom: 1px solid rgba(var(--cs-primary-rgb, 108, 92, 231), 0.15); width: 100%; box-sizing: border-box; }
.focus-edit-input { flex: 1; min-width: 0; padding: 5px 8px; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 6px; background: var(--cs-bg, #222244); color: var(--cs-bg-text, #e5e7eb); font-size: 12px; font-family: inherit; }
.focus-edit-input:focus { outline: none; border-color: var(--cs-primary, #6c5ce7); }
.focus-edit-input::placeholder { color: var(--cs-bg-muted, #8888aa); opacity: 0.7; }
.focus-edit-label { flex: 0 0 90px; }
.focus-edit-go { padding: 5px 12px; border: none; border-radius: 6px; background: var(--cs-primary, #6c5ce7); color: #fff; font-size: 12px; cursor: pointer; flex-shrink: 0; }
.focus-edit-go:hover { opacity: 0.9; }
</style>
