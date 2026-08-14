# 已评估暂缓的 Change(Deferred Backlog)

> 本文件记录经评估后**暂缓 / 缩水 / 拆分**的 change 规划。每项含:结论、核心理由(基于代码核实)、重启触发条件、缩水替代方案。
>
> **定位**:这些是「有想法、但当前不该做」的规划沉淀 —— 保留思路、避免规划积压占用「进行中」心智,也避免未来重复构思。原 change 目录(`openspec/changes/<id>/`)不删,作为详细规划底稿;本文件是**汇总索引 + 决策依据**。
>
> **评估日期**:2026-08-01。**评估背景**:8 个 change 全为 2026-07-31 同日规划,经逐项对照代码现状核实(proposal 声称的现状缺陷**全部属实**),核心矛盾是「复杂任务 + 超大 JSON 编排」方向 vs SDK「轻量页面 JSON 操作 Agent」定位。详见会话评估记录。

---

> 🔄 **[2026-08-01 定位升级覆盖 —— 本节以下 5 项全部重启]**
> SDK 定位从「轻量页面 JSON 操作 Agent」升级为「**胜任复杂多组件 + 浏览器内后台自动化的胜任级 Agent SDK**」(见 [`doc/archive/complex-agent-roadmap.md`](../doc/archive/complex-agent-roadmap.md))。**本文件的核心标尺②「不滑向重型编排框架」已被推翻** —— 以下 5 个暂缓提案**全部重启授权**(定位升级即真需求,不再等「重启触发条件」),按设计报告分期落地(Phase 1-4)。
> 下方的「评估原则」与「各项详情」为**旧定位下的历史评估**,保留作决策溯源;每项的**重启状态 + Phase 归属**见下表。重启落地为 `revive-*` / 调整后新 change(基于旧 proposal,非直接 apply —— 旧 proposal 有默认策略 / 依赖绑定 / 已实现部分去重等需调整)。

> 📦 **[2026-08-02 归档]**:以下 5 项的旧 proposal 已移入 `openspec/changes/archive/2026-07-31-*/`(顶部加「📦 已归档(被取代)」标注),作溯源底稿,不再实施。重启落地的新 change 状态(活跃/已归档)见 [`project.md`](./project.md)「进行中」与「最近完成」段。

## 暂缓项一览

> 🔄 定位升级后**重启状态**(旧 ⏸/🟡/❌ 见各详情段历史):

| change | 旧结论 | 🔄 重启状态 | 落地 Phase |
|---|---|---|---|
| observability-structured-tracing | ❌ 缩水 | 🔄 **恢复完整**(TraceSpan 树,非缩水) | Phase 3 |
| add-mission-anchor | ⏸ 暂缓 | 🔄 **重启**(分层默认核心开;capture 争议接受) | Phase 1 |
| add-cross-round-working-memory | ⏸ 暂缓 | 🔄 **重启**(**解绑 C 组** → 独立中间件,只 pin path/hash) | Phase 1 |
| add-structured-todos-and-subagent-writes | ⏸ 暂缓 | 🔄 **重启**(update_todo 已由 adaptive-planning 做;剩余层级 deps + 子agent写) | Phase 2 |
| add-data-paging-and-chunked-write(draft 部分) | 🟡 拆分 | 🔄 **重启 draft**(read 分页已并入 2.17.0;只剩 draft_write/commit) | Phase 2 |

## 评估原则(为什么暂缓)— ⚠️ 旧定位下;标尺②已推翻

> 🔄 **[定位升级覆盖]** 以下原则基于旧「轻量页面 agent」定位。**标尺②「定位契合度——不滑向重型」已被新定位推翻**(新定位就是要胜任重型复杂 + 自动化)。标尺①(真需求驱动)、③(依赖绑定 → 解绑后单独立项)、④(沉没成本)逻辑仍适用,但 ① 的「真需求」已被「定位升级」满足。以下保留作历史溯源,不代表当前决策。

SDK 定位是**框架无关的轻量页面 JSON 操作 Agent**(自研 Deep Agents 风格 harness,刻意规避 LangGraph / langchain 整包)。评估的核心标尺:

1. **真需求驱动 vs 规划完整驱动** —— change 是为解决真实用户场景,还是为「能力矩阵补全」?
2. **定位契合度** —— 是否把 SDK 推向「重型任务编排框架」(违背轻量初衷)?
3. **依赖绑定** —— C 组四件套(mission / working-memory / structured-todos / paging-draft)互相声明依赖,要么一坨做(巨大工作量 + 偏离定位),要么止损暂缓。
4. **沉没成本不构成理由** —— 2.16.0 的 `complex` 预设 + vfs `drafts` 空池已是朝复杂场景的前置投资,但**不构成「必须做下去」的理由**(drafts 空池无害,LRU 就绪)。

## 各项详情

### observability-structured-tracing — ❌ 缩水(TraceSpan 树不做)

**核实现状**:`debugLogs` 是扁平 `{timestamp,type,data,source?}[]`(`createAgent.ts:42`),无 duration / 父子层级;`inspect()`(`types/index.ts:107`)无 trace/metrics 字段。proposal 声称属实。

**暂缓理由**:
- **最明显的过度工程**。TraceSpan 树 + timing + status + `onEvent('trace')` + APM 上报是**后端 agent 框架**(LangGraph / CrewAI)的可观测性需求。
- SDK 用户多为**前端集成开发者**,不是运维 SRE;`debugLogs` 扁平数组 + DebugDrawer 对调试已够用。
- 改动面大(createAgent 各节点采集 span + DebugDrawer 树形渲染 + 类型 + 事件),收益人群窄。

