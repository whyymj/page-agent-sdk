# Change: add-capability-packs(专用子 agent 架构扩展 + RAG/HTML 能力包)

> 状态:proposal(未实施)。**非破坏 minor 2.37.0**。L 规模(子 agent 契约扩展 + vfs API + 两工厂 + 两 skill)。与 `chatdialog-component-split` 正交。分阶段实施(架构扩展 → RAG → HTML)。

## Why

低代码页面搭建 agent 面对两类**主上下文装不下 / 主 agent 不擅长**的任务,需要**专用子 agent**针对性处理:

- **组件文档检索(RAG)**:组件库庞大,每个组件有业务文档 + UI 规范。全部塞 systemPrompt 爆窗口 + 烧 token,且当次任务大多用不到。需**按需检索**(查 vfs 预注入文档 / 加载异步文档 / 语义检索)→ 独立上下文综合,只回结论(检索的大段文档不污染主 context)。
- **代码组件生成(HTML)**:组件库覆盖不到的灵活需求,需写 `custom` 代码组件(Vue SFC)。这是**中等任务**(规划 → 生成 → 确认),要 `write_todos` 拆解 + `write`/`draft_write` 执行,直接改主数据。

但**现状子 agent 架构是固定配置**,无法针对性优化:

| 现状限制 | 影响 |
|---|---|
| 预声明子 agent 只有默认只读白名单 + extraTools | **拿不到主 vfs/draft 工具**(它们是主中间件创建、绑定主 store 的实例;SubagentConfig 无 allowedTools 字段) |
| 子 agent middleware 写死(skills + 递归 + focus) | **无扩展点** → HTML agent 拿不到 `write_todos`/`update_todo`(这俩是中间件创建、绑定子 agent 自己 todos state 的,不能当 extraTools 传) |
| `ChatSdk` 不暴露 vfsStore | **无异步注入路径** → 集成方只能同步 `vfs.initialFiles` 注入文档,RAG agent 启动后无法动态补文档 |
| 集成方想加 RAG/HTML | 得自己拼 SubagentConfig + retriever 工具 + prompt + skill,重复造轮子;且检索结果不走独立上下文会污染主 |

## What Changes

三部分:**① 架构扩展(基础)** + **② 两个专用子 agent 工厂(Pack)** + **③ 两个配套 skill**。全 opt-in,不挂 = 现状零变化。

### ① 子 agent 架构扩展(通用,所有预声明子 agent 受益)

- **`SubagentConfig` 加 `allowedTools?: string[]`**:预声明子 agent 从主 allTools 拿额外工具(白名单**追加**到默认只读集)。`configToSubOpts` 透传 → `runSubagent` 的 `allow` Set。RAG 用它拿 `vfs_grep`/`vfs_read`;HTML 拿 `draft_write`/`draft_commit`/`vfs_*`。
- **`SubagentConfig` 加 `middleware?: Middleware[]`**:子 agent 装自定义中间件。`SubagentOptions` 加同字段,`runSubagent` 的 child middleware 列表追加 `opts.middleware`。HTML 用它装 `createTodosMiddleware`(获得 `write_todos`/`update_todo` 规划能力)。
- **`sdk.vfsWrite(path, content)` 新 API**:`ChatSdk` 暴露 vfs 异步写入(`vfsStore.files[path] = {...}`,归 `userFiles` 池,触发 persist)。集成方 RAG 启动后动态注入/补充文档。

### ② Pack 1:`createRagSubagent` —— 多源知识检索子 agent(检索型,只读)

- 工厂 `createRagSubagent({retriever?, loader?, useVfs?, ...})` → `SubagentConfig`
- **多源工具**(集成方按需配,至少一种):
  - `search_docs({query, topK?})`:语义检索(retriever 注入,向量库/embedding)—— extraTools
  - `load_doc({source})`:异步加载指定文档源(loader 注入)—— extraTools
  - `vfs_grep`/`vfs_read`/`vfs_json_read`:搜集成方注入 vfs 的文档(`useVfs` → allowedTools)
  - `fetch_document`(默认只读有):公网 URL
- 内置 RAG systemPrompt(多轮检索 → 判断充分 → 结构化综合 → 标注来源 → 不编造)
- 默认 `useVfs:true`(主开 vfs 时)、`maxToolRounds:8`

### ③ Pack 2:`createHtmlSubagent` —— 代码组件生成子 agent(生成型,规划+写,代码→vfs)

- 工厂 `createHtmlSubagent({writablePaths, codeVfsPrefix?, ...})` → `SubagentConfig`
- **代码正文→vfs**(核心,§0.4):代码(Vue SFC)写 vfs(`html/<name>.vue`,会话级 userFiles 池),data 只存引用(`codeRef:'vfs://...'`)+ 元信息。主 data 精简、代码改增量友好(vfs_edit)、HTML 改代码不动 data 结构
- **规划能力**:`middleware:[createTodosMiddleware()]`(架构扩展②)→ `write_todos`/`update_todo`
- **两条写入路径**:代码正文→`vfs_write`/`vfs_edit`(allowedTools);data 引用+元信息→`write`/`set`(writablePaths path guard)
- 默认 `summarization:true`(频繁改累积快)、`maxToolRounds:12`、`temperature:0.4`(代码低温)

### 配套 skill(分发 + 工厂默认装)

