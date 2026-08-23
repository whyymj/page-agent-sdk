# Tasks: config-surface-pruning

- [ ] 修正审计事实源漂移：capabilities.ts 注册表注释计数（21/8 → 22/9）+ CLAUDE.md opt-in 清单补 tracing/todoDeps
- [ ] 审计 capabilities/选项在本仓库内的使用率信号：examples + tests（selftest/e2e/browser/runtime）+ doc/README/CHANGELOG 曝光，枚举以 types/index.d.ts 键全集为准（含 bulkGuard 特判），verify:{} 等同义形态并入统计，标 高/低/零；**editor 等外部集成方使用率不由本任务核验，由用户提供信号或经用户同意后再补核**
- [ ] 按证据标准 ①-⑤ 判定撤除清单：候选 = todoDeps + preferences/skillHostScript/tracing/bulkGuard（**用户 2026-08-24 已确认外部零使用，④已满足**）；按①②③⑤过筛——有文档专节/公开 API 耦合（preferences 3 方法 / tracing inspect().trace+事件 / bulkGuard approval 门控）的走 warn 一版 + 同批废弃说明，不静默直删
- [ ] 撤除项按分档执行：新引入短命项直接移除 + CHANGELOG 迁移说明；存量项 warn 一版（每挂载去重一次，含移除版本号+迁移指引）再移除
- [ ] 每撤一项：门禁全绿 + CHANGELOG Removed + 同步删 selftest/e2e/文档/类型 + 核对 inspect 反射/导出面无孤儿
