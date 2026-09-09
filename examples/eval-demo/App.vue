<script setup lang="ts">
/**
 * eval-toolkit 回归面板(headless 自建 UI 示例)
 *
 * 演示集成方升级前回归的最小闭环:
 *   ① 跑一轮真实业务场景(send)→ ② waitForIdle 等 agent 真正完成 → ③ collectReport 采报告
 *   → ④ diffReport 对基线(token ±15% 且 ±2000 / toolCount ±3)→ ▲疑似回归就别急着升级
 *   ⑤ 满意的运行「存为基线」(localStorage),下次升级 SDK 后跑同场景对比
 *
 * 红线对应:SDK 只出判定/等待/对比纯函数;发消息、断言业务结果(此处是 bind.title 是否真改了)是你的测试栈的事。
 */
import { onMounted, onUnmounted, reactive, ref, shallowRef } from 'vue'
import { createChatSdk, createEvalHarness, diffReport, z, type ChatSdk, type EvalReport, type EvalDiffResult } from '../../src/core'
import DevNav from '../_shared/DevNav.vue'

const cfg = {
  apiKey: import.meta.env.VITE_AI_API_KEY,
  baseUrl: import.meta.env.VITE_AI_BASE_URL,
  model: import.meta.env.VITE_AI_MODEL,
}
const hasKey = !!cfg.apiKey

const pageSchema = z.object({
  title: z.string().describe('页面标题'),
  theme: z.enum(['light', 'dark']).describe('主题'),
  items: z.array(z.object({ name: z.string().describe('条目名') })).describe('条目'),
})
const bind = reactive({ title: '回归基线页', theme: 'light', items: [{ name: 'a' }] })

const sdk = shallowRef<ChatSdk | null>(null)
const prompt = ref('把标题改成「eval 演示页」,主题换成 dark,并加一条名为 smoke 的条目')
const running = ref(false)
const report = ref<EvalReport | null>(null)
const diff = ref<EvalDiffResult | null>(null)
const businessOk = ref<boolean | null>(null)
const note = reactive({ lines: [] as string[] })
const BASELINE_KEY = 'eval-demo-baseline'

onMounted(() => {
  if (!hasKey) return
  sdk.value = createChatSdk({
    ui: false, // headless:本页面就是自建 UI
    id: 'eval-demo',
    storage: 'memory',
    llm: cfg,
    systemPrompt: '你是数据操作助手,严格按 schema 修改数据后简短确认。',
    data: { schema: pageSchema, bind, description: '回归演示数据' },
  })
  void sdk.value.mount()
})
onUnmounted(() => sdk.value?.unmount())

function loadBaseline(): Record<string, number> | null {
  try { return JSON.parse(localStorage.getItem(BASELINE_KEY) || 'null') } catch { return null }
}

async function runOnce() {
  if (!sdk.value || running.value) return
  running.value = true
  report.value = null; diff.value = null; businessOk.value = null
  note.lines = []
  try {
    const h = createEvalHarness({ sdk: sdk.value })
    const baselineMsgs = sdk.value.messages.length // 发送前记基线(idle 判定「有新消息」下界)
    const t0 = performance.now()
    await sdk.value.send(prompt.value)
    const st = await h.waitForIdle({ baselineMessageCount: baselineMsgs, timeoutMs: 300_000, onSample(s) { note.lines.push(`采样: msgs=${s.messageCount} quiet=${Math.round(s.quietMs / 1000)}s active=${s.activeSubagents} logs=${s.logCount}`) } })
    note.lines.push(`idle 判定通过(连续采样满足双条件;耗时 ${Math.round((performance.now() - t0) / 1000)}s)`)
    report.value = h.collectReport()
    const base = loadBaseline()
    if (base) diff.value = diffReport({ prompt: report.value.usage.prompt, completion: report.value.usage.completion, toolCount: report.value.toolCount }, base)
    else note.lines.push('(无基线 —— 点「存为基线」后再跑可对比)')
    businessOk.value = bind.title.includes('eval 演示页') && bind.theme === 'dark' && bind.items.some((i) => i.name === 'smoke')
  } catch (e) {
    note.lines.push(`失败:${(e as Error).message}`)
  } finally {
    running.value = false
  }
}

