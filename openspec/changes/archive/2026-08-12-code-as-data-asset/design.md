# Design: code-as-data-asset

> 技术设计。`/opsx:apply` 按此 + tasks 实施。
> **方法论**:§0 问题溯源 → §1 数据模型 → §2 框架自动 checkout/commit → §3 __pgId 无感知注入 → §4 read 摘要 → §5 子 agent 写入路径 → §6 commit 增量 + 孤儿清理 → §7 持久化 + SDK 边界 → §8 安全/校验 → §9 迁移。

## §0 问题溯源:C 方案(代码→vfs)在资产场景的裂缝

`add-capability-packs` §0.4「代码正文→vfs,data 存 codeRef 引用」基于「代码是会话级产物」假设。资产场景下三道裂缝:

- **持久化裂缝**:集成商只持久化 data json(不含 vfs)→ 恢复后 vfs 空 → 子 agent `vfs_read` 404 → 只能 `vfs_write` 重写
- **镜像非源裂缝**:codeSnapshots 是 vfs 的响应式镜像(驱动 UI),不是资产源;vfs 不进 DB,版本/协作无从操作
- **协作裂缝**:vfs 单会话工作区,无锁/无 merge/无版本模型

**结论**:资产场景下代码的**源**必须在 data(随 data json 进 DB)。vfs 降级为子 agent 编辑的工作副本。Git 模型:

```
Git                      本架构
remote repo (GitHub) ←→  服务端 DB        (资产源·版本·协作·多端)
local HEAD (已提交)  ←→  data bind        (响应式·UI 绑·code 字段是源)
working directory    ←→  vfs              (子 agent 试错·非响应式·会话级)
git checkout/commit  ←→  beforeAgent/afterAgent 钩子(框架自动,主 agent 透明)
git push/pull        ←→  persist/load data json
```

## §1 数据模型

### 1.1 代码作为 data 字段(资产源)

```
data.components[i] = {
  __pgId: 'c_a3f2',     ← 框架自动注入(稳定映射键,见 §3;集成商不声明)
  name: 'hero',
  code: '<html>...',    ← 代码正文(资产,进服务端 DB)
  props: {...}
}
```

- **code 是 data 的 string 字段**(资产),不是 vfs 引用。data json 含 code → persist 自然进库。
- **UI 直接绑 `data.code`**(响应式,v-html 渲染)。无需 codeSnapshots 镜像。
- **`__pgId` 框架自动管**(§3),集成商 schema 不声明、agent 看不到、persist 透明带。

### 1.2 vfs 工作副本(子 agent 编辑区)

```
vfs: html/<__pgId>.html = '<代码>'    ← 工作副本(会话级,子 agent 在此 vfs_edit 增量改)
```

- vfs 文件名 = `codeVfsPrefix + __pgId + ext`(用 __pgId,稳定;不用 index/name)
- 子 agent 在 vfs 改代码(`vfs_read` → `vfs_edit` → `validate_code` → verify),大代码增量友好
- vfs 是工作副本,**不是源**:每次 beforeAgent checkout 覆盖式刷新(data 当前 code → vfs),保证 vfs 始终是 data 最新快照

### 1.3 formatCheck 不用改(红利)

`formatCheck`(validate_code + verify 门禁)一直扫 vfs 文件。单模式下 vfs 仍是工作副本,formatCheck **继续扫 vfs**(不是扫 data code)。零适配。

## §2 框架自动 checkout/commit(X 全自动,主 agent 透明)

### 2.1 控制流

