# Design: fix-hang-and-feedback(统一超时/可见性/abort 收口)

> Q3 拍板产物。七个挂起点(P1-1..7)共用一套契约;先评审本文,定稿后按 tasks.md 实施。

## §0 缺口模型

所有挂起点可归为两类 Promise:

- **等人型**:approval / humanConfirm —— 等用户 resolve。有 UI 时有人在环;send/batch/unmount 后**无响应方** → 永挂
- **等外部 IO 型**:MCP 握手 / skills fetch / LLM chunk 流 —— 对端黑洞(不拒绝也不响应)→ 永挂

统一病根三条,对应三契约:**零超时**(无兜底计时器)、**零可见**(挂起不外发、无事件、日志静默)、**abort 不穿透**(send/batch 不带 signal;unmount/switchSession 不收口在途流)。

## §1 契约 A:超时默认值表

| 挂起点 | 默认 | 配置入口 | 计时语义 | 超时行为 |
|---|---|---|---|---|
| approval/humanConfirm(**有响应方**:stream+UI handler) | **0 = 无限等**(现状不变) | `approval.timeoutMs`(既有) | 挂起期间计时,resolve 即清 | 按既有 timeoutMs 拒(现状) |
| approval/humanConfirm(**无响应方**:send/batch invoke 路径) | **30s** | `approval.timeoutMs` 显式传值覆盖(传 0 也按 30s——该路径无 UI,0 无意义;显式传负数/`Infinity` = 无限等,给「自有确认通道」集成方留口) | invoke 期间监听 approval_request,首次未响应起表 | **自动拒绝** + emit error(observable,code=APPROVAL_AUTO_REJECTED,含 toolName) |
| MCP 握手(connect) | **15s** | `mcp[].timeoutMs`(新,可选) | `client.connect` 全程(含 sse/ws onopen) | 该 server 按连接失败处理(allSettled rejected + warn 日志 + inspect().mcp 不出现);**不阻塞其余 server 与 SDK 启动** |
| skills 远程 fetch(doc/script) | **30s**(对齐 fetchDoc 先例) | 内部常量(不开放配置;远程 skill 本就少见) | fetch 全程(AbortController) | DocReadResult error「超时」→ load_skill 工具结果回灌 LLM 自纠(换 skill/不再等) |
| LLM 流停滞(chunk 间隔) | **90s** | `streamStallMs`(新,可选;0 = 关) | 首个 chunk 起每收到 chunk 重置;等首 chunk 同样计时(防 prefill 假死后黑洞) | abort 本次模型调用 → 抛 `STREAM_STALLED`(severity fatal,不走 withRetry——停滞重试大概率复现,且已耗 90s;UI 显错误条,send throw) |

设计依据:
- approval 30s:无响应方路径下「等」没有任何收益,30s 足够覆盖「集成方自建确认 UI 监听事件」的接线时间;真有自建通道者可显式 Infinity
- MCP 15s:握手本应 <1s,15s 宽容弱网;黑洞端点(防火墙吞 SYN)是最常见故障形态
- 流停滞 90s:大上下文 prefill 实测可达 30-60s(1M 窗口),90s 留裕量;正常生成 chunk 间隔 <5s,误报面极小

## §2 契约 B:可见性事件约定

**原则:任何挂起被兜底收口,必须留下三痕迹之一 —— 结构化 error 事件 / warn 日志 / inspect 反射。**

1. **error 事件**(经 sdk emit,observable 级,不中断主流程):
   - `APPROVAL_AUTO_REJECTED`:`context:{ toolName, waitedMs }`
   - `STREAM_STALLED`:`context:{ waitedMs, model }`(fatal 级,随错误上抛路径 emit)
   - MCP/SKILL 超时走 warn 日志 + 工具结果回灌(LLM 可见),不再发 error 事件(启动期无监听器 / 工具回灌已是最佳反馈面)
2. **approval_request 维持不外发**(events.ts 过滤不动):防集成方误 resolve 双重收口。非 UI 路径的「可知性」由 ①自动收口后的 error 事件 ②send/batch 的 reject 错误信息 承载
3. **DebugDrawer 日志**:四类超时各记一条 log(approval/mcp/skill/stall),便于现场排查
4. **inspect 反射**:`inspect().mcp.servers` 只含握手成功的(失败可见于 debugLogs,不新增字段)

## §3 契约 C:abort 收口

```
sdk 级 activeControllers: Set<AbortController>(createChatSdk 闭包)

登记:stream()/send()/batch() 入口各建一个 controller
  - 与调用方传入的 signal 联动(外部 abort → 内部 abort)
  - invoke/stream 一律带该 signal(补齐 send/batch 缺失的 signal 穿透)
注销:finally(无论 settle/abort/抛错)
收口(unmount / switchSession / resetSession(store) / release 归零):
  1. abort 全部 activeControllers(在途流停止:LLM 流中断 + 工具 abort 联动 + approval/humanConfirm 自动拒 —— 三者已内置 signal 监听,abort 即收口)
  2. conflictMgr.resolve('keep_external')(既有)
  3. emit 无新增(abort 是主动行为,不需要错误事件)
```

