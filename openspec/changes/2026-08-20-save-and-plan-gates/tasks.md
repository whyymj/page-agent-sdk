# Tasks(save-and-plan-gates,按依赖序;已过怀疑论评审回改)

## Phase 1:3a save_page 挂 approval(editor 仓库,零 SDK 改动)✅(2026-08-20)

- [x] `AiAssistant.vue` `approval.confirm` 增 `|| name === 'save_page'`(commit 77b7230,feature/FS-0000_ai功能增强_wh 分支)
- [ ] editor 手动回归(用例 A-10/C-15):「保存页面」→ 弹系统确认框;**UI 路径无限等待用户(预期行为,评审 2-1);send 路径 30s 自动拒**;点确认后走原生保存链路(待 dev server + 人工点击;gitlab 网络恢复后一并推分支)

## Phase 2:3c RHC 确认留痕(SDK)✅(2026-08-20)

- [x] `humanConfirm.ts` 中间件加 `onResolved` 回调参数(评审 2-2:现裁决在闭包 finish() 内,无钩子)
- [x] core 记录结构化 `lastPlanConfirmation: { at, summary, choice, viaOptions: true }`;**仅带 options 的方案类 RHC 确认记录**(评审 2-5:允许/拒绝/无 options 不写,防 bulk 豁免被烧)
- [x] 随 session snapshot 持久化:`SessionSnapshot.planConfirmation` + `SNAPSHOT_KINDS` 注册新 kind + 确认即时 persistSave + persistRuntime 兜底(评审 2-4)
- [x] switchSession/resetSession 清除;applySnapshot 恢复(切回原会话豁免链不断)
- [x] `inspect().planConfirmation` 反射(AgentInfo);`PlanConfirmationRecord` 类型导出(主 + headless)
- [x] ApprovalBar 弹窗上下文提示行:「本会话已确认过方案『xxx』,此操作可能属方案内」(zh/en i18n;不自动跳过);core→UI 经 chatContext `planConfirmation` computed(infoTick 驱动,同 focuses 模式,评审 2-3)
- [x] debugLogs 留痕 `stage: 'plan_confirmation'`
- [x] e2e(session-integrity 11 项):方案点选留痕/inspect 反射/debugLogs 恰 1 次/切新清除/切回快照恢复/reset 清除/口径过滤 ×3(允许/拒绝/无 options);**注意:须走 sdk.stream 路径驱动**(send/invoke 路径 approval_request 不外发,由 approvalWatch 收口 —— F1 契约)
- [x] selftest(sec-93,9 项):onResolved 口径正反例/记录结构/回调抛错不干扰/summary 截断 120
- [ ] browser e2e:human-confirm-demo 弹窗提示行渲染(未单列 —— chatContext planConfirmation 通道已过 102 项全绿回归;渲染断言待 editor 真 UI 验证时一并看)

## Phase 3:3b 方案征询(不造伪机制,只留痕 + 文档)✅(2026-08-20)

- [x] proposal 明示结论:删除兜底(approval 恒在)+ save_page 确认(3a)+ 大批量门禁(bulk-change-guard change)+ 提示词;小规模直改属 agent 自决非缺陷
- [x] 登记残留风险到 deferred.md(触发条件:实测「不征询直接删且绕过 approval」案例 —— 预期永不触发,approval 是硬门禁)

## Phase 4:文档 + 计数 ✅(2026-08-20)

- [x] CLAUDE.md 其他能力段增 lastPlanConfirmation 条目;usage-guide approval 段(editor 手动项待补)
- [x] CHANGELOG [Unreleased] Added;计数同步(2618/874/102)
- [x] 三绿 + exports/types/alignment/size 全绿

## 遗留

- editor 分支推送被内网 gitlab SSL 阻断(本地 commit 189e893 升级 + 77b7230 save_page 已留);网络恢复后 `git push origin feature/FS-0000_ai功能增强_wh`
- editor 手动回归(save_page 确认弹窗 + A-10/C-15 用例)待 dev server
