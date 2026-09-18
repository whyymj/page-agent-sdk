/**
 * sec-132:A8 能力门控漏网三处(host-integration-contract;「勿教不存在的工具」纪律同族遗漏)
 * 1. makePageAnalysisSkill withVfs:vfs 关 → 不出现 vfs_read/vfs_grep(外存条目整条不教)
 * 2. makeDomInspectSkill withDataOps:dataOps 关 → 排障套路不出现「改数据」(文档站主场景无 write 工具)
 * 3. usageHints domInspect 行:闭环按 dataOps × hasActions 门控(双环在才教闭环;半环降级;无环剥除)
 */
import type { TestCtx } from './_ctx'
import { makeDomInspectSkill, makePageAnalysisSkill } from '../../tools/domTool'
import { createUsageHintsMiddleware } from '../../harness/usageHints'
import type { HarnessState } from '../../harness/state'

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // ===== 1. page-analysis:withVfs 门控 =====
  {
    const on = makePageAnalysisSkill({ withVfs: true }).getContent()
    const off = makePageAnalysisSkill({ withVfs: false }).getContent()
    assert(on.includes('vfs_read') && on.includes('大结果在外存'), '✓ withVfs:true → 教 vfs 外存条目(vfs_read/vfs_grep)')
    assert(!off.includes('vfs_read') && !off.includes('vfs_grep') && !off.includes('大结果在外存'), '✓ withVfs:false → 外存条目整条不出现(vfs 关时工具不在池)')
    assert(off.includes('定位失败换路'), '✓ withVfs:false → 其余探索纪律不受影响')
  }

  // ===== 1b. page-analysis:输出纪律段(直接说内容,不写过程)=====
  {
    const c = makePageAnalysisSkill({}).getContent()
    assert(c.includes('## 输出纪律(直接说内容,不写过程)'), '✓ page-analysis → 含「输出纪律」段(默认对所有页面问答场景生效)')
    assert(c.includes('过程叙述') && c.includes('元话术') && c.includes('方法论自述') && c.includes('预告与套话'),
      '✓ page-analysis 输出纪律 → 四类禁项齐(过程叙述/元话术/方法论自述/预告套话)')
    assert(/句末括注/.test(c), '✓ page-analysis 输出纪律 → 出处用最简形式(句末括注,不写引导句)')
    assert(c.includes('## 回答纪律(页面问答的底线)'), '✓ 原有「回答纪律」(不猜测底线)不受影响')
  }

  // ===== 2. dom-inspect:withDataOps 门控 =====
  {
    const on = makeDomInspectSkill({ withDataOps: true }).getContent()
    const off = makeDomInspectSkill({ withDataOps: false }).getContent()
    assert(on.includes('不符则改数据'), '✓ withDataOps:true → 排障套路第 3 步教改数据(write 在池)')
    assert(!off.includes('改数据') && off.includes('如实报告差异'), '✓ withDataOps:false → 不教改数据(无 write 工具),改为如实报告差异')
  }

  // ===== 3. usageHints domInspect 行:dataOps × hasActions 门控 =====
  {
    const st = {} as HarnessState
    const render = (hasDataOps: boolean, hasActions?: boolean) =>
      ((createUsageHintsMiddleware({ domInspect: true, hasActions }, hasDataOps).augmentPrompt as (s: HarnessState) => string | undefined)(st) ?? '')
    const both = render(true, true)
    assert(both.includes('read_page') && both.includes('触发动作') && both.includes('闭环'), '✓ dataOps×actions 双在 → 教完整「改数据→看渲染→触发动作」闭环')
    const noActions = render(true, false)
    assert(noActions.includes('read_page') && noActions.includes('查看渲染效果') && !noActions.includes('触发动作'), '✓ dataOps 在·actions 未配 → 降级半句(只教看渲染,不教动作闭环)')
    const noData = render(false, true)
    assert(noData.includes('read_page') && !noData.includes('触发动作') && !noData.includes('查看渲染效果'), '✓ dataOps 关(文档站)→ 闭环句整段剥除(前两环是幻影)')
    const neither = render(false, false)
    assert(neither === noData, '✓ 双缺 → 与 dataOps 关同形(不叠加降级句)')
  }
}
