<script setup lang="ts">
/**
 * 复杂页面 demo —— 多种组件拼装一个页面,右侧 Agent 对话框驱动左侧实时更新
 *
 * 配置方式:reactive 对象经 data 的 `bind` 字段直连 SDK(集成方自己挂 window 供页面读取),
 * `schema` 用 zod 声明形状(字段 .describe() 自动注入 systemPrompt「可操作数据」段,无需手写)。
 * Agent 经 write 改 page.title / page.components(增删改组件 / 调 props / 调 style)→ 左侧 PageRenderer 响应式更新(本 demo 保留 reactive 展示 Vue 响应式模式)。
 */
import { reactive, onMounted, onUnmounted, ref } from 'vue'
import { createChatSdk, createHtmlSubagent, defineSkill, htmlFragmentSkill, type ChatSdk } from '../../src/core'
import { useAgentConfig } from './useAgentConfig'
import PageRenderer from './PageRenderer.vue'
import DevNav from '../_shared/DevNav.vue'
import EditableBanner from '../_shared/EditableBanner.vue'
import DynamicReconfigPanel from './DynamicReconfigPanel.vue'
import PageConfigPanel from './PageConfigPanel.vue'
import { initialPage, pageSchema, complexBuilderSkillContent, arkUiSpecContent } from './pageSchema'
import { generateHugePage } from './hugePage'
import { generateDeepNestedPage } from './deepNestedPage'
const cfg = useAgentConfig()

// 顶层(同步):先建响应式 page 挂到 window,供 PageRenderer 绑定(PageRenderer setup 在 onMounted 之前执行)
// ?huge=1 → 1M 扁平大页面(800 实例,测体量/read 分页);?deep=1 → 深嵌套复杂专题页(多层 children,测深 jsonPath patch / workingMemory 跨压缩深路径);否则 initialPage
const query = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null
const isHuge = query?.get('huge') === '1'
const isDeep = query?.get('deep') === '1'
const basePage = isHuge ? generateHugePage() : isDeep ? generateDeepNestedPage() : initialPage
const pageObj = reactive({
  title: basePage.title,
  components: basePage.components.map((c) => ({ ...c })),
})
;(window as any).page = pageObj

// 发布状态(发布后显示时间戳,PageConfigPanel + agent publish action 共用)
const publishStatus = ref('')
/** 保存草稿:序列化 page → localStorage(供 PageConfigPanel 保存按钮 + agent save_draft action 复用) */
function saveDraft(): string {
  try { localStorage.setItem('complex-demo-draft', JSON.stringify({ title: pageObj.title, components: pageObj.components })) } catch { /* localStorage 不可用时静默 */ }
  return `草稿已保存(${pageObj.components.length} 个组件)。`
}
/** 发布页面(模拟):记录发布时间戳 */
function publish(): string {
  const ts = new Date().toLocaleString()
  publishStatus.value = `已发布 @ ${ts}`
  return `页面已发布(${pageObj.components.length} 个组件)@ ${ts}。`
}
/** 重置到 initialPage(splice 保留 reactive 引用) */
function resetPage(): void {
  pageObj.title = initialPage.title
  pageObj.components.splice(0, pageObj.components.length, ...initialPage.components.map((c) => ({ ...c })))
}

// 两步拾取选中态(第 1 步:点组件 → 浮层边框 + 加入聊天按钮;第 2 步:点按钮才聚焦)
const selectedPath = ref<string | null>(null)
/** 第 1 步:点组件本体 → 仅选中(显示边框 + 按钮,不聚焦) */
function onSelectComponent(path: string): void {
  selectedPath.value = path
}
/** 第 2 步:点「💬 加入聊天」按钮 → 追加聚焦(multi-focus 累积,可同时聚焦多个组件;写越界被拒) */
function onFocusComponent(path: string): void {
  if (!agent) return
  const m = /^components\.(\d+)$/.exec(path)
  const idx = m ? Number(m[1]) : -1
  const comp = pageObj.components[idx]
  const label = comp?.type ? `${comp.type} #${idx}` : path
  const r = agent.addFocus({ path, label }) // multi-focus:累积追加(非覆盖),多次加入聚焦多个组件
  if (r?.ok) selectedPath.value = null // 加入成功 → 清选中态(边框消失,输入框 chip 显示路径)
}
/** chip 点击回调:点输入框内聚焦 chip → 滚动到对应组件 + PickOverlay 边框短暂高亮(回看聚焦对象) */
function onFocusChipClick(path: string): void {
  const el = document.querySelector(`[data-path="${path}"]`) as HTMLElement | null
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  selectedPath.value = path // PickOverlay 显示边框
  setTimeout(() => { if (selectedPath.value === path) selectedPath.value = null }, 2000)
}

