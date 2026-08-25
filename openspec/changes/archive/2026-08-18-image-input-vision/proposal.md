# Proposal: image-input-vision(图片上传识图;主模型文本时经 vision 旁路)

## Why(用户诉求,2026-08-18)

「规划上传图片识图的功能;**如果主模型是文本模型,如何实现识图效果?**」—— editor_fangzhou 场景:用户贴组件截图 / Figma 设计稿 / 页面问题截图,期望 agent「看图办事」(定位组件改样式、按稿还原组件、解读报错截图)。主模型当前为 deepseek-v4-flash(纯文本),且大量存量集成主模型同样无视觉能力。

现状缺口:
1. `ChatInput` 无图片入口(粘贴/拖拽/选择均无),`AgentMessage` 无图片字段 —— 图片进不了对话;
2. `constructLlm` 双协议消息组装只产 text content,无多模态 content parts 通路;
3. 无任何「文本主模型下的识图」机制 —— 换多模态主模型是集成级决策(成本/配额/既有 prompt 资产),不该是识图的唯一路径。

## What Changes

**核心:图片进消息(Phase 1)+ 双通道识图(Phase 2)—— 主模型多模态则直发,纯文本则经 `visionLlm` 旁路把图转结构化描述文本注入主上下文,主模型与既有 prompt/工具链零改动。**

### Phase 1:输入侧 + 多模态直连

1. **上传交互**(`ChatInput`):📎 选择 + 拖拽进框 + **粘贴剪贴板截图**(编辑器最高频路径);输入框上方缩略图 chip(可删,上限 4 张/轮)
2. **图片处理**(纯前端):canvas 压缩(长边 ≤1568px 对齐主流多模态输入限制,jpeg 质量 0.85,透明保留 png);产出 `{ id, dataUri, width, height, bytes }`
3. **消息模型**:`AgentMessage` 增 `images?: AgentImage[]`;`send(text, { images })` API;持久化**不存原图**——快照存 `{ id, thumbDataUri(≤8KB 缩略), originalRef }`,原图走 vfs 大文件池(`userImages/*`,LRU 既有)防 IndexedDB 撑爆;跨会话恢复时原图被 LRU 淘汰则 chip 显示占位(诚实降级,不假造图)
4. **多模态直连**:`modelCaps` 增 `vision` 标志(模型表 + `llm:{ vision: true }` 显式覆盖);openai 协议组装 `content: [{type:'image_url'},{type:'text'}]` parts,anthropic 协议 `{type:'image', source:{base64}}` block —— 复用 2.28 streaming contentParts 抽象位;`provider:'anthropic'` 子 agent 同步

### Phase 2:vision 旁路(文本主模型的识图,核心问题)

5. **配置组** `vision: { llm: LLMConfig | BaseChatModel, prompt?, mode?: 'auto' | 'tool', maxImagesPerRound? }` —— 未配则含图消息在纯文本主模型下**诚实报错提示**(「当前模型不支持图片,可配置 vision.llm 开启识图」,不静默丢图)
6. **B1 自动转述(mode:'auto' 默认)**:send 入口检测含图 → 后台并行调 `visionLlm` 生成**结构化描述**(预设模板:整体概述 / 文字内容 OCR / 布局与色彩要素 / 与本轮指令相关的观察),描述以 `<image-description id=N>` 块注入该轮 user 消息前缀(主模型可见、原图不进主模型请求);同图 id 缓存(多轮引用同图不重跑);visionLlm 失败/超时(15s)→ 该图降级「[图片描述不可用]」占位 + observable error,不阻塞对话
7. **B2 工具化(mode:'tool' 或追加,opt-in)**:`describe_image({ imageId, focus? })` 工具注入主 agent —— agent 需要深挖细节时按 id 主动调(转述可带 focus 追问,如「图里按钮的文字是什么」);工具结果走既有大结果 offload
8. **usage 分离**:`sdk.usage.vision_tokens` 独立累计(旁路成本可观测);`inspect().vision` 反射(配置/缓存命中/最近转述)

### 明确不做(Non-goals)

- 不做视频/音频输入;不做 agent 主动「截图工具」(get_dom 已覆盖 DOM 面;截图由用户贴)
- 不做图片编辑/生成(只读识图)
- 不内置 OCR 引擎(B3 宿主接 OCR 服务留扩展位:vision.prompt 可引导 visionLlm 做 OCR,票据级精确 OCR 由集成方经 tools 注入)
- Phase 1 不做流式中间态(图片 chip 本地即时显示,无上传进度条 —— 纯本地无网络上传)

## Impact

- **文件面**:ChatInput.vue(UI)/ types(AgentMessage)/ createChatSdk(vision 配置组 + 装配)/ llmResolver+constructLlm(content parts)/ modelCaps(vision 标志)/ 新 `harness/vision.ts`(旁路中间件)/ storage(快照图片字段)/ vfs(userImages)
- **测试**:selftest(压缩纯函数/消息模型/旁路注入逻辑)/ e2e(stub visionLlm 转述注入 + describe_image 工具 + 诚实报错)/ browser(上传交互 + chip + 粘贴)/ 真 LLM(qwen-vl 或 glm-4v 旁路场景)
- **依赖**:零新 npm 依赖(canvas 原生)
- **editor_fangzhou 收益**:贴截图问组件 / 贴设计稿还原 custom 组件(html 子 agent 配合),无需换主模型
