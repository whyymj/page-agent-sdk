# audit-sdk-integrity · E 专项(执行健壮性:死循环 / 卡住 / 反馈闭环)

> 基线 2.38.0;审计范围 design.md §0 + §4(E1-E3)+ F11;全部 findings 经代码逐行核实,附 file:line。
> 使命对应:「大多数场景能正常完成任务;完成不了也要有必要的反馈」。

## Findings(15 条,严重度降序)

**P1 | hang | createChatSdk.ts:1438 + approval.ts:80-85 + humanConfirm.ts:94 + events.ts:23 | 非流式 send 路径 approval/humanConfirm 永久挂起且零可见性** | 证据:`send` 走 `core.agent!.invoke(messages)`(无 signal);invoke 的事件收集器只认 `done`(createAgent.ts:816);`approval_request` 被 emit 层显式过滤不外发(events.ts:23);humanConfirm **默认开启**(createChatSdk.ts:918-919),任何 headless+send 场景 LLM 一调 `request_human_confirmation` 就挂死;approval 的 timeoutMs 默认 0、humanConfirm 无超时概念;send 经 runSerial(:2180),挂起后续 send/switchSession/batch 全部静默排队 | 修:approval_request 带 resolve 句柄外发到 hook/onEvent(或 send 挂起 N 秒 emit 可查询事件);humanConfirm 补默认超时自动拒绝 | 测:e2e「send+approval 配置→超时/事件可见→不挂死」

**P1 | hang | createChatSdk.ts:1994 + mcp/client.ts:94-101 | MCP 握手无超时 → initDone 永挂,全部入口瘫痪** | 证据:`Promise.allSettled(options.mcp.map(connectMcp))` 只隔离 reject 不隔离 hang;connectMcp 内 `client.connect(transport)`/`listTools` 无超时;initDone 挂起 → `mount()`(:2085)/`send`(:1416)/`switchSession`(:1500)永等,`stream`(:1567)因 core.agent 未建 throw 误导性「请先 await mount()」| 修:per-server `Promise.race` 超时(如 10s)+ warn 降级跳过 | 测:selftest 挂起 stub server → mount 限时完成

**P1 | loop | createAgent.ts:504-523, 628-748 | 工具错误 recoverable 回灌无重复检测(H17 成立)** | 证据:coreExecTool catch 一律转 ToolMessage 回灌(:521),循环体内无任何「同工具+同参数+同错误」计数/去重(grep 全链无),唯一闸 = maxToolRounds/maxIterations 硬停;持续失败场景烧满 30+ 次迭代 LLM 调用才终止 | 修:记录最近失败键(name+argsHash+errMsg),连续 ≥3 次相同 → 提前终止并回灌「重复失败,换方案/告知用户」| 测:selftest 恒失败工具,断言迭代数 << maxIterations

**P1 | hang | createChatSdk.ts:2145-2160 + ChatDialog.vue(无 onBeforeUnmount,grep 全 UI 层零命中)| unmount 不 abort 进行中流、不收口挂起 approval** | 证据:unmount 仅 `resolveConflict('keep_external')`;生成中 unmount → stream 继续跑烧 token 写已卸载状态;approval 挂起中 unmount → approval Promise 永不 settle(无 abort 触发 finish(false))→ 该轮 stream 永挂,shareContext 复用时污染下次 mount | 修:unmount 前走 useChat.reset()/core 级 activeController abort + approval finish(false) | 测:browser spec「生成中 unmount → 无后续网络请求/事件」

**P1 | hang | createChatSdk.ts:514-518(SendOptions)+ 1438 | send 完全不可中断** | 证据:SendOptions 无 signal,invoke 不传 signal → LLM 流停滞/挂起时调用方无任何退出手段(headless 无停止按钮场景唯一出路是刷新页面) | 修:SendOptions 增 `signal`,或 send 返回带 abort 的 handle | 测:e2e send+外部 abort → 拒绝且保留 partial

**P2 | loop | utils/pool.ts:27-35 + subagent.ts:390-397 | spawn_agents 并行归并:单子失败丢弃全部兄弟结果(H20 成立)** | 证据:fn 内 `catch{...;throw e}` 再抛 → worker reject → `Promise.all(workers)` reject → 已成功子结果连同归并文本全丢,主 LLM 只见一条「工具执行出错」;串行(limit=1)更直接中断剩余未跑 | 修:spawnMany 的 fn 内 catch 转错误文本结果(单失败隔离),归并文本标注失败项 | 测:selftest runPool 单失败 → 其余结果保留

