/**
 * Summarization 中间件 —— 复用 useContextManager 做跨轮历史压缩
 *
 * 对齐 Deep Agents 的 summarization middleware:
 *  - 触发:默认按轮数阈值(索引摘要,零 LLM 成本);可选 enableLLMSummary 用 LLM 段落摘要
 *  - 通过 compressInput 钩子接入 createAgent(构建上下文前压缩 AgentMessage[])
 *  - 配合关键词召回,保留与当前问题相关的早期对话
 *
 * 注:单轮 ReAct 内的工具结果裁剪(trimToolResults)仍由 createAgent 侧处理,
 * 这里聚焦跨轮历史压缩。
 *
 * agentCompression(agent-driven-compression):opts.decideInvoke 存在(开 + summaryLlm 可用)时,
 * compressInput 先 shouldTriggerCompression gate(避免每条消息都 decide 烧 LLM,design §1 HIGH)→
 * decide(inspect_context 工具循环)→ compress(messages, decision);decide 失败/null → 静态压缩(零阻塞)。
 *
 * controller(harden-context-resilience):setContextWindow 供 createChatSdk setLlm 后集中回灌新窗口,
 * compress 读 ctxManager.config 共享引用,下轮即按新阈值触发(无需重建中间件)。
 */
import type { AgentMessage } from '../types'
import { useContextManager, type ContextManagerOptions } from '../composables/useContextManager'
import { groupRounds } from '../utils/rounds'
import { shouldTriggerCompression } from '../composables/contextIndex'
import type { CompressDecision, CompressDecisionInput } from '../sdk/compressDecision'
import type { ContextSnapshot } from '../utils/contextAnalysis'
import type { Middleware } from './middleware'

/** summarization 装配选项(ContextManagerOptions + agentCompression 决策注入) */
export interface SummarizationOptions extends Partial<ContextManagerOptions> {
  /** 压缩决策 invoke(agentCompression 开启时;decide 成功 → compress 用决策,失败/null → 静态) */
  decideInvoke?: (input: CompressDecisionInput) => Promise<CompressDecision | null>
  /** contextInspector 快照 getter(供 inspect_context 工具的 categories + decide) */
  getSnapshot?: () => ContextSnapshot | undefined
}

/** summarization 中间件 + controller(setLlm 后回灌 contextWindow) */
export type SummarizationMiddleware = Middleware & {
  /** 更新 contextWindow(下轮 compress 即用新阈值);config 共享引用,compress 读取即生效 */
  setContextWindow(cw: number): void
}

export function createSummarizationMiddleware(
  opts: SummarizationOptions = {},
): SummarizationMiddleware {
  const ctxManager = useContextManager(opts)

  const middleware: Middleware = {
    name: 'summarization',
    compressInput: async (messages: AgentMessage[]) => {
      // agentCompression gate:decideInvoke 存在 + 达阈值才 decide(避免每条消息都烧 LLM;design §1 HIGH)
      let decision: CompressDecision | undefined
      if (opts.decideInvoke) {
        const rounds = groupRounds(messages)
        if (shouldTriggerCompression(rounds, ctxManager.config)) {
          const triggerMode = ctxManager.config.contextWindow && ctxManager.config.contextWindow > 0 ? 'token' : 'rounds'
          const triggerReason = triggerMode === 'token'
            ? `历史 token 超阈值 ${Math.round((ctxManager.config.contextWindow ?? 0) * (ctxManager.config.summaryThresholdRatio ?? 0.5))}`
            : `轮数 ${rounds.length} 超阈值 ${ctxManager.config.summaryThresholdRounds}`
          try {
            decision =
              (await opts.decideInvoke({
                getMessages: () => messages,
                getSnapshot: opts.getSnapshot,
                contextWindow: ctxManager.config.contextWindow,
                thresholdRatio: ctxManager.config.summaryThresholdRatio,
                triggerReason,
                triggerMode,
              })) ?? undefined
          } catch {
            decision = undefined // decide 抛错兜底(buildCompressDecisionInvoke 内已 catch null,此处双保险)
          }
        }
      }
      const { messages: compressed, stats } = await ctxManager.compress(messages, decision)
      return { messages: compressed, stats }
    },
  }

  // controller:setLlm 后由 createChatSdk 集中回灌新 contextWindow(compress 读 config 共享引用即生效)
  return Object.assign(middleware, {
    setContextWindow(cw: number) {
      ctxManager.config.contextWindow = cw
    },
  })
}