const root = ref<HTMLElement>()
const agentRef = ref<ChatSdk | null>(null)
let agent: ChatSdk | null = null

// ===== 三档判档(prompt 分级实测;按最新 user 消息自动判「快速/方向闸/详细」)=====
// 防冲突设计:
//  - 快速(默认):不注入段 —— 主 agent 走既有「新建直接委派」编排纪律,零冲突
//  - 方向闸:新建+创意主题词 → 主 agent【自己】出方案征询(request_human_confirmation 是工具动作,
//    非「过渡性文字」,与编排段禁令兼容;方案对比发生在征询文案里,不进子 agent 思考)
//  - 详细:方向闸 + write_todos;委派 task 的深入要求**限定在结构性决策**(子 agent 优先级总纲兜底:task 上位但底线不放宽)
const PROPOSE_GATE = [
  '## 当前模式:方向确认(新建创意类,本段优先于「新建直接委派」常规纪律)',
  '**硬性第一步**:任何生成/委派之前,必须调 request_human_confirmation(question=「<主题>用哪套方向?」+ 一句背景, options=[方案A 一句话要点, 方案B 一句话要点, 方案C 一句话要点], recommendation=你推荐的一套) 让用户点选;每套方案 1~2 句(风格/配色/结构,视觉锚取自 ark-ui-spec 规范的 hex)。',
  '用户答复前**禁止**委派 use_html、禁止 write components、禁止直接生成代码;答复后按选定方向走常规执行纪律(委派/落地/核对)。',
].join('\n')
const DETAILED_MODE = [
  '## 当前模式:详细设计',
  '① 新建/创意类先按方向确认征询(2~3 套方案,request_human_confirmation)再动手;',
  '② 动手前 write_todos 拆步骤(每组件一项),逐项执行/委派并核对;',
  '③ 委派 use_html 的 task 中,复杂组件(轮播/粒子特效/复杂交互动画类)附一句**范围限定的深入要求**:「本组件请先对比 2 个候选实现结构的取舍(性能/降级/复杂度各一句,如 scroll-snap vs transform 切换)再选定实现」—— 只限结构性决策,装饰效果仍从简。',
].join('\n')
/** 三档判档:显式指令最高优先;启发式升档 = 新建∧创意主题词(方向闸)/ 新建∧数量≥3(详细);其余快速(不注入) */
function detectMode(text: string): string | undefined {
  if (/别问|不用问|直接做|别规划|快速/.test(text)) return undefined // 快速:不注入,沿用默认直接委派
  if (/详细|仔细|认真做|先出方案|先规划|深思熟虑/.test(text)) return DETAILED_MODE
  const creating = /新建|加一个|添加|做一个|生成/.test(text)
  if (creating && /主题|风格|世界杯|国潮|节日|活动页|大促|周年/.test(text)) return PROPOSE_GATE
  const n = Number(/(\d+)\s*(个|张|条|组)/.exec(text)?.[1] ?? 0)
  if (creating && n >= 3) return DETAILED_MODE
  return undefined
}

