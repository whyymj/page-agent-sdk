/**
 * sec-77:组件锁与同组件单委派互斥(parallel-subagent-delegation 第二批)
 * Q1c 白盒:createComponentLock(acquire 原子/release 幂等/locked 视图)+ resolveTargetComponents 三档
 *          + lockedIndexPaths/hitsLockedPath 前缀映射
 * Q3b:createComponentWriteGuardMiddleware(锁内写拒/锁外放行/dryRun 不拦/整体 set 拒)
 * Q3c:hashString + codeAssetMiddleware 人工并发 commit 冲突检测(H1 keep_external / H2 孤儿清理留痕 / 无修改正常 commit)
 */
import type { TestCtx } from './_ctx'
import {
  createComponentLock,
  resolveTargetComponents,
  lockedIndexPaths,
  hitsLockedPath,
  createComponentWriteGuardMiddleware,
} from '../../sdk/componentLock'
import { createCodeAssetMiddleware, hashString } from '../../sdk/codeAssetMiddleware'

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  // ===== Q1a:createComponentLock acquire/release 往返 =====
  {
    const lock = createComponentLock()
    const acq = await lock.acquire(['beer-mug', 'nav-bar'], 'task-1')
    assert(acq.ok === true, '✓ 组件锁 → 双组件 acquire 成功')
    assert(lock.locked()['beer-mug'] === 'task-1' && lock.locked()['nav-bar'] === 'task-1', '✓ 组件锁 → locked() 视图正确')
    acq.ok && acq.release()
    assert(Object.keys(lock.locked()).length === 0, '✓ 组件锁 → release 后视图清空')
    // release 幂等:重复调安全
    acq.ok && (acq.release(), acq.release())
    assert(Object.keys(lock.locked()).length === 0, '✓ 组件锁 → release 幂等(重复调无副作用)')
  }

  // ===== Q1a:多组件原子性(任一被占全失败,已取得的释放) =====
  {
    const lock = createComponentLock()
    await lock.acquire(['beer-mug'], 'task-1')
    const acq2 = await lock.acquire(['beer-mug', 'nav-bar'], 'task-2')
    assert(acq2.ok === false && (acq2 as { heldBy: string }).heldBy === 'task-1', '✓ 组件锁 → 任一被占 → 全失败并返回 heldBy')
    assert(lock.locked()['nav-bar'] === undefined, '✓ 组件锁 → 失败时未锁第二个组件(不留半套锁)')
    // 第一个释放后可再取
    lock.release(['beer-mug'], 'task-1')
    const acq3 = await lock.acquire(['beer-mug', 'nav-bar'], 'task-2')
    assert(acq3.ok === true, '✓ 组件锁 → 占用者释放后 acquire 成功')
  }

  // ===== Q1b:resolveTargetComponents 三档 =====
  {
    const known = ['beer-mug', 'nav-bar', 'countdown']
    // explicit:原样用
    const e1 = resolveTargetComponents({ components: ['beer-mug', 'nav-bar'], task: '改组件' }, known)
    assert(e1.via === 'explicit' && e1.names.join() === 'beer-mug,nav-bar', '✓ resolve → explicit 原样用')
    // explicit 过滤编造名
    const e2 = resolveTargetComponents({ components: ['beer-mug', '编造名'], task: 'x' }, known)
    assert(e2.via === 'explicit' && e2.names.length === 1 && e2.names[0] === 'beer-mug', '✓ resolve → explicit 过滤编造名(锁不空转)')
    // explicit 全编造 → 降级 text-match
    const e3 = resolveTargetComponents({ components: ['不存在'], task: '改一下 beer-mug 组件' }, known)
    assert(e3.via === 'text-match' && e3.names[0] === 'beer-mug', '✓ resolve → explicit 全编造降级 text-match')
    // text-match 唯一命中
    const t1 = resolveTargetComponents({ task: '把 nav-bar 的标题改成干杯' }, known)
    assert(t1.via === 'text-match' && t1.names[0] === 'nav-bar', '✓ resolve → text-match 唯一命中')
    // 0 命中 → none(宁漏不误)
    const t0 = resolveTargetComponents({ task: '改个标题' }, known)
    assert(t0.via === 'none' && t0.names.length === 0, '✓ resolve → 0 命中 none 不锁')
    // ≥2 命中 → none
    const t2 = resolveTargetComponents({ task: 'beer-mug 和 countdown 都要改' }, known)
    assert(t2.via === 'none' && t2.names.length === 0, '✓ resolve → ≥2 命中 none 不锁')
    // 整词边界:nav 不命中 navbar 场景(known 里无 nav,构造 navbar-only)
    const t3 = resolveTargetComponents({ task: '把 nav 改成横向' }, ['navbar', 'banner'])
    assert(t3.via === 'none', '✓ resolve → 整词匹配(nav 不误命中 navbar)')
  }

  // ===== Q3a:lockedIndexPaths 实时解析 + hitsLockedPath =====
  {
    const bind = { components: [{ name: 'navbar', __pgId: 'p0', code: 'a' }, { name: 'beer', __pgId: 'p1', code: 'b' }, { name: 'other', __pgId: 'p2' }] }
    const paths = lockedIndexPaths(bind, ['components'], ['beer'])
    assert(paths.join() === 'components.1', '✓ 锁名 → 索引前缀实时解析')
    // 索引位移后同 name 解析到新索引(检查时实时解析防陈旧)
    const bind2 = { components: [{ name: 'other', __pgId: 'p2' }, { name: 'beer', __pgId: 'p1', code: 'b' }] }
    assert(lockedIndexPaths(bind2, ['components'], ['beer']).join() === 'components.1', '✓ 索引位移后实时解析跟随')
    assert(hitsLockedPath('components.1.code', ['components.1']) && hitsLockedPath('components.1', ['components.1']), '✓ hitsLockedPath → 命中自身与子树')
    assert(!hitsLockedPath('components.10', ['components.1']), '✓ hitsLockedPath → 不误命中同前缀数字(components.1 ≠ components.10)')
  }

  // ===== Q3b:createComponentWriteGuardMiddleware =====
  {
    const bind = { components: [{ name: 'navbar', __pgId: 'p0', code: 'a' }, { name: 'beer', __pgId: 'p1', code: 'b' }] }
    const lock = createComponentLock()
    await lock.acquire(['beer'], 'use_html-x1')
    const mw = createComponentWriteGuardMiddleware({ getBind: () => bind, writablePaths: ['components'], getLocked: () => lock.locked() })
    const wrap = mw.wrapToolCall as (ctx: any, next: () => Promise<any>) => Promise<any>
    const next = async () => ({ content: 'ok', status: 'ok' as const })
    const mkCtx = (name: string, args: unknown) => ({ name, args, state: {} })
    // 锁内写拒
    const r1 = await wrap(mkCtx('write', { patch: { op: 'set', jsonPath: 'components.1.code', value: 'x' } }), next)
    assert(String(r1.content).startsWith('COMPONENT_LOCKED'), '✓ 写检查 → 锁内组件写被拒(COMPONENT_LOCKED)')
    // 锁外放行
    const r2 = await wrap(mkCtx('write', { patch: { op: 'set', jsonPath: 'components.0.code', value: 'x' } }), next)
    assert(r2.content === 'ok', '✓ 写检查 → 未锁组件放行')
    // dryRun 不拦
    const r3 = await wrap(mkCtx('write', { dryRun: true, patch: { op: 'set', jsonPath: 'components.1.code', value: 'x' } }), next)
    assert(r3.content === 'ok', '✓ 写检查 → dryRun 不拦')
    // 整体 set 且有在途锁 → 拒
    const r4 = await wrap(mkCtx('write', { value: { components: [] } }), next)
    assert(String(r4.content).startsWith('COMPONENT_LOCKED'), '✓ 写检查 → 整体 set 有在途锁被拒')
    // patches 含锁内项 → 拒
    const r5 = await wrap(mkCtx('write', { patches: [{ op: 'set', jsonPath: 'components.0.code', value: 'x' }, { op: 'set', jsonPath: 'components.1.code', value: 'y' }] }), next)
    assert(String(r5.content).startsWith('COMPONENT_LOCKED'), '✓ 写检查 → patches 混入锁内项被拒')
    // 无锁(全部释放)→ 整体 set 放行
    lock.release(['beer'], 'use_html-x1')
    const r6 = await wrap(mkCtx('write', { value: { components: [] } }), next)
    assert(r6.content === 'ok', '✓ 写检查 → 无在途锁整体 set 放行')
    // 非写工具(read)不受守卫影响
    const r7 = await wrap(mkCtx('read', { jsonPath: 'components.1' }), next)
    assert(r7.content === 'ok', '✓ 写检查 → 非写工具不受影响')
  }

  // ===== Q3c:hashString 纯函数 =====
  {
    assert(hashString('abc') === hashString('abc') && hashString('abc') !== hashString('abd'), '✓ hashString → 确定性 + 区分不同内容')
    assert(/^[0-9a-f]+$/.test(hashString('<p>hello</p>')), '✓ hashString → 32bit hex 输出')
  }

  // ===== Q3c:codeAssetMiddleware 人工并发 commit 冲突检测(H1/H2/无修改) =====
  {
    const mk = () => ({
      vfs: { files: {} as Record<string, { content: string; updatedAt: number }> },
      bind: {
        components: [
          { name: 'beer', __pgId: 'pg1', code: '<p>origin</p>' },
          { name: 'nav', __pgId: 'pg2', code: '<p>nav</p>' },
        ],
      },
      ctrl: null as null | { get: () => { bind: unknown }; markDataDirty: () => void; recomputeBaseline: () => void },
    })
    const build = (m: ReturnType<typeof mk>) => createCodeAssetMiddleware({
      writablePaths: ['components'], codeVfsPrefix: 'html/', ext: 'html',
      getController: () => (m.ctrl ??= { get: () => ({ bind: m.bind }), markDataDirty() {}, recomputeBaseline() {} }) as any,
      vfsStore: m.vfs as any,
    })

    // H1:在途窗口内人工改同组件 code → commit 保留人工值(keep_external)
    {
      const m = mk()
      const mw = build(m)
      const partial = (mw.beforeAgent as (s: unknown) => unknown)({} as never) as Record<string, unknown>
      const state = { ...(partial as object) } as never
      // 子 agent 改了工作副本(vfs)+ 人工并发直改 bind 的 code
      m.vfs.files['html/pg1.html'] = { content: '<p>child-version</p>', updatedAt: Date.now() }
      ;((state as unknown as Record<string, unknown>).__pgTouched as Set<string>).add('html/pg1.html')
      ;(m.bind.components[0] as { code: string }).code = '<p>human-version</p>'
      ;(mw.afterAgent as (s: unknown) => void)(state)
      assert((m.bind.components[0] as { code: string }).code === '<p>human-version</p>', '✓ H1 人工改在途组件 → 人工值保留(keep_external)')
    }

    // H2:在途窗口内人工删除组件 → commit 不复活 + vfs 文件清理
    {
      const m = mk()
      const mw = build(m)
      const partial = (mw.beforeAgent as (s: unknown) => unknown)({} as never) as Record<string, unknown>
      const state = { ...(partial as object) } as never
      m.vfs.files['html/pg1.html'] = { content: '<p>child-version</p>', updatedAt: Date.now() }
      ;((state as unknown as Record<string, unknown>).__pgTouched as Set<string>).add('html/pg1.html')
      m.bind.components.splice(0, 1)  // 人工删除 pg1 组件
      ;(mw.afterAgent as (s: unknown) => void)(state)
      assert(m.bind.components.length === 1 && (m.bind.components[0] as { __pgId?: string }).__pgId === 'pg2', '✓ H2 人工删除组件 → 不复活')
      assert(m.vfs.files['html/pg1.html'] === undefined, '✓ H2 人工删除组件 → vfs 工作副本同步清理')
    }

    // 无人工修改 → commit 与现状一致(子 agent 版本正常落地)
    {
      const m = mk()
      const mw = build(m)
      const partial = (mw.beforeAgent as (s: unknown) => unknown)({} as never) as Record<string, unknown>
      const state = { ...(partial as object) } as never
      m.vfs.files['html/pg1.html'] = { content: '<p>child-ok</p>', updatedAt: Date.now() }
      ;((state as unknown as Record<string, unknown>).__pgTouched as Set<string>).add('html/pg1.html')
      ;(mw.afterAgent as (s: unknown) => void)(state)
      assert((m.bind.components[0] as { code: string }).code === '<p>child-ok</p>', '✓ 无人工修改 → 子 agent 版本正常 commit')
    }
  }
}
