/**
 * 数据操作工具 —— 单主对象 + schema 校验 + 增量编辑 + 快照回退(无人工审批)
 *
 * 设计:低代码页面通常只有一个主 JSON(如 page),本工具集围绕「唯一主对象」操作:
 *  - 集成方声明 { schema, bind, description? };bind 为 reactive/普通对象,工具直接读写 bind(不挂 window)
 *  - 工具无 path/name 参数:Agent 直接操作唯一主对象,降低认知负担
 *  - 增量编辑 edit_data:按 op(set/remove/merge/append)+ jsonPath 改局部,避免 LLM 重传整个大 JSON
 *  - 快照回退:set/edit/delete 前自动存快照;snapshot/list/restore_data 支持手动检查点与快速回退
 *  - 就地写回:edit/restore 改子属性,绝不替换 bind 根引用 → 兼容 Vue reactive
 *  - 审计:每次 set/edit/delete/restore 记日志(可选 onAudit 回调)
 *
 * 注:大结果的外存/截断由 createAgent 的 coreExecTool 经 offloadLargeResult 处理;
 *     get_data 返回完整安全序列化(不截断),交由 offload 决定外存 vfs 或截断。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ZodType } from 'zod'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { jpEval, searchJson, runSandboxedScript, type SearchMode } from './dataSlotQuery'
import { toolError, zodError, jsonParseError, formatZodIssues } from './toolError'
import {
  isUnsafePath, safeMerge, getByPath, setByPath, deleteByPath, deepClone, maybeParseValue,
  projectFields, limitDepth, safeStringify, hashValue,
  applyPatchToClone, restoreLive, restoreInPlace, diffObjects, findStrippedKeys,
  type EditOp,
} from './jsonUtils'
import { getSchemaTopKeys, isPathAllowed, getSchemaAtPath, projectBySchemaDeep, describeSchemaNode, extendSchemaWithPgId } from './schemaUtils'
import type { VfsStore } from '../backends/vfs'
import type { ResourceProtectSpec, ProtectedCtx } from './resources'
import { ResourceStore, renderReadPlaceholders, enforceSet, enforcePatches, matchProtectedEither, normalizePath, deepEqual } from './resources'

/** 单主对象配置 */
export interface DataConfig {
  /** 值的 zod schema(写入时校验);字段的 .describe() 自动提取注入 systemPrompt「可操作数据」段 */
  schema: ZodType
  /** 数据源:reactive/普通对象,工具直接读写 bind(reactive 写后响应式刷新;不挂 window) */
  bind: any
  /** 数据说明,供 Agent 理解用途与格式;不传则自动生成 */
  description?: string
  /** 受保护资源(精确值保护):声明需 freeze(只读)/verbatim(原样保留)的字段路径。
   *  配置后 read 受保护路径返占位符(精确值不入 LLM 消息流),写侧强制(freeze 拒/verbatim 展开校验)。
   *  未配(默认)→ 全部行为零变化。opt-in:仅配 data.resources + 提供 vfsStore 时装配资源工具 */
  resources?: ResourceProtectSpec[]
}

export interface DataAuditEntry {
  op: 'set' | 'edit' | 'delete' | 'restore' | 'snapshot' | 'draft_commit'
  value?: unknown
  detail?: string
  timestamp: number
}

export interface ConflictInfo {
  op: 'set' | 'edit' | 'delete'
  agentValue?: unknown
  currentValue: unknown
  currentHash: string
  expectedHash: string
  snapshotId: number
}

export type ConflictResolution =
  | { action: 'keep_external' }
  | { action: 'overwrite' }
  | { action: 'restore' }

/** 读写拦截器(集成方可脱敏/转换/审计/拒绝 LLM 的读写) */
export interface DataInterceptors {
  read?: (value: unknown) => unknown
  write?: (payload: unknown, current: unknown) => unknown | { error: string }
}

export interface DataOpsOptions {
  onAudit?: (entry: DataAuditEntry) => void
  maxSnapshots?: number
  onConflict?: (conflict: ConflictInfo) => Promise<ConflictResolution>
  autoLock?: boolean
  interceptors?: DataInterceptors
  /** vfs store(提供则装配 draft_write/draft_commit 分块写工具;由 createChatSdk 经 capabilities.draftWrite 控制)。draft 写 drafts/{draftId}.json(drafts 池) */
  vfsStore?: VfsStore
  /**
   * 大文本字段摘要(code-as-data-asset):read 返回时,**仅主 scope** 下对"父对象是数组元素 + 名为标记字段 + 长度≥阈值"的 string
   * 摘要为 `<field Nkb>` 占位(如 `<code 2.3KB>`),防代码正文灌主 agent 上下文;子 scope 完整返回(子 agent 改 code 需全文)。
   * 深拷贝后改,bind 原值不变。每项 `'arrayPath.field'`(如 `'components.code'`),匹配 = 字段名 + 长度≥阈值
   * 双重过滤(标记驱动:阈值挡短字段,字段名挡集成商业务长文本如 description;arrayPath 作声明意图)。由 createChatSdk 装配期从 htmlSubagent writablePaths 推断填充。
   */
  largeTextPaths?: string[]
  /** 大文本摘要的字符数阈值,默认 200(短于此长度的标记字段原样返回保信息,如空 code 或几十字符的短代码) */
  largeTextThreshold?: number
  /**
   * __pgId 注入路径(code-as-data-asset):createChatSdk 装配期从 htmlSubagent writablePaths 填。
   * 触发三联动:① 装配期 extendSchemaWithPgId 给 schema 对应数组元素加 `__pgId:z.string().optional()`(safeParse 不剥离)
   * ② projectBySchemaDeep 过滤 `__pg*`(read 隐藏 __pgId)③ write 成功后 supplementPgId 补 __pgId(框架独占,绕 isPathAllowed)。
   * agent 写 __pgId 被 isPathAllowed 自然拒(__pg* 前缀段)。集成商原 schema 不动(框架内部用 extendedSchema)。
   */
  pgIdPaths?: string[]
}

export interface DataSnapshotEntry {
  id: number
  ts: number
  op: 'set' | 'edit' | 'delete' | 'manual' | 'restore' | 'draft_commit'
  label?: string
  value: unknown
}

/** 数据操作控制器(运行时替换配置,供 createChatSdk 暴露 sdk.setData 等) */
export interface DataOpsController {
  get(): DataConfig
  set(config: DataConfig): void
  update(bind: any): void
  /** 标记主数据已脏(供 checkpoint 增量 save)。dataOps 内部写路径自动调;importData 等外部直写 bind 需手动调 */
  markDataDirty?(): void
  /** 读后清脏标记,返回是否脏(checkpoint save 消费;无实现时 checkpoint 默认整体 clone 向后兼容) */
  consumeDataDirty?(): boolean
  /** 进入数据 scope(子 agent 委派用,fix-main-sub-isolation P1-13):切换 autoLock 基线归属;返回恢复函数(嵌套安全) */
  enterScope?(id: string): () => void
  /** 删除 scope 的基线条目(委派结束清理) */
  exitScope?(id: string): void
  /**
   * 框架直改 bind 后(如 codeAsset afterAgent commit 把 vfs 工作副本回写 data.code,绕 write 工具)重算指定 scope 的乐观锁基线。
   * 不传 scope = 主 scope(MAIN_SCOPE)。防基线过期致后续 autoLock 误冲突(主 agent read 建基线 → 子 commit 改 bind → 主 write autoLock hash 不匹配)。
   * code-as-data-asset commit 用。
   */
  recomputeBaseline?(scope?: string): void
  /** 受保护资源清单快照(供 resourcesPin 中间件每轮 augmentPrompt 注入「受保护资源」段;freeze 无 handle,verbatim 有) */
  getResourcesSnapshot?(): { path: string; mode: 'freeze' | 'verbatim'; handle?: string }[]
  /** 资源池操作(经 controller 同闭包;有 vfsStore 时可用) */
  createResource?(path: string, value?: unknown): string
  getResource?(pathOrHandle: string): { path: string; mode: string; value: unknown; handle: string } | undefined
  updateResource?(path: string, value: unknown): void
  deleteResource?(pathOrHandle: string): boolean
  listResources?(): { path: string; mode: string; handle: string; bytes: number }[]
}

export type ToolMode = 'simple' | 'advanced' | 'minimal'

const SIMPLE_HIDDEN = new Set(['describe_data', 'get_data', 'set_data', 'edit_data', 'delete_data', 'schema_data', 'diff_data', 'draft_write', 'draft_commit', 'resource_get', 'resource_update', 'resource_list', 'resource_delete'])
const MINIMAL_ALLOWED = new Set(['read', 'write'])

export function filterByToolMode(tools: StructuredToolInterface[], mode: ToolMode = 'simple'): StructuredToolInterface[] {
  if (mode === 'advanced') return tools
  if (mode === 'minimal') return tools.filter((t) => MINIMAL_ALLOWED.has(t.name))
  return tools.filter((t) => !SIMPLE_HIDDEN.has(t.name))
}

/**
 * 整体 set 写入纯函数:schema 校验 + 快照 + merge/替换 + audit。set_data / write(set) / draft_commit 共用。
 * 调用方负责:maybeParseValue(前,字符串→对象)+ handleConflict(前,乐观锁)+ setBaseline(后)+ 成功/dryRun message 构造。
 * 在 bindRef 就地写(经校验,失败不写不入快照)。返回 {ok,hash,data}(dryRun 不写 hash='')或 {ok:false,error}。
 */
export function commitSetToBind(args: {
  bindRef: unknown
  value: unknown
  schema: ZodType
  allowKeys: string[] | null
  snapshots: DataSnapshotEntry[]
  maxSnapshots: number
  audit: (e: DataAuditEntry) => void
  dryRun?: boolean
  op?: 'set' | 'draft_commit'  // 默认 'set';draft_commit 用 'draft_commit'(快照/审计标记区分)
  /** 成功写入 bind 后回调(供 checkpoint 脏标记:dryRun 不触发,因 dryRun 在写入前早 return)。set_data/write(set)/draft_commit 共用此收敛点 */
  onWrite?: () => void
  /** B __pgId 补齐回调(code-as-data-asset):成功写入后调,第二参为写前 bind 深快照(按位置回填原 __pgId 用);
   * 参数化注入,无 codeAsset 场景 no-op(快照也只在回调存在时捕获,零成本开关) */
  internalAfterWrite?: (bind: any, before: any) => void
  /** 受保护资源强制层(精确值保护);undefined 或空 → no-op(向后兼容)。dryRun 也走强制(预检即拦) */
  protectedCtx?: ProtectedCtx
}): { ok: true; hash: string; data: unknown } | { ok: false; error: string } {
  const { bindRef, schema, allowKeys, snapshots, maxSnapshots, audit, dryRun, op = 'set', protectedCtx } = args
  let value = args.value
  // B __pgId:写前深快照(仅配 internalAfterWrite 的 codeAsset 场景捕获,零成本开关)
  const beforeBind = args.internalAfterWrite ? deepClone(bindRef) : null
  // 强制层(§7c F1):normalize(C1 回显 + verbatim 展开 + D1)+ freeze/verbatim 比对,先于 schema 校验
  if (protectedCtx) {
    const er = enforceSet({ value, ctx: protectedCtx })
    if (!er.ok) return { ok: false, error: er.error }
    value = er.value
  }
  const res = schema.safeParse(value)
  if (!res.success) return { ok: false, error: zodError('', res.error.issues) }
  // fix-silent-strip:set 值中新增的键被 zod strip 静默剥离 → 显式拒绝(merge 语义下未声明键不落 bind,假成功)
  const stripped = findStrippedKeys(bindRef, value, res.data)
  if (stripped.length) {
    return { ok: false, error: toolError({ code: 'SCHEMA_STRIP', message: `字段 ${stripped.join(', ')} 不在 schema 声明内,写入被拒绝(防静默丢失)`, hint: '该数据结构不支持这些字段;请只用 schema 声明的字段,或在 data.schema 中声明后重试', path: stripped[0], details: { stripped } }) }
  }
  if (dryRun) return { ok: true, hash: '', data: res.data }
  if (bindRef === null || typeof bindRef !== 'object') {
    return { ok: false, error: toolError({ code: 'LEAF_BIND', message: `主数据 bind 为原始类型(${bindRef === null ? 'null' : typeof bindRef}),无法就地替换外部持有的值引用`, hint: '主数据 bind 必须为对象/数组;叶子值请用对象包裹(如 {value:"x"})或集成方通过 sdk.setData 替换 bind' }) }
  }
  // pushSnapshot 内联(纯函数不依赖 createDataOps 闭包的 pushSnapshot)
  const before = deepClone(bindRef)
  const id = snapshots.length ? snapshots[snapshots.length - 1].id + 1 : 1
  snapshots.push({ id, ts: Date.now(), op, value: before })
  while (snapshots.length > maxSnapshots) snapshots.shift()
  if (res.data !== null && typeof res.data === 'object') {
    if (allowKeys) {
      // 白名单模式(schema 是 ZodObject 子集):merge 语义,只更新 schema 声明字段,隐藏字段保留不动(防误删)
      safeMerge(bindRef as Record<string, any>, res.data)
    } else {
      restoreInPlace(bindRef as Record<string, unknown> | unknown[], res.data)
    }
  }
  audit({ op, value: res.data, timestamp: Date.now() })
  args.onWrite?.()  // 真正写入后通知(checkpoint 脏标记;dryRun 在上方早 return 不会触发)
  args.internalAfterWrite?.(bindRef, beforeBind)  // B __pgId 补齐(成功路径,before 用于按位置回填原 id)
  return { ok: true, hash: hashValue(bindRef), data: res.data }
}

