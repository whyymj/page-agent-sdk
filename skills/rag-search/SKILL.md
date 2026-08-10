---
name: rag-search
description: 多源知识检索策略——vfs 预注入文档 / 语义检索 / 指定文档加载 / 公网,综合结构化结论 + 溯源
---

# 知识检索策略(RAG)

> 内置 skill(add-capability-packs)。createRagSubagent 默认装进 RAG 子 agent;亦可独立分发,集成方 `defineSkill` 自挂。

## 多源决策树

- **vfs_grep / vfs_read**:搜集成方预注入 vfs 的文档(组件文档 / UI 规范)—— 快、静态,先查
- **search_docs**:语义检索(retriever 向量库)—— 模糊匹配,关键词不确定 / 语义相似时用
- **load_doc**:按 source 精确加载(已知文档 id / URL / key)—— 精确取特定文档
- **fetch_document**:公网 URL —— 查公开资料

## 综合规范

- 多源交叉验证(关键结论优先 ≥2 源印证,或单一权威源)
- 标注来源(文档名 / URL / 段落),便于溯源
- 结构化、可执行结论(组件清单 + 各自 props 约束 + 适用场景),不堆原文
- 未检索到明确说「未检索到」,不编造;建议替代方案(改关键词 / 建议写代码组件等)

## 何时用何源

- 静态文档(组件库文档 / UI 规范):`vfs_grep`
- 语义相似(「瀑布流组件」「倒计时」「拼团」):`search_docs`
- 已知文档 id / URL:`load_doc`
- 公开 URL(设计规范网站 / 第三方文档):`fetch_document`

## 多轮检索

- 单源不够时换源或换关键词重试(如 `search_docs` 没命中 → `vfs_grep` 换词)
- 扩大 `topK` 增加召回(噪声多时收小)
- 检索充分即综合结论,不过度检索
