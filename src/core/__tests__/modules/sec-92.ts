/**
 * sec-92 —— path-scoped-validation(write 校验局部化:兄弟脏数据不株连)
 *
 * 背景(editor_fangzhou 实测 script:"" 事故):write 整对象 safeParse → 任一节点的历史脏数据
 * 拦死全部单点写入。契约收窄:「全局结构一致」→「被写子树结构合法」。
 *
 * A. 兄弟脏数据不株连(改 A,兄弟 B 脏 → 成功;事故复刻)
 * B. 目标路径坏值仍拒(SCHEMA_INVALID,details 只含目标范围)
 * C. append 只校验新增元素(兄弟脏数据在场 append 成功;新增元素坏值拒)
 * D. remove 只校验父容器结构约束(min length 拦;无约束直过);del 意图维持无校验
 * E. strip 联动:声明节点未声明新键 → SCHEMA_STRIP 拒;开放节点(record/any)新键放行
 * F. union 歧义:any-option-accepts(任一 option 接受即过,全拒聚合)
 * G. 整体 set 只校验出现 key(缺必填不再拒、未出现 key 保留);patches 后条修复前条最终态合法即过
 * H. 原子语义不变:patches 单条目标坏 → 整批不写
 * I. 写回防原型污染:merge value 含 __proto__ own 键不落 bind(fix-write-safety-bypass 防线平移)
 */
import type { TestCtx } from './_ctx'
import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'

