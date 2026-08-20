# Changelog

本变更日志基于 git commit 历史整理,遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/) 风格,版本号对应 npm 发布版本。

## [3.37.0] - 2026-08-20

### Added(会话恢复提示 resume-notice:防「凭历史断言已完成」)
- **恢复非空历史后首轮注入核实提示**:会话从持久化恢复(init autoResume / `session.id` / `switchSession` 载入,`applySnapshot` 灌入非空 messages 即触发)→ 恢复后首轮 system prompt 注入「你不在场期间数据可能已变(刷新回退到上次保存态/未保存修改丢失);断言『已生成/已完成』前先 read/list 核实;重做类指令先查缺再补齐」pin 段;一次性(`afterAgent` 清除,第二轮起不再干扰);`debugLogs` 留痕 `stage:'resume_notice'`。修 editor 实测:生成完成未保存 → 刷新回退但会话恢复 todos 全 completed → 用户「重新生成」agent 直接答「完毕」不核实。默认开无开关(同 intentGuard),新会话零干扰

### Tests
- selftest 2575→2588(sec-91:恢复提示生命周期 13 项);e2e 856→864(session-integrity resume-notice 运行时 8 项)

## [3.36.1] - 2026-08-20

### Changed
- DebugDrawer 诊断报告按钮「📋 复制到剪贴板」→「💾 下载 JSON 文件」(`page-agent-diagnostics-<时间戳>.json`):大体积日志 clipboard 常被截断/静默失败,文件交付更可靠

### Fixed
- **write patches 空字符串 value 误拒**:`op:'set'` 且 `value:''` 曾被误判 `MISSING_VALUE` 且 hint 误导用 remove(remove 是删键,「置空」≠「删键」);现仅 `value` 缺失或 `move` 操作目标路径为空串时拒绝(editor 实测:清空 script/文案写 `''` 被拦)

### Tests
- selftest 2573→2575(sec-21:空字符串 value 合法落地 + move 空串目标路径仍拒);browser 101→102(下载诊断报告用例)

## [3.36.0] - 2026-08-20

### Added(生成质量提升 output-quality-uplift:子 agent 模型/思考分层)
- **`createHtmlSubagent({ llm })`**:子 agent 独立 LLM(SubagentLlmConfig 形态)—— 主 agent 保持轻量模型编排,代码生成换强模型;缺省继承主(零变化)
- **思考深度锁定 `thinkingMode: 'simple' | 'deep'`**(subagent-thinking-mode-lock 落地):子 agent 级(`SubagentConfig.thinkingMode` / `createHtmlSubagent({ thinkingMode })`)+ 顶层 `subagent.thinkingMode` 全局缺省,显式优先。LLMConfig 构造路径经 `applyThinkingMode` 纯函数改写:OpenAI 兼容 `extraBody.thinking`(deep 注入 / simple 剥除,不 mutate 原 config)/ Anthropic 扩展 `LLMConfig.thinking`(budget_tokens 缺省 `min(maxTokens ?? 4096, 8000)`;thinking 开启时 temperature 按 API 要求强制 1);预构造实例路径 warn + observable no-op(物理不可改);`inspect().subagent.subagents` 反射 `thinkingApplied(applied/inherited/instance-noop)`

### Fixed
- **完结门禁陈旧 todos 误报**:循环条件加 `rounds > 0`——本轮零工具调用(纯问答轮)不触发门禁,修上一轮持久化遗留的未完成 todos 在新话题纯文本回复时被回灌发难

### Tests
- selftest 2560→2573(sec-90:applyThinkingMode 13 项);e2e 843→856(thinking-mode 模块 10 项 + 门禁豁免 3 项)

## [3.35.0] - 2026-08-19

### Added(指令执行力增强 instruction-adherence:防莫名中断 + 防注意力漂移)
- **完结门禁**(默认开):agent 欲以纯文本收尾但 todos 仍有未完成项 → 回灌「双出口」反馈(已完成→update_todo 标记 / 未完成→继续执行)续跑,预算 ≤2 次防死循环;豁免问号收尾(向用户征询)与空 todos 会话。修「拆 3 项做完 1 项就收口」的提前中断
- **问句意图守卫**(默认开):正则三档启发式(句尾问号 / 疑问词+吗呢 / 查询词「是什么|是啥|怎么用|有哪些」)逐用户消息定性,命中注入「先答勿做」pin 段(跨压缩/预算裁剪存活);只递信号不阻断工具,文案带「除非同条消息明确要求操作」逃生门。修长对话问句(如「这是啥组件」)被历史轨迹拖着误路由成 use_html 代码生成
- debugLogs 留痕:`completion_gate`(attempt/未完成项 id)/ `intent_guard`(命中消息预览)

### Changed(MCP 连接)
- 连接失败重试 3 次(递增退避 600/1200ms)吸收上游网关瞬时 502/断连,防整会话丢 rag_* 工具报「不存在」
- **逐 server 渐进注入**:各 server 连接落定即注入工具(原 allSettled 栅障等全部落定才注入)—— 一个坏 server 的重试耗时不再拖累所有好 server 的工具可用性

### Tests
- selftest 2531→2560(sec-89:门禁判定/反馈文案/问句三档/守卫注入 29 项);e2e 825→843(instruction-adherence 模块 18 项:门禁续跑/边界/豁免/预算 + 守卫命中/边界;mcp F4 时序适配重试)

## [3.34.0] - 2026-08-19

### Added(代码资产复用:被拦后重试写入,不重生成)
- codeAsset checkout:vfs 已有「未提交生成代码」且 data.code 未变(无人工改动)时**保留工作副本**并记 pendingRetry,afterAgent 重试提交——修「子 agent 耗时生成的代码被拦后重委派又重生成、浪费 token/时间」;人工/宿主改 data 仍优先(keep_external)
- `sdk.clearCodeReuse()`:清 vfs 复用缓存;内置 useChat「重新生成」前自动调用 → 用户点重新生成才强制重生成,否则复用

### Added(编排意图消歧,防长对话误路由)
- htmlOrchestratorPrompt 加【先判意图】:提问类(这是啥组件/怎么用/啥字段)用 read/list_components/rag_component_docs 直接回答,**不委派 use_html**;生成/修改类才委派。修「长对话问这是啥被误路由去生成代码」

### Added(聊天可读性/可复制)
- 思考过程/子 agent 思考:运行中状态点呼吸;字数 ≥1000 自动 k 单位(4.2k);正文可鼠标选中复制
- 工具结果为 JSON 字符串时格式化(缩进)展示与复制,方便阅读

### Removed
- 代码块「运行预览」按钮(暂不需要,仅留 复制/下载;CodePreview 组件仍导出,后续可恢复)

## [3.33.0] - 2026-08-19

### Fixed(第 0 轮「行动叙述」中途停止)
- 新增 `detectActionNarration`:首回合纯文本、零 tool_calls 但点名工具并表态执行(「我来添加/先加载」幻觉叙述)时回灌「请用工具执行」(上限 2 次),修 deepseek-v4-flash 把行动写成正文致 ReAct 误当最终回答「中途停止」;与 detectTransitionalReply 区别:不限长度、不豁免完成动词(第 0 轮无执行,完成词即幻觉铁证)

### Added(聊天可读性:思考过程字符数 + 可选中复制)
- MessageReasoning「思考过程」折叠态显示「N 字」计数,不展开也有内容量反馈
- 宿主页面常全局 `user-select:none`(如编辑器),SDK 消息区显式 `user-select:text`(气泡/reasoning/step 细节)保证可鼠标选中复制

## [3.32.0] - 2026-08-19

### Changed(breaking:乐观锁自动检测 opt-in 翻转 —— editor_fangzhou 实测「宿主元数据噪声高频误报」驱动)
- **自动冲突检测默认关闭**:`autoLock` 不再默认全字段检测 —— 未声明时 `write` 不自动做冲突检测(显式 `expectedHash` 仍逐次校验,零变化);宿主在 SDK 写路径之外持续回写元数据的真实集成形态(editor_fangzhou:Node.vue 每秒回写 `props.minHeight`、挂载注入 `leaf/childLimit/packed/stack`)在全字段检测下必然高频误报、冲突条挂起等人工致流程永挂
- **新增 `conflictWatchFields`**(顶层 + DataOpsOptions,白名单,任意深度字段名):声明后仅监听字段的值变动触发自动冲突(**位置不敏感**:`watchFieldsHash` 收集监听键值集合排序哈希,组件增删致 jsonPath 位移不误报);read 返回 hash 与冲突比对同源,显式 expectedHash 链路一致;显式 `autoLock:true` 回旧版全字段检测。与 `conflictPolicy` 正交(watch 定「什么算冲突」,policy 定「真冲突怎么裁决」)
- 迁移:依赖默认 autoLock 的集成方须显式 `autoLock:true` / 声明 `conflictWatchFields` / 逐次传 `expectedHash`,否则 write 不自动检测冲突(schema/快照/路径守卫保护不受影响);存量乐观锁断言同 commit 迁移显式 `autoLock:true`(行为语义保留)
- 测试:selftest 2502 → **2516**(sec-88 全重写:watchFieldsHash 位置不敏感/默认不检测/watch 双向/expectedHash 同源/autoLock:true 旧行为/baseline-guard hash 入口);e2e 814 → **818**(conflict 模块:默认不检测不挂起 + watch 白名单挂起双向)

### Removed(废弃 `autoLock`,conflictWatchFields 成唯一旋钮)
- **移除 `autoLock` 选项**(顶层 + DataOpsOptions + 两份 d.ts):`false` 半边与新默认重复、`true` 半边被 `conflictWatchFields:['*']` 通配取代;TS 上传入编译报错,运行时多余键忽略
- **移除 `expectedHash` 调用层参数**(set/edit/delete/write schema):`conflictWatchFields` 成为「是否校验」的唯一依据,消除「配置层 + 调用层」双机制理解成本;`read` 仍返回 `hash=`(乐观锁标识/workingMemory),冲突记录 `PendingConflict.expectedHash` 字段保留(=被比对的基线 hash)

### Fixed(isPathAllowed 补 record/any 分支)
- `isPathAllowed` 漏 ZodRecord 分支:写 record 内任意 key(如 `style.background-color`,style 为 `z.record`)恒 `PATH_DENIED`,与「record 键集开放,任意键可写」契约矛盾(集成方 systemPrompt 明示 style 任意 CSS 键可写,模型反复重试烧光轮次预算);补 record 分支(下探 valueType,与 `getSchemaAtPath` 口径对齐)+ any/unknown 子树任意深度放行

### Added(超调用次数中断可见提示)
- ReAct 循环达 `maxToolRounds`/`maxIterations` 被强制收口时,收口文案(wrap-up/兜底/缓存最终答)追加可见提示「工具调用次数已达上限……任务可能未完成,回复『继续』即可接着做」,并外发 observable `REACT_CALL_LIMIT_EXCEEDED` 事件 + debugLogs 留痕(修 editor_fangzhou 实测「莫名其妙就停了」)

### Added(watchFieldsHash 纯函数导出)
- `watchFieldsHash(value, watchKeys)`:白名单监听值集合哈希(主入口 + headless 子路径 + 两份 d.ts 同步);`['*']` 通配走全量 hashValue

## [3.31.0] - 2026-08-18

### Removed(配置面激进收敛:整体移除 `interceptors` 与 `toolMode` —— editor_fangzhou 实测「用户一般不知道有啥作用」驱动)
- **移除 `interceptors` 全功能**(`data.interceptors` read/write/input/output 四钩子 + `send()` per-call interceptors):实际集成无人使用、与乐观锁/schema 校验职责重叠且语义易误用;TS 上传入该字段编译报错(字段已从 `ChatSdkOptions`/`DataOpsOptions`/send options 与两份 d.ts 删除),运行时多余键被忽略不崩
- **移除 `toolMode` 选项**(恒 advanced 不声明):三态系统(advanced/simple/minimal)删除 —— `createDataOps` 直出 14 工具无呈现模式筛选;usageHints 提示词档位系统删除(无 simple/minimal 分支),提示词只随能力开关变化;3.30 的「systemPrompt 含 simple 模式/未暴露措辞自动降级」内部机制随档位系统一并删除(死代码)
- **移除的导出**:`filterByToolMode` 函数、`DataInterceptors` 接口、`ToolMode` 类型(主入口 + headless 子路径 + 两份 d.ts 同步)
- 迁移:曾显式传 `toolMode: 'advanced'` 的集成方(如 editor_fangzhou)删掉该键即可 —— 行为完全不变;传 `'simple'`/`'minimal'` 或 `interceptors` 的集成方 TS 编译报错,运行时忽略(工具面恒全暴露,无降级形态)
- 测试:selftest 2531 → 2502(−29:filterByToolMode/simple·minimal 档位/拦截器断言移除;createDataOps 直出 14 工具新断言)/ e2e 832 → 814(−18:inspect 工具面 simple·minimal 块、systemprompt 自动降级块、custom-injection 拦截器透传块、focus/resources 的 toolMode 行移除)

### Changed(usageHints/promptBuilder 签名收口)
- `createUsageHintsMiddleware(caps, hasDataOps, budget?)`:废弃的第 4 参 `_hasResources`(占位无用)删除,原第 5 参 budget 升为第 3 参;`buildDataPrompt(data, schemaHint?)` 收为 2 参;`SchemaHintOptions` 删 `toolMode` 字段(缓存键随之简化为 `maxKeys|maxChars`)
- `unfocusGuidance`(focus 失焦引导)选项保留:createChatSdk 不再传(默认 `'tool'`),选项留给子 agent(`'report-parent'`)与 `capabilities.focus:false` 场景(`'ask-user'`)

### Added(DebugDrawer 日志轮次分组:每一轮集中一个可折叠 node)
- **logs tab 重构**:扁平日志流改为按轮次分组的可折叠 node —— 头部只展示轮次 + 摘要(时间区间/耗时、🔧 工具数、Σ token、❌ 错误数),点击展开该轮全部细节卡;默认仅最新组展开(在途轮天然展开,新轮到来旧轮自动收起;用户显式切换覆盖默认)
- **运行边界 = 主 agent context 日志**(每 send 一条)→ epoch 隔离,跨 send 的同轮号不合并;子 agent 转发日志归属主 agent 当时所在轮;无 round 的轮内日志(middleware/error)归当前轮(「每一轮全部信息集中一个 node」),wrap_up 兜底收口单独成组
- 条目 UI 状态(展开/差分/原文)改按日志对象身份 uid 锚定(WeakMap),filter 切换/分组重排不串状态;顺带清理恒不可达的 tool_result 重复渲染分支(tsc 收窄报警的死代码)
- 测试:browser +2(轮次分组 node:跨 send 不合并 + 默认仅最新轮展开 + 点击展开细节)/ 存量 DebugDrawer 断言同步适配(细节卡断言前先展开全部折叠组)

### Fixed(DebugDrawer 🗑️ 清空日志按钮不好使)
- **问题**:DebugDrawer `clear` 事件发出后无人接线 —— ChatDialog 未透传、mountChatDialog 未实现,点击无反应
- **修复**:ChatDialog 增 `clearDebugLogs` prop + `@clear` 透传;mountChatDialog 实现清「源」`sdk.debugLogs`(shallowRef 置空,computed slice 传播);customize-demo 自接示例同步
- 测试:browser +1(清空生效 + 清空后新一轮日志正常进入)

## [3.30.0] - 2026-08-18

### Removed(配置面收敛:移除公开 `hintsMode` 选项 —— 「使用太复杂」反馈,toolMode 成为唯一旋钮)
- **移除顶层 `hintsMode` 选项**(3.28 新增,本为迁移兼容开关;几乎无集成方实际使用):usageHints 提示词档位改为**内部自动跟随 toolMode**,行为不变、配置面 -1;集成方只需关心 `toolMode` 一个旋钮(advanced/simple/minimal 同时决定工具池与提示词档位)
- **保留的兼容行为(内部化)**:toolMode 为 advanced 且 systemPrompt 含「simple 模式/未暴露」措辞时,提示词仍自动降级 simple + warn(存量集成不回退);「勿调用」单独出现仍不触发(3.29 收窄不变)
- 迁移:曾显式传 `hintsMode:'simple'`(advanced 工具池 + simple 风格提示词的解耦形态)的集成方 —— 该形态无公开替代,改传 `toolMode:'simple'` 让工具池与提示词一致(推荐);TS 上传入该字段将编译报错(字段已从 `ChatSdkOptions` 与两份 d.ts 删除),运行时多余键被忽略不崩
- 同步:warn 文案去掉「显式传 hintsMode」建议项;usage-guide 中英/architecture 描述更新;e2e systemprompt 现有断言(勿调用不误降/未暴露与 simple 模式仍降级)零改动全绿,覆盖保留行为

## [3.29.0] - 2026-08-18

### Added(conflictPolicy:乐观锁冲突自动裁决 —— editor_fangzhou 实测「agent 清空数组后添加组件自冲突」驱动)
- **`conflictPolicy`**(顶层选项,默认 `'ask'` 零变化):① `'ask'` = 挂起 `pendingConflict` 等人工 `resolveConflict`(现有行为);② `'overwrite'` = agent 强制覆盖,冲突自动收口不挂起(宿主与 agent 争同一份数据、agent 写入优先的场景;无人值守/自动化防流程永挂);③ `'keep_external'` = 自动保留外部修改,放弃本次写入并回灌提示让 agent 重新 read
- 自动裁决仍外发 `conflict` 事件(`conflict.autoResolved` 标记裁决结果),集成方可经 `onEvent`/`hook` 观测审计;`PendingConflict` 类型增 `autoResolved` 字段;导出 `ConflictPolicy` 类型(主入口 + headless 子路径)
- **定性**:纯 SDK 内「清空数组 → 添加组件」四写路径复现均零冲突(同 scope 连续写基线随写刷新,不变量成立);实测冲突源 = 两次写之间 bind 被 SDK 写路径之外的代码改过(宿主 watcher/编辑器同步层回写),乐观锁按设计拦下 —— 本选项给集成方声明「以 agent 为准」的出口
- 测试:selftest sec-32 +5(conflictManager 自动裁决三策略:overwrite 立即收口不挂起 + 事件留痕 / keep_external / 显式 ask 仍挂起)/ e2e conflict +7(顶层选项全链路:overwrite 强制落地 / keep_external 保留外部 / 显式 ask 挂起照常收口)

### Added(diagnostics:诊断报告一键导出 —— editor_fangzhou 实测「需要更方便的调试方式 / 完整日志文件复制过来分析」驱动)
- **`sdk.exportDiagnostics()`**(顶层 API + AgentCore):聚合当前会话完整诊断快照为 JSON 字符串 —— debugLogs 全量(完整日志文件主体)+ messages + `inspect()` 快照 + usage 累计 + pendingConflict + dataSummary(description/topKeys/字节量级)+ sessionId;DebugDrawer 头部新增 📋 复制按钮(`debugCopyReport` 文案键),一键复制全文交维护者排查
- **隐私收口**:apiKey 不入报告;data schema 剥 zod 内部结构替换为 topKeys 摘要;bind 不 dump 全文(仅摘要);url 凭据查询参数(key/token/secret/password/signature 类)自动打码;单字段 >50KB 截断留痕(图片 dataUri 类防撑爆)
- **总长闸**:报告 >6MB 从最旧日志丢弃至达标,头部插 `diagnostics_truncated` 标记留痕(保留最新日志,排查相关性最高);剪贴板友好
- 纯函数导出(主入口 + headless 子路径):`buildDiagnosticsReport` / `stringifyDiagnosticsReport` / `maskUrlCredentials` + `DiagnosticsInput`/`DiagnosticsDataSummary` 类型;DebugDrawer 纯 props 复用(headless 集成方传 `logs`+`getInfo` 即可,无 exportDiagnostics 时降级本地聚合)
- 测试:selftest sec-87 +17(报告形状契约/url 凭据打码/超长截断/总长闸丢旧留痕)/ e2e diagnostics +14(一轮对话后导出全链路:日志含工具轨迹/messages/info 剥 schema/dataSummary/usage/sessionId 一致/zod _def 不外泄 + 无 data 边界不抛错)

### Fixed(baseline-guard:集成方自定义工具改 bind 后乐观锁基线自动刷新 —— editor_fangzhou 实测「agent 清空数组下一步添加组件自冲突」机制层根因修复)
- **问题**:集成方经 `defineTool` 注册的结构化工具(整体替换组件树等)在工具体内直接改 `bind`,绕过 SDK 写路径 → per-scope 基线停留在旧值 → agent 下一次正常 write 被乐观锁误判「外部改过」挂起冲突(自冲突)
- **修复**:`createBaselineGuardMiddleware`(wrapToolCall,装载在 subagent 中间件外层):非 dataOps 工具调用前后对 bind 哈希比对,变了 → `recomputeAllBaselines()` 全 scope 基线重算(主 + 各子 scope);dataOps 管理工具跳过(自有 commitBaseline);无基线时短路零开销。**残余边界**:工具窗口之外(宿主 watcher/用户直改)的修改仍按设计触发冲突(这是乐观锁的职责),走 `conflictPolicy` 声明裁决
- 不变量保持:冲突检查 hash 恒实时计算,基线只作「上次 SDK 确认点」,不跨调用缓存检查 hash
- 测试:selftest sec-86 +13(守卫中间件:自定义工具改 bind 后 write 不冲突/不改 bind 零重算/无基线短路/dataOps 工具跳过/多 scope 全量重算)/ e2e conflict +6(顶层全链路:结构化工具改 bind 后 agent write 直接落地 + 工具窗口外修改仍触发冲突的边界)

### Fixed(hintsMode:auto 降级检测正则收窄 —— 「勿调用」误报修复)
- **问题**:集成方 systemPrompt 合法使用「勿调用」措辞(约束 agent 别调某些已暴露工具)被 3.28 的 auto 降级检测误判为「工具未暴露」→ 错误降级 simple 提示词 + warn
- **修复**:检测正则收窄为 `/simple\s*模式|未暴露/`(去「勿调用」);「勿调用」单独出现不再触发降级,「未暴露」/「simple 模式」仍按 3.28 行为降级
- 测试:e2e systemprompt +4(「勿调用」不误报:advanced 提示词保留 / 「未暴露」降级保持 / 「simple 模式」降级保持)

### Fixed(dark 主题滚动条可见性)
- dark 主题滚动条手柄透明度 0.18 → 0.38(ChatDialog 主滚动面 + DebugDrawer 日志区 CSS 变量),深色背景下不再「看不清」(editor_fangzhou 用户反馈)

## [3.28.0] - 2026-08-18

### Added(image-input-vision Phase 1:图片输入 + 多模态直连 + 集成方识图钩子)
- **输入侧**:ChatInput 📎 选择/拖拽/粘贴三入口,缩略图 chip(可删,≤4 张/轮);`compressImage` 压缩闸导出(长边 ≤1568 / jpeg q0.85 / 透明保 png / >20MB 拒,抛 `ImageInputError` 结构化错误码);MessageRow user 消息缩略图行渲染
- **多模态直连**:`send(text, { images })` API + `AgentMessage.images`;modelCaps 增 `vision` 表驱动标志(+`llm.vision` 显式覆盖,setLlm 重解析);constructLlm 双协议 content parts 组装(openai `image_url` / anthropic `image` block;URL 与 base64 双形态;子 agent anthropic 同步)
- **诚实闸三分支**:多模态主模型直发 / 非多模态配 `images.describe` 转述注入 / 都没有 → send 拒绝 + 结构化错误(不静默丢图)
- **集成方钩子 `images: { upload?, describe?, describeTimeoutMs? }`**(顶层配置组):`upload` 压缩后原图换 https URL(content parts 用 URL 形态 + 持久化轻引用,失败回退 dataURI 内联留痕);`describe` 识图转述(自有 vision API / 识图子 agent),转述文本注入该轮 user 上下文随消息持久化;describe 失败/超时(默认 15s)→ 占位描述 + observable `VISION_DESCRIBE_FAILED`,对话继续。原规划 SDK 内置 vision 中间件改此钩子形态(识图能力归属集成方)
- **持久化轻形态**:消息只存 `{id, thumb≤8KB, vfsRef/url}`,原图入 vfs `userImages/*` 池(LRU + `extractVfsRefs` 引用保护扩展);restore 后从 vfs 重水化 dataUri,缺省降级占位
- 测试:selftest +59(压缩闸纯函数/双协议 parts/modelCaps vision 表/vfs 引用保护/ImageInputError)/ e2e +30(直发/转述/upload/诚实闸/持久化往返/数量上限)/ browser +6(三入口交互/chip 删除/大图拒绝)

### Changed(3.28 默认 toolMode:simple → advanced,提示词与工具面一致性)
- **`toolMode` 默认改 `advanced`**(breaking):修前默认 simple 隐藏 `schema_data`/`diff_data`,但 SDK 内置提示词(read 根结果说明 / 大 schema 分层披露)无条件教 LLM 调 `schema_data` → 误调报「工具不存在」烧轮次(editor_fangzhou 集成事故驱动)。advanced 全暴露 = 教了的工具必在池中;要收敛用显式 `toolMode: 'simple'`/`'minimal'`
- **`hintsMode`**(新增,默认 `'auto'`):usageHints 提示词档位跟随 toolMode;auto 档检测集成方 systemPrompt 已声明「simple 模式/未暴露/勿调用」字样时自动降级 simple 提示词 + warn(提示对齐,不静默)
- **内置提示词按 toolMode 分支**(残差收口):dataOps `read` 根结果说明 / presets 大 schema 分层深层指引 / focus 子树概览 —— simple/minimal 档改教 `read({jsonPath})` 子路径,不再提 `schema_data`;`buildDataPrompt`/`extractSchemaHint`/`createDataOps`/FocusMiddleware 增 `toolMode` 参数(createChatSdk 装配期自动接线)
- **record 字段「键集开放」标注**:`renderSchemaHint`/`renderSchemaFieldShallow`/`renderSchemaOverview` 对 `z.record` 字段输出 `[键集开放,任意键可写]`(全量与分层两路)—— 裸 record 无字段清单,LLM 闭世界假设易推断「键不在 schema → 不能写」而拒绝合法写入(editor_fangzhou style.padding 拒写事故驱动;写路径机械上本就全开放,此为呈现层机制化防拒写)
- 测试:selftest sec-31/sec-37 +13(read 概览 simple 不教 schema_data / 分层 toolMode 分支 / 缓存按 toolMode 隔离 / record 键集开放标注 ×4 渲染路)/ e2e inspect +6(顶层集成视角:simple 分层不教 schema_data / advanced 教 / record 标注进 systemPrompt)

## [3.27.1] - 2026-08-18

### Fixed(dependencies 清理 —— npm≤6 + engine-strict 宿主安装 ENOTSUP,editor_fangzhou node10 日常环境驱动)
- **`dependencies` 全量清空对齐构建架构**:`@langchain/core`/`@langchain/openai`/`zod` 构建已 external 且早就在 `peerDependencies`(npm 7+ 自动装 peer,ESM 消费方零变化);`marked`/`highlight.js`/`dompurify`/`overlayscrollbars` 已打包进主包(同打包的 vue 从未声明)→ 挪 `devDependencies`(SDK 自身开发/测试使用);`@langchain/textsplitters` 全仓零引用(vite globals 死条目一并清)。**修复**:npm≤6 宿主(legacy 通道,如 editor_fangzhou node 10 + `engine-strict=true`)`npm i` 解析 dependencies 撞 `textsplitters(node≥20)`/`marked@18(node≥20)`/`highlight.js@11(node≥12)` → ENOTSUP;这些包 legacy 通道本就永不加载(全量打包 inline),纯死重。清空后 npm 6 零依赖解析直接装,engine-strict 全过;npm 7+ 行为不变(peers 自动装)

## [3.27.0] - 2026-08-18

### Added(滚动条统一替换:OverlayScrollbars v2 —— 用户诉求「聊天框横/纵向滚动条优化 + 用现成框架替换原生」)
- **主滚动面 overlay 自定义滚动条**:`overlayscrollbars@2`(新 dependency,打包进主包/headless 不含)接管 `.chat-main`(消息区)与 DebugDrawer `.drawer-body`(日志区)—— 隐藏原生滚动条换 overlay 细滚动条(8px 圆角手柄,autoHide scroll 700ms,支持轨道点击跳转),**保留原生滚动行为/键盘/触摸**;ResizeObserver 自动跟随聊天内容动态增高。**关键坑(实测踩中)**:默认「元素初始化」会把宿主子节点搬进插件自建 content 层,与 Vue patch 冲突 → `insertBefore` 崩(DebugDrawer 日志实时刷新即栽此);正解 = **模板预置 host/viewport/contents 三层 + 对象初始化 `({ target, elements: { viewport, content } })` 认领既有节点**,零 DOM 搬运,onScroll/onWheel/scrollToBottom 零改动。DebugDrawer 为 v-if 挂载,初始化挂 visible watch + onMounted 双入口(幂等)。手柄颜色经 `--cs-scrollbar-thumb(-hover)` / `--dd-scrollbar-thumb(-hover)` 跟随 light/dark 主题(集成方可覆盖)
- **对话框级横向滚动消灭**:`overflow.x:'hidden'`(代码块/表格各自内部 `overflow-x:auto` 保持)—— 长代码行不再撑出外层横向滚动条
- **小滚动区原生细条兜底**(代码块/历史菜单/输入框 textarea 等不接 JS 的区域):`scrollbar-width: thin` + `scrollbar-color` 继承属性(Firefox/Chromium121+)与 `::-webkit-scrollbar` 伪元素(6px 圆角、轨道透明、主题色),与 os viewport 的原生隐藏规则互不打架(显式再断言)
- 测试:browser scrollbar.spec +3(os viewport 接管 + overflow-x hidden + 细条继承 / 长代码行横向收敛在代码块内 + .chat-main 零横向溢出 / DebugDrawer 同构接管);体积阈值同步(IIFE 2.15MB / UMD 1.15MB / CSS 85KB)

### Added(历史记录删除按钮图标可配置)
- **`dialog.icons.sessionDelete`**(editor_fangzhou bin.png 驱动):历史下拉「删除会话」按钮 undefined = ✕ 文本(默认零变化);传 emoji/字符/HTML 片段(如 `<img>`)替换,与 send/顶部按钮键同机制 IconGlyph 净化渲染。selftest sec-81 断言扩展 + browser icons.spec +1(双会话 → 历史下拉 → 🗑️ fixture 断言)

### Added(顶部按钮自适应文字标签,editor_fangzhou 集成驱动)
- **头部按钮宽度自适应「文字+图标」**:聊天框够宽(头部内容区 ≥440px,默认 padding 下 ≈ 对话框 ≥472px)时「新建会话/历史记录/更多」展示文字+图标,收窄自动回退纯图标(关闭钮恒纯图标)。纯 CSS 容器查询实现(零 JS/零布局抖动);不支持 `@container` 的旧浏览器恒纯图标 = 旧行为优雅降级。**可配置双通道**:文字走 i18n 既有键 `newSession`/`history`/`more`(`i18n.messages` 键级覆盖天然生效,en locale → New chat/History/More);图标走 `dialog.icons` 新增四键 `newSession`/`history`/`more`/`close`(undefined=内置 SVG,空串视为未传,与 `send` 同机制 IconGlyph 渲染);`dialog.headerLabels`(默认 `true` 自适应,`false` 恒纯图标)。附带:`.header-title` 补 ellipsis 截断(长标题不再溢出挤压按钮);`types/index.d.ts` 对齐既有漂移(`DialogIcons.send`、`DialogConfig.sections` 补漏)
- 测试:selftest sec-81 +3(顶部按钮图标四键透传/空串视为未传/缺省 undefined)/ browser header-labels.spec +5(宽=文字+图标 / 窄=纯图标且可交互 / icons.newSession 替换内置 SVG / en-US 英文标签 / headerLabels:false 恒纯图标;minimal-demo/nested-demo 挂 fixture)

### Changed(docs)
- **README 中英补全使用索引并去重**:「Extension points / Built-in tools / File structure」三段重复出现两次 → 删重;新增「Usage map」任务导向索引(我想做 X → 去 Y:README 锚点 + doc/usage-guide 对应节),便于人类与 AI 代理(Claude Code/Cursor)从 README 单入口找到全部用法

## [3.26.1] - 2026-08-17

