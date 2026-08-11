# R5 审计结果:子 agent 链(F6)+ 子 agent 能力模块

- 审计路:F6 子 agent 委派链为主 + R5 模块评审(subagent/todos/skills/memory/permissions/verify/usageHints/ragSubagent/htmlSubagent)
- 基线:2.38.0;日期:2026-08-10
- 方式:逐行读码 + dist 产物实测探针(P0 项已运行时复现,探针脚本用后即删)

## findings(严重度降序,格式:严重度|类别|file:line|结论|证据|修复|测试)

P0|correctness|src/core/sdk/createChatSdk.ts:1069,1090 + src/core/harness/subagent.ts:231-237|子 agent allowedTools 永远选不到 vfs 工具,rag/html 能力包核心流程断裂|传给 spawn/subagents 中间件的 `allTools: () => allTools` 是 createChatSdk 局部池(rebuildExtraTools,createChatSdk.ts:1012-1027 仅 builtin/user/action/humanConfirm/checkpoint/focus/mcp/skill 八源),而 vfs 工具是中间件工具(createChatSdk.ts:1255 createVfsMiddleware 经 mw.tools 注入;toolsets.ts:52-57 selectBuiltinTools 只含 dataOps/fetch/dom/inspect)→ runSubagent 的 `getAllTools().filter(allow.has(name))` 恒落空。**实测复现**:dist 产物驱动 use_html 子 agent,其 vfs_write 调用返回「工具 "vfs_write" 不存在」;ragSubagent.ts:178 的 ['vfs_grep','vfs_read','vfs_json_read'] 与 htmlSubagent.ts:121 的 ['vfs_write','vfs_edit','vfs_rm','vfs_grep','vfs_read'] 全部静默丢失;CLAUDE.md 文档示例 allowedTools:['vfs_grep','vfs_write'] 同样失效;html 包「代码正文→vfs」与 rag 包「vfs 搜预注入文档」两条核心流断裂|getter 改指向 agent 合并池(如 `() => core.agent?.allTools ?? allTools`,参考 createChatSdk.ts:1724 inspect 同款写法),并在 runSubagent 过滤时排除 use_<id>/load_skill/write_todos 等框架中间件工具防反向泄漏|selftest 断言「createHtmlSubagent 子 agent 实际工具池含 vfs_write」「createRagSubagent 含 vfs_grep」(现存 sec-67 只断言 config 字段形状、e2e capability-packs.mjs 只断言 use_rag/use_html 委派工具存在——装配结果零覆盖)

P1|correctness|src/core/utils/pool.ts:27-35 + src/core/harness/subagent.ts:380-401|spawn_agents 一个子失败 → 整批结果被遮蔽,孤儿子 agent 继续烧 token(H20 证实)|runPool 并发路径 `await Promise.all(workers)`,任一 worker reject 即整体 reject;spawnMany 的 fn 内 catch 仅 tracker.finish('error') 后 `throw e` 透传,无 try/catch 包裹 runPool → 成功子的结果(已算出/在算)全部丢弃,主 LLM 只收到一条「工具执行出错」;已启动的孤儿子 agent 无取消机制继续跑(可能带 writablePaths 写 bind),tracker 事后记 done 与主链事实不符;串行路径(lim<=1)同样一错即抛、剩余任务静默不启动|runPool 改 per-item 错误捕获落占位,或 spawnMany 包 allSettled 语义:结果按序聚合「【子任务 i】失败:原因」,部分成功照常回灌|selftest:3 子 1 失败场景断言结果含另 2 子结论 + 失败项带序号归属

P1|security|src/core/harness/subagent.ts:177-184 + src/core/tools/dataOps.ts write schema(patch.jsonPath/patches[].jsonPath optional)|writablePaths path guard 漏 patches 无 jsonPath 项 → 子 agent 越界写主数据根(H25 证实)|extractWritePaths 对 patches[i] 仅在 `typeof p.jsonPath==='string'` 时收集;write/edit_data schema 明确 jsonPath 可选(描述「merge/append 不填则作用于根」)→ 混合批量 `write({patches:[{op:'set',jsonPath:'components.0.x',...},{op:'merge',value:{...根级}}]})` 时无 jsonPath 的根级 patch 不被收集、不被校验,paths 非空即整体放行 → 子 agent 经 writablePaths 配置也能改根|extractWritePaths 遇 patches 项缺 jsonPath 视为根路径 '' 参与校验('' 必不命中 writablePaths 前缀 → 整体拒)|selftest:wrapWithPathGuard + 混合 patches(有/无 jsonPath 各一)断言整体 PATH_OUT_OF_SCOPE

