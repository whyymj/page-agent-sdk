import { pathsOverlap, effectivePageReadTools } from './readInvalidation'

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

/** 示例请求词(首子句窗口级豁免,B4 flow 审计 #4,2026-09-09):「给一个添加组件的示例」类文本请求
 *  首子句 16 字窗口命中操作动词但用户要的是示例产出非数据操作,模型纯文本作答是正确行为。
 *  只在首子句窗口判(非全文):「把标题改成红色,参考第二个示例」的「示例」在后部 → 不豁免照常命中
 *  (全文级会把句尾提一嘴示例的真操作指令也豁免掉,漏判面大一档) */
const EXAMPLE_REQUEST_RE = /(示例|例子|示范|样例)/

/** 委派工具名模式(use_html / use_worker 等预声明子 agent) */
export const DELEGATION_TOOL_RE = /^(use_|spawn_agent|spawn_agents)/

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
  // 问句豁免:「做好了吗/改好了吗」类收尾问句是对状态的确认询问,非操作指令(首子句含「做/改」但语义是问)。
  // 尾语气词补「么/嘛」(2026-09-02,nested-demo 实测):「你能修改嵌套层级么」修前被判祈使 →
  // 零工具门禁接着 transitional 发难,问句答案被二次回灌。不用 detectQuestionIntent 整分类器 ——
  // 查询词档会把「看看有哪些组件然后加一个」类复合祈使也豁免掉,零工具门禁漏拦
  if (/(吗|呢|么|嘛)[?？]?\s*$/.test(t) || /[?？]\s*$/.test(t)) return false
  // 首子句(操作意图几乎总在开头;后文问句/闲聊不改变定性)。切分含全角标点(！？；，team-audit P2:
  // 只配半角时全角逗号常态输入下 16 字窗口退化为整句,只读反例误入 → 真写指令漏拦)
  const firstClause = t.split(/[。！？；，!?;,\n]/)[0] ?? t
  const window = firstClause.slice(0, 16)
  if (READONLY_VERB_RE.test(window)) return false  // 反例优先(同位置只读动词压过操作动词)
  if (EXAMPLE_REQUEST_RE.test(window)) return false  // 示例请求(要的是示例产出,非数据操作)
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
  /** 被拒委派计数(4.9.1 ③:委派工具返回 ERROR: 回灌的次数 —— COMPONENT_BUSY/COMPONENT_LOCKED 等,
   *  实际零写入不算等效写,但事实清单须如实呈现防「零工具」假话) */
  rejectedDelegations?: Record<string, number>
}

/**
 * 判定本轮是否零「等效写」(写工具 writeCapable 口径 + 委派工具计等效写)。
 * 委派被拒(全量返回 ERROR: 回灌,如组件锁 COMPONENT_BUSY)不算等效写 —— 修前 use_html×1 被锁拒后
 * 模型「已完成」收口溜过门禁;修后照常回灌对账。部分成功(批内至少一次非拒)仍算「做过」。
 */
export function isZeroEffectiveWrite(usage: TurnToolUsage, isWriteTool: (name: string) => boolean): boolean {
  for (const [name, n] of Object.entries(usage.counts)) {
    if (n <= 0) continue
    if (isWriteTool(name)) return false
    if (DELEGATION_TOOL_RE.test(name)) {
      const rejected = usage.rejectedDelegations?.[name] ?? 0
      if (n - rejected > 0) return false  // 委派 = 子 agent 替主写,算「做过」;全被拒不算
    }
  }
  return true
}

/**
 * 本轮事实清单(D5 机制供给事实;零 LLM 调用,纯本地统计):
 * `本轮事实:工具调用 read×2, write×0;成功写入路径:无;失败/回灌 0;todos:0/3 完成。`
 */
export function buildTurnFactSheet(usage: TurnToolUsage, todos: { status: string }[] | undefined, isWriteToolName: (name: string) => boolean = () => false, deferredWriteTools?: Set<string>): string {
  // 写工具零计数也显式列出(write×0 是门禁触发的核心事实,滤掉会弱化对账效果):
  // counts 只记被调过的工具,零写轮无 write 键 → 对「是写工具却零调用」的名(主写 write)强制补 ×0
  const parts = Object.entries(usage.counts)
    .filter(([name, n]) => n > 0 || isWriteToolName(name))
    .map(([name, n]) => {
      const rej = usage.rejectedDelegations?.[name] ?? 0
      // 被拒委派如实标注(4.9.1 ③:门禁触发时清单不说「零工具」假话,给模型对账真事实)
      if (rej > 0 && DELEGATION_TOOL_RE.test(name)) return `${name}×${n}(其中 ${rej} 次被拒未生效,如组件锁 COMPONENT_BUSY)`
      // 提案类 action 注记(action-host-semantics D):调用成功 ≠ 已写入,防「已修改完成」嘴硬 ——
      // 事实面供给「待用户确认后才生效」,模型收口须与之对账;未标记/未调用时零文本差(逐字节一致)
      if (deferredWriteTools?.has(name)) return `${name}×${n}(提案类,待用户确认后才生效,尚未写入)`
      return `${name}×${n}`
    })
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
    '如果委派被组件锁拒绝(COMPONENT_BUSY/COMPONENT_LOCKED):说明在途委派占用,等其结束后重试,勿谎称已完成;',
    '如果做不到或需要用户决定:请如实说明原因,不要回复「已完成」。',
  ].join('\n')
}

