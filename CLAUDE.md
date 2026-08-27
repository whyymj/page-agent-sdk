# CLAUDE.md

本文件为 Claude(及兼容 Agent)在本仓库工作时的项目指引,请先通读再动手。
**架构细节**(流程图/数据槽深潜/能力全景/鲁棒性契约)在 `doc/architecture.md`(①-⑮);本文件只留不可违背的契约与操作知识。改某模块前先读对应 doc 章节。

## 项目概述

`page-agent-sdk`(npm 包名,仓库目录仍名 `zhuanti-agent`)是**框架无关的 JS SDK**:对话框形态挂载到任意网页,内置 ReAct 模式 Tool-Calling Agent,通过自定义 tool 读写宿主页面数据(属性注册表 + schema 校验)、GET 抓取文档,具备 planning / skills / 内存工作区 / context 管理能力。

**定位:规范化的 JSON 操作 Agent** —— 给 AI 一个结构化、安全的 JSON 操作通道(范围控制 + schema 校验 + jsonPath 增量 patch + 快照回退),区别于「让 AI 直接输出 JSON 字符串」的不可控方式。采用**自研 Deep Agents 风格 harness**(不引入 LangGraph/langchain 整包)。

- 构建产物:`dist/page-agent-sdk.{js,umd.cjs,iife.js,css}` + `dist/page-agent-sdk.headless.js`(`/headless` 子路径,纯核心不含 UI)+ `dist/page-agent-sdk.legacy.js`(`/legacy` 子路径,**es2017 全量打包**,webpack≤4 宿主 `await import()` 懒加载;包根 `legacy.js`/`style.css` 物理转发文件 —— webpack4 enhanced-resolve 不认 exports map);类型声明 `types/index.d.ts` + `types/headless.d.ts`(**手动维护**);入口 `src/core/index.ts`(主,注入 UI)+ `src/core/index.headless.ts`(headless,不注入)+ `legacy.js`(根转发,webpack4 目录解析目标)

## Agent 身份

通用「JSON 操作助手」。systemPrompt 由 `createChatSdk({ systemPrompt })` 注入,不硬编码业务身份。
- **默认 systemPrompt**:用户不传时用内置 `DEFAULT_SYSTEM_PROMPT`(身份 + 能力概述 + `systemPromptHelpers.reliableWriteRules`,`---` 分隔);用户传了完全覆盖。`appendReliableWriteRules` 默认 `true`:自定义 systemPrompt 末尾自动追加写入规则;设 `false` 关闭(用默认 prompt 时无效,默认已含)。`createAgent` 层兜底 `'你是一个智能助手。'`
- **职责分工(重要)**:内置工具用法(read/write/get/set/patch/snapshot/query/search/eval 等)由 `usageHints` 中间件按能力开关自动注入运行时 prompt,**集成方 systemPrompt 只写业务知识**(身份、字段含义、业务流程、技能引用),不要重复声明工具语法。**动态组件说明/按运行时状态注入**走 `augmentSystem({ state, data })` 钩子(每轮调,setData 后 data 自动同步),见 `doc/system-prompt.md` B6 段

## 技术栈

- **框架**:Vue 3.5(打包进 SDK,对外框架无关;非 peer);**构建**:Vite 8 库模式;**语言**:TypeScript 7
- **AI**:LangChain **浏览器子包**(`@langchain/openai` + `@langchain/core` + `@langchain/anthropic` optional),兼容 OpenAI 协议(默认)+ Anthropic 协议(`LLMConfig.provider:'anthropic'` 动态 import 走 Claude 原生协议);`llm` 可传 `BaseChatModel` 实例或 `LLMConfig`。**不引 langchain 整包/LangGraph**
- **MCP**:`@modelcontextprotocol/sdk`(optional peerDep,动态 import;浏览器仅 http/sse/websocket 远程 transport)
- **校验**:zod 4;**Markdown**:`marked` + `highlight.js` + `dompurify`(打包进库,仅主包);**滚动条**:`overlayscrollbars` v2(主滚动面 overlay 自定义滚动条,仅主包)

## 常用命令

```bash
npm run dev       # 本地开发(端口 3000;被占则自动换)
npm run build     # 库模式构建到 dist/(lib + headless + iife 三产物)
npm run preview   # 预览构建产物
npm run test          # 自测(tsx 跑 src/__tests__/selftest.ts,3134 项断言)
npm run test:e2e      # 集成层 e2e(node 跑构建产物 dist,1020 项;tests/e2e/<module>.mjs 按模块拆分)
npm run test:browser  # 浏览器 E2E(Playwright + mock LLM 双协议拦截,132 项;tests/browser/<demo>.spec.ts)
```

## 环境配置

AI 配置通过 `.env`(前缀 `VITE_`):`VITE_AI_API_KEY` / `VITE_AI_BASE_URL` / `VITE_AI_MODEL` / `VITE_AI_TEMPERATURE`(操作大 JSON 建议低温 0.3)/ `VITE_AI_MAX_TOKENS` / `VITE_AI_SYSTEM_PROMPT`(必须单行)。Anthropic 协议另用 `VITE_ANTHROPIC_API_KEY` / `VITE_ANTHROPIC_BASE_URL` / `VITE_ANTHROPIC_MODEL`(rag-demo 走此组;dev 可经 vite 代理 `location.origin/llm` → 网关(目标随 .env 同步,现为 openhubs),**baseUrl 必须绝对 URL** —— @anthropic-ai/sdk buildURL 直接 `new URL(baseURL+path)`,相对路径抛 Invalid URL)。识图端点 `VITE_VISION_URL`(images-demo 的 describe 调用,analyze 形态 `{image:base64,mime}` → `{data:{description}}`;**内部接口地址只进本地 .env 勿入库**)。凭据只进 `.env`(gitignore),不进代码/仓库。

上下文压缩策略不经 `.env`,由 `createChatSdk({ contextOptions, summaryLlm, maxMemoryRounds, contextPreset })` 显式配置。

## 目录结构

```
src/core/                       # 通用 SDK 核心(框架无关)
├── harness/                    # 自研 agent harness:createAgent ReAct 循环 + 中间件
│   ├── (骨架) createAgent/middleware/state/errors/retry/budget/pool/serialRunner/checkpoint/humanConfirm
│   └── (能力) todos/skills/memory/permissions/summarization/subagent/verify/usageHints/focus/mission/workingMemory/resourcesPin/contextInspector
├── sdk/                        # createChatSdk 入口(_createChatSdk 内部工厂 + mountChatDialog 可注入 UI,依赖反转)
│   └── defineTool/promptBuilder/llmResolver/conflictManager/optionsResolver/events/contextPreset/ragSubagent/htmlSubagent/toolRegistry
├── tools/                      # 纯函数:dataOps/fetchDoc/dataSlotQuery/jsonUtils/schemaUtils/resources/sandbox/domTool/envTool/htmlValidate/toolError
├── toolsets.ts · backends/{vfs,storage,skillStore}.ts · mcp/client.ts · llm/{proxyLlm,constructLlm}.ts
├── composables/                # useChat/useContextManager/useMarkdown/contextIndex/chatContext(provide/inject)
├── components/                 # ChatDialog(组合容器:provide ctx + 9 区块 slot)+ MessageContent/CodePreview/DebugDrawer/ChatHeader/ChatInput/QueuedBar/ApprovalBar/ConflictBar/FocusBar/SkillPanel/message/*
└── presets.ts · types/index.ts · index.ts(主入口,注入 UI)· index.headless.ts(headless)
examples/                       # 各 demo(minimal/page/complex/nested/dynamic/subagent/human-confirm/planner/toolsets/animation/multi-agent/proxy/customize/rag(四模式:memory/子agent mock/子agent+MCP/MCP直连)/html-page/images(图片输入:纯文本主模型 describe 转述旁路)/headless)每个自带 index.html + main.ts
doc/                            # architecture.md(①-⑮ 架构细节)+ README.md(索引)+ usage-guide/context-management/system-prompt
demo/plain.html                 # 框架无关集成示例
skills/                         # 分发给使用者的 Agent Skill(入 npm 包 files)
```