/**
 * 增量 patch 写入纯函数(p2-refactor 子项 3 装饰器):clone + 逐 patch 校验(isUnsafePath/isPathAllowed/maybeParseValue)
 * + applyPatchToClone + 整体 schema 校验 + (dryRun 预检) + snapshot + 从 res.data 整体写回 + markDataDirty。
 * edit_data / write(edit) / eval-patches / eval-subtree 共用 —— 消除四处 clone+循环+校验+snapshot+applyLive 重复
 * (乐观锁×拦截器×dryRun 三轴组合的 bug 高发区,单一真相源防不一致)。
 * 调用方负责:bindRef 类型守卫(NOT_OBJECT/LEAF_BIND,错误码各异)+ audit(detail/value 差异)+ setBaseline + 成功 message。
 * 返回 {ok,applied,clone}(dryRun 返回 clone 供预览,不落盘/不入快照) 或 {ok:false,error}。
 */
export function applyPatchesToBind(args: {
  bindRef: unknown
  patches: { op?: EditOp; jsonPath?: string; value?: unknown }[]
  schema: ZodType
  allowKeys: string[] | null
  snapshots: DataSnapshotEntry[]
  maxSnapshots: number
  markDataDirty?: () => void
  /** schema 校验失败错误模式:'zod'(zodError,edit_data/write 用) / 'schema_invalid'(toolError + details,eval 用);默认 'zod' */
  schemaErrorMode?: 'zod' | 'schema_invalid'
  /** snapshot label(eval_transform_subtree / eval_transform;默认无) */
  snapshotLabel?: string
  /** dryRun:预检走完整校验链但不落盘/不入快照/不 applyLive,返回 clone 供预览 */
  dryRun?: boolean
  /** B __pgId 补齐回调(code-as-data-asset):成功写入后调,before = 写前深快照(按位置回填原 __pgId 用);与 commitSetToBind 同模式 */
  internalAfterWrite?: (bind: any, before: any) => void
  /** 受保护资源强制层;undefined 或空 → no-op。在 patch 应用后、schema 校验前调用 */
  protectedCtx?: ProtectedCtx
}): { ok: true; applied: { op: EditOp; jp: string; value: unknown }[]; clone: unknown } | { ok: false; error: string } {
  const { bindRef, patches, schema, allowKeys, snapshots, maxSnapshots, markDataDirty, schemaErrorMode = 'zod', snapshotLabel, dryRun, protectedCtx } = args
  const beforeBind = args.internalAfterWrite ? deepClone(bindRef) : null  // B __pgId 写前快照
  const clone = deepClone(bindRef)
  const applied: { op: EditOp; jp: string; value: unknown }[] = []
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i]
    const jp = p.jsonPath || ''
    if (isUnsafePath(jp)) return { ok: false, error: toolError({ code: 'PATH_UNSAFE', message: `patches[${i}] jsonPath "${jp}" 含非法段`, hint: '使用正常属性路径,如 components.0.text' }) }
    if (!isPathAllowed(jp, schema, allowKeys)) return { ok: false, error: toolError({ code: 'PATH_DENIED', message: `patches[${i}] @ "${jp}" 不在 schema 声明字段内`, hint: '仅 schema 声明的 key 可写' }) }
    const op: EditOp = p.op ?? 'set'
    let pVal: unknown
    if (op !== 'remove') {
      if (p.value === undefined || p.value === '') return { ok: false, error: toolError({ code: 'MISSING_VALUE', message: `patches[${i}] ${op} 操作需要 value`, hint: `op 为 ${op} 时 value 必填;删除请用 op:'remove'` }) }
      const pr = maybeParseValue(p.value)
      if (pr.parseError) return { ok: false, error: jsonParseError(`patches[${i}]`, p.value, pr.parseError) }
      pVal = pr.parsed
      // move 的 value 是目标路径:同样过白名单(防经 move 把元素移进 schema 未声明路径)
      if (op === 'move' && typeof pVal === 'string' && !isPathAllowed(pVal, schema, allowKeys)) {
        return { ok: false, error: toolError({ code: 'PATH_DENIED', message: `patches[${i}] move 目标 "${pVal}" 不在 schema 声明字段内`, hint: 'move 的 value(目标路径)也须在 schema 声明字段内' }) }
      }
    }
    const patchErr = applyPatchToClone(clone, op, jp, pVal)
    if (patchErr) return { ok: false, error: toolError({ code: 'PATCH_FAILED', message: `patches[${i}]: ${patchErr}`, hint: '检查 op 与目标类型:merge 需对象,append 需数组' }) }
    applied.push({ op, jp, value: pVal })
  }
  // 强制层(§7c F1):逐 patch C3 remove 检查 + normalizeAndCheck 比对(clone vs bind),先于 schema 校验
  if (protectedCtx) {
    const er = enforcePatches({ patches, clone, ctx: protectedCtx })
    if (!er.ok) return { ok: false, error: er.error }
  }
  const res = schema.safeParse(clone)
  if (!res.success) {
    return { ok: false, error: schemaErrorMode === 'schema_invalid'
      ? toolError({ code: 'SCHEMA_INVALID', message: `patches 应用后整体校验失败,未写入`, hint: '确认 patches 合并后整体仍符合 schema', details: formatZodIssues(res.error.issues) })
      : zodError('', res.error.issues) }
  }
  // fix-silent-strip:patch 新增的键被 zod strip 静默剥离 → 不再假成功,显式拒绝(agent 据此告知用户「不支持该字段」)
  // 典型:discriminatedUnion 下 isPathAllowed 降级开放(如 components.N.style),safeParse strip 后写回不含该键
  const stripped = findStrippedKeys(bindRef, clone, res.data)
  if (stripped.length) {
    return { ok: false, error: toolError({ code: 'SCHEMA_STRIP', message: `字段 ${stripped.join(', ')} 不在 schema 声明内,写入被拒绝(防静默丢失)`, hint: '该数据结构不支持这些字段;请只用 schema 声明的字段,或在 data.schema 中声明后重试', path: stripped[0], details: { stripped } }) }
  }
  if (dryRun) return { ok: true, applied, clone }
  // pushSnapshot(内联,与 commitSetToBind 一致:记录改前 bindRef)+ 写回 bind + markDataDirty
  const id = snapshots.length ? snapshots[snapshots.length - 1].id + 1 : 1
  snapshots.push({ id, ts: Date.now(), op: 'edit', value: deepClone(bindRef), ...(snapshotLabel ? { label: snapshotLabel } : {}) })
  while (snapshots.length > maxSnapshots) snapshots.shift()
  // fix-write-safety-bypass(P0-1):写 live 从 res.data(schema 解析值,已 strip 未声明键 / 值内嵌 __proto__ own 键)整体写回,
  // 与 commitSetToBind 单一真相源。旧实现 `for (a) applyPatchToLive(bindRef, a.op, a.jp, a.value)` 用原始 a.value,
  // 未走 zod strip → 已声明路径值内的未声明嵌套键 / __proto__ own 键落 bind(set 干净、edit 脏)。
  // res.data 是所有 patch 应用 + zod strip 后的最终态,直接写回覆盖 set/merge/append 全 op;
  // remove 须显式 deleteByPath(safeMerge 浅合并不删 key,避免 remove 被整体 merge 丢失)。
  for (const a of applied) if (a.op === 'remove') deleteByPath(bindRef, a.jp)
  if (res.data !== null && typeof res.data === 'object') {
    if (allowKeys) safeMerge(bindRef as Record<string, any>, res.data)
    else restoreInPlace(bindRef as Record<string, unknown> | unknown[], res.data)
  }
  args.internalAfterWrite?.(bindRef, beforeBind)  // B __pgId 补齐(成功路径,before 用于按位置回填原 id)
  markDataDirty?.()
  return { ok: true, applied, clone }
}

/** 基于单主对象配置构建数据操作工具集 */
/** 格式化字符数为字节串(B/KB/MB;read 大文本摘要占位用,如 `2.3KB`) */
function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`
  return `${(n / (1024 * 1024)).toFixed(1)}MB`
}

/** 大文本字段摘要标记:每项 `'arrayPath.field'`(如 `'components.code`);arrayPath 作声明意图,实际匹配按 field + 父是数组元素 */
export interface LargeTextSpec { arrayPath: string; field: string }

/**
 * read 大文本字段摘要(code-as-data-asset):**仅主 scope**(isMain)对"名为标记字段 + 长度≥阈值"的 string
 * 替换为 `<field Nkb>` 占位(如 `<code 2.3KB>`),防代码正文灌主 agent 上下文。双重过滤挡误伤:
 * ① 字段名 ∈ specs.field(集成商业务长文本如 description 不在标记集 → 不受影响)② 长度≥阈值(短 code 原样保信息)。
 * 标记驱动,read 整体 / 子路径(components.0)均生效。深拷贝后改,bind 原值不动;isMain=false(子 scope)原样返回 —— 子 agent 改 code 需全文。纯函数,可单测。
 */
export function summarizeLargeText<T>(val: T, isMain: boolean, specs: LargeTextSpec[], threshold: number): T {
  if (!isMain || !specs.length || val == null || typeof val !== 'object') return val
  const fieldSet = new Set(specs.map((s) => s.field))
  const out = deepClone(val) as any
  ;(function walk(node: any) {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
    } else if (node && typeof node === 'object') {
      for (const k of Object.keys(node)) {
        const v = node[k]
        if (typeof v === 'string' && fieldSet.has(k) && v.length >= threshold) {
          node[k] = `<${k} ${formatBytes(v.length)}>`       // 标记字段名 + 大文本 → 占位(标记驱动;read 整体/子路径 components.0 均生效)
        } else {
          walk(v)                                           // 非标记字段 → 继续递归
        }
      }
    }
  })(out)
  return out as T
}

/** 生成稳定唯一 __pgId(c_ + 随机 + 计数防同毫秒冲突);code-as-data-asset 组件映射键(vfs 文件名 / commit 反查) */
let __pgIdCounter = 0
export function genPgId(): string {
  __pgIdCounter++
  return 'c_' + Math.random().toString(36).slice(2, 8) + __pgIdCounter.toString(36)
}

/**
 * 补 __pgId(code-as-data-asset):扫 bind 的 writablePaths 数组,对没 __pgId 的对象元素生成 id(幂等:已有保持)。
 * 框架 afterWrite 钩子调(不经 schema 校验 / isPathAllowed,框架独占);read 因 __pgId 不在 schema → projectBySchemaDeep 自然隐藏。
 * agent 写 __pgId 被 isPathAllowed 自然拒(__pgId 不在 schema 白名单 → PATH_DENIED)。纯函数可单测;
 * writablePath 在 bind 非数组(或元素非对象)→ 跳过(fallback 降级,不抛错)。
 *
 * 已知边界(craft-notes design A3):write patch **整对象替换**组件(如 patches 交换顺序)时,LLM value 不含 __pg*
 * (read 投影看不到)→ __pgId 重新生成(映射键换新,checkout 按新 id 建文件,功能不破坏);
 * __pgNotes(工匠笔记)随旧对象丢失 —— 接受(频率低,下次委派子 agent 会重新沉淀;write 前快照旧值需侵入 clone 应用链,不值得)。
 */
export function supplementPgId(bind: any, writablePaths: string[]): void {
  if (!bind || typeof bind !== 'object') return
  for (const wp of writablePaths) {
    const arr = getByPath(bind, wp)
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (item && typeof item === 'object' && !('__pgId' in item)) {
          item.__pgId = genPgId()
        }
      }
    }
  }
}

