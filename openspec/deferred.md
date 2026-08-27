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
| observability-structured-tracing | ❌ 缩水 | ✅ **已结案(4.1.0 移除)**:重启落地后经 config-surface-pruning round2 审计撤除(维护者确认外部零使用;debugLogs + exportDiagnostics 已覆盖运行态观察) | Phase 3 |
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

### observability-structured-tracing — ❌ 缩水(TraceSpan 树不做)【✅ 已结案:曾重启落地,4.1.0 随 config-surface-pruning round2 移除;本段为历史溯源】

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

1. ⏸ **工具错误回灌无重复检测**(H17 证实;审计标注「建议优先修」)——【中】LLM 反复以同参重试同工具(schema 误解/前置不满足)烧满 maxToolRounds(~10 轮)token 才 wrap-up;复现:mock LLM 在工具返回 SCHEMA_INVALID 后连续回同参调用。有 wrap-up 收口(非破坏),危害=token 浪费。方向:近错指纹(tool+参数哈希+错误码)连续相同 → 提前换策略提示/终止。**→ 2026-08-23 并入 [`2026-08-23-tool-call-economy`](./changes/2026-08-23-tool-call-economy/) C2 统一设计(同病灶两面:报错后瞎猜 = 错误即向导治,报错后死磕 = 本项治),随其实施收口。**
2. ✅ wrap-up 收口 filter 掉全部 SystemMessage ——【已修销账 2026-08-26:E2 修复后 createAgent wrap-up 保留中部 SystemMessage(createAgent.ts:1151-1153),team-audit-hardening 主循环审查核实】
3. ✅ send-invoke 吞掉 SYSTEM_PROMPT_OVER_BUDGET 等 error 事件 ——【已修销账 2026-08-26:makeStreamWatch(F1,createChatSdk.ts:1657-1663)全量转发 send 路径流内事件,e2e events.mjs 有断言;team-audit-hardening 主循环审查核实】
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

1. ✅ write({}) 配 resources 触发 TypeError 非结构化错误 ——【已修实测销账 2026-08-26:现返回结构化 `SCHEMA_INVALID` 错误码 + hint,不抛异常(team-audit-hardening 审查期 tsx 直调验证)】
2. ✅ merge op 非对象 value 静默假成功 ——【已修实测销账 2026-08-26:现返回结构化 `PATCH_FAILED`("merge 目标不是对象")且 bind 未动(team-audit-hardening 审查期 tsx 直调验证)】
3. ⏸ eval 子树(jsonPath 模式)缺 isUnsafePath ——【低】eval_script({jsonPath:'__proto__…'});加固项(与 P3「read jsonPaths 缺 isUnsafePath」同型)。
4. ⏸ interceptors 仅守高层 read/write,advanced 底层全绕过 ——【中】需集成方依赖 interceptors 做脱敏/审计 + toolMode:'advanced' → set_data/edit_data/delete_data 直调不过拦截器。方向:底层也接入,或文档明示「advanced 底层工具绕过 interceptors」让集成方知情。
5. ⏸ eval transform fork 写链未共用 commitSetToBind ——【低】读码级:eval transform 整体替换回写链与 write(set) 在个别校验项口径分叉(commitSetToBind 抽离时的遗漏分支)。
6. ✅ **hashValue 双算冗余 + A3 惰性 hash 未做**(H3 证实;审计 A 专项评「推后清单里最值得做的一项」)——【必然】每次 autoLock 写 3-4 次全量 hash + deepClone×2,几百 KB bind 单次小 patch ≈ 6-7 次 O(N)。**已修(`write-path-cost-reduction`,2026-08-17 实施待发布)**:同调用 hash 单算(commitBaseline)+ codeAsset 改前态单拷贝(beforeBind 复用为快照条目);bench 实测 1MB 单写 median -12%/-19%、290KB -11%/-22%;「脏标记惰性 hash/轮内缓存」方向**显式否决并固化为不变量**(人工直改 reactive bind 不经 SDK 写路径,脏标记失明 → keep_external 保护失效,M4 实证)—— 注释 + change spec 双固化。
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

### CA 并发组(P2×2)—— ✅ 已修(ca-concurrency-per-call-context,2026-08-14)

1. ✅ activeScope 并发错乱 —— 已修:per-call scope token(`RunnableConfig.configurable.__pgDataScope`,wrapWithScope 注入 + dataOps `scopeOf(config)` 优先取,ambient 兜底);AsyncLocalStorage 浏览器不可用,args 注入通道被 zod 重建阻断,configurable 是唯一干净通道。
2. ✅ createSubagentsMiddleware 闭包单变量并发(M3 同型)—— 已修:wrapToolCall 注入 `ctx.callConfig.__pgSubagentCall`(signal/emit/logSink)→ coreExecTool 经 configurable 透传到 spawn/use_<id> 工具 fn 第二参;闭包单变量降 fallback。

### RE fire-and-forget 组(P2×2)—— ✅ 已修(2026-08-16,稳定性小修包)

1. ✅ autoTitle LLM 无 unmount 守卫 —— 已修:迟到守卫(`core.refCount > 0 && core.sessionId === 快照` 才写,LLM 在途 unmount/切会话后放弃)+ try/catch 吞错。
2. ✅ persistRuntime void store.save 无 .catch —— 已修:`persistSave`/`persistUpdateTitle` 统一吞错出口(全文件 11 处 fire-and-forget 收敛)+ refreshSessions 内部吞错。e2e 回归锁:storage.mjs 两场景(setItem 抛错零 unhandledRejection + autoTitle 迟到守卫)。

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

### [2026-08-15] 后台 agent 模式(use_<id> 异步化) — ⏸ 暂缓

**来源**:`parallel-subagent-delegation` proposal 决策 1/⑤。「主 agent 发出委派后不等结果继续跑后续轮次,稍后收割」= task handle + 收割工具,需改 ReAct 循环核心(工具结果异步注入后续轮)。同轮并行(maxParallelTools>1 + 同轮多 use_<id>)已把子 agent 等待重叠化(墙钟 = max 而非 sum),拿到大部分收益;后台模式增量收益仅限「子 agent 跑数分钟 + 主 agent 还有长链独立工作」场景。**重启触发**:同轮并行落地后实测仍有「子 agent 长任务阻塞主链路」痛点。

### [2026-08-15] 宏操作工具层(易错多步流程流水化) — ⏸ 暂缓(待证据积累)

**来源**:parallel change 讨论中用户提出「多步骤操作/一次性多任务/易错场景抽离成流水式操作工具,减少 agent 编排复杂流程」。

**已有部分覆盖**:patch op `move`(3.8,调序/层级移动一步原子,正是真 LLM 实测出的易错多步场景流水化首例)/ `patches` 原子批(任一失败回滚)/ `spawn_agents` 批量并行 / `sdk.batch` 自动化批 / presets 场景化身份 / skills 反复查询。

**规划草图**(重启时按此立项):
- **宏操作 = 纯函数 transform,底层复用 patch 引擎**:每个宏(如 swap 两组件 / move_into 容器 / clone 组件 / batch_set_props)编译成 patches 序列,一次工具调用原子执行 —— 天然继承快照栈/乐观锁/schema 白名单/回滚,零新写链
- **准入判据(证据驱动,move op 同款)**:真 LLM 回归中某多步编排 ≥2 次出错(调序用 3 patches 错索引/层级移动漏删顶层等)才提炼宏;不做预想式宏集
- **挂载形态**:工具描述内嵌"何时用宏 vs 手排 patches"引导(实测教训:工具 schema 反向引导强于 system prompt);业务特有流水(如"建节庆页脚手架")归集成方 defineTool/preset,不进 SDK 核心
- **收益边界**:宏减少的是 LLM 组织步骤数(轮次↓/错误面↓),不减少语义判断(改什么仍 LLM 决策)—— 与「减少 agent 编排复杂度」目标正对

