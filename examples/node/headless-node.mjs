/**
 * server-companion Phase 0:node 真 LLM 冒烟 —— 同一套 SDK(headless dist 产物)在 node 跑完整 ReAct。
 *
 * 证明面:e2e 全家虽然天天在 node 跑 dist,但那是 stub model;本脚本用真 LLM 构造(constructLlm 全路径)
 * 走完 read → write → restore_data 三工具循环,断言 bind 真实变化 + 回退,storage 用默认 memory 后端。
 *
 * 跑法:`npm run test:node-real`(或 `node examples/node/headless-node.mjs`);
 * `.env` 无 VITE_AI_API_KEY 自动 skip(exit 0);`--arm=anthropic` 只跑 Anthropic 协议臂(默认双臂依次跑,有 key 的才跑)。
 * 凭据只读本地 .env(gitignore),不进代码/仓库。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// ---- .env 手工解析(零依赖)----
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const env = {}
try {
  for (const line of readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim())
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
  }
} catch { /* 无 .env → 全 skip */ }

const onlyArm = process.argv.find((a) => a.startsWith('--arm='))?.slice(6)

if (!env.VITE_AI_API_KEY && !env.VITE_ANTHROPIC_API_KEY) {
  console.log('[node-smoke] skip:无 VITE_AI_API_KEY / VITE_ANTHROPIC_API_KEY(与既有真 LLM 套件同口径)')
  process.exit(0)
}

// dist 产物(不是 src!)—— 证明的是「npm 包形态在 node 可跑」;bare specifier 从仓库根 node_modules 解析
const { createChatSdk, z } = await import(path.join(root, 'dist/page-agent-sdk.headless.js'))

const WATCHDOG_MS = 240_000
let failed = 0

/** 单臂冒烟:一轮写(read→write)+ 一轮回退(restore_data),断言 bind 真实变化 */
async function runArm(arm) {
  const llm = arm === 'anthropic'
    ? { provider: 'anthropic', apiKey: env.VITE_ANTHROPIC_API_KEY, baseUrl: env.VITE_ANTHROPIC_BASE_URL, model: env.VITE_ANTHROPIC_MODEL }
    : { apiKey: env.VITE_AI_API_KEY, baseUrl: env.VITE_AI_BASE_URL, model: env.VITE_AI_MODEL }

  const schema = z.object({
    title: z.string().describe('页面标题'),
    items: z.array(z.object({ name: z.string().describe('条目名'), stock: z.number().describe('库存') })).describe('条目列表'),
  })
  const bind = { title: '冒烟前标题', items: [{ name: 'origin', stock: 1 }] }

  const sdk = createChatSdk({
    id: `node-smoke-${arm}`,
    ui: false,
    storage: 'memory',
    llm,
    systemPrompt: '你是数据操作助手。严格按 schema 修改数据,改完简短确认。',
    data: { schema, bind, description: '冒烟测试数据' },
  })
  await sdk.mount()

  const assert = (cond, msg) => {
    console.log(`  ${cond ? '✓' : '✗'} ${msg}`)
    if (!cond) failed++
  }
  const toolNames = () => sdk.debugLogs.value.filter((l) => l?.data?.tool).map((l) => l.data.tool).join(',') ||
    sdk.debugLogs.value.filter((l) => l.type === 'tool_call').map((l) => l.data?.name).filter(Boolean).join(',')

  console.log(`\n[node-smoke:${arm}] round 1 —— 写入(write 循环)`)
  await sdk.send('把 title 改成「node 冒烟通过」,并在 items 里新增一条 {name:"smoke", stock: 7}')
  assert(bind.title === 'node 冒烟通过', `bind.title 写入生效(实际 "${bind.title}")`)
  assert(bind.items.some((it) => it.name === 'smoke' && it.stock === 7), 'bind.items 新增条目生效')

  console.log(`[node-smoke:${arm}] round 2 —— 回退(restore_data 循环)`)
  await sdk.send('用 restore_data 工具回退你刚才的修改,回到修改前的数据')
  assert(bind.title === '冒烟前标题', `回退后 bind.title 复原(实际 "${bind.title}")`)
  assert(!bind.items.some((it) => it.name === 'smoke'), '回退后新增条目移除')

  console.log(`[node-smoke:${arm}] 工具轨迹:${toolNames() || '(debugLogs 无 tool 记录,检查日志面)'}`)
  sdk.unmount()
}

for (const arm of ['openai', 'anthropic']) {
  if (onlyArm && arm !== onlyArm) continue
  if (arm === 'openai' && !env.VITE_AI_API_KEY) { console.log(`[node-smoke:${arm}] skip:无 key`); continue }
  if (arm === 'anthropic' && !env.VITE_ANTHROPIC_API_KEY) { console.log(`[node-smoke:${arm}] skip:无 key`); continue }
  const t = setTimeout(() => { console.error(`[node-smoke:${arm}] TIMEOUT ${WATCHDOG_MS / 1000}s —— 看门狗退出`); process.exit(2) }, WATCHDOG_MS)
  try {
    await runArm(arm)
  } catch (e) {
    console.error(`[node-smoke:${arm}] 异常:`, e?.message ?? e)
    failed++
  }
  clearTimeout(t)
}

console.log(`\n==== node-smoke: ${failed === 0 ? 'ALL PASS' : failed + ' FAILED'} ====`)
process.exit(failed === 0 ? 0 : 1)
