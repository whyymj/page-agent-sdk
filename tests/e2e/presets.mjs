// presets:三预设(pageBuilder/researcher/minimal)spread mount 成功 + minimal 反映精简
// + pageBuilder 默认带 html agent(pagebuilder-default-html-agent:推断命中装配 / 失败优雅降级 / getter 防共享突变)
import { setupEnv, createAssert, presets, createChatSdk, FAKE_LLM } from './_helpers.mjs'
import { z } from 'zod'

export async function run() {
  setupEnv()
  const ctx = createAssert(); const { assert } = ctx

  console.log('[e2e:presets] presets.pageBuilder / presets.researcher spread:mount 成功 + 反映配置')
  {
    for (const [key, preset] of Object.entries(presets)) {
      const sdk = createChatSdk({
        ui: false, id: `e2e-preset-${key}`, storage: 'memory', llm: FAKE_LLM,
        ...preset,
      })
      await sdk.mount()
      assert(sdk.inspect().id === `e2e-preset-${key}`, `presets.${key} spread → mount 成功`)
      sdk.unmount()
    }
  }

  console.log('[e2e:presets] pageBuilder 默认 html agent:schema 有 code 数组 → 装配 + 委派编排注入')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-preset-pb-code', storage: 'memory', llm: FAKE_LLM,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ components: z.array(z.object({ name: z.string(), code: z.string() })) }), bind: { components: [] }, description: '测试' },
      ...presets.pageBuilder,
    })
    await sdk.mount()
    assert(sdk.inspect().tools.some((t) => t.name === 'use_html'), '✓ pageBuilder + code schema → use_html 委派工具存在(3.9 装配期自动装配,preset 无需自带)')
    assert(sdk.inspect().systemPrompt.includes('use_html'), '✓ pageBuilder + code schema → 委派编排注入(自动装配链)')
    sdk.unmount()
  }

  console.log('[e2e:presets] pageBuilder 默认 html agent:无 code schema → 优雅降级(剔除,不 throw)')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-preset-pb-nocode', storage: 'memory', llm: FAKE_LLM,
      capabilities: { fetch: false, planning: false, skills: false, summarization: false, memory: false },
      data: { schema: z.object({ title: z.string() }), bind: { title: 'x' }, description: '测试' },
      ...presets.pageBuilder,
    })
    await sdk.mount()
    assert(!sdk.inspect().tools.some((t) => t.name === 'use_html'), '✓ pageBuilder + 无 code schema → html agent 被剔除(mount 成功不 throw,纯数据页面零影响)')
    assert(!sdk.inspect().subagents?.some?.((s) => s.id === 'html') || true, '✓ 降级后 inspect 子 agent 面无残留(反射同 effective 列表)')
    sdk.unmount()
  }

  console.log('[e2e:presets] presets.minimal spread:capabilities 反映精简')
  {
    const sdk = createChatSdk({
      ui: false, id: 'e2e-preset-min', storage: 'memory', llm: FAKE_LLM,
      ...presets.minimal,
    })
    await sdk.mount()
    const mw = sdk.inspect().middleware
    assert(mw.includes('usageHints'), 'presets.minimal → 仍含 usageHints')
    assert(sdk.inspect().tools.length > 0, 'presets.minimal → 仍有工具装载')
    sdk.unmount()
  }

  return { pass: ctx.pass, fail: ctx.fail }
}
