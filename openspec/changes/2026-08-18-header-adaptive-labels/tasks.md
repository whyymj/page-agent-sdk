# Tasks

- [x] ChatHeader 模板:`.header-main` 包裹层(标题区 + 按钮区)+ `container-type: inline-size`;`more-overlay` 留在包裹层外(contain 不影响其 fixed 定位)
- [x] ChatHeader CSS:`.action-label` 默认隐藏;`@container (min-width: 440px)` 下 `.action-btn.has-label` 展示文字+图标(宽自适应);`.header-title` 补 ellipsis
- [x] 图标四键:`DialogIcons` + `resolveDialogIcons` 增 `newSession`/`history`/`more`/`close`(undefined=内置 SVG,空串视为未传);ChatHeader 四按钮经 IconGlyph 渲染,未配回落内置 SVG
- [x] 配置项:`DialogConfig.headerLabels`(默认 true 自适应 / false 恒纯图标)→ mountChatDialog → ChatDialog props → ChatHeader `labels` prop(`.cs-no-labels` 压过容器查询)
- [x] types/index.d.ts:四图标键 + `headerLabels` + `sections` 对齐(既有漂移补漏:`send` 键)
- [x] selftest sec-81 +3:四键传值透传 / 空串视为未传 / 缺省 undefined
- [x] browser header-labels.spec +5:宽=文字+图标 / 窄=纯图标且可交互 / icons.newSession 替换内置 SVG / en-US 英文标签 / headerLabels:false 恒纯图标(fixtures:minimal-demo `newSession:'➕'`、nested-demo `headerLabels:false`)
- [x] 文档:usage-guide 中英 §6.15 增 ⑤ headerLabels + 图标四键;README 中英 DialogConfig 表补两行;CHANGELOG [Unreleased] 条目
- [x] 门禁:selftest 2437 绿 / e2e 769 绿(dist 构建)/ browser 89 绿 / `npx tsc` src 零 error
