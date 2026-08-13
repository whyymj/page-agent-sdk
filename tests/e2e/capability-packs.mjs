// 能力包(createRagSubagent / createHtmlSubagent 专用子 agent)+ 子 agent 架构扩展(allowedTools/middleware/summarization/vfsWrite)
import { setupEnv, createAssert, FAKE_LLM, createChatSdk } from './_helpers.mjs'
import { z } from 'zod'
import { createRagSubagent, createHtmlSubagent } from '../../dist/page-agent-sdk.js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:capability-packs] 导出 + skill 分发(不导出常量)')
  assert(typeof createRagSubagent === 'function', 'createRagSubagent 导出为 function')
  assert(typeof createHtmlSubagent === 'function', 'createHtmlSubagent 导出为 function')
  const sdkExports = await import('../../dist/page-agent-sdk.js')
  assert(sdkExports.ragSearchSkill === undefined, 'SDK 不导出 ragSearchSkill(纯分发 + 工厂内部装)')
  assert(sdkExports.htmlBuilderSkill === undefined, 'SDK 不导出 htmlBuilderSkill(纯分发 + 工厂内部装)')

  console.log('[e2e:capability-packs] createRagSubagent → use_rag 委派工具 + 中间件')
  {
    const stubRetriever = async (q) => [{ content: `${q} 文档`, source: 'doc.md' }]
    const sdk = createChatSdk({
      ui: false, id: 'e2e-cap-rag', storage: 'memory', llm: FAKE_LLM,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      subagents: [createRagSubagent({ retriever: stubRetriever })],
    })
    await sdk.mount()
    const tools = sdk.inspect().tools
    assert(tools.some((t) => t.name === 'use_rag'), 'subagents:[createRagSubagent] → tools 含 use_rag 委派工具')
    assert(sdk.inspect().middleware.includes('subagents'), 'subagents 中间件装载')
    sdk.unmount()
  }

  console.log('[e2e:capability-packs] createHtmlSubagent → use_html 委派工具')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-cap-html', storage: 'memory', llm: FAKE_LLM,
      capabilities: { fetch: false, skills: false, summarization: false, memory: false },
      subagents: [createHtmlSubagent({ writablePaths: ['components'] })],
    })
    await sdk.mount()
    assert(sdk.inspect().tools.some((t) => t.name === 'use_html'), 'subagents:[createHtmlSubagent] → tools 含 use_html 委派工具')
    sdk.unmount()
  }

  console.log('[e2e:capability-packs] sdk.vfsWrite(异步注入 vfs)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-cap-vfs', storage: 'memory', llm: FAKE_LLM,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
    })
    await sdk.mount()
    assert(typeof sdk.vfsWrite === 'function', 'sdk.vfsWrite 为 function')
    let threw = false
    try { sdk.vfsWrite('docs/hero.md', '组件文档内容') } catch { threw = true }
    assert(!threw, 'sdk.vfsWrite(字符串)调用不抛')
    try { sdk.vfsWrite('docs/cfg.json', { theme: 'dark' }) } catch { threw = true }
    assert(!threw, 'sdk.vfsWrite(对象)调用不抛(JSON.stringify)')
    // vfsRead:只读读取 vfs 文件(集成方渲染层按 codeRef 取代码);写入后读回一致
    assert(typeof sdk.vfsRead === 'function', 'sdk.vfsRead 为 function')
    assert(sdk.vfsRead('docs/hero.md') === '组件文档内容', 'sdk.vfsRead 读回 vfsWrite 写入的字符串内容')
    assert(sdk.vfsRead('docs/cfg.json') === '{"theme":"dark"}', 'sdk.vfsRead 读回 vfsWrite 对象 JSON.stringify 结果')
    assert(sdk.vfsRead('docs/不存在.md') === undefined, 'sdk.vfsRead 不存在的路径返回 undefined')
    // vfsWrite/vfsRead 不暴露 vfsStore;写入逻辑 = files[normalize(path)] = {content, updatedAt}(同 vfs_write,语义经 vfs_write 工具覆盖)
    sdk.unmount()
  }

  console.log('[e2e:capability-packs] 三 skill 文件 + npm files')
  {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const root = resolve(__dirname, '../..')
    const ragSkill = resolve(root, 'skills/rag-search/SKILL.md')
    const htmlSkill = resolve(root, 'skills/html-builder/SKILL.md')
    const htmlFragSkill = resolve(root, 'skills/html-fragment/SKILL.md')
    assert(existsSync(ragSkill), 'skills/rag-search/SKILL.md 存在')
    assert(existsSync(htmlSkill), 'skills/html-builder/SKILL.md 存在')
    assert(existsSync(htmlFragSkill), 'skills/html-fragment/SKILL.md 存在')
    if (existsSync(ragSkill)) {
      assert(readFileSync(ragSkill, 'utf8').includes('name: rag-search'), 'rag-search SKILL.md frontmatter name')
    }
    if (existsSync(htmlSkill)) {
      const c = readFileSync(htmlSkill, 'utf8')
      assert(c.includes('name: html-builder'), 'html-builder SKILL.md frontmatter name')
      assert(c.includes('代码资产模型'), 'html-builder SKILL.md 含 code 资产模型约定(单模式)')
    }
    if (existsSync(htmlFragSkill)) {
      const c = readFileSync(htmlFragSkill, 'utf8')
      assert(c.includes('name: html-fragment'), 'html-fragment SKILL.md frontmatter name')
      assert(c.includes('v-html'), 'html-fragment SKILL.md 含 v-html 片段契约')
    }
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
    assert(JSON.stringify(pkg.files).includes('skills'), 'package.json files 含 skills/')
  }

  console.log('[e2e:capability-packs] 子 agent 观察层(inspect active/history + 便利 API)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-cap-obs', storage: 'memory', llm: FAKE_LLM,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      subagents: [createRagSubagent({ retriever: async () => [] })],
    })
    await sdk.mount()
    const sub = sdk.inspect().subagent
    assert(Array.isArray(sub.active), 'inspect().subagent.active 为数组(默认空)')
    assert(sub.active.length === 0, '默认 active 空(无委派)')
    assert(Array.isArray(sub.history), 'inspect().subagent.history 为数组(默认空)')
    assert(sub.history.length === 0, '默认 history 空(无委派)')
    assert(typeof sdk.getActiveSubagents === 'function', 'sdk.getActiveSubagents 为 function')
    assert(Array.isArray(sdk.getActiveSubagents()), 'getActiveSubagents() 返回数组')
    assert(Array.isArray(sdk.subagentHistory), 'sdk.subagentHistory 为数组(getter 实时)')
    sdk.unmount()
  }

  console.log('[e2e:capability-packs] HTML 格式校验(导出 + 工厂装配 + verify 门禁运行时)')
  {
    const { validateHtmlFormat, createHtmlFormatCheck } = await import('../../dist/page-agent-sdk.js')
    // 导出面:纯函数校验器 + verify check 工厂(dist 可用)
    assert(typeof validateHtmlFormat === 'function', 'validateHtmlFormat 导出为 function')
    assert(typeof createHtmlFormatCheck === 'function', 'createHtmlFormatCheck 导出为 function')
    assert(validateHtmlFormat('<div><p>x</p></div>').length === 0, 'validateHtmlFormat → 合法片段通过')
    const iss = validateHtmlFormat('<!DOCTYPE html><div>x')
    assert(iss.some((i) => i.code === 'DOCTYPE_IN_FRAGMENT'), 'validateHtmlFormat → DOCTYPE 报片段契约违背')
    assert(iss.some((i) => i.code === 'UNCLOSED_TAG'), 'validateHtmlFormat → 未闭合标签检出')
    const chk = createHtmlFormatCheck({ vfsPrefix: 'html/' })
    const bad = chk({ messages: [], state: { files: { 'html/a.html': { content: '<div>x', updatedAt: 1 } } } })
    assert(bad.ok === false && bad.feedback.includes('a.html'), 'createHtmlFormatCheck → 问题文件 ok:false 带路径')

    // 工厂装配面:formatCheck 默认开(validate_code 工具 + verify 门禁 + maxVerifyAttempts)
    const fc = createHtmlSubagent({ writablePaths: ['components'] })
    assert(fc.middleware?.some((m) => m.name === 'html-validate-tools'), 'formatCheck 默认开 → middleware 含 html-validate-tools')
    assert(fc.middleware?.some((m) => m.name === 'verify'), 'formatCheck 默认开 → middleware 含 verify(beforeReturn 门禁)')
    assert(fc.maxVerifyAttempts === 2, 'formatCheck 默认开 → maxVerifyAttempts 2(子 agent 自纠兜底)')
    const fcOff = createHtmlSubagent({ writablePaths: ['components'], formatCheck: false })
    assert(!fcOff.middleware?.some((m) => m.name === 'verify') && fcOff.maxVerifyAttempts === undefined, 'formatCheck:false → 无校验链')
    const fcHtml = createHtmlSubagent({ writablePaths: ['components'], codeKind: 'html' })
    assert(fcHtml.systemPrompt?.includes('v-html') && fcHtml.skills?.[0]?.name === 'html-fragment', "codeKind:'html' → v-html 片段契约 prompt + html-fragment skill")
  }

  console.log('[e2e:capability-packs] verify 门禁运行时(子 agent 写坏代码 → 回灌自纠 → 修正后放行)')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    // 队列序:主委派 → 子写坏代码 → 子想收口(门禁拦) → 子 vfs_edit 修正 → 子收口(过) → 主收口
    const llm = stubModel(
      { toolCalls: [{ name: 'use_html', args: { task: '生成横幅代码' } }] },
      { toolCalls: [{ name: 'vfs_write', args: { path: 'html/banner.html', content: '<div>横幅' } }] },
      { text: '生成完成' },
      { toolCalls: [{ name: 'vfs_edit', args: { path: 'html/banner.html', oldString: '<div>横幅', newString: '<div>横幅</div>' } }] },
      { text: '已修正完成' },
      { text: '已生成横幅组件' },
    )
    const sdk = createChatSdk({
      ui: false, id: 'e2e-cap-htmlgate', storage: false, llm,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      subagents: [createHtmlSubagent({ writablePaths: ['components'] })],
    })
    await sdk.mount()
    const reply = await sdk.send('生成一个横幅')
    assert(/已生成横幅组件/.test(reply), '✓ 门禁自纠后主流程正常收口')
    assert(llm.calls === 6, `✓ 门禁生效:子 agent 被回灌自纠(6 次 model 调用,实际 ${llm.calls})`)
    sdk.unmount()

    // 对照:formatCheck:false → 子 agent 写完坏代码直接收口(4 次调用,无自纠)
    const llm2 = stubModel(
      { toolCalls: [{ name: 'use_html', args: { task: '生成横幅代码' } }] },
      { toolCalls: [{ name: 'vfs_write', args: { path: 'html/banner.html', content: '<div>横幅' } }] },
      { text: '生成完成' },
      { text: '已生成横幅组件' },
    )
    const sdk2 = createChatSdk({
      ui: false, id: 'e2e-cap-htmlgate-off', storage: false, llm: llm2,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      subagents: [createHtmlSubagent({ writablePaths: ['components'], formatCheck: false })],
    })
    await sdk2.mount()
    await sdk2.send('生成一个横幅')
    assert(llm2.calls === 4, `✓ formatCheck:false 对照:无门禁自纠(4 次调用,实际 ${llm2.calls})`)
    sdk2.unmount()
  }

  console.log('[e2e:capability-packs] createHtmlSubagent 单模式 commit(框架 afterAgent 自动 vfs→data.code,集成方无需 onComplete)')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    // data 预置组件(含 __pgId,模拟 persisted);框架 checkout(data.code→vfs)→ 子 vfs_write 改工作副本 → afterAgent commit 回写 data.code
    const llm = stubModel(
      { toolCalls: [{ name: 'use_html', args: { task: '改横幅' } }] },
      { toolCalls: [{ name: 'vfs_write', args: { path: 'html/c_banner.html', content: '<section>新横幅</section>' } }] },
      { text: '已改' },
      { text: '完成' },
    )
    const bind = { title: 't', components: [{ type: 'custom', name: 'banner', code: '<section>旧</section>', __pgId: 'c_banner' }] }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-cap-commit', storage: false, llm,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ title: z.string(), components: z.array(z.object({ type: z.string(), name: z.string().optional(), code: z.string().optional() })) }), bind, description: '测试' },
      subagents: [createHtmlSubagent({ writablePaths: ['components'], codeKind: 'html', formatCheck: false })],
    })
    await sdk.mount()
    await sdk.send('改横幅')
    assert(bind.components[0].code === '<section>新横幅</section>', '✓ 单模式 commit:子 vfs_write 工作副本 → 框架 afterAgent 回写 data.code(直改 bind,无需 onComplete)')
    sdk.unmount()
  }

  console.log('[e2e:capability-packs] 子 agent reasoning 转发(思考过程可见 → stream onEvent 收到 subagent reasoning)')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    // 队列(主子共享 stub,按调用顺序消费):[0]主委派 → [1]子 reasoning+vfs_write → [2]子收口 → [3]主收口
    // reasoning 与 toolCalls 组合:避免子 agent 因无 tool_call 提前终止,从而能同时验证思考 + 工具进度
    // 注:用 sdk.stream(流式)而非 send(invoke)—— invoke 不外发流式事件(text/reasoning/tool_call/subagent)
    const llm = stubModel(
      { toolCalls: [{ name: 'use_html', args: { task: '生成横幅' } }] },
      { reasoning: '我需要设计一个带标题的横幅组件', toolCalls: [{ name: 'vfs_write', args: { path: 'html/banner.html', content: '<section>横幅</section>' } }] },
      { text: '横幅已生成' },
      { text: '横幅完成' },
    )
    const subEvents = []
    const bind = { title: 't', components: [] }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-cap-reasoning', storage: false, llm,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ title: z.string(), components: z.array(z.object({ type: z.string(), name: z.string().optional(), code: z.string().optional() })) }), bind, description: '测试' },
      subagents: [createHtmlSubagent({ writablePaths: ['components'], codeKind: 'html', formatCheck: false })],
    })
    await sdk.mount()
    await sdk.stream([{ role: 'user', content: '生成横幅', timestamp: Date.now() }], (e) => { if (e.type === 'subagent') subEvents.push(e) })
    // 子 reasoning 经 subagent 事件外发(思考过程可见;修前:reasoning 硬丢弃致子 LLM 思考期间 UI 静默)
    const reasoningEv = subEvents.find((e) => e.kind === 'reasoning')
    assert(reasoningEv && typeof reasoningEv.delta === 'string' && reasoningEv.delta.includes('横幅组件'), '✓ 子 agent reasoning 转发到 stream onEvent(思考过程可见,不再静默)')
    // 对照:子 tool_call 仍转发(原有行为不破坏)
    assert(subEvents.some((e) => e.kind === 'tool_call'), '✓ 子 tool_call 仍转发(reasoning 新增不破坏原有工具进度转发)')
    sdk.unmount()
  }

  console.log('[e2e:capability-packs] focus vfs 守卫(子 agent 继承主焦点 → 越界改非焦点组件代码 PATH_DENIED → 自纠改焦点组件)')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    // 主 setFocus components.0(hero)→ 子继承焦点;队列模拟子 agent 先越界改 banner(被守卫 PATH_DENIED)再自纠改 hero
    // [0]主委派 → [1]子 vfs_write c_banner(越界→PATH_DENIED)→ [2]子 vfs_write c_hero(放行)→ [3]子收口 → [4]主收口
    const llm = stubModel(
      { toolCalls: [{ name: 'use_html', args: { task: '把 hero 标题改成新标题' } }] },
      { toolCalls: [{ name: 'vfs_write', args: { path: 'html/c_banner.html', content: '<section>越界新 banner</section>' } }] },
      { toolCalls: [{ name: 'vfs_write', args: { path: 'html/c_hero.html', content: '<section>新 hero</section>' } }] },
      { text: '已改 hero' },
      { text: '完成' },
    )
    const bind = { title: 't', components: [
      { type: 'custom', name: 'hero', code: '<section>旧 hero</section>', __pgId: 'c_hero' },
      { type: 'custom', name: 'banner', code: '<section>旧 banner</section>', __pgId: 'c_banner' },
    ] }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-cap-focusvfs', storage: false, llm,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ title: z.string(), components: z.array(z.object({ type: z.string(), name: z.string().optional(), code: z.string().optional() })) }), bind, description: '测试' },
      subagents: [createHtmlSubagent({ writablePaths: ['components'], codeKind: 'html', formatCheck: false })],
    })
    await sdk.mount()
    const fr = sdk.setFocus({ path: 'components.0', label: 'hero' })
    assert(fr && fr.ok, '✓ sdk.setFocus(components.0) 聚焦成功(path 在 schema 内,子 agent 将继承)')
    const reply = await sdk.send('把 hero 标题改成新标题')
    assert(/完成/.test(reply), '✓ focus vfs 守卫:越界自纠后主流程正常收口')
    assert(bind.components[0].code === '<section>新 hero</section>', '✓ focus vfs 守卫:焦点组件 hero 代码被改(放行 + commit)')
    assert(bind.components[1].code === '<section>旧 banner</section>', '✓ focus vfs 守卫:非焦点组件 banner 越界改被 PATH_DENIED 拦(补 focus.ts 排除 vfs 的缝隙),code 保持原样')
    assert(llm.calls === 5, `✓ focus vfs 守卫:子 agent 越界被拦后自纠(5 次 model 调用,实际 ${llm.calls})`)
    sdk.unmount()
  }

  console.log('[e2e:capability-packs] focus vfs 守卫对照:无 focus → 子 agent 改任意组件代码放行(零回归)')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    const llm = stubModel(
      { toolCalls: [{ name: 'use_html', args: { task: '改 banner' } }] },
      { toolCalls: [{ name: 'vfs_write', args: { path: 'html/c_banner.html', content: '<section>新 banner</section>' } }] },
      { text: '已改 banner' },
      { text: '完成' },
    )
    const bind = { title: 't', components: [
      { type: 'custom', name: 'hero', code: '<section>旧 hero</section>', __pgId: 'c_hero' },
      { type: 'custom', name: 'banner', code: '<section>旧 banner</section>', __pgId: 'c_banner' },
    ] }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-cap-focusvfs-nofocus', storage: false, llm,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ title: z.string(), components: z.array(z.object({ type: z.string(), name: z.string().optional(), code: z.string().optional() })) }), bind, description: '测试' },
      subagents: [createHtmlSubagent({ writablePaths: ['components'], codeKind: 'html', formatCheck: false })],
    })
    await sdk.mount()
    // 不 setFocus → 子 agent 无焦点 → 守卫放行任意 vfs 代码文件(原行为零回归)
    await sdk.send('改 banner')
    assert(bind.components[1].code === '<section>新 banner</section>', '✓ 无 focus 对照:子 agent 改 banner 代码放行(守卫零回归,无焦点不拦)')
    assert(llm.calls === 4, `✓ 无 focus 对照:正常收口(4 次 model 调用,实际 ${llm.calls})`)
    sdk.unmount()
  }

  console.log('[e2e:capability-packs] 组件代码文件地图(augmentPrompt 注入子 agent system prompt,修 __pgId 映射摩擦)')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    // __pgId 映射摩擦:__pgId 随机生成且对 agent 隐藏 → 子 agent 拿 name 定位不到 vfs 文件。
    // 修复:codeAssetMiddleware.augmentPrompt 每轮注入「组件代码文件地图」(name → vfs 路径)到子 agent system prompt
    const llm = stubModel(
      { toolCalls: [{ name: 'use_html', args: { task: '改 hero 标题' } }] },
      { toolCalls: [{ name: 'vfs_write', args: { path: 'html/c_hero.html', content: '<section>新 hero</section>' } }] },
      { text: '已改' },
      { text: '完成' },
    )
    const bind = { title: 't', components: [
      { type: 'custom', name: 'hero', code: '<section>旧 hero</section>', __pgId: 'c_hero' },
      { type: 'custom', name: 'banner', code: '<section>旧 banner</section>', __pgId: 'c_banner' },
    ] }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-cap-assetmap', storage: false, llm,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ title: z.string(), components: z.array(z.object({ type: z.string(), name: z.string().optional(), code: z.string().optional() })) }), bind, description: '测试' },
      subagents: [createHtmlSubagent({ writablePaths: ['components'], codeKind: 'html', formatCheck: false })],
    })
    await sdk.mount()
    await sdk.send('改 hero 标题')
    const withMap = llm.systemPrompts.filter((s) => s.includes('组件代码文件地图'))
    assert(withMap.length >= 1, '✓ 组件代码文件地图注入子 agent system prompt(augmentPrompt;子 agent 按 name 直接定位 vfs 文件)')
    assert(withMap.some((s) => s.includes('hero → html/c_hero.html') && s.includes('banner → html/c_banner.html')), '✓ 地图含全部组件 name → vfs 路径(含预设 __pgId,无需猜随机 id)')
    // 主 agent 不装 codeAsset 中间件 → 主 agent 的 LLM 调用不含地图(不污染主上下文;主 agent 不碰代码文件)
    const mainOnly = llm.systemPrompts.filter((s) => s.includes('use_html') && !s.includes('vfs_write'))
    assert(mainOnly.length >= 1 && mainOnly.every((s) => !s.includes('组件代码文件地图')), '✓ 主 agent system prompt 不含地图(只进子 agent 上下文)')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
