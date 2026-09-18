# Tasks:host-integration-contract(宿主集成契约与页面问答可靠性)

> 打勾标准:代码/文档落地 + 对应测试绿 + 计数同步。
> 批次:**Phase 0 修 bug(A1,最高优先)** → Phase 1 S1 契约 → Phase 2 S2 宿主失效 → Phase 3 S3 门禁 → Phase 4 S4 锚点 → Phase 5 收尾。
> 每批可独立验收;Phase 3 依赖真 LLM 校准,排最后。二次评阅项(A1–A7)已并入对应批次。

## Phase 0:S1 真 bug 修复(A1,先修 —— SDK 自身受害)

- [x] 1. `usageHints` 的 token 预算提示改**幂等**形态 ✅ 2026-09-18(57249d3):实现为**纯函数 `tokenBudgetHintText`**(轮内幂等 + 跨轮持续注入 + 半程/85% 两档升级)—— 比「已提示到的轮次」形态更简(零状态零消费,一次性吞标志从结构上死掉);`budgetHinted` 转 optional + @deprecated(公共面纪律 @deprecated 窗口,下个 major 移除;required→optional = 放宽 = patch 级),双 d.ts 同步
- [x] 2. e2e 回归锁 ✅ context-economy.mjs(+4):实际请求体 system 断言(600≥500 提醒档 → 1300≥85% 告急档;修前 sys[2] 一次性标志已消费必红)+ 历史零残留
- [x] 3. selftest ✅ sec-76(+8 / 翻转 1):轮内幂等逐字节一致(翻转原「每任务一次」断言)+ tokenBudgetHintText 白盒(0.5/0.85 边界/Infinity/0/K 下限)

## Phase 1:S1 契约与文档(零行为面)

- [x] 4. d.ts JSDoc 幂等契约 ✅ 双 d.ts:`Middleware.augmentPrompt` + `ChatSdkOptions.augmentSystem`(同轮多次调用/仅随请求那次生效/禁推进状态/跨轮状态轮末推进 + 实测踩坑一句)
- [x] 5. `doc/system-prompt.md` §5④ + usage-guide 中英 ✅(zh 接例子 2、en 接 §7 middleware 段,含失败案例与正确做法)
- [x] 6. **`skills/page-agent-sdk-integrate`** 坑位条目 ✅ Common pitfalls 首条(含 `sdk.hook` done/message_update 推进锚点的完整正确示例)
- [x] 7. selftest 契约可测部分 ✅ sec-76 幂等断言(同 state 多次调用逐字节一致)
- [x] 8. `buildSystemPrompt()` 按轮 memoize ✅ **考察后按退回条款处置(否决留痕)**:实施中发现 ① `inspect().systemPrompt` 是宿主侧**实时视图契约**(setData/applySnapshot 后须反映新 state,dynamic-register/session-integrity 既有绿测定义;加缓存后 5 测红)与跨轮缓存直接冲突;② 请求路径本就**每轮单次拼装**(toLC 每 invoke 一次 + replaceSystem 每轮一次),循环顶失效使缓存命中率趋零,memoize 无实际收益。→ 按 task 8 自带退回条款只做 4–7;代码内留否决注记(createAgent.ts buildSystemPrompt JSDoc),e2e 改锁正向契约(systemprompt.mjs +3:每轮重渲染进请求 / 轮中内省实时视图 / 收口后内省反映末轮状态)

## Phase 2:S2 宿主变更驱动的读失效