- `skills/rag-search/SKILL.md`:多源检索策略(先 vfs 预注入 → 不够 load_doc → 语义 search_docs → 公网 fetch)+ 综合规范。`createRagSubagent` 默认装进子 agent skills。
- `skills/html-builder/SKILL.md`:代码组件规范(何时写/结构约定/SFC 规范/安全底线/提交策略/可访问性)。`createHtmlSubagent` 默认装进子 agent skills。
- 两 skill 均入 npm `files` 分发(集成方可 cp 自管);**不进 SDK 代码导出**(同 adaptive-planning 模式,工厂内部用 SkillSpec 装载)。

## Impact

- **架构扩展(向后兼容)**:`SubagentConfig` 加两个可选字段(allowedTools/middleware)+ `SubagentOptions` 同 + `runSubagent` 列表追加 + `ChatSdk` 加 `vfsWrite`;**全增量,不改现有字段语义/默认行为**。现有预声明子 agent / spawn 用法零变化。
- **新工厂(可选导出)**:`createRagSubagent` / `createHtmlSubagent` 从主包 + headless 子路径导出(纯核心无 UI 依赖);集成方 `subagents:[createRagSubagent({retriever})]` 即用。不挂 = 现状。
- **新 API**:`sdk.vfsWrite` 暴露在 ChatSdk interface。
- **新 skill**:两 md 文件入 npm files;不进 src/、不进导出。
- **主包体积**:微增(两工厂 + allowedTools/middleware 透传,纯逻辑,无重依赖);`createRagSubagent`/`createHtmlSubagent` 不引外部 SDK(框架无关)。
- **向后兼容**:全增量;发 **minor 2.37.0**(非 major)。
- **文档**:中英文 README + usage-guide 同步;CLAUDE.md 目录结构/导出矩阵/子 agent 段/测试矩阵。

## 决策

1. **架构扩展是「针对性优化」的必要前提(用户拍板全接受)**:`allowedTools`(拿主 vfs/draft 工具)+ `middleware`(装规划)+ `vfsWrite`(异步注入)三处缺一不可:RAG 搜 vfs 需 allowedTools;HTML 规划需 middleware;两 agent 的 vfs 文档池需 vfsWrite。全向后兼容(可选字段 + 增量 API)。
2. **两 agent 形态分流(检索只读 vs 生成写+规划)**:RAG = 检索→综合,结果大、不改数据 → 只读子 agent;HTML = 规划→生成→确认,中等任务、直接改主数据 → 写子 agent + todos 中间件。不强行同构。
3. **retriever/loader 注入式(框架无关)**:`createRagSubagent({retriever, loader})` 只给壳 + 流程,数据源集成方接。SDK 零数据源依赖(不打包向量库/embedding SDK)。延续 `data.bind`/`llm` 注入哲学。
4. **retriever/loader 工具式(子 agent 自主多轮)**:retriever/loader 包成子 agent 的 `search_docs`/`load_doc` 工具,子 agent 自主决定查什么、查几次 —— 非「SDK 调一次塞结果」。真 RAG agent 核心价值。
5. **skill 随工厂默认装 + 分发**:两 skill 入 npm files(集成方可 cp 自管);工厂内部以 SkillSpec 默认装进子 agent(集成方零配置即用)。不进 SDK 代码导出(对齐 adaptive-planning)。
6. **两包相互独立(可组合/拆分)**:零 import 耦合,可只用 RAG / 只用 HTML / 组合(低代码典型:组件多→RAG 查文档;覆盖不到→HTML 写代码组件)。都不进核心默认配置(零默认 token)。
7. **一个 change 分阶段(用户拍板)**:架构扩展是两 agent 共同依赖,一起做内聚。tasks 分 A(架构)→ B(RAG)→ C(HTML)→ 测试文档发布。
8. **代码存储模式:代码正文→vfs,data 引用**(完备性推演):代码是大段/频繁改/会话级产物,塞 data.code 字段笨重(主 data 膨胀、改代码动 data 乐观锁/抖动、主 agent read 重)。改为代码→vfs(工作区,增量友好 vfs_edit),data 存 codeRef 引用。集成方渲染层按 codeRef 从 vfs 读(html-builder skill 文档化约定,SDK 提供工具不强制)。

## Non-goals

- **不内置 RAG 数据源**:不打包向量库/embedding/分块器;`retriever`/`loader` 集成方实现。SDK 只给检索 agent 壳。
- **不做代码组件运行时安全沙箱**:代码组件执行安全由集成方渲染层保证(html-builder skill 给规范指引:禁 eval/Function/敏感 window;不强制 sandbox,不引入新 capability 开关)。
- **不改子 agent 默认行为**:架构扩展是可选字段透传;不传 allowedTools/middleware = 现状固定配置子 agent,零回归。
- **不强制两包组合**:单用其一合法;两包零耦合。
- **不做专用 preset(本期)**:`presets.rag`/`presets.htmlBuilder` 打包工厂 + 推荐配置属可选增强,推后;本期先给原子能力包(两工厂形态稳定后再叠 preset)。
- **不改 subagent/spawn 运行时中间件契约**:只加 SubagentOptions.middleware/summarization 透传 + SubagentConfig 三字段;不改 wrapToolCall/递归/signal 机制。
- **完备性推演后裁剪**:**HTML agent 不装 get_dom**(渲染在集成方层,主 agent 看);**不做代码版本历史**(用户「不需要长期」,vfs 单文件覆盖 + dataOps snapshot 兜);**不做结构化返回**(RAG/HTML 返回 schema,LLM 解析文本够);**不做子 agent 互通**(主 agent 编排 RAG→HTML 够)。
