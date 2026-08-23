/**
 * Planning 中间件 —— write_todos 整表替换 + update_todo 增量 + 规划阶段防死循环
 *
 * 对齐 Deep Agents 的 todoListMiddleware(langchainjs),扩展(add-adaptive-planning):
 *  - write_todos 整表替换 todos(非增量 patch,LLM 易用);项无 id 时框架按 index 生成 t-N
 *  - update_todo({id, content?, status?}) 按 id 增量更新单项(执行中动态修订,不必重传整个清单)
 *  - maxPlanRevisions:计划修订次数上限(防"反复改计划不执行"死循环;只计 write_todos 调用,调研轮不计
 *    —— 调研密集工作流(如 editor 连查 11 轮组件文档)不应耗尽预算,「光调研不执行」由 maxToolRounds 轮次预算兜底),与 maxIterations 总闸正交
 *
 * 工具通过闭包维护 todos + 规划阶段状态;beforeModel 每轮同步进 state(供 UI)。
 * createTodosMiddleware(initialTodos, { maxPlanRevisions }) 支持从持久化恢复注入;reset 运行期可重置。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { Middleware } from './middleware'
import type { Todo, TodoStatus } from './state'

/** 退出规划阶段的主数据写工具(开始执行);eval_script 本期不列入(transform/query 语义混合,见 design §4) */
const PLAN_EXIT_TOOLS = new Set(['write', 'set_data', 'edit_data', 'delete_data'])

/** todos 入参形状(id 可选,框架补全);兼容 write_todos zod 推导类型 / Todo / hydrate 旧数据 */
type TodoInput = { id?: string; content: string; status: TodoStatus; parentId?: string; deps?: string[]; criteria?: string; evidence?: string }

/** 补全 todos 的 id(无 id 的项按 index 生成 t-N);hydrate 旧数据 / write_todos 入参兼容 */
function ensureIds(list: TodoInput[]): Todo[] {
  return list.map((t, i) => ({
    id: t.id || `t-${i + 1}`,
    content: t.content,
    status: t.status,
    ...(t.parentId !== undefined ? { parentId: t.parentId } : {}),
    ...(t.deps !== undefined ? { deps: t.deps } : {}),
    ...(t.criteria !== undefined ? { criteria: t.criteria } : {}),
    ...(t.evidence !== undefined ? { evidence: t.evidence } : {}),
  }))
}

/** 渲染当前 todos 清单为 system prompt 段(带 id 供 LLM 引用 update_todo)。
 *  有 parentId → 递归层级渲染(缩进 + deps ✓/⏳ 阻塞标注 + evidence);无 → 扁平(零破坏)。 */
export function renderTodos(todos: Todo[]): string | undefined {
  if (!todos.length) return undefined
  const hasTier = todos.some((t) => t.parentId || (t.deps && t.deps.length))
  const lines: string[] = []
  if (hasTier) {
    // 层级递归渲染:roots(无 parentId)→ children(parentId 匹配)
    const childrenOf = (pid: string) => todos.filter((t) => t.parentId === pid)
    const statusMark = (id: string) => {
      const t = todos.find((x) => x.id === id)
      return t?.status === 'completed' ? '✓' : '⏳'
    }
    // seen 集循环防护:LLM 误输入成环 parentId(自指 A→A / 互指 A↔B)时跳过已访问节点,防递归栈溢出
    const render = (t: Todo, depth: number, seen: Set<string>) => {
      if (seen.has(t.id)) return
      seen.add(t.id)
      const indent = '  '.repeat(depth)
      const depStr = t.deps?.length ? ` (依赖:${t.deps.map((d) => statusMark(d)).join('')})` : ''
      const evStr = t.evidence ? ` [证据:${t.evidence}]` : ''
      const critStr = t.criteria ? ` [标准:${t.criteria}]` : ''
      lines.push(`${indent}- #${t.id} [${t.status}] ${t.content}${critStr}${depStr}${evStr}`)
      childrenOf(t.id).forEach((c) => render(c, depth + 1, seen))
    }
    todos.filter((t) => !t.parentId).forEach((t) => render(t, 0, new Set()))
  } else {
    // 扁平渲染(无层级,现状)
    todos.forEach((t, i) => {
      const evStr = t.evidence ? ` [证据:${t.evidence}]` : ''
      lines.push(`${i + 1}. #${t.id} [${t.status}] ${t.content}${evStr}`)
    })
  }
  const rule = hasTier
    ? '规则:write_todos 拆解(可带 parentId 表达层级、deps 表达依赖);有依赖的任务,deps 全 completed 后再标 in_progress;完成一个立即 update_todo({id, status:"completed"})。注意:write_todos(整表替换)与 update_todo(增量)不可同轮混用;批量标多个完成建议一次 write_todos 传完整数组(全 completed),不必逐个 update_todo。'
    : '规则:开始前用 write_todos 拆解;首个任务标 in_progress;完成一个立即 update_todo({id, status:"completed"}) 标完成(不必重传整个清单);保持至少一个 in_progress 直到全部完成。注意:write_todos(整表替换)与 update_todo(增量)不可同轮混用;批量标多个完成建议一次 write_todos 传完整数组(全 completed),不必逐个 update_todo。'
  return [
    '## 当前任务清单(write_todos 整表替换 / update_todo 按 id 增量改单项)',
    lines.join('\n'),
    rule,
  ].join('\n')
}