```
主 agent: read data(主 scope:code 摘要,不进上下文) → use_html("改 hero 标题红") → 收结论
          (不碰 checkout/commit,不碰代码正文)

框架(主 agent 看不见的自动搬运):
   use_html 触发子 agent
        │
        ▼ ① beforeAgent 钩子(子 agent 跑 LLM 前)
        扫 data.components(有 code 的项)→ 按 __pgId checkout 到 vfs
        内部:for comp of components(if comp.code): vfsStore[prefix+__pgId+'.html'] = comp.code
        记录 checkout 映射(__pgId ↔ vfsPath);hook vfs_edit/vfs_write 记目标集合(供增量 commit)
        │
   子 agent: vfs_read → vfs_edit(增量) → validate_code → verify(全在 vfs,代码在子上下文)
        │
        ▼ ② afterAgent 钩子(verify 门禁通过后)
        增量 commit:只写子 agent vfs_edit/vfs_write 过的文件 → 按 __pgId 回写 data.code
        内部:for path of touchedVfsFiles: dataBind.components[find(__pgId)].code = vfsStore[path].content
        (直改 bind,Vue 依赖追踪触发 UI;不经 write 工具 → 不进快照栈)
        │
   主 agent 收子的结论 → 集成商 persist data json 到服务端
```

### 2.2 为什么 X(全自动)优于显式工具

| 维度 | X 全自动(本设计) | 主 agent 显式 transfer_code |
|---|---|---|
| 主 agent 调什么 | use_html(1 步) | read+checkout+use_html+commit(4 步) |
| LLM 出错风险 | 低(框架兜底) | 高(漏 checkout→404 / 漏 commit→不更新) |
| 主 agent 控制权 | 无(框架无条件 commit) | 有(可审查) |
| 主上下文干净 | ✓(read 摘要挡) | ✓(工具返回元信息) |

主 agent "审查代码"是虚假安全感(看不懂细节);真校验在 verify 门禁 + 集成商渲染层。X 让出不重要的控制权,换可靠性 + 零负担。

### 2.3 钩子直改 bind(不经 write 工具)—— 解快照栈膨胀

afterAgent commit 直接 `dataBind.components[i].code = vfsContent`(赋值 reactive 字段),**不经 dataOps write 工具**:

- → **不 push 快照栈**(快照栈是 write 工具维护的;代码版本历史交服务端 DB,SDK 快照栈只存业务字段回退)
- → 不经 schema.safeParse(code 是 string,校验无意义;verify 门禁已保证代码质量)

**data 写入两条路径**(design 契约写明):
- **LLM write 工具**(主/子 agent 调):经完整契约(schema/乐观锁/快照栈/path guard)
- **框架钩子**(afterAgent commit):直改 bind(快路径,仅 code 字段豁免 write 契约)

## §3 `__pgId` 无感知注入(集成商零感知)

### 3.1 注入流程(createChatSdk 装配期)

```
集成商:createChatSdk({
  data: { schema(无 __pgId), bind },
  subagents: [createHtmlSubagent({ writablePaths:['components'] })]
})
       │
       ▼ 装配期
框架检测:htmlSubagent 的 writablePaths = ['components']
       → 找 data schema 的 components 节点 → z.array → 元素 z.object
       → extend 加 __pgId:z.string().optional() → extendedSchema(框架内部)
       │
       ├─ projectBySchemaDeep(读投影):过滤 __pg* 前缀 → agent/集成商 read 看不到 __pgId
       ├─ isPathAllowed(写白名单):用 extendedSchema → __pgId 允许写
       └─ write 钩子:拦截 components 路径 set → 自动生成/保持 __pgId
```

集成商四无感知:
| | 集成商要做什么 | 实际 |
|---|---|---|
| schema | 声明 __pgId | ❌ 不用(框架 extend) |
| read | 处理 __pgId | ❌ 不用(投影过滤 __pg*) |
| write | 生成/填 __pgId | ❌ 不用(write 钩子自动补) |
| persist | 特殊处理 __pgId | ❌ 不用(data json 带 __pgId 存服务端,当普通字段;load 回来框架用) |

### 3.2 `__pg` 前缀 = 框架内部命名空间约定

所有 `__pg*` 字段都是框架管的内部元数据(像 Vue 的 `__v_isRef`):read 投影自动隐藏,集成商/agent 都不碰。给未来其他内部字段留扩展空间。

