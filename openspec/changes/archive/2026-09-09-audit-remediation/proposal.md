# 2026-09-09-audit-remediation:六路全面审计整改(稳定性/性能/拓展性)

## 背景

用户要求「迭代至今代码量/复杂度/流程众多,需一次彻底排查」,组织 6 路并行只读审计(以 `openspec/deferred.md` ~100 项已知登记为去重基线,只报新发现):

| 审计路 | 报告 | 健康度 | 净新增 |
|---|---|---|---|
| 主流程/门禁族 | `local/flow-audit-4.11.1.md` | 4/5 | 5 条(P2×4 + P3×1,无 P0/P1) |
| 并发/时序 | `local/conc-audit-4.11.1.md` | 3.5/5 | **P1×1** + P2×3 |
| 代码质量/结构 | `local/structure-audit-4.11.1.md` | 3/5 | 拆分方案 + 欠账×2;死代码=零 |
| 性能(实测) | `local/perf-audit-4.11.1.md` | 3.5/5 | 量化落定 N4 + 净新增×4;无界增长点=零 |
| API/拓展性 | `local/api-audit-4.11.1.md` | 3/5 | HIGH×3 + MEDIUM×4 + LOW×4 |
| 文档漂移/测试盲区 | `local/drift-audit-4.11.1.md` | 4.5/5 | 20/20 强声明核实一致;失分全在元数据层 |

**总体结论**:4.x 新面质量过硬(主流程 4/5、文档契约 4.5/5、无界增长零漏网、死代码零);问题集中在四类:①机制对接处的串形态契约失明(conc P1);②reactive 放大从未处理(perf top ROI);③类型面对第三方扩展点零安全(api);④元数据(计数/清单/徽章)人工腐化(drift)。

## 关键发现摘要(按严重度)

### P1(唯一):COMPONENT_BUSY 真实回灌失明(conc#1)
组件锁真实拒绝串 `COMPONENT_BUSY · …` **无 `ERROR:` 前缀、status='done'**,而 createAgent 按 `content.startsWith('ERROR:')` 统计 rejectedDelegations 恒不命中 → 4.9.1「被拒委派不算等效写」修复**对真实锁路径失明**,并行委派被拒后谎报完成照旧溜过零工具门禁。测试全绿因桩自带 ERROR: 前缀(subagent.ts:939 × createAgent.ts:1143 × capability-packs.mjs:981 证实)。

### 性能 top ROI:reactive 全热路径 3-10× 放大(perf#1,N4 落定)
501KB bind 实测:每次 full-tree 遍历 +4~5ms;端到端单字段 patch 写 **20.4ms vs plain 7.5ms(超一帧预算)**;`structuredClone(reactive)` 恒抛 DataCloneError → checkpoint 恒落 5.4× 慢 JSON 兜底。修法:读侧 5 入口各加一行 `toRaw()`,零行为风险,预期读写路径 **-50~65%**,半天工作量。reactive 是典型集成形态(complex-demo 同构)非边缘。

### 拓展性最大短板:中间件契约类型面零安全(api#1/#2)
`Middleware` d.ts 类型 = `[k:string]: any`(harness 实有 10 钩子完整签名未投射);19 个公开 API 签名降级 any(`createAgent(options:any):any`);d.ts `import from 'vue'` 但 vue 不在 deps/peerDeps → 无 vue 消费者整个类型面 TS2307;headless 漏 8 个非 UI 导出且无「主包非 UI ⊆ headless」守卫。

### 结构:createChatSdk 拆分触发条件实质满足(struct)
1787→3318 行翻倍 + 2 例结构性自回归实证(P0-4 闭包越界 / 3.19 标题时序)+ 90 天 132 commit 变化负载。三阶段拆分方案就绪(类型段 0.5 天 → 会话生命周期族 1.5 天 → 三座小岛 1 天;每阶段三套测试全绿再进)。

### 稳定性小项
gateChain EXHAUSTED 口径三层三样(第 5 层缺问号豁免/完结层无 EXHAUSTED observable);retry-visibility 对预构造 LLM 实例路径失效(CLAUDE.md「恒 0」表述过强);示例/教学类请求误伤 zero_tool 门禁;早退路径不跑 afterAgent(invokeFocuses 泄漏);restore_data/resource_update/checkpoint restore 三写路径旁路互锁;restore 裁决无恢复点校验;debugLogs 条数有界单条字节无界。

## 方案评审修订(v2,2026-09-09)

初版方案经**四路独立评审**(Batch B / Batch C+D / Batch E+F / 完整性批判,报告在 `local/plan-review-{batchB,batchCD,batchEF,completeness}.md`,全部对照 4.11.1 源码逐项核验行号与根因)后修订。主要翻转:

