# Specification Delta: page-agent-core

> change `legacy-bundle-channel` 的增量 Requirement。1 条:老构建链宿主的官方接入通道。minor 级(新增产物,现有四产物与全部 API 零变化)。

## Requirement: legacy 接入通道(webpack ≤4 等老构建链宿主)

npm 包必须为「解析器不支持 ES2020+ 语法的构建链」提供可消费的官方产物通道,且该通道经 package.json exports 正式声明(版本随 npm 管理,禁止要求宿主手工拷贝产物文件)。

- **产物契约**:`page-agent-sdk/legacy` 子路径 → `dist/page-agent-sdk.legacy.js`,ESM named exports,`build.target = es2017`(产物中不得残留 `?.`/`??`/逻辑赋值等 ES2020+ 语法,保证 webpack 4 acorn 6 可 parse);vue/zod/@langchain(除 anthropic 动态分支)/MCP SDK 全量打包(宿主零 peer 安装,`z` 从该 bundle 导出)
- **exports 声明**:`package.json` exports 含 `"./legacy"`(types/import 两条件;无 require 变体);`files`/size-check 覆盖该产物
- **API 面等价**:legacy 通道导出的符号集合与主产物一致(exports-consistency 走同一 types 声明);功能行为零差异(仅语法降级,无语义变换)
- **消费范式**(文档固化的推荐路径):webpack≤4 宿主 `await import('page-agent-sdk/legacy')` 作懒加载 chunk,不进首屏主包;现代构建宿主继续用主 ESM 产物,无构建宿主用 IIFE —— 三通道决策树写入集成 skill
- **可测约束**:① 产物无 ES2020+ 语法残留(构建后检查)② node `import('page-agent-sdk/legacy')` 冒烟可达 createChatSdk/z ③ e2e 经 exports 子路径加载装配 headless 实例成功 ④ size-check 阈值内 ⑤ 真实 webpack4 宿主(editor_fangzhou)懒加载 chunk + 真实 LLM 一轮闭环
