# Proposal: fix-main-sub-isolation(主×子协同隔离)

> 审计 audit-sdk-integrity 组 3(C 主×子协同专项)+ N1(Q4 拍板并入,与 P1-13 同根)。
> 2026-08-11 立项。前置:fix-authorization-surface(2.38.2)/ fix-hang-and-feedback(2.39.0)已发布。

## Why

fix-authorization-surface 收了「谁能写什么」的拦截面;本 change 收「主子协同的运行时隔离」—— 四项均已在审计中读码核实:

- **P1-13(H19 证实)** 主×子共享 dataOps controller 闭包:`lastReadHash`(autoLock 基线)是闭包级单变量,子 agent 工具 = 主 allTools 同一实例零拷贝 → **子 read 会刷新主的乐观锁基线**。危险方向是「静默放行」:父 read(hash A)→ 委派 → 期间外部改过 → 子 read 刷新基线 → 父回来写,autoLock 比对的是子刷新后的基线 → 本应冲突的过期写**静默通过覆盖外部修改**。「get 之后被改过 → 冲突」的承诺对进程内 agent 间失效。
- **N1(二审遗漏,Q4 并入)** 同根问题:乐观锁基线对「进程内连续写」的语义。⚠️ 立项复查修正:N1 原结论「同轮多写连环冲突必现」读码复核后**不成立** —— 各写路径成功后均刷新基线(dataOps.ts 407/447/491/517/645/658/685/851/868/880/992),且 writeSlot 的 effHash 解析→冲突检查→提交为同步路径(拦截器同步、handleConflict 无冲突分支无 await),单线程 JS 下无交错窗口。**保留为防御加固**:把 autoLock effHash 解析点统一延迟到冲突检查时刻(消除未来引入 async 间隙的隐患)+ 回归测试锁定「agent 自己连续写自己永不冲突」语义。
- **P1-14(H20 证实)** `spawn_agents` 用 runPool + Promise.all 语义:fn 内 throw → worker reject → `Promise.all(workers)` 整体 reject → **一个子任务失败,已成功兄弟的结果全丢**,主 LLM 只见一条错误;失败语义与「多路调研、批量处理」的工具定位相悖(应为 allSettled:各自结算)。
- **P1-17(H28 证实)** ① 子 agent = 裸 createAgent,无 sdk-events 中间件 → **子的 LLM token 不计 core.usage** → automation tokenBudget 漏算全部子消耗(可 8 子 × 多轮);② 子执行**无超时**:子挂死 → 父无限等,timeBudget 只在父 wrapModelCall 检查,拦不住在途子(fix-hang-and-feedback 的 streamStallMs 只管单次流停滞,管不到「子多轮累计挂死」)。

## What Changes

1. **per-scope 乐观锁基线(P1-13)**:`lastReadHash` 单变量 → `baselines: Map<scopeId, hash>` + `activeScope`;`DataOpsController` 增 `enterScope(id)`(返恢复函数,嵌套安全)/ `exitScope(id)`(清条目);dataOps 工具挂不可枚举 marker;子 agent 工具池构建时把 dataOps 工具包一层 scope proxy(invoke 期间切到子 scope)→ 子 read/write 只动子 scope 基线,主基线不被污染;委派结束清子 scope 条目。
2. **autoLock 解析点加固(N1)**:writeSlot 的 `effHash` 解析保持/确认为「冲突检查时刻」(拦截器之后),显式 expectedHash 优先;补回归断言(同 scope 连续写不冲突)。
3. **spawn_agents allSettled(P1-14)**:runPool fn 逐项 try/catch,失败不 throw,返回结构化成功/失败;聚合文本按子任务逐条标 ✓/✗(失败带错误摘要),工具整体不再因单个子失败 reject。
4. **子 usage 回传(P1-17a)**:抽 `normalizeUsage` 纯函数(contentParts.ts,sdk-events 与子栈共用);子栈加 `sub-usage` 中间件(afterModel 提取 → `opts.onUsage` 回调)→ createChatSdk 累加进 core.usage。**只累计不外发 usage 事件**(避免子轮与主轮混发困惑集成方)。
5. **子执行超时(P1-17b)**:`SubagentOptions.timeoutMs`(opt-in,默认关);runSubagent 用链式 AbortController(父 signal → 子 controller)+ timer race,超时 abort 子流并抛超时错误(spawn 工具 catch → recoverable 回灌,主 LLM 可重试/拆分)。`createChatSdk({ subagent: { timeoutMs } })` 配置面。

## Impact

- **行为**:默认配置零回归(scope 机制仅在子 agent 存在时生效;allSettled 只改失败路径聚合;usage 累计口径变全(含子),是修正不是破坏;timeout 默认关)。
- **API**:新增可选 `subagent.timeoutMs`;`SubagentOptions` 增 `enterDataScope`/`exitDataScope`/`onUsage`/`timeoutMs`(内部装配面);`DataOpsController` 增 `enterScope?`/`exitScope?`;`normalizeUsage` 导出。
- **测试**:selftest sec-71(scope 隔离/嵌套恢复/延迟解析/marker)+ e2e main-sub-isolation.mjs(allSettled 聚合/基线隔离/usage 回传/超时)+ stub 增 delayMs。
- **版本**:minor 2.40.0(新增可选配置面)。

## Non-goals

- 不改 runPool 本身(allSettled 语义在 spawnMany 的 fn 层做;createAgent 同轮工具并行的 runPool 用法不变)。
- 不重构 createDataOps 闭包为多实例(快照/资源/审计必须与主共享,仅基线 per-caller)。
- 不引入 async-local-storage(scope 切换经工具 proxy 显式 enter/exit,M3 类并发交错仅在 maxParallelTools>1 + spawn 并行时理论存在,不劣于现状)。
- approval 挂起期间的基线时刻语义(approval 在工具体之前,挂起期间基线可能被其他写刷新)—— 已知边缘,记录不修。
