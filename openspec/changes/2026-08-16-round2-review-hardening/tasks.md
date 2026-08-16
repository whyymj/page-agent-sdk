# Tasks

## A 代码修复

- [x] A1 autoTitle 时序:LLM 标题写入 await 后再 refreshSessions(createChatSdk.ts autoTitle 段)+ e2e storage 回归锁(sdk.sessions 显示 LLM 标题)
- [x] A2 主栈 scope token:主 agent 工具派发 config 兜底注入 `__pgDataScope: ''`;selftest 补「子窗口并发主 read/write scope 恒 MAIN」断言
- [x] A3 query_data/get_data 大文本摘要:回灌前过 summarizeLargeText(与 read 同 isMain 语义)+ selftest 断言(codeAsset 形态 query 返 `<code Nkb>`)
- [x] A4 read setBaseline 下移到路径校验后 + selftest 断言(失败读 PATH_DENIED 后基线不变,宿主改动仍触发 VERSION_CONFLICT)
- [x] A5 send abort partial 收口:invoke resolve 后校验 aborted/sessionId 再 push + e2e 断言
- [x] A6 生命周期守卫:core.send refCount<=0 拒;trackActive untrack removeEventListener
- [x] A7 MessageSteps expandedGlobal 只 clear 本 uid 前缀 key
- [x] A8 constructLlm cacheControl 注释机制修正(二次 spread 恢复 + 已验 1.5.4)
- [x] A9 persistSave/persistUpdateTitle catch 补 debugLogs 留痕(middleware stage: persist_save_failed)

## B 测试补强

- [x] B1 e2e custom-injection:用户 wrapToolCall throw → 轮存活 + tool_result 含错误文本(非 fatal)
- [x] B2 selftest sec-80 E3 重写:streamStallMs:0 真 asserting(替换 assert(true) 占位)
- [x] B3 e2e conflict:resolveConflict('overwrite')/('restore') 顶层分支走通(bind 更新/快照回退)
- [x] B4 selftest:normalizeBaseUrl 纯函数断言(相对补 origin/绝对原样/undefined)

## C 收尾

- [x] deferred.md 登记 rv-core F4/F7/F8(带触发条件)
- [x] 全量门禁:selftest / build / e2e / browser 三绿
- [x] CHANGELOG + openspec README 索引更新
