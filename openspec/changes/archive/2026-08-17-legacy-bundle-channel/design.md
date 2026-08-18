# Design: legacy-bundle-channel

## 1. 产物矩阵定位(改后)

| 产物 | 格式 | target | external | 消费场景 |
|---|---|---|---|---|
| `page-agent-sdk.js` | ESM | es2022 | zod/@langchain/MCP(peer) | 现代构建 npm import |
| `page-agent-sdk.umd.cjs` | UMD | es2022 | 同上 | `require()` |
| `page-agent-sdk.iife.js` | IIFE | es2022(自包含)| 仅 @langchain/anthropic | 无构建 `<script>` |
| `page-agent-sdk.headless.js` | ESM | es2022 | 同主产物 | npm 纯核心 |
| **`page-agent-sdk.legacy.js`(新)** | **ESM** | **es2017** | **仅 @langchain/anthropic(全量打包)** | **webpack≤4 `await import('page-agent-sdk/legacy')`** |

legacy 与 iife 的差异只有两点:**格式(ESM 供 import vs IIFE 供 script)** 与 **target(es2017 vs es2022)**。IIFE 消费者(script 标签)全在现代浏览器,target 放宽无收益;legacy 消费者是老构建链解析器,必须 es2017。

## 2. 决策:es2017 而非 es2018/es5

webpack 4 acorn 6 的 parse 能力边界(**实测确认**):
- `?.`/`??`(ES2020):**parse 失败** —— 必须转译
- class fields(ES2022)/`||=`(ES2021):parse 失败或降级警告 —— 必须转译
- async/await(ES2017):原生支持 —— 保留(转译需 regenerator,体积 +60KB 且要 runtime,见 Non-goals)
- 模板字符串/解构/for-of(ES2015-6):原生支持

es2017 = 「老解析器可 parse」的最小转译面。vite/rollup 的 esbuild transform 按 target 自动降级 `?.`(串联三元),无需手配 babel。

## 3. 决策:镜像 iife 配置而非复用多入口

headless 配置文件头注释已记录的教训:vite 8 库模式多入口 + ESM 触发 code splitting,共享 chunk 产出 hash 文件名(跨版本不稳定)。legacy 与主产物入口相同(`src/core/index.ts`)但 target/external 语义完全不同,**独立 `vite.legacy.config.ts` + `emptyOutDir:false` 追加**是既有三配置(lib/headless/iife)的一致模式。

关键配置差异(相对 iife):

```ts
build: {
  emptyOutDir: false,
  lib: {
    entry: resolve(__dirname, 'src/core/index.ts'),
    formats: ['es'],                      // ESM(import 消费),非 iife
    fileName: () => 'page-agent-sdk.legacy.js',
  },
  target: 'es2017',                        // ★ 差异核心:acorn 6 可 parse
  rollupOptions: {
    external: ['@langchain/anthropic'],    // 与 iife 同:动态 import 分支不打包
    output: {
      exports: 'named',
      // css 落 style.css 同既有约定(legacy 与主产物 CSS 同源;宿主 import 'page-agent-sdk/style.css' 复用)
      assetFileNames: …,
      intro: process shim(同 iife:intro 注入,宿主无 process 定义时兜底),
    },
  },
}
```

**CSS**:legacy 产物不重复产 CSS —— 宿主 `import 'page-agent-sdk/style.css'` 走既有子路径(webpack4 对纯 CSS import 零障碍)。legacy 构建的 CSS asset 落 `style.css` 与主构建同名互覆(同源无害,既有 iife 已如此)。

**process shim**:与 iife 同款 intro(全量打包后 zod/langchain 引用 `process.env.NODE_ENV`);webpack4 消费时 `define` 的静态替换在 SDK 构建期已完成,shim 仅兜底运行时残余引用。

## 4. webpack4 消费形态(验证靶场预期)

```js
// editor_fangzhou:loadSdk.js 替换后
const ChatSdk = await import('page-agent-sdk/legacy')
const { createChatSdk, z, defineTool } = ChatSdk
```

- webpack4 原生 `import()` → 自动切独立 chunk,**2MB 懒加载**(首屏零成本,等价现在 public/ 动态 script)
- `z`(zod)从 legacy bundle 导出 → 编辑器无需安装 zod(peer 依赖关系在 legacy 通道下不适用,README/文档说明)
- 类型:`page-agent-sdk/legacy` 的 types 指向 `types/index.d.ts`(与主产物同面;宿主 TS 可选)

## 5. exports 变更

```jsonc
"./legacy": {
  "types": "./types/index.d.ts",
  "import": "./dist/page-agent-sdk.legacy.js"
}
```

无 `require` 变体(见 proposal Non-goals)。`files` 已含 `dist` 零变化;`scripts.build` 追加 `build:legacy`。

## 6. 风险与边界

| 风险 | 评估 |
|---|---|
| legacy 体积 ~2MB 与 iife 同量级 | 懒加载 chunk 不进首屏;size-check 阈值兜底(+10%) |
| 双 Vue(宿主 Vue2 + SDK Vue3)| 全打包隔离,互不进模块图;editor_fangzhou 实测已验证(IIFE 同构) |
| es2017 转译引入行为差异 | esbuild `?.` 降级是纯语法变换(三元串联),无语义变化;selftest/e2e 跑 legacy 产物冒烟(见 tasks 4b) |
| 产物数 +1 的维护成本 | 构建脚本一行追加,与 headless/iife 同模式;CI 全量构建时间 +~10s |
| exports 子路径对旧 npm 的兼容 | `"./legacy"` 标准 exports map 条目,npm 7+ 全支持(webpack4 宿主的 npm 版本生态已在别处卡死在 node_modules 结构,不新增约束) |
