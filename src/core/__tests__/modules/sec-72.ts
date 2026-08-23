/**
 * sec-72:HTML 格式校验(tools/htmlValidate + createHtmlSubagent 校验链)
 * - validateHtmlFormat:标签闭合(栈)/ void 元素 / 自闭合 / 引号内 > / 注释 / raw text(script、style)/
 *   完整页面级(DOCTYPE、html/head/body/script 均允许;不再拦片段)/ 行号 / 嵌套错序
 * - createHtmlFormatCheck:verify beforeReturn 门禁(state.files 扫描 / 前缀过滤 / 无文件放行)
 * - createHtmlSubagent 校验链装配:formatCheck 默认开(validate_code 工具 + verify + maxVerifyAttempts 2)/
 *   formatCheck:false / 单模式(html-fragment skill + 完整页面级 prompt)/ validate_code 三种调用模式
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

  // ===== raw text 元素(script/style):内容不解析只校验闭合;script 有无由用户声明(不再拦)=====
  assert(validateHtmlFormat('<script>if (a < b) { s = "</div>" }</script>').length === 0, '✓ <script> 内容不解析(含 < / </div> 不误判);script 不再拦(完整页面级,由用户声明)')
  assert(validateHtmlFormat('<div>x</div><script>alert(1)</script>').length === 0, '✓ 含 <script> → 通过(不再报 SCRIPT_IN_FRAGMENT;script 由用户声明)')
  assert(validateHtmlFormat('<style>.a > .b { color: red }</style><div>x</div>').length === 0, '✓ <style> 允许且内容不解析')
  const unclosedStyle = validateHtmlFormat('<style>.a{}')
  assert(unclosedStyle.some((i) => i.code === 'UNCLOSED_TAG' && i.message.includes('<style>')), '✓ <style> 未闭合 → UNCLOSED_TAG')

  // ===== 完整页面级(DOCTYPE/html/head/body 允许;改造由下游插件/tool 做)=====
  const doc = validateHtmlFormat('<!DOCTYPE html><html><head><title>t</title></head><body><div>x</div></body></html>')
  assert(doc.length === 0, '✓ 完整 HTML 文档(DOCTYPE + html/head/body)→ 通过(不再报 DOCTYPE/DOC_TAG_IN_FRAGMENT)')

  // ===== 完整页面级(含 script/style,单模式 HTML)=====
  const fullPage = `<html>
  <head><style>.hero > h1 { color: red }</style></head>
  <body>
    <section class="hero">
      <h1>标题</h1>
      <img src="x.png">
    </section>
    <script>console.log('hi')</script>
  </body>
</html>`
  assert(validateHtmlFormat(fullPage).length === 0, '✓ 完整页面级 HTML(html/head/body + script/style)→ 通过(单模式不再拦)')
  const fullPageBroken = fullPage.replace('</section>', '')
  assert(validateHtmlFormat(fullPageBroken).some((i) => i.code === 'UNCLOSED_TAG' && i.message.includes('<section>')), '✓ 完整页面内 <section> 未闭合 → 检出')

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
  assert(cfg.systemPrompt?.includes('完整、自包含'), '✓ systemPrompt 含完整页面级契约(不再 v-html 片段契约)')
  // 终稿纪律(thinking-taming ③补强,真 LLM 实测:思考里写两版完整代码 + 同一几何约束重复推导 3 遍,代码 token 翻倍)
  assert(
    cfg.systemPrompt?.includes('终稿纪律') &&
      cfg.systemPrompt?.includes('只推演一次') &&
      cfg.systemPrompt?.includes('不先写一版再推翻重写第二版'),
    '✓ systemPrompt 含终稿纪律(要点清单一次定稿 → 直写终稿;同一约束不重复推导;不整段重写)',
  )

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

  // 单模式(不再 codeKind):默认 html-fragment skill + 完整页面级 prompt
  const cfg4 = createHtmlSubagent({ writablePaths: ['components'] })
  assert(cfg4.skills?.length === 1 && cfg4.skills[0].name === 'html-fragment', '✓ 单模式 → 默认 html-fragment skill')
  assert(cfg4.systemPrompt?.includes('.html'), '✓ 单模式 → systemPrompt 引导 .html 文件')
  assert(String(cfg4.skills?.[0].getContent?.()).includes('完整、自包含'), '✓ html-fragment skill 含完整页面输出契约')
  const cfg5 = createHtmlSubagent({ writablePaths: ['components'] })
  assert(cfg5.skills?.[0].name === 'html-fragment', '✓ 单模式(去 codeKind/sfc)→ 默认 html-fragment skill')
}
