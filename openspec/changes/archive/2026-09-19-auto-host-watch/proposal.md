# auto-host-watch:宿主变更自动报案(hostWatch 声明式监听)+ dom_edit 写后页面读失效

> **状态**:✅ 已实施(2026-09-19,随 4.21.0 发布;10/10 任务勾,commit dc41ad9/master ed017ad;服务端边界加固见装配边界段;2026-09-19 归档)。
> 来源 = host-integration-contract S2(`notifyHostChange`)落地后的复盘:S2 的失效机制本身可靠,但**触发全靠宿主手动调**——两处真空(下文勘察);另 dom_edit(4.17)写后旧页面读不失效。定级 minor(新选项 + 默认开行为联动,纯加法)。与 content-proposals 互不依赖,体量与 action-host-semantics 相当。

## 现状勘察证据

- **真空 1:漏报案无感知**。SDK 对宿主导航**零监听**(`rg hashchange|popstate|pushState src/core` 零命中,2026-09-19 核实)——宿主哪天加个新入口忘了调 `notifyHostChange()`,S2 防线整体失效且不可观察(旧文照答,排查靠猜)。学习门户(4.18 集成)目前靠 `openDocument` 里手动调,是"防线靠人记得"形态。
- **真空 2:agent 自己改页面不失效**。`dom_edit`/`dom_restore` 在写驱动失效的排除清单里(`readInvalidation.ts:39 EXCLUDED_WRITE_TOOLS`,排除理由 = 其"路径"是 CSS selector 非数据 jsonPath,`pathsOverlap` 套不上)——AI 改完页面,此前的 `read_page`/`get_dom` 结果仍是改前旧文;页面断言门禁按"调过页面读"计数,拿旧文断言新页不会被拦。
- **既有先例可平移**:S2 失效是"无路径重叠判定、页面全域生效"(宿主换页对页面全域过期);dom_edit 写对页面读是同款全域关系,粗粒度全失效即成立,不需要 selector 级路径运算。数据槽侧的对应哲学 = 写驱动失效**默认开**(SDK 自知写,零误伤)。

## 修法(两段式)

### S1 `hostWatch` 顶层选项(声明式自动报案,配置即开关)

```ts
createChatSdk({
  hostWatch: true,                    // 简写 = { url: true }
  // 或细配:
  hostWatch: {
    url: true,                        // 原生 hashchange + popstate(零 patch,默认项)
    pushState: true,                  // 增强:patch history.pushState/replaceState(hashless SPA 路由;链式保留,unmount 还原)
    title: true,                      // MutationObserver 观察 document.title(不改 URL 的换文站;噪声高故 opt-in)
    debounceMs: 300,                  // 窗口内多事件合并为一次报案(默认 300)
    ignore: (e) => false,             // 宿主自定义忽略:e = { kind: 'hash'|'pop'|'push'|'title', from, to }
  },
})
```

- **纯注入 watcher 工厂**:`createHostWatcher({ target, history?, document? }, onReport)` 依赖注入事件源(selftest 可测,不依赖真 window;node 环境 `typeof window === 'undefined'` → 静默不装配,e2e 可 fake)。
- **触发即转 `notifyHostChange({ reason })`**:reason 自动生成(如 `页面导航:#/a → #/b` / `页面标题已变更`,截断)——S2 既有链路(流内占位 + 一次性 pin 段 + 幂等去重)原样复用,本 change 零新失效逻辑。
- **去抖合并**:窗口内连续事件(路由切换常伴 hash+title 连发)只报一次;**与宿主手动调共存**:手动调与自动报在去抖窗口内合并,窗外各自生效(占位幂等,双报无叠加危害)。
- **默认不开的理由**:「什么算换页」是业务判据(编辑器自动保存不改 URL 不该触发;评论区局部刷新也不该)——声明式让宿主自己背书"我的站 URL 变 = 换页",零惊喜;`hostWatch: true` 覆盖 hash 路由文档站主场景(学习门户即此形态,可删手动调用)。
- **观察面**:debugLogs `stage:'host_watch'`(每次自动报案留痕 kind/from/to)+ `inspect().hostWatch`(装配态 + autoNotified 累计)。unmount 摘监听/还原 history patch/断开 observer。
- **服务端/headless(Node)边界(2026-09-19 立项评审补,用户点名)**:
  - **逐 API 特性探测,不做整体 typeof window 一刀切**:url 需 `window.addEventListener` 函数;pushState 需全局 `history.pushState` 函数;title 需 `document` + `MutationObserver` 三者齐 —— 各自不满足只关该项(不弃整个 hostWatch),**静默降级不打扰**(同构配置浏览器/服务端共用一份,服务端 no-op 是合法形态;`inspect().hostWatch` 反射各项装配结果供集成方确认,不发 console.warn 制造噪声)
  - **pushState patch 的多层装卸次序陷阱**:多 SDK 实例(shareContext/多 agent)都 patch 时形成链(A 包原函数,B 包 A)。卸载守卫:dispose 只在 `history.pushState === 自己的 patch` 时还原(被后来者覆盖则让位,后来者 dispose 时还原到 A 的);**每个 patch 函数体内自查 disposed 标志** —— 已 dispose 的层退化为纯透传(不再报案,原样调用下层),杜绝「A 先卸 → B 还原出 A 的死 patch → 调用已卸实例的回调」经典错序 bug。patch 保持 `this` 透传、参数原样、返回值原样
  - **dispose 卫生**:摘监听/断 observer/还原 patch 之外,**取消在途去抖定时器** —— 否则 unmount 后 300ms 内迟到的事件触发对已卸 core 的 `notifyHostChange`(对已 unmount 实例调用虽是 no-op,但持引用阻止回收且语义脏);onReport 侧再加 disposed 兜底
  - **SSR/打包安全**:watcher 工厂零模块级全局引用(依赖全注入),装配层的 `window/document/history` 访问全部在函数体内且带 typeof 守卫 —— Vite SSR/Next 直出产物 import 不炸(server-companion 同构形态)

