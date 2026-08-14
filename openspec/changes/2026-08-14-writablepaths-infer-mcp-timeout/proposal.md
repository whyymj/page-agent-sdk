# Proposal: writablePaths 装配期推断 + MCP callTool 超时闸

## 动机

两个独立小项,同批一个 minor:

### ① writablePaths 可选化(装配期 schema 推断)

`createHtmlSubagent({ writablePaths })` 目前**必填**,不传直接 throw。集成门槛痛点:
- 集成方必须理解「writablePaths 指什么」(组件数组的 data 路径,如 `['components']`),写错(如 `component.code`/`components.0`)则框架扫描区落空,静默失败(虽有 codeField 命中校验 warn 兜底,但那是运行后才发现)
- 绝大多数场景 schema 就在旁边(`data: { schema, bind }`),路径信息**静态可推断**——装配期已有同源先例:`schemaHasCodeField`(降级编排注入判定)已经扫 schema 找 code 字段,只是没把「所在路径」返回
- 与项目「开箱即用优先」原则一致(最小配置只 container+llm)

### ② MCP callTool 超时闸

`src/core/mcp/client.ts` 现状:握手有 15s 超时闸(P1-2),但 **`callTool` 无界**——`toLangChainTool` 里裸 `await client.callTool(...)`,server 收到请求后挂起(慢查询/死锁/网络半开)则该工具调用永挂,拖死 ReAct 轮。这是「挂起有界收口三契约」(2.39.0)的漏网项:同文件握手已修,callTool 漏了。

## 方案概要

### ① 推断规则(纯函数,放 schemaUtils)

新增 `inferWritablePaths(schema, codeField = 'code'): string[]`:
- 遍历顶层 shape,`z.array(elem)` 且 `elementHasCodeField(elem, codeField)`(复用现有函数,泛化 codeField 参数)→ 收集该顶层 key
- **只扫顶层**(与 schemaHasCodeField 同深度):嵌套容器(如 `sections[].children[]`)不推断——宁可推断不出也不猜错路径;推断为空 → 保留现有必填报错
- 显式传入优先:传了 `writablePaths` 完全跳过推断

`createHtmlSubagent` 侧:
- `writablePaths` 改可选;未传时**延迟推断**——工厂调用时 data/schema 尚未传给 createChatSdk,故推断放装配期(createChatSdk 识别 `_codeAsset.writablePaths` 为空时调 `inferWritablePaths(finalDataConfig.schema, codeField)`)
- 推断结果 console.info 留痕(`[page-agent-sdk][createHtmlSubagent] 未传 writablePaths,已从 schema 推断: ['components']`);推断不出(开放 schema `z.any()`/嵌套容器)→ console.warn 提示显式传参 + 保留 throw

### ② callTool 超时

- `McpServerConfig` 加 `callTimeoutMs?: number`(默认 60s,单独于握手 `timeoutMs` 15s——工具执行正当慢于握手)
- `toLangChainTool` 的 `client.callTool` 包 `Promise.race` 超时,超时抛错(recoverable,ReAct 回灌自纠:LLM 看到超时错误可换工具/告知用户),不重试
- 超时不主动 abort 连接(server 可能仍在执行,连接复用;仅本次调用作废)

## 影响面

| 项 | 变更 |
|---|---|
| `src/core/tools/schemaUtils.ts` | `elementHasCodeField` 泛化 codeField + 新增 `inferWritablePaths` 导出 |
| `src/core/sdk/htmlSubagent.ts` | `writablePaths` 可选;`_codeAsset.writablePaths` 允许空(装配期回填) |
| `src/core/sdk/createChatSdk.ts` | 装配期:codeAsset config 的空 writablePaths → 推断回填(注入 middleware / pgIdPaths / largeTextPaths 前) |
| `src/core/mcp/client.ts` | `callTimeoutMs` + callTool race 超时 |
| `types/index.d.ts` | CreateHtmlSubagentOptions.writablePaths 可选 + McpServerConfig.callTimeoutMs |

## 非目标

- 不做嵌套路径推断(sections[].children 只报 warn 不猜)
- 不做 bind 运行时扫描兜底(纯 schema 静态推断;bind 空数组时无信息量)
- 不给 callTool 加重试(超时即回灌,LLM 自纠)
- 不动 presets.pageBuilder 默认装 agent(等推断落地后再评估,另行立项)
