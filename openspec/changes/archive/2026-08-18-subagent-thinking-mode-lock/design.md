# Design: subagent-thinking-mode-lock

## 1. 总体架构(thinkingMode 注入点)

```
SubagentConfig.thinkingMode: 'simple' | 'deep'  (预声明 / createHtmlSubagent)
        │  + 顶层 subagent.thinkingMode (全局缺省)
        ▼
configToSubOpts()  ──透传──►  SubagentOptions.thinkingMode
        │
        ▼
runSubagent()
        │
        ├─ 子 LLM 来源分支 ─────────────────────────────────┐
        │                                                   │
        ├─ A) LLMConfig 路径(继承主 LLMConfig / 子自配 SubagentLlmConfig)
        │     │
        │     ▼ applyThinkingMode(config, thinkingMode)  ← 纯函数(可单测)
        │     │  'simple': delete extraBody.thinking / 不注入 anthropic thinking
        │     │  'deep':   extraBody.thinking = {type:'enabled'} (openai)
        │     │            LLMConfig.thinking = {type:'enabled', budget_tokens} (anthropic)
        │     ▼
        │     constructLlmFromConfig() / 散字段构造  →  子 agent LLM(思考参数已锁定)
        │
        └─ B) BaseChatModel 预构造实例路径
              │
              ▼ console.warn + observable(SUBAGENT_THINKING_MODE_NOOP)
                实例思考配置钉死构造期,运行时不可改;thinkingMode 忽略
                子 agent 复用同实例(零变化)
```

**决策依据**:思考参数的注入点在 LLM 构造期(`new ChatOpenAI({modelKwargs})` / `new ChatAnthropic({thinking})`),运行时不可改。子 agent 当前已有「LLMConfig 散字段构造」与「复用预构造实例」两条路径 —— thinkingMode 只能在前者生效,后者物理不可改。强行锁定 = 在构造前改写 config,而非运行时拦截请求(那需 patch 实例 invocationParams,跨 langchain 版本脆弱,3.19 cache_control 注释已警告 spread 顺序钉死)。

## 2. 关键决策记录

### D1:生效范围 = LLMConfig 构造路径,实例路径 warn 而非 throw

实例路径(`llm: new ChatAnthropic({thinking:{...}})`)的思考字段在构造期固化进 `invocationParams`,运行时无干净 API 改写 —— 强行 patch `invocationKwargs` 跨 langchain 版本脆弱(3.19 cache_control 注释明确警告 spread 顺序钉死 1.5.x)。

选 warn + observable 而非 throw:
- throw 会破坏现有「主传预构造实例 + 子自动复用」的合法集成(主 agent 用预构造实例配思考,子 agent 不设 thinkingMode 时本就继承,零问题)
- thinkingMode 是 opt-in 优化,设了但实例路径不生效 = 集成方配置失误,warn 引导改用 `SubagentLlmConfig` 即可,不应阻塞会话

### D2:OpenAI 兼容用 `extraBody.thinking`,Anthropic 扩展 `LLMConfig.thinking`

- **OpenAI 兼容(deepseek 等)**:已有 `extraBody` 透传链路(3.5 修复子 agent 散字段重构造丢 extraBody),`thinking` 是 body 里的键,增删即可,零新机制
- **Anthropic**:`ChatAnthropic` 的 `thinking` 是构造器顶层字段(非 extraBody),现有 `constructLlmFromConfig` 不接受。扩展 `LLMConfig.thinking?: { type:'enabled'; budget_tokens:number }` 透传到 `new ChatAnthropic({thinking})` —— 与 `cacheControl` 同模式(invocationKwargs 路径已有先例)

**budget_tokens 默认**:`thinkingMode:'deep'` + provider:'anthropic' 未显式传 `thinking` 时,`budget_tokens = min(maxTokens ?? maxOutputTokens ?? 4096, 8000)`(对齐 Claude extended thinking 推荐:足够推演但不挤占输出)。集成方可经 `llm.thinking` 显式覆盖。

### D3:优先级 = 显式 thinkingMode > 继承的 extraBody.thinking

「强行固定」语义核心:设了 thinkingMode 就无视继承来源。

冲突场景与裁决:
| 场景 | 裁决 |
|---|---|
| 主 LLMConfig.extraBody.thinking 开 + 子 thinkingMode:'simple' | 剥 thinking(simple 胜) |
| 主 LLMConfig.extraBody.thinking 关 + 子 thinkingMode:'deep' | 注入 thinking(deep 胜) |
| 子自配 SubagentLlmConfig.extraBody.thinking + 子 thinkingMode | thinkingMode 胜,装配期 warn 提示冲突 |
| 主预构造实例(思考开)+ 子 thinkingMode:'simple' | 实例路径 warn,no-op(思考仍开) |

装配期 warn(第三行)是诚实告知,不阻塞 —— 集成方可能故意先在 extraBody 设思考、再用 thinkingMode 显式锁定,warn 提示「以 thinkingMode 为准」即可。

### D4:纯函数 `applyThinkingMode` 可单测

改写逻辑抽纯函数 `applyThinkingMode(config: LLMConfig, mode: 'simple'|'deep'): LLMConfig`:
- 输入:原始 LLMConfig + mode
- 输出:改写后的 LLMConfig(深拷贝 extraBody,不 mutate 原对象 —— 主 LLMConfig 是共享引用,子 agent 改写不能污染主)
- 纯函数,selftest 可直接断言增删/注入逻辑,不依赖 LLM 构造

## 3. 数据流(以 deepseek 主 + html 子 thinkingMode:'simple' 为例)

```
createChatSdk({
  llm: { apiKey, model:'deepseek-v4', extraBody:{ thinking:{type:'enabled'} } },  // 主深思考
  subagents: [createHtmlSubagent({ thinkingMode:'simple' })],                     // 子锁浅思考
})
  │
  ▼ 装配期 configToSubOpts
SubagentOptions.thinkingMode = 'simple'
  │
  ▼ runSubagent → isChatModel(opts.llm)? 否(LLMConfig)
  │
  ▼ applyThinkingMode(opts.llm, 'simple')
     → 新 LLMConfig: { ...opts.llm, extraBody: { ...opts.llm.extraBody } }  // 深拷贝
     → delete newConfig.extraBody.thinking                                  // 剥思考键
  │
  ▼ 散字段构造 new ChatOpenAI({ ..., extraBody: newConfig.extraBody })  // 无 thinking 键
  │
  ▼ 子 agent LLM 无思考 → ReAct 浅思考快速生成代码
```

主 agent 仍用原 LLMConfig(深思考未动,共享引用安全)。

## 4. 边界与不变量

- **不 mutate 主 LLMConfig**:applyThinkingMode 深拷贝 extraBody(主 config 是共享引用,子改写污染主会破坏主 agent 思考配置)
- **实例路径不构造新实例**:复用主 BaseChatModel 实例时,不尝试 patch / 重新构造 —— 零变化 + warn,集成方自行改 SubagentLlmConfig
- **thinkingMode 未设 = 零回归**:完全走现有继承路径,extraBody 透传链路(3.5 已修)不变
- **Anthropic thinking budget_tokens 有上限**:防挤占输出 token(`min(maxTokens, 8000)`)
- **装配期 warn 留痕**:冲突场景(thinkingMode 与 extraBody.thinking 并存)与实例 no-op 场景都 console.warn + observable,可观测
