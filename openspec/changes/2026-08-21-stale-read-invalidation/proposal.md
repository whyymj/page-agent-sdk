# Proposal: stale-read-invalidation(写驱动的过期读失效:窗口内历史内容净化)

> 状态:**规划完成待实施(已过三方怀疑论评审回改,2026-08-21)**。优先级 P2(SDK,排队在 main-surface-slim 之后)。目标仓库:zhuanti-agent。
> 驱动:2026-08-21 用户提问「能否先评估是否需要历史提示词,不需要就只 systemPrompt + 最新输入」→ 评估结论:**「按需评估注入」机制不可行**(循环依赖:判断需不需要历史本身需要历史内容;指代是常态:「再加一个」离开历史不可解;弱模型自诊盲区:flash 最不可靠的恰是「意识到自己不知道」,3.40.3 门禁修的「凭记忆答状态」即此类)。但该直觉指向的真问题是**窗口内的过期读结果**——已落地的状态外置(mission/todos/workingMemory pin 段)与压缩(summarization)之外的第三块拼图。
> 评审记录:三评审员(机制正确性 / 回归面 / 模型行为学)对照源码逐条核提案,阻断项 3 + 重要项 9 全部回改进本版;误报与确认项见文末「评审核实记录」。

## Why(现状核实,2026-08-21)

**过期读只存在于单次 invoke 的 ReAct 循环内**——这是精确的作用域:

| 层 | 现状 | 结论 |
|---|---|---|
| 跨轮历史(AgentMessage[]) | `toLC` 只映射 user/assistant/system,工具结果**不回放**(steps 仅 UI 展示) | 无过期读问题 |
| 单轮 ReAct 循环(currentMessages) | `trimContextIfNeeded` 只在 >60% 窗口时裁;`preserveLastToolResults` 是跨轮压缩摘要层的概念 | **问题所在**:round 2 的 `read components` 结果,在 round 5 write 之后整段保留到 round 11 —— 又大又假 |
| 压缩(summarization) | 按大小/轮数阈值触发,阈值内不碰 | 与新鲜度正交,不覆盖此问题 |

实测证据(口径收窄,评审后修正):
- 3.40.3 状态询问门禁修的「凭记忆答状态」事故,素材是**主 agent 自己 write 前**的旧 read 快照——本 change 覆盖的部分
- editor 单轮 ~70 万 prompt token 的载荷主体是逐轮累积的 read 结果,但其变更大头走委派(**不在本 change 失效面**,见覆盖边界)——token 收益按「主 agent 直写场景」计,不按 editor 总量计
- 乐观锁设计已承认「read 之后数据会变」(hash 比对),但**上下文里的旧快照没被清理**——模型看得见的旧值就是误导源

## 覆盖边界(评审后新增,先声明再谈机制)

本 change **只覆盖「LLM 经 write 类工具的成功写」**。以下写路径**不触发失效**(已知盲区,明示不藏):

| 盲区写路径 | 主上下文旧 read 行为 | 兜底 |
|---|---|---|
| 委派写(`use_html` 子 agent commit 直改 bind / spawn 可写子 agent) | 原样保留(过期) | 编排 prompt 已强制「委派返回后 read 核对」+ 3.40.3 状态询问门禁 |
| 集成方 `defineTool` 直改 bind(baselineGuard 场景) | 原样保留 | recomputeBaseline 只刷基线;新鲜度靠模型主动重读 |
| 宿主 actions / codeAsset afterAgent commit | 原样保留 | 同上 |

**scope 诚实声明**:editor 场景数据变更大头走委派——本 change 对 editor 是「治主 agent 直写属性/结构的那一半」,不是全量。委派路径失效(按 writablePaths 前缀 + `__pgId`→components.N 反解)评估为 v1.5 候选,不进 v1(委派返回值不含 path,失效粒度只能 root,过重;待 v1 真实数据再决策)。

## What Changes

### 0. 写成功判定(评审 A1/B1:机制的「精确」地基,先行)

`status==='done'` **不代表写入发生**——dataOps 全部业务失败(SCHEMA_INVALID/VERSION_CONFLICT/PATH_DENIED/keep_external/restore 裁决)是 `return toolError({...})` 返回 `ERROR: {json}` 字符串,不 throw(coreExecTool 只有 throw 才置 error)。失败写若触发失效,占位文案「已写入」= 机制向模型供给假事实,与门禁家族哲学相悖。

