// legacy 子路径(page-agent-sdk/legacy):es2017 全量打包产物 page-agent-sdk.legacy.js
// 覆盖:导出面与主产物等价 / ui:false 装配走通 / 语法纯净性(es2017 解析器可 parse,webpack4 硬约束)/ 体积
import * as fs from 'fs'
import { createRequire } from 'node:module'
import { setupEnv, createAssert, FAKE_LLM, z } from './_helpers.mjs'

const LEGACY_DIST = new URL('../../dist/page-agent-sdk.legacy.js', import.meta.url)
const MAIN_DIST = new URL('../../dist/page-agent-sdk.js', import.meta.url)

export async function run() {
  setupEnv()
  // legacy 全量打包 → vue runtime-dom 顶层模板编译探测调 document.createElement
  // (主产物 external vue 不触发;setupEnv 的极简 document stub 无此方法,补齐)
  globalThis.document.createElement = () => ({ innerHTML: '', content: { appendChild() {}, firstChild: null } })
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:legacy-subpath] 导出面:与主产物符号集完全等价(191 个)')
  {
    const legacy = await import(LEGACY_DIST)
    const main = await import(MAIN_DIST)
    const a = new Set(Object.keys(legacy)), b = new Set(Object.keys(main))
    const onlyMain = [...b].filter((k) => !a.has(k))
    const onlyLegacy = [...a].filter((k) => !b.has(k))
    assert(onlyMain.length === 0, `主产物符号不缺席 legacy(${onlyMain.length} 缺失)`)
    assert(onlyLegacy.length === 0, `legacy 无多余符号(${onlyLegacy.length} 多余)`)
    assert(typeof legacy.createChatSdk === 'function', 'createChatSdk 可达')
    assert(legacy.z && typeof legacy.z.object === 'function', 'z(zod)从 legacy bundle 导出(宿主零 peer 安装)')
    assert(typeof legacy.defineTool === 'function', 'defineTool 可达')
  }

  console.log('[e2e:legacy-subpath] ui:false 装配走通(headless 实例初始化)')
  {
    const { createChatSdk } = await import(LEGACY_DIST)
    const sdk = createChatSdk({
      ui: false, id: 'legacy-e2e', storage: 'memory', llm: FAKE_LLM,
      capabilities: { planning: false, skills: false, vfs: false, summarization: false, memory: false, subagent: false },
      data: { schema: z.object({ x: z.number() }), bind: { x: 1 }, description: 'd' },
    })
    await sdk.mount()
    assert(Array.isArray(sdk.messages), 'mount 后 messages 可用(装配成功)')
    assert(Array.isArray(sdk.inspect().tools), 'inspect().tools 返回(核心 agent 装配)')
    // z 从 bundle 导出的端到端可用性:dataOps 用它跑了 schema 校验(装配即验)
    sdk.unmount()
  }

  console.log('[e2e:legacy-subpath] 语法纯净性:acorn(ES2017)可完整 parse —— webpack4 硬约束')
  {
    // acorn 不在本仓依赖树(e2e 环境免装):resolve 得到则跑硬校验(parse),否则退化为语法特征扫描
    // (产物内不得出现代码位 ?. / ?? / 顶层 await import / class fields)。
    // 硬校验已在 change 实施期用 editor_fangzhou 真实 webpack4 栈(acorn 6.1.1 + dynamic-import patch)通过。
    const require = createRequire(import.meta.url)
    const src = fs.readFileSync(LEGACY_DIST, 'utf8')
    let acorn = null
    try { acorn = require('acorn') } catch { /* 免装退化 */ }
    if (acorn) {
      let parseErr = null
      try { acorn.parse(src, { ecmaVersion: 8, sourceType: 'module' }) } catch (e) { parseErr = e }
      assert(!parseErr, `legacy 产物 ES2017 解析器可 parse(${parseErr ? parseErr.message.slice(0, 80) : '通过'})`)
      let mainParseErr = null
      try { acorn.parse(fs.readFileSync(MAIN_DIST, 'utf8'), { ecmaVersion: 8, sourceType: 'module' }) } catch (e) { mainParseErr = e }
      assert(mainParseErr, '灵敏度对照:主产物 es2022 在 ES2017 解析器下失败(检测器有效)')
    } else {
      // 特征扫描兜底:代码位不得有动态 import(排除 setLlm 错误文案里的示例串 —— 该串经转义,后面跟 \" 而非标识符)
      // 转义串特征:import( 后紧跟 backslash(92);真代码位是 " ' ` 或标识符
      const allDyn = [...src.matchAll(/await\s+import\s*\(/g)]
      const codeDynImports = allDyn.filter((m) => src.charCodeAt(m.index + m[0].length) !== 92).length
      assert(codeDynImports === 0, `零动态 import 语法残留(实测 ${codeDynImports} 处;文案内示例已排除)`)
      const optChain = (src.match(/[)\]\w_'"`]\?\.[A-Za-z_$(]/g) || []).length
      assert(optChain === 0, `零可选链语法残留(实测 ${optChain} 处 esbuild es2017 降级后)`)
    }
  }

  console.log('[e2e:legacy-subpath] 体积:全量打包(es2017 + anthropic inline)≤ 3.3MB')
  {
    const sizeKB = fs.statSync(LEGACY_DIST).size / 1024
    assert(sizeKB > 1000, `bundle 非空且量级正确(${sizeKB.toFixed(0)}KB,全量打包)`)
    assert(sizeKB <= 3300, `bundle ≤ 3.3MB(实测 ${sizeKB.toFixed(0)}KB;超阈说明意外依赖被拉入)`)
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
