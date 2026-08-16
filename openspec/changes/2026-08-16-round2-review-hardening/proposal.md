# Proposal: round2-review-hardening(第二轮三路审查修复批)

## Why

3.19.0 发布后组织第二轮三路审查(rv-recent 增量面 / rv-core 跨模块不变量 / rv-coverage 测试盲区),经逐条核实裁决:

- **22 条原始发现 → 9 条代码修复 + 4 条测试补强成立**,其余 9 条为误报(典型:rv-coverage 只查 `tests/` 漏 selftest 目录 `src/core/__tests__/`,7 条被 sec-26/78/79/80 既有覆盖否决)或设计语义待裁决(3 条转 deferred)
- rv-core 报告经抽查 3/3 坐实(file:line + 失败时序全部对上),质量可信
- 1 条为 3.19 稳定性小修自引入的时序回归(autoTitle 标题写序)——审查闭环抓到自己

## What Changes

### A. 代码修复(9)

| # | 严重度 | 来源 | 问题 | 修法 |
|---|---|---|---|---|
| A1 | MED | rv-recent F1( CONFIRMED) | autoTitle `persistUpdateTitle`(fire-and-forget,经 storage per-key 串行链 ≥1 微任务)后立即 `refreshSessions`(scan 直读)→ 会话列表显示旧标题(3.19 稳定性修复自引入) | autoTitle 路径改 await updateTitle(带 catch)再 refreshSessions |
| A2 | MED | rv-core F1(CONFIRMED) | 主栈工具 config 只含 `__pgSubagentCall` 不含 `__pgDataScope` → 永远走 ambient `activeScope` 闭包回退;子 agent wrapWithScope enter/exit 窗口内并发主工具读到子 scope → autoLock 静默放行/主 read 误判 isMain(3.7 同类残留) | 主栈工具派发处 config 兜底注入 `__pgDataScope: ''`(子栈 token 优先不受影响) |
| A3 | MED | rv-core F2(CONFIRMED) | `summarizeLargeText` 只挂 read;`query_data`(simple 默认可用)/`get_data` 原样回灌 → codeAsset 场景大 code 确定性击穿 `<code Nkb>` 摘要机制 | query/get 回灌前统一过 summarizeLargeText(同 isMain 语义) |
| A4 | LOW-MED | rv-core F3(CONFIRMED) | read 在路径校验(PATH_DENIED/UNSAFE)**前**就 setBaseline → 失败读也刷新乐观锁基线 → 可构造「宿主改动被静默覆盖」序列 | setBaseline 下移到校验通过后(get_data 已是此序) |
| A5 | LOW | rv-core F5(CONFIRMED) | resetSession 同步无闸:在途 send 的 invoke 被 abort 仍返 partial → push 进**新会话**并落盘 | send 在 invoke resolve 后校验 signal.aborted / sessionId 未变再 push |
| A6 | LOW | rv-core F6(CONFIRMED) | runSerial 排队操作在 release 后照跑(LLM 照烧);trackActive `{once:true}` listener 永不清理 | core.send 入口 refCount 守卫;untrack 时 removeEventListener |
| A7 | LOW | rv-recent F4(QUESTION→采纳) | MessageSteps 展开态模块级单例跨实例互斥(双对话框 A 展开 B 再展开收起 A) | toggle 只 clear 本实例 uid 前缀的 key(对话框内单展开保留,跨实例互不干扰) |
| A8 | LOW | rv-recent F3(QUESTION→采纳) | cacheControl 注释归因错(实际靠 create 调用内二次 spread 恢复,非「JSON 丢 undefined」),行为钉死 1.5.4 spread 顺序 | 注释修正机制 + 标注已验版本;基线 cacheRead 指标兜底 |
| A9 | LOW | rv-recent F2(QUESTION→采纳缩水) | persistSave 吞错后非 debug 全静默,集成方零感知 | catch 里补 debugLogs 留痕(observable,不动 onEvent API 面) |

### B. 测试补强(4,rv-coverage 核实成立项)

| # | 层 | 缺口 |
|---|---|---|
| B1 | e2e custom-injection | wrapToolCall 用户中间件 throw → 整轮存活 + recoverable 回灌(sec-80 E1 只测了辅助纯函数) |
| B2 | selftest | streamStallMs:0 启动闸真测试(替换 sec-80 E3 的 `assert(true)` 占位) |
| B3 | e2e conflict | resolveConflict 顶层 overwrite/restore 分支(现只有 keep_external;selftest sec-26 语义已锁,补顶层走通) |
| B4 | selftest | normalizeBaseUrl 纯函数(导出 API 零测试) |

### C. 转 deferred(3,QUESTION 设计语义待裁决)

- rv-core F4:组件锁 none 分支(0/≥2 命中)同轮并发写 code 无检测缝(弱锁设计)
- rv-core F7:系统段 25% 预算 PIN_SEGMENT_NAMES 不含 focus/resourcesPin(两套 pin 口径)
- rv-core F8:spawn_agent 自授 writablePaths 绕过组件锁(装配期拒交集 vs 同锁)

## Impact

- 代码面:dataOps.ts(scope/摘要/基线序)/ createChatSdk.ts(autoTitle 序/send 守卫)/ subagent 或 createAgent(主栈 scope token)/ MessageSteps.vue / constructLlm 注释 / storage e2e
- 风险:A2/A3/A4 触及数据槽核心路径,须 selftest 全量 + e2e 全量 + 对应 browser;A5/A6 涉 send 生命周期,e2e 走查
- 默认行为:A1-A9 均为缺陷修复或不可见收敛,无 API 变化