共享纯函数 `isSuccessfulWriteResult(name, args, content, status)`:

```
isWriteCapableTool(tool, args)            // subagent.ts 单一真相源,args-aware(eval_script query 模式不算写)
&& args.dryRun !== true
&& status !== 'error'                     // throw 路径
&& !content.startsWith('ERROR:')          // toolError 字符串路径(结构化判定,非正则)
```

**顺手修同源缺陷**:`turnUsage.writePaths`(createAgent:1058)同口径只看 `r.status !== 'error'`——SCHEMA_INVALID 的写也被计入 fact-sheet「成功写入路径」,zero-tool 门禁的事实清单存在同源失真。同 commit 修(一处修两处受益)。

### 1. 纯函数 `invalidateStaleReads`(新文件 `src/core/harness/readInvalidation.ts`)

**失效判定是 op 感知的精确判定**(评审后修正:原「兄弟不失效」对数组移位不成立):

- 消息配对:顺序 walk `currentMessages`,从 **AIMessage.tool_calls**(name+args)提取路径,content 只作替换目标——**天然幂等**(重跑不会把占位文本误当 read 结果);`call.id` 缺失的 provider 下 id 配对失配 → **按 tool_calls 顺序 + name 兜底,再失配跳过(宁漏勿误)**
- 读工具集与读 path 提取(全量为列表,任一命中即重叠):
  - `read` / `get_data`:`[args.jsonPath] ∪ args.jsonPaths`(缺省 = ROOT;**jsonPaths 不收集会误判 root,任意写整条击穿**)
  - `query_data`:从 `args.expr` 经 `jpTokenize` 取**静态前缀**(`$.components[?...]` → `components`,遇 `[*]`/`[?(`/`..` 截断)——写在前缀之外不可能影响结果,editor「查索引→改属性→继续用索引」主流流不必重查
  - `search_data`:**恒 ROOT**(全树扫描,root 语义本就正确;浪费是正确性的固有代价,proposal 明示)
- 写 path 提取:**复用 `subagent.ts` 的 `extractWritePaths`(已是复数、已含 `path` 键)**,补两点:空结果 = ROOT;`patch.op==='move'` 时 `value`(目标路径字符串)并入
- **op 感知的失效范围**(评审 A2/C4:数组 remove/move/del 位移使兄弟路径错位):
  - `set/merge/append`(不移位):writtenPath 自身/祖先/后代命中失效,**兄弟不失效**(对象键路径精确)
  - `remove/move/del` 或 delete_data:writtenPaths **追加父数组路径**(如 remove `components.2` 同时登记 `components`)→ 该数组全部后代/兄弟失效——索引位移后旧快照是「路径标签错位」,比旧值更毒,必须失效
- **ROOT 记号归一**:读侧 `'(root)'`(workingMemory 口径)/ 写侧 `''` 统一过 normalize 函数再比较,祖先判定带 `.`/`[` 分隔符(`components` 不误配 `components2`,照抄 `isPathWritable` 纪律)
- **排除集**:`resource_update`/`resource_delete` 不触发失效——它们的 `path` 是资源池路径非主数据 jsonPath,resource_update 换资源不改 read 输出内容(占位符语义),rdelete 不动 bind(评审 B6:两个方向都误伤)
- 同批串行序:`maxParallelTools` 默认 1 → 执行序确定,[write, read] 同批的 read 反映写后状态**不失效**(只失效索引早于本批写 ToolMessage 的读);`maxParallelTools>1` 时同批全失效(顺序才真正未定义)——评审 A3:写后核验读是 verify/usageHints 鼓励的正常模式,误失效会诱发反复重读
- 替换:保留 tool_call_id(结构完整),content 改占位(见 §2 文案)

### 2. 占位文案(评审 C3/B3:本 change 唯一一段新提示词,按门禁回灌文案强度打磨)

反 thrash 三原则写进文案:

```
⏱[过期快照] 此前读取 <原读路径> 的结果已失效(第 N 轮写入了 <writtenPath>)。
该轮写入结果已含 <writtenPath> 最新值与新 hash;<原读路径> 的兄弟子树(未触及部分)仍为读取时原值可参考。
需当前精确值时再 read(建议窄读:<原读路径>)。
```

