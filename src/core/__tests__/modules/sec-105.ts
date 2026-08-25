/**
 * sec-105:subtree-summary Phase 0(大子树摘要泛化 + 三通道)
 * 纯函数面:体积两态(≥3KB 子树占位 / 阈值下零变化)/ 键名取投影后值 / 小标量不单独摘要 / 数组 children:N /
 * 内层优先(孩子先判,父按占位后有效体积)/ 结果根豁免两态 / fullTextPrefixes 任意深度豁免(父不因全文孩子被摘要)/
 * `#` 指纹 + 占位符无 `hash=` 字面量(workingMemory lastHashes 捕获红线)。
 * 集成面:read 单路径根豁免 / read 多路径每路径根豁免 / query 命中值无根豁免(占位+path)/
 * 聚焦全文通道(focus wrapToolCall → ctx.callConfig.__pgFullTextPaths → read 任意深度豁免)。
 */
import { z } from 'zod'
import type { TestCtx } from './_ctx'
import { createDataOps, summarizeLargeText, SUBTREE_SUMMARY_THRESHOLD, findPlaceholderLeak } from '../../tools/dataOps'
import { createFocusMiddleware } from '../../harness/focus'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert, invoke, byName } = ctx
  const TH = SUBTREE_SUMMARY_THRESHOLD

  console.log('\n[summarizeLargeText 体积形态纯函数]')
  {
    // 低于阈值:结构零变化(轻量数据零变化锁)
    const small = { title: 't', props: { a: 1, b: 'x'.repeat(100) } }
    assert(JSON.stringify(summarizeLargeText(small, true, [], 200)) === JSON.stringify(small), '✓ 处处低于阈值 → 结构零变化')
    // ≥ 阈值子树 → 占位(键名 + 指纹)
    const big = { title: 't', style: { bg: 'x'.repeat(TH + 50), fg: 'y' } }
    const r = summarizeLargeText(big, true, [], 200) as any
    assert(typeof r.style === 'string' && /<subtree [\d.]+KB keys:\[bg,fg\] #[0-9a-z]+>/.test(r.style), '✓ ≥阈值子树 → <subtree NKB keys:[…] #指纹> 占位')
    assert(r.title === 't', '✓ 小兄弟节点保持可见(内层优先:只摘 style,不摘父)')
    assert(!String(r.style).includes('hash='), '✓ 占位符无 hash= 字面量(workingMemory lastHashes 捕获红线)')
    // 子 scope 全文
    assert((summarizeLargeText(big, false, [], 200) as any).style.bg.length === TH + 50, '✓ 子 scope(isMain=false)全文(既有通道不动)')
    // 数组形态:children:N
    const bigArr = { items: Array.from({ length: 500 }, (_, i) => ({ id: i, note: `n${i}` })) }
    const r2 = summarizeLargeText(bigArr, true, [], 200) as any
    assert(typeof r2.items === 'string' && /<subtree [\d.]+KB children:500 #[0-9a-z]+>/.test(r2.items), '✓ 大数组(500 小元素有效体积超阈)→ 整树占位 children:500')
    // 键名截断:6 个以上键
    const manyKeys = { box: { k1: 'v', k2: 'v', k3: 'v', k4: 'v', k5: 'v', k6: 'v', k7: 'v', big: 'x'.repeat(TH) } }
    const r3 = summarizeLargeText(manyKeys, true, [], 200) as any
    assert(/keys:\[k1,k2,k3,k4,k5,k6,…\]/.test(r3.box), '✓ 键名最多 6 个 + 省略号')
    // 小标量永不单独摘要:大 string 叶子不在标记集且父未超阈 → 原样;父超阈 → 随父入摘要面(keys 可见其存在)
    const bigStr = { title: 't', note: 'x'.repeat(TH + 10) }
    const r4 = summarizeLargeText(bigStr, true, [], 200) as any
    assert(typeof r4 === 'string' && /keys:\[title,note\]/.test(r4), '✓ 大 string 叶子入摘要面(父占位,键名可见;窄读通道取全文)')
  }

  console.log('\n[结果根豁免 + fullTextPrefixes 纯函数]')
  {
    const big = { bg: 'x'.repeat(TH + 50), layout: { a: 1 } }
    // rootExempt: true(read 形态)→ 根完整,内部大子树照占位
    const re = summarizeLargeText({ style: big }, true, [], 200, { rootExempt: true }) as any
    assert(typeof re.style === 'string' && /<subtree/.test(re.style), '✓ rootExempt=true:结果根不摘要,内部大子树照占位')
    // rootExempt: false(query 形态)→ 根自身也摘要(内层占位后有效体积仍超阈:如 500 小元素数组)
    const q = summarizeLargeText({ style: big }, true, [], 200, { rootExempt: false }) as any
    assert(typeof q.style === 'string' && /<subtree/.test(q.style), '✓ rootExempt=false + 内层优先:内层大子树先占位,父(有效体积小)不重复摘要')
    const q2 = summarizeLargeText(Array.from({ length: 500 }, (_, i) => ({ id: i })), true, [], 200, { rootExempt: false }) as any
    assert(typeof q2 === 'string' && /<subtree [\d.]+KB children:500/.test(q2), '✓ rootExempt=false(query 命中值):500 小元素命中值 → 根自身占位')
    // fullTextPrefixes:豁免前缀内(含嵌套)全文
    const f = summarizeLargeText({ c1: { deep: { code: 'x'.repeat(TH + 50) } }, c2: { code: 'y'.repeat(TH + 50) } }, true, [], 200,
      { rootExempt: true, fullTextPrefixes: ['c1'] }) as any
    assert(f.c1.deep.code.length === TH + 50, '✓ 豁免前缀内任意深度嵌套大子树全文(仅根豁免不够的回归锁)')
    assert(typeof f.c2 === 'string' && /<subtree/.test(f.c2), '✓ 前缀外子树照常摘要')
    // 父不因全文孩子被摘要(豁免孩子有效体积按占位计)
    const f2 = summarizeLargeText({ items: [{ full: 'x'.repeat(TH * 3) }, { small: 1 }] }, true, [], 200,
      { rootExempt: false, fullTextPrefixes: ['items.0'] }) as any
    assert(f2.items[0].full.length === TH * 3 && f2.items[1].small === 1, '✓ 父不因豁免的全文孩子被连带摘要(数组原样)')
    // 标记字段在豁免前缀内不摘要
    const f3 = summarizeLargeText({ c: [{ code: 'x'.repeat(300) }] }, true, [{ arrayPath: 'c', field: 'code' }], 200,
      { rootExempt: true, fullTextPrefixes: ['c'] }) as any
    assert(f3.c[0].code.length === 300, '✓ 豁免前缀内标记字段(code)也不摘要(聚焦态全文)')
  }

  console.log('\n[集成:read/query 三通道]')
  {
    const schema = z.object({
      title: z.string(),
      components: z.array(z.object({ name: z.string(), props: z.object({ style: z.object({ bg: z.string(), fg: z.string() }), note: z.string() }) })),
    })
    const mkBind = () => ({
      title: '页',
      components: [
        { name: 'a', props: { style: { bg: 'x'.repeat(TH + 100), fg: 'y' }, note: 'n' }, hidden: 'SECRET-UNDECLARED' + 'z'.repeat(TH) },
        { name: 'b', props: { style: { bg: 'g', fg: 'w' }, note: 'm' } },
      ],
    })
    const t = byName(createDataOps({ schema, bind: mkBind(), description: 'd' }))
    // ① read 单路径:结果根豁免(components.1 完整;components.0.props.style 内层占位)
    const r1 = await invoke(t['read'], { jsonPath: 'components.1' })
    assert(!/<subtree/.test(r1) && /"name":"b"/.test(r1), '✓ read 单路径:小目标根豁免完整返回')
    const r2 = await invoke(t['read'], { jsonPath: 'components.0' })
    assert(/<subtree [\d.]+KB keys:\[bg,fg\] #[0-9a-z]+>/.test(r2) && /"name":"a"/.test(r2) && !/SECRET/.test(r2), '✓ read 单路径:根豁免但内部大子树占位;键名取投影后值(未声明 hidden 不泄露,含其体积贡献)')
    // ② read 多路径:每路径各自根豁免
    const r3 = await invoke(t['read'], { jsonPaths: ['components.0', 'components.1'] })
    assert(/components\.0 = .*<subtree/.test(r3) && /components\.1 = .*"name":"b"/.test(r3), '✓ read 多路径:各路径根豁免,内层照占位')
    // ③ query 命中值:无根豁免(大命中值整体占位 + path 供钉路径窄读)
    const r4 = await invoke(t['query_data'], { expr: '$.components[?(@.name=="a")].props.style' })
    assert(/"path":"components\.0\.props\.style"/.test(r4) && /<subtree/.test(r4), '✓ query 命中值无根豁免:大值占位 + path(检索形态,LLM 钉路径窄读)')
    // ④ 聚焦全文通道:focus wrapToolCall 注入 __pgFullTextPaths → read 全文
    const bind2 = mkBind()
    const ops2 = createDataOps({ schema, bind: bind2, description: 'd' })
    const t2 = byName(ops2)
    const focusMw = createFocusMiddleware({ getBind: () => bind2 })
    focusMw.setFocus?.({ path: 'components.0' })
    let captured: unknown
    const fakeNext = async (c2: { args: unknown; callConfig?: Record<string, unknown> }): Promise<{ content: string }> => {
      captured = c2.callConfig
      const content = await (t2['read'] as any).invoke(c2.args, { configurable: c2.callConfig })
      return { content: String(content) }
    }
    const res = await (focusMw as any).wrapToolCall(
      { name: 'read', args: { jsonPath: 'components.0' }, state: {}, callConfig: undefined },
      fakeNext,
    )
    const text = String((res as { content: string }).content)
    assert((captured as any)?.__pgFullTextPaths?.[0] === 'components.0', '✓ focus wrapToolCall → ctx.callConfig 注入 __pgFullTextPaths(per-call 通道)')
    assert(!/<subtree/.test(text) && text.includes('x'.repeat(50).slice(0, 50)), '✓ 聚焦态 read:焦点子树内大子树全文(豁免前缀生效)')
    // 聚焦范围外读:前缀不匹配 → 照常摘要(components.1 路径带 c2? 用显式 jsonPath 读 b)
    const res2 = await (focusMw as any).wrapToolCall(
      { name: 'read', args: { jsonPath: 'components.1' }, state: {}, callConfig: undefined },
      fakeNext,
    )
    assert(/"name":"b"/.test(String((res2 as { content: string }).content)), '✓ 聚焦态范围外读正常(b 完整,小目标本就无摘要)')
    // ⑤ write/read 语义零变化锚:同 bind 写后读回
    const w = await invoke(t['write'], { patch: { op: 'set', jsonPath: 'title', value: '新页' } })
    assert(/已 write\(edit\)/.test(w), '✓ write 语义零变化(摘要只在读面)')
  }

  console.log('\n[占位符夹带值防线(findPlaceholderLeak + 写路径拒收)]')
  {
    // 纯函数面:两类占位命中 / 正常值零误伤
    assert(findPlaceholderLeak('<subtree 4.2KB keys:[bg,fg] #a1b2c3d4>') !== null, '✓ <subtree …> 整串占位 → 检出')
    assert(findPlaceholderLeak({ a: ['x', '<subtree 12KB children:800 #ff00>'] }) !== null, '✓ 嵌套任意深度的 <subtree> → 检出')
    assert(findPlaceholderLeak({ code: '<code 2.3KB>' }) !== null, '✓ 标记字段占位 <code 2.3KB>(整串)→ 检出')
    assert(findPlaceholderLeak('正常文本') === null, '✓ 正常字符串 → 不误伤')
    assert(findPlaceholderLeak('<div class="x">内容 <b 3KB></b></div>') === null, '✓ HTML 混合内容子串 <b 3KB>(非整串)→ 不误伤')
    assert(findPlaceholderLeak({ list: [{ note: '<subtree 1.0KB children:3 #abcd1234>' }] }) !== null, '✓ 数组内对象深层占位 → 检出')
    // 写路径面:整体 set / patch / patches 三入口夹带即拒 + bind 不落脏
    const schema2 = z.object({ title: z.string(), note: z.string(), meta: z.object({ tag: z.string() }) })
    const bind2: any = { title: 't', note: 'n', meta: { tag: 'g' }, hidden: '秘密' }
    const t2 = byName(createDataOps({ schema: schema2, bind: bind2, description: 'd' }))
    const wSet = await invoke(t2['write'], { value: { title: '<subtree 4.2KB keys:[title] #a1b2>' } })
    assert(/PLACEHOLDER_LEAK/.test(wSet) && /占位/.test(wSet), '✓ write(set) value 夹带 <subtree> → 拒(ERROR: PLACEHOLDER_LEAK)')
    assert(bind2.title === 't', '✓ 拒收后 bind 未落脏(set)')
    const wPatch = await invoke(t2['write'], { patch: { op: 'set', jsonPath: 'note', value: '<code 2.3KB>' } })
    assert(/PLACEHOLDER_LEAK/.test(wPatch) && bind2.note === 'n', '✓ write(patch) value 夹带标记占位 → 拒 + bind 不变')
    const wPatches = await invoke(t2['write'], { patches: [
      { op: 'set', jsonPath: 'title', value: '正常' },
      { op: 'set', jsonPath: 'note', value: '<subtree 12KB children:8 #dead>' },
    ] })
    assert(/PLACEHOLDER_LEAK/.test(wPatches) && bind2.title === 't' && bind2.note === 'n', '✓ write(patches) 任一夹带 → 整批拒(原子),合法 patch 也不落')
    const wDry = await invoke(t2['write'], { patch: { op: 'set', jsonPath: 'note', value: '<subtree 1KB #x>' }, dryRun: true })
    assert(/PLACEHOLDER_LEAK/.test(wDry), '✓ dryRun 预检同样暴露占位夹带(预检即发现,防真写时才炸)')
    // 正常写不受影响 + verbatim 资源句柄(⟦res:…⟧)零重叠不误伤
    const wOk = await invoke(t2['write'], { patch: { op: 'set', jsonPath: 'meta.tag', value: '⟦res:r_abc123⟧' } })
    assert(/已 write\(edit\)/.test(wOk) && bind2.meta.tag === '⟦res:r_abc123⟧', '✓ 正常写零影响;verbatim 句柄(前缀不同)不误伤')
  }

  console.log('\n[防线×受保护字段顺序(团队审查 P1-1):bind 既有 freeze 值含 <subtree 字面量不阻塞 whole-set]')
  {
    // enforceSet 会把 LLM 未传的受保护字段用 bind 当前值回填进 value —— leak 检查必须在 enforceSet **之前**
    // (检 LLM 原始值):否则 bind 里存了含 `<subtree ` 字面量的受保护文本(如 SDK 文档)时,LLM 从未写过该值
    // 却每次 whole-set 写都被拒 → 永久阻塞无逃生门
    const schema3 = z.object({ title: z.string(), doc: z.string(), meta: z.object({ tag: z.string() }) })
    const bind3: any = { title: 't', doc: 'SDK 文档示例:<subtree 4.2KB keys:[a] #ab12> 是占位符', meta: { tag: 'g' } }
    const t3 = byName(createDataOps({ schema: schema3, bind: bind3, description: 'd', resources: [{ path: 'doc', mode: 'freeze' as const }] }))
    const w = await invoke(t3['write'], { value: { title: '新标题', meta: { tag: 'new' } } })
    assert(/已 write\(set\)/.test(w), '✓ whole-set 写:回填的受保护字段值(含 <subtree 字面量)不被当夹带 → 不永久阻塞')
    assert(bind3.title === '新标题' && bind3.doc.includes('<subtree'), '✓ 写入生效且未传的 freeze 字段原值保留(含字面量)')
    // 对照:LLM 真把占位写进普通字段 → 照拦(顺序调整只放行 bind 侧回填,不放松 LLM 值防线)
    const wBad = await invoke(t3['write'], { patch: { op: 'set', jsonPath: 'title', value: '<subtree 1.0KB children:3 #abcd1234>' } })
    assert(/PLACEHOLDER_LEAK/.test(wBad), '✓ 对照:LLM 值真夹带占位照拦(只检 LLM 原始值,口径未放松)')
  }
}
