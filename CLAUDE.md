# CLAUDE.md

本文件为 Claude(及兼容 Agent)在本仓库工作时的项目指引,请先通读再动手。
**架构细节**(流程图/数据槽深潜/能力全景/鲁棒性契约)在 `doc/architecture.md`(①-⑮);本文件只留不可违背的契约与操作知识。改某模块前先读对应 doc 章节。

## 项目概述

`page-agent-sdk`(npm 包名,仓库目录仍名 `zhuanti-agent`)是**框架无关的 JS SDK**:对话框形态挂载到任意网页,内置 ReAct 模式 Tool-Calling Agent,通过自定义 tool 读写宿主页面数据(属性注册表 + schema 校验)、GET 抓取文档,具备 planning / skills / 内存工作区 / context 管理能力。

**定位:规范化的 JSON 操作 Agent** —— 给 AI 一个结构化、安全的 JSON 操作通道(范围控制 + schema 校验 + jsonPath 增量 patch + 快照回退),区别于「让 AI 直接输出 JSON 字符串」的不可控方式。采用**自研 Deep Agents 风格 harness**(不引入 LangGraph/langchain 整包)。

- 构建产物:`dist/page-agent-sdk.{js,umd.cjs,iife.js,css}` + `dist/page-agent-sdk.headless.js`(`/headless` 子路径,纯核心不含 UI);类型声明 `types/index.d.ts` + `types/headless.d.ts`(**手动维护**);入口 `src/core/index.ts`(主,注入 UI)+ `src/core/index.headless.ts`(headless,不注入)

## Agent 身份

通用「JSON 操作助手」。systemPrompt 由 `createChatSdk({ systemPrompt })` 注入,不硬编码业务身份。
- **默认 systemPrompt**:用户不传时用内置 `DEFAULT_SYSTEM_PROMPT`(身份 + 能力概述 + `systemPromptHelpers.reliableWriteRules`,`---` 分隔);用户传了完全覆盖。`appendReliableWriteRules` 默认 `true`:自定义 systemPrompt 末尾自动追加写入规则;设 `false` 关闭(用默认 prompt 时无效,默认已含)。`createAgent` 层兜底 `'你是一个智能助手。'`
- **职责分工(重要)**:内置工具用法(read/write/get/set/patch/autoLock/snapshot/query/search/eval 等)由 `usageHints` 中间件按 `toolMode` 自动注入运行时 prompt,**集成方 systemPrompt 只写业务知识**(身份、字段含义、业务流程、技能引用),不要重复声明工具语法。**动态组件说明/按运行时状态注入**走 `augmentSystem({ state, data })` 钩子(每轮调,setData 后 data 自动同步),见 `doc/system-prompt.md` B6 段

## 技术栈

- **框架**:Vue 3.5(打包进 SDK,对外框架无关;非 peer);**构建**:Vite 8 库模式;**语言**:TypeScript 7
- **AI**:LangChain **浏览器子包**(`@langchain/openai` + `@langchain/core` + `@langchain/anthropic` optional),兼容 OpenAI 协议(默认)+ Anthropic 协议(`LLMConfig.provider:'anthropic'` 动态 import 走 Claude 原生协议);`llm` 可传 `BaseChatModel` 实例或 `LLMConfig`。**不引 langchain 整包/LangGraph**
- **MCP**:`@modelcontextprotocol/sdk`(optional peerDep,动态 import;浏览器仅 http/sse/websocket 远程 transport)
- **校验**:zod 4;**Markdown**:`marked` + `highlight.js` + `dompurify`(打包进库,仅主包)

## 常用命令

```bash
npm run dev       # 本地开发(端口 3000;被占则自动换)
npm run build     # 库模式构建到 dist/(lib + headless + iife 三产物)
npm run preview   # 预览构建产物
npm run test          # 自测(tsx 跑 src/__tests__/selftest.ts,1947 项断言)
npm run test:e2e      # 集成层 e2e(node 跑构建产物 dist,580 项;tests/e2e/<module>.mjs 按模块拆分)
npm run test:browser  # 浏览器 E2E(Playwright + mock LLM 双协议拦截,53 项;tests/browser/<demo>.spec.ts)
```

## 环境配置

