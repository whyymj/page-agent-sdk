<script setup lang="ts">
/**
 * HTML 页面生成 demo(createHtmlSubagent 单模式 code-as-data-asset):
 *
 * - 子 agent 生成 v-html 注入用的 HTML 片段(无 <html>/<head>/<body>/DOCTYPE 外围,片段禁 <script>)
 * - 代码作为 data 资产:components[].code 字段(进服务端 DB),UI 直接绑 data.code 响应式渲染(无需镜像字段)
 * - vfs 作编辑工作副本:框架 beforeAgent checkout(data.code→vfs 按 __pgId)/ afterAgent commit(vfs→data.code 增量)自动搬运,主 agent 透明
 * - 格式校验链(formatCheck 默认开):validate_code 自检工具 + verify beforeReturn 门禁(回灌自纠)
 * - mock 服务端 persist:保存/加载按钮,演示 data json(含 code + __pgId)往返持久化(Git 模型类比:服务端 = remote repo)
 * - 修改已有代码:主 agent read data 看 components,task 告知子 agent 改哪个;子 agent vfs_edit 增量改工作副本,框架自动回写 data.code
 * - 多组件 + 焦点精修:点选预览区组件 → setFocus(components.<origIdx>) → 子 agent 继承焦点,只能改该组件代码(focus vfs 守卫硬约束,越界 PATH_DENIED);聚焦模式不能新建,新建前 clearFocus
 */
