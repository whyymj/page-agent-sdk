# Tasks: parallel-subagent-delegation

> 实施任务清单。`/opsx:apply` 按此执行。**minor**(向后兼容)。**分两批实施**(评审裁定,proposal 决策 10):
> **第一批**(便宜无争议,先让「能并行」发生):P 段 prompt 并行化 + 失败隔离 + commit 容错;
> **第二批**(第一批真 LLM 实测确认并行行为后):Q 段锁全链 + 写检查 + 人工并发检测 + 观察层。

## 第一批

### 阶段 P1:编排 prompt 并行化(`src/core/presets.ts`)

- [x] P1a htmlOrchestratorPrompt「多组件逐个委派」段升级(design §6):不同组件可同轮并行发多个 use_<id>(每次仍独立子 agent)/ 同一组件同一时间只能有一个委派(第二批框架互斥,当前先靠 prompt 禁令)/ 一次 task 塞多个组件禁令保留 / 主 agent 自己的 write 可与委派同轮混排 / 并行生效依赖 maxParallelTools>1 说明留给文档
- [x] P1b usageHints subagent 段补一句并行提示(若与 P1a 重复则跳过留痕)—— **跳过留痕**:usageHints 已有 spawn_agents 并行提示,use_<id> 并行引导属编排段职责,不双份注入

### 阶段 P2:commit 逐组件容错 + 失败隔离锁定

- [x] P2a `codeAssetMiddleware.ts` afterAgent commit 的 `forEachCodeItem` 回调加 per-component try/catch(design §4.6):单组件抛错 → 跳过该组件 + observable 留痕(console.warn,与 F2 同通道;afterAgent 无 debugLogs 通道),循环继续不中断后续组件 commit
- [x] P2b e2e(stub model)失败隔离:同轮双 use_html 中 A 抛错 → B 组件照常落地 + A 以 error result 回灌主循环继续(4 断言);commit 单组件抛错(accessor setter 构造)→ 其余组件仍 commit + 留痕(4 断言);patches 原子批行为不变(既有 data-slots 测试全绿)
- [x] P2c 串行默认零变化断言(不开 maxParallelTools 的既有 e2e 全绿即锁定)—— 全量 e2e 625 项 + browser 61 项全绿
- [x] P2d selftest 同步:sec-31 htmlPageOrchestrator 断言更新为并行引导文案(逐个委派 → 并行发多个 + 同组件单一在途)

### 阶段 P3:第一批文档与发布

- [x] P3a README 中英 + doc/usage-guide 中英:并行委派说明(maxParallelTools>1 配置 + 失败隔离语义 + 当前同组件互斥靠 prompt、机制锁在下批)
- [x] P3b CLAUDE.md 子 agent 段补失败隔离契约 + 测试计数同步(2061/625/61);CHANGELOG [Unreleased]
- [x] P3c 门禁全绿(build/test 2061/e2e 625/browser 61/exports 14/types×2/size 5/pack 干净)→ **待用户确认 bump+commit+发布**
- [x] P3d 真 LLM 复验:`tests/runtime/parallel-delegation-real.mjs`(complex-demo + flash)7/7 全绿 —— Round 4 同轮 `write + use_html×2` 混排、maxActiveSubagents=2(真并发)、两组件落地、零致命错误。前置修复:complex-demo 旧 systemPrompt「勿一次委派多个」与并行引导矛盾 → 改为可并行;补配 `maxParallelTools:3`。**第二批前置已满足**

## 第二批(前置:P3d 确认并行行为发生)

### 阶段 Q1:组件锁纯函数(`src/core/sdk/componentLock.ts`)

- [x] Q1a `createComponentLock()`:acquire(多组件原子,任一被占全失败且已取得的释放,**非阻塞无排队**)/ release(幂等)/ locked() 视图;导出 `ComponentLock` 类型
- [x] Q1b `resolveTargetComponents(args, knownNames)`:explicit(过滤编造名)/ text-match(唯一命中)/ none 三档
- [x] Q1c selftest 白盒(新建 sec-NN):往返 / 原子性 / 幂等 / 视图 / resolve 三档 / 编造名过滤

### 阶段 Q2:use_<id> 委派入口(subagent middleware)

- [x] Q2a `createSubagentsMiddleware` 选项加 `componentLock?` + `resolveComponents?`;use_<id> schema 加可选参 `components?: string[]`
- [x] Q2b handler 包装:解析 → acquire → 跑 → finally release;**acquire 失败立即回灌 `COMPONENT_BUSY`**(design §3,不排队不占槽)
- [x] Q2c 锁事件 debugLogs 留痕(acquire/conflict/release)
- [x] Q2d createChatSdk 装配接线:codeAssetMiddleware 文件地图 name 列表作 knownNames getter 传入

### 阶段 Q3:主 agent 写检查 + commit 冲突检测(dataOps / codeAssetMiddleware)

