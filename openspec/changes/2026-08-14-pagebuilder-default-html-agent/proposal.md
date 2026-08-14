# Proposal: pageBuilder 默认带 html agent + 推断失败优雅降级

## 动机

3.6.0 落地了 writablePaths 装配期推断,「presets.pageBuilder 默认带 createHtmlSubagent()」的前置条件已满足。收益:`createChatSdk({ ...presets.pageBuilder, container, llm, data })` spread 一步 = 完整页面搭建能力(委派编排 + code 资产机制),用户显式传 `subagents` spread 覆盖 = 天然「用户使用了就替换」。

## 两个前置坑(必须先修)

### ① 共享对象突变

presets 是模块级单例对象;装配期推断**就地回填** `config._codeAsset.writablePaths` → 多个 SDK 实例 spread 同一 preset 共享同一 config 对象,实例 A 回填后实例 B(不同 schema)看到非空数组跳过推断 → **B 拿到 A 的错误路径**。
→ 方案:pageBuilder 的 `subagents` 用 **getter**,每次取值(即每次 spread)新建一份 `createHtmlSubagent()` 配置。

### ② 无 code schema 的回归

pageBuilder 是通用「页面构建」preset;现有用户 data 可能没有代码组件。3.6.0 语义:未传 writablePaths + 推断不出 → **throw** → 这些用户的集成直接崩。
→ 方案:推断失败从 throw 改为 **warn + 剔除该子 agent**(优雅降级)。理由:
- preset 默认注入是**隐式意图**——schema 没有 code 数组 = 该能力不适用,不该崩整个集成
- 剔除后主 agent 编排注入自然走「无 html agent」分支(schema 另有顶层 code 字段则注入降级直写 fallback),行为自洽
- 「宁失败不猜错路径」原则不受损——不猜测路径,只是不装不适用能力,且 console.warn 留痕
- 循环依赖安全:presets ↔ htmlSubagent 互相引用,但两边的导出都是 hoisted function declaration,getter 调用发生在模块加载完成后

## 方案

| 文件 | 改动 |
|---|---|
| `src/core/presets.ts` | pageBuilder 加 `get subagents() { return [createHtmlSubagent()] }` |
| `src/core/sdk/createChatSdk.ts` | 推断失败:warn + `dropped` 集合剔除;下游 codeAssetConfigs / subagentsForAssemble / inspect 全用 effective 列表 |
| `tests/e2e/presets.mjs` | pageBuilder + code schema → use_html 存在;无 data/无 code schema → mount 成功无 use_html(降级) |
| `tests/e2e/capability-packs.mjs` | 场景⑨-② 从「throw」改为「warn + 剔除」断言 |

## 非目标

- 运行时 setSubagents/addSubagent 的 codeAsset 装配(既有边界,运行时追加本就不带 checkout/commit 钩子)
- researcher/minimal preset 不动
