<script setup lang="ts">
/**
 * 完全自建对话框(headless)+ 低代码页面 + 组件聚焦 demo。
 *
 * ui:false 不用内置 ChatDialog,自建深色对话框 + 低代码预览 + 两步拾取聚焦:
 *  ① 流式逐字 + ② 思考过程(reasoning) + ③ 工具步骤(read/write) + ④ 低代码 reactive bind 预览
 *  ⑤ 组件聚焦:点预览元素 → 选中(边界) → 「加入聊天」→ addFocus → 自建 chip 显示 + agent 写限定焦点子树
 *  ⑥ 会话管理:新建 / 历史 / 切换 / 删除(switchSession/sessions/deleteSession;storage indexed 持久化)
 *  ⑦ 多轮分隔 + 停止 + 深色主题
 *
 * 聚焦(headless 自建,不用内置 ChatInput chip):
 *   - 拾取:预览元素绑 data-path,@click 选中(边界),「💬 加入聊天」→ sdk.addFocus({path,label})
 *   - 显示:focuses ref(addFocus/removeFocus 后手动 sync sdk.getFocuses())→ 自建 chip(🎯 点回看/✕ 移除)
 *   - agent 侧:focus 中间件 augmentPrompt 自动注入焦点 + 范围收紧(写越界 PATH_DENIED,与内置同款)
 */
import { onMounted, onUnmounted, ref, shallowRef, reactive, computed, nextTick } from 'vue'
import { createChatSdk, z, DebugDrawer, type ChatSdk, type AgentMessage, type StreamEvent, type ToolStep, type Focus, type SessionMeta } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

// ④ 低代码页面:schema + reactive bind
const pageSchema = z.object({
  title: z.string().describe('页面标题'),
  theme: z.enum(['purple', 'emerald', 'amber']).describe('主题色:紫(purple)/绿(emerald)/橙(amber)'),
  cards: z.array(z.object({
    title: z.string().describe('卡片标题'),
    desc: z.string().describe('卡片描述'),
  })).describe('卡片列表'),
})
type PageTheme = 'purple' | 'emerald' | 'amber'
const THEMES: Record<PageTheme, { bg: string; accent: string; soft: string }> = {
  purple: { bg: '#1a1a2e', accent: '#a78bfa', soft: 'rgba(167, 139, 250, 0.12)' },
  emerald: { bg: '#0f1f1a', accent: '#34d399', soft: 'rgba(52, 211, 153, 0.12)' },
  amber: { bg: '#1f1a0f', accent: '#fbbf24', soft: 'rgba(251, 191, 36, 0.12)' },
}
const page = reactive({
  title: '我的低代码页面',
  theme: 'purple' as PageTheme,
  cards: [
    { title: '产品特性', desc: '描述产品的核心卖点与差异化优势。' },
    { title: '用户评价', desc: '真实用户的使用反馈与评分。' },
  ],
})

const sdk = shallowRef<ChatSdk | null>(null)
const messages = ref<AgentMessage[]>([])
const input = ref('')
const sending = ref(false)
const logEl = ref<HTMLElement>()
/** 当前拾取的组件(点预览元素选中 → 「加入聊天」→ addFocus) */
const picked = ref<{ path: string; label: string } | null>(null)
/** 聚焦焦点列表(响应式;addFocus/removeFocus 后手动 sync sdk.getFocuses()) */
const focuses = ref<Focus[]>([])
/** 会话历史(直接绑 sdk.sessions 响应式 ref —— switchSession 的 refreshSessions 是 fire-and-forget,响应式自动更新,无需手动 sync) */
const sessions = computed<SessionMeta[]>(() => sdk.value?.sessions.value ?? [])
/** 当前会话 id(switchSession/onClear 后 SDK emit session_restored,据此同步高亮) */
const currentSid = ref('')
const showHistory = ref(false)
/** 调试抽屉显隐(复用内置 DebugDrawer) */
const debugVisible = ref(false)
let ctrl: AbortController | null = null

