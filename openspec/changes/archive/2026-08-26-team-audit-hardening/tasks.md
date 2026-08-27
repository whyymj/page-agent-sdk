# Tasks:team-audit-hardening(六路团队审查 P1 收口)

## Phase 0:授权与隐私(P1#1/#2,先行独立可发)

- [x] 1. spawn_agent/spawn_agents `tools` 自授剥离修活:spawnOne(:566)按名解析到工具对象再判定(`opts.allTools` 池建 name→tool Map,未知名保留),`isWriteCapableTool` 收对象;`eval_script` 等条件写工具同通道覆盖
- [x] 2. e2e:authorization-surface.mjs 自授用例补 `data:`(主池真有 write)+ 子 LLM 脚本加 write 调用,断言子调 write 报「工具不存在」(堵双重空洞);对照组 writablePaths 路径零回归断言
- [x] 3. llmCache 修复:useContextManager 加 epoch 代数(fireBackgroundLlmSummary 捕获当次 epoch,.then 不匹配丢弃)+ `reset()`(bump epoch + 清 llmCache;llmInFlight 交 .finally 自然回落);createSummarizationMiddleware 控制面暴露 reset();createChatSdk resetSession(:2072 附近)/switchSession(:2032 附近)各补调用
- [x] 4. selftest:两会话压缩互不污染(A 摘要不进 B system)+ 飞行中切换丢弃(epoch)+ B 自身后台摘要不再被吞(llmInFlight 伴生缺陷)

## Phase 1:数据映射链(P1#3 + P2#8)

- [x] 5. eval_script transform 整体替换补 internalAfterWrite:dataOps.ts:1342-1377 分支内 restoreInPlace/safeMerge 前捕 beforeBind(`internalAfterWrite ? deepClone(bindRef) : null`),markDataDirty 后补 `internalAfterWrite?.(bindRef, beforeBind)`(照 commitSetToBind :507/:546 模式)
- [x] 6. selftest:eval transform 整体替换 __pgId 保活(已有 id 回填 + 新增补齐;Worker 不可用时 shim/静态断言,参考 sec-21);write(set) 对照组
- [x] 7. data_change 失败抑制:createSdkEventMiddleware 数据写分支 emit 前判 content `ERROR:` 前缀不发(status 恒 'done' 单查无效);委派分支既有 done 检查统一口径
- [x] 8. e2e:events.mjs 补失败写(SCHEMA_INVALID / PATH_DENIED)不发 data_change 两组;既有 4 组成功路径 + dryRun 零回归

## Phase 2:会话与流程(P1#4/#5/#7 + P2#9)

- [x] 9. resolveAndLoad 吞错:load/listSessions(:2451/:2457/:2461)各包 try/catch,失败降级空会话 + `SESSION_RESTORE_FAILED` observable(与 SESSION_SNAPSHOT_LOAD_FAILED 同口径);storage.ts load 的 meta touch `backend.set` 单独吞错(lastAccessed 刷新失败不连坐快照读取)
- [x] 10. e2e:storage.mjs 补坏后端场景 —— badBackend 的 get/scan 抛错(修前 get/scan 恒不抛掩盖缺口)→ mount 成功 + observable + 降级空会话
- [x] 11. focus 子继承改生效快照:FocusController 接口加 `getActiveFocuses(): Focus[]`(:84-111 声明 + 复用 activeFocuses 闭包);createChatSdk L1363/L1425 委派接线改用;**其余 getFocuses 消费面(persist/inspect/宿主 API/工具回显)保持实时态不动**;subagent.ts:158/724 语义注释同步
- [x] 12. selftest:子继承读生效快照(host mid-invoke 变更主/子写面一致,正反两方向;agent 来源变更与现状等价零回归)
- [x] 13. streaming:false 走 core.stream:mountChatDialog fetchResponse 改 `core.stream(msgs, () => {}, signal)`(自带 trackActive/protectedRefs/abortConflict),删手工 abortConflict 复制
- [x] 14. e2e/browser:streaming:false 路径 unmount 后无幽灵流(trackActive 注册表生效)+ 编程式 switchSession 后旧流不写新会话 messages
- [x] 15. maxBytesPerSession 联动:storage.ts:381 改 `config.maxBytesPerSession ?? (config.maxBytes === Infinity ? Infinity : DEFAULT_MAX_BYTES_PER_SESSION)`;quota 事件接入 debugLogs 留痕(去静默);usage-guide §6.6 中英补 maxBytesPerSession 说明
- [x] 16. e2e:storage.mjs 补 maxBytes:Infinity + 自定义后端超 10MB 会话持久化正常(kind 不拒写)+ 非 Infinity 显式 maxBytesPerSession 优先不变

## Phase 3:子 agent 超时竞态(P1#6,独立可后置 —— 锁生命周期重构)

- [x] 17. 组件锁 release 推迟:use_<id> 工具 fn 的 lockRelease 从 finally 改挂 `streamP.finally`(超时错误仍立即回灌保响应性;重委派撞 COMPONENT_BUSY 语义自洽);防 streamP 永挂兜底 race(wind-down 各段有界,看门狗 120s 上限)
- [x] 18. per-组件委派世代号:共享 vfsStore 命名空间加 `Map<pgId, gen>`(同 __pgLastCheckout 先例),codeAsset beforeAgent gen++,afterAgent commit 前查世代旧代跳过(顺带消除误报 keep_external + 并入观察层 warn);exitDataScope/baselines 泄漏随 release 推迟顺带修复
- [x] 19. selftest:超时 + 重委派同组件时序 —— 旧代 commit 跳过、新子 agent 最终成果落地(data.code = 最终值非中间态)、无误报 keep_external(照核实员真模块复现形态构造)
- [x] 20. 真 LLM:complex-ops S5(委派链路)复跑零回归;重点观察超时错误回灌后 COMPONENT_BUSY 重试节奏

## Phase 4:收尾

- [x] 21. deferred.md 登记「2026-08-26 team-audit-hardening 登记」段(见 proposal 清单,按域分组各带触发条件);销账 4 条过时项(数据写链 #1/#2 已修实测;循环/终止面 #2/#3 已修)
- [x] 22. CHANGELOG(Fixed 分条)+ CLAUDE.md 对应契约段更新(授权面不变量 / summarization reset 通道 / internalAfterWrite 收敛点补全 / invoke-freeze 子继承口径)
- [x] 23. 四门禁全绿 + exports/types/alignment/size/pack;计数同步 CLAUDE.md + README 中英
