# Proposal: server-companion(Node/服务端同构运行)

> 状态:**📋 大纲规划(2026-09-03 立项,待评审细化)**。优先级 P2(战略方向;**Phase 0 独立可先发**)。目标:把「浏览器端 agent 页面关了就停」的硬边界打开 —— harness 核心已在 node 跑通(e2e 每次都在 node 加载 dist + stub model 走完整 ReAct),本 change 把这件事**证明到真 LLM + 文档化 + 无人值守形态正式化**,让同一套 SDK 在服务端跑定时/webhook 触发的长任务。
> 来源:2026-09-03 功能拓展点咨询收敛(「唯一能打开新维度的一项」);用户拍板「openspec 大纲规划」。

## 为什么可行(现状证据)

- **e2e 全家在 node 跑 dist 产物**(1050 项,StubChatModel 驱动真 ReAct 循环 + dataOps + 快照 + 乐观锁)—— 核心循环/数据面 node-clean 已被日常门禁持续证明。
- **headless 子路径**(`page-agent-sdk/headless`,纯核心不含 UI,ESM ~446KB)天然就是为「非对话框宿主」准备的产物形态。
- **LLM 栈同构**:`@langchain/openai`/`@langchain/core`/`@langchain/anthropic` 是 peerDep,vite external —— node 侧集成方装同版本包即可解析;`@langchain/openai` 本身 node/browser 双端。
- **自动化面已有**:`sdk.batch()` + automation 预算 + approval 无响应自动拒(4.1+)—— 无人值守的构件大半在场。

## Phase 0:node 真跑证明 + 冒烟(独立可发,P2)

- **目标**:headless dist + 真 LLM 构造(constructLlm 全路径:OpenAI 兼容 + Anthropic 协议)在 node 完成一轮完整 ReAct(读写 dataOps 工具 + 快照回退),产物 = `examples/node/headless-node.mjs` 可运行示例 + 文档章节。
- **勘察点(实施首日核实)**:
  1. **DOM 引用面审计**:`grep -rn 'window\.|document\.' src/core`(排除 browser 工具/composables/components)—— 预期 core 零直接引用;命中处补 `typeof document` 守卫降级(render-check / 3.22.1 sanitizeMessageHtml 有同型前科,先例可循)。
  2. **storage 后端 node 形态**:默认 memory 后端 node 直跑;REST 后端无 cookie 会话(node fetch 语义)→ 文档明示「node 用 memory 或自带鉴权 headers」〔勘察 backends/storage.ts 的 headers 注入面〕。
  3. **MCP optional peerDep 在 node**:stdio transport 在 node 可用(浏览器只 http/sse/ws)→ 增益项非阻塞,文档标注即可。
- **风险**:浏览器子包 API 在 node 的行为差异(预期无,但 Phase 0 存在的意义就是实测);产物体积/启动(node 无所谓,红线只求能跑)。

## Phase 1:无人值守运行形态(文档 recipe + 缺口收口)

- **目标**:「无人值守 checklist」正式文档化 —— approval 自动拒/timeoutMs、`conflictPolicy: 'overwrite' | 'keep_external'`(宿主与 agent 争数据、无人裁决场景防流程永挂)、`toolTimeoutMs` 放宽、`streamStallMs`/`streamMaxDurationMs`、headless `afterRound()` 手动落盘、重试策略。
- **设计决策点 D1(配置哲学)**:**倾向零新配置项**(memory:不出让用户疑惑的配置项)—— 既有旋钮组合成文档 recipe;只有当 checklist 里发现「必须加开关才能补的缺口」才回到本 change 评审,默认不加。
- **可能缺口(Phase 0 冒烟后裁决)**:①长任务跨进程重启恢复(storage 快照在,但流中断续跑语义)→ 预期 deferred(触发:真实定时任务案例);②node 环境 `checkpoint`/`sessionPersistence` 行为核对。

## Phase 2(可选,决策点 D2):独立 node 子路径?

- `page-agent-sdk/node` 子产物(headless 再裁 browser-only 分支)—— **默认不做**:headless 已是 node-clean 目标产物,新增子路径 = 新构建面/新 types/新 size 门禁,除非 Phase 0 发现 headless 里捆着 node 不值得带的死重(预期没有:marked/highlight.js/dompurify/overlayscrollbars 已只在主包)。
- D2 裁决规则:Phase 0 冒烟通过且 headless 产物在 node 零障碍 → 关闭 Phase 2,复用 `/headless`。

## 不立项项(评估结论留痕)

| 项 | 结论 |
|---|---|
| node 常驻进程调度器(cron/队列/多租户) | 集成方服务端域;SDK 只保证「能在 node 跑」+ batch 原语 |
| 浏览器端 × 服务端会话互通(同一会话双端接力) | 跨端乐观锁/在途流语义复杂;等真实场景(trigger: 定时任务产出回浏览器续编辑需求) |
| SDK 内置 webhook/触发入口 | 宿主 server 框架域(Express/Koa 各自包一层即可) |
| 主动式 agent(宿主事件自动 send) | 登记 deferred(浏览器端同款诉求,一并看) |

## 验收门禁

- Phase 0:node 冒烟脚本真 LLM 双协议各一轮全绿(读→写→快照回退断言);`npm run test:e2e` 既有 node 路径零回归(本就全 node);examples/node 文档章节中英。
- Phase 1:无人值守 recipe 文档 + 缺口清单(每项:已覆盖旋钮 / deferred 登记);无新配置项情况下 selftest/e2e 计数零变化。
- 真 LLM:Phase 0 冒烟即真 LLM 场景(无 key 自动 skip 与既有套件同口径)。
- 计数同步 CLAUDE.md + README 中英;usage-guide 补「服务端运行」章节。
