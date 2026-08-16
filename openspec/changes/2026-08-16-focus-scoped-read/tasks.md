# Tasks

- [ ] focus.ts wrapToolCall:`read` 空参(无 jsonPath/jsonPaths)且有活动焦点 → 注入 `jsonPaths: 焦点路径数组`(multi-focus 全含);结果前置教学行(聚焦模式说明 + 显式列顶层键取全量)
- [ ] focus.ts 提示段补「read 不带路径默认只返回聚焦子树」一句(与工具行为一致)
- [ ] selftest:空参 read 经 focus 中间件 → 参数被注入焦点路径 + 教学行出现;显式 jsonPath 读不改写;无焦点时零变化
- [ ] browser(page-demo):两步拾取聚焦 → mock read 调用 → 断言 tool_call 入参含 jsonPaths=[焦点路径](或展开返回为子树)
- [ ] 门禁三绿(selftest / e2e / browser)+ CHANGELOG(用户反馈驱动条目)

> 注:实施须等后台真 LLM 回归跑完(跑中禁改源码,HMR 断会话)。
