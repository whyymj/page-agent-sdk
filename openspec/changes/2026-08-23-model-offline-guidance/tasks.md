# Tasks: model-offline-guidance

- [ ] 新增纯检测函数 `isModelUnavailableError`（errors.ts，对齐 isContextLengthError 三层识别链）：`is offline` / `not support for model` / error.code===`model_not_found`；仅消费于模型调用失败 catch 点（coreModelCall 启动/迭代 catch、send/batch invoke catch、子 agent error result 装饰），不触碰工具错误路径
- [ ] 命中 → `code:'MODEL_UNAVAILABLE'` + debugLogs `stage:'model_unavailable'` 留痕；message 尾附两条引导（换模型名/查网关模型面）；severity 维持各 catch 点现状；isRetryable/setLlm 零改动
- [ ] selftest：检测纯函数三形态命中 + 工具错误消息（「path does not exist」类）不误判
- [ ] e2e：stub 400 offline → error 事件 code=MODEL_UNAVAILABLE 且 message 含引导；正常 400（参数错）不误标
- [ ] 200+错误体非 SSE 盲区登记 openspec/deferred.md（带触发条件）；usage-guide 坑位「模型下线」+ CHANGELOG
- [ ] 门禁：npm test && build && test:e2e 全绿