AI 配置通过 `.env`(前缀 `VITE_`):`VITE_AI_API_KEY` / `VITE_AI_BASE_URL` / `VITE_AI_MODEL` / `VITE_AI_TEMPERATURE`(操作大 JSON 建议低温 0.3)/ `VITE_AI_MAX_TOKENS` / `VITE_AI_SYSTEM_PROMPT`(必须单行)。Anthropic 协议另用 `VITE_ANTHROPIC_API_KEY` / `VITE_ANTHROPIC_BASE_URL` / `VITE_ANTHROPIC_MODEL`(rag-demo 走此组;dev 缺省经 vite 代理 `location.origin/llm` → modelverse,**baseUrl 必须绝对 URL**—— @anthropic-ai/sdk buildURL 直接 `new URL(baseURL+path)`,相对路径抛 Invalid URL)。凭据只进 `.env`(gitignore),不进代码/仓库。

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
examples/                       # 各 demo(minimal/page/complex/nested/dynamic/subagent/mcp/human-confirm/planner/toolsets/animation/multi-agent/proxy/customize/rag/html-page/rag-subagent/headless)每个自带 index.html + main.ts
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
- **schema 白名单**(ZodObject):顶层 key 白名单;读统一 `projectBySchemaDeep` 深投影(未声明不泄露);写 `isPathAllowed` 逐段校验;整体 set = merge 语义(未声明保留防误删)
- **乐观锁契约**:`get_data`/`read` 附 `hash=xxx`;写传 `expectedHash` 或 `write` `autoLock`(默认开);hash 不匹配 → 挂起 `sdk.pendingConflict` → `resolveConflict('keep_external'|'overwrite'|'restore')`;**per-scope 基线**(子不污染主);**同 scope 连续写永不互相冲突**
- **高层 read/write**:`read` 多路径/裁剪/分页;`write` 四意图(set/patch/**patches 原子任一失败回滚**/del)+ `dryRun`;快照 per-path 栈 + `restore_data` + `history_data`;`eval_script` Worker 沙箱;`draft_*` opt-in(大 JSON 建议 maxToolRounds 20-30)
- **toolMode**:`simple`(默认 7)/`advanced`(14)/`minimal`(2);**interceptors 仅守高层 read/write**(advanced 绕过);受保护资源 freeze/verbatim(占位符只在读写边界替换,bind 恒持原值);**vfs 四池** LRU + 大结果外存
- **code-as-data-asset 扩展(3.0,createHtmlSubagent 单模式触发)**:`__pgId` 无感注入(schema extend → safeParse 不剥离 + read 投影隐藏 `__pg*` + 写 `isPathAllowed` 拒 `__pg*` 段,框架 afterWrite 独占补);**主 scope read 大文本摘要**(标记字段如 `code` → `<code Nkb>`,子 scope 完整);**两条 data 写路径** —— ① LLM write 工具(经完整契约:schema/乐观锁/快照栈/path guard)② 框架钩子(afterAgent commit 直改 bind,快路径,仅 code 字段豁免 write 契约,不进快照栈 + `recomputeBaseline` 防主 agent autoLock 误冲突)。详见子 agent 段「能力包」

### 记忆与上下文管理(详见 architecture.md §⑥⑮ + context-management.md)
- `summarization`(compressInput 不改原数组)与 `trimMemoryMessages`(OOM 裁剪)独立;`maxMemoryRounds >= summaryThresholdRounds`
- 压缩不丢关键信息:description 快照注入 + `preserveLastToolResults` + 写成功附 path + `reliableWriteRules`;压缩 LLM 摘要异步化(模板先行零阻塞 + 后台前缀缓存)
- 健壮性:窗口 ≥200K 硬约束;三闸阈值跟随 `setLlm`;overflow → 激进 trim → 重试 → 仍超抛;vfs 引用保护;系统段预算 25%;mission/workingMemory/focus 跨刷新持久化;`agentCompression` opt-in(decide 6s 超时降级静态)

### 规划与任务锚定
- `write_todos`(整表替换)+ `update_todo`(增量),一轮内不可混用;`maxPlanRevisions`(默认 5)防规划死循环;复杂度判断由 LLM 做
- **Mission**(默认开):会话级目标锚定,启发式 capture(宁漏不误)+ `send({mission})`;pin 段天然跨压缩
- **workingMemory**(默认开):捕获 read/query/search 的 locatedPaths + read hash(LRU ≤10),防压缩后重复检索/凭记忆写致 autoLock 误冲突
- **Focus**(默认开,opt-in 聚焦):三层收敛(提示 + 子树 schema 视野 + strict `PATH_DENIED`);API `setFocus`/`addFocus`/`removeFocus`/`clearFocus`/`getFocuses`;子 agent 继承全部焦点

