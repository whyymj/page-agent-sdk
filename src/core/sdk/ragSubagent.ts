/**
 * Pack 1:RAG 检索子 agent 工厂(createRagSubagent)
 *
 * 构造多源知识检索子 agent —— 集成方按需配知识源(语义检索 retriever / 异步加载 loader / vfs 搜索),
 * SDK 装备对应工具(search_docs / load_doc / 主 vfs 工具)+ 内置 RAG systemPrompt + rag-search skill。
 * 返回标准 SubagentConfig,集成方塞 createChatSdk({ subagents:[createRagSubagent({...})] }) → 主 agent 自动获得 use_rag 委派工具。
 *
 * 框架无关 + 注入式:retriever / loader 集成方实现(接向量库/embedding API/全文检索/远程 API),SDK 零数据源依赖。
 * 工具式:retriever/loader 包成子 agent 工具,子 agent 自主多轮检索(非 SDK 调一次塞结果)。
 */
import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { SubagentConfig } from '../harness/subagent'
import type { SkillSpec } from '../harness/skills'
import { markWatchdogTools } from '../harness/toolWatchdog'

// ===== 类型 =====

/** 单条检索命中(retriever / loader 返回) */
export interface RagHit {
  /** 命中内容片段(文档正文 / 字段说明 / UI 规范段落) */
  content: string
  /** 来源标识(文档标题 / URL / path),供子 agent 标注引用,便于溯源 */
  source?: string
  /** 相关性分数(可选,排序用;不参与逻辑) */
  score?: number
}

/** retriever 调用选项 */
export interface RagRetrieveOptions {
  /** 期望召回数量(覆盖工厂默认 topK) */
  topK?: number
}

/**
 * 语义检索函数 —— 集成方注入,接自己的数据后端。SDK 零依赖(不绑定向量库 / embedding API / 全文检索)。
 * 实现示例:向量库 / 全文检索 / 混合 / 远程 API。
 */
export type RagRetriever = (query: string, opts?: RagRetrieveOptions) => Promise<RagHit[]>

/** 异步文档加载器:给定 source(文档 id/URL/key)加载单份或多份;集成方接文档源(API/DB/对象存储) */
export type RagLoader = (source: string) => Promise<RagHit | RagHit[]>

export interface CreateRagSubagentOptions {
  /** 语义检索函数(可选,装 search_docs 工具) */
  retriever?: RagRetriever
  /** 异步文档加载器(可选,装 load_doc 工具) */
  loader?: RagLoader
  /** 装 vfs 搜索工具(vfs_grep/vfs_read/vfs_json_read,搜集成方注入 vfs 的文档);默认 true(主开 vfs 时) */
  useVfs?: boolean
  /** 子 agent 标识,生成委派工具 use_<id>;默认 'rag' */
  id?: string
  /** 委派工具描述(主 agent 据此判断何时委派;默认通用 RAG 描述) */
  description?: string
  /** 单次检索默认召回数(子 agent 未显式传 topK 时用);默认 5 */
  topK?: number
  /** 子 agent 检索工具名;默认 'search_docs' */
  searchToolName?: string
  /** 子 agent 加载工具名;默认 'load_doc' */
  loadToolName?: string
  /** 子 agent 最大工具轮次(够多轮检索 + 综合);默认 8 */
  maxToolRounds?: number
  /** 跨轮压缩(复杂多轮检索累积时开);默认不开(短任务 offload 兜底够)。true=索引摘要(零 LLM),或 SummarizationOptions 自配 */
  summarization?: boolean | import('../harness/summarization').SummarizationOptions
  /** 默认 [内置 ragSearchSkill];集成方可追加或替换 */
  skills?: SkillSpec[]
  /** 额外工具(直接进子 agent 工具池) */
  extraTools?: StructuredToolInterface[]
}

// ===== RAG systemPrompt(多源检索引导;按实际配置的知识源动态生成) =====

/**
 * 按实际知识源拼 prompt(rag-real-llm 修复:提示词与工具面一致)。
 * 修前是静态全文,无论配没配都教「先 vfs_grep → search_docs → load_doc」——
 * useVfs:false / 未配 loader 的场景下子 agent 没有这些工具,LLM 照 prompt 调用不存在
 * 的工具反复纠结,烧掉大量轮次才收口(实测 B 模式问「方舟是啥」浪费多轮)。
 */
