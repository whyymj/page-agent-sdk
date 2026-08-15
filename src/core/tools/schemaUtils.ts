/**
 * Schema 白名单投影纯函数 —— 从 dataOps.ts 抽离(refactor-module-extraction)。
 * 依赖 zod 类型(纯类型依赖,无运行时依赖)。护城河核心:按 schema 声明字段投影,隐藏未声明字段。
 *
 * 后续新函数归宿:expose-schema-constraints 的 describeSchemaNode(zod 约束结构化提取)
 * 落入本文件,复用 unwrapSchema。
 */
import { z } from 'zod'
import type { ZodType } from 'zod'

/**
 * 提取 schema 顶层声明的 key(作为可读写白名单)。
 * 仅 ZodObject(及其可选/默认值包装)可提取;非 ZodObject(联合/record/lazy)返回 null → 不启用白名单(全开放,向后兼容)。
 */
export function getSchemaTopKeys(schema: ZodType): string[] | null {
  let s: any = schema
  // 解包可选/默认值/捕获包装
  for (let i = 0; i < 5 && s && s._def; i++) {
    if (s._def.innerType) { s = s._def.innerType; continue }
    break
  }
  if (!s || !s.shape || typeof s.shape !== 'object') return null
  try {
    const shape = typeof s.shape === 'function' ? s.shape() : s.shape
    return Object.keys(shape)
  } catch {
    return null
  }
}

/** jsonPath 逐段是否都在 schema 声明字段内(白名单 null 表示全开放;支持嵌套对象/数组元素逐级校验,防子路径绕过顶层白名单) */
export function isPathAllowed(jsonPath: string, schema: ZodType | null, allowKeys: string[] | null): boolean {
  if (!allowKeys) return true  // 非 ZodObject schema,全开放(向后兼容)
  if (!jsonPath) return true   // 整体路径由调用方按 set-merge 语义处理
  let s: any = unwrapSchema(schema)
  for (const seg of jsonPath.split('.')) {
    if (seg.startsWith('__pg')) return false  // __pg* 框架内部字段(code-as-data-asset),agent 不可写;框架 afterWrite 直改 bindRef 绕此
    if (!s) return false
    s = unwrapSchema(s)
    if (s && s.shape && typeof s.shape === 'object') {
      const shape = typeof s.shape === 'function' ? s.shape() : s.shape
      if (!(seg in shape)) return false
      s = shape[seg]
    } else if (s && (s._def?.type === 'array' || s.constructor?.name === 'ZodArray')) {
      // ZodArray:严格判(_def.type === 'array' 字符串相等,防 discriminatedUnion 等被误判)
      // 修复(P1-20):seg 必须是非负整数索引(与 deleteByPath /^\d+$/ 一致),否则 PATH_DENIED ——
      // 防 components.-1.x 类负/非数字索引过白名单 → setByPath 挂非索引属性 → zod 数组校验忽略 → 静默成功零落地
      if (!/^\d+$/.test(seg)) return false
      s = s.element
    } else if (s && (s._def?.type === 'union' || s._def?.type === 'discriminatedUnion' || Array.isArray(s.options))) {
      // discriminatedUnion/ZodUnion:静态无 bind 不知具体 option,降级开放(后续段交 schema.safeParse 兜底校验)
      // 修复:旧 else if 用 `_def.type` 真值判断,但 _def.type 在所有 zod schema 都是字符串(如 'union'/'object'),
      // 导致 union 被误当 array,s 退化成字符串,后续深层路径(如 components.N.props.X)误返 PATH_DENIED
      return true
    } else {
      return false
    }
  }
  return true
}

/** 解包 zod 可选/默认值/捕获/懒加载包装,返回核心 schema */
export function unwrapSchema(schema: any): any {
  let s = schema
  for (let i = 0; i < 8 && s && s._def; i++) {
    if (s._def.innerType) { s = s._def.innerType; continue }
    if (s._def.schema) { s = s._def.schema; continue }      // ZodLazy(zod v4:_def.schema)
    if (s._def.getter) { s = s._def.getter(); continue }     // ZodLazy fallback:_def.getter()
    break
  }
  return s
}

