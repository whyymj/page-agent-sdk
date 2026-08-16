/**
 * Preferences 中间件 —— 跨会话用户偏好记忆(preference-persistence)
 *
 * 三层信号捕获(**宁漏勿误**):学错一条假偏好,之后每个会话都带着它跑,比漏学伤得多。
 *  - 强信号:显式命令(「记住:…」「以后别…」)→ 正则直接提取,**零 LLM**
 *  - 中信号:模式词初筛命中(不要/别/太艳/不喜欢/希望…)→ 异步小 LLM 提炼一次;
 *    核心判定 = **持久口味 vs 本轮任务指令**(「把这个改成红色」不是偏好)
 *  - 弱信号:agent 行为推断(连续 N 次改掉渐变)→ **不捕获**(推断链长,学错成本 > 收益)
 *
 * 触发点 afterAgent(收口后 fire-and-forget,不阻塞返回;失败静默留痕);
 * 注入 augmentPrompt「## 用户偏好」pin 段(天然跨压缩,同 mission —— 每轮重建进 system,
 * 不在 AgentMessage[] 里,compressInput 压不到)。
 *
 * 异步 store → 同步注入:中间件持内存 cache(真相源 = preferenceStore),preload()(mount 时
 * await store.ready 后调)填充;之后 put/remove 写穿透同步 cache —— augmentPrompt 读 cache 零 await。
 * 偏好跨会话生效,不参与 resetSession/switchSession 重置(与 mission/workingMemory 的会话级语义相反)。
 */
import type { Middleware } from './middleware'
import type { PersistedPreference, PreferenceStore, PreferenceTopic } from '../backends/preferenceStore'
import { PREFERENCE_TOPICS } from '../backends/preferenceStore'

/** topic 枚举的注入段中文标签(仅展示用;存储恒为枚举值) */
const TOPIC_LABELS: Record<PreferenceTopic, string> = {
  color: '颜色',
  copy: '文案',
  layout: '排版',
  interaction: '交互',
  tech: '技术',
  other: '其他',
}

/** 强信号:显式命令句式(命中即零 LLM 直接提取;capture 组 = 偏好正文) */
const EXPLICIT_PATTERNS: RegExp[] = [
  /^(?:请|帮我|麻烦)?你?记住[:：,，、]?\s*(.{4,200})/,   // 「记住:以后文案都要短」「请记住别用紫色」
  /^(?:从)?今后(?:开始|起)?[:：,，]?\s*(.{4,200})/,       // 「今后别用紫色」「从今后开始保持简洁」
  /^以后(?:都|全都|总是|尽量)?[:：,，]?\s*(.{4,200})/,     // 「以后文案要短」
]
/** 中信号:模式词初筛(松;是否真是偏好由 LLM 严判 —— 「不要这个组件」类本轮指令靠 LLM 滤掉) */
const SIGNAL_PATTERN = /(?:不要|别再|别用|别加|太(?:艳|花|亮|暗|大|小|密|挤|乱|复杂|素|少)|不喜欢|讨厌|希望|更喜欢|偏好|永远|一律|统一保持|保持统一)/

/** topic 关键词映射(强信号用;顺序即优先级 —— 归类一致性比精确性重要,topic 只是合并键) */
const TOPIC_KEYWORDS: [PreferenceTopic, RegExp][] = [
  ['layout', /布局|排版|间距|留白|密度|居中|对齐|栅格|边距|紧凑|圆角|分栏|层级|大小|尺寸/],
  ['copy', /文案|文字|标题|副标题|字体|字号|措辞|语气|口语|书面|简洁|简短|详尽|emoji|表情/],
  ['interaction', /动画|动效|过渡|交互|悬停|hover|点击反馈|弹窗|提示|加载|滚动/],
  ['tech', /代码|框架|组件|技术|写法|命名|注释|依赖|版本|接口/],
  ['color', /颜色|配色|色调|色彩|深色|浅色|饱和|渐变|紫|红|橙|黄|绿|青|蓝|粉|棕|灰|黑|白|金|银/],
]

