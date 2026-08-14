# Proposal: auto-html-agent(HTML 子 agent 自动装配,默认开)

## 背景

用户拍板:SDK 主场景锚定浏览器端 HTML 页面搭建,「不考虑其他代码只有 html」。此前反对全自动的理由(code 字段可能是 SQL/脚本等非 HTML)在主场景定位下不成立。

## 语义

createChatSdk 装配期:`htmlAgent !== false` + 无显式 `_codeAsset` 子 agent + `capabilities.subagent` 开 + `inferWritablePaths(schema)` 命中 → 自动追加默认 `createHtmlSubagent()`(info 留痕)。

- **无开关**(用户拍板:主场景只有 HTML,不需要关闭):`htmlAgent` 选项已移除,自动装配无条件
- **显式优先**:已声明 `createHtmlSubagent(...)`(含 pageBuilder preset)→ 跳过自动装配,不重复
- **零变化**:无 code schema(纯数据应用)不装
- 下游(pgIdPaths/largeTextPaths/checkout-commit/编排注入)复用既有 codeAsset 装配链,自动 config 的 writablePaths 由 3.6 推断回填

## 测试

e2e capability-packs 场景⑩(3 组):零配置自动装配全链路(use_html + 编排 + 委派写 code + __pgId)/ 显式优先不重复 / 无 code schema 零变化;既有降级场景改造:② 改顶层 code 字段(推断不出的形态 → 降级编排仍注入),⑥⑧ 改开放 schema `z.any()`(静态扫不出 → 无装配无注入,主 agent 全权直写)。589。

## 行为变更提示(CHANGELOG 显著标注)

此前依赖「数组 code 字段 + 主 agent 直写」的集成现自动走委派(无 opt-out;如需直写改 schema 形态或显式自定义编排)。