/** 按 jsonPath 逐级定位子 schema(支持 ZodObject.shape / ZodArray.element;union 下探含该字段的 option;record/lazy 返回 null) */
export function getSchemaAtPath(schema: ZodType, jsonPath: string): ZodType | null {
  if (!jsonPath) return schema
  let s: any = unwrapSchema(schema)
  const segs = jsonPath.split('.')
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]
    if (!s) return null
    s = unwrapSchema(s)
    if (s && s.shape && typeof s.shape === 'object') {
      // ZodObject:取 shape[seg](seg 是字段名)
      const shape = typeof s.shape === 'function' ? s.shape() : s.shape
      s = shape[seg]
    } else if (s && (s._def?.type === 'array' || s.constructor?.name === 'ZodArray')) {
      // ZodArray:严格判(_def.type === 'array' 字符串相等);seg 须非负整数索引(同 isPathAllowed P1-20),否则返 null
      if (!/^\d+$/.test(seg)) return null
      s = s.element
    } else if (s && (s._def?.type === 'union' || s._def?.type === 'discriminatedUnion' || Array.isArray(s.options))) {
      // discriminatedUnion/ZodUnion:静态不知具体 option → 下探各 option 中声明了该字段者
      // (嵌套容器场景:components.N.children 在 card/waterfall/carousel option 内声明,button 无)。
      // 命中任一 option 即续走其分支(多 option 同名字段通常同构递归 children,取首个);
      // 全不命中(字段不存在于任何 option)→ 返 null(focus 校验据此拒绝,schema_data 降级到上层)。
      const rest = segs.slice(i).join('.')
      const hits = (s.options ?? [])
        .map((opt: any) => getSchemaAtPath(opt, rest))
        .filter((x: any) => x != null)
      return hits.length ? hits[0] : null
    } else {
      return null
    }
  }
  return s ?? null
}

/** zod schema 是否为 string 类型(解包 optional/lazy 后判 _def.type / constructor name) */
function isStringSchema(s: any): boolean {
  const u = unwrapSchema(s)
  return u?._def?.type === 'string' || u?.constructor?.name === 'ZodString'
}

/** 取数组元素 schema(非数组返 null) */
function getArrayElementSchema(s: any): any | null {
  const u = unwrapSchema(s)
  if (u?._def?.type === 'array' || u?.constructor?.name === 'ZodArray') return u.element ?? null
  return null
}

/** 数组元素 schema(object / union / discriminatedUnion 选项)是否含指定名字的 string 字段(codeField 参数化,默认 'code') */
function elementHasCodeField(elem: any, codeField = 'code'): boolean {
  const e = unwrapSchema(elem)
  if (!e) return false
  if (e.shape && typeof e.shape === 'object') {
    const shape = typeof e.shape === 'function' ? e.shape() : e.shape
    return codeField in shape && isStringSchema(shape[codeField])
  }
  // union / discriminatedUnion(zod4 _def.type='union' / .options):任一 option 含 code 即命中
  if (e._def?.type === 'union' || Array.isArray(e.options)) {
    return (e.options ?? []).some((opt: any) => elementHasCodeField(opt, codeField))
  }
  return false
}

/**
 * 静态扫描 schema 是否含名为 code 的 string 字段(顶层 或 数组元素对象内,含 union/discriminatedUnion 选项)。
 * createChatSdk 装配期判定「无 html 子 agent + schema 有 code 字段」→ 自动注入主 agent 自己写编排(htmlDirectWriteFallback)+ warn。
 * 精确 ZodObject / z.array(z.object) / discriminatedUnion 可识别;开放 schema(z.any()/z.record)扫不到 → 集成方 opt-in spread htmlDirectWriteFallback。
 * 误判后果轻(多注入一段降级提示),故宁宽松。
 */
export function schemaHasCodeField(schema: any): boolean {
  const top = unwrapSchema(schema)
  if (!top || !top.shape || typeof top.shape !== 'object') return false
  const shape = typeof top.shape === 'function' ? top.shape() : top.shape
  for (const k of Object.keys(shape)) {
    if (k === 'code' && isStringSchema(shape[k])) return true
    const elem = getArrayElementSchema(shape[k])
    if (elem && elementHasCodeField(elem)) return true
  }
  return false
}

/**
 * 推断「代码组件数组」的顶层 data 路径(writablePaths 装配期推断用):顶层 shape 中
 * z.array(elem) 且元素含 codeField string 字段(union/discriminatedUnion 任一 option 命中即可)→ 收集该 key。
 * 只扫顶层(schemaHasCodeField 同深度):嵌套容器(sections[].children[])不推断——猜错路径代价高于要求显式传参;
 * 开放 schema(z.any()/z.record)/ 点路径 codeField('props.html_code')静态扫不到 → 返 [](调用方 warn+throw 提示显式传)。
 */
