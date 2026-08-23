import { DEFAULT_DIALOG_ICONS, resolveDialogIcons } from '../../components/icons'
import { isIconHtml, ICON_HTML_ALLOWED_TAGS, ICON_HTML_ALLOWED_ATTR } from '../../components/iconHtml'
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
    // send 键(发送按钮图标):传值透传;空串视为未传(防空按钮);缺省 undefined=内置纸飞机 SVG
    const sd = resolveDialogIcons({ send: '🚀' })
    assert(sd.send === '🚀', 'resolveDialogIcons send 传值 → 透传(替换内置纸飞机 SVG)')
    assert(resolveDialogIcons({ send: '' }).send === undefined, 'resolveDialogIcons send 空串 → 视为未传(防空按钮)')
    assert(resolveDialogIcons().send === undefined, 'resolveDialogIcons 缺省 send → undefined(内置 SVG,默认零变化)')
    // 顶部按钮图标四键(newSession/history/more/close)+ 历史删除键(sessionDelete):undefined = 内置图形;空串视为未传(防空图标)
    const hb = resolveDialogIcons({ newSession: '➕', history: '', more: '⋯', close: '✕', sessionDelete: '🗑️' })
    assert(hb.newSession === '➕' && hb.more === '⋯' && hb.close === '✕' && hb.sessionDelete === '🗑️', 'resolveDialogIcons 顶部按钮/历史删除图标传值 → 透传(替换内置图形)')
    assert(hb.history === undefined, 'resolveDialogIcons 顶部按钮图标空串 → 视为未传(内置 SVG)')
    assert(resolveDialogIcons().newSession === undefined && resolveDialogIcons().close === undefined, 'resolveDialogIcons 缺省顶部按钮图标 → undefined(内置 SVG,默认零变化)')
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
  console.log('\n[对话框图标 · HTML 片段形态]')
  {
    // isIconHtml:首非空白字符 '<' → HTML 片段;纯文本(emoji/字符/空串)→ false
    assert(isIconHtml('<svg width="12"></svg>') === true, 'isIconHtml 内联 svg → true')
    assert(isIconHtml('  <img src="x">' ) === true, 'isIconHtml 前导空白后「<」→ true(trimStart)')
    assert(isIconHtml('🦈') === false && isIconHtml('A') === false, 'isIconHtml 纯文本(emoji/字母)→ false')
    assert(isIconHtml('') === false, 'isIconHtml 空串 → false(隐藏图标,非 HTML)')
    // 白名单形状:不放行脚本/样式/链接标签;不放行事件属性/href/style(净化安全下限,浏览器 spec 锁行为)
    const tags = [...ICON_HTML_ALLOWED_TAGS] as string[]
    assert(!tags.some((t) => ['script', 'style', 'a', 'iframe', 'form', 'link'].includes(t)), '图标白名单标签不含 script/style/a/iframe/form/link')
    assert(tags.includes('svg') && tags.includes('img') && tags.includes('i'), '图标白名单标签含 svg/img/i(用户诉求)')
    const attrs = [...ICON_HTML_ALLOWED_ATTR] as string[]
    assert(!attrs.some((a) => a.startsWith('on') || ['href', 'style', 'srcset'].includes(a)), '图标白名单属性不含 on*/href/style/srcset')
    assert(attrs.includes('viewBox') && attrs.includes('src') && attrs.includes('class'), '图标白名单属性含 viewBox/src/class')
  }
}
