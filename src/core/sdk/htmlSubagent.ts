/**
 * Pack 2:HTML 代码组件生成子 agent 工厂(createHtmlSubagent)—— 单模式(code-as-data-asset)
 *
 * 构造代码组件生成子 agent(规划 + 执行)—— 装 todos 中间件获规划能力 + 经 writablePaths 获写权限 +
 * 代码作为 data 资产(code 字段进服务端 DB;vfs 作编辑工作副本;框架自动 checkout/commit)。
 * 返回标准 SubagentConfig,集成方塞 createChatSdk({ subagents:[createHtmlSubagent({writablePaths})] })
 * → 主 agent 自动获得 use_html 委派工具。
 *
 * 代码资产模型(单模式,breaking major;详见 openspec/changes/2026-08-12-code-as-data-asset/design.md):
 * - **代码正文 = data 的 code 字段**(资产源;随 data json 进服务端 DB;UI 直接绑 data.code 响应式渲染)
 * - **vfs = 编辑工作副本**(会话级;框架 beforeAgent 把 data.code 按 __pgId 检出到 vfs,子 agent vfs_edit 增量改,
 *   afterAgent 把改过的 vfs 文件增量回写 data.code;主 agent 全程透明,不碰代码正文)
 * - **__pgId 框架无感注入**(集成商 schema 不声明;read 投影隐藏;agent 写不进;persist 透明带;vfs 文件名 = codeVfsPrefix+__pgId+ext)
 *
 * 输出格式校验(formatCheck,默认开):
 *  - validate_code 工具:子 agent 生成/修改代码后自主调用自检(标签闭合等结构合法性),报错即用 vfs_edit 修
 *  - verify beforeReturn 门禁:返回前确定性扫 vfs 代码文件,不通过 feedback 回灌自纠(maxVerifyAttempts 2 兜底)
 *  - 校验器为纯函数 validateHtmlFormat(tools/htmlValidate.ts),集成方渲染层亦可复用做纵深防御
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { SubagentConfig } from '../harness/subagent'
import type { SkillSpec } from '../harness/skills'
import type { Middleware } from '../harness/middleware'
import type { SummarizationOptions } from '../harness/summarization'
import type { VfsFile } from '../harness/state'
import type { VerifyCheck, VerifyCheckResult } from '../harness/verify'
import { createTodosMiddleware } from '../harness/todos'
import { createVerifyMiddleware } from '../harness/verify'
import { validateHtmlFormat } from '../tools/htmlValidate'
import { htmlOrchestratorPrompt } from '../presets'
import { getByPath } from '../tools/jsonUtils'
import type { DataOpsController } from '../tools/dataOps'

export interface CreateHtmlSubagentOptions {
  /** 可写 data 路径前缀(写 components,含 code 字段;如 ['components']);write/set 经 path guard 越界 PATH_OUT_OF_SCOPE */
  writablePaths: string[]
  /** 代码工作副本存 vfs 的路径前缀;默认 'html/'(工作副本文件 html/<__pgId>.html) */
  codeVfsPrefix?: string
  /** 子 agent 标识;默认 'html' */
  id?: string
  /** 委派工具描述;默认通用 HTML 生成描述 */
  description?: string
  /** 装规划中间件(write_todos/update_todo);默认 true */
  planning?: boolean
  /** 跨轮压缩(频繁改代码累积快);默认 true。false=不装,true=索引摘要(零 LLM),或 SummarizationOptions 自配 */
  summarization?: boolean | SummarizationOptions
  /** 子 agent 最大工具轮次(中等任务);默认 12 */
  maxToolRounds?: number
  /** 子 agent 温度(代码生成建议低温);默认 0.4 */
  temperature?: number
  /** 默认装内置 html 生成规范 skill;集成方可追加或替换 */
  skills?: SkillSpec[]
  /** 额外工具(直接进子 agent 工具池) */
  extraTools?: StructuredToolInterface[]
  /**
   * 输出格式校验(结构合法性:标签闭合等);默认 true:
   * - 装 validate_code 工具(子 agent 自主自检)+ verify beforeReturn 门禁(返回前扫 vfs 代码文件,maxVerifyAttempts 2 自纠兜底)
   * - false 关闭(不装校验链,零开销)
   */
  formatCheck?: boolean
  /** 代码字段相对组件的 jsonPath(开放 schema 适配;默认 'code',支持嵌套如 'props.html_code')。「是否代码组件」= 该路径下有 string 值 */
  codeField?: string
  /** 自动注入主 agent 委派编排段(htmlOrchestratorPrompt(id),含正确 use_<id>);默认 true。false=不注入(高级用户自定义编排) */
  orchestratorPrompt?: boolean
}

