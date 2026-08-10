# Design: add-capability-packs

> 技术设计。`/opsx:apply` 按此 + tasks 实施。
> **方法论**:从低代码页面搭建最复杂场景倒推完整能力图景(§0.6),再裁剪不需要的(§5 Non-goals 对应)。三部分:§0 架构扩展(基础)→ §1 RAG agent → §2 HTML agent → §3 skill → §4-6 通用。

## §0 架构扩展(子 agent 针对性配置 + vfs 异步注入)

### 0.1 SubagentConfig 加 `allowedTools` + `middleware` + `summarization`(向后兼容,可选字段)

**现状**(`src/core/harness/subagent.ts`):
```ts
export interface SubagentConfig {
  id, description, llm?, systemPrompt?, tools?, skills?,
  temperature?, maxTokens?, maxToolRounds?, writablePaths?,
}
```

**扩展**:
```ts
export interface SubagentConfig {
  // ... 现有字段 ...
  /** 从主 allTools 额外拿的工具名(追加到默认只读白名单);如 ['vfs_grep','vfs_write','draft_write'] */
  allowedTools?: string[]
  /** 子 agent 自定义中间件(如 createTodosMiddleware 给规划能力) */
  middleware?: Middleware[]
  /** 跨轮上下文压缩;true=默认索引摘要(零 LLM),或 SummarizationOptions 自配(含 llmInvoke 升级)。不传=不装 */
  summarization?: boolean | SummarizationOptions
}
```
`configToSubOpts` 透传三字段;`SubagentOptions` 加 `middleware` + `summarization`(allowedTools 已存在)。

### 0.2 runSubagent 消费 middleware + summarization

**扩展①** child middleware 列表 focus 之后追加 `...(opts.middleware ?? [])`(对齐主「内置→用户」序)。

**扩展②** summarization 装配:
```ts
const summarizationMw = opts.summarization !== undefined
  ? createSummarizationMiddleware(
      typeof opts.summarization === 'object'
        ? { contextWindow: subCaps.contextWindow, ...opts.summarization }  // 自配(可含 llmInvoke 升级 LLM 摘要)
        : { contextWindow: subCaps.contextWindow },                        // true → 默认索引摘要(零 LLM)
    )
  : undefined
```
- **默认索引摘要(零 LLM)**:不传 llmInvoke → 关键词召回+截断;有 offload(单次大结果转 vfs)兜底。
- **可升级 LLM 摘要**:`summarization:{ llmInvoke }`。
- `allowedTools` 已被 `runSubagent` 的 `allow` Set 消费(`DEFAULT_READONLY_TOOLS` + allowedTools)。

### 0.3 `sdk.vfsWrite` 异步注入 API

`ChatSdk` 加 `vfsWrite: (path: string, content: string | object) => void`。集成方运行时异步注入 vfs 文件(RAG 文档池 / HTML 代码)。归 `userFiles` 池,storage 开则 persist。与 agent `vfs_write` 工具一致语义(集成方侧命令式入口)。

### 0.4 代码存储模式(HTML agent 核心:代码正文→vfs,data 引用)

低代码「纯代码组件」的代码正文(Vue SFC,**大段、频繁改、会话级**)存 **vfs**(`html/<name>.vue`),主 data 只存**引用 + 元信息**:

```
data:  { type:'custom', codeRef:'vfs://html/hero.vue', name?, props? }   ← 主 data(精简)
vfs:   html/hero.vue = '<template>...</template><script setup>...</script>'  ← 代码正文(工作区)
```

| 维度 | 代码正文→vfs(本设计) | 代码塞 data.code 字段(旧) |
|---|---|---|
| 主 data 体积 | 精简(只引用) | 膨胀(大段 code 字符串进 data,主 agent read/序列化重) |
| 代码增量改 | `vfs_edit` 增量友好 | write patch 改 data(乐观锁/data 抖动) |
| HTML agent 改代码 | 只动 vfs(data 引用不变) | 改 data(code 字段,动主 data) |
| 持久化 | vfs 会话级(userFiles 池,storage 开跨刷新;非长期) | data 随主持久化 |
| 渲染层契约 | 集成方按 `codeRef` 从 vfs 读 code 渲染 | 集成方从 data.code 读 |