### 子 agent 与并行编排(详见 architecture.md §⑨⑮)
- `spawn_agent`/`spawn_agents`(默认开)只返回最终结论(省 token);预声明 `subagents:[{id, description, …}]` 生成 `use_<id>`;`maxDepth`(默认 1)物理切断
- **授权面**:装配期 filter 排除框架/保留工具;spawn 自授剥离写工具(写权限仅经 `writablePaths`);子栈继承主 permissions/approval(approval_request 直通主循环);子 offload 直落主 vfs 共享池;**CA 并发修复(per-call 通道)**:中间件经 `ctx.callConfig` → coreExecTool 经 RunnableConfig.configurable 透传到工具 fn 第二参(`__pgSubagentCall` signal/emit/logSink、`__pgDataScope` 乐观锁 scope),`maxParallelTools>1` 并发不再闭包单变量互相覆盖(zod 校验重建 args 对象,args 注入通道不可行)
- **能力包**:`createRagSubagent({retriever?, loader?, useVfs?})`(只读检索)/ `createHtmlSubagent({writablePaths?, codeVfsPrefix?, codeField?, orchestratorPrompt?, formatCheck?, craftNotes?})`(**3.6+ `writablePaths` 可省**:装配期 `inferWritablePaths` 从 schema 顶层扫「数组元素含 codeField string」路径回填(info 留痕);开放 schema/嵌套容器/点路径 codeField 推断不出 → warn+throw 显式传,宁失败不猜错)(**3.0 单模式 breaking**:代码作 `data.code` 资产(进服务端 DB),vfs 作工作副本,框架 beforeAgent checkout(data.code→vfs by `__pgId`)/ afterAgent commit(vfs→data.code 增量,直改 bind 不进快照栈)自动搬运,主 agent 透明(主 scope read 见 `<code Nkb>` 摘要);`__pgId` 无感注入(schema 不声明/read 投影隐藏 `__pg*`/agent 写不进/persist 透明);去 `onComplete`/`codeRef`/`codeSnapshots`;单模式=**完整页面级 HTML**(自包含可独立成页,script/CSS 默认含、集中放 `<style>`/`<script>` 块便于下游提取,可引外部 JS/CSS;改造组件/独立页由下游插件/tool 做);`formatCheck` 默认开 = `validate_code` 自检 + verify beforeReturn 门禁,校验器 `validateHtmlFormat` 已导出(**只校验结构合法性**——标签闭合/注释/多余闭合;DOCTYPE/html/head/body/script 均允许),自纠上限 `maxVerifyAttempts:2`);**`codeField`**(默认 `'code'`,嵌套如 `'props.html_code'`,适配开放 schema 代码字段位置;「是否代码组件」= 该路径有 string)+ **装配期命中校验**(组件数>0 且全员未命中 → onWarning,防填错路径静默失败);**编排自适应注入**(createChatSdk 装配期零配置:`htmlOrchestratorPrompt(id)` 同源纯函数 —— 有 html agent→注入委派编排(custom code 不 read 不 write 全权 `use_<id>`)/ 无 agent+schema 有 code 字段→注入 `htmlDirectWriteFallback` 自己写+warn;开放 schema `z.any()` 扫不到时集成方 opt-in spread;opt-out `orchestratorPrompt:false`));**thinking-taming(真 LLM 实测驱动)**:① 委派 task 规格化 4 要素(实测完全生效;补视觉锚 + ⑤历史偏好转述)② validate_code jsonPath 零重传(**schema 描述/字段顺序/实现三处统一 jsonPath 首选** —— 实测工具 schema 反向引导会覆盖 system prompt)③ 写前简述 + 终稿纪律;**工匠笔记 `craftNotes`**(默认开):子 agent 收口回复 `[note]` 行 → 组件 `__pgNotes` sidecar(FIFO ≤5×200,随 data 持久化;收口文本经 **wrapModelCall 捕获进 state `__pgFinalText`** —— afterAgent 的 state.messages 只有初始 user 消息,beforeReturn 受 maxVerifyAttempts>0 门控,wrapModelCall 是唯一全路径覆盖点),下次委派同组件经文件地图注入「前任的交接」;read 投影隐藏/agent 写不进(`__pg*` 现成);`craftNotes:false` 关闭;**模型建议**:html 代码生成推荐强指令模型(deepseek-v4/claude/gpt-4o),flash 类放大过度思考
- **主×子协同**:per-scope 基线 / allSettled 逐任务结算 / 子 usage 回传 `sdk.usage` / `subagent.timeoutMs` opt-in;观察层 `inspect().subagent.{active,history}` + DebugDrawer tab

