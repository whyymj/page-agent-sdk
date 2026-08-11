# Design: fix-authorization-surface

## §1 P0-1:getter → agent 合并池

**现状**(`createChatSdk.ts:1070/1091`):`allTools: () => allTools` —— `allTools` 是局部变量,仅 `rebuildExtraTools()` 的 8 源池(builtin/user/action/humanConfirm/checkpoint/focus/mcp/skill)。中间件工具(vfs 9 个、load_skill、write_todos/update_todo、spawn_*、use_<id>)经 `createAgent` 的 `mw.tools` 合并进 `agent.allTools`(createAgent.ts:829/849),不在局部池 → 子 agent 白名单筛选恒落空。

**修复**:两处 getter 改为 `() => core.agent?.allTools ?? allTools`(与 inspect().tools 同款写法,createChatSdk.ts:1722)。`core` 在 getter 定义行之后声明(1292),闭包惰性求值(spawn 发生在 init 后)无 TDZ 风险;TS 允许闭包引用后声明块级变量。

**装配时序**:getter 只在 `runSubagent` 调 `getAllTools()` 时求值(委派发生 = agent 已构造)→ 合并池必然就绪;`?? allTools` 兜底未构造场景(不崩,行为同现状)。

## §2 装配期源头 filter(Q1 拍板)

**为什么不用运行期防御**:运行期检查(子 agent 执行 use_<id> 时拒绝)= 每个执行点都要记得查,新增委派路径易漏;装配期 filter = 框架/保留工具**物理不进子池**,无执行点可漏。

```ts
// subagent.ts
const SPAWN_TOOL_NAMES = ['spawn_agent', 'spawn_agents']  // 既有
/** 框架/会话级保留工具:子 agent 池禁入(装配期源头 filter;防自授激活 depth 链/操作主会话状态) */
const FRAMEWORK_TOOL_NAMES = [
  'load_skill',                    // 主 skills 中间件工具(子有自己的 skills)
  'write_todos', 'update_todo',    // 主 planning(子规划经自己的 todos middleware 装)
  'restore_last_checkpoint',       // 会话级回滚,子不可操作
  'request_human_confirmation',    // 子栈无 humanConfirm 中间件 → 调用即永挂
  'set_focus', 'add_focus', 'remove_focus', 'clear_focus',  // 会话级焦点状态,子继承不突变
]
/** use_* = 预声明委派保留前缀(防 spawn 自授 use_<id> 激活 depth 链;集成方自定义工具避免用 use_ 前缀) */
export function isReservedFrameworkTool(name: string): boolean {
  return SPAWN_TOOL_NAMES.includes(name) || FRAMEWORK_TOOL_NAMES.includes(name) || name.startsWith('use_')
}
/** 子 agent 工具池构建(纯函数,导出供测):白名单筛选 + 排除保留工具 + extraTools 直加 */
export function buildChildTools(pool, allow: Set<string>, extraTools = []): StructuredToolInterface[] {
  return [...pool.filter((t) => allow.has(t.name) && !isReservedFrameworkTool(t.name)), ...extraTools]
}
```

- runSubagent 的 childTools 构建改用 `buildChildTools`;writablePaths guard 分支的写工具选择同样经 `isReservedFrameworkTool`(写工具名不碰撞,防御性一致)
- `extraTools`(预声明 config.tools,集成方显式)**不过滤**——信任边界 = 集成方;LLM 可达的 `allowedTools`/spawn `tools` 才过滤
- `use_` 前缀保留:集成方自定义工具若撞名会被子池排除(文档注明;概率极低,安全收益大)

## §3 P1-16:spawn 自授收紧 + guard 继承

### 3a spawn 自授剥离
`spawnOne` 中 LLM 传的 `tools` 先剥离 `SUB_WRITE_TOOLS`(write/set_data/edit_data/delete_data/draft_commit)——写权限**只能**经 `writablePaths`(path guard 包装)获得:

```ts
const granted = (tools ?? []).filter((t) => !SUB_WRITE_TOOLS.includes(t))
const subOpts = granted.length || writablePaths?.length ? { ...opts, ...(granted.length ? { allowedTools: granted } : {}), ... } : opts
```
框架/保留工具无需此处剥离(buildChildTools 装配期兜底);schema description 同步注明。

### 3b guard 继承(approval/permissions 进子栈)
- createChatSdk 装配段:permissions/approval 中间件**提升为具名 const**(原内联在栈数组),构造 `childGuards = [permissionsMw?, approvalMw?]`(序同主栈:permissions 外层先自动拒,approval 内层再人工确认)
- `SubagentOptions.guardMiddleware?: Middleware[]` + `SubagentsMiddlewareOptions` 同字段;`configToSubOpts` 透传;runSubagent 子栈装载序:
  `skills → summarization → vfs-bridge → 递归 subagent → focus → guardMiddleware(permissions→approval) → opts.middleware(用户)`
- **实例共享安全性**:approval/permissions 均无闭包级可变状态(approval pending 经 Promise/事件,per-call)→ 主子共享同一实例无串扰;approval 经 `ctx.emit` 发 approval_request,子的 ctx.emit = 子 stream handler → 见 3c

### 3c approval_request 直通转发
子 stream handler 现状只转发 tool_call/tool_result(包裹为 subagent 进度)。扩展:

```ts
return child.stream([...], (e) => {
  if (e.type === 'approval_request') { emitToMain?.(e); return }  // 直通主循环 handler(ApprovalBar),不包裹
  if (forward && (e.type === 'tool_call' || e.type === 'tool_result')) forward(e)
}, signal)
```

