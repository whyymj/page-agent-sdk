# Tasks:server-companion(Node 同构)

## Phase 0:node 真跑证明(独立可发)

- [ ] 1. 〔勘察〕DOM 引用面审计:grep core 层 window/document 直接引用;命中处 typeof 守卫降级(前科:render-check node 防线 / 3.22.1)
- [ ] 2. 〔勘察〕storage REST 后端 node headers 注入面;MCP stdio transport node 可用性标注(optional)
- [ ] 3. 冒烟脚本 `examples/node/headless-node.mjs`:真 LLM 构造(双协议)+ 完整 ReAct(read→write→restore 断言)+ memory 后端
- [ ] 4. `.env` 无 key 自动 skip(与既有套件同口径);脚本进 package.json script
- [ ] 5. 文档:usage-guide 中英「服务端运行」章节(headless node 接入 + 依赖解析说明)
- [ ] 6. 门禁:npm test + build + test:e2e 零回归;README 中英场景段补「服务端/定时任务」

## Phase 1:无人值守形态

- [ ] 7. checklist 文档化:approval 自动拒/conflictPolicy/toolTimeoutMs/stream 阈值/afterRound 落盘/重试 —— 全部既有旋钮组合,零新配置(D1 决策留痕)
- [ ] 8. 冒烟后缺口裁决:每项标「已覆盖旋钮」或 deferred 登记(跨进程重启恢复预期 deferred,带触发条件)
- [ ] 9. e2e:无人值守组合配置冒烟(approval 自动拒 + conflictPolicy overwrite 下 batch 完整走通)

## Phase 2(可选,D2 裁决后可能关闭)

- [ ] 10. D2 裁决记录:headless 在 node 零障碍 → 关闭并留痕;否则立 node 子路径评估(新构建面/types/size 门禁成本 vs 收益)
- [ ] 11. CHANGELOG + 计数同步 CLAUDE.md + README 中英
