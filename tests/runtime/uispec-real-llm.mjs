/**
 * 真 LLM 全场景回归(Playwright 浏览器路径,仓库版)—— 模拟真实用户操作流,尽量发现问题
 *
 * 与 tests/runtime/*-real-llm.ts(headless 直连 dist)互补:本脚本走真实浏览器 + dev server 页面注入,
 * 覆盖 UI 交互(输入框发送)/ 渲染层 / vite HMR 干扰等浏览器环境因素。
 *
 * 场景(complex-demo,已挂 ark-ui-spec UI 规范 skill + 自动装配 html 子 agent):
 *   S1  复杂代码组件生成(UI 规范)     S2  二次精修(规范持续 + 笔记交接)
 *   S3  组件调序(move op)            S4  改普通组件属性(主 agent 自己 write)
 *   S5  新建普通组件(不经代码 agent) S6  删除组件
 *   S7  多组件整页(逐个委派)         S8  容器层级移动
 *   S9  错误恢复(不存在的组件名)     S10 模糊开放指令(「页面太素,搞点氛围」)
 *
 * 公共基建(waitIdle 双条件/事件捕获/断点续跑/基线对比)在 _real-llm-lib.mjs;
 * 方法论见 doc/real-llm-regression.md;统一入口 `npm run test:real uispec [场景号…]`。
 *
 * 用法:
 *   1. 跑前重启 dev server:npm run dev(拿最新代码 + 清 vite 缓存)
 *   2. 跑中禁并发 test:browser(会抢 dev server / 干扰页面)
 *   3. node tests/runtime/uispec-real-llm.mjs [场景号…]   # 默认全部;输出 _real-llm-uispec.json(gitignore)
 *
 * 环境变量:REAL_LLM_BASE(默认 http://localhost:3000)/ REAL_LLM_OUT;.env 无 VITE_AI_API_KEY 则 skip。
 */
import { pathToFileURL } from 'node:url'
import {
  resolveRunEnv, hasEnvKey, skipSuite, loadReport, launchBrowser, openDemoPage, runScenario, summarize,
} from './_real-llm-lib.mjs'

