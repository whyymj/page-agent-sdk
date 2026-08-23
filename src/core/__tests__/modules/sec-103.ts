/**
 * sec-103:tool-call-economy C2(错误即向导 + 同参重复检测)
 * 覆盖:read 缺失路径 → PATH_NOT_FOUND + 父级实况建议(数组索引范围/对象键集/非容器兜底);
 * 同工具同参连续失败 ≥2 → 结果尾附提醒(不破坏 ERROR: 前缀契约 / 成功清零 / 不同参数不株连);
 * 红线:建议与提醒文案不含「未写入/无需删除」活性词(writeGate 写成功判定兼容)。
 */
import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
import { pathsOverlap } from '../../harness/readInvalidation'
import { isZeroEffectiveWrite } from '../../harness/actionGate'
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
  subtitle: z.string().optional(),   // 可选字段:缺值是合法状态(F3 豁免面)
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

  // ===== 1d. F3 可选字段缺值 = 合法状态,不报 PATH_NOT_FOUND(不进失败计数/streak)=====
  {
    const tools = makeTools() as any[]
    const r = await invokeTool(tools, 'read', { jsonPath: 'subtitle' })
    assert(!String(r).startsWith('ERROR:') && String(r).includes('(undefined)'), `✓ F3 → optional 字段缺值保持温和输出(实测前 30 字:${String(r).slice(0, 30)}`)
  }

  // ===== 1e. F1 路径形态归一:components[0] ≡ components.0(写括号/证据点分不再误伤)=====
  {
    assert(pathsOverlap('components[0]', 'components.0'), '✓ F1 → 括号与点分下标归一后重叠')
    assert(pathsOverlap('$.components[1].title', 'components.1'), '✓ F1 → $ 前缀 + 括号形态归一')
    assert(!pathsOverlap('components[0]', 'components.1'), '✓ F1 → 归一不误合并不同下标')
  }

  // ===== 1b. 键集来源收紧:bind 有 schema 未声明的运行时键 → 建议只列声明键,未声明键名不因报错泄露 =====
  {
    const bind: any = { theme: 'dark', components: [{ type: 'card', title: 'a' }], meta: { pageName: 'p', author: 'u' }, _runtimeSecret: 'x' }
    const tools = createDataOps({ schema: SCHEMA, bind, description: '组件' }, {}) as any[]
    const r = await invokeTool(tools, 'read', { jsonPath: 'theem' })
    const hint = JSON.parse(String(r).slice(7)).hint
    assert(!hint.includes('_runtimeSecret'), '✓ C2 键集收紧 → schema 未声明键名不因报错泄露(与正常读深投影同口径)')
    assert(hint.includes('theme') && hint.includes('meta'), '✓ C2 键集收紧 → 声明键照常建议')
  }

  // ===== 1c. 对象父级键集同样只列声明键(嵌套层)=====
  {
    const bind: any = { theme: 'dark', components: [{ type: 'card', title: 'a' }], meta: { pageName: 'p', author: 'u', _hidden: 1 } }
    const tools = createDataOps({ schema: SCHEMA, bind, description: '组件' }, {}) as any[]
    const r = await invokeTool(tools, 'read', { jsonPath: 'meta.pageNme' })
    const hint = JSON.parse(String(r).slice(7)).hint
    assert(!hint.includes('_hidden') && hint.includes('pageName'), '✓ C2 键集收紧 → 嵌套父级只列声明键(meta.pageName 在,_hidden 不在)')
  }

  // ===== 1g. defineTool writeCapable 标注(editor 诊断驱动:结构工具不再被零工具门禁误判)=====
  {
    const { defineTool } = await import('../../sdk/defineTool')
    const del = defineTool({ name: 'delete_component', description: '删', schema: z.object({ nodeId: z.string() }), handler: () => 'deleted', writeCapable: true })
    const cond = defineTool({ name: 'run_script', description: '跑', schema: z.object({ mode: z.string() }), handler: () => 'ok', writeCapable: (a) => a.mode === 'transform' })
    const rd = defineTool({ name: 'list_x', description: '列', schema: z.object({}), handler: () => '[]' })
    const { isWriteCapableTool } = await import('../../harness/subagent')
    assert(isWriteCapableTool(del), '✓ defineTool writeCapable → 布尔标注被 isWriteCapableTool 识别')
    assert(isWriteCapableTool(cond, { mode: 'transform' }) && !isWriteCapableTool(cond, { mode: 'query' }), '✓ defineTool writeCapable → 条件函数 args-aware 生效')
    assert(!isWriteCapableTool(rd), '✓ defineTool 缺省 → 不标不算写')
    // 零工具门禁口径:结构工具计入等效写(不再误判「零写谎报」)
    const usage = { counts: { delete_component: 1 }, writePaths: [], failures: 0 }
    assert(!isZeroEffectiveWrite(usage, (n) => n === 'delete_component'), '✓ 结构工具标注 → 零工具门禁不再误伤清空/增删流')
  }

  // ===== 1h. 幻觉工具名报错附可用清单 + createHtmlSubagent allowedTools 透出(editor 诊断驱动)=====
  {
    const { createHtmlSubagent } = await import('../../sdk/htmlSubagent')
    const sub = createHtmlSubagent({ writablePaths: ['components'], allowedTools: ['rag_component_docs', 'list_components'] })
    const raw = JSON.stringify(sub)
    assert(raw.includes('rag_component_docs') && raw.includes('list_components'), '✓ createHtmlSubagent allowedTools → 只读扩展进子池配置')
  }

  // ===== 1f. 写侧键集建议(C2 延伸:patches PATH_DENIED / SCHEMA_STRIP / move 目标)=====
  {
    const tools = makeTools() as any[]
    // patches 键打错:hint 应含父级声明键
    const r1 = await invokeTool(tools, 'write', { patches: [{ op: 'set', jsonPath: 'meta.pageNme', value: 'x' }] })
    assert(String(r1).startsWith('ERROR: PATH_NOT') === false && String(r1).includes('PATH_DENIED'), '✓ 写侧 → patches 键错报 PATH_DENIED')
    assert(String(r1).includes('pageName') && String(r1).includes('author'), `✓ 写侧 → patches hint 含父级声明键(实测:${String(r1).slice(0, 120)}…)`)
    // 整体 set 带未声明根键:SCHEMA_STRIP hint 含根声明键
    const r2 = await invokeTool(tools, 'write', { value: { theme: 'light', theem: 'oops' } })
    assert(String(r2).includes('SCHEMA_STRIP'), '✓ 写侧 → 根级未声明键报 SCHEMA_STRIP')
    assert(String(r2).includes('theme') && String(r2).includes('components'), '✓ 写侧 → SCHEMA_STRIP hint 含根声明键集')
    // move 目标键错:hint 含目标父级声明键
    const r3 = await invokeTool(tools, 'write', { patches: [{ op: 'move', jsonPath: 'components.0.title', value: 'meta.pageNme' }] })
    assert(String(r3).includes('PATH_DENIED') && String(r3).includes('pageName'), '✓ 写侧 → move 目标键错 hint 含声明键')
    // 红线:全部建议不含活性词
    for (const r of [r1, r2, r3]) assert(!String(r).includes('无需删除'), '✓ 写侧红线 → 建议不含「无需删除」活性词')
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
        { tool: { name: 'read', args: { depth: 2, jsonPath: 'components.9' } } },  // 同参失败(键序 A)
        { tool: { name: 'read', args: { jsonPath: 'components.9', depth: 2 } } },  // 同参失败(键序 B —— 3.44.1 规范化后仍算同参)
        { tool: { name: 'read', args: badRead } },                                 // 参数变了(去掉 depth)→ 新 streak 首次
        { tool: { name: 'read', args: badRead } },                                 // 同参第二次 → 提醒
        { tool: { name: 'read', args: { jsonPath: 'theme' } } },                   // 成功 → 清零
        { tool: { name: 'read', args: badRead } },                                 // streak 重启(1 次,无提醒)
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
    assert(contents.length === 6, `✓ C2 streak → 6 条工具结果(实测 ${contents.length})`)
    assert(!contents[0].includes('同参数已连续失败'), '✓ C2 streak → 首次失败不提醒(给正常自纠机会)')
    assert(contents[1].includes('同参数已连续失败 2 次'), '✓ C2 streak(3.44.1)→ 字段重排的同参仍算同参(规范化键序)')
    assert(!contents[2].includes('同参数已连续失败'), '✓ C2 streak → 参数实质变化(去掉 depth)是新 streak 首次,不提醒')
    assert(contents[3].includes('同参数已连续失败 2 次'), '✓ C2 streak → 第 2 次同参失败附提醒')
    assert(contents[3].startsWith('ERROR:'), '✓ C2 streak → 追加不破坏 ERROR: 前缀首位(writeGate 兼容)')
    assert(!contents[4].includes('同参数已连续失败'), '✓ C2 streak → 成功调用零提醒')
    assert(!contents[5].includes('同参数已连续失败 2'), '✓ C2 streak → 成功后 streak 清零(第 6 次失败是新 streak 首次)')
    // 红线:提醒文案不含活性词(仅对带提醒的结果检查)
    for (const c of contents.filter((x) => x.includes('同参数已连续失败'))) {
      assert(!c.includes('未写入') && !c.includes('无需删除'), '✓ C2 红线 → 提醒文案不含「未写入/无需删除」活性词')
    }
  }
}
