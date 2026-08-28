/**
 * 受保护资源(精确值保护)—— 占位符替换读写的核心纯函数与资源存储。
 *
 * 设计见 openspec/changes/2026-08-04-placeholder-protected-read-write/design.md。
 * 核心不变式:**bind 恒持原始值,占位符只在读写边界替换(永不落 bind)** →
 * hash / A4 子路径 hash / 快照 / clone / checkpoint / 乐观锁全部零干扰。
 *
 * 三层:
 *  - 读侧(结构化读 read):受保护路径值 → 占位符(精确值不入 LLM 消息流)
 *    · freeze   → ⟦frozen:<path>⟧(值完全不可改,精确值不泄露)
 *    · verbatim → ⟦res:<handle>⟧(懒注册:首次 read 当前 bind 值入库 → 句柄)
 *  - 写侧强制(commitSetToBind / applyPatchesToBind / eval 整体替换 三处调用,§7c F1):
 *    · freeze 路径被改            → FROZEN_FIELD
 *    · verbatim 句柄              → 定点展开回原值(沿 verbatim 路径,非全局深遍历,§7c A2)
 *    · verbatim 写非句柄新值≠原值 → VERBATIM_MISMATCH
 *    · 未知句柄                   → RESOURCE_NOT_FOUND;池淘汰 → RESOURCE_EVICTED
 *    · remove/delete 受保护路径   → 拒(§7c C3)
 *  - 资源存储:复用 vfs 第四池 resources/<handle>.json(per-resource 文件,
 *    LRU/字节水位/持久化由 vfs 管);handle = 路径派生短哈希(值变句柄不变,§7c B2)。
 *
 * 全增量,默认零行为变化(未配 data.resources 时 protectedCtx=undefined → 全部 no-op)。
 */
import { toolError } from './toolError'
import { getByPath, setByPath, deepClone } from './jsonUtils'
import type { VfsStore } from '../backends/vfs'
import type { EditOp } from './jsonUtils'

/** 受保护资源配置(集成方在 data.resources 声明) */
export interface ResourceProtectSpec {
  /** 相对主数据根的点号路径(如 id / components.0.verification) */
  path: string
  /** freeze=只读不可改(精确值不入消息流);verbatim=原样保留(防压缩丢字+防重打丢字,改须经 resource_update) */
  mode: 'freeze' | 'verbatim'
}

/** 占位符标记(用 ⟦⟧ 数学方括号,与普通文本区分,LLM 不会误产生) */
const FROZEN_PREFIX = '⟦frozen:'
const RES_PREFIX = '⟦res:'
const PLACEHOLDER_SUFFIX = '⟧'

/** 生成 freeze 占位符 */
export function frozenPlaceholder(path: string): string {
  return `${FROZEN_PREFIX}${path}${PLACEHOLDER_SUFFIX}`
}
/** 生成 verbatim 资源句柄占位符 */
export function resPlaceholder(handle: string): string {
  return `${RES_PREFIX}${handle}${PLACEHOLDER_SUFFIX}`
}

/** 解析占位符字符串;非占位符返 null */
export function parsePlaceholder(s: unknown): { type: 'frozen'; path: string } | { type: 'res'; handle: string } | null {
  if (typeof s !== 'string') return null
  if (s.startsWith(FROZEN_PREFIX) && s.endsWith(PLACEHOLDER_SUFFIX)) {
    return { type: 'frozen', path: s.slice(FROZEN_PREFIX.length, s.length - PLACEHOLDER_SUFFIX.length) }
  }
  if (s.startsWith(RES_PREFIX) && s.endsWith(PLACEHOLDER_SUFFIX)) {
    return { type: 'res', handle: s.slice(RES_PREFIX.length, s.length - PLACEHOLDER_SUFFIX.length) }
  }
  return null
}

/** 归一化 jsonPath(先 trim 去空白,再去前导点) */
export function normalizePath(jsonPath: string): string {
  return String(jsonPath ?? '').trim().replace(/^\.+/, '')
}

/** 路径派生短哈希(djb2 → 8 hex);值变句柄不变 → 跨轮稳定,update/淘汰重注册不漂移(§7c B2) */
export function handleFor(path: string): string {
  let h = 5381
  for (let i = 0; i < path.length; i++) h = ((h * 33) ^ path.charCodeAt(i)) >>> 0
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 8)
}

