# 活跃 Changes 优先级索引

> **2026-08-14 发布 3.7.0**(minor):`pagebuilder-default-html-agent` + `ca-concurrency-per-call-context` 实施完成并归档 —— ① **presets.pageBuilder 默认带 HTML 代码子 agent**(spread 一步 = 完整页面搭建能力;`subagents` 用 getter 每次新建防装配期回填 writablePaths 跨实例污染共享单例;显式传 subagents spread 覆盖即替换);② **writablePaths 推断失败语义 throw → warn + 优雅剔除**(schema 无 code 数组时 html agent 自动剔除不崩集成,编排注入自然走「无 html agent」分支);③ **CA 并发组 P2×2 清零**(per-call context 通道:中间件 `wrapToolCall` 写 `ctx.callConfig` → coreExecTool 经 RunnableConfig.configurable 透传到工具 fn 第二参 —— dataOps `__pgDataScope` 乐观锁 scope token(ambient 兜底,~24 处线程化)+ subagent `__pgSubagentCall` signal/emit/logSink(闭包单变量降 fallback);zod 重建 args 对象故 args 注入不可行;默认串行行为零变化)。selftest 1947 / e2e 580 / browser 53。见 [`archive/2026-08-14-pagebuilder-default-html-agent/`](./archive/2026-08-14-pagebuilder-default-html-agent/) + [`archive/2026-08-14-ca-concurrency-per-call-context/`](./archive/2026-08-14-ca-concurrency-per-call-context/)。

> **2026-08-14 发布 3.6.0**(minor):`writablepaths-infer-mcp-timeout` 实施完成并归档 —— ① **createHtmlSubagent `writablePaths` 可选化**(未传时装配期 `inferWritablePaths` 从 schema 顶层扫「数组元素含 codeField string」路径回填,console.info 留痕;显式传入优先;开放 schema/嵌套容器/点路径 codeField 推断不出 → warn+throw 显式传,宁失败不猜错)集成降门槛:HTML 能力包最小配置 = `createHtmlSubagent()` 空调用;② **MCP callTool 超时闸**(`mcp[].callTimeoutMs` 默认 60s,独立于握手 15s;超时该次调用作废回灌 LLM 自纠不重试不断连;补 2.39.0 挂起收口三契约漏网项)。selftest 1944 / e2e 575 / browser 53。见 [`archive/2026-08-14-writablepaths-infer-mcp-timeout/`](./archive/2026-08-14-writablepaths-infer-mcp-timeout/)。

> **2026-08-14 发布 3.5.0**(minor):`html-agent-craft-notes` 实施完成并归档 —— **组件工匠笔记**(`__pgNotes` sidecar:子 agent 收口 `[note]` 行沉淀(wrapModelCall 捕获收口文本进 state `__pgFinalText`)+ 文件地图注入「前任的交接」(📝 笔记×N + 最近 1 条),同组件跨委派设计意图持续;craftNotes 默认开可 opt-out)+ 主 agent 偏好转述(task 规格化 ⑤ 历史偏好要素)+ html 子 agent 终稿纪律/视觉锚。同批:**严格 CORS 网关开箱兼容**(剥 `x-stainless-*` 头,主/子 agent 全路径)、子 agent `extraConfig`/`extraBody` 透传修复、html-page-demo 点击拾取修复、mcp-demo 双模式(RAG 知识库/mock)、无 html agent 复杂多组件 e2e(10 断言:建页/调序/改纯代码/层级移动)。selftest 1931 / e2e 569 / browser 53。见 [`archive/2026-08-14-html-agent-craft-notes/`](./archive/2026-08-14-html-agent-craft-notes/)。

> **2026-08-14 发布 3.4.0**(minor):`html-subagent-open-schema` + `html-agent-thinking-taming` 实施完成并归档 —— ① createHtmlSubagent `codeField`(默认 'code',嵌套如 'props.html_code' 适配开放 schema)+ 装配期命中校验;② 主 agent 编排**自适应注入**(零配置:有 html agent→委派 htmlOrchestratorPrompt(id)/ 无 agent+code 字段→htmlDirectWriteFallback+warn / 开放 schema opt-in;opt-out `orchestratorPrompt:false`);③ html 子 agent 过度思考治理(task 规格化 4 要素(实测完全生效)/ validate_code jsonPath 零重传(**schema/实现/skill 三处统一 jsonPath 首选** —— 实测工具 schema 反向引导会覆盖 system prompt 的教训)/ 写前简述);**真 LLM 多场景 A-E(新建/调换/层级/属性/聚焦)端到端全跑通**。同批:schema_data 栈溢出修复(容器 children 自引用 → describeSchemaNode depth+visited 双截断)+ complex-demo e2e 组件操作 3 场景 + custom 拾取修复(iframe pointer-events)+ 编排双重注入修复 + 文档 D 阶段补齐。selftest 1905 / e2e 556 / browser 51。见 [`archive/2026-08-13-html-subagent-open-schema/`](./archive/2026-08-13-html-subagent-open-schema/) + [`archive/2026-08-14-html-agent-thinking-taming/`](./archive/2026-08-14-html-agent-thinking-taming/)。

