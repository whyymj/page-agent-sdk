# R3 上下文管理审计结果(audit-sdk-integrity)

> 范围:src/core/composables/{useContextManager,contextIndex}.ts、src/core/harness/summarization.ts、
> src/core/sdk/{contextPreset,compressDecision,inspectContextTool}.ts、src/core/utils/{contextAnalysis,offload,vfsGc,rounds,modelCaps}.ts
> 基线 2.38.0。所有结论经逐行读码核实(含 Vue reactivity searchProxy 源码、useChat 流路径验证)。

## Findings(严重度降序)

P2|flow-divergence|src/core/harness/summarization.ts:60 + src/core/harness/createAgent.ts:586-599|H12 证实:decide 在 compressInput 内被同步 await,compressInput 又在 stream() 首轮模型调用(createAgent.ts:649)之前执行 → decide(≤6s)全额阻塞当轮首响应,且 compressInput 无 signal 参数,用户 abort 无法打断 decide|createAgent.ts:586-599 `await m.compressInput(input)` 先于 while 循环;summarization.ts:60 `await opts.decideInvoke(...)`;llmResolver.ts:208 `decisionTimeoutMs ?? 6000`|decide 改「本轮静态压缩、决策异步供下轮」,或把 decide 移到 stream 入口外并行,至少透传 abort signal|selftest 补:stub 慢 decide 断言首响应延迟;abort 后 decide 提前终止
P2|flow-divergence|src/core/sdk/contextPreset.ts:52 + src/core/sdk/llmResolver.ts:59|默认 auto 预设 enableLLMSummary `?? true` → 压缩触发轮的 LLM 摘要(默认 15s 超时)也在 compressInput 同步 await,与 decide 叠加最坏 ~21s 阻塞首 token;llmResolver.ts:52 注释「超时回退索引摘要(不阻塞用户)」与实现(阻塞至多 15s)不符|resolveContextOptions:`enableLLMSummary: userOpts ?? preset.enableLLMSummary ?? true`(auto 预设无此键→true);useContextManager.ts:171 `await config.llmInvoke(...)` 位于模型调用前|仿 trim 异步增强(createChatSdk.ts:1920)改「先静态注入、LLM 就绪后台替换」,或显著调低 summaryTimeoutMs|e2e 补:stub 慢 summaryLlm 断言压缩轮首响应延迟上限
P2|correctness|src/core/sdk/createChatSdk.ts:1654|setLlm 重算 modelCaps 用 `options.contextWindow ?? llmCfg?.contextWindow` —— options.contextWindow 是对初始模型的声明,切到不同窗口的新模型后陈旧声明仍优先覆盖新模型自身声明 → 压缩阈值/offload 阈值/系统段预算全按旧窗口算(偏大时实际溢出)|与 1649-1650 注释「权威重算…保留 LLMConfig.contextWindow 声明」矛盾;初始 resolveLlm(llmResolver.ts:273)同模式在初始场景正确,setLlm 场景错误|setLlm 路径移除 `options.contextWindow ??` 前缀(或仅新配置未声明时回退)+ warn|e2e 补:options.contextWindow=1M + setLlm 256K 模型(自带声明)→ 压缩阈值按 256K
P2|correctness|src/core/sdk/createChatSdk.ts:1569|setProtectedRefs 唯一注入点是 core.stream 包装器:UI 走 fetchStream→stream 受保护,但 headless send(1438)/batch(1480)直调 `core.agent!.invoke` 绕过 → protectedRefs 恒旧/空,LRU 保护失效(vfs_read 404 风险);子 agent 经 createAgent 直跑亦无注入点;且注入是 stream 入口快照,流中途新 offload 的文件不在保护集|全仓 grep setProtectedRefs 调用仅 1569 一处;vfs.ts:124 淘汰仅跳过 `_protectedRefs.has(k)`|注入下沉到 invoke/stream 共享前置;offload 写入时把新 path 追加进保护集|selftest 补:send 路径 + large_results 池压满 → 被引用文件不被淘汰
P2|correctness|src/core/harness/createAgent.ts:222-229|H27 部分证实:trimContextIfNeededImpl 只截 ToolMessage(`if (!(m instanceof ToolMessage)) return m`),单条巨型 user 独超 60% 窗口时轮内 trim 无法收敛(仅 warn:234);溢出反应链 _ctxRetry(450-459/486-495)复用同函数也裁不动 Human/System → 真超模型窗口时单次重试后 throw fatal,且巨型 user 已 push 进 messages(send 1434 catch 不回滚)→ 后续每次 send 重蹈覆辙,会话卡死|useContextManager.ts:139 「至少保留最新 1 轮」使最新轮巨型消息压缩也压不掉;H2 复查(245-248)只 warn|反应链增加超大 HumanMessage 截断/转存 vfs 留引用;fatal 文案指明单条消息超窗口|selftest 补:>60% 窗口单 user → 断言 trim 行为/错误路径/后续 send 状态
P2|performance|src/core/composables/useContextManager.ts:195-197 + src/core/utils/rounds.ts:91|累积摘要只增不减:compress 把 prevSummaryBody 原文整体拼入新摘要(llm 模式也只重写 older 段),trim 的 mergeSummarySegments 同样 prev 全文保留 → 长会话单条摘要 system 消息无界增长,无任何二次压缩|useContextManager.ts:196 `${summaryText}\n【更早累积摘要】\n${prevSummaryBody}`;rounds.ts:91 `${prev.body}\n【续】\n${current.body}`|摘要自身超阈值时对「更早累积」段再压缩|selftest 补:连续 N 轮 trim/compress 断言摘要 token 增长有上界
P2|correctness|src/core/composables/contextIndex.ts:61 + src/core/utils/offload.ts:84-89|preserve 块把工具 result 截 120 字,但 offload 文案中 vfs 路径位于 1000 字 preview 之后 → older 轮被压缩后大结果引用必然丢失(LLM 无法按路径回读,trim 后 GC 还会回收),preserveLastToolResults 对「offload 过的 read 结果」实际失效|contextIndex.ts:61 `plainSummary(st.result, 120)`;offload.ts:84-89 preview 在前、`已转存…large_results/xxx.txt` 在后(偏移≥1000)|preserve 提取时用 vfsGc 的 REF_RE 把 large_results 引用单独保进摘要块|selftest 补:含 offload result 的轮 compress 后断言摘要仍含 large_results/ 路径
P3|doc-drift|src/core/utils/modelCaps.ts:113-115|CLAUDE.md「工具结果 > 6000 字符转存 vfs」失实:实际阈值随窗口自适应(clamp [2000,20000]),6000 仅是 offload.ts:30 未传 threshold 的兜底默认,createAgent 恒传自适应值|createAgent.ts:283/515 `threshold: offloadThreshold`|修正文档表述为「自适应 2000~20000(窗口 1% 推导)」|—
P3|correctness|src/core/composables/contextIndex.ts:27 + src/core/composables/useContextManager.ts:241-244|estimateTokens 输入口径不一致:estimateMessageTokens 非 string content 计 0(multimodal parts 全漏);compress 的 H2 复查只计 content 不计 steps(低估);analyzeContext 却 stringify 非 string 且计 tool_calls args → 同一上下文各处估值偏差|contextIndex.ts:27 `typeof m.content === 'string' ? m.content : ''`;useContextManager.ts:242 只取 `m.content`;contextAnalysis.ts:157-163 含 args|抽单一 msgTokens(m) 统一口径|selftest 补:同一消息三处估值一致性断言
P3|correctness|src/core/sdk/inspectContextTool.ts:62-74|inspect_context 硬截最近 50 轮后求 totalTokens,与触发 gate(shouldTriggerCompression 全量口径)在 >50 轮时不一致,decide-LLM 看到的占用低于 triggerReason 声称值(trim 约束 ≤30 轮,实践难触发,标待验证)|inspectContextTool.ts:62 截断;74 由截断后 roundInfos 求和|totalTokens 用全量 rounds 计算、rounds 明细才截断|selftest 补:>50 轮时 totalTokens 与 gate 同口径
P3|performance|src/core/sdk/createChatSdk.ts:1909|context_trimmed 事件的 vfsResults 把被裁轮引用的大结果全文拷进事件 payload(large_results 池上限 4MB)→ 监听方瞬时内存尖峰|snapshotVfsResults(1881-1888)读 `f.content` 全文|提供轻量 `{paths}` 模式或单文件长度上限|selftest 补:大文件被裁时事件 payload 尺寸断言
P3|correctness|src/core/composables/useContextManager.ts:126-143|token 模式自定义 windowRatio > summaryThresholdRatio 时,gate 触发但累加循环永不 break → older 空 → notTriggered,每轮空转永不压缩(内置四预设均 ratio≤threshold 不受影响,仅自定义误配)|139-143 `if (!older.length) return notTriggered('none')`,无告警|resolveContextOptions 校验 windowRatio ≤ summaryThresholdRatio 并 warn|e2e 补:误配组合断言告警/纠正

