/**
 * 预设 —— 常见场景的推荐配置包,集成方 spread 进 createChatSdk,降低上手门槛。
 *
 * 用法:
 *   createChatSdk({ ...presets.pageBuilder, container: '#root', llm, data })
 *   createChatSdk({ ...presets.minimal, container, llm, data })  // 极简,省 token
 *
 * 预设只给场景化配置(systemPrompt / capabilities / subagent 等);
 * container / llm / data 等依赖集成方环境的选项仍由调用方提供。
 */
import type { ChatSdkOptions } from './sdk/createChatSdk'
import { renderSchemaOverview, renderSchemaShallow } from './tools/schemaUtils'

export const presets: Record<string, Partial<ChatSdkOptions>> = {
  /**
   * 页面构建助手 —— Agent 读写主数据驱动页面(配合 data 声明 schema + bind)。
   *
   * 3.9+ 简化:HTML 代码子 agent 由 createChatSdk 装配期自动装配(schema 含 code 数组即装,无开关),
   * preset 不再自带 subagents(原 getter 每次新建的防突变逻辑随之退役);此处只剩场景化身份 prompt。
   */
  pageBuilder: {
    systemPrompt:
      '你是页面构建助手。按用户意图读写主数据(经 data 声明 + schema 校验),改完页面实时更新。',
  },

  /**
   * 调研助手 —— 并行多路调研 + 文档抓取,结构化汇总。
   */
  researcher: {
    systemPrompt:
      '你是调研助手。多路调研用 spawn_agents 并行委派子 agent(各负责一个方向);单份资料用 fetch_document 抓取;最后结构化汇总,给出结论与依据。',
    subagent: { maxParallel: 4 },
  },

  /**
   * 极简助手 —— 只做 数据操作,关闭所有高级能力(省 token / 体积 / 上下文噪音)。
   * ⚠️ vfs 关闭 → 大结果外存退化为截断;summarization 关闭 → 长会话不压缩。
   */
  minimal: {
    capabilities: { planning: false, skills: false, vfs: false, summarization: false, memory: false, subagent: false },
  },
}

/**
 * systemPrompt 辅助片段 —— 标准化最佳实践,集成方 spread 进自己的 systemPrompt,降低写错门槛。
 *
 * 用法:
 *   import { systemPromptHelpers } from 'page-agent-sdk'
 *   createChatSdk({ systemPrompt: `你是 JSON 操作助手。\n${systemPromptHelpers.reliableWriteRules}`, ... })
 */
/**
 * HTML 页面搭建主 agent 委派编排(按子 agent id 动态生成,use_<id> 工具名正确)。
 * 单一数据源:createHtmlSubagent 默认自动注入此段(orchestratorPrompt:true);systemPromptHelpers.htmlPageOrchestrator 为 id='html' 静态快照。
 * 集成方自定义 id(如 'hero')时,createHtmlSubagent 自动生成含正确 use_hero 的编排 —— 写死 use_html 的静态片段会误导主 agent 调不存在的工具。
 */
