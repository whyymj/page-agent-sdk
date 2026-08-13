# audit-CA:并发原子性(Concurrency Atomicity)

> 审计口径:本维度覆盖 `maxParallelTools>1` 同轮并发工具的隔离 / 同轮连续写的乐观锁交互 / abort 在途工具的取消语义 / 批量 patches 原子回滚边界 / 中间件 `wrapToolCall` 在并发下的安全性 / `spawn_agents` 并发子任务结算与共享 state。
>
> **deferred.md 已登记项不重复报告**:循环/终止面、主×子、挂起面已有项已知;聚焦未登记的新问题 + 已修复项的完整性验证(是否真修/残留路径)。
>
> 评估日期:2026-08-12。评估版本基线:develop 分支(当前 2.42.0)。

---

## 审计范围(读了哪些 src/契约)

| 文件 | 关键段 | 并发关注点 |
|---|---|---|
| `src/core/harness/createAgent.ts` | L591-825 `stream` 主循环、L732-764 工具并发执行段 | ReAct 循环、`runPool(maxParallelTools)` 并发执行、abort 检查点(轮首/工具结果回填后)、abort 不取消已启动工具 |
| `src/core/utils/pool.ts` | L9-36 全量 | 并发池实现:`limit<=1` 串行 / `>1` 抢任务模式;signal 不启动新任务但不取消已启动 |
| `src/core/harness/middleware.ts` | L75-99 契约、L168-176 `composeToolCall` | `wrapToolCall` 洋葱(reduceRight);`ToolCallContext.signal/emit/logSink` 由 createAgent 注入 |
| `src/core/harness/subagent.ts` | L287-427 `runSubagent`、L429-555 `createSubagentMiddleware`(spawn)、L669-806 `createSubagentsMiddleware`(预声明 use_<id>) | 子 agent childAc 监听父 signal、cleanup 解绑、`runPool(maxParallel=4)` 并发结算、闭包级 `currentSignal/currentEmit/currentLogSink` |
| `src/core/tools/dataOps.ts` | L130-175 `commitSetToBind`、L185-250 `applyPatchesToBind`、L276-305 baselines/activeScope/enterScope/exitScope、L348-377 `handleConflict`、各工具 invoke | 乐观锁基线(per-scope)、同步纯函数原子链、activeScope 单变量嵌套恢复模式 |
| `src/core/sdk/createChatSdk.ts` | L1347-1368 串行闸/trackActive/abortAllActive、L1648-1685 resetSession/stream 入口、L2282-2301 send/batch/switchSession 包装 | core 级串行闸、在途流注册表、stream 不经 runSerial、abort 联动 |
| `src/core/utils/serialRunner.ts` | L13-20 全量 | `chain.then(fn, fn)` 双路推进,前一个 reject 不卡死后续 |
| `src/core/utils/stallTimeout.ts` | L33-55 | 流停滞看门狗,超时不调 iterator.return(走 abort 清理) |
| `src/core/sdk/conflictManager.ts` | L22-44 | 并发新冲突自动 `keep_external` 收口旧 conflict(防 resolve 函数丢失) |

---

## Findings(按级)

### P1-1:同轮并发写(`maxParallelTools>1`)下乐观锁完全失效,后写可覆盖前写

