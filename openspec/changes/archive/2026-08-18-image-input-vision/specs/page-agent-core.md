# Specification Delta: page-agent-core

> change `image-input-vision` 的增量 Requirement。2 条:图片输入通道 + 文本主模型识图旁路。minor 级(纯新增;未配 vision 且不传图 = 现状零变化)。

## Requirement: 图片输入通道(上传/拖拽/粘贴 → 消息模型 → 多模态直发)

用户必须能把图片送进对话(选择/拖拽/粘贴三种入口),图片经前端压缩后挂到 user 消息;主模型具备视觉能力时原图经 content parts 直发,消息持久化不因图片膨胀。

- **输入契约**:`ChatInput` 提供 📎 选择、拖拽、粘贴三入口;单轮 ≤4 张;压缩闸(长边 ≤1568px / jpeg q0.85 / 单图 base64 ≤500KB / 原图 >20MB 拒绝);`AgentMessage.images?: AgentImage[]`(`{id, dataUri, width, height, bytes}`)
- **API**:`send(text, { images })`;headless 同签名;`dialog.icons.attachImage` 图标可配(缺省内置 📎)
- **多模态直发**:`modelCaps.vision`(表驱动 + `llm.vision` 显式覆盖,未命中保守 false)为 true 时,openai 协议组装 `content: [{type:'image_url',image_url:{url:dataUri}},{type:'text'}]`,anthropic 协议组装 image block;子 agent(anthropic provider)同步
- **持久化约束**:会话快照只存 `{id, thumbDataUri(≤8KB), vfsRef}`;原图入 vfs `userImages/*` 池(LRU);恢复时 vfs 已淘汰 → chip 占位「原图已释放」诚实降级,不假造
- **可测约束**:① 压缩纯函数断言 ② browser 三入口交互 ③ mock 拦截断言 content parts 形态 ④ 快照往返(缩略 + 引用,IndexedDB 体积不随原图增长)

## Requirement: 文本主模型的识图旁路(vision 转述)

主模型为纯文本模型时,配置 `vision: { llm, prompt?, mode?, maxImagesPerRound? }` 必须使 agent 获得识图能力:图经独立视觉模型转为结构化描述文本注入主上下文,原图不进主模型请求;未配置时含图消息必须诚实报错,禁止静默丢图。

- **B1 自动转述(mode:'auto' 默认)**:send 检测未转述图片 → 后台调 visionLlm(默认模板四段:概述 / OCR / 布局与视觉要素 / 与指令相关观察;`vision.prompt` 覆盖)→ `<image-description id=N>` 块注入该 user 消息前缀;转述完成前占位 `[图片转述生成中]`;**同图 id 缓存**(跨轮不重跑);失败/15s 超时 → `[图片描述不可用]` 占位 + observable error `VISION_DESCRIBE_FAILED`,不阻塞对话
- **B2 工具化(mode:'tool' 或追加)**:`describe_image({ imageId, focus? })` 注入主 agent;handler 经 vfs 取原图 → visionLlm focus 引导转述;结果过大走既有 offload
- **未配 vision 的失败语义**:纯文本主模型 + 含图 + 未配 → send 入口 recoverable 报错(文案引导配置 `vision.llm`),原图保留在消息(用户换模型/补配置后可重发)
- **机制位**:`harness/vision.ts` 中间件(beforeAgent 触发异步转述 + wrapModelCall 组装注入,不改原 messages 数组);装载序在 usageHints 之后、用户中间件之前
- **成本可观测**:`sdk.usage.vision_tokens` 独立累计;`inspect().vision = { configured, mode, cacheHits, lastDescriptions }`;旁路模型建议 flash 量级(文档明示)
- **可测约束**:① e2e stub visionLlm 断言转述注入主模型请求 ② 缓存命中(同图两轮一次调用)③ 诚实报错路径 ④ usage 分离 ⑤ 真 LLM 旁路三场景(截图问组件 / 贴稿还原 / OCR 问答)
