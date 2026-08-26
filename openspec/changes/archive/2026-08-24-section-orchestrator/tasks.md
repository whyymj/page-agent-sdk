# Tasks: section-orchestrator(评审修订版)

## Phase 0(独立可发,P1;✅ 已完成 2026-08-24)

- [x] 0a:roundBudgetHintText 增第三参 hasSubagent + 70% 档文案扩「并行分段委派(多个 spawn_agent 各带 writablePaths)」;selftest 两态断言
- [x] 0b:欠委派 nudge —— middleware 实现(勿硬编码 createAgent)+ beforeAgent 重置:逐次 measureWriteScale union scopes(整体 set 特判取 count)invoke 内累计 > N 且零委派(spawn_agent/spawn_agents/use_*)→ 随下一次写结果尾附一次性 advisory;debugLogs `stage:'delegate_nudge'` + inspect 可观测;write_todos 文本不作触发源
- [x] selftest:nudge 三态 + whole-set 特判 + invoke 去重 + 已委派抑制(sec-107;另有 dryRun/失败写不度量 + 阈值边界;debugLogs 留痕走 logSink 条目,inspect 反射暂不另开面)
- [x] e2e:stub grind 序列 → nudge 装配链实证 + S7 保底(委派×2 失败 → 主单干完成 + 已委派抑制)
- [x] 门禁:npm test && build && test:e2e 全绿(3010/975/111);CHANGELOG

## Phase 1(主体,依赖 subtree-summary;✅ 已完成 2026-08-24,依赖方 subtree-summary P0/P1 均已就位)

- [x] 编排段动态注入:delegate-nudge 中间件 augmentPrompt 每轮按 liveData 实测(顶层对象数组元素总数 ≥12,与 nudge 同阈值同源)→ 三步职责 + 段规格四要素;小数据零注入;setData 跟随;零配置
- [x] 段规格四要素为 html 五要点的新造平移(真 LLM 验证登记 deferred 待网关,mock/e2e 已锁格式)
- [x] S6 明示弱点写进 usage-guide 中英 + 编排段本体(含 spawn_agents 无写授权 → 并行写须逐个 spawn_agent)
- [ ] 真 LLM:initialPage 双臂(flash 硬干 vs nudge 分流;无 code 字段 schema 副本防干扰)轮次/完成率/token;S1 四要素齐格式抽检;阈值标定 —— **待环境**(登记 deferred;DELEGATE_NUDGE_THRESHOLD=12 初值)
- [x] usage-guide 中英「分段编排」段 + CHANGELOG

## Phase 0 实施备注(2026-08-24)

- 装配条件修正:默认只读 spawn_agent 也算委派能力 —— nudge 与 hasSubagent 均按 `useSubagent` 能力判定(subagents 未声明时 subagentsForAssemble 为 undefined 但 spawn 工具在场)。
- e2e S7 用 spawn_agents(allSettled 错误隔离既有路径);单数 spawn_agent 的流错误未捕获路径是独立问题(与 draft-restore 登记的流式错误聚合同族),不在本 change 修。
- 阈值常量 DELEGATE_NUDGE_THRESHOLD=12(初值;initialPage 双臂标定待真 LLM 环境)。

## Phase 1 实施备注(2026-08-24)

- 注入挂在 delegate-nudge 中间件(同阈值同源),不新建中间件;装配条件与 Phase 0 相同(dataOps + useSubagent)。
- 门禁:3017/0 · 978/0 · 111/111。
