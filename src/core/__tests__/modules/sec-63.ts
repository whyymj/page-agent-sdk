/**
 * sec-63:agent-driven-compression Phase B(inspect_context 工具)
 * 数据源组合(totalTokens/rounds/categories)+ 参数裁剪(path/role/limit)+ 降级(无 snapshot/contextWindow)+ 硬上限。
 */
import type { TestCtx } from './_ctx'
import { createInspectContextTool } from '../../sdk/inspectContextTool'
import type { ContextSnapshot } from '../../utils/contextAnalysis'
import type { AgentMessage } from '../../types'

/* eslint-disable @typescript-eslint/no-explicit-any */
const msg = (role: string, content: string, steps?: any[]): AgentMessage =>
  ({ role, content, timestamp: 0, steps }) as AgentMessage
function makeRounds(n: number, withTools = false): AgentMessage[] {
  const arr: AgentMessage[] = []
  for (let i = 0; i < n; i++) {
    arr.push(msg('user', `第${i}个问题详情`))
    arr.push(msg('assistant', `第${i}个回复详情`, withTools ? [{ name: 'read' }, { name: 'write' }] : undefined))
  }
  return arr
}
const stubSnap = {
  totalTokens: 1000,
  contextWindow: 2000,
  occupancy: 0.5,
  thresholdRatio: 0.5,
  categories: [
    { key: 'systemPrompt', label: '系统', tokens: 300, pct: 0.3, msgCount: 1 },
    { key: 'toolResults', label: '工具', tokens: 500, pct: 0.5, msgCount: 5 },
    { key: 'history', label: '历史', tokens: 200, pct: 0.2, msgCount: 4 },
  ],
} as ContextSnapshot

async function call(tool: any, args: Record<string, unknown>): Promise<any> {
  const res = await tool.invoke(args)
  const content = typeof res === 'string' ? res : res?.content ?? JSON.stringify(res)
  return JSON.parse(content)
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  const tool = createInspectContextTool({
    getMessages: () => makeRounds(3, true),
    getSnapshot: () => stubSnap,
    contextWindow: 2000,
  })

  // ===== 无参全量 =====
  const r0 = await call(tool, {})
  assert(r0.totalTokens > 0, '✓ inspect_context 无参 → totalTokens > 0(rounds 估算)')
  assert(r0.rounds.length === 3, '✓ inspect_context → rounds 含全部 3 轮')
  assert(r0.rounds[0].round === 1 && typeof r0.rounds[0].tokens === 'number', '✓ inspect_context → rounds 每项含 round/tokens')
  assert(r0.rounds[0].tools.length === 2 && r0.rounds[0].tools[0] === 'read', '✓ inspect_context → rounds 含工具步骤名(read/write)')
  assert(typeof r0.rounds[0].head === 'string' && r0.rounds[0].head.length > 0, '✓ inspect_context → rounds 含 head 首句')
  assert(r0.categories.length === 3, '✓ inspect_context → categories 复用 snapshot 全 3 项')
  assert(Math.abs(r0.occupancy - r0.totalTokens / 2000) < 0.001, '✓ inspect_context → occupancy = totalTokens/contextWindow')

  // ===== limit 截断(最近 N 轮)=====
  const r1 = await call(tool, { limit: 2 })
  assert(r1.rounds.length === 2, '✓ inspect_context limit=2 → rounds 截最近 2 轮')
  assert(r1.rounds[0].round === 2, '✓ inspect_context limit=2 → 保留第 2、3 轮(最近)')

  // ===== path 过滤分类 =====
  const r2 = await call(tool, { path: 'toolResults' })
  assert(r2.categories.length === 1 && r2.categories[0].key === 'toolResults', '✓ inspect_context path=toolResults → categories 只含该分类')
  const r2b = await call(tool, { path: 'nonexistent' })
  assert(r2b.categories.length === 0, '✓ inspect_context path=不存在 → categories 空(不报错)')

  // ===== role 聚焦 head =====
  const r3 = await call(tool, { role: 'assistant' })
  assert(/回复/.test(r3.rounds[0].head), '✓ inspect_context role=assistant → head 取回复首句')
  const r3u = await call(tool, { role: 'user' })
  assert(/问题/.test(r3u.rounds[0].head), '✓ inspect_context role=user → head 取问题首句')

  // ===== 无 snapshot 降级 =====
  const tool2 = createInspectContextTool({ getMessages: () => makeRounds(2), contextWindow: 1000 })
  const r4 = await call(tool2, {})
  assert(Array.isArray(r4.categories) && r4.categories.length === 0, '✓ inspect_context 无 snapshot → categories 空数组')
  assert(r4.rounds.length === 2 && r4.totalTokens > 0, '✓ inspect_context 无 snapshot → rounds/totalTokens 正常(降级)')

  // ===== 无 contextWindow → occupancy=0 =====
  const tool3 = createInspectContextTool({ getMessages: () => makeRounds(2) })
  const r5 = await call(tool3, {})
  assert(r5.occupancy === 0 && r5.contextWindow === undefined, '✓ inspect_context 无 contextWindow → occupancy=0')

  // ===== 硬上限 50 =====
  const tool4 = createInspectContextTool({ getMessages: () => makeRounds(60) })
  const r6 = await call(tool4, {})
  assert(r6.rounds.length === 50, '✓ inspect_context 60 轮 → 硬上限截最近 50')
  assert(r6.rounds[0].round === 11, '✓ inspect_context 60 轮截断 → 从第 11 轮开始(保留 11-60)')
}
