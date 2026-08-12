# Tasks: chatdialog-component-split(ChatDialog 拆分成可拼装/可替换的原子组件库)

> ✅ **已实施归档**(2026-08-11,audit-sdk-integrity A5 核实)。核心拆分(§1-8/10)已随日常发布上线:
> - `src/core/composables/chatContext.ts`(枢纽:provide/inject + 容器级 UI 状态)
> - `src/core/components/{ChatHeader,MessageList,QueuedBar,ApprovalBar,ConflictBar,ChatInput,FocusBar}.vue`(8 区块)
> - `src/core/components/message/{MessageRow,MessageReasoning,MessageSteps,MessageBubble,MessageActions,MessageTime}.vue`(message 7 原子)
> - ChatDialog.vue 重写为组合容器(25 props + sections + 8 具名 slot + provide ctx)
> - 导出 + 类型(`types/index.d.ts` 扩展)+ `DialogConfig.sections?` 透传
>
> ⏸ **唯一残项 §9「拼装示例 demo」deferred** —— 重启触发:集成方真实要求自建 ChatDialog 子组件 / 多套皮肤换肤(见 `openspec/deferred.md`)。原 46 项勾选反映核心已落地;§9 4 项保留未勾作底稿。
>
> 关联 `proposal.md`。每步独立验证(基线:`npm test` + `npm run test:types` + `npm run test:exports` + `npm run test:browser` 每步全绿)。

## 1. 建 `chatContext.ts`(纯新增,零组件改动) ✅
- [x] 定义 `chatContextKey: InjectionKey<ChatContext>` + `ChatContext` 类型 + `createChatContext(opts)` 工厂
- [x] `createChatContext` 内部复用 `useChat`(跑一次拿 16 项),创建容器级 UI 状态:`isExpanded`/`toggleCollapse`/`debugVisible`/`openDebug`/`closeDebug`/`skillVisible`/`openSkill`/`closeSkill`/`inputText`/`send`/`keydown`/`canUndo`/`undo`/`summary`/`copyMessage`/`copiedMsg`
- [x] 验证:`npm run test:types`

## 2. 抽 message 子原子(MessageTime/Actions/Reasoning/Steps/Bubble + MessageRow) ✅
- [x] `message/MessageTime.vue`:template + `.message-time` style 整段搬入,props `{ timestamp }`
- [x] `message/MessageActions.vue`:template + `.msg-actions`/`.msg-action-btn` style 搬入,props `{ copied }`,emit `copy`/`regenerate`
- [x] `message/MessageReasoning.vue`:`.reasoning-block` 相关 style 搬入,props `{ text, expanded }`,emit `toggle`
- [x] `message/MessageSteps.vue`:`.steps-block`/`.step-*` 相关 style 搬入;`groupedSteps`/`stepStatusIcon`/`groupStatusIcon` 逻辑迁入,props `{ steps }`
- [x] `message/MessageBubble.vue`:`.message-bubble`/`.typing`/`.stream-cursor` 相关 style 搬入,props `{ content, role, isPendingAssistant, showTyping }`(assistant 渲染 MessageContent,user 纯文本,typing 三点)
- [x] `message/MessageRow.vue`:`.message-row`/`.message-avatar`/`.message-content` style 搬入,组装 5 子件;props `{ message, index, showAvatar, showTyping, isPendingAssistant, reasoningExpanded, copied }`,emit `toggle-reasoning`/`copy`/`regenerate`
- [x] **关键:每个类名原样保留,style 随 DOM 归属走**;`.message-row.assistant:hover .msg-actions` 跨边界用 `:deep()`
- [x] 验证:`npm run test:browser`(message-row 相关:nested-demo message-row 计数 / page-demo)

## 3. 抽 `MessageList`(chat-body) ✅
- [x] 空态 `.empty-state` + `v-for MessageRow` + loading 占位行 + `.error-bar`(重试/回退)搬入
- [x] `reasoningExpanded`(Record<number,boolean>)/`isPendingAssistant`/`isReasoningExpanded`/`toggleReasoning` 迁入
- [x] `scrollContainer` ref + `onScroll`/`onWheel` 绑 MessageList 根;`copiedMsg`/`copyMessage` 走 ctx
- [x] ctx 注入 `retry`/`regenerate`/`canUndo`/`undo`/`formatTime`
- [x] 验证:`npm run test:browser`(nested-demo message-row 计数 / error-recovery 回复含「正确」)

## 4. 抽 `ChatHeader` ✅
- [x] `.chat-header`/`.header-*`/`.action-btn`/`.debug-badge`/`.status-dot` style 搬入
- [x] debug/skill 打开改走 `ctx.openDebug`/`ctx.openSkill`;清空走 `ctx.chat.clearMessages`;折叠走 `ctx.toggleCollapse`;close 走 `ctx.close`
- [x] props `{ title, drawer, skillAvailable, debugLogs? }`
- [x] 验证:`_helpers.clearChat`(`button[title="清空对话"]`)全绿 + page-demo