- **位置**:`src/core/tools/dataOps.ts:348-377`(`handleConflict`)+ L413-422 / L435-462 / L791-898(各 write 工具)+ L989-1011(`draft_commit`)
- **问题**:`maxParallelTools>1` 时,同轮并发的两个写工具(`write`/`edit_data`/`set_data`/`draft_commit` 任一组合)都进入 `handleConflict`,二者都在 `await handleConflict` 让出前已经取过 `effHash = getBaseline()`(同步)。JS 单线程下,两个 `handleConflict` 内部的 `curHash = hashValue(bindRef)` 都读到 bind **尚未改变**时的同一份 hash = 旧基线,均通过乐观锁检查(null 返回),随后各自 `commitSetToBind` 同步串行写入。**后写者本应触发 `VERSION_CONFLICT` 让 LLM 重读再写,实际却通过**。
  - 数据视角:若两 write 路径不冲突(各改各的 key,`safeMerge` 叠加),最终一致;**若路径冲突**(同字段、或一个 set 整体替换 + 一个 patch 增量),后写覆盖前写,前写改动**丢失且无任何提示**。
  - 这是 deferred.md N1(已收口)修的「同 scope 连续写连环冲突」的反向问题:N1 修串行下后写误判冲突(基线未及时更新),CA-1 是并发下两写都通过(根本没互锁)。语义不同,N1 的 per-scope 基线修复对 CA-1 无效(并发两写在彼此写入前都读了基线,基线是否新鲜无关)。
- **触发条件/复现路径**:
  1. 集成方配 `maxParallelTools>1`(默认 1,需显式开;advanced toolMode 不影响 maxParallelTools 默认值,但 LLM 在多 patch 工具可用的场景更易并发起写)。
  2. LLM 在同一轮返回 2+ 个写工具调用(write/edit_data/set_data/draft_commit 任一组合)。
  3. 复现伪码:`sdk = createChatSdk({ ..., maxParallelTools: 2 })`;mock LLM 单轮返回两个 `write({patch:{op:'set', jsonPath:'a.b', value:1}})` + `write({patch:{op:'set', jsonPath:'a.b', value:2}})`。两个 write 都返回「已 write(edit)」,最终 `bind.a.b === 2`(后写覆盖),无 VERSION_CONFLICT 提示 LLM 重试。
- **定级理由**:并发下数据写入可能静默丢失(前写被覆盖,无任何错误回灌 LLM)。但触发需集成方主动开 `maxParallelTools>1`(默认 1 规避),且 `dataOps.ts:278-281` 注释已部分承认「并发工具下 autoLock 退化」(只是仅说 read 基线顺序不定,未说 write 失互锁,描述不完整)。综合定 P1(可感退化 + 数据风险,有逃生舱)。
- **建议**:
  - 短期:在 `dataOps.ts:278-281` 注释补「并发写不互锁,后写覆盖前写风险」,并在 `toolMode:'advanced'` 或 `maxParallelTools>1` 时由 `usageHints` 提示 LLM「同轮不要并发发起写入工具」。
  - 中期:在 `commitSetToBind` 入口加一次「final hash 校验」(在 handleConflict 与 commit 之间没有 await,但并发另一写可能已 commit 改 bind,所以 commit 入口需要重读 bind 当前 hash 与 effHash 再比对一次;不匹配则返回 VERSION_CONFLICT)。注意:`commitSetToBind` 是纯函数,需把 bindRef 当前 hash 作为入参或闭包内重新计算。这是根因修复。
  - 长期:并发写应进串行闸(类比 core.runSerial),或写工具按 schema key 加细粒度互斥。

### P2-1:`dataOps.activeScope` 单变量嵌套恢复模式,在 `spawn_agents` 并发多子 agent 下错乱

