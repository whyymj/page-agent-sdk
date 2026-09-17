# Tasks:take-screenshot(截图工具族)

> 打勾标准:任务完成 = 代码/文档落地 + 对应测试绿 + 计数同步。Phase 1-2 可合并为首批 commit(工具+通道),Phase 3 为观察面与演示,Phase 4 收尾。

## Phase 1:S1 工具本体(渲染/压缩/vfs 收口)

- [x] 1. 引入 html-to-image 依赖(package.json 首开 dependencies 字段;确认版本锁定与 license MIT);确认 4 份 lib config 零改动自动打包
- [x] 2. `src/core/tools/screenshot.ts`:纯函数域 —— `resolveScreenshotTarget(doc, args)`(selector/fullPage/视口三模式路由 + 高度上限守卫 >32768px 拒)/ `compressScreenshot(dataUri)`(复用 imageInput canvas 压缩闸);`createScreenshotTool(deps: { render, getVision, describe, stow })` 工厂(渲染可注入,selftest fake 位)
- [x] 3. 工具体:node 守卫(先例 domTool.ts:102)/ try-catch 渲染失败降级文案(CSP/跨域图提示 + selector 缩小建议)/ 原图 stow vfs userImages 池 / ToolMessage 返回纯文本元数据(模式/尺寸/字节/vfsRef,base64 不进 content)
- [x] 4. selftest 新模块(sec-127):fake render 注入测三模式路由/压缩闸数值/stow 调用/降级文案/高度守卫

## Phase 2:S2 条件注入 + 分层图通道

- [x] 5. `createChatSdk.ts` 装配:注入条件 `caps.domInspect && (modelCaps.vision || images.describe)` 判定 + 不满足 warn 一次(verify 先例 :822-833 形态);工具进 domToolsForPool 两条路径(skills 开进 dom-inspect skill 工厂 / 关直进池);顶层 `screenshot?: { renderer? }` 配置组(options.ts + 双 d.ts)
- [x] 6. vision 图通道:工具执行后合成 HumanMessage 追加机制 —— createAgent 循环内工具结果带图标记 → parts 组装(复用 buildImageContentParts + imageContentFormat);ToolExecResult 不扩宽(合成消息由 sdk 层工具经 side-channel/包装注入,实现形态勘察定)
- [x] 7. 非 vision 通道:工具内 describe 转述(imagePipeline 闭包注入),文本回灌 ToolMessage;setLlm 降级运行时诚实拒绝(IMAGE_UNSUPPORTED_MODEL 文案族)
- [x] 8. usageHints domInspect 行条件追加截图引导(勿教不存在的工具);dom-inspect skill getContent 补 take_screenshot 用法段 + 排障套路更新
- [x] 9. selftest:条件注入八格判定矩阵;e2e 新模块 screenshot.mjs:① vision → 合成 HumanMessage parts 双协议形态 ② describe → 纯文本转述图不直发 ③ 条件不满足 → 工具不在池(inspect 反射)+ warn ④ node 守卫

## Phase 3:S3 UI 观察面 + demo 演示

- [x] 10. StreamEvent `tool_result` 增可选 `image?: { dataUri, vfsRef? }`(事件形状加法;双 d.ts + types-alignment 同步)
- [x] 11. MessageSteps 步骤行截图缩略图(复用 msg-image 样式点击放大;thumb 形态非原图;i18n alt 中英)
- [x] 12. docs-demo:截图 quickAction(「截图看看配置表格」)+ systemPrompt 提示;complex-demo 注释位补「截图自检」引导(第二演示位)
- [x] 13. browser spec:docs-demo 截图真渲染用例(canvas 真跑;断言 tool_result 事件 image 字段 + MessageSteps 缩略图 + 请求体 parts 形态;images.spec realPng 先例)

## Phase 4:收尾(门禁/文档/计数)

- [x] 14. size 双闸重校(size-check.mjs 六条 + tests/e2e/headless-subpath.mjs:106,+~47K/产物;CHANGELOG「有意增长」留档,designSkill 先例 f6999be 同款)
- [x] 15. 文档四语侧:usage-guide 中英补节(§6.20 扩段或独立小节)、README 中英(特性表/options 清单/徽章计数)、doc README 索引
- [x] 16. CHANGELOG 版本条目(minor);CLAUDE.md 计数;check-test-counts 一致;公共面纪律自查(screenshot 配置组/tool_result.image/事件类型 = 双侧 d.ts 同步;renderer 钩子导出与否定级核对)
- [x] 17. 全量门禁:`build && test && test:e2e && test:browser && test:exports && test:types 族 && test:size && check-test-counts && npm pack --dry-run`;发布前询问用户

> **实施注记(2026-09-17)**:Phase 1+2 合一 commit(14aa815),Phase 3 = 1682730,Phase 4 = 本批收尾。
> 偏差留痕:① 修法勘察发现的 `__pgSubagentCall` 并非子栈标记(subagents wrapToolCall 对主循环全工具注入)—— isSubagent 维度移除,子 agent 截图回流主上下文;② JS 六产物阈内未重校(余量吸收 +21~26KB),仅 CSS 85→87.5KB;③ 「合成消息合并」语义 = 同轮并行截图合一条,顺序两轮各一条(e2e 断言修正);④ page-analysis skill 为实施期用户补充需求,并入 Phase 3。
