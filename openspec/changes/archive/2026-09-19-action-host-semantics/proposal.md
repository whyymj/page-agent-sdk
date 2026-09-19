# action-host-semantics:宿主 action 的读失效追踪与延迟生效写口径

> **状态**:✅ 已实施(2026-09-19,随 4.20.0 发布;10/10 任务勾,commit 41c0ce8/master f010524;2026-09-19 归档)。
> 来源 = 学习门户「笔记编辑 + AI 提案修改」真集成审阅(`Obsidian/learning`,openspec/changes/add-ai-assisted-note-editing):宿主用 `actions` 注册 `read_note_source`/`propose_note_edit` 自建「提案-评审-应用」通道时,发现两处 SDK 级缺口。定级 minor(公开面纯加法)。与 [`2026-09-19-content-proposals`](../2026-09-19-content-proposals/)(大项)互不依赖,先行独立可发。

## 现状勘察证据

**缺口 C:宿主 action 读结果不进宿主变更失效面**

- `src/core/harness/readInvalidation.ts:200`:`PAGE_READ_TOOLS` 硬编码五工具(`read_page`/`dom_search`/`dom_info`/`get_dom`/`take_screenshot`);`notifyHostChange` 的占位替换(230 行 `PAGE_READ_TOOLS.has(hit.name)`)只认这五个。
- 宿主 action `read_note_source`(读 wiki 源文)与 `read_page` 同为「宿主态读取」,但**不在失效面** —— 门户 apply 提案后只能靠 `notifyHostChange` 的 reason 文案「告知」模型,旧的 `read_note_source` ToolMessage 不被替换为过期占位:与 read_page 的机械保证不对齐,长对话里模型仍可能引用旧源文。
- `src/core/harness/actionGate.ts:310`:页面断言门禁的「本轮页面依据」计数也只认 `PAGE_READ_TOOLS` —— `read_note_source` 明明是页面依据,却不被计入(模型断言「原文写了 X」而依据只有 action 读时,门禁可能误伤回灌)。

**缺口 D:延迟生效写(提案类 action)的诚实性口径**

- `src/core/sdk/actions.ts:18` `ActionDef = { description, run, params? }`,无任何语义标记。
- 门户的 `propose_note_edit` 提案后效果**待用户点「应用」才生效**。模型若收口「已修改完成」:该 action 不是 `writeCapable`,零工具收尾门禁(`actionGate.ts` imperative-zero-tool-gate)的事实清单(工具计数/成功写路径/write×0/todos 完成度)不认识「N 次为提案类调用,**待用户确认、未生效**」这个状态 —— 目前靠门户 EDITING_PROMPT 提示词兜(「提案后如实告知…用户点应用才会写回」),机制层无供给。
- 配套盲区:用户隔一轮问「改好了吗」,模型只能重读源文猜,无状态查询闭环(本 change 只做事实清单口径;状态查询由 content-proposals 的 `proposal_resolved` 事件闭环,不在此做)。

## 修法(两段式)

### S1 `ActionDef` 两个语义标记(纯加法)

```ts
export interface ActionDef {
  description: string
  run: (args) => unknown | Promise<unknown>
  params?: ZodTypeAny
  /** C:标记本 action 读取宿主态(结果随宿主变更过期)→ 注册进 notifyHostChange 失效集 */
  readsHostState?: boolean
  /** D:标记本 action 的效果延迟到用户确认才生效(提案类)→ 零工具门禁事实清单区分「已生效/待确认」 */
  deferredWrite?: boolean
}
```

- **C 落点**:createChatSdk 装配期收集 `readsHostState` 的 action 名 → 有效集 = `PAGE_READ_TOOLS ∪ 标记集`(静态,actions 不支持运行时增删)→ hostNotice 中间件的 `invalidatePageReads` 与页面断言门禁的依据计数(`actionGate.ts:310`)统一改用有效集(单一真相源;`invalidatePageReads` 加可选 `extraTools` 参,默认集不动零回归)。`inspect().hostReadsInvalidated` 计数口径不变(action 占位替换同样计入)。
- **D 落点**:零工具门禁事实清单构建时,统计本轮 `deferredWrite` action 的成功调用次数,事实清单追加一行「其中 N 次为提案类调用(待用户确认,尚未生效)」;**等效写计数明确不含** deferredWrite action(它们的语义就是「未写」)。回灌既有预算/豁免机制零改动 —— 只是把「机制供给事实防嘴硬」的事实面补全,模型谎报「已修改完成」会被事实清单戳穿并回灌纠正。
- 双标记可同用(门户 `propose_note_edit` 不读宿主态、`read_note_source` 不延迟生效,各用一个)。

### S2 可观测与文档

- `actionsToInspectInfo`(actions.ts:68)信息面 + `readsHostState`/`deferredWrite` 两布尔(集成方按 inspect 反射装配态)。
- usageHints:`hasActions` 既有行不扩(工具 description 归宿主;SDK 不教宿主 action 语义)。

## 设计决策点

- **D1 为什么是标记不是自动判定**:action 是否「读宿主态」「延迟生效」只有集成方知道(同名 action 在不同宿主语义不同),自动猜测必然误判;标记 = 声明式零惊喜,不传 = 现行为零回归(既有集成方不受影响)。
- **D2 C 不动 stale-read-invalidation(数据写驱动)**:那套按数据路径失效,与页面读互斥域;`PAGE_READ_TOOLS` 在写驱动失效里本就被排除,无耦合。
- **D3 D 不做 `proposal_status` 查询工具**:通用 action 无统一的「查询裁决结果」通道(裁决在宿主侧,SDK 不知情);content-proposals 大项里以 `proposal_resolved` 事件 + 下轮结局注入闭环,本 change 不预铺。

## 范围红线

- 不改 `PAGE_READ_TOOLS` 默认集(五工具之外的新内置工具不因此进失效面)。
- 不给 action 加运行时生命周期(增删/替换)—— 既有 `setTools` 族只管 defineTool 工具,本 change 不扩。
- 不动 approval/conflict/gate 预算与豁免机制。

## 验收门禁

- selftest:有效集合并纯函数 / 事实清单 deferredWrite 注记行 / 未标记 action 零行为差。
- e2e:标记 action 的 ToolMessage 被 `notifyHostChange` 置占位(`inspect().hostReadsInvalidated` 递增)/ 未标记不被置 / inspect().actions 反射双标记 / Stub 模型「propose 后谎报完成 → 事实清单注记 → 回灌纠正」一轮闭环。
- 门禁全绿 + 计数同步(CLAUDE.md/README×2/CHANGELOG);发布前询问用户。
