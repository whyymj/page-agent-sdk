# Proposal: save-and-plan-gates(保存确认 + 方案征询纪律的机制化拆解)

> 状态:**规划完成,未实施,已过怀疑论评审回改**(3a 超时断言纠正、3c 改动面补全、lastPlanConfirmation 升级结构化+随会话快照持久化)。优先级 P1。对应反思 G3:三条纪律(保存/方案征询/确认去重)目前是纯提示词,flash 有违反提示词前科(codeField 直写 3 次),能机制化的机制化,不能的明示残留风险。

## Why(反思结论 G3,2026-08-20)

| 纪律 | 现状 | 风险 |
|---|---|---|
| 仅明确要求才 save_page | editor systemPrompt 一句话 | save_page 是对外副作用动作(暂存+提交服务端),agent 自作主张保存 = 把未确认的改动推给线上 |
| 方案类任务必须 request_human_confirmation 征询 | editor systemPrompt 常驻段(3.36 实测事故后加) | 实测已发生过一次「纯文本问确认」违反;无机制兜底 |
| 已确认方案内删除不重复征询 | editor systemPrompt | 重复弹窗骚扰(体验问题,非安全问题) |

## What Changes(按可机制化程度拆三件)

### 3a. save_page 挂 approval(★ 完全可机制化,一行配置)

editor_fangzhou 侧:`createChatSdk({ approval: { confirm: (name) => name === 'delete_component' || name === 'save_page' } })`(评审核实:approval 按 toolName 拦截对 actions 工具生效,机制可行;现配置在 AiAssistant.vue)。

- save_page 调用前弹系统确认框。**超时语义(评审 2-1 纠正)**:approval `timeoutMs` 默认 0 = **UI/stream 路径无限等待用户**(保存确认等用户更合理);「30s 自动拒」只存在于 send/batch(invoke)路径的 makeApprovalWatch。editor 走 UI 对话框 → 无限等待是预期行为;如需超时显式传 `approval.timeoutMs`。
- 语义:「用户明确要求保存」→ agent 调 save_page → 用户点一下确认 = 二次确认,对外动作值得这一下。
- **零 SDK 改动**(approval.confirm 是现成 API),editor 一行 + 回归。

### 3b. 方案征询:明示「不可完全机制化」,拆成两道已有/新立防线

「这条消息是否属于方案类任务(整页生成/清空重建)」是语义判断,机制做不了(做得了的就是 LLM)。**不造伪机制**,拆成:

1. **删除兜底(已有)**:delete_component 系统 approval 弹窗恒在 —— 方案不征询的最坏后果(直接删)被硬门禁拦住;
2. **大批量变更门禁(新立,见 `2026-08-20-bulk-change-guard`)**:单轮删除/改写规模超阈 → approval —— 覆盖「不征询就大规模动手」;
3. 提示词维持现状(已实测有效一轮,继续观察)。

残留风险(接受并登记):小规模「不征询直接改」(如直接改 3 个组件不开方案)—— 本就是 agent 自决范围(局部修改无需确认),非缺陷。

### 3c. RHC 确认留痕 + approval 弹窗上下文(去重体验机制化)

SDK:`request_human_confirmation` 用户点选确认后,core 记录 **结构化 `lastPlanConfirmation`**。

**记录口径(评审 2-5 收窄)**:RHC 不只用于方案征询 —— editor prompt 里 RHC 也用于「主动发起的删除征询」。若任何 RHC 确认都写留痕,一次单组件删除确认就会解除 bulk-change-guard 的全部豁免武装。因此**只对带 options 的方案类 RHC 确认记录**,结构:

```ts
lastPlanConfirmation: {
  at: number                  // 时间戳
  summary: string             // question 摘要(豁免时 ApprovalBar/拒绝文案可见)
  viaOptions: true            // 带 options 的方案确认(口径过滤)
}
```

该接口是三个 change 的公共依赖(save-and-plan 3c 定义、bulk-change-guard 豁免消费),统一在此定,不拆两处。

**存储与存活(评审 2-4)**:随 session snapshot 持久化(todos/mission 有现成模式)—— editor 用 `storage:'indexed'` 会话跨刷新恢复(resumeNotice 正为此存在),内存态刷新即丢会让提示行消失 + bulk 豁免链断裂,3c 白做。切换/重置会话清除。

**确认回调机制(评审 2-2)**:humanConfirm 中间件现无确认回调钩子(裁决发生在 `createHumanConfirmMiddleware` 闭包内的 `finish()`)→ 需给中间件加 `onResolved` 回调参数(或在 createChatSdk 包一层)。

**ApprovalBar 上下文(评审 2-3)**:ApprovalBar 零 props,只从 `ctx.chat` 取 pendingApproval/resolveApproval —— lastPlanConfirmation 是 core 级状态,需 createChatSdk → provide → ChatDialog → chatContext 透传链(或挂起时随 pendingApproval 快照携带,后者改动面更小,实施时二选一)。

- **ApprovalBar 弹窗文案带上下文**:delete_component 的确认弹窗若 `lastPlanConfirmation` 存在(本会话已确认过方案),追加提示行「本会话已确认过方案(摘要),此删除属方案内操作」—— 帮用户快速判断点同意,**不自动跳过**(跳过 = 拆兜底,不可)。
- editor 侧 systemPrompt 的「已确认即执行(去重)」规则保留:机制提供事实(留痕),LLM 据此不再发 RHC;就算 LLM 仍发了,弹窗提示也让用户一键过。
- inspect() 反射 lastPlanConfirmation(DebugDrawer 可见)。

## Impact

| 项 | 变更 |
|---|---|
| editor_fangzhou `AiAssistant.vue` | approval.confirm 增 save_page(3a) |
| `src/core/harness/humanConfirm.ts` | 中间件加 `onResolved` 回调参数(评审 2-2,现无确认回调钩子)(3c) |
| `src/core/sdk/createChatSdk.ts` | onResolved 记结构化 lastPlanConfirmation(仅 viaOptions 方案确认);随 session snapshot 持久化;switchSession/resetSession 清除(3c) |
| `src/core/components/ApprovalBar.vue` + messages.ts i18n + chatContext 透传链 | 弹窗上下文提示行(zh/en);core 状态到 UI 的透传(或 pendingApproval 快照携带)(3c) |
| 测试 | e2e:save_page approval 拦截(editor 层手动回归;**UI 路径预期无限等待,send 路径 30s 拒**)/ 带方案 RHC 确认后留痕、非方案 RHC 不留痕 / 刷新后留痕存活(snapshot)/ 切换清除 / ApprovalBar 提示(browser e2e 一条) |
| 文档 | CLAUDE.md;usage-guide 中英 approval 段;CHANGELOG |

## 非目标(Non-goals)

- 不做「方案类任务自动识别」伪机制(3b 结论)
- 不做确认后自动跳过 approval(拆兜底)
- lastPlanConfirmation 不做**跨会话**持久化(方案时效限本会话;同会话跨刷新存活由 snapshot 承载,评审 2-4)
