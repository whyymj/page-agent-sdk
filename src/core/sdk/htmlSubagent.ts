/**
 * Pack 2:HTML 代码组件生成子 agent 工厂(createHtmlSubagent)
 *
 * 构造代码组件生成子 agent(规划 + 执行)—— 装 todos 中间件获规划能力 + 经 writablePaths 获写权限 +
 * 代码正文写 vfs(主 data 只存 codeRef 引用,精简)+ 内置 systemPrompt + skill。
 * 返回标准 SubagentConfig,集成方塞 createChatSdk({ subagents:[createHtmlSubagent({writablePaths})] })
 * → 主 agent 自动获得 use_html 委派工具。
 *
 * 代码存储模式(§0.4):代码正文(Vue SFC)→ vfs(html/<name>.vue,会话级);data → {type:'custom', codeRef, name, props}。
 * 主 data 精简、代码改 vfs_edit 增量(data 引用不变)、会话级非长期。集成方渲染层按 codeRef 从 vfs 读。
 *
 * 输出格式校验(formatCheck,默认开):
 *  - validate_code 工具:子 agent 生成/修改代码后自主调用自检(标签闭合 + v-html 片段契约),报错即用 vfs_edit 修
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

export interface CreateHtmlSubagentOptions {
  /** 可写 data 路径前缀(写 codeRef + 元信息;如 ['components']);write/set 经 path guard 越界 PATH_OUT_OF_SCOPE */
  writablePaths: string[]
  /** 代码正文存 vfs 的路径前缀;默认 'html/'(代码文件 html/<name>.vue) */
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
  /** 默认按 codeKind 装内置 skill(sfc→html-builder / html→html-fragment);集成方可追加或替换 */
  skills?: SkillSpec[]
  /** 额外工具(直接进子 agent 工具池) */
  extraTools?: StructuredToolInterface[]
  /**
   * 代码形态:
   * - 'sfc'(默认):Vue SFC(.vue;集成方渲染层挂载渲染)
   * - 'html':纯 HTML 片段(.html;v-html 等注入场景 —— 无 html/head/body/DOCTYPE 外围、无 <script>)
   */
  codeKind?: 'sfc' | 'html'
  /**
   * 输出格式校验(标签闭合 + 片段契约);默认 true:
   * - 装 validate_code 工具(子 agent 自主自检)+ verify beforeReturn 门禁(返回前扫 vfs 代码文件,maxVerifyAttempts 2 自纠兜底)
   * - false 关闭(不装校验链,零开销)
   */
  formatCheck?: boolean
}

// ===== HTML systemPrompt(注入 codeVfsPrefix,引导代码→vfs) =====

function htmlSystemPrompt(prefix: string, kind: 'sfc' | 'html'): string {
  const ext = kind === 'html' ? 'html' : 'vue'
  const kindRules = kind === 'html'
    ? `- 输出纯 HTML 片段(.${ext}):结构 + 内联 <style>(class 加统一前缀防样式冲突);交互交给宿主(不写 JS)
- 单根元素包裹(如 <section class="...">…</section>),语义化标签`
    : `- 输出 Vue SFC(.${ext}):<template> + <script setup>(组合式),defineProps 接外部数据
- 只渲染 UI,不做副作用(不发请求 / 不读写 storage)`
  return `你是纯代码组件生成专家。可用工具:vfs_write / vfs_edit / vfs_rm(写/改/删代码到 vfs ${prefix}) / vfs_grep + vfs_read(读 vfs) / validate_code(代码格式自检) / write + set(写 data 引用,writablePaths 限定) / read / write_todos + update_todo(规划)。

代码存储约定(重要):
- 代码正文写 vfs:${prefix}<name>.${ext}(如 ${prefix}hero.${ext})
- data 存引用:write({ patch:{ op:'set', jsonPath:'components.N', value:{ type:'custom', codeRef:'vfs://${prefix}<name>.${ext}', name, props } } })
- 改代码:先 vfs_edit 局部改 vfs 文件(工具返回替换结果;data 的 codeRef 引用不变,无需改 data)

代码形态规则:
${kindRules}

输出契约(必须):
- 渲染产物经 v-html 等方式注入宿主页面:不要 <!DOCTYPE>,不要 <html>/<head>/<body> 外围标签,只输出内容片段本身
- 非 SFC 块不要 <script>(注入场景不执行脚本,且有安全风险);不引入外部脚本 / CDN

工作方式:
1. 中等任务(多组件 / 大段代码)先 write_todos 拆解:读现有结构 → 规划各组件 → 逐个生成 → read 确认;
2. 遵循已加载 skill 的规范(安全底线 / 可访问性 / 组件库引用);
3. 小段代码 vfs_write 整体写;大段用 vfs_edit 增量拼(避免单次输出超限);
4. 生成/修改完成后必须调 validate_code 自检(标签闭合 + 片段契约),报错用 vfs_edit 修正后复查,直到通过;
5. 最后 read(vfs 文件 + data 引用)确认结构正确;只写 writablePaths 内 data + ${prefix} 下 vfs。`
}

