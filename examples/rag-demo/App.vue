<script setup lang="ts">
/**
 * RAG demo(双模式对照,原 rag-demo + rag-subagent-demo 合并):
 *
 *   A. memory 模式(默认):memory 传异步函数,首次对话前后台加载知识库文档,注入主 systemPrompt(文档常驻主上下文)
 *      —— 适合小文档库 / 每轮都要用的资料;演示 setMemory 切库 + refreshMemory 强刷
 *   B. 子 agent 模式:createRagSubagent 配置检索子 agent(独立上下文,主调 use_rag 按需检索,只回结论)
 *      —— 适合大文档库 / 按需查(文档不占主上下文,省 token + 不爆窗口)
 *
 * 顶部切模式 = unmount + 重建 agent(两种模式的配置面完全不同)。
 * LLM 走 Anthropic 原生协议(provider:'anthropic',动态 import @langchain/anthropic),网关为 modelverse。
 * 知识库文档为内联 mock(无真实 fetch 依赖),实际使用时替换为 fetch('/kb/xxx.md');
 * B 模式 retriever 为关键词匹配 mock(无真实向量库依赖),实际替换为 vectorDB.search(embed(query))。
 */
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { createChatSdk, createRagSubagent, type ChatSdk, type RagHit } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

// 三个 mock 知识库(两模式共享;实际用 fetch('/kb/faq.md') 等替换)
const KB = {
  faq: `## 产品 FAQ
- 价格:基础版 ¥99/月,专业版 ¥299/月,企业版联系销售
- 退款:购买 7 天内无理由退款,联系 support@example.com
- 限制:基础版最多 3 个项目,专业版不限
- 数据导出:支持 JSON / CSV 导出,在「设置 → 数据」操作`,
  product: `## 产品规格 v2
- 型号:PageAgent Pro
- CPU:8 核 / 内存 16GB / 存储 512GB SSD
- 接口:HDMI 2.1 × 2,USB-C 3,千兆网口
- 系统:预装 Agent OS 2.0,支持远程升级`,
  guide: `## 使用指南
- 首次开机:长按电源键 3 秒,指示灯变绿后松手
- 连接网络:设置 → 网络 → 选择 WiFi → 输入密码
- 绑定账号:打开「我的 → 绑定」,扫码登录
- 故障排查:指示灯红色 = 过热,请关机冷却后重启`,
}

// ===== 模式切换 =====
type RagMode = 'memory' | 'subagent'
const mode = ref<RagMode>('memory')

// ===== memory 模式状态 =====
const currentKb = ref<keyof typeof KB>('faq')
const loadStatus = ref<'loading' | 'ready' | 'error'>('loading')
const lastLoaded = ref('')

// ===== 子 agent 模式状态 =====
const lastSearchResult = ref('')

// 模拟异步加载(实际替换为 fetch)
function loadKb(name: keyof typeof KB): () => Promise<string> {
  return async () => {
    await new Promise((r) => setTimeout(r, 400)) // 模拟网络延迟
    return KB[name]
  }
}

/**
 * 模拟向量检索(B 模式;实际替换为:const hits = await vectorDB.search(await embed(query), { k: topK }))
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

/** 按当前模式创建 agent(两模式配置面完全不同:memory vs subagents) */
function buildAgent(): ChatSdk {
  // Anthropic 协议(modelverse 网关):provider:'anthropic' 动态加载 @langchain/anthropic,
  // SDK 在 baseUrl 后拼 /v1/messages 发 Claude 原生协议请求。
  // 凭据走 .env(VITE_ANTHROPIC_*,不进代码/仓库;模板见 .env.example)
  const llm = {
    provider: 'anthropic',
    apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY,
    // baseUrl 必须是绝对 URL(@anthropic-ai/sdk buildURL 直接 new URL(baseURL+path),相对路径抛 Invalid URL)。
    // dev 走 vite 同源代理(vite.config.ts server.proxy:/llm → https://api.modelverse.cn):
    // modelverse preflight 拒绝 SDK 自动附加的 x-stainless-* 遥测头,浏览器直连被 CORS 挡;
    // 生产环境直连经 VITE_ANTHROPIC_BASE_URL 配 https://api.modelverse.cn/
    baseUrl: import.meta.env.VITE_ANTHROPIC_BASE_URL || `${location.origin}/llm`,
    model: import.meta.env.VITE_ANTHROPIC_MODEL || 'deepseek-v4-flash',
    // 低于 MIN_CONTEXT_WINDOW(200K)启动即 throw,故显式声明窗口与最大输出
    contextWindow: 200000,
    maxOutputTokens: 8192,
  }
  if (mode.value === 'memory') {
    return createChatSdk({
      id: 'rag-demo',
      llm,
      systemPrompt:
        '你是知识库问答助手。只依据 memory 中的资料作答,资料未覆盖就说「知识库中未提及」。回答时引用资料来源段落。',
      storage: 'memory',
      // memory 传异步函数:后台预求值,首次对话前尽量就绪
      memory: async () => {
        loadStatus.value = 'loading'
        try {
          const text = await loadKb(currentKb.value)()
          lastLoaded.value = text
          loadStatus.value = 'ready'
          return text
        } catch (e) {
          loadStatus.value = 'error'
          return ''
        }
      },
      dialog: {
        title: 'RAG 知识库问答(memory 模式)',
        placeholder: '问我关于产品的问题...',
      },
    })
  }
  const a = createChatSdk({
    id: 'rag-demo-sub',
    llm,
    systemPrompt:
      '你是知识库问答助手。需要查阅文档时调 use_rag({task:"..."}) 委派检索子 agent,据其返回的结论作答;结论要标注来源。资料未覆盖就说「知识库中未提及」。',
    storage: 'memory',
    // ★ 关键:子 agent 是配置(SubagentConfig),塞 subagents;不需单独 create/mount
    subagents: [
      createRagSubagent({ retriever, useVfs: false }), // 检索子 agent(独立上下文,主调 use_rag 时 spawn)
    ],
    dialog: {
      title: 'RAG 子 agent 问答(subagent 模式)',
      placeholder: '问产品问题(主 agent 会调 use_rag 检索 KB)…',
    },
  })
  // hook:捕获 RAG 子 agent 的 search_docs 结果(经 subagent 事件转发到主),可视化检索命中
  a.hook((e) => {
    const ev = e as any
    if (ev.type === 'subagent' && ev.kind === 'tool_result' && ev.name === 'search_docs') {
      lastSearchResult.value = ev.result || ''
    }
  })
  return a
}

