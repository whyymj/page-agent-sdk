/**
 * section-orchestrator initialPage 双臂 fixture(section-orchestrator 真 LLM 门禁专用)
 *
 * 形态:**无 code 字段的 schema 副本**(sections 数组纯 JSON 字段,防 CUSTOM_CODE_DELEGATION /
 * 自动 html 子 agent 干扰归因 —— 双臂唯一变量 = 欠委派 nudge + 分段编排段是否装配)。
 * 预置 16 个骨架板块(现有组件触达口径:measureWriteScale 只计已有节点,新增不计),
 * 任务 = 全量填充改造 → invoke 内累计触达 ≥ DELEGATE_NUDGE_THRESHOLD(12)。
 *
 * 双臂经 URL 参数切换:
 *   ?arm=grind  → capabilities.subagent=false(零委派能力,nudge/编排段不装配,flash 只能硬干)
 *   ?arm=nudge  → 默认全开(spawn_agent 在场;nudge advisory + 数据规模编排段注入)
 *
 * 仅测试 fixture,不入 npm 包(tests/ 不在 files)。凭据只经 .env 注入 import.meta.env。
 */
import { z } from 'zod'
import { reactive } from 'vue'
import { createChatSdk } from '../../../src/core'

const arm = new URLSearchParams(location.search).get('arm') === 'grind' ? 'grind' : 'nudge'

const sectionSchema = z.object({
  id: z.string().describe('板块 id,固定不变'),
  name: z.string().describe('板块名(有吸引力的中文标题)'),
  kind: z.enum(['banner', 'grid', 'carousel', 'list', 'video']).describe('板块呈现形态'),
  summary: z.string().describe('板块内容摘要,20-40 字'),
  tags: z.array(z.string()).describe('板块标签,3-5 个'),
})
const pageSchema = z.object({
  title: z.string().describe('页面标题'),
  sections: z.array(sectionSchema).describe('页面板块列表'),
})

// 16 个骨架板块(「现有组件」:填充/改造即触达现有节点,新增不计 —— 恰为 nudge 量纲主形态)
const pageBind = reactive({
  title: '618 好物大促(骨架)',
  sections: Array.from({ length: 16 }, (_, i) => ({
    id: `sec-${i}`,
    name: `板块${i}`,
    kind: 'grid',
    summary: '待填充',
    tags: [] as string[],
  })),
})

const agent = createChatSdk({
  id: `section-fixture-${arm}`,
  llm: {
    apiKey: import.meta.env.VITE_AI_API_KEY,
    baseUrl: import.meta.env.VITE_AI_BASE_URL,
    model: import.meta.env.VITE_AI_MODEL,
  },
  systemPrompt:
    '你是页面搭建助手,负责把 618 大促专题的骨架板块填充成真实运营内容(品类:服饰/数码/家居/美妆/食品/母婴/运动/图书等)。',
  maxToolRounds: 30,
  storage: 'memory',
  // grind 臂唯一变量:关子 agent 能力 → 委派工具不在场、nudge/编排段不装配(dataOps+useSubagent 相与条件失效)
  ...(arm === 'grind' ? { capabilities: { subagent: false } } : {}),
  data: {
    schema: pageSchema,
    bind: pageBind,
    description: '618 大促专题页(sections 为纯 JSON 板块,无代码字段)',
  },
  dialog: { title: `section 双臂 fixture(${arm})` },
})
agent.mount('#chat-root')

// 真 LLM 脚本采样口(与各 demo 同款约定;不承载业务)
;(window as unknown as Record<string, unknown>).__sdk = agent
;(window as unknown as Record<string, unknown>).__arm = arm
;(window as unknown as Record<string, unknown>).__page = pageBind
