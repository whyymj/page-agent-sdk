# host-integration-contract:宿主集成契约与页面问答可靠性

> **状态**:✅ 已实施(2026-09-18 随 4.18.0 发布;37/37 任务全勾〔含 2026-09-18 补的误伤率校准 0/12·门户真机复验·A10 基线〕;2026-09-19 归档前重跑 docs-qa 复核 4.22 头上零回归后归档,收尾注记见 tasks.md 尾部)。
> 本 change **不加新能力**,修的是**集成方视角**暴露的契约缺口与可靠性漏洞 —— 4.15~4.17 那条「宿主页面伴随」线只做了能力供给,没做集成契约与页面问答的可靠性闭环。

## 现状勘察证据(全部 file:line 定位)

| # | 事实 | 证据 |
|---|---|---|
| E1 | `buildSystemPrompt()` 每次模型调用**至少被调 2 次**(`toLC` + `replaceSystem`),另有两处(轮次耗尽提示 / 内省) | `createAgent.ts:541`(toLC)、`:568`(replaceSystem,每次 coreModelCall 前)、`:1275`、`:1377` |
| E2 | 对外的 `augmentPrompt` 契约没有「幂等」要求,但只有**最后一次**调用的输出随请求发出 | 同上;`buildSystemPrompt()` 返回值被 join 后进 `SystemMessage` |
| E3 | `MessageQuote` 只有文本与来源描述,**无页面位置信息** | `types/index.ts:87-92`(text / source?);捕获侧 `tools/quoteInput.ts` |
| E4 | `gateChain` 三层门禁全部面向**数据写**:操作祈使句×零数据写 / 数据现状询问×零工具 / evidence 对 `jsonPath` | `gateChain.ts:193-201`(zero-tool)、`:204-211`(status-query)、`:161`(evidence audit);判据 `detectActionImperative`/`isZeroEffectiveWrite`/`detectStatusQuery` |
| E5 | 读失效只由**数据写**驱动;**宿主导航/换文**导致读结果失效没有任何机制通道 | `readInvalidation.ts` 触发源 = `isSuccessfulWriteResult`(writeCapable);`EXCLUDED_WRITE_TOOLS` 亦只讨论数据 vs 非数据路径 |
| E6 | 产物:主包 **1283KB**、headless **750KB**(raw);`marked`/`highlight.js`/`dompurify` 打包进主包与宿主自带实例**重复** | `dist/page-agent-sdk.js` / `dist/page-agent-sdk.headless.js` 实测;`vite.config.ts` external 清单 |

## S1:augmentPrompt 幂等契约 + 轮内 memoize(P1,**实测踩坑**)

**现状**:集成方(学习门户)在 `augmentSystem` 里做「检测到用户切换文档 → 一次性注入『此前读取已失效,必须重读』警示」,逻辑**正确执行**(实测回调被调用、检测到切换、返回了警示串),但**警示不进请求** —— 因为第一次调用(`toLC`)把「一次性标志」消费掉了,真正发请求那次(`replaceSystem`,E1)看到状态已推进,返回空串。改为幂等(锚点只在整轮结束时经 `sdk.hook` 推进)后立刻生效。

**修法**:
1. **契约明示**:`Middleware.augmentPrompt` 的 d.ts JSDoc + `doc/system-prompt.md` 写明 —— 「同一轮内可能被调用多次,**必须幂等**(多次调用返回同一结果);禁止在其中推进状态/消费一次性标志;需要跨轮状态请在整轮结束(`afterAgent`/事件)推进」。`augmentSystem` 选项(集成方回调)同款说明。
2. **轮内 memoize**(可选但推荐):`buildSystemPrompt()` 以「轮」为粒度缓存 —— 轮首算一次,轮内复用;进入下一轮 / 工具结果写入后清缓存。收益:消除歧义 + 省掉每次模型调用的重复拼装(usageHints/skills 索引/schema 提取皆为纯重算)。风险 = 轮内会变的段(todos/workingMemory/memory)失去实时性 → **实现前须核实这些段是否只在轮间变化**(初判:工具执行后才变,而工具执行后即进入下一轮,故轮内稳定);若核实不成立则只做 ① 不动 ②。