export function htmlOrchestratorPrompt(id: string, codeField = 'code'): string {
  const use = `use_${id}`
  return [
    `【执行纪律(最重要)】收到代码组件任务后:**新建类直接委派**(追加组件无需通读/翻页现有数组,子 agent 自会采样一个组件看结构;**新建组件由子 agent 全权创建** —— 它自己把整个组件(含 ${codeField})写进数组,你不需要也不能替它创建/追加/落地代码)→ 修改类才 read 定位(by name)→ 调 ${use} 委派 → read 核对 → 回复用户。**中间绝不输出过渡性文字** —— 「我先看看…」「稍后委派」「接下来我会…」这类计划性回复等于任务没做就结束了(回复即本轮终止);所有调研和委派在本轮内连续完成,完成后才回复总结。`,
    '【产物形态】每个组件是完整、自包含的 HTML 页面(含 style/script,可独立成页);你只负责委派和收尾,不关心宿主如何渲染(v-html / iframe / SFC 是集成方的事)。',
    `【主 agent 职责边界(硬规则)】禁止直接 read/write 代码组件的 ${codeField} 字段(read 只得 <code Nkb> 摘要没用;write 绕过 vfs/verify 危险)—— 生成/修改/排查代码一律经 ${use},收尾 read 核对。**委派返回即已落地**:${use} 的结论说「已创建组件 X」= 组件已在数组里,**不要再 write/append 一遍**(子 agent 已自己创建,你再写 = 造出重复组件,还得花轮次删;真 LLM 实测踩过:主 agent 把返回的 code 又追加了一次 → 索引 8/9 重复)。核对方式 = read 该数组尾部(确认新组件存在 + name 唯一),仅此而已。`,
    `【多组件委派(防上下文污染)】一次要多个组件:① write_todos 列出(每项 name + 要点)② **不同组件可在同一轮并行发多个 ${use} 委派**(每组件一次 ${use},task 只写该组件 name + 要点 + 主题/风格;每次委派是独立子 agent 实例,互不共享上下文);**同一组件同一时间只能有一个委派在途**,勿对同一组件同轮发两个委派 ③ 委派返回后逐个 read 核对(确认已生成 + 名称对)+ update_todo 标完成 ④ 主题/风格在每次 task 里转述(每个子 agent 全新上下文,不知其他组件)。一次 task 塞多个组件仍禁止(同一子 agent 共享上下文生成多个 → class/样式冲突污染);主 agent 自己的 write(普通组件属性)可与委派同轮发出,不必等委派返回。`,
    `【委派 task 规格化(收窄子 agent 决策,防开放任务致装饰穷举)】委派 ${use} 的 task 必须含:① 组件定位(by name)② 视觉风格(配色/质感/字体;**给 1-2 个具体视觉锚** —— 主色 hex **取自平台 UI/设计规范 skill 的定义值**(有规范类 skill 先 load 再引用其 hex,勿凭页面观察自造近似色;无规范才自定,如「金黄 #F7C948」)、主体占比(如「杯高约画布 60%」)或装饰密度(如「仅 2 类背景装饰」)—— 细节空间收窄,子 agent 不在装饰细节上展开推演)③ 内容(文案/数据/图)④ 交互意图(动效/状态/触发)⑤ 历史偏好(可选):聊天上下文中有与该组件相关的用户历史偏好/反馈(如「用户偏好深色系」「上轮嫌动画太快」),提炼一句附 task 末尾(新子 agent 无记忆,全靠 task);**不含技术实现**(SVG vs CSS / keyframes vs transition 归子 agent 选)。❌「生成啤酒杯动画」→ ✅「啤酒杯倒酒(beer):金黄啤酒 #F7C948 从上方倒入透明杯(杯高约画布 60%),深绿背景,液体循环下落 2s,hover 杯子放大」。规格简练(4 要素各半句),远省子 agent 思考 token。`,
    `【委派失败重试】${use} 返回乱码/内部标记(如 <｜DSML｜)/空结论或报错 = 子 agent 异常,**重新委派一次**(task 附「上次失败,这次先把代码写短些/分步」);连续两次失败才降级告知用户。**不要因此自己直接 write/edit ${codeField} 字段**(绕过 vfs/格式校验,且你拿不到规范全文)。`,
    '【预算将尽暂停】组件很多、接近工具轮次上限不要硬扛:完成手头这个后报告「已生成 K/N,还剩 M 个」,等用户确认后从 todos 剩余项继续(勿重复已完成)。',
  ].join('\n')
}