P1|security|src/core/harness/subagent.ts:296-308 vs src/core/sdk/createChatSdk.ts:1261-1269|子 agent 不继承主 permissions/approval 中间件 → 写约束可经委派整体绕过|runSubagent 子中间件栈仅 skills/summarization/递归 spawn/focus/opts.middleware,不含主栈 permissions/approval;且 spawn_agent schema(subagent.ts:367-373)向 LLM 暴露 tools/writablePaths 参数,LLM 可自选子 agent 写范围。配 `approval:{tools:['write']}` 的集成方:主 LLM spawn 带 writablePaths 的子 agent 直接写,人工确认被跳过;permissions deny 规则同理被绕(子写工具是同一 dataOps 实例但走不到主中间件链)|子 agent 装配透传主 permissions/approval(至少对子写工具生效);writablePaths/tools 收紧为集成方配置面(spawn schema 移除或加 caps 开关),不由 LLM 运行时自选|e2e:approval 白名单含 write + spawn 子带 writablePaths → 断言子写仍触发 approval_request;permissions deny + 子写同路径 → 断言被拒

P2|flow-divergence|src/core/harness/todos.ts:18,99-105,134-136,190-194|纯查询/调研任务永不退出 planning,预算耗尽后 update_todo 标完成被拒并回灌「去执行 write」错误引导(H2 证实)|PLAN_EXIT_TOOLS 仅 write/set_data/edit_data/delete_data 成功;纯调研任务 read/query 每轮计数(beforeModel todos.ts:174,注释明示含调研轮),超 maxPlanRevisions(默认 5)后 write_todos/update_todo 返回「停止调研/修订…用 write/set_data/edit_data 落地」——查询任务无写可落地 → inPlanning 永不退出(仅 reset 收口),todos 永远无法标 completed(残留 in_progress 渲染进后续轮 system prompt),回灌文案对查询任务构成写操作诱导|退出条件增「todos 全 completed」或「轮内仅读工具 + 产出最终答」分支;回灌文案按任务性质分流(查询类允许直接作答收尾,不强制 write)|selftest:write_todos → 5 轮 query_data → update_todo(status:'completed') 断言不被拒、getPlanPhase().inPlanning 退出

P2|correctness|src/core/harness/todos.ts:191 + src/core/harness/createAgent.ts:504-522 + src/core/tools/dataOps.ts:226|被拒写入(SCHEMA_INVALID 等)也退出 planning 并重置预算,「写工具成功退出」语义未落实|dataOps 写错误经 `return toolError({...})` 返回字符串不 throw → coreExecTool 非 throw 一律 status:'done' → PLAN_EXIT 判定 `result?.status !== 'error'` 恒真 → 校验失败/PATH_DENIED/VERSION_CONFLICT 的 write 同样退出 planning、计数清零,防死循环预算可被失败写反复重置|退出判定叠加结果文本拒绝码检测(可复用 verify.ts:85 WRITE_REJECTED_RE 正则)或 dataOps 拒绝路径改结构化 error status|selftest:write 触发 SCHEMA_INVALID 后断言 getPlanPhase() 仍 inPlanning 且 rounds 不清零

P2|security|src/core/harness/subagent.ts:174,229-237|allowedTools/spawn tools 参数可授予 eval_script 等 guard 未覆盖的改 bind 工具,writablePaths 形同虚设|SUB_WRITE_TOOLS 仅 ['write','set_data','edit_data','delete_data','draft_commit'];eval_script(transform 可整体重写根/子树)不在 guard 包装列表,经 spawn `tools:['eval_script']`(LLM 可控参数)或 SubagentConfig.allowedTools 进子 agent 后写不受 writablePaths 约束;resource_update 同理|guard 覆盖面与「能改 bind 的工具全集」对齐:eval_script 禁入带 writablePaths 的子池,或其 transform 提交链同样过路径校验;文档显式告警|selftest:writablePaths + allowedTools:['eval_script'] → transform 越界写被拒

