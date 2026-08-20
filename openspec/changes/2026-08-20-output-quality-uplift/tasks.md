# Tasks(output-quality-uplift,按依赖序)

## 已完成(本批先行:3.35.0 门禁误报复盘修正)

- [x] 完结门禁陈旧 todos 豁免:循环条件加 `rounds > 0`(本轮零工具不触发;「计划了没做完」必在工具轮后;与 transitional rounds 分支同款模式)
- [x] e2e 3 断言(陈旧 todos 纯问答轮不触发/无回灌/无留痕)—— 843→846 计数同步见 Phase 4

## Phase 1:SDK 模型/思考分层

- [x] `CreateHtmlSubagentOptions.llm?: SubagentLlmConfig` + cfg 透传(链路已存在:`configToSubOpts` 的 `config.llm ?? main.llm`)
- [x] 实施 thinking-mode-lock Phase 1(按其 tasks.md):`applyThinkingMode` 纯函数 + `SubagentConfig.thinkingMode?` + `runSubagent` LLMConfig 分支改写 + 实例分支 warn/observable + `LLMConfig.thinking` anthropic 扩展 + `createHtmlSubagent` thinkingMode 透传 + 顶层 `subagent.thinkingMode?` 缺省 + types 同步
- [x] selftest:`applyThinkingMode`(simple 剥/deep 注/不 mutate/冲突覆盖/anthropic budget 默认与上限)+ `configToSubOpts` llm/thinkingMode 透传
- [x] e2e:子 thinkingMode simple/deep 构造期 extraBody 断言 + 实例路径 warn + 全局缺省继承 + `createHtmlSubagent({llm})` 独立模型生效(stub 构造拦截)

## Phase 2:可观测(轻量,不做 DebugDrawer UI)

- [x] `inspect().subagents` 反射 `{ id, thinkingMode?, thinkingApplied: 'applied'|'inherited'|'instance-noop' }` + e2e 断言
- [ ] 装配期冲突 warn(简化未做:deep 路径已保留显式子键,冲突面收敛,登记 deferred)(extraBody.thinking 与 thinkingMode 并存 → thinkingMode 胜出)

## Phase 3:editor_fangzhou(editor 仓库)

- [x] `prompt.js` AI_SYSTEM_PROMPT 增「页面质量标准」段(模块数下限/禁占位文案/视觉层次)
- [x] `config.js` 增 `htmlSubagent: { llm?, thinkingMode? }` 配置位(ai-llm.local.js 可覆盖;缺省零变化)
- [x] `AiAssistant.vue`:`createHtmlSubagent({ writablePaths, codeField, llm?, thinkingMode?, maxToolRounds: 16 })`
- [x] `page-exemplars` skill 骨架(条件注册:范例空不装)+ 范例文件 TODO 占位(**内容阻塞:待用户挑 2-3 个高质量专题**)

## Phase 4:文档 + 计数 + 门禁

- [x] usage-guide 中英(subagent 段补 llm/thinkingMode + 场景示例「主浅子深」);CLAUDE.md 子 agent 段;CHANGELOG [Unreleased];README 能力行
- [x] 计数同步(CLAUDE.md/README 中英文):selftest 2560→2573 / e2e 843→856(实测值)
- [ ] 三绿 + test:browser + exports/types/types-alignment/size;develop commit;询问是否发布(3.36.0)(build/selftest/e2e/exports/types/types-alignment/size 已绿;browser 100/101,complex-demo goto 超时系环境负载 flake,单 spec 复验中)

## Phase 5(后置,依赖用户)

- [ ] 用户填充范例内容(page-exemplars)→ 编排 prompt 加「建页前参照范例」引导
- [ ] 用户定网关 thinking 模型名(deepseek-v4 thinking 版/claude?)→ ai-llm.local.js 配 `htmlSubagent.llm` + `thinkingMode:'deep'`
- [ ] 真 LLM 对比复测:同 prompt 新旧配置的页面丰富度 + token/墙钟成本
