# Design: html-subagent-open-schema

## 1. 现状:code 字段硬编码点

| 位置 | 现状 | 改为 |
|---|---|---|
| `codeAssetMiddleware.ts:118/120` checkout 读 | `o.code` | `getByPath(o, codeField)` |
| `codeAssetMiddleware.ts:205` commit 写 | `o.code = f.content` | `setByPath(o, codeField, f.content)` |
| `createChatSdk.ts:878` 大文本摘要路径 | `` `${wp}.code` `` | `` `${wp}.${codeField}` `` |
| `htmlSubagent.ts` 子 agent prompt「新建组件」 | ~~`value {type,name,code}`~~ | ✅ **已 staged 泛化**:改 `value:{...}` 按 schema 全字段写,无 `code` 字面量;agent 靠 schema hint 定位。**本 change 无需改此处** |

`getByPath` / `setByPath` 均已在 `jsonUtils.ts`(getByPath:26 / setByPath:38;点号路径读写,setByPath 中间段不存在惰性建对象,均带 `isUnsafePath` 原型污染防护)。codeAssetMiddleware 现已 import `getByPath`,**仅需补 import `setByPath`,无需新增纯函数**。

## 2. codeField 语义

- **jsonPath 相对组件**(与 write jsonPath 同点号风格,如 `'props.html_code'`),非绝对路径。
- **默认 `'code'`**:现有行为零变化。
- **嵌套**:`'props.html_code'` → `getByPath(comp, 'props.html_code')`。中间段(`props`)不存在 → checkout 读到 undefined → 跳过(该组件非代码组件);commit 时 `setByPath` 惰性建中间对象(此时组件必已有 props,因 checkout 曾读到过 code)。
- **「是否代码组件」= codeField 路径下有 string**:非代码组件(text/button)无该路径,checkout/commit 自然跳过,零判别配置。`id:'comp_code'` 等判别值仅 agent scoping 用,框架不需。

### 命中校验(防静默失败)

集成方填错 codeField(如写 `props.html_code` 实际是 `props.code`)→ checkout 静默读不到、子 agent 改了个寂寞,极难排查。解法**不是让 agent 推断**(见决策 7),而是**框架装配/首轮自动校验路径命中**:

- **时机**:codeAssetMiddleware.beforeAgent(checkout 扫 bind 时顺带统计,零额外开销)。
- **逻辑**:扫所有 writablePaths 组件的 codeField 路径;**组件数 > 0 且全员均未命中 string**(getByPath 非 string)→ 触发 onWarning。部分命中 / 无组件 → 不 warning(避免误报)。
- **输出**:`CodeAssetMiddlewareOptions` 加 `onWarning?: (msg: string) => void`;createChatSdk 装配时转发到 `emit({ type:'warn', ... })` + debugLog 留痕。文案:`codeField '<值>' 在当前 N 个组件中均未命中 string 值。组件实际字段:[<字段名>]。若预期有代码组件请核对路径;若当前确无代码组件可忽略。`
- **不阻断**:checkout 照常跳过(不抛错、不中断),仅提示。
- **为何优于 agent 推断**:零 LLM 不确定性、零额外运行时开销、不破坏授权契约;把"填错"从静默失败变装配期显式提示。

## 3. 编排提示词自动注入

### 装配点(自适应:有 agent 委派 / 无 agent 自己写)

`createChatSdk.ts` 装配期(`baseSystemPrompt = buildSystemPrompt(options)` / line 907 之后),三态自适应:
1. **有 html agent**(`codeAssetConfigs.length > 0`)且未 opt-out → `baseSystemPrompt += htmlOrchestratorPrompt(id)`(委派编排,动态 `use_<id>`;主 agent 不 read/write code)
2. **无 html agent + schema 有 code/largeText 字段** → `baseSystemPrompt += htmlDirectWriteFallback`(自己写编排)+ console.warn/debugLog(提示集成方:注册 agent 走 code-as-data-asset / 或确认降级)
3. **无 code 字段 + 无 html agent** → 不注入(无关)

检测信号:html agent 有无(主,`_codeAsset`)+ schema code/largeText 字段(辅;开放 schema `z.any()` 静态扫不到 code 字段名时,仅靠 html agent 信号判定 —— 无 agent 即"自己写"分支,有 code 字段则注入 + warn,无则不注入)。

### 标记扩展 + 同源化(关键设计)

`_codeAsset` 标记扩展加 `orchestratorPrompt?: string`。**同源化** —— 编排段抽成纯函数 `htmlOrchestratorPrompt(id: string)`(`use_${id}` 动态注入);`systemPromptHelpers.htmlPageOrchestrator`(已 staged)改为该函数的**静态快照** = `htmlOrchestratorPrompt('html')`。单一数据源,两者不漂移:

- `createHtmlSubagent({ id })` → `_codeAsset.orchestratorPrompt = htmlOrchestratorPrompt(id)`(含正确 `use_<id>`)
- `createChatSdk` 装配期(buildSystemPrompt / line 907 之后)读 `_codeAsset.orchestratorPrompt` → append 到 `baseSystemPrompt`
- `orchestratorPrompt: false`(opt-out)→ 不设字段 → 不注入;高级用户仍可手动 spread `systemPromptHelpers.htmlPageOrchestrator`(静态快照,id='html')

