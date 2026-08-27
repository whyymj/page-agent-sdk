/**
 * sec-114:llm-summary-cache-session-epoch(team-audit-hardening P1#2)
 * LLM 摘要前缀缓存跨会话泄漏:llmCache 闭包与 SDK 实例同生命周期(单例非 per-session),
 * switchSession/resetSession 重置清单漏 summarization → 会话 A 的 LLM 摘要拼进会话 B 的【对话历史摘要】。
 * 修复三层:
 *   ① reset()(epoch bump + 清 llmCache)—— 只清缓存不挡在飞回调 = 假修(reset 后 llmCache=null,
 *      单调守卫恒过,在飞 .then 落缓存复活泄漏);
 *   ② fireBackgroundLlmSummary 捕获当次 epoch,.then 不匹配丢弃;
 *   ③ in-flight 防重入按 epoch 隔离(旧代在飞不阻塞新会话 fire —— 伴生缺陷:B 自身后台摘要被 llmInFlight 吞)。
 * llmInFlight 不手工清(交 .finally 自然回落,手工清会双重 fire)。
 */
import { useContextManager } from '../../composables/useContextManager'
import type { AgentMessage } from '../../types'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[llm-summary-cache-session-epoch · 跨会话泄漏]')

  const mk = (role: 'user' | 'assistant', content: string): AgentMessage => ({ role, content, timestamp: Date.now() })
  const mkRounds = (n: number, tag: string): AgentMessage[] => {
    const msgs: AgentMessage[] = []
    for (let i = 1; i <= n; i++) msgs.push(mk('user', `${tag}问题${i}`), mk('assistant', `${tag}回答${i}`))
    return msgs
  }
  const flush = () => new Promise((r) => setTimeout(r, 10)) // 等 .then/.finally 微任务落定

  // ===== 场景 1:两会话压缩互不污染(reset 后 B 不命中 A 缓存) =====
  {
    const resolvers: ((v: string) => void)[] = []
    let llmCalls = 0
    const mgr = useContextManager({
      windowRounds: 2, summaryThresholdRounds: 3, enableLLMSummary: true, enableRecall: false,
      llmInvoke: () => { llmCalls++; return new Promise<string>((res) => { resolvers.push(res) }) },
    })
    // 会话 A:首压 fire + 后台摘要落缓存
    const rA1 = await mgr.compress(mkRounds(5, 'A-'))
    assert(rA1.stats.strategy.includes('llm_background'), '✓ A 首压:索引模板 + 后台 fire(前置既有行为)')
    resolvers[0]!('ALPHA-SECRET 会话A的机密摘要')
    await flush()
    const rA2 = await mgr.compress(mkRounds(5, 'A-'))
    assert(rA2.messages[0].content.includes('ALPHA-SECRET'), '✓ A 同会话缓存命中(前置既有行为,命中通道本身正常)')

    // 切会话:reset() 存在 + 清缓存 → B 首压不得前缀命中 A
    assert(typeof mgr.reset === 'function', '✓ reset() 暴露在 context manager 返回面(修前:无 reset 通道)')
    mgr.reset?.()
    const rB1 = await mgr.compress(mkRounds(5, 'B-'))
    assert(!rB1.messages[0].content.includes('ALPHA-SECRET'), '✓ 两会话互不污染:reset 后 B 首压不含 A 的 LLM 摘要(修前:B 前缀命中拼进 A 机密内容)')
    assert(rB1.stats.strategy.includes('llm_background'), `✓ reset 后 B 回到首压形态(索引模板+新 fire;修前:llm_summary(prefix) 命中 A 缓存;实际:${rB1.stats.strategy})`)
    // B 自身后台摘要落缓存(不被 A 的在途/已回落状态吞)
    assert(llmCalls === 2, `✓ reset 后 B 触发自己的后台 fire(修前伴生缺陷:llmInFlight 吞掉 B 的 fire;实际 llmCalls=${llmCalls})`)
    resolvers[1]?.('BETA 会话B的正常摘要')
    await flush()
    const rB2 = await mgr.compress(mkRounds(5, 'B-'))
    assert(rB2.messages[0].content.includes('BETA') && !rB2.messages[0].content.includes('ALPHA'), '✓ B 自身后台摘要落缓存(内容纯 B)')
  }

  // ===== 场景 2:飞行中切换丢弃(epoch —— 锁定「只 reset 不 epoch = 假修」) =====
  {
    const resolvers: ((v: string) => void)[] = []
    const mgr = useContextManager({
      windowRounds: 2, summaryThresholdRounds: 3, enableLLMSummary: true, enableRecall: false,
      llmInvoke: () => new Promise<string>((res) => { resolvers.push(res) }),
    })
    // 会话 A:fire 后台摘要(挂起在飞)
    await mgr.compress(mkRounds(5, 'A-'))
    // 切会话(A 的摘要仍在飞)→ A 摘要 resolve 落在后飞段
    mgr.reset?.()
    resolvers[0]!('ALPHA-SECRET 迟到的会话A摘要')
    await flush()
    // 在飞 .then 不得把 A 摘要写进已 reset 的缓存(只清缓存不 epoch 挡不住这一步 —— 假修形态)
    const rB1 = await mgr.compress(mkRounds(5, 'B-'))
    assert(!rB1.messages[0].content.includes('ALPHA-SECRET'), '✓ 飞行中切换:在飞 A 摘要 resolve 后被 epoch 丢弃,不复活进 B(修前:reset 后 llmCache=null 单调守卫恒过,在飞 .then 落缓存)')
    assert(!rB1.stats.strategy.includes('llm_summary'), `✓ 飞行中切换后 B 首压回模板形态(实际:${rB1.stats.strategy})`)
  }

  // ===== 场景 3:B 自身后台摘要不被吞(epoch 隔离 in-flight 防重入) =====
  {
    const resolvers: ((v: string) => void)[] = []
    let llmCalls = 0
    const mgr = useContextManager({
      windowRounds: 2, summaryThresholdRounds: 3, enableLLMSummary: true, enableRecall: false,
      llmInvoke: () => { llmCalls++; return new Promise<string>((res) => { resolvers.push(res) }) },
    })
    // A 在飞 → 切会话 → B 触发:B 必须能 fire(旧代在飞不阻塞新会话)
    await mgr.compress(mkRounds(5, 'A-'))
    mgr.reset?.()
    await mgr.compress(mkRounds(5, 'B-'))
    assert(llmCalls === 2, `✓ 旧代在飞不阻塞新会话 fire:B 压缩即触发自己的后台摘要(修前:llmInFlight 常驻吞掉 B;实际 llmCalls=${llmCalls})`)
    // 旧代 A 摘要迟到 resolve → 丢弃;新代 B 摘要 resolve → 正常落缓存
    resolvers[0]?.('ALPHA-SECRET 迟到')
    resolvers[1]?.('BETA 正常')
    await flush()
    const rB2 = await mgr.compress(mkRounds(5, 'B-'))
    assert(rB2.messages[0].content.includes('BETA') && !rB2.messages[0].content.includes('ALPHA'), '✓ 新代摘要落缓存、旧代丢弃(按 epoch 精确分流)')
  }

  // ===== 回归对照:同会话(不 reset)防重入照常 =====
  {
    const resolvers: ((v: string) => void)[] = []
    let llmCalls = 0
    const mgr = useContextManager({
      windowRounds: 2, summaryThresholdRounds: 3, enableLLMSummary: true, enableRecall: false,
      llmInvoke: () => { llmCalls++; return new Promise<string>((res) => { resolvers.push(res) }) },
    })
    await mgr.compress(mkRounds(5, 'A-'))
    await mgr.compress(mkRounds(5, 'A-')) // 同会话后台在途重压:不重复 fire
    assert(llmCalls === 1, '✓ 同会话在途重压不重复 fire(防重入回归零变化)')
  }
}
