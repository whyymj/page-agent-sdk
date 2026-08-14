# Tasks: html-subagent-open-schema

> 实施任务清单。`/opsx:apply` 按此执行。每完成一项勾 `[x]`。
> **minor**(向后兼容)。分阶段:A codeField 配置 → B 编排自适应注入(有 agent 委派 / 无 agent 自己写)→ C 测试 → D 文档 → E 发布(minor,用户确认)。

## 前置条件(apply 前)

- [x] P0 **已 commit**(ba991d1:complex-demo 纯代码组件接入 + F1/F2/F3 框架缺陷修复 + 提示词治理先行,含去 SFC 单 HTML 模式 + htmlPageOrchestrator 片段)。本 change 在其上独立批次。

## 阶段 A:codeField 配置

- [x] A1 `CreateHtmlSubagentOptions` 加 `codeField?: string`(默认 `'code'`);`_codeAsset` 标记透传 codeField
- [x] A2 `codeAssetMiddleware.ts` checkout 读 `o.code` → `getByPath(o, codeField)`;commit 写 `o.code=` → `setByPath(o, codeField, ...)`(**复用 jsonUtils:38 现有 setByPath,仅需补 import,无需新增纯函数**)
- [x] A3 `createChatSdk.ts` largeTextPaths `${wp}.code` → `${wp}.${codeField}`
- [x] A4 ~~prompt 动态引用 codeField~~ → **已 staged 泛化**(prompt「新建组件」已改 `value:{...}` 按 schema 写,无 `code` 字面量)。本任务降级为:grep 核对 htmlSubagent.ts / SKILL.md 无残留 `code` 字面量即可
- [x] A5 selftest(sec-75 扩展):① 嵌套 codeField(`props.html_code`)checkout/commit 往返 ② 非代码组件(无该路径)跳过 ③ 默认 'code' 零回归 ④ **嵌套 codeField → 主 scope read 见 `<code Nkb>` 摘要(largeTextPaths 嵌套点号路径生效)**
- [x] A6 **命中校验(防静默失败)**:`CodeAssetMiddlewareOptions` 加 `onWarning?: (msg: string) => void`;beforeAgent 扫描,组件数>0 且 codeField 全员未命中 string → 调 onWarning(文案含 codeField 值 + 组件实际字段名 +「可忽略」);createChatSdk 装配时转发 onWarning → `emit({type:'warn'})` + debugLog。**不阻断 checkout**。selftest:未命中触发 warning / 部分命中不触发 / 无组件不误报

## 阶段 B:编排自适应注入(有 agent 委派 / 无 agent 自己写)

- [x] B1 **同源化(关键)**:`htmlSubagent.ts`(或 presets.ts)抽纯函数 `htmlOrchestratorPrompt(id: string)`(`use_${id}` 动态注入,内容=已 staged 的 5 条,**职责边界强化"custom code 不 read 不 write"**);`systemPromptHelpers.htmlPageOrchestrator` 改为 `htmlOrchestratorPrompt('html')` 静态快照(单一数据源,防漂移);`createHtmlSubagent({id})` → `_codeAsset.orchestratorPrompt = htmlOrchestratorPrompt(id)`(opt-out `orchestratorPrompt:false` → 不设字段)
- [x] B2 `createChatSdk.ts` 装配期(buildSystemPrompt 后)**三态自适应**:① 有 html agent 且未 opt-out → append 委派编排(htmlOrchestratorPrompt(id));② 无 html agent + schema 有 code/largeText 字段 → append 自己写编排(htmlDirectWriteFallback)+ warn;③ 无 code 字段 + 无 agent → 不注入
- [x] B3 `CreateHtmlSubagentOptions` 加 `orchestratorPrompt?: boolean`(默认 true)
- [x] B4 `presets.ts` 加 `htmlDirectWriteFallback` 片段(自己写编排:code 直接 write + HTML 生成规范 + 权衡提示)
- [x] B5 `createChatSdk.ts` 装配期 warn:检测 code/largeText 字段但无 html agent → console.warn + debugLog(非阻断)
- [x] B6 selftest:① 有 agent → 主 systemPrompt 含委派编排(不 read 不 write + use_<id>);② 无 agent + code 字段 → 含 htmlDirectWriteFallback + warn;③ 无 code 字段 + 无 agent → 不注入;④ opt-out 不注入委派;⑤ 自定义 id → use_hero
- [x] B7 ~~htmlPageProposeFirst 导出~~ → **已 staged 实现导出**(presets + types + sec-31),随 B commit 确认(opt-in,不自动注入)

## 阶段 C:测试门禁

- [x] C1 同步 CLAUDE.md selftest 计数(1868 + N)
- [x] C2 `npm run build && npm test && npm run test:e2e` 三绿
- [x] C3 `test:exports` + `test:types` + `test:types-alignment`(新导出 htmlPageProposeFirst + codeField 类型对齐)

## 阶段 D:文档(中英文同步)

- [ ] D1 README.md / README.zh-CN.md —— codeField(开放 schema 多组件平台)+ 编排自动注入 + htmlPageProposeFirst opt-in
- [ ] D2 doc/usage-guide.md / .en —— 开放 schema 集成示例(props.html_code)+ 路由说明(code→use_html / 其他→主 agent)
- [ ] D3 CLAUDE.md —— 子 agent 段(codeField + 编排注入)+ 数据槽段(codeField 替换硬编码 .code)+ 计数

## 阶段 E:发布(minor,用户确认后)

- [ ] E1 develop 开发 + commit;openspec 归档 `git add -f openspec/changes/archive/2026-08-13-html-subagent-open-schema/`;README 全景盘点同步
- [ ] E2 `npm version minor --no-git-tag-version`
- [ ] E3 发布前必跑顺序全绿
- [ ] E4 `publish-github.sh "release x.x.0: createHtmlSubagent 可配置 code 字段 + 主 agent 编排提示词自动注入(开放 schema 多组件平台)"` 推双远程
- [ ] E5 `npm publish` + 验证

## 验证门禁

- **codeField**:selftest(嵌套往返 / 非代码组件跳过 / 默认零回归 / 命中校验 warning)
- **编排自适应注入**:selftest(有 agent 委派 / 无 agent 自己写 + warn / 无 code 字段不注入 / opt-out)
- **零回归**:现有 html-page-demo(默认 codeField)+ e2e 全 pass
