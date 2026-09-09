/** persistRuntime 每轮全历史 JSON round-trip + checkpoint messages clone 量化 */
import { makeBind } from './mkbind'

function bench(name: string, fn: () => unknown, runs = 20): void {
  fn()
  const times: number[] = []
  for (let i = 0; i < runs; i++) { const t0 = performance.now(); fn(); times.push(performance.now() - t0) }
  times.sort((a, b) => a - b)
  console.log(`${name.padEnd(56)} median ${times[Math.floor(runs / 2)].toFixed(1)}ms`)
}

// 模拟 30 轮会话:每轮 user + assistant(steps 含工具结果;真 LLM 会话 steps 常是大头)
const toolResult = JSON.stringify(makeBind(8 * 1024)) // ~8KB 单工具结果
const msgs: any[] = []
for (let i = 0; i < 30; i++) {
  msgs.push({ role: 'user', content: `第 ${i} 轮指令:帮我修改组件 ${i} 的样式`, timestamp: Date.now() })
  msgs.push({
    role: 'assistant', content: `第 ${i} 轮完成,已修改组件。`,
    steps: Array.from({ length: 4 }, (_, j) => ({ name: j === 3 ? 'write' : 'read', result: toolResult, status: 'done' })),
    timestamp: Date.now(),
  })
}
const json = JSON.stringify(msgs)
console.log(`30 轮会话 messages JSON:${(json.length / 1024).toFixed(0)}KB\n`)
bench('persistRuntime: JSON.parse(JSON.stringify(msgs))', () => JSON.parse(JSON.stringify(msgs)))
bench('lighten 前的 stringify 单独', () => JSON.stringify(msgs))
bench('checkpoint save: messages clone(JSON 兜底)', () => JSON.parse(JSON.stringify(msgs)))
// checkpoint 栈 5 条驻留量
console.log(`checkpoint 栈 5 条 messages 驻留 ≈ ${(json.length * 5 / 1024 / 1024).toFixed(1)}MB(不含 bind/vfs 共享基线)`)
