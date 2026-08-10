# Design: add-subagent-observability

> 技术设计。纯观察层,不改子 agent 生命周期/事件链。复用 wrapToolCall + makeForward 捕获。

## 1. state 设计(会话级,中间件闭包)

```ts
/** 单个子 agent 运行状态(观察层) */
export interface SubagentRunState {
  taskId: string
  /** 委派任务(use_<id> 的 task args / spawn_agent 的 prompt 摘要) */
  task: string
  /** 子 agent 标识(role / use_<id> 的 id / spawn label) */
  label: string
  status: 'running' | 'done' | 'error'
  /** 进度(子 agent 工具调用摘要,累积;只记 kind+name+ts,不含 args/result 全文) */
  steps: { kind: 'tool_call' | 'tool_result'; name: string; ts: number }[]
  startedAt: number
  /** 完成后填 */
  durationMs?: number
  /** 结论摘要(完成时;截断 N 字,非全文) */
  resultPreview?: string
}
```

中间件闭包(createSubagentsMiddleware 预声明 + createSubagentMiddleware spawn 各维护):
```ts
const activeSubagents = new Map<string, SubagentRunState>()
const subagentHistory: SubagentRunState[] = []  // LRU ≤ historyLimit(默认 20)
```

## 2. 捕获点(复用现有 wrapToolCall + makeForward)

### 2.1 createSubagentsMiddleware(预声明 use_<id>)

现有 `wrapToolCall`(捕获 signal/emit/logSink)+ `makeForward`(taskId)。扩展:

- **wrapToolCall before**(主调 use_<id>):记 active —— `activeSubagents.set(taskId, { taskId, task: ctx.args.task, label: s.id, status:'running', steps:[], startedAt: Date.now() })`
- **makeForward**(子工具进度):累积 `active.steps.push({ kind, name, ts: Date.now() })`
- **wrapToolCall after**(use_<id> 返回):更新 status=done/error + durationMs + resultPreview(截断);移入 history(LRU)

### 2.2 createSubagentMiddleware(spawn_agent/spawn_agents)

同样:`spawn_agent` wrapToolCall 记 active(task = args.prompt, label = role/子任务);`spawn_agents` 记多个(taskId 各异)。makeForward 累积 steps。

### 2.3 捕获不侵入 ReAct

- wrapToolCall/makeForward 已有(子 agent 中间件);只加 state 更新(同步,纯内存,零阻塞)
- 子 agent 本身无感知(观察层旁路);不改子 agent createAgent/工具/事件

## 3. 暴露

### 3.1 inspect().subagent 扩展

`SubagentInfo` 加:
```ts
export interface SubagentInfo {
  // 现有:enabled, maxDepth, maxParallel, allowedTools
  /** 运行中子 agent(观察层;空数组=无在跑) */
  active?: SubagentRunState[]
  /** 历史委派(LRU ≤20;任务概要) */
  history?: SubagentRunState[]
}
```
`inspect().subagent.active` / `.history` 实时反映(中间件 state getter)。

### 3.2 DebugDrawer「🧬 子 agent」tab

- **运行状态卡片**(active):task / label / status 徽标(running 绿/done 灰/error 红)/ 进度步数 / 已耗时
- **历史列表**(history):折叠式;每项 task / label / status / durationMs / resultPreview(点击展开 steps)
- 空(无 active/history)→ 提示「尚未委派子 agent」

### 3.3 sdk API(可选便利)

- `sdk.getActiveSubagents(): SubagentRunState[]`(运行中)
- `sdk.subagentHistory: SubagentRunState[]`(历史;响应式 ref 或 getter)

集成方可 watch 自建 UI(headless)。

## 4. history LRU + steps 摘要

- `historyLimit`(默认 20):超限丢最旧(纯内存,会话级)
- `steps` 只记 `{kind, name, ts}`(不含 args/result 全文;全文在 messages/事件,观察层不重复存)
- `resultPreview` 截断(默认 120 字)

## 5. 风险 + 回退

| 风险 | 缓解 |
|---|---|
| state 在并发子 agent(spawn_agents)竞态 | activeSubagents Map 按 taskId 隔离;每个子 agent 独立 entry,无共享写 |
| wrapToolCall/makeForward 改动影响现有转发 | 只加 state 更新(同步旁路),不改 forward 返回/事件结构;回归测验证 |
| history 膨胀 | LRU ≤20 + steps 摘要(非全文)+ resultPreview 截断 |
| DebugDrawer tab 新增体积 | 纯 UI(tab 懒加载),微增 |

**全可 revert**(增量 state + inspect 字段 + tab;不改子 agent 机制)。

## 6. 与现有机制关系

- **vs subagent 事件**:事件是实时流(hook/useChat 嵌套);state 是**累积汇总**(active/history 集中视图)。互补:事件给细节,state 给全局。
- **vs messages(use_<id> 记录)**:messages 是对话流;state 是结构化任务概要(便于 DebugDrawer/集成方 UI 聚合)。
- **vs inspect().subagent(配置)**:现有是配置(enabled/maxDepth);扩展加运行态(active/history)。
