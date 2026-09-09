/** N4:reactive 深度代理开销量化 —— deepClone / JSON.stringify / hashValue / structuredClone / watchFieldsHash */
import { reactive, toRaw } from 'vue'
import { makeBind } from './mkbind'
import { deepClone, hashValue, watchFieldsHash, safeStringify } from '../../src/core/tools/jsonUtils'

const bind = makeBind()
const sizeKB = (JSON.stringify(bind).length / 1024).toFixed(0)
console.log(`bind 体积:${sizeKB}KB,components=${bind.components.length}`)

// vue reactive 深度惰性代理:先访问一遍逼出全部代理节点(模拟长会话后全树已被读过的稳态)
const r = reactive(bind)
;(function touchAll(o: any) {
  if (o === null || typeof o !== 'object') return
  if (Array.isArray(o)) { o.forEach(touchAll); return }
  for (const k of Object.keys(o)) touchAll(o[k])
})(r)

function bench(name: string, fn: () => unknown, runs = 30): void {
  fn() // warmup
  const times: number[] = []
  let result: unknown
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    result = fn()
    times.push(performance.now() - t0)
  }
  times.sort((a, b) => a - b)
  const med = times[Math.floor(runs / 2)]
  const p95 = times[Math.floor(runs * 0.95)]
  console.log(`${name.padEnd(46)} median ${med.toFixed(2)}ms  p95 ${p95.toFixed(2)}ms`)
}
const sc = typeof structuredClone === 'function' ? structuredClone : null

bench('deepClone(plain)', () => deepClone(bind))
bench('deepClone(reactive)', () => deepClone(r))
if (sc) {
  bench('structuredClone(plain)', () => sc(bind))
  bench('structuredClone(reactive)', () => sc(r))
}
bench('JSON.stringify(plain)', () => JSON.stringify(bind))
bench('JSON.stringify(reactive)', () => JSON.stringify(r))
bench('safeStringify(plain) [hashValue 内核]', () => safeStringify(bind))
bench('safeStringify(reactive)', () => safeStringify(r))
bench('hashValue(plain)', () => hashValue(bind))
bench('hashValue(reactive)', () => hashValue(r))
bench('hashValue(plain, ignoreKeys)', () => hashValue(bind, new Set(['updatedAt'])))
// watchFieldsHash:conflictWatchFields 白名单模式(如 ['minHeight','version'])
bench('watchFieldsHash(plain, 2 keys)', () => watchFieldsHash(bind, new Set(['version', 'primary'])))
bench('watchFieldsHash(reactive, 2 keys)', () => watchFieldsHash(r, new Set(['version', 'primary'])))
// toRaw 逃生对照:hashValue(toRaw(r))
bench('hashValue(toRaw(reactive))', () => hashValue(toRaw(r)))
bench('deepClone(toRaw(reactive))', () => deepClone(toRaw(r)))
