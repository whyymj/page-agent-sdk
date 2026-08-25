/**
 * sec-109:write-conflict-final-hash(C 形态)—— dataOps 闭包级并发写互锁 + ask 拆段 + 裁决恢复点校验。
 * 竞态是微任务确定性的:p1/p2 并发 invoke(不 await 首个)即固定复现「双双取旧基线」交错。
 */
import { z } from 'zod'
import type { TestCtx } from './_ctx'
import { createDataOps } from '../../tools/dataOps'

const CFG_MAIN = { configurable: { __pgDataScope: '' } }
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  const schema = z.object({ title: z.string() })

  console.log('\n[并发写互锁 · 微任务确定性双写(互锁 vs 无锁对照)]')
  {
    // 互锁(maxParallelTools 2 + ['*'])+ 陈旧基线 + 自动 overwrite:后写在锁内看到前写落地 → 恢复点校验拦下
    // (无锁对照:后写静默覆盖前写与外部修改,双双「成功」= 立项缺陷形态)
    const bind: any = { title: 'orig' }
    let count = 0
    const t = byName(createDataOps({ schema, bind, description: 'd' }, {
      conflictWatchFields: ['*'], maxParallelTools: 2,
      onConflict: async () => { count++; return { action: 'overwrite' as const } },
    }))
    await invoke(t.read, {}, CFG_MAIN)   // 基线 H0
    bind.title = 'ext'                    // 外部改 → Hx(两写同取陈旧 H0)
    const p1 = invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: 'A' } }, CFG_MAIN)
    const p2 = invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: 'B' } }, CFG_MAIN)
    const [r1, r2] = await Promise.all([p1, p2])
    assert(count === 2, `互锁:S3 语义 —— ask 放锁窗口兄弟同样介入(两次裁决,实际 ${count})`)
    assert(/已 write\(edit\)/.test(r1), '✓ 前写经 overwrite 裁决落地(不被后写静默覆盖)')
    assert(/VERSION_CONFLICT/.test(r2) && /裁决恢复点校验失败/.test(r2), '✓ 后写被恢复点校验显式拦下(前写落地是裁决者未见过的新状态 → 单发 VERSION_CONFLICT 防静默覆盖)')
    assert(bind.title === 'A', '✓ 终值 = 前写(后写被拦,agent 重读后可再写;不再 last-writer-wins 静默丢写)')
    // 对照:无互锁(不传 maxParallelTools)同交错 → 双双过陈旧基线,后写静默覆盖 = 旧缺陷锁定
    const bind2: any = { title: 'orig' }
    let count2 = 0
    const t2 = byName(createDataOps({ schema, bind: bind2, description: 'd' }, {
      conflictWatchFields: ['*'],
      onConflict: async () => { count2++; return { action: 'overwrite' as const } },
    }))
    await invoke(t2.read, {}, CFG_MAIN)
    bind2.title = 'ext'
    const q1 = invoke(t2.write, { patch: { op: 'set', jsonPath: 'title', value: 'A' } }, CFG_MAIN)
    const q2 = invoke(t2.write, { patch: { op: 'set', jsonPath: 'title', value: 'B' } }, CFG_MAIN)
    const [s1, s2] = await Promise.all([q1, q2])
    assert(count2 === 2 && !/VERSION_CONFLICT/.test(s1) && !/VERSION_CONFLICT/.test(s2) && bind2.title === 'B',
      '✓ 对照(无锁模式 S5 no-op):双双过陈旧基线 → 后写静默覆盖(既有明文语义,不越权改变)')
  }
  {
    // 互锁下无外部变更的并行不相交双写:零冲突零连环误冲突(N1 同 scope 连续写语义保持)+ 双双落地
    const bind: any = { title: 'orig' }
    let count = 0
    const t = byName(createDataOps({ schema: z.object({ title: z.string(), note: z.string() }), bind, description: 'd' }, {
      conflictWatchFields: ['*'], maxParallelTools: 2,
      onConflict: async () => { count++; return { action: 'overwrite' as const } },
    }))
    await invoke(t.read, {}, CFG_MAIN)
    const p1 = invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: 'A' } }, CFG_MAIN)
    const p2 = invoke(t.write, { patch: { op: 'set', jsonPath: 'note', value: 'N' } }, CFG_MAIN)
    const [r1, r2] = await Promise.all([p1, p2])
    assert(count === 0, `✓ 并行不相交双写零冲突介入(后写锁内取前写刷新后基线,实际介入 ${count})`)
    assert(bind.title === 'A' && bind.note === 'N' && /已 write/.test(r1) && /已 write/.test(r2), '✓ 双双落地(外科叠加 = 串行等价)')
  }

  console.log('\n[ask 拆段 · R1 防饥饿(锁不跨人工裁决挂起)]')
  {
    // onConflict 永不 resolve:p1 挂在 ask(锁已放)→ 兄弟写(基线已刷新)100ms 窗口内照常完成
    const bind: any = { title: 'orig' }
    const never = new Promise<never>(() => {})
    const t = byName(createDataOps({ schema, bind, description: 'd' }, {
      conflictWatchFields: ['*'], maxParallelTools: 2,
      onConflict: () => never,
    }))
    await invoke(t.read, {}, CFG_MAIN)
    bind.title = 'ext'
    void invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: '挂' } }, CFG_MAIN)  // p1 → ask 永挂(留 pending 无 timer)
    await delay(30)                                     // 让 p1 到达 ask(锁已释放)
    await invoke(t.read, {}, CFG_MAIN)                  // 兄弟先 read 刷新基线(不复陈旧)
    const t0 = Date.now()
    const r2 = await Promise.race([invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: 'B' } }, CFG_MAIN), delay(500).then(() => '__TIMEOUT__')])
    assert(r2 !== '__TIMEOUT__' && Date.now() - t0 < 500, '✓ 防饥饿:ask 永挂不阻塞兄弟写(500ms 内完成;原滑手实现会持锁死等)')
    assert(bind.title === 'B', '✓ 兄弟写正常落地刷基线')
  }

  console.log('\n[裁决恢复点校验(S2:ask 窗口宿主直改,串行模式同样在防线面)]')
  {
    const bind: any = { title: 'orig' }
    let resolveAsk: ((v: { action: 'overwrite' }) => void) | undefined
    const t = byName(createDataOps({ schema, bind, description: 'd' }, {
      conflictWatchFields: ['*'],
      onConflict: () => new Promise((r) => { resolveAsk = r }),
    }))
    await invoke(t.read, {}, CFG_MAIN)
    bind.title = 'ext1'                                 // 裁决者将看到的值
    const w = invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: 'A' } }, CFG_MAIN)
    await delay(20)
    bind.title = 'ext2'                                 // 裁决等待期宿主又改(裁决者未见过)
    resolveAsk!({ action: 'overwrite' })
    const r = await w
    assert(/裁决恢复点校验失败/.test(r) && /VERSION_CONFLICT/.test(r), '✓ ask 窗口新修改 → overwrite 裁决被恢复点校验拦下(单发,不二次挂起)')
    assert(bind.title === 'ext2', '✓ 裁决者未见过的新修改保留(agent 值不落地)')
  }

  console.log('\n[restore/overwrite 裁决基线吸收(顺手修:防连环误冲突)]')
  {
    // restore 裁决后基线刷新:紧后写不再冲突
    const bind: any = { title: 'orig' }
    let count = 0
    const t = byName(createDataOps({ schema, bind, description: 'd' }, {
      conflictWatchFields: ['*'],
      onConflict: async () => { count++; return { action: 'restore' as const } },
    }))
    await invoke(t.write, { value: { title: 'seed' } }, CFG_MAIN)  // 种子快照(orig)
    await invoke(t.read, {}, CFG_MAIN)
    bind.title = 'ext'
    const r1 = await invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: 'A' } }, CFG_MAIN)
    assert(/已回退/.test(r1) && bind.title === 'orig', '✓ restore 裁决回退到快照')
    const r2 = await invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: 'C' } }, CFG_MAIN)
    assert(/已 write\(edit\)/.test(r2) && count === 1, `✓ restore 后基线已刷新:紧后写零冲突(介入 ${count} 次;原缺刷新会连环误冲突)`)
  }
  {
    // overwrite 吸收基线:commit 失败(schema 拒)后紧后写不再二次冲突
    const bind: any = { title: 'orig' }
    let count = 0
    const t = byName(createDataOps({ schema, bind, description: 'd' }, {
      conflictWatchFields: ['*'],
      onConflict: async () => { count++; return { action: 'overwrite' as const } },
    }))
    await invoke(t.read, {}, CFG_MAIN)
    bind.title = 'ext'
    const r1 = await invoke(t.write, { value: { title: 123 } }, CFG_MAIN)  // overwrite 过锁 → schema 拒(未落地)
    assert(/SCHEMA_INVALID/.test(r1), '前置:overwrite 裁决后 schema 拒(值未落地)')
    const r2 = await invoke(t.write, { value: { title: 'C' } }, CFG_MAIN)
    assert(/已 write\(set\)/.test(r2) && count === 1, `✓ overwrite 吸收基线:失败提交不连环误冲突(介入 ${count} 次;原会再冲突一轮)`)
  }

  console.log('\n[draft_commit 段锁 smoke(并行 write ∥ draft_commit 双落)]')
  {
    // 互锁覆盖 draft_commit commit 位:并发整体写 + 草稿提交,双双落地不交错
    const bind: any = { title: 'orig', note: 'n0' }
    const fakeVfs = { files: {} as Record<string, unknown> }
    const t = byName(createDataOps({ schema: z.object({ title: z.string(), note: z.string() }), bind, description: 'd' }, {
      conflictWatchFields: ['*'], maxParallelTools: 2,
      vfsStore: fakeVfs as any,
    }))
    // 种草稿(draft_write 不进锁,先同步种好)
    await invoke(t.draft_write, { draftId: 'd1', chunk: '{"title":"D"}', mode: 'start' }, CFG_MAIN)
    await invoke(t.read, {}, CFG_MAIN)
    const p1 = invoke(t.write, { patch: { op: 'set', jsonPath: 'note', value: 'N' } }, CFG_MAIN)
    const p2 = invoke(t.draft_commit, { draftId: 'd1' }, CFG_MAIN)
    const [r1, r2] = await Promise.all([p1, p2])
    assert(/已 write/.test(r1) && /已 draft_commit/.test(r2), '✓ 并行 write ∥ draft_commit 双双成功(段锁串行化 commit)')
    assert(bind.title === 'D' && bind.note === 'N', `✓ 两提交外科叠加互不覆盖(title=${bind.title}, note=${bind.note})`)
  }
}
