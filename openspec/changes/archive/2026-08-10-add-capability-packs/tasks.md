# Tasks: add-capability-packs

> 实施任务清单。`/opsx:apply` 按此执行。每完成一项勾 `[x]`。
> 分阶段:A 架构扩展(基础)→ B RAG → C HTML → D 导出 → E/F 测试 → G 文档 → H 发布。A 是 B/C 共同依赖,先做。

## 阶段 A:子 agent 架构扩展(`src/core/harness/subagent.ts` + `src/core/sdk/createChatSdk.ts`)

- [ ] A1 `SubagentConfig` 加 `allowedTools?: string[]` + `middleware?: Middleware[]` + `summarization?: boolean | SummarizationOptions` 三可选字段(import Middleware / SummarizationOptions 类型)
- [ ] A2 `SubagentOptions` 加 `middleware` + `summarization`(allowedTools 已存在);`configToSubOpts` 透传三字段(allowedTools / middleware / summarization)
- [ ] A3 `runSubagent`:child middleware 列表 focus 之后追加 `...(opts.middleware ?? [])`;**summarization 装配** —— `opts.summarization !== undefined` 时 `createSummarizationMiddleware({contextWindow: subCaps.contextWindow, ...(typeof opts.summarization==='object' ? opts.summarization : {})})` 装进列表(默认索引摘要零 LLM;对象可含 llmInvoke 升级);allowedTools 已消费(透传预声明路径)
- [ ] A4 `ChatSdk` interface 加 `vfsWrite: (path: string, content: string | object) => void`;createChatSdk return 对象实现(`vfsStore.files[path] = {content: text, size, pool:'userFiles', createdAt:Date.now()}`;对象 JSON.stringify);import VfsFile 形状(确认 vfs.ts 实际字段)
- [ ] A5 selftest 追加(sec-NN-subagent-config):allowedTools 透传(子工具池含主 vfs 工具)/ middleware 透传(子 agent createAgent middleware 含 mw)/ 不传两字段 = 现状(回归断言)/ vfsWrite 写入(files 更新 + 对象 stringify)

## 阶段 B:Pack 1 createRagSubagent + rag-search skill

- [ ] B1 新建 `src/core/sdk/ragSubagent.ts`:类型(`RagHit`/`RagRetrieveOptions`/`RagRetriever`/`RagLoader`/`CreateRagSubagentOptions`)+ `buildSearchTool`(search_docs,retriever try/catch 降级)+ `buildLoadTool`(load_doc,loader try/catch 降级)+ `RAG_SYSTEM_PROMPT`
- [ ] B2 `createRagSubagent(options)`:校验(至少一种知识源)/ 默认值 / 组装 SubagentConfig(tools→extraTools:search_docs/load_doc;allowedTools:useVfs 拿 vfs_grep/vfs_read/vfs_json_read;skills:[ragSearchSkill];maxToolRounds:8;**summarization 默认不开**(option 透传))
- [ ] B3 新建 `skills/rag-search/SKILL.md`:frontmatter + 多源决策树(vfs→search_docs→load_doc→fetch)+ 综合规范(按 adaptive-planning SKILL.md 文风)
- [ ] B4 ragSearchSkill 常量:在 ragSubagent.ts 内以 SkillSpec 定义(`{name:'rag-search', description, doc:'<SKILL.md 全文 或 vfs 引用>'}`),工厂默认装;**不从入口导出**(工厂内部用)
- [ ] B5 selftest(sec-NN-rag-subagent):返回结构 / search_docs invoke(stub)/ load_doc invoke(stub)/ retriever 抛错降级 / useVfs allowedTools 含 vfs_* / 全无知识源抛错 / 配置覆盖

## 阶段 C:Pack 2 createHtmlSubagent + html-builder skill

