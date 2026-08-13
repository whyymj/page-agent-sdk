# audit-VM:版本与迁移(Versioning & Migration)

> 维度:VM。SDK 当前版本 ~2.42.0(主分支 develop),审计日 2026-08-12。
> 范围:setData 运行时换 schema 后旧快照栈兼容 / 持久化跨版本 hydrate / applySnapshot 版本号机制缺失 / 旧结构归一化系统性 / vfs hydrate 合并语义 / checkpoint 跨版本 restore / mission·focus·todos·workingMemory 持久化结构演进。
> 口径:P0=跨版本数据损坏/无法恢复;P1=升级后功能失效/数据部分丢失;P2=降级体验;P3=卫生。
> 证据:全部 file:line 对齐 src 当前 develop 分支。

---

## 审计范围

**已读基线文件**
- `src/core/tools/dataOps.ts` — 快照栈结构(`DataSnapshotEntry`)、`commitSetToBind`/`applyPatchesToBind`、`controller.set`(`snapshots.length = 0` + `baselines.clear()`)、`restore_data`(line 526 schema.safeParse 守卫)
- `src/core/backends/storage.ts` — `SessionSnapshot` 形状(line 46-61)、`SNAPSHOT_KINDS` 数组(line 31-32)、`KEY_PREFIX='v:1'`(line 29,**key 编码版本非数据结构版本**)、`SessionMeta`(line 35-44 无 schemaVersion 字段)、`commit`/`debouncedSave`/`load`/`save`/`createSession`
- `src/core/harness/checkpoint.ts` — `Checkpoint` 结构、`save`(line 148-180 `lastBindClone`/`lastVfsClone` 增量缓存)、`restore`(line 190-217 `restoreInPlace` 写 bind **不经 schema 校验**)、`importStack`(line 223-238 仅校验 `id/messages` 存在,不校验 `windowVals`/`vfs`/`todos` 结构)
- `src/core/backends/vfs.ts` — `hydrate`(line 195-200 **合并语义** + 不归一化 `VfsFile` 字段)、`enforceLimit`(line 110-140 LRU 按 `updatedAt` 排序,缺字段 → NaN)、`createVfs(options.vfs?.initialFiles)` 种子机制
- `src/core/harness/state.ts` — `HarnessState`/`Todo`/`Mission`/`Focus`/`WorkingMemory`/`VfsFile` 类型形状
- `src/core/harness/{mission,focus,workingMemory,todos}.ts` — 各中间件 `reset`/`restore`/`setMission` 路径,识别每条的归一化防御
- `src/core/sdk/createChatSdk.ts` — `applySnapshot`(line 1420-1455)、`setData`(line 2358-2365)、`persistRuntime`(line 2045-2090)、`resolveAndLoad`(line 1938-1973)、`switchSession`(line 1596-1670)、`resetSession`(line 1648-1667)

**与 deferred.md 的边界**
- deferred 持久化段 8 项(无版本号/无结构校验/`setMission({})` 不落盘/draft TTL/quota 静默/多标签分叉/vfs hydrate 种子复活/switchSession persist 残项)已登记。本审计**不重复**,只列该段未具体覆盖的**新迁移问题**。
- 其中 deferred #2「applySnapshot 对 messages/todos/wm 无结构校验」自标「VM 维度种子」—— 本审计展开为具体 finding(F1 系统化 + F2 单点抛错实证)。
- 其中 deferred #6「vfs hydrate 合并 → vfs_rm 删的种子文件复活」针对**文件级别复活**(seed initialFiles 二次注入);本审计 F6 针对同函数的**字段级别归一化缺失**(单条 VfsFile 缺 updatedAt),两条同源不同层,不重复。

---

## Findings(按级,带版本演进场景)

### 【P1】F1 — 完全无数据结构版本号机制(系统性根因)

