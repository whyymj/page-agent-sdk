# Proposal: take-screenshot(截图工具族:条件注入的页面视觉查看能力)

> 状态:**📋 大纲规划(2026-09-17 立项,设计已三路勘察定案;P2 —— 与 4.15.0 page-quote 同场景族,文档站/页面验证闭环补「看」的最后一块)**。目标:主模型多模态或已配识图能力时,agent 获得截图查看工具(部分 DOM / 全页 / 视口三模式),截图进对话、原图收 vfs、UI 可观察。
> 来源:用户需求(2026-09-17)「如果配置了多模态模型或者识图 mcp 等,就注入截图查看的能力工具;要支持部分 dom 截图以及全页面截图能力」+ 拍板两项(vendor html-to-image / 全 bundle 含 UI 缩略图)。

## 现状(勘察证据)

- **工具面零截图**:`src/core/tools/` 全量无截图工具;`grep screenshot|截图 src/core` 零命中。agent 的「看」目前 = 结构(get_dom)/正文(read_page)/单元素(dom_info 的 rect+styles 推断布局)—— 无视觉真值。
- **工具结果通道是纯文本**:`createAgent.ts:794` `content = typeof result === 'string' ? result : JSON.stringify(result)` 字符串硬收口;`ToolExecResult.content: string`(middleware.ts:77-80)无 parts 通道;offload(`utils/offload.ts:68-100`,阈值 clamp[2000,20000] 字符)会把 base64 截图毁成文本文件。
- **压缩会杀 ToolMessage parts**:`trimContextIfNeededImpl`(createAgent.ts:285-310)超 60% 窗口时从最早 ToolMessage 起,`content.length > 400` 即替换为字符串切片 —— 带图 ToolMessage 最优先被裁。
- **user 消息多模态双协议完备**:`buildImageContentParts`(imageInput.ts:62-86)openai `image_url` / anthropic base64 source 双形态;converter 实勘(node_modules):`@langchain/openai@1.5.5` completions.js:571-601 对非 string content flatMap 透传 parts(tool 角色 v1 contentBlocks 例外路径自建消息不命中);`@langchain/anthropic@1.5.4` message_inputs.js:34-52 tool_result/_formatContentBlocks 完整支持图 block。
- **图管线基建现成**:`createImagePipeline`(createChatSdk.ts:2046-2052,闭包 getVision/getConfig 活值)含 stow(vfs userImages 池)+ describeIfNeeded(非 vision 转述旁路);压缩闸 canvas 管线(imageInput.ts:159-202,≤1568px jpeg q0.85)。
- **条件注入先例**:verify 意图推断 + 未装 warn(createChatSdk.ts:822-833);bulkGuard「须配 approval 否则 no-op 留痕」(3.40.0 版 :1397-111,4.1.0 已移除但形态可抄);装配期同步可判(modelCaps 来自 resolveLlm createChatSdk.ts:418,images.describe 静态配置)。
- **体积余量**:size-check.mjs 计 raw 字节,ESM 余量 ~110KB / headless ~51.6KB / iife ~317KB / legacy ~393KB;node_modules 零 canvas 依赖,package.json **无 dependencies 字段**(首个 runtime 依赖将开此字段)。
- **硬约束**:html-page-demo 预览 iframe 是 `sandbox="allow-scripts"`(无 allow-same-origin,App.vue:259)—— 跨 origin contentDocument 不可达,任何 DOM 截图库对它失效。

## S1. take_screenshot 工具本体(三模式 + 渲染 + 压缩 + vfs 收口)

