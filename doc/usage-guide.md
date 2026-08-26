# page-agent-sdk 使用手册

> **[English](./usage-guide.en.md)** · **[中文](./usage-guide.md)**

> 框架无关的页面 Agent SDK:一行挂载,给任意网页装上一个能**读写宿主页面、调用工具、规划任务**的 AI 对话框。

---

## 目录

- [1. 它是什么](#1-它是什么)
- [2. 安装](#2-安装)
- [3. 快速开始(3 分钟)](#3-快速开始3-分钟)
- [4. 核心概念](#4-核心概念)
- [5. 配置项参考](#5-配置项参考)
- [6. 能力详解](#6-能力详解)
  - [6.1 数据操作(让 Agent 改你的页面)](#61-数据操作让-agent-改你的页面)
  - [6.2 自定义工具](#62-自定义工具)
  - [6.3 Skills(渐进式披露)](#63-skills渐进式披露)
  - [6.4 Memory(持久指令)](#64-memory持久指令)
  - [6.5 Planning(任务规划,自动)](#65-planning任务规划自动)
  - [6.6 持久化与会话管理](#66-持久化与会话管理)
  - [6.7 对话鲁棒性(重试 / 停止 / 重试)](#67-对话鲁棒性重试--停止--重试)
  - [6.8 上下文与内存上限](#68-上下文与内存上限)
  - [6.9 onEvent 事件回调(订阅常用时机)](#69-onevent-事件回调订阅常用时机)
  - [6.12 LLM 连接:直连 / 代理 / OpenAI 兼容端点](#612-llm-连接直连--代理--openai-兼容端点)
  - [6.13b 上下文归档 context_trimmed](#613b-上下文归档-context_trimmed对话超长时抢救即将删除的内容context-persist-resilience)
  - [6.13c 诊断报告导出 exportDiagnostics](#613c-诊断报告导出-exportdiagnostics调试排查329)
  - [6.14 无人值守自动化](#614-无人值守自动化资源预算--错误恢复--批处理--断点续跑220)
  - [6.14 上下文聚焦 Focus(指定组件精修)](#614-上下文聚焦-focus指定组件精修focus-context)
  - [6.15 UI 定制与国际化(图标 / 主题 / 语言 / 文案覆盖)](#615-ui-定制与国际化图标--主题--语言--文案覆盖317321)
  - [6.17 图片输入(多模态直发 / 识图转述旁路)](#617-图片输入多模态直发--识图转述旁路)
- [7. 高级:自定义中间件](#7-高级自定义中间件)
- [8. 命令式 API](#8-命令式-api)
- [9. 框架无关 / CDN 集成](#9-框架无关--cdn-集成)
- [10. 环境变量](#10-环境变量)
- [11. 常见问题与坑](#11-常见问题与坑)
- [12. 完整示例(简 → 繁)](#12-完整示例简--繁)

---

## 1. 它是什么

`page-agent-sdk` 是一个 **JS SDK**,把一个基于 ReAct 的 Tool-Calling Agent 以**对话框形态**挂载到任意网页。Agent 能:

- **读写宿主页面** `window` 上声明的属性(带 schema 校验 + 快照回退)→ 直接驱动你的页面 UI
- **调用工具**:抓取文档、读写虚拟工作区、以及你自定义的任意工具
- **规划多步任务**(todos)、**按需加载技能**(skills)、**记忆持久指令**(memory)
- **持久化对话**(IndexedDB,降级内存)、**多 agent 隔离**、**会话切换**
- 自动**重试**失败请求、支持**停止生成**、**出错重试**

框架无关:Vue被打包进 SDK,宿主页面无需装 Vue。兼容 OpenAI 协议(默认接 DeepSeek)。

## 2. 安装

**方式一:npm**(推荐,模块化项目)

```bash
npm install page-agent-sdk
# 同时装 peer 依赖
npm install zod @langchain/openai @langchain/core
```

```ts
import { createChatSdk, z } from 'page-agent-sdk'
```

**方式二:CDN · ESM**(esm.sh 自动解析 peer,体积小)

```html
<script type="module">
  import { createChatSdk, z } from 'https://esm.sh/page-agent-sdk'
</script>
```

**方式三:CDN · IIFE 全量**(一行引入零配置,依赖全打包,适合无构建链路)

```html
<script src="https://unpkg.com/page-agent-sdk"></script>
<script>
  const { createChatSdk, z } = window.ChatSdk
</script>
```

**按需引入(subpath exports)**:除顶层 `page-agent-sdk` 外,四个子路径入口让你只引特定能力:

| subpath | 主要导出 | 场景 |
|---|---|---|
| `page-agent-sdk/storage` | `createSessionStore` / `createMemoryBackend` / `createWebStorageBackend` / `isQuotaError` | 只要持久化层,不引 Agent |
| `page-agent-sdk/query` | `jpEval` / `searchJson` / `runSandboxedScript` + jsonUtils / schemaUtils 全部纯函数 | JSON 查询 / 沙箱 / 路径操作 |
| `page-agent-sdk/llm` | `createProxyLlm` + `ProxyLlmMode` / `ProxyLlmOptions` | 防 apiKey 泄露的代理连接 |
| `page-agent-sdk/headless` | `createChatSdk` + 全核心 API(`createChatContext`/`useChat` 等),**不含** ChatDialog/marked/highlight.js/dompurify | `ui:false` 自建对话框,要精简 bundle |

```js
import { createSessionStore, createMemoryBackend } from 'page-agent-sdk/storage'
import { getByPath, setByPath, hashValue } from 'page-agent-sdk/query' // jsonUtils 纯函数
```

> `storage` / `query` / `llm` 三个 subpath 指向同一份 dist + types(语义清晰 + 便于 CDN 按入口拉取);未来切多入口构建时 import 路径零迁移。

**🎯 headless 精简子路径(独立构建)**:`page-agent-sdk/headless` 是**独立打包的精简产物**(`dist/page-agent-sdk.headless.js`,ESM ~325KB / gzip ~106KB,主包 ESM ~789KB),给 `ui: false` 的 headless 集成方(自建对话框)去掉从不使用的 UI 层依赖(marked/highlight.js/dompurify/ChatDialog 全子树)。公开签名与主包完全一致(`createChatSdk(options): ChatSdk`),仅 `import` 源换一下:

```js
// 主包(含内置 ChatDialog UI)
import { createChatSdk } from 'page-agent-sdk'

// headless 子路径(纯核心,不含 UI;ui:false 自建 UI 用)
import { createChatSdk } from 'page-agent-sdk/headless'
```

> headless 入口创建的 sdk 若不传 `ui:false`(默认 `'default'`)→ `mount()` 会 `console.warn` 提示降级 headless(不渲染 DOM)。显式 `ui:false` 即正常 headless 态,无 warn。如需内置 ChatDialog,用主包 `page-agent-sdk`。详见下文 [headless 自建 UI](#headless-自建-uiuifalse)。

**🧓 legacy 老构建链子路径(webpack ≤4 宿主)**:`page-agent-sdk/legacy` 是 **es2017 + 全量打包**产物(`dist/page-agent-sdk.legacy.js`,~2.9MB,`await import()` 懒加载不进首屏),给 webpack 4 / vue-cli 2-3 等老构建链宿主 —— 老解析器(acorn 6)对主产物的 `?.`/`??` 语法 parse 失败,且 peerDeps(zod/@langchain)全为新 ESM,直接 `import 'page-agent-sdk'` 不可用。legacy 通道:

```js
// webpack4 宿主:动态 import(自动切独立懒加载 chunk;vue/zod/@langchain 全打包,零 transpileDependencies、零 peer 安装)
const { createChatSdk, z, defineTool } = await import('page-agent-sdk/legacy')
// CSS 走包根物理路径(webpack4 增强解析器不认 exports map)
import 'page-agent-sdk/style.css'
```

三通道决策:**现代构建(Vite/webpack5+)→ 主 ESM 产物** / **webpack≤4 → legacy 动态 import** / **无构建纯 html → IIFE `<script>`**(产物对照见 README 表)。SDK 内置 Vue3 为独立 app 实例(全打包),与宿主 Vue2 互不进模块图,可共存。

## 3. 快速开始(3 分钟)

最小可用例子 —— 让 Agent 能读写你的页面主数据:

```ts
import { createChatSdk, z } from 'page-agent-sdk'

// 1. 你的页面状态(任意结构;reactive/普通对象皆可)
const app = { title: '你好', theme: 'light' }
window.app = app  // 可选:挂到 window 供页面读取;SDK 工具直接读写 bind,不强制挂 window

// 2. 挂载 Agent
createChatSdk({
  container: '#agent',                    // 挂载点(选择器或 DOM 元素)
  id: 'my-app',                           // 稳定 id(刷新后恢复对话)
  storage: 'indexed',                     // 开启持久化
  llm: {
    apiKey: 'sk-xxx',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  systemPrompt: '你是页面助手。可读改主数据的 title / theme。',
  data: {
    schema: z.object({
      title: z.string().describe('页面标题'),
      theme: z.enum(['light', 'dark']).describe('主题'),
    }),
    bind: app,                            // 直连对象(工具直接读写 bind,响应式刷新)
    description: '应用配置',               // 可选:不传则自动生成
  },
}).mount()
```

打开页面,在对话框输入「把主题改成 dark」→ Agent 调用 `write({ value:{ theme:'dark' }, patch:{ op:'merge' } })` 直接改 `app.theme`。完。

## 4. 核心概念

| 概念 | 说明 |
|---|---|
| **Agent** | ReAct 循环:思考 → 调工具 → 观察 → 再思考,直到给出最终回复 |
| **data** | 你声明「Agent 可以读写哪个主数据对象 + 值的 schema」。Agent 只能改 schema 允许的值(范围 + 校验) |
| **工具(tool)** | Agent 的手脚。内置 window/vfs/文档抓取工具 + 你用 `defineTool` 加的 |
| **中间件(middleware)** | 插入 Agent 生命周期的钩子。内置 todos/skills/vfs/summarization/memory/permissions/verify,也可自定义 |
| **持久化(storage)** | 对话/工作区/todos/memory 落盘(IndexedDB 等),刷新可恢复 |

**心智模型**:你只负责 ① 声明 `data`(Agent 能碰什么)② 写 `systemPrompt`(Agent 该干嘛)③ 可选加 `tools`/`skills`/`middleware`。其余交给 Agent。

## 5. 配置项参考

```ts
createChatSdk({
  /* ===== 必填 ===== */
  container: '#agent',          // 挂载点(选择器字符串 或 HTMLElement)
  llm: {
    apiKey: 'sk-xxx',           // LLM API Key
    baseUrl: 'https://...',     // OpenAI 兼容端点(可选)
    model: 'deepseek-chat',     // 模型名(可选)
    temperature: 0.7,           // 温度(可选;操作大 JSON 建议 0.3)
    maxTokens: 16384,           // 输出上限(默认 16384;大 JSON 场景可调大)
  },
  // provider 抽离:llm 也可传任意 LangChain 模型实例(接 Anthropic/Google/Ollama 等,装对应 peerDep)
  // llm: new ChatAnthropic({ model: 'claude-sonnet-4-...' }),

  /* ===== 身份与隔离 ===== */
  id: 'my-app',                 // agent 实例 id(强烈建议传稳定值;多 agent 共存隔离 + 刷新恢复)
  systemPrompt: '...',          // Agent 身份与业务流程指令(可选:不传用内置默认——JSON 操作助手 + reliableWriteRules;传了则完全覆盖。默认 appendReliableWriteRules:true 自动用 '---' 分隔线追加 reliableWriteRules,设 false 关闭)
  // ⚠️ 工具用法(read/write/get/set/patch/snapshot 等)由 usageHints 中间件按能力开关自动注入,无需在此声明;systemPrompt 只写「业务知识」:身份、可改字段含义、业务流程、技能引用
  shareContext: false,          // true:同 id 的多个实例共享同一 Agent(同页多对话框 = 同一 agent);串行闸 core 级 —— 跨实例 send/switchSession 串行,生命周期收口(unmount/switch/reset)中止共享 core 全部在途流(2.41.0+)

  /* ===== 能力注入 ===== */
  data: { schema, bind, description? },  // 单主对象:bind 直连 reactive/普通对象(工具直接读写 bind);schema 字段 .describe() 自动注入 systemPrompt「可操作数据」段
  tools: [...],                 // 自定义工具(defineTool)
  skills: [...],                // 渐进式披露技能(defineSkill)
  memory: '...',                // AGENTS.md 风格持久指令
  permissions: [...],           // scope 白名单(默认不启用)
  middleware: [...],            // 自定义中间件(见第 7 节)
  actions: { name: { description, run, params? } },  // 宿主动作(2.20+):SDK 自动包成命名 tool(save_draft/publish 等),agent 直接调触发页面操作;见 §6
  schemaHint: { maxKeys?, maxChars? },               // 大 schema 分层披露阈值(2.20+;默认 15/4000,超阈值转顶层概览省 token);见 §6
  images: { upload?, describe?, describeTimeoutMs? }, // 图片输入(见 6.17):upload 压缩后原图换 https URL(集成方 OSS,失败回退内联);describe 识图转述(纯文本主模型时逐图转述注入,图不直发)

  /* ===== 持久化与会话 ===== */
  storage: 'indexed',           // 'indexed'/'session'/'local'/'memory'/配置对象;3.9+ 默认 'memory'(纯内存多会话,不落盘);false 显式关闭
  session: { id?, autoResume?, title? },  // 会话控制

  /* ===== 容量与鲁棒性 ===== */
  vfs: { initialFiles?, maxBytes?, poolBytes? },  // 虚拟工作区(默认总上限 8MB;2.16.0+ 三池分池:large_results/drafts/userFiles 各自 LRU,`poolBytes` 单池配)
  maxSnapshots: 20,             // 主数据快照数(默认 20,FIFO)
  maxMemoryRounds: 30,          // 内存保留对话轮数(默认 30,超限压缩为摘要;0 关闭)
  staleReadInvalidation: true,  // 写驱动过期读失效(3.42+ 默认开):单次 invoke 窗口内成功写之后,被击中路径的旧 read/query/search 结果替换为失效占位;false 主/子一致关闭
  maxToolRounds: 30,            // 最多工具调用轮次(默认 30,3.43 起〔3.28 曾调 10→15,editor 实测复杂整页搭建仍触顶〕;只计真实工具轮,格式/verify 自纠不消耗;另有 maxIterations 总迭代硬上限防死循环)
  maxRetries: 2,                // 模型调用失败重试次数(默认 2;网络/429/5xx 重试)
  capabilities: { dataOps: true, fetch: true, planning: true, vfs: true, verify: true, domInspect: false, inspectEnv: true, draftWrite: false, workingMemory: true },  // 能力开关(默认全开;关掉省 token。dataOps/fetch 控制内置工具装载;verify 反向默认关需显式开;domInspect=get_dom 读渲染后 DOM(2.20+)默认关 opt-in;inspectEnv=inspect_env 读 window 环境/调试变量(2.20+)默认开排查用;draftWrite=draft_write/commit 分块构建大 JSON(2.20+)默认关 opt-in;workingMemory=跨压缩记忆(2.20+)默认开)
  verify: { maxAttempts: 2 },        // 自检(传 check/maxAttempts/adversarial 任一即自动开,无需 capabilities.verify:true;check 省略→默认写后读回验证;见 6.10)

  /* ===== UI 与其他 ===== */
  streaming: true,              // 流式逐字输出(默认 true)
  contextPreset: 'auto',        // 压缩预设:auto(默认)/conservative(省成本)/aggressive(省上下文)/complex(多步复杂任务/大 JSON/长流程,2.16.0+)
  contextOptions: {...},        // 压缩细参,覆盖 preset 个别字段(false 关闭压缩)
  summaryLlm: { apiKey, baseUrl, model },  // 摘要专用模型(不配用主 llm)
  // (2.33+)压缩 agent 自主决策(opt-in):开 + summaryLlm 可用 → 每轮 shouldTriggerCompression gate 通过才 decide(inspect_context 工具循环)→ compress 用决策;失败降级静态压缩(零阻塞)
  capabilities: { agentCompression: true },  // requires summarization;decisionTimeoutMs(默认 6s)/decisionMaxTokens(默认 2048)可配
  summaryTemperature: 0.3,      // 摘要 LLM 温度(默认 0.3)
  summaryMaxTokens: 1024,        // 摘要 LLM 输出上限(默认 1024)
  summaryTimeoutMs: 15000,       // 摘要 LLM 超时(默认 15s,超时回退索引摘要)
  dialog: {                      // 对话框 UI 归组配置
    title: 'AI 助手',             // 对话框标题
    placeholder: '输入消息...',   // 输入框占位
    theme: 'dark',               // 内置主题:'dark'(默认)/'light';亦可祖先覆盖 --cs-* 完全自定义
    icons: {                     // 图标自定义(局部覆盖;未传键用默认 emoji,空串=隐藏)
      header: '🦈',              // 头部标题前图标(默认 🤖)
      subagent: '⚡',            // 子 agent 委派标记(默认 🤖)
      empty: '🪐',               // 空会话大图标(默认 💬)
      focus: '📍',               // 聚焦 chip(默认 🎯)
      assistantAvatar: '🛰️',     // assistant 头像(缺省=内置 SVG;传 emoji/字符替换为文本)
      userAvatar: '🙋',          // user 头像(缺省=内置 SVG)
      // 值也支持 HTML 片段(以 '<' 开头,如内联 svg/img —— 经 DOMPurify 图标白名单净化,
      // 事件属性/危险协议剥除,不可注入脚本;建议片段自带 width/height 或挂 class 定制):
      // queued: '<svg width="12" height="12" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/></svg>',
      // 其余:subagentProgress 🧬 / queued 📋 / queuedEdit ✏️ / recommend 💡 / conflict ⚠️
    },
  },
  i18n: {                        // 国际化配置组(顶层,3.22+;详见 6.15):locale 切语言 + messages 键级覆盖
    locale: 'en-US',
    messages: { statusDone: '<b style="color:#10b981">Done ✓</b>' },  // 富文本渲染位支持行内 HTML 片段(净化)
  },
  debug: false,                 // 调试日志
}).mount()
```

## 6. 能力详解

### 6.1 数据操作(让 Agent 改你的页面)

这是 SDK 的核心。你用 `data` 声明 Agent 能碰的主数据对象:

```ts
data: {
  schema: z.object({
    theme: z.enum(['light', 'dark', 'auto']).describe('页面主题'),  // 写入校验 + 字段说明自动注入 systemPrompt
    title: z.string().describe('页面标题'),
  }),
  bind: page,                    // 直连 reactive/普通对象(工具直接读写 bind,响应式刷新)
  description: '应用配置',       // 可选:不传则自动生成
}
```

Agent 自主调用这些内置工具(无需你写):

| 工具 | 作用 |
|---|---|
| **`read`** / **`write`**(推荐) | 高层读写入口,合并 describe/get 与 set/edit/delete + 自动乐观锁 + 自动快照,LLM 认知负担最低 |
| `describe_data` | 查看主数据说明 + schema 字段描述(底层,推荐 `read`) |
| `query_data` / `search_data` / `eval_script` | 大 JSON 查询(JSONPath)/ 模糊搜索 / 沙箱脚本 |
| `restore_data` / `history_data` | 快照回退 / 查历史快照列表与值 |

**要点**:
- **大子树摘要与击穿通道(4.0+)**:主 agent 侧 read/query 对「有效序列化体积 ≥ ~3KB」的子树自动降为 `<subtree NKB keys:[k1,…] #指纹>` 占位(数组记 `children:N`;标记字段形态 `<code Nkb>` 兼容)—— 键名/体积可见,**内容未见**。三条击穿通道(全部不依赖子 agent):①**窄读** `read({jsonPath:"该子树路径"})`(结果根豁免返回全文);②**聚焦全文** `set_focus` 后焦点子树内(含嵌套大子树)读全文;③**子 agent scope**(委派场景子 agent 读全文)。query 命中大值返回占位+path(钉路径窄读);search 不摘要。**read-before-write 守卫(自动装配)**:写路径落入占位子树且本轮未窄读 → 回灌 `NEED_NARROW_READ` 窄读指令(ask-first,一轮后可写;dryRun/已读/已写过/未落入摘要面恒放行;同子树只拦一次防死循环;整体 set 不拦)。**占位符夹带值防线**:write 写入值含占位字符串(`<subtree …>` 子串 / `<字段名 Nkb>` 整串)→ `PLACEHOLDER_LEAK` 拒收并引导窄读(防凭占位印象拼 value 把脏文本写进 bind;dryRun 预检同样暴露;verbatim 句柄 `⟦res:…⟧` 前缀不同不受影响;检查只针对 LLM 提交的原始值 —— enforceSet 回填的受保护字段既有值不检,集成方 bind 里合法存的占位样文本不会阻塞 whole-set 写;确需把占位样文本写进数据走集成侧 `importData`(agent 写通道无 override,防 LLM 把占位当真值的收益大于极端误伤);注意整串规则的字段名是任意 `[A-Za-z_]` 开头词(如 `<div 3KB>` 整串也会拦,HTML 混合内容子串不拦)。另注意 read 的占位/守卫面不覆盖 query/search/eval —— 这三个通道对受 freeze/verbatim 保护的字段返回真实值(写侧强制兜底,精确值不入 LLM 消息流的承诺在这三个通道上是弱化的,设计内边界)。轻量数据(处处低于阈值)零变化;**声明行为**:主 scope 数据 ≥ 阈值的存量集成 read/query 输出变占位(阈值常量 `SUBTREE_SUMMARY_THRESHOLD`,随版本按真 LLM 数据校准,只升不降)。
- **分段编排与欠委派 nudge(4.0+,自动装配,零配置)**:①**欠委派 nudge** —— 同一任务内累计写触达 ≥12 个组件且尚未委派 → 下一次成功写结果尾附一次性提示(教「多个 spawn_agent 各带 writablePaths 分段并行」+ 回退条款「同一委派失败 2 次就自己做,单干同样是一等路径」;advisory 不阻断,裁决归 LLM);②**编排段数据规模动态注入** —— 主数据顶层数组元素总数 ≥12 时每轮 system 注入三步职责(规划→分段委派→验收收口)+ 段规格四要素(jsonPath 范围/改动目标/共享 tokens/验收标准),小数据零注入零税,`setData` 后自动跟随;③轮次预算 70% 档提醒按能力感知教「并行分段委派」形态。**明示弱点(纯 JSON 委派)**:`spawn_*` 不经组件锁(锁仅 codeAsset use_<id> 路径),段不相交由编排规划保证、越段写冲突由乐观锁(per-scope 基线)兜底;`spawn_agents` 的 task 不带写授权,并行**写**委派须逐个 `spawn_agent` 各带 writablePaths。
- **schema 校验(path 级局部)**:`write` 校验**被写子树**的结构合法性(不是全量数据)—— 单点写入不会被其他节点的历史脏数据拦死;被写值不合法才拦截,返回只含写入路径的结构化错误给 Agent 自纠。整体 set 只校验 value 中出现的顶层 key(merge 语义,缺省字段保留);根级 refine/superRefine 等跨节点约束不在写时执行(需要全局校验用 `capabilities.verify`)。
- **快照回退**:每次 `write` 前自动存快照,`restore_data` 一键回退。
  - 自动快照:写操作前自动入栈(默认 20,FIFO 丢最旧)
  - 查看时间线:`history_data({list:true})` —— 序号 / op / 标签;`history_data({id,jsonPath?})` 读指定快照值
  - 回退:`restore_data(id?)` —— 不传 id 回退最近一次,传 id 回退指定;就地还原保留响应式、不入栈
  - 例:Agent 误改 `theme`,对话「回退最近一次修改」→ Agent 调 `restore_data()`
- **Vue 响应式友好**:`write` 增量就地改子属性、不替换根引用 → 你的 `reactive()` 页面能正常响应更新。
- **解耦 window**:`bind` 直连对象,工具直接读写 bind,SDK 不再自动挂 window(集成方按需自己挂 `window.app = app` 供页面读取)。

### 高层读写工具 `read`/`write`(推荐)

为降低 LLM 认知负担(从 13 个底层工具收敛到 2 个高层入口),新增 `read`/`write`:

```ts
// read:不传 jsonPath 读整个主数据 + 说明;传 jsonPath 读子路径
// Agent: read({}) → "主数据说明: 应用配置\n格式: ...\n\n主数据 = {\"title\":\"首页\",\"theme\":\"light\"} (hash=a1b2)"
// Agent: read({ jsonPath: 'title' }) → "主数据 @ title = \"首页\" (hash=a1b2)"

// write:三种意图
// ① 整体替换(value 直传 JSON 对象,无需 stringify)
write({ value: { title: '新标题', theme: 'dark' } })
// ② 增量 patch(op=set/remove/merge/append,jsonPath 相对主数据根;append 目标为数组→尾加元素,为字符串→尾接文本〔4.1+ 大 code 分块写入:先 set 首块再 append 逐块拼接,单次输出脱离 max_tokens 上限〕)
write({ value: 'c', patch: { op: 'append', jsonPath: 'items' } })
write({ value: { title: '合并标题' }, patch: { op: 'merge' } })
write({ value: 180, patch: { op: 'set', jsonPath: 'components.0.price' } })
// ③ 删除子路径
write({ patch: { jsonPath: 'oldField' }, del: true })
```

`write` 自动:① schema 校验(失败不写)② 存快照(可 `restore_data` 回退)③ 乐观锁(3.32 起 opt-in:`conflictWatchFields` 白名单或 `['*']` 全字段;冲突触发 `VERSION_CONFLICT` 或人工介入)。

### 工具面恒全暴露（14 工具，3.31 起移除 `toolMode`）

数据工具恒全暴露：高层 `read`/`write`（推荐入口，自动乐观锁 + 自动快照）、查询/搜索/沙箱（`query_data`/`search_data`/`eval_script`）、快照回退（`restore_data`/`history_data`）、底层 CRUD（`get/set/edit/delete/describe_data`，手动传 hash）、`schema_data`/`diff_data`、聚焦工具族（`set/add/remove/clear_focus`），以及 opt-in 能力开启时的 `draft_*`/`resource_*`。usageHints 运行时提示词按**能力开关**自适应（无档位概念）。

想约束 LLM 行为时用 `systemPrompt` 引导（如「优先用 read/write」），或用 `capabilities` 开关控制能力装载。

> ⚠️ 迁移：存量集成删掉 `toolMode: ...` 配置键（TS 类型报错；运行时忽略）。存量 systemPrompt 含「simple 模式/未暴露/勿调用」措辞会被检测并 warn，建议同步清理文案。

### schema 即白名单（只暴露声明字段）

当 `data.schema` 是 `z.object(...)`(或其可选/默认/懒加载包装)时,SDK 自动启用**白名单模式**:只暴露 schema 声明的字段给 LLM,未声明字段对 LLM 不可见、不可读写。这适合「bind 是大 JSON,但只希望 agent 操作其中部分字段」的场景——集成方把可操作字段写进 schema,其余字段(内部状态、敏感数据、冗余缓存)自动隐藏,无需额外配置。

- **读**:`read` 整体读按顶层 schema 投影;**子路径读也按该位置的子 schema 递归投影**(如 `read components.0` 会按 `components` 的元素 schema 投影,隐藏子对象未声明字段)。读未声明的(子)路径返回 `PATH_DENIED`。
- **写**:`set`/`write(set)` 整对象用 **merge 语义**——只更新 schema 声明字段,未传的字段保留不动(防误删);`edit`/`write(patch)` 增量改子路径同理,逐段校验路径必须在 schema 声明内。

> 注:白名单模式仅对 `z.object` 启用;`z.any()`/`z.record()`/`z.discriminatedUnion()` 等非 object schema 不启用(全开放,向后兼容)。`passthrough()` 的 object 仍启用白名单(声明字段才对 LLM 可见,额外字段写入保留但读时隐藏)——若希望额外字段也对 LLM 可见,需在 schema 显式声明。

### `data` 单主对象配置

`data` 是唯一的数据配置入口,集声明 schema + 直连对象 + 自动注入字段说明于一体:

```ts
import { reactive } from 'vue'  // 或任何响应式实现
const PageSchema = z.object({
  title: z.string().describe('页面标题'),
  count: z.number().describe('计数'),
})
const page = reactive({ title: '首页', count: 0 })

const sdk = createChatSdk({
  // ...,
  data: {
    schema: PageSchema,       // zod schema:写入校验 + 字段 .describe() 自动注入 systemPrompt「可操作数据」段
    bind: page,               // 必填:reactive/普通对象直连,工具直接读写 bind
    description: '页面配置',   // 可选:不传则自动生成
  },
})
// LLM write page → page 响应式自动更新;集成方改 page → LLM read 可见
```

- `bind` 必填:直连 reactive/普通对象,工具直接读写 bind(响应式刷新);SDK 不再自动挂 window,集成方按需自己挂 `window.app = app` 供页面读取
- `schema` 字段的 `.describe()` 自动提取(经 `extractSchemaHint`)注入 systemPrompt「可操作数据」段,集成方不用手写 description
- 预览将注入的提示:`extractSchemaHint(schema)`(已导出)
- **受保护资源(精确值保护,opt-in)**:声明 `data.resources: [{ path, mode }]` 保护需精确保存的字段(id/hash/token/长 verbatim/关键配置)。`freeze` = 只读(精确值经 `⟦frozen:path⟧` 占位符不入 LLM 消息流,写撞 `FROZEN_FIELD`);`verbatim` = 原样保留(`⟦res:handle⟧` 占位符,原值在资源池,改值经 `resource_update` 同步 bind 否则 `VERBATIM_MISMATCH`)。写侧强制在 `commitSetToBind`/`applyPatchesToBind`/eval 三处(先于 schema);**bind 恒持原始值**(占位符只在读写边界 → hash/快照/乐观锁不受影响)。**含保护字段的容器整体清空**:`set components=[]` 这类把保护字段连同容器一起删的整体替换会被显式拒(`FROZEN_FIELD`,文案给出路:保留含保护字段的元素 / 逐个 remove 其余元素);merge 语义下未提及的顶层键照常由 bind 保留(不回填捏造)。`resource_delete`/`resource_list` 对静态 `freeze` 配置返回定向说明(freeze 无句柄不可释放,需集成方调整 `data.resources`)。opt-in(配 `data.resources` + `capabilities.vfs`):暴露 `resource_get`/`update`/`list`/`delete` 工具(advanced)+ 跨压缩 pin + SDK API `createResource`/`getResource`/`updateResource`/`deleteResource`/`listResources`/`releaseResources`。详见 `skills/precise-value-protection`。
  ```ts
  data: { schema, bind, resources: [{ path: 'id', mode: 'freeze' }, { path: 'token', mode: 'verbatim' }] }
  ```
- **`bind` 不强制 reactive**:任何对象都行。区别在于「写后是否响应式刷新」:
  - 传 `reactive(obj)`(Vue):Agent `write` 改属性 → 模板/watch 自动响应(推荐 UI 场景)
  - 传普通对象:Agent `write` 能改数据,但页面不响应(适合 headless / 后端 / 集成方自己 `onEvent` 或 `watch` 后刷新)
  - 工具 `set`/`write` 用 `restoreInPlace` 就地改子属性(不替换根引用),兼容 reactive 代理;非 reactive 对象也能正常写入
- **通知外界对象已修改**的机制(详见 §6.9 onEvent):
  - `onEvent` / `sdk.hook` 订阅 `data_change` 事件(写后触发,含 `operation`/`value`)—— 适合 headless / 非 Vue / 普通对象 bind
  - Vue 响应式(bind 传 reactive)—— 模板/watch 自动响应,无需手动通知
  - `onEvent` 与响应式可并用:响应式管 UI 刷新,`onEvent` 管审计/埋点/跨系统联动
- **运行时替换主数据**:`sdk.setData(config)` / `sdk.getData()`(替代旧 add/remove/listDataSlots)
- **运行时替换 skill**:`sdk.setSkills(skills)`(同名 skill 覆盖更新;清 skill 全文缓存,下轮 system prompt 索引重渲染,下次 `load_skill` 取最新全文含 vfs doc)/ `sdk.invalidateSkillCache(name?)`(动态 skill 内容变化时主动失效缓存,不传清全部,传 name 清指定)
- **用户创建 skill(运行时 + 独立持久化)**:`sdk.addSkill(skill)`(用户在聊天界面内创建/编辑/删除自定义 skill,自动加入 agent,持久化由**独立 SkillStore**管理——默认 indexedDB,与 `storage` 选项分离,即使 `storage:false` 也持久化,跨刷新自动恢复;同名覆盖)/ `sdk.removeSkill(name)`(仅删用户创建的,不删集成方 `skills` 选项传入的 initialSkills)/ `sdk.listUserSkills()`(列出用户创建的 skill 名,UI 面板刷新用)/ `sdk.getUserSkill(name)`(读取用户创建的 skill 详情,SkillPanel 编辑时调)。内置 `ChatDialog` 头部有「Skill 管理」按钮打开 `SkillPanel` 组件,支持创建/编辑(点击已创建 skill 加载到表单)/删除;集成方也可单独 `import { SkillPanel }` 自建 UI。需开启 `capabilities.skills`(默认开)。**跨页面/跨 agent 复用**:手动指定 `skillStorage: { id: 'shared-skills' }`,多个 `createChatSdk` 实例(不同 agentId)用同一 id 即可共享同一套用户 skill;不传 `id` 则默认按 `agent::{agentId}` 隔离(每 agent 独立 skill 集)。`skillStorage: false` 关闭持久化(仅当前会话内存有效,刷新丢失)。

- **大 JSON 增量改**:改数组元素某字段用 `write({ value:180, patch:{ op:'set', jsonPath:'components.0.price' } })` 增量 patch,只发改动、不重传整个数组。改大对象/数组优先用 patch,避免整体重传被 max_tokens 截断致 JSON 不完整。
- **树形/递归 children 结构**:节点含 `children` 自引用时,用 zod `z.lazy(() => TreeNode)` 声明递归 schema,`.passthrough()` 让节点可带未声明字段:

  ```ts
  const TreeNode: z.ZodType = z.object({
    id: z.number(),
    type: z.string(),
    text: z.string().optional(),
    children: z.array(z.lazy(() => TreeNode)).optional(),  // 自引用 → 任意深度
  }).passthrough()

  data: { schema: z.object({ components: z.array(TreeNode) }), bind: page, description: '组件树' },
  ```

  - **查**:递归找任意深度的节点用 `query_data` 的 `$..*[?(@.type=="card")]`(找所有 card);精确定位用 `$.components.0.children.0.children.0.text`
  - **改**:增量改深层节点用 `write({ value:'新文本', patch:{ op:'set', jsonPath:'components.0.children.0.children.0.text' } })` —— jsonPath 逐级定位,只发改动,无需重传整棵树
  - **校验**:递归 schema 自动穿透到 children,append 非法节点(如缺 `id`)被拒;passthrough 保留节点的额外字段(extra/style 等)
  - **复杂遍历**(如带父路径聚合、按多条件递归筛选)用 `eval_script` 写递归 visit 函数最直观

#### 乐观锁(防"基于过期值覆盖")与冲突人工介入

当主数据可能被**外部代码 / 其他 agent / 用户手动**并发修改时,启用乐观锁:声明 `conflictWatchFields`(白名单或 `['*']`);`read` 返回值末尾附 `hash=xxx`(整体 bind 的 hash)作乐观锁标识,声明后写入自动比对。

```ts
// Agent 工作流(由 LLM 自动执行,集成方无需写)
// 1. read({ jsonPath:'title' }) → "主数据 @ title = old (hash=a1b2)"
// 2. write({ value:'new', patch:{ op:'set', jsonPath:'title' } })   // 自动用上次 read 的 hash 比对整体
//    若期间外部改过任一字段 → 整体 hash 不匹配 → 触发冲突(VERSION_CONFLICT),重新 read 再改
```

**冲突时(默认开启人工介入):** 工具挂起,`sdk.pendingConflict` ref 置为冲突信息,内置 ChatDialog 弹冲突条让用户三选一:

| 选项 | 行为 | 结果 |
|------|------|------|
| **保留外部** | 不写入,保留外部改后的值 | Agent 重新 get 再改 |
| **强制覆盖** | 执行 Agent 写入 | 覆盖外部修改 |
| **回退** | 回退到快照栈顶(历史检查点) | 撤销外部改 + Agent 不写入 |

```ts
const sdk = createChatSdk({ /* ... */ })
await sdk.mount()

// 内置 UI 已自动处理冲突条;若 headless 自建 UI:
import { watch } from 'vue'
watch(sdk.pendingConflict, (c) => {
  if (!c) return
  // c: { id, path, op, agentValue, currentValue, currentHash, expectedHash, snapshotId }
  showConflictDialog(c, (action) => sdk.resolveConflict(action)) // 'keep_external'|'overwrite'|'restore'
})

// 或经事件订阅
sdk.hook((e) => {
  if (e.type === 'conflict') showConflictDialog(e.conflict, (a) => sdk.resolveConflict(a))
})
```

**挂起自动收口(防永久挂起):** 用户停止生成(abort)/ `unmount()` / `switchSession()` 时,自动按「保留外部」收口挂起的冲突。

**自动裁决策略(`conflictPolicy`,3.29+):** 宿主与 agent 争同一份数据、且集成方明确「以 agent 写入为准」时(典型:编辑器宿主有 watcher/同步层会回写 bind,agent 连续两步写之间 bind 被宿主改过 → 第二步写触发冲突;无人值守场景没人点冲突条 → 流程永挂),声明策略跳过人工介入:

| 策略 | 行为 |
|------|------|
| `'ask'`(默认) | 挂起等人工 `resolveConflict`(现有行为) |
| `'overwrite'` | **agent 强制覆盖**:冲突时 agent 写入直接落地,不挂起、不等人工 |
| `'keep_external'` | 自动保留外部修改:冲突时放弃本次写入,回灌提示让 agent 重新 read 再改 |

```ts
createChatSdk({ /* ... */ conflictPolicy: 'overwrite' })
```

自动裁决不挂起 `pendingConflict`,但 `conflict` 事件照常外发(`e.conflict.autoResolved` 标记裁决结果),集成方可经 `onEvent`/`hook` 观测审计。

> **基线守卫(3.29+)**:集成方经 `defineTool` 注册的自定义工具若在工具体内直接改 `bind`(如整体替换组件树的结构化工具),SDK 会在该工具调用后**自动重算乐观锁基线**,agent 下一步正常 write 不会被误判「外部改过」而自冲突。工具窗口**之外**的修改(宿主 watcher / 用户直改)仍按设计触发冲突 —— 那是乐观锁的本职,按 `conflictPolicy` 声明裁决即可。

> 未声明 `conflictWatchFields` → 直接写(不自动校验)。独立使用 `createDataOps(props, { onConflict })` 不接 ChatDialog 时,自行处理冲突(返回 `Promise<{action}>`)。

#### 乐观锁与并发工具(`maxParallelTools > 1`)

**3.32 起自动检测默认不开**(opt-in 翻转:宿主常在 SDK 写路径之外持续改写元数据,全字段检测必然高频误报)。三种启用方式:① `conflictWatchFields: ['style','props',...]`(白名单,任意深度字段名,**位置不敏感** —— 组件增删致 jsonPath 位移不误报;仅监听字段的值变动触发冲突)② `conflictWatchFields: ['*']` 回旧版全字段检测。开启后 `write` 自动复用 **LLM 最近一次 `read` 返回的整体/监听 hash**(内部基线,2.40+ 按 caller scope 隔离 —— 子 agent 的 read/write 用独立基线,不污染主 agent)做快照比对。单工具串行场景下这等价于"基于我自己刚 read 的值写入"。

**并发工具下,`autoLock` 退化为"整体快照语义"。** 当 `maxParallelTools > 1` 时,同一轮的多个 `read` 会**并发写同一基线(主 scope)**,完成顺序不确定,后续 `write` 比对的是"**最后完成的那个 `read` 的整体 hash**"——跨工具维度"我这个 write 用的是我自己那次 read 的 hash 吗"**不可重现**。这不破坏安全边界(仍是整体快照校验,冲突仍能被捕获),但失去了"每个 write 精确对应它自己的 read"的语义。(同 scope 连续**写**不受此影响:每次写成功即刷新基线,agent 自己连续写自己永不互相冲突。)

**并发写互锁(4.1+,自动)**:`maxParallelTools > 1` 且声明了 `conflictWatchFields` 时,SDK 自动启用 dataOps 闭包级写互锁(async mutex,单锁覆盖全部写工具的「取基线 → 冲突检查 → 提交 → 刷基线」段)—— 同轮并发双写不再「双双过旧基线、后者静默覆盖前者」,而是后者在锁内看到前者落地后的新基线:不相交双写双双正常落地;陈旧基线冲突下,先经裁决的写入落地、后写若基于裁决者未见过的新状态会被**单发 `VERSION_CONFLICT` 显式拦下**(重 read 后可再写,不二次挂起)。冲突 ask 挂起期间锁自动释放(兄弟写不被人工等待阻塞),裁决恢复后做一次新鲜度校验;`overwrite` 裁决自动吸收基线、`restore` 裁决自动刷新基线(裁决后紧接的写不再连环误冲突)。串行模式(默认 1)与未声明 `conflictWatchFields` 的并行**零行为变化**(「后写覆盖」仍是未武装并行的既有明文语义)。**已知边界**:同路径并发双写的"意图级陈旧"(两写基于同一旧读、各写 `count=1` 终值为 1)与串行模式语义一致,互锁不做信息层合并 —— 需要读-改-写闭环时让模型先 `read` 再 `write`,或显式传 `expectedHash`。

**并发场景需要精确乐观锁时:让 LLM 显式传 `expectedHash`。** 取它自己那次 `read` 返回值里的 `hash`,在 `write` 里回传:

```ts
// Agent 工作流(并发场景,由 LLM 自动执行)
// 1. read({ jsonPath:'title' }) → "主数据 @ title = old (hash=a1b2)"   ← 记住这个 hash
// 2. write({ patch:{ op:'set', jsonPath:'title', value:'new' }, expectedHash:'a1b2' })
//    精确比对 LLM 自己那次 read 的 hash,绕开共享 lastReadHash 的竞态
```

显式 `expectedHash` 优先于自动检测的共享基线 hash,跨并发工具可重现、可推理。

> **hash 算法**:2.16+ 起 `hashValue` 升级为 **cyrb53(53-bit)**,替代旧 djb2(32-bit),显著降低碰撞概率。`expectedHash` 直接取 `read` 返回值里的 `hash` 字段即可,无需集成方自己算。

### 自动化闭环与规模化:`get_dom` / `actions` / `schemaHint` / `workingMemory`(2.20+)

四个互补能力,组合出「胜任自动化的 agent」:改数据 → 看渲染 DOM → 触发宿主页面动作;并在大 schema / 频繁压缩场景下保持可控。

#### DOM 读取 `get_dom`(看「渲染后」的页面)

让 agent 读**渲染后**的 DOM 结构(区别于 `read` 读的是数据 JSON)。用途:改完数据回看渲染是否生效、定位元素、验证样式落地、辅助 UI 设计问答。`capabilities.domInspect` 默认**关闭**(读 DOM 有 token 成本,按需开启)。

3.23+ 开启后额外获得** DOM 检视工具族**(经内置 `dom-inspect` skill 按需注入 —— `load_skill("dom-inspect")` 前仅占 skill 索引一行,不占常驻 tool schema 上下文;skills 能力关时自动降级直插工具池):

- `dom_search({ query, mode, limit?, root? })`:搜索元素 —— `mode:"selector"`(CSS 选择器)或 `mode:"text"`(文本关键词),返回命中元素的 CSS 路径 + 文本片段(≤20 处,超限标注总数)
- `dom_info({ selector, styles?, includeHtml?, pseudo?, ... })`:单元素完整信息 —— 内容(直接/全文本/HTML 片段)+ **计算样式**(不传 = 排障高频预设 ~30 项,传数组 = 指定属性)+ 几何位置 + **事件绑定三源**(inline `on*` 属性 / Vue vnode props / addEventListener 记录器;⚠ 记录器仅覆盖 SDK 加载后注册的监听,更早挂载的捕不到 —— 排查时以 inline + Vue props 为主)
- 排障套路:`dom_search`(text 模式找按钮文案)→ `dom_info`(styles 验证 display/pointer-events/背景色)→ 不符改数据 → `get_dom` 看结构对照

```ts
createChatSdk({
  capabilities: { domInspect: true },  // opt-in,默认关
  // ...
}).mount()
```

agent 调用 `get_dom({ selector?, depth?, attrs?, includeText? })`:

- `selector`:CSS 选择器(默认 `body`,读整页)
- `depth`:遍历深度(默认 `3`,防大 DOM 爆 token;`0` 只读根节点,上限 10)
- `attrs`:属性白名单。**不传** = 默认常用(`id/class/href/src/alt/title/style/role/aria-label/name/type/value`)+ 所有 `data-*`;**传了** = 严格白名单(不含 `data-*`,只返回你列的)
- `includeText`:是否含直接文本(默认 `true`)

返回结构化 JSON(`{tag, attrs, text, children[], childCount?}`),深度截断处只报 `childCount` 不展开;大结果自动外存 vfs。区别于 `eval_script`(沙箱自由脚本返回文本):`get_dom` 只读 + 结构化 + 属性白名单(不执行脚本、不暴露敏感 attr)。

```jsonc
// agent 调 get_dom({ selector: '.navbar', depth: 2 }) 返回示例
{
  "tag": "nav", "attrs": { "class": "navbar" },
  "children": [
    { "tag": "span", "attrs": { "class": "navbar-title" }, "text": "我的专题" }
  ]
}
```

> 需要手动注入(不走 capabilities)时:`import { domTools } from 'page-agent-sdk'` 展开 tools。纯函数 `domToStructure(node, opts)` 已导出,可脱离浏览器单测。

#### 环境探查 `inspect_env`(排查调试,默认开)

让 agent 读宿主页面**环境信息**(URL / 浏览器 / 视口 / 集成方调试变量),排查「当前页面在哪/什么浏览器/视口多大/调试变量值/为何没生效」。`capabilities.inspectEnv` 默认**开启**(轻量只读,排查刚需);`false` 关。

```ts
createChatSdk({
  capabilities: { inspectEnv: true },  // 默认开;false 关
  // ...
}).mount()
```

agent 调用 `inspect_env({ key? })`:

- **不传 `key`**:返回环境摘要(`location` 的 URL/origin/path、`navigator` 浏览器/语言/在线、`viewport` 视口尺寸/DPR/滚动、`document` 的 title/readyState)
- **传 `key`**:读指定 `window[key]`(集成方挂的调试变量,如 `inspect_env({key:"appConfig"})` 读 `window.appConfig`)

`safeSerialize` 跳过 function/DOM/循环引用 + 限深度/键数/长度截断防超大;大结果自动外存 vfs。区别于 `get_dom`(读 DOM 结构,深度遍历,opt-in):`inspect_env` 轻量读环境摘要,**默认开**,不改数据。

> 手动注入:`import { inspectTools } from 'page-agent-sdk'`。纯函数 `safeSerialize`/`getEnvSummary` 已导出,可脱离浏览器单测。

#### 分块写 `draft_write` / `draft_commit`(超大 JSON,默认关)

几百 K JSON(如 50+ 组件页面)逼近 LLM `max_tokens`,单次 `write({value})` 装不下。用 draft 分块构建:`capabilities.draftWrite` 默认**关**(opt-in;需 dataOps + vfs)。

```ts
createChatSdk({
  capabilities: { draftWrite: true, vfs: true },  // opt-in,默认关
  // ...
}).mount()
```

agent 流程:`draft_write({draftId, chunk, mode})` 分块累积 → `draft_commit({draftId})` 原子提交:

- `draft_write` mode:"start" 新建草稿 / "append" 追加 chunk(拼 JSON 片段到 vfs drafts 池,2MB)
- `draft_commit` 读草稿 → `JSON.parse`(失败 JSON_INVALID)→ schema 校验(失败 SCHEMA_INVALID,草稿保留可修后重试)→ 写 bind + 快照(成功自动清草稿)

```jsonc
// agent 分块构建一个 50+ 组件页面
draft_write({draftId:"p1", chunk:'{"components":[', mode:"start"})
draft_write({draftId:"p1", chunk:'{"type":"heading","props":{...}},', mode:"append"})
// ... 更多组件分块 append ...
draft_write({draftId:"p1", chunk:']}', mode:"append"})
draft_commit({draftId:"p1"})  // 合并 + 校验 + 写主数据 + 清草稿
```

> 小改仍用 `write` patch;draft 只在大 JSON 从零生成。`draft_commit` 走 `commitSetToBind`(与 write(set) 共用校验+快照+乐观锁链,单一真相源)。

#### 宿主动作 `actions`(触发保存/发布等页面操作)

集成方注册页面操作,SDK 自动把每个 action 包成**命名 tool**(LLM 直接看到 `save_draft`/`publish` 等,无需 `trigger_action` 中转)。配合 `get_dom` 形成「改数据 → 看 DOM → 触发动作」闭环。

```ts
createChatSdk({
  actions: {
    save_draft: {
      description: '保存当前页面为草稿(写本地存储)。改完数据后调用以持久化。',
      run: (args) => {
        localStorage.setItem('draft', JSON.stringify(args))
        return { saved: true, at: Date.now() }
      },
    },
    publish: {
      description: '发布页面到线上。调用前应已 save_draft。',
      run: async () => { await fetch('/api/publish', { method: 'POST' }); return '已发布' },
    },
    // 带参数的动作(params 为 ZodObject,LLM 按 schema 传参)
    set_theme: {
      description: '切换主题',
      params: z.object({ theme: z.enum(['light', 'dark']) }),
      run: ({ theme }) => { document.documentElement.dataset.theme = theme; return `主题已切到 ${theme}` },
    },
  },
  // ...
}).mount()
```

要点:

- `run(args)` 返回值序列化回灌 LLM(`undefined` → "动作完成";`string` 直传;对象 → JSON)。**异常隔离**:`run` 抛错 → 错误字符串回灌 LLM 自纠(agent 不崩)
- 动作名须合法标识符(`[a-zA-Z][a-zA-Z0-9_]*`,如 `save_draft`),非法名跳过 + warn
- `inspect().actions` 返回 `{ [name]: { description, hasParams } }`

#### schema 分层披露(`schemaHint`)

`data.schema` 字段的 `.describe()` 会自动注入 systemPrompt「可操作数据」段。**大 schema**(几十上百字段)全量注入会撑爆 systemPrompt。`schemaHint` 配置触发**分层披露**:超阈值时自动转「顶层概览」(key + type + 一句描述,不带约束、不递归 shape)+ 尾部提示「深层约束查 `schema_data`」—— 省 token 又不丢可发现性;小 schema(≤ 阈值)仍全量(无感)。

```ts
createChatSdk({
  data: { schema: hugeSchema, bind: page },
  schemaHint: { maxKeys: 15, maxChars: 4000 },  // 默认值;超阈值触发概览模式,可调大/调小
  // ...
}).mount()
```

默认 `maxKeys: 15, maxChars: 4000`。想全量披露(小 schema 不在乎 token):调大阈值;想更省:调小。相关导出:`extractSchemaHint` / `renderSchemaShallow` / `renderSchemaHint` / `renderSchemaOverview` / `formatConstraints` / `describeSchemaNode`。

#### 工作记忆 `workingMemory`(跨压缩保留定位 path 与 read hash)

长任务频繁压缩上下文时,agent 之前 `read`/`query_data`/`search_data` 定位到的 **path** 和 **read 返回的 hash** 会随 older 轮次被摘掉 → agent 重复检索(浪费 token)+ 凭记忆写导致乐观锁 `autoLock` 误冲突。`workingMemory` 中间件(`capabilities.workingMemory`,**默认开**)自动捕获这些结构化定位信息,经 `augmentPrompt` 每轮注入「## 工作记忆」段(在 state 不在 messages → 压缩不动它 → 天然跨压缩保留)。

```ts
createChatSdk({
  capabilities: { workingMemory: true },  // 默认开,无需配置;false 关闭
  // ...
}).mount()
// inspect().workingMemory → { locatedPaths: string[], lastHashes: {[path]: hash} }(各 ≤10 LRU)
```

自动捕获规则(不调 LLM):`read`/`query_data`/`search_data` 结果 → `locatedPaths`(LRU ≤10 去重);`read` 结果里的 `hash=` → `lastHashes[path]`(LRU ≤10)。与 `preserveLastToolResults`(保工具结果摘要防字段描述丢)互补;与 mission(mission 管目标,workingMemory 管中间态)正交。

#### 能力包:专用子 agent 工厂(createRagSubagent / createHtmlSubagent,2.37+)

复杂任务用**专用子 agent**针对性处理(独立上下文,过程不占主 token)。两包**可组合/拆分**,opt-in(不挂 = 现状零变化):

```ts
import { createChatSdk, createRagSubagent, createHtmlSubagent } from 'page-agent-sdk'

const sdk = createChatSdk({
  subagents: [
    // ① RAG 检索子 agent:多源查组件文档/UI 规范,只读,独立上下文综合
    createRagSubagent({
      retriever: async (q) => (await vectorDB.search(q)).map(h => ({ content: h.text, source: h.doc })),
      loader: async (id) => fetch(`/api/docs/${id}`).then(r => r.json()),
      // useVfs 默认 true:子 agent 经 vfs_grep 搜 sdk.vfsWrite 注入的文档
    }),
    // ② HTML 代码组件生成子 agent:代码作 data 资产(code 字段)+ vfs 工作副本 + 框架自动 checkout/commit
    createHtmlSubagent({ writablePaths: ['components'] }),   // writablePaths 可省略(3.6+ 装配期从 schema 自动推断)
  ],
}).mount()

// 异步注入文档到 vfs(RAG 子 agent 经 vfs_grep 搜到)
sdk.vfsWrite('docs/components/hero.md', 'Hero 组件用于首屏主视觉...')
```

- **RAG**(检索型):`search_docs`(语义检索 retriever)/ `load_doc`(异步加载 loader)/ vfs 搜索 / `fetch_document`;只读;默认装 `rag-search` skill。`retriever`/`loader` 集成方注入(SDK 零数据源依赖,不绑向量库)。检索的大段文档**不污染主上下文**(只回结构化结论)
- **`fetch_document` 安全提示**:URL 由 LLM 控制,同源请求默认带 cookie(浏览器 fetch 默认 `credentials:'same-origin'`)—— 文档内容以「不可信围栏」包裹防注入,但抓取本身可达任意同源 GET。敏感接口(如 `/api/user`)请服务端配 CSRF/鉴权校验,或 `capabilities:{fetch:false}` 关闭该工具。
- **HTML**(生成型,3.0 单模式 breaking):规划(`write_todos`/`update_todo`)+ **代码作为 data 资产**(`data.<writablePath>[i].code` 字段,随 data json 持久化进服务端 DB;UI 直接绑 `data.code` 响应式渲染)+ **vfs 作编辑工作副本** + 限定写(`writablePaths` path guard)。**框架自动 checkout/commit**(主 agent 透明):beforeAgent 把 `data.code` 按 `__pgId` 检出到 vfs(`html/<__pgId>.html`,覆盖式刷新)→ 子 agent 在 vfs 改 → afterAgent 增量回写改过的 vfs → `data.code`(直改 bind,不经 write,不进快照栈)。默认开 `summarization`(频繁改代码累积快)
  - **两条工作路径**:① 新建组件 → 子 agent `write({patch:{op:'set',jsonPath:'components.N',value:{name,code,props}}})`,code 直接进 data(框架补 `__pgId`,不经 vfs/checkout/commit);② 修改组件 → 框架 checkout → 子 `vfs_read`+`vfs_edit` 增量改工作副本 → 框架 commit 回写
  - **`__pgId` 框架无感注入**:集成商 schema 不声明;read 投影自动隐藏(`__pg*` 前缀);agent 写不进(path guard);persist 透明带(跨会话/跨设备稳定);vfs 文件名 = `codeVfsPrefix+__pgId+ext`
  - **输出形态(单模式)**:生成**完整、自包含的 HTML 页面**(可独立成页);交互逻辑默认 `<script>`(仅当用户明确「不要 script」时不写)、CSS 集中放 `<style>` 块、可引外部 JS/CSS;改造(抽 body/包组件/片段化)由下游插件/tool 做,html agent 不关注宿主渲染方式(v-html/SFC/iframe)
  - **输出格式校验**(`formatCheck`,默认开):① `validate_code` 自检工具(子 agent 生成/修改后自主调用;标签配对闭合等结构合法性,带行号报错)② verify beforeReturn 门禁(返回前确定性扫 vfs 工作副本,不通过回灌 feedback 自纠,`maxVerifyAttempts:2` 兜底防循环)。校验器为纯函数 `validateHtmlFormat`(已导出,集成方渲染层可复用做纵深防御);`formatCheck:false` 关闭整条校验链
  - **渲染自检(render-check,4.0+,随 `formatCheck` 生效零配置)**:结构检通过后,把**本轮触达面**(vfs touched 文件 + 本轮 write 新建组件)逐个放沙箱 iframe(`srcdoc` + `sandbox="allow-scripts"`,无 same-origin/forms/top-navigation)独立渲染,采集 ①`console.error`/`window.onerror`(带行号)②`unhandledrejection`(异步)③资源加载失败(捕获相 error,跨源无关)④白屏指标(`body.scrollHeight`<10)→ 任一命中即回灌自纠(定位到组件+行号);子 agent 不提供渲染工具(检查不交 LLM 自决,防双轨烧轮次)。**边界与残余(明示)**:沙箱 ≠ 宿主环境(结论是「能否独立跑」非「长啥样」);异步晚到错误可能漏报(活动静默启发式 + 硬上限 ~4s);storage 类 SecurityError 降为观察不判失败(opaque origin 沙箱假阳性);宿主 CSP 拦内联脚本 → 握手缺失「检查不可用」诚实返回(**不算通过,防假绿**,此时引导 validate_code 兜底);node/headless 无 DOM 环境自动跳渲染段保留结构段(debugLogs `render_check_skip` 留痕);修复预算与结构自纠**共享** `maxVerifyAttempts:2` 池(复杂修复链可能提前耗尽);最坏 +3~5s/次检查(复检只查失败组件)。导出 `createHtmlRenderCheck`/`normalizeRenderResult`/`renderInSandbox` 等供集成方自管复用
  - **主 scope read 摘要**:主 agent read data 时,标记字段(`code`)摘要为 `<code Nkb>`(防代码正文灌主上下文);子 agent read 完整(改 code 需全文);集成方业务长文本不受影响
  - **`codeField` 可配置(开放 schema 适配)**:code 字段位置默认 `'code'`(组件顶层),开放 schema 平台可配嵌套 jsonPath(如 `'props.html_code'`);「是否代码组件」= 该路径有 string(非代码组件自然跳过);装配期命中校验(组件数>0 且全员未命中 → console.warn,防填错路径静默失败)。例:`createHtmlSubagent({ writablePaths:['components'], codeField:'props.html_code' })`
  - **UI 规范 skill 双挂模式(真 LLM 实测验证)**:规范类 skill 同时挂主 agent 与 html 子 agent —— 主 agent 知规范才能在委派 task 里给准确视觉锚(hex 取自规范而非凭页面观察自造近似色);子 agent 照规范生成。只挂子会导致主 agent 锚与规范冲突:
    ```ts
    const uiSpec = defineSkill({ name: 'ark-ui-spec', description: '平台 UI 规范:色板/间距/形态约束', getContent: () => SPEC })
    createChatSdk({
      skills: [uiSpec, ...],                                  // 主:决策/委派锚引用规范值
      subagents: [createHtmlSubagent({ skills: [uiSpec, htmlFragmentSkill] })],  // 子:生成遵循(传 skills 覆盖默认,须并回 htmlFragmentSkill)
    })
    ```
  - **`writablePaths` 装配期自动推断(3.6+,可省略)**:未传时 createChatSdk 装配期从 `data.schema` 顶层扫描「数组元素含 `codeField` string 字段」的路径自动回填(`inferWritablePaths`,console.info 留痕;显式传入优先跳过推断)。不支持推断的形态 → warn + throw 提示显式传参:开放 schema(`z.any()`/`z.record`)、嵌套容器(如 `sections[].children[]`)、点路径 codeField(`props.html_code` 嵌套结构)—— 宁失败不猜错路径(错误路径 = 框架扫描区整体落空)
  - **主 agent 编排自适应注入(零配置)**:装配期自动检测 —— 有 html 子 agent → 主 agent systemPrompt 自动追加委派编排 `htmlOrchestratorPrompt(id)`(custom code 不 read 不 write 全权 `use_<id>` / 多组件委派(不同组件可同轮并行,同组件单一在途)/ task 规格化 4 要素 + ⑤历史偏好转述 / **多方案征询先文本**:「出几套方案我来选」→ 本轮只出文本方案 + 用户点选,选定后才委派,不并发生成全部方案);无显式 html 子 agent + schema 含 code 数组 → **3.9+ 自动装配默认 `createHtmlSubagent()`**(info 留痕,无开关;显式 `createHtmlSubagent(...)` 优先不重复;推断不出的形态(顶层 code 字段/开放 schema)不装 → `htmlDirectWriteFallback` 主 agent 自己 write code 的降级 + warn);开放 schema(`z.any()`)扫不到时集成方 opt-in spread。**勿手动 spread `htmlPageOrchestrator`**(自动注入已覆盖,双重注入浪费 token);opt-out `orchestratorPrompt:false`
  - **组件工匠笔记 `craftNotes`(默认开)**:子 agent 收口回复末尾附 `[note] <一句话实现要点>` 行(htmlSystemPrompt 约定),框架 afterAgent 提取沉淀为组件 `__pgNotes`(FIFO ≤5 条 × 200 字,随 data json 进服务端 DB 跨会话持久);下次委派同组件时经「组件代码文件地图」注入最近 1 条(`📝 笔记×N`)—— 同组件跨委派**设计意图持续**("前任的交接":设计决策/用户偏好/踩坑),状态在数据里不在子 agent 实例里(与 code-as-data-asset 哲学同构)。`__pgNotes` 走 `__pg*` sidecar 机制(agent read 投影隐藏、写不进,框架独占);`craftNotes:false` 关闭(零沉淀零注入)
  - **模型建议(真 LLM 实测)**:html 代码生成推荐强指令遵循模型(deepseek-v4 / claude / gpt-4o);flash 类弱模型放大过度思考(装饰穷举 / token 纠结),高频/批量场景建议非 flash
  - **额外只读工具 `allowedTools`(3.45.1+)**:集成方可把宿主自定义查询工具(如 `rag_component_docs`/`list_components`)并入 html 子 agent 工具池 —— 子 agent 写代码时能自查组件文档/页面结构,委派 task 提及组件名时不再幻觉「工具不存在」;只建议放查询类,写权限仍由 `writablePaths` 管控(与顶层 `subagent.allowedTools` 同名不同面:那是 spawn 链路白名单,这是能力包工厂参数)
  - **独立模型 + 思考深度锁定(output-quality-uplift)**:主 agent 保持轻量模型编排、代码生成换强模型 —— `createHtmlSubagent({ llm: { apiKey, baseUrl, model }, thinkingMode: 'deep' })`。`thinkingMode` 锁思考深度:`'deep'` 注入思考参数(质量优先,token/耗时约 2-5×)/ `'simple'` 剥除(省 token 加速)/ 缺省继承主;顶层 `subagent.thinkingMode` 作全局缺省(子显式设优先)。**默认 deep(default-deep-thinking)**:集成方零配置时,主/子模型若能力表标 `thinking:true`(deepseek-v4/reasoner、claude-3.7+/4 系、glm-5.2 等)自动注入 deep 保质量;非思考型模型(gpt-4o 等)不注入(防 400)。主模型可 `llm:{ thinkingMode:'simple' }` 显式剥思考省 token;summary/title/压缩决策等辅助通道自动 simple 免思考。OpenAI 兼容走 `extraBody.thinking`,Anthropic 走 `thinking` 字段(budget_tokens 缺省 `min(maxTokens??4096, 8000)`,开启时 temperature 按 API 要求强制 1)。**仅 LLMConfig 构造路径生效**:子 agent 复用预构造 `BaseChatModel` 实例时思考配置钉死构造期 → warn + observable no-op(需改传 `SubagentLlmConfig`)。需模型本身支持思考(deepseek thinking 版 / claude;flash 类传了无效)。生效状态经 `inspect().subagent.subagents[].thinkingApplied` 反射(`applied`/`inherited`/`instance-noop`)
  - **breaking 迁移(2.x → 3.0)**:① schema:`components[i]` 加 `code:z.string()`(替代 `codeRef`),去 `codeSnapshots` 镜像;② UI:绑 `data.components[i].code`(替代 `codeSnapshots[p]`);③ `createHtmlSubagent`:去 `onComplete`(框架 afterAgent 自动 commit);④ persist:整体 data json 发服务端(含 code + `__pgId`);⑤ 渲染层:遇 `type:'custom'` 读 `data.code` 渲染(不再 `codeRef`→vfs 取)
- **底层:子 agent 架构扩展**:`SubagentConfig` 加 `allowedTools`(从主 allTools 拿 vfs/draft 工具)/ `middleware`(装规划中间件)/ `summarization`(跨轮压缩);`sdk.vfsWrite(path, content)` 异步注入 vfs。两包都基于这些扩展;集成方亦可直接用 `SubagentConfig` 三字段自配任意专用子 agent

#### 子 agent 观察层:active/history 运行态(2.38+)

多子 agent 场景(并行 HTML/RAG、复杂编排)需集中观察:当前几个在跑、各做什么、跑到哪、谁完成。SDK 在 subagent 中间件维护会话级 active(运行中)/history(历史 LRU≤20)状态,纯观察层(不改一次性生命周期/事件链)。

```js
// 运行中子 agent(空数组=无在跑;含 taskId/task/label/status/steps/startedAt)
const active = sdk.getActiveSubagents()        // 等价 sdk.inspect().subagent.active

// 委派历史(最新在前;LRU≤20;含 durationMs/resultPreview)
const history = sdk.subagentHistory            // 等价 sdk.inspect().subagent.history

// DebugDrawer「🤖 子 agent」tab:运行卡片(状态徽标/步数/耗时)+ 历史折叠(点开看 steps)
```

- 会话级不持久化(刷新清空);steps 非全文(只记 `{kind,name,ts}`,全文在 messages);resultPreview 截断 120 字
- 并发安全:预声明 use_<id> 用唯一 observeId(事件 taskId 保持 `use_${id}` 不变)
- 随 `subagent` 能力开;自建 tracker:`import { createSubagentTracker } from 'page-agent-sdk'`(historyLimit 默认 20)

#### 子 agent 授权面:委派不绕过把关(fix-authorization-surface)

委派路径与主 agent 共享同一套授权/拦截面,无需额外配置:

- **子栈继承主 `permissions`/`approval`**:配了 `approval:{tools:['write']}` 后,子 agent(含 spawn 自授 writablePaths 的写)调 write 同样弹确认(ApprovalBar 正常渲染,允许/拒绝即时收口);permissions deny 规则对子同样生效
- **框架工具子池禁入(装配期 filter)**:`use_*`/`spawn_*`/`load_skill`/`write_todos`/`checkpoint`/`focus` 操作等不因 `allowedTools` 或 spawn `tools` 参数进入子 agent —— LLM 无法自授委派工具激活递归链
- **spawn 自授限制**:spawn_agent 的 `tools` 参数不可授予写工具(写权限只能经 `writablePaths`,受 path guard 约束);`patches` 含无 jsonPath 项(作用于根)→ PATH_OUT_OF_SCOPE
- **子 offload 桥接主 vfs**:子 agent 大结果外存直落主 vfs 共享池,子/主都能 vfs_read 回读(不 404)
- **能力包 allowedTools 生效**:`createHtmlSubagent`/`createRagSubagent` 的 vfs 工具(经中间件注入)现在能被装配解析(2.37 的装配断层已修)

### 6.2 自定义工具

给 Agent 加任意能力(API 调用、计算、宿主页面操作……):

```ts
import { defineTool, z } from 'page-agent-sdk'

const getWeather = defineTool({
  name: 'get_weather',
  description: '查询指定城市天气',
  schema: z.object({ city: z.string().describe('城市名') }),
  handler: async ({ city }) => {
    const r = await fetch(`/api/weather?city=${city}`)
    return await r.json()   // 返回 string 原样回传,其他值自动 JSON.stringify
  },
})

createChatSdk({ /* ... */ tools: [getWeather] })
```

`handler` 里 `this`/全局 `window` 就是宿主页面,可直接操作 DOM 或调用页面已有方法。

### 6.3 Skills(渐进式披露)

把**大段上下文**(如组件库文档、操作指南)做成 skill,Agent 按需加载,避免一次性塞满 prompt:

```ts
import { defineSkill } from 'page-agent-sdk'

createChatSdk({
  skills: [
    defineSkill({
      name: 'component-lib',
      description: '组件库使用文档',
      whenToUse: '用户要用组件库搭页面时',
      // 内容来源二选一(doc 优先于 getContent):
      getContent: () => fetch('/docs/components.md').then(r => r.text()),
      // 或用 doc 文档源(skill 内容与代码解耦,放 md 文档维护):
      // doc: 'https://host/components.md',        // 远程 md(同源/CORS)
      // doc: 'vfs://skills/components.md',        // vfs 启用时从工作区读
    }),
  ],
})
```

Agent 会在需要时调用 `load_skill('component-lib')` 把内容载入上下文。`doc` 源在加载时自动读取(http fetch / vfs 读取),读取失败(跨域 / 未找到 / vfs 未启用)返回结构化错误提示,超长截断(20000 字符)。

#### 6.3.1 动态 skill:exec 加载时执行 + tools 附带工具(skill-external-scripts)

SkillSpec 新增两可选字段,把 skill 从「说明书」升级为「说明书 + 执行器」:

```ts
defineSkill({
  name: 'orders',
  description: '订单概览与查询',
  getContent: () => '本 skill 用于查看订单。可用 query_orders 按条件筛选。',
  // exec:加载时执行一次,结果注入全文(一次性上下文初始化,拿快照)
  exec: {
    code: 'return await fetch("/api/orders/summary").then(r => r.json())',  // 内联 JS
    context: 'sandbox',  // 默认且唯一:Worker 沙箱(无 window/网络,三层防护);'host' 已随 4.1.0 移除(残值落 sandbox 执行)
    inject: 'append',    // 默认 append(文末);'prepend'(文首)
    // url: 'https://host/orders.js',  // 远程脚本(仅 sandbox,禁止 host)
  },
  // tools:附带可反复调用的工具(load_skill 后注入工具池)
  tools: [() => queryOrdersTool],
})
```

**exec vs tools 语义(正交,勿混用)**:

| 字段 | 定位 | 触发 | 频次 |
|---|---|---|---|
| `exec` | 上下文初始化(加载时拿一次性快照,如「当前订单概览」) | `load_skill` 时自动 | 一次(每次 load 重跑) |
| `tools` | 查询能力(反复调用,如「按条件查订单」) | LLM 显式调 | 反复 |

- **exec 安全边界**:恒 `sandbox`(复用 eval_script 的 Worker 沙箱:静态扫描 + `lockSandboxGlobal` 锁网络层 + 超时)。`context:'host'`(宿主全权)已随 4.1.0 移除 —— 残值 `'host'` 落 sandbox 执行(原宿主全权降级为沙箱,语义反转见 CHANGELOG);需宿主全权逻辑请用 defineSkill 的 `tools` 工厂在集成方侧编排。
- **exec 失败不缓存**:脚本执行失败(如网络抖动)不阻塞 skill(文本仍可用 + 标注失败原因),且**不写缓存**——下次 `load_skill` 重新执行(动态 skill 韧性);成功才缓存(跨轮跨会话复用)。
- **exec 大结果**:注入文本 + exec 结果总量超 6000 字符时,走 createAgent 通用 offload(转 vfs + 预览),LLM 按需 `vfs_read` 二次读;「一次读全」仅保证静态文本部分(动态数据本就该按需查,契合渐进式披露)。

**多层级参考文档 `references`(大 skill 渐进式披露)**:浏览器端配置「SKILL.md 索引 + references/ 多文件」形态的大 skill(风格配方库、模式库、评审指南等),主文档只写「何时用 + 怎么用」,二级文档挂 `references` 按需取回 —— 26 个配方式大 skill 不整包灌上下文:

```ts
defineSkill({
  name: 'web-design-engineer',
  description: 'Web 视觉设计:风格选型/排版/评审',
  doc: 'vfs://skills/wde/SKILL.md',            // 主文:索引 + 方法(或 getContent 内联)
  references: [
    { name: 'style-recipes/linear.md', description: 'Linear 极简工具风', doc: 'vfs://skills/wde/style-recipes/linear.md' },
    { name: 'style-recipes/aesop.md', description: 'Aesop  editorial 质感', getContent: () => AESOP_MD },  // 构建链可 import.meta.glob raw 内联
  ],
})
```

- `load_skill(name)` 主文末**自动附参考目录**(name + description + 「按需 `load_skill(name, ref)`」指引);LLM 选定后 `load_skill(name, ref='style-recipes/linear.md')` 单独取回该参考(独立缓存,同轮重复拦截)。
- 参考来源语义同主文(`doc` http/vfs / `getContent` 内联);构建链集成方用 `import.meta.glob('.../*.md', { as: 'raw' })` 把整目录打进 bundle 再映射成 references,CDN 无构建链则 `doc` 指静态托管 URL。
- `sdk.invalidateSkillCache(name)` 同清主文 + 全部 ref 缓存(动态 skill 失效语义一致)。
- **tools 注入**:`load_skill` 后工具求值 → 注入 agent 工具池(经 dedupeTools 去重,建议命名空间前缀 `<skill>__<tool>` 防重名);source 标 `skill:<name>`;`sdk.setSkills`/`invalidateSkillCache` 卸载。

### 6.4 Memory(持久指令)

写入 AGENTS.md 风格的持久指令(项目规范、固定约束),**每次对话都生效**,且会持久化:

```ts
createChatSdk({
  memory: `
## 项目规范
- 所有金额单位为分(整数)
- 修改表单前必须先读取当前值
- 颜色只用 #667eea / #764ba2 色系
`,
})
```

**支持异步函数 source(适合 RAG / 异步加载文档)**:

```ts
// 异步加载知识库文档作为 memory
createChatSdk({
  memory: async () => await fetch('/kb/faq.md').then((r) => r.text()),
})

// 同步函数读运行时变量(注意:函数 source 默认缓存首次求值结果)
let lang = 'zh'
createChatSdk({ memory: () => `请用${lang}回答。` })
// lang 变了需 sdk.refreshMemory() 强制重新求值
```

| source 形态 | 求值时机 | 缓存 | 适用场景 |
|---|---|---|---|
| `string` | 立即 | 无需 | 静态文本(规范、约束) |
| `() => string` | 首次 `beforeAgent` | 是,`refreshMemory()` 重求 | 读运行时变量 |
| `() => Promise<string>` | 首次 `beforeAgent`(后台预求值) | 是,`refreshMemory()` 重求 | 异步加载 RAG 文档 |

> **缓存策略**:函数 source 首次求值后缓存结果,后续 `beforeAgent` 直接用缓存(避免每轮重复 fetch)。`setMemory(newSource)` 或 `refreshMemory()` 可清缓存重求。异步求值失败降级为空串(不阻塞 agent)。
> **持久化**:函数 source 不可序列化,落盘的是已解析的文本;reload 时 `options.memory` 仍是函数会重新求值(文档可能已更新,符合预期)。

### 6.5 Planning(任务规划,自动)

SDK 内置 todos 规划能力(中间件),**默认开启,无需配置**。遇到多步任务时,Agent 会:

1. 调 `write_todos` 把任务拆成清单(pending / in_progress / completed)
2. 逐项执行,每完成一项更新清单状态
3. 清单每轮注入 prompt,Agent 始终看得到全局进度

想让规划**可靠触发**,在 `systemPrompt` 里加一句引导:

```ts
systemPrompt: '遇到多步骤任务(≥3 步)时,先用 write_todos 拆解成清单,逐项执行并更新状态。'
```

简单任务 Agent 会直接做,不规划(符合预期)。todos 会随持久化保存,刷新可恢复。

### 6.6 持久化与会话管理

**开启**:给 `storage` 赋值即切换后端(3.9+ 默认 `'memory'` 纯内存多会话,不落盘;`false` 显式关闭;跨刷新持久化用 `'indexed'`):

```ts
storage: 'indexed'                          // IndexedDB(推荐,容量大)
storage: 'session'                          // sessionStorage(标签页内)
storage: 'local'                            // localStorage(持久)
storage: 'memory'                           // 纯内存(测试/降级)
storage: { backend: 'local', maxBytes: 2*1024*1024 }  // 配置对象
storage: false                              // 显式关闭
```

**持久化什么**:对话历史 / vfs 工作区 / todos / memory。(**主数据 `bind` 不持久化** —— `bind` 是集成方的业务对象(可能含函数/DOM/循环引用,SDK 不擅自深拷贝);集成方若需跨刷新/会话恢复 `bind`,自行存储后用 `sdk.setData({ bind: restoredBind })` 注入。dataOps 的 per-path 快照栈亦不持久化,刷新后清空。)

**多 agent 隔离**:靠 `id` 区分。同页多个 Agent 传不同 `id`,数据互不串扰。

**容量与淘汰**:各后端达上限自动按 LRU 淘汰最旧会话;隐私模式 / 撞配额自动降级内存,**不崩溃**。

**会话切换(命令式)**:

```ts
const agent = createChatSdk({ id: 'my-app', storage: 'indexed', /* ... */ })
await agent.mount()

await agent.switchSession()              // 新建会话
await agent.switchSession('session-xyz') // 切到指定会话(不存在则以该 id 新建)
agent.resetSession()                     // 清空当前会话(同步):重置全部内存态 + 新会话
```

**清空会话 `resetSession()`(2.41.0+,同步)**:与 UI「清空对话」同语义 —— 中止在途流 + 收口挂起冲突(按「保留外部」)+ 重置 messages/vfs/todos/memory/mission/workingMemory/focus/checkpoint/debugLogs + 换新 sessionId + emit `session_restored`。**storage 未开启时同样完整重置内存态**(2.41.0 修复:此前无 storage 会早退,mission/focus/todos 泄漏进新对话);开启 storage 时同步新建持久会话。headless 集成方的「新建对话」按钮用它。

**自动恢复**:`session.autoResume`(默认 true)刷新后自动恢复该 agent 最近会话。

**恢复提示(resume-notice,默认开)**:从持久化恢复了**非空历史**(刷新 autoResume / `session.id` / `switchSession` 载入)后,恢复后的**首轮** system prompt 会注入一段提示:「你不在场期间宿主数据可能已变(如刷新回退到上次保存态、未保存修改丢失);断言『已生成/已完成』前先用 read/list 核实当前状态」。背景:恢复的对话/todos 是历史快照,而**主数据 `bind` 不持久化**——若集成方刷新后把 `bind` 重置回上次保存态,历史里的「已完成」与现状就脱节,agent 曾据此对「重新生成」直接答「完毕」而不核实。该段为一次性(本轮结束自动消失),只递信号不阻断工具;留痕 `debugLogs stage:'resume_notice'`。

### 6.7 对话鲁棒性(重试 / 停止 / 重试)

**① 自动重试(底层,对用户透明)**
模型调用遇到网络错误 / 429 / 5xx 自动指数退避重试(默认 `maxRetries: 2` = 最多 3 次尝试)。4xx(参数错误)不重试。调 `maxRetries` 可改:

```ts
createChatSdk({ maxRetries: 4 })   // 更激进,适合网络不稳
createChatSdk({ maxRetries: 0 })   // 关闭自动重试
```

**② 停止生成**
对话框发送按钮在 Agent 思考/回复时变成灰色「■ 停止」按钮,点击立即中止。**已生成的内容会保留**(等同 ChatGPT 的停止),不会报错。

**③ 出错重试**
请求失败时,错误条上出现「重试」按钮,点击移除失败回复、用最后一条用户消息重发。

**④ 挂起有界收口(fix-hang-and-feedback)**
所有「等外部/等人」的挂起点都有超时兜底与中断通道,不会永久挂死:

- **无响应方路径的确认请求自动拒(4.1+ 中间件级)**:approval/humanConfirm 触发人工确认时,**30s 无响应自动拒绝** + `APPROVAL_AUTO_REJECTED` error 事件留痕,LLM 收到拒绝继续/收口(不再永挂)。响应方接管机制:`approval_request` 事件携带可选 `hold()` —— 内置 UI(useChat)收到即调,计时取消、无限等用户;无人调(headless 任意入口 / `send`/`batch` / `streaming:false` 等无响应方路径)→ 30s 自动拒。`approval.timeoutMs` 可覆盖(传 `Infinity`/负数 = 不超时,给自建确认通道的集成方留口)
- **send/batch 可中断**:`send(msg, { signal })` / `batch(tasks, onProgress, signal)` 接 AbortSignal;`unmount()` / `switchSession()` / `resetSession()` 也会自动中止在途流(无幽灵流烧 token)
- **MCP 握手超时**:默认 15s(`mcp[].timeoutMs` 可调),黑洞端点降级跳过,不阻塞 SDK 启动
- **MCP 工具调用超时**(3.6+):单次 callTool 默认 60s(`mcp[].callTimeoutMs` 可调),server 挂起不再拖死 ReAct 轮 —— 超时该次调用作废回灌 LLM 自纠(不重试),连接不断后续调用复用
- **LLM 流停滞看门狗**:chunk 间隔(含等首个)超 `streamStallMs`(默认 90s,0 关)→ 自动中断报错,防 loading 永转
- **流总时长上限**:单次模型调用总时长超 `streamMaxDurationMs`(默认 600s,0 关)→ 抛 `StreamMaxDurationError`(408 不重试)。兜「空转帧黑洞」:部分中转站返回 200+SSE 头后以 keepalive 空转帧维持连接(间隔看门狗被喂饱永不触发),实测冻结 7min+ 无报错;超限快速失败后重委派/重发即自愈
- **集成方工具看门狗**(`toolTimeoutMs`,默认 120s,0 关):单工具执行超时 → 放弃等待,recoverable 错误结果回灌自纠(防集成方工具永不 settle 拖死整轮:loading 永转 + stop 无效)。只对集成方注入工具生效(`defineTool` / `actions` / skill 工具工厂 / rag retriever);内置工具/MCP/子 agent 委派与乐观锁冲突挂起(等人工裁决)是设计内等待,一律豁免
- **冲突挂起可中断**:`send`/`batch` 与 UI `stream` 全入口 —— 携带的 AbortSignal abort 时,挂起的乐观锁冲突自动按「保留外部」(keep_external)收口,send 不再永不返回;外部修改保留、agent 值不落地

**⑤ 指令执行力守卫(instruction-adherence,3.35+,均默认开、零配置)**
针对真 LLM 实测的两类失效,框架内置两个宁漏勿误的守卫:

- **完结门禁(防莫名中断)**:agent 用 `write_todos` 规划后,若还有未完成项却试图以纯文本收尾,框架回灌「双出口」反馈让它继续(已完成→先 `update_todo` 标记;未完成→继续执行),最多 2 次防死循环。豁免:收尾是问号(在征询用户)或根本没规划过(空 todos)。修「拆 3 项做完 1 项就停」的提前中断。回灌文案同时会追加「已完成但 evidence 为空」项,提示补 evidence
- **错误即向导 + 同参重复提醒(工具结果内嵌,tool-call-economy C2)**:read 读到不存在的路径返回 `PATH_NOT_FOUND` 并附父级实况(数组有效索引范围 / 对象实际键集),键打错时 `PATH_DENIED` 附父级键集;同工具同参连续失败 ≥2 次时结果尾附提醒,引导换路径/换方法而不是原样重试
- **evidence 审计门禁(防编造完成证据)**:运行时提示教 agent 标 completed 时附 `evidence`(本次实际写入的 jsonPath);收口时若某任务的 evidence 路径与本次会话的写入记录对不上(该路径从未被写入),框架回灌三出口(修正路径 / 改回 pending / 如实说明完成方式),最多 2 次,超限放行并留 `AUDIT_GATE_EXHAUSTED` observable;轮次耗尽强制收口路径也会零成本补跑审计(`AUDIT_EVIDENCE_SUSPECT`)。描述性证据(不含路径形态)不核对;纯委派完成的任务建议 evidence 写明完成方式而非路径
- **问句意图守卫(防注意力漂移)**:正则三档启发式(句尾问号 / 疑问词+吗呢 / 查询词「是什么|怎么用|有哪些」)逐条判定用户消息是否为提问;命中则注入「先答勿做」pin 段(跨压缩存活),引导先用 read/query/rag 查证作答、别误触生成/修改。修长对话里「问这是啥组件却被历史拖着去生成代码」的误路由。**只递信号不阻断工具**,文案带「除非同条消息明确要求操作」逃生门,祈使句(「把标题改成X」)不受影响

### 6.8 上下文与内存上限

长会话不会撑爆内存:

- **上下文压缩**:`summarization` 中间件自动滑动窗口 + 摘要 + 关键词召回(默认开启)。摘要默认用 LLM(低温 0.3、限输出 1024)把旧轮次改写为连贯段落,失败/超时自动回退零成本索引摘要。**LLM 摘要异步化(2.41.0+)**:压缩触发时先用索引摘要即时返回(**不阻塞首 token**;修前同步等 LLM ≤15s),后台补跑 LLM 摘要入前缀缓存,后续轮次命中缓存(LLM 前缀 + 新增尾部索引增量)——体感零延迟、摘要质量不降。
- **压缩预设**(`contextPreset`,默认 `auto`):普通场景选档即可,特殊情况用 `contextOptions` 细参覆盖个别字段。
  - `auto`:自适应,LLM 摘要 + 召回 Top-3,触发阈值 0.5、窗口 0.4
  - `conservative`:大模型/省成本,阈值 0.7、窗口 0.5,召回 Top-2,关 LLM 摘要用索引摘要
  - `aggressive`:小模型/省上下文,阈值 0.3、窗口 0.3,召回 Top-5
  - `complex`(2.16.0+):多步复杂任务/大 JSON/长流程,比例制:窗口 0.6、触发阈值 0.7、召回 Top-5、开 LLM 摘要;`preserveLastToolResults` 默认含 `describe_data`/`read`/`query_data`/`search_data`(大 JSON 场景防字段描述被摘要丢)。详见下文「complex 预设 + vfs JSON 感知工具」
- **摘要专用模型**:`summaryLlm` 可指定更便宜的小模型做摘要(不配用主 `llm`);`summaryTemperature`/`summaryMaxTokens`/`summaryTimeoutMs` 微调摘要 LLM。
- **压缩触发成本上限**(`contextOptions.promptSoftCapTokens`,3.11+):token 触发阈值取 `min(窗口 × ratio, softCap)`。大窗口模型(如 flash 类 1M 窗口)按 ratio 要烧到几十万 token 才压缩,成本不可接受;softCap 把「何时压缩」改成成本维度 —— **未传且窗口 ≥320K 时默认 160K**,显式传值用该值,显式 `0` 关闭(小窗口模型不受影响,只会更早触发不会更晚)。生效值经 `inspect().compression.promptSoftCap` 反射核对。详见 `doc/context-management.md` §五。
- **对话历史上限**:`maxMemoryRounds`(默认 30)超限把最旧轮次压缩为一条摘要 system 消息。
- **vfs 工作区上限**:`vfs.maxBytes`(默认 8MB,2.16.0+)超限按 LRU 淘汰最旧文件。2.16.0+ **三池分池**:`large_results/*`(工具结果外存,自动)、`drafts/*`(草稿)、`userFiles`(用户文件)各自独立 LRU 互不挤占(默认单池 2MB,large_results 4MB),`vfs.poolBytes` 可单池配,读写跨池透明。

这些在 `storage: false`(纯内存)下也生效,防 OOM。

压缩统计可在 DebugDrawer「🧬 Agent 信息」tab 的「🗜️ 上轮压缩」段查看(触发与否、摘要轮次、召回条数、策略名),排查"上下文为何变了"。

#### 预算自感知与单轮预算(3.11+)

agent 对自身消耗有了感知,长任务不再「闷头烧到中断」:

- **轮次预算感知(3.43,createAgent 核心)**:已用轮次达 `maxToolRounds` 的 70% 起每轮持续注入「⚠️ 轮次预算提醒」、剩余 ≤2 轮升级「告急」(引导优先收口/如实标记未完成项,模型撞墙前自适应而非触顶被打断;只进本轮 system 重渲染不污染历史)。**消耗提示(C1,token 维度)**:本次任务累计 prompt token 达 softCap 一半时注入一行「⏳ 预算提示」(每任务一次;轮次维度已移交核心持续注入)。
- **写失败提醒(C2)**:同一写路径连续 ≥2 次失败(乐观锁冲突/schema 拒绝等)时,注入「先 read 重新核对 / restore_data 回退」提醒,防同一条路反复撞墙。
- **单轮 token 预算**(`roundTokenBudget`,opt-in 默认关):单次 `send` 的累计 token 超限 → 友好收口文本中断(已完成部分保留,可继续对话「继续完成」),debugLogs 留痕。与 automation 的 `tokenBudget` 正交:后者跨会话累计、需 `capabilities.automation`;本项单次调用、无条件可用,防单轮死循环烧钱。

```ts
createChatSdk({ roundTokenBudget: 50000 })  // 单次对话任务最多约 5 万 token,超限友好收口
```

#### 上下文构成查看 `inspectContext`(2.24+)

长对话 + 大 JSON 场景,回答质量下降时第一诊断动作是「上下文里什么占了最多」。2.24 新增**上下文构成检查**(默认开,`capabilities.contextInspector: false` 关):

- **`sdk.inspectContext()`**:返回最近一次发给 LLM 的消息列表的**分类 token 占用快照**(`ContextSnapshot`):总 token、按类目(system 主 prompt / 工具结果 / 用户 / assistant / 摘要等)的 token + 占比 + 消息数、窗口占用率(对比模型 `contextWindow`)、是否接近压缩阈值。
- **`inspect().context`**:同一快照经 `inspect()` 暴露(供 DebugDrawer 展示);`capabilities.contextInspector: false` → `undefined`。
- **DebugDrawer「📊 上下文」tab**:总览进度条(色阶 + 阈值线)+ 分类横向 bar + 上次压缩信息。

纯 `estimateTokens` 估算,**零额外 LLM 成本**(不调模型,只对每轮 `beforeModel` 实际发送的消息分类估算)。适合诊断「为什么压缩了 / 上下文被什么撑大 / 离阈值多远」。

#### 三者关系(`maxMemoryRounds` vs `contextOptions.windowRounds` vs `capabilities.summarization`)

三个配置各管不同层级,易混淆,对比:

| 配置 | 层级 | 作用 | 默认 | 关掉后果 |
|---|---|---|---|---|
| `capabilities.summarization` | 总开关 | 是否装载压缩中间件 | `true`(开) | 不压缩,只剩 `maxMemoryRounds` 硬截断(最旧轮次直接丢弃,无摘要) |
| `contextOptions.windowRounds` | 每轮 LLM 输入层 | 滑动窗口保留最近 N 轮**原文**,更老的进摘要区 | 6(`auto` 预设) | 窗口=0 则全进摘要区(每轮都压缩,省上下文但丢原文细节) |
| `maxMemoryRounds` | 持久化/内存层 | 对话历史**硬上限**,超限把最旧轮次压缩为一条摘要 system 消息 | 30 | 无上限(长会话 OOM 风险) |

**易混点澄清**:
- `maxMemoryRounds` ≠ `windowRounds`:前者是「历史最多存多少轮」(超限压缩归档),后者是「每轮给 LLM 看多少轮原文」(更老的摘要化)。例:`maxMemoryRounds=50, windowRounds=6` = 最多存 50 轮历史,但每轮 LLM 只看最近 6 轮原文 + 更老的摘要。
- `contextPreset`(`auto`/`conservative`/`aggressive`)是 `contextOptions` 的预设档,改 preset 等于批量调 `windowRounds`/`summaryThresholdRounds` 等阈值;`contextOptions` 显式字段覆盖 preset。
- 关 `capabilities.summarization` 后,`contextOptions` 全部失效(中间件不装载),只剩 `maxMemoryRounds` 硬截断 —— 适合「上下文由接口方管理,SDK 不压缩」的场景。

#### complex 预设 + vfs JSON 感知工具(2.16.0+)

面向**多步复杂任务 / 大 JSON 操作 / 长流程编排**场景,2.16.0 新增 `complex` 上下文预设 + vfs JSON 感知工具 + 三池分池 + offload 结构化元数据,提升长流程的上下文稳定性与大文件局部编辑能力。

**① `complex` 上下文预设**

`auto`/`conservative`/`aggressive` 面向普通对话,而多步复杂任务(低代码页面搭建、大型配置编排、长文档处理)的特点是:工具结果体积大、单轮上下文需求高、关键字段描述需跨轮保留。`complex` 用**比例制**适配这类场景:

| 字段 | complex | auto(对比) | 说明 |
|---|---|---|---|
| `windowRatio` | 0.6 | 0.4 | 每轮保留最近 60% 上下文窗口给原文(大 JSON 工具结果需更多原文) |
| `summaryThresholdRatio` | 0.7 | 0.5 | 上下文用量达 70% 才触发压缩(晚压缩,减少丢细节) |
| `recallTopK` | 5 | 3 | 召回更多旧轮次(复杂任务上下文关联性强) |
| `enableLLMSummary` | true | true | 用 LLM 摘要(保证摘要质量) |
| `preserveLastToolResults` | `['describe_data','read','query_data','search_data']` | `['describe_data','read']` | 额外保留 query/search 结果摘要(大 JSON 查询场景防丢) |

```ts
createChatSdk({
  contextPreset: 'complex',   // 一键启用多步复杂任务档
  // 也可逐字段覆盖(与 auto/conservative/aggressive 相同)
  contextOptions: { recallTopK: 8 },  // 例:任务特别长,召回更多旧轮次
  // ...
})
```

> `inspect().contextPreset`(2.16.0+)可在 DebugDrawer 查看 Agent 实际生效的预设档。

**② vfs JSON 感知工具**(`vfs_json_read` / `vfs_json_patch` / `vfs_write` jsonString)

vfs 工作区常用于存大 JSON(抓取的 API 响应、组件库快照、配置树草稿)。2.16.0 之前只能整体 `vfs_read` 读 + `vfs_write` 整体覆盖重写,大 JSON 整体重传易被 `max_tokens` 截断。新增两个工具支持**按 jsonPath 局部读写**:

```ts
// vfs_json_read:按 jsonPath 读 vfs 文件内 JSON 子树(省略读整体)
vfs_json_read({ path: 'drafts/config.json' })                          // 读整体
vfs_json_read({ path: 'drafts/config.json', jsonPath: 'components.0' }) // 只读某子树(省 token)

// vfs_json_patch:在 vfs 文件内原子 jsonPath patch(在 clone 上应用,任一失败整体不写回)
vfs_json_patch({
  path: 'drafts/config.json',
  patches: [
    { op: 'set',    jsonPath: 'title',         value: '新标题' },
    { op: 'append', jsonPath: 'items',         value: { id: 99 } },
    { op: 'merge',  jsonPath: 'style',         value: { color: 'red' } },
    { op: 'remove', jsonPath: 'deprecated' },
  ],
})
// 任一 patch 失败 → 返回 PATCH_FAILED,原文件不变(原子)

// vfs_write jsonString:true → 写入前校验 content 是合法 JSON(非法返 VFS_JSON_INVALID,不写入)
vfs_write({ path: 'drafts/config.json', content: '{"a":1}', jsonString: true })
```

| 工具 / 错误 | 含义 |
|---|---|
| `vfs_json_read` 返 `VFS_JSON_INVALID` | 文件内容不是合法 JSON |
| `vfs_json_read` 返 `VFS_PATH_NOT_FOUND` | jsonPath 在 JSON 中不存在 |
| `vfs_json_patch` 返 `PATCH_FAILED` | patch 应用失败,原文件未改(原子) |
| `vfs_write(jsonString:true)` 返 `VFS_JSON_INVALID` | content 非合法 JSON,不写入 |

> 动机:大 JSON 局部编辑走 jsonPath patch,只发改动、不重传整文件,规避 `max_tokens` 截断导致整体 JSON 不完整。配合主数据侧的 `write({patch})` 同构语义。

**③ vfs 三池分池**

2.16.0 前 vfs 是单池 LRU,工具结果外存(`large_results/*`)与用户草稿(`drafts/*`)/用户文件(`userFiles`)抢同一配额,大结果挤掉草稿(误删用户数据)。现分三池独立 LRU:

| 池 | 前缀 | 默认配额 | 用途 |
|---|---|---|---|
| `large_results` | `large_results/*` | 4MB | 工具结果自动外存(>6000 字符;>10000 附 `suggestedReadPlan`) |
| `drafts` | `drafts/*` | 2MB | Agent / 集成方写入的草稿 |
| `userFiles` | `userFiles`(无固定前缀) | 2MB | 用户文件 |

`vfs.maxBytes`(总,默认 8MB)、`vfs.poolBytes`(单池,可覆盖)。读写跨池透明(路径前缀自动路由)。

```ts
createChatSdk({
  vfs: {
    maxBytes: 16 * 1024 * 1024,            // 总上限调大(默认 8MB)
    poolBytes: { drafts: 4 * 1024 * 1024 }, // 单池配:草稿池给 4MB(其余默认)
  },
})
```

**④ offload 结构化元数据 + suggestedReadPlan**

工具结果外存(>阈值)的返回值升级为 `OffloadResult`,附结构化元数据。**大结果(>10000 字符)附 `suggestedReadPlan`**——给 LLM 一份 `vfs_read` 分页/分段读取建议(如先读哪段、分几页),引导 Agent 分块消费而非一次塞满上下文。集成方无需配置,自动生效。

### 6.9 子 agent(委派与并行)

主 agent 可委派**独立子 agent**处理子任务,只把最终结论收回主上下文(**过程隔离**,省主 token)。默认开启,Agent 自动获得两个工具:

- `spawn_agent({ prompt, role?, tools?, model? })` —— 委派一个子 agent
- `spawn_agents({ tasks: [{ prompt, role? }, ...] })` —— 并行委派多个,聚合结论

**适用**:分治大任务、多路调研、多视角审查、批量处理。

```ts
createChatSdk({
  // ...
  tools: [myResearchTool],
  subagent: {
    allowedTools: ['myResearchTool'],  // 子 agent 可用的额外工具(默认仅只读主数据 + fetch)
    maxDepth: 1,    // 递归深度(默认 1:主可 spawn,子不可再 spawn)
    maxParallel: 4, // spawn_agents 并发上限(默认 4)
    // timeoutMs: 300000, // 单次委派总时长(4.1+ 默认 600000=10min 挂起兜底;0=不限制;超时 abort 子流,错误回灌主 LLM 可重试/拆分)
    // enabled: false  // 关闭子 agent
  },
  maxParallelTools: 1,  // 同轮工具并发(默认 1 串行;与 subagent.maxParallel 不同)
})
```

**要点**:
- **过程隔离**:子 agent 的思考/工具调用**不进入主上下文**,只进最终结论(省 token + 不干扰主推理)。
- **只读默认**:子 agent 默认只用只读工具(window 只读 + fetch),不直接改页面;写回交主 agent。经 `allowedTools` 放开额外工具。
- **signal 继承**:主对话停止 → 子 agent 也停。
- **进度展示**:子 agent 跑时,对话框里 `spawn_agents` 步骤下方**实时嵌套显示**每个子 agent 正在调用的工具(如 `[子任务1] get_source ✅`)。子过程**只进 UI、不进主上下文**。
- **乐观锁基线隔离(2.40+)**:子 agent 的 read/write 使用**独立的 autoLock 基线**(per-scope),子 read 不再刷新主的基线 —— 父委派前 read、期间数据被外部改过、委派回来再写 → 照常触发冲突(修前:子 read 掩盖外部修改 → 父过期写静默覆盖)。
- **spawn_agents 逐项结算(2.40+)**:单个子任务失败不再拖垮整批 —— 各子任务独立成功/失败,聚合结果按 `【子任务 N】✓/✗` 逐条标注,失败带错误摘要,由主 LLM 决策如何处理。
- **同轮并行委派与失败隔离(3.13+)**:预声明 `use_<id>` 委派支持**同轮并行** —— 主 agent 可在一轮里对**不同**目标同时发多个委派(需 `maxParallelTools > 1`,默认 1 串行;html 编排 prompt 已自动引导)。**失败隔离**:无关联的并行任务一个出错**不批量回退** —— 失败委派以错误结果单独回灌主 agent,其余委派照常执行落地;代码资产 commit 按组件逐个容错(单组件 commit 失败跳过并留痕,不影响其他组件)。与单次 `write({ patches })` 的「任一失败整体回滚」是两类语义:后者是**一次逻辑写**的原子意图(关联任务),并行多委派是多次独立逻辑写(无关联),按任务关联性区分。
- **组件锁 · 同组件单委派互斥(3.13+ 机制锁)**:同一组件同一时间只允许一个在途委派,不再只靠 prompt 引导 —— ① **委派互斥**:同轮/并发对同一组件的第二个 `use_html` 立即回灌 `COMPONENT_BUSY`(recoverable,零子 agent 消耗,主 agent 下轮重委派即可);锁目标 = `components` 显式声明(过滤编造名),缺省时 task 文本与已知组件名**整词唯一命中**才锁(宁漏不误,0 或 ≥2 命中不锁);不同组件锁相互独立,不阻塞并行。② **主写守卫**:委派在途时主 agent 写工具(write/draft_commit)命中被锁组件子树 → 回灌 `COMPONENT_LOCKED`(整体 set 全量数据也拒;`dryRun` 不拦),锁释放后放行;**codeField 恒守卫(3.24.1+,html code-asset 模式)**:已存在代码组件的 code 字段(如 `components.N.code`)主 agent **恒不可直写**(与在途无关)→ 回灌 `CUSTOM_CODE_DELEGATION` 引导委派(实测弱指令模型无视提示词禁令直写覆盖人工值,机制化兜底;新建元素/整体 set/dryRun 不拦)。③ **人工并发保护**:委派在途窗口(checkout→commit)内人工/宿主直改 bind —— 同组件 code 被外部改过 → commit 保留人工值(keep_external,不静默覆盖)+ warn 留痕 + **keep_external 组件名随委派返回值回流主上下文**(主 agent 收口如实告知用户「已保留你的版本,是否仍按原任务继续」,不误判为子 agent 失败后重写);组件被删 → 不复活 + vfs 工作副本同步清理;索引位移(插入/删除致组件挪位)→ commit 按 `__pgId` 落到同组件,不写错位置。观察层:`inspect().subagent.lockedComponents`(组件名 → 占用委派)+ DebugDrawer 子 agent tab 锁视图。
- **子 token 计入用量(2.40+)**:子 agent 的 LLM 消耗累加进 `sdk.usage`(automation `tokenBudget` 口径完整)。

**自定义子 agent**(4 层级,从简到繁):
- ① **配置级**:`subagent: { allowedTools, maxDepth, maxParallel, enabled }` —— 放开子 agent 可用工具、控制递归/并发
- ② **调用级**:LLM 调 spawn 时按需设 `role`(子 agent 身份)/ `tools`(本次限定)/ `model`
- ③ **引导级**:systemPrompt 指导何时/如何委派(如「多方案对比用 spawn_agents」)
- ④ **高级**:直接 `createSubagentMiddleware({ llm, allTools, allowedTools, ... })` 自构造中间件(自定义 harness)
- ⑤ **预声明级(命名子 agent)**:`subagents: [...]` 预声明一组命名子 agent,每个自动生成 `use_<id>` 委派工具,配置同主(独立 llm / systemPrompt / tools / skills / 温度),缺省继承主。适合**固定角色**(调研专家 / 代码审查 / 文案):
```ts
createChatSdk({
  llm: mainLlm,
  subagents: [
    { id: 'researcher', description: '调研专家', llm: claudeLlm, systemPrompt: '你是调研专家…', tools: [...] },
    { id: 'reviewer', description: '代码审查', llm: deepseekLlm },
  ],
})
// 主 LLM 直接调:use_researcher({ task }) / use_reviewer({ task })
// 子 agent 配置缺省继承主(不传 llm/systemPrompt 则同主);与 spawn_agent 共存
```

**规划-反思-执行模式**(创作/设计场景):预声明高温 `planner`(创意规划,只读)+ 低温 `reflector`(反思审查,只读),主 agent 低温度落地。`usageHints` 中间件按 `subagents` 的 temperature/description **自动注入路由提示**(高温≥0.7 或描述含"规划/创意/设计"→ planner;低温且描述含"反思/审查/挑刺"→ reflector),无需手写 prompt:

```ts
createChatSdk({
  llm: { ...mainLlm, temperature: 0.3 },          // 主 agent 低温度:执行落地要稳
  subagents: [
    { id: 'planner', description: '创意设计规划师,擅长页面主题/风格方案设计(只出方案,不落地)',
      temperature: 0.9,                            // 高温度 → 创造力
      systemPrompt: '你是创意设计规划师。只读主数据,给出 2-3 套方案(JSON 草稿),不要调写工具。' },
    { id: 'reflector', description: '设计反思审查员,挑方案的不一致/不可行/体验问题',
      temperature: 0.3,
      systemPrompt: '你是设计反思审查员。对方案挑刺并给修订建议,不要重写整个方案。' },
  ],
  approval: { tools: ['write'] }, // 落地写前确认
})
// 流程:用户"设计夏日主题" → 主 agent 识别创作类 → use_planner 出方案
//      → (可选)use_reflector 审查 → request_human_confirmation 让用户选 → write 落地
```

> 路由由主 agent 自判(usageHints 提示词引导);若误判率高,可升级为路由中间件(`beforeModel` 跑轻量 router 判模式,`augmentPrompt` 注入模式指令)。`planner-demo`(`/examples/planner-demo/`)演示完整闭环。

> 子 agent 边界:默认**只读**(不改页面)、**过程隔离**(只回结论)、**递归物理切断**(maxDepth)、**signal 继承**(主停则子停)。

**示例**:`npm run dev` 后访问
- `/examples/subagent-demo/` —— 方案并行调研(spawn_agents 基础)

### 6.10 Verify 自检(Agent 返回前验证 + 自纠)

Agent 给出最终答**之前**,自动跑一次 `check` 验证结果;不通过则把 feedback 回灌给 Agent,驱动它修正后再答(限 `maxAttempts` 次,防死循环)。**默认关闭**(烧 token),需显式开启。

```ts
createChatSdk({
  // capabilities: { verify: true },   // 可省 —— 传了 verify.check/maxAttempts/adversarial 任一即自动开启
  verify: {
    maxAttempts: 2,                     // 自纠上限(默认 2)
    // check: async ({ messages, state }) => ({ ok: true }),  // 自定义;省略 → 默认写后读回验证
  },
})
```

> **开启方式(3.11+ 简化)**:传 `verify.check` / `verify.maxAttempts` / `verify.adversarial` 任一即自动开启,无需再配 `capabilities.verify: true`。`capabilities.verify: false` 显式关闭可阻止自动开;`verify.enabled: false` 优先级最高。

**内置 check(默认)**:`createWriteBackCheck()` —— Agent 写了主数据(`write`)后,读回值确认写入生效 + 符合 schema。读回根对象自动取 `data.bind`(经 getter,适配 `sdk.setData` 运行时替换 bind;旧 windowProps 模式回退 `window`):
- **写后读回**:set/edit 后读回为空 → 「未生效」反馈;读回不符合 schema → 反馈
- **delete 语义**:delete 后读回空 = 删除成功(放行);仍有值 → 「未删干净」
- **跳过被拒写**:写被合法拒绝(schema 校验失败 / 范围拒绝 / 白名单 `PATH_DENIED`)时**不误报**(读回无值是预期)
- dataOps 写入同步,check 读回无需 `await`

**自定义 check**:写领域相关的验证(业务规则、不变量)。好 check 返回**具体可操作**的 feedback:
```ts
verify: {
  check: async ({ messages, state }) => {
    const last = messages[messages.length - 1]
    // ✗ 不要「结果不对」这种模糊话;✓ 给具体可修的指引
    return { ok: false, feedback: '回复缺少价格字段,请补充' }
  },
}
```

**何时用**:Agent 改主数据后想确保写入生效 / 符合预期。**何时不用**:纯问答(无写操作,check 自动放行)、对延迟敏感(自纠多跑 LLM 轮次)。

**查看状态**:`agent.inspect().verify` → `{ enabled, maxAttempts }`。

> **对抗验证**(`verify.adversarial: true`):check 通过后 spawn 一个**配只读工具**的"找茬"子 agent(refute 姿态,可实证读回主数据检查而非臆测,突破自审偏差)再审一遍。默认关(每次烧一个多轮子 agent token)。
>
> **策略**:开 verify 即用 `createWriteBackCheck`(写后读回 + schema 校验,低成本**必备**);adversarial 作可选增强(语义复杂场景才开)。

### 6.11 Approval 人工确认(工具调用前 human-in-the-loop)

人工确认分**主动**与**被动**两侧,默认行为不同:

- **主动侧(默认开启)**:装载 `request_human_confirmation` 工具,LLM 在**不确定 / 多方案 / 高风险不可逆**时主动调用征询用户(把选项做成可点选按钮,而非自行猜测);usageHints 自动注入默认提示词引导何时调用(无需你写 prompt)。`humanConfirm: false` 关闭。
- **被动侧(白名单,默认关闭)**:`approval.tools`/`approval.confirm` 指定的工具调用前自动弹确认框,用户「允许/拒绝」后才执行——防 AI 误改页面/误删数据。需传 `approval` 选项声明(业务相关,无法自动推断)。

```ts
createChatSdk({
  // ... 其他配置
  // humanConfirm: true,  // 主动征询(默认开启,不传也开;false 关闭)
  approval: {
    tools: ['write'], // 被动:需确认的工具名(write 主写入口)
    // confirm: (name, args) => args?.path?.startsWith('Editor.'),  // 自定义判定(优先于 tools)
    // timeoutMs: 30000,  // 无响应自动拒(4.1+ 默认 30000;响应方调事件 hold() 接管后不限时;Infinity/负数=不超时)
    // humanConfirmTool: false,  // 传 approval 时亦可关主动侧(等价于顶层 humanConfirm:false)
  },
})
```

**机制**:`wrapToolCall` 拦截 → 发 `approval_request` 流式事件(带 `resolve` 回调,`resolve(boolean | string)`)→ 内置 `ChatDialog` 渲染确认条:
- 被动确认:展示工具名 + 参数预览 + 允许/拒绝
- 主动征询:展示问题(question)/可选方案(options)/推荐(recommendation),多方案时渲染选项按钮供用户选

用户点击 `resolveApproval(true/false/方案)` → 中间件收口:允许则执行,拒绝则返回结构化 error(LLM 可据此改方案,如换只读路径)。

**主动征询示例**:LLM 调 `request_human_confirmation({ question: '主标题改红色还是蓝色?', options: ['红色','蓝色'], recommendation: '红色更醒目' })`,UI 弹出问题 + 两个选项按钮,用户点「红色」→ 工具返回 `用户选择了:红色` → LLM 据此执行。

**abort 联动**:用户「停止生成」或进入时 signal 已 abort → 自动拒绝(防永久挂起);`timeoutMs` 超时也自动拒绝。

**headless 自建 UI**(`ui:false`):自监听 `approval_request` 事件,事件对象含 `{ toolName, args, resolve }`,自建确认框后调 `resolve(true/false/方案)` 收口。

> **开启条件速查**(「主动征询如何开启」):
> - **主动征询默认开启**(不猜测):不传任何选项也装载 `request_human_confirmation` 工具 + 注入默认提示词,LLM 遇不确定/多方案/高风险时主动征询。
> - 关闭主动征询:`humanConfirm: false`(顶层),或传 `approval` 时用 `approval.humanConfirmTool: false`。
> - **被动确认仍需声明**(业务相关,无法自动推断):`approval: { tools: [...] }` 指定写操作白名单;不传则无被动拦截。
> - 主动征询的「何时该调」由 `usageHints` 中间件自动注入默认提示词,无需自己写 prompt。

> **与 verify 区别**:approval = 执行**前**人工把关(防误改);verify = 返回**后**自动自纠(防错答)。二者可叠加。
> - `nested-demo`(`/examples/nested-demo/`):综合演示嵌套树编辑 + 写操作被动确认 + checkpoint。
> - `human-confirm-demo`(`/examples/human-confirm-demo/`):聚焦 AI 主动征询——开放性需求 → 弹可点选方案按钮 → 用户选定 → 落地写操作再弹一次被动确认,两层 human-in-the-loop 一次看清。

### 6.12 Checkpoint 会话级回滚(回到上次正常时)

流程异常、AI 改坏页面、或走偏时,一键回退到上一个正常状态。默认关闭,传 `checkpoint` 选项开启。

```ts
const sdk = createChatSdk({
  // ... 其他配置
  checkpoint: true,            // 或 { maxCheckpoints: 5, auto: true }
  data: { schema, bind, description? },  // checkpoint 整体快照主数据
})
sdk.mount()

// 一键回退(对话历史 + 主数据 + vfs + todos 整体还原)
sdk.restoreLastCheckpoint()
sdk.listCheckpoints()  // 查看可用回退点
```

**自动存档**(`auto` 默认 true):每轮 agent 行动前(beforeModel 首次)自动存一个 checkpoint = 上一正常态 + 本轮 user 消息。回滚后**保留 user 消息、撤销 agent 本轮改动**,可直接重试本轮。

**快照内容**(整体,区别于 dataOps 的快照):对话历史 + 主数据 + vfs + todos。仅存内存(会话级,非持久化);FIFO 限长(默认 5)。

**三个回滚入口**:
- **UI**:ChatDialog error-bar「↩ 回退」按钮 + footer 常驻回退按钮(`canUndo` 时显示)——用户一键回退
- **LLM 工具**:`restore_last_checkpoint`(流程异常/改坏页面时 AI 自纠回退)、`list_checkpoints`
- **SDK API**:`sdk.restoreLastCheckpoint()` / `sdk.listCheckpoints()`(headless 自建 UI 用)

**就地还原**:主数据就地清空+重填(保留 Vue reactive 容器引用,UI 自动更新);messages 用 splice 替换内容(保留同一响应式数组引用);vfs 清空重填;todos reset。

> **与 dataOps 快照区别**:dataOps 快照(`restore_data`)随 set/edit/delete 自动入栈,单次回退最近一次写;checkpoint 整体,回滚到某轮起点(跨多次写 + 对话 + vfs + todos)。二者叠加:小错用 dataOps 精细修,大错用 checkpoint 整体回。`nested-demo` 已开启 `checkpoint: true`。

### 6.14 无人值守自动化(资源预算 / 错误恢复 / 批处理 / 断点续跑,2.20+)

无人值守批量 / 长任务场景(后台生成一批页面、定时任务、长流程),需:预算控制(防烧 token/时间)、错误自动恢复(单点错误不永久中断)、批处理、断点续跑(刷新/崩溃后恢复)。opt-in(最远能力,默认关)。

```ts
const sdk = createChatSdk({
  capabilities: { automation: true },  // opt-in,默认关
  tokenBudget: 100000,      // 累计 token 上限(超 → 停止 + emit BUDGET_EXCEEDED)
  roundTokenBudget: 50000,  // (可选)单次调用 token 上限,3.11+;无需 automation 能力,超限友好收口
  timeBudgetMs: 600000,     // 时间上限 ms(10 分钟;超 → 停止)
  maxAutoRetries: 2,        // 致命错误自动恢复次数(restore_last_checkpoint + 重试;默认 1)
  checkpoint: true,         // 配合断点续跑(每轮存档 + 持久化 checkpoint 栈/usage)
  storage: 'indexed',       // 断点续跑需持久化(刷新后恢复)
  id: 'my-automation',      // 稳定 id(刷新后同 id 恢复同一会话)
})

// 批处理:逐任务跑,每任务前 checkpoint,失败隔离(不中断整批)
const results = await sdk.batch(['生成专题A', '生成专题B', '生成专题C'])
// → [{ task, reply, ok:true }, { task, error, ok:false }, { task, reply, ok:true }]
```

- **资源预算**(`tokenBudget`/`timeBudgetMs`):每轮 model 调用前检查累计;超限 → agent 停止 + emit `BUDGET_EXCEEDED`(observable,不中断 emit 链),未完成部分可 `restoreLastCheckpoint` 回退。`roundTokenBudget`(3.11+)为单次调用口径的补充,不需 automation 能力。
- **错误恢复**(`maxAutoRetries`):invoke 致命错误 → `restore_last_checkpoint` 回本轮前 + 重试(限次防循环)+ emit `AUTO_RECOVER_RETRY`(observable);重试耗尽 → fatal(emit + throw)。适合单点模型/工具错误不永久中断批量。
- **批处理**(`sdk.batch(tasks)`):逐任务 invoke,每任务前 `checkpoint.save`;失败任务 `messages` splice truncate(撤销本轮 user + 中间 push,防失败 user 残留致下一任务上下文错乱)+ `ok:false` 不中断整批 + emit `BATCH_TASK_FAILED`。
- **断点续跑**:刷新/崩溃后,新 sdk 同 `id` + `storage` → mount 恢复(checkpoint 栈 + 累计 usage 从 store 恢复)→ `listCheckpoints` 有值 + `restoreLastCheckpoint` 可用 + 预算统计连续。需 `capabilities.automation` + `checkpoint` + `storage` 三者配合。

> 适用:批量生成(一次生成 N 个专题页)、定时任务(夜间跑)、长流程(几百 K JSON 分步构建)。headless(`ui:false`)+ `storage` + `automation` 组合实现浏览器内后台自动化(不跨环境到 Node)。

### 6.10 MCP(外部工具接入)

连远程 MCP server,动态把其 tools 注入 agent(标准化扩展工具生态):

```ts
createChatSdk({
  mcp: [
    { transport: 'http', url: 'https://mcp.example.com/mcp' },  // StreamableHTTP(推荐,fetch)
    { transport: 'websocket', url: 'wss://mcp.example.com/ws' },
    // { transport: 'sse', url: '...' },  // 需 eventsource(旧式)
  ],
})
```

- **浏览器仅远程 transport**:`http`(fetch)/ `websocket`(原生 WebSocket)/ `sse`(eventsource);不支持 `stdio`(无 node)。
- **动态加载**:仅配了 `mcp` 才加载 `@modelcontextprotocol/sdk`(optional peerDep;ESM/UMD 集成方按需装,IIFE 已打进)。
- **故障隔离**:单 server 连接失败跳过 + `console.warn`,不影响主 agent 与其他 server。
- **工具名保留字保护**:MCP 工具与内置/用户工具重名(如 `write`/`read`)时**拒绝注入**该工具 + `console.warn` 留痕(防被入侵 server 静默替换内置工具);同名不冲突的其余工具照常注入。
- MCP 工具自动出现在 `agent.inspect()` 与 DebugDrawer「Agent 信息」tab。

### 6.9 onEvent 事件回调(订阅常用时机)

`createChatSdk({ onEvent })` 提供一个轻量事件回调,订阅 Agent 运行中的常用时机,用于**外部联动**(宿主页面响应式刷新、埋点、日志、自建 UI 同步),替代轮询。UI 与 headless 模式均生效。

**事件类型**(`SdkEvent`):

| 事件 | 时机 | 字段 |
|---|---|---|
| `data_change` | Agent 调写工具后(`write` 高层入口,或底层 `set`/`edit`/`delete`/`restore_data`) | `operation`(`set`/`edit`/`delete`/`restore`,`write` 按 args 推断) / `value`(改后值,即整个 bind) |
| `message_update` | 每轮 Agent 结束 | `count`(消息数) |
| `tool_call` | 工具调用前(stream 模式) | `name` / `args` |
| `tool_result` | 工具返回后(stream 模式) | `name` / `result` / `status` |
| `text` / `reasoning` | 流式文本/思考增量(stream 模式) | `delta` |
| `round_start` | 每轮模型调用开始 | `round` |
| `subagent` | 子 agent 进度(工具调用 + 思考过程) | `taskId`/`label`/`kind`(`tool_call`/`tool_result`/`reasoning`)/`name`/`delta`(reasoning 增量)/... |
| `done` | 一轮回复完成(stream 模式) | `content` |
| `usage` | 每轮 LLM 调用后(若 provider 返回 usage) | `round` / `usage`(本轮 prompt/completion/total_tokens) / `cumulative`(累计) |
| `session_restored` | storage 恢复会话快照后(mount 自动恢复 / `switchSession` 切到已存会话) | `sessionId` / `rounds`(恢复的消息数) |
| `error` | 模型调用/工具抛错 | `message` |

> ⚠️ `approval_request` 不外发(UI 已处理,避免集成方误调 `resolve` 双重收口)。
> ⚠️ `tool_call`/`tool_result`/`text`/`done` 等流式事件仅在 **stream 模式**触发(UI 默认走 stream;命令式 `sdk.send` 走 invoke 无流式事件,但 `data_change`/`message_update`/`error` 仍会发)。

**示例**(宿主页面响应式刷新,替代 `setInterval` 轮询):

```ts
createChatSdk({
  /* ... */
  onEvent(event) {
    if (event.type === 'data_change') {
      // Agent 改了主数据 → 实时刷新你的 UI 镜像
      renderState()
    } else if (event.type === 'tool_call') {
      analytics.track('agent_tool_call', { name: event.name })
    } else if (event.type === 'error') {
      console.error('agent error', event.message)
    }
  },
}).mount()
```

> 更深度的拦截/增强(改 messages、包裹模型调用、贡献工具)用**自定义中间件**(见下节);`onEvent` 适合只读观察。

**`sdk.hook(handler)` —— 运行时动态订阅(可多个监听器、可取消)**

除构造时 `onEvent`,实例还提供 `hook` 方法,运行时随时订阅,可注册多个监听器,返回取消函数:

```ts
const sdk = createChatSdk({ /* 不必传 onEvent */ }).mount()

// 订阅 1:宿主页面响应式刷新
const off1 = sdk.hook((event) => {
  if (event.type === 'data_change') renderUI()
})

// 订阅 2:埋点(与订阅 1 共存,互不影响)
const off2 = sdk.hook((event) => {
  if (event.type === 'tool_call') analytics.track('tool', { name: event.name })
})

// 取消订阅
off1()
off2()
```

`onEvent` 与 `hook` 互补:前者构造时单回调,后者运行时多监听器;两者可并存。事件类型与过滤规则同上(`approval_request` 不外发;流式事件仅 stream 模式)。

### 6.10 便捷 API(导出/导入/用量/审计)

除事件订阅外,SDK 实例还提供几个便捷 API,覆盖备份迁移、用量统计、审计追溯:

| API | 作用 | 备注 |
|---|---|---|
| `sdk.exportData()` | 返回主数据 `bind` 的**深拷贝**(JSON 序列化) | 备份/迁移用;改返回值不影响原 bind;dataOps 关闭或无 data 返回 `null` |
| `sdk.importData(json, opts?)` | 整体替换 `bind`(就地还原,保留 reactive 引用) | 默认经 `schema` 校验,不合法返回 `{ok:false,error}`;`opts.validate:false` 跳过校验;`opts.emit:false` 不发 `data_change` |
| `sdk.setSkills(skills)` | 运行时替换整个 skill 列表(同名覆盖) | 立即生效:下轮 system prompt 索引重渲染;清 skill 全文缓存与本轮已加载记录,下次 `load_skill` 取最新全文(含 vfs doc);需开启 skills(默认开) |
| `sdk.invalidateSkillCache(name?)` | 清 skill 全文缓存(主动失效) | 不传 `name` 清全部,传 `name` 清指定;动态 skill 内容变化时用;下次 `load_skill` 重新 `getContent`/`readSkillDoc`;需开启 skills(默认开) |
| `sdk.addSkill(skill)` | 用户创建 skill(运行时 + 独立持久化) | `skill: { name, description, prompt \| getContent \| doc }`;自动加入 agent,持久化由**独立 SkillStore**管理(默认 indexedDB,与 `storage` 分离,即使 `storage:false` 也持久化,跨刷新恢复);同名覆盖;需开启 skills(默认开)+ `skillStorage` 非 `false` 才持久化 |
| `sdk.removeSkill(name)` | 删除用户创建的 skill | 仅删用户创建的(`addSkill` 加的),不删集成方 `skills` 选项传入的;从 SkillStore 移除;返回 `boolean`(是否删除成功);需开启 skills |
| `sdk.listUserSkills()` | 列出用户创建的 skill 名 | 返回 `string[]`(仅用户创建的,不含 initialSkills);UI 面板刷新用 |
| `sdk.getUserSkill(name)` | 读取用户创建的 skill 详情 | 返回 `{ name, description, content }` 或 `undefined`(不存在时);SkillPanel 编辑时调 |
| `skillStorage` 选项 | 用户 skill 独立持久化配置 | 默认 `{ backend: 'indexed' }`(与 `storage` 分离);`false` 关闭(仅当前会话);`id` 手动指定同一 id → 跨页面/跨 agent 复用同一套用户 skill;不传 `id` 默认按 `agent::{agentId}` 隔离 |
| `SkillPanel` 组件 | 用户创建/编辑/删除 skill 的 UI 面板 | 内置 `ChatDialog` 头部「Skill 管理」按钮已集成(支持创建/编辑/删除);集成方也可 `import { SkillPanel } from 'page-agent-sdk'` 单独用于自建 UI |
| `sdk.usage` | 累计 token 用量 `{prompt_tokens, completion_tokens, total_tokens, reasoning_tokens?}` | 每轮 LLM 调用累加;无调用时全 0;单轮明细经 `onEvent('usage')` 外发。`reasoning_tokens` 为推理/思考 token(思考型模型默认 deep 后成本可见化):**completion 的子集**单独累计不加数,DebugDrawer 每轮日志显示占 completion 百分比;OpenAI 兼容端点(DeepSeek 等)回报才携带,Anthropic 协议当前依赖栈不暴露该细分则字段省略 |
| `onAudit(entry)` 选项 | 数据写操作结构化审计回调(独立于 `debug`) | 每次 `set`/`edit`/`delete`/`restore` 经此回调外发 `{op, jsonPath, opDetail, timestamp, success, error?}`;合规审计/操作追溯 |

```ts
// 备份 + 恢复
const backup = sdk.exportData()
localStorage.setItem('backup', JSON.stringify(backup))
// ...出问题后恢复
sdk.importData(JSON.parse(localStorage.getItem('backup')))

// 用量统计
onEvent(e => { if (e.type === 'usage') costMeter.add(e.usage) })
console.log(sdk.usage)  // 累计

// 审计
createChatSdk({
  onAudit: (entry) => auditLog.append(entry),  // 无需 debug:true
  // ...
})
```

### 6.11 运行时动态重配置(tools / llm / memory / subagents)

除 `setData`/`setSkills` 外,SDK 还支持运行时动态重配置 **工具 / LLM / memory / 预声明子 agent**,全程零破坏(不调用 = 现状行为),无需重建 agent(保留对话历史与中间件状态)。所有 setter 触发 `infoTick++` → DebugDrawer 实时刷新;`inspect()` 的 tools/model/memory/subagent.subagents 动态取最新。

| API | 作用 | 备注 |
|---|---|---|
| `sdk.setTools(tools)` | 运行时替换**用户工具**集 | 内置工具(由 `capabilities` 控制)不动;内部 `rebindTools` 重新绑定到 LLM,下一轮即生效;支持按权限/业务阶段/A-B 实验动态切换工具组 |
| `sdk.addTool(tool)` | 运行时追加用户工具 | 去重 by name;内置不动 |
| `sdk.removeTool(name)` | 运行时移除用户工具 | 内置不动;返回是否移除成功 |
| `sdk.setLlm(llm)` | 运行时切换 LLM | 参数 `BaseChatModel` 或 `LLMConfig`(内部构造 `ChatOpenAI`);rebind + 重解析模型能力(`contextWindow`/`maxOutputTokens`);`summaryLlm` 不受影响;新模型不支持 `bindTools` 则工具调用失效(agent 不崩) |
| `sdk.setMemory(source)` | 运行时更新持久指令 memory | 支持 `string` 与同步/异步函数;异步函数后台求值,下一轮 `augmentPrompt` 注入最新;`setMemory('')` 清空(空串跳过注入) |
| `sdk.refreshMemory()` | 重新求值当前 memory 函数 source | RAG 文档更新后强制刷新;返回最新文本;字符串 source 直接返回当前值 |
| `sdk.setSubagents(configs)` | 运行时替换预声明子 agent | 重新生成 `use_<id>` 委派工具 + 触发 rebind;需创建时配 `subagents:[]`(空数组也启用 controller,支持「初始无子 agent,运行时动态 add」) |
| `sdk.addSubagent(config)` | 运行时追加预声明子 agent | id 重复 warn 跳过;需创建时配 `subagents:[]` |
| `sdk.removeSubagent(id)` | 运行时移除预声明子 agent | 返回是否移除成功;需创建时配 `subagents:[]` |

```ts
// 场景 1:按业务阶段切换工具组(浏览期只读 / 编辑期可写)
sdk.setTools([readOnlyTool1, readOnlyTool2])
// ...用户点「编辑」按钮
sdk.setTools([writeTool1, writeTool2, readOnlyTool1])

// 场景 2:配额耗尽切便宜模型 / 复杂任务切强模型
sdk.setLlm({ apiKey, baseUrl, model: 'gpt-4o-mini' })  // 省钱
sdk.setLlm({ apiKey, baseUrl, model: 'gpt-4o' })      // 复杂任务

// 场景 3:运行时追加业务约束到 memory
sdk.setMemory('当前用户是 VIP,优先展示会员价;回答简洁。')

// 场景 3.5:异步加载 RAG 文档到 memory(支持 string 与同步/异步函数 source)
// - 创建时直接传异步函数:后台预求值,首次对话前尽量就绪
createChatSdk({
  memory: async () => await fetch('/kb/faq.md').then((r) => r.text()),
  /* ... */
})
// - 运行时切换为异步函数(如用户切换了知识库)
sdk.setMemory(async () => await fetch('/kb/product-v2.md').then((r) => r.text()))
// - 文档更新后强制刷新(重新求值当前函数 source)
await sdk.refreshMemory()
// - 也可以传同步函数读运行时变量
let lang = 'zh'
sdk.setMemory(() => `请用${lang}回答。`)
lang = 'en' // 变量变了,需 refreshMemory() 才重求值(函数 source 默认缓存首次结果)

// 场景 4:运行时根据任务类型动态委派子 agent
// (创建时配 subagents:[] 占位启用 controller)
sdk.addSubagent({ id: 'translator', description: '中英互译子 agent', systemPrompt: '你是翻译助手。' })
// ...任务结束移除
sdk.removeSubagent('translator')
```

> **说明**:`setSystemPrompt` / `setMiddleware`(中间件数组运行时替换)仍未实现,改动深入 harness 核心,留待后续;当前可用 `setData`/`setSkills`/`augmentSystem` 钩子覆盖大部分动态 system prompt 场景。详见 `doc/archive/roadmap.md` #5。

### 6.12 LLM 连接:直连 / 代理 / OpenAI 兼容端点

SDK 兼容任意 OpenAI Chat Completions 协议端点。三种连接方式按「apiKey 是否暴露到浏览器」选:

#### 方式一:直连(浏览器持有 apiKey)

适合内部工具 / 开发期 / apiKey 可暴露的场景。`LLMConfig.baseUrl` 指向任意 OpenAI 兼容端点:

```ts
import { createChatSdk } from 'page-agent-sdk'

createChatSdk({
  llm: {
    apiKey: 'sk-xxx',
    baseUrl: 'https://api.deepseek.com/v1',  // deepseek / qwen / glm / 文心 等 OpenAI 兼容端点
    model: 'deepseek-v4-pro',
    temperature: 0.3,
    // 2.12.2+:透传额外请求 body 参数(如 deepseek thinking)
    extraBody: { thinking: { type: 'enabled' } },
    // 透传 configuration 额外字段(如 headers/timeout/customFetch),与 baseUrl 合并
    extraConfig: { timeout: 60000 },
  },
  // ...其他配置
}).mount()
```

> **主流国产模型 OpenAI 兼容端点**:
> - DeepSeek:`https://api.deepseek.com/v1`
> - 通义千问:`https://dashscope.aliyuncs.com/compatible-mode/v1`
> - 智谱 GLM:`https://open.bigmodel.cn/api/paas/v4`
> - 文心一言:`https://qianfan.baidubce.com/v2`

#### 方式一·补充:Anthropic Claude(provider 开箱,2.28+)

除 OpenAI 协议外,SDK 开箱支持 Anthropic Claude 原生协议(`provider:'anthropic'` 动态加载 `@langchain/anthropic`,不用不强求装):

```ts
createChatSdk({
  llm: {
    provider: 'anthropic',          // 走 Claude 原生协议(缺省 'openai' = OpenAI/DeepSeek 协议,向后兼容)
    apiKey: 'sk-ant-xxx',
    model: 'claude-sonnet-4-5-20250929',
    baseUrl: 'https://api.anthropic.com',  // 可选,默认官方;自建网关填此处
    cacheControl: true,             // prompt caching(可选):true=ephemeral 5m / '1h'=长 TTL,见下方说明
  },
}).mount()
```

> - **prompt caching(`cacheControl`,Anthropic 协议专属)**:ReAct 多轮每轮重发完整前缀(system+工具定义+历史),`cacheControl: true` 经 langchain `invocationKwargs` 透传顶层 `cache_control`,服务端自动打断点并随对话推进 —— 前缀命中缓存,input 价格降至 **~1/10**(写 1.25x,5m/1h TTL)。效果观测:usage 事件/`sdk.usage` 的 `cache_read_input_tokens`/`cache_creation_input_tokens`(端点回报才携带);真 LLM 回归 `npm run test:real rag` 的基线 diff 可见 prompt ▼。**端点支持差异(实测 2026-08)**:modelverse 网关**非流式**命中(实测 2787 token 前缀第二轮 2048 走缓存)、**流式不生效**(SDK 恒流式 → 该网关暂无收益,配置无害保留);官方 api.anthropic.com 流式回报缓存字段。OpenAI/DeepSeek 端点自动缓存,不受此开关控制
> - `@langchain/anthropic` 是 **optional peerDep** —— 用 Anthropic 才需装(`npm i @langchain/anthropic`),不用 Anthropic 的项目零影响(动态 import 仅 `provider:'anthropic'` 分支加载)
> - `setLlm` 切 Anthropic 需传 `BaseChatModel` 实例(动态 import 无法同步):`const { ChatAnthropic } = await import('@langchain/anthropic'); sdk.setLlm(new ChatAnthropic({ apiKey, model }))`;传 `LLMConfig + provider:'anthropic'` 会 throw 清晰提示
> - **IIFE(CDN `<script>`)不支持 Anthropic**(浏览器无 importmap 解析 bare specifier);用 Anthropic 走 npm(ESM/UMD)。CDN 全量包不打包 `@langchain/anthropic`(默认 OpenAI/DeepSeek)
> - 代理模式 `createProxyLlm` 保持 OpenAI-only(注入 Bearer 是 OpenAI 协议);Anthropic 走主 `llm` 直连或预构造 `ChatAnthropic` 实例传入

#### 方式二:代理模式(防 apiKey 泄露)

适合公开网站 —— 浏览器只持有用户 token,真实 apiKey 留在服务端代理。用 `createProxyLlm`:

```ts
import { createChatSdk, createProxyLlm } from 'page-agent-sdk'

createChatSdk({
  llm: createProxyLlm({
    mode: 'proxy',           // 代理模式:浏览器 → 你的代理 → LLM 服务
    proxyUrl: '/api/llm-proxy',  // 你的后端代理地址
    userToken: getUserToken(),   // 用户登录态(由你的后端校验),非 apiKey
    // 代理后端负责:校验 userToken → 注入真实 apiKey → 转发到 LLM → 返回 OpenAI 格式
  }),
  // ...其他配置
}).mount()
```

#### 方式三:直连模式(代理 + 浏览器持有 apiKey)

`createProxyLlm` 的 `direct` 模式 —— 走代理但 apiKey 在浏览器(适合代理只做转发/审计,不持有 key):

```ts
createChatSdk({
  llm: createProxyLlm({
    mode: 'direct',
    proxyUrl: '/api/llm-direct',
    apiKey: 'sk-xxx',
    model: 'deepseek-v4-pro',
  }),
}).mount()
```

#### 三种方式对比

| 方式 | apiKey 位置 | 适用场景 | 安全性 |
|---|---|---|---|
| 直连(`LLMConfig`) | 浏览器 | 内部工具 / 开发期 | 低(key 暴露) |
| 代理 `proxy` 模式 | 服务端 | 公开网站 | 高(浏览器只有 userToken) |
| 代理 `direct` 模式 | 浏览器 | 代理只做转发/审计 | 中(key 暴露但走代理) |

> **代理后端要求**:只需返回 OpenAI Chat Completions 兼容格式(`{ choices: [{ message: { role, content } }] }`),SDK 即可对接。详见 `examples/proxy-demo/`(需 `npm run proxy:mock` 起本地 mock 代理)。

#### 运行时切换 LLM

配合 §6.11 动态重配置,运行时切换 LLM(含 `extraBody`/`extraConfig`):

```ts
// 配额耗尽切便宜模型 + 开启 thinking
sdk.setLlm({
  apiKey, baseUrl, model: 'deepseek-v4-pro',
  extraBody: { thinking: { type: 'enabled' } },
})
```

### 6.14 上下文聚焦 Focus(指定组件精修,focus-context)

多组件页面想精修其中一个(如「导航栏」`components.3`)时,聚焦后 agent 的**目标 / 视野 / 范围三层收敛**到该子树,避免改到别处。会话级焦点 `{ path, label? }`,聚焦是 opt-in(需主动 `setFocus` 才生效,默认不聚焦行为与现状完全一致)。

**SDK API**:

```ts
const res = sdk.setFocus({ path: 'components.3', label: '导航栏' })
// res: { ok: true } 或 { ok: false, error }（path 不在 schema 内时拒绝,不抛错）
sdk.getFocus()   // → { path, label? } | undefined
sdk.clearFocus() // 退出精修,恢复全量可操作范围
```

聚焦后三层收敛:
- **目标提示**:每轮 systemPrompt 注入「## 当前精修目标:components.3(导航栏)。仅操作该子树」;**意图归属引导(4.1+)**:「增加/修改/删除 X」类创建型指令默认归属聚焦组件本身(如聚焦 tabs 时说「增加 tab」= 给它加页签,写 `components.8.props.tabs` 子路径),仅用户明确要求新建独立组件才需解焦 —— 实测 flash 曾把「增加tab」误读为新建组件追加页尾,故机制化引导
- **视野收敛**:只看到该组件子树的 schema 描述(`getSchemaAtPath` 取子树,`extractSchemaHint` 渲染),不看其他组件
- **范围收紧(strict)**:写该子树之外(如 `components.0`)→ `PATH_DENIED` 越界错误回灌,agent 自纠;**文案先给「正路」出口(4.1+)**:被拦时优先提示「若意图是修改聚焦组件本身,改写焦点路径的子路径重试(附实际焦点路径示例)」,解焦出口(remove_focus/clear_focus/换焦点)列后 —— 防 agent 照方抓药清焦后把误读执行到底;读工具不限制(用户仍需看全量上下文)。**例外:尾部追加放行** —— 写 `<arrayPath>.<N>`(N ≥ 当前数组长度,即追加新元素)不破坏焦点子树,故聚焦模式下仍可新建组件(如聚焦 hero 时 `write components.2` 追加 banner)

> **× code-as-data-asset 强化(子 agent 代码精修)**:用 `createHtmlSubagent` 时,子 agent 改代码走 `vfs_edit`(非数据写),`focus.ts` 的数据写拦截不覆盖 vfs,故 `codeAssetMiddleware` 在执行前补一道 **vfs 白名单**:子 agent(继承主焦点)只能 `vfs_edit` 焦点组件的代码文件(按 `__pgId` 归属判定),越界 `PATH_DENIED` —— 即使子 agent 误解也改不到别的组件代码。这是「点选组件 → 对话精修」的硬约束基础。焦点为整个数组 / 非代码字段时放行(无法精确到组件)。**聚焦模式下不能新建组件**(数据写被 focus.ts 拦),新建前先 `clearFocus`。完整示例见 `examples/html-page-demo`(预览区点选组件 → 🎯 聚焦 → 对话精修)。

**三种触发方式**:

| 方式 | 机制 |
|---|---|
| **API / 宿主点击拾取** | `sdk.setFocus(path,{label?})` —— 宿主组件点击时调用 |
| **对话驱动** | agent 工具 `set_focus({path,label?})` / `clear_focus`（数据工具恒全暴露,agent 可自主聚焦） |
| **ChatDialog 焦点条** | 内置对话框头部「🎯 正在精修」chip(✕ 退出 · ▾ 编辑路径切换),`capabilities.focus:false` 时不显示 |

**宿主点击拾取接入**(组件渲染绑 `data-path`,点击委托调 setFocus):

```ts
// 1) 组件根元素绑 data-path(以 Vue 为例,渲染时绑索引路径)
//    <div :data-path="`components.${i}`"> ... </div>

// 2) 在组件容器上做点击委托:点中带 data-path 的元素 → 聚焦它
containerEl.addEventListener('click', (e) => {
  const target = (e.target as HTMLElement).closest('[data-path]')
  const path = target?.getAttribute('data-path')
  if (path) sdk.setFocus({ path })  // 焦点条 chip 出现,后续对话只精修该组件
})
```

完整可运行示例见 `examples/complex-demo`(`PageRenderer.vue` / `CompRenderer.vue` 绑 `data-path` + 点击拾取)。

> **path 校验是「类型合法」非「数据存在」**:`setFocus` 用 `getSchemaAtPath` 校验路径的 schema 形状。数组索引 `components.5` 类型合法即可聚焦(即使数据不足 6 个);叶子字段下取子路径(如 `title.sub`)或顶层不存在字段(如 `nope`)被拒。**开放 schema**(`z.record(...)` / `z.any()` / `z.unknown()` 子树)任意路径均可聚焦(如编辑器页面树 `z.record(z.string(), z.unknown())` 绑整个组件树,点选任一组件即 `setFocus` 其路径)。`capabilities.focus` 默认开,`false` 关闭(中间件 + 工具 + chip 都不装)。

## 8. 高级:自定义中间件

最彻底的外接方式 —— 把你的逻辑插到 Agent 生命周期的任意节点,和内置的 todos/skills/memory 平起平坐。

**8 个钩子**:

| 钩子 | 时机 | 典型用途 |
|---|---|---|
| `beforeAgent(state)` | Agent 启动 | 初始化状态 |
| `beforeModel(req)` | 每轮模型调用前 | 更新 state |
| `augmentPrompt(state)` | 每轮渲染 system prompt | **增强提示词**(返回追加段) |
| `compressInput(msgs)` | 构建上下文前 | 压缩历史 |
| `wrapModelCall(req, next)` | 包裹模型调用 | **拦截/改写请求与响应** |
| `afterModel(res, state)` | 模型返回后 | 观察/埋点 |
| `wrapToolCall(ctx, next)` | 包裹工具执行 | **审计/拦截/改写工具** |
| `tools` | (字段,非钩子) | 贡献自定义工具 |

> 执行顺序:before 类正序、after 类逆序、wrap 类洋葱。用户中间件在内置之后注入。

**例子 1:埋点/审计**(最常用)

```ts
import { createChatSdk, type Middleware } from 'page-agent-sdk'

const analytics: Middleware = {
  name: 'analytics',
  afterModel: (res) => {
    console.log('[埋点] 模型响应', { len: res.content.length, tools: res.toolCalls.length })
  },
  wrapToolCall: async (ctx, next) => {
    const t = Date.now()
    const result = await next(ctx)
    console.log('[埋点] 工具', ctx.name, `${Date.now() - t}ms`, result.status)
    return result
  },
  afterAgent: () => console.log('[埋点] 对话结束'),
}

createChatSdk({ /* ... */ middleware: [analytics] })
```

**例子 2:Prompt 增强**(注入运行时上下文)

```ts
const injectCtx: Middleware = {
  name: 'inject-ctx',
  augmentPrompt: () => `当前时间:${new Date().toLocaleString('zh-CN')}\n域名:${location.hostname}`,
}
```

**例子 3:拦截写操作**

```ts
const guard: Middleware = {
  name: 'guard',
  wrapToolCall: async (ctx, next) => {
    if (ctx.name === 'write' && ctx.args.path === 'app.critical') {
      return { content: '该字段禁止 Agent 修改', status: 'error' }  // 不调 next = 拦截
    }
    return next(ctx)
  },
}
```

> `page-demo/App.vue` 里有一个可直接运行(`npm run dev`)的埋点示例中间件。

## 8. 命令式 API

`createChatSdk()` 返回一个 `ChatSdk` 实例:

```ts
const agent = createChatSdk({ /* ... */ })

await agent.mount()                          // 渲染对话框(异步:含持久化恢复)
await agent.send('把标题改成 Hello')          // 命令式发送,返回 AI 回复
const newId = await agent.switchSession()    // 切换/新建会话(storage 未开启时抛错)
const reply = await agent.stream(msgs, cb)   // 底层流式(高级:自行管理历史)
agent.unmount()                              // 卸载

// 乐观锁冲突人工介入(内置 UI 自动处理;headless 自建 UI 时用)
agent.pendingConflict                        // 响应式 ref<PendingConflict|null>,有冲突时非 null
agent.resolveConflict('keep_external')       // 收口挂起的冲突:'keep_external'|'overwrite'|'restore'
agent.hook((e) => { if (e.type === 'conflict') { /* e.conflict 含冲突详情 */ } })
```

`send()` 与 UI 对话框共享同一份消息历史(唯一来源),命令式和 UI 可混用。

**headless 模式**(自建 UI):`ui: false` 不渲染内置对话框,`agent.messages` 暴露**响应式消息数组**,集成方自行渲染 + 用 `send`/`stream` 驱动。适合 React/原生/自定义 UI。
```ts
const agent = createChatSdk({ llm, ui: false, id, storage })
await agent.mount()
agent.messages                // 响应式数组,自建 UI 据此渲染
await agent.send('...')       // 发送(数组自动更新)
agent.unmount()
```

**复用内置 UI 模块**:headless 模式下也可 `import { ChatDialog, useChat }` 复用内置对话框组件与流式/重试/停止/重新生成逻辑(`ChatDialog` 接 `fetchStream`/`getInfo` 等 props),而不必从零实现 UI。

**主题定制**:`ChatDialog`/`DebugDrawer` 暴露 CSS 变量(`--cs-primary` 等,默认中性主题)与 props(`showAvatar`/`showTyping` 关头像/打字动画)。覆盖变量即可换主题:
```css
.pa-chat { --cs-primary: #0ea5e9; }  /* 改主色(类名按实际容器) */
```

**预设**(常见场景一键装载):
```ts
import { createChatSdk, presets } from 'page-agent-sdk'
createChatSdk({ ...presets.pageBuilder, container: '#root', llm, data })  // 页面构建助手
createChatSdk({ ...presets.researcher, container, llm })                         // 并行调研
createChatSdk({ ...presets.minimal, container, llm, data })               // 极简(关高级能力)
```
可用预设:`pageBuilder`(3.9+ 仅场景化身份 prompt;HTML 代码子 agent 由 createChatSdk 装配期自动装配(schema 含 code 数组即装),preset 不再自带 subagents)、`researcher`(spawn_agents 并行调研)、`minimal`(关闭所有高级能力,省 token)。

### 8.5 服务端(Node.js)用法

SDK 核心是**框架无关的 JS**,可在 Node.js 服务端跑(headless 模式),用作后端 Agent(自定义工具编排、文档抓取、子 agent 并行、自检自纠)。

**服务端配置要点**:
- `ui: false` —— headless,不渲染 ChatDialog(服务端无 DOM)
- `capabilities: { dataOps: false, fetch: false }` —— 关浏览器依赖工具(dataOps 需 `window` 对象;`fetch_document` 需 `fetch`,Node 18+ 有全局 fetch,可保留)
- `storage: 'memory'` —— 用内存后端(服务端无 IndexedDB/localStorage);不传则纯内存不持久化
- 用 `tools` 注入你的业务工具(`defineTool`),`send`/`stream` 命令式驱动

**示例**(Node.js 后端 Agent + 自定义工具):

```ts
import { createChatSdk, defineTool, z } from 'page-agent-sdk'

const add = defineTool({
  name: 'add', description: '两数相加',
  schema: z.object({ a: z.number(), b: z.number() }),
  handler: (args) => `${args.a + args.b}`,
})

const sdk = createChatSdk({
  container: null, ui: false, id: 'server-agent',
  storage: 'memory',
  llm: { apiKey: process.env.AI_API_KEY, baseUrl: '...', model: '...' },
  systemPrompt: '你是计算助手,用 add 工具做加法。',
  capabilities: { dataOps: false, fetch: false },
  tools: [add],
})
await sdk.mount()
const reply = await sdk.send('3 加 5 等于多少?')
console.log(reply) // AI 调 add 工具 → "3 + 5 = 8"
```

**服务端可用能力**:自定义工具 / `fetch_document`(Node 18+)/ 子 agent / verify 自检 / vfs 工作区 / context 压缩 / memory / onEvent 事件回调 / dataOps 主体(`read`/`write`/`get`/`edit`/`delete`/`query`/`search`,传任意 `data.bind` 对象即可,不依赖 `window`)
**服务端不可用**:ChatDialog UI(需 DOM)/ `eval_script`(依赖 Web Worker)/ IndexedDB·localStorage·sessionStorage 持久化(用 `memory` 替代)

> 注:`eval_script` 依赖 Web Worker,属 dataOps,关掉即不装。MCP 远程工具(http/sse/websocket)在 Node 也可用(动态 import `@modelcontextprotocol/sdk`)。

### 8.6 代理连接(防 apiKey 泄露)

浏览器直连 LLM API 会把 `apiKey` 暴露在前端代码/网络请求中,上线后任何人都能从 DevTools 抓走你的 key 盗刷。**生产环境必须经服务端代理**:浏览器只持用户 token,你的服务端注入真实 `apiKey` 转发到 LLM API。

SDK 提供 `createProxyLlm` 工厂统一管理两种接入模式,dev/prod 切换不改代码结构:

```ts
import { createChatSdk, createProxyLlm } from 'page-agent-sdk'

// ===== 上线:代理模式(防泄露)=====
// 浏览器只持 userToken,服务端注入真实 apiKey 转发
const sdk = createChatSdk({
  container: '#agent',
  llm: createProxyLlm({
    mode: 'proxy',
    baseUrl: '/api/llm',        // 你的代理地址(同源避免 CORS)
    userToken: getUserToken(),   // 用户登录态 token(代理验证后换真实 key)
    model: 'deepseek-chat',
    temperature: 0.3,
    // 可选:token 过期自动刷新(401 时调一次,返回新 token 重试)
    refreshToken: async () => (await fetch('/api/refresh')).json().then(r => r.token),
    // 可选:附加 headers(如租户标识)
    headers: { 'X-Tenant': 'acme' },
  }),
  // ...其余配置
})

// ===== 开发:直连模式(便捷)=====
// 浏览器持真实 apiKey,仅本地开发用(生产会泄露)
const sdkDev = createChatSdk({
  container: '#agent',
  llm: createProxyLlm({
    mode: 'direct',
    apiKey: 'sk-xxx',            // 真实 key(仅开发环境)
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  }),
  // ...其余配置
})
```

**两种模式对比**:

| | `proxy`(代理,上线) | `direct`(直连,开发) |
|---|---|---|
| apiKey 位置 | 服务端(浏览器不可见) | 浏览器(DevTools 可见) |
| 浏览器持有 | userToken(登录态) | 真实 apiKey |
| token 刷新 | 支持(401 自动重试) | 不需要 |
| 自定义 headers | 支持 | 不需要 |
| 适用场景 | 生产环境 | 本地开发/内网工具 |

**代理服务端实现要点**(你的后端,SDK 不管):
- 接收浏览器请求,验证 userToken,注入真实 `apiKey`,转发到 LLM API
- 处理 CORS(同源最省事,或设 `Access-Control-Allow-*`)
- 透传 SSE 流式响应(流式生成不能缓冲)
- 透传 tool calling 字段(`tools`/`tool_choice`/`tool_calls`)
- 可选:用量统计、限流、按用户配额

> `summaryLlm`(摘要专用模型)若也要走代理,同样用 `createProxyLlm({ mode:'proxy', ... })` 构造后传入 `summaryLlm` 选项。

#### 8.6.1 支持的接口格式

`createProxyLlm` 内部用 `ChatOpenAI`,所以**两种模式都要求接口是 OpenAI Chat Completions 兼容格式**。区别只在 apiKey 放哪里,不在协议格式。

**请求**(浏览器 → 代理):

```
POST {baseUrl}/chat/completions
Authorization: Bearer {userToken}      ← proxy 模式传用户 token
Authorization: Bearer sk-xxx           ← direct 模式传真实 key
Content-Type: application/json

{
  "model": "deepseek-chat",
  "messages": [{ "role": "system", "content": "..." }, ...],
  "tools": [...],          // tool calling 字段(可选)
  "tool_choice": "auto",
  "temperature": 0.3,
  "max_tokens": 16384,
  "stream": true           // 流式时为 SSE
}
```

> `ChatOpenAI` 自动在 `baseUrl` 后拼接 `/chat/completions`,所以 `baseUrl` 传 `/api/llm` 即可,实际请求打到 `/api/llm/chat/completions`。

**响应**(代理 → 浏览器),需返回 OpenAI 兼容格式:

非流式:
```json
{
  "id": "chatcmpl-xxx",
  "choices": [{ "message": { "role": "assistant", "content": "...", "tool_calls": [...] }, "finish_reason": "stop" }],
  "usage": { "prompt_tokens": 100, "completion_tokens": 50 }
}
```

流式(SSE):
```
data: {"choices":[{"delta":{"content":"你好"}}]}
data: {"choices":[{"delta":{"tool_calls":[...]}}]}
data: [DONE]
```

**401 刷新**(仅 proxy 模式):代理返回 `401` 时,SDK 自动调 `refreshToken` 拿新 token,重试一次原请求。

**不支持的格式**:非 OpenAI 协议(如原生 Claude `/v1/messages`、Gemini `generateContent`)需后端做协议转换,转换后仍以 OpenAI 格式返回给 SDK;自定义 RPC / GraphQL 同理,后端转换成 OpenAI 兼容响应即可。

#### 8.6.2 代理服务端示例(Node.js)

仓库自带 mock 代理 server(`scripts/proxy-mock-server.ts`),`npm run proxy:mock` 启动,监听 `http://localhost:3002`:

- `POST /chat/completions` —— 验证 `Authorization: Bearer {userToken}`,注入真实 apiKey(从服务端 `.env` 读 `VITE_AI_API_KEY`),转发到上游 LLM API(`VITE_AI_BASE_URL`),透传 SSE 流
- `POST /api/refresh` —— token 刷新演示端点,返回新 token
- 演示 token 规则:`demo-token-xxx` 正常 / `demo-token-expired` 返 401 触发刷新

最小可用代理(生产参考,Node.js 原生 `http`):

```ts
import http from 'node:http'

const REAL_API_KEY = process.env.REAL_API_KEY  // 服务端环境变量,浏览器拿不到
const UPSTREAM = 'https://api.deepseek.com/v1'

http.createServer(async (req, res) => {
  // CORS(开发跨域;生产建议同源去掉)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.url !== '/chat/completions' || req.method !== 'POST') {
    res.writeHead(404); res.end('not found'); return
  }

  // 1. 验证用户 token
  const userToken = req.headers.authorization?.slice(7)
  if (!userToken || !await verifyUserToken(userToken)) {
    res.writeHead(401, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'invalid token' } }))
    return
  }

  // 2. 读 body
  const body = await new Promise<Buffer>(r => {
    const c: Buffer[] = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c)))
  })

  // 3. 注入真实 apiKey 转发(透传 tools/tool_calls/stream)
  const upstream = await fetch(`${UPSTREAM}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${REAL_API_KEY}` },
    body,
  })

  // 4. 透传响应(SSE 流式直接 pipe,不缓冲)
  res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') || 'application/json' })
  if (upstream.body) {
    const reader = upstream.body.getReader()
    const dec = new TextDecoder()
    while (true) { const { done, value } = await reader.read(); if (done) break; res.write(dec.decode(value)) }
  }
  res.end()
}).listen(3002, () => console.log('proxy @ 3002'))

async function verifyUserToken(token: string): Promise<boolean> {
  // 接你的鉴权:JWT 校验 / 查 session / 查用户表 …
  return token.startsWith('demo-token-')
}
```

**生产部署要点**:
- 真实 apiKey 只存服务端环境变量(或密钥管理服务),**绝不**下发浏览器、不进 git
- 同源部署(`/api/llm` 与前端同域)省 CORS;跨域需配 `Access-Control-Allow-*`
- 流式响应用 `pipe` 逐块转发,不要 `await res.json()` 缓冲(会破坏流式生成)
- 透传 `tools`/`tool_choice`/`tool_calls` 字段(Agent 的 tool calling 依赖这些)
- 可选:按 userToken 计费用量、限流、按用户配额、审计日志

#### 8.6.3 完整示例页面

仓库 `examples/proxy-demo/` 提供完整可运行示例:

```bash
# 终端 1:启动代理 server(读 .env 的真实 apiKey)
npm run proxy:mock
# → http://localhost:3002,真实 apiKey 在服务端

# 终端 2:启动 dev
npm run dev
# → 访问 http://localhost:3000/examples/proxy-demo/
```

示例页面演示:
- 浏览器只持 `userToken`(`demo-token-xxx`),DevTools 看不到真实 apiKey
- 切换为 `demo-token-expired` → 发消息触发 401 → SDK 自动调 `refreshToken` 刷新重试(界面显示刷新次数)
- 附加 `X-Tenant` header 演示自定义 header 透传

### 6.15 UI 定制与国际化(图标 / 主题 / 语言 / 文案覆盖,3.17+~3.21+)

内置对话框免 fork 全定制,四件套都在 `dialog` 配置组:

```ts
createChatSdk({
  dialog: {
    theme: 'dark',                        // ① 内置主题:'dark'(默认)/'light';亦可祖先覆盖 --cs-* 变量完全自定义
    icons: { header: '🦈', send: '🚀' },   // ② 逐图标覆盖(纯文本 emoji/字符,或 '<' 开头的 HTML 片段——
                                          //    经 DOMPurify 图标白名单净化;空串=隐藏;未传键用默认;
                                          //    顶部按钮四键 newSession/history/more/close 同理,缺省=内置 SVG)
    headerLabels: true,                   // ⑤ 顶部按钮自适应文字标签(默认 true):宽度足够(头部内容区
                                          //    ≥440px,≈对话框 ≥472px)展示「文字+图标」,更窄回退纯图标;
                                          //    false 恒纯图标。文字走 i18n newSession/history/more 键
  },
  i18n: {                                 // ③④ 国际化配置组(顶层,3.22+;原 dialog.locale/messages 合并至此)
    locale: 'en-US',                      // ③ 整语言切换('zh-CN' 缺省):聊天面 + Debug 抽屉 + Skill 面板 +
                                          //    代码预览全量;formatTime(12h/24h)与 autoTitle 跟随;
                                          //    **默认 systemPrompt 切英文版**(含 "Respond in English" 锚,
                                          //    agent 回复语言与 UI 一致;自定义 systemPrompt 不受影响,
                                          //    但自动追加的 reliableWriteRules 段跟随切英文)
    messages: { statusDone: '<b style="color:#10b981">完成</b>' },  // ④ 键级覆盖(优先于 locale 包):
                                          //    只改想改的键;富文本渲染位支持行内 HTML 片段(文案白名单净化,
                                          //    如「成功」标绿);与 locale 可叠加(en UI + 个别微调)
  },
})
```

**要点**:
- **优先级链**:`messages 覆盖 > locale 内置包 > zh-CN 缺省` —— 任意键不缺,漏配键回退,不会混语言
- **键空间** ~226 键(标题/占位/状态标签/按钮/确认/冲突/聚焦/Debug 各 tab/Agent 信息 kv/Skill 表单/代码预览),完整清单看 `types/index.d.ts` 的 `DialogMessages` 接口
- **HTML 富文本位**:状态标签/标题/思考中/空态问候/确认与冲突/重试回退按钮的文案值以 `<` 开头 = 行内 HTML 片段,经文案白名单(b/em/u/s/span/mark/code + class/style)净化后渲染;title/placeholder 属性位与拼接键(prefix/suffix)按纯文本(传 HTML 字面显示);`sanitizeMessageHtml` 导出可自查净化结果
- **自建 UI 复用**(headless):`MESSAGES_ZH_CN` / `MESSAGES_EN_US` / `resolveDialogMessages(locale, partial)` 均从入口导出,同一套词条驱动你自己的 UI
- **顶部按钮自适应文字标签**(⑤):纯 CSS 容器查询实现 —— 头部内容区 ≥440px 时「新建会话/历史记录/更多」展示文字+图标(关闭钮恒纯图标),更窄自动回退纯图标;不支持 `@container` 的旧浏览器恒纯图标(= 旧行为优雅降级)。文字即 i18n 键(`newSession`/`history`/`more`,`messages` 键级覆盖同机制生效);图标即 `dialog.icons` 同名四键
- **滚动条统一替换**(3.27):主滚动面(消息区 + DebugDrawer 日志区)经 [OverlayScrollbars v2](https://github.com/KingSora/OverlayScrollbars) 接管 —— 隐藏原生滚动条换 overlay 细滚动条(保留原生滚动/键盘/触摸,内容增高自动跟随);对话框级横向不滚(长代码行收敛在代码块内部);其余小滚动区原生细条兜底。手柄颜色经 `--cs-scrollbar-thumb(-hover)` 覆盖(dark 主题已内置适配)
- **历史记录「删除会话」按钮图标**:`dialog.icons.sessionDelete`(缺省 ✕ 文本;传 `<img src="…" width="12" height="12">` 换自定义图)
- **默认 systemPrompt 英文版**单独导出:`DEFAULT_SYSTEM_PROMPT_EN` + `systemPromptHelpers.reliableWriteRulesEn`(英文场景想自定义 prompt 时可拼用)
- 完整示例:`examples/i18n-demo`(en locale + statusDone/emptyGreeting HTML 覆盖)

### 6.17 图片输入(多模态直发 / 识图转述旁路)

对话框内置图片输入:三入口(📎 选择 / 拖拽 / 粘贴截图)→ 压缩闸 → 随下一条消息发送。**图怎么发取决于主模型是否有视觉能力**,三分支自动判定:

| 主模型 | 判定 | 行为 |
|---|---|---|
| 多模态(gpt-4o / gpt-4.1 / gpt-5 / claude 系 / qwen-vl / glm-4v…) | 模型名查表 `vision:true`,或 `llm:{ vision:true }` 显式声明 | **零配置直发**:图片组装 content parts(OpenAI 协议 `image_url` / Anthropic 协议 base64 `image` block,按 provider 自动适配) |
| 纯文本(deepseek-chat 等) | `vision:false` + 配置了 `images.describe` | **识图转述旁路**:发送前逐图调集成方识图端点,转述文本以 `[图片 N 描述]` 拼入该轮 user 上下文,图片本体不发给主模型 |
| 纯文本 + 未配 describe | `vision:false` 且无 describe | **诚实拒绝**:send 报错引导(换多模态模型 / 声明 `vision:true` / 配 describe),不静默丢图 |

```ts
createChatSdk({
  container: '#root',
  llm: { apiKey, baseUrl, model: 'my-proxy-model', vision: true },  // ① 网关代理模型名不可辨时显式声明多模态
  // images: {                                                       // ② 纯文本主模型时绑定识图能力(识图归属集成方)
  //   describe: async (image, { text }) => {
  //     const res = await fetch('/my-vision-api', {
  //       method: 'POST', body: JSON.stringify({ image: image.dataUri, question: text }),
  //     }).then(r => r.json())
  //     return res.description
  //   },
  //   describeTimeoutMs: 15000,   // 默认 15s;超时/失败 → 占位描述 + observable VISION_DESCRIBE_FAILED,对话继续
  // },
})
```

**压缩闸与上限(输入侧,全自动)**:原始文件 >20MB 拒;长边等比缩到 ≤1568px;jpeg q0.85(含透明通道保 png);SVG 经 Image 兜底解码;单轮 ≤4 张。失败为结构化错误码(`IMAGE_TOO_LARGE` / `IMAGE_COUNT_LIMIT` / `IMAGE_DECODE_FAILED` / `IMAGE_COMPRESS_FAILED` / `IMAGE_UNSUPPORTED_TYPE`),UI 输入侧直接提示。

**持久化轻形态**:落盘消息只存缩略图(≤8KB)+ vfs 引用,原图进 vfs `userImages/*` 池(LRU 淘汰;淘汰后刷新仅缩略图降级,不崩);配 `images.upload` 则只存 https URL。

**可选 `images.upload`(原图换 URL,两分支通用)**:有自建 OSS 时,压缩后原图经此上传返回 https URL —— 请求与持久化只走轻 URL(不发大 base64、不占 vfs 池);上传失败自动回退 dataURI 内联直发,留痕不阻塞。

**要点**:
- `vision` 优先级:显式声明(true/false 均覆盖)> 模型名查表 > 缺省 false(保守:误发 parts 吃 400 比走旁路更糟);`setLlm` 换模型时重判定
- describe 转述随消息持久化,重发/会话恢复不重复转述
- headless 自建 UI:`sdk.send(text, { images })`(≤4 张);图片对象用导出的 `compressImage(file)` 制备(浏览器)
- 完整可跑示例:`examples/images-demo`(describe 绑「analyze 形态」识图端点:POST `{image: base64, mime}` → `{data:{description}}`;端点地址只进本地 `.env` 的 `VITE_VISION_URL`,`window.__VISION_CONFIG` 运行时覆盖联调)

## 9. 框架无关 / CDN 集成

宿主页面无需任何构建链路,用 IIFE 全量包一行接入:

```html
<!DOCTYPE html>
<html>
<body>
  <div id="agent"></div>
  <script src="https://unpkg.com/page-agent-sdk"></script>
  <script>
    const { createChatSdk, z } = window.ChatSdk
    const app = { count: 0 }
    createChatSdk({
      container: '#agent',
      llm: { apiKey: 'sk-xxx', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      data: { schema: z.object({ count: z.number() }), bind: app, description: '计数' },
    }).mount()
  </script>
</body>
</html>
```

完整示例见仓库 `demo/plain.html`(importmap + esm.sh)。⚠️ 第三方页注入时,AI 配置对该页 origin 可见,请注意。

## 10. 环境变量

开发时通过 `.env`(前缀 `VITE_`):

| 变量 | 说明 |
|---|---|
| `VITE_AI_API_KEY` | API Key |
| `VITE_AI_BASE_URL` | OpenAI 兼容端点 |
| `VITE_AI_MODEL` | 模型名 |
| `VITE_AI_TEMPERATURE` | 温度(操作大 JSON 建议 0.3) |
| `VITE_AI_MAX_TOKENS` | 输出上限(不配则按模型自动取值,如 deepseek-v4→384K) |
| `VITE_AI_SYSTEM_PROMPT` | 系统提示词(**必须单行**;page-demo 会用自有 systemPrompt 覆盖) |

> 生产环境(库模式)由集成方在 `createChatSdk({ llm, contextOptions, summaryLlm, maxMemoryRounds })` 显式传入,不依赖 `.env`。上下文压缩策略经 `contextOptions`/`summaryLlm` 配置,无 `.env` 项。

## 11. 常见问题与坑

**Q: 刷新后对话没了?**
A: 没开持久化。传 `storage: 'indexed'` + 稳定的 `id`(`id` 不传会随机生成并告警,刷新无法恢复)。

**Q: Agent 报 `400 missing field tool_call_id`?**
A: 这是 SDK 内部 LangChain 消息字段约定,已处理。如果你自定义中间件构造 `ToolMessage`,记得用 snake_case 的 `tool_call_id`。

**Q: 报「model [x] is offline / not support for model」类 400?**
A: 模型在当前网关/服务方不可用(下线或未开放)。SDK 会识别该形态打 `code:'MODEL_UNAVAILABLE'` 并在错误信息尾附引导(换模型名后 `setLlm` 重试,或查网关开放的模型面列表);主路径仍按 fatal 浮出(4xx 不重试),子 agent 委派失败时引导随错误结果回灌主 agent,可据此停手而非反复重委派。注意:**网关回 200 + 错误 JSON 体(非 SSE)的形态**走 `EmptyLLMResponseError` 通道,识别不了具体下线文案(已知盲区)。可用导出的 `isModelUnavailableError(err)` 在自己的 `onEvent` 里做分支处理。

**Q: Agent 改不了某个字段?**
A: 值不符合 `schema`(校验拦截)。检查 schema 定义与传入值。

**Q: 操作大 JSON 时 Agent 报错 / 截断?**
A: ① 用 `write` 的 `patch` 增量改而非整体重传 `value`;② 调大 `maxTokens`;③ 降低 `temperature`(0.3)。

**Q: 怎么关闭某项内置能力?**
A: 用 `capabilities: { dataOps: false, fetch: false, planning: false, skills: false, vfs: false, ... }` 关掉对应内置工具/中间件(默认全开)。`dataOps:false` → 不装 dataOps 工具集(纯调研场景);`fetch:false` → 不装 `fetch_document`。⚠️ vfs 关 → 大结果外存退化为截断;summarization 关 → 长会话不压缩。

**Q: console 提示「capabilities.X 已列入移除计划」?**
A: **`tracing` / `skillHostScript` / `preferences` / `bulkGuard` 四项已于 4.1.0 移除**(残键静默忽略,零 warn;tracing 迁移 → `debugLogs` + `exportDiagnostics`;skillHostScript 的 `exec.context:'host'` 残值落 sandbox 执行 = 语义反转;存量 indexedDB 偏好数据可用浏览器 DevTools 清 `v:1::pref-store::*` 键)。`todoDeps` 已撤除(残键静默忽略)。

**Q: 多个 Agent 同页共存会串数据吗?**
A: 不会。给每个传不同的 `id` 即隔离。若想让多个对话框共享**同一个** Agent,用 `shareContext: true`(同 `id`)。共享实例间有 core 级串行闸:send/switchSession 跨实例排队串行;任一实例的生命周期收口(unmount/switchSession/resetSession)会中止共享 core 的全部在途流(共享状态不允许孤儿流续写)。

**Q: 隐私模式 / 存储满了会崩吗?**
A: 不会。自动降级内存,数据不丢(可能不再持久化),并触发 `degraded` 事件。

---

## 12. 完整示例(简 → 繁)

从最简到复杂,覆盖全部能力。复制即用。

### 12.1 最简(30 秒起步)

```ts
import { createChatSdk, z } from 'page-agent-sdk'

createChatSdk({
  container: '#agent',
  llm: { apiKey: 'sk-xxx', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  systemPrompt: '你是页面助手,帮用户改主数据。',
  // 声明 agent 能碰的主数据(schema 校验,读写都经工具)
  data: {
    schema: z.object({
      title: z.string().describe('页面标题'),
      theme: z.enum(['light', 'dark']).describe('主题'),
    }),
    bind: { title: '首页', theme: 'light' },
    description: '页面配置',
  },
}).mount()
```

零配置自动获得内置工具(read/write + get/set/edit/delete + query/search/eval + snapshot/list/restore + fetch + todos + load_skill + vfs + spawn)。

### 12.2 中等:自定义工具 + skill 文档源 + 持久化

```ts
import { createChatSdk, defineTool, defineSkill, z } from 'page-agent-sdk'

const searchProduct = defineTool({
  name: 'search_product',
  description: '搜索商品库',
  schema: z.object({ keyword: z.string() }),
  handler: ({ keyword }) => fetch(`/api/search?q=${keyword}`).then(r => r.text()),
})

createChatSdk({
  container: '#agent',
  id: 'shop-editor',              // 稳定 id:多 agent 隔离 + 刷新恢复
  storage: 'indexed',             // 持久化(对话 / vfs / todos / memory)
  llm: { apiKey, baseUrl, model: 'deepseek-chat' },
  systemPrompt: '你是商品页编辑助手。复杂任务先 write_todos 拆解。',
  data: { schema: z.object({ components: z.array(z.any()) }), bind: { components: [] }, description: '组件树' },
  tools: [searchProduct],
  skills: [
    defineSkill({ name: 'style-guide', description: '设计规范', doc: 'https://host/style.md' }),  // doc 文档源(http 远程 / vfs 本地)
  ],
  memory: '用简体中文;价格显示 ¥。',
}).mount()
```

### 12.3 复杂:全能力(预声明子 agent + 独立 llm + verify + 中间件)

```ts
import { createChatSdk, defineTool, defineSkill, z, type Middleware } from 'page-agent-sdk'

const searchProduct = defineTool({ name: 'search_product', /* ... */ } as any)

// 自定义中间件:工具埋点
const analytics: Middleware = {
  name: 'analytics',
  afterToolCall: async (ctx, next) => {
    const res = await next(ctx)
    console.log('[埋点]', ctx.name, res?.status)
    return res
  },
}

createChatSdk({
  container: '#agent',
  id: 'shop-editor',
  storage: 'indexed',

  // —— 主 agent ——
  llm: { apiKey, baseUrl, model: 'deepseek-chat', temperature: 0.3, maxTokens: 16384 },
  systemPrompt: '你是商品页编辑助手。复杂任务先 write_todos;调研用 use_researcher;审查用 use_reviewer。',
  data: { schema: z.object({ components: z.array(z.any()) }), bind: { components: [] }, description: '组件树' },
  tools: [searchProduct],
  skills: [defineSkill({ name: 'style-guide', description: '设计规范', doc: 'vfs://skills/style.md' })],
  memory: '用简体中文;价格显示 ¥。',

  // —— 预声明子 agent(命名角色,各配独立 llm / provider)——
  subagents: [
    {
      id: 'researcher', description: '市场调研,擅长分析竞品',
      llm: { apiKey, baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-5' },  // 不同 provider
      systemPrompt: '你是市场调研专家,给数据支撑的结论。',
      tools: [searchProduct],
      temperature: 0.2, maxTokens: 8192,
    },
    { id: 'reviewer', description: '文案审查', systemPrompt: '你是文案审查者,找语病和不合规表述。' },  // 不传 llm → 继承主
  ],

  // —— 自检:返回前验证主数据写入(写后读回 + schema)——
  capabilities: { verify: true },
  verify: { maxAttempts: 2 },

  middleware: [analytics],
  debug: true,
}).mount()
```

主 LLM 会自动:多步任务先 `write_todos` → 调研调 `use_researcher({task})` → 审查调 `use_reviewer({task})` → 改 `components` 前自动 snapshot(误改可 `restore_data`)→ 返回前 verify 自检。

### 12.4 headless 自建 UI(不渲染内置对话框)

```ts
import { createChatSdk } from 'page-agent-sdk'

const agent = createChatSdk({ ui: false, llm, data })
agent.mount()
agent.messages        // 响应式数组,自建 UI 读它
await agent.send('加一个提交按钮')
```

也可 `import { ChatDialog, useChat } from 'page-agent-sdk'` 复用对话框组件与流式 / 重试 / 停止 / 重生成逻辑。

### 12.5 主题定制(换主色)

默认主色墨绿 `#1f4d3a`(去 AI 风 indigo)。覆盖 CSS 变量即可换主题:

```css
#agent { --cs-primary: #b45309; }   /* 换成焦糖棕 */
```

可覆盖变量:`--cs-primary`(主色)/ `--cs-bg`(背景)/ `--cs-radius`(圆角);props:`showAvatar` / `showTyping`(关装饰)。

---

## 更多

- 架构与文件清单:见 `doc/architecture.md` / `doc/architecture-files.md`
- 框架无关集成示例:`demo/plain.html`
- 开发自举 demo:`examples/page-demo/`(`npm run dev`)
- 类型声明:`types/index.d.ts`

## 使用案例索引(端到端场景)

下列 9 个端到端场景含可复制代码,见随包 Agent Skill 的 `skills/page-agent-sdk-integrate/references/use-cases.md`(npm 包内同样包含;安装 skill 见 README「给 AI 工具使用者的 Skills」):

| # | 场景 | 关键配置 |
|---|---|---|
| 1 | 低代码页面搭建 | `data`=组件树;`write` 的 `patch` jsonPath 增量;`onEvent`→画布刷新;`checkpoint`+`approval` |
| 2 | 表单设计器 | `data`=字段定义(枚举/必填 schema);schema 校验防错 |
| 3 | CMS 批量运营 | `eval_script` 批量循环;`search_data` 筛选;`write` 的 `patch` 精确改 |
| 4 | 运维配置台 | `approval` 人工确认;`capabilities.verify:true` 写后读回;`checkpoint` |
| 5 | AI 原生助手 | `capabilities:{dataOps:false,fetch:false}` + 自定义 `tools`(产品 API) |
| 6 | 调研 agent | `capabilities:{dataOps:false}`;`subagent:{allowedTools:['fetch_document']}`;`contextPreset:'conservative'` |
| 7 | 服务端 Node.js | `ui:false`+`storage:'memory'`+`capabilities:{dataOps:false,fetch:false}`;`sdk.send` 驱动 |
| 8 | 同页多 agent | 同 `id`+`shareContext:true`→多对话框共享同一 `AgentCore` |
| 9 | MCP 集成 | `mcp:[{transport,url}]` 远程工具;`@modelcontextprotocol/sdk` 可选 peerDep |
| 10 | 多 Agent 并行 + 互斥切换 | 多个 `createChatSdk`(不同 `id` 各管各 `data`)+ `dialog.drawer:true`;切换调 `hide()`/`show()`(保留各自历史/生成进程,不卸载) |

各场景对应的可运行 demo:`examples/nested-demo`(1)、`examples/page-demo`(1/2)、`examples/subagent-demo`(6)、`examples/rag-demo` D 模式(9)、`examples/human-confirm-demo`(4)、`examples/planner-demo`(规划)、`examples/toolsets-demo`(工具分离)、`examples/animation-demo`(动画 + hide/show)、`examples/multi-agent-demo`(多 Agent 并行 + 互斥切换)。

### 多 Agent 并行 + 互斥切换

同一页面挂多个独立 Agent(各自 `createChatSdk` + 不同 `id` 隔离),各管各 `data`/历史/工具,可并行跑各自生成任务;聊天框互斥切换用 `dialog.drawer` + `hide()`/`show()`——切换时 `hide` 旧的(保留 agent/历史/生成进程)、`show` 新的(历史恢复),不卸载不丢对话:

```ts
const agents = [
  createChatSdk({ id: 'agent-a', container: boxA, dialog: { drawer: true }, data: { schema: schemaA, bind: objA }, ... }),
  createChatSdk({ id: 'agent-b', container: boxB, dialog: { drawer: true }, data: { schema: schemaB, bind: objB }, ... }),
  createChatSdk({ id: 'agent-c', container: boxC, dialog: { drawer: true }, data: { schema: schemaC, bind: objC }, ... }),
]
await Promise.all(agents.map(a => a.mount()))  // 三个独立 agent 并行就绪
agents.slice(1).forEach(a => a.hide())         // 初始只显示第一个

let active = 0
function switchTo(i: number) {
  agents[active].hide(); active = i; agents[i].show()  // 互斥切换,历史各自保留
}
```

**要点**:
- 不同 `id` 隔离:各自独立 agent 实例/历史/工具/storage,互不串扰
- 各管各 `data` 对象无冲突;多 agent 操作同一 `data` 需协调(乐观锁 `expectedHash` 或按 `jsonPath` 分区)
- `hide()` 不卸载 vueApp/不 release agent,保留聊天历史与正在进行的生成进程;`show()` 恢复可见
- 切换按钮若在抽屉遮罩下,需提高 `z-index`(高于遮罩 `9998` + ChatDialog `9999`)确保可点

完整示例:`examples/multi-agent-demo/`。

### 抽屉模式宽度 + 默认隐藏(点击按钮才出现聊天框)

抽屉模式(`dialog.drawer: true`)下,可自定义聊天框宽度,并支持「mount 后默认隐藏,点击按钮才显示」的场景:

```ts
const sdk = createChatSdk({
  id: 'my-agent', container: '#box',
  dialog: {
    drawer: true,             // 抽屉模式
    drawerWidth: 500,          // 宽度 500px(也可传 '500px' / '40vw' / '50%' 等 CSS 字符串);默认 420
    drawerHidden: true,        // mount 后默认隐藏,需 sdk.show() 才显示
  },
  llm, data: { schema, bind },
})
await sdk.mount()            // 挂载但不可见(drawerHidden 生效)

// 点击按钮 → 显示聊天框
document.querySelector('#open-chat-btn')!.addEventListener('click', () => sdk.show())
// 聊天框关闭按钮/遮罩点击 → 默认调 hide()(保留 agent/历史/生成进程),再次 show() 恢复
```

**要点**:
- `dialog.drawerWidth`:纯数字按 `px` 处理;字符串原样透传(支持 `vw`/`%` 等响应式单位);仅 `drawer: true` 生效,inline 模式宽度由 `container` 决定
- `dialog.drawerHidden`:`mount` 后立即调 `hide()`(加 `cs-hidden` class,不可见但 vueApp/agent 已就绪);首次 `show()` 移除隐藏 class,后续 `hide()`/`show()` 切换可见性
- 关闭按钮/遮罩点击默认调 `hide()`(抽屉模式);传 `dialog.onClose` 可自定义关闭行为

**进阶扩展详细例子**(自定义 tool / skills / subagents / MCP)见随包 Agent Skill 的 `skills/page-agent-sdk-integrate/references/advanced.md`:含 `defineTool`(错误处理 + 与 dataOps 共存)、`defineSkill`(内联内容 + 远程 doc)、子 agent(ad-hoc `spawn_agent`/`spawn_agents` + 预声明 `subagents`→`use_<id>`)、MCP(http/sse/websocket + 鉴权 + dev 坑)的可复制代码。
