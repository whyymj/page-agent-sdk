# Tasks: team-review-hardening

> 实施任务清单。`/opsx:apply` 按此执行。**minor**(向后兼容)。分四阶段:授权面(A/B)→ 信任面(C/D)→ 行为批(E)→ 测试补强。

## 阶段 A:写能力标注单一真相源

- [x] A1 dataOps 工具定义加 `writeCapable` 标注(`set_data`/`edit_data`/`delete_data`/`draft_commit`/`write`/`resource_update`/`resource_delete`/`restore_data` 恒 true;`eval_script` 条件判定 `mode==='transform'`),定义点单源
- [x] A2 `SUB_WRITE_TOOLS` 消费点(subagent.ts 子 agent 装配剥离 + spawn 自授过滤)改按标注判定;e2e 断言:spawn tools 自授 `eval_script` 被拒/剥离
- [x] A3 `componentLock.ts` `WRITE_TOOLS` 改按标注(restore_data 有锁拒;eval_script 判 transform);e2e:锁内 eval_script(transform) 回灌 COMPONENT_LOCKED、mode 其他放行
- [x] A4 selftest:标注完整性断言(每个 writeCapable 工具进清单,防新写路径工具再漏)

## 阶段 B:__pgId 补齐收敛

- [x] B1 `supplementPgId`/`internalAfterWrite` 收敛进 `commitSetToBind` / `applyPatchesToBind` 成功路径(参数化注入,与 SCHEMA_STRIP 同层)
- [x] B2 selftest:set_data 整体替换 / edit_data patch / eval transform / draft_commit 四路径组件 `__pgId` 保留;新增组件补 __pgId

## 阶段 C:MCP 保留字保护

- [x] C1 MCP 工具注入前查内置保留名(builtin/user 来源工具名集合),冲突 → skip + console.warn(「MCP 工具 X 与内置重名,已拒绝注入」)
- [x] C2 e2e:mock server 返回 `write` 工具 → 不注入 + agent 原 write 行为不变 + warn 留痕

## 阶段 D:沙箱与脱敏

- [x] D1 sandbox 静态扫描补 `constructor` / `getPrototypeOf` / `prototype` 模式;selftest:`"".constructor.constructor(...)` 被拒
- [x] D2 `safeSerialize` 递归按 `ENV_SENSITIVE_KEY_RE` 脱敏嵌套 key(`'[REDACTED]'`);selftest:`inspect_env({key:'appConfig'})` 嵌套 apiKey 打码

## 阶段 E:行为正确性批

- [x] E1 wrapToolCall 洋葱外层 catch → `asAgentError(err,'recoverable')` 错误结果回灌;selftest:用户中间件 throw 不再 fatal 整轮
- [x] E2 wrap-up 只去首条 system,保留中部压缩摘要 SystemMessage;selftest:摘要送达 wrap-up
- [x] E3 启动闸 `stallMs > 0` 判定(0 = 真·关闭);selftest:streamStallMs:0 不套 race
- [x] E4 vfs 写前预检:内容超所属池上限 → 结构化错误回灌(提示拆分);selftest:3MB 写 2MB 池报错不静默淘汰
- [x] E5 deleteSession 先清该 sessionPrefix 命中的 pending/timers;e2e:删除后 500ms 内不复活
- [x] E6 mount() 局部变量覆盖 container,不回写 options;selftest:二次 mount 读 options 原值

## 阶段 F:测试盲区补强

- [x] F1 e2e automation:storage:'indexed' + checkpoint + automation 共存(batch 间 checkpoint 持久 + 跨实例恢复)
- [x] F2 browser lifecycle.spec:流式中 unmount → abort 收口 + 重新 mount 无残留
- [x] F3 e2e custom-injection:memory 异步抛错 → 降级空串 + agent 可用
- [x] F4 e2e mcp:双 server 一坏一好 → 好的工具照常注入,坏的降级不拖累
- [x] F5 e2e data-slots:空 schema + write → 全拒(SCHEMA_INVALID)不静默

## 收尾

- [x] G1 deferred.md 登记:图编排(不采纳理由)/ 评估框架化 / prompt caching / 跨会话偏好记忆 / buildCore 拆分 / DSML provider 层 / P2 批(锁时序/超时 commit 竞态/autoLock 无基线/spawn_agents 不对称/中文正则/中间件 priority 撞名/闭包残留)
- [x] G2 全量门禁:npm test && build && test:e2e && test:browser;计数同步 CLAUDE.md/README
- [x] G3 文档同步(usage-guide 提及 MCP 保留字行为 + fetchDocument CSRF 提醒)+ CHANGELOG
