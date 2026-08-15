// data:schema 类型(8 种字段)+ 嵌套字段 + 空 / 不传
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:data] 单主对象 schema 含 8 种字段类型 + 嵌套字段')
  {
    const bind = { title: 't', count: 1, flag: false, tags: ['a'], meta: { k: 'v' }, map: { x: 1 }, level: 'a', nested: { items: ['a'] } }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-schema-types', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: {
        schema: z.object({
          title: z.string(),
          count: z.number(),
          flag: z.boolean(),
          tags: z.array(z.string()),
          meta: z.object({ k: z.string() }),
          map: z.record(z.string(), z.any()),
          level: z.enum(['a', 'b', 'c']),
          nested: z.object({ items: z.array(z.string()) }),
        }),
        bind,
        description: '应用配置(8 种字段类型 + 嵌套)',
      },
    })
    await sdk.mount()
    const info = sdk.inspect().data
    assert(!!info && info.description === '应用配置(8 种字段类型 + 嵌套)', '单 data schema 含 8 种字段类型 + 嵌套 → inspect().data.description 反映')
    assert(!!info?.schema, 'inspect().data.schema 存在')
    sdk.unmount()
  }

  console.log('[e2e:data] 不传 data:mount 成功 + inspect().data undefined')
  {
    const sdk = createChatSdk({ ui: false, id: 'e2e-no-data', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS })
    await sdk.mount()
    assert(sdk.inspect().data === undefined, '不传 data → inspect().data 为 undefined')
    sdk.unmount()
  }

  console.log('[e2e:data] 单 data(多字段):inspect().data 反映')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-multi-fields', storage: 'memory', llm: FAKE_LLM, capabilities: MIN_CAPS,
      data: {
        schema: z.object({ title: z.string(), count: z.number(), items: z.array(z.string()) }),
        bind: { title: 't', count: 1, items: ['a'] },
        description: '多字段配置',
      },
    })
    await sdk.mount()
    const info = sdk.inspect().data
    assert(!!info && info.description === '多字段配置', '单 data 多字段 → inspect().data.description 反映')
    sdk.unmount()
  }


  console.log('[e2e:data] write patch move:同数组重排 + 跨数组移动(一步原子,替代双 set 交换 / append+remove 两步)')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    const bind = {
      components: [
        { type: 'navbar', title: '导航' },
        { type: 'banner', title: '横幅' },
        { type: 'custom', name: 'hero', code: '<section>hero</section>' },
      ],
    }
    const llm = stubModel(
      { toolCalls: [{ name: 'read', args: { jsonPath: 'components' } }] },
      // 轮 1:hero(下标 2)提到最前(同数组重排)
      { toolCalls: [{ name: 'write', args: { patch: { op: 'move', jsonPath: 'components.2', value: 'components.0' } } }] },
      // 轮 2:横幅移入 hero 容器(跨数组,用回 read 刷基线后的新下标)
      { toolCalls: [{ name: 'read', args: { jsonPath: 'components' } }] },
      { toolCalls: [{ name: 'write', args: { patch: { op: 'move', jsonPath: 'components.2', value: 'components.0.children' } } }] },
      { text: '已重排并移入容器' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-move-op', storage: false, llm,
      capabilities: MIN_CAPS,
      data: {
        schema: z.object({
          components: z.array(z.discriminatedUnion('type', [
            z.object({ type: z.literal('navbar'), title: z.string() }),
            z.object({ type: z.literal('banner'), title: z.string() }),
            z.object({ type: z.literal('custom'), name: z.string(), code: z.string(), children: z.array(z.object({ type: z.string(), title: z.string() })).optional() }),
          ])),
        }),
        bind, description: '测试',
      },
    })
    await sdk.mount()
    await sdk.send('调整组件顺序并移入容器')
    assert(bind.components[0].name === 'hero', '✓ move 同数组重排:components.2 → components.0(hero 提到最前)')
    assert(bind.components[1].type === 'navbar' && bind.components.length === 2 && !bind.components.some((c) => c.type === 'banner'), '✓ move 重排后相对顺序保持(navbar 紧随 hero;banner 已被第 2 轮移入 children)')
    assert(Array.isArray(bind.components[0].children) && bind.components[0].children[0]?.title === '横幅',
      '✓ move 跨数组:banner 移入 hero.children(一步,免 append+remove 两步非原子)')
    sdk.unmount()
  }

  console.log('[e2e:data] 数组子项删除 splice:length 递减、元素前移、无稀疏空位(fix-dataops-write-correctness)')
  {
    const { createDataOps } = await import('../../dist/page-agent-sdk.js')
    const bind = { components: [{ id: 1 }, { id: 2 }, { id: 3 }] }
    const tools = createDataOps({
      schema: z.object({ components: z.array(z.object({ id: z.number() })) }),
      bind,
      description: '数组组件',
    })
    const byName = (xs) => Object.fromEntries(xs.map((t) => [t.name, t]))
    const t = byName(tools)
    await t.delete_data.invoke({ jsonPath: 'components.0' })
    assert(bind.components.length === 2 && bind.components[0].id === 2 && bind.components[1].id === 3, 'delete_data 删数组首项 → length 3→2、元素前移([1,2,3]→[2,3]),无 empty 槽')
    await t.delete_data.invoke({ jsonPath: 'components.0' })
    await t.delete_data.invoke({ jsonPath: 'components.0' })
    assert(bind.components.length === 0, 'delete_data 连续删 → 2→1→0,length 一路递减无残留空位')
  }

  console.log('[e2e:data] 空 schema + 非空 bind → read 返回空投影/ write 全拒(SCHEMA_INVALID 或 PATH_DENIED)')
  {
    // F5:data: { schema: z.object({}), bind: {...非空} } → read 返回空投影、write 任意路径 SCHEMA_INVALID/PATH_DENIED、不静默成功
    const { stubModel } = await import('./_stub-model.mjs')
    const bind = { title: '页', items: [{ id: 1 }], meta: { key: 'val' } }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-empty-schema', storage: 'memory', llm: stubModel(
        // 第1轮:read → 返回空投影(空 schema 白名单,无字段可读)
        { toolCalls: [{ name: 'read', arguments: {} }] },
        // 第2轮:write 任意路径(title/items/meta) → SCHEMA_INVALID 或 PATH_DENIED 拒绝
        { toolCalls: [{ name: 'write', arguments: { value: '新', patch: { op: 'set', jsonPath: 'title' } } }] },
        { text: '操作完成' },
      ),
      capabilities: MIN_CAPS,
      data: { schema: z.object({}), bind, description: '空 schema 测试' },
    })
    await sdk.mount()
    // 验证 read 返回空投影(空 schema 白名单,无字段声明)
    const readRes = await sdk.send('读取数据')
    assert(typeof readRes === 'string', 'read 返回文本')
    // 验证 write 被拒绝(空 schema 白名单,任意路径 PATH_DENIED)
    const info = sdk.inspect()
    // 数据未变(bind 保持原值)
    assert(bind.title === '页' && bind.items.length === 1 && bind.meta.key === 'val', 'write 被拒绝 → bind 原值不变(title=页,items=1,meta.key=val)')
    sdk.unmount()
  }

  console.log('[e2e:data] 空 schema 下 read 多路径 → 返回空投影(无字段声明不泄露)')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    const bind = { x: 1, y: { nested: 'deep' } }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-empty-schema-read', storage: 'memory', llm: stubModel(
        { toolCalls: [{ name: 'read', arguments: { jsonPaths: ['x', 'y'] } }] },
        { text: '读完' },
      ),
      capabilities: MIN_CAPS,
      data: { schema: z.object({}), bind },
    })
    await sdk.mount()
    const reply = await sdk.send('读 x 和 y')
    assert(typeof reply === 'string', 'read 返回文本')
    // 验证 bind 未变(空 schema 不泄露数据)
    assert(bind.x === 1 && bind.y.nested === 'deep', '空 schema read → bind 保持原值,不泄露')
    sdk.unmount()
  }

  console.log('[e2e:data] 空 schema 下 write 多路径 patches → 任一失败整批回滚')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    const bind = { a: 1, b: 2 }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-empty-schema-patches', storage: 'memory', llm: stubModel(
        { toolCalls: [{ name: 'write', arguments: { value: { patches: [
          { op: 'set', jsonPath: 'a', value: 10 },
          { op: 'set', jsonPath: 'b', value: 20 },
        ] } } }] },
        { text: '写完' },
      ),
      capabilities: MIN_CAPS,
      data: { schema: z.object({}), bind },
    })
    await sdk.mount()
    const reply = await sdk.send('批量写')
    assert(typeof reply === 'string', 'write patches 返回文本')
    // 验证 bind 全未改(任一路径在空 schema 下都是 PATH_DENIED,整批回滚)
    assert(bind.a === 1 && bind.b === 2, '空 schema write patches → 任一 PATH_DENIED 拒绝,整批回滚(bind.a=1,bind.b=2)')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