export function inferWritablePaths(schema: any, codeField = 'code'): string[] {
  const top = unwrapSchema(schema)
  if (!top || !top.shape || typeof top.shape !== 'object') return []
  const shape = typeof top.shape === 'function' ? top.shape() : top.shape
  const out: string[] = []
  for (const k of Object.keys(shape)) {
    if (k.startsWith('__pg')) continue  // 框架内部标记字段不参与推断
    const elem = getArrayElementSchema(shape[k])
    if (elem && elementHasCodeField(elem, codeField)) out.push(k)
  }
  return out
}

/** 按 schema 投影对象(只保留 schema 声明字段,递归处理嵌套对象/数组元素;非 ZodObject 原样返回) */
export function projectBySchemaDeep(obj: unknown, schema: ZodType | null): unknown {
  if (obj == null || typeof obj !== 'object' || !schema) return obj
  const s = unwrapSchema(schema)
  if (!s || !s.shape) {
    // 非 ZodObject(如数组/联合/record):若是数组,递归投影元素
    if (Array.isArray(obj) && (s?._def?.type || s?.element)) {
      const elemSchema = s.element ?? s._def?.type
      return obj.map((o) => projectBySchemaDeep(o, elemSchema))
    }
    // union/discriminatedUnion 元素等无法按 shape 投影的普通对象:剥离 __pg*(框架内部标记)。
    // 真实 LLM 测得此处原样返回导致 read 泄漏 __pgId → agent 照抄进 write 触发 SCHEMA_STRIP(自纠多一轮);
    // 其余字段保持原样(union 降级语义不变,只挡框架内部字段)
    if (!Array.isArray(obj)) {
      const src = obj as Record<string, unknown>
      const keys = Object.keys(src)
      if (!keys.some((k) => k.startsWith('__pg'))) return obj
      const out: Record<string, unknown> = {}
      for (const k of keys) {
        if (!k.startsWith('__pg')) out[k] = src[k]
      }
      return out
    }
    return obj
  }
  const shape = typeof s.shape === 'function' ? s.shape() : s.shape
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(obj as Record<string, unknown>)) {
    if (k in shape && !k.startsWith('__pg')) {
      const childVal = (obj as Record<string, unknown>)[k]
      out[k] = projectBySchemaDeep(childVal, shape[k])
    }
  }
  return out
}

/** 按 schema 顶层 key 投影 bind(只保留白名单字段,其余隐藏) */
export function projectBySchema(obj: unknown, allowKeys: string[] | null): unknown {
  if (!allowKeys || obj == null || typeof obj !== 'object' || Array.isArray(obj)) return obj
  const set = new Set(allowKeys)
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(obj as Record<string, unknown>)) if (set.has(k)) out[k] = (obj as Record<string, unknown>)[k]
  return out
}

/**
 * Schema 约束结构化提取(expose-schema-constraints)—— 从 zod 4 `_def` / `check._zod.def` 提取字段约束,
 * 供 systemPrompt「可操作数据」段 + schema_data 工具两处消费(让 LLM 写前即知字段规则,减少试错轮次)。
 *
 * ⚠️ zod 4 内部结构与 zod 3 差异大:check 的真值在 `check._zod.def`(非 `_def.checks[i].kind`);
 * number 经 ZodNumberFormat 暴露 `minValue/maxValue/isInt/format` 便利 getter。
 * 本实现是 **zod 4.4+ adapter**(集中在本文件 readCheckDefs / describeSchemaNode 的 switch):
 *  - 未来 zod 5 / 别的 schema 库:新增 adapter 分支于此,`SchemaNodeDesc` 接口 + 两处消费零改动;
 *  - 结构探测失败(schema 无 `_zod`/`_def`)→ 返 `{type}` 无约束(降级不崩);dev 模式 console.warn(去重)提醒版本不兼容;
 *  - 不透传内部 `_def` 全量(稳定 + 抗版本)。
 */

/** 单个 schema 节点的结构化约束描述 */
export interface SchemaNodeDesc {
  type: string
  constraints?: {
    minLength?: number
    maxLength?: number
    length?: number
    min?: number
    max?: number
    int?: boolean
    format?: string | string[]
    values?: readonly (string | number)[]
    value?: unknown
    item?: SchemaNodeDesc
    shape?: Record<string, SchemaNodeDesc>
    anyOf?: SchemaNodeDesc[]
    valueType?: SchemaNodeDesc
  }
  optional?: boolean
  nullable?: boolean
  default?: unknown
  description?: string
}

