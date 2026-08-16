<script setup lang="ts">
/**
 * 对话头部:标题 + 会话管理(新建/历史) + 更多菜单(调试/skill/清空) + 关闭/折叠。
 * session 历史 / more 菜单的展开状态为组件内部 UI(moreOpen/historyOpen),不进 ctx;
 * sessions/currentSessionId 及 on* 回调走 props(design §2 展示配置 + 回调走 props);
 * debug/skill 打开 / 清空 / reset(切会话前) / toggleCollapse 走 ctx;close 用 emit(Vue 惯例)。
 * 注:focus 条(:393-407)是独立区块(task 7 抽 FocusBar),不在 ChatHeader。
 */
import { ref, computed } from 'vue'
import IconGlyph from './IconGlyph.vue'
import { useChatContext } from '../composables/chatContext'
import type { DebugLog } from '../harness/createAgent'
import type { SessionMeta } from '../backends/storage'

const props = defineProps<{
  title: string
  /** 抽屉模式(显示关闭按钮) */
  drawer: boolean
  /** 调试日志(有则显示徽标 + 菜单项) */
  debugLogs?: DebugLog[]
  /** 是否支持 Skill 管理(容器按 onAddSkill 是否存在传入) */
  skillAvailable: boolean
  /** 历史会话列表(storage 开启注入;不传则隐藏新建/历史按钮) */
  sessions?: SessionMeta[]
  /** 当前会话 id(历史列表高亮) */
  currentSessionId?: string
  onNewSession?: () => void
  onOpenSession?: (sessionId: string) => void
  onRemoveSession?: (sessionId: string) => void
}>()

defineEmits<{ (e: 'close'): void }>()

const ctx = useChatContext()
const { chat, icons } = ctx
const { state, reset, clearMessages } = chat

const moreOpen = ref(false)
const historyOpen = ref(false)
const hasMessages = computed(() => state.messages.length > 0)
const hasDebugLogs = computed(() => (props.debugLogs?.length ?? 0) > 0)

/** 历史会话相对时间(刚刚 / N 分钟前 / 完整时间) */
function fmtSessionTime(ts: number): string {
  const d = Date.now() - ts
  if (d < 60000) return '刚刚'
  if (d < 3600000) return Math.floor(d / 60000) + '分钟前'
  return new Date(ts).toLocaleString()
}

/** 新建会话:先停当前生成 + 清状态(防 ghost 流续烧 + 跨会话残留),再委派 SDK */
function handleNewSession(): void {
  reset()
  props.onNewSession?.()
}
function handleOpenSession(id: string): void {
  reset()
  props.onOpenSession?.(id)
}
</script>

<template>
  <!-- 原 ChatDialog header 有 cursor:pointer 但未绑 click(折叠功能 dead,isExpanded 恒 true);保持原行为不接 toggleCollapse,遵守「默认路径行为零变化」(design §6) -->
  <div class="chat-header">
    <div class="header-left">
      <span class="header-icon"><IconGlyph :icon="icons.header" /></span>
      <span class="header-title">{{ title }}</span>
      <span v-if="state.loading" class="status-dot pulse"></span>
    </div>
    <div class="header-actions" @click.stop>
      <!-- 会话管理(sessions 注入 = storage 开启;不传则隐藏) -->
      <button v-if="sessions" class="action-btn" data-test="new-chat" title="新建会话" @click="handleNewSession">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"></path></svg>
      </button>
      <button v-if="sessions" class="action-btn" :class="{ active: historyOpen }" data-test="toggle-history" title="历史记录" @click="moreOpen = false; historyOpen = !historyOpen">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"></path><path d="M3 3v5h5"></path><path d="M12 7v5l3 2"></path></svg>
      </button>
      <!-- 历史面板(弹出) -->
      <div v-if="sessions && historyOpen" class="cs-history-menu" @click.stop>
        <div
          v-for="s in sessions"
          :key="s.sessionId"
          class="hist-item"
          :class="{ active: currentSessionId === s.sessionId }"
          :data-sid="s.sessionId"
          @click="handleOpenSession(s.sessionId)"
        >
          <div class="hist-title">{{ s.title || '会话 ' + s.sessionId.slice(-6) }}</div>
          <div class="hist-meta">
            <span>{{ fmtSessionTime(s.lastAccessed) }}</span>
            <button v-if="currentSessionId !== s.sessionId" class="hist-del" data-test="del-btn" @click.stop="onRemoveSession?.(s.sessionId)">✕</button>
          </div>
        </div>
      </div>
      <!-- 更多(调试 / skill / 清空 合并下拉) -->
      <button class="action-btn more-btn" :class="{ active: moreOpen }" title="更多" @click="historyOpen = false; moreOpen = !moreOpen">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.6"></circle><circle cx="12" cy="12" r="1.6"></circle><circle cx="12" cy="19" r="1.6"></circle>
        </svg>
        <span v-if="hasDebugLogs" class="debug-badge">{{ debugLogs?.length }}</span>
      </button>
      <div v-if="moreOpen" class="more-menu" @click.stop>
        <button class="more-item" title="日志 / 执行流程 / Agent 信息" @click="ctx.openDebug(); moreOpen = false">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 2v8l-3 3v2h12v-2l-3-3V2"></path><path d="M9 2h6"></path><path d="M9 18h6"></path>
          </svg>
          <span>调试 / 日志</span>
          <span v-if="hasDebugLogs" class="more-item-badge">{{ debugLogs?.length }}</span>
        </button>
        <button v-if="skillAvailable" class="more-item" title="创建 / 管理自定义 Skill" @click="ctx.openSkill(); moreOpen = false">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2l2.4 7.4H22l-6 4.4 2.3 7.2L12 16.8 5.7 21l2.3-7.2-6-4.4h7.6z"></path>
          </svg>
          <span>Skill 管理</span>
        </button>
        <button class="more-item" title="清空对话" :disabled="!hasMessages" @click="clearMessages(); moreOpen = false">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
          <span>清空对话</span>
        </button>
      </div>
      <!-- 关闭(抽屉模式) -->
      <button v-if="drawer" class="action-btn" title="关闭" @click="$emit('close')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"></path>
        </svg>
      </button>
    </div>
    <!-- 下拉遮罩(点外部关闭:更多菜单 / 历史面板) -->
    <div v-if="moreOpen || historyOpen" class="more-overlay" @click="moreOpen = false; historyOpen = false"></div>
  </div>
