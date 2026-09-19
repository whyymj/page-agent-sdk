# Tasks:content-proposals

> 打勾标准:代码/文档落地 + 对应测试绿 + 计数同步。前置:action-host-semantics(deferredWrite 口径复用)。
> 体积注意:纯函数 + 装配逻辑,预期 JS 产物增量 <5KB,超预期则 size 双闸重校留档(designSkill 先例)。

## Phase 1:纯函数域(S1 内核)

- [ ] 1. `src/core/tools/proposalOps.ts`:`lineDiff`(公共前后缀修剪 + 中段 LCS Uint32 DP + >4e6 格回退整块替换 + stats)+ `applyProposalOps`(replace 字面锚唯一命中 / insertAfter·insertBefore / append;任一失败整案拒,错误指名第几个 op 与命中数)+ `hashContent`(与 dataOps hash 同源或独立短 hash,注明选型)
- [ ] 2. selftest sec-133:lineDiff 矩阵(全同/纯插/纯删/替换/前后缀修剪/子串重叠/空文本/回退规模不超时/行序)/ applyProposalOps(唯一锚替换/0 命中/≥2 命中指名/insert 前后/append/多 op 原子全拒)

## Phase 2:通道装配(S1/S2)

- [ ] 3. `src/core/sdk/proposals.ts`:`ProposalsConfig` 类型 + 装配工厂(read_content / propose_content 两工具 zod schema,ops 判别联合;deferredWrite 语义标记);未配置 = 零注册零开销
- [ ] 4. createChatSdk:顶层 `proposals` 选项接线 + pending 态(模块内会话态,sdk.proposals 只读投射 + maxPending 替换留痕 + 相同基底相同产物拒且不动在审)+ `sdk.resolveProposal(id, outcome, detail?)`
- [ ] 5. 裁决闭环:`proposal_pending`/`proposal_resolved` 事件(SdkEvent/StreamEvent 加法)+ 下轮一次性结局注入(pin 段 + afterAgent 清除,hostNotice 同模式)+ debugLogs stage:'proposal' + `inspect().proposals`
- [ ] 6. usageHints:proposals 配置时一行纪律(先读取 hash/增量 ops 勿全量/提案仅送达待确认);`hasProposals` flag
- [ ] 7. selftest:hash 不匹配拒 / maxPending 替换 / 相同产物拒 / 未配置零行为;e2e 新模块 `tests/e2e/proposals.mjs`(装配反射 + Stub ReAct 一轮 read→propose→onProposal 产物统计 + resolveProposal 事件与下轮注入 + 裁决出队)

## Phase 3:导出与 demo(S3)

- [ ] 8. 导出 `lineDiff`/`applyProposalOps`(主包 + headless 双侧)+ 双 d.ts(ProposalsConfig/ReviewableProposal/SdkEvent 新成员/inspect().proposals)
- [ ] 9. `examples/proposals-demo`(Markdown textarea 真相源 + 宿主 diff 面板复用 lineDiff)+ browser spec(面板 diff 行渲染/应用回写/放弃不动/Esc)
- [ ] 10. 真 LLM 校准:tests/runtime docs-qa 族加「增量提案 vs 全量提案」token 对比场景,--baseline-diff 守不劣化

## Phase 4:文档与收尾

- [ ] 11. 文档四语侧:usage-guide §6.23 中英(选项/两工具/ops 表/hash 纪律/裁决闭环/边界)/ README 中英(特性行+options 行+demo)/ CLAUDE.md(目录/其他能力/SDK 用法示例)
- [ ] 12. CHANGELOG(minor)+ 计数同步 + 全量门禁(build/test/test:e2e/test:browser/test:exports/test:types 族/test:size/check-test-counts/pack --dry-run);发布前询问用户
