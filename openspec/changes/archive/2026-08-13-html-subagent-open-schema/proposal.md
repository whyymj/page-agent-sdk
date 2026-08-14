# Change: html-subagent-open-schema(createHtmlSubagent 适配开放 schema 多组件平台:可配置 code 字段 + 自动注入编排提示词)

> 状态:proposal(未实施)。**minor**(向后兼容:codeField 默认 `'code'` 保持现状;编排提示词自动注入是新增段,现有 demo 内容等价零回归)。S 规模。

## Why

`code-as-data-asset`(3.0.0)落地后,真实低代码平台接入暴露两个硬编码假设,每个都撞上「开放 schema + 多组件并存」的现实:

**裂缝 1:`code` 字段位置硬编码。** checkout/commit 机制把「code 在组件顶层 `.code`」写死(codeAssetMiddleware.ts 的 `o.code` 读/写、createChatSdk.ts 的 `${wp}.code` 大文本摘要路径、子 agent prompt「value {type,name,code}」)。但低代码平台的组件结构是集成方自定义、schema 开放(`z.any()`),例如纯代码组件 `{id:'comp_code', name, style:{}, props:{html_code:''}}` —— code 在 `props.html_code`,且 key 名因集成而异(`code`/`html_code`/`html`)。硬编码导致 checkout 读不到、commit 写到错误的顶层 `code` 字段。

**裂缝 2:主 agent 编排提示词是空白。** createHtmlSubagent 只内置了「子 agent」提示词;「主 agent 编排」—— 职责边界(禁直接 write code)、逐个委派防上下文污染、路由(code 字段→use_html / 其他属性→主 agent 直接改)—— 全靠集成方手写 ~15 行,易漏「纯代码组件的非 code 属性仍由主 agent 改」这类路由。

## What Changes

两部分,均向后兼容:

### ① `codeField` 可配置(核心)

`CreateHtmlSubagentOptions.codeField?: string`(默认 `'code'`,支持嵌套 jsonPath 如 `'props.html_code'`,点号风格与 write jsonPath 一致)。四处硬编码改为按 codeField `getByPath`/`setByPath`。**「是否代码组件」判定统一为「codeField 路径下有 string」**,不再依赖 `type:'custom'`。开放 schema 下框架无法从 schema/散文推导,codeField 是与 `writablePaths` 同类的「每平台一次」机器可读声明,不随请求变。**装配/首轮命中校验**:codeAssetMiddleware.beforeAgent 扫描,全员未命中 string → onWarning 提示(含字段名,不阻断),把"填错路径"从静默失败变显式提示。

### ② 主 agent 编排自适应注入(有 html agent 委派 / 无 html agent 自己写;集成方零配置)

框架装配期自适应检测,注入对应编排(**集成方无需手写编排 systemPrompt**,框架替你判断):
- **有 html agent**(_codeAsset):注入「委派编排」(`htmlOrchestratorPrompt(id)`,动态 `use_<id>`)—— custom 的 code 字段主 agent【**不 read 不 write**】(read 只得 `<code Nkb>` 摘要看不懂没用、write 绕过 vfs/verify 危险),全权 `use_<id>` 维护;主 agent 只 read 组件元信息(name/type/props 非 code)→ 委派(task 写清)→ 收尾核对
- **无 html agent + schema 有 code/largeText 字段**:注入「自己写编排」(`systemPromptHelpers.htmlDirectWriteFallback`)—— custom code 主 agent 直接 write(普通字段,经 dataOps:schema/乐观锁/快照;**无 vfs/verify**)+ HTML 生成规范(标签闭合/自包含/安全底线);并装配期 warn 提示集成方(注册 html agent 走 code-as-data-asset / 或确认降级)
- **无 code 字段 + 无 html agent**:不注入(无关)

opt-out:`orchestratorPrompt:false`(createHtmlSubagent 委派段)。`htmlPageProposeFirst` 仍 opt-in(产品决策)。检测信号:html agent 有无(主)+ schema code/largeText 字段(辅;开放 schema `z.any()` 扫不到时仅靠 html agent 信号)。

## Impact

- **minor**:codeField 默认 `'code'`,现有用法零变化;编排自动注入对现有 demo 是「内容等价的少写」,行为零回归
- **新配置**:`CreateHtmlSubagentOptions.codeField` / `orchestratorPrompt`
- **新导出**:`systemPromptHelpers.htmlPageProposeFirst`(opt-in)
- **改动点**:`codeAssetMiddleware.ts`(checkout/commit 读写 codeField)+ `createChatSdk.ts`(大文本路径 + 装配注入编排段)+ `htmlSubagent.ts`(prompt 写 codeField + 编排常量 + `_codeAsset` 标记扩展)
- **文档**:README 中英文 + usage-guide + CLAUDE.md(子 agent 段 + 数据槽段)
- **demo**:html-page-demo 保持默认 codeField(演示零配置);开放 schema 集成说明进 usage-guide

## 决策

1. **codeField 单路径显式配置**(非 schema 标记推导):开放 schema 无精确节点可标记,显式 jsonPath 是唯一可靠信号。默认 `'code'` 保现状。
2. **「是否代码组件」= codeField 路径下有 string**:框架侧不需 `id:'comp_code'` 判别值(那是 agent scoping 用);text/button 无 code 字段自然跳过。
3. **编排提示词自动注入默认开 + opt-out**:通用编排知识默认带出;高级用户 `orchestratorPrompt:false` 关闭。
4. **「先出方案」不自动注入**:产品决策(先问 vs 直接生成),留 opt-in 片段。
5. **__pgId 注入范围不变(暂不精简)**:仍注入所有 writablePaths 组件;开放 schema 下「写时判定是否代码组件」有首次新建空窗,非代码组件带无用 __pgId 的噪音留 deferred。
6. **编排段同源化(自动注入与手动片段单一数据源)**:抽纯函数 `htmlOrchestratorPrompt(id)`(`use_${id}` 动态注入);`systemPromptHelpers.htmlPageOrchestrator`(已 staged)为其静态快照(`id='html'`)。避免两套文案漂移 —— 集成方自定义 `id`(如 `'hero'`)时,静态片段的写死 `use_html` 会误导主 agent 调不存在的工具,必须函数化注入。
7. **codeField 命中校验优先于运行时 agent 推断**:集成方填错 codeField 的痛点(静默失败)用「框架装配/首轮校验 + onWarning」解决,而非让主 agent 运行时推断/配置 codeField。后者既不可靠(LLM 推断托付给最关键搬运通道)、又破坏授权契约(writablePaths/codeField 是集成方静态授权边界,主 agent 运行时改 = 自我扩权)。校验零运行时开销、不引入不确定性。

## Non-goals

- 不内置服务端 backend / 版本管理 / 多人协作(code-as-data-asset 同边界)
- 不做 schema 标记自动推导 codeField(开放 schema 无节点可标)
- 不默认开启「先出方案」(产品决策,opt-in)
- 不改 __pgId 注入范围(留 deferred)
- 不做多 code 字段 / 多代码组件类型(单 codeField;复杂场景 deferred)
