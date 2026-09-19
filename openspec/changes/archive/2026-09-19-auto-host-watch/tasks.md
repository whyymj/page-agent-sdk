# Tasks:auto-host-watch

> 打勾标准:代码/文档落地 + 对应测试绿 + 计数同步。单 commit 收口(改动面集中)。

## Phase 1:watcher 纯函数域(S1 内核)

- [x] 1. `src/core/sdk/hostWatcher.ts`:`createHostWatcher` 依赖注入工厂(hashchange/popstate / pushState patch / title MutationObserver / 去抖合并 + ignore / reason 生成);零模块级全局引用(SSR import 安全);`handle.info` 反射实际装配面。**实施注记:多层 patch 卸载在实现中从「守卫让位」升级为「链根追踪」** —— patch 打 `__pgHostWatchRoot` 标记携带链根,还原直接回链根;守卫让位方案(selftest 5 首版实测暴露)会让 B 卸载还原出 A 的死层(虽已透传无害,但永久残留)—— 链根方案终态干净还原到原函数
- [x] 2. selftest sec-134(22 项):hash 触发/去抖合并 url 优先/重复同值不报/ignore/pushState 链式+dispose 还原/**双实例错序卸载终态 = 原函数**/dispose 取消在途去抖 + 卸载后零报案/title 触发/逐项降级/全缺返回 null/reason 截断

## Phase 2:装配与联动(S1/S2)

- [x] 3. `options.ts` `HostWatchConfig`(`hostWatch?: boolean | HostWatchConfig` 简写归一)+ createChatSdk 装配(mount 装/unmount dispose/重 mount 先 dispose;逐 API 特性探测经工厂 info 反射进 `hostWatchState`;state 载体作 buildCore 第三参穿透供 inspect —— **实施注记:buildCore/_createChatSdk 双作用域,声明须在 buildCore 调用前,首版 TDZ 编译错**);双 d.ts + 三入口类型导出(主包/headless 双侧 + createChatSdk/index 中转)
- [x] 4. 观察面:debugLogs `stage:'host_watch'`(kind/from/to)+ `inspect().hostWatch` `{enabled,url,pushState,title,autoNotified}`(配置存在才出现;未配置 undefined)
- [x] 5. S2:`domEditTools` 装配点 onEdit 落地判定(非 dryRun 且 applied>0)+ `createDomEditTools` 新增 `onRestore` 回调(restored>0)→ `selfPageEditPending` → hostNotice 中间件 wrapModelCall 前置占位替换(有效集与 S2 同源;专用 reason;不 bump epoch/notices);EXCLUDED_WRITE_TOOLS 数据路径判定不动
- [x] 6. selftest 覆盖并入 e2e(dom-edit 增段:dryRun/throw 不触发、restore 同款在 e2e 链路断言)

## Phase 3:e2e / browser / 文档

- [x] 7. e2e `host-watch.mjs`(fake window 事件源注入,globalThis.window 换装还原):流内 hashchange 自动报案全链(占位+pin 段+留痕+反射)/手动+自动双报幂等/ignore/未配置零反射/unmount 摘监听;dom-edit.mjs 增段:dom_edit 落地→read_page 占位+无 pin 段+dryRun 对照。**实施注记两则**:①去抖定时器(宏任务)与 stub 模型微任务链有竞速,probe 工具内等 10ms 消除(真浏览器 LLM 往返 ≫ 去抖窗,无此竞速);②node e2e 假 window 只派发单事件,真浏览器 hash 导航**连发 hashchange+popstate**,去抖合并取最新 → kind 为 'pop' —— browser 断言不断言 kind(信息性字段)
- [x] 8. docs-demo `hostWatch: true` + browser spec 1 项(真 hashchange → reflection+留痕;unmount 后零新增)。**实施注记:debugLogs 挂在懒构造的 agent 上**,spec 先 mock send 一轮再验;drawerHidden 形态消息行不可见,wait 锚用 `messages.length ≥ 2` 而非 waitForAgentIdle
- [x] 9. 文档四语侧:usage-guide §6.20「自动报案」段中英(选项表/各项语义/服务端边界/dom_edit 联动)/ README 中英(特性行 + options 行)/ CLAUDE.md(能力段 + 计数 + e2e 模块数 37 + selftest 模块数 129)
- [x] 10. CHANGELOG 4.21.0(minor)+ 计数同步(selftest 3716→3738 / e2e 1214→1229 / browser 169→170)+ 门禁:build/test 3738/test:e2e 1229/test:browser 170/exports 25/types 三项/size 6/计数对账/pack 25 files 全绿;**发布前询问用户**(待拍板)