- **位置**:`src/core/tools/dataOps.ts:286-305`(`activeScope` / `enterScope` / `exitScope`)+ `src/core/harness/subagent.ts:268-280`(`wrapWithScope`)
- **问题**:`activeScope` 是 `createDataOps` 闭包内的**单变量**,`enterScope(id)` 用「保存 prev → 设新值 → 返回恢复函数」的嵌套恢复模式。该模式在串行嵌套下正确,在并发交错下错乱:
  - 主 agent 调一次 `spawn_agents({tasks:[tA, tB]})`,内部 `runPool(maxParallel=4)` 并发跑两个子 agent A 和 B。
  - 子 A 和子 B 各自被装配了 `wrapWithScope(dataOpsTool, scopeId, enterDataScope)` 包裹的 dataOps 工具(子 agent writablePaths 配置时,L318)。
  - 两个子 agent 并发跑 ReAct,各自调 dataOps 工具时:
    - A 调工具:enter('sub-A')→ `activeScope='sub-A'`,prev_A='MAIN' → await `target.invoke`(让出)
    - B 调工具:enter('sub-B')→ `activeScope='sub-B'`,prev_B='sub-A'(**覆盖**)
    - A resume:工具内 `getBaseline()`/`setBaseline()` 读写的都是 'sub-B'(错归属)
    - A 工具返回 → exit_A → `activeScope = prev_A = 'MAIN'`(但 B 还在跑,接下来 B 读 baseline 归到 MAIN)
    - B 工具返回 → exit_B → `activeScope = prev_B = 'sub-A'`(已 exit,残留无效 scope)
  - 注:**触发不需要集成方显式开 `maxParallelTools>1`** —— `spawn_agents` 内部默认 `maxParallel=4`,只要 LLM 调一次 `spawn_agents` 起多子即触发。
- **后果**:
  - 数据完整性:子 agent 写经 `wrapWithPathGuard` 限制在 `writablePaths`,**不会越界写主数据**;数据角度安全。
  - 乐观锁基线:子写 baseline 归属错乱 → 父 MAIN baseline 可能被子误写(或反之)。父后续写 `handleConflict` 检测 `curHash ≠ effHash` → **误 VERSION_CONFLICT**(LLM 重读再写可恢复)。理论上有小概率误放行(父基于过期 hash 通过),但需要特定时序,常见结果为误冲突(可自愈)。
- **触发条件/复现路径**:
  1. 集成方配 `subagents` 或允许 spawn,且子 agent 配 `writablePaths`(否则子无写工具,activeScope 错乱只影响读 baseline,无可见危害)。
  2. LLM 调 `spawn_agents({tasks:[2+ 个写任务]})` 或并发调多个 `use_<id>`。
  3. 子 agent 内部并发调 write/edit_data 等 dataOps 写工具。
  4. 复现:用 stub model 让主 agent 单轮返回 `spawn_agents` 工具调用,起 2 个子任务,每个子 agent 内 stub 让其写主数据;观察父 baseline 在 spawn_agents 结束后是否与 bind 一致(预期:不一致,父后续写收到 VERSION_CONFLICT)。
- **定级理由**:触发不需集成方非默认配置(只要用子 agent + writablePaths + spawn_agents),但实际危害为误冲突(可自愈,LLM 重读再写即恢复),非数据损坏。P2。
- **建议**:
  - 短期:`wrapWithScope` 的 enter/exit 改为基于 `AsyncLocalStorage` 或 per-call 上下文(把 scopeId 作为工具调用的隐式参数,而非全局单变量)。但浏览器无 AsyncLocalStorage,需手工传递。
  - 中期:`enterScope` 改用栈结构 + per-call scopeId token(工具调用结束按 token 而非按闭包变量恢复),或让 `wrapWithScope` 在调用前 snapshot baselines、调用后选择性 commit 子 scope 的变更。
  - 兜底:`spawn_agents` 内 maxParallel 默认 4,可在文档警示「子 agent 写共享 bind 时建议 maxParallel=1」。

### P2-2:`createSubagentsMiddleware`(预声明 use_<id>)闭包级 `currentSignal/currentEmit/currentLogSink` 在 `maxParallelTools>1` 同轮并发委派下错乱(无警告注释)

