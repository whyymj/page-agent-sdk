# Tasks:2026-09-09-audit-remediation

> 打勾标准:任务完成 = 代码/文档落地 + 对应测试绿 + 计数同步。
>
> **v2 修订(2026-09-09)**:经四路方案评审(`local/plan-review-{batchB,batchCD,batchEF,completeness}.md`,逐项对照 4.11.1 源码核验)重排:**原 Batch D 并入 B**(D2 修真实数据损路径,严重度高于性能,与 B6/B9 同落 dataOps 互锁区一个 commit 系列做完)、**B8 移 E 批**(新增公开导出面属 minor,patch 携带违 E5 自立纪律)、**原 E4 否决**(前提为假,见 proposal 修订记录)、**原 E3 移 F 前置**(8 处 cast 中 6 处落在 F2/F3 搬移区,单独先发必产冲突)、**F2 拆两步 + 三前置项**、C1/C3 修形态、版本号定死(B=4.11.2 → C=4.12.0 → E=4.13.0 → F=4.14.0,串行)。
>
> **批尾统一任务模板**(每批最后一条,勿再遗漏):CHANGELOG 分类正确(fix→Fixed / 行为变化→Changed)→ 计数+模块数同步 → `node scripts/check-test-counts.mjs` → deferred 对账(可销账项销、新残项登记)→ 双语文档同步。

## Batch A:文档元数据 + 守卫(零行为变化)— ✅ 已完成(6986a54 + 本次勘误)
- [x] A1 CHANGELOG 4.11.1 计数勘误(selftest +22 漏报 / e2e 1077→1085 实为 +13)
- [x] A2 README.md + README.zh-CN.md 徽章 3212→3375(两处)
- [x] A3 CLAUDE.md 清单补全:e2e 模块 +3、selftest 模块数、browser spec 枚举对齐 153(抗腐化形态)
- [x] A4 CLAUDE.md「内层 maxRetries 恒 0」表述收窄 + createChatSdk.ts:242 JSDoc 600s→1800s
- [x] A5 doc/README 双语索引补 real-llm-regression.md + EN 链接;node 冒烟「4.10+」→「4.11+」×3
- [x] A6 usage-guide 双语钩子表补全 10 契约点 + 章节重号修复
- [x] A7 capabilities.ts 注释 17/21→18 开关(附「以 CAPABILITIES.length 为准」防再漂移)
- [x] A8 tests/types.test-d.ts 补 DialogIcons(18 键)/DialogConfig(15 键)键集 Pick 断言
- [x] A9 scripts/check-test-counts.mjs 计数对账脚本 + CLAUDE.md 双挂钩
- [x] A10 **A3 自回归勘误**(评审发现):CLAUDE.md「116 个模块」实为 **115**(sec-*.ts 文件数与 runner import 数双向实测一致)
- [x] A11 check-test-counts.mjs 增 **selftest 模块数对账**(CLAUDE.md 声明 vs modules/sec-*.ts 实际文件数,漂移即红)—— 模块数自此入机械守卫
- [x] A12 deferred.md 对账:2026-08-18 DialogIcons 断言债标 ✅ 兑现;数据写链#6 加 C2 辨析注记(否决的是跨调用缓存,C2 是同调用内时序);新登记评审残项(E4 否决/checkpoint restore 锁/B6 叙事修正/尾部卫生项 8 条,见 deferred.md 2026-09-09 段)