- **引用 write 结果的新值+hash**——write 成功结果自带「当前值(600 字符)+ 新 hash」(dataOps:1400/1415),对已写 path 信息完备,防「规则符合型 thrash」(reliableWriteRules 规则 1「改前先 read」× 失效 = 严格合规也 thrash)
- **钉原读路径引导窄读**——防弱模型裸调 `read()`(无参 = 整树 + 说明,比删掉的快照还大)
- **分工具分语**:query/search 的占位不说「重新 read」,说「重跑 query/search」(它们的结果是命中列表,read 重建不了)
- **del/restore 零写后信息**:结果无值无 hash,占位不引用「写入结果已含」(没有就是没有,不撒谎)

### 3. createAgent 循环接线

工具批结果全部 push 完成后(现有 turnUsage 统计段旁):对本批每个成功写(§0 判定)收集 paths → 一次 `invalidateStaleReads(currentMessages, writtenPaths, round)`。

- debugLogs 留痕:`stage:'stale_read_invalidated'` { round, writtenPaths, invalidatedCount }
- **workingMemory 联动**(评审 C5/A3):写成功时从结果「新 hash=」捕获并覆盖同 path 的 lastHashes(复用既有正则口径)——否则 pin 段「勿重复检索 components.5=旧hash」与占位「已失效请重读」同 path 双源相反指令,弱模型裁决随机
- **prompt cache 影响如实写**:失效点起前缀重写;写密集流每 1-2 轮一写,「摊销后可忽略」过于乐观——真实收益是**正确性**(假快照消失),token 是次级指标且按「请求上下文体积」口径计量(见验收)

### 4. 开关、透传与反射

- `CreateAgentOptions.staleReadInvalidation?: boolean`(默认 true)
- **opt-out 全链路透传到子 agent**(评审 B4:`staleReadInvalidation:false` 必须主/子一致,否则「零变化」承诺是假的):`SubagentOptions` + `SubagentsMiddlewareOptions` + `configToSubOpts` + `runSubagent` 的 createAgent 调用(对照 thinkingMode 透传先例)
- createChatSdk 顶层同名透传 + **types/index.d.ts 与 types/headless.d.ts 双同步**(headless.d.ts 有独立复制的 ChatSdkOptions,漏改挂 types 门禁)
- 反射:`inspect()` 挂 **AgentInfo 顶层字段** `staleReadsInvalidated`(会话累计)——不寄生 `inspect().context`(那是 contextInspector 每轮覆盖的快照,且随其开关消失;createAgent 闭包 getter,类比 debugLogs)

## Impact

| 项 | 变更 |
|---|---|
| `src/core/harness/readInvalidation.ts` | 新文件(~120 行:判定 + 提取 + 归一 + 重叠 + 替换) |
| `src/core/harness/createAgent.ts` | 循环接线 ~25 行 + turnUsage.writePaths 口径修复 + 闭包 getter |
| `src/core/harness/subagent.ts` | extractWritePaths 补 move 目标 + staleReadInvalidation 透传链 |
| `src/core/harness/workingMemory.ts` | 写后 hash 刷新联动(~10 行) |
| `types/index.d.ts` + `types/headless.d.ts` | 选项 + AgentInfo 字段双同步 |
| 兼容 | 默认开;`staleReadInvalidation:false` 主/子一致零变化 |
| **maxToolRounds 触顶风险**(评审 B3) | 读多写少任务最坏 1+N → 2N 轮;N>7 撞默认 15 cap。缓解 = §2 反 thrash 文案;文档建议多组件写任务显式配 ≥20(对齐既有 draft 建议);验收盯 toolCount 与 REACT_CALL_LIMIT_EXCEEDED 复发 |

## 验收(评审后重写:主指标改正确性,token 降为次级)

