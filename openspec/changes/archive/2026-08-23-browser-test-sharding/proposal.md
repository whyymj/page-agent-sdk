# Proposal: browser-test-sharding（browser E2E 分片提速）

> 状态：**已实施（2026-08-24，workers:4 全量 1.4min 达标）**。复审记录：2026-08-23 团队复审（fullyParallel 不开、预启动改明令禁止、<2min 门禁分档）。优先级 P3（工程效能）。目标仓库：zhuanti-agent。
> 驱动：browser 套件已到 104 项 / ~4.2min（单 worker 串行），「每次改动必跑」的纪律正被时长侵蚀；继续涨用例会更慢。

## Why（现状核实，复审补强）

- `playwright.config.ts` 单 worker 串行（`workers:1`、`fullyParallel:false`、本地 `retries:0` 无兜底）；spec 已按 demo 天然分片，**分片边界现成**；全目录无 describe.serial/beforeAll 共享态，mockLlm 的 script/calls 是 per-page（page.route 拦截）→ 并行安全前提成立（复审逐项证实，无高危名单）。
- 瓶颈主体是**逐 test 页面加载 + ReAct 交互等待**（per-test context + waitForFunction 轮询），文件级并行能成比例压缩；但 workers:2 理论下界 ≈2.2-2.5min，**<2min 必须 workers:4 才可达**——门禁须分档。
- 已知时序敏感用例（delays 窗口型，本地零重试）：queue 全部 3 条、icons「HTML 图标净化」、page-demo「流式占位」——并行 CPU 争抢的 flake 观察名单（套件本就有 6 处 test.setTimeout(150s) 高负载前科）。

## What Changes

1. `workers` 提到 2 验证稳定，再上 4；`fullyParallel` **维持 false 不动**（`workers:N` 下 spec 文件即调度分片、文件内保序，行为与串行一致，零新增语义；16 文件 >> workers 数，开它收益趋零、争抢峰值翻倍）。
2. webServer 维持 Playwright 托管（不在则拉起、跑完即收，strictPort 已防端口竞态）；**禁止引入「预启动 dev server + 复用」依赖**（遗留旧 server optimizeDeps 失配 → 页面强制 reload → 在途用例假性失败，前科见 CLAUDE.md §3.5）；CI 侧 `reuseExistingServer:!CI` 已禁复用。已知残余风险：冷 .vite 缓存（重装依赖/切分支后首跑）时 vite 运行时发现新依赖会广播 full-reload，多 worker 下可能连带强刷邻 worker 页面——先重跑一次预热即可，**不改 vite.config.ts**（超出本 change 可动面）。
3. 红线：不动 src/ 与 vite.config.ts；失败可单独复跑（`--grep` 按 spec）；观察名单用例如现 flake，优先加大 delays 窗口而非上 retries。

## 验收门禁

- workers:2 全量绿且 <2.5min；workers:4 全量绿且 <2min（达标必须走 4，2 只是稳定过渡档）。
- 观察名单用例连跑 3 次零 flake；抽 3 个 spec `--grep` 单跑复跑绿。
- 依赖变更后首跑如遇批量 reload 型失败，重启 dev server 预热后重跑一次，不判回归。
