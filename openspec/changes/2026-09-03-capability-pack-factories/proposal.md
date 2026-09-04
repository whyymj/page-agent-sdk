# Proposal: capability-pack-factories(能力包工厂扩展:table / chart)

> 状态:**📋 大纲规划(2026-09-03 立项,待评审细化;P3 —— 启动条件:首个宿主场景确认)**。目标:把 createHtmlSubagent 验证过的「SubagentConfig 工厂 + 编排自适应注入」模式复制到表格变换与图表配置生成两类场景,每加一厂 = 开一类宿主场景。
> 来源:2026-09-03 功能拓展点咨询收敛(B 档战略项);用户拍板「openspec 大纲规划」。

## 为什么是这两个(选型依据)

| 候选 | 结论 | 依据 |
|---|---|---|
| **table**(多维表格/后台 CRUD 数据变换) | ✅ v1 | dataOps + 乐观锁 + 快照天然契合「批量改值/键映射/类型保持」;宿主面广(表格类产品多) |
| **chart**(ECharts option JSON 生成) | ✅ v1 | 与 html 同为「生成型资产」,但产物是结构化配置非自由 code → schema 校验天然约束,质量门槛低一档 |
| form(表单 schema 生成) | ⏸ 后续 | 同 chart 形态,等场景 |
| sql/dataflow 等重型 | ❌ | 偏离浏览器端定位 |

## T1. createTableSubagent

- **现状基础**:SubagentConfig 已通用(tools/writablePaths/middleware/systemPrompt 全可配);子池默认只读白名单 + writablePaths 写授权面现成;`write({patches})` 原子批量已验证。
- **修法**:`createTableSubagent({ writablePaths, maxToolRounds? = 30, llm? })` —— 工厂内容 = 面向表格操作的系统 prompt(批量 patches 优先/键映射核对/类型保持/删除防误〔复用 reliableWriteRules 既有文案族〕)+ 编排 description;**零新机制**(不带 vfs/checkout-commit,html 的 code-as-data-asset 管线不适用)。
- **适用宿主**:多维表格、后台管理 CRUD、CMS 字段批改 —— 换 schema 即用。

## T2. createChartSubagent

- **修法**:`createChartSubagent({ writablePaths, codeField?='option', llm? })` —— 图表 option(ECharts 口径)生成专家;产物 = 声明在 schema 的 option 字段,走完整 dataOps 写契约(schema 白名单/乐观锁),**无 vfs 副本**。
- **设计决策点 D1(品味注入)**:html 有 design skill(品味),chart 的等价物(图表配色/密度/可读性品味)v1 **不做** —— chart 产物受 schema 约束远强于自由 HTML,品味收益边际低;留 `skills?: SkillSpec` 既有接口给集成方自挂。
- **设计决策点 D2(自动装配)**:html 有「schema 含 code 数组 → 自动装配」;table/chart **不做推断装配**(「数组 of object」暗示表格太宽泛,宁不猜)—— 显式声明才装配,与「不出让用户疑惑的配置项」一致。

## 范围红线

- v1 = prompt + 装配 + demo + 真 LLM 场景验证,**不做新机制**(不加锁形态/不加新中间件/不动 dataOps);SubagentConfig 能力不够时回到评审而不是加接口。
- 组件锁:两工厂的委派默认**不进** componentLock 锁面(与 spawn_agent 同口径,deferred 既有条目 #402 覆盖该盲区);文档明示并发写同一批路径靠乐观锁兜底。

## 不立项项(评估结论留痕)

| 项 | 结论 |
|---|---|
| 图表渲染预览工具 | 宿主域(宿主自己有渲染面) |
| design 同款图表品味 skill | D1,v1 不做 |
| table/chart 推断装配 | D2,显式声明优先,宁不猜 |
| 更多工厂序列 | 等场景驱动,一场景一厂 |

## 启动条件(P3 → 实施的前提)

- table 或 chart 至少一个**确认的 first-user 场景**(editor_fangzhou 表格需求或新集成方);避免无宿主驱动的闭门造车 —— prompt/纪律文案没有真实失败案例打磨等于空转(html 的 craftNotes/thinking-taming 全是实战挖出来的)。

## 验收门禁

- selftest:工厂返回结构(SubagentConfig 形状/默认值/writablePaths 透传);装配不破坏既有编排注入。
- e2e:声明工厂后 `use_table`/`use_chart` 工具出现 + inspect 反射;写授权面(PATH_OUT_OF_SCOPE)断言。
- browser:examples/table-demo、chart-demo 各一(带 schema demo 页)。
- 真 LLM:**必跑**(prompt 质量是本 change 的主体交付物)—— 各工厂 2-3 场景(批量改值含类型保持 / option 生成含 schema 拒错),`--baseline-diff` 不适用(新能力无基线,采首基线)。
- 计数同步 CLAUDE.md + README 中英;types 同步。