onMounted(async () => {
  const s = createChatSdk({
    id: 'customize-demo',
    ui: false,
    storage: 'indexed',   // 持久化(会话历史跨刷新保留;memory 刷新即丢)
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    systemPrompt: [
      '你是低代码页面助手。可改主数据 page 的 title / theme / cards。',
      '改前先 read 查看当前值,用 write 增量改(patch: { op: "set", jsonPath, value })。加卡片用 op:append。',
      '用户聚焦了某组件时(目标提示会列出),只改该组件子树,不要动其他部分。简洁回答。',
    ].join('\n'),
    data: { schema: pageSchema, bind: page },
  })
  await s.mount()
  sdk.value = s
  messages.value = s.messages
  focuses.value = s.getFocuses()
  currentSid.value = s.sessionId
  // switchSession/onClear 后 SDK emit session_restored → 同步当前会话高亮
  s.hook((e) => { if (e.type === 'session_restored') currentSid.value = s.sessionId })
})
onUnmounted(() => { ctrl?.abort(); sdk.value?.unmount() })

async function send() {
  const text = input.value.trim()
  if (!text || sending.value || !sdk.value) return
  input.value = ''
  sending.value = true
  const ts = Date.now()
  const foci: Focus[] = focuses.value
  // 附发送时焦点快照到 user message(与内置 useChat 同款)→ 历史消息可追溯「这条在聚焦什么时发出」
  messages.value.push({
    role: 'user', content: text, timestamp: ts,
    ...(foci.length ? { focuses: foci.map((f) => ({ path: f.path, label: f.label })) } : {}),
  })
  const assistant = reactive<AgentMessage>({
    role: 'assistant', content: '', reasoning: '', steps: [] as ToolStep[], timestamp: ts + 1,
  })
  messages.value.push(assistant)
  ctrl = new AbortController()
  let pendingSep = false
  try {
    await sdk.value.stream(
      messages.value.slice(0, -1),
      (e: StreamEvent) => {
        switch (e.type) {
          case 'round_start':
            if (e.round > 1 && (assistant.content || assistant.reasoning)) pendingSep = true
            break
          case 'reasoning':
            if (pendingSep) { assistant.reasoning += '\n'; pendingSep = false }
            assistant.reasoning += e.delta
            scrollToBottom()
            break
          case 'text':
            if (pendingSep) { assistant.content += '\n'; pendingSep = false }
            assistant.content += e.delta
            scrollToBottom()
            break
          case 'tool_call':
            assistant.steps!.push({ name: e.name, args: e.args, status: 'running' })
            scrollToBottom()
            break
          case 'tool_result': {
            for (let i = assistant.steps!.length - 1; i >= 0; i--) {
              if (assistant.steps![i].name === e.name && assistant.steps![i].status === 'running') {
                assistant.steps![i].result = e.result
                assistant.steps![i].status = e.status
                break
              }
            }
            scrollToBottom()
            break
          }
        }
      },
      ctrl.signal,
    )
  } catch {
    // abort 视为正常停止
  } finally {
    sending.value = false
    if (!assistant.content && !assistant.reasoning) messages.value.pop()
    // headless 持久化:sdk.stream 不自动落盘(内置 useChat 经 onPersist 自动调 afterRound),
    // 自建对话框需手动 afterRound() 把当前轮 messages/vfs/todos 存到 store,否则 switchSession 切回丢消息
    sdk.value?.afterRound()
    await nextTick()
    scrollToBottom()
  }
}

function stop() { ctrl?.abort() }
function scrollToBottom() {
  requestAnimationFrame(() => { if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight })
}

// ⑤ 聚焦:点预览元素选中(再点取消)→ 「加入聊天」addFocus
function pick(path: string, label: string) {
  picked.value = picked.value?.path === path ? null : { path, label }
}
function addFocusFromPick() {
  if (!picked.value || !sdk.value) return
  const r = sdk.value.addFocus({ path: picked.value.path, label: picked.value.label })
  if (r.ok) {
    focuses.value = sdk.value.getFocuses() // 手动 sync(headless 无内置 chip 自动刷新)
    picked.value = null
  }
}
function removeFocus(path: string) {
  sdk.value?.removeFocus(path)
  focuses.value = sdk.value?.getFocuses() ?? []
}
/** chip 点击:滚动到预览对应组件 + 闪一下高亮(回看聚焦对象) */
function scrollToComponent(path: string) {
  const el = document.querySelector(`[data-path="${CSS.escape(path)}"]`) as HTMLElement | null
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('flash')
  setTimeout(() => el.classList.remove('flash'), 1200)
}

