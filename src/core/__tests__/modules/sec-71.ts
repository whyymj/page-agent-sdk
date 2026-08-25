/**
 * sec-71:fix-data-integrity(会话生命周期完整性 + 白名单深投影 + 压缩/渲染性能)单元层
 * - P1-19 深投影统一:read 整体/read jsonPaths 根/query/search/diff 六路隐藏嵌套未声明字段;子路径口径一致
 * - P1-25 压缩 LLM 摘要异步化:首压零阻塞返索引模板 + 后台完成 → 前缀缓存命中 + 尾部增量拼接 + 失败回退
 * - P1-26 markdown:markedToHtml hljs 尺寸闸(巨代码块转义直出,小块正常高亮)
 */
import { z } from 'zod'
import { createDataOps } from '../../tools/dataOps'
import { projectBySchemaDeep } from '../../tools/schemaUtils'
import { useContextManager } from '../../composables/useContextManager'
import { markedToHtml, HLJS_BLOCK_MAX_CHARS } from '../../composables/useMarkdown'
import type { AgentMessage } from '../../types'
import type { TestCtx } from './_ctx'

const SECRET = 'SECRET-KEY-123'
const HIDDEN_ITEM = 'HIDDEN-A'
const ROOT_HIDDEN = 'ROOT-HIDDEN'

/** 嵌套 schema:config/items 内各有未声明深层字段(bind 里存在,schema 未声明) */
function makeDeepOps(bind: Record<string, unknown>) {
  return createDataOps({
    schema: z.object({
      title: z.string(),
      config: z.object({ theme: z.string() }),
      items: z.array(z.object({ name: z.string() })),
    }),
    bind,
    description: '深投影测试数据',
  })
}

function makeDeepBind(): Record<string, unknown> {
  return {
    title: 'T',
    config: { theme: 'dark', apiKey: SECRET },
    items: [{ name: 'a', _internal: HIDDEN_ITEM }],
    _rootHidden: ROOT_HIDDEN,
  }
}

