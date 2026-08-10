# Design: add-headless-subpath

> 技术设计。配合 `proposal.md`(Why/What)、`specs/page-agent-core.md`(行为规格)、`tasks.md`(实施步骤)。

## 1. 方案总览:依赖反转 + 独立 config + 双入口

核心:`createChatSdk` 不再静态 import ChatDialog,UI 渲染抽成**可注入的** `mountChatDialog`。主入口注入(含 UI,现状),headless 入口不注入(不含 UI)。

```
src/core/sdk/createChatSdk.ts   # 解耦:无 ChatDialog import;导出 _createChatSdk(options, mounter?) 内部工厂
src/core/sdk/mountChatDialog.ts # 新建:ChatDialog 渲染 + 动画 + controller(含 ChatDialog import)
src/core/index.ts               # 主入口:createChatSdk = (opts) => _createChatSdk(opts, mountChatDialog)
src/core/index.headless.ts      # 新建 headless 入口:createChatSdk = (opts) => _createChatSdk(opts)
vite.headless.config.ts         # 新建:独立 ESM 构建
types/headless.d.ts             # 新建:核心子集声明
```

## 2. 依赖反转契约(createChatSdk.ts 导出,内部)

```ts
// createChatSdk.ts
export interface AgentCore { ... }   // line 539 改 export(仅 module 内部,不从入口 re-export)

// 原 createChatSdk 改名 + 加 mounter 第二参数(不进 ChatSdkOptions 类型,避免污染公共类型)
export function _createChatSdk(options: ChatSdkOptions, mounter?: DialogMounter): ChatSdk

// mountChatDialog 的入参(createChatSdk 闭包构造后传入)
export interface DialogMountContext {
  el: HTMLElement
  core: AgentCore                  // 直接传 core,避免枚举 30+ props 字段(防漂移)
  dialogCfg: DialogConfig
  streaming: boolean
  runSerial: <T>(fn: () => Promise<T>) => Promise<T>
  hide: () => void                 // 传给 ChatDialog onClose(抽屉模式关 → hide)
  unmount: () => void              // 传给 ChatDialog onClose(非抽屉关 → unmount)
  onDialogUnmounted: () => void    // 动画完成后回调(= dialogController=null + core.release())
}

// mountChatDialog 返回的 UI 生命周期控制器
export interface DialogController {
  unmount(): void                  // 启动退出动画;transitionend/320ms 兜底后调 ctx.onDialogUnmounted
  show(): void                     // 移除 .chat-dialog/.chat-mask 的 cs-hidden
  hide(): void                     // 添加 cs-hidden
}

export type DialogMounter = (ctx: DialogMountContext) => DialogController
```

`mountChatDialog.ts` 用 `import type { DialogMountContext, DialogController } from './createChatSdk'` —— 纯类型 import,不产生运行时循环依赖。

## 3. createChatSdk 闭包重构(mount/unmount/show/hide)

**关键:`vueApp`/`mountEl` 从 createChatSdk 闭包移入 DialogController。** 闭包改持 `let dialogController: DialogController | null = null`(替原 `let vueApp`/`let mountEl`,line 2017-2018)。

```
mount(overrideContainer?):
  1. await core.initDone
  2. if (dialogController) { show(); return }   // 已挂载(含抽屉 hide 后再 mount)
  3. 解析 container → el(同现状 line 2049-2052)
  4. if (ui === false || !mounter):
       - 无 mounter 且 ui !== false(headless 入口) → console.warn('[page-agent-sdk/headless] 未含 UI 组件,ui 渲染降级 headless;如需 UI 请 import page-agent-sdk 主包')
       - 装 flush/vis 兜底 handler(现状 line 2036-2046 逻辑)
       - return
  5. dialogController = mounter({ el, core, dialogCfg, streaming, runSerial, hide, unmount,
                                   onDialogUnmounted: () => { dialogController = null; core.release() } })
  6. 抽屉 drawerHidden 默认隐藏:if (drawer && drawerHidden) dialogController.hide()
  7. 装 flush/vis 兜底 handler(现状 line 2121-2131 逻辑,与 headless 路径共用)

unmount():
  1. core.resolveConflict('keep_external')    // 收口挂起冲突(保留)
  2. remove flush/vis handler                  // 核心层(保留)
  3. if (dialogController):
       dialogController.unmount()              // 委托:动画 + vueApp.unmount + onDialogUnmounted
       // 不在此 null dialogController —— 由 onDialogUnmounted 回调 null(保留动画期间 mount() 走 show() 的现状)
     else:
       core.release()                          // headless 路径:无动画直接 release

hide(): dialogController?.hide()
show(): dialogController?.show()
```

