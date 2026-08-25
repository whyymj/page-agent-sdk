# Tasks(规划立项,未实施;按依赖序)

## Phase 1:核心机制(LLMConfig 路径)

- [ ] `applyThinkingMode(config: LLMConfig, mode: 'simple'|'deep'): LLMConfig` 纯函数(深拷贝 extraBody,不 mutate 原;simple 剥 `extraBody.thinking` / deep 注入 `{type:'enabled'}`;anthropic 路径同步改 `thinking` 字段)+ selftest(`✓ thinkingMode simple → 剥 extraBody.thinking` / `✓ thinkingMode deep → 注入 thinking` / `✓ 原 config 不被 mutate` / `✓ 冲突:extraBody 已有 thinking + thinkingMode deep → 覆盖` / `✓ anthropic thinking budget_tokens 默认值与上限`)
- [ ] `SubagentConfig.thinkingMode?: 'simple'|'deep'` 字段 + `SubagentOptions.thinkingMode?` 透传字段 + `configToSubOpts` 透传
- [ ] `runSubagent`:LLMConfig 构造分支调 `applyThinkingMode` 改写后构造;BaseChatModel 实例分支 `console.warn` + observable `SUBAGENT_THINKING_MODE_NOOP`(带 subagent id / mode)+ 跳过
- [ ] `LLMConfig.thinking?: { type:'enabled'; budget_tokens:number }` 字段(Anthropic 扩展);`constructLlmFromConfig` anthropic 分支透传到 `new ChatAnthropic({thinking})`;`thinkingMode:'deep'` + provider:'anthropic' 未显式传时注入默认 `budget_tokens = min(maxTokens ?? maxOutputTokens ?? 4096, 8000)`
- [ ] `CreateHtmlSubagentOptions.thinkingMode?` + `createHtmlSubagent` 透传到 `SubagentConfig.thinkingMode`
- [ ] 顶层 `subagent.thinkingMode?` 全局缺省(`ChatSdkOptions.subagent` 增字段;子 agent 显式设优先;装配期注入 `SubagentsMiddlewareOptions.thinkingModeDefault` → `configToSubOpts` 兜底)
- [ ] types/index.d.ts + types/headless.d.ts 同步新字段

## Phase 2:可观测 + 冲突提示

- [ ] `inspect().subagents` 反射每个子 agent `{ id, thinkingMode?, thinkingApplied: 'applied'|'inherited'|'instance-noop' }`(运行后填;实例 no-op 场景标 `instance-noop`)
- [ ] DebugDrawer 子 agent tab 显示思考模式锁定状态(锁图标 + mode + applied 状态;instance-noop 标灰 + tooltip 引导改 SubagentLlmConfig)
- [ ] 装配期冲突 warn:`SubagentLlmConfig.extraBody.thinking` 已存在 + `thinkingMode` 显式设 → `console.warn('[page-agent-sdk][subagent] thinkingMode 与 extraBody.thinking 并存,以 thinkingMode 为准')` + 不阻塞

## Phase 3:测试 + 文档

- [ ] selftest:`applyThinkingMode` 纯函数断言(Phase 1 已列)+ `configToSubOpts` 透传 thinkingMode 断言
- [ ] e2e:stub 子 agent 构造期断言
  - `✓ 主 LLMConfig extraBody.thinking 开 + 子 thinkingMode simple → 子构造的 ChatOpenAI modelKwargs 无 thinking 键`(经 stub 拦截构造参数或 spy)
  - `✓ 主 LLMConfig extraBody.thinking 关 + 子 thinkingMode deep → 子构造的 modelKwargs 有 thinking:{type:'enabled'}`
  - `✓ 主 BaseChatModel 预构造实例 + 子 thinkingMode → warn 触发 + observable 记录 + 子复用同实例(不重新构造)`
  - `✓ 顶层 subagent.thinkingMode 全局缺省 + 子未显式设 → 子继承全局缺省`
  - `✓ anthropic provider + thinkingMode deep → constructLlmFromConfig 传 thinking 字段 + budget_tokens 默认值`
  - `✓ 冲突:子自配 extraBody.thinking + thinkingMode → warn + thinkingMode 胜出`
- [ ] browser:html-page-demo 加 `thinkingMode:'simple'` 配置,DebugDrawer 子 agent tab 显示锁定状态(锁图标 + simple 标签)
- [ ] 文档:usage-guide 中英 subagent 段补 thinkingMode 配置 + 「主深子浅 / 主浅子深」两种典型场景示例 + 实例路径限制说明;README 能力行补思考深度锁定;CLAUDE.md 子 agent 段补一句

## Phase 4(可选,后置)

- [ ] 真 LLM 复测:deepseek 主深思考 + html 子 simple(对比 token 消耗与墙钟,验证子 agent 过度思考治理效果量化);anthropic 主 + 子 deep(budget_tokens 实际生效验证)
- [ ] presets.pageBuilder 评估是否默认带 `thinkingMode:'simple'`(子 agent 代码生成场景的默认倾向;3.4 thinking-taming 实测子 agent 过度思考是已知痛点)
