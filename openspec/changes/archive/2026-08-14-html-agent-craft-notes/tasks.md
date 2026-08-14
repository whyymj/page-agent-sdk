# Tasks: html-agent-craft-notes

> 实施任务清单。`/opsx:apply` 按此执行。**minor**(向后兼容)。A 笔记沉淀 → B 笔记注入 → C 子 agent 约定 + 主 agent 转述 → D 测试 → E 文档 → F 发布。

## 阶段 A:笔记沉淀(afterAgent)

- [x] A1 `src/core/sdk/codeAssetMiddleware.ts` CodeAssetMiddlewareOptions 加 `craftNotes?: boolean`(默认 true);afterAgent commit 后追加:提取子 agent 最终回复 `[note] ` 行 → 归属 touched 组件(单 touched 直接归属;多 touched 时行内含组件 name 则精确归属,否则只给首个)→ 去重 → slice(0,200) → FIFO ≤5 push
- [x] A2 `src/core/sdk/htmlSubagent.ts` CreateHtmlSubagentOptions 加 `craftNotes?: boolean`,`_codeAsset` 透传;`src/core/sdk/createChatSdk.ts` 装配 codeAssetMiddleware 时传入
- [x] A3 核对 `dataOps.ts` supplementPgId:LLM write 整对象替换组件时 `__pgNotes` 与 `__pgId` 同路径保留;取不到旧值则接受丢失(代码注释标注边界)
- [x] A4 提取子 agent 最终回复:afterAgent state.messages 末尾 assistant 文本(核对 subagent state 结构,与 verify beforeReturn 取同一来源)

## 阶段 B:笔记注入(augmentPrompt)

- [x] B1 `codeAssetMiddleware.ts` augmentPrompt 地图:每组件行追加 `  📝 笔记×N(最近):<最近 1 条>`;地图头加交接引导一句;craftNotes:false 不注
- [x] B2 notes 长度防御:最近 1 条注入前再截断(如 120 字,一行内)

## 阶段 C:约定与转述(提示词)

- [x] C1 `htmlSubagent.ts` htmlSystemPrompt「交付」段加 [note] 约定(收尾回复末尾附 1 行实现要点交接)
- [x] C2 `presets.ts` htmlOrchestratorPrompt【委派 task 规格化】补 ⑤ 历史偏好(可选)要素 + 一句示例

## 阶段 D:测试(同 commit)

- [x] D1 selftest sec-72 扩展:A1/B1 六项可测约束(沉淀/FIFO 截断/无 note 不沉淀/注入行/read 投影隐藏/craftNotes:false)
- [x] D2 e2e capability-packs:stub 子 agent 返回含 [note] → data bind 含 __pgNotes;二次委派子上下文见笔记
- [x] D3 browser html-page-demo:mock 子收口含 [note] → 主 data tab 含 __pgNotes
- [x] D4 真 LLM 复验(手动):同组件二次精修,子 agent 思考引用笔记而非重新推演(记 doc/CLAUDE.md)

## 阶段 E:文档

- [x] E1 README.md + README.zh-CN.md:createHtmlSubagent 表加 craftNotes;能力描述一句「工匠笔记:同组件跨委派设计意图持续」
- [x] E2 doc/usage-guide.md + .en:HTML 能力包段补工匠笔记机制([note] 约定 + __pgNotes sidecar + opt-out)
- [x] E3 CLAUDE.md:能力包段补一句;测试计数同步
- [x] E4 CHANGELOG.md [Unreleased]

## 阶段 F:发布(minor,用户确认后)

- [x] F1 门禁全绿(build/test/e2e/browser/exports/types/size/pack)→ bump → commit → 询问用户是否发布(已随 3.5.0 发布)
