---
name: html-builder
description: 纯代码组件(custom Vue SFC)生成规范——代码作为 data 资产 / vfs 工作副本 / 何时写 / SFC 规范 / 安全底线 / props / 组件库引用 / 可访问性
---

# 纯代码组件生成规范

> 内置 skill(createHtmlSubagent 单模式 code-as-data-asset)。createHtmlSubagent 默认装进 HTML 子 agent;亦可独立分发,集成方 `defineSkill` 自挂。

## 代码资产模型(重要)

- 代码正文是 data 的 `code` 字段(资产,随 data json 进服务端 DB);UI 绑 `data.code` 渲染
- vfs 是编辑工作副本:框架自动 checkout(`data.code`→vfs 按 `__pgId`)/ commit(vfs→`data.code`),你只改 vfs
- `__pgId` 框架管(read 看不到、write 写不进),别碰

## 两条工作路径

- **修改已有组件**:必经 vfs(`vfs_read` → `vfs_edit` 增量改 → `validate_code`);勿直接 `write data.code`
- **新建组件**:`write({patch:{op:'set',jsonPath:'components.N',value:{name,code,props}}})` —— code 直接进 data,框架补 `__pgId`

## 何时写代码组件

- 组件库**无对应类型**(高度定制交互 / 一次性特效 / 特殊布局)→ 写 custom 代码组件
- 组件库**已有**(按钮 / 卡片 / 列表)→ 用现有组件配置,不重造

## Vue SFC 规范

- Vue 3 `<template>` + `<script setup>`(组合式)
- props 用 `defineProps`;事件用 `defineEmits`
- 只渲染 UI,不做副作用(不发请求 / 不读写 storage)

## props 定义

- 代码组件 `defineProps` 接受外部 data 传入(集成方渲染时按 data 的 `props` 字段传)

## 组件库引用

- 代码内可 import 组件库组件(如 `<Button>`);所用依赖以集成方渲染层已注入为准,不重复造

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
