# Design: fix-main-sub-isolation

## 1. per-scope 乐观锁基线(P1-13)

### 1.1 状态结构(dataOps.ts)

```ts
// 原:let lastReadHash: string | undefined
const MAIN_SCOPE = ''                          // 主 scope 键
const baselines = new Map<string, string>()    // scopeId → 最后读/写后的 bind hash
let activeScope: string = MAIN_SCOPE

const getBaseline = () => baselines.get(activeScope)
const setBaseline = (h: string | undefined) => {
  if (h === undefined) baselines.delete(activeScope)
  else baselines.set(activeScope, h)
}
```

- 全部 `lastReadHash = X` → `setBaseline(X)`;全部读点(`effHash = ... lastReadHash`)→ `getBaseline()`。机械替换(约 15 处:read/get_data/set/edit/delete/write/eval transform×3/restore/draft_commit + controller.set/update 的 `baselines.clear()`)。
- `controller.set`(setData)/`update`(替换 bind):`baselines.clear()` —— 对齐现状「替换后乐观锁 hash 重置」(所有 caller 的基线一并失效)。

### 1.2 controller 新 API(可选方法,向后兼容)

```ts
interface DataOpsController {
  ...
  /** 进入数据 scope(子 agent 委派用);返回恢复函数(嵌套安全:恢复上一层 scope) */
  enterScope?(id: string): () => void
  /** 删除 scope 的基线条目(委派结束清理) */
  exitScope?(id: string): void
}
```

实现:`enterScope = (id) => { const prev = activeScope; activeScope = id; return () => { activeScope = prev } }`;`exitScope = (id) => baselines.delete(id)`。

### 1.3 工具 marker + 子池 scope proxy

- createDataOps 返回前给每个工具挂不可枚举 marker:`Object.defineProperty(t, '__dataOpsScoped', { value: true })`(经 wrapWithPathGuard 的 Proxy 透传可见 —— 其 get trap 非 invoke 属性走 `Reflect.get(target, ...)`)。
- runSubagent:子工具池构建后,若 `opts.enterDataScope` 存在,把带 marker 的工具包 scope proxy:

```ts
const scopeId = `sub-${depth}-${rand}`
const wrapWithScope = (t) => new Proxy(t, {
  get(target, prop) {
    if (prop !== 'invoke') return Reflect.get(target, prop)
    return async (args: unknown) => {
      const exit = opts.enterDataScope!(scopeId)
      try { return await target.invoke(args) } finally { exit() }
    }
  },
})
// runSubagent finally:opts.exitDataScope?.(scopeId)
```

- createChatSdk 装配(subagentMw + subagentsMw 两处):`enterDataScope: dataOpsController ? (id) => dataOpsController.enterScope!(id) : undefined`,`exitDataScope` 同理。dataOps 关闭 → undefined → 零行为变化。

### 1.4 语义结果(逐场景)

| 场景 | 现状 | 修后 |
|---|---|---|
| 父 read A → 委派(子 read)→ 外部改 → 父写 | 静默放行(基线被子刷新)❌ | VERSION_CONFLICT(父基线仍是 A)✅ |
| 父 read → 委派(子 writablePaths 写)→ 父写 | 静默放行 ❌ | VERSION_CONFLICT / 冲突介入 ✅ |
| 子 read → 子写(autoLock) | 用主基线(可能误冲突/误放行) | 用子自己 scope 基线 ✅ |
| 主独占(无子 agent) | — | 行为不变(MAIN_SCOPE 单键)✅ |

## 2. autoLock 解析点加固(N1)

立项复查结论:N1 原场景(同轮多写连环冲突)在当前代码**不可复现** —— 写成功即刷基线 + effHash 解析→检查→提交无 async 间隙(拦截器同步;handleConflict 无冲突分支同步)。加固内容:

- writeSlot 保持「拦截器之后、检查时刻」解析(现状已是;加注释锁定契约,防未来在解析与检查之间插入 await 回归 N1)。
- set_data/edit_data/delete_data/draft_commit 同样在 handleConflict 前一刻解析(现状已是)。
- 回归测试(selftest + e2e):同 scope 连续写 A→B 不冲突;并发语义文档维持「精确锁显式传 expectedHash」。

## 3. spawn_agents allSettled(P1-14)

```ts
// spawnMany fn(每个任务):
try { const r = await runSubagent(...); return { ok: true as const, text: r } }
catch (e) { return { ok: false as const, error: String((e as Error)?.message ?? e) } }

// 聚合(工具必返回字符串,不再整体 reject):
results.map((r, i) => r === undefined
  ? `【子任务 ${i + 1}】(未完成:abort/未启动)`
  : r.ok ? `【子任务 ${i + 1}】✓\n${r.text}`
         : `【子任务 ${i + 1}】✗ 失败:${r.error}`).join('\n\n')
```