**P2 | correctness | budget.ts:41 + createChatSdk.ts:717-743 + subagent.ts:277-308 | automation tokenBudget 漏算子 agent 消耗;子挂起无超时传父(H28 成立)** | 证据:usage 仅由主栈 sdk-events afterModel 累加;runSubagent 构造的子 createAgent 无 sdk-events 中间件 → 子 token 永不计 core.usage,预算闸读 :41 失真;子 LLM 停滞 → spawn 工具挂 → 父批处理整体卡死(无看门狗) | 修:子 usage 经 onLog/专用回调汇入主 usage;batch 场景子任务继承时间预算 | 测:selftest 子消耗计入 usage

**P2 | hang | utils/serialRunner.ts:13-20 + useChat.ts:204-218 | 串行闸无超时/无可见性(H26 机制层成立)** | 证据:runSerial 链前一 fn 挂死(approval send 挂起/流停滞)→ 后续排队 Promise 永不兑现且无任何提示;useChat 队列续跑依赖 finishRound(:204),finishRound 依赖 fetchStream resolve → 流停滞则排队任务永不执行、QueuedBar 无变化 | 修:排队 ≥N 秒 emit observable warn(或挂起任务清单可查询) | 测:e2e 挂起前任务 → 后续 send 超时告警

**P2 | correctness | dataOps.ts:288 + 339 | setData 轮中调用:autoLock 静默放行(H24 成立)** | 证据:controller.set 把 `lastReadHash=undefined`(:288);handleConflict `if (!expectedHash) return null`(:339)→ setData 后 LLM 下一次 autoLock 写**完全跳过乐观锁校验**直写(非误冲突,是静默放行);快照栈同时清空且对 LLM/集成方无通知 | 修:setData 置「脏基线」标记,autoLock 写检测到未重读 → 返回 VERSION_STALE 引导先 read | 测:e2e 轮中 setData → autoLock 写不静默

**P2 | feedback | createAgent.ts:760-793 | 轮预算截断无结构化用户反馈(H22 成立)** | 证据:rounds 耗尽 → wrap-up 仅在 system 里告知 LLM「工具调用次数已达上限」,用户看到的是 LLM 自由发挥的回复,可能完全不提未完成;无 error 事件、无截断标记;maxIterations 截断路径仅兜底文案(:791) | 修:截断时 emit observable `ROUNDS_EXHAUSTED`(含未完成 todos/最后工具态)+ 建议回复尾部附截断说明 | 测:selftest 触顶 → 断言事件与文案含原因

**P2 | hang | createAgent.ts:467(for await)+ 222-224 | LLM 流停滞无看门狗;单条巨型消息无法收敛(H27 成立)** | 证据:流迭代无 chunk 间隔超时,停滞 = loading 永转,唯一出路手动 abort;trimContextIfNeededImpl 只裁 ToolMessage(:224 `if (!(m instanceof ToolMessage)) return m`),useContextManager 恒保最新轮(:139)→ 单条巨型 user 消息贯穿逐轮 trim/激进 trim(0.3)/compress 全不可裁 → 直达溢出反应链,仍超 → fatal 抛(有可见性但任务失败,useContextManager.ts:245 仅 console.warn) | 修:chunk 停滞看门狗(可配,默认关或 60s);trim 支持 HumanMessage 尾部截断 | 测:selftest 巨型 user → 收敛或明确 fatal 文案

**P2 | correctness | createChatSdk.ts:1945/1506/1966/1973/1979-1982 + storage.ts:586-597 | 持久化 fire-and-forget 无 catch = unhandled rejection 根因;dispose 不关 IDB 连接** | 证据:全部 `void store.save(...)` 无 `.catch`,teardown/配额/DataCloneError 时 IDB reject 直接 unhandled(browser 测试观察到的 `connection is closing` 即此);`dispose()` 只清 timer 不 close db、backend 方法无 disposed 守卫(storage.ts:226-294 直用 db) | 修:统一 `.catch(warn)`;dispose 关闭连接 + backend 加关闭守卫 | 测:dispose 后 save 不产生 unhandled rejection

**P2 | feedback | createChatSdk.ts:793-795 + storage.ts:502-512 | 存储配额 LRU 淘汰默认可见性为零** | 证据:`evicted` 事件仅订阅到 `console.log` 且限 `options.debug`;默认配置下整个历史会话被淘汰,集成方/用户完全无感知(无 sdk 事件、无 warn) | 修:evicted 转 emit sdk 事件(或至少无条件 console.warn) | 测:e2e 配额淘汰 → 事件可见

