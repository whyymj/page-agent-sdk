/**
 * sec-89 —— 指令执行力增强(instruction-adherence):完结门禁 + 问句意图守卫
 *
 * 背景(editor_fangzhou 真 LLM 实测两类失效):
 *  - 莫名中断:todos 拆了 3 项做完 1 项就用纯文本收尾(框架无「未竟任务不许下车」门禁)
 *  - 注意力漂移:长对话问「这是啥组件」被历史拖着去 use_html 生成代码(问句误路由成操作)
 *
 * A. detectIncompleteFinish:todos 未完成项 + 收尾非问句 → true;全完成/空/问句收尾 → false
 * B. buildGateFeedback:双出口文案(已完成→update_todo 标记 / 未完成→继续),列未完成项
 * C. detectQuestionIntent:三档启发式(句尾问号 / 疑问词+吗呢 / 查询词),祈使句不命中
 * D. createIntentGuardMiddleware:问句 pin 段注入 / 祈使句不注入 / 最新 user 为操作指令时守卫失效 / onHit 去重留痕
 */
import type { TestCtx } from './_ctx'
import { detectIncompleteFinish, buildGateFeedback } from '../../harness/todos'
import { detectQuestionIntent, createIntentGuardMiddleware } from '../../harness/intentGuard'
import { createInitialState } from '../../harness/state'
import type { Todo } from '../../harness/state'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-89] 指令执行力增强:完结门禁 + 问句意图守卫')

  const mkTodos = (...status: Array<Todo['status']>): Todo[] =>
    status.map((s, i) => ({ id: `t-${i + 1}`, content: `任务${i + 1}`, status: s }))

  // ===== A. detectIncompleteFinish =====
  {
    assert(detectIncompleteFinish(mkTodos('completed', 'pending'), '全部完成了。'), '✓ 完结门禁 → 存在未完成项时收尾判 incomplete')
    assert(detectIncompleteFinish(mkTodos('in_progress'), '我先做到这里。'), '✓ 完结门禁 → in_progress 也判未完成')
    assert(!detectIncompleteFinish(mkTodos('completed', 'completed'), '全部完成。'), '✓ 完结门禁边界 → 全 completed 不拦')
    assert(!detectIncompleteFinish([], '没规划直接答。'), '✓ 完结门禁边界 → 空 todos(未规划)恒不拦')
    assert(!detectIncompleteFinish(mkTodos('pending'), '方案 A 和方案 B,你想保留哪个?'), '✓ 完结门禁豁免 → 问号收尾(向用户征询)不拦')
    assert(!detectIncompleteFinish(mkTodos('pending'), '你想保留哪个？  '), '✓ 完结门禁豁免 → 全角问号 + 尾随空白仍豁免')
  }

  // ===== B. buildGateFeedback =====
  {
    const fb = buildGateFeedback(mkTodos('completed', 'pending', 'in_progress'))
    // completed 项不出现在未完成枚举行(`#t-N [status]` 形态);evidence-audit-gate A1 rider 会另列「已完成但
    // evidence 为空」项(裸 #t-N),属设计内追加(见 sec-102 #7),不算「列入未完成」
    assert(fb.includes('t-2') && fb.includes('t-3') && !/#t-1 \[/.test(fb), '✓ 门禁反馈 → 只列未完成项(排除 completed;rider 裸 id 另计)')
    assert(fb.includes('update_todo') && fb.includes('继续执行'), '✓ 门禁反馈 → 双出口(标记完成 / 继续执行)')
    assert(fb.includes('2 项'), '✓ 门禁反馈 → 未完成项计数')
    const longContent = '这是一个非常非常长的任务描述'.repeat(20)
    const fbLong = buildGateFeedback([{ id: 't-1', content: longContent, status: 'pending' }])
    assert(!fbLong.includes(longContent), '✓ 门禁反馈 → 单项 content 超长截断防回灌膨胀')
  }

  // ===== C. detectQuestionIntent =====
  {
    // 三档正例
    assert(!detectQuestionIntent('帮我看看这个配置'), '✓ 问句判定反例 → 「帮我看看X」祈使句不命中(非问句)')
    assert(detectQuestionIntent('这个组件怎么用?'), '✓ 问句判定 → 句尾半角问号(强信号)')
    assert(detectQuestionIntent('这个组件怎么用？'), '✓ 问句判定 → 句尾全角问号(强信号)')
    assert(detectQuestionIntent('这是啥组件'), '✓ 问句判定 → 查询词「是啥」命中(实测事故句)')
    assert(detectQuestionIntent('这是什么组件'), '✓ 问句判定 → 查询词「是什么」命中')
    assert(detectQuestionIntent('有哪些可用组件'), '✓ 问句判定 → 查询词「有哪些」命中')
    assert(detectQuestionIntent('为什么报错呢'), '✓ 问句判定 → 疑问词「为什么」+ 句尾「呢」(中信号)')
    assert(detectQuestionIntent('能不能加个倒计时吗'), '✓ 问句判定 → 疑问词「能不能」+ 句尾「吗」(中信号)')
    // 反例(祈使/操作指令,必须不命中)
    assert(!detectQuestionIntent('设计一个活动页'), '✓ 问句判定反例 → 祈使句「设计一个活动页」不命中')
    assert(!detectQuestionIntent('把标题改成干杯'), '✓ 问句判定反例 → 祈使句「把标题改成X」不命中')
    assert(!detectQuestionIntent('添加一个 banner'), '✓ 问句判定反例 → 祈使句「添加组件」不命中')
    assert(!detectQuestionIntent('调换 navbar 和 banner 顺序'), '✓ 问句判定反例 → 祈使句「调换顺序」不命中')
    assert(!detectQuestionIntent(''), '✓ 问句判定边界 → 空文本不命中')
  }

  // ===== D. createIntentGuardMiddleware =====
  {
    // 问句 → pin 段注入(先答勿做)
    const hits: string[] = []
    const mw = createIntentGuardMiddleware((p) => hits.push(p))
    const st = createInitialState()
    st.messages.push({ role: 'user', content: '这是啥组件', timestamp: Date.now() })
    const seg = mw.augmentPrompt!(st)
    assert(typeof seg === 'string' && seg!.includes('咨询') && seg!.includes('read'), '✓ 意图守卫 → 问句注入「先答勿做」pin 段')
    // 再次调用(多轮)→ 段仍在 + onHit 按内容去重不重复留痕
    const seg2 = mw.augmentPrompt!(st)
    assert(typeof seg2 === 'string', '✓ 意图守卫 → 多轮内持续注入(跨轮守卫)')
    assert(hits.length === 1, '✓ 意图守卫 → onHit 同消息去重(只留痕一次)')
    // 最新 user 换成操作指令 → 守卫自动失效(无残留)
    st.messages.push({ role: 'assistant', content: '这是横幅组件。', timestamp: Date.now() })
    st.messages.push({ role: 'user', content: '把标题改成干杯', timestamp: Date.now() })
    assert(mw.augmentPrompt!(st) === undefined, '✓ 意图守卫 → 最新 user 为操作指令时守卫失效(不误伤)')
    // 祈使句开头 → 恒不注入
    const st2 = createInitialState()
    st2.messages.push({ role: 'user', content: '设计一个活动页,主题世界杯', timestamp: Date.now() })
    assert(createIntentGuardMiddleware().augmentPrompt!(st2) === undefined, '✓ 意图守卫边界 → 祈使句不注入')
    // 无 user 消息 → undefined
    assert(createIntentGuardMiddleware().augmentPrompt!(createInitialState()) === undefined, '✓ 意图守卫边界 → 无 user 消息返 undefined')
  }
}
