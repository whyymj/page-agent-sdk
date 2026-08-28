/**
 * 数据操作工具 —— 单主对象 + schema 校验 + 增量编辑 + 快照回退(无人工审批)
 *
 * 设计:低代码页面通常只有一个主 JSON(如 page),本工具集围绕「唯一主对象」操作:
 *  - 集成方声明 { schema, bind, description? };bind 为 reactive/普通对象,工具直接读写 bind(不挂 window)
 *  - 工具无 path/name 参数:Agent 直接操作唯一主对象,降低认知负担
 *  - 增量编辑 write({patch}):按 op(set/remove/merge/append)+ jsonPath 改局部,避免 LLM 重传整个大 JSON
 *  - 快照回退:write 前自动存快照;restore_data 支持快速回退
 *  - 就地写回:edit/restore 改子属性,绝不替换 bind 根引用 → 兼容 Vue reactive
 *  - 审计:每次 set/edit/delete/restore 记日志(可选 onAudit 回调)
 *
 * 注:大结果的外存/截断由 createAgent 的 coreExecTool 经 offloadLargeResult 处理;
 *     read 返回完整安全序列化(不截断),交由 offload 决定外存 vfs 或截断。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { ZodType } from 'zod'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { jpEval, searchJson, runSandboxedScript, type SearchMode } from './dataSlotQuery'
import { toolError, zodError, jsonParseError, formatZodIssues } from './toolError'
import {
  isUnsafePath, safeMerge, getByPath, setByPath, deleteByPath, deepClone, maybeParseValue,
  projectFields, limitDepth, safeStringify, hashValue, watchFieldsHash,
  applyPatchToClone, restoreLive, restoreInPlace, diffObjects, findStrippedKeys, moveByPath,
  UNSAFE_KEYS,
  type EditOp,
} from './jsonUtils'

// ===== C2 错误即向导 · 写侧键集建议(tool-call-economy,3.44.x)=====
/** schema 声明键集(开放节点/取不到返回 null —— 不回落 bind,未声明键名不因报错泄露;与 read 深投影同口径) */
function declaredKeysAt(schema: ZodType | undefined, parentJp: string): string[] | null {
  if (!schema) return null
  const sub = parentJp ? getSchemaAtPath(schema, parentJp) : schema
  const shape = (sub as unknown as { shape?: Record<string, unknown> } | null | undefined)?.shape
  return shape && typeof shape === 'object' ? Object.keys(shape) : null
}
/** 键集建议后缀(截断 12 个防超长;空/null = 无后缀) */
const keysHintSuffix = (keys: string[] | null): string =>
  keys && keys.length ? `(可用字段:${keys.slice(0, 12).join(', ')}${keys.length > 12 ? ' …' : ''})` : ''
/** 取父路径(components.0.title → components.0;无分隔 → 根'') */
const parentPathOf = (jp: string): string => (/[.[]/.test(jp) ? jp.replace(/[.[][^.[]*$/, '') : '')

import {
  getSchemaTopKeys, isPathAllowed, getSchemaAtPath, projectBySchemaDeep, describeSchemaNode, extendSchemaWithPgId,
  validateAtPath, resolveSchemaPath, schemaHasRefinement, arrayMinLength, elementSchemaCandidates,
} from './schemaUtils'
import type { VfsStore } from '../backends/vfs'
import type { ResourceProtectSpec, ProtectedCtx } from './resources'
import { ResourceStore, renderReadPlaceholders, enforceSet, enforcePatches, matchProtectedEither, normalizePath, deepEqual, commitReanchors } from './resources'

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
  op: 'set' | 'edit' | 'delete' | 'restore' | 'snapshot' | 'draft_commit' | 'conflict_recheck'
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

export interface DataOpsOptions {
  onAudit?: (entry: DataAuditEntry) => void
  maxSnapshots?: number
  onConflict?: (conflict: ConflictInfo) => Promise<ConflictResolution>
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
  /**
   * 冲突监听字段白名单(3.32 起乐观锁唯一旋钮,任意深度字段名;autoLock 已废弃):
   * 宿主常在 SDK 写路径之外持续改写元数据(editor_fangzhou 实测 Node.vue 每秒回写
   * props.minHeight、挂载注入 leaf/childLimit),全字段自动检测必然高频误报。
   * - 未声明/空 = **不开自动冲突检测**
   * - `['*']` = 全字段检测(旧 autoLock 行为)
   * - 普通名单 = 仅这些字段的值变动触发冲突(位置不敏感:watchFieldsHash 收集监听键值
   *   集合排序哈希,组件增删致 jsonPath 位移不误报)
   * read 返回 hash 与比对同源。
   */
  conflictWatchFields?: string[]
  /**
   * 同轮工具并发上限(createAgent 透传;write-conflict-final-hash C 形态装配条件):
   * `>1 && conflictWatchFields 武装` 时启用闭包级并发写互锁(async mutex,单锁 bind 域)——
   * 修「同轮并发两写都在 await handleConflict 让出前取旧基线 → 双双过乐观锁 → 后写静默覆盖前写」。
   * 串行(默认 1)或未武装时互锁为直通 no-op,零行为零成本变化(conflictWatchFields 仍是
   * 「是否校验」的唯一旋钮,不越权给未武装用户加冲突;未武装并行的「后写覆盖」为既有明文语义)。
   */
  maxParallelTools?: number
  /**
   * 沙箱执行器注入(内部测试缝,team-audit P1#3):缺省 createSandboxRunner 的 Worker 实现,零变化;
   * node 无 Worker 环境的自测注入 in-process 执行器走通 eval_script transform 真实落地分支。
   * 形态与 runSandboxedScript 同:(data, script, timeoutMs) → {ok, result?, error?, elapsedMs}。
   */
  sandboxRunner?: (data: unknown, script: string, timeoutMs: number) => Promise<{ ok: boolean; result?: unknown; error?: string; elapsedMs: number }>
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
  /**
   * 一次性重算所有已存在 scope 的基线(baseline-guard 中间件用)。
   * bind 为全 scope 共享(基线 = 整体 bind hash),非 dataOps 工具(集成方 defineTool/actions 等)改 bind 后
   * 所有 scope 基线同时过期,一次 hashValue 全部刷新,防后续 autoLock 误冲突(editor_fangzhou 自冲突根因修)。
   */
  recomputeAllBaselines?(): void
  /** 是否存在基线条目(baseline-guard 短路:无基线则无过期问题,跳过 before/after hash 开销) */
  hasBaselines?(): boolean
  /** 受保护资源清单快照(供 resourcesPin 中间件每轮 augmentPrompt 注入「受保护资源」段;freeze 无 handle,verbatim 有) */
  getResourcesSnapshot?(): { path: string; mode: 'freeze' | 'verbatim'; handle?: string }[]
  /**
   * 本次 invoke 内被摘要(主 scope read/query 返回占位)的子树绝对路径集(subtree-summary Phase 1:
   * read-before-write 守卫判定基础 —— 写路径落入摘要子树且无窄读记录 → 拦下引导窄读)。
   * 含 <subtree …> 体积占位与 <field Nkb> 标记占位两类;invoke 边界由守卫 beforeAgent 清空。
   */
  getSummarizedPaths?(): string[]
  /** 清空摘要路径集(守卫 beforeAgent 调,invoke 级口径) */
  clearSummarizedPaths?(): void
  /** 资源池操作(经 controller 同闭包;有 vfsStore 时可用) */
  createResource?(path: string, value?: unknown): string
  getResource?(pathOrHandle: string): { path: string; mode: string; value: unknown; handle: string } | undefined
  updateResource?(path: string, value: unknown): void
  deleteResource?(pathOrHandle: string): boolean
  listResources?(): { path: string; mode: string; handle: string; bytes: number }[]
}

/**
 * 整体 set 局部校验(path-scoped-validation):只校验 value 中出现的顶层 key(merge 语义下未出现的 key 不过堂,
 * 缺必填不再拒 —— 契约收窄,见 change path-scoped-validation);每个出现的 key 深校验 agent 供給的子树 +
 * per-key strip 检测(新增未声明键照拒,fix-silent-strip 防线平移)。返回各 key 的 zod 解析值(strip 语义保留,
 * 防未声明嵌套键/__proto__ own 键落 bind —— fix-write-safety-bypass P0-1 防线平移)。
 * 非 ZodObject schema(allowKeys null,如数组根)→ 整对象校验(value 全量 agent 供給,整校验即局部)。
 * commitSetToBind / eval_script transform(整体替换)共用。纯函数可单测。
 */
export function validateRootValueLocally(args: {
  schema: ZodType
  allowKeys: string[] | null
  value: unknown
  bindRef: unknown
}): { ok: true; assembly: unknown; wholeParsed: Record<string, unknown> | null; notices: string[] } | { ok: false; error: string; notices: string[] } {
  const { schema, allowKeys, value, bindRef } = args
  const notices: string[] = []
  if (allowKeys) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, error: zodError('', [{ path: [], code: 'invalid_type', message: `整体 set 需为 JSON 对象(当前为 ${Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value})`, expected: 'object' }]), notices }
    }
    const beforeObj = (bindRef && typeof bindRef === 'object' && !Array.isArray(bindRef) ? bindRef : {}) as Record<string, unknown>
    const src = value as Record<string, unknown>
    const parsedKeys: Record<string, unknown> = {}
    for (const k of Object.keys(src)) {
      if (k.startsWith('__pg')) continue  // 框架内部字段:静默丢弃(与旧整对象 parse strip 行为一致)
      const v = src[k]
      const vr = validateAtPath(schema, k, v)
      if (!vr.ok) {
        if (vr.resolution === 'missing') {
          // 键不在 schema 声明:bind 已有 → 宿主自管字段,跳过保留原值(与旧 strip+safeMerge 行为一致);
          // bind 没有 → 本次新增未声明键 → 拒(fix-silent-strip)
          if (k in beforeObj) continue
          return { ok: false, error: toolError({ code: 'SCHEMA_STRIP', message: `字段 ${k} 不在 schema 声明内,写入被拒绝(防静默丢失)`, hint: `该数据结构不支持这些字段;请只用 schema 声明的字段,或在 data.schema 中声明后重试${keysHintSuffix(declaredKeysAt(schema, ''))}`, path: k, details: { stripped: [k] } }), notices }
        }
        return { ok: false, error: zodError(k, vr.issues ?? []), notices }
      }
      if (vr.resolution === 'open') notices.push(`${k}=开放节点放行`)
      // per-key strip 检测(值内新增的未声明嵌套键)
      const stripped = findStrippedKeys(beforeObj[k], v, vr.data, k)
      if (stripped.length) {
        return { ok: false, error: toolError({ code: 'SCHEMA_STRIP', message: `字段 ${stripped.join(', ')} 不在 schema 声明内,写入被拒绝(防静默丢失)`, hint: `该数据结构不支持这些字段;请只用 schema 声明的字段,或在 data.schema 中声明后重试${keysHintSuffix(declaredKeysAt(schema, parentPathOf(String(stripped[0]))))}`, path: stripped[0], details: { stripped } }), notices }
      }
      parsedKeys[k] = vr.data
    }
    if (schemaHasRefinement(schema)) notices.push('根级 refine/superRefine 不再在 write 时执行(走 capabilities.verify)')
    return { ok: true, assembly: parsedKeys, wholeParsed: null, notices }
  }
  // 非 ZodObject schema:整对象校验(退路;value 全量为 agent 供給,整校验即局部)
  const res = schema.safeParse(value)
  if (!res.success) return { ok: false, error: zodError('', res.error.issues), notices }
  const stripped = findStrippedKeys(bindRef, value, res.data)
  if (stripped.length) {
    return { ok: false, error: toolError({ code: 'SCHEMA_STRIP', message: `字段 ${stripped.join(', ')} 不在 schema 声明内,写入被拒绝(防静默丢失)`, hint: '该数据结构不支持这些字段;请只用 schema 声明的字段,或在 data.schema 中声明后重试', path: stripped[0], details: { stripped } }), notices }
  }
  return { ok: true, assembly: res.data, wholeParsed: res.data as Record<string, unknown>, notices }
}

/**
 * 增量 patch 局部校验(path-scoped-validation 核心):全部 patch apply 到 clone 后,按**最终态**逐目标校验 ——
 * 只校验 agent 写入的内容(set 的目标值 / merge 的目标键终值 / append 的新元素 / move 的元素),兄弟脏数据不再株连
 * (script:"" 事故根因);任一目标失败 → 整批不写(原子语义不变)。strip/原型污染防线平移到 per-path
 * (写回值 = 局部 parse 结果,未声明嵌套键/__proto__ own 键不落 bind)。
 * append/move 的元素引用在 apply 循环捕获(后续 patch 可能在同一 clone 内继续改这些对象,校验取最终态)。
 * 返回逐目标写回计划(op 按原 patch 序重放到 live bind)。纯函数,applyPatchesToBind 内联消费 + selftest 直测。
 */
