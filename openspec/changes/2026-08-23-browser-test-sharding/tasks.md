# Tasks: browser-test-sharding

- [x] playwright.config.ts:`workers: 4`(经 2 验证稳定后直升);`fullyParallel` 保持 false 不动
- [x] 确认 webServer 单实例多 worker 无端口竞态(strictPort 已保证);**不做预启动**,Playwright 托管生命周期不变;CI 禁复用遗留 server(!CI 已满足,补注释说明)
- [x] workers:2 全量绿 1.6min(<2.5min ✓);workers:4 全量绿 **1.4min(<2min ✓,104 项零失败)**;观察名单(queue 全部 / icons 净化 / page-demo 流式占位)×3 复跑零 flake
- [x] CLAUDE.md 测试流程补:并行档位与时长预期、单跑复跑命令(--grep)、「依赖变更后首跑遇 reload 型失败先重启 dev server 预热」提示
- 备注:实施日机器负载 12+/10 核(editor dev server 等外部进程),曾致单 worker 串行整跑拉长至 20min 且 2 项环境性噪声 —— 分片后同负载 1.4-1.6min,进一步佐证并行档抗负载性
