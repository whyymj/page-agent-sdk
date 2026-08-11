# Tasks: fix-hang-and-feedback

> 组 1 七项(P1-1..7)。Q3 拍板:先出统一 design → **评审闸** → 实施。

## §0 design 评审闸
- [x] design.md 产出(契约 A 超时默认值表 / B 可见性事件 / C abort 收口 + 七项映射 + 风险)
- [x] **用户评审 design**(2026-08-11 拍板:D-1 保持清空+补可见性 / D-2 stream 路径不加默认超时;其余按 design)

## §1 契约 C:abort 骨架(其余契约载体)
- [x] createChatSdk:activeControllers 注册表;stream/send/batch 入口登记 + 调用方 signal 联动 + finally 注销
- [x] unmount/switchSession/resetSession(store) 收口序:abort 全部在途 → approval 随 signal 自动拒 → conflict(既有)

## §2 P1-4:send/batch 可中断
- [x] SendOptions.signal;core.send 建 controller → invoke(messages, signal);batch 第三参 signal + 循环头查 aborted
- [x] types/{index,headless}.d.ts:SendOptions.signal + batch 签名同步(types-alignment 门禁覆盖 send options)

## §3 P1-1:approval/humanConfirm 无响应方自动拒
- [x] createAgent.invoke 增 onEvent 参(透传内部 handler)
- [x] core.send/batch 传 sdk handler:approval_request → 30s(approval.timeoutMs 覆盖;Infinity 留口)无响应自动拒 + emit APPROVAL_AUTO_REJECTED(observable)

## §4 P1-7:LLM 流停滞看门狗
- [x] utils/stallTimeout.ts:withStallTimeout 纯函数(包 AsyncIterable,chunk 间隔超时抛 STREAM_STALLED)
- [x] coreModelCall 迭代接入;options.streamStallMs(默认 90s,0 关);isRetryable 排除停滞错误;types 同步

## §5 P1-2:MCP 握手超时
- [x] connectMcp(config, timeoutMs=15000):race + transport.close + 抛错(allSettled 隔离降级)
- [x] McpServerConfig.timeoutMs 可选;types 同步;debugLogs 记录

## §6 P1-6:skills fetch 超时
- [x] readSkillDoc/fetchSkillScript:AbortController 30s;超时结构化 error(回灌 LLM 自纠)

## §7 P1-5:队列可见性(根治靠组内超时)
- [x] useChat.stop():清空队列时补 debugLog(条数 + 内容摘要);续跑增强推后(D-1)

## §8 测试与收尾
- [x] selftest:stallTimeout / MCP 超时 / skills 超时 / approval 自动拒(各含「有界收口 + 可见」断言)
- [x] e2e:headless send 征询自动拒 / unmount 断流 / send(signal) abort / MCP 黑洞降级
- [x] browser:human-confirm 既有回归(+ 可选短 streamStallMs 停滞模拟)
- [x] 门禁全套 + 计数同步 + 文档(CLADE.md/README 中英文/usage-guide 中英文)
- [ ] commit develop;询问用户是否发布