/** 深相等(基本类型 + JSON 序列化对象/数组) */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return false
}

/** 写侧命中关系:patch/read 路径相对受保护路径的位置 */
export type ProtectedRelation = 'exact' | 'descendant' | 'ancestor'

/** 双向段边界匹配:jsonPath 相对受保护路径的关系(写侧用,覆盖祖先替换与子树改)。
 *  段边界:`components` 命中 `components.0.key`,不误伤 `componentsA`(§7c B1)。
 *  - exact:jsonPath == 受保护路径
 *  - descendant:jsonPath 是受保护路径的后代(改受保护子树)
 *  - ancestor:jsonPath 是受保护路径的祖先(整体替换覆盖受保护路径) */
export function matchProtectedEither(
  jsonPath: string,
  resourcesByPath: Map<string, ResourceProtectSpec>,
): { spec: ResourceProtectSpec; relation: ProtectedRelation; protectedPath: string } | undefined {
  const j = normalizePath(jsonPath)
  if (!j) return undefined
  const exact = resourcesByPath.get(j)
  if (exact) return { spec: exact, relation: 'exact', protectedPath: j }
  let best: { spec: ResourceProtectSpec; protectedPath: string; relation: ProtectedRelation } | undefined
  for (const [p, spec] of resourcesByPath) {
    if (j === p) continue
    if (j.startsWith(p + '.')) {
      // jp 是受保护路径后代 → 取最长(最具体)前缀
      if (!best || p.length > best.protectedPath.length) best = { spec, protectedPath: p, relation: 'descendant' }
    } else if (p.startsWith(j + '.')) {
      // jp 是受保护路径祖先 → 取最短(最直接)受保护后代
      if (!best || p.length < best.protectedPath.length) best = { spec, protectedPath: p, relation: 'ancestor' }
    }
  }
  return best
}

/** 资源条目(序列化存 vfs resources/<handle>.json) */
export interface ResourceEntry {
  path: string
  mode: ResourceProtectSpec['mode']
  value: unknown
  handle: string
}

/**
 * 资源池存储 —— 建在 vfs 第四池 resources/ 之上,per-resource 文件。
 * 复用 vfs 的池 LRU/字节水位/持久化(checkpoint 随 vfs 天然);get miss = 被淘汰或不存在。
 */
export class ResourceStore {
  constructor(private vfs: VfsStore) {}

  private key(handle: string): string {
    return `resources/${handle}.json`
  }

  /** 懒注册/更新:确保 path→value 入池,返回 handle(路径派生,值变句柄不变) */
  ensure(path: string, value: unknown, mode: ResourceProtectSpec['mode']): string {
    const handle = handleFor(path)
    const entry: ResourceEntry = { path, mode, value, handle }
    this.vfs.files[this.key(handle)] = { content: JSON.stringify(entry), updatedAt: Date.now() }
    return handle
  }

  /** 取条目(by handle 或 path);miss 返 undefined(被淘汰/不存在) */
  get(handleOrPath: string): ResourceEntry | undefined {
    // 先当 handle 试(8 hex);再当 path → handle
    const byHandle = this.readEntry(this.key(handleOrPath))
    if (byHandle) return byHandle
    return this.readEntry(this.key(handleFor(handleOrPath)))
  }

  private readEntry(key: string): ResourceEntry | undefined {
    const f = this.vfs.files[key]
    if (!f) return undefined
    try {
      const e = JSON.parse(f.content) as ResourceEntry
      return e && typeof e.path === 'string' ? e : undefined
    } catch {
      return undefined
    }
  }

  /** 更新资源值(保留原 mode);verbatim 改值通道 */
  update(path: string, value: unknown): void {
    const existing = this.get(path)
    this.ensure(path, value, existing?.mode ?? 'verbatim')
  }

  /** 删除(by handle 或 path);返回是否存在过 */
  delete(handleOrPath: string): boolean {
    const entry = this.get(handleOrPath)
    const handle = entry?.handle ?? handleFor(handleOrPath)
    const k = this.key(handle)
    const existed = !!this.vfs.files[k]
    if (existed) delete this.vfs.files[k]
    return existed
  }

