/**
 * 对话框文案集(dialog.locale / dialog.messages;openspec 2026-08-16-dialog-i18n Phase 1)。
 *
 * 双需求:① locale 切换(zh-CN 缺省 / en-US);② 键级自定义(如「成功」→「完成」,不动语言)。
 * 解析优先级:`dialog.messages` 覆盖 > locale 内置包 > zh-CN 缺省(任意键不缺,漏配回退中文)。
 * 零依赖自建字典(vue-i18n 需接管 Vue 实例,SDK 内嵌 Vue 不适用);接线同 icons(dialog 配置 →
 * chatContext.messages → 原子组件;纯 props 叶子从父级下传,独立复用缺省中文)。
 * 含插值的键在组件侧拼接(如 `第 ${n} 次`),字典只存词条壳。
 */
export type DialogLocale = 'zh-CN' | 'en-US'

export interface DialogMessages {
  // ===== 容器缺省(ChatDialog 默认 title/placeholder 跟随 locale)=====
  defaultTitle: string
  inputPlaceholder: string
  // ===== ChatHeader =====
  newSession: string
  history: string
  more: string
  close: string
  debugMenu: string
  debugMenuTitle: string
  skillMenu: string
  skillMenuTitle: string
  clearChat: string
  sessionFallbackPrefix: string   // 会话 / Session(截尾 id 前缀)
  justNow: string
  minutesAgoSuffix: string        // 分钟前 / min ago(数字在前拼接)
  // ===== MessageList =====
  emptyGreeting: string
  retry: string
  undo: string
  undoTitle: string
  // ===== MessageBubble =====
  thinking: string                // 思考中... / Thinking...
  // ===== MessageSteps / SubReasonDetails =====
  statusRunning: string
  statusDone: string
  statusError: string
  subagentBadge: string           // 「子」字标 / "sub"
  subagentBadgeTitle: string
  subagentProgress: string        // 子 agent 进度(图标后的词)
  nthCallPrefix: string           // 第 / #(第 {n} 次 → prefix + n + suffix)
  nthCallSuffix: string           // 次 / of calls
  argsLabel: string
  resultLabel: string
  copy: string
  copied: string
  regenerate: string
  expand: string
  collapse: string
  noResult: string
  displayTruncatedSuffix: string  // …(展示截断,复制可得全量)
  thinkingCountPrefix: string     // 思考中… / Thinking…(+ N字)
  charCountSuffix: string         // 字 / chars
  reasoningTitle: string          // 思考过程
  truncatedNotePrefix: string     // 仅显最近 / Last(+ N 字)
  truncatedNoteSuffix: string     // 字 / chars
  copyThinking: string
  copyThinkingTruncTitle: string
  // ===== MessageRow / ChatInput 焦点 chip =====
  focusChipTitlePrefix: string    // 精修中: / Focus:(+ path)
  focusChipTitleHint: string      // (点击回看 · ✕ 移除)
  historyFocusChipTitlePrefix: string // 回看 / View(+ path)
  removeFocus: string
  // ===== ChatInput =====
  sendHint: string
  sendTitle: string
  stopTitle: string
  // ===== QueuedBar =====
  queuedTitle: string
  queuedEditTitle: string
  removeQueuedTitle: string
  // ===== ApprovalBar =====
  humanConfirmTitle: string
  recommendPrefix: string         // 推荐 / Recommend:(值在后)
  approve: string
  deny: string
  toolConfirmPrefix: string       // 需确认工具调用: / Confirm tool call:
  viewArgs: string
  collapseArgs: string
  argsTruncatedSuffix: string     // …(已截断)
  // ===== ConflictBar =====
  conflictTitlePrefix: string     // 写入冲突: / Write conflict:
  conflictTitleSuffix: string     // 已被外部修改 / was modified externally
  conflictDetailTemplate: string  // 含 {op} 占位(写入/删除)
  conflictOpWrite: string
  conflictOpDelete: string
  viewDiff: string
  collapseDiff: string
  agentValueLabel: string         // AI 想写的值
  currentValueLabel: string       // 外部改后的当前值
  deleteNoValue: string           // (delete 操作无值)
  keepExternal: string
  keepExternalTitle: string
  overwrite: string
  overwriteTitle: string
  restore: string
  restoreTitle: string
  // ===== FocusBar =====
  switchFocusTitle: string
  exitFocusTitle: string
  focusPathPlaceholder: string
  focusLabelPlaceholder: string
  focusSubmit: string
}