// ⑥ 会话管理:新建 / 历史 / 切换 / 删除(storage:indexed 持久化;sessions 响应式自动刷新)
/** 新建会话:保存当前 → 切到新会话(switchSession 无参 = 新建) */
async function newSession() {
  if (!sdk.value || sending.value) return
  await sdk.value.switchSession()
  focuses.value = sdk.value.getFocuses()
  showHistory.value = false
}
/** 打开历史会话(switchSession 恢复 messages/vfs/todos/focus 等) */
async function openSession(id: string) {
  if (!sdk.value || sending.value || id === currentSid.value) return
  await sdk.value.switchSession(id)
  focuses.value = sdk.value.getFocuses()
  showHistory.value = false
}
/** 删除历史会话(不可删当前;删当前请先切走) */
async function removeSession(id: string) {
  if (!sdk.value || id === currentSid.value) return
  await sdk.value.deleteSession(id)
}
function sessionLabel(s: SessionMeta): string {
  return s.title?.trim() || `会话 · ${formatTime(s.lastAccessed)}`
}
function formatTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ⑦ 调试抽屉(复用内置 DebugDrawer:7 类日志/Agent信息/上下文构成;纯 props 驱动,headless 直接传 sdk 数据)
const debugLogs = computed(() => sdk.value?.debugLogs.value ?? [])
function getInspect() { return sdk.value!.inspect() }
async function getSkillContent(name: string): Promise<string | null> {
  return sdk.value?.getUserSkill(name)?.content ?? null
}

function roleLabel(m: AgentMessage) {
  if (m.role === 'user') return '你'
  if (m.role === 'assistant') return 'AI'
  return '🔧'
}
function isStreaming(i: number): boolean {
  return sending.value && i === messages.value.length - 1 && messages.value[i].role === 'assistant'
}
function statusLabel(s: ToolStep['status']): string {
  if (s === 'running') return '⏳ 运行中'
  if (s === 'error') return '✗ 错误'
  return '✓ 完成'
}
</script>

