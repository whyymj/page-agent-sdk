# Proposal: instruction-adherence(指令执行力增强:完结门禁 + 问句意图守卫)

## Why(用户诉求,2026-08-19)

「如何能增强指令执行力?不再发生莫名中断,或注意力漂移。」

editor_fangzhou 真 LLM 实测反复出现两类失效,成因不同、对策不同:

| 症状 | 实例 | 成因 |
|---|---|---|
| **莫名中断**(提前收口) | todos 拆了 3 项做完 1 项就用纯文本总结收尾;工具报错一次即放弃 | agent 自认完成,框架无「未竟任务不许下车」的门禁 |
| **注意力漂移**(误路由) | 长对话中问「这是啥组件」→ 却触发 use_html 生成代码(被历史记录干扰) | 提问被当成操作指令;生成类编排提示在长上下文中盖过咨询意图 |

现有机制只覆盖了部分面:
- `detectActionNarration`(3.33)管**第 0 轮**「光说不做」(叙述动作却不调工具)→ 回灌;但**做到一半收口**无人管
- `detectTransitionalReply` 管过渡性回复(「接下来我将…」)续循环;但「看起来像终稿」的半成品总结不命中
- `htmlOrchestratorPrompt`【先判意图】(3.34)是**静态**编排提示,长对话中被历史稀释;缺**逐消息动态**意图判定
- 项目实测教训已固化原则:**纪律靠机制不靠提示词**(flash 三次无视禁令 → componentWriteGuard 机制回灌才治住)

## What Changes

**两个默认开的框架级守卫,均为启发式、宁漏勿误,不加新配置项(延续 3.30/3.31 配置面收敛方向):**

### A. 完结门禁(completion gate,防提前收口)

agent 欲以纯文本收尾时,若 `state.todos` 存在非 completed 项 → 回灌「任务未完成」反馈续循环:

- 纯函数 `detectIncompleteFinish(todos, content, attempts)` + `buildGateFeedback(todos)`(todos.ts,可单测)
- 回灌文案给双出口:「若确实已完成 → update_todo 标记后收口;否则继续执行」—— 兼容「活干完忘标记」场景,不强制多烧一轮
- 预算 ≤2 次(防死循环;总闸 maxIterations 仍兜底);与 `maxVerifyAttempts`/beforeReturn **解耦**(选循环条件层而非 beforeReturn,见 design D1)
- 豁免:收尾文本以问号结尾/含征询句式(向用户要输入时不拦,宁漏勿误);todos 为空恒不触发
- debugLogs 留痕 `stage:'completion_gate'`(attempt/未完成项)

### B. 问句意图守卫(intent guard,防误路由)

逐用户消息动态判定咨询意图,命中则在 pin 段注入「先答勿做」提示:

- 纯函数 `detectQuestionIntent(text)`(问号结尾强信号;疑问词+「吗/呢」收尾次信号;保守匹配)
- 新中间件 `intentGuard`(`augmentPrompt` 钩子,pin 段 Infinity 尾随,跨压缩存活),读最新 user 消息判定;命中注入:「本轮为咨询:先用 read/list/rag 查证作答,除非同条消息明确要求,不执行生成/修改/删除」
- 多轮 ReAct 内持续生效(同一条问句驱动的整轮都受守护,防中途漂移成操作)
- 与【先判意图】静态编排互补:静态管委派分流,动态管逐消息定性
- debugLogs 留痕 `stage:'intent_guard'`

### 装载与生效

- 装载序:todos 中间件已存在(门禁逻辑在 createAgent 循环条件层,复用 detectActionNarration 同款模式);intentGuard 中间件随默认装配,声明序在 pin 段组(mission 之后)
- 子 agent 不受影响(门禁/守卫仅主循环;子 agent 任务来自委派非用户问句)
- editor_fangzhou 零改动自动生效(SDK 内机制)

## Impact

| 项 | 变更 |
|---|---|
| `src/core/harness/todos.ts` | `detectIncompleteFinish` / `buildGateFeedback` 纯函数导出 |
| `src/core/harness/createAgent.ts` | 循环条件增门禁分支(仿 detectActionNarration 预支预算模式);gateAttempts 局部计数 |
| `src/core/harness/intentGuard.ts`(新) | `detectQuestionIntent` + `createIntentGuardMiddleware`(augmentPrompt) |
| `src/core/sdk/createChatSdk.ts` | 默认装配 intentGuard(声明序入 pin 段组) |
| 测试 | selftest(两纯函数正/反例)+ e2e(stub 驱动:未完成收尾被回灌续跑 / 问句消息命中守卫段 / 边界各 1) |
| 文档 | usage-guide 中英 + CLAUDE.md 架构要点 + CHANGELOG;随 3.35.0(连同已提交的 MCP 连接重试) |

## 非目标(Non-goals)

- **不加配置开关**(默认开 + 宁漏勿误启发式;若实测误报干扰再按需加 capabilities 开关 —— 登记为重启触发条件而非预置配置面)
- 不做 LLM judge 版完结判定(纯启发式先行;judge 版烧 token 且慢,deferred 备选)
- 不改 beforeReturn/maxVerifyAttempts 现有语义(verify 自检路径零回归)
- 不管流层中断(挂起收口三契约 + stream 看门狗已覆盖,「莫名中断」里属流层的已被 3.25/3.25.1 治理)
- 不做子 agent 的同款门禁(子 agent 收口有 formatCheck/verify 门禁,todos 仅主 agent 持有)
