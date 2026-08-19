# Design: instruction-adherence

## 1. 总体架构(两个守卫在 ReAct 循环中的位置)

```
用户消息 ──► intentGuard.augmentPrompt(state)          ← B 问句守卫(pin 段,每轮重评估)
             │  读最新 user 消息 → detectQuestionIntent
             │  命中 → 注入「先答勿做」段(Infinity 尾随,跨压缩存活)
             ▼
createAgent ReAct 循环(每轮)
             │
             ▼
        model 响应 response
             │
             ├─ 有 tool_calls → 执行工具,rounds++,continue
             │
             └─ 无 tool_calls(欲收口)
                 ├─ garbled(DSML)→ format_retry 回灌(已有)
                 ├─ transitional(过渡叙述)→ 回灌续跑(已有,≤maxTransitionalRetries)
                 ├─ ★ detectIncompleteFinish(state.todos, content)   ← A 完结门禁(新增)
                 │     todos 有未完成 && 收尾非问句 && gateRetries<2
                 │     → push HumanMessage(buildGateFeedback) + pendingFormatRetry=true,continue
                 └─ 都不命中 → return 终稿
```

**共同模式**:两者都复用 3.33 `detectActionNarration` 确立的范式 —— **纯函数判定(可单测)+ 循环层回灌(机制保证)+ 独立小预算(防死循环)+ debugLogs 留痕**。不靠提示词自觉。

## 2. 关键决策记录

### D1:完结门禁挂循环条件层,不挂 beforeReturn —— beforeReturn 默认配置下不跑

核实 `createAgent.ts:903`:beforeReturn 钩子的执行条件是 `!garbled && maxVerifyAttempts > 0 && state.verifyAttempts < maxVerifyAttempts`。**`maxVerifyAttempts` 默认 0 = beforeReturn 整段纯放行不执行**。editor_fangzhou 等未开 verify 的集成方,门禁挂 beforeReturn 永远不触发。

故选循环条件层:`!response.toolCalls.length` 分支内、transitional 判定之后新增门禁分支,与 format_retry/transitional_retry 同构(独立计数 `gateRetries`、`pendingFormatRetry=true` 绕过 rounds 预算 —— 门禁续跑是「补完任务」不是新工具轮,不吃 maxToolRounds;总闸 maxIterations=max(maxToolRounds*3,30) 仍兜底)。

**零回归论证**:门禁分支前置条件 `todos 存在未完成项`;未用 write_todos 的会话(绝大多数简单任务)恒不命中;verify 路径(beforeReturn)一字未动。

### D2:门禁预算 = 2,回灌文案给「双出口」

- 预算 2 次:实测「忘标 completed」型一次回灌即收敛;真没做完的第二次回灌后仍在收尾 = 模型异常,放行强收(总闸兜底),防 gate 死循环烧 token
- 文案双出口是关键:**「活干完但忘 update_todo」是高频真实场景**(flash 实测多次)—— 若文案只说「继续执行」,会逼模型把已完成的活再干一遍。文案:
  > ⚠️ 任务未完成:待办清单还有 N 项未完成(列出 id+content)。若这些工作实际已完成,请先用 update_todo 把它们全部标记 completed 再给出最终总结;若尚未完成,请继续执行剩余任务。不要中途停止。
- 豁免问句收尾:`/[??]\s*$/` 结尾 = agent 在向用户征询(approval 之外的软征询,如「要保留哪个方案?」),此时拦截会破坏人机交互节奏 —— 宁漏勿误放行

### D3:问句守卫用启发式 + 提示词逃生门,不做硬阻断

