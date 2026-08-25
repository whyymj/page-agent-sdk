# Audit: config-surface-pruning 第一轮审计表(2026-08-24)

> 事实源:`types/index.d.ts` Capabilities 键全集 ∪ `src/core/capabilities.ts` 注册表 ∪ createChatSdk 特判项(bulkGuard)。
> 同义形态已并入:`verify:{check|maxAttempts|adversarial}` 任一即自动开(无需 capabilities.verify);`bulkGuard` 顶层配置组。
> 外部信号:**维护者 2026-08-24 确认 preferences/skillHostScript/tracing/bulkGuard 外部集成方零使用**(证据标准④已满足)。

## opt-in 全量初判(10 项)

| 项 | examples | 测试 | 文档曝光 | 公开 API 耦合 | 初判 |
|---|---|---|---|---|---|
| domInspect | complex-demo | e2e inspect + selftest sec-36 + browser | README 特性行 + guide | get_dom 工具族 | **高,保留** |
| draftWrite | complex-demo | tests/runtime/draft-real-llm 专设 + e2e | guide 专节 + README | draft_* 工具族 | **高,保留** |
| automation | 0 | e2e/automation.mjs 专设模块 | README + guide §6.14 | sdk.batch + tokenBudget 等 | **高,保留** |
| agentCompression | 0 | e2e/agent-compression.mjs 专设 | README | (内部中间件) | **中,保留** |
| verify | 0(注释) | e2e inspect 250-280 | README + guide §6.10 | verify 配置组 | **中,保留** |
| preferences | 0 | e2e/preferences.mjs 专设 + selftest sec-84 | README + guide **§6.16 专节** | getPreferences/removePreference/clearPreferences 3 方法 | **warn 一版**(用户确认未用;有专节+方法耦合 → 不静默直删) |
| skillHostScript | 0 | e2e custom-injection 202-230 + selftest sec-05 | README:315(安全语义,非专节) | (skill exec 门控) | **warn 一版**(用户确认未用) |
| tracing | 0 | e2e inspect 163-179 + selftest 多处 | guide **§6.13 专节** | inspect().trace + onEvent('trace') + DebugDrawer | **warn 一版**(用户确认未用;专节+反射耦合) |
| bulkGuard | 0 | e2e authorization-surface + selftest sec-94 | 仅 CHANGELOG:178,184(guide/README 无) | 顶层 bulkGuard 配置组 + inspect().bulkGuard + approval 联动 | **warn 一版**(用户确认未用;注册表外特判项) |
| todoDeps | 0 | e2e automation 1 处(仅配置传参;层级 round-trip **不被它门控**,纯 usageHints 教学段开关) | 仅 doc/archive | 无 | **直删**(净候选:零 examples/零文档/API 零耦合/行为损失≈一段提示词;structured-todos-tier Phase 2 遗留) |

## 本轮处置

- **直删 todoDeps**:注册表 + usageHints 类型/教学分支 + Capabilities 类型注释 + 双 d.ts 键联合 + e2e/selftest 传参清理。`write_todos` 层级字段(parentId/deps/criteria/evidence)与渲染**不受影响**(schema 恒含可选字段,e2e 层纋试断言保留仅去 `todoDeps:true` 传参)。CHANGELOG Removed。
- **deprecation warn ×4**:`DEPRECATED_CAPABILITIES` 常量 + createChatSdk 装配期 warn(每挂载一次,配置里命中 key 才触发,含移除目标版本 3.48.0 + 迁移指引);guide §6.13/§6.16 等对应段加废弃说明行(zh/en 同步)。移除在 warn 期满后的后续版本执行(本轮不动行为)。
- **事实源修正**:capabilities.ts 注册表注释 21/8 → 22/9(本轮删 todoDeps 后 21/8 恰好回真);CLAUDE.md capabilities 段 opt-in 清单补 `tracing`(原漏)。

## 红线核对

- 默认开项零触碰;删除项残键被 resolveCapabilities 静默忽略(不崩);warn 不引导声明任何新配置;高使用 5 项不动。
