import type { TestCtx } from './_ctx'
import { z } from 'zod'
import {
  getSchemaTopKeys, isPathAllowed, unwrapSchema, getSchemaAtPath, projectBySchemaDeep, projectBySchema,
  describeSchemaNode, renderSchemaHint, renderSchemaOverview,
} from '../../tools/schemaUtils'
import { buildSystemPrompt, buildDataPrompt, DEFAULT_SYSTEM_PROMPT } from '../../sdk/promptBuilder'
import { systemPromptHelpers, extractSchemaHint, htmlOrchestratorPrompt } from '../../presets'
import { createDataOps } from '../../tools/dataOps'

/**
 * sec-31 —— schemaUtils 纯函数 + promptBuilder 白盒单测(refactor-module-extraction 从 dataOps/createChatSdk 抽离)。
 * schemaUtils:白名单投影护城河;promptBuilder:systemPrompt 统一入口(后续 fix-introspection 的 getEffectiveSystemPrompt 复用)。
 */
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, byName, invoke } = ctx
  console.log('[sec-31] schemaUtils 纯函数 + promptBuilder 白盒单测')

  const schema = z.object({
    name: z.string(),
    age: z.number(),
    tags: z.array(z.string()),
  })

  // getSchemaTopKeys
  const keys = getSchemaTopKeys(schema)
  assert(keys !== null && keys!.sort().join(',') === 'age,name,tags', 'getSchemaTopKeys → 提取 ZodObject 顶层 key')
  assert(getSchemaTopKeys(z.union([z.string(), z.number()])) === null, 'getSchemaTopKeys → 非 ZodObject(联合)返 null(全开放)')

  // isPathAllowed
  assert(isPathAllowed('name', schema, keys) === true, 'isPathAllowed → 声明字段允许')
  assert(isPathAllowed('secret', schema, keys) === false, 'isPathAllowed → 未声明字段拒绝')
  assert(isPathAllowed('tags.0', schema, keys) === true, 'isPathAllowed → 数组索引逐级允许')
  assert(isPathAllowed('tags.0.name', schema, keys) === false, 'isPathAllowed → string 元素无 name 子字段(修后严格:旧 bug 把 string 误当 array 放行)')

  // discriminatedUnion 深层路径(修 isPathAllowed 把 union 误当 array 的 pre-existing bug;complex-demo 真测发现)
  const unionSchema = z.object({
    components: z.array(z.discriminatedUnion('type', [
      z.object({ type: z.literal('card'), props: z.object({ title: z.string() }) }),
      z.object({ type: z.literal('image'), props: z.object({ src: z.string() }) }),
    ])),
  })
  const uKeys = getSchemaTopKeys(unionSchema)
  assert(uKeys !== null && uKeys[0] === 'components', 'getSchemaTopKeys → union 数组顶层 key')
  assert(isPathAllowed('components', unionSchema, uKeys) === true, 'isPathAllowed → components 顶层')
  assert(isPathAllowed('components.0', unionSchema, uKeys) === true, 'isPathAllowed → 数组元素(索引)')
  assert(isPathAllowed('components.0.type', unionSchema, uKeys) === true, 'isPathAllowed → union discriminator 降级放行')
  assert(isPathAllowed('components.0.props.title', unionSchema, uKeys) === true, 'isPathAllowed → union 深层 props 放行(修 bug:旧逻辑误 PATH_DENIED)')
  assert(isPathAllowed('components.0.props.unknown', unionSchema, uKeys) === true, 'isPathAllowed → union 降级后深层不再静态校验(交 safeParse 兜底)')
  // getSchemaAtPath 对 union 下探(fix-silent-strip 配套:嵌套容器 children 可聚焦):
  // option 内声明的字段可解析(取首个命中 option);任何 option 都没有的字段 → null
  assert(getSchemaAtPath(unionSchema, 'components.0.props.title') !== null, 'getSchemaAtPath → union 深层下探命中(嵌套容器聚焦可用)')
  assert(getSchemaAtPath(unionSchema, 'components.0.props.unknown') === null, 'getSchemaAtPath → union 深层任何 option 都无该字段 → null(降级)')
  assert(getSchemaAtPath(unionSchema, 'components.0') !== null, 'getSchemaAtPath → 数组元素(union)非 null(schema_data 查 anyOf)')
  assert(isPathAllowed('', schema, keys) === true, 'isPathAllowed → 空路径允许(整体由调用方处理)')
  assert(isPathAllowed('name', schema, null) === true, 'isPathAllowed → allowKeys null 全开放(向后兼容)')

  // P1-20(audit-sdk-integrity):ZodArray 段必须非负整数索引(与 deleteByPath /^\d+$/ 一致)——
  // 防 components.-1.x 类负/非数字索引过白名单 → setByPath 挂非索引属性 → zod 数组校验忽略 → 静默成功零落地
  assert(isPathAllowed('tags.-1', schema, keys) === false, 'P1-20 isPathAllowed → 数组负索引拒绝(防静默零落地写)')
  assert(isPathAllowed('tags.abc', schema, keys) === false, 'P1-20 isPathAllowed → 数组非数字索引拒绝')
  assert(isPathAllowed('tags.0', schema, keys) === true, 'P1-20 isPathAllowed → 合法数字索引仍放行(无回归)')
  assert(isPathAllowed('components.-1.type', unionSchema, uKeys) === false, 'P1-20 isPathAllowed → union 数组负索引拒绝')
  assert(getSchemaAtPath(schema, 'tags.-1') === null, 'P1-20 getSchemaAtPath → 数组负索引返 null')
  assert(getSchemaAtPath(schema, 'tags.abc') === null, 'P1-20 getSchemaAtPath → 数组非数字索引返 null')
  assert(getSchemaAtPath(schema, 'tags.0') !== null, 'P1-20 getSchemaAtPath → 合法数字索引仍返元素 schema(无回归)')

  // getSchemaAtPath
  assert(getSchemaAtPath(schema, 'name') !== null, 'getSchemaAtPath → 字段子 schema 非 null')
  assert(getSchemaAtPath(schema, 'tags') !== null, 'getSchemaAtPath → 数组子 schema 非 null')
  assert(getSchemaAtPath(schema, 'secret') === null, 'getSchemaAtPath → 不存在路径返 null')

  // getSchemaAtPath 开放 schema(record/any/unknown):编辑器类集成(页面树 z.record)focus/schema_data 可用
  // (修前 record/any/unknown 恒返 null → validateFocusInput 恒拒 → 开放 schema 集成无法使用 Focus)
  const recSchema = z.record(z.string(), z.unknown())
  assert(getSchemaAtPath(recSchema, 'child.0.props') !== null, '✓ getSchemaAtPath → record 开放 schema 任意路径非 null(开放=任意段合法)')
  const recObj = z.record(z.string(), z.object({ title: z.string() }))
  assert(getSchemaAtPath(recObj, 'x.title') !== null, '✓ getSchemaAtPath → record(object valueType)下探 shape 命中')
  assert(getSchemaAtPath(recObj, 'x.nope') === null, '✓ getSchemaAtPath → record(object valueType)未声明字段仍 null(valueType 非开放则不放宽)')
  assert(getSchemaAtPath(z.object({ data: z.any() }), 'data.a.b.c') !== null, '✓ getSchemaAtPath → any 子树任意深度开放')
  assert(getSchemaAtPath(z.object({ data: z.unknown() }), 'data.a') !== null, '✓ getSchemaAtPath → unknown 子树开放')
  assert(getSchemaAtPath(z.record(z.string(), z.array(z.object({ id: z.string() }))), 'child.0.id') !== null, '✓ getSchemaAtPath → record(array·object 嵌套 valueType)深层命中')

  // projectBySchemaDeep(按 schema 递归投影)
  const proj = projectBySchemaDeep({ name: 'x', age: 1, secret: 'hidden' }, schema) as any
  assert(proj.name === 'x' && proj.age === 1 && proj.secret === undefined, 'projectBySchemaDeep → 按 schema 投影隐藏未声明字段')
  const projArr = projectBySchemaDeep(
    [{ name: 'a', secret: 'x' }],
    z.array(z.object({ name: z.string() })),
  ) as any[]
  assert(projArr[0].name === 'a' && projArr[0].secret === undefined, 'projectBySchemaDeep → 数组元素递归投影')
  // union 元素投影剥离 __pg*(真 LLM 实测:union 走非 shape 分支原样返回 → read 泄漏 __pgId → agent 照抄进 write 触发 SCHEMA_STRIP)
  const pgProj = projectBySchemaDeep(
    [{ type: 'card', title: 'a', __pgId: 'c_x', __pgNotes: ['n'] }, { type: 'button', label: 'b', __pgId: 'c_y' }],
    z.array(z.discriminatedUnion('type', [
      z.object({ type: z.literal('card'), title: z.string() }),
      z.object({ type: z.literal('button'), label: z.string() }),
    ])),
  ) as any[]
  assert(pgProj[0].__pgId === undefined && pgProj[0].__pgNotes === undefined && pgProj[0].title === 'a', '✓ projectBySchemaDeep → union 元素剥离 __pg*(read 不泄漏框架内部标记)')
  assert(pgProj[1].label === 'b' && pgProj[1].__pgId === undefined, '✓ projectBySchemaDeep → union 各 option 元素统一剥 __pg*')
  const noPgObj = { type: 'card', title: 'a' }
  assert(projectBySchemaDeep(noPgObj, z.discriminatedUnion('type', [z.object({ type: z.literal('card'), title: z.string() })])) === noPgObj, '✓ projectBySchemaDeep → union 无 __pg* 字段时原对象返回(零拷贝)')

  // projectBySchema(顶层 key 投影)
  const ps = projectBySchema({ name: 'x', age: 1, extra: 2 }, keys) as any
  assert(ps.name === 'x' && ps.age === 1 && ps.extra === undefined, 'projectBySchema → 顶层白名单投影隐藏额外字段')
  assert((projectBySchema({ a: 1 }, null) as any).a === 1, 'projectBySchema → allowKeys null 原样返回')

  // unwrapSchema
  const unwrapped = unwrapSchema(z.object({ a: z.string() }).optional())
  assert(unwrapped && unwrapped.shape && 'a' in unwrapped.shape, 'unwrapSchema → 解包 optional 到 ZodObject')

  // === promptBuilder ===
  assert(typeof DEFAULT_SYSTEM_PROMPT === 'string' && DEFAULT_SYSTEM_PROMPT.length > 0, 'DEFAULT_SYSTEM_PROMPT → 非空字符串')
  assert(DEFAULT_SYSTEM_PROMPT.includes('JSON 操作助手'), 'DEFAULT_SYSTEM_PROMPT → 含身份说明')
  assert(DEFAULT_SYSTEM_PROMPT.includes('---'), 'DEFAULT_SYSTEM_PROMPT → 含分隔线(区分身份段与规则段)')

  // buildSystemPrompt 三分支
  assert(buildSystemPrompt({}) === DEFAULT_SYSTEM_PROMPT, 'buildSystemPrompt → 不传 systemPrompt 用默认(已内置规则)')
  assert(
    buildSystemPrompt({ systemPrompt: 'X' }) === 'X\n\n---\n\n' + systemPromptHelpers.reliableWriteRules,
    'buildSystemPrompt → 自定义 systemPrompt 默认追加 reliableWriteRules(--- 分隔)',
  )
  assert(
    buildSystemPrompt({ systemPrompt: 'X', appendReliableWriteRules: false }) === 'X',
    'buildSystemPrompt → appendReliableWriteRules:false 不追加',
  )

  // === htmlPageOrchestrator / htmlPageProposeFirst 片段(add-html-orchestrator-prompt) ===
  assert(
    systemPromptHelpers.htmlPageOrchestrator.includes('use_html') &&
      systemPromptHelpers.htmlPageOrchestrator.includes('职责边界') &&
      systemPromptHelpers.htmlPageOrchestrator.includes('多组件委派') &&
      // 并行委派引导(parallel-subagent-delegation 第一批):不同组件可同轮并行 / 同组件单一在途
      systemPromptHelpers.htmlPageOrchestrator.includes('并行发多个 use_html') &&
      systemPromptHelpers.htmlPageOrchestrator.includes('同一组件同一时间只能有一个委派在途'),
    '✓ htmlPageOrchestrator → 非空且含关键编排规则(职责边界 / use_html / 多组件委派 + 并行引导)',
  )
  assert(
    systemPromptHelpers.htmlPageProposeFirst.includes('2~3 套') &&
      systemPromptHelpers.htmlPageProposeFirst.includes('方案切换') &&
      systemPromptHelpers.htmlPageProposeFirst !== systemPromptHelpers.htmlPageOrchestrator,
    '✓ htmlPageProposeFirst → 独立片段(先出方案 + 方案切换),不与 orchestrator 混装',
  )
  assert(
    buildSystemPrompt({ systemPrompt: '你是页面搭建助手。\n' + systemPromptHelpers.htmlPageOrchestrator }).includes('职责边界'),
    '✓ htmlPageOrchestrator → 可安全拼进自定义 systemPrompt(经 buildSystemPrompt 不破坏)',
  )

  // === html-subagent-open-schema:同源化(htmlOrchestratorPrompt 函数 + 静态快照)+ htmlDirectWriteFallback 降级片段 ===
  assert(
    htmlOrchestratorPrompt('html') === systemPromptHelpers.htmlPageOrchestrator,
    '✓ 同源化:htmlOrchestratorPrompt("html") === htmlPageOrchestrator 静态快照(单一数据源,防两套文案漂移)',
  )
  assert(
    htmlOrchestratorPrompt('hero').includes('use_hero') && !htmlOrchestratorPrompt('hero').includes('use_html') &&
      htmlOrchestratorPrompt('hero').includes('职责边界'),
    '✓ 自定义 id:htmlOrchestratorPrompt("hero") 含 use_hero(动态工具名),不含 use_html,编排内容一致(自定义 id 不误导)',
  )
  {
    // 新建组件所有权契约(真 LLM 实测:主 agent 把子 agent 返回的 code 又 append 一遍 → 索引 8/9 重复组件)
    const op = htmlOrchestratorPrompt('html')
    assert(op.includes('新建组件由子 agent 全权创建'), '✓ 编排:新建组件所有权归子 agent(主不替它创建/追加)')
    assert(op.includes('委派返回即已落地') && op.includes('不要再 write/append 一遍'), '✓ 编排:委派返回即已落地,主 agent 禁重复 write(防重复组件)')
  }
  assert(
    typeof systemPromptHelpers.htmlDirectWriteFallback === 'string' &&
      systemPromptHelpers.htmlDirectWriteFallback.includes('直接 write') &&
      systemPromptHelpers.htmlDirectWriteFallback.includes('无 vfs') &&
      systemPromptHelpers.htmlDirectWriteFallback !== systemPromptHelpers.htmlPageOrchestrator,
    '✓ htmlDirectWriteFallback → 降级编排片段(主 agent 自己写 code,无 vfs/verify),独立于委派编排',
  )

  // === thinking-taming ①:委派 task 规格化(htmlOrchestratorPrompt 含规格条,收窄子 agent 决策)===
  assert(
    systemPromptHelpers.htmlPageOrchestrator.includes('规格化') &&
      systemPromptHelpers.htmlPageOrchestrator.includes('视觉风格') &&
      systemPromptHelpers.htmlPageOrchestrator.includes('交互意图') &&
      systemPromptHelpers.htmlPageOrchestrator.includes('❌') &&
      systemPromptHelpers.htmlPageOrchestrator.includes('✅'),
    '✓ 委派 task 规格化:htmlPageOrchestrator 含规格条(4 要素 定位/视觉/内容/交互 + ❌/✅ 示例,不含技术实现)',
  )
  // thinking-taming ①补强:视觉锚(task 给具体 hex/占比,收窄子 agent 装饰细节推演;真 LLM 实测 beer-effect 思考 610 行冗余 30% 的成因)
  assert(
    htmlOrchestratorPrompt('html').includes('视觉锚') &&
      htmlOrchestratorPrompt('html').includes('#F7C948') &&
      htmlOrchestratorPrompt('html').includes('画布 60%'),
    '✓ 委派 task 视觉锚:规格条含具体锚点示例(主色 hex / 主体占比),示例本身可模仿',
  )

  // === 提示词命名参数化(prompt 不写死集成方字段名;codeField 可能是 html/innerHtml/嵌套 props.html_code) ===
  assert(
    htmlOrchestratorPrompt('html', 'props.html_code').includes('props.html_code 字段') &&
      htmlOrchestratorPrompt('hero', 'innerHtml').includes('innerHtml 字段') && htmlOrchestratorPrompt('hero', 'innerHtml').includes('use_hero'),
    '✓ htmlOrchestratorPrompt codeField 参数化:职责边界/重试段跟随实际字段名(不写死 code)',
  )
  assert(
    !systemPromptHelpers.htmlPageProposeFirst.includes('use_html') &&
      systemPromptHelpers.htmlPageProposeFirst.includes('use_<id>'),
    '✓ htmlPageProposeFirst 方案切换引导泛化(委派工具见 use_<id>,不写死 use_html —— 自定义 id 时该名不存在)',
  )

  // buildDataPrompt
  assert(buildDataPrompt(undefined) === '', 'buildDataPrompt → 无 data 返空串')
  const dp = buildDataPrompt({
    schema: z.object({ name: z.string().describe('用户名') }),
    bind: {},
    description: '用户数据',
  })
  assert(dp.includes('可操作数据'), 'buildDataPrompt → 含段标题')
  assert(dp.includes('用户数据'), 'buildDataPrompt → 含 data.description')
  assert(dp.includes('用户名'), 'buildDataPrompt → 含 schema 字段 .describe() hint')

  // === expose-schema-constraints:describeSchemaNode 结构化约束提取(zod 4 _def/_zod.def) ===
  const deepEq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  assert(describeSchemaNode(z.string().min(1).max(100)).constraints?.minLength === 1, 'describeSchemaNode → string minLength')
  assert(describeSchemaNode(z.string().min(1).max(100)).constraints?.maxLength === 100, 'describeSchemaNode → string maxLength')
  assert(describeSchemaNode(z.string().email()).constraints?.format === 'email', 'describeSchemaNode → string email format')
  assert(deepEq(describeSchemaNode(z.enum(['a', 'b'])).constraints?.values, ['a', 'b']), 'describeSchemaNode → enum values')
  assert(describeSchemaNode(z.literal('x')).constraints?.value === 'x', 'describeSchemaNode → literal value')
  assert(describeSchemaNode(z.array(z.string()).min(1).max(5)).type === 'array', 'describeSchemaNode → array type')
  assert(describeSchemaNode(z.array(z.string()).min(1)).constraints?.minLength === 1, 'describeSchemaNode → array minLength')
  assert(describeSchemaNode(z.number().min(0).max(100)).constraints?.min === 0, 'describeSchemaNode → number min')
  assert(describeSchemaNode(z.number().min(0).max(100)).constraints?.max === 100, 'describeSchemaNode → number max')
  assert(describeSchemaNode(z.number().int()).constraints?.int === true, 'describeSchemaNode → number int')
  assert(describeSchemaNode(z.boolean()).type === 'boolean' && !describeSchemaNode(z.boolean()).constraints, 'describeSchemaNode → boolean 无约束')
  assert(describeSchemaNode(z.string().optional()).optional === true, 'describeSchemaNode → optional 标记')
  assert(describeSchemaNode(z.string().default('x')).default === 'x', 'describeSchemaNode → default 值')
  assert(describeSchemaNode(z.string().nullable()).nullable === true, 'describeSchemaNode → nullable 标记')
  const objDesc = describeSchemaNode(z.object({ a: z.string() }))
  assert(objDesc.type === 'object' && objDesc.constraints?.shape?.a?.type === 'string', 'describeSchemaNode → object shape 递归')
  assert(describeSchemaNode(z.union([z.string(), z.number()])).constraints?.anyOf?.length === 2, 'describeSchemaNode → union anyOf')
  assert(describeSchemaNode({ a: 1 } as any).type === 'unknown', 'describeSchemaNode → 非 zod 对象(无 _def)返 type-only 兜底(dev warn 去重)')

  // renderSchemaHint / renderSchemaOverview
  assert(renderSchemaHint('name', describeSchemaNode(z.string().min(1).describe('用户名'))) === '- name (string)[minLen=1]: 用户名', 'renderSchemaHint → key (Type)[约束]: desc')
  assert(renderSchemaHint('alias', describeSchemaNode(z.string().optional())) === '- alias (string?)', 'renderSchemaHint → optional 带 ?')
  const overview = renderSchemaOverview(z.object({ name: z.string().min(1).describe('用户名'), age: z.number().min(0) }))
  assert(overview.includes('(string)[minLen=1]') && overview.includes('(number)[min=0]'), 'renderSchemaOverview → 顶层字段带类型+约束')
  assert(renderSchemaOverview(z.string().min(1)).includes('(root)'), 'renderSchemaOverview → 非 object fallback 根节点')

  // extractSchemaHint 升级(经 renderSchemaOverview,带类型+约束)
  const hintObj = extractSchemaHint(z.object({ name: z.string().min(1).describe('用户名') }))
  assert(hintObj.includes('(string)') && hintObj.includes('minLen'), 'extractSchemaHint → object 带类型 + 约束')
  assert(extractSchemaHint(z.string().min(1)).includes('(root)'), 'extractSchemaHint → 非 object fallback 根节点')
  assert(extractSchemaHint(null) === '' && extractSchemaHint(undefined) === '', 'extractSchemaHint → null/undefined 返空串(!schema 兜底)')

  // === schema_data 工具(advanced;查任意路径完整约束) ===
  const dataOps = createDataOps({
    schema: z.object({
      name: z.string().min(1).max(100).describe('用户名'),
      role: z.enum(['admin', 'user']),
      tags: z.array(z.string()).min(1),
    }),
    bind: { name: 'x', role: 'admin', tags: ['a'] },
    description: '测试数据',
  })
  const dt = byName(dataOps)
  const sdRoot = await invoke(dt.schema_data, {})
  assert(sdRoot.includes('"type":"object"') && sdRoot.includes('"minLength":1'), 'schema_data 根 → 含 object type + 字段约束(嵌套 shape)')
  const sdSub = await invoke(dt.schema_data, { jsonPath: 'name' })
  assert(sdSub.includes('"type":"string"') && sdSub.includes('"minLength":1'), 'schema_data 子路径 → 含 string + minLength')
  assert(sdSub.includes('用户名'), 'schema_data 子路径 → 含字段 description')
  const sdMiss = await invoke(dt.schema_data, { jsonPath: 'nope' })
  assert(sdMiss.includes('PATH_DENIED'), 'schema_data 不存在路径 → PATH_DENIED')

  // read 概览段(不传 jsonPath)不带约束(refine-dataops:去重复,约束靠 systemPrompt + schema_data);含说明 + 引导
  const readOverview = await invoke(dt.read, {})
  assert(readOverview.includes('主数据说明') && readOverview.includes('schema_data') && !readOverview.includes('可操作字段'), 'read 概览段 → 不带约束(去重复),含说明 + schema_data 引导')
  assert(!readOverview.includes('(string)['), 'read 概览 → 不含约束标注(约束在 systemPrompt/schema_data)')
  const readSub = await invoke(dt.read, { jsonPath: 'name' })
  assert(!readSub.includes('主数据说明'), 'read 子路径读 → 不带概览段(保值返回干净)')
}