## Batch B:稳定性小修 + 互锁补面(4.11.2)— ✅ 已完成(2026-09-09,实现注记见 CHANGELOG [Unreleased])
> 原 Batch D 工具面并入(D2 修真实数据损路径 > 性能优化,且与 B6/B9 同落 dataOps 互锁区 :1038-1207,一次回归面)。原 B8 移 E3。总量 3-5 人天偏满:**B1(P1)可先行合入不等全批**;B9 复现受阻立即解绑挪 deferred 不阻塞其余项。
- [x] B1 **P1** COMPONENT_BUSY 回灌 toolError 化(subagent.ts:939 裸串无 ERROR: 前缀且 status='done' → createAgent.ts:1143 rejectedDelegations 恒不命中)+ **真锁路径**(非 stub)回归。配套缺一即回归红:① toolError hint 保留实测调优文案 ② capability-packs.mjs:981/1097 断言同 commit 更新(现断言 `startsWith('COMPONENT_BUSY')`)③ failStreaks 噪声显式决策(接受或按 code 排除)④ 事实清单「其中 N 次被拒未生效」链路打通验证
- [x] B2 gateChain 状态询问层补句尾问号豁免(层号以 gateChain.ts 实物为准,tasks 原表述有层号错位)+ 完结门禁耗尽补 `COMPLETION_GATE_EXHAUSTED` observable(命名对齐 ZERO_TOOL/AUDIT 族);observable 分支统一补 debugLogs;inspect 专项反射砍掉(通用门禁计数归 E 批再议)
- [x] B3 预构造 LLM 实例内层重试检测:**字段修正为 `caller?.maxRetries`**(原方案 `(llm as any).maxRetries` 在本仓库钉的版本下恒 undefined = 死代码;LangChain 缺省是 **6 次不是 2 次**)→ 装配期 + setLlm 双入口 warn + observable;CLAUDE.md「实例路径内层默认 2 次」数字同 commit 再修
- [x] B4 NO_ACTION_RE 全文命中 → **首子句窗口级** EXAMPLE_REQUEST_RE(示例/例子/示范豁免;全文级会漏判「句中含示范但真要求操作」,窗口级与现有动词锚定同构)+ selftest 误伤/漏判双向回归
- [x] B5 早退路径(SYSTEM_PROMPT_OVER_BUDGET/compressInput 抛错)afterAgent 缺失:**修法改为 try 边界上移至 runBeforeAgent 之后**(一处修覆盖现有+未来全部早退,优于逐点补调用)+ 消费方安全性已核(craftNotes commit/checkpoint 幂等);补测试(原方案漏标)
- [x] B6 并行双冲突自动收口 prev 留痕:**通道修正为 emit observable + debugLogs**(原方案 audit 通道在该分叉不可达);W1 叙事修正(superseded 穿透 ConflictResolution 类型面)移出本批 → deferred(触发:真 LLM 实到该分叉);补测试(原方案漏标)
- [x] B7 debugLogs 单条 ~8KB 截断 + args 大值占位:**chokepoint 化**(log()/pushLog() 收敛点浅两层扫描,优于逐写入点)+ 截断保前缀;CHANGELOG 进 **Changed** 段明示诊断保真度变化;核 diagnostics e2e 断言影响;test:browser 建议跑(DebugDrawer 展示面)
- [x] B9 eval transform beforeBind 锁内化(dataOps.ts:1506 在 acquireWriteMutex :1507 之前,与 commitSetToBind/applyPatchesToBind 参照形态不一致证实):**复现先行**(并行时序用例证伪/证实);修复锚点 = **handleConflict 裁决后(:1512 return 之后)、pushSnapshot(:1517)之前** —— 仅「移到 acquire 后」仍跨 ask 拆段窗口,陈旧问题只修一半;复现受阻即解绑挪 deferred。**注记:可达性分析证实现阶段不可达(兄弟写临界段全同步,克隆与 acquire 相邻无 interleaving 窗口),对齐性修复仍落地防未来临界段加 await 即静默可达 —— 详见 dataOps B9 注释**
- [x] B10 (原 D1)restore_data / resource_update 补 acquireWriteMutex + **controller.updateResource(:1131,评审新发现第四锁外写点)**;无死锁/重入路径已核,未武装 no-op 语义自动继承;**checkpoint restore 不含**——restore() 同步 + mutex 闭包私有,内部加锁会把 `restoreLastCheckpoint(): boolean` 变 Promise = 破坏性 API,且 B11 校验兜底后边际价值最低 → deferred(触发:checkpoint restore 真实并发场景)
- [x] B11 (原 D2)restore 裁决恢复点新鲜度校验(锚 = 裁决者所见 hash,同 overwrite 路径形态)+ **锚定 miss 显式出错不回落 last** + ConflictInfo.snapshotId 真实锚定(零消费方破坏已核)+ audit 留痕;配套:① :1189-1190 同调用双算 hash 消重 ② **裁决分支 setBaseline 补传 per-call scope**(评审新发现:并行 CA 基线错刷)③ e2e conflict 模块测试(原方案漏标)
- [x] B12 批尾统一任务(模板见顶部;B3/B7 需 CHANGELOG 明示行为变化;B10/B11 落地后 deferred 数据写链面顺手销 struct#10 autoLock 墓碑 —— **实际未销**:评估为纯注释化妆(dataOps 11 处墓碑多为历史说明),不值当为本批再添 diff,deferred 触发条件已改「下次 dataOps 大改时」)

## Batch C:性能包(4.12.0)— ✅ 已完成(2026-09-09,实测数字见 CHANGELOG [Unreleased] 性能包段)
> 与 B 批无硬依赖(读侧 vs 写侧),排 B 后;bench 基线天然对着 B10/B11 后代码采集。
- [x] C1 reactive 读侧解包:**形态改为读入口单点 `rawBind()` 解包**(优于五个深点各补一行 toRaw);入口清单在方案五处(hashBind :1037/快照 clone :571,:621,:1145/summarize :808/checkpoint save :158)之外**补全**:baseline-guard guardHash、previewWrite、子 scope safeStringify 经 proxy、projectBySchemaDeep union 穿透。**陷阱(评审关键发现)**:checkpoint `getData` 是读写双用口——解包只能加在 save 侧/clone() 内,若接线处 toRaw 会让 restore 写 raw 绕过响应式触发 → 宿主页面不刷新;currentValue(:1177)与 inspect()/controller.get() 两处**不得动**。依赖收集风险实测为零(核心无 watch/computed 读 bind)。**响应性守卫测试(原方案最大盲区)**:selftest(write 后 proxy 仍触发 effect)+ browser complex-demo + 落地后 `npm run test:real -- --baseline-diff` 一次(token/toolCount 零漂移 = 端到端证据;**注:网关 anthropic 臂断流期,环境可用后补跑**)
- [x] C2 read 惰性 hash(hash 确在路径校验前算;失败读零成本):**不破坏「恒实时计算」不变量**(禁的是跨调用缓存,C2 是同调用内时序)—— deferred 数据写链#6 加辨析注记防下次审计误翻(A12 已办);收益口径收窄注明(多路径分支输出恒含 hash=,仅单路径失败读受益)
- [x] C3 vfs 池计数 O(1):**形态改为闭包 Map 计数器,不加 VfsFile.bytes 字段**(避免持久化/类型面/checkpoint 副作用);现状比方案描述更重(每写 **5 次**全池 TextEncoder 重扫);**5 类失效点全覆盖**:trap set/删、enforceLimit raw 删、hydrate、clear、构造 —— 漏一个 = 过度淘汰(vfs_read 404 族回归)或池失守;补持久化容差测试(原方案漏标)
- [x] C4 bench 脚本入库:**并入既有 `tests/perf/`**(先例明示不进 CI),不新建 tests/bench/;手动运行 + 可选宽阈值检查,不做 CI 门禁
- [x] C5 CHANGELOG 实测数字口径修正:**-44~65%**(整体 set 实测 44%,低于原宣称下界 50%)且限定「reactive 集成形态受益,raw bind 集成零变化」;usage-guide 补性能注意事项(maxSnapshots 随 bind 体积调低提示)
- [x] C6 批尾统一任务 + deferred 销账(N4 reactive 放大、持久化#8 视 C3 落地形态)

## Batch E:API 面收口(4.13.0)
> 原 E4 否决、原 E3 移 F 前置、原 B8 移入本批(E3 位)。E 批纯 types/文档 + 导出面,零运行时风险,排 F 前(E1 签名门禁反哺 F,拆分期间 d.ts 不变量单一)。
- [ ] E1 Middleware 10 钩子真实签名(harness/middleware.ts:82-106 → d.ts:2003-2007 现全 any)+ ModelRequest/ModelResponse/ToolCallContext/StateUpdate 投射;**隐藏工作量(评审发现)**:d.ts 须一并投射 5 个成员类型(HarnessState+Todo/VfsFile/SkillMeta/SummarizationEvent/LoopProgress);核心 5 工厂 any 补齐(d.ts 816/1854/1857/1991/2190);types-alignment 增签名级**互赋值断言 `Same<A,B>`**(现有 41 行 keyof 模式可扩展,机械可执行);minor 定级成立(收紧只打击「新鲜字面量拼错钩子名」——该类代码运行期本就静默失效)
- [ ] E2 vue 类型解耦:内联最小类型桩(~15 行)胜出 typesVersions 双 d.ts 方案;**headless.d.ts 必须一起解**(原方案遗漏::8 也 import vue,19 处引用);「无 vue 项目 tsc 验证」**完全脚本化**(tsconfig paths 阻断 vue 解析 + 静态 grep 断言,进 exports-consistency),不需人肉;严重度校准:skipLibCheck:true(脚手架默认)下是类型退化非编译失败
- [ ] E3 (原 B8)headless 补 8 个非 UI 导出(moveByPath/detectTransitionalReply/sanitizeGarbledContent/normalizeBaseUrl/stripStainlessFetch/DEFAULT_SYSTEM_PROMPT_EN/htmlFragmentSkill/buildHtmlFragmentSkill)+ **types/headless.d.ts 同步(别漏)** + exports-consistency 第三向断言(主包非 UI ⊆ headless);semver 定性:新增公开导出面归 minor(与本批一致,E5 纪律自洽)
- [ ] E4 (原 E5)semver 纪律成文 + **4 漏洞补丁**(评审发现):①「三版零调用」证据来源定义(自家真 LLM 基线 + e2e 调用计数,不得声称第三方遥测)② 覆盖**语义反转**形态(不只移除;4.1.0 exec.context:'host' 反转正是此形态漏网先例)③「公共面」枚举清单成文(与 E1 类型收紧判例互引防自相矛盾)④ deprecation 窗口机制(移除前一 minor 在 d.ts JSDoc 标 @deprecated);4.1.0/4.9.0 回溯标注
- [ ] ~~E4 原案 @langchain/openai → optional peer~~ **否决**(前提为假:`ChatOpenAI` 在 constructLlm.ts:15 / proxyLlm.ts:30 / **createAgent.ts:11** 三处静态 import,vite external 后发布产物顶层硬依赖;改 optional peer = Anthropic-only 用户加载即崩 + esm.sh 路径断;真做需 async 化重构 L 级且破坏 setLlm 同步契约)→ 替代:usage-guide/README 文档化现状 + deferred 登记拒绝理由(A12 已办)
- [ ] E5 批尾统一任务 + §4.5 发布后临时安装深化验证(node 实际调用本次新导出,不只 require 成功)+ usage-guide/README 依赖说明处明示「@langchain/openai 为事实必需依赖,optional peer 化已评估否决」(E4 否决的替代动作)

## Batch F:createChatSdk 三阶段拆分(4.14.0)
> 行号全核验属实(3318 行/buildCore 945-2975=2031/类型段 98-648/core 字面量 1782/包装 2977)。「靠 e2e+browser 兜底」判断正确(selftest 触不到顶层作用域)。与 E 批**串行不并行**(同文件同区域硬冲突)。
- [ ] F0 前置项(动工雷区,三件必须先做):
  - [ ] F0a skillsMw compose 数组内赋值微修(struct#3 HIGH,评审明示「重构极易踩断」)
  - [ ] F0b (原 E3)controller 通道 ControllerCarrier<T> 类型化:**8 处 as any 非 6 处**(补 1618/2967-8);6/8 落在 F2/F3 搬移区,单独先发必产冲突,并入前置后 SessionDeps 直接携类型化 controller
  - [ ] F0c autoTitle stub e2e 模块补建(**全库唯一零覆盖盲区**:e2e 现有用例全是 `autoTitle:false`,标题生成路径恰在 F2 拆分区)
- [ ] F1 Phase 1 类型段 L98-648 → sdk/options.ts(re-export 保符号,零行为风险)
- [ ] F2 Phase 2 **拆两步**(评审:真正难点不是 15+ 依赖面,而是 lastTitle/lastPlanConfirmation 等**可变闭包状态归属**):F2a sessionVars 显式收敛(状态归位,带测试)→ F2b 函数抽取 sdk/sessionLifecycle.ts(SessionDeps 接口);一步到位会复刻 P0-4 ReferenceError
- [ ] F3 Phase 3 三座小岛(images → imageInput / MCP 连接 IIFE → mcp/connectAll.ts / 工具装配 → sdk/toolAssembly.ts)
- [ ] F4 每阶段门禁:selftest + e2e + browser 全绿 + **test:exports + test:types**(「re-export 保符号」目前是无守卫的口头承诺,必须机械化)
- [ ] F5 CLAUDE.md 目录结构同步 + deferred p2-architecture-refactor **只销子项①**(createChatSdk 拆分);②createAgent 契约化零回归证据维持 deferred;③read/get_data 合并已被 4.9 消费应标废弃 —— 条目不整体删除

## Deferred 登记清单(评审新增,随 A12 写入 openspec/deferred.md)
1. @langchain/openai optional peer —— ❌ 否决留痕(三处静态 import,前提为假;async 化重构需破坏 setLlm 同步契约,无消费者诉求)
2. checkpoint restore 加锁(原 D1 部分)—— 破坏性 API 面(同步→Promise);触发:checkpoint restore 真实并发场景
3. B6 W1 叙事修正(superseded 穿透 ConflictResolution)—— 触发:真 LLM 场景实到该分叉
4. api#6 config 61 键 + 未知键零告警 —— 与 config-surface-pruning round3 / CO fail-fast N3 合并触发
5. api#11 html 工厂选项 ≤24 软上限提醒(已拍板未立任务 → 登记待触发)
6. perf#7 dataHint memoize
7. struct#7 反向 import / #8 emit as any / #9 verify 旧标签 / #10 autoLock 墓碑收敛(#10 可随 B 批顺手销)
8. drift 弱点2:真 LLM 契约层无确定性兜底(stub 与真 LLM 行为分叉只能靠真 LLM 套件抓)
9. B3 延伸:CLAUDE.md「默认 2 次」→ 6 次数字修正随 B3 同 commit(非 deferred,登记备忘防漏)
