# Tasks: ca-concurrency-per-call-context

> **minor**(并发正确性修复,默认串行行为零变化)。A 通道 + M3 → B dataOps scope 线程化 → C 测试 → D 文档。

## 阶段 A:per-call 通道 + M3 子 agent 闭包修复

- [x] A1 `middleware.ts` ToolCallContext 加 `callConfig?: Record<string, unknown>`;`createAgent.ts` coreExecTool 经 `{ configurable: ctx.callConfig }` 透传
- [x] A2 `subagent.ts` 两处中间件(spawn/预声明)wrapToolCall 注入 `__pgSubagentCall: { signal, emit, logSink }`;spawnOne/spawnMany/use_<id> 工具 fns 加 config 第二参优先取,闭包单变量降 fallback(注释更新)
- [x] A3 `wrapWithScope` invoke 透传 config + `configurable.__pgDataScope`

## 阶段 B:dataOps scope 线程化

- [x] B1 `scopeOf(cfg)` 解析器(configurable.__pgDataScope 优先,ambient 兜底);getBaseline/setBaseline 加可选 scope 参数
- [x] B2 各 dataOps 工具 fns 加 config 第二参,调用点传 scope(get/set/read/write/edit/delete/draft/query/search/eval 等 ~21 处 setBaseline/getBaseline + 2 处 summarize isMainScope)

## 阶段 C:测试(同 commit)

- [x] C1 selftest:config 通道端到端(tool fn 第二参读 configurable;并发交错下 per-call 值不串)
- [x] C2 selftest:dataOps 并发 scope 隔离(两个 scope 交错 setBaseline/getBaseline 不串)
- [x] C3 e2e 回归(1944/580 计数同步)

## 阶段 D:文档

- [x] D1 CLAUDE.md 并发段一句话 + deferred.md CA 组标 ✅;CHANGELOG [Unreleased]

## 阶段 E:发布

- [x] E1 已随 3.7.0 发布
