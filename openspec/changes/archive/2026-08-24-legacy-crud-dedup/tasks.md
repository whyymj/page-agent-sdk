# Tasks: legacy-crud-dedup

- [x] 删 createDataOps 四工具(get_data/set_data/edit_data/delete_data)+ markWrite 标注项 + edit_data 的 M2 patch 补全容错块
- [x] usageHints / examples / demo 中旧工具名提及清理(grep 排查;examples/demo/browser 零引用,清了 usageHints×5 + 机制列表 9 处 + 注释/错误文案若干)
- [x] selftest + e2e expected list 14→10 + `describe_data` 保留断言 + browser 断言排查(selftest 2916/0;inspect 清单 10 工具 + 移除断言;browser 104 零改动)
- [x] e2e:stub 调旧名 → C2「不存在+可用清单」引导断言;write 四意图/read 零变化回归(data-slots 新增 C2 场景,debugLogs tool_result 断言;957/0)
- [x] CHANGELOG Removed + 等价迁移表 + usage-guide 中英更新(含 skills 分发包 SKILL.md/api.md,顺手修 toolMode/snapshot_data 陈旧残留)
- [x] 门禁:npm test && build && test:e2e && test:browser 全绿(2916/0 · 957/0 · 104/104)

## 实施备注

- **计划外收获(存量 P1)**:B2 测试从 set_data 移植到 write(set) 时暴露 —— write(set) 整体替换的回显净化 `redactPgInPlace(r.data)` 原地剥 `__pg*`,而 codeAsset 场景 assembly 与 bind 共享引用 → 净化连带抹掉 live bind 上刚回填的 `__pgId`(checkout/commit 断链)。已修(净化只作用于副本,codeAsset 才 deepClone)+ CHANGELOG Fixed + selftest B2 五断言锁。selftest 计数 2938→2916(净减 22 = 移植中删除的死/重复断言:组A 2 + 组B 4 + 组C 8 + 计数/文案调整)。
