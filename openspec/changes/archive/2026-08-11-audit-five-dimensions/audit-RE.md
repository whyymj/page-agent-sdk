# audit-RE:资源长期累积(Resource Long-term)

> 维度 RE(资源长期累积)专项审计报告。审计口径:**只读不改源码**,聚焦长会话(>100 轮)内存增长、监听器/timer/Worker/blob URL 清理、vfs 引用保护收敛性、子 agent tracker history LRU、fire-and-forget persist 的 promise 累积、activeControllers 注册表清理。
>
> 范围对照 `openspec/deferred.md`:已登记项(性能 5 项 / 持久化 #8 enforceLimit / 上下文 #4 累积摘要 / 持久化 #3 持久化 #4 / 性能 #4 tracker steps / 上下文 #6 estimateTokens / 持久化 #3 draft 碎片)**不重复**,本报告聚焦未登记的新泄漏/膨胀点。

## 审计范围

### 重点源文件(均通读核实)
| 文件 | 行数 | 审计要点 |
|---|---|---|
| `src/core/composables/useChat.ts` | 324 | currentController / queuedTasks / pendingApproval 生命周期;reset/stop 完整性 |
| `src/core/composables/useContextManager.ts` | 306 | llmCache / llmInFlight 状态机;fireBackgroundLlmSummary 守卫 |
| `src/core/tools/sandbox.ts` | 130 | Worker 创建/terminate、blob URL revoke 完整路径 |
| `src/core/backends/vfs.ts` | 526 | 四池 LRU 收敛性;protectedRefs 与 OOM 1.5x 硬兜底;saveTimer 清理 |
| `src/core/sdk/events.ts` | 33 | listeners Set 生命周期;shareContext 合并语义 |
| `src/core/harness/subagent.ts` | 807 | tracker history LRU、active→history 迁移;子执行 timer + cleanup |
| `src/core/sdk/createChatSdk.ts` | 2482 | unmount 收口链(abortAllActive → resolveConflict → removeEventListener → release);activeControllers / mcpClosers;autoTitle/trim/persist fire-and-forget |
| `src/core/harness/summarization.ts` | 87 | compressInput 与 ctxManager 共享 config 引用 |
| `src/core/composables/contextIndex.ts` | 122 | 纯函数无状态 |
| `src/core/harness/createAgent.ts` | (相关段) | inner AbortController + withStallTimeout;debugLogs/spans 限长 |
| `src/core/harness/approval.ts` | 90 | cleanup 数组 clearTimeout/removeEventListener;settled 守卫 |
| `src/core/harness/retry.ts` | 96 | delay timer + abort 联动 clearTimeout |
| `src/core/utils/stallTimeout.ts` | 56 | finally clearTimeout |
| `src/core/utils/pool.ts` | 37 | 无 listener/timer |
| `src/core/utils/rounds.ts` | (相关段) | trimMemoryMessagesImpl prevSeg 合并语义 |
| `src/core/harness/checkpoint.ts` | (相关段) | maxCheckpoints 默认 5;importStack 清空 |
| `src/core/harness/workingMemory.ts` | (~110) | LRU ≤10 + reset 完整清空 |
| `src/core/sdk/mountChatDialog.ts` | 142 | 退出动画 transitionend once + setTimeout 320ms 兜底;done 守卫 |
| `src/core/composables/useMarkdown.ts` | (~135) | onScopeDispose 清 timer(2.41 markdown 节流) |

## Findings(按级,带增长模型)

### P0:确定性内存泄漏(长会话必崩)
**无**。未发现任何长会话累积必崩的资源泄漏。所有累积点(messages / debugLogs / snapshots / baselines / checkpoint stack / tracker history / workingMemory / vfs 四池)均有明确上限与清理路径。

### P1:长会话(>100 轮)可感膨胀 / 特定路径泄漏
**无**。已登记的「累积摘要只增不减 / checkpoint 每轮整体 clone / persistRuntime 每轮全历史 round-trip」(分别 deferred 上下文 #4 / 性能 #2 / 性能 #3)属此级,**已登记不重复**;本审计未发现新的 P1 级累积点。

### P2:边缘泄漏(特定时序 + 无累积)

#### RE-P2-1:autoTitle LLM fire-and-forget 无 unmount 销毁守卫,易致 unhandled rejection

- **证据**:`src/core/sdk/createChatSdk.ts:2082-2088`
  ```ts
  if (autoTitle && titleLlmInvoke && !titleLLMDone && messages.some((m) => m.role === 'user') && messages.some((m) => m.role === 'assistant')) {
    titleLLMDone = true
    void (async () => {
      const llmTitle = await titleLlmInvoke(messages)
      if (llmTitle) { await store.updateTitle(agentId, core.sessionId, llmTitle); await refreshSessions() }
    })()
  }
  ```
- **缺陷链**:
  1. `titleLlmInvoke` 内部 LLM 调用未穿 `signal`(看 `llmResolver.ts:114` lazy 构造 invoke 不接受外部 signal);
  2. unmount → `core.abortAllActive()` 只 abort 经 `trackActive` 登记的 controller,**触达不到 titleLlmInvoke 的内部流**;
  3. 320ms 退出动画结束 → `core.release()` → `store.dispose()`(createChatSdk.ts:1694);
  4. LLM 调用完成(通常 1-5s,远晚于 dispose)→ `await store.updateTitle(...)` 抛 `connection is closing` / 类似错;
  5. `void (async () => {})()` **无 .catch** → **unhandled promise rejection**(浏览器控制台噪声 + 父进程 unhandled 钩子触发)。
- **增长模型**:**不累积**(每会话最多触发 1 次,`titleLLMDone` 守卫)。但若集成方频繁 mount/unmount 短命实例(对话框频繁 toggle),会累积多个 pending unhandled rejection。
- **触发条件**:`autoTitle !== false`(默认 true)+ `titleLlmInvoke`(apiKey 可解析)+ 首轮 user+assistant 完成触发后,LLM 完成前 unmount。
- **对照 deferred.md**:挂起面 #3「trim LLM 异步 unmount 后无取消」同型已登记(`trimMemoryMessages` 内 2025-2036 行有 try/catch,但内部仍调 `persistRuntime` 走 `void store.save` —— 见 RE-P2-2)。**本项 autoTitle 路径未登记**,且 autoTitle 比 trim 更脆弱(无 try/catch 包裹)。
- **建议**:在 `void (async ...)()` 外层加 `try { ... } catch { /* unmount 中断/已 dispose 静默 */ }`;或在 release 内置 `isReleased` 标志,异步路径前置检查。一行 .catch + debugLogs 留痕,同 deferred 挂起面 #4 的方向。

#### RE-P2-2:persistRuntime 内多处 `void store.save(...)` 无 .catch,配额超限/teardown 致 unhandled rejection

- **证据**:`src/core/sdk/createChatSdk.ts:2050, 2054, 2058, 2062, 2067, 2071, 2072, 2078`(8 处),以及 mission/workingMemory/focus 等持久化补丁 1603-1606 / 1637 / 1971。
- **缺陷链**:
  1. `void store.save(...)` 是 fire-and-forget,store 返回 Promise;
  2. IDB 在配额超限(`QuotaExceededError`)、浏览器 teardown(`InvalidStateError` / `connection is closing`)、隐私模式、store 已 dispose 后,save 会 reject;
  3. 无 .catch → unhandled rejection;
  4. 长会话每轮 `afterRound` 触发 persistRuntime,7-9 次 save;若中段触发 QuotaExceeded,会产生 7-9 个挂起 unhandled rejection。
- **增长模型**:**单轮内最多 7-9 个 pending promise**,不跨轮累积(每轮重新触发);但若 store 进入了持续 reject 状态(配额满不恢复),每轮都产新一批 unhandled rejection,**长会话累积上限 = 轮数 × 7-9**。
- **触发条件**:`storage` 开启(默认 indexedDB)+ 配额超限 / 浏览器 teardown / Safari 隐私模式。
- **对照 deferred.md**:持久化 #4「quota/evicted/degraded 全静默」**只覆盖可见性角度**(集成方无感知),**未明确覆盖 unhandled rejection 角度**;RE-P2-2 是同根问题但从「未捕获拒绝」维度暴露 —— 仍可视为同一根本原因(缺 .catch + 留痕),建议合并修复(一行 `.catch(e => debugLogs.push({type:'persist_error', ...}))`)。
- **建议**:封装 `safePersist(fn)` 工具:内部 `void fn().catch(e => log + emit observable)`,所有 `void store.save(...)` 统一走此包装。

### P3:卫生(非真泄漏)

#### RE-P3-1:approval 自动拒 setTimeout 无 clearTimeout
- **证据**:`src/core/sdk/createChatSdk.ts:1331-1335`(send/batch 路径的 `makeApprovalWatch`)。
- **缺陷**:`setTimeout(() => { if (signal?.aborted) return; ... }, approvalAutoRejectMs)` 无 clearTimeout;abort 后 setTimeout 仍挂 30s 才自消。
- **增长模型**:每次 send/batch 路径 approval_request 各产 1 个 timer,30s 自动消失,**不跨周期累积**;但若集成方循环触发 approval + 频繁 abort,会在 30s 窗口内累积 N 个挂起 timer(N = 30s 内触发次数)。
- **对照**:挂起面 #3「trim LLM 异步 unmount 后无取消」同型,但 approval 路径未登记。**影响微小**,定 P3。
- **建议**:把 timer 也推入 cleanup 集合(类比 approval.ts:74-76 中间件层做法),signal abort 时 clearTimeout。

#### RE-P3-2:core.listeners 在实例 unmount 时不移除该实例的 sdk.hook 注册
- **证据**:`src/core/sdk/events.ts:27-30`(hook add/delete) + `src/core/sdk/createChatSdk.ts:1375`(core.listeners = events.listeners) + `2354-2355`(return sdk.hook)。
- **缺陷**:`sdk.hook(handler)` 返回取消函数,但 SDK 自身**不在 unmount 时自动取消该实例的所有 hook 注册**;若集成方丢失取消函数,handler 残留在 `core.listeners` Set 中,后续 emit 仍调它(闭包可能持有已销毁实例的状态)。
- **shareContext 多实例场景**:同 id 多实例共享同一 core.listeners,实例 A unmount(refCount--)后 core 仍活,A 注册的 handler 继续 被 B 的 emit 触发。**设计内**(hook 是运行时订阅,生命周期由集成方管理),非 SDK bug。
- **建议**:文档明示「sdk.hook 返回的取消函数须在集成方 unmount 钩子中调用」;或 `sdk.hook(handler, { autoCancelOnUnmount?: boolean })` opt-in 自动管理。

#### RE-P3-3:useChat composable 内 currentController 无 onScopeDispose 清理
- **证据**:`src/core/composables/useChat.ts:61`(`let currentController`)无 `onScopeDispose` / `onUnmounted` 钩子。
- **现状评估**:ChatDialog 容器场景**无泄漏** —— createChatSdk.unmount() 先 `core.abortAllActive()` 中止在途流,然后才 `dialogController.unmount()` 触发 vueApp.unmount();useChat 内 currentController 此时已 abort。**OK**。
- **潜在缺口**:若集成方独立复用 useChat(非 ChatDialog 容器),且未在组件卸载钩子中显式调 stop/reset,currentController 引用会持有 AbortController 直到下一轮 GC。**理论泄漏,实践罕见**(useChat 不在公开导出主路径)。
- **建议**:useChat 内加 `onScopeDispose(() => { currentController?.abort(); pendingApproval.value = null; queuedTasks.value = [] })` 防御性清理(零回归,Vue 组件 scope 销毁时自动调;非组件 scope 是 no-op)。

## 已修复完整性验证(2.41 markdown 节流 / 压缩异步化 / trim GC 等)

逐项核实 2.40-2.42 各资源管理修复**确实落地且覆盖完整**:

| 修复项 | 证据 | 验证结论 |
|---|---|---|
| **markdown 渲染节流 + 尺寸闸** | `useMarkdown.ts:115` watch + `:132` `onScopeDispose(() => { if (timer) { clearTimeout(timer); timer = null } })` | ✅ timer 在组件 scope 销毁时确定清,无泄漏;hljs >20K 跳过 + sanitize 永不跳过符合契约 |
| **压缩 LLM 摘要异步化(模板先行 + 后台前缀缓存)** | `useContextManager.ts:88-103` `llmCache` 单调 coveredCount 守卫 + `llmInFlight` finally 重置 + `.catch(() => {})` 失败不污染缓存 | ✅ 状态机自洽,无死锁/无脏缓存;后台 fire-and-forget 失败保留索引模板,降级正确 |
| **trim GC(context_trimmed + vfs 可达性回收)** | `createChatSdk.ts:2006-2017` emit `context_trimmed`(含 dropped 原文 + vfsResults)+ `:2019` `gcVfsOrphans()` 删 older 后扫剩余 large_results 引用 | ✅ 删除前发通知(集成方可归档完整原文)+ 删除后 GC 不可达项,被剩余轮引用的留;语义完整 |
| **vfs 引用保护收敛性(LRU 跳过被引用 large_results)** | `vfs.ts:124` enforceLimit 跳过 `_protectedRefs.has(k)`;`:117-118` OOM 硬兜底(池字节 > 1.5× 上限无视 protectedRefs 强删);`createChatSdk.ts:1672` stream 入口 `setProtectedRefs(extractVfsRefs(msgs))` | ✅ 正常路径防 vfs_read 404,OOM 1.5x 兜底防全池被保护撑爆,**收敛性双向保证** |
| **activeControllers core 级注册表(P1-11)** | `createChatSdk.ts:1354-1368` Set + trackActive/untrack + abortAllActive;`:1683-1684` stream `.finally(untrack)`;`:2292-2293`/`:2297-2298` send/batch `try/finally untrack` | ✅ 异常路径全覆盖(finally 在 throw 时也跑),shareContext 多实例共享同一注册表 |
| **unmount 收口链顺序** | `createChatSdk.ts:2252-2271` abortAllActive → resolveConflict → removeEventListener(pagehide/visibilitychange)→ 置 null → dialogController.unmount(动画→release)/ headless 直接 release | ✅ 顺序正确:先断流再清监听再 release;approval/conflict 随 signal 自动收口 |
| **mountChatDialog 退出动画 transitionend + setTimeout 320ms 兜底** | `mountChatDialog.ts:111-120` done 守卫防重复 + `{ once: true }` 自动解绑 + setTimeout 兜底 | ✅ 无累积监听器 |
| **MCP mcpClosers** | `:2100` 只 push fulfilled 的 close;`:1697-1698` release 时 `splice(0)` + `Promise.allSettled` | ✅ 连接失败不入 closers;allSettled 不抛 |
| **approval/skills/retry/subagent 各 timer 完整 clearTimeout** | approval.ts:74-76 cleanup 数组 / skills.ts:92-97 / retry.ts:53-61 / subagent.ts:417-426 finally clearTimeout | ✅ 全部 finally/cleanup 链清理,settled 守卫防重 |
| **debugLogs / spans 限长** | `createAgent.ts:206` MAX_DEBUG_LOGS=300 + `:308`/`:316`/`:330` splice 限长 + `:572` MAX_LOG_CONTENT_CHARS=6000 截断;resetSession `:1660` 清空 | ✅ 单条 6KB × 300 = 上限 ~1.8MB,长会话不膨胀 |
| **dataOps 快照栈 + baselines Map** | dataOps.ts:163/237/344 `while (snapshots.length > maxSnapshots) snapshots.shift()`;`:305` exitScope `baselines.delete(id)` + setData/update `baselines.clear()` | ✅ FIFO 限长 + scope 清理双保险 |
| **checkpoint stack** | checkpoint.ts:138 max=5 + `:178` `while (stack.length > max) stack.shift()` + importStack `stack.length = 0` | ✅ 5 条上限 + restore 重置 lastXxxClone 基线防错乱 |
| **subagent tracker history LRU** | subagent.ts:108 `while (history.length > historyLimit) history.pop()`(默认 20)+ steps 只记 kind+name+ts(非全文) | ✅ history 不膨胀;steps 单条上限已登记(deferred 性能 #4,降级关注) |
| **workingMemory LRU** | workingMemory.ts:18 MAX_ENTRIES=10 + `:45`/`:53` LRU 淘汰 + `:102-103` reset 清空 + `:108-110` hydrate 复带上限防御 | ✅ 严格 ≤10 + reset 完整 |
| **compress 累积摘要 prevSummaryBody 合并** | useContextManager.ts:118-128 提取头部旧摘要 + `:232-234` 拼接;rounds.ts:130-172 trimMemoryMessagesImpl `mergeSummarySegments` | ✅ 合并不丢历史(只增不减是已知设计权衡,deferred 上下文 #4) |
| **Worker terminate + blob URL revoke** | sandbox.ts:84-93 finish() 内 `worker.terminate()` + `URL.revokeObjectURL(url)`;`:114-116` 创建失败也 revoke | ✅ 三层防护(timeout/正常完成/创建失败)都走 finish,无 blob URL 泄漏 |

## 排查无问题清单(逐项核实,确认 OK)

以下累积点/清理路径已逐行核实,**不构成泄漏或膨胀**,留档防后续重复怀疑:

### 注册表与监听器
1. **activeControllers Set**:`createChatSdk.ts:1354-1368` trackActive + untrack,send/batch/stream 三路径 `try { ... } finally { untrack() }`,异常路径全覆盖
2. **events.listeners Set**:`events.ts:19-32` shareContext 共享同一 core.listeners,hook 返回取消函数,设计为集成方管理生命周期(RE-P3-2 文档项)
3. **flushHandler / visHandler(pagehide / visibilitychange)**:`createChatSdk.ts:2211-2212` 装、`:2259-2262` unmount 时 removeEventListener + 置 null;shareContext 多实例各自管自己的
4. **mountChatDialog transitionend listener**:`mountChatDialog.ts:119` `{ once: true }` 自动解绑 + done 守卫防重

### Timer / Watch / Worker
5. **sandbox Worker 创建/terminate**:每次 eval/skill exec new Worker + blob URL,finish() 三层防护(正常/超时/创建失败)都 terminate + revoke;**每轮新 Worker 但严格清理**
6. **withStallTimeout**:`stallTimeout.ts:49-51` finally clearTimeout
7. **withRetry delay**:`retry.ts:52-61` abort 联动 clearTimeout + removeEventListener
8. **approval 中间件**:`approval.ts:40-77` cleanup 数组 + settled 守卫,clearTimeout + removeEventListener 双清
9. **skills fetch AbortController**:`skills.ts:92-97` clearTimeout + abort
10. **subagent 执行 timer**:`subagent.ts:417-426` finally clearTimeout + cleanup() 解绑父 signal + 清子 scope 基线
11. **useMarkdown 节流 timer**:`useMarkdown.ts:132` onScopeDispose 清
12. **ApprovalBar / ConflictBar / FocusBar / SkillPanel / CodePreview / DebugDrawer 的 watch**:Vue 组件 scope 自动注册/销毁

### vfs / 快照 / 基线
13. **vfs 四池 LRU**:`vfs.ts:110-140` 池独立 + 总上限兜底 + OOM 1.5x 强删无视 protectedRefs(收敛性双向保证)
14. **vfs saveTimer**:`vfs.ts:147,159-163` scheduleSave 内 if (saveTimer) clearTimeout 防重入 + clear() 内 clearTimeout;release() 路径走 flush 再 dispose
15. **vfs _protectedRefs**:`createChatSdk.ts:1672` 每次 stream 覆盖(不累积)
16. **dataOps snapshots 栈**:maxSnapshots 默认 20,while shift 限长;setData/update 清栈
17. **dataOps baselines Map**:exitScope.delete + setData/update.clear;per-scope 不互污

### 上下文累积(已登记项,排查确认仍属已知权衡)
18. **累积摘要只增不减**:deferred 上下文 #4 已登记,百轮级才成瓶颈;compress 与 trimMemoryMessages 都合并 prevSeg 不丢历史
19. **checkpoint messages 每轮整体 clone**:deferred 性能 #2 已登记(maxCheckpoints=5,Phase B 增量未实施)
20. **persistRuntime 每轮全历史 JSON round-trip**:deferred 性能 #3 已登记
21. **subagent tracker steps 无 run 上限**:deferred 性能 #4 已登记(受子轮数天然约束,降级关注)
22. **enforceLimit O(文件数²)**:deferred 持久化 #8 已登记(仅文件数多时敏感)
23. **estimateTokens 三处口径不一**:deferred 上下文 #6 + 性能 #1 已登记(无害,统一为卫生项)

### 状态重置完整性
24. **resetSession(createChatSdk.ts:1648-1667)**:abort + resolveConflict + 清 messages/vfs/todos/memory/mission/workingMemory/focus/checkpoint/debugLogs + 新 sessionId;**storage 关也完整执行**(P1-8 已修)
25. **switchSession(:2300-2303)**:经 runSerial + abortAllActive + 收口挂起冲突(P1-10)
26. **core.release(:1687-1701)**:refCount-- + 归零时 abortAllActive + flush + store.dispose + skillStore.dispose + mcpClosers allSettled + sharedCores.delete

### 子 agent 资源
27. **子 agent AbortController 链**:`subagent.ts:401-405` 父 signal abort → 子 abort;cleanup() 解绑监听 + 清子 scope 基线
28. **子 agent streamP.catch 吞**:`:425` 防超时 race 后 streamP 抛 unhandled
29. **子 agent tracker**:`subagent.ts:90-113` active Map + history LRU 20,finish 移入 history;steps 仅摘要

### 持久化补丁
30. **switchSession 切走前补 persist mission/workingMemory/focus**:`createChatSdk.ts:1601-1606` 防 setMission 后切会话漏存(P1-7 context-persist-resilience)
31. **mission/workingMemory/focus 持久化**:非空才写省 IDB 写;focus 为空存 null 覆盖清除(P1-7)

---

## 汇总

| 级别 | 数量 | 概要 |
|---|---|---|
| **P0**(确定性泄漏) | **0** | 长会话必崩路径未发现 |
| **P1**(长会话可感膨胀/特定路径泄漏) | **0** | 已登记项不重复;未发现新 P1 |
| **P2**(边缘泄漏) | **2** | RE-P2-1 autoTitle LLM fire-and-forget 无 unmount 守卫 / RE-P2-2 persistRuntime 内 8 处 void store.save 无 .catch |
| **P3**(卫生) | **3** | RE-P3-1 approval setTimeout 无 clearTimeout / RE-P3-2 core.listeners 实例 unmount 不自清 / RE-P3-3 useChat 无 onScopeDispose |

### 关键结论

1. **资源管理整体非常健壮**。2.38-2.42 的多轮「挂起有界收口三契约」+「core 级注册表」+「P1-11 串行闸上移」+「trim GC + vfs 引用保护 + OOM 硬兜底」修复**全部落地且覆盖完整**,无回归。
2. **未发现确定性内存泄漏**(P0=0)。所有累积点均有明确上限或清理路径。
3. **新发现仅 2 个 P2 + 3 个 P3,全部是 fire-and-forget 异步路径的销毁守卫缺口**,核心同步路径(unmount 收口链 / activeControllers / Worker / vfs LRU)无问题。
4. **2 个 P2 都可一行修复**(try/catch 或 .catch + debugLogs 留痕),建议合并到挂起面 #4 已有的「fire-and-forget persist 无 catch」修复批次;autoTitle 与 trim/persist 同根,合并修复零增量成本。
5. **3 个 P3 都是卫生项**,非真泄漏;RE-P3-2 listeners 与 RE-P3-3 useChat 建议走文档/防御性 onScopeDispose,不影响主流程。
