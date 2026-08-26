<script setup lang="ts">
/**
 * 测试模块 demo —— 左侧 JSON 驱动的页面,右侧 Agent 对话框
 *
 * 展示「非 Vue 响应式」集成模式:bind 用普通对象(非 reactive),SDK 工具直接读写 bind;
 * UI 刷新由集成方负责 —— 监听 onEvent('data_change') 触发 tick,:key 强制重渲染画布。
 * `schema` 用 zod 声明形状(字段 .describe() 自动注入 systemPrompt「可操作数据」段,无需手写)。
 */
import { onMounted, onUnmounted, ref } from 'vue'
import { createChatSdk, type ChatSdk } from '../../src/core'
import { defineSkill } from '../../src/core/harness/skills'
import type { Middleware } from '../../src/core/harness/middleware'
import { useAgentConfig } from './useAgentConfig'
import PageRenderer from './PageRenderer.vue'
import DevNav from '../_shared/DevNav.vue'
import EditableBanner from '../_shared/EditableBanner.vue'
import { initialPage, pageSchema, pageBuilderSkillContent } from './pageSchema'

const cfg = useAgentConfig()

// 顶层(同步):先建普通对象 page 挂到 window,供 PageRenderer 绑定(PageRenderer setup 在 onMounted 之前执行,需此时已就位)
// 非 reactive:SDK 工具直接读写此对象,但 Vue 模板不会自动响应 → 靠 tick 重渲染
const pageObj = {
  title: initialPage.title,
  theme: initialPage.theme,
  components: initialPage.components.map((c) => ({ ...c })),
}
;(window as any).page = pageObj

// tick:onEvent('data_change') 时 ++,:key="tick" 强制 PageRenderer 重建读最新 page
const tick = ref(0)

const root = ref<HTMLElement>()
let agent: ChatSdk | null = null

// 两步拾取选中态(第 1 步:点组件 → 浮层边框 + 加入聊天按钮;第 2 步:点按钮才聚焦)
const selectedPath = ref<string | null>(null)
/** 第 1 步:点组件本体 → 仅选中(显示边框 + 按钮,不聚焦) */
function onSelectComponent(path: string): void {
  selectedPath.value = path
}
/** 第 2 步:点「💬 加入聊天」按钮 → 追加聚焦(multi-focus 累积,可同时聚焦多个组件;写越界被拒) */
function onFocusComponent(path: string): void {
  if (!agent) return
  const label = compLabel(path)
  const r = agent.addFocus({ path, label }) // multi-focus:累积追加(非覆盖),多次加入聚焦多个组件
  if (r?.ok) selectedPath.value = null // 加入成功 → 清选中态(边框消失,输入框 chip 接管)
}
/** 按路径解析组件标签(支持嵌套:components.N.children.M...) */
function compLabel(path: string): string {
  let cur: any = pageObj
  for (const seg of path.split('.')) cur = cur?.[seg]
  return cur?.type ? `${cur.type}(${path})` : path
}
/** chip 点击回调:点输入框内聚焦 chip → 滚动到对应组件 + PickOverlay 边框短暂高亮(回看聚焦对象) */
function onFocusChipClick(path: string): void {
  const el = document.querySelector(`[data-path="${path}"]`) as HTMLElement | null
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  selectedPath.value = path // PickOverlay 显示边框
  setTimeout(() => { if (selectedPath.value === path) selectedPath.value = null }, 2000)
}

/**
 * 自定义中间件示例:对话埋点
 * 演示 afterModel / wrapToolCall / afterAgent 三个观察钩子。
 * npm run dev 后打开控制台,对话时可见:每轮模型响应、每个工具调用耗时、对话结束。
 */
const analyticsMiddleware: Middleware = {
  name: 'analytics-demo',
  afterModel: (res) => {
    console.log('%c[analytics] 模型响应', 'color:#10b981;font-weight:bold', {
      内容长度: res.content.length,
      工具调用数: res.toolCalls.length,
    })
  },
  wrapToolCall: async (ctx, next) => {
    const t = Date.now()
    const result = await next(ctx)
    console.log(
      '%c[analytics] 工具调用',
      'color:#3b82f6;font-weight:bold',
      ctx.name,
      `+${Date.now() - t}ms`,
      result.status,
    )
    return result
  },
  afterAgent: () => console.log('%c[analytics] 本轮对话结束', 'color:#6b7280'),
}

