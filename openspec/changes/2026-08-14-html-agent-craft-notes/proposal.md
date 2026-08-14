# Change: html-agent-craft-notes(组件工匠笔记 + 主 agent 偏好转述:子 agent 跨委派积累"懂它")

> 状态:proposal(未实施)。**minor**(向后兼容)。M 规模。

## Why

用户需求:① html agent 各自持续维护一个纯代码组件(同组件的修改交给"懂它"的一方)② 聊天内容由主 agent 分析后,给提示与建议到子 agent。

现状分析(与需求对齐):
- **代码持久已解决**:code 是 data 资产(进服务端 DB)+ vfs 工作副本每次 checkout,子 agent 每次看到完整代码 —— 不丢
- **真 gap = 设计意图不持久**:每次 `use_html` 委派是全新子 agent 实例,「为什么这么设计 / 用户说过什么偏好 / 踩过什么坑」每次从零重建。真 LLM 思考日志(test.md beer-effect 610 行)中相当部分是在重新发明"这个组件该怎么组织"
- **主 agent → 子 agent 传递只覆盖当轮**:task 规格化 4 要素 + 转述用户反馈,不含历史偏好

不做常驻子 agent(上下文跨轮存活):harness 大改(maxDepth/授权面/生命周期),token 持续累积还得压缩,收益与笔记重叠。**状态放数据里,不放实例里** —— 与 code-as-data-asset 哲学同构。

## What Changes

**① 组件工匠笔记(`__pgNotes`,默认开,`craftNotes:false` opt-out)**
- **存储**:组件对象上 `__pgNotes: string[]`(最近 K=5 条,每条 ≤200 字),与 `__pgId` 同侧车机制:`__pg*` read 投影隐藏(agent 看不到原始字段)、框架直改 bind 不经 write(**无需 schema extend** —— 不同于 `__pgId` 需 safeParse 不剥离而 extend)
- **沉淀(afterAgent)**:子 agent 收口回复中提取 `[note] ` 前缀行(约定行,如 `[note] 液面用 height keyframes 4.2s 循环;装饰仅灯串+光斑`),append 到本轮 touched 组件的 `__pgNotes`(FIFO ≤5)。无 `[note]` 行不沉淀(不硬造低质笔记)
- **注入(augmentPrompt)**:「组件代码文件地图」每组件加一行 notes(最近 1 条 + 总数),委派同组件的下一个子 agent 天然看到"前任的交接"
- **子 agent 侧约定**:htmlSystemPrompt 加「收尾回复末尾附 1 行 `[note] 实现要点`(关键设计决策/踩坑/用户偏好,给下次维护者)」

**② 主 agent 偏好转述(orchestratorPrompt 提示词)**
【委派 task 规格化】条补一句:task 末尾若聊天上下文中有与该组件相关的用户历史偏好/反馈(如「用户偏好深色系」「上轮嫌动画太快」),提炼一句附上。

## Impact

- 改动:`codeAssetMiddleware.ts`(沉淀 + 地图注入)/ `htmlSubagent.ts`(子 prompt `[note]` 约定 + `craftNotes` opt)/ `presets.ts`(②转述句)/ `createChatSdk.ts`(`_codeAsset` 透传 craftNotes)/ `dataOps.ts`(supplementPgId 处 `__pgNotes` 保留核对:LLM write 整对象替换时笔记与 `__pgId` 同路径保留)
- 测试:selftest(中间件层:提取/FIFO/截断/注入/read 隐藏)+ e2e capability-packs(stub 二次委派见笔记)+ browser(html-page-demo mock)[+ 真 LLM 复验]
- 文档:README 中英 / doc/usage-guide 中英 / CLAUDE.md / CHANGELOG

## 决策

1. **`__pgNotes` 走 sidecar 字段而非 vfs 文件 / 内存 Map**:随 data json 进服务端 DB → 跨会话/跨设备持久;vfs 文件刷新即丢,Map 不持久
2. **无需 schema extend**:框架 afterAgent 直改 bind(setByPath,不经 write/safeParse);read 投影隐藏 `__pg*` 现成。agent 自己写不进(`__pg*` 段 isPathAllowed 拒)
3. **沉淀用 `[note]` 前缀约定而非全文入库**:子 agent 收尾回复多是「已生成 xxx」低信息文本;约定行让子 agent 显式压缩为可复用要点,质量可控 + 框架提取零歧义
4. **FIFO 5 条 × 200 字**:注入面每组件 1 行(最近 1 条 + 计数),全文按需扩(地图只给最近 1 条防 token 膨胀)
5. **不做常驻子 agent**:见 Why
6. **默认开**(`craftNotes` 默认 true):开箱即用原则;注入薄(每组件 1 行)

## Non-goals

- 不做常驻子 agent / 子上下文跨轮存活
- 不做笔记的 LLM 压缩/摘要(纯 FIFO 截断;LLM 压缩待实测膨胀再加)
- 不做跨组件全局偏好库(②只在 task 转述,不建独立存储)
- 不做主 agent 可读笔记(read 投影保持隐藏;主 agent 的"建议"走 task 转述即 ②)