**风险**:memoize 若粒度错(按 invoke 而非按轮)会拿到过期段 → 明确「按轮失效 + 工具结果写入后失效」两条清缓存路径,并加 selftest 锁行为。

## S2:宿主变更驱动的读失效(P1,能力缺口)

**现状**:E5 —— SDK 的 stale-read-invalidation 只认数据写;宿主导航(SPA 换文/路由切换/tab 切换)造成的「此前读的页面内容已过期」没有任何机制支持。集成方只能自己拼提示词兜(学习门户即用 `augmentSystem` 实现,属**提示词级**)。对「宿主页面伴随」这一整条产品线,这是必然遇到的缺口。

**修法**:新增宿主失效出口 —— `sdk.notifyHostChange({ reason?: string })`(或 `sdk.hostEpoch++` 语义):
- 调用后,SDK 把**页面读类工具结果**(`read_page` / `dom_search` / `dom_info` / `get_dom` / `take_screenshot` 的 ToolMessage)**替换为失效占位**,文案族复用 stale-read 既有口径(注明「宿主页面已变更,原读取结果已过期」,引导重读);
- 可选:向 system 注入一次性提示段(与 pin 段同规,幂等)。
- 幂等:已占位的不重复替换;宿主连续通知不产生叠加膨胀(占位本身是替换而非追加)。

**风险**:宿主滥用(每轮调用)→ 上下文被占位刷屏。缓解:出口为**显式 API**(宿主自知语义),占位替换而非追加(不涨 token),且只替换未失效的页面读类结果。

## S3:页面断言门禁(不猜测**机制化**,P1)

**现状**:E4 —— 三层门禁全是数据写场景。「页面对答」场景的头号失效模式(**编造页面内容**)零机制覆盖:回复声称「本页/原文/笔记里写了…」但本轮连 `read_page` 都没调,SDK 不会有任何反应。项目自身哲学是「纪律靠机制不靠提示词」(flash 实测反复验证),而这条线目前只有 page-analysis skill 的提示词 + 集成方 systemPrompt 在管。**实测**:学习门户给的是强提示词(「宁可少答,不要猜」),模型遵守得很好,但这是靠模型自觉,不是机制保证。

**修法**:在 `gateChain` 内新增一层(与三层同族、同文案风格、独立预算池):
- **三要素 AND**(宁漏勿误):① 回复含**页面指称词**(本页|原文|笔记|文档中|页面上|文中)② 本轮**零页面读工具**(`read_page`/`dom_search`/`dom_info`/`get_dom`;截图不算读文本,不计) ③ 非诚实未做/找不到声明(复用 `declaresNoAction` 口径,「本页没有提到」属正确行为,豁免)。
- 命中 → 回灌「先读页面再断言」+ **事实清单**(本轮工具调用,复用 `buildTurnFactSheet` 族) + 双出口。
- 预算 ≤2 独立池;超限 `PAGE_ASSERTION_GATE_EXHAUSTED` observable(对齐既有 EXHAUSTED 口径);子栈豁免。
- **装配范围(2026-09-17 用户拍板,替代原「默认开无开关」)**:门禁**仅当 `capabilities.domInspect` 开启时装配**。理由见下方「数据槽误伤路径」—— 不新增配置项(符合「不出让用户疑惑的配置项」取向),误伤面从设计上消除,且与「页面」语义严格对齐:不做页面问答的集成方(domInspect 默认关)根本不进这条判定。
  - **数据槽误伤路径(原提案的真实缺陷)**:数据槽集成方的 agent 说「**页面上**的标题已改成红色」时 —— `write` **不是**页面读工具 → 三要素命中 → 会被误回灌「先读页面再断言」;而它明明刚写完数据、正在描述结果。domInspect 装配条件把这条路从结构上切断。

