# Proposal: dialog-i18n(内置对话框国际化)

## Why

内置 ChatDialog 全部 UI 文案硬编码中文(占位符/状态标签/步骤明细/确认与冲突条/会话历史/聚焦条等),面向海外或双语产品的集成方无法切换;SDK 已是 npm 公开包(英文 README 双语),UI 却只有中文,是国际化的最后一公里。

**双需求驱动(2026-08-16 用户反馈)**:① 国际化(切语言);② **文案自定义**——用户明确要求「成功等提示文案要支持自定义」(步骤状态标签 执行中/成功/失败 等),即不改语言、只换措辞(如「成功」→「完成」)。`dialog.messages` 键级覆盖一石二鸟,是本方案的核心配置面。

## 文案面盘点(2026-08-16 grep 实测,原始计数含注释)

| 层 | 组件 | 实际 UI 键估算 |
|---|---|---|
| **Phase 1 聊天面** | ChatHeader(31)/MessageList(16)/MessageRow(13)/MessageSteps(41)/SubReasonDetails(29)/MessageBubble/ChatInput(14)/QueuedBar/ApprovalBar(20)/ConflictBar(25)/FocusBar(11)/ChatDialog 容器 | **~120-140 键** |
| Phase 2 管理面 | DebugDrawer(164)/SkillPanel(47)/MessageContent(23)/CodePreview(22) | ~150 键(dev 工具 + markdown 渲染提示,终端用户不可见) |
| 伴随点 | `formatTime` zh-CN(:184)/ autoTitle「简短中文标题」prompt / 默认 systemPrompt(中文,集成方可覆盖) | 3 处 |

## What Changes(方案 A:自建轻量字典,不引 vue-i18n)

**依赖零增加**(vue-i18n 需接管 Vue 实例,SDK 的 Vue 打包在库内,集成方无法接管 → 排除)。复用 icons 已验证的接线模式(dialog 配置 → chatContext → 原子组件):

1. **`DialogMessages` 扁平键空间**(~130 键,聊天面全量):每条可见文案一键(含 title/aria 属性);导出类型 + `MESSAGES_ZH_CN` / `MESSAGES_EN_US` 内置双包
2. **`dialog.locale?: 'zh-CN' | 'en-US'`**(默认 zh-CN,向后兼容)+ **`dialog.messages?: Partial<DialogMessages>`**(键级覆盖,**优先于 locale 包** —— 同时解决「换语言」与「改个别文案」两个需求,同 icons 局部覆盖心智)
3. **接线**:`resolveDialogMessages(locale, partial)` → `ctx.messages` → 原子组件 `t('key')`(纯取值函数,无运行时开销);纯 props 叶子(MessageSteps/SubReasonDetails/ConflictBar/FocusBar)从父级下传,独立复用缺省中文
4. **伴随点**:`formatTime` 按 locale(`en-US` 12h AM/PM vs zh-CN 24h);autoTitle 提示词按 locale(英文会话生成英文标题)
5. **默认 systemPrompt**:Phase 1 不动(集成方可覆盖;locale 化的默认 prompt 牵连 reliableWriteRules 双语维护,放 Phase 2 决策)

### Phase 划分

- **Phase 1(本 change)**:聊天面 ~130 键 + locale/messages 配置 + formatTime/autoTitle 伴随点 + selftest(解析优先级/缺省回退)+ browser(en locale 断言关键文案渲染)
- **Phase 2(独立立项,本 change 不含)**:DebugDrawer/SkillPanel(~150 键);默认 systemPrompt 与工具回灌文案(PATH_DENIED hints 等,面向 LLM 而非 UI,语言策略需单独评估)的语言策略;更多 locale 包(集成方可经 `messages` 自带,无需 SDK 内置)

### Non-goals

- 不做 RTL;不引 i18n 框架;不做运行时动态切换语言(重建 sdk 或 `dialog` 重配置即可);`MessageContent` 内 LLM 生成的 markdown 内容不翻译(是模型输出,随 systemPrompt 语言)

## Impact

- 代码面:新增 `src/core/components/messages.ts`(键空间 + 双包 + resolve);~12 个聊天面组件文案替换为 `t()`;chatContext + ChatDialog + createChatSdk(DialogConfig 两键)+ mountChatDialog 接线;types 双侧
- 风险:纯文案替换零行为变化;键遗漏 → 缺省中文回退(`resolveDialogMessages` 保证任意键不缺);既有 browser spec 断言中文文案处需同步(默认 zh 零变化,预期只动 en 新增断言)
- 体量:Phase 1 约一天(键提取最重);与排队中任务(focus-scoped-read/icons.send/padding)无冲突,排在它们之后
