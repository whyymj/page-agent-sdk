# 真 LLM 回归方法论

> mock 测试(stub model / mockLlm)锁定「确定性链路行为」,但抓不到**真模型的思考劣化**:过度思考、DSML 泄漏变体、过程性收口、规范锚引用自造、wrap-up 泄漏等 3.10/3.11 系列修复全部由真 LLM 复测驱动发现。本文记录怎么跑、怎么判 idle、怎么读结果。

## 工具矩阵

| 工具 | 路径 | 覆盖 |
|---|---|---|
| `npm run test:uispec-real` | `tests/runtime/uispec-real-llm.mjs` | **浏览器路径全场景回归**(complex-demo S1–S10:委派/规范/精修/调序/属性/新建/删除/容器/错误恢复/开放指令;Playwright 驱动 dev server 页面,含 UI 交互 + 渲染层) |
| `npm run test:draft-real` | `tests/runtime/draft-real-llm.ts` | 大 JSON 分块写(draft_write/draft_commit) |
| `npm run test:trace-real` | `tests/runtime/trace-real-llm.ts` | 结构化追踪 TraceSpan |
| `npm run test:maliang-real` | `tests/runtime/maliang-real-llm.ts` | 马良模型场景 |

`tests/runtime/*-real-llm.ts` 系列(headless 直连 dist)与 uispec(浏览器 + dev server)互补:前者快、无 UI 因素;后者真实但慢(全套 ~40min)。

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

**基线对比法**:改提示词/工具描述/编排逻辑后,重跑同场景号,对比报告 json 的 `usage.prompt` 与 `toolCount` 两个硬数字 + 断言通过率。真模型输出有波动,单次 ±10% 内视为噪声;连续两轮同方向变化才算真信号。

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
