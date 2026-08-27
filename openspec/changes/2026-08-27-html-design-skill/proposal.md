# Proposal: html-design-skill(createHtmlSubagent 内置 web-design-engineer 设计技能)

> 状态:**📋 已立项待实施(排期:tool-surface-economy 之后)**。优先级 P2(输出质量增强,零行为破坏面 —— 纯 skill 注入)。
> 用户提问(2026-08-27):「createHtmlSubagent 能否内置 `~/Downloads/conardli-garden-skills-web-design-engineer`」。三项拍板:①排期 tool-surface-economy 之后;②**全量 268K**(35 文件)vendor;③**默认挂载,`design:false` 可关**。

## 动机

html 子 agent 现状是「能落地」(buildHtmlFragmentSkill 管 schema/生成规范/校验),缺「设计品味」—— flash 类模型产出趋同(Inter 字体/蓝紫渐变/大圆角卡片/emoji 图标)。上游 skill(ConardLi garden-skills `web-design-engineer` v1.2.2,**MIT**)恰好治这个:反俗套规则清单 / oklch 感知均匀配色 / 设计系统先声明再写码 / 20+ 风格配方(muji、apple-hig、raycast、bloomberg-terminal…)/ critique-guide 自评。与现有内置 skill 分工:**design 管品味,htmlFragment 管落地规范**,并列挂载。

## 机制(全部现成,零新基建)

- **挂载通道**:`createHtmlSubagent({ skills })` 已通(subagent.ts:142 → `createSkillsMiddleware(opts.skills)`);已有内置默认 skill 先例(`buildHtmlFragmentSkill`,skills 未传时自动挂,htmlSubagent.ts:358/372/382 的 usedDefaultSkill 形态)。
- **多文件形态 1:1**:`SkillSpec.references`(skill-references)注释明说「与磁盘 skill 的 SKILL.md + references/ 形态 1:1,26 个配方式大 skill 渐进式披露」—— load_skill 主文进上下文,35 个参考按需单个取回,不整包灌。
- **许可**:MIT(README:461),随包分发合法;vendoring 时保留版权声明 + 上游链接 + 版本号。

## 设计

### 1. vendoring 形态

- 源:`/Users/wuhao/Downloads/conardli-garden-skills-web-design-engineer`(v1.2.2,github.com/ConardLi/garden-skills/skills/web-design-engineer)。
- 落位:`src/core/sdk/designSkill/` 目录,SKILL.md 与 references/ 原文转 TS 模板(内联字符串,getContent 闭包按需返回;不 fetch、不 vfs —— 子 agent 无网络依赖,离线可用)。
- attribution:`designSkill/` 顶部文件头注释(MIT + © ConardLi + 上游 URL + v1.2.2 + vendored 日期)+ CHANGELOG 说明 + README 致谢段。

### 2. 适配三处(fork 维护点,改 SKILL.md 主文,references 原样)

上游为 Claude Code 整页 artifact 场景写,SDK html 子 agent 是**委派制、无网、组件级自包含 HTML**:

| 上游步骤 | 不适配点 | 适配为 |
|---|---|---|
| Step 0 WebSearch 核实事实 | 子 agent 无网络工具 | 「事实以委派 task 为准;不确定的规格在收口报告如实标注,勿编造」 |
| Step 1 向用户提问补需求 | 子 agent 不能反问(只返回结论) | 「信息不足按保守高级默认执行,收口报告说明所做假设」 |
| 输出形态(整页 artifact/React/CDN) | SDK 是 data.code 资产 + vfs 工作副本 + 组件级自包含 | 主文嫁接一段「宿主环境」:自包含单文件、script/CSS 内联集中、经 validate_code 校验、委派收口即 commit |

### 3. API 面

- `createHtmlSubagent({ design?: boolean | SkillSpec })`:缺省 `true` = 挂内置 design skill;`false` 关闭(与显式 `skills` 传参互不冲突 —— design 追加在用户 skills 之后);传 SkillSpec = 替换自定义版本(集成方可自带改版)。
- **默认挂载的运行时成本**:system 索引仅多一行(name+description,~30 token);skill 全文只在子 agent 主动 `load_skill('web-design-engineer')` 时进上下文(渐进披露,references 再按需)。
- 行为变化 → minor 版本 CHANGELOG 注明。

### 4. 编排引导

html 子 agent 的编排 prompt(委派 task 规格化)已有先例;补一句:「设计/视觉类任务先 load_skill 设计技能再动手」(装 design 时才注入,提示随能力开关注入的既有口径)。

## 包体影响与门禁

- 全量 268K 内联进 TS → dist 增量(gzip 后预计 +60-80K,主包与 headless 双产物都含 —— createHtmlSubagent 在 core)。**size-check 门禁把关**:超限则降级精选(SKILL.md + 3 方法论参考 + INDEX + 6-8 代表配方,~90K),配方砍半属可接受损失(拍板已备案)。
- `npm pack` 核对不误带源目录。

## 验收门禁

- selftest:design skill 装配断言(默认挂/`design:false` 不挂/自定义替换/references 目录含 35 项 + INDEX 描述行);load_skill 主文含适配三处嫁接文案锚点。
- e2e:subagents 模块补 design 反射(inspect 或装配面)。
- browser:html-page demo 回归零破坏(design 默认挂后子 agent 行为不劣化 —— mock LLM 不真用 skill,跑通装配即可)。
- 真 LLM:html-page 或 complex-demo 观察项(委派是否主动 load_skill + 产出质量主观对比);不设硬阈值,观察报告留档。

## 非目标

- 不改 skills 中间件机制(references 通道现成,零改动)。
- 不内置其它 garden-skills(后续按需)。
- 不做 design skill 与 focus/craftNotes 的深度联动(craftNotes 已有交接机制,自然共存)。
- React/依赖构建类指引保留原文但不承诺支持(子 agent 场景天然产出 vanilla HTML,不删原文段落 —— 保留 fork 可辨识性,降低上游 diff 维护成本)。
