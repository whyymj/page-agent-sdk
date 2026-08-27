# Tasks:tool-surface-economy(无风险三项)

## Phase 1:W1 query_data 批量(测试先行)

- [x] 1. selftest 红测(sec-21 扩展):query_data({queries:[两个合法 expr]}) → batch 信封 + 逐条结果与单次输出同构(matched/results[].path/index/value);单条非法 expr 该项标 error 不整批失败;queries+expr 同传按 queries;两者都缺 → 参数 toolError
- [x] 2. selftest:extractReadPaths('query_data', {queries:[...]}) → 逐条前缀并集(修前塌缩 ROOT 过度失效);单 expr 路径零变化对照
- [x] 3. 实施:dataOps queryData 工具增 queries 可选参数(批处理循环 + 逐条 try/catch + `@ path` 行格式);readInvalidation.ts:109 queries 并集
- [x] 4. e2e:data-slots.mjs 补批量 query 用例(stub LLM 调 queries 断言结果结构 + `@ path` 格式);既有 query 用例零回归
- [x] 5. usageHints 批量段补一句 queries 引导

## Phase 2:W2 + W3 文本面(纯文本,一轮做完)

- [x] 6. W2:describe_data description 补等价标注;usageHints :64 升级分流表(值/约束/筛选/模糊/说明五路)
- [x] 7. W3:description 瘦身 read/write/eval_script/restore_data/history_data 五个重写(何时用 + 一句话形态 + 边界;细节指向 usageHints);工具级字符量 -35% 目标断言(selftest 静态锁:对五工具 description 长度上限断言,防回弹)
- [x] 8. selftest:瘦身后语义保留对照(关键词仍在:「何时用」动词/边界词/互斥词清单断言)+ schema 字段/枚举零变化对照

## Phase 3:验证与收尾

- [x] 9. 全量门禁:npm test + build + test:e2e + test:browser(dataOps 改动面)
- [x] 10. 真 LLM:uispec 复跑 + `--baseline-diff`(W3 token/toolCount 不劣化;W1 多筛选轮次观察);确认后 `--baseline-update`
- [x] 11. deferred 登记:低频工具按需注入(触发条件:小上下文模型集成诉求)+ describe_data 删除(触发条件:调用量连续两版 ≈0);CHANGELOG;计数同步 CLAUDE.md + README 中英
