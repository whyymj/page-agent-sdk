# R8 UI 层审计(components/** + useChat/chatContext)· 基线 2.38.0

## Findings(严重度降序)

P1|hang|src/core/composables/useChat.ts:121,204-218|H26 队列饥饿确认:前一任务 stream 停滞(不 settle)则 finishRound 永不执行,queuedTasks 永不续跑,除 loading 动画外零反馈|队列推进只在 runAssistantStream 的 finally→finishRound;上游 LLM stream(createAgent.ts coreModelCall)与工具执行(coreExecTool,createAgent.ts:504-523)均无超时/停滞检测;serialRunner.ts:16 `chain.then(fn,fn)` 同构——挂死的 send 连带阻塞 sdk.switchSession/batch|stream 加无增量 watchdog(stallTimeout→error 反馈)+ 队列与当前轮解耦;stop 保留队列|mock 永不 resolve 的 fetchStream + 排队任务,断言超时反馈或队列可独立执行

P1|correctness|src/core/sdk/mountChatDialog.ts:28,44 × src/core/harness/createAgent.ts:298-314|内置 UI 的 DebugDrawer 日志列表与 ChatHeader 日志徽标在生成期间不刷新:debugLogs 是 shallowRef+原地 push+triggerRef,Wrapper 以同一数组引用下传 prop,ChatDialog 子树整轮不重渲|createAgent.ts:302 push 原地改同一数组;仅 stream 开始 `debugLogs.value=[]`(createAgent.ts:575)换新引用;Vue patch 对等引用 prop 跳过组件更新 → ChatHeader.vue:40,99 徽标与 DebugDrawer.vue:40-49 logs 冻结(开抽屉瞬间可读当前值,开着不增长)|改传 shallowRef 本体(DebugDrawer/FocusBar 已有消费 Ref 的模式)或每轮切新数组|browser 断言流式期间 .log-item 数量递增、徽标计数增长

P1|hang|src/core/sdk/createChatSdk.ts:2145-2160|unmount 不 abort 进行中的生成:幽灵流继续烧 token、写 bind、afterRound 落盘,而 release()(1583-1596)可能已 dispose store|unmount 仅收口冲突+摘 pagehide/visibility 监听+委托动画卸载,无任何路径调 useChat.stop/core 侧 abort;storage.dispose(storage.ts:586)后 save 仍可写|mounter ctx 暴露 stop,unmount 先 abort 当前 controller|e2e:生成中 unmount,断言 stream 被 abort、无后续 token/persist

P1|flow-divergence|src/core/sdk/createChatSdk.ts:1499-1544|H6 确认:core.switchSession 不 abort 进行中 stream——P1-b 修复只在 ChatHeader 按钮路径(useChat.reset),headless/编程式切换时幽灵流跨会话写同一 core.messages,UI 侧 loading/排队残留|switchSession 全文无 signal/abort;useChat.reset 唯一调用点 ChatHeader.vue:51-58;core.stream(2200)不经 runSerial|core 持有当前运行 signal,switchSession/resetSession 收口|e2e:stream 进行中 switchSession,断言旧流被 abort、messages 不串会话

P1|performance|src/core/composables/useMarkdown.ts:67-68|巨内容渲染冻结:每个流式 delta 触发 marked.parse+DOMPurify.sanitize+hljs.highlight 全文重算,无尺寸闸/无节流,代码块另经 encodeURIComponent 倍增;长回复+大代码块 O(n²) 卡死主线程|html=computed 随 content 每 delta 重算;renderer.code(useMarkdown.ts:29-41)对全块 hljs+encode;MessageContent.vue:95-97 onUpdated/watch 每 delta 重注入工具栏|超阈值降级纯文本/分段渲染 + delta 节流(rAF/时间窗)|单测:200KB markdown 渲染耗时上限;browser 大回复流式帧率

P2|crosstalk|src/core/sdk/mountChatDialog.ts:33 × src/core/sdk/createChatSdk.ts:2173-2183|UI 流式路径绕过串行闸:fetchStream=core.stream 直连(不经 runSerial),shareContext 双实例或 UI 发送+sdk.send 并发 = 两个 ReAct 循环并行跑同一 core.messages|runSerial 只包 send/batch/switchSession;core.send(1415)无 busy 标志;createAgent.stream(574-579)每次调用重置 state/debugLogs,并行互相冲掉|stream 纳入串行闸或加 core 级 busy 锁|selftest/e2e:并发两路 stream 断言串行或拒绝