### Fixed(focus 对开放 schema 的支持 —— editor_fangzhou「画布选中 → AI 聚焦」接入驱动)
- **`getSchemaAtPath` 支持 record/any/unknown**:修前 `z.record(...)` 恒返 null、`z.any()`/`z.unknown()` 子树任意深度亦返 null → `validateFocusInput` 第 4 道校验恒拒 → 开放 schema 集成(如编辑器页面树 `z.record(z.string(), z.unknown())` 绑整个组件树)**setFocus/addFocus 永远失败,Focus 功能整体不可用**。修:record 任意段下探 valueType(键集开放,与 getSchemaTopKeys 返 null 全开放口径一致);any/unknown 子树任意深度保持开放续走。附带正收益:`schema_data`/read 子路径投影对开放 schema 子路径同理解禁
- 行为边界:valueType 非开放(如 `z.record(z.string(), z.object({...}))`)时未声明字段仍返 null(不放宽声明过的形状);严格 schema 路径零变化(record/any/unknown 此前一律 null,新增分支只解禁不排除)
- 测试:selftest sec-31 +6(record 任意路径 / record·object valueType 命中与拒绝 / any·unknown 子树 / record·array·object 深层)+ e2e focus.mjs +5(record schema setFocus/addFocus/clearFocus 全链路)

## [3.26.0] - 2026-08-17

### Added(legacy-bundle-channel:老构建链宿主官方接入通道)
- **`page-agent-sdk/legacy` 子路径(es2017 全量打包单文件,~2.9MB)**:webpack ≤4 / vue-cli 2-3 宿主的官方通道 —— 老解析器(acorn 6)对主产物 es2022 的 `?.`/`??` parse 失败且 peerDeps 全为新 ESM,此前只能手工拷 IIFE 产物(与 npm 版本管理脱钩)。legacy 产物 vue/zod/@langchain(含 anthropic)/MCP 全 inline,宿主 `await import('page-agent-sdk/legacy')` 零 transpileDependencies、零 peer 安装(`z` 从 bundle 导出),webpack4 原生动态 import 自动切独立懒加载 chunk 不进首屏
- **包根物理转发文件 `legacy.js` + `style.css`**:webpack4 enhanced-resolve 不认 package.json `exports` map,子路径按包根目录文件解析 —— 转发文件即解析目标(构建脚本自动复制 style.css 至根)
- 语法纯净性硬校验:产物经 editor_fangzhou 真实 webpack4 解析栈(acorn 6.1.1 + acorn-dynamic-import + ecmaVersion 2019)parse 通过(主产物同栈失败作灵敏度对照);e2e 增 legacy-subpath 模块(导出面与主产物 191 符号等价 / ui:false 装配 / 语法纯净 / 体积,+11 项);size-check 增 3.3MB 阈值
- 文档:README×2 产物表 + usage-guide 中英「legacy 老构建链子路径」段(三通道决策树)+ 集成 skill 安装表增 legacy 行(Vue2 共存/CORS 注意);editor_fangzhou 真实靶场端到端验证(webpack4 编译 + 面板挂载 + 真实 LLM 工具轮改页面树落地)

## [3.25.1] - 2026-08-17

### Changed(write-path-cost-reduction:写路径 O(N) 成本收敛,audit A3)
- **同调用 hash 双算消除**:写成功后的新基线与结果消息「新 hash」复用同一次 `hashValue` 计算(`commitBaseline` 辅助;write edit 意图 + edit_data 两改点,write(set) 原已是范本)—— 1MB bind 全量 hash 实测 ~10ms,同值双算纯浪费
- **codeAsset 改前态单拷贝**:`applyPatchesToBind` 的 `beforeBind`(__pgId 回填用改前深快照)复用为快照栈条目,省一次全量 deepClone;快照条目按不可变值对待(restore 消费方防御性深拷贝既有),`internalAfterWrite` 的 `before` 参数固化只读契约
- **冲突检查 hash 实时性不变量固化**(P0):`handleConflict` 当前态 hash 禁止任何跨调用缓存(脏标记/版本号/memo 均否)—— 人工直改 reactive bind 不经 SDK 写路径,SDK 侧脏标记感知不到;缓存 = keep_external 保护失明 → 人工修改被静默覆盖(M4 实证场景)。注释 + change spec 双固化
- **bench 留证**:`tests/perf/write-path-bench.mjs`(50KB/300KB/1MB × codeAsset/非 codeAsset,不进 CI);实测 1MB 单 patch 写 median 30.1→26.5ms(非 codeAsset,**-12%**)/ 34.4→27.7ms(codeAsset,**-19%**),290KB 档 -11%/-22%
- 零行为变化:乐观锁 N1 契约/快照 restore/__pgId 回填/消息语义全部锁定(selftest +10:消息 hash 无漂移 ×2 路径 + 外部改旧 hash 必冲突 + codeAsset 快照共享 restore 正确性 + 非 codeAsset 零变化)

## [3.25.0] - 2026-08-17

### Added(stream-max-duration:空转帧黑洞兜底,2026-08-17 直连鉴别实验驱动)
- **单次模型调用流总时长上限(`streamMaxDurationMs`,默认 600s,0 关闭)**:间隔看门狗(`streamStallMs`)存在实测盲区 —— 中转站黑洞返回 200+SSE 头后以 keepalive/空转帧无限重置 chunk 间隔计时(冻结 417s+ 无 StreamStalledError)。`withStallTimeout` 增 `maxMs` 绝对截止参数(不随 chunk 重置),超限抛 `StreamMaxDurationError`(继承 `StreamStalledError` 的 408 不重试语义,日志 stage `stream_max_duration` 归因);上层重委派/用户重发即自愈(同 key 新流实测秒级正常)。直连鉴别实验同步定性根因:**中转站(modelverse)并发流场景下单请求级死亡** —— vite 代理与 per-key 配额均排除(黑洞中同 key 新请求 1.5s 正常、新 SSE 流秒级出 chunk、槽位释放后死流不恢复)

## [3.24.1] - 2026-08-17

### Fixed(M4 真 LLM 实测驱动:人工并发 keep_external 的「保护成立但终态被覆盖」)
- **keep_external 提示回流委派返回值**:原人工并发保护只 console.warn —— 主 agent 读到人工 stub 误判「子 agent 返回占位符」(实测原话),用合法读后写直写覆盖人工值。修:codeAssetMiddleware 把 keep_external 组件名记入 state(`__pgKeepExternal`),`runSubagent` 收口时经 `decorateSubagentResult` 在委派结果尾追加提示(语义随结果回流主上下文);文案 ask-first(「先向用户说明,由用户决定是否继续」—— 人工修改是最新意图信号,不径直重新委派)。实测主 agent 收口话术:「检测到你在生成期间手动修改了该组件,已保留你的版本。请问你希望:按原任务继续…/保留你现在版本…」
- **代码组件 codeField 主写恒守卫(`CUSTOM_CODE_DELEGATION`)**:flash 实测 3 次无视编排提示词禁令直写已存在组件的 code 字段(含提示回流后仍违反)→ 机制化:html code-asset 模式下主 agent 对已存在组件 codeField 路径的写恒拒(recoverable 回灌引导委派;与在途组件锁同层)。新 `codeFieldIndexPaths` 纯函数(嵌套 codeField 如 `props.html_code` 兼容);边界:新建元素/整体 set/dryRun 不拦(与在途锁同边界);不配 `getCodeFieldPaths` 零变化
- **modes 真 LLM 套件 M4 修复**:前置组件名匹配兼容中/英(agent 会把「幸运色块」命名为 `luckyBlock`,原按 `includes('幸运')` 匹配假失败);正式阶段措辞明确「重新生成其完整代码」引导委派路径
- 真 LLM M4 复验 4/4 全过(keep_external 人工值保留到终态 + warn 留痕 + 主 agent 零直写);`parallel-subagent-delegation` change Q5e 收口归档(并行存在性两轮采样证实;墙钟量化断言因环境黑洞未跑通,已留注记)

## [3.24.0] - 2026-08-17

### Added(debug 模块审计与布局优化)
- **DebugDrawer 调试布局优化(每步提示词/工具调用详情可读)**:① 工具配对卡 —— tool_call 与 tool_result 自动配对(同名 FIFO),args+result+耗时一屏看全一步调用(未配对 call 显示在途)② 提示词「只看新增」差分视图 —— llm_request 相对上一次请求切掉重复前缀(badge 显示 +N/M),逐轮看本轮真实增量 ③ 长消息折叠 —— 超 400 字消息默认 3 行截断点击展开(system prompt 数 KB 不再淹没列表)④ 复制按钮 —— 提示词全文 JSON/工具结果一键复制。i18n 新增 2 键(debugOnlyNew/debugShowAll)
- **调试日志跨轮累积(修:每次 stream 清空)**:原 `createAgent.stream()` 入口 `debugLogs.value = []` → 每次 send 抽屉只剩最后一轮,上一轮提示词/工具调用无法回看。改为跨 stream 累积(300 条 FIFO 上限自兜底);会话级清理仍归 switchSession/resetSession;spans/trace 保持按次重置(「最近一次」语义)
- **调试入口门控(`debug: true`)**:「更多」菜单的调试项 + 日志数 badge 仅 `debug:true` 时展示(ChatDialogProps.debug / DialogMountContext.debug;日志仍恒收集,供 `sdk.debugLogs` 与 headless DebugDrawer 复用;i18n-demo 补 debug:true)
- **send()/batch 全量事件外发(headless 审计 F1)**:原 `send()` 路径只 emit error(headless 用 send 的集成方经 `sdk.hook` 听不到 tool_call/reasoning/text 过程,「聋子」路径)→ 现全量转发(approval_request 仍不外发,由 30s 自动拒收口,语义不变)
- **DOM 检视工具族(`capabilities.domInspect`,经 skill 按需注入)**:`dom_search`(CSS 选择器/可见文本双模检索,返回 CSS 路径 + 文本片段,≤20 处)+ `dom_info`(单元素完整信息:内容/outerHTML 片段/计算样式(默认排障高频 ~30 项,可指定属性)/几何位置/伪元素摘要/**事件绑定三源**(inline on* 属性 + Vue vnode props + addEventListener 记录器;记录器仅覆盖 SDK 加载后注册的监听,诚实标注));两工具经内置 `dom-inspect` skill `load_skill` 按需进工具池(**不占常驻 tool schema 上下文** —— 不常用工具 skill 化,load 前仅索引一行);`get_dom` 保持常驻向后兼容;skills 能力关时降级直插工具池;导出 `domInspectSkill` + 纯函数(searchDom/getElementInfo/buildCssPath/ensureDomListenerRecorder 等)
- **MCP 连接失败可观测**:握手超时/拒连降级原只有 console.warn —— 补 emit observable error(code `MCP_CONNECT_FAILED`,含 server/url)+ `inspect().mcp.failed` 反射失败清单(headless/无 console 集成方可提示用户,不再误诊为「工具不存在」代码问题)

## [3.23.1] - 2026-08-16

### Fixed(3.23.0 发布后真 LLM 实测发现:Q5e 并行委派复验)
- **并行同轮双委派 UI 归属错乱**:`maxParallelTools>1` 同轮两个 `use_html` 时,① 子 agent 思考流(subReason)与子步骤(children)全混进最后一个 step(第一个 step 空白,用户只见一个 agent 在思考)② 同名工具 `tool_result` 按 name 反向扫交叉错配(A 的结果落到 B 的 step,result/durationMs 互换)。修:事件链补调用关联 id —— `tool_call`/`tool_result` 事件带 `id`、`subagent` 事件带 `toolCallId`(经 `__pgSubagentCall` per-call 通道透传);UI(useChat)按 id 精确归属 step,降级 name 反向扫兼容旧自定义 fetchStream。e2e capability-packs(+5:事件 id 独立/配对/toolCallId 路由)+ browser complex-demo(+1:双委派思考流各归各 step + result 同源;mockLlm 支持 reasoning 流,OpenAI 首 chunk 必带 role 否则 langchain 聚合丢弃)

## [3.23.0] - 2026-08-16

### Added(openspec `2026-08-16-preference-persistence`)
- **跨会话用户偏好记忆(`capabilities.preferences`,opt-in 默认关)**:agent 从对话中捕获用户持久偏好(配色/文案/排版口味),独立持久化,新会话自动经 pin 段注入 system prompt —— 用户不必每个会话重申「别用紫色」。三层信号捕获(宁漏勿误):强信号(「记住:…」显式命令正则提取,零 LLM)/ 中信号(模式词初筛 + summaryLlm 小模型提炼一次,核心判定「持久口味 vs 本轮任务指令」;不可用降级只强信号)/ 行为推断不捕获(学错成本 > 收益)。`preferenceStore`(与 skillStorage 同构的独立 IndexedDB 存储;同 topic **后说覆盖前说**防自相矛盾,topic 固定 6 枚举,FIFO ≤20 偏好段 token 有界;`preferenceStorage` 配置组可调 backend/id/maxEntries);捕获在 afterAgent 收口后 fire-and-forget(不阻塞返回,失败 debugLogs 留痕);注入段每轮重建跨压缩天然生效(同 mission);API `getPreferences()`/`removePreference(id)`/`clearPreferences()`(学错可删)+ `inspect().preferences` 反射 + DebugDrawer「用户偏好」只读小节;`switchSession`/`resetSession` 偏好保留(只重置消息扫描水位)。selftest sec-84(+55)/ e2e preferences.mjs(+19:强信号捕获落库/pin 段注入/同 topic 覆盖/三件套 API/默认关降级/inspect 反射)

## [3.22.1] - 2026-08-16

### Fixed(3.22.0 发布后临时安装验证发现)
- **`sanitizeMessageHtml` / `sanitizeIconHtml` 在 Node/headless 服务端调用抛 TypeError**:dompurify 无 window 时导出非完整实例(`sanitize` 缺失)。修:两净化函数加无 DOM 守卫,保守降级 = 剥除全部标签只留纯文本(纯文本恒安全,不输出未净化 HTML;浏览器路径行为零变化)。selftest sec-83 +3 锁 node 兜底路径

## [3.22.0] - 2026-08-16

### Changed(breaking,用户拍板「不用兼容,直接修改」)
- **`dialog.locale` / `dialog.messages` 合并为顶层 `i18n` 配置组**:`createChatSdk({ i18n: { locale: 'en-US', messages: {...} } })` —— 与 vue-i18n/i18next 术语一致;不放 dialog 组的原因:locale 除 UI 文案外还驱动默认 systemPrompt 语言与 autoTitle(agent 层)。两键 3.20.0 引入未及广泛使用,故不保留兼容层(用户拍板)。`I18nOptions` 类型导出;`ChatDialog` 组件 props 同步合并为单 `i18n` prop

### Added
- **`i18n.messages` 值支持行内 HTML 片段(富文本渲染位)**:值以 `<` 开头 → 经 DOMPurify **文案白名单**(b/em/u/s/span/mark/code/sub/sup/kbd/br + class/style;script/事件属性/危险协议/块级标签剥除)净化后渲染,如 `statusDone: '<b style="color:#10b981">完成</b>'`。支持位:标题/状态标签/思考中/空态问候/确认与冲突/重试回退按钮(`MsgText` 组件统一出口,与 IconGlyph 同构);title/placeholder 属性位与拼接键(prefix/suffix)按纯文本。`sanitizeMessageHtml` 导出可自查净化结果
- browser i18n.spec 6 项(富文本渲染 ×2 + 净化安全面:script/onclick 剥除 + 白名单标签/style 保留 + 默认 systemPrompt 英文)

## [3.21.0] - 2026-08-16

### Added(dialog-i18n Phase 2;openspec `2026-08-16-dialog-i18n-phase2`)
- **调试/技能/预览面板文案纳入 i18n**:`dialog.locale` 覆盖扩展到 DebugDrawer(6 tab/7 过滤器/状态标签/trace 指标/上下文构成/子 agent 面板/Agent 信息 ~30 kv/skill 错误,~90 键)+ SkillPanel(表单/校验/列表/提示,~25 键)+ CodePreview(标题/tab/按钮 title/CSS 示例,~10 键);`DialogMessages` 总键空间 ~91→219;三组件新增 `messages` prop(纯 props 独立复用缺省中文,ChatDialog 自动透传);DebugDrawer `formatTime` 跟 locale。补 Phase 1 漏网:ChatInput 焦点 chip ✕ title 接线
- **默认 systemPrompt 语言策略**:`dialog.locale:'en-US'` 且未传 `systemPrompt` → 英文版默认 prompt(`DEFAULT_SYSTEM_PROMPT_EN` 导出;含 "Respond in English" 语言锚,agent 回复语言与 UI 一致);自定义 systemPrompt 不受影响,但自动追加的 reliableWriteRules 段跟随 locale(`systemPromptHelpers.reliableWriteRulesEn` 导出);`buildSystemPrompt` 增 `locale` 参数。工具 schema 描述语言登记 deferred(量 ~14 工具全量描述,LLM 对中文描述理解无碍,待海外用户实际反馈再启)
- selftest sec-83 +10(Phase2 键齐备/双语区分 + buildSystemPrompt locale 四分支)/ browser i18n.spec +3(Debug 抽屉/Skill 面板英文 + 默认 systemPrompt 英文断言)

## [3.20.0] - 2026-08-16

### Added(用户反馈驱动)
- **`dialog.locale` + `dialog.messages`:内置对话框国际化 + 文案键级自定义**(openspec `2026-08-16-dialog-i18n` Phase 1;双需求:切语言 + 「成功等提示文案自定义」):自建轻量字典零依赖(不引 vue-i18n —— 其需接管 Vue 实例,SDK 内嵌 Vue 不适用);**`messages` 键级覆盖优先于 locale 包** —— 换语言与改个别文案(如 `statusDone: '完成'`)一套机制。覆盖聊天面 13 组件 ~90 键(容器缺省 title/placeholder、header 会话/菜单、消息空态/重试/回退、步骤状态/展开细节/子 agent 进度、消息操作、焦点 chip、输入区、排队/确认/冲突/聚焦条);`formatTime` 跟随 locale(12h/24h);autoTitle 标题语言跟随(en 生成英文标题);导出 `DialogMessages`/`DialogLocale` + 双语言包 + `resolveDialogMessages`(L2 自建 UI 复用)。Phase 2(DebugDrawer/SkillPanel ~150 键 + 默认 systemPrompt 语言策略)独立立项。新增 `examples/i18n-demo`;selftest sec-83(+8:键集一致性/优先级/不可变)/ browser i18n.spec(+2)
- **focus-scoped-read:聚焦模式下 `read` 空参默认返回焦点子树**(用户实测:聚焦 components.5 问「这里是啥」→ `read({})` 全量 dump 整页):focus 中间件 wrapToolCall 对空参 read(无 jsonPath/jsonPaths)注入 `jsonPaths=焦点路径数组`(多焦点全含),复用多路径读(hash 供 autoLock 语义不变,dataOps 零改动);结果前置**教学行**(「需全量时显式列顶层键 read({jsonPaths:[...]})」,工具结果级反馈强于 prompt 引导);提示段同步一句;**显式路径读完全自由**(「读不限制」设计保留)。selftest sec-54 +8 / browser page-demo 新场景(展开入参见注入的 jsonPaths + 教学行)
- **`dialog.icons.send` 发送按钮图标自定义**(用户反馈):undefined=内置纸飞机 SVG(默认零变化)/ 传 emoji/字符/HTML 片段替换(空串视为未传防空按钮);loading 停止方块恒内置。selftest +3 / minimal-demo 挂 🚀 fixture + icons.spec 断言

### Fixed(UI)
- **思考中气泡贴边**(用户反馈):MessageBubble `.typing` 态 padding `4px 2px` → `6px 13px`(横向对齐气泡基础 padding,纵向略收紧)

### Tests(真 LLM 正式基线)
- **3.19.1 基线入库**(`tests/runtime/real-llm-baseline.json`,15 场景全采集,`npm run test:real -- --baseline-update` 框架全链路首跑):检查 38/40,S1 笔记沉淀(模型未写 [note] 行)+ S5 banner 落地(模型把「限时特惠」改写为「年中盛典」,banner 已建)均为行为波动非 SDK 回归;rag 15/15(含真实 MCP)、parallel 7/7、S2-S4/S6-S10 全过

## [3.19.1] - 2026-08-16

### Fixed(第二轮三路审查 round2-review-hardening;openspec change 同名)
- **autoTitle 标题时序回归**(rv-recent F1,3.19 稳定性小修自引入):`persistUpdateTitle` fire-and-forget(经 storage per-key 串行链 ≥1 微任务)后立即 `refreshSessions`(scan 直读)→ 会话列表显示旧标题。修:autoTitle 路径改 await updateTitle(带 catch)再 refresh
- **主栈 scope 闭包残留**(rv-core F1,3.7 同类):主 agent 工具 config 不含 `__pgDataScope` → 恒走 ambient `activeScope` 兜底;并行委派下子 agent wrapWithScope 的 enter/exit 窗口改写 ambient → 并发主工具读到子 scope(子基线 undefined → **autoLock 静默放行** / 主 read 误判子 scope 全文灌上下文;双子窗口交叠可致 ambient 永久滞留子 scope)。修:coreExecTool 给主栈 config 兜底注入 `__pgDataScope:''`(子栈 wrapWithScope 覆盖不受影响)
- **query_data/get_data 绕过大文本摘要**(rv-core F2):`<code Nkb>` 摘要只挂 read,query_data(simple 默认可用)原样回灌命中 value → codeAsset 场景大 code 确定性击穿。修:两工具回灌前统一过 `summarizeLargeText`(同 read 的 isMain 语义:主 scope 摘要/子 scope 全文)
- **失败读刷乐观锁基线**(rv-core F3):read 在路径校验前 setBaseline → PATH_DENIED/UNSAFE 失败读吸收宿主改动 → 后续 autoLock 静默覆盖。修:基线刷新下移到校验通过后(多路径至少一个合法才刷;与 get_data 同序)
- **resetSession 竞态孤儿消息**(rv-core F5):在途 send 的 invoke 被 abort 返 partial 不抛 → push 进新会话并落盘。修:invoke resolve 后校验 aborted/sessionId/refCount 三锚,孤儿轮丢弃留痕
- **排队 send 在 release 后照跑**(rv-core F6):runSerial 排队操作无存活守卫(LLM 照烧);trackActive 的 `{once:true}` listener 永不清理。修:core.send 入口 refCount≤0 拒;untrack removeEventListener
- **MessageSteps 跨实例展开互斥**(rv-recent F4):模块级单展开 Set 全局 clear → 同页双对话框互相收起。修:toggle 只清本实例 uid 前缀(单对话框互斥保留)
- persistSave 吞错补 debugLogs 留痕(rv-recent F2,observable `persist_save_failed`);cacheControl 注释机制勘误(rv-recent F3:真正救回 invocationKwargs 的是 create 调用内二次 spread,已验 1.5.4,升级须 cache_read 复检)

### Fixed(第二轮复审 rv-verify 残留清零:APPROVE 后同族补刀)
- **A4 修复补完**:单路径 read 的 `setBaseline` 再下移到 `interceptors.read` try/catch 之后 —— 拦截器对**合法路径**抛错返回的 READ_INTERCEPT 不含 hash,修前仍刷基线 → 同款「静默覆盖宿主改动」构造窗口(多路径分支因输出头披露 hash 不受影响,维持原判定)
- **A2 同族(子栈)**:`wrapWithPathGuard` 的 `guarded(args)` 丢弃第二参 → 子栈带 writablePaths 的写工具失去 per-call `__pgDataScope` token,退回 ambient 兜底(并行两子 scope 交错时子写基线可串 scope)。修:config 透传
- **A6 同族**:`sdk.batch` 入口补 refCount 存活守卫(release 后剩余任务不再继续烧 LLM)
- A1 一致性:autoTitle await 路径的 catch 走 `notePersistFailure`(与 A9 留痕口径统一)

### Tests(第二轮审查盲区核实成立项)
- e2e conflict:**resolveConflict 顶层 overwrite/restore 分支**(agent 值落地/回退种子快照;此前只有 keep_external)
- e2e custom-injection:**用户 wrapToolCall throw → 轮存活 + recoverable 回灌**(sec-80 E1 原只测辅助纯函数;观测走 stream 模式 —— invoke 只发核心事件的既有约定)
- selftest sec-80 E3 重写:**withStallTimeout 真行为**(ms≤0 透传 / >0 黑洞流抛 StreamStalledError status=408;原为 assert(true) 占位)
- selftest:**normalizeBaseUrl 纯函数**(相对路径浏览器补 origin / Node 原样 / 绝对原样;导出 API 此前零测试)
- selftest 2207→**2222**(+sec-81 icons 之外:sec-82 round2 修复锁 8 项)/ e2e 703→**718**(+B1/B3/A1/A5 回归锁);审查误报裁决记录(sec-26/78/79/80 既有覆盖否决 rv-coverage 7 条)与 rv-core F4/F7/F8 暂缓登记见 openspec
## [3.19.0] - 2026-08-16

### Added(真 LLM 回归评估框架化;deferred 触发线达成)
- **统一入口 `npm run test:real [套件] [场景号…]`**(`tests/runtime/real-llm.mjs`):套件注册表编排(uispec complex-demo 10 场景 / rag 四模式 / parallel 并行复验),串行跑避免抢 dev server;聚合汇总 + 失败非零退出码
- **共享基建 `tests/runtime/_real-llm-lib.mjs`**:idle 双条件判定(debugLogs 静默 90s×3 + 活动子 agent=0,**补页面 reload 快速失败**—— debugLogs 清零即抛,不再空等超时)/ 事件捕获 / 断点续跑 / 超时 dump 诊断 / 基线 diff,三套脚本从四份同款拷贝收敛为薄壳(场景定义 + checks),新套件成本骤降
- **基线对比机械化**:`--baseline-diff`(读现有报告秒回,不跑 LLM;每场景 prompt/completion/toolCount/elapsedSec 旧→新±%,超阈值标 ▲疑似回归/▼改善;阈值 token ±15% 且 ±2000 / toolCount ±3)+ `--baseline-update`(确认预期后采集;`tests/runtime/real-llm-baseline.json` 入库随代码提交,跨会话可比)
- rag 套件:场景被 `only` 跳过时连前置切模式/MCP 等待一并省(修前白等 30s+);rag/uispec 采集补 `fromSdkUsage` 兜底
- 验证:离线(既有报告种子基线 + 自比零回归 + 模拟 +30% 标 ▲)+ 真 LLM 冒烟(rag S1 直答 3/3 绿,统一入口 → 套件 → 基线 diff → 汇总 → 退出码全链路)

### Added(Anthropic prompt caching)
- **`llm.cacheControl`**(仅 `provider:'anthropic'` 生效):`true` = ephemeral 5m / `'1h'` = 长 TTL。ReAct 多轮每轮重发完整前缀(system+工具定义+历史)全价计费;开启后经 `invocationKwargs` 透传顶层 `cache_control`,**服务端自动打断点并随对话增长推进** —— 前缀命中缓存 input 价格降至 ~1/10(写 1.25x)。子 agent 同步透传(SubagentLlmConfig)。实现考据(探针实测):@langchain/anthropic 1.5.4 构造器顶层 `cache_control` 字段**不进请求体**(只消费调用时 options),必须走 `invocationKwargs` 展开。**端点支持差异(实测 2026-08)**:modelverse 网关非流式命中(实测 2787 token 前缀第二轮 2048 走缓存)、流式不生效(SDK 恒流式 → 该网关暂无收益,配置无害);官方 api.anthropic.com 流式回报。OpenAI/DeepSeek 端点自动缓存不受此开关控制
- **usage 缓存观测字段**:`TokenUsage` 增 `cache_read_input_tokens`/`cache_creation_input_tokens`,`normalizeUsage` 归一 Anthropic 顶层 snake 与 langchain `usage_metadata.input_token_details` 两种形态 → usage 事件 / `sdk.usage` 可见;真 LLM 回归框架同步累计进报告与基线指标(cacheRead/cacheCreate)
- rag-demo 挂 `cacheControl: true` 作展示与验证载体;selftest sec-53 +7(构造映射 true/1h/未传 + 归一两种形态 + 缺省不占位)

## [3.18.0] - 2026-08-16

### Added(UI)
- **`dialog.icons` 值支持 HTML 片段**(用户诉求:希望能用 img/svg/i 等标签做图标):值以 `<` 开头 → 识别为内联 HTML 片段(如内联 `<svg>`/`<img>`),经 **DOMPurify 图标专用白名单净化**后渲染 —— 只放行形状/图像标签(svg/path/circle/rect/line/polygon/g/img/i/em/b/span)与几何/描边属性(viewBox/d/fill/stroke/src/class 等),剥 onerror 等事件属性与 javascript: 协议,**不裸 v-html**,集成方传污染字符串也不可注入脚本;纯文本值(不以 `<` 开头)照常文本插值,与 3.17 行为一致。新增 `IconGlyph` 渲染出口组件(统一净化路径,单点维护安全策略)+ `isIconHtml`/`sanitizeIconHtml` 导出;`AvatarIcon` glyph 同样支持 HTML 片段。dompurify 复用主包既有依赖(markdown 已用),headless 子路径不受影响。测试:selftest 补 8 项(2200;isIconHtml 判定 + 白名单形状:不含 script/a/on*/href);browser 补 2 项(73:内联 svg 渲染保留几何属性 + 排队图标 onerror 剥除不执行);minimal-demo empty 换内联 svg、queued 放带 onerror 的 img 作净化断言 fixture

## [3.17.0] - 2026-08-16

### Added(UI)
- **`dialog.icons` 图标自定义**(用户诉求:默认 🤖/🎯 等 emoji 与业务品牌不符,希望能换):局部覆盖对话框内置 emoji —— 9 个文本键(`header` 🤖 / `subagent` 🤖 / `subagentProgress` 🧬 / `empty` 💬 / `focus` 🎯 / `queued` 📋 / `queuedEdit` ✏️ / `recommend` 💡 / `conflict` ⚠️)+ 2 个头像键(`assistantAvatar`/`userAvatar` 缺省 = 内置 SVG,传 emoji/字符替换为文本字形)。值为纯文本按文本插值渲染(**不解析 HTML,天然防注入**);空串 = 隐藏该图标;未传键用默认(默认路径行为零变化)。接线:`dialog.icons` → ChatDialog → `createChatContext` 解析(`resolveDialogIcons`)→ 各原子组件经 `ctx.icons` 取用(MessageSteps/FocusBar/ConflictBar 纯 props 叶子从父级下传,独立复用缺省默认)。导出 `DialogIcons` 类型 + `DEFAULT_DIALOG_ICONS`/`resolveDialogIcons`(L2 自建 UI 复用)。selftest 新增 sec-81(11 项)+ browser 新增 icons.spec(3 项:自定义生效 / 头像字形替换 / 未配置 demo 默认回归)

## [3.16.0] - 2026-08-16

### Added(UI)
- **工具步骤展开查看入参/返回值**(用户实测诉求:聊天框里工具调用只显示名字,排查要看 IO 细节):步骤行**右端「展开/收起」文字链**(Figma 设计稿 471:6389「05-思考完成」同款:收起态置灰、展开态紫色高亮)→ 展开显示该次调用的入参(pretty JSON)与返回值全文;×N 合并组逐次列出(「第 k 次」);超长展示截断(入参 2K/返回 4K,复制按钮可得全量);**全局单展开**(同一时间只展开一个,跨消息互斥,展开另一个自动收起);运行中即可看入参,完成后补返回值;错误返回值红色标识。browser 新增场景锁定(展开显示 args/result + 单展开互斥 + 再点收起)

### Fixed(UI)
- **已发 user message 的焦点 chip 不可删除**(用户反馈:历史 chip 不应能删):历史快照 chip 原带 ✕(点击会误删**当前**焦点,且改不了已发消息的上下文)→ 去掉 ✕,保留点击回看;当前焦点仍由输入框 chip 的 ✕ 管理。browser 断言更新:历史 chip 无 ✕ + 输入框移除焦点后历史标注保留(快照语义)

