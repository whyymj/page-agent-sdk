# Proposal: output-quality-config(生成质量配置落地:范例填充 + 思考模型 + 真 LLM 对比验收)

> ✅ 已实施,2026-08-21 验收收口随 editor 分支 `feature/FS-0000_ai功能增强_wh` 落地(commits 6b93479/e9713e5/04bc98f;SDK 侧配套 3.40.2 `__pgId` 修复 + 3.40.3 状态询问门禁)。
> Phase 3 对比结论(3+3 轮):新配置组件数 +50%(12 vs 8)、run2 破平铺层级(3 层分区容器,基线 3 轮恒平铺)、范例 load 3/3 全文注入、委派链路全 done;new run3 为代理黑洞残轮不计入。剩余短板(flash 主编排组装纪律,层级提升不稳)另行立项。

> 状态:**✅ 已实施并验收归档(2026-08-21)**。用户已提供 1 个线上真实专题范例 + 网关实测思考模型(v4-pro);双 skill 已填(树 9872 字符 + 代码组件 2197 字符,均低于 offload 阈值),思考模型经 config.js 默认配置落地(8368810)。优先级 P1。对应反思 G6:质量类用例(A-11/A-12/F-01 丰富度断言)对着 flash 基线跑必挂 —— output-quality-uplift(3.36.0)通了「管道」,本 change 通「电」。**目标仓库:editor_fangzhou**。

## Why(反思结论 G6,2026-08-20)

3.36.0 落地了质量提升的三根管道,但**全部处于空载状态**:

| 管道 | 现状 | 阻塞 |
|---|---|---|
| page-exemplars skill(few-shot 锚点) | `exemplars.js` 骨架,条件注册(空 = 不装) | 范例内容需用户挑真实高质量专题,**不可伪造业务数据** |
| 子 agent 独立模型 + 深思考 | `config.js` 配置位就绪(`aiHtmlSubagent`),缺省 `{}` = 继承 flash | 需用户提供网关可用的思考模型名(thinking 版 deepseek/claude) |
| 质量标准 prompt | ✅ 已生效(唯一不阻塞的) | — |

没有范例 + 没有深思考,「生成太简单」只会边际改善。这是用户最初诉求(「页面太简单,思考深度能否放宽」)的最终落点。

## What Changes

### 前置 0:editor 暴露 dev-only `window.__sdk`(评审 P0 补)

验收脚本 `tests/runtime/_real-llm-lib.mjs` 以 `page.waitForFunction(() => window.__sdk)` 为就绪条件,idle 判定/usage/inspect 全走 `window.__sdk` —— **editor 全仓库无任何 `__sdk` 暴露**(grep 零命中),不补则 Phase 3 全部跑不起来。editor AiAssistant 内挂 `window.__sdk = this.sdk`(dev-only 门控);`UISPEC_BASE` 指到 `http://local.smzdm.com:8565` 跑同一套脚本。

### 6a. exemplars 范例填充(阻塞:用户挑专题)

`exemplars.js` 填入,**拆两个 skill**(评审:PAGE_EXEMPLARS 是单字符串单 skill,页面树范例与代码组件范例混装会互相拉低相关度;editor 侧改动极小,「零代码」断言作废但代价低):
- **page-tree-exemplars**:2-3 个完整专题页 JSON 树(从编辑器 `window.Editor.nodeInfo` 导出;child 保留 3-5 个代表性区块,过长 props 截断)
- **code-component-exemplars**:1-2 个高质量纯代码组件 HTML(`props.htmlCode` 完整值)
- 每个附「看点」批注(模块划分/文案具体化程度/间距节奏)

**体积预算(评审补)**:全文 ≤30KB。skill 内容不做截断 —— 超过 offload 阈值的大 JSON 会**外存为 vfs 指针**,agent 看到的是引用而非全文,few-shot 锚定**静默失效**还得额外 vfs_read 轮次。「完整专题页 JSON 树」按「child 保留 3-5 区块、props 截断」执行。填充后跑一次 debugLogs 验证 load_skill 工具结果以全文形态呈现(非 vfs 引用)。

### 6b. 思考模型配置(阻塞:用户提供模型名)

`src/config/ai-llm.local.js`(gitignore,本地覆盖):

```js
export default {
  // htmlSubagent:主 agent 保持 flash 编排,代码生成换强模型 + 深思考
  htmlSubagent: {
    llm: { apiKey: '<网关key或占位>', baseUrl: <照抄 config.js 中 aiLlmConfig.baseUrl 的引用式写法>, model: '<思考模型名>' },
    thinkingMode: 'deep'
  }
}
```

- **baseUrl 不写死绝对地址(评审 3 风险)**:本地 dev 必须走 `${location.origin}/user-bff-api/api/llm` 形态的同源代理(绕 Clash);填绝对 BFF_ORIGIN 会被断连。照抄 `config.js:59` 注释示例的引用方式。
- 需用户确认网关可用思考模型(deepseek thinking 版/claude 等;flash 类传了无效)
- 代价提示:token/耗时约 2-5×(质量优先场景可接受)

### 6c. 真 LLM 对比验收(依赖 6a/6b)

同一 prompt(「设计一个世界杯专题页」)跑**旧配置(flash 全量)vs 新配置(子 agent 强模型+deep+范例)**,各 **≥3-5 次**(评审:LLM 方差下 2v2 无说服力);**每跑新会话**(editor storage:'indexed' 跨刷新恢复会话,resumeNotice 会注入「数据可能已变」干扰 prompt —— 必须新会话隔离)。指标:

| 指标 | 采集方式 |
|---|---|
| 组件数 / 结构层级 | list_components 前后快照 |
| 文案具体化(占位率) | 人工评 + 「标题1/xxx」模式扫描 |
| 视觉层次/间距 | 人工评(截图对比) |
| token/耗时 | sdk.usage + 墙钟 |
| 委派 task 规格遵循度 | inspect().subagent.history |
| **失败率/回滚次数(评审补)** | add_component_tree failed/errors 计数、COMPONENT_BUSY/预检拒次数 |
| **子 agent 委派成功率(评审补)** | use_html 调用数 vs commit 成功数 |
| **范例 load 率(评审补,一等指标)** | debugLogs 中 load_skill('page-tree-exemplars') 是否被调 —— 范例没生效会被误判为「范例无用」,必先排除 |

**thinking 生效判据(评审主次对调)**:**主判据 = DebugDrawer 可见子 agent reasoning 输出**(网关是否透传 `extra_body.thinking` 未知,方舟代理剥离未知字段的概率不低);`inspect().subagent.subagents[].thinkingApplied === 'applied'` 降为辅助(它只证明 SDK 侧参数注入,不证明网关透传)。

## Impact

| 项 | 变更 |
|---|---|
| editor AiAssistant(dev-only) | 前置 0:`window.__sdk` 暴露 |
| editor `exemplars.js` | 双 skill 拆分 + 范例内容(用户提供,≤30KB 预算) |
| editor `ai-llm.local.js`(gitignore) | htmlSubagent.llm(引用式 baseUrl)+ thinkingMode:'deep' |
| 验收脚本 | `tests/runtime/_real-llm-lib.mjs` 复用;对比报告 `_real-llm-quality-*.json`(gitignore) |
| 无 SDK 代码改动 | 纯配置/内容/验收 |

## 非目标(Non-goals)

- 不伪造范例业务数据(必须用户挑真实专题)
- 不改 3.36.0 已落地的管道代码(双 skill 拆分属 editor 侧装载微调,非管道改动)
- 不做自动质量评分(人工评为主,指标采集为辅)