/** 就地删除 __pg* 内部字段(深;code-as-data-asset):write 返回值脱敏,防 __pgId 泄露给 agent。
 * read 投影已挡(projectBySchemaDeep 过滤 __pg*),但 write return 是显式 safeStringify(r.clone/r.data)字符串 ——
 * extend schema 后 safeParse 不剥离 __pgId,clone/data 可能含(load 回来的 __pgId),需 write return 单独挡。 */
function redactPgInPlace(obj: any): void {
  ;(function walk(n: any) {
    if (Array.isArray(n)) n.forEach(walk)
    else if (n && typeof n === 'object') {
      for (const k of Object.keys(n)) {
        if (k.startsWith('__pg')) delete n[k]
        else walk(n[k])
      }
    }
  })(obj)
}

export function createDataOps(config: DataConfig, opts: DataOpsOptions = {}): StructuredToolInterface[] {
  // code-as-data-asset:pgIdPaths 触发 schema extend(加 __pgId → safeParse 不剥离)+ afterWrite(supplementPgId 补 __pgId)
  const pgIdPaths = opts.pgIdPaths ?? []
  // B __pgId 补齐(全写路径收敛点):① 写前快照回填原 __pgId(read 投影隐藏 → agent 整体替换的 value 不含,
  // 不回填则映射键重生成,checkout/commit 按 __pgId 定位断链)。回填两段式(rv-code 复审:纯按位置在 move/重排
  // 后会错配到不同组件):先按内容深度相等匹配(剥 __pgId 比较,未改元素无论挪到哪都找回自己的 id),未匹配项
  // 再按位置兜底(改动元素改了内容但大概率还在原位)② supplementPgId 补全新增
  const internalAfterWrite = pgIdPaths.length ? (b: any, before: any) => {
    if (before && typeof before === 'object') {
      for (const wp of pgIdPaths) {
        const oldArr = getByPath(before, wp)
        const newArr = getByPath(b, wp)
        if (!Array.isArray(oldArr) || !Array.isArray(newArr)) continue
        // 剥 __pgId 的比较副本(元素顶层的 __pgId 不参与内容相等判定)
        const strip = (o: unknown) => {
          if (!o || typeof o !== 'object') return o
          const c = { ...(o as Record<string, unknown>) }
          delete c.__pgId
          return c
        }
        const used = new Set<number>()
        // 第一段:内容相等匹配(重排安全;同内容多元素按首个未用命中,与 findStrippedKeys 同策略)
        for (let j = 0; j < newArr.length; j++) {
          const ne = newArr[j]
          if (!ne || typeof ne !== 'object' || '__pgId' in (ne as object)) continue
          for (let i = 0; i < oldArr.length; i++) {
            if (used.has(i)) continue
            const oe = oldArr[i] as any
            if (!oe || typeof oe !== 'object' || !oe.__pgId) continue
            if (deepEqual(strip(oe), strip(ne))) {
              ;(ne as any).__pgId = oe.__pgId
              used.add(i)
              break
            }
          }
        }
        // 第二段:位置兜底(内容已改但未挪位的元素)
        for (let i = 0; i < oldArr.length && i < newArr.length; i++) {
          if (used.has(i)) continue
          const oldId = (oldArr[i] as any)?.__pgId
          const ne = newArr[i]
          if (oldId && ne && typeof ne === 'object' && !('__pgId' in (ne as object))) {
            ;(ne as any).__pgId = oldId
            used.add(i)
          }
        }
      }
    }
    supplementPgId(b, pgIdPaths)
  } : undefined
  let schema: ZodType = pgIdPaths.length ? extendSchemaWithPgId(config.schema, pgIdPaths).schema : config.schema
  let bindRef: any = config.bind
  let description: string = config.description ?? '主数据对象'
  let allowKeys: string[] | null = getSchemaTopKeys(schema)

  // 受保护资源(精确值保护):resourcesByPath 可变 Map(controller.set 经 loadResources 重建);resourceStore 复用 vfs 第四池
  const resourcesByPath = new Map<string, ResourceProtectSpec>()
  const resourceStore = opts.vfsStore ? new ResourceStore(opts.vfsStore) : undefined
  function loadResources(specs?: ResourceProtectSpec[]) {
    resourcesByPath.clear()
    if (specs) for (const s of specs) {
      const p = normalizePath(s.path)
      resourcesByPath.set(p, { path: p, mode: s.mode })
    }
  }
  loadResources(config.resources)
  // protectedCtx:resourcesByPath 非空即构造(resourceStore 可选 → freeze 无 vfs 也工作,verbatim 降级);
  //   resourcesByPath 内容随 controller.set 经 loadResources 变化自动 reflect
  const protectedCtx: ProtectedCtx | undefined = resourcesByPath.size
    ? { resourcesByPath, resourceStore, getBind: () => bindRef }
    : undefined

  const snapshots: DataSnapshotEntry[] = []
  const maxSnapshots = opts.maxSnapshots ?? 20
  // 并发工具(maxParallelTools>1)下 autoLock 退化为"整体快照语义":多个 read 并发写基线(完成顺序不定),
  // 后续 write 比对"最后完成的 read 的整体 bind hash";单线程下单工具原子,但跨工具的"哪个 read 的 hash 被 autoLock 用"不可重现。
  // ⚠️ 并发写不互锁(audit-five-dimensions CA-P1):同轮并发两个写工具都在 await handleConflict 让出前同步取旧基线 → 均通过乐观锁 →
  //    各自 commitSetToBind 串行写入 → 后写覆盖前写,前写静默丢失,无 VERSION_CONFLICT 回灌 LLM。默认 maxParallelTools=1(串行)规避;
  //    开 maxParallelTools>1 时写应显式传 expectedHash,中期根因修复 = commitSetToBind 入口 final hash 校验。
  // 并发场景下若需精确乐观锁,LLM 应显式传 expectedHash(取自它自己那次 read 的返回值)。harden-optimistic-lock
  // per-scope 基线(fix-main-sub-isolation P1-13):主×子 agent 共享本闭包,基线按 caller scope 隔离 ——
  //   子 agent 委派期间 enterDataScope 切 activeScope,子 read/write 只动子 scope 基线,主基线不被污染
  //   (修原:子 read 刷新共享 lastReadHash → 父过期写静默放行覆盖外部修改)。MAIN_SCOPE('')= 主。
  const MAIN_SCOPE = ''
  const baselines = new Map<string, string>()  // scopeId → 该 caller 最后 read/写后的整体 bind hash
  let activeScope: string = MAIN_SCOPE
  // CA 并发修复(per-call scope token):工具 fns 第二参 config 的 configurable.__pgDataScope 优先
  // (wrapWithScope 经 RunnableConfig 注入,并发交错各读各的 scope),ambient activeScope 降为兜底(无 config 旧路径)
  const scopeOf = (config?: unknown): string =>
    ((config as { configurable?: Record<string, unknown> } | undefined)?.configurable?.__pgDataScope as string | undefined) ?? activeScope
  const getBaseline = (scope?: string): string | undefined => baselines.get(scope ?? activeScope)
  const setBaseline = (h: string | undefined, scope?: string): void => { const s = scope ?? activeScope; if (h === undefined) baselines.delete(s); else baselines.set(s, h) }
  const autoLock = opts.autoLock !== false
  // 大文本字段摘要(code-as-data-asset):主 scope read 返回时,数组元素里的标记字段(如 code)摘要为 <field Nkb>,
  // 防代码正文灌主 agent 上下文。specs 由 createChatSdk 装配期从 htmlSubagent writablePaths 推断填充。
  const largeTextThreshold = opts.largeTextThreshold ?? 200
  const largeTextSpecs: LargeTextSpec[] = (opts.largeTextPaths ?? [])
    .map((p) => { const idx = p.lastIndexOf('.'); return idx > 0 ? { arrayPath: p.slice(0, idx), field: p.slice(idx + 1) } : null })
    .filter((x): x is LargeTextSpec => x !== null)
  // 脏标记:checkpoint 增量用(主数据写后置 true,save consumeDataDirty 检查;未脏则复用上次 clone 省深拷贝)。
  //   ⚠ 所有改 bindRef 的写路径必须调 markDataDirty(漏标 → checkpoint restore 静默还原旧值,比性能问题严重)。
  //   写点清单(新增写路径务必同步 + 补 consumeDataDirty 测试):commitSetToBind(onWrite)/edit/delete/restore/
  //     handleConflict.restore/eval(transform 3 模式)/write(del/edit·patches)/importData/controller.set|update
  let _dataDirty = true  // 初始 true=首次 save 必 clone 建立基线
  function markDataDirty() { _dataDirty = true }

  const controller: DataOpsController = {
    get: () => ({ schema, bind: bindRef, description }),
    set: (c) => { schema = pgIdPaths.length ? extendSchemaWithPgId(c.schema, pgIdPaths).schema : c.schema; bindRef = c.bind; description = c.description ?? '主数据对象'; allowKeys = getSchemaTopKeys(schema); snapshots.length = 0; baselines.clear(); loadResources(c.resources); resourceStore?.clear(); markDataDirty() },
    update: (b) => { bindRef = b; snapshots.length = 0; baselines.clear(); markDataDirty() },
    markDataDirty,
    consumeDataDirty: () => { const d = _dataDirty; _dataDirty = false; return d },
    // per-scope 基线(P1-13):子 agent 委派经 subagent scope proxy 调入;嵌套安全(恢复上一层 scope)
    enterScope: (id) => { const prev = activeScope; activeScope = id; return () => { activeScope = prev } },
    exitScope: (id) => { baselines.delete(id) },
    // code-as-data-asset:框架 commit 直改 bind 后重算基线(默认主 scope),防后续 autoLock 误冲突
    recomputeBaseline: (scope) => { baselines.set(scope ?? MAIN_SCOPE, hashValue(bindRef)) },
    getResourcesSnapshot: () => {
      const out: { path: string; mode: 'freeze' | 'verbatim'; handle?: string }[] = []
      for (const [path, spec] of resourcesByPath) {
        if (spec.mode === 'verbatim') {
          const entry = resourceStore?.get(path)
          out.push(entry?.handle ? { path, mode: spec.mode, handle: entry.handle } : { path, mode: spec.mode })
        } else {
          out.push({ path, mode: spec.mode })
        }
      }
      return out
    },
    createResource: resourceStore ? (path: string, value?: unknown) => {
      const np = normalizePath(path)
      const spec = resourcesByPath.get(np)
      const v = value !== undefined ? value : getByPath(bindRef, np)
      return resourceStore.ensure(np, v, spec?.mode ?? 'verbatim')
    } : undefined,
    getResource: resourceStore ? (p: string) => {
      const e = resourceStore.get(p)
      return e ? { path: e.path, mode: e.mode, value: e.value, handle: e.handle } : undefined
    } : undefined,
    updateResource: resourceStore ? (path: string, value: unknown) => {
      const np = normalizePath(path)
      resourceStore.update(np, value)
      setByPath(bindRef, np, value)  // 同步 bind(D1 一致:池=bind,防下次 write 回显句柄被 D1 撤销)
      markDataDirty()  // D2:标脏防 checkpoint 快照内池≠bind
    } : undefined,
    deleteResource: resourceStore ? (p: string) => resourceStore.delete(p) : undefined,
    listResources: resourceStore ? () => resourceStore.list() : undefined,
  }

  const audit = (entry: DataAuditEntry) => { opts.onAudit?.(entry) }

  function pushSnapshot(op: DataSnapshotEntry['op'], label?: string): number {
    const before = deepClone(bindRef)
    const id = snapshots.length ? snapshots[snapshots.length - 1].id + 1 : 1
    snapshots.push({ id, ts: Date.now(), op, label, value: before })
    while (snapshots.length > maxSnapshots) snapshots.shift()
    return id
  }

  async function handleConflict(
    op: 'set' | 'edit' | 'delete',
    expectedHash: string | undefined,
    agentValue?: unknown,
  ): Promise<string | null> {
    if (!expectedHash || expectedHash === '') return null
    const curHash = hashValue(bindRef)
    if (curHash === expectedHash) return null
    if (!opts.onConflict) {
      return toolError({
        code: 'VERSION_CONFLICT',
        message: `乐观锁冲突:expectedHash=${expectedHash} 但当前 hash=${curHash}。主数据在你 read 之后已被修改(外部代码/其他 agent/用户手动改)。`,
        hint: `重新 read 拿最新值与 hash,基于最新值修改后再写入(传新的 expectedHash)。当前值:${safeStringify(bindRef, 400)}`,
      })
    }
    const resolution = await opts.onConflict({
      op, agentValue, currentValue: bindRef, currentHash: curHash, expectedHash, snapshotId: 0,
    })
    if (resolution.action === 'keep_external') {
      return `已保留外部修改(未写入)。当前值:${safeStringify(bindRef, 400)} (hash=${curHash})。请重新 read 拿最新值与 hash 再改。`
    }
    if (resolution.action === 'restore') {
      if (!snapshots.length) return `无历史快照可回退(本次为首次操作)。当前值:${safeStringify(bindRef, 400)} (hash=${curHash})。请重新 read 再改或选「强制覆盖」。`
      const entry = snapshots[snapshots.length - 1]
      restoreLive(bindRef, deepClone(entry.value))
      markDataDirty()
      return `已回退主数据到历史快照 #${entry.id}[${entry.op}]。当前值:${safeStringify(bindRef, 400)} (hash=${hashValue(bindRef)})。请基于回退后的值重写或停止。`
    }
    return null
  }

  /**
   * A1 写能力标注(team-review-hardening):授权面剥离(子 agent 装配 + spawn 自授)/ 组件锁主写守卫
   * 三处统一按此判定 —— 单一真相源防硬编码清单漂移(历史两次漏 eval_script·restore_data)。
   * 条件写用函数形态(eval_script 仅 mode:'transform');无法确定 args 的消费方按「是写」保守处理。
   */
  const markWrite = (t: unknown, cap: boolean | ((args: Record<string, unknown>) => boolean) = true): void => {
    ;(t as { writeCapable?: unknown }).writeCapable = cap
  }

  const describeData = tool(
    async () => [
      `说明: ${description}`,
      `格式: 写入值需为 JSON,且通过声明的 schema 校验(校验失败时 set_data/edit_data 会返回结构化错误,含具体字段与期望类型)。`,
    ].join('\n'),
    { name: 'describe_data', description: '获取主数据的说明与格式要求。', schema: z.object({}) },
  )

  const getData = tool(
    async ({ jsonPath }, config) => {
      const scope = scopeOf(config)  // CA 并发修复:per-call scope token
      const jp = jsonPath || ''
      if (isUnsafePath(jp)) return toolError({ code: 'PATH_UNSAFE', message: `jsonPath "${jp}" 含非法段(__proto__/constructor/prototype)`, hint: '使用正常属性路径,如 components.0.text(数组索引用数字)' })
      if (!isPathAllowed(jp, schema, allowKeys)) {
        return toolError({ code: 'PATH_DENIED', message: `get_data @ "${jp}" 不在 schema 声明字段内(仅 schema 声明的 key 可读)`, hint: '主数据仅暴露 schema 声明的字段;若需操作该字段,集成方需在 schema 中声明它' })
      }
      let val = jp ? getByPath(bindRef, jp) : bindRef
      // 整体读按 schema 深投影(递归隐藏未声明字段;fix-data-integrity P1-19:原浅投影仅顶层 key,嵌套未声明字段泄露)
      if (!jp && allowKeys) val = projectBySchemaDeep(val, schema)
      // 受保护路径占位符替换(结构化读;精确值不入 LLM 消息流)
      if (protectedCtx) val = renderReadPlaceholders({ jp, resolved: val, resourcesByPath: protectedCtx.resourcesByPath, resourceStore: protectedCtx.resourceStore })
      const h = hashValue(bindRef)
      setBaseline(h, scope)
      if (val === undefined) return `主数据${jp ? ` @ ${jp}` : ''} = (undefined) (hash=${h})`
      return `主数据${jp ? ` @ ${jp}` : ''} = ${safeStringify(val)} (hash=${h})`
    },
    {
      name: 'get_data',
      description:
        '@deprecated(改用 read,等价且支持 fields/depth/分页)。读取主数据当前值(返回含 hash 供乐观锁);jsonPath 可选读子路径。大结果自动外存 vfs。',
      schema: z.object({ jsonPath: z.string().optional().describe('相对主数据根的点号路径(如 components.0.text);不传则读整个主数据') }),
    },
  )

  const setData = tool(
    async ({ value, expectedHash }, config) => {
      const scope = scopeOf(config)  // CA 并发修复:per-call scope token
      const effHash = expectedHash || (autoLock ? getBaseline(scope) : undefined)
      const conflict = await handleConflict('set', effHash)
      if (conflict !== null) return conflict
      const pr = maybeParseValue(value)
      if (pr.parseError) return jsonParseError('', value, pr.parseError)
      const r = commitSetToBind({ bindRef, value: pr.parsed, schema, allowKeys, snapshots, maxSnapshots, audit, onWrite: markDataDirty, internalAfterWrite, protectedCtx })
      if (!r.ok) return r.error
      setBaseline(r.hash, scope)
      return `已设置主数据 = ${safeStringify(r.data, 600)} (新 hash=${r.hash})${allowKeys ? '(白名单模式:仅更新 schema 声明字段,未声明字段保留)' : ''}`
    },
    {
      name: 'set_data',
      description:
        '@deprecated(改用 write,等价)。整体设置主数据(value 需过 schema 校验)。白名单模式:set 为根级浅合并,深层整体替换(未传字段丢失);保留深层字段用 edit_data({op:"merge"})。expectedHash 乐观锁可选(默认 autoLock)。',
      schema: z.object({
        value: z.unknown().describe('JSON 对象(推荐直传,如 {title:"x"}),或 JSON 字符串;需符合 schema'),
        expectedHash: z.string().optional().describe('乐观锁:改前 read/get 返回的 hash;传入则校验,不一致拒绝写入防覆盖。不传则自动用你最后读到的 hash(autoLock)'),
      }),
    },
  )
  markWrite(setData)

  const editData = tool(
    async (args, config) => {
      const scope = scopeOf(config)  // CA 并发修复:per-call scope token
      // M2 容错:advanced 模式 edit_data 与 write 并存,LLM 可能误传 write 的 patch 形式({patch:{op,jsonPath,value}});
      // 从 patch 补全 op/jsonPath/value(顶层优先,patch 兜底)。op 仍语义必填(顶层或 patch 至少一个,缺则 MISSING_VALUE)
      const op = args.op ?? args.patch?.op
      const jsonPath = args.jsonPath ?? args.patch?.jsonPath
      const value = args.value ?? args.patch?.value
      const expectedHash = args.expectedHash
      if (!op) return toolError({ code: 'MISSING_VALUE', message: 'edit_data 需要 op(set/remove/merge/append)', hint: '顶层 op 或 patch.op 至少传一个' })
      const jp = jsonPath || ''
      if (isUnsafePath(jp)) {
        return toolError({ code: 'PATH_UNSAFE', message: `jsonPath "${jp}" 含非法段(__proto__/constructor/prototype)`, hint: '使用正常的属性路径,如 components.0.text(数组索引用数字)' })
      }
      if (!isPathAllowed(jp, schema, allowKeys)) {
        return toolError({ code: 'PATH_DENIED', message: `edit_data @ "${jp}" 不在 schema 声明字段内`, hint: '仅 schema 声明的 key 可写;若需操作该字段,集成方需在 schema 中声明它' })
      }
      const effHash = expectedHash || (autoLock ? getBaseline(scope) : undefined)
      const conflict = await handleConflict('edit', effHash)
      if (conflict !== null) return conflict
      if (bindRef == null || typeof bindRef !== 'object') {
        return toolError({ code: 'NOT_OBJECT', message: `edit 仅适用于对象/数组主数据,当前是 ${bindRef === undefined ? 'undefined' : typeof bindRef}`, hint: '叶子(原始类型)请用 set_data 整体设置' })
      }
      const r = applyPatchesToBind({ bindRef, patches: [{ op, jsonPath: jp, value }], schema, allowKeys, snapshots, maxSnapshots, markDataDirty, schemaErrorMode: 'zod', internalAfterWrite, protectedCtx })
      if (!r.ok) return r.error
      const a = r.applied[0]
      audit({ op: 'edit', detail: `${a.op}${jp ? '@' + jp : ''}`, value: a.value, timestamp: Date.now() })
      setBaseline(hashValue(bindRef), scope)
      return `已 edit 主数据(${a.op}${jp ? ' @ ' + jp : ''})。当前值:${safeStringify(bindRef, 600)} (新 hash=${hashValue(bindRef)})`
    },
    {
      name: 'edit_data',
      description:
        '增量编辑主数据(advanced;simple 用 write 等价)。op:set/remove/merge/append/move;jsonPath 相对根(数组索引用数字);value 对象或 JSON 字符串。schema 校验失败不写;expectedHash 可选乐观锁。大对象优先增量改。',

      schema: z.object({
        op: z.enum(['set', 'remove', 'merge', 'append', 'move']).optional().describe('增量操作(顶层或 patch.op 至少一个):set 设值/remove 删/merge 合并/append 追加/move 移动数组元素(value=目标路径字符串,数组本身=追加/数组内下标=插入;同数组即重排,目标下标按移除源后解释)'),
        jsonPath: z.string().optional().describe('相对主数据根的点号路径(如 components.0.text);顶层或 patch.jsonPath。set/remove 必填,merge/append 不填则作用于根'),
        value: z.unknown().optional().describe('JSON 对象(推荐直传,如 {text:"x"})或 JSON 字符串;顶层或 patch.value(set/merge/append 必填)'),
        expectedHash: z.string().optional().describe('乐观锁:改前 read/get 返回的 hash;传入则校验,不一致拒绝写入防覆盖。不传则自动用你最后读到的 hash(autoLock)'),
        patch: z
          .object({
            op: z.enum(['set', 'remove', 'merge', 'append']).optional(),
            jsonPath: z.string().optional(),
            value: z.unknown().optional(),
          })
          .optional()
          .describe('容错:误传 write 的 {patch:{op,jsonPath,value}} 形式时从此取值(顶层优先)。正常用顶层 op/jsonPath/value 即可'),
      }),
    },
  )
  markWrite(editData)

  const deleteData = tool(
    async ({ jsonPath, expectedHash }, config) => {
      const scope = scopeOf(config)  // CA 并发修复:per-call scope token
      if (!jsonPath) return toolError({ code: 'MISSING_VALUE', message: 'delete_data 需要 jsonPath 指定要删的子路径(主数据整体不可删,用 set_data 整体替换)', hint: '如 jsonPath:"components.0" 删数组首项' })
      if (isUnsafePath(jsonPath)) return toolError({ code: 'PATH_UNSAFE', message: `jsonPath "${jsonPath}" 含非法段`, hint: '使用正常属性路径' })
      if (!isPathAllowed(jsonPath, schema, allowKeys)) {
        return toolError({ code: 'PATH_DENIED', message: `delete_data @ "${jsonPath}" 不在 schema 声明字段内`, hint: '仅 schema 声明的 key 可删' })
      }
      if (protectedCtx) {
        const hit = matchProtectedEither(jsonPath, protectedCtx.resourcesByPath)
        if (hit) {
          return toolError({ code: hit.spec.mode === 'freeze' ? 'FROZEN_FIELD' : 'VERBATIM_PROTECTED', message: `delete_data @ "${jsonPath}" 命中受保护字段 "${hit.protectedPath}"(${hit.spec.mode}),不可删除`, hint: hit.spec.mode === 'freeze' ? '冻结字段不可删;如需移除请联系集成方调整 data.resources' : 'verbatim 字段不可直接删;先 resource_delete({path}) 释放资源保护后再删' })
        }
      }
      const effHash = expectedHash || (autoLock ? getBaseline(scope) : undefined)
      const conflict = await handleConflict('delete', effHash)
      if (conflict !== null) return conflict
      pushSnapshot('delete')
      const ok = deleteByPath(bindRef, jsonPath)
      markDataDirty()
      audit({ op: 'delete', detail: jsonPath, timestamp: Date.now() })
      setBaseline(hashValue(bindRef), scope)
      return ok ? `已删除主数据 @ ${jsonPath}` : `主数据 @ ${jsonPath} 不存在(无需删除)`
    },
    {
      name: 'delete_data',
      description: '删除主数据的某个子路径(jsonPath)。主数据整体不可删(用 set_data 整体替换)。expectedHash(可选):改前 read/get 返回的 hash;不传时自动用你最后读到的 hash(autoLock,默认开)防"基于过期值删除"。',
      schema: z.object({
        jsonPath: z.string().describe('要删除的子路径(相对主数据根,如 components.0)'),
        expectedHash: z.string().optional().describe('乐观锁:改前 read/get 返回的 hash;传入则校验,不一致拒绝删除防覆盖'),
      }),
    },
  )
  markWrite(deleteData)

  // snapshot_data / list_data_snapshots 已移除(simplify-toolset):被 history_data({ list: true }) 吸收;
  // 手动检查点改靠 set/edit/delete 自动快照(set/edit/delete 前自动存,restore_data 可回退)。

  const restoreData = tool(
    async ({ id }, config) => {
      const scope = scopeOf(config)  // CA 并发修复:per-call scope token
      if (!snapshots.length) return toolError({ code: 'NO_SNAPSHOT', message: '无快照可回退', hint: 'set/edit/delete 会自动存快照;或 history_data({list:true}) 查看可用快照' })
      const entry = id !== undefined ? snapshots.find((s) => s.id === id) : snapshots[snapshots.length - 1]
      if (!entry) return toolError({ code: 'SNAPSHOT_NOT_FOUND', message: `未找到快照 #${id}`, hint: '用 history_data({list:true}) 查看可用快照序号' })
      const chk = schema.safeParse(entry.value)
      if (!chk.success) return toolError({ code: 'SNAPSHOT_SCHEMA_INVALID', message: `快照 #${entry.id} 的值不符合当前 schema,无法回退`, hint: 'schema 可能已变更;该快照已过期,选其他快照或重新设置', details: formatZodIssues(chk.error.issues) })
      restoreLive(bindRef, deepClone(entry.value))
      markDataDirty()
      audit({ op: 'restore', detail: `#${entry.id}`, timestamp: Date.now() })
      setBaseline(hashValue(bindRef), scope)
      return `已回退主数据到快照 #${entry.id}[${entry.op}]${entry.label ? `(${entry.label})` : ''}。`
    },
    {
      name: 'restore_data',
      description: '把主数据回退到某个快照(就地还原,保留响应式)。不传 id 则回退最近一次(快速回退)。可用 history_data({list:true}) 查看快照列表。',
      schema: z.object({ id: z.number().int().optional().describe('指定快照序号;不传则回退最近一次') }),
    },
  )
  markWrite(restoreData)

  const historyData = tool(
    async ({ id, jsonPath, list }) => {
      // list 模式:返回快照时间线元信息(吸收已移除的 list_data_snapshots;手动检查点 snapshot_data 已移除,靠 set/edit/delete 自动快照)
      if (list) {
        if (!snapshots.length) return '无快照。set/edit/delete 会自动存快照。'
        const lines = snapshots.map((s) => {
          const size = JSON.stringify(s.value ?? '').length
          const time = new Date(s.ts).toLocaleTimeString('zh-CN', { hour12: false })
          return `  #${s.id} [${s.op}]${s.label ? ` "${s.label}"` : ''} ${time} 修改前≈${size}字符`
        })
        return `主数据快照时间线(共 ${snapshots.length} 条,默认最近一次):\n${lines.join('\n')}\n用 history_data({id}) 查看某条快照内容;restore_data({id}) 回退;diff_data({snapshotId}) 对比差异。`
      }
      // 只读查看快照(填列表元信息与 restore_data 破坏性回退之间的空档),不回退当前 bind
      if (!snapshots.length) return toolError({ code: 'NO_SNAPSHOT', message: '无历史快照可查看', hint: 'set/edit/delete 会自动存快照;或 history_data({list:true}) 查看可用序号' })
      const entry = id !== undefined ? snapshots.find((s) => s.id === id) : snapshots[snapshots.length - 1]
      if (!entry) return toolError({ code: 'SNAPSHOT_NOT_FOUND', message: `未找到快照 #${id}`, hint: '不传 id 查看最近一次;或 history_data({list:true}) 查看可用序号' })
      let val: unknown = deepClone(entry.value)
      const jp = jsonPath || ''
      if (jp) {
        if (isUnsafePath(jp)) return toolError({ code: 'PATH_UNSAFE', message: `jsonPath "${jp}" 含非法段`, hint: '使用正常属性路径' })
        if (!isPathAllowed(jp, schema, allowKeys)) return toolError({ code: 'PATH_DENIED', message: `history_data @ "${jp}" 不在 schema 声明字段内`, hint: '仅 schema 声明的 key 可读' })
        val = getByPath(val, jp)
        const subSchema = getSchemaAtPath(schema, jp)
        if (subSchema) val = projectBySchemaDeep(val, subSchema)
      } else if (allowKeys) {
        val = projectBySchemaDeep(val, schema)
      }
      return `快照 #${entry.id}[${entry.op}]${entry.label ? `(${entry.label})` : ''}${jp ? ` @ ${jp}` : ''} = ${safeStringify(val)}`
    },
    {
      name: 'history_data',
      description: '查看主数据快照(只读不回退当前)。list:true 列时间线;传 id 看某次快照内容(默认最近),jsonPath 可只看子路径。冲突诊断/看上一版用;对比差异用 diff_data;回退用 restore_data。',
      schema: z.object({
        id: z.number().int().optional().describe('快照序号;不传则最近一次(list:true 时忽略)'),
        jsonPath: z.string().optional().describe('只看快照的某子路径(相对主数据根);不传则整个快照'),
        list: z.boolean().optional().describe('true 则列出快照时间线元信息(序号/操作/标签/时间/大小);不传则查看单条快照内容'),
      }),
    },
  )

  const queryData = tool(
    async ({ expr, limit }) => {
      if (bindRef == null || typeof bindRef !== 'object') {
        return toolError({ code: 'NOT_OBJECT', message: `主数据不是对象/数组,无法查询(当前为 ${bindRef === undefined ? 'undefined' : typeof bindRef})`, hint: 'query 仅适用于对象/数组;叶子用 get_data 读' })
      }
      const queryTarget = allowKeys ? projectBySchemaDeep(bindRef, schema) : bindRef
      let nodes
      try { nodes = jpEval(queryTarget, expr) } catch (e) {
        return toolError({ code: 'JSONPATH_SYNTAX', message: `JSONPath 解析错误: ${(e as Error).message}`, hint: '语法子集:$ .key [n] ["key"] [*] [?(filter)] ..key ..*;filter:@.field op literal,&&/||/();对象根需先点出数组字段再过滤,如 $.components[?(@.x>1)]', details: { expr } })
      }
      const cap = limit ?? 50
      const sliced = nodes.slice(0, cap)
      const parts = sliced.map((n) => `{"path":${JSON.stringify(n.path)},"index":${n.index === undefined ? 'null' : n.index},"value":${safeStringify(n.value)}}`)
      return `{"matched":${nodes.length},"returned":${sliced.length},"truncated":${nodes.length > cap},"results":[${parts.join(',')}]}`
    },
    {
      name: 'query_data',
      description:
        '用 JSONPath 查询主数据(只读):$ 根/.key/[n]/[*]/[?(==/!=/</<=/>/>=,&&/||)]/..key 递归。返回匹配元素 path/index/value(path 可作 write patch 的 jsonPath);大数组筛选定位用它。',

      schema: z.object({
        expr: z.string().describe('JSONPath 表达式,如 $.components[?(@.type=="card" && @.price<100)] 或 $..title(递归找所有 title)'),
        limit: z.number().int().min(1).max(200).optional().describe('返回结果上限,默认 50'),
      }),
    },
  )

  const searchData = tool(
    async ({ query, mode, fuzzyThreshold, matchKey, limit }) => {
      if (bindRef == null) return toolError({ code: 'EMPTY', message: '主数据为空,无可搜索内容' })
      try {
        const searchTarget = allowKeys ? projectBySchemaDeep(bindRef, schema) : bindRef
        const hits = searchJson(searchTarget, query, { mode: mode as SearchMode, fuzzyThreshold, matchKey, limit: limit ?? 50 })
        return safeStringify({ matched: hits.length, results: hits })
      } catch (e) {
        return toolError({ code: 'REGEX_INVALID', message: `搜索错误: ${(e as Error).message}`, hint: 'regex 模式下 query 须为合法正则;改 mode 为 substring/fuzzy 可避免正则语法问题', details: { query } })
      }
    },
    {
      name: 'search_data',
      description:
        '主数据内文本搜索(只读)。mode:substring(默认,不区分大小写)/regex(i 标志)/fuzzy(Levenshtein ≤ fuzzyThreshold)。递归遍历叶子值返回命中 path+value(超 200 字符截断);找名字记不清的元素用它。',
      schema: z.object({
        query: z.string().describe('搜索词(substring/regex/fuzzy 共用)'),
        mode: z.enum(['substring', 'regex', 'fuzzy']).optional().describe('匹配模式,默认 substring'),
        fuzzyThreshold: z.number().int().min(0).max(5).optional().describe('fuzzy 模式最大编辑距离,默认 2'),
        matchKey: z.boolean().optional().describe('是否同时匹配 key 名,默认 true'),
        limit: z.number().int().min(1).max(200).optional().describe('返回上限,默认 50'),
      }),
    },
  )

  const evalScript = tool(
    async ({ script, mode, jsonPath }, config) => {
      const scope = scopeOf(config)  // CA 并发修复:per-call scope token
      if (script.length > 8000) return toolError({ code: 'SCRIPT_TOO_LARGE', message: `脚本过长(${script.length} 字符,上限 8000)`, hint: '精简脚本;复杂逻辑可分步(先 query 探查再 transform 改),或拆成多次 eval' })
      // 子树模式(paging 拆分):仅 clone/执行 jsonPath 指向的子树,降低大 JSON 的深拷贝/执行成本
      const jp = jsonPath || ''
      let source: unknown
      if (jp) {
        if (!isPathAllowed(jp, schema, allowKeys)) return toolError({ code: 'PATH_DENIED', message: `eval_script @ "${jp}" 不在 schema 声明字段内`, hint: '仅 schema 声明的 key 可作为子树' })
        source = getByPath(bindRef, jp)
        if (allowKeys) { const ss = getSchemaAtPath(schema, jp); if (ss) source = projectBySchemaDeep(source, ss) }
      } else {
        source = allowKeys ? projectBySchemaDeep(bindRef, schema) : bindRef
      }
      const data = deepClone(source)
      const timeout = jp && JSON.stringify(data).length > 100000 ? 8000 : 3000  // 子树较大时延长超时(默认 3s,>100KB 延至 8s)
      const res = await runSandboxedScript(data, script, timeout)
      if (!res.ok) {
        const isTimeout = /超时/.test(res.error || '')
        return toolError({ code: isTimeout ? 'SCRIPT_TIMEOUT' : 'SCRIPT_ERROR', message: `脚本执行失败: ${res.error}`, hint: isTimeout ? '脚本可能有死循环或过重计算;加边界检查/分批;transform 返回完整新值勿返回巨大中间结果' : '检查脚本语法与运行时错误;入参为 data(主数据深拷贝),沙箱内禁用 fetch/XHR/WebSocket', details: { elapsedMs: res.elapsedMs, scriptLen: script.length } })
      }
      if (mode === 'transform') {
        const result = res.result
        // 子树 transform:返回值作为 jsonPath 子树的新值(set 到子路径 + 整体 schema 校验)
        if (jp) {
          const r = applyPatchesToBind({ bindRef, patches: [{ op: 'set', jsonPath: jp, value: result }], schema, allowKeys, snapshots, maxSnapshots, markDataDirty, schemaErrorMode: 'schema_invalid', snapshotLabel: 'eval_transform_subtree', internalAfterWrite, protectedCtx })
          if (!r.ok) return r.error
          audit({ op: 'edit', detail: `eval_transform_subtree @ ${jp}`, timestamp: Date.now() })
          setBaseline(hashValue(bindRef), scope)
          return `已通过脚本 transform 子树 @ ${jp} 更新(耗时 ${res.elapsedMs}ms)。当前值: ${safeStringify(bindRef, 600)}`
        }
        // 增量模式:脚本返回 {patches:[{op,jsonPath,value},...]} → 按 patch 应用(避免大对象整体重传)
        const isPatches = result && typeof result === 'object' && !Array.isArray(result)
          && 'patches' in (result as any) && Array.isArray((result as any).patches)
        if (isPatches) {
          if (bindRef === null || typeof bindRef !== 'object') {
            return toolError({ code: 'LEAF_BIND', message: `主数据 bind 为原始类型(${bindRef === null ? 'null' : typeof bindRef}),eval transform(patches) 无法就地替换`, hint: '主数据 bind 必须为对象/数组;叶子值请用对象包裹或集成方通过 sdk.setData 替换 bind' })
          }
          const r = applyPatchesToBind({ bindRef, patches: (result as any).patches, schema, allowKeys, snapshots, maxSnapshots, markDataDirty, schemaErrorMode: 'schema_invalid', snapshotLabel: 'eval_transform', internalAfterWrite, protectedCtx })
          if (!r.ok) return r.error
          audit({ op: 'edit', detail: `eval_transform(${r.applied.length} patches)`, timestamp: Date.now() })
          setBaseline(hashValue(bindRef), scope)
          return `已通过脚本 transform(patches) 更新主数据(${r.applied.length} 个 patch,耗时 ${res.elapsedMs}ms)。当前值: ${safeStringify(bindRef, 600)}`
        }
        // 整体替换模式:脚本返回完整新值
        let evalResult: unknown = result
        // 强制层(§7c F1):eval transform 整体替换是独立落地路径(不走 commitSetToBind),单独调 enforceSet
        if (protectedCtx) {
          const er = enforceSet({ value: evalResult, ctx: protectedCtx })
          if (!er.ok) return er.error
          evalResult = er.value
        }
        const chk = schema.safeParse(evalResult)
        if (!chk.success) return toolError({ code: 'SCHEMA_INVALID', message: `脚本返回值校验失败,未写入(transform 模式要求返回主数据的完整新值且符合 schema)`, hint: `确认脚本 return 了完整新值(非部分);或返回 {patches:[...]} 走增量模式;按 describe_data() 查看格式`, details: formatZodIssues(chk.error.issues) })
        if (bindRef === null || typeof bindRef !== 'object') {
          return toolError({ code: 'LEAF_BIND', message: `主数据 bind 为原始类型(${bindRef === null ? 'null' : typeof bindRef}),eval transform 无法就地替换外部持有的值引用`, hint: '主数据 bind 必须为对象/数组;叶子值请用对象包裹或集成方通过 sdk.setData 替换 bind' })
        }
        pushSnapshot('edit', 'eval_transform')
        if (chk.data !== null && typeof chk.data === 'object') {
          if (allowKeys) {
            // 白名单模式:merge 语义,只更新 schema 声明字段,隐藏字段保留不动
            safeMerge(bindRef as Record<string, any>, chk.data)
          } else {
            restoreInPlace(bindRef as Record<string, unknown> | unknown[], chk.data)
          }
        }
        markDataDirty()
        audit({ op: 'edit', detail: 'eval_transform', timestamp: Date.now() })
        setBaseline(hashValue(bindRef), scope)
        return `已通过脚本 transform 更新主数据(耗时 ${res.elapsedMs}ms)。当前值: ${safeStringify(bindRef, 600)}`
      }
      return safeStringify({ ok: true, result: res.result, elapsedMs: res.elapsedMs })
    },
    {
      name: 'eval_script',
      description:
        '在 Worker 沙箱对主数据跑自定义 JS(无 window/fetch,超时 3s)。入参 data(深拷贝),返回值即结果。mode:query 只读回给 LLM(过滤/映射/聚合)/transform 落地(返回完整新值或 {patches:[...]} 增量)。jsonPath 可只对子树执行。',
      schema: z.object({
        script: z.string().describe('JS 脚本体,如 data.filter(c=>c.stock>0).map(c=>c.id);入参名 data;末尾表达式或 return 即返回值'),
        mode: z.enum(['query', 'transform']).optional().describe('query=只读返回结果(默认),transform=校验后落地为新值'),
        jsonPath: z.string().optional().describe('子树模式:仅对 jsonPath 指向的子树执行(降低大 JSON 成本);transform 时返回值作为该子树新值'),
      }),
    },
  )
  markWrite(evalScript, (args) => (args as Record<string, unknown>)?.mode === 'transform')

  // ============ 高层直观工具:read / write(合并 describe+get / set+edit+delete+自动锁+自动快照) ============
  const readSlot = tool(
    async ({ jsonPath, jsonPaths, fields, depth, offset, limit }, config) => {
      const scope = scopeOf(config)  // CA 并发修复:per-call scope token(基线归属 + 大文本摘要主/子判定)
      const h = hashValue(bindRef)  // 整体 hash(与 get_data 一致,乐观锁比对整体);多路径/分页/单路径统一取一次
      setBaseline(h, scope)
      // 多路径模式:一次读多个不相关子路径(各路径独立投影/拦截/裁剪;非法路径单项标错,不整批失败),省多轮往返
      if (jsonPaths && jsonPaths.length) {
        const lines = jsonPaths.map((jpRaw) => {
          const jp = jpRaw || ''
          if (!isPathAllowed(jp, schema, allowKeys)) return `- ${jp || '(根)'}: [PATH_DENIED: 不在 schema 声明字段内]`
          let target = jp ? getByPath(bindRef, jp) : bindRef
          if (!jp && allowKeys) target = projectBySchemaDeep(target, schema)
          else if (allowKeys) { const ss = getSchemaAtPath(schema, jp); if (ss) target = projectBySchemaDeep(target, ss) }
          let resolved = target
          if (protectedCtx) resolved = renderReadPlaceholders({ jp, resolved, resourcesByPath: protectedCtx.resourcesByPath, resourceStore: protectedCtx.resourceStore })
          if (opts.interceptors?.read) { try { resolved = opts.interceptors.read(resolved) } catch (e) { return `- ${jp}: [READ_INTERCEPT: ${(e as Error).message}]` } }
          if (fields && fields.length) resolved = projectFields(resolved, fields)
          if (depth !== undefined && depth !== null) resolved = limitDepth(resolved, depth)
          resolved = summarizeLargeText(resolved, scope === MAIN_SCOPE, largeTextSpecs, largeTextThreshold)
          if (resolved === undefined) return `- ${jp} = (undefined)`
          return `- ${jp} = ${safeStringify(resolved)}`
        })
        return `多路径读取(共 ${jsonPaths.length} 项,hash=${h}):\n${lines.join('\n')}`
      }
      const jp = jsonPath || ''
      if (isUnsafePath(jp)) return toolError({ code: 'PATH_UNSAFE', message: `jsonPath "${jp}" 含非法段(__proto__/constructor/prototype)`, hint: '使用正常属性路径,如 components.0.text(数组索引数字)' })
      if (!isPathAllowed(jp, schema, allowKeys)) {
        return toolError({ code: 'PATH_DENIED', message: `read @ "${jp}" 不在 schema 声明字段内`, hint: '主数据仅暴露 schema 声明的字段;若需操作该字段,集成方需在 schema 中声明它' })
      }
      let target = jp ? getByPath(bindRef, jp) : bindRef
      // 投影隐藏未声明字段:统一深投影口径(fix-data-integrity P1-19:整体读也递归投影,与子路径读一致,防嵌套未声明字段泄露)
      if (!jp && allowKeys) target = projectBySchemaDeep(target, schema)
      else if (allowKeys) {
        const subSchema = getSchemaAtPath(schema, jp)
        if (subSchema) target = projectBySchemaDeep(target, subSchema)
      }
      let resolved = target
      if (protectedCtx) resolved = renderReadPlaceholders({ jp, resolved, resourcesByPath: protectedCtx.resourcesByPath, resourceStore: protectedCtx.resourceStore })
      if (opts.interceptors?.read) {
        try { resolved = opts.interceptors.read(resolved) } catch (e) {
          return toolError({ code: 'READ_INTERCEPT', message: `read 拦截器抛错: ${(e as Error).message}` })
        }
      }
      if (fields && fields.length) resolved = projectFields(resolved, fields)
      if (depth !== undefined && depth !== null) resolved = limitDepth(resolved, depth)
      resolved = summarizeLargeText(resolved, scope === MAIN_SCOPE, largeTextSpecs, largeTextThreshold)
      const desc = !jsonPath ? `主数据说明: ${description}\n格式: 写入值需为 JSON,且通过声明的 schema 校验(校验失败时 write 会返回结构化错误)。字段约束(类型/min/max/enum/必填/默认)见 systemPrompt「可操作数据」段,或用 schema_data({ jsonPath }) 按需查。\n\n` : ''
      const proj = fields && fields.length ? `(字段裁剪:${fields.join(',')})` : ''
      const dlim = depth !== undefined && depth !== null ? `(深度≤${depth})` : ''
      const meta = proj || dlim ? ` ${proj}${dlim}` : ''
      // 数组分页(仅当 resolved 是数组 + 传了 offset/limit):切片 + total/hasMore,避免大数组一次性返回
      if ((offset !== undefined || limit !== undefined) && Array.isArray(resolved)) {
        const total = resolved.length
        const off = Math.max(0, offset ?? 0)
        const lim = Math.min(200, Math.max(1, limit ?? 50))
        const items = resolved.slice(off, off + lim)
        const hasMore = off + lim < total
        return `${desc}主数据${jp ? ` @ ${jp}` : ''} 数组分页[offset=${off},limit=${lim}]${meta} = ${safeStringify(items)} (total=${total}, hasMore=${hasMore}) (hash=${h})`
      }
      if (resolved === undefined) return `${desc}主数据${jp ? ` @ ${jp}` : ''}${meta} = (undefined) (hash=${h})`
      return `${desc}主数据${jp ? ` @ ${jp}` : ''}${meta} = ${safeStringify(resolved)} (hash=${h})`
    },
    {
      name: 'read',
      description:
        '读取主数据(高层入口,合并 describe/get)。不传 jsonPath → 返回主数据说明 + 格式提示(含字段约束);传 jsonPath → 返回该子路径当前值 + hash;传 jsonPaths → 一次读多个不相关子路径(省多轮往返)。hash 用于乐观锁(默认 autoLock,write 时自动比对,无需手动传)。fields(字段裁剪)/depth(深度截断)减体积;offset+limit 对数组目标分页(返回切片 + total/hasMore)。集成方可能经 read 拦截器对返回值脱敏/派生。',
      schema: z.object({
        jsonPath: z.string().optional().describe('要读的子路径(相对主数据根,如 components.0.text);不传则读整个主数据并返回说明'),
        jsonPaths: z.array(z.string()).optional().describe('多路径读取:一次读多个不相关子路径(与 jsonPath 互斥,优先于 jsonPath);返回各路径值,非法路径单项标错不整批失败'),
        fields: z.array(z.string()).optional().describe('字段裁剪:只返回指定字段(对对象/数组元素投影),减少返回体积,如 ["id","title"]'),
        depth: z.number().int().min(0).optional().describe('嵌套深度限制:0=只根占位,1=根+子,递归到 depth 层后用 {...}/[...] 占位截断,减少深层返回体积'),
        offset: z.number().int().min(0).optional().describe('数组分页起始偏移(仅当读取目标是数组时生效,默认 0),配合 limit 分页读大数组'),
        limit: z.number().int().min(1).max(200).optional().describe('数组分页每页条数(默认 50,上限 200;仅数组时生效),返回切片 + total/hasMore'),
      }),
    },
  )

  const writeSlot = tool(
    async ({ value, patch, patches, del, dryRun }, config) => {
      const scope = scopeOf(config)  // CA 并发修复:per-call scope token
      let intent: 'set' | 'edit' | 'delete' = 'set'
      if (del) intent = 'delete'
      else if (patches && patches.length) intent = 'edit'
      else if (patch) intent = 'edit'
      let payload: unknown = patch?.value !== undefined ? patch.value : value  // patch 自带 value 优先(与 patches 一致,消除双语义歧义);未填回退顶层 value(向后兼容)
      let patchList: { op: EditOp; jsonPath: string; value?: unknown }[] | undefined
      if (opts.interceptors?.write) {
        try {
          const interceptInput =
            intent === 'delete' ? { del: true, jsonPath: patch?.jsonPath }
            : intent === 'edit' && patches && patches.length ? { patches }
            : intent === 'edit' ? { op: patch!.op ?? 'set', jsonPath: patch!.jsonPath || '', value: payload }
            : value
          const intercepted = opts.interceptors.write(interceptInput, bindRef)
          if (intercepted && typeof intercepted === 'object' && 'error' in (intercepted as any)) {
            return toolError({ code: 'WRITE_INTERCEPT', message: `write 拦截器拒绝: ${(intercepted as any).error}` })
          }
          if (intent === 'delete') {
            // delete 仅校验/拒绝,不写值
          } else if (intent === 'edit' && patches && patches.length) {
            // 批量:拦截器返回新 patches 数组(或原样)
            patchList = (intercepted && Array.isArray(intercepted)) ? (intercepted as any) : patches
          } else if (intent === 'edit') {
            // 单 patch edit:拦截器收到 { op, jsonPath, value },可能返回:
            // ① 原样/修改后的 { op, jsonPath, value } → 取 .value,同步 patch.op/jsonPath
            // ② 修改后的 value(非 { op, ... } 对象)→ 直接用
            if (intercepted && typeof intercepted === 'object' && 'op' in (intercepted as any) && 'jsonPath' in (intercepted as any)) {
              const ir = intercepted as any
              if (ir.op) patch!.op = ir.op
              if (ir.jsonPath !== undefined) patch!.jsonPath = ir.jsonPath
              payload = ir.value
            } else {
              payload = intercepted
            }
          } else {
            // set 整体替换:拦截器收到完整 value,返回修改后的 value
            payload = intercepted
          }
        } catch (e) {
          return toolError({ code: 'WRITE_INTERCEPT', message: `write 拦截器抛错: ${(e as Error).message}` })
        }
      }
      // N1 契约(fix-main-sub-isolation):autoLock 基线在拦截器(同步)之后、冲突检查之前一刻解析 ——
      // 解析→handleConflict→commitSetToBind 为同步路径(无 await),单线程下同 scope 连续写必然后写看到前写刷新的基线,
      // 「agent 自己连续写自己」永不互相冲突。勿在解析与检查之间插入 await(会回归连环误冲突)
      const effHash = autoLock ? getBaseline(scope) : undefined
      // dryRun 预检:乐观锁手动比对(不调 onConflict 挂起,只返回冲突信息;dryRun 不实际写无需人工介入)
      if (dryRun && effHash !== undefined) {
        const curHash = hashValue(bindRef)
        if (curHash !== effHash) return toolError({ code: 'VERSION_CONFLICT', message: `dryRun 预检发现乐观锁冲突: expectedHash=${effHash} 当前 hash=${curHash}(主数据在你 read 后被改)`, hint: '重新 read 拿最新 hash 再预检/写' })
      }

      if (intent === 'delete') {
        if (!patch?.jsonPath) return toolError({ code: 'MISSING_VALUE', message: 'delete 需要 patch.jsonPath 指定要删的子路径(主数据整体不可删,用 write(value) 整体替换)', hint: '如 patch:{jsonPath:"components.0"}, del:true' })
        if (isUnsafePath(patch.jsonPath)) return toolError({ code: 'PATH_UNSAFE', message: `jsonPath "${patch.jsonPath}" 含非法段`, hint: '使用正常属性路径' })
        if (!isPathAllowed(patch.jsonPath, schema, allowKeys)) {
          return toolError({ code: 'PATH_DENIED', message: `write delete @ "${patch.jsonPath}" 不在 schema 声明字段内`, hint: '仅 schema 声明的 key 可删' })
        }
        if (protectedCtx) {
          const hit = matchProtectedEither(patch.jsonPath, protectedCtx.resourcesByPath)
          if (hit) {
            return toolError({ code: hit.spec.mode === 'freeze' ? 'FROZEN_FIELD' : 'VERBATIM_PROTECTED', message: `write delete @ "${patch.jsonPath}" 命中受保护字段 "${hit.protectedPath}"(${hit.spec.mode}),不可删除`, hint: hit.spec.mode === 'freeze' ? '冻结字段不可删' : 'verbatim 字段不可直接删;先 resource_delete 释放' })
          }
        }
        const conflict = await handleConflict('delete', effHash)
        if (conflict !== null) return conflict
        if (dryRun) {
          const dClone = deepClone(bindRef)
          const dOk = deleteByPath(dClone, patch.jsonPath)
          return dOk ? `dryRun(delete): 将删除 @ ${patch.jsonPath}。预览剩余:${safeStringify(dClone, 600)}。未实际写入、未入快照。` : `dryRun(delete): @ ${patch.jsonPath} 不存在(无需删除)。未实际写入。`
        }
        pushSnapshot('delete')
        const ok = deleteByPath(bindRef, patch.jsonPath)
        markDataDirty()
        audit({ op: 'delete', detail: patch.jsonPath, timestamp: Date.now() })
        if (internalAfterWrite) { internalAfterWrite(bindRef, null); markDataDirty() }
        setBaseline(hashValue(bindRef), scope)
        return ok ? `已删除主数据 @ ${patch.jsonPath}` : `主数据 @ ${patch.jsonPath} 不存在(无需删除)`
      }

      if (intent === 'edit') {
        if (bindRef == null || typeof bindRef !== 'object') return toolError({ code: 'NOT_OBJECT', message: `edit 仅适用于对象/数组主数据,当前是 ${bindRef === undefined ? 'undefined' : typeof bindRef}`, hint: '叶子用 write(value) 整体设置' })
        const conflict = await handleConflict('edit', effHash)
        if (conflict !== null) return conflict
        // 统一为 patch 列表:批量用 patches(或拦截器转换后的 patchList);单个用 [patch + 顶层 value]
        const list: { op?: EditOp; jsonPath?: string; value?: unknown }[] = patchList
          ? patchList
          : (patches && patches.length) ? patches
          : [{ op: patch!.op ?? 'set', jsonPath: patch!.jsonPath || '', value: payload }]
        const r = applyPatchesToBind({ bindRef, patches: list, schema, allowKeys, snapshots, maxSnapshots, markDataDirty, schemaErrorMode: 'zod', dryRun, internalAfterWrite, protectedCtx })
        if (!r.ok) return r.error
        if (dryRun) return `dryRun(edit): ${r.applied.length} 个 patch 预检通过(schema 校验 OK)。预览结果:${safeStringify(r.clone, 600)}。未实际写入、未入快照。`
        audit({ op: 'edit', detail: `${r.applied.length} 个 patch${r.applied.length > 1 ? '(批量)' : ''}`, value: r.applied.map((a) => `${a.op}@${a.jp}`), timestamp: Date.now() })
        // B __pgId 补齐已由 internalAfterWrite 在 applyPatchesToBind 成功路径处理
        setBaseline(hashValue(bindRef), scope)
        redactPgInPlace(r.clone)
        return `已 write(edit) 主数据(${r.applied.length} 个 patch)。当前值:${safeStringify(r.clone, 600)} (新 hash=${hashValue(bindRef)})`
      }

      // set 整体(commitSetToBind 纯函数:校验+快照+merge+audit,与 set_data/draft_commit 共用)
      const pr = maybeParseValue(payload)
      if (pr.parseError) return jsonParseError('', payload, pr.parseError)
      const conflict = await handleConflict('set', effHash)
      if (conflict !== null) return conflict
      const r = commitSetToBind({ bindRef, value: pr.parsed, schema, allowKeys, snapshots, maxSnapshots, audit, dryRun, onWrite: markDataDirty, internalAfterWrite, protectedCtx })
      if (!r.ok) return r.error
      if (dryRun) return `dryRun(set): schema 校验通过。预览新值:${safeStringify(r.data, 600)}。未实际写入、未入快照。`
      // B __pgId 补齐已由 internalAfterWrite 在 commitSetToBind 成功路径处理
      const __postHash = hashValue(bindRef)
      setBaseline(__postHash, scope)
      redactPgInPlace(r.data)
      return `已 write(set) 主数据 = ${safeStringify(r.data, 600)} (新 hash=${__postHash})${allowKeys ? '(白名单模式:仅更新 schema 声明字段,未声明字段保留)' : ''}`
    },
    {
      name: 'write',
      description:
        '写入主数据(高层入口,合并 set/edit/delete + 自动乐观锁 + 自动快照)。四意图:① 整体替换 write({value:整个对象});② 增量 write({patch:{op,jsonPath,value}}) op=set/remove/merge/append/move(move 的 value=目标路径字符串);③ 批量原子 write({patches:[...]})(任一失败整批回滚);④ 删子路径 write({patch:{jsonPath},del:true})。dryRun:true 预检不落盘。写入自动 schema 校验(失败不写,按错误修正重试)+ 自动快照。详细用法见系统提示「能力使用提示」。',

      schema: z.object({
        value: z.unknown().optional().describe('JSON 对象(推荐,如 {title:"x"})或 JSON 字符串;set 整体或单个 patch 的 set/merge/append 必填'),
        patch: z.object({
          op: z.enum(['set', 'remove', 'merge', 'append', 'move']).optional().describe('增量操作:set 设值/remove 删/merge 合并对象/append 追加数组/move 移动数组元素(value=目标路径字符串)。单 patch edit 缺省按 set;del 模式(write({patch:{jsonPath},del:true}))不读 op 可省略'),
          jsonPath: z.string().optional().describe('相对主数据根的点号路径(如 components.0.text);set/remove 必填,merge/append 不填则作用于根'),
          value: z.unknown().optional().describe('该 patch 的值(JSON 直传或 JSON 字符串);set/merge/append 必填,remove 不需。与顶层 value 二选一:优先 patch.value,未填则回退顶层 value(向后兼容)。推荐用 patch.value(自带,与 patches 元素一致,无歧义)'),
        }).optional().describe('单个增量编辑(自带 value,与 patches 元素一致);传 patch(无 patches)走单 patch edit 语义'),
        patches: z.array(z.object({
          op: z.enum(['set', 'remove', 'merge', 'append', 'move']),
          jsonPath: z.string().optional().describe('相对主数据根的点号路径;set/remove 必填,merge/append 不填则作用于根'),
          value: z.unknown().optional().describe('JSON 值(推荐直传)或 JSON 字符串;set/merge/append 必填,remove 不需'),
        })).optional().describe('批量增量编辑:一次原子应用多个 patch(任一失败则整体不写入,clone 试跑全部 + schema 校验通过才落 live)。适合一次改多处,减少多轮往返'),
        del: z.boolean().optional().describe('true 则删除 patch.jsonPath 指定的子路径(等价 delete_data)'),
        dryRun: z.boolean().optional().describe('预检模式:走完整校验链(schema + 白名单 + patch 应用到 clone)但不落盘、不入快照,返回预览。四意图(value/patch/patches/del)均支持;乐观锁冲突照常检测(返回 VERSION_CONFLICT 不挂起)'),
      }),
    },
  )
  markWrite(writeSlot)

  const schemaData = tool(
    async ({ jsonPath }) => {
      const jp = jsonPath || ''
      const sub = jp ? getSchemaAtPath(schema, jp) : schema
      if (!sub) return toolError({ code: 'PATH_DENIED', message: `schema @ "${jp}" 不存在`, hint: 'jsonPath 需在 schema 声明字段内(用 read() 不传 jsonPath 查看顶层字段)' })
      return `schema${jp ? ` @ ${jp}` : ''} = ${safeStringify(describeSchemaNode(sub))}`
    },
    { name: 'schema_data', description: '查看主数据(或子路径)的字段约束:类型/min/max/enum/必填/默认值/嵌套 shape。写前查约束,避免写错重试。不传 jsonPath 查根;传子路径(如 components.0)查该位置约束。', schema: z.object({ jsonPath: z.string().optional().describe('要查约束的子路径;不传查根 schema') }) },
  )

  const diffData = tool(
    async ({ snapshotId, against }) => {
      const useAgainst = against !== undefined && against !== null
      let base: unknown
      let label: string
      if (useAgainst) {
        // against 可能是 JSON 字符串(LLM 直传),走 maybeParseValue 与 set_data/write 的 value 处理对齐(parse 失败保留原串)
        let v: unknown = against
        if (typeof v === 'string') {
          const pr = maybeParseValue(v)
          if (!pr.parseError) v = pr.parsed
        }
        base = v
        label = 'against'
      } else {
        if (!snapshots.length) return toolError({ code: 'NO_SNAPSHOT', message: '无快照可对比', hint: 'set/edit/delete 自动存快照;或传 against 一段 JSON 值直接对比' })
        const entry = snapshotId !== undefined ? snapshots.find((s) => s.id === snapshotId) : snapshots[snapshots.length - 1]
        if (!entry) return toolError({ code: 'SNAPSHOT_NOT_FOUND', message: `未找到快照 #${snapshotId}`, hint: '不传 snapshotId 用最近一次;或传 against' })
        base = entry.value
        label = `快照 #${entry.id}`
      }
      // 当前主数据按白名单深投影(与快照/against 对比口径一致,递归隐藏未声明字段;P1-19)
      const cur = allowKeys ? projectBySchemaDeep(bindRef, schema) : bindRef
      const diffs = diffObjects(base, deepClone(cur))
      if (!diffs.length) return `无差异:当前主数据与 ${label} 完全相同。`
      return `差异(当前 vs ${label},共 ${diffs.length} 处):\n${diffs.map((d) => `  ${d.path}: ${safeStringify(d.from)} → ${safeStringify(d.to)}`).join('\n')}`
    },
    { name: 'diff_data', description: '对比当前主数据与某快照(默认最近)或一段 JSON(against)的差异,返回结构化 {path, from→to} 列表。供 verify 自纠/冲突诊断/操作审计("刚才改了啥")。snapshotId 指定快照;against 传一段 JSON 值(与 snapshotId 互斥,传则忽略快照)。', schema: z.object({ snapshotId: z.number().int().optional().describe('对比的快照序号;不传则最近一次'), against: z.unknown().optional().describe('对比的一段 JSON 值(与 snapshotId 互斥;传则忽略快照)') }) },
  )

  // ============ draft_write / draft_commit(分块构建超大 JSON;opt-in:opts.vfsStore 提供时装配,capabilities.draftWrite 控制)============
  // 场景:几百 K JSON 逼近 LLM max_tokens,单次 write 装不下。LLM 分块 draft_write 累积 → draft_commit 原子校验+写 bind
  // draft_commit 复用 commitSetToBind(与 write(set)/set_data 共用校验+快照+乐观锁链)
  const draftTools: StructuredToolInterface[] = []
  if (opts.vfsStore) {
    const store = opts.vfsStore
    const draftKey = (id: string) => `drafts/${id}.json`
    const draftWrite = tool(
      ({ draftId, chunk, mode }) => {
        const key = draftKey(draftId)
        const existing = store.files[key]
        const append = mode === 'append' && existing
        const content = append ? existing.content + chunk : chunk
        store.files[key] = { content, updatedAt: Date.now() }
        return JSON.stringify({ draftId, bytes: content.length, mode: append ? 'append' : 'start' })
      },
      {
        name: 'draft_write',
        description:
          '分块写 JSON 草稿到 drafts 池(单次 write 受 max_tokens 限制装不下时用)。mode:"start" 新建/"append" 追加拼接;返回 {draftId,bytes} 看累计进度。累积完 draft_commit 提交;拼接不合法返回 JSON_INVALID 草稿保留。',
        schema: z.object({
          draftId: z.string().describe('草稿标识(自起,如 "page-gen-1")'),
          chunk: z.string().describe('JSON 片段字符串(分块输出,append 拼接成完整 JSON;如 \'{"components":[\' / \'{"type":"heading",...},\' / \']}\')'),
          mode: z.enum(['start', 'append']).optional().describe('start=新建/覆盖(默认);append=追加 chunk 到已有草稿'),
        }),
      },
    )
    const draftCommit = tool(
      async ({ draftId, expectedHash }, config) => {
        const scope = scopeOf(config)  // CA 并发修复:per-call scope token
        const key = draftKey(draftId)
        const entry = store.files[key]
        if (!entry) return toolError({ code: 'DRAFT_NOT_FOUND', message: `草稿 "${draftId}" 不存在`, hint: '先 draft_write({draftId, chunk, mode:"start"}) 新建,再 append 累积分块' })
        let parsed: unknown
        try {
          parsed = JSON.parse(entry.content)
        } catch (e) {
          return toolError({ code: 'JSON_INVALID', message: `草稿 "${draftId}" 拼接后非合法 JSON: ${(e as Error).message}`, hint: '检查 chunk 拼接(逗号/括号/引号是否匹配,首尾是否闭合);草稿保留未删,可继续 draft_write 修正后重 commit', details: { bytes: entry.content.length, preview: entry.content.slice(0, 200) + (entry.content.length > 200 ? '…' : '') } })
        }
        // harden-large-json-write(A1):draft_commit 乐观锁 —— draft 累积跨多轮 LLM 调用,期间 bind 可能被外部改过;
        // 与 set/edit 一致走 handleConflict(autoLock 用最后 read 的 hash;显式 expectedHash 优先),冲突触发人工介入,不静默覆盖整份大 JSON。
        // 顺序:parse 先(草稿非法早返回 JSON_INVALID,不浪费冲突介入)→ handleConflict → commitSetToBind
        const effHash = expectedHash || (autoLock ? getBaseline(scope) : undefined)
        const conflict = await handleConflict('set', effHash)
        if (conflict !== null) return conflict  // 冲突:草稿保留(未删),LLM 重 read 拿最新 hash 后再 commit
        // 复用 commitSetToBind(与 write(set)/set_data 共用:schema 校验 + 快照 + merge + audit);op='draft_commit' 标记快照/审计
        const r = commitSetToBind({ bindRef, value: parsed, schema, allowKeys, snapshots, maxSnapshots, audit, op: 'draft_commit', onWrite: markDataDirty, internalAfterWrite, protectedCtx })
        if (!r.ok) return r.error  // schema 校验失败:草稿保留(不删),LLM 据错误修后重 commit
        setBaseline(r.hash, scope)
        delete store.files[key]  // 成功:清草稿
        return `已 draft_commit 草稿 "${draftId}" → 主数据 = ${safeStringify(r.data, 600)} (新 hash=${r.hash})${allowKeys ? '(白名单模式:仅更新 schema 声明字段)' : ''}。草稿已清理。`
      },
      {
        name: 'draft_commit',
        description:
          '把 draft_write 累积的草稿合并 + JSON.parse + 乐观锁 + schema 校验,原子提交主数据(任一步失败不写,草稿保留可修后重试;成功清草稿 + 自动快照可回退)。仅大 JSON 从零生成用;小改用 write。',
        schema: z.object({
          draftId: z.string().describe('要提交的草稿标识(对应 draft_write 的 draftId)'),
          expectedHash: z.string().optional().describe('乐观锁:改前 read/get 返回的 hash;传入则校验,不一致拒绝写入防覆盖。不传则自动用你最后读到的 hash(autoLock)'),
        }),
      },
    )
    markWrite(draftCommit)
    draftTools.push(draftWrite, draftCommit)
  }

  // ============ 受保护资源工具(opt-in:config.resources 非空 + vfsStore 时装配;advanced 暴露,simple/minimal 隐藏)============
  // resource_get 取真值(占位符背后)/ resource_update 改 verbatim 原值(同步 bind+标脏)/ resource_list / resource_delete 释放
  const resourceTools: StructuredToolInterface[] = []
  if (config.resources?.length && resourceStore) {
    const rget = tool(
      async ({ path, handle }) => {
        // 仅受保护路径(E2:防 LLM 拿它把任意路径值塞进资源池)
        let target = path
        if (!target && handle) target = resourceStore!.get(handle)?.path
        if (!target) return toolError({ code: 'RESOURCE_NOT_FOUND', message: '未提供 path 或有效 handle', hint: '传 path(受保护字段)或 handle(占位符 ⟦res:handle⟧ 里的句柄)' })
        const np = normalizePath(target)
        if (!resourcesByPath.has(np)) return toolError({ code: 'RESOURCE_NOT_FOUND', message: `"${target}" 不是受保护字段`, hint: 'resource_get 仅查集成方在 data.resources 声明的路径' })
        const entry = resourceStore!.get(np)
        if (entry) return safeStringify({ path: entry.path, mode: entry.mode, value: entry.value, handle: entry.handle })
        // 有 path 无资源(未懒注册)→ 按当前 bind 值即时生成入库
        const cur = getByPath(bindRef, np)
        if (cur === undefined) return toolError({ code: 'RESOURCE_NOT_FOUND', message: `字段 "${target}" 当前无值,无法注册`, hint: '该字段可能在 bind 中不存在;先 read 触发懒注册' })
        const spec = resourcesByPath.get(np)!
        const h = resourceStore!.ensure(np, cur, spec.mode)
        return safeStringify({ path: np, mode: spec.mode, value: cur, handle: h })
      },
      {
        name: 'resource_get',
        description: '取受保护字段(freeze/verbatim)的真实值(占位符背后的精确值)。仅受保护路径(集成方在 data.resources 声明)。read 返回 ⟦frozen:path⟧/⟦res:handle⟧ 占位符,确需真值时用此工具。传 path 或 handle。',
        schema: z.object({
          path: z.string().optional().describe('受保护字段路径(data.resources 声明的)'),
          handle: z.string().optional().describe('占位符 ⟦res:handle⟧ 里的句柄(与 path 二选一)'),
        }),
      },
    )
    const rupdate = tool(
      async ({ path, value }, config) => {
        const scope = scopeOf(config)  // CA 并发修复:per-call scope token
        if (!path) return toolError({ code: 'MISSING_VALUE', message: 'resource_update 需要 path', hint: '传要更新的 verbatim 受保护字段路径' })
        const np = normalizePath(path)
        const spec = resourcesByPath.get(np)
        if (!spec) return toolError({ code: 'RESOURCE_NOT_FOUND', message: `"${path}" 不是受保护字段`, hint: 'resource_update 仅改 data.resources 声明的字段' })
        if (spec.mode === 'freeze') return toolError({ code: 'FROZEN_FIELD', message: `字段 "${path}" 已冻结,resource_update 也不可改`, hint: '冻结字段完全只读' })
        // schema 校验新值类型(用该位置 subSchema)
        const subSchema = getSchemaAtPath(schema, np)
        if (subSchema) {
          const chk = subSchema.safeParse(value)
          if (!chk.success) return toolError({ code: 'SCHEMA_INVALID', message: `resource_update 值不符合 "${path}" 的类型`, hint: '按字段类型传值', details: formatZodIssues(chk.error.issues) })
        }
        // verbatim:更新池 + 同步 bind(D1 一致)+ 标脏(D2)+ 刷新乐观锁 hash(H2,与其他写路径一致,防下次 write VERSION_CONFLICT);handle 路径派生不变
        resourceStore!.update(np, value)
        setByPath(bindRef, np, value)
        setBaseline(hashValue(bindRef), scope)
        markDataDirty()
        const h = resourceStore!.get(np)?.handle
        return `已更新 verbatim 资源 "${path}" = ${safeStringify(value, 200)}(handle ${h ?? '(未知)'} 不变)。后续 write 该字段写回句柄 ⟦res:${h}⟧ 或新值`
      },
      {
        name: 'resource_update',
        description: '更新 verbatim 受保护字段的真实值(改精确原值,如刷新 token/hash)。仅 verbatim 可改;freeze 拒。更新后同步 bind + 标脏,后续 write 写回句柄即用新值。',
        schema: z.object({
          path: z.string().describe('要更新的 verbatim 受保护字段路径'),
          value: z.unknown().describe('新值(需符合字段 schema 类型)'),
        }),
      },
    )
    markWrite(rupdate)
    const rlist = tool(
      async () => {
        const list = resourceStore!.list()
        if (!list.length) return '当前无已注册的受保护资源(read 受保护路径会懒注册)'
        return safeStringify({ resources: list })
      },
      { name: 'resource_list', description: '列出所有已注册的受保护资源(path/mode/handle/bytes)。', schema: z.object({}) },
    )
    const rdelete = tool(
      async ({ path, handle }) => {
        let target = path
        if (!target && handle) target = resourceStore!.get(handle)?.path
        if (!target) return toolError({ code: 'RESOURCE_NOT_FOUND', message: '未提供 path 或有效 handle', hint: '传要释放的受保护字段 path 或 handle' })
        const ok = resourceStore!.delete(target)
        return ok ? `已释放资源 "${target}"(后续 read 该字段会重新懒注册)` : `资源 "${target}" 不存在(无需释放)`
      },
      {
        name: 'resource_delete',
        description: '释放受保护资源(从资源池删除,后续 read 重新懒注册)。用于不再需要保护的字段或释放空间。',
        schema: z.object({
          path: z.string().optional().describe('要释放的受保护字段路径'),
          handle: z.string().optional().describe('占位符句柄(与 path 二选一)'),
        }),
      },
    )
    markWrite(rdelete)
    resourceTools.push(rget, rupdate, rlist, rdelete)
  }

  const tools: StructuredToolInterface[] = [
    describeData, getData, setData, editData, deleteData,
    restoreData, historyData,
    queryData, searchData, evalScript,
    readSlot, writeSlot, schemaData, diffData,
    ...draftTools,
    ...resourceTools,
  ]
  Object.defineProperty(tools, 'controller', { value: controller, enumerable: false, configurable: false, writable: false })
  // per-scope 基线 marker(P1-13):子 agent 工具池构建时按此识别 dataOps 工具并包 scope proxy
  // (不可枚举 → 不污染遍历;经 wrapWithPathGuard 的 Proxy 透传可见)
  for (const t of tools) Object.defineProperty(t, '__dataOpsScoped', { value: true, enumerable: false, configurable: false })
  return tools
}