// ===== HTML systemPrompt(单模式:代码作为 data 资产 + vfs 工作副本) =====

function htmlSystemPrompt(prefix: string): string {
  const ext = 'html'
  const kindRules = `- 输出形态:完整、自包含的 HTML 页面(.${ext},可独立成页)`
  return `你是纯代码组件生成专家。可用工具:vfs_write / vfs_edit / vfs_rm(写/改/删代码工作副本 vfs ${prefix}) / vfs_read + vfs_grep(读 vfs) / validate_code(代码格式自检) / write + set(写 data,writablePaths 限定) / read / write_todos + update_todo(规划)。

收 task 规格照做(减少你自己的思考纠结):task 含视觉(配色/质感)+ 内容(文案/数据)+ 交互(动效/触发)规格时,**照规格实现**(技术实现 SVG vs CSS / keyframes vs transition 自行选成熟模式,不穷举);task 缺规格(主 agent 漏写)时,按字面意图选**一个简单方案**直接实现,不纠结「该用什么风格」—— 主 agent 掌整页主题协调,你负责落地。

代码作为数据资产(重要):
- 代码正文是 data 的 code 字段(资产,随 data json 进服务端 DB);UI 直接绑 data.code 渲染
- vfs 是编辑工作副本:框架在每次委派开始时自动把 data.code 检出到 vfs(${prefix}<__pgId>.${ext}),你改 vfs,委派结束框架自动把改过的 vfs 增量回写 data.code
- __pgId 是框架管的内部字段(组件稳定映射键):read 看不到、write 写不进,你别碰

两条工作路径:
- **修改已有组件**(改颜色/文案/布局等):必经 vfs —— 上下文有「组件代码文件地图」(name → vfs 路径),按 name 找到对应文件直接 vfs_edit 增量改目标片段 → validate_code 自检;框架自动回写 data.code。勿直接 write data.code 改已有组件(绕过 vfs/verify,且无增量友好);文件未检出时先 vfs_write 创建
- **新建组件**:write({ patch:{ op:'set', jsonPath:'components.N', value:{...} } }) —— value 按 data schema **全字段写**(含必填字段如 type/name,code 正文;缺必填字段会被 schema 拒)。先 read 看现有组件结构照抄字段名,再写;框架自动补 __pgId。**固定流程**:直接 write data → validate_code({jsonPath:'components.N.code'}) 自检(从 data 读刚写的 code,零重传 content)→ read 确认;**不必手动 vfs_write 建工作副本**(框架下次委派自动 checkout;仅当本次委派内还要继续精修它,才 vfs_write 建副本再 vfs_edit)。**校验方式**:新建组件用 jsonPath(零重传)/ 修改组件用 path(vfs 文件)/ content 仅兜底;**禁止在思考里权衡「content 太长 / 要不要重传 / 先 vfs_write 再 by path」**,选对应方式一次校验即收口(为之纠结反费更多 token,真实复盘子 agent 曾在此循环 10+ 回合致整页超时)。**code 字段直接写完整代码字符串,换行/引号照常写,无需手工 JSON 转义**

焦点精修(若继承到主 agent 焦点):
- 上下文若提示「当前精修目标」(如 components.2(banner)),说明主 agent 聚焦了某组件 → 你**只能改该焦点组件**的代码文件(vfs 文件 ${prefix}<焦点组件 __pgId>.${ext});改其他组件的代码文件会被 PATH_DENIED 硬拦
- 直接改焦点组件文件,不要尝试改其他组件(浪费轮次);聚焦模式下也不能新建组件(数据写被拦)—— 若 task 要新建,反馈主 agent 需先取消焦点

代码形态规则:
${kindRules}

输出要求(生成完整、自包含、能独立成页的 HTML):
- 产物是**完整、自包含的 HTML 页面**(结构完整、标签闭合、交互逻辑用 <script>),能独立正确渲染
- **交互逻辑默认用 <script> 实现**(完整页面含 script 是常态);仅当用户明确要求「纯 CSS / 不要 script」时不写。不假设渲染方式(v-html / SFC / iframe 等是集成方的事)
- **CSS 用 <style> 块、script 用 <script> 块,集中放置**(如 <head> 内或页面顶部),不散落内联 —— 便于下游工具提取成独立 html / css / js 文件
- 可引入外部 JS / CSS(如 CDN 组件库、字体、外链样式)按需使用;class 加统一前缀防样式冲突
- **不在思考里推演「宿主如何渲染/执行」「script 会不会被剥」** —— 那是集成方职责,超出你的范围

诚实交付:
- 按用户需求产出完整 HTML 页面。若某需求无法实现,结论简短说明(不展开权衡、不解释渲染原理)。禁止假装实现了未做到的特性。

工作方式:
1. 中等任务(多组件 / 大段代码)先 write_todos 拆解:read 看现有结构 → 规划各组件 → 逐个改/建 → read 确认。**todo 工具约束**:write_todos 是整表替换(一次列全),update_todo 是增量(标完成/改状态);两者**不可在同一轮混用**(一轮内只用一种,否则被拒),别再同轮重试另一种;
2. 遵循已加载 skill 的规范(安全底线 / 可访问性 / 组件库引用);
3. 小段代码 vfs_write 整体写;大段用 vfs_edit 增量拼(避免单次输出超限);
4. **修改已有代码:必先 vfs_read 目标文件看清现状 → vfs_edit 增量改目标片段;vfs_write 仅用于首次创建或整体重构,修改场景勿覆盖重写整个文件(避免丢失既有内容 + 浪费 token)**;
5. 生成/修改完成后必须调 validate_code 自检(结构合法性:标签闭合),报错用 vfs_edit 修正后复查,直到通过;
6. 最后 read(vfs + data)确认结构正确;只写 writablePaths 内 data + ${prefix} 下 vfs;
7. **简洁思考(硬约束,违反致超时/巨量 token)**:
   - **写前简述(先定方向)**:写代码前先用 1-2 句简述方案(结构 + 关键技术选择,如「啤酒杯用 SVG,倒酒用 CSS animation 循环 2s」)→ 再直接实现。简述即定方向,实现时照做,不再反复权衡其他写法。
   - **方案探索上限**:任何子问题**最多考虑 2 个方案**,选定即写代码;**禁止逐个推演 3+ 个编号方案**(如「方案1…方案12」穷举式探索)。复杂 CSS 交互(轮播/动画/手风琴等)直接用**已知成熟模式**(radio hack + keyframes / scroll-snap 等),不在思考里反复探索可行性边界 —— 选一个写,不行再 validate 后调。
   - **视觉装饰效果不穷举(常见超时元凶)**:锯齿/撕边/打孔/异形/复杂渐变等**纯装饰**,选第一个想到的简单实现直接写代码(锯齿 repeating-linear-gradient 一行、打孔 radial-gradient 一行、异形 clip-path 一句),**禁止在思考里对比 linear-gradient / conic-gradient / radial-gradient / clip-path 多方案并逐个分析视觉差异** —— 装饰差异微小不值得多方案;写完看效果,不满意再调一处。真实复盘:子 agent 曾为「优惠券撕边」对比 4+ 渐变方案耗数千 token 致整页超时。
   - **禁止在思考里手算实现细节**:CSS 选择器特异性、keyframe 百分比、timing 数学、crossfade 边界对齐 —— 这些**在代码里定**,写完跑 validate/看效果调,不在思考里逐条算。
   - **机械决定一次定**:写法选择(read 回读 vs 复制、vfs 草稿 vs 直写 data、并行 vs 串行)快速选一个,**不在思考里反复权衡 token 成本**(为之纠结反更费 token)。
   - **禁止在思考里整段写出完整代码草稿**:CSS/JS/HTML 代码只写进 write / vfs_write / vfs_edit 工具调用(代码只出现一次);思考里只做高层设计(结构 / 字段 / 方案选择),不要先逐行预写一遍代码再在工具里重复一遍 —— 那会让代码 token 翻倍。
   - **代码字符串不纠结转义**:code / content 字段就是普通字符串,直接写完整代码文本(换行、引号照常写),不要纠结「\n」转义、单双引号、字面换行会不会被拒 —— 框架自动序列化,反复权衡纯属浪费 token。
   - 一次想清楚 → 动手 → 验证 → 收口。**思考是手段不是目的,产出代码才是**。`
}

