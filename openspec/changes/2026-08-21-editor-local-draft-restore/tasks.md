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

- [ ] 手动:改不保存 → 刷新 → 恢复 + 横幅;丢弃 → 回服务端版;保存 → 横幅消失 + 再刷新无横幅
- [ ] 真 LLM:agent 加组件 → 刷新 → 组件还在(横幅),再问 agent「页面有什么」read 到新组件,无「没看到效果」循环
- [ ] 兼容:老格式草稿(无 savedAt)不误恢复;demoMode(无 key)不受影响
- [ ] 多人:一端保存后另一端刷新不误恢复旧草稿
- [ ] **阻塞:登录 cookies 已过期(2026-08-21 07:23 的已 403),等用户提供新 curl 后浏览器验证**

## Phase 4:归档

- [ ] 验收过 → change 归档;CLAUDE.md(editor)AI 助手段补一行「刷新恢复本地草稿」行为说明