### Fixed(真 LLM 实测驱动:新建纯代码组件重复创建)
- **主 agent 重复落地子 agent 已创建的组件**(用户实测首页:新建纯代码组件 → 子 agent 自己创建(索引 8)+ 主 agent 把返回的 code 又 append 一遍(索引 9)→ 重复,再花轮次删重复):编排 prompt 双处收紧 —— ① 执行纪律补「新建组件由子 agent 全权创建」(主不替它创建/追加/落地);② 职责边界补「**委派返回即已落地**」契约(结论说已创建 = 组件已在数组,主 agent 再 write = 造重复组件,核对方式 = read 数组尾部确认 name 唯一)。子 agent 侧同步:**结论首行必须是落地声明**(「已创建组件 <name>(索引 N)」/「已修改组件 <name>」)+ **结论不贴代码全文**(贴了会诱发主 agent 再写一遍)。e2e 锁定:新建纯代码组件场景(数组恰 +1 / name 唯一 / 主 agent 零 write 只委派 / 子 agent path① 创建含 __pgId)

## [3.15.0] - 2026-08-16

### Fixed(rag-demo 真 LLM 回归驱动)
- **Anthropic 流式 usage 丢失**:网关实测聚合消息的 `response_metadata.usage` 为**空对象 `{}`**(非 nullish,`??` 链短路)→ `usage_metadata` 兜底不可达,`sdk.usage`/usage 事件恒 0。修:`extractUsage` 改候选逐个校验「至少含一个 token 数值字段」(空对象跳过)+ `normalizeUsage` 补 `input/output_tokens` 归一;真 LLM 四场景复测 token 采集全部有值(修前全 null)
- rag-demo 回归脚本自身:checks 引用未就绪字段(`d.tools`)致「零委派/委派」误判 → checks 前先算工具序列

### Added(rag-demo 四模式真 LLM 回归)
- **回归脚本 `tests/runtime/rag-demo-real-llm.mjs`**(Playwright 浏览器路径,Anthropic 协议):A memory 直答 / B mock 检索委派链路 / C 真实 MCP 优雅降级 / D MCP 直连诚实收口,四场景 checks 全绿 + usage/token 采集 + 断点续跑;rag-demo 补 `__sdk` 采样口(切模式后指向新实例)。内网 MCP 不可达时行为层验证:子 agent 如实报告 + 主 agent 诚实告知 + 零重试风暴

### Fixed(五路审查驱动:team-review-hardening)
- **写能力标注单一真相源**(治三处硬编码清单漂移同根复发):工具定义点 `writeCapable` 标注(布尔或 `(args)=>boolean` 条件形态),子 agent 装配剥离 / spawn 自授过滤 / 组件锁主写守卫三处消费统一按标注 —— 修 `SUB_WRITE_TOOLS` 漏 `eval_script(transform)`/`resource_update`/`resource_delete`/`restore_data` 的**子 agent 写面绕过**(HIGH:spawn 自授 eval_script 即获全量写能力)与 `WRITE_TOOLS` 同款**组件锁绕过**(委派在途时 eval_script(transform)/restore_data 可改被锁组件)
- **__pgId 补齐全写路径**(HIGH):`supplementPgId` 原只覆盖 write 工具三意图,`set_data`/`edit_data`/`eval_script(transform)`/`draft_commit` 四写路径丢映射键 → checkout/commit 定位断链。修:`internalAfterWrite` 收敛进 `commitSetToBind`/`applyPatchesToBind` 成功路径(带写前深快照**按位置回填原 __pgId** + 新增元素生成)
- **MCP 工具名保留字保护**(HIGH:被入侵/DNS 劫持 server 返回 `write`/`read` 同名工具经 dedupeTools「后注册覆盖」静默替换内置实现 → 主数据全文送远端):注入前查非 mcp 来源重名 → skip + warn 留痕,单工具冲突不拖累整 server
- **沙箱静态扫描加固**:`"".constructor.constructor("...")()` 原型链取 Function 逃逸完全不拦 → 补 `constructor`/`getPrototypeOf`/`.prototype` 模式
- **inspect_env 嵌套脱敏**:`inspect_env({key:'appConfig'})` 嵌套 `apiKey` 原样进 LLM 上下文 → `safeSerialize` 递归按敏感 key 正则打码 `[REDACTED]`(opts 开关只开 envTool 路径)
- **wrapToolCall 异常契约**(arch P1-1):用户中间件抛普通 Error 即 fatal 整轮 → 洋葱外层收敛 recoverable 错误结果回灌(abort 不吞)
- **wrap-up 收口丢压缩摘要**:收口轮 filter 掉全部 SystemMessage(与 P0-1 修复对立)→ 只去首条,中部摘要送达
- **streamStallMs:0 启动闸失效**:`stallMs || DEFAULT` 的 0 是 falsy 回退 90s(文档承诺「设 0 关」失效)→ `>0` 判定真·关闭
- **vfs 单文件超池静默淘汰**:3MB 写 2MB 池报「已写入」后 enforceLimit 即删(read NOT_FOUND)→ 写前预检显式报 `VFS_POOL_LIMIT_EXCEEDED`(附大小与拆分提示)
- **deleteSession 与 debounce pending 竞态**:删除后 500ms 内 pending timer 触发 → 幽灵会话复活 → 删除前清该 sessionPrefix 命中的 pending/timers
- **mount() 纯度**:`options.container = override` mutate 集成方对象 → 局部变量

### Added(测试盲区补强,五路审查 coverage-gap Top5)
- e2e automation:storage+checkpoint+automation 三特性共存(batch 间 checkpoint 持久 + 跨实例恢复)/ e2e mcp:**恶意同名工具拒绝注入**(真实 malicious server)+ **双 server 一坏一好故障隔离** / e2e custom-injection:memory 异步抛错降级不崩 / e2e data-slots:空 schema 全拒不静默 / browser **lifecycle.spec**(customize-demo 暴露 `__sdk`/`__remountSdk` 采样口):流式中 unmount 无 pageerror + 重挂无旧流复活 + 重挂后可继续对话

### Tests
- selftest 2106→**2177**(+sec-78 写标注完整性+__pgId 四路径 / sec-79 沙箱逃逸+嵌套脱敏 / sec-80 E4/E5 / sec-77 守卫按标注适配)/ e2e 666→**691** / browser 64→**67**

## [3.14.0] - 2026-08-15

### Fixed(rag-demo 真 LLM 实测驱动)
- **createRagSubagent 提示词与工具面不一致**:`RAG_SYSTEM_PROMPT` / rag-search skill 原为静态全文,无论实际配置都教子 agent「先 vfs_grep → search_docs → load_doc」—— `useVfs:false` / 未配 loader 的场景子 agent 没有这些工具,LLM 照 prompt 调用不存在的工具反复纠结烧轮次(实测 B 模式问「方舟是啥」浪费多轮)。修:systemPrompt 与 skill 全文按实际知识源(vfs/retriever/loader)动态生成,没配的源不提;自定义工具名(searchToolName/loadToolName)同步透传进 prompt;补「不要尝试未列出的工具」收尾纪律;导出的 `ragSearchSkill` 保持全源形态向后兼容

### Added(真实 MCP e2e + rag/mcp demo 四模式合并)
- **真实 MCP e2e(`tests/e2e/mcp.mjs`,10 项)**:spawn 真实 mock MCP server(StreamableHTTP,tsx 子进程)走完整网络链路 —— `connectMcp` 握手 → 工具迟到注入 → agent ReAct 真调 `get_weather` → 结果回灌;附挂死 server 超时降级 / release 先行竞态 / 全程 `unhandledRejection` 零断言。区别于纯 stub:SDK 的 MCP client 与 MCP SDK server 真跑网络
- **rag-demo 与 mcp-demo 合并(四模式对照)**:`examples/rag-demo` 升级 A(memory 异步注入)/ B(createRagSubagent mock)/ C(子 agent + 真实 MCP,.env `VITE_RAG_MCP_URL`)/ D(MCP 直连,原 mcp-demo 并入;未配 env 连本地 mock `npm run mcp:mock`);删除 `examples/mcp-demo`;C vs D 对照演示「检索隔离在子 agent」vs「工具直进主上下文」

### Fixed
- **MCP 后台连接不阻塞 mount(真测驱动)**:原实现 `initDone` await `connectMcp`(握手默认 15s 超时)→ server 不可达时对话框 15s 不渲染。改为后台 `void` 异步握手 + `core.agent.setTools` rebind 迟到注入(下一轮 LLM 即可用;就绪前对话正常只是暂无 MCP 工具);竞态两路幂等;`mcpBackgroundReleased` 标记防 release 先行时回填已释放 core 的 mcpClosers(连接泄漏)
- **子 agent `llm.provider:'anthropic'` 透传丢失**:`SubagentLlmConfig` 声明 anthropic 协议时子 agent 仍按 OpenAI 协议发请求(报 404/400)。修:`runSubagent` 检测 provider 预构造 `ChatAnthropic` 实例注入(经 `constructLlmFromConfig` 动态 import);openai 路径维持同步散字段向后兼容;`task.model` 覆盖同步透传

### Tests
- selftest 2092→**2106**(+6 子 agent anthropic 协议 fake-fetch 断言:/v1/messages 端点 + task.model 覆盖;+8 ragSubagent 提示词与工具面一致断言)/ e2e 655→**666**(+10 真实 MCP 链路 + inspect P0-3 改轮询适配后台注入)/ browser 63→**64**(+1 rag-demo D 模式 MCP 直连重建)

## [3.13.0] - 2026-08-15

### Added(并行子 agent 第一批:prompt 并行化 + 失败隔离;openspec `parallel-subagent-delegation`)
- **同轮并行委派引导**:`htmlOrchestratorPrompt` 编排段升级「逐个委派」→「多组件委派」—— 不同组件可在**同一轮并行**发多个 `use_<id>`(每次仍独立子 agent 实例;需 `maxParallelTools > 1`,默认 1 串行零变化);同组件单一在途禁令 + 一次 task 塞多组件禁令保留;主 agent 自己的 write 可与委派同轮混排
- **并行失败隔离(per-task settlement)**:无关联的并行任务一个出错**不批量回退** —— 失败委派以 error result 单独回灌主 agent,其余照常执行落地,主循环不中断(e2e 锁定);与单次 `write({ patches })` 整体原子回滚(一次逻辑写的原子意图)按**任务关联性**区分语义(spec 显式声明)
- **codeAsset commit 逐组件容错**:afterAgent commit 循环补 per-component try/catch —— 单组件 commit 抛错只跳过该组件(console.warn 留痕),循环继续不中断后续组件 commit(修前单组件异常会中断整个 commit 循环)

### Added(并行子 agent 第二批:组件锁 · 同组件单委派互斥 + 人工并发保护)
- **组件锁机制(`src/core/sdk/componentLock.ts`)**:同组件并发第二个 `use_html` 立即回灌 **`COMPONENT_BUSY`**(recoverable,零子 agent 消耗,主 agent 下轮重委派即可)—— 同组件互斥从 prompt 禁令升级为机制锁。锁目标 = `components` 显式声明(过滤编造名)/ 缺省时 task 文本与已知组件名**整词唯一命中**才锁(0 或 ≥2 命中不锁,宁漏不误);acquire 多组件原子(任一被占全失败不留半套锁),release 幂等;不同组件锁相互独立不阻塞并行;默认串行(`maxParallelTools:1`)零变化
- **主 agent 写检查(`createComponentWriteGuardMiddleware`)**:委派在途时主写工具(`write`/`set_data`/`edit_data`/`delete_data`/`draft_commit`)命中被锁组件子树 → 回灌 **`COMPONENT_LOCKED`**(整体 set 全量数据也拒;`dryRun` 不拦),锁释放后放行 —— 防主 agent 与子 agent 同时改一个组件
- **commit 人工并发检测(hash 快照比对)**:委派在途窗口(checkout→commit)内人工/宿主直改 bind 的保护 —— ① 同组件 code 被外部改过 → commit 保留人工值(**keep_external**,不静默覆盖)+ warn 留痕;② 组件被删 → 不复活 + vfs 工作副本同步清理;③ 索引位移(插入/删除致组件挪位)→ commit 按 `__pgId` 落到同组件,不写错位置(e2e H1-H4 真链路锁定)
- **观察层**:`inspect().subagent.lockedComponents`(组件名 → 占用委派 taskId)+ DebugDrawer 子 agent tab 组件锁视图;锁事件(logSink acquire/release/conflict)进 debugLogs

### Tests
- selftest 2061→**2092**(+31 组件锁白盒 sec-77:acquire 原子/幂等、resolveTargetComponents 三档、lockedIndexPaths 实时解析、写守卫六路、hashString、人工并发 H1/H2/无修改)/ e2e 625→**655**(+19:组件锁 4 场景[并行双锁独立/同组件 busy 零消耗/锁内写回灌 COMPONENT_LOCKED(时序锚 slow_probe)/默认串行零变化]+ 人工并发 H1-H4 真链路[delayMs 撑开在途窗口])/ browser 61→**63**(+2 complex-demo:同轮双 use_html 并行委派不同组件 / 同组件 busy 回灌下轮重委派)

## [3.12.0] - 2026-08-15

### Fixed(假成功治理:未声明字段静默剥离 → 显式拒绝;用户实测驱动)
- **写未声明字段假成功(SCHEMA_STRIP)**:schema 白名单遇 discriminatedUnion 降级放行后,zod object 默认 strip 模式把未声明键(如给 button 加 `style`)**静默剥离**,写回 parsed 数据却返回成功 —— agent 以为写进去了、页面无变化(实测 page-demo:加边框回复成功但样式不变)。修:新增纯函数 **`findStrippedKeys`**(已导出;收集「本次新增却被剥离」的键路径,宿主已有键不误报),`applyPatchesToBind` / `commitSetToBind` 命中即返 `SCHEMA_STRIP` 错误显式拒绝(附「该结构不支持这些字段」hint,agent 可据此如实告知用户,不再瞎猜编造)
- **`getSchemaAtPath` union 节点返 null → 递归下探**:遇 discriminatedUnion 原实现直接返 null,嵌套容器路径(如 `components.4.children.0`)无法解析 → **嵌套组件无法聚焦**、`schema_data` 深层查询降级。修:递归下探各 option 中声明了该字段者,任一命中取首个;任何 option 都无该字段仍返 null(降级不变)
- **委派类工具漏发 `data_change`**:子 agent 写 data(如 html 子 agent 写 code 字段)经主循环 `use_<id>` 工具内部落地,`sdk-events` 中间件只匹配直呼写工具名 → **非 reactive bind 宿主只监听 data_change 时永远收不到子 agent 写入的刷新通知**(实测 page-demo 纯代码组件数据落了画布不动)。修:`spawn_agent` / `spawn_agents` / `use_*` 成功收口后补发 `data_change`(operation 'edit';只读子 agent 误报仅多一次无害刷新)

### Changed
- **json 展示按钮样式统一**:MessageContent 代码块工具栏与 CodePreview 复制/下载按钮统一 icon 与视觉(复制用文本 icon、下载统一描边样式)

### Examples
- **page-demo 嵌套容器增强**:组件 schema 升级递归 union(手动 `PageComponent` 类型 + `z.lazy` children),新增 **card(可选 children)/ carousel(每项一页,‹› 导航)/ waterfall(CSS columns 分列)/ custom(纯代码,sandbox iframe 渲染)** 四类组件;渲染器重构为递归 `PageComponentView`(每个元素带嵌套 `data-path`,两步拾取/聚焦天然支持嵌套定位);page-builder skill 补嵌套路径/层级调整(move)/ SCHEMA_STRIP 诚实指引

### Fixed(真 LLM 二轮实测驱动:page-demo 嵌套场景回归)
- **read 泄漏 `__pg*`(union 元素)**:`projectBySchemaDeep` 遇 union/discriminatedUnion 走非 shape 分支原样返回,文档承诺的「read 投影隐藏 __pg*」失效 —— 实测 agent 从 read 输出照抄 `__pgId` 进 write 触发 SCHEMA_STRIP(多烧一轮自纠)。修:非 shape 分支对普通对象剥离 `__pg*` 键(无 __pg* 字段零拷贝原对象返回,union 降级语义不变)
- **`patch op:"remove"` 路径不存在静默成功**:`applyPatchToClone` 忽略 `deleteByPath` 的 false 返回 → 数组索引越界(实测 `remove components.8`)静默 no-op,同批其他 op 已生效整体报成功,agent 以为删掉了。修:返回显式错误(`remove 路径不存在` + 引导重新 read 确认索引);patches 原子语义下任一失败整体回滚。单删 `del` 意图保持幂等(「不存在无需删除」)不变
- **`findStrippedKeys` 数组位移误伤(评审 CRITICAL 复现)**:`move`/`remove` 使数组元素索引位移后,携带框架 sidecar 字段(如 `__pgNotes`)的**未改动**元素在新位置与 before 按位置错位比较 → 误判「新增被剥离」→ 合法调序/删除被 `SCHEMA_STRIP` 拒,且 `__pg*` read 投影隐藏、agent 看不见报错字段无法自纠。修:① 数组先按深度相等匹配「原样存在」的元素整体跳过(未匹配的新增/改动元素回落按位置比较,原地 set/merge 不位移语义不变);② `__pg*` 前缀键恒跳过(isPathAllowed 恒拒 → 无「合法新增」,标了只会误伤)。真·新增未声明键仍照标(本职不放松)。补 `findStrippedKeys` headless 子路径导出

### Tests
- selftest 2042→**2061**(SCHEMA_STRIP 拒绝路径 + findStrippedKeys 白盒(含 move/remove 位移不误判回归)+ union 下探新契约 + 宿主字段保留 + remove 越界显式报错 + union 投影剥 __pg*)/ e2e 617 / browser 56→**61**(+5 page-demo:嵌套渲染纯前端 / move 跨数组层级调整 / 聚焦嵌套组件(union 下探锁定)/ SCHEMA_STRIP 假成功锁定 / use_html 委派纯代码精修(委派 data_change 刷新锁定));新增真 LLM 回归脚本 `tests/runtime/page-demo-real-llm.mjs`(6 场景:聚焦嵌套/层级调整/嵌套属性/纯代码/诚实拒绝/嵌套新建;含 reload 快速失败防 idle 空烧)

## [3.11.1] - 2026-08-15

### Fixed(提示词与工具面一致性自查:prompt 不教未装载的工具;focus bug 同类排查)
- **usageHints simple 分支教 `schema_data`**(advanced 专属被 SIMPLE_HIDDEN 滤除,**默认 simple 模式即中招**)→ 措辞改「需切 advanced(schema_data/diff_data,当前未装载勿调用)」
- **minimal 模式整段共用 simple 提示**:教 query_data/search_data/eval_script/history_data/restore_data(均未装载,minimal 只有 read/write)→ 加 `minimal` 门控,仅保留 read/write 用法
- **planning 段无条件教 `request_human_confirmation`**(humanConfirm 可关)→ 按 `caps.humanConfirm` 门控,关闭时改文字征询引导(2 处:planning 段 + 规划-反思路由段)
- **resourcesPin 教 `resource_get/resource_update`**(resource_* 仅 advanced 暴露,配 `data.resources` + 默认 simple 即中招)→ `createResourcesPinMiddleware` 新增 `toolsExposed` 选项(createChatSdk 按 toolMode 传),未装载时明示「advanced 工具未装载勿调用」
- **todos 规划超限回灌**教「用 write/set_data/edit_data 落地」→ 改「用 write 落地;advanced 模式亦可用 set_data/edit_data」
- 排查确认无恙:`reliableWriteRules`(只提 read/write,全模式都有)/ usageHints 其余段(subagent/inspectEnv/domInspect/draft/focus 均按能力门控)/ checkpoint(无 prompt 注入)/ `chatContext` 挂 infoTick 的 computed 仅 focuses 一处(resetSession/switchSession 补 bump 后全路径覆盖)

### Changed(verify 配置统一:两处配 → 一处配)
- **传 `verify.check` / `verify.maxAttempts` / `verify.adversarial` 任一即自动开启 verify**(对齐 auto-html-agent 推断模式),无需再配 `capabilities.verify: true` —— 治「以为开了实际没开」的两处配置摩擦。优先级:`verify.enabled: false` > `capabilities.verify: false`(显式关闭阻止自动开)> 推断开启。误用 warn 同步更新(检测到 verify 配置但未装载时提示原因)。usage-guide 中英文同步

### Fixed(用户实测:focus 引导与 UI 残留)
- **聚焦文案引导调用不存在的工具(simple toolMode)**:focus 中间件的注入提示与 PATH_DENIED 文案无条件引导「先 remove_focus / clear_focus」,但 focus 工具仅 `toolMode:'advanced'` 装载 —— simple 模式(默认)主 agent 声称「先清除焦点」却无工具可调,只能硬写非焦点组件反复 PATH_DENIED(实测 page-demo:拾取按钮后要求文字红色,write 报错两次)。修:`createFocusMiddleware` 新增 `unfocusGuidance` 选项(`'tool'` 默认零回归 / `'ask-user'` 引导提示用户移除输入框聚焦 chip / `'report-parent'` 子 agent 引导收口反馈),createChatSdk 按 toolMode 自动分支,子 agent 装配点固定 `report-parent`;codeAssetMiddleware vfs 越界文案同步去工具指名
- **聚焦注入补默认目标引导**:「用户未指明目标的指令默认作用于聚焦组件」——治实测「用户拾取按钮后说文字红色,agent 先误解为全页改」的意图漂移
- **清空对话后输入框聚焦 chip 残留**:`resetSession` 调 `focusMw.reset()` 清了焦点但不 bump `infoTick`,chip 的 computed(挂 infoTick)不重算 → 旧焦点残留在输入框。修:`resetSession`/`switchSession` 统一补 `infoTick++`(与 setFocus/addFocus/removeFocus/clearFocus 契约对齐)

### Fixed(提示词命名参数化:prompt 不写死集成方字段名)
集成方字段命名各异(代码字段 code/html/innerHtml/嵌套 props.html_code,数组路径 components/blocks/sections),机制层早已参数化但 prompt 层写死示例会反向误导 LLM 照抄不存在的路径:
- **`htmlSystemPrompt` 三参化(codeField/root)**:全部示例路径跟随实际配置(`data 的 ${codeField} 字段` / `jsonPath:'${root}.N'` / `validate_code({jsonPath:'${root}.N.${codeField}'})`);root 未传 writablePaths(3.9+ 自动装配主路径)先用 'components' 占位,**装配期推断回填后经 `_rebuildCodeAssetPaths` 钩子重建** systemPrompt + 默认 skill(与 `_codeAsset` 标记同模式;自定义 skills 不被覆盖)
- **内置 skill builder 化**:`HTML_FRAGMENT_SKILL_DOC` 常量 → `htmlSkillDoc(root, codeField)` + 新导出 **`buildHtmlFragmentSkill(root?, codeField?)`** 构造器(`htmlFragmentSkill` 保留为默认快照,公共契约不变)
- **`validate_code` schema 描述去写死路径**(jsonPath 描述不再带 components.2.code 示例;path 描述用工厂已知的 vfsPrefix)
- **`htmlOrchestratorPrompt(id, codeField)` 第二参**:职责边界/委派失败重试段的「code 字段」跟随实际字段名;默认 description / `htmlPageProposeFirst` 方案切换 / `htmlDirectWriteFallback` 同步泛化(去 'custom'、去 use_html 写死)
- 保留:`schemaHasCodeField` 硬编码 'code'(仅无子 agent 降级编排检测用,无 codeField 配置可挂;误检只少注入 fallback 无副作用)

### Changed(craftNotes 收口纪律,真 LLM 实测驱动)
- **子 agent `[note]` 交接笔记漏写治理(实测漏写率 3/4 → 治理后 1/1 沉淀)**:原指令埋在子 agent prompt 中段(recency 差)。双通道强化:① prompt 末尾新增「收口格式(必守)」硬约束(recency 位);② per-round augmentPrompt 文件地图头部注入收口提醒

### Tests
- selftest 2011→2042(verify/focus/craftNotes +9 → 工具面一致性 +9:sec-19 minimal 不注入未装载工具用法 + schema_data 措辞 + humanConfirm 门控 / sec-61 resourcesPin toolsExposed 门控 → 命名参数化 +13:sec-67 codeField/root 参数化 + 重建钩子 + buildHtmlFragmentSkill / sec-31 htmlOrchestratorPrompt codeField 参数化 + htmlPageProposeFirst 泛化)/ e2e 610→617 / browser 54→56(+2 focus bug 复现锁定:清空对话 chip 不残留[complex-demo] + simple 聚焦注入/PATH_DENIED 文案引导「输入框」且请求 tools 无 focus 工具[page-demo])

## [3.11.0] - 2026-08-15

### Added(上下文经济性二阶段 + agent 预算自感知)
- **压缩触发成本上限 `promptSoftCapTokens`**:token 触发阈值改 `min(窗口 × ratio, softCap)`——大窗口模型(flash 类 1M)按 ratio 要烧几十万 token 才压缩,softCap 把「何时压缩」改成成本维度。解析单一真源 `resolvePromptSoftCap`(`src/core/composables/contextIndex.ts` 并导出):显式 >0 用该值 / 显式 0 = 关 / 未传且窗口 ≥320K → 默认 160_000(`SOFT_CAP_MIN_WINDOW`/`DEFAULT_PROMPT_SOFT_CAP` 一并导出)/ 其余不参与;`min` 语义只会更早触发、不影响小窗口模型原行为。生效值经 `inspect().compression = { contextWindow, summaryThresholdRatio, promptSoftCap }` 反射
- **agent 预算自感知(零配置默认生效)**:① 消耗提示 —— 工具轮次达 `maxToolRounds` 70% 或本次任务累计 prompt token 达 softCap 一半时,system prompt 注入一行「⏳ 预算提示」(每任务一次,给收敛/汇报两出口);② 写失败提醒 —— 同一写路径连续 ≥2 次失败注入「先 read 重新核对 / restore_data 回退」(成功清零);③ 计划版次计数 —— `maxPlanRevisions` 超限回灌文本补「现在已是第 N 版计划」
- **`roundTokenBudget`(单次调用 token 预算,opt-in 默认 0=关)**:单次 invoke 累计 total_tokens 超限 → 友好收口文本中断(不走 wrap-up 追加 LLM 调用防再烧;debugLogs 留痕 `round_token_budget_exceeded`;已完成部分保留可继续对话)。与 automation 的 `tokenBudget` 正交:后者跨会话累计需 `capabilities.automation`,本项单调用无条件可用

### Changed
- **工具描述瘦身二批(-40%)**:eval_script(505→153 字符)/ draft_commit / set_data / draft_write / get_data / query_data / search_data / history_data / edit_data / inspect_env / get_dom 共 11 个工具描述按「何时用 + 关键参数」原则压缩,教程细节归 usageHints(`!simple` 分支,不双份);selftest 补语义锚点 + 长度上限回归断言(防一阶段反向锚定事故重演)

### Fixed(真 LLM 复测:wrap-up/重试耗尽路径 DSML 泄漏剥离)
- **wrap-up 收口泄漏未解析 DSML**:工具轮耗尽收口(wrap-up 裸 llm + 「工具已用尽直接作答」提示)时模型仍以文本输出工具调用(实测 S1:截断的 `use_html` 委派任务规格),原文不经 garbled 检测直接当最终答复返回 —— 对用户是乱码且暗示已执行,实为零执行。修:wrap-up 与主循环 garbled 重试耗尽路径统一走新导出 `sanitizeGarbledContent`(首个强守卫标记前 prose 保留、其后 DSML 块剥离;无剩余换诚实兜底文案)+ debugLogs 留痕(`garbled_wrapup`)+ observable error `GARBLED_TOOL_CALL_EXHAUSTED`
- **headless send/batch 路径 observable error 事件不外发**:send 只传 approvalWatch 给 agent,agent stream 内的 observable error(GARBLED_TOOL_CALL_EXHAUSTED / ROUND_TOKEN_BUDGET_EXCEEDED 等)到不了 `options.onEvent` —— 集成方对「任务可能未完成」无感知。修:新增 `makeStreamWatch`(approval 自动拒 + error 类事件转发 emit;流式 delta 仍仅 stream 模式外发,契约不变)

### Tests
- selftest 2006→2011 / e2e 605→610 / browser 54;真 LLM 复测 S1 prompt **-40%**(502K→300K)、工具调用 **-44%**(27→15)

## [3.10.2] - 2026-08-15

### Changed(上下文经济性第一阶段,真 LLM 量化驱动;实测 prompt tokens -19%)
- **usageHints 受保护资源教程段去重**(与 resourcesPin 每轮功能段重复注入,实测双份)
- **编排提示段合并**(执行纪律/职责边界/修改类三段重叠 → 两段;视觉锚引用规范)
- **write/query_data/edit_data 工具描述压缩**(-40%,教程细节归 usageHints)

### Docs
- UI 规范 skill 双挂模式文档

## [3.10.1] - 2026-08-15

### Added
- 补 `detectTransitionalReply`/`detectGarbledToolCall` 公共导出(3.10.0 新增内部判定能力,集成方可复用)

## [3.10.0] - 2026-08-15

### Added
- `htmlFragmentSkill` 导出(v-html 片段生成 skill,UI 规范 skill 双挂模式基础)

### Changed
- `normalizeBaseUrl` 相对路径容错

### Fixed(真 LLM 五连修,flash + modelverse 场景)
- **stream 启动闸(P1-7b)**:`streamer.stream()` 启动 Promise 包 race 超时(与 `streamStallMs` 同阈值 90s)—— 等响应头阶段假死(fetch 默认无超时)时流停滞看门狗(只包已返回的迭代器)不覆盖,子 agent use_html 委派实测挂 17 分钟;超时抛 `StreamStalledError`(status=408 不空烧重试,abort 清理)
- **子步骤永 running 兜底扫尾**:子 agent 中断(网络断在 LLM 流)时其 tool_call 子步骤无配对 tool_result → status 永停 running(UI spinner 永转);useChat finishRound 一轮结束统一把遗留 running(含 children 递归)置 error 带说明
- **过程性收口回灌(`detectTransitionalReply` 导出)**:本轮已执行过工具且最终文本是过渡性计划表态(实测 flash 样本「好的,我先看看…再委派生成」调研完即收口,任务零落地)→ 有界回灌(≤2 次,绕 rounds 预算同 garbled-retry 语义)让模型继续执行;保守判定(≤160 字 + 过渡模式 + 无完成动词)防误伤
- **DSML 单竖线变体解析**:flash 泄漏形态 `<｜DSML｜invoke>`(单竖线)+ 对称闭合 `<｜DSML｜/parameter>`(原正则只认双竖线 + XML 闭合)→ detect 命中但 parse null → 重试耗尽 → **DSML 文本当结论返回主 agent,子 agent 工具白做**。修:守卫判定后剥离单竖线标记归一纯 XML 形态 + 闭合正则宽化(两种闭合形态都支持);截断保护不回归
- **编排视觉锚引用规范**:task 规格化的视觉锚 hex **取自平台 UI/设计规范 skill 的定义值**(有规范类 skill 先 load 再引用,勿凭页面观察自造近似色)—— 实测主 agent 自造 #667eea 与规范 #7063E7 冲突

## [3.9.0] - 2026-08-14

### Added
- **HTML 子 agent 自动装配(默认开,浏览器端页面搭建开箱即用)**:无显式 html 子 agent + subagent 能力开 + schema 含「数组元素带 code 字段」→ 装配期自动注册默认 `createHtmlSubagent()`(委派编排 + vfs 工作副本 + 格式校验 + 增量 commit 全套,console.info 留痕)。无开关(用户拍板主场景只有 HTML,不需要关闭);显式 `createHtmlSubagent(...)` 优先不重复装配;推断不出的形态(顶层 code 字段/开放 schema)不装 → 走「主 agent 自己写」降级直写。**行为变更提示**:此前依赖「数组 code 字段 + 主 agent 直写」的集成,现自动走委派(如需直写请改 schema 形态或显式自定义编排)

### Changed
- **storage 默认 'memory'(开箱即用多会话)**:不传 `storage` = 纯内存会话(会话历史/切换 UI 可用,零落盘副作用);`false` 显式关闭;跨刷新持久化用 `'indexed'`。原「未传 = 关闭」语义的集成需显式 `storage: false`
- **presets.pageBuilder 简化**:HTML 子 agent 由 createChatSdk 装配期自动装配(3.9),preset 不再自带 `subagents`(getter 防突变逻辑退役),只剩场景化身份 prompt(向后兼容,spread 行为不变)
- **examples 优化**:① rag-demo 与 rag-subagent-demo 合并为单 demo 双模式(A memory 异步注入 / B createRagSubagent 检索子 agent,顶部切换重建 agent;共享 mock 知识库不再重复内联);② complex-demo / html-page-demo 的 `createHtmlSubagent()` 去掉显式 `writablePaths`(演示 3.6+ 装配期推断最小形态);③ minimal-demo 头部补 `presets.pageBuilder` 一行式指引