- **位置**:`src/core/harness/subagent.ts:674-676`(声明)+ L693(中间件)/ L792-796(`wrapToolCall`)+ L711-732(`use_<id>` 工具 fn 引用闭包变量)
- **问题**:`createSubagentsMiddleware`(预声明 subagents → `use_<id>` 工具)的 `currentSignal/currentEmit/currentLogSink` 是闭包级单变量,`wrapToolCall` 在 `next(ctx)` 之前同步赋值,然后 `await next(ctx)`。当 `maxParallelTools>1` 同轮并发委派(`use_a` + `use_b` 并发)时,两个 wrapToolCall 互相覆盖:
  - use_a wrapToolCall:`currentSignal = ctx_a.signal`(覆盖)
  - use_a 进入 `await next(ctx_a)`(让出)
  - use_b wrapToolCall:`currentSignal = ctx_b.signal`(**覆盖**)
  - use_b 进入 `await next(ctx_b)`
  - use_a resume → 子 agent runSubagent 内 `onLog = (entry) => currentLogSink?.(...)` 读取的是 use_b 的 logSink(转发到错误 handler);forward 内部 `currentEmit(...)` 同样错乱;signal 继承到 use_b 的 signal。
  - **同型 `createSubagentMiddleware`(spawn 版)在 L432-434 已标 M3 已知警告**,预声明版未标。
- **后果**:
  - 子 agent 继承到无关工具的 signal(用户停止信号错乱 —— 主 agent 停,子 agent 可能不停或反之)。
  - 子进度转发到错误 handler(UI 步骤分组错位)。
  - logSink 错乱(子日志被错误标签转发到主 debugLogs)。
- **触发条件/复现路径**:
  1. 集成方配 `maxParallelTools>1` + `subagents:[{id:'a',...},{id:'b',...}]`。
  2. LLM 同轮并发返回 `use_a({task})` + `use_b({task})`。
  3. 观察:子 agent 的进度事件 taskId 与 observeId 不匹配(use_a 的子进度被转发到 use_b 的 UI 分组),或主 agent abort 时只有 use_b 的子 agent 停。
- **定级理由**:`maxParallelTools>1` 是非默认配置,spawn 版已明示 M3,预声明版是同型漏洞未标。危害为观察层错乱 + abort 信号错位(后者可能导致子 agent 不停,但主循环已结束 → 子流成为孤儿,直到自身完成或 timeoutMs 触发)。P2。
- **建议**:
  - 短期:在 `createSubagentsMiddleware` L674 / L792 加与 spawn 版同款 M3 警告注释,并在 `usageHints` / 文档明示「`maxParallelTools>1` 与预声明子 agent 委派存在已知错乱」。
  - 彻底修(同 spawn 版 M3 待修方向):让 `use_<id>` 工具从 `ToolCallContext` 取 signal/emit/logSink(而非依赖 wrapToolCall 写入闭包单变量),把 wrapToolCall 同步捕获的值作为参数显式传入 `runSubagent`。

### P3-1:`runPool` 已启动任务在 signal abort 后不取消(设计决策,文档化建议)

- **位置**:`src/core/utils/pool.ts:6-7`(注释)+ L29-32(`if (signal?.aborted) return`)
- **现状**:`runPool` 在每个 worker 抢任务前检查 `signal?.aborted`,但**已启动的任务(`fn` 已在 await 中)不取消**。这是 JS 单线程无法中途取消的合理设计(pool.ts 注释已明示)。`createAgent.ts` 主循环在轮首(L648)/工具结果回填后(L763)再检查 abort,所以 abort 后**下一轮不会启动**,但**当前轮已启动的工具会跑到完成**(结果被回填进 currentMessages 然后整个 while 退出)。
- **影响**:中间件 `wrapToolCall` 或工具 invoke 内部若 await 长任务(子 agent / MCP),abort 后该任务继续跑,占用 LLM/网络资源直到自然完成。结果被丢弃(stream done 后 return '')。
- **定级理由**:已知设计决策,有注释,但未在契约文档(CLAUDE.md / architecture.md)明示。P3 卫生项。
- **建议**:在 `doc/architecture.md` §⑮「挂起有界收口三契约」补一条「同轮工具并发 + abort:已启动工具跑到完成,结果丢弃;下一轮不启动」,集成方知晓即可。

---

## 已修复完整性验证(2.38.2-2.43.0 涉并发/主子隔离/挂起收口的修复,核实是否真修/残留)

