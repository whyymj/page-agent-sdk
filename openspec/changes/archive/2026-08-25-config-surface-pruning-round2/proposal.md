# Proposal: config-surface-pruning 第二轮(四能力移除,目标 4.1.0)

> 状态:**✅ 已实施并随 4.1.0 发布**(2026-08-25 五路讨论实盘盘点补全;全 13 任务收口)。优先级 P2(SDK 治理)。目标仓库:zhuanti-agent。
> **盘点补全(评审新增,下方「移除面盘点」表之上追加)**:
> - **P0 编译级耦合(原提案漏)**:`delegateNudge.ts:16/93` import `measureWriteScale` from bulkGuard.ts —— 删整个文件不迁移即编译炸;且 delegateNudge(默认装,欠委派 nudge + 分段编排)是存活能力。**measureWriteScale(57-114)必须迁出保留**(挪 delegateNudge.ts 或独立 util),其公共导出(index.ts:66/headless:74)随迁保留防二次 breaking。
> - **静默坏**:`tests/runtime/maliang-real-llm.ts:33-34` 工具链审计靠 `inspect().trace.spans` 收工具名,trace 移除后审计恒空 → 改造(换 debugLogs 数据源)或删(package.json `test:maliang-real` 同步)。skill `exec.context:'host'` 残值:类型 union 收窄为 `'sandbox'`,残值静默落 sandbox 执行(语义从宿主全权反转为沙箱,CHANGELOG 明示,可留一行 warn)。
> - **编译级同步项**:DebugDrawer.vue:455 空态 v-if 引用 traceMetrics/traceSpans(删 computed 须同步改条件)+ 488-516/1010-1023 trace 段(注意:**非独立 tab,已并入「上下文」tab**)+ 351-355 topicLabel + 800-808 偏好段 + messages.ts 7 i18n 键 ×3 处;`tests/e2e-integration.mjs:31/66`(根目录旧 runner 注册行,不删则模块加载报错);selftest.ts 三处 import/调用注册。
> - **计数影响**:selftest 3052 → ~2925(sec-42/84/94 整模块 + sec-05 host 11 条 + sec-19 计数断言 21→18/8→5 + types.test-d.ts union 同步);e2e 978 → ~939(preferences.mjs 19 + inspect 6 + authorization-surface 13 + custom-injection 1);browser 118 不变。
> - **文档面勘误**:usage-guide 无 bulkGuard 专节(仅 FAQ 行,主阵地 CLAUDE.md:107);README 中英无 tracing/bulkGuard 行(preferences 有 :165/:244);doc/README.md:9 索引行点名 §6.16 要摘;deferred.md:23/42 observability-structured-tracing 历史条目随移除结案;lastPlanConfirmation 豁免精确删除行 = createChatSdk.ts:1419 注释 + 1426 传参 + bulkGuard.ts:122-123/166-170(本体五处零触碰);存量偏好存储键(indexedDB `v:1::pref-store::*`)孤儿无害,CHANGELOG 给一句手动清理指引。
> 驱动:3.47.0 发出的 deprecation warn(`tracing`/`skillHostScript`/`preferences`/`bulkGuard`,warn 文案承诺移除目标 4.1.0)已满一个发布周期;维护者确认外部零使用;**唯一已知使用方 editor_fangzhou 的 bulkGuard 配置已于 2026-08-25 摘除**(用户拍板「可以直接移除」),障碍清零。第一轮(config-surface-pruning,todoDeps 直删 + 四项 warn)已随 3.47.0 归档。

## Why(现状核实)

