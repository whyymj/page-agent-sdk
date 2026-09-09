/**
 * sec-122 —— Batch B9/B10/B11:dataOps 互锁补面 + restore 裁决校验(2026-09-09 六路审计 conc)
 *
 *  - B9:eval transform 整体替换 beforeBind 锚点对齐(裁决后、pushSnapshot 前)+ __pgId 回填行为回归
 *  - B10:restore_data / resource_update 补写互锁(并行批内派发序串行,restore 不再抢跑误报 NO_SNAPSHOT)
 *  - B11:restore 裁决恢复点新鲜度校验 + ConflictInfo.snapshotId 真实锚定 + 裁决分支 setBaseline 补 per-call scope
 */
import { z } from 'zod'
import type { TestCtx } from './_ctx'
import { createDataOps } from '../../tools/dataOps'
import { createVfs } from '../../backends/vfs'

const CFG_MAIN = { configurable: { __pgDataScope: '' } }
const CFG_SUB = { configurable: { __pgDataScope: 'sub' } }
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  const schema = z.object({ title: z.string() })

  // ===== A. B11:ConflictInfo.snapshotId 真实锚定(修前恒 0)=====
  {
    let captured: any = null
    const bind: any = { title: 'orig' }
    const t = byName(createDataOps({ schema, bind, description: 'd' }, {
      conflictWatchFields: ['*'],
      onConflict: async (info: any) => { captured = info; return { action: 'keep_external' as const } },
    }))
    await invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: 'v1' } }, CFG_MAIN) // 快照 #1
    await invoke(t.read, {}, CFG_MAIN) // 基线
    bind.title = 'ext'
    const r = await invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: 'v2' } }, CFG_MAIN)
    assert(/已保留外部修改/.test(r), '✓ keep_external 裁决照常')
    assert(captured?.snapshotId === 1, `✓ ConflictInfo.snapshotId 真实锚定 = 裁决者所见最新快照 id(修前恒 0;实际 ${captured?.snapshotId})`)
  }

  // ===== B. B11:restore 裁决恢复点校验(ask 窗口新修改落地 → 拦下,不再静默洗掉)=====
  {
    const bind: any = { title: 'orig' }
    let resolveAsk: ((a: 'overwrite' | 'restore' | 'keep_external') => void) | undefined
    const t = byName(createDataOps({ schema, bind, description: 'd' }, {
      conflictWatchFields: ['*'],
      onConflict: async () => new Promise((res) => { resolveAsk = res as never }),
    }))
    await invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: 'v1' } }, CFG_MAIN) // 快照 #1 = {title:'orig'}
    await invoke(t.read, {}, CFG_MAIN)
    bind.title = 'ext'
    const p = invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: 'v2' } }, CFG_MAIN)
    await delay(10)
    bind.title = 'mid-window' // ask 窗口内新外部修改落地(裁决者未见过)
    resolveAsk?.('restore')
    const r = await p
    assert(/裁决恢复点校验失败/.test(r) && /VERSION_CONFLICT/.test(r), '✓ restore 裁决恢复点校验:窗口内新修改 → 拦下(修前:直接回退,静默洗掉裁决者没见过的修改)')
    assert(bind.title === 'mid-window', '✓ 被拦后 bind 保持窗口内新值(未被回退覆盖)')
  }

  // ===== C. B11:restore 裁决正常路径(无窗口变化 → 按锚定快照回退)=====
  {
    const bind: any = { title: 'orig' }
    let anchor = -1
    const t = byName(createDataOps({ schema, bind, description: 'd' }, {
      conflictWatchFields: ['*'],
      onConflict: async (info: any) => { anchor = info.snapshotId; return { action: 'restore' as const } },
    }))
    await invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: 'v1' } }, CFG_MAIN) // 快照 #1
    await invoke(t.read, {}, CFG_MAIN)
    bind.title = 'ext'
    const r = await invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: 'v2' } }, CFG_MAIN)
    assert(/已回退主数据到历史快照 #1/.test(r), `✓ restore 裁决按锚定快照 #${anchor} 回退`)
    assert(bind.title === 'orig', '✓ 回退到快照值(title=orig)')
  }

  // ===== D. B11 配套:裁决分支 setBaseline 补 per-call scope(子 scope 裁决不刷错槽)=====
  {
    let asks = 0
    const bind: any = { title: 'orig' }
    const t = byName(createDataOps({ schema, bind, description: 'd' }, {
      conflictWatchFields: ['*'],
      onConflict: async () => { asks++; return { action: 'overwrite' as const } },
    }))
    await invoke(t.read, {}, CFG_SUB) // 子 scope 基线 H0
    bind.title = 'ext'
    const r1 = await invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: 'A' } }, CFG_SUB)
    assert(!String(r1).startsWith('ERROR:'), `✓ 子 scope 冲突 → overwrite 裁决落地(${r1.slice(0, 40)}…)`)
    const r2 = await invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: 'B' } }, CFG_SUB)
    assert(!String(r2).startsWith('ERROR:') && bind.title === 'B', '✓ 子 scope 第二写不再误冲突(裁决吸收基线刷对 per-call scope;修前刷 activeScope=主 → 连环 VERSION_CONFLICT)')
    assert(asks === 1, `✓ 冲突只问一次(实际 ${asks} 次)`)
  }

  // ===== E. B10:restore_data 补互锁(并行批内派发序串行,restore 不再抢跑 NO_SNAPSHOT)=====
  {
    const bind: any = { title: 'orig' }
    const t = byName(createDataOps({ schema, bind, description: 'd' }, {
      conflictWatchFields: ['*'], maxParallelTools: 2,
    }))
    // 同 tick 派发 [write, restore]:write 先起步持锁(pushSnapshot+commit 在其锁内 turn);
    // 修前 restore 同步体抢跑 → 锁外判 snapshots 空 → 误报 NO_SNAPSHOT;修后排队等 write 落栈
    const pw = invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: 'A' } }, CFG_MAIN)
    const pr = invoke(t.restore_data, {}, CFG_MAIN)
    const [rw, rr] = await Promise.all([pw, pr])
    assert(!String(rw).startsWith('ERROR:'), '✓ 并行 [write, restore]:write 照常落地')
    assert(!String(rr).startsWith('ERROR:') && /已回退主数据到快照/.test(rr), `✓ 并行 [write, restore]:restore 排队落栈后成功回退(修前抢跑误报 NO_SNAPSHOT;实际 ${rr.slice(0, 50)})`)
    assert(bind.title === 'orig', '✓ 最终值 = 快照回退值(派发序:write 落地 → restore 回退)')
  }

  // ===== F. B10:resource_update 补互锁(armed 场景正常路径回归)=====
  {
    const bind: any = { title: 't', token: 'v1' }
    const t = byName(createDataOps({
      schema: z.object({ title: z.string(), token: z.string() }),
      bind, description: 'd',
      resources: [{ path: 'token', mode: 'verbatim' as const, schema: z.string() }],
    }, {
      conflictWatchFields: ['*'], maxParallelTools: 2, vfsStore: createVfs(),
    }))
    const r = await invoke(t.resource_update, { path: 'token', value: 'v2' }, CFG_MAIN)
    assert(/已更新 verbatim 资源/.test(r) && bind.token === 'v2', '✓ resource_update 补锁后正常路径照常(池+bind 同步)')
  }

  // ===== G. B9:eval transform 整体替换 __pgId 回填(锚点 = 裁决后、落盘前,行为回归)=====
  {
    const bind: any = { components: [
      { type: 'custom', name: 'a', code: 'A1', __pgId: 'id_a' },
      { type: 'custom', name: 'b', code: 'B1', __pgId: 'id_b' },
    ] }
    const t = byName(createDataOps({
      schema: z.object({ components: z.array(z.object({ type: z.string(), name: z.string().optional(), code: z.string().optional() })) }),
      bind, description: 'd',
    }, {
      pgIdPaths: ['components'],
      // 测试缝:in-process 沙箱(返回重排后的新值,不含 __pgId —— read 投影隐藏,LLM 看不到也不该带)
      sandboxRunner: async () => ({ ok: true, result: { components: [
        { type: 'custom', name: 'b', code: 'B1' },
        { type: 'custom', name: 'a', code: 'A1' },
      ] }, elapsedMs: 1 }),
    }))
    const r = await invoke(t.eval_script, { script: 'data', mode: 'transform' }, CFG_MAIN)
    assert(/已通过脚本 transform 更新主数据/.test(r), `✓ eval transform 整体替换落地(${r.slice(0, 40)}…)`)
    assert(bind.components[0].name === 'b' && bind.components[0].__pgId === 'id_b', `✓ 重排后 __pgId 按内容回填(b 找回 id_b;实际 ${bind.components[0].__pgId})`)
    assert(bind.components[1].__pgId === 'id_a', '✓ 内容相等匹配跨位置找回原 id(beforeBind 取自裁决后状态)')
  }
}
