# D 专项目标漂移审计(goal-drift)

> 审计代理:audit-sdk-integrity / D 专项(goal-drift)
> 基线版本:2.38.0(2026-08-10)
> 范围:src/core/harness/{mission,todos,workingMemory,focus,usageHints}.ts、src/core/sdk/promptBuilder.ts、src/core/sdk/createChatSdk.ts 默认 systemPrompt 段;联动 createAgent.ts / capabilities.ts / useContextManager.ts / checkpoint.ts / mountChatDialog.ts / useChat.ts / toolsets.ts / dataOps.ts / vfs.ts / skills.ts / subagent.ts
> 依据:openspec/changes/2026-08-10-audit-sdk-integrity/design.md §0 与 §3(D1-D4)

---

## Findings(严重度降序)

| # | 严重度 | 类别 | file:line | 结论 | 证据 | 修复建议 | 测试补建议 |
|---|---|---|---|---|---|---|---|
| D1-2 | P1 | goal-drift | src/core/sdk/createChatSdk.ts:1549-1550 | storage 未开(默认关)时 `resetSession` 整体 early return,UI「清空对话」不清 mission/workingMemory/focus/todos,违背同处 docstring(:1546-1548「重置内存态 vfs/todos/memory/mission/workingMemory/...」)承诺 | `if (!store) return` 为首句(:1550);清空按钮链路 ChatHeader.vue:115 → useChat.ts:270-272 `clearMessages`(仅 splice messages)→ mountChatDialog.ts:53 `onClear: () => core.resetSession()`;清完后旧 mission 仍每轮注入「## 当前主线目标」 | !store 分支降级执行:splice messages + vfsStore.clear + 各 pin 中间件 reset,仅跳过 store.createSession | e2e 补「storage:false 下 resetSession 清空 mission/workingMemory/focus/todos」 |
| D1-1 | P2 | goal-drift | src/core/harness/mission.ts:29-42,63-66,75 | mission 一次捕获锚定全会话,无完成检测;同会话任务 B 沿用任务 A 陈旧锚 | `captureFromMessages` 取**首条**任务型命中即 return(:33-38);beforeAgent 仅 `!mission && !explicitlyCleared` 才捕获(:63),捕获后永短路;全文件无 afterAgent/完成检测钩子;收口仅 `setMission({})`(:79-84)/`send({mission})`(createChatSdk.ts:1420)/会话切换;pin 文案「(每步操作应服务此目标;偏离时回到主线)」(:75)对新任务反向加压 | 自动 capture 的 mission(非 explicit)遇更新的任务型 user 消息时重锚,或至少 usageHints 注入「用户开启新任务时提示更新/清空 mission」 | selftest mission 模块补「第二任务消息不更新 mission」+「多任务会话 pin 段陈旧」断言 |
| D2-1 | P2 | goal-drift | src/core/harness/todos.ts:18,103-105,134-135,191-194 | 纯调研/问答任务进入 planning 后永不退出:退出条件仅主数据写工具成功;触顶回灌「停止调研/修订…(用 write/set_data/edit_data 落地)」对无物可写的查询任务是错误引导 | `PLAN_EXIT_TOOLS` 仅 write/set_data/edit_data/delete_data(:18,exit 判定 :191-194);read/query/search/eval(query) 不在退出集(:17 注释明示 eval 不列入);usageHints.ts:46 仅豁免「查值」简单任务,多步调研(「分析/对比/整理」均为捕获动词,mission.ts:17)仍可被 usageHints.ts:47「复杂任务→write_todos」引入规划 | 退出条件补「update_todo 全 completed 即退出」;触顶文案分流(「若为查询/分析任务,直接给出答案即完成」);usageHints 增「纯查询/调研任务答完即完成,无需 write」 | selftest todos 模块补纯查询场景:计数到限回灌文案断言 + 全 completed 退出 |
| D2-2 | P2 | loop | src/core/harness/todos.ts:172-175;src/core/harness/createAgent.ts:7,635 | `planPhaseRounds` 按**模型调用**计数而非用户轮:一轮调研(read→query→search→read)即耗掉 5 轮预算大部;且 `inPlanning` 跨 send 持续 → 纯查询会话污染下一任务规划预算 | beforeModel 在 ReAct 内层每次 model call 执行(createAgent.ts:7 循环结构 `while(rounds<max){ beforeModel → wrapModelCall…}`、:635 注释);todos.ts:174 每次 beforeModel `planPhaseRounds++`;todos.ts 无 afterAgent/beforeReturn 重置(仅 :191 写成功 / :198 reset) | 改 beforeAgent(用户轮粒度)计数或文档明示口径;send 边界对「上一 send 未调规划工具」的残留 inPlanning 归零 | selftest 断言「单 send 多次 model call 按次消耗预算」+「跨 send 不残留 inPlanning」 |
| D3-1 | P2 | goal-drift | src/core/harness/createAgent.ts:370,388-398 | 系统段预算 drop 的 pin 保护集仅 `{'mission','workingMemory'}`——focus 与 resourcesPin 段超预算(>窗口 25%)时被静默 drop,与 CLAUDE.md/design D3「四组 pin 段」口径不符;drop 后 focus 写拦截仍生效(wrapToolCall)但 LLM 丢失目标/视野段,资源丢失占位符语义提示 | :370 `PIN_SEGMENT_NAMES`;:391 非 pin 段从大到小 drop(focus 子树 schema 段常较大先中);mission.ts:9-11 / workingMemory.ts:12-13 / focus.ts:9-10 / resourcesPin.ts:1-9 均自称跨压缩 pin | `PIN_SEGMENT_NAMES` 增 `'focus'`/`'resourcesPin'`(或文档明确此二段非预算 pin) | selftest buildSystemPrompt 预算 drop 用例断言四段全保 |
| D4-1 | P2 | goal-drift | src/core/capabilities.ts:38-51;src/core/tools/dataOps.ts:112-118;src/core/harness/usageHints.ts:44-118 | 默认形态显著重于「最小 JSON 操作 agent」定位(详见下方 D4 评估);toolMode=simple 只收敛 dataOps 内部 13 个底层工具,其余 17 个内置工具不受 toolMode 管辖 | 见下方「D4 定性评估」证据链 | 不强改;README 定位表述校准 + 提供「纯数据操作」推荐配置(capabilities 关单)+ e2e 锁定默认工具数基线防继续静默膨胀 | e2e 断言默认 caps 下工具总数与清单快照 |
| D3-2 | P3 | correctness | src/core/harness/checkpoint.ts:210-211;src/core/sdk/createChatSdk.ts:2226 | checkpoint restore 只回滚 messages/bind/vfs/todos,不回滚 mission/workingMemory/focus:回滚后 pin 的 hash 相对回滚后 bind 陈旧,LLM 复用 pin hash 写易触发 VERSION_CONFLICT(有冲突机制兜底但噪声);focus path 不重新校验 | checkpoint.ts restore 仅 `deps.todosMw.reset`(:211),deps 无 mission/wm/focus | restore 后 `workingMemoryMw.reset()`(至少清 lastHashes) | selftest checkpoint × workingMemory 交互用例 |
| D3-3 | P3 | goal-drift | src/core/composables/useContextManager.ts:184-192,209-211 | recall 召回与现行 mission 无交叉校验:关键词命中可把已废弃任务的旧轮摘要带回「【与当前问题可能相关的早期对话】」,与 mission pin 并存时存在目标拉扯(mission 恒在可压住,概率低) | `recallRounds(older, query, recallTopK)` 只看 query 关键词(:184),不感知 mission.sourceMessageIdx | deferred;低成本可在召回段加注「(早期历史,以当前主线目标为准)」 | contextIndex recall 单测补矛盾场景 |

