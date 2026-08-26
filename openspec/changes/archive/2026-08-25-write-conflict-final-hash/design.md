# Design: write-conflict-final-hash(2026-08-25 五路讨论定稿)

> 三方案对抗论证(A final hash / B per-scope mutex / C 混合)+ 设计深审(收敛形态「live vs 当前基线」被证伪)后的裁决:**C 收窄形态**。两路独立评审同结论:A 的豁免形态(无论 effHash+豁免账本还是基线比对)要么违反「不相交双写不得过拦」红线,要么恰好豁免掉立项主场景(同子树双写)——「A 在用自己的豁免杀自己的卖点」;B 结构性修不了唯一无界窗口(ask 挂起 × 外部写);C = B 的结构性防常态竞态 + A 收窄到 ask 恢复点做一次性补校验。

## 定稿设计(全部落在 dataOps 闭包内)

1. **闭包级 async mutex(单锁,bind 域,非 per-scope)**:主×子共享同一 createDataOps 闭包与 bindRef(dataOps.ts:908-912),per-scope 锁漏主写∥子写交叉;跨 scope 写本就不真正并发,单锁零代价。锁放 dataOps 闭包内(不能放 createAgent coreExecTool —— 那层不知 scope/写语义,会把只读工具也串了)。
2. **锁覆盖段**:全部写工具的 `[取 effHash → handleConflict 检查 → commit → setBaseline]`;**effHash 必须在 acquire 之后取**(否则破坏 N1 时序契约)。写入口勘误:**7 个 commit 位**(proposal 原写 3 处):write(set) 1467 / write(edit/patches) 1452 / **write(del) 1436-1441(原漏)** / draft_commit 1591 / eval transform 三模式 1219/1232/1258-1264(**eval 今天完全无乐观锁检查**,且 runSandboxedScript 1210 是 3-8s 宏任务窗口 —— eval 的沙箱计算留锁外,只锁 commit 段)。
3. **ask 路径拆段**:检出冲突 → **先释放锁** → await onConflict → 裁决 overwrite 时**重取锁 + 补一次 hashBind() vs effHash 校验**(单发 VERSION_CONFLICT 不二次挂起);keep_external / restore 照旧。restore 裁决后补 setBaseline(顺手修深审发现的基线刷新缺口之一)。
4. **overwrite 裁决吸收基线**(深审洞修):handleConflict 的 overwrite 分支(自动 policy 或人工裁决)返回前 `setBaseline(hashBind())` —— 否则紧后校验把刚批准的写入打回,无人值守 overwrite 防永挂场景被机制自己卡死。
5. **不进锁**:codeAsset 子 commit(经 recomputeBaseline 刷主基线;给 commit 加锁会让 afterAgent 卡在挂起写后面,延迟耦合比竞态更糟)/ resource_update / restore_data。
6. **条件装配:`maxParallelTools>1 && lockOn` 相与**(深审契约修正:不 gate on lockOn 会给未 opt-in conflictWatchFields 的并行用户新增默认冲突,破坏「conflictWatchFields 是是否校验的唯一旋钮」契约 dataOps.ts:933-935;未武装时 serialize 后照样通过,「后写覆盖」就是既有明文语义 :1387,不越权改变)。
7. **S1(同路径并行双写)语义定案**:「与串行模式逐字节等价的**后写叠加**」并文档化 —— B/C 修的是锁机制,不是信息层陈旧(两写基于同一 stale read,双计数器各写 count=1 终值 1 非 2;串行模式同批不可能发生,「等价于串行」只在锁层面成立)。接受 + 明示(与 N1 既有立场一致);可选后续增强:harness 层复用 effectiveWritePaths(createAgent.ts:1116)做同批路径重叠非阻塞提示(failStreaks rider 先例 :1074-1077),零锁参与。
8. **豁免账本任务作废**:mutex 使「invoke 内贡献豁免」失去必要性 —— 原 tasks Phase 0 任务 1 删除,C 相对 A 的最大复杂度净减。
9. **顺手修**:dataOps.ts:1407-1409 N1 注释(声称同步路径,实有 await)与 :902-906 注释同步改写;sdk.updateResource 公共 API 补基线刷新(深审缺口②;工具版 rupdate 有刷 :1657,同一操作两条路不对称)。

## 最大两风险与缓解(对抗论证 R1/R2)

- **R1 锁跨 ask 未释放的实现滑手**(回归即无界饥饿):handleConflict 全入口共用,拆段漏一个 early-return 即复现持锁挂起。缓解:acquire/release 只包非挂起段 + finally 强制;selftest「onConflict 永不 resolve + 兄弟写 100ms 内完成」;e2e 断言补校验 observable 只在 ask 恢复路径出现。
- **R2 S1 意图级更新静默丢失**:见设计 7,文档明示 + 可选 rider。

## 测试设计(深审 g 项:竞态是微任务确定性的)

- selftest:`const p1 = writeFn(a); const p2 = writeFn(b); await Promise.all` 即确定性复现双取旧基线(pool worker 微任务交错);ask 挂起用可控 deferred onConflict + 挂起期直改 bind。
- e2e:StubChatModel + maxParallelTools=2 同轮双写;slow_probe 时序锚复用 capability-packs.mjs:920-938(componentLock 先例)。
- 串行零回归锁:既有计数不变为验收门禁。

## 场景覆盖矩阵(对抗论证定稿)

| 场景 | C 行为 |
|---|---|
| S1 常态并行双写(armed) | 后写取新基线正常通过,外科叠加(=串行);同路径意图级陈旧接受并文档化 |
| S2 ask 挂起期外部写 | 恢复点补校验 catch → 单发 VERSION_CONFLICT / policy 分流 |
| S3 ask 挂起期兄弟写 | 锁已释放,兄弟照常落地刷基线;我恢复后按裁决分流 |
| S4 子 codeAsset commit 交叉 | 不进锁;recomputeBaseline 保基线新鲜;ask 窗口交叉由补校验接住 |
| S5 无锁模式(未武装) | no-op(与既有「未声明不校验」契约一致) |
| S6 eval transform 沙箱窗口 | commit 段进锁(计算留锁外);今天 eval 连乐观锁检查都没有,属增量收益 |
