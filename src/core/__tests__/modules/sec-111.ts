/**
 * sec-111 —— storage 挂起/异常面收口(flow-robustness P1#5)
 *
 * 背景:maybeEvict 无 catch(evictTimer void 与 flush 内 await 冒泡 → unhandledRejection);
 * flush 逐项裸等 commit(IDB 事务卡死拖死 send 收口);ready 无 race(IDB blocked 拖死 mount)。
 *
 * A. flush 落盘超时:stuck 后端(闸门未开)→ flush 有界返回 + degraded 留痕 + 项留 pending
 * B. 超时项迟到达:闸门开后二次 flush 正常收口(数据落盘,不丢不重复留痕)
 * C. maybeEvict 吞错:scan 抛错 → flush 不炸 + degraded 留痕(非静默)
 * D. flush 超时后同 kind 新 save 接管:identity 守卫防误删新值(旧项收口不吞新项)
 */
import type { TestCtx } from './_ctx'
import { createSessionStoreWithBackend, encodeKey, type StorageBackend } from '../../backends/storage'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 闸门后端:set/get 先等闸门 Promise(模拟 IDB blocked:闸门开前永不 settle) */
function gatedBackend() {
  const mem = new Map<string, unknown>()
  let openGate: (v: void) => void = () => {}
  const gate = new Promise<void>((r) => { openGate = r })
  return {
    backend: {
      get: async (k: string) => { await gate; return mem.get(k) },
      set: async (k: string, v: unknown) => { await gate; mem.set(k, v) },
      del: async (k: string) => { await gate; mem.delete(k) },
      scan: async (prefix: string, cb: (key: string, value: unknown) => boolean | void) => { await gate; for (const [k, v] of mem) if (k.startsWith(prefix) && cb(k, v) === false) break },
      clearPrefix: async (prefix: string) => { await gate; for (const k of Array.from(mem.keys())) if (k.startsWith(prefix)) mem.delete(k) },
    } satisfies StorageBackend,
    open: () => openGate(),
    dump: () => mem,
  }
}

