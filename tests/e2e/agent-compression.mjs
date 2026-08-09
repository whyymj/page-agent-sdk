// agent-driven-compression:capabilities.agentCompression 开关 + requires summarization + 导出可用 + 装配不崩
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk } from './_helpers.mjs'
import { CompressDecisionSchema, shouldTriggerCompression, resolveCapabilities } from '../../dist/page-agent-sdk.js'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx
  console.log('[e2e:agent-compression] capabilities.agentCompression 开关 + requires summarization + 导出可用')

  // resolveCapabilities:默认关(opt-in)/ 开启 / requires summarization
  assert(resolveCapabilities({}).agentCompression === false, '✓ resolveCapabilities 默认 → agentCompression 关(opt-in)')
  assert(resolveCapabilities({ agentCompression: true }).agentCompression === true, '✓ resolveCapabilities agentCompression:true → 开')
  assert(resolveCapabilities({ agentCompression: true, summarization: false }).agentCompression === false, '✓ requires summarization → summarization 关则 agentCompression 强制关')

  // createChatSdk 开启 agentCompression + summaryLlm → 不崩 + summarization 中间件装载
  const sdk = createChatSdk({
    ui: false, id: 'e2e-agentcomp', storage: 'memory', llm: FAKE_LLM, summaryLlm: FAKE_LLM,
    capabilities: { ...MIN_CAPS, summarization: true, agentCompression: true },
  })
  await sdk.mount()
  assert(sdk.inspect().middleware.includes('summarization'), '✓ agentCompression 开 + summaryLlm → summarization 中间件装载(不崩)')
  // lastCompression 初始 undefined(未触发压缩);有 summaryLlm 时 useAgentCompression 应已装配 decideInvoke(内部,不暴露)
  assert(sdk.inspect().lastCompression === undefined, '✓ 初始 lastCompression undefined(未触发压缩)')
  sdk.unmount()

  // agentCompression 开但 summarization 关 → 强制关,summarization 不装载
  const sdk2 = createChatSdk({
    ui: false, id: 'e2e-agentcomp2', storage: 'memory', llm: FAKE_LLM,
    capabilities: { ...MIN_CAPS, summarization: false, agentCompression: true },
  })
  await sdk2.mount()
  assert(!sdk2.inspect().middleware.includes('summarization'), '✓ agentCompression 开但 summarization 关 → 强制关,summarization 不装载')
  sdk2.unmount()

  // 导出可用 + schema 校验
  assert(typeof CompressDecisionSchema.safeParse === 'function', '✓ 导出 CompressDecisionSchema(zod)')
  assert(typeof shouldTriggerCompression === 'function', '✓ 导出 shouldTriggerCompression')
  assert(CompressDecisionSchema.safeParse({ keepRounds: 3, summarize: { mode: 'llm' } }).success === true, '✓ CompressDecisionSchema.safeParse 合法通过')
  assert(CompressDecisionSchema.safeParse({ summarize: { mode: 'llm' } }).success === false, '✓ CompressDecisionSchema.safeParse 两字段空拒(refine)')
  // shouldTriggerCompression 纯函数可用
  assert(shouldTriggerCompression([], { summaryThresholdRounds: 3 }) === false, '✓ shouldTriggerCompression 空轮次 → 不触发')

  return { pass: ctx.pass, fail: ctx.fail }
}