/** 收口文本是否已含改动位置说明(出口①机械化;D2b) */
export function mentionsLocation(text: string): boolean {
  return LOCATION_MENTION_RE.test(text || '')
}

// ===== 诚实未做声明豁免(出口③机械化,2026-09-09)=====

/**
 * 否定完成态词(「否定前缀 + 有界间隔 + 动词」模式,容纳自然表述:「未对数据做任何修改」「已按要求停止」):
 * 模型自己声明「没做」(未修改/已停止/无法完成…)。谎报面 = 声称做了;声称没做恰是出口③「如实说明」
 * 的正确执行 —— 修前 RHC 拒绝场景实测:用户拒绝方案后模型诚实收口「已停止,未做任何修改」,仍被回灌 ×2
 * 烧满预算 + 误报 ZERO_TOOL_GATE_EXHAUSTED(deferred 登记)。收口同时含完成态断言词(「此前未更新,
 * 现已修复」类)时不豁免 —— 混合声明按谎报嫌疑走对账。
 */
const HONEST_DECLINE_RE = /(未|没有|暂未|暂不|尚未)[^。!?!?,,\n]{0,10}(修改|更改|改动|改变|写入|执行|操作|创建|新增|添加|删除|保存|更新|变更|做任何|动过)|已[^。!?!?,,\n]{0,6}(停止|取消|放弃|中止)|(保持|维持)(原样|不动|不变|现状)|无法(完成|执行|修改|做到)|做不到|未能完成/

/** 完成态断言的对称模式(审查补:COMPLETION_ASSERT_RE 词面窄〔缺「已完成」最常用形〕且两处消费方向不同 ——
 *  status_query 闸漏判只是少触发,本豁免漏判 = 谎报溜过出口;剥除否定语句后的剩余文本用本模式查混合声明) */
const SOFT_COMPLETION_RE = /已[^。!?!?,,\n]{0,8}(完成|修改|改|写入|创建|新增|添加|删除|保存|更新|配置|生成|搭建|处理|修复|尝试|搞定)/

