<script setup lang="ts">
/**
 * 最简集成 demo:无 schema / 无 data / 无 approval,纯对话对话框。
 * 适合「我只想给页面加个 AI 对话框,不操作页面数据」的最简场景。
 *
 * 想一步得到「页面搭建」能力?schema 含 code 数组字段时装配期自动注册默认 HTML 子 agent(3.9+,零配置);
 * preset spread 只再补一层场景化身份 prompt:
 *   createChatSdk({ ...presets.pageBuilder, container, llm, data: { schema, bind } })
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { createChatSdk, type ChatSdk } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

// e2e 开关:?quick=1 快捷指令 / ?drop=1 元素拖入 / ?transfer=1 会话导出导入(默认不开,其余 spec 零影响)
const params = new URLSearchParams(location.search)
const quickOn = params.get('quick') === '1'
const dropOn = params.get('drop') === '1'
const transferOn = params.get('transfer') === '1'

onMounted(() => {
  agent = createChatSdk({
    id: 'minimal-demo',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    systemPrompt: '你是一个智能助手,简洁回答用户问题。',
    storage: 'memory',
    dialog: {
      title: '最简 AI 对话框',
      placeholder: '问我任何问题...',
      // 图标自定义(3.17+):局部覆盖默认 emoji(🤖/🧬/🎯/…),未传键用默认;头像两键可换成文本字形。
      // 值也支持 HTML 片段(以 '<' 开头,如内联 svg/img —— 经 DOMPurify 图标白名单净化,事件属性/危险协议剥除)
      icons: {
        header: '🦈',
        empty: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="#7c6ff0" stroke-width="2"/><circle cx="9" cy="10" r="1.6" fill="#7c6ff0"/><circle cx="15" cy="10" r="1.6" fill="#7c6ff0"/><path d="M8 14c1.2 1.6 2.6 2.4 4 2.4s2.8-.8 4-2.4" stroke="#7c6ff0" stroke-width="2" stroke-linecap="round"/></svg>',
        queued: '<img src="data:image/svg+xml," width="12" height="12" alt="" onerror="window.__iconXss=1">',
        assistantAvatar: '🛰️',
        userAvatar: '🙋',
        send: '🚀',                // 发送按钮图标(缺省=内置纸飞机 SVG;loading 停止方块恒内置)
        newSession: '➕',          // 顶部「新建会话」按钮图标(缺省=内置 + SVG;history/more/close 同名键同理;文字标签走 i18n,宽度足够时展示)
        sessionDelete: '🗑️',       // 历史记录下拉「删除会话」按钮图标(缺省=✕ 文本)
      },
      // 快捷指令(?quick=1 开启;ui-quick-wins Q1):点击直接发送 prompt;含一条缺 prompt 的坏项验证装配期过滤
      ...(quickOn ? {
        quickActions: [
          { label: '加一张卡片', prompt: '帮我加一张介绍优点的卡片' },
          { label: '换个主题', prompt: '把主题换成更明快的风格', icon: '🎨' },
          { label: '坏项(应被过滤)', prompt: '' },
        ],
      } : {}),
      // 元素拖入聚焦入口(?drop=1 开启;ui-quick-wins Q4):拖宿主元素进输入框 → 回调(此处仅记录 tag 供 e2e 断言)
      ...(dropOn ? { onDropElement: (el: Element) => { (window as unknown as Record<string, unknown>).__droppedTag = el.tagName } } : {}),
      // 会话导出/导入 UI 入口(?transfer=1 开启;ui-quick-wins Q2):历史面板底部出现入口(API 恒可用)
      ...(transferOn ? { sessionTransfer: true } : {}),
    },
  })
  agent.mount('#chat-root')
})
onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="page">
    <h1>最简集成</h1>
    <p>无 schema / 无 data / 无 approval —— 纯对话对话框,5 行集成。</p>
    <p>适合「我只想给页面加个 AI 对话框,不操作页面数据」的最简场景。</p>
    <!-- 元素拖入靶标(?drop=1):draggable 宿主元素,拖进聊天输入框触发 onDropElement -->
    <p v-if="dropOn" id="drag-source" draggable="true" style="display:inline-block;padding:4px 12px;border:1px dashed #7c6ff0;border-radius:8px;cursor:grab">拖我进聊天输入框 🖐</p>
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
