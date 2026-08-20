/**
 * sec-91 —— 会话恢复提示(resume-notice):恢复非空历史后首轮注入「数据可能已变,先核实」
 *
 * 背景(editor_fangzhou 实测):生成完成未保存 → 刷新回退到上次保存态,但会话从 IndexedDB 恢复
 * (todos 全 completed)→ 用户「重新生成」agent 直接答「完毕」,没核实生成物是否还在。
 * 根因:恢复的历史 ≠ 当前数据现状,agent 缺「状态可能已过期」信号。
 *
 * A. 初始无标记 → augmentPrompt 不注入
 * B. markResumed → 注入提示段(含核实纪律关键词);轮内多次调用持续在场;onInject 去重只留痕一次
 * C. afterAgent 清除 → 下一轮不再注入(一次性)
 * D. 再次 markResumed(又一次恢复/切会话)→ 重新注入;reset 清待注入标记
 */
import type { TestCtx } from './_ctx'
import { createResumeNoticeMiddleware } from '../../harness/resumeNotice'
import { createInitialState } from '../../harness/state'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-91] 会话恢复提示:恢复历史首轮注入核实纪律')

  // ===== A. 初始态不注入 =====
  {
    const mw = createResumeNoticeMiddleware()
    const st = createInitialState()
    assert(mw.augmentPrompt!(st) === undefined, '✓ 恢复提示边界 → 无恢复标记时不注入(新会话零干扰)')
    assert(mw.isPending() === false, '✓ 恢复提示边界 → 初始 isPending=false')
  }

  // ===== B. markResumed → 注入 + 轮内持续 + 留痕去重 =====
  {
    const injects: number[] = []
    const mw = createResumeNoticeMiddleware(() => injects.push(1))
    mw.markResumed()
    assert(mw.isPending() === true, '✓ 恢复提示 → markResumed 置待注入标记')
    const st = createInitialState()
    st.messages.push({ role: 'user', content: '重新生成', timestamp: Date.now() })
    const seg = mw.augmentPrompt!(st)
    assert(typeof seg === 'string' && seg!.includes('从历史记录恢复'), '✓ 恢复提示 → 注入「会话从历史恢复」事实段')
    assert(seg!.includes('上次保存') && seg!.includes('未保存'), '✓ 恢复提示 → 点明刷新回退/未保存丢失(事故根因)')
    assert(seg!.includes('核实') && seg!.includes('重新生成'), '✓ 恢复提示 → 核实纪律(先查后断言;重做先核实缺失)')
    // 轮内多次模型调用(ReAct 多步)→ 段持续在场;onInject 每恢复周期只留痕一次
    const seg2 = mw.augmentPrompt!(st)
    const seg3 = mw.augmentPrompt!(st)
    assert(typeof seg2 === 'string' && typeof seg3 === 'string', '✓ 恢复提示 → 首轮内每次模型调用持续注入')
    assert(injects.length === 1, `✓ 恢复提示 → onInject 去重只留痕一次(实际 ${injects.length})`)
  }

  // ===== C. afterAgent 一次性清除 =====
  {
    const mw = createResumeNoticeMiddleware()
    mw.markResumed()
    const st = createInitialState()
    assert(typeof mw.augmentPrompt!(st) === 'string', '✓ 恢复提示 → 首轮注入(前置)')
    mw.afterAgent!(st)
    assert(mw.isPending() === false, '✓ 恢复提示 → afterAgent 清除标记(一次性语义)')
    assert(mw.augmentPrompt!(st) === undefined, '✓ 恢复提示 → 第二轮起不再注入(已有本轮工具结果)')
  }

  // ===== D. 再次恢复重新生效 + reset 清除 =====
  {
    const mw = createResumeNoticeMiddleware()
    mw.markResumed()
    mw.afterAgent!(createInitialState())
    mw.markResumed() // 又一次恢复(如 switchSession 载入另一会话历史)
    assert(typeof mw.augmentPrompt!(createInitialState()) === 'string', '✓ 恢复提示 → 再次恢复后重新注入(切会话场景)')
    mw.reset()
    assert(mw.isPending() === false && mw.augmentPrompt!(createInitialState()) === undefined, '✓ 恢复提示 → reset 清待注入标记(清空会话不残留)')
  }
}