// ===== 内置 skill(sfc 形态 = html-builder / html 片段形态 = html-fragment) =====

const HTML_BUILDER_SKILL_DOC = `# 纯代码组件生成规范

## 代码存储约定(重要)
- 代码正文写 vfs:html/<name>.vue(如 html/hero.vue)
- data 存引用:{ type:'custom', codeRef:'vfs://html/<name>.vue', name, props }
- 改代码:vfs_edit 局部改 vfs 文件(data 的 codeRef 引用不变)

## 何时写代码组件
- 组件库无对应类型(高度定制交互 / 一次性特效 / 特殊布局)→ 写 custom 代码组件
- 组件库已有(按钮 / 卡片 / 列表)→ 用现有组件配置,不重造

## Vue SFC 规范
- Vue 3 <template> + <script setup>(组合式)
- props 用 defineProps;事件用 defineEmits
- 只渲染 UI,不做副作用(不发请求 / 不读写 storage)

## 输出契约(必须)
- 渲染产物经 v-html 等方式注入宿主:<template> 内不要 <!DOCTYPE> / <html> / <head> / <body> 外围标签,只输出内容片段
- <template> 内不写 <script>;不引入外部脚本 / CDN
- 每次生成/修改后调 validate_code 自检,报错修正直到通过

## props 定义
- 代码组件 defineProps 接受外部 data 传入(集成方渲染时按 data 的 props 字段传)

## 组件库引用
- 代码内可 import 组件库组件(如 <Button>);所用依赖以集成方渲染层已注入为准,不重复造

## 安全底线(必须)
- 禁 eval / new Function / Function 构造器
- 禁访问 window 敏感属性(document.cookie / apiKey / token)
- 不引入外部脚本 / CDN

## 可访问性 + 语义化
- 语义化标签(button / nav / section);图片 alt;交互可键盘聚焦
- 颜色对比达标;不只用颜色传达信息`

const HTML_FRAGMENT_SKILL_DOC = `# HTML 片段生成规范

## 代码存储约定(重要)
- 代码正文写 vfs:html/<name>.html(如 html/landing.html)
- data 存引用:{ type:'custom', codeRef:'vfs://html/<name>.html', name, props }
- 改代码:vfs_edit 局部改 vfs 文件(data 的 codeRef 引用不变)

## 输出契约(必须)
- 输出经 v-html 注入宿主的 HTML 片段:不要 <!DOCTYPE>,不要 <html> / <head> / <body> 外围标签
- 单根元素包裹(如 <section class="hero">…</section>)
- 不写 <script>(v-html 注入不执行脚本);交互交宿主页面已有机制
- 样式用片段内 <style>,class 统一加前缀防冲突(如 .pg-hero-…)
- 不引入外部脚本 / CDN / 外链样式

## 标签闭合(必须)
- 非自闭合标签必须成对闭合(<img> / <br> / <input> 等 void 元素除外)
- 每次生成/修改后调 validate_code 自检,报错用 vfs_edit 修正直到通过

## 何时写代码组件
- 组件库无对应类型(高度定制布局 / 一次性专题页 / 特殊视觉效果)→ 写 HTML 片段
- 组件库已有(按钮 / 卡片 / 列表)→ 用现有组件配置,不重造

## 安全底线(必须)
- 禁 eval / new Function / Function 构造器
- 禁访问 window 敏感属性(document.cookie / apiKey / token)
- 不引入外部脚本 / CDN

## 可访问性 + 语义化
- 语义化标签(button / nav / section);图片 alt;交互可键盘聚焦
- 颜色对比达标;不只用颜色传达信息`

/** 内置 html-builder skill(Vue SFC 生成规范);codeKind:'sfc'(默认)时装进子 agent。getContent 返回全文(不依赖外部文件) */
export const htmlBuilderSkill: SkillSpec = {
  name: 'html-builder',
  description: '纯代码组件(custom Vue SFC)生成规范:代码存 vfs+data 引用 / SFC 规范 / 输出契约 / props / 组件库引用 / 可访问性',
  getContent: () => HTML_BUILDER_SKILL_DOC,
}

/** 内置 html-fragment skill(纯 HTML 片段生成规范);codeKind:'html' 时装进子 agent(v-html 注入场景) */
export const htmlFragmentSkill: SkillSpec = {
  name: 'html-fragment',
  description: '纯 HTML 片段(v-html 注入)生成规范:无外围标签 / 单根元素 / 标签闭合 / validate_code 自检 / 安全底线 / 可访问性',
  getContent: () => HTML_FRAGMENT_SKILL_DOC,
}

// ===== 格式校验链(validate_code 工具 + verify beforeReturn 门禁) =====

export interface HtmlFormatCheckOptions {
  /** vfs 代码路径前缀(与 createHtmlSubagent 的 codeVfsPrefix 一致);默认 'html/' */
  vfsPrefix?: string
}

/**
 * 创建 HTML 格式 verify check(beforeReturn 门禁):扫 state.files 中 vfsPrefix 下全部代码文件,
 * 任一文件有格式问题(标签未闭合 / 片段契约违背)→ ok:false + 可操作 feedback 回灌自纠。
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
      const issues = validateHtmlFormat(f.content, { sfc: path.endsWith('.vue') })
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
 * validate_code({ path?, content? }):content 优先(直接校验);否则按 path 读 vfs;都省略 = 校验 vfsPrefix 下全部文件。
 */
