/**
 * eval-toolkit(真 LLM 回归判定核,2026-09-04;openspec/2026-09-03-eval-toolkit)
 *
 * 把 SDK 自用的真 LLM 回归方法论抽成**纯函数判定层**公开导出,让集成方(editor_fangzhou 类)
 * 在自己项目里为自己的宿主场景跑升级前回归 —— SDK 测试全绿 ≠ 集成方场景不回归。
 *
 * 三个面(红线:只做判定/等待/对比纯函数 —— 不做断言库/runner/不绑 Playwright/零 LLM 依赖):
 * - `createIdleDetector(opts)`:idle 状态机(纯函数,不碰定时器)—— 判定「agent 真跑完了」。
 *   双条件口径:日志静默超阈值 **且** 无在飞子 agent **且** 有新消息 **且** 至少一条模型响应,
 *   连续 N 次采样满足才判 done(reasoning 阶段不打日志,单看静默会被思考中骗过 —— 真实排查烧出的经验);
 *   日志被清空(会话切换/重置/页面 reload)返回 'reset' 供调用方快速失败。
 * - `createEvalHarness({ sdk })`:waitForIdle(轮询喂 detector)+ collectReport(usage/工具数/消息数快照)。
 * - `diffReport(current, baseline, opts)`:报告 vs 基线阈值判定 —— token ±15% 且 ±2000 / toolCount ±3
 *   才标记(防 LLM 方差误报;elapsedSec 仅展示不判,环境噪声大)。自用 `--baseline-diff` 同一真相源。
 */
import type { Ref } from 'vue'
import type { DebugLog } from '../harness/createAgent'

/** idle 采样(harness 从 sdk 读;自用套件从 page.evaluate 读 —— 同一判定核吃两种采样器) */
export interface EvalSample {
  messageCount: number
  /** 距最近一条 debugLog 的毫秒;日志为空时返回 epoch 级巨值(>1e12 = 被清空信号) */
  quietMs: number
  /** 是否已有至少一条模型响应(debugLogs 含 llm_response) */
  hasResponse: boolean
  /** 在飞子 agent 数(inspect().subagent.active.length;无子能力恒 0) */
  activeSubagents: number
  /** debugLogs 当前长度(诊断用) */
  logCount: number
}

export interface EvalIdleDetectorOptions {
  /** 日志静默阈值 ms(默认 90_000 —— reasoning/长生成期间不打日志,阈值须盖过最长思考窗口) */
  quietMs?: number
  /** 连续几次采样满足全条件才判 done(默认 3;单次采样可能恰逢间隙) */
  confirmSamples?: number
  /** 基线消息数:判定「有新消息」的下界(默认 0 = 只要有消息即算) */
  baselineMessageCount?: number
}

export type IdleVerdict = 'pending' | 'done' | 'reset'

/** idle 状态机(纯函数):逐采样喂入,返回判定;不碰定时器/DOM —— 自用套件与公开 harness 共用同一真相源 */
export function createIdleDetector(opts: EvalIdleDetectorOptions = {}): {
  push: (sample: EvalSample) => IdleVerdict
  reset: () => void
} {
  const quietThreshold = opts.quietMs ?? 90_000
  const need = opts.confirmSamples ?? 3
  const baselineMsgs = opts.baselineMessageCount ?? 0
  let streak = 0
  return {
    push(s) {
      // 日志清空(quietMs 是 epoch 级巨值)= 会话切换/重置/页面 reload —— 采样口径已失效,快速失败信号
      if (s.quietMs > 1e12) { streak = 0; return 'reset' }
      const ok = s.messageCount > baselineMsgs && s.hasResponse && s.activeSubagents === 0 && s.quietMs > quietThreshold
      streak = ok ? streak + 1 : 0
      return streak >= need ? 'done' : 'pending'
    },
    reset() { streak = 0 },
  }
}

/** 回归报告快照(collectReport 产物;与自用 _real-llm-*.json 场景条目同构,可互相对 diff) */
export interface EvalReport {
  /** ISO 时间戳 */
  at: string
  messageCount: number
  toolCount: number
  usage: { prompt: number; completion: number; cacheRead?: number; cacheCreate?: number }
}

export interface EvalDiffOptions {
  /** token 绝对差阈值(默认 2000;与百分比同时超过才标记) */
  tokenAbs?: number
  /** token 百分比阈值(默认 15) */
  tokenPct?: number
  /** 工具次数绝对差阈值(默认 3) */
  toolCountAbs?: number
}

export interface EvalDiffField {
  key: string
  prev: number
  cur: number
  delta: number
  /** 相对变化百分比(prev>0 才有;否则 0) */
  pct: number
  /** '' 持平 / 'up' 疑似回归(▲)/ 'down' 改善(▼) */
  flag: '' | 'up' | 'down'
}

export interface EvalDiffResult {
  /** 'worse' = 有 ▲ 字段;'better' = 只有 ▼;'ok' = 全持平 */
  status: 'ok' | 'worse' | 'better'
  /** ▲ 字段数(疑似回归;调用方可据此设退出码) */
  regressions: number
  fields: EvalDiffField[]
}

/** 字段是否参与阈值判定(elapsedSec 仅展示;usage 缓存字段参照 token 主阈值) */
const UNJUDGED_KEYS = new Set(['elapsedSec'])

/**
 * 单场景报告 vs 基线阈值判定(纯函数):token ±pct 且 ±abs 同时超过才标 ▲▼(防方差误报),
 * toolCount 超过绝对差即标,elapsedSec 不判。与自用 `--baseline-diff` 同一阈值真相源。
 */