export interface LocalWriteBack {
  op: 'set' | 'remove' | 'move' | 'mergeKeys' | 'appendElems' | 'appendStr'
  jp: string
  value?: unknown
  toPath?: string
  entries?: [string, unknown][]
  elems?: unknown[]
  /** appendStr:字符串拼接的追加片段(chunked-code-write) */
  str?: string
}

export interface LocalValidationPlan {
  ok: boolean
  error?: string
  /** 写回计划:按 patch 原序重放到 live bind(值 = 局部 parse 结果) */
  writeBacks: LocalWriteBack[]
  notices: string[]
}

export function validateWriteLocally(args: {
  schema: ZodType
  bindRef: unknown
  clone: unknown
  patches: { op?: EditOp; jsonPath?: string; value?: unknown }[]
  /** schema 校验失败错误模式(与 applyPatchesToBind 的 schemaErrorMode 同参):'zod'(zodError)/'schema_invalid'(toolError) */
  schemaErrorMode?: 'zod' | 'schema_invalid'
  /** append 元素引用(apply 循环捕获,与 patches 序对齐;每项 = {jp, elems}) */
  appendCaptures: { jp: string; elems: unknown[] }[]
  /** move 元素引用(apply 循环捕获;每项 = {jp, toPath, elem}) */
  moveCaptures: { jp: string; toPath: string; elem: unknown }[]
  /**
   * 目标取值兜底(可选):后续 patch(remove/位移)使早先 set/merge 的 jsonPath 在最终 clone 上取不到值时,
   * 用此回调回退取「该 patch 应用后的快照值」。缺省 = 直接 getByPath(clone, jp)。
   * 同批次「set X + remove 让 X 位移」是合法模式(e2e ⑧:末尾 set 容器 + remove 原位,remove splice 前移后
   * 旧路径 undefined)—— 位移后旧路径取空不代表写入内容坏,按快照值校验。快照由 apply 循环逐 patch 捕获。
   */
  valueAt?: (jp: string) => unknown
  /** 受保护字段名集(frozen-required-hint,2026-08-28):缺必填命保护字段时给死锁提示防编造值硬闯;缺省不提示 */
  protectedFieldNames?: Set<string>
}): LocalValidationPlan {
  const { schema, bindRef, clone, patches, schemaErrorMode = 'zod', appendCaptures, moveCaptures } = args
  const notices: string[] = []
  const valueAt = (jp: string): unknown => {
    const v = getByPath(clone, jp)
    return v === undefined ? args.valueAt?.(jp) : v
  }
  // frozen-required-hint:缺必填(invalid_type/undefined)命保护字段名 → 该字段 agent 读不到真值,新建元素缺它属预期;
  // 提示逃生门防「编造值硬闯 → 撞 FROZEN_FIELD → 换路再撞」死锁循环(名字级交叉,宁可漏提勿误伤)
  const protectedMissing = (issues: unknown[]): string[] => {
    if (!args.protectedFieldNames?.size) return []
    const hits = new Set<string>()
    for (const raw of issues) {
      const i = raw as { code?: string; path?: (string | number)[]; received?: unknown; message?: string }
      const leaf = i.path?.length ? String(i.path[i.path.length - 1]) : ''
      // zod4 缺必填:received 为 undefined 值(非字符串);兼容 'undefined' 字符串与 Required 消息两种形态
      const missing = i.code === 'invalid_type' && (i.received === undefined || i.received === 'undefined' || /required/i.test(i.message ?? ''))
      if (missing && leaf && args.protectedFieldNames!.has(leaf)) hits.add(leaf)
    }
    return [...hits]
  }
  const mkError = (jp: string, issues: unknown[]): string => {
    const ph = protectedMissing(issues)
    const protHint = ph.length
      ? `;⚠ 字段 ${ph.join('/')} 受保护(freeze/verbatim),agent 读不到其真值 —— 新建元素缺它属预期,勿编造值硬闯:改用不含该字段的增量形态,或由集成方将其设为可选`
      : ''
    if (schemaErrorMode === 'schema_invalid') {
      return toolError({ code: 'SCHEMA_INVALID', message: `patches 应用后局部校验失败 @ "${jp}",未写入`, hint: '确认该路径的值符合 schema;兄弟节点的既有数据不影响本次写入' + protHint, details: formatZodIssues(issues) })
    }
    if (!protHint) return zodError(jp, issues)
    // zod 分支带保护提示:重新组 hint(原 zodError 固定文案 + 死锁逃生门)
    return toolError({
      code: 'SCHEMA_INVALID',
      path: jp,
      message: `值不符合 "${jp}" 的 schema(${issues.length} 处问题)`,
      hint: `用 read({jsonPath:"${jp}"}) 查看当前值,按 describe_data() 查看主数据 schema,修正后重试;改大对象优先用 write 的 patch 增量(只发改动部分)${protHint}`,
      details: formatZodIssues(issues),
    })
  }
  const stripError = (stripped: string[]): string =>
    toolError({ code: 'SCHEMA_STRIP', message: `字段 ${stripped.join(', ')} 不在 schema 声明内,写入被拒绝(防静默丢失)`, hint: '该数据结构不支持这些字段;请只用 schema 声明的字段,或在 data.schema 中声明后重试', path: stripped[0], details: { stripped } })
  const writeBacks: LocalWriteBack[] = []
  if (schemaHasRefinement(schema)) notices.push('根级 refine/superRefine 不再在 write 时执行(走 capabilities.verify)')
  let appendIdx = 0
  let moveIdx = 0
  for (const p of patches) {
    const op: EditOp = p.op ?? 'set'
    const jp = p.jsonPath || ''
    if (op === 'remove') {
      // remove:只校验父容器结构性约束(数组 min length);无约束 → 直接过(不做全量校验,防株连)
      const dot = jp.lastIndexOf('.')
      if (dot > 0 && /^\d+$/.test(jp.slice(dot + 1))) {
        const parentPath = jp.slice(0, dot)
        const pres = resolveSchemaPath(schema, parentPath)
        if (pres.kind === 'schemas') {
          const finalParent = getByPath(clone, parentPath)
          if (Array.isArray(finalParent)) {
            for (const cand of pres.schemas) {
              const min = arrayMinLength(cand)
              if (min !== null && finalParent.length < min) {
                return { ok: false, error: mkError(parentPath, [{ path: [parentPath], code: 'too_small', message: `删除后数组长度 ${finalParent.length} 低于 schema 最小约束 ${min}`, expected: `>=${min}` }]), writeBacks: [], notices }
              }
            }
          }
        }
      }
      writeBacks.push({ op: 'remove', jp })
      continue
    }
    if (op === 'move') {
      // move:元素本身是既有数据(无 strip 风险),只校验它满足目标容器的元素 schema(跨容器类型安全)
      const cap = moveCaptures[moveIdx++]
      if (cap && cap.elem !== undefined) {
        // 目标容器:toPath 末段为数字下标 → 取其父;否则 toPath 即数组本身
        const dDot = cap.toPath.lastIndexOf('.')
        const destPath = dDot > 0 && /^\d+$/.test(cap.toPath.slice(dDot + 1)) ? cap.toPath.slice(0, dDot) : cap.toPath
        const dres = resolveSchemaPath(schema, destPath)
        if (dres.kind === 'schemas') {
          const elemSchemas = elementSchemaCandidates(dres.schemas)
          if (elemSchemas.length) {
            const allIssues: unknown[] = []
            let passed = false
            for (const es of elemSchemas) {
              const r = es.safeParse(cap.elem)
              if (r.success) { passed = true; break }
              allIssues.push(...(r.error?.issues ?? []))
            }
            if (!passed) return { ok: false, error: mkError(cap.toPath, allIssues), writeBacks: [], notices }
          }
        }
        // open / missing(目标为 schema 未声明的开放结构)→ 放行(元素是既有数据,无 strip 面)
        else if (dres.kind === 'open') notices.push(`${destPath}=开放节点放行`)
      }
      writeBacks.push({ op: 'move', jp, toPath: String(p.value) })
      continue
    }
    if (op === 'append') {
      // append:只校验新增元素(逐个对元素 schema,any-option-accepts);既有兄弟元素不过堂(防株连复刻)
      const cap = appendCaptures[appendIdx++]
      const elems = cap?.elems ?? []
      // 字符串目标(chunked-code-write:大 code 分块拼接)→ 片段 = 局部 parse 结果(cap.elems[0]),
      // 校验「拼接后终值」(终值才是落盘形态;裸片段可能过不了 enum 等约束)+ appendStr 写回计划
      const liveCur = getByPath(bindRef, jp)
      if (typeof liveCur === 'string' && typeof elems[0] === 'string') {
        const chunk = elems[0] as string
        const tresS = resolveSchemaPath(schema, jp)
        if (tresS.kind === 'missing') return { ok: false, error: stripError([jp]), writeBacks: [], notices }
        const finalStr = liveCur + chunk
        if (tresS.kind !== 'open') {
          const bad = tresS.schemas.map((sc) => sc.safeParse(finalStr)).find((r) => !r.success)
          if (bad) return { ok: false, error: mkError(jp, bad.error?.issues ?? []), writeBacks: [], notices }
        }
        writeBacks.push({ op: 'appendStr', jp, str: chunk })
        continue
      }
      if (!elems.length) { writeBacks.push({ op: 'appendElems', jp, elems: [] }); continue }
      const tres = resolveSchemaPath(schema, jp)
      if (tres.kind === 'missing') {
        return { ok: false, error: stripError([jp || '(根)']), writeBacks: [], notices }
      }
      if (tres.kind === 'open') {
        notices.push(`${jp || '(根)'}=开放节点放行`)
        writeBacks.push({ op: 'appendElems', jp, elems })
        continue
      }
      const elemSchemas = elementSchemaCandidates(tres.schemas)
      if (!elemSchemas.length) {
        // 目标 schema 声明非数组但运行时是数组(schema 与数据形态脱节)→ 无法校验,放行留痕(宁漏勿错杀)
        notices.push(`${jp || '(根)'}:目标非 schema 声明数组,元素未校验放行`)
        writeBacks.push({ op: 'appendElems', jp, elems })
        continue
      }
      const parsedElems: unknown[] = []
      for (let ei = 0; ei < elems.length; ei++) {
        const allIssues: unknown[] = []
        let parsed: unknown
        let passed = false
        for (const es of elemSchemas) {
          const r = es.safeParse(elems[ei])
          if (r.success) { passed = true; parsed = r.data; break }
          allIssues.push(...(r.error?.issues ?? []))
        }
        if (!passed) return { ok: false, error: mkError(`${jp || '(根)'}[新增元素${ei}]`, allIssues), writeBacks: [], notices }
        const stripped = findStrippedKeys(undefined, elems[ei], parsed, jp ? `${jp}.${ei}` : String(ei))
        if (stripped.length) return { ok: false, error: stripError(stripped), writeBacks: [], notices }
        parsedElems.push(parsed)
      }
      writeBacks.push({ op: 'appendElems', jp, elems: parsedElems })
      continue
    }
    if (op === 'merge') {
      // merge:逐键校验目标键的**最终值**(既有内容 + 合并项;键级残留株连面已收敛到该键子树,editor 开放 props 无此面)
      let mVal = p.value
      if (typeof mVal === 'string') {
        const mp = maybeParseValue(mVal)
        if (mp.parseError) return { ok: false, error: jsonParseError(`patches merge`, mVal, mp.parseError), writeBacks: [], notices }
        mVal = mp.parsed
      }
      if (mVal === null || typeof mVal !== 'object' || Array.isArray(mVal)) {
        return { ok: false, error: toolError({ code: 'PATCH_FAILED', message: `merge 的 value 需为对象`, hint: 'merge 合并对象键;整体替换用 set' }), writeBacks: [], notices }
      }
      const entries: [string, unknown][] = []
      for (const k of Object.keys(mVal as Record<string, unknown>)) {
        if (k.startsWith('__pg')) continue
        if (UNSAFE_KEYS.has(k)) continue  // __proto__/constructor/prototype 键:跳过写回(防原型污染;旧 safeMerge 同款跳过)
        const keyPath = jp ? `${jp}.${k}` : k
        const finalVal = valueAt(keyPath)
        const vr = validateAtPath(schema, keyPath, finalVal)
        if (!vr.ok) {
          if (vr.resolution === 'missing') {
            const beforeHas = getByPath(bindRef, keyPath) !== undefined
            if (!beforeHas) return { ok: false, error: stripError([keyPath]), writeBacks: [], notices }
            entries.push([k, finalVal])  // 宿主自管字段:保留原值语义(写回最终值,不 strip)
            continue
          }
          return { ok: false, error: mkError(keyPath, vr.issues ?? []), writeBacks: [], notices }
        }
        if (vr.resolution === 'open') notices.push(`${keyPath}=开放节点放行`)
        const beforeVal = getByPath(bindRef, keyPath)
        const stripped = findStrippedKeys(beforeVal, finalVal, vr.data, keyPath)
        if (stripped.length) return { ok: false, error: stripError(stripped), writeBacks: [], notices }
        entries.push([k, vr.data])
      }
      writeBacks.push({ op: 'mergeKeys', jp, entries })
      continue
    }
    // set:校验目标路径的最终值(全量 agent 供給 → 深校验)+ 父数组稀疏空洞防御
    const afterVal = valueAt(jp)
    // 稀疏空洞防御(sec-23 语义保持):set 越界数组索引经 setByPath 产生空洞,整对象校验原可拦截;
    // 局部化后由「父数组完整性」显式检查承接(数字末段 → 父数组不得含空洞)
    const dot = jp.lastIndexOf('.')
    if (dot > 0 && /^\d+$/.test(jp.slice(dot + 1))) {
      const parentPath = jp.slice(0, dot)
      const parentArr = getByPath(clone, parentPath)
      if (Array.isArray(parentArr)) {
        for (let i = 0; i < parentArr.length; i++) {
          if (!(i in parentArr)) {
            return { ok: false, error: toolError({ code: 'PATCH_FAILED', message: `set @ "${jp}" 越界数组索引产生稀疏空洞(父数组长度 ${parentArr.length})`, hint: '数组索引须连续(≤ 当前长度);追加请用 op:"append"' }), writeBacks: [], notices }
          }
        }
      }
    }
    const vr = validateAtPath(schema, jp, afterVal)
    if (!vr.ok) {
      if (vr.resolution === 'missing') {
        const beforeHas = getByPath(bindRef, jp) !== undefined
        if (!beforeHas) return { ok: false, error: stripError([jp]), writeBacks: [], notices }
        writeBacks.push({ op: 'set', jp, value: afterVal })  // 宿主自管路径:写回原值(不 strip)
        continue
      }
      return { ok: false, error: mkError(jp, vr.issues ?? []), writeBacks: [], notices }
    }
    if (vr.resolution === 'open') notices.push(`${jp || '(根)'}=开放节点放行`)
    const beforeVal = getByPath(bindRef, jp)
    const stripped = findStrippedKeys(beforeVal, afterVal, vr.data, jp)
    if (stripped.length) return { ok: false, error: stripError(stripped), writeBacks: [], notices }
    writeBacks.push({ op: 'set', jp, value: vr.data })
  }
  return { ok: true, writeBacks, notices }
}

