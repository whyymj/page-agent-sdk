/**
 * 上下文管理器 — 综合压缩策略
 *
 * 融合四种策略的优点：
 * 1. 滑动窗口：最近 N 轮完整保留，保证近期上下文精确
 * 2. 摘要压缩：超出窗口的旧轮次压缩为摘要系统消息
 *    - 默认用"索引摘要"（零 LLM 成本，复用每轮 userQuery/assistantPreview）
 *    - 可选 LLM 摘要（enableLLMSummary）生成更连贯的段落
 *    - P1-25（fix-data-integrity）：LLM 摘要异步化 —— 压缩时立即用索引模板/前缀缓存返回（零阻塞首 token），
 *      后台 fire-and-forget 跑 LLM 摘要入前缀缓存，后续压缩前缀命中（LLM 前缀 + 新增尾部索引增量）
 * 3. 关键词召回：从旧轮次中按当前问题检索相关历史，注入"相关历史"段
 * 4. 单轮 ReAct 内的工具结果裁剪由 createAgent 侧的 trimContextIfNeededImpl 处理（本模块不负责）
 *
 * 注：跨轮历史中 state.messages 只含 user/assistant 文本，工具结果仅在
 * 单次 chat() 的 ReAct 循环内累积，因此跨轮压缩聚焦于窗口+摘要+召回。
 */
import type { AgentMessage } from '../types'
import { groupRounds, plainSummary, parseSummarySegment, type Round } from '../utils/rounds'
import { estimateRoundTokens, indexSummarize, recallRounds, shouldTriggerCompression } from './contextIndex'
import { estimateTokens } from '../utils/modelCaps'
import type { CompressDecision } from '../sdk/compressDecision'

export interface ContextManagerOptions {
  /** 滑动窗口：保留最近几轮完整对话（轮数模式用） */
  windowRounds: number
  /** 超过多少轮触发摘要压缩（轮数模式用,含窗口内） */
  summaryThresholdRounds: number
  /** 旧工具结果截断长度（单轮 ReAct 内） */
  toolResultMaxChars: number
  /** 是否启用关键词召回相关历史 */
  enableRecall: boolean
  /** 召回的最大轮次数 */
  recallTopK: number
  /** 是否启用 LLM 增强摘要（否则用零成本索引摘要） */
  enableLLMSummary: boolean
  /** 用于摘要的 LLM invoke 函数（可选） */
  llmInvoke?: (prompt: string) => Promise<string>
  /** 模型上下文窗口(token);提供则按 token 触发压缩 + token 窗口(自适应大模型),否则按轮数 */
  contextWindow?: number
  /** 触发压缩的 token 比例(默认 0.5:历史估算 token > contextWindow*0.5 时压缩) */
  summaryThresholdRatio?: number
  /**
   * prompt 软上限(token,成本维度):历史估算 token > min(window×ratio, softCap) 即触发压缩。
   * 窗口 ≥320K 的模型未传时默认 160K(超大窗口 ratio×window 阈值过晚,500K 才首压);显式传 0 关闭。
   */
  promptSoftCapTokens?: number
  /** 保留最近窗口的 token 预算比例(默认 0.4) */
  windowRatio?: number
  /**
   * 压缩时注入「当前可操作数据」快照(防 LLM 基于过时记忆操作已卸载/新增的动态组件)。
   * 提供 getter 则每次压缩把当前主数据 description 作为一段附进摘要 system 消息(不进压缩)。
   */
  getRegisteredData?: () => { description: string }[]
  /** @deprecated 旧多对象模型遗留(单对象 data 模式用 getRegisteredData);仍兼容,返回值 path 字段忽略 */
  getRegisteredSlots?: () => { path: string; description: string }[]
  /**
   * 跨轮摘要时,对这些工具的步骤 result 额外保留摘要片段进 summaryMsg(防字段描述被摘要掉)。
   * 如 ['schema_data','read'] → 即便 older 轮被摘要,关键字段说明仍在摘要里。
   */
  preserveLastToolResults?: string[]
}

export interface CompressionStats {
  triggered: boolean
  roundsTotal: number
  roundsSummarized: number
  roundsRecalled: number
  originalMessages: number
  compressedMessages: number
  strategy: string
  /** 触发本次压缩的 agent 决策(agentCompression 开启且 decide 成功时;无决策=静态压缩) */
  decision?: CompressDecision
}

