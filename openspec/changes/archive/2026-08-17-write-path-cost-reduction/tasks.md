# Tasks: write-path-cost-reduction

> 实施任务清单,`/opsx:apply write-path-cost-reduction` 按此执行。**patch 级**(零行为变化)。顺序即依赖:先量化现状(bench 基线),再动代码,最后复测对比 —— 若阶段 1 发现现状成本可忽略(1MB 单写 <5ms),整个 change 留痕退出(审计 A3 触发条件未成立)。

## 阶段 1:bench 基线(改造前)

- [x] 1a `tests/perf/write-path-bench.mjs`:合成 bind(50KB/300KB/1MB,components 数组含 code 字段近似 complex-demo)× 两模式(codeAsset:internalAfterWrite spy / 非 codeAsset)× `write({patch set components.3.props.title})` × 200,报 median/p95(design §5)
- [x] 1b 基线数字记入 design §5 表格(1MB 档 median 30.1/34.4ms,远超 5ms 退出阈,继续)

## 阶段 2:A 段 —— 同调用 hash 双算消除

- [x] 2a dataOps.ts 增 `commitBaseline(scope)` 闭包辅助(单次 hashValue + setBaseline + 返回);`write` edit 意图与 `edit_data` 成功路径改用
- [x] 2b `handleConflict` 上方固化不变量注释:当前态 hash 禁止缓存(脏标记/版本号/跨调用 memo 否决理由,M4 场景引用)
- [x] 2c selftest(sec-26 +5):消息新 hash 直接作 expectedHash 通过(write/edit_data 两路径,单算无漂移)+ 外部改后旧 hash 必冲突(实时性不变量)

## 阶段 3:B 段 —— codeAsset 改前态单拷贝

- [x] 3a `applyPatchesToBind` 快照 push 改 `value: beforeBind ?? deepClone(bindRef)`;internalAfterWrite 参数注释补 before 只读契约(复用为快照条目,mutate 污染快照栈)
- [x] 3b selftest(sec-78 +5):codeAsset 写生效 + __pgId 回填保留 + restore_data 回退改前完整态 + 未改组件不受影响 + 非 codeAsset 模式零变化
- [x] 3c e2e 全量 753 零回归(含 capability-packs / conflict / data-slots / main-sub-isolation)+ browser 84(complex-demo 写链真实路径)

## 阶段 4:复测与收尾

- [x] 4a bench 复测(design §5 对比表):1MB median -12%/-19%、290KB -11%/-22%、47KB -14%/-20%,全档 >10% 止损阈,A+B 均保留
- [x] 4b 文档:CLAUDE.md 数据槽段「写路径成本收敛」句 + 实时性不变量;CHANGELOG [Unreleased];README/CLAUDE.md 计数 2428
- [x] 4c 门禁全绿(build / selftest 2428 / e2e 753 / browser 84 ✓)→ **待用户确认 bump + 发布**
