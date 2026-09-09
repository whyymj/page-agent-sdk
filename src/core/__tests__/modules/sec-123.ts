/**
 * sec-123 —— Batch C1/C2/C3:性能包行为守卫(2026-09-09 六路审计 perf)
 *
 *  - C1:reactive 读侧 rawRead 解包 —— 值等价(hash/序列化对 raw 与 proxy 恒等)+ **响应性守卫**
 *    (写工具经 proxy 落地后 effect 仍触发,宿主页面照常刷新 —— 解包只用于值语义读,不碰写路径)
 *  - C2:read 惰性 hash —— 失败读(PATH_DENIED)零 hash 成本(输出不含 hash=);成功读 hash 值与
 *    纯对象口径一致
 *  - C3:vfs 池字节闭包计数器 —— 计数精确性(阈值边界淘汰恰好在超限点发生)+ estimateFileBytes 对账
 */
import { z } from 'zod'
import { reactive, effect } from 'vue'
import type { TestCtx } from './_ctx'
import { createDataOps } from '../../tools/dataOps'
import { createVfs, estimateFileBytes, normalize } from '../../backends/vfs'
import { hashValue } from '../../tools/jsonUtils'
import { rawRead } from '../../utils/rawRead'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  const schema = z.object({ title: z.string(), items: z.array(z.number()) })

  // ===== A. C1 值等价:hash/深投影对 raw 与 proxy 恒等(解包不改值语义)=====
  {
    const plain = { title: 't', items: [1, 2, 3], nested: { a: { b: 'c' } } }
    const proxied = reactive(plain)
    assert(hashValue(rawRead(proxied)) === hashValue(plain), '✓ C1 值等价:hashValue(raw) === hashValue(plain)')
    assert(JSON.stringify(rawRead(proxied)) === JSON.stringify(plain), '✓ C1 值等价:序列化恒等')
    assert(rawRead(plain) === plain, '✓ C1 非 reactive 输入恒等返回(幂等)')
    assert(rawRead(proxied) === plain, '✓ C1 reactive 解包返回原目标对象(raw target 即宿主持有的原对象)')
  }

  // ===== B. C1 响应性守卫(最大盲区:解包不得杀死宿主响应式)=====
  {
    const bind = reactive({ title: 'before', items: [1] })
    let triggered = 0
    effect(() => { void bind.title; void bind.items.length; triggered++ })  // 建依赖(宿主 watch/computed 同机制)
    const base = triggered
    const t = byName(createDataOps({ schema, bind, description: 'd' }, {}))
    // write(写经 proxy)—— effect 必须在写后触发(read 经 raw 本就不触发 effect,无判别力,不设空洞断言;
    // 读侧值等价由 A 段守卫,性能行为由 tests/perf/bench-dataops 守卫)
    const r1 = await invoke(t.read, { jsonPath: 'title' })
    assert(/before/.test(r1), '✓ read(经 raw)值正确返回')
    await invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: 'after' } })
    assert(triggered > base, `✓ 响应性守卫:write 后 effect 照常触发(宿主页面刷新链路完好;实际 +${triggered - base})`)
    assert(bind.title === 'after', '✓ write 经 proxy 落地(bind 读到新值)')
    // eval transform(整体替换走 restoreInPlace 到 proxy)+ append 数组:深度响应同守卫
    await invoke(t.write, { patch: { op: 'append', jsonPath: 'items', value: 2 } })
    assert(bind.items.length === 2, '✓ append 数组经 proxy 落地')
    assert(triggered > base + 1, '✓ 数组变更同样触发 effect(items.length 依赖)')
    // 整体 set 写(commitSetToBind → restoreInPlace/safeMerge 到 proxy;code-review P2 补:最高危混淆点)
    const before = triggered
    await invoke(t.write, { value: { title: 'whole', items: [9] } })
    assert(bind.title === 'whole' && bind.items[0] === 9, '✓ 整体 set 写经 proxy 落地(merge 语义)')
    assert(triggered > before, '✓ 响应性守卫:整体 set(restoreInPlace)后 effect 照常触发')
    // restore_data(restoreLive 到 proxy;快照回退是 raw/proxy 混淆的另一高危点)
    const before2 = triggered
    const rr = await invoke(t.restore_data, {})
    assert(/已回退主数据到快照/.test(rr), '✓ restore_data 回退成功')
    assert(triggered > before2, '✓ 响应性守卫:restore_data(restoreLive)后 effect 照常触发(回退宿主页面照常刷新)')
  }

  // ===== C. C2 惰性 hash:失败读零 hash 成本;成功读 hash 与纯对象口径一致 =====
  {
    const plain = { title: 't', items: [1] }
    const bind = reactive(plain)
    const t = byName(createDataOps({ schema, bind, description: 'd' }, {}))
    const denied = await invoke(t.read, { jsonPath: 'no_such_key' })
    // 注:本断言是契约级(失败读输出不含 hash=/不刷基线);惰性化的性能行为(失败读零 hash 调用)在
    // 修前 eager 代码上输出同样不含 hash=,selftest 无判别力 —— 性能守卫由 tests/perf/bench-dataops 承担
    assert(/PATH_DENIED/.test(denied) && !/hash=/.test(denied), '✓ C2 失败读(PATH_DENIED)输出零 hash 痕迹(契约级)')
    const ok = await invoke(t.read, { jsonPath: 'title' })
    const m = ok.match(/hash=(\S+)\)/)
    assert(!!m && m[1] === hashValue(plain), '✓ C2 成功读 hash 与纯对象口径一致(值等价 + 恒实时)')
  }

  // ===== D. C3 计数器精确性:阈值边界淘汰恰在超限点发生 =====
  {
    // userFiles 池限 100 字节;A=60、B=60 → 写 B 后总 120 超限 → 最旧 A 被淘汰(计数器不精确会错位)
    const content60 = 'x'.repeat(60)
    const store = createVfs(undefined, { poolBytes: { userFiles: 100 } })
    store.files['a.txt'] = { content: content60, updatedAt: 1 }
    assert(!!store.files['a.txt'], '✓ C3 单文件 60B ≤ 池限 100B:不淘汰')
    store.files['b.txt'] = { content: content60, updatedAt: 2 }
    assert(!store.files['a.txt'] && !!store.files['b.txt'], '✓ C3 累计 120B > 100B:最旧淘汰恰在超限点发生(计数精确到字节)')
    // 覆盖同 key 不同体积:delta 维护
    store.files['b.txt'] = { content: 'x'.repeat(30), updatedAt: 3 }
    store.files['c.txt'] = { content: 'x'.repeat(60), updatedAt: 4 }
    assert(!!store.files['b.txt'] && !!store.files['c.txt'], '✓ C3 覆盖写 delta 维护(30+60=90 ≤ 100 不淘汰;修前残留旧计数会误判 120)')
    // 删除:计数回收
    delete store.files['c.txt']
    store.files['d.txt'] = { content: 'x'.repeat(60), updatedAt: 5 }
    assert(!!store.files['d.txt'], '✓ C3 delete 后计数回收(90-60+60=90 ≤ 100)')
    // 对账基准:计数器驱动淘汰的行为与全扫口径一致(estimateFileBytes 导出作测试对账)
    const raw = { ...store.files } as Record<string, { content: string }>
    assert(estimateFileBytes(raw) <= 100 || !store.files[Object.keys(raw).sort()[0]], '✓ C3 对账:存留集合字节 ≤ 池限(与 estimateFileBytes 全扫口径一致)')
  }

  // ===== E. C3 失效点:hydrate 记账 + 恢复后限上限(持久化容差)=====
  {
    const store = createVfs(undefined, { poolBytes: { userFiles: 100 }, persist: { save: () => {} } })  // hydrate/clear 仅 persist 模式装配
    store.hydrate?.({
      'a.txt': { content: 'x'.repeat(60), updatedAt: 1 },
      'b.txt': { content: 'x'.repeat(60), updatedAt: 2 },
      'c.txt': { content: 'x'.repeat(60), updatedAt: 3 },
    })
    // hydrate 后 enforceLimit:120 > 100 → 淘汰到 ≤90 水位(最旧 a 先走)
    assert(!store.files['a.txt'], '✓ C3 hydrate 记账生效(快照超池照常收敛,不因计数器漏记而失守)')
    const kept = Object.keys(store.files)
    assert(kept.length >= 1 && estimateFileBytes({ ...store.files } as never) <= 100, `✓ C3 hydrate 后存留 ${kept.length} 文件且字节 ≤ 池限`)
    // clear:计数器重置(清空后再写不误淘汰)
    store.clear?.()
    store.files['e.txt'] = { content: 'x'.repeat(40), updatedAt: 4 }
    store.files['f.txt'] = { content: 'x'.repeat(40), updatedAt: 5 }
    assert(!!store.files['e.txt'] && !!store.files['f.txt'], '✓ C3 clear 后计数归零(40+40=80 ≤ 100 双存留;修前残留计数 → 清空后首写即误淘汰)')
    // normalize 口径对账(路径规范化与 poolOf 同源)
    const s2 = createVfs(undefined, { poolBytes: { userFiles: 100 } })
    s2.files['/large_results//r1'] = { content: 'x'.repeat(60), updatedAt: 1 }
    assert(normalize('/large_results//r1') === 'large_results/r1' && s2.getPoolOf?.('/large_results//r1') === 'largeResults', '✓ C3 路径规范化与池路由同口径')
  }
}
