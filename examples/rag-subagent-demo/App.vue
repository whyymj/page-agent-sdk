<script setup lang="ts">
/**
 * RAG 子 agent demo —— 对照 rag-demo(memory 异步模式):
 *
 *   rag-demo:memory 异步注入文档进主 systemPrompt(文档常驻主上下文)
 *   本 demo:createRagSubagent 配置检索子 agent(独立上下文,主调 use_rag 时按需检索,只回结论)
 *
 * 适用:大文档库 / 按需查(文档不全部进主上下文,省 token + 不爆窗口)。
 * 本 demo retriever 为关键词匹配 mock(无真实向量库依赖);实际替换为 vectorDB.search(embed(query))。
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { createChatSdk, createRagSubagent, type ChatSdk, type RagHit } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

let agent: ChatSdk | null = null

// 三个 mock 知识库(实际用 fetch('/kb/faq.md') 等替换;此处内联无依赖)
const KB = {
  faq: `## 产品 FAQ
- 价格:基础版 ¥99/月,专业版 ¥299/月,企业版联系销售
- 退款:购买 7 天内无理由退款,联系 support@example.com
- 限制:基础版最多 3 个项目,专业版不限
- 数据导出:支持 JSON / CSV 导出,在「设置 → 数据」操作`,
  product: `## 产品规格 v2
- 型号:PageAgent Pro
- CPU:8 核 / 内存 16GB / 存储 512GB SSD
- 接口:HDMI 2.1 × 2,USB-C × 3,千兆网口
- 系统:预装 Agent OS 2.0,支持远程升级`,
  guide: `## 使用指南
- 首次开机:长按电源键 3 秒,指示灯变绿后松手
- 连接网络:设置 → 网络 → 选择 WiFi → 输入密码
- 绑定账号:打开「我的 → 绑定」,扫码登录
- 故障排查:指示灯红色 = 过热,请关机冷却后重启`,
}

// 最近一次检索命中(可视化;RAG 子 agent 的 search_docs 返回文本,经 subagent 事件转发到主)
const lastSearchResult = ref('')

/**
 * 模拟向量检索(实际替换为:const hits = await vectorDB.search(await embed(query), { k: topK }))
 * 策略:按 query 关键词匹配 KB 文档行;无命中兜底返回全部(小 demo 保证有结果)。
 */
async function retriever(query: string, opts?: { topK?: number }): Promise<RagHit[]> {
  await new Promise((r) => setTimeout(r, 200)) // 模拟检索延迟
  const topK = opts?.topK ?? 3
  const hits: RagHit[] = []
  for (const [name, content] of Object.entries(KB)) {
    const lines = content.split('\n').filter((l) => l.trim())
    // query 分词(长 query 按空格,短 query 整串);匹配文档行
    const kws = query.length > 4 ? query.split(/\s+/).filter(Boolean) : [query]
    const matched = lines.filter((l) => kws.some((kw) => kw && l.includes(kw)))
    if (matched.length) hits.push({ content: matched.join('\n'), source: `KB/${name}`, score: matched.length })
  }
  const sorted = hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, topK)
  // 兜底:无命中返回全部(小 demo;实际可返回空让子 agent 换词重试)
  return sorted.length
    ? sorted
    : Object.entries(KB).slice(0, topK).map(([n, c]) => ({ content: c, source: `KB/${n}`, score: 0 }))
}

onMounted(() => {
  agent = createChatSdk({
    id: 'rag-subagent-demo',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    systemPrompt:
      '你是知识库问答助手。需要查阅文档时调 use_rag({task:"..."}) 委派检索子 agent,据其返回的结论作答;结论要标注来源。资料未覆盖就说「知识库中未提及」。',
    storage: 'memory',
    // ★ 关键:子 agent 是配置(SubagentConfig),塞 subagents;不需单独 create/mount
    subagents: [
      createRagSubagent({ retriever, useVfs: false }), // 检索子 agent(独立上下文,主调 use_rag 时 spawn)
    ],
    dialog: {
      title: 'RAG 子 agent 问答',
      placeholder: '问产品问题(主 agent 会调 use_rag 检索 KB)…',
    },
  })

  // hook:捕获 RAG 子 agent 的 search_docs 结果(经 subagent 事件转发到主),可视化检索命中
  agent.hook((e) => {
    const ev = e as any
    if (ev.type === 'subagent' && ev.kind === 'tool_result' && ev.name === 'search_docs') {
      lastSearchResult.value = ev.result || ''
    }
  })

  agent.mount('#chat-root')
})

onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="page">
    <h1>RAG 子 agent 问答(createRagSubagent)</h1>
    <p>
      对照 <code>rag-demo</code>(memory 模式):本 demo 用 <code>createRagSubagent({{ '{ retriever }' }})</code> 配置检索子
      agent。主 agent 调 <code>use_rag</code> 时,子 agent 在<strong>独立上下文</strong>检索 KB,只把结论回主(文档不占主上下文)。
    </p>

    <details class="kb-preview">
      <summary>知识库内容(faq / product / guide)</summary>
      <pre>{{ Object.entries(KB).map(([n, c]) => `--- ${n} ---\n${c}`).join('\n\n') }}</pre>
    </details>

    <details class="hits-preview" v-if="lastSearchResult">
      <summary>最近一次检索命中(RAG 子 agent 的 search_docs 返回)</summary>
      <pre>{{ lastSearchResult }}</pre>
    </details>

    <section id="chat-root" class="chat-mount"></section>
  </div>
</template>

<style scoped>
.page {
  max-width: 800px;
  margin: 80px auto 0;
  padding: 0 20px;
  font-family: system-ui, sans-serif;
  color: var(--ark-fg);
}
h1 {
  font-size: 24px;
  margin-bottom: 12px;
}
p {
  line-height: 1.6;
  color: var(--ark-muted);
  margin-bottom: 16px;
}
p code {
  background: var(--ark-panel);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--ark-fg);
}
.kb-preview,
.hits-preview {
  margin-bottom: 12px;
}
.kb-preview summary,
.hits-preview summary {
  cursor: pointer;
  font-size: 13px;
  color: var(--ark-muted);
}
.kb-preview pre,
.hits-preview pre {
  margin-top: 8px;
  padding: 12px;
  background: var(--ark-bg);
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  max-height: 220px;
  overflow-y: auto;
  color: var(--ark-fg);
}
.chat-mount {
  margin-top: 24px;
  height: 600px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  overflow: hidden;
}
.chat-mount > :deep(.chat-dialog) {
  width: 100%;
  height: 100%;
}
</style>
