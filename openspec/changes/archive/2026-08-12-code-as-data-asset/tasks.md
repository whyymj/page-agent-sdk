# Tasks: code-as-data-asset

> 实施任务清单。`/opsx:apply` 按此执行。每完成一项勾 `[x]`。
> **breaking major**(createHtmlSubagent 单模式,砍 codeRef)。分阶段:A read 摘要 → B __pgId 注入 → C createHtmlSubagent 单模式重写 → D demo → E/F 测试 → G 文档 → H 发布。A/B 是 C 的依赖,先做。

## 阶段 A:read 大文本字段摘要(`src/core/tools/dataOps.ts` + schemaUtils)

- [x] A1 `read` 返回值投影后,对"标记为大文本"的字段(主 scope)摘要为占位(`<code Nkb>`);标记机制(createHtmlSubagent 单模式框架标 code 字段)
- [x] A2 scope 判定:主 scope 摘要 / 子 scope 完整(经 ToolCallContext activeScope/scopeId)
- [x] A3 占位仅作用于 read 返回;data bind 原值不变(单测断言)
- [x] A4 selftest(sec-73-read-summary):主 scope 标记字段摘要 / 子 scope 完整 / 未标记业务长文本原样 / 非 htmlSubagent 不变 / bind 原值不变

## 阶段 B:`__pgId` 装配期注入(`src/core/sdk/createChatSdk.ts` + dataOps/schemaUtils)

- [x] B1 装配期:检测 htmlSubagent writablePaths → 找 data schema 对应节点 → `z.array` → 元素 `z.object` → extend 加 `__pgId:z.string().optional()` → extendedSchema
- [x] B2 projectBySchemaDeep 投影过滤 `__pg*` 前缀(agent/集成商 read 看不到)
- [x] B3 isPathAllowed 白名单用 extendedSchema(__pgId 允许写)
- [x] B4 write 钩子:子 agent write 新建 components.N 且 __pgId 空 → 自动生成 `'c_'+随机` 写回;已有保持
- [x] B5 fallback:schema 非 array<object>(union/discriminated 等)→ console.warn + 降级(不抛错)
- [x] B6 selftest(sec-NN-pgid-inject):装配后 schema 含 __pgId(集成商未声明)/ read 不含 __pg* / write 新建自动补 id / persist 往返 id 稳定 / vfs 文件名含 id / array<object> 注入成功 / union 降级 warn

## 阶段 C:createHtmlSubagent 单模式重写(`src/core/sdk/htmlSubagent.ts` + `codeAssetMiddleware.ts` + `createChatSdk.ts`)

- [x] C1 砍 codeRef 相关:systemPrompt 改(代码进 data code 字段,vfs 工作副本);去 codeKind 存储分支(SFC/html 都走 data code)
- [x] C2 砍 onComplete 选项:afterAgent 改为框架自动 commit(vfs→data.code,直改 bind)
- [x] C3 新增 beforeAgent checkout 钩子:扫 data writablePaths 有 code 的组件 → 按 __pgId 检出到 vfs;hook vfs_edit/vfs_write 记 touchedVfsPaths
- [x] C4 新增 afterAgent commit 钩子(verify 通过后):增量回写 touchedVfsPaths → data.code(按 __pgId);删除组件孤儿清理
- [x] C5 保留 formatCheck(validate_code + verify 扫 vfs 工作副本,零适配)
- [x] C6 保留 vfs 工具(子 agent vfs_read/vfs_edit/vfs_write 改工作副本)
- [x] C7 新建路径:子 agent write 建 components.N(含 code)→ write 钩子补 __pgId(阶段 B 已实现)。**validateHtmlFormat 校验新建 code 留 deferred**(design §8 约定级:靠 prompt 引导 + 集成商 persist 前服务端校验覆盖,非强制)
- [x] C8 CreateHtmlSubagentOptions 调整:去 onComplete;writablePaths 必填;codeVfsPrefix 保留
- [x] C9 selftest(sec-75-code-asset):beforeAgent checkout(data code→vfs) / wrapToolCall hook 记 touched / afterAgent commit(vfs→data code,增量) / 孤儿清理 / recomputeBaseline / formatCheck 扫 vfs(零适配,sec-72 覆盖)/ 砍 onComplete(options 无)/ _codeAsset 标记设

## 阶段 D:demo 迁移

