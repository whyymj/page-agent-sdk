# Specification Delta: page-agent-core

> 本文件为 change `html-agent-thinking-taming` 的增量 Requirement。3 个 Requirement(①task 规格化 / ②validate jsonPath / ③写前简述)。**minor**(向后兼容)。

## Requirement: 主 agent 委派 task 规格化

createHtmlSubagent 配套的主 agent 编排段(htmlPageOrchestrator)含【task 规格化】约束:委派 use_html 的 task 必须含 ① 组件定位(name)② 视觉风格 ③ 内容 ④ 交互意图;**不含技术实现**。收窄子 agent 决策空间,治理"任务定义开放致穷举"。

- **4 要素**:定位 / 视觉 / 内容 / 交互(技术实现 SVG vs CSS / keyframes vs transition 归子 agent)
- **示例**:❌「生成啤酒杯动画」→ ✅「啤酒杯倒酒(beer):金黄入透明杯,深绿背景,循环下落 2s,hover 放大」
- **子 agent 侧**:收规格后照做;task 缺规格则按字面意图选简单方案,不纠结风格
- **可测约束**:① htmlPageOrchestrator 含【task 规格化】条(4 要素 + 不含技术实现 + 示例)② 子 agent prompt 含"收规格照做"③(真 LLM)规格 task → 子 agent 不穷举装饰

## Requirement: validate_code 支持 jsonPath

validate_code 工具加 jsonPath 参数,从 data 读 code 校验(**零重传** content)。解新建组件 validate 的工具摩擦(token 纠结根因)。

- **schema**:validate_code({path?, content?, jsonPath?});jsonPath 与 content 同级(path 优先 vfs 文件,jsonPath/content 校验 data 路径或传入文本)
- **实现**:jsonPath → getController().get().bind → getByPath → validateHtmlFormat;路径不存在/非 string → 友好错误
- **时序**:getController 闭包延迟注入(createChatSdk 装配 _codeAsset 时,同 codeAssetMiddleware 源);createHtmlValidateToolsMiddleware 接收可选 getController
- **向后兼容**:旧 path/content 用法不变;jsonPath 新增可选
- **可测约束**:① validate_code({jsonPath}) 校验 data code 通过 ② jsonPath 不存在 → 友好错误 ③ 旧 path/content 零回归 ④(真 LLM)新建组件 validate 次数降(无需重传)

## Requirement: html agent 写前简述方案

htmlSystemPrompt 简洁思考段加「写前简述」:1-2 句方案(结构+关键技术)→ 实现 → 照做不权衡。治边写边纠结。

- **轻量**:子 agent 自言自语定方向,**不加交互轮**(非 plan→确认→实现)
- **与①协同**:①给视觉/交互规格,③简述技术方向,实现时两者都不再权衡
- **可测约束**:① htmlSystemPrompt 含写前简述条 ②(真 LLM)实现时权衡减少

> 原「无 html agent 降级」Requirement 已移至 `html-subagent-open-schema`(编排自适应注入的无 agent 分支)。