export function diffReport(
  current: Record<string, number>,
  baseline: Record<string, number> | null | undefined,
  opts: EvalDiffOptions = {},
): EvalDiffResult {
  const tokenAbs = opts.tokenAbs ?? 2000
  const tokenPct = opts.tokenPct ?? 15
  const toolAbs = opts.toolCountAbs ?? 3
  const fields: EvalDiffField[] = []
  let regressions = 0
  let ups = 0
  let downs = 0
  const keys = new Set([...Object.keys(current ?? {}), ...Object.keys(baseline ?? {})])
  for (const key of keys) {
    const cur = Number(current?.[key] ?? 0)
    const prev = Number(baseline?.[key] ?? 0)
    const delta = cur - prev
    const pct = prev > 0 ? Math.round((delta / prev) * 100) : 0
    let flag: EvalDiffField['flag'] = ''
    if (!UNJUDGED_KEYS.has(key)) {
      const exceeded = key === 'toolCount'
        ? Math.abs(delta) > toolAbs
        : Math.abs(delta) > tokenAbs && Math.abs(pct) >= tokenPct
      if (exceeded) {
        flag = delta > 0 ? 'up' : 'down'
        if (flag === 'up') { regressions++; ups++ } else downs++
      }
    }
    fields.push({ key, prev, cur, delta, pct, flag })
  }
  return { status: ups > 0 ? 'worse' : downs > 0 ? 'better' : 'ok', regressions, fields }
}

/** harness 依赖的最小 sdk 面(结构子集;ChatSdk 满足 —— 直接传 sdk 即可) */
export interface EvalSdkLike {
  messages: unknown[]
  debugLogs: Ref<DebugLog[]>
  usage?: { prompt: number; completion: number; cacheRead?: number; cacheCreate?: number }
  inspect?: () => { subagent?: { active?: unknown[] } }
}

export interface EvalHarness {
  /** 轮询 debugLogs/messages/子 agent 直到 idle 判定 done;reset(日志清空)或超时抛错(带诊断摘要) */
  waitForIdle(opts?: EvalIdleDetectorOptions & { timeoutMs?: number; sampleMs?: number; onSample?: (s: EvalSample) => void }): Promise<EvalSample>
  /** 当前态报告快照(usage/工具数/消息数;与自用报告场景条目同构) */
  collectReport(): EvalReport
}

/**
 * 创建 eval harness:`waitForIdle`(idle 状态机驱动轮询)+ `collectReport`(报告快照)。
 * 纯判定/等待层 —— 怎么发消息/怎么断言业务结果是集成方自己的事(通常配自己的测试栈)。
 */
export function createEvalHarness(opts: { sdk: EvalSdkLike }): EvalHarness {
  const { sdk } = opts
  const sample = (): EvalSample => {
    const logs = sdk.debugLogs.value ?? []
    const lastTs = logs.length ? logs[logs.length - 1].timestamp : 0
    return {
      messageCount: sdk.messages?.length ?? 0,
      quietMs: lastTs ? Date.now() - lastTs : Number.MAX_SAFE_INTEGER,
      hasResponse: logs.some((l) => l.type === 'llm_response'),
      activeSubagents: sdk.inspect?.().subagent?.active?.length ?? 0,
      logCount: logs.length,
    }
  }
  return {
    async waitForIdle(wOpts = {}) {
      const { timeoutMs = 600_000, sampleMs = 2500, onSample, ...detOpts } = wOpts
      const detector = createIdleDetector(detOpts)
      const t0 = Date.now()
      for (;;) {
        const s = sample()
        const verdict = detector.push(s)
        onSample?.(s)
        if (verdict === 'done') return s
        if (verdict === 'reset') {
          throw new Error(`eval: 等待 idle 期间日志被清空(会话切换/重置;logCount=${s.logCount})—— 采样口径已失效`)
        }
        if (Date.now() - t0 > timeoutMs) {
          const logs = sdk.debugLogs.value ?? []
          const lastTool = [...logs].reverse().find((l) => l.type === 'tool_result')
          const lastReq = [...logs].reverse().find((l) => l.type === 'llm_request')
          const active = sdk.inspect?.().subagent?.active ?? []
          throw new Error(
            `eval: 等待 agent idle 超时(${Math.round(timeoutMs / 1000)}s)。诊断:msgs=${s.messageCount} logs=${s.logCount}` +
            ` lastRound=${String(lastReq?.data?.round ?? '-')} lastTool=${lastTool ? `${String(lastTool.data?.name)}@${String(lastTool.data?.round)}` : '-'}` +
            ` activeSubagents=${active.length}${active.length ? `(${active.map((a) => String((a as { label?: string }).label ?? '?')).join(',')})` : ''}`,
          )
        }
        await new Promise((r) => setTimeout(r, sampleMs))
      }
    },
    collectReport(): EvalReport {
      const logs = sdk.debugLogs.value ?? []
      const u = sdk.usage
      return {
        at: new Date().toISOString(),
        messageCount: sdk.messages?.length ?? 0,
        toolCount: logs.filter((l) => l.type === 'tool_result').length,
        usage: { prompt: u?.prompt ?? 0, completion: u?.completion ?? 0, ...(u?.cacheRead ? { cacheRead: u.cacheRead } : {}), ...(u?.cacheCreate ? { cacheCreate: u.cacheCreate } : {}) },
      }
    },
  }
}
