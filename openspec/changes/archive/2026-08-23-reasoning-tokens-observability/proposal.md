# Proposal: reasoning-tokens-observability（默认 deep 的成本可见化）

> 状态：**已实施（2026-08-24）**，随下个 minor 发布。复审记录：2026-08-23 团队复审（Anthropic「双协议提取」降级为不可得、展示落点修正、合并点补全）。优先级 P2（SDK）。目标仓库：zhuanti-agent。
> 驱动：default-deep-thinking 落地后主/子模型默认注入 deep，token/耗时抬高约 2-5×，但 **reasoning 成本在 `sdk.usage` 里被并入 completion_tokens，不可见、不可对账**——集成方无法判断「默认 deep 到底多花了多少」，也无法按场景权衡 simple/deep。

## Why（现状核实）

- `usage` 聚合（sdk-events afterModel + 子 sub-usage 中间件，**共用 `normalizeUsage` 单点收口**）只累加 prompt/completion/total，reasoning 维度丢失。OpenAI 兼容（DeepSeek）经 langchain `usage_metadata.output_token_details.reasoning` 可得（流式聚合保真求和）；**Anthropic 当前依赖栈不可得**（@langchain/anthropic 不映射 thinking 细分，原始 API 的 `output_tokens_details.thinking_tokens` 在流式 message_delta 权威 usage 中被丢弃）——字段省略，不报错不占位。
- 展示层缺口（复审修正）：DebugDrawer per-log 用量行读 `log.data.usage`，而 llm_response 日志 data 不带 usage，是**从未激活的死路径**；「Agent 信息」tab 无用量段；`AgentInfo` 无 usage 字段（usage 真实暴露位是顶层 `sdk.usage`，与累加同对象）。
- 与 default-deep 同 ship 才闭环：**默认给质量，同时把质量的代价透明化**，否则「默认 deep」是笔糊涂账。

## What Changes

1. **usage 结构扩展（只增不改）**：`TokenUsage` 增可选 `reasoningTokens?: number`（有值才携带，条件展开同 cache 字段先例）；提取收敛在 `normalizeUsage` 单点（主/子同源）；同步补**三处合并点**——usage 事件 cumulative 字面量 + 两条 onUsage 回传闭包（spawn / 预声明 subagents）。**invokeUsage（C4 预算累计）与 budget/重试/循环判定不动**。reasoningTokens 是 completion_tokens 的子集，展示为占比不做加数。
2. **提取（单协议可得）**：读 `usage_metadata.output_token_details.reasoning`（langchain 标准，@langchain/openai 双路径映射）；兜底原始形态 `additional_kwargs.usage` / `response_metadata.usage` 的 `completion_tokens_details.reasoning_tokens`。Anthropic 不可得时省略字段（显示层隐藏该行）。
3. **观察层**：`sdk.usage` 自动携带（与累加同对象，**不改 `inspect()`**——AgentInfo 无 usage 字段，不改其形状）；DebugDrawer 激活既有 per-log 用量行死路径（llm_response 日志 data 增 usage）并加「reasoning X tok（占 completion Y%）」徽章（无值隐藏）；exportDiagnostics 经 `{ ...core.usage }` 展开自动带上（验证项非改动项）。
4. **红线**：现有 `usage` 字段形状/命名不动（只加可选字段，sec 旧断言不破）；无 reasoning 细节的模型不报错、隐藏该行；不新增配置开关（自动行为，符合「不出让人疑惑的配置项」）；Anthropic 协议 stub（usage_metadata 无 output_token_details）→ 字段省略、旧三字段行为逐位不变。

## 验收门禁

- selftest：提取两态（有/无 reasoning）+ 三处合并透传断言（含子 agent use_<id> 路径）。
- e2e：stub 响应带 completion_tokens_details → `sdk.usage.reasoningTokens` 与 usage 事件反映。
- 文档：usage-guide 用量段补 reasoning 说明 + Anthropic 不可得边界。