/** 重建 agent(切模式 / 首次挂载):unmount 旧的 → 挂新的到 #chat-root */
async function rebuild() {
  agent?.unmount()
  agent = null
  await nextTick() // 等 DOM 里 #chat-root 重新渲染(v-if 切换面板)
  const el = document.getElementById('chat-root')
  if (!el) return
  agent = buildAgent()
  agent.mount(el)
}

// 切模式 → 重建(两模式配置面不同,不能运行时切换)
watch(mode, () => void rebuild())

onMounted(() => void rebuild())
onUnmounted(() => agent?.unmount())

function switchKb(name: keyof typeof KB) {
  currentKb.value = name
  // setMemory 传新的异步函数:清缓存 + 后台重新求值
  agent?.setMemory(loadKb(name))
  // 也可显式 await refresh 强制刷新(此处后台触发即可,UI 状态由 memory 函数内部更新)
  void agent?.refreshMemory().then((text) => {
    lastLoaded.value = text
    loadStatus.value = 'ready'
  })
  loadStatus.value = 'loading'
}
</script>

<template>
  <DevNav />
  <div class="page">
    <h1>RAG 知识库问答(双模式对照)</h1>

    <div class="mode-switcher">
      <span class="label">模式:</span>
      <button :class="['mode-btn', { active: mode === 'memory' }]" @click="mode = 'memory'">
        A · memory 异步注入
      </button>
      <button :class="['mode-btn', { active: mode === 'subagent' }]" @click="mode = 'subagent'">
        B · createRagSubagent 检索
      </button>
      <span class="mode-hint">
        {{ mode === 'memory'
          ? '文档常驻主上下文 —— 适合小文档库 / 每轮都要用的资料'
          : '独立上下文按需检索,只回结论 —— 适合大文档库(文档不占主上下文)' }}
      </span>
    </div>

    <template v-if="mode === 'memory'">
      <p>memory 支持异步函数:首次对话前后台加载知识库,加载完成后 agent 自动可用。</p>

      <div class="kb-switcher">
        <span class="label">当前知识库:</span>
        <button
          v-for="name in (['faq', 'product', 'guide'] as const)"
          :key="name"
          :class="['kb-btn', { active: currentKb === name }]"
          @click="switchKb(name)"
        >
          {{ name }}
        </button>
        <span class="status" :data-status="loadStatus">
          {{ loadStatus === 'loading' ? '加载中…' : loadStatus === 'ready' ? '已就绪' : '加载失败' }}
        </span>
      </div>

      <details class="kb-preview">
        <summary>查看当前 memory 内容(已加载的文档)</summary>
        <pre>{{ lastLoaded || '(尚未加载)' }}</pre>
      </details>
    </template>

    <template v-else>
      <p>
        用 <code>createRagSubagent({{ '{ retriever }' }})</code> 配置检索子 agent。主 agent 调 <code>use_rag</code>
        时,子 agent 在<strong>独立上下文</strong>检索 KB,只把结论回主(文档不占主上下文)。
      </p>

      <details class="kb-preview">
        <summary>知识库内容(faq / product / guide)</summary>
        <pre>{{ Object.entries(KB).map(([n, c]) => `--- ${n} ---\n${c}`).join('\n\n') }}</pre>
      </details>

      <details class="hits-preview" v-if="lastSearchResult">
        <summary>最近一次检索命中(RAG 子 agent 的 search_docs 返回)</summary>
        <pre>{{ lastSearchResult }}</pre>
      </details>
    </template>

    <!-- :key=mode:切模式时 Vue 重建全新容器节点(旧 app 随旧节点销毁),避免双 app 挂同容器冲突 -->
    <section :key="mode" id="chat-root" ref="root" class="chat-mount"></section>
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
.mode-switcher {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
  padding: 10px 12px;
  background: var(--ark-panel);
  border-radius: 8px;
}
.mode-btn {
  padding: 6px 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--ark-bg);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: var(--ark-fg);
}
.mode-btn.active {
  background: var(--ark-accent);
  color: #fff;
  border-color: var(--ark-accent);
}
.mode-hint {
  font-size: 12px;
  color: var(--ark-muted);
}
.kb-switcher {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.label {
  font-size: 14px;
  color: var(--ark-muted);
}
.kb-btn {
  padding: 4px 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: var(--ark-panel);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: var(--ark-fg);
}
.kb-btn.active {
  background: var(--ark-accent);
  color: #fff;
  border-color: var(--ark-accent);
}
.status {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  background: var(--ark-panel);
  color: var(--ark-muted);
}
.status[data-status='ready'] {
  color: #16a34a;
  background: #dcfce7;
}
.status[data-status='loading'] {
  color: #2563eb;
  background: #dbeafe;
}
.status[data-status='error'] {
  color: #dc2626;
  background: #fee2e2;
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
  max-height: 200px;
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
