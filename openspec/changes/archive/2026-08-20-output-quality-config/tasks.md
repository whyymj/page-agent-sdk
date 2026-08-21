# Tasks(output-quality-config,按依赖序;目标仓库 editor_fangzhou;已过怀疑论评审回改)

> ⚠️ 范例/思考模型名阻塞用户输入;Phase 0(评审 P0 补)无阻塞可先行。

## Phase 0:验收前置(无阻塞,可先行)

- [x] editor AiAssistant 挂 dev-only `window.__sdk = this.sdk`(评审 3-1:验收脚本以 window.__sdk 为就绪条件,editor 现无暴露,不补则 Phase 3 跑不起来)——2026-08-21 已挂,NODE_ENV=development 门控 + beforeDestroy 清理
- [x] 验证:`UISPEC_BASE=http://local.smzdm.com:8565 node tests/runtime/_real-llm-lib.mjs` 冒烟(能等到 __sdk、能取 inspect/usage)——2026-08-21 PASS(Playwright 等价路径:`window.__sdk` 挂载即就绪,67 keys;登录态过期一度阻塞,用户补 token 后通过;产物 /tmp/exemplar-verify/)

## Phase 1:范例填充(阻塞:用户挑专题)

- [x] 用户挑 2-3 个高质量线上专题 → 编辑器导出 `window.Editor.nodeInfo` JSON(child 保留 3-5 区块,过长 props 截断)——2026-08-21 用户提供 1 个线上真实专题(test.json,197KB/9 区块/12 组件类型);**1 个已填,后续用户再挑可追加**(范例文件头有维护步骤)
- [x] 用户挑 1-2 个高质量 compCode 的 `props.htmlCode` 完整值——同一专题内取「头图双视频切换」compCode(htmlCode 1002 字 + jsCode 655 字,含交互逻辑,真实线上)
- [x] **拆双 skill** 填入 `exemplars.js`:page-tree-exemplars(页面树)/ code-component-exemplars(纯代码);每范例附看点批注(模块划分/文案具体化/间距节奏)
- [x] **体积预算 ≤30KB**(评审:超 offload 阈值会外存 vfs 指针,few-shot 静默失效)——树范例 9872 字符紧凑 JSON + 代码范例 2197 字符;offload 阈值按模型上下文自适应(flash 1M 窗口 → 20000 字符),双双安全
- [x] 验证:双 skill 自动注册(load_skill 列表可见)+ 编排提示含「参照范例」段 + **debugLogs 验证 load_skill 工具结果为全文形态**(非 vfs 引用,评审)——2026-08-21 全 PASS:inspect().skills 含双 skill 且旧名单数不存在;page-tree-exemplars load_skill 结果 10883 字符全文(含 markdown 头 +「超值大牌专区」,无 vfs_read/已外存字样);systemPrompt 两处观测到引导段;agent 复述正确(9 区块/双视频切换)。附带:零工具收尾门禁在纯查询轮正常回灌事实清单,未误执行写操作

## Phase 2:思考模型配置(阻塞:用户提供模型名)

- [x] 用户确认网关可用思考模型(thinking 版 deepseek / claude;flash 无效)——2026-08-21 网关实测:deepseek-v4-pro 支持 thinking 且默认出 reasoning_content(deepseek-v4/claude/gpt-4o 等均 400)
- [x] `ai-llm.local.js` 配 htmlSubagent.llm(**baseUrl 引用式写法照抄 config.js:59 示例,同源代理绕 Clash,勿写死绝对地址**)+ thinkingMode:'deep'——改走 config.js DEFAULT_HTML_SUBAGENT 默认配置路径(随 8368810 提交,免 ai-llm.local.js;ai-llm.local.js 覆盖链路仍可用)
- [ ] 验证:**主判据 = DebugDrawer 可见子 agent 思考输出(reasoning)**;辅助 = inspect().subagent.subagents[].thinkingApplied === 'applied'(评审主次对调:网关可能剥离 extra_body.thinking,SDK 侧注入成功不等于生效)

## Phase 3:真 LLM 对比验收

- [x] 同 prompt(世界杯专题页)跑旧配置 vs 新配置,**各 ≥3-5 次**;**每跑新会话**(storage:'indexed' 跨刷新恢复 + resumeNotice 干扰,评审)——2026-08-21 v5 跑完 3+3(`tests/runtime/quality-compare-real-llm.mjs`,aiBaseline=1 开关分新旧,每轮独立 context;期间排掉 3 个套件坑:approval 挂起自动处理/方案征询自动应答/idle 判定去消息计数化)
- [x] 采集:组件数/层级(list_components 快照)、占位文案扫描、token/耗时(sdk.usage)、委派规格遵循度
- [x] **一等指标(评审补)**:范例 load 率(debugLogs load_skill 被调)/ 失败率回滚次数(add_component_tree failed+COMPONENT_BUSY+预检拒)/ 子 agent 委派成功率(use_html 数 vs commit 成功数)
- [ ] 人工评视觉层次(截图对比)——报告含回复全文,截图留待用户抽查
- [x] 结论写入本 change(归档时)+ 若提升不显著 → 分析(模型/thinking 是否真生效/范例是否被 load —— 按上述一等指标排查,防误判「范例无用」)

**Phase 3 结果(2026-08-21,`_real-llm-quality-compare.json`)**:

| 指标 | 旧配置(flash 全量,3 轮) | 新配置(范例+v4-pro,有效轮 1、2) | Δ |
|---|---|---|---|
| 组件数 | 8 / 10 / 6(均 8.0) | 11 / 13(均 12) | **+4(+50%)** |
| 层级 | 恒 2(全平铺) | 2 / 3(run2 破层) | 破平铺但不稳定 |
| 类型多样性 | 6.7 | 7.5 | +0.8 |
| 范例 load 率 | 0/3 | 3/3(全文注入 3/3) | 管道全通 |
| 委派(成功率) | 1/1/2(全 done) | 1/1(__pgId 修复后链路健康) | 持平 |
| 占位文案 | 0 | 0 | 持平(双低) |
| prompt token | ~580K | 613K/324K | 持平 |

- **new run 3 为废数据**(1.2min/1 组件/279 tok:LLM 代理黑洞 + 重试耗尽残轮,已标注不计入结论)
- **一等指标排查结论**:范例 load 3/3 全文注入(非 vfs 引用)→ 范例确实生效;委派链路经 3.40.2 `__pgId` 修复后两组全部 done → 委派非瓶颈;层级提升不稳(run1 仍平铺)→ 剩余短板在 flash 主编排「组装纪律」而非范例/思考深度,后续可考虑编排 prompt 补容器结构引导(另行立项)
- 过程副产品:3 个真 LLM 实测驱动的 SDK 修复(3.40.2 `__pgId` 委派零落地 P0 / 3.40.3 状态询问零核实门禁 / 套件 approval-方案-idle 三坑)

## Phase 4:归档

- [ ] 验收通过 → change 归档,editor 配置固化到环境配置文档(生产 config 与本地分离说明;__sdk 暴露保持 dev-only)
