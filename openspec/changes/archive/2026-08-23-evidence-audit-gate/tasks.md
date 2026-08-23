# Tasks(evidence-audit-gate;SDK 侧)

> 2026-08-23 三方评审回改版;实施序 Phase 0(gateChain,零行为变化)→ A1(引导 + rider)→ A2(锚点核对主体)→ 验收。

## Phase 0:gateChain 抽取(A 的前置,第 1 优先)

- [x] createAgent.ts:975-1060 收口五层门禁(transitional/完结/零工具/状态询问/EXHAUSTED observable)抽独立 gateChain:判定与文案归 actionGate 家族,主循环只留 `runGates(...)` 一个调用;**零行为变化**(所有预算变量/互斥语义/continue 流向原样)—— 落地为新文件 `src/core/harness/gateChain.ts`(runFinishGates + 三预算池 GateChainState),detectTransitionalReply/detectActionNarration 迁 actionGate(createAgent re-export 保持导出面),主循环 -60 行
- [x] 附带修存量缺陷(回归面 A-3):完结门禁补 `!state.__pgIsSubagent`(html 子 agent planning=true 装 todos 中间件,子栈「todos+写+文本收口」现状会被误回灌);补回归测试(html 子 agent todos 收口零回灌)
- [x] 验收:selftest 计数不变(2813)+ e2e 全绿(929)—— 2026-08-23 实测:既有 2813 全绿 + sec-101 新增 15 断言(2828 总),e2e 929 全绿

## Phase A1:evidence 引导 + rider 文案(搭车,零新触发)

- [x] usageHints 无条件段:「update_todo 标 completed 时附 evidence: 本次写入的 jsonPath(如 components.2);如实无法提供路径时写明原因」(schema describe 同步从「可选」改引导文案)
- [x] buildGateFeedback 追加 rider:完结门禁回灌时同时列「已完成但 evidence 为空」项,双出口(补 evidence / 承认未做改回 pending);不加预算变量、不加 EXHAUSTED
- [x] selftest:rider 文案断言(有未完成项且有已完成空 evidence 项时出现)/ 无未完成项时零触发(A1 不独立发难)/ 子 agent 栈零触发(sec-102 #7;sec-89 旧断言按 rider 设计内交互校正)

## Phase A2:锚点核对(机制主体)

- [x] readInvalidation.ts:`effectiveWritePaths`/`pathsOverlap` 已 export(核实无需改动)
- [x] actionGate.ts 纯函数:`extractEvidencePaths(evidence)`(path 形态提取,`$`/`[n]` 归一点分形态)+ `isEvidenceCovered(evidencePaths, sessionWritePaths)`(经 pathsOverlap 任一重叠即覆盖;ROOT 全覆盖;components ≠ components2)
- [x] createAgent.ts:会话级累计写路径集(闭包 `auditWritePaths` Set,每成功写并入 `effectiveWritePaths` 全量;陈旧性说明:只增不清,残留旧路径仅致漏报方向退化可接受)+ invoke 起点 todos status 快照
- [x] 触发分支(gateChain 内,完结门禁后/零工具门禁前):本 invoke 翻转 completed 的 todos × evidence 含 path 形态 × 与累计集零重叠 → 三出口回灌(修正路径/改回 pending/如实说明);独立 `auditRetries ≤ 2`,超限放行 + observable `AUDIT_GATE_EXHAUSTED`
- [x] wrap-up 补跑:轮次耗尽强制收口路径补跑 A2 本地判定(零 LLM;`AUDIT_EVIDENCE_SUSPECT` observable,不回灌 —— 循环已尽)
- [x] 豁免面:问号收尾 / 空 todos / 无 path 形态 evidence / `__pgIsSubagent` / dryRun(isSuccessfulWriteResult 口径;成功写才进累计集)
- [x] selftest(sec-102,25 项):批量 patches 不误伤 / 跨 invoke 续跑不审旧项 + 上轮写本轮标完成不误伤 / 编造路径回灌 / 描述性不核对 / 预算超限放行 + observable / wrap-up 生效 / 纯函数族

## Phase B1:e2e + 剧本 + 基线

- [x] tests/e2e/evidence-audit.mjs(11 项):A2 编造路径拦→修正放行(6 次调用)/ 真实路径零触发(4 次)/ A1 rider 轮次结构与旧版一致;usageHints 引导段在 selftest sec-102 #8 覆盖
- [x] tests/browser/page-demo.spec.ts 规划端到端剧本补 evidence 参数(write 先行 + evidence 附实际路径;实测旧剧本本就不触发 A2 —— rider 无独立触发面,补 evidence 为对齐新引导防将来漂移)
- [x] 真 LLM(2026-08-23,`tests/runtime/_real-llm-evidence-audit.mjs` 本地脚本 + glm-5.2,语义 6/6):
  - S1 引导生效:模型按新引导填真实路径 evidence + 审计零触发(零误伤、零额外轮次)
  - S2 编造路径被拦:模型按指示填 components.9 → A2 回灌 → 终态修正(探针挖出 **P0:todo id 复用致审计面清空**,已修 + 回归锁,见 CHANGELOG [Unreleased])
  - S3 描述性证据:被审计 offender 全为路径形态(描述文本零进审计面);模型被前轮历史带偏先填假路径也被正确拦下改描述放行
- [x] ~~随 change `--baseline-update` + 基线迁移说明~~ → **deferred 注记**:基线系 deepseek-v4-flash 时代采集,网关 flash offline 无法重采;A1 rider 轮次影响已由确定性测试锁零漂移(e2e 计数断言),真 LLM 探针零额外轮次实证;网关恢复后随下次 uispec 采集补
- [x] 文档:CLAUDE.md(架构要点门禁族 + gateChain)+ README 中英文 + usage-guide 中英文(evidence 审计门禁条目)+ CHANGELOG [Unreleased];计数同步 2813→2853 / 929→940(browser 102 不变)
