# Proposal: flow-robustness(全流程阻塞/挂起/崩溃面收口)

> 状态:**已立项待实施**。优先级 **P0×2 + P1**(两处 P0 经双 agent 交叉验证一致)。目标仓库:zhuanti-agent。
> 驱动:用户要求梳理「阻塞输出无法正常使用 / 流程不按预期 / 死循环 / 异常终止 / 崩溃」;五路审计(2026-08-25)结论:**无死循环**(全部自纠/门禁循环有界,maxIterations=90 硬闸兜底一切,预算池独立无层间乒乓)、**无 P0 崩主循环点**、已知两颗雷(spawn_agent 子流错误 / 流式错误聚合 null)均已修复(5fe9b6b / ba96a0c+79fd6a2);真实风险集中在**挂起面**与 **unhandledRejection/半状态** 面。

## P0(两处,双 agent 交叉验证)

1. **工具执行无超时闸(唯一能击穿 stop 按钮的缺口)**:`runPool`/`coreExecTool` 对工具 Promise 裸等(createAgent.ts:728/1041);集成方自定义工具(`tools`/`actions.run`/ragSubagent retriever)永不 settle → runPool 永挂 → stream 永挂 → loading 永转、队列全堵、**stop 无效**(abort 只在工具间隙检查,已启动工具不取消);子 agent 内同理并向上毒化主循环。内置工具/MCP/eval 全有闸,此缺口专属集成方注入面。**修法**:per-tool 看门狗(race + 超时返回 recoverable 错误结果,底层 promise 吞掉),`toolTimeoutMs`(默认 120s,0=关),挂 CreateAgentOptions;**委派类工具(`use_*`/`spawn_agent`/`spawn_agents`)独立大档**(默认 10min,对齐 P1#4 子 agent 总时长)—— 真 LLM 实测单次委派(gpt-5 委派+渲染检查)>120s 常态,120s 档会杀合法长委派,看门狗不得自己制造「合法长委派被杀」回归。
2. **headless `send()` 的 conflict/approval 不吃 abort**:`abort→resolve('keep_external')` 只注册在 core.stream(createChatSdk.ts:2150-2155);core.send(1915-1988)直调 invoke → 乐观锁冲突 ask 挂起 + signal abort 均不解,onConflict Promise(dataOps.ts:1035)无 signal race → **send 永不返回**(unmount/switch/reset 可解)。**修法**:send 入口同款 abortConflict 注册;conflictManager.set 接受可选 signal race。

## P1(挂起兜底 / unhandledRejection / 半状态 / 行为偏差)

3. stream 自建 UI 路径无 approval 30s 自动拒(30s 只在 send/batch 注入;humanConfirm 本体无超时)→ 自建 UI 不处理 approval_request 事件即无限挂;修法 = humanConfirm/approval 中间件默认 30s 无响应自动拒 + observable(与 send/batch 语义对齐)。
4. 子 agent 无默认总时长(仅 opt-in timeoutMs;单模型调用 600s 闸兜底但理论最坏 ~70min 且主循环同轮 await)→ 温和默认(10min 可覆盖),超时 abort 子流 + recoverable 回灌(机制已备只差默认值)。
5. storage 面:`maybeEvict` 内部吞错(evictTimer `void`(:506)与 flush 内 await(:580)无 catch,污染 release/pagehide/visibilitychange 三处 fire-and-forget → unhandledRejection);flush/ready 包 race(5s 超时留痕放行,落盘交 debounce/pagehide 兜底)防 IDB blocked 拖死 send 收口与 mount。
6. 会话切换按钮路径 `void runSerial(switchSession)` 无 try(:103-104);二次 load 失败 = 半切换态(sessionId 已换/messages 已清/快照未灌)→ 入口包 try + emit observable。
7. checkpoint save 的 JSON 兜底裸奔(reactive→structuredClone 抛→JSON 兜底,循环引用再抛 TypeError→beforeModel 钩子 reject 整个 invoke;batch 的 save 也在任务 try 外)→ clone 兜底包 try(失败跳过本轮快照 + warn)。
8. **deepClone 无环防御**(环 bind → 所有写路径第一条语句即抛 `Converting circular structure`,快照/restore 兜底同失效,功能瘫痪且文案无环线索)→ replacer seen 抛可诊断错误(指明环路径)。
9. **tool_call id 兜底不回写 AIMessage → 400**(provider 不回 id 时同 invoke 内下轮请求带「无 id tool_call + 有 id ToolMessage」→ 4xx 不重试单轮 fatal;DSML 路径有正确回写对照 :949)→ 照同款把生成 id 写回 message.tool_calls。
10. **transitional 门禁补句尾问号豁免**(actionGate 只查长度/动词,「我先给出两套方案…你选哪套?」会被回灌 ×2 与方案先行冲突;completion/zero_tool 已有问号豁免口径)。
11. send 内 `await store.flush()` 失败被误归因 LLM fatal → automation 恢复重跑整轮烧 token → flush 移出 try 或按错误源分流。
12. send/batch 不刷新 vfs protectedRefs(只在 stream :2141 注册)→ 跨轮 LRU 淘汰 vfs_read 404 → send/batch 入口同款注册。

## 登记 deferred(P2,不进本 change)

memory 异步 source / images.upload race 超时;MCP listTools 15s race;hashValue 失败返回常量串(乐观锁静默失效面)/ watchFieldsHash 环数据 RangeError(两路径二选一);vfs_json_patch isUnsafePath 预检;query/search 环数据误标;Worker OOM 文档明示;hostScript 主线程死循环(opt-in 明示自负);stream SYSTEM_PROMPT_OVER_BUDGET 早退仍推空 assistant;auditWritePaths 跨会话残留(已接受);单轮 tool_calls 数量无上限(仅 90 轮间接约束);启动段超时未 inner.abort(资源级)。

## 红线

- 看门狗默认值必须宽松(120s):内置工具全部已有更紧的闸,看门狗只兜集成方注入面,不得把既有有界工具的行为变掉。
- abort 语义不扩权:工具看门狗超时 ≠ abort(返回 recoverable 错误让 LLM 自纠/收口,不杀流)。
- 串行/默认配置零行为变化(所有新超时只在「无界等待」路径上生效)。
- 修复不得引入新的静默吞错(unhandledRejection 修为「留痕 + 降级」,不是 catch 后丢弃)。

## 验收门禁

- selftest:永不 resolve 的自定义工具 → 120s(测试注入小值)后 recoverable 错误结果 + 兄弟工具正常;send + conflict 挂起 + abort → keep_external 收口返回;onConflict 永挂 + signal abort;deepClone 环 → 可诊断错误;checkpoint 环 bind 不炸 invoke;id 回写断言。
- e2e:headless send conflict×abort 场景;transitional 问号豁免(方案先行文本不回灌)。
- 四门禁全绿;真 LLM complex-ops 复跑零回归。
