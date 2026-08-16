/**
 * 组件锁(同组件单委派互斥;parallel-subagent-delegation 第二批)
 *
 * 背景:并行委派(maxParallelTools>1)下,多个 use_<id> 可同轮并发;同一组件同时只允许
 * 一个子 agent 在途修改(否则 checkout/commit 工作副本互相覆盖)。锁按**组件名**粒度:
 * 委派入口 acquire → 子 agent 跑 → finally release;主 agent 写检查经 locked() 视图 + 索引前缀拦截。
 *
 * 语义(design §1,评审修订):
 * - **非阻塞无排队**:acquire 任一组件被占 → 立即失败(已取得的先释放,不留半套锁),
 *   委派入口立即回灌 COMPONENT_BUSY 让主 agent 换顺序/下轮重试 —— 不做 waiter 队列
 *   (排队调用占 runPool 并发槽位干等,浪费并发度)
 * - release 幂等(finally 兜底重复调安全);abort/异常路径同样经 release
 * 纯内存会话级状态,不持久化;全部纯函数可白盒自测。
 */
import type { Middleware } from '../harness/middleware'
import type { StructuredToolInterface } from '@langchain/core/tools'

/** 组件锁接口(acquire 多组件原子:任一被占全失败且已取得的释放) */
export interface ComponentLock {
  /** 尝试获取:全部成功返回 {ok:true, release};任一组件已被锁 → {ok:false, heldBy}(占用者 taskId) */
  acquire(
    components: string[],
    owner: string,
  ): Promise<{ ok: true; release: () => void } | { ok: false; heldBy: string }>
  /** 释放指定组件(仅 owner 匹配才释放;幂等;不存在的静默忽略) */
  release(components: string[], owner: string): void
  /** 非阻塞视图:当前被锁组件名 → 占用者(委派 taskId);供主 agent 写检查 + inspect */
  locked(): Record<string, string>
}

/** 创建组件锁(内部 Map<componentName, { owner }>) */
export function createComponentLock(): ComponentLock {
  const held = new Map<string, { owner: string }>()
  return {
    async acquire(components, owner) {
      // 先全量查冲突(不动状态):任一被占 → 立即失败,已取得零个也无需回滚
      for (const c of components) {
        const cur = held.get(c)
        if (cur && cur.owner !== owner) return { ok: false, heldBy: cur.owner }
      }
      // 同 owner 重复 acquire(极小概率 taskId 撞名)视为成功幂等;按序加锁
      for (const c of components) held.set(c, { owner })
      let released = false
      return {
        ok: true,
        release: () => {
          if (released) return
          released = true
          for (const c of components) {
            const cur = held.get(c)
            if (cur && cur.owner === owner) held.delete(c)
          }
        },
      }
    },
    release(components, owner) {
      for (const c of components) {
        const cur = held.get(c)
        if (cur && cur.owner === owner) held.delete(c)
      }
    },
    locked() {
      const out: Record<string, string> = {}
      for (const [c, v] of held) out[c] = v.owner
      return out
    },
  }
}

// ===== 目标组件解析(design §2)=====

/** 解析结果三档:explicit(显式声明)/ text-match(task 文本唯一命中)/ none(不锁) */
export interface ResolveComponentsResult {
  names: string[]
  via: 'explicit' | 'text-match' | 'none'
}

/**
 * 从委派参数解析本次委派的目标组件名(决定要锁哪些):
 * - `args.components` 显式声明 → 原样用,**过滤到 knownNames 内**(防 LLM 编造名字把锁空转;
 *   全部被过滤掉则降级 text-match)
 * - 未声明 → task 文本匹配 knownNames(组件名作为整词出现);**唯一命中**才锁
 *   (0 或 ≥2 命中 → none 不锁,宁漏不误:漏锁退化与现状同,误锁阻塞并行)
 */
export function resolveTargetComponents(
  args: { components?: string[]; task: string },
  knownNames: string[],
): ResolveComponentsResult {
  if (Array.isArray(args.components) && args.components.length) {
    const known = new Set(knownNames)
    const filtered = [...new Set(args.components.filter((c) => typeof c === 'string' && c && known.has(c)))]
    if (filtered.length) return { names: filtered, via: 'explicit' }
    // 显式声明但全为编造名 → 降级 text-match(不空转锁,也不硬拒委派)
  }
  // 整词匹配:组件名两侧非 [\w-] 字符(防 'nav' 命中 'navbar')
  const hits = knownNames.filter((n) => {
    if (!n) return false
    const re = new RegExp(`(^|[^\\w-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\w-]|$)`)
    return re.test(args.task)
  })
  if (hits.length === 1) return { names: [hits[0]], via: 'text-match' }
  return { names: [], via: 'none' }
}

