/**
 * stale-read-invalidation Phase 1 —— 写驱动的过期读失效(纯函数)
 *
 * 动机(见 openspec/changes/2026-08-21-stale-read-invalidation/proposal.md):
 * 单次 invoke 的 ReAct 窗口内,round 2 的 read 结果在 round 5 write 之后整段保留到收口 ——
 * 又大又假(模型看得见的旧值是误导源;乐观锁已承认「read 之后数据会变」但上下文没清理)。
 *
 * 设计要点(三方评审回改后):
 * - 路径提取一律取自 AIMessage.tool_calls(name+args),content 只作替换目标 → 天然幂等
 *   (重跑不会把占位文本误当 read 结果;占位开头标记直接跳过,不二次处理不重复计数)
 * - op 感知失效范围:set/merge/append 只失效自身/祖先/后代(兄弟安全);remove/move/del 追加
 *   父数组路径(数组移位使兄弟路径错位,旧快照是「路径标签错位」比旧值更毒)
 * - query_data 按 expr 静态前缀定界(jpTokenize,遇通配/过滤/递归截断);search_data 恒 ROOT
 * - resource_update/resource_delete 不触发(资源池 path 非数据 jsonPath,双向误伤)
 * - 同批串行序:maxParallelTools===1(默认)时同批 [write, read] 的 read 反映写后状态不失效;
 *   >1 时同批全失效(顺序才真正未定义)
 * - 前缀匹配带 `.`/`[` 分隔符(components 不误配 components2,照抄 isPathWritable 纪律)
 */
import { ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { jpTokenize } from '../tools/dataSlotQuery'

const ROOT = ''
const ROOT_DISPLAY = '根(整体)'
/** 占位文案开头标记(幂等判定:已占位的 ToolMessage 跳过) */
export const STALE_PLACEHOLDER_MARK = '⏱[过期快照]'

/** 读工具集(需要失效判定的;describe/schema 是静态说明、history 读快照非现值,不在内) */
const READ_TOOLS = new Set(['read', 'query_data', 'search_data'])
/** 不触发失效的写工具:资源池 path 非主数据 jsonPath(resource_update 换资源不改 read 输出,rdelete 不动 bind) */
const EXCLUDED_WRITE_TOOLS = new Set(['resource_update', 'resource_delete'])
/** 会引起数组位移的 op(remove 删元素/move 搬元素):兄弟索引位移必须失效 */
const SHIFT_OPS = new Set(['remove', 'move'])

export interface StaleWriteRecord {
  name: string
  args: Record<string, unknown>
  /** 本批 tool_calls 内的序号(串行序判定「写后读不失效」用);缺省按并发语义(同批读全失效,新鲜度优先) */
  callIndex?: number
}

export interface InvalidateStaleReadsOptions {
  /** 写发生轮次(占位文案引用;缺省不带轮次) */
  round?: number
  /** >1 时同批读不按串行序豁免(并发顺序未定义,全失效);默认 1 */
  maxParallelTools?: number
}

export interface InvalidationResult {
  messages: BaseMessage[]
  /** 本次实际替换的读 ToolMessage 数(幂等:已占位的不计) */
  invalidatedCount: number
  invalidated: Array<{ paths: string[]; writtenPaths: string[] }>
}

/** path 归一:''/'(root)'/'$' → ROOT;剥 '$.' 前缀;其余 trim */
function normalizePath(p: string): string {
  let s = String(p).trim()
  if (s === '(root)' || s === '$') return ROOT
  if (s.startsWith('$.')) s = s.slice(2)
  else if (s.startsWith('$')) s = s.slice(1)
  // 3.44.1 误伤修复:数组下标形态归一(components[0] ≡ components.0)—— query expr 路径产出已是点分形态
  // (jpTokenize),裸 jsonPath 的括号形态此前不归一 → 「写用 components[0] / 证据或读用 components.0」
  // 会被判不重叠(stale-read 失效漏配 + evidence 审计误伤同根);中心归一,三侧(读/写/证据)同口径
  s = s.replace(/\[(\d+)\]/g, '.$1')
  return s
}

/** 显示用 path(ROOT → 可读文案) */
function displayPath(p: string): string {
  const n = normalizePath(p)
  return n === ROOT ? ROOT_DISPLAY : n
}

/** 剥最后一段得父路径('components.0.text' → 'components.0';无分隔 → ROOT) */
function parentOf(p: string): string {
  const cut = Math.max(p.lastIndexOf('.'), p.lastIndexOf('['))
  return cut <= 0 ? ROOT : p.slice(0, cut)
}

/** 重叠判定:相等 / 任一方为 ROOT / 祖先-后代(带 `.`/`[` 分隔符,components ≠ components2) */
export function pathsOverlap(a: string, b: string): boolean {
  const na = normalizePath(a)
  const nb = normalizePath(b)
  if (na === ROOT || nb === ROOT) return true
  if (na === nb) return true
  return na.startsWith(nb + '.') || na.startsWith(nb + '[')
    || nb.startsWith(na + '.') || nb.startsWith(na + '[')
}

/** query_data expr 的静态前缀($.components[?…][0].name → 'components'):遇通配/过滤/递归截断(其后结果形状不可静态定界) */
function queryPrefixPath(expr: string): string {
  if (!expr) return ROOT
  try {
    const segs: string[] = []
    for (const t of jpTokenize(expr)) {
      if (t.type === 'key' && t.key) segs.push(t.key)
      else if (t.type === 'index' && t.index !== undefined) segs.push(String(t.index))
      else break // wildcard / filter / descendKey / descendAll
    }
    return segs.length ? segs.join('.') : ROOT
  } catch {
    return ROOT // 非法表达式保守按根
  }
}

/** 读工具的读取范围(归一后;空 = ROOT) */
export function extractReadPaths(name: string, args: Record<string, unknown> | undefined): string[] {
  const a = args || {}
  if (name === 'query_data') return [queryPrefixPath(String(a.expr || ''))]
  if (name === 'search_data') return [ROOT]
  // read:jsonPath ∪ jsonPaths(jsonPaths 不收集会误判 root,任意写整条击穿)
  const out: string[] = []
  if (typeof a.jsonPath === 'string' && a.jsonPath) out.push(a.jsonPath)
  if (Array.isArray(a.jsonPaths)) for (const p of a.jsonPaths) if (typeof p === 'string' && p) out.push(p)
  return out.length ? out.map(normalizePath) : [ROOT]
}

interface EffectiveWrite {
  /** op 感知展开后的失效面(set/merge/append = 自身;remove/move/del = 自身+父数组;move = +目标+目标父) */
  paths: string[]
  /** 写结果是否带新值/新 hash(write edit/set 带;del 只说「已删除」——占位不引用防撒谎) */
  hasPostValue: boolean
  callIndex?: number
}

/** 写记录 → 失效面展开(纯函数;排除 resource_*;空路径 = ROOT) */
export function effectiveWritePaths(rec: StaleWriteRecord): EffectiveWrite | null {
  if (EXCLUDED_WRITE_TOOLS.has(rec.name)) return null
  const args = (rec.args || {}) as Record<string, any>
  const isDelete = args.del === true
  // 统一为 (path, op, value) 列表:del / patches / patch / jsonPath 直传 / 其余(整体 set / root transform)= ROOT
  const pairs: Array<{ path: string; op: string; value?: unknown }> = []
  if (isDelete) {
    pairs.push({ path: String(args.patch?.jsonPath ?? args.jsonPath ?? ''), op: 'remove' })
  } else if (Array.isArray(args.patches)) {
    for (const p of args.patches) {
      if (p && typeof p === 'object') pairs.push({ path: String((p as any).jsonPath || ''), op: String((p as any).op || 'set'), value: (p as any).value })
    }
  } else if (args.patch && typeof args.patch === 'object') {
    pairs.push({ path: String(args.patch.jsonPath || ''), op: String(args.patch.op || 'set'), value: args.patch.value })
  } else if (typeof args.jsonPath === 'string' && args.jsonPath) {
    // eval_script transform 子树(jsonPath 顶层直传,set 语义;edit_data 顶层形态已随工具移除)
    pairs.push({ path: args.jsonPath, op: 'set' })
  } else if (typeof args.path === 'string' && args.path) {
    pairs.push({ path: args.path, op: 'set' })
  } else {
    pairs.push({ path: ROOT, op: 'set' }) // 整体 write(value) / eval transform 根 / restore
  }
  const paths = new Set<string>()
  for (const { path, op, value } of pairs) {
    const np = normalizePath(path)
    paths.add(np)
    if (SHIFT_OPS.has(op)) paths.add(parentOf(np)) // 兄弟索引位移必须失效
    if (op === 'move' && typeof value === 'string' && value) {
      const nt = normalizePath(value)
      paths.add(nt)
      paths.add(parentOf(nt))
    }
  }
  return { paths: [...paths], hasPostValue: !isDelete, callIndex: rec.callIndex }
}

/** 占位文案(反 thrash:钉原读路径引导窄读 / 引用 write 自带新值+hash / del 不引用 / query·search 分语) */
function buildPlaceholder(readPaths: string[], readTool: string, writes: EffectiveWrite[], round?: number): string {
  const readDisp = readPaths.map(displayPath).join('、')
  const writtenDisp = [...new Set(writes.flatMap((w) => w.paths))].map(displayPath).join('、')
  const when = round !== undefined ? `第 ${round} 轮写入了 ${writtenDisp}` : `已写入 ${writtenDisp}`
  const lines = [`⏱[过期快照] 此前读取 ${readDisp} 的结果已失效(${when})。`]
  const hasValue = writes.some((w) => w.hasPostValue)
  if (hasValue) lines.push(`该轮写入结果已含 ${writtenDisp} 最新值与新 hash;${readDisp} 的兄弟子树(未触及部分)仍为读取时原值可参考。`)
  else lines.push(`${readDisp} 的兄弟子树(未触及部分)仍为读取时原值可参考。`)
  if (readTool === 'query_data' || readTool === 'search_data') {
    lines.push(`需当前结果时重跑 ${readTool}(表达式/条件不变即可)。`)
  } else {
    lines.push(`需当前精确值时再 read(建议窄读:${readDisp})。`)
  }
  return lines.join('\n')
}

/**
 * 对 messages 里已被「本批成功写」击中的过期读结果做占位替换。
 * 纯函数:不改原数组,替换处生成新 ToolMessage(保留 tool_call_id,结构完整)。
 * 宁漏勿误:配对失配跳过;已占位(幂等标记)跳过;无有效写原样返回。
 */
export function invalidateStaleReads(
  messages: BaseMessage[],
  writes: StaleWriteRecord[],
  opts: InvalidateStaleReadsOptions = {},
): InvalidationResult {
  const maxParallel = opts.maxParallelTools ?? 1
  const effWrites = writes
    .map((w) => effectiveWritePaths(w))
    .filter((w): w is EffectiveWrite => w !== null)
  if (!effWrites.length || !messages.length) return { messages, invalidatedCount: 0, invalidated: [] }

  // 当前批 = 最后一条带 tool_calls 的 AIMessage(失效发生在其 ToolMessage 全部 push 完成后)
  // 判型用 _getType() 而非 instanceof:流式聚合的消息是 AIMessageChunk(非 AIMessage 子类),instanceof 判不中
  const typeOf = (m: BaseMessage): string => (m as unknown as { _getType?: () => string })._getType?.() ?? 'unknown'
  let lastAIIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (typeOf(m) === 'ai') {
      const tcs = (m as unknown as { tool_calls?: unknown[] }).tool_calls
      if (Array.isArray(tcs) && tcs.length) { lastAIIndex = i; break }
    }
  }

  // 配对 walk:AIMessage.tool_calls(name+args)→ 紧随的 ToolMessage(替换目标)
  // id 精确匹配优先;id 缺失按 tool_calls 顺序兜底(ToolMessage 带 name 时叠加 name 校验);再失配跳过
  interface ReadHit { aiIndex: number; callIndex: number; name: string; paths: string[]; msgIndex: number }
  const reads: ReadHit[] = []
  let pending: Array<{ callIndex: number; id?: string; name: string; args: Record<string, unknown>; used: boolean }> = []
  let curAI = -1
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (typeOf(m) === 'ai') {
      const tcs = (m as unknown as { tool_calls?: Array<{ id?: string; name: string; args?: Record<string, unknown> }> }).tool_calls
      pending = (Array.isArray(tcs) ? tcs : []).map((tc, idx) => ({ callIndex: idx, id: tc.id, name: tc.name, args: tc.args || {}, used: false }))
      curAI = i
    } else if (m instanceof ToolMessage) {
      const tcid = (m as unknown as { tool_call_id?: string }).tool_call_id
      let hit = tcid !== undefined ? pending.find((p) => !p.used && p.id !== undefined && p.id === tcid) : undefined
      if (!hit) {
        const mname = (m as unknown as { name?: string }).name
        hit = mname ? pending.find((p) => !p.used && p.name === mname) : pending.find((p) => !p.used)
      }
      if (hit) {
        hit.used = true
        if (READ_TOOLS.has(hit.name)) {
          reads.push({ aiIndex: curAI, callIndex: hit.callIndex, name: hit.name, paths: extractReadPaths(hit.name, hit.args), msgIndex: i })
        }
      }
    }
  }

  // 判定 + 替换(替换处新 ToolMessage 实例,原数组不动)
  let nextMessages: BaseMessage[] | null = null
  const invalidated: InvalidationResult['invalidated'] = []
  for (const r of reads) {
    const original = messages[r.msgIndex]
    const content = String((original as unknown as { content?: unknown }).content ?? '')
    if (content.startsWith(STALE_PLACEHOLDER_MARK)) continue // 幂等:已占位不再二次处理
    const overlapping = effWrites.filter((w) => w.paths.some((wp) => r.paths.some((rp) => pathsOverlap(rp, wp))))
    if (!overlapping.length) continue
    let stale: boolean
    if (r.aiIndex !== lastAIIndex) stale = true // 更早轮的读:写必然在其后
    else if (maxParallel > 1) stale = true // 并发同批:顺序未定义
    else stale = overlapping.some((w) => (w.callIndex === undefined ? true : r.callIndex < w.callIndex)) // 串行:读在写前才失效
    if (!stale) continue
    const placeholder = buildPlaceholder(r.paths, r.name, overlapping, opts.round)
    if (!nextMessages) nextMessages = messages.slice()
    nextMessages[r.msgIndex] = new ToolMessage({
      tool_call_id: (original as unknown as { tool_call_id?: string }).tool_call_id ?? '',
      name: (original as unknown as { name?: string }).name,
      content: placeholder,
    })
    invalidated.push({ paths: r.paths, writtenPaths: overlapping.flatMap((w) => w.paths) })
  }
  return { messages: nextMessages ?? messages, invalidatedCount: invalidated.length, invalidated }
}
