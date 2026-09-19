# Tasks:action-host-semantics

> 打勾标准:代码/文档落地 + 对应测试绿 + 计数同步。单 commit 收口(改动面集中)。

## Phase 1:类型与失效集(S1-C)

- [ ] 1. `src/core/sdk/actions.ts`:`ActionDef` 增 `readsHostState?: boolean` / `deferredWrite?: boolean`;`actionsToInspectInfo` 信息面 + 两布尔
- [ ] 2. `src/core/harness/readInvalidation.ts`:`invalidatePageReads` 增可选 `extraTools?: Set<string>`(默认集不动);createChatSdk 装配期收集标记名 → hostNotice 中间件用有效集
- [ ] 3. `src/core/harness/actionGate.ts:310`:页面依据计数改用注入的有效集(经 createAgent 选项或 gate 输入透传,与 2 同源)
- [ ] 4. selftest:有效集合并纯函数 / 标记 action 占位替换 / 未标记零行为差 / 双标记可同用

## Phase 2:事实清单口径(S1-D)

- [ ] 5. 零工具门禁事实清单:统计本轮 `deferredWrite` action 成功调用 → 追加「其中 N 次为提案类调用(待用户确认,尚未生效)」;等效写计数显式排除
- [ ] 6. selftest:谎报完成 → 事实清单注记 → 回灌纠正(纯函数层);无 deferredWrite 调用时清单与现行为逐字节一致

## Phase 3:公共面与文档

- [ ] 7. `types/index.d.ts` + `types/headless.d.ts`:ActionDef 双标记 + `inspect().actions` 信息面字段(纯加法,minor)
- [ ] 8. e2e 新模块 `tests/e2e/action-semantics.mjs`:notifyHostChange 失效标记 action / 页面断言门禁依据含标记 action / inspect 反射 / Stub 一轮闭环;注册进 e2e-integration
- [ ] 9. 文档四语侧:usage-guide §actions 段中英(两标记语义 + 门户案例一句)/ README 中英 actions 行 / CLAUDE.md 短行
- [ ] 10. CHANGELOG(minor)+ 计数同步 + 全量门禁;发布前询问用户
