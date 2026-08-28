import { pathsOverlap } from './readInvalidation'

/**
 * imperative-zero-tool-gate 纯函数 —— 操作指令零工具收尾门禁(防「谎报完成」)
 *
 * 完结门禁只盯 todos 未完成项;谎报的两条路都绕过它:① 不建 todos 直接谎报(拆 0 说做完);
 * ② 标完不做(登记 deferred)。本门禁治第 1 路(最高频):**操作祈使句 + 本轮零写/零委派 + 纯文本非问句收尾**
 * → 回灌「事实清单 + 双出口」让 agent 对着记录复述(没干就没法嘴硬)。
 *
 * 三要素 AND(精度优先宁漏勿误):
 *  ① 用户消息是操作祈使句(动词白名单,首子句动词锚定 + 只读动词反例前置)
 *  ② 本轮零写工具调用(writeCapable 标注口径 + 委派工具 use_html 类与 spawn_agent 计「等效写」——
 *     editor「改代码组件」走 use_html 委派是主场景,不算写会每单烧满回灌预算)
 *  ③ 纯文本收尾且非问句(复用完结门禁句尾正则口径,不用 detectQuestionIntent ——
 *     那是作用于用户消息的三档启发式,查询词档用于收尾文本会误伤「它的用法是…」)
 *
 * 事实清单(fact-sheet,D5):harness 从 state 计算本轮对账单(工具按名计数/成功写入路径/
 * 失败数/todos 完成度),回灌时嵌入 —— 机制供给事实,LLM 对着记录复述,与清单不符无处嘴硬。
 * 只在门禁触发时随回灌注入(成本与嫌疑挂钩),不做每轮强制「完成报告」。
 */

/** 操作动词白名单(命中即视为操作祈使;正则不带锚,但与反例白名单同位置校验) */
const ACTION_VERB_RE = /(改|改掉|改成|修改|更新|加|添加|新增|加上|删|删掉|删除|移除|移|移动|换|替换|调|调整|调换|生成|创建|做|做个|做一个|建|搭建|重建|重新|清空|设置|配置|美化|优化|排版|布置|填充|写入|保存|发布|上线|部署)/

/** 只读动词反例(同位置命中优先于操作动词 —— 「看看这个配置」含「配置」但开头是「看看」) */
const READONLY_VERB_RE = /(看看|看一下|查|查一下|查询|了解|了解下|说说|讲讲|解释|解释下|总结|总结一下|对比|对比一下|确认|确认一下|核对|检查|检查一下|看看有没有|帮我看看|review|Review)/

/** 免操作词(明确声明不需要执行) */
const NO_ACTION_RE = /(不用改|不用动|只是问|只是想问|先别动|先不要|不用写入|不要保存|只是确认|告诉我即可|不用执行)/

/** 委派工具名模式(use_html / use_worker 等预声明子 agent) */
const DELEGATION_TOOL_RE = /^(use_|spawn_agent|spawn_agents)/

/**
 * 判定用户消息是否为「操作祈使句」(纯函数,宁漏勿误):
 *  - 空文本/免操作词 → 非操作
 *  - 只读动词命中(同子句前部)→ 非操作(反例优先)
 *  - 操作动词命中 → 操作
 *  - 都不命中 → 非操作(纯闲聊自然豁免)
 * 锚定语义:取首子句(按 。!?;,\n 切)的前 12 字做窗口 —— 兼顾「帮我优化一下文案」(动词不在首位)
 * 与「总结一下刚才改了什么」(「改」在只读语境后部,首子句窗口是「总结一下刚才改了」—— 只读动词「总结」命中优先)。
 */
