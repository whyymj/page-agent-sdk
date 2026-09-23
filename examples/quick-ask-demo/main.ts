/**
 * quick-ask-demo —— 选区一次性问答(无历史)+ 记录到宿主。
 *
 * 集成形态:**主对话窗都不挂** —— 纯 headless 实例(ui:false)+ 自建迷你面板:
 *   · 无历史:storage:'memory' + 每问 resetSession(),单轮上下文只有选区引用
 *     (经 send 的 quote 选项注入,与划词引用同语义,不手动拼串)
 *   · 「记录」不经 agent:宿主自己收 —— demo 里 append 到右栏,真实宿主是批注库/CMS
 *   · SDK 懒加载:首次提问才动态 import(页面零首屏成本)
 * 真实案例:Obsidian/learning 学习门户的「✦ 快问」(批注通道 = annotations.createFromSelection)。
 */
import type { ChatSdk } from '../../src/core'

let agent: ChatSdk | null = null
let loading: Promise<ChatSdk> | null = null

async function ensureAgent(): Promise<ChatSdk> {
  if (agent) return agent
  if (!loading) {
    loading = import('../../src/core').then(({ createChatSdk, systemPromptHelpers }) => {
      const instance = createChatSdk({
        id: 'quick-ask-demo',
        ui: false, // headless:面板是本文件自己的迷你 UI(不挂 SDK 对话框)
        storage: 'memory', // 不落盘:快问刷新即散
        llm: {
          apiKey: import.meta.env.VITE_AI_API_KEY,
          baseUrl: import.meta.env.VITE_AI_BASE_URL,
          model: import.meta.env.VITE_AI_MODEL,
          temperature: 0.3,
        },
        // 单次问答身份:作答车道同源(SDK 维护)+ 成篇要求(记录会被单独阅读)
        systemPrompt: [
          '你是快问助手:用户选中了页面上的一段文字,你针对它做一次性问答 —— 没有对话历史,不要反问,一轮给出完整回答。',
          systemPromptHelpers.answerLanes,
          '',
          '【成篇要求】回答必须能独立成篇 —— 它可能被保存为记录、脱离选中文字被单独阅读:关键结论说完整、指代明确,宁短勿长。',
        ].join('\n'),
        capabilities: { dataOps: false, domInspect: true, pageContext: true, vfs: false, planning: false, subagent: false, fetch: false },
      })
      agent = instance
      return instance.mount().then(() => instance)
    }).catch((error) => { loading = null; throw error })
  }
  return loading
}

/* ===== 划词浮钮 + 迷你面板(vanilla DOM) ===== */

const article = document.querySelector('#article') as HTMLElement
const noteList = document.querySelector('#note-list') as HTMLUListElement

const trigger = document.createElement('button')
trigger.type = 'button'
trigger.className = 'qa-trigger'
trigger.textContent = '✦ 快问'
trigger.hidden = true
document.body.append(trigger)

const panel = document.createElement('div')
panel.className = 'qa-panel'
panel.setAttribute('aria-label', '快问(单次)')
panel.hidden = true
panel.innerHTML = `
  <strong>✦ 快问(单次,不留对话)</strong>
  <p class="qa-quote"></p>
  <textarea placeholder="针对选中内容问一句…"></textarea>
  <p class="qa-status" hidden></p>
  <details class="qa-trace" hidden>
    <summary class="qa-trace-label">过程</summary>
    <div class="qa-reason" hidden></div>
    <div class="qa-tools"></div>
  </details>
  <div class="qa-answer" hidden></div>
  <div class="qa-bar">
    <button type="button" class="qa-record accent" hidden>记录</button>
    <button type="button" class="qa-ask">问</button>
    <button type="button" class="qa-close">✕</button>
  </div>
`
document.body.append(panel)
const quoteView = panel.querySelector('.qa-quote') as HTMLElement
const input = panel.querySelector('textarea') as HTMLTextAreaElement
const status = panel.querySelector('.qa-status') as HTMLElement
const answer = panel.querySelector('.qa-answer') as HTMLElement
const askBtn = panel.querySelector('.qa-ask') as HTMLButtonElement
const recordBtn = panel.querySelector('.qa-record') as HTMLButtonElement
const trace = panel.querySelector('.qa-trace') as HTMLDetailsElement
const traceLabel = panel.querySelector('.qa-trace-label') as HTMLElement
const reasonEl = panel.querySelector('.qa-reason') as HTMLElement
const toolsEl = panel.querySelector('.qa-tools') as HTMLElement

const state = { quote: '', reply: '', busy: false }

/** md 子集渲染(粗体/斜体/行内码/标题/无序列表/有序列表;先整体转义,无原始 HTML 透传)。
 *  回答是 LLM 输出,按样式展示而非保留 **、`、# 等符号 */