## [3.8.1] - 2026-08-14

### Changed
- **examples 优化**:rag 双 demo 合并双模式 / createHtmlSubagent 空参演示推断 / pageBuilder 指引;browser 场景3(use_rag 委派链路)

## [3.8.0] - 2026-08-14

### Added
- **patch op `move`(移动/重排数组元素一步完成)**:`{op:'move', jsonPath:'components.2', value:'components.0'}` —— 同数组即重排(替代双 set 交换,索引易错),跨数组即移动(替代 append+remove 两步非原子);目标可为数组本身(追加;不存在且父级为对象时自动建数组)或数组内下标(插入,越界 clamp);目标下标按移除源后解释;仅支持数组元素;目标路径同样过 schema 白名单;进 patches 原子批。新导出 `moveByPath` 纯函数

### Fixed
- **draftWrite 提示词与工具面不一致(simple 模式教 LLM 调不存在的工具)**:SIMPLE_HIDDEN 滤除 draft_write/draft_commit 但 usageHints 照常注入用法 → 补 `!simple` 守卫

### Changed
- **spawn 委派提示更新**:补 writablePaths 授写说明 + spawn_agents 并行委派(注明并行不可授写,写操作由主 agent 收尾)
- **reliableWriteRules 补第 6 条**:乐观锁冲突(VERSION_CONFLICT/挂起等用户)的行为预期,防 LLM 遇冲突放弃任务
- htmlSystemPrompt 工具清单措辞修正(`write + set` → `write(set/patch)`)

## [3.7.0] - 2026-08-14

### Added
- **presets.pageBuilder 默认带 HTML 代码子 agent**:`createChatSdk({ ...presets.pageBuilder, container, llm, data })` spread 一步 = 完整页面搭建能力(schema 有「数组元素含 code 字段」时自动获得委派编排 + code 资产机制;显式传 `subagents` spread 覆盖即替换);`subagents` 经 getter 每次取值新建 config(防装配期回填 writablePaths 跨实例污染共享单例)

### Changed
- **writablePaths 推断失败语义:throw → warn + 剔除(优雅降级)**:schema 无 code 数组(如 pageBuilder 用在纯数据页面)时不再崩整个集成 —— 该 html 子 agent 被自动剔除,主 agent 编排注入自然走「无 html agent」分支(schema 另有顶层 code 字段则注入降级直写 fallback),console.warn 留痕;「宁失败不猜错路径」不受损(不猜路径,只不装不适用能力)
- **CA 并发修复(audit P2×2 清零,per-call context 通道)**:`maxParallelTools>1` / 并行委派下的两处闭包单变量错乱修复 —— ① dataOps `activeScope` 并发交错(乐观锁基线读写错 scope)→ per-call scope token(`__pgDataScope` 经 RunnableConfig.configurable 透传,ambient 兜底);② subagent 中间件 `currentSignal/currentEmit/currentLogSink` 并发覆盖(M3,子 agent 继承无关工具的停止信号/进度 handler)→ `__pgSubagentCall` per-call 注入,闭包降 fallback。机制:中间件 `wrapToolCall` 写 `ctx.callConfig` → coreExecTool 经 `{ configurable }` 传到工具 fn 第二参(zod 校验重建 args 对象,args 注入通道不可行);默认串行(`maxParallelTools=1`)行为零变化

## [3.6.0] - 2026-08-14

### Added
- **createHtmlSubagent `writablePaths` 可选化(装配期推断,集成降门槛)**:未传时装配期从 `data.schema` 顶层扫描「数组元素含 `codeField` string 字段」的路径自动回填(新导出纯函数 `inferWritablePaths`,console.info 留痕;显式传入优先跳过推断);推断不出的形态(开放 schema `z.any()`/`z.record`、嵌套容器如 `sections[].children[]`、点路径 codeField 嵌套结构)→ 提示显式传参(宁失败不猜错路径;3.7.0 起该分支降级为 warn + 剔除不崩集成)
- **MCP 工具调用超时闸**:单次 `callTool` 默认 60s(`mcp[].callTimeoutMs` 可调,独立于握手 `timeoutMs` 15s),server 挂起不再拖死 ReAct 轮 —— 超时该次调用作废(recoverable 回灌 LLM 自纠,不重试),连接不断后续调用复用;新导出 `withCallTimeout` 纯函数 + `DEFAULT_MCP_CALL_TIMEOUT_MS`;补 2.39.0「挂起收口三契约」漏网项

## [3.5.0] - 2026-08-14

### Added
- **组件工匠笔记(`craftNotes`,默认开)**:html 子 agent 收口回复末尾 `[note] <一句话实现要点>` 行(htmlSystemPrompt 约定)→ 框架 afterAgent 沉淀为组件 `__pgNotes` sidecar(FIFO ≤5 条 × 200 字,随 data json 进服务端 DB 跨会话持久),下次委派同组件经「组件代码文件地图」注入最近 1 条(`📝 笔记×N`)—— 同组件跨委派**设计意图持续**(「前任的交接」:设计决策/用户偏好/踩坑),状态在数据里不在子 agent 实例里(与 code-as-data-asset 哲学同构);收口文本经 **wrapModelCall 捕获进 state `__pgFinalText`**(afterAgent 的 state.messages 只有初始 user 消息,beforeReturn 受 `maxVerifyAttempts>0` 门控,wrapModelCall 洋葱是唯一全路径覆盖点);`__pgNotes` 走 `__pg*` sidecar 机制(agent read 投影隐藏 / 写不进,框架独占);`createHtmlSubagent({ craftNotes:false })` 关闭(零沉淀零注入)
- **主 agent 偏好转述**:委派 task 规格化补 ⑤ 要素(可选)—— 聊天上下文中有与该组件相关的用户历史偏好/反馈时提炼一句附 task 末尾(新子 agent 无记忆,偏好经 task 传递)
- **无 html agent 复杂多组件 e2e 场景**:降级直写模式下主 agent 独立完成复杂页面操作(4 组件建页含 2 纯代码 / `write patches` 原子批调序 + 增量改 code + 组件移入容器嵌套 / 全程零委派 / 无 `__pgId` 注入差异断言),与委派模式行为对照锁定

### Changed
- **html 子 agent 终稿纪律 + task 视觉锚**(真 LLM 思考日志实测驱动):htmlSystemPrompt 加终稿纪律(要点清单一次定稿 → 直写终稿 / 同一几何层级约束只推演一次 / 不整段重写;实测 beer-effect 思考里写两版完整代码 + 同一 bottom 推导 3 遍,代码 token 翻倍);htmlOrchestratorPrompt 视觉风格要素补视觉锚指引(主色 hex / 主体占比 / 装饰密度,收窄子 agent 装饰细节推演空间)
- **严格 CORS 网关开箱兼容**:constructLlm 默认注入 fetch 包装剥 openai SDK 自动附加的 `x-stainless-*` 遥测头(严格 CORS 的 OpenAI 兼容网关白名单不含 → 浏览器预检失败;主 agent 与子 agent 散字段兜底路径三处统一,真 LLM 抓包实测);集成方 `extraConfig` 可覆盖
- **子 agent LLM 配置完整透传**:`createChatSdk` 传给 subagents 中间件的 `LLMConfig` 在子 agent 兜底散字段构造时丢 `extraConfig`/`extraBody` → 透传修复(修前集成方 headers/fetch/thinking 配置在子 agent 全失效)
- **mcp-demo 双模式**:`.env` 配 `VITE_RAG_MCP_URL` 切 RAG 知识库模式(动态注入 rag_search/rag_ask/rag_documents),未配保持 mock 模式;内网地址只进 `.env` 不进源码

### Fixed
- **html-page-demo 预览块点击拾取失效**:sandbox iframe 吞 click 不冒泡回父页(点预览区组件块永远触发不了选中;e2e 之前点 tab 掩盖)→ 加 `.pick-capture` 透明捕获层(与首页两步拾取统一),已聚焦组件撤层放行 iframe 内交互;e2e test5 改走真实用户路径

### Tests
- selftest 1931 / e2e 569 / browser 53(+ craft-notes selftest 19 项 / e2e 沉淀累积注入场景 / browser 工匠笔记场景 / 无 agent 复杂多组件 10 断言)

## [3.4.0]

### Added
- **createHtmlSubagent 可配置 code 字段(`codeField`)+ 主 agent 编排自适应注入**(open-schema):`codeField`(默认 `'code'`,嵌套 jsonPath 如 `'props.html_code'` 适配开放 schema 多组件平台;「是否代码组件」= 该路径有 string)+ 装配期命中校验(组件数>0 全员未命中 → onWarning 防填错静默失败);编排**零配置自适应**(有 html 子 agent → 自动注入委派编排 `htmlOrchestratorPrompt(id)`(custom code 不 read 不 write 全权 `use_<id>`)/ 无 agent + schema 有 code 字段 → 自动注入 `htmlDirectWriteFallback` 自己写 + warn / 开放 schema `z.any()` 扫不到 → 集成方 opt-in spread);opt-out `orchestratorPrompt:false`;`htmlOrchestratorPrompt(id)` 导出(动态 `use_<id>`,`systemPromptHelpers.htmlPageOrchestrator` 为其 `'html'` 静态快照,单一数据源)
- **html 子 agent 过度思考治理**(thinking-taming,真 LLM 实测驱动):① 主 agent 委派 task 规格化(4 要素:定位/视觉/内容/交互,不含技术实现,收窄子 agent 决策空间)② `validate_code` 支持 `jsonPath`(从 data 读 code 校验,零重传 content;**schema 描述/字段顺序/实现 if 链三处优先级统一为 jsonPath 首选** —— 真 LLM 实测发现 schema 反向引导会覆盖 prompt)③ 写前简述(1-2 句方案 → 实现 → 照做)
- **complex-demo e2e 组件操作场景**(+3):调换顺序(`write` patches 批量 set 交换)/ 改层级(组件移进容器 `props.children`)/ 聚焦改纯代码(addFocus → use_html 委派 → 子 `vfs_write` 越界 `PATH_DENIED` 回灌 / 焦点文件放行)

### Fixed
- **schema_data 栈溢出**:容器组件 `children: z.array(PageComponent)` 自引用(z.lazy 递归)致 `describeSchemaNode` 无限递归栈溢出(真 LLM 实测 round 2 暴露)→ depth>15 + visited WeakSet 双截断(向后兼容)
- **complex-demo custom 组件 UI 拾取失效**:sandbox iframe 吞 click(事件委托 `closest('[data-path]')` 命不中)→ wrapper div + iframe `pointer-events:none`(click 透 wrapper 命中 data-path,可两步拾取)
- **编排双重注入**:html-page-demo / complex-demo 手动 spread `htmlPageOrchestrator` + 框架自动注入 = 编排段重复注入 → 删手动 spread(自动注入覆盖)

### Tests
- selftest 1905 / e2e 556 / browser 51(+ complex-demo 组件操作 3 场景)

## [3.3.0]

### Changed
- **对话框默认主题改 dark**:不传 `dialog.theme` 即首页方舟专题色板(深色紫调);显式 `theme:'light'` 回退浅色。统一所有 demo 观感(用户反馈:聊天框应默认首页样式)
- **html-page-demo 全屏双栏布局**:仿首页 `100vw×100vh` flex,大预览撑满 + 对话框 100%(替代 480px 小框)

### Added
- **robot/user SVG 头像**:替代 emoji 头像,`AvatarIcon` 组件内联 SVG 随库打包,`fill=currentColor` 可主题化(新增 `--cs-avatar-fg`/`--cs-avatar-user-fg`)
- **组件代码文件地图**(修 `__pgId` 映射摩擦):`codeAssetMiddleware.augmentPrompt` 每轮注入 `name → vfs 路径` 映射表到子 agent system prompt,按 name 直接定位代码文件(存量随机 id + 新建组件都覆盖);主 agent 不污染

## [3.2.0]

### Added
- **code-as-data-asset focus vfs 守卫**:补 `focus.ts` 排除 vfs 的缝隙 —— 子 agent 继承主焦点后改代码,只能 `vfs_edit` 焦点组件文件(`__pgId` 归属判定),越界 `PATH_DENIED` 回灌自纠。「点选组件 → 对话精修」硬约束基础
- **html-page-demo 多组件 + 点击 focus 精修**:预览组件列表切换、点击组件 `setFocus`、新建自动选最新
- **子 agent 提示词 focus 段**:`htmlSystemPrompt` + html-builder/fragment skill 引导子 agent 聚焦时直接改对、不浪费轮次

### Removed
- 删 `html-subagent-demo`(sfc 形态不渲染、展示弱),html-page-demo 统一代表 createHtmlSubagent

## [3.1.0]

### Added
- **子 agent 思考过程可见**:子 `reasoning` 经 `subagent` 事件(`kind=reasoning`)转发到主 UI,spawn 步骤折叠展示(运行中"思考中…" / 完成"思考过程");子工具 ×N 合并(与主 agent 一致);收口后细节截短留预览
- **html-page-demo 多方案流程**:新建类请求先文字出 2-3 方案,选定才生成(避免预览反复);方案切换按描述重生成

### Fixed
- **approval-bar 统一滚动区**:随消息一起滚动,超高内容不再被裁剪(修前固定遮挡)

## [3.0.0] — breaking major(code-as-data-asset)

### Changed(breaking)
- **createHtmlSubagent 单模式**:代码作为 `data.code` 资产(进服务端 DB),vfs 作编辑工作副本;框架 `beforeAgent` checkout(data.code→vfs 按 `__pgId`)/ `afterAgent` commit(vfs→data.code 增量,直改 bind 不进快照栈)自动搬运,主 agent 透明(主 scope read 见 `<code Nkb>` 摘要)
- **`__pgId` 无感注入**:schema extend 加 / read 深投影隐藏 `__pg*` / 写 path guard 拒 / persist 透明带(组件稳定映射键)
- **去 `onComplete`/`codeRef`/`codeSnapshots`**:框架 afterAgent 自动 commit,集成方无需回调

### Added
- **格式校验链**(`formatCheck` 默认开):`validate_code` 自检工具 + verify beforeReturn 门禁(标签闭合 + v-html 片段契约,回灌自纠,`maxVerifyAttempts` 2 兜底);导出纯函数 `validateHtmlFormat` / 工厂 `createHtmlFormatCheck`
- `codeKind:'sfc'`(默认 Vue SFC)/ `'html'`(v-html 片段:无外围标签、禁 script)

### Removed(breaking)
- 旧 `codeRef` 引用模型 + `onComplete` 回调 + `codeSnapshots`(被单模式 code-as-data-asset 取代)

## [2.43.0] - 2026-08-11

### Added
- **html agent 输出格式校验链**:html 子 agent 装配 `validate_code` 自检工具(`validateHtmlFormat` 结构校验:标签闭合/注释/多余闭合;DOCTYPE/html/head/body/script 均允许)+ verify beforeReturn 门禁(校验不过回灌自纠,`maxVerifyAttempts` 兜底)+ v-html 片段生成契约(3.4.0 `codeKind`/htmlFragmentSkill 的前身)

### Changed
- CLAUDE.md 瘦身:架构细节(流程图/数据槽深潜/能力全景)迁 `doc/architecture.md`,本文件只留不可违背契约

## [2.42.0] - 2026-08-11

