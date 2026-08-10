# Change: add-subagent-observability(子 agent 运行状态与任务概要管理)

> 状态:proposal(未实施)。**非破坏 minor 2.38.0**(add-capability-packs 2.37.0 发布后的下个 change)。与 add-capability-packs 正交(不改子 agent 机制,只加观察层)。

## Why

多子 agent 场景(并行 HTML/RAG、复杂编排、低代码多代码组件)需**集中 observability**:运行状态汇总(几个在跑 / 各 task / 进度 / 状态)+ 任务概要(委派历史 / 结果 / 耗时)。

现状只有**事件级零散进度** + **配置展示**,无集中管理:

| 现状 | 缺什么 |
|---|---|
| subagent 事件 `{taskId,label,kind,name,result,status}` → useChat 嵌套在 spawn 步骤下;hook 可监听 | 运行状态汇总(运行中/完成/失败 + task + 进度,集中视图) |
| `inspect().subagent`(enabled/maxDepth/maxParallel/allowedTools 配置)+ DebugDrawer 配置段 | 任务概要(委派历史 + 结果 + 耗时面板) |
| messages 里 use_<id> tool_call + result(散落) | 并行时看不出全局(A 跑第 3 步 / B 跑第 5 步 / 谁 done) |

并行子 agent(用户场景:并行多个 HTML 代码组件)时尤其需要 —— 现状零散事件无法回答「现在几个子 agent 在跑、各在做什么、跑到哪、谁完成了」。

## What Changes

新增**子 agent 状态管理模块**(纯观察层,不改子 agent 生命周期):

1. **subagent 中间件 state 跟踪**:`activeSubagents: Map<taskId, SubagentRunState>` + `subagentHistory: SubagentRunState[]`(LRU)
2. **`inspect().subagent` 扩展**:加 `active`(运行中)+ `history`(历史)
3. **DebugDrawer 新增「🧬 子 agent」tab**:运行状态卡片(task/label/status/进度步数/耗时)+ 历史列表(任务概要)
4. **(可选)sdk API**:`sdk.getActiveSubagents()` / `sdk.subagentHistory`(便利查询)

`SubagentRunState = { taskId, task, label, status:'running'|'done'|'error', steps[], startedAt, durationMs?, resultPreview? }`

## Impact

- **增量纯观察层**:不改子 agent 生命周期(一次性保持)、不改并行机制、不改 forward/事件链;只在中间件加 state + inspect 扩展 + UI tab
- **捕获复用现有链**:`wrapToolCall`(主调 use_<id>/spawn 前后)+ `makeForward`(子工具进度→steps);零新基建
- **向后兼容**:全增量(state 新字段 + inspect 扩展 + 新 tab);发 minor 2.38.0
- **文档**:中英文 README/usage-guide + CLAUDE.md

## 决策

1. **一次性保持(天然重置)**:子 agent 委派 spawn→跑→销毁;重新委派即全新上下文(= 重置)。**不持久化子 agent、不做 reset API**(新委派即重置,过程隔离设计)。
2. **state 会话级(不持久化跨刷新)**:运行态/历史是会话内观察,不进 storage(未来可加持久化,本期 Non-goal)。
3. **捕获复用现有链**:createSubagentsMiddleware/createSubagentMiddleware 的 `wrapToolCall`(记 active 前/后)+ `makeForward`(累积 steps);不改事件结构。
4. **history LRU 上限**(默认 20):防长会话膨胀;集成方可配。
5. **steps 摘要而非全文**:steps 只记 `{kind, name, ts}`(工具名 + 时间),不含 args/result 全文(防膨胀;全文在 messages/事件)。

## Non-goals

- **不持久化子 agent / 不做 reset API**:一次性天然重置(重新委派即新上下文);持久实例破坏过程隔离。
- **不改并行机制**:`maxParallel`/`maxParallelTools` 不动。
- **state 不跨刷新持久化**:会话级(未来可加)。
- **不做子 agent 间通信**:主 agent 编排够。
- **不存 steps 全文**(args/result):只摘要(全文在 messages);防观察层膨胀。
- **不改 subagent 事件结构**:forward/事件不变,只加 state 累积。
