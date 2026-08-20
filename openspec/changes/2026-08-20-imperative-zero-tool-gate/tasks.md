# Tasks(imperative-zero-tool-gate,按依赖序;已过怀疑论评审回改 + 事实清单 D5 并入)

## Phase 1:纯函数 + 单元 ✅(2026-08-21)

- [x] `detectActionImperative(text)` 落 `src/core/harness/actionGate.ts`:操作动词白名单(首子句 **16 字窗口**锚定 —— 12 字截掉「把 navbar 的标题改成」的动词,实测扩)+ 只读动词反例前置(看看/查/确认/总结/对比/检查…) + 免操作词 + **问句豁免**(「做好了吗」含操作动词但是状态询问 —— 实测修);正例基线 11 条/反例基线 12 条全过
- [x] `buildTurnFactSheet(usage, todos, isWriteTool)`:工具按名计数(写工具零调用强制补 `write×0` —— 滤零计数弱化对账,实测修)/ 成功写入路径(≤5 截断)/ 失败回灌数 / todos 完成度
- [x] `isZeroEffectiveWrite`:writeCapable 口径 + **委派工具(use_/spawn)计等效写**(editor 主场景防误伤);`buildZeroToolFeedback`(三出口 + 事实清单段);`mentionsLocation` 出口①机械化(jsonPath/组件 id/「路径」模式)
- [x] selftest(sec-95,31 项):正反例/零写判定/事实清单/出口①

## Phase 2:门禁接线(createAgent 循环条件层)✅(2026-08-21)

- [x] 轮内工具用量捕获(结果收集循环:按名计数/成功写路径 extractWriteTargetPath/失败数;条件写 eval_script 按保守口径计写)
- [x] 门禁分支挂完结门禁之后(else-if 链尾):三要素 AND → 回灌(文案含事实清单);**无 rounds 前置**(谎报第 1 路恰发生在 rounds===0);预算 ≤2 超限放行 + emit `ZERO_TOOL_GATE_EXHAUSTED` observable
- [x] 出口①机械化:收口文本含位置模式 → 不二次回灌
- [x] 豁免:句尾问号 / 只读动词 / 免操作词 / 本轮写过或委派过 / **子 agent 不装**(`CreateAgentOptions.__pgIsSubagent` + `state.__pgIsSubagent`,subagent.ts 建 child 时置 true;两处 state 重建均保持标记)
- [x] debugLogs 留痕 `stage:'zero_tool_gate'`(attempt/factSheet/content)
- [x] 实施期修:块注释内 `use_*/spawn_*` 的 `*/` **终止了块注释**(tsc Invalid character 二分定位);findLast 不在 lib 目标内改倒序循环

## Phase 3:e2e(stub 驱动真 ReAct)✅(2026-08-21,instruction-adherence 12 项)

- [x] 祈使句 + 零工具纯文本谎报「已完成」→ 回灌续跑(第 2 段做 write,第 3 段带位置说明收口);模型被调 3 次(无门禁 2 次);debugLogs 恰 1 次;事实清单含 write×0 + 「成功写入路径:无」
- [x] 问句豁免(「这个功能怎么用?」零工具收尾不触发)
- [x] 只读动词豁免(「看看现在有几个组件」)
- [x] 写过后收尾不触发
- [x] 收口含位置说明不二次回灌(出口①)
- [x] 预算 ≤2:连续 3 次谎报 → 第 3 次放行 + ZERO_TOOL_GATE_EXHAUSTED observable 恰 1 次;放行返回最终文本
- [x] 附带修复:resume-notice 用例第二轮被新门禁回灌干扰(stub『重新生成』轮回复无位置说明)→ 桩补位置说明,断言索引归位
- [ ] 委派豁免 e2e(需 subagent 场景;selftest isZeroEffectiveWrite 已覆盖 use_html/spawn_agents 判定,ReAct 级待 editor 真 LLM 验证)
- [ ] intentGuard 命中跳过 e2e(混合消息「这是什么组件?顺便改成橙色」守规只作答)—— 自查:当前实现读「最新一条 human 消息」整体判定,问号豁免已覆盖混合消息尾问号场景;intentGuard pin 注入与门禁回灌并存的极端序列留真 LLM 观察
- [ ] 子 agent 不装门禁 e2e(selftest 级经 __pgIsSubagent 标记断言已隐含;craftNotes [note] 收口实测待 editor)

## Phase 4:文档 + 计数 + 验收 ✅(2026-08-21)

- [x] CLAUDE.md 规划与任务锚定段增「零工具收尾门禁」条目;CHANGELOG [Unreleased] Added;计数同步(2685/899/102)
- [x] 三绿 2685/899/102 + browser 102 + exports 14 + types/alignment 0 错误
- [ ] editor 实测:刷新丢数据后「重新生成」(C-14)—— resumeNotice + 本门禁双保险,agent 先核实再执行(editor 升级后跑)