  /** 列出全部资源(path/mode/handle/bytes) */
  list(): { path: string; mode: ResourceProtectSpec['mode']; handle: string; bytes: number }[] {
    const out: { path: string; mode: ResourceProtectSpec['mode']; handle: string; bytes: number }[] = []
    for (const [k, f] of Object.entries(this.vfs.files)) {
      if (!k.startsWith('resources/')) continue
      try {
        const e = JSON.parse(f.content) as ResourceEntry
        if (e && typeof e.path === 'string') out.push({ path: e.path, mode: e.mode, handle: e.handle, bytes: f.content.length })
      } catch {
        /* 跳过损坏条目 */
      }
    }
    return out
  }

  /** 清空全部资源(setData 替换 data 时调用,路径可能失效) */
  clear(): void {
    for (const k of Object.keys(this.vfs.files)) {
      if (k.startsWith('resources/')) delete this.vfs.files[k]
    }
  }
}

/** 强制层上下文(经可选参数传入 commitSetToBind / applyPatchesToBind) */
export interface ProtectedCtx {
  /** 受保护路径 → spec(normalizePath 键;controller.set 替换 data 时重建) */
  resourcesByPath: Map<string, ResourceProtectSpec>
  /** 资源池(verbatim 句柄存取);undefined 时 freeze 仍工作,verbatim 降级(展开报 RESOURCE_NOT_FOUND) */
  resourceStore: ResourceStore | undefined
  /** 读当前 bind 原始值(D1 自愈比对基准 + freeze 当前值比对) */
  getBind: () => unknown
  /**
   * 判定受保护路径的字段是否为 schema 必填(frozen-required-hint,2026-08-28;createDataOps 闭包注入,
   * 闭包引用 live schema)。用于「保护字段 × schema 必填」碰撞提示:该形态下「保留含冻结字段的元素」
   * 与「新建元素缺必填被拒」互为死锁,提示模型勿反复整体替换重试、给逃生门
   */
  isFieldRequired?: (path: string) => boolean
  /**
   * 调序重锚定暂存(freeze-move,2026-08-28):normalizeAndCheck 检出「保护元素位移」时记录
   * [旧路径, 新路径] 对;**写成功 commit 后**由 dataOps 调 commitReanchors 落到 resourcesByPath
   * (注册表跟随元素迁移,防调序后路径过期 → 后续合法写误报 FROZEN_FIELD)。normalizeAndCheck
   * 入口清空(单次写只消费自己的重锚定;写失败/ dryRun 不落地)。
   */
  pendingReanchors?: Array<[string, string]>
}

/**
 * 落地调序重锚定到注册表(写成功 commit 后调;置换安全:两冻结元素互换位置时 delete 先行会互吃)。
 */
export function commitReanchors(ctx: ProtectedCtx | undefined): void {
  const moves = ctx?.pendingReanchors
  if (!ctx || !moves || !moves.length) return
  const specs = moves
    .map(([o, n]) => ({ o, n, spec: ctx.resourcesByPath.get(o) }))
    .filter((m): m is { o: string; n: string; spec: ResourceProtectSpec } => !!m.spec && m.o !== m.n)
  for (const m of specs) ctx.resourcesByPath.delete(m.o)
  for (const m of specs) if (!ctx.resourcesByPath.has(m.n)) ctx.resourcesByPath.set(m.n, m.spec)
  moves.length = 0
}

/**
 * 读侧占位符替换:在结构化读(read)结果上,把受保护路径值替换为占位符。
 * 仅结构化读调用 —— query/search/eval 返真值,由写侧强制兜底(§7c A1)。
 * 无受保护路径或 read 不涉受保护子树时直接返回原值(零 clone 零开销)。
 * @param jp read 的 jsonPath(相对 bind 根,'' = 整体)
 * @param resolved 投影后的 read 结果(可能为 bind 子引用 → 内部按需 clone,不污染 bind)
 */