**证据**:
- `src/core/backends/storage.ts:29` `KEY_PREFIX = 'v:1'` —— 注释「三层 key:v:1::{dbName}::{agentId}::{sessionId}::{kind}」明确这是 **key 编码版本**(key 前缀段),不是 SessionSnapshot 数据结构版本。`v:1` 一旦提升 v:2 需 IDB 升级 whole-store,运行时无任何代码读取此值做分支。
- `src/core/backends/storage.ts:35-44` `SessionMeta` 接口:`{agentId, sessionId, createdAt, lastAccessed, bytes, title?}`,**无 schemaVersion 字段**。
- `src/core/backends/storage.ts:46-61` `SessionSnapshot` 接口:**无 schemaVersion 字段**;9 个 kind 直接平铺。
- 各读点(`createChatSdk.ts:1420-1455` applySnapshot / `checkpoint.ts:223` importStack / `vfs.ts:195` hydrate)**均无版本分支**,旧版本数据归一化全靠各中间件 `reset`/`restore`/`setMission` 的 ad-hoc 防御。

**版本演进场景**:
- 当前各 kind 形状历经多次演进(Todo 增 `id/parentId/deps/criteria/evidence`、Focus 由单焦点 → `Focus[] | null`、Mission 增 `acceptanceCriteria/explicit`、Snapshot 由 4 kind 扩到 9 kind)。
- 每次形状变更,SDK 都无法识别"这条快照是哪个版本写的"—— 只能"形状缺啥就 fallback/补啥"。**覆盖到的是已识别的演进**(focus 单/多数组、todo id、mission 字段 fallback),**未识别的演进**直接进运行时(见 F2/F6/F7 的具体抛错或静默错乱)。
- 一旦未来某个 kind 字段重命名(如 `goal` → `objective`)或形状重组(如 `workingMemory` 拆两个子对象),无版本号即无迁移路径,旧 session 数据要么静默丢字段、要么抛错中断。

**危害**:跨版本升级后,旧 SDK 写的持久化数据在新 SDK 中行为不可预测。无版本号也意味着**没有"按版本归一化"的修复路径** —— 想加迁移逻辑时无从分支。

**与 deferred #2 关系**:deferred #2 仅泛指「无结构校验」,本条点出**根因是缺版本号**,无法做按版本分支的系统性归一化。

---

### 【P1】F2 — `WorkingMemory.restore` 对缺 `locatedPaths` 字段抛 TypeError,中断整个会话恢复

**证据**(实证 + 源码):
- `src/core/harness/workingMemory.ts:106-111`:
  ```ts
  restore: (wm) => {
    locatedPaths.length = 0
    locatedPaths.push(...wm.locatedPaths.slice(0, MAX_ENTRIES))  // wm.locatedPaths undefined → 抛
    for (const k of Object.keys(lastHashes)) delete lastHashes[k]
    Object.assign(lastHashes, wm.lastHashes)  // wm.lastHashes undefined → no-op(Object.assign 跳过 undefined source)
  }
  ```
- 复现(已 node 实证):
  ```
  wm = { lastHashes: {a:'1'} }  → restore CRASH: Cannot read properties of undefined (reading 'slice')
  wm = {}                       → restore CRASH (同上)
  wm = { locatedPaths: ['a'] }  → restore ok(lastHashes fallback 空,无错)
  ```
- `src/core/sdk/createChatSdk.ts:1433` `if (snap.workingMemory && useWorkingMemory) workingMemoryMw.restore(snap.workingMemory)` —— 守卫只判 truthy(`{}` 也通过),不判字段完整性。restore 抛 → 整个 `core.applySnapshot(snap)` 调用栈炸 → resolveAndLoad/switchSession 拒绝载入 → **会话恢复失败,messages/vfs/todos/mission 也未能灌入**(后续行被同 try 块覆盖时丢)。