export function detectActionImperative(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return false
  if (NO_ACTION_RE.test(t)) return false
  // 问句豁免:「做好了吗/改好了吗」类收尾问句是对状态的确认询问,非操作指令(首子句含「做/改」但语义是问)
  if (/(吗|呢)[?？]?\s*$/.test(t) || /[?？]\s*$/.test(t)) return false
  // 首子句(操作意图几乎总在开头;后文问句/闲聊不改变定性)。切分含全角标点(！？；，team-audit P2:
  // 只配半角时全角逗号常态输入下 16 字窗口退化为整句,只读反例误入 → 真写指令漏拦)
  const firstClause = t.split(/[。！？；，!?;,\n]/)[0] ?? t
  const window = firstClause.slice(0, 16)
  if (READONLY_VERB_RE.test(window)) return false  // 反例优先(同位置只读动词压过操作动词)
  return ACTION_VERB_RE.test(window)
}

/** 轮内工具调用记录(buildTurnFactSheet 的输入;由 createAgent 结果收集循环捕获) */
export interface TurnToolUsage {
  /** 工具名 → 调用次数 */
  counts: Record<string, number>
  /** 成功写入的目标 path 列表(写工具成功时记;整体 set = '(整体)') */
  writePaths: string[]
  /** 失败(含回灌 error)的工具调用次数 */
  failures: number
}

/** 判定本轮是否零「等效写」(写工具 writeCapable 口径 + 委派工具计等效写) */
export function isZeroEffectiveWrite(usage: TurnToolUsage, isWriteTool: (name: string) => boolean): boolean {
  for (const [name, n] of Object.entries(usage.counts)) {
    if (n <= 0) continue
    if (isWriteTool(name)) return false
    if (DELEGATION_TOOL_RE.test(name)) return false  // 委派 = 子 agent 替主写,算「做过」
  }
  return true
}

/**
 * 本轮事实清单(D5 机制供给事实;零 LLM 调用,纯本地统计):
 * `本轮事实:工具调用 read×2, write×0;成功写入路径:无;失败/回灌 0;todos:0/3 完成。`
 */
export function buildTurnFactSheet(usage: TurnToolUsage, todos: { status: string }[] | undefined, isWriteToolName: (name: string) => boolean = () => false): string {
  // 写工具零计数也显式列出(write×0 是门禁触发的核心事实,滤掉会弱化对账效果):
  // counts 只记被调过的工具,零写轮无 write 键 → 对「是写工具却零调用」的名(主写 write)强制补 ×0
  const parts = Object.entries(usage.counts)
    .filter(([name, n]) => n > 0 || isWriteToolName(name))
    .map(([name, n]) => `${name}×${n}`)
  if (usage.counts['write'] === undefined && isWriteToolName('write')) parts.push('write×0')
  const toolPart = parts.length ? parts.join(', ') : '无'
  const writePart = usage.writePaths.length ? usage.writePaths.slice(0, 5).join(', ') + (usage.writePaths.length > 5 ? ` 等 ${usage.writePaths.length} 处` : '') : '无'
  const total = todos?.length ?? 0
  const done = todos?.filter((t) => t.status === 'completed').length ?? 0
  const todoPart = total ? `${done}/${total} 完成` : '无 todos'
  return `本轮事实:工具调用 ${toolPart};成功写入路径:${writePart};失败/回灌 ${usage.failures};todos:${todoPart}。`
}

/** 出口①机械化:收口文本含 jsonPath/组件 id 粗匹配模式 → 视为「已说明位置」,不再二次回灌 */
const LOCATION_MENTION_RE = /(components?\.\d+|child(ren)?\.\d+|[a-zA-Z][a-zA-Z0-9_-]{3,}\.\d+|jsonPath|@ ?"[^"]+"|路径)/

/**
 * 构建回灌文案(双出口 + 事实清单;ask-first):
 * 出口①已说明位置(LOCATION_MENTION_RE 命中)→ 由调用方判定不回灌,本函数不在此判。
 */
