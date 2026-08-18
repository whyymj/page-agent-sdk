# Tasks(规划立项,未实施;Phase 1/2 可分批)

## Phase 1:输入侧 + 多模态直连

- [ ] `compressImage` 纯函数(canvas:长边 ≤1568 / jpeg q0.85 / 透明保 png / >20MB 拒)+ selftest
- [ ] `AgentMessage.images?: AgentImage[]` 类型 + `send(text, { images })` API + types/index.d.ts 同步
- [ ] ChatInput:📎 选择 + 拖拽 + 粘贴三入口;缩略图 chip(可删,≤4 张/轮);`dialog.icons.attachImage` 可配键;i18n 新键 ~8 个(中英)
- [ ] MessageRow:user 消息缩略图行渲染
- [ ] modelCaps 增 `vision` 标志(表驱动 + `llm.vision` 覆盖 + setLlm 重解析;未命中保守 false)+ selftest 表驱动断言
- [ ] constructLlm 双协议 content parts 组装(openai image_url / anthropic image block;子 agent anthropic 同步)+ mock 拦截 e2e 断言形态
- [ ] 持久化:快照存 `{id, thumb≤8KB, vfsRef}`,原图入 vfs `userImages/*`(LRU + extractVfsRefs 引用保护);恢复降级占位;e2e 快照往返
- [ ] browser:三入口交互 + chip 删除 + 大图拒绝

## Phase 2:vision 旁路(文本主模型识图)

- [ ] `harness/vision.ts` 中间件:beforeAgent 异步转述(fire-and-forget,占位先行)+ wrapModelCall 注入(不改原 messages);装载序 usageHints 后
- [ ] `vision: { llm, prompt?, mode?, maxImagesPerRound? }` 配置组 + 装配接线 + 未配时诚实报错(recoverable,引导配置)
- [ ] 默认转述模板四段(概述/OCR/布局视觉/与指令相关)+ `vision.prompt` 覆盖;同图 id 缓存;失败/15s 超时占位 + observable `VISION_DESCRIBE_FAILED`
- [ ] B2 `describe_image({ imageId, focus? })` 工具(mode:'tool' 或追加;结果走 offload)+ headless `sdk.describeImage` 命令式入口
- [ ] `sdk.usage.vision_tokens` 分离累计 + `inspect().vision` 反射 + DebugDrawer 小节(可选)
- [ ] e2e:stub visionLlm 转述注入断言 / 缓存命中(同图两轮一次调用)/ 诚实报错 / usage 分离
- [ ] 真 LLM:旁路三场景(贴截图问组件 / 贴稿还原 custom / OCR 问答;flash 量级视觉模型)
- [ ] 文档:usage-guide 中英 vision 段 + README 能力行 + editor 集成指引(贴图改组件工作流)