/**
 * 整体 set 写入纯函数:schema 校验 + 快照 + merge/替换 + audit。write(set) / draft_commit 共用(set_data 已移除)。
 * 调用方负责:maybeParseValue(前,字符串→对象)+ handleConflict(前,乐观锁)+ setBaseline(后)+ 成功/dryRun message 构造。
 * 在 bindRef 就地写(经校验,失败不写不入快照)。返回 {ok,hash,data}(dryRun 不写 hash='')或 {ok:false,error}。
 * path-scoped-validation:校验经 validateRootValueLocally(只校验 value 出现的顶层 key;缺必填不再拒)。
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
  /** 成功写入 bind 后回调(供 checkpoint 脏标记:dryRun 不触发,因 dryRun 在写入前早 return)。set_data/write(set)/draft_commit 共用此收敛点;set_data 已移除,现 write(set)/draft_commit) */
  onWrite?: () => void
  /** B __pgId 补齐回调(code-as-data-asset):成功写入后调,第二参为写前 bind 深快照(按位置回填原 __pgId 用);
   * 参数化注入,无 codeAsset 场景 no-op(快照也只在回调存在时捕获,零成本开关) */
  internalAfterWrite?: (bind: any, before: any) => void
  /** 受保护资源强制层(精确值保护);undefined 或空 → no-op(向后兼容)。dryRun 也走强制(预检即拦) */
  protectedCtx?: ProtectedCtx
  /** 写后 hash 计算入口(与基线/冲突比对同源;缺省全量 hashValue)。watch 模式传 hashBind */
  hashFn?: () => string
  /** eval_script transform(整体替换)等场景的快照标签(缺省无) */
  snapshotLabel?: string
}): { ok: true; hash: string; data: unknown; notices: string[] } | { ok: false; error: string } {
  const { bindRef, schema, allowKeys, snapshots, maxSnapshots, audit, dryRun, op = 'set', protectedCtx, snapshotLabel } = args
  let value = args.value
  // B __pgId:写前深快照(仅配 internalAfterWrite 的 codeAsset 场景捕获,零成本开关)
  const beforeBind = args.internalAfterWrite ? deepClone(bindRef) : null
  // 占位符夹带防线(subtree-summary 值防线):**enforceSet 之前**检 LLM 原始值 —— 与 patches 路径同口径
  // (团队审查 P1-1:enforceSet 会把 bind 既有受保护字段值/展开后的资源内容回填进 value,若那些内容本就含
  //  `<subtree ` 字面量(如 verbatim 保护的 SDK 文档文本),后置检查会把 LLM 从未写过的值当夹带 → 全部
  //  whole-set 写永久阻塞且无逃生门;bind 侧内容属集成方信任边界,不检)
  const leak = findPlaceholderLeak(value)
  if (leak) return { ok: false, error: placeholderLeakError(leak) }
  // 强制层(§7c F1):normalize(C1 回显 + verbatim 展开 + D1)+ freeze/verbatim 比对,先于 schema 校验
  if (protectedCtx) {
    // mergeMode = allowKeys 整体 set 的 merge 语义(根键未传 → bind 保留;受保护字段回填分支按此分路)
    const er = enforceSet({ value, ctx: protectedCtx, mergeMode: !!allowKeys })
    if (!er.ok) return { ok: false, error: er.error }
    value = er.value
  }
  // path-scoped-validation:整体 set 只校验 value 出现的顶层 key(merge 语义;缺必填不再拒 —— 契约收窄);
  // per-key strip 检测(新增未声明键照拒)+ per-key 解析值写回(strip/原型污染防线平移)
  const vr = validateRootValueLocally({ schema, allowKeys, value, bindRef })
  if (!vr.ok) return { ok: false, error: vr.error }
  const writeData = vr.assembly
  if (dryRun) return { ok: true, hash: '', data: writeData, notices: vr.notices }
  if (bindRef === null || typeof bindRef !== 'object') {
    return { ok: false, error: toolError({ code: 'LEAF_BIND', message: `主数据 bind 为原始类型(${bindRef === null ? 'null' : typeof bindRef}),无法就地替换外部持有的值引用`, hint: '主数据 bind 必须为对象/数组;叶子值请用对象包裹(如 {value:"x"})或集成方通过 sdk.setData 替换 bind' }) }
  }
  // pushSnapshot 内联(纯函数不依赖 createDataOps 闭包的 pushSnapshot)
  const before = deepClone(bindRef)
  const id = snapshots.length ? snapshots[snapshots.length - 1].id + 1 : 1
  snapshots.push({ id, ts: Date.now(), op, value: before, ...(snapshotLabel ? { label: snapshotLabel } : {}) })
  while (snapshots.length > maxSnapshots) snapshots.shift()
  if (writeData !== null && typeof writeData === 'object') {
    if (vr.wholeParsed) {
      restoreInPlace(bindRef as Record<string, unknown> | unknown[], writeData)
    } else {
      // 白名单模式(schema 是 ZodObject 子集):merge 语义,只更新 schema 声明字段,隐藏字段保留不动(防误删)
      safeMerge(bindRef as Record<string, any>, writeData)
    }
  }
  audit({ op, value: writeData, timestamp: Date.now() })
  args.onWrite?.()  // 真正写入后通知(checkpoint 脏标记;dryRun 在上方早 return 不会触发)
  args.internalAfterWrite?.(bindRef, beforeBind)  // B __pgId 补齐(成功路径,before 用于按位置回填原 id)
  commitReanchors(protectedCtx)  // freeze-move:调序重锚定落地(注册表跟随元素迁移,防后续写误报)
  return { ok: true, hash: args.hashFn ? args.hashFn() : hashValue(bindRef), data: writeData, notices: vr.notices }
}

/**
 * 增量 patch 写入纯函数(p2-refactor 子项 3 装饰器):clone + 逐 patch 校验(isUnsafePath/isPathAllowed/maybeParseValue)
 * + applyPatchToClone + **逐目标局部校验**(path-scoped-validation:validateWriteLocally,只校验写入内容,兄弟脏数据不株连)
 * + (dryRun 预检) + snapshot + 外科手术式写回(局部 parse 值按 patch 序重放)+ markDataDirty。
 * edit_data / write(edit) / eval-patches / eval-subtree 共用(edit_data 已移除,现 write(edit)/eval 共用)
 * (乐观锁×dryRun 组合的 bug 高发区,单一真相源防不一致)。
 * 调用方负责:bindRef 类型守卫(NOT_OBJECT/LEAF_BIND,错误码各异)+ audit(detail/value 差异)+ setBaseline + 成功 message。
 * 返回 {ok,applied,clone,notices}(dryRun 返回 clone 供预览,不落盘/不入快照) 或 {ok:false,error}。
 */
