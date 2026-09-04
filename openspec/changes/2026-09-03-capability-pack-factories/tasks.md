# Tasks:capability-pack-factories(table / chart)

> P3 —— 启动条件:首个宿主场景确认(见 proposal「启动条件」)。以下为条件满足后的实施序。

## Phase 1:T1 createTableSubagent

- [ ] 1. 系统 prompt 起草:表格操作纪律(批量 patches 优先/键映射核对/类型保持/删除防误),复用 reliableWriteRules 文案族
- [ ] 2. 工厂实现(src/core/sdk/tableSubagent.ts):SubagentConfig 形状 + 默认值 + writablePaths 透传;显式装配(无推断,D2 留痕)
- [ ] 3. selftest + e2e:工具出现/inspect 反射/写授权面断言;examples/table-demo(schema demo 页)
- [ ] 4. 真 LLM:批量改值场景 ×2(含类型保持核验)+ 首基线采集

## Phase 2:T2 createChartSubagent

- [ ] 5. 工厂实现(src/core/sdk/chartSubagent.ts):option 字段生成专家;D1 留痕(无品味注入,skills 接口留给集成方)
- [ ] 6. selftest + e2e 同口径;examples/chart-demo
- [ ] 7. 真 LLM:option 生成场景 ×2(含 schema 拒错自纠)+ 首基线采集

## Phase 3:收尾

- [ ] 8. 导出三件套(主 + headless 判断 + 双 d.ts);usage-guide 中英能力包章节补两厂
- [ ] 9. 全量门禁 + CHANGELOG + 计数同步 CLAUDE.md + README 中英