- **hide() 不收口**(设计语义:保留生成进程);仅 unmount 真收口
- **useChat(UI)** 无需改:其 stream 调用经 sdk.stream 登记,unmount → abort 链路自动覆盖;useChat.reset 既有 abort 保留(双保险)
- **switchSession**:initDone await 之后先收口(abort + approval 拒)再切,修 P1-10 的「在途流写进新会话」
- **runSerial 交互**:被 abort 的 send/batch 以 abort 错误 reject → serial 链照常推进(`then(fn, fn)` 双路),排队操作不卡死 —— P1-1/P1-5 的「后续操作静默排队永挂」被解除(有界 + 链推进)

## §4 七项落地映射

| # | 改动 | 文件 | 契约 |
|---|---|---|---|
| P1-1 | send/batch 的 invoke 传 sdk 侧 handler:监听 approval_request → 无响应 30s 自动拒 + emit error;humanConfirm 同 | createChatSdk.ts(send/batch)+ createAgent.ts(invoke 增 onEvent 参,透传 stream 内部 handler) | A+B |
| P1-2 | connectMcp 加 `timeoutMs`(默认 15s):`Promise.race([connect, timer])`,超时先 `transport.close?.()` 再抛 | mcp/client.ts + createChatSdk.ts(传参) | A+B |
| P1-3 | unmount 收口序 = 契约 C(activeControllers abort → approval 随 signal 自动拒 → conflict 既有) | createChatSdk.ts | C |
| P1-4 | `SendOptions.signal?: AbortSignal`;core.send 建 controller 联动外部 signal → invoke(messages, signal);batch(tasks, onProgress, signal?) 同,每任务循环头查 aborted 提前收(剩余任务记 `{ok:false, error:'aborted'}`) | createChatSdk.ts + types(两处 d.ts SendOptions/batch 签名) | C |
| P1-5 | 根治 = 组内各超时(流不再永挂 → finishRound 必达 → 队列必推进);stop() 语义保持清空 + 补一条 debugLog(丢弃条数与内容摘要)。**续跑增强推后(D-1)** | useChat.ts(仅日志) | A 间接 |
| P1-6 | readSkillDoc/fetchSkillScript 加 AbortController 30s;超时 → `{ok:false,error:'读取超时(30s)'}` / script null | harness/skills.ts | A+B |
| P1-7 | coreModelCall 的 chunk 迭代包 `withStallTimeout`(纯函数:包 AsyncIterable,间隔超时抛 STREAM_STALLED);options.streamStallMs 透传 createAgent;停滞抛错不进 withRetry(isRetryable 排除该错误类型) | utils/(新 stallTimeout.ts)+ createAgent.ts + createChatSdk.ts + types | A+B |

## §5 风险与决策点

| 风险/决策 | 处理 |
|---|---|
| 慢网/大模型 prefill 误报流停滞 | 默认 90s 保守;0 可关;错误文案含 waitedMs 便于集成方调参 |
| 用户看确认框超 30s 被自动拒? | 不会 —— 有响应方(stream+handler)路径默认 0 无限等;**仅 send/batch 无响应方路径**启用 30s |
| 自建确认通道的 headless 集成方(监听事件自建 UI)被 30s 抢先 | approval.timeoutMs 显式传 Infinity/负数 = 无限等(design 留口);文档注明 |
| MCP 超时后 server 工具缺失,LLM 调用不存在的工具 | 现状失败路径同(allSettled 隔离 + warn);工具调用报「不存在」回灌自纠,非新增风险 |
| **D-1 ✅ stop() 清队列**(2026-08-11 拍板) | **保持清空 + 补可见性(debugLog 丢弃条数/摘要)**;续跑需「暂停态 + 恢复入口」UX 全套,收益窄,列 P2 推后 |
| **D-2 ✅ stream 路径 approval 默认超时**(2026-08-11 拍板) | **不加**(0=无限等):UI 场景用户可能在阅读长方案;要超时自己传 timeoutMs(既有能力)。仅无响应方路径兜底 |

## §6 测试策略

- **selftest**:withStallTimeout 纯函数(到点抛/收到重置/关闭透传);connectMcp 超时(stub transport 永不 open);skills fetch 超时(stub fetch 挂起);approval 无响应方自动拒(中间件 + fake timer)
- **e2e**(stub model):① headless send + humanConfirm 工具调用 → 30s 内自动拒 + error 事件 + send reject(缩短超时配置加速);② unmount 中断在途 stream(断言不再产生后续事件/写入);③ send(signal) 外部 abort → invoke 中止;④ MCP 黑洞端点(不可达端口)→ SDK 正常启动 + warn
- **browser**:human-confirm 既有 2 项保持(验证 UI 路径不受影响);可选新增停滞模拟(mockLlm 发半截流挂住 → 90s 太长,测时注入短 streamStallMs)
- **计数同步**:CLAUDE.md/README 中英文

## §7 实施顺序(tasks.md 对应)

契约 C(abort 骨架,其余契约的载体)→ P1-4(send signal)→ P1-1(approval 自动拒)→ P1-3(unmount 收口)→ P1-7(stallTimeout)→ P1-2(MCP)→ P1-6(skills)→ P1-5(日志)→ 测试 → 文档 → 发布评审