export function applyPatchesToBind(args: {
  bindRef: unknown
  patches: { op?: EditOp; jsonPath?: string; value?: unknown }[]
  schema: ZodType
  allowKeys: string[] | null
  snapshots: DataSnapshotEntry[]
  maxSnapshots: number
  markDataDirty?: () => void
  /** schema 校验失败错误模式:'zod'(zodError,edit_data/write 用) / 'schema_invalid'(toolError + details,eval 用);默认 'zod'(edit_data 已移除,现 write 用 'zod') */
  schemaErrorMode?: 'zod' | 'schema_invalid'
  /** snapshot label(eval_transform_subtree / eval_transform;默认无) */
  snapshotLabel?: string
  /** dryRun:预检走完整校验链但不落盘/不入快照/不 applyLive,返回 clone 供预览 */
  dryRun?: boolean
  /** B __pgId 补齐回调(code-as-data-asset):成功写入后调,before = 写前深快照(按位置回填原 __pgId 用);与 commitSetToBind 同模式。
   *  ⚠️ before 为只读契约:codeAsset 模式下 applyPatchesToBind 将同一对象复用为快照栈条目(别名共享),mutate before 会污染快照 */
  internalAfterWrite?: (bind: any, before: any) => void
  /** 受保护资源强制层;undefined 或空 → no-op。在 patch 应用后、schema 校验前调用 */
  protectedCtx?: ProtectedCtx
}): { ok: true; applied: { op: EditOp; jp: string; value: unknown }[]; clone: unknown; notices: string[] } | { ok: false; error: string } {
  const { bindRef, patches, schema, allowKeys, snapshots, maxSnapshots, markDataDirty, schemaErrorMode = 'zod', snapshotLabel, dryRun, protectedCtx } = args
  const beforeBind = args.internalAfterWrite ? deepClone(bindRef) : null  // B __pgId 写前快照
  const clone = deepClone(bindRef)
  const applied: { op: EditOp; jp: string; value: unknown }[] = []
  // path-scoped-validation:append 追加元素 / move 移动元素的引用捕获(校验「新增/移动内容」用;
  // 引用在 clone 内,后续 patch 若继续改这些对象,校验时取到的即最终态)
  const appendCaptures: { jp: string; elems: unknown[] }[] = []
  const moveCaptures: { jp: string; toPath: string; elem: unknown }[] = []
  // 逐 patch 应用后目标路径快照(set/merge 校验取值兜底:同批后续 remove/位移使旧 jsonPath 在最终 clone 上
  // 取不到值时回退用;浅捕获按需 —— 仅记录路径与该刻值,校验只读不 mutate)
  const patchSnapshots: { jp: string; val: unknown }[] = []
  const snapshotAfter = (op: EditOp, jp: string) => {
    if (op === 'set' || op === 'merge') patchSnapshots.push({ jp, val: getByPath(clone, jp) })
  }
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i]
    const jp = p.jsonPath || ''
    if (isUnsafePath(jp)) return { ok: false, error: toolError({ code: 'PATH_UNSAFE', message: `patches[${i}] jsonPath "${jp}" 含非法段`, hint: '使用正常属性路径,如 components.0.text' }) }
    if (!isPathAllowed(jp, schema, allowKeys)) return { ok: false, error: toolError({ code: 'PATH_DENIED', message: `patches[${i}] @ "${jp}" 不在 schema 声明字段内`, hint: `仅 schema 声明的 key 可写${keysHintSuffix(declaredKeysAt(schema, parentPathOf(jp)))}` }) }
    const op: EditOp = p.op ?? 'set'
    let pVal: unknown
    if (op !== 'remove') {
      // value 缺失才拒;空字符串 '' 是合法数据值(editor 实测:script/文案清空写 ''曾被误判 MISSING_VALUE,
      // 且 hint 引导去用 remove —— 但 remove 是删键,与「置空字符串」语义不同,误导)。move 的 value 是目标路径,''仍拒
      if (p.value === undefined || (p.value === '' && op === 'move')) return { ok: false, error: toolError({ code: 'MISSING_VALUE', message: `patches[${i}] ${op} 操作需要 value`, hint: `op 为 ${op} 时 value 必填;删除请用 op:'remove'` }) }
      const pr = maybeParseValue(p.value)
      if (pr.parseError) return { ok: false, error: jsonParseError(`patches[${i}]`, p.value, pr.parseError) }
      pVal = pr.parsed
      // 占位符夹带防线(move 的 value 是目标路径字符串非数据,跳过)
      if (op !== 'move') {
        const leak = findPlaceholderLeak(pVal)
        if (leak) return { ok: false, error: placeholderLeakError(leak, `patches[${i}] @ "${jp}"`) }
      }
      // move 的 value 是目标路径:同样过白名单(防经 move 把元素移进 schema 未声明路径)
      if (op === 'move' && typeof pVal === 'string' && !isPathAllowed(pVal, schema, allowKeys)) {
        return { ok: false, error: toolError({ code: 'PATH_DENIED', message: `patches[${i}] move 目标 "${pVal}" 不在 schema 声明字段内`, hint: `move 的 value(目标路径)也须在 schema 声明字段内${keysHintSuffix(declaredKeysAt(schema, parentPathOf(String(pVal))))}` }) }
      }
    }
    if (op === 'append') appendCaptures.push({ jp, elems: Array.isArray(pVal) ? [...(pVal as unknown[])] : [pVal] })
    if (op === 'move') moveCaptures.push({ jp, toPath: String(pVal), elem: getByPath(clone, jp) })
    const patchErr = applyPatchToClone(clone, op, jp, pVal)
    if (patchErr) return { ok: false, error: toolError({ code: 'PATCH_FAILED', message: `patches[${i}]: ${patchErr}`, hint: '检查 op 与目标类型:merge 需对象,append 需数组或字符串' }) }
    snapshotAfter(op, jp)
    applied.push({ op, jp, value: pVal })
  }
  // 强制层(§7c F1):逐 patch C3 remove 检查 + normalizeAndCheck 比对(clone vs bind),先于 schema 校验
  if (protectedCtx) {
    const er = enforcePatches({ patches, clone, ctx: protectedCtx })
    if (!er.ok) return { ok: false, error: er.error }
  }
  // path-scoped-validation:全部 apply 后按最终态逐目标局部校验(替代整对象 safeParse)——
  // 只校验 agent 写入的内容(set 目标值/merge 键终值/append 新元素/move 元素),兄弟脏数据不再株连(script:"" 事故根因);
  // strip/原型污染防线平移到 per-path(写回值 = 局部 parse 结果,未声明嵌套键不落 bind,fix-write-safety-bypass P0-1);
  // 任一目标失败 → 整批不写(原子语义不变)。稀疏空洞防御(sec-23)由 set 目标的父数组完整性检查承接。
  // 受保护字段名集(frozen-required-hint):resourcesByPath 叶段名,供缺必填交叉提示
  const protectedFieldNames = protectedCtx
    ? new Set([...protectedCtx.resourcesByPath.keys()].map((k) => k.split('.').pop()!).filter(Boolean))
    : undefined
  const plan = validateWriteLocally({ schema, bindRef, clone, patches, schemaErrorMode, appendCaptures, moveCaptures, valueAt: (jp) => patchSnapshots.find((s) => s.jp === jp)?.val, ...(protectedFieldNames ? { protectedFieldNames } : {}) })
  if (!plan.ok) return { ok: false, error: plan.error! }
  if (dryRun) return { ok: true, applied, clone, notices: plan.notices }
  // pushSnapshot(内联,与 commitSetToBind 一致:记录改前 bindRef)+ 写回 bind + markDataDirty
  // write-path-cost-reduction B 段:codeAsset 模式(beforeBind 已深拷贝改前态)直接复用为快照值,省一次全量深拷贝;
  // 此刻 bindRef 仍是改前态(写回在 push 之后),两者等价。快照条目按不可变值对待(restore 消费方防御性深拷贝)。
  const id = snapshots.length ? snapshots[snapshots.length - 1].id + 1 : 1
  snapshots.push({ id, ts: Date.now(), op: 'edit', value: beforeBind ?? deepClone(bindRef), ...(snapshotLabel ? { label: snapshotLabel } : {}) })
  while (snapshots.length > maxSnapshots) snapshots.shift()
  // 外科手术式写回(path-scoped-validation):按 patch 原序把「局部 parse 后的值」重放到 live bind ——
  // 只动写目标路径,未触达子树原样保留(旧实现整对象 res.data 整体 merge 会把全树 strip 一遍,未触达组件的
  // 未声明字段如 __pgNotes 会被剥;per-path 写回天然保住)。remove 显式 deleteByPath(merge 不删 key 语义)。
  for (const wb of plan.writeBacks) {
    if (wb.op === 'remove') {
      deleteByPath(bindRef, wb.jp)
    } else if (wb.op === 'set') {
      setByPath(bindRef, wb.jp, wb.value)
    } else if (wb.op === 'move') {
      moveByPath(bindRef, wb.jp, wb.toPath)  // live 兜底:clone 路径已校验过,失败静默(与 applyPatchToLive 同语义)
    } else if (wb.op === 'mergeKeys') {
      const target = wb.jp ? getByPath(bindRef, wb.jp) : bindRef
      if (target && typeof target === 'object' && !Array.isArray(target)) {
        for (const [k, v] of wb.entries ?? []) (target as Record<string, unknown>)[k] = v
      }
    } else if (wb.op === 'appendElems') {
      const arr = wb.jp ? getByPath(bindRef, wb.jp) : bindRef
      if (Array.isArray(arr) && wb.elems?.length) arr.push(...(wb.elems as unknown[]))
    } else if (wb.op === 'appendStr') {
      // chunked-code-write:字符串片段尾接到 live(目标类型已在校验计划确认 string)
      const cur = wb.jp ? getByPath(bindRef, wb.jp) : bindRef
      if (typeof cur === 'string' && typeof wb.str === 'string') setByPath(bindRef as object, wb.jp, cur + wb.str)
    }
  }
  args.internalAfterWrite?.(bindRef, beforeBind)  // B __pgId 补齐(成功路径,before 用于按位置回填原 id)
  commitReanchors(protectedCtx)  // freeze-move:调序重锚定落地(注册表跟随元素迁移,防后续写误报)
  markDataDirty?.()
  return { ok: true, applied, clone, notices: plan.notices }
}

/**
 * 写入值占位符夹带检测(subtree-summary 值防线):read/query 摘要产生的占位字符串若被 LLM 原样写回,
 * 会以脏文本形态进 bind(schema 若放行)。两条匹配规则刻意收窄防误伤:
 * ① `<subtree ` 子串 —— SDK 专属词,正常业务值不含;② `<name SIZE>` **整串**匹配(标记字段占位如 `<code 2.3KB>`;
 * 整串才拦 —— HTML 混合内容里 `<div 3KB>` 之类子串不命中)。受保护资源句柄 `⟦frozen:…⟧`/`⟦res:…⟧` 前缀不同
 * 且是 verbatim 回传的合法流,零重叠不在此列。返回首个命中的样例串(供错误消息定位),未命中返回 null。
 */
export function findPlaceholderLeak(v: unknown): string | null {
  // 整串 = 标记字段占位形态:<字段名 空白 体积串>;<subtree 恒子串拦,不必整串
  const MARKER_RE = /^<[A-Za-z_][\w.-]*\s[\d.]+[KMG]?B>$/
  const walk = (node: unknown): string | null => {
    if (typeof node === 'string') {
      if (node.includes('<subtree ')) return node.slice(0, 60)
      if (MARKER_RE.test(node)) return node.slice(0, 60)
      return null
    }
    if (Array.isArray(node)) { for (const x of node) { const hit = walk(x); if (hit) return hit } return null }
    if (node && typeof node === 'object') {
      for (const val of Object.values(node)) { const hit = walk(val); if (hit) return hit }
    }
    return null
  }
  return walk(v)
}

/** 占位夹带统一错误(值防线;path 为定位用可空) */
const placeholderLeakError = (sample: string, jp?: string): string =>
  toolError({
    code: 'PLACEHOLDER_LEAK', path: jp || undefined,
    message: `写入值包含摘要占位符 "${sample}"(read/query 为省上下文返回的体积占位,非真实数据),已拒绝写入`,
    hint: `占位符子树的真实内容需先窄读获取:read({jsonPath:"<该子树路径>"}) 结果根豁免返回全文;聚焦该区域可用 set_focus。基于真实值重新构造写入内容`,
  })

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
 * 子树体积摘要阈值(字符估算,≈3KB;经验初值,Phase 1 真 LLM 反校准 —— 门禁数据裁决只升阈值,机制不回退)。
 * 主 scope 下「有效序列化体积 ≥ 阈值」的 object/array 子树降为 `<subtree NKB keys:[…]/children:N #指纹>` 占位。
 * 零配置:不进 DataOpsOptions(校准走常量调整,不暴露集成面)。
 */
export const SUBTREE_SUMMARY_THRESHOLD = 3072

/** 摘要器泛化选项(subtree-summary Phase 0) */
export interface SubtreeSummarizeOptions {
  /** 结果根豁免:true 时结果根自身不摘要(read 单/多路径窄读通道 —— 不豁免即黑洞且分页静默失效);query 命中值不豁免(占位+path 正是检索形态) */
  rootExempt?: boolean
  /** 结果根的绝对路径(read jsonPath;豁免前缀按绝对路径匹配,'' = 整体读) */
  rootPath?: string
  /** 任意深度豁免前缀(绝对路径;聚焦态全文通道 __pgFullTextPaths:焦点子树内(含嵌套大子树)读全文) */
  fullTextPrefixes?: string[]
  /** 占位产出回调(子树/标记两类占位的绝对路径;subtree-summary Phase 1:read-before-write 守卫判定基础) */
  onSummarized?: (absPath: string) => void
}

/** 叶子/标量的序列化体积估算(字符口径;O(1),不 stringify) */
function estLeafSize(v: unknown): number {
  if (typeof v === 'string') return v.length + 2
  if (typeof v === 'number' || typeof v === 'boolean') return 8
  return 4 // null/undefined
}

/**
 * read 大文本/大子树摘要(subtree-summary 泛化;**仅主 scope**,isMain=false 子 scope 原样返回 —— 子 agent 改 code 需全文):
 * - **标记字段形态(兼容既有)**:specs 命中的 string 叶子 ≥ marker threshold → `<field Nkb>`(短 code 原样保信息;集成商业务长文本不在标记集不受此形态影响)
 * - **体积形态(泛化新增)**:自底向上聚合有效序列化体积,O(n) 估算不逐节点 stringify;子树 ≥ `SUBTREE_SUMMARY_THRESHOLD` → `<subtree NKB keys:[k1,k2,…] #指纹>`(数组记 children:N)。
 *   内层优先:孩子先判(小兄弟节点保持可见),父按「孩子已占位后的有效体积」再判(500 小元素数组整树摘要、4KB style 内层单独摘要互不干扰)。
 * - **豁免**(`#` 前缀指纹,**禁用 `hash=` 字面量** —— workingMemory 从 read 结果捕获 `hash=` 会污染 lastHashes):前缀命中的子树(含内部)原样保留,
 *   且其有效体积按占位计(父不因全文孩子被连带摘要);rootExempt 时结果根不摘要(窄读通道)。
 * - 键名取**投影后**的值(调用点在投影/占位符替换之后,天然满足);小标量(叶子)永不单独摘要。深拷贝后改,bind 原值不动。纯函数,可单测。
 */
