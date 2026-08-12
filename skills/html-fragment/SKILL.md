---
name: html-fragment
description: 纯 HTML 片段(v-html 注入)生成规范——代码作为 data 资产 / vfs 工作副本 / 无外围标签 / 单根元素 / 标签闭合 / validate_code 自检 / 安全底线 / 可访问性
---

# HTML 片段生成规范

> 内置 skill(createHtmlSubagent 单模式 code-as-data-asset)。`createHtmlSubagent({ codeKind:'html' })` 默认装进 HTML 子 agent(v-html 注入场景);亦可独立分发,集成方 `defineSkill` 自挂。与 `html-builder`(Vue SFC 形态)对称。

## 代码资产模型(重要)

- 代码正文是 data 的 `code` 字段(资产,随 data json 进服务端 DB);UI 绑 `data.code` 经 v-html 渲染
- vfs 是编辑工作副本:框架自动 checkout(`data.code`→vfs 按 `__pgId`)/ commit(vfs→`data.code`),你只改 vfs
- `__pgId` 框架管(read 看不到、write 写不进),别碰

## 两条工作路径

- **修改已有组件**:必经 vfs(`vfs_read` → `vfs_edit` 增量改 → `validate_code`);勿直接 `write data.code`
- **新建组件**:`write({patch:{op:'set',jsonPath:'components.N',value:{name,code,props}}})` —— code 直接进 data,框架补 `__pgId`

## 输出契约(必须)

- 输出经 **v-html 注入**宿主页面的 HTML 片段:**不要** `<!DOCTYPE>`,**不要** `<html>` / `<head>` / `<body>` 外围标签,只输出内容片段本身
- **单根元素**包裹(如 `<section class="hero">…</section>`),语义化标签
- **不写 `<script>`**(v-html 注入不执行脚本,且有安全风险);交互交宿主页面已有机制
- 样式用片段内 `<style>`,class **统一加前缀**防冲突(如 `.pg-hero-…`)
- 不引入外部脚本 / CDN / 外链样式

## 标签闭合(必须)

- 非自闭合标签必须成对闭合(`<img>` / `<br>` / `<input>` 等 void 元素除外)
- 每次生成/修改后调 `validate_code` 自检,报错用 `vfs_edit` 修正后复查,直到通过
- `validate_code` 也会被返回前门禁(verify beforeReturn)二次扫一次,不通过会回灌自纠

## 何时写 HTML 片段

- 组件库**无对应类型**(高度定制布局 / 一次性专题页 / 特殊视觉效果)→ 写 HTML 片段
- 组件库**已有**(按钮 / 卡片 / 列表)→ 用现有组件配置,不重造

## 安全底线(必须)

- 禁 `eval` / `new Function` / `Function` 构造器
- 禁访问 window 敏感属性(`document.cookie` / `apiKey` / `token`)
- 不引入外部脚本 / CDN

## 可访问性 + 语义化

- 语义化标签(`button` / `nav` / `section`);图片 `alt`;交互可键盘聚焦
- 颜色对比达标;不只用颜色传达信息

## 提交策略

- **新建组件**:`write` data(`code` 字段直接进,框架补 `__pgId`)
- **修改组件**:必经 vfs —— `vfs_read` 看现状 → `vfs_edit` 增量改(不 `vfs_write` 重写整个文件,防丢既有内容);框架 afterAgent 自动 commit 回写 `data.code`
- 大段代码:`vfs_edit` 增量拼(避免单次输出超 max_tokens 截断)
- 删除组件:`write` del `components.N`(data 项移除 → 框架 afterAgent 孤儿清理删 vfs 工作副本)