/** 判定收口文本是否为「诚实未做声明」(纯函数;zero_tool 门禁与 EXHAUSTED observable 共用) */
export function declaresNoAction(text: string): boolean {
  const t = (text || '').trim()
  if (!t) return false
  if (!HONEST_DECLINE_RE.test(t)) return false
  // 混合完成态声明不豁免:先剥掉否定未做语句,剩余文本仍含完成态断言 → 按谎报嫌疑走对账
  // (「组件A已完成修改,组件B未修改」= 部分谎报;剥除防误伤纯拒绝表述「已按要求停止生成」——
  //  剥掉「已按要求停止」后剩余「生成」无完成态前缀,豁免成立)
  const remainder = t.replace(HONEST_DECLINE_RE, '。')
  return !COMPLETION_ASSERT_RE.test(remainder) && !SOFT_COMPLETION_RE.test(remainder)
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

// ===== 提案待确认豁免(proposals 真机 dump 2026-09-23 驱动) =====
// propose_content 收口已如实说「提案已送到评审面板,待你确认」,零工具门禁仍回灌 ×2 —— 逼出的只是
// 一段「对账:」轻度冗余 + 每次多烧 1 轮 LLM。豁免三条件 AND(反向保护:嘴硬「已写入」不豁免):
// ① 本轮唯一「写向」动作是提案类工具(deferredWriteTools 在场且确有调用);
// ② 收口文本明确披露待确认语义;③ 无硬写入完成断言。
// 注意硬断言用窄集(不复用 COMPLETION_ASSERT_RE):提案收口合法说「已生成提案」(生成确实发生了),
// 宽集会误杀豁免;只拦「已写入/已保存/已应用」这类与「待确认」直接冲突的数据态断言。
const PENDING_DISCLOSE_RE = /(待(你|用户)?(确认|评审|审核|批准)|尚未写入|未写入|才会写入|保持原样)/
const HARD_WRITE_CLAIM_RE = /(已(写入|保存|应用)|写入(了|到)(文档|笔记|正文|文件)|已插入(文档|笔记|正文))/

/**
 * 判定收口文本是否为「提案待确认的如实披露」(纯函数;zero_tool 门禁与 EXHAUSTED observable 共用)。
 * 宁漏勿误方向:任一条件不成立 → 返回 false → 门禁照常回灌(多烧 1 轮的代价 < 谎报溜过的代价)。
 */
export function declaresDeferredPending(content: string, usage: TurnToolUsage, deferredWriteTools?: Set<string>): boolean {
  if (!deferredWriteTools?.size) return false
  const hasDeferredCall = Object.entries(usage.counts).some(([name, n]) => n > 0 && deferredWriteTools.has(name))
  if (!hasDeferredCall) return false
  const t = content || ''
  if (!PENDING_DISCLOSE_RE.test(t)) return false
  // 混合硬断言不豁免:「已写入…(另)待确认」自相矛盾 → 按谎报嫌疑走对账;
  // 窄集放行「已生成提案」(生成属实,写的部分已披露待确认)
  return !HARD_WRITE_CLAIM_RE.test(t)
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

// ===== page-assertion-zero-basis-gate(S3 页面断言零依据门禁,host-integration-contract)=====
// 「页面对答」场景的头号失效模式:回复声称「本页/原文/笔记里写了…」但本轮连 read_page 都没调 ——
// 编造页面内容零机制覆盖(学习门户实测:强提示词管得住是模型自觉,非机制保证;项目哲学「纪律靠机制」)。
// 三要素 AND(宁漏勿误);装配面 = 仅 capabilities.domInspect 开启(gateChain 输入 flag,17b 用户拍板:
// 数据槽场景「页面上已改成…」会被误伤的路从结构上切断,不新增配置项)。

/** 页面指称词(指向宿主页面/文档内容的名词) */
const PAGE_REFERENCE_RE = /(本页|此页|当前页|该页|原文|文章里?|文章中|笔记里?|笔记中|文档里?|文档中|页面上|页面里|文中|正文里?|正文中|这一节|该节|上一节|下一节|前文|后文)/

/** 页面内容断言句式(把内容归属于页面的动词:页面「写了/提到/说明」) */
const PAGE_ASSERTION_VERB_RE = /(写到|写了|说[了到]|提[及到]|说明|介绍|讲解|讲[了到]|阐述|指出|强调|讨论|描述|定义|解释|总结|出现在|位于|列[出了]|给[出了])/


/** 页面不存在声明(「本页没有提到」= 正确行为,豁免;与 declaresNoAction 的「未修改」族互补) */
const PAGE_ABSENCE_DECL_RE = /(没有|未|无|不含|查无|找不到)[^。!?!?,,;;\n]{0,12}(提到|写|说明|介绍|讲解|涉及|出现|包含|涵盖|讨论|定义)|不在(本页|此页|文中|正文|这篇|该页)/


/** agent 自述动作标记(子句含「已把/我来添加」类时,句中的「文档/说明」是操作对象非页面断言 —— 排除) */
const AGENT_ACTION_CLAUSE_RE = /(已(把|将|经把)|(我|咱们)(来|已经?|先)?(把|将|添加|修改|删除|写入|创建|设置|生成)|write\(|read\(|set_focus)/

/**
 * 判定回复是否含「对页面内容的断言」(纯函数,精度优先):
 * 子句级共现 —— 同一子句里页面指称词 × 断言句式,且该子句不是 agent 自述动作(「已把文档标题改成“说明”」
 * 的「文档/说明」是操作对象,非「页面写了什么」的归属断言)。全文级 absence 声明豁免。
 */
export function detectPageAssertion(content: string): boolean {
  const t = (content || '').trim()
  if (!t) return false
  if (PAGE_ABSENCE_DECL_RE.test(t)) return false
  for (const clause of t.split(/[。!?!?;;\n]/)) {
    if (!clause) continue
    if (AGENT_ACTION_CLAUSE_RE.test(clause)) continue
    if (PAGE_REFERENCE_RE.test(clause) && PAGE_ASSERTION_VERB_RE.test(clause)) return true
  }
  return false
}

/**
 * 本轮是否零「页面依据」(纯函数):页面读类工具(read_page/dom_search/dom_info/get_dom/
 * **take_screenshot** —— A2 口径:看过截图也算看过页面)任一被调即有依据。
 * 与 S2 的交互(A4):占位替换不改变 counts → S3 判据不被 S2 掩盖/虚增。
 */
export function isZeroPageBasis(usage: TurnToolUsage, extraTools?: Set<string>): boolean {
  const tools = effectivePageReadTools(extraTools)
  for (const [name, n] of Object.entries(usage.counts)) {
    if (n > 0 && tools.has(name)) return false
  }
  return true
}

/** 页面断言零依据的回灌文案(先读再断言 + 事实清单 + 双出口) */
export function buildPageAssertionFeedback(factSheet: string): string {
  return [
    '⚠️ 你的回复断言了页面/文档的内容(如「本页写了/原文提到…」),但本轮没有调用任何页面读取工具(read_page / dom_search / dom_info / get_dom / take_screenshot)。',
    `${factSheet}`,
    '页面内容可能与你的印象不同(宿主页面可能已变更),凭记忆断言页面内容不可靠。',
    '请先 read_page 读取当前页面,基于读到的实际内容回答;',
    '若页面确实没有相关内容:如实回答「本页没有提到」,不要编造;',
    '若问题与页面内容无关:请去掉对页面内容的断言,按问题本身回答。',
  ].join('\n')
}
