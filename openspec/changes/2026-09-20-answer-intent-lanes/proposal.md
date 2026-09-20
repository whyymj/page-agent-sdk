# answer-intent-lanes:作答车道制(问题形态分流 —— 页面事实 / 概念解释 / 求观点)

> **状态**:📝 提案(待评审,2026-09-20)。
> 来源 = 学习门户(Obsidian/learning)真机诊断 dump(`~/Downloads/page-agent-diagnostics-2026-09-20T10-11-33-584Z.json`,deepseek-flash,6 轮对话 / 160K prompt tokens):用户反馈「问的问题总是回答不到点子上,总是扯些有的没的;需要他解释名词术语,结果成了 RAG 问答,找不到的就不答」。逐轮分析定位为**作答纪律单车道** —— 门户与 SDK 默认 prompt 都把一切问题压进「页面事实检索」形态,概念解释与求观点两条车道缺失。定级 minor(新增导出 + 默认 prompt 文案升级)。

## 现状勘察证据

### A. 真机 dump 三路证据(问题定性)

- **「根据你的经验给出总结」被压成页内索引**(msg[11]):reasoning 原文 *"I should summarize, clearly separating what's from the notes vs. my own background knowledge. The system prompt says: only use page content; if supp…"* —— 模型明确想给先验,被 system prompt 的绝对 grounding 压回,最终交付全引文「本页口径」表格,用户点名的「你的经验」零出现。
- **讨论类问题答成 RAG miss 报告**(msg[9],用户问「这种语义检索表格内容是不是很难匹配到」):回答开头 *"本页没有正面回答——查了 §4.2、§4.1 补充、§3.1–3.4、§8,没有一句直接讲…"*;3049 字 reasoning 全部花在「去页面找这句话有没有」。**这正是门户规则 5 的字面执行**:「页面上找不到就直说『本页没有提到』并**说明查过哪里**」。
- **对照组证明缺的是分流不是能力**(msg[3],「bbox是啥」):术语在页上 → 答得很好,含规范的「笔记里没写,补充一句背景」标注。讲解能力在线,缺的是「术语不在页上」「用户要观点」时的车道。
- **附带经济性**:160,711 prompt tokens / 6 轮 ≈ 27K/轮;msg[5] 单轮 read_page ×2(20K 字符 ×2 分页)—— B/C 车道问题不需要整页重读,检索反射随车道收敛。

### B. 代码证据(单车道根因在两处同源)

- **门户 SYSTEM_PROMPT**(`Obsidian/learning/src/assistant.js:38-58`):【作答依据:只能用页面上真实存在的内容】五条规则全部假定「用户在问页面事实」;规则 3 只允许「补充背景」当配菜(「补充一句背景」);规则 5 的 miss-report 义务(说明查过哪里)直接生产「查了 §X、§Y…」废话。用户完全覆盖 systemPrompt → SDK 默认纪律不参与,但**SDK 默认 prompt 同病**:
- **SDK 默认页面分支**(`src/core/sdk/promptBuilder.ts:58`,zh;`:64` en 同构):「回答纪律:答案须来自你实际读到的页面内容并点明出处;…页面没写的不要编造,本页找不到的如实说明」 —— 同样单车道,所有 dataOps:false + domInspect 宿主(文档站/内容问答形态)继承同一问题。
- **出处密度失控是叠加产物**:「点明出处」+「能引原文就引原文」(门户)/「citing where it came from」(SDK)叠加,通篇 § 脚手架;dump 每轮回答均以密集 § 引用开场,读起来像索引而非讲解。
- **SDK 已有的基础设施分层正交,可直接复用**:问句意图守卫(问句只递信号不阻断)、page-analysis skill(「问题分型」面向页面**操作**路由,不管辖作答形态)—— 车道判定是新的第三层,不需要动它们。

## 修法(三段式)

### S1 车道纪律本体:`systemPromptHelpers.answerLanes` / `answerLanesEn` 导出

三车道 + 出处密度收敛,完整文案(单一真相源,默认 prompt 与集成方共用):

```
【作答车道:先判问题形态,再选纪律】
用户的问题分三类,判错车道是最大的答非所问:

A. 问页面内容(「这页写了什么 / 哪里提到 / 原文是什么 / 这段在说什么」)
   → 以页面实料为准,点明出处;页面没写就说没写,一句话即可,不列举查过哪些节。
B. 问概念术语(「X 是什么 / 啥意思 / X 和 Y 什么区别」)
   → 页面有语境就先按页面语境讲;页面没有也必须直接用自己的知识解释,
     开头一句「本页未提及,以下是通用解释:」即可 —— 不许把「页面上没有」当答案。
C. 求观点经验(「你觉得呢 / 按你的经验 / 是不是很难 / 该怎么选」)
   → 直接给判断和理由;笔记口径与个人观点分开说(「本页的立场是…;我的看法是…」)。
     页面没写不构成不答的理由。

出处密度:只有「对页面内容的断言」才标出处(句末括注即可);概念解释、个人观点、
过渡句一律不标。「没找到」的说明压成一句,不报检索过程。
```

