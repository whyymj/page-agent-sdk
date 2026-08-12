# Change: code-as-data-asset(代码作为 data 资产 + vfs 工作副本 + 框架自动 checkout/commit)

> 状态:proposal(未实施)。**breaking major**(createHtmlSubagent 改单模式,砍 codeRef;现有用法变)。M 规模。
>
> **定位反转**:对 `add-capability-packs`(2.37.0)§0.4「代码正文→vfs,data 存 codeRef 引用」的反转 —— 该决策基于「代码是会话级产物」假设;本 change 针对「代码是产品资产(进服务端 DB + 版本 + 多端 + 协作)」场景反转。**codeRef 模式不保留**(createHtmlSubagent 单模式,代码直接作为 data 资产字段)。

## Why

`createHtmlSubagent`(2.37.0)的代码存储模式(§0.4)是「代码正文→vfs(data 存 codeRef 引用)」,前提假设:**代码是会话级工作产物**(任务/会话结束可弃)。该假设在「页面搭建 demo / 一次性生成」场景成立。

但真实业务里,**代码是产品资产**:要进服务端数据库(data json 整体持久化)+ 版本管理 + 多端同步 + 可能多人协作。此时 C 方案(代码→vfs + data 引用)每个不变量都反着来,产生三道裂缝:

| C 方案假设 | 资产场景现实 | 裂缝 |
|---|---|---|
| 代码源在 vfs(会话级,跟 sessionId) | 代码进服务端 DB(跨会话/跨设备) | vfs 不随 data json 进 DB;恢复后 codeRef 指向空 vfs → 子 agent vfs_read 404 |
| data 存 codeRef 引用(`vfs://...`) | 代码是 data 资产字段 | 引用跨设备无意义;代码得是 data 本身 |
| codeSnapshots 是 UI 响应式镜像 | 代码要版本/协作 | 镜像无版本语义;真实源(vfs)又不在 DB |

**恢复裂缝实证**:集成商只持久化 data json 到服务端 → 加载恢复后,`codeSnapshots` 在(UI 能渲染),但 `vfs` 空 → 主 agent 派 `use_html` 增量改 → 子 agent `vfs_read` **404** → 只能 `vfs_write` 整个重写(丢既有内容 + 烧 token)。

**核心需求**:代码作为 data 资产字段,随 data json 自然进服务端 DB;**同时**保持「主 agent 上下文不碰代码正文」不变量。

## What Changes

五部分。**createHtmlSubagent 改单模式**(砍 codeRef),代码作为 data 资产:

### ① 代码作为 data 资产字段(核心)

代码正文存 data 的 `code` 字段(`components[i].code`),**不再存 vfs 引用**。data json 含代码 → 集成商整体 persist 到服务端 DB,代码作为字段自然进库。UI 直接绑 `data.code`(响应式,v-html 渲染)。

### ② vfs 工作副本 + 框架自动 checkout/commit(X 全自动)

代码源在 data,但 **vfs 保留为子 agent 编辑的工作副本**(html 代码大小不可预知,大代码必须 `vfs_edit` 增量改,不能重写整段)。框架在子 agent 生命周期**自动**搬运(主 agent 透明):

- **beforeAgent 钩子**:checkout(data.code → vfs 工作副本,按 `__pgId` 建映射)
- **afterAgent 钩子**(verify 门禁通过后):commit(vfs → data.code,按 `__pgId` 回写,**直改 bind 不经 write 工具**)

主 agent 只调 `use_html`,不碰 checkout/commit,不碰代码正文。

### ③ `__pgId` 框架自动注入(集成商无感知)

稳定映射键(vfs 文件 ↔ data 组件)。**框架装配期自动注入**:检测 htmlSubagent 的 writablePaths → 对 data schema 对应节点 extend 加 `__pgId` + read 投影过滤 `__pg*` 前缀(agent 看不到)+ write 钩子自动补 id。集成商 schema 不声明、read 看不到、write 不碰、persist 透明带。**`__pg` 前缀 = 框架内部命名空间约定**(像 Vue 的 `__v_*`)。Zod 结构解析失败的边缘 schema → warn + 降级要求声明(fallback)。

### ④ read 大文本字段摘要(配套不变量)

主 agent 要 read data 看结构,但不能 read 出代码正文。`read` 返回时,代码字段(`code`)**标记驱动摘要**为 `<code Nkb>` 占位。**只对主 scope 生效**(子 agent 改 code 需完整读);只摘标记字段(**不碰集成商业务长文本**如产品描述)。

### ⑤ 砍 codeRef 单模式(简化)

砍 codeRef 引用 / codeSnapshots 镜像 / onComplete 回调 / transfer_code 工具 / codeAsAsset 开关(单模式无需)。createHtmlSubagent 大幅瘦身。

## Impact

