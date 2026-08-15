import type { TestCtx } from './_ctx'
import { z } from 'zod'
import {
  isUnsafePath, safeMerge, getByPath, setByPath, deleteByPath,
  deepClone, maybeParseValue, projectFields, limitDepth, safeStringify, hashValue, cyrb53,
  applyPatchToClone, applyPatchToLive, restoreLive, restoreInPlace, findStrippedKeys,
} from '../../tools/jsonUtils'
import { applyPatchesToBind } from '../../tools/dataOps'

/**
 * sec-30 —— jsonUtils 纯函数白盒单测(refactor-module-extraction 从 dataOps 抽离)。
 * 此前这些函数只能经工具调用间接黑盒测;抽出后直接白盒覆盖路径/克隆/序列化/投影/patch/还原 + 原型污染防护。
 */
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('[sec-30] jsonUtils 纯函数白盒单测')

  // deepClone:深拷贝独立
  const orig = { a: [1, 2], b: { c: 3 } }
  const cl = deepClone(orig)
  assert(cl !== orig && cl.a !== orig.a && cl.b !== orig.b, 'deepClone → 对象/数组/嵌套均深拷贝独立')
  assert(deepClone(undefined) === undefined, 'deepClone → undefined 原样返回')

  // getByPath
  assert(getByPath({ a: { b: 1 } }, 'a.b') === 1, 'getByPath → 嵌套取值')
  assert((getByPath({ a: 1 }, '') as any).a === 1, 'getByPath → 空路径返原对象')
  assert(getByPath({ a: 1 }, 'a.b') === undefined, 'getByPath → 中途 null/不存在返 undefined')
  assert(getByPath({}, '__proto__.x') === undefined, 'getByPath → 原型污染路径返 undefined')

  // setByPath
  const o: any = {}
  setByPath(o, 'a.b.c', 1)
  assert(o.a.b.c === 1, 'setByPath → 自动创建嵌套结构')
  setByPath({}, '__proto__.polluted', 123)
  assert(({} as any).polluted === undefined, 'setByPath → 原型污染路径不写入(防护生效)')

  // deleteByPath(对象属性 → delete;数组元素 → splice 避免稀疏数组,fix-dataops-write-correctness)
  const d: any = { a: { b: 1 } }
  assert(deleteByPath(d, 'a.b') === true, 'deleteByPath → 删除存在路径返 true')
  assert(d.a.b === undefined, 'deleteByPath → 已删除')
  assert(deleteByPath(d, 'a.b') === false, 'deleteByPath → 删除不存在路径返 false')
  assert(deleteByPath({}, '__proto__.x') === false, 'deleteByPath → 原型污染路径返 false')
  // 数组元素 → splice(length 递减、元素前移、无 empty 槽);原 delete 会留稀疏空位
  const arr: any[] = [{ id: 1 }, { id: 2 }, { id: 3 }]
  assert(deleteByPath(arr, '0') === true, 'deleteByPath → 数组元素删除返 true')
  assert(arr.length === 2 && arr[0].id === 2 && arr[1].id === 3, 'deleteByPath → 数组 splice:删 [0] 后 length 3→2、元素前移([1,2,3]→[2,3])')
  assert(0 in arr && 1 in arr && !(2 in arr), 'deleteByPath → 数组删除无稀疏空位(索引连续,无 empty 槽)')
  // applyPatchToClone/Live remove 数组分支(edit/eval patches remove 两入口汇聚于此)
  const cArr: any = { items: [1, 2, 3] }
  assert(applyPatchToClone(cArr, 'remove', 'items.1') === null, 'applyPatchToClone(remove 数组) → 成功返 null')
  assert(cArr.items.length === 2 && cArr.items[0] === 1 && cArr.items[1] === 3, 'applyPatchToClone(remove 数组) → splice 删中间项、前移')
  const liveArrDel: any = { items: [1, 2, 3] }
  applyPatchToLive(liveArrDel, 'remove', 'items.0', undefined)
  assert(liveArrDel.items.length === 2 && liveArrDel.items[0] === 2, 'applyPatchToLive(remove 数组) → splice 删首项、前移')
  // 对象属性删除仍走 delete(语义不变)
  const obj: any = { x: 1, y: 2 }
  deleteByPath(obj, 'x')
  assert(!('x' in obj) && obj.y === 2, 'deleteByPath → 对象属性 delete 语义不变(x 删除,y 保留)')

  // maybeParseValue
  assert((maybeParseValue('{"a":1}').parsed as any)?.a === 1, 'maybeParseValue → JSON 对象字符串解析')
  assert(maybeParseValue('5').parsed === 5, 'maybeParseValue → 裸数字字面量解析')
  assert(maybeParseValue('abc').parsed === 'abc', 'maybeParseValue → 非法裸字面量当原字符串')
  assert(maybeParseValue('{"a"').parseError !== undefined, 'maybeParseValue → 非法 JSON(以 { 开头)报 parseError')
  assert(maybeParseValue(5).parsed === 5, 'maybeParseValue → 非字符串原样返回')

  // projectFields
  assert(Object.keys(projectFields({ a: 1, b: 2, c: 3 }, ['a', 'c']) as any).sort().join(',') === 'a,c', 'projectFields → 只保留指定字段')
  const arrProj = projectFields([{ a: 1, b: 2 }, { a: 3, b: 4 }], ['a']) as any[]
  assert(arrProj.length === 2 && arrProj[0].a === 1 && arrProj[0].b === undefined, 'projectFields → 数组元素递归投影')

  // limitDepth
  const ld = limitDepth({ a: { b: { c: 1 } } }, 1) as any
  assert(ld.a === '{...}', 'limitDepth → depth=1 截断深层为 {...} 占位')
  assert(limitDepth([1, 2], 0) === '[...2]', 'limitDepth → depth=0 数组占位 [...n]')

  // safeStringify
  assert(safeStringify({ a: 1 }) === '{"a":1}', 'safeStringify → 基本序列化(indent 0)')
  assert(safeStringify('x'.repeat(20), 10).includes('已截断'), 'safeStringify → maxLen 截断')
  assert(safeStringify({ fn: () => 1 }).includes('Function'), 'safeStringify → 函数占位 [Function]')
  const cyc: any = {}
  cyc.self = cyc
  assert(safeStringify(cyc).includes('Circular'), 'safeStringify → 循环引用占位 [Circular]')

  // hashValue(底层 cyrb53,harden-optimistic-lock 升级 53-bit 降碰撞)
  assert(hashValue({ a: 1 }) === hashValue({ a: 1 }), 'hashValue → 相同值同 hash')
  assert(hashValue({ a: 1 }) !== hashValue({ a: 2 }), 'hashValue → 不同值不同 hash')
  assert(typeof hashValue({ a: 1 }) === 'string', 'hashValue → 返回 base36 字符串')
  // cyrb53:53-bit 非加密 hash(确定性 + 雪崩)
  assert(cyrb53('x') === cyrb53('x'), 'cyrb53 → 确定性(相同输入同输出)')
  assert(cyrb53('a') !== cyrb53('b'), 'cyrb53 → 不同输入不同输出(雪崩)')
  assert(cyrb53('') !== cyrb53('a'), 'cyrb53 → 空串 vs 非空串不同')
  assert(hashValue({ a: 1 }) !== hashValue({ a: 2, b: 1 }), 'hashValue → 碰撞抽样({a:1} vs {a:2,b:1} 不同)')

  // isUnsafePath / safeMerge
  assert(isUnsafePath('__proto__.x') === true, 'isUnsafePath → 检测 __proto__')
  assert(isUnsafePath('constructor.prototype') === true, 'isUnsafePath → 检测 constructor/prototype')
  assert(isUnsafePath('a.b.c') === false, 'isUnsafePath → 正常路径 false')
  const tgt: any = { a: 1 }
  safeMerge(tgt, JSON.parse('{"b":2,"__proto__":{"x":1}}'))
  assert(tgt.b === 2, 'safeMerge → 合法字段合并')
  assert(({} as any).x === undefined, 'safeMerge → __proto__ 原型污染键跳过(未污染原型)')

  // applyPatchToClone(四 op + 错误分支)
  const c1: any = { a: { b: 1 } }
  assert(applyPatchToClone(c1, 'set', 'a.b', 2) === null, 'applyPatchToClone(set) → 成功返 null')
  assert(c1.a.b === 2, 'applyPatchToClone(set) → 值已设')
  assert(applyPatchToClone({}, 'set', '', 1) === 'set 操作需要 jsonPath(整体替换请用 set_data)', 'applyPatchToClone(set 无 path) → 错误提示')
  const c2: any = { a: 1 }
  assert(applyPatchToClone(c2, 'remove', 'a') === null, 'applyPatchToClone(remove) → 成功')
  assert(c2.a === undefined, 'applyPatchToClone(remove) → 已删除')
  // remove 路径不存在(含数组索引越界)→ 显式报错(真 LLM 实测:remove components.8 越界静默 no-op,同批其他 op 生效整体报成功 → agent 以为删掉了)
  const missObj = { items: [1, 2] }
  const missErr = applyPatchToClone(missObj, 'remove', 'items.5')
  assert(missErr !== null && missErr.includes('remove 路径不存在'), 'applyPatchToClone(remove 越界索引) → 显式报错(不静默 no-op)')
  assert(missObj.items.length === 2, 'applyPatchToClone(remove 越界) → 原数据未动')
  assert(applyPatchToClone(missObj, 'remove', 'nope') !== null, 'applyPatchToClone(remove 不存在字段) → 显式报错')

  // findStrippedKeys 数组位移误伤(评审 CRITICAL 复现):move/remove 使携带 __pgNotes 的元素换位,
  // 按位置比较会误判「新增被剥离」→ 合法调序/删除被 SCHEMA_STRIP 拒,且 __pg* read 不可见 agent 无法自纠
  const mvBind = [
    { type: 'button', label: 'a' },
    { type: 'custom', name: 'x', code: '<p>1</p>', __pgId: 'c_1', __pgNotes: ['note1'] },
  ]
  const mvAfter = JSON.parse(JSON.stringify(mvBind)) // move components.1 → components.0 后的形态
  const moved = mvAfter.splice(1, 1)[0]
  mvAfter.splice(0, 0, moved)
  const mvParsed = [ // safeParse(strip) 结果:__pgId/__pgNotes 均不在 schema
    { type: 'custom', name: 'x', code: '<p>1</p>' },
    { type: 'button', label: 'a' },
  ]
  assert(findStrippedKeys(mvBind, mvAfter, mvParsed).length === 0, '✓ findStrippedKeys → move 位移后原样元素携带 __pg* 不误判(整体跳过)')
  // 元素被改动(含 __pg* 键)也不误判:原地 set 不位移,位置对齐 + __pg* 跳过双保险
  const modAfter = JSON.parse(JSON.stringify(mvBind))
  modAfter[1] = { ...modAfter[1], code: '<p>2</p>' }
  const modParsed = [
    { type: 'button', label: 'a' },
    { type: 'custom', name: 'x', code: '<p>2</p>' },
  ]
  assert(findStrippedKeys(mvBind, modAfter, modParsed).length === 0, '✓ findStrippedKeys → 改动元素携带 __pg* 不误判(__pg* 恒跳过)')
  // 真·新增未声明键仍要抓(修复不得放松本职)
  assert(
    findStrippedKeys([{ type: 'button', label: 'a' }], [{ type: 'button', label: 'a', style: { border: '1px' } }], [{ type: 'button', label: 'a' }])[0] === '0.style',
    '✓ findStrippedKeys → 新增被剥离键仍按数组路径标记(0.style)',
  )
  const c3: any = { a: { b: 1 } }
  applyPatchToClone(c3, 'merge', 'a', { c: 2 })
  assert(c3.a.c === 2 && c3.a.b === 1, 'applyPatchToClone(merge) → 合并而非替换')
  assert(applyPatchToClone({ a: 1 }, 'merge', 'a', {}) === 'merge 目标(a)不是对象', 'applyPatchToClone(merge 非对象) → 错误')
  const c4: any = { arr: [1] }
  applyPatchToClone(c4, 'append', 'arr', 2)
  assert(c4.arr.length === 2 && c4.arr[1] === 2, 'applyPatchToClone(append) → 追加单值')
  const c5: any = { arr: [1] }
  applyPatchToClone(c5, 'append', 'arr', [2, 3])
  assert(c5.arr.length === 3, 'applyPatchToClone(append 数组) → 展开追加')

  // applyPatchToLive(就地写 bind)
  const live: any = { a: { b: 1 } }
  applyPatchToLive(live, 'set', 'a.b', 9)
  assert(live.a.b === 9, 'applyPatchToLive(set) → 就地写子属性')

  // restoreInPlace / restoreLive(就地还原,保留容器引用)
  const r: any = { a: 1, b: 2 }
  restoreInPlace(r, { a: 10, c: 3 })
  assert(r.a === 10 && r.c === 3 && r.b === undefined, 'restoreInPlace → 对象就地还原(删旧加新)')
  const rArr: any[] = [1, 2, 3]
  restoreInPlace(rArr, [9, 8])
  assert(rArr.length === 2 && rArr[0] === 9 && rArr[1] === 8, 'restoreInPlace → 数组就地还原(保留容器)')
  const live2: any = { a: 1 }
  restoreLive(live2, { b: 2 })
  assert(live2.b === 2 && live2.a === undefined, 'restoreLive → 对象 bind 就地还原')
  const liveArr: any[] = [1, 2]
  restoreLive(liveArr, [7])
  assert(liveArr.length === 1 && liveArr[0] === 7, 'restoreLive → 数组 bind 就地还原')

  // applyPatchesToBind(P0-1 写回 schema 解析值,fix-write-safety-bypass)
  // 演进:fix-write-safety-bypass 用「写回 res.data」静默 strip 未声明键;fix-silent-strip 升级为**显式拒绝**
  // (新增未声明键被 strip = 假成功,agent 以为写进实际没落 → SCHEMA_STRIP 报错,agent 据此告知用户「不支持该字段」)
  const schemaP01 = z.object({ page: z.object({ title: z.string() }) })
  // ① set 声明路径值含未声明嵌套键 → 显式拒绝(fix-silent-strip 新契约)
  const bindP01: any = { page: { title: 'old' } }
  const r1 = applyPatchesToBind({
    bindRef: bindP01, schema: schemaP01, allowKeys: ['page'],
    patches: [{ op: 'set', jsonPath: 'page', value: { title: 'new', secret: 'X' } }],
    snapshots: [], maxSnapshots: 20,
  })
  assert(r1.ok === false && (r1 as any).error.includes('SCHEMA_STRIP'), 'applyPatchesToBind(fix-silent-strip) → ✅ 未声明嵌套键 secret 显式拒绝(SCHEMA_STRIP,不再假成功)')
  assert(bindP01.page.title === 'old', 'applyPatchesToBind(fix-silent-strip) → 拒绝时整体不写(title 保持原值)')
  assert((bindP01.page as any).secret === undefined, 'applyPatchesToBind(fix-silent-strip) → 未声明键 secret 不落 bind(P0-1 防线保留)')
  // ② __proto__ own 键注入(值内嵌,绕过 isUnsafePath 只查 path)→ 同样显式拒绝 + 不注入 bind
  const bindProto: any = { page: { title: 'a' } }
  const r2 = applyPatchesToBind({
    bindRef: bindProto, schema: schemaP01, allowKeys: ['page'],
    patches: [{ op: 'set', jsonPath: 'page', value: JSON.parse('{"title":"b","__proto__":{"polluted":1}}') }],
    snapshots: [], maxSnapshots: 20,
  })
  assert(r2.ok === false && (r2 as any).error.includes('SCHEMA_STRIP'), 'applyPatchesToBind(fix-silent-strip) → ✅ __proto__ own 键场景显式拒绝')
  assert(Object.keys(bindProto.page as any).includes('__proto__') === false, 'applyPatchesToBind(fix-silent-strip) → ✅ __proto__ own 键不注入 bind(无原型污染)')
  // ③ before 已有的未声明键(宿主自管字段)→ 不标不拒(safeMerge 浅合并保留顶层原值,不误伤宿主数据)
  const bindHost: any = { page: { title: 'old' }, hostOnly: 'keep' }
  const r3 = applyPatchesToBind({
    bindRef: bindHost, schema: schemaP01, allowKeys: ['page'],
    patches: [{ op: 'set', jsonPath: 'page.title', value: 'new' }],
    snapshots: [], maxSnapshots: 20,
  })
  assert(r3.ok === true, 'applyPatchesToBind(fix-silent-strip) → 宿主自管未声明键不触发拒绝(只拦本次新增被剥离的键)')
  assert(bindHost.page.title === 'new' && bindHost.hostOnly === 'keep', 'applyPatchesToBind(fix-silent-strip) → 声明字段写入 + 顶层宿主字段保留')

  // findStrippedKeys 纯函数白盒(fix-silent-strip 检测核心)
  assert(
    JSON.stringify(findStrippedKeys({ a: { x: 1 } }, { a: { x: 1, y: 2 } }, { a: { x: 1 } })) === JSON.stringify(['a.y']),
    'findStrippedKeys → 新增被剥离键收集为路径',
  )
  assert(
    findStrippedKeys({ a: { x: 1, y: 9 } }, { a: { x: 1, y: 2 } }, { a: { x: 1 } }).length === 0,
    'findStrippedKeys → before 已有键不标(宿主自管)',
  )
  assert(
    findStrippedKeys({}, { list: [{ a: 1, b: 2 }] }, { list: [{ a: 1 }] })[0] === 'list.0.b',
    'findStrippedKeys → 数组元素内剥离键定位到下标路径',
  )

  // discriminatedUnion 降级开放场景(实测 bug:page-demo button 加 style 边框「假成功」)
  const schemaDu = z.object({
    components: z.array(z.discriminatedUnion('type', [
      z.object({ type: z.literal('button'), label: z.string(), variant: z.enum(['primary', 'secondary']).optional() }),
    ])),
  })
  const bindDu: any = { components: [{ type: 'button', label: '次要按钮', variant: 'secondary' }] }
  const rDu = applyPatchesToBind({
    bindRef: bindDu, schema: schemaDu, allowKeys: ['components'],
    patches: [{ op: 'merge', jsonPath: 'components.0', value: { style: { border: '1px solid #ccc' } } }],
    snapshots: [], maxSnapshots: 20,
  })
  assert(rDu.ok === false && (rDu as any).error.includes('SCHEMA_STRIP') && (rDu as any).error.includes('components.0.style'),
    'applyPatchesToBind(fix-silent-strip) → ✅ discriminatedUnion 降级开放 + 未声明 style 显式拒绝(报错含完整路径,agent 可告知用户不支持)')
  assert((bindDu.components[0] as any).style === undefined, 'applyPatchesToBind(fix-silent-strip) → style 不落 bind')
  // ③ remove allowKeys 顶层字段 → 正常删除(方案 B2:remove 先 deleteByPath,safeMerge 浅合并不复活)
  const bindRm: any = { page: { title: 'x' }, extra: 1 }
  const schemaRm = z.object({ page: z.object({ title: z.string() }).optional(), extra: z.number().optional() })
  applyPatchesToBind({
    bindRef: bindRm, schema: schemaRm, allowKeys: ['page', 'extra'],
    patches: [{ op: 'remove', jsonPath: 'extra' }],
    snapshots: [], maxSnapshots: 20,
  })
  assert(bindRm.extra === undefined && bindRm.page.title === 'x', 'applyPatchesToBind(P0-1) → remove allowKeys 顶层字段正确删除(B2:remove 先删,safeMerge 不复活)')
  // ④ append 多次(方案 B2:res.data 最终态整体写回,append 净效果体现,与逐 path 提取不同)
  const bindAp: any = { list: [1] }
  const schemaAp = z.object({ list: z.array(z.number()) })
  applyPatchesToBind({
    bindRef: bindAp, schema: schemaAp, allowKeys: ['list'],
    patches: [{ op: 'append', jsonPath: 'list', value: 2 }, { op: 'append', jsonPath: 'list', value: 3 }],
    snapshots: [], maxSnapshots: 20,
  })
  assert(bindAp.list.length === 3 && bindAp.list[0] === 1 && bindAp.list[2] === 3, 'applyPatchesToBind(P0-1) → append 多次 res.data 最终态写回正确([1,2,3])')
}
