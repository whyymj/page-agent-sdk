# Test Plan:team-audit-hardening(测试先行)

> 原则:**每项修复先写「修前红测」**(当前代码上跑必失败,失败形态 = 缺陷复现本身),修后转绿;配「回归对照」锁红线。分层判定按 CLAUDE.md:selftest = 模块级白盒;e2e = createChatSdk 顶层/事件/持久化;browser = UI 接线与 Worker 落地;真 LLM = 竞态观察。

## 总览(用例 × 层)

| # | 修复 | selftest | e2e | browser | 真 LLM |
|---|---|---|---|---|---|
| 1 | spawn 自授剥离 | sec-44 扩展 | authorization-surface 改造 | — | — |
| 2 | llmCache epoch | 新 sec-114(单元) | session-integrity 扩展(接线) | — | — |
| 3 | eval transform __pgId | sec-78 扩展 | — | html-page 扩展(落地链) | — |
| 4 | resolveAndLoad 吞错 | sec-111 扩展 | storage 扩展 | — | — |
| 5 | focus 子继承快照 | sec-54 扩展 | focus 扩展 | — | — |
| 6 | 锁推迟 + 世代号 | sec-77 扩展(时序) | subagents 扩展(锁视图) | — | complex-ops S5 复跑 |
| 7 | maxBytesPerSession | — | storage 扩展 | — | — |
| 8 | data_change 失败抑制 | — | events 扩展 | — | — |
| 9 | streaming:false 走 stream | — | — | 新 spec(page-demo 加 ?streaming=0 钩子) | — |

---

## #1 spawn `tools` 自授剥离修活

**e2e authorization-surface.mjs(改造既有第三组,即假绿用例本身)**
- 补 `data: { schema, bind }`(主池真有 write —— 修前 filter no-op 时子调 write 会真执行,这是红测的观察面)
- 子 LLM 脚本序列追加 `write({ patch: set title })` 调用
- **红测断言(修前失败)**:子调 write 的 subagent tool_result 含「工具不存在」且 `bind.title` 未变(修前:write 真执行,title 被改)
- 保留既有 use_worker「工具不存在」断言(框架工具剥离另一通道,不回归)
- 新增 `eval_script` 自授一例:同序列自授 `['eval_script']` → 子调用报不存在(条件写工具同通道)
- **回归对照**:未知名自授(如 `['no_such_tool']`)保留 → 子调用报「工具不存在」(与框架工具同语义,红线)
- **回归对照**:第一/二组 writablePaths 授权路径照旧通过(approval 继承 + 写落盘/拒写均不动)

**selftest sec-44 扩展(白盒,不经 LLM)**
- `isWriteCapableTool` 收**工具对象**:writeCapable 标注工具 → true;纯名字符串入参 → 保守 false(接口语义收紧的显式锁定)
- spawnOne 工具解析:name→tool Map 命中主池对象后判定;`tools: ['write']` 自授列表经剥离后子工具集无 write
- 全量写语义工具扫表(接 sec-78 A4 单一真相源):对每个 writeCapable 标注工具名跑一遍自授剥离断言(防未来新写工具再漏)

## #2 llmCache epoch(跨会话泄漏)

**selftest 新 sec-114(直接 new useContextManager,summaryLlm 用可控延迟 stub)**

红测三场景(均修前失败):
1. **两会话压缩互不污染**:A 压缩 → 后台摘要 resolve 落缓存(标记词「ALPHA-SECRET」)→ reset()(模拟切会话)→ B 压缩触发 → B 的【对话历史摘要】system 消息**不含**「ALPHA-SECRET」(修前:前缀/全量命中把 A 摘要拼进 B)
2. **飞行中切换丢弃**:A 触发后台摘要但 stub 挂起 → reset()(epoch bump)→ 摘要 resolve → llmCache 仍为 null(修前:reset 只清缓存,在飞 .then 落缓存,竞态复活 —— **这是「只 reset 不 epoch = 假修」的锁定断言**)
3. **B 自身后台摘要不被吞**(llmInFlight 伴生缺陷):A 摘要在飞 → reset → B 触发摘要 → B 的摘要正常执行不被 llmInFlight 防重入吞掉(修前:llmInFlight 常驻,B 摘要静默丢弃)

