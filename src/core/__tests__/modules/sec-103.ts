/**
 * sec-103:tool-call-economy C2(错误即向导 + 同参重复检测)
 * 覆盖:read 缺失路径 → PATH_NOT_FOUND + 父级实况建议(数组索引范围/对象键集/非容器兜底);
 * 同工具同参连续失败 ≥2 → 结果尾附提醒(不破坏 ERROR: 前缀契约 / 成功清零 / 不同参数不株连);
 * 红线:建议与提醒文案不含「未写入/无需删除」活性词(writeGate 写成功判定兼容)。
 */
import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
import { createAgent } from '../../harness/createAgent'
import type { Middleware } from '../../harness/middleware'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, AIMessageChunk, ToolMessage } from '@langchain/core/messages'
import type { TestCtx } from './_ctx'

class ScriptLLM extends BaseChatModel {
  idx = 0
  constructor(private script: Array<{ tool?: { name: string; args: Record<string, unknown> } }>) { super({}) }
  _llmType(): string { return 'script' }
  private step() { return this.script[this.idx++] }
  async *_streamResponseChunks(): AsyncGenerator<any> {
    const s = this.step()
    if (s?.tool) {
      const tcc = [{ id: `call_${this.idx - 1}`, name: s.tool.name, args: JSON.stringify(s.tool.args), index: 0 }]
      yield { text: '', message: new AIMessageChunk({ content: '', tool_call_chunks: tcc as any }), generationInfo: {} }
    } else {
      yield { text: '完成', message: new AIMessageChunk({ content: '完成' }), generationInfo: {} }
    }
  }
  async _generate(): Promise<any> {
    const s = this.step()
    const msg = s?.tool
      ? new AIMessage({ content: '', tool_calls: [{ id: `call_${this.idx - 1}`, name: s.tool.name, args: s.tool.args, type: 'tool_call' }] })
      : new AIMessage({ content: '完成' })
    return { generations: [{ text: '完成', message: msg }], llmOutput: {} }
  }
}

const SCHEMA = z.object({
  theme: z.string(),
  components: z.array(z.object({ type: z.string(), title: z.string() })),
  meta: z.object({ pageName: z.string(), author: z.string() }),
})

function makeTools() {
  const bind: any = { theme: 'dark', components: [{ type: 'card', title: 'a' }, { type: 'card', title: 'b' }], meta: { pageName: 'p', author: 'u' } }
  return createDataOps({ schema: SCHEMA, bind, description: '组件' }, {})
}

async function invokeTool(tools: any, name: string, args: Record<string, unknown>) {
  const t = tools.find((x: any) => x.name === name)
  return await t.invoke(args)   // 方法调用保持 this 绑定(解构 invoke 会丢 defaultConfig)
}

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // ===== 1. read 缺失路径 → PATH_NOT_FOUND + 父级建议 =====
  {
    const tools = makeTools() as any[]
    // 数组越界:父级是数组 → 索引范围建议
    const r1 = await invokeTool(tools, 'read', { jsonPath: 'components.9' })
    assert(typeof r1 === 'string' && r1.startsWith('ERROR:'), '✓ C2 read 缺失 → ERROR: 前缀单行契约保持')
    const p1 = JSON.parse(String(r1).slice(7))
    assert(p1.error === 'PATH_NOT_FOUND' && p1.path === 'components.9', '✓ C2 read 缺失 → PATH_NOT_FOUND 错误码 + path')
    assert(p1.hint.includes('2 元数组') && p1.hint.includes('有效索引 0-1'), `✓ C2 read 缺失 → 数组父级索引范围建议(实测:${p1.hint.slice(0, 50)}…)`)
    // 对象键打错:父级是对象 → 键集建议
    const r2 = await invokeTool(tools, 'read', { jsonPath: 'meta.pageNme' })
    const p2 = JSON.parse(String(r2).slice(7))
    assert(p2.hint.includes('pageName') && p2.hint.includes('author'), '✓ C2 read 缺失 → 对象父级键集建议(含正确键名)')
    // 顶层未知键:父级 = root 对象 → 顶层键集
    const r3 = await invokeTool(tools, 'read', { jsonPath: 'theem' })
    const p3 = JSON.parse(String(r3).slice(7))
    assert(p3.hint.includes('theme') && p3.hint.includes('components'), '✓ C2 read 缺失 → 顶层键集建议')
    // 红线:建议文案不含活性词
    for (const r of [r1, r2, r3]) assert(!String(r).includes('未写入') && !String(r).includes('无需删除'), '✓ C2 红线 → 建议文案不含「未写入/无需删除」活性词')
    // 存在路径不受影响(正常读照旧)
    const r4 = await invokeTool(tools, 'read', { jsonPath: 'theme' })
    assert(String(r4).includes('dark') && !String(r4).startsWith('ERROR:'), '✓ C2 read 正常路径 → 照旧返回值(hash 语义不变)')
  }

  // ===== 2. 同参重复检测(createAgent 循环层)=====
  {
    const tools = makeTools()
    const captured: any[][] = []
    const captureMw: Middleware = {
      name: 'capture',
      wrapModelCall: async (req, next) => { captured.push([...req.messages]); return next(req) },
    }
    const badRead = { jsonPath: 'components.9' }   // 同参失败 ×3
    const agent = createAgent({
      llm: new ScriptLLM([
        { tool: { name: 'read', args: badRead } },
        { tool: { name: 'read', args: badRead } },
        { tool: { name: 'read', args: badRead } },
        { tool: { name: 'read', args: { jsonPath: 'theme' } } },  // 成功 → 清零
        { tool: { name: 'read', args: badRead } },                 // streak 重启(1 次,无提醒)
      ]) as any,
      tools,
      middleware: [captureMw],
      maxToolRounds: 10,
      maxRetries: 0,
    })
    let final = ''
    await agent.stream([{ role: 'user', content: '按提示读', timestamp: Date.now() }], (e: any) => { if (e.type === 'done') final = e.content }, undefined)
    assert(final === '完成', '✓ C2 streak → 脚本循环跑完收口')
    // 末次请求包含全部工具结果(captured 是逐轮累积快照,直接 flat 会重复计数)
    const lastMsgs = captured[captured.length - 1] ?? []
    const contents = (lastMsgs.filter((m) => m instanceof ToolMessage) as ToolMessage[]).map((m) => String(m.content))
    assert(contents.length === 5, `✓ C2 streak → 5 条工具结果(实测 ${contents.length})`)
    assert(!contents[0].includes('同参数已连续失败'), '✓ C2 streak → 首次失败不提醒(给正常自纠机会)')
    assert(contents[1].includes('同参数已连续失败 2 次'), '✓ C2 streak → 第 2 次同参失败附提醒')
    assert(contents[2].includes('同参数已连续失败 3 次'), '✓ C2 streak → 第 3 次持续附提醒(计数递增)')
    assert(contents[1].startsWith('ERROR:'), '✓ C2 streak → 追加不破坏 ERROR: 前缀首位(writeGate 兼容)')
    assert(!contents[3].includes('同参数已连续失败'), '✓ C2 streak → 成功调用零提醒')
    assert(!contents[4].includes('同参数已连续失败 2'), '✓ C2 streak → 成功后 streak 清零(第 5 次失败是新 streak 首 次)')
    // 红线:提醒文案不含活性词(仅对带提醒的结果检查)
    for (const c of contents.filter((x) => x.includes('同参数已连续失败'))) {
      assert(!c.includes('未写入') && !c.includes('无需删除'), '✓ C2 红线 → 提醒文案不含「未写入/无需删除」活性词')
    }
  }
}