/**
 * 锁名 → jsonPath 索引前缀(**检查时实时解析**,防索引位移陈旧):
 * 扫 bind 的 writablePaths 数组,组件 name 精确匹配(重名组件全部命中,守卫从宽)→ `${wp}.${i}`。
 * 主 agent 写检查用:写目标命中任一前缀子树(=== 或 startsWith(p + '.'))→ COMPONENT_LOCKED。
 */
export function lockedIndexPaths(
  bind: unknown,
  writablePaths: string[],
  lockedNames: string[],
): string[] {
  const want = new Set(lockedNames)
  if (!want.size || !bind || typeof bind !== 'object') return []
  const out: string[] = []
  for (const wp of writablePaths) {
    const arr = getByPathSafe(bind, wp)
    if (!Array.isArray(arr)) continue
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i]
      if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).name === 'string'
        && want.has((item as Record<string, unknown>).name as string)) {
        out.push(`${wp}.${i}`)
      }
    }
  }
  return out
}

/** 点号路径取值(容错:非对象/路径不存在返 undefined;与 jsonUtils.getByPath 同语义的本地轻量版) */
function getByPathSafe(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const seg of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[seg]
  }
  return cur
}

/** 写目标 jsonPath 是否命中任一锁前缀子树(=== 前缀 或 以 `前缀.` 开头) */
export function hitsLockedPath(jsonPath: string, lockedPrefixes: string[]): boolean {
  return lockedPrefixes.some((p) => jsonPath === p || jsonPath.startsWith(p + '.'))
}

/**
 * 收集「已存在代码组件的 codeField 路径」(m4-real-llm 实测驱动,主写恒守卫用)。
 * 判定同 code-asset 惯例:该路径有 string 即代码组件(支持嵌套 codeField 如 props.html_code);
 * 新元素(数组越界项)不产出路径 → 新建组件整体 set 不受恒守卫(仍走提示词纪律)。
 */
export function codeFieldIndexPaths(bind: unknown, specs: Array<{ writablePaths: string[]; codeField: string }>): string[] {
  const out: string[] = []
  for (const { writablePaths, codeField } of specs) {
    for (const wp of writablePaths) {
      const arr = getByPathSafe(bind, wp)
      if (!Array.isArray(arr)) continue
      for (let i = 0; i < arr.length; i++) {
        const item = arr[i]
        if (item && typeof item === 'object' && typeof getByPathSafe(item, codeField) === 'string') {
          out.push(`${wp}.${i}.${codeField}`)
        }
      }
    }
  }
  return out
}

// ===== 主 agent 写检查中间件(Q3b:与 focus strict 同一拦截模式)=====

/** 提取写工具 args 的全部 jsonPath(write 高层嵌套:patch.jsonPath / patches[].jsonPath 同 focus extractScopes) */
function extractWriteScopes(args: unknown): string[] {
  const a = (args ?? {}) as Record<string, any>
  const scopes = new Set<string>()
  if (typeof a.jsonPath === 'string' && a.jsonPath) scopes.add(a.jsonPath)
  if (typeof a.path === 'string' && a.path) scopes.add(a.path)
  if (a.patch && typeof a.patch.jsonPath === 'string' && a.patch.jsonPath) scopes.add(a.patch.jsonPath)
  if (Array.isArray(a.patches)) {
    for (const p of a.patches) { if (p && typeof p.jsonPath === 'string' && p.jsonPath) scopes.add(p.jsonPath) }
  }
  return [...scopes]
}

export interface ComponentWriteGuardOptions {
  /** 取当前主数据 bind(索引前缀实时解析,防索引位移陈旧) */
  getBind: () => unknown
  /** codeAsset 可写路径前缀(锁名 → 索引前缀的扫描范围) */
  writablePaths: string[]
  /** 锁视图 getter(() => lock.locked()) */
  getLocked: () => Record<string, string>
  /** 锁事件留痕(主 agent 写被拒时;经 logSink/debugLogs) */
  onReject?: (info: { paths: string[]; lockedPrefixes: string[]; owner: string }) => void
  /** 全部工具列表(A3 按标注判定写能力) */
  tools?: StructuredToolInterface[]
  /**
   * 主写恒守卫的 codeField 路径 getter(m4-real-llm 实测驱动):html code-asset 模式下主 agent 恒不可直写
   * 已存在组件的代码字段。flash 实测 3 次无视提示词禁令(read-only 提示回流后仍读后写覆盖人工 keep_external 值),
   * 机制化恒拒 + 回灌 CUSTOM_CODE_DELEGATION 引导委派;不传/返回空 = 关闭(现状零变化)。
   * 边界同在途锁:整体 set(无 jsonPath)与新建元素不拦(diff 成本高,留提示词纪律)。
   */
  getCodeFieldPaths?: () => string[]
}