/** dev 模式 zod 版本兼容提醒(去重,只 warn 一次/进程);生产静默 */
let __zodCompatWarned = false
function warnZodCompatOnce(): void {
  if (__zodCompatWarned) return
  __zodCompatWarned = true
  try {
    const dev = (import.meta as any)?.env?.DEV
    if (dev && typeof console !== 'undefined') {
      console.warn('[page-agent-sdk] describeSchemaNode: schema 无 _zod/_def 结构,约束提取降级为 type-only(zod 版本可能不兼容,需 zod 4.4+;adapter 扩展见 schemaUtils.ts)')
    }
  } catch { /* ignore */ }
}

/** 读取 zod 4 check 数组的 `_zod.def`(约束真值所在;zod 3 风格的 `.kind`/`.value` 已废弃) */
function readCheckDefs(schema: any): any[] {
  const cs = schema?._def?.checks
  if (!Array.isArray(cs)) return []
  const out: any[] = []
  for (const c of cs) if (c?._zod?.def) out.push(c._zod.def)
  return out
}

/** 是否为 number 的"无下限"哨兵值(zod 4 safeint 默认 minValue = Number.MIN_SAFE_INTEGER) */
function isUnboundedMin(v: any): boolean {
  return v === Number.MIN_SAFE_INTEGER || v === -Infinity
}
/** 是否为 number 的"无上限"哨兵值 */
function isUnboundedMax(v: any): boolean {
  return v === Number.MAX_SAFE_INTEGER || v === Infinity
}

/**
 * 结构化提取单个 zod 节点的约束。先解包 optional/default/nullable/catch/readonly/prefault/lazy/pipe 收集标记,
 * 再按核心类型(string/number/boolean/enum/literal/array/object/union/record)提取关键约束。
 */
export function describeSchemaNode(schemaRaw: any, visited: WeakSet<object> = new WeakSet(), depth = 0): SchemaNodeDesc {
  let optional = false
  let nullable = false
  let hasDefault = false
  let defaultValue: unknown
  let s: any = schemaRaw
  for (let i = 0; i < 8 && s && s._def; i++) {
    const t = s._def.type
    if (t === 'optional' || t === 'default' || t === 'nullable' || t === 'catch' || t === 'readonly' || t === 'prefault') {
      if (t === 'optional') optional = true
      else if (t === 'nullable') nullable = true
      else if (t === 'default' || t === 'prefault') { hasDefault = true; defaultValue = s._def.defaultValue }
      s = s._def.innerType
      continue
    }
    if (t === 'lazy') { s = s._def.getter ? s._def.getter() : s._def.schema; continue }
    if (t === 'pipe') { s = s._def.in ?? s._def.innerType; continue }
    break
  }
  const type = s?._def?.type || 'unknown'
  if (!s?._def) warnZodCompatOnce()  // 非 zod schema(无 _def):dev 提醒版本不兼容,生产静默;返 type-only 兜底
  // 深度 + 自引用双截断(防栈溢出):① depth>15 防任何深递归(z.lazy 每次 getter 可能 new 对象,visited 不命中)② visited 同引用循环(容器 children: z.array(PageComponent) 自引用)。查深层用 schema_data({jsonPath})
  if (depth > 15) return { type, description: '↩ 深度截断(>15,防栈溢出;查深层用 schema_data({jsonPath}))' } as SchemaNodeDesc
  if (s && typeof s === 'object' && visited.has(s)) return { type, description: '↩ 递归引用(容器 children 自引用,已截断防栈溢出)' } as SchemaNodeDesc
  if (s && typeof s === 'object') visited.add(s)
  const d: SchemaNodeDesc = { type }
  if (optional) d.optional = true
  if (nullable) d.nullable = true
  if (hasDefault) d.default = defaultValue
  if (s?.description) d.description = s.description

  const c: NonNullable<SchemaNodeDesc['constraints']> = {}
  switch (type) {
    case 'string': {
      if (s.minLength != null) c.minLength = s.minLength
      if (s.maxLength != null) c.maxLength = s.maxLength
      const fmts = readCheckDefs(s).filter((x) => x.check === 'string_format').map((x) => x.format).filter(Boolean)
      if (fmts.length) c.format = fmts.length === 1 ? fmts[0] : fmts
      break
    }
    case 'number': {
      if (s.minValue != null && !isUnboundedMin(s.minValue)) c.min = s.minValue
      if (s.maxValue != null && !isUnboundedMax(s.maxValue)) c.max = s.maxValue
      if (s.isInt) c.int = true
      if (s.format && s.format !== 'number') c.format = s.format
      break
    }
    case 'enum':
      c.values = s.options
      break
    case 'literal': {
      const vals = s._def?.values ?? (s._def?.value !== undefined ? [s._def.value] : [])
      c.value = vals.length === 1 ? vals[0] : vals
      break
    }
    case 'array': {
      c.item = describeSchemaNode(s.element, visited, depth + 1)
      for (const ck of readCheckDefs(s)) {
        if (ck.check === 'min_length') c.minLength = ck.minimum
        else if (ck.check === 'max_length') c.maxLength = ck.maximum
        else if (ck.check === 'length_equals') c.length = ck.length
      }
      break
    }
    case 'object': {
      const shape = typeof s.shape === 'function' ? s.shape() : s.shape
      c.shape = Object.fromEntries(Object.entries(shape || {}).map(([k, v]) => [k, describeSchemaNode(v, visited, depth + 1)]))
      break
    }
    case 'union': {
      const opts = (s._def?.options || []).map((o: any) => describeSchemaNode(o, visited, depth + 1))
      if (opts.length) c.anyOf = opts
      break
    }
    case 'record':
      if (s._def?.valueType) c.valueType = describeSchemaNode(s._def.valueType, visited, depth + 1)
      break
    default:
      break
  }
  if (Object.keys(c).length) d.constraints = c
  return d
}

