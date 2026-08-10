# Tasks: add-subagent-observability

> `/opsx:apply` 按此执行。A state 跟踪 → B inspect → C DebugDrawer tab → D 测试文档发布。纯观察层,改动集中(subagent.ts 中间件 + DebugDrawer + types)。

## 阶段 A:state 跟踪(`src/core/harness/subagent.ts`)

- [x] A1 定义 `SubagentRunState` 类型 + 导出 `{ taskId, task, label, status, steps[], startedAt, durationMs?, resultPreview? }`
- [x] A2 `createSubagentsMiddleware` 闭包加 `activeSubagents: Map` + `subagentHistory: []`(LRU ≤ historyLimit 默认 20);暴露 getter(getActive/getHistory)
- [x] A3 `wrapToolCall` before 记 active(主调 use_<id>:task=args.task, label=s.id, status running, startedAt);`makeForward` 累积 steps(子工具 kind+name+ts);`wrapToolCall` after 更新 status done/error + durationMs + resultPreview(截断 120)→ 移入 history(LRU)
- [x] A4 `createSubagentMiddleware`(spawn)同样:spawn_agent 记 active(task=args.prompt, label=role);spawn_agents 记多(taskId 各异)
- [x] A5 selftest(逻辑层):模拟 wrapToolCall before/after + makeForward → active/history 正确;status 转换;steps 累积;LRU 上限;resultPreview 截断

## 阶段 B:inspect 扩展(`src/core/sdk/createChatSdk.ts` + `types`)

- [x] B1 `SubagentInfo` 加 `active?: SubagentRunState[]` + `history?: SubagentRunState[]`;getInfo 从中间件 getter 取(实时)
- [x] B2 `inspect().subagent.active` / `.history` 反映;空数组兜底(无委派)
- [x] B3 (可选)`sdk.getActiveSubagents()` / `sdk.subagentHistory`(便利 API)
- [x] B4 types/index.d.ts + types/headless.d.ts 同步(SubagentInfo 扩展 + SubagentRunState 导出)

## 阶段 C:DebugDrawer「🧬 子 agent」tab(`src/core/components/DebugDrawer.vue`)

- [x] C1 新增 tab「🧬 子 agent」:运行状态卡片(active:task/label/status 徽标 running 绿/done 灰/error 红/进度步数/已耗时)
- [x] C2 历史列表(history:折叠式;task/label/status/durationMs/resultPreview;点击展开 steps)
- [x] C3 空态提示「尚未委派子 agent」
- [x] C4 infoTick 驱动刷新(state 变更 → infoTick++ → tab 实时)

## 阶段 D:测试 + 文档 + 发布(minor 2.38.0)

- [x] D1 e2e 新增断言:inspect().subagent.active/history(mock 委派);或扩 subagents.mjs
- [ ] D2 浏览器 E2E(可选):DebugDrawer 子 agent tab 渲染(mock use_html → tab 显示 active/done)
- [x] D3 文档:README/usage-guide 中英(子 agent observability)+ CLAUDE.md(DebugDrawer tab + inspect.subagent.active/history + 计数)
- [ ] D4 发布:add-capability-packs 2.37.0 发布后;本 change 2.38.0;build → test → e2e → browser → exports → types → size → pack → publish

## 验证门禁

- **回归**:subagent 事件/useChat 嵌套/hook 不破(捕获只加 state 旁路,不改事件结构)
- **新**:inspect().subagent.active/history 正确(selftest + e2e);DebugDrawer tab 渲染(浏览器)
- **LRU/截断**:history ≤20;resultPreview 截断;steps 非全文
- **性能**:state 更新同步旁路,零阻塞(不进子 agent ReAct)
