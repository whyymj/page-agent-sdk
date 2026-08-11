# CLAUDE.md

本文件为 Claude(及兼容 Agent)在本仓库工作时的项目指引,请先通读再动手。

## 项目概述

`page-agent-sdk`(npm 包名,仓库目录仍名 `zhuanti-agent`)是**框架无关的 JS SDK**:对话框形态挂载到任意网页,内置 ReAct 模式 Tool-Calling Agent,通过自定义 tool 读写宿主页面数据(属性注册表 + schema 校验)、GET 抓取文档,具备 planning / skills / 内存工作区 / context 管理能力。

**定位:规范化的 JSON 操作 Agent** —— 给 AI 一个结构化、安全的 JSON 操作通道(范围控制 + schema 校验 + jsonPath 增量 patch + 快照回退),区别于「让 AI 直接输出 JSON 字符串」的不可控方式。

采用**自研 Deep Agents 风格 harness**(不引入 LangGraph/langchain 整包)。

- 构建产物:`dist/page-agent-sdk.{js,umd.cjs,iife.js,css}` + `dist/page-agent-sdk.headless.js`(`/headless` 子路径,纯核心不含 UI);类型声明 `types/index.d.ts`(手动维护)+ `types/headless.d.ts`(核心子集);入口 `src/core/index.ts`(主,注入 UI)+ `src/core/index.headless.ts`(headless,不注入)

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
npm run test          # 自测(tsx 跑 src/__tests__/selftest.ts,1748 项断言)
npm run test:e2e      # 集成层 e2e(node 跑构建产物 dist,495 项;tests/e2e/<module>.mjs 按模块拆分)
npm run test:browser  # 浏览器 E2E(Playwright + mock LLM 双协议拦截,41 项;tests/browser/<demo>.spec.ts)
```

## 环境配置

AI 配置通过 `.env`(前缀 `VITE_`):`VITE_AI_API_KEY` / `VITE_AI_BASE_URL` / `VITE_AI_MODEL` / `VITE_AI_TEMPERATURE`(操作大 JSON 建议低温 0.3)/ `VITE_AI_MAX_TOKENS` / `VITE_AI_SYSTEM_PROMPT`(必须单行)。Anthropic 协议另用 `VITE_ANTHROPIC_API_KEY` / `VITE_ANTHROPIC_BASE_URL` / `VITE_ANTHROPIC_MODEL`(rag-demo 走此组;dev 缺省经 vite 代理 `location.origin/llm` → modelverse,**baseUrl 必须绝对 URL**—— @anthropic-ai/sdk buildURL 直接 `new URL(baseURL+path)`,相对路径抛 Invalid URL)。凭据只进 `.env`(gitignore),不进代码/仓库。

上下文压缩策略不经 `.env`,由 `createChatSdk({ contextOptions, summaryLlm, maxMemoryRounds, contextPreset })` 显式配置。

## 目录结构

```
src/core/                       # 通用 SDK 核心(框架无关)
├── harness/                    # 自研 agent harness(createAgent ReAct 循环 + 中间件)
│   ├── createAgent.ts/middleware.ts/state.ts/errors.ts/retry.ts/budget.ts/pool.ts/serialRunner.ts
│   ├── todos/skills/memory/permissions/summarization/subagent/verify/usageHints/focus/mission/workingMemory/resourcesPin/contextInspector
├── sdk/                        # createChatSdk(命令式入口:_createChatSdk 内部工厂 + mountChatDialog 可注入 UI,依赖反转)/ defineTool / promptBuilder / llmResolver / conflictManager / optionsResolver / events / contextPreset / ragSubagent / htmlSubagent / toolRegistry
├── tools/                      # dataOps / fetchDoc / dataSlotQuery / jsonUtils / schemaUtils / resources / sandbox / domTool / envTool(纯函数抽离)
├── toolsets.ts                 # 内置工具集预设
├── backends/{vfs,storage,skillStore}.ts # 内存工作区 / 持久化存储 / skill 独立持久化
├── mcp/client.ts               # MCP client
├── llm/{proxyLlm,constructLlm}.ts # 代理连接(防 apiKey 泄露)/ LLM 构造工厂(openai 同步 / anthropic 动态 import)
├── composables/                # useChat / useContextManager / useMarkdown / contextIndex / chatContext(provide/inject)
├── components/                 # ChatDialog(组合容器:provide ctx + 9 区块 slot/sections)/ MessageContent / CodePreview / DebugDrawer / ChatHeader / ChatInput / QueuedBar / ApprovalBar / ConflictBar / FocusBar / SkillPanel / message/(MessageRow + MessageList)
├── presets.ts / types/index.ts / index.ts(主入口,注入 mountChatDialog)/ index.headless.ts(headless,不含 UI)
examples/                       # 各 demo(page/complex/nested/dynamic/subagent/mcp/human-confirm/planner/toolsets/animation/multi-agent/proxy/customize/rag/html-subagent/rag-subagent)每个 demo 目录自带 index.html + main.ts
doc/                            # architecture.md + README.md(索引)
demo/plain.html                 # 框架无关集成示例
skills/                         # 分发给使用者的 Agent Skill(入 npm 包 files)
```

## 架构要点

### 自研 harness
- `createAgent`:ReAct 循环 + 可插拔中间件,不绑定具体工具/能力
- **中间件契约**(`Middleware`):`beforeAgent`/`wrapModelCall`/`beforeModel`/`afterModel`/`wrapToolCall`/`afterAgent`/`beforeReturn` + `augmentPrompt`/`compressInput`/`tools`。before 类正序、after 类逆序、wrap 类洋葱
- 内置装载序:`usageHints → todos → skills → vfs → summarization → memory → permissions → verify → subagent → 用户自定义`(pin 段中间件 mission/workingMemory/focus/resourcesPin 全 Infinity 尾随,靠声明序)
- `createChatSdk` 组装:harness + 内置工具(`dataOps`/`fetchDoc` 默认装,经 `capabilities` 关)+ 用户 `tools`/`skills`/`memory`/`data`/`middleware`

### 数据槽操作
- 集成方声明 `data: { schema, bind, description?, resources? }`(单主对象;`bind` 必填,直连 reactive/普通对象,工具直接读写 bind,不挂 window);运行时替换:`sdk.setData(config)` / `sdk.getData()`(旧快照清空、乐观锁基线重置;`createDataOps` 工具数组挂不可枚举 `controller`,运行时即时生效)
- 工具:`describe/get/set/edit/delete_data` + `restore_data` + `query/search_data` + `eval_script` + 高层 `read/write` + `history_data`/`diff_data` + `schema_data`
- **schema 形状白名单**:`ZodObject` 时顶层 key 为可读写白名单。**读路径统一深投影**(`projectBySchemaDeep` 单一口径:read 整体/get_data 整体/jsonPaths 根/query/search/eval 根/diff 一律递归投影,未声明字段不泄露);`write`/`edit`/`delete` 的 `jsonPath` 经 `isPathAllowed` **逐段校验**(ZodArray 严格判索引 `/^\d+$/`;discriminatedUnion/union 静态不知 option → 降级开放,交 `schema.safeParse` 兜底);整体 set 自动转 **merge 语义**(未声明字段保留防误删);拦截器补充的未声明字段同样被白名单挡下。非 ZodObject 全开放向后兼容
- **校验与错误**:`set/edit/delete` 仅限白名单字段,按 schema 校验,不合法返回**结构化错误**(不写入)
- **快照回退**:`set/edit/delete` 前自动存快照(per-path 栈);`restore_data` 一键回退;`history_data({list:true})` 只读查看快照时间线
- **乐观锁 + 冲突人工介入**:`get_data`/`read` 返回附 `hash=xxx`;写工具传 `expectedHash` 或高层 `write` `autoLock`(默认开,用最后 read 的 hash)启用 —— 外部改过(hash 不匹配)触发冲突:默认挂起,`sdk.pendingConflict`(ref)+ ChatDialog 冲突条三选一 → `sdk.resolveConflict('keep_external'|'overwrite'|'restore')` 收口;headless 可 watch 自建 UI。**per-scope 基线**:基线 Map 按 caller scope 隔离,子 agent 委派期间经 scope proxy 切换,子 read/write 不污染主基线;**契约:同 scope 连续写永不互相冲突**(写成功即刷基线,解析→检查→提交同步无 await)
- **高层 `read`/`write`**:`read({jsonPath?, jsonPaths?, fields?, depth?, offset?, limit?})`(多路径一次读、字段裁剪、深度截断、数组分页);`write({value?, patch?, patches?, del?, dryRun?})` 四意图(整体 set / 单 patch / **批量 patches 原子应用任一失败回滚** / 删除)+ dryRun 预检(校验链全走但不落盘,冲突照常检测不挂起)
- **eval_script**:`transform` 沙箱脚本(Worker 三层防护)返回新值或 `{patches}` 增量;`jsonPath` 子树模式(仅 clone 子树,>100KB 超时自适应)
- **分块写 draft_write/draft_commit**(opt-in `capabilities.draftWrite`):大 JSON 分块构建(类 git add→commit),commit 走完整校验链 + 乐观锁;大 JSON 场景建议 `maxToolRounds` 调到 20-30
- **toolMode**:`simple`(默认,7 工具:主推 read/write)/ `advanced`(14,全暴露)/ `minimal`(2);`filterByToolMode` 纯函数;usageHints 按 mode 注入
- **interceptors**:`read(value)` 脱敏/派生(只改 LLM 看到的值);`write(payload, current)` 转换/审计/拒绝(返回 `{error}`)。**仅守高层 read/write;advanced 底层工具绕过**(集成方需知情);`input(input)`/`output(json)` 在 agent IO 入口/出口改写
- **受保护资源(opt-in)**:`data.resources: [{path, mode}]`;`freeze` 只读(read 返 `⟦frozen:path⟧` 占位符,写撞 `FROZEN_FIELD`);`verbatim` 原样保留(read 返 `⟦res:handle⟧`,改值经 `resource_update`,直写新值 `VERBATIM_MISMATCH`)。**bind 恒持原始值,占位符只在读写边界替换**(hash/快照/乐观锁零干扰);强制层 `enforceSet`/`enforcePatches` 先于 schema 校验;需 vfsStore;配 `resourcesPin` 跨压缩注入。详见 `src/core/tools/resources.ts` + skill `precise-value-protection`
- **vfs 四池**:`large_results`(4MB)/`drafts`(2MB)/`userFiles`(2MB)/`resources`(4MB)独立 LRU;`vfs.maxBytes` 默认 8MB 总上限兜底。JSON 感知工具:`vfs_json_read`/`vfs_json_patch`/`vfs_write({jsonString})`
- **大结果外存**:工具结果超自适应阈值(窗口 3.5% 推导,clamp [2000,20000])转存 vfs,留预览 + 引用;`offloadLargeResult` 返回结构化 `OffloadResult`
- **零桥接**:工具直接读写 `bind`(reactive 响应式);审计:set/edit/delete/restore 记日志(onAudit 回调)
- 详细工具语义/JSONPath 子集/sandbox 禁用列表/错误码见 `src/core/tools/dataOps.ts` 与 `dataSlotQuery.ts`

### 记忆与上下文管理
- **上下文压缩**(纯内存、会话级):`summarization` 中间件复用 `useContextManager`(滑动窗口 + 摘要 + 关键词召回);`contextPreset`:`auto`/`conservative`/`aggressive`/`complex`(比例制);预设比例映射在 `sdk/contextPreset.ts`
- **压缩 LLM 摘要异步化**:模板先行 + 后台前缀缓存 —— 触发时立即用索引摘要返回(零阻塞),fire-and-forget 后台 LLM 入前缀缓存(`{coveredCount, text}`);后续命中:全覆盖直接用 / 部分覆盖 = LLM 前缀 + 尾部索引增量;失败不污染缓存。agentCompression 的 decide(≤6s)维持同步(opt-in 默认关)
- **压缩不丢关键信息**:① 压缩时注入当前主数据 description 快照;② `preserveLastToolResults`(默认 `['describe_data','read']`)跨轮保留工具 result 摘要;③ 写成功返回附可操作 path 列表;④ `systemPromptHelpers.reliableWriteRules` 建议拼进 systemPrompt
- **双摘要协同**:`summarization`(compressInput,不改 messages 原数组)与 `trimMemoryMessages`(afterRound,内存 OOM 裁剪)独立。配置建议:`maxMemoryRounds >= summaryThresholdRounds`
- **跨轮召回 + trim 异步增强**:关键词召回纳入 `steps.result`;trim 触发后同步模板占位 + 异步 LLM 增强(fire-and-forget,竞态守卫,失败保留模板)
- **上下文持久化韧性**:mission/workingMemory/focus 跨刷新持久化(switchSession 切走前补 persist);trim 删前 emit `context_trimmed`(dropped 原文 + 引用的 vfs 大结果)+ 可达性 GC;vfs 在 storage 开时随 persist 持久化
- 纯内存上限:vfs `maxBytes` 四池 LRU;对话历史 `maxMemoryRounds`(默认 30)超限压缩
- **上下文健壮性**:窗口 ≥200K 硬约束(`MIN_CONTEXT_WINDOW`,启动/setLlm/子 agent 解析后校验);三闸阈值(offload/trim/compress)跟随 `setLlm` 新窗口;反应性兜底:context overflow 识别 → 激进 trim → 单次重试 → 仍超抛;vfs 引用保护(LRU 跳过被引用 large_results);系统段预算(超 25% 窗口 drop 非 pin 段;systemPrompt 本身超预算 fatal 早退)
- **压缩决策 agentCompression**(opt-in):gate(`shouldTriggerCompression`)通过才 `summaryLlm.decide`(两段式工具循环:bind 临时 `inspect_context` 工具 → 模型查构成 → 回灌 → JSON schema 校验;`decisionTimeoutMs` 6s / `decisionMaxTokens` 2048);决策覆盖切分/摘要 mode/召回/preserve;失败降级静态压缩;决策经 `inspect().lastCompression` 可观测

### 规划与任务锚定
- **自适应规划**:`write_todos`(整表替换,框架生成 id `t-1/t-2…`)+ `update_todo({id, content?, status?})`(增量改单项);一轮内两者不可混用;`maxPlanRevisions`(默认 5)防规划死循环:主数据写工具成功才退出规划,超限回灌「停止调研去执行」;复杂度判断由 LLM 做(usageHints 引导),框架不做启发式;`capabilities.planning:false` 关
- **Mission**(默认开 `capabilities.missionAnchor`):会话级目标锚定 `{goal, acceptanceCriteria?, …}`;首条任务型 user 启发式 capture(宁漏不误)+ `send({mission})`/`setMission` 显式;`augmentPrompt` 每轮注入 pin 段(在 state 不在 messages → 天然跨压缩)
- **workingMemory**(默认开 `capabilities.workingMemory`):自动捕获 `read`/`query_data`/`search_data` 的 locatedPaths(LRU ≤10)+ read hash(lastHashes,LRU ≤10);pin 段每轮注入跨压缩;防压缩后重复检索/凭记忆写致 autoLock 误冲突
- **Focus 上下文聚焦**(默认开 `capabilities.focus`,opt-in 需主动聚焦):多焦点 `Focus[] {path, label?}`;三层收敛 —— 目标提示 + 子树 schema 视野 + **范围 strict**(写工具 `jsonPath` 不在任一焦点子树 → `PATH_DENIED` 回灌自纠;无 jsonPath 整体写 = 越界拒;eval_script 参与拦截;vfs_write/vfs_edit 不拦);API `setFocus`/`addFocus`/`removeFocus`/`clearFocus`/`getFocuses` + agent 工具(advanced)+ ChatDialog 输入框 chip + user message 焦点历史标注;持久化 + 子 agent 继承全部焦点

### 子 agent 与并行编排
- `spawn_agent`/`spawn_agents`(默认开):委派独立子 agent,只返回最终结论(省 token);预声明 `subagents:[{id, description, …}]` 自动生成 `use_<id>` 委派工具;`maxDepth`(默认 1)物理切断
- **授权与拦截面**:子池装配期源头 filter(排除 `spawn_*`/`use_*`/`load_skill`/`write_todos`/`update_todo`/`restore_last_checkpoint`/`request_human_confirmation`/`*_focus` 等框架/保留工具);`allTools` getter 指向 agent 合并池(含中间件工具);spawn 自授 `tools` 剥离写工具(写权限仅经 `writablePaths` path guard,含 patches 无 jsonPath 根写拦截);**子栈继承主 permissions/approval 实例**,子的 approval_request 直通转发回主循环;子 offload 直落主 vfs 共享池(vfs-bridge)
- **子 agent 扩展**(`SubagentConfig`):`allowedTools`(额外工具名)/`middleware`(自定义)/`summarization`(跨轮压缩);`sdk.vfsWrite(path, content)` 集成方注入 vfs 文件
- **能力包工厂**(opt-in 可组合):`createRagSubagent({retriever?, loader?, useVfs?})`(多源知识检索,只读)/ `createHtmlSubagent({writablePaths, codeVfsPrefix?})`(代码组件生成:代码正文→vfs,data 存 codeRef;装 todos + summarization)
- **观察层**:`createSubagentTracker` 会话级 active/history 运行态(纯观察,不改生命周期);`inspect().subagent.{active,history}` + DebugDrawer「🤖 子 agent」tab
- **主×子协同**:per-scope 乐观锁基线(子上);spawn_agents allSettled(单失败不拖垮整批,逐任务 ✓/✗ 结算);子 usage 回传 `core.usage`(`sdk.usage` 含子消耗);子执行超时 opt-in(`subagent.timeoutMs`,链式 abort)

### 其他能力
- **MCP**:`createChatSdk({ mcp: [{ transport, url, name?, timeoutMs? }] })` 连远程 server 动态注入 tools(`Promise.allSettled` 故障隔离;握手 15s 超时降级);动态 import;dev 需 `optimizeDeps.include` 预声明
- **Verify 自检**(opt-in `capabilities.verify`):agent 返回前跑 `check`,不通过 feedback 回灌自纠(限 `maxAttempts`);内置 `createWriteBackCheck()`(写操作读回 + schema 校验);可自定义 + adversarial 对抗验证
- **DOM 读取**:`get_dom`(opt-in `capabilities.domInspect`):结构化 `{tag, attrs, text, children[]}`,`depth` 默认 3,attrs 白名单 id/class/style/href+data-*
- **环境探查**:`inspect_env`(默认开 `capabilities.inspectEnv`):window 安全摘要 + `key` 读调试变量;`safeSerialize` 防超大
- **actions 宿主动作**:`createChatSdk({ actions: { name: { description, run, params? } } })` 自动包成命名 tool;run 异常隔离(错误字符串回灌自纠)
- **Skill 扩展**:`SkillSpec.exec`(加载时执行脚本:sandbox 默认三层防护 / host 需 `capabilities.skillHostScript` 且仅集成方内联;失败不缓存)+ `tools`(附带工具工厂,load_skill 后注入,卸载随 setSkills);exec=一次性初始化,tools=反复查询,勿双轨
- **Approval 人工确认**:`approval:{ tools?, confirm?, timeoutMs? }` 工具调用前 human-in-the-loop;无响应方路径 30s 自动拒(`APPROVAL_AUTO_REJECTED`);UI 交互确认无限等用户
- **Checkpoint**(opt-in `checkpoint:true`):每轮自动存档(对话 + bind + vfs + todos),脏标记增量 save;`restoreLastCheckpoint()` / LLM 工具 / UI 回退按钮;叶子 bind(原始类型)无法就地还原
- **Automation**(opt-in `capabilities.automation`):tokenBudget/timeBudgetMs 资源预算 + maxAutoRetries 错误恢复 + 断点续跑 + `sdk.batch` 批处理

### 对话鲁棒性
- 模型调用自动重试(`harness/retry.ts`):网络/429/5xx 指数退避(默认 `maxRetries`=2);4xx 与 abort 不重试;⚠️ 错误判定**先排除 abort 再判 status**
- 停止生成(abort):signal 穿透 `llm.stream`;abort 保留已生成 partial
- **挂起有界收口三契约**:① 超时默认值表(approval/humanConfirm 无响应方 30s 自动拒 / MCP 握手 15s / skills fetch 30s / LLM 流停滞看门狗 `streamStallMs` 90s,`StreamStalledError` 408 不重试);② 兜底收口必留痕(结构化 error/warn/debugLogs);③ abort 收口:`activeControllers` 注册表 **core 级**,send/batch 接 `signal` 可中断;unmount/switchSession/resetSession 先 abort 全部在途流再收口
- **resetSession**(同步公开 API):abort 在途流 + 收口挂起冲突(keep_external)+ 重置全部内存态(messages/vfs/todos/memory/mission/workingMemory/focus/checkpoint/debugLogs)+ 新 sessionId;**storage 关也完整执行**(store 相关才门控)
- **shareContext**:同 `id` 多实例复用同一 `AgentCore`;**串行闸与在途流注册表 core 级**(send/batch/switchSession/stream 全经 `core.runSerial`);生命周期收口中止共享 core 的**全部**在途流(含其他实例发起的)
- **onEvent 事件回调**:构造时订阅常用时机(`data_change`/`message_update`/`tool_call`/`tool_result`/`text`/`round_start`/`done`/`usage`/`session_restored`/`error` 等);`approval_request` 不外发;流式事件仅 stream 模式。**`sdk.hook(handler)`** 运行时动态订阅(返回取消函数)
- **便捷 API**:`exportData()`/`importData(json,{validate?})`/`setSkills`/`invalidateSkillCache`/`addSkill`/`removeSkill`/`listUserSkills`/`getUserSkill`(用户 skill 独立 SkillStore 持久化,默认 indexedDB)/ `sdk.usage` 累计 token
- **运行时动态重配置**(零破坏):`setTools`/`addTool`/`removeTool`(内置不动,rebind)/ `setLlm`(切模型/切 provider;重解析窗口)/ `setMemory(string|同步/异步函数;异步后台求值,`refreshMemory` 强制)`/ `setSubagents`/`addSubagent`/`removeSubagent`(需创建时配 `subagents:[]`)。均触发 `infoTick++` DebugDrawer 刷新
- **工具重名覆盖**:装配期 `dedupeTools` 按名去重,后注册覆盖先者 + warn;`removeTool` 仅删用户工具(禁用内置用 `capabilities`)
- **SkillPanel**:ChatDialog 内置 skill 管理面板(创建/编辑/删除用户 skill),已从入口导出
- **三档错误模型**:`AgentError.severity`(recoverable 回灌 LLM 自纠 / fatal emit+中断 / observable 记录);`routeError`/`asAgentError`/`agentError` 导出(框架内置 catch 用简化路由,供集成方自定义);`onEvent('error')` payload 带 `{severity?,code?,context?}`

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
npm test    # tsx 跑 src/core/__tests__/selftest.ts,1748 项断言
```
按模块拆分:`src/core/__tests__/modules/sec-NN.ts`(53+ 个模块)各导出 `run(ctx)`,runner 汇总;共享 `TestCtx` 在 `modules/_ctx.ts`。tsx 跑源码(不经构建),触不到 createChatSdk 顶层 API 作用域。**改任何核心模块后必跑**。