/** 事故复刻 schema:script 声明 z.array(脏数据是 "" —— 旧整对象校验下任何写入必挂) */
function editorLikeSchema() {
  return z.object({
    components: z.array(z.object({
      id: z.number(),
      name: z.string(),
      script: z.array(z.string()),            // ← 事故本体:真实数据 "" 不符
      style: z.record(z.string(), z.unknown()), // 开放 record
      props: z.object({ title: z.string() }),
    })),
  })
}

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('[sec-92] path-scoped-validation:write 校验局部化(兄弟脏数据不株连)')

  // ===== A/B. 兄弟脏数据不株连 + 目标坏值仍拒 =====
  {
    const bind: any = {
      components: [
        { id: 1, name: 'navbar', script: '', style: {}, props: { title: 'a' } },   // 脏 script=""
        { id: 2, name: 'banner', script: [], style: {}, props: { title: 'b' } },
      ],
    }
    const t = byName(createDataOps({ schema: editorLikeSchema(), bind, description: '专题页' }))

    // A:改组件 2 的 title —— 旧整对象校验必挂(兄弟组件 1 script 脏),局部校验放行
    let r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'components.1.props.title', value: '已改' } })
    assert(bind.components[1].props.title === '已改' && /已 write/.test(r), '✓ 局部校验 → 兄弟脏数据(script:"")不株连单点写入(事故复刻)')

    // A2:改脏组件自己声明的其他字段也放行(株连连「肇事者本人」的非肇事字段都不该拦)
    r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'components.0.props.title', value: '也改' } })
    assert(bind.components[0].props.title === '也改', '✓ 局部校验 → 脏组件自身非肇事字段也可写')

    // B:目标路径坏值仍拒(title 非字符串)
    r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'components.1.props.title', value: '5' } })
    assert(/SCHEMA_INVALID/.test(r) && bind.components[1].props.title === '已改', '✓ 局部校验 → 目标坏值仍拒(不写入)')
    // B2:错误 details 指向目标路径(不再报兄弟的 5 处问题)
    assert(/components\.1\.props\.title|props\.title/.test(r), '✓ 局部校验 → 错误定位到写入路径(非全树 issues)')
  }

  // ===== C. append 只校验新增元素 =====
  {
    const bind: any = {
      components: [
        { id: 1, name: 'old', script: '', style: {}, props: { title: 'x' } },  // 脏兄弟在场
      ],
    }
    const t = byName(createDataOps({ schema: editorLikeSchema(), bind, description: '专题页' }))
    // C1:兄弟脏数据在场 append 合法新元素 → 成功(旧整对象校验必挂 = 株连复刻)
    let r = await invoke(t['write'], { patch: { op: 'append', jsonPath: 'components', value: { id: 2, name: 'new', script: [], style: {}, props: { title: 'n' } } } })
    assert(bind.components.length === 2 && bind.components[1].name === 'new', '✓ append → 只校验新增元素,脏兄弟不拦(反株连)')
    // C2:新增元素自身坏值(name 非字符串)→ 拒
    r = await invoke(t['write'], { patch: { op: 'append', jsonPath: 'components', value: { id: 3, name: 5, script: [], style: {}, props: { title: 'n' } } } })
    assert(/SCHEMA_INVALID/.test(r) && bind.components.length === 2, '✓ append → 新增元素坏值仍拒')
  }

  // ===== D. remove 只校验父容器结构约束 =====
  {
    const bind: any = {
      components: [
        { id: 1, name: 'a', script: '', style: {}, props: { title: 'x' } },
        { id: 2, name: 'b', script: [], style: {}, props: { title: 'y' } },
      ],
    }
    const schema = z.object({ components: z.array(z.object({ id: z.number(), name: z.string(), script: z.array(z.string()), style: z.record(z.string(), z.unknown()), props: z.object({ title: z.string() }) })).min(1) })
    const t = byName(createDataOps({ schema, bind, description: '专题页' }))
    // D1:remove 后父数组仍 ≥ min(1) → 过(脏兄弟 script:"" 不参与校验)
    let r = await invoke(t['write'], { patch: { op: 'remove', jsonPath: 'components.1' } })
    assert(bind.components.length === 1 && /已 write/.test(r), '✓ remove → 只校验父容器结构约束(min length)')
    // D2:remove 后跌破 min(1) → 拒
    r = await invoke(t['write'], { patch: { op: 'remove', jsonPath: 'components.0' } })
    assert(/SCHEMA_INVALID/.test(r) && bind.components.length === 1, '✓ remove → 父容器跌破 min 约束仍拒')
    // D3:write del 意图维持无校验现状(删脏数据自身 —— 旧 del 分支本无校验,现状锁定)
    const bind2: any = { components: [{ id: 9, name: 'dirty', script: '', style: {}, props: { title: 'z' } }] }
    const t2 = byName(createDataOps({ schema, bind: bind2, description: '专题页' }))
    r = await invoke(t2['write'], { patch: { jsonPath: 'components.0' }, del: true })
    assert(bind2.components.length === 0, '✓ write del → 维持无校验现状(可删脏数据自身)')
  }

  // ===== E. strip 联动:声明节点未声明键拒 / 开放节点放行 =====
  {
    const bind: any = { components: [{ id: 1, name: 'a', script: [], style: {}, props: { title: 'x' } }] }
    const t = byName(createDataOps({ schema: editorLikeSchema(), bind, description: '专题页' }))
    // E1:set 声明节点出现未声明新键 → SCHEMA_STRIP(防线平移)
    let r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'components.0.props', value: { title: 'x', bogus: 1 } } })
    assert(/SCHEMA_STRIP/.test(r) && bind.components[0].props.bogus === undefined, '✓ strip 联动 → 声明节点未声明新键仍拒(fix-silent-strip 平移)')
    // E2:开放 record(style)写任意键 → 放行
    r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'components.0.style.background', value: '"red"' } })
    assert(bind.components[0].style.background === 'red', '✓ 开放节点 → record 任意键放行')
  }

  // ===== F. union 歧义:any-option-accepts =====
  {
    const schema = z.object({
      items: z.array(z.union([
        z.object({ kind: z.literal('text'), text: z.string() }),
        z.object({ kind: z.literal('num'), num: z.number() }),
      ])),
    })
    const bind: any = { items: [{ kind: 'text', text: 'a' }] }
    const t = byName(createDataOps({ schema, bind, description: 'u' }))
    // F1:写 option-2 形态(kind:num)→ 任一 option 命中即过(getSchemaAtPath hits[0] 可能只认 option-1)
    let r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'items.0', value: { kind: 'num', num: 7 } } })
    assert(bind.items[0].num === 7, '✓ union-tolerant → 非 hits[0] 分支的合法值不再误拒')
    // F2:两 option 都不接受 → 拒
    r = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'items.0', value: { kind: 'text', num: 'x' } } })
    assert(/SCHEMA_INVALID/.test(r) && bind.items[0].num === 7, '✓ union-tolerant → 全 option 拒仍拒')
  }

  // ===== G. 整体 set 只校验出现 key + patches 最终态 =====
  {
    const schema = z.object({ title: z.string(), count: z.number().int() })
    const bind: any = { title: 'old', count: 3, hidden: 'keep' }   // hidden 不在 schema(宿主自管)
    const t = byName(createDataOps({ schema, bind, description: 'cfg' }))
    // G1:缺必填顶层 key → merge 语义放行 + 未出现字段保留(契约收窄)
    let r = await invoke(t['set_data'], { value: { title: 'new' } })
    assert(bind.title === 'new' && bind.count === 3 && bind.hidden === 'keep', '✓ 整体 set → 缺必填不再拒,未出现 key 保留(契约收窄 + 防误删)')
    // G2:出现的 key 坏值 → 拒
    r = await invoke(t['set_data'], { value: { count: 'x' } })
    assert(/SCHEMA_INVALID/.test(r) && bind.count === 3, '✓ 整体 set → 出现的 key 坏值仍拒')
    // G3:patches 后条修复前条 → 最终态合法即过(不做逐条即时校验)
    r = await invoke(t['write'], { patches: [
      { op: 'set', jsonPath: 'title', value: '中间态' },
      { op: 'set', jsonPath: 'count', value: '9' },
    ] })
    assert(bind.title === '中间态' && bind.count === 9, '✓ patches → 按最终态校验(后条修前条的合法模式保留)')
  }

  // ===== H. 原子语义不变 =====
  {
    const schema = z.object({ a: z.number(), b: z.number() })
    const bind: any = { a: 1, b: 2 }
    const t = byName(createDataOps({ schema, bind, description: 'atom' }))
    const r = await invoke(t['write'], { patches: [
      { op: 'set', jsonPath: 'a', value: '10' },
      { op: 'set', jsonPath: 'b', value: '"not a number"' },
    ] })
    assert(/SCHEMA_INVALID/.test(r) && bind.a === 1 && bind.b === 2, '✓ patches 原子性 → 单条目标坏整批回滚(局部化不变)')
  }

  // ===== I. 写回防原型污染(防线平移) =====
  {
    const schema = z.object({ cfg: z.object({ a: z.number() }), items: z.array(z.string()) }).passthrough()
    const bind: any = { cfg: { a: 1 }, items: ['x'] }
    const t = byName(createDataOps({ schema, bind, description: 'sec' })
    )
    await invoke(t['edit_data'], { op: 'merge', jsonPath: '', value: '{"__proto__":{"polluted":true},"b":2}' });
    assert(bind.b === 2, '✓ merge 防污染 → 正常键落地')
    assert(!Object.prototype.hasOwnProperty.call(bind, '__proto__'), '✓ merge 防污染 → 无 __proto__ own 键')
    assert(({} as any).polluted === undefined, '✓ merge 防污染 → Object.prototype 未被污染')
  }
}
