/**
 * sec-112 —— flow-robustness Phase 2:P1 崩溃/行为偏差三件(deepClone 环防御 / checkpoint save 兜底 / transitional 问号豁免)
 *
 * 背景(五路审计 2026-08-25):
 *  - deepClone 无环防御:环 bind → 所有写路径第一条语句即抛 "Converting circular structure"(零路径线索)
 *  - checkpoint save 的 JSON 兜底裸奔:环 → clone 抛 → beforeModel 钩子 reject 整个 invoke
 *  - transitional 门禁无问号豁免:「我先给出两套方案…你选哪套?」方案征询被回灌 ×2,与方案先行冲突
 */
import type { TestCtx } from './_ctx'
import { deepClone } from '../../tools/jsonUtils'
import { createCheckpointManager } from '../../harness/checkpoint'
import { runFinishGates, createGateChainState } from '../../harness/gateChain'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-112] deepClone 环防御 + checkpoint save 兜底 + transitional 问号豁免')

  // ===== A. deepClone 环 → 可诊断错误(含环路径)=====
  {
    const cyc: any = { a: { b: {} } }
    cyc.a.b.back = cyc
    let err: unknown
    try { deepClone(cyc) } catch (e) { err = e }
    const msg = err instanceof Error ? err.message : String(err)
    assert(err !== undefined && /循环引用/.test(msg), '✓ 环数据 → 抛「循环引用」可诊断错误(原:Converting circular structure 零线索)')
    assert(/\$\.a\.b/.test(msg), `✓ 错误含环路径(${msg.match(/\$[^;)]*/)?.[0]})`)
    // 数组环路径形态
    const arr: any = { list: [{}] }
    arr.list[0].self = arr.list
    let err2: unknown
    try { deepClone(arr) } catch (e) { err2 = e }
    assert(err2 !== undefined && /\$\.list\[0\]/.test(err2 instanceof Error ? err2.message : String(err2)), '✓ 数组元素环路径同样指明($.list[0])')
  }

  // ===== B. deepClone:合法 DAG(同引用出现在不相交分支)不误伤 =====
  {
    const shared = { x: 1 }
    const dag = { p: shared, q: shared }
    const cloned = deepClone(dag)
    assert(cloned.p?.x === 1 && cloned.q?.x === 1, '✓ 同引用多分支(DAG,非环)照常克隆(JSON 语义本允许,带回溯探测不误伤)')
    assert(cloned.p !== shared && cloned.q !== shared, '✓ 克隆产物为深拷贝(非原引用)')
  }

  // ===== C. checkpoint save:环 bind 兜底(跳过本轮快照 + 返回 -1,不抛)=====
  {
    ;(globalThis as any).window = globalThis
    const vfsStore: any = { files: {}, consumeDirty: () => false }
    const mgr = createCheckpointManager({ slotPaths: [], vfsStore, todosMw: { reset() {} } as any, getTodos: () => [], messages: [] as any, maxCheckpoints: 3 })
    // 无 getData → slotPaths 空:正常 save 走通
    const okId = mgr.save('auto')
    assert(okId > 0, '✓ 正常 save 返回 checkpoint id')
    // 故障形态 = reactive Proxy 包环数据(structuredClone 对 Proxy 抛 DataCloneError → JSON 兜底遇环再抛;
    // 注:纯对象环 structuredClone 原生支持可保留,不触发本兜底)
    const cyc: any = { a: 1 }
    cyc.self = cyc
    const reactiveCyc = new Proxy(cyc, {})
    const mgr2 = createCheckpointManager({ getData: () => reactiveCyc, consumeDataDirty: () => true, vfsStore, todosMw: { reset() {} } as any, getTodos: () => [], messages: [] as any, maxCheckpoints: 3 })
    const t0 = Date.now()
    const badId = mgr2.save('auto') // 原:beforeModel 钩子 reject 整个 invoke;现:warn + 跳过本轮
    assert(badId === -1, '✓ 环 bind(Proxy)→ save 返回 -1 哨兵(跳过本轮快照,invoke 不炸)')
    assert(Date.now() - t0 < 1000, '✓ save 兜底快速返回(不挂起)')
    assert(mgr2.list().length === 0, '✓ 失败轮不入栈(下一轮正常数据照常快照)')
  }

  // ===== D. transitional 门禁句尾问号豁免(与 completion/zero_tool 口径对齐)=====
  {
    const usage = { counts: {}, writePaths: [], failures: 0 }
    const msgs = [{ _getType: () => 'human', content: '有什么方案?' }]
    const base = { garbled: false, rounds: 1, todos: [], isSubagent: false, turnUsage: usage, isWriteToolByName: () => false, messages: msgs }
    // 问句收尾(方案征询)→ 豁免
    const q = runFinishGates({ ...base, state: createGateChainState(), finalContent: '我先给出两套方案:A 直接改、B 先确认,你选哪套?' })
    assert(q === null, '✓ 问句收尾的方案征询 → transitional 豁免(全链放行,不与方案先行冲突)')
    // 同句去问号 → 照常回灌(豁免不扩大)
    const nq = runFinishGates({ ...base, state: createGateChainState(), finalContent: '我先给出两套方案:A 直接改、B 先确认,你选一套。' })
    assert(nq?.kind === 'feedback' && nq.gate.stage === 'transitional_retry', '✓ 非问句过渡表态 → 照常回灌(豁免仅句尾问号口径)')
    // 全角问号同豁免
    const fq = runFinishGates({ ...base, state: createGateChainState(), finalContent: '我先看看环境,选哪套？' })
    assert(fq === null, '✓ 全角问号(？)同豁免')
  }
}