**为何不直接用字符串常量**:集成方 `id` 可自定义(如 `'hero'` → 工具名 `use_hero`);写死 `use_html` 的静态片段在自定义 id 时会误导主 agent 调不存在的工具。函数化注入是唯一正确解。

### 编排段内容(= 已 staged 的 htmlPageOrchestrator 5 条 + 动态 use_<id>)

`htmlOrchestratorPrompt(id)` 返回以下 5 条(`use_<id>` = `use_${id}`),与 `systemPromptHelpers.htmlPageOrchestrator` 逐字同源(后者 id 固定 `'html'`):

1. **【产物形态】** 每个组件是完整、自包含的 HTML 页面(含 style/script,可独立成页);主 agent 只负责委派和收尾,不关心宿主如何渲染。
2. **【主 agent 职责边界(硬规则)】** custom 的**代码字段**你【**不 read 不 write**】—— read 只得 `<code Nkb>` 摘要(看不懂细节,没用);write 绕过 vfs/verify(无格式校验,危险)。代码字段全权 `use_<id>` 维护。你只 read 组件**元信息**(name/type/style/props 非 code)→ 委派 → 收尾核对;代码生成/修改/排查必经 `use_<id>`。
3. **【多组件逐个委派(防上下文污染)】** write_todos 列出 → 每组件一次 `use_<id>`(勿一次委派多个,同子 agent 共享上下文致 class/样式冲突污染)→ read 核对 + update_todo 标完成 → 主题/风格每次 task 转述。
4. **【修改/排查类请求】** 先 read 定位目标组件,委派 `use_<id>`(task 写清改哪个组件 by name + 现象 + 期望)。
5. **【预算将尽暂停】** 接近轮次上限:完成手头后报告「已生成 K/N,还剩 M 个」,等用户确认继续。

### 与 codeField 协同

编排段的「代码字段」措辞取通用表述(「代码字段(见 data schema)」),不写死 codeField 值 —— 集成方 schema 已注入 schema hint,agent 可自行定位。避免编排段与 codeField 双重硬编码。

### 无 agent 分支:htmlDirectWriteFallback(自己写编排)

无 html agent 时,code-as-data-asset 机制不启用(无 `_codeAsset` → 无 codeAssetMiddleware/checkout-commit/verify),custom 的 code 是**普通 schema 字段**。框架自适应注入此段(集成方零配置):

- **code 直接 write**:custom 的 code 你直接 write(普通字段,经 dataOps:schema 校验 + 乐观锁 + 快照)。**不经 vfs**(vfs 工作副本是 html agent 专属,无 agent 不存在)
- **HTML 生成规范**:完整自包含页面(含 style/script,可独立成页)、标签闭合、style/script 集中放置、安全底线(禁 eval/new Function、不引外部脚本、不访问敏感 window 属性)
- **权衡提示**:无 verify 门禁(质量靠此规范 + 集成方渲染层);如需代码资产机制(vfs 工作副本 + 格式校验 + 增量 commit),注册 `createHtmlSubagent`
- 装配期 warn(检测到 code/largeText 字段但无 html agent):`console.warn` + debugLog,非阻断 —— 帮集成方发现遗漏(忘了注册)vs 确认降级(故意不要 agent)

## 4. 「先出方案」opt-in 片段

`systemPromptHelpers.htmlPageProposeFirst`(本次纳入):「新建/创意类先给 2~3 套方案问用户」+「方案切换」。**不自动注入**(产品决策,不同集成方偏好不同),集成方自行 spread。

## 5. 风险矩阵与回退

| 风险 | 概率 | 影响 | 回退 |
|---|---|---|---|
| codeField 嵌套 setByPath 惰性建对象误触 | 低 | commit 写错 | 单测锁 `props.html_code` 往返;复用 jsonUtils getByPath/setByPath |
| 编排自动注入改变现有 demo 行为 | 低 | 内容等价零回归 | 注入段与现有 demo 手写内容等价;e2e/browser 锁定 |
| 编排注入与用户自定义 systemPrompt 冲突 | 中 | 重复/矛盾 | opt-out `orchestratorPrompt:false`;只加通用规则不覆盖用户 |
| codeField 未命中(路径写错) | 中 | checkout 全跳过 | 文档 + 类型注释;接入时 read 自检 |
| largeTextPaths 嵌套(`wp.props.html_code`)消费者不识别点号 | 低 | 主 scope read 仍灌完整 code 进上下文 | A5 断言锁:嵌套 codeField → read 见 `<code Nkb>` 摘要 |
| 自动注入段与 htmlPageOrchestrator 手动片段漂移 | 中 | opt-out 用户 spread 到过时 `use_html` | 同源化:手动片段 = `htmlOrchestratorPrompt('html')` 静态快照,单一数据源 |
