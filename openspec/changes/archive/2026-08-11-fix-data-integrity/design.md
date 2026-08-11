# Design: fix-data-integrity

> 六项 P1 修复的技术设计。原则:**默认路径零回归,修复即收紧(安全向)或收口(健壮向),新行为全部带测试锁定**。

## §1 P1-8/9:resetSession 收口统一

### 现状(createChatSdk.ts:1606)
```ts
resetSession: () => {
  if (!store) return              // ← P1-8:storage 关(默认)整体早退
  core.abortAllActive?.()
  core.sessionId = makeId()
  vfsStore.clear?.(); todosMw.reset([]); ...
  void store.createSession(...)   // store 依赖
  emit({ type: 'session_restored', ... })
  ...
}
```
触达路径唯一:ChatHeader「清空对话」→ useChat.clearMessages → `onClear()` → core.resetSession();useChat 随后 splice messages。headless 无入口(公开面没有 resetSession)。

### 修复后
```ts
resetSession: () => {
  core.abortAllActive()                          // 契约 C:先断在途流(防幽灵流写新会话)
  conflictMgr.resolve('keep_external')           // P1-9:收口挂起冲突(与 switchSession/unmount 对齐)
  core.sessionId = makeId()
  messages.splice(0, messages.length)            // 自包含清空(与 switchSession 对齐;useChat 再 splice 为 no-op)
  vfsStore.clear?.(); todosMw.reset([])
  if (!options.memory) memoryMw.reset('')
  missionMw.reset(); workingMemoryMw.reset(); focusMw.reset()
  if (checkpointMgr) checkpointMgr.importStack([])
  if (core.agent) core.agent.debugLogs.value = []
  if (store) { void store.createSession(core.agentId, options.session?.title, core.sessionId) }
  emit({ type: 'session_restored', sessionId: core.sessionId, rounds: 0 })
  void refreshSessions()                         // 内部已守卫无 store no-op
  lastTitle = undefined; titleLLMDone = false
}
```

**P1-9 顺序论证**:keep_external 语义 = 保留外部修改、**放弃本次写**(dataOps handleConflict 收到后返回「已保留外部修改」文本,不落写)→ 先收口冲突再重置状态,不存在「旧工具恢复后写新会话 bind」窗口。abortAllActive 在前:挂起冲突的工具所在流先 abort(signal 联动 conflict 自动收口为双保险),显式 resolve 兜底无 signal 联动的边缘。

**公开 API**:`ChatSdk.resetSession(): void`(同步;包装 `core.resetSession()`)。理由:① headless 集成方此前无任何清空入口(能力缺口);② e2e 可确定性验证 P1-8/9(否则只能浏览器点击路径);③ 与 switchSession 公开面补齐。types/index.d.ts + headless.d.ts 同步(types-alignment 门禁覆盖)。

## §2 P1-11:shareContext 串行闸上移 core

### 现状
- `runSerial`(serialRunner)与 `activeControllers`/`trackActive`/`abortAllActive` 均建在 `_createChatSdk` **实例闭包**(2235/2240)。
- shareContext 同 id 双实例共享 core,但各持私有闸 → 并发 send/switchSession 写同一 messages(H11 证实)。
- `core.abortAllActive = abortAllActive` 为**覆盖赋值**:后创建实例的注册表顶掉先创建实例的 → core.resetSession 的 abort 可能中止错误实例的流、或漏掉。

### 修复
`buildCore` 内(core 级,shareContext 天然共享):
```ts
const runSerial = createSerialRunner()
const activeControllers = new Set<AbortController>()
function trackActive(outer?: AbortSignal) { /* 原实现搬入 */ }
function abortAllActive() { /* 原实现搬入 */ }
core.runSerial = runSerial
core.trackActive = trackActive
core.abortAllActive = abortAllActive   // 恒定指向 core 自己的注册表,不再被实例覆盖
```
`_createChatSdk` 包装层改用 core 级:
```ts
send: (msg, opts) => core.runSerial(async () => {
  const { controller, untrack } = core.trackActive(opts?.signal)
  try { return await core.send(msg, { ...opts, signal: controller.signal }) } finally { untrack() }
}),
// batch / switchSession / stream 同构;switchSession 内 abortAllActive 改 core.abortAllActive()
```
mountChatDialog 的 `ctx.runSerial` 传 `core.runSerial`(UI 的 onNewSession/onOpenSession 与 API 层同链串行)。`core.stream` 的 trackActive 也改 core 级 → **UI 流式(fetchStream = core.stream)首次纳入在途流注册表**(此前 UI 流不登记,unmount abort 触不到)。