- [ ] C1 新建 `src/core/sdk/htmlSubagent.ts`:类型(`CreateHtmlSubagentOptions` 含 `writablePaths`/`codeVfsPrefix?`/`planning?`/`summarization?`/`maxToolRounds?`/`temperature?`/`skills?`/`extraTools?`)+ `HTML_SYSTEM_PROMPT(prefix)`(注入 codeVfsPrefix 引导代码→vfs)+ `createHtmlSubagent(options)`
- [ ] C2 `createHtmlSubagent`:校验(writablePaths 必填)/ 默认值(planning=true→middleware:[createTodosMiddleware()];**summarization=true→默认索引摘要跨轮压缩**;codeVfsPrefix='html/';temperature=0.4;maxToolRounds=12;skills:[htmlBuilderSkill])/ **代码→vfs 模式**:allowedTools:[vfs_write/vfs_edit/vfs_rm/vfs_grep/vfs_read](代码文件 写/改/删/搜/读);writablePaths 写 data(codeRef+元信息);**去掉 draft_write**(代码不 in data)/ 组装 SubagentConfig(writablePaths + allowedTools + middleware + summarization + skills)
- [ ] C3 新建 `skills/html-builder/SKILL.md`:frontmatter + 要素(**代码存储约定**:代码→vfs(html/<name>.vue),data 存 codeRef 引用;改代码改 vfs 不改 data)/ 何时写 / SFC 规范 / props 定义(defineProps)/ 组件库引用(import,集成方注入)/ 安全底线 / 可访问性
- [ ] C4 htmlBuilderSkill 常量:在 htmlSubagent.ts 内 SkillSpec 定义,工厂默认装;**不从入口导出**
- [ ] C5 selftest(sec-NN-html-subagent):返回结构 / middleware[0] 是 todos(getPlanPhase 存在)/ allowedTools 含 vfs_write/vfs_edit(代码→vfs)/ **不含 draft_write** / summarization 默认开 / planning:false→middleware 空 / writablePaths 空→抛错 / codeVfsPrefix 可配

## 阶段 D:导出 + 类型(主包 + headless;两工厂纯核心无 UI 依赖)

- [ ] D1 `src/core/index.ts` 导出 `createRagSubagent` + `createHtmlSubagent` + 类型(`RagHit`/`RagRetrieveOptions`/`RagRetriever`/`RagLoader`/`CreateRagSubagentOptions`/`CreateHtmlSubagentOptions`);import from `./sdk/ragSubagent` + `./sdk/htmlSubagent`
- [ ] D2 `src/core/index.headless.ts` 同步导出(纯核心,headless 用户也要)
- [ ] D3 `types/index.d.ts` + `types/headless.d.ts` 加两工厂 declare + 类型 declare + ChatSdk.vfsWrite
- [ ] D4 `tests/exports-consistency.mjs` 扩展:主 + headless 名集合含 createRagSubagent/createHtmlSubagent;ChatSdk interface 含 vfsWrite(或类型层校验)

## 阶段 E:selftest(纯函数 + 逻辑层;新增功能测试同步约定)

- [ ] E1 sec-NN-subagent-config(A5,架构扩展透传 + 回归)
- [ ] E2 sec-NN-rag-subagent(B5,RAG 工厂)
- [ ] E3 sec-NN-html-subagent(C5,HTML 工厂)
- [ ] E4 同步 CLAUDE.md selftest 断言计数

## 阶段 F:e2e(顶层 API + inspect 反映;新增功能测试同步约定)

- [ ] F1 `tests/e2e/capability-packs.mjs`(新建,在 runner 注册):
  - ✓ `createRagSubagent`/`createHtmlSubagent` 导出为 function;类型导出
  - ✓ `createChatSdk({subagents:[createRagSubagent({retriever:stub})]})` → inspect().subagent.subagents 含 id='rag';inspect().tools 含 use_rag
  - ✓ `createChatSdk({subagents:[createHtmlSubagent({writablePaths:['components']})]})` → inspect 含 id='html' + use_html
  - ✓ `sdk.vfsWrite` 为 function;调后 read 工具/vfsStore 含注入文件;对象 content 被 stringify
  - ✓ 两 skill:`skills/rag-search/SKILL.md` + `skills/html-builder/SKILL.md` 存在 + frontmatter;npm files 含
  - ✓ SDK 导出不含 ragSearch/htmlBuilder 常量(纯分发 + 工厂内部装)
