/**
 * sec-67:capability-packs(专用子 agent 工厂 + 子 agent 架构扩展)
 * - 架构扩展:SubagentConfig.allowedTools/middleware/summarization(经两工厂返回结构验证)
 * - createRagSubagent:返回结构 / search_docs(stub retriever)/ load_doc / 抛错降级 / 空命中 / 全无知识源抛错 / 配置覆盖 / useVfs allowedTools / 默认 rag-search skill
 * - createHtmlSubagent:返回结构 / todos middleware / allowedTools vfs(含 vfs_rm)/ 不含 draft_write / summarization 默认开 / planning:false / writablePaths 必填 / codeVfsPrefix / 默认 html-fragment skill
 */
import { createRagSubagent } from '../../sdk/ragSubagent'
import { createHtmlSubagent, buildHtmlFragmentSkill, htmlFragmentSkill } from '../../sdk/htmlSubagent'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke } = ctx

  // ===== createRagSubagent =====
  console.log('\n[capability-packs · createRagSubagent]')
  const stubRetriever = async (query: string) => [{ content: `关于${query}的内容`, source: 'doc.md' }]
  const cfg = createRagSubagent({ retriever: stubRetriever })
  assert(cfg.id === 'rag', '✓ createRagSubagent → id 默认 rag')
  assert(cfg.maxToolRounds === 8, '✓ createRagSubagent → maxToolRounds 默认 8')
  assert(cfg.systemPrompt?.includes('search_docs'), '✓ createRagSubagent → systemPrompt 含 search_docs 引导')
  assert(cfg.allowedTools?.includes('vfs_grep'), '✓ useVfs(默认)→ allowedTools 含 vfs_grep')
  assert(cfg.allowedTools?.includes('vfs_read'), '✓ useVfs → allowedTools 含 vfs_read')
  assert(cfg.skills?.length === 1 && cfg.skills[0].name === 'rag-search', '✓ 默认装 rag-search skill')

  // search_docs:invoke stub retriever → 格式化文本含 source
  const searchTool = cfg.tools!.find((t: any) => t.name === 'search_docs')!
  const r1 = await invoke(searchTool, { query: '按钮' })
  assert(r1.includes('关于按钮的内容'), '✓ search_docs → stub retriever 返回格式化文本')
  assert(r1.includes('doc.md'), '✓ search_docs → 含 source 标注')

  // retriever 抛错 → 降级错误字符串(不抛)
  const errRetriever = async () => { throw new Error('向量库挂了') }
  const cfg2 = createRagSubagent({ retriever: errRetriever, useVfs: false })
  const r2 = await invoke(cfg2.tools![0], { query: 'x' })
  assert(r2.includes('检索出错') && r2.includes('向量库挂了'), '✓ search_docs → retriever 抛错降级错误字符串')

  // 空命中 → 未检索到提示
  const emptyRetriever = async () => []
  const cfg3 = createRagSubagent({ retriever: emptyRetriever, useVfs: false })
  const r3 = await invoke(cfg3.tools![0], { query: 'x' })
  assert(r3.includes('未检索到'), '✓ search_docs → 空命中提示换关键词')

  // load_doc:stub loader
  const stubLoader = async (source: string) => [{ content: `${source} 的内容`, source }]
  const lcfg = createRagSubagent({ loader: stubLoader, useVfs: false })
  const loadTool = lcfg.tools!.find((t: any) => t.name === 'load_doc')!
  const lr = await invoke(loadTool, { source: 'hero.md' })
  assert(lr.includes('hero.md 的内容'), '✓ load_doc → stub loader 返回')

  // 全无知识源 → 抛错
  let threw = false
  try { createRagSubagent({ useVfs: false }) } catch { threw = true }
  assert(threw, '✓ createRagSubagent → 全无知识源(retriever/loader/useVfs)抛错')

  // 配置覆盖
  const cfg4 = createRagSubagent({ retriever: stubRetriever, id: 'docs', topK: 8, searchToolName: 'lookup', maxToolRounds: 4 })
  assert(cfg4.id === 'docs', '✓ id 可配(docs)')
  assert(cfg4.tools![0].name === 'lookup', '✓ searchToolName 可配(lookup)')
  assert(cfg4.maxToolRounds === 4, '✓ maxToolRounds 可配(4)')

  // useVfs:false → 无 allowedTools
  const cfg6 = createRagSubagent({ retriever: stubRetriever, useVfs: false })
  assert(!cfg6.allowedTools, '✓ useVfs:false → 无 allowedTools')

  // ===== createHtmlSubagent =====
  console.log('\n[capability-packs · createHtmlSubagent]')
  const hcfg = createHtmlSubagent({ writablePaths: ['components'] })
  assert(hcfg.id === 'html', '✓ createHtmlSubagent → id 默认 html')
  assert(JSON.stringify(hcfg.writablePaths) === '["components"]', '✓ writablePaths 透传')
  assert(hcfg.allowedTools?.includes('vfs_write'), '✓ allowedTools 含 vfs_write(代码→vfs)')
  assert(hcfg.allowedTools?.includes('vfs_edit'), '✓ allowedTools 含 vfs_edit')
  assert(hcfg.allowedTools?.includes('vfs_rm'), '✓ allowedTools 含 vfs_rm(代码删除生命周期)')
  assert(hcfg.allowedTools?.includes('vfs_grep'), '✓ allowedTools 含 vfs_grep')
  assert(!hcfg.allowedTools?.includes('draft_write'), '✓ allowedTools 不含 draft_write(代码不 in data)')
  assert(hcfg.summarization === true, '✓ summarization 默认开(true,频繁改代码累积快)')
  assert(hcfg.temperature === 0.4, '✓ temperature 默认 0.4(代码生成低温)')
  assert(hcfg.maxToolRounds === 12, '✓ maxToolRounds 默认 12(中等任务)')
  assert(hcfg.systemPrompt?.includes('html/'), '✓ systemPrompt 含 codeVfsPrefix(html/,工作副本引导)')
  assert(!hcfg.systemPrompt?.includes('codeRef') && hcfg.systemPrompt?.includes('数据资产'), '✓ systemPrompt 单模式(砍 codeRef;代码作为 data.code 资产 + vfs 工作副本)')
  assert((hcfg as any)._codeAsset?.writablePaths?.length === 1 && (hcfg as any)._codeAsset?.ext === 'html', '✓ _codeAsset 标记设(createChatSdk 装配识别 → checkout/commit + pgIdPaths/largeTextPaths)')
  assert(hcfg.skills?.length === 1 && hcfg.skills[0].name === 'html-fragment', '✓ 默认装 html-fragment skill(单模式完整页面级)')

  // middleware 含 todos(getPlanPhase 是 createTodosMiddleware 特有)
  assert(!!hcfg.middleware && hcfg.middleware.length > 0, '✓ middleware 默认装(planning:true)')
  assert(typeof (hcfg.middleware![0] as any).getPlanPhase === 'function', '✓ middleware[0] 是 todos 中间件(getPlanPhase)')

  // planning:false + formatCheck:false → middleware 不装(formatCheck 默认开会装校验链,见 sec-72)
  const hcfg2 = createHtmlSubagent({ writablePaths: ['components'], planning: false, formatCheck: false })
  assert(!hcfg2.middleware, '✓ planning:false + formatCheck:false → middleware 不装')

  // summarization:false → 不开
  const hcfg3 = createHtmlSubagent({ writablePaths: ['components'], summarization: false })
  assert(hcfg3.summarization === undefined, '✓ summarization:false → 不装(undefined)')

  // codeVfsPrefix 可配
  const hcfg4 = createHtmlSubagent({ writablePaths: ['components'], codeVfsPrefix: 'custom-code/' })
  assert(hcfg4.systemPrompt?.includes('custom-code/'), '✓ codeVfsPrefix 可配(systemPrompt 含 custom-code/)')

  // writablePaths 可选(writablepaths-infer):未传/空数组不再工厂层抛错,透传 _codeAsset 由装配期推断;
  // 非法类型(非数组)仍在工厂层 fail-fast
  const hcfg5 = createHtmlSubagent({})
  assert(Array.isArray(hcfg5.writablePaths) && hcfg5.writablePaths.length === 0 && hcfg5._codeAsset?.writablePaths.length === 0,
    '✓ createHtmlSubagent 未传 writablePaths → 不抛错,空数组透传(装配期 createChatSdk 从 schema 推断回填)')
  let hthrew = false
  try { createHtmlSubagent({ writablePaths: 'components' as unknown as string[] }) } catch { hthrew = true }
  assert(hthrew, '✓ writablePaths 非法类型(字符串)→ 工厂层抛错(fail-fast)')

  // ===== 提示词命名参数化(prompt 不写死集成方字段名;code/html/innerHtml、components/blocks/sections 各异) =====
  console.log('\n[capability-packs · createHtmlSubagent 提示词参数化]')
  // codeField + 非默认数组路径 → systemPrompt/skill 示例路径全部跟随,不残留 components/code 写死
  const pcfg = createHtmlSubagent({ codeField: 'props.html_code', writablePaths: ['blocks'] })
  assert(pcfg.systemPrompt?.includes('props.html_code') && pcfg.systemPrompt?.includes('blocks.N'),
    '✓ codeField+writablePaths 参数化 → systemPrompt 含 props.html_code / blocks.N')
  assert(!pcfg.systemPrompt?.includes('components.N.code') && !pcfg.systemPrompt?.includes('data 的 code 字段'),
    '✓ 参数化后 systemPrompt 不残留 components.N.code / 「data 的 code 字段」写死示例')
  assert(pcfg.skills?.[0].getContent().includes('blocks.N') && pcfg.skills?.[0].getContent().includes('props.html_code'),
    '✓ 默认 skill 内容同参数化(blocks.N + props.html_code)')
  assert(pcfg.description?.includes('props.html_code'), '✓ 默认 description 含 codeField(props.html_code)')
  assert(!pcfg.description?.includes('custom'), '✓ 默认 description 不写死 custom(字段名以 codeField 为准)')

  // 默认参数快照:不传 → components + code
  const dcfg = createHtmlSubagent({})
  assert(dcfg.systemPrompt?.includes('components.N') && dcfg.systemPrompt?.includes('data 的 code 字段'),
    '✓ 默认未传 writablePaths → 占位示例 components.N + 默认 codeField(向后兼容)')

  // 装配期重建钩子:推断回填 root 后 systemPrompt/skill 按新 root 重建(createChatSdk 装配期调用)
  ;(dcfg as any)._rebuildCodeAssetPaths('sections')
  assert(dcfg.systemPrompt?.includes('sections.N') && !dcfg.systemPrompt?.includes('components.N'),
    '✓ _rebuildCodeAssetPaths("sections") → systemPrompt 示例路径重建(不残留占位 components)')
  assert(dcfg.skills?.[0].getContent().includes('sections.N') && !dcfg.skills?.[0].getContent().includes('components.N'),
    '✓ 默认 skill 同步重建(sections.N)')

  // 传自定义 skills → 重建只动 systemPrompt 不覆盖自定义 skill
  const mySkill = { name: 'my-skill', description: 'x', getContent: () => 'my skill content' }
  const scfg = createHtmlSubagent({ skills: [mySkill] })
  ;(scfg as any)._rebuildCodeAssetPaths('sections')
  assert(scfg.skills?.length === 1 && scfg.skills[0].name === 'my-skill',
    '✓ 传自定义 skills → 重建钩子不覆盖自定义 skill')

  // buildHtmlFragmentSkill 构造器导出:root/codeField 参数化(默认快照 htmlFragmentSkill 同 3.10.0 契约)
  const bskill = buildHtmlFragmentSkill('sections', 'innerHtml')
  assert(bskill.getContent().includes('sections.N') && bskill.getContent().includes('innerHtml'),
    '✓ buildHtmlFragmentSkill("sections","innerHtml") → 内容参数化')
  assert(htmlFragmentSkill.getContent() === buildHtmlFragmentSkill().getContent(),
    '✓ htmlFragmentSkill = buildHtmlFragmentSkill() 默认快照(单一数据源)')
}
