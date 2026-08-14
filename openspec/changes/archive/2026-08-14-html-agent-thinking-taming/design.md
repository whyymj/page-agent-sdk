# Design: html-agent-thinking-taming

## 1. 根因分析(真跑数据)

complex-demo 青岛啤酒节场景(deepseek-v4-flash)两轮真跑:

| 根因 | 真跑数据 | 已做的先行迭代(纳入本 change) |
|---|---|---|
| ① 任务开放 | task「生成啤酒杯动画」→ 撕边穷举(gradient/clip-path/conic 多方案) | 视觉装饰不穷举约束 → 重跑 gradient/clip-path/conic **归零**(✓ 验证有效) |
| ② 工具摩擦 | validate_code 重传 content 纠结 → vfs_write 12 / validate 15(应 ~2) | validate content 强化(部分缓解,未根治) |
| ③ 边写边纠结 | 已有「机械决定一次定」仍违反 | 简洁思考段(未完全治) |
| ④ 模型放大 | deepseek-v4-flash 指令遵循弱 | (本 change ④文档) |

## 2. 方案① 主 agent 结构化 task

### htmlPageOrchestrator 加【task 规格化】条(presets.ts)
委派 use_html 时,task 必须含 4 要素:
1. **组件定位**(by name / 索引)
2. **视觉风格**(配色 / 质感 / 字体)
3. **内容**(文案 / 数据 / 图片)
4. **交互意图**(动效 / 状态变化 / 触发)

**不含技术实现**(SVG vs CSS / keyframes vs transition 归子 agent)。

示例:
- ❌「生成啤酒杯动画」
- ✅「啤酒杯倒酒(组件 beer):金黄啤酒从上方倒入透明玻璃杯,深绿背景,液体循环下落动画 2s,hover 时杯子轻微放大」

### 子 agent prompt(htmlSubagent.ts)
收到含规格的 task 后:照规格实现(视觉/内容/交互按 task),技术实现自行定(选成熟模式,不穷举)。若 task 缺规格(主 agent 漏写),按 task 字面意图选一个简单方案实现,不纠结「该用什么风格」。

### 效果
任务从"开放设计"降为"按规格实现",子 agent 决策空间骤降 → 撕边/装饰穷举自然消失(已部分验证:视觉装饰约束让 gradient 归零)。额外好处:多个 custom 风格协调(主 agent 掌整页主题)。

## 3. 方案② validate_code 支持 jsonPath

### 现状(createHtmlValidateToolsMiddleware,htmlSubagent.ts)
validate_code 工具 schema:`{path?, content?}`。path 校验 vfs 文件;content 校验传入文本。**新建组件后 vfs 未检出** → 只能 content(重传完整 code)→ 子 agent 纠结 token。

### 改:schema 加 jsonPath
```
validate_code({ jsonPath?: 'components.3.code' })  // 从 data 读 code 校验,零重传
```
实现:`jsonPath → getController().get().bind → getByPath(bind, jsonPath) → validateHtmlFormat(content)`。

### 时序(关键设计)
- createHtmlSubagent 装配期创建 validate 中间件,**此时无 dataOpsController**(controller 在 createChatSdk 装配后期建)
- codeAssetMiddleware 同样需要 controller,用 `getController` 闭包延迟引用(createChatSdk 装配时注入)
- **方案**:createHtmlValidateToolsMiddleware 接收可选 `getController`;createChatSdk 装配期识别 `_codeAsset` 后,把建 codeAssetMiddleware 的**同源 getController** 注入 validate 中间件
- 实现路径:`_codeAsset` 标记的子 agent middleware 列表里,validate 中间件持 `getController` 可变槽;createChatSdk 装配时(codeAssetConfigs 处理,line 871-878 附近)遍历该子 agent middleware,给 validate 中间件注入 getController(若它声明需要 jsonPath 能力)

### htmlSystemPrompt
新建组件后:`validate_code({jsonPath:'components.N.code'})`(零重传,直读 data)。修改组件(已 checkout):`validate_code({path})`(vfs 文件)。②实施后,原 validate content 强化条简化为「优先 jsonPath(新建)/ path(修改),content 仅兜底」。

### 效果
消除新建组件 validate 的重传摩擦 → token 纠结根除(②是工具根治,①③ 提示词在它之上)。

## 4. 方案③ 写前简述(htmlSystemPrompt)

简洁思考段加条:
> 「写代码前,先用 1-2 句简述方案(结构 + 关键技术选择,如"啤酒杯用 SVG,倒酒用 CSS animation")→ 再直接实现。简述即定方向,实现时照做,不再反复权衡其他写法。」

替代"边写边纠结"。不加交互轮(简述是子 agent 思考输出,非回传主 agent)。与①协同:①给了规格(视觉/交互),③简述技术实现方向,实现时两者都不再权衡。

## 5. 方案④ 模型对比(文档)

doc/usage-guide.md(+.en)补:
- html 子 agent 代码生成任务,推荐较强指令遵循模型(deepseek-v4 / claude / gpt-4o)
- flash 类弱模型(deepseek-v4-flash 等)放大过度思考(撕边穷举 / token 纠结),①②③ 约束改善有限
- 集成方按成本/质量权衡选模型;高频/大批量代码生成场景建议非 flash

CLAUDE.md 子 agent 段记:真 LLM 调优复盘(flash 过度思考现象 + ①②③ 治理 + 模型因素)。

## 6. 与 html-subagent-open-schema 关系

| change | 解决 |
|---|---|
| html-subagent-open-schema(proposal) | 主 agent 有编排知识(职责/委派/路由)+ 开放 schema code 字段位置 |
| **本 change(思考治理)** | 编排知识含 task 规格化 + 子 agent 思考收敛(工具+提示词) |

递进:编排自动注入是地基(主 agent 知道要委派 + 怎么路由),①task 规格化是细化(委派时 task 写得好)。①改 htmlPageOrchestrator 内容,**无论编排手动 spread(staged,complex-demo 当前用法)还是自动注入都适用**,独立于 open-schema 实施进度。

## 7. 风险矩阵

| 风险 | 概率 | 影响 | 回退 |
|---|---|---|---|
| ①主 agent 写不好规格(不懂视觉?) | 中 | task 规格差 → 子 agent 仍纠结 | 主 agent 给业务意图(配色/内容/交互),非技术;示例引导;真 LLM 验证 |
| ②getController 注入时序错 | 中 | validate jsonPath 失败 | 复用 codeAssetMiddleware 同源 getController;selftest 锁往返 |
| ③简述仍纠结(flash 弱) | 高 | 改善有限 | ④换强模型;③是辅助非根治 |
| 规格 task 变长致 token 增 | 低 | task token 增 | 规格简练(4 要素各半句);task 增远小于思考省 |
| ②改 validate 中间件影响 verify 门禁 | 低 | 门禁回归 | jsonPath 是 validate_code 工具新参,verify beforeReturn 门禁(扫 vfs)不变;selftest 锁 |