export function renderReadPlaceholders(args: {
  jp: string
  resolved: unknown
  resourcesByPath: Map<string, ResourceProtectSpec>
  resourceStore: ResourceStore | undefined
}): unknown {
  const { jp, resolved, resourcesByPath, resourceStore } = args
  if (!resourcesByPath.size) return resolved
  // 检测是否有受保护路径落在 jp 子树内(避免无谓 clone)
  let anyInScope = false
  for (const path of resourcesByPath.keys()) {
    if (jp === '' || path === jp || path.startsWith(jp + '.')) { anyInScope = true; break }
  }
  if (!anyInScope) return resolved
  // 在 clone 上替换(防 setByPath 改 bind 子引用)
  const clone = deepClone(resolved)
  for (const [path, spec] of resourcesByPath) {
    if (jp !== '' && path !== jp && !path.startsWith(jp + '.')) continue
    if (path === jp) {
      // 整个 read 结果即受保护值
      if (clone === undefined) continue
      if (spec.mode === 'freeze') return frozenPlaceholder(path)
      return resourceStore ? resPlaceholder(resourceStore.ensure(path, clone, 'verbatim')) : clone
    }
    const relPath = jp === '' ? path : path.slice(jp.length + 1)
    const cur = getByPath(clone, relPath)
    if (cur === undefined) continue  // 受保护路径在 bind 不存在 → skip(§7c B4)
    if (spec.mode === 'freeze') {
      setByPath(clone, relPath, frozenPlaceholder(path))
    } else if (resourceStore) {
      setByPath(clone, relPath, resPlaceholder(resourceStore.ensure(path, cur, 'verbatim')))
    }
  }
  return clone
}

/** 句柄展开 + D1 池值自愈(写侧;定点,仅 verbatim 路径调用)。
 *  返回 { value } 或结构化错误 { code, message, hint }(由调用方经 toolError 格式化) */
function expandHandle(
  handle: string,
  path: string,
  bindCur: unknown,
  store: ResourceStore | undefined,
): { value: unknown } | { code: string; message: string; hint: string } {
  if (!store) return { code: 'RESOURCE_NOT_FOUND', message: `句柄 "${handle}" 无法展开(资源池未启用)`, hint: 'verbatim 保护需启用 vfs(capabilities.vfs 默认开);集成方经 createChatSdk 配 data.resources 时自动提供 vfsStore' }
  const entry = store.get(handle)
  if (!entry) {
    // 池无(被淘汰或未注册)。bind 当前有值 → 写侧原值不可知(池被淘汰)→ RESOURCE_EVICTED(提示重注册)
    if (bindCur !== undefined) {
      return { code: 'RESOURCE_EVICTED', message: `字段 "${path}" 的 verbatim 资源已被淘汰(资源池 LRU)`, hint: '重新 read 该字段触发懒注册重建句柄,再写回新句柄 ⟦res:<handle>⟧' }
    }
    return { code: 'RESOURCE_NOT_FOUND', message: `句柄 "${handle}" 不存在(字段 "${path}" 可能未注册或已被删除)`, hint: '重新 read 该字段触发懒注册' }
  }
  // bind 已无该字段(被删 / restore 到无此字段快照)→ 不展开旧值复活(§7c B4:RESOURCE_NOT_FOUND)
  if (bindCur === undefined) {
    return { code: 'RESOURCE_NOT_FOUND', message: `字段 "${path}" 在 bind 中已不存在,无法展开句柄 "${handle}"`, hint: '该字段可能已被删除或 restore 到不含此字段的快照;重新 read 确认当前结构' }
  }
  // D1 自愈:池值 vs bind 当前值不等 → 以 bind 当前值为准重注册(句柄不变),防展开旧值覆盖 restore/import 的新值
  if (!deepEqual(entry.value, bindCur)) {
    store.update(path, bindCur)
    return { value: bindCur }
  }
  return { value: entry.value }
}

/** normalize 检查结果(结构化,供 enforceSet/enforcePatches 各自格式化为 toolError) */
type CheckResult =
  | { ok: true }
  | { ok: false; code: string; path: string; message: string; hint: string }

/** 共享:遍历受保护路径,在 normalized 上做 C1 回显识别 + verbatim 定点展开(A2/D1)+ freeze/verbatim 比对。
 *  就地改 normalized。valAt undefined 且容器仍在 → 回填(H1 防静默丢失);容器链断按 mergeMode/根键在场分路(见函数体)。
 *  mergeMode:写入是否 merge 语义(allowKeys 整体 set;缺省 falsy = whole-replace/enforcePatches 全量语境)。 */
