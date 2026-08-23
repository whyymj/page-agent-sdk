# Proposal: config-surface-pruning（配置面持续收敛审计）

> 状态：**第一轮已实施（2026-08-24：todoDeps 直删 + 4 项 deprecation warn；后续轮随 3.48 warn 期推进）**。常态治理，非一次性。复审记录：2026-08-23 团队复审（撤「仿 toolMode deprecation 路径」错误先例引用、证据标准升级 ①-⑤、editor 侧使用率改为用户提供信号）。优先级 P3（SDK）。目标仓库：zhuanti-agent。
> 驱动：项目哲学「不出让人疑惑的配置项」+ main-surface-slim 回退教训（data.tools/vfs.mainTools 因决策成本过高被撤）。配置面只增不减会重蹈覆辙；需要周期性审计 + 撤除低价值开关。

## Why（现状核实，复审纠正）

- **先例勘误**：3.31 移除 toolMode/interceptors 与 3.43 撤回 data.tools/vfs.mainTools 均为**直接移除**（CHANGELOG 迁移说明，无 warn 轮）——本仓库配置键级 deprecation 零先例零机制，勿再引为依据。
- capabilities 开关随功能累积，opt-in 默认关的低使用率项是候选撤除面；但包经 npm + esm.sh/CDN IIFE 一等分发，**引入方不可见**——仓库内审计只能证伪「高使用」，永远无法证实「零使用」，证据标准必须升级。
- 同义配置形态会漏计：`verify:{…}` 任一子键即自动开（无需 capabilities.verify）、bulkGuard 有顶层配置组——只 grep capability 键名的审计系统性低估使用率。
- **审计预演结论（复审已做初判表）**：10 个 opt-in 项中高使用 5（domInspect/draftWrite/automation/agentCompression/verify）、**用户已确认外部零使用 4**（2026-08-24：preferences/skillHostScript/tracing/bulkGuard——证据标准④已满足，仍按①②③⑤过筛：文档专节/公开 API 耦合决定走 warn 一版 + 同批废弃说明，不静默直删）、**净候选 todoDeps 1 个**（纯提示段开关、无 README/guide 曝光、行为损失≈一段提示词）。本轮预期产出是「候选 5 项、分档撤除」——属正常结果，防为凑撤除数而放松标准。

## What Changes

1. **审计（仅本仓库信号）**：枚举面以 `types/index.d.ts` capabilities 键全集为准（含注册表外的 bulkGuard 特判项与注册表注释勘误：22 键 / opt-in 9+1），统计 examples + tests（selftest/e2e/browser/runtime）使用与 doc/README/CHANGELOG 曝光，标「高/低/零」；同义配置形态并入统计。
2. **撤除候选证据标准**（全部满足才入清单）：① 仓库内零 examples + 文档无专节（仅 CHANGELOG/archive 提及）；② 无公开 API/导出耦合（inspect 反射 / sdk 方法 / 事件 / 导出符号；有耦合的须同批出废弃说明或转 deferred）；③ 存量项已发布 ≥3 个 minor（留足 warn 期）；新引入 ≤2 个 minor 的可直接移除（仿 3.41→3.43）；④ 已知集成方使用率信号由用户提供并确认不用；⑤ 语义允许时优先「内部化/自动行为」而非删除。
3. **deprecation 分档**：存量/有曝光项走 warn 一版再移除（warn 每挂载去重一次，文案含移除目标版本号 + 迁移指引）；新引入短命项直接移除 + CHANGELOG 迁移说明（既有实践）。
4. **红线**：默认开项不撤；capabilities 键是**行为开关**（非呈现开关），移除即对仍传残键的 JS/CDN 集成方静默断供（残键被 resolveCapabilities 忽略不崩）——破坏性移除须 CHANGELOG Removed + 迁移说明，高曝光项攒 major；每撤一项同步删 selftest/e2e/文档/类型，并核对 inspect 反射/导出面无孤儿。

## 验收门禁

- 每撤一项：build/test/e2e/browser/types-alignment/exports 全绿 + CHANGELOG Removed 条目。
- 审计产出表入库（change 目录内）；外部信号存疑项一律转 deferred.md 带「用户确认」触发条件。
