# Tasks: config-surface-convergence + DebugDrawer 轮次分组(已实施 ✅)

## 3.30.0 —— 移除 hintsMode ✅

- [x] 删 `ChatSdkOptions.hintsMode` 选项 + 两份 d.ts;usageHints 档位内部跟随 toolMode
- [x] 保留 3.28 自动降级兼容(simple 模式/未暴露 措辞降级 + warn;「勿调用」不触发)
- [x] warn 文案去掉「显式传 hintsMode」建议项
- [x] usage-guide 中英 / architecture 描述更新;e2e systemprompt 现有断言零改动全绿

## 3.31.0 —— 移除 interceptors ✅

- [x] 删 `data.interceptors` 四钩子 + send per-call interceptors(createDataOps / ChatSdkOptions / send options)
- [x] 删 `DataInterceptors` 接口 + 两份 d.ts;运行时多余键忽略不崩
- [x] custom-injection e2e 拦截器透传块移除(−18 断言的一部分)

## 3.31.0 —— 移除 toolMode(工具面恒全暴露)✅

- [x] 删三态:`createDataOps` 直出 14 工具,无呈现模式筛选
- [x] 删 usageHints 提示词档位系统(simple/minimal 分支)+ 3.30 自动降级内部机制(死代码)
- [x] 删导出 `filterByToolMode` / `ToolMode`(主 + headless + 两份 d.ts)
- [x] 签名收口:`createUsageHintsMiddleware(caps, hasDataOps, budget?)` / `buildDataPrompt(data, schemaHint?)` / `SchemaHintOptions` 删 toolMode
- [x] `unfocusGuidance` 保留(子 agent report-parent / focus:false ask-user),createChatSdk 不再传
- [x] editor_fangzhou 适配:`toolMode` 键移除,纪律改 systemPrompt 承载

## 3.31.0 —— DebugDrawer 轮次分组 ✅

- [x] logs tab 重构:扁平流 → 按轮次可折叠 node;头部轮次 + 摘要(时间区间/耗时/工具数/Σ token/错误数)
- [x] 默认仅最新组展开;新轮到来旧轮收起;用户显式切换覆盖默认
- [x] epoch 隔离(每 send 一条 context 日志);子 agent 转发归属主 agent 当时轮;无 round 归当前轮;wrap_up 成「收尾」组
- [x] 条目 UI 状态 WeakMap uid 锚定;清理 tool_result 重复渲染死分支

## 3.31.0 —— Fixed 清空日志按钮 ✅

- [x] ChatDialog 增 `clearDebugLogs` prop + `@clear` 透传
- [x] mountChatDialog 实现清源 `sdk.debugLogs`(shallowRef 置空)
- [x] customize-demo 自接示例同步

## 测试与发布 ✅

- [x] selftest 2531 → 2502;e2e 832 → 814;browser +3(轮次分组 ×2 / 清空 ×1)→ 101
- [x] CLAUDE.md / README 中英 计数与 toolMode/interceptors 描述同步
- [x] CHANGELOG 3.30.0 / 3.31.0 条目
- [x] 发布 3.30.0 → 3.31.0(squash 进 master 推双远程 + npm publish + esm.sh 验证)
- [x] **editor_fangzhou 真 LLM e2e 实测**(3.31.0 + deepseek-v4-flash):17 轮次分组 / 2 次人工确认 / nodeInfo 1→5 / MCP 降级 + 工具失败自纠 —— 通过 ✅
