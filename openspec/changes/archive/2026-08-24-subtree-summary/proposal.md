# Proposal: subtree-summary(大子树摘要泛化 —— 复杂任务的上下文经济地基)

> 状态:**✅ 已实施并随 4.0.0 发布**(2026-08-24 Phase 0 + Phase 1 全部完成:四门禁 2984/967/111;真 LLM 门禁登记 deferred 待网关。实施修正:placeholder 指纹用 hashValue 避免 tools→sdk 层倒置;complex-demo 实测重页面全量读下 components.0 整体被摘要 → 「骨架直写」精确为「写路径未落入摘要面」)。优先级 P1(SDK)。目标仓库:zhuanti-agent。
> 驱动:目标演进到「多种页面任务 / 复杂 JSON 编写 / 纯 H5」—— 大数据下主 agent 上下文是头号瓶颈。main-surface-slim 实测了问题(42 工具 + 3.9K 提示词,单任务 ~70 万 prompt token,遵循率随规模衰减)但解法形态错(配置开关,3.43 回退)。本 change 是同一问题的**正形解**:砍内容面,不砍工具面,自动阈值零配置。

## Why(现状核实,复审纠正)

- 大文本摘要模式已在产线十余版本:`dataOps.ts summarizeLargeText` 是「数组元素内标记字段的 string 叶子替换器」(主 scope `<code NKB>` / 子 scope 全文;阈值 200 字符;read/query 同 isMain 语义;四处调用面 get_data:949 / query:1149 / read 多路径:1298 / read 单路径:1354 可全部复用)。**按字段名标记 + `!specs.length` 早退** = 非 htmlSubagent 集成今天零摘要,且泛化不是「扩展」而是重写判定核心(需自底向上聚合子树序列化体积,O(n) 不能逐节点 stringify)。
- 摘要与投影的顺序现状已符合 C1 红线(投影 → freeze/verbatim 占位符替换 → 摘要,摘要算的是投影+占位符后的值,保持此位置);query_data 无 renderReadPlaceholders 是既有缺口(知悉,不在本 change 修)。
- main-surface-slim 教训(写死):问题真实,但「配置开关砍工具面」转嫁决策成本,被回退。正确形态 = **自动行为 + 明确击穿通道**,不新增任何开关。

## 场景(详细)

- **S1 骨架直写(零额外轮次)**:「把首页标题改了」—— read components 返回骨架+占位,`title` 是小标量**永不摘要**,直接 patch `components.0.props.title`(未落入任何摘要子树,守卫恒放行)。
- **S2 深改单组件(+1 轮)**:改 banner 配色 —— 骨架见 `<subtree 4.2KB keys:[bg,colors,layout] #a1b2>` → 窄读 `read('components.0.props.style')`(**结果根豁免 → 返回全文,显式新契约非既有意外**)→ patch。同 invoke 内该全文已进历史,后续轮直接引用不重复读。
- **S3 跨子树内容检索**:「找出所有带『限时』文案的组件」—— `search_data` 按 expr 命中路径+片段(SearchHit 形态现状支持,**维持现状不摘要**,已有 200 字符片段截断)→ 逐路径窄读或整批委派。
- **S4 委派(标准形态)**:主 agent task 只给 jsonPath + 目标;子 agent `enterScope` 后 isMain=false 读全文写自己那块,收口只回结论。
- **S5 无子 agent 单干**:主 agent 自有 `set_focus` 工具族 —— `set_focus('components.1')` → **聚焦子树内 read 全文(含其内部嵌套大子树,任意深度豁免前缀)** → patch ×N → clear → 下一区域。每区域 +1 轮 set_focus,非每字段 +1。
- **S6 防事故(flash 形态)**:①凭占位符印象下内容结论;②猜路径盲写 —— 路径无效被校验拦(可恢复),**路径有效但语义错位是唯一静默危险面** → read-before-write 守卫接住(见原理 5)。

## 原理(复审修订)

1. **拦截点**:read/get_data/query 结果组装层(现 summarizeLargeText 位置,投影+占位符之后),四处调用面复用。判定从「字段名标记」改为「自底向上聚合的子树序列化体积 ≥ N KB」(标记字段形态保持兼容)。
2. **摘要形态**:`<subtree 4.2KB keys:[bg,colors,layout] #a1b2>` —— 体积 + 1-2 级键名(**键名取自投影后的值,禁止回落 bind 实际键**;未标记的大 string 叶子(如 20KB description)入摘要面)+ 内容指纹(用 `#` 前缀,**禁用 `hash=` 字面量** —— workingMemory 从 read 结果文本捕获第一个 `hash=`,占位符带该字面量会污染 lastHashes)。指纹仅供 LLM 比对内容新旧:**不接乐观锁**(锁 hash 是整 bind 埈域,write 无 hash 入参)、**不接 stale-read 失效**(该机制为纯路径重叠判定)。数组记 K children;小标量(id/type/title/开类枚举)永不摘要。
3. **三条击穿通道(全部为显式新契约,非既有行为延伸)**:
   ①**窄读** —— 摘要器新增「结果根豁免」参数,read 单路径 / read 多路径(每条路径各自为结果根)/ get_data 三处传入;现「读标记字段返全文」是「非 object 根早退」的结构性意外,泛化后结果根必然命中摘要,**不豁免即黑洞且分页静默失效**;query_data 命中值**不做**根豁免(检索工具返回占位+path 正是 S3 形态);search_data 维持现状不摘要。
   ②**聚焦态全文(新机制)** —— 现 focus 只改写 read args + schema 视野 + 写拦截,**不影响摘要判定**。实现:focus 中间件 wrapToolCall 改写 read args 时经 `ctx.callConfig`(per-call configurable 通道,同 `__pgDataScope` 先例)传 `__pgFullTextPaths`,read/get_data 将其作为**任意深度豁免前缀**合并进摘要调用(仅结果根豁免覆盖不了焦点子树内部的嵌套大子树)。
   ③**子 scope** —— isMain=false 既有通道,确认不动。