### 其他能力(详见 architecture.md §⑩⑪⑮)
- MCP 远程工具(allSettled 故障隔离 + 握手 15s 降级 + **callTool 超时闸 60s**(`callTimeoutMs` 可调,3.6+;超时回灌自纠不断连))/ Verify 自检 opt-in(`createWriteBackCheck` + adversarial)/ `get_dom` opt-in / `inspect_env` 默认开 / actions 宿主动作 / SkillSpec.exec(一次性)vs tools(反复查询)勿双轨 / Approval(无响应方 30s 自动拒)/ Checkpoint 每轮存档 / Automation 预算 + `sdk.batch`

### 对话鲁棒性(详见 architecture.md §⑮)
- **三档错误模型**:recoverable 回灌自纠 / fatal emit+中断 / observable 记录;导出 `routeError`/`asAgentError`/`agentError`
- 重试:网络/429/5xx 指数退避(maxRetries=2);4xx 与 abort 不重试;⚠️ **先排除 abort 再判 status**;abort 保留 partial
- **挂起有界收口三契约**:① 超时默认值表(approval 30s / MCP 15s / skills fetch 30s / 流停滞 `streamStallMs` 90s 抛 `StreamStalledError` 不重试);② 兜底收口必留痕;③ `activeControllers` core 级,unmount/switchSession/resetSession 先 abort 全部在途流
- **resetSession**(同步):abort + 收口冲突(keep_external)+ 重置全部内存态 + 新 sessionId;storage 关也完整执行
- **shareContext**:同 id 复用 AgentCore;串行闸与在途流注册表 **core 级**;收口中止共享 core 全部在途流
- `onEvent`(构造时)/`sdk.hook`(运行时,返回取消函数);流式事件仅 stream 模式;`approval_request` 不外发;运行时重配置 `setTools`/`setLlm`/`setMemory`/`setSubagents`(infoTick 刷新);`dedupeTools` 后注册覆盖先者

## 关键约定与坑

### LangChain 消息字段名
`ToolMessage` 构造参数用 snake_case `tool_call_id`(非 camelCase),否则报 `400 missing field tool_call_id`。`call.id` 可能 undefined,需生成兜底 id。

### ChatOpenAI 参数
用 `apiKey`(非 `openAIApiKey`)、`model`(非 `modelName`),`baseUrl` 通过 `configuration.baseURL` 传入。**Anthropic baseUrl 必须绝对 URL**(相对路径 buildURL 抛 Invalid URL)。

### 库构建 external
`vite.config.ts`:`vue` 打包进 SDK;`zod` / `@langchain/*` external(peerDep);`marked`/`highlight.js`/`dompurify` 打包进主包(headless 子路径不含)。dev 预构建:`optimizeDeps.include` 已预声明 MCP SDK 子路径,否则冷启动首次注入失败。

### 中间件生命周期
before 类正序、after 类逆序、wrap 类洋葱。新增能力做成**中间件或工具注入**,勿硬编码进 `createAgent`。

### 数据槽工具零桥接
工具函数体 `window` = 宿主页面主 window。改数据必经写工具(范围 + schema 校验 + 自动快照 + 自动乐观锁)。

### 测试流程

#### 1. 单元/集成自测(必跑,无 LLM 依赖)
```bash
npm test    # tsx 跑 src/core/__tests__/selftest.ts,1947 项断言
```
按模块拆分:`src/core/__tests__/modules/sec-NN.ts`(54+ 个模块)各导出 `run(ctx)`,runner 汇总;共享 `TestCtx` 在 `modules/_ctx.ts`。tsx 跑源码(不经构建),触不到 createChatSdk 顶层 API 作用域。**改任何核心模块后必跑**。

