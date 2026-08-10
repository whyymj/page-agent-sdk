# Change: add-headless-subpath(headless 精简子路径 page-agent-sdk/headless)

> 状态:proposal(未实施)。**非破坏 minor 2.36.0**。与 `chatdialog-component-split`(组件拆分)正交,可独立实施。

## Why

headless 集成方(`ui: false` 自建对话框)被迫背 UI 层依赖:`marked` + `highlight.js` + `dompurify` + ChatDialog 全子树(13 个 `.vue`)打包进主 bundle(ESM 789KB)。这些 100% 是 UI 层依赖,headless 运行时根本不碰(`ui===false` 在 mount 段 `return`),却因**打包层静态 import** 被拉进 bundle。

探索确认运行时架构**已是 headless-first**:
- `core` 对象(`stream`/`messages`/`agent`/`sessions`...)独立于 `vueApp`,`ui===false` 在 `createChatSdk.ts:2035` mount 段 `return`,完全不触碰 ChatDialog
- 耦合**仅在打包层**:① `createChatSdk.ts:21` 静态 `import ChatDialog` ② `createChatSdk.ts:18` 静态 import `createApp/h/defineComponent`(仅 mount 段用)③ `index.ts:116-130` re-export 13 个 `.vue`
- `marked`/`highlight.js`/`dompurify` 唯一入口是 `composables/useMarkdown.ts`,唯一消费者 `MessageContent.vue`;全 `src/core/` 除 createChatSdk.ts 外**零** `.vue` import

| 现状 | 问题 |
|---|---|
| headless 用户 `import { createChatSdk } from 'page-agent-sdk'` | 拉入 ChatDialog + marked + hljs + dompurify(运行时不碰的 ~250KB+) |
| `ui:false` 运行时短路 | 仅运行时;bundle 仍含全部 UI 代码(静态 import 在打包期发生) |
| 无 headless 子路径 | headless 用户无精简 bundle 选项 |

## What Changes

新增 `page-agent-sdk/headless` 子路径(纯核心,无 UI/marked/highlight.js/dompurify),主包 `page-agent-sdk` 行为完全不变。

### 1. 依赖反转:createChatSdk 与 ChatDialog 解耦
- `createChatSdk.ts` 不再静态 `import ChatDialog` + 不 import `createApp/h/defineComponent`(vue 组件 API)
- UI 渲染(ChatDialog 挂载 + 50 行 props + 退出动画 + show/hide)抽到新模块 `mountChatDialog.ts`,返回 `DialogController`
- 内部工厂 `_createChatSdk(options, mounter?)`:有 mounter → 渲染 UI;无 mounter → headless(`ui!=='false'` 时 warn 降级)

### 2. 双入口
- **主入口 `index.ts`**:包装 `createChatSdk(opts) = _createChatSdk(opts, mountChatDialog)`(注入 → 含 UI,现状不变)
- **headless 入口 `index.headless.ts`(新)**:`createChatSdk(opts) = _createChatSdk(opts)`(不注入 → 不含 UI);不 re-export 13 个 `.vue`;保留 `createChatContext`/`chatContextKey`/`useChatContext`/`useChat`(L2 拼装 API,无 UI 依赖)+ 全核心 API
- 两入口公开签名完全一致 `createChatSdk(options: ChatSdkOptions): ChatSdk`(用户无感知)

### 3. 独立构建 config(非单 config 多入口)
- 新建 `vite.headless.config.ts`(镜像现有 `vite.iife.config.ts` 模式),entry = `index.headless.ts`,产 `page-agent-sdk.headless.js`(ESM only),`emptyOutDir:false`
- **为何不用单 config 多入口**:vite 8 库模式多入口 + ESM 触发 rollup code splitting,两入口共享 `_createChatSdk` 会产 hash 命名 shared chunk(跨版本不稳定,违背精简单文件);独立 config 每次构建独立 rollup 调用 → 产物自包含

### 4. package.json exports
- 新增 `"./headless": { "types": "./types/headless.d.ts", "import": "./dist/page-agent-sdk.headless.js" }`
- `files`/`sideEffects`/`main`/`module`/`unpkg`/`jsdelivr` 不变(主包仍含 UI)

### 5. types/headless.d.ts(核心子集)
- 复制 `types/index.d.ts`,删 13 个组件 `declare const`;保留全部核心 API/类型 + `ChatSdkOptions`/`ChatSdk`/`DialogConfig` + `createChatContext`/`chatContextKey`/`useChatContext`/`useChat`

## Impact

- **主包零变化(最高优先级)**:`page-agent-sdk.js`(789KB)/ `.umd.cjs`(622KB)/ `.iife.js`(1.83MB)体积不变;导出不变;e2e(~148 处 `ui:false` 从主包 import)全 pass;浏览器 9 spec(驱动 demo DOM)全 pass;14 自动 UI demo / 2 headless demo **0 改动**
- **headless 子路径(新)**:ESM ~530-550KB(**-30~33%**);e2e 新 `headless-subpath.mjs`;`size-check` 加阈值;`exports-consistency` 加 headless 对齐 + 纯净性断言
- **向后兼容**:全增量(新子路径);主包行为/导出/体积零变化;发 **minor 2.36.0**(非 major)
- **文档**:中英文 README + usage-guide 同步;CLAUDE.md 目录结构/产物矩阵/测试矩阵

## 决策

1. **非破坏 minor(用户拍板)**:主包 `page-agent-sdk` 行为完全不变,新增子路径给 headless 用户精简 bundle。不取 major(headless 成默认)—— 14 自动 UI demo + 外部集成方零改动优先。
2. **独立 config 而非多入口**:避免 rollup code splitting 的 hash shared chunk;镜像现有 IIFE 模式;产物自包含、文件名确定。
3. **内部工厂 `_createChatSdk` + 入口包装**:不在 `ChatSdkOptions` 加内部字段(避免污染公共类型,用户 IDE 看不到 `_dialogMounter`);两入口公开签名一致;`_createChatSdk` 不从入口 re-export(下划线内部)。
4. **export `AgentCore` 传 mountChatDialog**:mount 段 50 行 props 全从 `core` 取值,与其在 `DialogMountContext` 枚举 30+ 字段(脆弱易漂移),直接传 `core`;`AgentCore` 仅 `createChatSdk.ts` module 内 export,不从入口 re-export(不扩公开类型面)。
5. **headless 仅 ESM**:npm bundler 消费;UMD/IIFE 用户走主包 `ui:false`(主包已含全量)。子路径是 ESM bundler 精简优化,非新格式。

## Non-goals

- 不做 headless 成默认(major 破坏,推后;用户选非破坏)
- 不剥 vue(核心层用 reactivity + `chatContext` 用 `inject`/`InjectionKey`,reactivity 子包不含;vue 仍打包进)
- 不出 headless UMD/IIFE(主包 `ui:false` 已覆盖非 ESM 场景)
- 不改 14 自动 UI demo / 2 headless demo(主包零变化)
- 不动 IIFE 全量 CDN 构建(仍含 UI,CDN 要全量)
