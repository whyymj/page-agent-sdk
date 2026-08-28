/**
 * 欠委派 nudge(section-orchestrator Phase 0b)—— 复杂任务「该委派不委派、独自硬干」的行为面补口
 *
 * 后果链:主 agent 小步 grind(每轮 8-12 组件连写)→ 上下文膨胀 → 压缩 → 指令衰减 → 轮次耗尽 →
 * 诚实但部分完成;且无失败隔离、无并行。「过度委派」已修(3.46 多方案先文本),欠委派零机制 —— 本中间件补另一半。
 *
 * 形态:**advisory 不阻断** —— invoke 内累计写触达(逐次 write 度量后 union 组件级 scopes;整体 set 特判取
 * count,其 scopes 粒度是顶层数组名不可并)超阈(默认 12)且本 invoke 零委派 → 随下一次成功写结果**尾附一次性**
 * 提示(不改结果语义、不阻断;写成功判定与 writeGate/stale-read 同口径)。裁决归 LLM:文案带「单干同样是一等路径」
 * 与回退条款(同一委派失败 2 次 → 自己做,防无限重试烧预算)。
 *
 * 阈值口径:invoke 内累计(单次调用量纲恒低,「小步 grind」主形态必须累计才能命中)。零新配置:阈值常量
 * (initialPage 双臂试点标定前取保守初值 12;数据裁决只升不降)。debugLogs stage:'delegate_nudge' 留痕。
 */
import type { Middleware, ToolCallContext, ToolExecResult } from './middleware'
import { getByPath } from '../tools/jsonUtils'
import { EXCLUDED_WRITE_TOOLS } from './readInvalidation'

/** 规模度量结果(原 bulk-change-guard 量纲;bulkGuard 已于 4.1.0 移除,本函数为 delegateNudge 依赖 + 公共导出保留) */
export interface WriteScaleResult {
  /** 触达的现有组件节点数(执行前 bind 实测;新增内容不计) */
  count: number
  /** 组件级路径首段去重(报告用) */
  scopes: string[]
  /** 写形态分类 */
  kind: 'patches' | 'del' | 'subtree-set' | 'whole-set' | 'other'
}

/**
 * 度量单次写调用触达的现有组件节点数(纯函数,可单测;原 bulk-change-guard 量纲,现为欠委派 nudge 复用):
 * - write({patches[]}) / write({patch}):distinct 组件级路径首段(components.N → components.N;
 *   同组件 8 条 patch = 1);后段路径截到「数组索引」层(组件粒度)
 * - write({del:true, patch:{jsonPath}}):同口径
 * - write({value})(整体 set,merge 语义触碰全部):现有组件节点总数(全量白名单模式按顶层声明数组计)
 * 新增内容不计破坏面:路径在 bind 不存在(append 到数组/新键 set)→ 不计。
 */
export function measureWriteScale(args: unknown, getBind: () => unknown): WriteScaleResult {
  const a = (args ?? {}) as Record<string, any>
  const bind = getBind()
  const seg = (p: string): string => {
    // 组件级路径首段:到第二个数组索引或第一个字段(如 components.5.props.x → components.5;
    // components.5 → components.5;title → title)。无索引的顶层 key 原样。
    const parts = p.split('.')
    const out: string[] = []
    let idxSeen = 0
    for (const s of parts) {
      out.push(s)
      if (/^\d+$/.test(s)) {
        idxSeen++
        if (idxSeen >= 1) break  // 首个数组索引即组件粒度边界(editor: components.N)
      }
    }
    return out.join('.')
  }
  const paths: string[] = []
  let kind: WriteScaleResult['kind'] = 'other'
  if (a.dryRun === true) return { count: 0, scopes: [], kind: 'other' }  // 只读预检不度量
  if (a.del === true) {
    kind = 'del'
    if (typeof a.patch?.jsonPath === 'string' && a.patch.jsonPath) paths.push(a.patch.jsonPath)
  } else if (Array.isArray(a.patches)) {
    kind = 'patches'
    for (const p of a.patches) { if (p && typeof p.jsonPath === 'string' && p.jsonPath) paths.push(p.jsonPath) }
  } else if (a.patch && typeof a.patch.jsonPath === 'string' && a.patch.jsonPath) {
    kind = 'subtree-set'
    paths.push(a.patch.jsonPath)
  } else if (a.value !== undefined) {
    // 整体 set(merge 语义触碰全部现有组件):按 bind 顶层组件数组实测计数
    kind = 'whole-set'
    if (bind && typeof bind === 'object') {
      const scopeSet = new Set<string>()
      let total = 0
      for (const k of Object.keys(bind)) {
        const v = (bind as Record<string, unknown>)[k]
        if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object')) {
          total += v.length
          scopeSet.add(k)
        }
      }
      return { count: total, scopes: [...scopeSet], kind }
    }
    return { count: 0, scopes: [], kind }
  } else {
    return { count: 0, scopes: [], kind }
  }
  // distinct 组件级首段 + 「现有」过滤(新增路径 bind 不存在 → 不计破坏面)
  const scopeSet = new Set<string>()
  for (const p of paths) {
    const head = seg(p)
    // head 在 bind 上可解析且非 undefined → 现有节点;undefined → 新增内容不计
    if (getByPath(bind, head) !== undefined) scopeSet.add(head)
  }
  return { count: scopeSet.size, scopes: [...scopeSet], kind }
}

