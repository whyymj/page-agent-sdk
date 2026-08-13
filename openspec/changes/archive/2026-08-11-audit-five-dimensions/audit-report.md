# SDK 五维审计(第二轮)—— 主审汇总报告

> 审计日:2026-08-12。基线:`develop`(2.43.0)。5 路并行只读审计(CA/SE/VM/RE/CO),各产出 `audit-<DIM>.md`(findings 带 file:line 证据 + 排查无问题清单);本报告为主审核实 + 汇总。
>
> 定级口径沿用上轮(audit-sdk-integrity):P0=安全/数据损坏/永挂无自救;P1=功能缺陷/数据风险/可感退化;P2=边缘/改进;P3=卫生。已修复项(2.38.2-2.42.0)改为「修复完整性验证」,不重复报告。

## 一、总览

| 维度 | P0 | P1 | P2 | P3 | 子审报告 |
|---|---|---|---|---|---|
| CA 并发原子性 | 0 | 1 | 2 | 1 | [audit-CA.md](./audit-CA.md) |
| SE 安全纵深 | 0 | **1** | 8 | 3 | [audit-SE.md](./audit-SE.md) |
| VM 版本与迁移 | 0 | **1** | 6 | 3 | [audit-VM.md](./audit-VM.md) |
| RE 资源长期累积 | 0 | 0 | 2 | 3 | [audit-RE.md](./audit-RE.md) |
| CO 配置健壮性 | 0 | **1** | 7 | 6 | [audit-CO.md](./audit-CO.md) |
| **合计** | **0** | **4** | **25** | **16** | — |

**主审对子审定级的调整**(核实 file:line + 触发条件后):
- SE 子审标题列 P1×3,但 P1-2(CodePreview sandbox)/P1-3(proxyLlm direct)正文自降 P2 —— 主审采纳正文定级,SE 真 P1×1(glob),余入 P2。
- VM-F1(无版本号机制)子审定 P1 —— 主审**降 P2**(系统性根因,但无即时损坏;各中间件已有 ad-hoc 归一化,演进时才暴露;属架构改进非缺陷)。
- CO-P1-2(preset 对象整体替换)子审定 P1 —— 主审**降 P2**(JS spread 语言语义,文档警示可解,非 SDK 代码缺陷)。

**核实后真 P1×4**(见 §二),无 P0。

## 二、P1 主审核实(逐条)

### ✅ P1-1(CA):同轮并发写(`maxParallelTools>1`)乐观锁失效,后写覆盖前写

- **位置**:`src/core/tools/dataOps.ts:348-377`(handleConflict)+ 各 write 工具
- **核实**:`maxParallelTools>1` 时,同轮并发的两个写工具都在 `await handleConflict` 让出前同步取过 `effHash = getBaseline()`(读到同一旧基线),均通过乐观锁 → 各自 `commitSetToBind` 串行写入 → **后写覆盖前写,前写静默丢失,无 VERSION_CONFLICT 回灌**。与 deferred N1(已收口)不同:N1 修串行下连环误判冲突,本项是并发下根本没互锁,N1 的 per-scope 基线修复对此无效。
- **定级**:P1(并发下数据静默丢失)。**逃生舱**:默认 `maxParallelTools=1`(串行)完全规避;触发需集成方显式开 `maxParallelTools>1` + LLM 同轮并发起 2+ 写。
- **修复**:短期在 dataOps.ts:278-281 注释补「并发写不互锁」+ `maxParallelTools>1` 时 usageHints 提示 LLM「同轮勿并发写」;中期 `commitSetToBind` 入口加 final hash 校验(根因修复)。

### ✅ P1-2(SE):permissions glob 单星跨段匹配,deny 规则形同虚设

