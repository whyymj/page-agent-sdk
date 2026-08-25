# Proposal: render-check(渲染级自检 —— 纯 H5 从「生成」到「开发」的质量闭环)

> 状态:**已实施待发版**(2026-08-24 实施完成:mock + 真沙箱 browser 门禁全绿 2947/957/111;真 LLM 场景待环境网关可用,机制面已由真沙箱实证。实施期修正两处:①白屏口径 documentElement.scrollHeight 恒≥视口高不可用 → body 口径;②node 守卫须判 createElement+body,e2e 桩 document 穿透纯 typeof 判定)。优先级 P1(SDK)。目标仓库:zhuanti-agent。
> 驱动:纯 H5 线已能产完整自包含页面,但质量验收停在**结构层**(formatCheck = validate_code 只验标签闭合)——「白屏 / script 运行时错 / 资源加载失败」靠人眼。SDK 本就跑在浏览器,沙箱 iframe 渲染检查**零新依赖**。

## Why(现状核实,复审纠正)

- formatCheck 默认开 = `validate_code` 工具自检(工具形态,LLM 主动调,middleware tools 注入)+ verify beforeReturn 门禁(`createVerifyMiddleware({check})` 包 check 不烧 LLM 轮,失败回灌 `verifyAttempts+=1`,预算前置检查在 createAgent:988)—— 两形态语义不同,本 change 只用**门禁形态**。
- 预算复用事实核实:`FORMAT_CHECK_MAX_ATTEMPTS=2` → formatCheck 默认 true → `maxVerifyAttempts=2` 透传 createAgent;`runBeforeReturn` **不短路**(正序全跑拼接 feedback)→ 「结构检过才渲染检」必须实现为**单个组合 VerifyCheck**(先 format,不过即早返回),不能加第二个 verify 中间件。
- SDK 数据模型无「页面树」:code 资产是 writablePaths 顶层扁平数组;非 code 组件由**宿主渲染器**渲染,SDK 无从合成整页;N 份完整自包含文档拼合会引入选择器/脚本冲突**假错**(评审阻断,整页组装移 deferred)。
- 沙箱先例:`CodePreview.vue` 已有 srcdoc + sandbox iframe + postMessage 形态;node 前科:`sanitizeMessageHtml` 3.22.1 无 DOM 崩溃 —— **存量 e2e(capability-packs)在 node 跑 dist 且直接命中 formatCheck 门禁链**,渲染检查不降级必炸。

## 场景(详细,复审修订)

- **S1 生成后自检自纠(标准闭环,门禁形态)**:html 子 agent 收口前,框架 VerifyCheck 对**本轮触达面**渲染检查 → 捕获 console error → 定位信息随 feedback 回灌 → 子 agent 修复 → 复检通过 → 收口。检查面 = 本轮委派 touched 的 vfs 组件(`state.__pgTouched`)+ 本轮 write 新建的组件(消息流提取,verify.ts extractWrites 先例)→ **天然 ≤2 个,无逐组件 ×N 耗时放大**。
- **S2 资源失败**:组件引用的图片 404 → 捕获相 error 事件(资源失败检测不靠 performance responseStatus —— 跨源不可见)→ 资源清单回灌 → 换源/删引用。
- **S3 疑似白屏**:body 子节点数异常少 / scrollHeight 为 0(script 挂了渲染中断)→ 与 console error 联合定位。指标口径 = 内容级 scrollHeight(iframe 无真实视口)。
- **S4 降级诚实(三类)**:①node/无 DOM(`typeof document === 'undefined'`,存量 e2e 必命中)→ 门禁跳过渲染段保留结构段 + observable 留痕;②collector 握手缺失(宿主 CSP 拦内联 script/iframe —— **零信号 ≠ 通过,防假绿**)→ 「检查不可用」诚实返回;③检查窗超时 → 原因返回。
- ~~S5 主 agent 验收复核工具~~ **砍除(评审裁决)**:新增主栈默认工具与 main-surface-slim 方向相逆,且收益与门禁重复;deferred 登记(触发 = 出现门禁覆盖不到的验收缺口)。

## 原理(复审修订)

