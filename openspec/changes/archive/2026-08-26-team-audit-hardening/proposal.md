# Proposal: team-audit-hardening(六路团队审查 P1 收口)

> 状态:**✅ 已实施并随 4.5.0 发布(2026-08-27,全 23 任务收口;红测先行,每项先以缺陷形态失败后转绿)**。优先级 **P1×7 + P2×2**(主/子/持久化/上下文/规划门禁/数据写链六路并行审查 + 二轮对抗核实;**8 条疑似 P1 中 7 条 CONFIRMED、1 条 REFUTED**,核实含 tsx/端到端复现)。目标仓库:zhuanti-agent。
> 驱动:用户要求「组织团队梳理流程、功能,发现潜在的问题;多轮检查,确保主要功能流程的畅通」(2026-08-26)。
> 审查总结论:**六大主流程全部畅通**(对话主循环/数据写链/子 agent 编排/持久化恢复/上下文跨压缩/规划门禁),健壮性收敛度高;风险集中在**授权面**(spawn 自授)、**隐私面**(摘要缓存跨会话)、**映射面**(__pgId/data_change)与**恢复面**(load 裸 await)。

## P1(七项,均经对抗核实)

### 1. spawn_agent `tools` 自授写工具剥离失效(授权不变量破绽,端到端复现实证)
- **位置**:`src/core/harness/subagent.ts:566`(filter 对**工具名字符串**调 `isWriteCapableTool` —— 其实现对 string 形态恒返 false(:250-259),filter 纯 no-op)+ `buildChildTools`(:234-243)不滤写工具 + `:364-370` 仅 `writablePaths?.length` 为真才剥。
- **失败场景**:`spawn_agent({ prompt, tools: ['write'] })` → 子 agent 拿到主池**裸 write**(无 path guard),`bind.secret: 'orig' → 'hacked'` 实测落盘零拦截;对照组(显式 `writablePaths:['title']`)被 `PATH_OUT_OF_SCOPE` 正确拦 —— 证明「写权限仅经 writablePaths」是设计意图,剥离机制本应在 :566 生效但没生效。破坏 doc/architecture.md:510 文档化安全不变量;prompt-injection 经子 agent 读不可信内容后自授即成提权通道(schema 白名单/快照仍生效降低破坏面;permissions/approval 均 opt-in 兜不住)。`eval_script` 同通道一并漏放。**e2e 假绿**:authorization-surface.mjs:66-89 断言只验 `use_worker`(走保留前缀过滤,与本机制无关)且未传 `data:`(主池无 write,断言双重空洞)。
- **修法**:spawnOne 按名解析到工具对象再判定(`opts.allTools` 池建 name→tool Map;未知名保留 —— 后续自然报「工具不存在」);补 e2e 自授 write 场景断言子调用报「不存在」。

### 2. LLM 摘要前缀缓存跨会话泄漏(隐私向,默认配置可达,复现实证)
- **位置**:`src/core/composables/useContextManager.ts:93`(`llmCache` 闭包与 SDK 实例同生命周期,单例非 per-session)+ `:204-217`(命中判定只比 `coveredCount` 数值,无 sessionId/内容对齐)+ `src/core/sdk/createChatSdk.ts:2032-2044/2072-2082`(switchSession/resetSession 重置清单**唯独漏 summarization**,且 `SummarizationMiddleware` 控制面只有 `setContextWindow`,物理无 reset 通道)。
- **失败场景**:会话 A 历史过阈值 → 后台 LLM 摘要落缓存;切/清到会话 B;B 过阈值压缩时走前缀/全量命中分支 → **会话 A 的摘要文本拼进 B 的【对话历史摘要】system 消息**(复现:B 摘要声称「以下是之前 2 轮对话的要点」,内容 100% 为 A 的 LLM 摘要,含「机密项目 Alpha 部署细节与密钥列表」)。最小集成(container+llm+data)默认即暴露(`enableLLMSummary` 兜底 true)。**伴生缺陷**:`llmInFlight` 防重入把 B 自己的后台摘要触发静默吞掉。**注意原报告修法不完整**:只加 reset() 挡不住在飞回调(reset 后 `llmCache=null`,单调守卫恒过,竞态原样复活)。
- **修法**:epoch 代数计数器 —— `fireBackgroundLlmSummary` 捕获当次 epoch,`.then` 中不匹配则丢弃;`reset()`(bump epoch + 清 llmCache;llmInFlight 交 `.finally` 自然回落勿手工清);控制面暴露 reset(),resetSession/switchSession 各补一行。自测:两会话压缩 + 飞行中切换三场景。

