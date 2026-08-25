# Proposal: model-offline-guidance（模型下线/不可用的友好引导）

> 状态：**已实施（2026-08-24）**，随下个 minor 发布。复审记录：2026-08-23 团队复审（撤回「setLlm fatal 快失败」〔构造期零网络、物理不可探测〕、Why 段现状纠正、检测特征收紧、200+错误体盲区明示）。优先级 P2（SDK）。目标仓库：zhuanti-agent。
> 驱动：本会话内 deepseek-v4-flash 在 modelverse 网关「model is offline」400 复发两次。主路径已 fatal 浮出（不静默）但**错误文本不可操作**，且 automation 重试/子 agent 重委派两条旁路会反复撞墙。需要把「模型面不可用」从通用错误里识别出来，给出可操作引导。

## Why（现状核实，复审纠正）

- 网关/厂商下线模型时返回 4xx（`Invalid param: model [x] is offline` / `not support for model`），4xx 不重试（retry 纪律），主路径以 fatal 事件 + throw 收口（send catch → emit error → UI 显错），**已不静默，但错误文本不可操作**。
- 真实的反复撞墙路径：①automation+checkpoint 开启时 AUTO_RECOVER_RETRY 默认再撞一次；②子 agent 委派失败以 error result 回灌主 LLM，主 LLM 可能反复重委派，每次烧一整轮子 agent。可操作引导能掐断这两条。

## What Changes

1. **错误识别**：新增纯检测函数 `isModelUnavailableError`（errors.ts，对齐 `isContextLengthError` 三层识别链先例：langchain 码 → error.code → status+message），特征收紧为 `is offline` / `not support for model` / error.code===`model_not_found`（**裸 `does not exist` 不采用**，会误伤工具/路径错误）；打 `code:'MODEL_UNAVAILABLE'`（纯追加，全仓无冲突）。检测仅消费于**模型调用失败 catch 点**（coreModelCall 启动/迭代 catch、send/batch invoke catch、子 agent error result 装饰），不进工具错误归一化路径（asAgentError 消费点含工具 catch，放进去会误伤）。
2. **友好引导**：命中时在错误 message 尾附引导（「该模型在当前网关不可用：① 换模型名后 setLlm ② 检查网关模型面开放列表」）；**主路径维持现有 fatal 浮出语义不变**，子 agent error result 仅装饰 message。setLlm 构造期零网络调用，**不做离线探测**（探测=新副作用+费用+破坏 void 同步契约，排除）。
3. **明示盲区**：网关回 200 + 错误 JSON 体非 SSE 形态（body 不捕获，归 EmptyLLMResponseError 自动重试后抛错）不在本 change 覆盖面，登记 deferred。
4. **留痕**：debugLogs `stage:'model_unavailable'` 纯追加；exportDiagnostics 聚合自动带走；事件层引导文案并入现有 `message` 字段（事件无独立 hint 字段，不扩事件形状）。

## 红线

- 不改变「4xx 不重试、先排除 abort 再判 status」纪律；`isRetryable`/`setLlm` 零改动；severity 一律维持各 catch 点现状（fatal 的仍 fatal、子 agent error result 仍回灌）。
- 不误伤 PATH_DENIED/工具错误（检测不进工具错误 catch 路径）。
- 引导文案不引导集成方显式声明任何新配置。

## 验收门禁

- selftest：检测纯函数三形态命中 + 工具错误消息（「path does not exist」类）不误判。
- e2e：stub 400 offline → error 事件 code=MODEL_UNAVAILABLE 且 message 含引导；正常 400（参数错）不误标。
- 文档：usage-guide 坑位补「模型下线」+ 200+错误体盲区说明。
