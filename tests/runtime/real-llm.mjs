/**
 * 真 LLM 回归统一入口(npm run test:real)—— real-llm-framework
 *
 * 套件注册表:
 *   uispec    complex-demo 10 场景(委派/规范/精修/调序/删除/恢复/开放指令;_real-llm-uispec.json)
 *   rag       rag-demo 四模式(A memory/B mock 检索/C 真实 MCP/D MCP 直连;_real-llm-rag.json)
 *   parallel  同轮并行委派复验(单场景;_real-llm-parallel.json)
 *
 * 用法:
 *   npm run test:real                      # 全部套件
 *   npm run test:real uispec               # 单套件
 *   npm run test:real uispec 3 5           # 单套件 + 场景过滤(数字对所选套件生效;多套件时慎用)
 *   npm run test:real rag 4                # rag 只跑 S4
 *   npm run test:real -- --baseline-update # 跑完把本次指标写入基线 tests/runtime/real-llm-baseline.json(入库)
 *   npm run test:real -- --baseline-diff   # 只对比现有报告 vs 基线(不跑 LLM,秒回)
 *
 * 基线对比(prompt/completion token、工具数;▲超阈值疑似回归 / ▼疑似改善;elapsedSec 仅展示):
 *   阈值:prompt/completion ±15% 且 ±2000 token;toolCount ±3。改 prompt/编排后跑一遍看 ▲▼,
 *   确认是预期变化后 `--baseline-update` 采集为新基线并随代码提交。
 *
 * 方法论(跑前重启 dev server / 跑中禁并发 / idle 双条件)见 doc/real-llm-regression.md。
 * headless 族脚本(draft/trace/maliang,tests/runtime/*-real-llm.ts)形态不同,不经本入口,各自 npm run test:*-real。
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { metricsOf, loadBaseline, saveBaseline, diffBaseline, BASELINE_PATH, ROOT } from './_real-llm-lib.mjs'
import { runSuite as runUispec } from './uispec-real-llm.mjs'
import { runSuite as runRag } from './rag-demo-real-llm.mjs'
import { runSuite as runParallel } from './parallel-delegation-real.mjs'

const REGISTRY = {
  uispec: { run: (only) => runUispec({ only }), out: '_real-llm-uispec.json' },
  rag: { run: (only) => runRag({ only }), out: '_real-llm-rag.json' },
  parallel: { run: () => runParallel(), out: '_real-llm-parallel.json' },
}

// ---- 参数解析:非数字 token = 套件名(缺省全部);数字 token = 场景过滤(对所选套件生效) ----
const rawArgs = process.argv.slice(2)
const updateBaseline = rawArgs.includes('--baseline-update')
const onlyDiff = rawArgs.includes('--baseline-diff')
const rest = rawArgs.filter((a) => !a.startsWith('--'))
const suiteNames = rest.filter((a) => Number.isNaN(Number(a)))
const only = rest.filter((a) => !Number.isNaN(Number(a))).map(Number)
const selected = suiteNames.length ? suiteNames.filter((n) => REGISTRY[n]) : Object.keys(REGISTRY)
const unknown = suiteNames.filter((n) => !REGISTRY[n])
if (unknown.length) { console.error(`未知套件:${unknown.join(', ')}(可选:${Object.keys(REGISTRY).join(' / ')})`); process.exit(2) }

/** 读套件报告文件(--baseline-diff / 基线合并用) */
function readReport(out) {
  const p = resolve(ROOT, out)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
}

// ---- 只对比模式:不跑 LLM,直接读现有报告 ----
if (onlyDiff) {
  const baseline = loadBaseline()
  if (!baseline) { console.log('(无基线文件;先跑一轮 + --baseline-update 采集)'); process.exit(0) }
  const current = {}
  for (const name of selected) {
    const r = readReport(REGISTRY[name].out)
    if (r) current[name] = metricsOf(r)
  }
  const { lines, regressions } = diffBaseline(current, baseline)
  console.log(`\n===== 基线对比(基线录制于 ${baseline.recordedAt})=====`)
  lines.forEach((l) => console.log(l))
  console.log(regressions > 0 ? `\n⚠ ${regressions} 项指标超阈值(▲);确认预期后 --baseline-update 采集新基线` : '\n全部指标在阈值内 ✓')
  process.exit(regressions > 0 ? 1 : 0)
}

console.log('===== 真 LLM 回归(方法论:跑前重启 dev server;跑中禁并发 test:browser/改源码)=====')
console.log(`套件:${selected.join(' → ')}${only.length ? ` | 场景过滤:${only.join(',')}` : ''}\n`)

// ---- 顺序跑所选套件(真 LLM 串行,避免互相抢 dev server) ----
const results = []
const currentMetrics = {}
let totalFailed = 0
for (const name of selected) {
  console.log(`\n»»»»» 套件 [${name}] «««««`)
  const r = await REGISTRY[name].run(only)
  results.push(r)
  if (r?.skipped) continue
  totalFailed += r?.failed ?? 0
  currentMetrics[name] = metricsOf(r.report)
}

// ---- 基线:默认对比(有基线才比);--baseline-update 采集 ----
const baseline = loadBaseline()
if (updateBaseline) {
  // 合并保留未跑套件的既有基线段(只更新本次跑过的)
  const merged = { ...(baseline?.suites ?? {}), ...currentMetrics }
  const saved = saveBaseline(merged)
  console.log(`\n✓ 基线已更新 → ${BASELINE_PATH}(recordedAt ${saved.recordedAt};请随代码提交)`)
} else if (baseline) {
  const { lines, regressions } = diffBaseline(currentMetrics, baseline)
  console.log(`\n===== 基线对比(基线录制于 ${baseline.recordedAt})=====`)
  lines.forEach((l) => console.log(l))
  if (regressions > 0) console.log(`\n⚠ ${regressions} 项指标超阈值(▲);确认预期后 npm run test:real -- --baseline-update`)
} else {
  console.log('\n(无基线文件;跑完确认指标正常后 npm run test:real -- --baseline-update 采集)')
}

// ---- 汇总退出码 ----
const ran = results.filter((r) => !r?.skipped)
console.log(`\n===== 总汇总 =====`)
for (const r of ran) console.log(`  ${r.suite}: 断言 ${r.total} | 失败 ${r.failed} | 报告 ${r.OUT}`)
console.log(ran.length ? `失败合计 ${totalFailed}` : '(全部套件 skip:缺 key)')
if (totalFailed > 0) process.exit(1)