### ✅ N1 同轮/并发多写乐观锁连环冲突(2.40.0 per-scope 基线)— 真修,残留见 CA-1

- **修在哪**:`dataOps.ts:283-305` 实现 `MAIN_SCOPE('') + baselines: Map<string, string> + activeScope + enterScope/exitScope`;所有写工具(`set_data:421` / `edit_data:461` / `delete_data:505` / `restore_data:531` / `write:885,897` / `draft_commit:1009` / `eval_script transform:659,672,699` / `resource_update:1072`)的 `setBaseline` 都基于 `activeScope`,串行连续写基线随前写更新,后写 `getBaseline()` 拿到新 hash → 不连环误判冲突。
- **真修判定**:✅ 串行场景下契约「同 scope 连续写永不冲突」成立(代码逻辑符合,deferred.md N1 已收口正确)。
- **残留**:**并发写无互锁**(CA-1)。N1 的修复假设写是串行的(前写完成 setBaseline 后后写才取 baseline),并发下两写都在前写完成前取 baseline → 都通过。这是 N1 修复的边界外场景,非 N1 修复回归。

### ✅ core 级串行闸 + activeControllers(2.41 P1-11)— 真修,残留见 deferred UI #1

- **修在哪**:`createChatSdk.ts:1353-1368` `createSerialRunner() + activeControllers: Set<AbortController> + trackActive/abortAllActive`;L2291-2301 `send/batch/switchSession` 经 `core.runSerial`;L1683 `stream` 经 `trackActive(signal)` 登记 + `finally(untrack)` 收口。
- **真修判定**:✅ shareContext 同 id 多实例共享同一 core 的串行闸/注册表;生命周期收口(unmount/switchSession/resetSession/release)调用 `abortAllActive` 中止共享 core 全部在途流。`trackActive` 联动 outer signal → controller abort 链路完整。
- **残留**(已登记,不重复报):stream 入口经 trackActive 但**不经 runSerial** —— 已在 deferred.md「UI #1」登记(2.41 部分覆盖,headless 编程式并发双流无闸残留)。

### ✅ resetSession abortAllActive + 收口冲突(2.41 契约 C)— 真修

- **修在哪**:`createChatSdk.ts:1648-1667` `resetSession` 入口 `abortAllActive()` + `conflictMgr.resolve('keep_external')`。
- **真修判定**:✅ reset 先中止在途流防幽灵流写进新会话,再收口挂起冲突(keep_external 不写入,无跨会话写窗口)。stream 入口 `trackActive(signal).finally(untrack)` 配合,abort 同步传播。
- **残留**:理论 abort 异步取消窗口极窄(stream 内部 await 看到 abort 后停),已登记 deferred.md「UI #2 ✅」收口正确。

### ✅ abort 不重试 + 保留 partial(2.41 fix-hang-and-feedback P1-7)— 真修

- **修在哪**:`createAgent.ts:497-500` 流迭代中 abort 不抛,返回 `{message: aggregated ?? AIMessage(content), aborted: true}`;`isAbort(err, signal)` 在 retry / afterModel / 各种 catch 点正确判定。
- **真修判定**:✅ abort 保留已累积 partial(content 字段),onEvent done 正常发送;stream 中止不触发重试(先排 abort 再判 status)。
- **残留**:无(该修复路径完整,审计未发现遗漏分支)。

### ✅ spawn_agents allSettled 逐任务结算(2.40 fix-main-sub-isolation P1-14)— 真修

- **修在哪**:`subagent.ts:498-520` `runPool(tasks, maxParallel, async (t,i) => { try {...; return {ok:true,text}} catch {return {ok:false,error}} })`,失败不 throw,聚合 `✓/✗` 逐条。
- **真修判定**:✅ 单子失败不拖垮整批,主 LLM 见各任务结果(成功/失败)决策。
- **残留**:无。

### ✅ per-scope 基线 + 子 agent enterDataScope/exitDataScope(2.40 P1-13)— 真修(串行下),并发下见 CA-2