function buildRagSystemPrompt(hasVfs: boolean, hasRetriever: boolean, hasLoader: boolean, searchName: string, loadName: string): string {
  const sources: string[] = []
  if (hasVfs) sources.push('vfs_grep + vfs_read(搜预注入文档)')
  if (hasRetriever) sources.push(`${searchName}(语义检索)`)
  if (hasLoader) sources.push(`${loadName}(按 source 加载)`)
  sources.push('fetch_document(公网 URL)')
  const order: string[] = []
  if (hasVfs) order.push(`先 vfs_grep 搜预注入文档(快、静态)`)
  if (hasRetriever && hasVfs) order.push(`不够用 ${searchName} 语义检索`)
  else if (hasRetriever) order.push(`用 ${searchName} 语义检索(换不同关键词可多次调用)`)
  if (hasLoader) order.push(`需特定文档用 ${loadName}`)
  order.push('公网用 fetch_document')
  return `你是知识检索专家。可用工具:${sources.join(' / ')}。

工作方式:
1. 分析任务,拆出需查证的要点(如:需要哪些组件、各自的 props 约束、UI 规范要求);
2. 多源检索:${order.join(' → ')};
3. 检索结果不足时换关键词、扩大 topK、或换源重试;
4. 综合成结构化、可执行结论(不堆原文,提炼成可直接用于决策/配置的信息);
5. 标注关键信息来源(文档名/段落),便于溯源;检索不到明确说「未检索到」,不编造。

你是只读检索角色,不要尝试修改任何数据。不要尝试上面未列出的工具。`
}

// ===== rag-search skill(工厂默认装;文案按实际知识源动态生成) =====

/** 按实际知识源拼 skill 全文(同 buildRagSystemPrompt 的一致性修复:只提子 agent 真有的工具) */
function buildRagSkillDoc(hasVfs: boolean, hasRetriever: boolean, hasLoader: boolean, searchName: string, loadName: string): string {
  const tree: string[] = []
  const when: string[] = []
  if (hasVfs) {
    tree.push('- vfs_grep / vfs_read:搜集成方预注入 vfs 的文档(组件文档 / UI 规范)—— 快、静态,先查')
    when.push('- 静态文档(组件库文档 / UI 规范):vfs_grep')
  }
  if (hasRetriever) {
    tree.push(`- ${searchName}:语义检索(retriever 向量库)—— 模糊匹配,关键词不确定 / 语义相似时用`)
    when.push(`- 语义相似(「瀑布流组件」「倒计时」「拼团」):${searchName}`)
  }
  if (hasLoader) {
    tree.push(`- ${loadName}:按 source 精确加载(已知文档 id / URL / key)—— 精确取特定文档`)
    when.push(`- 已知文档 id / URL:${loadName}`)
  }
  tree.push('- fetch_document:公网 URL —— 查公开资料')
  when.push('- 公开 URL(设计规范网站 / 第三方文档):fetch_document')
  return `# 知识检索策略(RAG)

## 多源决策树
${tree.join('\n')}

## 综合规范
- 多源交叉验证(关键结论优先 ≥2 源印证,或单一权威源)
- 标注来源(文档名 / URL / 段落),便于溯源
- 结构化、可执行结论(组件清单 + 各自 props 约束 + 适用场景),不堆原文
- 未检索到明确说「未检索到」,不编造;建议替代方案(改关键词 / 建议写代码组件等)
- 只用上面列出的工具,其他工具不可用(调了只会浪费轮次)

## 何时用何源
${when.join('\n')}`
}

/**
 * 内置 rag-search skill(多源检索策略);createRagSubagent 默认装进子 agent。
 * getContent 返回全文(不依赖外部文件)。**静态导出版 = 全源形态**(vfs+retriever+loader 全开),
 * 供集成方参考/复用;工厂实际装的是按配置裁剪的动态版(buildRagSkillDoc)。
 */
export const ragSearchSkill: SkillSpec = {
  name: 'rag-search',
  description: '多源知识检索策略:vfs 预注入文档 → 语义检索 → 指定文档加载 → 公网;综合结构化结论 + 溯源',
  getContent: () => buildRagSkillDoc(true, true, true, 'search_docs', 'load_doc'),
}

// ===== 工具壳 =====

