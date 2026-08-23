# tool-call-economy Phase 0 离线挖掘报告(2026-08-23)

> 数据源:本地诊断导出 debugLogs(editor 真实会话,`exportDiagnostics` 全量);零新跑 LLM(评审裁决:序列数据已在,重跑才是过度工程)。
> 样本量诚实声明:见下表 —— 样本小,结论按「方向性信号」对待,不作为单独立项依据。

| 文件 | invokes | 工具调用 |
|---|---|---|
| page-agent-diagnostics-2026-08-22T16-45-19-019Z.json | 1 | 14 |
| page-agent-diagnostics-2026-08-22T16-54-05-533Z.json | 2 | 22 |
| **合计** | **3** | **36** |

## 2-gram Top12(全序列邻接)

| 邻接 | 次数 |
|---|---|
| read→read | 4 |
| load_skill→load_skill | 2 |
| load_skill→read | 2 |
| read→list_components | 2 |
| list_components→eval_script | 2 |
| eval_script→read | 2 |
| read→rag_component_docs | 2 |
| rag_component_docs→rag_component_docs | 2 |
| rag_component_docs→read | 2 |
| read→add_component_tree | 2 |
| add_component_tree→list_components | 2 |
| list_components→select_component | 2 |

## 关键指标

- 读→读邻接(探路二连读信号):**4**(11.1%)
- query→读 / search→读 配对(C3 候选依据):**0 / 0**
- root 读占比(无参/整树读):**4/10**(40.0%)
- 同 invoke 同 path 重复 read:**0**
- todos 类轮占比(write_todos/update_todo):**0**(0.0%)
- 失败后续随轮 / 同参原样重试(C2 靶子):**0 / 0**

## 每 invoke 序列

```
page-agent-diagnostics-2026-08-22T16-45-19-019Z.json #1 (9 轮): load_skill → load_skill → read → list_components → eval_script → read → read → read → rag_component_docs → rag_component_docs → read → add_component_tree → list_components → select_component
page-agent-diagnostics-2026-08-22T16-54-05-533Z.json #1 (9 轮): load_skill → load_skill → read → list_components → eval_script → read → read → read → rag_component_docs → rag_component_docs → read → add_component_tree → list_components → select_component
page-agent-diagnostics-2026-08-22T16-54-05-533Z.json #2 (8 轮): load_skill → list_components → request_human_confirmation → delete_component → list_components → delete_component → list_components → list_components
```

## Phase 0 裁决(2026-08-23,按数据)

| 候选 | 数据 | 裁决 |
|---|---|---|
| **C2 错误即向导 + 同参重复检测** | 失败样本 0(但靶子是第一性的:flash-discipline 既有结论「信息缺口走提示随工具结果回流」;deferred 循环/终止面 #1 的 H17 实测在案) | **做**(第一性支持,不等数据) |
| C1 read 结构预告 | 读→读邻接 4(11.1%);同 path 重复读 **0**;root 读 40% 是首查需要(3 invoke 全为「新会话首次侦查」形态) | **转留档**:探路浪费信号不成立,骨架行的 token 反向风险不划算 |
| C3 query 多 expr | query→read / search→read 配对 **0 / 0** | **转留档确证**(立项时预标,数据零支持) |
| 并行轴引导 | 独立读邻接 4 次,量小 | **留档不实施**(maxParallelTools 默认 1 保持) |

样本诚实声明:36 调用 / 3 invoke(editor 两份诊断导出),方向性信号级;editor 序列大量走宿主自定义工具(load_skill/list_components/rag_component_docs),SDK 内置读工具样本更薄。