<template>
  <DevNav />
  <div class="layout">
    <!-- 左侧:低代码页面预览(组件可点击聚焦) -->
    <aside class="pane pane-left">
      <h2>🧩 低代码页面(点组件聚焦 · agent 可改)</h2>
      <div class="preview" :style="{ background: THEMES[page.theme].bg }">
        <div
          class="preview__tag" :class="{ selected: picked?.path === 'theme' }"
          :style="{ background: THEMES[page.theme].accent }"
          data-path="theme" title="点击聚焦"
          @click="pick('theme', '主题')"
        >{{ page.theme }}<button v-if="picked?.path === 'theme'" class="pick-btn" @click.stop="addFocusFromPick">💬 加入聊天</button></div>
        <h1
          class="preview__title" :class="{ selected: picked?.path === 'title' }"
          :style="{ color: THEMES[page.theme].accent }"
          data-path="title" title="点击聚焦"
          @click="pick('title', '标题')"
        >{{ page.title }}<button v-if="picked?.path === 'title'" class="pick-btn" @click.stop="addFocusFromPick">💬 加入聊天</button></h1>
        <div class="cards">
          <div
            v-for="(c, i) in page.cards" :key="i" class="card"
            :class="{ selected: picked?.path === `cards.${i}` }"
            :style="{ borderColor: THEMES[page.theme].soft, background: THEMES[page.theme].soft }"
            :data-path="`cards.${i}`" title="点击聚焦"
            @click="pick(`cards.${i}`, `卡片${i + 1}`)"
          >
            <button v-if="picked?.path === `cards.${i}`" class="pick-btn" @click.stop="addFocusFromPick">💬 加入聊天</button>
            <h3 :style="{ color: THEMES[page.theme].accent }">{{ c.title }}</h3>
            <p>{{ c.desc }}</p>
          </div>
          <div v-if="!page.cards.length" class="cards-empty">无卡片(让 AI 加几张)</div>
        </div>
      </div>
      <p class="hint">
        <b>聚焦</b>:点组件选中(虚线边界)→「💬 加入聊天」→ 右侧对话框出现 🎯 chip →
        agent 只改该组件子树(越界 <code>PATH_DENIED</code> 自纠)。🎯 点 chip 回看组件,✕ 移除焦点。
      </p>
      <p class="try">
        💡 试试:聚焦某卡片 →「把这张卡片的标题改成 XX」(只改这张)<br />
        或不聚焦 →「所有卡片标题加 emoji」(改全部)
      </p>
    </aside>

    <!-- 右侧:完全自建的深色对话框 -->
    <section class="pane pane-right">
      <div class="my-dialog">
        <header class="my-dialog__header">
          <span class="dot" />
          <div class="my-dialog__title">🦊 Night Fox · headless 自建</div>
          <div class="my-dialog__actions">
            <button class="hdr-btn" title="新建会话" :disabled="sending" @click="newSession">➕</button>
            <button class="hdr-btn" :class="{ active: showHistory }" title="历史会话" @click="showHistory = !showHistory">🗂</button>
            <button class="hdr-btn" :class="{ active: debugVisible }" title="调试" @click="debugVisible = !debugVisible">🛠</button>
            <button v-if="sending" class="my-dialog__stop" @click="stop">⏹ 停止</button>
          </div>
        </header>

        <!-- ⑥ 历史会话面板(🗂 触发;列 sdk.sessions,高亮当前,点切换,非当前可删) -->
        <div v-if="showHistory" class="history-panel">
          <div class="history-panel__head">
            <span>历史会话({{ sessions.length }})</span>
            <button class="history-panel__close" @click="showHistory = false">✕</button>
          </div>
          <div v-if="!sessions.length" class="history-empty">暂无历史会话(发条消息后 ➕ 新建即可积累)</div>
          <ul v-else class="history-list">
            <li
              v-for="s in sessions" :key="s.sessionId"
              class="history-item" :class="{ current: s.sessionId === currentSid }"
              @click="openSession(s.sessionId)"
            >
              <span class="history-item__title">{{ sessionLabel(s) }}</span>
              <span class="history-item__meta">{{ formatTime(s.lastAccessed) }}</span>
              <button
                v-if="s.sessionId !== currentSid" class="history-item__del" title="删除"
                @click.stop="removeSession(s.sessionId)"
              >🗑</button>
              <span v-else class="history-item__cur">当前</span>
            </li>
          </ul>
        </div>

        <div ref="logEl" class="my-dialog__body">
          <div v-for="(m, i) in messages" :key="i" class="msg" :class="`msg--${m.role}`">
            <span class="msg__role">{{ roleLabel(m) }}</span>
            <div class="msg__main">
              <!-- user message 焦点历史标注:该消息在聚焦此组件时发出(纯追溯标签,点 chip 回看组件;移除走底部当前焦点栏) -->
              <div v-if="m.role === 'user' && m.focuses?.length" class="msg-focuses">
                <span
                  v-for="(f, k) in m.focuses" :key="k" class="msg-focus-chip"
                  title="该消息在聚焦此组件时发出 · 点击回看"
                  @click="scrollToComponent(f.path)"
                >🎯 {{ f.label ? f.label + ' · ' : '' }}{{ f.path }}</span>
              </div>
              <details v-if="m.reasoning" class="reasoning" open>
                <summary>💭 思考过程</summary>
                <div class="reasoning__body">{{ m.reasoning }}<span v-if="isStreaming(i) && !m.content" class="cursor">▋</span></div>
              </details>
              <details v-if="m.steps && m.steps.length" class="steps" open>
                <summary>🔧 工具调用({{ m.steps.length }})</summary>
                <div v-for="(s, j) in m.steps" :key="j" class="step" :class="`step--${s.status}`">
                  <div class="step__head">
                    <span class="step__name">{{ s.name }}</span>
                    <span class="step__status">{{ statusLabel(s.status) }}</span>
                  </div>
                  <pre v-if="s.args && Object.keys(s.args).length" class="step__args">args: {{ JSON.stringify(s.args) }}</pre>
                  <pre v-if="s.result" class="step__result">→ {{ s.result }}</pre>
                </div>
              </details>
              <span v-if="m.content || isStreaming(i)" class="msg__content">{{ m.content }}<span v-if="isStreaming(i)" class="cursor">▋</span></span>
            </div>
          </div>

          <div v-if="!messages.length" class="empty">说点什么吧…(左侧点组件聚焦,或「标题改成新品首发」)</div>
        </div>

        <!-- 聚焦 chip(自建;🎯 点本体回看组件,✕ 移除焦点) -->
        <div v-if="focuses.length" class="focus-bar">
          <span v-for="f in focuses" :key="f.path" class="focus-chip" :title="`回看 ${f.path}`" @click="scrollToComponent(f.path)">
            🎯 {{ f.label ? f.label + ' · ' : '' }}{{ f.path }}<button class="focus-chip__x" @click.stop="removeFocus(f.path)">✕</button>
          </span>
        </div>

        <footer class="my-dialog__footer">
          <textarea
            v-model="input"
            :disabled="sending"
            placeholder="输入消息,Enter 发送 / Shift+Enter 换行…"
            rows="2"
            @keydown.enter.exact.prevent="send"
          />
          <button class="my-dialog__send" :disabled="sending || !input.trim()" @click="send">
            {{ sending ? '生成中…' : '发送' }}
          </button>
        </footer>

        <!-- ⑦ 调试抽屉(复用内置 DebugDrawer:7 类日志/Agent信息/上下文构成;纯 props 驱动,headless 直接传 sdk 数据) -->
        <DebugDrawer
          v-model:visible="debugVisible"
          :logs="debugLogs"
          :get-info="getInspect"
          :info-tick="sdk?.infoTick"
          :get-skill-content="getSkillContent"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.layout { display: flex; width: 100vw; height: 100vh; overflow: hidden; }
