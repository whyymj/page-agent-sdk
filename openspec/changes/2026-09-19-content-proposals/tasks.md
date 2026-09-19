# Tasks:content-proposals

> 打勾标准:代码/文档落地 + 对应测试绿 + 计数同步。前置:action-host-semantics(deferredWrite 口径复用)✅ 已随 4.20.0 发布。
> 体积注意:纯函数 + 装配逻辑,预期 JS 产物增量 <5KB,超预期则 size 双闸重校留档(designSkill 先例)。

## Phase 1:纯函数域(S1 内核)

- [x] 1. `src/core/tools/proposalOps.ts`:`lineDiff`(前后缀修剪 + 中段 LCS Uint32 DP + >4e6 格回退整块替换 + stats,学习门户 note-diff 同款算法)+ `applyProposalOps`(replace/insertAfter·insertBefore/append;字面锚唯一命中;任一失败整批拒,错误指名第几个 op 与命中数)+ `hashContent`(FNV-1a→base36,确定性非密码学)+ `countOccurrences`(空锚按 0)
- [x] 2. selftest sec-135(21 项):diff 矩阵(全同/插/删/换/修剪 102 行/空文本/2100×2100 超限回退亚秒)/ ops(唯一锚/0 命中/3 命中指名/insert 前后/append/顺序应用/原子整批拒)/ hash 确定性

## Phase 2:通道装配(S1/S2)

- [x] 3. `src/core/sdk/proposals.ts`:`ProposalsConfig`/`ReviewableProposal` 类型 + `createProposalChannel` 工厂(read_content / propose_content 两工具 zod schema,ops 判别联合 + superRefine ops⊕content 二选一;**看门狗打标**(read/onProposal 是集成方代码);onProposal 异常隔离回灌);未配置 = 零注册零开销
- [x] 4. createChatSdk:顶层 `proposals` 接线(工具并入 user 面)+ pending 态(snapshot 轻投影)+ `sdk.resolveProposal`/`sdk.proposals`(AgentCore + wrapper 双面)+ maxPending 替换留痕 + 相同基底同产物拒且不动在审(修门户观察 1)
- [x] 5. 裁决闭环:`proposal_pending`/`proposal_resolved`(SdkEvent 加法面)+ `proposalNoticeMw` 下轮一次性结局注入(pin 段,createAgent `PIN_SEGMENT_NAMES` 增 'proposalNotice',afterAgent 清除)+ debugLogs `stage:'proposal'`(pending/rejected/replaced/resolved)+ `inspect().proposals`
- [x] 6. usageHints:`hasProposals` flag + 提案纪律行(先读 hash/增量 ops 勿全量/提案仅送达待确认/裁决为准);未装不教。**4.20 联动零配置**:read_content 自动并入 hostReadActionNames(notifyHostChange 失效面)、propose_content 并入 deferredWriteActionNames(事实清单「待确认」口径)
- [x] 7. selftest 并入 e2e;e2e 新模块 `tests/e2e/proposals.mjs` 27 项:未配置零反射/ReAct 全链(hash 头回灌 + ops 应用产物 + 事件 + pending 反射 + hints)/hash 不匹配拒 + 坏锚指名拒/去重不动在审 + maxPending 替换留痕/裁决闭环(事件 + 计数 + 一次性段 + 再下轮不残留 + 幂等)/谎报完成回灌改口。**实施注记两则**:①裁决闭环 e2e 首版用户消息用祈使句触发零工具门禁回灌吃掉 stub 队列(机制正常,debug 证实末次调用含结局段)→ 改问句豁免;②宿主 onProposal 返回文案 + 系统尾巴的断言按实际形态校正(startsWith + 待确认 + diff 统计)

## Phase 3:导出与 demo(S3)

- [x] 8. 导出 `lineDiff`/`applyProposalOps`/`hashContent`/`countOccurrences` + `DiffRow`/`ProposalOp`/`ReviewableProposal`/`ProposalsConfig`(主包 + headless 双侧,三入口中转)+ 双 d.ts(选项/事件/inspect/ChatSdk.resolveProposal·proposals 四处)。**实施注记**:两个 d.ts 的 SdkEvent union 原尾行带分号,追加成员后语法错(types 三门禁同红)—— 联合尾行收编改分号到末成员;首版漏 CLAUDE.md 模块数 129→130 计数对账红
- [x] 9. `examples/proposals-demo`(textarea 真相源 + 折叠 diff 面板 + 应用写回/放弃 + resolveProposal)+ browser spec 2 项(动态 baseHash 从 wire 上轮工具结果提取 —— 静态脚本给不出运行时 hash)
- [x] 10. 真 LLM 校准:`tests/runtime/proposals-real-llm.mjs` 两场景(修正错字 ops 形态 + 长文 20× 增量 token 经济性),注册进 real-llm REGISTRY;无 key 自动 skip。**基线采集待有环境实跑**(--baseline-update;报告 gitignore)

## Phase 4:文档与收尾

- [x] 11. 文档四语侧:usage-guide §6.23 中英(选项/两工具/ops 表/hash 纪律/裁决闭环/去重替换/4.20 联动/渲染导出)+ README 中英(特性行 + options 行)+ CLAUDE.md(能力段 + examples 目录 + 计数 3759/1256/172 + selftest 模块 130 + e2e 模块 38)
- [x] 12. CHANGELOG 4.22.0(minor)+ 门禁:build/test 3759/e2e 1256/browser 172/exports 25/types 族 3 项/size 6/计数对账/pack 25 files 全绿;**发布前询问用户**(待拍板)
