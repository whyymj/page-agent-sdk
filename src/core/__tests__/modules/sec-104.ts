/**
 * sec-104:render-check(渲染级自检)
 * 覆盖:纯函数面(normalizeRenderResult 三态/信号分类/storage 降 warn/白屏启发式;buildSandboxSrcdoc 注入位置与不改原文;
 * buildCollectorJs nonce 握手协议)+ 门禁形态(createHtmlRenderCheck 检查面组装:touched vfs + write 新建差集 /
 * 结构不过短路渲染 / node 无 DOM 跳渲染段留痕 / unavailable 防假绿文案 / maxTargets 截断)。
 * node 无 DOM:runner 经 opts.runner 注入桩(真沙箱行为由 browser e2e 覆盖)。
 */
import type { TestCtx } from './_ctx'
import {
  normalizeRenderResult, buildSandboxSrcdoc, buildCollectorJs,
  createHtmlRenderCheck, composeStructureThenRender,
  type RawRenderResult,
} from '../../sdk/htmlRenderCheck'
import { createHtmlFormatCheck } from '../../sdk/htmlSubagent'

export async function run(ctx: TestCtx): Promise<void> {
  const { assert } = ctx

  console.log('\n[normalizeRenderResult 归一纯函数]')
  {
    // pass:握手 + 无失败信号 + 指标健康
    const r = normalizeRenderResult({ handshake: true, signals: [], metrics: { bodyChildren: 3, scrollHeight: 400, imgCount: 1 } })
    assert(r.verdict === 'pass' && r.problems.length === 0, '✓ 健康(无信号 + 指标正常)→ pass')
    // fail:js-error 带行号
    const r2 = normalizeRenderResult({ handshake: true, signals: [{ type: 'js-error', message: 'x is not a function', lineno: 12, source: 'about:srcdoc' }] })
    assert(r2.verdict === 'fail' && /第 12 行/.test(r2.problems[0]), '✓ js-error → fail + 行号进 problems')
    // fail:console-error / unhandledrejection / resource-error
    assert(normalizeRenderResult({ handshake: true, signals: [{ type: 'console-error', message: 'bad' }] }).verdict === 'fail', '✓ console-error → fail')
    assert(normalizeRenderResult({ handshake: true, signals: [{ type: 'unhandledrejection', message: 'boom' }] }).verdict === 'fail', '✓ unhandledrejection(异步)→ fail')
    const r3 = normalizeRenderResult({ handshake: true, signals: [{ type: 'resource-error', message: 'IMG', source: 'https://x/a.png' }] })
    assert(r3.verdict === 'fail' && /a\.png/.test(r3.problems[0]), '✓ 资源失败(捕获相)→ fail + url 进 problems')
    // console-warn → warning 不计失败
    const r4 = normalizeRenderResult({ handshake: true, signals: [{ type: 'console-warn', message: 'dep' }] })
    assert(r4.verdict === 'pass' && r4.warnings.length === 1, '✓ console-warn → pass + warning(不阻断)')
    // storage 类 SecurityError 降 warn(沙箱 opaque origin 假阳性)
    const r5 = normalizeRenderResult({ handshake: true, signals: [{ type: 'js-error', message: "Uncaught SecurityError: Failed to read the 'localStorage' property from 'Window'" }] })
    assert(r5.verdict === 'pass' && /storage 类/.test(r5.warnings[0]), '✓ storage 类 SecurityError → 降 warn 不计失败(沙箱假阳性治理)')
    // CSP 违规 → warning(宿主责任不株连组件)
    const r6 = normalizeRenderResult({ handshake: true, signals: [{ type: 'csp-violation', message: 'script-src-elem: https://cdn.x.js' }] })
    assert(r6.verdict === 'pass' && /CSP/.test(r6.warnings[0]), '✓ csp-violation → warning(沙箱继承宿主 CSP,不判组件缺陷)')
    // 白屏启发式:无失败信号 + scrollHeight<10(内容级单口径,覆盖 display:none / body 空)→ fail 疑似白屏
    const r7 = normalizeRenderResult({ handshake: true, signals: [], metrics: { bodyChildren: 2, scrollHeight: 0, imgCount: 0 } })
    assert(r7.verdict === 'fail' && /疑似白屏/.test(r7.problems[0]), '✓ 白屏指标(scrollHeight 0,body 有子节点如 display:none)→ fail 疑似白屏')
    // 有内容健康组件不误判(body 内容级高度)
    assert(normalizeRenderResult({ handshake: true, signals: [], metrics: { bodyChildren: 3, scrollHeight: 220, imgCount: 1 } }).verdict === 'pass', '✓ 有内容(scrollHeight 220)不误判白屏')
    // 指标缺失(有信号流)不误判白屏
    assert(normalizeRenderResult({ handshake: true, signals: [{ type: 'console-warn', message: 'w' }] }).verdict === 'pass', '✓ 指标缺失不触发白屏误判')
    // unavailable:握手缺失(零信号 ≠ 通过)
    const r8 = normalizeRenderResult({ handshake: false, signals: [] })
    assert(r8.verdict === 'unavailable' && r8.reason === 'handshake-missing', '✓ 握手缺失 → unavailable(CSP 拦内联脚本,防假绿)')
    // unavailable:超时(无信号无指标)
    const r9 = normalizeRenderResult({ handshake: true, signals: [], timedOut: true })
    assert(r9.verdict === 'unavailable' && r9.reason === 'timeout', '✓ 收集窗超时(零产出)→ unavailable')
    // 超时但已有信号 → 按已有信号判定(非 unavailable)
    assert(normalizeRenderResult({ handshake: true, signals: [{ type: 'console-error', message: 'e' }], timedOut: true }).verdict === 'fail', '✓ 超时但有信号 → 按信号判 fail(不浪费已采信息)')
  }

  console.log('\n[buildSandboxSrcdoc / buildCollectorJs 构造纯函数]')
  {
    const nonce = 'pg_rc_test_abc'
    const js = buildCollectorJs(nonce)
    assert(js.includes(`"pg_rc_test_abc"`) && js.includes('post("handshake"'), '✓ collector 含 nonce + 加载即握手')
    assert(js.includes('unhandledrejection') && js.includes('securitypolicyviolation'), '✓ collector 挂钩异步 reject + CSP 违规')
    assert(js.includes('"error"') && js.includes('IMG') && js.includes('true'), '✓ collector 捕获相资源失败监听')
    // 完整文档:注入 head 开头(collector 先于组件脚本)
    const doc = '<html><head><title>t</title><script>bad()</script></head><body><p>hi</p></body></html>'
    const sd = buildSandboxSrcdoc(doc, nonce)
    assert(sd.indexOf('pg_rc_test_abc') < sd.indexOf('bad()'), '✓ 完整文档:collector 注入 head 开头(先于组件脚本)')
    assert(sd.includes('<title>t</title>') && sd.includes('<p>hi</p>'), '✓ 原文不改动(归因保真)')
    // 片段文档:退化到前置
    const frag = '<div>x</div><script>ok()</script>'
    const sd2 = buildSandboxSrcdoc(frag, nonce)
    assert(sd2.startsWith('<script>') && sd2.endsWith(frag), '✓ 片段文档:collector 前置(浏览器自建 head)')
  }

  console.log('\n[createHtmlRenderCheck 门禁形态(node 桩 runner)]')
  {
    // 桩 runner:可编程返回序列(检查面按序消费)
    const stubResults: RawRenderResult[] = []
    let calls: string[] = []
    const mk = (results: RawRenderResult[]) => {
      let i = 0
      calls = []
      return (html: string) => {
        calls.push(html)
        return Promise.resolve(results[i++] ?? { handshake: true, signals: [] })
      }
    }
    const stateOf = (files: Record<string, { content: string }>, touched: string[], bind?: unknown) => ({
      files, __pgTouched: new Set(touched), ...(bind !== undefined ? { __bindProbe: bind } : {}),
    }) as any

    // ① 零触达 → ok(不建沙箱)
    {
      const rc = createHtmlRenderCheck({ runner: mk([]) })
      const r = await rc.check({ state: stateOf({}, []), messages: [] as any } as any)
      assert(r.ok === true && calls.length === 0, '✓ 零触达(无 touched/无新建)→ 直接 ok 零沙箱消耗')
    }
    // ② touched vfs 文件 → 逐个渲染
    {
      const rc = createHtmlRenderCheck({ runner: mk([{ handshake: true, signals: [] }]) })
      const r = await rc.check({ state: stateOf({ 'html/c_1.html': { content: '<p>a</p>' } }, ['html/c_1.html']), messages: [] as any } as any)
      assert(r.ok === true && calls.length === 1 && calls[0] === '<p>a</p>', '✓ touched vfs 文件内容进沙箱检查')
    }
    // ③ 失败信号 → ok:false + 归因 + 修复指引
    {
      const rc = createHtmlRenderCheck({ runner: mk([{ handshake: true, signals: [{ type: 'js-error', message: 'boom', lineno: 3 }] }]) })
      const r = await rc.check({ state: stateOf({ 'html/c_1.html': { content: '<p>a</p>' } }, ['html/c_1.html']), messages: [] as any } as any)
      assert(r.ok === false && /渲染自检未通过/.test(r.feedback!) && /html\/c_1\.html:JS 运行时错误:boom/.test(r.feedback!) && /vfs_edit/.test(r.feedback!), '✓ 失败回灌:组件归因 + vfs_edit 修复指引')
    }
    // ④ write 新建差集:bind 有 code 组件但 vfs 缺位 → 进检查面(不经消息流猜 index)
    {
      const rc = createHtmlRenderCheck({ runner: mk([{ handshake: true, signals: [{ type: 'resource-error', message: 'IMG', source: 'x.png' }] }]) })
      rc.setWritablePaths(['components'])
      rc.setGetController(() => ({ get: () => ({ bind: { components: [{ name: 'n', code: '<b>x</b>', __pgId: 'c_new' }] } }) }))
      const r = await rc.check({ state: stateOf({}, []), messages: [] as any } as any)
      assert(r.ok === false && /components\.0\(write 新建,vfs 未检出\)/.test(r.feedback!), '✓ write 新建组件(vfs 缺位)进检查面 + 归因标注')
    }
    // ⑤ vfs 已检出的组件不重复进面(checkout 过)
    {
      const rc = createHtmlRenderCheck({ runner: mk([]) })
      rc.setWritablePaths(['components'])
      rc.setGetController(() => ({ get: () => ({ bind: { components: [{ code: '<b/>', __pgId: 'c_1' }] } }) }))
      const r = await rc.check({ state: stateOf({ 'html/c_1.html': { content: '<b/>' } }, []), messages: [] as any } as any)
      assert(r.ok === true && calls.length === 0, '✓ vfs 已检出组件不在差集(不重复检查)')
    }
    // ⑥ unavailable(握手缺失)→ ok:false 防假绿 + 引导 validate_code + 如实说明
    {
      const rc = createHtmlRenderCheck({ runner: mk([{ handshake: false, signals: [] }]) })
      const r = await rc.check({ state: stateOf({ 'html/c_1.html': { content: '<p/>' } }, ['html/c_1.html']), messages: [] as any } as any)
      assert(r.ok === false && /渲染检查不可用/.test(r.feedback!) && /validate_code/.test(r.feedback!) && /勿声称已通过渲染验证/.test(r.feedback!), '✓ 握手缺失 → 「检查不可用」非通过(防假绿)+ validate_code 兜底引导')
    }
    // ⑦ node/无 DOM:真 runner(未注入桩)→ 跳渲染段 + observable 留痕(node selftest 环境恒命中)
    {
      const rc = createHtmlRenderCheck({})  // 不注入 runner(node 下 renderInSandbox 返 noDom,但 check 层更早守卫)
      const logs: Array<{ t: string; d: any }> = []
      const r = await rc.check({ state: stateOf({ 'html/c_1.html': { content: '<p/>' } }, ['html/c_1.html']), messages: [] as any, log: (t: string, d: unknown) => logs.push({ t, d: d as any }) } as any)
      assert(r.ok === true && logs.some((l) => (l.d as any).stage === 'render_check_skip' && (l.d as any).reason === 'no-dom'),
        '✓ node/无 DOM → 跳渲染段保留放行 + render_check_skip 留痕(node e2e 零回归的守卫)')
    }
    // ⑧ maxTargets 截断 + 留痕
    {
      const rc = createHtmlRenderCheck({ runner: mk([]), maxTargets: 1 })
      const logs: Array<any> = []
      const files: Record<string, { content: string }> = { 'html/a.html': { content: 'a' }, 'html/b.html': { content: 'b' } }
      const r = await rc.check({ state: stateOf(files, ['html/a.html', 'html/b.html']), messages: [] as any, log: (_t: string, d: unknown) => logs.push(d) } as any)
      assert(r.ok === true && calls.length === 1 && logs.some((l) => l.stage === 'render_check_truncated' && l.total === 2), '✓ 检查面防御上限截断 + 留痕(touched 天然 ≤2,防御孤儿场景)')
    }
  }

  console.log('\n[composeStructureThenRender 结构短路]')
  {
    let renderRan = false
    const structure = (): { ok: boolean; feedback?: string } => ({ ok: false, feedback: '结构错误:标签未闭合' })
    const render = () => { renderRan = true; return { ok: true } }
    const combined = composeStructureThenRender(structure, render)
    const r = await combined({ state: {} as any, messages: [] as any })
    assert(r.ok === false && r.feedback === '结构错误:标签未闭合' && renderRan === false, '✓ 结构不过 → 短路渲染(单 check 内早返回,不浪费沙箱)')
    // 结构过 → 渲染跑
    const combined2 = composeStructureThenRender(() => ({ ok: true }), () => { renderRan = true; return { ok: true } })
    await combined2({ state: {} as any, messages: [] as any })
    assert(renderRan === true, '✓ 结构过 → 渲染执行')
    // 与真结构校验器组合:createHtmlFormatCheck 对坏 HTML 报错 → 短路
    const rc = createHtmlRenderCheck({ runner: () => { renderRan = false; return Promise.resolve({ handshake: true, signals: [] }) } })
    const combined3 = composeStructureThenRender(createHtmlFormatCheck({ vfsPrefix: 'html/' }), rc.check)
    const r3 = await combined3({
      state: { files: { 'html/bad.html': { content: '<div><p>x</p>' } as any }, __pgTouched: new Set(['html/bad.html']) } as any,
      messages: [] as any,
    })
    assert(r3.ok === false && /HTML 格式校验未通过/.test(r3.feedback!), '✓ 组合链:坏结构(标签未闭合)→ 结构段拦截,渲染段不跑')
  }
}