> **2026-08-12 发布 3.0.0**(breaking major):`code-as-data-asset` 实施完成并归档 —— **createHtmlSubagent 改单模式**(代码作为 data 资产:`code` 字段进服务端 DB + vfs 作编辑工作副本 + 框架 beforeAgent checkout/afterAgent commit 自动搬运,主 agent 透明 + `__pgId` 无感注入 + 主 scope read 摘要)。**breaking**:去 `onComplete`/`codeRef`/`codeSnapshots`,集成方迁移 `codeRef`→`code` 字段。selftest 1849 / browser 端到端 3 passed。详见 [`archive/2026-08-12-code-as-data-asset/`](./archive/2026-08-12-code-as-data-asset/)。

> **2026-08-11 audit-five-dimensions(已归档)**:SDK 五维二审(CA 并发原子性 / SE 安全纵深 / VM 版本迁移 / RE 资源累积 / CO 配置健壮)。基线 2.38.0,补审六专项外盲区。**真 P1×4 已修**(均含 3.0.0):P1-1 并发写注释(createAgent `maxParallelTools` warn)/ P1-2 glob `[^/]*`→`[^.]*`(permissions)/ P1-3 WorkingMemory restore 字段守卫 / P1-4 maxToolRounds clamp;**P2×25 / P3×16 登记 `deferred.md`**(6 分组:SE 加固 / VM 迁移 / CO fail-fast / CA 并发 / RE fire-and-forget / P3 卫生);§五不动项 VM-F1(版本号架构)/ CO-preset(JS spread 文档)。见 [`archive/2026-08-11-audit-five-dimensions/`](./archive/2026-08-11-audit-five-dimensions/)。

