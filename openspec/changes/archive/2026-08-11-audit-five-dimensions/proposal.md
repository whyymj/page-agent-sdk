# audit-five-dimensions — SDK 五维审计(第二轮)

## Why

audit-sdk-integrity(基线 2.38.0)二审 §11.5 识别出 D/E/C/P/A/T 六专项之外的五个审查盲区。P0×1+P1×27 已在 2.38.2→2.41.0 清零,本轮补审五维:

| 维度 | 覆盖 |
|---|---|
| **CA 并发原子性** | maxParallelTools>1 同轮并发工具隔离 / 同轮连续写锁交互 / abort 在途工具取消语义 / 批量 patches 原子回滚边界 |
| **SE 安全纵深** | 沙箱逃逸定级论证 / JSONPath 注入(`__proto__`/`constructor` 等)/ DOMPurify 配置完整性 / 可观测层生产泄漏 / onAudit 脱敏 / proxyLlm 泄露路径 |
| **VM 版本与迁移** | setData 换 schema 后旧快照兼容 / 持久化数据跨版本 hydrate / applySnapshot 版本号机制缺失 / 旧结构归一化系统性 |
| **RE 资源长期累积** | 长会话(>100 轮)内存增长 / hook 监听器累积 / vfs 引用保护收敛性 / watch·timer·Worker·blob URL 清理 |
| **CO 配置健壮性** | 非法配置 fail-fast(N3 种子)/ capabilities 组合矩阵 / preset 与显式 options 优先级 |

## How

5 路并行审计代理(每维一路,只读),各产出 `audit-<DIM>.md`(findings 带 file:line 证据 + 排查无问题清单);主审汇总为 `audit-report.md`,定级口径沿用上轮(P0 安全/损坏/永挂无自救 → P3 改进建议)。已修复项(2.38.2-2.42.0)不重复报告,改为验证「修复完整性」。

## 产出

- `audit-CA.md` / `audit-SE.md` / `audit-VM.md` / `audit-RE.md` / `audit-CO.md`
- `audit-report.md`(汇总 + 修复批次建议)
- P0/P1 → 修复 change;P2/P3 → 登记 `deferred.md`
