# T 测试盲区专项审计结果(audit-sdk-integrity)

> 基线 2.38.0 | 2026-08-10 | 方法:逐文件 grep + 读测试源码,覆盖状态全部基于实际文件内容
> 清单:selftest sec-01~68(68 模块,sec-25~68 为 2.24 后新能力专测)/ e2e 19 模块(agent-compression、automation、boundary、capability-packs、conflict、custom-injection、data-slots、dynamic-register、events、exports、focus、headless-subpath、inspect、llm-provider、presets、resources、storage、subagents、systemprompt)/ browser 9 spec 40 test(complex×14、customize×7、page×5、queue×3、nested×3、rag×2、human-confirm×2、error-recovery×2、xss×2)

## T1 覆盖对照矩阵

| 能力 | selftest | e2e | browser | 结论 |
|---|---|---|---|---|
| mission | ✅ sec-35 强(capture 启发式/截断/合并清空/P1-6 不重捕/pin) | ✅ storage.mjs 持久化往返 + inspect.mjs send 显式 capture + off no-op | ✅ complex capture→systemPrompt pin | 扎实 |
| workingMemory | ✅ sec-38(捕获/LRU≤10/augment) | ❌ 仅注释提及,无持久化往返断言 | ❌ | 逻辑有;**persist roundtrip 零覆盖** |
| focus 多焦点 | ✅ sec-54/56/57(PATH_DENIED/前缀边界/kind 存取) | ✅ focus.mjs 45 断言(去重/往返/失效逐 path 丢/setLlm 保留) | ✅ 拾取→chip→✕/多 chip/历史标注/越界自纠 | 扎实 |
| focus 子 agent 继承 | ⚠️ sec-54 仅 initialFocuses 构造级 | ❌ 注释自认「继承是运行态,只测装配」 | ❌ | **运行态继承零断言** |
| 自适应规划 maxPlanRevisions | ✅ sec-34 状态机全链 + sec-43 层级 | ✅ inspect 工具+planPhase | ✅ page write_todos→update_todo→write | 扎实 |
| 受保护资源 freeze/verbatim | ✅ sec-58~61 四模块白box(enforce/C1/C3/D1/池/pin) | ⚠️ resources.mjs 装配+SDK API,不走工具调用 | ⚠️ 仅 freeze;verbatim 未进 browser | selftest 充分;verbatim 端到端弱 |
| draft_write/commit | ✅ sec-41 强(生命周期/SCHEMA_INVALID 草稿保留/**A1 冲突三场景**) | ⚠️ inspect 仅暴露开关 | ❌(仅真 LLM 手动) | 否证「仅真 LLM 测」疑点;**mock/node 循环层零覆盖**(complex 已开 draftWrite 无 spec) |
| agentCompression | ✅ sec-62~65(gate/inspect_context/decide 循环 8 场景/决策切分) | ⚠️ 仅 resolveCapabilities+装配不崩+schema | ❌ | 单元强;**summarization×decideInvoke 接线零测试** |
| headless 子路径 | — | ✅ headless-subpath 强(导出面/降级 warn/bundle 纯净+体积) | ✅ customize 7 项 | 扎实 |
| 能力包 rag/html | ✅ sec-67(工厂/search_docs/load_doc 直调) | ⚠️ 仅 use_rag/use_html 存在+skill 文件 | ❌ | **use_<id> 委派执行全仓零覆盖** |
| 子 agent 观察层 | ✅ sec-68 tracker 单元 | ❌ 仅 typeof+空数组 | ❌ | **真实 spawn→tracker 记录零集成断言** |
| checkpoint 增量 | ✅ sec-17(vfs/data 脏标记/共享 clone/dryRun 不标脏/基线重置) | ✅ boundary + automation 断点续跑 | ✅ nested ↩ 回退 | 扎实 |
| recall+trim LLM | ⚠️ sec-32 仅 composeTrimSummary 纯函数+GC | ❌ | ❌ | **异步 LLM 增强+竞态守卫零测;context_trimmed emit 全仓零断言** |
| context 韧性三闸 | ✅ sec-55(caps/protectedRefs/OOM)+sec-23(_ctxRetry 真跑)+sec-20(预算 drop) | ✅ boundary <200K 启动/setLlm throw | — | 扎实 |
| skill exec/tools | ✅ sec-05 强(sandbox 拒/host 门/url+host 禁/失败不缓存/工厂回调) | ⚠️ 仅装配期(load_skill 运行态不触发) | ❌ | 白box 充分;全链无循环级覆盖 |
| automation | ✅ sec-21 budget | ✅ automation.mjs 为 e2e 最强(stub 驱动预算/恢复/batch/续跑/path guard) | ❌ | 扎实 |
| approval | ✅ 中间件逻辑 | ❌ **e2e 零覆盖**(grep 确证) | ✅ human-confirm 允许/拒绝+nested gating | browser 充分;headless+send 可见性(H18)无测试 |
| schema 分层披露 | ✅ sec-37(阈值/浅渲染/可配) | ❌ | ❌ | 纯 prompt 函数足够 |

## T2 弱断言样本

**系统性根因**:FAKE_LLM 是配置对象(`{apiKey,baseUrl,model:'fake'}`)非 BaseChatModel → **19 个 e2e 模块中 17 个从未驱动 ReAct 循环**(仅 automation/inspect 用 stubModel),e2e 退化为装配反射层。

| 文件 | 行为 |
|---|---|
| tests/e2e/events.mjs | 4 节全弱:只断「hook 返回 function」「未触发计数 0」,**从不触发任何事件断言投递**;session_restored 注释自认「仅验证类型系统」 |
| tests/e2e/conflict.mjs | 全 5 断言仅 ref 存在/初始 null/typeof resolveConflict/幂等;**真实冲突流零覆盖**(e2e grep 无 expectedHash/VERSION_CONFLICT) |
| tests/e2e/capability-packs.mjs:83-99 | 观察层仅 typeof getActiveSubagents + active/history 恒空数组,从不触发委派填充 |
| tests/e2e/subagents.mjs:47-66 | focus 继承只断「setFocus ok + 中间件在」,注释明示运行态未测 |
| tests/e2e/agent-compression.mjs | 装配不崩 + safeParse;decide→compress 全链不经 e2e |
| tests/e2e/headless-subpath.mjs | 12/23 typeof(导出面合理),降级后未跑 send |

**browser 40 项 vs demo 能力面缺口**:① complex 开 draftWrite:true 但零 draft spec;② DebugDrawer 仅开「Agent 信息」tab(📊 上下文/🤖 子 agent/🗜️ 压缩注记零触);③ ConflictBar 完全缺席;④ get_dom 仅搭 save_draft 无独立深度/白名单断言;⑤ dynamic/animation/multi-agent/proxy/planner/toolsets 六 demo 零 spec;⑥ 无跨刷新 indexed 恢复。

## T3 browser/e2e 缺路径(按风险排序)

1. **冲突条三选一闭环**(数据安全机制三层运行时全盲;联动停止生成收挂起冲突 P1-c)
2. **stream 中途 switchSession**(H6/P1-b:headless 直接切换是否 abort 进行中流)
3. **draft_write×N→draft_commit 确定性 e2e**(mock LLM 可编排;现仅真 LLM 手动)
4. **checkpoint 回退 × focus 共存**(基线重置×focus 持久化×脏标记交叉)
5. **DebugDrawer 新 tab**(2.37/2.38 新 UI 零覆盖)
6. **队列饥饿交互**(H26:前任务停滞时排队区无反馈;现只测正常顺序/撤销/修改)
7. **unmount × approval/conflict 挂起态**(悬挂 Promise 写已销毁状态)
8. **headless+send approval 可见性**(H18,e2e 补)
9. **跨刷新会话恢复**(reload 后 messages/mission/focus)
10. **verbatim 进 browser**(complex 加一 verbatim 字段走 resource_update 流)

## Findings

```
T-1|P2|test-blindspot|tests/e2e/conflict.mjs+全 browser|冲突介入闭环三层无运行时覆盖|e2e 仅存在性断言;browser 无 ConflictBar;sec-26 仅 dataOps 层|stub 驱动触发冲突→三选一断言 bind 态+browser 冲突条 spec
T-2|P2|test-blindspot|tests/e2e/capability-packs.mjs:83-99|观察层无集成断言|active/history 恒空+typeof|automation spawn stub 场景补断言 subagentHistory
T-3|P2|test-blindspot|selftest 全仓|agentCompression 装配接线零测试|无 summarization 挂 decideInvoke 用例|补 gate→decide→compress 接线(stub decideInvoke)
T-4|P3|test-blindspot|utils/rounds|trim 异步 LLM 增强+context_trimmed emit 零断言|仅 composeTrimSummary 纯函数测|补 fire-and-forget/竞态守卫/事件 payload
T-5|P3|test-blindspot|tests/e2e/subagents.mjs:47-66|focus 子 agent 运行态继承零断言|仅装配级+initialFocuses 构造|stub 驱动主聚焦→子写焦点外 PATH_DENIED
T-6|P3|test-blindspot|tests/e2e/storage.mjs|workingMemory 持久化往返未测|只 mission 往返|仿 mission 补 locatedPaths/lastHashes 还原
T-7|P3|test-blindspot|全仓|use_<id> 委派执行零覆盖|sec-29 仅 controller;spawn 有覆盖 use_ 无|stub 队列加 use_<id> 断言结果回灌
T-8|P3|test-blindspot|tests/e2e/events.mjs|e2e 事件投递零断言|只测注册不测触发|stub send 断言事件顺序+off 后不收
T-9|P3|test-blindspot|tests/browser/|draft browser 零覆盖+6 demo 无 spec+DebugDrawer 新 tab 零触|见 T2 缺口清单|按 T3 排序补
T-10|P3|process-hygiene|CLAUDE.md 测试小节|文档称 e2e 覆盖「冲突人工介入」与实际强度不符|conflict.mjs 仅存在性|补 T-1 或降级文档表述
```

## 一句话总评

2.25 以来每个新能力在 selftest 都有专门白盒模块且逻辑断言扎实(「draft 仅真 LLM 测」「agentCompression 无逻辑层」两项设计疑点被否证),但 e2e 层因 FAKE_LLM 不跑循环系统性退化为装配反射层(19 模块仅 2 个驱动真 ReAct),冲突介入闭环、观察层运行时记录、trim 异步增强、focus 子 agent 运行态继承四条链三层测试均无运行时断言,是最高优先补测方向。
