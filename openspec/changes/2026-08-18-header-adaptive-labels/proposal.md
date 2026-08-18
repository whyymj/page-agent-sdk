# Proposal: header-adaptive-labels(顶部按钮自适应文字标签 + 图标/文字可配置)

## Why(editor_fangzhou 集成驱动,2026-08-18)

集成方(editor 方舟编辑器,AI 面板为 golden-layout dock,可拖宽/可弹出独立窗口)提出:顶部按钮当前恒纯图标(28×28 SVG),宽度足够时希望展示「文字+图标」提升可发现性,收窄回退纯图标。同轮追加:**按钮文字与图标要支持配置,纳入 i18n 与配置项体系**。

现状缺口:
1. `ChatHeader` 按钮是硬编码内联 SVG,`dialog.icons` 管不到(3.17 图标自定义体系只覆盖 emoji 位与 send);
2. 按钮无文字形态,窄面板下「⋈ / ⟲」图标语义靠 title 悬停,可发现性差;
3. 宽度自适应无机制(对话框宽度由容器决定,media query 查的是视口,不适用嵌入面板场景)。

## What Changes

**核心:纯 CSS 容器查询驱动「宽 = 文字+图标 / 窄 = 纯图标」,文字走 i18n 既有键、图标走 `dialog.icons` 新增四键、总开关 `dialog.headerLabels`。**

1. **容器查询**(ChatHeader):
   - 新增 `.header-main` 包裹层作 `container-type: inline-size` 锚点(标题区 + 按钮区);
     **遮罩(`.more-overlay`,position:fixed 整页点击外关闭)必须留在包裹层之外** —— `contain: layout` 会把它变成 fixed 后代的包含块,套进来整页遮罩缩成头部条(评审识别的坑)
   - `@container (min-width: 440px)` → `.action-btn.has-label` 变宽(文字+图标);默认(窄)隐藏 `.action-label`;
     阈值 440px = 头部内容区,默认 padding 下 ≈ 对话框 ≥472px(默认 420px 抽屉不受影响,零回归面)
   - 关闭按钮恒纯图标;`debug-badge` 随 more 按钮右移,不受影响
2. **图标可配**(`dialog.icons` 四键,与 `send` 同机制):`newSession` / `history` / `more` / `close` —— undefined = 内置 SVG(默认零变化),空串视为未传(防空图标),值走 IconGlyph(emoji/字符/HTML 片段经图标白名单净化)
3. **文字可配(零新键)**:复用 i18n 既有键 `newSession`(新建会话/New chat)/ `history` / `more`(本就是按钮 title)—— `i18n.messages` 键级覆盖与 locale 切换天然生效
4. **总开关**:`dialog.headerLabels`(默认 `true` 自适应;`false` 恒纯图标)—— DialogConfig → mountChatDialog → ChatDialog props → ChatHeader `labels` prop,`.cs-no-labels` 类压过容器查询分支
5. **附带**:`.header-title` 补 ellipsis 截断(长标题不再溢出挤压按钮);`types/index.d.ts` 对齐既有漂移(`DialogIcons.send`、`DialogConfig.sections` 此前漏标)

### 明确不做(Non-goals)

- 阈值不可按集成配置(container query 条件不能吃 CSS 变量;有需求再议 JS 化/ResizeObserver 方案)
- 不做逐按钮 label 独立配置(文字= title 同源,i18n 键级覆盖已是配置面)
- 不做「强制显示」模式(窄框强显文字必溢出;`headerLabels` 只有 true/false)
- 旧浏览器(无 `@container`)不做 polyfill —— 恒纯图标 = 旧行为,即优雅降级路径

## Impact

- **文件**:`ChatHeader.vue`(模板 + CSS)/ `ChatDialog.vue`(props 透传)/ `icons.ts`(四键)/ `createChatSdk.ts`(DialogConfig)/ `mountChatDialog.ts`(接线)/ `types/index.d.ts`
- **测试**:selftest sec-81 +3(图标四键 resolve 白盒)/ browser `header-labels.spec.ts` +5(宽显文字 / 窄隐且可交互 / icons.newSession 替换 / en-US 英文标签 / headerLabels:false);fixtures:minimal-demo icons+`newSession:'➕'`、nested-demo `headerLabels:false`
- **文档**:usage-guide 中英 §6.15(⑤ headerLabels)/ README 中英(DialogConfig 表 + 用法地图)/ CHANGELOG
- 计数:selftest 2434→2437 / browser 84→89 / e2e 769 不变
