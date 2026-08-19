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
import { extendSchemaWithPgId, schemaHasCodeField, describeSchemaNode, inferWritablePaths } from '../../tools/schemaUtils'
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
  }, { pgIdPaths: ['components'], conflictWatchFields: ['*'] } as any)
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

  // ===== extendSchemaWithPgId:discriminatedUnion / union / object 三种 element(纯函数)=====
  // 多类型组件平台(complex-demo)用 discriminatedUnion;旧逻辑只认 ZodObject → fallback 不 extend → __pgId 漂移
  {
    // ① discriminatedUnion:每个 option 都 extend __pgId,safeParse 不剥
    const duSchema = z.object({
      components: z.array(z.discriminatedUnion('type', [
        z.object({ type: z.literal('banner'), code: z.string() }),
        z.object({ type: z.literal('custom'), code: z.string() }),
      ])),
    })
    const { schema: duExt, fallback: duFb } = extendSchemaWithPgId(duSchema, ['components'])
    assert(duFb.length === 0, '✓ discriminatedUnion element 不再落 fallback(旧逻辑此处 fallback 致漂移)')
    const du1 = (duExt as any).safeParse({ components: [{ type: 'custom', code: '<p/>', __pgId: 'c_keep' }] })
    assert(du1.success && du1.data.components[0].__pgId === 'c_keep', '✓ discriminatedUnion extend 后 safeParse 不剥 __pgId(整对象替换防漂移)')
    const du2 = (duExt as any).safeParse({ components: [{ type: 'banner', code: '<b/>', __pgId: 'c_b' }] })
    assert(du2.success && du2.data.components[0].__pgId === 'c_b', '✓ discriminatedUnion 每个 option 都 extend(banner/custom 均不剥)')

    // ② 普通 ZodUnion
    const uSchema = z.object({ items: z.array(z.union([z.object({ a: z.string() }), z.object({ b: z.string() })])) })
    const { schema: uExt, fallback: uFb } = extendSchemaWithPgId(uSchema, ['items'])
    assert(uFb.length === 0, '✓ ZodUnion element 不落 fallback')
    const pu = (uExt as any).safeParse({ items: [{ a: 'x', __pgId: 'c_u' }] })
    assert(pu.success && pu.data.items[0].__pgId === 'c_u', '✓ ZodUnion extend 后 safeParse 不剥 __pgId')

    // ③ 普通 ZodObject element 零回归(html-page-demo 场景,原行为)
    const oSchema = z.object({ components: z.array(z.object({ name: z.string(), code: z.string() })) })
    const { schema: oExt, fallback: oFb } = extendSchemaWithPgId(oSchema, ['components'])
    assert(oFb.length === 0, '✓ 普通 ZodObject element 零回归(不落 fallback)')
    const po = (oExt as any).safeParse({ components: [{ name: 'n', code: '<p/>', __pgId: 'c_o' }] })
    assert(po.success && po.data.components[0].__pgId === 'c_o', '✓ ZodObject extend 后 safeParse 不剥 __pgId(原行为保持)')

    // ④ element 非 object/union(record 等)→ fallback(不支持,向后兼容)
    const rSchema = z.object({ meta: z.array(z.record(z.string())) })
    const { fallback: rFb } = extendSchemaWithPgId(rSchema, ['meta'])
    assert(rFb.length === 1 && rFb[0] === 'meta', '✓ record element 落 fallback(不支持,降级)')
  }

  // ===== schemaHasCodeField(html-subagent-open-schema:createChatSdk 装配期判「无 html 子 agent + schema 有 code 字段」→ 自动注入降级编排)=====
  {
    assert(schemaHasCodeField(z.object({ code: z.string() })), '✓ 顶层 code string 字段 → 命中')
    assert(schemaHasCodeField(z.object({ components: z.array(z.object({ name: z.string(), code: z.string() })) })), '✓ 数组元素 object 含 code → 命中(多组件平台常见形态)')
    assert(
      schemaHasCodeField(z.object({ components: z.array(z.discriminatedUnion('type', [
        z.object({ type: z.literal('custom'), code: z.string() }),
        z.object({ type: z.literal('banner'), title: z.string() }),
      ])) })),
      '✓ z.array(discriminatedUnion) 任一 option 含 code → 命中(complex-demo 形态)',
    )
    assert(!schemaHasCodeField(z.object({ title: z.string(), list: z.array(z.string()) })), '✓ 无 code 字段 → 不命中(不误注入降级编排)')
    assert(!schemaHasCodeField(z.any()), '✓ z.any() → 不命中(开放 schema 扫不到 → 集成方 opt-in spread htmlDirectWriteFallback)')
    assert(!schemaHasCodeField(z.record(z.string())), '✓ z.record → 不命中(无 shape)')
    assert(!schemaHasCodeField(null), '✓ null/无 schema → 不命中(健壮)')
  }

  // ===== inferWritablePaths(writablepaths-infer:createHtmlSubagent 未传 writablePaths 时装配期从 schema 顶层推断)=====
  {
    // 正常命中:顶层 z.array(元素含 code string)
    const hit = inferWritablePaths(z.object({ title: z.string(), components: z.array(z.object({ name: z.string(), code: z.string() })) }))
    assert(hit.length === 1 && hit[0] === 'components', '✓ 顶层 code 数组 → 推断出 [\'components\'](非数组字段跳过)')

    // discriminatedUnion 数组元素:任一 option 含 code 即命中(complex-demo 形态)
    const unionHit = inferWritablePaths(z.object({
      components: z.array(z.discriminatedUnion('type', [
        z.object({ type: z.literal('custom'), code: z.string() }),
        z.object({ type: z.literal('banner'), title: z.string() }),
      ])),
    }))
    assert(unionHit.length === 1 && unionHit[0] === 'components', '✓ z.array(discriminatedUnion) 任一 option 含 code → 命中')

    // 多数组全返
    const multi = inferWritablePaths(z.object({
      blocks: z.array(z.object({ code: z.string() })),
      widgets: z.array(z.object({ code: z.string() })),
      title: z.string(),
    }))
    assert(multi.length === 2 && multi.includes('blocks') && multi.includes('widgets'), '✓ 多个 code 数组全部返回(多 writablePaths 合法)')

    // 自定义 codeField
    const cf = inferWritablePaths(z.object({ items: z.array(z.object({ html: z.string() })) }), 'html')
    assert(cf.length === 1 && cf[0] === 'items', '✓ 自定义 codeField(如 \'html\')按参数匹配')
    // 点路径 codeField 真实形态:嵌套结构 props:{html_code}(非字面 key)→ 顶层 shape 无 'props.html_code' 字段 → 空返(不支持推断,须显式传)
    assert(inferWritablePaths(z.object({ items: z.array(z.object({ props: z.object({ html_code: z.string() }) })) }), 'props.html_code').length === 0,
      '✓ 点路径 codeField(嵌套 props.html_code)不支持推断 → 空返(调用方 warn+throw 提示显式传)')

    // 边界:开放 schema / 无 code / 嵌套容器 / null → 空返
    assert(inferWritablePaths(z.any()).length === 0, '✓ z.any() → 空返(开放 schema 扫不到)')
    assert(inferWritablePaths(z.object({ title: z.string(), list: z.array(z.string()) })).length === 0, '✓ 无 code 字段 → 空返')
    assert(inferWritablePaths(z.object({ sections: z.array(z.object({ children: z.array(z.object({ code: z.string() })) })) })).length === 0,
      '✓ 嵌套容器(sections[].children[].code)→ 空返(只扫顶层,宁不猜不错)')
    assert(inferWritablePaths(null).length === 0, '✓ null/无 schema → 空返(健壮)')
  }

  // ===== withCallTimeout(writablepaths-infer-mcp-timeout:MCP callTool 超时闸,挂起收口三契约漏网项)=====
  {
    const { withCallTimeout } = await import('../../mcp/client')
    // 超时:永挂 promise + 10ms 闸 → 抛超时错(不永挂)
    let timedOut = false
    try {
      await withCallTimeout(new Promise<never>(() => {}), 'rag_search', 10)
    } catch (e) {
      timedOut = true
      assert(String(e).includes('rag_search') && String(e).includes('超时'), '✓ 永挂调用超时抛错(含工具名与超时字样)')
    }
    assert(timedOut, '✓ 超时路径确实 reject(不永挂)')

    // 正常完成:先于超时 → 原值返回,不受影响
    const ok = await withCallTimeout(Promise.resolve({ content: [{ type: 'text', text: 'hi' }] }), 'calc', 1000)
    assert((ok as any).content[0].text === 'hi', '✓ 超时内完成 → 原结果透传(零额外开销)')
  }

  // ===== describeSchemaNode 自引用 + 深度截断(schema_data 栈溢出修复:complex-demo 容器 children: z.array(PageComponent) 自引用致无限递归)=====
  {
    // z.lazy 自引用(模拟容器嵌套:getter 每次 new object,visited 不命中 → 靠 depth 截断)
    const selfRef: any = z.lazy(() => z.object({ type: z.string(), children: z.array(selfRef).optional() }))
    const desc = describeSchemaNode(selfRef)
    assert(typeof desc === 'object' && !Array.isArray(desc), '✓ describeSchemaNode 自引用 schema(z.lazy)不栈溢出(depth + visited 双截断)')
    // 超深 schema(depth>15 截断)
    let deep: any = z.string()
    for (let i = 0; i < 30; i++) deep = z.object({ nested: deep })
    const deepDesc = describeSchemaNode(deep)
    assert(typeof deepDesc === 'object', '✓ describeSchemaNode 超深 schema(30 层嵌套)不栈溢出(depth>15 截断)')
  }
}