/** 把 retriever 包成 search_docs 工具;retriever 抛错 try/catch 降级为错误字符串回灌(换关键词重试,不崩) */
function buildSearchTool(name: string, retriever: RagRetriever, defaultTopK: number): StructuredToolInterface {
  const t = tool(
    async ({ query, topK }) => {
      try {
        const hits = await retriever(query, { topK: topK ?? defaultTopK })
        if (!hits?.length) return `未检索到与「${query}」相关的内容。可换关键词或扩大 topK 重试。`
        return hits.map((h, i) => `【${i + 1}】${h.source ? `来源:${h.source}\n` : ''}${h.content}`).join('\n\n')
      } catch (e) {
        return `检索出错:${(e as Error).message}。可换关键词重试。`
      }
    },
    {
      name,
      description: '语义检索知识库(组件文档/UI 规范/业务规则等),返回相关片段。需要查阅文档才能回答或配置时用;可多次调用不同关键词。',
      schema: z.object({
        query: z.string().describe('检索关键词或自然语言问题'),
        topK: z.number().int().positive().optional().describe('期望召回数量(默认使用系统配置)'),
      }),
    },
  )
  // per-tool 看门狗(flow-robustness P0#1):retriever 是集成方实现(接向量库/远程 API),永不 settle 时兜底
  markWatchdogTools([t])
  return t
}

/** 把 loader 包成 load_doc 工具;loader 抛错降级(换 source 重试) */
function buildLoadTool(name: string, loader: RagLoader): StructuredToolInterface {
  const t = tool(
    async ({ source }) => {
      try {
        const res = await loader(source)
        const hits = Array.isArray(res) ? res : [res]
        if (!hits.length) return `未加载到「${source}」。检查 source 是否正确。`
        return hits.map((h, i) => `【${i + 1}】${h.source ? `来源:${h.source}\n` : ''}${h.content}`).join('\n\n')
      } catch (e) {
        return `加载出错:${(e as Error).message}。`
      }
    },
    {
      name,
      description: '按 source 加载指定文档(文档 id/URL/key);已知要查的具体文档用此工具精确加载。',
      schema: z.object({ source: z.string().describe('文档标识(id/URL/key)') }),
    },
  )
  // per-tool 看门狗:loader 同为集成方实现,同 search 工具口径打标
  markWatchdogTools([t])
  return t
}

// ===== 工厂 =====

/**
 * 构造 RAG 检索子 agent。
 * @returns 标准 SubagentConfig,集成方塞 createChatSdk({ subagents:[createRagSubagent({retriever})] }) → 主 agent 获得 use_<id> 委派工具。
 */
export function createRagSubagent(options: CreateRagSubagentOptions): SubagentConfig {
  const {
    retriever, loader, useVfs = true, id = 'rag', description, topK = 5,
    searchToolName = 'search_docs', loadToolName = 'load_doc', maxToolRounds = 8,
    summarization, skills, extraTools,
  } = options
  if (!retriever && !loader && useVfs === false) {
    throw new Error('[page-agent-sdk][createRagSubagent] 至少配一种知识源:retriever / loader / useVfs(true)')
  }
  const tools: StructuredToolInterface[] = []
  if (retriever) tools.push(buildSearchTool(searchToolName, retriever, topK))
  if (loader) tools.push(buildLoadTool(loadToolName, loader))
  if (extraTools) tools.push(...extraTools)
  const allowedTools = useVfs ? ['vfs_grep', 'vfs_read', 'vfs_json_read'] : undefined
  // prompt/skill 按实际知识源动态生成(提示词与工具面一致:没配的源不提,防 LLM 调不存在的工具烧轮次)
  const systemPrompt = buildRagSystemPrompt(useVfs, !!retriever, !!loader, searchToolName, loadToolName)
  const dynamicSkill: SkillSpec = {
    name: 'rag-search',
    description: ragSearchSkill.description,
    getContent: () => buildRagSkillDoc(useVfs, !!retriever, !!loader, searchToolName, loadToolName),
  }
  return {
    id,
    description: description ?? '检索知识库(组件文档/UI 规范/业务规则),返回有依据的结构化结论。需要查阅文档才能回答或决定如何配置时委派',
    systemPrompt,
    tools: tools.length ? tools : undefined,        // → extraTools(子 agent 专属)
    allowedTools,                                     // → 拿主 vfs 工具(架构扩展)
    skills: skills ?? [dynamicSkill],                // 默认装内置 rag-search skill(按配置裁剪)
    maxToolRounds,
    ...(summarization !== undefined ? { summarization } : {}),
  }
}