import { reactive, ref, computed, watch, watchEffect, onMounted, onUnmounted } from 'vue'
import { createChatSdk, createHtmlSubagent, type ChatSdk } from '../../src/core'
import { z } from 'zod'
import DevNav from '../_shared/DevNav.vue'

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
// 选中预览的组件(customComps 下标);越界回退到最后一个(组件被删/新增后保持有效)
const selectedKey = ref(0)
const userPinned = ref(false)  // 用户手动点选过后锁定,后续新建不再自动覆盖选中
// 新增组件(长度增加)且用户未锁定 → 自动切到最新(复刻旧 previewComp 取最后:生成后预览自动显示新组件)
watch(() => customComps.value.length, (n, old) => {
  if (!userPinned.value && n > old) selectedKey.value = n - 1
})
watchEffect(() => { if (selectedKey.value >= customComps.value.length) selectedKey.value = Math.max(0, customComps.value.length - 1) })
const selected = computed(() => customComps.value[selectedKey.value] ?? null)
const previewComp = computed(() => selected.value?.comp ?? null)
const previewName = computed(() => previewComp.value?.name ?? '')
const previewHtml = computed(() => (previewComp.value ? String(previewComp.value.code) : ''))
const previewSource = computed(() => previewHtml.value)
// 当前聚焦的组件原始索引(本地镜像;点击组件 setFocus,clearFocus 清;🎯 标记用。ChatDialog focus chip ✕ 移除不同步,仅视觉)
const focusedOrigIdx = ref(-1)
// 选中组件 = 切换预览 + setFocus 精修目标(子 agent 继承焦点 → focus vfs 守卫硬约束只能改该组件代码,越界 PATH_DENIED)
function selectComp(key: number) {
  selectedKey.value = key
  userPinned.value = true   // 用户手动锁定选中,后续新建组件不再自动覆盖
  const item = customComps.value[key]
  if (item) {
    agent?.setFocus({ path: `components.${item.origIdx}`, label: item.comp.name ?? `组件${item.origIdx}` })
    focusedOrigIdx.value = item.origIdx
  }
}
function clearCompFocus() {
  agent?.clearFocus()
  focusedOrigIdx.value = -1
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
    systemPrompt:
      '你是页面搭建助手,管理多个纯代码组件(data.components 数组,每个 custom 组件有 name + code 字段)。\n' +
      '【新建/创意类请求】(如「生成一个落地页」「做个专题页」):先用简短文字给出 2~3 套方案(每套一两句风格/配色/结构要点),询问用户选哪一套。**选定前不要委派生成代码、不要写 components**。用户选定后委派 use_html 子 agent 生成该方案代码;若是多区块页面,task 里列清各组件(name + 要点),子 agent 逐个 write **追加**进 components(勿覆盖已有组件)。\n' +
      '【明确/修改类请求】(如「把 hero 标题改成 XXX」「主色调改橙色」):无需出方案,直接处理。先 read data 看现有 components,task 里明确告知子 agent 改哪个组件(按 name,如「改 hero 组件的标题」);子 agent 经 vfs_edit 增量改工作副本,框架自动回写 data.code。\n' +
      '【焦点精修】若当前已聚焦某组件(用户在预览区点选了组件,你会看到精修目标提示),对话默认针对该焦点组件:task 里指明「只改 <焦点组件 name>」。子 agent 受焦点硬约束,只能改该组件的代码文件,改其他组件会被 PATH_DENIED 拦截。**聚焦模式下不能新建组件**(会被拦),新建前先让用户取消聚焦。\n' +
      '【方案切换】已生成某套方案后改选另一套:不重新罗列方案,直接依据之前的方案描述委派 use_html 重新生成目标方案代码并覆盖相应组件。生成前一句话复述「将生成方案N:<风格要点>」。\n' +
      '完成后告知用户预览已更新。',
    storage: 'memory',
    data: { schema: pageSchema, bind: pageBind, description: '页面(components 支持 custom 代码组件;code 字段是资产)' },
    // ★ 单模式(code-as-data-asset):代码作 data.code 资产,vfs 作工作副本,框架自动 checkout/commit
    //   去 onComplete(框架 afterAgent 自动 commit vfs→data.code);codeKind:'html'(v-html 片段)+ formatCheck 默认开
    subagents: [createHtmlSubagent({
      writablePaths: ['components'],
      codeKind: 'html',
    })],
    dialog: {
      title: 'HTML 页面生成(代码作 data 资产)',
      placeholder: '让 agent 生成页面(如「生成一个产品落地页」)…',
    },
  })

  // hook 仅取 validate_code 校验状态(辅助展示;主预览数据流走 data bind,不经 hook)
  agent.hook((e) => {
    const ev = e as any
    if (ev.type === 'subagent' && ev.kind === 'tool_result' && ev.name === 'validate_code') {
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
    <h1>HTML 页面生成子 agent(单模式:代码作 data 资产)</h1>
    <p>
      主 agent 调 <code>use_html</code> 委派子 agent 生成 <strong>HTML 片段</strong>(无
      <code>&lt;html&gt;/&lt;head&gt;/&lt;body&gt;</code> 外围、禁 <code>&lt;script&gt;</code>)。代码作为 <strong>data 资产</strong>存
      <code>components[].code</code>(进服务端 DB),<strong>vfs 作工作副本</strong>(框架自动 checkout/commit,主 agent 透明),左侧预览区经
      <strong>v-html</strong> 实时渲染。格式校验链:<code>validate_code</code> 自检 + verify 门禁。
    </p>
    <p class="hint">
      <strong>多组件 + 焦点精修</strong>:预览区点选某个组件即<strong>聚焦</strong>它(🎯),后续对话只精修该组件代码 ——
      子 agent 受焦点硬约束,改其他组件会被 PATH_DENIED 拦(防误改)。聚焦模式下不能新建组件,新建前先「取消聚焦」。
    </p>
    <div class="suggestions">
      <button v-for="s in SUGGESTIONS" :key="s" class="chip" @click="sendSuggestion(s)">{{ s }}</button>
    </div>

    <div class="cols">
      <div class="col preview-col">
        <h3>实时预览(v-html 渲染 data.code)</h3>
        <!-- 多组件切换栏:点击 = 选中预览 + setFocus 精修(子 agent 继承焦点,只能改该组件代码,越界 PATH_DENIED) -->
        <div class="comp-tabs" v-if="customComps.length">
          <button v-for="(c, key) in customComps" :key="c.origIdx"
            class="comp-tab" :class="{ active: key === selectedKey }"
            @click="selectComp(key)">
            {{ c.comp.name || `组件${c.origIdx}` }}
            <span class="focus-mark" v-if="focusedOrigIdx === c.origIdx">🎯</span>
          </button>
        </div>
        <p class="hint">
          <template v-if="!customComps.length">尚无代码;点上方建议或发消息触发 use_html</template>
          <template v-else>
            组件:{{ previewName }}
            <span v-if="focusedOrigIdx === selected?.origIdx" class="focus-info">(已聚焦 · 对话只精修该组件)</span>
            <button v-if="focusedOrigIdx >= 0" class="link-btn" @click="clearCompFocus">取消聚焦</button>
          </template>
          <span v-if="validateStatus" class="validate" :class="validateStatus.includes('✅') ? 'ok' : 'bad'">
            {{ validateStatus.includes('✅') ? '✅ 格式校验通过' : '❌ 校验有问题(自纠中)' }}
          </span>
        </p>
        <div class="preview" v-html="previewHtml"></div>
        <details class="code-view" v-if="previewSource">
          <summary>查看代码片段(data.code)</summary>
          <pre>{{ previewSource }}</pre>
        </details>
      </div>
      <div class="col">
        <h3>主 data:components({{ pageBind.components.length }})</h3>
        <p class="hint">custom 组件 code 字段存代码正文(资产);__pgId 框架无感注入(组件映射键)</p>
        <pre class="data-view">{{ JSON.stringify(pageBind.components, null, 2) }}</pre>

        <div class="persist">
          <h4>mock 服务端 persist(代码往返)</h4>
          <p class="hint">演示 data json(含 code + __pgId)保存/加载:代码随 data 进 DB,加载后 id 稳定、子 agent 能增量改</p>
          <div class="persist-btns">
            <button class="chip" @click="saveToServer">💾 保存到服务端</button>
            <button class="chip" :disabled="!mockServerSnapshot" @click="loadFromServer">📂 从服务端加载</button>
          </div>
          <p v-if="savedInfo" class="hint persist-info">{{ savedInfo }}</p>
        </div>

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
.chip:hover:not(:disabled) {
  border-color: var(--ark-accent);
  color: var(--ark-accent);
}
.chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.cols {
  display: grid;
  /* minmax(0,1fr):grid item 默认 min-width:auto,v-html 生成的宽内容(宽表/不换行长串)会撑爆 track 挤走右侧;minmax(0,..) 允许 track 收缩,宽内容改由 .preview overflow:auto 滚动 */
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.col {
  background: var(--ark-panel);
  border-radius: 8px;
  padding: 12px;
  min-width: 0;  /* 配合 minmax(0,1fr):允许 grid item 收缩(防 v-html 宽内容撑开列宽) */
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
.comp-tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
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
.focus-info {
  margin-left: 6px;
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
.persist {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed rgba(255, 255, 255, 0.12);
}
.persist h4 {
  font-size: 13px;
  margin-bottom: 4px;
}
.persist-btns {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}
.persist-info {
  margin-top: 6px;
  color: var(--ark-accent);
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
