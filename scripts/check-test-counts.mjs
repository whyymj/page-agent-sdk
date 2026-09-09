#!/usr/bin/env node
/**
 * 测试计数对账(2026-09-09 六路审计 Batch A9)
 *
 * 背景:同一 release 曾三处计数漂移(CHANGELOG 漏报 selftest +22 / 错报 e2e +5 实为 +13、README 双语徽章
 * 停在两版前)。「计数同步」原是纯人工约定,本脚本把它变成发布前机械检查。
 *
 * 用法:
 *   node scripts/check-test-counts.mjs         # 静态对账:各文件「声明的计数」互相一致(CLAUDE.md / README×2 / CHANGELOG 最新版)
 *   node scripts/check-test-counts.mjs --run   # 实跑 npm test + test:e2e + test:browser 取真值再对账(慢;发布前用)
 *
 * 退出码:0 = 全部一致;1 = 有漂移(输出差异清单);2 = 解析失败(需人工看输出格式是否变了)
 */
import { readFileSync, readdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')

const problems = []
const parseWarnings = []

/** 从各文件提取 { selftest, e2e, browser } 声明计数(提取不到记 parseWarnings,不直接判败) */
function collectDeclared() {
  const declared = {}

  // 1) CLAUDE.md 常用命令段(npm run test 行)+ 计数同步行(3375/1085/153)
  const claude = read('CLAUDE.md')
  const cm = claude.match(/npm run test\s+# 自测[^\d]*(\d+)\s*项断言/)
  if (cm) declared['CLAUDE.md 自测行'] = { selftest: +cm[1] }
  else parseWarnings.push('CLAUDE.md:未匹配到自测计数行(格式变了?)')
  const cmSync = claude.match(/计数同步\*\*:更新本文件断言计数\((\d+)\/(\d+)\/(\d+)\)/)
  if (cmSync) declared['CLAUDE.md 计数同步行'] = { selftest: +cmSync[1], e2e: +cmSync[2], browser: +cmSync[3] }
  else parseWarnings.push('CLAUDE.md:未匹配到计数同步行')

  // 1b) selftest 模块数(CLAUDE.md 声明 vs modules/sec-*.ts 实际文件数;Batch A3 曾写 116 实为 115)
  const cmMod = claude.match(/sec-NN\.ts`\((\d+)\s*个模块\)/)
  const modActual = readdirSync(join(root, 'src/core/__tests__/modules')).filter((f) => /^sec-\d+\.ts$/.test(f)).length
  if (cmMod) {
    if (+cmMod[1] !== modActual) problems.push(`[selftest 模块数] CLAUDE.md 声明 ${cmMod[1]} ≠ 实际 sec-*.ts 文件数 ${modActual}`)
  } else parseWarnings.push('CLAUDE.md:未匹配到 selftest 模块数声明行')

  // 2) README 双语徽章
  for (const f of ['README.md', 'README.zh-CN.md']) {
    const badge = read(f).match(/self%20tests-(\d+)%20asserts/)
    if (badge) declared[`${f} 徽章`] = { selftest: +badge[1] }
    else parseWarnings.push(`${f}:未匹配到 tests 徽章`)
  }

  // 3) CHANGELOG 最新版本段的测试计数(取「selftest X → **Y**」等终值;段内无该项则跳过)
  const changelog = read('CHANGELOG.md')
  const firstVer = changelog.indexOf('## [')
  const nextVer = changelog.indexOf('## [', firstVer + 1)
  const latest = changelog.slice(firstVer, nextVer === -1 ? undefined : nextVer)
  const verName = (changelog.slice(firstVer, firstVer + 30).match(/## \[([^\]]+)\]/) || [])[1] || '最新版本'
  const pick = (re) => { const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'); const m = [...latest.matchAll(g)].pop(); return m ? +m[1] : null }
  const st = pick(/selftest\s+\d+\s*→\s*\*{0,2}(\d+)\*{0,2}/)
  const e2 = pick(/e2e\s+\d+\s*→\s*\*{0,2}(\d+)\*{0,2}/)
  const br = pick(/browser\s+\d+\s*→\s*\*{0,2}(\d+)\*{0,2}/)
  declared[`CHANGELOG ${verName}`] = { selftest: st, e2e: e2, browser: br }

  return declared
}

/** 实跑三套测试取真值(--run) */
function collectActual() {
  const actual = {}
  const run = (cmd, re, label) => {
    try {
      const out = execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20 * 60_000 })
      const m = [...(out + '').matchAll(re)].pop()
      if (m) actual[label] = +m[1]
      else parseWarnings.push(`实跑 ${cmd}:输出未匹配到汇总行`)
    } catch (e) {
      const out = (e.stdout || '') + (e.stderr || '')
      const m = [...out.matchAll(re)].pop()
      if (m) actual[label] = +m[1]
      else problems.push(`实跑 ${cmd} 失败(exit ${e.status});汇总行未解析`)
    }
  }
  run('npm test', /==== (\d+), \d+ failed ====/, 'selftest')
  run('npm run test:e2e', /==== e2e: (\d+) passed/, 'e2e')
  run('npx playwright test --reporter=line 2>&1 | tail -5', /(\d+) passed/, 'browser')
  return actual
}

// ---- 对账 ----
const declared = collectDeclared()
const actual = process.argv.includes('--run') ? collectActual() : null

// 声明值两两一致性(同维度只比都有值的)
for (const dim of ['selftest', 'e2e', 'browser']) {
  const entries = Object.entries(declared)
    .map(([src, counts]) => [src, counts[dim]])
    .filter(([, v]) => v != null)
  if (entries.length === 0) continue
  const ref = entries[0][1]
  for (const [src, v] of entries.slice(1)) {
    if (v !== ref) problems.push(`[${dim}] 声明计数不一致:${entries[0][0]}=${ref} vs ${src}=${v}`)
  }
}

// 声明值 vs 实测值
if (actual) {
  for (const dim of ['selftest', 'e2e', 'browser']) {
    if (actual[dim] == null) continue
    for (const [src, counts] of Object.entries(declared)) {
      if (counts[dim] != null && counts[dim] !== actual[dim]) {
        problems.push(`[${dim}] ${src} 声明 ${counts[dim]} ≠ 实测 ${actual[dim]}`)
      }
    }
  }
}

// ---- 输出 ----
console.log('== 测试计数对账(' + (actual ? '含实跑' : '静态') + ')==')
for (const [src, counts] of Object.entries(declared)) {
  console.log(`  ${src}: selftest=${counts.selftest ?? '—'} e2e=${counts.e2e ?? '—'} browser=${counts.browser ?? '—'}`)
}
if (actual) console.log(`  实测: selftest=${actual.selftest ?? '—'} e2e=${actual.e2e ?? '—'} browser=${actual.browser ?? '—'}`)
for (const w of parseWarnings) console.log(`  ⚠️ ${w}`)
if (problems.length) {
  console.log('\n✗ 发现计数漂移:')
  for (const p of problems) console.log('  - ' + p)
  process.exit(1)
}
console.log('\n✓ 计数一致' + (parseWarnings.length ? '(有解析警告,请核对输出格式)' : ''))
