// 能力包(createRagSubagent / createHtmlSubagent 专用子 agent)+ 子 agent 架构扩展(allowedTools/middleware/summarization/vfsWrite)
import { setupEnv, createAssert, FAKE_LLM, createChatSdk } from './_helpers.mjs'
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
    // vfsWrite 不暴露 vfsStore;写入逻辑 = files[normalize(path)] = {content, updatedAt}(同 vfs_write,语义经 vfs_write 工具覆盖)
    sdk.unmount()
  }

  console.log('[e2e:capability-packs] 两 skill 文件 + npm files')
  {
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const root = resolve(__dirname, '../..')
    const ragSkill = resolve(root, 'skills/rag-search/SKILL.md')
    const htmlSkill = resolve(root, 'skills/html-builder/SKILL.md')
    assert(existsSync(ragSkill), 'skills/rag-search/SKILL.md 存在')
    assert(existsSync(htmlSkill), 'skills/html-builder/SKILL.md 存在')
    if (existsSync(ragSkill)) {
      assert(readFileSync(ragSkill, 'utf8').includes('name: rag-search'), 'rag-search SKILL.md frontmatter name')
    }
    if (existsSync(htmlSkill)) {
      const c = readFileSync(htmlSkill, 'utf8')
      assert(c.includes('name: html-builder'), 'html-builder SKILL.md frontmatter name')
      assert(c.includes('codeRef'), 'html-builder SKILL.md 含 codeRef 存储约定')
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

  return { pass: ctx.pass, fail: ctx.fail }
}