- **修在哪**:`dataOps.ts:283-305` + `subagent.ts:267-280 wrapWithScope` + `subagent.ts:316-319` 装配期按 `__dataOpsScoped` marker 包 scope proxy + `runSubagent:405` cleanup `exitDataScope(scopeId)`。
- **真修判定**:✅ 串行下单子 agent 委派,activeScope 正确切到子 scope,子 read/write 只动子 baseline,主 baseline 不被污染。修复了原「子 read 刷新共享 lastReadHash → 父过期写静默放行」的 P0 数据风险。
- **残留**:**并发多子 agent 下 activeScope 单变量嵌套恢复模式错乱**(CA-2)。串行语义正确,并发是新边界。

### ✅ 子 agent timeoutMs(P1-17b)— 真修

- **修在哪**:`subagent.ts:413-426` `Promise.race([streamP, timeoutP])` + `childAc.abort()` 超时取消 + `streamP.catch(() => {})` 吞 abort rejection 防 unhandled + `finally { clearTimeout; cleanup() }`。
- **真修判定**:✅ opt-in 默认关;开启后超时 abort 子流 + 错误回灌 recoverable,主 LLM 可重试/拆小子任务。
- **残留**:无。

### ✅ 子 agent childAc 监听父 signal + cleanup 解绑(abort 链)— 真修

- **修在哪**:`subagent.ts:401-405` `childAc.abort()` 由父 signal 触发 + `cleanup()` 内 `signal.removeEventListener('abort', onParentAbort)`。
- **真修判定**:✅ 父停则子停链路完整,cleanup 解绑防内存泄漏。
- **残留**:并发下父 signal 经 `currentSignal` 闭包单变量传递,**并发覆盖会让子继承到错误 signal**(CA-2 / CA-3)。串行下正确。

---

## 排查无问题清单(查了哪些点确认 OK)

1. **`commitSetToBind` / `applyPatchesToBind` 同步纯函数原子性**(dataOps.ts:130-250)
   - 两者都是同步函数(无内部 await),clone → 逐 patch 校验 → apply → schema 校验 → 写回 bind + snapshot + audit 全链路在单次微任务内完成。JS 单线程保证单工具内原子。✓
   - `applyPatchesToBind` 任一 patch 失败立即 return `{ok:false}`,不写 bind,不入快照,满足「批量 patches 原子回滚」契约。✓

2. **同轮连续写(串行 maxParallelTools=1)的乐观锁交互**(dataOps.ts:413-462)
   - 默认 `maxParallelTools=1`(串行):write_A 完整执行完(包括 `setBaseline(H_A)` 在 commitSetToBind 后)才轮到 write_B。write_B 的 `getBaseline()` 拿到 `H_A` → `handleConflict` 比对 `curHash=H_A=effHash` → 通过。**契约「同 scope 连续写永不冲突」成立**。✓

3. **`runPool` 串行模式(limit=1)**(pool.ts:18-24)
   - 等价原 for 循环,每项前检查 abort,顺序执行,顺序回填。无并发问题。✓

4. **`spawn_agents` allSettled 逐任务结算**(subagent.ts:498-520)
   - 单子失败 return `{ok:false,error}` 不 throw,聚合文本逐条 ✓/✗。整批不被单失败拖垮。✓

5. **`conflictManager` 并发新冲突自动收口旧冲突**(conflictManager.ts:26-31)
   - 覆盖 `pendingConflict.value` 前若仍有未解决 conflict,自动 `prev.resolve({action:'keep_external'})`。**防 resolve 函数丢失导致工具永挂**。设计正确。✓

6. **`handleConflict` async + `commitSetToBind` 同步链**(dataOps.ts:348-377)
   - 串行模式下,handleConflict null 返回 → commitSetToBind 同步执行,中间无 await 让出 → 单工具内原子。✓
   - 注:并发模式下的缺口见 CA-1。

