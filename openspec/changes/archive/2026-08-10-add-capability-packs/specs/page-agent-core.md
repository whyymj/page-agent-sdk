# Specification Delta: page-agent-core

> 本文件为 change `add-capability-packs` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。归档时合入主 specs。5 个 Requirement 相互独立(架构扩展 3 条是两工厂的依赖,可单独合入)。

## Requirement: 预声明子 agent 针对性配置扩展(allowedTools + middleware)

预声明子 agent(`SubagentConfig`)支持**针对性配置**:经 `allowedTools` 从主 allTools 额外拿工具(追加到默认只读白名单),经 `middleware` 装自定义中间件。让专用子 agent(RAG/HTML 等)能按任务性质装备合适工具与能力,而非只有固定只读白名单 + skills + extraTools。**全向后兼容(可选字段,不传 = 现状固定配置子 agent,零回归)**。

- **`SubagentConfig.allowedTools?: string[]`**:工具名白名单,**追加**到 `runSubagent` 的默认只读集(`DEFAULT_READONLY_TOOLS` + allowedTools);从主 allTools 筛选(主中间件创建、绑定主 store 的工具实例,如 `vfs_grep`/`vfs_read`/`vfs_json_read`/`draft_write`/`draft_commit`)。`configToSubOpts` 透传到 `SubagentOptions.allowedTools`(该字段已存在,spawn 运行时路径已消费;本次补预声明路径透传)。
- **`SubagentConfig.middleware?: Middleware[]`**:子 agent 自定义中间件数组。`SubagentOptions` 加同字段;`runSubagent` 的 child middleware 列表在 focus 之后追加 `opts.middleware`(对齐主 agent「内置 → 用户自定义」装载序)。用途:子 agent 装 `createTodosMiddleware()` 获得 `write_todos`/`update_todo` 规划能力(这些工具是中间件创建、绑定子 agent 自己 todos state 的,不能当 extraTools 传)。
- **向后兼容**:两字段可选,默认 undefined;不传 → `configToSubOpts` 不透传 → `runSubagent` 走现状固定配置(skills + 递归 subagent + focus)。现有预声明子 agent / spawn_agent / spawn_agents 用法零变化。
- **可测约束**:① SubagentConfig 传 `allowedTools:['vfs_grep']` → configToSubOpts 返回对象含 allowedTools → runSubagent 的子工具池含主 vfs_grep(从主 allTools 拿);② 传 `middleware:[mw]` → 子 agent createAgent 的 middleware 列表含 mw(子 agent 获得该中间件的工具/state);③ 不传两字段 → 子 agent 配置与现状一致(工具池 = 默认只读 + extraTools;middleware = skills+递归+focus)。

## Requirement: vfs 异步写入 API(sdk.vfsWrite)

`ChatSdk` 实例暴露 `vfsWrite(path, content)` 方法,供集成方在 agent 运行时**异步注入/更新 vfs 文件**(RAG 文档池、动态补充资料等),突破现状仅同步 `vfs.initialFiles` 的限制。写入归 `userFiles` 池(集成方注入语义,不挤占 large_results/drafts LRU)。storage 开启时触发 persist。

- **签名**:`vfsWrite: (path: string, content: string | object) => void`。content 为字符串直存;对象则 `JSON.stringify`(便于集成方直接传结构化文档对象)。写入 `vfsStore.files[path] = { content, size, pool:'userFiles', createdAt }`(Proxy 捕获 → persist)。
- **与 `vfs_write` 工具一致语义**:`vfs_write` 是 agent 工具(LLM 调用);`sdk.vfsWrite` 是集成方侧命令式入口(集成方主动注入)。两者写同一 vfsStore,agent 经 `vfs_read`/`vfs_grep` 可读。
- **RAG 文档池模式**:集成方 `sdk.vfsWrite('docs/components/hero.md', docText)` 异步注入组件文档 → RAG 子 agent 经 allowedTools 拿的 `vfs_grep`/`vfs_read` 搜索 → 命中。解「RAG agent 启动后动态补文档」。
- **可测约束**:① `sdk.vfsWrite` 为 function;② 调后 `sdk` 内部 vfsStore.files[path] 存在且 content 正确(经 read 工具或 inspect 可验证);③ 对象 content 被 JSON.stringify;④ storage 开启时触发 persist(或至少 files 更新);⑤ 归 userFiles 池(不污染 large_results)。

## Requirement: RAG 检索子 agent 工厂(createRagSubagent)

