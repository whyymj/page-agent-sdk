import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
import { offloadLargeResult } from '../../utils/offload'
import { createVfs, createVfsTools } from '../../backends/vfs'

import type { TestCtx } from './_ctx'

// dataOps:write(edit)+ 快照(单主对象)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[dataOps edit + snapshot]')
  {
    // 主数据:含对象/数组/叶子字段(edit 仅作用于对象/数组;叶子用 write(value) 整体替换)
    const appObj: any = {
      cfg: { a: 1, name: 'x' },
      list: [{ id: 1, text: 'a' }, { id: 2, text: 'b' }],
      theme: 'light' as 'light' | 'dark',
    }
    const tools = createDataOps({
      schema: z.object({
        cfg: z.object({ a: z.number(), name: z.string(), extra: z.string().optional(), doc: z.string().min(10).optional() }),
        list: z.array(z.object({ id: z.number(), text: z.string() })),
        theme: z.enum(['light', 'dark']),
      }),
      bind: appObj,
      description: '应用配置',
    })
    const t = byName(tools)
    let r: string

    // write(edit) set 子字段(jsonPath 相对主数据根)
    r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'cfg.a', value: '99' } })
    assert(appObj.cfg.a === 99 && /已 write\(edit\)/.test(r), 'edit set 子字段生效')

    // write(edit) merge 合并
    r = await invoke(t['write'], { patch: { op: 'merge', jsonPath: 'cfg', value: '{"extra":"hi"}' } })
    assert(appObj.cfg.extra === 'hi', 'edit merge 合并字段')

    // write(edit) append 追加
    r = await invoke(t['write'], { patch: { op: 'append', jsonPath: 'list', value: '{"id":3,"text":"c"}' } })
    assert(appObj.list.length === 3 && appObj.list[2].id === 3, 'edit append 追加元素')

    // write(edit) append 字符串拼接(chunked-code-write:大 code 分块写入,单次输出脱离 max_tokens 约束)
    r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'cfg.name', value: '"<html><head>"' } })
    assert(appObj.cfg.name === '<html><head>', 'append 前置:set 首块到字符串字段')
    r = await invoke(t['write'], { patch: { op: 'append', jsonPath: 'cfg.name', value: '"<style>body{}</style>"' } })
    assert(/已 write\(edit\)/.test(r) && appObj.cfg.name === '<html><head><style>body{}</style>', 'edit append 字符串拼接(第二块尾接)')
    r = await invoke(t['write'], { patch: { op: 'append', jsonPath: 'cfg.name', value: '"</head><body></body></html>"' } })
    assert(appObj.cfg.name === '<html><head><style>body{}</style></head><body></body></html>', 'edit append 字符串多块累积(三块成完整文档)')
    // 类型不匹配:字符串目标 append 非字符串 → 结构化错误,live 不变
    const nameBefore = appObj.cfg.name
    r = await invoke(t['write'], { patch: { op: 'append', jsonPath: 'cfg.name', value: '123' } })
    assert(/PATCH_FAILED/.test(r) && /字符串/.test(r) && appObj.cfg.name === nameBefore, 'append 字符串目标 + 非字符串 value → PATCH_FAILED 提示拼接语义(live 不变)')

    // 同批 set+append 字符串路径(deferred 修:校验取 clone 批内中间态,不取 bindRef 写前值;chunked-code-write 首块+次块并进一个 patches 批实测)
    // 修前形态①:live 非字符串(undefined)→ 走数组分支「放行」+ appendElems 写回 no-op → 次块被静默丢弃
    r = await invoke(t['write'], { patches: [{ op: 'set', jsonPath: 'cfg.doc', value: '"<html><head>"' }, { op: 'append', jsonPath: 'cfg.doc', value: '"</head>"' }] })
    assert(appObj.cfg.doc === '<html><head></head>', '同批 set+append 字符串拼接生效(修前次块被静默丢弃)')
    // 修前形态②:live 是字符串但校验「写前值+chunk」→ 中间态裸 chunk 撞 min 误拒;修后校验累积终值
    appObj.cfg.doc = ''  // 直改 bind 模拟既有空串(不经写路径,绕开 min 校验)
    r = await invoke(t['write'], { patches: [{ op: 'append', jsonPath: 'cfg.doc', value: '"aaaaa"' }, { op: 'append', jsonPath: 'cfg.doc', value: '"bbbbb"' }] })
    assert(/已 write\(edit\)/.test(r) && appObj.cfg.doc === 'aaaaabbbbb', '同批多 append 按累积终值校验(修前按写前值拼裸 chunk,5+5 分块撞 min(10) 整批误拒)')
    // 修前形态③:双写 —— set 写回带全批终值 + append 再重放 → 内容重复(修前 [set+append] 实测 AAABBBBBB / [a,b,c,c])
    r = await invoke(t['write'], { patches: [{ op: 'set', jsonPath: 'cfg.name', value: '"AAA"' }, { op: 'append', jsonPath: 'cfg.name', value: '"BBB"' }] })
    assert(appObj.cfg.name === 'AAABBB', '同批 set+append 字符串不双写(修前 set 终值 + append 重放 = AAABBBBBB)')
    r = await invoke(t['write'], { patches: [{ op: 'set', jsonPath: 'list', value: '[{"id":1,"text":"a"},{"id":2,"text":"b"}]' }, { op: 'append', jsonPath: 'list', value: '{"id":3,"text":"c"}' }] })
    assert(appObj.list.length === 3 && appObj.list[2].id === 3, '同批 set+append 数组不双写(修前 append 元素重放两次 = [a,b,c,c])')

    // write(edit) remove 删字段
    r = await invoke(t['write'], { patch: { op: 'remove', jsonPath: 'cfg.extra' } })
    assert(!('extra' in appObj.cfg), 'edit remove 删字段')

    // write(edit) schema 失败 → live 不变(校验在副本,失败不入栈不落地)
    const beforeA = appObj.cfg.a
    r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'cfg.a', value: '"not a number"' } })
    assert(/SCHEMA_INVALID/.test(r) && appObj.cfg.a === beforeA, 'edit 校验失败 live 未变(结构化错误码)')

    // write(edit) 不安全路径:PATH_UNSAFE
    r = await invoke(t['write'], { patch: { op: 'set', jsonPath: '__proto__.x', value: '1' } })
    assert(/PATH_UNSAFE/.test(r), 'edit __proto__ → PATH_UNSAFE')

    // 自动快照:set/edit 前自动入栈 → history_data list 有记录(吸收已移除的 list_data_snapshots)
    r = await invoke(t['history_data'], { list: true })
    assert(/#1/.test(r) && /时间线/.test(r), 'history_data({list:true}) 列出自动快照(返回时间线格式,吸收 list_data_snapshots)')

    // restore 到 #1(初始 a=1),先破坏再回退
    appObj.cfg.a = 99999
    r = await invoke(t['restore_data'], { id: 1 })
    assert(appObj.cfg.a === 1, 'restore_data 回退到指定快照(初始 a=1)')

    // restore 不入栈:已有快照保留(history_data list 仍可见)
    r = await invoke(t['history_data'], { list: true })
    assert(/#1/.test(r), 'restore 不入栈(history_data list 仍列出已有快照)')

    // read 支持读后代子路径(精确读局部,而非整体)
    r = await invoke(t['read'], { jsonPath: 'cfg.a' })
    assert(/cfg\.a = 1/.test(r), 'read 读后代子路径(局部)')

    // read 读整个主数据
    r = await invoke(t['read'], {})
    assert(/cfg/.test(r) && /list/.test(r), 'read 不传 jsonPath 读整个主数据')
  }

  // ============ 工具报错机制(结构化 ERROR:{json},供 LLM 排查)============
  console.log('\n[tool errors]')
  {
    const appObj: any = { theme: 'dark', count: 5, cfg: { a: 1 } }
    const tools = createDataOps({
      schema: z.object({
        theme: z.enum(['light', 'dark']),
        count: z.number().int().min(0),
        cfg: z.object({ a: z.number(), name: z.string().optional() }),
      }),
      bind: appObj,
      description: '应用配置',
    })
    const t = byName(tools)

    // schema 失败:details 含 zod issues(path/expected/received)
    let r = await invoke(t['write'], { value: '{ "theme":"dark","count":"x","cfg":{"a":1} }' })
    assert(/"error":\s*"SCHEMA_INVALID"/.test(r), 'schema 失败 → error=SCHEMA_INVALID')
    const detailMatch = r.match(/"details":\s*(\[[^\]]*\])/)
    assert(detailMatch && /expected/.test(detailMatch[1]) && /received/.test(detailMatch[1]), 'schema 失败 details 含 zod issue 的 expected/received')

    // JSON 解析失败:带原解析错误 + 预览
    r = await invoke(t['write'], { value: '{bad' })
    assert(/"error":\s*"JSON_PARSE"/.test(r) && /预览|bad/.test(r), 'JSON 解析失败 → error=JSON_PARSE + 预览')

    // edit 非对象(叶子 theme):NOT_OBJECT + hint 指向 set
    r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'theme.x', value: '1' } })
    // theme 是叶子字符串,edit jsonPath 'theme.x' 在叶子下设子属性 → path-scoped-validation 下
    // 'theme.x' 路径 schema 不可解析(叶子无子路径)→ 键未声明语义 → SCHEMA_STRIP 拒(叶子不可有子属性,语义等价)
    assert(/SCHEMA_INVALID|SCHEMA_STRIP|NOT_OBJECT/.test(r), 'edit 在叶子上设子属性 → schema 失败(叶子不可有子属性)')

    // edit 不安全路径:PATH_UNSAFE
    r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'cfg.__proto__.x', value: '1' } })
    assert(/"error":\s*"PATH_UNSAFE"/.test(r), 'edit __proto__ → PATH_UNSAFE')

    // query 语法错误:JSONPATH_SYNTAX + details.expr
    r = await invoke(t['query_data'], { expr: '$[?(@.x==' })
    assert(/"error":\s*"JSONPATH_SYNTAX"/.test(r) && /"expr"/.test(r), 'query 语法错 → JSONPATH_SYNTAX + details.expr')

    // 正常成功:不是 ERROR 前缀
    r = await invoke(t['read'], { jsonPath: 'theme' })
    assert(!/^ERROR:/.test(r) && /dark/.test(r), '正常读不返回 ERROR 前缀')
  }

  // ============ vfs 报错(正则/glob 不抛,edit 多匹配给位置)============
  console.log('\n[vfs errors]')
  {
    const vfs = createVfs({ 'a.txt': 'line1 foo\nline2 foo\nline3 bar' })
    const tools = createVfsTools(vfs)
    const t = byName(tools)

    // grep 非法正则:返回 toolError 而非抛异常
    let r = await invoke(t['vfs_grep'], { pattern: '(' })
    assert(/"error":\s*"REGEX_INVALID"/.test(r), 'vfs_grep 非法正则 → REGEX_INVALID(不抛异常)')

    // glob 正常匹配
    r = await invoke(t['vfs_glob'], { pattern: '*.txt' })
    assert(/a\.txt/.test(r), 'vfs_glob 正常匹配 *.txt')

    // edit 多匹配:AMBIGUOUS_MATCH + matches 位置
    r = await invoke(t['vfs_edit'], { path: 'a.txt', oldString: 'foo', newString: 'baz' })
    assert(/"error":\s*"AMBIGUOUS_MATCH"/.test(r) && /"matches"/.test(r), 'vfs_edit 多匹配 → AMBIGUOUS_MATCH + matches 位置')

    // edit 未找到:NO_MATCH
    r = await invoke(t['vfs_edit'], { path: 'a.txt', oldString: 'nope', newString: 'x' })
    assert(/"error":\s*"NO_MATCH"/.test(r), 'vfs_edit 未找到 → NO_MATCH')

    // read 未找到:NOT_FOUND
    r = await invoke(t['vfs_read'], { path: 'missing.txt' })
    assert(/"error":\s*"NOT_FOUND"/.test(r), 'vfs_read 未找到 → NOT_FOUND')
  }

  // ============ offload(大结果外存)============
  console.log('\n[offload]')
  {
    // 小结果原样
    const small = offloadLargeResult('hello', { toolName: 't', vfsAvailable: true, files: {} })
    assert(small.content === 'hello' && small.offloaded === undefined, '小结果(≤阈值)原样返回(.content,无 offloaded 标记)')

    // 大结果 + vfs 可用 → 外存 + 预览引用 + 结构化元数据
    const big = 'x'.repeat(10000)
    const files: Record<string, { content: string; updatedAt: number }> = {}
    const offloaded = offloadLargeResult(big, { toolName: 'get_x', vfsAvailable: true, files, threshold: 6000 })
    const keys = Object.keys(files)
    assert(offloaded.offloaded === true && offloaded.path?.includes('get_x') && offloaded.totalChars === 10000, '大结果+vfs可用 → offloaded=true + path + totalChars 结构化元数据')
    assert(/已转存到虚拟工作区/.test(offloaded.content) && keys.length === 1, '大结果+vfs可用 → .content 含预览引用 + 外存 1 文件')
    assert(files[keys[0]].content === big && /get_x/.test(keys[0]), '外存内容完整 + 文件名含工具名')

    // 大结果 + vfs 不可用 → 按放行上限
    const passThrough = offloadLargeResult(big, { toolName: 't', vfsAvailable: false, threshold: 6000, passThroughChars: 20000 })
    assert(passThrough.content === big && passThrough.offloaded === undefined, 'vfs 不可用 + 结果 ≤ 放行上限 → 完整放行(.content 原样)')
    const stillTruncated = offloadLargeResult(big, { toolName: 't', vfsAvailable: false, threshold: 6000, passThroughChars: 5000 })
    assert(/已截断/.test(stillTruncated.content) && stillTruncated.content.length < big.length && stillTruncated.offloaded === false, 'vfs 不可用 + 结果 > 放行上限 → 截断兜底(offloaded=false)')
    const defaultTrunc = offloadLargeResult(big, { toolName: 't', vfsAvailable: false, threshold: 6000 })
    assert(/已截断/.test(defaultTrunc.content), 'vfs 不可用 + 未传 passThrough → 默认截断(= threshold)')

    // 内容寻址去重:相同内容 → 相同文件名,反复外存不新增文件
    const files2: Record<string, { content: string; updatedAt: number }> = {}
    const bigA = 'A'.repeat(10000)
    offloadLargeResult(bigA, { toolName: 'load_skill', vfsAvailable: true, files: files2, threshold: 6000 });
    const keys1 = Object.keys(files2)
    offloadLargeResult(bigA, { toolName: 'load_skill', vfsAvailable: true, files: files2, threshold: 6000 });
    const keys2 = Object.keys(files2)
    assert(keys1.length === 1 && keys2.length === 1 && keys1[0] === keys2[0], '内容寻址去重:相同内容 → 相同文件名,反复外存不新增文件')
    assert(files2[keys1[0]].content === bigA, '外存内容完整')
    // 不同内容 → 不同文件名
    const bigB = 'B'.repeat(10000)
    offloadLargeResult(bigB, { toolName: 'load_skill', vfsAvailable: true, files: files2, threshold: 6000 })
    assert(Object.keys(files2).length === 2, '不同内容 → 不同文件名(各一份)')
  }
}
