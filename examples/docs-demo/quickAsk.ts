/**
 * docs-demo 快问入口 —— 选区一次性问答(无历史)+ 记录(与 quick-ask-demo 同模式,Vue 页里挂 vanilla 模块)。
 *
 * 集成要点(与主对话 SDK 并存,互不干扰):
 *   · 独立 headless 实例(ui:false / storage:'memory'),每问 resetSession() —— 单轮上下文只有选区引用
 *   · 选区经 send 的 quote 选项注入(与划词引用同语义)
 *   · 「记录」不经 agent:宿主自己收(本 demo 落到页内记录列表;真实宿主是批注库/CMS)
 *   · SDK 懒加载:首次提问才动态 import
 * 自包含(含样式注入),可整文件抄走当集成模板。
 */
import type { ChatSdk } from '../../src/core'

let agent: ChatSdk | null = null
let loading: Promise<ChatSdk> | null = null

async function ensureAgent(): Promise<ChatSdk> {
  if (agent) return agent
  if (!loading) {
    loading = import('../../src/core').then(({ createChatSdk, systemPromptHelpers }) => {
      const instance = createChatSdk({
        id: 'docs-demo-quick-ask',
        ui: false, // headless:快问不挂 SDK 对话框,面板是本文件的迷你 UI
        storage: 'memory',
        llm: {
          apiKey: import.meta.env.VITE_AI_API_KEY,
          baseUrl: import.meta.env.VITE_AI_BASE_URL,
          model: import.meta.env.VITE_AI_MODEL,
          temperature: 0.3,
        },
        systemPrompt: [
          '你是快问助手:用户选中了页面上的一段文字,你针对它做一次性问答 —— 没有对话历史,不要反问,一轮给出完整回答。',
          systemPromptHelpers.answerLanes,
          '',
          '【上下文】用户消息会附选中内容;要补语境(所在小节/相关定义)可读当前文档正文 —— 命中点在长文深处时先 load_skill("dom-inspect") 取得 dom_search 按关键词定位、窄读命中那一节,勿整页翻页找。',
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

const STYLES = `
  .qa-trigger { position: absolute; z-index: 40; padding: 5px 12px; border: 1px solid #1f4d3a; border-radius: 999px; background: #1f4d3a; color: #fff; cursor: pointer; font-size: 12px; }
  .qa-panel { position: absolute; z-index: 41; width: min(560px, calc(100vw - 16px)); padding: 14px; display: grid; gap: 8px; background: #fff; border: 1px solid #d6d3cb; border-radius: 8px; box-shadow: 0 10px 34px rgba(0,0,0,.16); font-size: 13px; }
  .qa-panel strong { font-size: 12px; color: #1f4d3a; letter-spacing: .04em; }
  .qa-quote { margin: 0; max-height: 4.6em; overflow-y: auto; padding: 8px 10px; border-left: 3px solid #f97316; background: #fff7ed; color: #57534e; font-size: 13px; line-height: 1.6; border-radius: 2px; }
  .qa-panel textarea { width: 100%; min-height: 5.5em; resize: vertical; padding: 8px 10px; border: 1px solid #d6d3cb; border-radius: 4px; font-size: 13px; line-height: 1.6; }
  .qa-status { margin: 0; font-size: 12px; color: #0891b2; }
  .qa-trace { border: 1px solid #e5e7eb; border-radius: 6px; padding: 6px 10px; background: #fbfbfa; }
  .qa-trace summary { cursor: pointer; font-size: 12px; color: #6b7280; user-select: none; }
  .qa-reason { max-height: 96px; overflow-y: auto; margin: 6px 0; padding: 6px 8px; background: #f4f4f2; border-radius: 4px; font-size: 11.5px; line-height: 1.55; color: #8b8b7e; white-space: pre-wrap; }
  .qa-tools { display: grid; gap: 3px; }
  .qa-tool { font: 11.5px/1.5 ui-monospace, SFMono-Regular, monospace; color: #57534e; word-break: break-all; }
  .qa-tool.running::after { content: ' …'; animation: qa-blink 1s ease-in-out infinite; }
  .qa-tool.done { color: #047857; }
  .qa-tool.error { color: #b91c1c; }
  @keyframes qa-blink { 50% { opacity: .35; } }
  .qa-answer { max-height: 44vh; overflow-y: auto; font-size: 12.5px; line-height: 1.7; padding: 8px 10px; background: #f0f7f3; border-radius: 4px; }
  .qa-answer p { margin: 0 0 6px; } .qa-answer p:last-child { margin-bottom: 0; }
  .qa-answer ul { margin: 4px 0; padding-left: 18px; }
  .qa-answer li { margin: 2px 0; }
  .qa-answer h5 { margin: 8px 0 4px; font-size: 12.5px; color: #1f4d3a; }
  .qa-answer code { padding: 1px 5px; border-radius: 3px; background: #e8efe9; font: 11.5px ui-monospace, SFMono-Regular, monospace; color: #9d3514; }
  .qa-answer strong { color: #1f4d3a; }
  .qa-bar { display: flex; justify-content: flex-end; gap: 8px; }
  .qa-bar button { padding: 6px 14px; border: 1px solid #d6d3cb; border-radius: 5px; background: #fff; cursor: pointer; font-size: 13px; }
  .qa-bar button.accent { border-color: #1f4d3a; color: #1f4d3a; }
  .qa-notes { position: fixed; z-index: 39; right: 16px; bottom: 16px; width: min(340px, calc(100vw - 32px)); max-height: 40vh; overflow-y: auto; background: #fff; border: 1px solid #d6d3cb; border-radius: 8px; padding: 12px 14px; box-shadow: 0 8px 28px rgba(0,0,0,.12); }
  .qa-notes h3 { margin: 0 0 8px; font-size: 13px; color: #6b7280; }
  .qa-notes ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .qa-notes li { font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; padding: 8px 10px; background: #f0f7f3; border-left: 3px solid #1f4d3a; border-radius: 3px; }
  .qa-notes li .qa-note-quote { display: block; margin-bottom: 4px; color: #9ca3af; font-size: 11.5px; max-height: 3em; overflow: hidden; }
  [hidden] { display: none !important; }
`

export function initQuickAsk(): void {
  const style = document.createElement('style')
  style.textContent = STYLES
  document.head.append(style)

  const article = document.querySelector('.docs-article') as HTMLElement | null
  if (!article) return

  // 记录列表(「记录」落这里;真实宿主换成批注库/CMS 写入)
  const notes = document.createElement('aside')
  notes.className = 'qa-notes'
  notes.hidden = true
  notes.innerHTML = '<h3>✦ 快问记录</h3><ul></ul>'
  document.body.append(notes)
  const noteList = notes.querySelector('ul') as HTMLUListElement

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

  /** md 子集渲染(粗体/斜体/行内码/标题/列表;先整体转义,无原始 HTML 透传)—— 回答按样式展示不留符号 */
  const renderMarkdown = (src: string): string => {
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

  const place = (el: HTMLElement, left: number, top: number): void => {
    el.hidden = false
    el.style.left = `${Math.max(8, left)}px`
    el.style.top = `${top + 8}px`
    const overflow = el.getBoundingClientRect().right - (window.innerWidth - 8)
    if (overflow > 0) el.style.left = `${Math.max(8, left - overflow)}px`
  }

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

  const ask = async (): Promise<void> => {
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
    trace.open = false // 默认折叠:摘要行实时计数,想看过程再点开
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
      sdk.resetSession() // 无历史:每问清空
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

  recordBtn.addEventListener('click', () => {
    if (!state.reply) return
    const li = document.createElement('li')
    const q = document.createElement('span')
    q.className = 'qa-note-quote'
    q.textContent = `「${state.quote.slice(0, 80)}${state.quote.length > 80 ? '…' : ''}」`
    li.append(q, document.createTextNode(state.reply))
    noteList.append(li)
    notes.hidden = false
    panel.hidden = true
  })
}