- warn 机制在产线:`createChatSdk.ts` 装配期命中四键 `console.warn`(每挂载一次,含移除目标版本 4.1.0 + 迁移指引);`DEPRECATED_CAPABILITIES` 常量已导出(它本身也在移除面 —— warn 机制随目标一起删)。
- editor_fangzhou 之前是 bulkGuard 唯一已知使用方(有人值守批量散写确认,timeoutMs 2min);2026-08-25 已从 `AiAssistant.vue` 摘除,破坏性操作由 `approval.confirm(delete_component/save_page)` 兜底。
- **semver 口径(项目既定)**:带 deprecation warn 周期的移除随 minor 走(3.47 CHANGELOG 明示「warn 期满后执行」;对比:无 warn 期的 legacy-crud-dedup 四工具走 major 4.0.0)。本 change 目标 4.1.0(minor)。

## 移除面盘点(四能力各自的代码面,实施时逐一核对)

| capability | 代码面 | 测试面 | 文档面 |
|---|---|---|---|
| `tracing` | TraceSpan 采集中间件 + `getTraceMetrics` + `onEvent('trace')` 事件面 + DebugDrawer trace tab(UI) + types 导出 | trace 相关断言 + `test:trace-real`(tests/runtime/trace-real-llm.ts 头less 族) | usage-guide tracing 段 + README |
| `skillHostScript` | SkillSpec.exec `context:'host'` 执行路径 + 装配 gate | 相关断言 | usage-guide skill 段内小节 |
| `preferences` | preferences 中间件(捕获→持久化→pin 注入)+ 存储键 | **e2e 整套 `tests/e2e/preferences.mjs`** | usage-guide §6.16 整节(中英) |
| `bulkGuard` | 中间件 + `bulkGuard:{threshold,timeoutMs,mode}` 细配 + `inspect().bulkGuard` 反射 + `lastPlanConfirmation` 豁免关联点 + componentWriteGuard 装配序注释 | e2e 场景 + selftest 断言 | usage-guide bulkGuard 段 + CLAUDE.md |

公共面共同项:`DEPRECATED_CAPABILITIES` 导出删除、warn 机制删除、`types/index.d.ts` + `types/headless.d.ts` 手动同步、CHANGELOG Removed(含各能力迁移指引一句话)。

## What Changes

- 四能力代码面/测试面/文档面全量移除(上表);capabilities 残键处理对齐 `todoDeps` 先例 —— **静默忽略零报错**(残键不 throw,防旧集成升级即崩)。
- warn 机制与 `DEPRECATED_CAPABILITIES` 一并删除(warn 的使命随移除完成而终结)。
- 测试计数同步(selftest/e2e/browser)+ README 徽章 + CLAUDE.md 计数三处;`test:trace-real` 脚本与 package.json scripts 项移除。
- CHANGELOG `[4.1.0]` Removed 段:四能力 + 各自「如果你在用」替代建议(approval/middleware 自实现 = bulkGuard;宿主自埋点 = tracing;skill 明文 exec = skillHostScript;`memory`/集成方存储 = preferences)。

## 红线

- **残键静默忽略**:四键出现在 capabilities 里不报错不 warn(移除后它们就是未知键,与 todoDeps 同口径)。
- 高使用项(`verify`/`domInspect`/`automation`/`agentCompression`/`draftWrite`)与全部默认开项**零触碰**。
- `lastPlanConfirmation` 本体保留(bulkGuard 只删豁免关联点,方案确认留痕是独立能力)。
- DebugDrawer trace tab 移除不得破坏其余 tab(渲染回归过 browser)。
- 四门禁全绿方可发版;计数同步三件套(CLAUDE.md/README 中英)。

## 验收门禁

- selftest/e2e/browser 全绿(移除相关断言后计数同步);`grep -rn 'bulkGuard\|skillHostScript\|DEPRECATED_CAPABILITIES' src/ types/` 净空(tracing/preferences 同)。
- e2e 新增残键负向断言:`capabilities: { tracing: true, bulkGuard: true }` 装配不 throw 不 warn。
- `npm run test:exports` + `test:types` + `test:types-alignment`(公共面收缩后的对齐)。
- `npm pack --dry-run` 无残留;CHANGELOG/usage-guide 中英/CLAUDE.md/README 中英同步。
