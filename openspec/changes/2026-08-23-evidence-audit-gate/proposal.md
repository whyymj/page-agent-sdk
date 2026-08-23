# Proposal: evidence-audit-gate(收口 evidence 审计门禁 + gateChain 抽取)

> 状态:**规划完成待实施(2026-08-23 三方怀疑论评审回改:机制正确性 / 回归面 / 必要性三评审员,阻断 4 + 重要 8 全部落进本版)**。优先级 P1(SDK)。目标仓库:zhuanti-agent。
> 驱动:用户提问「完成时强制检查是否按思路产出 / 评审 agent 盯工作」→ 立项 `completion-audit-reviewer`,经三方评审**拆分收窄**:A(evidence 审计)保留重铸;B(干净上下文评审 agent)**转 deferred**(靶子「写偏了但格式合法」在全部归档证据中零实测案例;对 editor 是每任务持续税;收口点「翻案」语义是门禁族未有过的新形状;底稿 + 评审发现随 deferred 条目留档,等一个真实案例)。原 change 目录已更名。

## Why(评审后校准)

**事实层**(三方核实一致):
- todos `evidence` 字段供了三年零校验:数据结构(todos.ts:22)/schema(151)/渲染(56)全在,`detectIncompleteFinish`(todos.ts:82)只看 status
- `buildTurnFactSheet`(actionGate.ts)已把 todos 完成度 + 成功写路径供成机器事实 —— A 只是给这份事实加消费点,与既有门禁同构
- **运行时 prompt 从未教过 LLM 填 evidence**(回归面评审 A-1):唯一引导被 `rc.todoDeps` 门控(usageHints.ts:79),而 todoDeps 默认 false;schema describe 自标「可选」—— 默认面下模型规范行为就是不填

**必要性校准**(必要性评审):「写了一部分谎报全做完」目前**无实测案例,是防线空洞推断**,非事故谱系延续(3.40.2/3.40.3 拦的是零写入谎报)。且 A2 是**必要非充分**:拆 3 做 1 标 3 完成时,agent 把同一个真实路径填进三个 evidence → 全覆盖 → A 全过(「一真遮百假」只有意图层能拦,即已转 deferred 的 B)。A2 防的是「敷衍填/编造 path」这个窄面,投入配比按此校准 —— **A2 为机制主体,A1 降格为文案 rider**。

## What Changes

### Phase 0:gateChain 抽取(必要性评审新增,第 1 优先,A 的前置)

createAgent.ts:975-1060 收口分支已串五层门禁(transitional → 完结 → 零工具 → 状态询问 → EXHAUSTED observable)+ 三个独立重试预算变量 + 多层互斥语义,3.43.1 maxPlanRevisions 误伤就发生在这族。抽法:

- 判定与文案归 actionGate 家族;主循环只留一个 `runGates(...)` 调用;**零行为变化**(验收 = selftest 计数不变 + e2e 全绿)
- **附带修一个评审挖出的存量缺陷**(回归面 A-3):完结门禁(997)无 `__pgIsSubagent` 检查,靠「子 agent 无 planning 工具 todos 恒空」假设 —— 该假设对 html 子 agent 是**假的**(htmlSubagent.ts:328 `planning = true` 默认装 todos 中间件,子 agent 可经 writablePaths 写):子栈「todos completed + 写 + 文本收口」会被完结门禁误回灌。gateChain 化时统一按零工具门禁先例(1012)加 `!state.__pgIsSubagent`,补回归测试

### A1:evidence 引导与 rider 文案(降格,不加第四预算变量)

