# Specification Delta: page-agent-core

> change `team-review-hardening`。5 个 Requirement(①写能力标注单一真相源 / ②__pgId 补齐全写路径 / ③MCP 保留字保护 / ④沙箱扫描与脱敏加固 / ⑤行为正确性批)。**minor**(向后兼容;MCP 恶意名从「静默覆盖」变「拒绝注入」属安全收紧)。

## Requirement: 写能力标注单一真相源

凡会修改主数据(bind)的工具必须带机器可判定的写能力标注,授权面/锁面/自授过滤统一消费标注,禁止散落硬编码清单:

- **标注定义**:工具定义点声明(数据槽写工具恒为写;`eval_script` 仅 `mode:'transform'` 为写;`restore_data` / `resource_update` / `resource_delete` 为写)
- **子 agent 授权面**:装配期剥离与 spawn 自授过滤按标注判定 → 标注为写的工具不经 writablePaths 授权不可达子 agent
- **组件锁主写守卫**:按标注判定(eval_script 判 transform;restore_data 锁内拒)→ 委派在途时所有写路径对锁组件子树回灌 `COMPONENT_LOCKED`
- **可测约束**:① 标注完整性(新增数据写工具自动进三处消费,漏标即断言失败)② spawn 自授 eval_script 被剥离 ③ 锁内 eval_script(transform)/restore_data 被拦,非 transform 的 eval_script 放行

## Requirement: __pgId 补齐覆盖全部写路径

codeAsset 场景(`__pgId` 映射生效)下,任何写路径成功落地后组件的 `__pgId` 必须保留/补齐,映射键不可丢:

- **收敛点**:补齐逻辑在 `commitSetToBind` / `applyPatchesToBind` 成功路径统一执行(与 SCHEMA_STRIP 检查同层),`set_data` / `edit_data` / `write` / `eval_script(transform)` / `draft_commit` 全覆盖
- **语义**:整体替换未带 `__pgId` 的组件数组元素 → 按 before 快照回填原 `__pgId`;新增元素 → 框架生成注入
- **可测约束**:四条写路径各 1 断言(set_data 整体替换后 __pgId 保留;新增组件有 __pgId)

## Requirement: MCP 工具名保留字保护

远程 MCP server 的工具不可覆盖内置/用户工具(dedupeTools 后注册覆盖语义仅留给 user 组):

- **注入前检查**:MCP 工具名与已注册非 mcp 来源工具名冲突 → 拒绝注入该工具 + console.warn 留痕;其余工具照常注入(单工具失败不拖累整 server)
- **可测约束**:mock server 返回 `write` 同名工具 → 不注入 + agent 内置 write 行为不变 + warn 留痕

## Requirement: 沙箱扫描与脱敏加固

- **静态扫描**:eval_script/skill exec 沙箱静态扫描补 `constructor` / `getPrototypeOf` / `prototype` 模式(封 `"".constructor.constructor()` 原型链取 Function 逃逸)
- **嵌套脱敏**:`inspect_env` 的 `safeSerialize` 递归序列化时,嵌套命中敏感 key 正则(token/secret/key/auth/cred/csrf/session)的值替换 `'[REDACTED]'`
- **可测约束**:① constructor 链脚本被拒 ② `inspect_env({key:'appConfig'})` 值内嵌 apiKey 不外泄

## Requirement: 行为正确性批

- **wrapToolCall 异常契约**:中间件洋葱抛普通 Error → 收敛为 recoverable 错误结果回灌 LLM 自纠(不 fatal 整轮;显式 AgentError severity 尊重)
- **wrap-up 摘要保留**:收口轮只移除首条 system,中部压缩摘要 SystemMessage 保留送达
- **streamStallMs:0 语义**:显式 0 = 关闭启动闸与停滞看门狗(不回退默认 90s)
- **vfs 超池显式报错**:单文件内容超所属池上限 → 写入前返回结构化错误(不静默淘汰后报 NOT_FOUND)
- **deleteSession 竞态**:删除会话先取消该 session 的 debounce pending(不复活幽灵会话)
- **mount 纯度**:mount(override) 不改写集成方传入的 options 对象
- **可测约束**:每项 1 正常 + 1 边界断言(详见 tasks 阶段 E)
