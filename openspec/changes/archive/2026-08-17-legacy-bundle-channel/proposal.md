# Proposal: legacy-bundle-channel(老构建链宿主官方接入通道)

## Why

SDK 的 npm 主产物对**webpack ≤4 / vue-cli 2-3 类老构建链宿主不可用**,而这类宿主恰是公司内部运营编辑器的主力栈。2026-08-17 editor_fangzhou(gods-pen fork,Vue 2.6 + vue-cli 3 + webpack 4)接入实测确认两层死因:

1. **语法层**:主产物 target es2022,`?.`/`??` 是 ES2020 —— webpack 4 的 acorn 6 解析器直接 parse 失败;且 webpack 4 默认不对 node_modules 过 babel,宿主须自配 `transpileDependencies`(把 SDK + 其全部 ESM 依赖拖进去)
2. **依赖层**:peerDeps(zod 4 / @langchain/*)全为新语法 ESM,即使配了 transpile 也是一揽子配置 + 构建时间膨胀

当前唯一出路是 IIFE(`<script>` 手工拷产物到 `public/`),能用但属「手工搬运」式兼容:**版本与 npm 世界脱钩**(升级 = 人肉重拷文件、无 semver 锁定、无 lockfile 管控),不适合作为给多个内部宿主的官方通道。

而 IIFE 全量包本身是完备的(vue/zod/@langchain 全打包、esbuild target 已可配),缺的只是一条**「经 npm 安装、但产物对老构建链可解析」**的通道。

## What Changes

### A. legacy ESM 单文件构建(核心)

`vite.legacy.config.ts` 新增一路构建 → `dist/page-agent-sdk.legacy.js`:
- **target es2017**(async/await 原生保留,`?.`/`??`/`||=` 全部转译 —— webpack 4 acorn 6 可直接 parse)
- **全打包零 external**(镜像 iife 配置:vue / zod / @langchain/* / MCP SDK 全部 inline;`@langchain/anthropic` 仍 external —— 动态 import 分支,IIFE 同例)
- ESM 格式(named exports;`z` 从同 bundle 导出,宿主无需安装 zod)
- 消费方式:宿主 `await import('page-agent-sdk/legacy')` —— webpack 4 原生支持动态 import 作懒加载 chunk(2MB 不进主包),**零 transpileDependencies、零 peer 安装**

`package.json` exports 增 `"./legacy"` 子路径(types 复用 `types/index.d.ts`);`files`/size-check 同步。

### B. IIFE 集成路径官方化(文档)

`skills/page-agent-sdk-integrate`(npm 包内分发)+ `doc/usage-guide.md`(中英)补「老构建链接入」段:
- 决策树:现代构建 → ESM 主产物 / **webpack≤4 → legacy 动态 import** / 无构建 → IIFE script
- webpack4 + copy-webpack-plugin 拷 IIFE 产物范式(构建期版本锁定,替代人肉拷 public/)
- Vue2 共存说明(SDK 内置 Vue3 为独立 app 实例,IIFE/legacy 全打包互不进宿主模块图,实测无冲突)
- LLM 网关 CORS 注意(x-stainless 剥头 3.5.0 已做;直连受限网关仍建议宿主自建代理)

### C. 体积监控

`tests/size-check.mjs` 增 legacy 产物阈值(~2MB 量级,基线 + 10%)。

## 验证靶场

editor_fangzhou 真实宿主:`npm i page-agent-sdk` + `await import('page-agent-sdk/legacy')` 替换现有手工 IIFE 拷贝路径,dev server 冒烟(面板挂载 + 真实 LLM 一轮)通过即闭环。

## Non-goals(明确不做 + 理由)

- **legacy UMD/CJS 变体**:webpack4 对 `import()` 动态引入 ESM 无障碍(CJS interop 自动),`require()` 同步引整包场景(2MB 进主包)无正当性
- **es5 target**:async/await 转译 regenerator 体积爆炸(+~60KB 且需 runtime);目标宿主是内部编辑器(现代 Chrome),不是老移动端 webview —— 真有该需求再立项
- **宿主构建链改造支援**(帮 editor_fangzhou 升 webpack5):非 SDK 职责
- **CDN 可达性工程**(esm.sh 对 legacy 子路径的镜像):esm.sh 自动跟随 exports,无需 SDK 侧动作;国内可达性属部署方课题

## Impact

- **代码面**:新增 `vite.legacy.config.ts`;`package.json`(exports/files/scripts.build);`tests/size-check.mjs`(+1 阈值);src 零改动
- **文档面**:`skills/page-agent-sdk-integrate/SKILL.md` + references、`doc/usage-guide.md`/`.en.md`、README×2、CHANGELOG
- **发布面**:minor(新增子路径导出,向后兼容);现有四产物零变化