- **HTML agent 两条写入路径**:① 代码正文→vfs(`vfs_write`/`vfs_edit`,经 allowedTools)② 引用+元信息→data(`write`/`set`,经 writablePaths path guard)。
- **集成方渲染契约**:渲染 `type:'custom'` 组件时,读 `data.codeRef` → vfs 取 code → 渲染(html-builder skill 文档化;SDK 不强制,提供工具 + 约定)。
- **会话级非长期**:代码在 vfs userFiles 池(storage 开跨刷新);任务/会话结束可清(LRU/手动),不进主 data 永久存档。

### 0.6 完整能力图景(从复杂场景倒推)

低代码页面搭建 agent 的复杂场景 → 三 agent 能力矩阵:

| 能力 | 主 agent | RAG agent | HTML agent |
|---|---|---|---|
| 规划 todos | ✅ planning | — (单线条检索) | ✅ todos middleware |
| 压缩 summarization | ✅ | option(默认关) | ✅(默认开) |
| 聚焦 focus | ✅ | 继承主 | 继承主 |
| mission/workingMemory | ✅ | — | — |
| 数据读 | read/query/search | + vfs_grep + search_docs + load_doc + fetch | read + vfs_grep/read |
| 数据写 | write/set/edit/draft(全 data) | — (只读) | write(**writablePaths** 写 codeRef+元信息)+ **代码正文→vfs** |
| DOM get_dom | ✅(opt-in) | — | — (删:渲染在集成方层,主看) |
| vfs 操作 | read/write/grep/json | grep/read(搜文档) | **write/edit(代码工作区)** + read |
| 持久化 | storage(全) | — (一次性) | 代码经 vfs(会话级) |
| fetch | ✅ | ✅(公网文档) | — |
| 溯源 | — | ✅ RagHit.source | — |
| approval/actions | ✅ | — | — (主确认/发布) |

## §1 Pack 1:`createRagSubagent` —— 多源知识检索子 agent(只读)

### 1.1 签名(`src/core/sdk/ragSubagent.ts`)

```ts
export interface RagHit { content: string; source?: string; score?: number }
export type RagRetriever = (query: string, opts?: { topK?: number }) => Promise<RagHit[]>
export type RagLoader = (source: string) => Promise<RagHit | RagHit[]>

export interface CreateRagSubagentOptions {
  retriever?: RagRetriever       // 语义检索 → search_docs
  loader?: RagLoader             // 异步加载指定源 → load_doc
  useVfs?: boolean               // 装 vfs 搜索(vfs_grep/read);默认 true(主开 vfs 时)
  id?: string                    // 默认 'rag'
  description?: string
  topK?: number                  // 默认 5
  searchToolName?: string        // 默认 'search_docs'
  loadToolName?: string          // 默认 'load_doc'
  maxToolRounds?: number         // 默认 8
  /** 跨轮压缩(复杂多轮检索累积时开);默认 false(短任务 offload 兜底够)。true=索引摘要,或 SummarizationOptions */
  summarization?: boolean | SummarizationOptions
  skills?: SkillSpec[]           // 默认 [ragSearchSkill]
  extraTools?: StructuredToolInterface[]
}
export function createRagSubagent(options: CreateRagSubagentOptions): SubagentConfig
```

### 1.2 工具壳 + 组装

- `buildSearchTool`(search_docs,retriever try/catch 降级)+ `buildLoadTool`(load_doc,loader try/catch 降级):两工具异常隔离(换关键词/source 重试,不崩)。
- 组装 SubagentConfig:`tools=[search_docs?/load_doc?]`(extraTools)、`allowedTools=useVfs?['vfs_grep','vfs_read','vfs_json_read']`、`skills=[ragSearchSkill]`、`summarization`(默认 undefined=不开,option)、`maxToolRounds=8`。
- 校验:retriever/loader/useVfs 全无 → 抛错。
- **RAG systemPrompt**:多源检索(先 vfs_grep 预注入 → search_docs 语义 → load_doc 精确 → fetch 公网)→ 综合结构化结论 → 标 source → 未检索到说不编造;只读角色。