/**
 * 数组调序重锚定(freeze-move 豁免,2026-08-28 uispec S3 驱动):冻结/verbatim 保护锚定「值」
 * 不锚定「数组位置」—— 保护字段原值若仍完整存在于**同数组其他位置**(元素整体位移,move op/
 * 调序常态),返回新位置完整路径供重锚定校验;未找到返回 undefined(原路径校验照走,值被改/
 * 元素被删照拦,保护语义不放宽)。
 * 解析:取路径中最后一个「后随还有段的数组下标段」为元素锚(components.2.children.3.props.trackId
 * → 数组 components.2.children + 元素内尾路径 props.trackId),在 normalized 的该数组内逐元素比对。
 * 仅同数组位移豁免(跨数组移动冻结元素不豁免,与 codeAsset 嵌套容器盲区同口径,宁拒勿失)。
 */
function findReorderedAnchor(normalized: unknown, protectedPath: string, cur: unknown): string | undefined {
  if (cur === undefined) return undefined
  const segs = protectedPath.split('.')
  // 逐数组锚层级尝试(外层调序/内层重排均覆盖;深层锚路径在外层调序后自身失效 → 只认一层不够):
  // 任一层级上「原值出现在非原位」即按该层重锚定;原位命中 = 该层未位移,继续试其他层
  for (let k = 0; k < segs.length - 1; k++) {
    if (!/^\d+$/.test(segs[k])) continue
    const arrPath = segs.slice(0, k).join('.')
    const tail = segs.slice(k + 1).join('.')
    const arr = getByPath(normalized, arrPath)
    if (!Array.isArray(arr)) continue
    for (let j = 0; j < arr.length; j++) {
      const v = getByPath(arr[j], tail)
      if (v !== undefined && deepEqual(v, cur)) {
        const newPath = [...segs.slice(0, k), String(j), ...segs.slice(k + 1)].join('.')
        if (newPath !== protectedPath) return newPath
      }
    }
  }
  return undefined
}

/**
 * 调序检测(H1 回填前置,freeze-move 收紧 2026-08-28):保护路径首个数组层上,normalized
 * 原位元素与 bind **其他下标**元素内容相等(= 调序后原位已换人)→ 不回填 —— 修前此形态回填
 * = 把冻结值复制进无关元素 + 位移元素的篡改副本静默落地(位移+改值实测漏网)。
 * 同位编辑(nav→nav2)/全新内容不触发(合法 H1 形态照回填,LLM 因读投影隐藏漏带冻结字段)。
 */
function replacedByOtherElement(normalized: unknown, bind: unknown, protectedPath: string): boolean {
  const segs = protectedPath.split('.')
  const k = segs.findIndex((sg) => /^\d+$/.test(sg))
  if (k < 0) return false
  const arrPath = segs.slice(0, k).join('.')
  const idx = Number(segs[k])
  const nArr = getByPath(normalized, arrPath)
  const bArr = getByPath(bind, arrPath)
  if (!Array.isArray(nArr) || !Array.isArray(bArr)) return false
  const ne = nArr[idx]
  if (ne === undefined) return false
  for (let i = 0; i < bArr.length; i++) {
    if (i === idx) continue
    if (deepEqual(ne, bArr[i])) return true
  }
  return false
}

