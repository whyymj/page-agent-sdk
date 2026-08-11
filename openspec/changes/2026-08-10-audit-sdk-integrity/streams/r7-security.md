# R7 安全面审计结果(audit-sdk-integrity · 基线 2.38.0)

> 范围:src/core/tools/{sandbox,hostScript,domTool,envTool,fetchDoc}.ts、src/core/composables/useMarkdown.ts、src/core/harness/skills.ts exec 分支、src/core/components/{MessageContent,CodePreview}.vue
> 所有 finding 均经代码逐行核实;不确定项已降级并标注「待验证」。

## Findings(严重度降序)

R7-1 | P1 | hang | src/core/harness/skills.ts:100,162 | readSkillDoc/fetchSkillScript 的 fetch 无超时/AbortSignal,远程 skill 文档/脚本服务端停滞 → load_skill 永久挂起拖死当轮 agent 循环 | 两处裸 `await fetch(...)` 无限等待无 signal 接入(abort 也断不了工具内 await);同仓 fetchDoc.ts:13-18 已有 30s AbortController 先例此处漏配 | 复用 FETCH_TIMEOUT_MS 模式加 AbortController(30s)+ 超时友好错误返回 | selftest 用永不 resolve 的 fetch stub + 假计时器,断言 load_skill 限时返回超时错误

R7-2 | P2 | security | src/core/tools/sandbox.ts:24-28,55-62 | 原型链逃逸现状仍可利用(浏览器相关,待浏览器实测):`(function(){}).constructor` 不在 6 条静态扫描模式内 → 构造 Function(不受 `self.Function=undefined` 影响)→ 经原型链取原生网络 API 外泄 data;行 27-28「网络锁兜底 Function 逃逸」注释宣称不成立(锁只 defineProperty 自有属性) | 行 24-25 自认「原型链 fetch 仍可达,只遮蔽自有属性不锁原型」;Firefox WebIDL 属性挂原型链该路确定可达,Chrome fetch 为自有属性此路或不可达但 WebTransport/RTCPeerConnection 等未锁 API 仍是潜在通道 | WORKER_PREAMBLE 增原型层锁定(对原型链上的网络 API 同样 defineProperty),或静态扫描追加 `.constructor`/`getPrototypeOf`/`Reflect`;修正行 27-28 注释 | browser 层断言「含 `(function(){}).constructor` 脚本被拒或原型层 fetch 不可达」

R7-3 | P2 | performance | src/core/composables/useMarkdown.ts:68 + src/core/components/MessageContent.vue:11,97 | marked+hljs+DOMPurify 全同步且无尺寸闸:流式下每个 delta 触发全文重解析,长回复总成本 O(n²),巨内容冻结 UI | `computed(() => sanitizeMarkdownHtml(marked.parse(content())))` 随 props.content 每 chunk 全量重算,无任何节流/截断 | 流式批量化(如 100ms 节流)+ 超长内容截断/分段渲染;hljs 懒高亮 | browser 补「≥200KB markdown 渲染不产生长阻塞」perf 断言

R7-4 | P2 | correctness | src/core/components/MessageContent.vue:54 | decodeURIComponent 无 try/catch:AI 回复原生 HTML `<pre class="code-block" data-code="%ZZ">` 可过 DOMPurify(data-* 放行)→ URIError 中断 enhanceCodeBlocks → 该消息当前及后续代码块全部丢失复制/下载/预览按钮 | 行 54 直接 `decodeURIComponent(pre.dataset.code || '')`;marked 不转义原生 HTML 块,DOMPurify 保留 pre.data-code;onMounted/onUpdated/watch 三处共用该函数 | try/catch 包裹,失败回退 dataset 原值或空串 | browser 补「畸形 data-code 不影响后续代码块 toolbar 注入」

R7-5 | P2 | security | src/core/tools/domTool.ts:20,64-67 | 属性防线只查 attr 名不查值:href/src 值里的 `?token=...&session=...` 敏感查询参数经默认白名单原样灌入 LLM 上下文 | DENY_ATTR_RE/DENY_ATTR_SENSITIVE_RE 仅对 a.name 生效(名侧防线已核实严格,sec-36 有断言);href/src 在 DEFAULT_ATTRS 内,值不扫描 | 对白名单属性值做敏感参数正则打码(token=***) | selftest 补「href 含 token 参数 → 值被打码」

R7-6 | P3 | security | src/core/composables/useMarkdown.ts:58-60 | ADD_ATTR 含 target/rel:AI 原生 HTML `<a target="_blank">` 被保留,reverse-tabnabbing 仅靠现代浏览器隐式 noopener 兜底(Chrome 88+),DOMPurify 不自动补 rel | SANITIZE_CONFIG 只加白名单无 afterSanitizeAttributes hook;marked 默认不产 target,仅原生 HTML 可带 | hook 中对 target=_blank 强制补 `rel="noopener noreferrer"` | xss-sanitize.spec 补 target 属性 rel 断言

R7-7 | P3 | test-blindspot | src/core/tools/sandbox.ts:81-127 | Worker 生命周期(创建/postMessage/超时→terminate/blob revoke)零断言:Node 无 Worker 全局,selftest/e2e 全部走静态扫描早返回与纯函数 lock,「超时 terminate」层无任何测试触达 | `node -e "typeof Worker"` = undefined;sec-21 沙箱用例均在创建 Worker 前返回;browser spec 无 eval_script 超时场景 | browser 层 mock LLM 触发 eval_script 死循环脚本 → 断言 ~3s 内返回 SCRIPT_TIMEOUT(dataOps.ts:632-636)且 worker 被 terminate | 同左

