<script setup lang="ts">
/**
 * 复杂页面 demo —— 多种组件拼装一个页面,右侧 Agent 对话框驱动左侧实时更新
 *
 * 配置方式:reactive 对象经 data 的 `bind` 字段直连 SDK(集成方自己挂 window 供页面读取),
 * `schema` 用 zod 声明形状(字段 .describe() 自动注入 systemPrompt「可操作数据」段,无需手写)。
 * Agent 经 write 改 page.title / page.components(增删改组件 / 调 props / 调 style)→ 左侧 PageRenderer 响应式更新(本 demo 保留 reactive 展示 Vue 响应式模式)。
 */
import { reactive, onMounted, onUnmounted, ref } from 'vue'
import { createChatSdk, createHtmlSubagent, defineSkill, defineTool, htmlFragmentSkill, type ChatSdk, type Middleware } from '../../src/core'
import { z } from 'zod'
import { useAgentConfig } from './useAgentConfig'
import PageRenderer from './PageRenderer.vue'
import DevNav from '../_shared/DevNav.vue'
import EditableBanner from '../_shared/EditableBanner.vue'
import DynamicReconfigPanel from './DynamicReconfigPanel.vue'
import PageConfigPanel from './PageConfigPanel.vue'
import PropsPanel from './PropsPanel.vue'
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

// ===== page-tools 结构工具(editor_fangzhou 对齐:skill 工具工厂 + 宿主原生 reactive 操作 + writeCapable)=====
// 组件清单/跨容器移动/删除收纳进 page-tools skill(load_skill 后注入工具池,渐进披露不占初始 systemPrompt token);
// 结构变更走宿主 reactive 原生操作(与 editor 走原生 move.node 同思路),writeCapable 等效写标注让
// 零工具门禁/stale-read/evidence 账本仍按写计入
const isRag = query?.get('rag') === '1'
const ragMcpUrl = ((import.meta.env.VITE_RAG_MCP_URL as string | undefined) || '').trim()