- **现状**:无;截图渲染库未引入;userImages vfs 池仅服务用户贴图。
- **修法(勘察定形)**:`take_screenshot({ selector?, fullPage?, maxEdge? })` —— ① `selector` 给定 = 该元素局部截图;② `fullPage: true` = 整页(document.documentElement.scrollHeight);③ 都不给 = 当前视口。渲染 = **vendor html-to-image(仓库首个 runtime dependency,~47KB/产物)**,默认走 `toPng/toJpeg`;顶层配置组 `screenshot?: { renderer?: (target: Element | Document, opts: { fullPage?: boolean }) => Promise<string /* dataUri */> }` 自定义钩子(宿主 CSP 限制 SVG foreignObject 时逃生 + 测试注入位)。产物过压缩闸(复用 imageInput canvas 管线,长边 ≤1568 jpeg q0.85);**原图 stow 进 vfs `userImages/<id>` 池**(LRU + 持久化,stowImages 现成);ToolMessage 返回**纯文本元数据**(模式/选择器/尺寸/字节数/vfsRef),绝不把 base64 放进 content(offload 阈值 2 万字符远小于任何截图)。跨域图污染 canvas / foreignObject 序列化失败 → try/catch 降级可读文案(列出限制与 selector 缩小建议),不留静默空图。
- **风险**:html-to-image 走 SVG foreignObject 路线,个别宿主 CSP 禁 SVG data URL 时整路失败(→ renderer 钩子逃生,文案引导);全页超长文档(万级 px)渲染耗时/内存 —— maxEdge 与 fullPage 加高度上限守卫(如 >32768px 拒并提示分段 selector)。

## S2. 条件注入 + 图通道(分层混合)

- **现状**:domInspect 族(get_dom/read_page/dom_search/dom_info)opt-in 但无视觉通道;ToolExecResult 无 parts;vision 主模型的图只在 user 消息 images 通道。
- **修法(勘察定形)**:
  - **注入条件**:`caps.domInspect && (modelCaps.vision === true || typeof options.images?.describe === 'function')`,buildCore 内 domToolsForPool 同段(createChatSdk.ts:675-677)同步判定;domInspect 开但两条件都不满足 → `console.warn` 留痕一次(verify 先例形态)。工具 = **sdk 层工厂**(`createScreenshotTool(deps)`,闭包 imagePipeline/vfsStore/getVision/renderer —— 静态 domTool.ts 放不下这些依赖),装配进 domToolsForPool 两条路径(skills 开经 dom-inspect skill 工厂 / skills 关直进池);setLlm 后 vision 降级 → 工具运行时诚实拒绝(IMAGE_UNSUPPORTED_MODEL 文案先例),升级不动态补装(v1 明示限制)。
  - **vision 主模型图通道**:工具执行后在 ToolMessage(文本元数据)**之后追加一条合成 HumanMessage**,parts 复用 `buildImageContentParts(元数据摘要, [{ dataUri }], imageContentFormat)` —— user 角色双协议零方差,且**免疫 trimContextIfNeeded(只裁 ToolMessage)与 offload**;合成消息只在本轮 ReAct 生效(下轮 toLC 不重放,跨轮靠 vfsRef + 重截图)。
  - **非 vision 通道**:工具内直接调 imagePipeline 的 describe 逻辑(闭包注入,无需 callConfig 递进)转述文本回灌 ToolMessage —— 零协议风险。
- **风险**:合成 HumanMessage 参与后续轮次历史(toLC 重放窗口内)—— 控制尺寸(压缩闸)+ 轮次推进后随 trim 自然衰减,与既有 user 图片行为同构;网关对 OpenAI 协议 tool 消息带图接受度不定 —— 本方案不依赖该形态(Anthropic tool_result 原生带图为 deferred 升级项)。
- **引导面**:usageHints domInspect 行条件追加「视觉验证用 take_screenshot」(**勿教调不存在的工具**先例:humanConfirm 开关分支切换文案);dom-inspect skill getContent 补截图用法段 + 排障套路更新(「视觉验证优先截图,结构验证用 dom_info」)。

## S3. UI 观察面 + demo 演示

- **现状**:tool_result 事件 `result: string`;MessageSteps 步骤行纯文本 —— agent 截了什么用户看不到。
- **修法(勘察定形)**:StreamEvent `tool_result` 增可选 `image?: { dataUri: string; vfsRef?: string }`(纯加法,公共事件形状 minor);MessageSteps 步骤行渲染缩略图(复用 msg-image 样式:点击放大 a[href]、LRU 淘汰后降级占位,i18n alt 补键);docs-demo 加截图 quickAction(「截图看看配置表格」)+ systemPrompt 提示可截图;complex-demo(改组件→截图自检视觉)为第二演示位。
- **风险**:事件形状变更过 types-alignment(双 d.ts 同步);缩略图 dataUri 常驻 UI 内存 —— 用 thumb 形态(压缩闸产)非原图。

