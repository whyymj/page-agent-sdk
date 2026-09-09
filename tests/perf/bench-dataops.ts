/**
 * 性能 bench(六路审计 2026-09-09 实测基线脚本,C4 入库;手动运行:npx tsx tests/perf/<本文件>)
 * 不进 CI(先例 write-path-bench.mjs):数字受机器/负载影响,作前后对比参考非门禁。
 * 相关实测结论见 local/perf-audit-4.11.1.md(reactive 放大 3-10× / vfs 每写 5 次全池重扫 / 惰性 hash 收益)
 */
import { z } from 'zod'
import { reactive } from 'vue'
import { makeBind } from './mkbind'
import { createDataOps } from '../../src/core/tools/dataOps'

const schema = z.object({
  page: z.object({ title: z.string(), version: z.number(), locale: z.string(), updatedAt: z.string() }),
  theme: z.object({ primary: z.string(), radius: z.number(), fonts: z.array(z.string()) }),
  components: z.array(z.object({
    id: z.string(), type: z.string(), title: z.string(), visible: z.boolean(),
    props: z.object({
      width: z.number(), height: z.number(), theme: z.string(), style: z.string(),
      items: z.array(z.object({ label: z.string(), value: z.string(), active: z.boolean() })),
      code: z.string(),
    }).passthrough(),
    __pgId: z.string().optional(),
  }).passthrough()),
})

async function run(label: string, bind: any) {
  const tools = createDataOps({ schema, bind })
  const read = tools.find((t) => t.name === 'read')!
  const write = tools.find((t) => t.name === 'write')!
  const config = { configurable: {} }
  async function timeIt(name: string, fn: () => Promise<unknown>, runs = 20): Promise<void> {
    await fn()
    const times: number[] = []
    for (let i = 0; i < runs; i++) { const t0 = performance.now(); await fn(); times.push(performance.now() - t0) }
    times.sort((a, b) => a - b)
    console.log(`${label} ${name.padEnd(42)} median ${times[Math.floor(runs / 2)].toFixed(1)}ms  p95 ${times[Math.floor(runs * 0.95)].toFixed(1)}ms`)
  }
  await timeIt('read 窄读(components.0.title)', () => read.invoke({ jsonPath: 'components.0.title' }, config))
  await timeIt('read 中读(components.0)', () => read.invoke({ jsonPath: 'components.0' }, config))
  await timeIt('read 整读(不传 path)', () => read.invoke({}, config))
  await timeIt('write patch set(components.0.title)', () => write.invoke({ patch: { op: 'set', jsonPath: 'components.0.title', value: `新标题 ${Math.random()}` } }, config))
  const whole = JSON.parse(JSON.stringify(bind))
  whole.components[0].title = 'whole set title'
  await timeIt('write 整体 set(500KB value)', () => write.invoke({ value: whole }, config), 10)
}

async function main() {
  const bind = makeBind()
  console.log(`bind: ${(JSON.stringify(bind).length / 1024).toFixed(0)}KB, components=${bind.components.length}\n`)
  await run('[plain   ]', bind)
  const r = reactive(bind)
  ;(function touchAll(o: any) { if (o === null || typeof o !== 'object') return; if (Array.isArray(o)) { o.forEach(touchAll); return } for (const k of Object.keys(o)) touchAll(o[k]) })(r)
  await run('[reactive]', r)
}
main().catch((e) => { console.error(e); process.exit(1) })
