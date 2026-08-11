# Design: audit-sdk-integrity 检查项总表

> 本文件 = 审计执行蓝图。检查项编号稳定(F/R/D/E/C/P/A/T/H + 序号),findings 引用编号定位。
> 基线版本 2.38.0;关键文件行数快照:createChatSdk.ts 2357 / dataOps.ts 1109 / createAgent.ts 858 / DebugDrawer.vue 773 / subagent.ts 656 / resources.ts 414 / useContextManager.ts 268 / focus.ts 163 / summarization.ts 84。

## 0. 严重度与类别定义(与 2026-08-07 审计对齐)

| 级 | 定义 |
|---|---|
| P0 | 已确认的功能破坏 / 安全问题 / 数据损坏,需立即修 |
| P1 | 有明确触发条件的缺陷或违背文档承诺,下个发布内修 |
| P2 | 潜在风险 / 设计异味 / 性能隐忧,记录 deferred 按需重启 |
| P3 | 文档 / 测试 / 流程卫生问题 |

类别:`correctness`(正确性)/ `flow-divergence`(流程偏离预想)/ `goal-drift`(目标漂移)/ `performance` / `security` / `maintainability` / `test-blindspot` / `doc-drift` / `process-hygiene` / `hang`(卡住不终止)/ `crosstalk`(主×子串台)/ `loop`(死循环·失控)

**每条 finding 输出格式**:`编号 | 严重度 | 类别 | 文件:行 | 一句话结论 | 证据(代码摘录或复现路径) | 修复建议 | 测试补建议`

---

## 1. 主流程走查 F1-F11(流程是否按预想走)

每条:入口 → 关键检查点 → 疑点。走查方式 = 逐行读码 + 绘制实际调用序列与设计意图比对。

### F1 ReAct 主循环(`harness/createAgent.ts` + `middleware.ts` + `state.ts` + `errors.ts`)
- 入口:`core.agent.invoke/stream` ← `send`/`stream`(非流式走 invoke 无流式事件 —— 验证该承诺)
- 检查点:① 中间件执行序(before 正序/after 逆序/wrap 洋葱)实际代码与契约一致;② `replaceSystem` 只替首部 system、保留摘要(P0-1 修复语义不回归);③ 轮数预算 `maxIterations`/`maxToolRounds` 触顶行为(截断提示 vs 静默);④ abort:signal 穿透 `llm.stream` + partial 保留 + **先排除 abort 再判 status**;⑤ 错误 severity 三路由(recoverable 回灌/fatal emit+中断/observable 记录)在内置 catch 点的硬编码是否正确;⑥ `isContextLengthError` 双 catch → 激进 trim → 单次重试(`_ctxRetry` 防死循环)→ 仍超抛
- 疑点:wrap 洋葱中某层抛错时,已执行的 before 类副作用是否回滚/泄漏;fatal emit 之后 after 类是否还会跑;retry 与 abort 竞态(重试等待中 abort)

### F2 数据写链(`tools/dataOps.ts` + `schemaUtils.ts` + `jsonUtils.ts` + `resources.ts`)
- 链路:`read`(返 hash)→ `write` 四意图(set/patch/patches/del)→ 校验链顺序:**enforce 保护 → schema safeParse → 白名单逐段 → merge 语义 → interceptor.write → commitSetToBind(快照+审计+onWrite 标脏)→ bind 就地写**
- 检查点:① 校验链顺序在 4 条写路径(write 四意图 / set_data / draft_commit / eval transform)一致(共用 commitSetToBind 单一真相源是否属实);② dryRun 真不落盘(不快照/不标脏/不写 bind,但锁检测照常);③ patches 原子回滚无半成品残留;④ schema 投影:整体读 + 子路径递归投影 + 未声明字段 merge 保留 + interceptor 补充不可见字段写回;⑤ zod4 adapter(`readCheckDefs`)结构探测失败的兜底路径
- 疑点:jsonPath 边界(负索引/非数字索引/超深/空段);`PATH_DENIED` 与 discriminatedUnion 降级开放的叠加语义(见 H13)

