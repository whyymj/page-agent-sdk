import { constructLlmFromConfig, constructOpenLlmSync } from '../../llm/constructLlm'
import { extractTextDelta, extractReasoningDelta, extractUsage, normalizeUsage } from '../../utils/contentParts'
import { createAgent } from '../../harness/createAgent'
import { createSubagentMiddleware } from '../../harness/subagent'
import { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { AIMessage, AIMessageChunk } from '@langchain/core/messages'
import type { TestCtx } from './_ctx'

// LLM 构造工厂 constructLlm(Anthropic 开箱:provider 抽离,openai 同步 / anthropic 动态 import)
export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx
  console.log('\n[LLM 构造工厂 constructLlm · provider 抽离]')
  {
    // constructOpenLlmSync:同步构造 OpenAI 协议 LLM(供 setLlm 等同步契约场景)
    const llm = constructOpenLlmSync({ apiKey: 'sk-test', model: 'gpt-4' })
    assert(!!llm && typeof (llm as any).invoke === 'function', 'constructOpenLlmSync → OpenAI 实例(invoke 可用)')
    const name = (llm as any).constructor?.name || ''
    assert(name.includes('OpenAI'), 'constructOpenLlmSync → ChatOpenAI 实例(constructor 含 OpenAI)')
  }
  {
    // constructLlmFromConfig 显式 provider:'openai' → async 返回 ChatOpenAI 实例
    const llm = await constructLlmFromConfig({ provider: 'openai', apiKey: 'sk-test', model: 'gpt-4' })
    const name = (llm as any).constructor?.name || ''
    assert(name.includes('OpenAI'), 'constructLlmFromConfig provider:openai → ChatOpenAI 实例')
  }
  {
    // constructLlmFromConfig 缺省 provider(undefined)→ openai 分支(向后兼容,非 Anthropic)
    const llm = await constructLlmFromConfig({ apiKey: 'sk-test', model: 'gpt-4' })
    const name = (llm as any).constructor?.name || ''
    assert(name.includes('OpenAI') && !name.includes('Anthropic'), 'constructLlmFromConfig 缺省 provider → openai 分支(向后兼容)')
  }
  {
    // constructLlmFromConfig provider:'anthropic' → 动态 import → ChatAnthropic 实例(仅实例化,不调真实 API)
    const llm = await constructLlmFromConfig({
      provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-3-5-sonnet-20241022', baseUrl: 'https://api.anthropic.com',
    })
    const name = (llm as any).constructor?.name || ''
    assert(name.includes('Anthropic'), 'constructLlmFromConfig provider:anthropic → ChatAnthropic 实例(动态 import)')
    // baseUrl → anthropicApiUrl 透传(实例属性或 lc_kwargs)
    const apiUrl = (llm as any).anthropicApiUrl || (llm as any).lc_kwargs?.anthropicApiUrl
    assert(!!apiUrl, 'constructLlmFromConfig anthropic baseUrl → anthropicApiUrl 透传')
  }
  {
    // constructLlmFromConfig anthropic 传 extraConfig → clientOptions 透传(构造不抛错)
    const llm = await constructLlmFromConfig({
      provider: 'anthropic', apiKey: 'sk-ant', model: 'claude-3-5-sonnet', extraConfig: { headers: { 'X-Test': '1' } },
    })
    assert(!!llm && typeof (llm as any).invoke === 'function', 'constructLlmFromConfig anthropic extraConfig → clientOptions 透传不抛错')
  }
  {
    // prompt caching(llm.cacheControl):经 invocationKwargs 透传顶层 cache_control(构造器顶层字段在
    // @langchain/anthropic 1.5.4 不进请求体,实测只消费调用时 options;invocationKwargs 直接展开进 body)
    const on = await constructLlmFromConfig({ provider: 'anthropic', apiKey: 'sk-ant', model: 'claude-3-5-sonnet', cacheControl: true })
    const kwOn = (on as any).lc_kwargs || {}
    assert(kwOn.invocationKwargs?.cache_control?.type === 'ephemeral', 'cacheControl:true → invocationKwargs.cache_control {type:ephemeral}(服务端自动断点推进)')
    assert(kwOn.invocationKwargs?.cache_control?.ttl === undefined, 'cacheControl:true → 缺省不显式传 ttl(5m 默认)')
    const h1 = await constructLlmFromConfig({ provider: 'anthropic', apiKey: 'sk-ant', model: 'claude-3-5-sonnet', cacheControl: '1h' })
    assert((h1 as any).lc_kwargs?.invocationKwargs?.cache_control?.ttl === '1h', "cacheControl:'1h' → ttl 透传(长 TTL 缓存)")
    const off = await constructLlmFromConfig({ provider: 'anthropic', apiKey: 'sk-ant', model: 'claude-3-5-sonnet' })
    assert((off as any).lc_kwargs?.invocationKwargs === undefined, '未传 cacheControl → 不打缓存断点(默认行为零变化)')
  }
  {
    // ConstructOpts 覆盖 temperature/maxTokens(summary/title 用不同值,覆盖 LLMConfig)
    const llm = constructOpenLlmSync({ apiKey: 'sk', model: 'gpt-4', temperature: 0.7 }, { temperature: 0, maxTokens: 30 })
    const kw = (llm as any).lc_kwargs || {}
    assert(kw.temperature === 0, 'ConstructOpts.temperature 覆盖 LLMConfig.temperature(0.7 → 0)')
    assert(kw.maxTokens === 30, 'ConstructOpts.maxTokens 覆盖(缺省 LLMConfig.maxTokens → 30)')
  }
  {
    // constructOpenLlmSync extraBody → modelKwargs 透传(DeepSeek thinking 等)
    const llm = constructOpenLlmSync({ apiKey: 'sk', model: 'deepseek', extraBody: { thinking: { type: 'enabled' } } })
    const kw = (llm as any).lc_kwargs || {}
    assert(!!kw.modelKwargs && kw.modelKwargs.thinking?.type === 'enabled', 'constructOpenLlmSync extraBody → modelKwargs 透传')
  }
  console.log('\n[streaming provider 兼容 · contentParts 纯函数]')
  {
    // extractTextDelta:兼容 string(OpenAI/DeepSeek)+ parts 数组(Anthropic)
    assert(extractTextDelta({ content: 'hello' } as any) === 'hello', 'extractTextDelta string content → 原样返回(OpenAI/DeepSeek)')
    assert(extractTextDelta({ content: [{ type: 'text', text: 'hi' }, { type: 'text', text: '!' }] } as any) === 'hi!', 'extractTextDelta parts 数组 → 拼 text(Anthropic)')
    assert(extractTextDelta({ content: [{ type: 'thinking', thinking: '内部思考' }] } as any) === '', 'extractTextDelta parts 含 thinking → 跳过(只取 text)')
    assert(extractTextDelta({ content: [{ type: 'text', text: 'a' }, { type: 'tool_use', name: 'x' }] } as any) === 'a', 'extractTextDelta parts 含 tool_use → 跳过非 text')
    assert(extractTextDelta({ content: 123 } as any) === '', 'extractTextDelta 非字符串/数组 → 空(兜底)')
  }
  {
    // extractReasoningDelta:兼容 additional_kwargs(DeepSeek)+ thinking parts(Anthropic)
    assert(extractReasoningDelta({ additional_kwargs: { reasoning_content: 'r1' } } as any) === 'r1', 'extractReasoningDelta additional_kwargs.reasoning_content(DeepSeek)')
    assert(extractReasoningDelta({ additional_kwargs: { reasoning: 'r2' } } as any) === 'r2', 'extractReasoningDelta additional_kwargs.reasoning(兼容)')
    assert(extractReasoningDelta({ content: [{ type: 'thinking', thinking: 'th1' }] } as any) === 'th1', 'extractReasoningDelta thinking parts(Anthropic)')
    assert(extractReasoningDelta({ content: [{ type: 'thinking_delta', delta: 'th2' }] } as any) === 'th2', 'extractReasoningDelta thinking_delta parts(Anthropic 流式)')
    assert(extractReasoningDelta({ content: '纯文本无推理' } as any) === '', 'extractReasoningDelta 无推理 → 空')
  }
  {
    // extractUsage:兼容 additional_kwargs(OpenAI/DeepSeek)+ response_metadata(Anthropic)
    assert(extractUsage({ additional_kwargs: { usage: { total_tokens: 10 } } } as any)?.total_tokens === 10, 'extractUsage additional_kwargs.usage(OpenAI/DeepSeek)')
    assert(extractUsage({ response_metadata: { usage: { total_tokens: 20 } } } as any)?.total_tokens === 20, 'extractUsage response_metadata.usage(Anthropic)')
    assert(extractUsage({ response_metadata: { token_usage: { total_tokens: 30 } } } as any)?.total_tokens === 30, 'extractUsage response_metadata.token_usage(兼容)')
    // usage_metadata(Anthropic 流式聚合后的 langchain 标准字段,input/output_tokens 命名;rag-demo 真 LLM 实测 usage 全 null 驱动)
    assert(extractUsage({ usage_metadata: { input_tokens: 100, output_tokens: 40, total_tokens: 140 } } as any)?.input_tokens === 100, 'extractUsage usage_metadata(Anthropic 流式聚合)')
    // 网关实测形态:response_metadata.usage 为空对象 {}(非 nullish,?? 链会短路)→ 必须跳过空候选落到 usage_metadata
    assert(extractUsage({ response_metadata: { usage: {}, model_provider: 'anthropic' }, usage_metadata: { input_tokens: 2, output_tokens: 33, total_tokens: 35 } } as any)?.input_tokens === 2,
      'extractUsage 空对象 response_metadata.usage 不短路 → 落到 usage_metadata(rag-demo 真 LLM 实测回归)')
    assert(extractUsage({ response_metadata: { usage: {} } } as any) === undefined, 'extractUsage 全部候选为空对象 → undefined')
    assert(extractUsage({} as any) === undefined, 'extractUsage 无 usage → undefined')
  }
  {
    // normalizeUsage:input_tokens/output_tokens(usage_metadata 命名)归一 → prompt/completion(rag-demo 真 LLM 实测驱动)
    const nu = normalizeUsage({ usage_metadata: { input_tokens: 100, output_tokens: 40 } } as any)
    assert(nu?.prompt_tokens === 100 && nu?.completion_tokens === 40 && nu?.total_tokens === 140, 'normalizeUsage usage_metadata(input/output_tokens)→ 归一 TokenUsage(total 缺省取和)')
    assert(normalizeUsage({ usage_metadata: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } as any) === null, 'normalizeUsage 全 0 → null')
    // prompt caching 字段归一(prompt-caching):Anthropic 顶层 snake 与 usage_metadata.input_token_details 两种形态
    const c1 = normalizeUsage({ additional_kwargs: { usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 100 } } } as any)
    assert(c1?.cache_read_input_tokens === 900 && c1?.cache_creation_input_tokens === 100, 'normalizeUsage Anthropic 顶层 snake 缓存字段 → 归一携带(llm.cacheControl 效果观测)')
    const c2 = normalizeUsage({ usage_metadata: { input_tokens: 10, output_tokens: 5, input_token_details: { cache_read: 700, cache_creation: 50 } } } as any)
    assert(c2?.cache_read_input_tokens === 700 && c2?.cache_creation_input_tokens === 50, 'normalizeUsage usage_metadata.input_token_details 缓存字段 → 归一携带(langchain 标准形态)')
    const c3 = normalizeUsage({ usage_metadata: { input_tokens: 10, output_tokens: 5 } } as any)
    assert(c3?.cache_read_input_tokens === undefined && c3?.cache_creation_input_tokens === undefined, 'normalizeUsage 无缓存字段 → 不携带(缺省不占位)')
  }
  {
    // 默认 fetch 包装剥 x-stainless-* 遥测头(严格 CORS 的 OpenAI 兼容网关白名单不含它们 → 浏览器预检失败;真 LLM 实测)
    const llm = constructOpenLlmSync({ apiKey: 'sk-test', model: 'gpt-4' }) as any
    const fetchFn = llm.clientConfig?.fetch  // ChatOpenAI → OpenAI client 的 configuration 透传证据
    assert(!!fetchFn, '✓ constructOpenLlmSync 默认注入 fetch 包装(剥 x-stainless-* 头)')
    // 包装行为:mock global fetch 捕获实际发出的头,断言 x-stainless-* 被剥 / 业务头保留
    const origFetch = globalThis.fetch
    let seen: string[] = []
    globalThis.fetch = (async (_url: any, init?: any) => {
      seen = [...new Headers(init?.headers ?? {}).keys()]
      return new Response('{"ok":true}', { status: 200 }) as any
    }) as any
    try {
      await fetchFn!('https://example.test/v1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-stainless-os': 'MacOS', 'x-stainless-lang': 'js', Authorization: 'Bearer k' } as any,
      })
      assert(!seen.some((k) => k.toLowerCase().startsWith('x-stainless')), '✓ fetch 包装:x-stainless-* 头被剥离(浏览器 CORS 预检不再被严格网关卡死)')
      assert(seen.some((k) => k.toLowerCase() === 'content-type') && seen.some((k) => k.toLowerCase() === 'authorization'), '✓ fetch 包装:业务头(Content-Type/Authorization)保留不动')
      // 无 x-stainless 头时零改写(Headers 重建但不丢字段)
      await fetchFn!('https://example.test/v1', { headers: { 'X-Custom': '1' } as any })
      assert(seen.some((k) => k.toLowerCase() === 'x-custom'), '✓ fetch 包装:普通自定义头保留(只剥遥测头)')
    } finally {
      globalThis.fetch = origFetch
    }
    // extraConfig.fetch 覆盖默认(集成方自带 fetch 不被默认包装劫持)
    const customFetch = async () => new Response('{}') as any
    const llm2 = constructOpenLlmSync({ apiKey: 'sk-test', model: 'gpt-4', extraConfig: { fetch: customFetch } }) as any
    const f2 = llm2.clientConfig?.fetch
    assert(f2 === customFetch, '✓ extraConfig.fetch 覆盖默认包装(集成方可整体替换)')
  }
  console.log('\n[子 agent provider 透传 · anthropic 协议]')
  {
    // fix:主 llm 传 LLMConfig + provider:'anthropic' 时,子 agent 散字段重建曾丢 provider →
    // 被按 OpenAI 协议构造,请求打到 {baseUrl}/chat/completions 404 秒败(rag-demo 真 MCP 实测抓包)。
    // 验证:伪 fetch(clientOptions 透传)捕获子 agent 实际请求,断言打到 Anthropic 原生 /v1/messages。
    class MockLLM extends BaseChatModel {
      scripts: Array<{ content?: string; toolCalls?: Array<{ id?: string; name: string; args?: any }> }>
      idx = 0
      constructor(scripts: any[]) { super({}); this.scripts = scripts }
      _llmType(): string { return 'mock' }
      async *_streamResponseChunks(_messages: any, _options: any): AsyncGenerator<any> {
        const s = this.scripts[this.idx++] ?? { content: '完成。' }
        const tcc = (s.toolCalls ?? []).map((tc, i) => ({ id: tc.id ?? `c${i}`, name: tc.name, args: JSON.stringify(tc.args ?? {}), index: i }))
        yield { text: s.content ?? '', message: new AIMessageChunk({ content: s.content ?? '', tool_call_chunks: tcc }), generationInfo: {} }
      }
      async _generate(_messages: any, _options: any): Promise<any> {
        const s = this.scripts[this.idx++] ?? { content: '完成。' }
        const msg = new AIMessage({ content: s.content ?? '', tool_calls: (s.toolCalls ?? []).map((tc, i) => ({ id: tc.id ?? `c${i}`, name: tc.name, args: tc.args ?? {} })) })
        return { generations: [{ text: s.content ?? '', message: msg }], llmOutput: {} }
      }
    }
    // 伪 fetch:记录请求 URL/body,返 Anthropic SSE 流(单 text block「子结论ok」)
    const seenUrls: string[] = []
    const seenBodies: any[] = []
    const fakeFetch = async (url: any, init?: any) => {
      seenUrls.push(String(url))
      try { seenBodies.push(JSON.parse(String(init?.body ?? '{}'))) } catch { seenBodies.push({}) }
      const enc = new TextEncoder()
      const events = [
        ['message_start', { type: 'message_start', message: { id: 'msg_t', type: 'message', role: 'assistant', content: [], model: 'claude', stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '子结论ok' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }],
        ['message_stop', { type: 'message_stop' }],
      ] as const
      const sse = events.map(([ev, d]) => `event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`).join('')
      const body = new ReadableStream({ start(c) { c.enqueue(enc.encode(sse)); c.close() } })
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }) as any
    }
    const mainLlm = new MockLLM([
      { toolCalls: [{ name: 'spawn_agent', args: { prompt: '查一下', model: 'claude-opus-4-override' } }] },
      { content: '完成' },
    ])
    const subMw = createSubagentMiddleware({
      llm: {
        provider: 'anthropic', apiKey: 'sk-ant-test', model: 'claude-3-5-sonnet-20241022',
        baseUrl: 'https://api.anthropic.test', contextWindow: 200000, maxTokens: 64,
        extraConfig: { fetch: fakeFetch },
      },
      allTools: () => [],
    })
    const agent = createAgent({ llm: mainLlm as any, middleware: [subMw], maxToolRounds: 2, maxRetries: 0 })
    let final = ''
    let spawnResult = ''
    await agent.stream([{ role: 'user', content: '做点事', timestamp: Date.now() }], (e: any) => {
      if (e.type === 'done') final = e.content
      if (e.type === 'tool_result' && e.name === 'spawn_agent') spawnResult = String(e.result ?? '')
    }, undefined)
    assert(final === '完成', '✓ 子 agent provider anthropic:主循环正常收口(spawn 后回到主 LLM 综合)')
    assert(seenUrls.length > 0, '✓ 子 agent provider anthropic:子 LLM 实际发出请求(经 clientOptions.fetch 捕获)')
    assert(seenUrls.every((u) => u.includes('/v1/messages')), '✓ 子 agent provider anthropic:请求打到 /v1/messages(修复前丢 provider 走 /chat/completions 404)')
    assert(!seenUrls.some((u) => u.includes('chat/completions')), '✓ 子 agent provider anthropic:无 OpenAI 协议请求(不混协议)')
    assert(spawnResult.includes('子结论ok'), '✓ 子 agent provider anthropic:SSE 流被解析,spawn 结论回主(子 agent 跑通)')
    assert(seenBodies.every((b) => b.model === 'claude-opus-4-override'), '✓ task.model 覆盖透传到子 LLM(请求 body.model = 委派覆盖值,非主 model)')
  }
}