**风险**:误伤 —— 用户在闲聊时提到「笔记」等词且模型正常作答 → 三要素②兜住(闲聊轮通常零工具,会误伤)。**缓解**:判据收紧到「回复中出现**对页面内容的断言句式**」(如「本页/原文 + 写了/提到/说明/在…节」),并在实施期用真 LLM 回归校准误伤率;精度优先,宁漏勿误。

## S4:引用 DOM 锚点(选段提问的核心缺口,P2)

**现状**:E3 —— 引用只带文本,agent 拿到「选中的那段」却**不知道它在页面哪里**,只能 `dom_search(mode:'text')` 按关键词盲搜。实测(学习门户):agent 能在 22s 内自己定位到「这段是 0.1 小节的总起句」并答对,但这是**多一步、且关键词重复时可能定位偏**。对「选段提问」这一主场景,位置的确定性应该由捕获侧提供。

**修法**:捕获时(`quoteInput.ts`)一并记录 DOM 锚点,随 `MessageQuote` 传递:
- `anchor?: { selector?: string; blockIndex?: number; offset?: number; headingId?: string }` —— 选区起始块级祖先的可定位描述(宿主可覆盖生成函数)+ 块内字符偏移 + 最近在前的标题(现有 `findNearestHeading` 已算);
- toLC 注入引用块时,把锚点作为**元信息行**附上(如 `[位置: #content > section:nth-child(2) > p:nth-child(3) · 小节「0.1 单页学习门户」]`),agent 可直接 `read_page({ selector })` 读该区域;
- 宿主 API `sdk.setQuote(text, source?, anchor?)` 扩展(可选参,向后兼容);`captureSelectionQuote` 返回值同步扩展。
- 无锚点(宿主自建引用/跨文档失效)时退化到现状(纯文本),零行为回归。

**风险**:锚点 selector 依赖宿主 DOM 结构稳定性(换文重渲染后可能失效)→ 元信息行只作**提示**(读失败仍可回退 dom_search),不作硬约束;文档明示「锚点是提示不是保证」。

## S5:段序与回调契约文档化(P2)

**现状**:system 段序由 `composeMiddlewareStack` 的 **priority** 决定,与创建时的数组声明序**不一致**(实测:`pageContext` 段落在 skills 索引**之后**,与声明序相反);`augmentSystem` 段的插入位置(在 subagents 之后、用户中间件之前)也未在对外文档明示 → 集成方无法预期自己的段在哪、与谁相邻。

**修法**:`doc/system-prompt.md` B 段补「段序由 priority 决定(非声明序)+ 各段默认位置表 + augmentSystem 段位置」;`augmentSystem` 的 d.ts JSDoc 同步(含 S1 的幂等要求)。

## 设计决策点

- **D1 修法取舍:契约+文档 vs 只改实现** —— S1 先做契约与文档(零行为面),memoize 作为可选优化在核实轮内稳定性后再做;不为了「顺手优化」引入时序风险。
- **D2 宿主失效出口形态:`notifyHostChange()` 方法 vs `hostEpoch` 属性** —— 倾向**方法**(可带 reason、语义自解释;epoch 形态要求集成方理解自增语义)。二者取一,实施期定。
- **D3 页面断言门禁判据宽度与装配范围** —— 判据取「页面断言句式 × 本轮零页面依据(含截图)× 非诚实声明」三要素;**装配范围 = 仅 `capabilities.domInspect` 开启时**(2026-09-17 用户拍板,替代原「默认开无开关」,理由:切断数据槽场景的误伤路径,且不新增配置项)。实施期仍以真 LLM 回归校准;宁漏勿误。
- **D4 引用锚点是否强制** —— **不强制**:锚点是**提示**;捕获不到时退回纯文本(向后兼容,宿主自建引用不受影响)。

