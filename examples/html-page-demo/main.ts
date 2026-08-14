// HTML 页面生成 demo(createHtmlSubagent 单模式 code-as-data-asset):
// 子 agent 生成完整、自包含的 HTML 页面(默认含 style+script)→ 代码作为 data.code 资产 → 本 demo v-html 预览(script 不执行是 demo 限制)
import { createApp } from 'vue'
import App from './App.vue'
import '../_shared/theme.css'

createApp(App).mount('#app')
