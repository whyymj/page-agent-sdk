<script setup lang="ts">
/**
 * HTML 页面生成 demo(createHtmlSubagent 单模式 code-as-data-asset):
 *
 * - 子 agent 生成完整、自包含的 HTML 页面(默认含 style+script 标签,可独立成页)
 * - 预览用 <iframe :srcdoc> 渲染(sandbox 隔离 + 执行 script,轮播/特效等交互真实跑起来;v-html 不执行 script)
 * - 代码作为 data 资产:components[].code 字段(进服务端 DB),UI 直接绑 data.code 响应式渲染(无需镜像字段)
 * - vfs 作编辑工作副本:框架 beforeAgent checkout(data.code→vfs 按 __pgId)/ afterAgent commit(vfs→data.code 增量)自动搬运,主 agent 透明
 * - 格式校验链(formatCheck 默认开):validate_code 自检工具 + verify beforeReturn 门禁(回灌自纠)
 * - mock 服务端 persist:保存/加载按钮,演示 data json(含 code + __pgId)往返持久化(Git 模型类比:服务端 = remote repo)
 * - 修改已有代码:主 agent read data 看 components,task 告知子 agent 改哪个;子 agent vfs_edit 增量改工作副本,框架自动回写 data.code
 * - 多组件 + 焦点精修:点选预览区组件 → setFocus(components.<origIdx>) → 子 agent 继承焦点,只能改该组件代码(focus vfs 守卫硬约束,越界 PATH_DENIED);聚焦模式不能新建,新建前 clearFocus
 * - 布局仿首页(page-demo):全屏左右双栏,左预览 / 右对话框,对话框默认 dark 主题(方舟专题色板)
 */
import { reactive, ref, computed, onMounted, onUnmounted } from 'vue'
import { createChatSdk, createHtmlSubagent, systemPromptHelpers, type ChatSdk } from '../../src/core'
import { z } from 'zod'
import DevNav from '../_shared/DevNav.vue'
import PickOverlay from '../_shared/PickOverlay.vue'

let agent: ChatSdk | null = null

// 主 data schema:components 数组(custom 代码组件 code 字段存代码正文 = 资产源)
// __pgId 由框架无感注入(schema 不声明,装配期 extend);code 是资产,随 data json 持久化
const pageSchema = z.object({
  title: z.string().describe('页面标题'),
  components: z
    .array(
      z.object({
        type: z.string().describe('组件类型;custom = 代码组件'),
        name: z.string().optional().describe('组件名(如 landing)'),
        code: z.string().optional().describe('custom 组件的 HTML 代码正文(资产,随 data json 持久化)'),
        props: z.record(z.string(), z.any()).optional().describe('组件 props'),
      }),
    )
    .describe('页面组件列表'),
})
const pageBind = reactive({
  title: 'HTML 页面生成演示',
  // 初始预置 hero 组件(含 __pgId,模拟从服务端 load 回来的 persisted data —— __pgId 是之前 write 时框架补的,跨会话稳定)。
  // 演示「修改现有组件」场景:框架 checkout(hero.code→vfs by __pgId)→ 子 vfs_edit → commit(vfs→data.code)。
  components: [
    { type: 'custom', name: 'hero', code: '<section class="pg-hero"><h1>演示页</h1><p>初始内容,可让 agent 修改(改色 / 文案 / 布局)</p></section>', __pgId: 'c_hero' },
    { type: 'custom', name: 'features', code: '<section class="pg-features" style="padding:16px;font-family:sans-serif"><h2 style="margin:0 0 12px">核心特性</h2><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px"><div style="background:#f5f5f5;padding:12px;border-radius:8px"><b>快速</b><p style="margin:4px 0 0">秒级生成</p></div><div style="background:#f5f5f5;padding:12px;border-radius:8px"><b>灵活</b><p style="margin:4px 0 0">对话精修</p></div><div style="background:#f5f5f5;padding:12px;border-radius:8px"><b>规范</b><p style="margin:4px 0 0">schema 校验</p></div></div></section>', __pgId: 'c_features' },
  ] as any[],
})

// validate_code 最近结果(✅/❌ 状态展示;辅助,经 hook 取,非主数据流)
const validateStatus = ref('')

