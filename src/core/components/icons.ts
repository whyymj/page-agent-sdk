/**
 * 对话框图标集(dialog.icons 自定义内置 emoji;用户实测诉求:默认 🤖/🎯 等与业务品牌不符,希望能换)。
 *
 * 值支持两种形态:纯文本(emoji / 字符 / 字母,文本插值渲染)/ HTML 片段(以 '<' 开头,如内联 svg/img,
 * 经 DOMPurify 图标白名单净化后渲染 —— 见 iconHtml.ts;事件属性与危险协议剥除,不可注入脚本);
 * 空串 = 隐藏该图标。头像两键(assistantAvatar/userAvatar)缺省 undefined = 用内置 SVG 字形,
 * 传字符串则替换(同样支持 HTML 片段;要完全自定义区块建议经 ChatDialog 具名 slot)。
 */

/** 对话框图标集(完整形态;dialog.icons 传 Partial 局部覆盖,未传键用默认) */
export interface DialogIcons {
  /** 头部标题前图标(默认 🤖) */
  header: string
  /** 子 agent 委派标记(默认 🤖;MessageSteps「🤖 子」badge) */
  subagent: string
  /** 子 agent 进度块标签(默认 🧬) */
  subagentProgress: string
  /** 空会话大图标(默认 💬) */
  empty: string
  /** 聚焦 chip 图标(默认 🎯;FocusBar / 输入框 chip / 历史消息 chip 共用) */
  focus: string
  /** 排队任务图标(默认 📋) */
  queued: string
  /** 排队任务「修改」按钮(默认 ✏️) */
  queuedEdit: string
  /** 人工确认「推荐」提示(默认 💡) */
  recommend: string
  /** 写入冲突提示(默认 ⚠️) */
  conflict: string
  /** assistant 头像字形(undefined = 内置 robot SVG;传 emoji/字符替换为文本) */
  assistantAvatar?: string
  /** user 头像字形(undefined = 内置 user SVG) */
  userAvatar?: string
  /** 发送按钮图标(undefined = 内置纸飞机 SVG;传 emoji/字符/HTML 片段替换;loading 态停止方块恒内置)。空串视为未传(防空按钮) */
  send?: string
}

/** 默认图标集(与拆 emoji 前的硬编码值一致,默认路径行为零变化) */
export const DEFAULT_DIALOG_ICONS: DialogIcons = {
  header: '🤖',
  subagent: '🤖',
  subagentProgress: '🧬',
  empty: '💬',
  focus: '🎯',
  queued: '📋',
  queuedEdit: '✏️',
  recommend: '💡',
  conflict: '⚠️',
}

/** 局部覆盖 → 完整图标集(非字符串值忽略;文本键空串=隐藏合法保留;头像键空串视为未传,防渲染空头像) */
export function resolveDialogIcons(partial?: Partial<DialogIcons>): DialogIcons {
  const merged: DialogIcons = { ...DEFAULT_DIALOG_ICONS }
  if (!partial) return merged
  const textKeys = Object.keys(DEFAULT_DIALOG_ICONS) as Array<keyof typeof DEFAULT_DIALOG_ICONS>
  for (const k of textKeys) {
    const v = partial[k]
    if (typeof v === 'string') merged[k] = v
  }
  if (partial.assistantAvatar) merged.assistantAvatar = partial.assistantAvatar
  if (partial.userAvatar) merged.userAvatar = partial.userAvatar
  if (partial.send) merged.send = partial.send
  return merged
}
