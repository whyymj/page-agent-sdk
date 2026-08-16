<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { copyText } from '../utils/clipboard'
import { MESSAGES_ZH_CN, type DialogMessages } from './messages'

const props = withDefaults(defineProps<{
  code: string
  lang: string
  /** 文案集(dialog.locale/messages 解析结果;独立复用缺省中文) */
  messages?: DialogMessages
}>(), {
  messages: () => MESSAGES_ZH_CN,
})

const emit = defineEmits<{ (e: 'close'): void }>()

const iframeRef = ref<HTMLIFrameElement | null>(null)
const mode = ref<'preview' | 'source'>('preview')
const copied = ref(false)

/** 判断是否为可预览的代码类型 */
const isPreviewable = computed(() => {
  const l = props.lang.toLowerCase()
  return ['html', 'htm', 'vue', 'javascript', 'js', 'css'].includes(l)
})

/** 组装可在 iframe 中运行的完整 HTML 文档 */
const previewDoc = computed(() => {
  const l = props.lang.toLowerCase()

  if (l === 'html' || l === 'htm') {
    return props.code
  }

  if (l === 'vue') {
    // 简易 Vue SFC 运行：提取 template/script/style，用 Vue3 全局 API 渲染
    return wrapVueSfc(props.code)
  }

  if (l === 'javascript' || l === 'js') {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:sans-serif;padding:16px}</style></head><body><div id="app"></div><script>${props.code}<\/script></body></html>`
  }

  if (l === 'css') {
    const msg = props.messages
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${props.code}</style></head><body><div class="demo"><h1>${msg.codeDemoTitle}</h1><p>${msg.codeDemoText}</p><button>${msg.codeDemoButton}</button><input placeholder="${msg.codeDemoInput}"/></div></body></html>`
  }

  return props.code
})

