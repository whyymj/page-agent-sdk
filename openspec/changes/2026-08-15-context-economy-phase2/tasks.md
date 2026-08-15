# Tasks: context-economy-phase2

> **minor**(新配置项 promptSoftCapTokens / roundTokenBudget + 默认行为增强)。A 压缩触发 → B 工具瘦身 → C 自感知 → D 测试 → E 文档 → F 真 LLM 复测。

## 阶段 A:压缩触发成本维度(promptSoftCapTokens)

- [x] A1 `contextIndex.ts`:`shouldTriggerCompression` token 分支改 `min(window × ratio, softCap)`;`CompressionTriggerConfig` 加可选 `promptSoftCapTokens`
- [x] A2 `useContextManager.ts`:config 解析 —— 显式值优先;未传且窗口 ≥320K → 默认 160K;否则不参与;0=显式关
- [x] A3 `contextPreset.ts` 不动(默认逻辑在解析层);`types/index.d.ts` ContextOptions 加字段;`src/core/index.ts` 导出同步(如有新纯函数)

## 阶段 B:工具面瘦身二批

- [x] B1 `dataOps.ts` 压缩:eval_script(505)/draft_commit(379)/set_data(312)/draft_write(306)/get_data(248)/query_data/search_data/history_data/edit_data —— 只留「何时用 + 关键参数」,教程句删或迁 usageHints(!simple 分支,**勿双份**)
- [x] B2 `envTool.ts` inspect_env(260)/`domTool.ts` get_dom(183) 同原则压缩
- [x] B3 锚定纪律:批量改用 `index('description:', name_pos)` 正向锚定;改完浏览器读 `inspect().tools` 逐条核对(一阶段事故教训)

## 阶段 C:agent 自感知预算

- [x] C1 usageHints 增消耗提示段:装配期收 `() => ({rounds, maxToolRounds, usageTokens, softCap})` getter(从 AgentCore);rounds ≥70% 或 tokens ≥ softCap/2 → 注入「⏳ 预算提示」一行;每任务只注入一次
- [x] C2 createAgent 写失败计数:`writeRetryByPath` Map(写工具 error +1 / 成功清零);≥2 时注入段附「连续写失败 N 次:先 read 核对或 restore_data 回退」
- [x] C3 todos `maxPlanRevisions` 回灌文本补「(第 N 版计划)」计数前缀
- [x] C4 `roundTokenBudget` opt-in:createAgent 每轮模型调用前查本次 invoke 累计 total_tokens,超限 → 友好收口消息 + observable emit(与用户停止同 abort 语义);`createChatSdk` 选项透传 + types

## 阶段 D:测试(同 commit)

- [x] D1 selftest:softCap 纯函数 5 断言(默认参与/小窗口不参与/显式覆盖/0 关/ratio 仍先生效)
- [x] D2 selftest:advanced 数据工具描述总长回归断言(防锚定事故重演)
- [x] D3 selftest:C1 注入条件(达 70% 含提示/未达不含/一次性)+ C2 计数(连续 2 次触发注入、成功清零)+ C3 版次前缀
- [x] D4 e2e:roundTokenBudget stub 多轮超限中断收口 + 未配不生效;promptSoftCapTokens 显式配置反射可见
- [x] D5 计数同步:CLAUDE.md / README 中英

## 阶段 E:文档

- [x] E1 `doc/context-management.md`:softCap 触发公式 + 默认策略 + 回退方式
- [x] E2 `doc/usage-guide.md` 中英:§6.8 压缩段 + 配置参考(promptSoftCapTokens/roundTokenBudget);README 中英能力清单
- [x] E3 CHANGELOG [Unreleased] Added/Changed

## 阶段 F:真 LLM 复测与发布

- [x] F1 `_real-llm-uispec.mjs` 复测 S1/S7:对比基线(28 轮/507K)记录轮次、prompt tokens、完成质量(softCap 不伤质量为验收线)
  - 结果:S1 工具 27→15(-44%)、prompt 502K→300K(-40%)、7/8 断言过(仅「笔记沉淀」软项未触发);S7 正常完成 2/2(此前被页面重载打断,根因 = 遗留旧 vite dev server 强制 reload,换新 server 零复发)
  - 复测发现并修复 P0:wrap-up 收口泄漏未解析 DSML → `sanitizeGarbledContent` 剥离 + observable error;连带修复 headless send/batch 路径 error 事件不外发(`makeStreamWatch`)
- [x] F2 S1 轮次已降(27→15,17 次 vfs_grep 重复调研消失)→ 调研轮次治理二期不需要,关闭
- [x] F3 门禁全绿(build/test 2011/e2e 610/browser 54/exports 14/types/types-alignment/size 5/pack 干净)→ bump minor 3.11.0 → 询问用户发布
