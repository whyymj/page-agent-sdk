# Design: writablepaths-infer-mcp-timeout

## ① writablePaths 推断链路

### 数据流

```
createHtmlSubagent({ codeField? })        未传 writablePaths
  └─ _codeAsset.writablePaths = []        (不再 throw;标记待推断)
createChatSdk 装配期
  ├─ codeAssetConfigs 提取(现有)
  ├─ 对每个 writablePaths 为空的 config:
  │    inferWritablePaths(finalDataConfig.schema, codeField)
  │    ├─ 命中 → 回填 config.writablePaths + console.info
  │    └─ 未命中 → console.warn(提示显式传参)+ 保留 throw(宁失败不静默)
  └─ 后续 pgIdPaths / largeTextPaths / codeAssetMiddleware 全用回填后值(现有时序:subagentsForAssemble 在 line ~1150,pgIdPaths 在 ~878 —— 需把推断提前到 pgIdPaths 计算之前)
```

### 时序关键点

`codeAssetPgIdPaths`/`codeAssetLargeTextPaths` 在 `subagentsForAssemble`(装 middleware)**之前**计算,两者都从 `codeAssetConfigs` 读 `writablePaths`。推断必须插在 `codeAssetConfigs` 提取之后、`codeAssetPgIdPaths` 计算之前——即对 `codeAssetConfigs` 内的 config **就地回填**(mutate 或重建数组),两个下游自然拿到回填值。

### 推断函数契约(schemaUtils.ts)

```ts
export function inferWritablePaths(schema: any, codeField = 'code'): string[]
// 顶层 shape 遍历:z.array(elem) 且 elementHasCodeField(elem, codeField) → [key]
// 复用 elementHasCodeField(泛化:字段名参数化,现硬编码 'code')
// discriminatedUnion/union 数组元素:任一 option 含 codeField string 即命中(同现有降级判定语义)
```

与 `schemaHasCodeField` 的关系:后者是布尔判定(只需「有没有」),前者要路径(「在哪」);共享 `elementHasCodeField` 底座,不合并导出(调用方语义不同)。

### 失败模式

| 场景 | 行为 |
|---|---|
| schema 顶层无 code 数组 | warn + throw(集成方显式传参) |
| 开放 schema z.any()/z.record() | 同上(静态扫不到是已知边界,同 schemaHasCodeField) |
| 嵌套容器 sections[].children[] | 同上(warn 文案点名「嵌套容器路径不支持推断,请显式传 writablePaths」) |
| 多个数组都命中 | 全部返回(多 writablePaths 本就合法) |

## ② MCP callTool 超时

```ts
// McpServerConfig
timeoutMs?: number        // 握手(现有,默认 15s)
callTimeoutMs?: number    // 单次工具调用(新,默认 60s)

// toLangChainTool 内
const result = await Promise.race([
  client.callTool({ name: t.name, arguments: args }),
  new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`MCP 工具 ${t.name} 调用超时(${ms}ms)`)), ms)
  }),
])
```

- 超时错误经 dataOps 同款错误路径回灌(recoverable:LLM 收到 ToolMessage 错误文本自纠——换工具/告知用户),不重试(超时意味着 server 侧慢,重试大概率再超时)
- 不 abort 连接:MCP StreamableHTTP 单连接复用,abort 整条连接殃及后续调用;仅本次 race 作废(server 侧若最终完成,结果丢弃)
- timer 必须 finally clearTimeout(握手闸同款写法)

## 测试设计

- selftest(schemaUtils 层):inferWritablePaths 正常命中 / union 命中 / z.any 不命中 / 嵌套不命中 / codeField 自定义(props.html_code 场景退化:顶层字段名匹配,不含点路径——**点路径 codeField 推断不支持**,文档标注)
- selftest(mcp client 层):callTool 超时抛错(用 stub client 模拟永挂 promise + callTimeoutMs: 10)
- e2e:capability-packs 增场景——createHtmlSubagent 不传 writablePaths + schema 带 components 数组 → mount 成功 + inspect 委派工具存在;不传 + 无 code schema → throw 含提示文案
- e2e(mcp):tests/e2e 现有 mcp stub 路径补一条 callTimeoutMs 超时断言(若 stub server 不可控挂起,降级为单元级 selftest 覆盖,e2e 只验配置透传不炸)

## 决策记录

- **推断放装配期不在工厂**:工厂调用时 schema 不可得(data 后传),延迟到 createChatSdk 与 checkout/commit 钩子同款哲学
- **宁 throw 不猜嵌套**:嵌套路径猜错的代价比「要求显式传参」高(错路径 = 框架扫描区全空)
- **60s 而非 30s**:RAG 检索/大计算类 MCP 工具正当耗时可达数十秒,30s 误杀;握手 15s 不变(握手本应 <1s)