### 3. eval_script transform 整体替换漏调 internalAfterWrite → `__pgId` 全量断链(数据丢失面,复现实证且比原报更重)
- **位置**:`src/core/tools/dataOps.ts:1342-1377`(整体替换分支自建落地路径,零 `internalAfterWrite` 调用);对照同函数 :1315/:1333 两个 transform 路径都传,write(set):1579、write(del):1552、draft_commit:1708 也走。
- **失败场景**:配 pgIdPaths 后 `eval_script({script:'return {components:[…]}', mode:'transform'})` 整体替换 → **不止新增组件无 `__pgId`,已有组件 id 也被整体 wipe**(脚本入参 data 经投影已剥 `__pg*`,返回值天然无 id,restoreInPlace 整组换掉)→ vfs 工作副本按旧 id 定位全部失明,下次委派补全新 id → 旧 id 命名的 vfs 工作副本成孤儿被清理删除,**未 commit 的子 agent 工作丢失**;与 2026-08-21 editor「说干完了实际没写入」事故同族。dataOps.ts:861 注释自称「internalAfterWrite = 全写路径收敛点」,此处是漏网点。
- **修法**:分支内 `restoreInPlace/safeMerge` 前捕 `beforeBind = internalAfterWrite ? deepClone(bindRef) : null`,`markDataDirty` 后补 `internalAfterWrite?.(bindRef, beforeBind)`(照 commitSetToBind :507/:546 同款模式);未配 pgIdPaths 时钩子为 undefined 零回归。selftest 用 Worker shim 或静态断言锁死(参考 sec-21)。

### 4. 恢复路径 load/listSessions 裸 await → 后端瞬时故障炸 mount,SDK 整体不可用(文档-代码直接相悖)
- **位置**:`src/core/sdk/createChatSdk.ts:2451/:2457/:2461`(resolveAndLoad 三处裸 await,函数体无 try/catch;`store.ready` 5s race 只覆盖初始化不覆盖 load 本身,且自定义后端 ready 分支恒直达)+ `src/core/backends/storage.ts:555-576`(listSessions 的 `backend.scan`、load 的 10 次 `backend.get` + 1 次 meta touch `backend.set` 全裸 await;QuotaExceeded 防线只在写路径 commit :477-497,load 完全不设防 → **内置 IDB 也炸**)。
- **失败场景**:REST 后端瞬时 500 → resolveAndLoad reject → initDone reject → `core.agent` 永不构造(:2779 在 resolveAndLoad 之后)→ mount()/send() 全 reject,**SDK 整体不可用**;全仓 initDone 无任何 `.catch`。`doc/usage-guide.md:906` 明文承诺「后端抛错不炸 SDK(吞错留痕,后续 flush 重试)」—— 承诺只对 createSession/save/commit 成立。4.4.0 e2e「后端抛错」场景 badBackend 的 get/scan 恒不抛,掩盖此缺口。
- **修法**:resolveAndLoad 的 load/listSessions 各包 try/catch,失败降级空会话 + observable(`SESSION_RESTORE_FAILED`,与既有 SESSION_SNAPSHOT_LOAD_FAILED 同口径);load 的 meta touch 单独吞错(lastAccessed 刷新失败不应让快照读取失败);补 e2e 场景(badBackend 的 get/scan 抛错 → mount 成功 + observable)。