**缩水替代**:若未来确需,只做 `getTraceMetrics(debugLogs)` 纯函数 —— 聚合现有扁平 debugLogs 出「每轮延迟 / 工具成功率 / 重试 / 压缩频次」,不引入 TraceSpan 树、不碰 createAgent 采集、不加 APM 上报。低成本。

**重启触发**:集成方明确提「生产监控 / SLA / 分布式追踪」需求,或自研 agent 规模化后内部需要性能归因。

---

### add-mission-anchor — ⏸ 暂缓(整个 change)

**核实现状**:无任务级目标模型;`compress` 的 `indexSummarize` 截 user 60 字 / assistant 80 字(`contextIndex.ts:50`);recall 锚点是「最新 user」(`useContextManager.ts:149`)。proposal 声称属实。

**暂缓理由**:
- proposal 自己承认「任务主线是 **LLM 自律问题,不是框架 invariant**」。用框架硬约束补偿 LLM 自律,与「轻量」定位有张力。
- **自动 capture 首条任务型 user**靠启发式(非空 / 非问候 / 长度阈值),误判风险高;`send({mission})` 显式传入又把「判断任务目标」的责任推给集成方。
- 这是 **4-Phase 长期路线**(Phase 1 本变更 → todos evidence → drift 检测 → goal verify),单个 change 只能交付开头 —— 启动即承诺一条重型演进线。

**重启触发**:出现 LLM 在长任务中**频繁忘记原始目标 / 压缩后偏离主线**的真实用户反馈(prompt 软约束失效),且 simple prompt 调整无法缓解。重启时只做 Phase 1 最小版(capture + pin 段),不碰 recall / spawn。

---

### add-cross-round-working-memory — ⏸ 暂缓(先做低成本软改进)

**核实现状**:`preserveLastToolResults` 默认 `['describe_data','read']`(`contextPreset.ts:26`),不含 query/search/eval;`lastReadHash` 是 createDataOps 闭包内变量(`dataOps.ts:112`),跨压缩无持久机制。proposal 声称属实。

**暂缓理由**:
- **绑定 C 组**:proposal #3/#4/#5 依赖 `paging` 的 `draft_write`(未实现)+ `mission-anchor` 的 dual-query(暂缓)—— 单独做是半成品。
- **「永不压缩的工作记忆段」本质是另一种 context 占用**,locatedPaths 累积 + notes 自由文本可能膨胀,抵消 summarization 的经济性。
- 引入新 state 字段 + 新中间件 + augmentPrompt 段 + compress 豁免 + recall 改造,复杂度高。