- **位置**:`src/core/harness/permissions.ts:34-52`(globToRegex)
- **核实**:globToRegex 单星映射 `[^/]*`(以 `/` 为段分隔),但 permissions 的 scope 字符串以 `.` 为段分隔(extractScopes 把 jsonPath 当 scope)—— **语义错位**。集成方按 glob 惯例写 `deny:['secrets.*']` 期望禁 secrets 子项,实际 `secrets.key`(深层)不匹配 deny → 走默认 allow → **放行**。整个 permissions 对深层路径失效,集成方主动收紧 = 假安全。
- **定级**:P1(核心安全机制语义错位)。逃生舱:permissions 默认不启用(未传则全开放,无承诺收紧);触发需集成方主动配 permissions。
- **修复**:`globToRegex` 单星映射从 `[^/]*` 改 `[^.]*`(对齐 scope 的 `.` 分隔),一行;补 selftest「单星 × 多段 scope」覆盖(当前零覆盖)。deferred 安全 #3 从 P3 升级。

### ✅ P1-3(VM):`WorkingMemory.restore` 对缺 `locatedPaths` 字段抛 TypeError,中断整个会话恢复

- **位置**:`src/core/harness/workingMemory.ts:106-111`
- **核实**:**子审 node 实证**:`wm = { lastHashes: {a:'1'} }` → restore 抛 `Cannot read properties of undefined (reading 'slice')`;`wm = {}` 同抛。applySnapshot 守卫只判 truthy(`{}` 通过),restore 抛 → 整个 core.applySnapshot 栈炸 → resolveAndLoad/switchSession 拒绝载入 → **会话恢复失败,messages/vfs/todos/mission 也未灌入**。其他 restore(setMission/ensureIds/focus 归一化)均有字段 fallback,唯 workingMemory 漏。
- **定级**:P1(会话恢复中断,实证)。触发条件偏极端(当前 SDK 不主动写 `{}`;但未来版本写显式空标记 / 持久化损坏 / 跨版本迁移 partial object / WebStorage JSON.parse 失败回退边界 都会触发),但后果严重 + 一行修复。
- **修复**:`restore` 改 `Array.isArray(wm?.locatedPaths) ? wm.locatedPaths.slice(0, MAX_ENTRIES) : []`(同款 lastHashes);或 applySnapshot 单 kind 失败不阻塞(每条 try/catch + 留痕)。

### ✅ P1-4(CO):`maxToolRounds: 0` / 负数 → agent 完全不调 LLM,静默返回兜底文案

- **位置**:`src/core/harness/createAgent.ts:264,645,808`
- **核实**:主循环 `while ((rounds < maxToolRounds || ...) && ...)`;`rounds=0, maxToolRounds=0` → `0<0=false` → **while 不进,LLM 永不被调用**,跳过 wrap-up 返回固定兜底文案 `'我已完成本轮能做的操作...'`。集成方收到固定字符串,无 warn/error/异常。`maxIterations=max(0*3,30)=30` 不保护(while 条件已 false)。集成方可能合理地按字面理解 `0=禁用工具循环让 agent 只文本回复`,实际连文本回复都没。
- **定级**:P1(agent 完全瘫痪,静默无 fail-fast)。deferred N3 种子原标 P3,实证升级。
- **修复**:`createAgent`/`createChatSdk` 装配期校验 maxToolRounds 为正整数,`<=0` warn + clamp 到 1(至少首轮 LLM 调用发生)。

## 三、已修复完整性验证(2.38.2-2.43.0)

**5 维一致结论:修复全部落地,无回归。** 重点核实:

- **CA**:N1 per-scope 基线(串行下契约成立)/ core 级串行闸+activeControllers / resetSession abortAllActive+收口冲突 / abort 保留 partial / spawn_agents allSettled / 子 timeoutMs —— 全 ✅;残留:并发边界(CA-P1/P2,新边界非回归)。
- **SE**:fix-authorization-surface(装配期源头 filter + path guard)/ fix-write-safety-bypass(DOMPurify + CodePreview sandbox)/ harden-eval-sandbox(lockSandboxGlobal defineProperty)/ placeholder-protected(占位符读写边界)/ fix-subagent-tooling —— 全 ✅;残留:P1-2 glob 语义(独立项,非回归)。
- **VM**:focus 单/多归一化 / todos 旧 hydrate 补 id / mission 字段 fallback / restore_data 跨 schema 守卫 / WebStorage JSON.parse 降级 / vfs hydrate _dirty / checkpoint restore 清增量缓存 —— 全 ✅;残留:F2 workingMemory(唯一漏网 restore)+ F1 版本号(系统性)。
- **RE**:markdown 节流 / 压缩异步化 / trim GC + vfs 引用保护 + OOM 硬兜底 / activeControllers / unmount 收口链 / Worker terminate + blob revoke —— 全 ✅;**RE 维度 P0×0 P1×0,资源管理整体非常健壮**。
- **CO**:CAPABILITIES requires 矩阵 / modelCaps 最小窗口 throw / SubagentConfig.id 校验 / focus+schema 运行时 fail-fast / options.id 缺失 warn —— 全 ✅;残留:数值/对象配置边界值 warn 缺失(P2/P3)。

## 四、P2/P3 处理(登记 deferred,不逐条展开)

P2×25 / P3×16,**建议按维度分组登记 `openspec/deferred.md`**(沿用上轮「分组 + 触发条件」约定),不逐条立项。分组:

- **SE 加固组**(P2×8):DOMPurify rel=noopener / inspect_env location.search 脱敏 / eval_script jsonPath 显式 PATH_UNSAFE / query_data isUnsafePath / lockSandboxGlobal 失败留痕 / DebugDrawer redact / CodePreview sandbox 收紧 / proxyLlm direct 默认反转
- **VM 迁移组**(P2×6,含降级的 F1):版本号机制(F1,架构)/ checkpoint 跨 schema 校验(F3)/ Todo id 稳定标识(F4)/ capabilities 关闭 emit restore_skipped(F5)/ VfsFile 字段归一化(F6)/ AgentMessage 字段归一化(F7)
- **CO fail-fast 组**(P2×7,含降级的 preset):storage 未知 backend warn / allowedTools 错名 warn / temperature 范围校验 / maxDepth:0 语义 / writablePaths:[] 语义 / capabilities 矛盾组合 warn 对齐 / preset 对象替换文档警示
- **CA 并发组**(P2×2):activeScope 并发错乱(AsyncLocalStorage/per-call token)/ createSubagentsMiddleware 闭包单变量并发(M3 同型注释)
- **RE fire-and-forget 组**(P2×2):autoTitle LLM 无 unmount 守卫 / persistRuntime void store.save 无 .catch(与 deferred 挂起面 #4 合并)
- **P3×16**:各维卫生项(详见各 audit-<DIM>.md)

## 五、修复批次建议

**批次 1(P1×4,小改一行级,建议立即修)**:
1. SE-P1-2 glob `[^/]*`→`[^.]*` + selftest(安全,一行 + 测试)
2. VM-P1-3 workingMemory.restore 字段守卫 + selftest(会话恢复,一行 + 测试)
3. CO-P1-4 maxToolRounds 装配期校验 + clamp + e2e(配置,一行 + 测试)
4. CA-P1-1 并发写:短期注释 + usageHints 提示(根因 final hash 校验留中期)

**批次 2(P2/P3 登记 deferred)**:按 §四 分组登记,触发再做。

**不动项**:VM-F1(版本号,架构改进,演进时做)、CO-P1-2 降级后(preset,文档警示)。

## 六、结论

- **基线健康**:无 P0(关键防护就位:Worker 外发全锁、原型污染深拦、DOMPurify 主向量已堵、子 agent 装配期源头 filter、资源管理整体健壮 RE-P0/P1=0)。
- **P1×4 均可一行级修复**(glob / restore 守卫 / maxToolRounds 校验 / 并发写注释),建议批次 1 立即修。
- **P2×25 / P3×16** 登记 deferred(分组 + 触发条件),不占进行中心智。
- **已修复完整性**:5 维一致确认 2.38.2-2.43.0 修复全落地,无回归。

> 各维明细见 `audit-CA.md` / `audit-SE.md` / `audit-VM.md` / `audit-RE.md` / `audit-CO.md`。
