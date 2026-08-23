# Tasks(stale-read-invalidation;SDK 侧)

> 已过三方怀疑论评审回改(2026-08-21);阻断项 3 + 重要项 9 落进各 Phase。

## Phase 0:写成功判定(地基,先行)

- [x] 纯函数 `isSuccessfulWriteResult(name, args, content, status)`:`isWriteCapableTool(tool, args)`(args-aware,**勿用** createAgent 循环里 `isWriteToolByName` 的保守口径,eval_script query 模式会误判)+ `args.dryRun !== true` + `status !== 'error'` + **`!content.startsWith('ERROR:')`**(toolError 字符串路径)
- [x] 同源缺陷顺手修:`turnUsage.writePaths` 同口径只看 `r.status !== 'error'` → SCHEMA_INVALID 写被计入 fact-sheet「成功写入路径」;改用 `isSuccessfulWriteResult`
- [x] selftest:SCHEMA_INVALID 字符串写不触发失效 + fact-sheet 不计入失败写(同源修复回归锁)

## Phase 1:纯函数 readInvalidation.ts

- [x] 新文件 `src/core/harness/readInvalidation.ts`:`invalidateStaleReads(messages, writtenPaths, opts)` 纯函数
  - 配对 walk:路径提取一律取自 **AIMessage.tool_calls**(name+args),content 只作替换目标(天然幂等);`call.id` 缺失 → tool_calls 顺序 + name 兜底,再失配跳过(宁漏勿误)
  - 读 path 提取(列表):read/get_data = `[jsonPath] ∪ jsonPaths`(缺省 ROOT);query_data = expr 经 `jpTokenize` 静态前缀(遇 `[*]`/`[?(`/`..` 截断);search_data = 恒 ROOT
  - 写 path 提取:**复用 `subagent.ts` `extractWritePaths`**(已含 path 键),补:空 = ROOT;`patch.op==='move'` 的 value(目标路径)并入
  - **op 感知失效范围**:set/merge/append → 自身/祖先/后代(兄弟不失效);remove/move/del/delete_data → writtenPaths 追加**父数组路径**(兄弟索引位移必须失效)
  - ROOT 记号归一(`''`/`'(root)'` 同一哨兵);前缀匹配带 `.`/`[` 分隔符(components ≠ components2,照抄 isPathWritable)
  - **排除**:resource_update/resource_delete 不触发(资源池路径非数据 jsonPath;占位符语义下旧 read 内容仍准确)
  - 同批串行序:传本批写 ToolMessage 索引下界;`maxParallelTools===1`(默认)只失效更早的读,`>1` 同批全失效
  - 占位文案(反 thrash 四要素):原读路径钉进文案 + 引用 write 结果新值/新 hash(write 自带 600 字符 + 新 hash;del/restore 无则不引用不撒谎)+ 兄弟子树「仍为读取时原值可参考」+ 分工具分语(query/search 说「重跑 query/search」不说「重新 read」)
- [x] selftest 白盒(sec-99:58 项,清单见 proposal 验收 1;实配发现:write patch op=remove 结果仍带新值+hash,仅 del/delete_data 无 → hasPostValue 口径按 del 而非 op):含 remove/move/del 兄弟失效、ERROR: 字符串跳过、jsonPaths 不误判 root、expr 前缀定界、components vs components2、同批串行序、幂等重跑

## Phase 2:createAgent 循环接线 + 联动

- [x] `CreateAgentOptions.staleReadInvalidation?: boolean`(默认 true);工具批 push 完成后按 Phase 0 判定收集 writtenPaths → `invalidateStaleReads`
- [x] debugLogs `stage:'stale_read_invalidated'` { round, writtenPaths, invalidatedCount }
- [x] **workingMemory 联动**:写成功从结果「新 hash=」捕获覆盖同 path lastHashes(防 pin 段「勿重复检索=旧hash」与占位「请重读」反向指令)
- [x] **opt-out 透传链**:`SubagentOptions` + `SubagentsMiddlewareOptions` + `configToSubOpts` + `runSubagent` createAgent 调用(对照 thinkingMode 先例);顶层 false → 主/子一致零变化
- [x] 反射:createAgent 闭包 getter + **AgentInfo 顶层字段** `staleReadsInvalidated`(会话累计;不寄生 inspect().context——那是 contextInspector 每轮覆盖快照且随其开关消失)
- [x] selftest:循环层断言(sec-100:18 项)(写后旧 read 替换 / 关开关原文保留 / 子 agent 同样生效且可关)

## Phase 3:e2e + 真实层验收

- [x] e2e(stub model,tests/e2e/stale-read-invalidation.mjs:15 项):断言用**自定义 wrapModelCall 中间件捕获 req.messages**(llm_request.messages 非 debug 下恒 `[]`,formatForLog 短路);写后下一轮旧 read = 占位;false 主/子双路原文保留;stage 日志断言;SCHEMA_INVALID 失败写零失效端到端
- [x] **types/index.d.ts + types/headless.d.ts 双同步**(headless 有独立复制的 ChatSdkOptions)+ `test:types` / `test:types-alignment` / `test:exports` 三门禁
- [x] 真 LLM(2026-08-23 验收过,`tests/runtime/_real-llm-stale-read.mjs` 本地脚本 + glm-5.2,7/7):
  - 主指标(正确性):**单 invoke 读→写→答**(设计约束:失效窗口 = 单次 invoke 内,跨轮 send 不触发)→ 答案 = 写后真值(BBB-终版/CCC-3版两轮)+ 无旧值中毒(不把读到的 AAA 当现值答)
  - 失效证据:`inspect().staleReadsInvalidated` 累计 3 + debugLogs `stale_read_invalidated` stage 痕迹
  - thrash 指标:两轮写后**零 re-read**(模型引用 write 结果新值,反 thrash 设计实证生效)
  - adapter 说明:原设想的 editor quality-compare 路线当时不可用(modelverse v4 模型面 offline;editor 侧另行回归),complex-demo + glm-5.2 等价覆盖主链;resume-then-ask 在 complex-demo 不可测(memory 后端 reload 即失),由 e2e applySnapshot 族覆盖
  - toolCount 基线门未跑(editor 路线依赖;thrash 已实证零重读,工具数无回归压力源)

## Phase 4:文档与归档

- [x] CLAUDE.md「记忆与上下文管理」段补 stale-read-invalidation + 断言计数同步(已随 3.42.0 落,现值 2813/929/102);CHANGELOG 条目(3.42.0)
- [x] 文档提示:多组件写任务 `maxToolRounds` 默认已升 30(3.43.0,> 建议值 20,失效后 re-read 余量充足)
- [x] 验收过 → 归档(2026-08-23);README 索引收口;fast-follow 决策点已登记 deferred:委派写失效(v1.5 候选)/ root 读新鲜骨架 / jsonPaths 行级重写