// ===== 方向闸机制锁(M1 真 LLM 实测驱动:flash 无视提示词「硬性第一步」,0 次征询直接委派)=====
// 提示词门禁(PROPOSE_GATE 段)对弱指令模型不构成约束 → 机制化:闸门关闭期间拦 use_html 委派与 components 写入,
// 回灌引导先 request_human_confirmation;确认与 user 消息按「human 消息序号」对齐(确认发生在第 k 条 human 后 →
// 该消息周期内放行;下一条 user 消息自动重新武装)。快速档零拦截(现状零变化)。
function createProposeGateMiddleware() {
  let confirmedAtHuman = -1
  return {
    name: 'propose-gate',
    // 确认信号从模型响应观察:request_human_confirmation 被批准中间件在外层短路,内层 wrapToolCall 看不到
    // 该调用(实测);wrapModelCall 是全路径覆盖点 —— 模型发起征询即记「本轮 human 序号已确认」
    wrapModelCall: async (ctx: any, next: () => Promise<any>) => {
      const res = await next(ctx)
      try {
        const calls = res?.toolCalls ?? []
        if (calls.some((c: any) => c.name === 'request_human_confirmation')) {
          const humans = (ctx?.state?.messages ?? []).filter((m: any) => m.role === 'user' || m.getType?.() === 'human')
          confirmedAtHuman = humans.length
        }
      } catch { /* 观察层不崩 */ }
      return res
    },
    wrapToolCall: async (ctx: any, next: () => Promise<any>) => {
      const args = ctx?.args ?? {}
      if (args.dryRun === true) return next(ctx)
      const msgs: any[] = ctx?.state?.messages ?? []
      // state.messages 是 SDK 层 AgentMessage[](role 字段),非 langchain 消息(getType)—— 用 role 判
      const humans = msgs.filter((m: any) => m.role === 'user' || m.getType?.() === 'human')
      const humanIdx = humans.length
      if (ctx.name === 'request_human_confirmation') { confirmedAtHuman = humanIdx; return next(ctx) }
      if (ctx.name !== 'use_html' && ctx.name !== 'write') return next(ctx)
      const mode = detectMode(String([...humans].reverse()[0]?.content ?? ''))
      if (mode && confirmedAtHuman < humanIdx) {
        return {
          content: 'PROPOSE_GATE · 当前任务命中「方向确认/详细设计」档:先调 request_human_confirmation(question=「用哪套方向?」+ 一句背景, options=[2~3 套方案各一句风格/配色/结构要点], recommendation=你推荐的一套) 让用户点选;用户答复前不做任何委派/写入。这不是错误,是流程门禁 —— 请立即征询,答复后继续原任务。',
          status: 'error' as const,
        }
      }
      return next(ctx)
    },
  }
}