## 架构要点

> 只列不变量;细节与流程图见 `doc/architecture.md`(数据槽深潜 §⑭、能力全景与鲁棒性 §⑮、压缩策略 `doc/context-management.md`)。

### 自研 harness
- `createAgent`:ReAct 循环 + 可插拔中间件,不绑定具体工具/能力。新增能力做成**中间件或工具注入**,勿硬编码进 `createAgent`
- 中间件契约:`beforeAgent`/`wrapModelCall`/`beforeModel`/`afterModel`/`wrapToolCall`/`afterAgent`/`beforeReturn` + `augmentPrompt`/`compressInput`/`tools`。**before 类正序、after 类逆序、wrap 类洋葱**
- 装载序:`usageHints → todos → skills → vfs → summarization → memory → permissions → verify → subagent → 用户自定义`(pin 段 mission/workingMemory/focus/resourcesPin 全 Infinity 尾随,靠声明序)

### 数据槽操作(详见 architecture.md §④⑭)
- **零桥接**:工具直接读写 `bind`(reactive);改数据必经写工具(范围 + schema 校验 + 自动快照 + 自动乐观锁)
- **schema 白名单**(ZodObject):顶层 key 白名单;读统一 `projectBySchemaDeep` 深投影(未声明不泄露);写 `isPathAllowed` 逐段校验;整体 set = merge 语义(未声明保留防误删);**path 级局部校验(path-scoped-validation)**:write 只校验被写子树(union-tolerant 任一 option 命中即过 / append 只校验新增元素 / remove 只查父容器结构约束),兄弟节点脏数据不株连(script:"" 事故根因);写回 = 逐 patch 外科手术式(局部 parse 值重放,未触达子树原样保留);strip/原型污染防线 per-path 平移(声明节点未声明键照拒,开放节点 record/any/unknown/passthrough 放行留痕);根级 refine 不在 write 时执行(notices 留痕,全局约束走 verify);`write del` 意图无校验(现状锁定)
- **乐观锁契约**(3.32 opt-in 翻转):`read` 附 `hash=xxx`(乐观锁标识);**自动检测默认不开** —— `conflictWatchFields`(白名单,任意深度字段名,位置不敏感)声明后仅监听字段值变动触发冲突;`['*']` 通配 = 旧版全字段检测(editor_fangzhou 实测宿主每秒回写 minHeight 类元数据噪声驱动翻转;autoLock 已废弃);hash 不匹配 → 挂起 `sdk.pendingConflict` → `resolveConflict('keep_external'|'overwrite'|'restore')`;**per-scope 基线**(子不污染主);**同 scope 连续写永不互相冲突**;**并发写互锁(4.1+,C 形态)**:`maxParallelTools>1 && conflictWatchFields 武装` 相与时 dataOps 闭包级 async mutex(单锁 bind 域,主×子共享闭包)串行化全部写工具 `[取 effHash → handleConflict → commit → setBaseline]` 段(7 个 commit 位:write set/edit+patches/del/draft_commit/eval transform 三模式;effHash 在 acquire 后取保 N1 时序)—— 后写锁内取前写刷新后基线,**陈旧基线同轮双写从「后者静默覆盖」变「前者落地 + 后者被裁决恢复点校验显式拦下」**;ask 挂起拆段放锁(防饥饿,兄弟写照常)+ 裁决恢复点单发校验(锚 = 裁决者所见 hash,非 effHash —— 对 effHash 校验会把每次 overwrite 裁决都打回自我否决);overwrite 裁决吸收基线 + restore 裁决补基线刷新;串行/未武装直通 no-op(conflictWatchFields 仍是唯一旋钮,未武装并行「后写覆盖」为既有明文语义);**abort→keep_external 联动全入口**(stream/send/batch,flow-robustness P0#2;conflictManager.set 另接受可选 signal race,按 id 比对防 ref 深代理);**conflictPolicy**(3.29,默认 `'ask'` 挂起等人工 / `'overwrite'` agent 强制覆盖不挂起 / `'keep_external'` 自动保留外部):宿主与 agent 争同一份数据、无人值守场景声明 overwrite 防流程永挂;自动裁决仍外发 conflict 事件(`autoResolved` 标记)
- **高层 read/write**:`read` 多路径/裁剪/分页;`write` 四意图(set/patch/**patches 原子任一失败回滚**/del;patch op 枚举 set/remove/merge/append(数组 push **或字符串尾接** —— 大 code 分块写入:先 set 首块再 append 逐块拼接,单次输出脱离 max_tokens 上限,4.1+)/**move**(value=目标路径字符串,数组元素同数组重排/跨数组移动一步原子))+ `dryRun`;`query_data` 批量 `queries`(4.6 W1:2-10 条一次取回,与 expr 互斥同传按 queries,逐条与单次输出同构、单条失败不整批);快照 per-path 栈 + `restore_data` + `history_data`(**deepClone 环防御 4.1+**:环数据抛可诊断错误含环路径 `$.a.b`,非「Converting circular structure」零线索;checkpoint save 克隆失败跳过本轮快照 + warn,不再 reject beforeModel 炸整轮);`eval_script` Worker 沙箱;`draft_*` opt-in(大 JSON 建议 maxToolRounds 20-30)。**写路径成本收敛(3.25.1)**:同调用 hash 单算(`commitBaseline`,基线+消息复用)+ codeAsset 改前态单拷贝(beforeBind 复用为快照条目,restore 防御性深拷贝兜底),1MB 单写 median -12~-22%;**不变量:冲突检查 hash 恒实时计算,禁跨调用缓存**(人工直改 reactive bind 不经 SDK 写路径,脏标记失明 → keep_external 失效)
- **工具面恒全暴露**(3.31 移除 `toolMode`/`interceptors`;4.0 legacy-crud-dedup 移除 get/set/edit/delete_data 四件):`createDataOps` 直出 10 工具,无呈现模式筛选;usageHints 无档位,提示词只随能力开关变化;受保护资源 freeze/verbatim(占位符只在读写边界替换,bind 恒持原值;**含保护字段的容器整体清空/替换显式拒** —— 回填分支按「容器仍在→回填 / merge 根键未传→skip 不捏造 / 根键在场链断→FROZEN_FIELD 带出路」三路,修「set components=[] 捏造骨架→SCHEMA_INVALID 不提保护→模型 15 轮摸路」+ merge 模式骨架覆盖原数组的静默丢失;resource_delete/list 对静态 freeze 给定向文案不误导);**vfs 四池** LRU + 大结果外存
- **code-as-data-asset 扩展(3.0,createHtmlSubagent 单模式触发)**:`__pgId` 无感注入(schema extend → safeParse 不剥离 + read 投影隐藏 `__pg*` + 写 `isPathAllowed` 拒 `__pg*` 段,框架 afterWrite 独占补;**checkout 入口幂等补齐宿主路径组件** —— 宿主自定义工具原生流程加的组件不经 SDK write,无 __pgId 会让 checkout/文件地图/commit 全链路失明〔2026-08-21 editor 诊断:「说干完了实际没写入」根因〕);**主 scope read 大文本摘要**(标记字段如 `code` → `<code Nkb>`,子 scope 完整);**两条 data 写路径** —— ① LLM write 工具(经完整契约:schema/乐观锁/快照栈/path guard)② 框架钩子(afterAgent commit 直改 bind,快路径,仅 code 字段豁免 write 契约,不进快照栈 + `recomputeBaseline` 防主 agent autoLock 误冲突)。**internalAfterWrite = 全写路径收敛点(4.5.0 补全)**:write 四意图/draft_commit/eval transform 三模式全走;`DataOpsOptions.sandboxRunner` 内部测试缝(node 无 Worker)详见子 agent 段「能力包」

### 记忆与上下文管理(详见 architecture.md §⑥⑮ + context-management.md)
- `summarization`(compressInput 不改原数组)与 `trimMemoryMessages`(OOM 裁剪)独立;`maxMemoryRounds >= summaryThresholdRounds`;**llmCache epoch(4.5.0)**:LLM 摘要前缀缓存单例闭包,switchSession/resetSession 经控制面 `reset()` 清缓存 + epoch 翻转(在飞摘要 .then 不匹配丢弃;只清缓存不 epoch = 假修),防会话 A 摘要泄进会话 B 压缩
- 压缩不丢关键信息:description 快照注入 + `preserveLastToolResults` + 写成功附 path + `reliableWriteRules`;压缩 LLM 摘要异步化(模板先行零阻塞 + 后台前缀缓存)
- 健壮性:窗口 ≥200K 硬约束;三闸阈值跟随 `setLlm`;overflow → 激进 trim → 重试 → 仍超抛;vfs 引用保护;系统段预算 25%;mission/workingMemory/focus 跨刷新持久化;`agentCompression` opt-in(decide 6s 超时降级静态)
- **stale-read-invalidation 写驱动过期读失效(3.42,默认开)**:单次 invoke 窗口内本批成功写(writeGate 四重门槛:writeCapable args-aware + 非 dryRun + 非 throw + 非 `ERROR:` 字符串)之后,被击中路径(等值/祖先/后代;remove/move/del 追加父数组防索引错位)的旧 read/query/search ToolMessage 替换为失效占位(钉原读路径引窄读 + 引用写结果新值/hash 反 thrash;query/search 分语「重跑」;del 不引用不撒谎);同批串行序写后读不失效,`maxParallelTools>1` 同批全失效;`query_data` 按 expr/queries 逐条静态前缀并集定界(批量 queries 为 4.6 W1 新面)、`search_data` 恒 root;resource_* 排除;workingMemory 联动写后刷新 lastHashes(hash 为 base36,原 `[0-9a-f]` 正则漏 g-z 已修);`staleReadInvalidation:false` 主/子一致关闭;委派写/集成方直改 bind/宿主 actions **不在失效面**(明示盲区,兜底=状态询问门禁);debugLogs `stage:'stale_read_invalidated'` + `inspect().staleReadsInvalidated` 会话累计;多组件写任务 `maxToolRounds` 默认 30、轮次预算感知两档提示(3.43:70% 起持续提醒/剩 ≤2 轮告急,注入 system 不污染历史)

### 规划与任务锚定
- `write_todos`(整表替换)+ `update_todo`(增量),一轮内不可混用;`maxPlanRevisions`(默认 5,只计 write_todos 修订次数、调研轮不计)防反复改计划死循环,超限后 update_todo 仅拒改计划形态(content/parentId/deps/criteria)、status/evidence 进度跟踪放行;复杂度判断由 LLM 做
- **evidence 审计门禁**(evidence-audit-gate,默认开,收口门禁链 gateChain.ts 内):A1 = usageHints 无条件教「标 completed 附 evidence: 实际写入 jsonPath」+ 完结门禁回灌文案追加「已完成但 evidence 空」rider(只搭车零新触发);A2 = 本 invoke 内翻转 completed 的 todos × evidence 含 path 形态 × 会话累计写路径集(effectiveWritePaths 全量展开,整体写=ROOT 全覆盖)零重叠 → 三出口回灌(改真路径/改回 pending/如实说明),预算 ≤2 独立池超限放行 + `AUDIT_GATE_EXHAUSTED`;wrap-up 轮次耗尽路径零 LLM 补跑(`AUDIT_EVIDENCE_SUSPECT`);描述性证据不核(宁漏勿误);委派流明示盲区
- **完结门禁**(默认开,无开关):todos 有未完成项却欲纯文本收尾 → 回灌「双出口」反馈(已完成→update_todo 标记 / 未完成→继续)续跑,≤2 次防死循环;豁免问号收尾(向用户征询)与空 todos;挂循环条件层(transitional 后;beforeReturn 因 maxVerifyAttempts 默认 0 不跑被否决);防「拆 3 项做 1 项就收口」的莫名中断。**收口门禁族已抽 gateChain.ts**(transitional→完结→evidence 审计→零工具→状态询问→EXHAUSTED 五层判定/文案/预算集中一处;transitional 句尾问号豁免 4.1+ 与完结/零工具口径对齐 —— 方案征询「你选哪套?」不回灌,不与方案先行 RHC 冲突);完结门禁豁免子 agent 栈(html 子 agent planning=true 装 todos,旧「子栈无 todos」假设不成立)
- **零工具收尾门禁**(imperative-zero-tool-gate,默认开无开关):完结门禁只盯 todos,「拆 0 说做完」(不建 todos 直接谎报已完成)绕过它 —— 三要素 AND(操作祈使句〔首子句 16 字窗口动词锚定 + 只读反例/问句/免操作词豁免〕+ 本轮零等效写〔writeCapable 口径 + use_/spawn 委派计等效写〕+ 纯文本非问句收尾)→ 回灌**事实清单**(harness 本地统计:工具计数/成功写路径/write×0/todos 完成度,机制供给事实防嘴硬)+ 三出口;出口①机械化(收口含 jsonPath/组件 id 不二次回灌);预算 ≤2 超限放行 + `ZERO_TOOL_GATE_EXHAUSTED` observable;子 agent 不装(`CreateAgentOptions.__pgIsSubagent`);debugLogs `stage:'zero_tool_gate'`;与 resumeNotice 双保险
- **问句意图守卫**(默认开,无开关):正则三档启发式(句尾问号 / 疑问词+吗呢 / 查询词「是什么|怎么用|有哪些」)逐消息定性,命中注入「先答勿做」pin 段(`PIN_SEGMENT_NAMES` 白名单保跨压缩/预算裁剪存活);只递信号不阻断工具,裁决归 LLM(文案带「除非同条消息明确要求操作」逃生门);防长对话问句被历史轨迹拖着误路由成操作(「这是啥组件」→ use_html 事故)
- **Mission**(默认开):会话级目标锚定,启发式 capture(宁漏不误)+ `send({mission})`;pin 段天然跨压缩
- **workingMemory**(默认开):捕获 read/query/search 的 locatedPaths + read hash(LRU ≤10),防压缩后重复检索/凭记忆写致 autoLock 误冲突
- **Focus**(默认开,opt-in 聚焦):三层收敛(提示 + 子树 schema 视野 + strict `PATH_DENIED`);**invoke-freeze(4.2.3+)**:焦点锚定下一次输入 —— beforeAgent 取生效快照,宿主 API/UI mid-run 到达的焦点变更不追溯掐在途流程(实测事故:方案确认挂起窗口点选组件 → 整页打乱被 PATH_DENIED),agent 自己的 focus 工具变更立即生效(clear_focus 自救依赖);**意图归属引导 + 正路出口(4.1+)**:「增加/修改 X」默认归属聚焦组件本身(写焦点子路径),PATH_DENIED 文案先给子路径出口(动态示例)再给解焦出口(实测「增加tab」被误读为新建组件驱动);**指代问句锚定(4.2+)**:「这是啥/这个/它」类指示代词问句默认指聚焦目标(先 read 焦点子树再答,勿泛答整页 —— 实测点选深层组件后问「这是啥」答了整页概况);API `setFocus`/`addFocus`/`removeFocus`/`clearFocus`/`getFocuses`;子 agent 继承全部焦点(**经 `getActiveFocuses()` 生效快照**,4.5.0 team-audit P1#5 —— 宿主 mid-run 焦点不穿透委派,主/子写面口径一致;UI chip/persist/inspect/宿主 API 等其余消费面仍实时态)

### 子 agent 与并行编排(详见 architecture.md §⑨⑮)
- `spawn_agent`/`spawn_agents`(默认开)只返回最终结论(省 token);预声明 `subagents:[{id, description, …}]` 生成 `use_<id>`;`maxDepth`(默认 1)物理切断
- **授权面**:装配期 filter 排除框架/保留工具;spawn 自授剥离写工具(**按名解析主池工具对象再判定**,4.5.0 修原对字符串判定恒 no-op;未知名保留报「工具不存在」;条件写 eval_script 同通道;写权限仅经 `writablePaths`);子栈继承主 permissions/approval(approval_request 直通主循环);子 offload 直落主 vfs 共享池;**CA 并发修复(per-call 通道)**:中间件经 `ctx.callConfig` → coreExecTool 经 RunnableConfig.configurable 透传到工具 fn 第二参(`__pgSubagentCall` signal/emit/logSink、`__pgDataScope` 乐观锁 scope),`maxParallelTools>1` 并发不再闭包单变量互相覆盖(zod 校验重建 args 对象,args 注入通道不可行)
- **能力包**:`createRagSubagent({retriever?, loader?, useVfs?})`(只读检索)/ `createHtmlSubagent({writablePaths?, codeVfsPrefix?, codeField?, orchestratorPrompt?, formatCheck?, craftNotes?, llm?, thinkingMode?})`(**3.6+ `writablePaths` 可省**:装配期 `inferWritablePaths` 从 schema 顶层扫「数组元素含 codeField string」路径回填(info 留痕);开放 schema/嵌套容器/点路径 codeField 推断不出 → warn+throw 显式传,宁失败不猜错)(**3.0 单模式 breaking**:代码作 `data.code` 资产(进服务端 DB),vfs 作工作副本,框架 beforeAgent checkout(data.code→vfs by `__pgId`)/ afterAgent commit(vfs→data.code 增量,直改 bind 不进快照栈)自动搬运,主 agent 透明(主 scope read 见 `<code Nkb>` 摘要);`__pgId` 无感注入(schema 不声明/read 投影隐藏 `__pg*`/agent 写不进/persist 透明);去 `onComplete`/`codeRef`/`codeSnapshots`;单模式=**完整页面级 HTML**(自包含可独立成页,script/CSS 默认含、集中放 `<style>`/`<script>` 块便于下游提取,可引外部 JS/CSS;改造组件/独立页由下游插件/tool 做);`formatCheck` 默认开 = `validate_code` 自检 + verify beforeReturn 门禁,校验器 `validateHtmlFormat` 已导出(**只校验结构合法性**——标签闭合/注释/多余闭合;DOCTYPE/html/head/body/script 均允许),自纠上限 `maxVerifyAttempts:2`);**`codeField`**(默认 `'code'`,嵌套如 `'props.html_code'`,适配开放 schema 代码字段位置;「是否代码组件」= 该路径有 string)+ **装配期命中校验**(组件数>0 且全员未命中 → onWarning,防填错路径静默失败);**编排自适应注入**(createChatSdk 装配期零配置:`htmlOrchestratorPrompt(id)` 同源纯函数 —— 有 html agent→注入委派编排(custom code 不 read 不 write 全权 `use_<id>`)/ **3.9+ 无显式 html agent + schema 含 code 数组 → 自动装配默认 createHtmlSubagent()**(info 留痕,无开关;显式声明优先不重复;推断不出的形态(顶层 code 字段/开放 schema)不装 → `htmlDirectWriteFallback` 降级直写));**thinking-taming(真 LLM 实测驱动)**:① 委派 task 规格化 4 要素(实测完全生效;补视觉锚 + ⑤历史偏好转述)② validate_code jsonPath 零重传(**schema 描述/字段顺序/实现三处统一 jsonPath 首选** —— 实测工具 schema 反向引导会覆盖 system prompt)③ 写前简述 + 终稿纪律;**工匠笔记 `craftNotes`**(默认开):子 agent 收口回复 `[note]` 行 → 组件 `__pgNotes` sidecar(FIFO ≤5×200,随 data 持久化;收口文本经 **wrapModelCall 捕获进 state `__pgFinalText`** —— afterAgent 的 state.messages 只有初始 user 消息,beforeReturn 受 maxVerifyAttempts>0 门控,wrapModelCall 是唯一全路径覆盖点),下次委派同组件经文件地图注入「前任的交接」;read 投影隐藏/agent 写不进(`__pg*` 现成);`craftNotes:false` 关闭;**模型建议**:html 代码生成推荐强指令模型(deepseek-v4/claude/gpt-4o),flash 类放大过度思考
- **子 agent 模型/思考分层(output-quality-uplift)**:`createHtmlSubagent({ llm })` 子 agent 独立模型(主保持轻量编排;`configToSubOpts` 的 `config.llm ?? main.llm` 既有链路)+ **思考深度锁定 `thinkingMode?: 'simple'|'deep'`**(子 agent 级/顶层 `subagent.thinkingMode` 全局缺省,显式优先):LLMConfig 构造路径经 `applyThinkingMode` 纯函数改写 —— OpenAI 兼容改 `extraBody.thinking`(deep 注入 `{type:'enabled'}` 保留已有子键 / simple 剥除)/ Anthropic 扩展 `LLMConfig.thinking` 字段(`constructLlmFromConfig` 注入 `ChatAnthropic({thinking})`,budget_tokens 缺省 `min(maxTokens ?? 4096, 8000)`,**thinking 开启 temperature 被 API 强制为 1**);预构造 BaseChatModel 实例路径物理不可改 → warn + observable `subagent_thinking_mode_noop` 留痕(需改 SubagentLlmConfig);`inspect().subagent.subagents` 反射 `thinkingMode + thinkingApplied('applied'|'inherited'|'instance-noop')`;未设 = 完全继承零回归。**需模型支持思考**(deepseek thinking 版/claude;flash 类无效),代价 token/耗时约 2-5×
- **主×子协同**:per-scope 基线 / allSettled 逐任务结算 / 子 usage 回传 `sdk.usage` / `subagent.timeoutMs`(4.1+ 默认总时长 10min,可覆盖/0 关;超时 abort 子流 + recoverable 回灌;`inspect().subagent.timeoutMs` 反射);观察层 `inspect().subagent.{active,history}` + DebugDrawer tab
- **同轮并行委派与失败隔离(3.13)**:编排 prompt 引导不同组件同轮并行多个 `use_<id>`(`maxParallelTools>1`,默认 1 串行零变化);**失败隔离 = 无关联任务一个出错不批量回退**(失败委派 error result 单独回灌,其余照常落地;codeAsset commit per-component try/catch 单组件失败跳过留痕不中断循环);与 `write({patches})` 整体原子回滚(一次逻辑写的原子意图)按任务关联性区分语义
- **组件锁 · 同组件单委派互斥(3.13 机制锁,`sdk/componentLock.ts`)**:① 委派互斥 —— 同组件并发第二个 `use_html` 立即回灌 `COMPONENT_BUSY`(零子 agent 消耗);锁目标 = `components` 显式声明(过滤编造名)/ 缺省 task 文本整词唯一命中才锁(0 或 ≥2 命中不锁,宁漏不误);acquire 多组件原子(任一被占全失败不留半套锁),release 幂等;**release 挂子流彻底 settle(4.5.0 team-audit P1#6)** —— 超时错误仍立即回灌,但锁等 wind-down commit 完成才放(180s 兜底防永挂),窗口内重委派撞 COMPONENT_BUSY(文案本就引导等结束再试)。② 主写守卫(`createComponentWriteGuardMiddleware` wrapToolCall)—— 委派在途时主写工具命中锁组件子树回灌 `COMPONENT_LOCKED`(整体 set 拒;dryRun 不拦);**codeField 恒守卫(3.24.1,M4 真 LLM 驱动)**:已存在代码组件的 code 路径恒拒回灌 `CUSTOM_CODE_DELEGATION` 引导委派(`codeFieldIndexPaths` 实时解析;新建元素/整体 set/dryRun 不拦;不配 `getCodeFieldPaths` 零变化)—— flash 实测 3 次无视提示词禁令直写,机制化;**时序注意:守卫检查在工具派发同步段,use_html 的 acquire 在数个 await 之后** —— 并发场景下须有宏任务间隙(真 LLM 流式天然满足;e2e 用 slow_probe 时序锚)。③ **per-组件委派世代号(4.5.0)**:共享 vfsStore 命名空间 `__pgTouchGen`,本轮 touch 代码文件/checkout 走 pendingRetry 复用即 bump + 快照进本轮 state(全量 checkout 不 bump,并行异组件零株连);afterAgent commit 前比对,旧代跳过不重放且不记 keep_external(世代过期 ≠ 人工修改)—— 掐断「超时旧委派 wind-down 读新委派中间态提前 commit → 新委派最终成果被 keep_external 静默丢弃」竞态。④ commit 人工并发检测(`hashString` 快照比对)—— 在途窗口同组件 code 被外部改 → keep_external 保留人工值 + warn + **组件名经 `state.__pgKeepExternal` → `runSubagent` 的 `decorateSubagentResult` 随委派返回值回流主上下文**(ask-first 文案;否则主 agent 读到人工 stub 误判「子 agent 占位符」后读后写覆盖 —— M4 实测修);组件被删 → 不复活 + vfs 副本清理;索引位移 → 按 `__pgId` commit 不写错位置。观察层 `inspect().subagent.lockedComponents` + DebugDrawer 锁视图。真 LLM 复验(modes 套件,M4 4/4):并行发生 ✓ / 人工并发 keep_external 终态保留 ✓ / 墙钟量化断言待环境(LLM 代理黑洞两杀,deferred 有登记)

### 其他能力(详见 architecture.md §⑩⑪⑮)
- MCP 远程工具(**逐 server 渐进注入**:各 server 连接落定即注入工具,坏 server 的 3 次连接重试不再拖累好 server;连接重试 3 次递增退避吸收上游瞬时 502/断连 + 握手 15s 降级 + **callTool 超时闸 60s**(`callTimeoutMs` 可调,3.6+;超时回灌自纠不断连))/ Verify 自检 opt-in(`createWriteBackCheck` + adversarial)/ `get_dom` opt-in / `inspect_env` 默认开 / actions 宿主动作 / SkillSpec.exec(一次性)vs tools(反复查询)勿双轨 / Approval(无响应自动拒,4.1+ 中间件级默认 30s:approval_request 事件带 `hold()`,响应方收到即调则不限等人;headless/send/batch/streaming:false 等无响应方路径 30s 自动拒 + `APPROVAL_AUTO_REJECTED` observable;`approval.timeoutMs` 覆盖,Infinity=关;humanConfirm 同口径)/ Checkpoint 每轮存档 / Automation 预算 + `sdk.batch` / **图片输入 image-input-vision**(三入口 📎/拖/贴 + 压缩闸 ≤1568px/≤4 张/20MB;三分支:多模态主模型(modelCaps 查表或 `llm.vision:true`)直发 content parts / 纯文本 + `images.describe` 转述注入(图不直发)/ 都不配诚实拒绝;`images.upload` 原图换 URL;持久化 thumb+vfsRef 轻形态;详见 usage-guide §6.17)/ **方案确认留痕 `lastPlanConfirmation`**(RHC 带 options 的方案被点选 → `{at,summary,choice,viaOptions}` 记录;仅方案确认记录(允许/拒绝/无 options 不写);随 SessionSnapshot 持久化跨刷新存活;switch/reset 清除;ApprovalBar 上下文提示行不自动跳过;`inspect().planConfirmation` 反射;bulk-change-guard 豁免的公共接口)/ **bulk-change-guard 大批量门禁**(`capabilities.bulkGuard` 默认关 + 须配 approval 才装配(否则 no-op 留痕);量纲 = 现有组件节点数(同组件多 patch 不拦/新增不计/深路径截组件粒度);超阈(默认 4)挂 approval(自带 30s timeoutMs,ctx.emit 通道);拒绝回灌 BULK_CHANGE_REJECTED;`mode:'observe'` 无人值守;豁免:lastPlanConfirmation + 会话级同形态一次 + dryRun;componentWriteGuard 之内装载;`inspect().bulkGuard` 反射;缓解非根治明示)

### 对话鲁棒性(详见 architecture.md §⑮)
- **三档错误模型**:recoverable 回灌自纠 / fatal emit+中断 / observable 记录;导出 `routeError`/`asAgentError`/`agentError`
- 重试:网络/429/5xx 指数退避(maxRetries=2);4xx 与 abort 不重试;⚠️ **先排除 abort 再判 status**;abort 保留 partial;**tool_call id 兜底回写 AIMessage(4.1+)**:provider 漏回 id 时兜底 id 同步写回 message.tool_calls(原只回填 ToolMessage → 下轮「无 id tool_call + 有 id ToolMessage」协议 400 单轮 fatal);**send/batch 落盘错误源分流(4.1+)**:store.flush 失败不再误归因 LLM fatal 触发 automation 重跑(PERSIST_FLUSH_FAILED 留痕放行,落盘交 debounce/pagehide 兜底);**send/batch 同 stream 刷新 vfs protectedRefs(4.1+)**(原只在 stream 注册 → 跨轮 LRU 淘汰被引用 large_results → vfs_read 404)
- **挂起有界收口三契约**:① 超时默认值表(approval 30s / MCP 15s / skills fetch 30s / 流停滞 `streamStallMs` 90s 抛 `StreamStalledError` 不重试;**stream 启动闸同阈值** —— `streamer.stream()` 等响应头阶段假死(fetch 默认无超时)时 stall 看门狗不覆盖,P1-7b 补;**completion 截断检测回灌(4.1+)** —— 空输出+零工具调用且 completion 达 4000+(或 stop_reason 'length')→ 单次回灌分步写入指引(实测:整页 HTML 塞进一次 write 参数撞 max_tokens → 子 agent 静默空收口 → 主 agent 无限重委派;`completion_truncated_retry` 留痕);**流总时长 `streamMaxDurationMs` 600s** —— 空转帧黑洞兜底:keepalive 空转不断重置间隔计时(实测冻结 7min+ 无报错),绝对截止抛 `StreamMaxDurationError`(继承 408 不重试,重委派/重发自愈);**集成方工具看门狗 `toolTimeoutMs` 120s(flow-robustness P0#1)** —— 只管集成方注入工具(defineTool/actions/skill 工厂/rag retriever 打 `__pgWatchdog` 标),永不 settle 时 recoverable 错误回灌不杀流;内置/MCP/委派(use_<id>/spawn_*)/conflict ask 挂起是设计内等待一律豁免;**approval/humanConfirm 无响应 30s(4.1+ 中间件级,响应方调事件 `hold()` 接管后不限时;approval.timeoutMs 覆盖/Infinity 关)**;**子 agent 单次委派总时长默认 600s(4.1+;subagent.timeoutMs 覆盖/0 关)**;**storage flush 逐项 5s + 初始化 ready 5s(4.1+;flushTimeoutMs 可调;超时放行留痕,落盘交后续 flush/pagehide 兜底)**);② 兜底收口必留痕;③ `activeControllers` core 级,unmount/switchSession/resetSession 先 abort 全部在途流;**abort→冲突收口联动全入口**(stream/send/batch,flow-robustness P0#2):signal abort 时挂起的乐观锁冲突自动按 keep_external 收口(send 不再永不返回;conflictManager.set 另接受可选 signal race 兜底,按 id 比对防 ref 深代理)
- **resetSession**(同步):abort + 收口冲突(keep_external)+ 重置全部内存态 + 新 sessionId;storage 关也完整执行
- **会话恢复提示 resumeNotice**(默认开,无开关):applySnapshot 灌入非空历史(autoResume/session.id/switchSession 三路径)→ markResumed → 恢复后首轮 system prompt 注入「数据可能已变(刷新回退未保存态),断言已完成前先核实」pin 段;一次性 afterAgent 清除(switchSession/resetSession reset 防残留);防「生成未保存→刷新恢复会话→『重新生成』直接答完毕」(editor 实测事故)
- **shareContext**:同 id 复用 AgentCore;串行闸与在途流注册表 **core 级**;收口中止共享 core 全部在途流
- `onEvent`(构造时)/`sdk.hook`(运行时,返回取消函数);流式事件仅 stream 模式;`approval_request` 不外发;运行时重配置 `setTools`/`setLlm`/`setMemory`/`setSubagents`(infoTick 刷新);`dedupeTools` 后注册覆盖先者

## 关键约定与坑

### LangChain 消息字段名
`ToolMessage` 构造参数用 snake_case `tool_call_id`(非 camelCase),否则报 `400 missing field tool_call_id`。`call.id` 可能 undefined,需生成兜底 id。

### ChatOpenAI 参数
用 `apiKey`(非 `openAIApiKey`)、`model`(非 `modelName`),`baseUrl` 通过 `configuration.baseURL` 传入。**Anthropic baseUrl 必须绝对 URL**(相对路径 buildURL 抛 Invalid URL)。

### 库构建 external
`vite.config.ts`:`vue` 打包进 SDK;`zod` / `@langchain/*` external(peerDep);`marked`/`highlight.js`/`dompurify`/`overlayscrollbars` 打包进主包(headless 子路径不含)。dev 预构建:`optimizeDeps.include` 已预声明 MCP SDK 子路径,否则冷启动首次注入失败。

### 中间件生命周期
before 类正序、after 类逆序、wrap 类洋葱。新增能力做成**中间件或工具注入**,勿硬编码进 `createAgent`。

### 数据槽工具零桥接
工具函数体 `window` = 宿主页面主 window。改数据必经写工具(范围 + schema 校验 + 自动快照;乐观锁 opt-in:conflictWatchFields)。

### 测试流程

#### 1. 单元/集成自测(必跑,无 LLM 依赖)
```bash
npm test    # tsx 跑 src/core/__tests__/selftest.ts,3079 项断言
```
按模块拆分:`src/core/__tests__/modules/sec-NN.ts`(54+ 个模块)各导出 `run(ctx)`,runner 汇总;共享 `TestCtx` 在 `modules/_ctx.ts`。tsx 跑源码(不经构建),触不到 createChatSdk 顶层 API 作用域。**改任何核心模块后必跑**。

#### 2. 集成层 e2e(改 createChatSdk 顶层 API 后必跑)
```bash
npm run build && npm run test:e2e    # node 跑 dist 产物,906 项
```
模块在 `tests/e2e/<module>.mjs`(systemprompt/dynamic-register/inspect/subagents/events/storage/exports/data-slots/presets/boundary/custom-injection/conflict/automation/llm-provider/focus/images/resources/agent-compression/headless-subpath/legacy-subpath/capability-packs/authorization-surface/hang-feedback/main-sub-isolation/session-integrity/context-economy/mcp/diagnostics/instruction-adherence/thinking-mode),共享 stub 在 `tests/e2e/_helpers.mjs`(StubChatModel 在 `_stub-model.mjs`,响应队列驱动真 ReAct)。覆盖顶层 return 对象作用域。**改 createChatSdk 返回对象、AgentCore 接口、动态注册 API、默认提示词、新增导出/配置项后必跑**。

#### 2.5 浏览器 E2E(改 UI/ChatDialog/dataOps 后必跑)
```bash
npm run test:browser  # 124 项;也可 /browser-test 斜杠命令。**并行分片(browser-test-sharding)**:`workers:4` + `fullyParallel:false`(spec 文件级分片、文件内保序,与串行行为一致;实测全量 ~1.4-1.6min)。禁依赖「预启动 dev server + 复用」(遗留旧 server optimizeDeps 失配 → 强制 reload 假性失败,§3.5 前科);**依赖变更后首跑遇批量 reload 型失败 → 重跑一次预热,不判回归**;单跑复跑用 `--grep`;时序敏感观察名单(queue/icons 净化/page-demo 流式占位)如现 flake 优先加大 delays 窗口而非上 retries
```
**原理**:`tests/browser/_helpers.ts` 的 `mockLlm()` 用 `page.route()` 拦截 LLM API 端点,按脚本返回 SSE 流,使 agent ReAct 循环确定性走完,不依赖真 LLM。**双协议**:同时拦截 OpenAI 兼容(`**/chat/completions`)与 Anthropic Messages API(`**/v1/messages`),各返对应格式 SSE,共享 script 计数。spec 按 demo 拆分(complex-demo 27(含手动编辑三件套 4)/ page-demo 23 / html-page 8 / render-check 7 / customize 7 / i18n 6 / icons 6 / images 8 / header-labels 5 / rag 4 / nested 3 / lifecycle 3 / queue 3 / scrollbar 3 / error-recovery 2 / human-confirm 2 / xss 2)。写新测试模板见 `.claude/skills/browser-e2e-testing/SKILL.md`。

#### 3. 浏览器手动验证(改 UI/示例后跑)
`npm run dev` 逐个 demo 验证(见目录结构 examples 清单;各 demo 侧重点见 `doc/usage-guide.md`)。

#### 3.5 真 LLM 场景回归(`npm run test:real`,统一入口)
**统一入口** `npm run test:real [套件] [场景号…]`(套件:`uispec` complex-demo 10 场景 / `rag` 四模式 / `parallel` 并行复验;共享基建 `tests/runtime/_real-llm-lib.mjs`,新套件只写场景+checks);另有两类独立套件直接 `node tests/runtime/<名>.mjs`:`subtree-real-llm.mjs`(subtree/守卫/nudge 5 场景,?huge=1)/ `complex-ops-real-llm.mjs`(complex-demo 升级后调整/修改操作 6 场景:新建含委派/调序/层级/属性/聚焦纯代码/RAG ?rag=1;LLM 走 `VITE_ANTHROPIC_*` 组)/ `render-check-real-llm.mjs`(html-page-demo 坏 script 自纠 5 场景,2026-08-26 补验归档)/ `section-orchestrator-real-llm.mjs`(双臂 fixture `tests/runtime/fixtures/section-fixture.html`,?arm=grind|nudge,2026-08-26 补验归档)/ `image-input-real-llm.mjs`(images-demo 识图旁路 3 场景,describe 走 modelverse vision 经 vite 代理 /llm—— 浏览器直调 /v1/messages 因 CORS 失败;2026-08-26 补验归档;**注意 `loadReport` 的 only 过滤会把未跑场景从报告剔除,单跑前先备份报告**);**基线对比已机械化**:`--baseline-diff`(读现有报告秒回 diff,▲疑似回归/▼改善,阈值 token ±15% 且 ±2000 / toolCount ±3)/ `--baseline-update`(确认预期后采集,`tests/runtime/real-llm-baseline.json` 随代码提交)。报告 `_real-llm-*.json` gitignore,断点续跑传场景号。**方法论详见 `doc/real-llm-regression.md`**(idle 双条件判定/超时 dump 诊断/reload 诊断)。要点:idle 判定 = debugLogs 静默 90s + `getActiveSubagents()===0`(reasoning 不打日志,只看日志会误判);**跑前必重启 dev server**(遗留旧 vite server 的 optimizeDeps 状态过期 → 页面强制 reload → memory 后端会话清空,msgs 归零假性失败,3.11 排查烧 1h);**跑中禁并发 test:browser**;`.env` 无 key 自动 skip。headless 族(draft/trace/maliang,`tests/runtime/*-real-llm.ts`)不经统一入口,各自 `npm run test:*-real`。3.10/3.11 系列修复全部由真 LLM 复测驱动发现。

#### 4. 运行时手动验证(依赖 LLM/server)
子 agent 委派 / MCP / verify 自纠 / 真实 LLM 流式 / draft 真 LLM(`npm run test:draft-real`,无 key 自动 skip)。

#### 4.5 发布后临时安装深化验证(3.22.1 教训)
临时目录 `npm i page-agent-sdk@<ver>` 后**用 node 实际调用本次新增的关键导出**(不只 `require` 成功):3.22.0 的 `sanitizeMessageHtml` 就是在这步暴露「node 无 DOM 调用抛 TypeError」的(browser 测试全绿也挡不住 —— dompurify 无 window 非完整实例)。

#### 5. CDN 可达性验证(发布后)
```bash
curl -sL "https://esm.sh/page-agent-sdk@<version>" | head -20
curl -sL "https://esm.sh/page-agent-sdk@<version>/es2022/page-agent-sdk.mjs" -o /tmp/sdk.mjs
rg -o "createChatSdk|setData|systemPromptHelpers" /tmp/sdk.mjs | sort -u
```

#### 测试矩阵(改 X → 必跑 Y)
| 改动范围 | npm test | test:e2e | test:browser | demo | 真 LLM |
|---|---|---|---|---|---|
| 核心模块(dataOps/vfs/中间件/存储) | ✅ | — | 改 dataOps/确认流程时 | 对应 demo | — |
| createChatSdk 顶层 API / AgentCore / 导出 | ✅ | ✅ | — | dynamic-demo | — |
| UI 组件(ChatDialog/DebugDrawer) | — | — | ✅ | ✅ | — |
| 子 agent / MCP / verify | ✅ 逻辑层 | — | — | 对应 demo | ✅ |
| 构建配置 | — | ✅(用 dist) | — | plain.html | — |

#### 新增功能测试同步约定(强制)
每新增功能/配置项/导出 API,**必须同步补测试**(同 commit),至少 1 条「正常工作」+ 1 条「边界/错误」。判定:selftest = 底层纯函数/工具逻辑/中间件 hooks;e2e = 顶层返回对象方法/AgentCore/新 capabilities/新导出/inspect 反射。命名以 `✓` 开头写「功能名 → 预期行为」。**计数同步**:更新本文件断言计数(3134/1020/132)与 README 中英文。自检:`npm test && npm run build && npm run test:e2e` 三绿方可提交。

#### 发布前必跑顺序
`npm run build` → `npm test` → `npm run test:e2e` → `npm run test:browser` → `npm run test:exports`(types 与 src 导出对齐)→ `npm run test:types`(对外 types 对齐;**src 真错门禁**:`npx tsc -p tsconfig.json --noEmit 2>&1 | grep 'error TS' | grep -v __tests__ | grep -v examples/` 须为空)→ `npm run test:types-alignment`(d.ts↔src 双向互判)→ `npm run test:size` → `npm pack --dry-run`(核对不含 `.env`/`src`/`examples`/笔记)→ 版本 bump → publish → CDN 验证

## SDK 用法
```ts
import { createChatSdk, defineTool, defineSkill, type Middleware } from 'page-agent-sdk'
createChatSdk({
  container: '#root', llm: { apiKey, baseUrl, model },   // 或 provider:'anthropic'
  systemPrompt: '...', data: { schema, bind, description? },
  augmentSystem: ({ state, data }) => '...',              // 动态注入业务补充段(每轮调)
  tools: [...], skills: [...], memory: '...',
  contextPreset: 'auto', subagents: [createHtmlSubagent({ writablePaths: ['components'] })],
  capabilities: { verify: true }, verify: { maxAttempts: 2 },
  approval: { tools: ['write'] }, checkpoint: true, middleware: [...],
  dialog: { theme: 'dark', icons: { header: '🦈' } },        // 主题(dark 默认)+ 图标(见 DialogIcons;支持 HTML 片段净化)
  i18n: { locale: 'en-US', messages: { statusDone: '<b style="color:#10b981">Done ✓</b>' } },  // 国际化配置组(顶层 3.22+):locale 切语言 + messages 键级覆盖(富文本位支持行内 HTML 净化)
  images: { upload?, describe?, describeTimeoutMs? },  // 图片输入:多模态主模型直发(llm.vision 声明/查表)/纯文本模型 describe 转述旁路(见 usage-guide §6.17)
}).mount()
// 运行时动态重配置:setTools/addTool/removeTool · setLlm · setMemory · setSubagents
```
- **capabilities**:默认开 `dataOps`/`fetch`/`planning`/`skills`/`vfs`/`summarization`/`memory`/`subagent`/`focus`/`workingMemory`/`missionAnchor`/`contextInspector`/`inspectEnv`;opt-in `verify`/`domInspect`(get_dom 常驻 + dom_search/dom_info 经 dom-inspect skill 按需注入)/`automation`/`agentCompression`/`draftWrite`。**`tracing`/`skillHostScript`/`preferences`/`bulkGuard` 已于 4.1.0 随 round2 移除**(残键静默忽略;skillHostScript 的 `exec.context:'host'` 残值落 sandbox 执行 = 宿主全权降级沙箱语义反转,CHANGELOG 明示;`todoDeps` 已撤除,残键静默忽略零影响)
- **预设**(`presets`):`pageBuilder`(3.9+ 仅场景化身份 prompt;HTML 子 agent 由装配期自动装配,preset 不再自带)/ `researcher` / `minimal`,spread 进 `createChatSdk`
- **headless**(`ui: false`):不渲染内置对话框,用 `sdk.messages` + `send`/`stream` 自建 UI。**精简子路径** `page-agent-sdk/headless`(纯核心,ESM ~446KB vs 主包 ~963KB)。headless 持久化:`sdk.stream` 不自动落盘,每轮后手动 `sdk.afterRound()`(`send` 自动)。headless 调试复用内置 `DebugDrawer`(纯 props:`logs=sdk.debugLogs`/`getInfo`/`infoTick`/`getSkillContent`,可选 `exportDiagnostics` 一键诊断报告,缺省降级本地聚合)。**诊断导出**(3.29):`sdk.exportDiagnostics()` 聚合 debugLogs/messages/inspect/usage/dataSummary 为 JSON(隐私收口:不 dump bind/剥 schema/url 凭据打码/6MB 总长闸),DebugDrawer 💾 按钮一键下载 JSON 文件(3.36.1 起原复制改下载,大日志 clipboard 易截断)
- **UI 模块可复用**:`ChatDialog` / `MessageContent` / `CodePreview` / `DebugDrawer` / `SkillPanel` + `useChat` 均从入口导出。`inspect()` 的 `AgentInfo` 含每工具 `source`/mcp/上下文构成等。框架无关集成见 `demo/plain.html`

## 编码规范
- `<script setup lang="ts">`,Composition API;注释用中文,只解释非显而易见处
- 新增 composable/组件/工具在 `src/index.ts` 导出并同步 `types/index.d.ts`(headless 子集同步 `types/headless.d.ts`)
- 改构建依赖同步 `vite.config.ts` 的 external/globals
- `.env` 的 `VITE_AI_SYSTEM_PROMPT` 写单行;**凭据只进 `.env`(gitignore),不进代码/仓库/文档**
- **新增功能必须同步补测试**(见「新增功能测试同步约定」),无测试不予合并/发布

## 项目 Skills 与 Commands

| 名称 | 位置 | 公开范围 | 用途 |
|---|---|---|---|
| `page-agent-sdk-integrate` | `skills/`(入 npm 包) | ✅ 公开分发 | 集成 SDK 进网页(选引入方式/声明 data/配 llm/挂载/事件/headless/排坑);含 `references/integration-prompt.md` 通用对接提示词模板 |
| `page-agent-sdk-release` | `.claude/skills/` | 🔒 维护者自用 | 发布新版本(bump→build→test→推双远程→npm publish→验证) |
| `browser-e2e-testing` | `.claude/skills/` | 🔒 维护者自用 | Playwright 浏览器 E2E(mock LLM 原理/写新测试模板) |
| `openspec-*`(4 个) | `.claude/skills/` | 🔒 维护者自用 | OpenSpec 变更流程(propose/explore/apply/archive) |
| `/browser-e2e` `/browser-test` `/opsx:*` | `.claude/commands/` | 🔒 | 交互式浏览器探索 / 自动化回归门禁 / OpenSpec 命令 |

## 发布与引入

包名 `page-agent-sdk`(`package.json` 已配 `exports`/`files`/`peerDependencies`/`unpkg`/`jsdelivr`)。三种引入:npm / CDN·ESM(esm.sh)/ CDN·IIFE(unpkg 单文件)。

### 双远程仓库(职责不同,切勿混推)
| remote | 定位 |
|---|---|
| `origin`(gitee chat-agent) | 📦 日常存储(develop 细粒度 commit + master 发布 commit) |
| `github`(github page-agent-sdk) | ✅ 正式开源(只收 master 整理过的发布提交) |

**分支工作流**:日常开发在 `develop`(细粒度提交,`git push origin develop`);**master 只在发布时动**。发布时 `./scripts/publish-github.sh "release x.x.x: 总结"`(master 上 `merge --squash develop` 总结成一个发布 commit → 推 Gitee + GitHub)。个人笔记 `doc/待确认问题.md` 在 `.gitignore`,不进 git。

### npm 发布约定
- **账号**:`whyymj`(已开 2FA;**禁止在文档/仓库/聊天记录中留存密码或 token 明文**;凭据只存本机 user 级 `~/.npmrc`)
- **registry 陷阱**:本机默认 registry 是公司私有源;`package.json` 的 `publishConfig.registry` 已锁官方 npm;但 `npm login`/`whoami`/`view` 需显式 `--registry=https://registry.npmjs.org/`
- **2FA**:用 **Automation Access Token**(npmjs.com → Access Tokens → Classic → Automation),写入 `~/.npmrc`;用完即吊销
- **发布后验证**:`npm view page-agent-sdk version` + 临时目录 `npm i` 验证可装 + CDN 可达性

### 发布 checklist(代码 → 文档 → git → npm)

> ⚠️ **发布触发约定**:不要在修 bug / 加功能后自动发布。每次 `git commit` 后**停下来询问用户「是否发布」**,由用户决定。仅在用户明确说「发布」/「publish」/「推上去」等时执行。

1. **develop 开发**:新功能/修 bug 在 `develop`(在 master 先 checkout);改 `src/` → 同步 `types/index.d.ts`(手动维护)→ `src/core/index.ts` 导出
2. **更新中英文文档**(同步勿漏单边):`README.md`(英)/`README.zh-CN.md`(中)/`doc/README.md`+`doc/README.en.md`/`doc/usage-guide.md`+`.en`/`CLAUDE.md`(内部);**`CHANGELOG.md` 补本次版本条目**(Keep a Changelog 风格,新版本段置 [Unreleased] 下;Added/Changed/Fixed/Removed 分类);**核对 `openspec/deferred.md`**(已实施归档的 change 从暂缓表移除/标 ✅,新增 deferred 残项登记,避免索引陈旧失真)
3. **bump**:`npm version patch|minor|major --no-git-tag-version`(新 API minor/破坏 major/修复 patch;**package-lock.json 一并 commit**)
4. **门禁**:按「发布前必跑顺序」全绿
5. **提交**:`git add -A && git commit -m "feat/fix/docs: ..."`
6. **推双远程**:`git checkout master` → `./scripts/publish-github.sh "release x.x.x: 一句话总结"`(要求工作区干净;完成后切回 develop)
7. **发 npm**:`npm publish`
8. **验证**:`npm view` + 临时安装 + CDN 可达性(见测试流程 §5)

## OpenSpec 流程
变更走 `openspec/changes/<date>-<name>/`(proposal/design/specs/tasks),索引在 `openspec/changes/README.md`,暂缓项在 `openspec/deferred.md`(每项带触发条件)。CLI 不可用,手动按 `archive/` 模板格式创建。