## 范围红线(不做)

- **不做服务端代理/密钥托管**:保持「浏览器直连集成方端点」的既有形态(SDK 不管凭据)。
- **不做 RAG/向量检索/跨文档语料问答**:引用锚点只解决「这一段的定位」,不做语料级检索。
- **不改 stale-read 的数据写语义**:S2 是**新增触发源**,不是改既有判定(数据写失效行为零变化)。
- **不做标注持久化**(宿主重渲染后重放 DOM 标注):那是宿主的锚点重放问题(见不立项项)。

## 不立项项 / 暂缓

| 项 | 处置 | 理由 |
|---|---|---|
| 体积与 markdown 依赖去重(主包 1283KB / headless 750KB;`marked`+`highlight.js`+`dompurify` 与宿主重复) | **暂缓**(登记 deferred) | 涉及 UI 渲染链重构 + 破坏性(现有 import 面);静态站场景可先靠懒加载缓解(学习门户实测:首屏主 chunk 187KB 不变,SDK 以 643KB gzip 懒加载 chunk 按需下载)。**重启触发**:第二个静态站集成方提出体积硬指标 |
| 截图工具对纯文本模型的静默不装 | 不立项 | 已知设计(warn 留痕 + 条件注入),非缺陷 |
| `read_page` 默认 limit 偏小(4000 字符)对长文多轮 | 不立项 | 工具支持到 20000,属集成方/提示词调度范畴 |

## 二次评阅补充(2026-09-17 立项当日;含一处**升级为真 bug**的发现)

### A1 · S1 升级:同族缺陷已伤及 SDK 自身(token 预算提示**从未送达模型**)

