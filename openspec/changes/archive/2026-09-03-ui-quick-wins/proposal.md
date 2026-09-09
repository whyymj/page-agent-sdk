# Proposal: ui-quick-wins(UI/交互层四项快赢)

> 状态:**✅ 已实施(2026-09-03,待随 4.10.0 发布;Q1-Q4 全 14 任务收口;实施偏差留痕:Q2 storage:false 改为抛错口径 —— 内存拼装会漏 vfs/checkpoints 非同步态,与 switchSession 同口径更诚实)**。优先级 P2(体验优化,纯增量零行为破坏)。目标:把四个高频宿主诉求以最小增量收进 SDK,全部「UI 层 + 公开 API 小面」,不碰核心循环/写路径契约。
> 来源:2026-09-03 功能拓展点咨询收敛(高价值低成本档);用户拍板「openspec 大纲规划」→「按你的计划来」。

## Q1. 快捷指令按钮 quickActions

- **现状**:ChatInput 无预设指令入口;宿主想固化高频操作(「换个配色」「加个 banner」)只能让用户手打或自建 UI 挂对话框外。`dialog` 配置组已有 theme/icons/title 等(optionsResolver.ts:21 `opts.dialog ?? {}` 归组解析),是自然挂点。
- **修法(勘察定形)**:`dialog.quickActions?: Array<{ label: string; prompt: string; icon?: string }>`(≤8 条,超出 warn 截断);ChatInput **chip-stack 区上方**(ChatInput.vue:66 起,聚焦/图片 chip 同族样式)渲染 chip 行;点击 = `ctx.chat.sendMessage(prompt)`(useChat.ts:302 `sendMessage(content, focuses?, images?)` 直收文本,**无需预填 inputText**);流中(loading)chips 禁用(与 send-btn disabled 口径一致,chips 非停止按钮不参与逃生口)。
- **联动**:挂起门禁期 chips 与输入框同步禁用(`gatePending` prop ChatInput.vue:16 已有,ChatDialog.vue:165 同源);headless 无 UI 不受影响;i18n 不涉及(label 集成方自填)。
- **风险**:纯 UI 增量;发送路径零改动(直接走 sendMessage 既有链)。

## Q2. 会话导出/导入

- **现状**:SessionSnapshot 持久化已有(backends/storage.ts:49 接口 / 110 load / 111 save),会话列表/切换已有(ChatHeader sessions + onNewSession/onOpenSession 回调模式);快照拼装单点 = **createChatSdk.ts:2697 `persistRuntime()`**(分多次 persistSave patch:messages 经 `lightenMessages(JSON.parse(JSON.stringify(...)))` 纯化 + todos/planConfirmation/mission/workingMemory/focus/checkpoints+usage);**无公开 export/import API**;`exportDiagnostics` 是诊断快照(脱敏/截断),不是可复全会话。
- **修法(勘察定形)**:
  - `sdk.exportSession(sessionId?): object` —— 复用 persistRuntime 同款拼装合成单对象(messages 走同款 lighten+JSON 纯化),包 `{ formatVersion: 1, exportedAt, snapshot }`;不落 debugLogs(快照本就不含)。
  - `sdk.importSession(json): Promise<{ sessionId }>` —— 校验(formatVersion 已知 / snapshot 基本结构 / 体积闸)→ **总是生成新 sessionId(副本语义,不覆盖既有会话)** → `store.save(全量)` → 会话列表出现;非法输入结构化错误不炸。switchSession(新 id) 由调用方决定(headless 场景 import 后不自动切)。
  - UI(配套):ChatHeader 会话菜单区挂「导出/导入」(onExportSession/onImportSession 回调模式,同 onNewSession 形态;mountChatDialog 桥接 sdk API + 下载 .json / file input)。UI 默认不出现 —— 需 `dialog.sessionTransfer: true` 显式开(避免 header 拥挤;API 恒可用)。
- **风险**:快照格式随版本演进 → formatVersion 向前兼容(未知版本拒 + 明示支持版本);导出含完整对话明文,文档明示集成方自担流转渠道;store 未启(storage:false)时 export 走内存态拼装、import 拒(无落点,友好错误);types/index.d.ts + types/headless.d.ts 同步两方法。

## Q3. write 审批 diff 预览