P2|security|src/core/harness/focus.ts:40-52,127-138|focus 写拦截与 path guard 同型漏洞:patches 缺 jsonPath 项绕过聚焦越界检查|extractScopes 跳过无 jsonPath 的 patch 项;聚焦中 `write({patches:[{op:'merge',value:...}(根级)]})` 不产生 scope → for 循环空转直接 next,可写焦点子树之外;整体 write({value}) 无 jsonPath 同样不校验(注释称 schema 白名单兜底,但根级 merge 可改任意 schema 声明字段)|同 path guard 修法:缺 jsonPath 按根路径 '' 参与 isUnderFocus 判定(必不命中 → 拒)|selftest:聚焦 components.3 + patches 含无 jsonPath 的根级 merge → PATH_DENIED

P2|flow-divergence|src/core/harness/subagent.ts:564-571|同一 use_<id> 并发委派共享事件 taskId → UI steps 交错混组(2.38 双轨语义核实)|tracker 侧 observeId 唯一(`use_${id}-rand4`)并发安全 ✓;但 `baseForward = makeForward(「use_<id>」, ...)` 事件 taskId 固定,同 id 两次并发委派的 tool_call/tool_result 交错进同一 UI 分组;观察层正确、事件层混组,属设计保留项,影响 = DebugDrawer/消息行 steps 视觉归属错乱|事件 taskId 附 observeId 后缀(UI 按 observeId 二级分组)或文档明示限制不升级|browser:并发两次 use_<id> 断言 steps 按 run 归属不交错

P2|maintainability|src/core/harness/subagent.ts:477-499,226|预声明链 depth 不透传:use_<id>→use_<id> 链若可构造则每跳深度重置 0,maxDepth 切断失效(当前不可达,定潜在)|configToSubOpts 无 depth 字段、SubagentsMiddlewareOptions 无 depth、runSubagent `opts.depth ?? 0`;当前 use_<id> 是中间件工具不在 allTools 池 → allowedTools 选不到(与 P0 同因)链实际不可达;一旦 P0 修复且未同步排除 use_<id>,预声明链将绕过 maxDepth 递归切断|修 P0 时同步:runSubagent 过滤排除 use_* 前缀工具,或 configToSubOpts 透传 depth 并在预声明中间件累加|selftest:maxDepth 专项——构造 use_a 可见 use_b 的场景断言深度链被切断

P2|performance|src/core/harness/skills.ts:277-300,312-320 + src/core/sdk/createChatSdk.ts:1239-1250|skill 附带工具每次跨轮 load_skill 都重求值工厂 + 全量 rebind(无「已注入」守卫)|beforeAgent 每轮清 loaded Set(跨轮重 load 是常态,ToolMessage 不跨轮)→ load_skill 对 s.tools 无条件 resolveSkillTools + onToolsReady → loadedSkillTools splice/push + rebuildExtraTools + core.agent.setTools 全量 rebind;工厂重复执行、工具实例被替换(有状态工具丢闭包状态)|按 skillName 记录已注入工具集,skill 未变(invalidateCache/setSkills 才清)则跳过工厂求值与 rebind|selftest:跨轮 load_skill×2 断言工厂仅调用 1 次、工具实例引用不变

P2|correctness|src/core/harness/permissions.ts:34-52|glob 单星 `*` 编译为 `[^/]*` 但 scope 是点号路径 → `*` 实际跨段匹配,与 `**` 无区别|globToRegex 以 `/` 为段分隔,jsonPath 无 `/` → `components.*` 命中 `components.0.props.title`;opt-in 功能但语义与 glob 惯例及注释承诺(「* 匹配非 /」隐含单段)不符|分隔符改 `.`(`*`→`[^.]*`、`**`→`.*`)|selftest:规则 scope `components.*` 断言不匹配 `components.0.x`、匹配 `components.title`

P2|hang|src/core/harness/verify.ts:276-281|adversarial 子 agent invoke 不带 signal → 用户停止生成须等对抗审查跑完(≤4 子轮 LLM)|runAdversarial createAgent/invoke 未接 AbortSignal,beforeReturn 阻塞主循环期间 abort 不生效;死循环防护本身无问题(createAgent.ts:698 `state.verifyAttempts < maxVerifyAttempts` 预算前置,耗尽不再调 beforeReturn,maxAttempts 默认 2,核实通过)|透传 signal 到 adversarial child.invoke|逻辑层难断言,标手动验证项(真实 LLM + 中途停止)

