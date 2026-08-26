# Tasks: subtree-summary(评审修订版)

## Phase 0(独立可发;✅ 已完成 2026-08-24)

- [x] 阈值定标(既有报告不可挖:基线仅指标、tool_result 截 500 字符)—— 二选一并写明:a) 诊断/报告临时加 read 结果子树尺寸字段,补跑 2-3 大数据场景定 N;b) 经验值初值 2-4KB,Phase 1 真 LLM 反校准
- [x] 摘要器重写:自底向上聚合子树体积判定(标记字段形态兼容)+ `<subtree Nkb keys:[…] #指纹>` + 键名取投影后值 + 小标量豁免 + 数组 K children + 大 string 叶子入摘要面
- [x] 结果根豁免参数 + 三调用点接入(read 单/多路径、get_data)+ query 不豁免断言 + search 维持现状断言
- [x] focus 全文通道:callConfig.__pgFullTextPaths 管道(focus wrapToolCall → read/get_data 任意深度豁免前缀)+ 焦点子树内部嵌套大子树全文断言(仅根豁免不够的回归锁)
- [x] selftest:摘要器两态 + 键名/小标量 + 三通道各一 + 占位符无 `hash=` 字面量断言
- [x] e2e:stub 大子树四路断言 + 轻量数据零变化锁
- [x] 门禁:npm test && build && test:e2e 全绿;CHANGELOG Changed(声明行为:主 scope ≥阈值集成输出变占位)

## Phase 1

- [x] dataOps 摘要路径集出口(controller getSummarizedPaths/clearSummarizedPaths,onSummarized 回调两类占位都报;FIFO ≤500)+ read-before-write 守卫中间件 createSubtreeWriteGuardMiddleware(装配层 createChatSdk 装,非 codeAsset 门控;beforeAgent 重置 + 清占位集;判定 = 写路径落入 S × 本轮无窄读;放行 = dryRun/已读/已写过/未落入摘要面 + 每子树一次 + 整体 set 不拦)
- [x] usageHints 教学行:「占位 = 先窄读或 set_focus,勿猜路径直写」
- [x] selftest/e2e:守卫四态(sec-106 十三断言 + e2e stub 闭环 + complex-demo 浏览器用例按新闭环更新)
- [ ] 真 LLM 门禁:无子 agent 单干细节场景(轮次/token/完成率)+ flash 三场景(深改/占位问答/猜路径);据数据调阈值(只升不回退机制)—— **待环境**(网关可用时跑,登记 deferred;mock 四态 + 真浏览器重页面闭环已实证机制)
- [x] usage-guide 中英「大子树摘要与击穿通道」段(含声明行为与缩减面)+ CHANGELOG

## Phase 0 实施备注(2026-08-24)

- 阈值:选 **b) 经验值 3072 字符(≈3KB)** 常量 `SUBTREE_SUMMARY_THRESHOLD`(不进 DataOpsOptions,零配置;Phase 1 真 LLM 反校准只升常量)。
- 三调用点为 read 单/多路径 + query(不豁免);get_data 已随 legacy-crud-dedup 移除(任务原文的 get_data 调用点自然消失,契约由 read 承接)。
- 实施修正:placeholder 指纹用 `hashValue`(cyrb53 base36)非 codeAsset 层的 hashString(避免 tools→sdk 层倒置)。
- 门禁:2970/0 · 964/0 · 111/111;CHANGELOG Changed 已声明「主 scope ≥阈值存量集成输出变占位」行为。

## Phase 1 实施备注(2026-08-24)

- 守卫挂主栈(componentWriteGuard 之后);子 agent 栈不装(子 scope 读全文天然无占位)。
- 实测发现:complex-demo 重页面(30 类型 70 实例)全量 read 下 components.0 整体 ≥3KB 被摘要 → 「骨架读→直写深路径」旧流程被拦(设计行为);对应浏览器用例更新为新标准闭环(拦→窄读→复写),S1「骨架直写」精确为「写路径未落入摘要面」。
- 门禁:2984/0 · 967/0 · 111/111。