/** 将 Vue SFC 转为可在浏览器运行的 HTML（依赖 CDN 的 Vue3 + 运行时编译） */
function wrapVueSfc(source: string): string {
  const escaped = source.replace(/<\/script>/g, '<\\/script>')
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<script src="https://unpkg.com/vue@3/dist/vue.global.js"><\/script>
<script src="https://unpkg.com/@vue/compiler-dom@3/dist/compiler-dom.global.js"><\/script>
<style>body{margin:0;font-family:sans-serif}body>div{padding:16px}</style>
</head><body><div id="app"></div>
<script>
const { createApp, defineComponent } = Vue;
const src = ${JSON.stringify(escaped)};
// 提取三段
function extract(re){const m=src.match(re);return m?m[1]:''}
const template=extract(/<template>([\\s\\S]*?)<\\/template>/);
const scriptContent=extract(/<script>([\\s\\S]*?)<\\/script>/);
const styleContent=extract(/<style[^>]*>([\\s\\S]*?)<\\/style>/);
if(styleContent){const s=document.createElement('style');s.textContent=styleContent;document.head.appendChild(s);}
let options={};
try{ const fn=new Function(scriptContent+';\\nreturn {data:typeof data!=="undefined"?data:()=>({}),methods:typeof methods!=="undefined"?methods:{},computed:typeof computed!=="undefined"?computed:{},mounted:typeof mounted!=="undefined"?mounted:undefined}'); options=fn(); }catch(e){ console.error(e); }
const app=createApp({template:template||'<div></div>',...options});
app.mount('#app');
<\/script></body></html>`
}

watch(
  () => mode.value,
  async () => {
    await nextTick()
    if (mode.value === 'preview' && iframeRef.value) {
      iframeRef.value.srcdoc = previewDoc.value
    }
  },
  { immediate: true }
)

function copyCode() {
  copyText(props.code).then((ok) => {
    if (ok) {
      copied.value = true
      setTimeout(() => (copied.value = false), 1500)
    }
  })
}

function openInNewTab() {
  // 安全(主流程审查 P0-2):新标签页里用 sandbox iframe(无 allow-same-origin)加载预览 ——
  // AI 生成的 HTML 在隔离的不透明 origin 执行,无法访问宿主 cookie/localStorage/SDK 数据;
  // blob URL + noopener 防新标签 window.opener 反写宿主(旧实现裸 blob 同源,等于在宿主 origin 跑 AI HTML = XSS)。
  const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const wrapper =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>代码预览 · ' +
    escAttr(props.lang) +
    '</title><style>html,body{margin:0;height:100%;background:#fff}iframe{border:none;width:100%;height:100%}</style></head><body>' +
    '<iframe sandbox="allow-scripts allow-modals allow-popups allow-forms" srcdoc="' + escAttr(previewDoc.value) + '"></iframe>' +
    '</body></html>'
  const blob = new Blob([wrapper], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
</script>

<template>
  <div class="code-preview-overlay" @click.self="emit('close')">
    <div class="code-preview-modal">
      <div class="preview-header">
        <span class="preview-title">{{ messages.codePreviewTitlePrefix }}{{ lang }}</span>
        <div class="preview-tabs">
          <button :class="{ active: mode === 'preview' }" :disabled="!isPreviewable" @click="mode = 'preview'">{{ messages.codePreviewTab }}</button>
          <button :class="{ active: mode === 'source' }" @click="mode = 'source'">{{ messages.codeSourceTab }}</button>
        </div>
        <div class="preview-actions">
          <button class="icon-btn" :class="{ done: copied }" :title="copied ? messages.copied : messages.codeCopyTitle" @click="copyCode">
            <!-- icon 与 MessageContent 代码工具栏/MessageActions 统一(icon+状态色,不用 emoji) -->
            <svg v-if="copied" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5l3 3 7-7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
            <svg v-else viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.3" /><path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H3.5A1.5 1.5 0 0 0 2 3v5.5A1.5 1.5 0 0 0 3.5 10H4" stroke="currentColor" stroke-width="1.3" /></svg>
          </button>
          <button class="icon-btn" :title="messages.codeOpenTitle" @click="openInNewTab">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6 3H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" /><path d="M9 2.5h4.5V7M13 3l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
          <button class="icon-btn" :title="messages.close" @click="emit('close')">
            <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
          </button>
        </div>
      </div>
      <div class="preview-body">
        <iframe
          v-if="mode === 'preview' && isPreviewable"
          ref="iframeRef"
          class="preview-iframe"
          sandbox="allow-scripts allow-modals allow-popups allow-forms"
          :srcdoc="previewDoc"
        ></iframe>
        <pre v-else class="preview-source"><code>{{ code }}</code></pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.code-preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  padding: 20px;
}

.code-preview-modal {
  width: 90%;
  max-width: 900px;
  height: 80vh;
  background: #fff;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.preview-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: #1f2937;
  color: #fff;
}

.preview-title {
  font-size: 14px;
  font-weight: 600;
}

.preview-tabs {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.preview-tabs button {
  padding: 4px 12px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}

.preview-tabs button.active {
  background: #667eea;
}

.preview-tabs button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.preview-actions {
  display: flex;
  gap: 4px;
}

.icon-btn {
  width: 28px;
  height: 28px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.06);
  color: #e5e7eb;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.icon-btn svg {
  width: 14px;
  height: 14px;
}

.icon-btn:hover {
  border-color: rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.14);
  color: #fff;
}

/* 复制成功态:ok 色(与 MessageContent .code-action-btn.done 一致) */
.icon-btn.done {
  border-color: var(--cs-ok, #16a34a);
  background: rgba(var(--cs-ok-rgb, 22, 163, 74), 0.12);
  color: var(--cs-ok, #16a34a);
  cursor: default;
}

.preview-body {
  flex: 1;
  overflow: hidden;
  background: #f9fafb;
}

.preview-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}

.preview-source {
  margin: 0;
  padding: 16px;
  height: 100%;
  overflow: auto;
  background: #1f2937;
  color: #e5e7eb;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