| # | 修订 | 依据 |
|---|---|---|
| 1 | **原 E4(@langchain/openai → optional peer)否决** | 前提为假:`ChatOpenAI` 在 constructLlm.ts:15 / proxyLlm.ts:30 / **createAgent.ts:11** 三处静态 import,发布产物顶层硬依赖;改 optional peer = Anthropic-only 用户加载即崩 + esm.sh 断。替代:文档化现状 + deferred 留痕 |
| 2 | **原 Batch D 并入 B(4.11.2)**;checkpoint restore 锁除外(→deferred) | D2 修真实数据损路径(严重度高于性能),与 B6/B9 同落 dataOps 互锁区,一次回归面;checkpoint restore 内部加锁会把同步 API 变 Promise = 破坏性 |
| 3 | **原 B8(headless 导出)移 E 批** | 新增公开导出面属 minor,patch 携带违 E5 自立纪律;主题归 API 面 |
| 4 | **原 E3(ControllerCarrier)移 F 前置** | 实为 8 处 cast 非 6 处,其中 6 处落在 F2/F3 搬移区,单独先发必产冲突 |
| 5 | **B3 检测字段修正 `caller?.maxRetries`** | 原方案 `(llm as any).maxRetries` 在本仓库钉的版本下恒 undefined = 死代码;LangChain 缺省 6 次非 2 次 |
| 6 | **C1 形态改读入口单点 `rawBind()` 解包 + 入口清单补全 + getData 双用口陷阱** | 五深点各补 toRaw 会漏(baseline-guard/previewWrite/子 scope 等 4 处);checkpoint getData 读写双用,接线处 toRaw 会让 restore 绕过响应式触发(宿主页面不刷新) |
| 7 | **C3 形态改闭包 Map 计数器**(不加 VfsFile.bytes 字段);C4 并入既有 tests/perf/;C5 口径修 -44~65% | 避免持久化/类型面副作用;先例明示 bench 不进 CI;整体 set 实测 44% 低于原宣称下界 |
| 8 | **F2 拆两步(F2a 状态收敛 → F2b 函数抽取)+ F0 三前置**(skillsMw 微修 / ControllerCarrier / autoTitle e2e) | 难点是 lastTitle 等可变闭包状态归属,一步到位复刻 P0-4;autoTitle 是 F2 拆分区唯一零测试覆盖路径 |
| 9 | **E2 补 headless.d.ts**(原方案遗漏,:8 也 import vue、19 处引用);「无 vue tsc」完全脚本化 | 两 d.ts 必须一起解;人肉检查不可持续 |
| 10 | **版本号定死串行**:B=4.11.2 → C=4.12.0 → E=4.13.0 → F=4.14.0 | E/F 同文件区域硬冲突不可并行;E1 签名门禁反哺 F |
| 11 | Batch A 自回归勘误:模块数 116→**115**(实测),并把模块数纳入 check-test-counts 对账 | 完整性评审发现 |
| 12 | 静默丢失项 9 条全部归位(F 前置 ×1 / deferred ×8);每批尾统一任务模板(计数+deferred 对账) | 完整性评审:P1/HIGH 零丢失,缺口在 LOW/MEDIUM 尾部与测试标注 |

评审同时确认:六份审计引用的行号/数字与源码逐一吻合;C2 不破坏「hash 恒实时」不变量(禁的是跨调用缓存);B9 修复锚点须精确到「handleConflict 裁决后、pushSnapshot 前」(仅移入锁内仍跨 ask 拆段窗口)。

## 分批实施方案(v2)

### Batch A:文档元数据修正 + 守卫测试(零行为变化,随首批 commit)
授权范围内立即执行:
- A1 CHANGELOG 4.11.1 计数勘误(selftest 漏报 +22;e2e 错报 1077,实为 1085)
- A2 README 双语徽章 3212→3375
- A3 CLAUDE.md 清单补全:e2e 模块 +3(eval-toolkit/evidence-audit/stale-read-invalidation)、selftest「54+」→116、browser spec 枚举对齐 153
- A4 CLAUDE.md retry-visibility 表述收窄(实例路径例外)+ createChatSdk.ts:242 JSDoc 600s→1800s
- A5 doc/README.md 索引补 usage-guide.en.md / real-llm-regression.md;「4.10+」→「4.11+」×4
- A6 usage-guide 双语钩子表补 afterAgent/beforeReturn(10 钩子全列)+ 章节重号锚点修复
- A7 capabilities.ts 注释 17/21→18
- A8 tests/types.test-d.ts 补 DialogIcons/DialogConfig 键集字段级断言(deferred 2026-08-18 登记,触发条件已满足)
- A9 scripts/check-test-counts.mjs:三计数 + README 徽章对账脚本(报告模式),进发布 checklist

