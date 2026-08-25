# Proposal: subagent-thinking-mode-lock(子 agent 思考深度锁定)

> ✅ **核心已随 3.36.0 发布**(2026-08-20,经 `output-quality-uplift` 批落地):`applyThinkingMode` 纯函数 + `SubagentConfig.thinkingMode` + `runSubagent` LLMConfig 分支改写 + 实例分支 warn/observable + `LLMConfig.thinking` anthropic 扩展 + `createHtmlSubagent`/顶层 `subagent.thinkingMode` 透传 + `inspect` 反射。见 [`../archive/2026-08-20-output-quality-uplift/`](../archive/2026-08-20-output-quality-uplift/)。**本目录余残项**(未实施):DebugDrawer 思考模式可视化 UI + anthropic constructLlmFromConfig 的 e2e 构造断言。实施时以 archive 已落地部分为准,勿重复。

## Why(用户诉求,2026-08-18)

「子 agent 的思考模式分简单与深入思考,给个配置项强行固定思考深度。」

现状:思考模式由 LLM 的请求体参数驱动 —— OpenAI 兼容协议(deepseek 等)经 `extraBody.thinking = { type: 'enabled' }` 开启深入思考;Anthropic 经 `ChatAnthropic({ thinking: {...} })` 构造期注入。子 agent 的思考配置目前只能经两条路径得到:

1. **继承主 LLM**:主是 `LLMConfig` 时,`extraBody` 经 `runSubagent` 散字段构造透传给子 agent(真 LLM 抓包实测曾丢此字段,3.5 已修);主是预构造 `BaseChatModel` 实例时,子 agent 直接复用同实例 —— 思考配置钉死在主构造期,子 agent 无法独立切换
2. **子 agent 自配 `llm: SubagentLlmConfig`**:可独立设 `extraBody` 覆盖,但需集成方完整重写一份 LLM 配置(apiKey/baseUrl/model 都要重传),只为切思考深度

缺口:**没有一个子 agent 级别的轻量开关,能无视继承的思考配置强行锁定 simple/deep**。典型痛点:
- 主 agent 用 deepseek-v4 + 深思考(`extraBody.thinking` 开)做复杂编排决策,但委派给 html 子 agent 生成代码时希望**关思考省 token / 加速**(子任务规格化后浅思考即够,3.4 thinking-taming 实测:子 agent 过度思考曾循环 10+ 回合致整页超时)
- 反向:主 agent 用 flash 量级浅思考快速对话,但委派给 rag 子 agent 做检索综合时希望**开深思考**提升结论质量

目前两种场景都要集成方手搓 `SubagentLlmConfig` 全量重写,且对 Anthropic 协议(思考字段在构造期)无能为力。

## What Changes

**核心:子 agent 配置加 `thinkingMode?: 'simple' | 'deep'` 开关,装配期/运行时把对应思考参数注入或剥离子 agent 的 LLM 构造,无视继承来源。**

### 1. 配置位

- `SubagentConfig.thinkingMode?: 'simple' | 'deep'`(预声明子 agent / `createHtmlSubagent` 透传)
- `CreateHtmlSubagentOptions.thinkingMode?: 'simple' | 'deep'`(工厂参数,缺省不设 = 继承主)
- `SubagentOptions.thinkingMode?: 'simple' | 'deep'`(内部透传到 `runSubagent`)
- 顶层 `subagent.thinkingMode?`(可选,作所有子 agent 的全局缺省;子 agent 显式设优先)

### 2. 生效路径(按子 agent LLM 来源分支)

| 子 agent LLM 来源 | thinkingMode 生效方式 |
|---|---|
| 继承主 `LLMConfig`(散字段构造) | **有效**:构造前改写 `extraBody`(simple 剥 `thinking` 键 / deep 注入 `thinking:{type:'enabled'}`)+ anthropic 路径改写 `thinking` 字段 |
| 子 agent 自配 `SubagentLlmConfig` | **有效**:同上,改写子 config 的 `extraBody`/`thinking` 后构造 |
| 继承主 `BaseChatModel` 预构造实例 | **无效 + warn**:实例的思考配置钉死在构造期,运行时不可改;`console.warn` 提示「thinkingMode 需子 agent 经 LLMConfig 构造方能生效,当前复用预构造实例,已忽略」+ `observable` 留痕。集成方需 deep 时改用 `SubagentLlmConfig` 自配 |

### 3. 协议覆盖

- **OpenAI 兼容(deepseek 等)**:`extraBody.thinking` 键的增删(已是现有透传路径,零新依赖)
- **Anthropic**:扩展 `constructLlmFromConfig` 接受 `LLMConfig.thinking?: { type: 'enabled'; budget_tokens: number }` 字段(对齐 `ChatAnthropic` 构造参数);`thinkingMode:'deep'` 且 provider:'anthropic' 时注入默认 `budget_tokens`(取 `maxTokens` 的 80%,有上限);`thinkingMode:'simple'` 时确保不注入
- **其他 provider**(经预构造实例):走「无效 + warn」分支

### 4. 优先级与冲突

- 显式 `thinkingMode` > 继承的 `extraBody.thinking` / `thinking` 字段(强行覆盖,这是「锁定」语义的核心)
- `thinkingMode` 未设 = 完全继承现状(零回归)
- 子 agent 自配 `llm.extraBody` 已含 `thinking` + 又设 `thinkingMode`:`thinkingMode` 胜出(装配期 warn 提示冲突,以 thinkingMode 为准)

### 5. 可观测

- `inspect().subagents` 反射每个子 agent 的 `thinkingMode` 与**实际生效状态**(`'applied' | 'inherited' | 'instance-noop'`)
- DebugDrawer 子 agent tab 显示思考模式锁定状态

## Impact

| 项 | 变更 |
|---|---|
| `src/core/harness/subagent.ts` | `SubagentConfig` / `SubagentOptions` 加 `thinkingMode`;`runSubagent` 构造前改写 LLMConfig(OpenAI extraBody / Anthropic thinking);实例路径 warn |
| `src/core/llm/constructLlm.ts` | `constructLlmFromConfig` 接受 `LLMConfig.thinking` 字段(Anthropic 路径注入) |
| `src/core/sdk/createChatSdk.ts` | `LLMConfig.thinking?` 字段;`subagent.thinkingMode?` 全局缺省透传;装配期把 `thinkingMode` 经 `SubagentsMiddlewareOptions` 注入 |
| `src/core/sdk/htmlSubagent.ts` | `CreateHtmlSubagentOptions.thinkingMode?`;透传到 `SubagentConfig` |
| `types/index.d.ts` / `types/headless.d.ts` | 新字段同步 |
| 测试 | selftest(`applyThinkingMode` 纯函数:LLMConfig 改写逻辑)/ e2e(stub 子 agent 构造期断言 extraBody.thinking 增删 + 实例路径 warn)/ 文档 |

## 非目标(Non-goals)

- 不做主 agent 的 thinkingMode(主 agent 直接经 `llm.extraBody` / `ChatAnthropic({thinking})` 配置,无继承问题)
- 不做运行时动态切(`setSubagents` 已支持整体替换,thinkingMode 随之生效;不做单字段热切)
- 不做「按任务复杂度自动选思考深度」(LLM 自决 / 集成方 augmentSystem 注入提示词即可,非框架职责)
- 不引入新 npm 依赖(Anthropic thinking 走现有 `@langchain/anthropic` optional peer)
- 不改主 agent 与子 agent 的思考配置隔离契约(子 agent 仍独立构造 LLM,只是构造参数多一个来源)