onMounted(() => {
  agent = createChatSdk({
    container: root.value!,
    id: 'complex-demo',
    storage: 'memory',
    llm: {
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      temperature: cfg.temperature,
      maxTokens: cfg.maxTokens,
    },
    streaming: true,
    systemPrompt:
      '你是复杂页面构建助手。左侧页面由 window.page 驱动,结构 { title, components[] }(组件数组按顺序拼装)。每个组件 = { type, id?, style?, visible?, className?, props:{...业务字段} };容器组件(container/section/grid)的 props.children 可嵌套任意组件。用户要改左侧页面时,改 page.title 或 page.components(增删改组件、调 props、调 style、容器内改 children),左侧实时更新。组件类型与各字段详见 load_skill("complex-builder")。\n\n' +
      '\n\n【本平台组件路由】本平台含多种组件类型,其中 custom 为纯代码组件(根级 code = 完整自包含 HTML 页面,含 style/script)。路由:custom 的 **code 字段** → 必经 use_html 子 agent 委派(生成/修改/排查,你禁直接 write/edit code);custom 的**其他属性**(name/style/visible 等)+ 所有非 custom 组件(heading/banner/carousel/card/coupon...)→ 你直接 write 改。多组件含 custom 时,write_todos 列出 → 普通 组件直接 write、多个 custom 组件可同轮并行发多个 use_html 委派(每组件一次;同一组件同时只一个委派在途)。',
    // 默认 true:自定义 systemPrompt 末尾用 '---' 分隔线自动追加 reliableWriteRules(改前先 read、字段以 describe 为准、写错看校验错误重试、优先增量 patch);设 false 关闭;不传 systemPrompt 用默认 prompt 时已内置
    appendReliableWriteRules: true,
    // 三档判档:每轮按最新 user 消息注入模式段(快速=不注入/方向闸=先征询/详细=征询+todos+范围限定深入要求)
    // ⚠️ state.messages 是 SDK 层 AgentMessage[](role 字段),非 langchain 消息(getType)—— 曾用 getType
    // 永远匹配不到 → 模式段从未注入(M1 真 LLM 0 次征询的真根因,机制锁测试暴露)
    augmentSystem: ({ state }: any) => detectMode(String(
      [...(state?.messages ?? [])].reverse().find((m: any) => m.role === 'user' || m.getType?.() === 'human')?.content ?? '',
    )),
    // 方向闸机制锁:提示词版门禁对弱指令模型无效(M1 真 LLM 实测 0 次征询)→ 回灌式门禁兜底
    middleware: [createProposeGateMiddleware()],
    // data 单主对象配置:schema + bind 直连 reactive 对象,工具直接读写 bind(集成方自己挂 window.page 供 PageRenderer 读)
    // resources:freeze 保护 navbar(components.0)的 trackId —— read 返占位符(精确值不进 AI 消息流),write 改 trackId 被拒(演示精确值保护与两步拾取协同:聚焦 navbar → read 占位 → 改不动)。
    // ⚠️ 路径按位置索引(非 id/type 锚定):若 agent 增删组件致 navbar 移出 components.0,保护会跟随索引漂移到新占据 0 号的组件。演示用;生产场景应按 id/type 动态定位路径。
    data: { schema: pageSchema, bind: pageObj, resources: [{ path: 'components.0.props.trackId', mode: 'freeze' as const }] },
    // 胜任自动化:agent 能读渲染后 DOM(get_dom,看修改是否生效)+ 触发宿主页面动作(保存/发布,与配置面板同等)
    capabilities: { domInspect: true, draftWrite: true },
    toolMode: 'advanced', // complex 场景:暴露全工具 + draft_write/draft_commit(分块生成大页面;真 LLM 实测用)
    maxToolRounds: 25,  // custom 组件逐个委派 use_html 耗轮次(同 html-page-demo),抬到 25 防多组件生成被截断
    maxParallelTools: 3,  // 同轮工具并发 >1:多个 use_html 委派可同轮并行(3.13 并行委派;同组件单一在途靠编排禁令)
    actions: {
      save_draft: { description: '保存当前页面为草稿(序列化 page 到 localStorage)。用户要求保存/存草稿时调用,无需参数。', run: saveDraft },
      publish: { description: '发布当前页面(模拟发布,记录发布时间戳)。用户要求发布/上线/生效时调用,无需参数。', run: publish },
      refresh_preview: {
        description: '返回当前页面概况(标题 + 组件数)。用户询问页面状态/有多少组件时调用。',
        run: () => `当前页面「${pageObj.title}」共 ${pageObj.components.length} 个组件。`,
      },
    },
    // interceptors.write:agent push 新组件时自动补 id(若未设)—— agent 无需关心 id 生成,拦截器兜底
    // (演示拦截器补充能力:即使 agent 只传 { type:'heading', props:{...} },落地时也有稳定 id 供锚点/调试)
    interceptors: {
      write: (payload) => {
        if (payload && Array.isArray((payload as any).components)) {
          let i = 0
          ;(payload as any).components = (payload as any).components.map((c: any) => {
            if (!c.id) c.id = `cmp-${Date.now()}-${i++}`
            return c
          })
        }
        return payload
      },
    },
    skills: [
      defineSkill({
        // UI 规范双挂(主 + html 子):主 agent 知规范才能在委派 task 里给准确视觉锚(hex 取自规范而非自造)
        name: 'ark-ui-spec',
        description: '方舟平台 UI 规范:色板 hex/间距栅格/字号/组件形态约束。涉及视觉/配色决策或委派代码组件时先读',
        getContent: () => arkUiSpecContent,
      }),
      defineSkill({
        name: 'complex-builder',
        description: '编辑组件拼装的复杂页面(window.page,含 container/section/grid 容器可嵌套 children)。用户要求改左侧页面(增删改组件 / 调 props / 调样式 / 容器内嵌套)时使用',
        getContent: () => complexBuilderSkillContent,
      }),
    ],
    // HTML 代码子 agent:零配置可省(3.9 自动装配);此处显式声明演示「挂 UI 规范 skill」的定制路径 ——
    // skills 完全覆盖默认,须并回内置 htmlFragmentSkill(生成规范/安全底线),否则丢规范
    subagents: [createHtmlSubagent({
      skills: [
        defineSkill({
          name: 'ark-ui-spec',
          description: '方舟平台 UI 规范:色板 hex/间距栅格/字号/组件形态约束(优惠券撕边/倒计时/徽标)。生成或修改 custom 代码组件前必读',
          getContent: () => arkUiSpecContent,
        }),
        htmlFragmentSkill,  // 内置生成规范(安全底线/可访问性/形态规则),覆盖默认时必须并回
      ],
    })],
    onEvent: (e) => { if (e.type === 'focus_chip_click') onFocusChipClick(e.path) }, // chip 点击 → 滚动到组件 + 边框闪
    debug: true,
    dialog: {
      title: '复杂页面 Agent',
      placeholder: '试试:加一个商品卡片 / 标题改成红色 / 轮播换成 3 张图 / 商品瀑布流改成 4 列 …',
    },
  })
  agent.mount()
  agentRef.value = agent
  // 调试/真 LLM 测试:暴露 sdk + page 供脚本读(inspect().subagent.active 判 idle;page 查产物)
  ;(window as any).__sdk = agent
  ;(window as any).page = pageObj
})