### Added
- **内置深色主题 `dialog.theme:'dark'`**(方舟专题设计稿 Figma 色板):ChatDialog `.cs-theme-dark` 色板块(#222 紫微光外框 / #353535 气泡+工具栏 / #7063E7 用户气泡 / 状态点 #00C562·#F04848 / 紫边输入框+渐变发送钮)+ DebugDrawer 同款内置主题(`csTheme` prop,ChatDialog 自动透传,`--dd-*` 全变量化)+「思考中」态设计稿化(主色方点脉冲)+ 历史下拉当前项整行主色。全部经 `--cs-*`/`--dd-*` 变量驱动,light 默认零回归,集成方可祖先覆盖自定义

## [2.41.1] - 2026-08-11

### Fixed
- **DebugDrawer 日志列表生成期间实时刷新**(审计未编号 P1 残留清零):mountChatDialog/customize-demo 传 `.slice()` 新引用触发响应式更新 + browser 断言 ×2
- **rag-demo Anthropic 协议修复**:根因 `@anthropic-ai/sdk` buildURL `new URL(baseURL+path)` 相对 baseUrl 抛 Invalid URL → dev 经 vite 代理且 baseUrl 用绝对 URL;apiKey 移出代码进 `.env`(`VITE_ANTHROPIC_*`);mockLlm 双协议拦截(chat/completions + /v1/messages)

### Changed
- CLAUDE.md 整理(87KB→33KB:保留全部规则/契约/坑,删版本演进叙事)

## [2.41.0] - 2026-08-11

### Fixed(审计 P1 最后一批六项,P1×27 至此清零)
- **resetSession 收口统一**(P1-8/9):删 `!store` 早退,无 storage 也完整重置 mission/focus/todos 等内存态 + 收口挂起冲突(keep_external)+ 公开 `sdk.resetSession()`
- **shareContext 串行闸上移 core**(P1-11):`runSerial`/`activeControllers` 建 core 级,双实例并发 send/switchSession 串行;生命周期收口中止共享 core 全部在途流
- **白名单深投影统一**(P1-19):7 处根级读 `projectBySchemaDeep` 递归,嵌套未声明字段不再泄露(schema 白名单护城河唯一破口堵上)
- **压缩 LLM 摘要异步化**(P1-25):模板先行 + 后台前缀缓存,首 token 零阻塞
- **markdown 渲染节流 + hljs 尺寸闸**(P1-26):修流式 O(n²) 冻结

## [2.40.0] - 2026-08-11

### Added(主×子协同隔离,审计组 3 三项)
- **per-scope 乐观锁基线**(P1-13):`baselines` Map + `controller.enterScope/exitScope`,子 agent dataOps 工具经 scope proxy 隔离 —— 子 read/write 不污染主基线,「同 scope 连续写永不互相冲突」回归测试锁定
- **spawn_agents allSettled 逐任务结算**(P1-14):聚合 ✓/✗,单失败不拖垮整批
- **子 usage 回传 core.usage**(P1-17a,`normalizeUsage` 纯函数共用)+ **子执行超时 `subagent.timeoutMs`**(P1-17b,opt-in,链式 abort)

## [2.39.0] - 2026-08-11

### Added(挂起与反馈收口三契约,审计组 1 七项)
- **超时默认值表**:approval/humanConfirm 无响应方 30s 自动拒(`APPROVAL_AUTO_REJECTED`)/ MCP 握手 15s 降级 / skills fetch 30s / LLM 流停滞 90s 看门狗(`streamStallMs`,0 关)
- **abort 收口**:`activeControllers` 注册表;send/batch 接 signal 可中断;unmount/switchSession/resetSession 先断全部在途流;stop() 清排队留痕

### Changed
- **兜底收口必留痕**(可见性契约:debugLogs + observable error)

## [2.38.2] - 2026-08-11

### Fixed(审计 P0 + 授权面加固,Q1-Q5 拍板落地)
- **P0-1 子 agent 装配断层**:rag/html 能力包 `allowedTools` 指向的 vfs 工具恒不可见(合并池改 getter,含中间件工具)
- 子栈继承主 permissions/approval(approval_request 直通主循环,P1-16)/ spawn 自授收紧 + 装配期源头 filter(P1-18)/ writablePaths guard 补根写拦截(P1-15)/ focus strict 兑现 + eval_script 拦截(P1-21/22)/ 子 offload 桥接主 vfs 共享池(P1-15b)

## [2.38.1] - 2026-08-11

### Fixed(审计无疑问 P1)
- hook 流式事件 / WebStorage 守卫 / ZodArray 索引模式

### Added
- d.ts↔src 类型双向门禁(`npm run test:types-alignment`)

## [2.38.0] - 2026-08-10

### Added
- **子 agent 观察层**:`createSubagentTracker` + `inspect().subagent.{active,history}` + `sdk.getActiveSubagents()`/`sdk.subagentHistory` + DebugDrawer「🤖 子 agent」tab。纯观察层,不改生命周期/事件链

## [2.37.0] - 2026-08-10

### Added
- **能力包子 agent 工厂**:`createRagSubagent`(RAG 检索,只读)/ `createHtmlSubagent`(HTML 代码生成,代码→vfs)+ 子 agent 架构扩展(`allowedTools`/`middleware`/`summarization`)+ `sdk.vfsWrite` 命令式入口 + `rag-search`/`html-builder` skill + `rag-subagent-demo`/`html-subagent-demo` + augmentPrompt 委派引导

## [2.36.0] - 2026-08-10

### Added
- **`page-agent-sdk/headless` 精简子路径**:纯核心不含 UI(ESM ~333KB vs 主包 ~789KB)。依赖反转 `_createChatSdk` 内部工厂 + 双入口(主入口注入 UI / headless 不注入),主包零变化

## [2.35.0] - 2026-08-09

### Added
- **customize-demo**:headless 完整参考(低代码自定义 UI / 聚焦 / 聚焦历史 / 会话管理 / 调试抽屉)
- 导出 `DebugDrawer`(headless 调试复用,纯 props:`logs`/`getInfo`/`infoTick`)+ 暴露 `afterRound`/`debugLogs`/`infoTick`

### Removed
- 删冗余 demo(toolsets-demo 等与现有 demo 重复项)

## [2.34.0] - 2026-08-09

### Added(多焦点聚焦 multi-focus + 输入框 chip + chip 点击回调 · focus-multi)
- **多焦点聚焦**:focus 从单焦点(Focus 单个)升级为多焦点(Focus[] 数组),可同时聚焦多个组件精修。场景:批量改多个相关组件(导航栏 + 页脚)。
- **API(兼容旧 + 新增)**:`setFocus(focus)` 替换全部(兼容旧覆盖语义)/ `addFocus(focus)` 累积(去重 by path)/ `removeFocus(path)` 移除单个 / `clearFocus()` 清空 / `getFocus()` 返首个(兼容)/ `getFocuses()` 全量数组。`setFocus`/`addFocus` 4 道校验复用(抽 `validateFocusInput`);旧代码零改(getFocus/setFocus 兼容)。
- **focus.ts 中间件**:`focuses: Focus[]` + wrapToolCall 越界判定改 `!focuses.some(isUnderFocus)`(写**不在任一**焦点子树才 PATH_DENIED,错误文案列所有焦点)+ augmentPrompt 多目标段(列所有 path + 各 `getSchemaAtPath` 子树 schema)。
- **agent 工具**(advanced):新增 `add_focus`(累积)/`remove_focus`(移除单个),保留 `set_focus`/`clear_focus`;usageHints 引导多焦点用法。
- **ChatDialog 输入框多 chip**:聚焦时输入框内顶部显示多 chip(🎯 path ✕,横向 flex wrap);chip 本体点击 → `onEvent('focus_chip_click',{path,label})`(集成方可滚动/高亮组件);✕ 移除单个焦点。原顶部 FocusBar 默认移至 chip(`sections.focus=true` 可恢复顶部独立条)。chatContext 改 `focuses: ComputedRef<Focus[]>` + addFocus/removeFocus/focusChipClick。
- **持久化迁移**:`SessionSnapshot.focus` 存 `Focus[]` 数组(focus kind 复用,非新字段 —— storage 按 SnapshotKind 白名单存读);旧版本存单个 Focus,`applySnapshot` 读时归一化 `[focus]`;恢复逐 path 校验(`getSchemaAtPath` 失效剔除单个,非整体丢弃)。
- **子 agent 继承多焦点**:`SubagentOptions.getFocuses`/`initialFocuses`(数组);主 agent 聚焦 → 子 agent 继承全部焦点。
- **类型 + 事件**:`ChatSdk`/`AgentCore` 加 getFocuses/addFocus/removeFocus;`AgentInfo.focuses`;`SdkEvent` 加 `focus_chip_click`;`core.emit` 暴露(事件触发出口)。
- **user message 标注焦点历史**:聚焦时 `send` 附当前 focuses 快照到 user message(`AgentMessage.focuses`)→ MessageRow 🎯 chip 标注「该消息在什么焦点下发」(背景组件限制可追溯,持久化随 messages)。
- 测试:selftest 1575→1590(sec-54 多前缀越界 + addFocus/removeFocus/getFocuses;sec-57 focus 数组往返 + 旧快照归一化;sec-66 send 附 focuses)/ e2e 388→400(focus.mjs 多焦点 API + 持久化)/ browser +2(complex-demo 多 chip + ✕ 移除单个;user message chip 标注历史)。

### Added(两步拾取交互 + 精确值保护合并 demo · demo-pick-overlay)
- **两步拾取(focus-context demo 升级)**:page-demo / complex-demo 点组件由「单步直接聚焦」改为两步 —— ① 点组件本体 → 选中(浮层边框 + 「💬 加入聊天」按钮);② 点按钮才 `setFocus` 聚焦(焦点条 chip 接管,选中态清边框消失)。降低误触(点组件不立即锁定范围),「先选再确认」更直觉。
- **共享 `_shared/PickOverlay.vue` 浮层**:`position:fixed` + `Teleport(body)` + `getBoundingClientRect` 定位选中组件,边框本体 `pointer-events:none`(穿透回组件可切换选中),仅按钮 `pointer-events:auto`。**不侵入组件树** —— 适配 complex-demo 递归 `CompRenderer`(容器嵌套 children,包 wrapper 会破坏布局)与 page-demo 扁平 v-if 分发;监听 scroll(capture)/resize 跟随。
- **精确值保护合并 complex-demo**(原 precise-value-demo 删除,能力并入):navbar(components.0)增 `trackId` 字段,`data.resources:[{path:'components.0.props.trackId',mode:'freeze'}]` 保护 —— read 返 `⟦frozen⟧` 占位符(真实值不进 AI 消息流),write 改 trackId 被 `FROZEN_FIELD` 拒,改普通字段放行。演示「聚焦组件 → read 占位 → 改不动」闭环(与两步拾取协同)。
- **修复 clearChat helper 残留遮罩**:`clearChat` 打开「更多」下拉(全屏 `more-overlay` z-index:15),若「清空对话」按钮不存在(无消息时下拉无该项,catch 吞掉)下拉未关 → 遮罩残留拦截后续 pane-left 交互(focus 测试点组件暴露;chat-dialog z-index 更高故 pane-right 操作不受影响,长期潜伏)。修复:末尾兜底点 `.more-overlay` 触发其 `@click` 关闭。
- browser e2e 36→38(page-demo +两步拾取 / complex-demo +精确值保护 freeze,原 focus 两测试改两步);selftest/e2e 不变(纯 demo + helper 改动)。

### Added(ChatDialog 拆分 · chatdialog-component-split)
- **ChatDialog 拆分为可拼装/可替换的原子组件库**:982 行单文件 ChatDialog → 组合容器(`provide(ctx)` + 9 区块 slot/sections 双机制)+ 14 个原子组件(`ChatHeader`/`ChatInput`/`MessageList`/`MessageRow` + `message/` 下 Time/Actions/Reasoning/Steps/Bubble + `QueuedBar`/`ApprovalBar`/`ConflictBar`/`FocusBar`)+ `chatContext` 枢纽(`createChatContext`/`chatContextKey`/`useChatContext`,跨组件共享状态经 provide/inject,避免容器下钻 ~100 条 props)。
- **sections 区块显隐**(`dialog.sections`):9 区块(header/focus/body/queued/approval/conflict/footer/debug/skill),键=`false` 关闭整块(含 slot),默认全开(向后兼容)。
- **9 具名 slot**(scoped `{ chat }`):替换内置原子为自定义实现(slot vnode 在 provider 子树自动 inject 同一 ctx)。
- **默认路径行为零变化**(全开 + 无 slot = 拆分前行为);scoped CSS 类名归属=DOM 归属,跨边界 `:deep()`(如 `.message-row.assistant:hover :deep(.msg-actions)`)。
- 新增导出 8 原子组件 + chatContext 三件套 + `ChatDialogSections` 类型;`ChatDialogProps` 补全(6→34 字段);browser e2e 33→36(新增 `custom-dialog-demo.spec.ts`:sections 关 footer/queued 验证)。
- **修复 pre-existing**:`playwright.config` 的 `gpt-3.5-turbo`(16K 上下文) 与 `MIN_CONTEXT_WINDOW`(200K,2.30.0 引入)冲突致 `createChatSdk` 启动 throw → `glm-5.2`(1M,mock 拦截不连真 LLM,model 名仅用于 modelCaps 解析)。

## [2.33.0] - 2026-08-09

### Added(压缩决策 · agent-driven-compression)
- **压缩 agent 自主决策压缩策略**(opt-in `capabilities.agentCompression`,requires summarization):summarization 中间件每轮先 `shouldTriggerCompression` gate(纯函数 token/轮数两模式,避免「开启后每条消息都 decide 烧 LLM」)→ `summaryLlm.decide` 两段式工具循环(bind `inspect_context` → 模型查上下文构成 → 输出决策 JSON)→ `compress(messages, decision)`;decide 失败 / 超时 / 模型不支持工具 → null 降级静态压缩(零阻塞,不丢压缩能力)。
- **CompressDecision 双字段**:`keepRounds`(轮数模式 0-50)/ `windowRatio`(token 模式 0-1),`refine` 强制至少一个;决策覆盖切分 + 摘要 mode(index/llm)+ 召回 recallTopK(0 不召回)+ preserve(配置 ∪ preserveTools,扩展不减)。token 模式按 windowRatio 走累加循环保 token 封顶(不直接按 keepRounds 切,防大 JSON 压缩后仍超窗口),轮数模式补 older 空早退 + keepRounds≥1 下界(防贪省恒全压)。
- **独立 `decisionTimeoutMs`(默认 6s)/ `decisionMaxTokens`(默认 2048)**:不复用 summaryTimeoutMs 15s(两段叠加阻塞首响应)/ summaryLlm 1024(截断 JSON safeParse 失败无谓降级)。
- **decision 自动流到可观测**:`CompressionStats.decision` → `inspect().lastCompression` + `contextSnapshot.compression`(无需额外接线);DebugDrawer「📊 上下文」tab + 「🗜️ 上轮压缩」段显示「🤖 agent 决策」注记。
- 新增导出 `CompressDecisionSchema` / `CompressDecision` / `shouldTriggerCompression`;selftest 1507→1550(sec-62~65)/ e2e 376→387(agent-compression.mjs)。

## [2.32.1] - 2026-08-09

### Fixed(placeholder-protected-read-write review 修复)
- **H1 祖先 set 静默丢失受保护字段**:`normalizeAndCheck` 对 `valAt===undefined` 改为回填当前值(原 skip 在祖先 set 不含受保护子字段时静默丢失 hash/token,违背"精确值保护"承诺)
- **H2 resource_update 不刷新乐观锁 hash**:`rupdate` 改 bind 后补 `lastReadHash = hashValue(bindRef)`(与其他写路径一致,防紧接 write `VERSION_CONFLICT` 让 LLM 困惑)
- **M3 D1 复活已删字段**:`expandHandle` 在 `bindCur===undefined` 时返 `RESOURCE_NOT_FOUND`(原展开池旧值复活已删字段,§7c B4)
- selftest 1480→1484(sec-58 H1/M3 + sec-60 H2)

## [2.32.0] - 2026-08-09

### placeholder-protected-read-write(占位符替换读写·精确值保护)
- `data.resources: [{path, mode}]` 声明受保护字段:freeze(只读,精确值不入 LLM 消息流)+ verbatim(原样保留,防压缩丢字/防幻觉改错);**bind 恒持原始值,占位符只在读写边界替换**(hash/快照/乐观锁全零干扰)
- read 受保护路径返占位符 `⟦frozen:path⟧`/`⟦res:handle⟧`;写侧强制层 = 独立纯函数 `enforceSet`/`enforcePatches`,经可选参 `protectedCtx` 注入 `commitSetToBind`/`applyPatchesToBind`/eval 整体替换**三处**,先于 schema 校验(含 C1 回显识别 / A2 定点展开 / D1 池值自愈 / C3 remove 拒 / C2 `patches[i]` 定位)
- 资源工具 `resource_get`/`update`/`list`/`delete`(advanced,opt-in:配 `data.resources` + vfs)+ SDK API `createResource`/`getResource`/`updateResource`/`deleteResource`/`listResources`/`releaseResources`
- vfs 第四池 `resources`(4MB,per-resource 文件,handle 路径派生短哈希)+ 跨压缩 pin(`resourcesPin` 中间件)+ skill `precise-value-protection`(`skills/` 分发)+ usageHints 资源段
- 新增导出 `ResourceProtectSpec` 类型;全增量,默认零行为变化(未配 `data.resources` → no-op;freeze 无 vfs 也工作,verbatim 降级);selftest 1358→1480(sec-58/59/60/61)/ e2e 362→376(resources.mjs)。示例 `examples/precise-value-demo`。

## [2.31.0] - 2026-08-08

### Added(focus 自动切换 · focus-auto-switch)
- **usageHints focus 引导(模块1)**:advanced + capabilities.focus 开 → 注入「上下文聚焦」段(局部任务→`set_focus` / 全局任务→不聚焦 / 完成→`clear_focus` / 先 read 定位 path),门控 `rc.focus && !simple`(同 set_focus 工具暴露)。`HintCapabilityFlags` 补 `focus?`。
- **focus 持久化(模块2)**:`SnapshotKind` 加 `'focus'`(照抄 mission,泛 kind 迭代自动覆盖);createChatSdk `applySnapshot`(经 `getSchemaAtPath` 校验 path 失效丢弃=决策A,与 `sdk.setFocus` 单一真相)/ `persistRuntime`(`f ?? null` 覆盖清除)/ `switchSession` 切走前补存 三处;`SessionSnapshot.focus` 允许 `null`(清除标记,防 clearFocus 后旧值残留)。
- **子 agent 继承(模块3)**:主 agent 聚焦 → `spawn_agent`/`spawn_agents`/预声明 `use_<id>` 子 agent 默认继承同一焦点(`createFocusMiddleware` `initialFocus` 构造参数,三层收敛);主未聚焦 → 子 agent 无 focus 中间件(零回归);`SubagentOptions.getFocus`/`getSchema` 透传主 `liveData` schema。
- selftest 1342→1358(sec-56 usageHints 9 + sec-57 storage 4 + sec-54 initialFocus 3)/ e2e 353→362(focus 持久化 6 + subagents 装配 3);spawn 端到端(子 systemPrompt 含焦点)manual/deferred。

## [2.30.0] - 2026-08-08

### Added(上下文健壮性 · harden-context-resilience)
- **硬地板:contextWindow ≥200K**:启动 / `setLlm` / 子 agent 解析后,`contextWindow < 200000` → throw(排除 128K 档主流如老款 `deepseek`/`gpt-4o`/`glm-4.5`/`qwen-max`,SDK 默认 `deepseek-v4`/`glm-5.2`/`claude-*`/`kimi`/`qwen-1m`)。集成方换 ≥200K 模型或 `llm:{contextWindow}` 声明覆盖。`MIN_CONTEXT_WINDOW` 导出可调。
- **三道闸阈值跟随实时窗口**:offload / trim / compress 阈值此前创建时按 `contextWindow` 固化,`setLlm` 切模型后陈旧 → 切小窗口 + 恢复大历史可能裸失败。修复:`createAgent.setModelCaps` + summarization/contextInspector 中间件 `setContextWindow` controller,`setLlm` 集中回灌新窗口;子 agent 也从实例提取 model 名正确解析(兼修 gpt-3.5→16K silent bug)。
- **P2 反应性重试(超限不裸失败)**:`coreModelCall` 双 catch(启动同步抛 + 迭代首 chunk 抛)识别 `isContextLengthError`(复用 langchain `ContextOverflowError` + 兜底正则,与 `isRetryable` 正交)→ 激进 trim(30% 窗口)→ 单次重试(`_ctxRetry` 防死循环)→ 仍超抛。迭代中已 emit 不重试(未 emit 守卫 `aggregated===null && content===''`)。
- **vfs 引用保护 + OOM 兜底**:`VfsStore.setProtectedRefs(extractVfsRefs(msgs))` stream 入口注入;LRU 删前跳过被引用的 `large_results`(防 `vfs_read` 404);池 > `poolMax × 1.5` 强制 LRU 删到 watermark(防全池被保护不收敛)。
- **系统段预算**:system 段超 `25% × contextWindow` → 非 pin 段从大到小 drop(保 base/mission/workingMemory,dataHint 巨型 schema 常最大先丢);systemPrompt 本身超预算 → stream 早退 `SYSTEM_PROMPT_OVER_BUDGET`(不进 ReAct)。
- **预防口径**:H1 `trimContextIfNeeded` 改 token 口径 + 单轮 ≤60% 窗口复查;H2 `compress` 组装后算 totalTokens 仍超 warn。
- 新增导出 `isContextLengthError` / `MIN_CONTEXT_WINDOW`;selftest 1295→1342 / e2e 349→353。

## [2.29.0] - 2026-08-08

### Added(上下文聚焦 · focus-context)
- **上下文聚焦 Focus(指定组件精修)**:多组件页面精修其中一个时,聚焦后 agent 的**目标 / 视野 / 范围三层收敛**到单组件子树,避免改到别处。会话级焦点 `{ path, label? }`(path=jsonPath 锚点,如 `components.3`),opt-in(需 `setFocus` 才生效,默认不聚焦行为与现状完全一致,向后兼容)。
  - **三层收敛**:① 目标提示(augmentPrompt 注入「## 当前精修目标」);② 视野收敛(注入 `getSchemaAtPath(schema, path)` 子树 schema 描述,LLM 每轮只看该组件结构);③ 范围收紧 **strict**(wrapToolCall 对写工具拦截,`jsonPath` 不以 `focus.path` 为前缀 → `PATH_DENIED` 越界回灌自纠;读工具不限)。**pin 段天然跨压缩**(focus 在中间件 state 不在 messages,同 mission/workingMemory)。
  - **三种触发**:① `sdk.setFocus`/`getFocus`/`clearFocus` API(集成方/宿主点击拾取);② agent 工具 `set_focus`/`clear_focus`(`toolMode:'advanced'` 暴露;simple/minimal 经 UI/宿主 API);③ ChatDialog 焦点条 chip(✕ 退出 · ▾ 编辑路径切换)。
  - `setFocus` 校验 path **类型合法**(`getSchemaAtPath` 命中;类型校验非数据存在性 —— 数组索引 `components.5` 类型合法可聚焦;前缀边界 `components.10` 不误匹配 `components.1`);`capabilities.focus` 默认开。新建 `harness/focus.ts`(`createFocusMiddleware`,mission 闭包工厂 + permissions wrapToolCall 拦截模式);`Focus` 类型导出。
  - 示例:`examples/complex-demo` 组件绑 `data-path` 点击拾取 → 聚焦精修(越界被拒)。selftest 1270→1295(sec-54 focus 三层 + 越界 + 批量 patches + 控制器);e2e 322→349(focus:setFocus/getFocus/clearFocus + inspect + 工具 + capabilities);browser 31→33(complex-demo 点组件→chip→✕ + 聚焦越界 PATH_DENIED 自纠放行)。

## [2.28.0] - 2026-08-08

### Added(Anthropic 开箱 · anthropic-provider)
- **Anthropic provider 开箱支持**:`LLMConfig.provider:'anthropic'` + 动态 import `@langchain/anthropic`,走 Claude 原生协议(覆盖 Claude 用户场景,与 DeepSeek/OpenAI 协议并列)。缺省 provider → openai(向后兼容,现有 DeepSeek/OpenAI 集成零改动)。新建 `src/core/llm/constructLlm.ts`:`constructLlmFromConfig`(async,provider 分支收口 6 处 `new ChatOpenAI`)+ `constructOpenLlmSync`(同步 openai 分支,供 `setLlm` 同步契约)。
- **async 下沉零契约破坏**:主 LLM 走 `initDone`(async IIFE)构造实例注入 createAgent(绕过同步兜底);`summaryLlm`/`titleLlm` lazy 构造(首次 invoke 时 await,保 `resolveLlm` 同步签名,Anthropic 动态 import 不阻塞 mount/send);`setLlm` 同步契约不变 —— 切 Anthropic 需传 `BaseChatModel` 实例(`isChatModel` 分支天然支持任意 provider),传 `LLMConfig` + `provider:'anthropic'` throw 清晰提示。
- **streaming 三处 provider 兼容**(OpenAI/DeepSeek 零回归):① content parts 数组(Anthropic 流式是 `{type:'text',text}` parts 数组,OpenAI/DeepSeek 是 string;`extractTextDelta` helper 兼容,否则 Anthropic 流式文本不显示);② reasoning(DeepSeek `additional_kwargs.reasoning_content` vs Anthropic content parts 内 `{type:'thinking',thinking}`);③ trace span usage(`additional_kwargs.usage` vs `response_metadata.usage` fallback;主链 usage 累加已多 provider fallback)。
- **provider 抽离收口**:`@langchain/anthropic` optional peerDep(不用不强求装,动态 import 仅 provider:'anthropic' 加载);`@langchain/core` 升 1.2.4→1.2.5(anthropic 1.5.4 依赖 `utils/gateway` 子路径);vite external `/^@langchain\//` + UMD globals 覆盖 anthropic;**IIFE(CDN 全量)external anthropic**(不打包进 CDN 包,默认 OpenAI/DeepSeek;要用 Anthropic 走 ESM/UMD npm —— 浏览器 CDN 无 importmap 无法解析 bare specifier)。`createProxyLlm` 保持 OpenAI-only(标注:proxy 模式注入 Bearer 是 OpenAI 协议;Anthropic 走主 LLM 直连)。
- **streaming 兼容抽纯函数 + demo**:`extractTextDelta`/`extractReasoningDelta`/`extractUsage` 抽到 `src/core/utils/contentParts.ts`(导出,纯函数可单测;createAgent 流式循环改用,行为不变);新增 `examples/anthropic-demo/`(`provider:'anthropic'` + Claude 流式参考)。
- 新增导出 `constructLlmFromConfig`/`constructOpenLlmSync`/`ConstructOpts` + `extractTextDelta`/`extractReasoningDelta`/`extractUsage`;selftest 1246→1270(sec-53 constructLlm provider 分支 + contentParts 纯函数 string/parts/thinking/usage 全覆盖);e2e 316→322(llm-provider:anthropic mount + setLlm throw + openai 路径)。

### Fixed
- **tsc 类型债清理**(context-persist/arch-review 改动遗留):mission mw `reset` 注解 / subagent `allTools` getter 闭包 narrow / `ChatSdk.inspectContext` interface / llmResolver title invoke `extractText(m)`→`m.content`。src `npx tsc` 0 error(发布门禁)。

## [2.27.0] - 2026-08-08

### Added(长对话上下文韧性 P1 · recall-and-trim-llm)
- **跨轮召回纳入工具结果**:关键词召回(`recallRounds`)此前只匹配对话文本(user/assistant content),不含工具结果 → 问「之前 read 出来的 X 是什么」搜不到,只能重新 read(浪费 token)。修复:召回匹配串纳入 `steps.result`(经 `plainSummary` 截断 120 字防大 result 撑爆),跨轮工具结果可被关键词命中。
- **trim 异步 LLM 增强**:内存裁剪(`trimMemoryMessagesImpl`)用固定模板摘要(问 60/答 80 字),永远不走 LLM —— 即便 `enableLLMSummary:true`(默认 auto 即开),落盘/恢复的早期历史仍是模板,与 summarization 的 LLM 摘要质量不一致。修复:trim 触发后**同步模板占位**(契约不变、优雅降级),异步用 LLM 重摘要 older 轮次替换(照 `titleLlmInvoke` fire-and-forget 模式);`messages.indexOf(summaryMsg)` 竞态守卫(未被动过才替换),LLM 失败/无 invoke 保留模板。配置门尊重 `enableLLMSummary`(conservative 预设不触发)。`trimMemoryMessagesImpl` 返回值增 `older`/`prevSeg`(纯函数逻辑不动);新增纯函数 `composeTrimSummary`。selftest 1231→1239(sec-32 召回含 steps + trim 返回 older + composeTrimSummary)。

### Added(上下文持久化韧性 · context-persist-resilience)
- **mission/workingMemory 跨刷新持久化**:`SessionSnapshot` 增 `mission?`/`workingMemory?` 字段,`persistRuntime` 存 / `applySnapshot` 恢复(刷新后长任务目标 + 工作记忆 path/hash 备忘不丢);`switchSession` 切走前补 persist(防 setMission/积累后未发消息即切会话丢);workingMemory 中间件补 `restore(wm)`。向后兼容(可选字段 + 能力门 + 非空守卫)。
- **trim 收口:`context_trimmed` 归档事件 + vfs 孤儿 GC**:trim 删 older 轮前发 `context_trimmed` 事件(dropped 完整原文 + `vfsResults` 被删轮引用的 vfs 大结果原文 + summary,集成方可归档,不改默认 trim);删后可达性 GC(`extractVfsRefs` 扫剩余 messages 提 `large_results/` 引用 → `gcVfsLargeResults` 删不可达)。GC 触发:trim 后 / clear(resetSession `vfsStore.clear`)/ 加载(applySnapshot 兜底)。解 vfs 孤儿堆积 + 缓解引用悬空(被引用留,LRU 硬上限仍淘汰)。新增纯函数 `extractVfsRefs`/`gcVfsLargeResults`(`utils/vfsGc.ts`)。**澄清**:vfs 在 storage 开时已持久化(原 context-history-resilience B3「刷新即丢」断言错误,已修正)。
- selftest 1239→1246(sec-32 vfsGc + sec-38 restore);e2e 312→316(storage mission 持久化往返)。

## [2.26.0] - 2026-08-08

### Added(skill 脚本执行 · skill-external-scripts)
- **动态 skill:`exec` 加载时执行 + `tools` 附带工具**。`SkillSpec` 新增两可选字段,把 skill 从「说明书」升级为「说明书 + 执行器」(全增量,现有 skill 零变):
  - **`exec` 钩子**:`{ code?, url?, context?, inject? }`,`load_skill` 时执行脚本 → 结果 append/prepend 注入全文(一次性上下文初始化,拿实时数据快照)。`context:'sandbox'`(默认,Worker 沙箱三层防护:静态扫描 + `lockSandboxGlobal` 锁网络层 + 超时);`context:'host'` 需 `capabilities.skillHostScript:true`(宿主全权 `AsyncFunction`,不经静态扫描,**仅集成方内联 code**、非 LLM/非远程;`url`+`host` 禁止)。
  - **`tools` 工厂**:`SkillToolFactory[]`,`load_skill` 后注入 agent 工具池(经 `dedupeTools`,建议命名空间 `<skill>__<tool>`);source 标 `skill:<name>`;`setSkills`/`invalidateSkillCache` 经 `core.unloadSkillTools` 卸载。
  - **exec 失败不缓存**(标注 + 下次 load 重试,动态 skill 韧性);**exec 大结果走 createAgent 通用 offload**(>6000 转 vfs),「一次读全」仅限静态文本部分。
  - **沙箱引擎泛化**:抽出 `src/core/tools/sandbox.ts`(`createSandboxRunner` 柯里化),eval_script 与 skill exec 共用单一真相源;`dataSlotQuery.ts` 的 `runSandboxedScript`/`lockSandboxGlobal`/`EvalResult` re-export 保外部 import 零破坏。新增导出 `createSandboxRunner`/`SandboxResult`/`runHostScript`;新 capability `skillHostScript`(opt-in 默认关,requires `skills`)。
  - selftest 1208→1231(sec-21 createSandboxRunner + sec-05 exec/buildSkillContent/tools 注入 + sec-19 skillHostScript);e2e 309→312(custom-injection exec/tools 装配 + skillHostScript mount)。

## [2.25.0] - 2026-08-08

### Changed(工具面精简 · simplify-toolset)
- **移除冗余工具 + 补 `vfs_rm`**:① `snapshot_data` / `list_data_snapshots` 移除(被 `history_data({ list: true })` 吸收——列出快照时间线元信息,等价原 list_data_snapshots;手动检查点改靠 set/edit/delete 自动快照);② `get_data` 标 `@deprecated`(保留兼容,集成方改用 `read`——等价且支持 fields/depth/分页);③ 新增 `vfs_rm({ path })` 补 vfs「只进不出」删除闭环(`VFS_TOOL_NAMES` +1,含 drafts 草稿清理);④ usageHints 补「read 按 schema 投影隐藏未声明字段」+ 「get_dom 改完数据回看渲染」(domInspect 开时)提示。`toolMode` advanced 数据工具 16→14。selftest 1204→1208(sec-03 vfs_rm + sec-02 history list);e2e 311→309(inspect.mjs expectedDataTools 16→14)。

## [2.24.1] - 2026-08-07

### Fixed(安全 · harden-eval-sandbox)
- **eval_script 沙箱逃逸堵死**:`runSandboxedScript` 的 Worker 沙箱此前以**赋值覆盖**禁用网络/存储 API(`self.fetch=...`),可被 `delete self.fetch` 露出原生 fetch 外泄 transform 数据(逃逸链:原型链 `(function(){}).constructor` 取 Function → 跑任意码 → `delete self.fetch` 恢复原生 fetch → 外泄)。修复:禁用逻辑抽纯函数 `lockSandboxGlobal`(导出),用 `Object.defineProperty(configurable:false, writable:false)` 锁死 fetch/XHR/WebSocket/importScripts/indexedDB/caches/Worker/SharedWorker/EventSource/BroadcastChannel/sendBeacon —— delete/重新赋值均失败,原生 API 永久不可达;WORKER_PREAMBLE 经 `lockSandboxGlobal.toString()` 注入 Worker(单一真相源)。selftest sec-21 加纯函数锁验证;selftest 1196→1200。

### Fixed(主流程审查 main-flow-audit)
- **P0-1 压缩摘要送达 LLM**:`replaceSystem` 此前 filter 掉**所有** system 消息 → 压缩/trim 摘要(经 toLC 转 SystemMessage 落 index≥1)首轮即被剥,**从未送达 LLM**,长对话跨轮记忆静默失效。修复:只替换首部主 system,保留其余 SystemMessage。
- **P0-2 Markdown XSS 防护**:AI 回复经 `v-html` 渲染全程无 sanitize(marked v18 默认不净化)→ `<img onerror>`/`<svg onload>` 即在宿主 origin 执行(fetchDoc 抓取的恶意文档经 LLM 回显可触发)。新增打包进库依赖 `dompurify`,`useMarkdown` 输出经 `sanitizeMarkdownHtml` 净化(剥事件属性/`javascript:` 协议,保留 `data-*` 供代码块交互);`CodePreview` 新窗口改 sandbox iframe + noopener(防同源执行 AI HTML)。
- **P0-3 MCP 工具注入**:initDone 内 `const mcpTools` 遮蔽外层数组 → 工具 push 进局部数组、`rebuildExtraTools` 读外层空数组 → **所有 MCP 集成工具对 agent 彻底失效**(server 显示已连 + 日志谎报注入)。修复:删遮蔽声明,直接用外层数组。
- **P0-4 清空对话 ReferenceError**:`onClear` 闭包(createChatSdk 作用域)赋值 buildCore 局部 `lastTitle`/`titleLLMDone` → 运行期 ReferenceError(storage 开 + 点清空对话必现)。修复:重置逻辑收编进 `core.resetSession()`(共享状态变更一律 AgentCore 方法)。
- **P1-a 中文 IME 回车误发送**:handleKeydown 缺 `isComposing` 防护,中文输入法回车确认候选词即发送。前置 `if (e.isComposing || e.keyCode === 229) return`。
- **P1-b 会话切换不停 ghost 流**:新建/切换会话不停止进行中生成 → ghost 流续烧 token + loading/排队/待确认跨会话残留。useChat 增 `reset()`,ChatDialog `handleNewSession`/`handleOpenSession` 先 reset 再委派。
- **P1-c UI 流式绕过 core.stream**:默认 UI 流式 `fetchStream` 直给裸 `core.agent.stream`,绕过 `core.stream` 包装 → 流式事件不到 onEvent/hook + abort 不收口挂起冲突。改走 `core.stream`(drop-in)。
- **P1-d 流式重试重复文本**:`coreModelCall` 此前 `withRetry` 包整个 run,流式迭代中途失败重试 → 从头重发已 emit 的文本 → UI 显示两遍。修复:仅 stream 启动(连接建立)走重试,迭代中失败(已吐字)不重试直接抛。
- selftest 1189→1201(sec-23 P0-1 摘要送达 + P1-d 迭代不重试白盒 + sec-51 escapeHtmlAttr + sec-21 lockSandboxGlobal);e2e 308→311(inspect.mjs P0-3 MCP 工具真注入,in-process server fixture);browser 28 全绿;`test:size` IIFE 阈值 1.7MB→1.9MB(dompurify +95KB)。
- ⏸ 推后:css 产物名/exports 不一致(pre-existing,集成方 `import 'page-agent-sdk/style.css'` 会 404,另立)。(P1-d 流式重试去重 + eval_script 沙箱逃逸已实施,见上)

### Fixed
- **css 产物名/exports 不一致修复**(pre-existing,2.24.1 起):build 经 `assetFileNames` 生成 `dist/style.css`,匹配 `package.json` exports `"./style.css"` + size-check。集成方 `import 'page-agent-sdk/style.css'` 不再 404。

## [2.24.0] - 2026-08-07

### Added
- **会话历史管理(`session-history-management`,ChatGPT 式新建/切换/历史列表)**:让集成方能实现「一个聊天框 + 顶部新建 + 历史列表切换」。对外暴露此前只在 store 层的会话能力:
  - `sdk.listSessions(): Promise<SessionMeta[]>` —— 列出当前 agent 的所有历史会话(含 sessionId/title/createdAt/lastAccessed/bytes);storage 未开启 → `[]` 优雅降级。
  - `sdk.deleteSession(id): Promise<void>` —— 删除历史会话;**不可删除当前会话**(删当前需先 `switchSession` 切走);storage 未开启 → no-op + warn。
  - `sdk.sessionId`(getter)—— 当前会话 id,`switchSession`/`onClear` 后实时反映(供历史列表高亮当前项);`inspect().sessionId` 同步暴露。
  - `onClear`(新建会话)后发 `session_restored` 事件(携带新 sessionId + rounds:0),与 `switchSession` 对齐 → 集成方 hook 可感知「用户点了清空新建」,历史列表实时同步。
- **sdk.sessions 响应式状态下沉(session-history Phase 6)**:会话历史列表自动同步,集成方零样板。新增 `sdk.sessions: Ref<SessionMeta[]>`(响应式)—— switchSession/deleteSession/onClear/mount 恢复后 SDK 内部自动 refresh(`refreshSessions`),集成方直接消费无需手动 listSessions/refresh/hook。`AgentCore.sessions/refreshSessions`;触发点:switchSession/resolveAndLoad(载入)/deleteSession/onClear 末尾。
- **session-history-demo 重构(组件化 + Figma 设计)**:单文件 App.vue → 直接消费 sdk.sessions(去掉手动 useSessionHistory composable,状态下沉 SDK)+ 组件拆分(`ChatTopBar` 顶部栏 + `SessionHistoryPanel` 右侧弹出历史层)+ 深色紫主题(覆盖 ChatDialog `--cs-*` CSS 变量,无 theme prop)。架构优先:状态在 SDK,UI 组件化,App.vue 只组装。
- selftest 1151 不变;e2e 296→303(storage Phase 6 sdk.sessions 响应式 + 边界:切回旧会话不重复/无重复 sid/deleteSession 自动 refresh);browser 28 不变(session-history-demo 3 项端到端组件化重构后仍绿)。

### Added
- **所有 demo 统一 Figma 深色紫主题**:新建 `examples/_shared/theme.css`(`--ark-*` 深色紫变量 + ChatDialog `--cs-*` 覆盖 + reset);16 demo main.ts import + App.vue 外层深色(模式 A 双栏 `.pane` / B 单栏 `.page` / C 全屏);EditableBanner `.editable-area` 改深。
- **会话标题自动生成(session-history)**:历史列表显示**首条 user 消息内容**(截取 30 字),替代「会话 xxxxxx」。`store.updateTitle`(新)+ persistRuntime `deriveTitle`(纯函数,导出 + selftest sec-49)+ 变化才写 + switchSession/onClear 重置 lastTitle。
- **ChatDialog 输入框 Figma**:`send-btn` 圆形(border-radius:50%)+ 「Enter 发送 · Shift+Enter 换行」提示 + footer/input 变量化(`var(--cs-bg)`/border var,深色主题不发白)。
- selftest 1151→1159(sec-49 deriveTitle 8 断言);e2e 303 不变;browser 28 全绿(所有 demo 深色 + 输入框 + title 回归)。

- 工具步骤耗时展示(`durationMs`,消息 action 计时)+ 修 browser 测试 autoTitle 干扰(测试隔离)
### Added
- **上下文检查(context-inspector)**:长对话/大 JSON 场景诊断刚需 —— 看上下文什么占了最多、离压缩阈值多远。新增:
  - `analyzeContext(messages, opts)` 纯函数(导出):对「实际发给 LLM 的消息」分类切分 + token 估算,返回 `ContextSnapshot`(totalTokens/occupancy/categories/compression)。system 段按 augmentPrompt 标记前缀**定位**切分(## 可操作数据 / ## 能力使用提示 / ## 当前主线目标 / ## 工作记忆 / 摘要/召回段);工具结果计 ToolMessage.content + AIMessage.tool_calls.args。
  - `createContextInspectorMiddleware` 中间件(导出):`wrapModelCall` 每轮快照(采集 replaceSystem + trim 后的最终消息),经闭包持有(不进 state —— wrapModelCall 无 state update 机制)。
  - `sdk.inspectContext()` / `inspect().context`:读最近快照;`capabilities.contextInspector` 默认开(opt-out,纯计算零 LLM 成本),`false` → undefined。
  - DebugDrawer「📊 上下文」tab:占用进度条(色阶绿/黄/红 + 阈值线)+ 分类横向 bar + 压缩信息。
  - ⏸ 推后:ChatDialog 常驻进度条(每轮刷新需改 useChat 事件流,DebugDrawer tab + inspectContext API 已覆盖诊断需求)。
- selftest 1165→1189(sec-50 analyzeContext 分类/标记定位/args/占比 + 中间件 wrapModelCall 快照);e2e 303→308(inspect.mjs inspectContext + inspect().context + capability 关)。

### Changed
- **并发 send/switchSession/batch 串行化(arch-review P1-2)**:同一 sdk 实例的并发 `send`/`switchSession`/`batch` 此前无互斥 → A 生成中切 B 会共享闭包 state 竞态(state 串写 / data 并发改)。现在排队执行(一个完整跑完下一个才开始),即「一个会话操作 data 时,其他会话等它结束」—— 单实例同一时刻只服务一个会话。
  - 提取纯函数 `createSerialRunner`(`utils/serialRunner.ts`,可单测防并发测试 flaky):Promise 链互斥,前一个无论成败都继续(不卡死后续),各 fn 结果/错误透传。
  - `send`/`batch`/`switchSession` 经 `runSerial` 包装;`stream` 暂不串行(流式生命周期复杂,UI 走 useChat 已排队,后续评估)。
  - 新增导出 `createSerialRunner`。
- selftest 1145→1151(新建 sec-48 createSerialRunner 白盒:串行顺序/前一个 reject 不卡后续/并发按调用序/reject 透传);e2e 296 不变(串行化透明,无回归)。

### Fixed
- **arch-review P1-1 wrap-up 走中间件栈**:工具轮耗尽后的收口综合(wrap-up)此前直接调 `coreModelCall` 绕过中间件栈 → 收口轮 token 不计入 `sdk.usage`(sdk-events afterModel 漏计)+ automation `budget` 预算闸 + 用户自定义 `wrapModelCall`(埋点/缓存)在收口轮失效。修复:wrap-up 改走 `composeModelCall`(裸 llm 不绑工具防收口再触发工具调用)+ `runAfterModel`,与主循环 modelHandler 对齐(budget/用户中间件参与,收口 token 计入 usage)。不跑 beforeModel(收口轮不需 todos 推进,避免重渲染 system 覆盖收口提示)。budget 超限时 wrap-up 照常 aborted 中断(automation 语义,checkpoint 回退兜底)。
- **arch-review P1-4 subagent 工具池 getter 化**:`createSubagentMiddleware`/`createSubagentsMiddleware` 此前捕获 `allTools` 装配期快照 → 运行时 `setTools`/`addTool`/MCP 动态加的工具对子 agent **不可见**。修复:`allTools` 接受 getter,createChatSdk 装配传 `() => allTools`,子 agent spawn 时取主 agent 最新工具集(与 dataOps `liveData()` / verify `root` getter 模式一致)。⏸ verify readonlyTools getter 化推后(verify+adversarial 双 opt-in,收益边缘)。
- selftest 1161→1165(sec-23 加 P1-1 收口经中间件计数 + P1-4 subagent getter spy 白盒);e2e 303 不变。

### Fixed
- **checkpoint 栈切会话/清空残留(S1)**:开了 `checkpoint:true` 的集成方,`switchSession` 切新建会话(目标 snap 无 checkpoint)时 `applySnapshot` 的 importStack 受 `snap.checkpoints?.length` 门禁不触发,`onClear` 也无任何 checkpoint 重置 → 旧会话 checkpoint 栈残留 → 新会话 `restoreLastCheckpoint` / LLM `restore_last_checkpoint` 回退到**旧会话**的 messages+bind+vfs+todos(跨会话污染,比 P1-5 pin 段污染更严重)。修复:`switchSession` + `onClear` 加 `checkpointMgr.importStack([])`(替换语义清栈 + 重置增量基线,与 mission/workingMemory reset 同模式;接续 arch-review P1-5)。审计确认 skills(contentCache 跨会话有效)/permissions/summarization/subagent 无需重置,checkpoint 是唯一残留。
- selftest 1142→1145(sec-17 加 `importStack([])` 清栈白盒);e2e 288→296(storage 加 listSessions/deleteSession/sessionId/优雅降级 8 断言)。

### Fixed
- **arch-review P1-5/P1-6(切会话状态污染 + mission 清空后被历史重捕)**:
  - **P1-5 switchSession/onClear 不重置 mission/workingMemory**:`switchSession`/`onClear` 只重置 messages/vfs/todos/memory/debugLogs,缺 missionMw/workingMemoryMw → 切新会话后旧 mission goal + workingMemory 的 pin(path/hash)原样注入新会话 → 过期 hash 诱发乐观锁误冲突 / 按错误 path 写。修复:`missionMw`/`workingMemoryMw` 补 `reset()`(清 mission / 清 locatedPaths+lastHashes),`switchSession` 与 `onClear` 内调用(与现有 todos/vfs/memory 重置对齐);两中间件实例挂 `core` 对象(原仅闭包局部变量,`onClear` 经 `core.` 访问)。
  - **P1-6 `setMission({})` 清空后被历史重捕**:`beforeAgent` 仅判 `!mission` → 无法区分「从未 capture」与「被显式清空」,集成方收尾 `setMission({})` 解除锚定后,下次 send 从完整历史重新捕获含任务动词的旧 user → agent 被锚到过期目标,无告警。修复:加 `explicitlyCleared` 标记,`setMission({})` 置 true(同会话不再自动重捕),`setMission(新目标)` 与 `reset()` 撤销(显式设新目标或切会话归零后可正常 capture)。
  - ⏸ 推后(同 change 其余项):P1-1/P1-2/P1-4 已后续实施(见上各段),仅剩 **P1-3 beforeReturn 门禁解耦**评估后推迟(收益边缘 + 无低风险防死循环方案,真有用户自定义 beforeReturn 需求时重启)。
- selftest 1130→1142(sec-35 加 P1-5 reset + P1-6 防重捕白盒 8 断言;sec-38 加 reset 白盒 4 断言);e2e 286→288(storage 加 P1-5 switchSession 后 mission 重置断言)。

## [2.23.0] - 2026-08-06

### Fixed
- **P0 数据安全逃逸(`fix-write-safety-bypass`,2026-08-03 架构审查发现)**:
  - **edit/patch 写回绕过 schema 白名单(P0-1)**:`applyPatchesToBind` 写 live 用原始 patch 值(`a.value`),未走 zod `safeParse` 的 strip → 已声明路径值内的**未声明嵌套键** / 值内嵌 **`__proto__` own 键**落 bind(set 路径 `commitSetToBind` 用 `res.data` 干净、edit 路径脏)。修复:写 live 改为从 `res.data`(schema 解析值,已 strip)**整体写回**(方案 B2,与 `commitSetToBind` 单一真相源);`remove` 先 `deleteByPath`(safeMerge 浅合并不删 key)。覆盖 set/merge/append/remove 全 op。
  - **DSML/伪 XML 解析把示例当真执行(P0-2)**:`parseGarbledToolCalls` 不跳代码围栏 + 不要求 DeepSeek 强守卫标记 → 纯文本/围栏内 `<invoke name=>` 示例(用户让示范写法 / 模型贴文档片段)被当真执行写入数据。修复:① 剥离代码围栏(```...```);② **仅强守卫标记**(`<｜tool_calls｜>` / `<｜｜?DSML` / `<｜tool[_a-z]*｜>`)才自动解析执行,无守卫 → 返回 null 降级 garbled-retry 回灌(防示例误执行;代价:非 DeepSeek 模型用伪 XML 调工具多一次重试)。`detectGarbledToolCall` 保持宽松(仍认 `<invoke>` 进 garbled 流程配合回灌),`parseGarbledToolCalls` 导出签名不变。
- selftest 1097→1112(sec-30 加 P0-1 白盒 + 新建 sec-46 P0-2 白盒 + sec-25 用例适配收紧);e2e 286 不变(FAKE_LLM 走标准 tool_calls 不触发 garbled,P0-1 黑盒用例由 selftest 白盒覆盖)。

### Fixed
- **draft_commit 乐观锁补齐(harden-large-json-write A1)**:`draft_commit` 是全 SDK 唯一跳过乐观锁的普通写路径(直接 `commitSetToBind`),draft 累积跨多轮 LLM 调用期间 bind 被外部改过会**静默整份覆盖**(恰恰是核心卖点「乐观锁 + 冲突介入」最该保护的场景)。修复:与 set/edit 一致走 `handleConflict`(顺序:parse 先 → 草稿非法 JSON_INVALID 早返回不浪费介入 → handleConflict → commitSetToBind),`draft_commit` 加 `expectedHash` 参数,冲突触发人工介入 / VERSION_CONFLICT,草稿保留。
- usageHints draftWrite 段补 `maxToolRounds` 大 JSON 多轮截断提示 + `draft_commit` 走乐观锁提示(A5,LLM 可达性)。
- selftest 1112→1119(sec-41 加 A1 乐观锁三场景:onConflict 介入 keep_external 不覆盖 + 草稿保留 / 无 onConflict → VERSION_CONFLICT / 无冲突正常写);e2e 286 不变。
- ⏸ **推后**(评估有疑问/更好建议,后续批次统一处理):A4 子路径 hash(与 placeholder-protected-read-write 协同,改动面大)/ A2 快照字节上限(estimateJsonBytes 双倍序列化成本)/ A3 惰性 hash(缓存自引用风险)/ B1 draft 中间校验(scanBalance 细节)/ B2 DRAFT_EVICTED(vfs LRU 无淘汰记录,无法区分「不存在」vs「被淘汰」)/ C1/C2(P2 能力)。

### Changed
- **工具重名覆盖语义(tool-name-collision)**:自定义 tool 与内置 tool 重名从**未定义行为**(装配层重复定义 + 执行层 builtin 赢 + 标注层后注册来源,三者漂移)收敛为**显式覆盖**(后注册覆盖先注册,对齐 alibaba/page-agent)。
  - 新增 `dedupeTools` 纯函数(`sdk/toolRegistry.ts`):按装配序 builtin → user → action → humanConfirm/checkpoint → mcp 收敛为唯一集 + collisions 告警(可单测)。
  - createChatSdk 装配(`allTools` 初始 + `rebuildExtraTools`)改调 `dedupeTools`;重名 `console.warn`「谁覆盖谁」;执行(find)与标注(toolSources)天然一致(收敛后唯一)。
  - `addTool` 升级为覆盖语义(跨最终工具集去重 + warn,不再静默 return);`removeTool` 清 `toolSources`(保持与 allTools 一致)。
  - ⏸ 推后:`removeTool` 删内置(disabledNames 状态机,与 rebuild 交互边界复杂;集成方想禁用内置更直接用 capabilities,边缘场景)+ e2e 重名用例(selftest sec-47 白盒已覆盖纯函数)。
- selftest 1119→1130(新建 sec-47 `dedupeTools` 白盒 11 断言);e2e 286 不变。

## [2.22.1] - 2026-08-03

### Added
- **complex-demo 新增 3 组件(component-library-expansion,范围调整)**:badge(徽标)/ progress(进度条)/ skeleton(骨架屏)—— `defs/*.ts` + `components/*Comp.vue` + `pageSchema.ts`(discriminatedUnion 33→36 + PageComponent)+ `CompRenderer.vue` + initialPage 实例。用户决策「不需要 80,加几个意思意思就可以」。tsc 类型检查通过 + complex-demo browser spec 9 passed 回归。意外发现:`extractSchemaHint` 对 `components[union]` 数组字段不全量展开(深入靠 `schema_data`)→ 原「80 type 撑爆 systemPrompt」担忧不成立。

### Fixed
- **`proxyLlm` `throwOnDirectInProduction` 强安全闸失效(测试驱动发现真 bug)**:`throw` 写在 `try` 块内(L93)被 `catch { location 不可用静默 }`(L97)**吞掉** → opt-in 强安全闸(防 apiKey 进 bundle 泄露)never throw 到调用方,集成方设 `throwOnDirectInProduction:true` 实际不阻断。修复:`if(isProd)` 判定 + throw/warn 移出 `try`(try 只兜底 `location` 属性访问异常,isProd 判定在 try 外)。补 `selftest sec-45`(mock `globalThis.location` 测 throw/warn/localhost/http/SSR 五分支)暴露此 bug —— 3 agent 审计高优先遗漏 #1 驱动。
- **`types/index.d.ts` `ContextPreset` 漏 `'complex'`**:集成方传 `contextPreset:'complex'` 类型报错(types 写三值,src 真值四值)。补 `| 'complex'`;`tests/types.test-d.ts` 加 `_cp4: ContextPreset = 'complex'` 字段级断言防回归(原 `test:types`/`test:exports` 只查符号不查字面值,漏过此 bug)。

### Changed
- `createAgent.ts` `DebugLog` interface 重复声明合并(L44 无 `source` + L110 含 `source`,declaration merge 掩盖意图;合并为 L44 一处含 `source`)。
- `SkeletonComp` `variant` Vue prop 改必填(对齐 schema 必填契约);删 `App.vue` 调试 `console.log` 残留。

### Tests
- 3 agent 审计高优先遗漏补强(违反测试同步约定):① `selftest sec-45`(proxyLlm `throwOnDirectInProduction` 5 分支,暴露并修复上述 throw 被 catch 吞 bug);② e2e `workingMemory:false` 关闭路径(与 `missionAnchor:false` 已测对称,原零覆盖);③ e2e `send(text,{mission})` 显式 capture(公共 API,原 e2e 全用 setMission,send 入口零覆盖)。selftest 1092→1097 / e2e 283→286。

### Docs
- 批 E 文档结构(部分完成):① README/doc 计数同步 → **1097/286**(selftest +5 / e2e +3 后;含 doc/README.en 文档表补 capability-boundaries + complex-agent-roadmap 2 行);② 「2.18+/2.19+」→「2.20+」(README + usage-guide;实际随 2.20 发布,CHANGELOG 无 2.18/2.19);③ `openspec/project.md` 概述:`window` 属性注册表(1.x 旧模型)→ `data.bind` 单主对象(schema 校验 + jsonPath 增量 patch + 乐观锁;3.0 现状)。
- **deferred(高风险/大工作量,留专门会话)**:`usage-guide.md` 段号重排(§6.9×2 / §6.10×3 / §6.11×2 / §6.12×2 / 两个 §8,目录也不同步 —— 段号+目录+子节多处一致易错,错段号比重复更糟)、`usage-guide.en.md` 补译 6 节(残缺 ~40%)、`capability-boundaries.md` B1-B5 全迁「能做」(L92 已有「⚠ 整体过时」强标注,非阻塞)。

## [2.22.0] - 2026-08-03

### Changed
- **dataOps patch 装饰器(p2-architecture-refactor 子项 3)**:edit_data / write(edit) / eval-patches / eval-subtree 四处各自 clone+循环校验(isUnsafePath/isPathAllowed/maybeParseValue)+applyPatchToClone+schema 校验+snapshot+applyPatchToLive 重复(乐观锁×拦截器×dryRun 三轴组合的 bug 高发区)。抽 `applyPatchesToBind(args)` 单一真相源纯函数(参数化 schemaErrorMode 'zod'/'schema_invalid' + snapshotLabel + dryRun;调用方保留 bindRef 守卫/audit detail/lastReadHash/message 差异)。四处改调装饰器消除重复。纯重构零行为变化。
- **capabilities 注册表 + 单一解析(p2-architecture-refactor 子项 4)**:17 个能力开关此前在 createChatSdk/toolsets/usageHints 三处 `===true`(opt-in)/`!==false`(opt-out)混用解析(新增开关改 5 处易错)。新增 `src/core/capabilities.ts`:`CAPABILITIES` 注册表(`Capability { name, defaultOn, requires? }` 显式标 opt-in/opt-out + 依赖)+ `resolveCapabilities(caps)` 单一解析函数。createChatSdk / toolsets / usageHints 统一经 resolveCapabilities(签名向后兼容,内部各自 resolve)。**requires 强制依赖**:draftWrite 需 dataOps+vfs,任一关则 draftWrite 强制关(防"开 draft 但关 dataOps"无意义组合)。新增导出 `resolveCapabilities`/`CAPABILITIES`/`Capability`/`CapabilityFlags`/`ResolvedCapabilities`。纯重构零行为变化。
- **test:types 字段级断言防漂移(p2-architecture-refactor 子项 5 防护层)**:[2.21.0] 修了已发生的 types 漂移(名字都在、字段错 —— AgentCore 缺 10 方法等),但根因是现有 `test:exports`(查导出名集合)+ `test:types`(查类型名存在)都只查「符号在不在」,**抓不到字段签名漂移**。补字段级断言到 `tests/types.test-d.ts`(tsc 类型层可靠;放弃升级 `.mjs` 做字段解析 —— 联合/内联类型正则脆弱)。5 类 `Pick`/`Extract` 断言:① `ChatSdk` 全 34 方法/属性(`Pick<ChatSdk, 'mount'|'send'|...|'removeSubagent'>`,**直接防 AgentCore 缺方法坑源**);② `SubagentConfig` 10 字段;③ `SdkEvent` 关键分支 `Extract`(data_change operation / error severity / usage round / trace spans —— 分支或字段删/改名即 `Extract` 得 never 访问报错);④ `ChatSdkOptions` 关键字段(tokenBudget/actions/capabilities/onAudit/toolMode/interceptors 等);⑤ capabilities 17 开关名 `Pick`(与 `capabilities.ts` CAPABILITIES 注册表呼应)。`exports-consistency.mjs` 加职责分工注释(管「符号存在」,types.test-d.ts 管「字段正确」)。未来任一字段漂移 → `test:types` 编译失败。

## [2.21.0] - 2026-08-03

### Fixed
- **automation 断点续跑持久化从未生效(quality-hardening 运行时测驱动发现)**:`storage.ts` 的 `SnapshotKind`/`SNAPSHOT_KINDS` 只含 messages/vfs/todos/memory,**不含 checkpoints/usage** → `persistRuntime` 调 `store.save({checkpoints})`/`{usage}` 被 save 遍历 SNAPSHOT_KINDS 时 skip → **从未持久化**;`applySnapshot` 读 `snap.checkpoints`/`usage` 但 load 不读这俩 kind → 跨实例恢复失效。影响:`capabilities.automation + checkpoint + storage` 的断点续跑(刷新/崩溃后恢复 checkpoint 栈 + 累计 usage)自 2.20 发布以来从未真正工作。修复:SnapshotKind/SNAPSHOT_KINDS 加 checkpoints/usage(save/load 遍历自动处理;老 snapshot 无这俩 kind 向后兼容)。
- **types 漂移根治(p2-architecture-refactor ⑤ 提前做掉)**:src 内部类型(AgentCore/ChatSdk/AgentInfo)与实现、对外 `types/index.d.ts` 三方不同步 —— `tsc -p tsconfig.json` 全量报 35 个源码真错 + 768 测试 unused/签名漂移(注:`test:types` 门禁用 `tsconfig.test.json` 只查对外 `types/index.d.ts`,本就绿;768 是 dev/IDE 全量债非门禁)。源码 35 真错清零:① `AgentCore` interface 补 10 个 2.17+ 新增运行时方法(`setTools`/`addTool`/`removeTool`/`setLlm`/`setMemory`/`refreshMemory`/`setSubagents`/`addSubagent`/`removeSubagent`/`batch` —— 实现早有,内部类型声明漏,致 `core.setXxx()` IDE 红);② `ChatSdk` interface 补 `hide()`/`show()`;③ `AgentInfo`(src 内部)补 `contextPreset`/`planPhase`/`mission`/`workingMemory`/`actions`;④ `ChatSdkOptions.vfs` 补 `poolBytes`(三池分池配置);⑤ **`ChatSdkOptions.onAudit` 签名修正**:`{op,jsonPath,opDetail,timestamp,success,error}` → `{op,value,detail,timestamp}` 对齐 `DataAuditEntry` 实际字段(原 jsonPath/opDetail/success/error 是漂移 bug,从未有真值 —— 集成方拿到的恒 undefined);⑥ `send`/`stream` options 补 `interceptors`(per-call input/output 覆盖顶层)+ `maxAutoRetries`(per-call 覆盖 automation 重试);⑦ `jsonParseError` raw: `string`→`unknown`(非字符串 value 不再 `.slice` 崩);⑧ conflictManager `getEmit?.()` 空安全(拆 `emit?.()`);⑨ subagent `mw` 类型修正(controller 经 defineProperty 挂,字面量标注不含);⑩ dataOps patches list 类型放宽(op/jsonPath 可选)+ op `?? 'set'` fallback + diffData `against` 类型;⑪ 删 3 个 unused import(createInitialState/ConflictInfo/BaseMessage)。

### Added
- **proxyLlm direct 生产安全闸**:`createProxyLlm({ ... throwOnDirectInProduction })` 新增 opt-in 配置。生产环境(https + 非本地域)检测到 direct 模式时,默认仍 `console.warn`(向后兼容);设 `throwOnDirectInProduction:true` → 直接 throw 阻断 direct 误用于生产(防 apiKey 进 bundle 泄露;direct 本就标注「仅开发」)。

### Performance
- **formatForLog short-circuit**:生产(debug=false 且无 onLog)`formatForLog` 直接 return `[]` 不 stringify,省长任务每轮 O(context)→O(1)(debugLogs 仍 push entry 供 round/model 诊断,仅 messages 字段空)。
- **extractSchemaHint WeakMap 缓存**:按 schema 对象引用 + optsKey 缓存 hint(每轮 augmentPrompt 经 replaceSystem→buildSystemPrompt 重算 → 命中省 renderOverview/Shallow);setData 传新 schema → 新引用自动 miss,无需手动失效。原逻辑抽 `computeSchemaHintImpl`。
- **checkpoint save 脏标记增量(P1 perf,checkpoint-incremental-snapshot)**:checkpoint 每轮 beforeModel 整体深 clone vfs(默认 8MB)+ bind(几百 K)→ 长任务几十轮累积纯浪费(大多数轮 vfs/bind 根本没变,agent 只 read 或局部 patch)。改造:① vfs 加 `_dirty`(Proxy set/delete 统一置脏,**零遗漏覆盖所有工具写**;hydrate/clear 手动)+ `consumeDirty()`/`isDirty()`;② dataOps controller 加 `markDataDirty`/`consumeDataDirty`,全写路径标脏(`commitSetToBind` 新增 `onWrite` 回调收敛 set_data/write(set)/draft_commit,dryRun 不触发;edit/delete/restore/handleConflict·restore/eval transform 3 模式/write del·edit·patches / controller.set·update / importData);③ checkpoint save 脏或缓存空才 clone,否则复用上次 clone(闭包 `lastVfsClone`/`lastBindClone`);④ **restore/importStack 重置增量基线**(测试驱动发现:restore 改 bind 走 restoreInPlace 不经 dataOps 脏标记 → 重置 lastBindClone 强制下次 save 重建,防 restore 后 save 复用旧基线静默错乱);⑤ importStack 重置缓存。MVP 只 vfs+bind(messages 保持整体 clone,Phase B 单独评估)。对外 API 零变(纯内部优化)。

### Tests
- **stub BaseChatModel 基建(`tests/e2e/_stub-model.mjs`)**:本地 BaseChatModel 子类(可控响应队列:文本/工具调用/抛错/usage),驱动真实 agent ReAct 循环不发 HTTP —— 补 selftest 触不到的 createChatSdk 顶层运行时测盲区。stub throw 默认 status:400(4xx 非 retryable,防 withRetry 把普通 Error 当网络错误重试)。
- automation 运行时测(budget 端到端 + send 致命错误恢复[maxAutoRetries+restore] + batch 任务隔离 + 断点续跑跨实例恢复)、subagent-writable(spawn_agent 透传 writablePaths + 越界 PATH_OUT_OF_SCOPE + 整体 set 禁)、todos-tier(write_todos 层级 parentId/deps → inspect 反映)。e2e 263→283。
- maliang-real-llm 审计脚本:send(invoke)不外发 tool_call 事件 → 工具链改从 `inspect().trace.spans` 收(tool span name = 工具名)。
- checkpoint 增量(sec-17):vfs 脏标记(consumeDirty 读后清/未变轮共享 clone 引用/写后新 clone/restore 共享安全)+ bind 脏标记(set/edit/delete/restore/handleConflict/write·dryRun·del/controller.set 各写路径标脏,只读·dryRun 不标)+ **跨轮 restore 一致性**(写→save→写→save→restore(id1/id2/id3)→bind/vfs 数据一致 + restore 后 save 基线重建)。selftest 1030→1055。

### Docs
- usage-guide(中英):§6.13 结构化追踪 TraceSpan + §6.14 无人值守自动化(资源预算/错误恢复/batch/断点续跑)。
- capability-boundaries:B7 移「能做」(TraceSpan 2.19 已实现)+ automation 说明(2.20)+ 升级矩阵(标注 B1-B5/B7 多数已实现,文档整体过时待更新)。

## [2.20.1] - 2026-08-02

### Fixed(4 agent 交叉审查 P0)
- **[CRITICAL] 安全:eval_script 沙箱动态 import() 旁路**:WORKER_PREAMBLE 禁了 fetch/XHR/importScripts/WebSocket,但漏了动态 `import()`(classic Worker 支持拉外网 ES 模块外泄 data)。修复:runSandboxedScript 入口静态扫描拒绝 `import(`/`eval(`/`Function(`/`new Function`/`require(`,运行时 fn 创建后禁 `self.eval`/`self.Function` 双保险。
- **[HIGH] 安全:get_dom attrs LLM 可控读敏感**:`attrs` 是 LLM 入参,传 `["value","data-token"]` 读表单值/凭据,默认白名单形同虚设。修复:加 `DENY_ATTR_RE`(value/on*/srcdoc/formaction)+ `DENY_ATTR_SENSITIVE_RE`(token/secret/key/auth/cred/csrf/session),即使 LLM 加进白名单也硬排除。
- **[HIGH] 安全:inspect_env 无 denylist**:key LLM 可控,`inspect_env({key:"localStorage"})` dump token/PII。修复:`ENV_DENY_KEYS`(localStorage/sessionStorage/cookie/document/窗口指针)+ `ENV_SENSITIVE_KEY_RE` 拒绝。
- **types 漂移:SubagentConfig 缺 writablePaths**:types/index.d.ts 补 `writablePaths`;`SubagentOptions` 从 `{[k:string]:any}` 改具体(role/tools/writablePaths/model)。
- **importStack 未校验 id 类型**:脏数据 `cp.id` 字符串 → `Math.max` 成 NaN → `nextId=NaN` → 后续 save 产出 NaN id。修复:`typeof number && isFinite` 过滤。
- 含 2.20.0 后续:`send` 不传 options 容错(2.20.0 含 bug)+ `renderTodos` 加 seen 循环防护。

### Tests
- selftest 补:`runSandboxedScript` 静态扫描拒 import()/eval()/Function() + `domToStructure` DENY(value/data-token) + `inspect_env` denylist(localStorage/token/document) + `importStack` id 类型校验。1019→1026

## [2.20.0] - 2026-08-02

### Added
- **自适应规划(add-adaptive-planning)**:① todos 增量更新 —— 新增 `update_todo({ id, content?, status? })` 工具(按 id 改单项,不必重传整个清单);`Todo` 增稳定 `id`(`write_todos` 时框架按 index 生成 `t-1/t-2...`,LLM 也可显式传;hydrate 旧数据按 index 补,向后兼容);`augmentPrompt` 渲染带 id 供 LLM 引用。② 规划阶段防死循环 —— 新增 `maxPlanRevisions` 配置(默认 5,**规划阶段总轮次**预算,与 `maxIterations` 总闸正交):首次 `write_todos` 进入 planning → 每轮 `beforeModel` 计数(含 read/query/search 调研轮)→ 主数据写工具(write/set_data/edit_data/delete_data)成功退出 → 超限回灌「停止调研/修订,基于当前清单执行」(不强制终止,总闸兜底);支持重入(退出后再 write_todos 重新进入,单阶段计数重置)。③ 自适应 prompt 引导 —— `usageHints` planning 段升级(简单直接做/复杂先规划/update_todo 增量/方案确认 + 轮次预算提示)+ humanConfirm 补「规划方案确认」第 4 类。④ 内置 skill `adaptive-planning`(判断复杂度→规划→可选用户确认→执行→动态增量修订,入 npm 包 `skills/` 分发)。⑤ `inspect().planPhase` 反映 `{ inPlanning, rounds, limit }`;`createChatSdk({ maxPlanRevisions })`。选型见 `openspec/changes/2026-08-01-add-adaptive-planning/decision-record.md`(A 框架深度 / B 计数语义各三方案 + 升级路径 + 暂缓提案关系)。**范围:轻量版**(框架只加 update_todo + maxPlanRevisions;复杂度判断/方案确认/标准流程在 prompt 层)。能力边界见 `doc/capability-boundaries.md`
- **任务目标锚定 mission(revive-mission-anchor Phase 1)**:会话级 Mission 状态(`{ goal, acceptanceCriteria?, sourceMessageIdx, capturedAt, explicit }`)。① capture:首条「任务型」user 启发式(非空/非问候/含任务动词,不调 LLM)+ `send({mission})`/`setMission` 显式覆盖;② augmentPrompt 每轮注入「## 当前主线目标」pin 段(**天然跨压缩保留** —— mission 在 state 不在 messages,compressInput 不碰);③ SDK API:`getMission()` / `setMission({goal?,criteria?})`(合并;`{}` 清空)/ `send(text,{mission?})` / `inspect().mission`;④ `capabilities.missionAnchor`(分层默认核心,**默认开**;`false` 关)。长任务防跑偏 + 压缩丢主线。定位升级重启(complex-agent-roadmap Phase 1,见 `doc/complex-agent-roadmap.md`)
- **跨压缩工作记忆 workingMemory(revive-cross-round-working-memory Phase 1)**:① 自动捕获(`wrapToolCall` after,**不调 LLM**):`read`/`query_data`/`search_data` 结果 → `locatedPaths`(LRU ≤10 去重);`read` 结果的 `hash=` → `lastHashes[path]`(LRU ≤10);其他工具不捕获;② pin 段天然跨压缩:`augmentPrompt` 每轮注入「## 工作记忆(跨压缩保留)」(workingMemory 在 state → `compressInput` 不碰;**无需改 summarization**,同 mission 机制);③ `capabilities.workingMemory`(分层默认核心,**默认开**;`false` 关);④ `inspect().workingMemory` 反映 pin(locatedPaths/lastHashes)。解锁:几百 K 频繁压缩 → read/query 定位的 path + read 的 hash 随 older 轮次丢 → LLM 重复检索(浪费 token)+ 凭记忆写致 `autoLock` 误冲突。与 `preserveLastToolResults` 互补(preserve 保工具结果摘要防字段描述丢,workingMemory 保 path/hash 结构化防定位丢);与 mission 正交。定位升级重启(complex-agent-roadmap Phase 1)
- **大 schema 分层披露(add-schema-tiered-disclosure Phase 1)**:`extractSchemaHint(schema, opts?)` 阈值触发(默认 maxKeys=15/maxChars=4000,集成方经 `schemaHint` 配置可调)→ 大 schema 自动转「顶层概览」(`renderSchemaShallow`:key+type+一句描述,**不带**约束/不递归 shape)+ 尾部提示(深层约束查 `schema_data`);小 schema(≤阈值)仍全量(现状不变,无感)。新增导出 `renderSchemaShallow`/`SchemaHintOptions`。直击:50+ 组件深嵌套 schema 全量注入 systemPrompt 撑爆上下文 + LLM 认知负担(本轮只改 1 个组件却看到全部约束)。在 expose-schema(2.17)之上加分层;`schema_data` 工具已有(advanced)。定位升级重启(complex-agent-roadmap Phase 1)
- **环境探查工具 inspect_env(排查调试默认工具)**:新增**默认开启**的轻量环境探查(`capabilities.inspectEnv` 默认 true,`false` 关)。① 无参返回 window 安全摘要(`location` URL/origin/path、`navigator` 浏览器/语言/在线、`viewport` 视口尺寸/DPR/滚动、`document` title/readyState);② 传 `key` 读指定 `window[key]`(集成方挂的调试变量,如 `inspect_env({key:"appConfig"})` 读 `window.appConfig`);③ `safeSerialize` 跳过 function/DOM/循环引用 + 限深度/键数/长度截断防超大。排查"当前 URL/浏览器/视口/调试变量值/为何没生效"。区别于 `get_dom`(DOM 结构深度遍历,opt-in,有 token 成本):inspect_env 轻量只读环境摘要**默认开**。新增导出 `inspectTools`/`inspectEnvTool`/`safeSerialize`/`getEnvSummary`
- **分块写工具 draft_write/draft_commit(Phase 2,opt-in)**:几百 K JSON 逼近 LLM `max_tokens` 单次 write 装不下 → 分块构建(类 git add→commit)。① `draft_write({draftId, chunk, mode})` mode:start 新建/append 追加(拼 JSON 片段到 vfs drafts 池,2MB);② `draft_commit({draftId})` 合并 → JSON.parse(失败 JSON_INVALID)→ schema 校验(失败 SCHEMA_INVALID,草稿保留可修后重试)→ 原子写 bind + 快照(成功清草稿)。draft_commit 复用 `commitSetToBind` 纯函数(与 write(set)/set_data 共用校验+快照+乐观锁链)。`capabilities.draftWrite` 默认关(opt-in;需 dataOps + vfs;toolMode advanced 暴露,simple/minimal 隐藏)。**重构**:抽 `commitSetToBind` 纯函数(set_data/writeSlot set 改调它,零行为变化)。新增导出 `commitSetToBind`
- **结构化追踪 observability-tracing(Phase 3,opt-in)**:`debugLogs` 扁平数组升级为 **TraceSpan 树**(round/model/tool/compression span + timing/status/usage)。① `getTraceMetrics(spans)` 纯函数聚合(轮次/延迟/工具成功率/重试/压缩/token);② DebugDrawer 第 4 tab 🌳 Trace(metrics 卡片 + span 列表);③ `inspect().trace` + `onEvent('trace')`;④ `capabilities.tracing` 默认关(opt-in,采集有开销;`onSpan`/`onTrace` 回调 no-op 零开销)。新增导出 `TraceSpan`/`TraceMetrics`/`getTraceMetrics`
- **结构化 todos 层级依赖(structured-todos-tier Phase 2)**:Todo 加 `parentId`(父任务)/`deps`(依赖数组)/`criteria`(完成标准)/`evidence`(完成证据)。① `write_todos` 层级输入(parentId/deps/criteria/evidence)+ `ensureIds` 透传(不丢字段);② `renderTodos` 递归渲染(有 parentId 缩进 + deps ✓/⏳ 阻塞标注 + evidence + criteria);③ `update_todo` 增量改层级字段;④ **扁平 fallback**(无 parentId → 现状扁平渲染,零破坏)。schema 总含可选字段(向后兼容)
- **子 agent 写权限 subagent-writable(Phase 2,opt-in)**:子 agent 默认只读。配 `writablePaths` 前缀白名单后获写权限(write/set_data/edit_data/delete_data/draft_commit 经 `wrapWithPathGuard` 包装,越界 `PATH_OUT_OF_SCOPE`)。**整体 set 禁**(无 jsonPath 盲区,子 agent 只能增量 patch,防越权)。SubagentConfig + spawn_agent 参数 + SubagentOptions 支持 `writablePaths`。三重防护(writablePaths 前缀 + PATH_OUT_OF_SCOPE + 禁整体 set)。新增导出 `extractWritePaths`/`isPathWritable`/`wrapWithPathGuard`
- **无人值守自动化 automation-layer(Phase 4,opt-in)**:`capabilities.automation:true` 开启(最远,默认关)。四互补子能力构成"无人值守"闭环:① **资源预算闸** —— `tokenBudget`/`timeBudgetMs` 配置,wrapModelCall 每轮检查累计 total_tokens/耗时,超限 → 停止 agent + emit `BUDGET_EXCEEDED`(补核心缺口:usage 此前只累计不强制,无人值守易烧爆);② **无人值守错误恢复** —— `maxAutoRetries`(默认 1),send 致命错误(invoke 抛错)→ 自动 `restore_last_checkpoint` 回本轮前 + 重试(限次防循环;确定性错误耗尽 → fatal emit + throw);③ **任务级断点续跑** —— SessionSnapshot 扩展 `checkpoints?`/`usage?`,刷新/崩溃后恢复 checkpoint 栈 + 累计 usage(restoreLastCheckpoint 可用 + 预算统计连续);④ **批处理 `sdk.batch(tasks, onProgress?)`** —— 逐任务跑 agent,每任务前 checkpoint,任务间错误隔离(单任务失败不中断整批,记 observable error 继续下一个)。`CheckpointManager` 加 `exportStack/importStack`;新增导出 `BatchResult`/`BatchProgress`/`Checkpoint`。定位升级终态(complex-agent-roadmap Phase 4)

### Changed
- planning 中间件工具(write_todos / update_todo)`source` 标 `'builtin'`(此前落 `'user'`,语义错;与 vfs/checkpoint/humanConfirm 一致)
- **ChatDialog 样式优化**:① 正文(`.message-md` / `.message-bubble`)字号 13→12px 对齐「思考过程」字号(line-height 提到 1.7 补偿小字号可读性);② 人工确认框(`.approval-bar`)样式升级:左侧 4px 强调边 + 渐变背景 + 卡片化问题/推荐(白底 + 阴影 + 主色左边推荐块)+ 按钮主次分明(允许=主色填充带阴影 + 拒绝=描边 + 选项 hover 上浮),图标放大

### Fixed
- **生成中(loading)回车输入丢失修复 + 排队续跑**:旧版 agent 生成中用户回车 → `sendMessage` 被 loading 守卫 `return` 不发,但 `handleSend` 已清空 `inputText` → **输入内容丢失 + 无反馈**。改为「排队区」机制:生成中发送的消息入排队区(**可见,作后续任务记录**;不先进 messages,避免多条排队打乱"最后 user"定位),生成完 `finishRound` 自动依次执行(`shift → addMessage → runAssistantStream`,顺序正确不跳条);排队任务可 ✏️ **修改**(填回输入框编辑)/ ✕ **撤销**(`removeQueuedTask`);`stop` 清空排队。selftest `sec-40`(15 项,922→937) + browser `queue.spec`(3 用例:排队自动执行/撤销/修改,用 mockLlm delays 制造 loading 窗口);`finishRound` 加 try/catch(`onPersist` 持久化抛错不阻塞排队续跑 —— 修真健壮性缺陷:clearStorage 删 indexedDB 致 flush reject / 实际 quota 满/IO 失败同理会卡死后续排队)

### Tests
- selftest 新增 `sec-34`(update_todo 增量 / id 生成 / TODO_NOT_FOUND / maxPlanRevisions 阶段计数 / 超限回灌 / 写工具退出 / 重入 / hydrate 补 id / 同轮冲突拒)。断言计数 782→800
- e2e `inspect.mjs` + `systemprompt.mjs` 补(update_todo + source=builtin + planPhase + maxPlanRevisions 配置反映 + 自适应规划引导)。断言计数 228→238
- browser `page-demo.spec.ts` 加「write_todos→update_todo→write 自适应规划端到端」。断言计数 15→16
- selftest 新增 `sec-35`(mission capture 启发式 / 保守(问候/超短/超长/无动词)/ setMission 显式覆盖·合并·清空 / getMission / augmentPrompt pin 段)。断言计数 800→817
- selftest 新增 `sec-39`(inspect_env:`safeSerialize` 纯函数基本类型/截断/function/symbol/bigint/array/object/深度/循环/DOM/getter + `getEnvSummary` 结构 + `inspect_env` invoke 读 window 属性/不存在/无参摘要,~18 项)+ `sec-19` 补 `selectBuiltinTools` 的 inspect 默认开/关。断言计数 894→922
- e2e `inspect.mjs` 补 inspect_env(默认含 + `inspectEnv:false` 不含 + source=builtin)。断言计数 247→250
- e2e `inspect.mjs` 补 mission(getMission/setMission/inspect().mission/capabilities.missionAnchor:false → getMission undefined + setMission warn 不抛)。断言计数 238→247
- selftest 新增 `sec-41`(draft:`commitSetToBind` 纯函数白盒 合法/schema失败/dryRun + `draft_write` start/append + `draft_commit` JSON_INVALID/SCHEMA_INVALID 不写保留/成功写 bind+清草稿/DRAFT_NOT_FOUND + createDataOps({vfsStore}) 含 draft + filterByToolMode simple 隐藏,~24 项)。断言计数 937→961
- e2e `inspect.mjs` 补 draft(`draftWrite:true`+vfs+advanced 含 draft_write/draft_commit;opt-in 关;simple 隐藏)。断言计数 250→254
- selftest `sec-17` 补 `CheckpointManager.exportStack/importStack`(导出/深拷贝隔离/JSON 序列化往返/恢复栈/restore 可用/nextId 重置防冲突/脏数据过滤/非数组不抛,11 项);e2e 新增 `automation.mjs`(capabilities.automation opt-in 反映/budget 中间件装载/batch API 暴露/false 显式关/automation+checkpoint 共存/maxAutoRetries 配置,7 项)。断言计数 selftest 1004→1015 / e2e 256→263

## [2.17.0] - 2026-08-01

### Added
- **字段约束可见性(expose-schema-constraints)**:新增 `describeSchemaNode(schema)` 纯函数结构化提取 zod 字段约束(类型/min/max/enum/必填/默认/嵌套 shape,针对 zod 4 `_def`/`_zod.def`),三处消费:① `extractSchemaHint` 升级 → systemPrompt「可操作数据」段带 `key (Type)[约束]: desc`;② 新增 `schema_data({ jsonPath? })` 工具(advanced)查任意路径完整约束。LLM 写前即知规则,减少"写错→校验失败→重试"轮次。`describeSchemaNode` 是 zod 4.4+ adapter(结构探测失败返 type-only 兜底 + dev warn)。新增导出 `describeSchemaNode`/`renderSchemaHint`/`renderSchemaOverview`/`formatConstraints` + 类型 `SchemaNodeDesc`
- **默认工具集演进(evolve-default-toolset)**:① 精简 —— `snapshot_data`/`list_data_snapshots` 从 simple 移到 advanced(被自动快照 + restore_data + history_data 覆盖),simple 8→7 工具;② 补缺 —— 新增 `history_data({ id?, jsonPath? })`(simple,只读查看快照,填 list 元信息 / restore 破坏性之间的空档);③ 增强 —— `read` 增 `jsonPaths`(多路径一次读,非法路径单项标错不整批失败)+ `offset`/`limit`(数组分页,返回切片 + total/hasMore),`write` 增 `dryRun`(四意图预检:走完整校验链但不落盘/入快照,乐观锁冲突照常检测不挂起),`eval_script` 增 `jsonPath`(子树模式,降低大 JSON 深拷贝/执行成本;transform 返回值作为子树新值);④ 新增 `diff_data({ snapshotId?, against? })`(advanced,差异对比,纯函数 `diffObjects` 顶层导出)
- **三档错误模型(unify-error-model)**:显式化已有的隐式三档 —— `AgentError.severity`(recoverable 回灌 LLM 自纠 / fatal emit+中断 / observable 记录不中断)+ `routeError`/`asAgentError` 纯函数(普通 Error 默认 fatal,保守暴露问题)。内置 catch 点用简化硬编码路由(coreExecTool recoverable / afterAgent observable / emit observable / invoke fatal)经 `asAgentError` 归一化;`routeError` 作为公共工具导出(供集成方自定义 catch + 为未来 `wrapToolCall` 自动路由预留扩展口,框架内置 catch 当前未消费)。`onEvent('error')` payload 扩展 `{ severity?, code?, context? }`(向后兼容,旧监听器读 message 不破)。新增导出 `ErrorSeverity`/`AgentError`/`ErrorRouting`/`routeError`/`asAgentError`/`agentError`

### Fixed
- **`inspect().systemPrompt` 残缺(漏中间件段)**:`getInfo` 另起炉灶拼 systemPrompt(只 `base + data + augmentSystem`),漏掉 `usageHints` / `todos` / `skills` / `memory` / `subagents` 等中间件 `augmentPrompt` 段,集成方 / DebugDrawer 看到的"系统提示词"残缺,排查 prompt 问题(如"LLM 为何不知道有这些 skill / 工具用法")时被误导。修复:`createAgent` 暴露 `getEffectiveSystemPrompt()`(复用内部权威 `buildSystemPrompt`,即实际发给 LLM 的内容),`getInfo.systemPrompt` 代理到它 —— prompt 拼装收敛为单一真相源。展示一致性修复,**LLM 实际收到的 prompt 本就对**(向后完全兼容)。

### Changed
- **模型能力表匹配 first-match → longest-match**:`resolveModelCaps` 对 `MODEL_TABLE` 的匹配从 first-match 改为按"实际匹配子串长度"(`RegExp.exec(model)[0].length`)降序取最具体条目,消除顺序依赖(未来新模型名是旧模型子串时不再被宽泛条目抢先匹配,拿到错的 `contextWindow`/`maxOutputTokens` 连锁影响 offload 阈值/压缩触发/maxTokens 缺省)。不用 `pattern.source.length` —— `|` 分支会虚高 source 长度(实测 `glm-4.5` 被 `glm-4|glm4` 误压)。**行为不变**(当前顺序下 longest=first 结果一致,向后兼容)
- **乐观锁 hashValue 升级 cyrb53(53-bit)**:`hashValue`(整体 bind 值的 hash,乐观锁用)从 djb2(32-bit,~65536 对象 50% 碰撞)升级为 cyrb53(53-bit,碰撞空间 2^53,生日碰撞阈值升至 ~9500 万对象),大幅降"误判无冲突 → 静默覆盖外部修改"概率。同时明确并发语义:`autoLock` 在 `maxParallelTools>1` 下退化为"整体快照语义"(最后完成的 read 的整体 hash),并发场景建议 LLM 显式传 `expectedHash` 精确控制。hash 不持久化/不跨会话,**无兼容性问题**(语义不变,LLM 只比对相等)
- **ReAct 循环预算语义加固(工具轮 vs 总迭代)**:`rounds` 回归"只计工具轮"(有 tool_calls 执行才 +1);格式自纠 / verify 自纠不再消耗 `rounds`(它们有独立预算 `formatRetries`/`verifyAttempts`)。新增 `iterations` 总循环计数 + `maxIterations` 硬上限(默认 `max(maxToolRounds*3, 30)`,经纯函数 `computeMaxIterations` 推导,防自纠死循环的总闸)。同等 `maxToolRounds` 下 agent 可用工具轮更多(自纠不再挤占工具预算,更符合直觉)。循环耗尽兜底文案改为进展引导(不再让用户"简化问题");`round_start` 事件的 round 字段改用迭代号(`iterations`,自纠轮新号,避免 UI 按工具轮号显示时同号卡顿)。**向后兼容**(语义修正)
- **双摘要合并协议统一(unify-context-compression)**:抽 `SummarySegment` 协议 + `mergeSummarySegments`/`parseSummarySegment`/`renderSummarySegment` 纯函数;`trimMemoryMessagesImpl`(`rounds.ts`)与 `useContextManager.compress` 的"提取头部旧摘要"改调共享 `parseSummarySegment`(消除两处逐字重复的提取补丁)。**内部重构,行为不变**(统一"提取";"合并"格式保留各自 —— summarization 新在前 / trim 旧在前,不强行统一)
- **中间件声明式 priority 排序(declarative-middleware-ordering 期一)**:`createChatSdk` 中间件装载序从"数组字面量位置硬编码"改为声明式 `MIDDLEWARE_PRIORITY` 常量 + `composeMiddlewareStack` 纯函数稳定排序 + selftest 断言锁死已知约束(dataHint 最前 / sdk-events 最末 / verify 在用户前 / humanConfirm 在 approval 前);修了初版 `sdk-events=9999` bug(用户中间件 Infinity 会排到其后,破坏"最后观察"语义)。**行为不变**(排序结果与原硬编码一致)。期二(`createReconfigurable` setter 收敛)**DEFERRED** —— 纯内部重构量大收益低,推迟
- **精修:能力可达性 + 去冗余 + 半成品诚实化(refine-dataops-reachability / fix-unify-error-half-done)**:① `read` 概览去约束(与 systemPrompt 去重复,约束靠 systemPrompt + `schema_data`);② `usageHints` 补分页/多路径/dryRun 用法提示(让 evolve 加的能力 LLM 可达);③ `describeSchemaNode` zod 版本防御(adapter 集中声明 + dev 模式 console.warn 去重);④ unify-error 缩水诚实化(`routeError` 降级为导出工具 + 扩展口注释,middleware 删空头契约承诺,零行为变化,为未来 `wrapToolCall` 补全留低改动面)
- **真 LLM 审计收口(followup-from-live-llm-audit)**:4 agent 真 LLM 全覆盖审计(6 demo × 多场景)后 —— ① 修 `isPathAllowed`/`getSchemaAtPath` discriminatedUnion **pre-existing bug**(误当 ZodArray 致 `components.N.props.X` 深层路径误 PATH_DENIED;ZodArray 严格判 + union 降级开放交 safeParse 兜底;complex-demo 嵌套 schema 下 evolve patches 增量改单字段恢复可用);② browser 全跑 flaky 修(`_helpers` clearChat 含 `clearStorage` 清 indexedDB/cookies 防跨 spec 污染 + waitForAgentIdle timeout 30→60s);③ `usageHints` 补 `history_data`(simple)/`diff_data`(advanced)提示(真测:LLM 绕过 diff);④ `planner-demo` systemPrompt 加"收到方案必须 write 落地"(真测:主 agent 停在委派完)

### Tests
- e2e `systemprompt.mjs` 补 `inspect().systemPrompt` 完整性断言(配 skills/memory/dataOps 后含 usageHints `## 能力使用提示` / skills `## 可用 Skills` 段,修复前漏)。断言计数 217→221
- selftest `sec-20` 补 longest-match 表驱动断言(glm-4.6 命中 `glm-4.[6-9]` / qwen2.5-1m 命中 1m 条目 / 未知模型走 DEFAULT_CAPS)。断言计数 680→683
- selftest `sec-30` 补 cyrb53/hashValue 白盒断言(确定性 + 雪崩 + 碰撞抽样)。断言计数 683→688
- selftest `sec-21` 补 `computeMaxIterations` 白盒断言(默认 / 小 / 大 maxToolRounds / 显式覆盖)。断言计数 688→692
- selftest `sec-21` 补 `mergeSummarySegments`/`parseSummarySegment`/`renderSummarySegment` 白盒断言。断言计数 692→696
- selftest `sec-21` 补 `composeMiddlewareStack` 排序白盒断言(含 sdk-events 最末,锁死 9999 bug 不回归)。断言计数 696→699
- selftest `sec-19`/`sec-21`/`sec-24`/`sec-31` 补 expose-schema(`describeSchemaNode`/`extractSchemaHint`/`schema_data`)+ evolve(`history_data`/`read` 多路径+分页/`write` dryRun/`eval` 子树/`diffObjects`+`diff_data`)+ unify-error(`routeError`/`asAgentError`)断言;工具数 13→16。断言计数 699→768
- e2e `systemprompt.mjs` 补「可操作数据」段字段约束标注;`inspect.mjs` 补 simple 7 工具集 + advanced 16(含 `schema_data`/`history_data`/`diff_data`)计数 221→228
- selftest `sec-19`/`sec-31` 补 usageHints 分页提示 + read 概览去约束 + zod 兜底断言(refine);routeError 断言补扩展口注释(fix)。断言计数 768→772
- **browser E2E 修复**:`playwright.config.ts` webServer.env 注入假 `VITE_AI_API_KEY`/`VITE_AI_MODEL`,让 browser test 自包含(不依赖 .env;ChatOpenAI 构造需 apiKey 非空才发请求被 mock 拦截)。7/7 全过
- selftest `sec-31` 补 `isPathAllowed`/`getSchemaAtPath` discriminatedUnion 深层路径回归(8 断言)+ tags.0.name 严格 false(旧 bug 放行)。断言计数 780→782
- browser 新增 `nested-demo.spec.ts`(嵌套子路径写 + 确认 gating + checkpoint 回滚)+ `error-recovery.spec.ts`(SCHEMA_INVALID 回灌自纠)+ `rag-demo.spec.ts`(memory 异步注入 + 切库替换)+ page-demo offset·limit 翻页用例;`_helpers` clearStorage 入 clearChat。browser 7→15(连跑 2 次稳)

## [2.16.0] - 2026-07-31

### Added
- **complex 上下文预设**:新增 `contextPreset: 'complex'`(与 auto/conservative/aggressive 并列),面向多步复杂任务 / 大 JSON 操作 / 长流程编排 —— 最大保留窗口(`windowRatio=0.6`)+ 最晚触发压缩(`summaryThresholdRatio=0.7`)+ 最多召回(`recallTopK=5`)+ LLM 摘要;`preserveLastToolResults` 默认扩为 `['describe_data','read','query_data','search_data']`(跨轮保留更多工具结果)。预设机制为比例制(complex 按比例字段配置)
- **vfs JSON 感知工具**:新增 `vfs_json_read({ path, jsonPath? })`(vfs 文件内按 jsonPath 读 JSON 子树,文件非合法 JSON 返 `VFS_JSON_INVALID`)与 `vfs_json_patch({ path, patches })`(vfs 文件内原子 jsonPath patch:set/remove/merge/append 在 clone 上应用,任一失败整体不写回,原文件不污染);`vfs_write` 增 `jsonString?` 参数(true 时校验 content 合法 JSON,非法 `VFS_JSON_INVALID`)。适合在 vfs 内结构化读写大 JSON
- **vfs 三池分池**:vfs 内部按 path 前缀分三池独立 LRU —— `large_results/*`(offload 自动,4MB)/ `drafts/*`(draft_write 自动,2MB,前序 change 未实现,池空占位)/ userFiles(vfs_write 显式,2MB)。三池互不挤占(防 offload 大结果挤掉进行中草稿);`vfs.maxBytes` 默认 8MB(三池之和),`vfs.poolBytes` 可单独配置每池。读写跨池透明(API 不变)
- **offload 结构化元数据**:`offloadLargeResult` 返回 `OffloadResult`(`{ offloaded, content, path?, totalChars?, preview?, suggestedReadPlan? }`);大结果(>10000 字符)附 `suggestedReadPlan` 引导 LLM 分页 `vfs_read` 回读而非盲读
- **inspect().contextPreset**:`AgentInfo` 新增 `contextPreset` 字段,inspect 反映当前预设档位

### Changed
- vfs 工具族(`vfs_read`/`vfs_write`/`vfs_edit`/`vfs_ls`/`vfs_glob`/`vfs_grep`/`vfs_json_read`/`vfs_json_patch`)source 标记由 `'user'` 修正为 `'builtin'`(vfs 是内置中间件,此前经 middleware.tools 注入,inspect().tools 里误标 'user')

### Tests
- selftest 新增 `sec-33`(vfs JSON 工具 + 三池分池独立 LRU + offload 结构化元数据);`sec-21` 补 complex 预设 + `PRESET_PRESERVE`;`sec-02` offload 断言适配 `OffloadResult`。断言计数 642→680
- e2e inspect().tools 含 vfs_json_read/vfs_json_patch(source=builtin)+ inspect().contextPreset(auto/complex)。计数 212→217

## [2.15.1] - 2026-07-31

### Fixed
- **数组子项删除产生稀疏数组**:`delete_data` / `write(del)` / `edit(remove)` / `eval(patches remove)` 删数组元素(如 `components.0`)时,底层 `deleteByPath` 对数组元素用 `delete arr[i]`,留下 empty 槽(length 不减、元素不前移、`JSON.stringify` 渲染成 null,污染序列化 / `hashValue` / 持久化与 Vue reactive 渲染,LLM 删后 read 见 length 不符)。修复:父为数组且末段为数字索引时改用 `splice` 移除,一处改四入口自动修正;对象属性删除仍走 `delete`(语义不变)。schema `.min(n)` 约束此前因 length 不减形同虚设,修复后能正确拦截删过头
- **白名单绕过(set_data / write(set) 未声明字段写回)**:schema 为 `ZodObject` 子集时顶层声明 key 是读写白名单(2.4+ 安全卖点),但 `set_data` / `write(set)` 在 `safeMerge`(只写声明字段)后,额外把 LLM 原始 `parsed` 里未声明字段直接赋值回 bind(无 schema 校验、无 `UNSAFE_KEYS` 过滤)—— LLM 在 value 里塞任意未声明字段就能写进 bind。修复:删除两处逐字相同的"未声明字段写回"块,bind 严格只接受 schema 声明字段;`interceptors.write` 转换/审计/拒绝已声明字段值的能力不变,但不再能绕白名单塞字段(可写字段请在 schema 声明)。安全默认收紧,属补漏校验(非破坏)

### Tests
- selftest:`sec-30.ts` 补 `deleteByPath` 数组 splice 白盒(length 递减 / 元素前移 / 无 empty 槽 + applyPatchToClone/Live remove 数组分支 + 对象 delete 语义不变);`sec-21.ts` 原白名单写回断言反转(未声明字段被挡,2.15.0 的"修复2"收窄)+ 三入口(delete_data / write del / edit remove)数组删除黑盒 + 连续删到 0 无空位。断言计数 630→642
- e2e:`tests/e2e/data-slots.mjs` 补"数组子项删除 length 递减、连续删到 0 无空位"(dist 层)。断言计数 210→212

## [2.15.0] - 2026-07-31

### Added
- **浏览器 E2E 测试层(Playwright + mock LLM)**:新增 `tests/browser/` 目录,7 项确定性浏览器测试,覆盖 page-demo(read→write→read)/ human-confirm-demo(两层确认:主动征询→选方案→写前确认→允许/拒绝)/ complex-demo(列组件+edit patch 改 style+子路径读+fields 裁剪)。核心:`_helpers.ts` 的 `mockLlm()` 用 `page.route()` 拦截 LLM API 端点,按脚本返回 OpenAI 兼容 SSE 流(tool_calls + 文本),使 agent ReAct 循环确定性走完,不依赖真 LLM,可进 CI。`playwright.config.ts` 已内置 `PLAYWRIGHT_BROWSERS_PATH`,零配置。新增 `npm run test:browser` / `test:browser:ui` 脚本
- **`.claude/` 项目级 AI 工具链**:新增 12 个 skill(review-bugbot/review-security/create-skill/create-rule/create-hook/split-to-prs/babysit/webapp-testing/frontend-design/everything-claude-code/mcp-builder/check-res-urls/mermaid-to-png)+ 3 个 command(`/review` `/test-all` `/browser-test`)+ 更新 `browser-tester` agent(双模式:交互式探索 + 自动化回归)+ `.mcp.json` 新增 `fetch` MCP server(网页抓取,查文档用)
- **`doc/refactor-selftest.md`**:refactor-module-extraction 自测记录文档(Step 1 自动化门禁 + Step 2 浏览器探索 + Step 3 高风险项验证,全部通过)

### Fixed
- **write 工具单 patch edit + 透传拦截器 → SCHEMA_INVALID**:`write({ value, patch })` 时,拦截器收到 `{ op, jsonPath, value }` 对象,若原样返回(透传),`payload = intercepted` 把整个对象当 value 写入 → schema 校验失败。修复:拦截器返回 `{ op, jsonPath, value }` 时取 `.value` 并同步 `patch.op/jsonPath`;返回纯值时直接用。新增 selftest 断言(sec-21.ts,631 项,原 630 +1)

### Changed
- **CLAUDE.md**:新增 §2.5 浏览器 E2E 测试层 + 测试矩阵加 `npm run test:browser` 列 + 发布前必跑顺序加 browser + Skills/Commands 表更新(含 browser-e2e-testing skill 和 /browser-test 命令)

## [2.14.0] - 2026-07-31

### Added
- **按需引入 subpath exports**:`package.json` `exports` 新增三个 subpath 入口 —— `./storage`(持久化层:`createSessionStore`/`createMemoryBackend`/`createWebStorageBackend`/`isQuotaError`)、`./query`(JSON 查询/沙箱:`jpEval`/`searchJson`/`runSandboxedScript` + jsonUtils/schemaUtils 全部纯函数)、`./llm`(代理连接:`createProxyLlm` 防 apiKey 泄露)。三个 subpath 指向同一 dist + types(不动构建),实际体积靠 bundler tree-shaking(已设 `sideEffects`)。语义清晰 + CDN 可按需入口;顶层 `.` 入口不变(向后兼容),未来切多入口构建时 import 路径零迁移
- **新增顶层导出**:`jsonUtils` 16 个纯函数(`getByPath`/`setByPath`/`deleteByPath`/`deepClone`/`safeStringify`/`hashValue`/`applyPatchToClone`/`applyPatchToLive`/`restoreLive` 等)+ `EditOp` 类型;`schemaUtils` 6 个 schema 白名单函数(`getSchemaTopKeys`/`isPathAllowed`/`unwrapSchema`/`getSchemaAtPath`/`projectBySchemaDeep`/`projectBySchema`);`promptBuilder` 的 `buildSystemPrompt`/`buildDataPrompt`/`DEFAULT_SYSTEM_PROMPT`;期二补充:`contextIndex` 纯函数(`tokenize`/`estimateMessageTokens`/`estimateRoundTokens`/`indexSummarize`/`recallRounds` + `STOP_WORDS`)、`llmResolver`(`isChatModel`/`resolveLlm`)、`conflictManager`(`createConflictManager` + `ConflictManager` 类型);期三:`optionsResolver`(`resolveStorage`/`resolveDialogConfig`)、`events`(`createSdkEvents` + `SdkEvents`)

### Changed
- **模块抽离(refactor-module-extraction 期一,纯重构零行为变化)**:`dataOps.ts` 的 16 个零依赖纯函数抽离至 `tools/jsonUtils.ts`、6 个 schema 白名单投影函数抽离至 `tools/schemaUtils.ts`;`createChatSdk.ts` 的 `DEFAULT_SYSTEM_PROMPT`/`buildDataPrompt` + 新增 `buildSystemPrompt` 统一入口(处理 `appendReliableWriteRules` 分支 + `---` 分割线,纯函数结构化参数)抽离至 `sdk/promptBuilder.ts`。为后续 change(cyrb53/diffObjects → jsonUtils;describeSchemaNode → schemaUtils;getEffectiveSystemPrompt 复用 buildSystemPrompt)建好骨架
- **模块抽离(refactor-module-extraction 期二,纯重构零行为变化)**:`useContextManager.ts` 的 6 个纯函数(分词/估算/摘要/召回)抽离至 `composables/contextIndex.ts`;`createChatSdk.ts` 的 `isChatModel`/`extractText`/`buildSummaryLlmInvoke` + 新增 `resolveLlm`(封装 modelCaps + summaryLlmInvoke 解析)抽离至 `sdk/llmResolver.ts`;`pendingConflict`/`setPendingConflict`/`resolveConflict` 冲突状态机抽离为 `sdk/conflictManager.ts` 的 `createConflictManager` 工厂(emit getter 延迟求值,适配 emit 晚于工厂定义的闭包时序)。`createChatSdk.ts` 1724→1631 行、`useContextManager.ts` 321→235 行。**skillStore 桥接评估延后**(`userSkills` 被 12+ 处引用 + skillsMw/core.infoTick 闭包时序交错,完整抽离风险 > 收益,留期三/独立 change)
- **模块抽离(refactor-module-extraction 期三,纯重构零行为变化)**:`resolveStorage`/`resolveDialogConfig` 抽离至 `sdk/optionsResolver.ts`;`listeners`/`emit`/`hook` 事件系统抽离为 `sdk/events.ts` 的 `createSdkEvents` 工厂(`createSdkEventMiddleware`/`matchDataOp` 仍留 createChatSdk,依赖 messages/liveData/usage 闭包)。`createChatSdk.ts` 1631→1613 行

### Tests
- 新增 `sec-30.ts`(jsonUtils 白盒 ~46 断言:路径/克隆/序列化/投影/patch/还原 + 原型污染防护)+ `sec-31.ts`(schemaUtils + promptBuilder 白盒 ~26 断言)+ `sec-32.ts`(contextIndex + conflictManager 工厂白盒 ~21 断言:set/resolve 状态机 + 并发覆盖兜底 + conflict 事件外发)
- `tests/exports-consistency.mjs` 加 subpath 配置断言(1→6)
- selftest 断言计数 537→630(期一 sec-30/31 + 期二 sec-32;期三 events/optionsResolver 纯重构经 e2e events/storage 模块覆盖,无新增白盒)

## [2.13.0] - 2026-07-31

### Added
- **`memory` 支持异步函数 source(RAG)**:`options.memory` 与 `sdk.setMemory(source)` 现支持三种形态 —— `string`(静态文本)/ `() => string`(同步求值)/ `() => Promise<string>`(异步求值,适合加载 RAG 文档)。异步函数在首次 `beforeAgent` 后台求值并缓存,`sdk.refreshMemory()` 可强制重新求值(文档更新后刷新)。求值失败降级空串(不阻塞 agent)。函数 source 不可序列化,落盘的是已解析文本;reload 时 `options.memory` 仍是函数会重新求值
- **`sdk.refreshMemory()`**:重新求值当前 memory 函数 source,返回最新文本;字符串 source 直接返回当前值
- **`createMemoryMiddleware` / `MemorySource` 类型从入口导出**:供自定义中间件场景复用
- **`rag-demo` 示例**:`examples/rag-demo/` 演示 memory 异步加载知识库 + 切换知识库 + 强制刷新

### Changed
- `minimal-demo` / `headless-demo` / `rag-demo` 导入改为 `../../src/core`(源码直连,避免 dev 模式预打包 dist 旧版缓存问题);mount 改用 CSS 选择器字符串(`'#chat-root'`)
- `demo/npm-local/node_modules/page-agent-sdk/dist` 同步到最新构建(供 `demo/plain.html` CDN 集成示例使用)

### Docs
- `doc/usage-guide.md` §6.4 Memory 章节补充异步函数 source 说明 + 三种形态对比表 + 缓存策略
- `doc/usage-guide.md` §6.11 便捷 API 表 `setMemory` 行更新 + 新增 `refreshMemory` 行 + 场景 3.5 RAG 代码示例
- `README.md` / `README.zh-CN.md`:便捷 API 注释更新 + Examples 表新增 `rag-demo` + 测试徽章 537
- `skills/page-agent-sdk-integrate`:`api.md` 表与 `advanced.md` §3.5 同步异步 memory + RAG 示例
- `CLAUDE.md`:setMemory 描述更新 + 测试计数 537

### Tests
- `sec-29.ts` 新增 memory 异步函数 source 单元断言(同步求值/缓存/refresh/异步求值/缓存/reset 切换/求值失败降级)
- `sec-07.ts` `beforeAgent` 调用改为 `await`(适配异步 beforeAgent)

## [2.12.2] - 2026-07-30

### Added
- **`mount()` 支持传参(异步绑定容器)**:`mount(overrideContainer?: HTMLElement | string)` —— 创建 `createChatSdk` 时可省略 `container`,在 `mount()` 时才指定(传 DOM 元素或选择器字符串),覆盖 `options.container`。适合「先初始化 agent(预加载/恢复持久化),稍后再挂载到 UI」场景。向后兼容(不传参 = 用 `options.container`)
- **LLM 特殊传参透传(`#8`)**:`LLMConfig` 新增 `extraBody`(透传 ChatOpenAI `modelKwargs`,合并到请求 body,如 deepseek thinking: `{ thinking: { type: 'enabled' } }`)+ `extraConfig`(透传 `configuration` 额外字段,如 headers/timeout/customFetch,与 baseUrl 合并)。三处构造 ChatOpenAI 全部透传:主 LLM / 摘要 LLM / `setLlm` 运行时切换。`CreateAgentOptions` 同步加两字段

### Changed
- `examples/dynamic-demo/App.vue`:示范 `mount(root.value!)` 异步绑定容器(创建时不传 container,mount 时传 DOM 元素)

### Docs
- `doc/问题.md` #8 状态更新为「2.12.2 做」+ 实现说明

## [2.12.0] - 2026-07-30

### Added
- **运行时动态重配置(`add-dynamic-reconfiguration`)**:运行时增删工具 / 切换 LLM / 更新 memory / 增删预声明子 agent,无需重建 agent(保留对话历史与中间件状态),全程零破坏(不调用 = 现状行为)
  - `sdk.setTools(tools)` / `addTool(tool)` / `removeTool(name)`:运行时增删**用户工具**(内置工具由 `capabilities` 控制,不动);内部 `rebindTools` 重新绑定到 LLM,下一轮即生效。支持按权限/业务阶段/A-B 实验动态切换工具组
  - `sdk.setLlm(llm)`:运行时切换 LLM(配额耗尽切便宜模型 / 复杂任务切强模型 / 切 provider);参数 `BaseChatModel` 或 `LLMConfig`(内部构造 `ChatOpenAI`);rebind + 重解析模型能力(`contextWindow`/`maxOutputTokens`);`summaryLlm` 不受影响;新模型不支持 `bindTools` 则工具调用失效(agent 不崩)
  - `sdk.setMemory(text)`:运行时更新持久指令 memory(下一轮 `augmentPrompt` 注入最新;`setMemory('')` 清空)
  - `sdk.setSubagents(configs)` / `addSubagent(config)` / `removeSubagent(id)`:运行时增删预声明子 agent(经 `SubagentsController` 重新生成 `use_<id>` 委派工具 + 触发 rebind);需创建时配 `subagents:[]`(空数组也启用 controller,支持「初始无子 agent,运行时动态 add」)
  - 所有 setter 触发 `infoTick++` → DebugDrawer 实时刷新;`inspect()` 的 tools/model/memory/subagent.subagents 经 getter/`controller.get()` 动态取最新
  - 详见 `doc/usage-guide.md` §6.11、`skills/page-agent-sdk-integrate/references/advanced.md` §6、`openspec/changes/archive/2026-07-30-add-dynamic-reconfiguration/`
- **`complex-demo` 动态重配置演示面板(`examples/complex-demo/DynamicReconfigPanel.vue`)**:一次性展示 4 类新增 API 的使用场景与说明文档(工具/LLM/memory/子 agent 动态化),含实时 `inspect()` 快照 + 操作日志(before→after);demo 顺带配 `subagents:[]` 占位启用 controller

### Changed
- **`subagentsMw` 创建条件**:`options.subagents?.length`(空数组 falsy)→ `useSubagent && options.subagents !== undefined`,使 `subagents:[]` 也能创建 `SubagentsController`(支持「初始无子 agent,运行时动态 add」场景)
- **`createAgent` 内部**:`allTools`/`llmWithTools`/`llm` 改 `let` + 新增 `rebindTools()`;返回对象 `allTools` 改 getter(setTools/setLlm 重赋值后 inspect 取最新);新增 `setTools`/`setLlm` 方法 + `onLlmChange` 回调选项
- **`memory` 中间件**:新增 `get()` 方法(供 `inspect().memory` 反映运行时 `setMemory` 后的最新)
- **`SubagentInfo` 类型**:新增 `subagents?` 字段(预声明子 agent 列表,动态反映 setSubagents/addSubagent/removeSubagent)
- **导出**:新增 `SubagentsController` 类型导出

### Docs
- `doc/usage-guide.md` 新增 §6.11「运行时动态重配置」(API 表 + 4 个场景代码示例)
- `doc/architecture.md` ⑨ 子 agent 小节补「运行时动态重配置」机制说明
- `doc/system-prompt.md` B4 memory 段标注「运行时可经 `sdk.setMemory` 更新」
- `doc/roadmap.md` #5 标记「✅ 已完成(归档)」并简化为指引(详情在 openspec archive)
- `doc/问题.md` #5 移除(已完成),决策汇总表同步
- `README.md` / `README.zh-CN.md` 便捷 API 注释补 8 个 set*/add*/remove* 方法;测试徽章计数修正(→ 524);e2e 覆盖描述补「运行时动态重配置」
- `skills/page-agent-sdk-integrate/references/api.md` API 表补 8 个动态方法 + 「Runtime dynamic reconfiguration」章节
- `skills/page-agent-sdk-integrate/references/advanced.md` 新增 §6「Runtime dynamic reconfiguration」(代码示例 + 缺失项说明)
- `skills/page-agent-sdk-integrate/references/options.md` `subagents` 选项补注「传 [] 启用 controller 支持运行时动态 add」
- `CLAUDE.md` 测试计数 495→524 / 189→210;新增「运行时动态重配置」API 说明;SDK 用法示例补 setTools/setLlm/setMemory/setSubagents + subagents:[];Agent 身份职责分工提及「运行时资源动态加载/卸载」

### Tests
- selftest 495→524(+29,新增 `sec-29` 模块:tools/subagents/llm/memory 动态化单元断言)
- e2e 189→210(+21,`inspect.mjs` 增 setTools/addTool/removeTool/setSubagents/addSubagent/removeSubagent/setLlm/setMemory 反映断言 + 未配 subagents 时 setter warn 不抛错)

## [2.11.0] - 2026-07-28

### Added
- **代理连接模块(`createProxyLlm`)**:统一管理 LLM 接入,支持两种模式,dev/prod 切换不改代码结构
  - `proxy` 模式(上线用):浏览器只持 `userToken`,服务端注入真实 `apiKey` 转发到 LLM API,防 apiKey 泄露;支持 `refreshToken`(401 自动刷新重试一次)、自定义 `headers`
  - `direct` 模式(开发用):浏览器持真实 `apiKey` 直连 LLM API(仅开发环境,生产环境 warn 提醒)
  - 返回 `BaseChatModel` 实例,直接传 `createChatSdk({ llm })`;`summaryLlm` 也可用同工厂走代理
  - 兼容性:自定义 fetch 经 `configuration.fetch` 透传 OpenAI client(已验证 @langchain/openai 1.5.x);兼容 `string|URL|Request` 入参;401 重试仅对可重复发送的 body(string/ArrayBuffer/Blob/FormData/URLSearchParams),ReadableStream 跳过避免已消费;token 刷新单例锁防并发重复刷新
  - 详见 `doc/usage-guide*.md` §8.6
- **代理示例(`examples/proxy-demo/`)+ mock 代理 server(`scripts/proxy-mock-server.ts`)**:完整可运行演示,浏览器只持 userToken,代理注入真实 key 转发;含 token 过期自动刷新演示;`npm run proxy:mock` 启动

## [2.10.3] - 2026-07-28

### Fixed
- **README 链接 404**:`README.md`/`README.zh-CN.md` 中相对链接(`./README.zh-CN.md`、`./CLAUDE.md`、`./LICENSE`、`./doc/*.md`)在 npm 站点解析为 `npmjs.com/package/...` → 404;改为 GitHub 绝对 URL(`https://github.com/whyymj/page-agent-sdk/blob/master/...`),npm 与 GitHub 均可正确跳转

## [2.10.2] - 2026-07-28

### Fixed
- **`dialogCfg` 作用域 bug**:`resolveDialogConfig` 返回值原误置于 `buildCore` 作用域,`mount` 函数(在 `createChatSdk` 作用域)引用 `dialogCfg` 致 `ReferenceError: dialogCfg is not defined` → 聊天框不渲染;现移至 `createChatSdk` 作用域修复
- **输入框可拖拽**:`resize: vertical` 支持拖拽右下角调整高度(上限 50vh);`inputRows` 默认 2 行
- **ChatDialog 样式优化**:`chat-header`/`chat-footer` 添加 `flex-shrink: 0`(textarea 撑高时由 chat-body 吸收,避免容器竖向滚动);footer 添加 `padding-bottom` safe-area 间距

## [2.10.0] - 2026-07-28

### Added
- **`dialog` 归组配置**:对话框 UI 配置(`title`/`placeholder`/`drawer`/`drawerWidth`/`drawerHidden`/`inputRows`/`onClose`)归组到 `dialog` 字段,API 更整洁;**扁平写法已移除**(不再支持顶层 `title`/`placeholder`/`drawer`/...)
- **`inputRows` 默认改 2 + 可拖拽**:输入框默认 2 行初始高度(原 1 行),更易输入多行内容;`resize: vertical` 支持拖拽右下角调整高度(上限 50vh);仍自动扩展
- **`drawerWidth` 选项**:抽屉模式自定义聊天框宽度(像素或 CSS 字符串,如 `500` / `'500px'` / `'40vw'`);默认 420px;仅 `dialog.drawer: true` 生效
- **`drawerHidden` 选项**:抽屉模式默认隐藏(`mount` 后不显示,需 `sdk.show()` 才出现):适合「点击按钮才出现聊天框」场景;仅 `dialog.drawer: true` 生效
- **Skill 独立持久化(SkillStore)**:用户创建的 skill 不再随 `SessionSnapshot` 持久化,改由独立 `SkillStore` 管理(`backends/skillStore.ts`)
  - **默认 indexedDB**:即使 `storage:false`(会话持久化关闭),用户 skill 仍持久化,跨刷新恢复
  - **跨页面/跨 agent 复用**:新增 `skillStorage` 选项,手动指定同一 `id` 即可让多个 `createChatSdk` 实例(不同 agentId)共享同一套用户 skill;不传 `id` 默认按 `agent::{agentId}` 隔离
  - `skillStorage: false` 关闭持久化(仅当前会话内存有效)
- **`sdk.getUserSkill(name)`**:读取用户创建的 skill 详情(返回 `{name, description, content}` 或 `undefined`),供 SkillPanel 编辑
- **SkillPanel 编辑能力**:点击已创建 skill 加载到表单编辑(名称锁定不可改,描述/内容可改),保存调 `sdk.addSkill`(同名覆盖 = 编辑)
- **`SkillStoreConfig` 类型 + `createSkillStore` 导出**:集成方可独立构造 SkillStore 自定义 UI/管理
- **ChatDialog 样式优化**:`chat-header`/`chat-footer` 添加 `flex-shrink: 0`(textarea 撑高时由 chat-body 吸收,避免容器竖向滚动);footer 添加 `padding-bottom` safe-area 间距

### Changed
- **`SessionSnapshot` 移除 `skills` 字段**:用户创建 skill 不再随会话快照持久化(改由独立 SkillStore);`SNAPSHOT_KINDS` 由 5 项减为 4 项(messages/vfs/todos/memory)
- `PersistedSkill` 接口标记 `@deprecated`(保留仅为类型兼容,不再写入 SessionSnapshot)
- `applySnapshot` 不再恢复 skills(由 `loadUserSkillsFromStore` 在 init 时从 SkillStore 加载)
- **移除扁平写法(破坏性)**:`title`/`placeholder`/`drawer`/`drawerWidth`/`drawerHidden`/`inputRows`/`onClose` 不再支持顶层传入,统一改用 `dialog: { ... }` 归组(减少历史包袱)
- IIFE 体积阈值 1.6MB → 1.7MB(SkillPanel/skillStore 新增代码致全量包略增)

### Fixed
- **`dialogCfg` 作用域 bug**:`resolveDialogConfig` 返回值原误置于 `buildCore` 作用域,`mount` 函数(在 `createChatSdk` 作用域)引用 `dialogCfg` 致 `ReferenceError: dialogCfg is not defined` → 聊天框不渲染;现移至 `createChatSdk` 作用域修复

## [2.9.1] - 2026-07-27

### Docs
- **对接提示词通用模板**:新增 `skills/page-agent-sdk-integrate/references/integration-prompt.md`(进 npm 包,英文),供集成方复制给对接项目的 AI(Cursor/Claude Code)按流程集成;README 中英 + SKILL.md + CLAUDE.md 补充"对接提示词推荐"段
- 新增 `doc/集成提示词-Vue2-低代码页面-抽屉.md`(中文特定场景示例,仓库内)

## [2.9.0] - 2026-07-27

### Fixed
- **schema 白名单子路径投影**:`read components.0` 等子路径读现按该位置的子 schema 递归投影(隐藏 child 未声明字段);原仅顶层投影,子路径泄露 child 不可见字段
- **`isPathAllowed` 逐段校验**:`jsonPath` 逐级检查每段在 schema 声明内(防子路径绕过顶层白名单);`unwrapSchema` 支持 ZodLazy 解包(递归 schema)
- **`set`/`write(set)` 整对象 + `interceptors.write` 补充不可见字段写回 bind**:原 schema strip + safeMerge 丢失补充字段;现从原始 parsed 取不在 allowKeys 的字段写回(信任集成方拦截器/用户显式传值)

### Added
- **ChatDialog 抽屉模式**(`drawer: true`):右侧滑出 + 遮罩 + 关闭按钮(替代折叠箭头);关闭默认 `hide()` 保留历史与生成进程
- **`sdk.hide()` / `sdk.show()`**:不卸载 Vue 应用与 agent,仅加 `cs-hidden` 类隐藏;`mount()` 对已挂载隐藏实例幂等调 `show()`
- **动画**:展开/收起、卸载退出、挂载进入(抽屉滑入)三类 CSS 过渡
- **`onClose` 选项**:自定义关闭行为;抽屉模式默认 `hide()`,非抽屉默认 `unmount()`
- `animation-demo`(动画 + hide/show)、`multi-agent-demo`(多 agent 并行 + 互斥切换)
- `EditableBanner` 标识 AI 可编辑区、`DevNav` 折叠下拉

## [2.8.0] - 2026-07-27

### Added
- **`sdk.setSkills(skills)`**:运行时替换整个 skill 列表(同名覆盖);下轮 system prompt skill 索引段重渲染,清 skill 全文缓存,下次 `load_skill` 取最新全文(含 vfs doc)
- **`sdk.invalidateSkillCache(name?)`**:动态 skill 内容变化时主动失效缓存(不传清全部,传 name 清指定)
- **`sdk.exportData()` / `sdk.importData(data)`**:导出/导入主数据 `bind` 的深拷贝
- **`sdk.usage`**:累计 token 用量 `{prompt_tokens, completion_tokens, total_tokens}`
- **`onAudit` 选项**:结构化审计回调(set/edit/delete/restore)
- **`session_restored` 事件**:会话恢复时触发
- **skill 全文缓存**:`SkillsController` + `contentCache`,跨轮不重复 load 同一 skill;`offloadLargeResult` 内容寻址去重(VFS 不重复存同一内容)
- **`infoTick`**:DebugDrawer 实时刷新(动态 skill/data 变化反映)

## [2.7.1] - 2026-07-27

### Docs
- README 中英补充「schema / systemPrompt / skill 三层配合」设计思路章节

## [2.7.0] - 2026-07-27

### Changed
- **`appendReliableWriteRules` 默认改 `true`**:自定义 `systemPrompt` 时自动追加 `reliableWriteRules`(改前先 read、字段以 describe 为准、写错看校验错误重试、优先增量 patch),用 `\n\n---\n\n` 分隔线明确区分用户内容与 SDK 追加

## [2.6.1] - 2026-07-26

### Docs
- 所有 demo 展示 `appendReliableWriteRules: true` + 注释说明

## [2.6.0] - 2026-07-26

### Added
- **`appendReliableWriteRules` 选项**:自定义 `systemPrompt` 时自动追加 `systemPromptHelpers.reliableWriteRules`(默认 false,2.7.0 改 true)

## [2.5.1] - 2026-07-26

### Fixed
- **verify/checkpoint 支持单对象 data 模型**:`createWriteBackCheck` 加 `root` 选项、`createCheckpointManager` 加 `getData` 选项,`createChatSdk` 传 `root: () => liveData()?.bind` / `getData: () => liveData()?.bind`(原误读 `globalThis.window` 致单对象 data 校验/回滚失效)
- skills 重写 + 文档同步

## [2.5.0] - 2026-07-26

### Added
- **schema 形状自动白名单**:`data.schema` 为 `ZodObject` 时,顶层声明 key 自动作为可读写白名单(`read` 整体按 schema 投影隐藏未声明字段;`write`/`edit`/`delete` jsonPath 顶层段必须在白名单内否则 `PATH_DENIED`;整体 set 转 merge 语义防误删)
- **`write` 批量 `patches`**:一次原子应用多个 patch,任一失败整体回滚
- **`read` 字段裁剪 + 深度截断**:`read({ jsonPath, fields, depth })` 支持字段投影 + 深度截断瘦身大返回
- **`eval_script` 增量 transform**:沙箱脚本返回 transform 函数增量改 bind
- **`allowPaths` 选项**:细粒度 per-path 权限

### Fixed
- 记忆系统:`trimToolResults` 死代码移除;`summarization` 与 `trimMemoryMessages` 双摘要合并;`getRegisteredSlots` 术语更新为 `getRegisteredData`

## [2.4.1] - 2026-07-26

### Fixed
- 修复代码层旧名残留(window* → dataSlot*/slot* 重命名遗漏)
- examples 非 Vue 场景改造(普通对象 bind + onEvent tick 重渲染)

## [2.4.0] - 2026-07-26

### Breaking(统一配置:删 `io`/`bind` 顶层选项,并入 `dataSlots`;按 minor 发布,不升 major)
- **删除 `io` 顶层 IO 契约选项**:不再支持 `io.input`/`io.output`。原能力(从 zod schema 自动提取字段说明注入 systemPrompt)由 `dataSlots[].schema` 的 `.describe()` 自动承担 —— SDK 现扫描所有 `dataSlots` 的 schema,经 `extractSchemaHint` 提取字段说明,注入 systemPrompt「可操作属性」段(取代原「输入/输出契约」段)
- **删除 `bind` 顶层响应式直连选项**:不再支持 `bind: { key: obj }`。原能力(reactive/普通对象直连 + 自动挂 window + 注册 dataSlot)由 `DataSlotSpec.bind` 字段承担 —— `dataSlots: [{ path, schema, bind: obj }]`,SDK 自动 `window[path] = bind`(支持点号 path) + 注册为 dataSlot
- **`DataSlotSpec.description` 改为可选**:传了 `bind` 且未传 `description` 时,自动生成 `${path}(bind 直连)`;不传 `bind` 时建议仍写 `description`(否则用 `path` 兜底)
- **`DataSlotSpec` 新增 `bind?: any` 字段**:可选,传 reactive/普通对象 → 自动挂 `window[path] = bind` + 注册为 dataSlot;reactive 写后响应式刷新(推荐 UI),普通对象可写但不响应(适合 headless,集成方用 `onEvent`/`hook` 的 `data_slot_change` 通知)

### Migration(2.x → 3.0)
- `bind: { page: pageObj }` + `io: { output: PageSchema }` → `dataSlots: [{ path: 'page', schema: PageSchema, bind: pageObj }]`
- `io: { input: InSchema, output: OutSchema }`(无 bind)→ 把 OutSchema 放到对应 `dataSlots` 项的 `schema`(字段说明自动注入);`io.input` 的输入契约段无对应替代,需自行在 `systemPrompt` 用 `extractSchemaHint(InSchema)` 拼入(罕见场景)
- 仅用 `dataSlots` 不用 `io`/`bind` 的集成方 → 无需改动

### Fixed
- **`write` 高层工具不触发 `data_slot_change` 事件**(L2 遗漏):`matchWindowOp` 原只映射底层 `set`/`edit`/`delete`/`restore_data_snapshot`,未匹配 `write`(simple 默认主入口)→ 集成方 `onEvent`/`sdk.hook` 订阅 `data_slot_change` 收不到通知。现 `matchWindowOp` 加 `write` 分支,按 args 推断 operation(`del`→delete,`patch`→edit,否则 set),`wrapToolCall` 传 `ctx.args`。simple 默认模式下 `write` 改数据槽现能正确触发 `data_slot_change`。

### Docs
- `doc/usage-guide.md` / `doc/usage-guide.en.md`:删 `io`+`bind` 段,新增 `dataSlots` 统一配置段(3.0+,含 `bind` 字段 + schema `.describe()` 自动注入 + 不强制 reactive + 通知外界机制)
- `README.md` / `README.zh-CN.md`:配置示例删 `io`/`bind` 行,`dataSlots` 行补 `bind` 字段说明
- `skills/page-agent-sdk-integrate/references/api.md`:删 `io`+`bind` 段,新增 `dataSlots` unified config 段
- `CLAUDE.md`:删 `io`/`bind` 架构要点,合并为 `dataSlots` 统一配置段;examples 段各 demo 配置方式标注更新(3.0 dataSlots bind / dataSlots 细粒度 / 手动 toolset);e2e 描述更新
- `types/index.d.ts`:`DataSlotSpec` 加 `bind?`、`description?` 改可选;删 `ChatSdkOptions.io`/`ChatSdkOptions.bind`

## [2.3.0] - 2026-07-26

### Added(L3:顶层 IO 契约 + 响应式绑定 + input/output 拦截器,纯新增,不 breaking)
- **`io` 顶层 IO 契约**:声明 agent 的输入/输出 JSON 形状(zod schema),SDK 自动提取字段说明注入 systemPrompt(输入/输出契约段),集成方不用手写 description
  - `io.input`:agent 能读的明文 JSON 形状 → 注入 systemPrompt「输入契约」段
  - `io.output`:agent 能写的明文 JSON 形状 → 注入 systemPrompt「输出契约」段;兼作 `bind` 主对象 schema
  - 与 `dataSlots` 并存:`io` 是单主对象声明式快捷方式,`dataSlots` 是多 slot + 动态注册复杂场景
- **`bind` 响应式对象直连**:集成方直接把响应式对象绑给 sdk,每个 key 自动注册为 dataSlot(path=key, schema 从 io.output 推断或 z.any),底层挂到 window[key]
  - LLM write → 响应式对象自动更新;集成方改对象 → LLM read 可见
  - 底层仍走注册表 + schema 校验 + 乐观锁,不绕过安全边界
- **`interceptors.input`/`interceptors.output`**:agent 级 IO 预处理/后处理
  - `input(input)`:send 入口预处理 user message(可改写/审计)
  - `output(json)`:agent 返回前 postprocess(可改写最终回复)
- 新导出:`extractSchemaHint(schema)` 纯函数(从 zod schema 提取字段说明,供集成方预览 io 契约将注入的提示)

### Changed
- `inspect().systemPrompt` 现反映 io 契约拼接后的最终 systemPrompt(含输入/输出契约段)

### Migration
- 旧代码不传 `io`/`bind`/`interceptors.input`/`interceptors.output` → 行为不变
- 推荐新代码用 `io` + `bind` 声明式用法(单主对象场景),免手写 dataSlots description + 手动同步

## [2.2.0] - 2026-07-26

### Added(L2:分层工具呈现 read/write + toolMode + 拦截器,向后兼容)
- **高层读写工具 `read`/`write`**:合并 list/describe/get 与 set/edit/delete + 自动乐观锁 + 自动快照,降低 LLM 认知负担
  - `read({path?})`:不传 path 列出所有可操作槽;传 path 返回当前值 + hash + 格式说明
  - `write({path, value?, patch?, del?})`:三种意图——整体 set(value 直传 JSON 对象,如 `{title:"x"}`)/ 增量 patch(`{op,jsonPath}`,op=set/remove/merge/append)/ 删除(`del:true`)。写入自动经 schema 校验 + 自动存快照 + 自动乐观锁(autoLock)
- **`toolMode` 选项**(`simple` 默认 / `advanced` / `minimal`):控制数据槽工具呈现面
  - `simple`(默认):主推 `read`/`write`,隐藏底层 `get`/`set`/`edit`/`delete`/`list`/`describe`(6 个),保留 `query`/`search`/`eval`/`snapshot` 等高级能力(共 9 个数据槽工具)
  - `advanced`:全暴露(15 个数据槽工具,等价旧 13 + read/write)
  - `minimal`:只 `read`/`write`(2 个数据槽工具)
- **`interceptors` 选项**(读写拦截器):集成方可脱敏/转换/审计/拒绝 LLM 的读写
  - `read(path, value)`:LLM 读时拦截,可脱敏/派生(只改 LLM 看到的值,不改实际存储)
  - `write(path, payload, current)`:LLM 写时拦截,可转换/审计,返回 `{error}` 拒绝
- 新导出:`filterByToolMode(tools, mode)` 纯函数 + 类型 `ToolMode`/`DataSlotInterceptors`
- `usageHints` 中间件按 `toolMode` 注入提示(simple 主推 read/write,advanced 保留底层 get/set 提示)

### Changed
- `createDataSlotOps` 返回工具数 13 → 15(新增 `read`/`write`);`defineDataSlotToolset` 同
- `createUsageHintsMiddleware` 新增第三参数 `toolMode`(默认 `simple`,向后兼容)

### Migration
- 旧代码不传 `toolMode` → 默认 `simple`,inspect().tools 不再含底层 `get_data_slot`/`set_data_slot` 等(被 read/write 合并);若依赖底层工具名,显式传 `toolMode:'advanced'`
- 旧代码不传 `interceptors` → 行为不变
- 推荐新代码用 `read`/`write` + `toolMode:'simple'` + `interceptors`(脱敏/审计),LLM 认知负担最低

## [2.1.0] - 2026-07-26

### Added(L1:JSON 直传 + 自动乐观锁,零缩水,向后兼容)
- **JSON 直传**:`set_data_slot`/`edit_data_slot` 的 `value` 现接受 JSON 对象直传(推荐,如 `{title:"x"}`),无需 stringify;仍兼容 JSON 字符串(向后兼容)。LLM 出错率显著下降
- **自动乐观锁 `autoLock`**(默认 `true`):写入时若 LLM 未显式传 `expectedHash`,自动用「LLM 最后一次 `get_data_slot` 读到的 hash」作基准比对,冲突走 `onConflict`(无则返回 `VERSION_CONFLICT`)。LLM 无需手动传 hash 即享乐观锁保护;设 `autoLock:false` 回退「不传 = 不校验」旧行为
- `DataSlotOpsOptions`/`ChatSdkOptions` 新增 `autoLock?: boolean` 字段

### Changed
- `get_data_slot` 内部记录 LLM 最后读到的 hash(供 autoLock 比对),返回格式不变

### Migration
- 旧调用传 JSON 字符串仍工作(向后兼容)
- 若依赖「不传 expectedHash = 不校验」的旧行为,显式设 `autoLock:false`
- 推荐新代码直接传 object + 依赖 autoLock,不再手动管理 hash

## [2.0.0] - 2026-07-26

### Changed (breaking — major)
- 全局命名去 `window` 化,改为 `dataSlot`/`slot`,体现「规范化 JSON 操作 Agent、前后端通用」定位(原 `window` 前缀暗示浏览器 window 对象,在 Node/服务端场景误导):
  - 配置项 `windowProps` → `dataSlots`;类型 `WindowPropInfo`/`WindowPropSpec`/`WindowOpsOptions`/`WindowOpsController`/`WindowAuditEntry`/`WindowSnapshotEntry` → `DataSlotInfo`/`DataSlotSpec`/`DataSlotOpsOptions`/`DataSlotOpsController`/`DataSlotAuditEntry`/`DataSlotSnapshotEntry`
  - 能力开关 `capabilities.windowOps` → `capabilities.dataSlotOps`
  - 工具名:`list_window_props`/`describe_window_prop`/`get_window_prop`/`set_window_prop`/`edit_window_prop`/`delete_window_prop`/`snapshot_window_prop`/`list_window_snapshots`/`restore_window_snapshot`/`get_window_paths`/`query_window_prop`/`search_window_prop`/`eval_window_script` → `list_data_slots`/`describe_data_slot`/`get_data_slot`/`set_data_slot`/`edit_data_slot`/`delete_data_slot`/`snapshot_data_slot`/`list_data_snapshots`/`restore_data_snapshot`/`get_slot_paths`/`query_data_slot`/`search_data_slot`/`eval_script`
  - 实例 API `addWindowProp`/`removeWindowProp`/`listWindowProps` → `addDataSlot`/`removeDataSlot`/`listDataSlots`;工厂 `createWindowOps`/`defineWindowToolset` → `createDataSlotOps`/`defineDataSlotToolset`
  - 事件 `window_prop_change` → `data_slot_change`
  - 文件 `src/core/tools/windowOps.ts`/`windowQuery.ts` → `dataSlotOps.ts`/`dataSlotQuery.ts`;`tests/e2e/window-props.mjs` → `data-slots.mjs`
  - 注:`getByPath(window, ...)` 等工具函数体内裸 `window` 仍指宿主浏览器 window(零桥接设计,不变);`contextWindow`(LLM 上下文窗口)不变
  - 迁移:集成方需把 `windowProps:` 改 `dataSlots:`、`capabilities.windowOps` 改 `capabilities.dataSlotOps`、`sdk.addWindowProp` 改 `sdk.addDataSlot` 等;工具名变更影响 LLM 调用,旧 systemPrompt 若硬编码旧工具名需同步

## [1.4.2] - 2026-07-25

### Fixed
- 剪贴板复制在非 secure context(HTTP / 非 localhost)失效:`navigator.clipboard` 为 undefined 或 `writeText` reject 时无降级 + 未 catch 致 unhandled rejection + 仍显示「已复制 ✓」误导。新增 `copyText` helper(Clipboard API 优先,失败降级 `document.execCommand('copy')`,失败返回 false 不误导),`MessageContent`/`CodePreview`/`ChatDialog`/`DebugDrawer` 四处改用
- shareContext 多实例并发冲突覆盖:`setPendingConflict` 直接覆盖 `pendingConflict.value`,后者覆盖前者致前者 `resolve` 丢失 → 前者工具调用永久挂起。覆盖前自动按 `keep_external` 收口旧冲突兜底
- `ChatSdk` 接口缺 `pendingConflict` / `resolveConflict` 声明(tsc 报错)
- `types/index.d.ts` 与 src 不同步:`pendingConflict` 裸值 → 同步为 `Ref<PendingConflict | null>`;补 `copyText` 导出声明

### Added
- 导出 `copyText` 工具函数(供集成方自建 UI 复制按钮复用,自动降级兼容非 secure context)

## [1.3.8] - 2026-07-25

### Added
- 导出一致性检查(`tests/exports-consistency.mjs`):静态分析对比 `src/core/index.ts` 与 `types/index.d.ts` 导出名集合,防 d.ts 脱节
- 类型测试基线(`tests/types.test-d.ts` + `tsconfig.test.json` + `test:types`):tsc --noEmit 验证 types 导出齐全 + 关键类型正确
- 补全 `types/index.d.ts` 缺失的 27 个导出(resolveContextOptions/ContextPreset/CONTEXT_PRESETS、connectMcp/extractText/McpTransport/McpConnection、Middleware/ModelRequest/ModelResponse/ToolCallContext/StateUpdate、createSubagentsMiddleware/SubagentOptions/SubagentLlmConfig、createVfs、ContextManagerOptions/CompressionStats、resolveModelCaps/estimateTokens/offloadThresholdChars/offloadPassThroughChars/ModelCaps 等)

### Fixed
- `types/index.d.ts` AgentInfo 后多余 `}` 致 tsc 报 TS1128(由类型测试基线首次跑发现)

## [1.3.7] - 2026-07-25

### Changed
- e2e 测试按模块拆分:单文件 `tests/e2e-integration.mjs` → `tests/e2e/*.mjs` 11 个主题模块 + runner 汇总
- 修正 `createAssert` 解构 bug(解构 pass/fail 取当时值不随 assert 递增,改用 ctx 引用末尾读 getter)

## [1.3.6] - 2026-07-25

### Added
- e2e 扩充至 120 项,覆盖各 API/配置项/功能模块/场景:导出项完整(39+ 函数/组件)、inspect 初始状态、storage 对象配置、presets 三预设、dataSlots 8 种 schema + 嵌套、动态注册与 inspect 同步、shareContext 开关、工具函数可用(isQuotaError/estimateTokens/jpEval/searchJson)、source=builtin、mount 边界、hook 多监听器、llm 配置

## [1.3.5] - 2026-07-25

### Added
- e2e 扩充至 86 项:自定义 tools/middleware/skills/memory 注入、inspect 反映配置(id/model/subagent/verify/mcp)、switchSession(开/未开)、restoreLastCheckpoint/listCheckpoints、导出项可用、配置项可传、shareContext 共享、storage 后端、presets

## [1.3.4] - 2026-07-25

### Added
- e2e 扩充至 48 项:inspect().tools 反映 dataSlotOps 开关 + 工具集完整性、inspect().middleware 反映 capabilities、预声明 subagents、默认 systemPrompt 含能力概述、自定义 + reliableWriteRules 拼接、onEvent + hook 联动

## [1.3.3] - 2026-07-24

### Fixed
- 修复 `createChatSdk` 顶层 `addDataSlot`/`removeDataSlot`/`listDataSlots` 作用域 bug(引用 buildCore 内部变量致运行时 ReferenceError)

## [1.3.2] - 2026-07-24

### Added
- e2e 集成测试(`tests/e2e-integration.mjs`):14 项,验证 createChatSdk 顶层 API(默认 systemPrompt/动态注册/inspect/hook)

## [1.3.1] - 2026-07-24

### Added
- `inspect().systemPrompt` 字段(供调试/验证默认提示词)
- `DEFAULT_SYSTEM_PROMPT`:未传 systemPrompt 时使用内置默认(含身份/能力概述/reliableWriteRules)

## [1.3.0] - 2026-07-24

### Added
- 运行时动态注册 `dataSlots`:`sdk.addDataSlot`/`removeDataSlot`/`listDataSlots`(懒加载组件场景)
- 压缩不丢信息保障(A/B/C/D):压缩注入注册表快照、写工具结果附 path 列表、preserveLastToolResults 可配、导出 `systemPromptHelpers.reliableWriteRules`
- `usageHints` 补 `list_data_slots`/`describe_data_slot`/`get_data_slot` 用法提示
- `examples/dynamic-demo/`:懒加载组件 + 动态注册 + onEvent 示例

## [1.2.0] - 2026-07-23

### Added
- `onEvent` 事件回调:订阅常用时机替代轮询(data_slot_change/message_update/tool_call/tool_result/text/round_start/done/error)
- `sdk.hook()` 实例方法:运行时动态订阅 SDK 事件(可多个监听器、可取消),与构造时 onEvent 互补
- 服务端(Node.js)兼容:mount/unmount 的 window/document 访问加 typeof 守卫

## [1.1.1] - 2026-07-22

### Changed
- skills 含入 npm 包 files(使用者可从 `node_modules/page-agent-sdk/skills/` 安装)

### Fixed
- release skill 改为维护者私有 —— 从公开 npm 包移除,仅留仓库 `.claude/skills/`

## [1.1.0] - 2026-07-22

### Added
- 两个项目 skill:`page-agent-sdk-integrate`(公开分发,集成 SDK)、`page-agent-sdk-release`(维护者自用,发布流程)
- 项目结构规范化:根目录 demo html 整理进各 `examples/<demo>/index.html`
- CLAUDE.md 补充完整发布流程 checklist(改代码→中英文文档→bump→build/test→推 gitee→推 github→发 npm→验证)

