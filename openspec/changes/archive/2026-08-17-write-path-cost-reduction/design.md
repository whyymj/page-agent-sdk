# Design: write-path-cost-reduction

## 1. 现状成本账(file:line,2026-08-17 复核)

见 proposal「Why」表。补充两条路径账:

- **read(高层)**:每 read 一次 `hashValue(bindRef)`(dataOps.ts:942)+ projectBySchemaDeep + summarize → read+write 配对 = 4 次全量 hash/轮。read 的 hash 不消重(每次实时,同 C 不变量)。
- **dryRun**:patch 预检走完整校验链(1 clone + zod),不 setBaseline/不入快照(dryRun 分支早退),账更轻,不动。

## 2. 决策:A. commitBaseline 辅助(双算消除)

```ts
/** 写成功后单次计算新基线并返回(消息「新 hash」复用返回值,勿二次 hashValue) */
function commitBaseline(scope?: string): string {
  const h = hashValue(bindRef)
  setBaseline(h, scope)
  return h
}
```

改点(各 3 行内):
- `write` edit 意图:`setBaseline(hashValue(bindRef), scope)` + 消息 `hash=${hashValue(bindRef)}` → `const h = commitBaseline(scope)` + 消息 `hash=${h}`
- `edit_data` 成功路径:同型(dataOps.ts:671-672)

**不引入**更激进的「轮内基线缓存」:两次工具调用之间隔着模型调用(数秒),期间人工/宿主可直改 bind(M4 实证),基线必须只在写成功那一刻计算。

## 3. 决策:B. beforeBind 复用为快照值(codeAsset 模式)

现状:`applyPatchesToBind` 尾部

```ts
snapshots.push({ id, ts, op:'edit', value: deepClone(bindRef) })   // #4 改前态拷贝
…(写回 bind)…
args.internalAfterWrite?.(bindRef, beforeBind)                      // beforeBind = #2 改前态拷贝
```

改为:

```ts
snapshots.push({ id, ts, op:'edit', value: beforeBind ?? deepClone(bindRef) })
```

(beforeBind 在 codeAsset 模式 = 未被任何方变更的改前态完整深拷贝,与 `deepClone(bindRef)` 此刻等价 —— 写回发生在 push 之后)

**共享安全性逐消费方论证**:
| 消费方 | 行为 | 论证 |
|---|---|---|
| `internalAfterWrite(bind, before)` | codeAsset 按 `__pgId` 位置回填,只读扫描 before | 契约既有(internalAfterWrite 签名注释「before = 写前深快照(按位置回填原 __pgId 用)」),不 mutate |
| 快照栈 `restore_data` / 冲突 resolution `restore` | `restoreLive(bindRef, deepClone(entry.value))`(dataOps.ts:566)| **防御性深拷贝后回写**,快照条目按不可变值对待,共享引用无别名突变 |
| `history_data` | 只读列出 | 无 mutation |
| maxSnapshots 淘汰(shift)| 释放引用 | 无 mutation |

**顺序注意**:push 快照(引用 beforeBind)发生在 `internalAfterWrite` 调用之前/之后均可(同一引用),维持现状顺序不动,只改 value 来源。

**非 codeAsset 模式**:`beforeBind === null` → 走 `?? deepClone(bindRef)`,行为/成本与现状完全一致。

**边界**:若未来出现「internalAfterWrite 需要 mutate before」的调用方,该复用即失效 —— 在 `applyPatchesToBind` 的 internalAfterWrite 参数注释补一句「before 为只读约定;applyPatchesToBind 在 codeAsset 模式将其复用为快照栈条目(别名共享),mutate 会污染快照」。

## 4. 决策:C. 冲突检查 hash 实时性不变量