// 多组件预览:列出所有 custom 代码组件(保留原始索引 origIdx,供 setFocus 用 components.<origIdx>)
const customComps = computed(() => {
  const list: Array<{ comp: any; origIdx: number }> = []
  pageBind.components.forEach((c: any, i: number) => {
    if (c.type === 'custom' && typeof c.code === 'string' && c.code.length > 0) list.push({ comp: c, origIdx: i })
  })
  return list
})
// 两步拾取(同首页 page-demo):点组件 = 选中(浮层 + 「加入聊天」按钮);点按钮 = 加入焦点(addFocus)
const selectedPath = ref<string | null>(null)
// 选中组件在 customComps 中的下标(由 selectedPath 派生;驱动预览高亮 + comp-tab active + 源代码 tab 内容)
const selectedKey = computed(() => {
  if (!selectedPath.value) return -1
  const m = /^components\.(\d+)$/.exec(selectedPath.value)
  if (!m) return -1
  return customComps.value.findIndex((c) => c.origIdx === Number(m[1]))
})
const selected = computed(() => (selectedKey.value >= 0 ? customComps.value[selectedKey.value] ?? null : null))
const previewComp = computed(() => selected.value?.comp ?? null)
const previewHtml = computed(() => (previewComp.value ? String(previewComp.value.code) : ''))
const previewSource = computed(() => previewHtml.value)
// iframe 自适应高度:保持 sandbox 隔离(无 allow-same-origin,父页面读不到 contentDocument)前提下,
// 往 srcdoc 末尾注入「自量高」脚本 → iframe 内 postMessage 把 scrollHeight 报回父页面 → 按 origIdx 记高度绑定 iframe style。
const iframeHeights = reactive<Record<number, number>>({})
// SFC 限制:script setup 块内不能出现字面的「script 开/闭标签」(编译器按字符序列匹配闭合,反斜杠逃逸无效)。
// 用字符串拼接拆开,运行时拼回,源码里不连续出现。
const SCRIPT_OPEN = '<' + 'script>'
const SCRIPT_CLOSE = '<' + '/script>'
function wrapPreviewHtml(code: string, idx: number): string {
  // 注入量高脚本(独立于 code,不污染 data.code):iframe 内 postMessage 把 scrollHeight 报回父页面按 origIdx 绑定高度。
  // 只量一次(load + 两次 setTimeout 兜底图片/字体加载),不挂 ResizeObserver/resize —— 否则内容若用 vh 单位
  // (如轮播 min-height:100vh)会形成「设高度→视口变→内容再变→再报告」的正反馈死循环,高度无限自增。
  const probe =
    '\n' + SCRIPT_OPEN +
    '(function(){var send=function(){var h=Math.max(document.body?document.body.scrollHeight:0,document.documentElement?document.documentElement.scrollHeight:0);if(h>0){try{parent.postMessage({__htmlPreview:true,idx:' + idx + ',h:h},\'*\')}catch(e){}}};\n' +
    'window.addEventListener(\'load\',send);\n' +
    'if(document.readyState===\'complete\'){send()}setTimeout(send,200);setTimeout(send,600)})();' +
    SCRIPT_CLOSE
  return code + probe
}
// 父页面监听量高消息:按 origIdx 记录高度(加 idx 范围 + 高度上限防异常值撑爆布局)
function onPreviewMessage(e: MessageEvent) {
  const d = e.data as { __htmlPreview?: boolean; idx?: number; h?: number } | null
  if (!d || d.__htmlPreview !== true) return
  const { idx, h } = d
  if (typeof idx === 'number' && idx >= 0 && typeof h === 'number' && h > 0 && h < 20000) {
    iframeHeights[idx] = h
  }
}
// 当前聚焦的组件 path 集合(经 focus_change 事件与 SDK 双向同步;支持多焦点,每个聚焦组件显 🎯)
const focusedPaths = ref<Set<string>>(new Set())
const isFocused = (origIdx: number) => focusedPaths.value.has(`components.${origIdx}`)
// 预览容器 ref(PickOverlay 两步拾取浮层的定位根:querySelector [data-path])
const previewRef = ref<HTMLElement>()
// 视图 tab:预览 / 源代码 / 主 data
const viewMode = ref<'preview' | 'code' | 'data'>('preview')
// 第 1 步:点组件(comp-tab 或预览块)= 选中(不聚焦;显示浮层 + 「加入聊天」按钮)
function onSelect(path: string) {
  selectedPath.value = path
}
// 第 2 步:点「加入聊天」按钮 = 加入焦点(multi-focus 累积,同首页;子 agent 继承焦点只能改这些组件代码)
function onFocus(path: string) {
  const m = /^components\.(\d+)$/.exec(path)
  const idx = m ? Number(m[1]) : -1
  const comp = pageBind.components[idx] as any
  agent?.addFocus({ path, label: comp?.name ? String(comp.name) : path })
  selectedPath.value = null  // 加入后清选中态(浮层消失,对话框 chip 接管)
}
function clearCompFocus() {
  agent?.clearFocus()  // focusedPaths 经 focus_change 事件同步
}

