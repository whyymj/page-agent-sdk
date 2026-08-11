# Change: fix-hang-and-feedback(挂起与反馈:统一超时/可见性/abort 收口)

> 来源:audit-sdk-integrity 组 1(P1-1/2/3/4/5/6/7)。Q3 已拍板:**先出统一 design,再逐项落地**(七个挂起点同一架构缺口,逐个修会得七套口径不一的闸)。
> 本 change 当前阶段 = design 评审;评审通过后才进实施。

## Why

审计组 1 的七个 P1 根因是同一个架构缺口:**「依赖人工 resolve / 外部 IO 的挂起点,在非流式/headless 路径零超时、零可见、abort 不穿透」**。

| # | finding | 现状证据 |
|---|---|---|
| P1-1 | approval/humanConfirm 在 send/batch 永久挂起且零可见 | send/batch 走 `agent.invoke` 不带 signal → approval 的 abort 联动失效;invoke 内部 handler 为 no-op → approval_request 无人响应;events.ts 又过滤 approval_request 不外发 → headless 连「有确认挂着」都不知道。**humanConfirm 默认开** → headless+send 场景 LLM 一调征询即挂死,后续 send/switchSession/batch 全被 runSerial 静默排队 |
| P1-2 | MCP sse/websocket 握手无超时 → initDone 永挂 | connectMcp 裸 `client.connect(transport)`;initDone await allSettled 不 settle → mount/send/switchSession/batch 全挂(都 await initDone),零反馈,集成方无 timeout 可自救 |
| P1-3 | unmount 不 abort 进行中流、不收口挂起 approval | unmount 只收口 conflict;幽灵流继续烧 token/写 bind/afterRound 落盘;approval 挂起中 unmount → Promise 永挂,shareContext 复用污染下次 mount |
| P1-4 | send 完全不可中断 | `send` 调 `invoke(messages)` 不传 signal(createAgent.invoke 支持 signal 但没接);SendOptions 无 signal 字段;headless 无停止按钮场景唯一出路=刷新 |
| P1-5 | 队列饥饿 | 排队推进以当前流 settle 为唯一前提(finishRound 在 finally)→ 流停滞/工具挂死则排队永不执行;唯一脱困 stop() 还清空整个队列(排队内容无声丢失) |
| P1-6 | skills 远程 fetch 无超时 | readSkillDoc/fetchSkillScript 裸 `fetch()` 无 signal → load_skill 永挂拖死当轮(同仓 fetchDoc 已有 30s AbortController 先例,此处漏配) |
| P1-7 | LLM 流停滞无看门狗 | `for await (chunk of stream)` 无 chunk 间隔超时 → 连接活着但不吐字时 loading 永转,唯一出路手动 abort |

## What Changes(统一机制,详见 design.md)

1. **契约 A 超时默认值表**:每个挂起点一个默认超时 + 配置入口(approval 无响应方路径 30s / MCP 握手 15s / skills fetch 30s / 流停滞 90s),口径统一、全部可配可关
2. **契约 B 可见性事件约定**:挂起被超时收口时一律 emit 结构化 error(observable,带 code 区分 APPROVAL_AUTO_REJECTED / MCP_HANDSHAKE_TIMEOUT / SKILL_FETCH_TIMEOUT / STREAM_STALLED);approval_request 保持不外发(防双重 resolve),改由「自动收口 + error 事件」保证非 UI 路径可知
3. **契约 C abort 收口**:sdk 级 activeControllers 注册表(stream/invoke 统一登记);send/batch 接 signal(SendOptions.signal / batch 第三参);unmount/switchSession/resetSession 先 abort 全部在途流 + 自动拒挂起 approval,再做原收口
4. 七项按契约落地(映射见 design.md §4);P1-5 的 stop() 清队列语义保持 + 补可见性(续跑增强列 P2 推后,design D-1)

## Impact

- **行为变化**:headless send/batch 挂起从「永久」变为「有界 + 有反馈」;MCP 黑洞端点从「全瘫」变为「降级跳过该 server」;LLM 停滞 90s 自动中断报错;unmount/switchSession 后无幽灵流
- **零回归面**:UI 交互确认(approval ApprovalBar)默认**仍无限等用户**(有 UI = 有响应方,不超时);hide() 保留进程不 abort(设计语义);stream 路径 approval timeoutMs 语义不变(0=等)
- **配置新增**:approval 语义扩展 + `streamStallMs` + `mcp[].timeoutMs`(全可选,不传 = 上述默认)
- **测试**:七挂起点各补「有界收口 + 事件可见」断言(selftest 逻辑层 + e2e 顶层 send/batch/unmount)

## Non-goals

- 组 2/3 的 P1(data-integrity / main-sub-isolation)另立 change
- approval_request 外发给 listeners(双重 resolve 风险,维持过滤;可见性走 error 事件)
- stop() 保留队列续跑(P2 增强,design D-1 记录)
- 工具级执行超时(工具挂死属另一面 —— 本期只收「模型流/确认/握手/拉取」四类挂起点;工具超时评估进 CA 维度下轮)
