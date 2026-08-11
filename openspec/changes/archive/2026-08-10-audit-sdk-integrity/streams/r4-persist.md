# R4 会话持久化审计结果(audit-sdk-integrity)

范围:F5 持久化闭环 + R4 行(backends/{storage,vfs,skillStore}.ts、harness/{checkpoint,mission,workingMemory}.ts、createChatSdk.ts 持久化/switchSession/resetSession/applySnapshot 段)。基线 2.38.0。

## Findings(严重度降序)

P1|correctness|createChatSdk.ts:1549-1550|storage 关闭(默认配置)时 resetSession 整体早退,「清空对话」只清 messages,mission/workingMemory/focus/todos/vfs/checkpoint 全部泄漏进新对话|`resetSession: () => { if (!store) return` 后才做状态重置;storage 默认关(CLAUDE.md「默认关闭,赋值开启」);ChatHeader.vue:115 清空按钮不受 storage 门控 → useChat.clearMessages 仅 splice messages(useChat.ts:269-273);后果:旧 focus strict 写拦截/旧 mission pin/旧 hash 带入新对话|状态重置与 `if (!store)` 解耦:重置逻辑无条件执行,仅 createSession/refreshSessions 依赖 store|e2e:storage:false + 重置后 inspect().mission/focuses/todos 均空

P1|flow-divergence|createChatSdk.ts:1499-1544, 2200|core 层 switchSession 不 abort 进行中 stream,且 stream 未进 runSerial → headless 流式中切会话:消息数组被 splice 脱离、回复静默丢失、在途工具写进新会话|switchSession 全程无 signal/abort(仅 conflictMgr.resolve);代理层 `stream: core.stream` 未包 runSerial(对比 send/batch/switchSession 2180-2183);createAgent 无 isRunning/busy 标志(grep 证实);abort 只在 UI 层 useChat.reset(useChat.ts:284-291,ChatHeader.vue:52/56 调用)|core 持有 round 级 AbortController,switchSession/resetSession 先 abort 再换态;stream 纳入串行闸或加 busy 守卫|selftest/browser:stream 进行中 switchSession → signal aborted、partial 保留、新会话无串写

P1|correctness|storage.ts:306, 323|WebStorage 后端 get/scan 的 JSON.parse 无 try/catch,损坏记录使 load/listSessions 抛穿,SDK 启动/切会话永久失败,违背「storage 永不冒泡」自述|`return v == null ? undefined : JSON.parse(v)` 裸 parse(scan 同);写路径有 catch+降级(storage.ts:443-465 注释「永不冒泡到用户代码」),读路径无;抛点链:resolveAndLoad→initDone reject→mount/send 全挂|parse 失败 try/catch 返 undefined + emit degraded;load 外层兜底|selftest:注入损坏 local/sessionStorage 键 → load 返默认不抛

P1|crosstalk|createChatSdk.ts:2173, 2066-2073|shareContext 时串行闸是每实例独立的,共享同一 AgentCore 的两实例可并发 send × switchSession,「操作串行化」承诺对共享 core 失效|`const runSerial = createSerialRunner()` 在 _createChatSdk 每 wrapper 新建,位于 `sharedCores.get(agentId)` 复用 core 之后;注释 2171 自称「实例级操作串行化」|串行链移入 AgentCore(buildCore 内),wrapper 复用|e2e:shareContext 双实例并发 send/switchSession 无交错

P2|correctness|createChatSdk.ts:1953, 1506|setMission({}) 清空不落盘(persist 仅非空写、无 null 清除标记),刷新/切回后被清除的旧 mission 复活|mission `if (m) void store.save(...)` 只写非空;focus 有清除标记对照 `fs.length ? fs : null`(1962);applySnapshot:1352 无条件恢复 snap.mission;core.setMission(1781-1788)无 persist|mission 仿 focus 存 null 标记;applySnapshot 识别标记跳过恢复|e2e:setMission({})→重载→getMission undefined

P2|correctness|createChatSdk.ts:929,1452,2226 + dataOps.ts:386|checkpoint restore 就地回退 bind 但不重置 dataOps lastReadHash → 下一次 autoLock 写拿陈旧基线必触发误 VERSION_CONFLICT(人工介入)|checkpointMgr.restore 仅重置自身 lastXxxClone(checkpoint.ts:212-215),无 dataOpsController 联动;lastReadHash 只在 read/write 成功路径赋值(grep 证实无 restore 重置点)|restore 后经 controller 失效 lastReadHash(或引导强制重读)|selftest:read→write→restore→再 write 不冲突