/** 把标量约束格式化为括号内短串(shape/item/anyOf/valueType 不渲染,避免冗长;深入用 schema_data) */
export function formatConstraints(c: NonNullable<SchemaNodeDesc['constraints']>): string {
  const parts: string[] = []
  if (c.minLength !== undefined) parts.push(`minLen=${c.minLength}`)
  if (c.maxLength !== undefined) parts.push(`maxLen=${c.maxLength}`)
  if (c.length !== undefined) parts.push(`len=${c.length}`)
  if (c.min !== undefined) parts.push(`min=${c.min}`)
  if (c.max !== undefined) parts.push(`max=${c.max}`)
  if (c.int) parts.push('int')
  if (c.format) parts.push(`format=${Array.isArray(c.format) ? c.format.join('|') : c.format}`)
  if (c.values) parts.push(`enum=[${(c.values as readonly (string | number)[]).map((v) => String(v)).join('|')}]`)
  if (c.value !== undefined) parts.push(`=${JSON.stringify(c.value)}`)
  return parts.join(', ')
}

/** 渲染单行字段标注:`- key (Type?)[约束]: description`(供 read 概览 / systemPrompt) */
export function renderSchemaHint(key: string, desc: SchemaNodeDesc): string {
  const scalar = desc.constraints ? formatConstraints(desc.constraints) : ''
  const bracket = scalar ? `[${scalar}]` : ''
  const opt = desc.optional ? '?' : ''
  const tail = desc.description ? `: ${desc.description}` : ''
  return `- ${key} (${desc.type}${opt})${bracket}${tail}`
}

/** 渲染 schema 顶层字段约束总览(非 object / 空 shape fallback 到根节点描述);供 extractSchemaHint + read 概览复用 */
export function renderSchemaOverview(schemaRaw: any): string {
  if (!schemaRaw) return ''
  try {
    let s: any = schemaRaw
    for (let i = 0; i < 8 && s && s._def; i++) {
      if (s._def.innerType) { s = s._def.innerType; continue }
      if (s._def.getter) { s = s._def.getter(); continue }
      if (s._def.schema) { s = s._def.schema; continue }
      break
    }
    const shape = s?.shape ? (typeof s.shape === 'function' ? s.shape() : s.shape) : null
    if (shape && typeof shape === 'object' && Object.keys(shape).length) {
      return Object.entries(shape).map(([k, v]) => renderSchemaHint(k, describeSchemaNode(v))).join('\n')
    }
  } catch { /* ignore */ }
  try {
    return renderSchemaHint('(root)', describeSchemaNode(schemaRaw))
  } catch { /* ignore */ }
  return ''
}

/** 浅渲染单行:`- key (Type): description`(无约束,分层概览用;大 schema 不爆 token) */
function renderSchemaFieldShallow(key: string, schemaRaw: any): string {
  const desc = describeSchemaNode(schemaRaw)
  const tail = desc.description ? `: ${desc.description}` : ''
  return `- ${key} (${desc.type})${tail}`
}