---

## H1/H2 结论

### H1:证实

mission 只 capture 首条任务型 user → 同会话第二个任务沿用旧目标,无完成清理。

- capture 条件代码:mission.ts:20-25 `shouldCapture`(≥8 字/非问候/≤2000 字/含 CAPTURE_VERBS 任务动词 :17)→ mission.ts:28-42 `captureFromMessages` 遍历 messages 取**首条**命中的 user 消息即返回(goal 截断 200 字,:34)
- 一次性门控:mission.ts:60-66 beforeAgent 仅 `!mission && !explicitlyCleared` 时才调 captureFromMessages;一旦捕获,mission 恒 truthy,后续 send 永不重捕、永不更新
- 完成检测:**无**(全文件无 afterAgent/beforeReturn 钩子,无状态机)
- 收口路径清点:仅 ① `setMission({})`(mission.ts:79-84,置 explicitlyCleared 防重捕)② `send(text,{mission})` 显式覆盖(createChatSdk.ts:1420)③ switchSession(:1528)/resetSession(:1555)会话级 reset(后者默认配置下因 !store early return 失效,见 D1-2)
- usageHints 无任何「新任务时更新 mission」引导;pin 段文案「(每步操作应服务此目标;偏离时回到主线)」(:75)反向强化旧锚

### H2:证实(部分)

maxPlanRevisions 退出依赖写工具 → 纯查询任务被错误回灌「停止调研去执行」——机制证实,但存在一处软缓解。

- 退出条件:todos.ts:18 `PLAN_EXIT_TOOLS = {write, set_data, edit_data, delete_data}`,仅写工具**成功**退出(:191-194);read/query/search/eval_script 均不退出(:17 注释明示 eval 语义混合不列入)
- 触顶回灌文案:write_todos 超限返回「规划阶段已达上限(N 轮)。停止调研/修订,基于当前清单开始执行(用 write/set_data/edit_data 落地)」(:104);update_todo 同型(:135)——对纯查询任务无物可「落地」,构成错误引导
- 缓解(部分证伪面):usageHints.ts:46「简单/明确任务(改单字段、调样式、查值)→ 直接 read/write 执行,不必 write_todos」——「查值」类简单查询已被引导不进规划;缺口在多步调研类查询(「分析/对比/整理」等)
- 放大因素:计数口径为模型调用而非用户轮(D2-2),且回灌只在再次调用 write_todos/update_todo 时出现——纯查询若不再碰规划工具,只看到计数静默增长与 `inspect().planPhase` 永久 inPlanning,连错误引导都不触发,纯污染