### S2 dom_edit 写后页面读失效(默认开,无开关)

- dom_edit 批量应用成功(非 dryRun、非 throw)与 dom_restore 回滚成功后:置**本轮待失效标记**,下一轮模型调用前把既有页面读结果(有效集 = 默认五工具 ∪ `readsHostState` 标记,与 S2 同源)替换为过期占位(reason:`agent 已通过 dom_edit 修改页面,此前读取为改前状态`)。
- **不复用 notifyHostChange 的 pin 段**:agent 自己经手的写,工具结果里已带改了什么,再注「宿主页面已变更须重读」是噪声——只做流内占位替换,不 bump hostChangeState 的 notices。
- 与数据槽写驱动失效同哲学:SDK 自知写、默认开、零配置(方向宁重读勿旧答);`EXCLUDED_WRITE_TOOLS` 对数据路径失效的排除**保持不变**(selector 不进 jsonPath 运算,只是新增独立的页面域失效)。

## 设计决策点

- **D1 为什么不做内容指纹轮询(不立项留痕)**:定时 hash 正文/MutationObserver 盯全树 = 4.18 设计时已否决的路线——成本高、误伤大(评论刷新/倒计时/局部重渲染全触发),且"局部变化算不算换页"无通用判据。本 change 的监听面(URL/title)是**宿主自己背书的换页信号**,语义明确。
- **D2 pushState 为何 opt-in 而非 url 默认项**:patch 全局 history 有第三方库共存风险(埋点/APM 同款手法,链式保留但仍是侵入);hash 路由站(主场景)原生事件已覆盖,无 patch 需求。
- **D3 title 为何 opt-in**:title 噪声(未读数 `(3)`、定时器文案)高于 URL;仅给"不改 URL 的换文站"兜底,配去抖消化。
- **D4 纯锚点不忽略**:hash 路由本身就是锚点形态(`#doc=xxx`),通用层面无法区分"路由锚点"与"章节锚点"——交给 `ignore` 钩子(宿主最清楚自家 `#section` 形态);默认宁多报(多报代价 = AI 重读一次,方向安全)。
- **D5 S2 不给开关**:写驱动失效(数据槽)自 3.42 起默认开无开关,同族行为对齐;误伤面为零(agent 自己的写,时序确定)。
- **D6 服务端零冒犯是一等约束**(用户立项评审点名):headless/Node(server-companion 形态)下 hostWatch 必须是无害 no-op 且**可反射确认**;S2 dom_edit 联动本身消息级(DOM 无关),node e2e 假 DOM 跑得通;去抖定时器/dispose 语义在无 window 环境同样成立。

## 范围红线

- 不做内容指纹/全树 MutationObserver(D1);不做跨 tab/visibilitychange 联动(场景未证实);不监听 fetch/XHR(越权猜测业务语义)。
- 不改 S2 失效机制本体(占位文案/epoch 水位/pin 段语义原样);不动 EXCLUDED_WRITE_TOOLS 的数据路径判定。
- hostWatch 不进 `capabilities`(配置即开关,同 actions/proposals 哲学)。

## 验收门禁

- selftest:createHostWatcher 纯函数面(hash/pop 触发/去抖合并/ignore 过滤/pushState patch 装卸还原链/reason 生成截断/node 无 window 静默);S2 占位替换复用断言(既有 effectivePageReadTools 面不改)。
- e2e:fake window 事件源 → 自动报案 → 末轮请求占位 + `stage:'host_watch'` 留痕 + `inspect().hostWatch.autoNotified`;手动+自动共存去抖合并;unmount 后监听摘除(再发事件零报案);dom_edit 成功 → 此前 read_page 占位 + **无 pin 段**(system 不含「宿主页面已变更」)/ dryRun 不失效 / dom_restore 同款。
- browser:docs-demo 增 `hostWatch: true`,真 hashchange(切 hash → 自动占位)1-2 项。
- 门禁全绿 + 计数同步;发布前询问用户。
