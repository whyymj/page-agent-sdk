# Tasks: fix-authorization-surface

> 授权与拦截面完整性:P0-1 + P1-15/16/18/21/22。design.md §1-§7 对应实施段。

## §1 subagent.ts(P0-1 子侧 + P1-16/18)
- [x] `isReservedFrameworkTool`(导出)+ `buildChildTools`(导出)纯函数;runSubagent childTools 改用
- [x] writablePaths guard 分支同步经 `isReservedFrameworkTool`
- [x] P1-18:`wrapWithPathGuard` 前置拒 patches 无 jsonPath 项
- [x] `SubagentOptions.guardMiddleware?` / `getVfsFiles?`;runSubagent 子栈装 guard + vfs-bridge
- [x] runSubagent 新增 `emitToMain` 参数;子 stream handler 直通转发 approval_request
- [x] spawnOne:自授 tools 剥离 SUB_WRITE_TOOLS + schema description 更新
- [x] `SubagentsMiddlewareOptions` 增 guardMiddleware/getVfsFiles;configToSubOpts 透传

## §2 createChatSdk.ts(P0-1 装配侧 + guard 注入)
- [x] permissions/approval 中间件提升具名 const;childGuards 构造
- [x] subagentMw/subagentsMw:getter → `() => core.agent?.allTools ?? allTools`;注入 guardMiddleware + getVfsFiles
- [x] 中间件栈数组改用提升后的 const

## §3 focus.ts(P1-21/22)
- [x] WRITE_TOOLS:移除 vfs_write/vfs_edit,增 draft_commit
- [x] wrapToolCall:eval_script transform 拦截 + 空 scopes 整体写 PATH_DENIED

## §4 permissions.ts(同型)
- [x] WRITE_TOOLS 增 draft_commit/eval_script(仅 transform 生效);write 空 scopes → 根 scope '' 校验

## §5 类型同步
- [x] 核实:d.ts `SubagentOptions` 为宽松接口(`[k: string]: any`)、工厂声明 `(opts: any)` → 新字段无需改 d.ts(已验证,test:types/types-alignment 全绿)

## §6 测试(新增功能测试同步约定)
- [x] selftest:buildChildTools(html/rag allowedTools 解析 vfs 工具 + 保留工具排除)/ isReservedFrameworkTool
- [x] selftest:wrapWithPathGuard patches 无 path 项拒绝 + 合法批量放行
- [x] selftest:focus(eval-transform 无 path 拒 / 子路径内放行 / query 放行 / write 整体拒 / vfs_write 聚焦下放行)
- [x] selftest:permissions(全局 deny 拦整体写 / eval transform / query 放行)
- [x] e2e:approval guard 继承(spawn 子 write → approval_request 转发 → resolve → 写入生效)
- [x] e2e:vfs 桥接(子 offload/vfs_write 落主池,子 vfs_read 回读成功)
- [x] 计数同步(CLAUDE.md/README 中英文)

## §7 门禁与收尾
- [x] npm test + build + test:e2e + test:browser + test:types-alignment 全绿
- [ ] commit develop;询问用户是否发布