/** 完结门禁判定(instruction-adherence A):模型欲以纯文本收尾但 todos 仍有未完成项 → true(循环层回灌续跑)。
 *  豁免(宁漏勿误):① todos 为空(未规划的任务不拦)② 全 completed ③ 收尾文本以问号结尾
 *  (agent 在向用户征询输入,如「要保留哪个方案?」,拦截会破坏交互节奏)。 */
export function detectIncompleteFinish(todos: Todo[], finalContent: string): boolean {
  if (!todos.length) return false
  if (!todos.some((t) => t.status !== 'completed')) return false
  if (/[?？]\s*$/.test(finalContent)) return false
  return true
}

/** 完结门禁回灌文案:双出口 ——「活干完但忘 update_todo」是高频真实场景(flash 实测),
 *  只喊「继续执行」会逼模型把已完成的活再干一遍,故给「已完成→标记 / 未完成→继续」两条路。
 *  列未完成项 id+content(单项截断 60 字防超长)让模型精确定位。
 *  evidence-audit-gate A1 rider(2026-08-23):同时列「已完成但 evidence 为空」项 —— 只搭本回灌的车,
 *  不新增触发/预算(引导与机制同 ship,见 usageHints evidence 段)。 */
export function buildGateFeedback(todos: Todo[]): string {
  const pending = todos.filter((t) => t.status !== 'completed')
  const lines = pending.map((t) => `#${t.id} [${t.status}] ${t.content.length > 60 ? `${t.content.slice(0, 60)}…` : t.content}`).join('\n')
  const noEvidence = todos.filter((t) => t.status === 'completed' && !t.evidence)
  const rider = noEvidence.length
    ? `\n另有 ${noEvidence.length} 项已标记完成但 evidence 为空(${noEvidence.map((t) => `#${t.id}`).join('、')}):标记完成时请用 update_todo 附 evidence(本次实际写入的 jsonPath,如 components.2);经委派完成等无主写路径时如实写明完成方式。`
    : ''
  return `⚠️ 任务未完成:待办清单还有 ${pending.length} 项未完成:\n${lines}\n若这些工作实际已完成,请先用 update_todo 把它们全部标记 completed(或一次 write_todos 整表替换)再给出最终总结;若尚未完成,请继续执行剩余任务。不要中途停止。${rider}`
}

export interface TodosMiddlewareOptions {
  /** 计划修订次数上限(默认 5;只计 write_todos 调用,调研轮不计);planning 状态下超限 → 改计划形态的调用回灌提示(不强制终止,maxIterations 兜底) */
  maxPlanRevisions?: number
}