系统提供工厂 `createRagSubagent(options): SubagentConfig`,构造**多源知识检索子 agent**:集成方按需配知识源(语义检索 retriever / 异步加载 loader / vfs 搜索),SDK 装备对应工具(`search_docs`/`load_doc`/主 vfs 工具)+ 内置 RAG systemPrompt + rag-search skill。返回标准 SubagentConfig,集成方塞 `subagents:[createRagSubagent({...})]` → 主 agent 自动获得 `use_rag` 委派工具,把「需查阅文档才能回答/配置」的子任务委派给独立上下文的 RAG 子 agent(检索的大段文档不污染主上下文)。**opt-in(默认不挂 = 现状零变化)**。

- **多源工具(集成方按需配,至少一种)**:① `retriever?: (query, opts?) => Promise<RagHit[]>`(语义检索,向量库/embedding)→ 装 `search_docs({query, topK?})`;② `loader?: (source) => Promise<RagHit|RagHit[]>`(异步加载指定源)→ 装 `load_doc({source})`;③ `useVfs?: boolean`(默认 true,主开 vfs 时)→ allowedTools 拿 `vfs_grep`/`vfs_read`/`vfs_json_read`(搜集成方 `sdk.vfsWrite`/`initialFiles` 注入的文档);④ `fetch_document`(子 agent 默认只读有,公网 URL 兜底)。`RagHit = { content: string; source?: string; score?: number }`。
- **框架无关 + 注入式**:SDK 不绑定数据源(不打包向量库/embedding SDK);retriever/loader 集成方实现。延续 `data.bind`/`llm` 注入哲学。
- **工具式(子 agent 自主多轮检索)**:retriever/loader 包成子 agent 工具(经 extraTools),子 agent 自主决定查什么/查几次/何时充分。retriever/loader 抛错 → try/catch 降级错误字符串回灌(换关键词/source 重试),不崩 agent。
- **返回标准 SubagentConfig(复用架构扩展)**:`{ id, description, systemPrompt, tools:[search_docs?/load_doc?], allowedTools:[vfs_*]?, skills:[ragSearchSkill], maxToolRounds }`。下游自动生成 `use_<id>`(默认 `use_rag`);子 agent 继承默认只读主数据工具 + vfs(经 allowedTools)。
- **配置项**:`id`(默认 'rag')/ `description`/ `topK`(默认 5)/ `searchToolName`(默认 'search_docs')/ `loadToolName`(默认 'load_doc')/ `maxToolRounds`(默认 8)/ `summarization`(默认 **不开**——短任务 offload 兜底够;复杂多轮检索集成方可开 true/SummarizationOptions)/ `skills`(默认 [内置 rag-search],可追加)/ `extraTools`。
- **校验**:retriever/loader/useVfs 全无 → 抛错「至少配一种知识源」。
- **opt-in / 默认零侵入**:导出函数,不进 createChatSdk 默认装载;不挂 = 现状零变化。
- **可测约束**:① 返回 `{id:'rag', description, systemPrompt, skills:[1], maxToolRounds:8}`;② 传 retriever → tools 含 search_docs(invoke stub retriever 返回格式化文本含 source);③ 传 loader → tools 含 load_doc;④ useVfs(true) → allowedTools 含 vfs_grep/vfs_read;⑤ retriever 抛错 → search_docs 返回错误字符串(不抛);⑥ 全无知识源 → 抛错;⑦ 塞 subagents → inspect().subagent.subagents 含 id='rag',inspect().tools 含 use_rag。

## Requirement: HTML 生成子 agent 工厂(createHtmlSubagent)

系统提供工厂 `createHtmlSubagent(options): SubagentConfig`,构造**代码组件生成子 agent**(规划 + 执行):装 todos 中间件获规划能力(`write_todos`/`update_todo`)+ 经 writablePaths 获写权限(write/set/edit path guard)+ 可选 draft_write/draft_commit 大段代码分块 + 内置 HTML systemPrompt + html-builder skill。返回标准 SubagentConfig,集成方塞 `subagents:[createHtmlSubagent({writablePaths})]` → 主 agent 自动获得 `use_html` 委派工具,把「生成/修改纯代码组件」的中等任务委派给独立上下文的 HTML 子 agent(规划→生成→确认,过程不占主上下文,但 write 经 path guard 直接落主 data)。**opt-in(默认不挂 = 现状零变化)**。

