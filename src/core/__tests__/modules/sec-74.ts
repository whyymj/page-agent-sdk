/**
 * sec-74:code-as-data-asset 阶段 B —— __pgId 注入(extend schema + afterWrite 联动)
 * - 纯函数 supplementPgId / genPgId:数组元素没 __pgId → 生成 / 已有保持(幂等)/ 非数组跳过 / 唯一性
 * - extendSchemaWithPgId(schemaUtils):装配期给 writablePaths 数组元素加 __pgId:z.string().optional()(safeParse 不剥离)
 * - 集成 createDataOps.pgIdPaths:write 新建 → supplementPgId 补 __pgId / read 不含 __pg*(projectBySchemaDeep 过滤)/
 *   agent 写 __pgId 被 PATH_DENIED(isPathAllowed 拒 __pg* 前缀段)/ persist 往返 id 保持(extend 后 safeParse 不剥离)/
 *   write return 不泄露(redactPgInPlace)/ 乐观锁 hash 一致(__pgId 进 hash,同 scope 连续写不冲突)
 */
import { z } from 'zod'
import { createDataOps, supplementPgId, genPgId } from '../../tools/dataOps'
import type { TestCtx } from './_ctx'

function makeOps(bind: Record<string, unknown>) {
  // schema 不声明 __pgId(集成商零感知);afterWrite = supplementPgId(框架补,装配期由 createChatSdk 注入)
  return createDataOps({
    schema: z.object({
      title: z.string(),
      components: z.array(z.object({ name: z.string(), code: z.string() })),
    }),
    bind,
    description: '测试',
  }, { pgIdPaths: ['components'] } as any)
}

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[code-as-data-asset · __pgId 注入(afterWrite 钩子,不 extend schema)]')

  // ===== supplementPgId 纯函数 =====
  {
    const a = genPgId(); const b = genPgId()
    assert(a.startsWith('c_') && a !== b, '✓ genPgId 生成 c_ 前缀唯一 id(随机 + 计数)')

    const bind: any = { components: [{ name: 'a' }, { name: 'b', __pgId: 'existing' }, 'notObj', { name: 'c' }] }
    supplementPgId(bind, ['components'])
    assert(typeof bind.components[0].__pgId === 'string' && bind.components[0].__pgId.startsWith('c_'), '✓ 没 __pgId 的元素 → 自动生成')
    assert(bind.components[1].__pgId === 'existing', '✓ 已有 __pgId 保持(幂等,不覆盖)')
    assert(bind.components[2] === 'notObj', '✓ 非对象元素跳过')
    assert(bind.components[3].__pgId.startsWith('c_') && bind.components[0].__pgId !== bind.components[3].__pgId, '✓ 多元素各生成唯一 id')
    const id0 = bind.components[0].__pgId
    supplementPgId(bind, ['components'])
    assert(bind.components[0].__pgId === id0, '✓ 幂等:二次补 id 不变(已有保持)')

    const bind2: any = { components: 'notArray', other: [{ x: 1 }] }
    supplementPgId(bind2, ['components', 'other'])
    assert(bind2.components === 'notArray' && (bind2.other[0] as any).__pgId?.startsWith('c_'), '✓ writablePath 非数组跳过(降级);合法路径仍补')
  }

  // ===== 集成:write 新建组件 → 补 __pgId + read 隐藏 + return 不泄露 =====
  {
    const bind: any = { title: 't', components: [] }
    const tools = makeOps(bind)
    const t = byName(tools)
    const r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'components.0', value: { name: 'hero', code: '<p>hi</p>' } } })
    assert(typeof bind.components[0].__pgId === 'string' && bind.components[0].__pgId.startsWith('c_'), '✓ write 新建组件 → afterWrite 自动补 __pgId 到 bindRef')
    assert(!r.includes('__pgId'), '✓ write return 不泄露 __pgId(显示 r.clone,afterWrite 前)')
    const rd = await invoke(t['read'], {})
    assert(!rd.includes('__pgId'), '✓ read 返回不含 __pgId(投影隐藏:__pgId 不在 schema shape → projectBySchemaDeep 自然跳过)')
  }

  // ===== agent 写 __pgId → PATH_DENIED(框架独占)=====
  {
    const bind: any = { title: 't', components: [{ name: 'a', code: '<p/>' }] }
    const tools = makeOps(bind)
    const t = byName(tools)
    const w = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'components.0.__pgId', value: 'forged' } })
    assert(/PATH_DENIED/.test(w), '✓ agent 写 __pgId 被 PATH_DENIED(不在 schema 白名单)')
    assert(bind.components[0].__pgId !== 'forged', '✓ __pgId 未被篡改(agent 写不进去;若 bindRef 原无 __pgId,此次也不补)')
  }

  // ===== persist 往返:已有 __pgId 保持(load 后 write 不重生成)=====
  {
    const bind: any = { title: 't', components: [{ name: 'hero', code: '<p/>', __pgId: 'c_loaded' }] }
    const tools = makeOps(bind)
    const t = byName(tools)
    await invoke(t['read'], {})
    const r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'components.0.code', value: '<b/>' } })
    assert(bind.components[0].__pgId === 'c_loaded', '✓ persist 往返:已有 __pgId 保持(afterWrite 幂等,load 回来不重生成)')
    assert(!r.includes('__pgId'), '✓ write return 不泄露 __pgId')
    assert(bind.components[0].code === '<b/>', '✓ write 正常改 code')
  }

  // ===== 乐观锁:afterWrite 后 hash 一致(同 scope 连续写不冲突)=====
  {
    const bind: any = { title: 't', components: [] }
    const tools = makeOps(bind)
    const t = byName(tools)
    await invoke(t['read'], {})
    const r1 = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'components.0', value: { name: 'a', code: '<p/>' } } })
    assert(!/VERSION_CONFLICT/.test(r1), '✓ write 新建组件不冲突')
    // 同 scope 连续写:afterWrite 补 __pgId 进 hash → setBaseline 含 __pgId → 下次 write autoLock 一致
    const r2 = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'components.0.code', value: '<b/>' } })
    assert(!/VERSION_CONFLICT/.test(r2) && bind.components[0].code === '<b/>', '✓ afterWrite 后 hash 一致:同 scope 连续写永不冲突(__pgId 进 hash,setBaseline 重算)')
  }
}