/** 抛错后端:scan/clearPrefix 抛(淘汰路径故障注入) */
function throwingScanBackend(): StorageBackend {
  const mem = new Map<string, unknown>()
  return {
    get: async (k: string) => mem.get(k),
    set: async (k: string, v: unknown) => { mem.set(k, v) },
    del: async (k: string) => { mem.delete(k) },
    scan: async () => { throw new Error('scan 炸了') },
    clearPrefix: async () => { throw new Error('clearPrefix 炸了') },
  }
}

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-111] storage 挂起/异常面:flush 超时放行 + 淘汰吞错留痕')

  // ===== A. flush 落盘超时:有界返回 + 留痕 + 项留 pending =====
  {
    const g = gatedBackend()
    const events: Array<{ type: string; reason?: string }> = []
    // debounceMs 远大于测试时长:save 后项停在 pending,由 flush 强制落盘(卡闸门 → 超时路径)
    const store = createSessionStoreWithBackend({ backend: 'memory', dbName: 'sec111a', debounceMs: 10_000, flushTimeoutMs: 40 }, g.backend)
    store.onEvent((e) => events.push(e as any))
    await store.ready
    void store.save('ag', 's1', { messages: [{ role: 'user', content: 'x', timestamp: 1 }] } as any)
    const t0 = Date.now()
    await store.flush() // 强制落盘 → commit 卡闸门 → 40ms 超时放行
    const elapsed = Date.now() - t0
    assert(elapsed < 500, `✓ flush 超时放行(${elapsed}ms ≈ flushTimeoutMs 40,原:永挂)`)
    const to = events.find((e) => e.type === 'degraded' && /落盘超时/.test(e.reason ?? ''))
    assert(!!to, '✓ 超时留痕:degraded 事件含「flush 落盘超时」(非静默)')
    // ===== B. 闸门开后二次 flush:数据落盘,二次不再留超时痕 =====
    g.open()
    await sleep(20)
    await store.flush()
    const loaded = await store.load('ag', 's1')
    assert(!!loaded && (loaded as any).messages?.length === 1, '✓ 超时项留 pending → 后续 flush 重试最终落盘(load 可读回)')
    assert(events.filter((e) => e.type === 'degraded' && /落盘超时/.test(e.reason ?? '')).length === 1, '✓ 二次 flush 正常收口(不重复超时留痕)')
    store.dispose()
  }

  // ===== C. maybeEvict 吞错:scan 抛 → flush 不炸 + degraded 留痕 =====
  {
    const events: Array<{ type: string; reason?: string }> = []
    const store = createSessionStoreWithBackend({ backend: 'memory', dbName: 'sec111c', debounceMs: 10, flushTimeoutMs: 500 }, throwingScanBackend())
    store.onEvent((e) => events.push(e as any))
    await store.ready
    await store.save('ag', 's1', { messages: [{ role: 'user', content: 'x', timestamp: 1 }] } as any)
    await sleep(20)
    await store.flush() // 末尾 void maybeEvict():内部吞错,不冒泡
    await sleep(20)
    const ev = events.find((e) => e.type === 'degraded' && /淘汰扫描失败/.test(e.reason ?? ''))
    assert(!!ev, '✓ 淘汰失败留痕:degraded「淘汰扫描失败(已跳过)」')
    assert(await store.load('ag', 's1') !== undefined, '✓ 淘汰故障不影响读写(load 正常)')
    store.dispose()
  }

  // ===== D. 超时项 vs 同 kind 新 save:identity 守卫防误删新值 =====
  {
    const g = gatedBackend()
    // debounce 长:两次 save 的项都停 pending,由 flush 强制落盘 —— 精确演练超时留 pending + 接管 + identity 守卫
    const store = createSessionStoreWithBackend({ backend: 'memory', dbName: 'sec111d', debounceMs: 10_000, flushTimeoutMs: 40 }, g.backend)
    await store.ready
    const p1 = store.save('ag', 's1', { messages: [{ role: 'user', content: 'v1', timestamp: 1 }] } as any)
    void store.flush() // v1 强制落盘卡闸门 → 超时放行(v1 留 pending)
    await sleep(60)
    // 同 kind 新 save 接管 pending 槽:p1 立即 resolve(语义:已并入下次)
    const p2 = store.save('ag', 's1', { messages: [{ role: 'user', content: 'v2', timestamp: 2 }] } as any)
    let p1Resolved = false
    void p1.then(() => { p1Resolved = true })
    await sleep(20)
    assert(p1Resolved, '✓ 旧 save Promise 被接管收口(不挂起;语义:已并入下次)')
    g.open() // v1 的迟到落定:identity 守卫应跳过 delete(槽里已是 v2)
    await sleep(30)
    await store.flush() // v2 强制落盘(闸门已开)
    await Promise.race([p2, sleep(300)])
    const loaded = await store.load('ag', 's1')
    assert(!!loaded && (loaded as any).messages?.[0]?.content === 'v2', '✓ 新值落盘(v1 迟到收口未误删接管的 v2;无守卫时 pending 被清 → v2 丢失)')
    store.dispose()
  }

  // ===== team-audit P1#4:load 的 meta touch(lastAccessed 刷新)单独吞错,不连坐快照读取 =====
  {
    // set 全炸(QuotaExceeded 形态);meta/messages 种子经 encodeKey 预置 → load 应成功返回数据(修前:meta touch 裸 await → load reject)
    const mem = new Map<string, unknown>()
    const dbName = 'sec111-p14', agentId = 'ag', sid = 's1'
    mem.set(encodeKey(dbName, agentId, sid, '__meta__'), { agentId, sessionId: sid, createdAt: 1, lastAccessed: 1, bytes: 0 })
    mem.set(encodeKey(dbName, agentId, sid, 'messages'), [{ role: 'user', content: 'hi', timestamp: 1 }])
    const quotaBackend: StorageBackend = {
      get: async (k) => mem.get(k),
      set: async () => { throw new Error('QuotaExceededError') },
      del: async (k) => { mem.delete(k) },
      scan: async () => {},
      clearPrefix: async () => {},
    }
    const store = createSessionStoreWithBackend({ backend: 'memory', dbName, debounceMs: 10_000 }, quotaBackend)
    const snap = await store.load(agentId, sid)
    assert(!!snap && (snap as any).messages?.[0]?.content === 'hi',
      '✓ P1#4 meta touch 后端炸(set 抛)→ 快照读取照常返回数据(lastAccessed 刷新失败不连坐;修前:load 整体 reject)')
    store.dispose()
  }

  // ===== team-audit P1#7:maxBytes:Infinity 联动关闭 maxBytesPerSession 默认 10MB 上限 =====
  {
    // 直测 store 层(11MB 经 agent 管线过重);mem 后端记录 set 调用观察拒写/放行
    const mkMemBackend = () => {
      const mem = new Map<string, unknown>()
      return { mem, backend: { get: async (k: string) => mem.get(k), set: async (k: string, v: unknown) => { mem.set(k, v) }, del: async (k: string) => { mem.delete(k) }, scan: async () => {}, clearPrefix: async () => {} } satisfies StorageBackend }
    }
    const BIG = [{ role: 'user', content: 'q', timestamp: 1 }, { role: 'assistant', content: 'A'.repeat(11 * 1024 * 1024), timestamp: 2 }]
    // messages kind 落盘值 = 数组本体(save 按 kind 拆包存,非 {messages:[...]} 包装)
    const hasMessages = (mem: Map<string, unknown>) => [...mem.values()].some((v) => Array.isArray(v) && v.length > 0)
    // ① Infinity(容量交服务端,usage-guide 承诺口径)→ >10MB 照常落盘(修前:10MB 默认上限静默拒写)
    {
      const { mem, backend } = mkMemBackend()
      const store = createSessionStoreWithBackend({ backend: 'memory', dbName: 'sec111-p7a', maxBytes: Infinity, debounceMs: 0 }, backend)
      await store.createSession('ag', undefined, 's1')
      await store.save('ag', 's1', { messages: BIG } as any)
      await store.flush()
      assert(hasMessages(mem), '✓ P1#7 maxBytes:Infinity + >10MB 会话 → messages kind 落盘(修前:默认 10MB 上限静默拒写,刷新回退旧快照)')
      store.dispose()
    }
    // ② 显式 maxBytesPerSession 优先(Infinity 联动不覆盖显式值)
    {
      const { mem, backend } = mkMemBackend()
      const store = createSessionStoreWithBackend({ backend: 'memory', dbName: 'sec111-p7b', maxBytes: Infinity, maxBytesPerSession: 1024, debounceMs: 0 }, backend)
      await store.createSession('ag', undefined, 's1')
      await store.save('ag', 's1', { messages: BIG } as any)
      await store.flush()
      assert(!hasMessages(mem), '✓ P1#7 显式 maxBytesPerSession=1024 优先(超限拒写;联动仅对未显式传值生效)')
      store.dispose()
    }
    // ③ 非 Infinity 不传 maxBytesPerSession → 10MB 默认零变化(超限照拒)
    {
      const { mem, backend } = mkMemBackend()
      const store = createSessionStoreWithBackend({ backend: 'memory', dbName: 'sec111-p7c', debounceMs: 0 }, backend)
      await store.createSession('ag', undefined, 's1')
      await store.save('ag', 's1', { messages: BIG } as any)
      await store.flush()
      assert(!hasMessages(mem), '✓ P1#7 默认(非 Infinity)10MB 上限零变化(超限照拒)')
      store.dispose()
    }
  }
}