export const systemPromptHelpers = {
  /**
   * 可靠写入规则 —— 教 LLM「改前先读真实值、动态场景先查、字段以 describe 为准、写错看校验错误重试」。
   * 避免集成方忘了写这些元规则,导致 LLM 基于记忆瞎改、靠 schema 兜底纠错烧轮次。
   * 建议所有涉及 主数据写操作的场景都把这段拼进 systemPrompt。
   */
  reliableWriteRules: [
    '【可靠写入规则】',
    '1. 改任何字段前,先用 read({ jsonPath }) 读其当前真实值,基于真实值改,不要凭记忆;',
    '2. 若不确定可操作哪些字段,先 read() 不传 jsonPath 查看主数据说明 + schema 声明字段(集成方可经 sdk.setData 运行时替换 schema,以工具返回为准,勿凭旧记忆);',
    '3. 不确定某字段结构时,read({ jsonPath }) 返回含格式说明,字段以返回为准;',
    '4. 写入若被 schema 校验拒绝(返回结构化错误含字段名与期望类型),按错误修正后重试,不要放弃;',
    '5. 优先用 write 的 patch 增量改(只发改动,如 write({ value, patch:{ op, jsonPath } })),避免整体重传大 JSON 被截断;',
    '6. 写入若触发乐观锁冲突(返回 VERSION_CONFLICT 或工具挂起等用户决定):等工具返回结果后按其指示继续(保留外部值 → 重新 read 再改;已覆盖/已回退 → 基于结果重写),不要放弃任务。',
  ].join('\n'),

  /**
   * 可靠写入规则(英文版)—— dialog.locale:'en-US' 时 buildSystemPrompt 追加/默认 prompt 用此版
   * (与 reliableWriteRules 逐条对齐;未传 systemPrompt 的默认身份段见 DEFAULT_SYSTEM_PROMPT_EN)。
   */
  reliableWriteRulesEn: [
    '[Reliable write rules]',
    '1. Before changing any field, read its current real value with read({ jsonPath }) and edit based on that value, never from memory;',
    '2. If unsure which fields are operable, call read() without jsonPath first to see the data description + schema-declared fields (the integrator can replace the schema at runtime via sdk.setData; trust the tool response over stale memory);',
    '3. When unsure about a field structure, the read({ jsonPath }) response includes a format description; treat the response as the source of truth;',
    '4. If a write is rejected by schema validation (the structured error names the field and expected type), fix it per the error and retry; do not give up;',
    '5. Prefer incremental write patches (send only the change, e.g. write({ value, patch:{ op, jsonPath } })) over resending the whole large JSON, which risks truncation;',
    '6. If a write hits an optimistic-lock conflict (VERSION_CONFLICT returned, or the tool suspends awaiting the user decision): after the tool returns, follow its instruction (keep external → re-read then edit; overwritten/restored → continue from the result); do not abandon the task.',
  ].join('\n'),

  /**
   * HTML 页面搭建主 agent 编排规则(htmlOrchestratorPrompt('html') 静态快照,单一数据源)。
   * 用 createHtmlSubagent 且关闭自动注入(orchestratorPrompt:false),或自定义编排时,把这段拼进自己的 systemPrompt。
   */
  htmlPageOrchestrator: htmlOrchestratorPrompt('html'),

  /**
   * HTML 页面搭建「先出方案再生成」—— 产品决策(新建/创意类先给 2~3 套方案问用户,而非直接生成)。
   * 默认不并进 htmlPageOrchestrator(不同集成方偏好不同);要「先问再生成」体验时自行拼接。
   */
  htmlPageProposeFirst: [
    '【新建/创意类请求】先用简短文字给出 2~3 套方案(每套一两句风格/配色/结构要点),询问用户选哪套;选定前不要委派生成代码、不要写 components。',
    '【方案切换】已生成某套方案后改选另一套:不重新罗列,直接依据之前描述重新委派生成并覆盖相应组件(委派工具见编排段 use_<id>)。',
  ].join('\n'),

  /**
   * HTML 页面搭建「主 agent 自己写」降级编排(未注册 html 子 agent 时)。
   * 触发:createChatSdk 装配期检测「无 html 子 agent + schema 有 code 字段」自动注入 + warn(精确 ZodObject / z.array(z.object) / discriminatedUnion 可识别);
   *   开放 schema(z.any())静态扫不到时,集成方主动 spread 此片段(opt-in,同 htmlPageProposeFirst 用法)。
   * 无 html 子 agent → 无 vfs 工作副本 / 无 verify 门禁,code 是普通 schema 字段,主 agent 直接 write。
   */
  htmlDirectWriteFallback: [
    '【纯代码组件 · 你直接写】当前未配备 html 子 agent,纯代码组件的代码字段(code,以 schema 声明为准)由你直接 write(普通字段,经 schema 校验 + 乐观锁 + 快照栈,与改其他字段无异;无 vfs 工作副本 / 无格式校验门禁)。',
    '【HTML 生成规范】代码字段必须是完整、自包含的 HTML 页面(含 <style>/<script>,可独立成页):标签正确闭合、style/script 集中放置(如 <head> 内)、class 加前缀防冲突;可引外部 JS/CSS(CDN/字体)。安全底线:禁 eval/new Function、不引可疑外部脚本、不访问 document.cookie 等敏感属性。',
    '【修改而非重写】改已有代码:先 read({jsonPath}) 取当前代码字段 → 基于当前值增量改(只动要改的部分,如换配色/文案/某段结构),不要整体重写整个代码字段(易丢已有内容、token 浪费)。',
    '【质量自检】无格式校验门禁,写完自查标签闭合 / 结构完整;代码进 data 由集成方渲染层(v-html/iframe)呈现。如需代码资产机制(vfs 工作副本 + 格式校验 + 增量 commit),注册 createHtmlSubagent。',
  ].join('\n'),
} as const

