# 真 LLM 回归方法论

> mock 测试(stub model / mockLlm)锁定「确定性链路行为」,但抓不到**真模型的思考劣化**:过度思考、DSML 泄漏变体、过程性收口、规范锚引用自造、wrap-up 泄漏等 3.10/3.11 系列修复全部由真 LLM 复测驱动发现。本文记录怎么跑、怎么判 idle、怎么读结果。

## 工具矩阵

| 工具 | 路径 | 覆盖 |
|---|---|---|
| `npm run test:real` | `tests/runtime/real-llm.mjs` | **统一入口**(套件编排 + 基线对比;下三行浏览器族套件均可单独跑) |
| ↳ `… test:real uispec` | `tests/runtime/uispec-real-llm.mjs` | **浏览器路径全场景回归**(complex-demo S1–S10:委派/规范/精修/调序/属性/新建/删除/容器/错误恢复/开放指令) |
| ↳ `… test:real rag` | `tests/runtime/rag-demo-real-llm.mjs` | rag-demo 四模式(A memory 直答 / B mock 检索 / C 真实 MCP / D MCP 直连;Anthropic 协议) |
| `npm run test:real parallel` ↘ | `tests/runtime/parallel-delegation-real.mjs` | 同轮并行委派复验(单场景 7 判定) |
| 直跑 | `tests/runtime/render-check-real-llm.mjs` | render-check 坏 script 自纠 5 场景(html-page-demo;2026-08-26 补验:flash 天然防御化 3/3、异步晚到漏报复现、fail→fix→pass 闭环实证、重委派绕 verify 预算登记 deferred) |
| 直跑 | `tests/runtime/section-orchestrator-real-llm.mjs` | initialPage 双臂(fixture `?arm=grind\|nudge`;2026-08-26 补验:nudge 触发实证、flash 天然解 = 一次性 whole-set 写,grind 形态未复现) |
| 直跑 | `tests/runtime/image-input-real-llm.mjs` | images-demo 识图旁路 3 场景(describe 走 modelverse vision,**须经 vite 代理 /llm 防浏览器 CORS**;2026-08-26 补验:三场景核心链路全通,OCR 字符级精确;vision 转述质量是上游瓶颈,弱转述时主模型诚实但过度探索) |
| `npm run test:draft-real` | `tests/runtime/draft-real-llm.ts` | 大 JSON 分块写(draft_write/draft_commit) |
| `npm run test:trace-real` | `tests/runtime/trace-real-llm.ts` | 结构化追踪 TraceSpan |
| `npm run test:maliang-real` | `tests/runtime/maliang-real-llm.ts` | 马良模型场景 |

浏览器族三套件共享基建 `tests/runtime/_real-llm-lib.mjs`(idle 双条件 / 事件捕获 / 断点续跑 / 基线 diff),新套件只需写场景定义 + checks。`tests/runtime/*-real-llm.ts` 系列(headless 直连 dist)与浏览器族互补:前者快、无 UI 因素;后者真实但慢(全套 ~40min)。

## 跑前准备(踩坑沉淀,必读)

1. **重启 dev server**(`npm run dev`)—— 拿最新代码 + 清 vite 依赖缓存;旧 server 可能持过期模块致「改了没生效」假象。
2. **跑中禁并发 `test:browser`** —— 会抢 dev server 端口/页面,互相干扰。
3. `.env` 配好 `VITE_AI_API_KEY` 等;脚本启动时检测,缺 key 直接 skip(不白跑 401)。
4. 断点续跑:`npm run test:uispec-real` 传场景号(如 `node tests/runtime/uispec-real-llm.mjs 3 7`)只重跑指定场景,报告 json 按场景号合并。

## idle 判定(核心,误判 = 全套报废)

**双条件缺一不可**:

1. **debugLogs 静默 >90s**(连续 3 次采样确认,防采样间隙误判)
2. **`getActiveSubagents() === 0`** —— 子 agent reasoning 阶段**不打日志**,只看日志静默会把「子 agent 狂思考」误判成「已结束」,提前收数据全错

辅助条件:`msgs > prev`(本轮有新消息)+ 至少一条 `llm_response`。

超时(1800s)时脚本自动 dump 诊断轨迹再抛:当前轮次 / 最近工具名与距今秒数 / 活动子 agent / 日志尾 8 条 —— 先看 dump 定位卡点(等响应头假死?工具挂起?还在推理?),不要盲目重跑。

## 已知陷阱

