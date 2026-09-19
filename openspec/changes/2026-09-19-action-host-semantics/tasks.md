# Tasks:action-host-semantics

> 打勾标准:代码/文档落地 + 对应测试绿 + 计数同步。单 commit 收口(改动面集中)。

## Phase 1:类型与失效集(S1-C)

- [x] 1. `src/core/sdk/actions.ts`:`ActionDef` 增 `readsHostState?: boolean` / `deferredWrite?: boolean`;`actionsToInspectInfo` 信息面 + 两布尔
- [x] 2. `src/core/harness/readInvalidation.ts`:`invalidatePageReads` 增可选 `extraTools?: Set<string>`(默认集不动)+ 新增 `effectivePageReadTools` 并集纯函数(空集原样返回默认集,零分配);createChatSdk 装配期收集标记名(`hostReadActionNames`)→ hostNotice 中间件传入
- [x] 3. `src/core/harness/actionGate.ts`:页面依据计数改用注入的有效集(`isZeroPageBasis(usage, extraTools?)`);经 createAgent 选项 `pageReadTools` → gateChain `RunFinishGatesInput.pageReadTools` 透传(与 2 同源)
- [x] 4. selftest sec-129 +6:effectivePageReadTools 空集/缺省引用相等(零行为差)/并集含默认+标记/标记 action 占位 + 未标记保留/未传扩展集不动(现行为)/扩展集幂等

## Phase 2:事实清单口径(S1-D)

- [x] 5. 零工具门禁事实清单(`buildTurnFactSheet` 增可选 `deferredWriteTools?: Set<string>`):`name×N(提案类,待用户确认后才生效,尚未写入)` 注记;等效写计数显式排除(deferred action 非 writeCapable 非 delegation,`isZeroEffectiveWrite` 零改动);gateChain 5 处调用点透传 `i.deferredWriteTools`
- [x] 6. selftest sec-130 +5:标记 action 计入页面依据/未传扩展集不算(现行为)/注记文案/空集与不传逐字节一致(格式锁)/多次计数如实

## Phase 3:公共面与文档

- [x] 7. `types/index.d.ts` + `types/headless.d.ts`:ActionDef 双标记 + `inspect().actions` 信息面字段 + `CreateAgentOptions.pageReadTools/deferredWriteTools`(纯加法,minor;**实施注记:CreateAgentOptions 漏同步曾红 types-alignment 的 keyof S2D 断言** —— d.ts 类型面纪律「新增钩子/字段必须同步投射」的活例,补齐后三 types 门禁全过)
- [x] 8. e2e 新模块 `tests/e2e/action-semantics.mjs` 12 项:标记 action 流内占位 + 未标记对照(现行为零变化)/inspect().actions 反射双标记/谎报「已修改完成」→ 事实清单注记回灌 → 模型改口闭环(inspect().gates.zero_tool_gate.retries=1);注册进 e2e-integration(36 模块)
- [x] 9. 文档四语侧:usage-guide §actions 段中英(两标记语义 + 门户案例口径)/ README 中英 actions 行 / CLAUDE.md(其他能力 actions 短语 + 计数 3716/1214 + e2e 模块数 36)
- [x] 10. CHANGELOG 4.20.0(minor)+ 计数同步(selftest 3705→3716 / e2e 1202→1214 / browser 169 不变)+ 门禁:build/test 3716/test:e2e 1214/exports 25/types 族 3 项/size 6/计数对账/pack 25 files 全绿;**发布前询问用户**(待用户拍板)