**版本演进场景**:
- 当前 SDK 不会主动写 `workingMemory: {}`(getWorkingMemory 返 undefined,persist 守卫 `if (wm)` 跳过)。
- **但**:(a) 未来版本若改为持久化显式空标记 `{}`(意义"已显式清空"),旧 SDK 加载即抛;(b) 持久化层部分写入/损坏/手工篡改,跨版本 IndexedDB 数据迁移工具产出 partial object,同样抛;(c) WebStorage 后端 `JSON.parse` 失败回退为 undefined(`storage.ts:308`)的边界场景。
- 任意一种触发,会话恢复中断且**无降级**(applySnapshot 整体 try 无 catch,异常向上传到 initDone reject,agent 不初始化)。

**修复方向**:restore 改为 `Array.isArray(wm?.locatedPaths) ? wm.locatedPaths.slice(0, MAX_ENTRIES) : []` 同款 lastHashes;或 applySnapshot 单 kind 失败不阻塞其他 kind(每条 try/catch + debug 留痕)。

**与 deferred #2 关系**:deferred #2 笼统说「无结构校验 → 运行时抛错而非优雅降级」,本条是该论的**具体实证单点**(也是当前 SDK 中唯一会在常态字段缺失下抛穿的 restore 路径,其他 setMission/ensureIds/focus 归一化均有字段 fallback)。

---

### 【P2】F3 — Checkpoint 跨 `setData(schema 变更)` 后,旧栈 entry 持旧 schema 形状的 `windowVals`,restore 不经 schema 校验致 bind 污染

**证据**:
- `src/core/tools/dataOps.ts:299` `controller.set`:`schema = c.schema; ... snapshots.length = 0; baselines.clear(); loadResources(...); resourceStore?.clear(); markDataDirty()` —— **清的是 dataOps 自己的 per-path 快照栈与基线**。
- `src/core/sdk/createChatSdk.ts:2358-2365` `setData(config)` 仅调 `core.dataOpsController.set(config)` + `infoTick++`,**未通知 checkpointMgr 清栈**。
- `src/core/harness/checkpoint.ts:190-217` `restore(id?)`:`restoreInPlace(live, clone(snap))` —— 写 bind **不经 schema.safeParse**(对比 `dataOps.ts:526` restore_data 有 `schema.safeParse(entry.value)` 校验)。
- `src/core/harness/checkpoint.ts:167-176` save 时 `windowVals[''] = clone(deps.getData())`,**栈深 5**(默认 maxCheckpoints),setData 后旧 4 条仍持旧 schema 的 bind 快照。

**版本演进场景**:
1. 集成方在 schemaA 下跑若干轮,checkpoint 栈 = `[cp_a1, cp_a2, cp_a3]`(均 schemaA 形状 bind)
2. 集成方调 `sdk.setData({schema: schemaB, bind: newBind})`(典型场景:用户切换页面组件)
3. controller.set 清 dataOps 栈 + baselines,但 **checkpointMgr 栈保留 cp_a1..cp_a3**
4. 新一轮 beforeModel 触发 save → stack = `[cp_a1, cp_a2, cp_a3, cp_b1]`
5. 集成方或 LLM 调 `restore_last_checkpoint` → 默认取最近(`cp_b1`)✓ 安全
6. **但** `list_checkpoints` 仍列出 cp_a1..cp_a3,LLM 或 UI 选某旧 id restore → restoreInPlace 把 schemaA 形状的 windowVals 直接灌入当前 schemaB 的 bind,**不经任何校验** → bind 字段错位/类型不匹配/缺字段/多字段,后续 read 投影 / write 校验 / 乐观锁 hash 全部行为不可预测

**危害**:LLM 自纠流程(verify/checkpoint-based automation)或用户手点 UI 选旧 checkpoint 时,bind 静默污染。restore 不抛错(schema 校验被跳过),后续 write 才暴露 SCHEMA_INVALID / 字段错位。

