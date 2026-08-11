# Tasks: fix-data-integrity

> 审计 P1 最后一批(P1-8/9/11/19/25/26)。原则:每项修复与测试同 commit;默认路径零回归。

## §1 P1-8/9 resetSession 收口统一
- [x] `core.resetSession` 删 `if (!store) return` 早退;内存态重置无条件执行(store 相关 createSession 按 store 门控)
- [x] 入口补 `conflictMgr.resolve('keep_external')`(P1-9;abortAllActive 已有)
- [x] 补 `messages.splice(0, length)` 自包含清空(与 switchSession 对齐)
- [x] `ChatSdk.resetSession(): void` 公开(包装 core.resetSession)+ types/index.d.ts + headless.d.ts 同步
- [x] docstring/注释更新(生命周期收口三路径对齐:switchSession/unmount/resetSession)

## §2 P1-11 shareContext 串行闸上移 core
- [x] buildCore 增 `runSerial`(createSerialRunner)+ `activeControllers`/`trackActive`/`abortAllActive`(core 级)
- [x] AgentCore 接口:`runSerial`/`trackActive` 增补;`abortAllActive` 转必选
- [x] `_createChatSdk` 删实例级闸;send/batch/switchSession/stream 包装改 `core.runSerial` + `core.trackActive`
- [x] unmount 改 `core.abortAllActive()`;release 补 abortAllActive 先行
- [x] mountChatDialog ctx.runSerial 改 core.runSerial 语义(UI 会话按钮同链)
- [x] 2.39.0 注释「一个实例 unmount 不中断另一实例的生成」改为共享语义留痕

## §3 P1-19 深投影统一
- [x] dataOps 7 处根级读 `projectBySchema(…, allowKeys)` → `projectBySchemaDeep(…, schema)`(get_data 整体 / read 整体 / read jsonPaths 根 / query / search / eval 根 / diff)
- [x] 注释更新(白名单单一深投影口径)

## §4 P1-25 压缩 LLM 摘要异步化
- [x] useContextManager 增 `llmCache`/`llmInFlight`;compress llm 分支重写(模板先行 + fire-and-forget + 前缀缓存拼接)
- [x] strategy 命名:llm_summary(cached)/ llm_summary(prefix)+index_tail / index_summary(llm_background)
- [x] summarization.ts 头注更新(decide 残留留痕)

## §5 P1-26 markdown 渲染节流 + 尺寸闸
- [x] useMarkdown 抽 `renderMarkdownHtml(text)` 纯函数导出(marked+renderer+sanitize)
- [x] renderer.code 增 hljs 尺寸闸(>20K 转义直出);sanitize 恒保留
- [x] useMarkdown html 改 shallowRef + watch 尾随节流(100ms;≤2K 直渲;onScopeDispose 清 timer)
- [x] MessageContent enhanceCodeBlocks 改 watch(html) 驱动
- [x] src/core/index.ts 导出 renderMarkdownHtml(types d.ts 同步)

## §6 测试
- [x] selftest sec-71(新模块 + runner 注册):深投影 7 路 / 压缩异步+前缀缓存+失败回退 / renderMarkdownHtml 尺寸闸+sanitize
- [x] e2e session-integrity.mjs(新模块 + runner 注册):resetSession 无 storage / 冲突挂起清空收口 / shareContext 双实例串行
- [x] 计数同步:CLAUDE.md + README 中英文 selftest/e2e 断言计数

## §7 门禁与文档
- [x] npm test / build / test:e2e / test:browser / test:exports / test:types / test:types-alignment / test:size / src 真错门禁 / pack 全绿
- [x] CLAUDE.md 更新(数据槽深投影口径 / 记忆管理压缩异步 / 对话鲁棒性 resetSession 收口 / shareContext core 级闸 / UI 节流)
- [x] doc/usage-guide.md(.en)更新(压缩异步说明 / resetSession API / shareContext 语义)
- [x] README.md / README.zh-CN(新能力 + 计数)

## §8 收尾
- [x] commit develop + 停下询问用户是否发布(minor 2.41.0)
