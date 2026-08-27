#!/usr/bin/env node
/**
 * design-skill 参考文档生成器(html-design-skill)
 *
 * 把上游 ConardLi garden-skills `web-design-engineer` 的 references/ 目录原样 vendor 成
 * `src/core/sdk/designSkill/references.ts`(SkillRefSpec 数组;内容零改动,仅做模板字符串转义)。
 *
 * 用法:
 *   node scripts/gen-design-skill.mjs <上游 skill 目录>
 *   例:node scripts/gen-design-skill.mjs ~/Downloads/conardli-garden-skills-web-design-engineer
 *
 * 上游升级流程(见 designSkill/skillDoc.ts 文件头的适配说明):
 *   1. 下载新版 skill 目录,重跑本脚本(references 原样刷新);
 *   2. 手工 diff SKILL.md 上游新版 vs skillDoc.ts 的适配版(三处嫁接:宿主环境/Step0 无网/Step1 不能反问);
 *   3. 更新 references.ts / skillDoc.ts 文件头的上游版本号。
 *
 * 注:主文 SKILL.md 不由本脚本生成(有手工适配,见 skillDoc.ts);本脚本只管 references/。
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, basename } from 'node:path'

const srcDir = process.argv[2]
if (!srcDir) {
  console.error('用法:node scripts/gen-design-skill.mjs <上游 skill 目录>(含 SKILL.md 与 references/)')
  process.exit(1)
}

// 顶层 4 个非配方参考的一句话说明(配方类从文件头机械提取;这 4 个手写,与 SKILL.md 路由表口径一致)
const TOP_DESC = {
  'references/advanced-patterns.md': 'Code templates: device frames, slide engine, animation timeline, Tweaks panel, design canvas, dark mode, data viz, oklch color system, font picks, pinned React+CDN tags',
  'references/critique-guide.md': 'Critique scoring rubrics: per-output-type weighting, top-10 common issues, detailed 5-dimension scoring',
  'references/design-directions.md': 'Design Direction Advisor library: 6-school taxonomy, per-school anchor tables, AI-prompt templates (for vague "give me directions" requests)',
  'references/style-recipes/INDEX.md': 'Recipe catalog index: 25 named recipes with 3 indexes (by school / by best-for / by light-dark) + cross-cutting anti-patterns',
}

/** 模板字符串转义:反斜杠 / 反引号 / ${ 三者;换行保留(diff 友好) */
const esc = (s) => s.replace(/\r/g, '').replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')

/** 配方文件头提取说明:'# <name> — <Title>' + '- **Vibe**: <vibe>' → '<Title> · <vibe>' */
function recipeDesc(content, file) {
  const title = /^# .*? — (.+)$/m.exec(content)?.[1]?.trim()
  const vibe = /^- \*\*Vibe\*\*: (.+)$/m.exec(content)?.[1]?.trim()
  if (!title || !vibe) throw new Error(`${file}: 提取不到 Title/Vibe 文件头(上游格式变了?核对文件头三行)`)
  const d = `${title} · ${vibe}`
  return d.length > 130 ? d.slice(0, 127) + '…' : d
}

// 收集 references/ 下全部 .md(相对路径即 SkillRefSpec.name,与 SKILL.md 内引用路径 1:1)
const refsRoot = join(srcDir, 'references')
const files = []
const walk = (dir) => {
  for (const ent of readdirSync(dir).sort()) {
    const p = join(dir, ent)
    if (statSync(p).isDirectory()) walk(p)
    else if (ent.endsWith('.md')) files.push(p)
  }
}
walk(refsRoot)
if (!files.length) {
  console.error(`未在 ${refsRoot} 下找到 .md 参考文件(目录传错了?)`)
  process.exit(1)
}

// 排序:顶层 3 个 → style-recipes/INDEX.md → 25 配方字母序(与主文路由表阅读顺序一致)
const order = (rel) =>
  rel.startsWith('references/style-recipes/') ? (rel === 'references/style-recipes/INDEX.md' ? 1 : 2) : 0
files.sort((a, b) => {
  const ra = relative(refsRoot, a), rb = relative(refsRoot, b)
  return order(ra) - order(rb) || ra.localeCompare(rb)
})

const manifest = JSON.parse(readFileSync(join(srcDir, 'manifest.json'), 'utf8'))
const entries = files.map((p) => {
  // name 含 references/ 前缀:与主文内 'read references/…' 引用、上游磁盘形态三方 1:1(load_skill ref 精确匹配)
  const rel = relative(srcDir, p)
  const content = readFileSync(p, 'utf8')
  const desc = TOP_DESC[rel] ?? recipeDesc(content, basename(p))
  return [
    '  {',
    `    name: '${rel.replace(/\\/g, '/')}',`,
    `    description: ${JSON.stringify(desc)},`,
    '    getContent: () => `',
    esc(content),
    '`,',
    '  },',
  ].join('\n')
})

const totalBytes = files.reduce((n, p) => n + statSync(p).size, 0)
const out = `/**
 * web-design-engineer 参考文档库(vendored,生成物勿手改内容)
 *
 * 由 scripts/gen-design-skill.mjs 生成;上游:ConardLi garden-skills web-design-engineer
 * v${manifest.version}(${manifest.homepage});© ConardLi,MIT License。
 * vendored: 2026-08-27;共 ${files.length} 个参考文件(${totalBytes} 字节)。
 * 上游升级 = 重跑生成器刷新本文件 + 手工对齐 skillDoc.ts 的适配(三处嫁接,见其文件头)。
 *
 * name = 含 references/ 前缀的相对路径(与主文内 "read references/…" 的引用 1:1;load_skill(name, ref) 按此精确匹配);
 * 配方类 description 从文件头 Title/Vibe 机械提取,顶层 4 个手写(生成器内 TOP_DESC)。
 */
import type { SkillRefSpec } from '../../harness/skills'

export const DESIGN_REFERENCES: SkillRefSpec[] = [
${entries.join('\n')}
]
`

const outFile = new URL('../src/core/sdk/designSkill/references.ts', import.meta.url).pathname
writeFileSync(outFile, out)
console.log(`✓ 生成 ${outFile}`)
console.log(`  ${files.length} 个参考 | ${totalBytes} 字节 | 上游 v${manifest.version}`)
const recipes = files.filter((p) => relative(refsRoot, p).startsWith('style-recipes/') && !p.endsWith('INDEX.md'))
console.log(`  配方 ${recipes.length} 个 + INDEX + 顶层 ${files.length - recipes.length - 1} 个`)
