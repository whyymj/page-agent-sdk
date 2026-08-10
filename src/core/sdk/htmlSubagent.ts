/**
 * Pack 2:HTML 代码组件生成子 agent 工厂(createHtmlSubagent)
 *
 * 构造代码组件生成子 agent(规划 + 执行)—— 装 todos 中间件获规划能力 + 经 writablePaths 获写权限 +
 * 代码正文写 vfs(主 data 只存 codeRef 引用,精简)+ 内置 HTML systemPrompt + html-builder skill。
 * 返回标准 SubagentConfig,集成方塞 createChatSdk({ subagents:[createHtmlSubagent({writablePaths})] })
 * → 主 agent 自动获得 use_html 委派工具。
 *
 * 代码存储模式(§0.4):代码正文(Vue SFC)→ vfs(html/<name>.vue,会话级);data → {type:'custom', codeRef, name, props}。
 * 主 data 精简、代码改 vfs_edit 增量(data 引用不变)、会话级非长期。集成方渲染层按 codeRef 从 vfs 读。
 */
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { SubagentConfig } from '../harness/subagent'
import type { SkillSpec } from '../harness/skills'
import type { Middleware } from '../harness/middleware'
import type { SummarizationOptions } from '../harness/summarization'
import { createTodosMiddleware } from '../harness/todos'

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
  /** 默认 [内置 htmlBuilderSkill];集成方可追加或替换 */
  skills?: SkillSpec[]
  /** 额外工具(直接进子 agent 工具池) */
  extraTools?: StructuredToolInterface[]
}

// ===== HTML systemPrompt(注入 codeVfsPrefix,引导代码→vfs) =====

function htmlSystemPrompt(prefix: string): string {
  return `你是纯代码组件生成专家。可用工具:vfs_write / vfs_edit / vfs_rm(写/改/删代码到 vfs ${prefix}) / vfs_grep + vfs_read(读 vfs) / write + set(写 data 引用,writablePaths 限定) / read / write_todos + update_todo(规划)。

代码存储约定(重要):
- 代码正文写 vfs:${prefix}<name>.vue(如 ${prefix}hero.vue)
- data 存引用:write({ patch:{ op:'set', jsonPath:'components.N', value:{ type:'custom', codeRef:'vfs://${prefix}<name>.vue', name, props } } })
- 改代码:先 vfs_edit 改 vfs 文件(data 的 codeRef 引用不变,无需改 data)

工作方式:
1. 中等任务(多组件 / 大段代码)先 write_todos 拆解:读现有结构 → 规划各组件 → 逐个生成 → read 确认;
2. 遵循 html-builder skill 规范(SFC 规范 / 安全底线 / 可访问性 / props 定义 / 组件库引用);
3. 小段代码 vfs_write 整体写;大段用 vfs_edit 增量拼(避免单次输出超限);
4. 生成后 read(vfs 文件 + data 引用)确认结构正确;只写 writablePaths 内 data + ${prefix} 下 vfs。`
}

// ===== html-builder skill(工厂默认装) =====

const HTML_BUILDER_SKILL_DOC = `# 纯代码组件生成规范

## 代码存储约定(重要)
- 代码正文写 vfs:html/<name>.vue(如 html/hero.vue)
- data 存引用:{ type:'custom', codeRef:'vfs://html/<name>.vue', name, props }
- 改代码:vfs_edit 改 vfs 文件(data 的 codeRef 引用不变)

## 何时写代码组件
- 组件库无对应类型(高度定制交互 / 一次性特效 / 特殊布局)→ 写 custom 代码组件
- 组件库已有(按钮 / 卡片 / 列表)→ 用现有组件配置,不重造

## Vue SFC 规范
- Vue 3 <template> + <script setup>(组合式)
- props 用 defineProps;事件用 defineEmits
- 只渲染 UI,不做副作用(不发请求 / 不读写 storage)

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

/** 内置 html-builder skill(代码组件生成规范);createHtmlSubagent 默认装进子 agent。getContent 返回全文(不依赖外部文件) */
export const htmlBuilderSkill: SkillSpec = {
  name: 'html-builder',
  description: '纯代码组件(custom Vue SFC)生成规范:代码存 vfs+data 引用 / SFC 规范 / 安全底线 / props / 组件库引用 / 可访问性',
  getContent: () => HTML_BUILDER_SKILL_DOC,
}

// ===== 工厂 =====

/**
 * 构造 HTML 代码组件生成子 agent(规划 + 执行,代码→vfs)。
 * @returns 标准 SubagentConfig,集成方塞 createChatSdk({ subagents:[createHtmlSubagent({writablePaths})] }) → 主 agent 获得 use_<id> 委派工具。
 */
export function createHtmlSubagent(options: CreateHtmlSubagentOptions): SubagentConfig {
  const {
    writablePaths, codeVfsPrefix = 'html/', id = 'html', description, planning = true,
    summarization = true, maxToolRounds = 12, temperature = 0.4, skills, extraTools,
  } = options
  if (!writablePaths?.length) {
    throw new Error('[page-agent-sdk][createHtmlSubagent] writablePaths 必填(代码组件 data 区,如 ["components"])')
  }
  const middleware: Middleware[] = []
  if (planning) middleware.push(createTodosMiddleware())   // write_todos / update_todo(规划)
  const tools = extraTools ?? []
  return {
    id,
    description: description ?? '生成/修改纯代码组件(custom Vue SFC)。代码写 vfs,data 存引用;能规划(write_todos)+ 执行。需写代码组件或灵活定制时委派',
    systemPrompt: htmlSystemPrompt(codeVfsPrefix),
    writablePaths,                                           // 写 data(codeRef + 元信息,path guard)
    allowedTools: ['vfs_write', 'vfs_edit', 'vfs_rm', 'vfs_grep', 'vfs_read'],  // 代码文件 写/改/删/搜/读
    middleware: middleware.length ? middleware : undefined,  // 装 todos 规划(架构扩展)
    summarization: summarization === false ? undefined : summarization,  // 默认开跨轮压缩(架构扩展)
    temperature,
    skills: skills ?? [htmlBuilderSkill],                    // 默认装内置 html-builder skill
    maxToolRounds,
    tools: tools.length ? tools : undefined,
  }
}