**重启触发**:parallel change 落地后的真 LLM 回归再出现多步编排错误(调序/层级/批量属性),或集成方反馈高频自定义流水。


### [2026-08-15] 上下文经济性 mid-turn 想法四项 — ⏸ 暂缓(未立项部分)

**来源**:3.10.x 迭代期间用户 mid-turn 提出;其中「单轮 token 提示/上限」「重复计数提醒」已立项进 `context-economy-phase2` 阶段 C,余四项评估后暂缓:

1. **提示词分级按需切换**(复杂设计 vs 简单流程 skill/限制):先看 context-economy-phase2 落地效果(softCap + 自感知提示);编排纪律(新建直接委派)已覆盖主要浪费源,分级切换的认知成本(集成方选档)可能高于收益。**重启触发**:复测 S1 后 flash 仍调研过重。
2. **主 agent json 走 vfs 维护**(避免整体占上下文):已有大结果外存 + read 分页/裁剪/多路径 + `<code Nkb>` 摘要四层缓解;主 bind 直改 reactive 是响应式命脉,整体搬 vfs 动摇零桥接架构。**重启触发**:softCap 后主 agent 消息累积仍是大头且非工具结果类。
3. **skill/mcp/tools 按需共享给子 agent**:规范 skill 双挂模式已覆盖主场景;通用按需共享需 spawn 期动态授权面审计(安全面扩大)。**重启触发**:真实集成出现「子 agent 需要主 agent 持有的 skill 且双挂不够」的案例。
4. **maxMemoryRounds 默认 30 下调**:OOM 层与 prompt 成本正交(trimMemoryMessages 与 summarization 独立);softCap 已从成本侧解决。**重启触发**:小窗口模型(<128K)实测内存压力。


### [2026-08-16] 复审(rv-arch/rv-code/rv-sec)残余项 — ⏸ 暂缓

**来源**:team-review-hardening 落地后的三路复审。已修:数组重排 __pgId 内容匹配回填(rv-code)/ 沙箱 __proto__·Reflect 补检(rv-sec)/ MCP 守卫竞态时序 e2e 锁定(rv-sec,验证为非问题)/ fetchDoc CSRF 文档提醒(rv-sec B1)。以下登记:

1. **MCP 守卫 vs 用户 setTools 同名的边界语义**:集成方 setTools 覆盖内置工具是 2.23.0 显式设计(后注册覆盖 + collisions warn);MCP 侧守卫注入时现场构建不受影响。**触发**:若未来出现「集成方工具面也被恶意注入」的威胁模型再收紧。
2. **inspect_env 深度脱敏增强**(rv-sec P2):Map/Set 形态 / value 启发式检测(sk-xxx 形态)。核心路径已覆盖,边缘场景收益低误伤高。
3. **proxyLlm throwOnDirectInProduction 默认开**(rv-sec P2):行为变更,现默认 warn(向后兼容);文档已提示。
4. **沙箱 Symbol.for/bind 变体**(rv-sec 提及,核实为伪风险):Symbol.for 取不到已锁函数;/bind( 常见于合法脚本误伤大。留档理由防重复排查。
5. **并行写 beforeBind 快照交错**(rv-code,理论):默认串行无触发;并行写丢更新本就是已文档化已知限制(见 2026-08-15 审查暂缓项 #8)。
6. **beforeBind 深拷贝成本优化**(rv-code 建议:浅拷贝):codeAsset 场景每写一次 deepClone;大 bind 下可评估按 pgIdPaths 局部拷贝。**触发**:大 schema 性能实测出现瓶颈。

### [2026-08-16] 第二轮三路审查(rv-core)QUESTION 项 — ⏸ 暂缓(设计语义待裁决)

**来源**:round2-review-hardening 修复批之外的 3 条 QUESTION(详见 `openspec/changes/2026-08-16-round2-review-hardening/proposal.md` C 段)。

1. **组件锁 none 分支并发写缝**(rv-core F4):task 文本 0/≥2 命中组件名 → 不锁 → 同轮并发主写 components.N.code 与 codeAsset commit 无检测交错(recomputeBaseline 后 hash 匹配 → 静默覆盖)。**重启触发**:并行委派真 LLM 回归出现「子 agent 刚 commit 的 code 被主写覆盖」实例;修法候选:none 分支也按命中集加弱锁(仅锁 code 子树)或编排 prompt 强化。
2. **系统段预算 PIN 段口径**(rv-core F7):25% 预算 drop 的 PIN_SEGMENT_NAMES 仅 mission/workingMemory,不含 focus/resourcesPin —— 焦点提示段可被 drop 而 strict 强制仍生效(三层收敛退化为一层,烧轮次自纠)。**重启触发**:真 LLM 回归出现「聚焦场景超预算丢提示 → 反复 PATH_DENIED」实例;修法:两键并入 PIN_SEGMENT_NAMES(行为变更,需评估 token 成本)。
3. **spawn 自授 writablePaths 绕过组件锁**(rv-core F8):spawn_agent({writablePaths:['components']}) 子 agent 直写不经 componentLock/codeAsset checkout-commit,可与在途 use_<id> 委派并发覆盖。**重启触发**:编排 spawn+writablePaths 混用场景出现覆盖实例;修法候选:装配期拒与 codeAsset 前缀交集或同锁。

### [2026-08-16] 工具 schema 描述语言国际化 — ⏸ 暂缓(dialog-i18n Phase 2 裁剪)

**来源**:`2026-08-16-dialog-i18n-phase2` proposal 非目标段。`dialog.locale:'en-US'` 已覆盖 UI 文案 + 默认 systemPrompt(英文版身份 + reliableWriteRulesEn);但 usageHints 中间件注入的工具用法提示与 ~14 个内置工具的 schema description 仍是中文。LLM 对中文工具描述理解无碍(实测多模型正常 tool-calling),全量双化是 ~14 工具 × (description + 参数 describe + usageHints 教学段) 的大工程且增加维护双份漂移风险。**重启触发**:海外集成方实际反馈 agent 输出/理解语言异常,或英文场景真 LLM 回归出现工具误用实例。修法候选:工具描述集中注册表 + locale 键化(同 messages 模式)。


### [2026-08-17] 流停滞看门狗「代理黑洞」盲区 — ✅ 已修([Unreleased] stream-max-duration:总时长上限兜底)

**来源**:3.24.0 后 modes 套件补跑,一日 6 次「llm_request 发出后无响应、无 StreamStalledError、logN 冻结」(经 vite 代理 → modelverse)。**模式:黑洞恒落在同轮第 3 条并发 SSE 流**(M3 多次运行:3 并行委派 → 前两个完成 → 第三个流永久挂死;单流场景 M1/M4 稳定)。启动闸(createAgent.ts:529-543)与 chunk 间隔看门狗均未触发 —— 假设:上游返回 200+SSE 头后以 keepalive/空帧无限空转,每帧重置 chunk 间隔计时但无实质内容(看门狗量的是 chunk 间隔,非单次调用总时长)。

**[2026-08-17 直连鉴别实验:根因定性完成,vite 代理假说证伪]** `.env` 直配绝对 URL(`https://api.modelverse.cn/v1`,SDK 默认 stripStainlessFetch 剥遥测头,直连 CORS 通)绕开 vite 代理跑 M3:**黑洞依旧、同位**(3 并发流,前两条正常完成,最后一条 logN 冻结 417s+ 至超时,无 StreamStalledError)。黑洞活动期三个鉴别实验:① 同 key 全新非流式请求 **1.5s 正常返回** → per-key 并发饱和排除;② 同 key 全新 SSE 流**秒级正常出 chunk** → 客户端/网络/key 流式能力排除;③ 前两条并发流正常完成 → 非「第 3 条被排队」(槽位释放后也不恢复)。**定性:modelverse 中转站在并发流场景下的单请求级死亡** —— 200+SSE 头已发、该请求正文永不送达、连接被维持(keepalive 空转持续重置 SDK 间隔看门狗)。上游不可修;SDK 侧唯一可动作 = 快速失败 + 上层自愈(重委派实测可恢复,M4 同款)。**✅ 已修([Unreleased] stream-max-duration)**:`withStallTimeout` 增 `maxMs` 绝对截止(不随 chunk 重置),新配置 `streamMaxDurationMs`(默认 600s,0 关)→ `StreamMaxDurationError`(继承 StreamStalledError 408 不重试,stage `stream_max_duration` 归因);selftest sec-69 +10(黑洞复现形状/继承语义/辨析/边界)。备选修法「空内容 chunk 不重置计时器」未采用:合法空 delta(长 prefill 期 ping)会误伤,总时长上限更鲁棒。M3 墙钟量化断言继续 blocked(上游环境),但「同轮 3 并行 + 时间窗重叠」已在本 run 采样实证(active:3 持续 ~2min)。关联:`memory/real-llm-suite-env-instability.md`。

## 2026-08-18 会话收尾登记(3.27.0 发布过程暴露,暂缓 + 触发条件)

| 项 | 现状 | 触发条件 |
|---|---|---|
| DebugDrawer 日志 tab `tool_result` 模板分支可达性存疑 | IDE ts-plugin 报 narrowed union(`"error"\|"middleware"`)与 `"tool_result"` 无重叠 → 疑似死分支或前置 v-if 顺序吞掉了类型;功能表现正常(日志渲染无异常),行号随编辑漂移(556→585) | 下次动 DebugDrawer 日志 tab 时核实:死分支删除或调整 v-if 窄化顺序;顺手补一条类型层断言 |
| `types/index.d.ts` 手动维护漂移防再发 | 3.27 又发现 `DialogIcons.send`(3.20 引入)漏标(连同 `DialogConfig.sections`);`tests/types.test-d.ts` 字段级 Pick 断言未覆盖 DialogIcons/DialogConfig 键集 → 符号级门禁抓不到键缺失 | 下次 types 漂移再现或 4.0 大版本时:把 DialogIcons/DialogConfig 键集纳入字段级断言(与 capabilities 17 开关 Pick 断言同模式) |
| editor_fangzhou focus 联动(画布选中 → AI 聚焦) | ✅ 已接入(2026-08-18,随 editor 升 3.27.0):`select.one`(载荷=组件 id)→ `getComponentInfo` 查相对根 jsonPath → `sdk.setFocus({path, label})`;`select.noOne` → `clearFocus`;同批修 walkComponents 路径 bug(旧 'root.' 前缀致 select_component 传 null)、补 list_components/save_page 工具注册、`nodeInfo.replace` → setData 换树重绑 | —(已收口留痕) |

### [2026-08-18] codeAsset `forEachCodeItem` 嵌套遍历盲区 — ⏸ 暂缓(数据无损,机制失跟;等嵌套移动真需求)

**来源**:用户问询「代码组件移动到另一层级数组(如 `container.children`)能否无损」核实结论。`write` op `move` 结构搬运本身无损(节点含 `__pgId`/`__pgNotes` 整体随行,findStrippedKeys 对 move 位移有深度相等匹配防误判),但 `codeAssetMiddleware.forEachCodeItem`(src/core/sdk/codeAssetMiddleware.ts:112-128)**只扫 writablePaths 数组的直接元素,不递归嵌套数组** —— 代码组件一旦移进嵌套容器(如 `components.N.props.children`):checkout/afterAgent commit/组件代码文件地图/焦点守卫(`focusPathsToPgIds` 同遍历口径)全部「看不见」该组件 → 后续 `use_html` 委派无法同步其 vfs 工作副本(data.code 停在移动前内容,vfs 编辑回流不到新位置)。组件锁 `collectComponentNames` 同源,锁目标集也漏。**重启触发**:集成方(editor_fangzhou 类)实际出现「把 custom 组件拖进容器 children」需求或事故。修法候选:`forEachCodeItem` 改按 schema 深遍历(z.lazy 递归路径展开)或 writablePaths 支持多路径声明(`['components', 'components.*.props.children']` 通配);同步修 `focusPathsToPgIds`/`collectComponentNames`/文件地图同口径。

### [2026-08-20] restore_data 快照整对象校验株连(与 path-scoped-validation 同根因)— ⏸ 暂缓

**来源**:path-scoped-validation(path-scoped-validation change 实施期登记)。`restore_data` 的 `SNAPSHOT_SCHEMA_INVALID`(dataOps.ts restoreData 工具)对快照值做**当前 schema 的整对象校验** —— editor 若回退含 `script:""` 脏数据的历史快照会与 write 路径同样株连挂死。本 change 只动了写路径(set/patches/merge/append/move/eval/draft),快照回退路径未动(非目标明示)。**重启触发**:editor 实测回退失败案例出现。修法:快照是「历史既有数据」(非 agent 本次写入),回退校验可直接放开或降级 warning 留痕 —— 与写路径「只校验写入内容」哲学一致。

### [2026-08-20] 3b「方案征询不机制化」残留风险登记(save-and-plan-gates Phase 3)— ⏸ 暂缓(预期永不触发)

**来源**:save-and-plan-gates 3b 结论落定。「是否属方案类任务」是语义判断,机制做不了(不造伪机制);防线拆解 = 删除 approval 恒在 + save_page 确认(3a 已实施)+ bulk-change-guard(后续 change)+ 提示词。**重启触发**:实测出现「不征询直接删且绕过 approval」案例 —— 预期永不触发(approval 是硬门禁);若真出现说明 approval 链路被绕过,属 P0 缺陷而非本项设计缺陷。



### [2026-08-22] 流式响应体为错误 JSON 时聚合 null message 崩溃(stream 零 chunk 路径)— ✅ 已修(f31702a,当日收口)

**来源**:editor-local-draft-restore Phase 3 真 LLM 验收(editor 本地 dev + Playwright)。LLM 网关(user-bff-api 代理)返回 **HTTP 200 + 错误 JSON 体**(`{"error_code":6003,...}`,非 SSE)时,流聚合出 null message → `createAgent` 循环层读 `message.tool_calls` 直接 `TypeError: Cannot read properties of null` **未捕获崩溃**(legacy 包 55408 行),未走三档错误模型/重试/observable。与已修的 stream 启动闸(响应头假死)同族不同路径:**响应头已到、body 非事件流、零 chunk 即 end** —— 流停滞看门狗(90s)来不及触发就先崩了。**重启触发**:任何网关/中转层返回 200+JSON 错误体的环境(editor 生产网关 6003 形态实测存在);或下次动 streamer/聚合层时顺手修。修法候选:流结束后校验聚合 message 非空,空/null → 构造 recoverable 错误回灌自纠(或按 body 可解析 JSON 判网关错误归因),禁止裸访问 tool_calls。

## 2026-08-23 stale-read-invalidation 归档登记(数据驱动 fast-follow 决策点)

### [2026-08-23] 委派写失效(v1.5 候选)— ⏸ 暂缓(明示盲区,等数据)

**来源**:[`2026-08-21-stale-read-invalidation`](./changes/archive/2026-08-21-stale-read-invalidation/) 归档时的明示盲区。当前失效面只覆盖 SDK 写工具(write/edit/set/patches 族);**委派写(use_html 子 agent commit 直改 bind)与集成方/宿主直改不在失效面** —— 主 agent 在委派前读过的旧值,委派写完后仍是原文。v1 立项时评审裁定不纳入(委派写路径的 path 归属需按 `writablePaths` + `__pgId` 反解,复杂度独立成期)。**重启触发**:editor 真实会话出现「委派完成后主 agent 引用委派前旧值答非所问」的实际案例,或 v1.5 立项时。**候选方案**:commit 钩子按 `__pgId` → vfs 路径反解,对主历史打同款失效占位。

### [2026-08-23] root 读新鲜骨架(读占位的下一层)— ⏸ 暂缓(等 thrash 数据)

**来源**:同上 change。失效占位当前「钉原读路径引窄读」;若实测模型把窄读做成了整树重读(thrash 超标),下一层是给占位附**新鲜骨架**(path → 类型/子键名列表,不含值),让模型无需重读即可安全引用结构。**重启触发**:thrash 观测数据(写后 re-read 率)超标;2026-08-23 验收实测写后零 re-read(引用 write 结果),未触发。

### [2026-08-23] jsonPaths 行级重写(失效占位体积优化)— ⏸ 暂缓(先验证再决定)

**来源**:同上 change。多路径 read 的失效占位目前整段替换;若占位本身体积可观(几十路径 × 多行),可降为**行级**重写(只动被击中 path 的行)。**重启触发**:诊断日志里 stale 占位条目实测 > 数 KB 常态出现。单行 JSON 结构机械安全,但需先有体积压力数据。

### [2026-08-23] review-agent(干净上下文评审 agent,B of completion-audit-reviewer)— ⏸ 暂缓(等一个真实案例)

**来源**:`2026-08-23-evidence-audit-gate`(原 completion-audit-reviewer)三方评审拆分:B 残项独立留档。**裁决依据**(必要性评审):靶子「写偏了但 schema 全绿、任务意图未达成」在 CHANGELOG 与全部归档条目中**零实测案例**(近亲 3.34 拾取误解/3.35 问句误路由均为无 todos 单指令场景,意图误路由类,B 的成本闸 todos≥2 根本不覆盖);对 editor 是每任务持续税(12 组件任务 12 todos 全命中);收口点「fail 后撤回已见回复」的翻案语义是门禁族从未有过的新形状。本项目每层门禁立项都有实测事故压着(3.35/3.40.0/3.40.3/3.42),不让 B 成为第一个破例。

**底稿**(设计完整,重启即取):收口点起全新上下文评审 subagent —— 只注入 mission + 本次用户消息原文 + todos(criteria)+ fact-sheet(机器事实非转述);只读工具(read/query_data/search_data/history_data)可抽查原始数据;收口强制经 `submit_review` 工具(zod verdict:`{verdict:'pass'|'fail', items:[{todoId?, criterion, expected, actual, evidencePath, pass}]}`);仅 fail 项 + evidencePath 锚点回流主 agent;预算 ≤2 超限放行;`capabilities.review` opt-in + `review:{llm?, minTodos?, timeoutMs?}`(主 flash + 评审 pro 推荐,独立模型避同类盲区);debugLogs `stage:'review_gate'` + `inspect().review`。

**重启须知(机制评审挖出的坑,重启时必读)**:
1. **组装五件套是真工作量**:`runSubagent` 是 subagent.ts 模块私有未导出 —— signal 继承(主 invoke abort 时评审子流要跟着断,否则继续烧 token 读已 swap 数据)/ `__pgDataScope` 包裹(评审者用主池 read 直读 bind 会污染主 scope 乐观锁基线,P1-13 语义)/ tracker 注册(手搓 createAgent 不会有 `inspect().subagent.history` 条目)/ usage 回传 / temperature 0(config 路径);建议直接导出复用 runSubagent 而非逐项复刻
2. **无 verdict(含 garbled/超时)→ 放行 + observable `REVIEW_NO_VERDICT`**,不判 fail(否则主 agent 替评审者失职受罚,回灌无真实 evidencePath 可执行);「强制 submit_review」用评审栈自带 beforeReturn 中间件(扫 messages 判 tool_calls 是否出现,无则 feedback 回灌,评审 createAgent `maxVerifyAttempts ≥ 1` —— 注意 garbled 收口会绕过 beforeReturn)
3. **timeoutMs 缺省应为有限值(60-120s)**,不对齐 opt-in 的 subagent.timeoutMs(评审同步阻塞主收口,理论挂起可达几十分钟)
4. **定位 = adversarial 的结构化升级**(verify.ts:254-284 已是干净上下文只读评审先例:独立 createAgent + refute 姿态 + 只读工具;真缺口 = 审「产出 vs todos 意图」而非回复文本 + 结构化 verdict 替代 `无问题` 正则 + 挂收口点而非 verify check 后)—— 顺带修 adversarial 自己的组装洞(见 1)
5. 触发条件补问号豁免(agent 中途向用户征询不该烧评审);与 evidence-audit-gate 的 A 是互补层(A 落地后观察触发率数据再判 B)
6. wrap-up 旁路(轮次耗尽强制收口不走 beforeReturn)对 B 同样失明,proposal 需明示

**重启触发**:editor 生产出现「schema/校验全绿但任务意图未达成、且非意图误路由类」的用户反馈(真实案例 ≥1);或 evidence-audit-gate A 运行数据显示谎报率高到本地判定不够。

### [2026-08-23] query_data 多 expr(C3 of tool-call-economy)— ✅ 已实施(tool-surface-economy W1,2026-08-27)

**来源**:`2026-08-23-tool-call-economy` 评审裁决:query→read 配对率无任何数据支持,最可能白做的一项。**重启须知**(回归面评审):复活时必须同步扩 `readInvalidation.ts` `readReadPaths` 的 expr 通道(现只认字符串 `expr`,C3 加 `exprs` 数组后走旧逻辑 → 空 expr 按 ROOT 定界 → 写后过度失效/漏失效)+ workingMemory.ts:96 的 query 路径捕获;结果分组返回单项失败不整批(照 read jsonPaths 先例)。【✅ 2026-08-27 随 tool-surface-economy W1 实施收口:`queries: string[2..10]`(与 expr 互斥、同传按 queries、逐条与单次输出同构、单条失败不整批);readInvalidation extractReadPaths queries 逐条前缀并集(重启须知第 1 条兑现);workingMemory 侧经实施前勘察证伪 —— query 捕获本就不生效(expr 非 args.jsonPath、JSON 结果无 `@ ` 前缀),零联动;selftest sec-21/sec-99 + e2e data-slots 锁定】

### [2026-08-23] C1 read 结构预告(tool-call-economy)— ⏸ 暂缓(数据不支持)

**来源**:`2026-08-23-tool-call-economy` Phase 0 挖掘裁决(mining-report.md):读→读邻接 11.1%、同 path 重复读 0、root 读 40% 是新会话首查需要 —— 探路二连读浪费信号不成立,骨架行的 token 反向风险不划算。**重启触发**:后续真 LLM 数据显示探路式二连读显著(如新集成方 schema 复杂交错场景)。**重启须知(评审红线已沉淀)**:骨架行严禁 `hash=` 字样(workingMemory 首匹配提取会吃脏值);必须从投影后的值计算(freeze/verbatim 占位符、`<code Nkb>` 摘要之后 —— 安全面);offload 外存大结果骨架须在预览头部存活;验收带 S1/S5 prompt token ±15% 反向门禁。

### [2026-08-24] 200+错误体非 SSE 的模型下线识别(model-offline-guidance)— ⏸ 暂缓(行为改动违零副作用)

**来源**:`2026-08-23-model-offline-guidance` 实施时明示盲区:网关回 200 + 错误 JSON 体(modelverse 6003 黑洞形态)时 body 不捕获,统一转 `EmptyLLMResponseError`(自动重试 1 次后抛)——该形态下的 `model is offline` 文案检测抓不到,`MODEL_UNAVAILABLE` 码不生效。**为何暂缓**:覆盖需新增 body 捕获 = 流解析行为改动(违零副作用红线),须与 `streamMaxDurationMs`/空转黑洞族一起设计。**重启触发**:真实环境再现「200+错误体且含下线文案」的可复现样本。**重启须知**:`EmptyLLMResponseError` 携带原始 body 摘要(不改变重试语义),`isModelUnavailableError` 对 body 文案复检。

### [2026-08-24] section-orchestrator:真 LLM initialPage 双臂 + 阈值标定 — ✅ 已验证结案(2026-08-26,deepseek v4 flash 直连)

**来源**:section-orchestrator Phase 0/1 真人 LLM 门禁未跑 —— LLM 网关模型面不可用。**验证**:`tests/runtime/section-orchestrator-real-llm.mjs`(双臂 fixture `tests/runtime/fixtures/section-fixture.{html,-main.ts}`,无 code 字段 schema 副本,16 骨架板块全量填充)。**结论**:①**nudge 机制真 LLM 触发实证**(B 臂 whole-set 16 ≥ 12 → `delegate_nudge` 留痕);②**flash 对 initialPage 形态的天然解 = 一次性 whole-set 写**(双臂均 5 轮 5 工具 16/16 完成,140s/60K vs 158s/68.7K)——「小步 grind 拖垮上下文」前置假设在该任务形态**不成立**,advisory 随写结果尾附时任务已由单写完成,模型忽略 = 正确裁决(advisory 不阻断设计兑现);③S1 段规格四要素:双臂零委派 → 不适用(无 spawn task 可抽检);④**阈值标定**:grind 形态未复现(flash 自然首选批量写),`DELEGATE_NUDGE_THRESHOLD=12` 敏感性无法从本轮数据判别 —— 维持 12(保守初值),触发面双形态(whole-set 计数 / patches 计数)实证无误伤不误拦;小步 grind 主战场验证见 subtree S4(同日补跑,同结论:nudge 触发、批写一步到位)。**后续触发**:实测出现「逐组件小步 grind」真实轨迹时重新评估阈值。

### [2026-08-24] subtree-summary:真 LLM 门禁(单干细节场景 + flash 三场景 + 阈值校准)— ✅ 已验证结案(2026-08-26 补跑收口)

**来源**:subtree-summary Phase 1 真 LLM 门禁未跑 —— LLM 网关模型面不可用。**验证**:`tests/runtime/subtree-real-llm.mjs`(complex-demo ?huge=1)。**结论**:①flash 三场景 **2026-08-24 报告全过**(S1 深改单组件 4/4:占位可见→窄读→改写标准闭环、S2 占位下内容问答 3/3:定位后精确读零写入、S3 猜路径盲写 3/3:对抗指令下模型自发先读);②无子 agent 单干细节场景指标已采(S1/S2/S5 工具链零委派:S1 search→read×3→write 5 工具 87K prompt / S5 read→write 2 工具 41K);③**S4 大批量改造(delegate_nudge)2026-08-26 补跑 4/4**:20 组件 patches 批写一步到位,nudge=true 触发实证,advisory 不阻断零误伤(与 section 双臂同日同结论:flash 自然首选批量写,「小步 grind」形态未复现);④阈值校准:`SUBTREE_SUMMARY_THRESHOLD=3072` 无反向证据(占位可见时窄读引导生效、无 thrash、无过度拦截),维持现值。**报告**:`local/_real-llm-subtree.json`(S1-S5 全量)。

### [2026-08-26] render-check:verify 预算跨委派无总闸(render-check 真 LLM 验证新发现)— ⏸ 暂缓(单实例行为面观察)

**来源**:render-check 真 LLM 验证 S5(对抗性坏 script):主 agent 对同一组件**重委派 3 次** `use_html`,每次委派子 agent 各有 2 次 verify 预算(结构+渲染共享池),累计 6 次 render check —— 单委派硬闸有效,但「反复委派改同一组件」形态下总检查次数无上限(既有语义:主 agent 重委派自由;轮次预算/子 agent 超时 600s 间接约束)。**触发条件**:实测出现「重委派 ≥3 次烧 render 预算」真实案例,或下次动 subagent/verify 预算面。**候选修法**(届时按案例定):组件级 render check 结果短 TTL 缓存(同 code hash 复检免重跑)/ 委派层同组件 verify 总预算。

### [2026-08-24] render-check:S4 主 agent 验收工具 + 整页组装钩子 — ⏸ 暂缓(评审裁决 deferred)

**来源**:`2026-08-24-render-check` 评审:①新增主栈默认工具与 main-surface-slim 方向相逆且收益与门禁重复 → S4 砍除;②SDK 无页面树、非 code 组件宿主渲染、N 份自包含文档拼合引入选择器/脚本冲突假错 → 整页组装不做。**重启触发**:①出现门禁覆盖不到的验收缺口(如主 agent 收口前需主动抽检渲染,实测有需求再立项,形态走「非默认工具/能力包」);②宿主提供组装函数(页面树/布局容器)的钩子形态需求出现(集成方反馈「组件各自能跑但整页拼起来坏了」)。**重启须知**:组件级隔离渲染已上线(3.48),增量面只剩「跨组件信号归因」与「宿主组装钩子」;S4 工具须过 main-surface-slim 的工具面税评估。

### [2026-08-24] render-check:真 LLM 坏 script 自纠闭环 — ✅ 已验证结案(2026-08-26,deepseek v4 flash 直连)

**来源**:render-check 实施期真 LLM 门禁(坏 script → 自检-修复-复检 ≤2 次预算含降级不假绿)未跑 —— LLM 网关模型面不可用。**验证脚本**:`tests/runtime/render-check-real-llm.mjs`(5 场景)+ 报告 `local/_real-llm-render-check.json`。**结论**:①自检-修复-复检**全链路真 LLM 实证**(S5 同步坏 script:js-error fail×3 → 修复 pass;对抗性指令拉回坏写法后终态诚实 fail 收口,不假绿 ✓);②flash **天然防御化率 3/3**(契约调用 typeof 守卫 / fetch AbortController+res.ok+.catch 全套)——自然坏 script 产生率极低,门禁实战价值主要在资源 404 与异步错误;③**「异步晚到错误漏报」残余实测复现**(S4:禁守卫指令下 unhandledrejection 落在收集窗关闭后,render_check 仍 pass —— 设计文档明示残余,非新缺陷);④**行为面新发现:主 agent 重委派可绕过单委派 2 次 verify 预算**(S5:3 次 use_html 共 6 次 render check)——单委派硬闸有效,跨委派无总闸,登记下方行为面观察条目。

### [2026-08-24] 团队审查(3 agent:回归/并发/场景)遗留 P2 清单 — ⏸ 暂缓(P0/P1 已当场修)

**来源**:subtree-summary + PLACEHOLDER_LEAK 落地后的团队审查;P0=0,P1×2 + P1 级口径缺口已当场修(leak 检查移 enforceSet 前 / 守卫文案补分页 / verify 拒绝码四码 / nudge keep_external 口径 / write(set) hash 复用)。遗留 P2 如下,**重启触发** = 各项所述实例出现或相关模块下次改动时顺手:

1. **并发写互锁 TOCTOU(CA-P1 既有)** — ✅ **已实施**(2026-08-25,[2026-08-25-write-conflict-final-hash](changes/2026-08-25-write-conflict-final-hash/) C 形态:dataOps 闭包级 async mutex + ask 拆段 + 裁决恢复点校验,`maxParallelTools>1 && conflictWatchFields 武装` 相与装配;selftest sec-109 + e2e conflict.mjs 双场景锁定;本条随之移除)
2. **componentLock 时序残余窗口**:主写守卫在同步派发段、use_html acquire 在 await 后,同批 `[use_html, write(同组件)]` 并发可穿;code 字段仍被 CUSTOM_CODE_DELEGATION 恒守卫兜底。CLAUDE.md 已登记,e2e 用 slow_probe 锚。
3. **并行模式写结果交叉不失效**:同批两个写都成功时,先写结果的「当前值+新 hash」在后写落地后陈旧,stale 失效不覆盖(串行无此问题)。
4. **focus 路径漂移零检测**:focus 按数组下标锚定(components.0),调序/删除后换人 → 全文豁免+strict 拦截作用到错误子树;FocusController 无失效/重算入口。候选修法:augmentPrompt 期存在性校验失联警告 / codeAsset 场景 __pgId 锚定。
5. **nudge 度量面盲区**:只认 `ctx.name==='write'` —— eval_script(transform)/draft_commit/restore_data 的 bulk grind 不进欠委派检测(writeGate 用 writeCapable 标注,nudge 手写名单偏离)。
6. **resource_update 绕过占位防线**:value 只过 subSchema 类型校验直接落资源池+bind,占位串可经此通道进 bind(现实性低:需 LLM 把占位喂给低频精确值工具)。
7. **MARKER_RE 非 ASCII 字段名漏检**:codeField 为中文等字段时生成 `<代码 2.3KB>`,写回不检(漏检非误伤;`<subtree` 子串规则不受影响)。
8. **主 scope read 恒 deepClone**:summarizeLargeText 在 isMain 无条件克隆(零摘要也克隆);可改先 walk 估算命中阈值才克隆。
9. **守卫跨轮零拦截**:subtreeGuard 占位集 invoke 级清空,「上轮读占位→本轮写」放行(口径明示);`components[3]` 括号形态与 dot 形态 fallsIn 互不匹配 → 漏拦。
10. **approval×守卫双重确认边缘**:approval 在洋葱外层,获批写可再吃一次 NEED_NARROW_READ 重试再触发 approval(仅 approval.tools 配 write 时)。

**更正记录**:「offload 吞 delegate-nudge advisory 尾巴」观察证伪(4a3539a commit message 结论有误)—— offload 在 coreExecTool 洋葱最内层,nudge 尾附在外层 wrapToolCall 追加恒可见;且写结果 safeStringify 封顶 600 字符触不到 offload 阈值。真实残余 = 历史轮压缩「保首砍尾」(一次性 advisory 生命周期内可接受)。

### [2026-08-24] image-input 真 LLM 旁路三场景(image-input-vision 收尾遗留)— ✅ 已验证结案(2026-08-26,modelverse vision 旁路)

**来源**:`2026-08-18-image-input-vision` 归档时收尾:describe 内置工具与 vision_tokens 分离已在原 tasks 划线否决(转述经集成方 LLM,SDK 侧无 token 可计),余真 LLM 验证未跑。**验证环境解锁**:modelverse 凭据(用户提供,只进 .env)+ `deepseek-v4-flash-vision-exp` 图像输入实测可用 → images-demo describe 新增 **anthropic 协议识图通道**(`VITE_VISION_MODEL` + `VITE_VISION_BASE_URL`(.env)/ `__VISION_CONFIG`(运行时)双入口;**浏览器直调 modelverse /v1/messages 因 CORS 失败,须走 vite 同源代理 /llm** —— chat/completions 直调不受影响)。**验证脚本**:`tests/runtime/image-input-real-llm.mjs`(三场景,Playwright 渲染 HTML 截图产真实 PNG)+ 报告 `local/_real-llm-image-input.json`。**结论**:①**三场景核心链路全通**——转述注入(user 消息 images[].description 非空)+ 图→结构化 HTML 产出(S2 ```html 代码块含设计稿文案)+ **OCR 字符级精确转写**(S3 优惠码 SMZDM-8826 + 有效期逐字正确);②**vision 转述质量是旁路上游瓶颈**:弱转述(只述布局不转写文字)时主模型诚实不编造但会过度探索自救(S1 首跑 10 工具烧轮次)——describe 提示词加「逐字转写所有可见文字」硬性要求后 S1 复跑转述完整、答案精确;③**lib 的 reload 快速失败在 describe 在途时误杀**(debugLogs 恒空 ≠ reload;真 LLM 脚本须先等首条日志再 waitIdle,已在该脚本内桥接)。**原内部 VITE_VISION_URL 端点**(需登录态)保留为通道②,集成方带会话环境仍可用。

## 2026-08-25 flow-robustness 登记(P2 残项,五路审计评估不进本 change)

> 来源:`2026-08-25-flow-robustness` proposal「登记 deferred」清单(P0×2 + P1 全部已实施,以下为评估后暂缓的 P2)。**重启触发** = 各项所述实例出现或相关模块下次改动时顺手。

| 项 | 说明 | 触发条件 |
|---|---|---|
| memory 异步 source / images.upload race 超时 | fire-and-forget 异步源无超时闸;挂起概率极低(内部 fetch 均有网络层超时兜底) | 实测挂起案例 |
| MCP listTools 15s race | 握手 15s 降级已有;listTools 本身无 race(理论挂) | MCP 环境实测 listTools 挂死 |
| hashValue 失败返回常量串 / watchFieldsHash 环数据 RangeError | 乐观锁静默失效面(hash 算错 ≠ 挂起);环数据已被 deepClone 环防御前置拦截大半 | 乐观锁静默失效实测案例(两修法二选一,按案例定) |
| vfs_json_patch isUnsafePath 预检 | `__proto__` 段预检加固(与已登记 SE #3/#4 同型) | 与 SE 加固组一起做 |
| query/search 环数据误标 | 环数据下 query/search 的体积估算误标;环已被写路径前置拦截,读路径残留 | 环数据实测读路径异常 |
| Worker OOM 文档明示 | eval_script 沙箱 OOM 行为文档化(非代码修) | 下次动 usage-guide eval 段 |
| hostScript 主线程死循环 | ✅ 已消亡(4.1.0 随 config-surface-pruning-round2 移除 `skillHostScript`;2026-08-26 结案) | — |
| stream SYSTEM_PROMPT_OVER_BUDGET 早退仍推空 assistant | 与已修「send-invoke 吞 error 事件」(循环/终止面 #3,✅ 2026-08-26 销账)同族不同路径;2026-08-26 team-audit-hardening 审查补**第三入口**:automation budget-abort 走 send 同落空气泡(budget.ts 返 `content:''` → createChatSdk.ts:1912 照常 push;三入口一起修:send push 前对 `!reply.trim()` 且本轮有 BUDGET_EXCEEDED 类事件跳过或占位) | 超预算/budget-abort 实测案例(三路径一起修) |
| auditWritePaths 跨会话残留 | 已接受(证据审计基线跨会话累积,语义可辩护) | 不修,留痕 |
| 单轮 tool_calls 数量无上限 | 仅 maxIterations 90 轮间接约束;单轮爆发百级 tool_calls 会拖慢派发 | 弱模型实测单轮爆发 |
| 启动段超时未 inner.abort(资源级) | 启动闸超时后未 abort 底层 fetch(资源泄漏级非挂起级) | 下次动 streamer 启动段 |

**顺带更新既有条目**:上下文组 #2「setProtectedRefs 仅 stream 入口注入」→ 🔁 **send/batch 已修**(flow-robustness 任务 14,三入口一致);残留 = 子 agent 路径绕过(子共享主 vfs,保护面经主消息 refs 覆盖大半)。

## 维护约定



- 暂缓项**不进** `project.md`「进行中的 change」(避免占心智);本文件是唯一索引。
- 🔄 **定位升级后**(2026-08-01):5 项全部重启授权,分期落地(见 `doc/archive/complex-agent-roadmap.md` + 上方覆盖块)。重启以 `revive-*` / 调整后新 change 推进(不直接 apply 旧 proposal —— 默认策略 / 依赖绑定 / 已实现部分需调整);旧详情段保留作"当初为何暂缓"的溯源,不删。
- 原 change 目录保留(proposal / design / tasks 不删),作为详细底稿;各 proposal.md 顶部已加 `⏸ 已评估暂缓` 标注块指向本文件。
- **重启某项时**:从本文件移除 → 立项进 `project.md`「进行中」→ 按正常 OpenSpec 流程推进(先修行号 + apply)。
- 本文件随评估持续维护;新增暂缓项追加到表尾。

## 2026-08-26 team-audit-hardening 登记(六路团队审查 P2/P3 残项,评估不进本 change)

> 来源:`2026-08-26-team-audit-hardening` 六路审查(对话主循环/数据写链/子 agent 编排/持久化会话/上下文管理/规划门禁 focus)+ 二轮对抗核实;P1×7 + P2×2 已进本 change,以下为评估后暂缓项(均经 deferred 去重,与新发现不同点才登记)。**重启触发** = 各项所述实例出现或相关模块下次改动时顺手。

### 存储恢复面(P2×4 + 低危×3)

| 项 | 说明 | 触发条件 |
|---|---|---|
| resetSession 未走 runSerial 串行闸 | createChatSdk.ts:2978 直调 + mountChatDialog.ts:63 onClear 直调;switchSession 在慢 store.load 挂起时用户点清空 → 恢复后覆写 sessionId 旧内容回屏(「清空」被静默吞)。修:入 runSerial 或 switch 恢复点校验 sessionId 未变 | 自定义慢后端实测交错案例 |
| UI 删会话按钮无错误收口 | mountChatDialog.ts:115 onRemoveSession 裸 await 无 .catch(同文件 onNewSession/onOpenSession 均有);clearPrefix 500 → unhandled rejection + 列表不刷新。修:补 .catch + SESSION_DELETE_FAILED observable | 自定义后端删会话失败实测 |
| 自定义后端方法契约零装配期校验 | storage.ts:367-368 实例直接透传;缺 scan → mount 即 TypeError(经恢复路径放大)、缺 clearPrefix → deleteSession reject。修:装配期查 5 方法,缺失 warn + degraded 降级(scan 缺 → listSessions 返 [];clearPrefix 缺 → no-op)。与 #315(字符串面 warn)不同面 | 集成方残缺后端实测报错案例 |
| commit 通用错误路径零留痕 | storage.ts:496-497「其它写失败静默不抛」无 emit 无 debugLogs;4.4.0 CHANGELOG/usage-guide 写「吞错留痕」仅 quota 分支成立(文档-实现偏差)。修:补 StorageEvent | REST 500 实测案例 |
| maybeEvict 不随 maxBytes:Infinity 短路 | storage.ts:525-551;Infinity 下 selectForEviction 恒空但每 send 轮 2-3 次全库 `backend.scan`(跨 agent 全量 key 枚举 = REST 服务端全表扫)+ 偶发 degraded 刷屏。修:一行短路 return | REST 后端性能实测 |
| encodeKey 不转义 `::` | storage.ts:147-149;自定义 sessionId 含 `::` 时 clearPrefix('a') 可误删 id 'a::b' 的会话 key | 集成方用 `::` 做 sessionId |
| vfs hydrate 不清 clear 的 pending timer | 2026-08-26 原疑似 P1 已证伪(clear→同步 hydrate 间零 await,竞态不可达);残余 = 切回后 800ms 一笔冗余自写(hydrated 内容写回本会话,无害)。修:hydrate 里 clearTimeout 一行洁癖 | 下次动 vfs.ts hydrate 顺手 |

### 上下文面(P2×4 + P3×1)

| 项 | 说明 | 触发条件 |
|---|---|---|
| 摘要缓存前缀对齐在 trim/restore 后失效 | useContextManager.ts:88-93 注释宣称「trim 错位时缓存不命中」与实现不符(命中判定只比 coveredCount 数值,③trim 后轮号重编 → 错位摘要);近窗原文无损纯质量问题。修:缓存条目存 older 首轮 user 指纹做对齐锚 | 长会话过 ③trim 后摘要质量异常实测 |
| token 估算计入 steps/reasoning 而 toLC 从不发送 | contextIndex.ts:26-37 vs createAgent.ts:501;editor 类会话估算虚高数倍 → 系统性过早压缩 + 近窗被不必要压小(纯质量损失)。修:触发/窗口估算只计 content,steps 留给内存预算参考 | UI 长工具链会话压缩时机异常实测 |
| 批读失效占位文案不实 | readInvalidation.ts:170-171 称「兄弟子树仍可参考」,实际 :252-256 整条 ToolMessage 原子替换未触及路径一并吞掉 → 模型凭旧值直写(恰是机制要消灭的行为);usageHints 明文鼓励批读。修:readPaths>1 改文案或失效判定逐路径 | 批读 + 部分击中后模型引用旧值实测 |
| invoke 内新 offload 不进保护集 | createChatSdk.ts:1882/1956/2109 refs 均在 invoke 前算;单 invoke 连续大子树整读撑超 4MB 池 → 本轮早前 offload 被 LRU 淘汰 → 同轮 vfs_read 404(4.1 修的残留变体,主路径 mid-invoke 盲区,#217/#542 只登记子 agent 面)。修:offload 后回调并入保护集或「当轮创建恒保护」 | 单 invoke 多次大整读实测 404 |
| userImages 保护判定带 isLarge 前置 | vfs.ts:128/139 仅 largeResults 池查 _protectedRefs → 图片池 LRU 淘汰保护不生效(vfsGc.ts:24 注释宣称的口径);优雅降级剩缩略图故 P3 | 多轮带图超 2MB 池后需原图实测 |

### 门禁面(P2×4 + P3×3)

| 项 | 说明 | 触发条件 |
|---|---|---|
| 零工具门禁无「用户已拒绝/诚实做不到」出口 | gateChain.ts:182-213;用户拒绝后模型陈述句收口「已停止,未做任何修改」→ lastHumanContent 仍原祈使句 → 回灌×2 烧满 + 误报 ZERO_TOOL_GATE_EXHAUSTED;出口③诚实回答零机械化识别。修:否定完成态词豁免或 turnUsage 含 RHC 且收口无位置说明时降级 | RHC 拒绝场景实测误报 |
| COMPONENT_BUSY 计入等效写 | actionGate.ts:67-74 只看工具名不看结果;撞锁零执行的委派被计等效写 → 零工具门禁被抑制谎报放行。修:委派结果 content 命中 COMPONENT_BUSY/PATH_OUT_OF_SCOPE 前缀不计 | 同组件撞锁后谎报实测 |
| caps.vfs:false + codeAsset 并存无守卫 | createChatSdk.ts:1019-1024 自动装配不查 caps.vfs → 子 agent 引导走 vfs_edit「工具不存在」白烧轮次,修改路径静默失效。修:装配期 warn 或强制开 | 集成方显式关 vfs + schema 含 code 数组 |
| detectActionImperative 缺全角标点 | actionGate.ts:50 首子句切分字符类除「。」外全半角 → 全角逗号常态下 16 字窗口退化为整句,readonly 反例误入 → 真写指令漏拦。修:补 `！？；，` | 全角标点输入实测漏拦 |
| QUESTION_TAIL_RE 缺全角问号 | intentGuard.ts:24 `[??]` 两个 ASCII 问号;当前零行为影响(tier-1 已覆盖),复制到别处即踩的地雷。修:补 `？` | 下次动 intentGuard 顺手 |
| draft_commit 不退出 planning | todos.ts:19 PLAN_EXIT_TOOLS 只含 write;draftWrite 场景合法修订被 5 次上限误耗。修:draft_commit 并入退出集 | draftWrite + planning 实测 |
| 超限拒 update_todo 混合调用不说明「本次未生效」 | todos.ts:179-183 整笔拒但文案含糊 + planRevisions 虚高。修:拒绝文案补「重发仅含 status/evidence」 | 弱模型混传实测状态机断拍 |

### 数据写链面(P2×3 + P3×4)

| 项 | 说明 | 触发条件 |
|---|---|---|
| eval transform 三模式无乐观锁检查 | dataOps.ts:1309-1377 有 mutex+commit+setBaseline 但无 effHash/handleConflict(CLAUDE.md 把三模式列进互锁七 commit 位,文档-实现分叉);armed 场景外部修改被静默覆盖。修:三处 commit 段补 handleConflict(锁内取 hash) | conflictWatchFields + eval transform 实测静默覆盖 |
| restore_last_checkpoint 不发 data_change | checkpoint.ts:197 经 writeData 整体还原 bind,matchDataOp/isDelegationTool 均不覆盖;非 reactive 宿主(page-demo :key=tick)回退不重渲染「回退没生效」。修:matchDataOp 补 'restore' + sdk.restoreLastCheckpoint() 手动 emit | checkpoint 开 + 非 reactive bind 宿主实测 |
| 同批 set+append 同字符串路径误拒 | dataOps.ts:358 append 校验取写前 live 值而非批内中间值 → 合法终值整批 SCHEMA_INVALID,错误信息指向不存在的状态。修:liveCur 改取 clone(getByPath(clone, jp) 在 append apply 后已含此前 set) | chunked-code-write 模型把首块+次块并进一个 patches 批实测 |
| restore_data 绕受保护资源强制层 | dataOps.ts:1169-1188 无 protectedCtx/enforce;多轮快照回放可把 freeze 字段回写旧值(借 restore 绕 freeze 只读)。修:restore 前对受保护路径差异比对拒或 warn | freeze 字段 + 历史快照 restore 实测 |
| commitSetToBind codeAsset 模式双深拷贝 | dataOps.ts:508/:532 两次全量 deepClone(applyPatchesToBind:640 已做单拷贝复用);1MB bind ≈ +10ms/写。修:同款 beforeBind 复用 | 下次动写路径成本面顺手 |
| write(del) 目标不存在仍 pushSnapshot+audit+data_change | dataOps.ts:1548-1554「无需删除」文案但快照栈位/审计条目已产生。修:dryRun 同款 clone 预检存在性 | 下次动 del 路径顺手 |
| setData 不发 data_change 而 importData 发 | createChatSdk.ts:3035-3041 vs :3099-3111 两条整体替换 API 事件口径不一致。修:文档明示或对齐 | 集成方依赖事件口径实测疑惑 |

### 主循环面(P2低×2)

| 项 | 说明 | 触发条件 |
|---|---|---|
| runSerial 排队中的 send 被外部 abort 后白等 | serialRunner.ts:13-20 无信号语义;B 排队 + 1 分钟后 abort → 仍等 A 跑完才以 '' 收口。修:sdk.send 包装内挂 signal 提前 reject race | headless 长任务排队 + abort 实测 |
| automation budget-abort 空气泡消息 | 已并入上方 flow-robustness 登记「SYSTEM_PROMPT_OVER_BUDGET 空气泡」行(三入口一起修) | 同上 |

### [2026-08-27] UI 挂起门禁期间的排队消息永不消费 — ⏸ 暂缓(产品行为待裁决)

**来源**:tool-surface-economy 重立基线实测(uispec S3):flash 撞 components.0 冻结字段后调 `request_human_confirmation` 转人工确认,场景以挂起收口;S4 消息进 useChat `queuedTasks` 后 **永不消费**(RHC hold() 被响应方接管后不限时)→ `msgs` 不增 → runner idle 判定永假干等 900s(测试侧已修:`_real-llm-lib.mjs` 场景间 `resolvePendingGates` 点保守选项放行;旧 8-16 基线 RHC 只在末位 S10 出现过,缺口从未暴露)。**真实用户面同款**:RHC/approval/conflict 条挂起时用户不打断直接输入新指令 → 消息排队但确认条不点则永不处理,且无任何提示。**候选修法**(产品裁决):①挂起期间禁用输入框 + 提示先处理确认条;②新输入视为隐式应答/取代(语义复杂);③排队提示条上显示「等待确认中」状态。**重启触发**:用户反馈排队消息丢失/困惑,或下次动 useChat/ApprovalBar。

### [2026-08-27] 低频工具按需注入(restore/history/diff/resource_delete/schema_data 走 skill 按需)— ⏸ 暂缓(tool-surface-economy「不立项项」登记)

**来源**:tool-surface-economy 立项评估(2026-08-27 用户拍板「先规划无风险的」)。与 3.31「工具面恒全暴露」契约(移除 toolMode 的刻意反转)冲突 —— 该契约的价值是工具面稳定可预期(集成方文档/调试/教学不随上下文变化),按需注入会让「什么工具存在」变成运行时动态面,属产品决策非无风险项。**收益侧**(若做):每轮 schema 固定成本再降(低频五工具工具级+字段级合计 ~700 字符);**代价侧**:低频工具的「可发现性」依赖 skill/提示引导,弱模型可能不知道能 restore 而直接重写。**重启触发**:出现明确的小上下文模型(<32K 窗口)集成诉求,或恒全暴露契约被产品层重新裁决。

### [2026-08-27] describe_data 删除(与 read 冗余)— ⏸ 暂缓(W2 引导归一后看数据)

**来源**:tool-surface-economy W2 评估。describe_data 与 read 不传 jsonPath 功能完全重复(read description 已自称合并 describe 语义);删工具改变工具面属有风险项,故 W2 先做等价标注引导归一(description 补「等价于 read 不传 jsonPath;优先用 read 单一入口」)。**重启触发**:真 LLM 基线中 describe_data 调用量连续两版 ≈0(8-16 基线实测 13 次/报告;W2 落地后观察 4.6 基线,连续两版归零即删)。
| switchSession 中止在途流后 UI 留空 content 的 partial assistant 占位 | team-audit P2#9 实施发现:streaming:false 改走 core.stream 后,switchSession 的 abort 正确掐断旧流(内容/写入零孤儿,已修),但 useChat 的 abort-保留-partial 语义会把空串 assistant push 进新会话消息列表(空气泡;streaming:true 同款既有形态,非本项引入)。修:useChat 非流式分支 abort 收口不 addMessage 空串(流式分支已有空 splice 守卫) | 用户反馈空气泡困扰,或下次动 useChat 收口路径时顺手 |