function renderMarkdown(src: string): string {
  const esc = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (t: string): string => t
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
  const out: string[] = []
  let inList = false
  const closeList = (): void => { if (inList) { out.push('</ul>'); inList = false } }
  for (const raw of esc.split('\n')) {
    const line = raw.trimEnd()
    const li = /^\s*[-*]\s+(.*)$/.exec(line)
    const ol = /^\s*\d+[.、)]\s+(.*)$/.exec(line)
    if (li ?? ol) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${inline((li ?? ol)![1])}</li>`)
      continue
    }
    closeList()
    const h = /^(#{1,4})\s+(.*)$/.exec(line)
    if (h) { out.push(`<h5>${inline(h[2])}</h5>`); continue }
    if (!line.trim()) { out.push(''); continue }
    out.push(`<p>${inline(line)}</p>`)
  }
  closeList()
  return out.join('\n')
}

function place(el: HTMLElement, left: number, top: number): void {
  el.hidden = false
  el.style.left = `${Math.max(8, left)}px`
  el.style.top = `${top + 8}px`
  const overflow = el.getBoundingClientRect().right - (window.innerWidth - 8)
  if (overflow > 0) el.style.left = `${Math.max(8, left - overflow)}px`
}

// 划词 → 浮钮(选中在 article 内才出现;mousedown 吞默认防塌缩)
document.addEventListener('selectionchange', () => {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) { trigger.hidden = true; return }
  const anchor = sel.getRangeAt(0).commonAncestorContainer
  const el = anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement
  if (!el || !article.contains(el)) { trigger.hidden = true; return }
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  place(trigger, rect.left + window.scrollX, rect.bottom + window.scrollY)
})
trigger.addEventListener('mousedown', (e) => e.preventDefault())
trigger.addEventListener('click', () => {
  const sel = window.getSelection()
  const quote = sel?.toString() ?? ''
  if (!quote.trim() || !sel || sel.rangeCount === 0) return
  const rect = sel.getRangeAt(0).getBoundingClientRect()
  state.quote = quote
  state.reply = ''
  quoteView.textContent = quote.length > 160 ? `${quote.slice(0, 160)}…` : quote
  input.value = ''
  status.hidden = true
  answer.hidden = true
  recordBtn.hidden = true
  trigger.hidden = true
  place(panel, rect.left + window.scrollX, rect.bottom + window.scrollY)
  input.focus()
})

async function ask(): Promise<void> {
  const question = input.value.trim()
  if (!question || state.busy) return
  state.busy = true
  askBtn.disabled = true
  answer.hidden = true
  recordBtn.hidden = true
  status.textContent = '思考中…'
  status.hidden = false
  // 过程区重置 + 事件渲染(思考尾窗 + 工具行;running 期自动展开,完成保留可折叠回看)
  trace.hidden = true
  trace.open = false // 默认折叠(2026-09-21 用户反馈):摘要行实时计数,想看过程再点开
  reasonEl.hidden = true
  reasonEl.textContent = ''
  toolsEl.replaceChildren()
  let reasonChars = 0
  let reasonTail = ''
  const syncLabel = (): void => { traceLabel.textContent = `过程(思考 ${reasonChars} 字 · ${toolsEl.children.length} 个工具)` }
  const onEvent = (e: { type: string; delta?: string; name?: string; args?: unknown; id?: string; status?: string; durationMs?: number }): void => {
    if (e.type === 'reasoning') {
      reasonChars += (e.delta ?? '').length
      reasonTail = (reasonTail + (e.delta ?? '')).slice(-300)
      reasonEl.textContent = `…${reasonTail}`
      reasonEl.hidden = false
      trace.hidden = false
      syncLabel()
    } else if (e.type === 'tool_call') {
      const line = document.createElement('div')
      line.className = 'qa-tool running'
      let brief = ''
      try { const raw = JSON.stringify(e.args ?? {}); brief = raw.length > 60 ? `${raw.slice(0, 60)}…` : raw } catch { /* args 非可序列化时省略 */ }
      line.textContent = `🔧 ${e.name} ${brief}`
      if (e.id) line.dataset.callId = e.id
      toolsEl.append(line)
      trace.hidden = false
      syncLabel()
    } else if (e.type === 'tool_result') {
      const line = [...toolsEl.children].reverse().find((el): boolean =>
          (e.id && (el as HTMLElement).dataset.callId === e.id) || (el.classList.contains('running') && el.textContent?.includes(`🔧 ${e.name ?? ''}`))) as HTMLElement | undefined
      if (line) {
        line.classList.remove('running')
        line.classList.add(e.status === 'error' ? 'error' : 'done')
        line.textContent = `${line.textContent} · ${e.status === 'error' ? '失败' : `${e.durationMs ?? 0}ms`}`
      }
    }
  }
  try {
    const sdk = await ensureAgent()
    sdk.resetSession() // 无历史:每问清空,单轮上下文只有选区引用
    // quote 以消息侧字段携带(stream 无 SendOptions,toLC 组装时前缀注入引用块 —— 与 send 同形态)
    state.reply = await sdk.stream(
      [{ role: 'user', content: question, timestamp: Date.now(), quote: { text: state.quote, source: '选中内容' } }],
      (ev) => onEvent(ev as Parameters<typeof onEvent>[0]),
    )
    status.hidden = true
    answer.innerHTML = renderMarkdown(state.reply) // md 转样式展示,不保留符号
    answer.hidden = false
    recordBtn.hidden = false
    syncLabel()
  } catch (error) {
    status.textContent = `快问失败:${(error as Error)?.message ?? error}`
  } finally {
    state.busy = false
    askBtn.disabled = false
  }
}

askBtn.addEventListener('click', () => void ask())
input.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void ask() })
panel.querySelector('.qa-close')!.addEventListener('click', () => { panel.hidden = true })
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) panel.hidden = true })

// 记录:不经 agent —— 宿主自己收(demo = append 右栏;真实宿主是批注库)
recordBtn.addEventListener('click', () => {
  if (!state.reply) return
  const li = document.createElement('li')
  const q = document.createElement('span')
  q.className = 'qa-note-quote'
  q.textContent = `「${state.quote.slice(0, 80)}${state.quote.length > 80 ? '…' : ''}」`
  li.append(q, document.createTextNode(state.reply))
  noteList.append(li)
  panel.hidden = true
})