/**
 * 主 agent 写检查中间件(Q3b):写目标 jsonPath 命中任一被锁组件索引前缀 → COMPONENT_LOCKED
 * recoverable 回灌(委派在途期间人工别经 agent 通道改同组件;人工直改 bind 不经此层,由 commit 期
 * hash 检测 keep_external 兜底)。边界:整体 set(无 jsonPath)且有在途锁 → 拒(merge 语义触碰全部);
 * dryRun 不拦(试运行无写入)。只装主 agent 栈(子 agent 有自己的栈与 path guard)。
 * A3:改按 writeCapable 标注判定,eval_script 条件写判 mode==='transform',restore_data 锁内拒。
 */
export function createComponentWriteGuardMiddleware(opts: ComponentWriteGuardOptions): Middleware {
  return {
    name: 'component-write-guard',
    wrapToolCall: async (ctx, next) => {
      // A3 按标注判定写能力
      const tool = opts.tools?.find((t) => t.name === ctx.name)
      const isWrite = tool && ('writeCapable' in (tool as any)) ? (
        typeof (tool as any).writeCapable === 'function'
          ? (tool as any).writeCapable(ctx.args)
          : (tool as any).writeCapable === true
      ) : false
      if (!isWrite) return next(ctx)

      const args = (ctx.args ?? {}) as Record<string, unknown>
      if (args.dryRun === true) return next(ctx)  // 试运行无写入,不拦

      // A3 restore_data 锁内拒(回退会覆盖被锁组件)
      if (ctx.name === 'restore_data') {
        const locked = opts.getLocked()
        const names = Object.keys(locked)
        if (names.length) {
          opts.onReject?.({ paths: ['(快照回退)'], lockedPrefixes: [], owner: names.join(',') })
          return {
            content: `COMPONENT_LOCKED · 组件 [${names.join(', ')}] 正在被修改,快照回退会覆盖它们。请等本轮委派完成后再回退,或用增量操作只回退未锁定组件。`,
            status: 'error' as const,
          }
        }
      }

      const locked = opts.getLocked()
      const names = Object.keys(locked)
      // 主写恒守卫(m4-real-llm):已存在代码组件的 code 字段恒拒(改代码必经委派 → vfs 工作副本 + verify 门禁)。
      // 独立于在途锁跑(无在途锁也要拦);与锁共用 extractWriteScopes
      const codePaths = opts.getCodeFieldPaths?.() ?? []
      const scopes = extractWriteScopes(args)
      if (codePaths.length) {
        const hitCode = scopes.filter((p) => hitsLockedPath(p, codePaths))
        if (hitCode.length) {
          opts.onReject?.({ paths: hitCode, lockedPrefixes: codePaths, owner: '(codeField 恒守卫)' })
          return {
            content: `CUSTOM_CODE_DELEGATION · 写目标 [${hitCode.join(', ')}] 是代码组件的代码字段,主 agent 不可直接写(会绕过 vfs 工作副本与格式校验,且可能覆盖外部/人工修改)。修改该组件须委派代码组件子 agent(use_html / use_<id>);若此前委派结果提示 keep_external(外部修改已保留),先向用户说明并确认后再委派,勿自行改写。`,
            status: 'error' as const,
          }
        }
      }
      if (!names.length) return next(ctx)
      const prefixes = lockedIndexPaths(opts.getBind(), opts.writablePaths, names)
      if (!prefixes.length) return next(ctx)  // 锁的组件已不在 data(如人工删除)→ 名字解析不出前缀,放行(写会自然按 schema 处理)
      if (!scopes.length) {
        // 整体 set(merge 语义触碰全部组件)且有在途锁 → 拒
        opts.onReject?.({ paths: ['(整体 set)'], lockedPrefixes: prefixes, owner: names.join(',') })
        return {
          content: `COMPONENT_LOCKED · 组件 [${names.join(', ')}] 正在被子 agent 修改,整体写入会触碰它们。请改用增量 patch(write({patch:{jsonPath,...}}))只写未锁定组件,或等委派结束后再整体操作。`,
          status: 'error' as const,
        }
      }
      const hit = scopes.filter((p) => hitsLockedPath(p, prefixes))
      if (hit.length) {
        opts.onReject?.({ paths: hit, lockedPrefixes: prefixes, owner: names.join(',') })
        return {
          content: `COMPONENT_LOCKED · 写目标 [${hit.join(', ')}] 命中的组件正在被子 agent 修改(委派结束后自动解锁)。请先做其他组件/其他操作,稍后再写该组件;若需改它,等本轮委派完成后再试。`,
          status: 'error' as const,
        }
      }
      return next(ctx)
    },
  }
}