export function buildZeroToolFeedback(factSheet: string): string {
  return [
    '⚠️ 这条指令看起来需要改动数据,但本轮没有任何写入或委派操作。',
    `${factSheet}`,
    '如果确实已完成:请在回复中逐项说明改动位置(jsonPath / 组件 id),与上述事实对账;',
    '如果尚未完成:请继续执行(用 write 增量改 / 委派对应子 agent);',
    '如果做不到或需要用户决定:请如实说明原因,不要回复「已完成」。',
  ].join('\n')
}

/** 收口文本是否已含改动位置说明(出口①机械化;D2b) */
export function mentionsLocation(text: string): boolean {
  return LOCATION_MENTION_RE.test(text || '')
}

// ===== status-query-zero-verify-gate(状态询问零核实断言门禁,editor 真实会话 2026-08-21 驱动) =====

/**
 * 状态询问问句(问结果/进度/位置):「写到了哪里/完成了吗」类。答案必须基于实际数据 ——
 * editor 实测:委派失败(keep_external/轮次上限)+ 页面刷新回退后,「写到了哪里」被零工具
 * 凭对话记忆编出整张「✅ 已写入」状态表(resumeNotice 纯提示词管不住 flash,须机制)。
 */
const STATUS_QUERY_RE = /(写到了哪|写到哪|在哪写|什么位置|完成了吗|完成没|做完了吗|做好了|好了吗|搞定了吗|生成了吗|改好了吗|改完了吗|保存了吗|写入了吗|写入了没有|有没有写入|有没有保存|现在的?(页面|数据|状态|内容)|当前(页面|数据|状态)|进度如何|进度怎么样|什么状态)/

/** 回复中的完成态断言词(宣称数据已是目标态) */
const COMPLETION_ASSERT_RE = /(已写入|已保存|已添加|已删除|已修改|已更新|已设置|已生成|已创建|已搭建|已删除|已经写入|已经完成|全部完成|全部搞定)/

/** 判定用户消息是否为「状态询问」(纯函数) */
export function detectStatusQuery(text: string): boolean {
  return STATUS_QUERY_RE.test((text || '').trim())
}

/** 判定回复是否断言完成态(零核实断言的必要条件之一) */
export function assertsCompletion(text: string): boolean {
  return COMPLETION_ASSERT_RE.test(text || '')
}

/** 本轮零工具调用(连 read 都没有 —— 状态断言毫无事实依据;调过任何工具 = 至少核实过,放行) */
export function isZeroToolCalls(usage: TurnToolUsage): boolean {
  return Object.values(usage.counts).every((n) => n <= 0)
}

/** 状态询问零核实断言的回灌文案(先核实再断言;复用事实清单口径) */
export function buildStatusQueryFeedback(factSheet: string): string {
  return [
    '⚠️ 这是关于数据现状的询问,但本轮你没有调用任何工具(含 read)就断言了「已写入/已完成」状态。',
    `${factSheet}`,
    '数据可能已被刷新回退或外部修改,凭对话记忆断言状态不可靠。',
    '请先用 read / list 类工具核实实际数据再据实回答;若实际未写入,如实说明并继续完成,不要凭印象回复「已完成」。',
  ].join('\n')
}

// ===== 过渡性收口 / 行动叙述检测(原 createAgent 纯函数,evidence-audit-gate Phase 0 随 gateChain 抽取迁入本家族) =====

/** 过渡性收口模式:模型中途输出计划性表态就停(实测 deepseek-v4-flash:「好的,我先看看…再委派生成」调研完即收口)。 */
const TRANSITIONAL_RE = /(我先|让我先|我先看|先看看|先了解|先加载|先查阅|稍后|接下来我|我将先|等我|查完.{0,12}再|看完.{0,12}再|了解.{0,8}再)/
/** 完成标记:含这些视为真实收口(总结/汇报),不回灌 */
const DONE_VERB_RE = /(已完成|已生成|已修改|已创建|已添加|已删除|已更新|已调整|已处理|已委派|已配置|已切换|成功|完成[。!?]|搞定了|做好了)/
/**
 * 检测「过程性收口」:本轮已执行过工具(说明任务进行中)但最终文本是过渡性计划表态而非完成汇报 ——
 * 回灌让模型继续执行,防「调研完说稍后就停」(flash 实测:委派编排任务被「我先看看…再委派生成」收口,任务零落地)。
 * 保守判定:短文本(≤160 字)+ 命中过渡模式 + 无完成动词;误判代价仅一轮回灌(有界 ≤2 次)。
 */