#### 2. 集成层 e2e(改 createChatSdk 顶层 API 后必跑)
```bash
npm run build && npm run test:e2e    # node 跑 dist 产物,495 项
```
模块在 `tests/e2e/<module>.mjs`(systemprompt/dynamic-register/inspect/subagents/events/storage/exports/data-slots/presets/boundary/custom-injection/conflict/automation/llm-provider/focus/resources/agent-compression/headless-subpath/capability-packs/authorization-surface/hang-feedback/main-sub-isolation/session-integrity),共享 stub 在 `tests/e2e/_helpers.mjs`(StubChatModel 响应队列驱动真 ReAct)。覆盖顶层 return 对象作用域。**改 createChatSdk 返回对象、AgentCore 接口、动态注册 API、默认提示词、新增导出/配置项后必跑**。

#### 2.5 浏览器 E2E(改 UI/ChatDialog/dataOps 后必跑)
```bash
npm run test:browser  # 41 项;也可 /browser-test 斜杠命令
```
**原理**:`tests/browser/_helpers.ts` 的 `mockLlm()` 用 `page.route()` 拦截 LLM API 端点,按脚本返回 SSE 流,使 agent ReAct 循环确定性走完,不依赖真 LLM。**双协议**:同时拦截 OpenAI 兼容(`**/chat/completions`)与 Anthropic Messages API(`**/v1/messages`,provider:'anthropic' 走此端点,rag-demo),各返对应格式 SSE,共享 script 计数。spec 按 demo 拆分(page-demo 6 / complex-demo 12+ / nested 3 / error-recovery 2 / rag 2 / queue 3 / customize 7 / xss 2 / human-confirm 2)。写新测试模板见 `.claude/skills/browser-e2e-testing/SKILL.md`。

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
每新增功能/配置项/导出 API,**必须同步补测试**(同 commit),至少 1 条「正常工作」+ 1 条「边界/错误」。判定:selftest = 底层纯函数/工具逻辑/中间件 hooks;e2e = 顶层返回对象方法/AgentCore/新 capabilities/新导出/inspect 反射。命名以 `✓` 开头写「功能名 → 预期行为」。**计数同步**:更新本文件断言计数(1748/495/41)与 README 中英文。自检:`npm test && npm run build && npm run test:e2e` 三绿方可提交。

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
  contextPreset: 'auto', subagents: [{ id, description }],
  capabilities: { verify: true }, verify: { maxAttempts: 2 },
  approval: { tools: ['write'] }, checkpoint: true, middleware: [...],
}).mount()
// 运行时动态重配置:setTools/addTool/removeTool · setLlm · setMemory · setSubagents
```
**headless**(`ui: false`):不渲染内置对话框,用 `sdk.messages` + `send`/`stream` 自建 UI。**精简子路径** `page-agent-sdk/headless`(纯核心,ESM ~325KB vs 主包 ~789KB;依赖反转:`_createChatSdk(options, mounter?)`,主入口注入 UI/headless 不注入)。**headless 持久化**:`sdk.stream` 不自动落盘,每轮后手动 `sdk.afterRound()`(`send` 自动持久化)。**headless 调试**:复用内置 `DebugDrawer`(仅主包;纯 props:`logs=sdk.debugLogs` / `getInfo` / `infoTick` / `getSkillContent`)。

**capabilities 开关**:默认开:`dataOps`/`fetch`/`planning`/`skills`/`vfs`/`summarization`/`memory`/`subagent`/`focus`/`workingMemory`/`missionAnchor`/`contextInspector`/`inspectEnv`;默认关(opt-in):`verify`/`domInspect`/`automation`/`agentCompression`/`skillHostScript`/`draftWrite`。

**预设**(`presets`):`pageBuilder` / `researcher` / `minimal`,spread 进 `createChatSdk`。

**UI 模块可复用**:`ChatDialog` / `MessageContent` / `CodePreview` / `DebugDrawer` / `SkillPanel` + `useChat` 均从入口导出。`inspect()` 的 `AgentInfo` 含每工具 `source`/mcp/上下文构成等。框架无关集成见 `demo/plain.html`。

**markdown 渲染性能**:`useMarkdown` 尾随节流(大内容 ≤100ms 渲染一次 + 尾沿保证)+ hljs 尺寸闸(单代码块 >20K 跳高亮转义直出;**sanitize 永不跳过**)。导出 `renderMarkdownHtml`/`markedToHtml`/`HLJS_BLOCK_MAX_CHARS`(仅主包)。

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
2. **更新中英文文档**(同步勿漏单边):`README.md`(英)/`README.zh-CN.md`(中)/`doc/README.md`+`doc/README.en.md`/`doc/usage-guide.md`+`.en`/`CLAUDE.md`(内部)
3. **bump**:`npm version patch|minor|major --no-git-tag-version`(新 API minor/破坏 major/修复 patch;**package-lock.json 一并 commit**)
4. **门禁**:按「发布前必跑顺序」全绿
5. **提交**:`git add -A && git commit -m "feat/fix/docs: ..."`
6. **推双远程**:`git checkout master` → `./scripts/publish-github.sh "release x.x.x: 一句话总结"`(要求工作区干净;完成后切回 develop)
7. **发 npm**:`npm publish`
8. **验证**:`npm view` + 临时安装 + CDN 可达性(见测试流程 §5)

## OpenSpec 流程
变更走 `openspec/changes/<date>-<name>/`(proposal/design/specs/tasks),索引在 `openspec/changes/README.md`,暂缓项在 `openspec/deferred.md`(每项带触发条件)。CLI 不可用,手动按 `archive/` 模板格式创建。
