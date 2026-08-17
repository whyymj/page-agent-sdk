# Proposal: write-path-cost-reduction(写路径 O(N) 成本收敛)

## Why

SDK 定位 = **规范化的 JSON 操作 Agent**(页面配置/低代码 schema 几百 KB~1MB 是目标场景),写链是最高频路径。audit-sdk-integrity A 专项 A3 + 数据写链 #6 评级「必然」:**每次 autoLock 写对全量 bind 做 3-4 次哈希 + 2 次深拷贝,几百 KB bind 单次小 patch ≈ 6-7 次 O(N) 遍历**。2026-08-17 对照当前代码复核,该账仍成立且更重(codeAsset 模式):

单次 `write({patch, autoLock:true})`(edit 意图)在 N 大小的 bind 上:

| # | 操作 | 位置 | 必要性 |
|---|---|---|---|
| 1 | `hashValue(bindRef)`(handleConflict 当前态)| dataOps.ts:548 | **必要**(冲突检测,不可缓存,见 C)|
| 2 | `deepClone(bindRef)`(beforeBind,__pgId 回填改前快照)| dataOps.ts:244 | codeAsset 模式必要 |
| 3 | `deepClone(bindRef)`(patch 工作副本)| dataOps.ts:245 | **必要**(原子校验链)|
| 4 | `deepClone(bindRef)`(快照栈改前态)| dataOps.ts:290 | **与 #2 重复**(同为改前态完整拷贝)|
| 5 | `hashValue(bindRef)`(setBaseline 新基线)| dataOps.ts:1119 | **必要**(下轮冲突比对基准)|
| 6 | `hashValue(bindRef)`(结果消息「新 hash=」)| dataOps.ts:1121 | **与 #5 同值重复** |
| 7 | `safeStringify(r.clone, 600)`(消息预览,全量序列化后截断)| dataOps.ts:1122 | 必要但可量化后议 |

→ codeAsset 模式 ≈ **3 clone + 3 hash**;非 codeAsset ≈ 2 clone + 3 hash。1MB bind 下单次写纯开销数十 ms,自动化批(`sdk.batch` 50 连写)秒级全是重复计算。edit_data 同型双算(dataOps.ts:671-672)。

同时,「惰性 hash/缓存」方向有一个**必须显式否决并固化为不变量**的陷阱:跨调用缓存 hash(脏标记/版本号方案)在人工直改 reactive bind 时**必然失明** —— M4 真实场景实证:用户在子 agent 生成期间直改 `window.page.components[i].code`,不经过任何 SDK 写路径,`markDataDirty` 版本号不感知 → 缓存 hash 陈旧 → handleConflict 比对陈旧对陈旧 → **人工修改被静默覆盖**(keep_external 保护全线失效)。

## What Changes

### A. 同调用 hash 双算消除(零风险,3→2 次/写)

新内部辅助 `commitBaseline(scope): string` —— 单次 `hashValue(bindRef)` 同时完成 setBaseline + 返回值供消息复用。改点:
- `write` edit 意图(dataOps.ts:1119-1121)
- `edit_data` 成功路径(dataOps.ts:671-672)
- `write(set)` 路径已是此范本(`__postHash` 单算复用,dataOps.ts:1133-1135),不动
- 其余 `setBaseline(hashValue(...))` 站点(718/746/880/893/920/1315)各只算一次,不动

### B. codeAsset 模式改前态单次拷贝(3→2 次 clone)

`applyPatchesToBind` 中 `beforeBind`(#2)在 `internalAfterWrite` 消费后改作快照栈 `snapshot.value`(#4 消除),同一引用两用。安全性论证(design §3):
- `internalAfterWrite(bind, before)` 对 `before` 只读(codeAsset 按 `__pgId` 位置回填,只扫描)
- 快照栈消费方 restore 已防御性 `deepClone(entry.value)` 再回写(dataOps.ts:566),快照条目被当不可变值
- 非 codeAsset 模式(beforeBind=null)零变化,快照仍自拷贝

### C. 冲突检查 hash 实时性不变量(P0 固化)

- 代码注释 + spec Requirement 双落:`handleConflict` 的当前态 hash **每次实时计算,禁止跨调用缓存/脏标记/版本号方案**(理由如上,M4 场景)
- read/get_data 携带的 hash 同口径(它是 agent 手动 expectedHash 的来源)

### D. 量化基准(非 CI 门禁)

`tests/perf/write-path-bench.mjs`:50KB/300KB/1MB 合成 bind × 单 patch 写,median 计时,改前/改后数据进 design §5。防 flaky 不进测试门禁,数字随 change 归档留证。

## Non-goals(明确不做 + 理由)

- **跨调用 hash 缓存 / 惰性基线**:外部突变盲区(上述 C)—— 审计 A3 的「脏标记惰性 hash」方向整体否决,只保留同调用消重
- **per-scope 子树 hash**(子 agent 写只 hash 其可写子树):语义变化(当前冲突检测覆盖全 bind,子树化 = 检测面收窄),非纯性能收敛,不夹带
- **快照栈持久化数据结构 / copy-on-write 重构**:克隆语义是快照栈正确性根基,结构共享是不亚于重写的大工程,收益剩余仅 1 次 clone
- **消息 safeStringify 早停**:`JSON.stringify` 无法早停,自定义 walker 收益单趟且引入第二套序列化实现(与 safeStringify 循环/HTMLElement 语义漂移风险);bench 后若 #7 占比显著再立项
- **estimateTokens 三处口径统一 / 单轮单次扫描**:独立 deferred(性能 #1/#6),正交

## Impact

- **代码面**:`src/core/tools/dataOps.ts`(commitBaseline 辅助 + 2 双算改点 + applyPatchesToBind 快照复用 1 改点 + handleConflict 不变量注释);不改任何导出 API/类型/默认值
- **行为面**:零 —— 乐观锁契约(同 scope 连续写永不冲突/外部改必检出/keep_external)、快照 restore、__pgId 回填、消息文案与 hash 值语义全部不变;唯一可见差异是单次写耗时不升反降
- **测试面**:selftest 补 2 条(同调用 hash 单算计数 × spy / codeAsset 快照共享后 restore 正确性);既有 sec 对应模块 + e2e data-slots/conflict/capability-packs 全量零回归即锁定
- **风险**:B 的对象共享需逐消费方论证(design §3 已列);A 为纯局部重构。风险等级低,但触及 dataOps 核心路径,门禁按「核心模块」口径全跑