7. **abort 链路完整性**:
   - `trackActive(outer)` 联动 outer signal → controller abort(createChatSdk.ts:1356-1363)✓
   - `core.agent.stream(msgs, handler, controller.signal)` 把 controller.signal 传入 createAgent(createChatSdk.ts:1684)✓
   - createAgent 主循环每轮首检查 `signal?.aborted`(L648)+ 工具结果回填后检查(L763)✓
   - `coreModelCall` 内部 `inner = new AbortController()` 联动外层 signal(L448-452),传给 `streamer.stream(req.messages, {signal: inner.signal})` ✓
   - `runPool(ctxs, maxParallelTools, fn, signal)` 接收主循环 signal(L755)✓
   - 子 agent:`childAc.abort()` 监听父 signal(subagent.ts:401-403)✓

8. **子 agent cleanup 解绑监听**(subagent.ts:405)
   - `signal?.removeEventListener('abort', onParentAbort)` + `exitDataScope?.(scopeId)` 在 finally 调用。无内存泄漏,无 scope 残留(串行下)。✓

9. **`draft_commit` 复用 `commitSetToBind`**(dataOps.ts:1006-1011)
   - 与 write(set)/set_data 共用单一真相源,op='draft_commit' 标记快照/审计。乐观锁链路一致(handleConflict 在前,commitSetToBind 在后)。✓

10. **`composeToolCall` 洋葱包裹**(middleware.ts:168-176)
    - `reduceRight` 正确构造洋葱:最外层中间件最先执行,最内层是 core。`wrapToolCall` 各层在 `next(ctx)` 之前同步赋值,`next(ctx)` 之后无代码的中间件不会在并发下被覆盖(赋值在 await 之前完成)。✓
    - 注:subagent/subagents 中间件的 wrapToolCall 把值赋给**闭包单变量**(非 ctx),工具 fn 内 await 期间读取闭包变量 → 并发覆盖问题(CA-2 / CA-3)。

11. **`setLlm` / `setTools` 运行时重配置的并发安全**:
    - `setTools`(createAgent.ts:846-849)/ `setLlm`(L856-860)/ `rebindTools`(L365-367)都是同步赋值 + rebind。下一轮 LLM 调用才用新工具集。运行中轮的工具池不变。✓
    - 注:`setTools` 在主循环跑时不冲突(同步操作不会打断 await),但若 LLM 调用与新 bindTools 在同一微任务内交错,理论有竞态 —— 实际 JS 单线程,集成方调用 setTools 必在 await 之外,无并发问题。✓

12. **`stream` 入口 `setProtectedRefs` + abort 联动收口 conflict**(createChatSdk.ts:1672-1684)
    - `vfsStore?.setProtectedRefs?.(extractVfsRefs(msgs))` 注入被引用集防 LRU 淘汰 ✓
    - `signal.addEventListener('abort', abortConflict, {once:true})` 用户停止时自动收口挂起 conflict(keep_external)✓

---

## 附:未升级为 finding 的观察(留底,不逐条报)

- **`composeToolCall` 洋葱 + 同步赋值的并发安全性**:中间件 `wrapToolCall` 若严格遵循「同步赋值在 `await next` 之前 + 无 after-next 逻辑」模式,并发下其自身赋值不会被覆盖(赋值是同步原子)。问题集中在中间件把值赋给**闭包单变量**而非 **ctx**(subagent/subagents 两处)。其他内置中间件(todos/skills/memory/summarization/focus 等)的 wrapToolCall 不持有可变闭包状态,无此问题。
- **MCP 工具并发调用**:MCP 工具调用经 wrapToolCall 洋葱,与普通工具一致;allSettled 故障隔离在 client 层。本维度未发现 MCP 特有并发问题(留 SE/RE 维度深挖)。
- **`checkPoint` 每轮整体 clone**:`checkpoint.save` 在 beforeModel 触发,只在每轮开始一次,工具调用中不触发,无并发问题(性能问题在 deferred.md「性能 #2」已登记)。
