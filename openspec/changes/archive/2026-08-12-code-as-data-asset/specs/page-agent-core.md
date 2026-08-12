# Specification Delta: page-agent-core

> 本文件为 change `code-as-data-asset` 对 `openspec/specs/page-agent-core.md` 的**增量 Requirement**。归档时合入主 specs。4 个 Requirement(createHtmlSubagent 单模式 / 框架自动 checkout/commit / __pgId 注入 / read 摘要)。**breaking major**(createHtmlSubagent 砍 codeRef)。

## Requirement: createHtmlSubagent 单模式(代码作为 data 资产 + vfs 工作副本)

createHtmlSubagent 改为单模式(breaking,砍 codeRef):代码正文作为 data 的 `code` 字段(资产源,随 data json 进服务端 DB),vfs 保留为子 agent 编辑的工作副本(大代码 `vfs_edit` 增量改)。砍 codeRef 引用 / codeSnapshots 镜像 / onComplete 回调。代码不再存 vfs 引用,直接是 data 字段。**对 `add-capability-packs` §0.4 决策的反转(codeRef 不保留)**。

- **代码 = data.code 字段**:集成商 schema `components[i].code: z.string()`(代码正文)。data json 含 code → 集成商 persist 到服务端 DB,代码随行。
- **vfs = 工作副本**:vfs 文件 `codeVfsPrefix + __pgId + ext`(用 __pgId,不用 index/name)。子 agent 在 vfs `vfs_edit` 增量改代码;vfs 会话级,每次 beforeAgent checkout 覆盖式刷新(data 最新 code → vfs)。
- **砍 codeRef**:不再支持 `codeRef:'vfs://...'` 引用模式。createHtmlSubagent 单模式(无 codeAsAsset 开关,无 codeRef fallback)。
- **砍 onComplete / codeSnapshots**:框架 afterAgent 自动 commit(vfs→data.code),无需集成商回调;UI 直接绑 data.code,无需镜像字段。
- **formatCheck 保留**:validate_code + verify 门禁继续扫 vfs 工作副本(不扫 data code);单模式下 vfs 仍是工作副本,零适配。
- **集成商用法**:`createChatSdk({data:{schema(无 __pgId), bind}, subagents:[createHtmlSubagent({writablePaths:['components']})]})` + UI 绑 data.code + persist data json。
- **可测约束**:① createHtmlSubagent 返回 SubagentConfig,middleware 含 beforeAgent checkout + afterAgent commit 钩子;② 无 codeRef 字段(单模式);③ 无 onComplete 选项;④ formatCheck 仍扫 vfs(不是 data code);⑤ 子 agent 工具池含 vfs_read/vfs_edit/vfs_write。

## Requirement: 框架自动 checkout/commit(beforeAgent/afterAgent 钩子,主 agent 透明)

createHtmlSubagent 单模式下,框架在子 agent 生命周期**自动**搬运代码(data.code ↔ vfs 工作副本),主 agent 不碰 checkout/commit、不碰代码正文。beforeAgent 钩子 checkout(data → vfs,按 __pgId);afterAgent 钩子 commit(vfs → data,verify 门禁通过后,按 __pgId,直改 bind 不经 write 工具)。

- **beforeAgent checkout**:子 agent 跑 LLM 前,扫 data writablePaths 下有 code 的组件,按 __pgId 检出到 vfs(`vfsStore[prefix+__pgId+ext] = comp.code`)。建立 checkout 映射 + hook vfs_edit/vfs_write 记 touchedVfsPaths(供增量 commit)。
- **afterAgent commit(增量)**:verify 门禁通过后,只写 touchedVfsPaths 里的文件(不全量,避免覆盖未改组件),按 __pgId 回写 `dataBind.components[find(__pgId)].code`。
- **直改 bind(不经 write 工具)**:commit 直接赋值 reactive 字段(Vue 触发 UI),不经 dataOps write → 不 push 快照栈(代码版本历史交服务端 DB)+ 不经 schema 校验(verify 门禁已保证质量)。data 写入两路径:LLM write 工具走完整契约 / 框架钩子直改 bind(code 字段豁免)。
- **删除组件孤儿清理**:commit 时 vfs 文件的 __pgId 在 data 找不到 → 清 vfs 文件 + 不写 data。
- **主 agent 透明**:主 agent 只调 use_html,不感知 checkout/commit;transfer_code 不作主 agent 工具(框架内部函数)。
- **可测约束**:① beforeAgent 后 vfs 含 data 所有有 code 组件的文件(__pgId 命名);② afterAgent(verify 通过)后 data.code === vfs 文件内容;③ commit 只写 touchedVfsPaths(未改组件不回写);④ commit 不进 dataOps 快照栈(栈深度不因 code commit 增长);⑤ 删组件后 vfs 孤儿被清;⑥ verify 未通过 → 不 commit(脏代码不落 data)。

