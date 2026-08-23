# Tasks: browser-test-sharding

- [ ] playwright.config.ts：`workers: 2`（验证稳定后升 4）；`fullyParallel` 保持 false 不动
- [ ] 确认 webServer 单实例多 worker 无端口竞态（strictPort 已保证）；**不做预启动**，Playwright 托管生命周期不变；CI 禁复用遗留 server（!CI 已满足，补注释说明）
- [ ] workers:2 全量绿 <2.5min；升 4 后全量绿 <2min；观察名单（queue 全部 / icons 净化 / page-demo 流式占位）×3 复跑零 flake
- [ ] CLAUDE.md 测试流程补：并行档位与时长预期、单跑复跑命令（--grep）、「依赖变更后首跑遇 reload 型失败先重启 dev server 预热」提示