function normalizeAndCheck(normalized: unknown, ctx: ProtectedCtx, mergeMode?: boolean): CheckResult {
  const bind = ctx.getBind()
  if (ctx.pendingReanchors) ctx.pendingReanchors.length = 0  // 单次写只消费自己的重锚定(上次失败/dryRun 残留清空)
  for (const [path, spec] of ctx.resourcesByPath) {
    const cur = getByPath(bind, path)  // bind 当前原始值
    // move/调序豁免:原值仍在同数组其他位置 → 按新位置重锚定(修前路径键定,调序后 valAt 取到
    // 别的元素/undefined → 误报 FROZEN_FIELD 或 H1 回填把冻结值写进别的元素)
    const reanchor = findReorderedAnchor(normalized, path, cur)
    if (reanchor) ctx.pendingReanchors?.push([path, reanchor])
    const checkPath = reanchor ?? path
    const valAt = getByPath(normalized, checkPath)
    if (valAt === undefined) {
      // bind 无值(cur undefined)才 skip(§7c B4)
      if (cur === undefined) continue
      const segs = path.split('.')
      const parentPath = segs.length > 1 ? segs.slice(0, -1).join('.') : ''
      if (getByPath(normalized, parentPath) !== undefined && !replacedByOtherElement(normalized, bind, path)) {
        // H1:容器仍在(LLM 部分提交漏写该字段,读投影隐藏所致)→ 回填当前值保留(防静默丢失);
        // 原位已换人(调序形态)不回填 → 落三路判定显式拒(防冻结值复制进无关元素 + 篡改副本落地)
        setByPath(normalized, path, cur)
        continue
      }
      // 容器链断。按「根键是否显式在场」分三路(2026-08-26 complex-demo「清空组件」15 轮事故驱动):
      //   旧实现一律 setByPath 回填 → 凭空捏造骨架(如 [{props:{trackId}}])→ merge 模式下 safeMerge
      //   用骨架覆盖原数组(静默数据丢失);显式删除场景则后续 schema 校验失败且报错完全不提保护,模型无从诊断。
      const rootPresent = !!normalized && typeof normalized === 'object' && segs[0] in (normalized as Record<string, unknown>)
      if (!rootPresent) {
        if (mergeMode) continue  // merge 语义:根键未传 → bind 整树保留(本就不该动,也无需回填)
        setByPath(normalized, path, cur)  // whole-replace:键缺失 → 回填保全(H1 原语义,restoreInPlace 全量替换语境正确)
        continue
      }
      // 根键在场但受保护链被显式删除(set components=[] / 换掉含冻结字段的元素)→ 与 remove patch 同语义显式拒绝
      // frozen-required-hint:字段同时是 schema 必填 → 「保留元素补必填」与「新建元素缺必填被拒」互为死锁,附逃生门
      const deadlock = spec.mode === 'freeze' && !!ctx.isFieldRequired?.(path)
      return {
        ok: false,
        code: spec.mode === 'freeze' ? 'FROZEN_FIELD' : 'VERBATIM_PROTECTED',
        path,
        message: `整体替换会移除受保护字段 "${path}"(${spec.mode}),已拒绝`,
        hint: spec.mode === 'freeze'
          ? '含冻结字段的容器不可整体清空/替换:保留包含该字段的元素(补齐其必填字段,如 type),或逐个 remove 其余元素;彻底移除该字段需集成方调整 data.resources'
            + (deadlock ? `;⚠ 该字段("${path.split('.').pop()}")同时是 schema 必填 —— 新建同类元素会因缺它被 schema 拒,此路死锁:勿反复整体替换重试,改用增量 patch 只写非保护字段,或由集成方将保护字段设为可选/给默认值` : '')
          : '含 verbatim 字段的容器不可整体清空/替换:保留包含该字段的元素,或先 resource_delete({path}) 释放保护后再整体替换',
      }
    }
    if (spec.mode === 'freeze') {
      // C1 回显:LLM 原样带回 ⟦frozen:path⟧ → 视为未改,保留当前值(不把占位符串落 bind)
      if (valAt === frozenPlaceholder(path)) {
        setByPath(normalized, path, cur)
        continue
      }
      if (!deepEqual(valAt, cur)) {
        return { ok: false, code: 'FROZEN_FIELD', path, message: `字段 "${path}" 已冻结(freeze 保护),不可修改`, hint: '该字段由系统/集成方维护,LLM 不得改动。如需展示其值用 resource_get({path}) 取真值' }
      }
    } else {
      // verbatim
      const ph = parsePlaceholder(valAt)
      if (ph && ph.type === 'res') {
        const exp = expandHandle(ph.handle, path, cur, ctx.resourceStore)
        if ('value' in exp) {
          setByPath(normalized, path, exp.value)
          continue
        }
        return { ok: false, code: exp.code, path, message: exp.message, hint: exp.hint }
      }
      // 非句柄值:经 resource_get 拿到的原值(cur)视为未改放行;新值 ≠ 原值 → VERBATIM_MISMATCH
      if (!deepEqual(valAt, cur)) {
        return { ok: false, code: 'VERBATIM_MISMATCH', path, message: `字段 "${path}" 为 verbatim 保护(精确原样保留),写入值与原值不符`, hint: '要改该值请先 resource_update({path, value}) 更新资源池,再写回句柄 ⟦res:<handle>⟧;或写回原值(经 resource_get 取到的值)保持不变' }
      }
    }
  }
  return { ok: true }
}

