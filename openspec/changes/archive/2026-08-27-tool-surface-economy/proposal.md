# Proposal: tool-surface-economy(内置工具面无风险优化)

> 状态:**✅ 已实施并随 4.6.0 发布(2026-08-27,实施 commit b8ef9e0;全 11 任务收口,红测先行;真 LLM 复跑 2 跑判读 = 方差主导零系统性回退,4.6 基线已采 run5)。**优先级 P2(体验/成本优化,零行为破坏)。目标:提升单次调用处理量、降低每轮固定 schema 成本、收敛读类工具理解边界。
> 范围纪律:**只含无风险项** —— 纯增量参数 / 纯文本引导 / 文本瘦身;不删工具、不改工具名、不动参数 schema 既有字段、不碰「工具面恒全暴露」契约(3.31)。
> 用户拍板(2026-08-27):「先规划无风险的」—— query/search 合并、低频工具按需注入两项已评估为有风险/需契约决策,不在本 change(见「不立项项」)。

## W1. query_data 批量 queries(单次调用处理量)

- **现状**:`query_data({expr, limit})` 单表达式一次;多条件筛选(如「找所有 type=card 且 price<100」+「找所有 hidden」)需多轮。usageHints 已教 read 批量(jsonPaths)/write 批量(patches),query 是唯一无批量形态的读工具。
- **修法**:schema 增 `queries: z.array(z.string()).min(2).max(10).optional()`(与 expr 互斥;传 queries 则忽略 expr;两者都缺 → 参数错误 toolError)。返回 `{ batch: true, results: [{ expr, ok, matched, results | error }] }`;**逐条结果与单次调用输出同构**(`{"path":...,"index":...,"value":...}` JSON 行)。〔2026-08-27 实施前勘察更正:原稿称「保持现有 `@ path` 命中行格式」不实 —— query_data 现行结果即 JSON 行,无 `@` 前缀;workingMemory 的 query 捕获(args.jsonPath + `@ ` 正则)对 query_data 实为死代码(expr 非 jsonPath、JSON 无 `@ `),故「零联动改动」结论不变但依据是捕获本就不生效,而非格式兼容〕;单条表达式非法/空命中只标该项 error/空,不整批失败(与 read jsonPaths 容错口径一致)。
- **联动(必改,防隐性失效面失准)**:`readInvalidation.ts:109` extractReadPaths 对 query_data 只读 `args.expr` —— queries 数组下 String(undefined)→ 空串 → ROOT(过度失效,安全但浪费)。改为 `Array.isArray(a.queries) ? a.queries.map((q) => queryPrefixPath(String(q))) : [queryPrefixPath(String(a.expr || ''))]`(逐条前缀并集)。
- **引导**:usageHints 批量段(:71 附近)补一句「多条件筛选用 query_data({queries:[...]}) 一次取回」。
- **风险**:纯增量可选参数;单 expr 路径零变化;stale-read 失效面只会更准(并集 vs 现状 ROOT)。

## W2. 读类工具职责标注(理解难度,纯 description/引导文本)

- **现状**:5 个读类工具(read/describe_data/schema_data/query_data/search_data)边界靠 LLM 自悟;`describe_data` 与 `read` 不传 jsonPath **功能重复**(read 已合并 describe 语义,description 自称「合并 describe/get」,但 describe_data 仍独立存在且无等价标注);usageHints 有 query/search/eval 分流(:67-70)但缺 schema_data、未成完整分流表。
- **修法**:
  - `describe_data` description 补尾注「(等价于 read 不传 jsonPath;优先用 read 一个入口)」—— 引导归一,**工具不删**(删工具改变工具面,属有风险项)。
  - usageHints :64「不确定主数据字段结构时用 describe_data 查看说明」升级为一行分流表:`值/结构 → read;字段约束 → schema_data;条件筛选定位 → query_data;名字模糊找 → search_data;整体说明 → read 不传路径(= describe_data)`。
- **风险**:纯文本;不删任何工具;既有调用路径全部照常。

## W3. description 瘦身(每轮固定 schema 成本)

- **现状**:工具级 description 2063 字符 + 字段级 .describe() 2004 字符(dataOps 16 工具),每轮全量随工具 schema 发送(恒全暴露契约)≈ 每轮固定 ~2-3K token。与 usageHints 存在**双份教学**:read 的 hash/乐观锁解释、write 的四意图详述等 description 与 usageHints 各讲一遍。
- **方法论(单一真相源划分)**:description 只留「何时用 + 形态一句话 + 边界/互斥」;详细语法/示例/纪律归 usageHints(能力开关注入,与工具面同源同步)。目标:工具级 2063 → ~1300(-35~40%),语义不减(何时用/边界保留,砍的是与 usageHints 重复的教学细节)。
- **候选重写**:read(:1496,267 字 → hash 乐观锁解释下沉)/ write(:1599,~300 字 → 四意图详述压缩,指向 usageHints)/ eval_script / restore_data / history_data。
- **风险控制**:纯文本;语义保留性靠真 LLM 基线对比验证(见验收),不用肉眼判断。
- **红线**:工具名/参数 schema 字段与枚举不动;description 不引入新行为承诺。

## 不立项项(评估结论留痕)

| 项 | 结论 |
|---|---|
| query_data + search_data 合并 | 中风险(工具面变化 + schema 迁移);W1/W2 落地后重新评估收益 |
| 低频工具按需注入(restore/history/diff/resource_delete/schema_data 走 skill 按需) | 与 3.31「工具面恒全暴露」契约(移除 toolMode 的刻意反转)冲突,需产品决策;登记 deferred 触发条件:出现明确的小上下文模型集成诉求 |
| 禁令型引导下沉工具面 | **核实后无可做增量**:错误 hint 体系已完备(eval/search/write 各错误带 hint + 下一步动作),usageHints:63-72 纪律段已覆盖;原提案基于预估,实际现状已做 |
| describe_data 删除(与 read 冗余) | 删工具属有风险项;W2 先引导归一,登记 deferred 触发条件:真 LLM 基线中 describe_data 调用量连续两版 ≈0 |

## 验收门禁

- selftest:query 批量三场景(正常多 expr / 单条失败不整批 / queries+expr 同传按 queries)+ extractReadPaths queries 并集定界(单项路径命中失效,不塌缩 ROOT);既有 query/搜索用例零回归。
- e2e:data-slots 补批量 query 断言(`@ path` 行格式保留);exports/types 无新面(W1 schema 变化在工具内部,不进 types/index.d.ts)。
- 真 LLM:uispec 套件复跑 + `--baseline-diff`(W3 瘦身验证:token ±15% 阈内不劣化、toolCount ±3、成功轮次不升);W1 验证多筛选场景轮次下降(观察项)。
- 计数同步 CLAUDE.md + README 中英。