回归对照:
- 同会话内前缀命中照常(缓存命中路径零变化):A 压缩两次,第二次前缀命中不重跑 LLM
- epoch 不匹配时**只丢结果不清 llmInFlight**:断言后续触发不被双重 fire(stub 调用计数恰 +1)

**e2e session-integrity.mjs 扩展(接线层,createChatSdk 真路径)**
- contextOptions 阈值压低 + summaryLlm = StubChatModel;会话 A send 数轮触发压缩 → `switchSession()` 新会话 B → send 数轮触发压缩 → 断言 B 压缩后的 system 摘要段不含 A 的标记词(验证 resetSession/switchSession 真的调到了控制面 reset,漏接线即红)
- `resetSession()` 同口径一例

## #3 eval transform 整体替换 internalAfterWrite

**selftest sec-78 扩展(B2 同域,node 无 Worker 的既有限制)**
- 首选:**抽出整体替换落地段为可注入测试的形态** —— createDataOps 若可注入 sandbox runner(runSandboxedScript 引用可替换)则直接跑真 transform;不可注入则退**静态断言**:源码 整体替换分支(dataOps.ts:1342-1377 区段)文本含 `internalAfterWrite?.(bindRef, beforeBind)` 且 beforeBind 捕获在 restoreInPlace 之前(锁实现不锁文本位置,断言语义:分支内钩子调用存在)
- 行为断言(可跑 Worker 的环境/或抽出纯函数后):`eval_script transform` 返回新 components 数组 → 已有组件 `__pgId` 保持原值 + 新增组件补齐 id;`write({set})` 对照组(既有 B2 用例)零变化

**browser html-page spec 扩展(落地链端到端 —— Worker 真跑 + pgIdPaths 真配)**
- mock LLM 脚本:`eval_script({ jsonPath:'components', mode:'transform', script:'return data.map(...替换式新数组...)' })` 整体替换 → 随后委派 `use_html` 修改既有组件 → 断言委派成功且 **vfs 文件地图按原 __pgId 命中**(不新建副本)。修前:__pgId 全 wipe → 新 id 补齐 → 旧 vfs 副本成孤儿,委派后组件内容丢失(红测观察面 = 委派后组件 code 与预期不符/孤儿清理留痕)
- 简化降级(若委派链太重):整体替换后直接断言 `inspect()` 观察层/`__pgNotes` 侧写仍按原组件 id 关联

## #4 resolveAndLoad 吞错

**e2e storage.mjs 扩展(修前红:mount reject)**
- **坏后端 mount 存活**:自定义 backend `get`/`scan` 全抛错 → `await sdk.mount()` 成功(修前:initDone reject,SDK 整体不可用)→ debugLogs 含 `SESSION_RESTORE_FAILED`(与 SESSION_SNAPSHOT_LOAD_FAILED 同口径)→ `sdk.send` 走空会话正常收口(降级可用)
- **meta touch 不连坐**:backend `get` 返回正常快照但 `set` 抛错(lastAccessed 刷新路径)→ load 成功、messages/bind 数据完整(修前:meta touch 裸 await → 快照读取被连坐 reject)
- **内置 IDB 同面**:QuotaExceeded 形态在 node 不可模拟,降级为 selftest 层 isQuotaError 覆盖既有(sec-08 已有,不新增)

**selftest sec-111 扩展(模块级,storage.ts 直测)**
- `load` 遇 backend.get 抛错 → 吞错留痕不 reject(返回空/降级形态)
- meta touch `backend.set` 抛错 → 不影响快照返回
- listSessions 遇 scan 抛错 → 降级空列表 + 留痕

**回归对照**:163 行既有「set 抛错 flush 吞错不炸」用例照旧;113/125/135 三个后端形态 mount 照旧。

## #5 focus 子继承生效快照

**selftest sec-54 扩展(FocusController 白盒)**
- `getActiveFocuses()` 存在性 + 语义:beforeAgent 快照后 → `getFocuses()` 返回实时态(宿主 mid-invoke setFocus 后含新焦点)/ `getActiveFocuses()` 返回冻结快照(不含)—— **一测双通道,锁「其余消费面保持实时态」红线**
- 未进 invoke 时两者等价(零回归基线)

