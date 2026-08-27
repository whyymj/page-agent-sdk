/**
 * sec-115:html-design-skill(createHtmlSubagent 内置 web-design-engineer 设计品味 skill)
 * - vendoring 完整性:references 29 项(25 配方 + INDEX + 3 顶层)全带 description + 非空内容;name 唯一、含 references/ 前缀
 *   (与主文内引用/上游磁盘形态 1:1;load_skill ref 精确匹配 —— 主文引用全量对账防漂移,2026-08-27 评审 HIGH 修)
 * - 主文适配三处锚点:宿主环境段(委派制/不能反问/保守默认/收口报告)/ Step0 无网(task 为准)/ 自包含组件形态 + validate_code
 * - 渐进披露:主文不含配方正文(chrome-amber 只在 references);主文体积受控
 * - 装配:默认两 skill 并列(html-fragment + web-design-engineer)/ design:false 关 / SkillSpec 替换 / 用户 skills 后追加 / rebuild 钩子保持
 * - 编排引导:htmlOrchestratorPrompt 第三参 design 控制(默认含配方名引导;false 不含)
 */
import { createHtmlSubagent } from '../../sdk/htmlSubagent'
import { buildDesignSkill, DESIGN_SKILL_NAME } from '../../sdk/designSkill'
import { DESIGN_REFERENCES } from '../../sdk/designSkill/references'
import { designSkillDoc } from '../../sdk/designSkill/skillDoc'
import { htmlOrchestratorPrompt } from '../../presets'
import type { TestCtx } from './_ctx'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx

  // ===== buildDesignSkill 形态 =====
  console.log('\n[html-design-skill · skill 形态]')
  const ds = buildDesignSkill()
  assert(ds.name === DESIGN_SKILL_NAME && DESIGN_SKILL_NAME === 'web-design-engineer', '✓ skill 名 = web-design-engineer(与上游 frontmatter 一致)')
  assert(ds.description.includes('anti-cliché') && ds.description.includes('recipes'), '✓ description 含品味要素锚(反俗套/配方)')
  assert(typeof ds.getContent!() === 'string' && ds.getContent!().length > 20_000, '✓ getContent 返回主文(33K 量级)')

  // ===== references 完整性(29 项;name 与上游路径 1:1)=====
  console.log('\n[html-design-skill · references]')
  const doc = designSkillDoc
  assert(DESIGN_REFERENCES.length === 29, `✓ references 共 29 项(25 配方 + INDEX + 3 顶层;实际 ${DESIGN_REFERENCES.length})`)
  const names = DESIGN_REFERENCES.map((r) => r.name)
  assert(new Set(names).size === 29, '✓ reference name 全局唯一(load_skill ref 按名精确匹配)')
  assert(names.includes('references/advanced-patterns.md') && names.includes('references/critique-guide.md') && names.includes('references/design-directions.md'),
    '✓ 顶层 3 参考在(references/advanced-patterns / critique-guide / design-directions)')
  assert(names.includes('references/style-recipes/INDEX.md'), '✓ 配方索引 references/style-recipes/INDEX.md 在')
  const recipes = names.filter((n) => n.startsWith('references/style-recipes/') && n !== 'references/style-recipes/INDEX.md')
  assert(recipes.length === 25, `✓ 配方 25 个(实际 ${recipes.length})`)
  assert(recipes.includes('references/style-recipes/linear.md') && recipes.includes('references/style-recipes/apple-hig.md') && recipes.includes('references/style-recipes/bloomberg-terminal.md'),
    '✓ 代表配方在(name 含 references/ 前缀,与主文引用形态一致)')
  // 主文引用 ↔ ref name 全量对账(load_skill ref 精确匹配;漂移 = 照主文调 ref 首次必失败烧一轮)
  const citations = [...doc.matchAll(/references\/[A-Za-z0-9._/-]+?\.md/g)].map((m) => m[0])
  assert(citations.length >= 10, `✓ 主文含 ≥10 处 references/ 引用(实际 ${citations.length})`)
  const dangling = [...new Set(citations)].filter((x) => !names.includes(x))
  assert(dangling.length === 0, `✓ 主文全部引用都能精确命中 reference name(悬空 ${dangling.length}:${dangling.slice(0, 3).join(',')}…)`)
  assert(DESIGN_REFERENCES.every((r) => typeof r.description === 'string' && r.description.length > 10), '✓ 每个参考带 description(主文尾部目录引用,帮 LLM 选 ref)')
  assert(DESIGN_REFERENCES.every((r) => typeof r.getContent!() === 'string' && r.getContent!().length > 500), '✓ 每个参考 getContent 非空(>500 字节,防空文件误入)')
  // 内容为上游原文:配方头结构保留(School/Vibe/Best for 三行)
  const linear = DESIGN_REFERENCES.find((r) => r.name === 'references/style-recipes/linear.md')!
  assert(/^- \*\*School\*\*: /m.test(linear.getContent!()), '✓ 配方内容为上游原文(文件头 School/Vibe 结构保留)')

  // ===== 主文适配三处锚点(嫁接可辨识;上游升级时断言护住适配不丢)=====
  console.log('\n[html-design-skill · 主文适配锚点]')
  assert(doc.includes('## Host Environment (page-agent-sdk adaptation)'), '✓ 嫁接①:Host Environment 段在(Scope 后插入)')
  assert(doc.includes('delegated sub-agent') && doc.includes('cannot converse with the user'), '✓ 嫁接①:委派制定性(不能中途对话)')
  assert(doc.includes('conservative') && doc.includes('closing report'), '✓ 嫁接①:保守默认 + 收口报告假设(Checkpoint 语义重解释)')
  assert(doc.includes('no network tools') && doc.includes('Never fabricate'), '✓ 嫁接②:Step 0 无网版(task 为准 + 禁编造)')
  assert(doc.includes('cannot ask the user') && doc.includes('fill every gap'), '✓ 嫁接③:Step 1 不能反问(缺口分级 + 保守默认)')
  assert(doc.includes('self-contained HTML') && doc.includes('validate_code'), '✓ 嫁接③:自包含组件形态 + validate_code 收口')
  assert(!doc.includes('**first** action is') && !doc.includes('Ask extensively'), '✓ 未适配的上游指令形态已剥(WebSearch 优先指令/Ask extensively 表格)')
  assert(!doc.includes('yt-dlp') && !doc.includes('brand-spec.md` file'), '✓ CLI 资产抓取/文件系统机制已剥(子 agent 无文件系统)')

  // ===== 渐进披露:配方正文不进主文 =====
  console.log('\n[html-design-skill · 渐进披露]')
  const terminal = DESIGN_REFERENCES.find((r) => r.name === 'references/style-recipes/bloomberg-terminal.md')!
  assert(!doc.includes('chrome-amber') && terminal.getContent!().includes('chrome-amber'),
    '✓ 配方正文只在 references(chrome-amber 主文零出现)—— 29 参考按需单个 load,不整包灌')
  assert(doc.length < 60_000, `✓ 主文体积受控(<60K,实际 ${Math.round(doc.length / 1024)}K;system 索引只多一行)`)

  // ===== 装配三态(design 默认 / false / 自定义替换)+ 用户 skills 共存 =====
  console.log('\n[html-design-skill · 装配]')
  const h1 = createHtmlSubagent({ writablePaths: ['components'] })
  assert(h1.skills?.length === 2 && h1.skills[0].name === 'html-fragment' && h1.skills[1].name === DESIGN_SKILL_NAME,
    '✓ 默认装两 skill:html-fragment(规范)在前 + web-design-engineer(品味)并列在后')
  const h2 = createHtmlSubagent({ writablePaths: ['components'], design: false })
  assert(h2.skills?.length === 1 && h2.skills[0].name === 'html-fragment', '✓ design:false → 只装 html-fragment(品味零注入)')
  const myDesign = { name: 'my-design', description: '自定义品味', getContent: () => 'my design taste' }
  const h3 = createHtmlSubagent({ writablePaths: ['components'], design: myDesign })
  assert(h3.skills?.length === 2 && h3.skills[1].name === 'my-design', '✓ design:SkillSpec → 内置替换为自定义版本')
  const mySkill = { name: 'my-skill', description: 'x', getContent: () => 'my skill content' }
  const h4 = createHtmlSubagent({ writablePaths: ['components'], skills: [mySkill] })
  assert(h4.skills?.length === 2 && h4.skills[0].name === 'my-skill' && h4.skills[1].name === DESIGN_SKILL_NAME,
    '✓ 用户传 skills → design 追加在用户 skills 之后(不覆盖用户面)')
  const h5 = createHtmlSubagent({ writablePaths: ['components'], skills: [mySkill], design: false })
  assert(h5.skills?.length === 1 && h5.skills[0].name === 'my-skill', '✓ 用户 skills + design:false → 原样不追加')

  // ===== rebuild 钩子:推断回填 root 后技能表完整(design 同实例保持)=====
  console.log('\n[html-design-skill · rebuild]')
  const h6 = createHtmlSubagent({})
  ;(h6 as any)._rebuildCodeAssetPaths('sections')
  assert(h6.skills?.length === 2 && h6.skills[0].name === 'html-fragment' && h6.skills[1].name === DESIGN_SKILL_NAME,
    '✓ rebuild 后两 skill 仍全(html-fragment 随 root 重建 + design 保持)')
  assert(((h6.skills as any[])[0] as any).getContent().includes('sections.N'), '✓ rebuild 后 html-fragment 内容随新 root 参数化')
  const h7 = createHtmlSubagent({ skills: [mySkill] })
  ;(h7 as any)._rebuildCodeAssetPaths('sections')
  assert(h7.skills?.length === 2 && h7.skills[0].name === 'my-skill' && h7.skills[1].name === DESIGN_SKILL_NAME,
    '✓ rebuild 后用户 skills 原样 + design 追加保持')

  // ===== 编排引导(design 开启才注入配方名引导)=====
  console.log('\n[html-design-skill · 编排引导]')
  assert(htmlOrchestratorPrompt('html').includes('web-design-engineer') && htmlOrchestratorPrompt('html').includes('linear'),
    '✓ htmlOrchestratorPrompt 默认(design=true)含设计配方引导(web-design-engineer + 配方名)')
  assert(!htmlOrchestratorPrompt('html', 'code', false).includes('web-design-engineer'),
    '✓ htmlOrchestratorPrompt(…,false) 不含设计引导(提示随能力开关注入)')
  assert((h1 as any)._codeAsset.orchestratorPrompt.includes('web-design-engineer'), '✓ 默认装配的编排段含设计引导')
  assert(!(h2 as any)._codeAsset.orchestratorPrompt.includes('web-design-engineer'), '✓ design:false 装配的编排段不含设计引导(与 skill 面一致)')
  // 自定义 design 替换 → 不注入内置配方名引导(自定义 skill 无 linear 等配方,引导会指向不存在的名字)
  assert(!(h3 as any)._codeAsset.orchestratorPrompt.includes('linear') && !(h3 as any)._codeAsset.orchestratorPrompt.includes('web-design-engineer'),
    '✓ design:SkillSpec 替换 → 编排段不注入内置配方名引导(自定义版本自配引导)')
}