## 假设结论

### H12:证实
decide 在 `summarization.ts:60` 被 await(位于 compressInput 内),compressInput 由 `createAgent.ts:586-599` 在 stream() 入口、首轮模型调用(649)之前同步 await → ≤6s 全额阻塞当轮首响应;叠加默认 LLM 摘要(≤15s)最坏 ~21s,且 abort 不透传。
- decide 工具循环**有上限**:llmResolver.ts:172 每段 ≤3 轮工具循环 × 首试+重试一次 = ≤6 次 LLM 调用,全程 6s abort 兜底(design E1-3「无上限」疑点证伪)。
- decide 失败降级静态路径**完整**:summarization.ts:68-70 双 catch → decision undefined → compress 走 config 静态切分;keepRounds 下界 ≥1 守卫(useContextManager.ts:148)、windowRatio 累加循环(126-143)边界正确;decision.summarize.mode='llm' 但无 llmInvoke → 回退 index(169);recallTopK=0 → 不召回(183)。

### H16:证伪
- `gcVfsLargeResults` 只删 `large_results/` 前缀键(vfsGc.ts:48-50),**resources 池(`resources/<handle>.json`)永不被 large_results GC 触碰**。
- 四组 pin 段经核实均不携带 large_results 引用:mission goal 截 200 字(mission.ts:34)、workingMemory 存 data jsonPath+hash(workingMemory.ts:72-85,CAPTURE_TOOLS 仅 read/query_data/search_data)、focus 存 jsonPath、resourcesPin 存 `⟦res:handle⟧` 占位符(resourcesPin.ts:21-27,真值在 resources 池)。
- 唯一理论边缘:mission.goal 前 200 字恰含 large_results 路径且原消息被裁 → 启发式 capture 下概率极低,记 P3 待验证。