// mock 服务端 DB(本地内存):演示 data json(含 code + 框架注入的 __pgId)往返持久化
const mockServerSnapshot = ref<{ title: string; components: unknown[] } | null>(null)
const savedInfo = ref('')
function saveToServer() {
  // 深拷贝当前 data(含框架注入的 __pgId,作组件稳定映射键)
  mockServerSnapshot.value = JSON.parse(JSON.stringify({ title: pageBind.title, components: pageBind.components }))
  savedInfo.value = `已保存到 mock 服务端(${(pageBind.components as any[]).length} 组件)`
}
function loadFromServer() {
  if (!mockServerSnapshot.value) return
  const snap = mockServerSnapshot.value
  pageBind.title = snap.title
  pageBind.components = JSON.parse(JSON.stringify(snap.components)) as any[]
  // __pgId 随 components 恢复(框架 load 后 checkout 映射稳定,跨会话/跨设备 id 不变)
  savedInfo.value = `已从 mock 服务端加载(${snap.components.length} 组件)`
}

onMounted(() => {
  agent = createChatSdk({
    id: 'html-page-demo',
    llm: {
      apiKey: import.meta.env.VITE_AI_API_KEY,
      baseUrl: import.meta.env.VITE_AI_BASE_URL,
      model: import.meta.env.VITE_AI_MODEL,
    },
    // ★ 编排段由 createHtmlSubagent 装配期自动注入(orchestratorPrompt 默认 true),勿手动 spread htmlPageOrchestrator(会双重注入);
    // 此处只留业务身份 + opt-in 片段(先出方案 htmlPageProposeFirst)+ 焦点精修特有规则。
    systemPrompt:
      '你是页面搭建助手,管理多个纯代码组件(data.components 数组,每个 custom 组件有 name + code 字段)。\n' +
      '【焦点精修】若当前聚焦某组件,对话默认针对该焦点组件:task 里指明「只改 <焦点组件 name>」,子 agent 受硬约束只能改该组件代码(越界 PATH_DENIED)。聚焦时仍可新建组件(尾部追加放行),但精修类请求优先聚焦。\n' +
      '完成后告知用户预览已更新。',
    maxToolRounds: 25,  // 多组件逐个委派需更多轮次(每组件≈委派+read 2 轮);默认 10 仅够~5 组件,抬到 25 给 ~10 组件空间
    storage: 'memory',
    data: { schema: pageSchema, bind: pageBind, description: '页面(components 支持 custom 代码组件;code 字段是资产)' },
    // ★ 单模式(code-as-data-asset):代码作 data.code 资产,vfs 作工作副本,框架自动 checkout/commit;formatCheck 默认开
    // dialog.theme 默认 dark(首页方舟专题色板),无需显式配置
    // writablePaths 省略(3.6+):装配期从 schema 自动推断(components 数组元素含 code 字段 → ['components'])
    subagents: [createHtmlSubagent()],
    dialog: {
      title: 'HTML 页面生成(代码作 data 资产)',
      placeholder: '让 agent 生成页面(如「生成一个产品落地页」)…',
    },
  })

  // hook:① validate_code 校验状态(辅助展示)② focus_change 同步 🎯 镜像(对话框 chip ✕ 移除焦点也同步)
  agent.hook((e) => {
    const ev = e as any
    if (ev.type === 'round_start') {
      validateStatus.value = ''  // 每轮归零:避免上一轮 validate_code 中间态 ❌ 残留(子 agent 修好后可能不再复查,靠 verify 门禁放行)
    } else if (ev.type === 'subagent' && ev.kind === 'tool_result' && ev.name === 'validate_code') {
      validateStatus.value = String(ev.result ?? '')
    } else if (ev.type === 'focus_change') {
      focusedPaths.value = new Set((ev.focuses as Array<{ path: string }>).map((x) => x.path))
    }
  })

  agent.mount('#chat-root')
  // 调试/脚本钩子:暴露 sdk(同 complex-demo;收集子 agent 事件、读 data 状态用)
  ;(window as any).__sdk = agent

  // iframe 自适应高度:监听子 iframe 量高消息(经 postMessage 报回,保 sandbox 隔离)
  window.addEventListener('message', onPreviewMessage)
})