`flushHandler`/`visHandler`(pagehide/visibilitychange flush 兜底)两模式共用,留 createChatSdk(不归 mountChatDialog)。

## 4. mountChatDialog.ts(新建)

搬迁 createChatSdk.ts 现有 UI 代码(零逻辑改动):
- `import { createApp, h, defineComponent, type App as VueApp } from 'vue'`
- `import ChatDialog from '../components/ChatDialog.vue'`
- `export function mountChatDialog(ctx: DialogMountContext): DialogController`
- 内部:局部 `let vueApp: VueApp | null = null`、`let mountEl: HTMLElement | null = ctx.el`
- `Wrapper = defineComponent({ setup: () => h(ChatDialog, { ...50 行 props... }) })` —— **从 line 2054-2109 原样搬迁**,props 全部从 `ctx.core` / `ctx.dialogCfg` / `ctx.streaming` / `ctx.runSerial` / `ctx.hide` / `ctx.unmount` 取值
- `vueApp = createApp(Wrapper); vueApp.mount(ctx.el)`
- 返回 controller:`unmount`/`show`/`hide` 逻辑从 line 2141-2182 原样搬迁;`controller.unmount` 的 finish 回调末尾调 `ctx.onDialogUnmounted()`

## 5. 双入口

**index.ts(主入口,注入)** —— line 16 改:
```ts
import { _createChatSdk } from './sdk/createChatSdk'
import { mountChatDialog } from './sdk/mountChatDialog'
import type { ChatSdkOptions, ChatSdk } from './sdk/createChatSdk'
export function createChatSdk(options: ChatSdkOptions): ChatSdk {
  return _createChatSdk(options, mountChatDialog)
}
// 其余 re-export 不变(13 个 .vue + chatContext + useChat + 全核心 API)
```

**index.headless.ts(新建,不注入)**:
```ts
import { _createChatSdk } from './sdk/createChatSdk'
import type { ChatSdkOptions, ChatSdk } from './sdk/createChatSdk'
export function createChatSdk(options: ChatSdkOptions): ChatSdk {
  return _createChatSdk(options)   // 无 mounter → 不含 UI
}
// 不 re-export 13 个 .vue
// 保留 createChatContext/chatContextKey/useChatContext/useChat(L2 拼装,无 UI 依赖)
// 保留全部核心 API(createAgent/中间件工厂/tools/backends/composables 纯函数/类型)
```

## 6. 构建配置

**vite.headless.config.ts(新建,基于 vite.config.ts)**:
- `entry: resolve(__dirname, 'src/core/index.headless.ts')`
- `fileName: 'page-agent-sdk.headless'`
- `formats: ['es']`(仅 ESM)
- `emptyOutDir: false`(追加,不清空 lib/iife 产物)
- external 不变(`zod` / `^@langchain/` / `^@modelcontextprotocol/`)
- 顶部注释:headless 精简构建,不含 UI 组件层

**package.json**:
- `scripts.build`: `"npm run build:lib && npm run build:headless && npm run build:iife"` + 新增 `"build:headless": "vite build --config vite.headless.config.ts"`
- `exports` 加 `"./headless": { "types": "./types/headless.d.ts", "import": "./dist/page-agent-sdk.headless.js" }`

## 7. types/headless.d.ts(核心子集)