.pane-left { flex: 1; overflow: auto; background: var(--ark-bg); padding: 24px 28px; color: var(--ark-fg); }
.pane-right { flex: 0 0 480px; display: flex; padding: 24px; background: var(--ark-bg); border-left: 1px solid rgba(255, 255, 255, 0.06); }

h2 { font-size: 18px; margin: 0 0 14px; color: var(--ark-fg); }
.hint { font-size: 13px; line-height: 1.7; color: var(--ark-muted); margin: 14px 0 8px; }
.hint code { background: rgba(var(--ark-accent-rgb), 0.15); color: var(--ark-fg); padding: 1px 6px; border-radius: 4px; font-size: 12px; }
.try { font-size: 13px; color: #7c3aed; background: #f3e8ff; padding: 10px 14px; border-radius: 8px; margin-top: 10px; line-height: 1.7; }

/* 低代码页面预览 */
.preview { border-radius: 14px; padding: 24px; border: 1px solid rgba(255, 255, 255, 0.06); transition: background 0.3s; }
.preview__tag { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; color: #fff; margin-bottom: 12px; position: relative; }
.preview__title { font-size: 24px; margin: 0 0 18px; transition: color 0.3s; position: relative; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
.card { border: 1px solid; border-radius: 10px; padding: 14px; position: relative; }
.card h3 { font-size: 14px; margin: 0 0 6px; }
.card p { font-size: 12px; line-height: 1.6; color: #d1d5db; margin: 0; }
.cards-empty { grid-column: 1 / -1; color: #6b7280; text-align: center; padding: 20px; font-size: 13px; }

/* ⑤ 聚焦:预览元素可点 + 选中边界 + 拾取按钮 */
.preview__tag, .preview__title, .card { cursor: pointer; transition: outline 0.15s, box-shadow 0.15s; }
.preview__tag:hover, .preview__title:hover, .card:hover { outline: 1px dashed rgba(167, 139, 250, 0.5); outline-offset: 2px; }
.selected { outline: 2px dashed #a78bfa !important; outline-offset: 4px; }
.pick-btn {
  position: absolute; top: -11px; right: 8px; padding: 3px 9px; font-size: 11px;
  background: #a78bfa; color: #fff; border: none; border-radius: 5px; cursor: pointer; z-index: 2; white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}
.pick-btn:hover { background: #8b5cf6; }
/* chip 点击回看时的临时高亮 */
.flash { animation: flash 1.2s ease-out; }
@keyframes flash {
  0% { box-shadow: 0 0 0 0 rgba(167, 139, 250, 0.8); }
  100% { box-shadow: 0 0 0 12px rgba(167, 139, 250, 0); }
}

/* 完全自建的深色对话框 */
.my-dialog {
  width: 100%; display: flex; flex-direction: column; position: relative;
  background: #0f0f1a; border: 1px solid #2a2a3a; border-radius: 16px; overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
.my-dialog__header {
  display: flex; align-items: center; gap: 10px; padding: 14px 16px;
  background: #1a1a2a; border-bottom: 1px solid #2a2a3a;
}
.dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 8px #22c55e; flex-shrink: 0; }
.my-dialog__title { flex: 1; color: #e5e7eb; font-weight: 600; font-size: 14px; }
.my-dialog__stop {
  padding: 4px 12px; background: rgba(239, 68, 68, 0.15); color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 6px; font-size: 12px; cursor: pointer;
}
.my-dialog__stop:hover { background: rgba(239, 68, 68, 0.25); }

/* ⑥ header 动作按钮(新建/历史) */
.my-dialog__actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.hdr-btn {
  padding: 4px 8px; background: rgba(255, 255, 255, 0.06); color: #c4b5fd;
  border: 1px solid #2a2a3a; border-radius: 6px; font-size: 13px; cursor: pointer; line-height: 1;
}
.hdr-btn:hover:not(:disabled) { background: rgba(167, 139, 250, 0.2); }
.hdr-btn.active { background: rgba(167, 139, 250, 0.28); border-color: rgba(167, 139, 250, 0.5); }
.hdr-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* ⑥ 历史会话面板(浮层,header 下方) */
.history-panel {
  position: absolute; top: 49px; left: 12px; right: 12px; max-height: 60%; z-index: 5;
  display: flex; flex-direction: column; overflow: hidden;
  background: #15151f; border: 1px solid #2a2a3a; border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}
.history-panel__head { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; font-size: 12px; color: #9ca3af; border-bottom: 1px solid #2a2a3a; }
.history-panel__close { background: transparent; border: none; color: #6b7280; cursor: pointer; font-size: 13px; }
.history-panel__close:hover { color: #fff; }
.history-empty { padding: 20px; text-align: center; color: #6b7280; font-size: 13px; }
.history-list { list-style: none; margin: 0; padding: 4px; overflow-y: auto; }
.history-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 6px; cursor: pointer; }
.history-item:hover { background: rgba(255, 255, 255, 0.05); }
.history-item.current { background: rgba(167, 139, 250, 0.15); }
.history-item__title { flex: 1; font-size: 13px; color: #e5e7eb; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-item__meta { font-size: 11px; color: #6b7280; font-family: ui-monospace, monospace; }
.history-item__del { background: transparent; border: none; color: #6b7280; cursor: pointer; font-size: 12px; padding: 2px; border-radius: 4px; }
.history-item__del:hover { color: #ef4444; background: rgba(239, 68, 68, 0.12); }
.history-item__cur { font-size: 10px; color: #a78bfa; border: 1px solid rgba(167, 139, 250, 0.4); border-radius: 4px; padding: 1px 5px; }

.my-dialog__body { flex: 1; overflow-y: auto; padding: 16px; }
.msg { margin-bottom: 14px; line-height: 1.6; display: flex; gap: 8px; }
.msg__role { min-width: 28px; font-weight: 700; font-size: 12px; padding-top: 3px; flex-shrink: 0; }
.msg--user .msg__role { color: #a78bfa; }
.msg--assistant .msg__role { color: #22c55e; }
.msg__main { flex: 1; min-width: 0; }
.msg__content { display: block; white-space: pre-wrap; word-break: break-word; color: #e5e7eb; font-size: 14px; }
/* user message 焦点历史标注(追溯该消息发出时的聚焦对象;点 chip 回看组件) */
.msg-focuses { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 5px; }
.msg-focus-chip {
  display: inline-flex; align-items: center; padding: 1px 8px; border-radius: 10px;
  background: rgba(167, 139, 250, 0.15); color: #c4b5fd; border: 1px solid rgba(167, 139, 250, 0.3);
  font-size: 11px; line-height: 1.7; cursor: pointer; white-space: nowrap; font-family: ui-monospace, monospace;
}
.msg-focus-chip:hover { background: rgba(167, 139, 250, 0.28); }

.reasoning { margin-bottom: 8px; background: #1a1525; border: 1px solid #3a2a5a; border-radius: 8px; padding: 6px 10px; }
.reasoning summary { cursor: pointer; font-size: 12px; color: #c4b5fd; font-weight: 600; list-style: none; }
.reasoning summary::before { content: '▸ '; }
.reasoning[open] summary::before { content: '▾ '; }
.reasoning__body { margin-top: 6px; font-size: 12px; color: #9ca3af; white-space: pre-wrap; word-break: break-word; line-height: 1.6; border-left: 2px solid #3a2a5a; padding-left: 8px; }

.steps { margin-bottom: 8px; background: #1a1a2a; border: 1px solid #2a2a3a; border-radius: 8px; padding: 6px 10px; }
.steps summary { cursor: pointer; font-size: 12px; color: #a78bfa; font-weight: 600; list-style: none; }
.steps summary::before { content: '▸ '; }
.steps[open] summary::before { content: '▾ '; }
.step { padding: 6px 0; border-top: 1px solid rgba(255, 255, 255, 0.05); }
.step:first-of-type { border-top: none; }
.step__head { display: flex; align-items: center; gap: 8px; }
.step__name { font-size: 12px; font-weight: 600; color: #e5e7eb; font-family: ui-monospace, monospace; }
.step__status { font-size: 11px; margin-left: auto; }
.step--running .step__status { color: #fbbf24; }
.step--done .step__status { color: #22c55e; }
.step--error .step__status { color: #ef4444; }
.step__args, .step__result { margin: 4px 0 0; font-size: 11px; line-height: 1.5; color: #9ca3af; font-family: ui-monospace, monospace; white-space: pre-wrap; word-break: break-all; }
.step__result { color: #6b8c79; }
.step--error .step__result { color: #ef4444; }

.cursor { animation: blink 1s step-end infinite; color: #a78bfa; }
@keyframes blink { 50% { opacity: 0; } }

.empty { color: #6b7280; text-align: center; padding: 60px 0; font-size: 14px; }

/* ⑤ 聚焦 chip(自建,不用内置 ChatInput chip) */
.focus-bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px; background: #1a1a2a; border-bottom: 1px solid #2a2a3a; }
.focus-chip {
  display: inline-flex; align-items: center; gap: 4px; padding: 3px 4px 3px 8px; font-size: 11px;
  background: rgba(167, 139, 250, 0.18); color: #c4b5fd; border: 1px solid rgba(167, 139, 250, 0.4);
  border-radius: 999px; cursor: pointer; font-family: ui-monospace, monospace;
}
.focus-chip:hover { background: rgba(167, 139, 250, 0.28); }
.focus-chip__x { padding: 0 5px; background: transparent; color: #c4b5fd; border: none; cursor: pointer; font-size: 11px; line-height: 1; }
.focus-chip__x:hover { color: #fff; }

.my-dialog__footer { display: flex; gap: 8px; padding: 12px; background: #1a1a2a; border-top: 1px solid #2a2a3a; }
.my-dialog__footer textarea {
  flex: 1; background: #0f0f1a; border: 1px solid #2a2a3a; border-radius: 8px; padding: 10px;
  color: #e5e7eb; font-size: 14px; resize: none; outline: none; font-family: inherit; line-height: 1.5;
}
.my-dialog__footer textarea:focus { border-color: #a78bfa; }
.my-dialog__send {
  padding: 0 18px; background: #a78bfa; color: #fff; border: none; border-radius: 8px;
  font-size: 14px; cursor: pointer; font-weight: 600; white-space: nowrap;
}
.my-dialog__send:disabled { background: #3a3a4a; color: #6b7280; cursor: not-allowed; }
</style>