/** 把 CheckResult 违规格式化为 toolError 字符串;patchIndex 提供时带 patches[i] 定位(C2) */
function formatCheckError(r: Exclude<CheckResult, { ok: true }>, patchIndex?: number, patchJsonPath?: string): string {
  const message = patchIndex !== undefined
    ? `patches[${patchIndex}]${patchJsonPath ? ` @ "${patchJsonPath}"` : ''}: ${r.message}`
    : r.message
  return toolError({
    code: r.code,
    path: r.path,
    message,
    hint: r.hint,
    ...(patchIndex !== undefined ? { details: { patchIndex, patchJsonPath: patchJsonPath ?? null } } : {}),
  })
}

/**
 * set 模式强制(整体写:commitSetToBind / eval 整体替换)。
 * 在 schema 校验前调用:normalize(C1 回显 + verbatim 展开 + D1)+ freeze/verbatim 比对。
 * 返回 {ok, value: normalized}(value 经后续 schema 校验 + merge)或 {ok:false, error}。
 * protectedCtx undefined 或空 → no-op(向后兼容)。
 */
export function enforceSet(args: {
  value: unknown
  ctx: ProtectedCtx | undefined
  /** merge 语义(allowKeys 整体 set:根键未传 = bind 保留);缺省 = whole-replace/全量语境 */
  mergeMode?: boolean
}): { ok: true; value: unknown } | { ok: false; error: string } {
  const { value, ctx, mergeMode } = args
  if (!ctx || !ctx.resourcesByPath.size) return { ok: true, value }
  const normalized = deepClone(value)
  const r = normalizeAndCheck(normalized, ctx, mergeMode)
  if (!r.ok) return { ok: false, error: formatCheckError(r) }
  return { ok: true, value: normalized }
}

/**
 * patch 模式强制(增量写:applyPatchesToBind)。
 * 在所有 patch 应用到 clone 之后、整体 schema 校验之前调用。
 * ① 逐 patch 查 remove 命中受保护(C3,带 patches[i] 定位);
 * ② normalizeAndCheck 比对(覆盖 set/merge/append 改值 + ancestor 整体替换),违规定位 patches[i](C2)。
 * protectedCtx undefined 或空 → no-op。
 */
export function enforcePatches(args: {
  patches: { op?: EditOp; jsonPath?: string; value?: unknown }[]
  clone: unknown
  ctx: ProtectedCtx | undefined
}): { ok: true } | { ok: false; error: string } {
  const { patches, clone, ctx } = args
  if (!ctx || !ctx.resourcesByPath.size) return { ok: true }
  // ① C3:逐 patch 查 remove 命中受保护路径
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i]
    if (p.op === 'remove') {
      const hit = matchProtectedEither(p.jsonPath || '', ctx.resourcesByPath)
      if (hit) {
        const code = hit.spec.mode === 'freeze' ? 'FROZEN_FIELD' : 'VERBATIM_PROTECTED'
        const hint = hit.spec.mode === 'freeze'
          ? '冻结字段不可删。如需移除请联系集成方调整 data.resources 配置'
          : 'verbatim 字段不可直接删;先 resource_delete({path}) 释放资源保护后再删'
        return {
          ok: false,
          error: toolError({
            code,
            path: hit.protectedPath,
            message: `patches[${i}] @ "${p.jsonPath}" 命中受保护字段 "${hit.protectedPath}"(${hit.spec.mode}),不可删除`,
            hint,
            details: { patchIndex: i, patchJsonPath: p.jsonPath ?? '' },
          }),
        }
      }
    }
  }
  // ② 比对 clone vs bind(覆盖 set/merge/append 改值 + ancestor 替换),违规定位 patches[i]
  const r = normalizeAndCheck(clone, ctx)
  if (!r.ok) {
    const idx = locatePatchIndex(r.path, patches)
    return { ok: false, error: formatCheckError(r, idx >= 0 ? idx : undefined, idx >= 0 ? patches[idx].jsonPath : undefined) }
  }
  return { ok: true }
}

/** 找命中 violatedPath 的 patch index(exact/descendant/ancestor 任一);未命中返 -1 */
function locatePatchIndex(violatedPath: string, patches: { op?: EditOp; jsonPath?: string; value?: unknown }[]): number {
  const v = normalizePath(violatedPath)
  for (let i = 0; i < patches.length; i++) {
    const jp = normalizePath(patches[i].jsonPath || '')
    if (!jp) continue
    if (jp === v || v.startsWith(jp + '.') || jp.startsWith(v + '.')) return i
  }
  return -1
}