- [x] 9. `sdk.notifyHostChange({ reason? })` 出口 ✅ AgentCore + ChatSdk 公开面 + headless 同享(_createChatSdk 工厂单源);幂等(占位是替换不叠加,reason 去重封顶 5)
- [x] 10. 失效实现 ✅ `invalidatePageReads` 纯函数(readInvalidation.ts,复用占位标记/幂等/配对 walk 口径;**新增触发源零改数据写判定**)—— 流内经 hostNotice 中间件 wrapModelCall 原地替换(req.messages 与主循环 currentMessages 同引用);时序由 epoch 水位把守(通知后的新读不受影响;跨 invoke 工具结果本就不重发,提示段承担)
- [x] 11. system 一次性提示段 ✅ hostNotice pin 段(PIN_SEGMENT_NAMES 已加,跨压缩):贯穿消费 invoke 各轮、afterAgent 清除(resumeNotice 同款,S1 幂等契约合法形态);domInspect 未开时不点名 read_page(A8「勿教」纪律)
- [x] 12. selftest ✅ sec-129(+30):五工具全量占位/reason 进文案/scope 隔离(数据读写不动)/幂等二次零替换/纯函数原数组不改/id 缺失按序兜底/空输入/PAGE_READ_TOOLS 常量
- [x] 13. e2e `host-integration.mjs` ✅(+15):流内失效(末轮请求 read_page 成占位含 reason)/ 提示段一次性(下一 invoke 注入 + afterAgent 清除 + 再下一 invoke 不残留)/ 空闲通知零占位(时序水位)/ inspect().hostReadsInvalidated 反射 / debugLogs 双留痕
- [x] 14. **A4 交互断言(前半)** ✅ 占位零额外模型调用 + 零回灌 HumanMessage 注入(S2 静默替换不占回灌预算);**后半(S3 判据不被掩盖)随 Phase 3 落地后在其 e2e 补**(门禁不存在时无从断言)
- [x] 15. d.ts(双,AgentInfo.hostReadsInvalidated + ChatSdk.notifyHostChange)+ types-alignment ✅ 绿;usage-guide 中英 6.20 段补「宿主导航/换文后请调用 notifyHostChange」

## Phase 3:S3 页面断言门禁(不猜测机制化)

- [x] 16. `actionGate.ts` 纯函数族 ✅ detectPageAssertion(**子句级共现**:页面指称 × 断言句式,agent 自述动作子句排除「已把文档标题改成“说明”」不误伤)+ isZeroPageBasis(PAGE_READ_TOOLS 口径,含 take_screenshot;数据 read 不算)+ buildPageAssertionFeedback(先读再断言 + 事实清单 + 双出口)
- [x] 17. gateChain 4.5 层 ✅ 三要素 AND + 独立预算池 pageAssertionRetries ≤2 + PAGE_ASSERTION_GATE_EXHAUSTED observable(5.5 层,诚实不存在声明豁免不误报)+ 子栈豁免 + 问号收尾豁免 + debugLogs stage 'page_assertion_gate'
- [x] 17b. 装配范围 ✅ `createAgent({ pageAssertionGate: caps.domInspect === true })`(CreateAgentOptions 新可选字段,双 d.ts 同步);**「装了/没装」反射 = Phase 4b 的 `inspect().gates`(gates 计数器按装配面出现 pageAssertion 键)—— 原「inspect().middleware」表述不可行(门禁在 gateChain 非 middleware 栈,塞假 middleware 条目是 hack),留痕改道**
- [x] 18. selftest ✅ sec-130(+37):正例 8 / 反例 9(agent 动作 3 + 不存在声明 3 + 无指称 + 无断言动词 + 无关)/ isZeroPageBasis 6(含 take_screenshot 计入、数据 read 不算)/ 触发与文案 / 要素缺一不触发 6 / **装配对照(同文本同用量仅 pageGate 不同)** / 预算独立 / EXHAUSTED / 耗尽后诚实声明不误报
- [x] 19. e2e ✅ host-integration.mjs(+9):回灌链(断言收口 → 回灌 → 改调 read_page → 读后作答)/ 诚实豁免 / 问号豁免 / domInspect 关装配对照 / **A4 后半**(S2 占位生效 + counts 不变 → S3 按原口径判「有依据」不回灌,职责不叠判据不掩盖)
- [x] 20. 真 LLM 误伤率校准 ✅ 2026-09-18 学习门户真机(deepseek-flash,本地 4.18 构建):**12/12 轮正常问答 0 误回灌(0.0%,A6 判据 <10%)** —— 含元问题/问句/总结/结构/不存在内容等最易误伤形态;门禁维持 domInspect 范围默认装配,无需降级 opt-in

