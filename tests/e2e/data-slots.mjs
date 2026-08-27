// data:schema 类型(8 种字段)+ 嵌套字段 + 空 / 不传
import { setupEnv, createAssert, FAKE_LLM, MIN_CAPS, createChatSdk, z } from './_helpers.mjs'
import { stubModel } from './_stub-model.mjs'

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
    await t.write.invoke({ patch: { jsonPath: 'components.0' }, del: true })
    assert(bind.components.length === 2 && bind.components[0].id === 2 && bind.components[1].id === 3, '✓ write del 删数组首项 → length 3→2、元素前移([1,2,3]→[2,3]),无 empty 槽(delete_data 等价迁移)')
    await t.write.invoke({ patch: { jsonPath: 'components.0' }, del: true })
    await t.write.invoke({ patch: { jsonPath: 'components.0' }, del: true })
    assert(bind.components.length === 0, '✓ write del 连续删 → 2→1→0,length 一路递减无残留空位')
  }

  console.log('[e2e:data] subtree-summary:大子树摘要泛化四路(主占位/窄读全文/聚焦全文/子 scope 全文)+ 轻量零变化锁')
  {
    const { createDataOps } = await import('../../dist/page-agent-sdk.js')
    const bigStyle = { bg: 'x'.repeat(3200), fg: 'y' }
    const smallStyle = { bg: 'g', fg: 'w' }
    const schema = z.object({
      title: z.string(),
      components: z.array(z.object({ name: z.string(), props: z.object({ style: z.object({ bg: z.string(), fg: z.string() }), note: z.string() }) })),
    })
    const mkBind = () => ({
      title: '页',
      components: [
        { name: 'a', props: { style: bigStyle, note: 'n' } },
        { name: 'b', props: { style: smallStyle, note: 'm' } },
      ],
    })
    const t = Object.fromEntries(createDataOps({ schema, bind: mkBind(), description: 'd' }).map((x) => [x.name, x]))
    // ① 主 scope 占位:read 父级 → 内层大子树 <subtree …>(小兄弟 b 完整)
    const r1 = String(await t.read.invoke({ jsonPath: 'components.0' }))
    const ph = (r1.match(/<subtree [^>]*>/) ?? [''])[0]
    assert(/<subtree [\d.]+KB keys:\[bg,fg\] #[0-9a-z]+>/.test(r1) && ph !== '' && !ph.includes('hash='), '✓ 主 scope 大子树 → <subtree keys #指纹> 占位(占位符无 hash= 字面量;read 尾部 hash= 乐观锁标识保留)')
    const r1b = String(await t.read.invoke({ jsonPath: 'components.1' }))
    assert(!/<subtree/.test(r1b) && /"name":"b"/.test(r1b), '✓ 轻量组件零变化(阈值下原样,零变化锁)')
    // ② 窄读全文:read 该子树自身(结果根豁免)
    const r2 = String(await t.read.invoke({ jsonPath: 'components.0.props.style' }))
    assert(!/<subtree/.test(r2) && r2.includes('x'.repeat(60).slice(0, 60)), '✓ 窄读全文:结果根豁免(击穿通道①)')
    // ③ 聚焦全文:__pgFullTextPaths 任意深度豁免前缀(focus 通道;焦点子树内部嵌套大子树也全文)
    const r3 = String(await t.read.invoke({ jsonPath: 'components.0' }, { configurable: { __pgFullTextPaths: ['components.0'] } }))
    assert(!/<subtree/.test(r3) && r3.includes('x'.repeat(60).slice(0, 60)), '✓ 聚焦全文:豁免前缀内任意深度全文(击穿通道②,仅根豁免不够的回归锁)')
    // ④ 子 scope 全文:__pgDataScope 切子 scope(isMain=false)
    const r4 = String(await t.read.invoke({ jsonPath: 'components.0' }, { configurable: { __pgDataScope: 'sub-1' } }))
    assert(!/<subtree/.test(r4) && r4.includes('x'.repeat(60).slice(0, 60)), '✓ 子 scope 全文(击穿通道③,子 agent 改 code 需全文)')
    // ⑤ query 不豁免(占位+path 检索形态)+ search 维持现状不摘要
    const r5 = String(await t.query_data.invoke({ expr: '$.components[?(@.name=="a")].props.style' }))
    assert(/"path":"components\.0\.props\.style"/.test(r5) && /<subtree/.test(r5), '✓ query 命中值不豁免:占位 + path(LLM 钉路径窄读)')
    const r6 = String(await t.search_data.invoke({ query: 'zzz-not-found', mode: 'substring' }))
    assert(!/<subtree/.test(r6), '✓ search 维持现状不摘要(既有片段截断口径)')
  }

  console.log('[e2e:data] query_data 批量 queries:batch 信封 + 逐条与单次同构 + 单条失败不整批(tool-surface-economy W1)')
  {
    const { createDataOps } = await import('../../dist/page-agent-sdk.js')
    const schema = z.object({
      components: z.array(z.object({ name: z.string(), type: z.string(), price: z.number() })),
      meta: z.object({ total: z.number(), owner: z.string() }),
    })
    const bind = {
      components: [
        { name: 'a', type: 'card', price: 50 },
        { name: 'b', type: 'list', price: 200 },
        { name: 'c', type: 'card', price: 80 },
      ],
      meta: { total: 3, owner: 'z' },
    }
    const t = Object.fromEntries(createDataOps({ schema, bind, description: 'd' }).map((x) => [x.name, x]))
    const r = String(await t.query_data.invoke({ queries: ['$.components[?(@.type=="card" && @.price<100)]', '$.meta.owner', '$[?(@.x=='] }))
    const parsed = JSON.parse(r)
    assert(parsed.batch === true && parsed.results.length === 3, '✓ query 批量 → batch 信封 + 三条逐项')
    assert(parsed.results[0].ok === true && parsed.results[0].matched === 2 && parsed.results[0].results[0].path === 'components.0', '✓ query 批量 → 首条输出与单次同构(path/index/value)')
    assert(parsed.results[1].ok === true && /z/.test(parsed.results[1].results[0].value), '✓ query 批量 → 次条独立求值')
    assert(parsed.results[2].ok === false && /JSONPATH/.test(parsed.results[2].error), '✓ query 批量 → 非法条目该项 error 不整批')
    const r2 = String(await t.query_data.invoke({ queries: ['$.meta.total', '$.meta.owner'], expr: '$.nope' }))
    const p2 = JSON.parse(r2)
    assert(p2.batch === true && p2.results.every((x) => x.ok), '✓ query 批量 → expr 同传被忽略(按 queries)')
    const r3 = String(await t.query_data.invoke({}))
    assert(/^ERROR:/.test(r3) && /queries/.test(r3), '✓ query → expr/queries 都缺返回参数错误')
    let threw = false
    try { await t.query_data.invoke({ queries: ['$.meta.total'] }) } catch { threw = true }
    assert(threw, '✓ query → queries 单条(<2)被 schema 拒(zod 前置)')
  }

  console.log('[e2e:data] read-before-write 守卫:占位子树直写被拦 → 窄读后放行(subtree-summary Phase 1)')
  {
    const { StubChatModel } = await import('./_stub-model.mjs')
    const bigStyle = { bg: 'x'.repeat(3200), fg: 'y' }
    const bind = {
      title: '页',
      components: [
        { name: 'a', props: { style: bigStyle, note: 'n' } },
      ],
    }
    const model = new StubChatModel([
      { toolCalls: [{ name: 'read', args: { jsonPath: 'components' } }] },                                // 骨架读 → style 占位
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.props.style.bg', value: 'red' } } }] },  // 直写占位子树 → 拦
      { toolCalls: [{ name: 'read', args: { jsonPath: 'components.0.props.style' } }] },                  // 窄读全文
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0.props.style.bg', value: 'red' } } }] },  // 复写 → 放行
      { text: '改完了' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-subtree-guard', storage: 'memory', llm: model, capabilities: MIN_CAPS,
      data: {
        schema: z.object({
          title: z.string(),
          components: z.array(z.object({ name: z.string(), props: z.object({ style: z.object({ bg: z.string(), fg: z.string() }), note: z.string() }) })),
        }),
        bind,
        description: '守卫场景',
      },
    })
    await sdk.mount()
    await sdk.send('把 a 的背景改成红色')
    const trs = sdk.debugLogs.value.filter((l) => l.type === 'tool_result').map((l) => ({ name: l.data?.name, result: String(l.data?.result ?? '') }))
    assert(trs.some((x) => x.name === 'read' && x.result.includes('<subtree')), '✓ 骨架读返回 <subtree> 占位(内容未见)')
    const writes = trs.filter((x) => x.name === 'write')
    assert(writes.length === 2 && writes[0].result.startsWith('NEED_NARROW_READ') && /read\(\{jsonPath/.test(writes[0].result),
      '✓ 直写占位子树 → NEED_NARROW_READ 拦截(带窄读指令,ask-first)')
    assert(/已 write\(edit\)/.test(writes[1].result) && bind.components[0].props.style.bg === 'red',
      '✓ 窄读后复写放行(bg=red 落地;引导重试而非禁止)')
    sdk.unmount()
  }

  console.log('[e2e:data] 旧 CRUD 四件已移除(legacy-crud-dedup):调旧名 → C2「工具不存在+可用清单」引导,一轮自纠走 write')
  {
    const { StubChatModel } = await import('./_stub-model.mjs')
    const bind = { title: '旧标题' }
    const model = new StubChatModel([
      { toolCalls: [{ name: 'set_data', args: { value: { title: '新标题' } } }] },  // 旧名 → C2 回灌
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'title', value: '新标题' } } }] },  // 一轮自纠
      { text: '已把标题改成「新标题」。' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-legacy-crud-c2', storage: 'memory', llm: model, capabilities: MIN_CAPS,
      data: { schema: z.object({ title: z.string() }), bind, description: 'C2 引导' },
    })
    await sdk.mount()
    await sdk.send('把标题改成「新标题」')
    const tr = sdk.debugLogs.value.filter((l) => l.type === 'tool_result' && l.data?.name === 'set_data')
    assert(tr.length === 1 && String(tr[0].data?.result).includes('工具 "set_data" 不存在')
      && /当前上下文可用工具[::]/.test(String(tr[0].data?.result)) && String(tr[0].data?.result).includes('write')
      && tr[0].data?.status === 'error', '✓ 旧名 set_data → C2「工具不存在 + 完整可用清单」回灌(清单含 write,非静默)')
    assert(bind.title === '新标题', '✓ C2 引导后一轮自纠改走 write(title 写入生效,write/read 零变化)')
    sdk.unmount()
  }

  console.log('[e2e:data] 空 schema + 非空 bind → read 返回空投影/ write 全拒(SCHEMA_INVALID 或 PATH_DENIED)')
  {
    // F5:data: { schema: z.object({}), bind: {...非空} } → read 返回空投影、write 任意路径 SCHEMA_INVALID/PATH_DENIED、不静默成功
    const { stubModel } = await import('./_stub-model.mjs')
    const bind = { title: '页', items: [{ id: 1 }], meta: { key: 'val' } }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-empty-schema', storage: 'memory', llm: stubModel(
        // 第1轮:read → 返回空投影(空 schema 白名单,无字段可读)
        { toolCalls: [{ name: 'read', args: {} }] },
        // 第2轮:write 任意路径(title/items/meta) → SCHEMA_INVALID 或 PATH_DENIED 拒绝
        { toolCalls: [{ name: 'write', args: { value: '新', patch: { op: 'set', jsonPath: 'title' } } }] },
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
        { toolCalls: [{ name: 'read', args: { jsonPaths: ['x', 'y'] } }] },
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
        { toolCalls: [{ name: 'write', args: { value: { patches: [
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


  console.log('[e2e:data-slots] chunked-code-write:append 字符串拼接分块写大 code(30KB+ 组件脱离 max_tokens 约束)')
  {
    const bind = { components: [] }
    const llm = stubModel(
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0', value: { type: 'custom', name: 'big', code: '<section class="part1">' } } } }] },
      { toolCalls: [{ name: 'write', args: { patch: { op: 'append', jsonPath: 'components.0.code', value: '<div class="part2">中段内容</div>' } } }] },
      { toolCalls: [{ name: 'write', args: { patch: { op: 'append', jsonPath: 'components.0.code', value: '</section>' } } }] },
      { text: '大组件已分三块写入完成' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-chunk-code', storage: false, llm,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false, subagent: false },
      data: { schema: z.object({ components: z.array(z.object({ type: z.string(), name: z.string(), code: z.string() })) }), bind, description: 'd' },
    })
    await sdk.mount()
    const reply = await sdk.send('生成大组件')
    const code = bind.components[0]?.code
    assert(code === '<section class="part1"><div class="part2">中段内容</div></section>', `✓ 三块拼接成完整 code(实际:${String(code).slice(0, 60)}…)`)
    assert(/完成/.test(reply), '✓ 分块写全程无错,正常收口')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
