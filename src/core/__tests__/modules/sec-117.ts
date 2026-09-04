/**
 * sec-117:ui-quick-wins Q1/Q4(2026-09-03 立项,openspec/changes/2026-09-03-ui-quick-wins)
 * - normalizeQuickActions 纯函数:过滤缺 label/prompt 项 / trim / 截断上限 8 / icon 可选透传 /
 *   undefined·非数组 → [](零配置零行为面)
 * - DialogConfig 新键 quickActions/onDropElement 类型面(编译期,无运行时断言)
 */
import { normalizeQuickActions } from '../../sdk/optionsResolver'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx

  console.log('\n[ui-quick-wins Q1 · normalizeQuickActions]')
  const base = [
    { label: '换个配色', prompt: '把主色换成更亮的绿色', icon: '🎨' },
    { label: '加个 banner', prompt: '在页面顶部加一个促销 banner' },
  ]
  const ok = normalizeQuickActions(base)
  assert(ok.length === 2, '✓ 正常两项透传(label/prompt/icon)')
  assert(ok[0].label === '换个配色' && ok[0].prompt === '把主色换成更亮的绿色' && ok[0].icon === '🎨',
    '✓ 字段完整透传(icon 可选保留)')
  assert(ok[1].icon === undefined, '✓ 未传 icon → undefined(不捏造空串)')

  // trim 口径
  const trimmed = normalizeQuickActions([{ label: '  去重  ', prompt: '  清理重复组件  ' }])
  assert(trimmed.length === 1 && trimmed[0].label === '去重' && trimmed[0].prompt === '清理重复组件',
    '✓ label/prompt 两端 trim(展示与发送都吃净化值)')

  // 过滤:缺 label / 缺 prompt / 空串 / 非对象项
  const filtered = normalizeQuickActions([
    { prompt: '只有 prompt 没有 label' },
    { label: '只有 label' },
    { label: '', prompt: '空 label' },
    { label: '空 prompt', prompt: '   ' },
    null,
    42,
    '字符串项',
    { label: '合法', prompt: '合法项' },
  ])
  assert(filtered.length === 1 && filtered[0].label === '合法',
    '✓ 缺 label/缺 prompt/空白串/非对象项全过滤(null/number/string 逐类)')
  assert(filtered[0].icon === undefined, '✓ 过滤后对象不含未声明 icon 键')

  // 截断:超过 8 条取前 8
  const many = Array.from({ length: 12 }, (_, i) => ({ label: `指令${i}`, prompt: `做${i}号事` }))
  const capped = normalizeQuickActions(many)
  assert(capped.length === 8, '✓ 12 条截断至 8(上限保护)')
  assert(capped[7].label === '指令7', '✓ 截断保序(前 8 条)')

  // 零配置面
  assert(normalizeQuickActions(undefined).length === 0, '✓ undefined → [](未配置零行为面)')
  assert(normalizeQuickActions('not-array').length === 0, '✓ 非数组 → [](防御坏配置)')
  assert(normalizeQuickActions([]).length === 0, '✓ 空数组 → [](合法空配置)')

  // 恰好 8 条不截断(边界)
  const exactly8 = Array.from({ length: 8 }, (_, i) => ({ label: `边界${i}`, prompt: `边界${i}` }))
  assert(normalizeQuickActions(exactly8).length === 8, '✓ 恰好 8 条不截断(边界含)')

  console.log('  sec-117 完成:quickActions 归一化 12 项断言全过')
}
