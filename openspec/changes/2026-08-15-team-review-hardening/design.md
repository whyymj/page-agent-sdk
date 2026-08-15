# Design: team-review-hardening

## 1. 写能力标注(A 段)

**为什么标注而非继续维护清单**:三处清单(SUB_WRITE_TOOLS / WRITE_TOOLS / focus 内部集)已两次各自漂移(focus 修过、componentLock 没跟),任何清单都注定漏新工具。标注放**工具定义点**(dataOps 创建处),新增写工具时定义处即声明,三处消费自动跟随。

**实现**:
- dataOps 工厂返回的工具对象加可选字段 `writeCapable?: boolean | ((args) => boolean)` —— 函数形态适配 `eval_script` 的条件写(transform 模式)
- 子 agent 装配剥离(`subagent.ts` SUB_WRITE_TOOLS 消费点)与 spawn 自授过滤(subagent.ts:508 附近)改 `(t) => t.writeCapable === true || (typeof t.writeCapable === 'function' && t.writeCapable(args))`;自授过滤时 args 未知的保守取「函数形态按可能为写」剥离
- componentLock `createComponentWriteGuardMiddleware` 守卫改同判定
- 原清单保留为兼容注释或删除(倾向删除,防再次漂移)
- selftest 完整性断言:遍历 dataOps 全部工具,断言「落在写语义集(文档枚举)的工具都有标注」—— 新工具漏标即红

## 2. __pgId 补齐收敛(B 段)

现状 `supplementPgId` 只在 writeSlot 三意图调用。收敛方案:`internalAfterWrite` 回调经 dataOps controller 已有通道注入 `commitSetToBind` / `applyPatchesToBind` 成功路径末尾(与 `onWrite` 脏标记回调同模式,2.21 已有先例)。无 codeAsset 场景回调为 no-op(零开销)。

## 3. MCP 保留字(C 段)

注入点在 `createChatSdk` 的 `rebuildExtraTools` / mcp 后台注入路径:工具 push 前查现有 `allTools`(非 mcp 来源)重名 → skip + warn。**不做前缀化**(改工具名会破 prompt 引导与既有集成,留 deferred 评估)。

## 4. 沙箱(D 段)

- 扫描模式数组追加 `/constructor\s*\(/`、`getPrototypeOf`、`\.prototype\b` —— 保守模式,误伤率低(合法 transform 脚本罕见这些标记)
- safeSerialize 递归处对 object key 命中 ENV_SENSITIVE_KEY_RE → 值替换 `'[REDACTED]'`(只在 envTool 消费路径加,不影响 vfs/inspect 等其他 safeSerialize 消费者 —— 该函数若被共享,加 opts 开关 `{ redactSensitive?: RegExp }`)

## 5. 行为批(E 段)逐项切口

| 项 | 文件 | 切口 |
|---|---|---|
| E1 wrapToolCall 异常 | createAgent.ts stream() toolHandler 洋葱外 | try/catch → asAgentError(err,'recoverable') → 错误 result |
| E2 wrap-up 摘要 | createAgent.ts:930 | `filter` 改只去 index 0 的 system |
| E3 stallMs 0 | createAgent.ts:538 | `stallMs > 0 ? stallMs : 0`,0 时 race 传 Infinity |
| E4 vfs 超池 | vfs.ts enforceLimit 前 | 写前预检 `encodeLength > poolMax` → 错误(附「拆分/池上限」提示) |
| E5 deleteSession | storage.ts:579 | 先遍历 pending/timers 清 sessionPrefix 命中项 |
| E6 mount 纯度 | createChatSdk.ts:2388 | 局部变量 |

## 6. 风险与回滚

- A 段改授权判定,保守策略:函数形态标注(条件写)在「无法确定 args」场景一律按写处理(宁误拦不漏放)
- C 段安全收紧,极小概率破「依赖 MCP 同名工具覆盖内置」的集成(本就是危险用法)
- 全部改动向后兼容,单项独立可回滚
