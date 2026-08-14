# Specification Delta: page-agent-core

> 本文件为 change `html-subagent-open-schema` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。归档时合入主 specs。2 个 Requirement(codeField 可配置 / 编排提示词自动注入)。**minor**(向后兼容)。

## Requirement: createHtmlSubagent 可配置 code 字段(codeField)

createHtmlSubagent 的 code-as-data-asset 机制(code 字段位置)由硬编码 `.code` 改为可配置 `codeField`(相对组件的 jsonPath,默认 `'code'`,支持嵌套如 `'props.html_code'`)。适配开放 schema / 多组件低代码平台:代码组件结构集成方自定义,code 字段位置与 key 名不固定。「是否代码组件」判定 = codeField 路径下有 string。

- **codeField 默认 `'code'`**:现有用法零变化。
- **四处适配**:checkout 读 / commit 写(codeAssetMiddleware,getByPath/setByPath)/ 大文本摘要路径(createChatSdk,`${wp}.${codeField}`)/ 子 agent prompt「新建组件」写法(动态引用 codeField)。
- **开放 schema 适配**:非代码组件(text/button)无 codeField 路径 → checkout/commit 自然跳过,零判别配置;`id:'comp_code'` 等判别值仅 agent scoping 用,框架不需。
- **可测约束**:① codeField=`'props.html_code'` → checkout 把 data 该路径 string 检出到 vfs;② commit 把 touched vfs 回写到该路径(非顶层 code);③ 非代码组件(无该路径)跳过;④ codeField 默认 `'code'` → 与现有行为一致(零回归);⑤ 嵌套 codeField → 主 scope read 见 `<code Nkb>` 摘要(largeTextPaths 嵌套点号路径 `wp.props.html_code` 生效);⑥ **命中校验**:组件数>0 且 codeField 路径全员未命中 string → 触发 onWarning(含 codeField 值 + 组件实际字段名,不阻断 checkout);部分命中或无组件 → 不 warning。

## Requirement: 主 agent 编排自适应注入(有 html agent 委派 / 无 html agent 自己写)

createChatSdk 装配期自适应检测,注入对应编排(**集成方零配置**,无需手写编排 systemPrompt,框架替你判断):
- **有 html agent**(_codeAsset):注入「委派编排」(htmlOrchestratorPrompt(id))—— custom code 主 agent【不 read 不 write】,全权 use_<id>
- **无 html agent + schema 有 code/largeText 字段**:注入「自己写编排」(htmlDirectWriteFallback)—— custom code 主 agent 直接 write(普通字段)+ HTML 生成规范;装配期 warn 提示
- **无 code 字段 + 无 html agent**:不注入

- **委派编排内容**(有 agent):职责边界(custom code **不 read 不 write**,全权 use_<id>)/ 逐个委派防污染 / 修改排查 / 路由(code→use_<id>;其他→主 agent)
- **自己写编排内容**(无 agent):code 直接 write(普通字段,经 dataOps)/ HTML 生成规范(标签闭合/自包含/安全底线)/ 权衡提示(无 vfs/verify;注册 agent 走 code-as-data-asset)
- **工具名动态**(委派):use_<id>(非写死 use_html)
- **opt-out**:createHtmlSubagent({ orchestratorPrompt:false })不注入委派段(高级用户自定义)
- **可测约束**:① 有 html agent → 主 systemPrompt 含委派编排(职责边界"不 read 不 write" + use_<id>);② 无 html agent + 有 code 字段 → 含自己写编排(htmlDirectWriteFallback)+ warn 触发;③ 无 html agent + 无 code 字段 → 不注入;④ orchestratorPrompt:false → 不注入委派;⑤ 自定义 id → 委派段含 use_hero;⑥ 委派段与 htmlPageOrchestrator 同源(静态快照)
