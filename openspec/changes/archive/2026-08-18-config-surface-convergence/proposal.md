# Proposal: config-surface-convergence(配置面激进收敛)+ DebugDrawer 轮次分组

> 已实施:3.30.0(2026-08-18)+ 3.31.0(2026-08-18)两个 minor 发布。

## Why(用户诉求,2026-08-18)

editor_fangzhou 实测与集成反馈三连:

1. **`interceptors` 无人使用**:`data.interceptors` read/write/input/output 四钩子 + `send()` per-call interceptors,实际集成零使用;与乐观锁/schema 校验职责重叠(都是读写保护层)且语义易误用 —— 用户原话「一般不知道有啥作用」。
2. **三态系统冗余**:`toolMode`(advanced/simple/minimal)自 3.28 默认已改 advanced(集成事故教训:教了的工具必在池中 —— 提示词无条件教 `schema_data`,simple 档工具不在池 → 误调烧轮次);simple/minimal 降级形态与「教了的工具必在池中」原则自相矛盾。3.28 又加 `hintsMode` 解耦旋钮,配置面越来越复杂 —— 反馈「使用太复杂」。
3. **DebugDrawer 可用性**:多轮 ReAct 场景(实测 15+ 轮)扁平日志流交错难定位单轮边界;🗑️ 清空日志按钮无人接线点击无反应。

## What Changes

### 3.30.0 —— 移除公开 `hintsMode`(配置面 -1)

- usageHints 提示词档位改**内部自动跟随 toolMode**,行为不变;3.28 的「systemPrompt 含 simple 模式/未暴露措辞自动降级 simple + warn」兼容机制保留(内部化),「勿调用」单独出现不触发(3.29 收窄不变)。

### 3.31.0 —— 整体移除 `interceptors` 与 `toolMode`(工具面恒全暴露)

1. **移除 `interceptors` 全功能**:四钩子 + send per-call 形态;字段从 `ChatSdkOptions`/`DataOpsOptions`/send options 与两份 d.ts 删除,运行时多余键忽略不崩。
2. **移除 `toolMode`**:三态删除 —— `createDataOps` 直出 14 工具无呈现模式筛选;usageHints 提示词档位系统删除(无 simple/minimal 分支),提示词只随能力开关变化;3.30 的自动降级内部机制随档位系统一并删除(死代码)。
3. **移除的导出**:`filterByToolMode` 函数、`DataInterceptors` 接口、`ToolMode` 类型(主入口 + headless 子路径 + 两份 d.ts 同步)。
4. **签名收口**:`createUsageHintsMiddleware(caps, hasDataOps, budget?)`(废弃第 4 参 `_hasResources` 删除,budget 升第 3 参);`buildDataPrompt(data, schemaHint?)` 收 2 参;`SchemaHintOptions` 删 `toolMode`(缓存键简化为 `maxKeys|maxChars`);`unfocusGuidance` 选项保留(createChatSdk 不再传,默认 `'tool'`;子 agent `'report-parent'` 与 `capabilities.focus:false` 的 `'ask-user'` 仍用)。
5. **read/write 优先纪律改由 systemPrompt 承载**(不再靠工具池裁剪):editor_fangzhou prompt 同步改「工具纪律(数据工具恒全暴露,修改统一 read/write)」。

### 3.31.0 —— DebugDrawer 日志轮次分组

- logs tab 重构:扁平日志流 → 按轮次分组的可折叠 node;头部只展示轮次 + 摘要(时间区间/耗时、🔧 工具数、Σ token、❌ 错误数),点击展开全部细节卡;默认仅最新组展开(新轮到来旧轮自动收起;用户显式切换覆盖默认)。
- **运行边界 = 主 agent context 日志**(每 send 一条)→ epoch 隔离,跨 send 同轮号不合并;子 agent 转发日志归属主 agent 当时所在轮;无 round 的轮内日志归当前轮;wrap_up 兜底收口单独成组(「收尾」)。
- 条目 UI 状态(展开/差分/原文)按日志对象身份 uid 锚定(WeakMap),filter 切换/分组重排不串状态;顺带清理恒不可达的 tool_result 重复渲染死分支。

### 3.31.0 —— Fixed:清空日志按钮

- 问题:`clear` 事件发出后无人接线(ChatDialog 未透传、mountChatDialog 未实现)。
- 修复:ChatDialog 增 `clearDebugLogs` prop + `@clear` 透传;mountChatDialog 实现清「源」`sdk.debugLogs`(shallowRef 置空,computed slice 传播);customize-demo 自接示例同步。

### Non-goals

- 不动 `capabilities` 能力开关(保留的收敛手段)与 `approval`/`permissions` 授权面。
- interceptors 移除后不提供替代钩子 —— 宿主观测走 `onEvent`/`sdk.hook`,动态提示走 `augmentSystem`,写保护已有乐观锁 + schema + focus 三层。
- 清空日志只清 `sdk.debugLogs`,不清 messages/会话。

## Impact

- **breaking(TS 编译)**:传 `interceptors`/`toolMode`/`hintsMode` 编译报错;运行时多余键忽略不崩(无降级形态,工具面恒 14 工具全暴露)。
- **迁移**:曾传 `toolMode:'advanced'` 删键即可零行为变化;曾依赖 simple/minimal 收敛的集成方改由 systemPrompt 约束(editor_fangzhou 已同步适配实测通过)。
- 测试计数:selftest 2531 → **2502**(−29)/ e2e 832 → **814**(−18)/ browser **101**(+3:轮次分组 ×2 + 清空 ×1)。
- **editor_fangzhou 真 LLM e2e 实证**(3.31.0 + deepseek-v4-flash,「设计一个活动页,主题世界杯」):15 轮 ReAct + 准备/收尾共 17 个轮次分组(meta 时间区间/耗时渲染正确);两次 `request_human_confirmation` 按 page-tools skill 规则发起(删除前 + 批量添加前);nodeInfo 1 → 5 节点(4 富文本组件搭建成功);MCP 知识库不可达降级不阻塞、`rag_component_docs` 失败回灌自纠 —— 工具面恒全暴露下 agent 纪律正常。
