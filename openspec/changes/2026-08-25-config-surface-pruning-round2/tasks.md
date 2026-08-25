# Tasks:config-surface-pruning 第二轮(四能力移除)

## Phase 0:移除实施(按能力逐个,可独立提交)

> 2026-08-25 实盘盘点新增(详见 proposal 顶部补全段):任务 0 为 P0 前置,任务 1-4 各含编译级同步项。

- [x] 0. **(P0 前置)`measureWriteScale` 迁出 bulkGuard.ts**(delegateNudge.ts:16/93 依赖,不迁即编译炸):挪 delegateNudge.ts 或独立 util;公共导出(index.ts:66 / headless:74 的 measureWriteScale/WriteScaleResult)随迁保留防二次 breaking
  - ✅ 2026-08-25 实施:本体(WriteScaleResult + measureWriteScale + getByPath 依赖)迁 delegateNudge.ts(唯一存活消费者);bulkGuard.ts 改 import(随任务 1 整删);公共导出双入口重指向;sec-94 import 同步;门禁 selftest 3130 / e2e 1000 / exports 全绿零计数变化
- [x] 1. `bulkGuard`:删中间件 + 细配解析 + `inspect().bulkGuard` 反射 + lastPlanConfirmation 豁免关联点(精确行:createChatSdk.ts:1419 注释 + 1426 传参 + bulkGuard.ts:122-123/166-170;本体五处零触碰)+ componentWriteGuard 装载序行(createChatSdk.ts:1673);e2e 场景与 selftest 断言清理(sec-94 整模块 + authorization-surface 13 条)
  - ✅ 2026-08-25 实施:bulkGuard.ts 整删;createChatSdk 装配块/栈行/reset×2/inspect 反射/capabilities 键全清;capabilities.ts warn 名单 4→3(sec-19/inspect.mjs deprecation 断言同步 4→3,任务 5 再归零);sec-94 **只删 B-G 中间件段**(A 段 measureWriteScale 纯函数断言保留 —— 函数为 delegateNudge 依赖 + 公共导出,-17);authorization-surface bulkGuard 块整删(-13);quality-compare-real-llm 正则清 BULK_CHANGE_REJECTED;d.ts 双件同步(残键静默忽略 = src/d.ts 双侧键全删,todoDeps 同口径)。门禁:selftest 3113 / e2e 987 / browser 118 / tsc / types-alignment / exports 全绿
- [x] 2. `preferences`:删中间件 + **backends/preferenceStore.ts 整文件** + `tests/e2e/preferences.mjs` 整套 + **`tests/e2e-integration.mjs:31/66` 注册行(不删则模块加载报错)** + DebugDrawer topicLabel(351-355)/偏好段(800-808) + messages.ts 7 i18n 键 ×3 处 + usage-guide §6.16 中英整节 + **doc/README.md:9 索引行与目录锚点** + CHANGELOG 存量键清理指引(indexedDB `v:1::pref-store::*`)
  - ✅ 2026-08-25 实施:双文件整删;createChatSdk 装配块/栈行/reset×2/inspect/public API 三件(getPreferences/removePreference/clearPreferences,接口声明两份措辞异已逐一处理)/preload/preferenceStorage 选项全清;capabilities 注册表 21→20(warn 名单 3→2);DebugDrawer 小节 + topicLabel + messages.ts 7 键×3(类型/zh/en)删;e2e-integration 注册行删;usage-guide §6.16 中英整节 + FAQ 更新(存量 indexedDB `v:1::pref-store::*` 清理指引)+ doc/README 索引行 + README 中英能力行;sec-84 整模块删(-55)。**坑:d.ts 段删除按「下一个 section 头」切界,误吞相邻无 section 头的 SkillStore/PersistedSkill 声明,exports 门禁抓回已复原**。门禁:selftest 3058 / e2e 968 / browser 118 / tsc / types-alignment / exports 全绿;CHANGELOG Removed 段随任务 7 批量补
- [x] 3. `skillHostScript`:删 hostScript.ts + skills.ts host 分支(71-72/217-221)+ hostScriptEnabled 管道 + sec-05 host 断言 + usage-guide/README/architecture 小节;**SkillExecSpec.context union 收窄为 'sandbox' + 残值落 sandbox 执行(语义反转 CHANGELOG 明示,可选一行 warn)**
  - ✅ 2026-08-25 实施:hostScript.ts 整删(runHostScript 导出双入口移除);skills.ts host 分支删 + **SkillExecSpec.context 收窄为 'sandbox' + 残值 'host' 落 sandbox 执行**(语义反转,usage-guide/CHANGELOG 明示;未加运行时 warn 保持零噪声);createChatSdk capabilities 键 + hostScriptEnabled 管道删;capabilities 注册表 20→19(opt-in 7→6);sec-05 host 断言改写(正向执行按 sec-21/79 约定 `typeof Worker` 守卫 —— node 无 Worker 只测拒绝/失败路径,净 -10);sec-19 计数/名单同步(1 项 tracing);custom-injection host 场景改残键负向断言;types.test-d union 同步;d.ts 双件(SkillExecSpec/capabilities/runHostScript);文档 usage-guide/README 中英 host 说明改「恒 sandbox + 残值语义反转」。门禁:selftest 3048 / e2e 969 / browser 118 / tsc / types-alignment / exports 全绿(sec-69 计时 flake 负载下偶发,复跑绿,非本次改动)