### 5. invoke-freeze 被子 agent 继承面穿透(focus 冻结对委派路径失效,复现实证)
- **位置**:`src/core/harness/focus.ts:146-148`(`activeFocuses = invokeFocuses ?? focuses` 快照,主写守卫用之;`getFocuses()` 返回实时态且 `activeFocuses` 未暴露到 FocusController 接口)vs `src/core/sdk/createChatSdk.ts:1363/:1425`(spawn/预声明委派闭包均传实时态 getter)+ `src/core/harness/subagent.ts:381`(子继承读实时态)。
- **失败场景**:invoke-freeze 立项事故的委派变体 —— 方案确认挂起窗口宿主点选组件(host 变更被主 invoke 冻结拦住)→ 用户确认 → 主 agent 委派 use_html → 子 agent spawn 读实时态(含 mid-run 新焦点)→ 子栈按新焦点 PATH_DENIED,而同一 invoke 内主 agent 自身写仍走旧快照不受限,**两个写面范围不一致**;反向(主冻结旧焦点、host 已清焦,子无焦点越权)同样成立。CHANGELOG 4.2.3 立项原文「不追溯掐住正在跑的流程」—— 子 agent 委派是主 invoke 的组成部分,被掐即违背立项目标;4.2.3 focus-ui 修复也明确「invoke 作用域锚定启动时刻」口径。
- **修法**:FocusController 增 `getActiveFocuses(): Focus[]`(= `invokeFocuses ?? focuses`,复用已有闭包函数,~3 行);createChatSdk L1363/L1425 两处接线改用之;**其余 getFocuses 消费面(persist/inspect/宿主 API/focus 工具回显)保持实时态不动**(UI chip/事件同步依赖实时性)。selftest:子继承读生效快照(agent 来源 mid-invoke 变更与现状等价,零回归)。

### 6. 子 agent 超时路径:锁即时释放 + 后台 wind-down commit 与重委派竞态(真模块确定性复现)
- **位置**:`src/core/harness/subagent.ts:507-515`(超时 race 立即 reject)+ `:917-920`(锁在 tool fn finally 立即释放,先于子流 settle)+ `src/core/sdk/codeAssetMiddleware.ts:324-385`(afterAgent 在 abort 后无条件跑,F2 注释自认;中间件单实例共享 vfsStore/pendingRetry,无世代概念)。
- **失败场景**:子 600s 超时 → 锁立即释放 + 错误立即回灌主 LLM(文案还引导重试)→ 被 abort 的子流等在途工具收尾后才跑 wind-down commit;主 LLM 重委派同组件 → 新 checkout 复用旧 vfs 半成品、新子 agent 开始编辑 → **旧 wind-down commit 读共享 vfsStore 当前内容(= 新子 agent 中间态)提前提交** → 新子 agent 收口 keep_external hash 失配 → **新委派最终成果被静默丢弃** + 误报「组件被外部修改」,第三次 checkout 时最终成果彻底丢失(复现输出:`最终 data.code = <div>NEW-INTERMEDIATE</div>`,NEW-FINAL-RESULT 被丢)。触发前提低频(600s 超时 + 子流卡在 ≥秒级不可取消工具 + 主 LLM 迅即重委派),但超时瞬间子 agent 正跑慢集成工具(看门狗上限 120s/MCP 60s)即命中,单次命中概率不低、后果严重。次级:超时路径 decorateSubagentResult 不执行(wind-down 检出的 keep_external 无通道回主上下文);exitDataScope 立即删基线 vs wind-down 在途写 setBaseline 重建 → baselines Map 每次超时委派泄一条。
- **修法**:①组件锁 release 从 tool fn finally 改挂 `streamP.finally`(错误仍立即回灌保响应性,重委派撞 COMPONENT_BUSY —— 该文案本就引导「等委派结束再重试」,语义自洽);②共享 vfsStore 命名空间加 **per-组件委派世代号**(同 `__pgLastCheckout` 先例:Map<pgId, gen>,beforeAgent gen++,afterAgent commit 前查世代,旧代跳过 —— 顺带消除误报 keep_external + ③keep_external 并入观察层 warn);④baselines 泄漏随 release 推迟顺带修复。世代号单独采用即可掐断中心竞态,与 ① 叠加全闭合。

