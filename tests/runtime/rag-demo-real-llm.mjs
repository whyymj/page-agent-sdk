/**
 * rag-demo 四模式真 LLM 回归(Playwright 浏览器路径;Anthropic 协议 modelverse)
 *
 *   A memory 异步注入     —— 文档常驻主上下文,期望主 agent 直答(零委派)
 *   B createRagSubagent(mock retriever)—— 期望 use_rag 委派 → search_docs → 结论回主
 *   C 子 agent + 真实 MCP(VITE_RAG_MCP_URL)—— 期望 use_rag 委派 → search_docs → 远程 rag_search
 *   D MCP 直连            —— 期望 mcp 工具迟到注入主工具池,主 agent 直调(不经子 agent)
 *
 * 公共基建在 _real-llm-lib.mjs;方法论见 doc/real-llm-regression.md;统一入口 `npm run test:real rag [场景号…]`。
 * 用法:node tests/runtime/rag-demo-real-llm.mjs [场景号…];输出 _real-llm-rag.json(gitignore)
 * 环境变量:REAL_LLM_BASE(默认 http://localhost:3000)/ REAL_LLM_OUT;无 VITE_ANTHROPIC_API_KEY 自动 skip。
 */
import { pathToFileURL } from 'node:url'
import {
  resolveRunEnv, hasEnvKey, skipSuite, loadReport, launchBrowser, openDemoPage, runScenario, summarize, sleep,
} from './_real-llm-lib.mjs'