**e2e focus.mjs 扩展(委派继承端到端)**
- 正方向:主 stream 启动前 setFocus(子树 A)→ 流内(stream 回调收到 use_worker tool_call 事件时,模拟宿主 mid-invoke 变更)setFocus(子树 B)→ 子 agent write 子树 A 路径 → **成功**(按冻结快照 A 放行;修前:子读实时态 B → PATH_DENIED 红测)
- 反方向:主冻结 A、宿主 mid-invoke **clearFocus** → 子 write 子树 A 仍被范围收紧(修前:子读实时态无焦点 → 越权放行)
- 回归对照:agent 自己的 focus 工具变更立即生效(clear_focus 自救,4.2.3 既有语义);`focus_change` 事件/持久化/inspect 仍反映实时态(既有 120/157/180 行用例零变化)

## #6 组件锁 release 推迟 + 委派世代号

**selftest sec-77 扩展(时序复现,受控 promise 驱动 —— 照核实员真模块复现形态)**

红测(修前失败,复现 `NEW-FINAL-RESULT 被丢`):
- **世代号核心竞态**:子 1 超时 abort(streamP 挂起在慢工具)→ 重委派子 2(新 checkout/新世代)→ 子 1 wind-down settle 后尝试 commit → **旧代 commit 被跳过**;断言最终 `data.code` = 子 2 最终值(修前:子 1 wind-down 读到子 2 中间态提前 commit → 子 2 收口 keep_external 误判 → 最终值丢失)
- **无误报 keep_external**:上述场景 debugLogs 不出现人工并发误报 warn(旧代跳过时吸收)

行为断言(修后新语义):
- **锁 release 推迟**:use_<id> 超时 → 错误立即回灌主 LLM(响应性),但 `lockedComponents` 仍含该组件;streamP settle 后释放;窗口内重委派同组件 → `COMPONENT_BUSY`
- **兜底 race**:streamP 永不 settle(挂死 promise)→ 超时兜底后锁仍释放(防永占红线)
- **baselines 泄漏**:超时委派 N 次 → baselines Map size 有界(修前每超时泄一条)
- exitDataScope 时序随 release 推迟顺带断言(旧代不再重建基线)

**e2e subagents.mjs 扩展(锁视图反射,不构造重时序防 flake)**
- `subagent.timeoutMs` 配小 + 慢 stub 工具 → 超时错误回灌主上下文 + `inspect().subagent.lockedComponents` 在 wind-down 窗口内含该组件(时序锚:错误回灌事件后立即查 —— 错误立即回灌与锁推迟释放之间的窗口正是断言对象;容忍度用轮询等待 + 上限,不 sleep 死等)

**真 LLM(complex-ops S5 复跑)**:零回归门禁 + 观察 COMPONENT_BUSY 重试节奏(观察项,非断言)。

## #7 maxBytesPerSession 联动

**e2e storage.mjs 扩展**
- **Infinity 关闭上限**:自定义 backend(记录 set 调用)+ `maxBytes: Infinity` + 大 bind(>10MB string)→ flush → scan 数据完整(修前:kind 拒写,刷新回退旧版)
- **显式 maxBytesPerSession 优先**:`maxBytes: Infinity` + `maxBytesPerSession: 1024` → 超限仍拒(显式值不被联动覆盖,红线)
- **默认零变化**:非 Infinity 不传 maxBytesPerSession → 10MB 默认照旧(拒写行为保持)
- **quota 留痕**:超限拒写 → debugLogs 含 quota 记录(修前:仅 debug:true console.log,零可观察面)
- 回归对照:125 行 `{ backend, maxBytes }` 配置对象形式照旧。

selftest 不新增(表达式在 storage.ts 装配路径,配置解析经 e2e 顶层覆盖;estimateBytes/selectForEviction 纯函数 sec-03/sec-08 已有)。

## #8 data_change 失败不发