### 语义变化(留痕)
shareContext 下,生命周期收口(unmount/switchSession/resetSession)的 `abortAllActive` 中止**共享 core 的全部在途流**(含其他实例发起的)。推翻 2.39.0 注释「一个实例 unmount 不中断另一实例的生成」—— H11 已证共享状态下该语义不可维持(孤儿流写已被 switch 的 messages / release 已 dispose 的 store)。非 shareContext(每实例独立 core)行为不变;multi-agent-demo 类多 agent(不同 id)不受影响。
release()(refCount 归零)补 `abortAllActive()` 先行,再 dispose(防流在途关资源)。

## §3 P1-19:深投影统一

7 处根级读 `projectBySchema(val, allowKeys)`(浅,仅顶层 key)→ `projectBySchemaDeep(val, schema)`(深,递归 shape):

| # | 位置 | 场景 |
|---|---|---|
| 1 | getData `!jp` | get_data 整体读 |
| 2 | readSlot jsonPaths 模式 `!jp` 分支 | 多路径读根项 |
| 3 | readSlot 单路径 `!jp` | read 整体读 |
| 4 | queryData target | query_data 查询目标 |
| 5 | searchData target | search_data 搜索目标 |
| 6 | evalScript 根 source | eval 根模式入参 |
| 7 | diffData cur | diff 当前值侧 |

**门控不变**:`allowKeys` 非空 ⇔ schema 为 ZodObject;非 ZodObject(union/record/lazy)全开放向后兼容语义保持。`projectBySchemaDeep` 对 ZodObject 根必有 shape,安全。
**写路径不变**:set/edit/delete/write 的白名单逐段校验(isPathAllowed)与 merge 语义不动 —— 读收紧不连带写。
**eval transform 交互**:根 transform 的脚本入参从「浅投影(深层未声明可见)」变「深投影」;返回后 schema.safeParse + 白名单 merge 语义不变(未声明字段保留)—— 脚本看不到未声明字段,但写回也不会丢它们,一致。
**性能**:深投影 O(N),原浅投影 O(顶层 key);query/search/eval 本就全量遍历/深拷贝,增量可忽略。
`projectBySchema` 浅函数保留导出(内部不再消费),防外部引用破坏。

## §4 P1-25:压缩 LLM 摘要异步化(模板先行 + 前缀缓存)

### 机制(useContextManager 闭包内)
```ts
let llmCache: { coveredCount: number; text: string } | null = null
let llmInFlight = 0   // 防同轮重复 fire(重试/双触发)
```
compress 的 llm 分支重写:
```ts
if (summaryMode === 'llm' && config.llmInvoke) {
  const idxText = indexSummarize(older, preserveArg)
  const n = older.length
  if (llmCache && llmCache.coveredCount >= n) {
    summaryText = llmCache.text                     // 全覆盖(罕见:窗口回缩/同参重压)
    strategy = prefix + 'llm_summary(cached)'
  } else if (llmCache && llmCache.coveredCount > 0) {
    summaryText = llmCache.text + '\n' + indexSummarize(older.slice(llmCache.coveredCount), preserveArg)
    strategy = prefix + 'llm_summary(prefix)+index_tail'   // LLM 前缀 + 新增尾部索引
    fire(n, idxText)
  } else {
    summaryText = idxText                           // 首次:纯索引模板,零阻塞
    strategy = prefix + 'index_summary(llm_background)'
    fire(n, idxText)
  }
}
function fire(n: number, idxText: string) {
  if (llmInFlight) return
  llmInFlight++
  void config.llmInvoke!(idxText)
    .then((t) => { if (!llmCache || llmCache.coveredCount <= n) llmCache = { coveredCount: n, text: t } })
    .catch(() => { /* 失败保留模板;下次触发重试 */ })
    .finally(() => { llmInFlight-- })
}
```
**正确性论据**:① older 恒从 messages 首轮起(groupRounds 全量;压缩不改 state.messages)→ older 单调前缀扩展 → coveredCount 单调可比;② `indexSummarize` 用 `r.round` 绝对轮号,slice 尾部编号不错位;③ fire-and-forget 只写闭包缓存、不触 messages/store → unmount 后完成也无副作用(随闭包 GC),无需 trim-llm 式 indexOf 竞态守卫;④ trimMemoryMessages(OOM splice)使 rounds 错位 → 缓存不命中自然回退模板 + 重新 fire,无脏读(coveredCount 比对仅决定拼接,错配最多摘要质量降、不泄露 —— 投影/白名单不受影响)。
**成本**:每次触发仍恰好一次后台 LLM(与现状同步版同),不增 token;首 token 延迟 15s → ~0。
**decide 残留**:agentCompression 的 `decideInvoke`(≤6s)维持同步 —— 其结果直接决定本次切分参数,异步化需「用旧决策」语义,opt-in 功能本轮不动,design 留痕。