### F3 乐观锁冲突闭环(`sdk/conflictManager.ts` + createChatSdk 冲突段)
- 链路:`expectedHash`/autoLock 不匹配 → 工具挂起 → `pendingConflict`(ref)→ UI ConflictBar 或 headless watch → `resolveConflict('keep_external'|'overwrite'|'restore')` → 工具继续
- 检查点:① 挂起期间 abort/switchSession/unmount 是否泄漏悬挂 Promise(永不 resolve = 子 agent 卡死?);② shareContext 双实例同时写 → 冲突串行处理语义;③ draft_commit 跨多轮累积后冲突链;④ `onConflict` 自定义与内置人工介入的优先级;⑤ 不传 expectedHash 向后兼容直写
- 疑点:resolveConflict 在冲突已超时/已被 abort 后调用的行为

### F4 上下文压缩链(`useContextManager` / `summarization.ts` / `contextPreset.ts` / `compressDecision.ts` / `contextIndex.ts` / `vfsGc.ts` / `offload.ts`)
- 链路 A(summarization):`shouldTriggerCompression` gate → (agentCompression? decide 两段式工具循环 : 直跳)→ compress 切分 → preserve(配置∪preserveTools)→ recall(关键词 + steps.result)→ 摘要 SystemMessage 注入
- 链路 B(trim):`trimMemoryMessages` OOM 裁剪 → `context_trimmed` 事件(dropped 原文 + vfsResults)→ `extractVfsRefs` 可达性 GC
- 检查点:① **decide 是否阻塞当轮首响应**(compressInput 在模型调用前同步跑,decisionTimeoutMs 6s 叠加 —— 见 H12);② decide 失败降级静态压缩路径完整;③ preserve 只增不减语义下 token 膨胀;④ 双摘要协同:trim 先于 summary 时累积摘要并入【更早累积摘要】段不丢;⑤ GC 误删:pin 段引用的 vfs 路径不在 messages 里 → 可达性扫描会不会删掉仍被 pin 引用的资源(资源在 resources 池,large_results GC 是否碰 resources 池);⑥ `setProtectedRefs` 注入时机(stream 入口)与 LRU 跳过逻辑;⑦ 窗口 <200K 硬约束在 setLlm/子 agent 解析后三处都 throw
- 疑点:token 模式 windowRatio 换算的累加循环边界;轮数模式 keepRounds=0/1 边界

### F5 会话持久化闭环(`backends/storage.ts` + persistRuntime/applySnapshot + switchSession/resetSession)
- 检查点:① 每轮 persist(afterRound)+ switchSession 切走前补 persist + clear(resetSession)三路径状态一致(messages/vfs/todos/mission/workingMemory/focus/checkpoint);② hydrate 恢复逐项校验(focus 逐 path 剔除失效而非整体丢;旧版单个 focus 归一化);③ 后端不可用降级内存 + 配额 LRU 淘汰静默性;④ **headless 直接调 switchSession 时进行中 stream 是否 abort**(P1-b 修复只在 ChatDialog 层 useChat.reset —— 见 H6);⑤ shareContext 复用 AgentCore 时 persist 竞态(两实例同轮写)
- 疑点:storage 开但 indexedDB 异步慢时,快速 switchSession A→B→A 的快照交错

### F6 子 agent 委派链(`harness/subagent.ts` + `sdk/ragSubagent.ts` + `sdk/htmlSubagent.ts`)
- 链路:spawn_agent/spawn_agents/use_<id> → wrapToolCall 捕获 → runSubagent(只读子集 + maxDepth 切断)→ forward 事件 + tracker 旁路 → 结果回灌主上下文
- 检查点:① 并行 spawn 一个失败时其余结果是否保留(runPool 错误传播语义);② 只读白名单 + `allowedTools` 追加后**写工具真能进子 agent**(rag 只读承诺 vs html 的 vfs_write)边界清晰;③ observeId 唯一 vs 事件 taskId 稳定(2.38 语义不回归);④ configToSubOpts 透传 tracker/middleware/summarization 完整;⑤ maxDepth 切断在预声明子 agent 链同样生效;⑥ 子 agent focus 继承(主聚焦→继承全部焦点;未聚焦→无 focus 中间件)
- 疑点:子 agent 内 compressInput 与主 agent pin 段的关系;htmlSubagent writablePaths guard 对 patches 嵌套的覆盖(同 permissions extractScopes 兼容?)

### F7 Focus 三层收敛(`harness/focus.ts` + schemaUtils getSchemaAtPath)
- 检查点:① setFocus/addFocus 校验(类型命中而非数据存在);② augmentPrompt 目标段 + 子树 schema 视野段;③ wrapToolCall 写拦截:jsonPath 不在**任一**焦点子树 → PATH_DENIED;④ 前缀边界 `components.10` ≠ `components.1`;⑤ 持久化恢复逐 path 校验;⑥ **discriminatedUnion 降级开放(getSchemaAtPath 返 null)时焦点校验的判定**(合法?非法?见 H13)
- 疑点:多焦点 + patches 批量(每个 patch 各自判子树?);removeFocus 后当轮已注入的视野段残留(cosmetic)

