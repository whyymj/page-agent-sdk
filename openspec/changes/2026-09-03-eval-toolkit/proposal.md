# Proposal: eval-toolkit(真 LLM 回归工具链产品化)

> 状态:**📋 大纲规划(2026-09-03 立项,待评审细化)**。优先级 P3(工程/生态)。目标:把 SDK 自用的真 LLM 回归方法论(idle 判定/baseline 对比/场景套件)抽成**纯函数判定层**公开导出,让集成方(editor_fangzhou 类)在自己项目里为自己的宿主场景跑升级前回归 —— 生态粘性投资。
> 来源:2026-09-03 功能拓展点咨询收敛(B 档战略项);用户拍板「openspec 大纲规划」。

## 现状(自用资产盘点)

- `tests/runtime/_real-llm-lib.mjs`:统一入口基建(场景/checks/报告/断点续跑/only 过滤)—— 自用,不在 npm files,集成方不可达。
- **idle 双条件判定**(debugLogs 静默 90s + `getActiveSubagents()===0`):方法论核心,曾防住「reasoning 不打日志误判」;lib 内部函数。
- **baseline 机制**:`--baseline-diff`(token ±15% 且 ±2000 / toolCount ±3)/ `--baseline-update` / `real-llm-baseline.json` 随代码提交。
- **坑位知识**:跑前重启 dev server / loadReport only 过滤剔未跑场景 / reload 诊断 —— 散在 doc/real-llm-regression.md。

## 修法(导出什么)

**红线:只做「与 SDK 交互的判定/等待/对比」纯函数,不做断言框架、不做 runner、不绑 Playwright**(集成方自带 runner;eval 工具自身零 LLM/零浏览器依赖)。

- `createEvalHarness({ sdk })` → `{ waitForIdle({ quietMs=90_000, timeoutMs }), collectReport() }`:
  - `waitForIdle`:双条件判定封装(debugLogs 静默 + activeSubagents 归零 + 在飞流检查〔勘察:core 级在途流注册表可否只读暴露 —— activeControllers 是 core 级已有,加只读反射即可〕);
  - `collectReport()`:usage/toolCount/debugLogs 摘要/会话长度 → 与自用 `_real-llm-*.json` 报告同构(集成方可自行 diff 或进我们 v2 的对比函数)。
- `diffReport(current, baseline, { tokenPct=15, tokenAbs=2000, toolCount=3 })` → 纯函数,▲▼/持平判定(自用 --baseline-diff 的判定核抽公共)。
- 模板文档:`doc/evaluation.md`(或 usage-guide 节)—— 场景定义样例 + 接自己页面 + 升级前跑法;自用 lib 改为消费导出层(单一真相源,防两头漂移)。

## 设计决策点

- **D1(挂载面)**:主包导出(`import { createEvalHarness } from 'page-agent-sdk'`)vs 独立子路径 `/eval`。倾向**主包导出** —— 纯函数零依赖不胀体积,headless 子路径同带(服务端跑回归同口径);若 size 门禁发现可感知增量再议子路径。
- **D2(自用迁移)**:tests/runtime 是否本次就改为消费导出层。倾向**是**(单一真相源)—— 但 `_real-llm-lib.mjs` 有大量 Playwright/demo 驱动胶水,只抽判定核(token 阈值/waitIdle 语义/报告结构)共用,胶水保留自用。

## 风险

- **API 面承诺负担**:导出 = 公开契约(types/测试/文档/向后兼容)。用「小面」对冲 —— 首版只导上列两三个函数,报告结构字段视为**非稳定**(文档明示 major 才稳定)。
- 场景模板写得太抽象没人用 → 模板直接给可抄的完整示例(以 editor 类宿主为假想读者)。
- 与 tests/runtime 漂移(D2 不做的话)→ 倾向做,见上。

## 不立项项(评估结论留痕)

| 项 | 结论 |
|---|---|
| 断言库/expect 语法 | 集成方域(他们有自己的测试栈) |
| runner/CI 集成(GitHub Actions 等) | 集成方域 |
| mock LLM 层产品化(tests/browser mockLlm) | 强绑 demo 路由结构,泛化成本高;真 LLM 才是回归价值面 |
| 报告可视化 | v2+ 看 first-user 反馈 |

## 验收门禁

- selftest:diffReport 判定核(▲▼/阈内三态 × 阈值边界)、waitForIdle 状态机(静默窗口/子 agent 在场/超时)。
- e2e:主包 + headless 双入口导出可达;harness 对 stub 会话的 collectReport 结构断言。
- 真 LLM:自用套件切到导出层后全量复跑一次(零行为漂移验证,D2 的验收即回归门禁)。
- 计数同步 CLAUDE.md + README 中英;types 同步;doc/evaluation.md(或 usage-guide 节)中英。