/** 套件入口(统一入口 real-llm.mjs 编排;也可直接 node 本文件) */
export async function runSuite({ only = process.argv.slice(2).map(Number).filter(Boolean) } = {}) {
  if (!hasEnvKey(/^VITE_AI_API_KEY=.+/m)) return skipSuite('.env 缺 VITE_AI_API_KEY(uispec 套件)')
  const { BASE, OUT } = resolveRunEnv({ outDefault: '_real-llm-uispec.json' })
  const report = loadReport(OUT, only)
  const browser = await launchBrowser()
  const page = await openDemoPage(browser, `${BASE}/examples/complex-demo/`)

  // 套件专属采集:基础三件(toolLog/usage/reply)+ 组件扁平化(含容器 children 嵌套)
  const collect = (p) => p.evaluate(() => ({
    toolLog: window.__toolLog,
    usage: window.__usage ?? (window.__sdk.usage?.total_tokens ? { prompt: window.__sdk.usage.prompt_tokens, completion: window.__sdk.usage.completion_tokens, fromSdkUsage: true } : null),
    reply: window.__sdk.messages[window.__sdk.messages.length - 1]?.content?.slice(0, 800) ?? '',
    components: window.page.components.map(function flat(c) {
      const kids = Array.isArray(c.props?.children) ? c.props.children : []
      return [{ type: c.type, name: c.props?.name ?? c.name, title: c.props?.title ?? c.props?.text ?? '', code: c.code ?? c.props?.code ?? '', notes: c.__pgNotes }, ...kids.flatMap(flat)]
    }).flat(),
    title: window.page.title,
  }))
  // 报告附加字段(components 摘要 + raw 全量,gitignore 报告保诊断能力)
  const decorate = (data) => ({
    components: data.components.map((c) => ({ ...c, code: undefined, codeHead: c.code.slice(0, 160) })),
    raw: data,
  })
  const sc = (no, name, prompt, checks) => runScenario({ page, no, name, prompt, checks, report, OUT, only, collect, decorate, quietTimeoutMs: 1800_000, errorRe: /PATH_DENIED|PATH_OUT_OF_SCOPE|不存在|失败/ })

  await sc(1, '复杂代码组件生成(UI 规范 skill)',
    '新增一个优惠券卡片代码组件:顶部撕边的优惠券(满 300 减 60),带一个旋转的折扣戳和一个立即领取按钮。严格按平台 UI 规范做,先看规范再写。',
    {
      'use_html 委派(自动装配)': (d) => d.toolLog.some((l) => l.name === 'use_html'),
      '新增 custom 组件落地': (d) => d.components.some((c) => c.type === 'custom' && c.code.length > 300),
      '规范主色 #7063E7': (d) => d.components.some((c) => c.code.includes('#7063E7')),
      '撕边 repeating-linear-gradient': (d) => d.components.some((c) => /repeating-linear-gradient/i.test(c.code)),
      '圆角 12px': (d) => d.components.some((c) => /border-radius:\s*12px/.test(c.code)),
      'class 前缀 cpn-': (d) => d.components.some((c) => /cpn-[a-z]+/.test(c.code)),
      '笔记沉淀': (d) => d.components.some((c) => Array.isArray(c.notes) && c.notes.length > 0),
      '零写越界(读探测自纠可接受)': (d) => !d.toolLog.some((l) => (l.result ?? '').includes('PATH_DENIED') && /write|edit|set|delete/.test(l.name)),
    })

  await sc(2, '二次精修(规范持续 + 笔记交接)',
    '把优惠券的折扣戳颜色换成规范里的金色,角度调正到 -3° 左右,其他不要动。',
    {
      '再次委派': (d) => d.toolLog.some((l) => l.name === 'use_html'),
      '规范金色 #F7C948': (d) => d.components.some((c) => c.code.includes('#F7C948')),
      '增量(组件数不增)': (d) => d.components.filter((c) => c.type === 'custom').length === 1,
    })

  await sc(3, '组件调序(move op)',
    '把优惠券组件移到组件列表最前面。',
    {
      '优惠券在最前': (d) => { const f = d.components[0]; return f && (f.type === 'custom' || (f.name ?? '') === 'coupon') },
      'move 或等价完成': () => true,
    })

  await sc(4, '改普通组件属性(主 agent 自己 write)',
    '把页面主标题改成「夏日数码节」。',
    {
      '标题已改': (d) => d.title.includes('夏日数码节'),
      '不经代码 agent(普通属性)': (d) => !d.toolLog.some((l) => l.name === 'use_html'),
    })

  await sc(5, '新建普通组件(不经代码 agent)',
    '加一个 banner 组件,标题写「限时特惠」,副标题「全场数码低至 5 折」。',
    {
      'banner 落地': (d) => d.components.some((c) => c.type === 'banner' && ((c.title ?? '').includes('限时特惠') || (c.name ?? '').includes('限时特惠'))),
    })

  await sc(6, '删除组件',
    '把刚才加的「限时特惠」banner 删掉。',
    {
      'banner 已删': (d) => !d.components.some((c) => c.type === 'banner' && JSON.stringify(c).includes('限时特惠')),
    })

  await sc(7, '多组件整页(逐个委派)',
    '再帮我加两个代码组件:① 倒计时组件(距活动开始 3 天,深色底等宽数字)② 活动规则说明卡片(3 条规则列表)。都按 UI 规范。',
    {
      '两个 custom 落地': (d) => d.components.filter((c) => c.type === 'custom' && c.code.length > 200).length >= 2,
      '委派 ≥2 次(逐个)': (d) => d.toolLog.filter((l) => l.name === 'use_html').length >= 2,
    })

  await sc(8, '容器层级移动',
    '把倒计时组件放进页面里合适的容器区域里(如果有容器的话;没有就保持原位不硬塞)。',
    {
      '有响应不报错': (d) => d.reply.length > 0,
      '组件未丢失': (d) => d.components.filter((c) => c.type === 'custom').length >= 2,
    })

  await sc(9, '错误恢复(不存在的组件)',
    '把「不存在的幽灵组件」改成红色。',
    {
      '明确告知不存在(不瞎编)': (d) => /不存在|没有找到|未找到|找不到/.test(d.reply),
      '零误写(不凭空创建)': (d) => !d.components.some((c) => (c.name ?? '').includes('幽灵')),
    })

  await sc(10, '模糊开放指令',
    '页面太素了,帮我搞点氛围感。',
    {
      '有实际产出或具体方案': (d) => d.toolLog.some((l) => l.kind === 'call') || d.reply.length > 60,
      '零致命错误': (d) => !d.toolLog.some((l) => l.kind === 'error' && /fatal/i.test(l.msg ?? '')),
    })

  await browser.close()
  const sum = summarize(report, OUT)
  return { suite: 'uispec', report, OUT, ...sum }
}

// 直接运行本文件时自执行(统一入口 real-llm.mjs import 时不触发)
const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirect) await runSuite()
