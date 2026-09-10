// 导出一致性检查:对比 src/core/index.ts 与 types/index.d.ts 的导出名集合,发现 types 漏导出
// 运行:node tests/exports-consistency.mjs
//
// 职责分工(防 types 漂移双层防线):
//  - 本文件查「导出名集合」(名字在不在):防 types 漏导出某符号(如新增导出忘加进 d.ts)
//  - 字段级签名漂移(名字都在、字段错 —— 如 AgentCore 缺方法、onAudit 签名错)由
//    tests/types.test-d.ts(test:types)的 Pick<ChatSdk, ...> / Extract<SdkEvent, ...> 字段级断言覆盖
//  两者互补:本文件管「符号存在」,types.test-d.ts 管「字段正确」
import * as fs from 'fs'

function extractExports(content) {
  const names = new Set()
  // export { a, b } from '...' / export type { a, b } from '...' / export { default as X } from '...'
  for (const m of content.matchAll(/export\s+(?:type\s+)?\{([^}]+)\}\s*(?:from\s+['"][^'"]+['"])?/g)) {
    for (const raw of m[1].split(',').map(s => s.trim()).filter(Boolean)) {
      let name = raw.replace(/^type\s+/, '')  // 去掉 `export { type X }` 的 type 前缀
      const parts = name.split(/\s+as\s+/)
      names.add(parts[1] || parts[0])  // 取 alias 名(若有),如 default as ChatDialog → ChatDialog
    }
  }
  for (const m of content.matchAll(/export\s+(?:interface|type)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1])
  for (const m of content.matchAll(/export\s+declare\s+(?:function|const|class)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1])
  for (const m of content.matchAll(/export\s+(?:const|function|class)\s+([A-Za-z_][A-Za-z0-9_]*)/g)) names.add(m[1])
  return names
}

const srcContent = fs.readFileSync(new URL('../src/core/index.ts', import.meta.url), 'utf8')
const typesContent = fs.readFileSync(new URL('../types/index.d.ts', import.meta.url), 'utf8')
const srcExports = extractExports(srcContent)
const typesExports = extractExports(typesContent)

// type-only 辅助类型:d.ts 为 TS 使用者声明,但非 src/core/index.ts 运行时导出(audit P1-27/A 专项:多余名改 fail 需此白名单排除)
const TYPES_ONLY_ALLOWLIST = new Set([
  'ChatDialogSections', 'ChatDialogProps', 'DebugDrawerProps', 'ChatModelLike',
  'SkillExecSpec', 'SkillToolFactory', 'Checkpoint', 'SessionOptions', 'HumanConfirmOptions',
])
const missingInTypes = [...srcExports].filter(n => !typesExports.has(n))
const extraInTypes = [...typesExports].filter(n => !srcExports.has(n))
const unexpectedExtras = extraInTypes.filter(n => !TYPES_ONLY_ALLOWLIST.has(n))
const staleAllowlist = [...TYPES_ONLY_ALLOWLIST].filter(n => !typesExports.has(n))

let pass = 0, fail = 0
function assert(cond, msg) { if (cond) { pass++; console.log('  ✓', msg) } else { fail++; console.error('  ✗', msg) } }

console.log('[exports-consistency] src/core/index.ts 导出数:', srcExports.size)
console.log('[exports-consistency] types/index.d.ts 导出数:', typesExports.size)
assert(missingInTypes.length === 0, `types/index.d.ts 无漏导出(缺失:${missingInTypes.join(', ') || '无'})`)
assert(unexpectedExtras.length === 0, `types/index.d.ts 无意料外多余导出(白名单外:${unexpectedExtras.join(', ') || '无'})`)
assert(staleAllowlist.length === 0, `type-only 白名单无失效项(d.ts 已移除:${staleAllowlist.join(', ') || '无'})`)
if (extraInTypes.length > 0) console.log('  ℹ types 多余(白名单内 type-only,已豁免):', extraInTypes.join(', '))

// subpath exports 配置断言(refactor-module-extraction:./storage / ./query / ./llm 按需引入)
// 注:实际运行时可达性由 e2e(浏览器经同一 dist)覆盖;此处校验 package.json exports 配置正确(语义可达 + CDN 入口独立)
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
assert(!!pkg.exports['.'] && !!pkg.exports['.'].import, '顶层 . 入口保留(向后兼容)')
assert(!!pkg.exports['./storage']?.import && pkg.exports['./storage'].import.endsWith('page-agent-sdk.js'), 'subpath ./storage 已配置(持久化层:createSessionStore 等)')
assert(!!pkg.exports['./query']?.import && pkg.exports['./query'].import.endsWith('page-agent-sdk.js'), 'subpath ./query 已配置(jpEval/searchJson + jsonUtils/schemaUtils 纯函数)')
assert(!!pkg.exports['./llm']?.import && pkg.exports['./llm'].import.endsWith('page-agent-sdk.js'), 'subpath ./llm 已配置(createProxyLlm 防 apiKey 泄露)')
assert(pkg.exports['./style.css'], 'subpath ./style.css 保留')

