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

  // ===== freeze-move 豁免(2026-08-28 uispec S3 驱动:保护锚定「值」不锚定「数组位置」)=====
  {
    const z3 = z.object({
      title: z.string(),
      components: z.array(z.object({ type: z.string(), props: z.object({ trackId: z.string().optional(), name: z.string().optional() }) })),
    })
    const bind3: any = {
      title: 't',
      components: [
        { type: 'nav', props: { trackId: 'trk_1', name: 'nav' } },
        { type: 'custom', props: { name: 'coupon' } },
      ],
    }
    const tools3 = createDataOps(
      { schema: z3, bind: bind3, resources: [{ path: 'components.0.props.trackId', mode: 'freeze' }] },
      { vfsStore: createVfs() },
    )
    const t3 = byName(tools3)
    // ① move 非冻结元素到 index 0(冻结元素顺移到 1)→ 放行,冻结值随元素整体位移(修前误报 FROZEN_FIELD)
    const mv = await invoke(t3.write, { patch: { op: 'move', jsonPath: 'components.1', value: 'components.0' } })
    assert(!/^ERROR:/.test(mv), `✓ move 调序命中冻结元素位置 → 放行(修前 FROZEN_FIELD 误拦;${mv.slice(0, 80)}`)
    assert(bind3.components[0].props.name === 'coupon' && bind3.components[1].props.trackId === 'trk_1',
      '✓ 调序后冻结值随元素位移(nav 到 index 1,trackId 原值保全)')
    // ② 整数组 set 重排(同值保全)→ 同豁免 + 注册表已随 ① 迁移(修前:① 后路径过期,cur 取到
    //    coupon 的 undefined → 把合法 set 误判「改了冻结值」)
    const reordered = [bind3.components[1], bind3.components[0]]
    const st = await invoke(t3.write, { patch: { op: 'set', jsonPath: 'components', value: reordered } })
    assert(!/^ERROR:/.test(st) && bind3.components[0].props.name === 'nav' && bind3.components[0].props.trackId === 'trk_1',
      '✓ 整数组 set 调序(冻结值保全)→ 放行(修前:① 调序后注册表路径过期 → 后续合法写误报 FROZEN_FIELD)')
    // ③ 反例:改冻结值仍拦(豁免不放宽篡改)
    const tamper = await invoke(t3.write, { patch: { op: 'set', jsonPath: 'components.0.props.trackId', value: 'hacked' } })
    assert(/FROZEN_FIELD/.test(tamper), '✓ 调序豁免不改值:直改冻结字段照拦')
    // ④ 反例:删冻结元素仍拦(remove patch C3)
    const del = await invoke(t3.write, { patch: { op: 'remove', jsonPath: 'components.0' } })
    assert(/FROZEN_FIELD/.test(del), '✓ 调序豁免不纵删除:remove 冻结元素照拦')
  }

  // ===== freeze-move 边界四件(置换安全/嵌套数组锚定/跨数组不豁免/位移同时改值)=====
  {
    const z3 = z.object({
      title: z.string(),
      components: z.array(z.object({ type: z.string(), props: z.object({ trackId: z.string().optional(), name: z.string().optional(), children: z.array(z.any()).optional() }) })),
    })
    // ① 置换安全:两冻结元素互换位置(commitReanchors 置换 apply,delete 先行会互吃 → 都保留保护)
    const zb = { title: 't', components: [
      { type: 'nav', props: { trackId: 'trk_a', name: 'A' } },
      { type: 'footer', props: { trackId: 'trk_b', name: 'B' } },
    ] }
    const tz = createDataOps(
      { schema: z3, bind: zb, resources: [{ path: 'components.0.props.trackId', mode: 'freeze' }, { path: 'components.1.props.trackId', mode: 'freeze' }] },
      { vfsStore: createVfs() },
    )
    const tw = byName(tz)
    const swap = await invoke(tw.write, { patch: { op: 'set', jsonPath: 'components', value: [zb.components[1], zb.components[0]] } })
    assert(!/^ERROR:/.test(swap) && zb.components[0].props.name === 'B' && zb.components[1].props.name === 'A',
      '✓ 两冻结元素互换位置 → 放行且置换后注册表双保护存活(改回方向不再误拦)')
    const swapBack = await invoke(tw.write, { patch: { op: 'set', jsonPath: 'components', value: [zb.components[1], zb.components[0]] } })
    assert(!/^ERROR:/.test(swapBack), '✓ 置换后再换回 → 仍放行(置换安全:两路径保护互不吞吃)')
    const tamperSwap = await invoke(tw.write, { patch: { op: 'set', jsonPath: 'components.0.props.trackId', value: 'hacked' } })
    assert(/FROZEN_FIELD/.test(tamperSwap), '✓ 置换后改冻结值照拦(保护跟元素不丢)')

    // ② 嵌套数组锚定:children 内冻结字段随容器元素在顶层调序 → 同豁免
    const nb: any = { title: 't', components: [
      { type: 'nav', props: { name: 'nav' }, children: [{ type: 'tab', props: { trackId: 'trk_c', name: 'tab' } }] },
      { type: 'custom', props: { name: 'coupon' } },
    ] }
    const tn = createDataOps(
      { schema: z3, bind: nb, resources: [{ path: 'components.0.children.0.props.trackId', mode: 'freeze' }] },
      { vfsStore: createVfs() },
    )
    const tw2 = byName(tn)
    const nestedMove = await invoke(tw2.write, { patch: { op: 'move', jsonPath: 'components.1', value: 'components.0' } })
    assert(!/^ERROR:/.test(nestedMove) && nb.components[1].children[0].props.trackId === 'trk_c',
      '✓ 嵌套数组冻结字段(children.0)随顶层调序 → 豁免 + 值随元素位移到最后一个数组锚')

    // ③ 跨数组移动冻结元素 → 不豁免(与 codeAsset 嵌套容器盲区同口径,宁拒勿失)
    const xb: any = { title: 't', components: [
      { type: 'nav', props: { trackId: 'trk_d', name: 'nav' } },
    ], blocks: [] }
    const z4 = z.object({
      title: z.string(),
      components: z.array(z.object({ type: z.string(), props: z.object({ trackId: z.string().optional(), name: z.string().optional(), children: z.array(z.any()).optional() }).optional() })),
      blocks: z.array(z.any()),
    })
    const tx = createDataOps({ schema: z4, bind: xb, resources: [{ path: 'components.0.props.trackId', mode: 'freeze' }] }, { vfsStore: createVfs() })
    const tw3 = byName(tx)
    const cross = await invoke(tw3.write, { patch: { op: 'move', jsonPath: 'components.0', value: 'blocks.0' } })
    assert(/FROZEN_FIELD|ERROR/.test(String(cross)), '✓ 冻结元素跨数组移动 → 不豁免照拦(仅同数组位移豁免)')

    // ④ 位移同时改值(新位置值 ≠ 原值)→ 不豁免(豁免锚的是原值完整保留)
    const vb: any = { title: 't', components: [
      { type: 'nav', props: { trackId: 'trk_e', name: 'nav' } },
      { type: 'custom', props: { name: 'coupon' } },
    ] }
    const tv = createDataOps({ schema: z3, bind: vb, resources: [{ path: 'components.0.props.trackId', mode: 'freeze' }] }, { vfsStore: createVfs() })
    const tw4 = byName(tv)
    const moved = JSON.parse(JSON.stringify(vb.components[0])); moved.props.trackId = 'tampered'
    const tamperMove = await invoke(tw4.write, { patch: { op: 'set', jsonPath: 'components', value: [vb.components[1], moved] } })
    assert(/FROZEN_FIELD/.test(tamperMove), '✓ 位移同时改冻结值 → 照拦(原值未完整保留,豁免不成立)')
  }

  // ===== restore-guard:restore_data 选择性回退(4.9.1 ②,借 restore 绕 freeze 只读的防线)=====
  console.log('\n[restore_data 选择性回退 · freeze 字段保留宿主现值]')
  {
    // 场景①(主形态):快照后宿主更新 freeze 字段 → 回退非保护部分,freeze 保留宿主新值 + 消息明示
    const b1: any = { id: 'frozen-1', title: '旧标题', components: [] }
    const t1 = byName(createDataOps({ schema, bind: b1, resources: [{ path: 'id', mode: 'freeze' }] }, { vfsStore: createVfs() }))
    await invoke(t1.write, { patch: { op: 'set', jsonPath: 'title', value: '新标题' } })   // 快照 #1(id=frozen-1)
    b1.id = 'host-updated'                                                                 // 宿主直改(不经 SDK 写路径)
    const r1 = await invoke(t1.restore_data, {})
    assert(b1.id === 'host-updated', '✓ restore 选择性回退:freeze 字段保留宿主现值(修前被快照旧值洗回 frozen-1)')
    assert(b1.title === '旧标题', '✓ restore 选择性回退:非保护字段照常回退')
    assert(/保留当前值未回退/.test(r1) && /id/.test(r1), '✓ restore 结果消息明示保留字段(所见非所得防线:引导 read 复核)')

    // 场景②(无差异零变化):freeze 值与快照一致 → 原行为整体回退,无保留警示
    const b2: any = { id: 'frozen-2', title: '旧', components: [] }
    const t2 = byName(createDataOps({ schema, bind: b2, resources: [{ path: 'id', mode: 'freeze' }] }, { vfsStore: createVfs() }))
    await invoke(t2.write, { patch: { op: 'set', jsonPath: 'title', value: '新' } })
    const r2 = await invoke(t2.restore_data, {})
    assert(b2.id === 'frozen-2' && b2.title === '旧' && !/保留当前值/.test(r2), '✓ 无差异(未配/值一致)→ 原行为整体回退零变化')

    // 场景③(__pgId 锚定):快照窗口内宿主重排数组 + 更新 freeze 值 → 按元素 id 回填到重排后正确元素
    const b3: any = {
      id: 'p', title: 't',
      components: [
        { type: 'a', verification: 'v1', __pgId: 'c_1' },
        { type: 'b', verification: 'v2', __pgId: 'c_2' },
      ],
    }
    const t3 = byName(createDataOps({ schema, bind: b3, resources: [{ path: 'components.0.verification', mode: 'freeze' }, { path: 'components.1.verification', mode: 'freeze' }] }, { vfsStore: createVfs() }))
    await invoke(t3.write, { patch: { op: 'set', jsonPath: 'title', value: 't2' } })       // 快照(排列 [a,b])
    b3.components = [b3.components[1], b3.components[0]]                                    // 宿主直改重排(注册表不迁移)
    b3.components[0].verification = 'v2-new'                                                // 宿主更新 b 的冻结值
    const r3 = await invoke(t3.restore_data, {})
    assert(b3.components[1].type === 'b' && b3.components[1].verification === 'v2-new', '✓ __pgId 锚定:宿主新值回填到重排后正确元素(字面路径回填会错写到 a)')
    assert(b3.components[0].type === 'a' && b3.components[0].verification === 'v1', '✓ __pgId 锚定:快照排列恢复,a 元素冻结值原样')

    // 场景④(元素已删):当前无值 + 快照有 → 保留快照值保 schema 合法 + 警示复核(宁旧勿错)
    const b4: any = {
      id: 'p', title: 't',
      components: [{ type: 'a', verification: 'v1' }, { type: 'b', verification: 'v2' }],
    }
    const t4 = byName(createDataOps({ schema, bind: b4, resources: [{ path: 'components.1.verification', mode: 'freeze' }] }, { vfsStore: createVfs() }))
    await invoke(t4.write, { patch: { op: 'set', jsonPath: 'title', value: 't2' } })
    b4.components.pop()                                                                     // 宿主删了带 freeze 的元素
    const r4 = await invoke(t4.restore_data, {})
    assert(typeof b4.components[1]?.verification === 'string' && /未能回填/.test(r4), '✓ 元素已删:保留快照值(不复活宿主已删状态) + 警示宿主侧核对')
  }

  // ===== A3(4.9.2):restore 快照整对象校验株连 → 留痕放行 =====
  console.log('\n[restore 校验降级 · 脏兄弟不株连合法回退]')
  {
    // ⑤(主形态):宿主直改的脏兄弟值(number 进 string 字段)随快照入栈 → 回退不再被整体校验拦死
    const b5: any = { id: 'x', title: '合法', components: [] }
    const t5 = byName(createDataOps({ schema, bind: b5 }, {}))
    await invoke(t5.write, { patch: { op: 'append', jsonPath: 'components', value: { type: 'nav' } } })  // 快照(title 仍合法)
    b5.title = 999 as unknown as string  // 宿主直改脏值(不经 SDK 写路径,整体校验从未覆盖)
    await invoke(t5.write, { patch: { op: 'append', jsonPath: 'components', value: { type: 'hero' } } })  // 快照(含脏 title)
    const r5 = await invoke(t5.restore_data, { id: 2 })  // 回到「含脏 title + 1 组件」的快照
    assert(/已回退/.test(r5) && b5.components.length === 1 && b5.title === 999, '✓ 脏兄弟快照回退放行(修前 SNAPSHOT_SCHEMA_INVALID 拦死;回滚到拍栈时活态)')

    // ⑥(不可达不变式钉进测试):setData 换 schema → 快照栈清空 → restore 恒 NO_SNAPSHOT(旧快照×新 schema 状态不可达)
    const b6: any = { id: 'x', title: 't', components: [] }
    const tools6 = createDataOps({ schema, bind: b6 }, {})
    await invoke(byName(tools6).write, { patch: { op: 'set', jsonPath: 'title', value: 't2' } })  // 产生快照
    ;(tools6 as unknown as { controller: { set: (c: unknown) => void } }).controller.set({ schema, bind: b6, description: 'd' })  // setData 换绑
    const r6 = await invoke(byName(tools6).restore_data, {})
    assert(/NO_SNAPSHOT/.test(r6), '✓ setData 换绑清快照栈:schema 变更后旧快照不可达(NOT SNAPSHOT_SCHEMA_INVALID,防线想拦的状态不存在)')

    // ⑦(guard × 脏兄弟共存):4.9 冻结保护差异比对与 A3 降级同场景共存 —— 回退放行且保护字段照常保留
    const b7: any = { id: 'frozen-7', title: '合法', components: [] }
    const t7 = byName(createDataOps({ schema, bind: b7, resources: [{ path: 'id', mode: 'freeze' }] }, {}))
    await invoke(t7.write, { patch: { op: 'set', jsonPath: 'title', value: '新' } })  // 快照 A
    b7.title = 999 as unknown as string   // 脏兄弟(随快照 B 入栈)
    await invoke(t7.write, { patch: { op: 'set', jsonPath: 'title', value: '更新' } })  // 快照 B(含脏 999)
    b7.id = 'host-7'                      // 宿主更新冻结字段(快照 B 之后)
    const r7 = await invoke(t7.restore_data, { id: 2 })
    assert(/已回退/.test(r7) && b7.id === 'host-7' && b7.title === 999 && /保留当前值未回退/.test(r7), '✓ 脏兄弟 × 冻结差异共存:回退放行 + 保护字段保留宿主现值(两层防线互不干扰)')
  }
}
