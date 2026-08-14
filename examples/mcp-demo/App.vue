<script setup lang="ts">
/**
 * MCP 集成示例 —— page-agent-sdk 连 MCP server,调用其工具。双模式:
 *
 * A. RAG 知识库模式(.env 配了 VITE_RAG_MCP_URL 时):
 *    连知识库 MCP(地址走 .env,gitignore 不入库),动态注入 rag_search / rag_ask / rag_documents,
 *    问「comp_button 怎么配置跳转链接」「抽奖转盘怎么配置背景图」等 → Agent 检索知识库回答。
 *
 * B. mock 模式(未配置,公开仓库用户默认):
 *    1. npm run mcp:mock → mock MCP server @ http://localhost:3001/mcp
 *    2. npm run dev → 访问 http://localhost:3000/mcp.html
 *    问「北京天气 / 搜索 AI / 算 12*8」→ Agent 调 mock 工具。
 *
 * 打开「日志」→「🧬 Agent 信息」tab 可见 MCP 注入的工具。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { createChatSdk, type ChatSdk } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

// RAG MCP 地址经 .env 注入(gitignore,不进仓库/发布产物);未配置 → mock 模式(公开仓库开箱可跑)
const ragMcpUrl = (import.meta.env.VITE_RAG_MCP_URL as string | undefined)?.trim() || ''
const ragMode = computed(() => !!ragMcpUrl)

onMounted(() => {
  agent = createChatSdk({
    container: root.value!,
    id: 'mcp-demo',
    storage: 'memory',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    ...(ragMode.value
      ? {
          // A. RAG 知识库模式:地址来自 .env(勿硬编码进源码,仓库对外公开)
          mcp: [{ transport: 'http', url: ragMcpUrl, name: 'rag' }],
          systemPrompt:
            '你是「什么值得买·方舟可视化平台」的知识库助手。可调用 MCP 工具:rag_search(检索知识库,返回最相关文档片段及出处)/ rag_ask(直接问知识库拿答案)/ rag_documents(列知识库文档)。用户问组件配置(如 comp_button 怎么配置跳转链接)、运营操作、后台功能等问题时,先检索再回答,答案附出处(docName/breadcrumb);知识库没有的明确说没有,不要编造。',
          dialog: {
            title: 'MCP 集成示例 · RAG 知识库',
            placeholder: '试试:comp_button 怎么配置跳转链接 / 抽奖转盘怎么配置背景图',
          },
        }
      : {
          // B. mock 模式(公开仓库默认;须先 npm run mcp:mock)
          mcp: [{ transport: 'http', url: 'http://localhost:3001/mcp', name: 'mock' }],
          systemPrompt:
            '你可以调用 MCP server(mock)提供的工具:get_weather(查天气)/ search(搜索)/ calc(计算)。用户问相关问题时主动调用对应工具,基于结果回答。',
          dialog: {
            title: 'MCP 集成示例',
            placeholder: '试试:北京天气 / 搜索 AI / 算 12*8',
          },
        }),
    // 默认 true:自定义 systemPrompt 末尾用 '---' 分隔线自动追加 reliableWriteRules(改前先 read、字段以 describe 为准、写错看校验错误重试、优先增量 patch);设 false 关闭;不传 systemPrompt 用默认 prompt 时已内置
    appendReliableWriteRules: true,
    debug: true,
  })
  agent.mount()
})
onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="layout">
    <aside class="pane pane-left">
      <h2>🔌 MCP 集成示例 <span v-if="ragMode" class="tag">RAG 知识库模式</span><span v-else class="tag mock">mock 模式</span></h2>
      <p v-if="ragMode" class="hint">
        已连知识库 MCP(<span class="muted">地址经 <code>.env</code> 的 <code>VITE_RAG_MCP_URL</code> 注入,不进源码</span>),动态注入
        <code>rag_search</code> / <code>rag_ask</code> / <code>rag_documents</code>,Agent 检索知识库回答(附出处)。
      </p>
      <p v-else class="hint">
        page-agent-sdk 连本地 mock MCP server,动态注入其工具(<code>get_weather</code> / <code>search</code> /
        <code>calc</code>),Agent 按需调用。配置 <code>.env</code> 的 <code>VITE_RAG_MCP_URL</code> 可切换为知识库检索模式。
      </p>
      <div v-if="ragMode" class="steps">
        <div class="step">
          <b>① 对话提问</b>
          <span class="muted">问「comp_button 怎么配置跳转链接」「抽奖转盘怎么配置背景图」→ Agent 调 rag_search 检索</span>
        </div>
        <div class="step">
          <b>② 查看注入的工具</b>
          <span class="muted">对话框「日志」→「🧬 Agent 信息」tab → tools 列表含 rag_search / rag_ask / rag_documents</span>
        </div>
      </div>
      <div v-else class="steps">
        <div class="step">
          <b>① 启动 mock MCP server</b>
          <code>npm run mcp:mock</code>
          <span class="muted">→ http://localhost:3001/mcp</span>
        </div>
        <div class="step">
          <b>② 访问本页</b>
          <span class="muted">已在此页(对话框连了 mock server)</span>
        </div>
        <div class="step">
          <b>③ 对话测试</b>
          <span class="muted">问「北京天气」「搜索 AI」「算 12*8」→ 看 Agent 调 MCP 工具</span>
        </div>
        <div class="step">
          <b>④ 查看注入的工具</b>
          <span class="muted">对话框「日志」→「🧬 Agent 信息」tab → tools 列表含 MCP 工具</span>
        </div>
      </div>
      <p v-if="!ragMode" class="try">⚠️ 若工具未注入:确认 <code>npm run mcp:mock</code> 在跑(控制台会有 MCP 连接失败 warn)。</p>
    </aside>
    <section ref="root" class="pane pane-right"></section>
  </div>
</template>

<style scoped>
.layout { display: flex; width: 100vw; height: 100vh; overflow: hidden; }
.pane-left { flex: 1; overflow: auto; background: var(--ark-bg); padding: 28px 32px; color: var(--ark-fg); }
.pane-right { flex: 0 0 460px; border-left: 1px solid rgba(255, 255, 255, 0.06); background: var(--ark-panel); }
.pane-right > :deep(.chat-dialog) { width: 100%; height: 100%; }
h2 { font-size: 20px; margin: 0 0 12px; color: var(--ark-fg); display: flex; align-items: center; gap: 8px; }
.tag { font-size: 11px; font-weight: 500; color: #10b981; border: 1px solid rgba(16, 185, 129, 0.4); padding: 1px 8px; border-radius: 999px; }
.tag.mock { color: var(--ark-muted); border-color: rgba(255, 255, 255, 0.16); }
.hint { font-size: 13px; line-height: 1.7; color: var(--ark-muted); margin: 0 0 16px; }
.hint code { background: rgba(var(--ark-accent-rgb), 0.15); color: var(--ark-fg); padding: 1px 6px; border-radius: 4px; font-size: 12px; }
.steps { display: flex; flex-direction: column; gap: 10px; }
.step { background: var(--ark-panel); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 10px 14px; font-size: 13px; }
.step b { display: block; color: var(--ark-fg); margin-bottom: 4px; }
.step code { display: inline-block; background: var(--ark-bg); color: var(--ark-fg); padding: 4px 10px; border-radius: 6px; font-family: 'SF Mono', Monaco, Consolas, monospace; font-size: 12px; margin: 2px 0; }
.muted { color: var(--ark-muted); font-size: 12px; }
.try { font-size: 12px; color: #92400e; background: #fef3c7; padding: 10px 14px; border-radius: 8px; margin-top: 16px; line-height: 1.6; }
.try code { background: rgba(0,0,0,0.08); padding: 1px 6px; border-radius: 4px; }
</style>
