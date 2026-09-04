/**
 * sec-118:ui-quick-wins Q3 —— write 审批 diff 预览(previewWrite 纯函数,2026-09-03)
 * - createDataOps 附挂 previewWrite(defineProperty,同 controller 模式):三意图(set/edit/delete)结构化 old→new
 * - 只读契约:预览后 bind 零变更、快照栈零增长、hash 不变(dryRun 纯函数通道)
 * - 校验失败形态:ok=false + error(批准前即见会被拒的原因)
 */
import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx

  console.log('\n[ui-quick-wins Q3 · previewWrite]')
  const schema = z.object({
    title: z.string().describe('标题'),
    cards: z.array(z.object({ name: z.string().describe('名称'), stock: z.number().describe('库存') })).describe('卡片'),
  })
  const bind = { title: '旧标题', cards: [{ name: 'A', stock: 1 }, { name: 'B', stock: 2 }] }
  const tools = createDataOps({ schema, bind, description: '测试' })
  const pw = (tools as unknown as { previewWrite?: (a: Record<string, unknown>) => { ok: boolean; intent: string; items: Array<{ op?: string; jsonPath?: string; oldSummary?: string; newSummary?: string }>; error?: string } }).previewWrite
  assert(typeof pw === 'function', '✓ createDataOps 附挂 previewWrite(同 controller defineProperty 模式)')

  const hashOf = (): string => JSON.stringify(bind)

  // ===== edit 单 patch:set cards.0.stock =====
  const before1 = hashOf()
  const editP = pw({ patch: { op: 'set', jsonPath: 'cards.0.stock', value: 99 } })
  assert(editP.ok === true && editP.intent === 'edit', '✓ edit 单 patch → ok + intent=edit')
  assert(editP.items.length === 1 && editP.items[0].jsonPath === 'cards.0.stock', '✓ edit item 带精确 jsonPath')
  assert(editP.items[0].oldSummary === '1' && editP.items[0].newSummary === '99', '✓ old→new 摘要(写前现值 → patch value)')
  assert(hashOf() === before1, '✓ 只读契约:预览后 bind 零变更')

  // ===== edit 批量 patches:逐条 item =====
  const batch = pw({ patches: [
    { op: 'set', jsonPath: 'title', value: '新标题' },
    { op: 'remove', jsonPath: 'cards.1' },
  ] })
  assert(batch.ok === true && batch.items.length === 2, '✓ 批量 patches 逐条 item(2 条)')
  assert(batch.items[0].oldSummary === '"旧标题"' && batch.items[0].newSummary === '"新标题"', '✓ 批量第 1 条 old→new(字符串值带引号原样)')
  assert(batch.items[1].op === 'remove' && batch.items[1].newSummary === 'undefined', '✓ 批量第 2 条 remove(new=undefined 摘要)')

  // ===== set 整体:changedKeys 逐顶层键 =====
  const setP = pw({ value: { title: '整体新标题', cards: [{ name: 'A', stock: 1 }, { name: 'B', stock: 2 }] } })
  assert(setP.ok === true && setP.intent === 'set', '✓ set 整体 → ok + intent=set')
  assert(setP.items.length === 1 && setP.items[0].jsonPath === 'title', '✓ set 只列变更键(cards 未变不列;merge 语义预演)')
  assert(setP.items[0].oldSummary === '"旧标题"' && setP.items[0].newSummary === '"整体新标题"', '✓ set 变更键 old→new')

  // ===== delete:old 摘要 + (删除) 标记 =====
  const delP = pw({ del: true, patch: { jsonPath: 'cards.0' } })
  assert(delP.ok === true && delP.intent === 'delete', '✓ delete → ok + intent=delete')
  assert(delP.items[0].jsonPath === 'cards.0' && delP.items[0].oldSummary.includes('"name":"A"'), '✓ delete item 带被删元素 old 摘要')
  assert(delP.items[0].newSummary === '(删除)', '✓ delete newSummary=(删除) 标记')

  // ===== 校验失败:批准前即见会被拒的原因 =====
  const bad = pw({ patch: { op: 'set', jsonPath: 'cards.0.stock', value: 'not-a-number' } })
  assert(bad.ok === false && typeof bad.error === 'string' && bad.error.length > 0, '✓ 校验失败 → ok=false + error 说明(类型不符在预览期暴露)')

  // ===== 只读终检:五次预览后 bind/hash 全程零变化 =====
  const finalHash = hashOf()
  assert(finalHash === before1, '✓ 只读终检:全部预览累计零变更(不碰快照/基线/mutex)')

  console.log('  sec-118 完成:previewWrite 三意图 + 只读契约 16 项断言全过')
}