// headless 子路径(add-headless-subpath):page-agent-sdk/headless 纯核心,不含 UI
console.log('[exports-consistency] headless 子路径:index.headless.ts ↔ headless.d.ts 对齐 + 不含组件')
{
  const headlessSrc = fs.readFileSync(new URL('../src/core/index.headless.ts', import.meta.url), 'utf8')
  const headlessTypes = fs.readFileSync(new URL('../types/headless.d.ts', import.meta.url), 'utf8')
  const headlessSrcExports = extractExports(headlessSrc)
  const headlessTypesExports = extractExports(headlessTypes)
  const missingInHeadlessTypes = [...headlessSrcExports].filter(n => !headlessTypesExports.has(n))
  assert(missingInHeadlessTypes.length === 0, `headless.d.ts 无漏导出(缺失:${missingInHeadlessTypes.join(', ') || '无'})`)

  // headless 不导出 13 个 .vue 组件(源 + 类型两侧均不含)
  const components = ['ChatDialog', 'MessageContent', 'CodePreview', 'SkillPanel', 'IconGlyph', 'ChatHeader', 'ChatInput', 'MessageList', 'MessageRow', 'QueuedBar', 'ApprovalBar', 'ConflictBar', 'FocusBar', 'DebugDrawer']
  const leakedInSrc = components.filter(c => headlessSrcExports.has(c))
  const leakedInTypes = components.filter(c => headlessTypesExports.has(c))
  assert(leakedInSrc.length === 0, `index.headless.ts 不导出 UI 组件(泄露:${leakedInSrc.join(', ') || '无'})`)
  assert(leakedInTypes.length === 0, `headless.d.ts 不声明 UI 组件(泄露:${leakedInTypes.join(', ') || '无'})`)

  // package.json exports 配置 ./headless(types + import 指向 headless 产物)
  assert(!!pkg.exports['./headless']?.types && pkg.exports['./headless'].types.endsWith('headless.d.ts'), 'subpath ./headless types 指向 headless.d.ts')
  assert(!!pkg.exports['./headless']?.import && pkg.exports['./headless'].import.endsWith('page-agent-sdk.headless.js'), 'subpath ./headless import 指向 page-agent-sdk.headless.js')
  // build 脚本含 build:headless
  assert(typeof pkg.scripts['build:headless'] === 'string' && pkg.scripts.build.includes('build:headless'), 'package.json 含 build:headless 脚本并纳入 build 链')
}

// 第三向断言(E3 API 面收口):主包非 UI 导出 ⊆ headless。主包独有导出必须显式挂 UI 白名单 ——
// 新增纯核心导出只进主包不进 headless 时此处红灯,强制「进 headless 或挂白名单说明」二选一(防 headless 面腐化)
{
  console.log('[exports-consistency] 第三向:主包非 UI 导出 ⊆ headless(UI 白名单外零容忍)')
  const headlessSrc2 = fs.readFileSync(new URL('../src/core/index.headless.ts', import.meta.url), 'utf-8')
  const mainOnly = [...srcExports].filter(n => !extractExports(headlessSrc2).has(n))
  const UI_ONLY_ALLOWLIST = new Set([
    // 13 个 .vue 组件 + 图标/i18n/markdown 渲染(主包打包 marked/hljs/dompurify,headless 子路径不含)
    'ChatDialog', 'ChatHeader', 'ChatInput', 'MessageList', 'MessageRow', 'QueuedBar', 'ApprovalBar', 'ConflictBar', 'FocusBar', 'DebugDrawer', 'MessageContent', 'CodePreview', 'SkillPanel', 'IconGlyph',
    'DialogIcons', 'DEFAULT_DIALOG_ICONS', 'resolveDialogIcons', 'isIconHtml', 'sanitizeIconHtml',
    'DialogLocale', 'DialogMessages', 'resolveDialogMessages', 'MESSAGES_EN_US', 'MESSAGES_ZH_CN', 'I18nOptions', 'QuickActionItem',
    'HLJS_BLOCK_MAX_CHARS', 'markedToHtml', 'renderMarkdownHtml', 'sanitizeMessageHtml',
    // 审批 diff 预览载荷类型:headless.d.ts 已为 StreamEvent 引用而声明,但 index.headless.ts 不导出(事件消费方从主包取类型亦可)
    'ApprovalPreviewItem', 'ApprovalWritePreview',
  ])
  const violations = mainOnly.filter(n => !UI_ONLY_ALLOWLIST.has(n))
  assert(violations.length === 0, `主包独有导出未挂 UI 白名单(要么补进 headless,要么挂白名单并注明理由):${violations.join(', ') || '无'}`)
}

// vue 类型解耦(E2 API 面收口):d.ts 引用 vue = 未装 vue 的 TS 项目解析退化(error type)。
// 内联桩(types/*.d.ts 头部 Ref/InjectionKey/DefineComponent)是唯一合法形态;静态 grep 防回归零成本
{
  console.log('[exports-consistency] vue 类型解耦:d.ts 零 vue 引用(内联桩)')
  for (const f of ['types/index.d.ts', 'types/headless.d.ts']) {
    const content = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf-8')
    const stripped = content.replace(/^\s*\/\/.*$/gm, '')  // 剥行注释(桩头说明提到 'vue' 属文案非引用)
    assert(!/from\s+['"]vue['"]/.test(stripped), `${f} 不含 from 'vue'(E2 内联桩,勿回退)`)
    assert(!/import\(['"]vue['"]\)/.test(stripped), `${f} 不含 import('vue') 动态类型引用`)
  }
}

console.log(`\n==== exports-consistency: ${pass} passed, ${fail} failed ====`)
if (fail > 0) process.exit(1)