- **`window.__sdk.messages` 字段名不可信**(mountChatDialog initialMessages 与 useChat messages 属性名不匹配,不同源)—— 终态判定只用 debugLogs + 子 agent 活动性;读 messages 内容时用 `at(-1)` 取,勿信中间字段。
- **页面意外 reload**:memory 后端 reload 即丢会话(msgs 归零)。脚本挂了三个诊断钩子:`framenavigated`(意外导航)/ `pageerror`(代码报错)/ console 里 vite hmr 关键词 —— 出现 `[reload]`/`[vite]` 日志先排查是不是 dev server 触发的 hmr 干扰。
- **随机采样日志**(`[采样]`,12% 概率):只用于观察「还在动没」,不是判定依据。

## 产物与基线对比

报告写 `_real-llm-uispec.json`(gitignore,本地留存),每场景:

- `tools` 工具序列 + `toolCount` —— **数量是效率主指标**(3.11 上下文经济性实测 S1 工具 27→15)
- `usage`(prompt/completion tokens)—— **prompt tokens 是上下文经济性主指标**(实测 S1 502K→300K)
- `checks` 断言结果 / `errors`(PATH_DENIED 等回灌留痕)
- `components`(含 codeHead 截断 + `__pgNotes` 笔记)

**基线对比法(已机械化,3.19 框架化)**:改提示词/工具描述/编排逻辑后:

```bash
npm run test:real uispec 1          # 重跑受影响场景
npm run test:real -- --baseline-diff   # 秒回:当前报告 vs 入库基线的硬指标 diff(不跑 LLM)
npm run test:real -- --baseline-update # 确认是预期变化后采集新基线(tests/runtime/real-llm-baseline.json,随代码提交)
```

diff 输出每场景 `prompt/completion/toolCount/elapsedSec` 的 `旧→新(±%)`,超阈值标 **▲疑似回归 / ▼疑似改善**(阈值:token ±15% 且 ±2000;toolCount ±3;elapsedSec 仅展示不判)。真模型输出有波动,单次 ±10% 内视为噪声;连续两轮同方向变化才算真信号 —— ▲ 出现先人工判断是否 prompt 改动的预期代价,确认后更新基线。

## 判定口径

- 断言失败 ≠ 全废:先看 `errors` 与工具序列区分「模型能力问题」(prompt 措辞可救)vs「SDK 链路问题」(工具不可见/路径守卫误拒/DSML 解析漏)
- 「读探测被拒后自纠成功」(如 read 越界 → PATH_DENIED → 改对路径)是**健康行为**,不算失败;「写越界被拒」才是红线

## 并行委派复验(3.13 P3d,第二批组件锁的前置证据)

脚本 `tests/runtime/parallel-delegation-real.mjs`(complex-demo + flash,`maxParallelTools:3`),输出 `_real-llm-parallel.json`。场景:一条消息 = 两个纯代码组件 + 主标题改写。判定 7 项(R1 委派≥2 / R2 同轮≥2 个 use_html / R3 子 agent 真并发 / R4 落地 / R5 write 与委派同轮混排 / R6 标题 / R7 零致命)。

**结果:7/7 全绿(2026-08-15)**。关键证据:

- **同轮混排**(debugLogs tool_result 按 round 分组):Round 4 = `write + read + use_html + read + use_html` —— 主 agent 一轮内同时发出标题 write 与两个委派,与编排引导逐字吻合(模型回复原话「现在同时执行：改标题 + 委派两个代码组件生成」)
- **真并发**:`maxActiveSubagents=2`(采样期间两个子 agent 同时在途;子 agent 时长 407s vs 53s,长短悬殊仍重叠)
- **前提修复**:complex-demo 旧 systemPrompt 写着「勿一次委派多个」与新并行引导直接矛盾(模型会听 business prompt 覆盖编排段)——已改为「可同轮并行、同组件单一在途」并补配 `maxParallelTools:3`。教训:**改内置引导时须 grep 各 demo 的自定义 systemPrompt 是否残留旧禁令**

方法补充:

- **同轮判定**用 debugLogs `tool_result` 的 `data.round` 分组数 `use_html`,不用事件时间戳(同轮多个 tool_call 的调用时刻几乎同时,时间戳聚簇不可靠;round 字段是权威分组)
- **并发判定**优先 `getActiveSubagents()` 采样最大值;sub 事件按 label 区间的算法在多委派同 id(都叫 `html`)时失效(label 同名合并),勿依赖
