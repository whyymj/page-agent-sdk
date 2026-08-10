# Specification Delta: page-agent-core

> change `add-subagent-observability` 对主 spec 的增量 Requirement。归档时合入。

## Requirement: 子 agent 运行状态与任务概要管理(观察层)

系统在 subagent 中间件维护**会话级运行状态**(active/history),供主 agent / DebugDrawer / 集成方查询子 agent 运行情况:当前几个在跑、各 task 概要、进度步数、状态、耗时、结论摘要。**纯观察层**(不改子 agent 一次性生命周期、不改并行机制、不改事件结构);复用 wrapToolCall + makeForward 捕获。

- **state 跟踪**(createSubagentsMiddleware/createSubagentMiddleware 闭包):`activeSubagents: Map<taskId, SubagentRunState>`(运行中)+ `subagentHistory: SubagentRunState[]`(历史,LRU ≤ `historyLimit` 默认 20)。`SubagentRunState = { taskId, task, label, status:'running'|'done'|'error', steps:[{kind,name,ts}], startedAt, durationMs?, resultPreview? }`。
- **捕获**:`wrapToolCall` before 记 active(主调 use_<id>/spawn 时;task=args.task/prompt, label=id/role);`makeForward` 累积 steps(子工具进度,只记 kind+name+ts,不含 args/result 全文);`wrapToolCall` after 更新 status/durationMs/resultPreview(截断)→ 移入 history。**同步旁路**(纯内存更新,零阻塞,不改 forward 返回/事件结构)。
- **inspect().subagent 扩展**:加 `active?: SubagentRunState[]`(运行中,空=无在跑)+ `history?: SubagentRunState[]`(历史 LRU)。实时反映中间件 state。
- **DebugDrawer 新增「🧬 子 agent」tab**:运行状态卡片(task/label/status 徽标/进度步数/已耗时)+ 历史列表(task/label/status/durationMs/resultPreview,展开 steps)。空 → 提示未委派。
- **sdk API(可选)**:`sdk.getActiveSubagents(): SubagentRunState[]` + `sdk.subagentHistory: SubagentRunState[]`(集成方 headless watch 自建 UI)。
- **一次性保持(天然重置)**:不持久化子 agent / 不做 reset API(重新委派 use_<id> 即全新上下文 = 重置,过程隔离设计)。
- **会话级**:state 不进 storage(不跨刷新);history LRU ≤20;steps 非全文(防膨胀)。
- **向后兼容**:全增量(state 新字段 + inspect 扩展 + tab + 可选 API);不改现有 subagent 机制/事件/工具。
- **可测约束**:① 模拟 use_<id> 委派(mock 子 agent)→ inspect().subagent.active 含该 taskId(status running);② 完成 → active 空 / history 含(status done + durationMs + resultPreview);③ steps 累积(子工具调用数);④ spawn_agents 多任务 → active 多 entry(各 taskId);⑤ history LRU ≤20(超限丢最旧);⑥ resultPreview 截断;⑦ 不改 subagent 事件结构(回归:现有 useChat 嵌套/hook 不破)。
