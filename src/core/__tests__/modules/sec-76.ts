/**
 * sec-76:agent 自感知预算(context-economy-phase2 阶段 C)
 * C1 消耗提示(轮次 70% / token softCap 半程触发,每任务一次)+ C2 写失败计数注入
 * + todos 计划版次计数前缀 + extractWriteTargetPath 纯函数。
 */
import type { TestCtx } from './_ctx'
import { createUsageHintsMiddleware } from '../../harness/usageHints'
import { createTodosMiddleware } from '../../harness/todos'
import { extractWriteTargetPath } from '../../harness/createAgent'
import type { HarnessState, LoopProgress } from '../../harness/state'

/** 构造带 loopProgress 的最小 state(augmentPrompt 只读 loopProgress + caps 开关) */
function stateWith(progress: Partial<LoopProgress>): HarnessState {
  return {
    loopProgress: {
      rounds: 0,
      maxToolRounds: 10,
      invokeUsage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      writeFailures: {},
      budgetHinted: false,
      ...progress,
    },
  } as unknown as HarnessState
}

export async function run(ctx: TestCtx) {
  const { assert, invoke } = ctx

  // ===== C1:轮次维度已移交 createAgent 核心(3.43)——usageHints 不再注入轮次提示 =====
  {
    // 2026-08-22 editor 诊断实证缺陷:token 触发(大上下文早触发)消耗掉一次性 budgetHinted,
    // 轮次维度(真正吃紧时)被饿死从未注入 → 轮次维度移交核心 roundBudgetHintText(持续注入 + 两档升级,
    // 见 sec-80);此处轮次再多也不注入(无 softCap 配置时 token 维度同样不触发)
    const mw = createUsageHintsMiddleware(undefined, false, { promptSoftCap: Number.POSITIVE_INFINITY })
    const s = stateWith({ rounds: 7, maxToolRounds: 10 })
    const out = (mw.augmentPrompt as (st: HarnessState) => string | undefined)(s) ?? ''
    assert(!out.includes('预算提示'), '✓ C1 轮次维度移交核心 → usageHints 轮次 ≥70% 不再注入(由 roundBudgetHintText 持续承担)')
    const out2 = (mw.augmentPrompt as (st: HarnessState) => string | undefined)(s) ?? ''
    assert(!out2.includes('预算提示'), '✓ C1 轮次维度移交核心 → 重复渲染同样不注入')
  }

  // ===== C1:token 维度(累计 ≥ softCap/2)触发 + 一次性;无 softCap 配置不触发 =====
  {
    const mwCap = createUsageHintsMiddleware(undefined, false, { promptSoftCap: 160_000 })
    const s = stateWith({ rounds: 1, maxToolRounds: 10, invokeUsage: { prompt_tokens: 90_000, completion_tokens: 0, total_tokens: 90_000 } })
    const out = (mwCap.augmentPrompt as (st: HarnessState) => string | undefined)(s) ?? ''
    assert(out.includes('预算提示') && out.includes('90K'), '✓ C1 预算提示 → 累计 ≥ softCap/2(90K/160K)注入(token 维度保留)')
    const outAgain = (mwCap.augmentPrompt as (st: HarnessState) => string | undefined)(s) ?? ''
    assert(!outAgain.includes('预算提示'), '✓ C1 预算提示 → 每任务只注入一次(budgetHinted 置位后不重复)')
    const mwNoCap = createUsageHintsMiddleware(undefined, false)
    const out2 = (mwNoCap.augmentPrompt as (st: HarnessState) => string | undefined)(stateWith({ rounds: 1, maxToolRounds: 10, invokeUsage: { prompt_tokens: 90_000, completion_tokens: 0, total_tokens: 90_000 } })) ?? ''
    assert(!out2 || !out2.includes('预算提示'), '✓ C1 预算提示 → 未配 softCap 时 token 维度不触发')
  }

  // ===== C2:写失败计数 ≥2 注入提醒;清零后不注入 =====
  {
    const mw = createUsageHintsMiddleware(undefined, false)
    const out = (mw.augmentPrompt as (st: HarnessState) => string | undefined)(stateWith({ rounds: 1, writeFailures: { 'components.0': 2, '': 3 } })) ?? ''
    assert(out.includes('连续写失败') && out.includes('components.0×2') && out.includes('(整体)×3'), '✓ C2 写失败提醒 → ≥2 次路径注入(含整体根路径)')
    const out2 = (mw.augmentPrompt as (st: HarnessState) => string | undefined)(stateWith({ rounds: 1, writeFailures: { 'components.0': 1 } })) ?? ''
    assert(!out2 || !out2.includes('连续写失败'), '✓ C2 写失败提醒 → 计数 1(<2)不注入')
  }

  // ===== extractWriteTargetPath 纯函数(计数聚合键)=====
  assert(extractWriteTargetPath({ jsonPath: 'components.0.title' }) === 'components.0.title', '✓ extractWriteTargetPath → jsonPath 直传')
  assert(extractWriteTargetPath({ patch: { op: 'set', jsonPath: 'theme', value: 1 } }) === 'theme', '✓ extractWriteTargetPath → patch.jsonPath(write 增量)')
  assert(extractWriteTargetPath({ patches: [{ op: 'set', jsonPath: 'a.b' }, { op: 'set', jsonPath: 'c' }] }) === 'a.b', '✓ extractWriteTargetPath → patches 首个 jsonPath(write 批量)')
  assert(extractWriteTargetPath({ value: { a: 1 } }) === '', '✓ extractWriteTargetPath → 整体 set 归根路径(空串)')
  assert(extractWriteTargetPath(null) === '', '✓ extractWriteTargetPath → null 安全返回根')

  // ===== C3:todos 超限回灌含「第 N 版计划」计数(3.44 语义:只计 write_todos 修订,调研轮不计) =====
  {
    const mw = createTodosMiddleware([], { maxPlanRevisions: 2 })
    const tools = mw.tools as any[]
    const writeTodos = tools.find((t) => t.name === 'write_todos')
    const updateTodo = tools.find((t) => t.name === 'update_todo')
    // 修订 1(v1)→ 修订 2(v2 = limit)→ 修订 3(v3 > 2)超限
    await invoke(writeTodos, { todos: [{ content: 'A', status: 'pending' }, { content: 'B', status: 'pending' }] })
    await invoke(writeTodos, { todos: [{ content: 'A', status: 'in_progress' }, { content: 'B', status: 'pending' }] })
    // 中间穿插调研轮(beforeModel)不计入 —— 旧版在此就会把计数抬过限
    ;(mw as any).beforeModel()
    ;(mw as any).beforeModel()
    const r = await invoke(writeTodos, { todos: [{ content: 'C', status: 'pending' }] })
    assert(/第 3 版计划/.test(String(r)), '✓ C3 计划版次 → 修订超限回灌含「第 3 版计划」计数(write_todos)')
    // 超限后 update_todo 改计划形态(content)→ 回灌含计数;纯 status 进度跟踪放行
    const r2 = await invoke(updateTodo, { id: 't-1', content: '改文本' })
    assert(/第 3 版计划/.test(String(r2)), '✓ C3 计划版次 → 超限后 update_todo 改 content → 回灌含计数(防绕过)')
    const r3 = await invoke(updateTodo, { id: 't-1', status: 'completed' })
    assert(!/第 3 版计划/.test(String(r3)) && /已更新任务/.test(String(r3)), '✓ C3 计划版次 → 超限后 update_todo 纯 status → 放行(进度跟踪不受限)')
  }
}
