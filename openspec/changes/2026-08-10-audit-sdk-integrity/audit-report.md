# audit-report.md — SDK 完整性审计报告(基线 2.38.0)

> 审计执行:2026-08-10 · 方式:14 路并行评审代理(R1-R8 模块 + D/E/C/P/A/T 专项)+ 主审对 Top findings 逐条代码复核
> 基线全绿:selftest 1658 / e2e 451 / browser 40 / exports 12 / size 5(ESM 785.3KB / headless 336.1KB / IIFE 1799.3KB)
> 证据底稿:`streams/` 目录(14 路原始报告,含 file:line 证据链)
> 统计:**P0 ×1 · P1 ×27(去重合并后)· P2 ×64 · P3 ×33**;假设证伪 H1-H28 全部落结论(证实 19 / 部分 5 / 证伪 4)

---

## 一、P0(立即修)

### P0-1 子 agent allowedTools 永远选不到 vfs 等中间件工具 —— rag/html 能力包核心流断裂【已实测复现】
- **位置**:`createChatSdk.ts:1069`(`allTools: () => allTools`)+ `subagent.ts:231-237`(按名 filter)
- **机制**:传给 spawn/subagents 中间件的 `allTools` getter 指向 createChatSdk 局部池 `rebuildExtraTools()`(仅 builtin/user/action/humanConfirm/checkpoint/focus/mcp/skill 八源),而 **vfs 工具是中间件工具**(`createVfsMiddleware` 经 `mw.tools` 注入,不在该池)→ `getAllTools().filter(allow.has(name))` 恒落空
- **影响**(2.37 能力包发布即带):`createHtmlSubagent` 的 `['vfs_write','vfs_edit','vfs_rm','vfs_grep','vfs_read']` 与 `createRagSubagent` 的 `['vfs_grep','vfs_read','vfs_json_read']` **全部静默丢失**;dist 实测 use_html 子 agent 调 vfs_write 返回「工具不存在」;「代码正文→vfs」与「vfs 搜预注入文档」两条核心流断裂;CLAUDE.md 的 allowedTools 示例同样失效
- **修复**:getter 改指向 agent 合并池(`core.agent?.allTools`,参考 inspect 同款写法);过滤时同步排除 `use_<id>`/`load_skill`/`write_todos` 等框架工具(防反向泄漏 + 防 R5-P2「预声明链 depth 不透传」被激活)
- **测试补**:selftest 断言 html 子 agent 实际工具池含 vfs_write / rag 含 vfs_grep(现 sec-67 只测 config 形状,e2e 只测委派工具存在 —— 装配结果零覆盖,正是盲区)

---

## 二、P1(下个发布内修,按主题分组)

### 组 1:挂死与不可中断(「完成不了也没有反馈」—— 本次审计最薄弱域)

| # | finding | 位置 | 要点 |
|---|---|---|---|
| P1-1 | **approval/humanConfirm 在非流式 send/batch 路径永久挂起且零可见** | approval.ts:80 / humanConfirm.ts:94 / events.ts:23 / createChatSdk.ts:1438 | send 走 invoke 无 signal;approval_request 被 emit 层过滤不外发;humanConfirm **默认开** → headless+send 场景 LLM 一调 request_human_confirmation 即挂死,后续 send/switchSession/batch 全静默排队;approval timeoutMs 默认 0 |
| P1-2 | **MCP sse/websocket 握手无超时 → initDone 永挂,全入口瘫痪** | mcp/client.ts:94-101 / createChatSdk.ts:1994 | 协议层请求有 60s 保护但 transport 握手裸等 onopen;黑洞端点 → allSettled 不 settle → mount/send/switchSession/batch 全挂零反馈;createAgent 排 MCP 段后被连带;集成方无 timeout 配置可自救 |
| P1-3 | **unmount 不 abort 进行中流、不收口挂起 approval** | createChatSdk.ts:2145-2160 | 幽灵流继续烧 token/写 bind/afterRound 落盘,release 可能已 dispose store;approval 挂起中 unmount → Promise 永 settle 不了,shareContext 复用时污染下次 mount |
| P1-4 | **send 完全不可中断** | SendOptions(createChatSdk.ts:514)/ invoke 不传 signal | LLM 流停滞时调用方无退出手段(headless 无停止按钮场景唯一出路=刷新页面) |
| P1-5 | **队列饥饿(H26 证实)** | useChat.ts:204-218 / serialRunner.ts:13-20 | 队列推进与 runSerial 链推进都以前任务 settle 为唯一前提;stream 停滞/工具挂死 → 排队任务永不执行、零反馈;唯一脱困 stop() 还会清空整个队列(排队内容无声丢失) |
| P1-6 | **skills 远程 fetch 无超时 → load_skill 永挂拖死当轮** | skills.ts:100,162 | 裸 await fetch 无 signal;同仓 fetchDoc 已有 30s AbortController 先例此处漏配 |
| P1-7 | **LLM 流停滞无看门狗** | createAgent.ts:467 | 无 chunk 间隔超时 → loading 永转,唯一出路手动 abort |

### 组 2:会话生命周期与并发屏障

