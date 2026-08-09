<script setup lang="ts">
/**
 * 自定义对话框 demo —— 演示 chatdialog-component-split 的 sections 区块显隐控制。
 *
 * dialog.sections: { footer: false, queued: false } 关闭输入区(footer)与排队区(queued):
 *   适合只读展示 / 嵌入式信息查询 / 头部+消息区单独复用等场景。
 * 默认不传 sections = 全开(向后兼容,与拆分前行为一致)。
 * slot 替换某块 / L2 完全自建根组件(provide ctx + 自由拼原子)见 doc/usage-guide。
 */
import { onMounted, onUnmounted, ref, reactive } from 'vue'
import { createChatSdk, type ChatSdk } from '../../src/core'
import { z } from 'zod'
import DevNav from '../_shared/DevNav.vue'

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

const schema = z.object({
  title: z.string().describe('页面标题'),
  content: z.string().describe('正文内容'),
})
const data = reactive({ title: '自定义对话框 Demo', content: '右侧 ChatDialog 关闭了 footer(输入区)与 queued(排队区)' })

onMounted(() => {
  agent = createChatSdk({
    container: root.value!,
    id: 'custom-dialog-demo',
    storage: 'memory',
    llm: { apiKey: 'sk-mock', baseUrl: 'http://localhost/mock', model: 'glm-5.2' },
    data: { schema, bind: data },
    dialog: {
      title: '自定义(sections 关 footer/queued)',
      // chatdialog-component-split:sections 区块显隐(键=false 关闭整块含 slot);默认全开
      sections: { footer: false, queued: false },
    },
  })
  agent.mount()
})
onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="layout">
    <aside class="pane">
      <h1>{{ data.title }}</h1>
      <p>{{ data.content }}</p>
      <p class="hint">sections: { footer: false, queued: false } —— 右侧只保留 header(标题/更多菜单)+ body(消息列表),无输入区与排队区。</p>
      <p class="hint">可用的 9 个区块键:header / focus / body / queued / approval / conflict / footer / debug / skill。</p>
    </aside>
    <section ref="root" class="pane pane-right"></section>
  </div>
</template>

<style scoped>
.layout { display: flex; width: 100vw; height: 100vh; overflow: hidden; }
.pane { flex: 1; padding: 20px; overflow: auto; }
.pane-right { width: 50%; flex: 1; border-left: 1px solid #e5e7eb; }
.pane-right > :deep(.chat-dialog) { width: 100%; height: 100%; }
.hint { color: #6b7280; font-size: 13px; margin-top: 12px; line-height: 1.6; }
</style>
