# Proposal: output-quality-uplift(生成质量提升:子 agent 模型/思考分层 + 质量标准 + 范例)

> ✅ 已实施,随 **3.36.0** 发布(2026-08-20)。SDK:子 agent 独立 llm + thinkingMode 锁定;完结门禁陈旧 todos 豁免(rounds>0)。editor_fangzhou:质量标准 prompt + htmlSubagent 配置管线 + page-exemplars skill 骨架(范例内容阻塞,待用户挑专题)。selftest 2560→2573 / e2e 843→856。Phase 5(范例填充/thinking 模型名/真 LLM 对比)依赖用户,见 tasks.md。

## Why(用户诉求,2026-08-20)

「editor_fangzhou 生成的页面,无论主 agent 生成 JSON 还是子 agent 纯代码页面都太简单。子 agent 的思考深度能否适当放宽,而不是从快从简?」

诊断(四层,按影响排序):

| 层 | 现状 | 后果 |
|---|---|---|
| 模型 | 主/子均 deepseek-v4-flash(速度取向) | 输出趋「最少够用」;SDK 文档本就提示 flash 不适合代码生成 |
| 思考 | 子 agent 继承主思考配置,无独立开关 | 想给子 agent 开深思考只能整体重写 LLM 配置 |
| 提示词 | 有纪律(自检/终稿/规格化),无质量标准 | 模型不知道「好页面长什么样」 |
| 信息 | 组件清单只有 name/版本,无范例 | 无 few-shot 锚点,丰富度全靠先验 |

机制层:门禁只校验合法性(标签闭合),不校验质量——「太简单」永远过检。

## What Changes

### 1. SDK:`createHtmlSubagent` 增加 `llm` 透传(新,小)

`CreateHtmlSubagentOptions.llm?: SubagentLlmConfig` → 返回 cfg 的 `SubagentConfig.llm`。流转链路**已存在**(`configToSubOpts` 的 `llm: config.llm ?? main.llm`,核实过),工厂只需接上。子 agent 由此可独立用强模型,主 agent 保持 flash 编排。`createRagSubagent` 不做(只读检索,浅思考够)。

### 2. SDK:实施 `subagent-thinking-mode-lock`(既有规划,本批落地)

按 [`2026-08-18-subagent-thinking-mode-lock/`](../2026-08-18-subagent-thinking-mode-lock/) 既有 proposal/design/tasks:`SubagentConfig.thinkingMode?: 'simple'|'deep'` + `createHtmlSubagent` 透传 + 顶层 `subagent.thinkingMode?` 全局缺省;LLMConfig 构造路径经 `applyThinkingMode` 纯函数改写 `extraBody.thinking`(OpenAI 兼容)/ `LLMConfig.thinking`(Anthropic `constructLlmFromConfig` 扩展);预构造实例路径 warn + observable no-op;`inspect().subagents` 反射生效状态。

**本批裁剪**:DebugDrawer 思考模式可视化移入后续(无浏览器验证通道时不堆未验证 UI);冲突 warn 保留。

### 3. editor_fangzhou:质量标准 + 配置管线 + 范例骨架(editor 仓库,非 SDK)

- `AI_SYSTEM_PROMPT` 增「页面质量标准」:模块数下限(导航/主视觉/2-3 内容区/交互/CTA)、禁占位文案、视觉层次——主 agent JSON 搭建直接受益
- `aiAssistant/config.js` 增 `htmlSubagent: { llm?, thinkingMode? }` 配置位(缺省 = 继承现状零变化;`ai-llm.local.js` 可覆盖),AiAssistant.vue 透传 `createHtmlSubagent({ llm, thinkingMode, maxToolRounds: 16 })`
- `page-exemplars` skill 骨架(条件注册:范例为空不装,防困惑):结构留 TODO,**范例内容由用户挑 2-3 个高质量专题填充**(阻塞项,不伪造业务数据)

## Impact

| 项 | 变更 |
|---|---|
| `src/core/sdk/htmlSubagent.ts` | `CreateHtmlSubagentOptions.llm?` + `thinkingMode?` 透传 cfg |
| `src/core/harness/subagent.ts` | `SubagentConfig.thinkingMode?`;`applyThinkingMode` 调用点;实例路径 warn + observable |
| `src/core/llm/constructLlm.ts` | `LLMConfig.thinking` 字段 anthropic 注入 |
| `src/core/sdk/createChatSdk.ts` | `LLMConfig.thinking?` + 顶层 `subagent.thinkingMode?` 缺省透传 |
| 附带(已完成,同批提交) | **完结门禁陈旧 todos 豁免**:循环条件加 `rounds > 0`——本轮零工具调用不触发门禁,修「上一轮持久化遗留未完成 todos 在纯问答轮发难」误报(e2e 3 断言) |
| types / 测试 / 文档 | d.ts 同步;selftest applyThinkingMode 纯函数 + e2e 构造期断言;usage-guide 中英 |
| editor_fangzhou | prompt 质量标准 + subLlm 配置管线 + exemplars skill 骨架(内容待用户填) |

## 非目标(Non-goals)

- 质量门禁(LLM judge「是否过简」/规则下限回灌)—— 先看本批效果,不预置机制
- 范例内容制作 —— 业务数据须用户挑选,只做骨架与接线
- DebugDrawer thinkingMode 可视化 —— 移后续(未验证 UI 不入库)
- createRagSubagent 的 llm/thinkingMode —— 只读检索无需求