#### 2. 集成层 e2e(改 createChatSdk 顶层 API 后必跑)
```bash
npm run build && npm run test:e2e    # node 跑 dist 产物,580 项
```
模块在 `tests/e2e/<module>.mjs`(systemprompt/dynamic-register/inspect/subagents/events/storage/exports/data-slots/presets/boundary/custom-injection/conflict/automation/llm-provider/focus/resources/agent-compression/headless-subpath/capability-packs/authorization-surface/hang-feedback/main-sub-isolation/session-integrity),共享 stub 在 `tests/e2e/_helpers.mjs`(StubChatModel 在 `_stub-model.mjs`,响应队列驱动真 ReAct)。覆盖顶层 return 对象作用域。**改 createChatSdk 返回对象、AgentCore 接口、动态注册 API、默认提示词、新增导出/配置项后必跑**。

#### 2.5 浏览器 E2E(改 UI/ChatDialog/dataOps 后必跑)
```bash
npm run test:browser  # 53 项;也可 /browser-test 斜杠命令
```
**原理**:`tests/browser/_helpers.ts` 的 `mockLlm()` 用 `page.route()` 拦截 LLM API 端点,按脚本返回 SSE 流,使 agent ReAct 循环确定性走完,不依赖真 LLM。**双协议**:同时拦截 OpenAI 兼容(`**/chat/completions`)与 Anthropic Messages API(`**/v1/messages`),各返对应格式 SSE,共享 script 计数。spec 按 demo 拆分(page-demo 7 / complex-demo 12+ / nested 3 / error-recovery 2 / rag 2 / queue 3 / customize 7 / xss 2 / human-confirm 2 / html-page 7)。写新测试模板见 `.claude/skills/browser-e2e-testing/SKILL.md`。

#### 3. 浏览器手动验证(改 UI/示例后跑)
`npm run dev` 逐个 demo 验证(见目录结构 examples 清单;各 demo 侧重点见 `doc/usage-guide.md`)。

#### 4. 运行时手动验证(依赖 LLM/server)
子 agent 委派 / MCP / verify 自纠 / 真实 LLM 流式 / draft 真 LLM(`npm run test:draft-real`,无 key 自动 skip)。

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
每新增功能/配置项/导出 API,**必须同步补测试**(同 commit),至少 1 条「正常工作」+ 1 条「边界/错误」。判定:selftest = 底层纯函数/工具逻辑/中间件 hooks;e2e = 顶层返回对象方法/AgentCore/新 capabilities/新导出/inspect 反射。命名以 `✓` 开头写「功能名 → 预期行为」。**计数同步**:更新本文件断言计数(1947/580/53)与 README 中英文。自检:`npm test && npm run build && npm run test:e2e` 三绿方可提交。

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
  dialog: { theme: 'dark' },   // 内置深色主题(方舟专题设计稿色板;默认 light;可祖先覆盖 --cs-* 自定义)
}).mount()
// 运行时动态重配置:setTools/addTool/removeTool · setLlm · setMemory · setSubagents
```
- **capabilities**:默认开 `dataOps`/`fetch`/`planning`/`skills`/`vfs`/`summarization`/`memory`/`subagent`/`focus`/`workingMemory`/`missionAnchor`/`contextInspector`/`inspectEnv`;opt-in `verify`/`domInspect`/`automation`/`agentCompression`/`skillHostScript`/`draftWrite`
- **预设**(`presets`):`pageBuilder`(3.6+ 默认带 `createHtmlSubagent()`,getter 每次新建防共享突变;schema 无 code 数组装配期自动剔除降级)/ `researcher` / `minimal`,spread 进 `createChatSdk`
- **headless**(`ui: false`):不渲染内置对话框,用 `sdk.messages` + `send`/`stream` 自建 UI。**精简子路径** `page-agent-sdk/headless`(纯核心,ESM ~325KB vs 主包 ~789KB)。headless 持久化:`sdk.stream` 不自动落盘,每轮后手动 `sdk.afterRound()`(`send` 自动)。headless 调试复用内置 `DebugDrawer`(纯 props:`logs=sdk.debugLogs`/`getInfo`/`infoTick`/`getSkillContent`)
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
