/**
 * sec-96:main-surface-slim Phase 1(dataOps.tools 装配期工具白名单)
 * 覆盖:不传 = 全量零回归 / 'high' 预设不含旧四件(get/set/edit/delete_data)但高层套齐全 /
 *      'high' 不砍 opt-in 家族(draft 与 resource 工具)/ 具体名单精确过滤 / 未装配名 warn 留痕 /
 *      过滤后 controller 挂载仍在(运行时 setData 等机制不因白名单破)。
 */
import type { TestCtx } from './_ctx'
import { createDataOps } from '../../tools/dataOps'
import { createVfs } from '../../backends/vfs'
import { z } from 'zod'

export async function run(ctx: TestCtx) {
  const { assert } = ctx

  const schema = z.object({
    id: z.string(),
    title: z.string(),
    components: z.array(z.object({ type: z.string() })),
  })
  const mkBind = () => ({ id: 'p1', title: '页面', components: [{ type: 'nav' }] })
  const FULL_NAMES = [
    'describe_data', 'get_data', 'set_data', 'edit_data', 'delete_data',
    'restore_data', 'history_data', 'query_data', 'search_data', 'eval_script',
    'read', 'write', 'schema_data', 'diff_data',
  ]

  // 1. 不传 = 全量零回归(14 工具全在)
  {
    const tools = createDataOps({ schema, bind: mkBind() }, {})
    const names = tools.map((t) => t.name)
    for (const n of FULL_NAMES) assert(names.includes(n), `✓ dataOps 白名单 → 不传全量零回归(${n} 在)`)
    assert(names.length === FULL_NAMES.length, `✓ dataOps 白名单 → 不传工具数 = ${FULL_NAMES.length}(实测 ${names.length})`)
  }

  // 2. 'high' 预设:旧四件出局,高层套齐全
  {
    const tools = createDataOps({ schema, bind: mkBind() }, { tools: 'high' })
    const names = tools.map((t) => t.name)
    for (const legacy of ['get_data', 'set_data', 'edit_data', 'delete_data']) {
      assert(!names.includes(legacy), `✓ dataOps 'high' → ${legacy} 不再输出(新旧同职能二选一)`)
    }
    for (const high of ['describe_data', 'read', 'write', 'schema_data', 'diff_data', 'query_data', 'search_data', 'eval_script', 'restore_data', 'history_data']) {
      assert(names.includes(high), `✓ dataOps 'high' → ${high} 保留`)
    }
    assert(names.length === FULL_NAMES.length - 4, `✓ dataOps 'high' → 工具数 = 全量 - 4(实测 ${names.length})`)
    // 过滤后 controller 挂载仍在(机制层不动:运行时 setData/基线等不受白名单影响)
    const ctrl = (tools as any).controller
    assert(ctrl && typeof ctrl.get === 'function' && typeof ctrl.set === 'function', "✓ dataOps 'high' → controller 挂载保留")
  }

  // 3. 'high' 不砍 opt-in 家族:draft(vfsStore)+ resource(resources 声明)照常装配
  {
    const tools = createDataOps(
      { schema, bind: mkBind(), resources: [{ path: 'id', mode: 'freeze' }] },
      { tools: 'high', vfsStore: createVfs() },
    )
    const names = tools.map((t) => t.name)
    assert(names.includes('draft_write') && names.includes('draft_commit'), "✓ dataOps 'high' → draft 家族保留(opt-in 能力不静默砍)")
    assert(names.includes('resource_get') && names.includes('resource_update'), "✓ dataOps 'high' → resource 家族保留")
    assert(!names.includes('get_data'), "✓ dataOps 'high' → 有 opt-in 家族时旧四件仍出局")
  }

  // 4. 具体名单 = 按名精确过滤(集成方完全自控)
  {
    const tools = createDataOps({ schema, bind: mkBind() }, { tools: ['read', 'write', 'query_data'] })
    const names = tools.map((t) => t.name)
    assert(names.length === 3, `✓ dataOps 名单 → 精确过滤为 3 个(实测 ${names.length})`)
    assert(names.includes('read') && names.includes('write') && names.includes('query_data'), '✓ dataOps 名单 → 指定工具都在')
    assert(!names.includes('set_data') && !names.includes('describe_data'), '✓ dataOps 名单 → 名单外工具出局')
  }

  // 5. 未装配名 warn 留痕(拼写错/已改名早暴露)+ 全裁读工具 warn(review P2)
  {
    const warns: string[] = []
    const origWarn = console.warn
    console.warn = (m: unknown) => { warns.push(String(m)) }
    try {
      const tools = createDataOps({ schema, bind: mkBind() }, { tools: ['read', 'writ_typo'] })
      assert(tools.map((t) => t.name).join(',') === 'read', '✓ dataOps 名单 → 未装配名过滤掉只留 read')
      assert(warns.some((w) => w.includes('writ_typo') && w.includes('未装配')), `✓ dataOps 名单 → 未装配名 warn 留痕(实测 ${warns.length} 条)`)
      // review P2:纯写名单(无任何读工具)→ warn 提醒「模型无法核实结果」
      const warns2: string[] = []
      console.warn = (m: unknown) => { warns2.push(String(m)) }
      createDataOps({ schema, bind: mkBind() }, { tools: ['write'] })
      assert(warns2.some((w) => w.includes('无法读取') || w.includes('读工具')), '✓ dataOps 名单 → 纯写名单(全裁读工具)warn 留痕')
    } finally {
      console.warn = origWarn
    }
  }
}
