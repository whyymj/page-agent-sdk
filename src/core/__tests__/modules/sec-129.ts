/**
 * sec-129:S2 宿主变更驱动的页面读失效(host-integration-contract,invalidatePageReads 纯函数白盒)
 * 覆盖:页面读五工具全量占位 / 数据读不受影响(scope 隔离)/ 幂等(已占位不重复替换)/
 * 原数组不可变 / tool_call_id 保留 / id 缺失按序兜底配对 / 空输入与无页面读零变化 / reason 进文案。
 */
import type { TestCtx } from './_ctx'
import { AIMessage, ToolMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import { invalidatePageReads, PAGE_READ_TOOLS, STALE_PLACEHOLDER_MARK } from '../../harness/readInvalidation'

function mkRound(calls: Array<{ id?: string; name: string; args?: Record<string, unknown> }>, contents: string[]): BaseMessage[] {
  const ai = new AIMessage({
    content: '',
    tool_calls: calls.map((c, i) => ({ id: c.id ?? `call_${i}`, name: c.name, args: c.args ?? {}, type: 'tool_call' as const })),
  })
  const tools = calls.map((c, i) => new ToolMessage({ tool_call_id: c.id ?? `call_${i}`, content: contents[i] ?? 'ok' }))
  return [ai, ...tools]
}

const CONTENT = (m: BaseMessage): string => String((m as unknown as { content?: unknown }).content ?? '')

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // 1. 页面读五工具全量占位(read_page/dom_search/dom_info/get_dom/take_screenshot)+ reason 进文案
  {
    const calls = ['read_page', 'dom_search', 'dom_info', 'get_dom', 'take_screenshot'].map((name, i) => ({ id: `c${i}`, name }))
    const messages = mkRound(calls, ['页面正文…', '命中 3 处…', '元素结构…', 'DOM 树…', '[截图 dataUri]'])
    const r = invalidatePageReads(messages, '用户切换到《数据结构》')
    assert(r.invalidatedCount === 5, `✓ 页面读失效 → 五工具结果全量占位(实测 ${r.invalidatedCount})`)
    for (let i = 1; i <= 5; i++) {
      const tm = r.messages[i] as ToolMessage
      assert(CONTENT(tm).startsWith(STALE_PLACEHOLDER_MARK), `✓ 页面读失效 → ${calls[i - 1].name} content 为占位`)
      assert(CONTENT(tm).includes('用户切换到《数据结构》'), `✓ 页面读失效 → ${calls[i - 1].name} 占位含 reason`)
      assert(CONTENT(tm).includes(calls[i - 1].name), `✓ 页面读失效 → ${calls[i - 1].name} 占位引导重调同名工具`)
      assert((tm as unknown as { tool_call_id?: string }).tool_call_id === `c${i - 1}`, `✓ 页面读失效 → ${calls[i - 1].name} 保留 tool_call_id`)
    }
    // 原数组不可变(纯函数):新数组返回,替换处新实例,原 ToolMessage 原样
    assert(r.messages !== messages && r.messages[1] !== messages[1], '✓ 纯函数 → 返回新数组,替换处新实例')
    assert(CONTENT(messages[1]) === '页面正文…', '✓ 纯函数 → 原 ToolMessage content 未被改写')
  }

  // 2. scope 隔离:数据读(read/query_data/search_data)与写工具结果不受影响
  {
    const messages = [
      ...mkRound([{ name: 'read', args: { jsonPath: 'components.0' } }], ['主数据 @ components.0(hash=aaa)']),
      ...mkRound([{ name: 'query_data', args: { expr: '$.components[?(@.type=="card")]' } }], ['匹配 2 个元素']),
      ...mkRound([{ name: 'search_data', args: { q: '导航' } }], ['命中:components.1']),
      ...mkRound([{ name: 'write', args: { patch: { op: 'set', jsonPath: 'theme', value: 'dark' } } }], ['已写入(hash=bbb)']),
      ...mkRound([{ name: 'read_page', args: {} }], ['页面正文…']),
    ]
    const r = invalidatePageReads(messages)
    assert(r.invalidatedCount === 1, `✓ scope 隔离 → 仅 read_page 占位,数据读/写结果不动(实测 ${r.invalidatedCount})`)
    assert(CONTENT(r.messages[1]).includes('hash=aaa') && CONTENT(r.messages[3]).includes('匹配 2 个元素') && CONTENT(r.messages[5]).includes('命中'), '✓ scope 隔离 → read/query/search 原文保留')
    assert(CONTENT(r.messages[9]).startsWith(STALE_PLACEHOLDER_MARK) && CONTENT(r.messages[7]).includes('hash=bbb'), '✓ scope 隔离 → read_page 已占位(index 9),write 结果原样')
  }

  // 3. 幂等:已占位不重复替换;无页面读零变化;空输入原样
  {
    const messages = mkRound([{ name: 'read_page', args: {} }, { name: 'get_dom', args: {} }], ['页面正文…', 'DOM 树…'])
    const r1 = invalidatePageReads(messages)
    assert(r1.invalidatedCount === 2, `✓ 幂等 → 首次全量占位(实测 ${r1.invalidatedCount})`)
    const r2 = invalidatePageReads(r1.messages)
    assert(r2.invalidatedCount === 0 && r2.messages === r1.messages, `✓ 幂等 → 二次调用零替换且原引用返回(实测 ${r2.invalidatedCount})`)
    const r3 = invalidatePageReads(mkRound([{ name: 'read', args: { jsonPath: 'a' } }], ['v']))
    assert(r3.invalidatedCount === 0 && r3.messages.length === 2, '✓ 幂等 → 无页面读结果零变化')
    const r4 = invalidatePageReads([])
    assert(r4.invalidatedCount === 0 && r4.messages.length === 0, '✓ 幂等 → 空输入安全')
  }

  // 4. id 缺失按 tool_calls 顺序兜底配对;HumanMessage 夹在中间不干扰
  {
    const ai = new AIMessage({ content: '', tool_calls: [
      { id: undefined as unknown as string, name: 'read_page', args: {}, type: 'tool_call' as const },
      { id: undefined as unknown as string, name: 'read', args: { jsonPath: 'a' }, type: 'tool_call' as const },
    ] })
    const t1 = new ToolMessage({ tool_call_id: '', content: '页面正文…' })
    const t2 = new ToolMessage({ tool_call_id: '', content: '数据 v' })
    const human = new HumanMessage('继续')
    const r = invalidatePageReads([ai, t1, t2, human])
    assert(r.invalidatedCount === 1 && CONTENT(r.messages[1]).startsWith(STALE_PLACEHOLDER_MARK) && CONTENT(r.messages[2]) === '数据 v',
      '✓ id 缺失 → 按序兜底配对:仅首个 read_page 占位,数据 read 保留')
  }

  // 5. PAGE_READ_TOOLS 常量完整性(与提案口径一致;take_screenshot 计入 A2)
  assert(PAGE_READ_TOOLS.has('take_screenshot') && !PAGE_READ_TOOLS.has('read') && !PAGE_READ_TOOLS.has('query_data'),
    '✓ PAGE_READ_TOOLS → 页面五工具,数据读不在内(take_screenshot 计入 A2 口径)')
}
