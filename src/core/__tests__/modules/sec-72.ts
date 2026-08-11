/**
 * sec-72:HTML 格式校验(tools/htmlValidate + createHtmlSubagent 校验链)
 * - validateHtmlFormat:标签闭合(栈)/ void 元素 / 自闭合 / 引号内 > / 注释 / raw text(script、style)/
 *   片段契约(DOCTYPE、html/head/body、片段禁 script)/ sfc 模式 / 行号 / 嵌套错序
 * - createHtmlFormatCheck:verify beforeReturn 门禁(state.files 扫描 / 前缀过滤 / 无文件放行)
 * - createHtmlSubagent 校验链装配:formatCheck 默认开(validate_code 工具 + verify + maxVerifyAttempts 2)/
 *   formatCheck:false / codeKind:'html'(html-fragment skill + 片段契约 prompt)/ validate_code 三种调用模式
 */
import { validateHtmlFormat } from '../../tools/htmlValidate'
import { createHtmlFormatCheck, createHtmlSubagent } from '../../sdk/htmlSubagent'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke } = ctx

  // ===== validateHtmlFormat:标签闭合基础 =====
  console.log('\n[html-validate · validateHtmlFormat]')
  assert(validateHtmlFormat('<div><p>x</p></div>').length === 0, '✓ 合法嵌套片段 → 通过')
  assert(validateHtmlFormat('').length === 0, '✓ 空内容 → 通过(无需校验)')
  assert(validateHtmlFormat('   \n  ').length === 0, '✓ 纯空白 → 通过')

  const unclosed = validateHtmlFormat('<div><p>x</div>')
  assert(unclosed.length === 1 && unclosed[0].code === 'UNCLOSED_TAG', '✓ <p> 未闭合 → UNCLOSED_TAG')
  assert(unclosed[0].line === 1 && unclosed[0].message.includes('<p>'), '✓ 未闭合报告含标签名与行号')

  const multiLine = validateHtmlFormat('<section>\n  <div>\n    x\n</section>')
  assert(multiLine.some((i) => i.code === 'UNCLOSED_TAG' && i.line === 2), '✓ 跨行未闭合 → 行号定位到开标签行(第 2 行)')

  const stray = validateHtmlFormat('<div>x</span></div>')
  assert(stray.some((i) => i.code === 'STRAY_CLOSE_TAG' && i.message.includes('</span>')), '✓ 多余闭合标签 → STRAY_CLOSE_TAG')

  // 嵌套错序:<b><i></b> → i 未闭合(报 1 处),b 正常闭合
  const crossed = validateHtmlFormat('<b><i>x</b>')
  assert(crossed.length === 1 && crossed[0].code === 'UNCLOSED_TAG' && crossed[0].message.includes('<i>'), '✓ 嵌套错序 → 报中间未闭合的 <i>')

  // ===== void 元素 / 自闭合 / 大小写 =====
  assert(validateHtmlFormat('<img src="a.png"><br><input type="text">').length === 0, '✓ void 元素(img/br/input)无需闭合')
  assert(validateHtmlFormat('<div/><span x/>').length === 0, '✓ /> 自闭合 → 通过')
  assert(validateHtmlFormat('<DIV>x</div>').length === 0, '✓ 大小写不敏感配对')
  assert(validateHtmlFormat('a < b && c > d').length === 0, '✓ 文本中的 < / > 不误判为标签')

  // ===== 属性引号内的 > =====
  assert(validateHtmlFormat('<div title="a>b">x</div>').length === 0, '✓ 属性引号内 > 不误判标签结束')
  assert(validateHtmlFormat("<div data-x='>'>x</div>").length === 0, '✓ 单引号属性内 > 不误判')

  // ===== 注释 =====
  assert(validateHtmlFormat('<div><!-- c --></div>').length === 0, '✓ 闭合注释 → 通过')
  const unclosedComment = validateHtmlFormat('<div><!-- oops</div>')
  assert(unclosedComment.some((i) => i.code === 'UNCLOSED_COMMENT'), '✓ 未闭合注释 → UNCLOSED_COMMENT')

  // ===== raw text 元素(script/style)=====
  assert(validateHtmlFormat('<script>if (a < b) { s = "</div>" }</script>', { sfc: true }).length === 0, '✓ sfc 模式 script 内容不解析(含 < 不误判)')
  const fragScript = validateHtmlFormat('<div>x</div><script>alert(1)</script>')
  assert(fragScript.some((i) => i.code === 'SCRIPT_IN_FRAGMENT'), '✓ 片段模式 <script> → SCRIPT_IN_FRAGMENT')
  assert(validateHtmlFormat('<style>.a > .b { color: red }</style><div>x</div>').length === 0, '✓ 片段模式 <style> 允许且内容不解析')
  const unclosedStyle = validateHtmlFormat('<style>.a{}')
  assert(unclosedStyle.some((i) => i.code === 'UNCLOSED_TAG' && i.message.includes('<style>')), '✓ <style> 未闭合 → UNCLOSED_TAG')

  // ===== 片段契约(v-html 注入)=====
  const doc = validateHtmlFormat('<!DOCTYPE html><html><head><title>t</title></head><body><div>x</div></body></html>')
  assert(doc.some((i) => i.code === 'DOCTYPE_IN_FRAGMENT'), '✓ <!DOCTYPE> → DOCTYPE_IN_FRAGMENT')
  assert(doc.filter((i) => i.code === 'DOC_TAG_IN_FRAGMENT').length === 3, '✓ html/head/body 外围标签各报 1 处 DOC_TAG_IN_FRAGMENT')
  assert(validateHtmlFormat('<body>x</body>', { sfc: true }).some((i) => i.code === 'DOC_TAG_IN_FRAGMENT'), '✓ sfc 模式模板内同样禁外围标签')

  // ===== Vue SFC 整体 =====
  const sfc = `<template>
  <section class="hero">
    <h1>{{ title }}</h1>
    <img src="x.png">
  </section>
</template>
<script setup>
defineProps({ title: String })
</script>
<style scoped>
.hero > h1 { color: red }
</style>`
  assert(validateHtmlFormat(sfc, { sfc: true }).length === 0, '✓ 合法 Vue SFC(sfc 模式)→ 通过')
  const sfcBroken = sfc.replace('</section>', '')
  assert(validateHtmlFormat(sfcBroken, { sfc: true }).some((i) => i.code === 'UNCLOSED_TAG' && i.message.includes('<section>')), '✓ SFC 模板内 <section> 未闭合 → 检出')

  // ===== createHtmlFormatCheck(verify beforeReturn 门禁)=====
  console.log('\n[html-validate · createHtmlFormatCheck]')
  const check = createHtmlFormatCheck({ vfsPrefix: 'html/' })
  const okRes = check({ messages: [], state: { files: { 'html/a.html': { content: '<div>x</div>', updatedAt: 1 } } } as any })
  assert((okRes as any).ok === true, '✓ 全部合格 → ok:true')
  const badRes = check({ messages: [], state: { files: { 'html/a.html': { content: '<div>x', updatedAt: 1 }, 'other/b.txt': { content: '<broken', updatedAt: 1 } } } as any }) as any
  assert(badRes.ok === false, '✓ 有格式问题 → ok:false')
  assert(badRes.feedback.includes('html/a.html') && badRes.feedback.includes('第 1 行'), '✓ feedback 含文件路径 + 行号')
  assert(!badRes.feedback.includes('other/b.txt'), '✓ 前缀外文件不参与校验')
  const emptyRes = check({ messages: [], state: { files: {} } as any })
  assert((emptyRes as any).ok === true, '✓ 无代码文件 → 放行')

  // ===== createHtmlSubagent 校验链装配 =====
  console.log('\n[html-validate · createHtmlSubagent 校验链]')
  const cfg = createHtmlSubagent({ writablePaths: ['components'] })
  assert(cfg.middleware?.length === 3, '✓ formatCheck 默认开 → middleware 3 个(todos + validate-tools + verify)')
  assert(cfg.middleware?.[1].name === 'html-validate-tools', '✓ middleware[1] = html-validate-tools')
  assert(cfg.middleware?.[2].name === 'verify', '✓ middleware[2] = verify(beforeReturn 门禁)')
  assert(cfg.maxVerifyAttempts === 2, '✓ maxVerifyAttempts 2(自纠兜底)')
  const validateTool = cfg.middleware?.[1].tools?.[0] as any
  assert(validateTool?.name === 'validate_code', '✓ validate_code 工具经中间件注入')
  assert(cfg.systemPrompt?.includes('validate_code'), '✓ systemPrompt 引导 validate_code 自检')
  assert(cfg.systemPrompt?.includes('v-html'), '✓ systemPrompt 含 v-html 片段契约')

  // validate_code:content 模式(直接校验传入内容)
  const rBad = await invoke(validateTool, { content: '<div>x' })
  assert(rBad.includes('❌') && rBad.includes('UNCLOSED_TAG'), '✓ validate_code(content)→ 未闭合报错')
  const rOk = await invoke(validateTool, { content: '<div><p>x</p></div>' })
  assert(rOk.includes('✅'), '✓ validate_code(content)→ 合法通过')

  // validate_code:path 模式(beforeAgent 捕获 state.files 后按路径读)
  cfg.middleware?.[1].beforeAgent?.({ files: { 'html/hero.html': { content: '<section>x</section>', updatedAt: 1 } } } as any)
  const rPath = await invoke(validateTool, { path: 'html/hero.html' })
  assert(rPath.includes('✅'), '✓ validate_code(path)→ 读 vfs 校验通过')
  const rMiss = await invoke(validateTool, { path: 'html/nope.html' })
  assert(rMiss.includes('未找到'), '✓ validate_code(path)→ 文件不存在提示')

  // validate_code:省略参数 = 扫前缀下全部
  cfg.middleware?.[1].beforeAgent?.({ files: { 'html/a.html': { content: '<div>x</div>', updatedAt: 1 }, 'html/b.html': { content: '<p>y', updatedAt: 1 } } } as any)
  const rAll = await invoke(validateTool, {})
  assert(rAll.includes('❌') && rAll.includes('b.html'), '✓ validate_code(省略)→ 扫前缀下全部文件,报出 b.html')

  // formatCheck:false → 无校验链
  const cfg2 = createHtmlSubagent({ writablePaths: ['components'], formatCheck: false })
  assert(cfg2.middleware?.length === 1 && cfg2.maxVerifyAttempts === undefined, '✓ formatCheck:false → 仅 todos,无 maxVerifyAttempts')
  const cfg3 = createHtmlSubagent({ writablePaths: ['components'], planning: false, formatCheck: false })
  assert(!cfg3.middleware, '✓ planning:false + formatCheck:false → middleware 不装')

  // codeKind:'html' → html-fragment skill + 片段契约 prompt
  const cfg4 = createHtmlSubagent({ writablePaths: ['components'], codeKind: 'html' })
  assert(cfg4.skills?.length === 1 && cfg4.skills[0].name === 'html-fragment', "✓ codeKind:'html' → 默认 html-fragment skill")
  assert(cfg4.systemPrompt?.includes('html/hero.html') || cfg4.systemPrompt?.includes('.html'), "✓ codeKind:'html' → systemPrompt 引导 .html 文件")
  assert(cfg4.skills?.[0].getContent?.().includes('v-html'), '✓ html-fragment skill 含 v-html 输出契约')
  const cfg5 = createHtmlSubagent({ writablePaths: ['components'] })
  assert(cfg5.skills?.[0].name === 'html-builder', "✓ codeKind 默认 'sfc' → html-builder skill")
}