**修复方向**:setData 时同步 `checkpointMgr.importStack([])`(语义:dataOps 栈清,checkpoint 栈也跨 schema 不再可恢复);或在 checkpoint.restore 入口加 `cfg.schema.safeParse(snap)` 守卫(同 restore_data 口径)。

---

### 【P2】F4 — Todo `id` 由 hydrate 时 index 生成,跨版本/旧清单混用时与 `update_todo` 引用错位

**证据**:
- `src/core/harness/todos.ts:23-34` `ensureIds`:`return list.map((t, i) => ({ id: t.id || \`t-${i+1}\`, ... }))` —— 旧持久化 todos 无 id 字段时,按**加载时的数组 index** 生成 `t-1/t-2/...`。
- `src/core/harness/todos.ts:198-202` `reset(next)`:`todos = ensureIds(next.map((t) => ({ ...t })))` —— hydrate 入口,旧项 id 完全由当前次加载时的位置决定。
- `src/core/sdk/createChatSdk.ts:1423` `if (snap.todos?.length) todosMw.reset(snap.todos)` —— 守卫仅判长度。
- `src/core/harness/todos.ts:131-148` `update_todo({id, ...})` 按 `id` 精确匹配更新。

**版本演进场景**:
- vA SDK 持久化 todos 时无 id 字段(演进前),vB SDK 加载时 ensureIds 按 index 补 `t-1/t-2/t-3`。
- 用户在 vB 继续操作:write_todos 整表替换为 `[A, B, C]`(框架补 t-1/t-2/t-3),update_todo({id:'t-2',status:'completed'}) 命中 B ✓ 正确。
- **但**:若集成方手工注入旧清单 + 新清单混合(`[oldNoId, oldNoId, newT3, newT4]`),ensureIds 按位置补 `t-1..t-4`,旧项 id 与 vA 时实际位置可能错位;若旧持久化清单的项曾在 vA 被引用过某个特定 t-N(如集成方代码或文档示例),vB 加载时 index 推导的 id 不保证一致。
- 实际触发概率低(需集成方手工混合,或集成方代码引用特定 id),但语义上 id 不是稳定标识。

**修复方向**:`Todo.id` 生成应基于内容指纹(content hash)而非 index,或加载时一次性把生成的 id 持久化回写(下次加载稳定)。当前 docstring(`state.ts:14-15`)承诺「稳定标识」但实现是位置推导。

---

### 【P2】F5 — `capabilities` 关闭后旧持久化数据静默丢弃,无 emit/info 告知集成方

**证据**:
- `src/core/sdk/createChatSdk.ts:1432-1450` applySnapshot 各 kind 恢复均有 capabilities 守卫:
  - `if (snap.mission && useMission)`(line 1432)
  - `if (snap.workingMemory && useWorkingMemory)`(line 1433)
  - `if (useFocus)`(line 1436)
  - `if (snap.checkpoints?.length && checkpointMgr)`(line 1427,checkpointMgr 仅 `capabilities.checkpoint` 开时存在)
- `useMission`/`useWorkingMemory`/`useFocus` 来自 `caps.missionAnchor` 等(`createChatSdk.ts:1049-1050`)。
- 任一 capabilities 关闭,旧持久化数据**静默 skip**,**无 console.warn**、**无 emit**、**无 inspect 反射**(focus 单有 debug 模式 warn,line 1446,但 mission/workingMemory 无)。

**版本演进场景**:
- 集成方 vA 启用 missionAnchor,用户大量使用,持久化层累积 mission 数据。
- vB 升级,集成方为减包体/性能把 `capabilities:{missionAnchor:false}` 关掉。
- 用户刷新后,旧持久化 mission 被 applySnapshot 守卫跳过,**用户感知"我之前设的任务目标没了"**,集成方也无从感知(无事件)。
- 同理 workingMemory(用户感觉「Agent 又开始重复 read,变笨了」)、focus(用户感觉「我之前聚焦的状态没了」)、checkpoint(automation 续跑失效)。

