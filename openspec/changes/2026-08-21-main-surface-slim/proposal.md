# Proposal: main-surface-slim(主 agent 视野面瘦身:上下文层裁剪,机制层不动)

> 状态:**规划完成待实施**。优先级 P1。目标仓库:zhuanti-agent(SDK)。
> 驱动:2026-08-21 复杂度审计(用户提问「插件/中间件/工具/提示词是否过度复杂、是否降低大模型表现」)。结论:**会** —— 实测 editor 场景主 agent 视野 = 42 工具 schema(~2.4K tok)+ systemPrompt 3.9K tok/17 段 + 中间件 pin 段,单轮 11 次工具循环烧 ~70 万 prompt token;指令遵循率随指令数衰减的质量短板已实测(确认规则被无视、质量标准半执行/层级恒平铺)。

## Why(复杂度审计数据,2026-08-21)

| 复杂度源 | 实测值 | 层 | 结论 |
|---|---|---|---|
| 主 agent 工具池 | **42 个**(editor 诊断 JSON 实测) | 上下文层(每轮进 LLM 视野) | **主因,可砍** |
| systemPrompt | 3.9K tok / 17 段(editor 侧,含 996 tok 质量标准) | 上下文层 | editor 侧可拆 skill(本 change 不动 editor prompt,属 editor 配方优化) |
| 中间件 | 主栈 27 个 | **机制层**(对模型透明,不占上下文,仅违规时回灌) | 不动 —— 每个门禁对应一条实测事故,砍了今天修的问题就回来 |

**工具池冗余点(全部有代码证据)**:

1. **`vfs_*` 9 工具对主 agent 无用**:vfs 工作副本是 html 子 agent 的职责(`allowedTools: ['vfs_write','vfs_edit','vfs_rm','vfs_grep','vfs_read']`);主 agent 拿到这 9 个工具只增加选择干扰(实测 flash 在「直接 write vs 委派」间摇摆,与工具过多直接相关)。但**不能简单撤**:子 agent 工具 = 主栈 allTools 按白名单筛选(`buildChildTools(pool, allow)`),主栈撤了子 agent 就饿死
2. **`get_data/set_data/edit_data/delete_data` 与 `read/write` 新旧同职能并存**(dataOps.ts 938/959/999/1045 vs 1326/1418):editor 侧 prompt 用 168 tok「工具纪律」段教 LLM 别用旧的 —— 提示词补偿工具面混乱,治标
3. **offload 依赖**:`vfsAvailable = allTools.some(t => t.name === 'vfs_read')`(createAgent.ts:677)—— 大结果外存判定依赖 vfs_read 在**全量池**里,主栈撤了不能误伤外存

## What Changes

### 1. `dataOps.tools?: string[]` 白名单(装配期工具面裁剪,createDataOps 输出过滤)

`createDataOps(config, { tools: [...] })` / `createChatSdk({ data: { ..., tools } })`:

- 不传 = 现状全量(**零回归**)
- 传 `['high']` 预设别名 = 高层套(`describe_data/read/write/schema_data/diff_data/query_data/search_data/eval_script/restore_data/history_data`),**不再输出 `get_data/set_data/edit_data/delete_data`** —— 单一职责:新旧同职能工具二选一,提示词「工具纪律」段可随之删
- 传具体名单 = 按名单过滤(集成方完全自控)
- **`set_data` 依赖链处理**:`restore_data` 回退/`history_data`/`conflictPolicy` 内部逻辑不经工具名,不受影响;`eval_script` transform 写回仍走内部通道

### 2. vfs 主栈暴露面开关 `vfs.mainTools:false`(默认现状)

`capabilities.vfs` 语义拆两层:**能力**(store + offload + 子 agent 桥接,恒开)与**主栈工具暴露**(默认 true 现状):

- `options.vfs = { mainTools: false }` → vfs 中间件的 `tools` 不注入主栈(`beforeAgent files 注入`、offload、子 agent allowedTools 筛选全保留 —— 子 agent 的池是 `middlewares.flatMap(m => m.tools) + userTools` 的 allTools,**需改为「子 agent 筛选池含被主栈隐藏的 vfs 工具」**:装配期把 vfs 工具数组单独传给 subagentsMiddleware 的 allTools 合并源)
- **offload 依赖修复**:`vfsAvailable` 判定改从「vfs store 是否存在」取(createAgent 已有 `ctx.state.files` 注入点,`state.files` 非空即外存可用,不再绑工具名)——主栈隐藏 vfs_read 后大结果外存照常
- editor 建议:`capabilities.vfs: true`(现状)+ `vfs: { mainTools: false }` → 主 agent 42 → 32 工具

### 3. usageHints 工具面联动

usageHints 中间件的提示词按能力开关注入;主栈撤 vfs 工具后,vfs 用法段不再注入主 agent prompt(子 agent 的 systemPrompt 独立生成,不受影响)。「工具纪律」类提示段随裁剪消失(editor 侧 prompt.js 后续自行删,SDK 无强依赖)。

## Impact

| 项 | 变更 |
|---|---|
| `dataOps.ts` | `DataOpsOptions.tools?: string[] \| 'high'` 白名单过滤(~30 行) |
| `vfs.ts` / `createChatSdk.ts` | `vfs.mainTools` 开关 + 子 agent allTools 合并源调整 + offload vfsAvailable 改 state.files 判定(~40 行) |
| `usageHints.ts` | vfs 段条件注入调整(~10 行) |
| editor(建议非强制) | `vfs: { mainTools: false }` + `data.tools: 'high'` + prompt.js 删「工具纪律」段 → 主 agent 视野 -10 工具 -168 tok 提示段 |
| 兼容 | 全部 opt-in,不传零变化;types/index.d.ts 同步 |

## 验收

1. selftest:白名单过滤(不传=全量 / 'high' 预设 / 具体名单 / 名单含不存在名 warn)+ mainTools:false 主栈无 vfs 工具但子 agent allTools 含 + offload(state.files 有 → 外存照常,主栈无 vfs_read 不退化截断)
2. e2e:`data.tools:'high'` 时 inspect().tools 不含 get_data;`vfs.mainTools:false` 时主栈工具数 -9、`use_html` 委派后子 agent 改码 commit 落地(子 agent vfs 工具链路不回归)
3. 真 LLM(editor):42 → 32 工具后跑同 prompt 对比,观测工具选择稳定性(直接 write/委派摇摆是否减少)+ 固定 token 开销下降

## 非目标(Non-goals)

- **不动机制层**:27 个中间件(门禁/护栏/压缩/记忆)零裁剪 —— 每个对应实测事故,复杂度税低(不占上下文)
- 不动 editor 侧 systemPrompt 拆分(996 tok 质量标准拆 skill 属 editor 配方,另行)
- 不做工具 schema 本身的精简(描述文案优化收益小于裁剪,且描述是 LLM 选择工具的依据不宜削)
- `spawn_agent/spawn_agents` 与 `use_html` 并存(spawn 是通用通道、use_* 是预声明快捷)不动 —— editor 只声明了 use_html,spawn 对它可后续经 subagent.allowedTools 收,但那是 editor 配置选择
