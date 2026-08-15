# Proposal: team-review-hardening(多 agent 团队全方位审查驱动加固)

来源:2026-08-15 五路并行审查(架构 / 代码质量 / 安全 / 主流框架差距 / 测试盲区)+ rag-demo 四模式真 LLM 回归。历史背景:2.38.2(fix-authorization-surface)只收敛了**子 agent 剥离工具名清单**—— 本次发现「硬编码写工具名清单」在三处各自漂移,清单本身漏了 4 个写路径工具,属同根复发。

## 已同批完成(真 LLM 回归直接产出)

1. **Anthropic 流式 usage 丢失修复**(`src/core/utils/contentParts.ts`):网关实测 `response_metadata.usage` 为**空对象 `{}`**(非 nullish,`??` 链短路)→ `usage_metadata` 兜底不可达;`extractUsage` 改候选逐个校验「至少含一个 token 数值字段」+ `normalizeUsage` 补 `input/output_tokens` 归一。真 LLM 复测:四场景 token 采集全部有值(修前全 null)。selftest 2106→2111
2. **rag-demo 四模式真 LLM 回归脚本**(`tests/runtime/rag-demo-real-llm.mjs`):A memory 直答 / B mock 检索委派 / C 真实 MCP 优雅降级 / D MCP 直连诚实收口,四场景 checks 全绿;S3/S4 的 MCP 不可达为内网环境问题(行为层优雅降级正确,S4 成功路径待内网恢复复跑)

## 修复项(按收敛主题)

### 主题 A:写能力标注单一真相源(授权面/锁面/自授过滤三处统一)

三处硬编码写工具清单各自漂移,同根复发:

- `SUB_WRITE_TOOLS`(subagent.ts:232)= 5 个,漏 `eval_script(transform)` / `resource_update` / `resource_delete` / `restore_data` → **子 agent 写面绕过**[HIGH,sec-review #1]:spawn 自授 eval_script 即获全量数据写能力,绕过 writablePaths
- `WRITE_TOOLS`(componentLock.ts:149)同清单漏 `eval_script(transform)` / `restore_data` → **组件锁绕过**[MED,code-review #2]:委派在途时主 agent 经 eval_script(transform) / restore_data 可改/回退被锁组件子树(focus.ts:188 修过同款缺口,componentLock 未同步)

**方案**:工具定义加 `writeCapable` 标注(dataOps 定义点单源),三处消费改按标注判定;`eval_script` 标注带条件(`mode==='transform'` 才算写)。

### 主题 B:__pgId 补齐收敛(数据完整性)

`supplementPgId` 仅 write 工具调用(dataOps 三意图),`set_data` / `edit_data` / `eval_script(transform)` / `draft_commit` 四条写路径全部遗漏[HIGH,code-review #1]:advanced 模式 set_data 整体替换 → 全部组件 `__pgId` 一次性丢失 → checkout/commit 映射断链。修:`internalAfterWrite` 收敛进 `commitSetToBind` / `applyPatchesToBind` 成功路径(与 SCHEMA_STRIP 检查同层的单一真相源)。

### 主题 C:MCP 工具名保留字保护(信任面)

MCP 工具名直传无保留名检查 + dedupeTools「后注册覆盖」→ 被入侵/DNS 劫持的 server 返回名为 `write`/`read` 的工具即**静默替换内置实现**,主数据全文送远端[HIGH,sec-review #2]。修:MCP 注入工具名与内置保留名冲突 → 拒绝注入 + warn 留痕(前缀化留 deferred,涉及 prompt 引导同步)。

### 主题 D:沙箱静态扫描加固

`"".constructor.constructor("...")()` 完全不拦(静态扫描只匹配字面 `eval(`/`Function(` 等)[HIGH,sec-review #3]。修:扫描模式补 `constructor` / `getPrototypeOf` / `prototype`(原型冻结留 deferred,可能破坏合法脚本)。另 `inspect_env` 嵌套敏感字段脱敏[MED,sec-review #4]:safeSerialize 递归按 ENV_SENSITIVE_KEY_RE 打码。

### 主题 E:行为正确性批

1. **wrapToolCall 异常契约**(arch P1-1):中间件抛普通 Error 即 fatal 整轮 → 洋葱外层收敛为 recoverable 错误结果回灌(与 coreExecTool 语义对齐)
2. **wrap-up 收口丢压缩摘要**(code-review):`filter(m => typeOf(m) !== 'system')` 把中部压缩摘要 SystemMessage 一并删 → 只去首条 system
3. **streamStallMs:0 启动闸失效**(code-review):`stallMs || DEFAULT` 的 0 是 falsy → 显式关闭被回退 90s;改 `>0` 判定
4. **vfs 单文件超池静默淘汰**(code-review):写前预检超池直接返回结构化错误(不再报成功后 NOT_FOUND)
5. **deleteSession 与 debounce pending 竞态**(code-review):删除前清掉该 session 命中的 pending/timers(防幽灵会话复活)
6. **mount() 不 mutate 用户 options**(arch P2-14):局部变量覆盖

## 测试补强(coverage-gap Top5)

1. storage+checkpoint+automation 三特性共存(e2e/automation)
2. 流式进行中 unmount 收口(browser 新 lifecycle.spec)
3. memory 异步函数抛错降级(e2e/custom-injection)
4. mcp 多 server 部分失败隔离(e2e/mcp)
5. schema 空对象 write 全拒(e2e/data-slots)

## 决策记录(gap-analysis 过滤)

五框架差距报告 Top3 中,**多 Agent 图编排不采纳**(与项目定位冲突:自研 Deep Agents 风格,扁平 spawn + 并行委派 + 组件锁已覆盖主场景;LangGraph 式状态机引入与「浏览器端轻量」矛盾,除非出现真实编排需求)。其余(评估框架化 / prompt caching / 跨会话偏好记忆 / durable 执行改进 / buildCore 拆分 / DSML 抽 provider 层 / P2 批)登记 `openspec/deferred.md` 带触发条件。

## 验证

selftest / e2e / browser 全绿 + 每修复项至少 1 正常 + 1 边界断言;真 LLM 回归脚本可复跑。