**P3 | correctness | createChatSdk.ts:1571-1573 + createAgent.ts:467-497 | 流 per-call onEvent 无异常隔离** | 证据:wrappedHandler 裸调 `onEvent?.(event)`,集成方流处理器抛错会落进 for-await catch 被当流失败 → 整轮中断(与 emit 层 try/catch 隔离不对称) | 修:wrappedHandler 包 try/catch(observable warn) | 测:e2e 抛错 handler → 轮次照常完成

**P3 | feedback | createChatSdk.ts:1499-1544 | headless 忘调 afterRound → switchSession 静默丢消息** | 证据:switchSession 只补存 mission/workingMemory/focus(:1505-1509),messages 依赖 afterRound 已跑;无「未持久化变更」检测或 warn(文档已提示但运行时零反馈) | 修:switchSession 前检测 messages 脏 → console.warn/emit | 测:e2e stream 后直接 switchSession → warn

## E1 循环点清点补充(闸→生效→触闸反馈)

| 循环点 | 闸 | 生效? | 触闸反馈 |
|---|---|---|---|
| ReAct 主循环 | maxToolRounds + maxIterations=max(3×rounds,30)(createAgent.ts:628) | ✓ 但无重复检测(finding 3) | wrap-up 收口/兜底文案(反馈弱,finding 10) |
| 工具错误回灌 | 仅预算硬停 | ✗ 无重复检测 | 同上 |
| verify 自检 | maxVerifyAttempts 预算前置(createAgent.ts:698) | ✓ | feedback 回灌;耗尽返回缓存最终答 |
| decide 工具循环 | invokeUntilFinalJson ≤3 轮×2 段(llmResolver.ts:172)+ 6s 总超时(:214) | ✓ 有界(H12 部分证伪:阻塞首响应属实但 ≤6s) | 失败 null → 静态压缩降级 |
| maxPlanRevisions | 默认 5(todos.ts:95-105);重入计数重置但 maxIterations 兜底 | ✓ 设计内可接受 | 回灌「停止调研去执行」(纯查询任务文案误导 = D2 域) |
| LLM retry × _ctxRetry | maxRetries(启动)+ _ctxRetry 单次标志(createAgent.ts:451/487) | ✓ 组合有界;注:overflow 错误若无 status 会被 isRetryable 误当网络错空耗 maxRetries 次(retry.ts:29)再走 _ctxRetry,有界但浪费 | onRetry 日志 + warn |
| 格式自纠 | maxFormatRetries=2 + pendingFormatRetry(createAgent.ts:626-685) | ✓ | 耗尽 emit observable GARBLED_TOOL_CALL_EXHAUSTED(:694)✓ |
| draft append→commit | 轮预算;commit 失败草稿保留可重试 | ✓ | SCHEMA_INVALID/JSON_INVALID 结构化错误 |
| 沙箱 eval/skill exec | timeout + worker.terminate(sandbox.ts:89) | ✓ | 超时错误回灌 |
| 全仓 while/for await 清点 | dataOps 快照 while(maxSnapshots 界)/dataSlotQuery 解析(i 严格递增)/contextAnalysis.ts:107(from 严格递增)/pool cursor/workingMemory LRU/checkpoint 栈/createChatSdk.ts:1432 send automation 循环(attempt<maxAuto 界) | 均终止 | — |

## E2 挂起点矩阵(谁等→谁 resolve→超时→可见性)

| 挂起点 | resolve 方 | 超时 | 可见性/清理 |
|---|---|---|---|
| approval(stream+UI) | ApprovalBar 三键 | timeoutMs 默认 0 | ✓ pendingApproval;abort→finish(false) ✓(approval.ts:66-71) |
| approval(send/invoke、streaming:false UI) | 无 | 无 | ✗ **永挂零可见**(finding 1) |
| humanConfirm(默认开) | 同 approval | 无超时概念 | 同上(finding 1) |
| conflict | pendingConflict watch / resolveConflict / 'conflict' 事件(conflictManager.ts:35) | 无 | ✓ abort/unmount/switchSession 均收口 keep_external(:1503/1576/2147);shareContext 并发覆盖前旧冲突自动收口(:29-30) |
| MCP 握手 | 无 | 无 | ✗ initDone 永挂(finding 2) |
| fetchDoc | — | 30s(fetchDoc.ts:13) | ✓ 超时/CORS 结构化文案回灌 |
| LLM 流 | 仅手动 abort | 无 | ✗ 停滞永转(finding 12) |
| 子 agent → 父 | signal 继承(subagent.ts:310) | 无 | 子停滞传父(finding 7) |
| IDB 异步 | — | — | fire-and-forget 无 catch → unhandled rejection(finding 13) |
| unmount 时机 | conflict ✓ / approval ✗ / 进行中流 ✗ | — | finding 4 |
| setData 轮中 | — | — | 静默放行(finding 9) |
| runSerial 链 | 前任务 resolve/reject 均推进(serialRunner.ts:16) | 无 | 前挂 = 全挂(finding 8) |

