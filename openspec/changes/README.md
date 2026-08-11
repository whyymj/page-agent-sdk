# 活跃 Changes 优先级索引

> **2026-08-11 发布 2.40.0**:`fix-main-sub-isolation` 实施完成并归档 —— 审计组 3 三项 + N1(Q4 并入)。① **per-scope 乐观锁基线**(P1-13:`baselines` Map + `activeScope` + controller.enterScope/exitScope;子 agent dataOps 工具经 scope proxy 隔离,子 read/write 不污染主基线 —— 父过期写冲突承诺对进程内 agent 间恢复)+ N1 防御加固(立项复查:原场景不可复现 → 契约注释 + 回归测试锁定「同 scope 连续写不冲突」);② **spawn_agents allSettled**(P1-14:逐任务结算,聚合 ✓/✗,单失败不拖垮整批);③ **子 usage 回传 core.usage**(P1-17a:`normalizeUsage` 纯函数共用)+ **子执行超时**(P1-17b:`subagent.timeoutMs` opt-in,链式 abort)。见 `archive/2026-08-11-fix-main-sub-isolation/`。

> **2026-08-11 发布 2.39.0**:`fix-hang-and-feedback` 实施完成并归档 —— 审计组 1 七项(P1-1..7,挂起与反馈)。三契约:**超时默认值表**(无响应方 approval/humanConfirm 30s 自动拒 + `APPROVAL_AUTO_REJECTED` / MCP 握手 15s 降级 / skills fetch 30s / LLM 流停滞 90s 看门狗 `streamStallMs`)+ **可见性**(兜底收口必留痕)+ **abort 收口**(activeControllers 注册表;send/batch 接 signal 可中断;unmount/switchSession/resetSession 先断流;stop() 清排队记 debugLogs)。D-1/D-2 拍板落地。见 `archive/2026-08-11-fix-hang-and-feedback/`。

> **2026-08-11 发布 2.38.2**:`fix-authorization-surface` 实施完成并归档 —— 审计 P0-1(子 agent allowedTools 装配断层:rag/html 能力包 vfs 工具恒不可见)+ P1-15/16/18/21/22(子栈继承 approval/permissions + approval_request 直通转发 / spawn 自授收紧 + 装配期源头 filter / writablePaths guard 补根写拦截 / focus strict 兑现 + eval_script 拦截 / permissions 根 scope 校验 / 子 offload 桥接主 vfs)。Q1-Q5 拍板落地。见 `archive/2026-08-11-fix-authorization-surface/`。

> **audit-sdk-integrity(进行中)**:SDK 完整性审计 —— 产出 `2026-08-10-audit-sdk-integrity/audit-report.md`(**P0×1 + P1×27** + P2×64 + P3×33,H1-H28 全落结论;§十一 二审复核)。**P0 已修(2.38.2)**;无疑问 P1 已修(2.38.1);组 1 七项已修(**2.39.0**);组 3 三项+N1 已修(**2.40.0**)。待立:fix-data-integrity 剩余项(P1-8/9/11/19/25/26);P2→deferred.md 登记(带触发条件)。见 `2026-08-10-audit-sdk-integrity/`。

> **2026-08-10 发布 2.37.0**:`add-capability-packs` 实施完成并归档(专用子 agent 工厂 `createRagSubagent`/`createHtmlSubagent` + 子 agent 架构扩展 `allowedTools`/`middleware`/`summarization` + `sdk.vfsWrite` + `rag-search`/`html-builder` skill + `rag-subagent-demo`/`html-subagent-demo` + augmentPrompt 委派引导)。见 `archive/2026-08-10-add-capability-packs/`。

> **2026-08-10 发布 2.38.0**:`add-subagent-observability` 实施完成并归档(子 agent 观察层:`createSubagentTracker` + `inspect().subagent.{active,history}` + `sdk.getActiveSubagents()`/`sdk.subagentHistory` + DebugDrawer「🤖 子 agent」tab;纯观察层不改生命周期/事件链)。见 `archive/2026-08-10-add-subagent-observability/`。

> **2026-08-08 归档(未实施,被取代)**:`fix-context-window-stale-on-setllm` —— 其核心问题(setLlm 后 contextWindow 陈旧不回灌,切小窗口模型 + 历史超新窗口时 compressInput 用旧阈值不触发)由同期 `harden-context-resilience` 的「三闸跟随窗口 + 反应性重试」覆盖解决,本独立 change(方案 B 独立 setter)未实施直接归档。见 `archive/2026-08-08-fix-context-window-stale-on-setllm/`。

> **2026-08-10 发布 2.36.0**:`add-headless-subpath` 实施完成并归档(新增 `page-agent-sdk/headless` 精简子路径:纯核心不含 UI,ESM 333KB vs 主包 789KB;依赖反转 `_createChatSdk` + 双入口;主包零变化)。见 `archive/2026-08-10-add-headless-subpath/`。

> 2026-08-08 发布 **2.27.0**:`recall-and-trim-llm`(P1 召回 + trim LLM)+ `context-persist-resilience`(mission/workingMemory 持久化 + trim 收口 GC 归档)实施完成;`context-history-resilience` umbrella 归档(P1+A 收口;B 类决策 #2 维持「对话文本」模型;P2 其余 deferred)。已归档见 `archive/`。

## 全景盘点(暂缓)

> placeholder-protected-read-write、agent-driven-compression 已实施并归档(见 `archive/`),原「暂缓」记录过时,本表移除。

| change | 类型 | 工作量 | 完成度 | 暂缓理由 |
|---|---|---|---|---|
| chatdialog-component-split | ChatDialog 原子化重构 | L | ⚠️ 索引失真待核 | 标「0/46 暂缓」但代码已实施(message/* + chatContext + 容器化,CLAUDE.md 按拆分后描述);「暂缓」或仅指拼装示例 demo 残项 —— audit-sdk-integrity A5 核实修正 |

> 详见 [`deferred.md`](../deferred.md)(暂缓理由 + 重启触发)。

## 写链串行约束(若重启)

harden-large-json-write 的 A4(子路径 hash)已随 change 归档推后;placeholder(freeze/verbatim)已实施发布。两者都改 `commitSetToBind`/`applyPatchesToBind` 同段 —— 若 A4 将来重启,需基于 placeholder 已落地的写链现状协同评估。`fix-write-safety-bypass` 已发布(2.23),写链地基已稳。

## 维护约定

- change 归档(移 `archive/`)→ 从本表删除。
- 重启某项 → 从 deferred 移回,加本表 + `project.md`「进行中」。