> **2026-08-11 发布 2.42.0**(minor):**内置深色主题 `dialog.theme:'dark'`**(方舟专题设计稿 Figma 471:6389/469:5947/469:5973 色板)。ChatDialog `.cs-theme-dark` 色板块(#222 紫微光外框 / #353535 气泡+工具栏 / #7063E7 用户气泡 / 状态点 #00C562·#F04848 / 紫边输入框+渐变发送钮 / 28px 渐变头像)+ DebugDrawer 同款内置主题(`csTheme` prop,ChatDialog 自动透传;--dd-* 全变量化)+ 「思考中」态设计稿化(8px 主色方点脉冲+文案)+ 历史下拉当前项整行主色。全部经 `--cs-*`/`--dd-*` 变量驱动,light 默认零回归,集成方可祖先覆盖自定义。browser 42 项。

> **2026-08-11 发布 2.41.1**(patch):① **DebugDrawer 日志列表生成期间实时刷新**(审计组 6 未编号 P1 级残留真·清零:mountChatDialog/customize-demo 传 `.slice()` 新引用 + browser 断言 ×2,41 项);② **rag-demo anthropic 协议修复**(根因:@anthropic-ai/sdk buildURL `new URL(baseURL+path)` 相对 baseUrl 抛 Invalid URL → 改绝对路径;apiKey 移出代码进 `.env` VITE_ANTHROPIC_*;mockLlm 双协议拦截 chat/completions + /v1/messages);③ **CLAUDE.md 整理**(87KB→33KB:保留全部规则/契约/坑,删版本演进叙事)。

> **2026-08-11 发布 2.41.0**:`fix-data-integrity` 实施完成并归档 —— 审计 P1 最后一批六项(**P1×27 至此清零**)。① **resetSession 收口统一**(P1-8/9:删 `!store` 早退,无 storage 也完整重置 mission/focus/todos 等 + 收口挂起冲突 keep_external + 公开 `sdk.resetSession()`);② **shareContext 串行闸上移 core**(P1-11:runSerial/activeControllers 建 core 级,双实例 send/switchSession 串行,生命周期收口断共享 core 全部在途流);③ **白名单深投影统一**(P1-19:7 处根级读 projectBySchemaDeep 递归,嵌套未声明字段不再泄露 —— 护城河唯一破口堵上);④ **压缩 LLM 摘要异步化**(P1-25:模板先行 + 后台前缀缓存,首 token 零阻塞);⑤ **markdown 渲染节流 + hljs 尺寸闸**(P1-26:修流式 O(n²) 冻结)。见 `archive/2026-08-11-fix-data-integrity/`。

> **2026-08-11 发布 2.40.0**:`fix-main-sub-isolation` 实施完成并归档 —— 审计组 3 三项 + N1(Q4 并入)。① **per-scope 乐观锁基线**(P1-13:`baselines` Map + `activeScope` + controller.enterScope/exitScope;子 agent dataOps 工具经 scope proxy 隔离,子 read/write 不污染主基线 —— 父过期写冲突承诺对进程内 agent 间恢复)+ N1 防御加固(立项复查:原场景不可复现 → 契约注释 + 回归测试锁定「同 scope 连续写不冲突」);② **spawn_agents allSettled**(P1-14:逐任务结算,聚合 ✓/✗,单失败不拖垮整批);③ **子 usage 回传 core.usage**(P1-17a:`normalizeUsage` 纯函数共用)+ **子执行超时**(P1-17b:`subagent.timeoutMs` opt-in,链式 abort)。见 `archive/2026-08-11-fix-main-sub-isolation/`。

> **2026-08-11 发布 2.39.0**:`fix-hang-and-feedback` 实施完成并归档 —— 审计组 1 七项(P1-1..7,挂起与反馈)。三契约:**超时默认值表**(无响应方 approval/humanConfirm 30s 自动拒 + `APPROVAL_AUTO_REJECTED` / MCP 握手 15s 降级 / skills fetch 30s / LLM 流停滞 90s 看门狗 `streamStallMs`)+ **可见性**(兜底收口必留痕)+ **abort 收口**(activeControllers 注册表;send/batch 接 signal 可中断;unmount/switchSession/resetSession 先断流;stop() 清排队记 debugLogs)。D-1/D-2 拍板落地。见 `archive/2026-08-11-fix-hang-and-feedback/`。

> **2026-08-11 发布 2.38.2**:`fix-authorization-surface` 实施完成并归档 —— 审计 P0-1(子 agent allowedTools 装配断层:rag/html 能力包 vfs 工具恒不可见)+ P1-15/16/18/21/22(子栈继承 approval/permissions + approval_request 直通转发 / spawn 自授收紧 + 装配期源头 filter / writablePaths guard 补根写拦截 / focus strict 兑现 + eval_script 拦截 / permissions 根 scope 校验 / 子 offload 桥接主 vfs)。Q1-Q5 拍板落地。见 `archive/2026-08-11-fix-authorization-surface/`。

> **2026-08-11 audit-sdk-integrity(已归档)**:SDK 完整性审计收口 —— 产出 `archive/2026-08-10-audit-sdk-integrity/audit-report.md`(**P0×1 + P1×27** + P2×64 + P3×33,H1-H28 全落结论;§十一 二审复核)。修复全链:P0(2.38.2)→ 无疑问 P1(2.38.1)→ 组 1 挂起收口(**2.39.0**)→ 组 3 主子隔离+N1(**2.40.0**)→ 数据完整性六项(**2.41.0**)= **P0×1 + P1×27 编号项全部清零**。收尾:P2×64 已分组登记 `openspec/deferred.md`(逐项带触发概率/复现条件,⏸/🔁/✅ 状态标记);**口径更正留痕**:组 6 计入 P1 总数的未编号项「DebugDrawer 日志列表生成期间不刷新」无 fix 批次覆盖,登记 deferred.md「P1 残留」段(一行修复方案待下个 patch)。五维审计(CA/SE/VM/RE/CO)留下轮。见 `archive/2026-08-10-audit-sdk-integrity/`。

> **2026-08-10 发布 2.37.0**:`add-capability-packs` 实施完成并归档(专用子 agent 工厂 `createRagSubagent`/`createHtmlSubagent` + 子 agent 架构扩展 `allowedTools`/`middleware`/`summarization` + `sdk.vfsWrite` + `rag-search`/`html-builder` skill + `rag-subagent-demo`/`html-subagent-demo` + augmentPrompt 委派引导)。见 `archive/2026-08-10-add-capability-packs/`。

> **2026-08-10 发布 2.38.0**:`add-subagent-observability` 实施完成并归档(子 agent 观察层:`createSubagentTracker` + `inspect().subagent.{active,history}` + `sdk.getActiveSubagents()`/`sdk.subagentHistory` + DebugDrawer「🤖 子 agent」tab;纯观察层不改生命周期/事件链)。见 `archive/2026-08-10-add-subagent-observability/`。

> **2026-08-08 归档(未实施,被取代)**:`fix-context-window-stale-on-setllm` —— 其核心问题(setLlm 后 contextWindow 陈旧不回灌,切小窗口模型 + 历史超新窗口时 compressInput 用旧阈值不触发)由同期 `harden-context-resilience` 的「三闸跟随窗口 + 反应性重试」覆盖解决,本独立 change(方案 B 独立 setter)未实施直接归档。见 `archive/2026-08-08-fix-context-window-stale-on-setllm/`。

> **2026-08-10 发布 2.36.0**:`add-headless-subpath` 实施完成并归档(新增 `page-agent-sdk/headless` 精简子路径:纯核心不含 UI,ESM 333KB vs 主包 789KB;依赖反转 `_createChatSdk` + 双入口;主包零变化)。见 `archive/2026-08-10-add-headless-subpath/`。

> 2026-08-08 发布 **2.27.0**:`recall-and-trim-llm`(P1 召回 + trim LLM)+ `context-persist-resilience`(mission/workingMemory 持久化 + trim 收口 GC 归档)实施完成;`context-history-resilience` umbrella 归档(P1+A 收口;B 类决策 #2 维持「对话文本」模型;P2 其余 deferred)。已归档见 `archive/`。

> **2026-08-14 发布 3.8.0**(minor):`prompt-tool-review` 实施完成并归档 —— ① **patch op `move`**(数组元素同数组重排/跨数组移动一步原子,value=目标路径;目标数组不存在自动建;过白名单;`moveByPath` 导出);② 提示词审查修复:draftWrite simple 守卫(修「提示词教 LLM 调不存在工具」Bug)/ spawn 提示补 writablePaths+spawn_agents / reliableWriteRules 补冲突行为第 6 条 / htmlSystemPrompt 措辞。selftest 1957 / e2e 583 / browser 53。见 [`archive/2026-08-14-prompt-tool-review/`](./archive/2026-08-14-prompt-tool-review/)。

> **2026-08-14 发布 3.9.0**(minor):`auto-html-agent` 实施完成并归档 —— ① **HTML 子 agent 自动装配**(无显式声明 + schema 含 code 数组 → 装配期自动注册默认 `createHtmlSubagent()`,委派编排 + vfs + 格式校验 + 增量 commit 全套;**无开关**(用户拍板主场景只有 HTML);显式声明优先不重复;推断不出的形态(顶层 code 字段/开放 schema)走降级直写);② **storage 默认 'memory'**(未传 = 纯内存多会话,零落盘;false 显式关闭);③ **presets.pageBuilder 简化**(自动装配接管,preset 只剩身份 prompt,getter 防突变退役);④ 同批:examples 优化(rag 双模式合并)+ patch op `move` + CA 并发修复(per-call context 通道)。selftest 1957 / e2e 590 / browser 54。见 [`archive/2026-08-14-auto-html-agent/`](./archive/2026-08-14-auto-html-agent/)。

## 进行中

- **2026-08-15 `context-economy-phase2`**(上下文经济性二阶段 + agent 自感知预算,目标 minor):承接 3.10.2 一阶段(S4 -19%)后的新瓶颈 —— S1 单场景 28 轮/507K prompt tokens(压缩触发太晚:flash 1M 窗口 × ratio 0.5 = 500K 才首压)。四线:① `promptSoftCapTokens` 成本维度触发(窗口 ≥320K 默认 softCap 160K,显式可覆盖/0 关);② 工具面瘦身二批(eval_script 505/draft_commit 379/set_data 312 等剩余长描述,教程归 usageHints);③ agent 自感知预算(轮次/token 消耗提示一行注入 + 写失败重复计数提醒 + 计划版次计数 + `roundTokenBudget` opt-in 单轮上限 —— 用户三项想法落地);④ 真 LLM 复测 S1/S7 对比基线。见 [`2026-08-15-context-economy-phase2/`](./2026-08-15-context-economy-phase2/)。

---

## 全景盘点(暂缓)

> 2026-08-08 审查暂缓的 4 项(placeholder-protected / agent-driven-compression / chatdialog-component-split / context-history-resilience)**已全部实施归档**,详见 `deferred.md`「2026-08-08 审查暂缓项」段。
>
> 当前活跃暂缓项:**chatdialog-component-split §9 拼装示例 demo**(核心拆分已上线,仅示例 demo 未做,待集成方需求触发)—— 详见 [`deferred.md`](../deferred.md)。

## 写链串行约束(若重启)

harden-large-json-write 的 A4(子路径 hash)已随 change 归档推后;placeholder(freeze/verbatim)已实施发布。两者都改 `commitSetToBind`/`applyPatchesToBind` 同段 —— 若 A4 将来重启,需基于 placeholder 已落地的写链现状协同评估。`fix-write-safety-bypass` 已发布(2.23),写链地基已稳。

## 维护约定

- change 归档(移 `archive/`)→ 从本表删除。
- 重启某项 → 从 deferred 移回,加本表 + `project.md`「进行中」。
