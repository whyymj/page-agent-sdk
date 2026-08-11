# Change: audit-sdk-integrity(SDK 完整性审计:主流程 × 架构 × 性能 × 漂移)

> 用户诉求(2026-08-10):「仔细梳理功能的主要流程,功能模块;从架构,到细节;需要组织评估,是否有重大缺陷,流程没能按照预想的走,或者任务目的漂移,或者性能有问题等各种常见问题。先规划一下检查项,给出 openspec 规划」。
> **状态**:proposal(待 `/opsx:apply`)。本 change 是**审查类 change**:产出 = 审计报告 + 修复拆分建议,**不改代码**(发现需紧急处理的 P0 → 另立 fix change,停下询问用户)。

## Why

**距上次主流程审计(2026-08-07 `main-flow-audit-fixes`,随 2.24.1 发布)已过去 14 个 minor 版本**(2.25 → 2.38),累计堆叠约 20 个功能 change:

| 批次 | 堆叠的能力 | 复杂度热点 |
|---|---|---|
| 2.25-2.28 | mission 锚定 / workingMemory / focus 多焦点 / 自适应规划 / schema 分层披露 | pin 段体系(augmentPrompt 注入点 ×4+)、规划防死循环 |
| 2.29-2.32 | 受保护资源 freeze/verbatim / draft_write·commit / 三闸上下文韧性 / recall+trim LLM / 持久化韧性 | 写链校验增至 6 层(enforce→schema→白名单→merge→interceptor→commit);vfs 四池 + GC + protectedRefs |
| 2.33-2.35 | focus 持久化+子 agent 继承 / agentCompression 决策 agent / focus 自动切换 | decide 两段式工具循环叠加压缩链;PATH_DENIED × schema 降级交互 |
| 2.36-2.38 | headless 子路径(依赖反转)/ 能力包(RAG·HTML 子 agent)/ 子 agent 观察层 | 双入口打包;子 agent 从「只读一次性」扩展出 allowedTools 写工具 + 自定义中间件 |

上次审计的教训仍然成立:**4 个 P0 全部落在测试盲区**(摘要未送达 / XSS / MCP 注入遮蔽 / 闭包越界),测试全绿 ≠ 流程按预想走。本轮堆叠的功能里,写链、压缩链、子 agent 三条主链的交互面显著变宽,且多处是「opt-in 叠加态」(agentCompression × summarization × preserve × recall × GC;focus × schema 降级 × 子 agent 继承),**叠加态路径恰好是单测最难覆盖的**。

立项前已随手核实到两处现实漂移,印证审计必要:
1. **文档漂移**:CLAUDE.md「记忆管理」段仍写 vfs「**三池**分池」(:109),而「数据槽操作」段已是「**四池**分池」(:99,resources 池 2.32 加入时漏改前处)。
2. **openspec 记录失真**:`chatdialog-component-split` 在 changes/README 标「0/46 暂缓·无功能价值」,但代码里拆分**已实施**(message/* 7 组件 + chatContext.ts + ChatDialog 314 行容器 + CLAUDE.md 按拆分后架构描述)——索引与代码现状矛盾。

## What Changes(本 change 的产出)

1. **审计报告**(本 change 目录内 `audit-report.md`):按严重度分级(P0/P1/P2/P3)× 类别(正确性/流程偏离/目标漂移/性能/安全/可维护性/测试盲区/文档漂移/流程卫生)的 findings 清单,每条含 文件:行 / 证据 / 修复建议 / 测试补建议。
2. **修复拆分建议**:P0 → 立即立 fix change;P1 → 并入下个发布;P2/P3 → 更新 `openspec/deferred.md`。
3. **机制性建议**(沿用上次审计「根因需机制性修复」传统):如类型四处同步的机械门禁缺口、createChatSdk.ts 上帝文件拆分评估、推后项清单复核结论。

**审计范围 = 全量**(不只新增):主流程 F1-F11 逐条走查 + 模块 R1-R8 评审 + 六个专项(目标漂移 D / **执行健壮性 E:死循环·卡住不动·反馈闭环** / **主×子 agent 协同 C:串台·隔离·归属** / 性能 P / 结构健康 A / 测试盲区 T)+ 高优先假设 H1-H28 证伪。详细检查项见 `design.md`。

**完成保证目标**(用户补充要求):审计需回答「大多数场景能否正常完成任务」——F11 以「场景 × 终止路径」矩阵逐格验证能终止/有反馈/状态干净;**完成不了也必须有必要的反馈**(截断原因、失败事项、卡点可见),任何「轮次结束但用户不知道发生了什么」= finding。

## Non-goals

- 不改任何 `src/` 代码、不新增功能、不做重构(修复全部另立 change)
- 不跑真 LLM 验证(依赖运行时行为归「手动验证」清单,报告中标注)
- 不审 examples/demo 代码质量(只审 demo 是否覆盖了对应能力的验证路径)

## 审计方法(组织方式)

沿用 2026-08-07 成功模式并升级:**8 路并行 code-reviewer**(R1-R8 各一路)+ **主流程逐条亲自走查**(F1-F10)+ **专项深潜** + **findings 对抗核实**(每条 P0/P1 独立复核防误报)。审查输入 = design.md 对应节 + H 假设清单 + 上次审计遗留推后项。

## 已知输入(审计必须复核的存量)

- **推后项清单**(上次审计与各 change 遗留):P1-d 流式重试重复 emit / css exports `style.css` 404 / harden-large-json-write A1-A4·B1-B2·C1-C2 / read·write 投影深度不对称 / 中文 recall 分词 / checkpoint messages 整体 clone(Phase B)/ mission-anchor 再评估
- **本次立项随手发现**:CLAUDE.md 三池/四池不一致;chatdialog-component-split 索引失真(见上)
- **本会话亲历**:2.38 发布时 `getActiveSubagents` 漏加 `_createChatSdk` 显式代理列表(buildCore 与 sdk 双 return 结构)——e2e 才兜住,说明双 return 结构是持续漂移源