落两处:
1. `handleConflict` 上方注释:当前态 hash 禁止缓存(脏标记/版本号/跨调用 memo 均否)—— 外部人工直改 reactive bind 不经 SDK 写路径,任何 SDK 侧脏标记都感知不到;缓存 = keep_external 保护失明 → 人工修改被静默覆盖(M4 真实场景,2026-08-17 modes 套件实证)
2. specs Requirement(见 spec delta),防后人以「性能优化」名义回退

## 5. bench 方法论与目标

`tests/perf/write-path-bench.mjs`(node 直跑 dist 产物,与 e2e 同源):
- 合成 bind:{ title, components[50/300/1000] }(每个 component ~1KB 含 code 字段,近似 complex-demo 形态)≈ 50KB / 300KB / 1MB
- 场景:`write({patch:{op:'set', jsonPath:'components.3.props.title'}})` × 200 次,报 median/p95 单次耗时;codeAsset 模式(带 internalAfterWrite spy)与非 codeAsset 两档
- 对照:改造前后各跑一轮,数字记入本节(bench 不进 CI,防环境 flaky;归档留证)

**目标**:单次写 hash 次数 3→2、clone 次数 codeAsset 3→2;预期 1MB 档单次写耗时降 ~25-35%(数字以 bench 为准,不为指标妥协正确性)。

**基线(2026-08-17,改造前,Apple M 系 node 22,N=200/warmup 20)**:

| 档 | bind | 非codeAsset median | codeAsset median |
|---|---|---|---|
| 50 组件 | ≈47KB | 1.4ms | 1.5ms |
| 300 组件 | ≈290KB | 8.7ms | 9.7ms |
| 1000 组件 | ≈979KB | 30.1ms(p95 39.2)| 34.4ms(p95 55.5)|

→ 1MB 档 30ms/写 ≫ 5ms 退出阈,立项成立;50 连写批 ≈1.5-1.9s 纯开销。

**复测(2026-08-17,改造后,同机同参)**:

| 档 | 非codeAsset median | codeAsset median |
|---|---|---|
| 50 组件 | 1.2ms(**-14%**)| 1.2ms(**-20%**)|
| 300 组件 | 7.7ms(**-11%**)| 7.6ms(**-22%**)| 
| 1000 组件 | 26.5ms(**-12%**)| 27.7ms(**-19%**)|

→ 全档 >10% 止损阈,A+B 两段均保留;codeAsset 与非 codeAsset 差距收敛(改前态单拷贝抹平了 codeAsset 的一趟额外 clone)。剩余成本主体 = 必要项(2 clone:patch 工作副本+快照、2 hash:冲突检查实时+新基线、zod safeParse、消息 safeStringify),见 Non-goals。

## 6. 回归面与门禁

- selftest 全量(dataOps 相关 sec 模块重点)+ 新增:① 同调用 hash 单算(spy 计数:mock hashValue 不可行则计 deepClone/stringify 调用次数,或导出注入计数器 —— 取实现时最轻方案,允许只锁「消息 hash === 本轮基线」行为断言 + 快照共享 restore 正确性)② codeAsset 写后 restore_data 回退到改前值 + __pgId 回填不受影响
- e2e 全量(改 createChatSdk 顶层行为零变化,但按「核心模块」口径跑满):data-slots / conflict / capability-packs / main-sub-isolation 零回归
- browser:complex-demo(写链含 codeAsset + 拦截器真实路径)
- 真实 LLM:不需要(纯性能收敛,行为零变化;uispec 套件可选跑)

## 7. 风险清单

| 风险 | 等级 | 缓解 |
|---|---|---|
| B 别名突变污染快照(未来调用方违约)| 低-中 | 只读契约注释 + restore 防御性拷贝既有 + selftest 锁 restore 正确性 |
| A 重构引入时序回归(N1 同 scope 连续写不冲突契约)| 低 | 该路径同步无 await 的注释保持;conflict e2e 既有覆盖 |
| bench 数字无改善(理论误判)| 低 | bench 先行(阶段 1),若 <10% 收益则 B 降级为仅 A,留痕退出 |
