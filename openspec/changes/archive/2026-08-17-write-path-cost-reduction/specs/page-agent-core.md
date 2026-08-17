# Specification Delta: page-agent-core

> 本文件为 change `write-path-cost-reduction` 的增量 Requirement。2 条(①写路径成本收敛与实时性不变量 / ②性能基准留证)。**patch 级**(零行为变化,纯内部收敛)。

## Requirement: 写路径成本收敛与冲突检测实时性

同一次写调用内,同一数据态的重型 O(N) 计算(hash/深拷贝)至多执行一次;冲突检测的当前态 hash 保持每次实时计算,禁止任何形式的跨调用缓存。

- **同调用 hash 单算**:写成功后的新基线(setBaseline)与结果消息中的「新 hash」必须来自同一次 `hashValue` 计算(经 `commitBaseline(scope)` 辅助);write edit 意图与 edit_data 成功路径适用,write(set) 既有范本不变
- **codeAsset 改前态单拷贝**:配置 internalAfterWrite 时,写前深快照(`beforeBind`)同时服务 `__pgId` 位置回填与快照栈条目,`applyPatchesToBind` 不再对改前 bindRef 二次深拷贝;未配置时行为与成本不变。**约束**:`internalAfterWrite` 的 `before` 参数为只读契约(复用为快照条目后 mutate 会污染快照栈),注释固化
- **冲突检测实时性不变量(P0)**:`handleConflict` 及 read/get_data 携带的当前态 hash 必须每次实时计算 —— 禁止脏标记/版本号/跨调用 memo(外部人工直改 reactive bind 不经 SDK 写路径,任何 SDK 侧脏标记感知不到;缓存 = keep_external 保护失明 → 人工修改被静默覆盖,M4 实证场景)。注释 + 本条 Requirement 双固化
- **行为零变化(锁定项)**:① 同 scope 连续写永不冲突(N1 契约)② 外部改后 autoLock 写必触发 VERSION_CONFLICT/挂起 ③ keep_external/overwrite/restore 三决议语义不变 ④ 快照栈 push/restore/history 语义与深度上限不变 ⑤ `__pgId` 回填结果不变 ⑥ 消息文案与 hash 值语义不变(同一状态同一 hash 串)
- **可测约束**:① 写后消息「新 hash」=== 该 scope 当前基线值 ② codeAsset 写 → restore_data 回退到改前完整值(快照共享后正确性)③ __pgId 回填在快照共享后行为不变(browser capability-packs 既有覆盖)④ 上述行为零变化项各有既有测试且全绿

## Requirement: 写路径性能基准留证

写路径性能改动必须携带可复现的量化证据,不以体感替代:

- **bench 脚本**:`tests/perf/write-path-bench.mjs`(node 跑 dist),合成 bind 50KB/300KB/1MB 三档 × codeAsset/非 codeAsset 两模式,单 patch 写 × 200 报 median/p95
- **留证**:改造前后数字记入 design §5;bench 不进 CI 门禁(环境 flaky 防护),随 change 归档留证
- **止损**:若 bench 实测收益 <10%,允许缩水为仅 A 段(双算消除),B 段留痕退出 —— 不为指标妥协正确性