**危害**:非破坏(集成方主动关能力是合法操作),但**用户层感知"数据丢失"**,且集成方无信号让其解释给用户。

**修复方向**:applySnapshot 各 capabilities 守卫失败时 emit `{type:'restore_skipped', kind, reason:'capability_disabled'}` 一次性可观测事件(集成方可上报/弹提示)。focus 已有 debug warn 模式可作模板。

---

### 【P2】F6 — `vfsStore.hydrate` 不归一化 `VfsFile` 结构,旧缺 `updatedAt` 字段致 LRU 排序 NaN,淘汰顺序未定义

**证据**:
- `src/core/backends/vfs.ts:195-200` hydrate:
  ```ts
  store.hydrate = (incoming) => {
    for (const [k, v] of Object.entries(incoming)) files[normalize(k)] = v  // 不校验 v 形状
    enforceLimit()
    _dirty = true
  }
  ```
- `src/core/backends/vfs.ts:118-127` `enforceLimit` LRU 排序:`.sort((a, b) => a[1].updatedAt - b[1].updatedAt)` —— 旧 VfsFile 缺 updatedAt → `undefined - undefined = NaN` → Array.sort 行为**未定义**(引擎实现相关),淘汰可能优先选新文件而非最旧。
- `src/core/harness/state.ts:58-63` `VfsFile`:`{content: string, mimeType?: string, updatedAt: number}` —— updatedAt 类型为 `number`(必填),但 hydrate 不强制。

**版本演进场景**:
- vA VfsFile 无 updatedAt 字段(演进前),vB 加载后所有旧文件 LRU 排序失效。
- 实际场景:池子撑爆触发 enforceLimit 时,淘汰的"最旧"可能其实是刚 hydrate 进来的关键文件(如刚加载的 large_results),后续 vfs_read 404。
- 触发概率:中(需池子撑爆,长会话 + 大结果场景)。

**修复方向**:hydrate 时 `files[k] = { content: v.content, updatedAt: v.updatedAt ?? Date.now(), ...(v.mimeType ? {mimeType: v.mimeType} : {}) }` 强制归一化;或 enforceLimit 排序 `Number(a.updatedAt) || 0` 兜底。

**与 deferred #6 关系**:deferred #6 是 vfs.hydrate **合并语义**(seed initialFiles + persisted snapshot → vfs_rm 删的种子复活,文件级别);本条是同函数 **字段级归一化缺失**(单条 VfsFile 缺 updatedAt,LRU 排序 NaN),两层独立,可同时修。

---

### 【P2】F7 — persisted `messages` 不归一化 `AgentMessage` 字段,旧缺 `timestamp`/含已废弃字段,downstream 排序/UI 错乱

**证据**:
- `src/core/sdk/createChatSdk.ts:1421` applySnapshot:`if (snap.messages?.length) messages.push(...snap.messages)` —— **直接 push,无字段补全/裁剪**。
- `src/core/sdk/createChatSdk.ts:2049` persistRuntime:`const pureMessages = JSON.parse(JSON.stringify(messages))` —— 只纯化 Vue Proxy,**不校验/补字段**。
- `src/core/harness/state.ts:80` `HarnessState.messages: AgentMessage[]`,AgentMessage 形状历经演进(增 `timestamp`/`steps`/`reasoning`/`tool_calls` 等)。

**版本演进场景**:
- vA AgentMessage 无 `timestamp` 字段,vB 加载后旧消息进入 UI 列表;若 UI 按 timestamp 排序,旧消息 NaN/undefined → 排序错乱;若 DebugDrawer 按时间分组,旧消息分到"Invalid Date"组。
- vA 有某字段(后废弃,如 `meta.oldField`),vB 加载后该字段仍在内存中,可能被 LLM 上下文拼装路径(persistRuntime pureMessages 回写,下次 load 时仍含)持续保留,**永不清理**。
- 实际触发概率:低(timestamp 字段早期就有);但**无防御**意味着未来字段演进时风险无条件暴露。

