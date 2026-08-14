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
  assert(sdkExports.htmlFragmentSkill === undefined, 'SDK 不导出 htmlFragmentSkill(纯分发 + 工厂内部装)')

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
    // vfsRead:只读读取 vfs 文件;写入后读回一致
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
    const htmlFragSkill = resolve(root, 'skills/html-fragment/SKILL.md')
    assert(existsSync(ragSkill), 'skills/rag-search/SKILL.md 存在')
    assert(existsSync(htmlFragSkill), 'skills/html-fragment/SKILL.md 存在')
    if (existsSync(ragSkill)) {
      assert(readFileSync(ragSkill, 'utf8').includes('name: rag-search'), 'rag-search SKILL.md frontmatter name')
    }
    if (existsSync(htmlFragSkill)) {
      const c = readFileSync(htmlFragSkill, 'utf8')
      assert(c.includes('name: html-fragment'), 'html-fragment SKILL.md frontmatter name')
      assert(c.includes('完整、自包含'), 'html-fragment SKILL.md 含完整页面级契约(单模式,不再 v-html 片段)')
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
    assert(validateHtmlFormat('<div><p>x</p></div>').length === 0, 'validateHtmlFormat → 合法 HTML 通过')
    assert(validateHtmlFormat('<!DOCTYPE html><html><body><div>x</div></body></html>').length === 0, 'validateHtmlFormat → 完整文档(DOCTYPE+html/body)通过(不再拦片段契约)')
    const iss = validateHtmlFormat('<div>x')
    assert(iss.some((i) => i.code === 'UNCLOSED_TAG'), 'validateHtmlFormat → 未闭合标签检出(结构校验保留)')
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
    const fcHtml = createHtmlSubagent({ writablePaths: ['components'] })
    assert(fcHtml.systemPrompt?.includes('完整、自包含') && fcHtml.skills?.[0]?.name === 'html-fragment', '单模式 → 完整页面级 prompt(默认含 script)+ html-fragment skill')
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
      subagents: [createHtmlSubagent({ writablePaths: ['components'], formatCheck: false })],
    })
    await sdk.mount()
    await sdk.send('改横幅')
    assert(bind.components[0].code === '<section>新横幅</section>', '✓ 单模式 commit:子 vfs_write 工作副本 → 框架 afterAgent 回写 data.code(直改 bind,无需 onComplete)')
    sdk.unmount()
  }

  console.log('[e2e:capability-packs] craft-notes 工匠笔记(子收口 [note] 行 → __pgNotes 沉淀 → 二次委派子上下文注入)')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    // 两轮共享 stub 队列:①主委派 ②子 vfs_write ③子收口含 [note] ④主收口 ⑤主再委派 ⑥子再改 ⑦子收口再 [note] ⑧主收口
    const llm = stubModel(
      { toolCalls: [{ name: 'use_html', args: { task: '改横幅' } }] },
      { toolCalls: [{ name: 'vfs_write', args: { path: 'html/c_banner.html', content: '<section>新横幅</section>' } }] },
      { text: '已改\n[note] 横幅用 grid 两列,标题字号 28' },
      { text: '完成' },
      { toolCalls: [{ name: 'use_html', args: { task: '再改横幅文案' } }] },
      { toolCalls: [{ name: 'vfs_write', args: { path: 'html/c_banner.html', content: '<section>再改</section>' } }] },
      { text: '已再改\n[note] 文案改用短句风格' },
      { text: '完成' },
    )
    const bind = { title: 't', components: [{ type: 'custom', name: 'banner', code: '<section>旧</section>', __pgId: 'c_banner' }] }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-cap-craftnotes', storage: false, llm,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ title: z.string(), components: z.array(z.object({ type: z.string(), name: z.string().optional(), code: z.string().optional() })) }), bind, description: '测试' },
      subagents: [createHtmlSubagent({ writablePaths: ['components'], formatCheck: false })],
    })
    await sdk.mount()
    await sdk.send('改横幅')
    assert(
      JSON.stringify(bind.components[0].__pgNotes) === JSON.stringify(['[note] 横幅用 grid 两列,标题字号 28']),
      '✓ craft-notes 沉淀:子 agent 收口 [note] 行 → 组件 __pgNotes(随 data bind 持久化)',
    )
    await sdk.send('再改横幅文案')
    assert(
      JSON.stringify(bind.components[0].__pgNotes) === JSON.stringify(['[note] 横幅用 grid 两列,标题字号 28', '[note] 文案改用短句风格']),
      '✓ craft-notes 累积:二次委派 [note] append(FIFO,前任交接保留)',
    )
    // 二次委派的子 agent 上下文(augmentPrompt 地图)含 📝 笔记行(systemPrompts 收集每次 model 调用的 system)
    assert(
      llm.systemPrompts.some((s) => s.includes('📝 笔记×1(最近):[note] 横幅用 grid 两列,标题字号 28')),
      '✓ craft-notes 注入:二次委派子 agent 的组件代码文件地图含 📝 笔记行(经 augmentPrompt,非 read 泄露)',
    )
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
      subagents: [createHtmlSubagent({ writablePaths: ['components'], formatCheck: false })],
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
      subagents: [createHtmlSubagent({ writablePaths: ['components'], formatCheck: false })],
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
      subagents: [createHtmlSubagent({ writablePaths: ['components'], formatCheck: false })],
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
      subagents: [createHtmlSubagent({ writablePaths: ['components'], formatCheck: false })],
    })
    await sdk.mount()
    await sdk.send('改 hero 标题')
    const withMap = llm.systemPrompts.filter((s) => s.includes('组件代码文件地图'))
    assert(withMap.length >= 1, '✓ 组件代码文件地图注入子 agent system prompt(augmentPrompt;子 agent 按 name 直接定位 vfs 文件)')
    assert(withMap.some((s) => s.includes('hero [0] → html/c_hero.html') && s.includes('banner [1] → html/c_banner.html')), '✓ 地图含全部组件 name [索引] → vfs 路径(含预设 __pgId,F3 索引消除重名歧义)')
    // 主 agent 不装 codeAsset 中间件 → 主 agent 的 LLM 调用不含地图(不污染主上下文;主 agent 不碰代码文件)
    const mainOnly = llm.systemPrompts.filter((s) => s.includes('use_html') && !s.includes('vfs_write'))
    assert(mainOnly.length >= 1 && mainOnly.every((s) => !s.includes('组件代码文件地图')), '✓ 主 agent system prompt 不含地图(只进子 agent 上下文)')
    sdk.unmount()
  }

  console.log('[e2e:capability-packs] 编排自适应注入(有 agent 委派 / 无 agent 降级 / opt-out / 自定义 id;html-subagent-open-schema)')
  {
    // ① 有 html agent → 主 systemPrompt 含委派编排(use_html + 职责边界),集成方零配置
    const sdk1 = createChatSdk({
      ui: false, id: 'e2e-orch-agent', storage: 'memory', llm: FAKE_LLM,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ components: z.array(z.object({ code: z.string() })) }), bind: { components: [] }, description: '测试' },
      subagents: [createHtmlSubagent({ writablePaths: ['components'], formatCheck: false })],
    })
    await sdk1.mount()
    const sp1 = sdk1.inspect().systemPrompt
    assert(sp1.includes('use_html') && sp1.includes('职责边界'), '✓ ① 有 html agent → 自动注入委派编排(含 use_html + 职责边界,集成方零配置)')
    sdk1.unmount()

    // ② 无 html agent + schema 有 code 字段 → 注入降级编排(直接 write / 无 vfs)+ warn
    const sdk2 = createChatSdk({
      ui: false, id: 'e2e-orch-fallback', storage: 'memory', llm: FAKE_LLM,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ components: z.array(z.object({ code: z.string() })) }), bind: { components: [] }, description: '测试' },
    })
    await sdk2.mount()
    const sp2 = sdk2.inspect().systemPrompt
    assert(sp2.includes('直接 write') && sp2.includes('无 vfs'), '✓ ② 无 agent+schema 有 code 字段 → 自动注入降级编排(主 agent 自己写,无 vfs/verify)+ warn')
    assert(!sp2.includes('use_html'), '✓ ② 降级编排不含委派 use_html(无 agent)')
    sdk2.unmount()

    // ③ 无 html agent + 无 code 字段 → 不注入(纯数据应用零干扰)
    const sdk3 = createChatSdk({
      ui: false, id: 'e2e-orch-none', storage: 'memory', llm: FAKE_LLM,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ title: z.string(), list: z.array(z.string()) }), bind: { title: 't', list: [] }, description: '测试' },
    })
    await sdk3.mount()
    const sp3 = sdk3.inspect().systemPrompt
    assert(!sp3.includes('use_html') && !sp3.includes('直接 write'), '✓ ③ 无 agent+无 code 字段 → 不注入编排(纯数据应用零干扰)')
    sdk3.unmount()

    // ④ opt-out(orchestratorPrompt:false)→ 有 agent 但不注入委派(高级用户自定义)
    const sdk4 = createChatSdk({
      ui: false, id: 'e2e-orch-optout', storage: 'memory', llm: FAKE_LLM,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ components: z.array(z.object({ code: z.string() })) }), bind: { components: [] }, description: '测试' },
      subagents: [createHtmlSubagent({ writablePaths: ['components'], formatCheck: false, orchestratorPrompt: false })],
    })
    await sdk4.mount()
    const sp4 = sdk4.inspect().systemPrompt
    assert(!sp4.includes('职责边界'), '✓ ④ orchestratorPrompt:false → 不注入委派编排(opt-out)')
    sdk4.unmount()

    // ⑤ 自定义 id → 委派编排含 use_hero(动态工具名,非 use_html)
    const sdk5 = createChatSdk({
      ui: false, id: 'e2e-orch-id', storage: 'memory', llm: FAKE_LLM,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ components: z.array(z.object({ code: z.string() })) }), bind: { components: [] }, description: '测试' },
      subagents: [createHtmlSubagent({ writablePaths: ['components'], formatCheck: false, id: 'hero' })],
    })
    await sdk5.mount()
    const sp5 = sdk5.inspect().systemPrompt
    assert(sp5.includes('use_hero') && !sp5.includes('use_html'), '✓ ⑤ 自定义 id(hero)→ 委派编排含 use_hero(动态工具名,不误导主 agent 调不存在的工具)')
    sdk5.unmount()
  }

  console.log('[e2e:capability-packs] 无 html agent + 纯代码组件:主 agent 自己 write(降级编排;html-subagent-open-schema)')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    const llm = stubModel(
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0', value: { type: 'custom', name: 'hero', code: '<section class="pg-hero"><h1>啤酒节</h1></section>' } } } }] },
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.1', value: { type: 'banner', title: '干杯' } } } }] },
      { text: '已生成 hero 纯代码 + banner 横幅' },
    )
    const bind = { components: [] }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-orch-noagent', storage: false, llm,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ components: z.array(z.discriminatedUnion('type', [z.object({ type: z.literal('custom'), name: z.string().optional(), code: z.string() }), z.object({ type: z.literal('banner'), title: z.string() })])) }), bind, description: '测试' },
    })
    await sdk.mount()
    const sp = sdk.inspect().systemPrompt
    assert(sp.includes('直接 write') && sp.includes('无 vfs'), '✓ ⑥ 无 agent+schema 有 code 字段 → 注入降级编排(主 agent 自己写,零配置)')
    assert(!sp.includes('use_html'), '✓ ⑥ 无 agent → 不含委派 use_html')
    await sdk.send('生成 hero 纯代码组件 + banner')
    assert(bind.components.length === 2, '✓ ⑥ 无 agent 多组件:主 agent 直接 write 生成 2 个组件(含纯代码 custom + 普通 banner)')
    assert(bind.components[0].code === '<section class="pg-hero"><h1>啤酒节</h1></section>', '✓ ⑥ 纯代码组件 code 由主 agent 直接 write(降级模式,无 vfs/verify)')
    assert(bind.components[1].title === '干杯', '✓ ⑥ 普通组件(banner)同由主 agent write')
    assert(!llm.systemPrompts.some((s) => s.includes('use_html')), '✓ ⑥ 降级模式主 agent 不委派(全程无 use_html 工具,自己 write code)')
    sdk.unmount()
  }

  console.log('[e2e:capability-packs] 无 html agent 复杂多组件操作:建页 + 调序 + 改纯代码 + 移入容器(降级直写,无 vfs/门禁)')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    // schema:普通 navbar/banner + 纯代码 custom + 容器 container(children 一层嵌套叶子组件)
    const navbarS = z.object({ type: z.literal('navbar'), title: z.string() })
    const bannerS = z.object({ type: z.literal('banner'), title: z.string(), color: z.string().optional() })
    const customS = z.object({ type: z.literal('custom'), name: z.string().optional(), code: z.string() })
    const leafS = z.discriminatedUnion('type', [navbarS, bannerS, customS])
    const nodeS = z.discriminatedUnion('type', [navbarS, bannerS, customS, z.object({ type: z.literal('container'), name: z.string().optional(), children: z.array(leafS) })])
    const heroCodeV1 = '<section class="hero"><h1>青岛啤酒节</h1></section>'
    const heroCodeV2 = '<section class="hero"><h1>干杯青岛</h1><p>2026 夏季</p></section>'
    const cdCode = '<div class="countdown">距开幕 3 天</div>'
    const llm = stubModel(
      // ── 轮 1:建复杂页面(4 组件:普通×2 + 纯代码×2,主 agent 逐个 write)──
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0', value: { type: 'navbar', title: '啤酒节导航' } } } }] },
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.1', value: { type: 'banner', title: '干杯', color: '#F7C948' } } } }] },
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.2', value: { type: 'custom', name: 'hero', code: heroCodeV1 } } } }] },
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.3', value: { type: 'custom', name: 'countdown', code: cdCode } } } }] },
      { text: '已建 4 组件(导航 + 横幅 + 2 个纯代码)' },
      // ── 轮 2:复杂改操作(read 刷基线 → patches 原子批:调序 + 改纯代码 code + 倒计时移入容器 + 删原位)──
      { toolCalls: [{ name: 'read', args: { jsonPath: 'components' } }] },
      { toolCalls: [{ name: 'write', args: { patches: [
        { op: 'set', jsonPath: 'components.0', value: { type: 'banner', title: '干杯', color: '#F7C948' } },
        { op: 'set', jsonPath: 'components.1', value: { type: 'navbar', title: '啤酒节导航' } },
        { op: 'set', jsonPath: 'components.2.code', value: heroCodeV2 },
        { op: 'set', jsonPath: 'components.4', value: { type: 'container', name: 'stage', children: [{ type: 'custom', name: 'countdown', code: cdCode }] } },
        { op: 'remove', jsonPath: 'components.3' },
      ] } }] },
      { text: '已调换导航/横幅顺序、更新 hero 代码、倒计时移入 stage 容器' },
    )
    const bind = { components: [] }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-orch-noagent-complex', storage: false, llm,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ components: z.array(nodeS) }), bind, description: '测试' },
    })
    await sdk.mount()
    assert(sdk.inspect().systemPrompt.includes('直接 write'), '✓ ⑧ 无 agent+复杂 schema(含容器嵌套)→ 降级编排仍自动注入')
    assert(!sdk.inspect().tools.some((t) => t.name === 'use_html'), '✓ ⑧ 工具面无 use_html(未配 createHtmlSubagent)')
    // 轮 1:多组件建页(普通 + 纯代码混合)
    await sdk.send('建一个青岛啤酒节页面:导航、横幅、hero 纯代码、倒计时纯代码')
    assert(bind.components.length === 4, `✓ ⑧ 复杂建页:主 agent 逐个 write 落 4 组件(实际 ${bind.components.length})`)
    assert(bind.components[2].code === heroCodeV1 && bind.components[3].code === cdCode, '✓ ⑧ 2 个纯代码组件 code 均由主 agent 直写落地')
    // 轮 2:调序 + 改纯代码 + 层级移动(patches 原子批)
    await sdk.send('导航和横幅调换顺序;hero 标题改成「干杯青岛」并加副标;把倒计时移进一个 stage 容器')
    assert(bind.components.length === 4, `✓ ⑧ 移入容器后顶层仍 4 组件(remove 原位 + append 容器,实际 ${bind.components.length})`)
    assert(bind.components[0].type === 'banner' && bind.components[1].type === 'navbar', '✓ ⑧ 调序成功(navbar↔banner 交换)')
    assert(bind.components[2].code === heroCodeV2, '✓ ⑧ 纯代码组件增量改 code(set components.2.code,无需重传整对象)')
    assert(bind.components[3].type === 'container' && bind.components[3].children?.[0]?.name === 'countdown' && bind.components[3].children[0].code === cdCode, '✓ ⑧ 层级移动:countdown 移入 container.children 且 code 保留')
    assert(!llm.systemPrompts.some((s) => s.includes('use_html')), '✓ ⑧ 复杂场景全程无委派(主 agent 自己完成,无子 agent)')
    assert(bind.components.every((c) => !('__pgId' in c)), '✓ ⑧ 降级模式无 __pgId 注入(codeAsset 中间件未装配,与委派模式差异)')
    sdk.unmount()
  }

  console.log('[e2e:capability-packs] writablePaths 装配期推断(未传 → schema 顶层扫 code 数组回填 / 推断不出 → throw;writablepaths-infer)')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    // ① 正常推断:discriminatedUnion 数组(complex-demo 形态)→ mount 成功 + 委派全链路走通(子 vfs_write → commit 回 bind + __pgId 补齐)
    const llm = stubModel(
      { toolCalls: [{ name: 'use_html', args: { task: '生成 hero 组件' } }] },
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0', value: { type: 'custom', name: 'hero', code: '<section>hero</section>' } } } }] },
      { text: '已生成' },
      { text: '完成' },
    )
    const bind = { components: [] }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-wp-infer-ok', storage: false, llm,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: {
        schema: z.object({
          components: z.array(z.discriminatedUnion('type', [
            z.object({ type: z.literal('banner'), title: z.string() }),
            z.object({ type: z.literal('custom'), name: z.string().optional(), code: z.string() }),
          ])),
        }),
        bind, description: '测试',
      },
      subagents: [createHtmlSubagent({ formatCheck: false })],   // ← 未传 writablePaths
    })
    await sdk.mount()
    assert(sdk.inspect().tools.some((t) => t.name === 'use_html'), '✓ ⑨ 未传 writablePaths + schema 可推断 → mount 成功,use_html 委派工具存在(推断回填生效)')
    assert(sdk.inspect().systemPrompt.includes('use_html'), '✓ ⑨ 推断成功 → 编排注入正常(下游 pgIdPaths/largeTextPaths 拿回填值)')
    await sdk.send('生成 hero 组件')
    assert(bind.components.length === 1 && bind.components[0].name === 'hero' && bind.components[0].code === '<section>hero</section>', '✓ ⑨ 推断路径写权限生效:子 agent write components.0 落 bind(path guard 放行)')
    assert(typeof bind.components[0].__pgId === 'string' && bind.components[0].__pgId, '✓ ⑨ __pgId 注入链生效(afterWrite 补 id,推断路径进了 pgIdPaths)')
    sdk.unmount()
    // ② 推断不出(无 code 字段 schema)→ throw 含提示
    {
      let threw = false
      try {
        createChatSdk({
          ui: false, id: 'e2e-wp-infer-fail', storage: 'memory', llm: FAKE_LLM,
          capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
          data: { schema: z.object({ title: z.string() }), bind: { title: 'x' }, description: '测试' },
          subagents: [createHtmlSubagent({ formatCheck: false })],
        })
      } catch (e) {
        threw = true
        assert(String(e).includes('writablePaths'), '✓ ⑨ 推断不出 → throw 错误信息含 writablePaths 用法提示')
      }
      assert(threw, '✓ ⑨ 未传 + 无 code schema → 装配 throw(宁失败不静默)')
    }
  }

  console.log('[e2e:capability-packs] 有 html agent 但 orchestratorPrompt:false(不注入委派编排;opt-out)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-orch-optout-full', storage: 'memory', llm: FAKE_LLM,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ components: z.array(z.object({ code: z.string() })) }), bind: { components: [] }, description: '测试' },
      subagents: [createHtmlSubagent({ writablePaths: ['components'], formatCheck: false, orchestratorPrompt: false })],
    })
    await sdk.mount()
    const sp = sdk.inspect().systemPrompt
    assert(!sp.includes('职责边界'), '✓ ⑦ orchestratorPrompt:false → 不注入委派编排(集成方自定义编排)')
    assert(!sp.includes('逐个委派'), '✓ ⑦ opt-out → 不含编排规则段')
    assert(sdk.inspect().tools.some((t) => t.name === 'use_html'), '✓ ⑦ opt-out 仅关编排注入,use_html 委派工具仍可用(子 agent 装配不受影响)')
    sdk.unmount()
  }

  console.log('[e2e:capability-packs] 多组件逐个委派(每组件独立子 agent,全新上下文防共享污染)')
  {
    const { stubModel } = await import('./_stub-model.mjs')
    // 场景:用户「生成2个组件:轮播 + 活动特效,世界杯主题」
    // 主 agent 逐个委派(每组件一次 use_html → 独立子 agent,全新上下文,防 class/样式冲突污染)
    const llm = stubModel(
      // [0] 主:委派 use_html #1(轮播)
      { toolCalls: [{ name: 'use_html', args: { task: '生成轮播组件,世界杯主题' } }] },
      // [1] 子#1:write components.0(轮播)—— 独立子 agent,只写这一个
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.0', value: { type: 'custom', name: 'carousel', code: '<section class="wc-carousel"><h3>世界杯轮播</h3></section>' } } } }] },
      // [2] 子#1:text 收口
      { text: '已生成轮播' },
      // [3] 主:委派 use_html #2(活动特效)—— 第二个独立子 agent,全新上下文(不知轮播的 code)
      { toolCalls: [{ name: 'use_html', args: { task: '生成活动特效组件,世界杯主题,进球动效' } }] },
      // [4] 子#2:write components.1(活动特效)
      { toolCalls: [{ name: 'write', args: { patch: { op: 'set', jsonPath: 'components.1', value: { type: 'custom', name: 'effect', code: '<section class="wc-effect"><h3>进球特效</h3></section>' } } } }] },
      // [5] 子#2:text 收口
      { text: '已生成特效' },
      // [6] 主:text 收口
      { text: '已完成 2 个组件(轮播 carousel + 活动特效 effect)' },
    )
    const bind = { title: 't', components: [] }
    const sdk = createChatSdk({
      ui: false, id: 'e2e-cap-multi', storage: false, llm,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ title: z.string(), components: z.array(z.object({ type: z.string(), name: z.string().optional(), code: z.string().optional() })) }), bind, description: '测试' },
      subagents: [createHtmlSubagent({ writablePaths: ['components'], formatCheck: false })],
    })
    await sdk.mount()
    const reply = await sdk.send('生成2个组件:轮播 + 活动特效,世界杯主题')
    // ① 两个组件都生成(各自独立子 agent 委派)
    assert(bind.components.length === 2, `✓ 逐个委派:两个组件都追加进 components(实际 ${bind.components.length} 个)`)
    assert(bind.components[0]?.name === 'carousel' && bind.components[1]?.name === 'effect', '✓ 两个组件名称正确(carousel + effect)')
    // ② 两组件 code + __pgId(唯一)
    assert(typeof bind.components[0]?.code === 'string' && bind.components[0].code.includes('世界杯轮播'), '✓ 组件 0(carousel)code 落地')
    assert(typeof bind.components[1]?.code === 'string' && bind.components[1].code.includes('进球特效'), '✓ 组件 1(effect)code 落地')
    assert(typeof bind.components[0]?.__pgId === 'string' && typeof bind.components[1]?.__pgId === 'string' && bind.components[0].__pgId !== bind.components[1].__pgId, '✓ 两组件 __pgId 唯一注入')
    // ③ 逐个委派 = 2 个独立子 agent(观察层 history 记录每次 spawn)
    assert(sdk.inspect().subagent.history.length === 2, `✓ 逐个委派:2 个独立子 agent(各全新上下文,防共享污染;history ${sdk.inspect().subagent.history.length})`)
    // ④ 完整流程 7 次 model 调用(主委派1→子写1→子收口→主委派2→子写2→子收口→主收口)
    assert(/完成/.test(reply), '✓ 主流程收口')
    assert(llm.calls === 7, `✓ 完整流程 7 次 model 调用(实际 ${llm.calls})`)
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