### 7. `maxBytes: Infinity` 不关 `maxBytesPerSession`(默认 10MB)→ 文档承诺落空 + 超限静默丢数据
- **位置**:`src/core/backends/storage.ts:25`(`DEFAULT_MAX_BYTES_PER_SESSION = 10MB`)+ `:380-381`(两配置完全独立解析,自定义后端实例仍取默认)+ `:462-465`(超限拒写该 kind 仅 emit quota 事件;唯一消费者是 `debug:true` 的 console.log,非 debug 集成方**零可观察面**);对照 `doc/usage-guide.md:901-902`「maxBytes: Infinity 关闭客户端 LRU 淘汰(容量管理交服务端)」。
- **失败场景**:按官方文档示例配 `storage: { backend: httpBackend, maxBytes: Infinity }` 以为容量完全交服务端 → page-builder 型长会话(vfs 多 HTML code + messages 工具结果)单会话超 10MB → messages/vfs kind **静默拒写**(旧值保留非锁死,但刷新回退到最后一版未超限快照,集成方无感知)。核实裁决:严重性可辩 P2(`maxBytesPerSession` 是已导出显式配置项、10MB 默认是合理防御、旧值保留非机制性破坏),但「文档承诺口径 + 拒写零可观察性」坐实。
- **修法**:`config.maxBytesPerSession ?? (config.maxBytes === Infinity ? Infinity : DEFAULT_MAX_BYTES_PER_SESSION)`(一行,容量语义与 maxBytes 口径对齐;显式传 maxBytesPerSession 优先不变)+ quota 事件接入 debugLogs 留痕(去静默)+ usage-guide §6.6 补 maxBytesPerSession 说明。

## P2(两项,高价值顺手修)

### 8. data_change 在写失败时仍发(双路独立发现 + 运行时复现;4.4.1 修复的同族反向)
- **位置**:`src/core/sdk/createChatSdk.ts:849-857`(数据写分支只按 args 推断 op 不看 result;委派分支有 `result.status === 'done'` 检查,两分支口径不对称)。
- **失败场景**:SCHEMA_INVALID / PATH_DENIED / VERSION_CONFLICT / freeze 拒绝 / JSON_PARSE(dataOps 失败不 throw 返回 `ERROR:` 字符串且到达中间件时 **status 恒 'done'**)→ 照发 `data_change` → 以事件驱动「标脏/自动存草稿/落库」的宿主为**零变更**触发保存(与 4.4.1 修的事故同一受害面,方向相反)。e2e 现有 4 组用例全成功路径 + dryRun,零失败覆盖。
- **修法**:emit 前判 `typeof result.content === 'string' && result.content.startsWith('ERROR:')` 则不发(**必须判 content 前缀,单查 status 无效** —— dataOps 失败契约决定);operation 语义从「写尝试」收敛为「数据已落地」。补 e2e 失败写不发 data_change。

### 9. `streaming:false` UI 路径绕过 trackActive/串行闸(幽灵流 + 跨会话孤儿写)
- **位置**:`src/core/sdk/mountChatDialog.ts:33-41`(fetchResponse 直接调 `core.agent.invoke`,只手工复制了 abortConflict,未走 core.stream 包装)。
- **失败场景**:①`streaming:false` + 生成在途 + `sdk.unmount()` → abortAllActive 注册表里没有这条 invoke → **幽灵流继续烧 token、继续写 bind**,store 已 dispose 落盘错误被静默吞;②生成在途 + 编程式 `sdk.switchSession()`(走 runSerial+abortAllActive 同样漏)→ 流完成后旧会话回复 push 进**新会话** messages。
- **修法**:fetchResponse 改走 `core.stream(msgs, () => {}, signal)`(core.stream 本就聚合返回最终文本,自带 trackActive/protectedRefs/abortConflict)。

## REFUTED(证伪留痕,不立项)

