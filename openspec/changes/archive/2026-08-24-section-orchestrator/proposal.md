# Proposal: section-orchestrator(分段编排 + 欠委派 nudge —— 复杂任务的行为面)

> 状态:**✅ 已实施并随 4.0.0 发布**(2026-08-24 Phase 0 + Phase 1 全部完成:四门禁 3017/978/111;真 LLM 双臂与阈值标定登记 deferred 待网关。实施修正:装配条件按 useSubagent 能力判定(默认只读 spawn_agent 也算);e2e S7 走 spawn_agents allSettled 既有错误隔离路径)。优先级:P2 主体 / Phase 0 为 P1(独立可先行)。目标仓库:zhuanti-agent。
> 驱动:复杂任务下主 agent「该委派不委派、独自硬干」的后果链:上下文膨胀→压缩→指令衰减(平铺/漏需求)→轮次耗尽→**诚实但部分完成**;且无失败隔离、无并行。「过度委派」已修(多方案先文本 3.46),「欠委派」零机制 —— 本 change 补另一半,并泛化 html 线已验证的委派优先编排到 JSON 分段。

## Why(现状核实,复审纠正)

- code 路径不存在欠委派:`CUSTOM_CODE_DELEGATION` 机制强制;纯 JSON 路径只有提示词引导,无机制。
- 轮次预算两档提醒(3.43)**已泛提「委派」**(70% 档现文案含「优先完成核心写入/委派与收口」)—— 真实缺口是**不教方法与形态**(「并行分段」「何时该分流」),不是「不知道可以委派」。0a 是文案扩展(扩展点 `roundBudgetHintText` 纯函数两档,createAgent:895 注入 system 不污染历史,确为一行级;该函数签名无能力感知 → 需加 hasSubagent 参数防对 `subagent:false` 集成点名不存在的工具)。
- 「欠委派」主形态恰是**小步 grind**(S3:每轮 8-12 组件连写 10 轮)—— 单次调用量纲恒低于阈值,**nudge 必须用 invoke 内累计口径**才能命中主形态。
- html 线编排已验证(委派链路全 done);但其装配条件是「存在 codeAsset 子 agent」(hasCodeAsset),对纯 JSON 场景**既过宽又过窄**,不可照搬。
- 委派有真实成本(2-5x token/耗时)—— 不是所有任务都该委派,引导按规模分流,不做强制硬门禁。

## 场景(详细,复审修订)

- **S1 大改造(标准形态)**:「50 组件页面全部换新春节皮肤」→ 主 agent 规划分段(每段 8-12 组件)→ **同轮多个 `spawn_agent` 各带 writablePaths(段前缀)+ task 规格**并行委派(maxParallelTools>1 真并行,默认 1 串行零变化;~~spawn_agents 带 writablePaths~~ **评审纠正:spawn_agents 的 task 仅 {prompt,role} 无写授权,并行写委派只能经多个 spawn_agent 逐个授权**)→ allSettled 逐段结算 → 跨段一致性收口。
- **S2 中等任务(分流正确形态)**:8 组件局部改 → 主 agent 单干更优 —— nudge 不触发或触发后 LLM 裁决单干,均正确。
- **S3 预算压力中途分流(grind 主形态)**:主 agent 每轮 8-12 组件小步写,2-3 轮后 **invoke 累计触达超阈** → nudge 随下一次写结果尾附 → 剩余段改委派;70% 档提醒文案同时教「并行分段」形态。
- **S4 起手大任务**:整体 set 一把梭形态单次即超阈 → nudge 提醒(该形态委派本无意义,nudge 无害亦无用,明示)。
- **S5 失败隔离**:段 2 失败 → error result 单独回灌,段 1/3 照常落地(既有 allSettled 语义)。
- **S6 段相交(明示弱点,评审纠正)**:**纯 JSON 委派路径(spawn_*)不过组件锁** —— 锁仅在 use_<id> codeAsset 路径 acquire 且 `componentLock = hasCodeAsset && useSubagent` 才创建,锁名坐标是组件 name 非 components.N 路径。段不相交由**编排规格唯一保证**(提示词),重叠段写冲突由乐观锁(per-scope 基线)兜底 —— 此为明示弱点,非既有机制覆盖。
- **S7 委派失败回退单干(保底路径,一等公民)**:子 agent 全灭(模型下线/超时/连续 error result)→ 主 agent **直接接手段内工作** —— writablePaths 是运行时授予子 agent 的、非主 agent 让渡,段写权限主 agent 本来就有;形态同 S5(窄读/聚焦 + patch)。编排教学含回退条款:「同一委派失败 2 次 → 自己做」(防无限重试委派烧预算)。

## 原理(复审修订)