- **门禁形态(唯一形态)**:渲染检查**组合进 `createHtmlFormatCheck` 同一 VerifyCheck**(先结构检、不过即短路渲染),实现钉死在 createHtmlSubagent 的 `if (formatCheck)` 块内(formatCheck:false 整链关停,零新开关);子 agent **不提供渲染工具**(3-5s/次检查不交 LLM 自决,防与门禁双轨烧轮次)。检查内容来源:闭包持 getController 直读 bind(_setGetController 注入先例)+ 消息流提取本轮 write 新建路径(vfs 扫描式恰好漏新建场景 —— 新建走 write 不经 vfs,checkout 下次委派才发生)。
- **组件级隔离渲染**:每个 code 资产独立 iframe(与其「可独立成页」形态一致,信号可归因);**不做整页组装**(无页面树/非 code 组件宿主渲染/拼合假错);宿主整页验收钩子另立 change。
- **沙箱与采集**:`srcdoc` + `sandbox="allow-scripts"`(无 allow-same-origin/forms/top-navigation);collector 注入 srcdoc(SDK 构造可控)+ **加载即发握手 postMessage**(短窗无握手 = 检查不可用);父侧校验 per-check nonce + `event.source === iframe.contentWindow`(opaque origin 下 event.origin==='null',不能只信 origin)。信号:①console error/warn(首条+行号可得则带)②window.onerror + **unhandledrejection**(异步 reject)③资源失败 = 捕获相 error 事件(跨源无关)④指标 = body 子节点数 / scrollHeight / 图片数。iframe **离屏定位**(position:fixed;left:-9999px;display:none 布局度量失真不可用);用后销毁。
- **收集窗 = 活动静默启发式**(活动重置型:每条 resource entry/DOM 变动重置 ~1s 计时;硬上限 3-5s 兜底;requestIdleCallback 与网络无关不作主信号)。异步晚到错误漏报为明示残余。
- **沙箱假阳性治理**:opaque origin 下 localStorage/sessionStorage/document.cookie 访问抛 SecurityError —— storage 类错误降 warn 不计失败,文档明示。
- **预算与墙钟**:maxVerifyAttempts=2 为结构自纠 + 渲染自纠**共享池**(复杂修复链可能提前耗尽 —— 零新配置的代价,缺点明示);最坏 3 次执行 × 3-5s ≈ +15s 委派耗时;复检只查失败组件缩短窗;并行委派双 iframe 并行互不阻塞。

## 优缺点(诚实盘点)

- **优点**:关掉「生成即坏」人眼验收类;纯增量零新依赖;门禁形态保证执行 + 预算复用;检查面收窄(本轮触达)无耗时放大。
- **缺点/风险(明示)**:①沙箱 ≠ 宿主环境(字体/宿主 CSS/网关;结论是「能否独立跑」非「长啥样」—— 与单模式自包含定位一致,受控);②异步晚到错误可能漏报(不承诺 100%);③**预算共享**:结构+渲染共池 2 次,复杂修复链提前耗尽;④storage 类 SecurityError 沙箱假阳性(降 warn 缓解,非根治);⑤+15s 级墙钟(复检收窄缓解);⑥宿主 CSP nonce 制下内联 script 被拦 → 握手缺失降级(该环境检查不可用,诚实明示)。
- **不做的**:视觉回归/截图比对;无头外环境模拟;主 agent 渲染工具(S4 砍除);整页组装(deferred:宿主提供组装函数的钩子形态另立)。

## 红线

- 零新配置:实现钉死 `if (formatCheck)` 块内;单组合 VerifyCheck(不加第二中间件);子 agent 不给渲染工具。
- node/无 DOM 强制降级(跳渲染段保结构段 + observable);握手缺失 ≠ 通过(防假绿)。
- 沙箱三无(无 same-origin/forms/top-navigation);nonce+source 校验;检查窗硬上限;降级诚实。
- 结果只做信号回灌不代行修改;预算内自纠。

## 验收门禁

- selftest:结果归一纯函数(信号→通过/失败/指引)+ 降级三态(node/CSP 握手缺失/超时)。
- e2e(node):门禁链降级断言(渲染段跳过、结构段保留)—— 存量 capability-packs 坏代码链零回归。
- e2e(browser):好 code 通过 / 坏 code(script throw)error 回灌 + 修复后复检闭环 / 白屏指标触发 / iframe 用后销毁计数 / CSP 注入(route 改响应头)→ 握手缺失降级。
- 真 LLM:注入坏 script 场景 → 自检-修复-复检 ≤2 次预算闭环(含降级路径不假绿)。
- 文档:usage-guide 中英「渲染自检」段(沙箱边界/漏报残余/预算共享)。