R7-8 | P3 | correctness | src/core/components/CodePreview.vue:36 | js 预览分支未转义 `</script>`(vue 分支行 48 有转义)→ 代码含该串时预览文档结构损坏 | 预览在 sandbox iframe(opaque origin,行 128 无 allow-same-origin),宿主安全不受影响,仅预览保真度 | 复用 `<\/script>` 转义 | 预览保真用例(可选)

R7-9 | P3 | performance | src/core/tools/fetchDoc.ts:24 | 无响应体大小闸:res.text() 全量读入后才走 offload,超大响应先吃满内存 | 无 Content-Length 预检,offload 发生在工具返回后(createAgent 层) | 预检 Content-Length 或分块读取设上限 | 手动验证项

R7-10 | P3 | doc-drift | src/core/tools/domTool.ts:20 | CLAUDE.md 称 get_dom 默认白名单「id/class/style/href + data-*」,实际 DEFAULT_ATTRS 11 项(另含 src/alt/title/role/aria-label/name/type) | 文档表述窄于实现(方向更宽非收紧) | 文档校准为实际列表 | —

R7-11 | P3 | security | src/core/tools/envTool.ts:74-77,104 | 默认开启的摘要原样输出 location.href/search(可能含 OAuth 回调 token 参数)进 LLM 上下文;window.name 不在 denylist 可读 | getEnvSummary 返回完整 href/search;ENV_DENY_KEYS(行 94)不含 name/location;key 读取主防线已核实严格(denylist+敏感命名双闸先判后读,sec-39 有断言) | 评估摘要 URL query 打码或文档化风险;name 加 denylist | 若采纳补 selftest 断言

## H10 证伪结论

**证伪目标成立:url+host 禁止校验真实存在且未发现绕过。**

- 校验点:executeSkillExec skills.ts:177-178 —— code/url 互斥 + `hasUrl && ctx==='host'` 明确拒绝(sec-05 有 3 条断言覆盖)
- capability gating 完整链:skills.ts:179-180 `hostScriptEnabled` 检查 ← createChatSdk.ts:1237 注入 `caps.skillHostScript` ← capabilities.ts:55 `defaultOn:false`(opt-in 默认关)
- 绕过面逐一排除:
  1. context 传非 'host' 任意值 → `?? 'sandbox'`(skills.ts:173)落沙箱,安全方向
  2. SkillPanel 用户创建 skill 只传 {name, description, getContent}(SkillPanel.vue submit),无法注入 exec
  3. PersistedSkill 只持久化 name/description/content(skillStore.ts),exec 无法跨刷新携带
  4. runHostScript 全仓唯一内部调用点即 skills.ts:181(index.ts:76 导出为集成方显式入口,属其自主选择)
  5. AsyncFunction 注入面仅接受集成方内联 code,受双闸(hostScriptEnabled + url+host 拒绝)保护,与文档承诺一致

## 核实无误项(无 finding)

- defineProperty 锁(lockSandboxGlobal)对 `delete self.fetch` / 赋值覆盖逃逸确已堵死(configurable:false + writable:false,sec-21 有断言)
- eval_script(dataOps.ts:633 → dataSlotQuery.ts:446)与 skill exec(skills.ts:193)确共用 createSandboxRunner 单一真相源;WORKER_PREAMBLE 经 lockSandboxGlobal.toString() 注入复用同一逻辑
- Worker 超时后 terminate + blob URL revoke 代码路径存在(sandbox.ts:84-93,119),无泄漏(但测试未触达,见 R7-7)
- fetchDoc 30s 超时 + AbortSignal + CORS 友好错误 + prompt-injection 围栏齐备(fetchDoc.ts:13-48)
- XSS 主链路健全:全仓唯一 v-html(MessageContent.vue:101)经 DOMPurify sanitize;data-lang 经 escapeHtmlAttr 转义(useMarkdown.ts:39,sec-51 有断言);CodePreview openInNewTab = sandbox iframe(无 allow-same-origin)+ blob + noopener,noreferrer(CodePreview.vue:90-105)
- eval_script 8000 字符上限 + 子树 >100KB 自适应 8s 超时(dataOps.ts:620,632)
- get_dom 硬 DENY(value/on*/srcdoc/formaction)+ 敏感命名 attr 排除,先白名单后 DENY 顺序正确(domTool.ts:61-71)
- envTool key 读取 denylist + 敏感命名双闸先判后读;safeSerialize 深度 3/键 50/串 2000/数组 100 闸齐备(envTool.ts:27-62,101-108)

## 总评

R7 安全面整体扎实——defineProperty 锁对 delete/赋值逃逸确已堵死、eval_script 与 skill exec 确共用单一真相源、fetchDoc 30s 超时与 openInNewTab sandbox+noopener 均到位、H10 双闸无绕过;最需修的是 skills 远程 fetch 无超时的挂死缺口(P1),其次为原型链逃逸的浏览器相关残留与流式 markdown 全量重解析性能(均 P2)。