- **Phase 0a(一行级,需两处)**:70% 档文案扩「剩余任务多且重时,可并行分段委派(多个 spawn_agent 各带 writablePaths)」;`roundBudgetHintText` 增第三参 `hasSubagent`(caps.subagent 传入;false 时委派句不注入或泛化措辞)。selftest 两态断言。
- **Phase 0b(欠委派 nudge,middleware 实现)**:复用 `measureWriteScale`(只吃写工具 args,吃不了 write_todos 自由文本)做 **invoke 内累计**:逐次写调用度量后 union 其组件级 scopes(**整体 set 形态特判取 count** —— 其 scopes 粒度是顶层数组名不可并),本 invoke 累计触达现有组件 > N(初值 12-15,**initialPage 双臂试点标定,非离线挖掘** —— 既有报告无写触达分布可挖)且本 invoke 零委派(spawn_agent/spawn_agents/use_* 任一即算)→ 随下一次写结果**尾附一次性 advisory**(不阻断、不改结果语义;写结果不被 stale-read 改写,通道安全)。middleware + beforeAgent 重置 invoke 级去重与已委派标志(勿硬编码 createAgent);debugLogs `stage:'delegate_nudge'` + inspect 可观测。
- **Phase 1(编排段泛化,数据规模动态注入)**:不走 htmlOrchestratorPrompt 静态装配(其条件对纯 JSON 既过宽又过窄)—— **middleware augmentPrompt 每轮按 liveData 实测注入**:顶层对象数组元素总数 ≥ N(与 nudge 同阈值同源)才注编排段(三步职责「规划→分段→验收」+ 段规格四要素 jsonPath/目标/共享 tokens/验收标准 —— **新造平移自 html 五要点,非复用结论,自带真 LLM 验证**),小数据零注入零税,setData 后自动跟随。段规格经 task 文本传递,零配置。
- **依赖关系**:Phase 0 独立可先发;Phase 1 完整收益依赖 subtree-summary(否则结论回灌仍全量)。

## 优缺点(诚实盘点)

- **优点**:大任务从「诚实部分完成」变「结构化并行完成」;失败隔离;Phase 0 两个零风险快赢;与授权面(spawn_agent per-call writablePaths)/per-scope 基线兼容。
- **缺点/风险**:①段间一致性 —— 规格 tokens + 收口检查**缓解非根治**;②小任务误委派变慢(advisory 分流,弱模型可能误判);③弱模型段规格不齐(模板化缓解);④一段一子总 token 可能更高(实测权衡);⑤**spawn_agents 无写授权(现状锁定)**:并行写只能多个 spawn_agent 逐个授权,或未来扩 spawn_agents task schema(工具面变更,单独 change 评审);⑥段相交无组件锁兜底(明示弱点)。
- **不做的**:强制委派硬门禁;多段事务回滚;新增配置开关。

## 红线

- **回退保底三不变量(最高优先)**:①任何场景下主 agent 的工具面与写能力不得被委派机制阉割(委派只增选项不减能力,不设强制委派硬门禁);②**委派失败 → 单干是设计内一等路径**(S7):allSettled 失败隔离既有 + 编排教学回退条款「失败 2 次自己做」防无限重试烧预算;③摘要/守卫全部击穿通道必须**无子 agent 可用**(不依赖子 agent 存活)。
- nudge **advisory 不阻断**,invoke 级 ≤1 次,已委派抑制;文案 ask-first;write_todos 文本不作触发源。
- 0a 为**文案扩展**(非「不改既有提醒语义」的字面零副作用 —— 明示);hasSubagent 能力感知防点名不存在工具。
- 不做强制委派;S2 单干形态不被骚扰。
- 编排段动态注入零配置;共享 tokens 走 task 规格。
- Phase 1 与 subtree-summary 耦合单向(不改 read/摘要行为)。

## 验收门禁

- selftest:nudge 三态(累计超阈触发/未超不触发/已委派抑制)+ whole-set count 特判 + invoke 去重;预算提醒两态(hasSubagent on/off)。
- e2e:stub grind 序列(多轮小写累计超阈)→ nudge 尾附;整体 set 特判;委派后抑制。
- 真 LLM:initialPage 双臂(flash 硬干 vs nudge 分流;fixture 用**无 code 字段的 schema 副本**防 CUSTOM_CODE_DELEGATION 干扰归因)—— 轮次/完成率/token;S1 段规格四要素齐格式抽检;阈值据此标定。
- **保底场景(必测)**:子 agent 全灭(mock spawn 恒败)→ 主 agent 回退单干完成全部工作(S7);失败 2 次后不再重试委派(回退条款生效);最终完成率不因委派通道全灭而归零。
