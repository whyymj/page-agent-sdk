# Proposal: write-conflict-final-hash(并发写互锁 TOCTOU 根因修复)

> 状态:**✅ 已实施并随 4.1.0 发布**(C 收窄形态,全 13 任务收口)。优先级 P1(SDK 正确性;团队审查 2026-08-24 定级 P1,既有已文档化缺口)。目标仓库:zhuanti-agent。
> **2026-08-25 五路讨论改判:定稿 C 收窄形态(闭包级 async mutex + ask 恢复点单发补校验),见 `design.md`**;本文件下方「原理」段为原案(final hash + 豁免),保留作决策溯源 —— 深审证明其两条豁免路线(effHash+账本 / live vs 基线)要么过拦不相交双写、要么恰好豁免掉同子树双写主场景;对抗论证证明纯 mutex 修不了 ask×外部写无界窗口。写入口勘误:实际 **7 个 commit 位**(原案写 3,漏 write del 与 eval 三模式);条件装配须 `maxParallelTools>1 && lockOn` 相与。
> 驱动:3 agent 团队审查(并发冲突链)确认 —— `maxParallelTools>1` 时**同轮并发写互不互锁,后写静默覆盖前写**;`dataOps.ts` 代码注释自认根因修复方向(commit 入口 final hash 校验)但至今未落地,装配期 console.warn 只是临时缓解。用户拍板立项。

## Why(现状核实,审查结论)

- **竞态窗口**:`write` 工具的同步前缀(`effHash = getBaseline(scope)`)→ `await handleConflict('set'|'edit', effHash)`(其 curHash 同步计算)→ commit。两个并行写工具都在**任一方 commit 前**完成了前两步 → 双双取到同一旧基线、双双通过乐观锁 → 各自串行落地,后者覆盖前者,**零 VERSION_CONFLICT 回灌**。
- 第二个窗口:`conflictPolicy:'ask'` 挂起等人工期间(可达 30s+),外部/宿主写入 bind → 裁决返回后直接 commit,同样吃掉外部改动(该窗口串行模式也存在,是「宿主直改不在防线面」盲区的近亲)。
- 现状缓解:装配期 warn(「并发写不互锁,如需冲突保护保持 maxParallelTools=1 并声明 conflictWatchFields」)—— 转嫁给集成方,机制欠账。
- 默认 `maxParallelTools=1` 串行不受影响(既有全链路有效,审查通过清单 a-h 全绿);这是 opt-in 并行模式下的正确性缺口。

## 原理

1. **final hash 校验**:写落地入口(commit 紧前,所有 await 之后)重取实时 `hashBind()` 与 `effHash` 比对 —— 不一致即窗口期内 bind 已变 → 走冲突处置。覆盖两个窗口(并行双写 / ask 挂起期外部写)。
2. **条件装配(成本红线)**:仅 `maxParallelTools>1` 启用(竞态唯一来源;装配期从 AgentOptions 传入 dataOps opts)。串行模式**零成本零行为变化** —— 不违反「写路径成本收敛」契约(同调用禁二次全量 hash;1MB ~10ms/次,并行模式下该成本是正确性代价,且整体并行收益远大于此)。
3. **失败语义(单发,防循环)**:校验失败时按 conflictPolicy 分流 —— `overwrite` 直接照写(复检即放行语义)/ `keep_external` 保留外部(返回「未写入」口径,writeGate/nudge 已对齐不误计)/ `ask`(默认)**不再二次挂起**,直接回灌 `VERSION_CONFLICT` toolError(hint 教 re-read 后重试)—— 防「校验→ask→挂起→再校验」死循环。
4. 三写入口统一收口:`write(set)`+`draft_commit`(commitSetToBind)、`write(patch/patches)`+eval transform 子树/patches(applyPatchesToBind)、eval 整体替换路径 —— 校验点放三个调用位的紧前(纯函数入口内做则需传 live-hash 闭包,倾向调用位前置以复用工具上下文)。
5. 审计留痕:final-check 命中记 debugLogs(observable `write_final_hash_conflict`),e2e 可断言。

## 优缺点(诚实盘点)

- 优点:并行写从「last-writer-wins 静默」变为「显式冲突/裁决」;ask 挂起期外部写不再被吞;装配 warn 可撤(机制补齐);complex-demo(maxParallelTools:3)与 editor 类并行集成方直接受益。
- 缺点/边界:①并行模式下每写 +1 次全量 hash(条件装配压到只在并行付);②**仅覆盖「hash 域内」的竞争** —— conflictWatchFields 白名单模式下,外部改的是非监听字段则 final 校验天然不报(与既有乐观锁语义一致,不是本 change 缺口);③同批「写 A 子树 + 写 B 子树」不相交场景不受影响(基线是全 bind 域 hash,不相交双写后者会吃 VERSION_CONFLICT?—— **设计要点:final 校验失败仅当被覆盖域与监听域相关;全域 hash 下不相交双写也会判冲突 → 过度拦截**。实施时评估「同批(同 invoke)其他成功写导致的 hash 变化豁免」:final 校验需排除本 invoke 内本工具族已提交写的贡献,或改用「校验基准 = 最近一次成功写后的 hash」(turnUsage 已有账本)。此为 design 阶段第一决策点)。
- 组件锁时序窗口(componentLock P2-2:守卫同步段 vs acquire 在 await 后)是**另一缺口**,不在本 change(保持 deferred)。

## What Changes

- dataOps:三写入口 final hash 校验(条件装配 maxParallelTools>1)+ 失败分流(policy-aware 单发)+ debugLogs 留痕。
- createChatSdk/createAgent:装配期传递并行标志;**撤除装配 warn**(机制补齐后 warn 失义)。
- 测试:selftest(纯函数面:校验判定/失败分流三态/invoke 内豁免逻辑)+ e2e(StubChatModel 同轮双写同子树 → 后写 VERSION_CONFLICT 回灌可见 + 先写数据保留;slow_probe 时序锚复用 componentLock 先例)+ 串行零回归锁(既有计数不变)。
- 文档:CLAUDE.md 乐观锁契约段更新(「并发写互锁」)+ usage-guide 中英并行段 + CHANGELOG Fixed;deferred.md P2 清单 #1 移除(随验收归档)。

## 红线

- 串行模式(`maxParallelTools=1`)**零行为零成本变化**(既有 3052/978/118 计数不变为验收门禁)。
- 不因本修引入「不相交并行双写被过度拦截」的可用性回退(invoke 内豁免必须做,complex-demo 并行委派 e2e 是回归锚)。
- 失败路径单发不循环;`未写入` 口径与 writeGate/nudge/stale-read 三处既有判定对齐。
- 「冲突检查 hash 恒实时计算,禁跨调用缓存」不变量不破(final 校验本身就是实时算)。

## 验收门禁

- e2e:并行同子树双写 → 显式 VERSION_CONFLICT(或 policy 自动裁决)+ 无静默覆盖;并行不相交双写 → 双双正常落地(豁免生效)。
- selftest:final 校验三态 + ask 挂起期外部写场景(模拟 await 间隙 bind 变更)。
- 四门禁全绿;装配 warn 撤除断言;真 LLMcomplex-ops S1(含并行委派)复跑不回归。