- [x] Q3a codeAssetMiddleware 加 `getLockedPaths()`(锁名 → jsonPath 前缀,**检查时实时解析** name→index,防索引位移陈旧)
- [x] Q3b dataOps wrapToolCall(主 agent 侧):写目标命中锁前缀或整体 set 且有在途锁 → `COMPONENT_LOCKED` recoverable 回灌;dryRun 不拦
- [x] Q3c 人工并发 commit 冲突检测(design §4.5):beforeAgent checkout 记组件级 code hash 进 state(`__pgCodeHashes`);afterAgent commit `setByPath` 前比对不一致 → 跳过该组件 + observable 留痕(keep_external 人工优先);孤儿清理删 vfs 文件前补留痕

### 阶段 Q4:观察层

- [x] Q4a inspect().subagent 补 lockedComponents;types/index.d.ts + types/headless.d.ts 同步
- [x] Q4b DebugDrawer「🤖 子 agent」tab 锁展示一行

### 阶段 Q5:第二批测试

- [x] Q5a selftest:Q1c + Q2b 回灌语义(stub)+ Q3b 锁内写拒/锁外放行/dryRun 不拦 + Q3c hash 比对纯函数 —— sec-77(31 断言):锁往返/原子/幂等/三档 resolve/前缀实时解析/写守卫 7 场景/hashString/H1-H3 白盒;selftest 2061→2092 全绿
- [x] Q5b e2e(stub model):同轮双 use_html 不同组件均落地 + 同组件第二个 → COMPONENT_BUSY 回灌后重委派成功 + 主 agent 写锁组件回灌放行 + 串行默认零变化 —— capability-packs.mjs 增 4 场景 19 断言:并行双委派(acquire/release 留痕×2)/同组件 busy 后重委派(7 次调用证零 model 消耗)/主写锁组件(时序锚 slow_probe 80ms 确保锁先持有)/默认串行零变化;e2e 625→655,8+3 次连跑确定性全绿
- [x] Q5c browser(mockLlm 同轮双 tool_calls):两 custom code 均更新;page-demo/html-page 选一 —— complex-demo.spec.ts(maxParallelTools:3)增 2 test:并行双 use_html 两组件均落地(6 调用)/同组件 busy 重委派(7 调用);browser 61→63 全绿
- [x] Q5d 人工并发 e2e(stub 控制节奏 + 直改 bind 模拟人工):H1 同组件 code 人工改 → 人工值保留+留痕 / H2 删除组件 → 不复活+vfs 清+留痕 / H3 索引位移 → __pgId 定位落同组件 / H4 改其他组件互不覆盖;无人工修改时 commit 与现状一致 —— capability-packs.mjs H1-H4 真链路(子 model delayMs 250 撑开在途窗口 + setTimeout 80ms 直改 bind):keep_external 保留人工值+留痕 / 删组件不复活+vfs 清+留痕 / 索引位移 __pgId 落同组件 / 改其他组件互不覆盖;3 次连跑全绿
- [ ] Q5e 真 LLM 复验(手动):两纯代码组件同改 → 并行发生 + 同组件冲突回灌可见 + 墙钟对比;**人工并发真场景**(委派进行中浏览器直改/删组件 → 冲突判定与留痕可见);记 doc/CLAUDE.md
  - 进展(2026-08-16):用户实测「轮播+粒子特效双组件」发现 **UI 归属错乱** —— 并行真发生,但两个子 agent 思考流全混进最后一个 step(只见一个 agent 在思考)+ 同名 use_html result 交叉错配。已修(tool_call/tool_result 事件带 id、subagent 事件带 toolCallId、useChat 按 id 归属;e2e+5/browser+1);余:同组件 busy 可见 + 墙钟对比 + 人工并发真场景

### 阶段 Q6:第二批文档与发布

- [x] Q6a README 中英 + doc/usage-guide 中英:组件互斥机制语义(COMPONENT_BUSY / COMPONENT_LOCKED / 人工并发 keep_external)—— usage-guide 中英各增「组件锁 · 同组件单委派互斥」整段(三契约+锁目标解析+观察层),README 中英 maxParallelTools 行补「同组件锁互斥」
- [x] Q6b CLAUDE.md:子 agent 段「同轮并行委派」改为 3.13 定稿 + 新增「组件锁」整条(含守卫同步段时序注意);测试计数 2061→2092 / 625→655 / 61→63(README 中英 badge 同步)
- [x] Q6c CHANGELOG:第二批 Added 段(组件锁/写检查/人工并发检测/观察层)+ Tests 段;openspec/deferred.md 核对无残项(引用本 change 的后台收割/流水工具两暂缓项与组件锁无关,保持暂缓)
- [x] Q6d 门禁全绿(build + selftest 2092 + e2e 655 + browser 63 + exports 14 + types + alignment + size 5 + tsc src 门禁 + pack dry-run 无敏感文件)→ bump 3.13.0 → commit → 询问用户是否发布
