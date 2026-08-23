# Proposal: tool-call-economy(单 invoke 工具调用次数收敛 · 缩水版)

> 状态:**规划完成待实施(2026-08-23 三方怀疑论评审回改:必要性裁决缩水 —— Phase 0 改离线挖掘、C2 提前、C3 转留档;回归面红线落进各条目)**。优先级 P2(SDK,排在 evidence-audit-gate 之后)。目标仓库:zhuanti-agent。
> 驱动:用户提问「工具是否有合并或提升空间,减少单次循环调用次数,一次调用完成更多工作」。

## Why(现状核实 + 评审裁决)

「单工具做多事」的大合并已在高位(write patches 原子批 / read jsonPaths 多路径 / spawn_agents 并行),继续合并 = 反模式(mega-tool 伤 flash 工具选择,thinking-taming 实测;main-surface-slim 回退教训)。剩余空间三条正交轴:**信息密度**(减少「需要再调一次」的动机)/ 并行(仅评估)/ 证据(数据裁决)。

**必要性评审缩水裁决**:
- baseline toolCount 2-16、rag ≤2 —— 调用次数本身不是当前痛点,token 大头是 prompt 体积(S1 165K/S5 270K);本 change 一半条目最后会判「不做」,保持这个纪律
- **Phase 0 不新跑真 LLM**:序列数据已躺在既有报告(`_real-llm-*.json` 的 toolLog + `exportDiagnostics` 全量 debugLogs)里;专门为挖数据重跑基线才是过度工程(真 LLM 环境不稳定 + 成本)
- **C2 与 deferred「工具错误回灌无重复检测」(循环/终止面 #1,同参重试烧满 maxToolRounds ~10 轮)是同一病灶两面** —— 报错后瞎猜(C2 治)与报错后死磕(重复检测治),合并设计一套机制避免打架

## What Changes

### Phase 0:离线挖掘(零产品代码,一天)

解析既有 `_real-llm-*.json` 报告 + 诊断导出 JSON 的工具序列 → 2-gram/3-gram 统计(read→read 邻接率 / query→read·search→read 配对率 / root 读占比 / 同 path 重复读 / todos 轮占比 / 失败轮后续随轮)→ 产出 `mining-report.md` 存本 change 目录。Phase 1 各条目按数据标注「做 / 转 deferred」,不猜。

### C2:错误即向导 + 同参重复检测(Phase 1 首项,可先行不等挖掘)

- **错误即向导**:PATH_DENIED/SCHEMA_INVALID/NOT_FOUND 报错附「可用路径片段 / 建议下一步」—— flash-discipline 既有结论「信息缺口走提示随工具结果回流」直接适用,不需要新数据就能判「做」
- **同参重复检测(合并 deferred 循环/终止面 #1)**:同工具同参(或同 path)失败 ≥2 次 → 结果附一行「同参数已失败 N 次,换路径/换方法或向用户说明」,不再让模型原样重试烧轮
- **回归面红线(评审 C-2)**:建议**塞进 toolError 既有 `hint`/`details` 字段,零格式变化**(单行 `ERROR: {json}` 契约不动);建议文案**不得含「未写入/无需删除」字样**(writeGate 活性内容匹配,防写成功误判失败);PATH_DENIED focus ask-user 场景建议项**不得含 `clear_focus`**(sec-54:285 负向断言);建议路径必须从 schema/bind 实时取,不硬编码

### C1:read 结构预告(视挖掘结果)

读容器/数组结果头部附骨架行(子节点计数/元素 type/name 摘要),防探路二连读。**红线(评审 C-1)**:骨架行**严禁出现 `hash=` 字样**(workingMemory 首匹配提取会吃进脏值);骨架必须从**投影后的值**计算(freeze/verbatim 占位符、`<code Nkb>` 摘要之后再取摘要 —— 安全面不是格式面);offload 外存大结果场景(骨架在头部随预览存活)补验收一条。

### 并行轴(仅评估)

`maxParallelTools` 默认保持 1(写互锁)。仅当挖掘显示独立读邻接占比显著:usageHints 增「独立读同轮并行 tool_calls」引导(协议原生,零机制);不显著则留档不实施。

## Impact

| 项 | 变更 |
|---|---|
| `tests/runtime/` 挖掘脚本(本地) | Phase 0 离线解析(不跑真 LLM) |
| `src/core/tools/toolError.ts` + 各报错点 | C2 hint 字段建议行 + 同参重复检测 |
| `src/core/tools/dataOps.ts` | C1 骨架行(若数据支持) |
| usageHints | 并行引导(仅评估) |
| 兼容 | 全部 = 工具结果内容增强,零 API 变化 |

## 验收

1. Phase 0 产出 mining-report.md;条目逐条标注「数据支持/转 deferred」
2. selftest:C2 建议行落 hint 字段断言 + 活性词红线断言(不含「未写入/无需删除」)+ focus 场景不含 clear_focus + 同参 ≥2 次附提醒;C1 骨架行格式 + 不含 `hash=` + 投影后取值
3. e2e:结果内容断言(报错带建议/骨架存在)
4. 真 LLM:`--baseline-diff` 双门禁 —— **toolCount ±3 不回归** + **S1/S5 prompt token 不回归 ±15%**(评审升级:C1 骨架行膨胀结果体积的反向风险,从探针升格为门禁);flash 工具选择准确度不降

## 非目标(Non-goals)

- 不做 mega-tool 合并;不恢复 data.tools/vfs.mainTools 配置面(902d87c)
- 不动 maxParallelTools 默认与写互锁
- **C3 query_data 多 expr 转留档**(必要性裁决:query→read 配对率零数据支持,最可能白做;回归面另发现:若复活必须同步扩 readInvalidation `readReadPaths` 的 expr 通道 + workingMemory 捕获,否则同批复用全废或漏失效)—— 登记 deferred
- 跨 invoke 收敛不在本 change(workingMemory lastHashes 已防跨轮重复读)
- 不动 stale-read 失效面
