import { DEFAULT_DIALOG_ICONS, resolveDialogIcons } from '../../components/icons'
import type { TestCtx } from './_ctx'

// 对话框图标自定义(dialog.icons 局部覆盖默认 emoji;用户实测诉求:默认 🤖/🎯 与业务品牌不符)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[对话框图标 · resolveDialogIcons]')
  {
    // 缺省 → 完整默认集(默认路径行为零变化)
    const d = resolveDialogIcons()
    assert(d.header === '🤖' && d.subagent === '🤖' && d.subagentProgress === '🧬', 'resolveDialogIcons 缺省 → 默认图标集(🤖/🤖/🧬)')
    assert(d.empty === '💬' && d.focus === '🎯' && d.queued === '📋' && d.queuedEdit === '✏️', 'resolveDialogIcons 缺省 → 默认图标集(💬/🎯/📋/✏️)')
    assert(d.recommend === '💡' && d.conflict === '⚠️', 'resolveDialogIcons 缺省 → 默认图标集(💡/⚠️)')
    assert(d.assistantAvatar === undefined && d.userAvatar === undefined, 'resolveDialogIcons 缺省 → 头像键 undefined(内置 SVG)')
  }
  {
    // 局部覆盖:只改传的键,其余保持默认
    const r = resolveDialogIcons({ header: '🦈', focus: '📍' })
    assert(r.header === '🦈' && r.focus === '📍', 'resolveDialogIcons 局部覆盖 → 传入键生效')
    assert(r.subagent === '🤖' && r.empty === '💬' && r.queued === '📋', 'resolveDialogIcons 局部覆盖 → 未传键保持默认')
  }
  {
    // 头像键:传字符串 → 透传(替换 SVG);空串视为未传(防渲染空头像)
    const a = resolveDialogIcons({ assistantAvatar: '🛰️', userAvatar: '' })
    assert(a.assistantAvatar === '🛰️', 'resolveDialogIcons assistantAvatar 传值 → 透传(文本字形替换 SVG)')
    assert(a.userAvatar === undefined, 'resolveDialogIcons userAvatar 空串 → 视为未传(undefined=内置 SVG)')
  }
  {
    // 边界:非字符串值忽略(不抛错不污染);文本键空串=隐藏合法保留
    const e = resolveDialogIcons({ header: '', subagent: 123, empty: null } as any)
    assert(e.header === '', 'resolveDialogIcons 文本键空串 → 保留(隐藏图标语义)')
    assert(e.subagent === '🤖' && e.empty === '💬', 'resolveDialogIcons 非字符串值(number/null)→ 忽略用默认')
    // 返回新对象,不 mutate 默认集(多次 resolve 互不污染)
    resolveDialogIcons({ header: 'X' })
    assert(DEFAULT_DIALOG_ICONS.header === '🤖', 'resolveDialogIcons 不 mutate DEFAULT_DIALOG_ICONS(默认集不可变)')
  }
}