/** 从文本粗判 topic(强信号零 LLM 路径;按关键词优先级映射,无命中 → other) */
export function inferPreferenceTopic(text: string): PreferenceTopic {
  for (const [topic, re] of TOPIC_KEYWORDS) if (re.test(text)) return topic
  return 'other'
}

/** 强信号提取:显式命令句式命中 → {content, topic};未命中 → undefined(纯函数,零 LLM) */
export function extractExplicitPreference(text: string): { content: string; topic: PreferenceTopic } | undefined {
  const t = text.trim()
  if (!t || t.length > 500) return undefined // 超长疑似粘贴,不当命令
  for (const re of EXPLICIT_PATTERNS) {
    const m = t.match(re)
    if (m?.[1]) {
      const content = m[1].trim().replace(/[。.!！]+$/, '')
      if (content.length < 3) return undefined // 提取物太短,弃(宁漏)
      return { content, topic: inferPreferenceTopic(content) }
    }
  }
  return undefined
}

/** 中信号初筛:模式词命中(松筛;真伪由 LLM 提炼判定)。太短/问候/超长直接不过 */
export function looksLikePreferenceSignal(text: string): boolean {
  const t = text.trim()
  if (t.length < 4 || t.length > 500) return false
  if (/^(你好|hi|hello|ok|好的|继续|嗯|谢谢|hey|哈喽|收到|明白)/i.test(t)) return false
  return SIGNAL_PATTERN.test(t)
}

/** 提炼 prompt(中信号;输出 JSON,判定核心 = 持久口味 vs 本轮任务指令) */
export function buildExtractPrompt(text: string): string {
  return [
    '你是用户偏好提取器。判断下面的用户消息是否包含「持久偏好」—— 对未来同类工作都适用的口味/规则(如配色口味、文案风格、排版密度),而非仅针对本轮的任务指令。',
    '只输出 JSON(无任何其他文本):{"captured": true, "content": "一句话中性陈述(用户视角,如:不用紫色,偏好低饱和)", "topic": "color|copy|layout|interaction|tech|other"} 或 {"captured": false, "content": "", "topic": "other"}',
    '判定:用户明确表达喜欢/不喜欢/以后要/不要某类风格 → captured:true;仅本轮的任务要求(如「把这个改成红色」「删掉这个组件」)→ captured:false。宁漏勿误:拿不准一律 false。',
    'content 用用户原语言表述。',
    `用户消息:"""${text.slice(0, 800)}"""`,
  ].join('\n')
}

/** 解析提炼 LLM 输出(容错:剥 ```json 围栏/截取首个 {} 段);非法或 captured:false → undefined */
export function parsePreferenceJson(raw: string): { content: string; topic: PreferenceTopic } | undefined {
  if (!raw) return undefined
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced?.[1] ?? raw).match(/\{[\s\S]*\}/)?.[0]
  if (!body) return undefined
  try {
    const parsed = JSON.parse(body) as { captured?: unknown; content?: unknown; topic?: unknown }
    if (parsed.captured !== true) return undefined // 宁漏:captured 非 true / 解析失败一律不记
    const content = typeof parsed.content === 'string' ? parsed.content.trim().replace(/[。.!！]+$/, '') : ''
    if (content.length < 3 || content.length > 200) return undefined
    const topic = (PREFERENCE_TOPICS as readonly string[]).includes(parsed.topic as string)
      ? (parsed.topic as PreferenceTopic)
      : 'other'
    return { content, topic }
  } catch {
    return undefined
  }
}

/** 注入 pin 段(cache 快照 → markdown;空 → undefined) */
export function buildPreferencePrompt(prefs: PersistedPreference[]): string | undefined {
  if (!prefs.length) return undefined
  const lines = ['## 用户偏好(跨会话沉淀;除非用户本轮另有指示,遵守以下偏好)']
  for (const p of prefs) lines.push(`- ${TOPIC_LABELS[p.topic]}:${p.content}`)
  return lines.join('\n')
}

export interface PreferencesMiddlewareOptions {
  store: PreferenceStore
  /** 小 LLM 通道(如 summaryLlmInvoke);缺省 → 只强信号生效(降级) */
  llmInvoke?: (prompt: string) => Promise<string>
  /** 当前会话 id getter(记入条目溯源;switchSession 后取新值) */
  getSessionId: () => string
  /** debug 留痕回调(装配时接 debugLogs;失败/降级可观察) */
  onDebug?: (data: Record<string, unknown>) => void
}

