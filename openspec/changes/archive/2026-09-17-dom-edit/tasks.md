# Tasks:dom-edit(DOM 编辑工具族)

> 打勾标准:代码/文档落地 + 对应测试绿 + 计数同步。单 commit 收口(改动面集中)。

- [x] 1. `src/core/tools/domEdit.ts`:zod discriminatedUnion patches schema + `validateDomPatches` 纯校验(危险闸:script/iframe 等标签、on* 属性、javascript:/vbscript: URL)+ `createDomEditTools({getDocument?, onEdit?})` 工厂(唯一匹配解析/原子批两阶段/快照标记回放/dryRun/node 守卫/SDK UI 保护)
- [x] 2. `capabilities.ts` 注册 `domEdit`(opt-in,requires domInspect;19→20)+ options.ts/双 d.ts capabilities 联合补 `domEdit?: boolean`
- [x] 3. createChatSdk 装配:domToolsForPool 注入 + usageHints flag + onEdit 留痕 debugLogs(stage:'dom_edit')
- [x] 4. skill 集成:makeDomInspectSkill/makePageAnalysisSkill 增 `withDomEdit` 变体(用法段+写纪律 / 操作类分型);usageHints 增批量编辑行(全随装配态)
- [x] 5. selftest sec-128(Mini DOM 假树含 outerHTML 序列化/解析回环):危险闸矩阵/唯一匹配/原子批/dryRun/快照回滚 roundtrip(文本+class 同根叠加、remove、move 双端)/highlight/SDK UI 保护/快照超限/栈耗尽/requires 归一/skill·hints 变体;sec-19 计数 20/7
- [x] 6. e2e dom-edit.mjs:条件注入三态(默认关/requires 缺失归一关/开则进池+hints 教)/ReAct 全链(dom_edit 落地→dom_restore 回滚,中途 DOM 态经事件时点采样)/script 拒/多匹配拒/零变化;e2e-integration.mjs 注册
- [x] 7. docs-demo:`domEdit:true` + 🖍 高亮表格 quickAction;browser spec +2(高亮真落地 rgb 断言 + restore 终态复原)
- [x] 8. 文档四语侧:usage-guide §6.22 中英(op 表/写纪律/边界四条)/README 中英(特性行+options 行+demo 行)/CLAUDE.md(capabilities 列表/其他能力段/目录/计数)
- [x] 9. CHANGELOG 4.17.0(minor);计数同步 3573/1162/164;openspec change + deferred 登记
- [x] 10. 全量门禁:`build && test && test:e2e && test:browser && test:exports && test:types 族 && test:size && check-test-counts && npm pack --dry-run`;发布前询问用户

> **实施注记(2026-09-17)**:实施中三处测试侧修正留痕 —— ① e2e 假树 `kids.push` 不设 parent → `replaceWith` 静默 no-op 假绿(改 appendChild);② LangChain ToolMessage 不带 name 字段,断言改内容形态/事件钩子;③ ReAct 多轮链的「中途 DOM 态」须事件时点采样(send 返回时 restore 已跑完)。