## Phase 4:S4 引用 DOM 锚点

- [x] 21. `MessageQuote.anchor?`(A3)✅ types + 双 d.ts(QuoteAnchor:selector/blockIndex/offset/occurrence/heading/headingId/docId/pageUrl);captureSelectionQuote 捕获(findBlockAncestor 行内爬块级 + buildQuoteSelector id 优先/nth-of-type 链 ≤4 层 + measureQuoteOffset Range 精确/indexOf 降级 + occurrence 消歧 + findNearestHeadingEl 文本+id);宿主覆盖 = setQuote 第三参全量自定(归一 normalizeQuoteAnchor)。**实施注记**:heading 拆为 heading(文本,展示)+ headingId(id,跳转);docId 比对按字面「与引用来源比对」不可计算(source 是自由文本)→ 落地为 pageUrl(捕获时 URL,SDK 两侧可见)与当前 location.href 自动比对
- [x] 22. `sdk.setQuote(text, source?, anchor?)` ✅ AgentCore/ChatSdk 公开面/headless 三侧 + send 显式 quote 透传(SendOptions.quote 本就是 MessageQuote,anchor 随类型);不传零变化
- [x] 23. toLC 元信息行 ✅ `[位置: selector · 小节「heading」 · 文档:docId](偏移 N, 第 M 次出现)`;pageUrl 不一致标「⚠ 锚点属于另一文档」;无锚点逐字节现状
- [x] 24. selftest ✅ sec-131(+29):selector(id/转义/nth)/块级爬升/offset·occurrence(含「occurrence>1 只在 Range 精确路径生效」口径)/归一丢弃/appendQuoteContext 无锚点逐字节回归锁 + 元信息行 + docId/captureSelectionQuote 集成(字段齐/塌缩 null)
- [x] 25. e2e ✅ host-integration(+2):setQuote 带锚点 → 请求体引用块含元信息行;不带 → 与既有形态逐字节一致(JSON.stringify 全文比对)
- [x] 26. usage-guide 中英 ✅ 6.20 段「引用 DOM 锚点」(是提示不是保证 / 失效回退 dom_search / pageUrl 跨文档标警示 / setQuote 第三参);size 阈值 headless 760→780KB 重校(S2-S4 增量 ~7KB,双口径同步)

## Phase 4b:能力门控漏网 + 可观测性(A8/A9,可与 Phase 4 并行)

- [x] 33. **A8 三处门控** ✅ makePageAnalysisSkill 补 `withVfs`(外存条目整条条件化)/ makeDomInspectSkill 补 `withDataOps`(排障第 3 步:dataOps 关改「如实报告差异,页面为真值」)/ usageHints domInspect 行三态门控(双环 → 完整闭环;dataOps 在·无 actions → 半句看渲染;dataOps 关 → 闭环句剥除);装配侧传 useVfs/useDataOps/hasActions;sec-132(+9:三处 × 两态矩阵 + 双缺对照)
- [x] 34. **A9 可观测性** ✅ `inspect().gates`(stage → {retries, exhausted};**page_assertion_gate 键存在性 = S3 装配反射**;resetSessionCounters 一并清零;wrap-up 补跑路径同计数)+ `inspect().systemSegments`(buildSystemPrompt 快照段名/字节/dropped,补 :534 仅 console.warn 盲区);e2e 反射断言 +6;双 d.ts + CreateAgent 返回面 accessor + QuoteAnchor 导出(主/headless 双侧)对齐

## Phase 5:文档/计数/门禁收尾

