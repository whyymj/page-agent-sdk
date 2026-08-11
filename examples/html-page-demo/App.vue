<script setup lang="ts">
/**
 * HTML 页面生成 demo(createHtmlSubagent codeKind:'html'):
 *
 * - 子 agent 生成 v-html 注入用的 HTML 片段(无 <html>/<head>/<body>/DOCTYPE 外围,片段禁 <script>)
 * - 代码正文写 vfs(html/<name>.html),data 只存 codeRef 引用
 * - 格式校验链(formatCheck 默认开):validate_code 自检工具 + verify beforeReturn 门禁(回灌自纠)
 * - 本 demo hook 子 agent 的 vfs_write/vfs_edit 事件维护本地代码副本 → v-html 实时渲染预览
 */
import { reactive, ref, computed, onMounted, onUnmounted } from 'vue'
import { createChatSdk, createHtmlSubagent, type ChatSdk } from '../../src/core'
import { z } from 'zod'
import DevNav from '../_shared/DevNav.vue'

let agent: ChatSdk | null = null

// 主 data schema:components 数组(custom 代码组件存 codeRef 引用 vfs 代码)
const pageSchema = z.object({
  title: z.string().describe('页面标题'),
  components: z
    .array(
      z.object({
        type: z.string().describe('组件类型;custom = 代码组件'),
        name: z.string().optional().describe('组件名(如 landing)'),
        codeRef: z.string().optional().describe('custom 组件的 vfs 代码引用,如 vfs://html/landing.html'),
        props: z.record(z.any()).optional().describe('组件 props'),
      }),
    )
    .describe('页面组件列表'),
})
const pageBind = reactive({ title: 'HTML 页面生成演示', components: [] as any[] })

// 本地代码副本(hook 子 agent vfs_write/vfs_edit 维护;预览渲染用)
const codeFiles = ref<Record<string, string>>({})
// validate_code 最近结果(✅/❌ 状态展示)
const validateStatus = ref('')

const previewPath = computed(() => Object.keys(codeFiles.value).find((p) => p.endsWith('.html')) ?? '')
const previewHtml = computed(() => (previewPath.value ? codeFiles.value[previewPath.value] : ''))
const previewSource = computed(() => (previewPath.value ? codeFiles.value[previewPath.value] : ''))

onMounted(() => {
  agent = createChatSdk({
    id: 'html-page-demo',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    systemPrompt:
      '你是页面搭建助手。用户要定制页面/区块(专题页/落地页/活动区块)时,委派 use_html 子 agent 生成 HTML 片段代码(v-html 注入,代码存 vfs);生成后告知用户预览区已实时更新。',
    storage: 'memory',
    data: { schema: pageSchema, bind: pageBind, description: '页面(components 支持 custom 代码组件)' },
    // ★ codeKind:'html':生成 v-html 注入的 HTML 片段(非 SFC);formatCheck 默认开(自检工具 + 门禁自纠)
    subagents: [createHtmlSubagent({ writablePaths: ['components'], codeKind: 'html' })],
    dialog: {
      title: 'HTML 页面生成(v-html 注入)',
      placeholder: '让 agent 生成页面(如「生成一个产品落地页」)…',
    },
  })

  // hook:捕获子 agent 的 vfs 写操作 + validate_code 结果
  agent.hook((e) => {
    const ev = e as any
    if (ev.type !== 'subagent') return
    if (ev.kind === 'tool_call' && ev.name === 'vfs_write' && ev.args?.path) {
      codeFiles.value[ev.args.path] = ev.args.content ?? ''
    } else if (ev.kind === 'tool_call' && ev.name === 'vfs_edit' && ev.args?.path) {
      const cur = codeFiles.value[ev.args.path]
      if (cur && typeof ev.args.oldString === 'string') {
        codeFiles.value[ev.args.path] = cur.replace(ev.args.oldString, ev.args.newString ?? '')
      }
    } else if (ev.kind === 'tool_result' && ev.name === 'validate_code') {
      validateStatus.value = String(ev.result ?? '')
    }
  })

  agent.mount('#chat-root')
})

onUnmounted(() => agent?.unmount())

const SUGGESTIONS = ['生成一个产品落地页', '做一个年货节专题页', '把主色调改成橙色']
function sendSuggestion(text: string) {
  agent?.send(text)
}
</script>

<template>
  <DevNav />
  <div class="page">
    <h1>HTML 页面生成子 agent(codeKind:'html' + v-html 注入)</h1>
    <p>
      主 agent 调 <code>use_html</code> 委派子 agent 生成 <strong>HTML 片段</strong>(无
      <code>&lt;html&gt;/&lt;head&gt;/&lt;body&gt;</code> 外围、禁 <code>&lt;script&gt;</code>),代码写 vfs,左侧预览区经
      <strong>v-html</strong> 实时渲染。格式校验链:<code>validate_code</code> 自检工具 + verify 门禁(不通过回灌自纠)。
    </p>
    <div class="suggestions">
      <button v-for="s in SUGGESTIONS" :key="s" class="chip" @click="sendSuggestion(s)">{{ s }}</button>
    </div>

    <div class="cols">
      <div class="col preview-col">
        <h3>实时预览(v-html 渲染)</h3>
        <p class="hint">
          {{ previewPath ? `来源:${previewPath}` : '尚无代码;点上方建议或发消息触发 use_html' }}
          <span v-if="validateStatus" class="validate" :class="validateStatus.includes('✅') ? 'ok' : 'bad'">
            {{ validateStatus.includes('✅') ? '✅ 格式校验通过' : '❌ 校验有问题(自纠中)' }}
          </span>
        </p>
        <div class="preview" v-html="previewHtml"></div>
        <details class="code-view" v-if="previewSource">
          <summary>查看代码片段</summary>
          <pre>{{ previewSource }}</pre>
        </details>
      </div>
      <div class="col">
        <h3>主 data:components({{ pageBind.components.length }})</h3>
        <p class="hint">custom 组件只存 codeRef 引用,代码正文在 vfs</p>
        <pre class="data-view">{{ JSON.stringify(pageBind.components, null, 2) }}</pre>
        <section id="chat-root" class="chat-mount"></section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  max-width: 1200px;
  margin: 80px auto 0;
  padding: 0 20px 40px;
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
  margin-bottom: 12px;
}
p code {
  background: var(--ark-panel);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--ark-fg);
}
.suggestions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.chip {
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: var(--ark-panel);
  color: var(--ark-fg);
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
}
.chip:hover {
  border-color: var(--ark-accent);
  color: var(--ark-accent);
}
.cols {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  align-items: start;
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
.validate {
  margin-left: 8px;
  font-size: 12px;
}
.validate.ok {
  color: #4caf50;
}
.validate.bad {
  color: #ff7043;
}
.preview {
  min-height: 240px;
  background: #fff;
  border-radius: 6px;
  padding: 0;
  overflow: auto;
  max-height: 520px;
}
.code-view {
  margin-top: 8px;
}
.code-view summary {
  font-size: 12px;
  color: var(--ark-muted);
  cursor: pointer;
}
.code-view pre,
.data-view {
  margin: 8px 0 0;
  padding: 10px;
  background: var(--ark-bg);
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
  color: var(--ark-fg);
}
.chat-mount {
  margin-top: 12px;
  height: 480px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  overflow: hidden;
}
.chat-mount > :deep(.chat-dialog) {
  width: 100%;
  height: 100%;
}
</style>