复制 `types/index.d.ts`:
- **删** 13 个组件 `declare const`(ChatDialog/MessageContent/CodePreview/SkillPanel/ChatHeader/ChatInput/MessageList/MessageRow/QueuedBar/ApprovalBar/ConflictBar/FocusBar/DebugDrawer)
- **保留** 全部核心 API/类型 + `ChatSdkOptions`/`ChatSdk`/`DialogConfig` + `createChatContext`/`chatContextKey`/`useChatContext`/`useChat`
- 顶部 import 去 `DefineComponent`(组件用),留 `InjectionKey`/`Ref`/`ComputedRef`(chatContext 用)

## 8. headless bundle 不含 UI 的确定性论证

rollup 静态依赖分析(非运行时 tree-shaking 优化,是确定性可达性):
- `index.headless.ts` import `_createChatSdk`(`createChatSdk.ts`)→ 后者移除 ChatDialog import 后,其 import 图(全部 harness/tools/backends/composables/utils)**零** `.vue` / **零** marked/hljs/dompurify
- `index.headless.ts` 不 re-export 13 个 `.vue` → `mountChatDialog` + ChatDialog 全子树 + `useMarkdown` + marked/highlight.js/dompurify **不可达**
- 不可达 = rollup 确定排除(无需依赖 tree-shaking 优化配置)
- 反向验证(三份探索 grep 全量确认):`composables/`/`harness/`/`tools/`/`backends/`/`sdk/`(除 createChatSdk)零 `.vue` import;`useMarkdown` 唯一消费者 `MessageContent.vue`(在不可达子树内)

## 9. 动画/引用计数/shareContext 行为保持

- **shareContext 引用计数**:`core.refCount++` 仍在 `_createChatSdk` 构造段(不变);`core.release()`:UI 模式 `controller.unmount` → finish → `onDialogUnmounted` → `core.release()`(动画结束后);headless 模式 unmount 直接 `core.release()`。与现状一致。
- **动画时序**:`controller.unmount` 内部加 cs-leaving → transitionend/320ms → `vueApp.unmount` + `onDialogUnmounted`。与现状 line 2141-2158 完全一致,仅物理位置从闭包移到 controller。
- **抽屉 hide 后再 mount 的 show**:`mount()` 首行 `if (dialogController) { show(); return }`。`dialogController` 在 unmount 动画完成前仍非 null(`onDialogUnmounted` 才 null)。动画期间 mount() 走 show() 分支 —— 与现状(`vueApp` 在 finish 才 null)一致。

## 10. 风险矩阵 + 回退

| 风险 | 缓解 |
|---|---|
| mountChatDialog 抽取 props 遗漏/动画时序变 | 50 行 props + 动画逻辑原样搬迁(零改动);浏览器 9 spec 覆盖 |
| shareContext 引用计数/unmount 时序 | `onDialogUnmounted` 在 finish 末尾调;动画期间 mount() 走 show()(与现状一致) |
| headless bundle 意外拉入 UI | bundle 文本断言(不含 marked/hljs/dompurify)+ size 600KB 阈值;独立 config 自包含无 shared chunk |
| `AgentCore` 类型泄露 | 仅 createChatSdk.ts module 内 export,不从入口 re-export,types 不声明 |
| `_createChatSdk` wrapper 致 e2e import 断 | e2e 从 `dist/page-agent-sdk.js` import(主入口),wrapper 以 `createChatSdk` 名导出,签名不变 |

**回退**:全可 revert(`createChatSdk.ts` 改回 + `index.ts` 去 wrapper + 删 4 新文件 + revert package.json)。无数据迁移、无破坏性公开 API。

## 11. 体积预估

| 产物 | 现状 | 预估 headless | 差值 |
|---|---|---|---|
| page-agent-sdk.js (ESM) | 789KB | — | — |
| page-agent-sdk.headless.js (ESM) | — | ~530-550KB | **-30~33%** |

排除:`highlight.js/lib/common` ~100-110KB / `marked` ~40-50KB / `dompurify` ~45KB / 13 组件编译 JS ~50-70KB(CSS 已分离 `style.css`,不计)。