// ===== 内置 skill(完整 HTML 生成规范)=====

const HTML_FRAGMENT_SKILL_DOC = `# HTML 完整页面生成规范

## 代码资产模型(重要)
- 代码正文是 data 的 code 字段(资产,随 data json 进服务端 DB);UI 绑 data.code 渲染
- vfs 是编辑工作副本:框架自动 checkout(data.code→vfs)/ commit(vfs→data.code),你只改 vfs
- __pgId 框架管(read 看不到、write 写不进),别碰

## 两条工作路径
- 修改已有组件:必经 vfs —— 按上下文「组件代码文件地图」(name → vfs 路径)定位文件,vfs_edit 增量改 → validate_code;勿直接 write data.code;文件未检出先 vfs_write 创建
- 新建组件:write({patch:{op:'set',jsonPath:'components.N',value:{...}}}) —— value 按 schema 全字段写(必填字段如 type 不能漏;先 read 看现有组件结构照抄字段名),框架补 __pgId。固定流程 write → validate_code({jsonPath:'components.N.code'})(零重传 content)→ read 确认,**不手动 vfs_write 建副本**(框架下次委派自动 checkout)。code 字段直接写完整代码字符串,换行/引号照常写,无需手工 JSON 转义

## 焦点精修(继承主 agent 焦点时)
- 上下文提示「当前精修目标」(如 components.2(banner))→ 只改该焦点组件的代码文件;改其他组件会被 PATH_DENIED 硬拦
- 聚焦模式不能新建组件(数据写被拦),要新建先反馈主 agent 取消焦点

## 输出:完整、自包含、能独立成页的 HTML
- 产物是**完整、自包含的 HTML 页面**(结构完整、标签闭合),能独立正确渲染。下游改造(抽 body / 包组件 / 片段化)由插件或 tool 做,不是你的事
- **交互逻辑默认用 <script> 实现**(完整页面含 script 是常态);仅当用户明确要求「纯 CSS / 不要 script」时不写
- **CSS 用 <style> 块、script 用 <script> 块集中放置**(如 <head> 内),不散落内联 —— 便于下游工具提取成独立 html/css/js
- 可引入外部 JS / CSS(CDN 组件库、字体、外链样式)按需使用;class 统一加前缀防冲突(如 .pg-hero-…)

## 标签闭合(必须)
- 非自闭合标签必须成对闭合(<img> / <br> / <input> 等 void 元素除外)
- 每次生成/修改后调 validate_code 自检(只校验结构合法性),报错用 vfs_edit 修正直到通过

## 何时写代码组件
- 组件库无对应类型(高度定制布局 / 一次性专题页 / 特殊视觉效果)→ 写完整 HTML 页面
- 组件库已有(按钮 / 卡片 / 列表)→ 用现有组件配置,不重造

## 安全底线(必须)
- 禁 eval / new Function / Function 构造器
- 禁访问 window 敏感属性(document.cookie / apiKey / token)

## 可访问性 + 语义化
- 语义化标签(button / nav / section);图片 alt;交互可键盘聚焦
- 颜色对比达标;不只用颜色传达信息`

