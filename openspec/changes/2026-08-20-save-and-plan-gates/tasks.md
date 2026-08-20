# Tasks(save-and-plan-gates,按依赖序;已过怀疑论评审回改)

## Phase 1:3a save_page 挂 approval(editor 仓库,零 SDK 改动)

- [ ] `AiAssistant.vue` `approval.confirm` 增 `|| name === 'save_page'`
- [ ] editor 手动回归(用例 A-10/C-15):「保存页面」→ 弹系统确认框;**UI 路径无限等待用户(预期行为,评审 2-1);send 路径 30s 自动拒**;点确认后走原生保存链路;如需 UI 超时显式传 `approval.timeoutMs`

## Phase 2:3c RHC 确认留痕(SDK)

- [ ] `humanConfirm.ts` 中间件加 `onResolved` 回调参数(评审 2-2:现裁决在闭包 finish() 内,无钩子)
- [ ] core 记录结构化 `lastPlanConfirmation: { at, summary, viaOptions }`;**仅带 options 的方案类 RHC 确认记录**(评审 2-5:单组件删除确认等不写入,防 bulk 豁免被烧掉)
- [ ] 随 session snapshot 持久化(评审 2-4:editor storage:'indexed' 跨刷新恢复,内存态刷新即丢断豁免链);switchSession/resetSession 清除
- [ ] `inspect()` 反射 lastPlanConfirmation
- [ ] ApprovalBar 弹窗文案:存在 lastPlanConfirmation 时追加「本会话已确认过方案(摘要),此操作属方案内」提示行(zh/en i18n);**core→UI 透传**(chatContext 链或 pendingApproval 快照携带,评审 2-3)
- [ ] e2e:带方案 RHC 确认 → 留痕;非方案 RHC(删除征询)→ 不留痕;刷新后留痕存活(snapshot);switchSession/resetSession → 清除;未确认无留痕
- [ ] browser e2e:human-confirm-demo 弹窗提示行渲染

## Phase 3:3b 方案征询(不造伪机制,只留痕 + 文档)

- [ ] CLAUDE.md/本 proposal 明示结论:删除兜底(approval 恒在)+ 大批量门禁(bulk-change-guard change)+ 提示词;小规模直改属 agent 自决非缺陷
- [ ] 登记残留风险到 deferred.md(触发条件:实测「不征询直接删且绕过 approval」案例 —— 预期永不触发,approval 是硬门禁)

## Phase 4:文档 + 计数

- [ ] usage-guide 中英 approval 段补 save_page 用例;CHANGELOG [Unreleased];CLAUDE.md
- [ ] 三绿 + 计数同步
