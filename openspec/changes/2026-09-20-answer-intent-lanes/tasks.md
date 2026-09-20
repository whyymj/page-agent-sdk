# Tasks

> 全局连续编号;实施按 Phase 顺序,S1 → S2 → S3(测试门禁)→ S4(文档收尾)。
> 前置阅读:`src/core/presets.ts`(systemPromptHelpers 形态)、`src/core/sdk/promptBuilder.ts`(默认页面分支)。

## Phase 1 — S1 车道纪律本体(导出面)

- [x] 1. `presets.ts`:新增 `ANSWER_LANES_ZH` / `ANSWER_LANES_EN` 常量(三车道 + 出处密度收敛文案,与 proposal S1 逐字一致),挂 `systemPromptHelpers.answerLanes` / `answerLanesEn`
- [x] 2. `src/core/index.ts` 导出同步(无新顶层导出名 —— 挂既有 `systemPromptHelpers` 对象,确认 exports-consistency 不需改;若需,双侧主包/headless 同加)
- [x] 3. `types/index.d.ts` + `types/headless.d.ts`:`SystemPromptHelpers` 接口补 `answerLanes: string` / `answerLanesEn: string`(手动维护双 d.ts)

## Phase 2 — S2 默认页面分支同源升级

- [x] 4. `promptBuilder.ts`:`DEFAULT_PAGE_PROMPT` 的「回答纪律:…」行替换为 `systemPromptHelpers.answerLanes`(import 同源常量,防漂移);「页面内容与你的先验知识冲突时以页面为准」并入 A 车道语义不丢
- [x] 5. `DEFAULT_PAGE_PROMPT_EN` 同构(`answerLanesEn`);身份句/引用块引导/输出纪律行均不动

## Phase 3 — S3 测试门禁

- [x] 6. selftest(promptBuilder 对应 sec 模块):默认页面分支含三车道关键文案(A/B/C 车道、「本页未提及,以下是通用解释」、「页面没写不构成不答的理由」)+ en 对齐 + `answerLanes` 导出内容断言 + screenshot 两变体均含(≥5 断言)
- [x] 7. e2e(systemprompt + exports 模块):`answerLanes`/`answerLanesEn` 在主包与 headless 双侧导出面;默认页面 prompt 快照断言更新(+2)
- [x] 8. 真 LLM docs-qa 套件补 2 场景(tests/runtime/docs-qa 挂表):B 车道术语不在页仍解释 / C 车道「根据你的经验」先验与页面口径分列(无 key 自动 skip;登记进 REGISTRY)
- [x] 9. 计数同步:selftest/e2e 新增数进 CLAUDE.md + README 中英 + `node scripts/check-test-counts.mjs` 对账绿

## Phase 4 — S4 文档收尾

- [x] 10. `doc/usage-guide.md` + `.en`:systemPromptHelpers 段补 `answerLanes` 用法(自定义身份宿主拼装示例,门户式)
- [x] 11. `CLAUDE.md`:「Agent 身份」段 4.16 能力感知描述补车道一句;`README.md` / `README.zh-CN.md` 特性行(若有默认 prompt 描述处)
- [x] 12. `CHANGELOG.md` [Unreleased] → 版本条目(Added: answerLanes 导出;Changed: 默认页面分支 prompt 三车道)
- [x] 13. 发布门禁全绿(build → test → e2e → browser → exports → types → types-alignment → types-novue → size → check-test-counts → pack dry-run)
- [x] 14. S3 门户采纳提醒:SDK 发布后另开 learning 仓库提交(SYSTEM_PROMPT 车道化 + 删「说明查过哪里」);不在本 change 验收内

## 实施注记(实施时回填)

- 2026-09-20 实施:任务 1-12 完成;门禁(task 13)已全绿 —— selftest 3777→**3782**(sec-31 +5:车道关键字/截图变体/en 对齐/helpers 独立片段/同源逐字一致)、e2e 1278→**1281**(exports 主包 + headless-subpath 双侧 + systemprompt 快照)、exports/types/types-alignment/types-novue/size/check-test-counts 六道全过;发布待用户拍板(发布触发约定),task 14 门户采纳在 SDK 发布后执行。
- 文档版本标记用 change 名(answer-intent-lanes)而非预设版本号 —— 版本号在发布拍板时才定(4.23.4 patch / 4.24.0 minor 二选一;新增导出面按纪律应 **minor**)。
- browser 套件无需新增:纯 prompt 面,complex-demo 断言走 dataOps 分支不受影响(已核 sysText 断言面)。
