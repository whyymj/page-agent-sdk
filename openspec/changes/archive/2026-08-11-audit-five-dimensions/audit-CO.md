# audit-CO:配置健壮性(Configuration Robustness)

> 维度 CO:非法/矛盾配置的 fail-fast 缺失、capabilities 组合矛盾、preset 优先级覆盖语义、SubagentConfig / DialogConfig 非法组合。
>
> 种子来源:`openspec/deferred.md`「P3 备查 N3 配置非法值无防御」(本维度种子,本次验证并扩展)。
>
> 审计日期:2026-08-12。只读审计,未改任何 src 代码。

## 审计范围

### 已读基线
- `CLAUDE.md`(capabilities / 预设 / 子agent / release 段)
- `openspec/deferred.md`(N3 种子 + 「目标漂移#5 默认形态」)
- `src/core/sdk/createChatSdk.ts`(全文 2483 行,options 校验/阈值默认/互校验)
- `src/core/sdk/optionsResolver.ts`(resolveStorage / resolveDialogConfig)
- `src/core/sdk/contextPreset.ts`(CONTEXT_PRESETS / resolveContextOptions)
- `src/core/sdk/llmResolver.ts`(resolveLlm / buildSummaryLlmInvoke / temperature 透传)
- `src/core/capabilities.ts`(resolveCapabilities + CAPABILITIES 注册表 + requires)
- `src/core/presets.ts`(pageBuilder / researcher / minimal)
- `src/core/harness/createAgent.ts`(maxToolRounds / maxParallelTools / maxPlanRevisions 主循环)
- `src/core/harness/todos.ts`(maxPlanRevisions)
- `src/core/harness/summarization.ts`(压缩装配)
- `src/core/harness/subagent.ts`(SubagentConfig / configToSubOpts / buildChildTools)
- `src/core/composables/useContextManager.ts`(ContextManagerOptions 阈值)
- `src/core/utils/pool.ts`(runPool limit clamp)
- `src/core/utils/modelCaps.ts`(resolveModelCaps + MIN_CONTEXT_WINDOW)
- `src/core/backends/storage.ts`(createSessionStore backend 分支)
- `src/core/toolsets.ts`(selectBuiltinTools)
- `src/core/sdk/mountChatDialog.ts`(theme 归一化)
- `src/core/components/ChatDialog.vue`(sections 处理)

### 审计口径
- **P0**=常见配置导致崩溃/永挂;**P1**=常见配置导致功能静默失效;**P2**=冷门配置/改进 fail-fast;**P3**=卫生。
- 每条 finding 带 **file:line 证据** + **具体非法配置值** + **触发结果**(崩溃/静默 no-op/错误行为)。
- 不凑数:N3 种子验证 + 自发扩展,共 14 条;另列「排查无问题清单」9 条(CAPABILITIES requires 矩阵、focus/schema 运行时校验、SubagentConfig.id 校验、modelCaps 最小窗口 throw 等已正确实现的部分)。

---

## Findings(按级,带非法配置值 + 触发结果)

### P1-1:maxToolRounds:0 / 负数 → agent 完全不调 LLM,静默返回兜底文案

**证据**:
- `src/core/harness/createAgent.ts:264` —— `maxToolRounds = DEFAULT_MAX_TOOL_ROUNDS`(默认 10),直接解构使用,**无任何 `> 0` / `Number.isInteger` 校验**。
- `src/core/harness/createAgent.ts:645` —— 主循环条件 `while ((rounds < maxToolRounds || pendingFormatRetry) && iterations < maxIterations)`。`rounds` 初始 0,严格 `<` 比较。
- `src/core/harness/createAgent.ts:808` —— while 后兜底文案 `'我已完成本轮能做的操作,但未能综合出最终结论。请基于上方已完成的工具操作结果继续...'`。
- `src/core/sdk/createChatSdk.ts:2126` —— `maxToolRounds: options.maxToolRounds`(透传,无校验)。

**非法配置值**:`maxToolRounds: 0` / `maxToolRounds: -1` / `maxToolRounds: -100`。

**触发结果**:
- `rounds=0, maxToolRounds=0` → `0 < 0` = false;`pendingFormatRetry` 初始 false → **while 循环不进入**。
- LLM 永不被调用(`modelHandler` 在 while 内 666 行)。
- 跳过 wrap-up(末尾非 ToolMessage)→ 直接返回兜底文案。
- 集成方收到固定字符串 `'我已完成本轮能做的操作...'`,无 warn、无 error 事件、无异常。
- `maxIterations = max(0*3, 30) = 30` 不构成保护(while 条件已 false)。

**为何 P1**(非 P0):不崩溃、不永挂(立即返回);但 agent 完全瘫痪(连首轮 LLM 回复都不发),且集成方可能误以为 `0=禁用工具循环让 agent 只文本回复`(合理字面理解),实际连文本回复都没。无任何 fail-fast 提示。

**建议**:`createAgent` / `createChatSdk` 装配期校验 `maxToolRounds` 为正整数,`<= 0` throw 或 warn + clamp 到 1(至少让首轮 LLM 调用发生)。

---

### P1-2:preset 与显式 options 的「对象整体替换」陷阱 —— minimal + capabilities 字段微调静默失效

**证据**:
- `src/core/presets.ts:36-38` —— `minimal.capabilities = { planning: false, skills: false, vfs: false, summarization: false, memory: false, subagent: false }`(对象字段全 false)。
- `src/core/sdk/createChatSdk.ts:888` —— `resolveCapabilities(options.capabilities)`(接收整体对象;JS spread 是**整体替换**而非字段级深合并)。
- CLAUDE.md / presets.ts 注释推荐的用法 `createChatSdk({ ...presets.minimal, container, llm, data })` —— 标准用法无陷阱;陷阱浮现于集成方想微调时。

**非法配置值**:
```ts
createChatSdk({
  ...presets.minimal,                  // 关 planning/skills/vfs/summarization/memory/subagent
  capabilities: { planning: true },    // 想在 minimal 基础上单独开 planning
  container, llm, data,
})
```

**触发结果**(JS spread 语义):
- `minimal.capabilities`(6 字段 false)被整体替换为 `{ planning: true }`。
- `resolveCapabilities` 收到 `{ planning: true }`:planning 开;**其他 5 个字段未传 → opt-out 默认 `!== false` → 全部恢复 true(开)**。
- 集成方意图(minimal 省 token + 单独开 planning)完全落空:skills/vfs/summarization/memory/subagent 全开,token 成本与不开 minimal 相同。
- 无 warn,集成方观察 inspect().middleware 或 token 用量才能发现。

**同型影响**:`researcher.subagent = { maxParallel: 4 }`(`presets.ts:29`)—— `createChatSdk({ ...presets.researcher, subagent: { maxDepth: 2 } })` 会让 maxParallel 字段丢失(回默认 4,恰好相等看不出,但语义踩坑);`pageBuilder.systemPrompt` 单字段无陷阱(字符串覆盖意图明确)。

**为何 P1**:`{ ...preset, X: {...} }` 是 JS 极常见微调模式,集成方按字段级合并直觉配置,实际对象整体替换吞掉 preset 全部字段。minimal 是省 token 入门预设,集成方想"开一项"是合理场景,静默失效后 SDK 行为与不传 preset 一致 —— 等于 preset 白用。

**建议**:二选一 —— ① 文档(CLAUDE.md / README / presets.ts 注释)显式警示「preset 中对象型字段(capabilities/subagent/dialog/vfs)与显式 options 是整体替换,如需字段级微调请把全部字段重写」;② 提供 `mergeCapabilities(preset, override)` 深合并辅助函数。短期最低成本是文档警示。

---

### P2-1:storage 未知 backend 字符串静默退化为 memory(无 warn)

**证据**:
- `src/core/sdk/optionsResolver.ts:11` —— `if (typeof storage === 'string') return createSessionStore({ backend: storage })`(任意字符串透传,无白名单校验)。
- `src/core/backends/storage.ts:360` —— `const backendType = config.backend ?? 'indexed'`。
- `src/core/backends/storage.ts:387-403` —— if/else if 链只识别 `'indexed'`/`'session'`/`'local'`/`'memory'`;**else 分支(行 399-403)默认当 `'memory'` 处理**(`backend = createMemoryBackend()`, `readyResolve(false)`)。
- `src/core/backends/storage.ts:404-410` —— catch 分支才 emit `'degraded'` 事件;else 分支(未知 backend)走的是「正常 memory 模式」路径,**不 emit degraded,集成方无任何提示**。

**非法配置值**:`storage: 'cloud'` / `storage: 'postgres'` / `storage: 'indexedDB'`(大小写错)/ `storage: 'unkown'`(拼写错)。

**触发结果**:静默退化为内存后端(非持久,刷新丢全部对话/数据/技能)。集成方误拼 backend 名,以为开了持久化,实际刷新即丢,无 warn 无 event。`debug:true` 也只在 store.onEvent 拿到 `'degraded'`/`'evicted'`/`'quota'` 时打 log —— 未知 backend 走 else 不发 degraded,debug 也无输出。

**为何 P2**(非 P1):`storage` 字符串值通常是复制文档示例而来,拼写错的概率低于 capabilities 配错;但一旦拼错后果是数据全丢(静默)。

**建议**:`createSessionStore` else 分支加 `console.warn(\`[page-agent-sdk][storage] 未知 backend "${backendType}",有效值:indexed/session/local/memory。已降级 memory(非持久)\`)`。

---

### P2-2:SubagentConfig.allowedTools 含不存在的工具名静默无效(无 warn)

**证据**:
- `src/core/sdk/createChatSdk.ts:1082` —— `const subAllowed = subOpts?.allowedTools ?? []`。
- `src/core/sdk/createChatSdk.ts:1096` —— `allowedTools: subAllowed.length ? subAllowed : undefined`(透传)。
- `src/core/harness/subagent.ts:299` —— `const allow = new Set([...DEFAULT_READONLY_TOOLS, ...(opts.allowedTools ?? [])])`。
- `src/core/harness/subagent.ts:210-219` —— `buildChildTools` 实现:`pool.filter((t) => allow.has(t.name) && !isReservedFrameworkTool(t.name))`,**filter 不到的工具名静默不存在于子池,无 warn**。

**非法配置值**:`subagent: { allowedTools: ['save_data'] }`(集成方笔误,实为 `set_data`)/ `['vfs_write']`(子 agent 默认无 vfs 桥接时)/ `['draft_write']`(未开 capabilities.draftWrite 时)/ 任意拼写错或大小写错。

**触发结果**:子 agent 工具池不含该工具,集成方以为「给子 agent 授了 save_data 写权限」,实际子 agent 仍只读(DEFAULT_READONLY_TOOLS 兜底),写任务失败/降级,无任何 warn。调试需对比 inspect().subagent.allowedTools(显示原样数组)与实际工具池。

**对比已做的 fail-fast**:`SubagentConfig.id` 非法字符有 warn + 跳过(`subagent.ts:698-701`);`id` 重复有 warn + 跳过(`subagent.ts:703-706`)。`allowedTools` 是同维度配置,缺同等 fail-fast。

**为何 P2**:集成方配 allowedTools 是常见自定义场景(给子 agent 授特定工具),拼写错工具名难调试;但子 agent 仍有默认只读工具兜底,不崩。

**建议**:`buildChildTools` 或 `configToSubOpts` 装配期对 `allowedTools` 与主池工具名交集检查,未命中的工具名 warn(`[subagents] allowedTools 含未知工具名 "${name}",主池无此工具,已忽略`)。

---

### P2-3:temperature 非法值无前置校验(API 400 才发现)

**证据**:
- `src/core/harness/createAgent.ts:257` —— `temperature = 0.7`(直接解构,无范围校验)。
- `src/core/harness/createAgent.ts:357` —— 透传 `temperature` 进 ChatOpenAI 构造。
- `src/core/llm/constructLlm.ts:33,60` —— `temperature: opts.temperature ?? cfg.temperature`(纯透传,无校验)。
- `src/core/sdk/llmResolver.ts:57` —— summaryTemperature 默认 0.3;同样无范围校验。

**非法配置值**:`temperature: 5` / `temperature: -1` / `temperature: NaN` / `temperature: 'high'`(类型错)。

**触发结果**:
- 数值超 OpenAI [0, 2] 范围 → 每次 LLM 调用 OpenAI/兼容 API 返回 400 `invalid_value: temperature`,SDK 走重试(maxRetries=2)3 次全失败,emit fatal error 中断。
- `temperature: 'high'` 类型错 → ChatOpenAI 构造时或首次 invoke 抛 TypeError。
- 子 agent `subagent.temperature: 5` 同路径(`subagent.ts:373` 透传)。
- 集成方需要等首次 send 才能看到错误(装配期零提示)。

**为何 P2**(非 P1):集成方一般复制示例 temperature 值(0.3/0.7),非法值不常见;但首次 send 才浮现的错误诊断成本高(集成方可能怀疑 baseUrl/apiKey)。

**建议**:`createChatSdk` / `createAgent` 装配期校验 `typeof temperature === 'number' && Number.isFinite(temperature) && temperature >= 0 && temperature <= 2`,非法 warn + clamp 到 [0, 2]。

---

### P2-4:subagent.maxDepth: 0 / 负数语义混淆(不禁用主→子)

**证据**:
- `src/core/harness/subagent.ts:297` —— `const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH`(默认 1,直接用无校验)。
- `src/core/harness/subagent.ts:321` —— `const childMiddleware = depth + 1 < maxDepth ? [createSubagentMiddleware({ ...opts, depth: depth + 1 })] : []`(只在子 agent 装递归中间件,主 agent 的 spawn 中间件由 createChatSdk 装配,不受 maxDepth 控制)。
- `src/core/sdk/createChatSdk.ts:1102` —— `maxDepth: subOpts?.maxDepth`(透传)。

**非法配置值**:`subagent: { maxDepth: 0 }` / `maxDepth: -1`(集成方可能误以为「0=完全禁用子 agent」)。

**触发结果**:
- `maxDepth: 0` 时,主 agent 仍能调 spawn_agent / spawn_agents(主 agent 的 spawn 中间件已装配);子 agent 内部 `depth+1 < 0` = false,子不装递归中间件。
- 即 `maxDepth: 0` 等价 `maxDepth: 1`(默认),不禁用主→子。
- 集成方若想完全禁用子 agent,应传 `capabilities: { subagent: false }` 或 `subagent: { enabled: false }`(`createChatSdk.ts:1091`)—— 这两个开关才真正拆主 agent 的 spawn 工具。
- 文档(CLAUDE.md / subagent.ts:13 注释)只写「maxDepth 默认 1:主可 spawn,子不可再 spawn」,未澄清「maxDepth: 0 不禁用主→子」。

**为何 P2**:`maxDepth` 字面像「最大允许深度,0=无深度=禁用」,实际是「递归层数,主→子恒可达」。语义混淆但不崩溃。

**建议**:① `maxDepth: 0` / 负数装配期 warn(`maxDepth < 1 不禁用主→子委派;禁用子 agent 用 capabilities.subagent:false 或 subagent.enabled:false`);② 文档显式说明。

---

### P2-5:SubagentConfig.writablePaths: [] 静默忽略(空数组=只读,非「全可写」)

**证据**:
- `src/core/harness/subagent.ts:306` —— `if (opts.writablePaths?.length)`(空数组 `.length === 0` 是 falsy,跳过写工具 path guard 包装)。
- `src/core/harness/subagent.ts:630` —— `...(config.writablePaths?.length ? { writablePaths: config.writablePaths } : {})`(空数组根本不进 opts)。
- `src/core/harness/subagent.ts:222` —— `SUB_WRITE_TOOLS = ['write', 'set_data', 'edit_data', 'delete_data', 'draft_commit']`(默认子 agent 不含这些)。

**非法配置值**:`subagents: [{ id: 'writer', description: '...', writablePaths: [] }]`(集成方可能误以为「空数组=全可写」或「空数组=用默认只读白名单」)。

**触发结果**:
- 空数组 falsy → 跳过 `wrapWithPathGuard` 包装 → 子 agent 工具池不含 SUB_WRITE_TOOLS → **子 agent 完全只读**。
- 集成方若意图「全可写」,应传 `writablePaths: ['']`(空前缀匹配所有路径,因 `isPathWritable` 的 `startsWith(p + '.')` 在 p='' 时退化为 `startsWith('.')`)—— 但这也不是「全可写」(只匹配以 `.` 开头的 path,无意义);实际无从表达「全可写」(设计上强制必须前缀限定,防子 agent 越界)。
- 集成方配 `writablePaths: []` 静默得到只读子 agent,无 warn。

**为何 P2**:空数组是 JS 默认值常见写法(`writablePaths: []` 看似「初始化为空数组,待运行时填充」),实际等价不传;语义不清但不崩溃。

**建议**:`configToSubOpts` 装配期 `writablePaths` 是空数组时 warn(`writablePaths: [] 等价不传(子 agent 只读);如需写权限,指定路径前缀如 ['components']`)。

---

### P2-6:capabilities 矛盾组合的 warn 缺失(verify.check 有 warn,skills/memory/focus 同型无 warn)

**证据**:
- `src/core/sdk/createChatSdk.ts:1075-1077` —— verify 已做 warn:`if (options.verify?.check && !caps.verify) console.warn('[page-agent-sdk][verify] 检测到 verify.check 但 capabilities.verify 未开启,verify 未装载')`。
- `src/core/sdk/createChatSdk.ts:1263-1286` —— `useSkills` 为 false 时 `createSkillsMiddleware` 不装载,**`options.skills` 数组静默丢弃**。
- `src/core/sdk/createChatSdk.ts:1292` —— `useMemory` 为 false 时 memoryMw 不装载(`memoryMw` 仍创建但不进 middlewares),`options.memory` 内容静默无效。
- `src/core/sdk/createChatSdk.ts:1287-1290` —— `useVfs` 为 false 时 vfs 中间件不装载,`options.vfs.initialFiles` 静默丢失。
- 同理 `useCheckpoint` 为 false 时 `options.checkpoint` 静默无效;`useSubagent` 为 false 时 `options.subagent` / `options.subagents` 静默无效;`useFocus` 为 false 时顶层 focuses 配置无效(运行时 setFocus 返回 {ok:false} 算 fail-fast,但初始 augmentSystem 焦点配置无校验)。

**非法配置值**(典型组合):
```ts
createChatSdk({
  capabilities: { skills: false },
  skills: [{ name: 'mySkill', description: '...', getContent: () => '...' }],  // 静默丢弃
  memory: 'AGENTS.md 持久指令',  // capabilities.memory:false 时静默无效
  ...
})
```

**触发结果**:`capabilities.X: false` + 同名 `options.X: {...}` 组合,集成方以为关了能力但保留配置内容供运行时启用,实际配置静默 no-op。verify.check 路径已有 warn(1075-1077),但 skills/memory/vfs/checkpoint/subagent 同型无对等 warn,一致性缺失。

**为何 P2**(非 P1):`capabilities.X: false` + `options.X` 配置不是常见组合(集成方一般明确:要么用要么关);但文档无显式说明「关了 capability 对应 options 字段失效」,集成方误配后调试成本高。

**建议**:对齐 verify.check 的 warn 模式,装配期对 `skills/memory/vfs/checkpoint/subagent` 同型检查(`if (options.X && !caps.X) console.warn(...)`)。

---

### P3-1:maxParallelTools: 0 被 runPool clamp 到 1(语义不清)

**证据**:
- `src/core/sdk/createChatSdk.ts:2130` —— `maxParallelTools: options.maxParallelTools`(透传)。
- `src/core/harness/createAgent.ts:269` —— `maxParallelTools = 1`(默认,无校验)。
- `src/core/utils/pool.ts:16` —— `const lim = Math.max(1, limit)`(0 / 负数 clamp 到 1)。

**非法配置值**:`maxParallelTools: 0` / `maxParallelTools: -1` / `maxParallelTools: 2.5`(非整数)。

**触发结果**:0/负数 → clamp 到 1 = 串行执行(等价默认)。`2.5` → `Math.min(2.5, items.length)` → worker 数 2.5 被 `Array.from` 当 2 处理(实际 2 并发)。fail-safe 但语义不清(集成方可能以为 0=禁用工具执行,实际串行)。

**建议**:装配期 warn `maxParallelTools <= 0` 或非整数,clamp 到 1 并显式提示。

---

### P3-2:dialog.theme 非 light|dark 静默归 'light'(无 warn)

**证据**:
- `src/core/sdk/createChatSdk.ts:352` —— `theme?: 'light' | 'dark'`(TS 类型限制;JS 运行时不校验)。
- `src/core/sdk/mountChatDialog.ts:74` —— `csTheme: dialogCfg.theme === 'dark' ? 'dark' : 'light'`(任意非 'dark' 值归 'light')。

**非法配置值**:`dialog: { theme: 'purple' }` / `theme: 'Dark'`(大小写错)/ `theme: null` / `theme: 'blue'`。

**触发结果**:非 'dark' 一律归 'light',fail-safe。集成方自定义主题应经祖先 `--cs-*` CSS 变量覆盖(CLAUDE.md dialog 段已说明),不应传非法 theme 值。无 warn 但行为可控。

**建议**(可选):装配期 `theme` 非 `undefined` / `'light'` / `'dark'` 时 warn。

---

### P3-3:dialog.sections 含未知 key 静默 no-op

**证据**:
- `src/core/sdk/createChatSdk.ts:354` —— `sections?: Record<string, boolean>`(键:header/focus/body/queued/approval/conflict/footer/debug/skill)。
- `src/core/components/ChatDialog.vue:140` —— `return props.sections?.[k] !== false`(未知 key `!== false` 为 true,默认显示)。

**非法配置值**:`dialog: { sections: { fodter: false } }`(footer 拼错成 fodter)。

**触发结果**:未知 key 无效果(对应区块仍默认显示),无 warn。集成方以为关了某区块,实际仍显示。fail-safe(过度显示,非隐藏关键 UI)。

**建议**(可选):装配期 `sections` key 不在白名单时 warn。

---

### P3-4:subagent.timeoutMs: 负数等价 0 / undefined(无超时)

**证据**:
- `src/core/harness/subagent.ts:413` —— `if (!opts.timeoutMs || opts.timeoutMs <= 0)`(0 / 负数 / NaN / undefined 同走无超时路径)。
- `src/core/sdk/createChatSdk.ts:1116` —— `timeoutMs: subOpts?.timeoutMs`(透传)。

**非法配置值**:`subagent: { timeoutMs: -1000 }` / `timeoutMs: NaN`。

**触发结果**:负数等价 0/undefined = 无超时(子 agent 可无限跑直到 maxToolRounds 耗尽)。fail-safe(不崩溃),但集成方可能以为「负数=立即超时」或「负数=禁用超时检查」,实际语义是后者。文档(CLAUDE.md / subagent.ts 注释)未澄清负数行为。

**建议**:文档显式说明 `timeoutMs <= 0` 等价关闭超时。

---

### P3-5:maxPlanRevisions: 0 / 负数 → write_todos / update_todo 永远触顶(无 warn)

**证据**:
- `src/core/harness/todos.ts:95` —— `const maxPlanRevisions = opts.maxPlanRevisions ?? 5`(直接用,无校验)。
- `src/core/harness/todos.ts:100-105` —— 首次 write_todos 进入 `inPlanning=true, planPhaseRounds=1`;第二轮 `planPhaseRounds > maxPlanRevisions`(1 > 0 = true)→ 永远返回「规划阶段已达上限」。
- `src/core/sdk/createChatSdk.ts:852` —— `createTodosMiddleware([], { maxPlanRevisions: options.maxPlanRevisions })`(透传)。

**非法配置值**:`maxPlanRevisions: 0` / `maxPlanRevisions: -1`。

**触发结果**:首次 write_todos 成功(进入 planning);第二次起永远返回「已达上限(0 轮)」。LLM 看到「停止调研/修订,开始执行」提示后转 execute,不崩。集成方可能以为 0=禁用规划预算检查,实际等于「规划阶段一轮就触顶」。

**为何 P3**:有兜底提示(LLM 收到「已达上限」后转 execute,不挂死);影响仅是 LLM 拿不到规划空间。

**建议**:装配期 `maxPlanRevisions < 1` 时 warn + clamp 到 1。

---

### P3-6:contextPreset 非法字符串静默用空预设(N3 种子验证)

**证据**:
- `src/core/sdk/contextPreset.ts:46` —— `const preset = CONTEXT_PRESETS[options.contextPreset ?? 'auto'] ?? {}`(非法 key 返空对象)。
- `src/core/sdk/contextPreset.ts:9` —— `ContextPreset = 'auto' | 'conservative' | 'aggressive' | 'complex'`(TS 类型限制;JS 运行时不校验)。

**非法配置值**:`contextPreset: 'unknown'` / `'fast'` / `'cheap'` / `'auto '(尾空格)`。

**触发结果**:`CONTEXT_PRESETS['unknown']` 返 undefined → `?? {}` → 空对象 → spread 进 resolvedCtxOpts → 各字段用 `useOpts ?? preset.X ?? 默认` 兜底链。最终等价不传 contextPreset(各字段用 contextManager 默认)。fail-safe(不崩,用保守默认),但集成方误拼 preset 名后,预期档位(如 aggressive 早触发压缩)静默落空,无 warn。

**N3 种子验证结论**:deferred.md 标记的「contextPreset:'unknown'」证实,严重程度 P3(fail-safe 无危害,仅预期落空)。**扩展**:发现 6 个同型 P3(maxPlanRevisions / maxParallelTools / theme / sections / timeoutMs / contextPreset 非法值均 fail-safe 但无 warn)。

**建议**:`resolveContextOptions` 装配期 `options.contextPreset` 不在 CONTEXT_PRESETS key 集合时 warn。

---

## 已修复完整性验证

> 本段对照 `openspec/deferred.md` 的 P3 备查 N3(「配置非法值无防御」,CO 维度种子),验证现状并定级。

| N3 子项 | 现状验证 | 本审计定级 |
|---|---|---|
| `contextPreset: 'unknown'` | `CONTEXT_PRESETS[...] ?? {}` 返空对象,各字段兜底链回默认。fail-safe,无 warn。 | **P3-6**(本审计) |
| `maxToolRounds: -1` | while 不进,agent 瘫痪,返回兜底文案。**严重程度高于 P3 备查** —— 集成方合理字面理解(0/负=禁用循环)致 agent 完全不调 LLM。 | **P1-1**(本审计升级) |
| 扩展:`maxParallelTools: 0` | runPool clamp 到 1,串行。 | P3-1 |
| 扩展:`temperature: 5` | 无前置校验,首次 send API 400。 | P2-3 |
| 扩展:`storage: 'unknown'` | 退化为 memory,无 warn。 | P2-1 |
| 扩展:`subagent.maxDepth: 0` | 不禁主→子,只禁子→孙,语义混淆。 | P2-4 |

**N3 种子已被本审计完整覆盖并扩展**(从 2 子项扩至 14 条 finding)。原 P3 定级中 `maxToolRounds: -1` 经实证升级为 P1(功能静默失效,非单纯卫生)。

---

## 排查无问题清单(9 项 —— fail-fast 已正确实现)

### 1. CAPABILITIES requires 矩阵(强依赖强制关)✓
`src/core/capabilities.ts:52,55,57` —— `draftWrite requires ['dataOps','vfs']`、`skillHostScript requires ['skills']`、`agentCompression requires ['summarization']`。`resolveCapabilities` 二轮强制关(`capabilities.ts:77-83`)。集成方配 `capabilities: { draftWrite: true, vfs: false }` → draftWrite 被强制关,无矛盾运行态。

### 2. CAPABILITIES opt-in/opt-out 默认解析 ✓
`src/core/capabilities.ts:70-85` —— `defaultOn:true`(opt-out,`!== false`)vs `defaultOn:false`(opt-in,`=== true`)。集成方传 `capabilities: { verify: 'yes' }`(非 boolean)→ `=== true` 为 false → verify 关(fail-safe);`capabilities: { dataOps: 0 }` → `0 !== false` 为 true → dataOps 开(可能非集成方意图,但 0 是 falsy 与 false 不同,文档示例都用 false)。语义边界清晰。

### 3. domInspect + dataOps 无依赖关系 ✓
`src/core/toolsets.ts:53-57` —— domTools 独立于 dataOps,`selectBuiltinTools` 各自按 cap 筛选。`domInspect: true` + `dataOps: false` 不矛盾(get_dom 不读写主数据 bind)。

### 4. focus + 无 schema 运行时 fail-fast ✓
`src/core/sdk/createChatSdk.ts:773-798`(`validateFocusInput`)+ `969-982`(set_focus 工具)—— `caps.focus` 关返 `{ok:false, error:'capabilities.focus 关闭'}`;无 schema 返 `{ok:false, error:'当前无主数据 schema'}`;path 不在 schema 返 `{ok:false, error:'path 不在 schema 内'}`。debug 模式各路径 console.warn。

### 5. modelCaps.contextWindow < 200K 装配期 throw ✓
`src/core/sdk/createChatSdk.ts:822-826` + `1762-1764` —— `MIN_CONTEXT_WINDOW = 200000`,主 LLM 装配期 + setLlm 运行时切换双 throw,错误信息含「需 ≥200K 窗口模型,如 GLM-5.2/Claude/Kimi/Qwen-1M/DeepSeek-v4」。子 agent 同型 throw(`subagent.ts:343-347`)。**这是全审计唯一的装配期硬 throw**(其余非法配置无 throw)。

### 6. SubagentConfig.id 非法字符 / 重复 → warn + 跳过 ✓
`src/core/harness/subagent.ts:698-706` —— `TOOL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/` 校验 id 合法工具名;非法 warn + continue;重复 warn + continue。fail-fast 完整。

### 7. options.id 缺失 warn(随机 id 刷新丢数据)✓
`src/core/sdk/createChatSdk.ts:2162-2166` —— `if (!options.id) console.warn('[page-agent-sdk] 未传 options.id,已生成随机 id ... 刷新后持久化数据无法恢复')`。CLAUDE.md memory 也标记此痛点(`config-defaults-minimize-setup.md`)。

### 8. shareContext + 无 id 隐含矛盾由 warn 收口 ✓
`src/core/sdk/createChatSdk.ts:2161-2179` —— 随机 id + shareContext 仍能工作(同随机 id 复用),但 warn 提示集成方传稳定 id。无独立校验但覆盖到。

### 9. setLlm 切 Anthropic 同步 throw(provider 限制)✓
`src/core/sdk/createChatSdk.ts:1746` —— `setLlm` 切 Anthropic provider 抛 `'[page-agent-sdk][setLlm] 切换到 Anthropic 需传 BaseChatModel 实例(动态 import 无法同步)'`,错误信息含修复指令(`await import("@langchain/anthropic")`)。这是配置时序限制的明确 fail-fast。

---

## 结语

CO 维度共 **14 条 finding**:P0×0 / P1×2 / P2×6 / P3×6。

**两条 P1 是本维度的核心改进点**:
- **maxToolRounds: 0 / 负致 agent 瘫痪**(N3 种子的严重程度被实证升级)—— 装配期一行校验即可收口。
- **preset 与 options 的对象整体替换陷阱** —— minimal + capabilities 微调静默失效,需文档警示或深合并辅助函数。

**6 条 P2 是 fail-fast 一致性改进**:storage 未知 backend、allowedTools 错名、temperature 非法、maxDepth:0 语义、writablePaths:[] 语义、capabilities 矛盾组合的 warn 缺失(verify.check 有 warn 而其他同型无)。

**6 条 P3 是卫生**:对象型/数值型配置的边界值(0/负数/非整数/非法字符串)普遍 fail-safe(归一化或退化),但无 warn,集成方调试体验欠佳。

**已正确实现的部分**(排查无问题清单 9 条)集中在:CAPABILITIES requires 矩阵、modelCaps 最小窗口 throw、SubagentConfig.id 校验、focus/schema 运行时校验 —— 这些是配置健壮性的「已建好护栏」,本审计未发现回归。

N3 种子已被完整覆盖并扩展。本维度无需 P0 紧急修复,建议将 2 条 P1 纳入下一批 fail-fast 改进,P2/P3 视优先级排期。
