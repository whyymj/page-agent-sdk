<script setup lang="ts">
/**
 * i18n 演示:dialog.locale='en-US' 切英文包 + dialog.messages 键级覆盖(状态标签「成功」→「Done ✓」)。
 * zh-CN 缺省行为见其余 demo(零变化)。
 */
import { onMounted, onUnmounted } from 'vue'
import { createChatSdk, z, type ChatSdk } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

let agent: ChatSdk | null = null

onMounted(() => {
  agent = createChatSdk({
    id: 'i18n-demo',
    container: '#chat-root',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    storage: 'memory',
    data: {
      schema: z.object({ title: z.string().describe('Page title'), theme: z.enum(['light', 'dark']).describe('Theme') }),
      bind: { title: 'i18n Demo', theme: 'dark' },
      description: 'demo page data',
    },
    dialog: {
      locale: 'en-US',
      messages: { statusDone: 'Done ✓' },   // 键级覆盖优先于 locale 包(「成功」→ Done ✓)
      title: 'Page Agent',                   // 显式 title 优先于语言包缺省
    },
  })
  agent.mount()
})
onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="page">
    <h1>i18n demo</h1>
    <p><code>dialog.locale: 'en-US'</code> switches the built-in dialog to the English pack (title/placeholder/status/confirm bars/focus bar…), and <code>dialog.messages</code> overrides individual strings key-by-key.</p>
    <section id="chat-root" class="chat-mount"></section>
  </div>
</template>

<style scoped>
.page { max-width: 800px; margin: 80px auto 0; padding: 0 20px; font-family: system-ui, sans-serif; color: var(--ark-fg); }
h1 { font-size: 24px; margin-bottom: 12px; }
p { line-height: 1.6; color: var(--ark-muted); margin-bottom: 8px; }
.chat-mount { margin-top: 24px; height: 600px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; overflow: hidden; }
.chat-mount > :deep(.chat-dialog) { width: 100%; height: 100%; }
</style>
