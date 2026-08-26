# Tasks:write-conflict-final-hash(并发写互锁 TOCTOU 根因修复)

> 2026-08-25 五路讨论后改判 **C 收窄形态**(闭包级 mutex + ask 恢复点补校验),design.md 定稿;原「invoke 内豁免账本」任务作废(mutex 使其失去必要性)。

## Phase 0:mutex 主体

- [x] 1. dataOps 闭包级 async mutex(单锁 bind 域):包全部写工具 `[取 effHash → handleConflict → commit → setBaseline]`;effHash 在 acquire 后取;7 个 commit 位逐一接入(write set/edit+patches/del/draft_commit/eval 三模式 —— eval 只锁 commit 段,沙箱计算留锁外)
- [x] 2. ask 路径拆段:冲突检出先释放锁 → await onConflict → overwrite 重取锁 + 补一次 hashBind vs effHash(单发 VERSION_CONFLICT);keep_external/restore 照旧
  - ✅ 2026-08-25 实施修正:恢复点校验锚 = **裁决者所见 hash(curHash 检出时刻)**,非 effHash —— 冲突本身即 bind≠effHash,对 effHash 校验会把每次 overwrite 裁决都打回(设计 #4 说的「自我否决」正是这个);keep_external 不重取锁(finally 幂等 no-op),restore 在锁内回退
- [x] 3. overwrite 裁决吸收基线(handleConflict overwrite 分支 setBaseline(hashBind());restore 裁决后同补)—— 防裁决自我否决
- [x] 4. 条件装配 `maxParallelTools>1 && lockOn` 相与(不破坏「conflictWatchFields 唯一旋钮」契约);maxParallelTools 管道从 createChatSdk 传入 dataOps
- [x] 5. 顺手修:N1 注释改写(dataOps.ts:1407-1409 与 :902-906)+ sdk.updateResource 公共 API 补基线刷新(与工具版 rupdate 对齐)
- [x] 6. debugLogs observable 留痕(ask 恢复点补校验命中)—— 落地为 `audit({op:'conflict_recheck'})`(onAudit 消费方/诊断可见)+ tool_result 回灌同源(e2e 断言)

## Phase 1:防饥饿与装配

- [x] 7. 锁实现防滑手:acquire/release 只包非挂起段 + finally 强制;handleConflict 全 early-return 路径逐一过(8 条路径核过:无 expectedHash/无冲突/无 onConflict/keep_external/restore 无快照/restore 完成/补校验拦/补校验过)
  - 实现形态:handle 式 `{release, reacquire}`(reacquire 重新武装同一 handle,caller finally 恒调 release;所有权经 waiter 直接移交防插队双持)
- [x] 8. 装配期并发写 warn 撤除(createAgent.ts:388-389,机制补齐后失义)+ 未武装精化提示移至 dataOps 装配期(`>1 && !lockOn` 才提示,武装用户零告警)
- [x] 9. selftest:①微任务确定性双写(p1/p2 并发即复现)②onConflict 永不 resolve + 兄弟写 100ms 内完成(防饥饿锁)③ask 挂起期直改 bind → 补校验拦 ④无锁模式 no-op(sec-109,17 断言;含互锁 vs 无锁对照/不相交零冲突/restore+overwrite 基线吸收/draft_commit 段锁 smoke)
- [x] 10. e2e:StubChatModel + maxParallelTools=2 同轮双写:同子树+陈旧基线 → 前写落地+后写恢复点校验显式拦(非静默覆盖);不相交 → 双双落地零冲突;串行零回归(全量计数只增不减,conflict.mjs +2 场景 4 断言;微任务确定性无需 slow_probe 锚)

## Phase 2:文档与验收

- [x] 11. CLAUDE.md 乐观锁契约段(并发写互锁 + S1 叠加语义明示)+ usage-guide 中英并行段 + CHANGELOG
- [x] 12. deferred.md P2 清单 #1 随验收移除;changes/README 状态更新
- [x] 13. 四门禁全绿 + complex-ops 真 LLM 复跑(S1 并行委派不回归)
  - 四门禁:✅ selftest 3130 / e2e 1000 / build ✓ / browser 118(改 dataOps 按矩阵已跑)
  - ✅ 真 LLM(2026-08-25,环境切 api.deepseek.com 直连):S1 委派链路机械面正常(use_html×2、子栈工具循环、usage 回传、零崩溃);`custom_code非空` 检查失败经 **596206e 基线 worktree 对照复跑同签名同败** → flash 委派 code 落地质量方差(既有问题),非互锁回归;本套件默认串行,互锁 armed 路径(maxParallelTools>1)由 sec-109 微任务确定性 + e2e conflict 并行双写场景覆盖