4. **同 invoke 复用**:窄读/聚焦读过的全文作为工具结果在历史中,后续轮凭历史引用;压缩侧 preserveLastToolResults + vfs 引用保护既有。
5. **read-before-write 守卫(判定基础复审更换)**:workingMemory 现有 locatedPaths **信息量不足**(只记 read 的 args 路径,分不清「骨架读」与「全文读」—— 读祖先返回占位恰是要拦的场景;query/search 命中路径捕获在现行输出格式下实际为空;read hash 是整 bind 域对子树级判定无用)。**新增判定数据源**:dataOps 暴露「本次 invoke 各 read 实际摘要了哪些子树路径」(opts 回调或 controller getter,invoke 级)。守卫判定 = **写路径落入摘要子树 S,且 locatedPaths 中不存在 S 自身或其后代的读目标** → 拦(回灌「先 read 该路径了解结构再写」,ask-first)。挂 harness 装配层 wrapToolCall(componentWriteGuard 形态,**不做 codeAsset 门控**);「每路径一次」用中间件闭包 Map + beforeAgent 重置。放行:dryRun / 已读(S 或后代) / 同 invoke 内该子树已有成功写 / 写路径未落入任何摘要子树(S1 恒放行)。
6. **写后联动**:写摘要路径 → stale-read 既有**纯路径重叠**失效逻辑复用(不用 hash);evidence 审计不受影响(路径恒可见)。

## 优缺点(诚实盘点)

- **优点**:主上下文每轮省几十 K token;flash 头号杀手(长上下文→指令衰减)直接缓解;与「主编排/子干活」分工正形对齐;零新概念(推广既有模式);轻量数据 no-op。
- **缺点/缩减(设计接受)**:①「一眼看全」的内容全局视野没了(检索+逐个看);②盲写深层路径能力没了(+1 轮窄读;内容拷贝类纯亏一轮);③历史免费复用没了(要时再取);④query_data 大值多一跳窄读(S3 已声明代价)。
- **声明行为(约束①精确化)**:泛化拆掉 `!specs.length` 早退后,**所有主 scope 数据 ≥阈值的存量集成** read/get_data/query 输出变占位 —— 这是本 change 的产品行为变更(非「零副作用」);既有 `<code Nkb>` 标记形态兼容;轻量数据(处处低于阈值)零变化(e2e 锁)。
- **最差形态明示**:弱模型 + 大数据 + 不配子 agent = 变慢不变不可能;focus 通道 + 保守阈值 + 键名摘要压代价。
- **门禁数据裁决**:「数据不达标 → 只升阈值,机制不回退」。

## What Changes

- **Phase 0(独立可发)**:阈值定标(二选一:a 先补一次带体积采集的运行 —— 诊断/报告临时加 read 结果子树尺寸字段,跑 2-3 个大数据场景定 N;b 经验值初值 2-4KB,Phase 1 真 LLM 反校准;**既有报告不可挖** —— 基线仅指标、tool_result 截 500 字符)→ 摘要器重写(体积判定+结果根豁免参数+键名取投影后值)→ 三通道(根豁免三调用点 / `__pgFullTextPaths` 管道 / 子 scope 确认)→ selftest/e2e。
- **Phase 1**:dataOps 摘要路径集出口 + read-before-write 守卫 → flash 三场景 + 单干场景真 LLM 门禁 → 调阈值。usageHints 教学行;usage-guide 中英「摘要与击穿」段。

## 红线

- **回退保底**:摘要与守卫的**全部击穿通道必须无子 agent 可用**(窄读/set_focus 都是主 agent 自有工具,不依赖子 agent 存活);守卫是引导重试非禁止(拦下即给窄读指令,一轮后可写)—— 主 agent 独立作业能力不得因本 change 减损。
- **零配置**;小标量永不摘要;摘要必带 1-2 级键名(投影后值)+ `#` 指纹;**占位符禁用 `hash=` 字面量**(workingMemory 捕获污染)。
- 三通道必达:结果根豁免是硬契约(否则黑洞+分页失效);query 不豁免 / search 不摘要 写死。
- 守卫:dryRun/已读/已写过/未落入摘要面 恒放行;每路径一次;文案 ask-first。
- 「零副作用」精确为:轻量数据零变化 + 标记形态兼容;主 scope ≥阈值存量集成输出变化是声明行为,配 CHANGELOG Changed 明示。
- 与 vfs offload 互补不重叠。

## 验收门禁

- selftest:摘要器纯函数(体积两态/键名投影后值/小标量豁免/数组 K children)+ 结果根豁免 + `__pgFullTextPaths` 焦点内部嵌套子树全文(仅根豁免不够的回归锁)+ 守卫四态(未读拦/已读放/dryRun 放/已写过放)+ 占位符无 `hash=` 字面量断言。
- e2e:stub 大子树四路断言(主占位/窄读全文/聚焦全文/子 scope 全文)+ query 占位带 path + search 现状 + 轻量数据零变化锁。
- 真 LLM:单干细节场景 + flash 三场景,轮次/token/完成率三指标;S1/S2/S5 行为符合预期。
