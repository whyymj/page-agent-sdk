# Tasks: audit-sdk-integrity

> 审查类 change:不改 src 代码。每阶段完成后在对应节回填 findings 计数。发现需紧急处理的 P0 → 停下询问用户是否另立 fix change。

## §0 基线快照
- [x] `npm run build` + `npm test`(1658)+ `npm run test:e2e`(451)+ `npm run test:browser`(40)全绿确认;记录 dist 体积基(size-check 输出)
- [x] 固化审计输入:打印当前默认 system prompt 构成样本 + `inspectContext()` 典型 data 规模采样(存 report 附录,D4/P4 用)

## §1 并行模块评审(R1-R8,8 路 code-reviewer 子代理)
- [x] R1 harness 核心(createAgent/middleware/state/errors/retry/budget)
- [x] R2 数据操作(dataOps/schemaUtils/jsonUtils/resources/conflictManager/toolError)
- [x] R3 上下文管理(useContextManager/contextIndex/summarization/contextPreset/compressDecision/contextAnalysis/offload/vfsGc)
- [x] R4 会话持久化(storage/vfs/skillStore/checkpoint/mission/workingMemory)
- [x] R5 子 agent & 能力(subagent/ragSubagent/htmlSubagent/todos/skills/memory/permissions/verify/usageHints/approval)
- [x] R6 SDK 组装(createChatSdk/optionsResolver/middlewareStack/toolRegistry/llmResolver/events/actions/promptBuilder/mountChatDialog)
- [x] R7 安全面(sandbox/hostScript/useMarkdown/domTool/envTool/fetchDoc)
- [x] R8 UI 层(components/* + useChat/chatContext + DebugDrawer)
- 每路输入 = design.md §2 对应行 + §9 H 假设 + 测试盲区视角;输出 = findings(格式见 design §0)

## §2 主流程走查(F1-F11,亲自逐条)
- [x] F1 ReAct 主循环 / F2 数据写链 / F3 冲突闭环 / F4 压缩链 / F5 持久化闭环(各走查后记「实际调用序列 vs 设计意图」差异)
- [x] F6 子 agent 链 / F7 Focus 收敛 / F8 受保护资源 / F9 错误重试 / F10 UI 事件链
- [x] F11 任务完成保证矩阵(场景 × 终止路径逐格:能终止/有反馈/状态干净)

## §3 专项深潜
- [x] D1-D4 目标漂移专项(mission 陈旧/规划误引导/pin 段稳定性/定位与默认成本)
- [x] E1-E3 执行健壮性专项(死循环面清点 / 卡住面「挂起点×超时×可见性×清理」矩阵 / 反馈闭环逐路径核对)
- [x] C1-C7 主×子协同专项(共享状态面 / 并行归并与归属 / 事件串台 / 权限边界 / 上下文隔离 / 生命周期传播 / 子×压缩)
- [x] P1-P5 性能专项(每轮开销表/大对象操作/内存增长/token 成本/异步生命周期)
- [x] A1-A5 结构健康(类型门禁缺口/上帝文件/中间件序契约/推后项复核/流程卫生)
- [x] T1-T3 测试盲区(覆盖矩阵/断言强度/browser 缺路径)
- [x] H1-H28 假设逐条证伪(每条落「证实/证伪/部分」结论 + 证据行号)

## §4 findings 汇总与对抗核实
- [x] 合并去重 R/F/D/E/C/P/A/T/H 全部 findings,统一定级(按 design §0 标准)
- [x] 每条 P0/P1 独立复核(换视角重读代码证伪;吸取上次 P1-e 误判教训)
- [x] 误报降级/剔除并留痕

## §5 报告与拆分
- [x] 产出 `audit-report.md`(findings 总表 + 主流程差异记录 + 性能采样 + 推后项复核结论 + 手动验证项清单)
- [x] 修复拆分:P0 → 立即立 fix change;P1 → 并入下个发布 change;P2/P3 → 更新 `openspec/deferred.md`
- [x] 机制性建议落地方案(A1 类型门禁 / A2 拆分结论)写成可执行 change 草案标题,不实施

## §6 收尾
- [x] 更新 `openspec/changes/README.md` 索引(本 change 状态 + chatdialog-component-split 状态修正)
- [x] CLAUDE.md 三池/四池等确认的文档漂移修正(P3 直接改,属文档不属代码)
- [x] commit develop(audit-report 初版 + CLAUDE.md 三处漂移修正,`d89b45b` 已推 gitee)
- [ ] 二审定稿后补 commit(audit-report §十一 二审复核段)+ **停下询问用户是否立 fix change**
- [ ] 归档本 change

## §7 二审复核待定项(2026-08-10,后面再订)

> 二审已写入 `audit-report.md` §十一(11.1-11.6)。以下为悬而未决、待用户拍板的清单,不催——回来时打开本节即知有哪些事。定稿前不勾。

### 7.1 ✅ 5 个拍板疑问(2026-08-11 用户批准按二审推荐全部拍板;见报告 §11.6)
- [x] **Q1** P0 修复排除 `use_<id>` 用**装配期源头 filter**(推荐采纳;非运行期防御)
- [x] **Q2** fix-subagent-tooling **改名 `fix-authorization-surface`**;P1-21/22(focus 绕过)归此(授权与拦截面完整性,二审倾向采纳)
- [x] **Q3** fix-hang-and-feedback(组1,7 项)**先出统一超时/可见性 design**,再逐项落地(推荐采纳)
- [x] **Q4** N1 **并入 fix-main-sub-isolation**(与 H19/P1-13 同根,per-caller/per-round 基线刷新一次设计)
- [x] **Q5** 五维(CA/SE/VM/RE/CO)**等下轮审计**(本轮 P0/P1 已饱和;CA 可能出 P1 记录在案)

### 7.2 二审遗漏(报告 §11.4,待并入主表定级)
- [ ] **N1** 同轮/并发多写乐观锁连环冲突(P2,窄触发;读码已核实)—— 并入主表 P2 或随 Q4 升级处理
- [ ] **N2** 审计覆盖面缺口(write/draft/eval 是否产 audit 条目)—— 补一次审计事件完备性核实(P3)
- [ ] **N3** 配置非法值无防御(contextPreset:'unknown'/maxToolRounds:-1/maxParallelTools:0 等)—— P3
- [ ] **N4** reactive 大 bind 深度代理开销未量化 —— profiling 后定级(P2 待量化)
- [ ] **N5** wrap-up `pendingFormatRetry` 绕 rounds 预算,实际上界 > 文档 maxIterations —— P3

### 7.3 拆分/定级调整建议(报告 §11.2/§11.3)
- [x] P0 修复「排除 use_<id>」与 P1-16(spawn 自授)绑定同修 —— 已随 Q1/Q2 拍板,入 fix-authorization-surface(2026-08-11)
- [x] fix-subagent-tooling 主题与 P1-21/22 归属 —— 随 Q2 定:改名 fix-authorization-surface,P1-21/22 归此
- [x] fix-hang-and-feedback 是否先 design —— 随 Q3 定:先出统一超时/可见性 design
- [x] S1 沙箱逃逸维持 P2,**已在报告 §11.3 补「外发兜底链」论证**(这条已做,留痕)
- [ ] P2→deferred.md 登记时标注「触发概率/复现条件」(防 deferred 成冷宫)

### 7.4 新增审查方向(报告 §11.5,五维盲区)
- [ ] **CA 并发原子性**(maxParallelTools>1 / 同轮连续写 / abort in-flight 取消 / patches 原子回滚边界)
- [ ] **SE 安全纵深**(沙箱逃逸实测 / JSONPath 注入 / DOMPurify 完整性 / 可观测层生产泄漏)
- [ ] **VM 版本迁移**(schema 替换后旧快照兼容 / 持久化跨版本 hydrate / applySnapshot 版本号)
- [ ] **RE 资源累积**(长会话内存曲线 / hook 监听器泄漏 / vfs 收敛阈值 / blob URL revoke)
- [ ] **CO 配置健壮**(非法值 fail-fast / capabilities 组合矩阵 / preset 与显式 options 冲突优先级)

## §8 已提前实施的无疑问修复(2026-08-11,用户授权「先开始没有问题的修改方案」)

> 不依赖 Q1-Q5 的 P1 项直接落地(原属 fix-data-integrity / 组5/6 批次);有疑问项(Q 关联)仍推后。
> 全部带测试,五层绿:selftest 1669 / e2e 453 / browser 40 / types / exports 14 / types-alignment 0 错。

### 8.1 代码修复(src)
- [x] **P1-23** hook 流式事件:wrappedHandler 恒调 onEvent+emit(createChatSdk.ts);删冗余 userOnEvent —— e2e +2
- [x] **P1-12** WebStorage parse 守卫:get/scan try/catch 降级(storage.ts)—— selftest +4
- [x] **P1-20** ZodArray 索引校验:isPathAllowed+getSchemaAtPath 加 /^\d+$/(schemaUtils.ts)—— selftest +7

### 8.2 类型同步(d.ts ↔ src)
- [x] **P1-24** send options 补 interceptors/maxAutoRetries(index+headless d.ts)
- [x] **P1-27** capabilities 补 agentCompression(src 内联 + 两 d.ts);_capKeys 扩到全 21
- [x] **门禁新发现并修复 3 处漂移**:`humanConfirm` / `decisionTimeoutMs` / `decisionMaxTokens`(src 有 d.ts 无,审计与既有门禁均未抓到)

### 8.3 防复发门禁(A 专项落地)
- [x] 新增 `tests/types-alignment.ts` + `tsconfig.types-alignment.json`:d.ts↔src keyof 联合双向互判(capabilities/options/ChatSdk/send options 四面)+ `npm run test:types-alignment` 脚本
- [x] `exports-consistency.mjs` 多余名改 fail(type-only 白名单豁免 10 项 + 白名单失效检测)
- [x] 计数同步:CLAUDE.md/README 中英文 1658→1669、451→453(zh-CN 陈旧 1550/387 一并校正)

### 8.4 待办(随后续 fix change / 发布)
- [x] **已发布 v2.38.1**(2026-08-11):发布门禁全绿 → squash develop→master(`47c6cec`)推 Gitee+GitHub → npm publish → esm.sh 可达 + 导出齐全。上述无疑问修复随此版落地
- [x] Q1-Q5 已拍板(2026-08-11,§7.1);fix-authorization-surface(P0-1+P1-15/16/18/21/22)**已实施并发布 v2.38.2**;fix-hang-and-feedback(组1 P1-1..7)**已实施并发布 v2.39.0**;fix-main-sub-isolation(组3 P1-13/14/17 + N1)**已实施待发布**(立项复查修正 N1:原场景不可复现 → 防御加固);待立:fix-data-integrity 剩余项(P1-8/9/11/19/25/26)
