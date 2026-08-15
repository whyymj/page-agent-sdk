// 用途:RAG 异步文档集成 —— memory 支持异步函数,演示四种 RAG/MCP 形态:
//   A) 异步加载小文档注入 memory + 切换知识库(setMemory/refreshMemory)
//   B) createRagSubagent 检索子 agent(mock retriever,独立上下文按需检索)
//   C) 检索子 agent + 真实 MCP 服务(retriever 包远程 rag_search;.env 配 VITE_RAG_MCP_URL 启用)
//   D) MCP 直连(原 mcp-demo 合并):主 agent 经 mcp:[] 直连,工具直接注入主工具池
//      (.env 配 VITE_RAG_MCP_URL 为真实知识库;未配连本地 mock,须先 npm run mcp:mock)
import { createApp } from 'vue'
import App from './App.vue'
import '../_shared/theme.css'

createApp(App).mount('#app')
