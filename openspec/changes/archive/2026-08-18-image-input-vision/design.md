# Design: image-input-vision

## 1. 总体架构(双通道决策)

```
ChatInput(📎/拖拽/粘贴)
   │ compressImage()(canvas,长边≤1568)
   ▼
AgentMessage.images[]  ──持久化──► 快照:{id, thumb≤8KB, vfsRef}
   │
   ▼ send 入口
┌─ 主模型 vision? ──────────────────────────────────┐
│ 是(modelCaps.vision)                              │
│   → content parts 直发:                            │
│     openai: [{type:'image_url'},{type:'text'}]     │
│     anthropic: [{type:'image',base64}]             │
├─ 否 + 配了 vision.llm ─────────────────────────────┤
│   B1 auto: 后台 visionLlm 转述                     │
│     → <image-description id=N> 注入轮前缀          │
│     (同图缓存;失败/15s 超时 → 占位+observable)    │
│   B2 tool: describe_image({imageId, focus})        │
│     → agent 主动深挖(结果走大结果 offload)         │
├─ 否 + 未配 vision ─────────────────────────────────┤
│   诚实报错:「当前模型不支持图片,配置 vision.llm」  │
│   (recoverable 回灌,不静默丢图)                   │
└────────────────────────────────────────────────────┘
```

**决策依据**:主模型是多模态与否是**集成级决策**(成本/配额/既有 prompt 资产),识图能力必须与主模型选型解耦 —— 旁路用便宜视觉小模型(qwen-vl-flash / glm-4v-flash 量级),主模型 token 成本只增加「结构化描述文本」(一图约 300-800 token),原图永不进主模型请求。

## 2. 关键决策记录

### D1:图片表示 —— dataURI 内联,不引入 URL/上传服务
SDK 定位浏览器端、零后端假设。dataURI(base64)直接进消息对象与 content parts;体积由压缩闸控制(单图 ≤~500KB base64)。宿主有 OSS 时可经 `interceptors.input` 自行换 URL 形态(扩展位,Phase 1 不做专门配置)。

### D2:持久化 —— 原图走 vfs,快照只存缩略 + 引用
IndexedDB 快照存原图会把会话体积放大数 MB/图(快照按轮全量存)。快照存 `{id, thumbDataUri(≤8KB), vfsRef}`;原图进 vfs `userImages/*` 池(2MB 配额内 LRU)。跨刷新恢复:thumb 先渲染,原图按需从 vfs 取(vision 直发/再转述时);LRU 淘汰后 chip 显示「[原图已释放]」占位 —— 诚实降级。

### D3:vision 旁路的机制位 —— 中间件 `harness/vision.ts`(beforeAgent + wrapModelCall)
- **beforeAgent**:检测本轮 user 消息 images 未转述 → fire-and-forget 调 visionLlm(**不阻塞首响应**:转述完成前该图以 `[图片转述生成中]` 占位注入;完成事件 bump 后续轮次)——与 memory 异步求值同模式
- **wrapModelCall**:组装最终 messages 时把占位/描述文本拼进对应 user 消息前缀(不改原消息数组,同 summarization compressInput 不改原数组的契约)
- **工具注入**(B2):`tools` 钩子按 mode 注入 describe_image;handler 经 vfs 取原图 → visionLlm(focus 引导)→ 结果(经 summarizeLargeText / offload)

### D4:modelCaps.vision 标志 —— 表驱动 + 显式覆盖
`MODEL_TABLE` 增 vision 列(gpt-4o/4o-mini/claude-3.5+/qwen-vl/glm-4v 系 true;deepseek/glm-5/kimi 系 false);`llm: { vision: true|false }` 显式覆盖(网关代理模型名不可辨时);`setLlm` 切模型重解析。**默认保守**:表未命中 = false(宁走旁路/报错,不误发 parts 吃 400)。

### D5:转述 prompt 模板 —— 结构化四段,可定制
默认模板产出:①整体概述(是什么)②文字内容 OCR(原文引用)③布局与视觉要素(位置/配色/尺寸关系)④与用户指令相关的观察(结合本轮 text)。`vision.prompt` 整体覆盖。模板偏「页面搭建场景」(editor 主场景),通用场景集成方可换。

### D6:失败语义 —— 三档全部「诚实」
- visionLlm 调用失败/超时 → 占位 `[图片描述不可用:id N]` + observable error `VISION_DESCRIBE_FAILED`,对话继续(agent 可告知用户图没看懂)
- 未配 vision + 纯文本主模型 → send 前拦截 recoverable 报错(引导配置),**不静默丢图**(丢图 = agent 凭空回答,比报错恶劣)
- 图损坏/压缩失败 → 输入侧即时拒绝(UI toast 级)

### D7:与既有机制的交互
- **压缩/上下文**:转述文本进 messages 参与常规压缩(占位符在 older 轮被压缩时保留摘要行);vfs 引用保护(既有 extractVfsRefs 扩展识别 userImages ref)
- **子 agent**:子 agent 不自动继承图;主 agent 需要时经转述文本(子读消息前缀)或 B2 结果传递 —— 原图不重复下发
- **approval/audit**:send 含图不改写路径契约;onAudit 不涉图(图不是 data 写入)

## 3. UI 与 i18n

- ChatInput:`📎` 按钮(icons 可配键 `attachImage`)+ 拖拽区高亮 + 粘贴拦截(`paste` 事件 clipboardData.items);chip 复用 focus-chip 视觉(缩略图 + ✕)
- 消息渲染:user 消息气泡下方缩略图行(MessageRow);assistant 侧不渲染原图
- i18n 新键 ~8 个(imageTooLarge / imagePasteHint / imageUnsupported(报错文案)/ describeImage 工具描述等),中英同步
- headless:`send(text, { images })` + `AgentMessage.images` 自建 UI 可用;`sdk.describeImage(imageId, focus?)` 命令式入口(与 vfsWrite 同模式)

## 4. 风险与边界

| 风险 | 缓解 |
|---|---|
| base64 体积撑上下文(多模态直发) | 压缩闸 + 每轮 ≤4 张;content parts 由 API 侧计费不占 text token(但请求体大)→ 单图 ≤500KB 硬闸 |
| visionLlm 也是网关代理 | 复用 constructLlm 全链(重试/流停滞看门狗/严格 CORS 剥头);15s 超时独立闸 |
| 粘贴大图卡 UI | 压缩在 `createImageBitmap` + OffscreenCanvas 异步;>20MB 原图直接拒 |
| 快照兼容(旧版本读新快照) | images 为可选字段,旧代码忽略;SNAPSHOT_KINDS 白名单不变 |
| 真 LLM 成本 | usage.vision_tokens 分离 + inspect 反射;旁路模型建议 flash 量级(文档明示) |

## 5. 验证策略

- **selftest**:compressImage 纯函数(尺寸/质量/透明)/ 消息 images 字段往返 / 旁路注入逻辑(stub visionLlm)/ modelCaps.vision 表驱动
- **e2e(dist)**:stub visionLlm → 转述注入主模型请求断言 / describe_image 工具链 / 未配 vision 诚实报错 / 快照持久化往返(缩略 + vfsRef)
- **browser**:上传/粘贴/chip 删除交互(mockLlm);多模态直发经 mock 拦截断言 content parts 形态
- **真 LLM**:qwen-vl 或 glm-4v 旁路三场景(贴截图问组件 / 贴稿还原 / OCR 问答),usage 分离核对
