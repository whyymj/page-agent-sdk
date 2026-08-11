// HTML 页面生成 demo(createHtmlSubagent codeKind:'html'):
// 子 agent 生成 v-html 注入用的 HTML 片段(无 html/head/body 外围)→ vfs → 本 demo 实时 v-html 渲染预览
import { createApp } from 'vue'
import App from './App.vue'
import '../_shared/theme.css'

createApp(App).mount('#app')
