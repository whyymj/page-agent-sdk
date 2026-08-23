/**
 * gateChain —— createAgent 收口分支门禁链(evidence-audit-gate Phase 0,2026-08-23 抽取)
 *
 * 收口点(模型纯文本收尾、无 tool_calls)依次过五层门禁,任一命中 → 回灌 HumanMessage 续跑:
 *   transitional(过程性收口/第 0 轮行动叙述)→ completion(完结门禁,todos 未完成项)→
 *   zero_tool(操作指令零写收尾,fact-sheet 对账)→ status_query(状态询问零核实断言)→
 *   EXHAUSTED observable(零工具预算耗尽仍谎报收尾,放行但留痕)
 *
 * 抽取动机:五层门禁 + 三个独立重试预算 + 多层互斥语义原都内联在 createAgent 主循环
 * (3.43.1 maxPlanRevisions 误伤即发生在这族交互);判定/文案/预算集中一处后,主循环只消费
 * `runFinishGates` 结果 —— 新增门禁(evidence-audit A2 等)只改本文件,不再往主循环堆 if。
 *
 * 语义不变量(抽取时逐条保留,零行为变化):
 *  - 三预算池独立:transitionalRetries / completionRetries / zeroToolRetries 互不侵占
 *    (zero_tool 与 status_query **共用** zeroToolRetries —— 原设计,防两门禁连环回灌烧穿)
 *  - 触发面互斥:completion 要求 todos 有未完成项;zero_tool/status_query 要求零等效写/零工具调用
 *  - 豁免:garbled 全跳(乱码文本跑门禁无意义);completion/zero_tool/status_query 均不装子 agent 栈
 *    (`__pgIsSubagent`;completion 的豁免是 2026-08-23 评审补的 —— html 子 agent planning=true
 *    默认装 todos 中间件,「子 agent 无 todos」旧假设不成立,子栈正常收口曾被误回灌)
 *  - 回灌统一 pendingFormatRetry 语义(绕过 rounds 预算给补完机会;maxIterations 硬闸兜底)
 */
import {
  detectTransitionalReply,
  detectActionNarration,
  detectActionImperative,
  isZeroEffectiveWrite,
  isZeroToolCalls,
  detectStatusQuery,
  assertsCompletion,
  mentionsLocation,
  buildTurnFactSheet,
  buildZeroToolFeedback,
  buildStatusQueryFeedback,
  extractEvidencePaths,
  isEvidenceCovered,
  type TurnToolUsage,
} from './actionGate'
import { detectIncompleteFinish, buildGateFeedback } from './todos'
import type { Todo } from './state'

/** 门禁链可变预算状态(每 invoke 新建,与 turnUsage 同生命周期;引用传入内部自增) */
export interface GateChainState {
  transitionalRetries: number
  /** 完结门禁预算(原 createAgent 的 gateRetries,独立池) */
  completionRetries: number
  /** 零工具/状态询问门禁共用预算(原设计:防两门禁连环回灌) */
  zeroToolRetries: number
  /** evidence 审计门禁预算(evidence-audit-gate A2;独立池 —— 失败域是记账,不与谎报域互饿) */
  auditRetries: number
}

export function createGateChainState(): GateChainState {
  return { transitionalRetries: 0, completionRetries: 0, zeroToolRetries: 0, auditRetries: 0 }
}

/** 回灌型门禁结果(主循环:push HumanMessage(feedback) + pendingFormatRetry + continue) */
export interface GateFeedback {
  stage: 'transitional_retry' | 'completion_gate' | 'evidence_audit_gate' | 'zero_tool_gate' | 'status_query_gate'
  attempt: number
  feedback: string
  /** debugLogs 附加字段(如 factSheet/pending/rounds;content 由主循环统一附) */
  logData?: Record<string, unknown>
}

/** observable 型结果(主循环:onEvent 留痕,不 continue) */
export interface GateObservable {
  code: 'ZERO_TOOL_GATE_EXHAUSTED' | 'AUDIT_GATE_EXHAUSTED'
  message: string
  context: Record<string, unknown>
}

export type GateOutcome = { kind: 'feedback'; gate: GateFeedback } | { kind: 'observable'; obs: GateObservable } | null

/** 主循环消息的最小结构面(提取 lastHumanContent 用;HumanMessage 经 _getType() === 'human' 识别) */
type MsgLike = { _getType?: () => string; content?: unknown }

