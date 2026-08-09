/**
 * inspect_context 工具(agent-driven-compression)—— 压缩决策专用
 *
 * 供 summaryLlm.decide 两段式工具循环:decide-LLM 调本工具查看当前上下文构成,
 * 再输出压缩决策(keepRounds/windowRatio)。仅决策时临时构造 + bind 给 summaryLlm,
 * 不进主 agent 工具池。
 *
 * 数据源组合(design §2 评审修正,显式列三处):
 * - totalTokens:groupRounds + estimateRoundTokens(与 shouldTriggerCompression 同口径 → 决策主依据)
 * - categories:复用 contextInspector 的 ContextSnapshot(analyzeContext 分类;能力关时空数组)
 * - rounds:groupRounds + estimateRoundTokens + roundToolNames + plainSummary(每轮 token/工具/首句)
 *
 * 参数:path 过滤分类 / role 聚焦首句角色 / limit 返回最近 N 轮(防返回过大)。
 */
import { z } from 'zod'
import { defineTool } from './defineTool'
import { groupRounds, roundToolNames, plainSummary } from '../utils/rounds'
import { estimateRoundTokens } from '../composables/contextIndex'
import type { AgentMessage } from '../types'
import type { ContextSnapshot } from '../utils/contextAnalysis'

export interface InspectContextToolDeps {
  /** 当前消息(供 rounds 组合 + totalTokens 估算;与 shouldTriggerCompression 同口径) */
  getMessages: () => AgentMessage[]
  /** contextInspector 快照(可选,categories 来源;能力关时 undefined → categories 空) */
  getSnapshot?: () => ContextSnapshot | undefined
  /** 模型上下文窗口(occupancy 计算;不传则 occupancy=0) */
  contextWindow?: number
}

const inspectContextParams = z.object({
  path: z
    .string()
    .optional()
    .describe('分类 key 过滤(如 toolResults/history/systemPrompt/dataHint);不传=全部分类'),
  role: z
    .enum(['user', 'assistant', 'system', 'tool'])
    .optional()
    .describe('聚焦每轮首句的角色(assistant→回复摘要,user→问题摘要);不影响工具列表'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe('返回最近 N 轮(默认全部;超 50 自动截最近 50 防返回过大)'),
})

/**
 * 构造 inspect_context 工具(StructuredToolInterface,可 bindTools 给 summaryLlm.decide)。
 * 不进主 agent 工具池 —— 仅压缩决策时临时构造。
 */
export function createInspectContextTool(deps: InspectContextToolDeps) {
  return defineTool({
    name: 'inspect_context',
    description:
      '查看当前对话上下文的构成(供压缩决策)。返回:totalTokens(历史轮次 token 总和,与触发判断同口径)、occupancy(窗口占用比)、contextWindow、categories(分类占用)、rounds(每轮 token/工具/首句)。先调用本工具查看构成,再决定压缩策略。',
    schema: inspectContextParams,
    handler: (args) => {
      const allRounds = groupRounds(deps.getMessages())
      // 硬上限防返回过大(超 50 截最近 50);limit 进一步收窄
      const capped = allRounds.length > 50 ? allRounds.slice(allRounds.length - 50) : allRounds
      const rounds = args.limit && capped.length > args.limit ? capped.slice(capped.length - args.limit) : capped

      const roundInfos = rounds.map((r) => {
        const tokens = estimateRoundTokens(r)
        const tools = roundToolNames(r)
        // head:按 role 聚焦首句(默认 user 问题;assistant → 回复);system/tool 边缘默认 user
        const headMsg = args.role === 'assistant' ? r.assistantMsgs[0] ?? r.userMsg : r.userMsg
        const head = plainSummary(typeof headMsg.content === 'string' ? headMsg.content : '', 60)
        return { round: r.round, tokens, tools, head }
      })

      const totalTokens = roundInfos.reduce((s, r) => s + r.tokens, 0)
      const contextWindow = deps.contextWindow
      const occupancy = contextWindow ? totalTokens / contextWindow : 0

      // categories:从 contextInspector 快照(可选;能力关 → 空数组)
      const snap = deps.getSnapshot?.()
      const allCategories = snap?.categories ?? []
      const categories = args.path ? allCategories.filter((c) => c.key === args.path) : allCategories

      return { totalTokens, occupancy, contextWindow, categories, rounds: roundInfos }
    },
  })
}
