/**
 * sec-99:stale-read-invalidation Phase 1(readInvalidation 纯函数白盒)
 * 覆盖(对应 proposal 验收 1):等值/祖先/后代失效 / set 兄弟不失效 / remove·move·del 兄弟失效(父数组前缀)/
 * root 读被任意写失效 / root 写失效一切 / jsonPaths 全量提取不误判 root / query expr 前缀定界 /
 * search 恒 root / components vs components2 分隔符 / resource_* 排除 / 幂等重跑 /
 * 同批串行序([write,read] 不失效、[read,write] 失效、并发全失效)/ ERROR: 字符串写经 writeGate 组合跳过 /
 * 占位文案分语(窄读 vs 重跑 query;del 不引用新值)/ id 缺失顺序兜底配对。
 */
import type { TestCtx } from './_ctx'
import { AIMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages'
import { invalidateStaleReads, effectiveWritePaths, extractReadPaths, STALE_PLACEHOLDER_MARK, type StaleWriteRecord } from '../../harness/readInvalidation'
import { isSuccessfulWriteResult } from '../../harness/writeGate'

/** 造一轮「工具调用 + 结果」消息对(读侧 content 模拟 read 输出) */
function mkRound(calls: Array<{ id?: string; name: string; args: Record<string, unknown> }>, contents: string[]): BaseMessage[] {
  const ai = new AIMessage({
    content: '',
    tool_calls: calls.map((c, i) => ({ id: c.id ?? `call_${i}`, name: c.name, args: c.args, type: 'tool_call' as const })),
  })
  const tools = calls.map((c, i) => new ToolMessage({ tool_call_id: c.id ?? `call_${i}`, content: contents[i] ?? 'ok' }))
  return [ai, ...tools]
}

const W = (name: string, args: Record<string, unknown>, callIndex?: number): StaleWriteRecord => ({ name, args, callIndex })
const CONTENT = (m: BaseMessage): string => String((m as unknown as { content?: unknown }).content ?? '')

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // 1. 基本失效:read components.0 → write set components.0.props.title → 占位替换 + 保留 tool_call_id
  {
    const messages = [
      ...mkRound([{ name: 'read', args: { jsonPath: 'components.0' } }], ['主数据 @ components.0 = {...} (hash=aaa)']),
      ...mkRound([{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.props.title', value: 'x' } } }], ['已 write(edit) 主数据(1 个 patch)。当前值:{...} (新 hash=bbb)']),
    ]
    const r = invalidateStaleReads(messages, [W('write', { patch: { op: 'set', jsonPath: 'components.0.props.title', value: 'x' } })], { round: 2 })
    assert(r.invalidatedCount === 1, `✓ 失效 → read 后写同子树失效(实测 ${r.invalidatedCount})`)
    const tm = r.messages[1] as ToolMessage
    assert(CONTENT(tm).startsWith(STALE_PLACEHOLDER_MARK), '✓ 失效 → 占位替换 content')
    assert((tm as unknown as { tool_call_id?: string }).tool_call_id === 'call_0', '✓ 失效 → 保留 tool_call_id(结构完整)')
    assert(CONTENT(tm).includes('components.0'), '✓ 失效 → 文案钉原读路径')
    assert(CONTENT(tm).includes('第 2 轮'), '✓ 失效 → 文案引用写轮次')
    assert(CONTENT(tm).includes('建议窄读:components.0'), '✓ 失效 → read 分语 = 窄读引导')
    assert(CONTENT(tm).includes('最新值与新 hash'), '✓ 失效 → 引用写入结果新值+hash(反 thrash)')
    // 原数组不动(纯函数)
    assert(CONTENT(messages[1]).includes('hash=aaa'), '✓ 失效 → 纯函数不改原数组')
  }

  // 2. 祖先/后代/等值;兄弟(set)不失效
  {
    const mk = (readPath: string) => [
      ...mkRound([{ name: 'read', args: { jsonPath: readPath } }], ['v']),
      ...mkRound([{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.props.title', value: 'x' } } }], ['ok']),
    ]
    const wargs = { patch: { op: 'set', jsonPath: 'components.0.props.title', value: 'x' } }
    assert(invalidateStaleReads(mk('components.0.props.title'), [W('write', wargs)]).invalidatedCount === 1, '✓ 重叠 → 等值路径失效')
    assert(invalidateStaleReads(mk('components.0'), [W('write', wargs)]).invalidatedCount === 1, '✓ 重叠 → 读为写祖先失效')
    assert(invalidateStaleReads(mk('components.0.props.title.extra'), [W('write', wargs)]).invalidatedCount === 1, '✓ 重叠 → 读为写后代失效(= 写为读祖先,同一关系)')
    assert(invalidateStaleReads(mk('components.1'), [W('write', wargs)]).invalidatedCount === 0, '✓ 重叠 → set 兄弟不失效')
    // components vs components2 分隔符纪律
    assert(invalidateStaleReads(mk('components2'), [W('write', { patch: { op: 'set', jsonPath: 'components', value: 1 } })]).invalidatedCount === 0, '✓ 重叠 → components 不误配 components2')
    assert(invalidateStaleReads(mk('components'), [W('write', { patch: { op: 'set', jsonPath: 'components2', value: 1 } })]).invalidatedCount === 0, '✓ 重叠 → components2 不误配 components')
  }

  // 3. remove/move/del/delete_data 兄弟失效(父数组前缀)
  {
    const mkMsg = () => [
      ...mkRound([{ name: 'read', args: { jsonPath: 'components.1' } }], ['v']),
      ...mkRound([{ name: 'write', args: {} }], ['ok']),
    ]
    assert(invalidateStaleReads(mkMsg(), [W('write', { patch: { op: 'remove', jsonPath: 'components.0' } })]).invalidatedCount === 1, '✓ 位移 → remove 兄弟失效(索引错位)')
    assert(invalidateStaleReads(mkMsg(), [W('write', { patch: { op: 'move', jsonPath: 'components.0', value: 'components.3' } })]).invalidatedCount === 1, '✓ 位移 → move 兄弟失效')
    assert(invalidateStaleReads(mkMsg(), [W('write', { patch: { jsonPath: 'components.0' }, del: true })]).invalidatedCount === 1, '✓ 位移 → write del 兄弟失效')
    assert(invalidateStaleReads(mkMsg(), [W('delete_data', { jsonPath: 'components.0' })]).invalidatedCount === 1, '✓ 位移 → delete_data 兄弟失效')
    // move 目标路径也入失效面:读 target 后代失效、target 兄弟失效;路径外不失效
    const moveW = W('write', { patch: { op: 'move', jsonPath: 'components.0', value: 'settings.list.2' } })
    assert(invalidateStaleReads([...mkRound([{ name: 'read', args: { jsonPath: 'settings.list.2' } }], ['v']), ...mkRound([{ name: 'write', args: {} }], ['ok'])], [moveW]).invalidatedCount === 1, '✓ 位移 → move 目标路径失效')
    assert(invalidateStaleReads([...mkRound([{ name: 'read', args: { jsonPath: 'settings.other' } }], ['v']), ...mkRound([{ name: 'write', args: {} }], ['ok'])], [moveW]).invalidatedCount === 0, '✓ 位移 → move 路径外不失效')
    // set 不登记父数组:兄弟安全(对照组)
    assert(invalidateStaleReads(mkMsg(), [W('write', { patch: { op: 'set', jsonPath: 'components.0.props.title', value: 'x' } })]).invalidatedCount === 0, '✓ 位移 → set 对照组兄弟仍安全')
  }

  // 4. root 读被任意写失效;root 写失效一切
  {
    const rootRead = [...mkRound([{ name: 'read', args: {} }], ['desc']), ...mkRound([{ name: 'write', args: {} }], ['ok'])]
    assert(invalidateStaleReads(rootRead, [W('write', { patch: { op: 'set', jsonPath: 'settings.title', value: 'x' } })]).invalidatedCount === 1, '✓ root → root 读被任意写失效')
    const subRead = [...mkRound([{ name: 'read', args: { jsonPath: 'components.0' } }], ['v']), ...mkRound([{ name: 'write', args: {} }], ['ok'])]
    assert(invalidateStaleReads(subRead, [W('write', { value: { a: 1 } })]).invalidatedCount === 1, '✓ root → root 写(整体 set)失效一切')
    assert(invalidateStaleReads(subRead, [W('set_data', { value: { a: 1 } })]).invalidatedCount === 1, '✓ root → set_data 整体写失效一切')
  }

  // 5. jsonPaths 全量提取(不误判 root)
  {
    const mkMsg = () => [...mkRound([{ name: 'read', args: { jsonPaths: ['components.0', 'meta.x'] } }], ['多路径读取(共 2 项)']), ...mkRound([{ name: 'write', args: {} }], ['ok'])]
    assert(invalidateStaleReads(mkMsg(), [W('write', { patch: { op: 'set', jsonPath: 'meta', value: 1 } })]).invalidatedCount === 1, '✓ jsonPaths → 多路径任一命中(祖先重叠)即失效')
    assert(invalidateStaleReads(mkMsg(), [W('write', { patch: { op: 'set', jsonPath: 'settings.z', value: 1 } })]).invalidatedCount === 0, '✓ jsonPaths → 全不命中不失效(修复:不误判 root)')
    // get_data 同口径
    const g = [...mkRound([{ name: 'get_data', args: { jsonPaths: ['components.0'] } }], ['v']), ...mkRound([{ name: 'write', args: {} }], ['ok'])]
    assert(invalidateStaleReads(g, [W('write', { patch: { op: 'set', jsonPath: 'settings.z', value: 1 } })]).invalidatedCount === 0, '✓ jsonPaths → get_data jsonPaths 非空不判 root')
    const g2 = [...mkRound([{ name: 'get_data', args: {} }], ['v']), ...mkRound([{ name: 'write', args: {} }], ['ok'])]
    assert(invalidateStaleReads(g2, [W('write', { patch: { op: 'set', jsonPath: 'settings.z', value: 1 } })]).invalidatedCount === 1, '✓ jsonPaths → get_data 无参 = root 读')
  }

  // 6. query_data expr 前缀定界;search_data 恒 root;分语文案
  {
    const qMsg = [...mkRound([{ name: 'query_data', args: { expr: '$.components[?(@.type=="card")]' } }], ['matched 2']), ...mkRound([{ name: 'write', args: {} }], ['ok'])]
    assert(invalidateStaleReads(qMsg, [W('write', { patch: { op: 'set', jsonPath: 'components.2.props.x', value: 1 } })]).invalidatedCount === 1, '✓ query → 前缀内写失效')
    assert(invalidateStaleReads(qMsg, [W('write', { patch: { op: 'set', jsonPath: 'settings.title', value: 1 } })]).invalidatedCount === 0, '✓ query → 前缀外写不失效(editor「查索引→改属性」不必重查)')
    const rq = invalidateStaleReads(qMsg, [W('write', { patch: { op: 'set', jsonPath: 'components.2.props.x', value: 1 } })])
    assert(CONTENT(rq.messages[1]).includes('重跑 query_data'), '✓ query → 分语文案「重跑 query_data」')
    assert(!CONTENT(rq.messages[1]).includes('建议窄读'), '✓ query → 不引导 read(query 结果 read 重建不了)')
    // 递归/通配 expr → 前缀截断为 root(保守)
    const recMsg = [...mkRound([{ name: 'query_data', args: { expr: '$..title' } }], ['v']), ...mkRound([{ name: 'write', args: {} }], ['ok'])]
    assert(invalidateStaleReads(recMsg, [W('write', { patch: { op: 'set', jsonPath: 'settings.title', value: 1 } })]).invalidatedCount === 1, '✓ query → 递归 expr 前缀截断为 root(任意写失效)')
    // 非法 expr 保守 root
    const badMsg = [...mkRound([{ name: 'query_data', args: { expr: '$$$[' } }], ['v']), ...mkRound([{ name: 'write', args: {} }], ['ok'])]
    assert(invalidateStaleReads(badMsg, [W('write', { patch: { op: 'set', jsonPath: 'a.b', value: 1 } })]).invalidatedCount === 1, '✓ query → 非法 expr 保守按 root')
    // search 恒 root
    const sMsg = [...mkRound([{ name: 'search_data', args: { query: 'x' } }], ['matched 1']), ...mkRound([{ name: 'write', args: {} }], ['ok'])]
    const rs = invalidateStaleReads(sMsg, [W('write', { patch: { op: 'set', jsonPath: 'settings.title', value: 1 } })])
    assert(rs.invalidatedCount === 1, '✓ search → 恒 root(任意写失效)')
    assert(CONTENT(rs.messages[1]).includes('重跑 search_data'), '✓ search → 分语文案「重跑 search_data」')
  }

  // 7. resource_* 排除 + 空写集原样返回
  {
    const msg = [...mkRound([{ name: 'read', args: { jsonPath: 'components.0' } }], ['v']), ...mkRound([{ name: 'write', args: {} }], ['ok'])]
    const r = invalidateStaleReads(msg, [W('resource_update', { path: 'components.0', value: 'x' })])
    assert(r.invalidatedCount === 0 && r.messages === msg, '✓ 排除 → resource_update 不触发(资源池 path 非数据 jsonPath)')
    assert(invalidateStaleReads(msg, [W('resource_delete', { path: 'components.0' })]).invalidatedCount === 0, '✓ 排除 → resource_delete 不触发')
    assert(invalidateStaleReads(msg, []).messages === msg, '✓ 排除 → 空写集原样引用返回')
  }

  // 8. 幂等重跑:已占位不再二次处理
  {
    const messages = [
      ...mkRound([{ name: 'read', args: { jsonPath: 'components.0' } }], ['v']),
      ...mkRound([{ name: 'write', args: {} }], ['ok']),
    ]
    const wargs = { patch: { op: 'set', jsonPath: 'components.0.props.title', value: 'x' } }
    const r1 = invalidateStaleReads(messages, [W('write', wargs)], { round: 2 })
    const c1 = CONTENT(r1.messages[1])
    const r2 = invalidateStaleReads(r1.messages, [W('write', wargs)], { round: 3 })
    assert(r2.invalidatedCount === 0, `✓ 幂等 → 重跑不重复计数(实测 ${r2.invalidatedCount})`)
    assert(CONTENT(r2.messages[1]) === c1, '✓ 幂等 → 已占位内容不被改写(轮次引用不漂移)')
  }

  // 9. 同批串行序:写后读不失效 / 读后写失效 / 并发全失效
  {
    // 同一 AIMessage 内 [write@0, read@1](串行执行序 = 声明序):read 反映写后状态
    const after = [
      new AIMessage({ content: '', tool_calls: [
        { id: 'w', name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.title', value: 'x' } }, type: 'tool_call' },
        { id: 'r', name: 'read', args: { jsonPath: 'components.0' }, type: 'tool_call' },
      ] }),
      new ToolMessage({ tool_call_id: 'w', content: '已 write (新 hash=bbb)' }),
      new ToolMessage({ tool_call_id: 'r', content: '主数据 @ components.0 = 新值 (hash=bbb)' }),
    ]
    const wAfter = W('write', { patch: { op: 'set', jsonPath: 'components.0.title', value: 'x' } }, 0)
    assert(invalidateStaleReads(after, [wAfter]).invalidatedCount === 0, '✓ 串行序 → 同批 [write, read] 写后读不失效')
    assert(invalidateStaleReads(after, [wAfter], { maxParallelTools: 2 }).invalidatedCount === 1, '✓ 串行序 → 并发同批全失效(顺序未定义)')
    // [read@0, write@1]:读在写前 → 失效
    const before = [
      new AIMessage({ content: '', tool_calls: [
        { id: 'r', name: 'read', args: { jsonPath: 'components.0' }, type: 'tool_call' },
        { id: 'w', name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.title', value: 'x' } }, type: 'tool_call' },
      ] }),
      new ToolMessage({ tool_call_id: 'r', content: '旧值' }),
      new ToolMessage({ tool_call_id: 'w', content: 'ok' }),
    ]
    assert(invalidateStaleReads(before, [W('write', { patch: { op: 'set', jsonPath: 'components.0.title', value: 'x' } }, 1)]).invalidatedCount === 1, '✓ 串行序 → 同批 [read, write] 读在写前失效')
  }

  // 10. ERROR: 字符串写经 writeGate 组合跳过(Phase 0 判定 = 失效触发的地基)
  {
    const messages = [
      ...mkRound([{ name: 'read', args: { jsonPath: 'components.0' } }], ['v']),
      ...mkRound([{ name: 'write', args: {} }], ['ERROR: {"code":"SCHEMA_INVALID","message":"校验失败未写入"}']),
    ]
    const tool = { name: 'write', writeCapable: true } as Record<string, unknown> & { name: string }
    const args = { patch: { op: 'set', jsonPath: 'components.0.title', value: 'x' } }
    // 失败写(content ERROR: 前缀)→ isSuccessfulWriteResult false → 不进 writes → 不失效
    assert(isSuccessfulWriteResult(tool, args, { content: 'ERROR: {"code":"SCHEMA_INVALID"}', status: 'done' }) === false, '✓ ERROR 跳过 → writeGate 判定失败写为 false')
    assert(invalidateStaleReads(messages, []).invalidatedCount === 0, '✓ ERROR 跳过 → SCHEMA_INVALID 字符串写不触发失效(不产假事实)')
    // dryRun 同理不进
    assert(isSuccessfulWriteResult(tool, { ...args, dryRun: true }, { content: 'dryRun(set): 预检通过', status: 'done' }) === false, '✓ ERROR 跳过 → dryRun 不算成功写')
  }

  // 11. del 写占位不引用新值(hasPostValue false 不撒谎)
  {
    const messages = [
      ...mkRound([{ name: 'read', args: { jsonPath: 'components.1' } }], ['v']),
      ...mkRound([{ name: 'write', args: {} }], ['已删除主数据 @ components.0']),
    ]
    const r = invalidateStaleReads(messages, [W('write', { patch: { jsonPath: 'components.0' }, del: true })])
    const c = CONTENT(r.messages[1])
    assert(r.invalidatedCount === 1, '✓ del 文案 → del 写触发兄弟失效')
    assert(!c.includes('最新值与新 hash'), '✓ del 文案 → 不引用「已含新值+hash」(del 无值不撒谎)')
    assert(c.includes('仍为读取时原值可参考'), '✓ del 文案 → 兄弟子树提示保留')
  }

  // 12. id 缺失顺序兜底配对(宁漏勿误:失配跳过)
  {
    const messages = [
      new AIMessage({ content: '', tool_calls: [
        { name: 'read', args: { jsonPath: 'components.0' }, type: 'tool_call' },
      ] }),
      new ToolMessage({ content: 'v' }), // 无 tool_call_id
      ...mkRound([{ name: 'write', args: {} }], ['ok']),
    ]
    assert(invalidateStaleReads(messages, [W('write', { patch: { op: 'set', jsonPath: 'components.0.title', value: 'x' } })]).invalidatedCount === 1, '✓ 兜底配对 → id 缺失按顺序配对仍识别 read')
  }

  // 13. 纯函数单元:effectiveWritePaths / extractReadPaths 直测
  {
    const e1 = effectiveWritePaths(W('write', { patch: { op: 'remove', jsonPath: 'components.2' } }))
    // op=remove 在 write edit 内:结果仍带「当前值+新 hash」→ hasPostValue true;仅 del:true/delete_data 无值
    assert(e1 !== null && e1.paths.includes('components') && e1.paths.includes('components.2') && e1.hasPostValue === true, '✓ 展开单元 → remove 登记 [path, 父数组](write edit 结果仍带新值)')
    const e2 = effectiveWritePaths(W('write', { value: { a: 1 } }))
    assert(e2 !== null && e2.paths.length === 1 && e2.paths[0] === '', '✓ 展开单元 → 整体 set = ROOT')
    assert(effectiveWritePaths(W('resource_update', { path: 'x' })) === null, '✓ 展开单元 → resource_update 返回 null')
    assert(JSON.stringify(extractReadPaths('read', { jsonPath: 'components.0' })) === JSON.stringify(['components.0']), '✓ 读取单元 → read 单路径归一')
    assert(JSON.stringify(extractReadPaths('read', {})) === JSON.stringify(['']), '✓ 读取单元 → read 无参 = ROOT')
    assert(JSON.stringify(extractReadPaths('query_data', { expr: '$.components[0].name' })) === JSON.stringify(['components.0.name']), '✓ 读取单元 → expr 索引段进前缀')
    assert(JSON.stringify(extractReadPaths('query_data', { expr: '$.components[*].id' })) === JSON.stringify(['components']), '✓ 读取单元 → 通配截断前缀')
  }
}
