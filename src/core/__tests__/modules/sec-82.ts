import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { createDataOps } from '../../tools/dataOps'
import { createAgent } from '../../harness/createAgent'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, AIMessageChunk } from '@langchain/core/messages'
import type { TestCtx } from './_ctx'

// round2-review-hardening 修复锁(A2/A3/A4):主栈 scope token / query+get 大文本摘要 / 失败读不刷基线
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke } = ctx
  console.log('\n[round2 A2:主栈工具 config 兜底注入 __pgDataScope]')
  {
    class MockLLM extends BaseChatModel {
      idx = 0
      constructor() { super({}) }
      _llmType(): string { return 'mock' }
      async *_streamResponseChunks(_m: any, _o: any): AsyncGenerator<any> {
        const i = this.idx++
        const tcc = i === 0 ? [{ id: 'c0', name: 'probe', args: JSON.stringify({}), index: 0 }] : []
        yield { text: i === 0 ? '' : '完成', message: new AIMessageChunk({ content: i === 0 ? '' : '完成', tool_call_chunks: tcc as any }), generationInfo: {} }
      }
      async _generate(_m: any, _o: any): Promise<any> {
        const msg = new AIMessage({ content: this.idx++ === 0 ? '' : '完成', tool_calls: this.idx === 1 ? [{ id: 'c0', name: 'probe', args: {} }] : [] })
        return { generations: [{ text: '', message: msg }], llmOutput: {} }
      }
    }
    // 探针工具:回显收到的第二参 config.configurable(rv-core F1 修前主栈 config 无 __pgDataScope → 恒走 ambient 闭包)
    const seen: unknown[] = []
    const probe = tool(
      async (_args: Record<string, never>, config?: unknown) => {
        seen.push((config as { configurable?: Record<string, unknown> } | undefined)?.configurable ?? null)
        return 'ok'
      },
      { name: 'probe', description: '回显 config', schema: z.object({}) },
    )
    const agent = createAgent({ llm: new MockLLM() as any, tools: [probe], maxToolRounds: 2, maxRetries: 0 })
    let final = ''
    await agent.stream([{ role: 'user', content: '探测', timestamp: Date.now() }], (e: any) => { if (e.type === 'done') final = e.content }, undefined)
    assert(final === '完成', '✓ A2 探针 agent 跑完(tool 调用 + 收口)')
    assert(seen.length === 1 && (seen[0] as any)?.__pgDataScope === '', '✓ A2 主栈工具 config 兜底含 __pgDataScope=""(不再依赖 ambient 闭包;并行委派子窗口不改写主栈 scope)')
  }

  console.log('\n[round2 A3:query_data/get_data 大文本摘要(codeAsset 形态)]')
  {
    const big = 'x'.repeat(2000)
    const bind: any = { components: [{ type: 'custom', name: 'c1', code: big }] }
    const toolsArr = createDataOps(
      { schema: z.object({ components: z.array(z.object({ type: z.string(), name: z.string(), code: z.string() })) }), bind, description: '组件' },
      { largeTextPaths: ['components.code'], largeTextThreshold: 200 },
    )
    const byName = Object.fromEntries(toolsArr.map((t: any) => [t.name, t])) as Record<string, any>
    // 主 scope(config 带 __pgDataScope='')→ 摘要;query_data 命中 value 不再全文
    const q = await invoke(byName.query_data, { expr: '$.components[*]' })
    assert(q.includes('<code') && !q.includes(big), '✓ A3 query_data 主 scope 命中 code → <code Nkb> 摘要(修前全文回灌击穿 read 摘要机制)')
    const g = await invoke(byName.get_data, { jsonPath: 'components.0' })
    assert(g.includes('<code') && !g.includes(big), '✓ A3 get_data 主 scope → 同样摘要(与 read 同 isMain 语义)')
    // 子 scope(__pgDataScope='sub')→ 全文(子 agent 需要完整 code 工作)
    const qSub = await invoke(byName.query_data, { expr: '$.components[*]' }, { configurable: { __pgDataScope: 'sub' } })
    assert(qSub.includes(big), '✓ A3 query_data 子 scope → 全文不摘要(子 agent 工作需要)')
    const gSub = await invoke(byName.get_data, { jsonPath: 'components.0' }, { configurable: { __pgDataScope: 'sub' } })
    assert(gSub.includes(big), '✓ A3 get_data 子 scope → 全文')
  }

  console.log('\n[round2 A4:失败读(PATH_DENIED)不刷乐观锁基线]')
  {
    const bind: any = { pub: 'v1' }
    const toolsArr = createDataOps(
      { schema: z.object({ pub: z.string(), secret: z.string() }), bind, description: 'd' },
      {},
    )
    // schema 声明了 secret 但 allowKeys 走 schema 全量 → 模拟范围收窄太绕;直接用 fields 投影不可行。
    // 换更直接形态:isUnsafePath(__proto__ 段)失败读。pub 正常读 → 外部改 → 失败读 → autoLock 写应冲突
    const byName = Object.fromEntries(toolsArr.map((t: any) => [t.name, t])) as Record<string, any>
    await invoke(byName.read, { jsonPath: 'pub' })                       // 基线 h1
    bind.pub = 'external-changed'                                         // 宿主改动 → h2
    const denied = await invoke(byName.read, { jsonPath: 'a.__proto__.x' }) // PATH_UNSAFE 失败读(修前会刷基线到 h2)
    assert(denied.includes('PATH_UNSAFE'), '前置:非法路径读返回 PATH_UNSAFE')
    const w = await invoke(byName.write, { value: { pub: 'agent' } })    // autoLock 默认开
    assert(w.includes('VERSION_CONFLICT'), '✓ A4 失败读未吸收宿主改动(autoLock 写仍检出冲突;修前基线被刷 → 静默覆盖宿主值)')
  }
}