| # | finding | 位置 | 要点 |
|---|---|---|---|
| P1-8 | **storage 关(默认)时 resetSession 整体早退** | createChatSdk.ts:1549-1550 | 「清空对话」只清 messages,mission/workingMemory/focus/todos/vfs/checkpoint 全泄漏进新对话(旧 focus strict 拦截/旧 mission pin 带入新任务);违背同函数 docstring |
| P1-9 | **resetSession 是唯一不收口挂起冲突的生命周期路径** | createChatSdk.ts:1549-1564 | switchSession/unmount 均有 resolve;清空经 ChatHeader 可在冲突挂起时触达 → 旧工具 Promise 永挂,之后被 resolve 会跨会话写进新 bind |
| P1-10 | **core.switchSession 不 abort 进行中 stream + stream 未进 runSerial(H6 证实)** | createChatSdk.ts:1499-1544,2200 | P1-b 修复只在 UI 层 useChat.reset;headless 编程式切换:messages 被 splice 脱离、回复静默丢、在途工具写进新会话;UI 流式中 sdk.send 同样无闸 |
| P1-11 | **shareContext 串行闸每实例私有,共享 core 并发裸奔(H11 证实)** | createChatSdk.ts:2173,2066-2073 | 双实例可并发 send/switchSession 写同一 messages;一实例切会话不 abort 另一实例活跃流;unmount 无条件 keep_external 可替别的实例了结其活跃冲突 |
| P1-12 | **WebStorage 后端读路径裸 JSON.parse** | storage.ts:306,323 | 损坏记录 → load/listSessions 抛穿 → SDK 启动/切会话永久失败;违背「storage 永不冒泡」自述(写路径有 catch 读路径没有) |

### 组 3:主×子协同与串台

| # | finding | 位置 | 要点 |
|---|---|---|---|
| P1-13 | **主×子共享 dataOps controller:子 read 污染父 autoLock 基线(H19 证实)** | dataOps.ts:277,821 / subagent.ts:234 | 子工具=主 allTools 同一实例零拷贝;父委派前读 hash A,期间外部改过、子 read 刷新基线 → 父陈旧写**静默放行覆盖**(方向是放行而非误冲突)——「get 之后被改过→冲突」承诺对进程内 agent 间失效 |
| P1-14 | **spawn_agents 单子失败 → 整批结果丢失 + 孤儿继续烧(H20 证实)** | pool.ts:27-35 / subagent.ts:380-401 | Promise.all 任一 reject 整体 reject;已成功兄弟结果全丢,主 LLM 只见一条错误;在途孤儿不取消继续跑(可能继续写 bind) |
| P1-15 | **子 agent offload 与共享 vfs 完全脱节(H21 证实,机制比假设更重)** | createAgent.ts:510-517 / state.ts:112 | 子无 vfs 中间件 → offload 写入每次 stream 新建的一次性 `state.files`;子的 vfs_read 是主 vfsStore → 按提示回读**必 404、原文实际丢失** |
| P1-16 | **spawn 自授工具 + 子栈无 permissions/approval → 把关整体旁路** | subagent.ts:367-373,296-308 | spawn_agent 的 tools/writablePaths 参数由 LLM 运行时自选;子中间件栈不含主 permissions/approval → 配 `approval:{tools:['write']}` 的集成方被委派路径整体绕过 |
| P1-17 | **子 token 不计 usage + 子执行无超时(H28 证实)** | createChatSdk.ts:717-743 / budget.ts:41 | usage 仅主栈 sdk-events 累加 → automation tokenBudget 漏算全部子消耗(可 8 子×30 迭代);子挂死 → 父无限等,timeBudget 只在父 wrapModelCall 检查拦不住在途子 |
| P1-18 | **writablePaths guard 漏「patches 无 jsonPath 项」→ 子 agent 越界写根(H25 证实)** | subagent.ts:177-184 | 混合批量 `patches:[{set,jsonPath:'components.0.x'},{merge,无 jsonPath(作用于根)}]` → 无 path 项不收集不校验,paths 非空即整体放行 |

### 组 4:数据完整性与写链

| # | finding | 位置 | 要点 |
|---|---|---|---|
| P1-19 | **整体/根级读浅投影 → 嵌套未声明字段泄露(白名单护城河唯一破口)** | dataOps.ts:732 等 6 处 / schemaUtils.ts:119-125 | read 整体/get_data/query/search/eval 根/diff 用 projectBySchema 仅顶层 key 不递归;声明 key 内深层未声明字段(如 config.apiKey)整体读全暴露;子路径读与 history 整体都是深投影 —— 同数据两口径 |
| P1-20 | **ZodArray 段任意索引放行 → 负/非数字索引写静默成功零落地** | schemaUtils.ts:42-44 | components.-1.x 过白名单 → setByPath 挂非索引属性 → zod4 数组校验忽略 → 返回「已 edit」成功并刷新 hash,实际无变化(deleteByPath 有 /^\d+$/ 校验,写路径没有) |

### 组 5:控制面绕过

| # | finding | 位置 | 要点 |
|---|---|---|---|
| P1-21 | **focus strict 可被 eval_script(transform)绕过** | focus.ts:26-33 / dataOps.ts:638-686 | WRITE_TOOLS 不含 eval_script;聚焦下经脚本可改写任意路径/整体数据;usageHints 还主动推荐「批量重写大数组用 eval_script transform」;permissions.ts 同构缺漏 |
| P1-22 | **无 jsonPath 整体写/write({value}) 跳过聚焦拦截** | focus.ts:40-52 | extractScopes 无 jsonPath 返空 → for 循环空转放行;白名单限字段不限子树,与「范围收紧 strict」承诺冲突(与 P1-18 同型不同层) |

### 组 6:事件、类型与性能可感