**e2e events.mjs 扩展(修前红:失败写照发)**
- **SCHEMA_INVALID**:write patch 值类型错(string 写 number 字段)→ data_change **零事件**;断言 `events.length === 0`(修前:args-only 推断照发,operation=edit)
- **freeze 拒绝**:resources verbatim/freeze 字段被 write → 零事件(FROZEN_FIELD 走 `ERROR:` 字符串路径,同口径)
- **ERROR: 前缀判定的必要性锁定**:断言子 agent 委派分支与数据写分支口径一致(委派失败 result 已有 done 检查 —— 用一例失败委派不发 data_change 收口对称性)
- 回归对照:既有 4 组成功路径(eval transform/draft_commit/patches/resource_update)+ dryRun 零事件用例全绿不动

selftest 不新增(createSdkEventMiddleware 在 createChatSdk 顶层作用域,判定逻辑若抽纯函数 `isFailedDataOpResult(content)` 可加 3 行单测,实施时顺手)。

## #9 streaming:false 走 core.stream

**browser 新 spec(page-demo 加 `?streaming=0` 查询参数钩子 —— 现状全 demo 零覆盖该路径,?rag=1 查询参数有先例)**
- **幽灵流中止**:`?streaming=0` + mock LLM 挂起响应(脚本计数不推进)→ 生成在途 `sdk.unmount()` → 等待后断言:bind 零后续写入(修前:abortAllActive 注册表无此流 → 幽灵流收口后照写)+ 无 console error
- **跨会话孤儿写**:`?streaming=0` + 在途生成 + 编程式 `switchSession()` → 旧流收口后旧会话回复**不进新会话 messages**(断言新会话 messages.length 不增;修前:fetchResponse 直接 push 当前 session)
- **功能零回归**:streaming:false 正常单轮问答收口(改管线后消息流/UI 渲染照常,core.stream 聚合返回文本与 fetchResponse 语义等价)

**headless e2e 不加**(fetchResponse 在 mountChatDialog UI 接线层,node 触不到;该路径历史上就只靠 browser 层)。

---

## 修前红测清单(TDD 执行序)

实施每项前先落对应红测、跑一遍确认**以缺陷形态失败**(防「测试写了但测的不是缺陷」):

| # | 红测 | 修前失败形态 |
|---|---|---|
| 1 | e2e 自授 write 用例 | bind.title 被子改写(而非「工具不存在」) |
| 2 | sec-114 场景 1/2/3 | A 摘要进 B system / 在飞回调复活竞态 / B 摘要被吞 |
| 3 | browser 整体替换后委派 | __pgId wipe → 委派丢内容/建孤儿副本 |
| 4 | e2e 坏后端 mount | mount() reject(而非成功+留痕) |
| 5 | e2e 正方向 | 子 write 被 PATH_DENIED(按新焦点误拦) |
| 6 | sec-77 世代号复现 | data.code = 中间态,最终值丢失 |
| 7 | e2e Infinity 超限 | kind 静默拒写,scan 无新数据 |
| 8 | e2e SCHEMA_INVALID | events.length === 1(照发) |
| 9 | browser 幽灵流 | unmount 后 bind 仍被写 |

## 计数与登记预估

- selftest 新增:sec-114 一个模块(~10-14 断言)+ sec-44/54/77/78/111 扩展(~25-30 断言)
- e2e 新增:authorization-surface 3 / session-integrity 2 / storage 5 / focus 2 / subagents 1 / events 3 ≈ 16 断言
- browser 新增:html-page 1 + streaming-false spec 3 ≈ 4 断言(+ page-demo 查询参数钩子,属 demo 代码改动)
- 实施后同步 CLAUDE.md / README 中英计数

## 风险与观察名单

- #6 e2e 锁窗口断言用轮询 + 上限(非 sleep 死等);若现 flake 进「时序敏感观察名单」(§3.5 前科:queue/icons)
- #9 需改 page-demo demo 代码(查询参数),改 demo 后跑全量 browser 门禁防波及其余 23 项 page-demo 用例
- #2 e2e 接线用例依赖压缩阈值压低 + StubChatModel 当 summaryLlm,注意 `maxMemoryRounds >= summaryThresholdRounds` 约束
- #3 browser 用例若委派链太重,降级为 inspect 观察层断言(见该节)
