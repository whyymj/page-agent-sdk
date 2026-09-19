<script setup lang="ts">
/**
 * content-proposals 集成模板:textarea 持内容真相源 + SDK proposals 通道 + 宿主 diff 评审面板。
 *
 * 演示链路:用户对 AI 说「修一下错别字」→ AI 调 read_content 取基底与 hash → propose_content 提交
 * **增量 ops**(token 只花在改动上)→ 宿主面板渲染逐行 diff → 用户点「应用并写回」→ textarea 更新 +
 * sdk.resolveProposal(id, 'applied') → AI 下一轮被自动告知结果。
 *
 * 集成面只有两件:proposals.read / proposals.onProposal(渲染面板);写回完全在宿主(SDK 零写权限)。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { createChatSdk, type ChatSdk, type ReviewableProposal } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

const root = ref<HTMLElement>()
const source = ref('---\ntitle: 演示笔记\ntype: note\n---\n\n注意力机致是这篇笔记的核心概念。\n\nKV Cache 以显存换速度。\n')
let agent: ChatSdk | null = null
/** 在审提案面板态(一次一条;SDK pending 与面板同步由 onProposal 驱动) */
const panel = ref<ReviewableProposal | null>(null)
const notice = ref('')

/** 折叠长未改动段(≥10 行的首尾 3 行)—— 评审面板可读性 */
function compressRows(rows: ReviewableProposal['diff']['rows']): Array<{ type: string; text: string }> {
  const out: Array<{ type: string; text: string }> = []
  let i = 0
  while (i < rows.length) {
    if (rows[i].type !== 'same') { out.push(rows[i]); i += 1; continue }
    let end = i
    while (end < rows.length && rows[end].type === 'same') end += 1
    const len = end - i
    if (len >= 10) {
      out.push(...rows.slice(i, i + 3))
      out.push({ type: 'skip', text: `⋯ 未改动 ${len - 6} 行 ⋯` })
      out.push(...rows.slice(end - 3, end))
    } else out.push(...rows.slice(i, end))
    i = end
  }
  return out
}

const applyProposal = (): void => {
  if (!panel.value || !agent) return
  const p = panel.value
  source.value = p.content            // 宿主写回:SDK 不知道也不经手怎么落盘
  agent.resolveProposal(p.id, 'applied', '已写回 textarea')
  panel.value = null
  notice.value = `已应用「${p.summary}」(+${p.diff.stats.added} / -${p.diff.stats.removed} 行)`
}
const discardProposal = (): void => {
  if (!panel.value || !agent) return
  agent.resolveProposal(panel.value.id, 'discarded')
  panel.value = null
  notice.value = '已放弃提案,内容未变'
}

onMounted(() => {
  agent = createChatSdk({
    id: 'proposals-demo',
    container: '#chat-root',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
      temperature: 0.3,
    },
    storage: 'memory',
    debug: true,
    capabilities: { dataOps: false },
    dialog: { drawer: true, drawerHidden: true, title: '内容编辑助手', placeholder: '让 AI 修改左侧文字,如「修一下错别字」…' },
    proposals: {
      contentKind: '演示笔记 Markdown(含 frontmatter)',
      read: () => ({ content: source.value, label: '演示笔记' }),
      onProposal: (p) => {
        panel.value = p
        return `提案已送达,评审面板已在页面打开(+${p.diff.stats.added} / -${p.diff.stats.removed} 行),请用户确认。`
      },
    },
  })
  agent.mount()
  ;(window as any).__sdk = agent
})
onUnmounted(() => agent?.unmount())

const openDrawer = (): void => agent?.show()
</script>

<template>
  <div class="prop-page">
    <DevNav />
    <header class="prop-hero">
      <h1>内容提案评审(content-proposals)</h1>
      <p>AI 只能提案,不能写:改动经逐行 diff 评审,你点「应用」才写回 textarea —— SDK 零写权限,增量 ops 只花改动量的 token。</p>
    </header>

    <div class="prop-main">
      <section class="prop-editor">
        <h2>📝 内容真相源(textarea)</h2>
        <textarea v-model="source" class="prop-source" spellcheck="false" data-test="source" aria-label="Markdown 源文" />
        <p v-if="notice" class="prop-notice" data-test="notice">{{ notice }}</p>
      </section>

      <section v-if="panel" class="prop-panel" data-test="proposal-panel">
        <header class="prop-panel-head">
          <strong>AI 修改提案 · {{ panel.label }}</strong>
          <span class="prop-meta">{{ panel.summary }} · +{{ panel.diff.stats.added }} / -{{ panel.diff.stats.removed }} 行</span>
        </header>
        <div class="prop-diff" data-test="diff-box">
          <div v-for="(row, i) in compressRows(panel.diff.rows)" :key="i" class="prop-row" :class="row.type">
            <span class="prop-sign">{{ row.type === 'add' ? '+' : row.type === 'del' ? '-' : '' }}</span>
            <span class="prop-text">{{ row.text }}</span>
          </div>
        </div>
        <footer class="prop-panel-bar">
          <span class="prop-hint">应用 = 写回 textarea 并告知 AI;放弃 = 完全不动</span>
          <span class="prop-actions">
            <button type="button" class="prop-btn" data-test="discard-btn" @click="discardProposal">放弃</button>
            <button type="button" class="prop-btn accent" data-test="apply-btn" @click="applyProposal">应用并写回</button>
          </span>
        </footer>
      </section>
    </div>

    <button class="ask-btn" data-test="ask-btn" @mousedown.prevent @click="openDrawer">问 AI</button>
    <div id="chat-root" ref="root"></div>
  </div>
</template>

<style scoped>
.prop-page { max-width: 960px; margin: 0 auto; padding: 24px 20px 120px; }
.prop-hero h1 { font-size: 24px; margin: 12px 0 4px; }
.prop-hero p { color: #6b7280; font-size: 13.5px; margin: 0 0 18px; }
.prop-main { display: grid; gap: 16px; }
.prop-editor h2 { font-size: 15px; margin: 0 0 8px; }
.prop-source { width: 100%; min-height: 220px; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; font: 13px/1.7 ui-monospace, monospace; resize: vertical; }
.prop-notice { color: #047857; font-size: 13px; }
.prop-panel { border: 1px solid #c7d2c9; border-radius: 10px; overflow: hidden; background: #fff; }
.prop-panel-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 10px 14px; background: #f0f7f1; }
.prop-meta { color: #374151; font-size: 12.5px; }
.prop-diff { max-height: 320px; overflow: auto; font: 12.5px/1.65 ui-monospace, monospace; padding: 6px 0; }
.prop-row { display: flex; gap: 8px; padding: 0 14px; white-space: pre-wrap; }
.prop-row.add { background: #e6f7ec; color: #116632; }
.prop-row.del { background: #fdecec; color: #8a2b2b; text-decoration: line-through; }
.prop-row.skip { color: #9ca3af; padding: 2px 14px; }
.prop-sign { width: 12px; flex: none; }
.prop-panel-bar { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-top: 1px solid #e5e7eb; }
.prop-hint { color: #6b7280; font-size: 12.5px; }
.prop-actions { display: flex; gap: 8px; }
.prop-btn { padding: 8px 16px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; cursor: pointer; font-size: 13px; }
.prop-btn.accent { background: #1f4d3a; color: #fff; border-color: #1f4d3a; }
.ask-btn { position: fixed; right: 28px; bottom: 28px; z-index: 30; padding: 10px 18px; border-radius: 999px; border: none; cursor: pointer; background: #1f4d3a; color: #fff; font-size: 14px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18); }
</style>