- **现状**:`write({dryRun:true})` 预检已存在(dataOps.ts:1677 乐观锁手动比对 + 三分支 dryRun 返回,**返回是给 LLM 的字符串形态**「预览新值:safeStringify 600」);approval 挂起时 ApprovalBar 只有 args 原文 JSON(400 截断,ApprovalBar.vue:70)—— 无结构化 old→new 呈现;approval.ts:96 `args: ctx.args` 已进 approval_request 载荷、:51 已有 args 结构读取先例。
- **修法(勘察定形,D 拍板 = 闭包透传)**:
  - createDataOps 工厂暴露**内部预览函数**(非工具)`previewWrite(args) → { ok, intent, items: [{ op?, jsonPath, oldSummary?, newSummary? }], notices? }` —— 复用 dryRun 分支同款纯函数通道(`applyPatchesToBind({dryRun:true})` 返回 clone+applied / `commitSetToBind({dryRun:true})` 返回 data / delete 走 `deleteByPath(deepClone(bind))`),**只读 bind 不碰快照/基线/mutex**(纯函数无副作用面);old 摘要 = 写前按 jsonPath 取 bind 现值截断。
  - createChatSdk 装配 approval 时闭包透传给中间件;approval.ts 挂起时对 write 族(名字命中)调 previewWrite,成功则载荷附 `preview` 字段(失败静默省略,不影响挂起流);PendingApproval 类型 + useChat.ts:212 赋值点透传;ApprovalBar 渲染 items 列表(op + path + old→new 各截 ~200 字符,>20 条折叠计数)。
  - **开关**:`approval.preview?: boolean`(默认 **false** —— 预览跑一次校验链有成本,且 args JSON 已有兜底呈现;编辑器类宿主显式开)。
- **风险**:不改写路径行为(previewWrite 纯只读);approval 中间件与 dataOps 耦合经闭包注入(装配期定,运行时零反射);大 patch 列表截断;非 write 工具不受影响。

## Q4. 拖拽页面元素 = 聚焦入口

- **现状**:drop 处理在 ChatInput.onDrop(ChatInput.vue:34-37),只吃 `dataTransfer.files` → addImageFiles;focus 由宿主 API(editor `select.one → setFocus` 联动)或 agent 工具驱动,对话框自身无元素拖入语义。
- **修法(勘察定形,修正原大纲错误)**:原稿「取 event.target 命中的宿主元素」**不成立** —— drop 的 event.target 是输入框自身,不是被拖的源元素。正确形态:
  - ChatInput 增 window 捕获阶段 `dragstart` 监听,记住源元素(`e.target instanceof Element`;`dragend`/2s 超时清理);
  - onDrop 分流:files 非空走既有图片通道(优先不变);无 files 且声明了 `dialog.onDropElement?: (el: Element) => void` 且记忆源元素 `isConnected` → 回调源元素(映射 el→jsonPath→setFocus 归宿主,editor 复用 select.one 映射函数);否则忽略(维持现状)。
  - ChatInput 需补 onMounted/onBeforeUnmount 生命周期(现无);仅 `onDropElement` 声明时才挂 dragstart 监听(零配置零开销)。
- **风险**:纯事件出口零核心改动;dragstart 捕获不 preventDefault(不影响宿主既有拖拽行为);与图片通道优先级天然分流(onDrop 先查 files);headless 不涉及。

## 不立项项(评估结论留痕)

| 项 | 结论 |
|---|---|
| quickActions 服务端持久化/使用统计 | 无宿主需求;纯前端配置足够 |
| 会话分享链接 | 需要服务端存储,非 SDK 域;Q2 的导出文件已覆盖手动分享 |
| diff 预览的「接受部分 patch」粒度操作 | 改 approval 语义(全过/全拒二元 → 选择性),复杂度不成比例;等真实诉求 |
| SDK 内置 el→jsonPath 自动映射 | 框架无关定位拒绝猜宿主树;回调出口是正解 |
| 语音输入 | 登记 deferred(触发条件:宿主明确需求) |
| importSession 保留原 sessionId(原地覆盖语义) | 副本语义更安全(防误覆盖既有会话);原地导入等真实诉求 |

## 验收门禁

- selftest:quickActions 配置解析(截断/非法项过滤)、exportSession 拼装面断言(messages 纯化/不含 debugLogs)、importSession 非法输入三态(坏 JSON/未知版本/超限)+ 副本语义新 id、previewWrite 纯函数三 intent(item 结构/old-new 摘要截断/bind 零变更断言)。
- e2e:export→import 往返(会话列表出现 + 消息完整)、inspect 反射新 API、approval 预览载荷结构断言(preview 开关两态)。
- browser:chips 渲染 + 点击发送、挂起期禁用态、ApprovalBar diff 渲染(截断/折叠)、drop 分流(files 优先 / dragstart 源元素回调 / 未声明回调忽略)。
- 真 LLM:无需(纯 UI/API 面,无 prompt 变化)。
- 计数同步 CLAUDE.md + README 中英;types/index.d.ts + types/headless.d.ts(headless 面:Q2 两 API)同步。