- [ ] F2 同步 CLAUDE.md e2e 断言计数

## 阶段 G:文档(中英文同步,勿漏单边)

- [ ] G1 `README.md` / `README.zh-CN.md` —— 「专用子 agent 能力包」章节:createRagSubagent(多源检索,retriever/loader/vfs 用法 + sdk.vfsWrite 注入文档)+ createHtmlSubagent(规划+写,writablePaths 用法);强调可组合/拆分
- [ ] G2 `doc/usage-guide.md` / `doc/usage-guide.en.md` —— RAG 子 agent 章节(retriever/loader 实现示例:向量库/全文/混合/远程 API + vfs 文档池模式)+ HTML 子 agent 章节(代码组件生成 + 规划 + writablePaths)+ 子 agent 架构扩展(allowedTools/middleware 自定义子 agent)
- [ ] G3 `CLAUDE.md` —— 目录结构(加 ragSubagent.ts/htmlSubagent.ts + skills/rag-search/ + skills/html-builder/)+ 子 agent 段(SubagentConfig allowedTools/middleware + sdk.vfsWrite)+ 能力包(两专用子 agent,opt-in 可组合)+ 导出矩阵 + 测试矩阵(新增能力包行)+ 测试计数(selftest/e2e)

## 阶段 H:发布(minor 2.37.0,用户确认后执行)

- [ ] H1 develop 开发 + commit;openspec 归档 `git add -f openspec/changes/archive/2026-08-10-add-capability-packs/`;README 全景盘点同步(移除本 active change)
- [ ] H2 `npm version minor --no-git-tag-version`(package.json + package-lock.json 两处)
- [ ] H3 发布前必跑顺序:`build` → `selftest`(E 计数 +N 全过)→ `e2e`(F 计数 +N 全过)→ `browser`(无 UI 改动,确认无回归)→ `test:exports`(含两工厂 主+headless 对齐)→ `test:types` → `test:size`(主包体积微增,两工厂纯逻辑)→ `npm pack --dry-run`(含 skills/rag-search/ + skills/html-builder/,不含 .env/src/examples/笔记)
- [ ] H4 `publish-github.sh "release 2.37.0: 专用子 agent(RAG 多源检索 + HTML 规划生成)+ 子 agent 架构扩展(allowedTools/middleware)+ sdk.vfsWrite"` 总结到 master 推双远程
- [ ] H5 `npm publish`;验证 `npm view page-agent-sdk version` + 临时目录 `npm i page-agent-sdk` 验证 createRagSubagent/createHtmlSubagent 可导入 + esm.sh 可达

## 验证门禁

- **架构扩展回归**:`build` + `e2e` 全 pass + 浏览器 spec 全 pass(现有 subagent/spawn 用法零回归 — allowedTools/middleware 可选,不传 = 现状)
- **Pack 1 RAG**:selftest(工厂/search_docs/load_doc/降级/配置)+ e2e(导出 + inspect use_rag)
- **Pack 2 HTML**:selftest(工厂/todos middleware/draft allowedTools/writablePaths 校验)+ e2e(导出 + inspect use_html)
- **vfsWrite API**:selftest(写入/st stringify)+ e2e(function + files 更新)
- **两 skill**:文件存在 + frontmatter + npm files 含 + e2e 断言
- **可组合/拆分**:两包零 import 耦合(grep 确认 ragSubagent.ts ↔ htmlSubagent.ts 互不 import)
- **主包体积**:微增(纯逻辑,无重依赖);test:size 阈值微调留余量