- **breaking major**:createHtmlSubagent 用法变(代码从 vfs 引用 → data 字段);现有用 codeRef 的集成方需迁移(schema 加 code 字段 + UI 改绑 data.code + persist 整体 data json)
- **新机制**:框架自动 checkout/commit 钩子 + `__pgId` 装配期注入 + read 摘要(主 scope 标记驱动)
- **保留**:vfs 工作副本(大代码 vfs_edit 增量)+ formatCheck(validate_code + verify 门禁,扫 vfs)
- **集成商用法**:`createChatSdk({data:{schema(无__pgId), bind}, subagents:[createHtmlSubagent({writablePaths})]})` + UI 绑 data.code + persist data json。schema 干净、无回调、无镜像
- **文档**:中英文 README + usage-guide 同步;CLAUDE.md 子 agent 段 + 数据槽段(read 摘要 + __pgId 注入)

## 决策

1. **代码角色反转(资产 vs 产物)** —— `add-capability-packs` §0.4「代码→vfs」决策的反转。codeRef 模式不保留(createHtmlSubagent 单模式);资产场景下代码必须是 data 的一部分。
2. **X 全自动控制流** —— 框架 beforeAgent/afterAgent 钩子自动 checkout/commit,主 agent 透明(只 use_html)。砍 transfer_code 工具(不作主 agent 工具,降为框架内部函数)。优于"主 agent 显式编排"(依赖 LLM 记 checkout→commit 序列,易漏步骤)。
3. **vfs 保留为工作副本** —— 代码源在 data,但子 agent 编辑过程需 vfs 隔离(大代码 vfs_edit 增量改 + 半成品不进 data 闪 UI + 不污染快照栈)。**Git 模型**:DB=remote repo / data=HEAD / vfs=working tree / checkout+commit=git 同名操作。
4. **钩子直改 bind(不经 write 工具)** —— afterAgent commit 直接赋值 `dataBind.components[i].code`(Vue reactive 触发 UI),不经 dataOps write 工具 → **不进快照栈**(代码版本历史交服务端 DB)+ 不经 schema 校验(verify 门禁已保证代码质量)。data 写入有两条路径:LLM write 工具走完整契约 / 框架钩子直改 bind(代码字段豁免,快路径)。
5. **`__pgId` 无感知注入** —— 框架装配期对 schema extend + 投影过滤 `__pg*` + write 钩子补。集成商零感知。带 fallback(Zod 结构解析失败 → warn + 降级要求声明)。
6. **read 摘要标记驱动(只标 code,主 scope)** —— 不用全局阈值(误伤业务长文本);只摘 codeAsAsset 标记的 code 字段;只对主 scope(子 agent 改 code 需完整读)。占位仅作用于 read 返回,data bind 原值不变。
7. **子 agent 两条写入路径** —— 新建组件:子 agent write(data 建 components.N 含 code,一次写完整 code);修改组件:框架 checkout → 子 vfs_edit 增量 → 框架 commit。id 映射只在修改路径需要(checkout 时基于已存在组件建立)。
8. **commit 增量(只写改过的)** —— afterAgent 只写子 agent 实际 `vfs_edit`/`vfs_write` 过的文件(框架 hook vfs 操作记录目标集合),不全量覆盖(避免误覆盖未改组件的外部修改)。删除组件的 vfs 孤儿:commit 时 data 找不到对应 id → 清 vfs 文件。
9. **版本/协作/多端在服务端,不在 SDK** —— SDK 边界:提供 data json + 响应式 bind + 单会话乐观锁。版本历史 / 多人冲突 / 多端同步是服务端 DB 职责。SDK 乐观锁防不了"服务端已被他人改"(协作 stale),集成商 persist 前需做服务端版本检查(文档化边界)。

## Non-goals

- **不内置服务端 backend**:不打包 DB 客户端 / 不提供 RemoteBackend;集成方接自己的 DB。
- **不做版本管理**:历史版本 / 回滚 / diff 是服务端 DB 职责。
- **不做多人协作冲突解决**:协作级 merge/锁在服务端;SDK 乐观锁仅单会话内。
- **不做实时预览**:commit 仍是完成时一次性同步(非每 vfs_edit 实时)。
- **不保留 codeRef 模式**:createHtmlSubagent 单模式(breaking);不提供双模式开关。现有 codeRef 集成方需迁移。
- **transfer_code 不作主 agent 工具**:框架内部函数(beforeAgent/afterAgent 调),不暴露给主 agent。
- **不改 vfs 4 池模型**:vfs 仍是会话级工作区;角色从「源」变「工作副本」,池/LRU/persist 机制不变。
- **__pgId 注入不覆盖所有 Zod 结构**:仅 `z.array(z.object)` 等常见结构自动注入;边缘结构(union/discriminated 等)fallback 降级。