export function createPreferencesMiddleware(opts: PreferencesMiddlewareOptions): Middleware & {
  /** mount 时预载(await store.ready 后拉 list 填 cache;之后 augmentPrompt 读 cache 零 await) */
  preload: () => Promise<void>
  /** 内存 cache 快照(updatedAt 新在前) */
  getPreferences: () => PersistedPreference[]
  /** 删单条(by id;写穿透 cache) */
  removePreference: (id: string) => Promise<boolean>
  /** 清空(写穿透 cache) */
  clearPreferences: () => Promise<void>
  /** 收口扫描水位重置(resetSession 不调 —— 偏好跨会话,但消息水位随会话归零须重扫) */
  resetScanCursor: () => void
} {
  let cache: PersistedPreference[] = []
  /** 已扫到的 messages 水位(每条 user 消息只处理一次;提炼异步在途也不重复触发) */
  let scannedIdx = -1
  /** put 串行链(并发收口的提炼结果按序落库,防 scanAll 竞态) */
  let chain: Promise<unknown> = Promise.resolve()

  const dbg = (data: Record<string, unknown>) => opts.onDebug?.({ stage: 'preferences', ...data })

  /** 写一条偏好(经串行链;store 合并 + cache 写穿透) */
  function putPreference(content: string, topic: PreferenceTopic, round: number, signal: 'explicit' | 'llm'): void {
    chain = chain
      .then(() =>
        opts.store.put({ content, topic, sourceSessionId: opts.getSessionId(), sourceRound: round }),
      )
      .then((saved) => {
        // cache 同步:同 topic 覆盖,新在前
        cache = [saved, ...cache.filter((p) => p.id !== saved.id && p.topic !== saved.topic)]
        dbg({ captured: signal, topic, content })
      })
      .catch((err) => dbg({ error: String(err) })) // 存储失败静默留痕(不冒泡)
  }

  const mw: Middleware & {
    preload: () => Promise<void>
    getPreferences: () => PersistedPreference[]
    removePreference: (id: string) => Promise<boolean>
    clearPreferences: () => Promise<void>
    resetScanCursor: () => void
  } = {
    name: 'preferences',
    augmentPrompt: () => buildPreferencePrompt(cache),
    afterAgent: (state) => {
      const msgs = state.messages ?? []
      // 扫描水位之后的新 user 消息(通常每轮 1 条)
      for (let i = scannedIdx + 1; i < msgs.length; i++) {
        const m = msgs[i]
        if (m.role !== 'user' || typeof m.content !== 'string' || !m.content) continue
        const text = m.content
        // 强信号:零 LLM 直接提取
        const explicit = extractExplicitPreference(text)
        if (explicit) {
          putPreference(explicit.content, explicit.topic, i, 'explicit')
          continue
        }
        // 中信号:初筛 + 小 LLM 提炼(fire-and-forget;失败/判否 → 宁漏不记)
        if (opts.llmInvoke && looksLikePreferenceSignal(text)) {
          const pending = i
          opts
            .llmInvoke(buildExtractPrompt(text))
            .then((raw) => {
              const parsed = parsePreferenceJson(raw)
              if (parsed) putPreference(parsed.content, parsed.topic, pending, 'llm')
            })
            .catch((err) => dbg({ extractError: String(err) })) // 提炼失败静默(不冒泡、不重试)
        }
      }
      scannedIdx = msgs.length - 1 // 水位立即推进(提炼在途不重复触发)
    },
    preload: async () => {
      await opts.store.ready
      cache = await opts.store.list()
    },
    getPreferences: () => [...cache],
    removePreference: async (id) => {
      const ok = await opts.store.remove(id)
      if (ok) cache = cache.filter((p) => p.id !== id)
      return ok
    },
    clearPreferences: async () => {
      await opts.store.clear()
      cache = []
    },
    resetScanCursor: () => {
      scannedIdx = -1
    },
  }
  return mw
}
