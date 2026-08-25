/**
 * 写路径性能基准(write-path-cost-reduction 阶段 1/4a)
 *
 * 量化单次 `write({patch, autoLock})`(edit 意图)在 50KB/300KB/1MB 合成 bind 上的成本,
 * codeAsset(pgIdPaths → internalAfterWrite)/非 codeAsset 两模式,报 median/p95。
 * 不进 CI(环境 flaky 防护);改造前后各跑一轮,数字记入 change design §5。
 *
 * 用法:node tests/perf/write-path-bench.mjs(依赖 npm run build 先产出 dist)
 */
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import { createDataOps } from '../../dist/page-agent-sdk.js'

const N = Number(process.argv[2] ?? 200)   // 每档写入次数
const WARMUP = 20

/** 合成组件(~1KB:code 字段占大头,近似 complex-demo custom 形态) */
function makeComponent(i) {
  const pad = `padding-text-${i}-`.repeat(12) // ~220B
  return {
    type: i % 10 === 0 ? 'custom' : 'card',
    id: `cmp-${i}`,
    __pgId: `c_bench_${i}`,
    name: `组件${i}`,
    props: { title: `标题${i}`, desc: pad + pad, price: i * 10, tags: ['hot', `t${i}`] },
    style: { margin: '8px', padding: '12px', background: i % 2 ? '#222' : '#333' },
    code: `<section class="cmp" data-i="${i}"><style>.cmp{color:#eee;padding:16px}</style><h2>${pad.slice(0, 40)}</h2><p>${pad}</p><script>console.log('${i}')</script></section>`,
  }
}

const componentSchema = z.object({
  type: z.string(),
  id: z.string().optional(),
  __pgId: z.string().optional(),
  name: z.string().optional(),
  props: z.object({ title: z.string(), desc: z.string(), price: z.number(), tags: z.array(z.string()) }),
  style: z.record(z.string(), z.string()).optional(),
  code: z.string().optional(),
})
const pageSchema = z.object({ title: z.string(), components: z.array(componentSchema) })

function buildTools(n, codeAsset) {
  const bind = { title: 'bench', components: Array.from({ length: n }, (_, i) => makeComponent(i)) }
  const tools = createDataOps(
    { schema: pageSchema, bind, description: 'bench 页面' },
    codeAsset ? { pgIdPaths: ['components'] } : {},
  )
  const by = Object.fromEntries(tools.map((t) => [t.name, t]))
  return { bind, write: by['write'], read: by['read'] }
}

function stats(ms) {
  const s = [...ms].sort((a, b) => a - b)
  const median = s[Math.floor(s.length / 2)]
  const p95 = s[Math.floor(s.length * 0.95)]
  return { median, p95, mean: s.reduce((x, y) => x + y, 0) / s.length }
}

async function benchRound(n, codeAsset, label) {
  const { write, read, bind } = buildTools(n, codeAsset)
  await read.invoke({}) // 建立乐观锁基线(同 agent read→write 配对的真实前序)
  const args = () => ({ patch: { op: 'set', jsonPath: 'components.3.props.title', value: `t-${Math.random().toString(36).slice(2, 8)}` }, autoLock: true })
  for (let i = 0; i < WARMUP; i++) await write.invoke(args()) // JIT 预热
  const times = []
  for (let i = 0; i < N; i++) {
    const a = args()
    const t0 = performance.now()
    const r = await write.invoke(a)
    times.push(performance.now() - t0)
    if (/ERROR|INVALID|DENIED|CONFLICT/.test(String(r))) { console.error(`  ✗ 异常结果:${r.slice(0, 120)}`); process.exitCode = 1; return }
  }
  const st = stats(times)
  const kb = (JSON.stringify(bind).length / 1024).toFixed(0)
  console.log(`  ${label.padEnd(28)} bind≈${String(kb).padStart(4)}KB  median ${st.median.toFixed(1)}ms  mean ${st.mean.toFixed(1)}ms  p95 ${st.p95.toFixed(1)}ms`)
  return st
}

console.log(`write-path-bench(N=${N}/档,单 patch autoLock set,warmup ${WARMUP})`)
const rows = {}
for (const n of [50, 300, 1000]) {
  rows[`plain-${n}`] = await benchRound(n, false, `非 codeAsset × ${n} 组件`)
  rows[`codeasset-${n}`] = await benchRound(n, true, `codeAsset × ${n} 组件`)
}
console.log('\nJSON:', JSON.stringify(rows))