/** 内置 html 生成规范 skill(完整页面级 HTML;默认装进子 agent)。getContent 返回全文(不依赖外部文件) */
export const htmlFragmentSkill: SkillSpec = {
  name: 'html-fragment',
  description: '完整 HTML 页面生成规范:代码作为 data 资产 / vfs 工作副本 / 完整自包含可独立成页 / script+CSS 集中放置 / 可引外部 JS/CSS / validate_code 自检 / 安全底线 / 可访问性',
  getContent: () => HTML_FRAGMENT_SKILL_DOC,
}

// ===== 格式校验链(validate_code 工具 + verify beforeReturn 门禁) =====

export interface HtmlFormatCheckOptions {
  /** vfs 代码路径前缀(与 createHtmlSubagent 的 codeVfsPrefix 一致);默认 'html/' */
  vfsPrefix?: string
}

/**
 * 创建 HTML 格式 verify check(beforeReturn 门禁):扫 state.files 中 vfsPrefix 下全部代码文件,
 * 任一文件有格式问题(标签未闭合等结构问题)→ ok:false + 可操作 feedback 回灌自纠。
 * 确定性校验(纯函数 validateHtmlFormat),不依赖 LLM。
 */
export function createHtmlFormatCheck(opts: HtmlFormatCheckOptions = {}): VerifyCheck {
  const prefix = opts.vfsPrefix ?? 'html/'
  return ({ state }): VerifyCheckResult => {
    const files = state.files
    if (!files) return { ok: true }
    const problems: string[] = []
    for (const [path, f] of Object.entries(files)) {
      if (!path.startsWith(prefix)) continue
      const issues = validateHtmlFormat(f.content)
      for (const it of issues) problems.push(`${path} 第 ${it.line} 行:${it.message}(${it.code})`)
    }
    if (!problems.length) return { ok: true }
    return {
      ok: false,
      feedback: `HTML 格式校验未通过(共 ${problems.length} 处):\n- ${problems.join('\n- ')}\n请用 vfs_edit 逐项修正,改完调 validate_code 复查,全部通过后再返回。`,
    }
  }
}

