import { detectGarbledToolCall, parseGarbledToolCalls, detectTransitionalReply } from '../../harness/createAgent'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  assert(detectGarbledToolCall('<｜tool_calls｜>') === true, 'DeepSeek tool_calls tag detected')
  assert(detectGarbledToolCall('<invoke name="set_data">') === true, 'invoke name tag detected')
  assert(detectGarbledToolCall('<tool_call>') === true, 'tool_call tag detected')
  assert(detectGarbledToolCall('<function_call>') === true, 'function_call tag detected')
  // DeepSeek-v4 长 tool-call 链下退化的 DSML / tool 段标记(实测 ?deep=1 暴露,此前漏匹配致静默截断)
  assert(detectGarbledToolCall('<｜｜DSML｜｜>invoke') === true, 'DeepSeek-v4 DSML tag detected(长 tool-call 链退化标记)')
  assert(detectGarbledToolCall('<｜｜DSML｜｜>') === true, 'DSML tag alone detected')
  assert(detectGarbledToolCall('<｜tool｜>') === true, 'DeepSeek tool segment tag detected')
  assert(detectGarbledToolCall('<｜tool_begin｜>') === true, 'DeepSeek tool_begin tag detected')
  assert(detectGarbledToolCall('') === false, 'empty content not garbled')
  assert(detectGarbledToolCall('normal reply text') === false, 'normal text not garbled')
  assert(detectGarbledToolCall('please use set_data to update') === false, 'normal mention of tool name not garbled')
  assert(detectGarbledToolCall('已为你把标题改成「测试」。') === false, 'normal Chinese reply not garbled')

  // ===== parseGarbledToolCalls(#95 升级:检测重试 → 解析为 tool_call) =====
  // fix-write-safety-bypass(P0-2):仅强守卫标记(DeepSeek 内部 token)才自动解析执行;
  // 无守卫的纯伪 XML <invoke> → null(降级 garbled-retry 回灌,防模型贴的示例被当真执行)。sec-46 详测围栏剥离。
  // 简单 invoke + 参数(带守卫标记 → 解析执行)
  const p1 = parseGarbledToolCalls('<｜tool_calls｜>\n<invoke name="read"><parameter name="jsonPath">title</parameter></invoke>')
  assert(p1 !== null && p1.length === 1 && p1[0].name === 'read', '✓ parseGarbledToolCalls → 守卫标记 + 解析 invoke + 单 tool_call')
  assert(p1![0].args.jsonPath === 'title', '✓ parseGarbledToolCalls → 参数 jsonPath=title(string)')

  // DSML 变体(<｜｜DSML｜｜invoke> + <｜｜DSML｜｜parameter>)+ 值类型(boolean/JSON)
  const p2 = parseGarbledToolCalls('<｜｜DSML｜｜invoke name="write"><｜｜DSML｜｜parameter name="dryRun" string="false">true</｜｜DSML｜｜parameter><｜｜DSML｜｜parameter name="value" string="false">{"title":"x"}</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke>')
  assert(p2 !== null && p2[0].name === 'write', '✓ parseGarbledToolCalls → DSML 变体解析(DeepSeek-v4 格式)')
  assert(p2![0].args.dryRun === true, '✓ parseGarbledToolCalls → 参数值 boolean(true)')
  assert((p2![0].args.value as any).title === 'x', '✓ parseGarbledToolCalls → 参数值 JSON 对象(parse)')

  // 截断(参数未闭合,值不完整) → null(交重试,不补错值);带守卫通过后才判截断
  const p3 = parseGarbledToolCalls('<｜tool_calls｜><invoke name="write"><parameter name="value">{"title":"x"')
  assert(p3 === null, '✓ parseGarbledToolCalls → 截断(参数未闭合) → null(交重试,不补错值)')

  // 多 invoke → 多 tool_call(带守卫)
  const p4 = parseGarbledToolCalls('<｜tool_calls｜><invoke name="read"><parameter name="jsonPath">a</parameter></invoke><invoke name="write"><parameter name="value">1</parameter></invoke>')
  assert(p4 !== null && p4.length === 2 && p4[0].name === 'read' && p4[1].name === 'write', '✓ parseGarbledToolCalls → 守卫 + 多 invoke(2 个 tool_call)')

  // 无守卫纯伪 XML <invoke> → null(P0-2 收紧:防示例被当真执行;交 garbled-retry 回灌)
  assert(parseGarbledToolCalls('<invoke name="read"><parameter name="jsonPath">title</parameter></invoke>') === null, '✓ parseGarbledToolCalls → 无守卫纯 <invoke> → null(P0-2 收紧,降级 garbled-retry)')

  // 非 garbled → null(不误解析)
  assert(parseGarbledToolCalls('normal text 无工具调用') === null, '✓ parseGarbledToolCalls → 非 garbled → null')
  assert(parseGarbledToolCalls('') === null, '✓ parseGarbledToolCalls → 空 → null')

  // ===== detectTransitionalReply(过程性收口检测,flash 实测驱动)=====
  {
    assert(detectTransitionalReply('好的,我先看看当前页面数据和平台规范,再委派生成。'), '✓ 实测样本:「我先看看…再委派」→ 过渡性收口')
    assert(detectTransitionalReply('好的,我先加载平台规范,看看具体的组件体系和撕边/戳的做法'), '✓ 实测样本:「我先加载…」→ 过渡性收口')
    assert(detectTransitionalReply('让我先查一下结构,稍后生成'), '✓ 「让我先…稍后」→ 过渡性收口')
    assert(!detectTransitionalReply('已生成优惠券组件,主色 #7063E7,撕边已按规范实现。'), '✓ 完成汇报(已生成)→ 不回灌')
    assert(!detectTransitionalReply('我把标题改成红色了,页面已更新,可以看看效果。还有其他要调整的吗?这句话足够长以超过阈值了吗大概还不够长'), '✓ 长文本总结(>160 字)→ 不回灌')
    assert(!detectTransitionalReply('我先分析了一下,已完成优惠券生成,规范全部命中'), '✓ 含完成动词 → 不回灌(保守面)')
    assert(!detectTransitionalReply(''), '✓ 空文本 → 不回灌')
  }

  // ===== DSML 变体解析(真 LLM 实测:flash 泄漏单竖线 <｜DSML｜invoke> + 对称闭合 <｜DSML｜/parameter>)=====
  {
    // 修前:单竖线变体 detect 命中但 parse null(闭合正则只认 </parameter>)→ 重试耗尽 → DSML 文本当结论返回主 agent
    const single = '<｜DSML｜tool_calls>\n<｜DSML｜invoke name="write">\n<｜DSML｜parameter name="data">{\"a\":1}<｜DSML｜/parameter>\n<｜DSML｜/invoke>'
    const r1 = parseGarbledToolCalls(single)
    assert(r1 && r1[0].name === 'write' && (r1[0].args as any).data.a === 1, '✓ 单竖线 DSML + 对称闭合 → 解析成功(变体归一)')
    const mixed = '<｜DSML｜tool_calls>\n<｜DSML｜invoke name="write">\n<｜DSML｜parameter name="data">{\"a\":1}</parameter>\n</invoke>'
    const r2 = parseGarbledToolCalls(mixed)
    assert(r2 && r2[0].name === 'write', '✓ 单竖线开 + XML 闭合混排 → 解析成功(闭合宽化)')
    // 截断保护回归:参数未闭合仍跳过
    const trunc = '<｜DSML｜tool_calls><｜DSML｜invoke name="write"><｜DSML｜parameter name="data">{\"a\":1'
    assert(parseGarbledToolCalls(trunc) === null, '✓ 截断 DSML(参数未闭合)→ null 交重试(原保护不回归)')
  }
}