## §2 Pack 2:`createHtmlSubagent` —— 代码组件生成子 agent(规划+写,代码→vfs)

### 2.1 签名(`src/core/sdk/htmlSubagent.ts`)

```ts
export interface CreateHtmlSubagentOptions {
  /** 可写 data 路径前缀(写 codeRef+元信息;如 ['components']) */
  writablePaths: string[]
  /** 代码正文存 vfs 的路径前缀;默认 'html/'(代码文件 html/<name>.vue) */
  codeVfsPrefix?: string
  id?: string                     // 默认 'html'
  description?: string
  planning?: boolean              // 装 todos 中间件(规划);默认 true
  summarization?: boolean | SummarizationOptions  // 默认 true(频繁改代码累积快)
  maxToolRounds?: number          // 默认 12
  temperature?: number            // 默认 0.4(代码生成低温)
  skills?: SkillSpec[]            // 默认 [htmlBuilderSkill]
  extraTools?: StructuredToolInterface[]
}
export function createHtmlSubagent(options: CreateHtmlSubagentOptions): SubagentConfig
```

### 2.2 组装(代码→vfs 模式 + 规划 + 压缩)

```ts
export function createHtmlSubagent(options: CreateHtmlSubagentOptions): SubagentConfig {
  const { writablePaths, codeVfsPrefix = 'html/', id = 'html', planning = true,
    summarization = true, maxToolRounds = 12, temperature = 0.4, skills, extraTools } = options
  if (!writablePaths?.length) throw new Error('[createHtmlSubagent] writablePaths 必填(代码组件 data 区,如 ["components"])')
  const middleware: Middleware[] = []
  if (planning) middleware.push(createTodosMiddleware())   // write_todos/update_todo
  // 代码正文→vfs:write/edit 代码;data→write(经 writablePaths path guard 写 codeRef+元信息)
  const allowedTools = ['vfs_write', 'vfs_edit', 'vfs_rm', 'vfs_grep', 'vfs_read']  // 代码文件 写/改/删/搜/读
  return {
    id,
    description: description ?? '生成/修改纯代码组件(custom Vue SFC)。代码写 vfs,data 存引用;能规划(write_todos)+ 执行。需写代码组件或灵活定制时委派',
    systemPrompt: HTML_SYSTEM_PROMPT(codeVfsPrefix),
    writablePaths,                                           // 写 data(codeRef+元信息,path guard)
    allowedTools,                                            // 写代码到 vfs + 读/grep
    middleware: middleware.length ? middleware : undefined,  // todos 规划
    summarization: summarization === false ? undefined : summarization,  // 默认开跨轮压缩
    temperature,
    skills: skills ?? [htmlBuilderSkill],
    maxToolRounds,
  }
}
```

- **两条写入路径**:代码正文→`vfs_write`/`vfs_edit`(`html/<name>.vue`);data 引用+元信息→`write`/`set`(writablePaths path guard,写 `codeRef`+`name`+`props`)。
- **去掉 draft_write/draft_commit**:代码走 vfs(不 in data),draft 是 dataOps 给主 data 大 JSON 分块的,不适用;大段代码用 `vfs_write` 整体写(代码通常 2-4KB 够单次),超大用 `vfs_edit` 增量拼(或主 agent eval_script transform)。
- **`codeVfsPrefix`**:代码 vfs 路径前缀(默认 `html/`),HTML systemPrompt 注入引导 agent 写 `html/<name>.vue`。

### 2.3 HTML systemPrompt(规划 + 代码→vfs 引导)

