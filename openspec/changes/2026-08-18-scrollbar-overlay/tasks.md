# Tasks

- [x] 依赖:`overlayscrollbars@2.16`(官方源安装,公司源 404);打包进主包(headless 不含)
- [x] ChatDialog:chat-main onMounted 初始化 OverlayScrollbars(overflow.x hidden / autoHide scroll 700ms / clickScroll)+ onBeforeUnmount destroy
- [x] DebugDrawer:drawer-body 初始化(v-if 挂载 → visible watch + onMounted 双入口幂等)
- [x] 主题变量:`--cs-scrollbar-thumb(-hover)` light/dark + `--dd-scrollbar-thumb(-hover)` 双主题 + `--os-handle-bg*` 映射
- [x] 小滚动区 CSS 细条兜底(scrollbar-width/color 继承 + ::-webkit-scrollbar 伪元素)+ os viewport 原生隐藏再断言
- [x] `dialog.icons.sessionDelete`(icons.ts resolve + ChatHeader IconGlyph/✕ 分支 + types 对齐 + sec-81 扩展)
- [x] 测试:browser scrollbar.spec +3 / icons.spec +1;size-check 阈值同步;README×2/CLAUDE 体积与计数刷新
- [x] editor_fangzhou:bin.png → assets + icons.sessionDelete img 片段(需 SDK ≥3.27 升级后生效)
- [x] 门禁:build / selftest 2437 / e2e 769 / browser 93 / exports / types / alignment / size / tsc 全绿
