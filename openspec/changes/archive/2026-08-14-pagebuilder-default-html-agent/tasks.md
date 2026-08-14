# Tasks: pagebuilder-default-html-agent

> **minor**(pageBuilder 新增默认 subagents + 推断失败语义 throw→降级)。A 实现 → B 测试 → C 文档。

## 阶段 A:实现

- [x] A1 `presets.ts`:pageBuilder 加 `get subagents()`(每次取值新建 createHtmlSubagent(),防共享突变)
- [x] A2 `createChatSdk.ts`:推断失败 throw → warn + dropped 剔除;codeAssetConfigs / subagentsForAssemble / inspect 反射全用 effective 列表
- [x] A3 循环依赖核验:presets ↔ htmlSubagent 双向 hoisted function,getter 延迟调用,selftest 跑通即证

## 阶段 B:测试(同 commit)

- [x] B1 e2e presets:pageBuilder + code schema spread → use_html 存在 + 编排注入;无 data spread → mount 成功无 use_html(降级);两次 spread 取到不同 config 实例(getter 防突变)
- [x] B2 e2e capability-packs 场景⑨-②:throw 断言改降级断言(mount 成功 + 无 use_html)
- [x] B3 计数同步 + 本文件勾选

## 阶段 C:文档

- [x] C1 README 中英:presets 段 pageBuilder 描述补「默认带 HTML 代码 agent(schema 有 code 数组时)」
- [x] C2 doc/usage-guide 中英 + CLAUDE.md:pageBuilder 描述同步;CHANGELOG [Unreleased]

## 阶段 F:发布

- [x] F1 门禁全绿 → bump → 发布(已随 3.7.0 发布)
