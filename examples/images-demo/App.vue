<script setup lang="ts">
/**
 * 图片输入 demo(image-input-vision):纯文本主模型 + `images.describe` 识图转述旁路。
 *
 * 三分支(完整说明 doc/usage-guide.md §6.17):
 * ① 主模型多模态(modelCaps.vision=true:gpt-4o/claude/qwen-vl 表命中,或 llm.vision:true 显式声明)
 *    → 零配置,图片组装 content parts 直发(本 demo 换多模态模型名即自动走此路,describe 不触发);
 * ② 主模型纯文本 + images.describe → 发送前逐图转述,文本拼入该轮 user 上下文,图片本体不发给主模型(本 demo 演示);
 * ③ 都不配 → send 拒绝 + 结构化错误(不静默丢图)。
 *
 * describe 是集成方钩子 —— 识图能力归属集成方(自有 vision API / 识图子 agent),SDK 不内置。
 * 本 demo 的实现 = 调「analyze 形态」识图端点:POST {image: <base64>, mime} → {error_code:0, data:{description}}。
 * 端点地址不入库:本地 .env 配 VITE_VISION_URL(见 .env.example);运行时 window.__VISION_CONFIG = { url } 覆盖(浏览器 E2E / 联调)。
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { createChatSdk, type ChatSdk, type AgentImage } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

const root = ref<HTMLElement>()

/** 识图端点地址(__VISION_CONFIG 运行时覆盖优先,便于不依赖 .env 联调;真实地址只进本地 .env,不入库) */
function visionUrl(): string {
  const o = (window as unknown as { __VISION_CONFIG?: { url?: string } }).__VISION_CONFIG ?? {}
  return o.url ?? import.meta.env.VITE_VISION_URL ?? ''
}

let agent: ChatSdk | null = null

onMounted(() => {
  agent = createChatSdk({
    id: 'images-demo',
    container: '#chat-root',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL, // 纯文本主模型即可(deepseek-chat 等);多模态模型则图片直发,describe 不触发
    },
    storage: 'memory',
    debug: true,
    images: {
      // 识图转述旁路:发送前逐图调用,返回文本写 im.description 拼入该轮 user 上下文(随消息持久化,重发不重复转述)
      describe: async (image: AgentImage) => {
        const url = visionUrl()
        if (!url) throw new Error('未配置识图端点:本地 .env 配 VITE_VISION_URL,或运行时 window.__VISION_CONFIG = { url }')
        // dataURI → {base64, mime}(analyze 形态端点收裸 base64,非 dataURI)
        const m = /^data:([^;,]+);base64,(.*)$/s.exec(image.dataUri ?? '')
        if (!m) throw new Error('图片缺 dataUri(无法转 base64)')
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ image: m[2], mime: m[1] }),
        })
        if (!res.ok) throw new Error(`识图端点 HTTP ${res.status}`)
        const data = (await res.json()) as { error_code?: number; error_msg?: string; data?: { description?: string } }
        if (data.error_code !== 0) throw new Error(data.error_msg || `识图端点 error_code ${data.error_code}`)
        return data.data?.description ?? ''
      },
      describeTimeoutMs: 20000,
      // upload: async (dataUri) => (await fetch('/my-oss', { method: 'POST', body: dataUri })).json().url,
      // ↑ 可选:原图上传换 https URL(消息/持久化只存轻 URL,请求不发大 base64;失败自动回退 dataURI 内联,留痕不阻塞)
    },
    dialog: {
      title: '图片输入 · 识图转述',
      placeholder: '粘贴截图 / 拖图进来,或点 📎 选图…',
    },
  })
  agent.mount('#chat-root')
})
onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="page">
    <h1>图片输入(识图转述旁路)</h1>
    <p>主模型是纯文本(如 deepseek-chat)也能「看图」:粘贴/拖入/选择图片后发送,SDK 先调 <code>images.describe</code>(集成方绑定的识图端点)逐图转述,把文字拼进上下文 —— 图片本体不发给主模型。</p>
    <p>若主模型本身多模态(gpt-4o / claude / qwen-vl,或 <code>llm.vision: true</code> 显式声明),则跳过转述直接把图片作为 content parts 发送 —— 同一份配置对两条路自适应。</p>
    <section id="chat-root" ref="root" class="chat-mount"></section>
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
  margin-bottom: 8px;
}
code {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.18);
  font-size: 0.9em;
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