export const MESSAGES_ZH_CN: DialogMessages = {
  defaultTitle: 'AI 助手',
  inputPlaceholder: '输入消息,Enter 发送...',
  newSession: '新建会话',
  history: '历史记录',
  more: '更多',
  close: '关闭',
  debugMenu: '调试 / 日志',
  debugMenuTitle: '日志 / 执行流程 / Agent 信息',
  skillMenu: 'Skill 管理',
  skillMenuTitle: '创建 / 管理自定义 Skill',
  clearChat: '清空对话',
  sessionFallbackPrefix: '会话 ',
  justNow: '刚刚',
  minutesAgoSuffix: '分钟前',
  emptyGreeting: '有什么可以帮你的?',
  retry: '重试',
  undo: '↩ 回退',
  undoTitle: '回退到上次正常状态(还原对话历史 + 页面属性 + 工作区)',
  thinking: '思考中...',
  statusRunning: '执行中',
  statusDone: '成功',
  statusError: '失败',
  subagentBadge: '子',
  subagentBadgeTitle: '子 agent 委派(独立上下文,只回结论)',
  subagentProgress: '子 agent 进度',
  nthCallPrefix: '第 ',
  nthCallSuffix: ' 次',
  argsLabel: '入参',
  resultLabel: '返回值',
  copy: '复制',
  copied: '已复制',
  regenerate: '重新生成',
  expand: '展开',
  collapse: '收起',
  noResult: '(无返回值)',
  displayTruncatedSuffix: '\n…(展示截断,复制可得全量)',
  thinkingCountPrefix: '思考中… ',
  charCountSuffix: '字',
  reasoningTitle: '思考过程',
  truncatedNotePrefix: '(仅显最近 ',
  truncatedNoteSuffix: ' 字)',
  copyThinking: '复制完整思考内容',
  copyThinkingTruncTitle: '复制完整思考(渲染已截尾,复制取全量)',
  focusChipTitlePrefix: '精修中:',
  focusChipTitleHint: '(点击回看 · ✕ 移除)',
  historyFocusChipTitlePrefix: '回看 ',
  removeFocus: '移除此焦点',
  sendHint: 'Enter 发送 · Shift+Enter 换行',
  sendTitle: '发送',
  stopTitle: '停止生成',
  queuedTitle: '排队中 · 生成完后自动执行',
  queuedEditTitle: '修改(填回输入框编辑)',
  removeQueuedTitle: '撤销该任务',
  humanConfirmTitle: 'AI 需要你确认',
  recommendPrefix: ' 推荐:',
  approve: '允许',
  deny: '拒绝',
  toolConfirmPrefix: '需确认工具调用:',
  viewArgs: '查看参数',
  collapseArgs: '收起参数',
  argsTruncatedSuffix: '\n…(已截断)',
  conflictTitlePrefix: '写入冲突:',
  conflictTitleSuffix: ' 已被外部修改',
  conflictDetailTemplate: 'AI 基于「读取时的旧值」准备{op},但该属性在你读取之后被外部代码/其他 agent/手动改过。',
  conflictOpWrite: '写入',
  conflictOpDelete: '删除',
  viewDiff: '查看值对比',
  collapseDiff: '收起对比',
  agentValueLabel: 'AI 想写的值',
  currentValueLabel: '外部改后的当前值',
  deleteNoValue: '(delete 操作无值)',
  keepExternal: '保留外部',
  keepExternalTitle: '不写入,保留外部修改后的值,AI 重新读取再改',
  overwrite: '强制覆盖',
  overwriteTitle: '用 AI 的值覆盖外部修改',
  restore: '回退',
  restoreTitle: '回退到最近一次历史快照(agent 之前操作的检查点),撤销外部修改 + AI 不写入',
  switchFocusTitle: '切换聚焦路径',
  exitFocusTitle: '退出精修',
  focusPathPlaceholder: 'jsonPath,如 components.3',
  focusLabelPlaceholder: '标签(可选)',
  focusSubmit: '聚焦',
}

