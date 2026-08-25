/**
 * sec-94 —— measureWriteScale 写触达量纲(原 bulk-change-guard 的量纲函数)
 *
 * bulkGuard 中间件已随 4.1.0 移除(config-surface-pruning round2);量纲函数为 delegateNudge
 * (欠委派检测)依赖 + 公共导出保留,本模块锁其纯函数行为:
 * A. 量纲:同组件多 patch = 1;跨组件散落 = N;新增路径不计;整体 set 按现有组件总数
 */
import type { TestCtx } from './_ctx'
import { measureWriteScale } from '../../harness/delegateNudge'

/** 测试 bind:5 个组件(components 数组)+ 2 个区块(sections 数组) */
function testBind(): Record<string, unknown> {
  return {
    components: [
      { id: 1, name: 'a' }, { id: 2, name: 'b' }, { id: 3, name: 'c' }, { id: 4, name: 'd' }, { id: 5, name: 'e' },
    ],
    sections: [{ id: 's1' }, { id: 's2' }],
    title: '页面标题',
  }
}

/** 最小 ToolCallContext 桩(emit 走 ctx 事件通道 —— 与 approval/humanConfirm 同源,bulkGuard 挂起经此) */
function mkCallCtx(name: string, args: Record<string, unknown>, onApproval?: (resolve: (ok: boolean) => void) => void) {
  return {
    name, args, signal: undefined,
    emit: (evt: { type: string; resolve?: (ok: boolean) => void }) => {
      if (evt.type === 'approval_request' && evt.resolve) onApproval?.(evt.resolve)
    },
  } as any
}

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-94] measureWriteScale 写触达量纲(原 bulk-change-guard;bulkGuard 已移除,函数为 delegateNudge/公共导出保留)')

  // ===== A. 量纲正反例(评审 3-4 核心)=====
  {
    const bind = testBind()
    // A1:同组件 8 条 patch(全部落 components.2)→ 1,不拦
    let r = measureWriteScale({ patches: Array.from({ length: 8 }, (_, i) => ({ op: 'set', jsonPath: `components.2.props.k${i}`, value: 1 })) }, () => bind)
    assert(r.count === 1 && r.kind === 'patches', '✓ 量纲 → 同组件 8 条 patch = 1(正常微调不拦)')
    // A2:patches 散落 5 个组件 → 5
    r = measureWriteScale({ patches: [0, 1, 2, 3, 4].map((i) => ({ op: 'set', jsonPath: `components.${i}.props.x`, value: 1 })) }, () => bind)
    assert(r.count === 5, '✓ 量纲 → patches 散落 5 个现有组件 = 5(拦)')
    // A3:同组件删 3 个 props → 1 不拦
    r = measureWriteScale({ patches: ['a', 'b', 'c'].map((k) => ({ op: 'remove', jsonPath: `components.0.props.${k}` })) }, () => bind)
    assert(r.count === 1, '✓ 量纲 → 同组件删 3 个 props = 1(不拦)')
    // A4:整体 set(components 数组替换)→ 现有组件节点总数 5+2=7
    r = measureWriteScale({ value: { components: [], sections: [] } }, () => bind)
    assert(r.count === 7 && r.kind === 'whole-set', `✓ 量纲 → 整体 set = 全部现有组件节点(实际 ${r.count})`)
    // A5:新增路径不计(append 到不存在路径 / 新组件)
    r = measureWriteScale({ patches: [
      { op: 'set', jsonPath: 'components.5', value: { id: 6 } },   // 新增(bind 无 index5)
      { op: 'set', jsonPath: 'components.0', value: { id: 1 } },   // 现有
    ] }, () => bind)
    assert(r.count === 1, '✓ 量纲 → 新增路径不计破坏面(append/set 新元素)')
    // A6:深路径截到组件粒度(components.3.props.style.color → components.3)
    r = measureWriteScale({ patch: { op: 'set', jsonPath: 'components.3.props.style.color', value: 'red' } }, () => bind)
    assert(r.count === 1 && r.scopes[0] === 'components.3', '✓ 量纲 → 深路径截到组件粒度首段')
    // A7:del 形态
    r = measureWriteScale({ del: true, patch: { jsonPath: 'components.0' } }, () => bind)
    assert(r.kind === 'del' && r.count === 1, '✓ 量纲 → del 形态按组件计')
    // A8:dryRun 短路
    r = measureWriteScale({ dryRun: true, patches: [0, 1, 2, 3, 4].map((i) => ({ op: 'set', jsonPath: `components.${i}.x`, value: 1 })) }, () => bind)
    assert(r.count === 0, '✓ 量纲 → dryRun 短路不度量')
  }

}
