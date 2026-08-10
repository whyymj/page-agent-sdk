# 活跃 Changes 优先级索引

> **2026-08-10 发布 2.37.0**:`add-capability-packs` 实施完成并归档(专用子 agent 工厂 `createRagSubagent`/`createHtmlSubagent` + 子 agent 架构扩展 `allowedTools`/`middleware`/`summarization` + `sdk.vfsWrite` + `rag-search`/`html-builder` skill + `rag-subagent-demo`/`html-subagent-demo` + augmentPrompt 委派引导)。见 `archive/2026-08-10-add-capability-packs/`。

> **下个 change(add-subagent-observability)**:子 agent 运行状态与任务概要管理(观察层:active/history state + `inspect().subagent` + DebugDrawer tab);proposal/design/specs/tasks 已就绪,待 `/opsx:apply`。见 `2026-08-10-add-subagent-observability/`。

> **2026-08-08 归档(未实施,被取代)**:`fix-context-window-stale-on-setllm` —— 其核心问题(setLlm 后 contextWindow 陈旧不回灌,切小窗口模型 + 历史超新窗口时 compressInput 用旧阈值不触发)由同期 `harden-context-resilience` 的「三闸跟随窗口 + 反应性重试」覆盖解决,本独立 change(方案 B 独立 setter)未实施直接归档。见 `archive/2026-08-08-fix-context-window-stale-on-setllm/`。

> **2026-08-10 发布 2.36.0**:`add-headless-subpath` 实施完成并归档(新增 `page-agent-sdk/headless` 精简子路径:纯核心不含 UI,ESM 333KB vs 主包 789KB;依赖反转 `_createChatSdk` + 双入口;主包零变化)。见 `archive/2026-08-10-add-headless-subpath/`。

> 2026-08-08 发布 **2.27.0**:`recall-and-trim-llm`(P1 召回 + trim LLM)+ `context-persist-resilience`(mission/workingMemory 持久化 + trim 收口 GC 归档)实施完成;`context-history-resilience` umbrella 归档(P1+A 收口;B 类决策 #2 维持「对话文本」模型;P2 其余 deferred)。已归档见 `archive/`。

## 全景盘点(暂缓)

> placeholder-protected-read-write、agent-driven-compression 已实施并归档(见 `archive/`),原「暂缓」记录过时,本表移除。

| change | 类型 | 工作量 | 完成度 | 暂缓理由 |
|---|---|---|---|---|
| chatdialog-component-split | ChatDialog 原子化重构 | L | 0/46 | 无功能价值 |

> 详见 [`deferred.md`](../deferred.md)(暂缓理由 + 重启触发)。

## 写链串行约束(若重启)

harden-large-json-write 的 A4(子路径 hash)已随 change 归档推后;placeholder(freeze/verbatim)已实施发布。两者都改 `commitSetToBind`/`applyPatchesToBind` 同段 —— 若 A4 将来重启,需基于 placeholder 已落地的写链现状协同评估。`fix-write-safety-bypass` 已发布(2.23),写链地基已稳。

## 维护约定

- change 归档(移 `archive/`)→ 从本表删除。
- 重启某项 → 从 deferred 移回,加本表 + `project.md`「进行中」。