**修复方向**:applySnapshot 处补一行 `snap.messages = snap.messages.map((m) => ({ role: m.role, content: m.content, timestamp: m.timestamp ?? Date.now(), ...(m.steps ? {steps: m.steps} : {}), ... }))` 或最小 `({ role, content, timestamp })` 投影;或对单消息加 schema 守卫。

---

### 【P3】F8 — `SNAPSHOT_KINDS` 数组增删后无 GC:rename/remove kind 后旧 session 数据孤儿永久占配额

**证据**:
- `src/core/backends/storage.ts:31-32` `SnapshotKind` union + `SNAPSHOT_KINDS` array 当前 9 项。
- `src/core/backends/storage.ts:535` load:`for (const kind of SNAPSHOT_KINDS)` —— **只读当前 SDK 知道的 kind**,旧 SDK 写的已被新版移除的 kind 不被读。
- `src/core/backends/storage.ts:579-581` deleteSession:`clearPrefix(sessionPrefix(...))` —— 删整个 session 前缀,孤儿 kind 在此时一起删。
- 但 `listSessions`(line 522-528)只扫 `__meta__` kind,孤儿 kind 不进 LRU 淘汰的 `bytes` 统计(`commit` 函数 line 443-444 仅按本次 kind 增量)。

**版本演进场景**:
- vA 有 `kindX`,vB 移除并加入 `kindY`。vA 写的 session 在 vB 加载时,kindX 不被读(行为正确,等效丢弃),但 kindX 数据仍在 IDB 中**占用全局配额**。
- 淘汰走 lastAccessed,孤儿 kind 的字节未计入 meta.bytes → 淘汰决策可能不准确地保留大量孤儿数据。
- 直到 deleteSession 整体 clearPrefix 才清。

**危害**:卫生问题。长期升级多个版本后,孤儿 kind 累积,影响存储健康度但不破坏功能。

**修复方向**:启动时一次扫描所有当前 SDK 未知 kind 的 key,记入 meta.bytes 或主动 clearPrefix 清孤儿;或 load 时返回孤儿清单供集成方决策。

---

### 【P3】F9 — `switchSession` 不 await `vfsStore.clear()` 的 scheduleSave timer,800ms 内连续 switchSession 理论可错写空 vfs 到新 session

**证据**:
- `src/core/sdk/createChatSdk.ts:1621` `vfsStore.clear?.()` —— 调 `vfs.ts:208-213` clear:`for (const k of Object.keys(files)) delete files[k]; scheduleSave(); _dirty = true`。
- `src/core/backends/vfs.ts:156-163` scheduleSave:`saveTimer = setTimeout(() => { saveTimer = null; doSave() }, 800)`。
- `src/core/backends/vfs.ts:201-207` flush:`if (saveTimer) { clearTimeout(saveTimer); saveTimer = null } doSave()`。
- `src/core/sdk/createChatSdk.ts:1608` switchSession 先 `vfsStore.flush?.()`(此时 core.sessionId 仍是旧,落盘到旧 session,正确);然后 `await store.flush()`、改 `core.sessionId = target`(line 1618);**之后** line 1621 `vfsStore.clear?.()` 触发 scheduleSave(saveTimer = 800ms) —— 此 timer 在 switchSession 返回后才触发,触发时若 core.sessionId 已被第二次 switchSession 改到第三个 session,doSave → `persist.save(files)` → `store.save(agentId, core.sessionId, { vfs: files })` 会把空 vfs 错写到第三个 session。
- 真实概率:极低(需 800ms 内连续两次 switchSession,且第一个 switchSession 的 vfs 快照为空)。

**修复方向**:switchSession 改 `vfsStore.clear?.(); vfsStore.flush?.()` 二次 flush 兜底(第一次 flush 在改 sessionId 前保旧 vfs 落盘到旧 session,第二次在改 sessionId 后保空 vfs 落盘到新 session);或 vfs persist 回调内固定捕获"发起时的 sessionId"快照(避免依赖 core.sessionId 当前值)。

