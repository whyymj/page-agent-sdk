# Tasks

> **2026-08-22 回退注记**:Phase 1/2 曾随 3.41.0 发布,Phase 3(editor 接入)评估时维护者拍板移除两选项(3.43.0,详见 proposal 头部回退说明)。下方 Phase 3 各项**不再适用**;Phase 1/2 勾选保留为历史记录(对应能力已在 3.43.0 撤除,相关测试 sec-96/sec-97 与 e2e 用例同批删除)。(main-surface-slim;SDK 侧)

## Phase 1:dataOps 工具白名单

- [ ] `DataOpsOptions.tools?: string[] | 'high'`;'high' 预设 = 高层套(describe/read/write/schema_data/diff_data/query_data/search_data/eval_script/restore_data/history_data)
- [x] 装配期过滤 createDataOps 输出;名单含不存在名 console.warn 留痕
- [x] createChatSdk({ data: { tools } }) 透传;types/index.d.ts 同步
- [x] selftest:不传=全量零回归 / 'high' 不含 get_data·set_data·edit_data·delete_data / 具体名单 / 未知名 warn

## Phase 2:vfs 主栈暴露面开关

- [x] `options.vfs.mainTools?: boolean`(缺省 true 现状)
- [x] mainTools:false → vfs 中间件 tools 不进主栈;beforeAgent files 注入 / offload / 子 agent 桥接保留
- [x] 子 agent allTools 合并源调整:装配期把 vfs 工具数组并入 subagentsMiddleware 的池(主栈隐藏但子 agent 白名单筛得到,html 子 agent vfs_edit 不饿死)
- [x] offload vfsAvailable 判定改 state.files 非空(不绑 vfs_read 工具名;主栈隐藏后大结果外存照常)
- [x] usageHints:vfs 段按 mainTools 条件注入主栈(核:usageHints 现无 vfs 段,无需改;offload 引用文案随工具结果回流)
- [x] selftest:mainTools:false 主栈无 vfs_read / 子 agent 池含 vfs_write / offload 仍外存
- [x] e2e:inspect().tools 主栈 -9;use_html 委派 commit 落地不回归

## Phase 3:editor 接入(建议,非 SDK 阻塞)

- [ ] editor 配 `vfs: { mainTools: false }` + `data.tools: 'high'`;prompt.js 删「工具纪律」段
- [ ] 浏览器验证:42 → 32 工具;use_html 委派改码照常落地
- [ ] 真 LLM 同 prompt 对比:工具选择稳定性(直写/委派摇摆)+ 单轮固定 token 下降

## Phase 4:归档

- [ ] 验收过 → 归档;CLAUDE.md 工具面说明补 mainTools/tools 白名单
