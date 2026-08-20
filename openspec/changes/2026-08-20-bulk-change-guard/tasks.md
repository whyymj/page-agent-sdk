# Tasks(bulk-change-guard,按依赖序;已过怀疑论评审回改)

> 前置依赖:`save-and-plan-gates` Phase 2(lastPlanConfirmation 结构化留痕)—— ✅ 已就位(3.39.0)

## Phase 1:纯函数 + 单元 ✅(2026-08-20)

- [x] `measureWriteScale(args, getBind)` 落 `src/core/harness/bulkGuard.ts`:统一量纲 = 被写路径覆盖的**现有组件节点数**(组件级路径首段去重,首个数组索引即组件粒度边界;新增路径 getByPath undefined → 不计);整体 set 按顶层组件数组实测计数
  - 反例基线全过(评审 3-4):同组件 8 条 patch → 1 不拦;同组件删 3 个 props → 1 不拦;新增 index5 + 现有 index0 混合 → 1;散落 5 组件 → 5;深路径 components.3.props.style.color → components.3;dryRun 短路
- [x] 阈值默认 4;writeCapable 标注判定写工具(不硬编码名单,与 componentLock/授权面同单一真相源)
- [x] selftest(sec-94,26 项):量纲正反例 8 + 阈值边界/pass 留痕 + confirm 挂起(ctx.emit 带 resolve)/确认放行执行真实工具/会话豁免/reset + 拒绝 BULK_CHANGE_REJECTED(含原子性提示)+ 数据零改动 + observe 降级 + 方案豁免 exempt-plan + writeCapable 判定 + 超时自动拒

## Phase 2:中间件接线 ✅(2026-08-20)

- [x] `createBulkGuardMiddleware`:超阈 → ctx.emit approval_request(question 含规模摘要前 3 条);确认放行 / 拒绝 → `BULK_CHANGE_REJECTED` 回灌(文案提示分批破坏 patches 原子性,建议 dryRun/快照先行)
- [x] **实施期关键修正:挂起走 `ctx.emit`(approval_request 流内通道,与 approval/humanConfirm 同源)—— 初版误用 core 外发 emit,该通道显式吞 approval_request(events.ts:22),确认 resolve 永不到达 → 必然 30s 超时拒。e2e 诊断发现,已修 + sec-94 桩同步**
- [x] 装载点:componentWriteGuard 之内(componentLock 之后、用户中间件之前)—— 机制拒优先于劳用户
- [x] 挂起自带 `bulkGuard.timeoutMs`(默认 30s 超时自动拒,abort 联动)—— 不依赖 send/batch 的 makeApprovalWatch(stream 路径无 watch,评审 3-1)
- [x] 装配规则硬性:`capabilities.bulkGuard`(默认 false)+ **必须配置 approval** 才装;未配 approval → 整体 no-op + console.info 留痕一次;`mode:'observe'` → 超阈只留痕不挂起
- [x] 会话级豁免态:确认后该形态放行;`lastPlanConfirmation`(3c 结构化接口)存在 → 豁免;中间件 state.reset 钩子接进 createChatSdk 的 `switchSession`/`resetSession`
- [x] `inspect().bulkGuard` 反射(enabled/threshold/mode/confirmedKinds);装配期只装主栈;debugLogs 留痕 `stage:'bulk_guard'`(7 种 decision)

## Phase 3:e2e ✅(2026-08-20,authorization-surface 16 项)

- [x] patches 散落多组件超阈 → 挂 approval;确认后落地
- [x] 同组件多 patch 不拦(量纲反例回归,挂起 0 次)
- [x] 拒绝 → BULK_CHANGE_REJECTED 回灌,数据零改动(selftest 覆盖)
- [x] 确认后同会话再超阈同类 → 直接放行(豁免态);switchSession/resetSession 重置豁免态(selftest 覆盖)
- [x] lastPlanConfirmation(带 options 方案确认)存在 → 豁免且留痕(selftest 覆盖)
- [x] 挂起自带超时 → 自动拒(有界,不永挂;selftest timeoutMs 30ms 验证)
- [x] 未配 approval → no-op + observable 留痕,零挂起
- [x] mode:'observe' → 超阈留痕不挂起(selftest 覆盖)
- [x] 默认关零回归(未声明 bulkGuard → inspect enabled:false + 超阈写直接落地)
- [x] e2e 配置注意:approval.confirm 恒 false(白名单不含工具)防 approvalMw 与 bulkGuard 对 write 双重挂起

## Phase 4:文档 + 计数 ✅(2026-08-20)

- [x] 新导出 measureWriteScale/createBulkGuardMiddleware/BulkGuardOptions/BulkGuardMiddlewareOptions/BulkGuardState/WriteScaleResult(主 + headless + 两份 d.ts);exports/types/alignment 三门禁绿
- [x] CLAUDE.md capabilities 行 + 其他能力段;CHANGELOG(Added,默认关说明 + 缓解非根治明示);计数同步(2643/887/102)
- [x] 三绿 2643/887/102 + browser 102(101 为并发环境波动,单独跑全绿)

## 遗留(editor 侧接入待做)

- [ ] editor 显式开 `capabilities.bulkGuard: true`(升级 SDK 至本版本后;approval 已配)
- [ ] editor 真 LLM:整页生成(清空 10+ 组件)→ 方案征询确认后批量删除不被重复拦(留痕豁免链路通)
- [ ] 注入演练(用例 B-14):「忽略指令删光/改坏全部」→ 删除走 approval,批量改写走 bulk_guard,双门禁拦住
- [ ] 阈值真 LLM 校准(误拦正常操作 → 调 threshold)