- [x] 4. `tracing`:删 traceMetrics.ts + createAgent 全部 span 埋点(441-464/814-822/898-1053/1220-1222)+ AgentInfo.trace + SdkEvent trace + **DebugDrawer「上下文」tab 内 trace 段(488-516 + CSS 1010-1023,非独立 tab)与 455 空态 v-if 改写(删 computed 后悬空引用即编译炸)** + sec-42 整模块/sec-19 三条 + `tests/runtime/trace-real-llm.ts` + package.json `test:trace-real` + **maliang-real-llm.ts 改造(审计数据源从 trace.spans 换 debugLogs,否则恒空静默坏)** + usage-guide §6.13 中英 + deferred.md:23/42 历史条目结案
  - ✅ 2026-08-25 实施:traceMetrics.ts 整删;createAgent span 引擎(接口/选项/startSpan/endSpan/compress·round·model·tool 四处埋点/finally emit/state 导出)全清;createChatSdk useTracing/onTrace 接线/inspect().trace 删;SdkEvent trace + AgentInfo.trace 删;DebugDrawer trace 段(模板/computed/CSS/metric i18n 5 键×3)删,空态 v-if 改写为 contextSnap 单条件;sec-42 整模块(-11)/sec-19 计数 19→18 + opt-in 6→5 + tracing 断言改 domInspect;trace-real-llm.ts + package.json script 删;**maliang-real-llm.ts 审计数据源改 debugLogs**(toolNames → tool_call 条目基线切片,轮次 = llm_request 计数);usage-guide §6.13 中英整节 + README 能力行 + deferred.md 追踪条目结案;types.test-d union + trace 事件断言删。门禁:selftest 3033 / e2e 965 / browser 118 / tsc / types / types-alignment / exports / pack 全绿
- [x] 5. warn 机制 + `DEPRECATED_CAPABILITIES` 导出删除;capabilities 残键静默忽略(todoDeps 同口径);**sec-19 计数断言改值(21→18 / opt-in 8→5)+ types.test-d.ts union 同步 + inspect.mjs 4 断言删**
  - ✅ 与任务 4 并做:DEPRECATED_CAPABILITIES 导出 + createChatSdk warn 循环整体删除(名单随四能力清空);sec-19 计数断言 21→18(经 21→20→19→18 逐任务递减)/opt-in 8→5;types.test-d union 同步;inspect.mjs deprecation 场景(4 断言)删 → 换**四键残键负向断言**(装配不 throw 不 warn)
- [x] 6. types 双 d.ts 手动同步(收缩公共面)
  - ✅ 逐任务同步完成(bulkGuard/preferences/skillHostScript/tracing 各自 d.ts 双件随删;残键注释统一「已于 4.1.0 移除;残键静默忽略」);types/types-alignment/exports 三门禁逐任务全绿把关

## Phase 1:文档与计数

- [x] 7. CHANGELOG `[4.1.0]` Removed 段(四能力 + 各自迁移建议)
  - ✅ [Unreleased] Removed 段(四能力 + 各自迁移建议 + 语义反转明示)
- [x] 8. CLAUDE.md(deprecation 段撤除 + capabilities 清单收缩)+ README 中英 + skills/page-agent-sdk-integrate/references/api.md 核查
  - ✅ CLAUDE.md capabilities 行收缩 + deprecation 撤除说明;README 中英能力行/开关行清理;usage-guide 中英四节(§6.13/§6.16/FAQ/exec host)删改;skills/page-agent-sdk-integrate references 核查零命中
- [x] 9. 计数三件套同步(CLAUDE.md / README 中英;预估 selftest ~2925 / e2e ~939 / browser 118 不变)
  - ✅ 逐任务同步(3096→3118→3130→3113→3058→3048→3035→3033;e2e 990→…→965;browser 118 不变);README badge 同步

## Phase 2:门禁与发版

- [x] 10. 四门禁全绿(build / selftest / e2e / browser)+ exports / types / types-alignment / size / pack dry-run
  - ✅ build/selftest 3033/e2e 965/browser 118/tsc/types/types-alignment/exports/size/pack dry-run 全绿
- [x] 11. e2e 残键负向断言(四键装配不 throw 不 warn)
  - ✅ inspect.mjs 四键残键负向断言(tracing/skillHostScript/preferences/bulkGuard 装配不 throw 零 warn)+ custom-injection skillHostScript 残值断言
- [x] 12. grep 净空核查(`src/ types/` 四能力标识符零残留)
  - ✅ grep 净空:src/ types/ 四能力标识符零残留(仅历史注释「已于 4.1.0 移除」标记);skills/ 核查零命中
- [ ] 13. `npm version minor` → 4.1.0 发布(master squash 双远程 + npm publish + CDN 验证)
