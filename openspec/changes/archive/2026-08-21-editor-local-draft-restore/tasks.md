# Tasks(editor-local-draft-restore;目标仓库 editor_fangzhou)

## Phase 1:写入侧(doSave 加元数据)

- [x] doSave 草稿条目改 `{ savedAt, content }` 形态(immediately 与防抖两分支同改)
- [x] savePage 成功回调里重写条目(markDraftSynced:保 content 清 savedAt);同处清横幅
- [x] 顺手:savePage/publish 读草稿处改经 `common.editorDraftContentString` 解包(新格式取 content,老格式原文);d-Preview/Header 两处 preview 消费 `EditorautoSave_tmp` 同步解包

## Phase 2:读取侧(loadPageInfo 恢复)

- [x] 拉到服务端 info 后读 localStorage:`common.readEditorDraft` 双兼容解析(老格式裸字符串 / 新格式 {savedAt, content})
- [x] 恢复判定双条件:本地有 savedAt 且 内容 ≠ 服务端内容(键序无关规范化序列化比对);服务端 updateTime 可得时加 savedAt > updateTime;拿不到 updateTime → 降级只提示不自动恢复
- [x] 命中恢复:nodeInfo 用本地 content,顶部横幅(「检测到本地未保存的修改(约 X 分钟前),已恢复」+ [丢弃并使用线上版本] [保存到服务器] 两按钮)
- [x] 「丢弃」:清挂起防抖定时器(竞态:watch 触发的 doSave 500ms 后可能覆盖丢弃写入)→ 本地草稿改写为服务端内容并 reload;「保存到服务器」:走现有 pageInfo.save 链路(成功后 markDraftSynced + 横幅消失)
- [x] 未命中(无草稿/hash 一致):现状直用服务端版,零横幅

## Phase 3:验证

- [x] 手动(2026-08-22 Playwright S1-S6 全 20 断言):改不保存 → 刷新 → 恢复 + 横幅;丢弃 → 回服务端版 + 再刷新不复活;保存 → 横幅消失 + markDraftSynced(save 接口 route 拦截,零服务端写入)
- [x] 真 LLM(2026-08-22 S7 完成,**6/6 断言**,glm-5.2 + Playwright `window.__sdk.send`):agent 加组件 → 刷新 → 横幅 + 组件恢复 → 追问「页面有什么」agent 读到恢复后组件且回答如实、零重做。**过程副产品**:LLM 网关模型面剧变(deepseek 系/gpt-4 系/claude/kimi 全 400;gpt-5 小 max_tokens 可流但带 tools 时 reasoning 烧光预算零输出;**glm-5.2 全形态可用**)→ editor 本地验收配置切 glm-5.2(`ai-llm.local.js` 留档);AiAssistant.vue 补 `maxTokens` 透传;SDK 侧两加固(modelCaps gpt-5 条目 + 流零 chunk 空响应守卫,f31702a)
- [x] 兼容:老格式草稿(无 savedAt)不误恢复、页面不崩;已同步形态({content} 无 savedAt)不弹;doSave 自然写草稿后刷新不误弹(内容一致)
- [x] 多人(时间戳判序):草稿 savedAt < 服务端 updateTime → 静默不恢复,编辑器用服务端版
- [x] 验收中发现并修复两个实现缺陷(见 Phase 3.5)

## Phase 3.5:验收驱动修复(2026-08-22,editor 仓库)

- [x] **P0 updateTime 解析**:线上 `updateTime` 为 ISO 字符串('2025-12-22T07:17:52.000Z'),`Number()` 恒 NaN → 恒走「无法确认新旧已忽略」降级分支,**恢复从未生效**(S1 前置实证:横幅 0 + warning)。修:Editor.vue 兼容 number(ms)/秒级数字(×1000)/ISO 字符串(Date.parse)三形态
- [x] **预览键不一致(存量 bug)**:d-Preview/Header.postData 硬编码读 'EditorautoSave_tmp',而 STORAGE_KEY 按页拼接 → 有 key 时预览恒读空键,预览从未读到过本页草稿(commit 27c73db 只包了格式解包没修键)。修:common.js 新增 `editorDraftKey(projectKey, pageKey)`(与 STORAGE_KEY 同构),两处调用统一
- [x] S6 实证:预览读键 = 'EditorautoSave_s4v1z8_0lnxip'(Storage.prototype.getItem 埋点),不再出现 tmp
- [x] 测试构造备忘:`restoreLocalDraft(info)` 收到的 serverInfo 已过 `normalizeComponentPath`(dev02→static URL 改写),「内容一致」场景须用 doSave 自然写入的规范化草稿比对,原始 JSON 直塞会假阳性弹横幅

## Phase 4:归档

- [ ] 验收过 → change 归档;CLAUDE.md(editor)AI 助手段补一行「刷新恢复本地草稿」行为说明