- [x] 27. CLAUDE.md 契约段 ✅ 幂等契约入「职责分工」+ 宿主集成契约块(S2/S3/S4/A8/A9)+ 套件清单登记 docs-qa;README 中英特性(用法地图行 + 能力表 +3)✅
- [x] 28. CHANGELOG 4.18.0 条目 ✅ minor 定级 + 三处行为面明示(token 提示首次生效 / domInspect 范围装配 / EXHAUSTED observable)
- [x] 29. 计数同步 ✅ 3698/1201/165 + 模块数 128 + e2e 模块 35;check-test-counts 绿
- [x] 30. 全量门禁 ✅ build/selftest/e2e/browser/exports/types×4/size(阈值重校 780KB)/pack(25 文件无泄漏)
- [x] 31. openspec 收尾 ✅ changes README 索引(状态 → 代码/文档/测试全落地);deferred 无新增(体积/markdown 去重已在册)
- [x] 32. **学习门户真机复验** ✅ 2026-09-18(deepseek-flash,本地 4.18 构装入门户):
  - ① 切文重读:notifyHostChange 留痕 ✓ → 下一轮 system 含【宿主页面已变更】✓ → agent 重读新文并答 B 文内容(「课时 12.1:AI Agent 概述」,非旧文)✓
  - ② 页面断言被拦:全新会话「不要调工具直接告诉我页面写了什么」→ page_assertion_gate 触发 1 次 → 模型改调 read_page×2 → 终答诚实(「这个我不能凭记忆答…一无所知」)✓
  - ③ 带锚点引用:选中段落 → chip 捕获 → 请求体含 `[位置: article#content > section > div > p · 小节「0.1 单页学习门户」](偏移 5)` ✓;agent 据引用定位到完整原句与小节 ✓(修 UI 捕获链丢 anchor 后)
  - 附:12 轮正常问答 0 误伤(见任务 20);零 pageerror
- [x] 32b. **宿主侧遗留** ✅ 门户改动(**不提交**,用户自行审阅):`src/app.js` 装载期禁用「问 AI」(fetch 前置 disabled,装载完成恢复 planned 态、失败也恢复)+ 切文时 `notifyHostChange('切换到《…》')` 接线;`src/assistant.js` 补 `notifyHostChange` 出口 + DEV 观察钩(`window.__pgAssistant`,生产剥除);SDK 本地构建经 `npm i --no-save` 装入(node_modules 级,package.json 未动)
- [x] 35. **A10 真 LLM 基线补页面问答** ✅ 独立 `docs-qa` 套件(`tests/runtime/docs-qa-real-llm.mjs`,注册统一入口 REGISTRY):4 场景 / 10 断言全绿(S1 锚点定向阅读 / S2 整页概括 / S3 诚实不猜测「通篇没有区块链」/ S4 notifyHostChange 重读);指标并入 `real-llm-baseline.json`(uispec/rag/parallel 旧段保留,全量刷新留待下轮)

## 实施期新发现(2026-09-18,按「修改中主动提出」约定单列)

- **F1(modelCaps 误拒官方 deepseek-flash)**:门户 .env 用官方 API `deepseek-flash`,SDK 能力表按 generic `/deepseek/i` 低估为 128K → 200K 硬地板误拒完全可用的模型。实测(官方 API):270K token prompt 200 OK + API 自报输出上限 [1,393216] → 确认 V4 档。修:modelCaps 增 `/deepseek-flash/` 条目(1M/393216,置于泛匹配前)+ sec-53 锁。
- **F2(mountChatDialog 三捕获点丢 anchor)**:S4 上线时 `show()`(:214)/`onSelectionQuote`(:108)/`onSetQuote`(:101)三处 UI 捕获链都只传 `core.setQuote(q.text, q.source)` 丢 `q.anchor` —— e2e 直调 setQuote 测不到 UI 链,browser 套件 docs-demo 无锚点用例(真机门户验证抓出)。修:三处补第三参 + browser docs-demo spec 增锚点锁(164→165)。
- **F3(验证脚本侧,非产品)**:真机场景②的前设修正 —— 会话内已有读据时模型「凭此前阅读」作答是有据且诚实的正确行为(门禁按设计不触发);测门禁须全新会话。门户 llm 配置无 contextWindow 声明属正常(修 F1 后按表正确解析)。

> **A7 否决留痕**:notifyHostChange **不**顺带清 workingMemory(其捕获的是 read/query/search 的**数据 path**,页面问答场景恒为空;纳入只会混淆语义)。
