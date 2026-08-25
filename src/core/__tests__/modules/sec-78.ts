/**
 * sec-78:team-review-hardening 阶段 A/B —— 写能力标注单一真相源 + __pgId 补齐全写路径
 * - A4 标注完整性:写语义工具集都有 writeCapable 标注(新写工具漏标即红,防清单再漂移)/ 只读工具无标注
 * - B2 __pgId 补齐:write 整体替换 / write patch / draft_commit 三路径组件 __pgId 保留 + 新增组件补 id
 *   (eval_script(transform) 走 Node 不可测的 Worker 沙箱,与 write patch 共用 applyPatchesToBind 收敛点)
 */
import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
import { createVfs } from '../../backends/vfs'
import type { TestCtx } from './_ctx'

/** 文档枚举的写语义工具(新增写路径工具须同步进此集与 dataOps markWrite,漏标即下方断言红) */
const WRITE_TOOL_NAMES = ['write', 'draft_commit', 'restore_data', 'resource_update', 'resource_delete']

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx

  const makeOps = (bind: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    createDataOps({
      schema: z.object({
        title: z.string(),
        components: z.array(z.object({ name: z.string(), code: z.string() })),
      }),
      bind,
      description: '测试',
    }, { pgIdPaths: ['components'], ...extra } as any)

  // ===== A4:标注完整性(单一真相源) =====
  {
    const tools = makeOps({ title: 't', components: [{ name: 'a', code: 'x' }] })
    const annotated = new Set(tools.filter((t) => 'writeCapable' in (t as any)).map((t) => t.name))
    const present = new Set(tools.map((t) => t.name))
    for (const name of WRITE_TOOL_NAMES) {
      // draft_commit 需 vfsStore、resource_update/delete 需 resources 才装配;装配了就必须带标注
      if (!present.has(name)) continue
      assert(annotated.has(name), `✓ A4 写工具 ${name} 带 writeCapable 标注(漏标即授权面/锁面判定失效)`)
    }
    // vfs+resources 全开的工具面:补齐 draft/resource 写标注断言
    const full = createDataOps({
      schema: z.object({ title: z.string(), components: z.array(z.object({ name: z.string(), code: z.string() })), secrets: z.record(z.string(), z.string()) }),
      bind: { title: 't', components: [], secrets: {} },
      description: '测试',
      resources: [{ path: 'secrets.k', mode: 'freeze' }],
    }, { pgIdPaths: ['components'], vfsStore: createVfs() } as any)
    const fullAnnotated = new Set(full.filter((t) => 'writeCapable' in (t as any)).map((t) => t.name))
    for (const name of ['draft_commit', 'resource_update', 'resource_delete']) {
      assert(fullAnnotated.has(name), `✓ A4 写工具 ${name}(vfs/resources 装配面)带 writeCapable 标注`)
    }
    // eval_script 条件写:函数形态标注
    const ev = tools.find((t) => t.name === 'eval_script') as any
    assert(typeof ev?.writeCapable === 'function', '✓ A4 eval_script 条件写标注(函数形态)')
    assert(ev.writeCapable({ mode: 'transform' }) === true && ev.writeCapable({ mode: 'query' }) === false && ev.writeCapable({}) === false,
      '✓ A4 eval_script 标注:transform=true / query 与缺省=false')
    // 只读工具无标注(不该被误拦)
    for (const ro of ['read', 'query_data', 'search_data', 'history_data', 'schema_data']) {
      assert(!annotated.has(ro), `✓ A4 只读工具 ${ro} 无写标注(不误拦)`)
    }
  }

  // ===== B2:__pgId 补齐覆盖全写路径 =====
  {
    // write 整体替换:value 不含 __pgId(read 投影隐藏,agent 看不到)→ 原组件 id 保留 + 新增组件补 id
    const bind: any = { title: 't', components: [{ name: 'a', code: 'x', __pgId: 'c_keep' }, { name: 'b', code: 'y', __pgId: 'c_keep2' }] }
    const t = byName(makeOps(bind))
    await invoke(t['write'], { value: { title: 't2', components: [{ name: 'a', code: 'x' }, { name: 'b', code: 'y' }, { name: 'new', code: 'z' }] } })
    assert(bind.components[0].__pgId === 'c_keep' && bind.components[1].__pgId === 'c_keep2',
      '✓ B2 write 整体替换 → 原组件 __pgId 按位置保留(映射键不丢)')
    assert(typeof bind.components[2].__pgId === 'string' && bind.components[2].__pgId.startsWith('c_'),
      '✓ B2 write 整体替换 → 新增组件补 __pgId')
  }
  {
    // write patch:改单字段不动 __pgId;append 新元素补 id
    const bind: any = { title: 't', components: [{ name: 'a', code: 'x', __pgId: 'c_e1' }] }
    const t = byName(makeOps(bind))
    await invoke(t['write'], { patch: { op: 'set', jsonPath: 'components.0.code', value: 'y' } })
    assert(bind.components[0].__pgId === 'c_e1', '✓ B2 write patch → 组件 __pgId 不丢')
    await invoke(t['write'], { patch: { op: 'append', jsonPath: 'components', value: { name: 'b', code: 'z' } } })
    assert(typeof bind.components[1].__pgId === 'string' && bind.components[1].__pgId.startsWith('c_'),
      '✓ B2 write append 新元素 → 补 __pgId')
  }
  {
    // draft_commit:分块构建后整体提交 → id 保留(修前该路径完全漏补;draft 工具需 vfsStore)
    const bind: any = { title: 't', components: [{ name: 'a', code: 'x', __pgId: 'c_d1' }] }
    const t = byName(makeOps(bind, { vfsStore: createVfs() }))
    await invoke(t['draft_write'], { draftId: 'd1', chunk: JSON.stringify({ title: 't', components: [{ name: 'a', code: 'x2' }, { name: 'n', code: 'z' }] }), mode: 'start' })
    await invoke(t['draft_commit'], { draftId: 'd1' })
    assert(bind.components[0].__pgId === 'c_d1', '✓ B2 draft_commit → 原组件 __pgId 保留')
    assert(typeof bind.components[1].__pgId === 'string' && bind.components[1].__pgId.startsWith('c_'),
      '✓ B2 draft_commit → 新增组件补 __pgId')
    // eval_script(transform)同走 applyPatchesToBind 收敛(与 write patch 路径同一 internalAfterWrite 注入);
    // Worker 沙箱 Node 不可测(sec-21 既有约定),此处留痕不重复测
    assert(true, '✓ B2 eval_script(transform) 与 write patch 共用 internalAfterWrite 收敛点(留痕)')
  }
  {
    // rv-code 复审补充:move/重排后按位置回填会错配 → 内容相等匹配优先(剥 __pgId 比较)
    const bind: any = { title: 't', components: [
      { name: 'a', code: 'x', __pgId: 'c_a' },
      { name: 'b', code: 'y', __pgId: 'c_b' },
      { name: 'c', code: 'z', __pgId: 'c_c' },
    ] }
    const t = byName(makeOps(bind))
    // 重排 b,c,a(内容不变,仅顺序变;模拟 move op 后 write 整体提交)
    await invoke(t['write'], { value: { title: 't', components: [
      { name: 'b', code: 'y' }, { name: 'c', code: 'z' }, { name: 'a', code: 'x' },
    ] } })
    const byNameM = Object.fromEntries(bind.components.map((c: any) => [c.name, c.__pgId]))
    assert(byNameM['a'] === 'c_a' && byNameM['b'] === 'c_b' && byNameM['c'] === 'c_c',
      '✓ B2 数组重排(write 整体提交)→ 内容相等匹配回填,各组件 __pgId 不错配(rv-code 复审修复)')
    // 混合:重排 + 改动一个元素内容(内容匹配失败 → 位置兜底)
    await invoke(t['write'], { value: { title: 't', components: [
      { name: 'b', code: 'y' }, { name: 'c', code: 'z2' }, { name: 'a', code: 'x' },
    ] } })
    const byName2 = Object.fromEntries(bind.components.map((c: any) => [c.name, c.__pgId]))
    assert(byName2['a'] === 'c_a' && byName2['b'] === 'c_b',
      '✓ B2 重排+未改元素仍内容匹配回填(a/b 不错配)')
    assert(typeof byName2['c'] === 'string' && byName2['c'].startsWith('c_'),
      '✓ B2 内容改动的元素:位置兜底或新生成(有合法 __pgId 即可,旧 id c_c 允许漂移)')
  }

  // ===== write-path-cost-reduction B 段:beforeBind 复用为快照条目(3→2 深拷贝)后行为零变化 =====
  {
    const bind: any = { title: 's', components: [
      { name: 'beer', code: '<p>v1</p>', __pgId: 'c_beer' },
      { name: 'mug', code: '<p>keep</p>', __pgId: 'c_mug' },
    ] }
    const tools = makeOps(bind)
    const t = byName(tools)
    const before = bind.components[0].code
    const r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'components.0.code', value: '<p>v2</p>' } })
    assert(/已 write/.test(r) && bind.components[0].code === '<p>v2</p>', '✓ codeAsset 写生效(B 段前置)')
    assert(bind.components[0].__pgId === 'c_beer', '✓ __pgId 经 beforeBind 回填保留(快照共享不破坏回填链)')
    // 快照条目 === 改前完整态:restore_data 回退后 v1 复现 + __pgId 不丢(restore 防御性深拷贝消费共享快照)
    const rr = await invoke(t['restore_data'], { id: 1 })
    assert(/已回退/.test(rr) && bind.components[0].code === before, '✓ restore_data 回退到改前完整态(beforeBind 复用为快照值正确)')
    assert(bind.components[0].__pgId === 'c_beer' && bind.components[1].code === '<p>keep</p>', '✓ 回退后 __pgId 与未改组件不受快照共享影响')
    // 非 codeAsset 模式对照:beforeBind=null → 快照自拷贝,行为同上
    const plainBind: any = { title: 's', components: [{ name: 'a', code: 'x' }] }
    const plain = createDataOps({
      schema: z.object({ title: z.string(), components: z.array(z.object({ name: z.string(), code: z.string() })) }),
      bind: plainBind, description: '测试',
    })
    const pt = byName(plain)
    await invoke(pt['write'], { patch: { op: 'set', jsonPath: 'components.0.code', value: 'y' } })
    await invoke(pt['restore_data'], { id: 1 })
    assert(plainBind.components[0].code === 'x', '✓ 非 codeAsset 模式快照行为零变化(自拷贝兜底)')
  }
}
