# Proposal: path-scoped-validation(write 校验局部化,拔「兄弟节点株连」架构根因)

> 状态:**规划完成,未实施,已过怀疑论评审回改**(写回语义/strip 联动/append 株连复刻/union 处理四处补设计)。优先级 P0(数据安全结构性隐患)。测试用例集 C-04 家族的根治方案(editor schema union 只是堵了当前一个洞)。

## Why(实测事故 + 架构分析,2026-08-20)

editor_fangzhou 实测:编辑器原生组件 `script` 是空字符串 `""`,schema 声明 `z.array` → **任何单点写入**都报 `SCHEMA_INVALID「5 处问题」`(details 全是其他兄弟节点的 script)—— 改 A 被 B 的脏数据拦死,agent 被迫批量改数据迁就 schema。

editor 侧已用字段级 union 堵住 script/animate/events(editor 实际形态:递归 `z.object` + **字段级** `z.union`,如 `script: z.union([z.string(), z.array(z.unknown())])`,pageData.js:26-48;元素级 union 是 complex-demo 形态),但 **SDK 架构根因未动**:

```
write 路径现状(dataOps.ts):
patch set → isPathAllowed 逐 patch ✓(本就是 path 级)
         → applyPatchToClone 得 newBind
         → schema.safeParse(newBind)  ← ★ 整对象校验:全 bind 每个节点都过堂
         → 写回 res.data(zod strip 后解析值,fix-write-safety-bypass P0-1 防线)
```

后果:**任何字段未来再出现「真实数据形状 ≠ schema 声明」,株连复发**。schema 越严格越危险 —— 校验本意是防 agent 写坏数据,现状却变成「历史遗留脏数据劫持全部写入」。与项目既定哲学「真相源是 bind,校验宽松优先」直接矛盾。

**注意现状表格纠错(评审核实)**:`write del` 意图分支**本无任何 schema 校验**(dataOps.ts:1056-1082,仅 isPathAllowed + protectedCtx + deleteByPath);只有 patch `op:'remove'` 走整对象校验。局部化不是「放宽 del」,del 语义维持现状。

## What Changes

### 核心:write 校验从「整对象」改「目标路径局部」

| 写形态 | 现状 | 改后 |
|---|---|---|
| `patch set jsonPath` | 整对象 safeParse | `validateAtPath(schema, path, 新值)` 局部校验 |
| `patches[]` 每条 | 整对象 safeParse(全 issues) | **全部 apply 到 clone 后按最终态逐目标校验**(与现状「最终态整校验」语义对齐;不做逐条即时校验 —— patches 内后条修复前条是合法模式);**任一失败整批回滚语义不变** |
| `append` | 整对象 safeParse | **只校验新增元素**(逐个 safeParse)+ 父容器长度类约束;不校验父数组既有元素(否则株连复刻 —— 兄弟 script:"" 会拦住 append) |
| `remove` | 整对象 safeParse | **只校验父容器结构性约束**(min length 类);不做全量校验;`write del` 意图维持现状(无校验) |
| `merge` | 整对象 safeParse | 校验目标路径 apply 后新形状 |
| `move` | 整对象 safeParse | 校验目标位置 apply 后新形状(元素本身 schema 不变,只换位置) |
| 整体 set(无 jsonPath,作用根) | 整对象 safeParse | **局部 = 整对象**(显式根操作,契约写明这是有意保留;merge 语义下只校验 value 出现的顶层 key) |

### 写回语义(评审补,防 P0 回归)

现状写回从整对象 parse 的 `res.data` 整体写回(fix-write-safety-bypass P0-1:防未声明嵌套键/`__proto__` own 键落 bind)。局部校验没有整对象 parse 结果,**写回改为 per-path 拼装**:每个校验过的目标路径,写回其局部 safeParse 的 `.data`(strip 语义与原型污染防线在写入值上原样保留);整体 set 场景 = 各顶层 key 的 parse 结果按 merge 语义组装写回。

### strip 拦截联动(评审补,防 fix-silent-strip 回归)

`findStrippedKeys` 改为 **per-path 调用**(输入 = 各目标路径的局部 parse 结果)。D2 无 schema 节点的放行必须区分两种情形:

- **key 不在 shape(声明节点出现未声明新键)→ 维持 `SCHEMA_STRIP` 拒**(现状由整对象 parse 拒,局部化后由 per-path findStrippedKeys 拒,防线等价平移)
- **开放节点(`z.record`/`z.any`/`z.unknown`)→ 放行** + observable 留痕(这才是「宁漏勿错杀」的本意)

### union 处理(评审补,事故本体形态)

`getSchemaAtPath` 现有 union 分支取 `hits[0]` 首个命中 option(schemaUtils.ts:104-108)—— 对 focus 的「提示词描述」用途够,对**校验**用途语义不足(多 option 声明同名字段形状不同时会用错分支)。校验路径新增 **union-tolerant 语义**:

