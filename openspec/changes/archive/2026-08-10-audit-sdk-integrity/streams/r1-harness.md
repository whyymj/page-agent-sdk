# R1 harness 核心审计结果

基线 2.38.0 · 范围:src/core/harness/{createAgent,middleware,state,errors,retry,budget,focus,approval,humanConfirm}.ts
关联核实文件:events.ts / schemaUtils.ts / createChatSdk.ts 关键段 / toolError.ts / dataOps.ts(eval transform)/ @langchain/core errors 源码

## Findings(严重度降序,10 条)

P1|hang|harness/approval.ts:21-23,74-77 + harness/humanConfirm.ts:65-95|approval/humanConfirm 挂起默认无超时,send/batch(invoke)路径 approval 零可见且无 signal → 永久挂起|approval timeoutMs 默认 0=不超时;humanConfirm 全文无超时选项;sdk.send→core.agent!.invoke(messages) 不传 signal(createChatSdk.ts:1438),invoke 内部 handler 只收 done(createAgent.ts:813-821)→ approval_request 无人 resolve;events.ts:23 显式过滤 approval_request 不进 onEvent/hook;abort 联动依赖 ctx.signal(approval.ts:66)在 send 路径为 undefined;batch 同走 invoke(createChatSdk.ts:1480)→ automation 无人值守+approval 必死锁|approval 设默认超时(如 5min)或 send 路径检测 approval 装载即 warn/早抛;approval_request 参照 pendingConflict 模式暴露挂起态给 headless|selftest:invoke+approval 触发→断言超时自动拒或显式错误;e2e:send/batch+approval 不挂死

P1|correctness|harness/focus.ts:26-33|eval_script(transform)不在 focus WRITE_TOOLS → 聚焦 strict 下可经脚本改写任意路径/整体数据,绕过 PATH_DENIED|WRITE_TOOLS 仅 set/edit/delete/write/vfs_write/vfs_edit;dataOps.ts:638-686 eval transform 三条落地路径(整体替换/子树 set/patches)均直写 bind;usageHints.ts:59,67 主动推荐「批量重写大数组用 eval_script transform」;permissions.ts:20 同构缺漏|拦截集增 eval_script(mode=transform)+ draft_commit;extractScopes 已兼容顶层 jsonPath 参数可直接复用|selftest:focus components.3 + eval transform 改 components.5 → PATH_DENIED

P2|flow-divergence|harness/focus.ts:40-52,126-138|write({value}) 整体 set / set_data 无 jsonPath → extractScopes 返空 → 聚焦拦截整体跳过,整体写可覆盖焦点外全部组件|无 jsonPath 时 extractScopes 返 [],for 循环不执行即放行;注释自认「由 schema 白名单兜底」,但白名单限字段不限子树,与「范围收紧 strict」承诺冲突|聚焦时禁无 jsonPath 整体写(返 PATH_DENIED 要求改 patch),最低在结果文本追加越界告警|selftest:focus 下 write({value:整体}) → 拒绝或告警

P2|flow-divergence|harness/createAgent.ts:765|wrap-up 收口 filter 掉全部 SystemMessage → 压缩摘要被剥光,轮预算截断时的最终综合答丢失全部 older 历史|rest = currentMessages.filter(m => typeOf(m) !== 'system');与同文件 replaceSystem(418-421,P0-1「保留摘要」修复)语义直接矛盾|保留 index≥1 的 SystemMessage(摘要),仅把收口指令并进首部 system|selftest:含摘要 system 的 messages 走 wrap-up → 断言请求含摘要

P2|correctness|harness/retry.ts:29|isRetryable 把所有 status===undefined 判为可重试网络错 → ContextOverflowError 及任意内部 Error 先被空烧重试 2 次|langchain ContextOverflowError.fromError 只拷 message+cause 不拷 status(@langchain/core/dist/errors/index.js);无 status 即返 true;若 overflow 在启动阶段抛(自定义 provider),withRetry 先烧 ~1.5s 才进 createAgent.ts:450 trim-retry;中间件内部 TypeError 也被当网络错重试|isRetryable 前置排除 isContextLengthError/name==='ContextOverflowError';status undefined 收紧为按 name 判定|selftest:isRetryable(ContextOverflowError)===false

P2|loop|harness/createAgent.ts:628-748|无重复检测:同工具+同参数+同错误 recoverable 回灌无任何闸,只靠 maxToolRounds 硬停(默认 10 轮重复 LLM 调用)|主循环无 (tool,args,error) 重复计数(grep 全 harness 无 repeat/identical 逻辑);coreExecTool:519-522 工具错总转 ToolMessage 回灌继续|连续重复 (name,argsHash,errCode)≥3 → 注入强提示或提前终止|selftest:恒错工具 → 断言 ≤3 轮收口