P2|correctness|createChatSdk.ts:1341-1353|applySnapshot 对 messages/todos/workingMemory 无结构校验(focus 有逐 path 校验),畸形快照直接抛错放大 WebStorage 解析缺口|`messages.push(...snap.messages)`、`workingMemoryMw.restore(snap.workingMemory)`→`wm.locatedPaths.slice`(workingMemory.ts:108)对非对象即 TypeError;仅 focus 段有 filter 校验(1356-1371)|逐 kind 最小类型守卫(Array.isArray 等),非法降级跳过 + warn|selftest:畸形快照各字段 → 不崩、坏项跳过

P2|flow-divergence|dataOps.ts:993 + createChatSdk.ts:825-827|draft 碎片仅 commit 成功才删,随 vfs 整体持久化跨刷新/切会话残留,无 TTL/回收,仅 2MB 池 LRU 兜底(H5)|`delete store.files[key] // 成功:清草稿`;JSON_INVALID/SCHEMA_INVALID/冲突均「草稿保留」;vfs persist 钩子整体快照含 drafts/;applySnapshot 无 drafts 清理|drafts 加 createdAt,加载/超 N 轮未 commit 回收;或 usageHints 引导 vfs_rm|selftest:draft_write→重载→残留可见;回收策略生效

P2|flow-divergence|createChatSdk.ts:793-795 + storage.ts:502-512|quota/evicted/degraded 事件仅 debug 时 console.log → 配额淘汰整会话删除、降级内存均完全静默,违背 E3 反馈闭环|`if (options.debug && store) store.onEvent(...)` 是唯一消费点;maybeEvict 整会话 clearPrefix + emit evicted(storage.ts:508-511)无人听|转发为 sdk 事件(onEvent/hook 可订阅)或至少 console.warn|e2e:触发淘汰 → 事件/warn 可见

P2|crosstalk|storage.ts:338-349, 420-467|多标签页同 agentId+sessionId 并发写 IDB 定性分叉:runSerial 仅单 tab 内串行,messages last-writer-wins 互相覆盖、meta.bytes 读改写 lost-update、一 tab 的 maybeEvict 可整删另一 tab 活跃会话|chains Map 为每 createSessionStore 实例私有;无跨 tab 协调(BroadcastChannel/storage 事件/记录版本号均无);IDB 事务只保证单记录原子|文档标注限制;meta 加 updatedAt 版本比较或单 tab 写锁(storage event 协商)|手动验证项:双 tab 同 id 并发对话比对落盘

P2|maintainability|storage.ts:111-113, 586-597|dispose 注释承诺「关连接」但 StorageBackend 接口无 close,IDB 连接永不显式关闭;onversionchange 关 db 后 backend 仍持引用,后续操作抛 "connection is closing"(browser teardown 已观察到的现象之根因候选)|dispose 只清 timer/pending/listener;接口 116-124 无 close 方法;onversionchange `db.close()`(223-225)后无失效标记|后端接口加 close();dispose 后写操作短路不抛|selftest:dispose 后 save 无 unhandled rejection

P3|correctness|vfs.ts:195-200 + createChatSdk.ts:1342|hydrate 是合并非替换:init 路径 initialFiles 先种子,持久化快照无法移除已删种子 → vfs_rm 删掉的 initialFiles 刷新后复活|hydrate 仅 `for (...) files[normalize(k)] = v`,不清空;switchSession 路径不受影响(clear 先行),仅 init/resolveAndLoad 路径中招|init 恢复时 hydrate 前清种子,或 hydrate 改替换语义|selftest:initialFiles+vfs_rm→重载不复活

P3|flow-divergence|createChatSdk.ts:1504-1510, 1549-1564|switchSession 切走前补 persist 只含 mission/wm/focus,不含 messages/todos;resetSession 完全不补存 → headless 忘调 afterRound 时切走/新建即丢整轮|对比 persistRuntime(1944-1949 含 messages/todos)与 switchSession 补存段;resetSession 无补存直接 makeId|switchSession 补存复用 persistRuntime;或检测未持久化变更 emit warn(E3 建议项)|e2e:stream 后不 afterRound 直接 switchSession → 旧会话轮次完整