/**
 * 渲染 schema 顶层字段浅概览(分层模式用):只 key + type + 一句描述,**不带**约束(min/max/enum)、**不递归** shape。
 * 供 extractSchemaHint 大 schema(>阈值)分层注入 systemPrompt,体积降一个数量级(深层约束交 schema_data 按需查)。
 */
/**
 * 给 schema 的 writablePaths 数组元素 extend `__pgId`(code-as-data-asset):让 __pgId 进 schema shape →
 * safeParse 不剥离(否则 zod strip 模式吞 __pgId)+ projectBySchemaDeep 见(__pg* 投影过滤单独挡)+ isPathAllowed 见白名单(__pg* 写单独拒)。
 * 集成商原 schema 不动(只框架内部用 extendedSchema)。支持顶层 writablePath(如 'components');element 为 ZodObject / discriminatedUnion / ZodUnion 均 extend(多类型组件平台);嵌套('a.b')或 element 非 object-union → fallback。
 * ⚠ 重建 array 丢失原 min/max/length 约束(组件数组通常无;有约束的场景后续增强)。纯函数,可单测。
 */
export function extendSchemaWithPgId(rootSchema: ZodType, writablePaths: string[]): { schema: ZodType; fallback: string[] } {
  const fallback: string[] = []
  const rootObj = unwrapSchema(rootSchema)
  if (!rootObj?.shape) return { schema: rootSchema, fallback: [...writablePaths] }  // 非 ZodObject,全 fallback(不 extend)
  const oldShape = typeof rootObj.shape === 'function' ? rootObj.shape() : rootObj.shape
  const newShape: Record<string, ZodType> = { ...oldShape }
  for (const wp of writablePaths) {
    if (wp.includes('.')) { fallback.push(wp); continue }      // 嵌套路径暂不支持(简化;createHtmlSubagent writablePaths 通常顶层)
    const arrSchema = newShape[wp]
    if (!arrSchema) { fallback.push(wp); continue }
    const arr = unwrapSchema(arrSchema)
    const elemObj = arr?.element ? unwrapSchema(arr.element) : null
    if (elemObj?.shape) {
      const newElem = (elemObj as any).extend({ __pgId: z.string().optional() })
      newShape[wp] = z.array(newElem)
    } else if (Array.isArray(elemObj?.options)) {
      // discriminatedUnion / ZodUnion:给每个 option extend __pgId,重建时保 discriminator,再包回 z.array。
      // 多类型组件平台(如 complex-demo)用 discriminatedUnion 表达 N 种组件类型;旧逻辑只认 elemObj.shape
      // (普通 ZodObject)→ 落 fallback 不 extend → __pgId 不进 schema → 整对象替换时 safeParse strip __pgId →
      // vfs 映射错位、代码孤儿化(html-page-demo 用普通 object 故未暴露)。
      // 注:zod 4 里 discriminatedUnion 的 _def.type 也是 'union',故用 _def.discriminator 区分(du 有、普通 union 无)。
      const newOptions = (elemObj as any).options.map((opt: any) => {
        const optObj = unwrapSchema(opt)
        return optObj?.shape ? optObj.extend({ __pgId: z.string().optional() }) : opt
      })
      const newElem = (elemObj as any)._def?.discriminator !== undefined
        ? z.discriminatedUnion((elemObj as any)._def.discriminator, newOptions)
        : z.union(newOptions)
      newShape[wp] = z.array(newElem)
    } else {
      fallback.push(wp)                                        // element 非 object/union(含非对象 option / record 等)
    }
  }
  return { schema: z.object(newShape as any), fallback }
}

export function renderSchemaShallow(schemaRaw: any): string {
  if (!schemaRaw) return ''
  try {
    let s: any = schemaRaw
    for (let i = 0; i < 8 && s && s._def; i++) {
      if (s._def.innerType) { s = s._def.innerType; continue }
      if (s._def.getter) { s = s._def.getter(); continue }
      if (s._def.schema) { s = s._def.schema; continue }
      break
    }
    const shape = s?.shape ? (typeof s.shape === 'function' ? s.shape() : s.shape) : null
    if (shape && typeof shape === 'object' && Object.keys(shape).length) {
      return Object.entries(shape).map(([k, v]) => renderSchemaFieldShallow(k, v)).join('\n')
    }
  } catch { /* ignore */ }
  return ''
}