- 优先:用 clone 中该位置的实际数据先 safeParse 判别命中分支,按命中分支校验
- 判别不出/多命中:任一 option 的子 schema 接受即过(any-option-accepts);全拒才拒,issues 聚合各 option
- 歧义时 observable 留痕(`union_ambiguous`)

### 契约变更(明示,写进 CLAUDE.md + architecture.md §④)

- **schema 校验语义从「全局结构一致」收窄为「被写子树结构合法」**。跨节点约束(zod `.superRefine`/根级 `.refine`)不再在 write 时执行 —— 评审确认这是**静默降级**,补救三件套:
  1. observable 事件 `root_refine_skipped`(命中即留痕,不做无感知降级)
  2. CHANGELOG 归 **Changed** + migration note 首行标注「校验语义收窄,依赖全局 refine/必填缺失拒的集成方需迁移」(sec-01「缺必填字段被拒」类用例按新契约改写)
  3. 评估 `data.validation: 'local' | 'global'` 兼容开关(默认 local;项目先例:3.32 conflictWatchFields opt-in 翻转)—— 实施时若实现代价小则带上,否则登记 deferred
- dryRun 同步局部化(预检的就是将执行的校验)。

## 设计要点(关键决策)

- **D1 为什么不做「整对象降级 warning」**:坏数据会落地,违反写路径安全契约;局部校验同时满足「放行无辜 + 拦住目标坏值」。
- **D2 目标路径无 schema 节点怎么办**:isPathAllowed 对 union 中段是显式降级开放(schemaUtils.ts:50-54,注释明言「后续段交 schema.safeParse 兜底校验」—— 本 change 撤掉整对象兜底后,该兜底职责平移到 union-tolerant 局部校验)。真取不到 schema 节点 → 按「strip 联动」节区分 shape 未声明(拒)与开放节点(放行 + 留痕)。
- **D3 回归风险排查(评审修正:非「不受影响」而是「需逐条改写」)**:依赖整对象校验的旧断言必挂,已知清单 —— sec-01:69「set_data 缺必填字段被校验拦截」(merge 语义下缺必填不再拒,按新契约改写)、sec-21.ts:323 注释的顺序依赖(「del 后 bind 不再满足 schema,后续整对象校验会挂」约束消失)。全量跑 + 逐条过。
- **D4 与 G5(bulk-change-guard)正交**:本 change 只管「校验范围」,不管「变更规模门禁」。
- **D5 不动清单(评审补)**:protectedCtx 强制层(schema 校验之前独立执行,无冲突但显式列入不动)、`__pg*` 拒写语义(`extendSchemaWithPgId` 扩展后的 schema 引用,局部校验必须复用 dataOps 闭包内同一个已替换 schema,不得另行传原始 schema)、快照/乐观锁(isPathAllowed/hash 恒实时计算/基线提交在写后,均与校验方式无关)。

## Impact

| 项 | 变更 |
|---|---|
| `src/core/tools/dataOps.ts` | write/set_data/edit_data 校验段 → `validateWriteLocally`;**波及面(评审补)**:`applyPatchesToBind` 还被 eval_transform_subtree / eval_transform 复用、`commitSetToBind` 被 draft_commit 复用 —— 纯函数内部校验替换会同步改变这四个工具的语义,契约变更说明覆盖它们 |
| `src/core/tools/schemaUtils.ts` | 新增 `validateAtPath`(getSchemaAtPath + union-tolerant safeParse 封装);**归宿锁定 schemaUtils**(jsonUtils 是零 zod 依赖纯函数文件,放那破坏分层) |
| types/导出(评审补) | 若 validateAtPath/validateWriteLocally 公开导出 → 同步 `types/index.d.ts` + `src/core/index.ts` + headless 子集;发布门禁 test:exports / test:types-alignment |
| 测试 | selftest:兄弟脏数据不株连(复刻 script:"" 形状)/ 目标坏值仍拒 / **append 只校验新增元素(反株连)** / strip 联动(shape 未声明拒、开放节点放行)/ union 歧义 / 根 refine 不再执行(留痕)/ patches 最终态校验;e2e data-slots 补顶层与 append 场景新用例 |
| 文档 | CLAUDE.md 数据槽段契约改写;architecture.md §④;usage-guide 中英(write 段,migration note) |
| editor_fangzhou | 无需改(union 兜底保留作双保险) |

## 非目标(Non-goals)与 deferred 登记

- 不改 isPathAllowed 白名单语义;不动乐观锁/快照/冲突检测;不动 protectedCtx/__pg*
- 不做「bind 全量合规扫描/修复工具」(宿主职责;真要可另立项 data-lint)
- **restore_data 同根因株连登记 deferred**:`SNAPSHOT_SCHEMA_INVALID`(dataOps.ts:762)对快照值做当前 schema 整对象校验,editor 回退含 script:"" 的历史快照会同样挂 —— 同根因相邻事故面,触发条件:editor 实测回退失败案例(本 change 不动快照路径)
- jsonPath=''(根)merge = 局部即整对象,显式保留(见表格)
