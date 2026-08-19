# Tasks(instruction-adherence,规划立项,未实施;按依赖序)

## Phase 1:完结门禁(A)

- [ ] `todos.ts` 导出 `detectIncompleteFinish(todos, finalContent)` 纯函数(空/全 completed/问句收尾 → false)+ selftest(`✓ 完结门禁判定 → todos 有未完成项返 true` / `✓ 完结门禁判定 → todos 为空恒 false` / `✓ 完结门禁判定 → 全 completed 返 false` / `✓ 完结门禁豁免 → 收尾文本以问号结尾返 false`)
- [ ] `todos.ts` 导出 `buildGateFeedback(todos)`(列未完成项 id+content,单项截断 60 字防超长;文案含「已完成→update_todo 标记 / 未完成→继续执行」双出口)+ selftest(`✓ 门禁回灌文案 → 含未完成项 id 与双出口指引`)
- [ ] `createAgent.ts` 循环接入:`!response.toolCalls.length` 分支 transitional 判定之后新增门禁分支(独立 `gateRetries` ≤2 + `pendingFormatRetry=true` 绕 rounds 预算 + `log('middleware', {stage:'completion_gate'})` + HumanMessage 回灌);前置 `!garbled`;顺序在 transitional 之后(过渡叙述优先)
- [ ] selftest 循环层(`✓ 完结门禁 → 门禁触发后回灌 HumanMessage 且 pendingFormatRetry 绕过 rounds 预算` / `✓ 完结门禁预算 → 连续 2 次仍收口则放行不强拦` —— 经 createAgent stub model 驱动)

## Phase 2:问句意图守卫(B)

- [ ] `intentGuard.ts`(新)`detectQuestionIntent(text)` 纯函数:D3 三档(句尾问号强信号 / 疑问词+吗呢中信号 / 查询词命中)+ selftest 正反例矩阵(正:「这是啥组件」「这个配置怎么用?」「为什么报错呢」「有哪些可用组件吗」;反:「设计一个活动页」「把标题改成干杯」「添加一个 banner」「调换 navbar 和 banner 顺序」)
- [ ] `createIntentGuardMiddleware()`:`augmentPrompt` 读 `state.messages` 最后一条 user 消息,命中返回 pin 段(文案含「先用 read/list/rag 查证作答」+「除非同条消息明确要求操作」逃生门),未命中 undefined;`log('middleware',{stage:'intent_guard'})` 留痕(命中时)
- [ ] `createChatSdk.ts` 默认装配 intentGuard,声明序入 pin 段组(mission 之后,workingMemory/focus 之前);**`createAgent.ts` 的 `PIN_SEGMENT_NAMES` 白名单加入 `'intentGuard'`**(pin 资格 = 该白名单:超系统段预算 drop 时保 base + pin 段,守卫段永不裁);无 capabilities 开关(D5)
- [ ] selftest(`✓ 问句守卫 → 问句消息命中返回注入段` / `✓ 问句守卫边界 → 祈使消息返 undefined` / `✓ 问句守卫 → 多轮中最新 user 消息为操作指令时守卫自动失效`)

## Phase 3:e2e + 文档

- [ ] e2e(stub model 驱动真 ReAct,新增模块或并入现有):
  - `✓ 完结门禁 e2e → write_todos 2 项只做 1 项即收口 → 被回灌续跑,终态 todos 全 completed`(断言 messages 含门禁反馈 + debugLogs 有 completion_gate)
  - `✓ 完结门禁 e2e 边界 → 无 todos 会话正常收口零回灌`
  - `✓ 完结门禁 e2e 豁免 → 未完成但收尾问句征询用户 → 不拦`
  - `✓ 问句守卫 e2e → 发「这是啥组件」,stub 收到的 system 段含守卫文案`
  - `✓ 问句守卫 e2e 边界 → 发「把标题改成X」,system 段无守卫文案`
- [ ] types 检查:无新导出 API 则 d.ts 无改动;若导出纯函数走内部则不动 `types/index.d.ts`(判定:纯函数是否入主入口导出,默认不入)
- [ ] 文档:`doc/usage-guide.md`+`.en` 鲁棒性段补两机制说明;`CLAUDE.md`「规划与任务锚定」段补门禁一句 + 「对话鲁棒性」段补守卫一句;`CHANGELOG.md` [Unreleased] 加 Added 条目;`README.md`/`README.zh-CN.md` 能力行按需一句
- [ ] 计数同步:CLAUDE.md 与 README 中英文的 selftest/e2e 断言计数(实施后实测值)
- [ ] 三绿门禁:`npm test && npm run build && npm run test:e2e`(test:browser 本次不涉及 UI,可选跑)

## Phase 4(可选,后置)

- [ ] 真 LLM 复验(`npm run test:real uispec` 或 editor_fangzhou 手测):① 长对话问「这是啥组件」不再触发 use_html;② 多组件任务中途收口被门禁续跑;③ baseline-diff 确认 token 无显著回归(门禁回灌 ≤2 次的成本上界)
- [ ] 若实测出现误报干扰(守卫挡住合理操作 / 门禁逼复干已完成的活)→ 再立 capabilities 开关(D5 触发条件),登记 deferred.md

## 发布

- [ ] 随 3.35.0(连同 develop 已提交的 MCP 连接重试 3 次)统一发布;发布前询问用户