/**
 * validate_code 工具中间件:提供子 agent 自主自检工具 + beforeAgent 捕获 state.files(vfs 桥接引用)。
 * validate_code({ jsonPath?, path?, content? }):jsonPath 首选(从 data 读 code,新建组件零重传);path 读 vfs 工作副本(修改组件);content 仅兜底;都省略 = 校验 vfsPrefix 下全部文件。
 * 优先级与 schema 描述/字段顺序保持一致(真 LLM 实测:schema 是 LLM 最权威信号,若 schema 把 content 描述成"优先"会反向引导覆盖 system prompt 的 jsonPath 引导)。
 */
export function createHtmlValidateToolsMiddleware(vfsPrefix: string): Middleware {
  let filesRef: Record<string, VfsFile> | undefined
  // jsonPath 能力:getController 可变槽(createChatSdk 装配期识别 _codeAsset 后注入同源 dataOpsController)。
  // 新建组件 write 后 data 已有 code 但 vfs 尚未 checkout → validate_code({jsonPath}) 直读 data code 校验,零重传 content(治 token 纠结根因)。
  let getController: (() => DataOpsController | null | undefined) | undefined
  const validateCode = tool(
    async ({ path, content, jsonPath }) => {
      const targets: Array<{ path: string; content: string }> = []
      if (jsonPath) {
        // jsonPath 首选:直读 data code(新建组件 write 后 vfs 未检出,零重传 content);getController 由 createChatSdk 装配期注入
        const bind = getController?.()?.get?.()?.bind
        const code = bind ? getByPath(bind, jsonPath) : undefined
        if (typeof code !== 'string') return `jsonPath "${jsonPath}" 未命中 string 值(data 无该路径或非 string)。先 read({jsonPath}) 确认路径,或用 path / content 兜底。`
        targets.push({ path: jsonPath, content: code })
      } else if (path) {
        const key = path.replace(/^\/+/, '')
        const f = filesRef?.[key]
        if (!f) return `未找到 vfs 文件 "${path}"。先 vfs_ls 查看;代码须写在 ${vfsPrefix} 下。`
        targets.push({ path: key, content: f.content })
      } else if (content !== undefined) {
        // content 兜底:仅当 jsonPath/path 均不便时直传代码(与 schema 描述一致,jsonPath 首选)
        targets.push({ path: path ?? '(传入内容)', content })
      } else {
        if (filesRef) {
          for (const [p, f] of Object.entries(filesRef)) {
            if (p.startsWith(vfsPrefix)) targets.push({ path: p, content: f.content })
          }
        }
        if (!targets.length) return `${vfsPrefix} 下暂无代码文件,无需校验。`
      }
      const problems: string[] = []
      for (const t of targets) {
        const issues = validateHtmlFormat(t.content)
        if (issues.length) {
          problems.push(`${t.path}:\n${issues.map((it) => `  第 ${it.line} 行 ${it.message}(${it.code})`).join('\n')}`)
        }
      }
      if (problems.length) {
        return `❌ 格式校验未通过:\n${problems.join('\n')}\n请用 vfs_edit 修正后重新调用 validate_code 复查。`
      }
      return `✅ 格式校验通过(${targets.map((t) => t.path).join(', ')}:标签闭合等结构合法)。`
    },
    {
      name: 'validate_code',
      description: '校验 HTML 代码格式(标签闭合等结构合法性;DOCTYPE/html/head/body/script 均允许 —— 完整页面级)。生成/修改代码后必调;报错修正后复查直到通过。',
      schema: z.object({
        jsonPath: z.string().optional().describe('首选。从 data 读 code 校验(如 components.2.code;新建组件 write 后用,零重传 content)'),
        path: z.string().optional().describe('修改已有组件时校验 vfs 工作副本文件(如 html/hero.html)'),
        content: z.string().optional().describe('兜底。仅当 jsonPath/path 均不便时直传代码'),
      }),
    },
  )
  const mw: Middleware = {
    name: 'html-validate-tools',
    // vfs 桥接后 state.files 指向主 vfsStore.files(vfs-bridge 先序执行);捕获引用供 validate_code 读取
    beforeAgent: (state) => { filesRef = state.files },
    tools: [validateCode],
  }
  // jsonPath 能力注入槽:createChatSdk 装配期识别 _codeAsset 后调,注入同源 dataOpsController(validate_code 直读 data code)
  ;(mw as any)._setGetController = (g: () => DataOpsController | null | undefined) => { getController = g }
  return mw
}