- 孤儿问题消解:无早退 reject,所有已启动任务跑完并各自结算。
- tracker.finish(done/error) 现状已逐任务记录,不变。

## 4. 子 usage 回传(P1-17a)

- `utils/contentParts.ts` 新增纯函数:

```ts
export function normalizeUsage(message: BaseMessage): TokenUsage | null
// extractUsage 取原始对象 → camelCase 归一(promptTokens/tokenUsage 等)→ {prompt,completion,total};全 0 → null
```

- sdk-events afterModel 与子栈共用(消重)。
- runSubagent 子栈追加(仅 `opts.onUsage` 存在时):

```ts
{ name: 'sub-usage', afterModel: (res) => { const u = normalizeUsage(res.message); if (u) opts.onUsage!(u) } }
```

- createChatSdk:`onUsage: (u) => { usage.prompt_tokens += ...; ... }`(累加进 core.usage,与 sdk-events 同一 usage 对象)。**不发 onEvent('usage')**:子轮次混入主轮事件流会困惑集成方;sdk.usage 累计值天然含子(文档注明)。

## 5. 子执行超时(P1-17b)

```ts
// runSubagent:
const childAc = new AbortController()
const onParentAbort = () => childAc.abort()
signal?.addEventListener('abort', onParentAbort, { once: true })
try {
  const streamP = child.stream(msgs, handler, childAc.signal)
  if (!opts.timeoutMs || opts.timeoutMs <= 0) return await streamP
  let timer: ReturnType<typeof setTimeout>
  const timeoutP = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`子 agent 执行超时(${opts.timeoutMs}ms),已中止`)), opts.timeoutMs)
  })
  try { return await Promise.race([streamP, timeoutP]) }
  finally { clearTimeout(timer!) }
} finally { signal?.removeEventListener('abort', onParentAbort) }
```

- 超时 → race reject → spawnOne/spawnMany 逐任务 catch → 错误文本回灌(recoverable,主 LLM 可重试/拆小子任务)。childAc.abort() 令子流停滞收口(复用 fix-hang-and-feedback 的 abort 链:子 createAgent signal → 流中止)。
- 注:timer reject 时 streamP 仍在途 → abort 后子流收口;streamP 的 rejection(abort 错误)无人 await → 挂 `.catch(() => {})` 防 unhandled(同 stallTimeout 模式)。
- 配置面:`createChatSdk({ subagent: { timeoutMs } })`(行内类型补字段)+ `SubagentOptions.timeoutMs`;默认 undefined = 关(向后兼容;长任务子 agent 如 html-builder 不被误杀)。

## 6. 风险矩阵

| 风险 | 缓解 |
|---|---|
| scope 切换遗漏(某 dataOps 路径未走 getBaseline) | 全量替换 lastReadHash 引用(tsc 无残留引用);selftest 覆盖读/写/删/eval/restore/draft 后基线归属 |
| 子 scope 条目泄漏 | runSubagent finally exitScope;条目仅 string 键值,即使漏也无界(每次委派 1 条) |
| maxParallelTools>1 + spawn 并行的 activeScope 交错(M3 同族) | 每次 invoke 独立 enter/restore(嵌套安全);交错窗口与现状 currentSignal 同级别,不劣化;文档记录 |
| allSettled 后主 LLM 忽略失败项 | 聚合文本 ✗ 标记显式 + 错误摘要;主 LLM 决策(与单 spawn throw 回灌同等语义) |
| usage 重复计 | 子栈无 sdk-events(裸 createAgent);sub-usage 只在 onUsage 注入时装;单一累加点 |
| 超时误杀长任务 | 默认关,opt-in;文档建议 html/RAG 长任务子 agent 不配或配大值 |

## 7. 测试矩阵

- **selftest sec-70**:enterScope 嵌套恢复 / 子 scope read 不动主基线 / 子 scope write 不动主基线 / setData 清全部 scope / dataOps 工具 marker 存在 / writeSlot 拦截器 async 间隙期间另一写提交 → 第一写不冲突(延迟解析)/ 同 scope 连续写不冲突。
- **e2e main-sub-isolation.mjs**(StubChatModel):① spawn_agents 一失败一成功 → 聚合文本含 ✓/✗ 且主流程继续;② 父 read → 子 read → 外部改 bind → 父 write → VERSION_CONFLICT 回灌且 bind 未被覆盖;③ 子 usage 计入 sdk.usage(stub usage 字段);④ subagent.timeoutMs 短超时 + stub delayMs → spawn 返回超时错误文本。
- **browser**:无 UI 改动,跑既有 40 项回归。
