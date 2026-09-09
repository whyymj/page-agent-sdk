/**
 * 性能 bench(六路审计 2026-09-09 实测基线脚本,C4 入库;手动运行:npx tsx tests/perf/<本文件>)
 * 不进 CI(先例 write-path-bench.mjs):数字受机器/负载影响,作前后对比参考非门禁。
 * 相关实测结论见 local/perf-audit-4.11.1.md(reactive 放大 3-10× / vfs 每写 5 次全池重扫 / 惰性 hash 收益)
 */
import { createVfs } from '../../src/core/backends/vfs'

function stats(times: number[]): string {
  const s = [...times].sort((a, b) => a - b)
  return `median ${s[Math.floor(s.length / 2)].toFixed(2)}ms  max ${s[s.length - 1].toFixed(2)}ms`
}

const scenarios: Array<[number, number]> = [[20, 30], [60, 30], [60, 100]]
for (const sc of scenarios) {
  const nFiles = sc[0]; const sizeKB = sc[1]
  const store = createVfs()
  const content = 'x'.repeat(sizeKB * 1024)
  for (let i = 0; i < nFiles; i++) {
    ;(store.files as any)[`large_results/r${i}.json`] = { content, updatedAt: Date.now() }
  }
  const times: number[] = []
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now()
    ;(store.files as any)[`large_results/w${i}.json`] = { content: content.slice(0, 1024), updatedAt: Date.now() }
    times.push(performance.now() - t0)
  }
  const totalMB = ((nFiles * sizeKB * 1024) / 1024 / 1024).toFixed(1)
  console.log(`xiezhu1 ${nFiles}files x ${sizeKB}KB pool~${totalMB}MB: ${stats(times)}`)
}

{
  const store = createVfs()
  const content = 'x'.repeat(60 * 1024)
  for (let i = 0; i < 100; i++) {
    ;(store.files as any)[`large_results/r${i}.json`] = { content, updatedAt: Date.now() }
  }
  const times: number[] = []
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now()
    ;(store.files as any)[`large_results/ev${i}.json`] = { content: content.slice(0, 2048), updatedAt: Date.now() }
    times.push(performance.now() - t0)
  }
  console.log(`eviction write (100 files 6MB pool): ${stats(times)}`)
}

{
  const bytes = new Map<string, number>()
  const files: Record<string, { content: string }> = {}
  const content = 'x'.repeat(30 * 1024)
  for (let i = 0; i < 60; i++) { files[`large_results/r${i}.json`] = { content }; bytes.set(`large_results/r${i}.json`, content.length) }
  const times: number[] = []
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now()
    const k = `large_results/w${i}.json`
    files[k] = { content: 'y'.repeat(1024) }
    bytes.set(k, 1024)
    let total = 0; for (const b of bytes.values()) total += b
    times.push(performance.now() - t0)
  }
  console.log(`ideal cached-bytes same scenario: ${stats(times)}`)
}