P2|correctness|harness/createAgent.ts:575-579|createAgent.stream 非可重入(入口重置 state/debugLogs/spans),而 sdk.stream 无串行闸 → 并发 stream 互相摧毁运行中轮次|stream() 入口 state = createInitialState() + debugLogs.value=[];createChatSdk.ts:2180-2184 runSerial 只包 send/batch/switchSession,stream: core.stream 直通|sdk.stream 进 runSerial,或入口检测 in-flight 显式拒绝/warn|e2e:并发两个 stream → 断言排队或明确报错

P2|flow-divergence|harness/createAgent.ts:609,694|send/invoke 路径吞掉 createAgent 层 error 事件:SYSTEM_PROMPT_OVER_BUDGET(fatal 早退)/GARBLED_TOOL_CALL_EXHAUSTED(observable)只发 stream handler,send 返回空串无感知|invoke handler 仅收 done(createAgent.ts:813-821);这两处 onEvent 不走 sdk emit;send 拿到 '' 无 error 事件无 throw(send catch 的 fatal emit 链只覆盖抛错路径)|SYSTEM_PROMPT_OVER_BUDGET 改抛 AgentError(fatal)走 send 统一 emit+throw;或 invoke 把 error 事件转 reject|selftest:超大 systemPrompt + invoke → 断言抛错/error 可见

P3|doc-drift|harness/focus.ts:110-119|union 元素焦点视野段退化:聚焦 components.3(discriminatedUnion 节点)时 extractSchemaHint 对无 shape schema 仅渲染单行根描述,LLM 聚焦后失去子树结构视野(标待验证:describeSchemaNode union anyOf 分支是否覆盖 zod4 discriminatedUnion 的 _def.type)|getSchemaAtPath(schemaUtils.ts:81-83)数组取 element 返回 union 本体(非 null 故校验过);renderSchemaOverview 无 shape → fallback 单行(schemaUtils.ts:317-321)|union 焦点按 anyOf 选项渲染概览|browser:complex-demo 聚焦后断言视野段含组件 props

P3|maintainability|harness/middleware.ts:10-14|错误契约标注「规划中,未实现」:wrap 洋葱内层抛错时已执行 before/afterModel 副作用无回滚语义,仅 finally 保 afterAgent|middleware.ts 头注;createAgent.stream 对 modelHandler 抛错无 catch 直通调用方(try/finally 795-807);routeError 已导出但框架内置未消费|把「副作用不回填」写成显式契约,或在执行器落地 recoverable→feedback 路由|—

## 假设证伪结论

**H13(discriminatedUnion 降级 × focus PATH_DENIED):部分证伪 + 部分证实。** 拦截判定不受 union 降级影响——isUnderFocus(focus.ts:54-57)是纯字符串前缀判定(scope===focusPath || startsWith(focusPath+'.')),与 schema 无关,union 子树内写入判定正确,components.10 vs components.1 边界正确。影响面在校验侧:穿越 union 的深层路径(components.3.props.title)getSchemaAtPath 返 null(schemaUtils.ts:84-87)→ setFocus/addFocus/set_focus/snapshot 恢复四处校验一致拒绝(createChatSdk.ts:774,954,976,1361),只能聚焦到 union 元素节点本身(components.3 返回 union schema 本体通过校验);union 元素焦点视野退化见 P3 条。

**H17(工具错误无重复检测):证实,终止闸表述需修正。** 确无任何重复检测;但实际约束闸是 maxToolRounds 优先(每个失败工具轮 rounds++,createAgent.ts:747,默认 10 轮),maxIterations(max(rounds*3,30))是含格式自纠/verify 旁路的总闸;触顶后有 wrap-up 收口非静默——代价是约 10 轮同参数重复 LLM 调用白烧。

**H18 approval 部分:证实**(conflict 部分非本路范围)。approval 超时为可选且默认 0,humanConfirm 无任何超时;abort 联动仅在 signal 存在时生效,send/batch 无 signal;approval_request 被 events.ts:23 过滤不进 onEvent/hook,invoke 内部 handler 只收 done → send/batch + approval = 零可见永久挂起(见 P1 条)。

## 一句话总评

harness 核心的中间件执行序(before 正序/after 逆序/wrap 洋葱)、replaceSystem、abort 优先判定、_ctxRetry 单次防环均与契约一致无回归;主要风险集中在控制面覆盖不全(focus 可被 eval_script/整体写绕过、approval 挂起无兜底)与非流式 send 路径的终止/反馈保障系统性弱于流式路径。
