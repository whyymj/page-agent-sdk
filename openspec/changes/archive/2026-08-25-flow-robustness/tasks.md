# Tasks:flow-robustness(全流程阻塞/挂起/崩溃面收口)

## Phase 0:P0×2(先行独立可发)

- [x] 1. per-tool 看门狗:runPool/coreExecTool 工具 Promise 包 race 超时(`toolTimeoutMs` 默认 120s,0=关),超时返回 recoverable 错误结果(含工具名/超时值),底层 promise 吞掉;子 agent 工具池同覆盖;**委派类工具(`use_*`/`spawn_*`)独立大档默认 10min**(对齐任务 6;120s 档会杀真 LLM 合法长委派,complex-ops S1 实测单次 >120s)
  - ✅ 2026-08-25 实施定案:豁免实现从「委派大档」简化为**标记制白名单** —— `toolWatchdog.ts` 打标(defineTool 创建时 / createChatSdk rebuildExtraTools 对 user+actions+skill 工厂 / rag retriever+loader 包装),`coreExecTool` 只对标内工具 race;内置/MCP/委派/conflict ask 全不在标内自然豁免(委派大档并入任务 6 子 agent 总时长,不再单独做档)。标记随工具对象引用走,buildChildTools 复用实例 → 子栈自动同覆盖
- [x] 2. core.send 补 abort→conflictManager.resolve('keep_external') 联动(与 core.stream 同款);conflictManager.set 可选 signal race
  - ✅ 实施补充:batch 入口同款注册(automation 无人值守 invoke 同患);set 的 abort 清 pending 按 **id 比对**(vue ref 深代理:存入对象读回是 reactive proxy,`===` 恒 false —— selftest 首跑抓出)
- [x] 3. selftest:永不 resolve 自定义工具(注入小超时)→ 错误结果 + 兄弟工具正常 + stop 语义不扩权;委派工具走大档(小超时下 use_* 不被杀);send 冲突挂起 + abort → 收口返回(sec-108,27 断言:标记面/纯函数 race/循环级超时回灌/未标豁免/0=关/兄弟不株连/conflictManager signal race 六态)
- [x] 4. e2e:headless send conflict×abort 场景(hang-feedback.mjs +2 场景:看门狗超时有界收口 + send 冲突×abort keep_external 收口;978→986)

## Phase 1:P1 挂起兜底(3-6)

- [x] 5. humanConfirm/approval 中间件默认 30s 无响应自动拒 + observable(与 send/batch 口径对齐;stream 自建 UI 兜底)
  - ✅ 2026-08-25 实施定案:方案升级为「**中间件恒默认 30s + 事件携带 `hold()` 由响应方接管**」—— 原 hasUi 分支方案会使 UI+send/batch 回归(该路径无 UI 应答但 hasUi=true 不武装);hold() 单机制全路径收敛:UI stream(内置 useChat 调 hold,等用户不限时,零变化)/ headless stream(30s)/ send·batch(30s,替换原事件级 approvalWatch,不再双发 observable)/ **streaming:false 裸 invoke(30s,顺手修掉原方案未覆盖的既有挂死黑洞)**。timeoutMs 口径统一:正值生效;Infinity/负数 = 关;~~0 同默认~~ → 0 显式关(中间件原语义)。sec-110 +14 断言(超时拒/hold 接管/用户先收口不误报/abort 不留痕/0=关)
- [x] 6. 子 agent 默认总时长 10min(可覆盖/0 关),超时 abort + recoverable 回灌
  - ✅ 落地点:subagent.ts 使用点 resolve(`undefined → 600_000`;机制沿用 P1-17b race+abort);错误文案补 timeoutMs 调整指引;`inspect().subagent.timeoutMs` 反射实际生效值(e2e main-sub-isolation +3 断言:默认/覆盖/0 关)
- [x] 7. storage:maybeEvict 内部吞错 + flush/ready race 5s(超时留痕放行)
  - ✅ maybeEvict 内部 catch → degraded 留痕(evictTimer void 与 flush 两调用点全保护);flush 逐项 race(`storage.flushTimeoutMs` 可调,默认 5000)超时项留 pending 交后续 flush/pagehide 重试 + **identity 守卫**(同 kind 新 save 接管槽位后,迟到落定不误删新值);backend 预置 memory(ready 窗口内读写降级不炸);createChatSdk ready race 5s —— **仅真超时留痕**(ready(false) 合法快速降级自带 degraded 事件,首版误判双留痕被 e2e events/deprecation 两场景抓回);preferences preload 同款 race。测试:sec-111 +8(闸门后端故障注入;`createSessionStoreWithBackend` @internal 注入口不进公共导出/d.ts)
