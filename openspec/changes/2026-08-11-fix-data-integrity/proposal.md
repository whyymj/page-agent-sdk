# Proposal: fix-data-integrity(会话生命周期完整性 + 数据白名单深投影 + 压缩/渲染性能)

> 审计 audit-sdk-integrity 遗留 P1 最后一批:P1-8/9(组2 resetSession)+ P1-11(组2 shareContext 串行闸)+ P1-19(组4 深投影)+ P1-25/26(组6 压缩阻塞 + 渲染冻结)。
> 2026-08-11 立项。前置:fix-authorization-surface(2.38.2)/ fix-hang-and-feedback(2.39.0)/ fix-main-sub-isolation(2.40.0)已发布。
> 本批改完,审计 P0×1 + P1×27 全部清零;后续 = P2→deferred.md 登记 + 审计 change 归档。

## Why

六项均已在审计中读码核实(file:line 见 audit-report.md §二):

- **P1-8** storage 关(**默认**)时 `resetSession` 首行 `if (!store) return` 整体早退 —— ChatHeader「清空对话」只清了 useChat 层的 messages,mission/workingMemory/focus/todos/vfs/checkpoint/debugLogs 全泄漏进新对话(旧 focus strict 拦截继续生效、旧 mission pin 段带入新任务)。违背同函数 docstring「重置内存态」。
- **P1-9** resetSession 是**唯一不收口挂起冲突**的生命周期路径(switchSession/unmount 均有 `resolve('keep_external')`)。清空经 ChatHeader 可在冲突挂起时触达 → 旧工具 Promise 永挂,之后若被 resolve 会跨会话写进新对话上下文的 bind。
- **P1-11(H11 证实)** shareContext 串行闸**每实例私有**(`runSerial`/`activeControllers` 建在 `_createChatSdk` 闭包):同 id 双实例共享 core 却可并发 send/switchSession 写同一 messages;`core.abortAllActive` 由后创建实例覆盖赋值(先创建实例的注册表失联);一实例 unmount 的 `resolve('keep_external')` 可替另一实例的活跃冲突收口。共享 core = 共享状态,屏障必须在 core 级。
- **P1-19** 整体/根级读**浅投影** → 嵌套未声明字段泄露(**白名单护城河唯一破口**):read 整体/get_data 整体/query_data/search_data/eval_script 根/diff_data 共 7 处用 `projectBySchema`(仅顶层 key 不递归)—— 声明 key 内的深层未声明字段(如 `config.apiKey`)整体读全暴露;而子路径读与 history_data 整体都是深投影 —— **同数据两口径**。
- **P1-25** 压缩 LLM 摘要**同步 await 阻塞首 token ≤15s**:`enableLLMSummary` 默认 true(auto/aggressive/complex 预设),`compress` 在首轮模型调用前同步 `await llmInvoke(...)`;触发条件 = 历史 > 0.5×window,恰是大 JSON 长流程场景。llmResolver 注释「不阻塞用户」与实现相悖。
- **P1-26** 巨内容流式渲染 **O(n²) 冻结主线程**:`useMarkdown` computed 每 delta 对**全文**重跑 marked + hljs + DOMPurify,无尺寸闸无节流;长回复 + 大代码块卡死页面。

## What Changes

1. **resetSession 收口统一(P1-8/9)**:删 `!store` 早退 —— 内存态重置(messages/vfs/todos/memory/mission/workingMemory/focus/checkpoint/debugLogs + 新 sessionId)**无条件执行**,store 相关(createSession/refreshSessions)才按 store 门控;入口先 `abortAllActive()` + `conflictMgr.resolve('keep_external')`(与 switchSession/unmount 对齐;keep_external 语义不写入,无跨会话写风险)。**`resetSession()` 提升为 ChatSdk 公开 API**(headless 集成方此前无清空入口;types 两份 d.ts 同步)。
2. **shareContext 串行闸上移 core(P1-11)**:`runSerial`(createSerialRunner)+ `activeControllers` 注册表(trackActive/abortAllActive)从 `_createChatSdk` 实例闭包移入 `buildCore`(core 级,shareContext 多实例共享);send/batch/switchSession/stream 包装统一走 `core.runSerial` + `core.trackActive`;消除「后创建实例覆盖 abortAllActive」失联。语义变化(记录于 design):shareContext 下生命周期收口(unmount/switchSession/resetSession)中止**共享 core 的全部在途流**(含其他实例发起的)—— 共享状态不允许孤儿流继续写。
3. **深投影统一(P1-19)**:7 处根级读全部改 `projectBySchemaDeep(val, schema)`(allowKeys 门控不变;非 ZodObject 全开放语义保持)—— read 整体/get_data 整体/query/search/eval 根/diff 与子路径读、history 统一为**单一深投影口径**,嵌套未声明字段不再泄露。
4. **压缩 LLM 摘要异步化(P1-25)**:照 trim-llm「模板先行 + 后台替换」模式 —— compress 触发 llm 模式时**立即用索引摘要返回(零阻塞)**,fire-and-forget 后台 LLM 摘要入**前缀缓存**(`{coveredCount, text}`,older 恒从首轮起、单调扩);后续压缩命中缓存:全覆盖直接用 / 部分覆盖 = LLM 前缀 + 尾部索引增量。首 token 延迟 15s→~0;token 成本不增(每次触发仍一次后台 LLM,与现状同)。agentCompression 的 decide(≤6s,opt-in 默认关)维持同步,记录为已知残留。
5. **markdown 渲染节流 + 降级(P1-26)**:`useMarkdown` 改为**尾随节流**(≤ 每 100ms 渲染一次 + 尾沿保证最终渲染;小内容直渲不节流)+ **hljs 尺寸闸**(单代码块 > 20K 字符跳高亮直接转义,防巨代码块单帧卡顿;sanitize 恒保留)。抽纯函数 `renderMarkdownHtml(text)` 导出可单测;MessageContent 的 DOM 增强改由 html 变更驱动。

## Impact

- **行为**:默认配置零回归 —— resetSession 修复仅影响「清空对话」路径(此前 storage 关时近乎 no-op);深投影**收紧**读可见面(安全修,集成方若依赖泄露字段应声明进 schema);shareContext 双实例并发由裸奔改串行(修正而非破坏);压缩摘要首轮质量略降(索引模板,后台 LLM 后续轮补齐)换零阻塞;流式渲染帧率上限 ~10fps(节流窗内),最终态完整。
- **API**:新增 `ChatSdk.resetSession(): void`(minor 依据);新增导出 `renderMarkdownHtml`;`AgentCore` 增 `runSerial`/`trackActive`(内部接口)。
- **测试**:selftest sec-71(深投影 7 路 / 压缩异步+前缀缓存 / renderMarkdownHtml 尺寸闸)+ e2e session-integrity.mjs(resetSession 无 storage 收口 / 冲突挂起清空收口 / shareContext 双实例串行)+ stub delayMs 复用。
- **版本**:minor 2.41.0(新增公开 resetSession API)。

## Non-goals

- agentCompression 的 decide 异步化(≤6s、opt-in 默认关;本轮只拔默认路径的 15s,decide 记录为已知残留)。
- MessageList 虚拟化 / 每 delta 全列表 diff(审计 P2,deferred 登记)。
- projectBySchema 浅函数删除(可能为外部引用,保留导出;内部不再消费)。
- resetSession 经 runSerial 串行(同步 API + abort 先行已够;记录于 design 风险节)。
- 沙箱/markdown 的其它安全面(SE 维度,下轮审计)。