---

### 【P3】F10 — `SessionMeta` 无 schema 版本字段,LRU 淘汰无法识别旧版本数据优先(存储健康更优)

**证据**:
- `src/core/backends/storage.ts:35-44` SessionMeta 仅含 `{agentId, sessionId, createdAt, lastAccessed, bytes, title?}`。
- `src/core/backends/storage.ts:165-177` `selectForEviction` 按 `lastAccessed` 升序选受害者。

**版本演进场景**:
- 升级后旧版本 session 数据可能字段结构不完整(同 F1/F6/F7),价值低于新版本数据,但 LRU 仅按时效,**不优先淘汰结构陈旧数据**。
- 若集成方跨版本运行,新版本 session 与旧版本 session 共存,淘汰随机性可能丢新版保旧版。

**修复方向**:SessionMeta 增 `schemaVersion: number`(每 SDK 发版自增),selectForEviction 在 lastAccessed 同档时优先淘汰低版本(降级配置或换字段)。属卫生/优化项,非破坏。

---

## 已修复完整性验证

(本维度审计口径为「只读审计」,无修复任务;本节确认核对各修复点未触碰 VM 维度的已知历史问题。)

- **focus 单焦点→多数组归一化**:`createChatSdk.ts:1438` `!raw ? [] : Array.isArray(raw) ? raw : [raw]` —— `storage.ts:59-60` SessionSnapshot.focus 类型 `Focus[] | null` 注释明确「旧版本存单个 Focus 对象,applySnapshot 读时归一化 [focus]」。✓ 已实施完整,实证通过。
- **persisted focus null 标记**:`createChatSdk.ts:2067` `void store.save(..., { focus: fs.length ? fs : null })` —— clearFocus 后存 null 覆盖旧值;applySnapshot 读 null 走 `!raw ? []` 分支清空。✓
- **todos 旧 hydrate 补 id**(`todos.ts:23-34` ensureIds):✓ 实证通过(旧 `{content,status}` → 补 `t-1`)。缺陷见 F4(位置推导非稳定)。
- **mission 字段 fallback**(`mission.ts:86-92` setMission):`goal ?? mission?.goal ?? ''`、`sourceMessageIdx ?? -1`、`explicit ?? true` —— 缺字段 graceful 补默认。✓
- **checkpoint importStack 结构守卫**(`checkpoint.ts:231-232`):仅灌入 `id/messages` 存在且 id 为有限数的 entry,重置 nextId 防冲突。✓ 但仅校验顶层 id/messages,不校验 windowVals 结构(见 F3)。
- **restore_data 跨 schema 守卫**(`dataOps.ts:526`):`schema.safeParse(entry.value)` 失败返 SNAPSHOT_SCHEMA_INVALID,不让旧结构快照回灌到新 schema 的 bind。✓ dataOps 层完整;但 checkpoint.restore 无同款守卫(见 F3)。
- **WebStorage JSON.parse 失败降级**(`storage.ts:308, 328`):单条 JSON 损坏跳过/返 undefined,不冒泡到 load。✓
- **vfsStore hydrate 后 _dirty=true**(`vfs.ts:199`):强制下次 checkpoint save 重建基线,防复用上个会话的 lastVfsClone。✓
- **checkpoint restore 后清增量缓存**(`checkpoint.ts:213-215`):`lastBindClone = undefined; lastVfsClone = undefined`。✓ 防复用错基线致 restore 错乱。

---

## 排查无问题清单

(本节列 VM 维度内**显式核查过、确认无新问题**的点,留作下次审计的覆盖证据。)