</template>

<style scoped>
.chat-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  background: var(--cs-header-bg, var(--cs-primary));
  color: #fff; cursor: pointer; user-select: none;
  flex-shrink: 0;
  position: relative; z-index: 16;
}
.header-left { display: flex; align-items: center; gap: 8px; }
.header-icon { font-size: 20px; }
.header-title { font-size: 15px; font-weight: 600; }

.status-dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; }
.status-dot.pulse { animation: cs-pulse 1.5s infinite; }
@keyframes cs-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

.header-actions { display: flex; gap: 4px; position: relative; z-index: 20; }
.action-btn {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border: none; border-radius: 6px;
  background: var(--cs-action-bg, rgba(255, 255, 255, 0.15)); color: var(--cs-action-text, #fff); cursor: pointer;
  transition: background 0.2s;
}
.action-btn:hover:not(:disabled) { background: var(--cs-action-hover, rgba(255, 255, 255, 0.3)); }
.action-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.more-btn { position: relative; }
.more-btn.active { background: var(--cs-action-hover, rgba(255, 255, 255, 0.45)); }
.more-menu {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 20;
  min-width: 168px; padding: 4px;
  background: var(--cs-surface, #fff); color: var(--cs-surface-text, #1f2937);
  border: 1px solid var(--cs-surface-border, rgba(0, 0, 0, 0.12)); border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
}
.more-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 8px 10px; border: none; background: none;
  font: inherit; font-size: 13px; color: inherit; cursor: pointer; border-radius: 6px; text-align: left;
}
.more-item:hover:not(:disabled) { background: var(--cs-surface-hover, rgba(0, 0, 0, 0.06)); }
.more-item:disabled { opacity: 0.4; cursor: not-allowed; }
.more-item svg { opacity: 0.7; flex-shrink: 0; }
.more-item-badge { margin-left: auto; background: var(--cs-primary, #1f4d3a); color: #fff; font-size: 10px; padding: 1px 6px; border-radius: 999px; }
.more-overlay { position: fixed; inset: 0; z-index: 15; }

.cs-history-menu {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 20;
  min-width: 220px; max-height: 320px; overflow-y: auto; padding: 4px;
  background: var(--cs-surface, #fff); color: var(--cs-surface-text, #1f2937);
  border: 1px solid var(--cs-surface-border, rgba(0, 0, 0, 0.12)); border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
}
.hist-item { padding: 8px 10px; border-radius: 6px; cursor: pointer; }
.hist-item:hover { background: var(--cs-surface-hover, rgba(0, 0, 0, 0.06)); }
.hist-item.active { background: var(--cs-hist-active-bg, rgba(var(--cs-primary-rgb, 31, 77, 58), 0.15)); border-left: var(--cs-hist-active-border, 2px solid var(--cs-primary, #1f4d3a)); color: var(--cs-hist-active-text, inherit); }
.hist-title { font-size: 13px; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hist-meta { display: flex; justify-content: space-between; align-items: center; font-size: 11px; opacity: 0.6; }
.hist-del { background: none; border: none; cursor: pointer; font-size: 13px; opacity: 0.6; padding: 0 4px; }
.hist-del:hover { opacity: 1; color: #dc2626; }

.debug-badge {
  position: absolute; top: -2px; right: -2px;
  min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
  background: #ef4444; color: #fff; font-size: 10px; line-height: 16px; font-weight: 600;
}
</style>