function saveBaseline() {
  if (!report.value) return
  localStorage.setItem(BASELINE_KEY, JSON.stringify({ prompt: report.value.usage.prompt, completion: report.value.usage.completion, toolCount: report.value.toolCount }))
  note.lines.push('已存为基线(localStorage;下次升级 SDK 后跑同场景对比)')
}

const flagText = (f: string) => (f === 'up' ? '▲ 疑似回归' : f === 'down' ? '▼ 改善' : '持平')
</script>

<template>
  <DevNav />
  <div class="wrap">
    <h1>eval-toolkit 回归面板</h1>
    <p class="desc">升级 SDK 前为<b>自己的场景</b>跑回归:send → waitForIdle(双条件 idle 判定)→ collectReport → diffReport 对基线(▲ 即别急着升级)。满意的一轮「存为基线」。</p>
    <p v-if="!hasKey" class="warn">⚠ .env 无 VITE_AI_API_KEY —— 配置后刷新(与真 LLM 套件同口径)。</p>
    <template v-else>
      <section class="card">
        <label>场景指令(固定它,回归才有可比性)</label>
        <textarea v-model="prompt" rows="2"></textarea>
        <div class="row">
          <button class="primary" :disabled="running" @click="runOnce">{{ running ? '跑测中…' : '▶ 跑一轮回归' }}</button>
          <button :disabled="!report" @click="saveBaseline">存为基线</button>
        </div>
      </section>
      <section v-if="report" class="card">
        <h3>报告(collectReport)</h3>
        <table>
          <tr><td>prompt</td><td>{{ report.usage.prompt }}</td></tr>
          <tr><td>completion</td><td>{{ report.usage.completion }}</td></tr>
          <tr><td>toolCount</td><td>{{ report.toolCount }}</td></tr>
          <tr><td>messageCount</td><td>{{ report.messageCount }}</td></tr>
          <tr><td>业务断言(bind 真改了)</td><td>{{ businessOk === true ? '✓ 通过' : businessOk === false ? '✗ 未达预期' : '—' }}</td></tr>
        </table>
      </section>
      <section v-if="diff" class="card" :class="{ worse: diff.status === 'worse' }">
        <h3>基线对比(diffReport)<template v-if="diff.status === 'worse'"> —— ▲ 有指标超阈值,升级需慎</template></h3>
        <table>
          <tr v-for="f in diff.fields" :key="f.key"><td>{{ f.key }}</td><td>{{ f.prev }} → {{ f.cur }}({{ f.pct >= 0 ? '+' : '' }}{{ f.pct }}%)</td><td>{{ flagText(f.flag) }}</td></tr>
        </table>
      </section>
      <section v-if="note.lines.length" class="card logs">
        <div v-for="(l, i) in note.lines" :key="i">{{ l }}</div>
      </section>
      <section class="card">
        <h3>当前数据(被测对象)</h3>
        <pre>{{ JSON.stringify(bind, null, 2) }}</pre>
      </section>
    </template>
  </div>
</template>

<style scoped>
.wrap { max-width: 760px; margin: 72px auto 0; padding: 0 20px; font-family: system-ui, sans-serif; color: var(--ark-fg, #222); }
h1 { font-size: 22px; }
.desc { color: var(--ark-muted, #666); line-height: 1.6; }
.warn { color: #d97706; }
.card { border: 1px solid var(--ark-border, #ddd); border-radius: 10px; padding: 14px 16px; margin: 12px 0; }
.card.worse { border-color: #dc2626; }
.card h3 { margin: 0 0 8px; font-size: 14px; }
label { font-size: 13px; color: var(--ark-muted, #666); }
textarea { width: 100%; box-sizing: border-box; margin: 6px 0 10px; padding: 8px; border-radius: 8px; border: 1px solid var(--ark-border, #ddd); font: inherit; }
.row { display: flex; gap: 10px; }
button { padding: 8px 16px; border-radius: 8px; border: 1px solid var(--ark-border, #ddd); background: #fff; cursor: pointer; font: inherit; }
button.primary { background: #1f4d3a; color: #fff; border-color: #1f4d3a; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
table { border-collapse: collapse; font-size: 13px; }
td { padding: 3px 14px 3px 0; }
pre { background: #f6f6f8; padding: 10px; border-radius: 8px; font-size: 12px; overflow: auto; }
.logs { font-size: 12px; color: var(--ark-muted, #666); line-height: 1.7; }
</style>
