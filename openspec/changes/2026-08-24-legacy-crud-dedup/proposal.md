# Proposal: legacy-crud-dedup(主池去重旧 CRUD 四件 —— 工具面零配置收敛)

> 状态:**已实施待发版**(2026-08-24 实施完成,四门禁全绿;计划外挖出并修复存量 P1:write(set) 回显净化共享引用误伤 `__pgId` 回填,见 tasks.md 实施备注)。优先级 P2(SDK,从 P3 提前:击穿口依赖被数据推翻)。目标仓库:zhuanti-agent。
> 驱动:主 agent 工具面是恒定上下文税(~2.4K tok/42 工具);其中 4 个旧 CRUD 与 read/write 同职能重复(第一代遗留)。回退保底不变量锁死的是「功能面」——本 change 只合并入口不动功能,零冲突。

## Why(现状核实 + 数据背书)

- **代码自证等价**:`set_data` schema 标注 `@deprecated(改用 write,等价)`;`edit_data` op 词汇 `set/remove/merge/append` ⊆ write patch 词汇(write 还多 `move`),且带 M2 容错互认 write 的 patch 形式;`get_data` ⊂ `read`;`delete_data` ≡ `write({del:true})`。
- **真实使用挖掘(uispec 回归报告,`local/_real-llm-uispec.json`)**:`get_data` **0 次** / `set_data` **0 次** / `edit_data` **0 次** / `delete_data` 4 次(主 agent 删组件,write del 等价)/ `describe_data` 12 次(**全部在 html 子 agent**,与 schema_data 不同义 → 保留)/ 对照 `read` 188 + `write` 20。
- **get_data「击穿口」依赖解除**(原 P3 等 subtree-summary 的理由被推翻):①实测 0 使用;②窄读 string 根天然返全文(`dataOps.ts:640` 非 object 根早退,`read('components.N.code')` 本就全文)→ **现在就能做,无需等三件套**。
- 3.31 回退的是 main-surface-slim 的**配置开关形态**,非瘦身本身;本 change 是零配置恒定去重。

## 场景

- **S1 常规使用**:模型全程 read/write,无感知;选择面从 14 收敛到 10 个数据工具,弱模型误选率下降。
- **S2 残键误调(存量 prompt 写死旧名/弱模型首调)**:调 `set_data` → C2「工具 X 不存在 + 完整可用清单」(3.45.1 机制现成)→ 一轮自纠改 write。uispec 数据:概率 ~1.5%(4/268)。
- **S3 快照与回退**:`restore_data`/`history_data` 非 CRUD 无重复,**零触碰**。
- **S4 子 agent 池**:子池同源装配,同删四件;`describe_data` 保留(子 agent 12 次真实使用,读主数据业务说明)。
- **S5 持久化会话恢复**:历史消息里的旧工具名只是文本,渲染与回放无碍;恢复后新调用走 S2 引导。

## 原理

- **删除面**:createDataOps 四工具(`get_data/set_data/edit_data/delete_data`)+ `markWrite` 标注项 + edit_data 的 M2 patch 补全容错块 + usageHints/guide 中旧套提及(如有)。
- **保留面(零触碰)**:`describe_data`(不同义:业务说明 vs schema_data 约束树)/`schema_data`/`diff_data`/`restore_data`/`history_data`/`query_data`/`search_data`/`eval_script`/focus 四件/`read`/`write`。
- **等价迁移表**(CHANGELOG Removed 附):`get_data({p})` → `read({jsonPath:p})`;`set_data({p,value})` → `write({jsonPath:p,value})`;`edit_data({p,op,value})` → `write({jsonPath:p,patch:{op,value}})`;`delete_data({p})` → `write({jsonPath:p,del:true})`。
- 版本 minor;`write`/`read` 语义零变化(四意图/多路径/摘要不动)。

## 优缺点

- **优点**:−4 工具 schema(~250 tok/轮恒定);数据工具选择面 14→10(弱模型误选与幻觉旧名双降);死代码与 M2 容错块删除;给三件套测试面减负(e2e expected list 同步收敛)。
- **缺点/风险**:存量集成方 prompt 写死旧名 → 首调烧一轮(C2 兜底,概率实测 ~1.5%);极小概率弱模型坚持旧名反复烧轮(门禁族防谎报,失败可见不静默)。
- **不做的**:`describe_data` 并入 schema_data(不同义;未来可评估把 `data.description` 并进 schema_data 根级输出,有回归面另议);任何跨职能合并(query/search/eval、focus 族 —— tool-call-economy 实证 mega-tool 反作用)。

## 红线

- **零配置零开关**(恒定去重,非 main-surface-slim 开关形态)。
- 保留面工具与 `write`/`read` 语义**零变化**;回退保底不变量不受影响(功能全保留,入口合并)。
- 删除即 CHANGELOG Removed + 等价迁移表(集成方一眼改写);残键调用必须落 C2 引导面(不许静默无解释)。

## 验收门禁

- selftest:数据工具清单断言更新(14→10)+ `describe_data` 在清单断言。
- e2e:expected list 更新;stub 调旧名 → C2 引导文案断言(含可用清单);write 四意图 + read 行为零变化回归。
- browser:涉及工具清单的断言排查更新。
- 发版后:uispec `--baseline-diff` 观察 toolCount/轮次无异常(可选)。
