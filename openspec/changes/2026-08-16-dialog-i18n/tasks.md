# Tasks

- [ ] `src/core/components/messages.ts`:DialogMessages 键空间(~130 键,聊天面全量含 title/aria)+ MESSAGES_ZH_CN / MESSAGES_EN_US 双包 + resolveDialogMessages(locale, partial)(messages 覆盖 > locale 包 > zh 缺省)
- [ ] 接线:chatContext 增 messages → ChatDialog(`dialog.locale`/`dialog.messages` 两键)→ mountChatDialog → createChatSdk DialogConfig + types 双侧
- [ ] 聊天面 12 组件文案替换 t():ChatHeader / MessageList / MessageRow / MessageSteps / SubReasonDetails / MessageBubble / ChatInput / QueuedBar / ApprovalBar / ConflictBar / FocusBar / ChatDialog 容器
- [ ] formatTime 按 locale(en-US 12h AM/PM);autoTitle 提示词按 locale
- [ ] 导出:DialogMessages 类型 + 双语言包(L2 自建 UI 复用);index.ts + types/index.d.ts
- [ ] selftest:resolve 优先级(messages > locale > zh 缺省)/ 任意键不缺(键空间完整性:zh/en 同键集)/ 空覆盖零变化
- [ ] browser:en locale 断言关键文案(header 按钮/占位符/空态/步骤状态标签)+ zh 默认回归零变化
- [ ] 文档:README 双侧 DialogConfig 表两键 + usage-guide 双侧 + CHANGELOG

> Phase 2(DebugDrawer/SkillPanel/默认 systemPrompt 语言策略)独立立项,不在本 tasks。
