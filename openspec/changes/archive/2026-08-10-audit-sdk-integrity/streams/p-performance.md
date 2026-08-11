# audit-sdk-integrity —— P 专项(性能)审计结果

> 基线 2.38.0;审计范围 = design.md §6 P1-P5;所有条目经代码核实,附 file:line。
> 默认配置口径:data 已配、toolMode simple、capabilities 全默认(opt-out 13 项开 / opt-in 8 项关)。

## Findings(严重度降序)

| # | 严重度 | 类别 | file:line | 结论 | 证据 | 修复建议 | 测试补建议 |
|---|---|---|---|---|---|---|---|
| P-1 | **P1** | performance | llmResolver.ts:71-89 + createAgent.ts:586-599 + useContextManager.ts:169-176 | 默认 `enableLLMSummary=true`(contextPreset.ts:52 兜底 true),摘要 LLM 在 `compressInput` 内被 await,而 compressInput 先于首个模型调用同步执行 → 触发压缩的 turn 首 token 阻塞 ≤15s(summaryTimeoutMs);agentCompression 再叠 decide ≤6s(最坏 ~21s)。buildSummaryLlmInvoke 注释「不阻塞用户」与实现相悖 | createAgent.ts:589 `await m.compressInput(input)` 位于 :614 toLC 之前;触发条件 = 历史 >0.5×window(≥100K token),恰是大 JSON 长流程场景 | 摘要改「模板先行 + 异步 LLM 增强」(照 trim-llm 既有模式) | selftest:stub llmInvoke 延迟 3s,断言首个 round_start 延迟 < 阈值 |
| P-2 | P2 | performance | dataOps.ts:868-869、447-448 | write(edit)/edit_data 对同一 bind 连续两次 `hashValue`(lastReadHash 一次 + return 消息再算一次),纯冗余;几百 KB bind 每次多一轮全量 O(N) | 两处紧邻代码可见 | 返回消息复用已存 hash 变量 | selftest 注入计数 hasher,断言单次 edit ≤1 次 |
| P-3 | P2 | performance | dataOps.ts:705/385/340/170、447/491/517/645/658/685/851/1055、commitSetToBind:170(H3) | hashValue=cyrb53(safeStringify 全量,replacer 逐值 WeakSet+instanceof):每次 read 必算 1 次、每次 autoLock 写 handleConflict+写后+消息共 3-4 次,叠 deepClone×2 + safeParse 全量 → 单条小 patch 对几百 KB bind ≈ 6-7 次主线程 O(N);A3 惰性 hash 确认未做(全仓无 hash 缓存) | grep hashCache/lazyHash 无命中;调用点如上 | 脏标记惰性 hash(写/外部变更失效缓存) | selftest:read→write 序列断言 hashValue 次数上界 |
| P-4 | P2 | performance | checkpoint.ts:171(H14) | save 每 user turn 整体 `clone(messages)`(structuredClone/JSON),无增量(Phase B 未做;bind/vfs 已有脏标记增量唯 messages 没有);成本随会话线性增长,栈深 5 → 内存 ≈ 5× 全历史(含 steps/reasoning) | :171 `messages: clone(messages)`;对比 :154-166 bind/vfs 增量分支 | messages 增量克隆(只克隆新增尾部/结构共享) | selftest:连续两次 save 断言 messages clone 复用 |
| P-5 | P2 | performance | createAgent.ts:212-237/639 + contextInspector.ts:40 | 每模型轮全上下文 O(总字符) estimateTokens 扫描 ≥2 遍:trimContextIfNeeded 的 total reduce 不超限也全量跑 + contextInspector(默认开)analyzeContext 再逐条估 + classifySystem 对 system 串 7 标记重复 indexOf;estimateTokens 用 `match(/[\u4e00-\u9fff]/g)` 分配全量 CJK 字符数组,中文大上下文 GC 压力明显 | :216 reduce 无条件全量;contextAnalysis.ts:105-113 标记扫描 | 按消息缓存 token 数(消息 append-only);estimateTokens 改单遍码点计数 | selftest:远低于预算时断言不逐条重估 |
| P-6 | P2 | performance | createChatSdk.ts:1944 | persistRuntime 每轮(afterRound)对全历史 messages 做 `JSON.parse(JSON.stringify())` 纯化(storage 开启时),O(history) 同步随会话线性增长 | :1944 | 增量序列化(缓存已纯化前缀,只序列化新增) | e2e(storage:memory)计数序列化次数 |
| P-7 | P2 | performance | subagent.ts:95-98(H8) | tracker.pushStep 无单次运行上限:长任务子 agent(html 包几百次工具调用)steps 无限增长;history LRU 限 20 条但每条携带全量 steps;finish 在 done/error 双路径均调(:356/359/392/395/576/579),僵尸 active 仅出现在挂起场景(E2 域) | :97 `st.steps.push(step)` 无 cap | 每 run 上限(保留最近 200 + 总数计数) | selftest:push 1000 步断言封顶 |
| P-8 | P2 | performance | createChatSdk.ts:1920-1931(P5) | trim LLM 增强 fire-and-forget 持 `older`(被删轮全文含 steps)引用直至 LLM 返回(≤15s);且无 unmount 取消:release/store.dispose 后回调仍写 messages 并调 persistRuntime → 写已销毁 store(titleLlmInvoke 同模式但输入已截断 800 字,风险小) | `void (async () => {...})()` 无 signal;unmount(:2145-2160) 不 abort 悬挂异步;竞态守卫 indexOf 已有 | 绑 AbortController,unmount/release 时取消 | selftest:unmount 后 LLM 返回,断言无 store.save |
| P-9 | P3 | performance/token | useContextManager.ts:195-197、162-165(P4) | 摘要段只增不减:每次压缩把 prevSummaryBody 原文并入新摘要(嵌套累积)+ preserve 配置∪决策只增不减 → 长会话 summary system 消息单调增长,无尺寸预算 | :195-197 `${summaryText}\n【更早累积摘要】\n${prevSummaryBody}` | 累积摘要设尺寸预算,超限再压缩/截断最早段 | selftest:连续 3 次压缩断言摘要尺寸有界 |
| P-10 | P3 | performance | summarization.ts:52-53 + useContextManager.ts:88/120 | decideInvoke 配置时每 turn groupRounds + shouldTriggerCompression(estimateRoundTokens 含 steps args JSON.stringify 全量)跑两遍(gate 一次 + compress 内一次) | 两处重复调用 | gate 的 rounds 结果传入 compress 复用 | selftest:计数 groupRounds 每 turn ≤1 |
| P-11 | P3 | performance | dataOps.ts:632 | eval 子树模式为判超时档对子树做一次完整 `JSON.stringify(data).length` | :632 | 粗略尺寸估算替代 | selftest:计数 stringify |
| P-12 | P3 | doc-drift | modelCaps.ts:113-115 vs CLAUDE.md「> 6000 字符」 | offload 阈值实为自适应 3.5%×window clamp[2000,20000](200K 窗→7000、1M→20000),文档「固定 6000」漂移(联动 H9) | 代码/文档比对 | 同步 CLAUDE.md | 无 |

