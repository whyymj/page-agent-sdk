---
name: html-builder
description: 纯代码组件(custom Vue SFC)生成规范——代码存 vfs+data 引用 / 何时写 / SFC 规范 / 安全底线 / props / 组件库引用 / 可访问性
---

# 纯代码组件生成规范

> 内置 skill(add-capability-packs)。createHtmlSubagent 默认装进 HTML 子 agent;亦可独立分发,集成方 `defineSkill` 自挂。

## 代码存储约定(重要)

- 代码正文写 vfs:`html/<name>.vue`(如 `html/hero.vue`)
- data 存引用:`{ type:'custom', codeRef:'vfs://html/<name>.vue', name, props }`
- 改代码:`vfs_edit` 改 vfs 文件(data 的 `codeRef` 引用不变,无需改 data)
- 渲染层(集成方契约):遇 `type:'custom'` 组件,读 `data.codeRef` → vfs 取 code → 渲染

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

- 小段代码:`vfs_write` 整体写
- 大段代码:先 `vfs_write` 建骨架,再 `vfs_edit` 增量拼(避免单次输出超 max_tokens 截断)
- 删除组件:`vfs_rm` 删 vfs 代码 + `write` 移除 data 引用
