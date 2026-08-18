/**
 * sec-37:大 schema 分层披露(add-schema-tiered-disclosure)
 * - 小 schema(≤阈值)全量含约束;大 schema(>maxKeys / >maxChars)分层顶层概览(无约束)+ 尾部提示
 * - maxKeys/maxChars 可配(配大阈值退化为全量);renderSchemaShallow 浅渲染(key+type+desc 无约束)
 */
import { z } from 'zod'
import { extractSchemaHint } from '../../presets'
import { renderSchemaShallow, renderSchemaOverview } from '../../tools/schemaUtils'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx

  // 小 schema(2 字段,≤阈值 maxKeys=15/maxChars=4000)→ 全量(带约束)
  const small = z.object({
    name: z.string().min(2).max(50).describe('姓名'),
    age: z.number().min(0).max(150).describe('年龄'),
  })
  const smallHint = extractSchemaHint(small)
  assert(smallHint.includes('姓名') && smallHint.includes('年龄'), '✓ 小 schema ≤阈值 → 全量(含字段描述)')
  assert(smallHint.includes('min='), '✓ 小 schema 全量含约束(min=)')
  assert(!smallHint.includes('顶层概览'), '✓ 小 schema 不触发分层(无「顶层概览」标记)')

  // 大 schema(20 字段,>maxKeys=15)→ 分层(顶层概览,不带约束 + 尾部提示)
  const bigShape: Record<string, any> = {}
  for (let i = 0; i < 20; i++) {
    bigShape[`field_${i}`] = z.string().min(1).max(100).describe(`字段${i}`)
  }
  const big = z.object(bigShape)
  const bigHint = extractSchemaHint(big)
  assert(bigHint.includes('顶层概览'), '✓ 大 schema >maxKeys → 分层(含「顶层概览」标记)')
  assert(!bigHint.includes('min='), '✓ 分层概览不含深层约束(min/max/enum)')
  assert(bigHint.includes('schema_data'), '✓ 分层含尾部提示(默认 advanced → 深层约束查 schema_data)')
  assert(bigHint.includes('field_0'), '✓ 分层概览含顶层 key(field_0)')

  // 分层深层指引按 toolMode 分支(提示词与工具面一致性,editor_fangzhou schema_data 误调驱动):
  // simple/minimal 未装载 schema_data → 改教 read 子路径,勿教工具池不存在的工具
  const bigSimple = extractSchemaHint(big, { toolMode: 'simple' })
  assert(bigSimple.includes('顶层概览') && !bigSimple.includes('schema_data'), '✓ 分层(toolMode simple)→ 不教 schema_data(工具池未装载)')
  assert(bigSimple.includes('read({jsonPath})'), '✓ 分层(toolMode simple)→ 深层指引改教 read 子路径')
  assert(!extractSchemaHint(big, { toolMode: 'minimal' }).includes('schema_data'), '✓ 分层(toolMode minimal)→ 不教 schema_data')
  assert(extractSchemaHint(big, { toolMode: 'advanced' }).includes('schema_data'), '✓ 分层(toolMode advanced 显式)→ 保留 schema_data 指引')
  // 缓存 optsKey 含 toolMode:同 schema 不同 toolMode 不串缓存(simple 后再取默认仍各自正确)
  assert(extractSchemaHint(big, { toolMode: 'simple' }).includes('read({jsonPath}') && extractSchemaHint(big).includes('schema_data'), '✓ 分层缓存按 toolMode 隔离(切换模式不串条目)')

  // record 键集开放显式标注(机制化防拒写:裸 record 无字段清单,LLM 闭世界假设易误判
  // 「键不在 schema 里 → 不能写」而拒绝合法写入,如 editor_fangzhou style.padding 事故)
  const recSchema = z.object({
    style: z.record(z.string(), z.unknown()).optional().describe('CSS 键值'),
    title: z.string(),
  })
  assert(renderSchemaOverview(recSchema).includes('键集开放'), '✓ renderSchemaOverview record 字段 → 带「键集开放」标注')
  assert(renderSchemaOverview(z.record(z.string(), z.unknown())).includes('键集开放'), '✓ renderSchemaOverview record 根(fallback)→ 同样带键集开放标注')
  assert(extractSchemaHint(recSchema).includes('键集开放'), '✓ 小 schema 全量 hint → record 字段带键集开放标注')
  // 分层概览(浅渲染)同样带 record 标注:大 schema 走 renderSchemaShallow,record 字段无清单更易触发闭世界拒写
  assert(renderSchemaShallow(recSchema).includes('键集开放'), '✓ renderSchemaShallow record 字段 → 也带「键集开放」标注(分层场景)')

  // maxKeys/maxChars 可配:配大阈值 → 大 schema 退化为全量(不分层)
  const fullHint = extractSchemaHint(big, { maxKeys: 9999, maxChars: 999999 })
  assert(!fullHint.includes('顶层概览'), '✓ maxKeys=9999/maxChars=999999 → 大 schema 退化为全量(不分层)')
  assert(fullHint.includes('minLen='), '✓ 退化全量恢复含约束(string 的 minLen/maxLen)')

  // maxChars 触发:字段少但描述长(字符 >4000)→ 分层
  const longDesc = z.object({
    a: z.string().describe('x'.repeat(2000)),
    b: z.string().describe('y'.repeat(2000)),
    c: z.string().describe('z'.repeat(2000)),
  })
  const longHint = extractSchemaHint(longDesc)
  assert(longHint.includes('顶层概览'), '✓ 字符 >maxChars → 分层(即使 key 数 ≤ maxKeys)')

  // renderSchemaShallow 浅渲染:只 key + type + desc,不带约束
  const shallow = renderSchemaShallow(small)
  assert(shallow.includes('name (string)') && shallow.includes('age (number)'), '✓ renderSchemaShallow → key + type')
  assert(shallow.includes('姓名'), '✓ renderSchemaShallow 含描述')
  assert(!shallow.includes('min='), '✓ renderSchemaShallow 不含约束(浅渲染)')

  // extractSchemaHint(null/undefined) → 空串
  assert(extractSchemaHint(null) === '', '✓ extractSchemaHint(null) → 空串')
}
