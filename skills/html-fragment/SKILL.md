---
name: html-fragment
description: 完整 HTML 页面生成规范——代码作为 data 资产 / vfs 工作副本 / 完整自包含可独立成页 / script+CSS 集中放置 / 可引外部 JS/CSS / validate_code 自检 / 安全底线 / 可访问性
---

# HTML 完整页面生成规范

> 内置 skill(createHtmlSubagent 单模式 code-as-data-asset)。`createHtmlSubagent({ writablePaths })` 默认装进 HTML 子 agent;亦可独立分发,集成方 `defineSkill` 自挂。

## 代码资产模型(重要)

- 代码正文是 data 的 `code` 字段(资产,随 data json 进服务端 DB);UI 绑 `data.code` 渲染
- vfs 是编辑工作副本:框架自动 checkout(`data.code`→vfs 按 `__pgId`)/ commit(vfs→`data.code`),你只改 vfs
- `__pgId` 框架管(read 看不到、write 写不进),别碰

## 两条工作路径

- **修改已有组件**:必经 vfs(`vfs_read` → `vfs_edit` 增量改 → `validate_code`);勿直接 `write data.code`
- **新建组件**:`write({patch:{op:'set',jsonPath:'components.N',value:{...全字段}}})` —— value 按 data schema **全字段写**(必填字段如 `type` 不能漏;先 `read` 看现有组件结构照抄字段名),code 直接进 data,框架补 `__pgId`。固定流程 write → `validate_code({content})` → read 确认,**不手动 vfs_write 建副本**(框架下次委派自动 checkout)。`code` 字段直接写完整代码字符串,换行/引号照常写,无需手工 JSON 转义

## 输出:完整、自包含、能独立成页的 HTML

- 产物是**完整、自包含的 HTML 页面**(结构完整、标签闭合),能独立正确渲染。下游改造(抽 body / 包组件 / 片段化)由插件或 tool 做,不是你的事
- **交互逻辑默认用 `<script>` 实现**(完整页面含 script 是常态);仅当用户明确要求「纯 CSS / 不要 script」时不写
- **CSS 用 `<style>` 块、script 用 `<script>` 块集中放置**(如 `<head>` 内),不散落内联 —— 便于下游工具提取成独立 html/css/js
- 可引入外部 JS / CSS(CDN 组件库、字体、外链样式)按需使用;class 统一加前缀防冲突(如 `.pg-hero-…`)

## 标签闭合(必须)

- 非自闭合标签必须成对闭合(`<img>` / `<br>` / `<input>` 等 void 元素除外)
- 每次生成/修改后调 `validate_code` 自检(只校验结构合法性),报错用 `vfs_edit` 修正后复查,直到通过
- `validate_code` 也会被返回前门禁(verify beforeReturn)二次扫一次,不通过会回灌自纠

## 何时写代码组件

- 组件库**无对应类型**(高度定制布局 / 一次性专题页 / 特殊视觉效果)→ 写完整 HTML 页面
- 组件库**已有**(按钮 / 卡片 / 列表)→ 用现有组件配置,不重造

## 安全底线(必须)

- 禁 `eval` / `new Function` / `Function` 构造器
- 禁访问 window 敏感属性(`document.cookie` / `apiKey` / `token`)

## 可访问性 + 语义化

- 语义化标签(`button` / `nav` / `section`);图片 `alt`;交互可键盘聚焦
- 颜色对比达标;不只用颜色传达信息

## 提交策略

- **新建组件**:`write` data(`code` 字段直接进,框架补 `__pgId`);固定流程 write → `validate_code({content})` → read 确认,**不手动 vfs_write 建副本**(框架下次委派自动 checkout);`code` 直接写完整代码字符串,换行/引号照常写,无需手工 JSON 转义
- **修改组件**:必经 vfs —— `vfs_read` 看现状 → `vfs_edit` 增量改(不 `vfs_write` 重写整个文件,防丢既有内容);框架 afterAgent 自动 commit 回写 `data.code`
- 大段代码:`vfs_edit` 增量拼(避免单次输出超 max_tokens 截断)
- 删除组件:`write` del `components.N`(data 项移除 → 框架 afterAgent 孤儿清理删 vfs 工作副本)
