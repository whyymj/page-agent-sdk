# Tasks(path-scoped-validation,按依赖序;已过怀疑论评审回改)

## Phase 1:纯函数 + 单元 ✅(2026-08-20)

- [x] `validateAtPath(schema, path, value)` 落 **schemaUtils.ts**(jsonUtils 保持零 zod 依赖):getSchemaAtPath 取目标 schema + **union-tolerant**(实际数据判别分支优先,歧义 any-option-accepts,全拒才拒,`union_ambiguous` 留痕)→ safeParse
- [x] 无 schema 节点二分(评审 2.2):key 不在 shape → SCHEMA_STRIP 拒(per-path findStrippedKeys);开放节点(record/any/unknown/**passthrough**)→ 放行 + `no_schema_node` 留痕
- [x] `validateWriteLocally(schema, patchTargets[], newBind)`:**全部 apply 后按最终态逐目标校验**(不做逐条即时);整体 set = 只校验 value 出现的顶层 key;jsonPath=''(根)= 整对象(显式保留)
- [x] 写回拼装(评审 2.1):per-path 局部 parse 的 `.data` 写回(strip 语义 + `__proto__` 防线保留);整体 set 各 key parse 结果 merge 组装
- [x] 根级 refine 检出:局部校验跳过根 refine 时经返回值 `notices` 留痕(实现为函数返回而非常驻 observable —— 命中即随工具结果回流,零全局状态;`data.validation:'local'|'global'` 开关评估后未带:现有集成无 refine 依赖,开关徒增配置面,deferred)
- [x] selftest(sec-92,20 项):兄弟脏数据不株连(事故复刻)/ 目标坏值仍拒 / append 只校验新增元素(反株连)/ remove 只校验父容器结构约束 / write del 维持无校验 / patches 单条坏整批回滚 + 后条修前条最终态过 / strip 联动 / union 歧义 / 整体 set 契约 / 防原型污染

## Phase 2:dataOps 接线 ✅(2026-08-20)

- [x] write/set_data/edit_data 校验段替换为局部校验 + per-path 写回;错误文案 path 字段 = 写入 jsonPath
- [x] **波及面同步核查(评审 2.5)**:applyPatchesToBind 被 eval_transform_subtree/eval_transform 复用(patches 路径自动继承)、commitSetToBind 被 draft_commit 复用(自动继承)、eval transform 整体替换路径单独改走 validateRootValueLocally —— 四工具语义随纯函数变更,e2e 全量绿确认
- [x] 局部校验复用 dataOps 闭包内已替换的 schema 引用(extendSchemaWithPgId 扩展后的同一 schema,`__pgId` 声明不丢)
- [x] dryRun 同步局部化
- [x] 全量跑现有 selftest + e2e;旧断言改写:sec-01:69「缺必填拒」→ merge 语义新契约(缺省字段保留 + 出现 key 坏值仍拒,改 2 断言)、sec-02:142「叶子设子属性」→ SCHEMA_STRIP 语义等价(断言正则扩 SCHEMA_STRIP)、sec-21.ts:323 顺序依赖注释(随局部化约束自然消失,断言未需改)
- [x] 同批次「set + remove 位移」快照兜底(逐 patch 应用后目标路径快照;e2e capability-packs ⑧ 场景:末尾 set 容器 + remove 原位,remove splice 前移后旧路径 undefined,按快照值校验)
- [x] merge value 字符串形态 maybeParseValue 兼容(sec-02 JSON 字符串 merge)
- [ ] e2e data-slots **新增用例**(顶层整体 set 局部校验 / append 反株连 / strip 联动)—— selftest sec-92 已覆盖同逻辑,e2e 侧待补(实施补录)

## Phase 3:导出 + 文档 + 计数 ✅(2026-08-20)

- [x] validateAtPath/resolveSchemaPath/schemaHasRefinement/arrayMinLength/elementSchemaCandidates/PathSchemaResolution/ValidateAtPathResult(schemaUtils)+ applyPatchesToBind/validateRootValueLocally/validateWriteLocally/LocalWriteBack/LocalValidationPlan(dataOps)公开导出;types/index.d.ts + types/headless.d.ts + 双入口同步;test:exports / test:types / test:types-alignment 三门禁绿
- [x] CLAUDE.md 数据槽段:校验语义改「被写子树结构合法」+ 契约细节;usage-guide 中英 data 段
- [x] CHANGELOG 归 **Changed**:首行标注「校验语义收窄,依赖全局 refine/必填缺失拒的集成方需迁移」
- [x] 断言计数同步(CLAUDE.md 2609 + README 中英)

## Phase 4:验收 ✅(2026-08-20,editor 实测项待 editor 升级后跑)

- [x] `npm test && npm run build && npm run test:e2e` 三绿(2609/864/0)+ test:browser(102/0,改 dataOps 按测试矩阵)
- [ ] editor 实测回归:恢复一个 script:"" 的原生组件页,单点改任意其他组件 → 写入成功(用例集 C-04 家族);append 新组件到含脏兄弟的容器 → 成功(editor 升级到本版本后跑)
- [ ] restore_data 株连登记 openspec/deferred.md(触发条件:editor 实测回退失败案例)
