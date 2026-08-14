# Tasks: writablepaths-infer-mcp-timeout

> 实施任务清单。`/opsx:apply` 按此执行。**minor**(向后兼容:两参数均可选化,无 breaking)。A schemaUtils 推断 → B htmlSubagent/createChatSdk 可选化 → C MCP callTool 超时 → D 测试 → E 文档。

## 阶段 A:schemaUtils 推断纯函数

- [x] A1 `elementHasCodeField` 泛化 codeField 参数(现硬编码 'code';union/discriminatedUnion 递归语义不变)
- [x] A2 新增导出 `inferWritablePaths(schema, codeField = 'code'): string[]`(顶层 shape 扫 z.array + elementHasCodeField;命中收集 key;z.any/嵌套/无 code 返 [])
- [x] A3 `schemaHasCodeField` 内部改用泛化后的 elementHasCodeField(行为零变化)

## 阶段 B:writablePaths 可选化

- [x] B1 `htmlSubagent.ts`:CreateHtmlSubagentOptions.writablePaths 改可选;去掉工厂层 throw(空数组透传 `_codeAsset`);types/index.d.ts 同步
- [x] B2 `createChatSdk.ts` 装配期:codeAssetConfigs 提取后、pgIdPaths 计算前,对空 writablePaths 的 config 就地回填 `inferWritablePaths(finalDataConfig.schema, codeField)`;命中 console.info / 未命中 console.warn + throw(文案含用法与嵌套/开放 schema 边界)
- [x] B3 核对下游全用回填值:pgIdPaths / largeTextPaths / subagentsForAssemble(codeAssetMiddleware)三处读同一 config 对象

## 阶段 C:MCP callTool 超时

- [x] C1 `McpServerConfig` 加 `callTimeoutMs?: number`(默认 60_000,导出 DEFAULT_MCP_CALL_TIMEOUT_MS);types/index.d.ts 同步
- [x] C2 `toLangChainTool` 的 callTool 包 Promise.race 超时(默认值兜底;finally clearTimeout;超时不 close 连接)

## 阶段 D:测试(同 commit)

- [x] D1 selftest schemaUtils:inferWritablePaths 正常命中 / union 命中 / z.any 空返 / 嵌套空返 / 多数组全返 / 显式 codeField
- [x] D2 selftest mcp:stub client 永挂 callTool + callTimeoutMs:10 → 10ms 级抛超时错;超时内完成不受影响
- [x] D3 e2e capability-packs:不传 writablePaths + code schema → mount 成功 + use_html 存在;不传 + 无 code schema → throw 含提示
- [x] D4 计数同步(CLAUDE.md / README 中英 / doc README)+ 更新本文件勾选

## 阶段 E:文档

- [x] E1 README.md + README.zh-CN.md:createHtmlSubagent 用法示例去 writablePaths 必填标注(标可选·自动推断);MCP 配置表加 callTimeoutMs
- [x] E2 doc/usage-guide.md + .en:HTML 能力包段补推断规则与边界(嵌套/开放 schema/点路径 codeField 需显式传);MCP 段补 callTimeoutMs
- [x] E3 CLAUDE.md:能力包段与 MCP 段各补一句;测试计数
- [x] E4 CHANGELOG.md [Unreleased]

## 阶段 F:发布(minor,用户确认后)

- [x] F1 门禁全绿 → bump → commit → 询问用户是否发布(已随 3.6.0 发布)