/** 套件入口(统一入口 real-llm.mjs 编排;也可直接 node 本文件) */
export async function runSuite({ only = process.argv.slice(2).map(Number).filter(Boolean) } = {}) {
  if (!hasEnvKey(/^VITE_ANTHROPIC_API_KEY=.+/m)) return skipSuite('.env 缺 VITE_ANTHROPIC_API_KEY(rag 套件)')
  const { BASE, OUT } = resolveRunEnv({ outDefault: '_real-llm-rag.json' })
  const report = loadReport(OUT, only)
  const browser = await launchBrowser()
  const page = await openDemoPage(browser, `${BASE}/examples/rag-demo/`)

  // 套件专属采集:基础三件 + MCP server 状态 + 子 agent 历史
  const collect = (p) => p.evaluate(() => ({
    toolLog: window.__toolLog,
    usage: window.__usage ?? (window.__sdk.usage?.total_tokens ? { prompt: window.__sdk.usage.prompt_tokens, completion: window.__sdk.usage.completion_tokens, fromSdkUsage: true } : null),
    reply: window.__sdk.messages[window.__sdk.messages.length - 1]?.content?.slice(0, 800) ?? '',
    mcpServers: window.__sdk.inspect().mcp?.servers?.map((s) => `${s.name}:${s.toolCount}`) ?? [],
    subHistory: (window.__sdk.inspect().subagent?.history ?? []).map((h) => ({ label: h.label, status: h.status })),
  }))
  const sc = (no, name, prompt, checks, opts = {}) => runScenario({
    page, no, name, prompt, checks, report, OUT, only, collect,
    errorRe: /检索出错|加载出错|未检索到|不存在|invalid|denied/i,
    decorate: (data) => ({ mcpServers: data.mcpServers, subHistory: data.subHistory }),
    before: opts.before, after: opts.after,
  })
  /** 场景是否在本轮执行(only 过滤;场景被跳过时连前置切模式/MCP 等待也一并省) */
  const willRun = (no) => !only.length || only.includes(no)

  // ---------- S1 A · memory 异步注入(文档常驻主上下文,期望直答零委派) ----------
  await sc(1, 'A · memory 异步注入',
    '基础版多少钱一个月?支持退款吗?',
    {
      '答出价格 ¥99/月': (d) => /99\s*元|¥\s*99|99\s*\/\s*月/.test(d.reply),
      '答出退款政策(7 天)': (d) => /7\s*天/.test(d.reply),
      '零委派(memory 常驻直答)': (d) => !d.tools.includes('use_rag'),
    })

  // ---------- S2 B · createRagSubagent(mock retriever;期望委派链路 use_rag → search_docs) ----------
  if (willRun(2)) await switchMode(page, 'B · createRagSubagent')
  await sc(2, 'B · 子 agent 检索(mock retriever)',
    '产品价格是多少?退款政策是什么?',
    {
      '主 agent 委派 use_rag': (d) => d.tools.includes('use_rag'),
      '子 agent 调 search_docs': (d) => d.toolLog.some((l) => l.kind === 'sub' && /search_docs/.test(l.sub)) || d.toolLog.some((l) => l.name === 'search_docs'),
      '答出价格 ¥99/月': (d) => /99\s*元|¥\s*99/.test(d.reply),
      '答出退款政策(7 天)': (d) => /7\s*天/.test(d.reply),
      '子 agent 无失败重试风暴(错误类结果 ≤2)': (d) => d.toolLog.filter((l) => /检索出错|加载出错/.test(l.result ?? '')).length <= 2,
    })

  // ---------- S3 C · 子 agent + 真实 MCP(VITE_RAG_MCP_URL;链路 use_rag → search_docs → 远程 rag_search) ----------
  if (willRun(3)) await switchMode(page, 'C · 真实 MCP')
  await sc(3, 'C · 子 agent + 真实 MCP 检索',
    '方舟是什么?知识库里有哪些相关资料?',
    {
      '主 agent 委派 use_rag': (d) => d.tools.includes('use_rag'),
      '子 agent 调 search_docs(远程 rag_search)': (d) => d.toolLog.some((l) => l.name === 'search_docs' && !/检索出错/.test(l.result ?? '')),
      '回复非空且非编造兜底(有结论或诚实说未检索到)': (d) => d.reply.length > 20,
      '无失败重试风暴(检索出错 ≤2)': (d) => d.toolLog.filter((l) => /检索出错/.test(l.result ?? '')).length <= 2,
    })

  // ---------- S4 D · MCP 直连(mcp:[] 工具迟到注入主池,主 agent 直调不经子 agent) ----------
  if (willRun(4)) await switchMode(page, 'D · MCP 直连')
  if (willRun(4)) await waitMcpTools(page).then(
    () => console.log('  [D] mcp 工具已注入主工具池'),
    (e) => console.log('  [D] ⚠ mcp 工具注入超时(继续跑,可能走不了 MCP 链路):', String(e).slice(0, 120)),
  )
  await sc(4, 'D · MCP 直连(主 agent 直调 rag_search)',
    '帮我检索一下「方舟」相关的资料,总结知识库里有什么。',
    {
      '主 agent 直调 mcp 工具(rag_search/rag_ask/rag_documents)': (d) => d.tools.some((t) => /^rag_(search|ask|documents)$/.test(t)),
      '不经子 agent(零 use_rag)': (d) => !d.tools.includes('use_rag'),
      '回复非空': (d) => d.reply.length > 20,
    })

  await browser.close()
  const sum = summarize(report, OUT)
  return { suite: 'rag', report, OUT, ...sum }
}

/** 切模式:点按钮 → 等 rebuild 完成(新 __sdk 挂上 + 对话框重渲染) */
async function switchMode(page, label) {
  await page.click(`.mode-btn:has-text("${label}")`)
  await page.waitForFunction(() => {
    const el = document.getElementById('chat-root')
    return window.__sdk && el && el.querySelector('.chat-dialog')
  }, { timeout: 30_000 })
  await sleep(1500)
}

/** D 模式 MCP 后台握手:轮询等 mcp: 工具迟到注入主工具池(3.14 后台连接语义) */
async function waitMcpTools(page, timeoutMs = 30_000) {
  return page.waitForFunction(() => {
    const tools = window.__sdk?.inspect?.().tools ?? []
    return tools.some((t) => /^mcp:/.test(t.source ?? ''))
  }, { timeout: timeoutMs })
}

// 直接运行本文件时自执行(统一入口 real-llm.mjs import 时不触发)
const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirect) await runSuite()
