# Tasks: fix-main-sub-isolation

> 组 3(P1-13/14/17)+ N1(Q4 拍板并入)。design 已含立项复查修正(N1 不可复现 → 防御加固)。

## §1 per-scope 乐观锁基线(P1-13)
- [x] dataOps.ts:lastReadHash → baselines Map + activeScope + getBaseline/setBaseline;全引用点替换;controller.set/update → baselines.clear()
- [x] DataOpsController 增 enterScope?(id)→恢复函数 / exitScope?(id);实现嵌套安全
- [x] createDataOps 返回工具挂不可枚举 __dataOpsScoped marker
- [x] subagent.ts:SubagentOptions 增 enterDataScope/exitDataScope;runSubagent 生成 scopeId + 包 scope proxy(marker 工具)+ finally exitScope
- [x] createChatSdk:subagentMw/subagentsMw 两处接线(dataOpsController 存在时)

## §2 N1 防御加固
- [x] writeSlot effHash 解析点注释锁定契约(拦截器后、检查时刻);确认 set/edit/delete/draft_commit 同
- [x] 回归断言:同 scope 连续写不冲突(selftest)+ async 拦截器间隙场景不冲突(selftest)

## §3 spawn_agents allSettled(P1-14)
- [x] spawnMany fn 逐项 try/catch → {ok,text}/{ok,error};聚合文本 ✓/✗ 逐条;工具不再整体 reject

## §4 子 usage 回传(P1-17a)
- [x] contentParts.ts:normalizeUsage 纯函数;sdk-events afterModel 改用(消重)
- [x] SubagentOptions.onUsage;runSubagent 装 sub-usage 中间件(仅 onUsage 时)
- [x] createChatSdk:onUsage 累加 core.usage(不外发事件);两处接线

## §5 子执行超时(P1-17b)
- [x] SubagentOptions.timeoutMs;runSubagent 链式 AbortController + race + abort + unhandled 防护
- [x] createChatSdk subagent 选项类型补 timeoutMs + 接线;types/{index,headless}.d.ts 同步

## §6 测试
- [x] selftest sec-70(§7 矩阵)并在 runner 注册;计数同步
- [x] e2e main-sub-isolation.mjs(4 场景)+ runner 注册;stub delayMs 支持
- [x] browser 既有 40 项回归

## §7 文档与收尾
- [x] CLAUDE.md:子 agent 段(allSettled/usage/timeout/基线隔离)+ 数据槽乐观锁段补 per-scope
- [x] README/README.zh-CN 计数;usage-guide 子 agent 段(如涉配置)
- [x] 门禁全套(build/test/e2e/browser/exports/types/types-alignment/size/src 真错)+ pack
- [ ] commit develop;询问用户是否发布