## Requirement: `__pgId` 框架自动注入(集成商无感知)

createChatSdk 装配期,框架自动给 htmlSubagent 的 writablePaths 对应 schema 节点注入 `__pgId` 字段(稳定映射键),集成商 schema 不声明、agent read 看不到、write 框架自动补、persist 透明带。`__pg` 前缀 = 框架内部命名空间约定(read 投影自动隐藏)。Zod 结构解析失败的边缘 schema → warn + 降级要求声明(fallback)。

- **装配期 schema extend**:检测 htmlSubagent writablePaths → 找 data schema 对应节点 → `z.array` → 元素 `z.object` → extend 加 `__pgId: z.string().optional()` → extendedSchema(框架内部用)。
- **read 投影过滤 `__pg*`**:projectBySchemaDeep 投影时,`__pg` 前缀字段跳过 → agent/集成商 read 看不到 __pgId(框架内部字段不泄露)。
- **write 白名单用 extendedSchema**:isPathAllowed 允许 __pgId 写入(agent 不主动写,框架钩子独占)。
- **write 钩子自动补 id**:子 agent write 新建 components.N 且 __pgId 空 → 框架生成 `'c_'+随机` 写回;已有 __pgId 保持(跨会话稳定,随 data persist)。
- **fallback**:装配期解析 components 元素 schema 失败(非 array<object>,如 union/discriminated)→ `console.warn` + 降级要求集成商 schema 声明 __pgId。不抛错(不阻断)。
- **vfs 文件名 = `codeVfsPrefix + __pgId + ext`**:用 __pgId(稳定),不用 index(重排变)/ name(可能重复改名)。
- **可测约束**:① createChatSdk 装配后,data schema 的 components 元素含 __pgId 字段(集成商未声明);② read data → 返回值不含 __pg* 字段(投影过滤);③ 子 agent write 新建组件 → data 该项 __pgId 自动生成(非空);④ persist 往返(load 回来)→ __pgId 不变(稳定);⑤ vfs 文件名含 __pgId;⑥ schema 为 z.array(z.object) → 自动注入成功;⑦ schema 为 z.array(z.union) → warn + 降级(不抛错)。

## Requirement: read 大文本字段摘要(主 scope 标记驱动)

`read` 工具返回值中,被标记为大文本的字段(如 codeAsAsset 的 code 字段)以占位符摘要(如 `<code 2.3KB>`),不把代码正文灌入主 agent 上下文。**标记驱动**(只摘标记字段,不碰集成商业务长文本)+ **只对主 scope**(子 agent 改 code 需完整读)。data bind 原值不变(占位仅作用于 read 返回)。

- **标记驱动**:只摘"标记为大文本"的字段。createHtmlSubagent 单模式下框架自动标 code 字段;集成商业务长文本(产品描述/富文本)**不受影响**,原样返回。非 htmlSubagent 用户 read 行为完全不变。
- **只对主 scope**:主 agent read → code 字段摘要(`<code Nkb>`);子 agent read → code 字段完整(子要改 code)。scope 经 ToolCallContext 的 activeScope/scopeId 判定(已有机制)。
- **data bind 原值不变**:占位仅作用于 read 返回(给 LLM);bind 恒持原值(与 vfs offload 占位符边界替换契约一致)。write/checkout 取 bind 原值,非占位。
- **占位格式**:`<code 2.3KB>`(字段 describe 标注 + 字节数);信息量可后续增强(行数/标签)。
- **与 fields 参数协同**:LLM 可 `read({fields:['name','type']})` 主动排除大字段(已有);摘要机制是兜底。
- **可测约束**:① 主 scope read 含 code 字段 → 返回值 code 为 `<code Nkb>` 占位,bind 原值不变;② 子 scope read 含 code 字段 → 返回完整 code;③ 集成商业务长文本字段(未标记)→ 原样返回(主 scope 也不摘要);④ 非 htmlSubagent 用户 read 行为不变(无标记字段);⑤ write/checkout 取 bind 原值(非占位)—— 搬运正确。
