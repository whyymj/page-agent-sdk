# Tasks:eval-toolkit(回归工具链产品化)

## Phase 1:判定核抽取 + 导出

- [ ] 1. 〔勘察〕从 _real-llm-lib.mjs 划定「判定核」边界(waitIdle 语义/阈值口径/报告结构)vs Playwright 胶水(D2 留痕)
- [ ] 2. 实施 `createEvalHarness({ sdk })`(waitForIdle 双条件 + collectReport);core 在途流注册表只读反射(activeControllers 消费面)
- [ ] 3. 实施 `diffReport(current, baseline, opts)` 纯函数;报告结构字段标非稳定
- [ ] 4. 导出面:主包 + headless 同带(D1 留痕);types/index.d.ts + types/headless.d.ts 同步
- [ ] 5. selftest:diffReport 三态 × 阈值边界;waitForIdle 状态机(静默窗/子 agent 在场/超时)

## Phase 2:自用迁移(单一真相源)

- [ ] 6. tests/runtime/_real-llm-lib.mjs 判定核改消费导出层,胶水保留;既有套件跑通(含 --baseline-diff/--baseline-update)
- [ ] 7. e2e:双入口导出可达 + stub 会话 collectReport 结构断言

## Phase 3:文档与门禁

- [ ] 8. doc/evaluation.md 中英(或 usage-guide 节):可抄完整示例(以 editor 类宿主为假想读者)+ 升级前跑法 + 坑位知识迁移(重启 dev server/only 过滤)
- [ ] 9. 全量门禁 + CHANGELOG + 计数同步 CLAUDE.md + README 中英