- [x] 8. 会话切换入口包 try + observable(消半切换态与 unhandledRejection)
  - ✅ mountChatDialog onNewSession/onOpenSession 补 catch → `SESSION_SWITCH_FAILED` observable(API 侧仍正常 reject);switchSession 二次快照载入(:2112)包 try → 降级空会话 + `SESSION_SNAPSHOT_LOAD_FAILED`(内存态已清后不上抛半切换态)。测试面说明:故障注入需后端级 stub,e2e 无注入口(backend 类型固定);正常路径/未开 storage 抛错已有 storage.mjs 覆盖,防御 wrap 以代码审阅 + 全量回归兜底

## Phase 2:P1 崩溃/行为偏差(7-12)

- [x] 9. checkpoint save clone 兜底包 try(环 bind 跳过本轮快照 + warn);batch save 移入任务 try
  - ✅ 兜底落在 save 本体(两调用点 beforeModel 中间件/batch 循环全覆盖,免逐点包);返回 -1 哨兵(caller 均不消费返回值);**实施修正认知:纯对象环 structuredClone 原生支持(保留环结构)不触发兜底,真实故障形态 = reactive Proxy(structuredClone 抛 DataCloneError → JSON 兜底遇环再抛),sec-112 用 Proxy 注入复现**
- [x] 10. deepClone 环防御(replacer seen → 可诊断错误,指明环路径)
  - ✅ 实现改「catch 后单发探测」(happy path 零开销,不加写路径成本):DFS 带回溯(同引用不相交分支 = 合法 DAG 不误伤,仅祖先链重复算环),错误含 `$.a.b` 形态路径;数组下标 `$.list[0]` 形态(sec-112 A/B 段)
- [x] 11. tool_call id 兜底回写 AIMessage(照 DSML 路径 :949 同款)
  - ✅ ctxs 构建后 `calls.some(c=>!c.id)` 才回写(response.toolCalls 即 message.tool_calls 引用,索引对齐);e2e hang-feedback +3(stub 增 `id:false` 注入形态 + lastMessages 记录,断言第 2 次请求「tool_call.id ↔ tool_call_id」配对)
- [x] 12. transitional 门禁句尾问号豁免(与 completion/zero_tool 口径对齐)
  - ✅ gate 层 `/[?？]\s*$/`(transitional 与第 0 轮行动叙述两探测器同豁免);sec-112 D 段纯判定 + e2e instruction-adherence +2 场景(问句零回灌 calls=2 / 非问句对照回灌 calls=3)
- [x] 13. send 内 store.flush 错误源分流(不再误归因 LLM fatal 触发 automation 重跑)
  - ✅ send/batch 两处 flush 独立 try → `PERSIST_FLUSH_FAILED` observable 留痕放行(batch 任务不再误标失败);flush 经 P1#5 race 后本已难 reject,此为语义澄清 + 防御层
- [x] 14. send/batch 入口补 setProtectedRefs(extractVfsRefs)
  - ✅ 两入口同 stream 注册(注释标 P1#12);防跨轮 LRU 淘汰被引用 large_results 致 vfs_read 404;wiring 修复,tsc + 全量回归覆盖(无独立注入口,e2e 以 stream 路径既有 vfs 断言兜底)

## Phase 3:门禁与收尾

- [x] 15. deferred.md P2 残项登记(见 proposal「登记 deferred」清单)
  - ✅ 2026-08-25 登记为「flow-robustness 登记」表(11 项,各带触发条件);顺带把上下文组 #2(setProtectedRefs 仅 stream)改 🔁 send/batch 已修(任务 14)
- [x] 16. 四门禁全绿 + 计数同步;真 LLM complex-ops 复跑零回归
  - ✅ 四门禁:selftest 3130 / e2e 1000 / browser 118 / build+tsc+types+exports 全绿;计数同步 CLAUDE.md + README 中英
  - ✅ 真 LLM complex-ops(2026-08-25,环境已切 api.deepseek.com 直连 — modelverse 网关弃用):**S2/S3/S4/S6 全过(非委派链路零回归)**;S5 = vite ws 瞬断页面 reload 环境性失败(已知 real-llm-suite-env-instability,委派已启动即被 reload 杀);S1 custom_code非空 ✗ —— **worktree 挂 596206e(改动前)对照复跑同签名同败**(customs[]/委派发生✓)→ 定性为 flash 委派 code 落地质量方差(既有问题,thinking-taming/craft-notes 系列的对象),**非本 change 回归**;委派链路机械面(32-47 工具调用/子栈工具循环/usage 回传/无崩溃)两代代码均正常
- [x] 17. CHANGELOG(Fixed 分条)+ CLAUDE.md 挂起有界默认值表更新
  - ✅ Phase 1 Added 四条 + Phase 2 Fixed 六条;CLAUDE.md 挂起表补 approval·humanConfirm 30s(hold 接管)/子 agent 600s/storage flush·ready 5s 三项 + deepClone 环防御/transitional 问号豁免/tool_call id 回写/flush 分流/protectedRefs 各落位段