## 设计决策点

- **D1 图通道分层**:vision → 合成 user 消息 parts(免疫 trim/offload、双协议零方差);非 vision → describe 转述唯一通道;Anthropic tool_result 原生带图(langchain 1.5.4 已支持)为 deferred 升级。**否决** ToolMessage parts 直发:需同时加固 trim(:302)/offload(:794)两处字符串化点 + ToolExecResult 类型扩宽 + OpenAI 网关接受度赌注。
- **D2 条件注入而非恒装**:用户点名语义(「配置了…就注入」);装配期一锤定音 + 运行时降级诚实拒绝;setLlm 升级不动态补装(v1 限制明示)。
- **D3 vendor html-to-image(~47KB)**:用户拍板开箱即用;html2canvas(~148KB)否决(重校幅度同 designSkill 级而 CSS 兼容收益有限);动态 import 分块否决(4 份 lib config 单文件模式 inlineDynamicImports,分块不成立 —— vite.iife.config.ts:43/vite.headless.config.ts:8-10 注释已钉死);renderer 钩子恒保留(逃生 + 测试注入)。
- **D4 原图收 vfs 不进消息**:base64 不进 ToolMessage(offload 必毁);合成消息只带压缩后 dataUri;跨轮/审计靠 vfsRef。
- **D5 UI 缩略图走事件加法**:`tool_result.image` 可选字段,不改既有字段;UI 只消费 thumb。

## 范围红线

- v1 = 三模式工具 + 条件注入 + 分层图通道 + UI 缩略图 + docs-demo/complex-demo 演示 + size 双闸重校;**不做**:html-page-demo sandbox iframe 截图(跨 origin 硬约束,postMessage 通道方案入 deferred)、vfs 截图重注入工具(跨轮重看图,先靠重截图)、setLlm 动态补装、read_page/fetch_document markdown 化(独立项)。

## 不立项项(评估结论留痕)

| 项 | 结论 |
|---|---|
| html-page-demo iframe 内截图 | ❌ 硬约束(sandbox 无 allow-same-origin);重启触发 = 宿主愿意改 iframe sandbox 或走 postMessage 回传通道(deferred 2026-09-17 段) |
| Anthropic tool_result 原生带图 | ⏸ langchain 1.5.4 已透传,语义最贴但需加固 trim/offload 双豁免;触发 = D1 合成消息方案在真 LLM 出现跨网关兼容问题 |
| vfs 截图重注入工具(重看历史截图) | ⏸ 无真实需求前不立项;触发 = 真 LLM 基线出现「反复重截同区域」调用模式 |
| html2canvas vendor | ❌ 体积(148KB,ESM/headless 余量爆 3×)与 CSS 重实现盲区双否 |
| 动态 import 分块省体积 | ❌ 单文件库模式不成立(构建配置注释钉死) |

## 验收门禁

- selftest:渲染器注入 fake(getComputedStyle 注入先例 domTool.ts:391)测三模式参数路由/压缩闸数值/vfs stow 调用/失败降级文案;条件注入判定矩阵(domInspect×vision×describe 八格);合成消息 parts 组装纯函数。
- e2e:StubChatModel 断言 ① vision 主模型 → 工具轮次后出现合成 HumanMessage(parts[0].text 含元数据、parts[1] 双协议图形态);② 非 vision + describe → ToolMessage 纯文本含转述(图不直发);③ 条件不满足 → 工具不在池(inspect 反射)+ 装配 warn;④ node 守卫文案。
- browser:docs-demo 真跑 canvas(截图真渲染,断言 tool_result 事件 image 字段 + MessageSteps 缩略图 + 请求体 parts 形态);images.spec realPng 先例同构。
- size:六条阈值重校(size-check.mjs)+ headless-subpath.mjs:106 同口径,+~47K/产物按 designSkill 先例(f6999be)留档 CHANGELOG「有意增长」。
- 计数同步:CLAUDE.md + README 中英 + 双 d.ts(MessageQuote 同款双侧纪律:screenshot 配置组/tool_result.image 字段/事件类型);usage-guide 中英补节;真 LLM:docs-demo 截图场景进 uispec 套件观察名单(基线新增场景,不做阻塞门禁)。