export const MESSAGES_EN_US: DialogMessages = {
  defaultTitle: 'AI Assistant',
  inputPlaceholder: 'Type a message, Enter to send...',
  newSession: 'New chat',
  history: 'History',
  more: 'More',
  close: 'Close',
  debugMenu: 'Debug / Logs',
  debugMenuTitle: 'Logs / execution flow / agent info',
  skillMenu: 'Skills',
  skillMenuTitle: 'Create / manage custom skills',
  clearChat: 'Clear conversation',
  sessionFallbackPrefix: 'Session ',
  justNow: 'just now',
  minutesAgoSuffix: ' min ago',
  emptyGreeting: 'How can I help you?',
  retry: 'Retry',
  undo: '↩ Undo',
  undoTitle: 'Restore the last good state (conversation + page data + workspace)',
  thinking: 'Thinking...',
  statusRunning: 'Running',
  statusDone: 'Success',
  statusError: 'Failed',
  subagentBadge: 'sub',
  subagentBadgeTitle: 'Sub-agent delegation (isolated context, conclusion only)',
  subagentProgress: 'Sub-agent progress',
  nthCallPrefix: 'Call #',
  nthCallSuffix: '',
  argsLabel: 'Args',
  resultLabel: 'Result',
  copy: 'Copy',
  copied: 'Copied',
  regenerate: 'Regenerate',
  expand: 'Expand',
  collapse: 'Collapse',
  noResult: '(no result)',
  displayTruncatedSuffix: '\n…(truncated for display, copy for full)',
  thinkingCountPrefix: 'Thinking… ',
  charCountSuffix: ' chars',
  reasoningTitle: 'Reasoning',
  truncatedNotePrefix: '(last ',
  truncatedNoteSuffix: ' chars only)',
  copyThinking: 'Copy full reasoning',
  copyThinkingTruncTitle: 'Copy full reasoning (display truncated, copy gets all)',
  focusChipTitlePrefix: 'Focus:',
  focusChipTitleHint: '(click to view · ✕ remove)',
  historyFocusChipTitlePrefix: 'View ',
  removeFocus: 'Remove this focus',
  sendHint: 'Enter to send · Shift+Enter for newline',
  sendTitle: 'Send',
  stopTitle: 'Stop generating',
  queuedTitle: 'Queued · runs when current finishes',
  queuedEditTitle: 'Edit (fill back into input)',
  removeQueuedTitle: 'Drop this task',
  humanConfirmTitle: 'AI needs your confirmation',
  recommendPrefix: ' Recommend:',
  approve: 'Allow',
  deny: 'Deny',
  toolConfirmPrefix: 'Confirm tool call:',
  viewArgs: 'View args',
  collapseArgs: 'Collapse args',
  argsTruncatedSuffix: '\n…(truncated)',
  conflictTitlePrefix: 'Write conflict:',
  conflictTitleSuffix: ' was modified externally',
  conflictDetailTemplate: 'The AI prepared to {op} based on the stale value it read, but the property was changed afterwards by external code / another agent / manual edit.',
  conflictOpWrite: 'write',
  conflictOpDelete: 'delete',
  viewDiff: 'View diff',
  collapseDiff: 'Collapse diff',
  agentValueLabel: 'Value AI wants to write',
  currentValueLabel: 'Current value (external)',
  deleteNoValue: '(delete op has no value)',
  keepExternal: 'Keep external',
  keepExternalTitle: 'Skip the write, keep the external value; AI re-reads then retries',
  overwrite: 'Overwrite',
  overwriteTitle: 'Overwrite external changes with the AI value',
  restore: 'Restore',
  restoreTitle: 'Restore the latest snapshot (checkpoint before the agent op); undo external change, AI does not write',
  switchFocusTitle: 'Switch focus path',
  exitFocusTitle: 'Exit focus',
  focusPathPlaceholder: 'jsonPath, e.g. components.3',
  focusLabelPlaceholder: 'Label (optional)',
  focusSubmit: 'Focus',
}

const LOCALE_PACKS: Record<DialogLocale, DialogMessages> = {
  'zh-CN': MESSAGES_ZH_CN,
  'en-US': MESSAGES_EN_US,
}

/** 解析:messages 覆盖 > locale 包 > zh-CN 缺省(任意键不缺;非字符串值忽略) */
export function resolveDialogMessages(locale: DialogLocale = 'zh-CN', partial?: Partial<DialogMessages>): DialogMessages {
  const base = { ...MESSAGES_ZH_CN, ...LOCALE_PACKS[locale] }
  if (!partial) return base
  const merged: DialogMessages = { ...base }
  for (const k of Object.keys(base) as Array<keyof DialogMessages>) {
    const v = partial[k]
    if (typeof v === 'string') merged[k] = v
  }
  return merged
}