| # | finding | 位置 | 要点 |
|---|---|---|---|
| P1-23 | **不传 onEvent 时 sdk.hook() 永远收不到流式事件【主审已复核】** | createChatSdk.ts:1571-1573 | `wrappedHandler = userOnEvent ? (e)=>{onEvent?.(e);emit(e)} : onEvent` —— emit 分支以构造时传 onEvent 为前提;headless 常见路径(无 onEvent+hook+stream)流式事件全丢;违背 hook 文档承诺 |
| P1-24 | **d.ts send options 只剩 {mission?},与 src 漂移(H7 活体实例)** | types/index.d.ts:870 + headless.d.ts:860 vs createChatSdk.ts:361,514 | src 支持 per-call interceptors/maxAutoRetries 且文档明写,TS 集成方传参编译报错但运行时支持;SendOptions 未导出 |
| P1-25 | **压缩 LLM 摘要同步 await 阻塞首 token ≤15s(+decide 6s 最坏 ~21s)** | summarization.ts:60 / useContextManager.ts:171 / contextPreset.ts:52 | 默认 enableLLMSummary=true,compressInput 先于首轮模型调用同步执行;触发条件=历史>0.5×window,恰是大 JSON 长流程场景;llmResolver 注释「不阻塞用户」与实现相悖 |
| P1-26 | **巨内容渲染冻结:流式每 delta 全文 marked+hljs+DOMPurify 重算,O(n²)** | useMarkdown.ts:67-68 / MessageContent.vue:11,97 | 无尺寸闸无节流;长回复+大代码块卡死主线程 |
| P1-27 | **capabilities.agentCompression 运行时存在但三处类型全漏(20/21 key)** | types/index.d.ts:780 + headless.d.ts:780 + createChatSdk.ts:227-248 | TS 集成方写 `capabilities:{agentCompression:true}` 报 excess-property 错,运行时却生效;e2e 走 JS 无类型检查故全绿;test-d _capKeys 只锁 17/21 |

> 注:R8 另报「DebugDrawer 日志列表生成期间不刷新」(mountChatDialog.ts:28,44 × createAgent.ts:298-314,shallowRef 同引用下传 prop)亦为 P1 级 UI 缺陷,计入组 6 共 6 项 —— **P1 总数 27**。

---

## 三、P2 汇总(61 条,按域压缩;完整证据见 streams/)

**循环/终止面**:工具错误回灌无重复检测(H17 证实,同工具同参同错烧满 ~10 轮才 wrap-up;主审定级 P2——有 wrap-up 收口非破坏,但 token 浪费大,**建议优先修**)/ wrap-up 收口 filter 掉全部 SystemMessage 与 P0-1 修复语义矛盾 / send-invoke 吞掉 SYSTEM_PROMPT_OVER_BUDGET 等 error 事件 / 被拒写入(SCHEMA_INVALID)也退出 planning 重置预算 / planPhaseRounds 按模型调用计数且跨 send 残留 / isRetryable 把无 status 错误(含 ContextOverflowError)当网络错空烧重试

**挂起面**:冲突挂起无超时 + 子引发冲突无归属 / setData 轮中调用 → autoLock 静默放行(H24)/ trim LLM 增强 unmount 后无取消仍写已销毁 store / fire-and-forget persist 无 catch = unhandled rejection 根因(browser teardown `connection is closing` 即此)/ dispose 不关 IDB 连接

**主×子**:子写入共享快照栈无归属(父 restore 可回退子成果)/ 进程内多 agent 并发写零冲突检测 / use_<id> 并发事件 taskId 混组 / allowedTools 可授 eval_script 绕 guard / draft_commit 在 SUB_WRITE_TOOLS 是死条目 / 预声明链 depth 不透传(P0 修复后将激活,需同步修)/ skill 附带工具每轮跨轮重求值 + 全量 rebind / focus × html 包叠加:聚焦时子写 html/x.vue 被 PATH_DENIED 误伤

**数据写链**:write({}) 配 resources 触发 TypeError 非结构化错误 / merge op 非对象 value 静默假成功 / eval 子树缺 isUnsafePath / interceptors 仅守高层 read/write(advanced 底层全绕过)/ eval transform fork 写链未共用 commitSetToBind / hashValue 双算冗余 + A3 惰性未做(单次小 patch 对几百 KB bind ≈ 6-7 次 O(N))/ checkpoint restore 不重置 lastReadHash → 误 VERSION_CONFLICT

**上下文**:setLlm 时 options.contextWindow 陈旧覆盖新模型声明(压缩阈值按旧窗口)/ setProtectedRefs 仅 stream 入口注入(send/batch/子绕过)/ 单条巨型 user 消息三层裁剪全不可裁 → 溢出 fatal 后留 messages 每次 send 重蹈(H27)/ 累积摘要只增不减 / preserve 块截 120 字丢 offload 路径引用 / estimateTokens 三处口径不一 / windowRatio 误配空转

**持久化**:setMission({}) 清空不落盘 → 刷新复活 / applySnapshot 对 messages/todos/wm 无结构校验 / draft 碎片无 TTL 跨刷新残留(H5)/ quota/evicted/degraded 全静默 / 多标签页同会话分叉(定性)/ hydrate 合并非替换 → vfs_rm 删的种子复活 / switchSession 补 persist 不含 messages/todos / enforceLimit O(文件数²)

**目标漂移**:mission 一次锚定无完成检测(H1 证实,陈旧锚 + pin 文案反向加压)/ 纯查询任务永不退出 planning + 回灌「去 write」错误引导(H2 证实)/ PIN_SEGMENT_NAMES 缺 focus/resourcesPin(预算 drop 时静默丢段)/ recall 与 mission 无交叉校验 / 默认形态重于定位(D4:默认 13 项 opt-out 能力 + ~24 工具 + usageHints ~3.5-4K token/轮;有逃生舱,建议定位表述校准 + e2e 锁定基线防膨胀)