- **KEY_PREFIX='v:1' 提升至 'v:2' 路径**:虽未实施过(`storage.ts:29` 注释),但代码层 `req.onupgradeneeded`(line 215-218)与 `db.onversionchange`(line 222-225)已就位,IDB 升级不会 blocked;`MemoryBackend`/`WebStorageBackend` 无版本概念,直接按前缀段隔离。VM 维度无新问题。
- **per-scope 基线跨会话污染**:`controller.set`/`controller.update`(`dataOps.ts:299-300`)在 setData 时 `baselines.clear()`;switchSession/resetSession 时基线随 dataOps controller 重建? —— 实际 controller 实例是 createChatSdk 顶层一次创建,**switchSession 不重建 dataOps controller**,但 `baselines.clear()` 也不在 switchSession 路径显式调。**然而**:switchSession 后所有 scope 的基线条目仍指向"旧 bind hash",新会话首次 read 会 `setBaseline(newHash)` 覆盖主 scope;子 scope 的 `enterScope/exitScope` 是子 agent 委派的 transient scope,委派结束 `exitScope` 已删(line 305),不会跨会话残留。无新问题。
- **dataOps snapshots 跨会话**:controller 实例跨 switchSession 复用,但 switchSession 不清 `snapshots[]`。**然而**:snapshots 是内存 per-session 概念(per-path 快照是当前会话写产生),switchSession 后新会话的 read/write 不会引用旧会话的 snapshot id(restore_data 按 id 查找,旧 id 在新会话 read 不出现),且 `restore_data({id})` 找不到旧 id 返 SNAPSHOT_NOT_FOUND。无新问题(语义上 snapshots 应随 switchSession 清,但不清也不破坏;下次 audit 复核)。
- **persistRuntime 字段缺失防御**:`createChatSdk.ts:2049` `JSON.parse(JSON.stringify(messages))` 处理 Vue Proxy;若 messages 含循环引用(理论不可能,AgentMessage 是规范结构)JSON.stringify 抛 → persistRuntime 抛 → afterRound 抛。但 fire-and-forget 调用方(send/afterRound 上游)无 catch。**然而**:AgentMessage 由框架构造,无循环引用路径。无新问题。
- **mission/workingMemory 显式 clear 后持久化**:`setMission({})` 清空不落盘 是 deferred #1(已登记);`resetSession` 清 workingMemory 是否落盘 —— persistRuntime 在 send 后调,resetSession 后无 persist 触发 → 旧 workingMemory 仍在 storage。但 resetSession 是「新会话」语义,sessionId 变了(`core.sessionId = makeId()`),旧 sessionId 的 workingMemory 数据成为孤儿(下次 listSessions/switchSession 加载时仍会 restore)。**这其实是正确行为**:旧 session 的数据保留可追溯,新 session 干净。无新问题。
- **AgentMessage 工具调用相关字段演进**(`tool_calls`/`steps`/`reasoning`):ReAct 循环依赖这些字段识别工具响应,跨版本字段名变化会破坏循环。**但**:这是 LC 标准字段(`@langchain/core/messages`),字段名受上游约束,SDK 单方面演进概率低。无新问题。
- **Skill 持久化跨版本**:已迁移到独立 SkillStore(`storage.ts:65-66` 注释 + `backends/skillStore.ts`),与 SessionSnapshot 解耦;SkillSpec 形状演进走 SkillStore 自己的版本化(本审计不展开,属独立子系统)。无新问题。

---

## 计数

**P0×0 / P1×2 / P2×5 / P3×3 = 10 条**

P1: F1(版本号机制缺失,系统性)、F2(WorkingMemory.restore 抛 TypeError,实证)
P2: F3(checkpoint 跨 schema bind 污染)、F4(Todo id 位置推导)、F5(capabilities 关闭静默丢数据)、F6(VfsFile 字段不归一化)、F7(AgentMessage 字段不归一化)
P3: F8(孤儿 kind 无 GC)、F9(switchSession 不 await vfs clear timer)、F10(SessionMeta 无 schemaVersion)