onMounted(() => {
  agent = createChatSdk({
    container: root.value!,
    id: 'page-demo',                             // ← 稳定 id:刷新后恢复历史(多 agent 共存各自隔离)
    storage: 'indexed',                          // ← 开启落盘持久化(默认 'memory' 纯内存,3.9+);可选 'session'/'local'
    llm: {
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      temperature: cfg.temperature,
      maxTokens: cfg.maxTokens,
    },
    systemPrompt:
      '你是页面构建助手。左侧页面由 window.page 驱动,用户要改左侧页面(改标题/换主题/增删改组件)时,改 page 对应字段,左侧实时更新。组件结构详见 load_skill("page-builder")。',
    // ↓ data 单主对象:schema + bind 直连普通对象(集成方自己挂 window.page 供模板读),schema 的 .describe() 自动注入字段说明到 systemPrompt
    data: { schema: pageSchema, bind: pageObj },
    skills: [
      defineSkill({
        name: 'page-builder',
        description: '编辑 JSON 驱动的页面(window.page)。用户要求改左侧页面(增删改组件 / 改标题 / 换主题)时使用',
        getContent: () => pageBuilderSkillContent,
        // 多层级参考文档(skill-references):主文只写索引,二级组件配方按需 load_skill(name, ref) 取回,不整包灌上下文
        references: [
          { name: 'recipes/banner.md', description: 'banner 组件字段与文案配方', getContent: () => '# banner\nprops:{ title, subtitle, theme }。文案:主标题 ≤12 字、副标题 ≤24 字。' },
          { name: 'recipes/card.md', description: 'card 组件字段与排版配方', getContent: () => '# card\nprops:{ title, price, tags[] }。排版:价格强调色、tags ≤3。' },
        ],
      }),
    ],
    middleware: [analyticsMiddleware], // ← 自定义中间件示例(内置 todos/skills/vfs... 之后执行)
    // ↓ 非 reactive bind:监听 data_change 触发 tick,:key 强制画布重渲染读最新 page
    onEvent(e) {
      if (e.type === 'data_change') tick.value++
      else if (e.type === 'focus_chip_click') onFocusChipClick(e.path) // chip 点击 → 滚动到组件 + 边框闪
    },
    debug: true,
    dialog: {
      title: '页面构建 Agent',
      placeholder: '试试:加一个"提交"按钮 / 主题改成 dark / 删掉列表 …',
      theme: 'dark', // 内置深色主题(方舟专题设计稿色板;--cs-* 变量驱动)
      // ↓ 工具步骤展示映射(纯展示层拦截器):原始工具名对终端用户不友好 → 业务文案;可按 args 动态生成补充说明
      toolStepView: (s) => {
        if (s.name === 'write') {
          // write 的 jsonPath 可能在顶层(write({jsonPath}))或 patch 内(write({patch:{jsonPath}}))
          const a = s.args as { jsonPath?: string; patch?: { jsonPath?: string } } | undefined
          const p = a?.jsonPath ?? a?.patch?.jsonPath ?? ''
          // 原始路径(components.5.children.1)对用户无意义 → 解析成组件标签;根字段(title/theme)保留原样
          return { title: '修改页面', detail: p.startsWith('components') ? compLabel(p) : p }
        }
        if (s.name === 'read') return { title: '读取页面数据' }
        return undefined // 其余工具回退原始名
      },
    },
  })
  agent.mount()
  ;(window as any).__sdk = agent // 真 LLM 回归脚本采样口(tests/runtime/page-demo-real-llm.mjs;debugLogs/usage/活动子 agent)
})

onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="layout">
    <aside class="pane pane-left">
      <EditableBanner title="AI 可编辑页面" hint="Agent 经 write 修改此区">
        <PageRenderer :key="tick" :page="pageObj" :selected-path="selectedPath" @select="onSelectComponent" @focus="onFocusComponent" />
      </EditableBanner>
    </aside>
    <section ref="root" class="pane pane-right"></section>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
.pane-left {
  flex: 1;
  overflow: auto;
  background: var(--ark-bg);
  padding: 20px;
  color: var(--ark-fg);
}
.pane-right {
  width: 50%;
  flex: 1;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  background: var(--ark-panel);
}
.pane-right > :deep(.chat-dialog) {
  width: 100%;
  height: 100%;
}
</style>