## §5 P1-26:markdown 渲染节流 + hljs 尺寸闸

### useMarkdown 重构
- 抽纯函数 `renderMarkdownHtml(text: string): string`(marked + renderer + sanitize)导出,可单测。
- `html` 从 computed 改 shallowRef + watch 尾随节流:
```ts
const THROTTLE_MS = 100, SYNC_MAX_CHARS = 2000
watch(content-getter, () => {
  if (content().length <= SYNC_MAX_CHARS || now - last >= THROTTLE_MS) renderNow()
  else if (!timer) timer = setTimeout(renderNow, last + THROTTLE_MS - now)   // 尾沿保证
}, { immediate: true })
onScopeDispose(() => clearTimeout(timer))
```
小消息(≤2K)每 delta 直渲(打字机体验不变);大内容 ≤10fps 渲染,流结束尾沿补齐最终态。
- **hljs 尺寸闸**(renderer.code 内):单代码块 > `HLJS_BLOCK_MAX = 20000` 字符 → 跳过 hljs,直接 escapeHtml(hljs 是单帧耗时大头;marked/DOMPurify 线性保留,**sanitize 永不跳过**)。
- `codeBlocks` computed 不变(regex 线性,轻)。
- MessageContent:`watch(() => props.content, enhanceCodeBlocks)` + onUpdated 双驱动改 **watch(html, enhanceCodeBlocks)**(渲染真发生才增强 DOM);onMounted 保留。

### 结果矩阵
| 内容规模 | 现状 | 修复后 |
|---|---|---|
| 短回复(<2K) | 每 delta 全量渲 | 不变(直渲) |
| 长回复(10-50K) | 每 delta 全量 O(n) → O(n²) 累计 | ≤10fps 节流,总量降 10-50× |
| 巨代码块(>20K/块) | hljs 每 delta 重高亮 | 转义直出(无高亮),sanitize 保留 |

## §6 风险矩阵

| 风险 | 缓解 |
|---|---|
| 深投影收紧读面,集成方隐性依赖泄露字段 | 本就是未声明字段(写路径早已不可达);安全修优先;proposal/README 记「依赖即声明」 |
| shareContext 语义变化(跨实例 abort) | 仅 shareContext:true 生效;文档明记;多 agent(异 id)不受影响 |
| resetSession 公开 API 被流式期间调用 | abortAllActive 先行 + keep_external 收口,同 switchSession 保障级别 |
| 压缩前缀缓存错配(trim splice 后) | 仅摘要质量降级,无安全/正确性影响;coveredCount 单调守卫 |
| 节流致流式渲染「卡顿感」 | 100ms 窗 + 小内容豁免;尾沿保证停止即最终态 |
| resetSession 不入 runSerial 串行 | 同步 API + abort/resolve 先行;与现状 UI 触达路径一致,不引入新竞态面 |

## §7 测试矩阵

| 层 | 新增 | 覆盖 |
|---|---|---|
| selftest sec-71 | ~18 断言 | 深投影 7 路(read/get/query/search/eval/diff/jsonPaths 根)隐藏嵌套未声明 + 子路径口径一致;压缩异步(首压零阻塞返模板 + 后台完成后前缀命中 + 尾部增量拼接 + 失败回退);renderMarkdownHtml(巨代码块无 hljs class / sanitize 保留) |
| e2e session-integrity.mjs | ~12 断言 | resetSession 无 storage(mission 清空 + sessionId 换新 + messages 清 + 不抛);冲突挂起中 resetSession(收口不挂 + pendingConflict null + 外部值保留);shareContext 双实例并发 send 串行(顺序/不交错) |
| browser | 复用现有 40 项回归 | 渲染/清空路径无回归(xss-sanitize / page-demo 读写流) |
| types-alignment | 自动 | resetSession 进 ChatSdk 面 → d.ts 不补即红 |

## §8 决策记录

| # | 决策 | 备选与否决理由 |
|---|---|---|
| D1 | resetSession 公开为 ChatSdk API | 仅内部修(headless 无入口 + e2e 不可测;否决) |
| D2 | 串行闸/注册表建在 buildCore(core 级) | 实例级 + 跨实例协议(复杂且 H11 已证不可维持;否决) |
| D3 | 深投影复用 projectBySchemaDeep,不新写 | 已为子路径读验证过的实现,单一真相源 |
| D4 | 压缩异步用前缀缓存而非消息内替换 | compressInput 不改 state.messages(无替换锚点);前缀单调可拼 |
| D5 | decide 维持同步 | 结果直接形参本次切分;opt-in 默认关,收益/风险比不足 |
| D6 | markdown 节流 100ms + 块级 hljs 闸 20K | 与 approval 30s/stall 90s 同表无冲突;阈值为体感/性能折中,可调 |