onUnmounted(() => agent?.unmount())
</script>

<template>
  <DevNav />
  <div class="layout">
    <aside class="pane pane-left">
      <DynamicReconfigPanel :agent="agentRef" />
      <PageConfigPanel :page="pageObj" :on-save="saveDraft" :on-publish="publish" :on-reset="resetPage" :publish-status="publishStatus" />
      <EditableBanner title="AI 可编辑页面" hint="Agent 经 write 修改此区">
        <PageRenderer :selected-path="selectedPath" @select="onSelectComponent" @focus="onFocusComponent" />
      </EditableBanner>
    </aside>
    <section ref="root" class="pane pane-right"></section>
  </div>
</template>

<style>
/* 全局重置:消除 body 默认 margin + 防止 100vw/100vh 导致页面级滚动条
   (100vw 含竖向滚动条宽度 → 横向溢出;body margin + 100vh → 竖向溢出 → 滚动条遮挡聊天输入框) */
html, body, #app { margin: 0; padding: 0; height: 100%; overflow: hidden; }
/* baseProps 通用渲染:动画 / 悬停 / 响应式 / 主题(CompRenderer compClass 合成) */
@keyframes anim-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes anim-slide-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
@keyframes anim-zoom-in { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
.anim-fade { animation: anim-fade-in 0.3s ease both; }
.anim-slide { animation: anim-slide-in 0.3s ease both; }
.anim-zoom { animation: anim-zoom-in 0.3s ease both; }
.hover-scale { transition: transform 0.2s; }
.hover-scale:hover { transform: scale(1.03); }
.hover-lift { transition: box-shadow 0.2s, transform 0.2s; }
.hover-lift:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.12); }
.hover-highlight { transition: background 0.2s; }
.hover-highlight:hover { background: rgba(37, 99, 235, 0.08); }
@media (max-width: 767px) { .hide-on-mobile { display: none !important; } }
@media (min-width: 768px) { .hide-on-desktop { display: none !important; } }
.theme-dark { color: var(--ark-fg); background: var(--ark-panel); }
</style>

<style scoped>
.layout {
  display: flex;
  width: 100%;
  height: 100%;
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
  /* 防止 pane-right 自身溢出导致滚动条遮挡 chat-footer */
  overflow: hidden;
}
.pane-right > :deep(.chat-dialog) {
  width: 100%;
  height: 100%;
}
</style>
