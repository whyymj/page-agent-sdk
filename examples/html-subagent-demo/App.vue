<script setup lang="ts">
/**
 * HTML 代码组件生成子 agent demo(createHtmlSubagent 单模式 code-as-data-asset):
 *
 * - 主 data:components 数组(custom 代码组件 code 字段存 SFC 代码正文 = 资产源)
 * - createHtmlSubagent 配置代码生成子 agent(规划 + 代码作为 data 资产 + vfs 工作副本 + 限定写)
 * - 主 agent 调 use_html 委派 → 子 agent 新建 write components.N {code}(框架补 __pgId)/ 修改经 vfs_edit 工作副本(框架 checkout/commit)
 *
 * 关键:代码作为 data 资产(进服务端 DB),vfs 作编辑工作副本(框架自动 checkout/commit,主 agent 透明)。
 * 渲染层(集成方契约):遇 type:'custom' 读 data.code 渲染 SFC(本 demo 不渲染动态 SFC,聚焦展示「代码作为 data 资产」数据流)。
 */
import { reactive, computed, onMounted, onUnmounted } from 'vue'
import { createChatSdk, createHtmlSubagent, type ChatSdk } from '../../src/core'
import { z } from 'zod'
import DevNav from '../_shared/DevNav.vue'

let agent: ChatSdk | null = null

// 主 data schema:components 数组,custom 类型代码组件(code 字段存 SFC 代码正文 = 资产)
// __pgId 框架无感注入(schema 不声明);code 是资产,随 data json 持久化
const pageSchema = z.object({
  title: z.string().describe('页面标题'),
  components: z
    .array(
      z.object({
        type: z.string().describe('组件类型;custom = 纯代码组件'),
        name: z.string().optional().describe('组件名(如 countdown)'),
        code: z.string().optional().describe('custom 组件的 Vue SFC 代码正文(资产,随 data json 持久化)'),
        props: z.record(z.any()).optional().describe('组件 props'),
      }),
    )
    .describe('页面组件列表(支持 custom 代码组件)'),
})
const pageBind = reactive({ title: '代码组件演示页', components: [] as any[] })

// 当前选中的代码组件(展示其 SFC 代码 = data.code 资产)
const codeComp = computed(() => pageBind.components.find((c: any) => c.type === 'custom' && typeof c.code === 'string' && c.code.length > 0) ?? null)

onMounted(() => {
  agent = createChatSdk({
    id: 'html-subagent-demo',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    systemPrompt:
      '你是页面搭建助手。组件库覆盖不到的灵活需求(定制交互/特殊布局/一次性特效),委派 use_html 子 agent 生成代码组件(custom Vue SFC,代码作为 data 资产存 components[].code);已有组件用配置,不重造。',
    storage: 'memory',
    data: { schema: pageSchema, bind: pageBind, description: '页面(components 支持 custom 代码组件;code 字段是资产)' },
    // ★ 单模式(code-as-data-asset):代码作 data.code 资产,vfs 作工作副本,框架自动 checkout/commit
    subagents: [createHtmlSubagent({ writablePaths: ['components'] })],
    dialog: {
      title: 'HTML 代码组件生成(代码作 data 资产)',
      placeholder: '让 agent 写代码组件(如「写一个倒计时弹窗」「加个抽奖转盘」)…',
    },
  })

  agent.mount('#chat-root')
})

onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="page">
    <h1>HTML 代码组件生成子 agent(单模式:代码作 data 资产)</h1>
    <p>
      组件库覆盖不到的需求,主 agent 调 <code>use_html</code> 委派子 agent:规划(<code>write_todos</code>)→ 代码作为
      <strong>data 资产</strong>存 <code>components[].code</code>(Vue SFC,进服务端 DB)。<strong>vfs 作工作副本</strong>(框架自动
      checkout/commit,主 agent 透明);修改经 <code>vfs_edit</code> 增量改工作副本,框架回写 data.code。
    </p>

    <div class="cols">
      <div class="col">
        <h3>主 data:components({{ pageBind.components.length }})</h3>
        <p class="hint">custom 组件 code 字段存 SFC 代码正文(资产);__pgId 框架无感注入(组件映射键)</p>
        <pre>{{ JSON.stringify(pageBind.components, null, 2) }}</pre>
      </div>
      <div class="col">
        <h3>SFC 代码预览(data.code 资产)</h3>
        <p class="hint">custom 组件的 Vue SFC 代码正文(资产源;集成方渲染层据此挂载渲染)</p>
        <pre v-if="codeComp">{{ codeComp.code }}</pre>
        <p v-else class="empty">(尚未生成代码;发消息如「写一个倒计时组件」触发 use_html)</p>
      </div>
    </div>

    <section id="chat-root" class="chat-mount"></section>
  </div>
</template>

<style scoped>
.page {
  max-width: 1000px;
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
.cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  margin-bottom: 16px;
}
.col {
  background: var(--ark-panel);
  border-radius: 8px;
  padding: 12px;
  min-width: 0;
}
.col h3 {
  font-size: 14px;
  margin-bottom: 4px;
}
.hint {
  font-size: 12px;
  color: var(--ark-muted);
  margin-bottom: 8px;
}
.col pre {
  margin: 0;
  padding: 10px;
  background: var(--ark-bg);
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  max-height: 260px;
  overflow-y: auto;
  color: var(--ark-fg);
}
.empty {
  font-size: 12px;
  color: var(--ark-muted);
  font-style: italic;
}
.chat-mount {
  margin-top: 8px;
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
