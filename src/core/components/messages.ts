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
  // ===== ChatInput 图片输入(image-input-vision)=====
  attachImageTitle: string     // 添加图片(可拖拽 / 粘贴)
  imageDropHint: string        // 松开添加图片
  imageCountLimitPrefix: string // 单轮最多 / Up to
  imageCountLimitSuffix: string // 张图片 / images per message
  imageInvalid: string         // 图片读取失败,已忽略 / Failed to read image, skipped
  imageAlt: string             // 用户图片 / User image
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
  // ===== DebugDrawer(phase2;tab/过滤器/状态/各面板)=====
  debugTabLogs: string
  debugTabFlow: string
  debugTabContext: string
  debugTabSubagent: string
  debugTabInfo: string
  debugClearLogs: string
  /** 复制诊断报告(完整日志文件,一键交排查) */
  debugCopyReport: string
  debugTypeContext: string
  debugTypeLlmRequest: string
  debugTypeLlmResponse: string
  debugTypeToolCall: string
  debugTypeToolResult: string
  debugTypeError: string
  debugTypeMiddleware: string
  debugFilterAll: string
  debugFlowPrep: string              // 准备 / 其他(流程视图无 round 分组标题)
  debugLogsEmpty: string
  debugLogsWrapUp: string          // 收尾 / Wrap-up(日志分组:预算耗尽等兜底收口轮)
  debugFlowEmpty: string
  debugNoInfo: string
  debugCardView: string
  debugRequestBody: string
  debugOnlyNew: string           // 只看新增 / New only(llm_request 差分视图切换)
  debugShowAll: string           // 全部消息 / All messages
  debugViewRawJson: string
  debugCollapseRawJson: string
  debugModel: string
  debugTemperature: string
  debugMessageCount: string
  debugToolsLabel: string
  debugContextMessages: string
  debugRoundPrefix: string           // 第 / Round(n 在中间)
  debugRoundSuffix: string           // 轮 / ''(空)
  debugMsgCountSuffix: string        // 条消息 / messages(n 在前)
  debugToolCountSuffix: string       // 工具 / tools(n 在前)
  debugToolCallsSuffix: string       // 个工具调用 / tool calls(n 在前)
  debugResultSuffix: string          // 结果 / result(name 在前)
  debugTodoPending: string
  debugTodoInProgress: string
  debugTodoCompleted: string
  debugSubRunning: string
  debugSubDone: string
  debugSubError: string
  debugLocksTitle: string            // 组件锁 / Component locks
  debugSubagentEmpty: string
  debugSubRunningTitle: string       // 运行中 / Running
  debugSubHistoryTitle: string       // 历史 / History
  debugStepsBtn: string
  debugStepsCountSuffix: string      // 步 / steps(n 在前)
  debugTraceEmpty: string
  debugMetricRounds: string
  debugMetricTotal: string
  debugMetricAvg: string
  debugMetricTools: string
  debugMetricCompressions: string
  debugCtxEmpty: string
  debugCtxOccupancy: string          // 占用 / Occupancy(title)
  debugCtxThreshold: string          // 压缩阈值 / compress threshold
  debugCtxTokens: string             // 估算 / est.(token 前缀)
  debugCtxWindow: string             // 窗口 / window(数值前缀)
  debugCtxThresholdPct: string       // 阈值 / threshold(数值前缀)
  debugCtxCategories: string
  debugCtxLastCompression: string
  debugCtxSummarized: string         // 摘要 / summarized(N/M 轮前缀)
  debugCtxRoundsSuffix: string       // 轮 / rounds(N/M 后缀)
  debugCtxRecalled: string           // 召回 / recalled(数值前缀)
  debugCtxAgentDecision: string      // agent 决策: / agent decision:
  debugInfoBasic: string
  debugToolCount: string             // 工具数 / Tools
  debugMiddleware: string
  debugMiddlewareStack: string
  debugSkillsTitle: string
  debugSkillsHint: string
  debugLoading: string
  debugDataTitle: string
  debugDataFallback: string          // 主数据对象 / main data object(无 description 兜底)
  debugSchemaPrefix: string          // schema: (zh/en 同,占位保持结构)
  debugSchemaDeclared: string
  debugSchemaMissing: string
  debugSubagentTitle: string
  debugEnabled: string
  debugYes: string
  debugNo: string
  debugMaxDepth: string
  debugMaxParallel: string
  debugExtraTools: string
  debugDefaultReadonly: string
  debugVerifyTitle: string
  debugMaxAttempts: string
  debugAdversarial: string
  debugOn: string
  debugOff: string
  debugAdversarialModel: string
  debugSameAsMain: string            // (同主) / (same as main)
  debugTodosTitle: string
  debugMemoryTitle: string
  debugPrefsTitle: string             // 用户偏好 / User preferences(preferences opt-in 小节标题)
  debugPrefTopicColor: string         // 偏好 topic 标签:颜色 / color
  debugPrefTopicCopy: string          // 文案 / copy
  debugPrefTopicLayout: string        // 排版 / layout
  debugPrefTopicInteraction: string   // 交互 / interaction
  debugPrefTopicTech: string          // 技术 / tech
  debugPrefTopicOther: string         // 其他 / other
  debugLastCompTitle: string
  debugTriggered: string
  debugNotTriggered: string          // ✗(未达阈值) / ✗ (below threshold)
  debugRoundsSummarized: string
  debugCountSuffix: string           // 条 / ''(召回 N 条)
  debugStrategy: string
  debugDecision: string
  debugSummaryMode: string           // 摘要 / summary(决策摘要 mode 后缀)
  debugSkillNoReader: string
  debugSkillEmpty: string
  // ===== SkillPanel(phase2)=====
  skillPanelTitle: string
  skillEditingPrefix: string         // 编辑 Skill: / Edit skill:
  skillCreateNew: string
  skillCancelEdit: string
  skillNameLabel: string
  skillNamePlaceholder: string
  skillDescLabel: string
  skillDescPlaceholder: string
  skillContentLabel: string
  skillContentPlaceholder: string
  skillSave: string
  skillAdd: string
  skillCreatedTitle: string          // 已创建 Skill / Created skills(n 在后)
  skillEmpty: string
  skillEditBtn: string
  skillEditTitle: string
  skillDeleteBtn: string
  skillDeleteTitle: string
  skillErrName: string
  skillErrDesc: string
  skillErrContent: string
  skillDupWarnPrefix: string         // 已存在同名用户 skill " / User skill " exists: "
  skillDupWarnSuffix: string         // ",将覆盖 / " will be overwritten
  skillHintA: string                 // 底部提示三段(code 标签留在模板混排)
  skillHintB: string
  skillHintC: string
  // ===== CodePreview(phase2)=====
  codeCopyTitle: string
  codeOpenTitle: string
  codePreviewTitlePrefix: string  // 代码预览 · / Code preview · (lang 在后)
  codePreviewTab: string
  codeSourceTab: string
  codeDemoTitle: string
  codeDemoText: string
  codeDemoButton: string
  codeDemoInput: string
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
  attachImageTitle: '添加图片(可拖拽 / 粘贴)',
  imageDropHint: '松开添加图片',
  imageCountLimitPrefix: '单轮最多 ',
  imageCountLimitSuffix: ' 张图片',
  imageInvalid: '图片读取失败,已忽略',
  imageAlt: '用户图片',
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
  // ===== DebugDrawer =====
  debugTabLogs: '日志',
  debugTabFlow: '流程',
  debugTabContext: '上下文',
  debugTabSubagent: '子 agent',
  debugTabInfo: 'Agent 信息',
  debugClearLogs: '清空日志',
  debugCopyReport: '复制诊断报告(完整日志,交维护者排查)',
  debugTypeContext: '上下文',
  debugTypeLlmRequest: 'LLM请求',
  debugTypeLlmResponse: 'LLM响应',
  debugTypeToolCall: '工具调用',
  debugTypeToolResult: '工具结果',
  debugTypeError: '错误',
  debugTypeMiddleware: '中间件',
  debugFilterAll: '全部',
  debugFlowPrep: '准备 / 其他',
  debugLogsEmpty: '暂无日志，发送消息后这里会显示 Agent 的完整上下文、工具调用等信息',
  debugLogsWrapUp: '收尾',
  debugFlowEmpty: '暂无日志，发送消息后这里按轮次展示执行流程',
  debugNoInfo: '暂无信息',
  debugCardView: '🗂 卡片视图',
  debugRequestBody: '📋 请求体',
  debugOnlyNew: '只看新增',
  debugShowAll: '全部消息',
  debugViewRawJson: '查看原始 JSON',
  debugCollapseRawJson: '收起原始 JSON',
  debugModel: '模型',
  debugTemperature: '温度',
  debugMessageCount: '消息数',
  debugToolsLabel: '工具',
  debugContextMessages: '上下文消息',
  debugRoundPrefix: '第 ',
  debugRoundSuffix: ' 轮',
  debugMsgCountSuffix: ' 条消息',
  debugToolCountSuffix: ' 工具',
  debugToolCallsSuffix: ' 个工具调用',
  debugResultSuffix: ' 结果',
  debugTodoPending: '待办',
  debugTodoInProgress: '进行中',
  debugTodoCompleted: '完成',
  debugSubRunning: '运行中',
  debugSubDone: '完成',
  debugSubError: '错误',
  debugLocksTitle: '组件锁',
  debugSubagentEmpty: '尚未委派子 agent。主 agent 调用 use_<id> 或 spawn_agent 后,这里展示运行状态与委派历史。',
  debugSubRunningTitle: '运行中',
  debugSubHistoryTitle: '历史',
  debugStepsBtn: '步骤',
  debugStepsCountSuffix: ' 步',
  debugTraceEmpty: '未开启 tracing(capabilities.tracing:true)或暂无 trace。跑一轮 agent 后刷新。',
  debugMetricRounds: '轮次',
  debugMetricTotal: '总耗时',
  debugMetricAvg: '平均/轮',
  debugMetricTools: '工具',
  debugMetricCompressions: '压缩',
  debugCtxEmpty: '未开启 contextInspector(默认开)或暂无快照。跑一轮 agent 后切回刷新。',
  debugCtxOccupancy: '占用',
  debugCtxThreshold: '压缩阈值',
  debugCtxTokens: '估算',
  debugCtxWindow: '窗口',
  debugCtxThresholdPct: '阈值',
  debugCtxCategories: '分类构成(近似)',
  debugCtxLastCompression: '最近压缩',
  debugCtxSummarized: '摘要',
  debugCtxRoundsSuffix: ' 轮',
  debugCtxRecalled: '召回',
  debugCtxAgentDecision: 'agent 决策:',
  debugInfoBasic: '基本信息',
  debugToolCount: '工具数',
  debugMiddleware: '中间件',
  debugMiddlewareStack: '中间件栈',
  debugSkillsTitle: '技能',
  debugSkillsHint: '点击展开查看全文',
  debugLoading: '加载中…',
  debugDataTitle: '可操作数据',
  debugDataFallback: '主数据对象',
  debugSchemaPrefix: 'schema: ',
  debugSchemaDeclared: '已声明',
  debugSchemaMissing: '未声明',
  debugSubagentTitle: '子 Agent',
  debugEnabled: '启用',
  debugYes: '是',
  debugNo: '否',
  debugMaxDepth: '最大递归',
  debugMaxParallel: '并行上限',
  debugExtraTools: '额外工具',
  debugDefaultReadonly: '默认只读',
  debugVerifyTitle: 'Verify 自检',
  debugMaxAttempts: '自纠上限',
  debugAdversarial: '对抗验证',
  debugOn: '开启',
  debugOff: '关闭',
  debugAdversarialModel: '对抗模型',
  debugSameAsMain: '(同主)',
  debugTodosTitle: '任务清单',
  debugMemoryTitle: '持久指令 (memory)',
  debugPrefsTitle: '用户偏好(跨会话)',
  debugPrefTopicColor: '颜色',
  debugPrefTopicCopy: '文案',
  debugPrefTopicLayout: '排版',
  debugPrefTopicInteraction: '交互',
  debugPrefTopicTech: '技术',
  debugPrefTopicOther: '其他',
  debugLastCompTitle: '上轮压缩',
  debugTriggered: '触发',
  debugNotTriggered: '✗(未达阈值)',
  debugRoundsSummarized: '摘要轮次',
  debugCountSuffix: ' 条',
  debugStrategy: '策略',
  debugDecision: '压缩决策',
  debugSummaryMode: '摘要',
  debugSkillNoReader: '当前 SDK 未注入 getSkillContent,无法查看 skill 全文',
  debugSkillEmpty: 'skill 无内容或读取失败',
  // ===== SkillPanel =====
  skillPanelTitle: '🧩 Skill 管理',
  skillEditingPrefix: '编辑 Skill: ',
  skillCreateNew: '创建新 Skill',
  skillCancelEdit: '取消编辑',
  skillNameLabel: '名称',
  skillNamePlaceholder: '如:my-writer',
  skillDescLabel: '描述',
  skillDescPlaceholder: '一句话说明用途与触发时机',
  skillContentLabel: '内容',
  skillContentPlaceholder: 'skill 全文指令(支持 Markdown)',
  skillSave: '保存修改',
  skillAdd: '添加 Skill',
  skillCreatedTitle: '已创建 Skill',
  skillEmpty: '暂无用户创建的 skill',
  skillEditBtn: '编辑',
  skillEditTitle: '加载到表单编辑',
  skillDeleteBtn: '删除',
  skillDeleteTitle: '删除该用户 skill',
  skillErrName: 'skill 名不能为空',
  skillErrDesc: '描述不能为空',
  skillErrContent: '内容不能为空',
  skillDupWarnPrefix: '已存在同名用户 skill "',
  skillDupWarnSuffix: '",将覆盖',
  skillHintA: '创建/编辑的 skill 会自动加入 agent(下轮 system prompt 索引可见),agent 经',
  skillHintB: '按需加载全文;持久化由独立 SkillStore 管理(默认 indexedDB,与 storage 选项分离),跨刷新自动恢复;可经',
  skillHintC: '跨页面复用。',
  // ===== CodePreview =====
  codeCopyTitle: '复制代码',
  codeOpenTitle: '新窗口打开',
  codePreviewTitlePrefix: '代码预览 · ',
  codePreviewTab: '预览',
  codeSourceTab: '源码',
  codeDemoTitle: 'CSS 预览',
  codeDemoText: '这是一段示例文字，用于展示 CSS 效果。',
  codeDemoButton: '按钮',
  codeDemoInput: '输入框',
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
  attachImageTitle: 'Add image (drag & drop / paste)',
  imageDropHint: 'Drop to attach image',
  imageCountLimitPrefix: 'Up to ',
  imageCountLimitSuffix: ' images per message',
  imageInvalid: 'Failed to read image, skipped',
  imageAlt: 'User image',
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
  // ===== DebugDrawer =====
  debugTabLogs: 'Logs',
  debugTabFlow: 'Flow',
  debugTabContext: 'Context',
  debugTabSubagent: 'Sub-agents',
  debugTabInfo: 'Agent info',
  debugClearLogs: 'Clear logs',
  debugCopyReport: 'Copy diagnostics report (full logs for troubleshooting)',
  debugTypeContext: 'Context',
  debugTypeLlmRequest: 'LLM request',
  debugTypeLlmResponse: 'LLM response',
  debugTypeToolCall: 'Tool call',
  debugTypeToolResult: 'Tool result',
  debugTypeError: 'Error',
  debugTypeMiddleware: 'Middleware',
  debugFilterAll: 'All',
  debugFlowPrep: 'Preparation / other',
  debugLogsEmpty: 'No logs yet. After you send a message, the full agent context and tool calls appear here.',
  debugLogsWrapUp: 'Wrap-up',
  debugFlowEmpty: 'No logs yet. After you send a message, the execution flow appears here by round.',
  debugNoInfo: 'No info',
  debugCardView: '🗂 Cards',
  debugRequestBody: '📋 Request body',
  debugOnlyNew: 'New only',
  debugShowAll: 'All messages',
  debugViewRawJson: 'View raw JSON',
  debugCollapseRawJson: 'Collapse raw JSON',
  debugModel: 'Model',
  debugTemperature: 'Temp',
  debugMessageCount: 'Messages',
  debugToolsLabel: 'Tools',
  debugContextMessages: 'Context messages',
  debugRoundPrefix: 'Round ',
  debugRoundSuffix: '',
  debugMsgCountSuffix: ' messages',
  debugToolCountSuffix: ' tools',
  debugToolCallsSuffix: ' tool calls',
  debugResultSuffix: ' result',
  debugTodoPending: 'Pending',
  debugTodoInProgress: 'In progress',
  debugTodoCompleted: 'Done',
  debugSubRunning: 'Running',
  debugSubDone: 'Done',
  debugSubError: 'Error',
  debugLocksTitle: 'Component locks',
  debugSubagentEmpty: 'No sub-agents yet. Once the main agent calls use_<id> or spawn_agent, run status and delegation history appear here.',
  debugSubRunningTitle: 'Running',
  debugSubHistoryTitle: 'History',
  debugStepsBtn: 'Steps',
  debugStepsCountSuffix: ' steps',
  debugTraceEmpty: 'Tracing not enabled (capabilities.tracing:true) or no trace yet. Run a round then refresh.',
  debugMetricRounds: 'Rounds',
  debugMetricTotal: 'Total',
  debugMetricAvg: 'Avg/round',
  debugMetricTools: 'Tools',
  debugMetricCompressions: 'Compressions',
  debugCtxEmpty: 'contextInspector not enabled (on by default) or no snapshot yet. Run a round then switch back.',
  debugCtxOccupancy: 'Occupancy',
  debugCtxThreshold: 'compress threshold',
  debugCtxTokens: 'est.',
  debugCtxWindow: 'window',
  debugCtxThresholdPct: 'threshold',
  debugCtxCategories: 'Categories (approx.)',
  debugCtxLastCompression: 'Last compression',
  debugCtxSummarized: 'summarized',
  debugCtxRoundsSuffix: ' rounds',
  debugCtxRecalled: 'recalled',
  debugCtxAgentDecision: 'agent decision: ',
  debugInfoBasic: 'Basics',
  debugToolCount: 'Tools',
  debugMiddleware: 'Middleware',
  debugMiddlewareStack: 'Middleware stack',
  debugSkillsTitle: 'Skills',
  debugSkillsHint: 'click to expand',
  debugLoading: 'Loading…',
  debugDataTitle: 'Operable data',
  debugDataFallback: 'main data object',
  debugSchemaPrefix: 'schema: ',
  debugSchemaDeclared: 'declared',
  debugSchemaMissing: 'not declared',
  debugSubagentTitle: 'Sub-agents',
  debugEnabled: 'Enabled',
  debugYes: 'Yes',
  debugNo: 'No',
  debugMaxDepth: 'Max depth',
  debugMaxParallel: 'Max parallel',
  debugExtraTools: 'Extra tools',
  debugDefaultReadonly: 'read-only by default',
  debugVerifyTitle: 'Verify self-check',
  debugMaxAttempts: 'Max attempts',
  debugAdversarial: 'Adversarial',
  debugOn: 'On',
  debugOff: 'Off',
  debugAdversarialModel: 'Adversarial model',
  debugSameAsMain: ' (same as main)',
  debugTodosTitle: 'Todos',
  debugMemoryTitle: 'Persistent instructions (memory)',
  debugPrefsTitle: 'User preferences (cross-session)',
  debugPrefTopicColor: 'color',
  debugPrefTopicCopy: 'copy',
  debugPrefTopicLayout: 'layout',
  debugPrefTopicInteraction: 'interaction',
  debugPrefTopicTech: 'tech',
  debugPrefTopicOther: 'other',
  debugLastCompTitle: 'Last compression',
  debugTriggered: 'Triggered',
  debugNotTriggered: '✗ (below threshold)',
  debugRoundsSummarized: 'Rounds summarized',
  debugCountSuffix: '',
  debugStrategy: 'Strategy',
  debugDecision: 'Decision',
  debugSummaryMode: 'summary',
  debugSkillNoReader: 'getSkillContent is not injected in this SDK build; cannot view skill content',
  debugSkillEmpty: 'skill has no content or the read failed',
  // ===== SkillPanel =====
  skillPanelTitle: '🧩 Skills',
  skillEditingPrefix: 'Edit skill: ',
  skillCreateNew: 'Create new skill',
  skillCancelEdit: 'Cancel editing',
  skillNameLabel: 'Name',
  skillNamePlaceholder: 'e.g. my-writer',
  skillDescLabel: 'Description',
  skillDescPlaceholder: 'One line: what it does and when to trigger',
  skillContentLabel: 'Content',
  skillContentPlaceholder: 'Full skill instructions (Markdown supported)',
  skillSave: 'Save changes',
  skillAdd: 'Add skill',
  skillCreatedTitle: 'Created skills',
  skillEmpty: 'No user-created skills yet',
  skillEditBtn: 'Edit',
  skillEditTitle: 'Load into the form to edit',
  skillDeleteBtn: 'Delete',
  skillDeleteTitle: 'Delete this user skill',
  skillErrName: 'Skill name cannot be empty',
  skillErrDesc: 'Description cannot be empty',
  skillErrContent: 'Content cannot be empty',
  skillDupWarnPrefix: 'User skill "',
  skillDupWarnSuffix: '" already exists and will be overwritten',
  skillHintA: 'Created/edited skills are automatically added to the agent (visible in the next system prompt index); the agent loads the full text via',
  skillHintB: 'on demand. Persistence is handled by a separate SkillStore (indexedDB by default, independent of the storage option) and survives refreshes; share across pages via',
  skillHintC: 'cross-page reuse.',
  // ===== CodePreview =====
  codeCopyTitle: 'Copy code',
  codeOpenTitle: 'Open in new tab',
  codePreviewTitlePrefix: 'Code preview · ',
  codePreviewTab: 'Preview',
  codeSourceTab: 'Source',
  codeDemoTitle: 'CSS Preview',
  codeDemoText: 'Sample text to demonstrate the CSS effect.',
  codeDemoButton: 'Button',
  codeDemoInput: 'Input',
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
