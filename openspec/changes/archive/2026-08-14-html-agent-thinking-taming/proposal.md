# Change: html-agent-thinking-taming(治理 html 子 agent 过度思考:task 规格化 + validate jsonPath + 写前简述)

> 状态:proposal(未实施)。**minor**(向后兼容)。M 规模。

## Why

complex-demo 真 LLM 实测(青岛啤酒节场景,deepseek-v4-flash)暴露 html 子 agent 严重过度思考,致整页 5 分钟未完成 + token 巨耗:

- **撕边穷举**:子 agent 在「优惠券撕边/锯齿」对比 linear-gradient / conic-gradient / radial-gradient / clip-path 4+ 方案,耗数千 token(已加「视觉装饰不穷举」约束验证有效:重跑 gradient/clip-path/conic 归零)
- **validate token 纠结**:新建组件后 validate_code 只能传 content(重传完整 code,vfs 未检出)→ 子 agent 在「重传 vs 先 vfs_write 再 validate by path」上权衡 10+ 回合,vfs_write 12 / validate_code 15(应各 ~2)
- **边写边纠结**:已有「机械决定一次定」约束仍反复权衡实现写法

根因(三类叠加 + 模型放大):
1. **任务定义太开放**:主 agent task 仅「生成啤酒杯动画」,子 agent 设计空间无限(风格/装饰/技术全靠自己定)→ 纠结
2. **工具摩擦**:新建组件后 validate_code 只能重传 content(vfs 未检出)→ token 纠结
3. **边写边纠结 + 模型放大**:已有简洁思考约束仍违反;deepseek-v4-flash 指令遵循弱放大

## What Changes

**① 主 agent 结构化 task**(治根因①,ROI 最高)
htmlPageOrchestrator 加【task 规格化】条:委派 use_html 时 task 必须含 ① 组件定位(name)② 视觉风格(配色/质感)③ 内容(文案/数据)④ 交互意图(动效/状态)。**不写技术实现**(SVG vs CSS 仍子 agent 定)。示例:❌「生成啤酒杯动画」→ ✅「啤酒杯倒酒:金黄啤酒入透明杯,深绿背景,液体循环下落 2s,hover 放大」。子 agent 决策空间骤降 → 撕边/装饰穷举自然消失。

**② validate_code 支持 jsonPath**(治根因②,工具根治)
validate_code 工具加 `jsonPath` 参数,从 data 读 code 校验(`validate_code({jsonPath:'components.3.code'})`),**零重传**。解装配期时序:getController 闭包延迟注入(createChatSdk 装配 _codeAsset 时,同源注入 validate 中间件,同 codeAssetMiddleware)。

**③ html agent 写前简述方案**(治根因③,轻量)
htmlSystemPrompt 加「写代码前先用 1-2 句简述方案(结构+关键技术),再实现;简述即定方向,实现时照做不再权衡」。替代边写边纠结;**不加交互轮**(简述是子 agent 自言自语,非回传主 agent 确认)。

**④ 模型对比验证指引**(治根因③的模型放大)
doc/usage-guide 补「html 子 agent 推荐较强指令遵循模型(deepseek-v4 / claude);flash 类弱模型放大过度思考」。CLAUDE.md 记调优复盘。不强绑默认模型(集成方自选)。

> 原⑤「无 html agent 降级」已并入 `html-subagent-open-schema` 的「编排自适应注入 · 无 agent 自己写」分支 —— 降级是编排注入的一部分,归 open-schema 统一;本 change 聚焦思考治理①②③④。

## Impact
- minor:①③是提示词内容增强(presets/htmlSubagent),②是工具加参数(向后兼容,旧 content/path 用法不变),④纯文档
- 改动:presets.ts(①htmlPageOrchestrator)+ htmlSubagent.ts(①子 prompt + ③简述 + ②validate 中间件)+ createChatSdk.ts(②getController 注入)+ doc/CLAUDE.md(④)
- 已先行迭代(纳入本 change,已实施未 commit):视觉装饰不穷举约束(已验证 gradient/clip-path/conic 归零)+ validate content 强化(部分缓解,②根治后可简化)

## 决策
1. **①主 agent 给视觉/内容/交互意图,不给技术实现**:SVG vs CSS / keyframes vs transition 仍子 agent 定(主 agent 是编排 agent 非前端工程师,决策技术选型会出错)
2. **②validate_code jsonPath 走 getController 闭包延迟注入**:createChatSdk 装配期建 codeAssetMiddleware 时已有 getController,同源注入 validate 中间件(复用现有时序解法)
3. **③轻量简述(子 agent 自言自语定方向)**:非完整 plan→确认→实现(那会加交互轮,慢)
4. **④文档指引不强绑模型**:集成方自选;但记录 flash 类弱模型放大思考
5. **与 html-subagent-open-schema(编排自动注入)递进**:编排注入解决「主 agent 有编排知识」,本①解决「编排知识含 task 规格化」。①改 htmlPageOrchestrator 内容,无论编排手动 spread 还是自动注入都适用,独立于 open-schema 实施进度
6. **已做的视觉装饰 + validate 强化是先行迭代**,纳入本 change(视觉装饰已真实验证有效);②实施后,validate content 强化条可简化(保留 jsonPath 主路径)
7. **①规格化与 open-schema 自适应注入协同**:①改 htmlPageOrchestrator 内容(委派编排),open-schema 自适应注入用 htmlOrchestratorPrompt(id) 注入它;两者同源(都基于 htmlPageOrchestrator)。①先改内容,open-schema 注入该内容。原⑤降级移至 open-schema(编排自适应注入的无 agent 分支)

## Non-goals
- 不换默认模型(集成方自选,④仅文档建议)
- 不做完整 plan→用户/主 agent 确认→实现 交互(慢,③用轻量简述替代)
- 不重构 code-as-data-asset 搬运机制(F2 abort/timeout 兜底已做,独立 change)
- 不改主 agent 的 code 摘要机制(主 agent 看不到 code 细节是设计,①用"规格描述"替代"看代码")