P3|performance|vfs.ts:96-102, 110-140|enforceLimit 淘汰循环内每删一文件全量重算 poolBytesOf → O(文件数²),文件多时写放大|循环内 `if (poolBytesOf(pool) <= target) break` + 总上限段同型|先累计总字节,删除时增量减|selftest:大文件数下 enforceLimit 耗时断言

P3|performance|checkpoint.ts:171|H14 现状确认:checkpoint save 每轮整体 clone messages,长会话成本线性(Phase B 未做,已知 deferred)|`messages: clone(messages)` 无条件执行;vfs/bind 已有脏标记增量,messages 无|维持 deferred,长会话场景记录实测|—

## H5 / H6 证伪结论

- **H5(draft 池跨会话残留)部分证实**:drafts/* 随 vfs 整体持久化(persist 钩子快照全池),仅 draft_commit 成功删除(dataOps.ts:993);JSON_INVALID/SCHEMA_INVALID/冲突路径刻意保留草稿但无任何过期回收,刷新/切回后残留复活。有 2MB 池 LRU + vfs_rm 工具兜底,无无限增长,但缺 TTL 且可能误导 LLM 续写陈旧草稿 → 定 P2(上方第 8 条)。
- **H6(headless switchSession 不 abort 进行中 stream)证实**:core.switchSession(createChatSdk.ts:1499-1544)无任何 signal/abort 处理,createAgent 无 busy/isRunning 标志,代理层 `stream: core.stream`(2200)未纳入 runSerial 串行闸(对比 send/batch/switchSession 2180-2183)。P1-b 修复仅存在于 UI 层 useChat.reset(useChat.ts:284-291,由 ChatHeader.vue:52/56 在切会话前调用)。headless 集成方流式中调 sdk.switchSession:共享 messages 数组被 splice 脱离 → 进行中回复静默丢失、在途工具调用写入新会话上下文 → 定 P1(上方第 2 条)。

## 三路径一致性补充结论

afterRound(persistRuntime)/ switchSession 切走补 persist / resetSession 三路径在 storage 开启时覆盖 messages/vfs/todos/mission/workingMemory/focus/checkpoint 基本完整(vfs 走 Proxy debounce 800ms + 切走 flush 收口,补存后经 await store.flush() 落盘)。缺口:① storage 关闭时 resetSession 整体失效(P1#1);② mission 清除无 null 标记(P2#5);③ 切走补存不含 messages/todos(P3#13)。hydrate 恢复仅 focus 有逐项校验(逐 path 剔除 + 旧版单 focus 归一化 Array.isArray 判断,createChatSdk.ts:1356-1371);messages/todos/workingMemory 无结构守卫(P2#7)。写盘中途崩溃:IDB 后端事务原子、崩溃安全(load 对缺 kind 有默认值兜底,storage.ts:528-531);解析守卫缺口在 WebStorage 读路径裸 JSON.parse(P1#3)。旧版本快照缺字段由 load 默认值 + applySnapshot 各 `if (snap.X)` 守卫兼容,多字段忽略,演进兼容基本健全。vfs Proxy 标脏覆盖全部写路径(set/deleteProperty 两 trap,工具/offload/draft/resources/sdk.vfsWrite 均经 proxy 赋值,grep 证实无原地 mutate);enforceLimit/hydrate/clear 走 raw target 为有意设计(防递归),hydrate/clear 手动补 _dirty=true。checkpoint 脏标记增量完整(restore/importStack 均重置 lastXxxClone 基线,checkpoint.ts:212-215/225-227),messages 保持整体 clone(H14 deferred)。

## 总评

持久化闭环在「storage 开启 + UI 模式」主路径上设计周密(补存、null 标记、逐 path 校验、脏标记增量、冲突收口俱全),但存在四处默认配置/headless 可达的 P1:storage 默认关时清空会话状态泄漏、core 层切会话不 abort 流、WebStorage 读路径无解析守卫违背「storage 永不冒泡」、shareContext 串行闸失效——修复面集中在 createChatSdk.ts 与 storage.ts,均可用 selftest/e2e 覆盖。