### F8 受保护资源(`tools/resources.ts` + `resourcesPin.ts` + enforce)
- 检查点:① enforce 三调用点(commitSetToBind / applyPatchesToBind / eval 整体替换)对 **2.17+ eval 子树模式(jsonPath 子树 set)** 的覆盖(见 H4);② freeze 无 vfs 也工作 / verbatim 无 vfs 降级的写边界仍安全;③ D1 池值自愈触发点完整性(restore/import/setData/外部改 bind —— switchSession hydrate 算不算?checkpoint restore 算不算?);④ C1 回显识别;⑤ C2 patches[i] 批量定位;⑥ resource_update 标脏后写回句柄的乐观锁交互
- 疑点:占位符 `⟦res:handle⟧` 出现在 jsonPath 参数里(而非值)时的行为

### F9 错误与重试链(`harness/errors.ts` + `retry.ts` + `budget.ts`)
- 检查点:① abort 先排除再判 status(顺序回归);② isRetryable(网络/429/5xx)与 isContextLengthError 正交;③ **流式重试重复 emit(P1-d 推后项现状复核)**;④ 4xx 分类(429 vs 400 误判面);⑤ automation 预算闸(tokenBudget/timeBudgetMs)超时与 abort 协同;⑥ `asAgentError` 默认 fatal 的保守性是否产生误中断(集成方 throw 普通 Error 的场景)

### F10 UI/流式事件链(`components/*` + `useChat` + `chatContext` + `sdk/events.ts` + `mountChatDialog.ts`)
- 检查点:① `core.stream` 包装 → sdk-events 中间件 → onEvent/hook 事件完整性(round_start/text/tool_call/tool_result/subagent/done/usage/error,approval_request 不外发);② headless 入口 `ui!=='false'` 降级 warn 路径;③ QueuedBar 排队跨会话不泄漏(P1-b 回归);④ IME isComposing 防护回归;⑤ 停止生成 abort 收口挂起冲突(P1-c 回归);⑥ DebugDrawer subagent tab infoTick 驱动;⑦ unmount 清理(watch/listener/timer 无泄漏,shareContext 多实例各自清理);⑧ message `focuses` 快照渲染 + 持久化
- 疑点:slot 替换区块时 provide/inject 上下文可达性(集成方 L1 替换场景)

### F11 任务完成保证端到端(场景 × 终止路径矩阵)
> 目标:「大多数场景能正常完成任务;完成不了也要有必要的反馈」。逐格验证三件事:**能终止**(不挂死)、**有反馈**(用户与 LLM 各自可见)、**状态干净**(无悬挂 Promise/脏残留/锁泄漏)。

- 场景维:单步写入 / 多步规划任务 / 纯查询任务 / 大 JSON draft 任务 / 子 agent 委派(单/并行/预声明) / focus 精修 / approval 把关 / 冲突介入 / automation 批处理
- 终止路径维:成功 / LLM 自纠后成功 / 工具持续失败 / 轮数预算截断 / 用户 abort / fatal 错误 / 上下文溢出终极失败 / approval 拒绝 / 冲突 keep_external / 子 agent 全失败
- 每格落:实际行为记录 + 反馈文案质量评估(截断/失败时用户能否知道发生了什么、卡在哪)

---

## 2. 模块评审流 R1-R8(细节层,8 路并行)