- **规划能力(经架构扩展 middleware)**:`planning?: boolean`(默认 true)→ `middleware:[createTodosMiddleware()]` → 子 agent 获 `write_todos`/`update_todo`(独立 todos state)。中等任务(多组件/大段代码)先规划再执行。
- **跨轮压缩(经架构扩展 summarization)**:`summarization?: boolean | SummarizationOptions`(默认 true)→ 子 agent 装 `createSummarizationMiddleware`(contextWindow 从子模型能力;默认索引摘要零 LLM,可经 options.llmInvoke 升级)。HTML agent 频繁 read 组件结构 + draft_write 大段代码 + 多轮改优,跨轮上下文累积快,需压缩(光靠 offload 单次大结果转 vfs 压不住多轮累积)。
- **写权限(writablePaths)**:`writablePaths: string[]`(**必填**,代码组件 data 区如 `['components']`)→ write/set/edit 经 path guard(越界 `PATH_OUT_OF_SCOPE` 回灌自纠);写 **data 的 codeRef 引用 + 元信息**(name/props)。
- **代码正文→vfs(核心)**:代码(Vue SFC)写 vfs(`html/<name>.vue`,`codeVfsPrefix` 可配默认 `html/`),经 `allowedTools:['vfs_write','vfs_edit','vfs_grep','vfs_read']`。data 只存 `{type:'custom', codeRef:'vfs://...', name?, props?}`。主 data 精简;代码改 vfs_edit 增量(data 引用不变);会话级 vfs(userFiles 池,非长期)。集成方渲染层按 codeRef 从 vfs 读(html-builder skill 约定)。
- **去掉 draft_write/draft_commit**:代码不 in data,draft(dataOps 给主 data 大 JSON 分块)不适用;大段代码 vfs_write 整体或 vfs_edit 增量拼。
- **大段代码分块(可选)**:`useDraft?: boolean`(默认 true)→ allowedTools 拿 `draft_write`/`draft_commit`(需主开 vfs + `capabilities.draftWrite`);≥2KB 的 Vue SFC 用分块构建 → 原子提交(防单次 write 超 max_tokens 截断)。主未开 draftWrite → 工具不存在,LLM 不调(降级用 write patch)。
- **配置项**:`id`(默认 'html')/ `description`/ `planning`(默认 true)/ `useDraft`(默认 true)/ `maxToolRounds`(默认 12,中等任务)/ `temperature`(默认 0.4,代码生成低温)/ `skills`(默认 [内置 html-builder])/ `extraTools`。
- **返回标准 SubagentConfig**:`{ id, description, systemPrompt, writablePaths, allowedTools:[draft_*/vfs_*], middleware:[todosMw], skills:[htmlBuilderSkill], maxToolRounds, temperature }`。下游自动生成 `use_html`。
- **校验**:writablePaths 空 → 抛错「writablePaths 必填」。
- **可测约束**:① 返回 `{id:'html', writablePaths, middleware:[1], maxToolRounds:12, temperature:0.4}`;② middleware[0] 是 createTodosMiddleware 返回(子 agent 获 write_todos 工具);③ allowedTools 含 draft_write/draft_commit(useDraft:true);④ planning:false → middleware 为空;⑤ writablePaths 空 → 抛错;⑥ 塞 subagents → inspect().subagent.subagents 含 id='html',inspect().tools 含 use_html。

## Requirement: 检索/代码组件 skill 分发(rag-search / html-builder)

系统提供两个可分发的场景化 skill,随工厂默认装进对应子 agent,亦入 npm `files` 供集成方 cp 自管。与 `adaptive-planning`/`precise-value-protection` 同模式(纯知识分发,**不进 SDK 代码导出**)。

- **`skills/rag-search/SKILL.md`**:多源知识检索策略(预注入文档 vfs_grep → 语义检索 search_docs → 指定文档 load_doc → 公网 fetch_document 的决策树)+ 综合规范(交叉验证/标注来源/结构化结论/不堆原文/未检索到说不编造)+ 何时用何源。`createRagSubagent` 默认装进子 agent skills。
- **`skills/html-builder/SKILL.md`**:纯代码组件(custom Vue SFC)生成规范六要素(何时写代码组件/结构约定/Vue SFC 规范/安全底线/提交策略/可访问性)。`createHtmlSubagent` 默认装进子 agent skills。
- **分发形态**:两 md 入 npm `files`;SDK **不导出** skill 常量(工厂内部以 SkillSpec 装载;集成方可 cp 后 `defineSkill` 自包覆盖)。
- **可测约束**:① 两 SKILL.md 存在且含 frontmatter(name/description);② npm files 含 `skills/rag-search/` + `skills/html-builder/`;③ SDK 导出**不含** ragSearch/htmlBuilder 常量(纯分发 + 工厂内部装)。