onUnmounted(() => {
  window.removeEventListener('message', onPreviewMessage)
  agent?.unmount()
})

const SUGGESTIONS = ['生成一个产品落地页', '做一个年货节专题页', '把主色调改成橙色']
function sendSuggestion(text: string) {
  agent?.send(text)
}
</script>

<template>
  <DevNav />
  <div class="layout">
    <!-- 左栏:组件切换栏 + 视图 tab(预览/源代码/主 data)+ 内容区 -->
    <aside class="pane pane-left">
      <div class="pane-head">
        <h1>HTML 页面生成(单模式:代码作 data 资产)</h1>
        <p class="hint">
          <code>use_html</code> 子 agent 生成完整 HTML 页面,代码作 <code>components[].code</code> 资产。
          <strong>点选组件即聚焦</strong>(🎯),对话只精修该组件(focus vfs 守卫);聚焦时仍可新建组件(尾部追加)。
        </p>
        <p class="hint">
          ✅ 预览用 <code>&lt;iframe :srcdoc&gt;</code> 渲染(sandbox 隔离 + 执行 <code>&lt;script&gt;</code>),轮播/特效等交互真实跑起来。产物是完整可运行页面,生产经插件/tool 改造成组件/独立页。
        </p>
        <div class="suggestions">
          <button v-for="s in SUGGESTIONS" :key="s" class="chip" @click="sendSuggestion(s)">{{ s }}</button>
        </div>
        <!-- 组件切换栏:点击 = 选中(第 1 步,显示浮层 + 「加入聊天」按钮);🎯 标已聚焦组件 -->
        <div class="comp-tabs" v-if="customComps.length">
          <button v-for="(c, key) in customComps" :key="c.origIdx"
            class="comp-tab" :class="{ active: key === selectedKey, focused: isFocused(c.origIdx) }"
            @click="onSelect(`components.${c.origIdx}`)">
            {{ c.comp.name || `组件${c.origIdx}` }}
            <span class="focus-mark" v-if="isFocused(c.origIdx)">🎯</span>
          </button>
        </div>
        <p class="hint preview-meta">
          <span v-if="selected && isFocused(selected.origIdx)" class="focus-info">已聚焦 · 对话只精修该组件</span>
          <span v-else-if="focusedPaths.size" class="focus-info">已聚焦 {{ focusedPaths.size }} 个组件</span>
          <button v-if="focusedPaths.size" class="link-btn" @click="clearCompFocus">取消聚焦</button>
          <span v-if="validateStatus" class="validate" :class="validateStatus.includes('✅') ? 'ok' : 'bad'" :title="validateStatus">
            {{ validateStatus.includes('✅') ? '✅ 格式校验通过' : '❌ 校验有问题(自纠中,悬停看详情)' }}
          </span>
        </p>
        <!-- 视图 tab:预览 / 源代码 / 主 data -->
        <div class="view-tabs">
          <button class="view-tab" :class="{ active: viewMode === 'preview' }" @click="viewMode = 'preview'">预览</button>
          <button class="view-tab" :class="{ active: viewMode === 'code' }" @click="viewMode = 'code'">源代码</button>
          <button class="view-tab" :class="{ active: viewMode === 'data' }" @click="viewMode = 'data'">主 data</button>
        </div>
      </div>
      <!-- 内容区:按视图 tab 切换(撑满剩余高度) -->
      <div class="pane-content">
        <!-- 预览:整页堆叠(所有组件纵向;点组件块 = 选中第 1 步 → 浮层「加入聊天」按钮 → 第 2 步聚焦)。
             每个组件用 <iframe :srcdoc> 渲染完整页面级 HTML(sandbox 隔离 + 执行 script,v-html 不执行 script → 轮播/特效跑不起来) -->
        <div v-if="viewMode === 'preview'" ref="previewRef" class="preview">
          <div v-if="!customComps.length" class="preview-empty">尚无代码;点上方建议或发消息触发 use_html</div>
          <div v-for="(c, key) in customComps" :key="c.origIdx"
            class="preview-comp" :class="{ selected: key === selectedKey, focused: isFocused(c.origIdx) }"
            :data-path="`components.${c.origIdx}`"
            :title="`点击选中 ${c.comp.name || '组件' + c.origIdx}(再加入聊天聚焦)`"
            @click="onSelect(`components.${c.origIdx}`)">
            <iframe class="preview-iframe"
              :srcdoc="wrapPreviewHtml(String(c.comp.code), c.origIdx)"
              :style="{ height: (iframeHeights[c.origIdx] || 420) + 'px' }"
              sandbox="allow-scripts allow-modals allow-popups allow-forms"
              title="组件预览"></iframe>
            <!-- 点击捕获层:iframe(sandbox 无 allow-same-origin)吞 click,事件不冒泡回父页 → 需透明层代理两步拾取第 1 步(同首页「点组件即选中」)。
                 已聚焦组件撤层:iframe 内交互(轮播/特效)直接可用,聚焦期间以精修 + 体验为主 -->
            <div v-if="!isFocused(c.origIdx)" class="pick-capture"
              @click.stop="onSelect(`components.${c.origIdx}`)"></div>
          </div>
        </div>
        <!-- 源代码:选中组件的 code -->
        <pre v-else-if="viewMode === 'code'" class="code-pane">{{ previewSource || '(无选中组件,左侧预览点选一个)' }}</pre>
        <!-- 主 data:components JSON -->
        <pre v-else class="data-pane">{{ JSON.stringify(pageBind.components, null, 2) }}</pre>
      </div>
      <!-- 两步拾取浮层(同首页 page-demo:选中组件显示边框 + 「加入聊天」按钮 → addFocus) -->
      <PickOverlay :selected-path="selectedPath" :container="previewRef ?? null" @focus="onFocus" />
      <div class="pane-foot">
        <div class="persist">
          <span class="hint">mock 服务端 persist:</span>
          <button class="chip sm" @click="saveToServer">💾 保存</button>
          <button class="chip sm" :disabled="!mockServerSnapshot" @click="loadFromServer">📂 加载</button>
          <span v-if="savedInfo" class="hint persist-info">{{ savedInfo }}</span>
        </div>
      </div>
    </aside>
    <!-- 右栏:对话框(默认 dark 主题,与首页统一) -->
    <section id="chat-root" class="pane pane-right"></section>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  color: var(--ark-fg);
  font-family: system-ui, sans-serif;
}
.pane-left {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 20px;
  overflow: hidden;
}
.pane-right {
  flex: 1;
  min-width: 0;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  background: var(--ark-panel);
}
/* 对话框撑满右栏(同首页 page-demo) */
.pane-right > :deep(.chat-dialog) {
  width: 100%;
  height: 100%;
}
.pane-head {
  flex-shrink: 0;
}
.pane-head h1 {
  font-size: 18px;
  margin: 0 0 6px;
}
.hint {
  font-size: 12px;
  color: var(--ark-muted);
  line-height: 1.6;
  margin-bottom: 8px;
}
.hint code {
  background: var(--ark-panel);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 11px;
}
.suggestions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.chip {
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: var(--ark-panel);
  color: var(--ark-fg);
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
}
.chip:hover:not(:disabled) {
  border-color: var(--ark-accent);
  color: var(--ark-accent);
}
.chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.chip.sm {
  padding: 2px 10px;
  font-size: 11px;
}
.comp-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.comp-tab {
  border: 1px solid rgba(255, 255, 255, 0.16);
  background: var(--ark-panel);
  color: var(--ark-fg);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.comp-tab:hover {
  border-color: var(--ark-accent);
  color: var(--ark-accent);
}
.comp-tab.active {
  border-color: var(--ark-accent);
  color: var(--ark-accent);
  font-weight: 600;
}
.focus-mark {
  margin-left: 2px;
}
.preview-meta {
  min-height: 18px;
}
.focus-info {
  color: var(--ark-accent);
}
.link-btn {
  margin-left: 8px;
  background: none;
  border: none;
  color: var(--ark-muted);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}
.link-btn:hover {
  color: var(--ark-accent);
}
.validate {
  margin-left: 8px;
}
.validate.ok {
  color: #4caf50;
}
.validate.bad {
  color: #ff7043;
}
/* 视图 tab(预览/源代码/主 data) */
.view-tabs { display: flex; gap: 4px; margin-top: 6px; }
.view-tab { border: 1px solid rgba(255, 255, 255, 0.16); background: var(--ark-panel); color: var(--ark-muted); border-radius: 6px 6px 0 0; padding: 3px 12px; font-size: 11px; cursor: pointer; }
.view-tab:hover { color: var(--ark-fg); }
.view-tab.active { background: var(--ark-bg); color: var(--ark-accent); border-bottom-color: transparent; font-weight: 600; }
/* 内容区:撑满左栏剩余高度;视图 tab 切换内容 */
.pane-content { flex: 1; min-height: 0; display: flex; flex-direction: column; margin-top: 8px; }
/* 预览:整页堆叠(撑满内容区;点块 = 第 1 步选中 → PickOverlay 浮层「加入聊天」→ 第 2 步聚焦) */
.preview { flex: 1; min-height: 0; background: #fff; border-radius: 0 8px 8px 8px; overflow: auto; padding: 8px; }
.preview-empty { padding: 40px; text-align: center; color: #9ca3af; font-size: 13px; }
.preview-comp { cursor: pointer; border: 2px dashed transparent; border-radius: 6px; transition: border-color 0.15s; margin-bottom: 8px; position: relative; }
/* 拾取捕获层:盖住 iframe(点击 = 选中第 1 步);聚焦后撤层放行 iframe 内交互 */
.pick-capture { position: absolute; inset: 0; z-index: 1; cursor: pointer; }
/* iframe 渲染完整页面级 HTML(sandbox 隔离 + 执行 script)。
   高度自适应:注入脚本 postMessage 报 scrollHeight 回父页面按 origIdx 绑定(默认 420px 兜底);
   无 allow-same-origin(安全隔离,P0-2)下靠 postMessage 量高,不破坏隔离 */
.preview-iframe { display: block; width: 100%; border: none; background: #fff; border-radius: 4px; transition: height 0.15s ease; }
.preview-comp:hover { border-color: rgba(100, 91, 255, 0.35); }
.preview-comp.selected { border-color: #645bff; }  /* 第 1 步选中(紫虚线;PickOverlay 浮层接管边框) */
.preview-comp.focused { border-style: solid; border-color: #10b981; box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2); }  /* 已聚焦(绿) */
.comp-tab.focused { border-color: #10b981; color: #10b981; }
/* 源代码 / 主 data pane(pre 撑满内容区,滚动) */
.code-pane, .data-pane {
  flex: 1; min-height: 0; margin: 0; padding: 12px; background: var(--ark-bg); border-radius: 0 8px 8px 8px;
  font-size: 11px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; overflow: auto; color: var(--ark-fg);
  font-family: 'SF Mono', Monaco, Consolas, monospace;
}
.pane-foot {
  flex-shrink: 0;
  display: flex;
  gap: 12px;
  align-items: flex-start;
  flex-wrap: wrap;
}
.persist {
  display: flex;
  align-items: center;
  gap: 6px;
}
.persist .hint {
  margin: 0;
}
.persist-info {
  color: var(--ark-accent);
}
</style>
