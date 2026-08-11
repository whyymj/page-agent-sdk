# 结构健康专项审计(A1-A5)· audit-sdk-integrity

> 基线 2.38.0(develop @ 254090d)。全部 finding 经代码/文件核实,附 file:line 证据。

## Findings(严重度降序)

| # | 严重度 | 类别 | 位置 | 结论 | 证据 | 修复建议 |
|---|---|---|---|---|---|---|
| A-1 | P1 | doc-drift | types/index.d.ts:780 + types/headless.d.ts:780 + src/core/sdk/createChatSdk.ts:227-248 | `capabilities.agentCompression` 运行时存在(注册表 21 开关、createChatSdk.ts:1043 消费)但 src 内联类型与两份 d.ts 均只声明 20 key 未含它 → TS 集成方写 `capabilities:{agentCompression:true}` 报 excess-property 错,运行时却生效 | capabilities.ts:57 注册表 21 项;e2e agent-compression.mjs 走 JS 无类型检查故全绿;test-d `_capKeys` Pick 只锁 17/21(漏 agentCompression/focus/contextInspector/skillHostScript) | 三处 capabilities 类型补 agentCompression;test-d `_capKeys` 扩到注册表全 21 名 |
| A-2 | P1 | doc-drift | types/index.d.ts:870 + types/headless.d.ts:860 | d.ts `send(message, options?:{mission?})` 缺 SendOptions 的 interceptors/maxAutoRetries(src 内联 createChatSdk.ts:362/514-518 齐全)→ TS 用户用 send 级 input/output 拦截器或 automation 重试无法过类型检查 | 两份 d.ts grep send 签名均只 `{mission?}` | d.ts send options 补全 SendOptions 形状(两文件同改) |
| A-3 | P2 | test-blindspot | tests/exports-consistency.mjs + tsconfig.test.json | H7 盲区坐实:d.ts↔src 实现的结构对齐零机械门禁 —— test:exports 只比导出名集合(且 types 多余名仅 console.log 不 fail,mjs:42);test:types 的 include 只 types/*.d.ts+test-d 不含 src,字段级 Pick 仅覆盖手挑的 37/59 ChatSdk 成员;2.38 getActiveSubagents 同型(d.ts 声明了实现漏)仍可复发,只剩 e2e 运行时兜 | tsconfig.test.json include 仅 3 文件;agentCompression/send options 即本审计抓到的两个活漂移 | 新增 tests/types-alignment.ts:d.ts ChatSdk/ChatSdkOptions/AgentInfo ↔ src 内联接口双向条件类型互判,用同时含 src 与 types 的 tsconfig 编译;exports-consistency 多余名改 fail 或显式白名单 |
| A-4 | P2 | flow-divergence | src/core/sdk/createChatSdk.ts:1229 + src/core/sdk/middlewareStack.ts:9-28 | 中间件顺序契约不一致:注释称「mission 在 todos 前(pin 段在 todos 段前)」,但 mission/workingMemory/focus/resourcesPin/contextInspector/budget 均不在 MIDDLEWARE_PRIORITY → Infinity,composeMiddlewareStack 实际把它们排到全部数字中间件(含 augmentSystem 150)之后;实际序 …subagents→augmentSystem→mission→workingMemory→focus→resourcesPin→contextInspector→用户→budget→sdk-events | mission.ts:59 / workingMemory.ts:64 / focus.ts:94 / resourcesPin.ts:16 的 name 均不在优先级表;sort 按 (p, idx) | 要么给 pin 中间件显式 priority(如 mission 25)锁住注释意图,要么改注释/CLAUDE.md 装载序为实际序;二者必居其一,勿留双真相 |
| A-5 | P2 | maintainability | vite.headless.config.ts:36-39 | css exports 修复后残留回归面:headless 构建 assetFileNames 把任意 css 映射为 'style.css',构建序 lib→headless→iife 且 emptyOutDir:false —— 将来 headless 子树出现任何 css import,build:headless 会覆盖 dist/style.css(现 48KB UI css) | dist/style.css 由 build:lib 产;headless config 注释自认「兜底」 | headless css 映射改 'headless.css' 或出现 css 直接 throw |
| A-6 | P2 | performance | src/core/tools/dataOps.ts:170/340/447-448/491/517/645/658/705/824/851/868-869/1055 | A3 惰性 hash 推后项复核:未实施;hashValue(bindRef) 全量同步,edit/write 单路径调 2-3 次(冲突检查+lastReadHash+返回消息各一次),几百 KB bind 每次写操作 O(n)×3 | grep 15+ 处 hashValue(bindRef) 调用点 | 维持 P2,是推后清单里最值得做的性能项;实施用 WeakMap 缓存+脏标(design 已标注防缓存污染自引用坑) |
| A-7 | P3 | test-blindspot | src/core/__tests__/modules/sec-21.ts:117-123 | 唯一 sort 测试只锁 dataHint/usageHints/customUser/sdk-events 四个名;四个 pin 段的相对声明序(mission→workingMemory→focus→resourcesPin)无断言,新 builtin 插入其间时 system prompt 段序静默漂移 | 测试输入数组仅 4 项 | 补 pin 段相对序 + 全 builtin 顺序断言(可借 inspect().middleware) |
| A-8 | P3 | maintainability | src/core/sdk/createChatSdk.ts:593 | AgentCore.send 签名陈旧({mission?})未跟 SendOptions 三字段(方法双变性能编译,AgentCore 消费方丢 interceptors/maxAutoRetries 类型);同文件 ~10 处注释仍引用已不存在的「onClear」(已更名 resetSession) | :593 vs :362/:1415;:367/375/379/553-557 onClear 残留 | AgentCore.send 改 SendOptions;清陈旧注释 |
| A-9 | P3 | maintainability | src/core/sdk/createChatSdk.ts 全文 2357 行 | A2 上帝文件评估:**不建议按 p2 子项1 整体拆** —— buildCore 1268 行闭包耦合重(core 定义前被 vfs persist/syncUserSkills 闭包反引、allTools 多处重赋值、lastTitle/titleLLMDone 与 buildCore 局部函数共享),回归风险>收益;2.38 事故属类型面漂移而非文件尺寸逻辑 bug。行段清点:imports 1-78 / 小接口 80-117 / ChatSdkOptions 118-348 / ChatSdk 349-512 / AgentCore+辅助类型 523-695 / matchDataOp+sdk-events 中间件+focus 校验 697-780 / buildCore 装配 782-1281 / core 对象字面量(≈45 成员)1293-1830 / 会话持久化助手 1833-1985 / initDone 1988-2047 / _createChatSdk+59 项代理 return 2052-2357 | 双 return 在 src 内由 `: AgentCore`/`: ChatSdk` 双注解经 tsc 互检(H15 机械成立);漂移面全在 src↔d.ts 与接口间 | 低风险三刀(行为中性,约减 35%):① 4 个大接口(≈700 行)挪独立 types 文件 ② createSdkEventMiddleware+matchDataOp(697-753)挪 sdk/events.ts ③ focus 四工具(950-1002)挪 focus 中间件;本体 + 代理 return 不动,靠 A-3 门禁守护 |
| A-10 | P3 | process-hygiene | openspec/changes/2026-08-03-chatdialog-component-split/{proposal.md,tasks.md} | 拆分已全实施但索引失真:proposal 仍标「未实施」、tasks 46/46 未勾、change 未归档;代码侧 chatContext + message 7 原子件 + MessageList + ChatHeader/ChatInput + QueuedBar/ApprovalBar/ConflictBar/FocusBar + ChatDialog 9 区块 slot/sections 全就位;真未做仅 §9 examples/custom-dialog-demo(拼装示例 demo) | src/core/components/message/* 与 ChatDialog.vue:4/26/98 存在;examples/ 无 custom-dialog-demo | 回填勾选 + 归档;§9 demo 按 deferred 触发条件(集成方要求拼装)未出现,标注删除或保留二选一 |
| A-11 | P3 | process-hygiene | openspec/deferred.md「2026-08-08 审查暂缓项」表 | deferred 索引陈旧:表中 placeholder-protected-read-write(2.32.0 已发布)、agent-driven-compression(2.33.0 已发布)、chatdialog-component-split(已实施)三项均已落地却仍标「暂缓 0%」,违反自定「重启时从本文件移除」约定 | deferred.md 最后更新 b97ec96(2.30.0);caee876/ec829de 为 2026-08-09 发布 | 清理三项;发布 checklist 加一步「核对 deferred 表」 |
| A-12 | P3 | doc-drift | types/index.d.ts:758 + types/headless.d.ts:748 | d.ts maxMemoryRounds 注释「默认 50」,实际 DEFAULT_MAX_MEMORY_ROUNDS=30(2.34.0 改) | createChatSdk.ts:521 | 改两处 d.ts 注释为 30 |

## H7 证伪结论(A1 类型四处同步门禁)

H7 假设「d.ts 声明与 src 实现结构对齐无机械门禁,2.38 事故同型仍可复发」—— **证伪失败,假设成立**。

**哪个门禁抓哪类漂移**:
- **名字缺失**(src 新增导出忘进 d.ts)→ `test:exports` 抓(名集合 diff,12 项断言);但 **d.ts 多余名只打 ℹ 不 fail**(exports-consistency.mjs:42)。
- **d.ts 自身坏 / 抽样字段漂移** → `test:types` 抓(tsconfig.test.json 只编 types/*.d.ts + tests/types.test-d.ts;字段级 Pick 覆盖 ChatSdk 37/59 成员、capabilities 17/21、SubagentConfig 10 字段、SdkEvent 4 分支)。
- **实现缺失(return 漏方法,内联接口已声明)与内部结构漂移** → src 全量 tsc 抓(`: ChatSdk`/`: AgentCore` 双注解;发布门禁走 grep 管道,实测当前真错=0)。
- **盲区(坐实)**:① d.ts ↔ src 结构对齐零门禁(两者从不同编,2.38 事故同型可复发);② 抽样 Pick 外的新增成员默认漏检——本次即抓两个活例:**agentCompression 开关**(三处类型全漏)与 **send options 的 interceptors/maxAutoRetries**(d.ts 漏);③ AgentCore ↔ ChatSdk 无 parity 门禁(core 方法漏代理纯靠纪律)。

**低成本补门禁方案**(≈100 行):新增 `tests/types-alignment.ts`,用双向条件类型互判 d.ts 接口 ↔ src 内联接口(配一个同时 include src 与 types 的 tsconfig;ChatModelLike/any 等故意宽松处按需逐成员豁免)+ `_capKeys` 扩到注册表全 21 名 + exports-consistency 多余名改 fail。

## A4 推后项清单复核结论

| 项 | 现状(已核实) | 触发条件是否仍成立 | 优先级建议 |
|---|---|---|---|
| P1-d 流式重试重复 emit | ✅ 2.24.1 已修(createAgent.ts:441-449 仅 stream 启动重试,迭代中不重试) | — | 移出推后清单 |
| css exports style.css 404 | ✅ 已修(exports 配置 + dist/style.css 48KB + gate 断言);残留 headless 覆盖风险(见 A-5) | — | 关闭;残留归 P2 |
| large-json A2 快照字节上限 | 未实施 | 大 JSON 场景仍成立 | 维持 P2 |
| large-json A3 惰性 hash | 未实施,实测每写 2-3 次全量 hash(见 A-6) | 大 bind 场景仍成立 | **维持 P2,最优先做** |
| large-json A4 子路径 hash | 未实施;前置顾虑(placeholder 重设计推翻)已消除——placeholder 2.32 已上线且未依赖 A4 | 子路径乐观锁冲突场景仍窄 | 维持 P2,可解绑单独评估 |
| large-json B1 draft 中间校验 | 未实施 | 仍成立 | 维持 P2 |
| large-json B2 DRAFT_EVICTED | 未实施(注:design 称「DRAFT_TOO_LARGE 可单独做」亦未见实现,draft 超限仅静默 LRU,只剩 DRAFT_NOT_FOUND) | 仍成立 | 维持 P2 |
| large-json C1 多草稿合并 | 未实施 | 能力增强非必需 | 维持 P2 |
| large-json C2 eval 子树 patches | 未实施(dataOps.ts:641-647 子树 transform=整体 set;patches 模式仅根级) | 大子树增量改省 token,仍成立 | 维持 P2 |
| read/write 投影深度不对称 | P2 留档(main-flow-audit-fixes tasks.md:49),无后续 change 接手 | 仍成立 | 维持 P2 |
| 中文 recall 分词 | 仍存在(contextIndex.ts:17-23 按非 CJK 分隔 → 中文连续段成整 token,recallRounds includes 精确匹配) | 中文长会话压缩召回仍成立 | 维持 P2;低成本方向 CJK bigram |
| checkpoint messages Phase B | 未实施(checkpoint.ts:171 每轮整体 clone;vfs/bind 已脏增量) | 长会话仍成立 | 维持 P2 |
| setLlm modelCaps offload 重算(同批 P2 留档) | ✅ 已修(createChatSdk.ts:1662 setModelCaps + summarization/contextInspector setContextWindow 回灌) | — | 移出推后清单 |
| p2-architecture-refactor 残项 ①(createChatSdk 拆分) | 触发条件「反复改坏」部分满足(2.38 漂移),但属类型面非逻辑面 | 部分 | 改「门禁 + 低风险三刀」,不全拆(见 A-9) |
| p2-architecture-refactor 残项 ②(createAgent 契约化) | 无实际回归 | 未触发 | 维持暂缓(YAGNI) |
| mission-anchor 再评估 | 无独立 deferred 项;mission 陈旧问题归主审计 D1(非结构专项) | — | 交 D1 结论 |

## 一句话总评

结构主体健康:src 内部有 tsc 双注解机械保底、中间件声明式排序大体自洽;真正的系统性缺口只在「对外 d.ts 与 src 的手动同步无任何门禁」——两个活漂移(agentCompression、send options)与 2.38 事故同型,补一个双向类型对齐测试 + 推后清单里 A3 惰性 hash,是投入产出比最高的两件事。
