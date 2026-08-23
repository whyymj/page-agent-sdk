# Tasks: reasoning-tokens-observability

- [ ] normalizeUsage 增 reasoning 提取：`usage_metadata.output_token_details.reasoning` + 原始 `completion_tokens_details.reasoning_tokens` 兜底；有值才携带（同 cache 字段先例，c3 断言模式）
- [ ] `TokenUsage` 增 `reasoningTokens?: number`（types/index.ts + types/index.d.ts + headless.d.ts 三处对齐）
- [ ] 三处合并点透传：usage 事件 cumulative 字面量 + 两条 onUsage 闭包（spawn / 预声明 subagents）；invokeUsage/预算判定不动
- [ ] llm_response 日志 data 增 usage（激活 DebugDrawer 既有用量行死路径）+ reasoning 徽章（占 completion 百分比，无值隐藏）；exportDiagnostics 验证自动携带
- [ ] selftest：提取两态（有/无 reasoning）+ 三处合并透传断言（含子 agent use_<id> 路径）
- [ ] e2e：stub 响应带 completion_tokens_details → `sdk.usage.reasoningTokens` 与 usage 事件反映
- [ ] usage-guide 中/英用量段补 reasoning 说明（含 Anthropic 不可得边界）；CHANGELOG 补条目
- [ ] 门禁：npm test && build && test:e2e && test:browser 全绿；types-alignment/exports 对齐
