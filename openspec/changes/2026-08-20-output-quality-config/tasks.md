# Tasks(output-quality-config,按依赖序;目标仓库 editor_fangzhou;已过怀疑论评审回改)

> ⚠️ 范例/思考模型名阻塞用户输入;Phase 0(评审 P0 补)无阻塞可先行。

## Phase 0:验收前置(无阻塞,可先行)

- [ ] editor AiAssistant 挂 dev-only `window.__sdk = this.sdk`(评审 3-1:验收脚本以 window.__sdk 为就绪条件,editor 现无暴露,不补则 Phase 3 跑不起来)
- [ ] 验证:`UISPEC_BASE=http://local.smzdm.com:8565 node tests/runtime/_real-llm-lib.mjs` 冒烟(能等到 __sdk、能取 inspect/usage)

## Phase 1:范例填充(阻塞:用户挑专题)

- [ ] 用户挑 2-3 个高质量线上专题 → 编辑器导出 `window.Editor.nodeInfo` JSON(child 保留 3-5 区块,过长 props 截断)
- [ ] 用户挑 1-2 个高质量 compCode 的 `props.htmlCode` 完整值
- [ ] **拆双 skill** 填入 `exemplars.js`:page-tree-exemplars(页面树)/ code-component-exemplars(纯代码);每范例附看点批注(模块划分/文案具体化/间距节奏)
- [ ] **体积预算 ≤30KB**(评审:超 offload 阈值会外存 vfs 指针,few-shot 静默失效)
- [ ] 验证:双 skill 自动注册(load_skill 列表可见)+ 编排提示含「参照范例」段 + **debugLogs 验证 load_skill 工具结果为全文形态**(非 vfs 引用,评审)

## Phase 2:思考模型配置(阻塞:用户提供模型名)

- [ ] 用户确认网关可用思考模型(thinking 版 deepseek / claude;flash 无效)
- [ ] `ai-llm.local.js` 配 htmlSubagent.llm(**baseUrl 引用式写法照抄 config.js:59 示例,同源代理绕 Clash,勿写死绝对地址**)+ thinkingMode:'deep'
- [ ] 验证:**主判据 = DebugDrawer 可见子 agent 思考输出(reasoning)**;辅助 = inspect().subagent.subagents[].thinkingApplied === 'applied'(评审主次对调:网关可能剥离 extra_body.thinking,SDK 侧注入成功不等于生效)

## Phase 3:真 LLM 对比验收

- [ ] 同 prompt(世界杯专题页)跑旧配置 vs 新配置,**各 ≥3-5 次**;**每跑新会话**(storage:'indexed' 跨刷新恢复 + resumeNotice 干扰,评审)
- [ ] 采集:组件数/层级(list_components 快照)、占位文案扫描、token/耗时(sdk.usage)、委派规格遵循度
- [ ] **一等指标(评审补)**:范例 load 率(debugLogs load_skill 被调)/ 失败率回滚次数(add_component_tree failed+COMPONENT_BUSY+预检拒)/ 子 agent 委派成功率(use_html 数 vs commit 成功数)
- [ ] 人工评视觉层次(截图对比)
- [ ] 结论写入本 change(归档时)+ 若提升不显著 → 分析(模型/thinking 是否真生效/范例是否被 load —— 按上述一等指标排查,防误判「范例无用」)

## Phase 4:归档

- [ ] 验收通过 → change 归档,editor 配置固化到环境配置文档(生产 config 与本地分离说明;__sdk 暴露保持 dev-only)
