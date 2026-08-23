/**
 * sec-90 —— applyThinkingMode 纯函数(subagent-thinking-mode-lock 核心;output-quality-uplift 批)
 *
 * 背景:子 agent 思考深度锁定 —— 'simple' 剥思考参数(省 token/加速)/ 'deep' 注入(质量优先)。
 * 生效路径:LLMConfig 构造分支构造前改写(OpenAI extraBody.thinking / Anthropic 顶层 thinking 字段);
 * 预构造 BaseChatModel 实例路径物理不可改(warn+no-op,在 e2e 验证)。
 *
 * A. OpenAI 兼容路径:extraBody.thinking 增删(保留其它键/子键;不 mutate 原 config)
 * B. Anthropic 路径:顶层 thinking 字段(budget_tokens 缺省 min(maxTokens ?? 4096, 8000);显式已配不覆盖)
 * C. 边界:未设 mode 原引用返回;无可剥时原引用返回
 */
import type { TestCtx } from './_ctx'
import { applyThinkingMode, resolveEffectiveThinkingMode, constructOpenLlmSync } from '../../llm/constructLlm'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-90] applyThinkingMode 思考深度锁定纯函数')

  // ===== A. OpenAI 兼容路径(extraBody.thinking)=====
  {
    // deep 注入:保留 extraBody 其它键
    const r1 = applyThinkingMode(({ apiKey: 'k', extraBody: { foo: 1 } }) as any, 'deep') as any
    assert((r1.extraBody?.thinking as any)?.type === 'enabled' && r1.extraBody?.foo === 1, '✓ thinkingMode deep → 注入 extraBody.thinking {type:enabled}(保留其它键)')
    // deep 保留已有 thinking 子键(如网关 budget)
    const r2 = applyThinkingMode({ apiKey: 'k', extraBody: { thinking: { budget_tokens: 100 } } }, 'deep')
    assert((r2.extraBody?.thinking as any)?.type === 'enabled' && (r2.extraBody?.thinking as any)?.budget_tokens === 100, '✓ thinkingMode deep → 保留已有 thinking 子键(budget 不丢)')
    // deep 无 extraBody → 新建
    const r3 = applyThinkingMode(({ apiKey: 'k' }) as any, 'deep') as any
    assert((r3.extraBody?.thinking as any)?.type === 'enabled', '✓ thinkingMode deep → 无 extraBody 时新建')
    // simple 剥除:保留其它键
    const r4 = applyThinkingMode({ apiKey: 'k', extraBody: { thinking: { type: 'enabled' }, foo: 1 } }, 'simple')
    assert(!('thinking' in (r4.extraBody ?? {})) && r4.extraBody?.foo === 1, '✓ thinkingMode simple → 剥 extraBody.thinking(保留其它键)')
    // 不 mutate 原 config
    const orig = { apiKey: 'k', extraBody: { thinking: { type: 'enabled' } } }
    applyThinkingMode(orig, 'simple')
    assert((orig.extraBody as any).thinking?.type === 'enabled', '✓ applyThinkingMode → 原 config 不被 mutate')
  }

  // ===== B. Anthropic 路径(顶层 thinking 字段)=====
  {
    // deep 注入默认 budget:maxTokens 2000 → budget 2000
    const r1 = applyThinkingMode(({ apiKey: 'k', provider: 'anthropic' as const, maxTokens: 2000 }) as any, 'deep') as any
    assert(r1.thinking?.type === 'enabled' && r1.thinking?.budget_tokens === 2000, '✓ anthropic deep → 注入 thinking,budget_tokens = maxTokens(≤8000 时)')
    // budget 上限 8000
    const r2 = applyThinkingMode(({ apiKey: 'k', provider: 'anthropic' as const, maxTokens: 20000 }) as any, 'deep') as any
    assert(r2.thinking?.budget_tokens === 8000, '✓ anthropic deep → budget_tokens 上限 8000')
    // 无 maxTokens → 缺省 4096
    const r3 = applyThinkingMode(({ apiKey: 'k', provider: 'anthropic' as const }) as any, 'deep') as any
    assert(r3.thinking?.budget_tokens === 4096, '✓ anthropic deep → 无 maxTokens 缺省 budget 4096')
    // 显式已配不覆盖(同引用返回)
    const preset = { apiKey: 'k', provider: 'anthropic' as const, thinking: { type: 'enabled' as const, budget_tokens: 5000 } }
    const r4 = applyThinkingMode(preset, 'deep')
    assert(r4 === preset && r4.thinking?.budget_tokens === 5000, '✓ anthropic deep → 显式已配 thinking 不覆盖')
    // simple 剥顶层 thinking
    const r5 = applyThinkingMode(({ apiKey: 'k', provider: 'anthropic' as const, thinking: { type: 'enabled' as const, budget_tokens: 5000 } }) as any, 'simple') as any
    assert(r5.thinking === undefined, '✓ anthropic simple → 剥 thinking 字段')
    // anthropic 路径不动 extraBody.thinking(协议不同,extraBody 对 Claude 无语义)
    const r6 = applyThinkingMode(({ apiKey: 'k', provider: 'anthropic' as const }) as any, 'deep') as any
    assert(r6.extraBody === undefined, '✓ anthropic deep → 不污染 extraBody(思考走顶层 thinking)')
  }

  // ===== C. 边界 =====
  {
    const cfg = { apiKey: 'k', extraBody: { foo: 1 } }
    assert(applyThinkingMode(cfg, undefined) === cfg, '✓ 边界 → mode 未设原引用返回(零开销)')
    const nothing = { apiKey: 'k' }
    assert(applyThinkingMode(nothing as any, 'simple') === nothing, '✓ 边界 → simple 无思考参数可剥时原引用返回')
  }

  // ===== D. 默认 deep(default-deep-thinking):优先级链 + 构造层注入 =====
  {
    // 能力表驱动:思考型模型零配置 → deep;非思考型 → 不注入(未知模型不猜防 400)
    assert(resolveEffectiveThinkingMode({ model: 'deepseek-v4-flash' }) === 'deep', '✓ 默认 deep → deepseek-v4-flash 能力表命中零配置 deep')
    assert(resolveEffectiveThinkingMode({ model: 'glm-5.2' }) === 'deep', '✓ 默认 deep → glm-5.2 命中')
    assert(resolveEffectiveThinkingMode({ model: 'claude-3-7-sonnet' }) === 'deep', '✓ 默认 deep → claude-3-7 命中')
    assert(resolveEffectiveThinkingMode({ model: 'gpt-4o' }) === undefined, '✓ 默认 deep → gpt-4o 能力表无 thinking 不注入')
    assert(resolveEffectiveThinkingMode({ model: 'some-unknown-model' }) === undefined, '✓ 默认 deep → 未知模型不猜(防 400)')
    // 显式优先链:explicit > cfg.thinkingMode > 自管思考参数 > fallback > 表
    assert(resolveEffectiveThinkingMode({ model: 'deepseek-v4-flash', thinkingMode: 'simple' }, undefined) === 'simple', '✓ 默认 deep → cfg.thinkingMode simple 压过表默认')
    assert(resolveEffectiveThinkingMode({ model: 'deepseek-v4-flash' }, 'simple') === 'simple', '✓ 默认 deep → 构造参数 explicit simple 最高')
    assert(resolveEffectiveThinkingMode({ model: 'deepseek-v4-flash', extraBody: { thinking: { type: 'disabled' } } }) === undefined, '✓ 默认 deep → 集成方自管 extraBody.thinking 不叠默认')
    assert(resolveEffectiveThinkingMode({ model: 'deepseek-v4-flash' }, undefined, 'simple') === 'simple', '✓ 默认 deep → fallback simple(summary/title 通道免思考)')
    assert(resolveEffectiveThinkingMode({ model: 'gpt-4o' }, undefined, 'simple') === 'simple', '✓ 默认 deep → fallback 对非思考模型也生效(显式通道语义)')
    // 构造层落地:deepseek 零配置 → modelKwargs.thinking 注入;gpt 不注入
    const dsLlm = constructOpenLlmSync({ apiKey: 'sk', model: 'deepseek-v4-flash' })
    assert(((dsLlm as any).lc_kwargs?.modelKwargs?.thinking as any)?.type === 'enabled', '✓ 默认 deep → 构造层 deepseek 自动注入 modelKwargs.thinking')
    const gptLlm = constructOpenLlmSync({ apiKey: 'sk', model: 'gpt-4o' })
    assert(gptLlm && ((gptLlm as any).lc_kwargs?.modelKwargs?.thinking) === undefined, '✓ 默认 deep → 构造层 gpt-4o 不注入 thinking')
    const simpleLlm = constructOpenLlmSync({ apiKey: 'sk', model: 'deepseek-v4-flash', thinkingMode: 'simple' })
    assert(((simpleLlm as any).lc_kwargs?.modelKwargs?.thinking) === undefined, '✓ 默认 deep → thinkingMode simple 显式剥除')
  }
}