export function detectTransitionalReply(content: string): boolean {
  if (!content) return false
  const text = content.trim()
  if (text.length > 160) return false  // 长文多为真总结
  if (DONE_VERB_RE.test(text)) return false
  return TRANSITIONAL_RE.test(text)
}

/** 第 0 轮「行动叙述」模式:点名已知工具 + 第一人称行动动词(实测 flash 粒子任务 2782 字纯叙述)。 */
const NARRATION_TOOL_RE = /(add_component|delete_component|move_component|list_components|select_component|load_skill|use_[a-z]+|rag_[a-z]+|request_human_confirmation|\bwrite\b|\bread\b)/
const NARRATION_VERB_RE = /(我来|让我|我先|现在|开始|先加载|先添加|先写|先删|先看看|执行|添加|写入|加载|删除)/
/**
 * 检测「第 0 轮行动叙述」:首回合纯文本、零 tool_calls,但文本点名工具并表态要执行
 * (「我来添加 / 先加载 page-tools / 用 add_component_tree…」)—— ReAct 见无 tool_calls 会当最终回答结束,
 * 用户看到「我要做…做完了」但零执行(幻觉叙述,实测 deepseek-v4-flash)。
 * 与 detectTransitionalReply 区别:① 不限长度(叙述常为长文)② 不豁免完成动词 —— 第 0 轮没有任何工具执行,
 *   文本里的「已添加/成功」只能是幻觉,反而是叙述的铁证;③ 仅在 rounds===0 且无 tool_calls 时调用(上下文消歧,
 *   真实完成汇报必有 tool_calls 不会落到这里)。误判代价仅一轮回灌(有界 ≤2)。
 */
export function detectActionNarration(content: string): boolean {
  if (!content) return false
  const text = content.trim()
  return NARRATION_TOOL_RE.test(text)
    && NARRATION_VERB_RE.test(text)
}

// ===== evidence-audit-gate A2(锚点核对纯函数,2026-08-23)=====
// 审计面与比对基线见 gateChain.ts「evidence 审计门禁」段;本组只管机械化可判部分:
// evidence 里的 path 形态提取 + 与会话累计写路径集的重叠判定(宁漏勿误:描述性文本零路径形态 → 不核对)。

/** evidence 内嵌 path 形态片段(如「已写入 components.2.title」→ ['components.2.title'])。
 *  归一:`$.`/`$` 前缀剥除、`[0]` → `.0`(对齐 effectiveWritePaths 的点分形态);提取不到多段路径 → 空(描述性证据)。 */
export function extractEvidencePaths(evidence: string): string[] {
  if (!evidence) return []
  const flat = String(evidence).replace(/\$\.?/g, ' ').replace(/\[(\d+)\]/g, '.$1')
  const out: string[] = []
  for (const m of flat.matchAll(/[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*|\.\d+)+/g)) out.push(m[0])
  return [...new Set(out)]
}

/** evidence 路径是否被会话累计写路径覆盖(任一重叠即覆盖;重叠判定复用 stale-read 的 pathsOverlap:
 *  相等/ROOT/祖先-后代 + 分隔符纪律。基线含 ROOT(整体写)= 全覆盖)。 */
export function isEvidenceCovered(evidencePaths: string[], sessionWritePaths: Iterable<string>): boolean {
  const sess = Array.from(sessionWritePaths)
  if (!sess.length) return false
  return evidencePaths.some((ep) => sess.some((sp) => pathsOverlap(ep, sp)))
}