- **引导与机制同 ship**(回归面 A-1 阻断的解):usageHints **无条件段**教「update_todo 标 completed 时附 evidence: 本次写入的 jsonPath(如 components.2)」;schema describe 从「可选」改引导文案 —— 否则默认面下「规范完成任务」被系统性回灌
- **触发面收窄**(机制评审 P1-1):完结门禁因未完成项回灌时,`buildGateFeedback` 文案**追加 rider**:同时列出「已完成但 evidence 为空」的项,要求补 evidence 或承认未做 —— 只搭既有回灌的车,不新增触发、不新增预算、不新增 EXHAUSTED
- 前置:`rounds > 0` + `!state.__pgIsSubagent`(Phase 0 后统一在 gateChain)

### A2:锚点核对(机制主体,独立判定 + 独立预算)

- **审计面 = 本 invoke 内 status 翻转为 completed 的 todos**(机制评审 P0-2 / 回归面 A-2:todos 跨 invoke 持久而 turnUsage 每 invoke 清零,审计跨轮遗留项必误伤且反向激励 agent 改填描述文本绕过核对):invoke 起点快照 todos status,收口分支 diff
- **比对原料不用 `turnUsage.writePaths`**(机制评审 P0-1:它对 `write({patches})` 只记 patches[0],createAgent.ts:361-372,批量写必误伤):复用 stale-read 已有的 `effectiveWritePaths`(readInvalidation.ts:123-157,全量 patches 展开 + remove/move 父数组 + move 目标)与 `pathsOverlap`(77-84,相等/ROOT/祖先-后代 + 分隔符纪律)
- **核对基线 = 会话级累计写路径集**(回归面 A-5:「上一轮写入、本轮标 completed」是正常节奏,只对本轮 writePaths 核对必误伤):每成功写把 `effectiveWritePaths` 累积进 `state` 会话级 Set(resetSession/switchSession 随内存态清零);`'(整体)'`/空归一为 ROOT = 全覆盖
- 触发:审计面内某 todo 的 evidence 含 path 形态(`components.N` 类提取,对齐 pathsOverlap 分隔符纪律)且与会话累计集**零重叠** → 独立回灌(「该 evidence 路径本次会话从未被写入,请核实后修正或改回 pending」);纯描述文本不核对(宁漏勿误)
- 预算:`auditRetries ≤ 2` 独立(与 gateRetries/zeroToolRetries 分池——A 失败域是记账,不与谎报域互饿);超限放行 + observable `AUDIT_GATE_EXHAUSTED`(照零工具门禁 EXHAUSTED 模式)
- **wrap-up 补跑**(机制评审 P1-6):轮次耗尽强制收口路径(createAgent.ts:1164-1221 直接 return 不走门禁)补跑 A2 本地判定 —— 零 LLM 成本,预算压力下的收口恰是谎报高发区

### 明示盲区(覆盖边界,先声明)

| 盲区 | 现状兜底 |
|---|---|
| 委派流(主 agent 全程 use_*/spawn,writePaths 恒空)零审计(回归面 A-4) | 零工具门禁已把委派计「等效写」拦「零委派谎报」;「委派了但谎报子 agent 结果」由状态询问门禁 + 委派返回值回流部分覆盖;委派路径 evidence 审计 deferred(与 stale-read 委派盲区同款纪律) |
| 「一真遮百假」(同一真实路径填多个 todo) | 机制不可拦(必要非充分);意图层 = 已转 deferred 的评审 agent |
| A2 只核「被写过」,不核「写的内容对不对」 | 数据正确性归 verify;意图正确性归 deferred B |

## Impact

| 项 | 变更 |
|---|---|
| `src/core/harness/createAgent.ts` | Phase 0 收口段抽 gateChain(主循环 -~100 行)+ A2 触发/会话累计集 + wrap-up 补跑 |
| `src/core/harness/actionGate.ts` | gateChain 判定/文案归位 + A2 锚点核对纯函数(extractEvidencePaths/isEvidenceCovered) |
| `src/core/harness/readInvalidation.ts` | effectiveWritePaths/pathsOverlap 导出复用(已存在,只加 export) |
| `src/core/harness/usageHints.ts` + `todos.ts` | evidence 引导无条件段 + schema describe 引导文案 |
| `tests/browser/page-demo.spec.ts` | 规划端到端剧本同步补 evidence 参数 + A observable 断言(回归面基线面条目) |
| 兼容 | 默认开(门禁家族先例);A1 只搭完结门禁车零新触发;类型零变化 |