- [x] D1 `examples/html-page-demo/App.vue`:schema 加 `code` 字段(去 codeSnapshots 镜像);UI 绑 data.code;createHtmlSubagent 去 onComplete(单模式)
- [x] D2 mock 服务端 persist:本地内存 +「保存到服务端」/「从服务端加载」按钮(演示 data json 含 code 往返)
- [x] D3 `examples/html-subagent-demo`:同步改单模式(schema 加 code 去 codeRef + 去 vfsFiles hook + UI 展示 data.code SFC 资产)
- [x] D4 browser spec 更新:断言 data components[i].code 含正文 + UI v-html 绑 data(新建/修改/宽内容 3 spec 全绿)。**persist 往返测试留 manual**(保存/加载按钮已实现,往返正确性靠 design 契约 + 单测覆盖,browser 未测按钮交互)

## 阶段 E:selftest

- [ ] E1 sec-NN-read-summary(A4)
- [ ] E2 sec-NN-pgid-inject(B6)
- [ ] E3 sec-NN-html-single-mode(C9)
- [ ] E4 同步 CLAUDE.md selftest 断言计数

## 阶段 F:e2e + browser

- [ ] F1 `tests/e2e/` 扩展(createHtmlSubagent 单模式 inspect 反映 + __pgId 注入 + read 摘要 + checkout/commit 数据流)。**留 deferred**:codeAsset 是子 agent/middleware 范畴,e2e 顶层 API 覆盖边际低;selftest(sec-75)+ browser(html-page-demo)已覆盖核心数据流
- [x] F2 `tests/browser/html-page-demo.spec.ts` 更新:单模式适配(新建 write data / 修改 checkout+vfs_write+verify 门禁+commit / 宽内容),3 passed
- [ ] F3 同步 CLAUDE.md e2e/browser 断言计数(G 阶段一并)

## 阶段 G:文档(中英文同步)

- [x] G1 README.md / README.zh-CN.md —— createHtmlSubagent 单模式(代码作为 data 资产,进服务端 DB;vfs 工作副本;框架自动 checkout/commit;__pgId 无感知)+ breaking major 迁移说明
- [x] G2 doc/usage-guide.md / .en —— 资产模式章节(代码进 data + 服务端持久化集成示例 + Git 模型类比)+ breaking 迁移指南(codeRef → code)
- [x] G3 CLAUDE.md —— 子 agent 段(单模式 + 砍 codeRef + 框架自动钩子)+ 数据槽段(__pgId 注入 + read 摘要 + 两路径写 data)+ 测试矩阵 + 计数 1849 + breaking 标注

## 阶段 H:发布(breaking major,用户确认后)

- [ ] H1 develop 开发 + commit;openspec 归档 `git add -f openspec/changes/archive/2026-08-12-code-as-data-asset/`;README 全景盘点同步
- [ ] H2 `npm version major --no-git-tag-version`(package.json + package-lock.json 两处)
- [ ] H3 发布前必跑顺序:`build` → `selftest`(E 计数 +N)→ `e2e`(F 计数 +N)→ `browser` → `test:exports` → `test:types` → `test:size` → `npm pack --dry-run`
- [ ] H4 `publish-github.sh "release x.0.0: breaking createHtmlSubagent 单模式(代码作为 data 资产 + vfs 工作副本 + 框架自动 checkout/commit + __pgId 无感知注入 + read 摘要)"` 推双远程
- [ ] H5 `npm publish` + 验证(`npm view` + 临时 `npm i` + esm.sh 可达)

## 验证门禁

- **read 摘要**:selftest(主 scope 标记字段摘要 / 子 scope 完整 / 业务长文本不受影响 / bind 原值不变)
- **__pgId 注入**:selftest(装配后 schema 含 / read 不含 __pg* / write 新建自动补 / 往返稳定 / array<object> 成功 / union 降级)
- **单模式 createHtmlSubagent**:selftest(before/after 钩子 / checkout / commit 增量 / formatCheck 扫 vfs / 砍 onComplete)+ e2e(inspect 反映)+ browser(数据流)
- **持久化往返**:demo「保存/加载」按钮,断言 data json 含 code + __pgId 往返一致 + 加载后子 agent 能增量改
- **breaking 迁移**:现有 codeRef demo/e2e 改单模式后全 pass(无 codeRef 残留)
- **快照栈不膨胀**:commit 不进 dataOps 快照栈(断言栈深度不因 code commit 增长)