误报风险最高的场景:「能帮我设计一个活动页吗?」—— 形式是问句,实质是操作请求。故:
- 守卫**不阻断任何工具**(不是 permissions filter),只注入提示段
- 提示文案自带逃生门:「**除非用户在同一条消息里明确要求操作**」—— 让 LLM 做最后一层语义裁决,启发式只负责把「这是问句」的信号送到注意力前排
- 判定函数三档(宁漏勿误,精度优先):
  1. **强**:句尾 `?`/`?`(含「吗?」「呢?」)
  2. **中**:疑问词 `(为什么|为啥|多少|几个|能不能|可不可以|是否|有没有)` + 句尾 `吗|呢`
  3. **查询词**:`(是什么|是啥|怎么用|如何用|有哪些|什么意思)` 命中即算(此类词几乎只出现在信息咨询,驱动本次立项的「这是啥组件」即 rule 3 命中)
- 反例基线(必须不命中):「设计一个活动页」「把标题改成X」「添加一个 banner」「调换 navbar 和 banner 顺序」

### D4:注入点 = augmentPrompt pin 段,而非改 systemPrompt/改消息

- augmentPrompt 每轮重渲染 → 守卫随**最新 user 消息**动态评估:问句驱动的整轮多步 ReAct(查了 3 个工具才答)全程受守护,防中途漂移成操作;下一条操作消息进来自动失效,无残留
- pin 段 Infinity 优先级尾随(声明序排在 mission 之后)→ 跨 summarization 压缩存活(长对话正是漂移高发区,守卫必须在压缩后仍在)
- 不 mutate 消息历史(改 user 消息会污染持久化/上下文);不动 systemPrompt(集成方资产)

### D5:不加配置项(延续 3.30/3.31 配置面收敛)

两机制默认开、无开关。理由:① 启发式宁漏勿误,误报面已被 D2/D3 压到最低;② 3.30/3.31 刚移除 hintsMode/interceptors/toolMode 三个配置项,此处再增两个 capabilities 键方向相悖;③ 真出现误报干扰,**届时**再加开关(登记为触发条件,见非目标)。

## 3. 实现形状

```ts
// todos.ts(导出纯函数)
export function detectIncompleteFinish(todos: Todo[], finalContent: string): boolean
//   todos 为空 → false;全 completed → false;finalContent 以 ?/？ 结尾 → false;否则 true
export function buildGateFeedback(todos: Todo[]): string   // 列未完成项 id+content(截断防超长)

// intentGuard.ts(新文件)
export function detectQuestionIntent(text: string): boolean // D3 三档
export function createIntentGuardMiddleware(): Middleware   // augmentPrompt:读 state.messages 最后一条 user,命中返 pin 段,否则 undefined

// createAgent.ts:循环内 transitional 分支后新增(仿同构 ~10 行)
let gateRetries = 0
// ...
if (!garbled && gateRetries < 2 && detectIncompleteFinish(state.todos, response.content)) {
  gateRetries += 1; pendingFormatRetry = true
  log('middleware', { stage: 'completion_gate', attempt: gateRetries, pending: n })
  currentMessages.push(new HumanMessage(buildGateFeedback(state.todos))); continue
}
```

## 4. 可观测

| 留痕 | 内容 |
|---|---|
| debugLogs `stage:'completion_gate'` | attempt / 未完成项 id 列表 / 收尾文本前 160 字 |
| debugLogs `stage:'intent_guard'` | 命中规则档(strong/medium/query-word)/ user 消息前 60 字 |
| 现有 `inspect()` 无新增字段(两机制无运行时配置态可反射) | |

## 5. 与现有机制的关系(互补不重叠)

| 机制 | 管什么 | 本 change |
|---|---|---|
| detectActionNarration(3.33) | 第 0 轮光说不做 | 不重叠:门禁管「做了一半收口」 |
| detectTransitionalReply | 过渡性短文本续循环 | 不重叠:门禁看 todos 状态,不看文本形态 |
| htmlOrchestratorPrompt【先判意图】(3.34) | 静态委派分流 | 互补:守卫是逐消息动态定性,静态编排仍管委派路由 |
| verify beforeReturn | 写后回查(opt-in) | 零改动(D1:不同层,不共享预算) |
| maxPlanRevisions | 防规划死循环 | 不重叠:门禁管执行收口,不管规划改写 |