### 3.3 fallback(Zod 结构多样,不保证 100% 解析)

集成商 schema 多数是 `z.array(z.object(...))`(直接解析 ✓)。边缘结构(`z.array(z.union([...]))` / discriminated / optional 等)解析难 → **降级**:

```
装配期解析 components 元素 schema 失败
  → console.warn('[page-agent-sdk] 无法自动注入 __pgId:components 结构非 array<object>,请在 schema 声明 __pgId')
  → 降级:要求集成商 schema 声明 __pgId:z.string().optional()(回到显式声明)
```

不抛错(不阻断);常见结构无感知,边缘降级 + warn。

### 3.4 id 生成时机 + 稳定性

- **生成**:子 agent write 新建组件时,框架 write 钩子检测 `__pgId` 空 → 自动生成(`'c_' + nanoid/随机`)写回 data
- **稳定**:一旦生成,随 data persist 到服务端;跨会话/跨设备 load 回来,__pgId 不变(框架不重新生成已有 id)
- **vfs 文件名**:`codeVfsPrefix + __pgId + ext`(用 id,不用 index/name;组件重排/改名不影响映射)

## §4 read 大文本字段摘要(配套不变量)

### 4.1 问题

主 agent 要 read data 看结构(知道 components 有哪些、要改哪个),但 read 返回完整对象时 `.code`(几十 KB)进上下文 → 违背「主上下文不碰代码」。

### 4.2 方案:标记驱动 + 只对主 scope

```ts
// read 内部(projectBySchemaDeep 后):
// ① 只对"标记为大文本"的字段摘要(标记驱动,不碰业务长文本)
// ② 只对主 scope(子 agent 改 code 需完整读)
if (isMainScope(ctx) && isLargeTextField(field, val)) {
  return `<code ${formatBytes(val.length)}>`   // 如 <code 2.3KB>
}
```

- **标记驱动**:只摘标记字段(codeAsAsset 模式下框架自动标 code 字段)。集成商业务长文本(产品描述/富文本)**不受影响**,原样返回。
- **只对主 scope**:主 agent read → code 摘要;子 agent read → code 完整(子要改 code)。scope 判定经 ToolCallContext 的 activeScope/scopeId(已有机制)。
- **data bind 原值不变**:占位仅作用于 read 返回(给 LLM);bind 恒持原值(与 vfs offload 占位符边界替换契约一致)。write/checkout 取 bind 原值。

### 4.3 与现有机制关系

- **vfs offload 占位符**:大结果外存,边界替换 —— 本机制复用思路
- **read fields 参数**:LLM 可主动排除大字段(已有);摘要机制是**兜底**(LLM 没传 fields 时也不泄露)
- **非 codeAsAsset 用户**:read 行为完全不变(没有标记字段)

## §5 子 agent 两条写入路径

```
新建组件(无 id 映射需求):
   子 agent: write({patch:{op:'set', jsonPath:'components.N', value:{name, code:<正文>, props}}})
            ↑ write 钩子自动补 __pgId;code 作为字段值直接进 data(子上下文本就有它生成的代码)
            ↑ 不经 vfs/checkout/commit(新组件没旧代码可 checkout)
            ↑ write code 字段时框架顺带跑 validateHtmlFormat(一致性:新建也校验)

修改组件(需 id 映射):
   框架 beforeAgent: checkout(data.code → vfs,按 __pgId)
   子 agent: vfs_read → vfs_edit(增量) → validate_code → verify
   框架 afterAgent: commit(vfs → data.code,按 __pgId,增量只写改过的)
```

id 映射只在修改路径需要(基于 checkout 时已存在的组件建立,稳定)。新建走 write,无映射问题。

## §6 commit 增量 + 孤儿清理

### 6.1 增量 commit(只写改过的)

afterAgent **不全量**回写(全量会用 checkout 时的旧快照覆盖未改组件的外部修改)。只写子 agent 实际 `vfs_edit`/`vfs_write` 过的文件:

- beforeAgent/ vfs 中间件 hook `vfs_edit`/`vfs_write` → 记录 `touchedVfsPaths:Set<string>`
- afterAgent commit:只遍历 `touchedVfsPaths` → 按 __pgId 回写 data.code

### 6.2 删除组件的 vfs 孤儿

子 agent 删组件(write del components.N)→ data 项没了,但 vfs `html/<id>.html` 还在。afterAgent commit 时该 vfs 文件的 __pgId 在 data 找不到 → **清 vfs 文件 + 不写 data**(框架处理)。

## §7 持久化模型 + SDK 边界

### 7.1 data json 含 code → 服务端 DB

```
persist:  data.json(含 code + __pgId)──POST──▶ 服务端 DB(代码随行,版本/协作在 DB)
load:     服务端 DB ──GET──▶ data.json ──applySnapshot──▶ data bind(code + __pgId 恢复)
                                                          ↓
                                            主 agent use_html → beforeAgent checkout → vfs 恢复 → 增量改
```

### 7.2 SDK 边界(明确职责)

| 职责 | 归属 |
|---|---|
| data json 结构化 + 响应式 bind | SDK |
| 单会话乐观锁(防读旧被外部改) | SDK |
| checkout/commit(data↔vfs) | SDK(框架自动钩子) |
| `__pgId` 注入 + 维护 | SDK(框架自动) |
| 服务端 DB 存储 | **集成方** |
| 版本历史 / 回滚 / diff | **服务端** |
| 多人协作冲突 / merge | **服务端** |
| 多端同步 | **集成方**(load 时 hydrate) |

### 7.3 协作 stale checkout(非阻塞,文档化)

SDK 乐观锁是**单会话内**(data bind hash)。协作场景:A commit+push 后,B 的 data 没刷新就 checkout 改 → 覆盖 A。SDK 防不了"服务端已被他人改"。**集成商 persist 前需从服务端拉版本号比对**(服务端职责)。design 文档化此边界。

## §8 安全 / 校验

- **`__pgId` 路径**:`isPathAllowed` 用 extendedSchema(__pgId 在白名单);agent 不能写 __pgId(write 钩子框架独占,agent write __pgId 被 path guard 拦或框架覆盖)
- **vfsPath 校验**:vfs 文件名须 `codeVfsPrefix + __pgId + ext` 格式;越界返错误
- **commit 经 verify 门禁**:afterAgent 在 verify(标签闭合 + 片段契约)通过后才 commit;脏代码不落 data
- **新建 code 也校验**:子 agent write code 字段时框架顺带 `validateHtmlFormat`(新建与修改一致校验)
- **子 agent 直接 write data code(约定级风险)**:writablePaths 允许子 agent write components.N.code,理论上可绕 vfs/verify。靠 prompt 引导("代码必经 vfs_edit")+ 集成商 persist 前服务端校验覆盖。同 codeRef 既有约定级,不引入字段级只读(复杂度高、收益低)
- **复用现有机制**:path guard / schema 校验 / verify 门禁,无新安全面

## §9 迁移(breaking major)

### 9.1 现有 codeRef 集成方迁移

1. **schema**:components[i] 加 `code: z.string()` 字段(替代/并存 codeRef);去掉 codeSnapshots 镜像字段
2. **UI**:绑 `data.components[i].code`(替代 codeSnapshots[p])
3. **createHtmlSubagent**:去掉 `onComplete` 回调(框架自动 commit);去掉 codeKind 存储分支(单模式)
4. **persist**:整体 data json 发服务端(含 code)
5. **一次性数据迁移**(若 vfs 有存量代码):加载时若 codeRef 指向 vfs 有文件、code 字段空 → 自动 vfs→code 填充(迁移钩子)

### 9.2 demo

- `examples/html-page-demo`:改单模式(schema 加 code + UI 绑 data.code + mock 服务端 persist 往返按钮)
- `examples/html-subagent-demo`:同步改单模式(若存在 codeRef 用法)
