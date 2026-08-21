/**
 * sec-95 —— imperative-zero-tool-gate 纯函数(操作祈使判定 + 事实清单 + 零等效写判定)
 *
 * 背景(G2):完结门禁只盯 todos,「拆 0 说做完」(不建 todos 直接纯文本谎报「已完成」)绕过它。
 * 三要素 AND:操作祈使句 + 本轮零写/零委派 + 纯文本非问句收尾 → 回灌「事实清单 + 双出口」。
 *
 * A. detectActionImperative 正反例(首子句动词锚定 + 只读反例优先 + 免操作词)
 * B. isZeroEffectiveWrite(写/委派任一 = 非零;read/query 不算)
 * C. buildTurnFactSheet(工具计数/写路径/失败数/todos 完成度)
 * D. mentionsLocation 出口①机械化(jsonPath/组件 id 模式)
 */
import type { TestCtx } from './_ctx'
import { detectActionImperative, isZeroEffectiveWrite, buildTurnFactSheet, buildZeroToolFeedback, mentionsLocation, detectStatusQuery, assertsCompletion, isZeroToolCalls, buildStatusQueryFeedback, type TurnToolUsage } from '../../harness/actionGate'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-95] imperative-zero-tool-gate 纯函数:操作祈使判定 + 事实清单')

  // ===== A. detectActionImperative =====
  {
    const positives = [
      '把标题改成X', '加个横幅', '添加一个 banner 组件', '重新生成', '删掉第2个组件',
      '从头做一个专题页', '帮我优化一下文案', '生成一个活动页', '把导航栏和横幅调换顺序',
      '清空所有组件', '把 navbar 的标题改成「干杯青岛」',
    ]
    for (const p of positives) {
      assert(detectActionImperative(p) === true, `✓ 祈使正例 → 「${p}」命中操作`)
    }
    const negatives = [
      '这是啥组件', '看看这个配置', '总结一下刚才做了什么', '你好',
      '确认一下刚才改的标题对不对', '帮我优化这段文案直接发我,不用写入',
      '查一下现在有几个组件', '解释一下这个字段是什么', '对比一下两种方案',
      '不用改,只是问问当前状态', '这个功能怎么用?', '刚才那个做好了吗?',
    ]
    for (const n of negatives) {
      assert(detectActionImperative(n) === false, `✓ 祈使反例 → 「${n}」不命中(只读/问句/免操作)`)
    }
    // 边界:空文本
    assert(detectActionImperative('') === false, '✓ 祈使边界 → 空文本不命中')
  }

  // ===== B. isZeroEffectiveWrite =====
  {
    const isWrite = (name: string) => ['write', 'set_data', 'edit_data', 'delete_data', 'draft_commit'].includes(name)
    const mk = (counts: Record<string, number>): TurnToolUsage => ({ counts, writePaths: [], failures: 0 })
    assert(isZeroEffectiveWrite(mk({}), isWrite) === true, '✓ 零写判定 → 零工具 = 零等效写')
    assert(isZeroEffectiveWrite(mk({ read: 2, query_data: 1, search_data: 3 }), isWrite) === true, '✓ 零写判定 → 只读工具(read/query/search)不算写')
    assert(isZeroEffectiveWrite(mk({ read: 1, write: 0 }), isWrite) === true, '✓ 零写判定 → write×0 计数为零不算')
    assert(isZeroEffectiveWrite(mk({ read: 1, write: 1 }), isWrite) === false, '✓ 零写判定 → 有写工具 = 非零')
    assert(isZeroEffectiveWrite(mk({ use_html: 1 }), isWrite) === false, '✓ 零写判定 → 委派工具(use_html)计等效写(editor 主场景)')
    assert(isZeroEffectiveWrite(mk({ spawn_agents: 1 }), isWrite) === false, '✓ 零写判定 → spawn_agents 计等效写')
    assert(isZeroEffectiveWrite(mk({ eval_script: 1 }), isWrite) === true, '✓ 零写判定 → eval_script 默认 query(条件写在标注,此桩不含)')
  }

  // ===== C. buildTurnFactSheet =====
  {
    const usage: TurnToolUsage = {
      counts: { read: 2, write: 0 },
      writePaths: [],
      failures: 0,
    }
    const isW = (name: string) => ['write', 'set_data', 'edit_data', 'delete_data', 'draft_commit'].includes(name)
    const fs1 = buildTurnFactSheet(usage, [{ status: 'pending' }, { status: 'completed' }, { status: 'pending' }], isW)
    assert(/read×2/.test(fs1) && /write×0/.test(fs1), '✓ 事实清单 → 工具按名计数')
    assert(fs1.includes('成功写入路径:无'), '✓ 事实清单 → 零写入路径明示「无」')
    assert(fs1.includes('todos:1/3 完成'), '✓ 事实清单 → todos 完成度')
    const fs2 = buildTurnFactSheet({ counts: {}, writePaths: ['components.2.props.title'], failures: 1 }, [])
    assert(fs2.includes('components.2.props.title') && fs2.includes('失败/回灌 1'), '✓ 事实清单 → 写入路径 + 失败计数')
    assert(fs2.includes('无 todos'), '✓ 事实清单 → 空 todos 明示「无 todos」')
    // 回灌文案要素
    const fb = buildZeroToolFeedback(fs1)
    assert(fb.includes('没有任何写入或委派操作') && fb.includes(fs1), '✓ 回灌文案 → 含事实清单段')
    assert(fb.includes('逐项说明改动位置') && fb.includes('继续执行') && fb.includes('如实说明'), '✓ 回灌文案 → 三出口齐全(说明位置/继续/如实)')
  }

  // ===== D. mentionsLocation(出口①机械化)=====
  {
    assert(mentionsLocation('已修改 components.2 的标题') === true, '✓ 出口① → components.N 路径命中')
    assert(mentionsLocation('改动在 navbar 组件的 props.title 路径') === true, '✓ 出口① → 「路径」字样命中')
    assert(mentionsLocation('改好了') === false, '✓ 出口① → 空泛收口不命中(仍回灌)')
    assert(mentionsLocation('已完成全部修改,数据都在') === false, '✓ 出口① → 无位置说明不命中')
  }

  // ===== E. status-query-zero-verify-gate(状态询问零核实断言门禁,editor 实测 2026-08-21)=====
  {
    // detectStatusQuery:editor 实测原句「写到了哪里」必命中
    assert(detectStatusQuery('写到了哪里') === true, '✓ 状态询问 → 「写到了哪里」命中(editor 实测原句)')
    assert(detectStatusQuery('完成了吗') === true, '✓ 状态询问 → 「完成了吗」命中')
    assert(detectStatusQuery('页面要移动端效果') === false, '✓ 状态询问 → 操作指令不命中')
    assert(detectStatusQuery('组件的属性是什么') === false, '✓ 状态询问 → 概念问句不命中(答历史知识无需核实)')
    // assertsCompletion:断言词命中/如实回答不命中
    assert(assertsCompletion('htmlCode ✅ 已写入,cssCode 已写入') === true, '✓ 完成断言 → 「已写入」命中')
    assert(assertsCompletion('JS代码没有写入成功,jsCode 是空字符串') === false, '✓ 完成断言 → 如实报告「未写入」不命中')
    // isZeroToolCalls:连 read 都没有才算零核实
    assert(isZeroToolCalls({ counts: {}, writePaths: [], failures: 0 }) === true, '✓ 零核实 → 零工具命中')
    assert(isZeroToolCalls({ counts: { read: 1 }, writePaths: [], failures: 0 }) === false, '✓ 零核实 → 调过 read(已核实)不命中')
    // 回灌文案要素:先核实 + 事实清单 + 防凭印象
    const fb = buildStatusQueryFeedback(buildTurnFactSheet({ counts: {}, writePaths: [], failures: 0 }, []))
    assert(fb.includes('没有调用任何工具') && fb.includes('本轮事实:工具调用 无'), '✓ 状态回灌 → 零工具事实明示')
    assert(fb.includes('核实') && fb.includes('刷新回退'), '✓ 状态回灌 → 先核实 + 刷新回退风险提示')
    assert(fb.includes('不要凭印象回复'), '✓ 状态回灌 → 防凭印象收口')
  }
}