### Batch B:稳定性小修 + 互锁补面(4.11.2;原 Batch D 工具面并入)
- B1 **P1** COMPONENT_BUSY 回灌 toolError 化(subagent.ts:939)+ 真锁路径回归 + 4 项配套(hint 文案/capability-packs 断言同 commit/failStreaks 决策/事实清单链路)
- B2 gateChain 状态询问层问号豁免 + `COMPLETION_GATE_EXHAUSTED` observable(命名对齐族;inspect 专项反射砍)
- B3 预构造实例内层重试检测 **`caller?.maxRetries`**(原字段死代码;缺省 6 非 2)+ 装配期/setLlm 双入口 warn
- B4 NO_ACTION_RE → **首子句窗口级** EXAMPLE_REQUEST_RE(全文级漏判面大一档)
- B5 早退路径 afterAgent:**try 边界上移**(一处修全覆盖,优于逐点补)
- B6 双冲突自动收口 prev 留痕:**emit observable + debugLogs**(audit 通道不可达);叙事修正 → deferred
- B7 debugLogs **chokepoint 化**单条 ~8KB 截断保前缀 + args 占位;CHANGELOG Changed 段
- B9 eval beforeBind 锁内化:复现先行;锚点 = **裁决后、pushSnapshot 前**;受阻即解绑
- B10 (原 D1)restore_data/resource_update/**controller.updateResource(第四锁外写点,评审新发现)** 补锁;checkpoint restore 除外(→deferred,API 破坏面)
- B11 (原 D2)restore 裁决恢复点校验 + snapshotId 真实锚定 + **裁决分支 setBaseline 补 per-call scope**(评审新发现:并行 CA 基线错刷)+ 同调用双算 hash 消重

### Batch C:性能包(4.12.0)
- C1 读入口**单点 `rawBind()` 解包**(五处之外补全 baseline-guard/previewWrite/子 scope safeStringify/union 穿透);**getData 双用口陷阱**:只在 save 侧/clone() 内解包;currentValue 与 inspect()/controller.get() 不动;**响应性守卫测试三件**(selftest effect 触发 + browser complex-demo + `test:real --baseline-diff` 一次)
- C2 read 惰性 hash(路径校验后;不违「恒实时」不变量——禁的是跨调用缓存;deferred 辨析注记防误翻)
- C3 vfs 池计数:**闭包 Map 计数器**(不加 VfsFile.bytes;现状每写 5 次全池 TextEncoder 重扫;5 类失效点全覆盖)
- C4 bench 并入既有 `tests/perf/`(不进 CI);C5 CHANGELOG 口径 **-44~65%** 限 reactive 集成形态

### Batch E:API 面收口(4.13.0)
- E1 Middleware 10 钩子真实签名 + **5 个成员类型一并投射**(HarnessState+Todo/VfsFile/SkillMeta/SummarizationEvent/LoopProgress,评审发现的隐藏工作量)+ 5 工厂 any 补齐 + types-alignment `Same<A,B>` 互赋值断言
- E2 vue 类型解耦:内联桩,**index.d.ts 与 headless.d.ts 一起解**(原方案漏后者);无 vue tsc 验证完全脚本化
- E3 (原 B8)headless 补 8 导出 + types/headless.d.ts + 第三向断言;semver 归 minor
- E4 (原 E5)semver 纪律成文 + 4 漏洞补丁(证据来源定义/语义反转形态/公共面枚举/@deprecated 窗口)
- ~~原 E4 optional peer~~ **否决**(三处静态 import,前提为假;详见修订记录 #1)

### Batch F:createChatSdk 三阶段拆分(4.14.0,前置项依赖)
- F0 前置三件:**skillsMw compose 数组内赋值微修**(struct#3 HIGH,重构雷)/ **ControllerCarrier<T>**(8 处 cast,原 E3)/ **autoTitle stub e2e**(F2 拆分区唯一零覆盖路径)
- F1 类型段 L98-648 → sdk/options.ts(re-export 保符号)
- F2 **拆两步**:F2a sessionVars 显式收敛(lastTitle 等可变闭包状态归属,带测试)→ F2b 函数抽取 sessionLifecycle.ts(SessionDeps);一步到位复刻 P0-4
- F3 三座小岛(images/MCP connectAll/toolAssembly)
- F4 每阶段门禁 + **test:exports/test:types**(「保符号」须机械守卫,非口头承诺)
- F5 CLAUDE.md 同步 + deferred p2-architecture-refactor **只销子项①**(②维持/③标废弃,条目不整删)

## 明确不做(维持 deferred)+ 本次评审新增否决
快照栈结构共享、persist/checkpoint messages 增量、MessageList 虚拟化(C 落地后 profile 复判)、estimateTokens 扫描共享、dataOps 拆分、中间件样板抽取(YAGNI)、html 工厂选项拆组(设 ≤24 提醒即可→登记 deferred)、**@langchain/openai optional peer(否决:前提为假)**、**checkpoint restore 内部加锁(破坏性 API,deferred)**。评审裁出的其余 8 条静默丢失项全部登记 deferred(清单见 tasks.md 文末)。

## 验证策略
- Batch A:三套测试计数不变(纯文档/守卫增量);A8/A9/A11 断言自身绿
- Batch B-F:每批同 commit 补「正常 + 边界」测试(**B3/B5/B6/C3/B11 原漏标已补进 tasks**);三套全绿 + test:exports/types/alignment/size;B1 必须含真锁路径(非 stub)回归;C 必须附 bench 前后数字 + 响应性守卫三件;F 每阶段加 test:exports/types
- 每批尾统一任务模板:CHANGELOG 分类 → 计数+模块数同步(check-test-counts.mjs)→ deferred 对账 → 双语文档
