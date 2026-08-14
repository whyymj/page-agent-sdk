# Specification Delta: page-agent-core

> 本文件为 change `html-agent-craft-notes` 的增量 Requirement。2 个 Requirement(①组件工匠笔记 / ②主 agent 偏好转述)。**minor**(向后兼容)。

## Requirement: 组件工匠笔记(__pgNotes)

createHtmlSubagent 默认开启工匠笔记(craftNotes 默认 true):子 agent 收口回复中 `[note] ` 前缀行沉淀为该组件的 `__pgNotes`(FIFO ≤5 条 × 200 字),下次委派同组件时经组件代码文件地图注入 —— 实现同组件跨委派的设计意图持续(状态在数据里,不在子 agent 实例里)。

- **存储**:组件对象 `__pgNotes: string[]` sidecar 字段;随 data json 持久化(跨会话);read 投影隐藏(`__pg*` 现成)、LLM write 写不进(isPathAllowed 拒 `__pg*` 段)、不进 schema(框架直改 bind)
- **沉淀**:codeAssetMiddleware.afterAgent(commit 后)提取子 agent 最终回复的 `[note] ` 行 → 归属 touched 组件 → FIFO append;无 `[note]` 行不沉淀;同轮重复行去重
- **注入**:augmentPrompt 组件代码文件地图每组件追加「📝 笔记×N(最近):…」一行 + 地图头交接引导
- **子 agent 侧**:htmlSystemPrompt 约定收尾回复末尾附 1 行 `[note] 实现要点`(关键设计决策/用户偏好/踩坑)
- **opt-out**:createHtmlSubagent({ craftNotes: false })→ 零沉淀零注入
- **可测约束**:① afterAgent 沉淀生效 ② FIFO/截断 ③ 无 [note] 不沉淀 ④ 地图注入 📝 行 ⑤ read 投影不见 __pgNotes ⑥ craftNotes:false 零行为

## Requirement: 主 agent 偏好转述

htmlOrchestratorPrompt【委派 task 规格化】补第 ⑤ 要素(可选):聊天上下文中有与该组件相关的用户历史偏好/反馈时,提炼一句附 task 末尾(新子 agent 无记忆,偏好经 task 传递)。

- **可选不强制**:无历史偏好则省(4 要素仍为核心)
- **同源**:htmlOrchestratorPrompt(id) 纯函数(静态快照 htmlPageOrchestrator 自动跟随)
- **可测约束**:htmlOrchestratorPrompt('html') 含历史偏好转述条