export interface DelegateNudgeOptions {
  /** 读取当前 bind(度量整体 set 触达与现有组件基数) */
  getBind: () => unknown
  /** invoke 内累计触达现有组件数阈值(默认 DELEGATE_NUDGE_THRESHOLD = 12) */
  threshold?: number
  /** 工具面访问器(A2 度量口径统一,4.9.2):按 writeCapable 标注(args-aware fn/bool)判定写工具,
   *  覆盖 eval_script(transform)子树 grind;缺省退化回「仅 write」现行为(存量构造零变化)。
   *  类型收窄到最小需求面(name + writeCapable 任意属性),StructuredToolInterface 等异构工具数组可直接喂入 */
  getTools?: () => Array<Record<string, unknown> & { name: string }> | undefined
}

/** 欠委派阈值常量(经验初值 12;initialPage 双臂试点标定后调整,只升不降) */
export const DELEGATE_NUDGE_THRESHOLD = 12

/** 委派类工具(任一出现即算「已委派」,nudge 抑制) */
function isDelegationTool(name: string): boolean {
  return name === 'spawn_agent' || name === 'spawn_agents' || name.startsWith('use_')
}

export function createDelegateNudgeMiddleware(opts: DelegateNudgeOptions): Middleware {
  const threshold = opts.threshold ?? DELEGATE_NUDGE_THRESHOLD
  // invoke 级状态(beforeAgent 重置):累计触达组件级 scopes / 整体 set 计数 / 已委派 / 已 nudge
  let scopes = new Set<string>()
  let wholeSetCount = 0
  let delegated = false
  let nudged = false

  // 编排段注入的数据规模实测(与 nudge 同阈值同源):顶层「数组元素全为对象」的数组元素总数。
  // getBind 经闭包读 live bind,setData 替换后自动跟随
  const countTopArrayItems = (): number => {
    const bind = opts.getBind()
    if (!bind || typeof bind !== 'object') return 0
    let total = 0
    for (const k of Object.keys(bind)) {
      const v = (bind as Record<string, unknown>)[k]
      if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object')) total += v.length
    }
    return total
  }

  const mw: Middleware = {
    name: 'delegate-nudge',
    beforeAgent: () => {
      scopes = new Set()
      wholeSetCount = 0
      delegated = false
      nudged = false
    },
    // section-orchestrator Phase 1:编排段数据规模动态注入 —— 不走 htmlOrchestratorPrompt 静态装配
    // (其条件「存在 codeAsset 子 agent」对纯 JSON 场景既过宽又过窄);大数据才注(小数据零注入零税)。
    // 段规格四要素为 html 五要点的新造平移(非复用结论),真 LLM 验证登记 deferred
    augmentPrompt: (): string => {
      const total = countTopArrayItems()
      if (total < threshold) return ''
      return [
        '## 大任务分段编排(数据规模自适应注入)',
        `当前主数据约 ${total} 个数组元素,大改造类任务(如整体换肤/批量改字段)适合分段并行,按三步走:`,
        '1. **规划**:先 write_todos 列分段计划,每段 8-12 个元素,段与段不相交(并行写互不冲突靠段边界保证);',
        '2. **分段委派**:每段一个 spawn_agent 并行发出,writablePaths 传段所在数组(如 ["components"]),段边界在 task 里写明;task 必须含段规格四要素:① jsonPath 范围(段内哪些元素)② 改动目标(要什么效果)③ 共享 tokens(主题色/文案风格等跨段一致要求)④ 验收标准(怎么算改对);',
        '3. **验收收口**:全部段返回后抽查跨段一致性(共享 tokens 是否统一);失败段重委派一次,仍失败(同一委派失败 2 次)就自己补做。',
        '注意:纯 JSON 委派不经过组件锁,段不相交由你的分段规划保证,越段写冲突由乐观锁兜底;中小任务或剩余量小时直接自己做,不必为分段而分段。',
      ].join('\n')
    },
    wrapToolCall: async (
      ctx: ToolCallContext,
      next: (ctx: ToolCallContext) => Promise<ToolExecResult>,
    ): Promise<ToolExecResult> => {
      if (isDelegationTool(ctx.name)) delegated = true
      // A2 度量口径统一(4.9.2,团队评估缩小范围):原「只认 ctx.name==='write'」漏 eval_script(transform)
      // 子树 grind。改 writeCapable 标注门(单一真相源,与 writeGate/createAgent/componentLock 同口径)+
      // resource_update/delete 显式排除({path,value} args 会 whole-set 分支单次误爆,EXCLUDED 单源共用)+
      // 无标注工具名 'write' 兜底(镜像 createAgent WRITE_TOOL_NAMES 兜底,奇异自定义名不漏计)。
      // draft_commit/restore_data 显式豁免:单次原子大操作非 grind 签名,且 args({draftId}/{id})无触达面可度量。
      if (EXCLUDED_WRITE_TOOLS.has(ctx.name)) return next(ctx)
      let isWriteTool = ctx.name === 'write'
      if (opts.getTools) {
        const tool = opts.getTools()?.find((t) => t.name === ctx.name)
        if (tool && 'writeCapable' in tool) {
          const wc = (tool as { writeCapable?: unknown }).writeCapable
          isWriteTool = typeof wc === 'function' ? !!wc((ctx.args ?? {}) as Record<string, unknown>) : wc === true
        }
      }
      if (!isWriteTool) return next(ctx)
      const res = await next(ctx)
      const a = (ctx.args ?? {}) as Record<string, unknown>
      if (a.dryRun === true) return res  // 预检不度量
      const content = String((res as { content?: unknown }).content ?? '')
      // 写成功口径对齐 writeGate(stale-read Phase 0):ERROR: 前缀 / keep_external「未写入」/ no-op「无需删除」
      // 都不是写 —— 冲突挂起保留外部值时数据零变化,不该计入 nudge 触达度量(团队审查 2026-08-24)
      const ok = (res as { status?: string }).status !== 'error' && !content.startsWith('ERROR:')
        && !content.includes('未写入') && !content.includes('无需删除')
      if (!ok) return res
      if (delegated || nudged) return res  // 已委派抑制 / 一次性
      // eval transform 子树计量(泛化规则,不点名工具):标注判写 && args 顶层 string jsonPath 且无 write 形态字段
      // → 按子树 set 形态喂度量(seg 组件粒度切分复用;无 jsonPath 的根 transform 计 0 —— 脚本返回值在闭包内不可量)
      const measureArgs = typeof a.jsonPath === 'string' && a.jsonPath && a.patch === undefined && a.patches === undefined
        && a.value === undefined && a.del === undefined
        ? { patch: { op: 'set', jsonPath: a.jsonPath } }
        : ctx.args
      const m = measureWriteScale(measureArgs, opts.getBind)
      for (const s of m.scopes) scopes.add(s)
      if (m.kind === 'whole-set') wholeSetCount += m.count  // 整体 set:scopes 粒度是顶层数组名,按 count 并入
      const total = scopes.size + wholeSetCount
      if (total < threshold) return res
      nudged = true
      // 留痕:logSink 条目形态与 debugLogs 一致(type + data.stage;子栈转发带 source 前缀)
      ctx.logSink?.({ type: 'middleware', data: { stage: 'delegate_nudge', total, scopes: scopes.size, wholeSet: wholeSetCount } })
      return {
        ...res,
        content: `${content}\n\n💡 [委派提示] 本轮你已累计触达 ${total} 个组件的写入且尚未委派。若剩余同类任务仍多,可分段并行委派:多个 spawn_agent 各带 writablePaths=段前缀,task 写明改动目标/共享要求/验收标准(子 agent 过程隔离,不占你的轮次与上下文);同一委派失败 2 次就自己做,单干同样是一等路径。由你按剩余量裁决,不需要委派时忽略本提示。`,
      }
    },
  }
  return mw
}