**缩水替代(低成本,可独立做)**:
- 扩 `preserveLastToolResults` 默认到 `['describe_data','read','query_data','search_data']`(proposal #2,软改进,一处配置)—— 覆盖 80% 的「多步检索链断裂」痛点,零结构改动。
- 这条可并入下一个 context 相关 change,不必立项 working-memory。

**重启触发**:扩 preserve 默认后,复杂任务场景下「压缩丢 path/hash」仍是瓶颈(实测 token 浪费显著),再考虑引入 workingMemory state。

---

### add-structured-todos-and-subagent-writes — ⏸ 暂缓(整个 change)

**核实现状**:Todo 仅 `{content, status}`(`state.ts:13`),无 id/deps;`write_todos` 整表替换(`todos.ts:34`),无 update_todo;子 agent 默认只读。proposal 声称属实。

**暂缓理由**:
- C 组里**最重、依赖最多**(弱依赖 mission-anchor)。
- **「子 agent 可写」动了「只读隔离」安全边界** —— writablePaths 白名单 + `PATH_OUT_OF_SCOPE` 校验增加复杂度,且削弱了子 agent「过程隔离、只返回结论」的设计。
- todos 结构化(id/parentId/deps)依赖 **LLM 可靠维护依赖图**,实践中 LLM 维护 deps 的可靠性存疑;evidence 校验 / handoff 强制又是「用框架硬约束补偿 LLM」。
- 内置 `large-json-edit` skill 绑定「超大 JSON」场景(该方向本身待定)。

**重启触发**:子 agent「只读 + 返回结论」成为明确功能瓶颈(有「检索 + 写入需在同一子任务闭环」的真实需求),且 mission-anchor 已落地(todos 对照 mission)。重启时先做「结构化返回 + `update_todo` 单项更新」(低成本),「子 agent 可写」与 evidence / handoff 仍暂缓。

---

### add-data-paging-and-chunked-write — 🟡 拆分(read 分页/eval 做;draft_write/commit 暂缓)

**核实现状**:`read` 仅单路径 + fields/depth,无 offset/limit(`dataOps.ts:511`);query/search 上限 200 无 cursor(`dataOps.ts:368/393`);`write` 无 dryRun;eval 全量深拷贝;`drafts` 池已分池(`vfs.ts:24`)但 `draft_write`/`draft_commit` 未实现。proposal 声称属实。

**拆分决策**:
- ✅ **做**(低成本高价值,可并入 `evolve-default-toolset` 或独立小 change):
  - `read` 增 `offset`/`limit`(大数组分页读)
  - `eval_script` 增 `jsonPath` 子树模式(降大 JSON 成本)
  - query/search cursor(中价值,可选)
- ⏸ **暂缓**(重量级,场景存疑):
  - `draft_write` / `draft_commit` 分块写入协议 —— 针对「超大 JSON 单次 LLM 输出写不完」场景。**页面 Agent 典型 JSON(页面配置 / 低代码 schema)一般几十~几百 KB,单次 write 可扛**,真实瓶颈未验证。`drafts` 池(2.16.0 已分)保持空池占位(LRU 就绪),不构成必须做 draft_write 的理由。

**重启触发**:集成方真实场景出现「单次 write 装不下的超大 JSON 生成」(如生成百级组件页面),且 patch 增量 + eval transform 仍不够用。重启时 drafts 池已有,直接补 draft_write/commit。

---

## 2026-08-03 新增:p2-architecture-refactor 重构子项拆出(等痛点驱动)

> `p2-architecture-refactor` 的 ①(createChatSdk 1787 行拆分)+ ②(createAgent 回归中间件契约)+ ③剩余(read/get_data 合并 + writeSlot 拆)从原 change 拆出暂缓。原 change 已归档(实际完成 ③ 装饰器 + ④ capabilities 注册表 + ⑤ types 防漂移),底稿见 `changes/archive/2026-08-02-p2-architecture-refactor/`。

**拆出理由(基于代码核实)**:
- **纯内部重构,零用户可见价值**:proposal 自述「纯重构零行为变化」—— SDK 当前能用、已发版、全测绿,做完用户无感;价值仅「可维护性」,但**当前无维护痛点驱动**(无「反复改坏 createChatSdk」反馈)。
- **大重构是隐性负债**:1787 行拆 5 文件 + AgentCore mixin / 动 ReAct 主循环做格式守卫中间件化,引入回归概率非零,收益抽象。无痛点驱动的拆分是 over-engineering。
- **② 尤其危险**:为把已工作的 quirk(DSML/wrap_up)塞进契约而动主循环 —— 当前无回归就别动(YAGNI)。

**重启触发(任一)**:
- createChatSdk 出现**反复改坏**真实反馈(多人协作撞车 / 某块反复回归)→ 拆 ①,边界自然清晰
- createAgent 主循环 DSML/format/wrap_up 出现**实际回归 bug**(当前无)→ 做 ② 契约化
- read/get_data 合并或 writeSlot 拆成为**其他改动前置阻塞**(当前独立可用)

**重启底稿**:`changes/archive/2026-08-02-p2-architecture-refactor/proposal.md` 子项 1/2 + tasks.md(行号 + 步骤齐全,直接 apply,无需重新构思)。

**与已完成部分关系**:③ 的 `applyPatchesToBind` 装饰器已消除 patch 应用重复(乐观锁×拦截器×dryRun 三轴 bug 高发区)—— 这是 p2 里**唯一有 bug 驱动的**子项,已做;①② 是纯结构优化,无 bug 驱动,暂缓合理。

---

## 2026-08-08 审查暂缓项(✅ 已全部落地归档;2026-08-11 核对)

> 2026-08-08 全量核实后暂缓的 4 个 change,**现已全部实施归档**,原暂缓评估失效(留痕)。每项底稿见 `archive/`:

| change | 状态 | 归档位置 | 备注 |
|---|---|---|---|
| `placeholder-protected-read-write` | ✅ 已实施 | `archive/2026-08-04-placeholder-protected-read-write/` | freeze/verbatim 强制层 + vfs 第四池;随 `precise-value-protection` skill 分发 |
| `agent-driven-compression` | ✅ 已实施 | `archive/2026-08-04-agent-driven-compression/` | `agentCompression` opt-in capability + decide(6s 超时降级静态) |
| `chatdialog-component-split` | ✅ 核心已实施 / ⏸ demo 残项 | `archive/2026-08-03-chatdialog-component-split/` | chatContext + message 7 原子 + 8 区块 + sections/slot 双机制全落地;**§9 拼装示例 demo deferred**(见下) |
| `context-history-resilience` | ✅ 已归档 | `archive/2026-08-07-context-history-resilience/` | P1+A 收口(recall-and-trim-llm + context-persist-resilience);B 类决策 #2 维持「对话文本」模型 |

### ⏸ chatdialog-component-split §9 拼装示例 demo(唯一残项 deferred)

- **现状**:核心拆分(§1-8/10)已实施并随日常发布上线(`src/core/composables/chatContext.ts` + `components/{ChatHeader,MessageList,QueuedBar,ApprovalBar,ConflictBar,ChatInput,FocusBar}.vue` + `message/*`);仅 `examples/custom-dialog-demo`(sections 关区块 + slot 替换 + L2 自建根组件)+ 配套 `tests/browser/custom-dialog.spec.ts` 未做。
- **暂缓理由**:纯 UI 拼装示例,无功能价值(可拼装原子组件库的集成方需求未出现);核心能力(chatContext 导出 + 8 区块 + slot/sections)已就绪,集成方可按 `doc/usage-guide.md` 自行拼装。
- **重启触发**:集成方真实要求自建 ChatDialog 子组件 / 多套皮肤换肤,或需要官方拼装参考。重启时底稿齐全(`archive/2026-08-03-chatdialog-component-split/tasks.md` §9)。

---

## 2026-08-11 audit-sdk-integrity P2 登记(分组 + 触发条件)

> 来源:`archive/2026-08-10-audit-sdk-integrity/audit-report.md` §三(61 条按域压缩)+ 二审 N4 + A 专项 A-5 = 主表口径 **P2×64**;证据链(file:line)见归档 change 的 `streams/` 目录。
> 登记约定(二审 §7.3 拍板):每项标注**触发概率 + 复现条件**,防 deferred 成冷宫。
> 状态标记:⏸ 暂缓(触发条件未达)/ 🔁 已被后续修复部分覆盖(注明残留)/ ✅ 已收口(后续修复或构造性失效,留痕不再处理)。
>
> ⚠️ **计数口径更正**:审计报告组 6 注把 1 项未编号 P1 级缺陷(DebugDrawer 日志列表生成期间不刷新)计入「P1 总数 27」,但 2.38.1-2.41.0 各 fix 批次均未覆盖 —— 见下方「P1 残留」段。编号 P1-1..27 全部清零的结论不受影响。

### ✅ P1 残留(1 项 —— 已修,**随 v2.41.1 发布**)

| 项 | 位置 | 触发概率 / 复现条件 |
|---|---|---|
| ✅ **DebugDrawer 日志列表生成期间不刷新**(审计组 6 未编号项;shallowRef 同引用下传 prop)—— **v2.41.1 已发布**:mountChatDialog prop 改 `debugLogsRef.value.slice()` 每次渲染新引用(MAX_DEBUG_LOGS=300 拷贝成本可忽略)+ customize-demo headless computed 同款修复 + page-demo/customize-demo browser 断言各 1(抽屉保持打开,生成后 .log-item 增加) | mountChatDialog.ts × DebugDrawer.vue `logs` computed | 【高·用户可感】生成中打开调试抽屉:日志列表冻结在打开时刻(createAgent push 有 triggerRef,但 prop 数组引用不变 → 子组件不重渲染;抽屉首次打开时 computed 求值一次后缓存) |

### ✅ 已收口(2 项,留痕不处理)

| 项 | 结论 |
|---|---|
| **N1 同轮/并发多写乐观锁连环冲突**(二审 11.4) | 2.40.0 已修(Q4 并入 fix-main-sub-isolation:per-scope 基线 + 契约锁定「同 scope 连续写永不冲突」+ 回归测试) |
| **预声明链 depth 不透传**(主×子域,原注「P0 修复后将激活需同步修」) | 2.38.2 构造性失效:装配期 `buildChildTools` 源头排除全部 `use_*`/`spawn_*` 保留工具 → 子 agent 拿不到委派工具,递归物理不可达,depth 链无法激活 |

### 循环/终止面(6 项)

1. ⏸ **工具错误回灌无重复检测**(H17 证实;审计标注「建议优先修」)——【中】LLM 反复以同参重试同工具(schema 误解/前置不满足)烧满 maxToolRounds(~10 轮)token 才 wrap-up;复现:mock LLM 在工具返回 SCHEMA_INVALID 后连续回同参调用。有 wrap-up 收口(非破坏),危害=token 浪费。方向:近错指纹(tool+参数哈希+错误码)连续相同 → 提前换策略提示/终止。
2. ⏸ wrap-up 收口 filter 掉全部 SystemMessage,与 P0-1 修复(排除框架工具保留 SystemMessage)语义矛盾 ——【低】读码级;wrap-up 轮消息过滤丢 system 上下文。
3. ⏸ send-invoke 吞掉 SYSTEM_PROMPT_OVER_BUDGET 等 error 事件 ——【低】需 systemPrompt 超预算 + 走 send(invoke)路径;onEvent('error') 不触发(stream 路径正常外发)。
4. ⏸ 被拒写入(SCHEMA_INVALID)也退出 planning 重置预算 ——【中】需 planning 开启 + 首次写即校验失败;规划阶段被提前退出(应仅写成功才退出)。复现:planning + write 传违反 schema 的值。
5. ⏸ planPhaseRounds 按模型调用计数且跨 send 残留 ——【低-中】planning 开启多 send 场景:计数不清零,第二个 send 提前触顶回灌「停止调研」。
6. ⏸ isRetryable 把无 status 错误(含 ContextOverflowError)当网络错空烧重试 ——【低】构造无 status 的 Error → 2 次无效重试;与 severity 路由正交。

### 挂起面(5 项)

1. ⏸ 冲突挂起无超时 + 子引发冲突无归属 ——【超时侧系设计:D-2 拍板有响应方无限等;残留=归属 + headless 无监听者】子 agent 触发冲突 → pendingConflict 无 main/sub 来源标注;headless 集成方不 watch pendingConflict 则工具永挂。复现:子 writablePaths 写 + 期间外部改 bind。
2. ⏸ setData 轮中调用 → autoLock 静默放行(H24 证实)——【低】动态 schema 场景:setData 清基线 → 未 read 直接写(autoLock 无基线 = 跳过锁校验直写)。语义上「无基线=无冲突」系设计内静默;方向:文档说明或首次写 warn。
3. ⏸ trim LLM 增强 unmount 后无取消,仍写已销毁 store ——【低】需 trim 异步窗口(≤15s)内 unmount;fire-and-forget 无 abort/销毁守卫。
4. ⏸ fire-and-forget persist 无 catch = unhandled rejection 根因 ——【中-低】任何 persist 失败即触发(browser teardown `connection is closing` 即此);console unhandled rejection 噪声 + 无可见性。一行 .catch + debugLogs 留痕。
5. ⏸ dispose 不关 IDB 连接 ——【低】仅影响 deleteDatabase/版本升级场景(连接未关 → blocked)。

### 主×子(7 项;另 1 项已收口见上)

1. ⏸ 子写入共享快照栈无归属(父 restore 可回退子成果)——【低】需子写入(writablePaths)+ 父 restore_data;快照栈共享 controller 闭包,无 caller 标注。复现:子 write → 父 restore_data → 子成果一并回退。
2. ⏸ 进程内多 agent 并发写同一 bind 零冲突检测 ——【低】两 sdk 实例(不同 id、同一 bind 对象)并发写 → 后写覆盖;2.41 core 级串行闸管的是同 core 消息层,跨实例 bind 层未覆盖。
3. ⏸ use_<id> 并发事件 taskId 混组 ——【低-中】同一预声明子 agent 被并发委派两次 → 事件 taskId 同为 `use_<id>`,UI 步数分组混组(观察层 observeId 已唯一,事件 taskId 为兼容 UI 分组有意保留)。
4. ⏸ allowedTools 可授 eval_script 绕 guard ——【低】需集成方显式 `allowedTools:['eval_script']` → 子经 transform 改写任意路径(eval fork 不走 writablePaths 检查)。显式配置=集成方意图;方向:文档警示 + dev 模式 warn。
5. ⏸ SUB_WRITE_TOOLS 含 draft_commit 但不含 draft_write(subagent.ts)——【低】需 capabilities.draftWrite + 子 writablePaths;2.38.2 vfs-bridge 后子共享主 vfs,子可 commit 主草稿但自己无法建草稿,语义不完整。方向:补 draft_write 或移除死条目。
6. 🔁 focus × html 包叠加误伤 ——【低】2.38.2 已豁免 vfs_write/vfs_edit(工作区路径非数据 scope);残留=子写 focus 子树外的 data codeRef/元信息仍触 PATH_DENIED(focus strict × writablePaths 交集未定义)。复现:聚焦 components.3 + 委派 use_html 写根级 codeRef。
7. ⏸ skill 附带工具每次 load_skill 重求值 + 全量 rebind ——【中-低】凡用 skill.tools 工厂皆触发:每轮工具工厂重求值 + 全工具池 rebind,长任务性能浪费。方向:工厂结果缓存(内容指纹为键)。

### 数据写链(7 项)

1. ⏸ write({}) 配 resources 触发 TypeError 非结构化错误 ——【低】LLM 传空参 + data.resources 配置时;应为结构化错误码。
2. ⏸ merge op 非对象 value 静默假成功 ——【中-低】LLM 对 merge 传非对象(误解字段类型)→ no-op 返回「已 edit」成功,数据完整性风险。方向:类型校验 + 结构化错误。
3. ⏸ eval 子树(jsonPath 模式)缺 isUnsafePath ——【低】eval_script({jsonPath:'__proto__…'});加固项(与 P3「read jsonPaths 缺 isUnsafePath」同型)。
4. ⏸ interceptors 仅守高层 read/write,advanced 底层全绕过 ——【中】需集成方依赖 interceptors 做脱敏/审计 + toolMode:'advanced' → set_data/edit_data/delete_data 直调不过拦截器。方向:底层也接入,或文档明示「advanced 底层工具绕过 interceptors」让集成方知情。
5. ⏸ eval transform fork 写链未共用 commitSetToBind ——【低】读码级:eval transform 整体替换回写链与 write(set) 在个别校验项口径分叉(commitSetToBind 抽离时的遗漏分支)。
6. ⏸ **hashValue 双算冗余 + A3 惰性 hash 未做**(H3 证实;审计 A 专项评「推后清单里最值得做的一项」)——【必然】每次 autoLock 写 3-4 次全量 hash + deepClone×2,几百 KB bind 单次小 patch ≈ 6-7 次 O(N)。方向:脏标记惰性 hash 或轮内基线缓存。
7. ⏸ checkpoint restore 不重置 dataOps 乐观锁基线 → 误 VERSION_CONFLICT ——【中-低】checkpoint:true + restore_last_checkpoint + 随后 autoLock 写:基线仍是 restore 前 read 的 hash,与 restore 后 bind 不匹配 → 误冲突(2.40 per-scope 基线不清此路径;仅 setData/替换 bind 清)。复现:read → write → restore → write(autoLock)。

### 上下文(7 项)

1. ⏸ setLlm 后显式 options.contextWindow 陈旧覆盖新模型声明 ——【低】需创建时显式传 contextWindow + setLlm 切不同窗口模型:压缩阈值仍按旧显式值。(A4 复核「setModelCaps 回灌」已修自动检测路径,残留仅显式 override 优先级语义。)
2. ⏸ setProtectedRefs 仅 stream 入口注入(send/batch/子绕过)——【低】需 invoke 路径 + offload 大结果 + trim/LRU 淘汰同时发生 → 被引用 large_results 可能被淘汰,vfs_read 404。
3. ⏸ **单条巨型 user 消息三层裁剪全不可裁 → 会话卡死**(H27 证实)——【低但会话级破坏】用户粘贴超窗内容 → 溢出 fatal → 巨型消息留 messages,每次 send 重蹈。方向:fatal 时标记/隔离该消息,或提供移除 API。
4. ⏸ 累积摘要只增不减 ——【必然但慢】超长会话【更早累积摘要】段线性增长,百轮级场景才成瓶颈。
5. ⏸ preserve 块截 120 字丢 offload 路径引用 ——【低】需 preserve 工具结果 >120 字且 vfs 路径在尾部 + 压缩触发 → LLM 失回读路径。方向:vfs 路径引用正则豁免截断。
6. ⏸ estimateTokens 三处口径不一 ——【必然但无害】三处估算口径差 ±10%,仅影响阈值边界决策;统一为卫生项(联动性能域 #1)。
7. ⏸ agentCompression windowRatio 极端值空转 ——【低】decide 返回 windowRatio≈0(schema 0-1 合法极端值)→ 压缩预算≈0 空转一轮。方向:下界 clamp。

### 持久化(8 项)

1. ⏸ setMission({}) 清空不落盘 → 刷新复活 ——【低-中】storage 开 + 显式清空 mission + 刷新:persist 侧非空守卫反向作用,清空意图未落盘。复现:setMission(goal) → setMission({}) → 刷新 → 旧 mission 恢复。
2. ⏸ applySnapshot 对 messages/todos/wm 无结构校验 ——【低】需存储数据损坏/手工篡改/跨版本结构演进;运行时抛错而非优雅降级。VM 维度种子(见审计 §11.5)。
3. ⏸ draft 碎片无 TTL 跨刷新残留(H5 部分证实)——【中-低】任何 draft_write 未完成 + 刷新;有 drafts 池 2MB LRU 兜底无无限增长;残留=draftId 复用干扰。方向:启动清孤儿草稿或 TTL。
4. ⏸ quota/evicted/degraded 全静默 ——【中】存储配额超限/后端降级(Safari 隐私模式、IDB 满)即触发;集成方无感知以为已持久化。方向:onEvent 或 debugLogs 留痕。
5. ⏸ 多标签页同会话分叉(定性)——【低】同 agentId+sessionId 双开标签并发写 → 后写胜,消息分叉。手动验证项(审计 §八.3)。
6. ⏸ hydrate 合并非替换 → vfs_rm 删的种子文件复活 ——【低】vfs_rm 删内置种子文件 + 刷新 → hydrate 合并种子使其复活。方向:删除标记或替换语义。
7. 🔁 switchSession 补 persist 不含 messages/todos ——【低】2.27 补 persist(mission/wm)+ 2.41 core 级串行闸已覆盖主场景;残留=流式进行中未 afterRound 即 switch 理论上丢最后一轮(runSerial 串行已大幅收窄)。
8. ⏸ enforceLimit O(文件数²)——【必然但仅文件数多时敏感】vfs 数百文件场景的 LRU 淘汰扫描复杂度。

### 目标漂移(5 项)

1. ⏸ **mission 一次锚定无完成检测**(H1 证实)——【中】长任务场景:首条任务消息锚定后永不更新,任务完成后陈旧锚 + pin 文案「请继续围绕…」反向加压。方向:完成检测启发式或 usageHints 强化「完成即 setMission({})」引导(D1 专项)。
2. ⏸ **纯查询任务永不退出 planning + 回灌「去 write」错误引导**(H2 证实)——【中】多步调研任务(usageHints 已豁免简单查值类,缺口在多步调研):planPhaseRounds 触顶后回灌文案引导 LLM 去 write。方向:调研类退出条件或文案修正。
3. ⏸ PIN_SEGMENT_NAMES 缺 focus/resourcesPin ——【低触发,触发时影响重】systemPrompt 超 25% 窗口触发 drop 时:focus 段丢=范围收敛失效、resources 段丢=受保护资源引导丢。方向:纳入永不 drop 集合(与 base/mission/workingMemory 同级)。
4. ⏸ recall 与 mission 无交叉校验 ——【低】理论缺口:recall 锚点是最新 user 而非 mission,互不校验。
5. ⏸ 默认形态重于定位(D4)—— 非代码 bug:默认 13 项 opt-out 能力 + ~24 工具 + usageHints ~3.5-4K token/轮(均有逃生舱)。方向:定位表述校准 + e2e 锁定默认工具数基线防膨胀。

### 性能(5 项)

1. ⏸ estimateTokens 每模型轮 ≥2-3 遍全上下文扫描 + CJK regex 分配压力 ——【必然,大上下文敏感】联动上下文域 #6;方向:单轮单次扫描结果共享。
2. ⏸ checkpoint messages 每轮整体 clone(H14 证实)——【必然】checkpoint:true + 长会话:栈深 5 = 5× 全历史深拷贝;Phase B(messages 增量)未实施。
3. ⏸ persistRuntime 每轮全历史 JSON round-trip ——【必然】storage 开 + 长会话;方向:增量 persist(脏标记,同 checkpoint Phase B 思路)。
4. ⏸ tracker steps 无 run 上限 ——【极低】受子轮数天然约束(H8 证实有界,每 step ~80B),降级关注。
5. ⏸ eval 子树超时档判定走 stringify ——【必然但成本小】eval jsonPath 子树模式以 stringify 判体积档;方向:先估后精确。

### UI(6 项)

1. 🔁 UI 流式路径绕串行闸 ——【低】2.41 部分覆盖:core.stream 纳入 activeControllers 注册表 + send/batch 经 core.runSerial;残留=并发 stream 互斥(UI useChat 层自带串行队列兜底,headless 编程式并发双流无闸)。
2. ✅ reset() 不等幽灵流收口 → 双流 —— 2.41 已解:resetSession 入口 abortAllActive() + trackActive/finally 收口;abort 异步取消理论窗口极窄。
3. ⏸ 退出动画期间再 mount → cs-leaving 残留透明不可交互 ——【低】unmount 后 320ms 动画窗口内再 mount;新挂载未清旧 class。复现:快速 toggle mount/unmount。
4. ⏸ 排队任务丢 focuses 快照 ——【低】需聚焦 + 消息入排队 + 排队消费前焦点变化;快照时机语义未定义(入队 vs 执行)。
5. ⏸ MessageList 无虚拟化 + 每 delta 全列表 diff ——【中】长对话 100+ 条消息可感;2.41 markdown 节流已解 O(n²) 渲染大头,残留为列表层 diff/虚拟化。
6. ⏸ decodeURIComponent 无 try/catch(畸形 data-code 丢工具栏)——【低】代码块内容含畸形 % 序列 → 代码工具栏丢失(非崩溃)。

### 安全(3 项)

1. ⏸ **沙箱原型链逃逸残留(S1)**——【低,纵深防御已就位】`(function(){}).constructor` 原型链可达 Function → 任意代码执行,但 `lockSandboxGlobal` 锁死全部外发通道(fetch/XHR/WebSocket/importScripts/sendBeacon/EventSource/BroadcastChannel/indexedDB/Worker)→ 数据发不出,危害受控(二审 §11.3 论证链)。浏览器实测待做(审计 §八.1;Node 无 Worker 不可测)。**升级触发**:集成方 CSP 放宽 / 新增侧信道 / 沙箱引入网络回包。
2. ⏸ domTool href/src 值敏感参数不扫描 ——【低】get_dom(opt-in)返回 href 可能含 OAuth token query 参数 + LLM 转述外发。同型:P3 envTool 输出完整 href/window.name 可读。
3. ✅ glob 单星跨段匹配(permissions)——【已修】audit-five-dimensions P1-2 升级修复:`globToRegex` 单星 `[^/]*`→`[^.]*`(对齐 scope 的 `.` 分隔,不跨段;permissions.ts),随 3.0.0 发布。

### 测试盲区(T,8 项)

1. 🔁 e2e FAKE_LLM 不跑循环,系统性退化为装配反射层 —— 2.39-2.41 已持续补 StubChatModel 真 ReAct 模块(hang-feedback/main-sub-isolation/session-integrity 等);残留:多数模块仍是装配断言。长期方向=核心模块 stub 驱动化。
2. ⏸ 冲突介入闭环三层 UI 无运行时覆盖 —— 需 browser 层冲突条三选一 spec(pendingConflict UI 流程;complex-demo 已覆盖 freeze 保护)。
3. ⏸ 观察层(createSubagentTracker)无集成断言 —— start/pushStep/finish + history LRU 行为仅装配级断言(2.38)。
4. ⏸ agentCompression decide 接线零测试 —— 现有 agent-compression e2e 覆盖开关/inspect 反射;decide 两段式工具循环 → compress 决策应用流程无 e2e。
5. ⏸ trim 异步增强 + context_trimmed 事件零断言 —— recall-and-trim-llm / context-persist-resilience 功能级缺口。
6. ⏸ focus 子 agent 运行态继承零断言 —— initialFocuses 继承路径仅逻辑层 selftest。
7. 🔁 use_<id> 委派执行零覆盖 —— 2.40 main-sub-isolation e2e 已覆盖 spawn/per-scope 基线;预声明 use_<id> 委派真执行覆盖仍薄。
8. ⏸ 新事件类型 payload 断言缺失 —— events e2e 覆盖 hook 机制;context_trimmed/APPROVAL_AUTO_REJECTED/session_restored 等新事件 payload 形状无断言。

### 补充项(二审/A 专项,2 项)

1. ⏸ **N4 reactive 深度代理对大 bind 的开销未量化**——【必然但未量化】几百 K bind 系目标场景:深度 reactive 追踪 + read 返回值二次代理化(toRaw?)未核实。需 profiling 后定级;若占每轮时间预算显著(>10%)升 P1。
2. ⏸ A-5 headless 构建 assetFileNames 把任意 css 映射 style.css ——【极低】当前 headless 子树无 css import;将来出现会覆盖主包 UI css 产物。防御:headless vite config assetFileNames 命名空间化。

### P3 备查(不逐条登记)

P3×33 以文档漂移(多处已随审计直接修正)/ 代码卫生 / 测试 / 流程项为主,留 `archive/2026-08-10-audit-sdk-integrity/audit-report.md` §四。其中 **N2 审计事件完备性**(write/draft/eval 是否产 audit 条目 + agent 归属)与 **N3 配置非法值无防御**(CO 维度种子:contextPreset:'unknown'/maxToolRounds:-1 等)有未来专项价值,特此标注。

---

## 2026-08-11 audit-five-dimensions P2/P3 登记(五维二审,分组 + 触发条件)

> 来源:`archive/2026-08-11-audit-five-dimensions/audit-report.md` §四(P2×25 / P3×16,按维度分组)。基线 2.38.0,二审五维(CA/SE/VM/RE/CO)补审六专项外盲区。**真 P1×4 已修**(随各版本,均含 3.0.0):P1-1 并发写注释(createAgent `maxParallelTools` warn)/ P1-2 glob `[^/]*`→`[^.]*`(permissions,见上安全#3 ✅)/ P1-3 WorkingMemory restore 字段守卫 / P1-4 maxToolRounds clamp。§五「不动项」:VM-F1(版本号,架构改进演进时做)/ CO-preset(JS spread 语义,文档警示)。
> 状态标记同上(⏸/🔁/✅)。证据链 file:line 见各归档 `audit-<DIM>.md`。

### SE 加固组(P2×8)

1. ⏸ DOMPurify 链接缺 rel=noopener ——【低】`a[target=_blank]` 无 rel → 反向 tabnabbing;DOMPurify hook 补 rel。
2. ⏸ inspect_env 泄漏 location.search ——【低】URL query 含敏感参进 LLM 上下文;脱敏。
3. ⏸ eval_script jsonPath 缺显式 PATH_UNSAFE ——【低】`eval_script({jsonPath:'__proto__…'})`;加 isUnsafePath 校验。
4. ⏸ query_data 缺 isUnsafePath ——【低】同型 jsonPath 注入面。
5. ⏸ lockSandboxGlobal 失败无留痕 ——【低】锁失败静默(sandbox 已锁外发,残留=可见性);debugLogs 留痕。
6. ⏸ DebugDrawer 脱敏不全 ——【低】debug 输出含敏感字段;redact 加固。
7. ⏸ CodePreview sandbox 收紧 ——【低】iframe sandbox 配置加固。
8. ⏸ proxyLlm direct 默认反转 ——【低】proxyLlm direct 模式默认开 → 改显式 opt-in。

### VM 迁移组(P2×6,含降级 F1)

1. ⏸ 无版本号机制(F1,**§五不动项·架构改进**)——【低】setData 换 schema / 跨版本 hydrate 无版本校验;各中间件 ad-hoc 归一化,演进时系统化。演进触发。
2. ⏸ checkpoint 跨 schema 校验(F3)——【低】setData 换 schema 后旧 checkpoint restore 可能不兼容;校验 + 降级。
3. ⏸ Todo id 稳定标识(F4)——【低】Todo 按 index 生成 id,重排后 id 变;稳定标识。
4. ⏸ capabilities 关闭 emit restore_skipped(F5)——【低】关 capability 后无 restore_skipped 事件;集成方不知。
5. ⏸ VfsFile 字段归一化(F6)——【低】持久化 VfsFile 跨版本字段漂移;归一化。
6. ⏸ AgentMessage 字段归一化(F7)——【低】同型,消息字段归一化。

### CO fail-fast 组(P2×7,含降级 preset)

1. ⏸ storage 未知 backend warn ——【低】storage 传未知值;warn + 降级。
2. ⏸ allowedTools 错名 warn ——【低】allowedTools 含不存在的工具名;warn。
3. ⏸ temperature 范围校验 ——【低】temperature 越界(<0/>2);warn + clamp。
4. ⏸ maxDepth:0 语义 ——【低】maxDepth:0 含义不明(禁 spawn?);文档/校验。
5. ⏸ writablePaths:[] 语义 ——【低】空数组含义;warn 或文档。
6. ⏸ capabilities 矛盾组合 warn 对齐 ——【低】矛盾组合(如 dataOps:false + resources)对齐 warn。
7. ⏸ preset 对象整体替换文档警示(**§五不动项·JS spread 语义**)——【低】preset 整体替换是 JS 语言语义;文档警示非 SDK 缺陷。

### CA 并发组(P2×2)

1. ⏸ activeScope 并发错乱 ——【低-中】`maxParallelTools>1` 同轮并发工具共享 activeScope 闭包 → dataOps scope 错乱;方向:AsyncLocalStorage / per-call token。与 P1-1 同根(并发边界)。
2. ⏸ createSubagentsMiddleware 闭包单变量并发(M3 同型)——【中·已知】currentSignal/currentEmit/currentLogSink 闭包单变量,`maxParallelTools>1` 并发 wrapToolCall 互相覆盖 → 子 agent 继承无关工具的 signal/emit。默认串行(`maxParallelTools=1`)规避;彻底修需 spawn 工具从 ToolCallContext 取值。

### RE fire-and-forget 组(P2×2)

1. ⏸ autoTitle LLM 无 unmount 守卫 ——【低】autoTitle 异步 LLM 调用,unmount 后仍执行;无 abort/销毁守卫。与 deferred 挂起面 #3(trim LLM)同型。
2. 🔁 persistRuntime void store.save 无 .catch ——【中-低】与 deferred 挂起面 #4 合并(persist 失败 unhandled rejection);一行 .catch + debugLogs。

### P3×16(各维卫生,详见各 audit-<DIM>.md)

P3×16 以代码卫生 / 文档漂移 / 测试覆盖为主,留归档 `audit-<DIM>.md`(不逐条登记)。其中 **VM 迁移系统性**(版本号 + 字段归一化)与 **CO 配置矩阵覆盖**(capabilities 组合 / 数值边界)有专项价值,特此标注。

---

### [2026-08-14] html 子 agent per-component 持久上下文 — ⏸ 暂缓

**来源**:html-agent-thinking-taming 规划时评估(per-component 上下文保有 + sessionStorage 持久化,避免反复改同一组件时上下文丢失)。

**核心理由(暂缓)**:
- 治的是「记忆/连续性」(长周期精修),不是「过度思考」(thinking-taming 主题)。先把思考治好(①②③)再谈记忆。
- 当前每次 use_html 全新上下文是**故意防污染**;代码现状已由 vfs + data.code 保有(vfs_read 可见),丢的只是前次"对话/思考"。
- 恢复的前次上下文**含纠结过程**(撕边穷举的方案对比),①②③ 未治好前持久化它 = 持久化纠结,可能适得其反。
- ①task 规格化后 task 自带规格,子 agent 需"前次对话"的场景大减 —— 多数情况 vfs_read + task 已够。
- 复杂度高:runSubagent 按 __pgId 路由持久上下文 + sessionStorage 序列化 + 上下文膨胀/压缩 + 刷新后一致性(__pgId/sessionId/vfs 重建)。

**重启触发条件**:①②③ 验证后,"反复精修同一组件、修改间有依赖"仍是真痛点(非 vfs_read + task 可覆盖)。

**缩水替代**:①task 规格化(主 agent 每次给完整规格)+ vfs_read 现状,覆盖多数"跨委派连续性"需求。

---

## 维护约定

- 暂缓项**不进** `project.md`「进行中的 change」(避免占心智);本文件是唯一索引。
- 🔄 **定位升级后**(2026-08-01):5 项全部重启授权,分期落地(见 `doc/archive/complex-agent-roadmap.md` + 上方覆盖块)。重启以 `revive-*` / 调整后新 change 推进(不直接 apply 旧 proposal —— 默认策略 / 依赖绑定 / 已实现部分需调整);旧详情段保留作"当初为何暂缓"的溯源,不删。
- 原 change 目录保留(proposal / design / tasks 不删),作为详细底稿;各 proposal.md 顶部已加 `⏸ 已评估暂缓` 标注块指向本文件。
- **重启某项时**:从本文件移除 → 立项进 `project.md`「进行中」→ 按正常 OpenSpec 流程推进(先修行号 + apply)。
- 本文件随评估持续维护;新增暂缓项追加到表尾。