## H3 / H8 / H14 证伪结论

- **H3 成立(未证伪)**:hashValue = cyrb53(safeStringify 全量)(jsonUtils.ts:147-161),同步、无惰性实现(A3 未做,全仓无 hash 缓存);autoLock 默认开时单次 write ≈ 3-4 次全量 hash(handleConflict:340 + 写后 lastReadHash + return 消息)+ deepClone×2(applyPatchesToBind:199 + snapshot:232;commitSetToBind:156)+ 全量 safeParse;另发现两处同内容双 hash 冗余(P-2)。
- **H8 成立(影响有限)**:pushStep 单 run 无上限(subagent.ts:97);history 条数 LRU 20 ✓、每 step 仅 kind+name+ts(~80B),实际内存影响小但原则上无界,随 html 子 agent 长任务线性涨;finish 双路径必达(done/error 各 3 处),僵尸 active 仅挂起场景(E2 域)。
- **H14 成立(未证伪)**:checkpoint save 每 user turn(beforeModel 首次)整体深克隆 messages(checkpoint.ts:171),无增量(bind/vfs 已有 consumeDirty 增量、唯 messages Phase B 未做),栈深 maxCheckpoints=5 → 内存 ≈ 5× 全历史,长会话线性恶化。

## 每轮固定开销清单