// ===== 工厂 =====

/** formatCheck 开启时子 agent beforeReturn 自纠上限(与主 verify 默认一致) */
const FORMAT_CHECK_MAX_ATTEMPTS = 2

/**
 * 构造 HTML 代码组件生成子 agent(规划 + 执行,代码作为 data 资产,vfs 作工作副本,默认带格式校验链)。
 * 单模式(breaking major):代码进 data.code 字段(不再 codeRef 引用);框架自动 checkout/commit 透明搬运。
 * @returns 标准 SubagentConfig,集成方塞 createChatSdk({ subagents:[createHtmlSubagent({writablePaths})] }) → 主 agent 获得 use_<id> 委派工具。
 */
export function createHtmlSubagent(options: CreateHtmlSubagentOptions): SubagentConfig {
  const {
    writablePaths, codeVfsPrefix = 'html/', id = 'html', description, planning = true,
    summarization = true, maxToolRounds = 12, temperature = 0.4, skills, extraTools,
    formatCheck = true, codeField = 'code', orchestratorPrompt = true,
  } = options
  if (!writablePaths?.length) {
    throw new Error('[page-agent-sdk][createHtmlSubagent] writablePaths 必填(代码组件 data 区,如 ["components"])')
  }
  const ext = 'html'
  const middleware: Middleware[] = []
  if (planning) middleware.push(createTodosMiddleware())   // write_todos / update_todo(规划)
  // 格式校验链:validate_code 工具(自主自检)+ verify beforeReturn 门禁(确定性兜底)
  if (formatCheck) {
    middleware.push(createHtmlValidateToolsMiddleware(codeVfsPrefix))
    middleware.push(createVerifyMiddleware({ check: createHtmlFormatCheck({ vfsPrefix: codeVfsPrefix }) }))
  }
  // 注意:checkout/commit 钩子不由本工厂装(createChatSdk 装配期识别 _codeAsset 标记后追加 ——
  //   钩子需访问主 dataOpsController + vfsStore,本工厂调用时集成商尚未传 data,故延迟到装配期)
  const tools = extraTools ?? []
  return {
    id,
    description: description ?? '生成/修改纯代码组件(custom 代码)。代码作为 data 资产(code 字段进 DB),vfs 作工作副本;能规划(write_todos)+ 执行。需写代码组件或灵活定制时委派',
    systemPrompt: htmlSystemPrompt(codeVfsPrefix),
    writablePaths,                                           // 写 data(code + 元信息,path guard)
    allowedTools: ['vfs_write', 'vfs_edit', 'vfs_rm', 'vfs_grep', 'vfs_read'],  // 代码工作副本 写/改/删/搜/读
    middleware: middleware.length ? middleware : undefined,  // 装 todos 规划 + 格式校验链(架构扩展)
    summarization: summarization === false ? undefined : summarization,  // 默认开跨轮压缩(架构扩展)
    maxVerifyAttempts: formatCheck ? FORMAT_CHECK_MAX_ATTEMPTS : undefined,  // verify 门禁自纠上限(beforeReturn)
    temperature,
    skills: skills ?? [htmlFragmentSkill],  // 内置完整 HTML 生成规范 skill
    maxToolRounds,
    tools: tools.length ? tools : undefined,
    // 框架内部标记:createChatSdk 装配期识别 → 注入 checkout/commit 钩子 + pgIdPaths + largeTextPaths + 强制 vfs
    _codeAsset: { writablePaths, codeVfsPrefix, ext, codeField, ...(orchestratorPrompt ? { orchestratorPrompt: htmlOrchestratorPrompt(id) } : {}) },
  }
}