```
你是纯代码组件生成专家。可用工具:vfs_write/vfs_edit(写代码到 vfs ${prefix})/ write/set(写 data 引用,writablePaths 限定)/ read / write_todos+update_todo(规划)。

代码存储约定(重要):
- 代码正文写 vfs:${prefix}<name>.vue(如 ${prefix}hero.vue)
- data 存引用:write({patch:{op:'set', jsonPath:'components.N', value:{type:'custom', codeRef:'vfs://${prefix}<name>.vue', name, props}}})
- 改代码:先 vfs_edit 改 vfs 文件(data 引用不变)

工作方式:
1. 中等任务(多组件/大段代码)先 write_todos 拆解:读现有结构 → 规划各组件 → 逐个生成 → read 确认;
2. 遵循 html-builder skill 规范(SFC 规范/安全底线/可访问性/props 定义/组件库引用);
3. 小段代码 vfs_write 整体写;大段用 vfs_edit 增量拼;
4. 生成后 read(vfs 文件 + data 引用)确认结构正确;只写 writablePaths 内 data + ${prefix} 下 vfs。
```

## §3 配套 skill

### 3.1 rag-search skill(多源检索策略,不变)
多源决策树(vfs→search_docs→load_doc→fetch)+ 综合规范(交叉验证/标来源/结构化结论/不堆原文/未检索到说不编造)。

### 3.2 html-builder skill(增补代码存储约定)
- **代码存储约定**:代码正文→vfs(`html/<name>.vue`),data 存 `codeRef:'vfs://...'` 引用(§0.4);改代码改 vfs 不改 data 引用
- **何时写代码组件**(组件库无对应/定制交互/一次性特效;已有则用配置)
- **Vue SFC 规范**(`<template>`+`<script setup>`,defineProps/defineEmits,不做副作用)
- **props 定义**:代码组件 defineProps 接受外部 data 传入(集成方渲染时传)
- **组件库引用**:代码内可 import 组件库组件(集成方渲染层注入;不重复造)
- **安全底线**(禁 eval/Function/敏感 window/外部 CDN)
- **可访问性 + 语义化**

## §4 可组合性 / 拆分性(用户核心要求)

两包零 import 耦合,可只用 RAG / 只用 HTML / 组合(低代码典型:组件多→RAG 查文档;覆盖不到→HTML 写代码到 vfs)。都不进 createChatSdk 默认装载。

## §5 风险矩阵 + 裁剪(Non-goals 对应)

| 风险 | 缓解 |
|---|---|
| 子 agent middleware 装载序 | opts.middleware 放 focus 后(对齐主序) |
| allowedTools 拿主工具绑定主 store | 预期(子读主 vfs 文档;写经 path guard 限定) |
| 代码存 vfs 的渲染契约依赖集成方 | html-builder skill 文档化 codeRef→vfs 约定;SDK 提供工具不强制 |
| retriever/loader/代码 vfs 写抛错 | search_docs/load_doc try/catch 降级;vfs_write 错误回灌 |
| HTML 写 data 越界 | writablePaths path guard(PATH_OUT_OF_SCOPE 回灌) |
| HTML 压缩烧 token | maxToolRounds 12 + summarization + prompt 引导「规划充分即执行」 |

**裁剪(完备性推演后删,Non-goals)**:
- **HTML agent get_dom**:删。渲染在集成方层(异步),HTML 子 agent 看渲染价值低;主 agent get_dom 看效果。
- **代码版本历史**:删。用户「不需要长期存储」;vfs 单文件覆盖 + dataOps snapshot(若 data 走 dataOps)兜回滚。
- **结构化返回**(RAG/HTML 返回 schema):删。LLM 解析文本结论够,over-engineering。
- **子 agent 互通**:删。主 agent 编排(RAG→HTML)够,不引入子 agent 间通信。

**全可 revert**(可选字段 + 增量 API + 新导出 + 新文档)。

## §6 与现有机制的关系(不重叠)

- vs `memory`/`fetch_document`/`researcher`:memory 注入固定文档;fetch 抓单 URL;researcher 查公网。RAG 多源(语义/vfs/loader)查本地知识库 + 独立上下文。互补。
- vs `adaptive-planning`:主 agent 规划 skill;HTML 子 agent 独立 todos(经 middleware,不占主)。互补。
- vs `precise-value-protection`:同为分发 skill;html-builder 聚焦代码组件规范(含 vfs 存储约定)。
