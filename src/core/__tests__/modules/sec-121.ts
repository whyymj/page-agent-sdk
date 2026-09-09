/**
 * sec-121 —— Batch B 杂项单元:llmResolver 实例内层重试检测(B3)
 *
 * 背景(retry-visibility 边界,六路审计 flow #3):SDK 构造路径内层 maxRetries 恒 0(4.11.1);
 * 集成方预构造 BaseChatModel 实例内层缺省 6 次(LangChain AsyncCaller),与外层 withRetry 叠乘 =
 * 不可见重试放大。检测字段必须是 `caller.maxRetries`(直接读 `.maxRetries` 恒 undefined,曾按该
 * 口径写 = 死代码)。>0 → warn + observable LLM_INSTANCE_INNER_RETRIES(装配期与 setLlm 双入口)。
 */
import type { TestCtx } from './_ctx'
import { instanceInnerMaxRetries, flagInstanceInnerRetries } from '../../sdk/llmResolver'
import { createAgent, sanitizeDebugData, truncateLogValue, MAX_DEBUG_ENTRY_CHARS, MAX_DEBUG_STR_CHARS } from '../../harness/createAgent'
import type { Middleware } from '../../harness/middleware'
import { createConflictManager } from '../../sdk/conflictManager'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-121] llmResolver 预构造实例内层重试检测(caller.maxRetries)')

  const mkInstance = (extra: Record<string, unknown>) => ({ invoke: () => {}, stream: () => {}, ...extra })

  // ===== A. instanceInnerMaxRetries:读 caller.maxRetries(直接 .maxRetries = 死代码口径) =====
  {
    assert(instanceInnerMaxRetries(mkInstance({ caller: { maxRetries: 6 } })) === 6, '✓ caller.maxRetries=6 → 读到 6(LangChain 真实形态)')
    assert(instanceInnerMaxRetries(mkInstance({ caller: { maxRetries: 0 } })) === 0, '✓ caller.maxRetries=0 → 0(SDK 构造路径形态)')
    assert(instanceInnerMaxRetries(mkInstance({ maxRetries: 6 })) === undefined, '✓ 直接 .maxRetries(无 caller)→ undefined(死代码口径不误报)')
    assert(instanceInnerMaxRetries(mkInstance({})) === undefined, '✓ 无 caller 字段 → undefined')
    assert(instanceInnerMaxRetries({ invoke: () => {} }) === undefined, '✓ 非实例(缺 stream)→ undefined(isChatModel 前置)')
    assert(instanceInnerMaxRetries(null) === undefined && instanceInnerMaxRetries(undefined) === undefined, '✓ null/undefined → undefined')
    assert(instanceInnerMaxRetries(mkInstance({ caller: { maxRetries: -1 } })) === undefined, '✓ 负数(异常形态)→ undefined 不告警')
  }

  // ===== B. flagInstanceInnerRetries:>0 → emit observable;<0 形态/0/undefined → 零发射 =====
  {
    const captured: any[] = []
    const emit = (e: unknown) => captured.push(e)
    const n1 = flagInstanceInnerRetries(mkInstance({ caller: { maxRetries: 6 } }), { emit })
    assert(n1 === 6, '✓ flag 返回内层次数(6)')
    assert(captured.length === 1 && captured[0].code === 'LLM_INSTANCE_INNER_RETRIES' && captured[0].severity === 'observable', '✓ >0 → observable LLM_INSTANCE_INNER_RETRIES')
    assert(captured[0].context.maxRetries === 6, '✓ context 带 maxRetries=6')
    assert(String(captured[0].message).includes('maxRetries:0'), '✓ 文案含修复建议(构造时传 maxRetries:0)')
    flagInstanceInnerRetries(mkInstance({ caller: { maxRetries: 0 } }), { emit })
    flagInstanceInnerRetries(mkInstance({}), { emit })
    flagInstanceInnerRetries(null, { emit })
    assert(captured.length === 1, '✓ 0/读不到/null → 零发射(只 warn 不 observable 的口径:不触发的静默)')
    // emit 缺省(无事件通道的装配早期)→ 不抛
    let threw = false
    try { flagInstanceInnerRetries(mkInstance({ caller: { maxRetries: 6 } })) } catch { threw = true }
    assert(!threw, '✓ emit 缺省可用(只 console.warn)')
  }

  // ===== C. B5:早退路径也跑 afterAgent(try 边界上移至 runBeforeAgent 之后)=====
  {
    // C1:compressInput 抛错(错误照常传播,但 afterAgent 不再被跳过)
    const ran: string[] = []
    const boom: Middleware = {
      name: 'boom-compress',
      compressInput: async () => { throw new Error('compress 炸了') },
      afterAgent: async () => { ran.push('afterAgent') },
    }
    const agent = createAgent({ llm: { invoke: async () => ({}), stream: async function* () {} } as any, tools: [], middleware: [boom], maxToolRounds: 4, maxRetries: 0 })
    let threw = false
    try {
      await agent.stream([{ role: 'user', content: 'x', timestamp: Date.now() }], () => {}, undefined)
    } catch (e) {
      threw = String((e as Error)?.message ?? e).includes('compress 炸了')
    }
    assert(threw, '✓ compressInput 抛错照常向上传播(不被吞)')
    assert(ran.length === 1, `✓ 早退路径(compressInput 抛错)也跑 afterAgent(修前:跳过,invokeFocuses 等泄漏;实际 ${ran.length} 次)`)

    // C2:systemPrompt 超预算 fatal 早退(return '' 不抛)同样跑 afterAgent
    const ran2: string[] = []
    const quiet: Middleware = { name: 'quiet', afterAgent: async () => { ran2.push('afterAgent') } }
    const agent2 = createAgent({ llm: { invoke: async () => ({}), stream: async function* () {} } as any, systemPrompt: 'x'.repeat(60_000), tools: [], middleware: [quiet], maxToolRounds: 4, maxRetries: 0, contextWindow: 32_768 })
    let final = 'SENTINEL'
    let sawFatal = false
    await agent2.stream([{ role: 'user', content: 'x', timestamp: Date.now() }], (e: any) => { if (e.type === 'done') final = e.content; if (e.type === 'error' && e.code === 'SYSTEM_PROMPT_OVER_BUDGET') sawFatal = true }, undefined)
    assert(sawFatal && final === '', '✓ systemPrompt 超预算 → fatal 早退(return 空串)照常')
    assert(ran2.length === 1, `✓ 早退路径(OVER_BUDGET return)也跑 afterAgent(修前:跳过;实际 ${ran2.length} 次)`)

    // C3:正常完成路径 afterAgent 恰好一次(不因 try 上移双跑)
    const ran3: string[] = []
    const normal: Middleware = { name: 'normal', afterAgent: async () => { ran3.push('afterAgent') } }
    const agent3 = createAgent({ llm: { invoke: async () => ({ content: '完成' }), stream: async function* () { yield { event: 'text', data: '完成' } as any } } as any, tools: [], middleware: [normal], maxToolRounds: 4, maxRetries: 0 })
    await agent3.stream([{ role: 'user', content: 'x', timestamp: Date.now() }], () => {}, undefined).catch(() => {})
    assert(ran3.length === 1, `✓ 正常路径 afterAgent 恰好一次(try 上移不引入双跑;实际 ${ran3.length} 次)`)
  }

  // ===== D. B6:并行双冲突自动收口 prev 留痕(emit observable + debugLogs)=====
  {
    const events: any[] = []
    const logs: Array<{ timestamp: number; type: string; data: Record<string, unknown> }> = []
    const mgr = createConflictManager(() => (e: any) => events.push(e), undefined, () => logs)
    const mkInfo = (v: unknown) => ({ op: 'set' as const, agentValue: v, currentValue: 'ext', currentHash: 'h2', expectedHash: 'h1', snapshotId: 0 })
    const p1 = mgr.set(mkInfo('w1'))
    const p2 = mgr.set(mkInfo('w2')) // 并行第二冲突:set 内自动把 #1 按 keep_external 收口
    const r1 = await p1
    assert(r1.action === 'keep_external', '✓ 双冲突:前一冲突被自动 keep_external 收口(防 resolve 丢失,既有语义不变)')
    const obs = events.find((e) => e.type === 'error' && e.code === 'CONFLICT_PREV_AUTO_RESOLVED')
    assert(!!obs && obs.severity === 'observable', '✓ 双冲突:自动收口 prev → observable CONFLICT_PREV_AUTO_RESOLVED(修前零痕迹)')
    assert(obs?.context?.supersededConflictId === 1 && obs?.context?.newConflictId === 2, '✓ observable context 带前/新冲突 id')
    const lg = logs.find((l) => l.data?.stage === 'conflict_prev_auto_resolved')
    assert(!!lg && lg.type === 'middleware', '✓ debugLogs 留痕(stage=conflict_prev_auto_resolved;audit 通道不可达的替代通道)')
    // 收口语义不破坏:第二个冲突仍正常挂起等人工
    assert(mgr.pendingConflict.value?.id === 2, '✓ 新冲突照常挂起(pendingConflict=#2)')
    mgr.resolve('overwrite')
    assert((await p2).action === 'overwrite', '✓ 人工裁决第二冲突照常生效')
    // 单冲突路径零新痕迹:首冲突不被误报
    const events2: any[] = []
    const logs2: Array<{ timestamp: number; type: string; data: Record<string, unknown> }> = []
    const mgr2 = createConflictManager(() => (e: any) => events2.push(e), undefined, () => logs2)
    const q1 = mgr2.set(mkInfo('a'))
    assert(!events2.some((e) => e.code === 'CONFLICT_PREV_AUTO_RESOLVED') && logs2.length === 0, '✓ 单冲突(无 prev)→ 零新痕迹(豁免不扩大)')
    mgr2.resolve('keep_external')
    await q1
  }

  // ===== E. B7:debugLogs 单条体积守卫(sanitizeDebugData/truncateLogValue)=====
  {
    // 字符串级:超 1200 截断保前缀 1000 + 标记;短字符串原样
    const long = 'x'.repeat(5000)
    const t = truncateLogValue(long) as string
    assert(t.length < 1100 && t.startsWith('xxxx') && t.includes('截断'), `✓ 超长字符串 → 保前缀 + 截断标记(${t.length} 字符)`)
    assert(truncateLogValue('短字符串') === '短字符串' && truncateLogValue(42) === 42 && truncateLogValue(null) === null, '✓ 短字符串/数字/null 原样')
    // args 大值占位形态:对象内嵌超长字符串(整页 HTML write args 场景)
    const args = { patch: { jsonPath: 'components.0.code', value: '<section>'.repeat(600) } }
    const st = sanitizeDebugData({ round: 1, name: 'write', args }) as { args: { patch: { value: string } } }
    assert(String(st.args.patch.value).includes('截断') && String(st.args.patch.value).length < 1100, '✓ args 大值 → 截断占位(write 整页 HTML 场景单条不再 MB 级)')
    assert(st.args.patch.jsonPath === 'components.0.code', '✓ 同对象短字段原样保留(结构不破坏)')
    // 整条上限:海量小字段 → __truncated 整体前缀
    const many: Record<string, string> = {}
    for (let i = 0; i < 3000; i++) many[`k${i}`] = `v${i}`
    const big = sanitizeDebugData(many) as { __truncated?: string }
    assert(typeof big.__truncated === 'string' && big.__truncated.length <= MAX_DEBUG_ENTRY_CHARS + 200, `✓ 海量字段超整条上限 → __truncated 整体截断(${big.__truncated?.length} 字符)`)
    // 环对象 → 不抛 + [Circular]
    const cyc: any = { a: 1 }
    cyc.self = cyc
    let threw = false
    let out: any
    try { out = sanitizeDebugData(cyc) } catch { threw = true }
    assert(!threw && JSON.stringify(out).includes('[Circular]'), '✓ 环对象 → 不抛,[Circular] 标记')
    // 单条字符串 data(超 8000)
    const huge = 'y'.repeat(20_000)
    const hs = sanitizeDebugData(huge) as string
    assert(hs.length <= MAX_DEBUG_ENTRY_CHARS + 100 && hs.includes('截断'), `✓ 裸字符串 data 超上限截断(${hs.length})`)
    // MAX_DEBUG_STR_CHARS 契约
    assert(MAX_DEBUG_STR_CHARS === 1200 && MAX_DEBUG_ENTRY_CHARS === 8000, '✓ 常量契约(1200/8000)')
  }
}