## 5. 抽 `ChatInput`(chat-footer) ✅
- [x] `.chat-footer`/`.chat-input`/`.send-btn`/`.stop-btn`/`.cap-badge`/`.undo-foot-btn` style 搬入
- [x] `inputText`/`handleSend`/`handleKeydown` 提升进 `createChatContext`;`v-model="ctx.inputText"`
- [x] props `{ placeholder, inputRows }`;loading/stop/summary/canUndo/undo 走 ctx
- [x] **关键:QueuedBar「修改」写 `ctx.inputText`,必须绑同一 ref 对象**(createChatContext 创建一次,原子组件 inject 解构)
- [x] 验证:`queue.spec`(`.chat-dialog textarea` + Enter + `.stop-btn`)+ `nested-demo`(`button.undo-foot-btn`)

## 6. 抽 `QueuedBar`/`ApprovalBar`/`ConflictBar` ✅
- [x] `QueuedBar`:`.queued-bar`/`.queued-*` style 搬入,零 props,用 ctx.chat.queuedTasks/removeQueuedTask/`editQueued`(写回 ctx.inputText)
- [x] `ApprovalBar`:`.approval-bar`/`.approval-*` style 搬入,零 props,自持 `approvalArgsExpanded`;自算 `isHumanConfirm`/`approvalOptions`/`approvalArgsPreview`;ctx.chat.resolveApproval 收口
- [x] `ConflictBar`:**纯 props 零注入**,props `{ pendingConflict?, onResolve? }`,自持 `conflictExpanded`,自算 agent/current 预览
- [x] 验证:`queue.spec`(`.queued-bar`/`.queued-text`/`.queued-count` + 修改填回输入框)+ `human-confirm-demo`(两层确认 + 允许/拒绝/选项)+ `nested-demo`(`.approval-bar` + 允许)
- [x] 手动:drawer 模式点关闭/遮罩仍触发 sdk onClose(risk #4)

## 7. 加 `sections` + 具名 slot ✅
- [x] `ChatDialogProps` 加 `sections?: ChatDialogSections`;`renderSection(k) = sections[k] !== false`(默认全开,向后兼容)
- [x] 8 具名 slot(`#header`/`#body`/`#queued`/`#approval`/`#conflict`/`#footer`/`#debug`/`#skill`)scoped slot 收 `{ chat }`;slot 非空渲染用户实现,空渲染内置原子
- [x] ChatDialog.vue 重写为组合容器:25 props 原样 + provide(ctx) + 8 区块骨架
- [x] 验证:既有 spec 全绿(默认路径行为不变)

## 8. 导出 + 类型 ✅
- [x] `src/core/index.ts` 新增导出(chatContextKey/createChatContext/ChatContext + 7 原子组件),`MessageReasoning/Steps/Bubble/Actions/Time` + `DebugDrawer` 不导出
- [x] `types/index.d.ts`:扩展 `ChatDialogProps`(补全 19 缺字段 + `sections?`)+ 新增 `ChatDialogSections` + 原子组件 `DefineComponent<any>` 声明
- [x] `optionsResolver.ts` `DialogConfig` 加 `sections?`;mount 时透传
- [x] 验证:`npm run test:exports` + `npm run test:types` + `npm run build`

## 9. 示例 demo(⏸ deferred —— 核心拆分已实施,拼装示例待集成方需求触发)

> **残项说明**:§1-8/10(chatContext 枢纽 + message 7 原子 + 8 区块组件 + sections/slot 双机制 + 导出/类型)已全部实施并随日常发布上线。本 §9「拼装示例 demo」未做 —— 重启触发:集成方真实要求自建 ChatDialog 子组件 / 多套皮肤换肤(见 `openspec/deferred.md`)。以下保留作底稿。

- [ ] 新增 `examples/custom-dialog-demo`(index.html + main.ts):sections 关某块(如关 queued)+ slot 替换某块(如自定义 #footer/#approval)+ L2 自建根组件拼原子(provide ctx + ChatInput/MessageList 自由拼)
- [ ] `_shared` DevNav 导航补链接;CLAUDE.md「目录结构」examples 清单补
- [ ] 新增 `tests/browser/custom-dialog.spec.ts`(sections 关区块 + slot 替换 + L2 自建,browser 计数 +3~4)
- [ ] 验证:`npm run test:browser` 全绿 + `npm run dev` 手测新 demo + page-demo 回归

## 10. 全量回归 + 收尾 ✅
- [x] `npm run build` + `npm test` + `npm run test:e2e` + `npm run test:exports` + `npm run test:types` + `npm run test:size`
- [x] 计数同步:CLAUDE.md / README 中英断言计数
- [x] CHANGELOG:ChatDialog 拆分随日常发布记录
- [x] 归档:change 移入 `openspec/changes/archive/`(2026-08-11,A5 核实后归档)