/** 递归收集组件清单(path 即 write patch 可用的 jsonPath;容器经 props.children 下钻) */
function walkComponents(out: Array<Record<string, unknown>>, nodes: unknown[], prefix: string, depth: number): void {
  nodes.forEach((raw, i) => {
    const node = raw as Record<string, any>
    const path = `${prefix}.${i}`
    const children: unknown[] = Array.isArray(node?.props?.children) ? node.props.children : []
    out.push({ type: node?.type ?? '', name: node?.name ?? '', id: node?.id ?? '', path, depth, childCount: children.length })
    if (children.length) walkComponents(out, children, `${path}.props.children`, depth + 1)
  })
}
function listComponents(type?: string): Record<string, unknown> {
  const out: Array<Record<string, unknown>> = []
  walkComponents(out, pageObj.components, 'components', 1)
  const filtered = type ? out.filter((c) => c.type === type) : out
  return { total: filtered.length, components: filtered }
}
/** 解析 "a.b.0" 形态的数组元素路径 → { 所在数组, 下标, 节点 };不存在返回 null */
function resolveArrayItem(path: string): { parent: unknown[]; index: number; node: unknown } | null {
  const m = /^(.*)\.(\d+)$/.exec(path)
  if (!m) return null
  const arr = m[1].split('.').reduce<unknown>((o, k) => (o == null || typeof o !== 'object' ? undefined : (o as Record<string, unknown>)[k]), pageObj)
  const idx = Number(m[2])
  if (!Array.isArray(arr) || !arr[idx]) return null
  return { parent: arr, index: idx, node: arr[idx] }
}
function moveComponent(path: string, targetPath: string): Record<string, unknown> {
  const src = resolveArrayItem(path)
  const tgt = resolveArrayItem(targetPath)
  if (!src || !tgt) return { error: `路径不存在(src=${path}, target=${targetPath});先 list_components 拿准确路径` }
  const children = (tgt.node as Record<string, any>)?.props?.children
  if (!Array.isArray(children)) return { error: `目标不是容器组件(无 props.children):${targetPath}` }
  // 源已在目标 children 内 = 同容器调序 → 引导 write move op(本工具只管跨容器)
  if (src.parent === children) return { error: '该组件已在目标容器内,同容器调序请直接用 write 的 move op(如 {op:"move", jsonPath:"components.6.props.children.2", value:"components.6.props.children.0"}),无需本工具' }
  if (targetPath.startsWith(path + '.')) return { error: '目标容器不能位于源组件子树内(会导致组件丢失)' }
  const [moved] = src.parent.splice(src.index, 1) // reactive splice → 视图即时更新
  children.push(moved)
  return { moved: true, path, targetPath, type: (moved as Record<string, any>)?.type ?? '' }
}
/** 手动拖拽移动(before/after = 调序,inside = 移入容器;宿主 reactive 原地搬移,视图即时更新) */
function onManualMove({ from, to, position }: { from: string; to: string; position: 'before' | 'after' | 'inside' }): void {
  const src = resolveArrayItem(from)
  const tgt = resolveArrayItem(to)
  if (!src || !tgt || from === to || to.startsWith(from + '.')) return // 防呆:目标在源子树内/同元素
  if (position === 'inside') {
    const children = (tgt.node as Record<string, any>)?.props?.children
    if (!Array.isArray(children)) return
    const [moved] = src.parent.splice(src.index, 1)
    children.push(moved)
  } else {
    // 先算「删除源之后」的目标锚点下标(同数组且源在前 → 锚点前移一位),再搬移
    let insertAt = tgt.index + (position === 'after' ? 1 : 0)
    if (src.parent === tgt.parent && src.index < tgt.index) insertAt -= 1
    const [moved] = src.parent.splice(src.index, 1)
    tgt.parent.splice(Math.max(0, Math.min(insertAt, tgt.parent.length)), 0, moved)
  }
  selectedPath.value = null // 搬移后原 path 失效,清选中
}
/** 手动删除(属性面板;复用 deleteComponent 语义,带 confirm) */
function onManualDelete(path: string): void {
  if (!confirm(`删除组件 ${path}?`)) return
  deleteComponent(path)
  selectedPath.value = null
}
/** 提升到顶层末尾(从容器内搬出到页面末尾) */
function onManualLift(path: string): void {
  const hit = resolveArrayItem(path)
  if (!hit) return
  const [moved] = hit.parent.splice(hit.index, 1)
  pageObj.components.push(moved)
  selectedPath.value = null
}
function deleteComponent(path: string): Record<string, unknown> {
  const hit = resolveArrayItem(path)
  if (!hit) return { error: `路径不存在:${path};先 list_components 拿准确路径` }
  const [removed] = hit.parent.splice(hit.index, 1)
  return { deleted: true, path, type: (removed as Record<string, any>)?.type ?? '' }
}
const structuralTools = [
  defineTool({
    name: 'list_components',
    description: '列出页面组件清单(type/name/path/嵌套深度/子组件数,path 即 write patch 可直接用的 jsonPath,含容器 props.children 递归)。修改/调序/移动/删除组件前先调它拿准确路径;传 type 按 type 过滤',
    schema: z.object({ type: z.string().optional().describe('按组件 type 过滤(如 "coupon");不传列全部') }),
    handler: ({ type }) => listComponents(type),
  }),
  defineTool({
    name: 'move_component',
    description: '跨容器移动组件(连同子树移到目标容器 props.children 末尾,reactive 原地搬移视图即时更新)。传 list_components 返回的 path;同容器内调序用 write 的 move op,无需本工具',
    schema: z.object({
      path: z.string().describe('要移动的组件 path(如 components.6.props.children.0)'),
      targetPath: z.string().describe('目标容器组件 path(其 props.children 数组)'),
    }),
    writeCapable: true, // 等效写:宿主原生流程改页面数据,零工具门禁/stale-read/evidence 账本仍按写计入
    handler: ({ path, targetPath }) => moveComponent(path, targetPath),
  }),
  defineTool({
    name: 'delete_component',
    description: '删除组件(含子树,reactive 原地移除)。破坏性操作,调用会挂人工确认;传 list_components 返回的 path',
    schema: z.object({ path: z.string().describe('要删除的组件 path') }),
    writeCapable: true,
    handler: ({ path }) => deleteComponent(path),
  }),
]

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
function createProposeGateMiddleware(): Middleware {
  let confirmedAtHuman = -1
  return {
    name: 'propose-gate',
    // 确认信号从模型响应观察:request_human_confirmation 被批准中间件在外层短路,内层 wrapToolCall 看不到
    // 该调用(实测);wrapModelCall 是全路径覆盖点 —— 模型发起征询即记「本轮 human 序号已确认」
    // (类型经返回值 Middleware 上下文推断:wrapModelCall 的 next 吃 ModelRequest、wrapToolCall 的 next 吃 ToolCallContext,必须转发)
    wrapModelCall: async (req, next) => {
      const res = await next(req)
      try {
        if (res.toolCalls.some((c) => c.name === 'request_human_confirmation')) {
          const humans = (req.state.messages as unknown as Array<{ role?: string; getType?: () => string }>).filter((m) => m.role === 'user' || m.getType?.() === 'human')
          confirmedAtHuman = humans.length
        }
      } catch { /* 观察层不崩 */ }
      return res
    },
    wrapToolCall: async (ctx, next) => {
      const args = ctx.args ?? {}
      if (args.dryRun === true) return next(ctx)
      const msgs = ctx.state.messages as unknown as Array<{ role?: string; content?: unknown; getType?: () => string }>
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
      provider: cfg.provider, // 'anthropic' = Claude 原生协议(默认组;deepseek-v4-flash 经 modelverse /llm 同源代理)
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl,
      model: cfg.model,
      temperature: cfg.temperature,
      maxTokens: cfg.maxTokens,
    },
    // MCP 知识库 RAG(?rag=1 开启;editor_fangzhou 同款 Streamable HTTP):rag_search/rag_ask/rag_documents
    // 注入工具池;握手 15s/调用 60s 超时自动降级,失败不阻塞主功能。URL 只进本地 .env(gitignore)
    ...(isRag && ragMcpUrl ? { mcp: [{ transport: 'http' as const, url: ragMcpUrl, name: 'ark-kb' }] } : {}),
    systemPrompt:
      '你是复杂页面构建助手。左侧页面由 window.page 驱动,结构 { title, components[] }(组件数组按顺序拼装)。每个组件 = { type, id?, style?, visible?, className?, props:{...业务字段} };容器组件(container/section/grid)的 props.children 可嵌套任意组件。用户要改左侧页面时,改 page.title 或 page.components(增删改组件、调 props、调 style、容器内改 children),左侧实时更新。组件类型与各字段详见 load_skill("complex-builder")。\n\n' +
      '\n\n【本平台组件路由】本平台含多种组件类型,其中 custom 为纯代码组件(根级 code = 完整自包含 HTML 页面,含 style/script)。路由:custom 的 **code 字段** → 必经 use_html 子 agent 委派(生成/修改/排查,你禁直接 write/edit code);custom 的**其他属性**(name/style/visible 等)+ 所有非 custom 组件(heading/banner/carousel/card/coupon...)→ 你直接 write 改。多组件含 custom 时,write_todos 列出 → 普通 组件直接 write、多个 custom 组件可同轮并行发多个 use_html 委派(每组件一次;同一组件同时只一个委派在途)。' +
      '\n\n【结构操作】组件清单定位/跨容器移动/删除 → 先 load_skill("page-tools") 加载结构工具(list_components 拿准确 path / move_component 跨容器 / delete_component 删除挂人工确认);同容器调序直接用 write move op。' +
      (isRag ? '\n【知识库】平台/组件配置类问题先查知识库:rag_search 检索 / rag_ask 引用问答(回答附出处),勿凭记忆编造。' : ''),
    // 默认 true:自定义 systemPrompt 末尾用 '---' 分隔线自动追加 reliableWriteRules(改前先 read、字段以 describe 为准、写错看校验错误重试、优先增量 patch);设 false 关闭;不传 systemPrompt 用默认 prompt 时已内置
    appendReliableWriteRules: true,
    // 动态 systemPrompt(editor_fangzhou 对齐,每轮注入):
    // ① 页面实况段 —— ctx.data 每轮从 liveData() 取最新(setData 后自动同步),运行时算标题/组件数/嵌套深度
    // ② 三档判档段(快速=不注入/方向闸=先征询/详细=征询+todos+范围限定深入要求)
    // ⚠️ state.messages 是 SDK 层 AgentMessage[](role 字段),非 langchain 消息(getType)—— 曾用 getType
    // 永远匹配不到 → 模式段从未注入(M1 真 LLM 0 次征询的真根因,机制锁测试暴露)
    augmentSystem: ({ state, data }: any) => {
      const segs: string[] = []
      const bind = (data as { bind?: { title?: string; components?: unknown[] } } | undefined)?.bind ?? pageObj
      let deepest = 0
      const walkDepth = (nodes: unknown[], d: number): void => {
        deepest = Math.max(deepest, d)
        for (const n of nodes) {
          const c = n as { props?: { children?: unknown[] } }
          walkDepth(Array.isArray(c?.props?.children) ? c.props.children : [], d + 1)
        }
      }
      walkDepth(bind?.components ?? [], 1)
      segs.push(`## 页面实况(每轮同步)\n- 标题「${bind?.title ?? ''}」· 顶层组件 ${bind?.components?.length ?? 0} 个 · 最深嵌套 ${deepest} 层${isRag ? ' · 知识库已接(rag_search/rag_ask 可查组件配置与运营手册)' : ''}`)
      const mode = detectMode(String(
        [...(state?.messages ?? [])].reverse().find((m: any) => m.role === 'user' || m.getType?.() === 'human')?.content ?? '',
      ))
      if (mode) segs.push(mode)
      return segs.join('\n\n')
    },
    // 方向闸机制锁:提示词版门禁对弱指令模型无效(M1 真 LLM 实测 0 次征询)→ 回灌式门禁兜底
    middleware: [createProposeGateMiddleware()],
    // data 单主对象配置:schema + bind 直连 reactive 对象,工具直接读写 bind(集成方自己挂 window.page 供 PageRenderer 读)
    // resources:freeze 保护 navbar(components.0)的 trackId —— read 返占位符(精确值不进 AI 消息流),write 改 trackId 被拒(演示精确值保护与两步拾取协同:聚焦 navbar → read 占位 → 改不动)。
    // ⚠️ 路径按位置索引(非 id/type 锚定):若 agent 增删组件致 navbar 移出 components.0,保护会跟随索引漂移到新占据 0 号的组件。演示用;生产场景应按 id/type 动态定位路径。
    data: { schema: pageSchema, bind: pageObj, resources: [{ path: 'components.0.props.trackId', mode: 'freeze' as const }] },
    // 胜任自动化:agent 能读渲染后 DOM(get_dom,看修改是否生效)+ 触发宿主页面动作(保存/发布,与配置面板同等)
    capabilities: { domInspect: true, draftWrite: true },
    // 机制级人工确认(editor_fangzhou 对齐):破坏性删除挂 approval(UI 确认条 允许/拒绝;无响应 30s 自动拒)
    approval: { confirm: (name: string) => name === 'delete_component' },
    maxParallelTools: 3,  // 同轮工具并发 >1:多个 use_html 委派可同轮并行(3.13 并行委派;同组件单一在途靠编排禁令)
    actions: {
      save_draft: { description: '保存当前页面为草稿(序列化 page 到 localStorage)。用户要求保存/存草稿时调用,无需参数。', run: saveDraft },
      publish: { description: '发布当前页面(模拟发布,记录发布时间戳)。用户要求发布/上线/生效时调用,无需参数。', run: publish },
      refresh_preview: {
        description: '返回当前页面概况(标题 + 组件数)。用户询问页面状态/有多少组件时调用。',
        run: () => `当前页面「${pageObj.title}」共 ${pageObj.components.length} 个组件。`,
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
      defineSkill({
        name: 'page-tools',
        description: '页面结构操作工具集(list_components 组件清单 / move_component 跨容器移动 / delete_component 删除,load 后注入工具池)。凡涉及组件清单定位/跨容器移动/删除,先 load_skill("page-tools") 加载;read/write 数据工具恒可用',
        getContent: () => [
          '## page-tools 工具清单(已注入工具池,本会话常驻)',
          '- list_components(type?):组件清单(path 即 write 的 jsonPath;含容器 children 递归与嵌套深度)。修改/调序/移动/删除前先调它拿准确路径',
          '- move_component(path, targetPath):跨容器移动(连同子树移到目标容器 children 末尾)。同容器调序用 write move op,无需本工具',
          '- delete_component(path):删除组件(破坏性,自动挂人工确认)',
        ].join('\n'),
        // 工具工厂:load_skill 后注入工具池(SDK 按 name 去重,重复加载安全)—— editor_fangzhou page-tools 同款渐进披露
        tools: [() => structuralTools],
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
      // 独立模型 + 思考分层(output-quality-uplift + default-deep):主编排保持轻量,代码生成换强模型;
      // thinkingMode:'deep' 显式锁深思考(质量优先,token/耗时约 2-5×)/ 'simple' 剥思考省 token。
      // thinking-capable 模型(v4-pro/claude 等)才注 deep;flash 类传了也无效(editor 网关实测)→ 继承不注参
      llm: { provider: cfg.provider, apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: cfg.model },
      ...(/pro|claude|thinking|o1/i.test(cfg.model) ? { thinkingMode: 'deep' as const } : {}),
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
      <!-- 手动编辑三件套之 ③:选中组件的属性面板(点击组件出现;② 拖拽调序/移入容器在 PageRenderer) -->
      <PropsPanel v-if="selectedPath" :path="selectedPath" @close="selectedPath = null" @deleted="onManualDelete" @lift="onManualLift" />
      <EditableBanner title="AI 可编辑页面" hint="Agent 经 write 修改此区">
        <PageRenderer :selected-path="selectedPath" @select="onSelectComponent" @focus="onFocusComponent" @move="onManualMove" />
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