export interface RunFinishGatesInput {
  state: GateChainState
  garbled: boolean
  rounds: number
  /** 收口文本(response.content) */
  finalContent: string
  todos: Todo[]
  isSubagent: boolean
  turnUsage: TurnToolUsage
  isWriteToolByName: (name: string) => boolean
  /** 当前 currentMessages(提取最近一条 user 消息,zero_tool/status_query 的触发对象) */
  messages: MsgLike[]
  /** evidence 审计基线:本会话累计成功写路径集(effectiveWritePaths 口径,含 ROOT=整体写;跨 invoke 持续累积) */
  sessionWritePaths: Iterable<string>
  /** invoke 起点的 todos status 快照(id → status);审计面 = 本 invoke 内翻转为 completed 的项 */
  todosStatusAtStart: Map<string, string>
}

/** 各层预算上限(原 createAgent 常量平移;≤2 = 一次回灌即收敛,两次仍异常则放行强收) */
const MAX_TRANSITIONAL_RETRIES = 2
const MAX_COMPLETION_RETRIES = 2
const MAX_ZERO_TOOL_RETRIES = 2
const MAX_AUDIT_RETRIES = 2

/**
 * 收口门禁链主入口(纯判定 + 预算自增;不触碰 messages/日志 —— 副作用归主循环)。
 * 顺序与互斥语义见文件头;返回 null = 全部放行,主循环落入 beforeReturn/收口。
 */
export function runFinishGates(i: RunFinishGatesInput): GateOutcome {
  const { state: g, garbled, rounds } = i
  const content = i.finalContent
  if (garbled) return null  // 乱码文本:门禁全跳(原文都不可信,回灌无意义)

  // 1. transitional:过程性收口(rounds>0 短文本过渡表态)/ 第 0 轮行动叙述(长文幻觉叙述)
  const transitional = rounds > 0 ? detectTransitionalReply(content) : detectActionNarration(content)
  if (g.transitionalRetries < MAX_TRANSITIONAL_RETRIES && transitional) {
    g.transitionalRetries += 1
    return {
      kind: 'feedback',
      gate: {
        stage: 'transitional_retry',
        attempt: g.transitionalRetries,
        feedback:
          '⚠️ 你刚才只输出了计划/行动叙述(如「我先看看」「开始添加」),没有发起任何工具调用,因此什么都未执行。请立即用标准 function calling 调用所需工具把任务做完,全部完成后再给出总结回复。',
        logData: { rounds },
      },
    }
  }

  // 2. 完结门禁:todos 有未完成项却纯文本收尾 → 双出口回灌。rounds>0 前置(跨轮陈旧 todos 不在纯问答轮发难);
  //    子 agent 栈豁免(评审 2026-08-23 补:html 子 agent planning=true 装 todos,旧「子栈无 todos」假设不成立)
  if (rounds > 0 && !i.isSubagent && g.completionRetries < MAX_COMPLETION_RETRIES && detectIncompleteFinish(i.todos, content)) {
    g.completionRetries += 1
    return {
      kind: 'feedback',
      gate: {
        stage: 'completion_gate',
        attempt: g.completionRetries,
        feedback: buildGateFeedback(i.todos),
        logData: { pending: i.todos.filter((t) => t.status !== 'completed').map((t) => t.id) },
      },
    }
  }

  // 2.5 evidence-audit-gate A2(2026-08-23):本 invoke 翻转 completed 的 todos,evidence 含 path 形态
  //     但与会话累计写路径零重叠 → 记账核对回灌(防编造路径;描述性证据零路径形态不核,宁漏勿误)。
  //     审计面限定「本 invoke 翻转」防跨轮遗留误伤(todos 持久而写路径集按会话累计);独立预算;子栈不装。
  const auditOffenders = i.isSubagent ? [] : auditEvidenceOffenders(i.todos, i.todosStatusAtStart ?? new Map(), i.sessionWritePaths ?? [])
  if (auditOffenders.length) {
    if (g.auditRetries < MAX_AUDIT_RETRIES) {
      g.auditRetries += 1
      return {
        kind: 'feedback',
        gate: {
          stage: 'evidence_audit_gate',
          attempt: g.auditRetries,
          feedback: buildEvidenceAuditFeedback(auditOffenders),
          logData: { offenders: auditOffenders.map((t) => ({ id: t.id, evidence: t.evidence })) },
        },
      }
    }
    return {
      kind: 'observable',
      obs: {
        code: 'AUDIT_GATE_EXHAUSTED',
        message: `evidence 审计经 2 次回灌后仍有 ${auditOffenders.length} 项任务的证据路径与写入记录不符,已放行;最终回复中的完成声明可能不实`,
        context: { offenders: auditOffenders.map((t) => ({ id: t.id, evidence: t.evidence })) },
      },
    }
  }

  // 主 agent 栈专属(以下两层:谎报检测,子栈不装)
  if (i.isSubagent) return null
  // 最近一条 user 消息(zero_tool/status_query 的判定对象:门禁回灌也是 human 消息,天然取到最新指令)
  let lastHumanContent = ''
  for (let mi = i.messages.length - 1; mi >= 0; mi--) {
    const m = i.messages[mi]
    if (m._getType?.() === 'human') { lastHumanContent = String(m.content ?? ''); break }
  }

  // 3. imperative-zero-tool-gate:操作祈使句 + 本轮零写/零委派 + 纯文本非问句收尾 → fact-sheet 对账回灌。
  //    出口①机械化:收口文本已含位置说明(mentionsLocation)不回灌。
  if (g.zeroToolRetries < MAX_ZERO_TOOL_RETRIES
    && isZeroEffectiveWrite(i.turnUsage, i.isWriteToolByName)
    && detectActionImperative(lastHumanContent)
    && !mentionsLocation(content)
    && !/[?？]\s*$/.test(content.trim())) {
    g.zeroToolRetries += 1
    const factSheet = buildTurnFactSheet(i.turnUsage, i.todos, i.isWriteToolByName)
    return { kind: 'feedback', gate: { stage: 'zero_tool_gate', attempt: g.zeroToolRetries, feedback: buildZeroToolFeedback(factSheet), logData: { factSheet } } }
  }

  // 4. status-query-zero-verify-gate:状态询问 + 本轮零工具(连 read 都没调)+ 断言完成态 → 先核实再断言
  if (g.zeroToolRetries < MAX_ZERO_TOOL_RETRIES
    && isZeroToolCalls(i.turnUsage)
    && detectStatusQuery(lastHumanContent)
    && assertsCompletion(content)) {
    g.zeroToolRetries += 1
    const factSheet = buildTurnFactSheet(i.turnUsage, i.todos, i.isWriteToolByName)
    return { kind: 'feedback', gate: { stage: 'status_query_gate', attempt: g.zeroToolRetries, feedback: buildStatusQueryFeedback(factSheet), logData: { factSheet } } }
  }

  // 5. 预算耗尽仍零工具收尾:observable 留痕(谎报放行恰是最该让集成方知晓的时刻,不能零感知)
  if (g.zeroToolRetries >= MAX_ZERO_TOOL_RETRIES && isZeroEffectiveWrite(i.turnUsage, i.isWriteToolByName)
    && detectActionImperative(lastHumanContent)) {
    return {
      kind: 'observable',
      obs: {
        code: 'ZERO_TOOL_GATE_EXHAUSTED',
        message: '操作指令经 2 次回灌后仍以零工具纯文本收尾(疑似谎报完成),已放行;最终回复可能不实',
        context: { factSheet: buildTurnFactSheet(i.turnUsage, i.todos, i.isWriteToolByName) },
      },
    }
  }
  return null
}

