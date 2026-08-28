/**
 * sec-59:placeholder-protected-read-write Phase 2(freeze 接入 dataOps)
 * createDataOps 配 data.resources(freeze)→ read 占位符 + write(del)/eval 强制层 + C3 + C1 回显。
 * 覆盖:结构化读占位替换 / write set 改 freeze 拒 / 回显放行(C1 不落占位符串)/ patch 改 freeze 拒 /
 *      delete freeze C3 / merge 保留 / query 返真值(A1)/ eval transform F1 / getResourcesSnapshot /
 *      未配 resources 零影响 / 无 vfsStore 降级。
 */
import type { TestCtx } from './_ctx'
import { createVfs } from '../../backends/vfs'
import { createDataOps } from '../../tools/dataOps'
import { z } from 'zod'

export async function run(ctx: TestCtx) {
  const { assert, invoke, byName } = ctx

  const schema = z.object({
    id: z.string(),
    title: z.string(),
    components: z.array(z.object({ type: z.string(), verification: z.string().optional() })),
  })
  const bind: { id: string; title: string; components: { type: string; verification?: string }[] } = {
    id: 'frozen-id', title: '页面', components: [{ type: 'nav', verification: 'v0' }],
  }
  const vfs = createVfs()
  const tools = createDataOps(
    { schema, bind, resources: [{ path: 'id', mode: 'freeze' }, { path: 'components.0.verification', mode: 'freeze' }] },
    { vfsStore: vfs },
  )
  const t = byName(tools)

  // ===== 结构化读:占位符替换(精确值不入消息流)=====
  const r1 = await invoke(t.read, {})
  assert(/⟦frozen:id⟧/.test(r1), '✓ read 整体 → freeze 字段 id 换占位符(精确值不入消息流)')
  assert(/页面/.test(r1), '✓ read 整体 → 非受保护字段 title 原值保留')
  assert(/⟦frozen:components\.0\.verification⟧/.test(r1), '✓ read 整体 → 嵌套 freeze 路径占位符')
  const r2 = await invoke(t.read, { jsonPath: 'id' })
  assert(/⟦frozen:id⟧/.test(r2), '✓ read 子路径(id)→ 占位符')

  // ===== 写侧强制:freeze 拒 =====
  const w1 = await invoke(t.write, { value: { id: 'changed', title: '页面', components: [] } })
  assert(/FROZEN_FIELD/.test(w1), '✓ write set 改 freeze 字段 → FROZEN_FIELD')
  // C1 回显:整体 set 带 freeze 占位符 → 放行(回填当前值,占位符串不落 bind)
  const w2 = await invoke(t.write, { value: { id: '⟦frozen:id⟧', title: '新标题', components: [{ type: 'nav', verification: '⟦frozen:components.0.verification⟧' }] } })
  assert(!/FROZEN_FIELD/.test(w2) && /新标题/.test(w2), '✓ write set 回显 freeze 占位符 → 放行(回填当前值)')
  assert(bind.id === 'frozen-id', '✓ C1 回显 → bind freeze 值不变(占位符串不落 bind)')
  assert(bind.title === '新标题', '✓ C1 回显 → 非受保护字段更新')
  assert(bind.components[0].verification === 'v0', '✓ C1 回显 → 嵌套 freeze 值不变')
  // write patch 改 freeze → FROZEN_FIELD
  const w3 = await invoke(t.write, { patch: { op: 'set', jsonPath: 'id', value: 'changed' } })
  assert(/FROZEN_FIELD/.test(w3), '✓ write patch 改 freeze → FROZEN_FIELD')
  // write patch 改非受保护 → 放行
  const w4 = await invoke(t.write, { patch: { op: 'set', jsonPath: 'title', value: '标题2' } })
  assert(!/FROZEN_FIELD/.test(w4), '✓ write patch 改非受保护字段 → 放行')

  // ===== C3:delete 受保护路径拒 =====
  const w5 = await invoke(t.write, { patch: { jsonPath: 'id' }, del: true })
  assert(/FROZEN_FIELD/.test(w5), '✓ write delete freeze 路径 → FROZEN_FIELD(C3)')
  const d1 = await invoke(t.write, { patch: { jsonPath: 'components.0.verification' }, del: true })
  assert(/FROZEN_FIELD/.test(d1), '✓ write del freeze 路径 → FROZEN_FIELD(C3)')

  // ===== query/search 返真值(A1:不占位替换,写侧强制兜底)=====
  const q1 = await invoke(t.query_data, { expr: '$.id' })
  assert(/frozen-id/.test(q1) && !/⟦frozen/.test(q1), '✓ query_data → 返真值(A1,结构化读才替换)')

  // ===== F1 eval 整体替换强制层:eval_script 用 Web Worker 沙箱,node 自测环境无 Worker 无法执行 transform。
  //   eval 整体替换内联调 enforceSet(dataOps.ts:640,与 commitSetToBind 同一纯函数 sec-58 已覆盖),其 freeze
  //   拒绝逻辑已由 w1(commitSetToBind 路径)+ w3(applyPatchesToBind 路径)代表,eval 端到端留浏览器 E2E 验证。=====

  // ===== controller.getResourcesSnapshot(供跨压缩 pin)=====
  const snap = (tools as unknown as { controller: { getResourcesSnapshot: () => { path: string; mode: string }[] } }).controller.getResourcesSnapshot()
  assert(snap.some((s) => s.path === 'id' && s.mode === 'freeze'), '✓ controller.getResourcesSnapshot → 含 freeze 路径清单')

  // ===== 未配 resources → 零行为变化(read 返原值)=====
  const tools2 = createDataOps({ schema, bind: { id: 'plain', title: 't', components: [] } }, { vfsStore: vfs })
  const t2 = byName(tools2)
  const r4 = await invoke(t2.read, {})
  assert(!/⟦frozen/.test(r4) && /plain/.test(r4), '✓ 未配 resources → read 返原值(零行为变化)')

  // ===== 无 vfsStore + freeze resources → protectedCtx 仍构造(resourceStore 可选),freeze 工作(仅 verbatim 需 vfsStore)=====
  const tools3 = createDataOps({ schema, bind: { id: 'nofreeze', title: 't', components: [] }, resources: [{ path: 'id', mode: 'freeze' }] })
  const t3 = byName(tools3)
  const r5 = await invoke(t3.read, {})
  assert(/⟦frozen:id⟧/.test(r5), '✓ 无 vfsStore → freeze 仍工作(protectedCtx 不依赖 resourceStore;仅 verbatim 需 vfsStore)')

  // ===== H1b:整体清空含 freeze 字段的容器 → 显式拒 + 正路出口真的通(2026-08-26「清空组件」15 轮事故驱动)=====
  // 造一个非冻结元素(components.1) → set components=[] 应拒(旧:捏造骨架 → SCHEMA_INVALID "0.type" 不提保护)
  const h1a = await invoke(t.write, { patch: { op: 'append', jsonPath: 'components', value: { type: 'banner' } } })
  assert(/append/.test(h1a) || !/ERROR/.test(h1a), '✓ H1b 前置:append 非冻结元素(components.1)')
  const h1b = await invoke(t.write, { patch: { op: 'set', jsonPath: 'components', value: [] } })
  assert(/FROZEN_FIELD/.test(h1b) && /整体替换会移除受保护字段/.test(h1b) && /逐个 remove/.test(h1b), '✓ H1b write patch set components=[] → 显式 FROZEN_FIELD + 可执行出口(旧:捏造骨架 → SCHEMA_INVALID 误导)')
  assert(bind.components.length === 2, '✓ H1b 整体清空被拒 → bind 不变')
  // 引导文案指的正路:逐个 remove 非冻结元素 → 成功;冻结元素所在的 components.0 保留
  const h1c = await invoke(t.write, { patches: [{ op: 'remove', jsonPath: 'components.1' }] })
  assert(!/ERROR/.test(h1c) && bind.components.length === 1 && bind.components[0].verification === 'v0', '✓ H1b 正路出口:remove 非冻结元素成功,冻结元素(components.0)保留')

  // ===== resource 工具对静态 freeze 的定向文案(旧:「不存在(无需释放)」/「无已注册」把模型带偏两轮)=====
  const rd = await invoke(t.resource_delete, { path: 'id' })
  assert(/FROZEN_FIELD/.test(rd) && /静态保护/.test(rd) && /集成方/.test(rd), '✓ resource_delete freeze 静态路径 → 定向文案(无句柄不可释放,指集成方)而非「不存在」')
  const rl = await invoke(t.resource_list, {})
  assert(/freeze 只读字段/.test(rl) && /id/.test(rl) && /resource_delete 仅对 verbatim/.test(rl), '✓ resource_list 空池 + 静态 freeze → 列出 freeze 路径面(不再「无已注册」误导)')
  // ===== frozen-required-hint:缺必填命保护字段名 → SCHEMA_INVALID 附「勿编造值硬闯」提示 =====
  {
    const z2 = z.object({
      title: z.string(),
      components: z.array(z.object({ type: z.string(), props: z.object({ trackId: z.string(), title: z.string() }) })),
    })
    const bind2: any = { title: 't', components: [{ type: 'nav', props: { trackId: 'trk_1', title: 'a' } }] }
    const tools2 = createDataOps(
      { schema: z2, bind: bind2, resources: [{ path: 'components.0.props.trackId', mode: 'freeze' }] },
      { vfsStore: createVfs() },
    )
    const t2 = byName(tools2)
    // 新建元素缺受保护必填字段(trackId)→ SCHEMA_INVALID + 死锁提示(防编造值硬闯)
    const nr = await invoke(t2.write, { patch: { op: 'set', jsonPath: 'components.1', value: { type: 'banner', props: { title: 'b' } } } })
    assert(/SCHEMA_INVALID/.test(nr) && /受保护/.test(nr) && /勿编造值硬闯/.test(nr),
      '✓ 新建元素缺受保护必填字段 → SCHEMA_INVALID 附死锁提示(增量形态/集成方设可选)')
    // 对照:非保护字段缺必填 → 原提示零变化
    const nr2 = await invoke(t2.write, { patch: { op: 'set', jsonPath: 'components.1', value: { type: 'banner', props: { trackId: 'x', title: 'b', extra: 1 } } } })
    assert(/SCHEMA_STRIP|SCHEMA_INVALID/.test(nr2) && !/勿编造值硬闯/.test(nr2),
      '✓ 非保护字段问题 → 不附保护死锁提示(零误伤)')
  }

}
