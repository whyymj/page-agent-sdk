/** N4 修正版:structuredClone 走 checkpoint 同款 try/catch fallback */
import { reactive, toRaw } from 'vue'
import { makeBind } from './mkbind'
import { rawRead } from '../../src/core/utils/rawRead'
import { deepClone, hashValue, watchFieldsHash, safeStringify } from '../../src/core/tools/jsonUtils'

const bind = makeBind()
console.log(`bind: ${(JSON.stringify(bind).length / 1024).toFixed(0)}KB, components=${bind.components.length}`)
const r = reactive(bind)
;(function touchAll(o: any) { if (o === null || typeof o !== 'object') return; if (Array.isArray(o)) { o.forEach(touchAll); return } for (const k of Object.keys(o)) touchAll(o[k]) })(r)

function bench(name: string, fn: () => unknown, runs = 30): void {
  fn()
  const times: number[] = []
  for (let i = 0; i < runs; i++) { const t0 = performance.now(); fn(); times.push(performance.now() - t0) }
  times.sort((a, b) => a - b)
  console.log(`${name.padEnd(44)} median ${times[Math.floor(runs / 2)].toFixed(2)}ms  p95 ${times[Math.floor(runs * 0.95)].toFixed(2)}ms`)
}
// checkpoint clone 同款(C1 修后:structuredClone 输入先 rawRead 解包 —— proxy 不可克隆恒抛 DataCloneError)
const ckClone = (v: unknown) => { try { return structuredClone(rawRead(v)) } catch { return JSON.parse(JSON.stringify(v)) } }

bench('deepClone(plain)', () => deepClone(bind))
bench('deepClone(reactive)', () => deepClone(r))
bench('deepClone(toRaw(r))', () => deepClone(toRaw(r)))
bench('ckClone(plain) [checkpoint]', () => ckClone(bind))
bench('ckClone(reactive) [checkpoint 路径]', () => ckClone(r))
bench('JSON.stringify(plain)', () => JSON.stringify(bind))
bench('JSON.stringify(reactive)', () => JSON.stringify(r))
bench('safeStringify(plain)', () => safeStringify(bind))
bench('safeStringify(reactive)', () => safeStringify(r))
bench('hashValue(plain)', () => hashValue(bind))
bench('hashValue(reactive)', () => hashValue(r))
bench('hashValue(toRaw(r))', () => hashValue(toRaw(r)))
bench('watchFieldsHash(plain,2keys)', () => watchFieldsHash(bind, new Set(['version', 'primary'])))
bench('watchFieldsHash(reactive,2keys)', () => watchFieldsHash(r, new Set(['version', 'primary'])))
