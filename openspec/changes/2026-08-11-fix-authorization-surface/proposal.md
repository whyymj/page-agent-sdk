# Change: fix-authorization-surface(授权与拦截面完整性修复)

> 来源:`2026-08-10-audit-sdk-integrity` 审计 P0-1 + P1-15/16/18/21/22;Q1-Q5 已拍板(审计 tasks §7.1):
> 装配期源头 filter(非运行期防御)、本 change 由 fix-subagent-tooling 改名而来(focus 绕过同属「谁能写什么」拦截面)。

## Why

审计发现 SDK 的「工具授权/拦截面」存在一个 P0 与五个 P1,共同主题:**谁能用什么工具、谁能写什么路径**的承诺在多条路径上失效。

- **P0-1(已实测复现)**:传给 spawn/预声明子 agent 中间件的 `allTools` getter 指向 createChatSdk 局部池(8 源 rebuildExtraTools),而 vfs 工具是**中间件工具**(`createVfsMiddleware` 经 `mw.tools` 注入,不在该池)→ `createHtmlSubagent` 的 `['vfs_write','vfs_edit','vfs_rm','vfs_grep','vfs_read']` 与 `createRagSubagent` 的 `['vfs_grep','vfs_read','vfs_json_read']` **全部静默丢失**;「代码正文→vfs」「vfs 搜预注入文档」两条能力包核心流断裂(2.37 发布即带)
- **P1-16**:`spawn_agent` 的 `tools`/`writablePaths` 参数由 LLM 运行时自选(自授);子中间件栈不含主 permissions/approval → 配 `approval:{tools:['write']}` 的集成方被委派路径**整体绕过**(子 agent 直接写,无人确认)
- **P1-18**:子 agent `writablePaths` guard 的 `extractWritePaths` 只收集**有** jsonPath 的 patch 项 → 混合批量 `patches:[{set,jsonPath:'components.0.x'},{merge,无 jsonPath(作用于根)}]` 无 path 项不收集不校验,paths 非空即整体放行 → 越界写根
- **P1-21**:focus strict 的 WRITE_TOOLS 不含 `eval_script` → 聚焦下经脚本 transform 可改写任意路径/整体数据;usageHints 还主动推荐「批量重写大数组用 eval_script」
- **P1-22**:无 jsonPath 整体写(`write({value})`/`set_data`/edit merge-append 无 path)→ extractScopes 返空 → 循环空转放行;白名单限字段不限子树,与 focus「范围收紧 strict」承诺冲突
- **P1-15**:子 agent 无 vfs 中间件 → offload 大结果写入每次 stream 新建的一次性 `state.files`;子的 vfs_read 却读主 vfsStore → 按提示回读**必 404、原文实际丢失**

## What Changes

1. **P0-1**:`createChatSdk` 传给 spawn/subagents 中间件的 `allTools` getter 改指向 **agent 合并池**(`core.agent?.allTools ?? allTools`,同 inspect 写法)→ 中间件工具(vfs/load_skill/todos 等)对子 agent 白名单筛选可见
2. **装配期源头 filter(Q1)**:子 agent 工具池构建统一经 `buildChildTools`(纯函数,导出供测)—— 白名单筛选后**排除框架/保留工具**:`spawn_agent`/`spawn_agents`/`use_*`(保留前缀)/`load_skill`/`write_todos`/`update_todo`/`restore_last_checkpoint`/`request_human_confirmation`/`set_focus`/`add_focus`/`remove_focus`/`clear_focus`。防 spawn 自授激活 depth 链/反向泄漏会话级状态操作;`extraTools`(集成方显式)不过滤
3. **P1-16**:`spawn_agent` 自授 `tools` 剥离写工具(SUB_WRITE_TOOLS —— 写权限只能经 `writablePaths` guard 路径获得);子 agent 栈**继承主 permissions/approval 实例**(`SubagentOptions.guardMiddleware`),子的 approval_request 经子 stream handler **直通转发**回主循环 handler(ApprovalBar 可见可收口,不包裹为进度事件)
4. **P1-18**:`wrapWithPathGuard` 检测 `patches` 中**缺 jsonPath 的项**(作用于根)→ 整体 PATH_OUT_OF_SCOPE(子 agent 不可写根)
5. **P1-21/22(focus.ts)**:WRITE_TOOLS 增 `draft_commit`、移除 `vfs_write`/`vfs_edit`(vfs 路径非数据 jsonPath,聚焦下误拦合法 vfs 写);`eval_script` 仅 `mode:'transform'` 参与拦截(有 jsonPath 查焦点子树,无 = 整体写 → 拒);WRITE_TOOLS/eval-transform **空 scopes = 整体写 → PATH_DENIED**(不再放行)
6. **P1-21/22 同型(permissions.ts)**:WRITE_TOOLS 增 `eval_script`(仅 transform)/`draft_commit`;write 空 scopes → 按根 scope `''` 校验(原实现跳过 = 绕过口子)
7. **P1-15**:`SubagentOptions.getVfsFiles`(createChatSdk 注入 `() => vfsStore.files`)→ 子栈装 `vfs-bridge` 中间件(`beforeAgent` 注入 `{ files }`)→ 子 offload 大结果直落主 vfs 共享池,子 vfs_* 工具回读同池不 404

## Impact

- **修复面**:`subagent.ts` / `createChatSdk.ts`(装配段)/ `focus.ts` / `permissions.ts`;类型 `types/{index,headless}.d.ts`(SubagentOptions/SubagentsMiddlewareOptions 新字段)
- **行为变化(集成方视角)**:
  - rag/html 能力包恢复工作(P0-1)
  - 子 agent 写操作开始受主 permissions/approval 约束(**安全收紧**;原「委派绕过确认」行为消失)
  - 聚焦下整体写/eval-transform/无 path patch 被拦(**strict 承诺兑现**;原静默放行消失)
  - focus 下 vfs_write/vfs_edit 不再被误拦(PATH_DENIED on 文件路径)
  - spawn 自授写工具被剥离(写权限须经 writablePaths)
- **零回归面**:主 agent 工具池/主栈中间件序不变;`extraTools` 不过滤;不传 approval/permissions 时子栈无 guard(现状);未聚焦行为不变;permissions 未配置行为不变
- **测试**:selftest 新增断言(buildChildTools/isReservedFrameworkTool/wrapWithPathGuard/focus/permissions)+ e2e(guard 继承 + approval 转发 + vfs 桥接端到端);计数同步

## Non-goals

- P1-13(per-caller hash 基线)/ P1-14(allSettled)/ P1-17(子 usage/超时)→ fix-main-sub-isolation(含 N1,Q4 已拍板)
- 组 1 挂起/可见性 7 项 → fix-hang-and-feedback(先出统一 design,Q3 已拍板)
- humanConfirm 中间件不进子栈(request_human_confirmation 已被框架 filter 排除,无挂起风险)
- resource_update 等受保护资源工具不入 focus/permissions 拦截面(语义正交,审计未列)
