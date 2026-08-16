# Tasks

- [x] P1 存储层 `preferenceStore.ts`:skillStore 模式(StorageBackend 复用/indexed 默认/memory 降级/key 前缀 pref-store);条目 PersistedPreference + 同 topic 合并(后说覆盖)+ FIFO 上限;list/get/put/remove/clear/ready
- [x] P2 捕获纯函数:强信号正则(记住/以后…都…/别…直接提取,零 LLM)+ 中信号模式词初筛(不要/别/太/不喜欢/喜欢/希望)+ 弱信号不做;topic 枚举与合并键
- [x] P3 提炼 prompt + JSON 解析:summaryLlmInvoke 通道;captured/content/topic;核心判定「持久口味 vs 本轮任务指令」;解析失败/超时 → 宁漏不记
- [x] P4 中间件 `createPreferencesMiddleware`:afterAgent fire-and-forget 捕获(每条 user 消息只扫一次)+ augmentPrompt 注入 pin 段(读内存 cache,零 await)+ cache 与 store 写穿透
- [x] P5 capabilities 注册表 +`preferences` opt-in;createChatSdk 装配(mount await store.ready 预载)+ `preferenceStorage` 选项 + 3 个 API(getPreferences/removePreference/clearPreferences)
- [x] P6 DebugDrawer「用户偏好」只读小节 + messages.ts 文案键(~4 键 × 双包)
- [x] P7 selftest sec-84:强信号提取/初筛命中/合并 FIFO/注入段拼接/降级(LLM 缺只强信号)/capabilities 关全关
- [x] P8 e2e preferences.mjs:顶层 API 三件套/强信号经 StubChatModel 收口后落 memory store/capabilities:false → getPreferences 恒空
- [x] P9 文档:README 双侧能力表+配置表/usage-guide 双侧新增小节/CLAUDE.md(capabilities 清单+计数)/CHANGELOG;门禁三绿 + 计数同步
