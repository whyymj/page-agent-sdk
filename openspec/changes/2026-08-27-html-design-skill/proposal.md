# Proposal: html-design-skill(createHtmlSubagent 内置 web-design-engineer 设计技能)

> 状态:**✅ 已实施(2026-08-27,随 develop 待发布)**。优先级 P2(输出质量增强,装配面零破坏 —— 纯 skill 注入)。
> 用户提问(2026-08-27):「createHtmlSubagent 能否内置 `~/Downloads/conardli-garden-skills-web-design-engineer`」。三项拍板:①排期 tool-surface-economy 之后;②**全量 vendoring**(主文 33K + references 29 文件 120K;立项时误记 35 文件,实为 29);③**默认挂载,`design:false` 可关**。

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

- **实测(2026-08-27 实施备案)**:全量 vendor 后各 JS 产物 +160~230K(ESM ~1032→1194K / headless ~457→673K / IIFE ~1999→2206K / legacy ~3021→3189K;gzip 影响约 +55-65K)。size-check 与 e2e headless 体积断言按新基线重校(+~10% 余量,留痕 tests/size-check.mjs 头注释)。
- **降级精选预案未启用**:proposal 原预案「超限降级精选 ~90K」在门禁突破时评估过 —— 用户拍板②「全量 268K vendor」是显式决策、优先于内部体积阈值,且精选(~+95K)仍超当时 headless 600K 阈值,降级收益不成立;维持全量,阈值重校(如需回退:砍 style-recipes 至 6-8 代表配方 + 重跑 scripts/gen-design-skill.mjs 的精选模式需自行改造)。
- `npm pack` 核对通过(25 files,designSkill 源码在 src/ 不入包,vendored 内容编译进 dist)。
- `npm pack` 核对不误带源目录。

## 验收门禁

- selftest:design skill 装配断言(默认挂/`design:false` 不挂/自定义替换/references 目录含 35 项 + INDEX 描述行);load_skill 主文含适配三处嫁接文案锚点。
- e2e:subagents 模块补 design 反射(inspect 或装配面)。
- browser:html-page demo 回归零破坏(design 默认挂后子 agent 行为不劣化 —— mock LLM 不真用 skill,跑通装配即可)。
- 真 LLM:html-page 或 complex-demo 观察项(委派是否主动 load_skill + 产出质量主观对比);不设硬阈值,观察报告留档。

## 真 LLM 观察项备案(tasks #10,2026-08-27,html-page-demo + deepseek 网关,报告 local/design-skill-observation.json)

- **轮一(规格全简报「Linear 风格定价卡片:暖深色/发丝线/单强调色」)**:子 agent 不 load_skill,直接 read→write→validate_code 照规格落地;产出对题(暖深色 #141210 / 1px 发丝线 / 单琥珀强调色 / 三档定价)。符合 skill 自身规则「task 已规格化 → 照做」—— 渐进披露不强制加载,正确。
- **轮二(模糊简报「风格要有高级感,方向你来定」)**:子 agent **首个动作即 `load_skill('web-design-engineer')`**(33K 主文进上下文)再走生成流 —— 描述引导触发路径真 LLM 验证成立。
- **轮一暴露的引导缺陷(已修)**:主 agent 曾试图自己 load 子 agent 侧的 skill 被拒(「skill 库中未收录」)—— 编排引导措辞已补「挂在子 agent 侧,你自己 load 不到也不必尝试」。
- 附带发现(非本 change 面):demo 既有数组含同名组件时新委派产物重名(components.1/2 同名 features),主 agent 能正确发现处理;命名冲突防呆可另行立项。

## 非目标

- 不改 skills 中间件机制(references 通道现成,零改动)。
- 不内置其它 garden-skills(后续按需)。
- 不做 design skill 与 focus/craftNotes 的深度联动(craftNotes 已有交接机制,自然共存)。
- React/依赖构建类指引保留原文但不承诺支持(子 agent 场景天然产出 vanilla HTML,不删原文段落 —— 保留 fork 可辨识性,降低上游 diff 维护成本)。