P2|flow-divergence|src/core/components/DebugDrawer.vue:123-126|subagent tab「实时」名不副实:watch 由 infoTick 驱动,但 tracker start/pushStep/finish 从不 infoTick++,运行中卡片/步数不自动更新,需手动切 tab 才重拉|subagent.ts:88-116 tracker 无通知钩;grep infoTick subagent.ts 为空;仅 switchTab(118-122)主动拉|tracker 变更经回调 core.infoTick++(或独立 watch 源)|selftest:pushStep 后 infoTick 递增;browser 断言运行卡片步数自动增长

P2|correctness|src/core/composables/useChat.ts:284-291 × 204-218|reset() 不等待幽灵流收口:ghost finishRound 在 `await onPersist`(IDB 异步)之后才置 loading=false/currentController=null,间隙内用户新发消息会被 ghost 清掉新 controller、抹掉 loading → stop 失效/闸门开放致双流|finishRound 206 await onPersist 后 207-208 无条件写 state.loading/currentController|finishRound 持轮次序号,仅当仍是当前轮才动 controller/loading|单测:reset 后立即 sendMessage,断言新 controller 不被置 null

P2|flow-divergence|src/core/sdk/mountChatDialog.ts:92-128 × createChatSdk.ts:2086-2090|退出动画期间再 mount 走 show():cs-leaving class 不清除 → 对话框保持透明不可交互,320ms 后 finish() 照旧 unmount vueApp,sdk 自认为已挂载|show() 只 remove cs-hidden;unmount 的 finish 无取消机制|show() 清除 cs-leaving + 取消 pending finish|browser:unmount 后 100ms 内 mount,断言可见且存活

P2|correctness|src/core/composables/useChat.ts:210-212|排队任务自动执行时丢失 focuses 快照:send 带 focuses,finishRound 的 addMessage 不传 → 聚焦期间排队执行的用户消息无 🎯 历史标注|对比 chatContext.ts:181 send 传 focuses.value 与 useChat.ts:212 addMessage('user', nextContent)|queuedTasks 改存 {content, focuses}|browser:聚焦中排队,执行后断言 msg-focus-chip

P2|performance|src/core/components/message/MessageList.vue:32-48|大量消息无虚拟化,且 isPendingAssistant(idx) 对每行读 content/reasoning(chatContext.ts:198-204)→ 每个 delta 触发 MessageList 全列表 vdom diff|长会话 200+ 消息时每 token delta 全量 diff|isPendingAssistant 仅对末位求值;超阈值消息窗口化渲染|browser:300 消息流式渲染单帧耗时上限

P3|flow-divergence|src/core/components/ChatHeader.vue:115 × useChat.ts:269-273|生成中「清空对话」不 abort:占位 assistant 被 splice 成孤儿,本轮在途回复丢失、loading 持续到 finishRound(与 P1-3/P2-8 同族)|clearMessages 只 onClear+splice,不调 reset|clearMessages 先调 reset()|browser:生成中清空,断言流被收口

P3|test-blindspot|tests/browser/customize-demo.spec.ts:104-112|DebugDrawer 浏览器测试只断言可见与「Agent 信息」文本,无日志行增长/响应式断言 → P1(日志冻结)类问题无防线|spec 未查 .log-item/counts|补:发送后断言日志条数递增与徽标计数|即本条

## H26 结论(未证伪 —— 假设成立)

**确认(P1),不可证伪**。队列推进与 runSerial 链推进都以前一任务 settle 为唯一前提(useChat.ts:204 finishRound / serialRunner.ts:16),而主链路 LLM stream 与工具执行均无超时闸(approval/conflict 挂起至少有可见 UI),stream 停滞或工具挂死时:排队任务永不执行、无反馈,SDK 层 switchSession/batch 也连带静默堆积;唯一脱困手段 stop() 还会清空整个队列(useChat.ts:277)——排队内容无声丢失。触发条件明确(网络半开、用户工具无超时),属「不能完成也没有反馈」的典型违例。

## 总评

组件层自身卫生良好(IME 防护、abort→冲突/approval 自动收口、P1-b UI 路径、XSS 转义闸、debugLogs 300 条上限均核实到位),主要风险集中在三条缝:队列/串行链缺超时闸(H26)、生成中流在 unmount/switchSession/清空时无收口(幽灵流族 3 条)、debugLogs 浅响应式按引用传 prop 致内置调试 UI 冻结。