1. **selftest 白盒**(新 sec 模块):ancestor/descendant/equal 失效;sibling 不失效(set/merge);**remove/move/del 兄弟失效**(父数组前缀);root 读被任意写失效;root 写失效一切;**dryRun 跳过;throw-error 与 ERROR: 字符串双路径跳过**(SCHEMA_INVALID 写不失效——评审 A1:按 throw 语义写的测试测不到这条);jsonPaths 全量提取不误判 root;query_data expr 前缀定界(写前缀外不失效);search_data 恒 root;resource_update 不失效;**components vs components2 分隔符**;同批 [write,read] 串行序不失效;id 缺失兜底配对;占位保留 tool_call_id + 幂等(重跑不二次处理)
2. **e2e(stub model)**:断言方式 = **自定义 wrapModelCall 中间件捕获 req.messages**(llm_request.messages 在非 debug 下恒 `[]`,formatForLog 短路——评审 B10);写后下一轮旧 read content = 占位;`staleReadInvalidation:false` **主/子双路**原文保留;debugLogs stage 断言;turnUsage fact-sheet 不再计入 SCHEMA_INVALID 写(同源修复的回归锁)
3. **真 LLM(editor,quality-compare 基建,`--baseline-diff`)**:
   - **主指标(正确性)**:定向探针——写后问「第 N 个组件现在是什么」×3-5 条穿插 + resume-then-ask 模式 → 断言回答前有 read 且答案 = 写后真值
   - **thrash 指标(第一健康指标)**:同 invoke 内「写后同 path 再 read 次数 / 写次数」新旧对比(debugLogs 工具计数,零 LLM 成本)
   - **toolCount 不回归门**:复用 baseline-diff ±3 阈值;REACT_CALL_LIMIT_EXCEEDED 复发计数
   - **上下文体积下降**(次级):llm_request 日志消息体长度口径(prompt_tokens 含 cache 命中,口径失真——评审 C6)
   - 缓存命中 token 若网关可报(deepseek prompt_cache_hit/miss)加 cache 调整后成本对比

## 非目标(Non-goals)

- **不做「按需评估历史」**(用户原始提案的机制形态):循环依赖 + 指代常态 + 弱模型自诊盲区,评估结论否决;其安全形态(状态外置 + 外存按需查)已有
- **委派写失效不进 v1**(v1.5 候选):`use_html`/spawn 委派返回值不含 path,按 writablePaths 失效粒度只能 root 过重;v1 真实数据(thrash 指标 + 主上下文过期读实测误导频率)再决策。**从 Why 撤掉的口径**:editor 70 万 token 是委派主导,不作为本 change 直接收益论据
- 不做跨轮历史治理(工具结果本就不跨轮回放;跨轮大小靠 summarization,定位靠 workingMemory)
- 不做 vfs 文件层失效(`vfs_edit` 后 `vfs_read` 过期):子 agent 短生命周期轮次浅收益小,另行评估
- **write 结果自身的当前值预览不失效**(评审 C9:write 结果是动作日志,抹掉诱发重复写——editor 实测「把委派返回的 code 又追加一遍」正是进度记忆混乱形态;600 字符上限已压危害)——显式决策,防将来对称性补丁
- `resource_delete` 不动 bind 不触发失效;`eval_script transform`(真无 path)ROOT 保守失效是有意过重,注记
- 不动 `preserveLastToolResults`(跨轮摘要层的字段描述保留,语义不同)
- 占位文案语言与 dataOps 全部工具结果文案一致用中文(与 en-US locale 只改 systemPrompt/UI 的现状对齐)——有意决策,勿当 bug 修
- **数据驱动的 fast-follow 决策点**:root 读新鲜骨架(失效占位附 id/name/type 列表,保形丢值)——若 thrash 指标显示弱模型整树重读显著再上,需 dataOps 侧 `renderLiveSummary` 回调(bindRef 在它手里),失效函数失去纯函数性是代价

## 评审核实记录(2026-08-21 三方评审)

**阻断项(3,全部回改)**:①写成功判定 status≠写入(toolError 返回不抛)→ §0;②数组移位兄弟错位 → §1 op 感知;③委派写盲区 + Why 论据失实 → 覆盖边界段。
**重要项(9,全部回改)**:jsonPaths 误判 root / query·search 恒 root / 同批串行序误失效 / workingMemory hash 反向指令 / resource_* 双向误伤 / opt-out 子栈不透传 / inspect 挂点 / 占位文案 thrash / 轮次膨胀量化。
**核实为误报或确认无问题**:乐观锁零机制冲突(写工具不收 LLM 传 hash,effHash 恒取内部 baseline——失效不影响写成功/该拒不拒);时序叠加零冲突(失效轮末 → replaceSystem 下轮首只动 [0] → trim 跳过 ≤400 占位);abort/自纠路径全兼容(回灌全是 HumanMessage);三层现有测试预计零破坏(selftest/e2e/browser 的 mock 均消息内容盲——StubChatModel 只读 messages[0],mockLlm 按序回放);持久化零交互(SessionSnapshot 无 ToolMessage)。
**事实勘误**:markWrite 实测 9 处非 11 处;提案对现状三条事实陈述(工具结果不跨轮回放/trim 60%/summarization 正交)核实一致。