**性能**:每模型轮全上下文 estimateTokens ≥2-3 遍扫描 + CJK regex 分配压力 / checkpoint messages 每轮整体 clone(H14)/ persistRuntime 每轮全历史 JSON round-trip / tracker steps 无 run 上限(自然受子轮数约束,降级关注)/ eval 子树 stringify 判超时档

**UI**:UI 流式路径绕串行闸(双 ReAct 并发跑同一 messages)/ reset() 不等幽灵流收口 → 双流 / 退出动画期间再 mount → cs-leaving 不清透明不可交互 / 排队任务丢 focuses 快照 / MessageList 无虚拟化 + 每 delta 全列表 diff / decodeURIComponent 无 try/catch(畸形 data-code 丢工具栏)

**安全**:沙箱原型链逃逸残留(`(function(){}).constructor` 不在静态扫描,浏览器相关待实测)/ domTool href/src 值敏感参数不扫描 / glob 单星跨段匹配(permissions 语义与惯例不符)

**测试盲区(T)**:e2e 因 FAKE_LLM 不跑循环系统性退化为装配反射层(19 模块仅 2 个驱动真 ReAct);冲突介入闭环三层无运行时覆盖 / 观察层无集成断言 / agentCompression 接线零测试 / trim 异步增强 + context_trimmed 零断言 / focus 子 agent 运行态继承零断言 / use_<id> 委派执行零覆盖 / events 投递零断言

---

## 四、P3 汇总(28 条,摘要)

文档漂移:CLAUDE.md vfs「三池」vs「四池」(:99/:109)/ offload「固定 6000」实为自适应 2000-20000 / interceptors「补充字段写回不丢失」与实现相反(2.15 起丢弃)/ get_dom 白名单表述窄于实现 / usageHints 称 spawn「只读」与实际写授权参数不符 / mission-todos 装载序注释不实 / CLAUDE.md 乐观锁「其他 agent 改过→冲突」对进程内不成立
代码卫生:ConflictInfo.snapshotId 恒 0 / read jsonPaths 缺 isUnsafePath / getSchemaTopKeys 重复解包 / ADD_ATTR target 未补 rel / CodePreview js 分支未转义 </script> / fetchDoc 无响应体大小闸 / envTool 摘要输出完整 href(可能含 OAuth token 参数)+ window.name 可读 / audit 条目无 agent 来源 / DebugDrawer subagent tab 不 infoTick++(运行卡片不自动刷新)
测试:Worker 生命周期零断言 / browser customize 只断言可见性 / e2e 冲突文档表述与强度不符
流程卫生:chatdialog-component-split openspec 索引失真(标 0/46 暂缓,代码已实施)—— A 专项复核中

---

## 五、H1-H28 假设证伪结论

| # | 结论 | 要点 |
|---|---|---|
| H1 | **证实** | mission 只 capture 首条任务消息,捕获后永短路,无完成检测;pin 文案反向加压 |
| H2 | **证实(部分)** | 退出仅依赖写工具成功 + 文案误导;usageHints 已豁免「查值」类简单任务,缺口在多步调研 |
| H3 | **证实** | hashValue=cyrb53(safeStringify 全量),单次 autoLock 写 3-4 次 + deepClone×2 + safeParse,A3 惰性未做 |
| H4 | **证伪** | enforce 已覆盖 eval 子树:7 处写调用点全部传 protectedCtx,无遗漏 |
| H5 | **部分证实** | drafts 随 vfs 持久化跨刷新残留,仅 commit 成功删除;有 2MB LRU 兜底无无限增长 |
| H6 | **证实** | core.switchSession 无 abort;P1-b 修复仅在 UI 层;stream 未进 runSerial |
| H7 | **证实+活体** | d.ts↔src 结构永不互比;活体=send options 漂移;字段门禁 Pick 只锁 37/60(事故主角 getActiveSubagents 恰不在锁定集) |
| H8 | **证实(影响有限)** | steps 无上限但受子轮数天然约束,每 step ~80B |
| H9 | **证实** | CLAUDE.md 三池/四池不一致 + offload 阈值/interceptors/get_dom 等多处漂移 |
| H10 | **证伪(保护成立)** | url+host 禁止校验真实存在,5 条绕过面逐一排除;capability gating 完整 |
| H11 | **证实** | shareContext 无跨实例屏障:串行闸私有/切会话不 abort 对方/unmount 替对方 resolve 冲突/release 关资源时流在途 |
| H12 | **证实(有界)** | decide ≤6s + LLM 摘要 ≤15s 同步阻塞首响应;但 decide 循环有 3×2 上限(「无上限」疑点证伪) |
| H13 | **部分** | 拦截判定是纯字符串前缀与 schema 无关(不受 union 影响);影响在校验侧:穿越 union 深层路径四处校验一致拒绝,只能聚焦到 union 元素节点 |
| H14 | **证实** | checkpoint save 每轮整体 clone messages,栈深 5 → 5× 全历史,Phase B 未做 |
| H15 | **证伪** | ChatSdk 60 项/AgentCore 59 项逐一对上,且受 tsc 结构检查保护;2.38 型事故在 src 层已不可复发,风险仅在 d.ts↔src 轴 |
| H16 | **证伪** | GC 只删 large_results/ 前缀;resources 池永不碰;四组 pin 段均不携带 large_results 引用 |
| H17 | **证实** | 无任何重复检测;实际闸是 maxToolRounds(默认 10 轮)+ wrap-up 收口 |
| H18 | **证实+放大** | 不止 approval:默认开的 request_human_confirmation 同走 approval_request;UI 非流式模式同样中招;conflict 侧无此问题 |
| H19 | **证实** | 子工具=主同一实例零拷贝;危害方向是**静默放行覆盖**而非误冲突 |
| H20 | **证实** | runPool Promise.all 无单项容错;孤儿子不取消继续跑 |
| H21 | **证实(更重)** | 非 LRU 问题:子 offload 写入一次性 state.files,回读必 404 原文丢失 |
| H22 | **证实** | 截断走 wrap-up 有最终回复,但原因/未完成事项只进 LLM system,用户侧无结构化提示 |
| H23 | **证实(更糟)** | 协议请求有 60s 保护但 transport 握手无超时 → 黑洞端点永挂 |
| H24 | **证实(静默放行分支)** | setData 后 lastReadHash=undefined → autoLock 写完全跳过锁校验直写 |
| H25 | **部分证实** | jsonPath 形态覆盖完整;盲区在工具面:draft_commit 死条目、eval_script/resource_update 可绕 guard |
| H26 | **证实** | runSerial 与 useChat 队列均无超时/可见性;stop() 会清队列(排队内容无声丢失) |
| H27 | **证实** | 三层裁剪对单条巨型 user 全不可裁;fatal 后巨型消息留 messages → 每次 send 重蹈,会话卡死 |
| H28 | **证实** | 子 token 不计 usage + 子无超时 + timeBudget 拦不住在途子 |