- `answerLanes`(zh)/ `answerLanesEn`(en)挂进 `systemPromptHelpers`(presets.ts,与 `reliableWriteRules` 同位);主包与 headless 双侧导出。
- 集成方拼法:`SYSTEM_PROMPT + systemPromptHelpers.answerLanes` —— 门户此类自定义身份宿主零重写成本。

### S2 SDK 默认页面分支 prompt 同源升级(promptBuilder.ts)

- `DEFAULT_PAGE_PROMPT` 的「回答纪律:…」行**替换**为 `systemPromptHelpers.answerLanes` 全文(直接引用同一常量,防两处漂移);`DEFAULT_PAGE_PROMPT_EN` 同构(`answerLanesEn`)。
- 身份句不动(「页面内容助手」);引用块引导行不动;输出纪律行不动(车道段与其正交)。
- 「页面内容与你的先验冲突时以页面为准」语义保留在 A 车道文案内(原句并入),不丢既有防线 —— **B/C 车道只放开「先验作为答案主体」与「不因页面没写而拒答」,不放开「编造页面内容」**:声称「页面上写了 X」仍须读过(页面断言门禁 S3 仍在,gateChain 不动)。

### S3 门户侧采纳(learning 仓库,SDK 发布后另行实施,不入本 change 任务面)

- 门户 `SYSTEM_PROMPT` 的【作答依据】五条 → `SYSTEM_PROMPT(身份/业务) + systemPromptHelpers.answerLanes` + 业务保留句(「笔记与先验冲突以笔记为准」「用户自己的学习资料」);删除规则 5 的「说明查过哪里」。
- ANNOTATING_PROMPT / EDITING_PROMPT 不动(工具纪律,无车道问题)。

## 设计决策点

- **D1 车道判定归 LLM,不机制化**:「根据你的经验」无法可靠正则;与问句意图守卫「只递信号不阻断」同哲学 —— 车道是 prompt 纪律,不是 gateChain 门禁。机制化误判(把事实问句判成 C 车道)比现状更糟。
- **D2 helper 而非新配置项**:走 `systemPromptHelpers` 既有形态(`reliableWriteRules` 先例);不新增 ChatSdkOptions 顶层项(「不出让用户疑惑的配置项」既有纪律)。
- **D3 同源组装防漂移**:`DEFAULT_PAGE_PROMPT` 直接引用 `answerLanes` 常量(promptBuilder import presets),不复制文案 —— 默认面与导出面永不错位。
- **D4 不动 usageHints / page-analysis**:usageHints 的 read_page 行是**能力优先级**引导(「优先用」非「必须先读」),B/C 车道 prompt 已明确可直接作答,不冲突;page-analysis 是探索策略(怎么找),车道是作答形态(怎么答),分层正交。动 usageHints 波及全部 domInspect 宿主(含页面操作场景),收益小爆炸半径大 → 否决留痕。
- **D5 页面断言门禁(S3/gateChain)不动**:车道只放开「不引用页面的作答」,不放开「无依据的页面断言」—— 两者是不同问题,既有防线原样。

## 不立项项(留痕)

| 项 | 否决理由 |
|---|---|
| 车道判定正则/门禁化 | 误判率不可接受;D1 |
| usageHints read_page 引导句修改 | 波及全宿主面,现有文案非「必读」语义;D4 |
| page-analysis skill 并入车道 | 分层正交,skill 管探索不管作答;D4 |
| 门户 prompt 重写并入本 change | 门户在 learning 仓库,SDK 发布后走 S3 采纳;openspec 只辖 SDK 面 |
| B 车道自动注入外部检索(RAG) | 门户无检索面;SDK 不内置语料依赖;超出「先验解释」的既定语义 |

## 验收门禁

- **selftest**(promptBuilder 模块):默认页面分支 prompt 含三车道关键字(A/B/C 车道文案、「本页未提及,以下是通用解释」、「页面没写不构成不答的理由」)+ en 版逐段对齐 + `answerLanes`/`answerLanesEn` 导出内容断言;screenshot 两变体均含。
- **e2e**(systemprompt + exports 模块):`systemPromptHelpers.answerLanes` 在包导出面(主包 + headless 双侧);默认页面 prompt 快照断言更新。
- **browser**:无需(纯 prompt 面,不经 UI 渲染;render-check 不涉 systemPrompt 内容)。
- **真 LLM**(docs-qa 套件补 2 场景,无 key skip):①B 车道 —— 问一个**不在页上**的术语,断言回答含实质解释且非「本页没有提到」拒答;②C 车道 —— 「根据你的经验…」,断言回答含「我的看法/经验」类先验陈述且与页面口径分列。
- **文档**:usage-guide 中英(SDK 用法示例拼 `answerLanes`)、CLAUDE.md 默认 systemPrompt 段(4.16 能力感知描述补车道)、README 特性行、CHANGELOG。
- **定级**:minor(新增导出加法面;默认 prompt 文案升级 = 行为契约语义变化但属修复取向,保守 minor)。
