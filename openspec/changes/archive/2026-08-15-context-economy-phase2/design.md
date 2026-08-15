# Design: context-economy-phase2

## 1. promptSoftCapTokens(成本维度压缩触发)

### 触发公式(单一真源 `shouldTriggerCompression`)

```
token 模式:totalTokens > min(window × summaryThresholdRatio, softCap)   // softCap 仅窗口≥320K 时参与
轮数模式:rounds > summaryThresholdRounds                                // 无窗口信息时不变
```

- `softCap` 解析(`useContextManager` config 解析处):`contextOptions.promptSoftCapTokens` 显式值优先;未传且 `contextWindow ≥ 320_000` → 默认 `160_000`;否则 `Infinity`(不参与)。
- **为何用 min 而非「或」**:ratio 与 softCap 都是上界,取更紧者;避免 softCap 放宽小窗口模型的原行为。
- **为何 320K/160K**:flash/deepseek-v4 档 1M 窗口实测 500K 才首压(S1);160K ≈ 4K 美元级敏感线的量级判断 + 仍留 16× 常规会话余量。写死后经 `_real-llm` 复测校准,非契约值。
- **与压缩安全链的关系**:提前压缩只是把「何时摘 older」提前,preserveLastToolResults(写成功附 path)/ workingMemory(locatedPaths + hash)/ mission pin 三保护不变,丢细节风险与现状同构。
- over-window 复查(H2)与激进 trim 不受影响 —— softCap 只改触发,不改切分(windowRatio 仍管「压多少」)。

### 实现点

| 文件 | 改动 |
|---|---|
| `useContextManager.ts` | config 解析加 `promptSoftCapTokens`(含 320K 窗口默认逻辑);`CompressionTriggerConfig` 类型加可选字段 |
| `contextIndex.ts` | `shouldTriggerCompression` token 分支改 `min(ratio 阈值, softCap)` |
| `contextPreset.ts` | 四 preset 不逐个配(默认逻辑在解析层,preset 保持语义干净);doc 注明 |
| types | `types/index.d.ts` `ContextOptions` 加 `promptSoftCapTokens?: number`(0=关) |

## 2. 工具面瘦身二批

- 目标:advanced 可见工具描述降到 ~150 字符内/条;教程句(用法示例/兜底策略/多模式讲解)迁 `usageHints` 的 `!simple` 分支或删除(usageHints 已有 eval/query/search/draft 教程段,大部分直接删即可,勿双份)。
- **锚定纪律**(一阶段事故教训):工具声明 fn 在前、name 在 description 前,批量替换脚本必须 `s.index('description:', name_pos)` 正向锚定;改完跑 `inspect().tools` 描述长度断言(selftest 补 1 条总长度回归,防再犯)。
- deprecated 组(get_data/set_data/edit_data/delete_data/describe_data)simple 隐藏不占上下文,压缩优先级最低;只删明显冗余句,不做结构性改动(3.x 内不删工具,minor 无 breaking)。

## 3. agent 自感知预算

### C1 消耗提示(轻注入,每轮最多一行)

- 载体:新中间件 `budgetHints`(或并入 usageHints —— **决定:并入 usageHints**,装载序最前、已按 caps 分支,避免新中间件):`augmentPrompt(state)` 读 `state.rounds`/`state.usage`。
- 触发条件(满足其一):
  - 工具轮次 ≥ `maxToolRounds × 0.7`(且每任务只注入一次,防每轮复读刷存在感)
  - 累计 prompt tokens ≥ softCap × 0.5(窗口已知时)
- 文案:「⏳ 预算提示:本任务已用 {X}/{Y} 工具轮,累计约 {Z}K tokens。若已接近目标请收敛并总结;未接近请报告进度与剩余计划,勿默默继续。」—— 给两个出口(收敛 or 汇报),不是单纯催停。
- state 里 usage 可得性核验:createAgent 已累计 usage(automation 消费同一来源);`state` 上若无 rounds/usage 字段则经 augmentPrompt 入参补(minimal 改动:usageHints 收一个 getter 闭包,createChatSdk 装配时传 `() => ({rounds, usage})`,从 AgentCore 取)。

### C2 重复计数提醒

- **写失败计数**:`createAgent` 循环内维护 `writeRetryByPath: Map<path, n>`(工具名 ∈ 写集合 且返回 status error 时 +1,成功清零);达 ≥2 时在**下一轮模型调用的注入段**(与 C1 同载体)或错误回灌文本尾部附加计数提示。**决定:改回灌文本不可行**(错误字符串由各工具构造),走注入段 —— 每轮检查 map,有 ≥2 条目即注入「⚠️ 以下路径已连续写失败 {n} 次:{paths}。先 read 核对实际值/类型,或 restore_data 回退;连续失败常意味着方向错了,考虑换思路而非第 {n+1} 次重试。」
- **计划重写计数**:todos 中间件 `maxPlanRevisions` 回灌文本已存在,补「(第 {N} 版计划)」前缀即可,零结构改动。
- 不引入 LLM 调用,纯确定性注入。

### C3 roundTokenBudget(opt-in)

- `createChatSdk({ roundTokenBudget: number })` → createAgent 选项;每轮模型调用**前**检查本次 invoke 累计 usage(total_tokens)超限 → 抛特定 `BudgetExceededError`(fatal 语义但 message 收口友好:「本轮 token 预算 {N} 已用尽,任务在 {rounds} 轮后中断;已完成部分保留,可继续对话指定下一步」)+ emit observable 事件。
- 与 automation `tokenBudget` 区分:后者跨整个会话累计、需 automation 能力;`roundTokenBudget` 单 invoke、无条件可用(防单轮死循环烧钱)。
- abort 语义:与用户停止一致(保留 partial),走现有 fatal 路径,不发明新通道。

## 4. 测试矩阵(同 commit,强制)

| 项 | 层 | 断言 |
|---|---|---|
| softCap 触发(纯函数) | selftest | `shouldTriggerCompression`:窗口 1M 无 softCap 配 → 160K 默认参与;320K 以下窗口 → 不参与;显式 0 → 关;显式值覆盖默认 |
| 工具描述总长回归 | selftest | inspect 面 advanced 数据工具描述 ≤ 阈值(防锚定事故重演) |
| C1 提示注入 | selftest | rounds 达 70% 时 augmentPrompt 含「预算提示」;未达不含;同任务不重复注入 |
| C2 写失败计数 | selftest | 同路径连续 2 次写错 → 注入段含「连续写失败」;成功后清零 |
| C2 计划版次 | selftest | 超限回灌含「第 N 版计划」 |
| C3 roundTokenBudget | e2e | stub model 驱动多轮,超限中断 + 消息收口;未配不生效 |
| 配置项生效 | e2e | `contextOptions.promptSoftCapTokens` 显式传 → inspect/config 反射可见 |
| 计数同步 | — | CLAUDE.md / README 中英断言数 |

## 5. 风险与回退

- **softCap 提前压缩丢细节**:三保护(preserveLastToolResults/workingMemory/mission)覆盖主路径;`promptSoftCapTokens: 0` 一键回退;真 LLM 复测 S1/S7 验证不伤完成质量。
- **C1 提示干扰弱模型**:一次性注入(每任务一次)+ 短文案;实测若 flash 被提示带偏(提前收口),降级为只在「未产生任何写动作且 rounds≥70%」时注入。
- **描述压缩改错对象**(一阶段事故):正向锚定 + 总长回归断言双保险。