---

## 六、F11 任务完成保证矩阵(高危格子)

| 格子 | 判定 |
|---|---|
| approval 把关 × 非流式 send | **不终止 + 无反馈**(P1-1) |
| approval 把关 × unmount | **不终止**(P1-3) |
| 任意场景 × LLM 流停滞 | **不终止**(P1-7 无看门狗) |
| 子 agent 委派 × 流停滞 / automation 批处理 × 子挂起 | **不终止且传父 + 预算漏算**(P1-17) |
| MCP 接入 × 挂载 | **不终止**(P1-2) |
| 大 JSON draft × 轮预算截断 | 终止但反馈弱(wrap-up 靠 LLM 自觉) |
| 多步规划 × 工具持续失败 | 终止但烧满预算(无重复检测) |
| fatal / 上下文溢出 | 终止 + 可见 ✓(send 路径无 error 事件为次要缺口) |
| approval 拒绝 / conflict keep_external / abort | ✓ 结果文本明确、partial 保留 |

**结论**:终止预算闸(循环面)基本健全;**挂起面系统性薄弱**——一切依赖人工 resolve 的挂起点在非流式/headless 路径零可见,send 不可中断,unmount/MCP/流停滞无收口与看门狗,「完成不了」时常连「告知卡在哪」都做不到。

---

## 七、修复拆分建议(§5)

### 立即立 change(P0 + 同域 P1):**fix-subagent-tooling**
P0-1(allowedTools 装配断层)+ P1-16(spawn 自授收紧/子栈继承 approval·permissions)+ P1-18(guard 补 patches 无 path 项)+ P1-21/22(focus/eval 同型绕过)+ P1-15(子 offload 桥接)+ 同步排除 use_<id> 防 depth 链激活。同一代码域(subagent.ts + createChatSdk 装配段),一次修完。

### 下个发布 P1 批次(建议 3 个 change):
1. **fix-hang-and-feedback**(组 1):approval/conflict 超时与可见性(send/batch/headless)/ MCP 握手超时 / unmount·switchSession abort 收口 / send signal / 流停滞看门狗 / skills fetch 超时 / 队列饥饿可见性
2. **fix-data-integrity**(组 2+4):resetSession !store 早退 + 冲突收口 / WebStorage parse 守卫 / shareContext 串行闸上移 core / 深投影统一 / ZodArray 索引校验 / setLlm 窗口陈旧 / checkpoint restore 重置 hash
3. **fix-main-sub-isolation**(组 3):per-caller hash 基线(或最小修:委派返回后强制父重读提示 + usageHints)/ spawn_agents allSettled 语义 / 子 usage 回传 + 子执行超时 / 快照与审计归属标记

### 组 5/6 并入上述批次:hook 事件一行修(P1-23)+ d.ts 同步(P1-24 send options、P1-27 agentCompression)+ **新增 tests/types-alignment.ts 双向门禁(防同型复发)** + 压缩异步化「模板先行 + LLM 后台替换」(P1-25,照 trim-llm 既有模式)+ markdown 节流/降级(P1-26)

### P2 → deferred.md 分组登记;P3 文档漂移本次直接改(CLAUDE.md 三池/四池等)

---

## 八、手动验证项清单(真 LLM / 浏览器,不阻塞审计收口)

1. 沙箱原型链逃逸浏览器实测(Chrome/Firefox 分路,`Worker` 在 Node 不可测)
2. adversarial verify 子 agent 无 signal —— 真 LLM 中途停止验证(P2)
3. 多标签页同 agentId+sessionId 并发写 IDB 分叉实测
4. draft_write 真 LLM 长任务 + 草稿残留跨刷新行为
5. MCP 真实 server 握手超时修复后的降级路径

---

## 九、主审复核记录(对抗核实)

以下 findings 由主审独立读码复核(非仅采信代理结论):**P0-1**(allTools getter 池构成 + vfs 中间件工具注入方式,代码双证)、**P1-23**(wrappedHandler 条件分支逐字核实)、**P1-15**(offload 用 ctx.state.files + state 每次新建)、**P1-8**(resetSession 首行 `if (!store) return`)、**P1-19**(projectBySchema 仅顶层 key 循环)、**子中间件栈不含 vfs/permissions/approval**(subagent.ts:296-308)。R5 的 P0 另有 dist 产物运行时复现。
定级调整留痕:E 路「无重复检测」原报 P1 → 主审降 P2(wrap-up 有收口,危害=token 浪费非破坏,但标注建议优先修);R8「markdown O(n²)」与 R7 同题异级(P1/P2)→ 采 P1(主线程冻结用户可感)。