export function summarizeLargeText<T>(val: T, isMain: boolean, specs: LargeTextSpec[], threshold: number, sub?: SubtreeSummarizeOptions): T {
  if (!isMain || val == null) return val
  const fieldSet = new Set(specs.map((s) => s.field))
  const markerThreshold = threshold
  const subtreeThreshold = SUBTREE_SUMMARY_THRESHOLD
  const rootExempt = sub?.rootExempt ?? false
  const rootPath = sub?.rootPath ?? ''
  const prefixes = sub?.fullTextPrefixes ?? []
  const out = deepClone(val) as any
  const PLACEHOLDER_EFF = 40
  const note = sub?.onSummarized  // 占位路径上报(守卫判定基础;豁免前缀内的不报 —— 全文已见)
  const isExempt = (absPath: string): boolean =>
    prefixes.some((pfx) => pfx && (absPath === pfx || absPath.startsWith(pfx + '.') || absPath.startsWith(pfx + '[')))
  const placeholderOf = (node: unknown, eff: number): string => {
    // `#` 前缀指纹:仅供 LLM 比对内容新旧(改后重读指纹变);不接乐观锁(锁 hash 是整 bind 域)/不接 stale-read(纯路径重叠)
    const fp = '#' + String(hashValue(node)).slice(0, 8)
    if (Array.isArray(node)) return `<subtree ${formatBytes(eff)} children:${node.length} ${fp}>`
    const keys = Object.keys(node as Record<string, unknown>)
    const shown = keys.slice(0, 6).join(',') + (keys.length > 6 ? ',…' : '')
    return `<subtree ${formatBytes(eff)} keys:[${shown}] ${fp}>`
  }
  /** 自底向上:返回 {替换后的 node, 有效体积};父按孩子有效体积决定自身摘要(内层优先) */
  const walk = (node: any, absPath: string, isRoot: boolean): { node: unknown; eff: number } => {
    if (node == null || typeof node !== 'object') return { node, eff: estLeafSize(node) }
    if (isExempt(absPath)) return { node, eff: PLACEHOLDER_EFF }  // 豁免区:原样保留;有效体积按占位计(父不因全文孩子被摘要)
    if (Array.isArray(node)) {
      let eff = 2
      for (let i = 0; i < node.length; i++) {
        const r = walk(node[i], `${absPath}.${i}`, false)
        node[i] = r.node
        eff += r.eff
      }
      if (!(isRoot && rootExempt) && eff >= subtreeThreshold) {
        note?.(absPath)
        return { node: placeholderOf(node, eff), eff: PLACEHOLDER_EFF }
      }
      return { node, eff }
    }
    let eff = 2
    for (const k of Object.keys(node)) {
      const v = node[k]
      const childPath = absPath ? `${absPath}.${k}` : k
      if (typeof v === 'string' && fieldSet.has(k) && v.length >= markerThreshold && !isExempt(childPath)) {
        node[k] = `<${k} ${formatBytes(v.length)}>`   // 标记字段兼容形态(code-as-data-asset;豁免前缀内不摘要 —— 聚焦态全文)
        note?.(childPath)
        eff += node[k].length + k.length + 2
      } else {
        const r = walk(v, childPath, false)
        node[k] = r.node
        eff += r.eff + k.length + 2
      }
    }
    if (!(isRoot && rootExempt) && eff >= subtreeThreshold) {
      note?.(absPath)
      return { node: placeholderOf(node, eff), eff: PLACEHOLDER_EFF }
    }
    return { node, eff }
  }
  const res = walk(out, rootPath, true)
  return res.node as T
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
  // 沙箱执行器(P1#3 测试缝:缺省 Worker 实现,自测可注入 in-process 执行器)
  const runScript = opts.sandboxRunner ?? runSandboxedScript
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
    ? {
        resourcesByPath, resourceStore, getBind: () => bindRef,
        // freeze-move 调序重锚定暂存(normalizeAndCheck 写入,commitReanchors 于写成功后消费)
        pendingReanchors: [],
        // frozen-required-hint:保护字段是否 schema 必填(best-effort:父级 schema 是对象形态才判,union/开放不猜 → false 不提示)
        isFieldRequired: (path: string): boolean => {
          const segs = path.split('.')
          const leaf = segs[segs.length - 1]
          const sub = segs.length > 1 ? getSchemaAtPath(schema, segs.slice(0, -1).join('.')) : schema
          const f = (sub as { shape?: Record<string, { isOptional?: () => boolean }> } | undefined)?.shape?.[leaf]
          return !!f && typeof f.isOptional === 'function' && !f.isOptional()
        },
      }
    : undefined

  const snapshots: DataSnapshotEntry[] = []
  const maxSnapshots = opts.maxSnapshots ?? 20
  // 并发工具(maxParallelTools>1)下 autoLock 为"整体快照语义":多个 read 并发写基线(完成顺序不定),
  // 后续 write 比对"最后完成的 read 的整体 bind hash";跨工具的"哪个 read 的 hash 被用"不可重现,
  // 需精确乐观锁时 LLM 应显式传 expectedHash(取自它自己那次 read 的返回值)。
  // ✅ 并发写互锁已修(write-conflict-final-hash C 形态,2026-08-25):`maxParallelTools>1 && lockOn` 时
  //    闭包级 async mutex 串行化全部写工具的 [取 effHash → handleConflict → commit → setBaseline] 段 ——
  //    后写在锁内取到前写刷新后的基线,同子树双写变「与串行等价的叠加」而非静默覆盖;
  //    ask 挂起经 handleConflict 拆段放锁(防饥饿),裁决恢复点补一次新鲜度校验(单发,不二次挂起)。
  // per-scope 基线(fix-main-sub-isolation P1-13):主×子 agent 共享本闭包,基线按 caller scope 隔离 ——
  //   子 agent 委派期间 enterDataScope 切 activeScope,子 read/write 只动子 scope 基线,主基线不被污染
  //   (修原:子 read 刷新共享 lastReadHash → 父过期写静默放行覆盖外部修改)。MAIN_SCOPE('')= 主。
  //   互锁是单锁 bind 域(非 per-scope):主×子共享 bindRef,跨 scope 写本就不真正并发,单锁零代价。
  const MAIN_SCOPE = ''
  const baselines = new Map<string, string>()  // scopeId → 该 caller 最后 read/写后的整体 bind hash
  let activeScope: string = MAIN_SCOPE
  // CA 并发修复(per-call scope token):工具 fns 第二参 config 的 configurable.__pgDataScope 优先
  // (wrapWithScope 经 RunnableConfig 注入,并发交错各读各的 scope),ambient activeScope 降为兜底(无 config 旧路径)
  const scopeOf = (config?: unknown): string =>
    ((config as { configurable?: Record<string, unknown> } | undefined)?.configurable?.__pgDataScope as string | undefined) ?? activeScope
  // subtree-summary 聚焦全文通道:focus 中间件 wrapToolCall 经 ctx.callConfig → coreExecTool 透传的任意深度豁免前缀
  // (同 __pgDataScope 通道先例;焦点子树内(含嵌套大子树)读全文,范围外读不受影响)
  const fullTextPrefixesOf = (config?: unknown): string[] | undefined => {
    const v = (config as { configurable?: Record<string, unknown> } | undefined)?.configurable?.__pgFullTextPaths
    return Array.isArray(v) ? v.map(String) : undefined
  }
  // subtree-summary Phase 1 占位路径集(invoke 级;守卫 beforeAgent 清空):主 scope read/query 产出的
  // <subtree>/<field Nkb> 占位绝对路径 —— 写路径落入且无窄读记录 = 凭印象写,守卫拦下引导窄读
  const summarizedPaths = new Set<string>()
  const noteSummarized = (p: string): void => {
    summarizedPaths.add(p)
    while (summarizedPaths.size > 500) summarizedPaths.delete(summarizedPaths.values().next().value as string)  // FIFO 防无界
  }
  const getBaseline = (scope?: string): string | undefined => baselines.get(scope ?? activeScope)
  const setBaseline = (h: string | undefined, scope?: string): void => { const s = scope ?? activeScope; if (h === undefined) baselines.delete(s); else baselines.set(s, h) }
  // 冲突检测 opt-in(3.32 翻转,autoLock 已废弃):conflictWatchFields 为唯一旋钮 ——
  // 未声明/空 = 不开自动检测(conflictWatchFields 为是否校验的唯一依据);
  // ['*'] = 全字段检测(旧 autoLock 行为);普通名单 = 白名单监听(watchFieldsHash 位置不敏感)。
  // ⚠️ 全部乐观锁 hash 必须走 hashBind 单一入口:read 返回 hash 与冲突 curHash 同源
  const watchList = opts.conflictWatchFields ?? []
  const watchAll = watchList.includes('*')
  const watchKeys: ReadonlySet<string> | undefined = !watchAll && watchList.length ? new Set(watchList) : undefined
  const lockOn = watchList.length > 0
  const hashBind = (): string => (watchKeys ? watchFieldsHash(bindRef, watchKeys) : hashValue(bindRef))
  // ===== 并发写互锁(write-conflict-final-hash C 形态,2026-08-25)=====
  // 闭包级 async mutex,单锁 bind 域(非 per-scope:主×子共享闭包与 bindRef,跨 scope 写本就不真正并发)。
  // 装配条件 maxParallelTools>1 && lockOn 相与:串行模式直通 no-op 零行为变化;未武装(lockOn=false)也直通
  // —— conflictWatchFields 是「是否校验」的唯一旋钮,不越权给未武装并行的「后写覆盖」(既有明文语义)加冲突。
  // 手动 handle 形态(非包装式):ask 挂起需中途放锁再重取(见 handleConflict 拆段),包装式做不到。
  const useWriteMutex = (opts.maxParallelTools ?? 1) > 1 && lockOn
  let writeMutexHeld = false
  let writeMutexWaiters: (() => void)[] = []
  interface WriteMutexHandle {
    /** 释放(幂等;ask 拆段放锁后 caller finally 再调为 no-op) */
    release(): void
    /** ask 裁决后重取锁:重新武装本 handle(finally 的 release 再次生效);他人持锁时排队等待 */
    reacquire(): Promise<void>
  }
  async function acquireWriteMutex(): Promise<WriteMutexHandle> {
    if (!useWriteMutex) return { release: () => {}, reacquire: async () => {} }  // 直通:串行/未武装零变化
    if (writeMutexHeld) await new Promise<void>((r) => writeMutexWaiters.push(r))
    else writeMutexHeld = true
    // 走到这里 = 本 handle 持有锁(waiter 路径所有权由前任 release 直接移交,writeMutexHeld 恒 true 防插队双持)
    let armed = true
    return {
      release: () => {
        if (!armed) return
        armed = false
        const next = writeMutexWaiters.shift()
        if (next) next()  // 所有权直接移交:writeMutexHeld 保持 true
        else writeMutexHeld = false
      },
      reacquire: async () => {
        if (armed) return
        if (writeMutexHeld) await new Promise<void>((r) => writeMutexWaiters.push(r))
        else writeMutexHeld = true
        armed = true
      },
    }
  }
  if ((opts.maxParallelTools ?? 1) > 1 && !lockOn) {
    console.warn('[page-agent-sdk] maxParallelTools>1 且未声明 conflictWatchFields:并发写不互锁(后写覆盖前写,既有明文语义);声明 conflictWatchFields 后自动启用写互锁与乐观锁校验')
  }
  // write-path-cost-reduction A 段:写成功后单次计算新基线并返回 —— 结果消息的「新 hash」复用返回值,
  // 勿在同调用内二次 hashValue(1MB bind 全量 hash 实测 ~10ms,同值双算纯浪费;bench 见 change design §5)
  const commitBaseline = (scope?: string): string => { const h = hashBind(); setBaseline(h, scope); return h }
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
    recomputeBaseline: (scope) => { baselines.set(scope ?? MAIN_SCOPE, hashBind()) },
    // baseline-guard:非 dataOps 工具改 bind 后全 scope 基线一次刷新(bind 共享,一次 hash 更新全部)
    recomputeAllBaselines: () => { const h = hashBind(); for (const k of baselines.keys()) baselines.set(k, h) },
    hasBaselines: () => baselines.size > 0,
    getSummarizedPaths: () => [...summarizedPaths],
    clearSummarizedPaths: () => summarizedPaths.clear(),
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
      setBaseline(hashBind(), MAIN_SCOPE)  // H2 基线刷新对齐工具版 rupdate(write-conflict 顺手修:同一操作两条路曾不对称,公共 API 改后防下次 write 误 VERSION_CONFLICT)
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

  // ⚠️ 不变量(write-path-cost-reduction C 段固化):下方 curHash = hashBind() 必须每次实时计算,
  // 禁止任何跨调用缓存(脏标记/版本号/memo 均否)—— 人工/宿主直改 reactive bind 不经任何 SDK 写路径,
  // SDK 侧脏标记感知不到(M4 真实场景:委派在途人工直改 code);缓存 hash 陈旧 → 比对陈旧对陈旧 →
  // 人工修改被静默覆盖(keep_external 保护全线失效)。性能收敛只做同调用消重(commitBaseline),不做跨调用缓存。
  async function handleConflict(
    op: 'set' | 'edit' | 'delete',
    expectedHash: string | undefined,
    agentValue?: unknown,
    /** ask 拆段(write-conflict C 形态):互锁模式下挂起前放锁/裁决后重取;串行模式为 no-op handle(校验仍生效) */
    lock?: WriteMutexHandle,
  ): Promise<string | null> {
    if (!expectedHash || expectedHash === '') return null
    const curHash = hashBind()
    if (curHash === expectedHash) return null
    if (!opts.onConflict) {
      return toolError({
        code: 'VERSION_CONFLICT',
        message: `乐观锁冲突:expectedHash=${expectedHash} 但当前 hash=${curHash}。主数据在你 read 之后已被修改(外部代码/其他 agent/用户手动改)。`,
        hint: `重新 read 拿最新值与 hash,基于最新值修改后再写入。当前值:${safeStringify(bindRef, 400)}`,
      })
    }
    // ask 拆段(R1 防饥饿):放锁后再等人工/策略裁决 —— 挂起期间兄弟写不被人工等待阻塞(S3 照常落地刷基线);
    // 直通模式(串行/未武装)release 为 no-op,但下方恢复点校验仍生效(串行 ask 窗口的宿主直改同在防线面)
    lock?.release()
    const resolution = await opts.onConflict({
      op, agentValue, currentValue: bindRef, currentHash: curHash, expectedHash, snapshotId: 0,
    })
    if (resolution.action === 'keep_external') {
      // 不重取锁:caller 收非 null 直接返回不 commit,finally release 幂等 no-op
      return `已保留外部修改(未写入)。当前值:${safeStringify(bindRef, 400)} (hash=${curHash})。请重新 read 拿最新值与 hash 再改。`
    }
    if (resolution.action === 'restore') {
      await lock?.reacquire()
      if (!snapshots.length) return `无历史快照可回退(本次为首次操作)。当前值:${safeStringify(bindRef, 400)} (hash=${curHash})。请重新 read 再改或选「强制覆盖」。`
      const entry = snapshots[snapshots.length - 1]
      restoreLive(bindRef, deepClone(entry.value))
      markDataDirty()
      setBaseline(hashBind())  // 顺手修(深审缺口):restore 裁决改了 bind,基线同步刷新,防紧后写连环误冲突
      return `已回退主数据到历史快照 #${entry.id}[${entry.op}]。当前值:${safeStringify(bindRef, 400)} (hash=${hashBind()})。请基于回退后的值重写或停止。`
    }
    // overwrite(自动 policy 或人工裁决):重取锁 + 恢复点新鲜度校验(锚 = 裁决者所见 hash,非 effHash ——
    // 冲突本身即 bind≠effHash,对 effHash 校验会把每次 overwrite 裁决都打回,机制自我否决)
    await lock?.reacquire()
    const nowHash = hashBind()
    if (nowHash !== curHash) {
      // observable 留痕(C 形态任务 6):恢复点校验命中进 audit(onAudit 消费方/诊断可见;tool_result 回灌同源)
      audit({ op: 'conflict_recheck', detail: `裁决基于 ${curHash} 恢复时 ${nowHash}(ask 窗口新修改落地,overwrite 被拦)`, timestamp: Date.now() })
      return toolError({
        code: 'VERSION_CONFLICT',
        message: `裁决恢复点校验失败:裁决基于 hash=${curHash},恢复时主数据已变为 hash=${nowHash}(裁决等待期间又有新修改落地,裁决者未见过)。`,
        hint: '重新 read 拿最新值与 hash,基于最新值修改后再写入(单次校验,不再二次挂起)。',
      })
    }
    setBaseline(hashBind())  // 吸收基线(设计 #4):裁决后基线对齐现实,commit 失败路径也不连环误冲突
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
      `格式: 写入值需为 JSON,且通过声明的 schema 校验(校验失败时 write 会返回结构化错误,含具体字段与期望类型)。`,
    ].join('\n'),
    { name: 'describe_data', description: '获取主数据的说明与格式要求(等价于 read 不传 jsonPath;优先用 read 单一入口)。', schema: z.object({}) },
  )

  // get_data/set_data/edit_data/delete_data 已移除(legacy-crud-dedup,4.0):read/write 全覆盖且为唯一入口
  // (uispec 实测主 agent 调用 get/set/edit_data 均 0 次;删除后数据工具面 14→10)。
  // 等价迁移:get_data({p}) → read({jsonPath:p});set_data({value}) → write({value});
  // edit_data({op,p,value}) → write({patch:{op,jsonPath:p,value}});delete_data({p}) → write({patch:{jsonPath:p},del:true})。
  // snapshot_data / list_data_snapshots 亦早前移除(simplify-toolset):被 history_data({ list: true }) 吸收;
  // 手动检查点靠 write 自动快照(write 前自动存,restore_data 可回退)。

  const restoreData = tool(
    async ({ id }, config) => {
      const scope = scopeOf(config)  // CA 并发修复:per-call scope token
      if (!snapshots.length) return toolError({ code: 'NO_SNAPSHOT', message: '无快照可回退', hint: 'write 各写意图会自动存快照;或 history_data({list:true}) 查看可用快照' })
      const entry = id !== undefined ? snapshots.find((s) => s.id === id) : snapshots[snapshots.length - 1]
      if (!entry) return toolError({ code: 'SNAPSHOT_NOT_FOUND', message: `未找到快照 #${id}`, hint: '用 history_data({list:true}) 查看可用快照序号' })
      const chk = schema.safeParse(entry.value)
      if (!chk.success) return toolError({ code: 'SNAPSHOT_SCHEMA_INVALID', message: `快照 #${entry.id} 的值不符合当前 schema,无法回退`, hint: 'schema 可能已变更;该快照已过期,选其他快照或重新设置', details: formatZodIssues(chk.error.issues) })
      restoreLive(bindRef, deepClone(entry.value))
      markDataDirty()
      audit({ op: 'restore', detail: `#${entry.id}`, timestamp: Date.now() })
      setBaseline(hashBind(), scope)
      return `已回退主数据到快照 #${entry.id}[${entry.op}]${entry.label ? `(${entry.label})` : ''}。`
    },
    {
      name: 'restore_data',
      description: '把主数据回退到某个快照(不传 id 回退最近一次)。快照列表用 history_data({list:true})。',
      schema: z.object({ id: z.number().int().optional().describe('快照序号;不传回退最近一次') }),
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
      description: '查看主数据快照(只读不回退):list:true 列时间线;传 id 看某次内容(默认最近),jsonPath 可只看子路径。对比差异用 diff_data;回退用 restore_data。',
      schema: z.object({
        id: z.number().int().optional().describe('快照序号;不传看最近一次(list:true 时忽略)'),
        jsonPath: z.string().optional().describe('只看快照的某子路径'),
        list: z.boolean().optional().describe('true 列出快照时间线(序号/操作/标签/时间/大小)'),
      }),
    },
  )

  const queryData = tool(
    async ({ expr, queries, limit }, config) => {
      const qScope = scopeOf(config)  // 大文本摘要的 isMain 语义用(主 scope 摘要 / 子 scope 全文)
      if (bindRef == null || typeof bindRef !== 'object') {
        return toolError({ code: 'NOT_OBJECT', message: `主数据不是对象/数组,无法查询(当前为 ${bindRef === undefined ? 'undefined' : typeof bindRef})`, hint: 'query 仅适用于对象/数组;叶子用 read 读' })
      }
      const queryTarget = allowKeys ? projectBySchemaDeep(bindRef, schema) : bindRef
      const qFullText = fullTextPrefixesOf(config)
      /** 单条求值(批量与单次共用同一输出形态);语法错返回 ERROR: 串由调用方分流 */
      const evalOne = (e: string): string => {
        let nodes
        try { nodes = jpEval(queryTarget, e) } catch (err) {
          return toolError({ code: 'JSONPATH_SYNTAX', message: `JSONPath 解析错误: ${(err as Error).message}`, hint: '语法子集:$ .key [n] ["key"] [*] [?(filter)] ..key ..*;filter:@.field op literal,&&/||/();对象根需先点出数组字段再过滤,如 $.components[?(@.x>1)]', details: { expr: e } })
        }
        const cap = limit ?? 50
        const sliced = nodes.slice(0, cap)
        // 大文本摘要(rv-core F2 + subtree-summary 泛化):query_data(simple 默认可用)原样回灌命中 value → codeAsset 场景大 code
        // 绕过 read 的 <code Nkb> 机制直灌主上下文;与 read 同 isMain 语义。命中值**不做结果根豁免**(占位+path 正是检索形态:
        // LLM 钉 path 窄读);聚焦态命中值按焦点前缀全文(focus __pgFullTextPaths)
        const parts = sliced.map((n) => `{"path":${JSON.stringify(n.path)},"index":${n.index === undefined ? 'null' : n.index},"value":${safeStringify(summarizeLargeText(n.value, qScope === MAIN_SCOPE, largeTextSpecs, largeTextThreshold, { rootExempt: false, rootPath: String(n.path ?? ''), fullTextPrefixes: qFullText, onSummarized: noteSummarized }))}}`)
        return `{"matched":${nodes.length},"returned":${sliced.length},"truncated":${nodes.length > cap},"results":[${parts.join(',')}]}`
      }
      // W1 批量模式(tool-surface-economy):多条件一次取回;逐条独立求值,单条失败该项标 error 不整批(容错口径同 read jsonPaths);
      // 与 expr 同传按 queries。逐条结果 = 单次输出对象体原样(matched/returned/truncated/results)+ expr/ok 外壳
      if (queries && queries.length) {
        const items = queries.map((q) => {
          const one = evalOne(q)
          return one.startsWith('ERROR:')
            ? `{"expr":${JSON.stringify(q)},"ok":false,"error":${JSON.stringify(one)}}`
            : `{"expr":${JSON.stringify(q)},"ok":true,${one.slice(1)}`
        })
        return `{"batch":true,"results":[${items.join(',')}]}`
      }
      if (expr === undefined) return toolError({ code: 'SCHEMA_INVALID', message: 'query_data 需传 expr(单条 JSONPath)或 queries(2-10 条批量),两者都没传', hint: '单表达式用 expr;多条件筛选一次取回用 queries' })
      return evalOne(expr)
    },
    {
      name: 'query_data',
      description:
        '用 JSONPath 查询主数据(只读):$ 根/.key/[n]/[*]/[?(==/!=/</<=/>/>=,&&/||)]/..key 递归。返回匹配元素 path/index/value(path 可作 write patch 的 jsonPath);大数组筛选定位用它;多条件筛选传 queries 数组一次取回。',

      schema: z.object({
        expr: z.string().optional().describe('单条 JSONPath 表达式,如 $.components[?(@.type=="card" && @.price<100)] 或 $..title(递归找所有 title)'),
        queries: z.array(z.string()).min(2).max(10).optional().describe('批量模式:2-10 条 JSONPath 一次取回(与 expr 同传按 queries);逐条独立返回,单条失败该项标 error 不整批'),
        limit: z.number().int().min(1).max(200).optional().describe('返回结果上限(批量时逐条适用),默认 50'),
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
      const res = await runScript(data, script, timeout)
      if (!res.ok) {
        const isTimeout = /超时/.test(res.error || '')
        return toolError({ code: isTimeout ? 'SCRIPT_TIMEOUT' : 'SCRIPT_ERROR', message: `脚本执行失败: ${res.error}`, hint: isTimeout ? '脚本可能有死循环或过重计算;加边界检查/分批;transform 返回完整新值勿返回巨大中间结果' : '检查脚本语法与运行时错误;入参为 data(主数据深拷贝),沙箱内禁用 fetch/XHR/WebSocket', details: { elapsedMs: res.elapsedMs, scriptLen: script.length } })
      }
      if (mode === 'transform') {
        const result = res.result
        // undefined 守卫(eval-trailing-return,2026-08-27 诊断驱动):沙箱函数体语义下无 return 的脚本返 undefined,
        // 原先落到 set 的 value=undefined 报「MISSING_VALUE: set 操作需要 value」严重误导(模型以为要传 value 参数,
        // 实际 eval_script 无此参数)。改报「脚本未 return 新值」+ 指路(沙箱侧已对无 return 脚本做表达式包裹,
        // 此处兜显式 return undefined / 多语句无 return 包裹后语法报错的对照文案)
        if (result === undefined) {
          return toolError({ code: 'SCRIPT_NO_RETURN', message: 'transform 脚本未返回新值(执行结果为 undefined)', hint: '脚本必须产出新值:以表达式结尾(如 data.slice(0,1))或显式 return(如 const out=...; return out);多语句脚本须含 return 语句', details: { scriptLen: script.length } })
        }
        // 子树 transform:返回值作为 jsonPath 子树的新值(set 到子路径 + 整体 schema 校验)
        if (jp) {
          const evalLock = await acquireWriteMutex()
          try {
            const r = applyPatchesToBind({ bindRef, patches: [{ op: 'set', jsonPath: jp, value: result }], schema, allowKeys, snapshots, maxSnapshots, markDataDirty, schemaErrorMode: 'schema_invalid', snapshotLabel: 'eval_transform_subtree', internalAfterWrite, protectedCtx })
            if (!r.ok) return r.error
            audit({ op: 'edit', detail: `eval_transform_subtree @ ${jp}`, timestamp: Date.now() })
            setBaseline(hashBind(), scope)
            return `已通过脚本 transform 子树 @ ${jp} 更新(耗时 ${res.elapsedMs}ms)。当前值: ${safeStringify(bindRef, 600)}`
          } finally {
            evalLock.release()
          }
        }
        // 增量模式:脚本返回 {patches:[{op,jsonPath,value},...]} → 按 patch 应用(避免大对象整体重传)
        const isPatches = result && typeof result === 'object' && !Array.isArray(result)
          && 'patches' in (result as any) && Array.isArray((result as any).patches)
        if (isPatches) {
          if (bindRef === null || typeof bindRef !== 'object') {
            return toolError({ code: 'LEAF_BIND', message: `主数据 bind 为原始类型(${bindRef === null ? 'null' : typeof bindRef}),eval transform(patches) 无法就地替换`, hint: '主数据 bind 必须为对象/数组;叶子值请用对象包裹或集成方通过 sdk.setData 替换 bind' })
          }
          const evalLock = await acquireWriteMutex()
          try {
            const r = applyPatchesToBind({ bindRef, patches: (result as any).patches, schema, allowKeys, snapshots, maxSnapshots, markDataDirty, schemaErrorMode: 'schema_invalid', snapshotLabel: 'eval_transform', internalAfterWrite, protectedCtx })
            if (!r.ok) return r.error
            audit({ op: 'edit', detail: `eval_transform(${r.applied.length} patches)`, timestamp: Date.now() })
            setBaseline(hashBind(), scope)
            return `已通过脚本 transform(patches) 更新主数据(${r.applied.length} 个 patch,耗时 ${res.elapsedMs}ms)。当前值: ${safeStringify(bindRef, 600)}`
          } finally {
            evalLock.release()
          }
        }
        // 整体替换模式:脚本返回完整新值 —— 走 validateRootValueLocally(path-scoped-validation:
        // 只校验出现的顶层 key,缺必填不再拒;strip/原型污染防线平移到 per-key;错误码 SCHEMA_INVALID 保持)
        let evalResult: unknown = result
        // 占位符夹带防线(独立落地路径不经 commitSetToBind,单点补):enforceSet 之前检 LLM 原始返回值
        // (口径同 commitSetToBind:bind 既有受保护内容/展开后资源内容不检,防永久误阻塞 —— 团队审查 P1-1)
        const evalLeak = findPlaceholderLeak(evalResult)
        if (evalLeak) return placeholderLeakError(evalLeak)
        // 强制层(§7c F1):eval transform 整体替换是独立落地路径(不走 commitSetToBind),单独调 enforceSet
        if (protectedCtx) {
          const er = enforceSet({ value: evalResult, ctx: protectedCtx })
          if (!er.ok) return er.error
          evalResult = er.value
        }
        if (bindRef === null || typeof bindRef !== 'object') {
          return toolError({ code: 'LEAF_BIND', message: `主数据 bind 为原始类型(${bindRef === null ? 'null' : typeof bindRef}),eval transform 无法就地替换外部持有的值引用`, hint: '主数据 bind 必须为对象/数组;叶子值请用对象包裹或集成方通过 sdk.setData 替换 bind' })
        }
        // team-audit P1#3:整体替换前捕写前快照(internalAfterWrite 回填原 __pgId 用;照 commitSetToBind :508 模式)。
        // 修前本分支零 internalAfterWrite 调用 → 脚本入参 data 经投影已剥 __pg* → 整组换掉后已有组件 id 也被 wipe,
        // vfs 工作副本按旧 id 定位断链 → 孤儿清理删副本、子 agent 未 commit 成果丢(2026-08-21 editor 同族事故)
        const beforeBind = internalAfterWrite ? deepClone(bindRef) : null
        const evalLock = await acquireWriteMutex()
        try {
          const vr = validateRootValueLocally({ schema, allowKeys, value: evalResult, bindRef })
          if (!vr.ok) {
            return toolError({ code: 'SCHEMA_INVALID', message: `脚本返回值校验失败,未写入(transform 模式要求返回主数据的完整新值或顶层 key 子集)`, hint: `确认脚本 return 了完整新值(非部分);或返回 {patches:[...]} 走增量模式;按 describe_data() 查看格式`, details: (vr.error.match(/"details":\s*(\[[^\]]*\])/)?.[1] ?? '') || vr.error })
          }
          pushSnapshot('edit', 'eval_transform')
          if (vr.wholeParsed) {
            restoreInPlace(bindRef as Record<string, unknown> | unknown[], vr.assembly)
          } else if (vr.assembly !== null && typeof vr.assembly === 'object') {
            // 白名单模式:merge 语义,只更新出现的顶层 key,隐藏字段保留不动
            safeMerge(bindRef as Record<string, any>, vr.assembly)
          }
          markDataDirty()
          // team-audit P1#3:补齐收敛点(照 write del :1552 模式)—— 回填原 __pgId + 补全新增,防映射断链
          if (internalAfterWrite) { internalAfterWrite(bindRef, beforeBind); markDataDirty() }
          audit({ op: 'edit', detail: 'eval_transform', timestamp: Date.now() })
          setBaseline(hashBind(), scope)
          return `已通过脚本 transform 更新主数据(耗时 ${res.elapsedMs}ms)。当前值: ${safeStringify(bindRef, 600)}`
        } finally {
          evalLock.release()
        }
      }
      return safeStringify({ ok: true, result: res.result, elapsedMs: res.elapsedMs })
    },
    {
      name: 'eval_script',
      description:
        '在 Worker 沙箱对主数据跑自定义 JS(无网络,超时 3s)。入参 data(深拷贝);mode:query 只读回给 LLM/transform 校验后落地(完整新值或 {patches:[…]} 增量);jsonPath 可限定子树。',
      schema: z.object({
        script: z.string().describe('JS 脚本(入参 data;末尾表达式或 return 即返回值),如 data.filter(c=>c.stock>0)'),
        mode: z.enum(['query', 'transform']).optional().describe('query=只读返回结果(默认)/transform=校验后落地为新值'),
        jsonPath: z.string().optional().describe('子树模式:仅对该子树执行;transform 返回值作为子树新值'),
      }),
    },
  )
  markWrite(evalScript, (args) => (args as Record<string, unknown>)?.mode === 'transform')

  // ============ 高层直观工具:read / write(合并 describe+get / set+edit+delete+自动锁+自动快照) ============
  const readSlot = tool(
    async ({ jsonPath, jsonPaths, fields, depth, offset, limit }, config) => {
      const scope = scopeOf(config)  // CA 并发修复:per-call scope token(基线归属 + 大文本摘要主/子判定)
      const fullTextPrefixes = fullTextPrefixesOf(config)  // 聚焦态全文豁免前缀(subtree-summary 通道 ②)
      const h = hashBind()  // 整体 hash(整 bind 域,乐观锁比对整体);多路径/分页/单路径统一取一次
      // 基线刷新时机(rv-core F3):原在路径校验前 setBaseline → PATH_DENIED/UNSAFE 失败读也刷基线,
      // 可构造「失败读吸收宿主改动 → 后续 autoLock 静默覆盖」;下移到校验通过后(保持同序,
      // 多路径至少一个合法路径才刷)
      // 多路径模式:一次读多个不相关子路径(各路径独立投影/拦截/裁剪;非法路径单项标错,不整批失败),省多轮往返
      if (jsonPaths && jsonPaths.length) {
        let anyAllowed = false
        const lines = jsonPaths.map((jpRaw) => {
          const jp = jpRaw || ''
          if (!isPathAllowed(jp, schema, allowKeys)) return `- ${jp || '(根)'}: [PATH_DENIED: 不在 schema 声明字段内]`
          anyAllowed = true
          let target = jp ? getByPath(bindRef, jp) : bindRef
          if (!jp && allowKeys) target = projectBySchemaDeep(target, schema)
          else if (allowKeys) { const ss = getSchemaAtPath(schema, jp); if (ss) target = projectBySchemaDeep(target, ss) }
          let resolved = target
          if (protectedCtx) resolved = renderReadPlaceholders({ jp, resolved, resourcesByPath: protectedCtx.resourcesByPath, resourceStore: protectedCtx.resourceStore })
          if (fields && fields.length) resolved = projectFields(resolved, fields)
          if (depth !== undefined && depth !== null) resolved = limitDepth(resolved, depth)
          // subtree-summary:多路径每条路径各自为结果根(根豁免 —— 不豁免即黑洞且分页静默失效);聚焦前缀全文
          resolved = summarizeLargeText(resolved, scope === MAIN_SCOPE, largeTextSpecs, largeTextThreshold, { rootExempt: true, rootPath: jp, fullTextPrefixes, onSummarized: noteSummarized })
          if (resolved === undefined) return `- ${jp} = (undefined)`
          return `- ${jp} = ${safeStringify(resolved)}`
        })
        if (anyAllowed) setBaseline(h, scope)
        return `多路径读取(共 ${jsonPaths.length} 项,hash=${h}):\n${lines.join('\n')}`
      }
      const jp = jsonPath || ''
      if (isUnsafePath(jp)) return toolError({ code: 'PATH_UNSAFE', message: `jsonPath "${jp}" 含非法段(__proto__/constructor/prototype)`, hint: '使用正常属性路径,如 components.0.text(数组索引数字)' })
      // C2 错误即向导 · 建议键集来源(3.44.1 收紧):schema 声明键优先 —— 正常读路径有深投影(未声明键名不泄露),
      // 错误分支提前返回绕过投影,键集若从原始 bind 取会泄露未声明键名(即使只有名字);开放节点(record/any 等
      // 正常读本就放行)无 shape 可枚举时才回落 bind 实际键
      const suggestKeysOf = (parentJp: string, parent: unknown): string[] =>
        declaredKeysAt(schema, parentJp)  // schema 声明键优先(未声明键名不泄露)
        ?? (parent && typeof parent === 'object' && !Array.isArray(parent) ? Object.keys(parent) : [])  // 开放节点回落 bind
      if (!isPathAllowed(jp, schema, allowKeys)) {
        // C2 错误即向导:键打错/拼错时附父级键集(省「读→猜→再读」试错轮)
        const parentJp0 = /[.[]/.test(jp) ? jp.replace(/[.[][^.[]*$/, '') : ''
        const keys0 = suggestKeysOf(parentJp0, parentJp0 ? getByPath(bindRef, parentJp0) : bindRef)
        const keysHint = keys0.length
          ? `;父级 "${parentJp0 || '(root)'}" 的可用字段:${keys0.slice(0, 12).join(', ')}${keys0.length > 12 ? ' …' : ''}`
          : ''
        return toolError({ code: 'PATH_DENIED', message: `read @ "${jp}" 不在 schema 声明字段内`, hint: `主数据仅暴露 schema 声明的字段;若需操作该字段,集成方需在 schema 中声明它${keysHint}` })
      }
      let target = jp ? getByPath(bindRef, jp) : bindRef
      // tool-call-economy C2 错误即向导:读不存在路径 → 附父级实况(键集/数组长度),省「读→猜→再读」试错轮。
      // 早于 setBaseline(失败读不吸收宿主改动);ERROR 结果走 toolError 单行契约(hint 字段带建议,零格式变化)
      if (jp && target === undefined) {
        // 3.44.1 误伤修复:声明为 optional 的字段缺值 = 合法状态(不是错误)→ 保持旧温和输出「(undefined)」
        // 走正常读流程(不进失败计数/不触发同参 streak);必填字段缺值(数据不一致)或开放节点才报 PATH_NOT_FOUND
        const sub = getSchemaAtPath(schema, jp)
        const isOptionalField = !!sub && typeof (sub as { isOptional?: () => boolean }).isOptional === 'function'
          && (sub as { isOptional: () => boolean }).isOptional()
        if (!isOptionalField) {
          const parentJp = /[.[]/.test(jp) ? jp.replace(/[.[][^.[]*$/, '') : ''
          const parent = parentJp ? getByPath(bindRef, parentJp) : bindRef
          const keys = suggestKeysOf(parentJp, parent)
          const suggest = Array.isArray(parent)
            ? `父级 "${parentJp || '(root)'}" 是 ${parent.length} 元数组,有效索引 0-${Math.max(parent.length - 1, 0)};先 read({jsonPath:"${parentJp}"}) 确认现状,追加元素走 write 的 append`
            : keys.length
              ? `父级 "${parentJp || '(root)'}" 的可用字段:${keys.slice(0, 12).join(', ')}${keys.length > 12 ? ' …' : ''};先 read({jsonPath:"${parentJp}"}) 确认`
              : `父级 "${parentJp || '(root)'}" 不存在或不是容器;先 read() 不传 jsonPath 查看顶层字段`
          return toolError({ code: 'PATH_NOT_FOUND', path: jp, message: `路径 "${jp}" 不存在`, hint: suggest })
        }
      }
      // 投影隐藏未声明字段:统一深投影口径(fix-data-integrity P1-19:整体读也递归投影,与子路径读一致,防嵌套未声明字段泄露)
      if (!jp && allowKeys) target = projectBySchemaDeep(target, schema)
      else if (allowKeys) {
        const subSchema = getSchemaAtPath(schema, jp)
        if (subSchema) target = projectBySchemaDeep(target, subSchema)
      }
      let resolved = target
      if (protectedCtx) resolved = renderReadPlaceholders({ jp, resolved, resourcesByPath: protectedCtx.resourcesByPath, resourceStore: protectedCtx.resourceStore })
      setBaseline(h, scope)  // 校验通过才刷基线(失败读不吸收宿主改动,防构造静默覆盖)
      if (fields && fields.length) resolved = projectFields(resolved, fields)
      if (depth !== undefined && depth !== null) resolved = limitDepth(resolved, depth)
      // subtree-summary:结果根豁免(窄读通道 —— 根不摘要,内部大子树照占位);聚焦前缀全文(__pgFullTextPaths 任意深度豁免)
      resolved = summarizeLargeText(resolved, scope === MAIN_SCOPE, largeTextSpecs, largeTextThreshold, { rootExempt: true, rootPath: jp, fullTextPrefixes, onSummarized: noteSummarized })
      const constraintGuide = '字段约束(类型/min/max/enum/必填/默认)见 systemPrompt「可操作数据」段,或用 schema_data({ jsonPath }) 按需查。'
      const desc = !jsonPath ? `主数据说明: ${description}\n格式: 写入值需为 JSON,且通过声明的 schema 校验(校验失败时 write 会返回结构化错误)。${constraintGuide}\n\n` : ''
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
        '读主数据(只读):不传 jsonPath 返回整体说明+格式;传 jsonPath 返回该路径当前值+hash;传 jsonPaths 一次读多个不相关路径。fields/depth 裁剪、offset/limit 数组分页减体积;详细规则见系统提示。',
      schema: z.object({
        jsonPath: z.string().optional().describe('要读的子路径(如 components.0.text);不传读整体+说明'),
        jsonPaths: z.array(z.string()).optional().describe('多路径一次读(与 jsonPath 互斥,优先);非法路径单项标错不整批'),
        fields: z.array(z.string()).optional().describe('只返回指定字段(投影减体积),如 ["id","title"]'),
        depth: z.number().int().min(0).optional().describe('嵌套深度限制(0=只根占位,逐层截断减体积)'),
        offset: z.number().int().min(0).optional().describe('数组分页起始偏移(仅数组目标,默认 0)'),
        limit: z.number().int().min(1).max(200).optional().describe('数组分页每页条数(默认 50,上限 200),返回切片+total/hasMore'),
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
      // N1 契约(fix-main-sub-isolation + C 形态互锁):基线在冲突检查之前一刻、且在写互锁 acquire 之后解析 ——
      // 互锁模式下后写必须等前写 commit+setBaseline 完成才能取基线,同 scope 连续写看到前写刷新后的基线,
      // 「agent 自己连续写自己」永不互相冲突;串行模式 acquire 直通,时序与原版逐字节一致。
      // 检查/校验段含 await(handleConflict ask),依赖互锁保证窗口内无并发写插入
      const writeLock = await acquireWriteMutex()
      try {
        const effHash = lockOn ? getBaseline(scope) : undefined
        // dryRun 预检:乐观锁手动比对(不调 onConflict 挂起,只返回冲突信息;dryRun 不实际写无需人工介入)
        if (dryRun && effHash !== undefined) {
          const curHash = hashBind()
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
          const conflict = await handleConflict('delete', effHash, undefined, writeLock)
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
          setBaseline(hashBind(), scope)
          return ok ? `已删除主数据 @ ${patch.jsonPath}` : `主数据 @ ${patch.jsonPath} 不存在(无需删除)`
        }

        if (intent === 'edit') {
          if (bindRef == null || typeof bindRef !== 'object') return toolError({ code: 'NOT_OBJECT', message: `edit 仅适用于对象/数组主数据,当前是 ${bindRef === undefined ? 'undefined' : typeof bindRef}`, hint: '叶子用 write(value) 整体设置' })
          const conflict = await handleConflict('edit', effHash, undefined, writeLock)
          if (conflict !== null) return conflict
          // 统一为 patch 列表:批量用 patches;单个用 [patch + 顶层 value]
          const list: { op?: EditOp; jsonPath?: string; value?: unknown }[] = (patches && patches.length) ? patches
            : [{ op: patch!.op ?? 'set', jsonPath: patch!.jsonPath || '', value: payload }]
          const r = applyPatchesToBind({ bindRef, patches: list, schema, allowKeys, snapshots, maxSnapshots, markDataDirty, schemaErrorMode: 'zod', dryRun, internalAfterWrite, protectedCtx })
          if (!r.ok) return r.error
          if (dryRun) return `dryRun(edit): ${r.applied.length} 个 patch 预检通过(schema 校验 OK)。预览结果:${safeStringify(r.clone, 600)}。未实际写入、未入快照。`
          audit({ op: 'edit', detail: `${r.applied.length} 个 patch${r.applied.length > 1 ? '(批量)' : ''}`, value: r.applied.map((a) => `${a.op}@${a.jp}`), timestamp: Date.now() })
          // B __pgId 补齐已由 internalAfterWrite 在 applyPatchesToBind 成功路径处理
          const h = commitBaseline(scope)
          redactPgInPlace(r.clone)
          return `已 write(edit) 主数据(${r.applied.length} 个 patch)。当前值:${safeStringify(r.clone, 600)} (新 hash=${h})`
        }

        // set 整体(commitSetToBind 纯函数:校验+快照+merge+audit,与 draft_commit 共用)
        const pr = maybeParseValue(payload)
        if (pr.parseError) return jsonParseError('', payload, pr.parseError)
        const conflict = await handleConflict('set', effHash, payload, writeLock)
        if (conflict !== null) return conflict
        const r = commitSetToBind({ bindRef, value: pr.parsed, schema, allowKeys, snapshots, maxSnapshots, audit, dryRun, onWrite: markDataDirty, internalAfterWrite, protectedCtx, hashFn: hashBind })
        if (!r.ok) return r.error
        if (dryRun) return `dryRun(set): schema 校验通过。预览新值:${safeStringify(r.data, 600)}。未实际写入、未入快照。`
        // B __pgId 补齐已由 internalAfterWrite 在 commitSetToBind 成功路径处理
        // hash 复用 commitSetToBind 返回值(写路径成本收敛契约:同调用禁二次全量 hash;团队审查 P2-1)
        const __postHash = (r as { hash?: string }).hash ?? hashBind()
        setBaseline(__postHash, scope)
        // 回显净化只作用于副本(legacy-crud-dedup 实测暴露的 P1:codeAsset 场景 assembly 元素与 bind 共享引用,
        // 原地剥 __pg* 会连带抹掉刚回填的映射键,checkout/commit 按 __pgId 定位断链);非 codeAsset 数据无 __pg 键,
        // 直用原值零拷贝零开销
        const disp = pgIdPaths.length ? deepClone(r.data) : r.data
        redactPgInPlace(disp)
        return `已 write(set) 主数据 = ${safeStringify(disp, 600)} (新 hash=${__postHash})${allowKeys ? '(白名单模式:仅更新 schema 声明字段,未声明字段保留)' : ''}`
      } finally {
        writeLock.release()  // C 形态:全 early-return 路径统一收口(ask 拆段已放锁时幂等 no-op)
      }
    },
    {
      name: 'write',
      description:
        '写主数据(唯一写入口;自动 schema 校验+乐观锁+快照)。四意图:整体替换 {value}/增量 {patch:{op,jsonPath,value}}(op set/remove/merge/append/move)/原子批 {patches:[…]}(任一失败回滚)/删子路径 {patch:{jsonPath},del:true};dryRun 预检;详细规则见系统提示。',

      schema: z.object({
        value: z.unknown().optional().describe('JSON 对象(推荐)或 JSON 字符串;set 整体或 patch 的 set/merge/append 必填'),
        patch: z.object({
          op: z.enum(['set', 'remove', 'merge', 'append', 'move']).optional().describe('set 设值/remove 删/merge 合并对象/append 追加数组/move 移动元素(value=目标路径字符串);缺省 set'),
          jsonPath: z.string().optional().describe('相对主数据根的点号路径(如 components.0.text);set/remove 必填,merge/append 不填作用于根'),
          value: z.unknown().optional().describe('该 patch 的值(JSON 或 JSON 字符串);与顶层 value 二选一,优先 patch.value'),
        }).optional().describe('单个增量编辑(自带 value)'),
        patches: z.array(z.object({
          op: z.enum(['set', 'remove', 'merge', 'append', 'move']),
          jsonPath: z.string().optional().describe('相对主数据根的点号路径;set/remove 必填,merge/append 不填作用于根'),
          value: z.unknown().optional().describe('JSON 值(推荐直传)或 JSON 字符串;set/merge/append 必填'),
        })).optional().describe('批量原子编辑:一次提交多个 patch,任一失败整体不写入;适合一次改多处'),
        del: z.boolean().optional().describe('true 则删除 patch.jsonPath 指定的子路径'),
        dryRun: z.boolean().optional().describe('预检:走完整校验链但不落盘不入快照;冲突返回 VERSION_CONFLICT 不挂起'),
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
        // against 可能是 JSON 字符串(LLM 直传),走 maybeParseValue 与 write 的 value 处理对齐(parse 失败保留原串)
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
  // draft_commit 复用 commitSetToBind(与 write(set) 共用校验+快照+乐观锁链)
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
      async ({ draftId }, config) => {
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
        // 顺序:parse 先(草稿非法早返回 JSON_INVALID,不浪费冲突介入)→ 互锁 acquire → handleConflict → commitSetToBind
        const draftLock = await acquireWriteMutex()
        try {
          const effHash = lockOn ? getBaseline(scope) : undefined
          const conflict = await handleConflict('set', effHash, parsed, draftLock)
          if (conflict !== null) return conflict  // 冲突:草稿保留(未删),LLM 重 read 拿最新 hash 后再 commit
          // 复用 commitSetToBind(与 write(set) 共用:schema 校验 + 快照 + merge + audit);op='draft_commit' 标记快照/审计
          const r = commitSetToBind({ bindRef, value: parsed, schema, allowKeys, snapshots, maxSnapshots, audit, op: 'draft_commit', onWrite: markDataDirty, internalAfterWrite, protectedCtx, hashFn: hashBind })
          if (!r.ok) return r.error  // schema 校验失败:草稿保留(不删),LLM 据错误修后重 commit
          setBaseline(r.hash, scope)
          delete store.files[key]  // 成功:清草稿
          return `已 draft_commit 草稿 "${draftId}" → 主数据 = ${safeStringify(r.data, 600)} (新 hash=${r.hash})${allowKeys ? '(白名单模式:仅更新 schema 声明字段)' : ''}。草稿已清理。`
        } finally {
          draftLock.release()
        }
      },
      {
        name: 'draft_commit',
        description:
          '把 draft_write 累积的草稿合并 + JSON.parse + 乐观锁 + schema 校验,原子提交主数据(任一步失败不写,草稿保留可修后重试;成功清草稿 + 自动快照可回退)。仅大 JSON 从零生成用;小改用 write。',
        schema: z.object({
          draftId: z.string().describe('要提交的草稿标识(对应 draft_write 的 draftId)'),
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
        setBaseline(hashBind(), scope)
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
        if (!list.length) {
          // freeze 静态配置无句柄不进资源池 → 空池时同步告知静态 freeze 面(实测:模型 resource_list 见
          // 「无已注册」会误判保护不存在,反而去撞冻结墙)
          const frozenPaths = [...protectedCtx!.resourcesByPath.entries()].filter(([, s]) => s.mode === 'freeze').map(([p]) => p)
          if (frozenPaths.length) return `资源池为空,但集成方静态配置了 freeze 只读字段:${frozenPaths.join('、 ')}(freeze 无句柄、不可释放;resource_delete 仅对 verbatim 生效)`
          return '当前无已注册的受保护资源(read 受保护路径会懒注册)'
        }
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
        if (ok) return `已释放资源 "${target}"(后续 read 该字段会重新懒注册)`
        // freeze 静态配置不在资源池 → 原「不存在(无需释放)」文案把模型带偏(实测:清空受阻时模型试图
        // resource_delete 解冻,两轮探路无果)。静态 freeze 给定向指引
        if (protectedCtx!.resourcesByPath.get(target)?.mode === 'freeze')
          return toolError({ code: 'FROZEN_FIELD', message: `字段 "${target}" 为 freeze 静态保护(不在资源池、无句柄、不可释放)`, hint: 'freeze 由集成方在 data.resources 静态配置,只读不可解;含冻结字段的元素无法整体删除,请保留该元素或由集成方调整 data.resources' })
        return `资源 "${target}" 不存在(无需释放)`
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
    describeData,
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