| 流 | 范围 | 焦点 |
|---|---|---|
| R1 harness 核心 | createAgent/middleware/state/errors/retry/budget | 中间件执行器异常隔离;闭包状态泄漏;signal 分支 |
| R2 数据操作 | dataOps/schemaUtils/jsonUtils/resources/conflictManager/toolError/dataSlotQuery | 校验链顺序;错误码契约完整性;jsonPath 边界;zod adapter 兜底 |
| R3 上下文管理 | useContextManager/contextIndex/summarization/contextPreset/compressDecision/inspectContextTool/contextAnalysis/offload/vfsGc/rounds | estimateTokens 各处口径一致性;切分边界 off-by-one;gate 阈值 |
| R4 会话持久化 | storage/vfs/skillStore/checkpoint/mission/workingMemory | 降级路径;配额 LRU;vfs Proxy 标脏覆盖所有写路径;checkpoint restore 基线重置;**持久化完整性**:写盘中途崩溃 → hydrate 解析守卫;旧版本快照结构演进兼容(缺字段/多字段);多标签页同 agentId+sessionId 并发写 IDB 的分叉 |
| R5 子 agent & 能力 | subagent/ragSubagent/htmlSubagent/todos/skills/memory/permissions/verify/usageHints/approval | 工具池装配(白名单×allowedTools);skill exec 沙箱 + tools 工厂生命周期;verify maxAttempts 死循环防护;approval 两层确认;**叠加 §5 主×子协同 C 视角** |
| R6 SDK 组装 | createChatSdk/optionsResolver/middlewareStack/toolRegistry/llmResolver/events/actions/defineTool/promptBuilder/mountChatDialog | **双 return 代理完整性**(ChatSdk 接口每项有实现,见 H16);选项解析优先级;rebindTools 时机;dedupeTools 覆盖语义;并发 send / stream 重入的串行闸 |
| R7 安全面 | sandbox/hostScript/useMarkdown/domTool/envTool/fetchDoc | defineProperty 锁逃逸回归;host 脚本 `url+host` 禁止校验;sanitize ADD_ATTR 白名单;get_dom 属性白名单;safeSerialize 深度/长度;**Worker 生命周期**(eval/skill exec 用完是否 terminate,防泄漏);fetchDoc 超时/signal |
| R8 UI 层 | ChatDialog/9 区块/message/*/useChat/chatContext/DebugDrawer/SkillPanel/MessageContent/CodePreview | reactive watch 泄漏;XSS 回归;data-code/data-lang 保留;动画卸载清理;CSS 变量契约;**巨内容渲染冻结**(超大 markdown/代码块 marked+hljs 同步 CPU,是否有尺寸闸);DebugDrawer 日志无上限增长 |

每路 reviewer 输入:本表对应节 + H 假设清单(§9) + 「测试盲区视角」(该模块哪些行为没有断言覆盖)。输出:findings 列表(格式见 §0)。

---

## 3. 专项目标漂移 D(goal-drift)

> 两个层面:**agent 行为级**(SDK 内置防漂移机制是否真防住)与**产品定位级**(功能堆叠是否偏离「规范化 JSON 操作 Agent」定位)。

- **D1 mission 生命周期**:`capture` 只认「首条任务型 user」→ **同会话多任务场景 mission 陈旧**(任务 A 完成后任务 B 沿用 A 的目标锚 —— 见 H1)。核查:mission.ts capture 条件 / 完成检测缺失 / `setMission({})` 清空是否为唯一收口 / usageHints 是否引导 LLM 在新任务时提示
- **D2 planning vs 纯查询任务**:`maxPlanRevisions` 退出条件 = 主数据写工具成功 → **纯调研/问答任务永不退出,计数到限后回灌「停止调研,执行清单」对查询任务是错误引导**(见 H2)。核查:todos.ts beforeModel 回灌文案与退出条件 / usageHints 是否区分「查询类任务不需要 write_todos」
- **D3 跨压缩锚点稳定性**:mission/workingMemory/focus/resources 四组 pin 段在 state 不在 messages → compressInput 不碰。逐条验证无旁路清理(仅 resetSession);recall 召回的旧轮是否与现行 mission 矛盾(召回文案会否把已废弃目标带回)
- **D4 定位与默认成本漂移**:当前默认开启能力清点(dataOps/fetch/planning/skills/vfs/summarization/memory/subagent/inspectEnv/focus/workingMemory/missionAnchor/contextInspector ≈ 13 项)→ 默认 system prompt 构成(base + usageHints + schema hint + memory + 4 组 pin)实测 token 占比(用 `inspectContext()` 采样典型 data 规模);simple 工具 7 个 + 内置工具总数;评估「最小可用配置」的认知/成本是否较 2.24 显著上升;能力包/DOM/actions/automation 扩展是否偏离核心定位(结论供 README 定位表述校准,不强改)

---

## 4. 专项执行健壮性 E(死循环 / 卡住不动 / 反馈闭环)

### E1 死循环 / 失控面清点
> 每个循环点统一核对:**闸是什么 → 闸是否真生效 → 触闸后的反馈是什么**。另做全仓 `while`/`for await`/递归 await 站点 grep,确认无预算外循环。

| # | 循环点 | 现有闸 | 审计焦点 |
|---|---|---|---|
| E1-1 | ReAct 主循环(工具错 → recoverable 回灌 → 重试) | maxIterations / maxToolRounds | **无重复检测?**:同工具+同参数+同错误反复回灌,只靠预算硬停(见 H17);触顶截断文案质量 |
| E1-2 | verify 自检回灌 | maxAttempts | check 恒 false 时的终止 + adversarial 子 agent 叠加是否引入新循环 |
| E1-3 | agentCompression decide 工具循环 | decisionTimeoutMs 6s | inspect_context **调用次数无上限?**(模型反复调用直到超时,白费 6s + 延迟;见 H12)|
| E1-4 | 规划 maxPlanRevisions | 默认 5 | 退出后重入计数重置 → 多阶段「规划→执行」各 5 轮是否构成放大;调研轮计数语义 |
| E1-5 | LLM 重试 | maxRetries + 退避 | isRetryable 范围;重试 × _ctxRetry 组合不叠加失控 |
| E1-6 | 上下文溢出反应链 | _ctxRetry 单次 | trim 30% 后仍超 → 抛(fatal 反馈链连到 E3) |
| E1-7 | draft 分块 append→commit | 轮预算 | commit 失败(SCHEMA_INVALID 草稿保留)→ 修复重试循环的引导与终止;草稿残留(H5) |
| E1-8 | eval/skill exec 沙箱 | timeout(8s 自适应) | 超时后 Worker 收口 + 错误回灌 |

### E2 卡住不动面清点
> 每个挂起点统一核对:**谁在等 → 谁负责 resolve → 有无超时 → 超时/无人 resolve 时的可见性**。产出「挂起点 × (超时/可见性/清理)」矩阵。

- **approval 挂起**:UI 三键 resolve;**无超时**;关键疑点:**非流式 `send`(invoke)路径的 approval 可见性**——approval_request 不进 onEvent、send 无流式事件,headless 集成方走 send = 无可见性永久挂起(H18)
- **conflict 挂起**:pendingConflict watch resolve;无超时;挂起期间 abort/switchSession/unmount 的悬挂 Promise 清理(联动 F3)
- **队列饥饿**:runSerial 前一任务挂死(stream 停滞不终止)→ 后续排队任务永不执行且无反馈(H26)
- **MCP 连接建立**:Promise.allSettled 故障隔离,但**单个 server 握手无超时 → mount 整体挂起?**(H23)
- **fetchDoc / 外部 fetch**:有无超时/AbortSignal
- **LLM 流连接停滞**:无整体请求超时,仅 abort → UI loading 无限转圈(看门狗缺失);用户唯一出路是手动停止
- **子 agent 挂起 → 父挂起**:signal 传播链核实(联动 C6)
- **IDB 异步挂起/竞态**:browser 测试 teardown 已观察到 `connection is closing` unhandled rejection —— 定位根因
- **unmount 时机**:round 进行中 / approval 挂起中 / conflict 挂起中 unmount → 悬挂 Promise 回调写已销毁状态
- **动态重配置卡点**:setData 轮中调用(hash 重置 × autoLock 语义,见 H24);setLlm/setTools rebind 时机与进行中轮次

### E3 保证反馈闭环(「完成不了也要有必要的反馈」)
> 判定标准:任何「轮次结束但用户不知道发生了什么 / 不知道为什么没完成」= finding。所有终止路径必须落在 {成功回复 | 结构化错误回灌 LLM 自纠 | 用户可见错误/提示} 之一。

- 轮预算截断 → 用户看到什么(应含原因 + 未完成事项,H22)
- 工具持续失败直至截断 → 最终回复是否说明失败原因(prompt 引导 or 框架兜底)
- fatal 错误 / 上下文溢出终极失败 / SYSTEM_PROMPT_OVER_BUDGET 早退 → error 事件 payload + UI 错误态文案
- approval 拒绝 / conflict keep_external → LLM 侧结果文本明确 ✓ 核实
- 子 agent 全失败 → 主 agent 聚合反馈(联动 C2)
- 存储配额耗尽 LRU 淘汰 → 可见反馈(warn?事件?)
- abort → partial 保留 + 停止态展示
- 事件处理器抛错 → observable 隔离不断主链 ✓ 核实
- headless 忘调 afterRound → 静默丢消息(机制建议:switchSession 检测未持久化变更 → warn)
- 空/非法输入校验反馈;LLM 工具参数 JSON 解析失败的反馈路径

---

## 5. 专项主 × 子 agent 协同 C(串台 / 隔离 / 归属)

### C1 共享状态面清点(父子共享什么,语义各是什么)
- **dataOps controller 同闭包**:子 agent 工具若经同一 controller(allowedTools 追加写工具场景)→ **lastReadHash / 快照栈 / 脏标记父子互通**:子 read 改 autoLock 基线(父后续写用子的 hash:合理 or 误冲突?)、子写入快照进 per-path 栈 → 父 restore_data 可回退到子的中间态(H19)
- **vfsStore 四池共享**:子 offload 大结果进 large_results;protectedRefs 只在父 stream 入口注入 → **子在途引用不受保护 → 子 vfs_read 404?**(H21);两子写同路径 last-writer-wins 无冲突检测
- **tracker / usage / storage**:共享语义核实(usage 子 token 计入 ✓;automation tokenBudget 是否计子消耗)
- **跨 agent 乐观锁**:子改 bind → 父陈旧 hash 写 VERSION_CONFLICT → 有无引导父重读(委派引导 prompt 覆盖?)

### C2 并行委派与结果归属
- spawn_agents 结果归并:**单个失败不遮蔽其余**(H20);结果文本可区分是哪个子任务;部分成功语义
- 子结果回灌主上下文:**全长结果有无 offload 兜底**(巨大子结论撑爆主上下文?);tracker resultPreview 120 截断仅观察层

### C3 事件串台
- forward 事件按 taskId 分组 ✓;**同一 use_<id> 并发调用共享事件 taskId → UI steps 交错混组**(2.38 只解决了 tracker 侧 observeId,事件侧按设计保留 —— 评估实际影响,是否需升级)
- 子 steps 挂到正确父消息行(children 嵌套)错位场景;子 agent 事件处理器抛错隔离

### C4 范围与权限边界
- 只读子集 + allowedTools 装配正确性(**写工具不得漏进 rag 等只读承诺的子**);spawn 工具排除防递归回归;maxDepth 切断含预声明链(use_a → use_b → …)
- **writablePaths guard 覆盖 write/patch/patches/edit 全部 jsonPath 形态**(嵌套 patches、数组索引、前缀边界,H25)

### C5 任务语义与上下文隔离
- 父的 task 描述完整进子上下文,**父对话历史不泄漏进子**(过程隔离回归);子只回最终结论(token 隔离回归)
- 子 agent 看不看父的 mission/workingMemory(应该/不应该?现状核实);focus 继承 ✓ 回归;子的 systemPrompt 与主 systemPrompt 职责边界

### C6 生命周期协同
- abort 父 → 子传播(signal 链);unmount 时子在跑;子完成顺序 vs 父轮收尾时序(父是否等全部子结束);错误路径 tracker finish 必达(done/error 二选一,无僵尸 active 态)

### C7 子 × 压缩 / 观察
- 子自身 summarization(html 包默认开)与父 messages 隔离 ✓ 核实;子的 compressInput 不触碰父 pin 段
- 长任务子 steps 无上限膨胀(H8)× DebugDrawer 渲染性能

---

## 6. 专项性能 P

- **P1 每轮固定开销**:augmentPrompt 钩子数(装载中间件全量 × 每轮);estimateTokens 调用点清点与复杂度(O(字符) × 次数);analyzeContext 每轮分类成本;usageHints 渲染。产出:「每轮 agent 固定 CPU/token 预算表」
- **P2 大对象操作**:`hashValue` 算法与调用频率(**A3 惰性 hash 推后项现状**:get/read/write/autoLock 各调几次,几百 KB bind 的同步耗时 —— H3);checkpoint messages 整体 clone(Phase B 推后)长会话实测;exportData/importData 深拷贝;offload 阈值 6000 的转存频率
- **P3 内存增长清点**:tracker steps 无上限(H8)/ debugLogs 上限机制 / subagentHistory LRU ✓ / vfs protectedRefs Set 大小 / loadedSkillTools 累积 / 消息 focuses 快照随持久化膨胀
- **P4 token 成本审计**:同 D4 采样;agentCompression decide 额外 LLM 调用成本(每次压缩 +1~2 次工具循环)vs 收益;preserve 只增不减的长期膨胀
- **P5 异步生命周期**:fire-and-forget 清点(trim LLM 增强 / summary-title lazy / decide / sandbox 超时)—— 悬挂 Promise 是否持大对象引用;unmount 后异步回调写已销毁状态

---

## 7. 专项结构健康 A

- **A1 类型四处同步机械门禁缺口**:四处 = `types/index.d.ts` + `types/headless.d.ts`(对外)+ `src/core/types/index.ts`(内部)+ createChatSdk.ts 内联接口(ChatSdk/AgentCore)。现有门禁:test:exports(导出名对齐)/ test:types(d.ts 可用性)/ src tsc 卫生(internal 一致性)。**盲区:对外 d.ts 与 src 实现的结构对齐无门禁**(d.ts 声明了方法但实现漏加 —— 2.38 `getActiveSubagents` 事故同型,当时靠 e2e 运行时兜住)。核查缺口 + 提出低成本门禁方案(如 test-d 断言 `satisfies` 全接口)
- **A2 createChatSdk.ts 上帝文件(2357 行)**:双 return(buildCore AgentCore / _createChatSdk 显式代理列表)持续漂移源(2.38 亲历 + 1.3.1 历史同型);P2 拆分评估推后项复核 —— 给出「拆/不拆/怎么拆」结论
- **A3 中间件顺序契约**:pin 段(mission/workingMemory/focus/resourcesPin)全 Infinity 靠声明序;usageHints 首位;装载序文档与代码一致性;新中间件插入位置约定是否成立
- **A4 推后项复核**(逐项:触发条件是否仍成立 / 优先级是否上调):P1-d 流式重试重复 emit / css exports style.css 404 / large-json A1-A4·B1-B2·C1-C2 / read·write 投影深度不对称 / 中文 recall 分词 / checkpoint messages Phase B / mission-anchor 再评估 / P2-architecture-refactor 残项
- **A5 流程卫生**:chatdialog-component-split 索引失真(标 0/46 暂缓,代码已实施 —— 核实哪些 task 真未做如拼装示例 demo,修正索引状态);CLAUDE.md 三池/四池;README 中英与代码能力漂移抽查(2.36-2.38 新能力是否都进了双语 README)

---

## 8. 专项测试盲区 T

- **T1 覆盖对照矩阵**:2.25 以来新能力 × 三层测试(selftest/e2e/browser)逐行对照。重点怀疑:agentCompression 逻辑层 selftest 有无 / draft_write 仅真 LLM 测(node 层逻辑断言?) / verbatim 仅 freeze 进 browser / focus 持久化+子 agent 继承 e2e / automation batch / headless 降级 warn e2e ✓(已有)/ skill exec·tools 工厂
- **T2 断言强度**:「调用了但只断言 typeof」式弱断言清点;browser spec 40 项与 demo 实际能力面的缺口
- **T3 browser 缺路径**:stream 中途 switchSession / 冲突条三选一操作 / checkpoint 回退 × focus 共存 / DebugDrawer tab 切换 / 多焦点 chip 交互(page-demo 已有单链,complex-demo 越界自纠已有 —— 查缺补)

---

## 9. 高优先假设清单 H(优先证伪,每条定位到文件)

| # | 假设(证伪目标) | 定位 | 关联 |
|---|---|---|---|
| H1 | mission 只 capture 首条任务消息 → 同会话第二个任务沿用旧目标,无完成清理 | `harness/mission.ts` capture 条件 | D1 |
| H2 | maxPlanRevisions 退出依赖写工具 → 纯查询任务被错误回灌「停止调研去执行」 | `harness/todos.ts` beforeModel | D2 |
| H3 | hashValue 对几百 KB bind 同步全量计算且每轮多次(A3 惰性 hash 未做) | `tools/dataOps.ts` hash 调用点 | P2 |
| H4 | enforce 三调用点未覆盖 eval 子树模式(2.17+ jsonPath 子树 set 路径) | `tools/dataOps.ts` eval + `resources.ts` enforce | F8 |
| H5 | draft 池跨轮碎片在会话 restore 后残留/无回收(drafts 池随 vfs 持久化?) | `backends/vfs.ts` drafts + applySnapshot | F4 |
| H6 | headless 直接 `switchSession` 不 abort 进行中 stream(P1-b 修复仅在 UI 层) | `createChatSdk.ts` switchSession | F5 |
| H7 | d.ts 声明与 src 实现结构对齐无机械门禁(2.38 事故同型仍可复发) | `scripts/` exports-consistency | A1 |
| H8 | tracker steps 无上限 → 长任务子 agent 观察态膨胀 | `harness/subagent.ts` createSubagentTracker | P3 |
| H9 | CLAUDE.md 三池/四池不一致(已确认)+ 其余文档漂移待查 | CLAUDE.md:99/109 | A5 |
| H10 | skill exec host 模式 `url+host` 禁止校验、sandbox defineProperty 锁回归 | `tools/sandbox.ts`/`hostScript.ts`/`skills.ts` | R7 |
| H11 | shareContext 双实例:一实例 resetSession 对另一实例活跃流的影响 | `createChatSdk.ts` shareContext 段 | F5 |
| H12 | agentCompression decide(≤6s)在 compressInput 同步阻塞当轮首响应 | `summarization.ts`+`compressDecision.ts` 调用位置 | F4 |
| H13 | discriminatedUnion 降级开放 × focus PATH_DENIED 叠加:焦点在 union 子树内时写拦截判定语义 | `focus.ts` + `schemaUtils.ts` | F7 |
| H14 | checkpoint messages 每轮整体 clone,长会话成本线性增长(Phase B 未做) | `harness/checkpoint.ts` save | P2 |
| H15 | _createChatSdk 显式代理列表与 ChatSdk 接口项一一对应无漏(2.38 修一处,其余?) | `createChatSdk.ts` return 段 ~2167 | A2 |
| H16 | vfs GC 可达性只扫 messages,pin 段(resources/mission)引用的 large_results 会不会被误删 | `utils/vfsGc.ts` + resourcesPin | F4 |
| H17 | 无重复检测:同工具+同参数+同错误 recoverable 回灌成事实死循环,只靠 maxIterations 硬停 | `createAgent.ts` 工具错误回灌路径 | E1-1 |
| H18 | approval/conflict 挂起无超时;**非流式 send 路径 approval 可见性缺失**(approval_request 不进 onEvent、send 无流式事件)→ headless+send 无可见性永久挂起 | `approval.ts`/`conflictManager.ts`/events | E2 |
| H19 | 主×子共享 dataOps controller 闭包:子 read/write 污染父 lastReadHash(autoLock 基线)与 per-path 快照栈(restore 可回退到子中间态) | `subagent.ts` 子工具装配 + `dataOps.ts` 闭包 | C1 |
| H20 | spawn_agents 并行归并遮蔽单个失败(错误文本互相覆盖/丢失归属) | `subagent.ts` runPool 归并 | C2 |
| H21 | 子在途 vfs 引用不在 protectedRefs(仅父 stream 入口注入)→ 子 offload 文件被子自身 LRU 淘汰,子 vfs_read 404 | `offload.ts` + `vfsGc` protectedRefs 注入时机 | C1 |
| H22 | 轮预算截断反馈缺原因与未完成事项(用户只见截断回复,不知卡在哪) | `createAgent.ts` 截断返回 | E3 |
| H23 | MCP 连接建立无超时 → 单 server 握手挂起拖死整个 mount(allSettled 无限等) | `mcp/client.ts` | E2 |
| H24 | setData 轮中调用:hash 重置 × autoLock 后续语义(误冲突 or 静默放行)与快照清空的通知 | `dataOps.ts` setData + autoLock | E2 |
| H25 | writablePaths guard 未覆盖 patches 嵌套/数组索引等 jsonPath 全形态 → 子 agent 越界写 | htmlSubagent path guard | C4 |
| H26 | 队列饥饿:runSerial 前一任务挂死(stream 停滞)→ 后续排队任务永不执行且无反馈 | `useChat` runSerial/queued | E2 |
| H27 | 单条巨型 user message 独超 60% 窗口 → 轮内 trim 无法收敛 → 直奔溢出反应链(裁谁?) | `useContextManager` H1 trim | E2 |
| H28 | automation tokenBudget 不计子 agent 消耗 → 预算闸漏算;子挂起无超时 → 父批处理整体卡死 | `budget.ts` + subagent | C6/E2 |

---

## 10. 执行与产出约定

- findings 一律 **先核实后定级**(对抗核实:每条 P0/P1 由独立视角复核代码,防误报 —— 上次审计 P1-e 即为核实后纠正的误判)
- 报告 `audit-report.md` 落本 change 目录;P0/P1 修复**不在本 change 实施**
- 真 LLM / 浏览器手动才能验证的行为:报告中标「手动验证项」清单,不阻塞审计收口