---

## 十、A 专项(结构健康)结论

### H7 类型门禁:假设成立,盲区坐实 + 两个活漂移
- 各门禁职责:test:exports 抓「src 有 d.ts 无」(但 **d.ts 多余名只打 ℹ 不 fail**,exports-consistency.mjs:42);test:types 只编 types/*.d.ts + test-d(字段级 Pick 仅锁 ChatSdk 37/59、capabilities 17/21);src 全量 tsc 抓内部一致性(`: ChatSdk`/`: AgentCore` 双注解 → **H15 机械成立,src 内部漏项不可复发**)
- **盲区**:d.ts ↔ src 结构对齐零门禁(两者从不同编)—— 本次抓到两个活例:**agentCompression 开关三处类型全漏(P1-27)** + **send options 漂移(P1-24)**,与 2.38 getActiveSubagents 事故同型
- **修法(≈100 行)**:新增 tests/types-alignment.ts 双向条件类型互判 d.ts ↔ src 内联接口(配同时 include src+types 的 tsconfig)+ _capKeys 扩到注册表全 21 名 + exports-consistency 多余名改 fail

### A2 上帝文件评估:不全拆,低风险三刀 + 门禁守护
buildCore 1268 行闭包耦合重(core 定义前被 vfs persist/syncUserSkills 闭包反引、allTools 多处重赋值),整体拆回归风险>收益;2.38 事故属类型面漂移非尺寸逻辑 bug。**建议**:① 4 个大接口(≈700 行)挪独立 types 文件 ② sdk-events 中间件 + matchDataOp 挪 sdk/events.ts ③ focus 四工具挪 focus 中间件 —— 行为中性约减 35%,本体与代理 return 不动,靠 types-alignment 门禁守护。行段清点见 streams/a-structure.md A-9。

### 中间件顺序契约(A-4)
代码实际序 = …subagents→augmentSystem(150)→mission→workingMemory→focus→resourcesPin→contextInspector→用户→budget→sdk-events(pin 段全 Infinity 尾随);与 CLAUDE.md 声称的 pin 相对序一致 ✓,但 createChatSdk.ts:1229 注释「mission 在 todos 前」不实(P3)。建议:要么给 pin 显式 priority 锁意图,要么改注释,勿留双真相。

### A4 推后项复核(逐项核实结论)
| 项 | 结论 |
|---|---|
| P1-d 流式重试重复 emit | ✅ 2.24.1 已修(仅 stream 启动重试)→ 移出清单 |
| css exports style.css 404 | ✅ 已修;**残留**:headless 构建 assetFileNames 把任意 css 映射 style.css,将来 headless 子树出现 css import 会覆盖 UI css(A-5,P2) |
| setLlm modelCaps offload 重算 | ✅ 已修(setModelCaps + setContextWindow 回灌)→ 移出清单 |
| A3 惰性 hash | 未实施,实测每写 2-3 次全量 hash —— **推后清单里最值得做的一项** |
| A2 快照字节 / A4 子路径 hash / B1 draft 中间校验 / B2 DRAFT_EVICTED(现仅静默 LRU)/ C1 多草稿 / C2 eval 子树 patches | 均未实施,触发条件仍成立,维持 P2(A4 前置顾虑已消除可解绑评估) |
| 投影深度不对称 | 仍成立 —— 已被本审计升为 P1-19 |
| 中文 recall 分词 | 仍存在(非 CJK 分隔 → 中文连续段成整 token),低成本方向 CJK bigram |
| checkpoint messages Phase B | 未实施,长会话仍成立 |
| p2-refactor ①拆分 / ②createAgent 契约化 | ①改「门禁+三刀」②维持暂缓(YAGNI) |

### 流程卫生(A-10/A-11)
- **chatdialog-component-split**:拆分已全实施(chatContext + message 7 原子件 + 9 区块 slot/sections 全就位),仅 §9 examples/custom-dialog-demo 拼装示例未做;proposal 标「未实施」/tasks 46/46 未勾均失真 → 回填 + 归档,demo 按 deferred 触发条件(集成方要求拼装)未出现,标注删除或保留
- **deferred.md 陈旧**:placeholder-protected(2.32 已发布)、agent-driven-compression(2.33 已发布)、chatdialog(已实施)三项已落地仍标「暂缓 0%」→ 清理;发布 checklist 加「核对 deferred 表」一步
- 另:d.ts maxMemoryRounds 注释「默认 50」实为 30(2.34 改,A-12 P3);AgentCore.send 签名陈旧 + ~10 处 onClear 陈旧注释(A-8)

**A 专项总评**:结构主体健康(src 内 tsc 双注解机械保底、声明式排序自洽);系统性缺口只在「对外 d.ts 与 src 手动同步无任何门禁」——补双向类型对齐测试 + A3 惰性 hash 是投入产出比最高的两件事。

---

## 十一、二审复核(2026-08-10,对初审报告本身的评审)

> 复核方式:主审独立读码核实(`createAgent.ts` 工具并发/abort 段 + `sandbox.ts` 静态扫描列表 + `storage` applySnapshot + `runPool`)+ 对初审结论做逻辑复核。目的:**校准定级、补遗漏、完善审查方向**,不推翻初审。核实结论已并入 11.3/11.4,疑问标 ❓ 待拍板。

### 11.1 总体评价
- **诊断扎实**:P0 + 组 1/3 的 P1 均有 file:line 证据链 + 主审已复核,可信度高;H1-H28 证伪 4 条(H4/H10/H15/H16)证据充分,体现了审计的克制(不夸大)
- **拆分清晰**:§七 的 fix-subagent-tooling + 3 批次 P1 主题划分可操作
- **三处短板**:
  1. **并发/原子性面近乎空白**:全报告默认「单 agent 串行 ReAct」视角,`maxParallelTools>1` 同轮并发写、同轮连续写的乐观锁交互只字未提(11.4-N1)
  2. **安全定级缺论证**:沙箱逃逸列 P2 但未交代"为何不是 P1"——实际是网络层兜底使其可控,这个推理链不写出来,读者会误判为疏漏(11.3-S1)
  3. **审查方向未自检**:D/E/C/P/A/T 六专项外仍有并发原子性 / 安全纵深 / 版本迁移 / 资源累积 / 配置健壮五维未覆盖(11.5)

### 11.2 建议合理性复核

| 项 | 初审建议 | 二审判定 |
|---|---|---|
| P0-1 修复(getter→合并池) | allTools getter 指向 `core.agent?.allTools` 合并池 + 排除 `use_<id>`/`load_skill`/`write_todos` | ✅ 合理。「排除」一行的**必要性**与 P1-16(spawn 自授)是同一攻击面——若 spawn_agent 的 `tools` 参数能覆盖子 agent 默认只读白名单,LLM 可自授 `use_<id>` 激活 depth 链。故 P0 修复**必须顺带收 P1-16**(否则排除了也被 LLM 绕过)。建议在 fix-subagent-tooling 里把「排除」改为**源头上禁止子 agent 工具池含框架/委派工具**(装配期 filter,非运行期) |
| fix-subagent-tooling 打包 P1-21/22(focus 绕过) | 归入子 agent change | ⚠️ **建议改主题名**。P1-21/22 代码在 `focus.ts`/`dataOps.ts`,与子 agent 无直接耦合;相关性只在「都属工具授权/拦截面」。要么改名 `fix-authorization-surface`(授权与拦截面完整性),要么把 P1-21/22 挪到 fix-data-integrity(与写链同域)。我倾向前者——P0/P1-16/P1-18/P1-21/P1-22/P1-15 共同主题是「谁能写什么」的拦截面 |
| fix-hang-and-feedback(组1,7 项一个 change) | approval/MCP/unmount/send signal/看门狗/skills fetch/队列饥饿 | ⚠️ **建议先出 design**。这 7 项的根因是同一个架构缺口:「依赖人工 resolve 的挂起点在非流式/headless 路径零超时零可见」。逐项打补丁会得 7 套超时闸;应先定一个统一机制(超时默认值表 + 可见性事件约定 + abort 收口契约),再落地。否则改完各自口径不一 |
| P1 拆 3 个 change | hang / data-integrity / main-sub-isolation | ✅ 主题清晰,粒度合理(不必合并) |
| P2→deferred.md 分组登记 | — | ✅ 合理。但建议登记时标注「触发概率/复现条件」,否则 deferred 易成冷宫(很多 P2 触发条件极窄,长期不修可接受,需显式说明) |
| P3 文档漂移直接改 | CLAUDE.md 三处等 | ✅ 已做 |

### 11.3 定级校准建议

| 编号 | 现级 | 建议 | 理由 |
|---|---|---|---|
| S1 沙箱原型链逃逸残留 | P2 | **维持 P2,但补论证** | `(function(){}).constructor` 原型链取 Function **确实可达任意代码执行**(静态扫描只拦 `Function(`/`new Function`/`eval(`,未拦 `.constructor`);但 `lockSandboxGlobal` 已锁死全部外发通道(fetch/XHR/WebSocket/importScripts/sendBeacon/EventSource/BroadcastChannel/indexedDB/Worker)→ 纵深防御使其**发不出数据**,危害受控。报告只写"残留"未交代兜底链,读者会误判。**升级触发**:集成方加 CSP 放宽 / 新增侧信道(如 postMessage 到宿主 window,但 Worker 无 window 不可达)/ 沙箱引入网络回包 |
| markdown O(n²)(P1-26) | P1 | 维持 P1 | 主线程冻结用户可感,长回复必现 |
| 压缩同步阻塞首 token(P1-25) | P1 | 维持 P1 | 大 JSON 长流程场景必经,~15-21s 首响应 |
| ❓ LLM 流停滞无看门狗(P1-7) | P1 | **维持 P1,但与组1 统一设计** | 看门狗超时值需与 approval/MCP 超时一致,否则体感割裂 |

### 11.4 遗漏补充(二审新发现,均已读码核实)

> 以下为初审未覆盖、二审读码确认成立的问题。定级为建议,待并入主表。

| 编号 | finding | 位置 | 要点 | 建议级 |
|---|---|---|---|---|
| **N1** | **同轮/并发多写的乐观锁连环冲突** | createAgent.ts:715 runPool + dataOps autoLock | `lastReadHash` 基线一轮内不刷新:LLM 一轮输出 `[write A, write B]`(maxParallelTools>1 并发 或 串行),A 写成功 hash→H',B 的 expectedHash 仍=旧基线 → B **必 VERSION_CONFLICT**。即"agent 自己连续写自己"被误判为外部冲突。窄但真实(autoLock 默认开 + LLM 一轮多写工具调用);与 H19(主子共享基线)同型——根因都是「乐观锁基线对进程内连续写不刷新」。与组3 P1-13 关联,建议并入 fix-main-sub-isolation 一并设计「per-caller / per-round 基线刷新」 | P2(窄触发) |
| **N2** | **审计覆盖面缺口:write/draft/eval 未审计** | dataOps.ts / onAudit 回调 | CLAUDE.md 称 onAudit「set/edit/delete/restore 全程追溯」,但高层 `write`、`draft_write`/`draft_commit`、`eval_script`、`resource_update` 是否产审计条目未核实;P3 已提「audit 条目无 agent 来源」。建议补一次「审计事件完备性」专项(哪些写路径发 audit / 是否含 agent 归属 / headless 无 onAudit 时是否有兜底日志) | P3 |
| **N3** | **配置非法值无防御** | createChatSdk options resolver | `contextPreset:'unknown'`、`maxToolRounds:-1`、`maxParallelTools:0`、`toolMode:'foo'` 等非法值的行为未核实(可能静默走默认 / 可能崩)。集成方误配无 fail-fast。低优先级,但属「配置健壮性」维度空白 | P3 |
| **N4** | **reactive 深度代理对大 bind 的性能开销未量化** | dataOps bind(reactive) | bind 是 Vue reactive,几百 K JSON 深度响应式追踪 + read 返回值是否触发二次代理化(toRaw?)未核实。若工具每次 read 都对大对象做深度代理包装,O(N) 开销 × 每轮多次 read 可能成为隐性瓶颈。需 profiling 定级 | P2(待量化) |
| **N5** | **wrap-up 收口的 `pendingFormatRetry` 与 rounds 预算交互** | createAgent.ts:685-700 | DSML 格式重试设 `pendingFormatRetry=true` 绕过 rounds 预算给 LLM 重发机会,注释自承「实测 DSML 在 rounds 耗尽后出现」。这意味着格式退化与工具轮耗尽可叠加 → `maxFormatRetries × maxIterations` 实际上界比文档宣称的 maxIterations 更大。无死循环(maxIterations 兜底),但预算语义与文档不符 | P3 |

> **二审落地补记(2026-08-11)**:实施 A 专项 types-alignment 双向门禁(d.ts↔src keyof 互判)时,**又抓到 3 处审计与既有门禁均未发现的漂移**—— src `ChatSdkOptions` 有而两 d.ts 无:`humanConfirm`(主动征询开关)/ `decisionTimeoutMs` / `decisionMaxTokens`(agentCompression 决策配套)。与 P1-24/27 同型,印证「d.ts↔src 零互比」是系统性缺口;已随 P1-24/27 一并同步,门禁归零。此 3 项不计入原 P1×27,属门禁增量发现。

### 11.5 审查方向完善(新增五维,未覆盖盲区)

初审 D/E/C/P/A/T 六专项的盲区。建议下一轮审计(或本轮 fix change 的验证)补:

| 维度 | 覆盖什么 | 预期产出 |
|---|---|---|
| **CA 并发原子性** | maxParallelTools>1 同轮并发工具的隔离 / 同轮连续写的锁交互 / abort 时 in-flight 工具的取消语义 / 批量 patches 原子回滚边界 | 可能藏 1-2 个 P1(N1 升级版) |
| **SE 安全纵深** | 沙箱逃逸定级论证 + 浏览器实测 / JSONPath 注入(特殊路径越界)/ DOMPurify ADD_ATTR 完整性(rel=noreferrer)/ 可观测层(DebugDrawer 日志)生产泄漏 / onAudit 数据脱敏 | 沙箱 S1 定型 + 2-3 个 P2 |
| **VM 版本与迁移** | data.schema 运行时替换后旧快照兼容 / 持久化数据跨 SDK 版本 hydrate(messages 结构演进)/ applySnapshot 版本号机制缺失 / 旧版 Focus 归一化的系统性 | 1-2 个 P2(存量结构校验缺口) |
| **RE 资源长期累积** | 长会话(>100 轮)内存增长曲线 / sdk.hook 监听器忘取消累积 / vfs 被引用保护不收敛的 1.5× 阈值合理性 / reactive watch/computed 累积 / blob URL(sandbox)是否每次 revoked | 量化基线 + 1-2 个 P2 |
| **CO 配置健壮性** | 非法配置 fail-fast(N3)/ capabilities 组合矩阵覆盖(如 verify+approval+focus 三开)/ preset 与显式 options 冲突时的优先级 | P3 为主,防集成方误配 |

### 11.6 疑问清单(❓ 待主审/用户拍板)

1. **❓ P0 修复排除 `use_<id>` 的实现层**:装配期 filter(推荐,源头禁)还是运行期 filter(防御性)?——与 P1-16 收紧方式绑定
2. **❓ fix-subagent-tooling 改名 `fix-authorization-surface`?**——P1-21/22(focus)是否归此 change,还是挪去 fix-data-integrity
3. **❓ fix-hang-and-feedback 是否先出 design 定统一超时/可见性机制?**——7 项的根因同源,逐项补丁怕口径不一
4. **❓ N1(同轮多写连环冲突)归 fix-main-sub-isolation 还是单列?**——与 H19/P1-13 同根,合并设计 per-caller 基线更彻底
5. **❓ SE/VM/RE/CO 五维是现在补审,还是等下轮审计?**——CA 可能有 P1,建议本轮 fix 验证时顺带覆盖;其余可待下轮

> 二审总评:初审质量高、可信;主要增量是**并发原子性面(N1/CA 维度)**与**安全定级论证(S1)**,以及**审查方向的自检(11.5 五维)**。建议 fix change 实施时,把 11.4 的 N1 纳入主表、11.2 的拆分/改名建议落实,11.5 的 CA 维度作为 fix 验证的一部分顺带覆盖。