**每模型调用轮(ReAct 循环内)**:
- beforeModel ×2(todos/workingMemory;checkpoint 开启时 +1)
- buildSystemPrompt(replaceSystem 每轮重建):augmentPrompt ×9(dataHint[WeakMap 缓存命中]/usageHints/todos/skills/mission/workingMemory/focus/memory/subagent;resourcesPin/subagents/augmentSystem 条件性)+ estimateTokens ×10(各段+base,小字符串)
- trimContextIfNeeded:全上下文 estimateTokens ×1(O(总字符),不超限也全量跑)
- wrapModelCall ×1 层:contextInspector.analyzeContext = 全上下文 estimateTokens 再 ×1 + system 7 标记 indexOf 扫描(contextInspector 默认开;budget 仅 automation)
- LLM stream
- afterModel ×2(skills/sdk-events usage 累加)
- 每工具调用:wrapToolCall ×5 层洋葱(todos/workingMemory/focus/subagent/sdk-events;permissions/approval/humanConfirm 条件性)+ offload 长度判断;formatForLog 生产短路 ✓(createAgent.ts:546)

**每 user 消息(stream 入口一次)**:
- beforeAgent ×7(todos/skills/vfs/memory/mission/workingMemory/focus)
- compressInput ×1:groupRounds + shouldTriggerCompression 全历史 estimateRoundTokens(含 steps args/result;decideInvoke 配置时 gate+compress 双跑,P-10);触发时同步 LLM 摘要 ≤15s(P-1),agentCompression 加 decide ≤6s(2-6 次 invoke)
- setProtectedRefs:extractVfsRefs 扫 messages 一遍(createChatSdk.ts:1569)
- toLC:重建全部 BaseMessage
- checkpoint(开启时):messages 全量 clone(P-4)+ bind/vfs 脏标记增量
- afterRound(轮末):trimMemoryMessages + persistRuntime(storage 开时全历史 JSON round-trip,P-6)

**Token 固定成本(每请求)**:base ~200 token + usageHints simple 全量 ~3-4K token + dataHint schema(≤4000 字符或大 schema 浅览) + pin 段(mission/workingMemory/focus/resources,通常小)。

**已核实健康项**:debugLogs 上限 300 ✓(createAgent.ts:203/304/312,每 stream 重置)、spans 上限 300 ✓(:326)、subagentHistory LRU 20 ✓、vfs protectedRefs 每 stream 整体替换(仅字符串、无累积)✓、loadedSkillTools 同名去重 + setSkills/invalidate 清理 ✓(createChatSdk.ts:1242-1244/1322-1333)、messages focuses 快照小({path,label},随消息数线性但单项常数)✓、sandbox Worker 用完即 terminate ✓(sandbox.ts:84-92)、decide 工具循环硬上限 3 轮×2 次 = 6 invoke ✓(llmResolver.ts:172/241-250)、exportData/importData 为显式用户 API 一次性深拷贝(预期内)✓、offload 阈值自适应(非固定 6000,文档漂移见 P-12)。

## 一句话总评

默认配置每轮固定 CPU 开销整体可控,但存在「全上下文重复扫描 ×2-3 遍」与「大 bind 每次写 6-7 次 O(N) 同步操作」两类可优化热点(均 P2、按需重启),真正用户可感的只有 P-1——压缩 LLM 同步阻塞首 token(触发压缩的长会话 turn 延迟数秒至 ~21s),建议下个发布优先处理。