### H27:部分证实
- 「轮内 trim 无法收敛」**证实**:trimContextIfNeededImpl(createAgent.ts:222-229)与溢出反应链激进 trim(450-459/486-495)都只截 ToolMessage,Human/System 裁不掉;compress 的「至少保留最新 1 轮」clamp(useContextManager.ts:139)使最新轮巨型消息也压不掉。
- 「直奔溢出反应链」仅在总量真超模型实际窗口时发生(60% 是保守预算,60%~100% 之间仍可能侥幸通过模型调用)。
- 补充后果:fatal 后巨型 user 留在 messages(send 1434 push 后 catch 不回滚)→ 后续每次 send 重蹈覆辙,会话卡死(仅 checkpoint/clear 可解)。

## 链路 B 补充核实(任务 2)

- **异步 LLM 增强竞态守卫(indexOf)真安全**:Vue searchProxy(node_modules/@vue/reactivity/dist/reactivity.cjs.js:963-972)对 raw 数组查找 raw 对象直接命中(proxy 参数亦有 toRaw 重试);splice→删除→indexOf<0 放弃在单线程内原子;switchSession(createChatSdk.ts:1523)/新一轮 trim 移除 summaryMsg 后守卫正确放弃。
- **trim 先于 summary 时累积摘要不丢**:compress 提取头部【更早对话摘要】(useContextManager.ts:93-104,parseSummarySegment rounds.ts:98)并入【更早累积摘要】(195-197);compress 产出的【对话历史摘要】是视图态(不写回 messages),不会与该机制冲突。但随之带来只增不减膨胀(见 P2-6)。
- **GC 三触发点顺序正确**:trim 后(1914)/加载(applySnapshot 1373)/clear;均先 emit context_trimmed(含 vfsResults 全文快照,1901-1912)再 splice 再 GC。

## 其他核实通过项(无 finding)

- MIN_CONTEXT_WINDOW 三处 throw 齐全:createChatSdk.ts:803(buildCore)/ 1657(setLlm)/ subagent.ts:264(子 agent 解析)。
- token 模式切分边界:windowRatio=0 → budget 0 → 保留最新 1 轮其余全压(语义自洽);轮数模式 keepRounds=0 → Math.max(1,…) 下界守卫(148);keepRounds≥总轮 → older 空早退 notTriggered。
- decide 能力检测:bindTools 缺失 → null(llmResolver.ts:220);调用抛错/超时 → catch null(251-252)。
- OOM 强制删兜底:vfs.ts:117/132 池超 1.5× limit 无视 protectedRefs 强制 LRU 删,与文档一致。
- 子 agent summarization 无 llmInvoke/decideInvoke(subagent.ts:270-275)→ 索引摘要零阻塞,不引入 H12 同型问题。
- 测试覆盖现状:sec-63(inspect_context)/ sec-64(decide 两段循环)/ sec-65(决策切分)+ tests/e2e/agent-compression.mjs 已覆盖主干;本报告各 finding 附的测试补建议为缺口项。

## 一句话总评

压缩链主干(gate→decide→切分→preserve→recall→注入、trim→事件→GC、双摘要累积合并、竞态守卫、MIN_CONTEXT_WINDOW 三处 throw)逻辑正确、边界守卫齐全;短板集中在「首响应延迟被同步阻塞(decide+LLM 摘要)」与「保护集/GC 视野不覆盖非 messages 引用源(send/batch/子 agent 路径、流中途新 offload)」两类结构性缝隙。
