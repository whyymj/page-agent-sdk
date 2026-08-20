# Tasks(imperative-zero-tool-gate,按依赖序)

## Phase 1:纯函数 + 单元

- [ ] `detectActionImperative(text)`:操作动词白名单正则(**首子句动词锚定**)+ 只读动词反例前置且同位置锚定(看看/查/了解/说说/解释/总结/对比/**确认一下/核对**…) + 免操作词(不用改/只是问问/先别动/**不用写入**)
  - 正例基线:「把标题改成X」「加个横幅」「重新生成」「删掉第2个」「从头做一个专题页」
  - 反例基线(评审 1-8 扩):「这是啥组件」「看看这个配置」「总结一下刚才做了什么」「你好」「确认一下刚才改的标题对不对」「帮我优化这段文案直接发我,不用写入」「做个对比」
- [ ] `buildZeroToolFeedback()`:双出口文案(说明改动位置 / 继续执行 / 说明原因)+ 嵌入事实清单
- [ ] `buildTurnFactSheet(state)`:纯函数,从 state.messages 统计本轮事实 —— 工具调用按名计数(read×2, write×0…)/ 成功写入路径列表 / 失败回滚计数 / todos 完成度;零 LLM 调用
  - selftest:混合工具调用轮 → 清单计数正确;零工具轮 → write×0 + 路径空;清单文案要素齐全(计数/路径/失败/todos 四段)
- [ ] selftest(新 sec-NN):正反例判定 / 免操作词豁免 / 反馈文案要素齐全(含事实清单段)

## Phase 2:门禁接线(createAgent 循环条件层)

- [ ] 轮内写工具计数:**`writeCapable` 标注判定**(不硬编码名单)+ 委派工具(use_*/spawn_agent/spawn_agents)计等效写;计数在轮内工具结果收集处新增(现有 WRITE_TOOL_NAMES 只计失败,createAgent.ts:989-995)
- [ ] 门禁分支挂入 else-if 回灌链(与 transitional/narration/completion 同形态,createAgent.ts:898-918):①操作祈使 ②零写+零委派 ③纯文本收尾且句尾非问号(完结门禁句尾正则 todos.ts:84,**不带 rounds 前置** —— 谎报第 1 路恰发生在 rounds===0)→ 回灌(文案含 `buildTurnFactSheet` 事实清单);预算 ≤2 独立计数,超限放行 + emit `ZERO_TOOL_GATE_EXHAUSTED` observable
- [ ] 出口①机械化:回灌后收口文本含 jsonPath/组件 id 粗匹配模式 → 视为已说明,不二次回灌
- [ ] 豁免:句尾问号 / 本轮有写或委派调用 / 免操作词 / **intentGuard 命中本条用户消息时跳过**
- [ ] **装配期只装主栈**(createChatSdk,仿 intentGuard 装配过滤;子 agent 循环不跑本门禁)
- [ ] debugLogs 留痕 `stage:'zero_tool_gate'`(attempt/消息预览)

## Phase 3:e2e(stub 驱动真 ReAct)

- [ ] 祈使句 + 零工具纯文本收尾 → 回灌续跑(第 2 段响应做工具调用或逐项说明位置);断言回灌消息含事实清单段(工具计数 + 写入路径)
- [ ] 问句豁免(「这是啥组件」零工具收尾不触发)
- [ ] 写过后收尾不触发
- [ ] **委派过后收尾不触发**(use_html 调用后纯文本收口「已修改」,editor 主场景,评审 1-7)
- [ ] **intentGuard 命中的混合消息**(「这是什么组件?顺便改成橙色」守规只作答)→ 不回灌(评审 1-9)
- [ ] **子 agent 栈不装门禁**:html 子 agent 纯文本收口(`[note]`)零回灌(评审 1-6)
- [ ] 预算 ≤2:连续 3 次零工具收尾 → 第 3 次放行收口 + `ZERO_TOOL_GATE_EXHAUSTED` observable(评审 1-10)
- [ ] 与完结门禁共存:todos 未完成 + 零工具 → else-if 串行接力,各自计数不串;rounds===0 零 todos 谎报路径可达

## Phase 4:文档 + 计数 + 验收

- [ ] CLAUDE.md 规划与任务锚定段增条目;CHANGELOG [Unreleased];计数同步
- [ ] editor 实测:刷新丢数据后「重新生成」(C-14)—— resumeNotice + 本门禁双保险,agent 先核实再执行
- [ ] 三绿(`npm test && npm run build && npm run test:e2e`)
