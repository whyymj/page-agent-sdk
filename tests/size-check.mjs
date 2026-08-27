// 体积监控:核对 dist 各产物大小不超阈值,防 IIFE/ESM 体积无意膨胀
// 运行:先 npm run build,再 node tests/size-check.mjs
import * as fs from 'fs'

const KB = 1024
const MB = 1024 * KB

// 阈值(单位:字节);当前基线 + ~10% 余量
// 2026-08-27 html-design-skill 重校:内置 web-design-engineer skill 全量 vendor(主文 33K + references 29 文件 ~120K 字符串常量),
// 各 JS 产物有意 +160~230K(用户拍板全量 268K;曾评估精选降级,见 openspec/changes/2026-08-27-html-design-skill/proposal.md 包体影响段)
const limits = [
  { file: 'dist/page-agent-sdk.iife.js', max: 2.45 * MB, label: 'IIFE 全量(CDN <script> 直引;含 dompurify + overlayscrollbars + design-skill,实测 ~2206KB)' },
  { file: 'dist/page-agent-sdk.js', max: 1.32 * MB, label: 'ESM(npm import;含 design-skill,实测 ~1194KB)' },
  { file: 'dist/page-agent-sdk.umd.cjs', max: 1.08 * MB, label: 'UMD(require;含 design-skill,实测 ~974KB)' },
  { file: 'dist/page-agent-sdk.headless.js', max: 760 * KB, label: 'headless ESM(/headless 子路径;纯核心不含 UI/不含 overlayscrollbars,含 design-skill,实测 ~673KB)' },
  { file: 'dist/page-agent-sdk.legacy.js', max: 3.55 * MB, label: 'legacy ESM(/legacy 子路径;es2017 全量打包含 anthropic + design-skill,实测 ~3189KB)' },
  { file: 'dist/style.css', max: 85 * KB, label: 'CSS(含 overlayscrollbars 样式 + 3.27 顶部按钮标签,实测 ~79KB)' },
]

let pass = 0, fail = 0
function assert(cond, msg) { if (cond) { pass++; console.log('  ✓', msg) } else { fail++; console.error('  ✗', msg) } }

console.log('[size-check] dist 产物体积监控')
for (const { file, max, label } of limits) {
  const url = new URL(`../${file}`, import.meta.url)
  if (!fs.existsSync(url)) {
    assert(false, `${file} 不存在(先 npm run build)`)
    continue
  }
  const size = fs.statSync(url).size
  const sizeKB = (size / KB).toFixed(1)
  const maxKB = (max / KB).toFixed(1)
  const maxMB = (max / MB).toFixed(2)
  assert(size <= max, `${label} ${file}: ${sizeKB}KB ≤ ${maxMB}MB(${maxKB}KB)`)
  if (size > max) console.error(`    超限: ${sizeKB}KB > ${maxKB}KB`)
}

console.log(`\n==== size-check: ${pass} passed, ${fail} failed ====`)
if (fail > 0) process.exit(1)
