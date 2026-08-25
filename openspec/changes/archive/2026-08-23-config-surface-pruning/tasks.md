# Tasks: config-surface-pruning(第一轮,2026-08-24)

- [x] 修正审计事实源漂移:capabilities.ts 注册表注释计数(撤 todoDeps 后 21 开关恰回真 + bulkGuard 特判项明示)+ CLAUDE.md opt-in 清单补 tracing(原漏)
- [x] 审计 capabilities/选项在本仓库内的使用率信号:examples + tests(selftest/e2e/browser/runtime)+ doc/README/CHANGELOG 曝光,枚举以 types/index.d.ts 键全集为准(含 bulkGuard 特判),verify:{} 等同义形态并入统计,标 高/低/零;**外部信号:维护者 2026-08-24 确认 preferences/skillHostScript/tracing/bulkGuard 零使用**(审计表入库 audit.md)
- [x] 按证据标准 ①-⑤ 判定:todoDeps 直删(净候选);preferences/tracing/skillHostScript/bulkGuard 走 deprecation warn 一版(`DEPRECATED_CAPABILITIES` 常量 + 装配期 warn 含移除版本 3.48.0 + 迁移指引,不静默直删)
- [x] todoDeps 撤除:注册表 + usageHints 类型/教学分支 + Capabilities 联合(主/headless 双 d.ts + createChatSdk 局部)+ tests 传参清理(automation.mjs/sec-19/types.test-d);`write_todos` 层级 round-trip 不受影响(e2e 层级断言保留)
- [x] 每撤一项:门禁全绿 + CHANGELOG Removed + 同步删测试/类型;观察面:DEPRECATED_CAPABILITIES 导出(主+headless+双 d.ts)
- 后续轮(3.48.0):warn 期满无 issue 反馈 → 移除 4 项 + 同批删公开耦合面(preferences 3 方法 / inspect().trace / bulkGuard 配置组)+ 各自文档段