export function createTodosMiddleware(
  initialTodos: Todo[] = [],
  opts: TodosMiddlewareOptions = {},
): Middleware & {
  reset: (todos: Todo[]) => void
  /** rounds = 计划修订次数(write_todos 调用数,调研轮不计);键名保留 rounds 兼容既有 inspect 反射面 */
  getPlanPhase: () => { inPlanning: boolean; rounds: number; limit: number }
} {
  let todos: Todo[] = ensureIds(initialTodos)
  let writeTodosThisRound = 0
  let updateTodosThisRound = 0
  // 规划阶段防死循环状态机(与 maxIterations 总闸正交):首次 write_todos 进入,主数据写工具成功退出。
  // 计数只算「计划修订次数」(write_todos 调用)不算调研轮 —— 旧版 beforeModel 每轮 +1(含调研轮),
  // editor 实测(2026-08-22 诊断)连查 11 轮组件文档即超限,update_todo 状态推进被误拒 ×3;
  // 「光调研不执行」改由 maxToolRounds 轮次预算(3.43 两档提示)兜底,此处只防「反复改计划」
  let inPlanning = false
  let planRevisions = 0
  const maxPlanRevisions = opts.maxPlanRevisions ?? 5

  const writeTodosTool = tool(
    async ({ todos: input }) => {
      // 规划阶段预算:首次进入;已进入且修订次数超限 → 回灌不执行(防反复改计划不执行)
      if (!inPlanning) {
        inPlanning = true
        planRevisions = 1
      } else {
        planRevisions++
        if (planRevisions > maxPlanRevisions) {
          return `规划阶段已达上限(${maxPlanRevisions} 次修订,现在已是第 ${planRevisions} 版计划)。停止修订,基于当前清单开始执行(用 write 落地;advanced 模式亦可用 set_data/edit_data)。当前清单:\n${todos.map((t, i) => `${i + 1}. #${t.id} [${t.status}] ${t.content}`).join('\n') || '(空)'}`
        }
      }
      todos = ensureIds(input)
      return `已更新任务清单:${todos.length} 项\n${todos.map((t, i) => `${i + 1}. #${t.id} [${t.status}] ${t.content}`).join('\n')}`
    },
    {
      name: 'write_todos',
      description:
        '更新(整表替换)任务清单。用于多步任务的拆解与进度跟踪。每次传入完整的 todos 数组(状态 pending/in_progress/completed),不要增量 patch——增量改单项用 update_todo。',
      schema: z.object({
        todos: z
          .array(
            z.object({
              id: z.string().optional().describe('任务 id(可选;不传框架自动生成 t-1/t-2...)'),
              content: z.string().describe('任务描述'),
              status: z.enum(['pending', 'in_progress', 'completed'] as const satisfies TodoStatus[]),
              parentId: z.string().optional().describe('父任务 id(表达层级;structured-todos-tier)'),
              deps: z.array(z.string()).optional().describe('依赖的任务 id 数组(必须先完成)'),
              criteria: z.string().optional().describe('完成标准(可选)'),
              evidence: z.string().optional().describe('完成证据(标 completed 建议附实际写入的 jsonPath,如 components.2)'),
            }),
          )
          .describe('完整的任务清单(整表替换)'),
      }),
    },
  )

  const updateTodoTool = tool(
    async ({ id, content, status, parentId, deps, criteria, evidence }) => {
      // planning 状态下超限 → 只拒「改计划形态」(content/parentId/deps/criteria,防用 update_todo 绕过修订上限);
      // status/evidence 是执行进度跟踪,放行(editor 实测:调研 11 轮后标 t2 completed 被误拒,状态机断拍)
      if (
        inPlanning && planRevisions > maxPlanRevisions &&
        (content !== undefined || parentId !== undefined || deps !== undefined || criteria !== undefined)
      ) {
        return `规划阶段已达上限(${maxPlanRevisions} 次修订,现在已是第 ${planRevisions} 版计划)。停止修订计划内容(改任务文本/层级/依赖);status/evidence 进度跟踪可继续,或基于当前清单开始执行。当前任务 id:${todos.map((t) => t.id).join(', ') || '(空)'}`
      }
      const idx = todos.findIndex((t) => t.id === id)
      if (idx < 0) {
        return `错误:找不到 id="${id}" 的任务(TODO_NOT_FOUND)。当前任务 id:${todos.map((t) => t.id).join(', ') || '(空)'}`
      }
      if (content !== undefined) todos[idx].content = content
      if (status !== undefined) todos[idx].status = status
      if (parentId !== undefined) todos[idx].parentId = parentId
      if (deps !== undefined) todos[idx].deps = deps
      if (criteria !== undefined) todos[idx].criteria = criteria
      if (evidence !== undefined) todos[idx].evidence = evidence
      return `已更新任务 #${id}:[${todos[idx].status}] ${todos[idx].content}`
    },
    {
      name: 'update_todo',
      description:
        '按 id 增量更新单个任务(改 content/status,不必重传整个清单)。id 见当前任务清单渲染(如 t-1)。执行中动态修订步骤用此工具;与 write_todos 不可同轮调用。',
      schema: z.object({
        id: z.string().describe('目标任务 id(见当前任务清单)'),
        content: z.string().optional().describe('新任务描述(不传则不改)'),
        status: z.enum(['pending', 'in_progress', 'completed'] as const satisfies TodoStatus[]).optional().describe('新状态(不传则不改)'),
        parentId: z.string().optional().describe('父任务 id(改层级;不传则不改)'),
        deps: z.array(z.string()).optional().describe('依赖任务 id 数组(不传则不改)'),
        criteria: z.string().optional().describe('完成标准(不传则不改)'),
        evidence: z.string().optional().describe('完成证据(标 completed 建议附实际写入的 jsonPath,如 components.2;不传则不改)'),
      }),
    },
  )

  const mw: Middleware & {
    reset: (todos: Todo[]) => void
    getPlanPhase: () => { inPlanning: boolean; rounds: number; limit: number }
  } = {
    name: 'todos',
    tools: [writeTodosTool, updateTodoTool],
    beforeAgent: () => ({ todos }),
    beforeModel: () => {
      writeTodosThisRound = 0
      updateTodosThisRound = 0
      return { todos } // 同步闭包 todos 进 state(修订计数在 write_todos 内维护,调研轮不计)
    },
    augmentPrompt: () => renderTodos(todos),
    wrapToolCall: async (ctx, next) => {
      // 规则:write_todos(整表替换)与 update_todo(增量改单项)不可同轮混用(语义冲突);
      // 多 write_todos 拒(末次覆盖前者,无意义);多 update_todo 放行(幂等独立,收尾批量标完成是常态)。
      if (ctx.name === 'write_todos' || ctx.name === 'update_todo') {
        if (ctx.name === 'write_todos') writeTodosThisRound++
        else updateTodosThisRound++
        if (writeTodosThisRound > 1) {
          return {
            content: '错误:write_todos(整表替换)不应在一轮中调用多次(末次覆盖前者,无意义)。一次传完整数组即可。',
            status: 'error' as const,
          }
        }
        if (writeTodosThisRound > 0 && updateTodosThisRound > 0) {
          return {
            content: '错误:write_todos(整表替换)与 update_todo(增量改单项)不应在一轮中混用,语义冲突。请只选一种:write_todos 传完整数组,或 update_todo 逐个改。',
            status: 'error' as const,
          }
        }
      }
      const result = await next(ctx)
      // 主数据写工具成功 → 退出规划阶段(开始执行了)
      if (PLAN_EXIT_TOOLS.has(ctx.name) && result?.status !== 'error') {
        inPlanning = false
        planRevisions = 0
      }
      return result
    },
    // 运行期重置(持久化恢复 / checkpoint restore 由 createChatSdk 注入 snap.todos)
    reset: (next: Todo[]) => {
      todos = ensureIds(next.map((t) => ({ ...t })))
      inPlanning = false
      planRevisions = 0
    },
    getPlanPhase: () => ({ inPlanning, rounds: planRevisions, limit: maxPlanRevisions }),
  }
  return mw
}