/**
 * 从 zod schema 提取字段说明(io 契约注入 systemPrompt 用);非 object schema 用 description 兜底。
 * 导出供集成方预览 io 契约将注入的提示,亦供单测。
 *
 * **分层披露**(add-schema-tiered-disclosure):大 schema(顶层 key 数 > maxKeys **或** 全量渲染字符 > maxChars)
 * 自动转「顶层概览」(key + type + 一句描述,不带 min/max/enum 约束、不递归 shape)+ 尾部提示(深层约束查 schema_data)。
 * 小 schema(≤阈值)仍全量(现状不变)。默认 maxKeys=15 / maxChars=4000,集成方经 schemaHint 配置可调。
 */
export interface SchemaHintOptions {
  /** 顶层 key 数超此 → 分层(默认 15) */
  maxKeys?: number
  /** 全量渲染字符超此 → 分层(默认 4000) */
  maxChars?: number
  /**
   * 工具呈现模式(提示词与工具面一致性):非 advanced(simple/minimal)时 schema_data 未装载,
   * 分层披露的深层指引改教 read 子路径(勿教工具池不存在的工具,防 LLM 误调报「工具不存在」)。
   * 默认 'advanced'。
   */
  toolMode?: 'simple' | 'advanced' | 'minimal'
}

const DEFAULT_SCHEMA_HINT_MAX_KEYS = 15
const DEFAULT_SCHEMA_HINT_MAX_CHARS = 4000

// schema hint 缓存:按 schema 对象引用 + opts(WeakMap 随 schema GC 自动清,无需手动失效)。
// extractSchemaHint 每轮经 augmentPrompt → replaceSystem → buildSystemPrompt 调用,schema 引用不变时省
// renderSchemaOverview/Shallow 重算;setData 传新 schema 对象 → 新引用自动 miss(controller.set 同理)。
const schemaHintCache = new WeakMap<object, { optsKey: string; hint: string }>()

export function extractSchemaHint(schema: any, opts?: SchemaHintOptions): string {
  if (!schema) return ''
  const optsKey = opts ? `${opts.maxKeys ?? ''}|${opts.maxChars ?? ''}|${opts.toolMode ?? ''}` : ''
  // 仅对象 schema 缓存(WeakMap key 限对象;非对象走直算)
  if (typeof schema === 'object') {
    const cached = schemaHintCache.get(schema)
    if (cached && cached.optsKey === optsKey) return cached.hint
  }
  const hint = computeSchemaHintImpl(schema, opts)
  if (typeof schema === 'object') schemaHintCache.set(schema, { optsKey, hint })
  return hint
}

/** extractSchemaHint 的无缓存计算体(抽离便于缓存层包裹) */
function computeSchemaHintImpl(schema: any, opts?: SchemaHintOptions): string {
  // 全量渲染(带 min/max/enum 约束 + 嵌套);非 object / 空 shape fallback 到根节点描述
  const overview = renderSchemaOverview(schema)
  if (overview) {
    const maxKeys = opts?.maxKeys ?? DEFAULT_SCHEMA_HINT_MAX_KEYS
    const maxChars = opts?.maxChars ?? DEFAULT_SCHEMA_HINT_MAX_CHARS
    // 阈值判断:顶层 key 数(renderSchemaOverview 每顶层字段一行)> maxKeys 或 全量字符 > maxChars → 分层
    const keyCount = overview.split('\n').filter((l) => l.trim().startsWith('- ')).length
    if (keyCount > maxKeys || overview.length > maxChars) {
      const shallow = renderSchemaShallow(schema)
      if (shallow) {
        // 深层指引按 toolMode 分支(提示词与工具面一致性):simple/minimal 未装载 schema_data,
        // 改教 read 子路径(全模式可用);advanced 才教 schema_data({jsonPath}) 查约束
        if (opts?.toolMode === 'simple' || opts?.toolMode === 'minimal') {
          return '## 可操作数据(顶层概览;深层实际值用 read 子路径查)\n' + shallow
            + '\n提示:改某组件深层字段前,先 read({jsonPath}) 看该位置实际值与形状,照现有字段写。'
        }
        return '## 可操作数据(顶层概览;深层约束查 schema_data)\n' + shallow
          + '\n提示:改某组件深层字段前,先 schema_data({jsonPath}) 查完整约束(advanced);或 read 子路径见实际值。'
      }
    }
    return overview
  }
  return schema?.description || '(用 read 查看实际形状)'
}


