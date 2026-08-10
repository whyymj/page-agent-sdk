<script setup lang="ts">
/**
 * HTML 代码组件生成子 agent demo(createHtmlSubagent):
 *
 * - 主 data:components 数组(支持 type:'custom' 代码组件 + codeRef 引用 vfs 代码)
 * - createHtmlSubagent 配置代码生成子 agent(规划 + 代码→vfs + 限定写)
 * - 主 agent 调 use_html 委派 → 子 agent write_todos 规划 → vfs_write 代码(html/<name>.vue)+ write data{codeRef}
 *
 * 关键:代码正文在 vfs(会话级),data 只存 codeRef 引用 → 主 data 精简、代码改 vfs_edit 不动 data。
 * 渲染层(集成方契约):遇 type:'custom' 读 data.codeRef → vfs 取 code → 渲染(本 demo 不渲染动态 SFC,
 *   聚焦展示「代码→vfs + data 引用」数据流;集成方渲染层自行实现)。
 */
import { reactive, ref, onMounted, onUnmounted } from 'vue'
import { createChatSdk, createHtmlSubagent, type ChatSdk } from '../../src/core'
import { z } from 'zod'
import DevNav from '../_shared/DevNav.vue'

let agent: ChatSdk | null = null

// 主 data schema:components 数组,custom 类型代码组件(带 codeRef 引用 vfs 代码)
const pageSchema = z.object({
  title: z.string().describe('页面标题'),
  components: z
    .array(
      z.object({
        type: z.string().describe('组件类型;custom = 纯代码组件'),
        name: z.string().optional().describe('组件名(如 countdown)'),
        codeRef: z
          .string()
          .optional()
          .describe('custom 组件的 vfs 代码引用,如 vfs://html/countdown.vue'),
        props: z.record(z.any()).optional().describe('组件 props'),
      }),
    )
    .describe('页面组件列表(支持 custom 代码组件)'),
})
const pageBind = reactive({ title: '代码组件演示页', components: [] as any[] })

// vfs 代码文件(hook 捕获 HTML 子 agent 的 vfs_write;代码正文在这)
const vfsFiles = ref<Record<string, string>>({})

onMounted(() => {
  agent = createChatSdk({
    id: 'html-subagent-demo',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    systemPrompt:
      '你是页面搭建助手。组件库覆盖不到的灵活需求(定制交互/特殊布局/一次性特效),委派 use_html 子 agent 生成代码组件(custom Vue SFC);已有组件用配置,不重造。',
    storage: 'memory',
    data: { schema: pageSchema, bind: pageBind, description: '页面(components 支持 custom 代码组件)' },
    // ★ 子 agent 是配置(SubagentConfig),塞 subagents;writablePaths 限定写 components 区
    subagents: [createHtmlSubagent({ writablePaths: ['components'] })],
    dialog: {
      title: 'HTML 代码组件生成',
      placeholder: '让 agent 写代码组件(如「写一个倒计时弹窗」「加个抽奖转盘」)…',
    },
  })

  // hook:捕获 HTML 子 agent 的 vfs_write(代码正文写 vfs)→ 可视化代码文件
  agent.hook((e) => {
    const ev = e as any
    if (ev.type === 'subagent' && ev.kind === 'tool_call' && ev.name === 'vfs_write') {
      vfsFiles.value[ev.args?.path] = ev.args?.content
    }
  })

  agent.mount('#chat-root')
})

onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="page">
    <h1>HTML 代码组件生成子 agent(createHtmlSubagent)</h1>
    <p>
      组件库覆盖不到的需求,主 agent 调 <code>use_html</code> 委派子 agent:规划(<code>write_todos</code>)→ 代码写
      <strong>vfs</strong>(<code>html/&lt;name&gt;.vue</code>)→ data 存 <code>codeRef</code> 引用。主 data 精简(代码不塞
      data);代码改 <code>vfs_edit</code> 增量不动 data。
    </p>

    <div class="cols">
      <div class="col">
        <h3>主 data:components({{ pageBind.components.length }})</h3>
        <p class="hint">custom 组件只存 codeRef 引用,代码正文不在这</p>
        <pre>{{ JSON.stringify(pageBind.components, null, 2) }}</pre>
      </div>
      <div class="col">
        <h3>vfs 代码文件({{ Object.keys(vfsFiles).length }})</h3>
        <p class="hint">HTML 子 agent vfs_write 的代码正文(会话级工作区)</p>
        <div v-for="(content, path) in vfsFiles" :key="path" class="vfs-file">
          <div class="vfs-path">📄 {{ path }}</div>
          <pre>{{ content }}</pre>
        </div>
        <p v-if="!Object.keys(vfsFiles).length" class="empty">(尚未写代码;发消息如「写一个倒计时组件」触发 use_html)</p>
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
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 16px;
}
.col {
  background: var(--ark-panel);
  border-radius: 8px;
  padding: 12px;
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
.col pre,
.vfs-file pre {
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
.vfs-file {
  margin-bottom: 10px;
}
.vfs-path {
  font-size: 12px;
  color: var(--ark-accent);
  margin-bottom: 4px;
  font-family: monospace;
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