- **switchSession 慢后端 vfs 空快照竞态(原疑似 P1)**:核实证伪 —— `vfsStore.clear()`(:2031)到同步 `applySnapshot` 内 hydrate(:1762)之间全部同步零 await(:2032-2044 中间件 reset/importStack 均同步),JS 单线程下 800ms debounce 定时器不可能在中间点火;原报告把 `if (!snap)` 的二次 load 误读为必经路径。慢后端(1200ms get)tsx 复现往返数据完整。残余 = hydrate 不清 clear 的 pending timer → 切回后一笔**冗余自写**(hydrated 内容写回本会话,无害),登记 deferred P3。

## 登记 deferred(不进本 change)

见 deferred.md「2026-08-26 team-audit-hardening 登记」段,按域分组:存储恢复面(P2×4:resetSession 未走串行闸/UI 删会话无 catch/后端方法契约零校验/commit 通用错误零留痕;低危×2:maybeEvict Infinity 不短路/encodeKey `::` 不转义)、上下文面(P2×4:摘要前缀对齐 trim 后失效/估算计入 steps/reasoning/批读失效占位文案不实/invoke 内 offload 不进保护集;P3:userImages 保护 isLarge 前置)、门禁面(P2×3:零工具门禁无拒绝出口/COMPONENT_BUSY 计等效写/caps.vfs:false 无守卫;P2:actionGate 全角标点;P3×3:QUESTION_TAIL_RE 全角/draft_commit 不退出 planning/超限拒 update_todo 文案)、数据写链面(P2×3:eval transform 三模式无乐观锁/restore_last_checkpoint 不发 data_change/set+append 批内中间值;P3×4:restore_data 绕 freeze/commitSetToBind 双深拷贝/write(del) 不存在仍入栈/setData-importData 事件口径)、主循环面(P2低×2:runSerial 排队 abort 白等/budget-abort 空气泡消息)。

## 红线

- spawn 剥离修法不改变既有语义:未知名保留(后续自然报「工具不存在」,与框架工具同语义);显式 writablePaths 授权路径零变化(对照组实测已正确拦截)。
- focus 修法只改委派继承的取值源:**其余 getFocuses 消费面(UI chip/persist/inspect/宿主 API/工具回显)保持实时态不动**;agent 来源 mid-invoke 变更经双写快照与现状等价,零回归。
- llmCache 修复必须含 epoch(只 reset 不挡在飞回调 = 假修);llmInFlight 勿手工清(否则双重 fire)。
- data_change 失败判定必须用 content `ERROR:` 前缀(dataOps 失败契约下 status 恒 'done',单查 status 无效);dryRun 不发语义(4.4.1)保持不变。
- 组件锁 release 推迟不得引入新挂点:wind-down 各段均有界(工具看门狗 120s 上限),超时错误仍立即回灌保响应性;旧代 commit 跳过 = 跳过,不得改为排队重放。
- maxBytesPerSession 一行翻转仅对 `maxBytes === Infinity` 生效;显式传值优先不变;10MB 默认(非 Infinity 场景)零变化。
- 修复不得引入新的静默吞错(降级必留痕:observable/debugLogs)。

## 验收门禁

- selftest:spawn 自授 write 子调用被拒(「工具不存在」口径);llmCache 两会话压缩互不污染 + 飞行中切换丢弃;eval transform 整体替换 __pgId 保活(write(set) 对照);focus 子继承读生效快照(主/子写面一致);组件世代号旧代 commit 跳过。
- e2e:后端 get/scan 抛错 → mount 成功 + SESSION_RESTORE_FAILED;自授 write 场景断言(authorization-surface 补 data:);失败写(SCHEMA_INVALID)不发 data_change;maxBytes Infinity 下超 10MB 持久化正常。
- 四门禁全绿(build/selftest/e2e/browser)+ exports/types/alignment/size/pack;计数同步 CLAUDE.md + README 中英。
- 真 LLM:complex-ops 复跑零回归(重点 S5 委派链路 —— 世代号改动面)。