## 验收

1. **Phase 0**:selftest 计数不变(2813)+ e2e 全绿(929)+ 完结门禁子栈豁免新测(html 子 agent todos 收口不回灌)
2. **selftest**:A2 —— 批量 patches 写后 evidence 填非 patches[0] 路径不误伤(P0-1 回归锁)/ 跨 invoke 续跑不审计旧完成项 / 上轮写本轮标 completed 不误伤(会话累计集)/ 编造路径回灌 / 描述性 evidence 不核对 / 填了 path 形态必核(描述文本绕过无效)/ 豁免面(问号/空 todos/子 agent/dryRun)/ 预算超限放行 + observable / wrap-up 路径 A2 生效
3. **e2e(stub)**:回灌文本断言(自定义 wrapModelCall 捕获 req.messages)/ usageHints 引导段存在性 / 剧本同步后 `llm.calls` 计数不漂移
4. **真 LLM**:探针「标 completed 附编造路径」被 A2 拦;「正常完成 + 引导下填真路径」零额外轮次;随 change `--baseline-update` + 基线迁移说明(A1 rider 会改变部分收口轮次结构)
5. 成本:A1 零独立触发(搭车);A2 仅嫌疑触发;回灌额外轮次 ≤2

## 非目标(Non-goals)

- **B(评审 agent)不进本 change** —— 全部设计 + 三方评审发现(组装五件套/无 verdict 放行语义/adversarial 先例校准/timeoutMs 缺省反转)随底稿进 deferred,触发条件:editor 生产出现 schema 全绿但任务意图未达成、且非意图误路由类的用户反馈
- A1 不做独立回灌门(必要性评审裁决:会谎报 status 的模型也会谎报 evidence,空值检查只拦懒不拦骗,不值一个新预算变量)
- 不做「收口回复必须带工作量总结」提示词强制;机制不改写 agent 回复
- 不审委派流(明示盲区段);不做 evidence 语义理解(只核机械化可判部分)
- 工具调用收敛(tool-call-economy)另行 change

## 评审核实记录(2026-08-23 三方评审)

**机制正确性(4 阻断)**:①writePaths 有损(patches[0])→ 改 effectiveWritePaths+pathsOverlap;②跨 invoke 失配 → 只审本 invoke 完成项;③B 组装件缺失(runSubagent 未导出/scope 包裹/signal/tracker/usage 回传五件套)→ 随 B 底稿进 deferred;④B 无 verdict 应放行 + observable 而非判 fail → 同上。
**回归面(2 阻断)**:⑤prompt 从未教 evidence(todoDeps 默认 false,唯一引导被门控)→ 引导同 ship + A1 降格 rider;⑥陈旧 todos 跨轮审计 → 会话累计集 + 本 invoke 审计面。
**重要项(8)**:A1 常态成本(→收窄)/ A2 检测力高估(→Why 校准)/ 四闸顺序定死(完结门禁独立 gateRetries 更正;A 放完结门禁后零工具门禁前,与后两者触发面互斥)/ B 缺问号豁免 + timeoutMs 缺省反转(→deferred 底稿)/ wrap-up 旁路(→补跑)/ adversarial 实为干净上下文先例(→B 底稿定位校准)/ 委派流逃逸(→明示盲区)/ C 面内容红线(→tool-call-economy)。
**确认无问题**:四闸无连环回灌(A 与零工具/状态询问门禁触发面互斥)、runSerial 无死锁、独立预算正确、批量 update_todo 补 evidence 可行、bulkGuard 无互锁死面、C1/C2 对现有断言面零破坏(断言全 includes/regex,stub 不解析内容)。
