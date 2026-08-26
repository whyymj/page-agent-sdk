# Tasks: render-check(评审修订版)

- [x] 组合 VerifyCheck:渲染检查并入 createHtmlFormatCheck 单一 check(结构不过短路渲染;实现位于 createHtmlSubagent `if (formatCheck)` 块内,不加第二中间件);检查内容 = 闭包 getController 直读 bind + 消息流提取本轮 write 新建路径(覆盖「新建走 write 不经 vfs」缺口)—— 新建路径实现为「bind-vfs 差集」(比消息流猜 index 稳:checkout 过的必在 vfs,缺位即本轮新建),`composeStructureThenRender` 单 check 早返回
- [x] 组件级隔离渲染:每 code 资产独立沙箱 iframe(srcdoc + sandbox="allow-scripts" 三无)+ 离屏定位(display:none 不可用 → visibility:hidden + fixed)+ 用后销毁(getSandboxLifecycle 计数可观测);检查面 = 本轮 touched + 新建(天然 ≤2,maxTargets=4 防御截断 + 留痕)
- [x] 采集:collector 注入 + 握手 postMessage(per-check nonce + event.source 校验;零信号≠通过)+ console/window.onerror/unhandledrejection + 捕获相 error 资源失败(不用 performance responseStatus)+ 指标(节点数/body scrollHeight/图片数 —— documentElement.scrollHeight 恒≥视口高不可用,实测纠正为 body 口径);storage 类 SecurityError 降 warn
- [x] 收集窗:活动静默启发式(resource entry/DOM 变动重置 900ms 计时)+ 硬上限 4s(超时有信号按信号判,零产出才 unavailable)
- [x] node 守卫:`hasRealDom()`(createElement+body 判定 —— 只看 `typeof document` 会被 e2e 桩穿透,node e2e 实测崩 iframe.remove 后修正)门禁跳过渲染段保留结构段 + observable 留痕(`render_check_skip`);headless 同守卫;存量 capability-packs e2e 零回归(957/0)
- [x] CSP 检测:securitypolicyviolation 监听(降观察)+ 握手超时 → S4 降级「检查不可用」(browser e2e route 注入 CSP 响应头实证)
- [x] selftest:sec-104 归一纯函数 + 降级三态 + 注入位置 + 检查面组装 + 结构短路(30 断言;桩 runner 注入时跳过 DOM 守卫)
- [x] e2e(node):门禁链降级断言(capability-packs 零回归);e2e(browser):render-check.spec ×7(好/坏 script/白屏/异步 reject/404 资源/iframe 销毁/CSP 注入降级 + demo 集成 fail→回灌→修复→复检闭环,demo 暴露 __htmlDemoSdk 用 debugLogs 实证门禁触发)
- [ ] 真 LLM:坏 script 自检-修复-复检 ≤2 次预算(含降级不假绿)—— **待环境**(LLM 网关可用时跑;mock 链 + 真沙箱 browser 覆盖已实证机制,真 LLM 验证行为面:弱模型对渲染 feedback 的自纠质量)
- [x] deferred 登记:S4 主 agent 验收工具 + 整页组装钩子(带触发条件)
- [x] usage-guide 中英「渲染自检」段(沙箱边界/异步漏报/预算共享)+ CHANGELOG Added
- [x] 门禁:npm test && build && test:e2e && test:browser 全绿(2947/0 · 957/0 · 111/111)