`emitToMain` = runSubagent 新增参数,调用方传 `currentEmit`(wrapToolCall 捕获的主循环 handler)。主 handler 链(useChat wrappedHandler)收到 approval_request → pendingApproval → ApprovalBar 渲染 → 用户收口 → 子工具 Promise resolve → 子继续。abort 联动不变(approval 内 signal 监听,主停子停自动拒)。

**不过 sdk 级 emit**:approval_request 本就不外发(events.ts:23 过滤),与主流程语义一致(主流程 approval 也走 stream handler 而非 listeners)。

## §4 P1-18:writablePaths guard 补 patches 无 path 项

`wrapWithPathGuard` 前置检测(先于 extractWritePaths):

```ts
if (Array.isArray(args?.patches) && args.patches.some((p) => !p || typeof p.jsonPath !== 'string' || !p.jsonPath)) {
  return `PATH_OUT_OF_SCOPE:patches 含无 jsonPath 项(作用于根),子 agent 仅可写 ${prefixes.join(', ')} 范围内子路径。`
}
```
- 混合批量不再「收集到的路径合法即整体放行」;无 path 项 = 根写 = 子 agent 禁止
- 其余形态(write({value})/edit merge 无 path/draft_commit)→ extractWritePaths 返空 → 原有「不能整体替换」拒绝,行为不变

## §5 P1-21/22:focus 拦截面修正

```ts
const WRITE_TOOLS = new Set(['set_data', 'edit_data', 'delete_data', 'write', 'draft_commit'])
// 移除 vfs_write/vfs_edit:vfs path 是文件路径非数据 jsonPath,与焦点前缀比较恒不匹配
// → 聚焦下 html 子 agent 写代码文件被误拦(PATH_DENIED);vfs 工作区不属焦点数据范围
```

wrapToolCall(聚焦时):
1. **eval_script**:`mode !== 'transform'`(query 只读)→ 放行;transform → 取 scopes(jsonPath):空 = 整体/patches 增量(必无 jsonPath)→ PATH_DENIED;非空逐项查焦点子树
2. **WRITE_TOOLS**:`extractScopes` 空 → **PATH_DENIED(整体写不可校验 = 越界)**;非空逐项查(原逻辑)
3. 拒绝文案沿用现格式(PATH_DENIED · 聚焦越界 + 焦点列表)

**误拦评估**:聚焦下「整体写」本就该禁(strict 承诺);edit merge/append 无 path = 改根 = 拒;dryRun 整体写也被拒(无害,未落盘)。

## §6 permissions.ts 同型修正

- WRITE_TOOLS 增 `draft_commit`;增 `eval_script`(但 wrapToolCall 内 `mode !== 'transform'` → op=null 跳过 —— query 只读)
- `if (op === 'write' && !scopes.length) scopes = ['']`:无 jsonPath 写按**根 scope** 校验。glob `**`/`''` 规则可命中;`config.*` 等具体规则不误伤(保守:仅全局 deny 拦整体写)。docstring 同步删「整体操作不校验」句
- focus 与 permissions 的差异:focus = strict(空 scopes 拒);permissions = 默认 allow(空 scopes → 根 scope 查规则)。语义各自正确

## §7 P1-15:vfs-bridge

```ts
// SubagentOptions
getVfsFiles?: () => Record<string, VfsFile>  // createChatSdk 注入 () => vfsStore.files;不传=无桥接(零回归)
// runSubagent 子栈(vfs 启用时):
{ name: 'vfs-bridge', beforeAgent: () => ({ files: opts.getVfsFiles!() }) }
```
- 子 `state.files` = 主 vfsStore.files(Proxy 共享引用)→ 子 offload(`offloadLargeResult` 写 `ctx.state.files`)直落主池 `large_results/`(内容寻址去重);子 vfs_read(vfsAvailable 时)回读同池 → 不 404;主 agent 亦可读子 offload 文件
- offload 触发条件不变(`vfsAvailable = child allTools 含 vfs_read`):未授 vfs_read 的子走截断兜底(现状)
- 主 GC(setProtectedRefs 扫主 messages)不扫子 messages → 子 offload 文件仅受 LRU 保护;子在跑时主池被撑爆才可能被挤(4MB 池,极端场景,接受)

## §8 风险矩阵

| 风险 | 缓解 |
|---|---|
| 合并池 getter 让子 agent 见到不该见的工具 | buildChildTools 保留 filter + 默认只读白名单不变;allowedTools 集成方显式信任 |
| guard 继承后子写被 approval 挂起,无人察觉 | approval_request 直通转发到主 handler → ApprovalBar 正常渲染(与主流程同路径) |
| focus 空 scopes 拒绝误伤 dryRun/只读场景 | 仅 WRITE_TOOLS + eval-transform;query/read 不拦;dryRun 拒无害 |
| vfs_write 移出 focus 拦截 → 聚焦下可写任意 vfs 文件 | vfs 是工作区(代码/文档)非页面数据;写 data 才经 focus;html 子 agent 恢复可用 |
| `use_` 前缀误伤集成方自定义工具 | 文档注明保留;概率极低;安全收益(depth 链)大 |
| permissions 根 scope '' 误伤 | 仅全局 deny 规则(`**`/`''`)命中;具体路径规则不匹配 '' |

## §9 回退

全部为增量/收紧改动,单 commit 可整体 revert;无公开 API 破坏(新增可选字段 + 纯函数导出)。
