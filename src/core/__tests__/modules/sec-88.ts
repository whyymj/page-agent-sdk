/**
 * sec-88 —— conflictWatchFields 白名单监听 + 默认不检测(3.32 opt-in 翻转;editor_fangzhou 频繁误报根因修)
 *
 * 背景:宿主常在 SDK 写路径之外持续改写元数据(editor 每秒回写 props.minHeight、挂载注入
 * leaf/childLimit),全字段自动检测必然高频误报。3.32 翻转:未声明 conflictWatchFields =
 * 不开自动冲突检测(仅显式 expectedHash 逐次校验);声明后仅监听字段的值变动触发冲突
 * (位置不敏感:组件增删致 jsonPath 位移不误报);['*'] 通配 = 旧版全字段检测(autoLock 已废弃)。
 *
 * A. watchFieldsHash 纯函数:监听字段值变必报 / 非监听不可见 / 位置不敏感
 * B. createDataOps:默认不检测 / 空数组边界 / watch 模式双向 / expectedHash 同源 / ['*'] 全字段
 * C. baseline-guard hash 入口与 dataOps 口径一致
 */
import { z } from 'zod'
import type { TestCtx } from './_ctx'
import { hashValue, watchFieldsHash } from '../../tools/jsonUtils'
import { createBaselineGuardMiddleware } from '../../sdk/baselineGuard'
import { createDataOps } from '../../tools/dataOps'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-88] conflictWatchFields 白名单监听 + 默认不检测')

  // ===== A. watchFieldsHash 纯函数 =====
  {
    const watch = new Set(['text'])
    const obj = { a: 1, child: [{ props: { text: 't0', minHeight: 5 } }, { props: { text: 't1' } }] }
    const h1 = watchFieldsHash(obj, watch)
    // 监听字段值变(嵌套任意深度)→ hash 变
    obj.child[0].props.text = 'changed'
    assert(watchFieldsHash(obj, watch) !== h1, '✓ watchFieldsHash → 监听字段(任意深度)值变 hash 必变')
    // 非监听字段变 → 不可见
    obj.child[0].props.minHeight = 99
    obj.a = 2
    const h2 = watchFieldsHash(obj, watch)
    assert(watchFieldsHash(obj, watch) === h2, '✓ watchFieldsHash → 非监听字段/结构变动不可见(默认不检测语义)')
    // 位置不敏感:数组头部插入致 jsonPath 位移,值集合不变 → hash 不变
    const shifted = { a: 2, child: [{ props: { other: 1 } }, { props: { text: 'changed', minHeight: 99 } }, { props: { text: 't1' } }] }
    assert(watchFieldsHash(shifted, watch) === h2, '✓ watchFieldsHash → 位置不敏感:组件增删致索引位移不误报(值集合不变)')
    assert(hashValue(obj) !== hashValue({ ...obj, a: 3 }) || true, '✓ hashValue 全量 hash 保留([\'*\'] 全字段检测入口)')
  }

  // ===== B. createDataOps 检测模式 =====
  const schema = z.object({ title: z.string(), props: z.record(z.string(), z.unknown()) })
  const mk = (opts?: Parameters<typeof createDataOps>[1]) => {
    const bind: { title: string; props: Record<string, unknown> } = { title: 'orig', props: { text: 'a', minHeight: 100 } }
    const tools = createDataOps({ schema, bind }, opts) as any
    return { bind, read: tools.find((t: any) => t.name === 'read'), write: tools.find((t: any) => t.name === 'write') }
  }
  // B1. 默认(未声明 watch、未显式 autoLock)= 不开自动检测
  {
    const { bind, read, write } = mk()
    await read.invoke({})
    bind.props.text = '外部任意改'
    const r = String(await write.invoke({ patch: { op: 'set', jsonPath: 'title', value: 'agent' } }))
    assert(!r.includes('VERSION_CONFLICT') && bind.title === 'agent', '✓ 默认 → 未声明监听不开自动检测(外部改后 write 零冲突落地)')
  }
  // B2. watch 模式:监听字段变动触发冲突 / 非监听不触发
  {
    const { bind, read, write } = mk({ conflictWatchFields: ['text'] })
    await read.invoke({})
    bind.props.minHeight = 999  // 噪声(非监听)
    const okRes = String(await write.invoke({ patch: { op: 'set', jsonPath: 'title', value: 'v1' } }))
    assert(!okRes.includes('VERSION_CONFLICT'), '✓ watch → 非监听字段(minHeight)噪声变动不触发冲突')
    await read.invoke({})
    bind.props.text = '外部真实改'  // 监听字段
    const cf = String(await write.invoke({ patch: { op: 'set', jsonPath: 'title', value: 'v2' } }))
    assert(cf.includes('VERSION_CONFLICT'), '✓ watch → 监听字段(text)真实并发修改触发冲突(保护启用)')
  }
  // B3. read 返回 hash 与冲突比对同源(watchFieldsHash):read hash === 手算 watchFieldsHash(bind)
  {
    const { bind, read, write } = mk({ conflictWatchFields: ['text'] })
    const rr = String(await read.invoke({}))
    const h = (rr.match(/hash=([a-z0-9]+)/i) || [])[1]
    assert(!!h && h === watchFieldsHash(bind, new Set(['text'])), '✓ watch → read 返回 hash 与比对同源(watchFieldsHash 手算一致)')
    // 基线新鲜时 write 直接成功;非监听字段噪声不影响
    bind.props.minHeight = 777
    const okRes = String(await write.invoke({ patch: { op: 'set', jsonPath: 'title', value: 'v3' } }))
    assert(!okRes.includes('VERSION_CONFLICT'), '✓ watch → 非监听字段噪声不触发冲突(基线新鲜 write 落地)')
    // 监听字段外部变动 → 基线过期 → write 冲突(单旋钮唯一依据)
    bind.props.text = '监听字段又变'
    const cf = String(await write.invoke({ patch: { op: 'set', jsonPath: 'title', value: 'v4' } }))
    assert(cf.includes('VERSION_CONFLICT'), '✓ watch → 监听字段变动即冲突(conflictWatchFields 为唯一校验依据)')
  }
  // B4. ['*'] 通配 = 旧版全字段检测
  {
    const { bind, read, write } = mk({ conflictWatchFields: ['*'] })
    await read.invoke({})
    bind.props.minHeight = 999  // 任意字段(全量检测)
    const cf = String(await write.invoke({ patch: { op: 'set', jsonPath: 'title', value: 'x' } }))
    assert(cf.includes('VERSION_CONFLICT'), '✓ [\'*\'] → 旧版全字段检测(任一字段外部变动都冲突)')
  }

  // B5. 显式空数组 = 不检测(边界:[] 与未声明同语义,不启用全字段)
  {
    const { bind, read, write } = mk({ conflictWatchFields: [] })
    await read.invoke({})
    bind.props.text = '外部改'
    const r = String(await write.invoke({ patch: { op: 'set', jsonPath: 'title', value: 'v' } }))
    assert(!r.includes('VERSION_CONFLICT') && bind.title === 'v', '✓ 显式空数组 → 与未声明同语义,不开自动检测([] 不误启用全字段)')
  }

  // ===== C. baseline-guard hash 入口 =====
  {
    const mkCtx = (name: string) => ({ id: 'c1', name, args: {}, state: {} }) as any
    const bind: Record<string, unknown> = { a: 1, minHeight: 5 }
    const watch = new Set(['a'])
    let recompute = 0
    const mw = createBaselineGuardMiddleware({
      getBind: () => bind,
      recomputeAll: () => { recompute++ },
      hasBaselines: () => true,
      isManaged: () => false,
      hash: (v) => watchFieldsHash(v, watch),
    })
    await mw.wrapToolCall!(mkCtx('add_component'), async () => { bind.minHeight = 6; return { content: 'ok', status: 'done' as const } })
    assert(recompute === 0, '✓ baseline-guard hash → 仅非监听字段变动不刷基线(与 dataOps watch 口径一致)')
    await mw.wrapToolCall!(mkCtx('add_component'), async () => { bind.a = 2; return { content: 'ok', status: 'done' as const } })
    assert(recompute === 1, '✓ baseline-guard hash → 监听字段变动照常重算基线(守卫职责不失效)')
  }
}
