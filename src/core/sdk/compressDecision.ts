/**
 * 压缩决策 schema(agent-driven-compression)—— 纯函数
 *
 * CompressDecisionSchema(zod):summaryLlm.decide 输出的结构化压缩决策。
 * 触发预检(shouldTriggerCompression)在 composables/contextIndex.ts(与 estimateRoundTokens 同层,
 * 避免 composables→sdk 反向依赖);本文件只放 LLM 决策输出的 zod schema。
 *
 * 设计:
 * - 纯 zod schema 无外部依赖,易白盒测
 * - 双字段:keepRounds(轮数模式)/ windowRatio(token 模式),prompt 告知 LLM 当前触发模式按对应字段填;
 *   SDK 默认 token 驱动压缩(resolveContextOptions 恒注入 contextWindow),两字段在异模式无对应关系 → refine 强制至少一个
 * - token 模式执行仍走「累加循环 + contextWindow 封顶」(不直接按 keepRounds 切,防大 JSON 压缩后仍超窗口)
 * - 校验失败 → 决策器重试一次 → 再失败 null → 降级静态压缩(design §3)
 */
import { z } from 'zod'
import type { AgentMessage } from '../types'
import type { ContextSnapshot } from '../utils/contextAnalysis'

/**
 * 压缩决策 schema(summaryLlm.decide 输出)。
 * - keepRounds:轮数模式保留最近几轮(int 0-50,0=全压最省;决策模式下界守卫 ≥1 在 compress 侧)
 * - windowRatio:token 模式窗口预算比例(0~1,替代静态比例,仍走 token 封顶累加循环)
 * - summarize.mode:llm(走 llmInvoke,undefined 回退)/ index(零成本索引)
 * - recallTopK:召回轮数(int 0-10,0=不召回)
 * - preserveTools:额外保留 result 摘要的工具(≤10,与配置 preserveLastToolResults 并集)
 * - reason:决策理由(≤200 字,随摘要驻留上下文供 UI 审计)
 * refine:keepRounds / windowRatio 至少填一个(按当前触发模式)。
 */
export const CompressDecisionSchema = z.object({
  keepRounds: z.number().int().min(0).max(50).optional(),
  windowRatio: z.number().min(0).max(1).optional(),
  summarize: z.object({ mode: z.enum(['index', 'llm']) }),
  recallTopK: z.number().int().min(0).max(10).optional(),
  preserveTools: z.array(z.string()).max(10).optional(),
  reason: z.string().max(200).optional(),
}).refine((d) => d.keepRounds !== undefined || d.windowRatio !== undefined, {
  message: 'keepRounds 与 windowRatio 至少填一个(按当前触发模式)',
})

export type CompressDecision = z.infer<typeof CompressDecisionSchema>

/** 压缩决策输入(agentCompression 开启时,summarization 中间件触发 decide 传入) */
export interface CompressDecisionInput {
  /** 当前消息(供 inspect_context 工具组合 rounds + totalTokens) */
  getMessages: () => AgentMessage[]
  /** contextInspector 快照(可选,inspect_context 的 categories 来源) */
  getSnapshot?: () => ContextSnapshot | undefined
  /** 模型上下文窗口(inspect_context occupancy + 决策 prompt) */
  contextWindow?: number
  /** 压缩触发阈值比例(进 prompt 供 LLM 参考) */
  thresholdRatio?: number
  /** 触发原因(进 prompt,如「token 超阈值」「轮数超阈值」) */
  triggerReason: string
  /** 触发模式(决定 LLM 填 keepRounds 还是 windowRatio) */
  triggerMode: 'token' | 'rounds'
}
