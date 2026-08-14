# Proposal: CA 并发修复 —— per-call context 通道(RunnableConfig.configurable)

## 动机(audit CA 并发组 P2×2,deferred 登记)

默认 `maxParallelTools=1`(串行)掩盖两个并发缺陷;并行委派(researcher preset `maxParallel:4`)或用户开 `maxParallelTools>1` 即踩:

1. **activeScope 并发错乱**:dataOps `activeScope` 是闭包单变量,`wrapWithScope` 的 enter/exit 窗口含 await(工具校验/审批等待),并行委派/主子并行工具交错时 scope 互相覆盖 → 乐观锁基线读写错 scope(子污染主 / 主写落子 scope)
2. **createSubagentsMiddleware 闭包单变量(M3)**:`currentSignal/currentEmit/currentLogSink` 由 wrapToolCall 赋值,并发工具互相覆盖 → 子 agent 继承无关工具的 signal(停止信号错乱)/ emit(进度转发到错误 handler)

## 方案:per-call context 经 RunnableConfig.configurable

**通道**(已实测验证:LangChain tool.invoke(input, {configurable}) → fn 第二参 config,且 zod 校验重建 args 对象/剥未知键,args 注入通道不可行,configurable 是唯一干净通道):

```
wrapToolCall(ctx, next):ctx.callConfig = { signal, emit, logSink, scopeId... }  # 中间件按调用注入
  → next(ctx) 洋葱保持同 ctx
    → coreExecTool:target.invoke(ctx.args, { configurable: ctx.callConfig })
      → 工具 fn (args, config) => config.configurable.__pgXxx   # per-call 读取
```

- `ToolCallContext` 加 `callConfig?: Record<string, unknown>`(中间件 per-call 注入 bag)
- **M3 修复**:subagent 两处中间件(spawn + 预声明)wrapToolCall 注入 `__pgSubagentCall: { signal, emit, logSink }`;spawn/use_<id> 工具 fn 第二参优先取,闭包单变量降为 fallback
- **scope 修复**:`wrapWithScope` invoke 透传 `configurable.__pgDataScope = scopeId`(enter/exit ambient 保留为兜底);dataOps 工具 fns 加 config 第二参,`resolveScope(cfg)` 优先 per-call token,`getBaseline/setBaseline` 加可选 scope 参数线程化
- 约定键名 `__pg` 前缀(框架内部标记,同 `__pgId` 哲学)

## 影响面

| 文件 | 改动 |
|---|---|
| `harness/middleware.ts` | ToolCallContext + callConfig |
| `harness/createAgent.ts` | coreExecTool 传 `{ configurable: ctx.callConfig }` |
| `harness/subagent.ts` | 两处 wrapToolCall 注入 + 工具 fns 第二参读取;wrapWithScope config 透传 |
| `tools/dataOps.ts` | scopeOf/getBaseline/setBaseline 可选 scope 参数;各工具 fn 线程化 |

## 非目标

- 不改默认 maxParallelTools=1(并发仍 opt-in,本次只是拆雷)
- 不引入 AsyncLocalStorage(浏览器不可用)/zone.js
- dataOps 内部纯 helper 无 scope 参数的保持 ambient fallback(不劣于现状)
