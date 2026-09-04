# Tasks:ui-quick-wins(四项快赢)

## Phase 1:Q1 quickActions + Q4 拖拽聚焦(纯 UI 面)

- [x] 1. 〔勘察〕ChatInput/ChatDialog 挂点与 gate-pending 禁发信号源确认;dialog 配置组解析链(optionsResolver)
- [x] 2. 实施 Q1:`dialog.quickActions` 配置 + ChatInput chip 行 + 点击 sendMessage;挂起期禁用联动;>8 条 warn 截断
- [x] 3. 实施 Q4:ChatDialog drop 分流(files 优先 → 图片通道;非 files 且有 `onDropElement` → 回调;否则忽略)
- [x] 4. browser e2e:chips 渲染/点击发送/挂起禁用;drop 分流三分支
- [x] 5. selftest:quickActions 解析(非法项过滤/截断);types 同步

## Phase 2:Q2 会话导出/导入(API 面)

- [x] 6. 〔勘察〕SessionSnapshot 序列化函数复用点(storage 后端既有实现)+ 易失态剥离白名单口径
- [x] 7. 实施 `exportSession`/`importSession`(formatVersion/safeParse/6MB 闸/写 storage/会话列表刷新);switchSession/resetSession 语义不动
- [x] 8. UI 配套:ChatHeader 下拉导出/导入项(下载 .json / file input)
- [x] 9. e2e:export→import 往返 + 非法输入三态 + inspect 反射;selftest 剥离面断言
- [x] 10. types/index.d.ts + types/headless.d.ts 同步;usage-guide 中英补节

## Phase 3:Q3 审批 diff 预览

- [x] 11. 〔勘察〕dataOps dryRun 预览函数暴露通道(闭包引用透传 vs callConfig);确认 dryRun 零副作用(不动快照/基线)
- [x] 12. 实施:write 族 approval 挂起时附结构化预览(事件载荷 + ApprovalBar 渲染,大值截断 ~200 字符)
- [x] 13. e2e + browser:预览载荷结构断言 / ApprovalBar 渲染 / 非 write 工具零变化
- [x] 14. 全量门禁:npm test + build + test:e2e + test:browser + exports/types/size;计数同步 CLAUDE.md + README 中英;CHANGELOG
