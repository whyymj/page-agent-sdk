# Tasks: auto-html-agent

- [x] A1 createChatSdk 装配期自动装配(autoHtmlAgent 判定 + declaredSubagents 合成 + info 留痕);无开关(htmlAgent 选项按用户拍板移除)
- [x] A2 既有降级场景改造:② 顶层 code 字段 / ⑥⑧ 开放 schema z.any()(均为推断不出 → 不装配的形态)
- [x] A3 e2e 场景⑩ 四组断言(自动/opt-out/显式优先/无 code 零变化)→ 589
- [x] A4 文档:CLAUDE.md / usage-guide 中英 / README 中英 / CHANGELOG(行为变更提示)

## 阶段 B:配套优化(随 3.9.0 同批)

- [x] B1 presets.pageBuilder 简化:删 subagents getter(自动装配接管),只剩场景化身份 prompt;presets e2e getter 断言删
- [x] B2 storage 默认 'memory':resolveStorage 未传 = 纯内存会话(多会话开箱即用);false 显式关闭;storage e2e 未开启场景补显式 false + 默认行为断言

## 阶段 C:发布

- [x] C1 已随 3.9.0 发布
