# Spec: writablepaths-infer-mcp-timeout

## ADDED Requirements

### Requirement: writablePaths 装配期推断

`createHtmlSubagent` 的 `writablePaths` 参数改为可选。未传时,`createChatSdk` 装配期从 `data.schema` 顶层扫描「数组元素含 codeField 字符串字段」的路径自动推断并回填;显式传入时完全跳过推断。

#### Scenario: 未传 + schema 可推断 → 自动回填

- **WHEN** `createHtmlSubagent({ })`(无 writablePaths)+ `data.schema` 顶层含 `components: z.array(<元素含 code string>)`
- **THEN** mount 成功,子 agent 获得该路径写权限,console.info 输出推断结果

#### Scenario: 未传 + 推断不出 → 报错留痕

- **WHEN** 未传 writablePaths 且 schema 静态扫描无命中(开放 schema / 嵌套容器 / 无 code 字段)
- **THEN** console.warn 提示显式传参,装配 throw(错误信息含 writablePaths 用法说明)

#### Scenario: 显式传入优先

- **WHEN** 传入 `writablePaths: ['blocks']` 且 schema 另有可推断路径
- **THEN** 用 `['blocks']`,不推断、不 warn

#### Scenario: 自定义 codeField 沿用

- **WHEN** `codeField: 'props.html_code'`(点路径)且未传 writablePaths
- **THEN** 推断只按顶层 codeField 名匹配;点路径不支持推断,warn 提示显式传参(文档标注边界)

### Requirement: MCP callTool 超时闸

MCP 工具单次调用受 `callTimeoutMs`(默认 60s)约束,超时抛错回灌 Agent 自纠;不影响连接复用。

#### Scenario: 工具调用超时

- **WHEN** MCP server 对某工具调用不响应超过 callTimeoutMs
- **THEN** 该次工具调用返回超时错误(recoverable),ReAct 回灌;连接不断,后续工具调用正常

#### Scenario: 正常调用不受影响

- **WHEN** 工具调用在超时内完成
- **THEN** 行为与现状一致,无额外开销(除一个 clearTimeout)
