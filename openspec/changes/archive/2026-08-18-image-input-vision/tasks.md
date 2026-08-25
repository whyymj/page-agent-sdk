# Tasks(Phase 1 已实施 ✅;Phase 2 部分被 images.upload/describe 集成方钩子吸收)

## Phase 1:输入侧 + 多模态直连 ✅

- [x] `compressImage` 纯函数(canvas:长边 ≤1568 / jpeg q0.85 / 透明保 png / >20MB 拒)+ selftest
- [x] `AgentMessage.images?: AgentImage[]` 类型 + `send(text, { images })` API + types/index.d.ts 同步
- [x] ChatInput:📎 选择 + 拖拽 + 粘贴三入口;缩略图 chip(可删,≤4 张/轮);`dialog.icons.attachImage` 可配键;i18n 新键 ~8 个(中英)
- [x] MessageRow:user 消息缩略图行渲染
- [x] modelCaps 增 `vision` 标志(表驱动 + `llm.vision` 覆盖 + setLlm 重解析;未命中保守 false)+ selftest 表驱动断言
- [x] constructLlm 双协议 content parts 组装(openai image_url / anthropic image block;子 agent anthropic 同步)+ mock 拦截 e2e 断言形态
- [x] 持久化:快照存 `{id, thumb≤8KB, vfsRef}`,原图入 vfs `userImages/*`(LRU + extractVfsRefs 引用保护);恢复降级占位;e2e 快照往返
- [x] browser:三入口交互 + chip 删除 + 大图拒绝

## Phase 2:vision 旁路(文本主模型识图)—— 部分吸收,余下 deferred

> 实施变化:原规划「SDK 内置 vision 中间件自带识图 LLM」改为**集成方钩子** `images: { upload?, describe?, describeTimeoutMs? }`(顶层配置组):
> 识图能力归属集成方(自有 vision API / 识图子 agent),SDK 只管转述注入时机 + 诚实降级。已实施项:
- [x] `images.describe` 钩子:非多模态主模型发送前逐图转述注入该轮 user 上下文(已转述不重复)+ e2e
- [x] 诚实闸三分支:多模态直发 / describe 转述 / 都没有 → send 拒绝 + 结构化错误(不静默丢图)+ e2e
- [x] describe 失败/超时(默认 15s)→ 占位描述 + observable `VISION_DESCRIBE_FAILED`,对话继续 + e2e
- [x] `images.upload` 钩子:压缩后原图经集成方 OSS 上传换 URL,content parts 用 URL 形态 + 持久化轻引用 + e2e
- [ ] ~~`harness/vision.ts` 内置中间件 / `vision` 配置组~~(被 images.describe 吸收,不再实施)
- [ ] ~~`describe_image` 工具 / `sdk.describeImage`~~(deferred:有真实需求再立项)
- [ ] ~~`sdk.usage.vision_tokens` 分离累计~~(deferred:转述经集成方 LLM,SDK 侧无 token 可计)
- [ ] 真 LLM:旁路三场景(贴截图问组件 / 贴稿还原 custom / OCR 问答;flash 量级视觉模型)
- [x] 文档:usage-guide 中英 vision 段 + README 能力行 + editor 集成指引(贴图改组件工作流)(3.46.0 补齐:usage-guide §6.17 中英 + README 中英 + doc 索引 + images-demo 示例)
- [ ] 真 LLM 旁路三场景 → 已登记 openspec/deferred.md(2026-08-24 归档时补登记)