---

## D3 核实结论(跨压缩锚点)

四组锚点(mission/workingMemory/focus/resources)确在 state/中间件闭包、经 augmentPrompt 每轮重建(createAgent.ts:375-404 buildSystemPrompt 每次 model call 现拼,toLC :404 注入 SystemMessage),**不进 messages 数组,compressInput 只压 messages → 跨压缩承诺机制层成立**。

旁路清理/失效路径(除 resetSession 外):
1. **系统段预算 drop**(D3-1):>25% 窗口时 focus/resourcesPin 段可被 drop(createAgent.ts:370 pin 集不含二者)
2. **resetSession 无 storage 时全 no-op**(D1-2):默认配置下「清空对话」不清任何 pin 状态
3. **checkpoint restore 不回滚**(D3-2):回滚 bind 后 workingMemory pin hash 陈旧
4. recall 召回旧轮与现行 mission 无校验(D3-3,低危)

switchSession(:1528-1530)与 applySnapshot(:1352-1364)的恢复/替换路径核查无异常(switchSession 先 reset 再灌快照;focus 逐 path 校验剔除失效项)。

---

## D4 定性评估(定位与默认成本)

**默认开启能力 13 项**(capabilities.ts:38-51,opt-out `defaultOn:true`):dataOps / fetch / planning / missionAnchor / workingMemory / focus / skills / vfs / summarization / memory / subagent / inspectEnv / contextInspector;另 8 项 opt-in(verify/domInspect/draftWrite/tracing/todoDeps/skillHostScript/automation/agentCompression)。

**默认 system prompt 构成段**(初始态、传 data、无用户 options):
- 固定 3 段:base(DEFAULT_SYSTEM_PROMPT ≈240 字符,promptBuilder.ts:17-23)+ dataHint(「可操作数据」+ schema hint,schema 规模相关)+ **usageHints ≈3038 字符 ≈ 3.5-4K tokens**(usageHints.ts:44-118,planning 7 行 + dataOps simple 6 长行 + subagent 1 + inspectEnv 1 + humanConfirm 7 行 + function-calling 警示头;按 estimateTokens cjk×1.5 口径,modelCaps.ts:95-100)
- 运行态条件叠加:mission pin(capture 后)/ workingMemory pin(捕获后)/ todos 段(write_todos 后)/ skills 索引(仅 skills 非空,skills.ts:120-127)/ memory(仅配置)/ focus + 子树 schema(仅聚焦)/ resourcesPin(仅配 resources)/ subagents 索引(仅预声明)

**默认工具池 ≈24 个**(simple toolMode、传 data、未配 checkpoint/approval/subagents/resources):
- data simple 7(read/write/query_data/search_data/eval_script/restore_data/history_data;dataOps.ts:112 SIMPLE_HIDDEN 藏 13 个底层工具)
- fetch_document 1 + inspect_env 1
- write_todos/update_todo 2 + load_skill 1(**skills 空列表也挂载**,createChatSdk.ts:1231-1254 + skills.ts:311)
- vfs 9(vfs_read/write/edit/ls/glob/grep/json_read/json_patch/rm,vfs.ts:280-509)
- spawn_agent/spawn_agents 2(subagent.ts:419,默认开 createChatSdk.ts:1064-1067)
- request_human_confirmation 1(默认开,createChatSdk.ts:918-921)

**漂移程度:中度、可控**。相对「最小 JSON 操作 agent」(read/write 2 工具,minimal 模式存在):默认 ≈12× 工具数 + 每轮固定 ~4K tokens usageHints + 13 项 opt-out 能力的认知成本;环境探查/子 agent/文档抓取/规划/人工确认均默认开。batteries-included 本身非错,风险在定位表述与默认形态脱节 + 默认面仍在继续膨胀(2.36-2.38 连续加能力)。**不下死结论**;建议:README 定位表述校准、提供「纯数据操作」推荐配置、e2e 锁定默认工具数/prompt 段基线防静默膨胀。逃生舱齐全(minimal toolMode / 13 个 opt-out 开关 / presets.minimal)。

---

## 一句话总评

SDK 防漂移机制「pin 段跨压缩」在机制层成立但保护不全(focus/resourcesPin 可被预算 drop),mission 与 planning 两个生命周期锚均缺「完成即退出」收口(陈旧锚 + 纯查询死计数 + 默认配置下清空对话不清锚),且默认能力面已明显重于「规范化 JSON 操作 agent」定位——漂移风险真实存在,但全部有逃生舱,属设计缺口而非实现损坏。