export const DEFAULT_CONTEXT_OPTIONS: ContextManagerOptions = {
  windowRounds: 6,
  summaryThresholdRounds: 8,
  toolResultMaxChars: 800,
  enableRecall: true,
  recallTopK: 3,
  enableLLMSummary: false,
}

export function useContextManager(opts: Partial<ContextManagerOptions> = {}) {
  const config: ContextManagerOptions = { ...DEFAULT_CONTEXT_OPTIONS, ...opts }

  // P1-25(fix-data-integrity):LLM 摘要异步化 —— 「模板先行 + 后台替换」(照 trim-llm 模式)。
  // compress 触发 llm 模式时立即用索引摘要返回(零阻塞首 token),fire-and-forget 后台 LLM 摘要入前缀缓存。
  // older 恒从 messages 首轮起(groupRounds 全量;压缩不改 state.messages)→ older 单调前缀扩展 → coveredCount 单调可比:
  // 后续压缩命中缓存时,LLM 前缀 + 新增尾部索引增量拼接。fire-and-forget 只写闭包缓存(不触 messages/store),
  // unmount 后完成也无副作用(随闭包 GC),无需竞态守卫。trimMemoryMessages(OOM splice)致 rounds 错位时缓存不命中,
  // 自然回退模板 + 重新 fire(最多摘要质量降级,无正确性影响)。
  //
  // team-audit P1#2(llmCache 跨会话泄漏):llmCache 闭包与 SDK 实例同生命周期(单例非 per-session),
  // switchSession/resetSession 必须调 reset() 清缓存,否则会话 A 的 LLM 摘要前缀/全量命中拼进会话 B 的【对话历史摘要】。
  // epoch 代数:reset 后在飞的旧摘要 .then 按 epoch 丢弃(只清缓存不挡在飞回调 = 假修:
  // reset 后 llmCache=null,单调守卫恒过,在飞 .then 落缓存复活泄漏);
  // in-flight 防重入按 epoch 隔离(旧代在飞不阻塞新会话 fire —— 伴生缺陷:B 自身后台摘要被 llmInFlight 吞)。
  // llmInFlight 状态不手工清(交 .finally 按 flight 所有权自然回落,手工清会双重 fire)。
  let llmCache: { coveredCount: number; text: string } | null = null
  let llmEpoch = 0
  let inFlightEpoch = -1 // 进行中后台摘要所属 epoch(-1 = 无在飞;仅同 epoch 防重入)
  let flightId = 0       // 在飞所有权:.finally 只由最新 flight 回落(旧代孤儿化后不误清新代在飞态)

  /** 后台 LLM 摘要:完成时按 epoch + coveredCount 单调守卫更新缓存;失败不更新(下次触发重试) */
  function fireBackgroundLlmSummary(n: number, idxText: string): void {
    if (!config.llmInvoke) return
    if (inFlightEpoch === llmEpoch) return // 同 epoch 防重入(重试/双触发);跨 epoch 旧代在飞已被孤儿化,不阻塞新会话 fire
    const epoch = llmEpoch
    const id = ++flightId
    inFlightEpoch = epoch
    void config.llmInvoke(idxText)
      .then((t) => {
        if (epoch === llmEpoch && typeof t === 'string' && t && (!llmCache || llmCache.coveredCount <= n)) {
          llmCache = { coveredCount: n, text: t }
        }
      })
      .catch(() => { /* 保留索引模板;下次压缩触发时重试 */ })
      .finally(() => { if (id === flightId) inFlightEpoch = -1 })
  }

  /** 会话切换/重置(team-audit P1#2):清 LLM 摘要前缀缓存 + epoch 翻转让在飞旧摘要结果失效。
   *  由 createChatSdk 的 switchSession/resetSession 调用(summarization 控制面透传)。 */
  function reset(): void {
    llmEpoch++
    llmCache = null
  }

  /**
   * 压缩跨轮历史，返回注入摘要后的消息列表与统计。
   * 若未达阈值，原样返回（triggered=false）。
   */
  async function compress(
    messages: AgentMessage[],
    decision?: CompressDecision,
  ): Promise<{ messages: AgentMessage[]; stats: CompressionStats }> {
    const rounds = groupRounds(messages)
    const originalCount = messages.length

    // 提取头部 trimMemoryMessages 留下的旧摘要正文(groupRounds 跳过头部 system,不并入 older →
    // 需手动并入新摘要,防累积历史被 summarization 静默丢失)
    let prevSummaryBody = ''
    if (rounds.length) {
      const firstUserIdx = rounds[0].startIdx
      for (let i = 0; i < firstUserIdx; i++) {
        const m = messages[i]
        if (m.role === 'system') {
          // 经共享 parseSummarySegment 提取头部旧摘要(消除与 rounds.ts 的提取重复;unify-context-compression)
          const seg = parseSummarySegment(m.content as string)
          if (seg) { prevSummaryBody = seg.body; break }
        }
      }
    }

    const notTriggered = (strategy: string) => ({
      messages,
      stats: {
        triggered: false,
        roundsTotal: rounds.length,
        roundsSummarized: 0,
        roundsRecalled: 0,
        originalMessages: originalCount,
        compressedMessages: originalCount,
        strategy,
      },
    })

    // 触发预检(单一真源;agentCompression decide 前置 gate + compress 共用;design §1 HIGH:避免每条消息都 decide)
    if (!shouldTriggerCompression(rounds, config)) return notTriggered('none')

    // 切分窗口:token 驱动(大模型自适应)优先,否则按轮数;决策(decision)覆盖切分参数
    let recent: Round[]
    let older: Round[]
    let strategyPrefix: string
    if (config.contextWindow && config.contextWindow > 0) {
      // token 模式:决策 windowRatio 覆盖静态比例(仍走累加循环,保留 token 封顶保证;不直接按 keepRounds 切,防大 JSON 压缩后仍超窗口)
      const windowBudget = config.contextWindow * (decision?.windowRatio ?? config.windowRatio ?? 0.4)
      // 从最新轮往回累加 token,加进去就超预算的轮纳入 older(被摘),其后保留
      let acc = 0
      let splitIdx = 0
      for (let i = rounds.length - 1; i >= 0; i--) {
        acc += estimateRoundTokens(rounds[i])
        if (acc >= windowBudget) {
          splitIdx = i + 1
          break
        }
      }
      if (splitIdx > rounds.length - 1) splitIdx = rounds.length - 1 // 至少保留最新 1 轮
      if (splitIdx < 0) splitIdx = 0
      recent = rounds.slice(splitIdx)
      older = rounds.slice(0, splitIdx)
      if (!older.length) return notTriggered('none')
      strategyPrefix = 'token-window+'
    } else {
      // 轮数模式:决策 keepRounds 覆盖 windowRounds(下界 ≥1 防「贪省恒全压」);older 空(keepRounds≥总轮)→ notTriggered
      const rawKeep = decision?.keepRounds ?? config.windowRounds
      const recentCount = Math.min(Math.max(1, rawKeep), rounds.length)
      recent = rounds.slice(rounds.length - recentCount)
      older = rounds.slice(0, rounds.length - recentCount)
      if (!older.length) return notTriggered('none')
      strategyPrefix = 'window+'
    }

    // 当前问题（最新一条用户消息）
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    const query = lastUser?.content || ''

    // 摘要模式:决策 summarize.mode 覆盖 enableLLMSummary(llm 模式但 llmInvoke undefined → 回退 index)
    const summaryMode = decision?.summarize?.mode ?? (config.enableLLMSummary ? 'llm' : 'index')
    // preserve 集:配置 ∪ 决策 preserveTools(决策是扩展,不减;design §7)
    const preserveSet = new Set<string>([
      ...(config.preserveLastToolResults ?? []),
      ...(decision?.preserveTools ?? []),
    ])
    const preserveArg = preserveSet.size ? preserveSet : undefined
    let summaryText: string
    let strategy: string
    if (summaryMode === 'llm' && config.llmInvoke) {
      // P1-25:llm 摘要异步化 —— 立即返回(缓存命中/前缀拼接/索引模板),后台 fire LLM 增强,不阻塞首 token。
      // 原实现同步 await llmInvoke(≤summaryTimeoutMs 15s)阻塞首轮模型调用,恰在大 JSON 长流程(>0.5×window)场景触发
      const idxText = indexSummarize(older, preserveArg)
      const n = older.length
      if (llmCache && llmCache.coveredCount >= n) {
        // 全覆盖缓存(窗口回缩/同参重压等罕见情形):直接用 LLM 摘要
        summaryText = llmCache.text
        strategy = strategyPrefix + 'llm_summary(cached)'
      } else if (llmCache && llmCache.coveredCount > 0) {
        // 前缀缓存:LLM 摘要覆盖前 coveredCount 轮 + 新增尾部用索引增量(indexSummarize 用绝对轮号,slice 不错位)
        summaryText = llmCache.text + '\n' + indexSummarize(older.slice(llmCache.coveredCount), preserveArg)
        strategy = strategyPrefix + 'llm_summary(prefix)+index_tail'
        fireBackgroundLlmSummary(n, idxText)
      } else {
        // 首次触发:纯索引模板零阻塞,后台 LLM 完成后下次压缩起前缀命中
        summaryText = idxText
        strategy = strategyPrefix + 'index_summary(llm_background)'
        fireBackgroundLlmSummary(n, idxText)
      }
    } else {
      summaryText = indexSummarize(older, preserveArg)
      strategy = strategyPrefix + 'index_summary'
    }

    // 召回:决策 recallTopK 覆盖(0=不召回);无决策用 config.enableRecall + recallTopK
    const recallTopK = decision?.recallTopK != null ? decision.recallTopK : (config.enableRecall ? config.recallTopK : 0)
    const recalled = recallTopK > 0 ? recallRounds(older, query, recallTopK) : []
    const recallBlock = recalled.length
      ? recalled
          .map(
            (r) =>
              `- 第${r.round}轮：${plainSummary(r.userMsg.content, 60)} → ${r.assistantMsgs[0] ? plainSummary(r.assistantMsgs[0].content, 80) : ''}`
          )
          .join('\n')
      : ''

    // 组装注入的系统消息
    const fullSummaryText = prevSummaryBody
      ? `${summaryText}\n【更早累积摘要】\n${prevSummaryBody}`
      : summaryText
    const parts: string[] = [
      `【对话历史摘要】以下是之前 ${older.length} 轮对话的要点（最新 ${recent.length} 轮已完整保留）：`,
      fullSummaryText,
    ]
    if (decision) {
      // 决策注记(随摘要驻留上下文供 UI 审计;design §5)
      const modeTag = config.contextWindow && config.contextWindow > 0
        ? `windowRatio=${decision.windowRatio ?? config.windowRatio}`
        : `keepRounds=${decision.keepRounds ?? config.windowRounds}`
      parts.push(`\n(压缩决策:${modeTag} · 摘要=${decision.summarize.mode} · 召回=${recallTopK}${decision.reason ? ' · ' + decision.reason : ''})`)
    }
    if (recallBlock) {
      parts.push(`\n【与当前问题可能相关的早期对话】`, recallBlock)
    }
    // A:注入当前可操作数据快照(防 LLM 基于过时记忆操作已卸载/新增的动态组件)
    const regGetter = config.getRegisteredData ?? config.getRegisteredSlots
    if (regGetter) {
      try {
        const props = regGetter()
        if (props.length) {
          const propLines = props.map((p) => `- ${(p as any).path ? (p as any).path + ': ' : ''}${p.description}`).join('\n')
          parts.push(`\n【当前可操作数据(动态增删后的最新状态,操作前以 read 为准)】`, propLines)
        }
      } catch {
        /* getter 抛错不影响压缩 */
      }
    }
    const summaryMsg: AgentMessage = {
      role: 'system',
      content: parts.join('\n'),
      timestamp: Date.now(),
    }

    // 展开最近窗口的原始消息
    const recentMessages: AgentMessage[] = []
    for (const r of recent) {
      recentMessages.push(r.userMsg)
      recentMessages.push(...r.assistantMsgs)
    }

    const compressed = [summaryMsg, ...recentMessages]

    // H2(harden-context-resilience):压缩后 over-window 复查(单条大 user + summary 仍超窗口)
    const compressedTokens = compressed.reduce(
      (s, m) => s + estimateTokens(typeof m.content === 'string' ? (m.content as string) : JSON.stringify(m.content)),
      0,
    )
    if (config.contextWindow && compressedTokens > config.contextWindow) {
      // 压缩后仍超(单条 user/system 超窗口,compress 无法进一步压)→ observable warn(P3 反应性重试 / Phase 5 系统段兜底)
      console.warn(`[page-agent-sdk] compress 后仍超窗口:${compressedTokens} > ${config.contextWindow} tokens(单条消息超窗口,compress 无法压)`)
    }

    return {
      messages: compressed,
      stats: {
        triggered: true,
        roundsTotal: rounds.length,
        roundsSummarized: older.length,
        roundsRecalled: recalled.length,
        originalMessages: originalCount,
        compressedMessages: compressed.length,
        strategy,
        decision,
      },
    }
  }

  return { compress, config, reset }
}


