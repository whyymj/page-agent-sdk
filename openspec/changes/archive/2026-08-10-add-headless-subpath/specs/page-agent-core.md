# Specification Delta: page-agent-core

> 本文件为 change `add-headless-subpath` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。实现完成归档时合入主 specs。

## Requirement: headless 子路径(page-agent-sdk/headless)

系统提供独立子路径 `page-agent-sdk/headless`,导出与主包 `page-agent-sdk` 公开签名完全一致的 `createChatSdk(options: ChatSdkOptions): ChatSdk`,但**打包产物不含 UI 层依赖**(ChatDialog 及 12 个原子组件、marked、highlight.js、dompurify),供 `ui: false` 的 headless 集成方获取精简 bundle。主包 `page-agent-sdk`(`.` 入口)行为、导出、体积零变化。

- **依赖反转**:内部工厂 `_createChatSdk(options, mounter?: DialogMounter)` 与 ChatDialog 静态 import 解耦 —— `createChatSdk.ts` 不 import 任何 `.vue` 组件、不 import vue 组件 API(`createApp`/`h`/`defineComponent`;仅保留 `reactive`/`ref` reactivity);UI 渲染(ChatDialog 挂载 + props 透传 + 退出动画 + show/hide class 切换)封装在新模块 `mountChatDialog.ts`,返回 `DialogController { unmount, show, hide }`,经 `DialogMounter` 类型注入。`AgentCore` 在 `createChatSdk.ts` 内 `export`(仅 module 内部,不从任何入口 re-export),作为 `DialogMountContext.core` 直接传入(避免枚举 30+ props 字段)。
- **双入口注入**:
  - 主入口 `index.ts` 的 `createChatSdk(opts)` 内部调 `_createChatSdk(opts, mountChatDialog)` → 含 UI(现状不变);
  - headless 入口 `index.headless.ts` 的 `createChatSdk(opts)` 内部调 `_createChatSdk(opts)`(不传 mounter)→ 不含 UI。
  - 两入口公开签名一致 `createChatSdk(options: ChatSdkOptions): ChatSdk`;`_createChatSdk` 不从任何入口 re-export(下划线内部)。
- **headless 导出范围**:导出 `createChatSdk` + 全部核心 API(createAgent / 中间件工厂 / tools / backends / composables 纯函数 / 类型)+ `createChatContext`/`chatContextKey`/`useChatContext`/`useChat`(L2 自建 UI 拼装 API,无 UI 组件依赖);**不导出** ChatDialog/MessageContent/CodePreview/SkillPanel/ChatHeader/ChatInput/MessageList/MessageRow/QueuedBar/ApprovalBar/ConflictBar/FocusBar/DebugDrawer。
- **降级行为**:headless 入口创建的 sdk,若 `ui !== false`(默认 `'default'`)且无 mounter → `mount()` 触发 `console.warn`('[page-agent-sdk/headless] 未含 UI 组件,ui 渲染降级 headless;如需 UI 请 import page-agent-sdk 主包'),装 flush 兜底后 `return`(等价 headless 路径,不渲染 DOM)。
- **UI 生命周期保持**:UI 模式下 `mount`/`unmount`/`show`/`hide` 行为(含抽屉 `drawerHidden` 默认隐藏、退出动画 cs-leaving + transitionend/320ms 兜底、shareContext 引用计数 `core.release()` 时机)与主包现状完全一致 —— `DialogController` 内部持有 `vueApp`/`mountEl`,`onDialogUnmounted` 回调在动画结束后 null controller + `core.release()`;createChatSdk 闭包持 `dialogController` 并委托 `mount`/`unmount`/`show`/`hide`。
- **构建产物**:独立 `vite.headless.config.ts`(镜像 `vite.iife.config.ts` 模式,非单 config 多入口 —— 避 vite 8 库模式多入口 ESM 触发 rollup code splitting 产 hash 命名 shared chunk);entry `index.headless.ts`,`formats: ['es']`(仅 ESM),`emptyOutDir: false`,产 `dist/page-agent-sdk.headless.js`。external 与主构建一致(zod / `@langchain/*` / `@modelcontextprotocol/*`)。headless 不产 UMD/IIFE(主包 `ui:false` 已覆盖非 ESM 场景)。
- **package.json**:`exports` 新增 `"./headless": { "types": "./types/headless.d.ts", "import": "./dist/page-agent-sdk.headless.js" }`;`./style.css` 仍仅关联主包(headless 不含 UI → 不需 CSS);`main`/`module`/`types`/`unpkg`/`jsdelivr` 不变(主包)。构建脚本 `build = build:lib && build:headless && build:iife`,新增 `build:headless`。
- **类型声明**:`types/headless.d.ts` 为 `types/index.d.ts` 的核心子集 —— 删 13 个组件 `declare const`,保留全部核心 API/类型 + `ChatSdkOptions`/`ChatSdk`/`DialogConfig` + `createChatContext`/`chatContextKey`/`useChatContext`/`useChat`;顶部 import 去 `DefineComponent`(组件用),留 `InjectionKey`/`Ref`/`ComputedRef`(chatContext 用)。
- **纯净性约束(可测)**:headless bundle 文本不含字符串 `'highlight.js'` / `'dompurify'` / `'marked'` / `createApp` / `defineComponent`(vue 组件 API;reactivity API `reactive`/`ref` 出现是预期);体积 ≤ 600KB(主 ESM 789KB − UI 层 ~250KB,留余量)。
- **主包零变化(可测)**:主包 `page-agent-sdk.js`(789KB) / `.umd.cjs`(622KB) / `.iife.js`(1.83MB)体积不变;主包导出含 ChatDialog 等 39+ 函数/组件不变;e2e(~148 处 `ui:false` 从主包 import)全 pass;浏览器 9 spec(驱动 demo DOM)全 pass。
- **向后兼容**:全增量(新子路径 + 新构建产物 + 新类型声明);不删不改任何现有公开 API;发 minor 2.36.0(非 major)。
