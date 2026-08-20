// subagent-thinking-mode-lock e2e:思考深度锁定(output-quality-uplift 批;stub model 驱动真 ReAct)
//  - cfg 透传:createHtmlSubagent({ llm, thinkingMode }) → SubagentConfig 字段
//  - inspect 反射:thinkingMode + thinkingApplied(applied/inherited/instance-noop 三态)
//  - 实例路径 no-op:预构造实例(stub)无法锁定 → warn + debugLogs 留痕,委派照常
//  - 全局缺省与显式覆盖优先级
import { setupEnv, createAssert, createChatSdk, z } from './_helpers.mjs'
import { stubModel } from './_stub-model.mjs'
import { createHtmlSubagent } from '../../dist/page-agent-sdk.js'

const CAPS = { fetch: false, planning: false, skills: false, vfs: false, summarization: false, memory: false }

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:thinking-mode] createHtmlSubagent llm/thinkingMode 透传(装配期纯断言)')
  {
    const cfg = createHtmlSubagent({ writablePaths: ['child'], llm: { apiKey: 'k', baseUrl: 'http://x', model: 'strong-model' }, thinkingMode: 'deep' })
    assert(cfg.llm?.model === 'strong-model', '✓ createHtmlSubagent({llm}) → cfg.llm 透传(子 agent 独立强模型)')
    assert(cfg.thinkingMode === 'deep', '✓ createHtmlSubagent({thinkingMode}) → cfg.thinkingMode 透传')
    const bare = createHtmlSubagent({ writablePaths: ['child'] })
    assert(bare.llm === undefined && bare.thinkingMode === undefined, '✓ 边界 → 不传 llm/thinkingMode 时缺省(继承主,零回归)')
  }

  console.log('[e2e:thinking-mode] 实例路径 no-op:预构造实例无法锁定(warn 留痕,委派照常)')
  {
    // 主 llm = stub 实例(BaseChatModel);子继承实例 + thinkingMode deep → 物理不可改 → noop 留痕,委派正常完成
    const llm = stubModel(
      { toolCalls: [{ name: 'use_worker', args: { task: '调研一下' } }] },
      { text: '子任务结论' },   // 子 agent(继承 stub 实例)收口
      { text: '主收口' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-tm-noop', storage: false, llm, capabilities: CAPS,
      subagents: [{ id: 'worker', description: '测试工人', thinkingMode: 'deep' }],
    })
    await sdk.mount()
    const reply = await sdk.send('帮我调研')
    assert(reply.includes('主收口'), '✓ 实例路径 no-op → 委派照常完成(思考锁定忽略不阻塞)')
    const noop = sdk.debugLogs.value.find((l) => l.data?.stage === 'subagent_thinking_mode_noop')
    assert(!!noop && noop.data?.mode === 'deep', '✓ 实例路径 no-op → debugLogs 留痕(mode=deep)')
    const info = sdk.inspect().subagent.subagents.find((s) => s.id === 'worker')
    assert(info?.thinkingMode === 'deep' && info?.thinkingApplied === 'instance-noop', '✓ inspect 反射 → thinkingMode + thinkingApplied=instance-noop')
    sdk.unmount()
  }

  console.log('[e2e:thinking-mode] 全局缺省 + 显式覆盖优先级(inspect 反射)')
  {
    const llm = stubModel({ text: 'ok' })
    const sdk = createChatSdk({
      ui: false, id: 'e2e-tm-default', storage: false, llm, capabilities: CAPS,
      subagent: { thinkingMode: 'simple' },   // 顶层全局缺省
      subagents: [
        { id: 'inheritor', description: '继承全局缺省' },
        { id: 'overrider', description: '显式覆盖', thinkingMode: 'deep' },
        { id: 'cfgllm', description: '配置形态 llm', llm: { apiKey: 'k', model: 'm' }, thinkingMode: 'deep' },
      ],
    })
    await sdk.mount()
    const subs = sdk.inspect().subagent.subagents
    const inh = subs.find((s) => s.id === 'inheritor')
    const ovr = subs.find((s) => s.id === 'overrider')
    const cfg = subs.find((s) => s.id === 'cfgllm')
    assert(inh?.thinkingMode === 'simple' && inh?.thinkingApplied === 'instance-noop', '✓ 全局缺省 → 未显式设的子 agent 继承 simple(主为实例 → noop 态)')
    assert(ovr?.thinkingMode === 'deep', '✓ 显式覆盖 → config.thinkingMode 优先于全局缺省')
    assert(cfg?.thinkingMode === 'deep' && cfg?.thinkingApplied === 'applied', '✓ LLMConfig 形态 llm → thinkingApplied=applied(构造路径可锁定)')
    sdk.unmount()
  }

  console.log('[e2e:thinking-mode] 未设 thinkingMode → inherited(零回归)')
  {
    const llm = stubModel({ text: 'ok' })
    const sdk = createChatSdk({
      ui: false, id: 'e2e-tm-inherit', storage: false, llm, capabilities: CAPS,
      subagents: [{ id: 'plain', description: '无锁定' }],
    })
    await sdk.mount()
    const info = sdk.inspect().subagent.subagents.find((s) => s.id === 'plain')
    assert(info?.thinkingApplied === 'inherited' && info?.thinkingMode === undefined, '✓ 边界 → 未设 thinkingMode 反射 inherited(现状零变化)')
    sdk.unmount()
  }

  return ctx
}
