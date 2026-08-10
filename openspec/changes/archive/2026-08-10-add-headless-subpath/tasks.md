# Tasks: add-headless-subpath

> 实施任务清单。`/opsx:apply` 按此执行。每完成一项勾 `[x]`。

## 阶段 A:核心解耦(`src/core/sdk/createChatSdk.ts`,零公开 API 变化)

- [x] A1 `AgentCore` 改 export(line 539 `interface AgentCore` → `export interface AgentCore`,仅 module 内部);新增类型 export `DialogMountContext`/`DialogController`/`DialogMounter`(design §2 契约)
- [x] A1 原 `createChatSdk` 改名 `_createChatSdk(options, mounter?: DialogMounter): ChatSdk`
- [x] A2 删 `import ChatDialog`(line 21);line 18 移除 `createApp`/`h`/`defineComponent`(grep 确认 `buildCore` 等仍用 `reactive`/`ref`,保留 + `type App`/`type Ref` 按需)
- [x] A3 闭包 `let vueApp`/`let mountEl`(line 2017-2018)→ `let dialogController: DialogController | null = null`;`mount()`/`unmount()`/`hide()`/`show()` 按 design §3 契约重写(UI 分支委托 mounter + `onDialogUnmounted`;headless 分支 `ui===false || !mounter` 装 flush return,无 mounter 且 `ui!=='false'` warn;hide/show 委托 controller)
- [x] A4 新建 `src/core/sdk/mountChatDialog.ts` —— import ChatDialog + `createApp`/`h`/`defineComponent` + `import type { DialogMountContext, DialogController }`;`export function mountChatDialog(ctx): DialogController`;搬迁 line 2054-2109(50 行 props)+ 2141-2182(动画/show/hide);`controller.unmount` finish 末尾调 `ctx.onDialogUnmounted()`

## 阶段 B:双入口

- [x] B1 `src/core/index.ts` —— 新增 `import { mountChatDialog }` + `import { _createChatSdk }` + `import type { ChatSdkOptions, ChatSdk }`;line 16 改包装 `export function createChatSdk(opts) { return _createChatSdk(opts, mountChatDialog) }`;其余 re-export 不变
- [x] B2 新建 `src/core/index.headless.ts` —— `createChatSdk(opts) = _createChatSdk(opts)`(不注入);不 re-export 13 个 `.vue`;保留 `createChatContext`/`chatContextKey`/`useChatContext`/`useChat` + 全核心 API;顶部注释(降级语义 + L2 拼装说明)

## 阶段 C:构建配置

- [x] C1 新建 `vite.headless.config.ts`(基于 `vite.config.ts`)—— entry=`index.headless.ts` / fileName=`page-agent-sdk.headless` / `formats: ['es']` / `emptyOutDir: false` / external 不变 / 顶部注释
- [x] C2 `package.json` scripts —— `build` 改 `build:lib && build:headless && build:iife`;新增 `"build:headless": "vite build --config vite.headless.config.ts"`
- [x] C3 `package.json` exports 新增 `"./headless"`(`types` + `import`);files/sideEffects/main/module/unpkg/jsdelivr 不变

## 阶段 D:类型声明

- [x] D1 新建 `types/headless.d.ts` —— 复制 `index.d.ts`,删 13 个组件 `declare const`,保留核心 API/类型 + `ChatSdkOptions`/`ChatSdk`/`DialogConfig` + `createChatContext`/`chatContextKey`/`useChatContext`/`useChat`;顶部 import 去 `DefineComponent` 留 `InjectionKey`/`Ref`/`ComputedRef`

## 阶段 E:测试(新增功能测试同步约定)

- [x] E1 `tests/exports-consistency.mjs` 扩展 —— 比对 `index.headless.ts` ↔ `headless.d.ts` 名集合;断言 `exports['./headless']` 配置;断言 headless 导出不含组件名
- [x] E2 新建 `tests/e2e/headless-subpath.mjs`(在 `tests/e2e-integration.mjs` 注册)—— `import` headless 产物;`createChatSdk` 为 function;`ChatDialog`/`MessageContent`/`useMarkdown` === undefined;`createChatContext`/`useChatContext`/`useChat` 在;`ui:'default'` 触发 `console.warn`(mock)+ 仍 mount;`ui:false` 走通 mount+send;bundle 文本断言不含 `highlight.js`/`dompurify`/`marked`
- [x] E3 `tests/size-check.mjs` 扩展 —— 新增 `{ file: 'dist/page-agent-sdk.headless.js', max: 600*KB }`;主包 ESM 阈值不变(防回归)
- [x] E4 selftest 无需改(测纯函数不经 dist;无新纯函数)—— 确认无模块测 `createChatSdk` mount UI

## 阶段 F:文档(中英文同步,勿漏单边)

- [x] F1 `README.md` / `README.zh-CN.md` —— headless 子路径用法(`import { createChatSdk } from 'page-agent-sdk/headless'`)+ 体积对比
- [x] F2 `doc/usage-guide.md` / `doc/usage-guide.en.md` —— headless 章节加子路径精简 bundle 说明
- [x] F3 `CLAUDE.md` —— 目录结构(加 4 新文件)+ 构建产物矩阵(加 `page-agent-sdk.headless.js`)+ 测试计数(e2e +N)+ 测试矩阵(headless subpath 行)+ headless 段提 `/headless` 子路径

## 阶段 G:发布(minor 2.36.0,用户确认后执行)

- [x] G1 develop 开发 + commit
- [x] G2 `npm version minor --no-git-tag-version`
- [x] G3 发布前必跑顺序:`build` → `selftest` 1590 → `e2e`(+headless-subpath)→ `browser` 9 → `test:exports`(+headless 对齐)→ `test:types` → `test:size`(+headless 阈值)→ `npm pack --dry-run`(含 headless 产物,不含 `.env`/`src`/`examples`/笔记)
- [x] G4 `publish-github.sh` 总结到 master 推双远程
- [x] G5 `npm publish`;验证 `npm view` + 临时目录 `npm i page-agent-sdk` + esm.sh `/headless` 可达

## 验证门禁

- **主包零变化**:`build` 体积不变(789/622/1830KB)+ `e2e` 全 pass + 浏览器 9 spec 全 pass
- **headless 新**:`test:size` ≤600KB + `e2e headless-subpath`(纯净/降级/走通/文本断言)+ `exports` 一致性