P3|maintainability|src/core/harness/subagent.ts:174,196-198|draft_commit 列在 SUB_WRITE_TOOLS 但必被 guard 拒(无 jsonPath → 「不能整体替换」),子 agent 侧死工具|guard 对无路径调用一律拒;draft_commit 语义即整体提交、无 jsonPath 参数 → 包 guard 后永远 PATH_OUT_OF_SCOPE|从 SUB_WRITE_TOOLS 移除 draft_commit(整体提交本就不该给受限子)|selftest:断言带 writablePaths 的子工具池不含 draft_commit

P3|doc-drift|src/core/harness/usageHints.ts:72|usageHints 称 spawn_agent「只读工具」,但 spawn schema 实际暴露 writablePaths/tools 写授权参数|提示文案与工具能力面不一致(与 finding 4 的收紧方向联动)|文案补「写权限由集成方配置」或随 finding 4 修复后恢复属实|无需测试

## 补充事实记录(归 C 专项,不重复定级)

- **C1 共享 controller(H19 前提成立)**:子 agent 工具是主 builtinTools 同一实例 → 共享 dataOps controller 闭包;子 read 更新 lastReadHash(autoLock 基线父子互通)、子写入进 per-path 快照栈(父 restore_data 可回退到子中间态)。只记录事实,影响评估归 C 专项。
- **focus × html 包叠加**:主聚焦时 html 子 agent 继承全部焦点(createFocusMiddleware initialFocuses),而 focus.ts WRITE_TOOLS 含 vfs_write/vfs_edit、extractScopes 收 a.path → 子写 `html/x.vue` 的 vfs path 被 isUnderFocus 判越界 PATH_DENIED,聚焦状态下代码→vfs 流受阻。
- **H8 基本证伪**:tracker steps 单 run 受子 maxToolRounds 天然约束、history LRU≤20、resultPreview 截断 120 → 无需独立 steps 上限。
- **tracker finish 必达 ✓**:spawnOne(subagent.ts:354-361)/spawnMany(390-397)/use_<id>(574-581)均 try/catch 包裹 runSubagent,done/error 二选一 finish,含 runSubagent 内 MIN_CONTEXT_WINDOW 同步 throw 路径;runPool abort 未启动项不调 start,无僵尸 active。
- **write_todos/update_todo 混用防护 ✓**:todos.ts:178-188 wrapToolCall 计数,同轮第二次调用(含并行)返回结构化错误;beforeModel 重置。
- **verify maxAttempts 死循环防护 ✓**:createAgent.ts:698 预算检查前置(耗尽不调 beforeReturn,省 adversarial token),feedback 才 +1,lastFinalContent 缓存兜底 rounds 耗尽场景。
- **skills exec 安全分支 ✓**:url+host 拒绝(skills.ts:178)、host 需 hostScriptEnabled(179-181)、code/url 二选一校验;sandbox 默认 3s 超时 + Worker terminate(sandbox.ts:73,89);exec 失败不缓存(cacheable=false,skills.ts:216-220)核实无误。
- **spawn 工具排除防递归 ✓**:runSubagent 两处过滤均含 `!SPAWN_TOOL_NAMES.includes(t.name)`(subagent.ts:235,242);depth+1 >= maxDepth 不装中间件物理切断(247)。
- **memory.ts 核实无问题**:setMemory 异步函数 `void memoryMw.refresh()` 后台求值(createChatSdk.ts:1670-1674)与文档一致;初始 options.memory 异步首轮 beforeAgent await(阻塞首启,中间件文档已明示,非缺陷)。

## H2 初步结论

**证实**。机制:todos.ts:18/191 退出条件唯一依赖主数据写工具成功,纯查询任务 inPlanning 永不退出(仅会话 reset 收口)。实际伤害面 = 预算耗尽后 todos 无法标 completed(残留 in_progress 进后续轮 prompt)+ 回灌文案「停止调研,用 write 落地」对查询任务构成轻度 goal-drift 诱因;但 read/query 工具不被阻断、任务本身仍可完成。定级 P2(见 finding 5),修复建议:退出条件增 todos 全 completed 分支 + 回灌文案按任务性质分流。

## 一句话总评

子 agent 委派链骨架(递归切断/观察层/信号继承/预算闸)扎实,但 2.37 能力包依赖的 allowedTools 装配存在 P0 级断层(vfs 等中间件工具对子 agent 恒不可见,已实测复现),叠加 runPool 失败遮蔽与「无 jsonPath patch」同型绕过(path guard/focus 两处),构成「该拿的工具拿不到、该拦的写拦不全」两端失衡,建议下发布优先修 P0 + 三个 P1。
