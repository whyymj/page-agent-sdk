import { createSubagentMiddleware, buildChildTools, isReservedFrameworkTool, wrapWithPathGuard } from '../../harness/subagent';
import { createInitialState as createState } from '../../harness/state'

// tsx 运行时由 node 提供 process;tsc 静态检查无 @types/node,显式声明其类型
import type { TestCtx } from './_ctx'

// subagent(子 agent 中间件结构 + wrapToolCall)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx;
  console.log('\n[subagent]')
  {
    const mw = createSubagentMiddleware({ llm: { apiKey: 'test' }, allTools: [] })
    assert(mw.name === 'subagent', 'subagent: 中间件 name=subagent')
    assert((mw.tools?.length ?? 0) === 2, 'subagent: 贡献 spawn_agent + spawn_agents 两个工具')
    const names = (mw.tools || []).map((t: any) => t.name)
    assert(names.includes('spawn_agent') && names.includes('spawn_agents'), 'subagent: 工具名为 spawn_agent / spawn_agents')
    assert(typeof mw.wrapToolCall === 'function', 'subagent: 有 wrapToolCall(捕获主 signal 供子 agent 继承)')

    // wrapToolCall 透传 next(不阻塞工具执行,且捕获 signal 不影响正常调用)
    const probe = { v: false }
    await mw.wrapToolCall!({ id: '1', name: 'x', args: {}, state: createState() }, async () => {
      probe.v = true
      return { content: 'ok', status: 'done' as const }
    })
    assert(probe.v, 'subagent: wrapToolCall 透传 next(不阻塞工具执行)')
  }

  // ===== fix-authorization-surface:装配期源头 filter(buildChildTools / isReservedFrameworkTool)=====
  {
    console.log('\n[subagent · 授权面装配期 filter(P0-1/Q1)]')
    const fake = (name: string): any => ({ name, invoke: async () => `invoked:${name}` })
    // 模拟 agent 合并池:数据工具 + vfs 中间件工具 + 框架/委派工具
    const pool = [
      fake('read'), fake('query_data'), fake('vfs_write'), fake('vfs_grep'), fake('vfs_read'),
      fake('spawn_agent'), fake('spawn_agents'), fake('use_html'), fake('use_rag'),
      fake('load_skill'), fake('write_todos'), fake('update_todo'), fake('restore_last_checkpoint'),
      fake('request_human_confirmation'), fake('set_focus'), fake('clear_focus'), fake('my_custom_tool'),
    ]

    // P0-1:能力包 allowedTools(vfs 中间件工具)可从合并池解析(原局部池恒落空)
    const htmlAllow = new Set(['read', 'vfs_write', 'vfs_edit', 'vfs_rm', 'vfs_grep', 'vfs_read'])
    const htmlTools = buildChildTools(pool, htmlAllow).map((t: any) => t.name)
    assert(htmlTools.includes('vfs_write') && htmlTools.includes('vfs_grep') && htmlTools.includes('vfs_read'), '✓ P0-1 html 能力包 allowedTools → vfs 中间件工具可解析')
    assert(htmlTools.includes('read'), '✓ P0-1 allowedTools 含默认数据工具照常解析')

    // Q1:即使白名单显式含框架/保留工具,装配期一律排除(防 spawn 自授激活 depth 链)
    const evilAllow = new Set(['read', 'spawn_agent', 'use_html', 'use_rag', 'load_skill', 'write_todos', 'restore_last_checkpoint', 'request_human_confirmation', 'set_focus'])
    const evilTools = buildChildTools(pool, evilAllow).map((t: any) => t.name)
    assert(evilTools.includes('read'), '✓ Q1 白名单合法工具保留')
    assert(!evilTools.some((n: string) => n === 'spawn_agent' || n === 'use_html' || n === 'load_skill' || n === 'write_todos' || n === 'restore_last_checkpoint' || n === 'request_human_confirmation' || n === 'set_focus'), '✓ Q1 框架/保留工具白名单显式授予也被装配期排除')

    // isReservedFrameworkTool:use_* 保留前缀 + 具名清单
    assert(isReservedFrameworkTool('use_html') && isReservedFrameworkTool('use_anything'), '✓ isReservedFrameworkTool use_* 保留前缀')
    assert(isReservedFrameworkTool('spawn_agent') && isReservedFrameworkTool('load_skill') && isReservedFrameworkTool('update_todo'), '✓ isReservedFrameworkTool 具名清单')
    assert(!isReservedFrameworkTool('read') && !isReservedFrameworkTool('vfs_write') && !isReservedFrameworkTool('my_custom_tool'), '✓ isReservedFrameworkTool 普通工具不误伤')

    // extraTools(集成方显式)不过滤
    const extra = buildChildTools(pool, new Set(['read']), [fake('use_custom_explicit') as any]).map((t: any) => t.name)
    assert(extra.includes('use_custom_explicit'), '✓ extraTools 集成方显式注入不经 filter')
  }

  // ===== fix-authorization-surface P1-18:wrapWithPathGuard 补 patches 无 jsonPath 项 =====
  {
    console.log('\n[subagent · writablePaths guard(P1-18)]')
    const fakeWrite: any = { name: 'write', invoke: async () => 'invoked:write' }
    const guarded = wrapWithPathGuard(fakeWrite, ['components'])
    // 混合批量:一项合法 + 一项无 jsonPath(作用于根)→ 拒绝(原:收集到的合法即整体放行)
    const mixed = await guarded.invoke({ patches: [{ op: 'set', jsonPath: 'components.0.x', value: 1 }, { op: 'merge', value: { hacked: true } }] })
    assert(typeof mixed === 'string' && mixed.includes('PATH_OUT_OF_SCOPE'), '✓ P1-18 patches 含无 jsonPath 项(根写)→ PATH_OUT_OF_SCOPE')
    // 全部带合法 jsonPath → 放行到原工具
    const okBatch = await guarded.invoke({ patches: [{ op: 'set', jsonPath: 'components.0.x', value: 1 }, { op: 'set', jsonPath: 'components.1.y', value: 2 }] })
    assert(okBatch === 'invoked:write', '✓ P1-18 patches 全带合法 jsonPath → 放行')
    // patches 项为 null/非对象 也拒
    const nullItem = await guarded.invoke({ patches: [{ op: 'set', jsonPath: 'components.0.x' }, null] })
    assert(typeof nullItem === 'string' && nullItem.includes('PATH_OUT_OF_SCOPE'), '✓ P1-18 patches 含 null 项 → 拒绝')
    // 既有语义不变:无 jsonPath 整体写 → 拒(不能整体替换)
    const wholeSet = await guarded.invoke({ value: { a: 1 } })
    assert(typeof wholeSet === 'string' && wholeSet.includes('PATH_OUT_OF_SCOPE'), '✓ writablePaths 整体 set(无 jsonPath)→ 拒绝(既有语义)')
    // 既有语义不变:越界路径 → 拒
    const out = await guarded.invoke({ patch: { op: 'set', jsonPath: 'page.title', value: 'x' } })
    assert(typeof out === 'string' && out.includes('越界'), '✓ writablePaths 越界路径 → 拒绝(既有语义)')
  }
}
