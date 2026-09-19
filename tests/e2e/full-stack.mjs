// full-stack(三面组合回归):大 JSON 读写/冲突检测 × HTML 生成委派 × DOM 读写/视觉工具,拼进同一实例验证共存。
// 背景:各能力 e2e 模块孤立覆盖(conflict / capability-packs / dom-edit / screenshot 各自装配最小面),
// 组合装配下的相互影响无守卫 —— 本模块把三面拼在一起:
//   ① 全能力共存装配(单实例 11 工具 + 引导共存 + 冲突武装面)
//   ② 大 JSON 实规模全链路(200 元素:jsonPaths 合批读 / query 定位 / patches 原子 / append 分块累积 / restore 只回退最近一次写 / 分页)
//   ③ 冲突 × html commit(dist 级镜像 selftest sec-75:recomputeBaseline 防误冲突 + 同装配真冲突对照)
//   ④ 页面读失效边界 × view_image 不在宿主变更失效面(URL 是数据真值,不随渲染态过期)
import { setupEnv, createAssert, createChatSdk, z } from './_helpers.mjs'
import { StubChatModel } from './_stub-model.mjs'
import { installFakeDom } from './dom-edit.mjs'
import { createHtmlSubagent } from 'page-agent-sdk'

const STALE_MARK = '⏱[过期快照]'
const FAKE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  // ===== ① 全能力共存装配:code 组件(html 委派)+ 冲突武装 + domInspect/domEdit + 视觉(deepseek-flash 查表) =====
  {
    const fake = installFakeDom()
    try {
      const sdk = createChatSdk({
        ui: false, id: 'e2e-full-stack-asm', storage: 'memory', autoTitle: false,
        llm: { apiKey: 'sk-fake', baseUrl: 'http://fake', model: 'deepseek-flash' },  // 查表 vision:true(4.22.1)走真实构造路径
        capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false, domInspect: true, domEdit: true },
        conflictWatchFields: ['*'],
        screenshot: { renderer: async () => FAKE_PNG },
        data: {
          schema: z.object({ title: z.string(), components: z.array(z.object({ type: z.string(), name: z.string().optional(), code: z.string().optional() })) }),
          bind: { title: 't', components: [{ type: 'custom', name: 'banner', code: '<section>旧</section>', __pgId: 'c_banner' }] },
          description: '全栈',
        },
      })
      await sdk.mount()
      const names = sdk.inspect().tools.map((t) => t.name)
      const need = ['read', 'write', 'query_data', 'restore_data', 'use_html', 'read_page', 'get_dom', 'dom_edit', 'dom_restore', 'take_screenshot', 'view_image']
      const missing = need.filter((n) => !names.includes(n))
      assert(missing.length === 0, `✓ 全能力共存 → 三面 11 工具齐备(dataOps×5 + html 委派 + dom 读写×4 + 视觉×2;缺:${missing.join(',') || '无'})`)
      assert(new Set(names).size === names.length, '✓ 多能力同池装配 → 工具名零重复(装配序无覆盖冲突)')
      const sys = sdk.inspect().systemPrompt
      assert(sys.includes('dom_edit') && sys.includes('view_image') && sys.includes('use_html') && sdk.pendingConflict?.value === null,
        '✓ 引导共存:domEdit/view_image/委派编排同时注入 systemPrompt + 冲突武装面反射(pendingConflict ref 就位)')
      await sdk.unmount()
    } finally { fake.restore() }
  }

  // ===== ② 大 JSON 实规模全链路(200 元素;无 code 字段隔离委派守卫) =====
  {
    const items = Array.from({ length: 200 }, (_, i) => ({ name: `商品${i}`, price: i * 2 + 1, tags: i % 3 ? ['a'] : ['b', 'c'], visible: i % 2 === 0 }))
    const bind = { content: '', items }
    const events = []
    const llm = new StubChatModel([
      { toolCalls: [{ name: 'read', args: { jsonPaths: ['items.0.name', 'items.199.name'] } }] },                       // 合批读
      { toolCalls: [{ name: 'query_data', args: { expr: '$.items[?(@.price>290)]' } }] },                               // 条件定位(i≥145 → items.145 首命中)
      { toolCalls: [{ name: 'write', args: { patches: [
        { op: 'set', jsonPath: 'items.3.name', value: '改名3' }, { op: 'set', jsonPath: 'items.50.price', value: 999 }, { op: 'append', jsonPath: 'content', value: '第一块' },
      ] } }] },                                                                                                        // 多路径原子 + 分块首块
      { toolCalls: [{ name: 'write', args: { patch: { op: 'append', jsonPath: 'content', value: '|第二块' } } }] },   // 字符串尾接累积
      { text: '第一段完成' },
      { toolCalls: [{ name: 'restore_data', args: {} }] },                                                             // 只回退最近一次写(append#2)
      { toolCalls: [{ name: 'read', args: { jsonPath: 'items', offset: 0, limit: 5 } }] },                             // 分页
      { text: '第二段完成' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-full-bigjson', storage: false, autoTitle: false, llm,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false, subagent: false },
      data: {
        schema: z.object({ content: z.string(), items: z.array(z.object({ name: z.string(), price: z.number(), tags: z.array(z.string()), visible: z.boolean() })) }),
        bind, description: '大列表',
      },
    })
    await sdk.mount()
    // 第一段:读定位 + 两轮写(断言写后态;restore 放第二段,避免「stream 结束才断言」踩到回退后的终态)
    await sdk.stream([{ role: 'user', content: '批量操作这些商品并汇报', timestamp: Date.now() }], (e) => { if (e.type === 'tool_result') events.push({ name: e.name, text: String(e.result ?? '') }) })
    const readEvents = events.filter((e) => e.name === 'read')
    const batchRead = readEvents[0]?.text ?? ''
    assert(batchRead.includes('商品0') && batchRead.includes('商品199'), `✓ 大 JSON:jsonPaths 合批读一次取回首尾两元素(实际:${batchRead.slice(0, 50)})`)
    const query = events.find((e) => e.name === 'query_data')?.text ?? ''
    assert(query.includes('items.145'), `✓ 大 JSON:JSONPath 条件筛选定位(price>290 首命中 items.145,实际:${query.slice(0, 60)})`)
    assert(bind.items[3].name === '改名3' && bind.items[50].price === 999 && bind.content === '第一块|第二块',
      '✓ 大 JSON:patches 多路径原子生效 + append 分块累积成完整字符串')
    // 第二段:回退最近一次写 + 分页续读
    await sdk.stream([{ role: 'user', content: '回退最后一步并检查分页', timestamp: Date.now() }], (e) => { if (e.type === 'tool_result') events.push({ name: e.name, text: String(e.result ?? '') }) })
    assert(bind.content === '第一块' && bind.items[3].name === '改名3' && bind.items[50].price === 999,
      `✓ 大 JSON:restore_data 只回退最近一次写(append#2 回退,首块与 set 写保留),实际 content=${bind.content}`)
    const pag = events.filter((e) => e.name === 'read').pop()?.text ?? ''
    assert(/hasMore=true/.test(pag), `✓ 大 JSON:分页读(limit 5/200)hasMore=true 引导续读(实际尾:${pag.slice(-60)})`)
    sdk.unmount()
  }

  // ===== ③ 冲突 × html commit:Arm A 防误冲突(recomputeBaseline 吸收子 commit)+ Arm B 同装配真冲突对照 =====
  {
    // Arm A:主 read → 委派(子 commit 直改 code + recomputeBaseline)→ 主写 title 不误冲突
    const bind = { title: 't', components: [{ type: 'custom', name: 'banner', code: '<section>旧</section>', __pgId: 'c_banner' }] }
    const llm = new StubChatModel([
      { toolCalls: [{ name: 'read', args: {} }] },
      { toolCalls: [{ name: 'use_html', args: { task: '改横幅' } }] },
      { toolCalls: [{ name: 'vfs_write', args: { path: 'html/c_banner.html', content: '<section>新横幅</section>' } }] },
      { text: '已改\n[note] 单 section 结构' },
      { toolCalls: [{ name: 'write', args: { value: { title: '新版标题' } } }] },
      { text: '完成' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-full-conflict-html', storage: false, autoTitle: false, llm,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      conflictWatchFields: ['*'],  // 全字段武装:code 变更若无 recomputeBaseline 会被误判为外部改动
      data: {
        schema: z.object({ title: z.string(), components: z.array(z.object({ type: z.string(), name: z.string().optional(), code: z.string().optional() })) }),
        bind, description: '冲突×html',
      },
      subagents: [createHtmlSubagent({ writablePaths: ['components'], formatCheck: false })],
    })
    await sdk.mount()
    await sdk.send('改横幅和标题')
    assert(bind.components[0].code === '<section>新横幅</section>', '✓ 冲突×html:Arm A 子 agent commit 落地(vfs 工作副本 → data.code 直改 bind)')
    assert(bind.title === '新版标题' && sdk.pendingConflict.value === null,
      `✓ 冲突×html:Arm A 全字段武装下主写不误冲突(recomputeBaseline 吸收子 commit),实际 title=${bind.title}`)
    sdk.unmount()
  }
  {
    // Arm B:同装配(冲突武装 + html 委派)真外部改动 → 照常挂起/裁决(conflict.mjs 镜像,叠加 html 子 agent 装配)
    const bind = { title: 'orig', components: [{ type: 'custom', name: 'banner', code: '<section>旧</section>', __pgId: 'c_banner' }] }
    const llm = new StubChatModel([
      { toolCalls: [{ name: 'read', args: {} }] },
      { toolCalls: [{ name: 'write', args: { value: { title: 'agent值' } } }] },
      { text: '收口' },
    ])
    const sdk = createChatSdk({
      ui: false, id: 'e2e-full-conflict-real', storage: false, autoTitle: false, llm,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      conflictWatchFields: ['*'],
      data: {
        schema: z.object({ title: z.string(), components: z.array(z.object({ type: z.string(), name: z.string().optional(), code: z.string().optional() })) }),
        bind, description: '真冲突',
      },
      subagents: [createHtmlSubagent({ writablePaths: ['components'], formatCheck: false })],
    })
    await sdk.mount()
    const p = sdk.stream([{ role: 'user', content: '改标题', timestamp: Date.now() }], (e) => { if (e.type === 'tool_result' && e.name === 'read') bind.title = '外部新值' })
    const deadline = Date.now() + 8000
    while (!sdk.pendingConflict.value && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
    assert(!!sdk.pendingConflict.value, '✓ 冲突×html:Arm B 叠加 html 委派装配下真外部改动照常触发冲突挂起')
    sdk.resolveConflict('keep_external')
    await p
    assert(bind.title === '外部新值', '✓ 冲突×html:Arm B keep_external 裁决保留外部值(agent 写不落地)')
    sdk.unmount()
  }

  // ===== ④ 页面读失效边界:view_image 不在宿主变更失效面(read_page 旧读占位、新读有效) =====
  {
    const fake = installFakeDom()
    const URL_IMG = 'https://picsum.photos/seed/s1/1200/400'
    const realFetch = globalThis.fetch
    globalThis.fetch = async () => { throw new Error('e2e: 物化通道强制失败(密闭性,锁定 URL 直投)') }
    try {
      let notified = false
      const stub = new StubChatModel([
        { toolCalls: [{ name: 'read_page', args: {} }] },            // 读#1(将被失效)
        { toolCalls: [{ name: 'view_image', args: { url: URL_IMG } }] }, // 原图直投(不在失效面)
        { toolCalls: [{ name: 'read_page', args: {} }] },            // 读#2(通知后新读,有效)
        { text: '页面讲注意力机制,第一张图已看' },
      ])
      stub.vision = true
      const sdk = createChatSdk({
        ui: false, id: 'e2e-full-invalid-face', storage: 'memory', autoTitle: false, llm: stub,
        capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false, subagent: false, dataOps: false, domInspect: true },
        screenshot: { renderer: async () => FAKE_PNG },
      })
      await sdk.mount()
      await sdk.stream([{ role: 'user', content: '当前页面内容和第一张图分别是什么?', timestamp: Date.now() }], (e) => {
        if (e.type === 'tool_result' && e.name === 'view_image' && !notified) { notified = true; sdk.notifyHostChange({ reason: 'e2e-full-stack 路由切换' }) }
      })
      const toolTexts = (stub.lastMessages ?? []).filter((m) => m?._getType?.() === 'tool').map((m) => String(m.content ?? ''))
      const reads = toolTexts.filter((t) => t.includes('注意力机制简介') || t.startsWith(STALE_MARK))
      assert(reads.length === 2 && reads[0].startsWith(STALE_MARK) && reads[0].includes('路由切换'),
        `✓ 失效边界:read_page 旧读被占位失效(含 reason),实际首条:${reads[0]?.slice(0, 40)}`)
      assert(reads[1].includes('注意力机制简介') && !reads[1].startsWith(STALE_MARK), '✓ 失效边界:通知后新读不受影响(占位不株连同工具后续读)')
      const vi = toolTexts.find((t) => t.includes(URL_IMG) || t.includes('原图直投') || t.includes('直投'))
      assert(!!vi && !vi.startsWith(STALE_MARK), '✓ 失效边界:view_image 结果不在宿主变更失效面(URL 是数据真值,不随渲染态过期)')
      sdk.unmount()
    } finally { globalThis.fetch = realFetch; fake.restore() }
  }

  console.log(`[e2e:full-stack] 完成: ${ctx.pass} 通过, ${ctx.fail} 失败`)
  return { name: 'full-stack', pass: ctx.pass, fail: ctx.fail }
}