/** 断言文本不含任何隐藏字段(深投影生效) */
function leaked(out: string): boolean {
  return out.includes(SECRET) || out.includes(HIDDEN_ITEM) || out.includes(ROOT_HIDDEN)
}

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  console.log('\n[fix-data-integrity:深投影统一 / 压缩异步 / markdown 尺寸闸]')

  // ===== P1-19:深投影统一(7 路根级读) =====
  {
    const bind = makeDeepBind()
    const tools = makeDeepOps(bind)
    const t = byName(tools)

    // 1. read 整体
    const r1 = await invoke(t['read'], {})
    assert(!leaked(r1) && r1.includes('"theme"') && r1.includes('"dark"'), '✓ P1-19 read 整体深投影:嵌套未声明字段隐藏(config.apiKey/items.*._internal/_rootHidden),声明字段保留')
    // 2. read jsonPaths 根项(多路径模式的根分支)
    const r3 = await invoke(t['read'], { jsonPaths: [''] })
    assert(!leaked(r3), '✓ P1-19 read jsonPaths 根项深投影:嵌套未声明字段隐藏')
    // 3. query_data(查询目标深投影)
    const r4 = await invoke(t['query_data'], { expr: '$.config' })
    assert(!leaked(r4) && r4.includes('dark'), '✓ P1-19 query_data 目标深投影:config.apiKey 不出现在查询结果')
    // 4. search_data(搜索目标深投影 → 搜不到隐藏字段值)
    const r5 = await invoke(t['search_data'], { query: SECRET })
    assert(!leaked(r5) && /"matched":0/.test(r5), '✓ P1-19 search_data 目标深投影:隐藏字段值搜不到(matched=0)')
    // 5. diff_data(当前值侧深投影:against=投影副本 → 无差异;隐藏字段不进 diff)
    const r6 = await invoke(t['diff_data'], { against: { title: 'T', config: { theme: 'dark' }, items: [{ name: 'a' }] } })
    assert(!leaked(r6) && /无差异/.test(r6), '✓ P1-19 diff_data 当前侧深投影:与投影副本无差异(bind 隐藏字段不参与对比)')
    // 6. eval_script 根入参投影(node 无 Worker 不实跑;eval 根 source = projectBySchemaDeep(bindRef, schema),经纯函数断言同口径)
    const schemaForEval = z.object({
      title: z.string(),
      config: z.object({ theme: z.string() }),
      items: z.array(z.object({ name: z.string() })),
    })
    const evalSource = projectBySchemaDeep(makeDeepBind(), schemaForEval) as any
    assert(evalSource.config.apiKey === undefined && evalSource.items[0]._internal === undefined && evalSource._rootHidden === undefined && evalSource.config.theme === 'dark', '✓ P1-19 eval 根入参同口径(projectBySchemaDeep):未声明深层字段剥离,声明字段保留')

    // 子路径读口径一致(回归守卫:修复前子路径已是深投影)
    const r8 = await invoke(t['read'], { jsonPath: 'config' })
    assert(!leaked(r8) && r8.includes('dark'), '✓ P1-19 子路径读口径与整体一致(config 深投影不泄露 apiKey)')
    // 顶层未声明 key 仍隐藏(浅投影原有能力不回归)
    assert(!r1.includes(ROOT_HIDDEN), '✓ P1-19 顶层未声明 key 仍隐藏(深投影包含浅投影能力)')
  }

  // ===== P1-25:压缩 LLM 摘要异步化(模板先行 + 前缀缓存) =====
  {
    const mk = (role: 'user' | 'assistant', content: string): AgentMessage => ({ role, content, timestamp: Date.now() })
    // 5 轮对话(windowRounds=2 + summaryThresholdRounds=3 → rounds 5 > 3 触发;older=前 3 轮)
    const mkRounds = (n: number): AgentMessage[] => {
      const msgs: AgentMessage[] = []
      for (let i = 1; i <= n; i++) {
        msgs.push(mk('user', `问题${i} 关于字段配置`), mk('assistant', `回答${i} 已处理`))
      }
      return msgs
    }

    // —— 场景 A:首压零阻塞(后台 LLM 挂起不 await)+ 完成后缓存命中 ——
    let resolveLlm: ((v: string) => void) | null = null
    let llmCalls = 0
    const mgr = useContextManager({
      windowRounds: 2,
      summaryThresholdRounds: 3,
      enableLLMSummary: true,
      enableRecall: false,
      llmInvoke: () => {
        llmCalls++
        return new Promise<string>((res) => { resolveLlm = res })
      },
    })
    const msgs = mkRounds(5)
    const t0 = Date.now()
    const r1 = await mgr.compress(msgs)
    assert(Date.now() - t0 < 500 && r1.stats.triggered, '✓ P1-25 首压不被后台 LLM 阻塞(挂起的 llmInvoke 不 await,同步返回)')
    assert(r1.stats.strategy.includes('index_summary(llm_background)'), `✓ P1-25 首压策略=索引模板+后台 LLM(实际:${r1.stats.strategy})`)
    assert(r1.messages[0].content.includes('第1轮'), '✓ P1-25 首压摘要为索引模板(含轮次行)')
    assert(llmCalls === 1, '✓ P1-25 首压 fire 一次后台 LLM')

    // 后台完成前重压同参:不重复 fire(llmInFlight 守卫),仍用模板
    const r1b = await mgr.compress(msgs)
    assert(llmCalls === 1 && r1b.stats.strategy.includes('llm_background'), '✓ P1-25 后台在途时重压不重复 fire(llmInFlight 守卫)')

    resolveLlm!('【LLM 摘要】前 3 轮综合要点')
    await new Promise((r) => setTimeout(r, 10))  // 等 then 落缓存

    const r2 = await mgr.compress(msgs)
    assert(r2.stats.strategy.includes('llm_summary(cached)') && r2.messages[0].content.includes('【LLM 摘要】前 3 轮综合要点'), '✓ P1-25 后台完成后同参重压:缓存命中(全覆盖)')
    assert(llmCalls === 1, '✓ P1-25 缓存命中不再 fire')

    // —— 场景 B:older 扩 1 轮 → 前缀拼接(LLM 前缀 + 新增尾部索引)+ fire 全量 ——
    const msgs6 = mkRounds(6)
    const r3 = await mgr.compress(msgs6)
    assert(r3.stats.strategy.includes('llm_summary(prefix)+index_tail'), `✓ P1-25 older 扩展 → 前缀拼接策略(实际:${r3.stats.strategy})`)
    assert(r3.messages[0].content.includes('【LLM 摘要】前 3 轮综合要点') && r3.messages[0].content.includes('第4轮'), '✓ P1-25 前缀拼接:LLM 前缀 + 新增轮索引尾部(第4轮)')
    assert(llmCalls === 2, '✓ P1-25 前缀拼接同时 fire 全量后台 LLM(更新缓存)')
    resolveLlm!('【LLM 摘要】前 4 轮综合要点')
    await new Promise((r) => setTimeout(r, 10))
    const r4 = await mgr.compress(msgs6)
    assert(r4.stats.strategy.includes('cached') && r4.messages[0].content.includes('前 4 轮'), '✓ P1-25 全量缓存更新后命中(coveredCount 单调前进)')

    // —— 场景 C:llmInvoke 失败 → 回退模板,缓存不污染,下次可重试 ——
    let rejectNext = true
    const mgrFail = useContextManager({
      windowRounds: 2,
      summaryThresholdRounds: 3,
      enableLLMSummary: true,
      enableRecall: false,
      llmInvoke: () => (rejectNext ? Promise.reject(new Error('llm down')) : Promise.resolve('OK-SUMMARY')),
    })
    const f1 = await mgrFail.compress(mkRounds(5))
    assert(f1.stats.strategy.includes('llm_background'), '✓ P1-25 失败场景首压仍返索引模板(不抛错)')
    await new Promise((r) => setTimeout(r, 10))
    rejectNext = false
    const f2 = await mgrFail.compress(mkRounds(5))
    assert(f2.stats.strategy.includes('llm_background'), '✓ P1-25 失败不污染缓存(下次触发重新 fire)')
    await new Promise((r) => setTimeout(r, 10))
    const f3 = await mgrFail.compress(mkRounds(5))
    assert(f3.stats.strategy.includes('cached') && f3.messages[0].content.includes('OK-SUMMARY'), '✓ P1-25 重试成功后缓存生效')
  }

  // ===== P1-26:markedToHtml hljs 尺寸闸 =====
  {
    const small = markedToHtml('```js\nconst a = 1\n```')
    assert(small.includes('class="hljs-') && small.includes('code-block'), '✓ P1-26 小代码块正常 hljs 高亮(含 hljs- span)')
    const bigCode = 'var x = 1;\n'.repeat(Math.ceil((HLJS_BLOCK_MAX_CHARS + 100) / 11))
    const big = markedToHtml('```js\n' + bigCode + '```')
    assert(!big.includes('class="hljs-') && big.includes('code-block') && big.includes('var x = 1;'), '✓ P1-26 巨代码块(>阈值)跳过 hljs 转义直出(无 hljs- span,内容保留)')
    assert(markedToHtml('') === '', '✓ P1-26 空内容返空')
  }
}