// ===== evidence-audit-gate A2 辅助(审计面计算导出供 wrap-up 补跑复用) =====

/**
 * evidence 审计面:本 invoke 内翻转为 completed(todosStatusAtStart 快照 diff,跨轮遗留不审)×
 * evidence 含 path 形态(描述性证据跳过)× 与会话累计写路径零重叠(isEvidenceCovered,ROOT=整体写全覆盖)。
 */
export function auditEvidenceOffenders(
  todos: Todo[],
  todosStatusAtStart: Map<string, string>,
  sessionWritePaths: Iterable<string>,
): Todo[] {
  const sess = Array.from(sessionWritePaths ?? [])
  return todos.filter((t) => {
    if (t.status !== 'completed') return false
    if (todosStatusAtStart?.get(t.id) === 'completed') return false // 非本 invoke 翻转(评审 P0-2:跨轮遗留不审计)
    const eps = extractEvidencePaths(t.evidence ?? '')
    if (!eps.length) return false // 描述性证据不含路径形态,不核(宁漏勿误)
    return !isEvidenceCovered(eps, sess)
  })
}

/** evidence 审计回灌文案(三出口:改真路径 / 改回 pending / 如实说明完成方式) */
function buildEvidenceAuditFeedback(offenders: Todo[]): string {
  const lines = offenders
    .map((t) => `#${t.id}(${t.content.length > 40 ? `${t.content.slice(0, 40)}…` : t.content}) evidence:「${(t.evidence ?? '').slice(0, 80)}」`)
    .join('\n')
  return [
    '⚠️ 以下已完成任务的 evidence 路径与本次会话的写入记录对不上(该路径从未被写入):',
    lines,
    '请核实并处理:① 路径写错 → 用 update_todo 修正 evidence 为本次实际写入的 jsonPath;② 实际未完成 → 改回 pending 继续执行,不要谎报完成;③ 工作经委派子 agent 等未走主写路径完成 → 修正 evidence 为如实说明(不含路径样式文字)。',
  ].join('\n')
}