## H 假设结论

- **H17 成立**:无重复检测,同工具+同参数+同错误回灌只靠 maxIterations 硬停(createAgent.ts:504-523/628)。
- **H18 成立且放大**:不止 approval——默认开启的 `request_human_confirmation`(createChatSdk.ts:918)同样走 approval_request;send/invoke 路径无 signal、事件被 events.ts:23 过滤、UI 非流式模式(mountChatDialog.ts:34-41 fetchResponse→invoke)同样中招。conflict 侧无此问题(事件 + ref + 三处收口)。
- **H22 成立**:截断走 wrap-up 收口(有最终回复,不静默),但原因/未完成事项只进 LLM system,用户侧无结构化提示、无 error 事件。
- **H24 成立(静默放行分支)**:setData 后 lastReadHash=undefined → autoLock 写跳过锁校验直写(dataOps.ts:288+339);非误冲突。
- **H26 机制层成立**:runSerial 与 useChat 队列均无超时/可见性,饥饿是上游挂起(approval send 挂死/流停滞)的必然传导;serialRunner 自身 reject 不卡链(双路 then)设计正确。
- **H27 成立**:三层裁剪(compress 保最新轮 useContextManager.ts:139 / 逐轮 trim 与激进 trim 只裁 ToolMessage createAgent.ts:224)对单条巨型 user 全不可裁 → 直达溢出反应链,fatal 抛(可见但失败)。
- 附带:H23 成立(MCP 握手无超时);H28 成立(子 token 不计预算+子无超时);H20 成立(spawn_agents 单失败遮蔽全部);H12 部分证伪(decide 有 3×2 上限+6s 超时,阻塞但有界)。

## F11 高危格子(9 场景 × 10 终止路径,静态推演)

| 格子 | 判定 |
|---|---|
| approval 把关 × 非流式 send | **不终止+无反馈**(finding 1)|
| approval 把关 × unmount | **不终止**(approval 不收口,finding 4)|
| 任意场景 × LLM 流停滞 | **不终止**(无看门狗,finding 12)|
| 子 agent 委派 × LLM 流停滞 | **不终止且传父**(子无独立看门狗,finding 7)|
| automation 批处理 × 子挂起/预算 | **不终止+预算漏算**(finding 7)|
| MCP 接入 × 首条消息/挂载 | **不终止**(initDone 永挂,finding 2)|
| 大 JSON draft × 轮预算截断 | 终止但反馈弱(wrap-up 靠 LLM 自觉,finding 10)|
| 多步规划 × 工具持续失败 | 终止但烧满预算(无重复检测,finding 3)|
| 单步写/纯查询 × fatal/上下文溢出 | 终止+可见(throw/state.error;SYSTEM_PROMPT_OVER_BUDGET 有 fatal 事件+done ✓;stream 路径无 error 事件为次要缺口)|
| approval 拒绝 / conflict keep_external × LLM 侧 | ✓ 结果文本明确(approval.ts:54 / dataOps.ts:353)|
| abort × 任意 | ✓ partial 保留 + 停止态(createAgent.ts:480-483/659)|
| 事件处理器抛错 × 任意 | emit 层 ✓ 隔离(events.ts:24-25);per-stream handler ✗(finding 14)|

## 一句话总评

终止预算闸(maxIterations/decide 上限/verify 预算/fetchDoc 30s/沙箱 terminate)在「循环面」基本健全,但「挂起面」存在系统性缺陷:**一切依赖人工 resolve 的挂起点(approval/humanConfirm)在非流式与 headless 路径零可见性、send 不可中断、unmount/MCP/流停滞无收口与看门狗**,叠加串行闸无超时,使「完成不了」时常常连「告知卡在哪」都做不到——E2 是本次审计最薄弱的一环,建议下发布优先修 finding 1/2/4/5。