function createHtmlValidateToolsMiddleware(vfsPrefix: string): Middleware {
  let filesRef: Record<string, VfsFile> | undefined
  const validateCode = tool(
    async ({ path, content }) => {
      const targets: Array<{ path: string; content: string }> = []
      if (content !== undefined) {
        targets.push({ path: path ?? '(传入内容)', content })
      } else if (path) {
        const key = path.replace(/^\/+/, '')
        const f = filesRef?.[key]
        if (!f) return `未找到 vfs 文件 "${path}"。先 vfs_ls 查看;代码须写在 ${vfsPrefix} 下。`
        targets.push({ path: key, content: f.content })
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
        const issues = validateHtmlFormat(t.content, { sfc: t.path.endsWith('.vue') })
        if (issues.length) {
          problems.push(`${t.path}:\n${issues.map((it) => `  第 ${it.line} 行 ${it.message}(${it.code})`).join('\n')}`)
        }
      }
      if (problems.length) {
        return `❌ 格式校验未通过:\n${problems.join('\n')}\n请用 vfs_edit 修正后重新调用 validate_code 复查。`
      }
      return `✅ 格式校验通过(${targets.map((t) => t.path).join(', ')}:标签闭合、片段契约)。`
    },
    {
      name: 'validate_code',
      description: '校验 HTML/Vue SFC 代码格式(标签闭合 + v-html 片段契约:无 html/head/body/DOCTYPE 外围、片段无 script)。生成/修改代码后必调;报错修正后复查直到通过。',
      schema: z.object({
        path: z.string().optional().describe('vfs 代码文件路径(如 html/hero.vue);省略则校验代码前缀下全部文件'),
        content: z.string().optional().describe('直接校验的代码内容(优先于 path)'),
      }),
    },
  )
  return {
    name: 'html-validate-tools',
    // vfs 桥接后 state.files 指向主 vfsStore.files(vfs-bridge 先序执行);捕获引用供 validate_code 读取
    beforeAgent: (state) => { filesRef = state.files },
    tools: [validateCode],
  }
}

// ===== 工厂 =====

/** formatCheck 开启时子 agent beforeReturn 自纠上限(与主 verify 默认一致) */
const FORMAT_CHECK_MAX_ATTEMPTS = 2

/**
 * 构造 HTML 代码组件生成子 agent(规划 + 执行,代码→vfs,默认带格式校验链)。
 * @returns 标准 SubagentConfig,集成方塞 createChatSdk({ subagents:[createHtmlSubagent({writablePaths})] }) → 主 agent 获得 use_<id> 委派工具。
 */
export function createHtmlSubagent(options: CreateHtmlSubagentOptions): SubagentConfig {
  const {
    writablePaths, codeVfsPrefix = 'html/', id = 'html', description, planning = true,
    summarization = true, maxToolRounds = 12, temperature = 0.4, skills, extraTools,
    codeKind = 'sfc', formatCheck = true,
  } = options
  if (!writablePaths?.length) {
    throw new Error('[page-agent-sdk][createHtmlSubagent] writablePaths 必填(代码组件 data 区,如 ["components"])')
  }
  const middleware: Middleware[] = []
  if (planning) middleware.push(createTodosMiddleware())   // write_todos / update_todo(规划)
  // 格式校验链:validate_code 工具(自主自检)+ verify beforeReturn 门禁(确定性兜底)
  if (formatCheck) {
    middleware.push(createHtmlValidateToolsMiddleware(codeVfsPrefix))
    middleware.push(createVerifyMiddleware({ check: createHtmlFormatCheck({ vfsPrefix: codeVfsPrefix }) }))
  }
  const tools = extraTools ?? []
  return {
    id,
    description: description ?? '生成/修改纯代码组件(custom 代码)。代码写 vfs,data 存引用;能规划(write_todos)+ 执行。需写代码组件或灵活定制时委派',
    systemPrompt: htmlSystemPrompt(codeVfsPrefix, codeKind),
    writablePaths,                                           // 写 data(codeRef + 元信息,path guard)
    allowedTools: ['vfs_write', 'vfs_edit', 'vfs_rm', 'vfs_grep', 'vfs_read'],  // 代码文件 写/改/删/搜/读
    middleware: middleware.length ? middleware : undefined,  // 装 todos 规划 + 格式校验链(架构扩展)
    summarization: summarization === false ? undefined : summarization,  // 默认开跨轮压缩(架构扩展)
    maxVerifyAttempts: formatCheck ? FORMAT_CHECK_MAX_ATTEMPTS : undefined,  // verify 门禁自纠上限(beforeReturn)
    temperature,
    skills: skills ?? (codeKind === 'html' ? [htmlFragmentSkill] : [htmlBuilderSkill]),  // 按代码形态装内置 skill
    maxToolRounds,
    tools: tools.length ? tools : undefined,
  }
}
