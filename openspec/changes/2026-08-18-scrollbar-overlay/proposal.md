# Proposal: scrollbar-overlay(滚动条统一替换)+ sessionDelete 图标键

## Why(用户诉求,2026-08-18)

「聊天框的横向、纵向滚动条能否优化」→ 追加「最好有现成的滚动自定义的框架,帮忙替换原生滚动条」。同轮:`历史记录下拉的删除按钮换成 bin.png`(editor_fangzhou)。

现状问题:
1. 全部滚动区用浏览器原生滚动条 —— Windows/Chrome 上是浅色粗条(~17px),与 dark 主题(#222/#353535)严重冲突;
2. `.chat-main` 只设 `overflow-y:auto` → overflow-x 隐式变 auto,长内容(代码块外溢路径)可撑出**对话框级横向滚动条**;
3. 头部按钮图标已可配(同日 header-adaptive-labels),但历史删除按钮(`.hist-del` ✕ 文本)不在 `dialog.icons` 体系内。

## What Changes

**选型:OverlayScrollbars v2**(`overlayscrollbars@2.16`,新 dependency 打包进主包;headless 不含)。理由:现役维护 / 保留原生滚动行为(键盘/触摸/惯性)/ ResizeObserver 自动跟随聊天内容动态增高 / 官方 CSS 变量主题化;否决 simplebar(动态内容 recalc 依赖重)与纯 CSS 方案(Firefox 形状不可控,不满足「框架替换」诉求)。

1. **主滚动面接管**(JS 初始化):`.chat-main`(消息区,ChatDialog onMounted)+ `.drawer-body`(DebugDrawer 日志区,**v-if 挂载 → visible watch + onMounted 双入口幂等初始化**);`overflow.x:'hidden'` + `autoHide:'scroll'` 700ms + `clickScroll:true`;**初始化方式 = 模板预置 host/viewport/contents 三层 + 对象初始化 `({ target, elements: { viewport, content } })` 认领既有节点** —— 实测教训:默认元素初始化会把宿主子节点搬进插件自建 content 层,与 Vue patch 冲突致 `insertBefore` 崩(browser DebugDrawer 日志实时刷新两用例暴露);对象初始化零 DOM 搬运,onScroll/onWheel/scrollToBottom 零改动;destroy 回落原生滚动
2. **对话框级横向滚动消灭**:`overflow.x hidden`(插件选项 + CSS 双保险),长代码行收敛在代码块内部(`.code-block code` 自带 overflow-x:auto)
3. **小滚动区兜底**(代码块/历史菜单/textarea 等不接 JS):`scrollbar-width: thin` + `scrollbar-color`(继承属性,Firefox/Chromium121+)+ `::-webkit-scrollbar` 伪元素(6px 圆角/轨道透明/主题色);与 os viewport 的原生隐藏规则显式互斥(`[data-overlayscrollbars-viewport]` 再断言 hidden)
4. **主题变量**:`--cs-scrollbar-thumb(-hover)`(ChatDialog light/dark)+ `--dd-scrollbar-thumb(-hover)`(DebugDrawer 双主题)→ os 手柄经 `--os-handle-bg*` 映射;集成方可覆盖
5. **`dialog.icons.sessionDelete`**:历史删除按钮 undefined=✕(默认零变化);editor 侧传 `<img src="bin.png data-uri" width=12 height=12>`
6. **体积**:overlayscrollbars JS+CSS 注入 → IIFE ~1.94MB / ESM ~963KB / CSS ~77KB / legacy ~2.95MB / headless 不变;size-check 阈值同步(IIFE 2.15MB / UMD 1.15MB / CSS 85KB);README/CLAUDE 体积数字刷新(原数字早已陈旧)

### Non-goals

- textarea 内部滚动条不接 JS(overlay 库不支持表单元素内部滚动),走 CSS 细条
- 不做滚动条配置项(选项/开关)—— 内置默认即目标形态,有诉求再议
- 不自定义 os 滚动条动画/拖拽行为(用默认)

## Impact

- **文件**:`ChatDialog.vue` / `DebugDrawer.vue`(JS init + CSS)/ `icons.ts` + `types/index.d.ts`(sessionDelete)/ `package.json`(+dep)
- **测试**:browser scrollbar.spec +3 / icons.spec +1(双会话 → 历史下拉 → 🗑️ fixture)/ sec-81 断言扩展(计数不变)
- 计数:selftest 2437 / e2e 769 / browser 93