**代码级核实**:
- 每轮**恰好两次** `buildSystemPrompt()`:`:903 toLC`(#1)与 `:966 replaceSystem`(#2);**#2 的输出才随请求发出**(#1 在 :966 被整体替换,`:966` 紧接 `runBeforeModel` 之后、模型调用之前)。
- 推论:任何「在 augmentPrompt 内消费一次性标志」的段,内容**永远进不了模型**(不是偶发,是必现)。
- **受害者不止集成方**:`usageHints.ts:132` 的 C1 token 预算提示写成 `if (!p.budgetHinted) { p.budgetHinted = true; push(⏳ 预算提示…) }` —— #1 消费标志,#2 见 `budgetHinted=true` 直接跳过 → **该提示从未进入任何请求**。
- **同族症状此前已被记录但未溯到根因**:`usageHints.ts:123-125`(2026-08-22 editor 诊断:「token 触发消耗掉唯一一次 budgetHinted 机会,轮次维度反被饿死从未注入」);当时的修法把**轮次维度**移出一次性机制(`extra` 参数),**token 维度仍留隐患** —— 本次定位到共同根因 = augmentPrompt 每轮被调多次且只有最后一次生效。

**修法(优先级高于原 S1 的文档项)**:
1. **修 bug 优先**:token 预算提示改幂等形态 —— 把 `budgetHinted: boolean` 改为「已提示到的轮次」并**持续注入 N 轮**(对齐轮次维度 3.43 的「持续注入 + 两档升级」既有设计),彻底摆脱一次性消费;并加 e2e 锁「达到阈值后,实际请求体的 system 里**确实**出现该提示」(现状缺陷的回归锁)。
2. 契约与文档(原 S1 任务 1–3)照旧。
3. **memoize 核实结论 = 按轮安全,可做**:`rounds++` / `progress.rounds` 在 `:1237-1238` 推进(工具执行后、进入下一轮前),而模型调用在本轮早段 → **轮内 `rounds`/`progress` 恒定**;轮内唯一可变的是 `p.budgetHinted`(本段自身写入),memoize 后反而消除二次调用歧义。**前提**:两条清缓存路径(工具结果写入后 / 进入下一轮)必须落实 + selftest 锁「轮内多次调用结果一致、跨轮刷新」。

### A2 · S3 判据修正:**截图必须计为「已看过页面」**

原判据把 `take_screenshot` 排除在页面读工具外 → 「截图看表格后描述」类轮次会被误伤(模型确实看过页面)。**修正**:「页面依据」= `read_page` / `dom_search` / `dom_info` / `get_dom` / **`take_screenshot`** 任一;门禁只在**完全零页面依据**时触发。

### A3 · S4 锚点补两项

- **块内出现序号(`occurrence`)**:同一块内重复短语时仅靠 `offset` 可能对不齐 → 定位用「文本 + 前后文 + 序号」三级回退(与宿主侧标注锚定同构)。
- **文档归属(`docId`)**:锚点携带宿主文档标识(如门户 URL hash 的 doc 参数),toLC 注入时与引用来源比对,不一致则元信息行标「⚠ 锚点属于另一文档」——与 S2 互补:S2 防「用旧的读结果」,A3 防「用旧的锚点」。

### A4 · S2 与 S3 的交互(预算不互抢)

换文后若模型既断言页面内容又零读工具,两条机制可能同轮介入。**约定**:S2 是**静默替换**(占位替换,不占回灌预算);S3 是**回灌**(独立池)。S3 判据看「本轮是否调用过页面依据工具」,而 S2 的占位**不改变工具调用计数** → 二者不互相掩盖,也无需共享预算。**此交互须在 e2e 显式断言**。

### A5 · 文档落点补一处:**集成方 skill**

`skills/page-agent-sdk-integrate`(随 npm 包分发)必须加坑位条目:「`augmentSystem` 回调**必须幂等** —— 同一轮内会被调用多次,只有最后一次输出随请求发出;需要跨轮状态请在整轮结束(`sdk.hook` 的 `done`/`message_update`)推进」。集成方最可能从 skill 入手,只写 d.ts/doc 会漏掉这条最关键的路径。

### A6 · S3 的**降级判据**(实施期硬性)

真 LLM 校准后若**误伤率 > 10%**(**在 domInspect 装配范围内**的正常问答轮被回灌)= 判据仍不可用 → **第二级兜底**:再降级为 opt-in(`capabilities.pageAssertionGate`,默认关),并在 CHANGELOG 明示;不得为达标而放宽到「宁误勿漏」(与项目精度优先原则一致)。注意:第一级已由装配范围(仅 domInspect)承担,故此处只针对页面问答场景自身的误伤。

### A7 · 考察后**否决**的补充项

- **notifyHostChange 顺带清 workingMemory**:**否决**。`workingMemory` 捕获的是 **read/query/search 的数据 path**(见 `workingMemory.ts:9/12/40` 注释),宿主页面问答场景(dataOps 关闭)下恒为空;数据槽场景下宿主换文不影响数据 path 有效性。纳入只会混淆机制语义 → **不进范围**(在此留痕以免实施期重复讨论)。

## 二次评阅补充(续):A8–A10(2026-09-17 立项当日,第三轮勘察)

### A8 · 能力门控**漏网三处**(明确缺陷:「勿教不存在的工具」纪律的同族遗漏,P2)

4.16/4.17 已为 `take_screenshot`/`domEdit` 做了「未装配不教」的变体门控,但**同一纪律有三条漏网**(全部无条件输出):

| # | 位置 | 文案 | 问题 |
|---|---|---|---|
| 1 | `domTool.ts:570`(page-analysis skill 探索纪律第 4 条) | 「**大结果在外存**:超大结果被移入 vfs 后用 `vfs_read`/`vfs_grep` 按需取」 | `capabilities.vfs: false` 时这两个工具**不在池**,skill 仍教 |
| 2 | `domTool.ts:533/534`(dom-inspect skill 排障套路第 3 步) | 「不符则**改数据**(get_dom 看结构对照)」 | `dataOps: false`(文档站是主场景)时**没有 write 工具**,skill 仍教 |
| 3 | `usageHints.ts:81`(domInspect 提示行末) | 「配合宿主 actions(save_draft/publish 等)形成「**改数据**→截图/get_dom 看渲染→触发动作」闭环」 | `dataOps: false` / 未配 actions 时,闭环的前两环是幻影 |

**修法与既有一致**:三个工厂/hint 补能力参数(`withVfs` / `withDataOps` / `hasActions`,与 `withScreenshot`/`withDomEdit` 同构),装配侧按 `caps` 传;selftest 加锁「vfs 关 → 不出现 vfs_read;dataOps 关 → 不出现『改数据』」。**学习门户(dataOps:false)正是踩中者**:agent 被教了不存在的 write。

### A9 · 可观测性补面(P2,与既有计数器同族)

- **gate 统计不可读**:`inspect()` 现有 `staleReadsInvalidated` / `llmRetries` / `llmCallFailures`(`createChatSdk.ts:1823-1825`),但**四层门禁**(transitional/completion/zeroTool/statusQuery,加本 change 的 pageAssertion)的回灌次数与 EXHAUSTED 次数**只能从 debugLogs/onEvent 看**。→ 建议 `inspect().gates: { [gate]: { retries, exhausted } }`,与既有计数器同规。
- **被 drop 的 system 段不可读**:`createAgent.ts:534` 段超预算被 drop 时**仅 `console.warn`** → 集成方的 `augmentSystem`/`pageContext` 段被丢掉时**零可观察面**(只能靠翻控制台)。→ 建议 `inspect().systemSegments: Array<{ name; tokens; dropped }>`(或至少暴露 dropped 名单)。

### A10 · 真 LLM 基线补「页面问答」场景(工程,与 A8/A9 同批)

4.15–4.17 整条「宿主页面伴随」线(page-quote / read_page / take_screenshot / dom_edit)**未进入真 LLM 回归套件**;现有 `tests/runtime/*` 无 docs-demo 页面问答场景,而基线本身已落后多版。→ 建议把 **docs-demo 页面问答**(划词引用 → `read_page` → 带出处作答;含「不猜测」断言)**纳入 uispec 套件或独立 `docs-qa` 套件**,作为这条线的真 LLM 回归面,顺带刷新基线。**理由**:本 change 的 S3 门禁与 S4 锚点都改变页面问答的模型行为,没有真 LLM 面等于无回归保护。

### 宿主侧遗留(门户,非 SDK 范围)

- **「问 AI」在文档装载期应禁用**(现状仅在 `planned` 时禁用):SPA 换文是异步 `fetch` + 重渲染,装载窗口内 `read_page` 可能读到**装载占位**或**上一篇残留**内容 → 回答依据错误。建议 `openDocument` 装载期置 `disabled`,完成/失败后恢复;可随 Phase 5 真机复验一并处理。

## 验收门禁(补充)

- selftest:新增 sec-NN(S1 幂等契约锁 + S2 通知失效 + S3 门禁三要素矩阵 + S4 锚点纯函数往返);计数同步三方对账。
- e2e:新增 `host-integration.mjs`(notifyHostChange 替换读结果 / 门禁回灌与豁免 / setQuote 带锚点入 toLC 前缀 / 幂等契约回归)。
- 真 LLM 复验(**必须**):以学习门户(`Obsidian/learning`)为宿主跑三场景 —— ① 切文档后再问,agent 重读新文档(不回退旧文)② 页面断言在零读工具轮被拦 ③ 带锚点引用直达目标段落;并做**误伤率校准**(正常问答轮不被门禁回灌)。
- 门禁全绿:build / test / test:e2e / test:browser / exports / types 三连 / size / check-test-counts / pack 无泄漏。
