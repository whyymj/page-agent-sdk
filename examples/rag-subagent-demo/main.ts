// RAG 子 agent demo(对照 rag-demo 的 memory 模式):
// createRagSubagent 配置检索子 agent(独立上下文,按需检索),主 agent 调 use_rag 委派
import { createApp } from 'vue'
import App from './App.vue'
import '../_shared/theme.css'

createApp(App).mount('#app')
